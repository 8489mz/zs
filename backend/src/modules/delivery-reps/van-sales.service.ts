import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../core/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { DeliveryRepsService } from './delivery-reps.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import {
  reconcileTripFinancials,
  evaluateFieldCardPayment,
  evaluateTripExpenseGovernance,
  evaluateDamagedSwap,
} from './van-trip-reconciliation.engine';
import {
  sortItemsByProductId,
  moveVanStock,
  getOrCreateVanLocation,
  generateDailySequenceNumber,
  FLEET_VEHICLE_STATUSES,
  normalizeCustomerCode,
  formatCustomerCode,
  getCustomerRepBalancesMap,
  fieldCollectionPaymentScope,
  resolveFieldCollectionChannel,
  resolveRepLinkedUserId,
  resolveVanMoneyAuditActor,
} from './services/van-common.util';
import {
  extractCoordinatesFromCustomerLocation,
  evaluateGeofenceCompliance,
  isValidCoordinatePair,
  extractAssignedRepIds,
  loadRepPermissions,
  resolveIsolatedRepCustomerBalance,
  validateIsolatedRepCollection,
  type RepTargetCalculationResult,
} from './rep-target.engine';
import { VanFleetService } from './services/van-fleet.service';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { todayLocalIsoDate } from '../sales/helpers/sales-write.helper';
import { VanRequisitionsService } from './services/van-requisitions.service';
import { DAY_KEY_TO_ARABIC, normalizeDayKey } from './van-routes-schedule.util';
import { VanReturnsService } from './services/van-returns.service';
import { VanTargetsService } from './services/van-targets.service';
import { VanTransfersService } from './services/van-transfers.service';
import { VanRoutesService } from './services/van-routes.service';
import { VanFraudRadarService, RecordVanSuspicionParams } from './services/van-fraud-radar.service';
import { VanFieldSalesService } from './services/van-field-sales.service';
import { VanTripLifecycleService } from './services/van-trip-lifecycle.service';
import { authorizeManagerSecret } from '../../common/utils/manager-approval';

import type { VanStockItem, VanTripSummary } from './services/van-trip-lifecycle.service';
export type { VanStockItem, VanTripSummary };

@Injectable()
export class VanSalesService {
  static readonly FLEET_VEHICLE_STATUSES = FLEET_VEHICLE_STATUSES;

  private static readonly inFlightSalePromises = new Map<string, Promise<any>>();
  private static readonly recentSalesCache = new Map<string, { result: any; timestamp: number }>();
  private static readonly inFlightCollectionPromises = new Map<string, Promise<any>>();
  private static readonly recentCollectionsCache = new Map<string, { result: any; timestamp: number }>();

  private readonly vanFleetService: VanFleetService;
  private readonly vanRequisitionsService: VanRequisitionsService;
  private readonly vanReturnsService: VanReturnsService;
  private readonly vanTargetsService: VanTargetsService;
  private readonly vanTransfersService: VanTransfersService;
  private readonly vanRoutesService: VanRoutesService;
  private readonly vanFraudRadarService: VanFraudRadarService;
  private fieldSales: VanFieldSalesService | undefined;
  private tripLifecycle: VanTripLifecycleService | undefined;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
    private readonly deliveryRepsService: DeliveryRepsService,
    private readonly accountingPosting: AccountingPostingService,
    vanFleetService?: VanFleetService,
    vanRequisitionsService?: VanRequisitionsService,
    vanReturnsService?: VanReturnsService,
    vanTargetsService?: VanTargetsService,
    vanTransfersService?: VanTransfersService,
    vanRoutesService?: VanRoutesService,
    vanFraudRadarService?: VanFraudRadarService,
  ) {
    this.vanFraudRadarService = vanFraudRadarService ?? new VanFraudRadarService(db);
    this.vanFleetService = vanFleetService ?? new VanFleetService(db);
    this.vanRequisitionsService = vanRequisitionsService ?? new VanRequisitionsService(db);
    this.vanReturnsService = vanReturnsService ?? new VanReturnsService(db, accountingPosting, this.vanFraudRadarService, this.audit);
    this.vanTargetsService = vanTargetsService ?? new VanTargetsService(db);
    this.vanTransfersService = vanTransfersService ?? new VanTransfersService(db, this.audit);
    this.vanRoutesService = vanRoutesService ?? new VanRoutesService(db, this.vanFleetService, this.vanFraudRadarService);
    this.tripLifecycle = this.getTripLifecycle();
  }

  // Lazy accessor (sales-write S2/S3 pattern), LAZY-ONLY by design: the
  // ctor must NOT call getFieldSales() — an eager bind would freeze the
  // REAL facade methods before specs can mock them. Nine specs mock
  // resolveSystemAuthContext on the instance AFTER construction
  // (book-digits, tax-optional, wholesale-price, dedup-key,
  // noncash-evidence, fefo-batches, shared-offer, rep-permission-flags-h9,
  // van-visits-tracking-collections) and tax-optional also mocks
  // verifySupervisorPin. The accessor binds on first delegate call, after
  // any mock is assigned, so Object.create specs (no ctor) and
  // new-constructed specs (mock after ctor) both work. Production is
  // unaffected: Nest never monkey-patches, and the helper is stateless,
  // so first-call construction is behaviorally identical to ctor
  // construction.
  private getFieldSales(): VanFieldSalesService {
    if (!this.fieldSales) {
      this.fieldSales = new VanFieldSalesService({
        db: this.db,
        audit: this.audit,
        accountingPosting: this.accountingPosting,
        vanFraudRadarService: this.vanFraudRadarService,
        deductVanSalePharmacyBatches: this.deductVanSalePharmacyBatches.bind(this),
        generateDailySequenceNumber: this.generateDailySequenceNumber.bind(this),
        moveVanStock: this.moveVanStock.bind(this),
        resolveSystemAuthContext: this.resolveSystemAuthContext.bind(this),
        sortItemsByProductId: this.sortItemsByProductId.bind(this),
        verifySupervisorPin: this.verifySupervisorPin.bind(this),
      });
    }
    return this.fieldSales;
  }

  private getTripLifecycle(): VanTripLifecycleService {
    if (!this.tripLifecycle) {
      this.tripLifecycle = new VanTripLifecycleService({
        db: this.db,
        audit: this.audit,
        accountingPosting: this.accountingPosting,
        vanFraudRadarService: this.vanFraudRadarService ?? new VanFraudRadarService(this.db),
        getOrCreateVanLocation: this.getOrCreateVanLocation.bind(this),
        sortItemsByProductId: this.sortItemsByProductId.bind(this),
        moveVanStock: this.moveVanStock.bind(this),
        moveVanPharmacyBatches: this.moveVanPharmacyBatches.bind(this),
        deductVanSalePharmacyBatches: this.deductVanSalePharmacyBatches.bind(this),
        resolveSystemAuthContext: this.resolveSystemAuthContext.bind(this),
        recordSuspicionEvent: this.recordSuspicionEvent.bind(this),
        listRepServedCustomerIds: this.listRepServedCustomerIds.bind(this),
        resolveRepLinkedUserId: this.resolveRepLinkedUserId.bind(this),
      });
    }
    return this.tripLifecycle;
  }

  async recordSuspicionEvent(params: RecordVanSuspicionParams) {
    return this.vanFraudRadarService.recordSuspicionEvent(params);
  }

  async getFraudRadarSummary(tenantId: string, options?: { days?: number; repId?: number }) {
    return this.vanFraudRadarService.getSummary(tenantId, options);
  }

  async getFraudRadarEvents(
    tenantId: string,
    options?: {
      days?: number;
      repId?: number;
      eventCode?: string;
      limit?: number;
    },
  ) {
    return this.vanFraudRadarService.getEvents(tenantId, options);
  }

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Van-sales endpoints are reached via the driver's portal token, not a staff session, so there is
   * no AuthContext to post the journal under. Falls back to the tenant's earliest active user rather
   * than a bare id — journal_entries.created_by/posted_by are FK'd to users(id), and an id that
   * doesn't exist there fails the insert.
   */
  /**
   * M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the posting identity
   * for a driver-originated journal. When the caller names the acting
   * rep, his linked login is the poster — the tenant's first active
   * user never sold or collected anything, so naming him as
   * created_by on the sale/collection/settlement journal was false
   * attribution. When the rep has no linked login (or no rep is
   * named) the old first-active-user fallback stays: making that
   * honestly null needs a posting-layer decision (AuthContext.userId
   * is number-typed and sale.created_by feeds postSale's fallback),
   * recorded as a follow-up, not bundled here.
   */
  private async resolveSystemAuthContext(tenantId: string, accountId: string, repId?: number | null): Promise<AuthContext> {
    if (repId && Number(repId) > 0) {
      const linkedUserId = await resolveRepLinkedUserId(this.anyDb, tenantId, Number(repId));
      if (linkedUserId) {
        return {
          userId: linkedUserId,
          sessionId: 'van-sales-system',
          username: 'van-sales-system',
          role: 'admin',
          permissions: ['accounting'],
          tenantId,
          accountId,
        };
      }
    }
    const user = await this.anyDb
      .selectFrom('users')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .orderBy('id', 'asc')
      .executeTakeFirst();

    return {
      userId: user ? Number(user.id) : 0,
      sessionId: 'van-sales-system',
      username: 'van-sales-system',
      role: 'admin',
      permissions: ['accounting'],
      tenantId,
      accountId,
    };
  }

    async verifySupervisorPin(tenantId: string, pinInput?: string | null, repId?: number | null, queryable?: any, accountId?: string | null): Promise<{
    approved: boolean;
    supervisorId?: number;
    supervisorName?: string;
    supervisorRole?: string;
    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): HOW the approval
    // was given. 'pin' carries no user id (the shared PIN belongs to
    // no single user) — callers must record supervisor_id NULL plus
    // this mode, never fabricate an id; 'account' carries the
    // approving login's id in supervisorId.
    approvalMode?: 'pin' | 'account';
  }> {
    return this.getTripLifecycle().verifySupervisorPin(tenantId, pinInput, repId, queryable, accountId);
  }

    async isSupervisorPinRequiredForSettlement(tenantId: string): Promise<boolean> {
    return this.getTripLifecycle().isSupervisorPinRequiredForSettlement(tenantId);
  }

    async isBlindSettlementEnabled(tenantId: string): Promise<boolean> {
    return this.getTripLifecycle().isBlindSettlementEnabled(tenantId);
  }

  private sortItemsByProductId<T extends { productId: number }>(items: T[]): T[] {
    return sortItemsByProductId(items);
  }

  private async moveVanStock(
    trx: Kysely<Database>,
    params: {
      productId: number;
      delta: number;
      locationId: number;
      branchId?: number | null;
      tenantId: string;
      accountId: string;
      userId?: number | null;
      movementType: string;
      note: string;
      referenceType: string;
      referenceId: number;
      skipGlobalUpdate: boolean;
      unitCost?: number;
    },
  ): Promise<{ scopeBefore: number; scopeAfter: number }> {
    return moveVanStock(trx, params);
  }

  /**
   * INV-VAN-FEFO-BATCHES: the pharmacy batch ledger moves with the pooled
   * van stock. Loading a van carries the earliest-expiry batches from the
   * source location onto the van location (merging into the destination
   * row of the same batch number, exactly like the direct tracked-stock
   * move); unloading carries them back. The move is deliberately soft:
   * it carries whatever batch cover exists at the source location and
   * never throws on a shortfall, so a legacy ledger gap can only block
   * the sale itself (see deductVanSalePharmacyBatches), never the load,
   * the unload, or the settlement. Products with no drug link and no
   * batch rows are untouched.
   */
  private async moveVanPharmacyBatches(
    trx: Kysely<Database>,
    scope: { tenantId: string; accountId: string },
    productId: number,
    qty: number,
    fromLocationId: number,
    toLocationId: number,
  ): Promise<number> {
    const trxAny = trx as any;
    const remaining0 = Number(Number(qty || 0).toFixed(3));
    if (remaining0 <= 0 || fromLocationId === toLocationId) return 0;

    const drug = await trxAny
      .selectFrom('pharmacy_drugs')
      .select('id')
      .where('product_id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const anyBatch = await trxAny
      .selectFrom('pharmacy_batches')
      .select('id')
      .where('product_id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .limit(1)
      .executeTakeFirst();
    if (!drug && !anyBatch) return 0;

    const todayIso = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
    const currentMonthIso = todayIso.slice(0, 7);
    const batches = await trxAny
      .selectFrom('pharmacy_batches')
      .selectAll()
      .where((eb: any) =>
        eb.or([
          eb('product_id', '=', productId),
          eb(
            'drug_id',
            'in',
            trxAny
              .selectFrom('pharmacy_drugs')
              .select('id')
              .where('product_id', '=', productId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`),
          ),
        ]),
      )
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .where('location_id', '=', fromLocationId)
      .where('status', '=', 'active')
      .where('quantity', '>', 0)
      .orderBy('expiry_date', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
      .execute();

    let remaining = remaining0;
    let moved = 0;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const exp = String(batch.expiry_date || '').trim().slice(0, 10);
      if (!exp || (exp.length === 7 ? exp < currentMonthIso : exp < todayIso)) continue;

      const batchQty = Number(batch.quantity || 0);
      const take = Math.min(batchQty, remaining);
      const newQty = Number((batchQty - take).toFixed(3));

      const destRows = await trxAny
        .selectFrom('pharmacy_batches')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', productId)
        .where('location_id', '=', toLocationId)
        .where('batch_number', '=', batch.batch_number)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();
      if (destRows.length > 1) {
        throw new AppError('تشغيلة وجهة مكررة تحتاج مصالحة قبل نقلها لسيارة التوزيع', 'VAN_BATCH_DESTINATION_DUPLICATE', 409);
      }
      if (
        destRows.length === 1 &&
        String(destRows[0].expiry_date).slice(0, 10) !== String(batch.expiry_date).slice(0, 10)
      ) {
        throw new AppError('تاريخ صلاحية التشغيلة يختلف بين المخزنين', 'VAN_BATCH_DESTINATION_EXPIRY', 409);
      }
      if (destRows.length === 1) {
        await trxAny
          .updateTable('pharmacy_batches')
          .set({
            quantity: Number((Number(destRows[0].quantity) + take).toFixed(3)),
            status: 'active',
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', scope.tenantId)
          .where('id', '=', Number(destRows[0].id))
          .execute();
      } else {
        await trxAny
          .insertInto('pharmacy_batches')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            product_id: productId,
            drug_id: batch.drug_id,
            batch_number: batch.batch_number,
            expiry_date: batch.expiry_date,
            quantity: take,
            unit_cost: batch.unit_cost,
            location_id: toLocationId,
            supplier_name: batch.supplier_name,
            status: 'active',
          } as any)
          .execute();
      }

      await trxAny
        .updateTable('pharmacy_batches')
        .set({
          quantity: newQty,
          status: newQty <= 0 ? 'depleted' : 'active',
          updated_at: sql`NOW()`,
        } as any)
        .where('id', '=', Number(batch.id))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();

      remaining = Number((remaining - take).toFixed(3));
      moved = Number((moved + take).toFixed(3));
    }
    return moved;
  }

  /**
   * INV-VAN-FEFO-BATCHES: a field sale deducts the van location's batches
   * earliest-expiry-first, with the same gate, expiry-skip rules, and
   * shortfall error as the shop FEFO deduction. Unlike the load/unload
   * move, the sale FAILS CLOSED on a shortfall: expired stock must never
   * reach a customer through the pooled quantity alone. Callers that
   * must never block (the settlement shortage leg) pass failClosed=false
   * and deduct whatever cover exists. Allocation rows are written by the
   * caller once the sale items exist; this helper only returns them.
   */
  private async deductVanSalePharmacyBatches(
    trx: Kysely<Database>,
    productId: number,
    qty: number,
    scope: { tenantId: string; accountId: string },
    vanLocationId: number,
    failClosed = true,
  ): Promise<Array<{ pharmacyBatchId: number; quantity: number }>> {
    const trxAny = trx as any;
    const drug = await trxAny
      .selectFrom('pharmacy_drugs')
      .select('id')
      .where('product_id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const linkedBatch = await trxAny
      .selectFrom('pharmacy_batches')
      .select('id')
      .where('product_id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!drug && !linkedBatch) return [];

    const todayIso = await resolveBusinessDateKey(trx, scope.tenantId, new Date());
    const currentMonthIso = todayIso.slice(0, 7);
    let remaining = Number(Number(qty || 0).toFixed(3));
    const allocations: Array<{ pharmacyBatchId: number; quantity: number }> = [];
    const batches = await trxAny
      .selectFrom('pharmacy_batches')
      .selectAll()
      .where((eb: any) =>
        eb.or([
          eb('product_id', '=', productId),
          eb(
            'drug_id',
            'in',
            trxAny
              .selectFrom('pharmacy_drugs')
              .select('id')
              .where('product_id', '=', productId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`),
          ),
        ]),
      )
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .where('status', '=', 'active')
      .where('quantity', '>', 0)
      .where((eb: any) =>
        eb.or([eb('location_id', '=', vanLocationId), eb('location_id', 'is', null)]),
      )
      .orderBy('expiry_date', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
      .execute();
    for (const batch of batches) {
      if (remaining <= 0) break;
      const exp = String(batch.expiry_date || '').trim().slice(0, 10);
      if (!exp || (exp.length === 7 ? exp < currentMonthIso : exp < todayIso)) continue;

      const batchQty = Number(batch.quantity || 0);
      const alloc = Math.min(batchQty, remaining);
      const newQty = Number((batchQty - alloc).toFixed(3));
      const nextStatus = newQty <= 0 ? 'depleted' : 'active';

      await trxAny
        .updateTable('pharmacy_batches')
        .set({ quantity: newQty, status: nextStatus, updated_at: sql`NOW()` } as any)
        .where('id', '=', Number(batch.id))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      allocations.push({ pharmacyBatchId: Number(batch.id), quantity: alloc });

      remaining = Number((remaining - alloc).toFixed(3));
    }
    if (remaining > 0 && failClosed) {
      throw new AppError(
        'لا توجد كمية كافية من تشغيلة دوائية سارية الصلاحية في سيارة التوزيع',
        'PHARMACY_FEFO_STOCK_UNAVAILABLE',
        422,
      );
    }
    return allocations;
  }

  async getOrCreateVanLocation(repId: number, tenantId: string, accountId: string): Promise<{ id: number; name: string }> {
    return getOrCreateVanLocation(this.db, repId, tenantId, accountId);
  }

  private async generateDailySequenceNumber(
    trxOrDb: any,
    tableName: string,
    columnName: string,
    prefix: string,
    tenantId: string,
    date = new Date(),
  ): Promise<string> {
    return generateDailySequenceNumber(trxOrDb, this.db, tableName, columnName, prefix, tenantId, date);
  }

    async getActiveTrip(repId: number, tenantId: string, accountId: string): Promise<{
    hasActiveTrip: boolean;
    trip?: VanTripSummary;
    assignedVehicle?: {
      id: number;
      plateNumber: string;
      modelName?: string;
      vehicleType: string;
      currentOdometer: number;
      fuelType: string;
      licenseExpiresAt?: string;
      status: string;
    } | null;
    vanLocation?: { id: number; name: string };
    inventory: VanStockItem[];
    customers: {
      id: number;
      name: string;
      phone?: string;
      address?: string;
      balance: number;
      otherRepsBalance?: number;
      totalCompanyBalance?: number;
      creditLimit?: number;
      customerCode?: string;
      route?: string;
      assignedRepIds?: number[];
      locationUrl?: string;
    }[];
    recentSales: any[];
    sales?: any[];
    collections?: any[];
    returns?: any[];
    swaps?: any[];
    targetMetrics?: RepTargetCalculationResult;
    requireSupervisorPinForSettlement?: boolean;
    isBlindSettlement?: boolean;
  }> {
    return this.getTripLifecycle().getActiveTrip(repId, tenantId, accountId);
  }

    async openTripAndLoad(repId: number, tenantId: string, accountId: string, payload: {
      sourceWarehouseId?: number;
      startOdometer?: number;
      items?: { productId: number; qty: number }[];
      notes?: string;
    }): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    return this.getTripLifecycle().openTripAndLoad(repId, tenantId, accountId, payload);
  }

    async loadSupplementaryStockToActiveTrip(repId: number, tenantId: string, accountId: string, tripId: number, payload: {
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number }[];
      notes?: string;
    }): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    return this.getTripLifecycle().loadSupplementaryStockToActiveTrip(repId, tenantId, accountId, tripId, payload);
  }

  /**
   * Executes a direct field sale in the street from van stock (Cash or Credit).
   */
  async executeFieldSale(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId?: number;
      customerName?: string;
      customerPhone?: string;
      paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
      paidAmount?: number;
      transferReference?: string;
      transferReceiptUrl?: string;
      recipientName?: string;
      recipientPhone?: string;
      recipientRole?: string;
      recipientSignature?: string;
      items: {
        productId: number;
        qty: number;
        unitPrice?: number;
        unitName?: string;
        unitMultiplier?: number;
        isBonus?: boolean;
        bonusReason?: string;
        originalPrice?: number;
      }[];
      notes?: string;
      deliveryGpsLat?: number;
      deliveryGpsLng?: number;
      deliveryProofPhoto?: string;
      packagingBreakdown?: { cartonsCount?: number; piecesCount?: number; itemsCount?: number };
      clientTxId?: string;
      supervisorOverridePin?: string;
      supervisorOverrideReason?: string;
      cashDiscountAmount?: number;
    },
  ): Promise<{
    ok: boolean;
    saleId: number;
    docNo: string;
    total: number;
    subtotal?: number;
    discount?: number;
    paymentMethod: string;
    customerName: string;
    itemsCount: number;
    cashPaid?: number;
    creditOwed?: number;
  }> {
    if (!payload.items || !payload.items.length) {
      throw new AppError('يجب تحديد صنف واحد على الأقل لإصدار الفاتورة', 'EMPTY_SALE_ITEMS', 400);
    }

    const txKey = payload.clientTxId ? `${tenantId}:${payload.tripId}:${payload.clientTxId}` : null;
    const sortedItems = [...payload.items].sort((a, b) => a.productId - b.productId);
    const itemsSig = sortedItems.map((it) => `${it.productId}:${it.qty}:${it.unitPrice ?? 0}`).join('|');
    const fingerprintKey = `${tenantId}:${payload.tripId}:${repId}:${payload.customerId || 'walkin'}:${itemsSig}`;

    // 1. In-flight Promise Deduplication: Await concurrent request and return its result
    if (txKey && VanSalesService.inFlightSalePromises.has(txKey)) {
      return await VanSalesService.inFlightSalePromises.get(txKey)!;
    }
    if (VanSalesService.inFlightSalePromises.has(fingerprintKey)) {
      return await VanSalesService.inFlightSalePromises.get(fingerprintKey)!;
    }

    // 2. Recent In-Memory Cache Deduplication (< 30s for txKey only).
    // INV-VAN-DEDUP-DISTINGUISHING-KEY: a COMPLETED sale is never
    // returned from a fingerprint-keyed cache. The fingerprint
    // (tenant+trip+rep+customer+items signature) identifies a basket,
    // not a submission: two genuinely identical baskets sold seconds
    // apart are two sales. Only the client-supplied clientTxId key
    // (txKey) caches a completed result, backed by the durable
    // [tx:clientTxId] database check below. Concurrent keyless
    // duplicates are still collapsed by the in-flight promise map
    // (step 1), and the 4-second multiset database backstop (step 4)
    // is unchanged.
    const nowMs = Date.now();
    if (txKey && VanSalesService.recentSalesCache.has(txKey)) {
      const entry = VanSalesService.recentSalesCache.get(txKey)!;
      if (nowMs - entry.timestamp < 30000) return entry.result;
    }

    // Register promise IMMEDIATELY (synchronously) before any await call
    const salePromise = (async () => {
      // 3. Database Idempotency Check via [tx:clientTxId]
      if (payload.clientTxId) {
        const existingSale = await this.anyDb
          .selectFrom('sales')
          .select(['id', 'doc_no', 'total', 'payment_type'])
          .where('tenant_id', '=', tenantId)
          .where('van_trip_id', '=', payload.tripId)
          .where('note', 'like', `%[tx:${payload.clientTxId}]%`)
          .executeTakeFirst();

        if (existingSale) {
          return {
            ok: true,
            saleId: Number(existingSale.id),
            docNo: existingSale.doc_no,
            total: Number(existingSale.total),
            paymentMethod: existingSale.payment_type || payload.paymentMethod,
            customerName: payload.customerName || 'عميل نقدي ميداني',
            itemsCount: payload.items.length,
            cashPaid: 0,
            creditOwed: 0,
          };
        }
      }

      // 4. Database Rapid-Fire Duplicate Check (within last 4 seconds for identical trip, rep, customer, and items count)
      const fourSecondsAgo = new Date(Date.now() - 4000);
      const recentDbSale = await this.anyDb
        .selectFrom('sales')
        .select(['id', 'doc_no', 'total', 'payment_type'])
        .where('tenant_id', '=', tenantId)
        .where('van_trip_id', '=', payload.tripId)
        .where('delivery_rep_id', '=', repId)
        .where('customer_id', payload.customerId ? '=' : 'is', payload.customerId ? Number(payload.customerId) : null)
        .where('created_at', '>=', fourSecondsAgo)
        .orderBy('id', 'desc')
        .executeTakeFirst();

      if (recentDbSale) {
        // The backstop must match the fingerprint, not just the line
        // count: comparing only the count merged a genuinely different
        // sale (different products, same number of lines) into the
        // recent one and reported it as created with cashPaid 0. Compare
        // the product/quantity multiset instead. Prices are deliberately
        // excluded: the server may adjust stored unit prices (tiers,
        // offers), so comparing stored prices against raw payload prices
        // would miss true double-taps whose prices were adjusted on the
        // first write; the in-process fingerprint layers already cover
        // the price dimension.
        const dbItems = await this.anyDb
          .selectFrom('sale_items')
          .select(['product_id', 'qty'])
          .where('sale_id', '=', Number(recentDbSale.id))
          .where('tenant_id', '=', tenantId)
          .execute();
        const dbItemsSig = [...dbItems]
          .sort((a: any, b: any) => Number(a.product_id) - Number(b.product_id))
          .map((row: any) => `${Number(row.product_id)}:${Number(row.qty)}`)
          .join('|');
        const payloadItemsSig = sortedItems
          .map((it) => `${Number(it.productId)}:${Number(it.qty)}`)
          .join('|');
        if (dbItemsSig === payloadItemsSig) {
          return {
            ok: true,
            saleId: Number(recentDbSale.id),
            docNo: recentDbSale.doc_no,
            total: Number(recentDbSale.total),
            paymentMethod: recentDbSale.payment_type || payload.paymentMethod,
            customerName: payload.customerName || 'عميل نقدي ميداني',
            itemsCount: payload.items.length,
            cashPaid: 0,
            creditOwed: 0,
          };
        }
      }

      // 5. Execute internal sale
      return await this.executeFieldSaleInternal(repId, tenantId, accountId, payload);
    })();

    if (txKey) VanSalesService.inFlightSalePromises.set(txKey, salePromise);
    VanSalesService.inFlightSalePromises.set(fingerprintKey, salePromise);

    try {
      const result = await salePromise;
      const ts = Date.now();
      // INV-VAN-DEDUP-DISTINGUISHING-KEY: cache the completed result
      // under the clientTxId key only — never under the fingerprint
      // key (see step 2 above).
      if (txKey) VanSalesService.recentSalesCache.set(txKey, { result, timestamp: ts });

      if (VanSalesService.recentSalesCache.size > 200) {
        const threshold = ts - 60000;
        for (const [k, v] of VanSalesService.recentSalesCache.entries()) {
          if (v.timestamp < threshold) VanSalesService.recentSalesCache.delete(k);
        }
      }
      return result;
    } finally {
      if (txKey) VanSalesService.inFlightSalePromises.delete(txKey);
      VanSalesService.inFlightSalePromises.delete(fingerprintKey);
    }
  }

  private async executeFieldSaleInternal(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId?: number;
      customerName?: string;
      customerPhone?: string;
      paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
      paidAmount?: number;
      transferReference?: string;
      transferReceiptUrl?: string;
      recipientName?: string;
      recipientPhone?: string;
      recipientRole?: string;
      recipientSignature?: string;
      items: {
        productId: number;
        qty: number;
        unitPrice?: number;
        unitName?: string;
        unitMultiplier?: number;
        isBonus?: boolean;
        bonusReason?: string;
        originalPrice?: number;
      }[];
      notes?: string;
      deliveryGpsLat?: number;
      deliveryGpsLng?: number;
      deliveryProofPhoto?: string;
      packagingBreakdown?: { cartonsCount?: number; piecesCount?: number; itemsCount?: number };
      clientTxId?: string;
      supervisorOverridePin?: string;
      supervisorOverrideReason?: string;
      cashDiscountAmount?: number;
    },
  ) {
    return this.getFieldSales().executeFieldSaleInternal(repId, tenantId, accountId, payload);
  }

  /**
   * Records a field debt collection from a customer in the street.
   */
  async recordFieldCollection(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId: number;
      amount: number;
      paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';
      transferReference?: string;
      transferReceiptUrl?: string;
      supervisorOverridePin?: string;
      notes?: string;
      gpsLat?: number;
      gpsLng?: number;
      clientTxId?: string;
    },
  ): Promise<{ ok: boolean; receiptNo: string; amount: number; customerName: string; previousBalance: number; newBalance: number }> {
    const amount = Number(payload.amount || 0);
    if (amount <= 0) throw new AppError('المبلغ المحصل يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT', 400);

    const txKey = payload.clientTxId ? `${tenantId}:${payload.tripId}:${payload.clientTxId}` : null;
    // INV-REP-FIELD-COLLECTION-DEDUP-KEYS (B3): the fingerprint must
    // include the payment channel — a cash collection then an
    // instapay collection of the same amount within 5s are two
    // different collections, not a retry. The channel resolves by the
    // same rule the posting uses (omitted method counts as cash), so
    // a true retry (same channel, same everything) still dedups.
    const fingerprintKey = `${tenantId}:${payload.tripId}:${repId}:${payload.customerId}:${amount}:${resolveFieldCollectionChannel(payload.paymentMethod)}`;

    // 1. In-flight Promise Deduplication: Await concurrent request and return its result
    if (txKey && VanSalesService.inFlightCollectionPromises.has(txKey)) {
      return await VanSalesService.inFlightCollectionPromises.get(txKey)!;
    }
    if (VanSalesService.inFlightCollectionPromises.has(fingerprintKey)) {
      return await VanSalesService.inFlightCollectionPromises.get(fingerprintKey)!;
    }

    // 2. Recent In-Memory Cache Deduplication (< 5 seconds for fingerprint, < 30s for txKey)
    const nowMs = Date.now();
    if (txKey && VanSalesService.recentCollectionsCache.has(txKey)) {
      const entry = VanSalesService.recentCollectionsCache.get(txKey)!;
      if (nowMs - entry.timestamp < 30000) return entry.result;
    }
    if (VanSalesService.recentCollectionsCache.has(fingerprintKey)) {
      const entry = VanSalesService.recentCollectionsCache.get(fingerprintKey)!;
      if (nowMs - entry.timestamp < 5000) return entry.result;
    }

    // Register collection promise IMMEDIATELY (synchronously) before any await
    const colPromise = (async () => {
      // INV-REP-FIELD-COLLECTION-MONEY-PRECISION (M10/B6): REJECT — never
      // silently round — a collection amount that does not fit the
      // tenant's money digits, mirroring the general customer-payment
      // path (createCustomerPayment, INVALID_PAYMENT_AMOUNT). Rounding
      // would silently alter the cash the driver actually holds and
      // the amount the customer actually paid, while only the journal
      // rounds (postVanFieldCollection via toBookMoney) — so the
      // payment row, customer balance, trip totals and ledger would
      // disagree with the journal by fractions of a minor unit on
      // every collection. This runs FIRST inside the closure — before
      // the dedup reads and before recordFieldCollectionInternal — so
      // a refused amount writes nothing: no payment row, no balance
      // change, no JE, no trip total. It stays inside the closure
      // (rather than above the promise registration) so concurrent
      // identical requests still register synchronously and dedup.
      const baseCurrency = await tenantBaseCurrency(this.anyDb, tenantId);
      const moneyDigits = currencyMoneyDigits(baseCurrency);
      const scale = 10 ** moneyDigits;
      if (Math.abs(amount * scale - Math.round(amount * scale)) > 0.000001) {
        throw new AppError(
          `Field collection amount must have at most ${moneyDigits} decimal places for the tenant currency (${baseCurrency})`,
          'INVALID_PAYMENT_AMOUNT',
          400,
        );
      }

      // 3. Database Idempotency Check via client_tx_id, falling back to
      // the legacy [tx:clientTxId] note tag for rows written before
      // migration 2040000000268 (whose backfill could not parse a tag).
      if (payload.clientTxId) {
        // INV-REP-FIELD-COLLECTION-DEDUP-KEYS (B8): the client_tx_id
        // lookup is scoped by van_trip_id as well — a customer key
        // reused on a different trip is a NEW collection for that
        // trip, not a replay of the first trip's payment. The legacy
        // note-tag fallback is scoped the same way: an unscoped tag
        // match would leave the same hole open through the fallback.
        const existingByColumn = await this.anyDb
          .selectFrom('customer_payments')
          .select(['id', 'amount', 'note'])
          .where('tenant_id', '=', tenantId)
          .where('customer_id', '=', payload.customerId)
          .where('van_trip_id', '=', payload.tripId)
          .where('client_tx_id', '=', payload.clientTxId)
          .executeTakeFirst();
        const existingPayment = existingByColumn ?? await this.anyDb
          .selectFrom('customer_payments')
          .select(['id', 'amount', 'note'])
          .where('tenant_id', '=', tenantId)
          .where('customer_id', '=', payload.customerId)
          .where('van_trip_id', '=', payload.tripId)
          .where('note', 'like', `%[tx:${payload.clientTxId}]%`)
          .executeTakeFirst();

        if (existingPayment) {
          // INV-REP-FIELD-COLLECTION-DEDUP-KEYS (B7): a dedup replay
          // returns the REAL balances, not 0/0. newBalance is the
          // customer's current balance (re-read here, after the
          // original collection posted); previousBalance is that
          // balance plus the stored payment amount — the balance just
          // before this collection, the same figure the receipt
          // screen derives as newBalance + amount. Exact when no
          // later collection intervened; always a real current
          // balance, never 0/0.
          const cust = await this.anyDb.selectFrom('customers').select(['name', 'balance']).where('id', '=', payload.customerId).where('tenant_id', '=', tenantId).executeTakeFirst();
          const currentBalance = Number(cust?.balance || 0);
          const paidAmount = Number(existingPayment.amount);
          return {
            ok: true,
            receiptNo: existingPayment.note?.match(/#([A-Z0-9-]+)/)?.[1] || 'COL-SYNCED',
            amount: paidAmount,
            customerName: cust?.name || 'العميل',
            previousBalance: currentBalance + paidAmount,
            newBalance: currentBalance,
          };
        }
      }

      // 4. Database Rapid-Fire Duplicate Check (within last 4 seconds for
      // the same trip, rep, customer, channel, and amount). The pre-0268
      // check matched customer + amount only, so a second legitimate
      // collection — another trip, another rep, another channel — inside
      // the window was swallowed and reported as the first collection.
      const twinScope = fieldCollectionPaymentScope({
        tripId: payload.tripId,
        repId,
        paymentMethod: payload.paymentMethod,
        clientTxId: payload.clientTxId,
      });
      const fourSecondsAgo = new Date(Date.now() - 4000);
      const recentDbPayment = await this.anyDb
        .selectFrom('customer_payments')
        .select(['id', 'amount', 'note'])
        .where('tenant_id', '=', tenantId)
        .where('customer_id', '=', payload.customerId)
        .where('van_trip_id', '=', twinScope.van_trip_id)
        .where('rep_id', '=', twinScope.rep_id)
        .where('payment_channel', '=', twinScope.payment_channel)
        .where('amount', '=', amount)
        .where('created_at', '>=', fourSecondsAgo)
        .orderBy('id', 'desc')
        .executeTakeFirst();

      if (recentDbPayment) {
        // INV-REP-FIELD-COLLECTION-DEDUP-KEYS (B7): same real-balance
        // replay as the clientTxId branch above — the stored twin's
        // amount plus the customer's current balance.
        const cust = await this.anyDb.selectFrom('customers').select(['name', 'balance']).where('id', '=', payload.customerId).where('tenant_id', '=', tenantId).executeTakeFirst();
        const currentBalance = Number(cust?.balance || 0);
        const paidAmount = Number(recentDbPayment.amount);
        return {
          ok: true,
          receiptNo: recentDbPayment.note?.match(/#([A-Z0-9-]+)/)?.[1] || 'COL-SYNCED',
          amount: paidAmount,
          customerName: cust?.name || 'العميل',
          previousBalance: currentBalance + paidAmount,
          newBalance: currentBalance,
        };
      }

      // 5. Execute internal collection
      return await this.recordFieldCollectionInternal(repId, tenantId, accountId, payload);
    })();

    if (txKey) VanSalesService.inFlightCollectionPromises.set(txKey, colPromise);
    VanSalesService.inFlightCollectionPromises.set(fingerprintKey, colPromise);

    try {
      const result = await colPromise;
      const ts = Date.now();
      if (txKey) VanSalesService.recentCollectionsCache.set(txKey, { result, timestamp: ts });
      VanSalesService.recentCollectionsCache.set(fingerprintKey, { result, timestamp: ts });

      if (VanSalesService.recentCollectionsCache.size > 200) {
        const threshold = ts - 60000;
        for (const [k, v] of VanSalesService.recentCollectionsCache.entries()) {
          if (v.timestamp < threshold) VanSalesService.recentCollectionsCache.delete(k);
        }
      }
      return result;
    } finally {
      if (txKey) VanSalesService.inFlightCollectionPromises.delete(txKey);
      VanSalesService.inFlightCollectionPromises.delete(fingerprintKey);
    }
  }

  private async recordFieldCollectionInternal(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId: number;
      amount: number;
      paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';
      transferReference?: string;
      transferReceiptUrl?: string;
      supervisorOverridePin?: string;
      notes?: string;
      gpsLat?: number;
      gpsLng?: number;
      clientTxId?: string;
    },
  ) {
    const amount = Number(payload.amount || 0);

    // H9 (D4 + B10): a cash collection is gated on the acting rep's
    // can_collect_cash flag, read on the pool handle before any
    // write. Non-cash channels (instapay / vodafone_cash /
    // bank_transfer — resolved by the same channel rule the posting
    // uses, so an omitted paymentMethod counts as cash) are
    // unaffected: they keep the existing supervisor-PIN + reference
    // evidence gate below. The refusal happens before the trip and
    // customer reads, so a forbidden rep learns nothing about the
    // trip or customer from the attempt.
    if (resolveFieldCollectionChannel(payload.paymentMethod) === 'cash') {
      const repFlags = await loadRepPermissions(this.anyDb, tenantId, repId);
      if (!repFlags.can_collect_cash) {
        await this.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          tripId: payload.tripId,
          customerId: payload.customerId,
          eventCode: 'VAN_SUSPICION_CASH_COLLECTION_FLAG',
          severity: 'high',
          titleAr: 'محاولة تحصيل نقدي بدون صلاحية تحصيل نقدي (can_collect_cash مغلقة)',
          detailsAr: `حاول المندوب تحصيل مبلغ نقدي بقيمة ${amount} ج.م رغم أن صلاحية التحصيل النقدي (can_collect_cash) مغلقة له.`,
          attemptedAmount: amount,
        });
        throw new AppError(
          'صلاحية التحصيل النقدي (can_collect_cash) مغلقة لهذا المندوب، فلا يمكنه تحصيل نقدية ميدانياً',
          'REP_CANNOT_COLLECT_CASH',
          403,
        );
      }
    }

    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .select(['vt.id', 'vt.status', 'vt.settlement_status', 'vt.van_location_id', 'van.branch_id as vanBranchId'])
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .executeTakeFirst();

    if (!trip || trip.status !== 'open') throw new AppError('رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل تحصيل جديد عليها', 'INVALID_TRIP', 400);

    const cust = await this.anyDb.selectFrom('customers').select(['id', 'name']).where('id', '=', payload.customerId).where('tenant_id', '=', tenantId).executeTakeFirst();
    if (!cust) throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);

    let branchId = trip.vanBranchId ? Number(trip.vanBranchId) : null;
    let vanLocId = trip.van_location_id ? Number(trip.van_location_id) : null;
    let receiptNo = '';
    let finalBalance = 0;
    let repPreviousBalance = 0;
    let repNewBalance = 0;

    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the posting identity
    // and the audit actor are resolved here, on the pool handle
    // BEFORE the transaction starts (P2 pattern — same hoist as the
    // field sale above). The posting identity prefers the acting
    // rep's linked login over the tenant's first active user.
    const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId, repId);
    const auditActor = await resolveVanMoneyAuditActor(this.anyDb, tenantId, repId);

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the trip read above runs on
      // an unlocked handle, so a trip settled between it and this
      // transaction would still collect cash into a closed trip.
      // Re-read the governing row under lock FIRST, before the
      // customer lock and any other work, and collect only from the
      // locked row's location/branch.
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id', 'van_location_id', 'status'])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip || lockedTrip.status !== 'open') {
        throw new AppError('رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل تحصيل جديد عليها', 'INVALID_TRIP', 400);
      }
      vanLocId = lockedTrip.van_location_id ? Number(lockedTrip.van_location_id) : null;
      const lockedVanLocRow = vanLocId
        ? await trxAny
          .selectFrom('stock_locations')
          .select(['branch_id'])
          .where('id', '=', vanLocId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst()
        : null;
      const lockedBranchId = lockedVanLocRow?.branch_id ? Number(lockedVanLocRow.branch_id) : null;
      branchId = lockedBranchId;

      // INV-VAN-FIELD-NONCASH-EVIDENCE-GATE: a non-cash field
      // collection (instapay / vodafone_cash / bank_transfer) is
      // posted straight to bank 1120 by postVanFieldCollection, so
      // it needs the same evidence as a card sale — supervisor PIN
      // + a transfer reference of at least 3 chars — or it is
      // refused here, inside the same transaction and after the
      // locked-trip recheck above, before any balance moves. Cash
      // collections are untouched: the cash stays in rep custody
      // until settleTrip. The gate is evaluateFieldCardPayment
      // itself, not a second copy of it; only the PIN is verified
      // first (on this transaction handle, never the pool — a pool
      // read inside the open transaction deadlocks on PGlite).
      const isNonCashCollection =
        payload.paymentMethod === 'instapay' ||
        payload.paymentMethod === 'vodafone_cash' ||
        payload.paymentMethod === 'bank_transfer';
      if (isNonCashCollection && amount > 0) {
        let collectionSupervisorApproved = false;
        let collectionSupervisorId: number | null = null;
        let collectionSupervisorName = '';
        if (payload.supervisorOverridePin) {
          const pinVerification = await this.verifySupervisorPin(
            tenantId,
            payload.supervisorOverridePin,
            repId,
            trxAny,
            accountId,
          );
          collectionSupervisorApproved = pinVerification.approved;
          collectionSupervisorId = pinVerification.supervisorId ?? null;
          collectionSupervisorName = pinVerification.supervisorName ?? '';
        }
        const evidenceCheck = evaluateFieldCardPayment({
          totalSaleAmount: amount,
          referenceReason: payload.transferReference || payload.notes,
          supervisorOverride: collectionSupervisorApproved
            ? {
                approved: true,
                supervisorId: collectionSupervisorId || undefined,
                supervisorName: collectionSupervisorName,
                // No invented fallback here: a collection settles a
                // pre-existing customer debt straight to bank 1120,
                // so the reference is the only audit trail tying the
                // bank receipt to the customer — it must be a real
                // transfer reference (or note) of at least 3 chars.
                reason: payload.transferReference || payload.notes || undefined,
              }
            : undefined,
        });
        if (!evidenceCheck.allowed) {
          await this.vanFraudRadarService.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: payload.customerId,
            customerName: cust.name,
            eventCode: 'VAN_SUSPICION_FAKE_ELECTRONIC_COLLECTION',
            severity: 'critical',
            titleAr: 'محاولة تسجيل تحصيل إلكتروني وهمي بدون اعتماد مشرف أو رقم إيصال',
            detailsAr: `حاول المندوب تسجيل تحصيل بقيمة ${amount} ج.م كدفع إلكتروني (${payload.paymentMethod}) لتجنب مطالبته بتوريد الكاش بالتصفية، دون اعتماد مشرف أو رقم مرجع تحويل.`,
            attemptedAmount: amount,
          });
          throw new AppError(
            evidenceCheck.errorMessageAr || 'التحصيل الإلكتروني في الميدان يتطلب اعتماد المشرف ورقم مرجع التحويل',
            evidenceCheck.reasonCode || 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN',
            403,
          );
        }
      }

      const lockedCust = await trxAny
        .selectFrom('customers')
        .select(['id', 'name', 'balance', 'metadata'])
        .where('id', '=', payload.customerId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedCust) {
        throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);
      }

      // Security Invariant: Geofence Audit on Collections
      if (payload.gpsLat != null && payload.gpsLng != null) {
        let custMeta: any = {};
        if (typeof lockedCust.metadata === 'string') {
          try { custMeta = JSON.parse(lockedCust.metadata); } catch { custMeta = {}; }
        } else if (lockedCust.metadata && typeof lockedCust.metadata === 'object') {
          custMeta = lockedCust.metadata;
        }
        const custCoords = extractCoordinatesFromCustomerLocation({
          metadata: custMeta,
          locationUrl: (lockedCust as any).location_url || custMeta?.location_url || custMeta?.locationUrl,
        });
        if (custCoords && isValidCoordinatePair(custCoords.lat, custCoords.lng)) {
          const geo = evaluateGeofenceCompliance({
            repLat: Number(payload.gpsLat),
            repLng: Number(payload.gpsLng),
            customerLat: custCoords.lat,
            customerLng: custCoords.lng,
            maxAllowedMeters: 200,
          });
          if (geo.status === 'outside_geofence' || geo.isCompliant === false) {
            await this.vanFraudRadarService.recordSuspicionEvent({
              tenantId,
              accountId,
              repId,
              tripId: payload.tripId,
              customerId: payload.customerId,
              customerName: lockedCust.name,
              eventCode: 'VAN_SUSPICION_GEOFENCE_VIOLATION',
              severity: 'high',
              titleAr: 'تحصيل نقدية خارج النطاق الجغرافي لدكان العميل',
              detailsAr: `قام المندوب بتسجيل سند تحصيل بقيمة ${amount} ج.م للعميل "${lockedCust.name}" وهو يبعد مسافة (${geo.distanceMeters} متر) عن موقع المحل المسجل (المسموح ${geo.maxAllowedMeters}م).`,
              amountInvolved: amount,
              metadata: {
                distanceMeters: geo.distanceMeters,
                maxAllowedMeters: geo.maxAllowedMeters,
                repLat: payload.gpsLat,
                repLng: payload.gpsLng,
                customerLat: custCoords.lat,
                customerLng: custCoords.lng,
              },
            });
          }
        }
      }

      const currentCompanyBalance = Number(lockedCust.balance || 0);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
      const repBalancesMap = await getCustomerRepBalancesMap(trxAny, tenantId, {
        customerIds: [payload.customerId],
        customerTotalBalances: { [payload.customerId]: currentCompanyBalance },
        moneyDigits,
      });

      const assignedRepIds = extractAssignedRepIds(lockedCust.metadata);
      const isolated = resolveIsolatedRepCustomerBalance({
        repId: Number(repId),
        breakdown: repBalancesMap.get(payload.customerId),
        assignedRepIds,
        fallbackTotalBalance: currentCompanyBalance,
        moneyDigits,
      });

      const validation = validateIsolatedRepCollection({
        repId: Number(repId),
        collectionAmount: amount,
        repBalance: isolated.repBalance,
        otherRepsBalance: isolated.otherRepsBalance,
        totalCustomerBalance: isolated.totalCustomerBalance,
        moneyDigits,
      });

      if (!validation.allowed) {
        await this.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          tripId: payload.tripId,
          customerId: payload.customerId,
          customerName: String(lockedCust.name || cust.name || ''),
          eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_CROSS_REP_COLLECTION,
          severity: 'high',
          titleAr: 'محاولة تحصيل مديونية تخص مندوباً آخر على عميل مشترك',
          detailsAr:
            validation.errorMessage ||
            `حاول المندوب تحصيل مبلغ (${amount}) من العميل "${lockedCust.name}" بينما رصيده المعزول لدى العميل (${isolated.repBalance}) ومديونية المناديب الآخرين (${isolated.otherRepsBalance}).`,
          amountInvolved: amount,
          metadata: {
            repBalance: isolated.repBalance,
            otherRepsBalance: isolated.otherRepsBalance,
            totalCustomerBalance: isolated.totalCustomerBalance,
            errorCode: validation.errorCode,
          },
        });
        throw new AppError(
          validation.errorMessage || 'لا يمكن تحصيل مديونية تخص مندوباً آخر',
          validation.errorCode || 'REP_ISOLATED_BALANCE_EXCEEDED',
          422,
        );
      }

      repPreviousBalance = validation.repPreviousBalance;
      repNewBalance = validation.repNewBalance;

      const updatedCust = await trxAny
        .updateTable('customers')
        .set({ balance: sql`COALESCE(balance, 0) - ${amount}`, updated_at: sql`NOW()` })
        .where('id', '=', payload.customerId)
        .where('tenant_id', '=', tenantId)
        .returning(['balance'])
        .executeTakeFirst();
      finalBalance = Number(updatedCust?.balance || 0);

      // INV-REP-COLLECTION-TOTAL-BALANCE-CAP (defence in depth): the
      // engine gate above refuses any collection above the customer's
      // total debt, so this must never fire — but the write itself must
      // never commit a negative customer balance even if a future
      // caller reaches it without the gate. Throwing here rolls the
      // whole collection transaction back. The comparison is at book
      // digits so a sub-minor-unit residue in a legacy balance cannot
      // refuse a collection the gate allowed.
      if (roundMoney(finalBalance, moneyDigits) < 0) {
        throw new AppError(
          `لا يمكن تحصيل مبلغ (${amount} ج.م) من العميل "${lockedCust.name}" أكبر من مديونية العميل — الرصيد بعد التحصيل سالب (${finalBalance} ج.م)`,
          'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE',
          422,
        );
      }

      const isInstapayCollection = payload.paymentMethod === 'instapay' || payload.paymentMethod === 'vodafone_cash' || payload.paymentMethod === 'bank_transfer';
      const defaultColNote = isInstapayCollection
        ? `سند تحصيل إلكتروني (${payload.paymentMethod === 'vodafone_cash' ? 'فودافون كاش' : 'إنستاباي/تحويل'}) بواسطة المندوب`
        : `سند تحصيل نقدي ميداني بواسطة المندوب`;

      const insertedPayment = await trxAny
        .insertInto('customer_payments')
        .values({
          customer_id: payload.customerId,
          amount: amount,
          note: payload.notes || defaultColNote,
          transfer_reference: payload.transferReference || null,
          transfer_receipt_url: payload.transferReceiptUrl || null,
          tenant_id: tenantId,
          account_id: accountId,
          ...fieldCollectionPaymentScope({
            tripId: payload.tripId,
            repId,
            paymentMethod: payload.paymentMethod,
            clientTxId: payload.clientTxId,
          }),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      receiptNo = await this.generateDailySequenceNumber(trxAny, 'customer_payments', 'note', 'COL', tenantId);
      const finalNote = payload.clientTxId
        ? `${payload.notes || defaultColNote} (#${receiptNo}) [tx:${payload.clientTxId}]`
        : payload.notes || `${defaultColNote} (#${receiptNo})`;

      await trxAny
        .updateTable('customer_payments')
        .set({ note: finalNote })
        .where('id', '=', insertedPayment.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trxAny
        .insertInto('customer_ledger')
        .values({
          customer_id: payload.customerId,
          entry_type: 'payment',
          amount: -amount,
          balance_after: finalBalance,
          note: finalNote,
          reference_type: 'van_collection',
          reference_id: payload.tripId,
          van_trip_id: payload.tripId,
          gps_lat: payload.gpsLat != null ? Number(payload.gpsLat) : null,
          gps_lng: payload.gpsLng != null ? Number(payload.gpsLng) : null,
          tenant_id: tenantId,
          account_id: accountId,
        })
        .execute();

      if (isInstapayCollection) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            total_instapay_collections: sql`total_instapay_collections + ${amount}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            cash_collected: sql`cash_collected + ${amount}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // The cash just collected is with the rep, not the till, until settleTrip — this only moves
      // the debt off the customer's receivable and into the same pooled bucket postVanTripSettlement
      // later clears against real cash.
      await this.accountingPosting.postVanFieldCollection(
        trx,
        Number(insertedPayment.id),
        { amount, customerId: payload.customerId, branchId, locationId: vanLocId, paymentMethod: payload.paymentMethod || 'cash', transferReference: payload.transferReference },
        systemAuth,
      );

      // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): one audit row per
      // field collection, in this same transaction — a rolled-back
      // collection leaves no audit trace, and a committed one always
      // has one. Replays return before this internal method runs, so
      // a retried collection writes no second row. The actor is the
      // collecting rep's linked login (resolved before the
      // transaction above); a rep with no linked login records
      // created_by null and is named in the details. The
      // function-check guards harnesses that pass a `{}` audit stub.
      if (this.audit && typeof this.audit.logWithExecutor === 'function') {
        await this.audit.logWithExecutor(
          trx,
          'تحصيل ميداني',
          `حصّل المندوب ${auditActor.repName} (#${Number(repId)}) مبلغ ${amount} (${resolveFieldCollectionChannel(payload.paymentMethod)}) من العميل ${cust.name} (#${Number(payload.customerId)}) على الرحلة #${Number(payload.tripId)} — إيصال ${receiptNo}، الرصيد ${repPreviousBalance} ← ${repNewBalance}`,
          { userId: auditActor.userId, tenantId, accountId },
          { eventCode: AUDIT_EVENT_CODES.VAN_FIELD_COLLECTION },
        );
      }
    });

    return {
      ok: true,
      receiptNo,
      amount,
      customerName: cust.name,
      previousBalance: repPreviousBalance,
      newBalance: repNewBalance,
    };
  }

  /**
   * Instant Field Damaged / Broken Goods Swap (استبدال التالف والمعيب الفوري في الميدان).
   * Swaps damaged/crushed/expired goods on the spot from the vehicle.
   * Decrements replacement product stock from van, increments damaged stock in van,
   * calculates any price variance, and updates customer balance if customer has an account.
   */
  async executeDamagedSwap(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId?: number;
      damagedProductId: number;
      damagedQty: number;
      damageReason?: string;
      replacementProductId: number;
      replacementQty: number;
      notes?: string;
      clientTxId?: string;
    },
  ): Promise<{
    ok: boolean;
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }> {
    // INV-VAN-DAMAGED-SWAP-JOURNAL-QUARANTINE: idempotent replay
    // BEFORE the trip-open check — a retry may arrive after the trip
    // closed, and it must return the original swap, not INVALID_TRIP.
    if (payload.clientTxId) {
      const prior = await this.findSwapByClientTxId(this.anyDb, tenantId, payload.tripId, payload.clientTxId);
      if (prior) return this.buildDamagedSwapResult(this.anyDb, tenantId, prior);
    }

    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .select(['vt.id', 'vt.status', 'vt.van_location_id', 'vt.source_warehouse_id'])
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .executeTakeFirst();

    if (!trip || trip.status !== 'open') {
      throw new AppError('رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل استبدال عليها', 'INVALID_TRIP', 400);
    }

    // Resolved on the pool handle BEFORE the transaction: the journal
    // posts on the tx handle, and a pool read inside an open PGlite
    // transaction waits forever on the single connection.
    const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId);

    const damagedPid = Number(payload.damagedProductId);
    const replacementPid = Number(payload.replacementProductId);
    const damagedQty = Number(payload.damagedQty || 0);
    const replacementQty = Number(payload.replacementQty || 0);

    if (damagedQty <= 0 || replacementQty <= 0) {
      throw new AppError('كمية التالف وكمية البديل يجب أن تكون أكبر من الصفر', 'INVALID_QUANTITY', 400);
    }

    let createdSwapId = 0;
    let damagedProdName = '';
    let replacementProdName = '';
    let priceDiff = 0;
    // Set inside the transaction when the in-tx replay check finds the
    // original swap (race window between the pre-tx check and this tx).
    let replayedSwap: any = null;

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      // Book digits resolved once on THIS transaction handle (D4).
      const bookDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));

      // Lock the trip row FIRST: it serializes concurrent swaps and
      // retries on this trip, so the in-tx idempotency check below
      // cannot race a twin transaction (a FOR UPDATE read that finds
      // zero rows locks nothing — the trip row always exists here).
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id', 'status', 'van_location_id', 'source_warehouse_id'])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip || lockedTrip.status !== 'open') {
        throw new AppError('رحلة التوزيع المحددة مغلقة أو تمت تصفيتها، ولا يمكن تسجيل استبدال عليها', 'INVALID_TRIP', 400);
      }
      if (payload.clientTxId) {
        const priorInTx = await this.findSwapByClientTxId(trxAny, tenantId, payload.tripId, payload.clientTxId);
        if (priorInTx) {
          replayedSwap = priorInTx;
          return;
        }
      }
      const vanLocationId = Number(lockedTrip.van_location_id);

      // Canonical Lock Order: sort product IDs ascending to prevent deadlock
      const sortedProductIds = [damagedPid, replacementPid].sort((a, b) => a - b);
      const lockedProds = await trxAny
        .selectFrom('products')
        .select(['id', 'name', 'retail_price', 'wholesale_price', 'cost_price'])
        .where('id', 'in', sortedProductIds)
        .where('tenant_id', '=', tenantId)
        .orderBy('id', 'asc')
        .forUpdate()
        .execute();

      const damagedProd = lockedProds.find((p: any) => Number(p.id) === damagedPid);
      const replacementProd = lockedProds.find((p: any) => Number(p.id) === replacementPid);

      if (!damagedProd) throw new AppError(`الصنف التالف #${damagedPid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
      if (!replacementProd) throw new AppError(`الصنف البديل #${replacementPid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);

      damagedProdName = damagedProd.name || `صنف #${damagedPid}`;
      replacementProdName = replacementProd.name || `صنف #${replacementPid}`;

      // Check current van stock for replacement product
      const vanStockRow = await trxAny
        .selectFrom('product_location_stock')
        .select([sql<number>`cast(coalesce(qty, 0) as numeric)`.as('qty')])
        .where('location_id', '=', vanLocationId)
        .where('product_id', '=', replacementPid)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      const availableVanStock = Number(vanStockRow?.qty || 0);

      const damagedPrice = Number(damagedProd.retail_price || damagedProd.wholesale_price || 0);
      const replacementPrice = Number(replacementProd.retail_price || replacementProd.wholesale_price || 0);

      const evalResult = evaluateDamagedSwap({
        damagedProductId: damagedPid,
        damagedQty,
        damagedUnitPrice: damagedPrice,
        damageReason: payload.damageReason || 'تالف / كسر أثناء التوزيع',
        replacementProductId: replacementPid,
        replacementQty,
        replacementUnitPrice: replacementPrice,
        availableVanStockQty: availableVanStock,
        moneyDigits: bookDigits,
      });

      if (!evalResult.allowed) {
        throw new AppError(evalResult.errorMessageAr || 'تعذر إتمام عملية الاستبدال', evalResult.reasonCode || 'SWAP_REJECTED', 400);
      }

      priceDiff = evalResult.priceDifference;

      // INV-VAN-DAMAGED-SWAP-JOURNAL-QUARANTINE: the damaged qty must
      // NOT return to sellable van stock — mirror the returns path
      // (postVanFieldReturn isDamaged leg / van-returns.service.ts),
      // which routes damaged items to the tenant's damaged location.
      // Fail closed when the tenant has none: silently leaving the
      // damaged qty sellable in the van is worse than refusing the
      // swap. The van itself is never a quarantine target.
      const damagedLoc = await trxAny
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('location_type', '=', 'damaged')
        .where('id', '!=', vanLocationId)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      if (!damagedLoc?.id) {
        throw new AppError('لا يوجد موقع تالف مسجّل لهذا النشاط — سجّل موقع مخزون تالف قبل تنفيذ الاستبدال حتى لا يعود التالف مخزوناً قابلاً للبيع', 'SWAP_REJECTED', 400);
      }
      const damagedLocationId = Number(damagedLoc.id);
      const vanLocRow = await trxAny
        .selectFrom('stock_locations')
        .select(['branch_id'])
        .where('id', '=', vanLocationId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;

      // Deduct replacement stock from van
      await this.moveVanStock(trx, {
        productId: replacementPid,
        delta: -replacementQty,
        locationId: vanLocationId,
        tenantId,
        accountId,
        userId: null,
        movementType: 'van_swap_out',
        note: `استبدال تالف فوري - صرف البديل (${replacementProdName})`,
        referenceType: 'van_sales_trip',
        referenceId: Number(trip.id),
        skipGlobalUpdate: false,
        unitCost: Number(replacementProd.cost_price || 0),
      });

      // Receive damaged stock into the QUARANTINE (damaged) location —
      // never back into the van as sellable stock.
      await this.moveVanStock(trx, {
        productId: damagedPid,
        delta: damagedQty,
        locationId: damagedLocationId,
        tenantId,
        accountId,
        userId: null,
        movementType: 'van_swap_damaged_in',
        note: `استبدال تالف فوري - استلام التالف (${damagedProdName}) إلى موقع التالف [${payload.damageReason || 'كسر/تالف'}]`,
        referenceType: 'van_sales_trip',
        referenceId: Number(trip.id),
        skipGlobalUpdate: false,
        unitCost: Number(damagedProd.cost_price || 0),
      });

      // Record swap row in van_damaged_swaps FIRST: the journal and the
      // ledger row both key on the swap id, never on the trip id.
      const inserted = await trxAny
        .insertInto('van_damaged_swaps')
        .values({
          trip_id: payload.tripId,
          rep_id: repId,
          customer_id: payload.customerId || null,
          damaged_product_id: damagedPid,
          damaged_qty: damagedQty,
          damage_reason: payload.damageReason || 'تالف / كسر أثناء التوزيع',
          replacement_product_id: replacementPid,
          replacement_qty: replacementQty,
          price_difference: priceDiff,
          notes: payload.clientTxId
            ? `${payload.notes || ''} [tx:${payload.clientTxId}]`.trim()
            : payload.notes || null,
          tenant_id: tenantId,
          account_id: accountId,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      createdSwapId = Number(inserted.id);

      // If price difference exists and customer is specified, record difference in customer ledger
      if (priceDiff !== 0 && payload.customerId) {
        const custRecord = await trxAny
          .selectFrom('customers')
          .select(['id', 'balance'])
          .where('id', '=', payload.customerId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (custRecord) {
          const updatedCust = await trxAny
            .updateTable('customers')
            .set({
              balance: sql`coalesce(balance, 0) + ${priceDiff}`,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', payload.customerId)
            .where('tenant_id', '=', tenantId)
            .returning(['balance'])
            .executeTakeFirst();

          await trxAny
            .insertInto('customer_ledger')
            .values({
              customer_id: payload.customerId,
              // 'sale_credit' mislabels this row as a credit sale (trip
              // counters read sale_credit rows as sales); a swap price
              // adjustment is its own kind, and its GL mirror is the
              // 1130 leg of the van_damaged_swap journal below.
              entry_type: 'swap_price_adjustment',
              amount: priceDiff,
              balance_after: Number(updatedCust?.balance || 0),
              note: `فارق سعر استبدال تالف #${createdSwapId}: ${replacementProdName} بدلاً من ${damagedProdName}`,
              reference_type: 'van_swap',
              reference_id: createdSwapId,
              van_trip_id: payload.tripId,
              tenant_id: tenantId,
              account_id: accountId,
            })
            .execute();
        }
      }

      // The balanced GL journal for the whole swap — same transaction
      // as the stock moves, so a failure anywhere rolls everything
      // back together. The journal's 1130 leg mirrors the ledger row
      // above; with no customer there is no receivable leg to mirror.
      await this.accountingPosting.postVanDamagedSwap(
        trx,
        createdSwapId,
        {
          damagedQty,
          damagedUnitCost: Number(damagedProd.cost_price || 0),
          replacementQty,
          replacementUnitCost: Number(replacementProd.cost_price || 0),
          priceDifference: priceDiff,
          customerId: payload.customerId || null,
          branchId,
          locationId: vanLocationId,
          damagedLocationId,
        },
        systemAuth,
      );
    });

    // A twin transaction won the race and this tx replayed: return the
    // original swap, never a second execution.
    if (replayedSwap) {
      return this.buildDamagedSwapResult(this.anyDb, tenantId, replayedSwap);
    }

    return {
      ok: true,
      swapId: createdSwapId,
      damagedProductName: damagedProdName,
      replacementProductName: replacementProdName,
      damagedQty,
      replacementQty,
      priceDifference: priceDiff,
      messageAr: this.damagedSwapMessageAr(damagedQty, damagedProdName, replacementQty, replacementProdName, priceDiff),
    };
  }

  /**
   * Idempotency lookup for damaged swaps. There is no client_tx_id
   * column on van_damaged_swaps (migration 0315 deliberately adds
   * none): the `[tx:clientTxId]` tag in notes is the durable key, the
   * same pattern recordFieldSale uses for sales. `strpos` (not LIKE)
   * makes the match exact — a clientTxId containing LIKE wildcards
   * cannot match a different swap. Callers serialize on the trip row
   * FOR UPDATE before the in-transaction check, so the check is the
   * atomic guard; the swap journal's unique (source_type, source_id)
   * is the second backstop.
   */
  private async findSwapByClientTxId(db: any, tenantId: string, tripId: number, clientTxId: string): Promise<any> {
    const tag = `[tx:${clientTxId}]`;
    return db
      .selectFrom('van_damaged_swaps')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('trip_id', '=', tripId)
      .where(sql<boolean>`strpos(coalesce(notes, ''), ${tag}) > 0`)
      .orderBy('id', 'asc')
      .executeTakeFirst();
  }

  private damagedSwapMessageAr(
    damagedQty: number,
    damagedProdName: string,
    replacementQty: number,
    replacementProdName: string,
    priceDiff: number,
  ): string {
    const diffNote = priceDiff > 0
      ? ` وفارق سعر مستحق على العميل قدره ${priceDiff.toFixed(2)} ج.م`
      : priceDiff < 0
      ? ` وفارق سعر مستحق لصالح العميل قدره ${Math.abs(priceDiff).toFixed(2)} ج.م`
      : ' (استبدال متكافئ 1 لـ 1 بدون فارق سعري)';
    return `تم استبدال ${damagedQty} من (${damagedProdName}) بـ ${replacementQty} من (${replacementProdName}) بنجاح${diffNote}`;
  }

  private async buildDamagedSwapResult(db: any, tenantId: string, row: any): Promise<{
    ok: boolean;
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }> {
    const prodRows = await db
      .selectFrom('products')
      .select(['id', 'name'])
      .where('id', 'in', [Number(row.damaged_product_id), Number(row.replacement_product_id)])
      .where('tenant_id', '=', tenantId)
      .execute();
    const byId = new Map(prodRows.map((p: any) => [Number(p.id), p.name]));
    const damagedQty = Number(row.damaged_qty || 0);
    const replacementQty = Number(row.replacement_qty || 0);
    const priceDifference = Number(row.price_difference || 0);
    const damagedProdName = String(byId.get(Number(row.damaged_product_id)) || `صنف #${Number(row.damaged_product_id)}`);
    const replacementProdName = String(byId.get(Number(row.replacement_product_id)) || `صنف #${Number(row.replacement_product_id)}`);
    return {
      ok: true,
      swapId: Number(row.id),
      damagedProductName: damagedProdName,
      replacementProductName: replacementProdName,
      damagedQty,
      replacementQty,
      priceDifference,
      messageAr: this.damagedSwapMessageAr(damagedQty, damagedProdName, replacementQty, replacementProdName, priceDifference),
    };
  }

  /**
   * Lists all damaged goods swaps performed on a trip.
   */
  /**
   * INV-DRIVER-PORTAL-REP-SCOPED-READS: rep scoping for driver-portal
   * reads. The trip row owns the read: a rep may only read trip data for
   * trips whose rep_id is his own. Staff callers pass no repId and skip
   * the check (the supervisor view behind a staff session).
   */
  private async assertTripOwnedByRep(tenantId: string, tripId: number, repId: number): Promise<void> {
    const trip = await this.anyDb
      .selectFrom('van_sales_trips')
      .select(['id', 'rep_id'])
      .where('id', '=', tripId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!trip) {
      throw new AppError('الرحلة غير موجودة', 'TRIP_NOT_FOUND', 404);
    }
    if (Number((trip as any).rep_id) !== Number(repId)) {
      throw new AppError('غير مصرح لك بالاطلاع على بيانات رحلة مندوب آخر', 'FORBIDDEN', 403);
    }
  }

  /**
   * INV-REP-SCOPED-CUSTOMER-READS (H7/D1+D14): the customer ids this rep
   * has served. One canonical definition, shared by the read scope
   * (getActiveTrip / getDriverTodayItinerary) and the read gate below:
   * a field visit on one of his trips, a pre-sale order assigned to
   * him, or a delivered sale carrying his delivery_rep_id. There is no
   * static customer-to-rep assignment in the schema, so history is the
   * association — plus the explicit metadata assignment, which the
   * callers check separately via extractAssignedRepIds.
   */
  private async listRepServedCustomerIds(tenantId: string, repId: number): Promise<Set<number>> {
    const ids = new Set<number>();
    const collect = (rows: any[]): void => {
      for (const row of rows || []) {
        const id = Number((row as any).customer_id ?? (row as any).customerId);
        if (Number.isInteger(id) && id > 0) ids.add(id);
      }
    };
    const [visits, orders, sales] = await Promise.all([
      this.anyDb
        .selectFrom('van_field_visits')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .execute(),
      this.anyDb
        .selectFrom('sales_orders')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .execute(),
      this.anyDb
        .selectFrom('sales')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('delivery_rep_id', '=', repId)
        .execute(),
    ]);
    collect(visits);
    collect(orders);
    collect(sales);
    return ids;
  }

  /**
   * INV-DRIVER-PORTAL-REP-SCOPED-READS: a rep may read a customer's
   * field statement and last sold prices only when the codebase already
   * records him serving that customer: a field visit on one of his
   * trips, a pre-sale order assigned to him, or a delivered sale
   * carrying his delivery_rep_id. There is no static customer-to-rep
   * assignment in the schema, so history is the association. Staff
   * callers pass no repId and skip the check.
   */
  private async assertRepServedCustomer(tenantId: string, repId: number, customerId: number): Promise<void> {
    const served = await this.listRepServedCustomerIds(tenantId, repId);
    if (served.has(Number(customerId))) return;
    throw new AppError('غير مصرح لك بالاطلاع على بيانات عميل لا يتبع لك', 'FORBIDDEN', 403);
  }

  async listTripDamagedSwaps(tenantId: string, tripId: number, repId?: number) {
    if (repId != null) {
      await this.assertTripOwnedByRep(tenantId, tripId, repId);
    }
    return this.anyDb
      .selectFrom('van_damaged_swaps as vds')
      .leftJoin('products as dp', 'dp.id', 'vds.damaged_product_id')
      .leftJoin('products as rp', 'rp.id', 'vds.replacement_product_id')
      .leftJoin('customers as c', 'c.id', 'vds.customer_id')
      .select([
        'vds.id',
        'vds.trip_id as tripId',
        'vds.rep_id as repId',
        'vds.customer_id as customerId',
        sql<string>`coalesce(c.name, 'عميل ميداني')`.as('customerName'),
        'vds.damaged_product_id as damagedProductId',
        sql<string>`coalesce(dp.name, 'صنف تالف')`.as('damagedProductName'),
        sql<number>`cast(vds.damaged_qty as numeric)`.as('damagedQty'),
        'vds.damage_reason as damageReason',
        'vds.replacement_product_id as replacementProductId',
        sql<string>`coalesce(rp.name, 'صنف بديل')`.as('replacementProductName'),
        sql<number>`cast(vds.replacement_qty as numeric)`.as('replacementQty'),
        sql<number>`cast(vds.price_difference as numeric)`.as('priceDifference'),
        'vds.notes',
        'vds.created_at as createdAt',
      ])
      .where('vds.trip_id', '=', tripId)
      .where('vds.tenant_id', '=', tenantId)
      .orderBy('vds.id', 'desc')
      .execute();
  }

  // recordFieldReturn (the original immediate, unapproved return path) was removed: it wrote stock
  // and the customer's ledger straight away with no review step at all, while submitFieldReturn below
  // parks the same action at status='pending_approval' until a manager calls approveFieldReturn. Both
  // were reachable from the driver portal at once — POST /returns bypassed the approval gate entirely,
  // so a driver (or a stale app build) could still skip it completely. Removed rather than kept
  // alongside, since the whole point of the approval workflow is that no return posts unreviewed.

    async submitTripSettlement(repId: number, tenantId: string, accountId: string, payload: {
      tripId: number;
      countedCash: number;
      endOdometer?: number;
      unloadRemainingToWarehouse: boolean;
      activeVisitCustomerId?: number;
      notes?: string;
    }): Promise<{
    ok: boolean;
    tripId: number;
    expectedCash: number;
    countedCash: number;
    variance: number;
    distanceKm: number;
    status: 'submitted_by_rep';
    message: string;
  }> {
    return this.getTripLifecycle().submitTripSettlement(repId, tenantId, accountId, payload);
  }

    async settleTrip(repId: number, tenantId: string, accountId: string, payload: {
      tripId: number;
      countedCash: number;
      unloadRemainingToWarehouse: boolean;
      countedStock?: { productId: number; countedQty: number }[];
      nightStockApproved?: boolean;
      nightStockNotes?: string;
      endOdometer?: number;
      chargeStockVarianceToRep?: boolean;
      // INV-VAN-SELF-SETTLE-PIN-REQUIRED: whether the charge/waive
      // flag above was decided by a supervisor (admin settle path).
      // The driver path passes false: the rep's phone never decides
      // whether his own shortage is charged or waived. Callers that
      // pass neither (legacy direct callers) keep the old behavior.
      chargeStockVarianceDecidedBySupervisor?: boolean;
      activeVisitCustomerId?: number;
      notes?: string;
      // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): HOW the
      // settlement was approved, and by WHOM when the approver is
      // identified. The driver controller passes both: 'account' +
      // the supervisor's user id when approval came from a login
      // password, 'shared_manager_pin' + null when it came from the
      // shared manager PIN (which belongs to no single user — the
      // trip then records supervisor_id NULL plus this method, never
      // a fabricated id). The admin console passes 'account' + its
      // own user id. Legacy direct callers pass neither: the method
      // is then 'unrecorded' and settled_by stays null.
      supervisorApprovalMethod?: 'shared_manager_pin' | 'account' | 'unrecorded';
      supervisorId?: number | null;
    }, authContext?: AuthContext): Promise<{
    ok: boolean;
    tripId: number;
    expectedCash: number;
    countedCash: number;
    tripExpenses?: number;
    variance: number;
    stockVarianceAmount: number;
    stockOverageAmount?: number;
    unloadedItemsCount: number;
    distanceKm: number;
    status: 'settled';
    cashierName?: string;
    cashierId?: number | null;
    repName?: string;
    settledAt?: string;
    salesAmount?: number;
    cashSales?: number;
    creditSales?: number;
    collectionsTotal?: number;
    returnsAmount?: number;
    cashRefunds?: number;
    creditReturns?: number;
    totalInstapaySales?: number;
    totalInstapayCollections?: number;
    expectedBankTransfers?: number;
    stockVariances?: any[];
  }> {
    return this.getTripLifecycle().settleTrip(repId, tenantId, accountId, payload, authContext);
  }

  
    async listTripsForAdmin(tenantId: string, filters?: { repId?: number; status?: string; dateFrom?: string; dateTo?: string }): Promise<VanTripSummary[]> {
    return this.getTripLifecycle().listTripsForAdmin(tenantId, filters);
  }

    async getTripDetailsForAdmin(tenantId: string, tripId: number, pagination?: { page?: number; pageSize?: number }) {
    return this.getTripLifecycle().getTripDetailsForAdmin(tenantId, tripId, pagination);
  }

  async listDriverSales(
    tenantId: string,
    repId: number,
    filters?: {
      dateScope?: 'today' | 'yesterday' | 'week' | 'all';
      customerId?: number;
      paymentMethod?: string;
      search?: string;
      tripId?: number;
      limit?: number;
    },
  ) {
    return this.getFieldSales().listDriverSales(tenantId, repId, filters);
  }

  // =========================================================================
  // FLEET MANAGEMENT (Delegated to VanFleetService)
  // =========================================================================

  async listFleetVehicles(tenantId: string) {
    return this.vanFleetService.listFleetVehicles(tenantId);
  }

  async createFleetVehicle(
    tenantId: string,
    accountId: string,
    payload: {
      plateNumber: string;
      modelName?: string;
      vehicleType?: string;
      vinChassis?: string;
      branchId?: number;
      currentOdometer?: number;
      fuelType?: string;
      licenseExpiresAt?: string;
      assignedRepId?: number;
      notes?: string;
    },
  ) {
    return this.vanFleetService.createFleetVehicle(tenantId, accountId, payload);
  }

  async updateFleetVehicle(
    tenantId: string,
    accountId: string,
    id: number,
    payload: {
      plateNumber?: string;
      modelName?: string;
      vehicleType?: string;
      vinChassis?: string;
      branchId?: number;
      currentOdometer?: number;
      fuelType?: string;
      licenseExpiresAt?: string;
      status?: string;
      assignedRepId?: number | null;
      notes?: string;
    },
  ) {
    return this.vanFleetService.updateFleetVehicle(tenantId, accountId, id, payload);
  }

  async assignVehicleRep(tenantId: string, vehicleId: number, repId: number | null, shiftName?: string) {
    return this.vanFleetService.assignVehicleRep(tenantId, vehicleId, repId, shiftName);
  }

  async recordFuelLog(
    tenantId: string,
    accountId: string,
    repId: number | null,
    payload: {
      vehicleId: number;
      tripId?: number | null;
      odometer: number;
      liters: number;
      pricePerLiter: number;
      stationName?: string;
      notes?: string;
    },
  ) {
    return this.vanFleetService.recordFuelLog(tenantId, accountId, repId, payload);
  }

  async listFuelLogs(
    tenantId: string,
    filters?: { vehicleId?: number; repId?: number; dateFrom?: string; dateTo?: string },
  ) {
    return this.vanFleetService.listFuelLogs(tenantId, filters);
  }

  async recordOilChange(
    tenantId: string,
    accountId: string,
    repId: number | null,
    payload: {
      vehicleId: number;
      odometerAtChange: number;
      oilType: string;
      ratedKm: number;
      withFilter: boolean;
      alertKmBefore?: number;
      cost?: number;
      performedBy?: string;
      notes?: string;
    },
  ) {
    return this.vanFleetService.recordOilChange(tenantId, accountId, repId, payload);
  }

  async listOilChanges(tenantId: string, vehicleId?: number) {
    return this.vanFleetService.listOilChanges(tenantId, vehicleId);
  }

  async getFleetMaintenanceAlerts(tenantId: string, vehicleId?: number, repId?: number) {
    return this.vanFleetService.getFleetMaintenanceAlerts(tenantId, vehicleId, repId);
  }

  async listVehicleDrivers(tenantId: string, vehicleId: number) {
    return this.vanFleetService.listVehicleDrivers(tenantId, vehicleId);
  }

  async assignVehicleDriver(
    tenantId: string,
    accountId: string,
    payload: {
      vehicleId: number;
      repId: number;
      shiftName: string;
      shiftStartTime?: string;
      shiftEndTime?: string;
      notes?: string;
    },
  ) {
    return this.vanFleetService.assignVehicleDriver(tenantId, accountId, payload);
  }

  async removeVehicleDriver(tenantId: string, assignmentId: number) {
    return this.vanFleetService.removeVehicleDriver(tenantId, assignmentId);
  }

  // =========================================================================
  // LOAD REQUISITIONS (Delegated to VanRequisitionsService)
  // =========================================================================

  async submitLoadRequisition(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
      notes?: string;
      allowMultiplePending?: boolean;
    },
  ) {
    return this.vanRequisitionsService.submitLoadRequisition(repId, tenantId, accountId, payload);
  }

  async createLoadRequisitionByAdmin(
    tenantId: string,
    accountId: string,
    userId: number,
    payload: {
      repId: number;
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
      notes?: string;
      dispatchImmediately?: boolean;
    },
  ) {
    const repId = Number(payload.repId);
    if (!repId) {
      throw new AppError('يرجى تحديد مندوب التوزيع أولاً', 'REP_REQUIRED', 400);
    }
    const subRes = await this.submitLoadRequisition(repId, tenantId, accountId, {
      sourceWarehouseId: payload.sourceWarehouseId,
      items: payload.items,
      notes: payload.notes,
      allowMultiplePending: Boolean(payload.dispatchImmediately),
    });

    if (payload.dispatchImmediately) {
      const dispatchRes = await this.approveAndDispatchRequisition(
        tenantId,
        accountId,
        subRes.requisitionId,
        userId,
      );
      return {
        ok: true,
        docNo: subRes.docNo,
        requisitionId: subRes.requisitionId,
        dispatched: true,
        tripId: dispatchRes.tripId,
        isSupplementary: dispatchRes.isSupplementary,
      };
    }

    return {
      ok: true,
      docNo: subRes.docNo,
      requisitionId: subRes.requisitionId,
      dispatched: false,
    };
  }

  async listLoadRequisitions(tenantId: string, filters: { status?: string; repId?: number } = {}) {
    return this.vanRequisitionsService.listLoadRequisitions(tenantId, filters);
  }

  async reviewLoadRequisition(
    tenantId: string,
    requisitionId: number,
    approvedItems: { productId: number; qty: number }[],
    notes?: string,
    sourceWarehouseId?: number,
  ) {
    return this.vanRequisitionsService.reviewLoadRequisition(tenantId, requisitionId, approvedItems, notes, sourceWarehouseId);
  }

  async approveAndDispatchRequisition(tenantId: string, accountId: string, requisitionId: number, reviewedByUserId: number) {
    const req = await this.vanRequisitionsService.getRequisitionForDispatch(tenantId, requisitionId);

    // Check if the rep already has an active open trip
    const existingTrip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .select(['vt.id'])
      .where('vt.rep_id', '=', Number(req.rep_id))
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .orderBy('vt.id', 'desc')
      .executeTakeFirst();

    let tripId: number;
    let isSupplementary = false;

    if (existingTrip) {
      // Driver already has an open trip -> Supplementary load into active trip!
      const loadResult = await this.loadSupplementaryStockToActiveTrip(
        Number(req.rep_id),
        tenantId,
        accountId,
        Number(existingTrip.id),
        {
          sourceWarehouseId: Number(req.source_warehouse_id),
          items: req.itemsToLoad,
          notes: req.notes || `صرف وتحميل إضافي (استعواض) بناءً على طلب إذن تحميل #${req.doc_no}`,
        },
      );
      tripId = loadResult.tripId;
      isSupplementary = true;
    } else {
      // Open a fresh trip for the rep
      const tripResult = await this.openTripAndLoad(
        Number(req.rep_id),
        tenantId,
        accountId,
        {
          sourceWarehouseId: Number(req.source_warehouse_id),
          items: req.itemsToLoad,
          notes: req.notes || `صرف وتحميل بناءً على طلب إذن تحميل #${req.doc_no}`,
        },
      );
      tripId = tripResult.tripId;
    }

    await this.vanRequisitionsService.markRequisitionDispatched(tenantId, requisitionId, tripId, reviewedByUserId);

    return { ok: true, requisitionId, tripId, docNo: req.doc_no, isSupplementary };
  }

  async rejectLoadRequisition(tenantId: string, requisitionId: number, rejectionReason: string, reviewedByUserId: number) {
    return this.vanRequisitionsService.rejectLoadRequisition(tenantId, requisitionId, rejectionReason, reviewedByUserId);
  }

  async deleteLoadRequisition(tenantId: string, requisitionId: number) {
    return this.vanRequisitionsService.deleteLoadRequisition(tenantId, requisitionId);
  }

  async cancelLoadRequisitionByDriver(tenantId: string, repId: number, requisitionId: number) {
    return this.vanRequisitionsService.cancelLoadRequisitionByDriver(tenantId, repId, requisitionId);
  }

  async getDriverWarehouses(tenantId: string, repId?: number) {
    return this.vanRequisitionsService.getDriverWarehouses(tenantId, repId);
  }

  async getDriverAvailableProducts(tenantId: string, warehouseId?: number, repId?: number) {
    return this.vanRequisitionsService.getDriverAvailableProducts(tenantId, warehouseId, repId);
  }

  // =========================================================================
  // FIELD RETURNS (Delegated to VanReturnsService)
  // =========================================================================

  async getCustomerEligibleSales(tenantId: string, customerId: number, repId?: number) {
    return this.vanReturnsService.getCustomerEligibleSales(tenantId, customerId, repId);
  }

  async submitFieldReturn(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId: number;
      saleId?: number | null;
      returnReason: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request';
      refundMethod?: 'credit' | 'cash';
      items: {
        productId: number;
        qty: number;
        unitPrice: number;
        saleItemId?: number;
      }[];
      notes?: string;
    },
  ) {
    return this.vanReturnsService.submitFieldReturn(repId, tenantId, accountId, payload);
  }

  async listFieldReturns(
    tenantId: string,
    filters: { status?: string; repId?: number; tripId?: number; customerId?: number } = {},
  ) {
    return this.vanReturnsService.listFieldReturns(tenantId, filters);
  }

  async approveFieldReturn(tenantId: string, accountId: string, returnId: number, approvedByUserId: number) {
    return this.vanReturnsService.approveFieldReturn(tenantId, accountId, returnId, approvedByUserId);
  }

  async rejectFieldReturn(tenantId: string, returnId: number, rejectionReason: string, rejectedByUserId: number) {
    return this.vanReturnsService.rejectFieldReturn(tenantId, returnId, rejectionReason, rejectedByUserId);
  }

  // =========================================================================
  // REP TARGETS & PERFORMANCE (Delegated to VanTargetsService)
  // =========================================================================

  async setRepTarget(
    tenantId: string,
    accountId: string,
    repId: number,
    periodMonth: string,
    targetAmount: number,
    collectionTarget?: number | null,
    visitsTarget?: number | null,
    commissionRates?: {
      salesCommissionRatePercent?: number;
      collectionCommissionRatePercent?: number;
      targetBonusRatePercent?: number;
    },
  ) {
    return this.vanTargetsService.setRepTarget(
      tenantId,
      accountId,
      repId,
      periodMonth,
      targetAmount,
      collectionTarget,
      visitsTarget,
      commissionRates,
    );
  }

  async getRepTarget(tenantId: string, repId: number, periodMonth?: string) {
    return this.vanTargetsService.getRepTarget(tenantId, repId, periodMonth);
  }

  async listAllRepTargets(tenantId: string, periodMonth?: string) {
    return this.vanTargetsService.listAllRepTargets(tenantId, periodMonth);
  }

  async getCommissionConfig(tenantId: string) {
    return this.vanTargetsService.getCommissionConfig(tenantId);
  }

  async saveCommissionConfig(
    tenantId: string,
    accountId: string,
    payload: {
      salesCommissionRatePercent?: number;
      collectionCommissionRatePercent?: number;
      targetBonusRatePercent?: number;
      repId?: number;
    },
  ) {
    return this.vanTargetsService.saveCommissionConfig(tenantId, accountId, payload);
  }

  async settleRepCommission(
    tenantId: string,
    accountId: string,
    auth: AuthContext,
    payload: {
      repId: number;
      periodMonth: string;
      amount?: number;
      notes?: string;
    },
  ) {
    return this.vanTargetsService.settleRepCommission(tenantId, accountId, auth, payload);
  }

  // =========================================================================
  // INTER-VAN TRANSFERS (Delegated to VanTransfersService)
  // =========================================================================

  async createInterVanTransfer(
    tenantId: string,
    accountId: string,
    fromRepId: number,
    payload: {
      toRepId: number;
      fromTripId?: number;
      toTripId?: number;
      items: { productId: number; qty: number }[];
      notes?: string;
    },
  ) {
    return this.vanTransfersService.createInterVanTransfer(tenantId, accountId, fromRepId, payload);
  }

  async acceptInterVanTransfer(tenantId: string, accountId: string, toRepId: number, transferId: number) {
    return this.vanTransfersService.acceptInterVanTransfer(tenantId, accountId, toRepId, transferId);
  }

  async rejectInterVanTransfer(tenantId: string, toRepId: number, transferId: number, reason?: string) {
    return this.vanTransfersService.rejectInterVanTransfer(tenantId, toRepId, transferId, reason);
  }

  async listInterVanTransfers(
    tenantId: string,
    filters?: { repId?: number; status?: string },
  ) {
    return this.vanTransfersService.listInterVanTransfers(tenantId, filters);
  }

  async getPeerReps(tenantId: string, currentRepId: number) {
    return this.vanTransfersService.getPeerReps(tenantId, currentRepId);
  }

  // =========================================================================
  // ROUTES, VISITS & SUPERVISOR (Delegated to VanRoutesService)
  // =========================================================================

  async getDriverTodayItinerary(tenantId: string, repId: number, tripId?: number) {
    return this.vanRoutesService.getDriverTodayItinerary(tenantId, repId, tripId);
  }

  async recordFieldVisit(
    arg1: string | number,
    arg2: string,
    arg3: string | number,
    payload: {
      tripId: number;
      customerId: number;
      visitType: 'positive' | 'negative';
      saleId?: number | null;
      negativeReason?: 'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other';
      postponedToDate?: string | null;
      gpsLat?: number | null;
      gpsLng?: number | null;
      notes?: string;
    },
  ) {
    return this.vanRoutesService.recordFieldVisit(arg1, arg2, arg3, payload);
  }

  async listFieldVisits(
    tenantId: string,
    filters?: { repId?: number; customerId?: number; visitType?: string; dateFrom?: string; dateTo?: string },
  ) {
    return this.vanRoutesService.listFieldVisits(tenantId, filters);
  }

  async getSupervisorRouteKpis(tenantId: string, dateFrom?: string, dateTo?: string) {
    return this.vanRoutesService.getSupervisorRouteKpis(tenantId, dateFrom, dateTo);
  }

  async setCustomerRouteSchedule(
    tenantId: string,
    customerId: number,
    payload: {
      route?: string;
      routeSequence?: number;
      visitDays?: string[];
      customerCode?: string;
      locationUrl?: string;
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      assignedRepName?: string | null;
      repSchedules?: Array<{ repId: number; repName?: string; days: string[] }>;
    },
  ) {
    return this.vanRoutesService.setCustomerRouteSchedule(tenantId, customerId, payload);
  }

  async bulkAssignCustomerRoutes(
    tenantId: string,
    payload: {
      customerIds: number[];
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      appendReps?: boolean;
      assignedRepName?: string | null;
      route?: string;
      visitDays?: string[];
    },
  ) {
    return this.vanRoutesService.bulkAssignCustomerRoutes(tenantId, payload);
  }

  async getSupervisorCustomerRoutes(
    tenantId: string,
    filters?: {
      search?: string;
      repId?: number | string;
      route?: string;
      unassignedOnly?: boolean;
    },
  ) {
    return this.vanRoutesService.getSupervisorCustomerRoutes(tenantId, filters);
  }

  // =========================================================================
  // TRIP OPERATIONAL EXPENSES (Fuel, Tolls, Road Maintenance, Tips)
  // =========================================================================

  /**
   * Records an operational trip expense (fuel, toll, maintenance, tips, meals).
   */
  async recordTripExpense(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      expenseType: 'fuel' | 'toll' | 'maintenance' | 'tips' | 'meals' | 'other' | string;
      amount: number;
      notes?: string;
      receiptPhotoUrl?: string;
      supervisorOverridePin?: string;
    },
    authContext?: AuthContext,
  ): Promise<{ ok: boolean; expenseId: number; totalTripExpenses: number }> {
    if (!payload.amount || Number(payload.amount) <= 0) {
      throw new AppError('مبلغ المصروف يجب أن يكون أكبر من الصفر', 'INVALID_EXPENSE_AMOUNT', 400);
    }

    const trip = await this.anyDb
      .selectFrom('van_sales_trips')
      .select(['id', 'status'])
      .where('id', '=', payload.tripId)
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .executeTakeFirst();

    if (!trip || trip.status !== 'open') {
      throw new AppError('لا يمكن تسجيل مصروفات على رحلة مغلقة أو غير موجودة', 'INVALID_TRIP', 400);
    }

    const existingSumRow = await this.anyDb
      .selectFrom('van_trip_expenses')
      .select(sql<number>`cast(coalesce(sum(amount), 0) as numeric)`.as('totalExpenses'))
      .where('trip_id', '=', payload.tripId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    const existingTripExpenses = Number(existingSumRow?.totalExpenses || 0);

    let supervisorApproved = false;
    let approvedSupervisorId: number | undefined = undefined;
    let approvedSupervisorName: string | undefined = undefined;

    if (payload.supervisorOverridePin) {
      const pinCheck = await this.verifySupervisorPin(tenantId, payload.supervisorOverridePin, repId, undefined, accountId);
      supervisorApproved = pinCheck.approved;
      approvedSupervisorId = pinCheck.supervisorId;
      approvedSupervisorName = pinCheck.supervisorName;
    }

    // Book digits resolved once (D4) and passed to the governance engine.
    const expenseDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const governance = evaluateTripExpenseGovernance({
      moneyDigits: expenseDigits,
      expenseType: payload.expenseType || 'other',
      amount: Number(payload.amount),
      notes: payload.notes,
      existingTripExpenses,
      supervisorOverride: supervisorApproved
        ? {
            approved: true,
            supervisorId: approvedSupervisorId,
            supervisorName: approvedSupervisorName,
          }
        : undefined,
    });

    if (!governance.allowed) {
      await this.recordSuspicionEvent({
        tenantId,
        accountId,
        repId,
        tripId: payload.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_EXPENSE_ABUSE,
        severity: 'high',
        titleAr: 'محاولة تسجيل مصروف طريق مخالف لسقف الحوكمة',
        detailsAr:
          governance.errorMessageAr ||
          `حاول المندوب تسجيل مصروف (${payload.expenseType}) بمبلغ (${payload.amount}) يتجاوز السقف المعتمد بدون كود مشرف.`,
        amountInvolved: Number(payload.amount),
        // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): the actor is the
        // rep recording the expense — his linked login, or the named
        // session caller when one exists.
        actorUserId:
          authContext?.userId && Number(authContext.userId) > 0
            ? Number(authContext.userId)
            : await this.resolveRepLinkedUserId(this.anyDb, tenantId, repId),
        metadata: {
          expenseType: payload.expenseType,
          amount: Number(payload.amount),
          existingTripExpenses,
          reasonCode: governance.reasonCode,
        },
      });
      throw new AppError(
        governance.errorMessageAr || 'تم رفض تسجيل المصروف الميداني',
        governance.reasonCode || 'EXPENSE_GOVERNANCE_REJECTED',
        governance.requiresSupervisorPin ? 403 : 400,
      );
    }

    const createdByUserId = approvedSupervisorId ?? (authContext?.userId ? Number(authContext.userId) : null);
    const finalNotes = approvedSupervisorName
      ? `${String(payload.notes || '').trim()} [اعتماد مشرف: ${approvedSupervisorName}]`
      : String(payload.notes || '').trim() || null;

    const [inserted] = await this.anyDb
      .insertInto('van_trip_expenses')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        trip_id: payload.tripId,
        expense_type: payload.expenseType || 'other',
        amount: Number(payload.amount),
        notes: finalNotes,
        receipt_photo_url: payload.receiptPhotoUrl || null,
        created_by_user_id: createdByUserId,
      })
      .returning(['id'])
      .execute();

    const sumRow = await this.anyDb
      .selectFrom('van_trip_expenses')
      .select(sql<number>`cast(coalesce(sum(amount), 0) as numeric)`.as('totalExpenses'))
      .where('trip_id', '=', payload.tripId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    // M18 (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION): one audit row per
    // trip expense, naming the rep who recorded it (his linked login;
    // a named session caller wins when one exists). A supervisor-PIN
    // approval is recorded in the details, not as the actor — the
    // approver did not record the expense. The function-check guards
    // harnesses that pass a `{}` audit stub.
    if (this.audit && typeof this.audit.log === 'function') {
      const auditActor = await resolveVanMoneyAuditActor(
        this.anyDb,
        tenantId,
        repId,
        authContext?.userId && Number(authContext.userId) > 0 ? Number(authContext.userId) : null,
      );
      await this.audit.log(
        'مصروف رحلة توزيع',
        `سجّل المندوب ${auditActor.repName} (#${Number(repId)}) مصروف ${payload.expenseType} بقيمة ${Number(payload.amount)} على الرحلة #${Number(payload.tripId)} (إجمالي مصروفات الرحلة ${Number(sumRow?.totalExpenses || 0)})${approvedSupervisorName ? ` — باعتماد المشرف ${approvedSupervisorName}` : ''}`,
        { userId: auditActor.userId, tenantId, accountId },
        { eventCode: AUDIT_EVENT_CODES.VAN_TRIP_EXPENSE },
      );
    }

    return {
      ok: true,
      expenseId: Number(inserted.id),
      totalTripExpenses: Number(sumRow?.totalExpenses || 0),
    };
  }

  /**
   * Retrieves all recorded trip expenses for a van trip.
   */
  async getTripExpenses(tripId: number, tenantId: string, repId?: number) {
    // Book digits resolved once (D4): the expenses total below rounds
    // at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    if (repId != null) {
      await this.assertTripOwnedByRep(tenantId, tripId, repId);
    }
    const rows = await this.anyDb
      .selectFrom('van_trip_expenses as te')
      .leftJoin('users as u', 'u.id', 'te.created_by_user_id')
      .select([
        'te.id',
        'te.trip_id as tripId',
        'te.expense_type as expenseType',
        sql<number>`cast(te.amount as numeric)`.as('amount'),
        'te.notes',
        'te.receipt_photo_url as receiptPhotoUrl',
        'te.created_at as createdAt',
        sql<string>`coalesce(u.display_name, u.username)`.as('createdByName'),
      ])
      .where('te.trip_id', '=', tripId)
      .where('te.tenant_id', '=', tenantId)
      .orderBy('te.created_at', 'desc')
      .execute();

    const total = rows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
    return {
      expenses: rows.map((r: any) => ({
        id: Number(r.id),
        tripId: Number(r.tripId),
        expenseType: r.expenseType,
        amount: Number(r.amount),
        notes: r.notes || '',
        receiptPhotoUrl: r.receiptPhotoUrl || null,
        createdAt: r.createdAt,
        createdByName: r.createdByName || null,
      })),
      totalExpenses: roundMoney(total, moneyDigits),
    };
  }

  // =========================================================================
  // RETURNABLE PACKAGING & EMPTIES LEDGER (Crates, Bottles, Pallets, Gas Cylinders)
  // =========================================================================

  /**
   * Records movement in the returnable packaging & empties ledger.
   */
  async recordPackagingMovement(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      customerId?: number;
      packageType: 'crate_plastic' | 'box_wooden' | 'bottle_glass' | 'cylinder_gas' | 'pallet' | string;
      deliveredQty: number;
      returnedQty: number;
      notes?: string;
    },
  ): Promise<{ ok: boolean; movementId: number }> {
    // INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D7): the trip must be the
    // caller's own — the repId parameter this method already carried
    // was never used, while the read side (getTripPackagingMovements)
    // already gated on it. No rep_id column is added: trip_id already
    // determines ownership deterministically (van_sales_trips.rep_id),
    // and the read side gates on the same trip — a redundant column
    // would duplicate that fact and need a backfill. The customerId
    // rides inside the owned trip; the customer-balance read stays
    // gated by assertRepServedCustomer, so a stray customerId cannot
    // leak another rep's customer data.
    await this.assertTripOwnedByRep(tenantId, payload.tripId, repId);

    const delivered = Math.max(0, Number(payload.deliveredQty || 0));
    const returned = Math.max(0, Number(payload.returnedQty || 0));

    if (delivered === 0 && returned === 0) {
      throw new AppError('يجب تسجيل كمية مسلمة أو مستلمة واحدة على الأقل', 'EMPTY_PACKAGING_QTY', 400);
    }

    const [inserted] = await this.anyDb
      .insertInto('van_trip_packaging_movements')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        trip_id: payload.tripId,
        customer_id: payload.customerId ? Number(payload.customerId) : null,
        package_type: payload.packageType || 'crate_plastic',
        delivered_qty: delivered,
        returned_qty: returned,
        notes: payload.notes || null,
      })
      .returning(['id'])
      .execute();

    return {
      ok: true,
      movementId: Number(inserted.id),
    };
  }

  /**
   * Retrieves packaging movements for a van trip.
   */
  async getTripPackagingMovements(tripId: number, tenantId: string, repId?: number) {
    if (repId != null) {
      await this.assertTripOwnedByRep(tenantId, tripId, repId);
    }
    const rows = await this.anyDb
      .selectFrom('van_trip_packaging_movements as pm')
      .leftJoin('customers as c', 'c.id', 'pm.customer_id')
      .select([
        'pm.id',
        'pm.package_type as packageType',
        'pm.delivered_qty as deliveredQty',
        'pm.returned_qty as returnedQty',
        'pm.notes',
        'pm.created_at as createdAt',
        'c.id as customerId',
        'c.name as customerName',
      ])
      .where('pm.trip_id', '=', tripId)
      .where('pm.tenant_id', '=', tenantId)
      .orderBy('pm.created_at', 'desc')
      .execute();

    return rows.map((r: any) => ({
      id: Number(r.id),
      packageType: r.packageType,
      deliveredQty: Number(r.deliveredQty || 0),
      returnedQty: Number(r.returnedQty || 0),
      netBalance: Number(r.deliveredQty || 0) - Number(r.returnedQty || 0),
      notes: r.notes || '',
      createdAt: r.createdAt,
      customerId: r.customerId ? Number(r.customerId) : null,
      customerName: r.customerName || null,
    }));
  }

  /**
   * Retrieves customer returnable packaging balance summary across all trips.
   *
   * INV-DRIVER-PORTAL-REP-SCOPED-READS-FOLLOWUP: the driver-portal read is
   * scoped through the same assertRepServedCustomer predicate C1 used for
   * the other customer reads. Staff callers pass no repId and skip the check.
   */
  async getCustomerPackagingBalance(customerId: number, tenantId: string, repId?: number) {
    if (repId != null) {
      await this.assertRepServedCustomer(tenantId, repId, customerId);
    }
    const rows = await this.anyDb
      .selectFrom('van_trip_packaging_movements')
      .select([
        'package_type as packageType',
        sql<number>`cast(coalesce(sum(delivered_qty), 0) as numeric)`.as('totalDelivered'),
        sql<number>`cast(coalesce(sum(returned_qty), 0) as numeric)`.as('totalReturned'),
      ])
      .where('customer_id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .groupBy('package_type')
      .execute();

    return rows.map((r: any) => ({
      packageType: r.packageType,
      totalDelivered: Number(r.totalDelivered || 0),
      totalReturned: Number(r.totalReturned || 0),
      netOwedToCompany: Number(r.totalDelivered || 0) - Number(r.totalReturned || 0),
    }));
  }

  /**
   * Driver creates a new field customer directly into their itinerary and customer database.
   */
  async createDriverCustomer(
    repId: number,
    tenantId: string,
    accountId: string,
    body: {
      name: string;
      phone?: string;
      address?: string;
      district?: string;
      route?: string;
      notes?: string;
      visitDays?: string[];
      metadata?: any;
    },
  ) {
    const name = String(body.name || '').trim();
    if (!name) {
      throw new AppError('اسم المحل أو العميل مطلوب', 'CUSTOMER_NAME_REQUIRED', 400);
    }

    // H9 (D4): field customer creation is gated on the acting rep's
    // can_add_customers flag. The gate runs before any read or write
    // on the customer, so a forbidden rep cannot even link himself to
    // an existing customer through this path.
    const repFlags = await loadRepPermissions(this.anyDb, tenantId, repId);
    if (!repFlags.can_add_customers) {
      throw new AppError(
        'صلاحية إنشاء العملاء (can_add_customers) مغلقة لهذا المندوب، فلا يمكنه إنشاء عميل جديد ميدانياً',
        'REP_CANNOT_ADD_CUSTOMERS',
        403,
      );
    }

    const district = (body.district || body.metadata?.district || '').trim();
    const route = (body.route || body.metadata?.route || '').trim();
    const phone = (body.phone || '').trim();
    const address = (body.address || district || '').trim();

    const rawDays = body.visitDays || body.metadata?.visit_days || body.metadata?.visitDays || (body.metadata?.visit_day ? [body.metadata.visit_day] : []);
    const normalizedDays = Array.isArray(rawDays)
      ? rawDays.map((d: string) => DAY_KEY_TO_ARABIC[normalizeDayKey(d)] || d).filter(Boolean)
      : [];
    const visit_days = normalizedDays;
    const visit_day = normalizedDays[0] || '';

    const metadata = {
      district: district || undefined,
      route: route || undefined,
      assigned_rep_id: repId,
      assigned_rep_ids: [repId],
      created_by_rep_id: repId,
      visit_days,
      visit_day,
      ...(body.metadata || {}),
    };

    const cleanPhone = phone ? phone.replace(/[\s-]/g, '') : '';
    let existing: any = null;
    if (cleanPhone) {
      existing = await this.anyDb
        .selectFrom('customers')
        .where('tenant_id', '=', tenantId)
        .where((eb: any) =>
          eb.or([
            eb('phone', '=', cleanPhone),
            eb('phone', '=', phone),
          ]),
        )
        .select(['id', 'name', 'phone', 'address', 'metadata', 'balance'])
        .executeTakeFirst();
    }

    if (!existing) {
      existing = await this.anyDb
        .selectFrom('customers')
        .where('tenant_id', '=', tenantId)
        .where('name', '=', name)
        .select(['id', 'name', 'phone', 'address', 'metadata', 'balance'])
        .executeTakeFirst();
    }

    if (existing) {
      let existingMeta: any = {};
      if (typeof existing.metadata === 'string') {
        try { existingMeta = JSON.parse(existing.metadata); } catch { existingMeta = {}; }
      } else if (existing.metadata && typeof existing.metadata === 'object') {
        existingMeta = existing.metadata;
      }

      const assignedRepIds = extractAssignedRepIds(existingMeta);
      if (!assignedRepIds.includes(Number(repId))) {
        assignedRepIds.push(Number(repId));
      }

      const existingVisitDays: string[] = Array.isArray(existingMeta.visit_days)
        ? existingMeta.visit_days
        : [];
      const mergedDays = Array.from(new Set([...existingVisitDays, ...visit_days]));
      const custCode = normalizeCustomerCode(existingMeta.customer_code || existingMeta.code, existing.id);

      const updatedMetadata = {
        ...existingMeta,
        assigned_rep_id: existingMeta.assigned_rep_id || repId,
        assigned_rep_ids: assignedRepIds,
        route: route || existingMeta.route,
        district: district || existingMeta.district,
        visit_days: mergedDays,
        visit_day: mergedDays[0] || existingMeta.visit_day || '',
        customer_code: custCode,
        code: custCode,
      };

      await this.anyDb
        .updateTable('customers')
        .set({ metadata: JSON.stringify(updatedMetadata) })
        .where('id', '=', existing.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      const existingId = Number(existing.id);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
      const repBalancesMap = await getCustomerRepBalancesMap(this.anyDb, tenantId, {
        customerIds: [existingId],
        customerTotalBalances: { [existingId]: Number(existing.balance || 0) },
        moneyDigits,
      });
      const isolated = resolveIsolatedRepCustomerBalance({
        repId: Number(repId),
        breakdown: repBalancesMap.get(existingId),
        assignedRepIds,
        fallbackTotalBalance: Number(existing.balance || 0),
        moneyDigits,
      });

      return {
        ok: true,
        alreadyExisted: true,
        message: `المحل مسجل مسبقاً بكود [${custCode}] (${existing.name}) وتم ربطه بخط سيرك بنجاح (رصيدك المستقل معه: ${isolated.repBalance} ج.م)`,
        customer: {
          id: existingId,
          name: existing.name,
          phone: existing.phone,
          address: existing.address,
          balance: isolated.repBalance,
          totalCompanyBalance: isolated.totalCustomerBalance,
          customerCode: custCode,
          metadata: updatedMetadata,
        },
      };
    }

    const inserted = await this.anyDb
      .insertInto('customers')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name,
        phone,
        address,
        balance: 0,
        customer_type: 'cash',
        credit_limit: 0,
        store_credit_balance: 0,
        metadata: JSON.stringify(metadata),
        is_active: true,
      })
      .returning(['id', 'name', 'phone', 'address', 'balance'])
      .executeTakeFirstOrThrow();

    const customerCode = formatCustomerCode(inserted.id);
    const finalizedMetadata = {
      ...metadata,
      customer_code: customerCode,
      code: customerCode,
    };

    await this.anyDb
      .updateTable('customers')
      .set({ metadata: JSON.stringify(finalizedMetadata) })
      .where('id', '=', inserted.id)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      ok: true,
      alreadyExisted: false,
      customer: {
        id: Number(inserted.id),
        name: inserted.name,
        phone: inserted.phone,
        address: inserted.address,
        balance: 0,
        customerCode,
        metadata: finalizedMetadata,
      },
    };
  }

  // =========================================================================
  // FIELD WHOLESALE DOMINANCE: SUGGESTED ORDER & RE-ORDER
  // =========================================================================

  async getCustomerSuggestedOrder(tenantId: string, accountId: string, repId: number, customerId: number) {
    // INV-DRIVER-PORTAL-REP-SCOPED-READS-FOLLOWUP: the scope check runs
    // BEFORE the van location resolution. getOrCreateVanLocation inserts a
    // stock_locations row when the rep has none, and a forbidden read must
    // not create rows. The repId here is the calling rep (the driver route
    // passes the verified token's repId; there is no staff route), so the
    // same assertRepServedCustomer predicate C1 used applies verbatim.
    await this.assertRepServedCustomer(tenantId, repId, customerId);
    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);

    const recentSales = await this.anyDb
      .selectFrom('sales')
      .select(['id', 'doc_no', 'created_at'])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .where('status', 'in', ['posted', 'completed'])
      .orderBy('id', 'desc')
      .limit(3)
      .execute();

    if (!recentSales.length) {
      return {
        ok: true,
        customerId,
        lastOrderDocNo: null,
        lastOrderDate: null,
        items: [],
        hasPreviousOrders: false,
      };
    }

    const latestSaleId = Number(recentSales[0].id);
    const latestDocNo = String(recentSales[0].doc_no || '');
    const latestDate = recentSales[0].created_at;

    const saleItems = await this.anyDb
      .selectFrom('sale_items as si')
      .leftJoin('products as p', 'p.id', 'si.product_id')
      .leftJoin('packaging_units as pu', 'pu.id', 'p.packaging_unit_id')
      .select([
        'si.product_id as productId',
        sql<string>`coalesce(si.product_name, p.name, '')`.as('productName'),
        sql<number>`cast(coalesce(si.quantity, 0) as numeric)`.as('qty'),
        sql<number>`cast(coalesce(si.unit_price, 0) as numeric)`.as('unitPrice'),
        sql<string>`coalesce(si.unit_name, pu.name, 'قطعة')`.as('unitName'),
        sql<number>`cast(coalesce(si.unit_multiplier, 1) as numeric)`.as('unitMultiplier'),
        'p.barcode',
        sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
      ])
      .where('si.sale_id', '=', latestSaleId)
      .where('si.tenant_id', '=', tenantId)
      .execute();

    const productIds = saleItems.map((it: any) => Number(it.productId)).filter((id: number) => id > 0);
    const vanStocksMap = new Map<number, number>();

    if (productIds.length > 0) {
      const vanStocks = await this.anyDb
        .selectFrom('product_location_stock')
        .select(['product_id', sql<number>`cast(coalesce(qty, 0) as numeric)`.as('qty')])
        .where('location_id', '=', vanLoc.id)
        .where('tenant_id', '=', tenantId)
        .where('product_id', 'in', productIds)
        .execute();

      for (const vs of vanStocks) {
        vanStocksMap.set(Number(vs.product_id), Number(vs.qty || 0));
      }
    }

    const items = saleItems.map((it: any) => {
      const pid = Number(it.productId);
      const availableVanQty = vanStocksMap.get(pid) || 0;
      return {
        productId: pid,
        productName: String(it.productName || `صنف #${pid}`),
        suggestedQty: Number(it.qty || 1),
        unitPrice: Number(it.unitPrice || it.retailPrice || 0),
        unitName: String(it.unitName || 'قطعة'),
        unitMultiplier: Number(it.unitMultiplier || 1),
        barcode: it.barcode || null,
        availableVanQty,
        isAvailableInVan: availableVanQty > 0,
      };
    });

    return {
      ok: true,
      customerId,
      lastOrderDocNo: latestDocNo,
      lastOrderDate: latestDate,
      hasPreviousOrders: true,
      items,
    };
  }

  // =========================================================================
  // FIELD WHOLESALE DOMINANCE: LAST SOLD PRICES PER CUSTOMER
  // =========================================================================

  async getCustomerLastSoldPrices(tenantId: string, customerId: number, repId?: number) {
    if (repId != null) {
      await this.assertRepServedCustomer(tenantId, repId, customerId);
    }
    const lastSales = await this.anyDb
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .select([
        'si.product_id as productId',
        sql<number>`cast(si.unit_price as numeric)`.as('lastPrice'),
        's.created_at as lastSaleDate',
        's.doc_no as lastDocNo',
      ])
      .where('s.tenant_id', '=', tenantId)
      .where('s.customer_id', '=', customerId)
      .where('s.status', 'in', ['posted', 'completed'])
      .distinctOn('si.product_id')
      .orderBy('si.product_id')
      .orderBy('s.id', 'desc')
      .execute();

    const pricesMap: Record<number, { lastPrice: number; lastSaleDate: string; lastDocNo: string }> = {};
    for (const row of lastSales) {
      pricesMap[Number(row.productId)] = {
        lastPrice: Number(row.lastPrice || 0),
        lastSaleDate: row.lastSaleDate ? await resolveBusinessDateKey(this.anyDb, tenantId, row.lastSaleDate) : '',
        lastDocNo: String(row.lastDocNo || ''),
      };
    }

    return {
      ok: true,
      customerId,
      lastPrices: pricesMap,
    };
  }

  // =========================================================================
  // FIELD WHOLESALE DOMINANCE: ON-THE-SPOT FIELD CUSTOMER STATEMENT
  // =========================================================================

  async getCustomerFieldStatement(tenantId: string, customerId: number, repId?: number) {
    // Book digits resolved once (D4): the overdue total below rounds
    // at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const customer = await this.anyDb
      .selectFrom('customers')
      .select([
        'id',
        'name',
        'phone',
        'address',
        sql<number>`cast(coalesce(balance, 0) as numeric)`.as('balance'),
        sql<number>`cast(coalesce(credit_limit, 0) as numeric)`.as('creditLimit'),
        'is_credit_blocked as isCreditBlocked',
        'customer_type as customerType',
        'metadata',
      ])
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!customer) {
      throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);
    }

    if (repId != null) {
      await this.assertRepServedCustomer(tenantId, repId, customerId);
    }

    const packaging = await this.getCustomerPackagingBalance(customerId, tenantId);

    const recentSales = await this.anyDb
      .selectFrom('sales')
      .select([
        'id',
        'doc_no as docNo',
        'created_at as saleDate',
        'payment_type as paymentType',
        sql<number>`cast(total as numeric)`.as('total'),
        sql<number>`cast(coalesce(paid_amount, 0) as numeric)`.as('paidAmount'),
        sql<number>`cast(total - coalesce(paid_amount, 0) as numeric)`.as('remaining'),
        'status',
      ])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .where('status', 'in', ['posted', 'completed'])
      .orderBy('id', 'desc')
      .limit(5)
      .execute();

    let collectionsList: Array<{
      id: number;
      receiptNumber: string;
      paymentDate: any;
      amount: number;
      paymentMethod: string;
      notes: string;
    }> = [];

    const recentCustomerPayments = await this.anyDb
      .selectFrom('customer_payments')
      .select([
        'id',
        sql<number>`cast(amount as numeric)`.as('amount'),
        'note',
        'created_at as createdAt',
        'transfer_reference as transferReference',
      ])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .orderBy('id', 'desc')
      .limit(5)
      .execute();

    if (recentCustomerPayments && recentCustomerPayments.length > 0) {
      collectionsList = recentCustomerPayments.map((c: any) => {
        const receiptMatch = c.note ? String(c.note).match(/#([A-Z0-9-]+)/) : null;
        const receiptNumber = receiptMatch ? receiptMatch[1] : (c.transferReference ? `TR-${c.id}` : `COL-${c.id}`);

        let paymentMethod = 'cash';
        const noteText = String(c.note || '').toLowerCase();
        if (c.transferReference || noteText.includes('إنستاباي') || noteText.includes('instapay')) {
          paymentMethod = 'instapay';
        } else if (noteText.includes('فودافون') || noteText.includes('vodafone')) {
          paymentMethod = 'vodafone_cash';
        } else if (noteText.includes('تحويل') || noteText.includes('bank')) {
          paymentMethod = 'bank_transfer';
        }

        return {
          id: Number(c.id),
          receiptNumber,
          paymentDate: c.createdAt,
          amount: Number(c.amount || 0),
          paymentMethod,
          notes: c.note || '',
        };
      });
    } else {
      const recentLedgerPayments = await this.anyDb
        .selectFrom('customer_ledger')
        .select([
          'id',
          sql<number>`cast(abs(coalesce(amount, 0)) as numeric)`.as('amount'),
          'note',
          'created_at as createdAt',
        ])
        .where('tenant_id', '=', tenantId)
        .where('customer_id', '=', customerId)
        .where('entry_type', 'in', ['payment', 'customer_payment'])
        .orderBy('id', 'desc')
        .limit(5)
        .execute();

      collectionsList = recentLedgerPayments.map((l: any) => {
        const receiptMatch = l.note ? String(l.note).match(/#([A-Z0-9-]+)/) : null;
        const receiptNumber = receiptMatch ? receiptMatch[1] : `COL-${l.id}`;

        let paymentMethod = 'cash';
        const noteText = String(l.note || '').toLowerCase();
        if (noteText.includes('إنستاباي') || noteText.includes('instapay')) {
          paymentMethod = 'instapay';
        } else if (noteText.includes('فودافون') || noteText.includes('vodafone')) {
          paymentMethod = 'vodafone_cash';
        } else if (noteText.includes('تحويل') || noteText.includes('bank')) {
          paymentMethod = 'bank_transfer';
        }

        return {
          id: Number(l.id),
          receiptNumber,
          paymentDate: l.createdAt,
          amount: Number(l.amount || 0),
          paymentMethod,
          notes: l.note || '',
        };
      });
    }

    let custMeta: any = {};
    if (typeof customer.metadata === 'string') {
      try { custMeta = JSON.parse(customer.metadata); } catch { custMeta = {}; }
    } else if (customer.metadata && typeof customer.metadata === 'object') {
      custMeta = customer.metadata;
    }
    const allowedCreditDays = Number(custMeta?.credit_days || custMeta?.credit_terms_days || 30);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - allowedCreditDays);

    const overdueInvoices = await this.anyDb
      .selectFrom('sales')
      .select([
        'id',
        'doc_no as docNo',
        'created_at as saleDate',
        sql<number>`cast(total - coalesce(paid_amount, 0) as numeric)`.as('remaining'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .where('payment_type', '=', 'credit')
      .where('status', 'in', ['posted', 'completed'])
      .where(sql`total - coalesce(paid_amount, 0) > 0.05`)
      .where('created_at', '<', cutoffDate)
      .orderBy('created_at', 'asc')
      .execute();

    const totalOverdueAmount = roundMoney(
      overdueInvoices.reduce((sum: number, inv: any) => sum + Number(inv.remaining || 0), 0),
      moneyDigits,
    );
    const oldestOverdueDays = overdueInvoices.length > 0
      ? Math.max(0, Math.floor((Date.now() - new Date(overdueInvoices[0].saleDate).getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    return {
      ok: true,
      customer: {
        id: Number(customer.id),
        name: String(customer.name),
        phone: String(customer.phone || ''),
        address: String(customer.address || ''),
        balance: Number(customer.balance || 0),
        creditLimit: Number(customer.creditLimit || 0),
        customerType: customer.customerType || 'cash',
        isCreditBlocked: Boolean(customer.isCreditBlocked),
        allowedCreditDays,
      },
      overdueAnalysis: {
        hasOverdueInvoices: overdueInvoices.length > 0,
        overdueCount: overdueInvoices.length,
        totalOverdueAmount,
        oldestOverdueDays,
      },
      packagingBalance: Array.isArray(packaging) ? packaging : (packaging?.packages || []),
      recentSales: recentSales.map((s: any) => ({
        id: Number(s.id),
        docNo: String(s.docNo || `INV-${s.id}`),
        saleDate: s.saleDate,
        paymentType: s.paymentType,
        total: Number(s.total || 0),
        paidAmount: Number(s.paidAmount || 0),
        remaining: Number(s.remaining || 0),
      })),
      recentCollections: collectionsList,
    };
  }

  /**
   * Get centralized financial ledger movements and summary for delivery representatives.
   */
  async getRepFinancialLedger(
    tenantId: string,
    filters: {
      repId?: number;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    // Book digits resolved once (D4): the ledger summary totals
    // below round at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    let query = this.anyDb
      .selectFrom('van_rep_financial_settlements as fs')
      .innerJoin('delivery_representatives as dr', 'dr.id', 'fs.rep_id')
      .leftJoin('van_sales_trips as vt', 'vt.id', 'fs.trip_id')
      .leftJoin('users as u', 'u.id', 'fs.settled_by')
      .leftJoin('hr_employees as emp', 'emp.id', 'dr.employee_id')
      .select([
        'fs.id',
        'fs.tenant_id as tenantId',
        'fs.rep_id as repId',
        'dr.name as repName',
        'dr.phone as repPhone',
        'dr.employee_id as employeeId',
        'emp.display_name as employeeName',
        'emp.employee_no as employeeNo',
        'fs.trip_id as tripId',
        'vt.shift_name as shiftName',
        'dr.vehicle_plate as vehiclePlate',
        'fs.entry_type as entryType',
        sql<number>`cast(fs.amount as numeric)`.as('amount'),
        'fs.status',
        'fs.settled_at as settledAt',
        'fs.settled_by as settledById',
        'u.username as settledByName',
        'fs.settlement_method as settlementMethod',
        'fs.notes',
        'fs.receipt_voucher_no as receiptVoucherNo',
        'fs.payroll_run_id as payrollRunId',
        'fs.created_at as createdAt',
        'fs.updated_at as updatedAt',
      ])
      .where('fs.tenant_id', '=', tenantId);

    if (filters.repId) {
      query = query.where('fs.rep_id', '=', Number(filters.repId));
    }
    if (filters.status && filters.status !== 'all') {
      query = query.where('fs.status', '=', filters.status);
    }
    if (filters.dateFrom) {
      query = query.where('fs.created_at', '>=', new Date(filters.dateFrom));
    }
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      query = query.where('fs.created_at', '<=', end);
    }

    const rawItems = await query.orderBy('fs.created_at', 'desc').execute();

    const items = rawItems.map((r: any) => ({
      id: Number(r.id),
      tenantId: String(r.tenantId || r.tenant_id || r.tenantid || ''),
      repId: Number(r.repId || r.rep_id || r.repid || 0),
      repName: String(r.repName || r.rep_name || r.repname || ''),
      repPhone: r.repPhone || r.rep_phone || r.repphone || undefined,
      employeeId: (r.employeeId || r.employee_id || r.employeeid) ? Number(r.employeeId || r.employee_id || r.employeeid) : null,
      employeeName: r.employeeName || r.employee_name || r.employeename || null,
      employeeNo: r.employeeNo || r.employee_no || r.employeeno || null,
      tripId: (r.tripId || r.trip_id || r.tripid) ? Number(r.tripId || r.trip_id || r.tripid) : null,
      shiftName: r.shiftName || r.shift_name || r.shiftname || null,
      vehiclePlate: r.vehiclePlate || r.vehicle_plate || r.vehicleplate || null,
      entryType: String(r.entryType || r.entry_type || r.entrytype || ''),
      amount: Number(r.amount || 0),
      status: String(r.status || 'pending'),
      settledAt: r.settledAt || r.settled_at || r.settledat || null,
      settledById: (r.settledById || r.settled_by || r.settledby) ? Number(r.settledById || r.settled_by || r.settledby) : null,
      settledByName: r.settledByName || r.settled_by_name || r.settledbyname || null,
      settlementMethod: r.settlementMethod || r.settlement_method || r.settlementmethod || null,
      notes: r.notes || null,
      receiptVoucherNo: r.receiptVoucherNo || r.receipt_voucher_no || r.receiptvoucherno || null,
      payrollRunId: (r.payrollRunId || r.payroll_run_id || r.payrollrunid) ? Number(r.payrollRunId || r.payroll_run_id || r.payrollrunid) : null,
      createdAt: r.createdAt || r.created_at || r.createdat,
      updatedAt: r.updatedAt || r.updated_at || r.updatedat,
    }));

    // INV-REP-LEDGER-SUMMARY-BALANCE (M7, A8): the summary is a
    // statement of what was charged vs earned over the FILTERED items
    // (the rep/status/date filters above already scope the query), so
    // the net balance counts every NON-WAIVED item on both sides:
    //   netBalance = commissionsDue - shortagesOwed, where
    //   commissionsDue = commission/bonus with status != 'waived',
    //   shortagesOwed = cash/stock shortage with status != 'waived'
    //     (pending + settled + pushed_to_payroll).
    // Grounded status meanings (read from the writers, not assumed):
    // - 'waived' is the ONLY extinguishing status. A waived stock
    //   shortage reverses its trip custody debit (Dr 7200 / Cr 1160,
    //   postRepShortageWaiver) and a waived bonus/commission posts
    //   nothing — a waived item never was / no longer is money
    //   between company and rep, so it leaves both totals.
    // - 'settled' shortage = cash actually collected from the rep
    //   (settleRepFinancialItem cash branch: Dr 1110 / Cr 7200 or
    //   Cr 1160 + treasury + drawer row, one transaction). The old
    //   formula dropped it from the subtraction, so the headline net
    //   understated what was charged in the window; the settled
    //   bucket is displayed alongside, so what is already collected
    //   stays visible and is never collected twice off this number
    //   (push-to-payroll takes explicit ids, the per-rep card shows
    //   pending only).
    // - 'pushed_to_payroll' = an hr_employee_adjustments deduction /
    //   allowance was WRITTEN (status 'pending') but the money leaves
    //   the rep's pay only when the targeted payroll run is built
    //   (pickup is `date <= range.to`, M2) — not actually deducted
    //   yet, so it stays in the balance. LIMIT (honest, display-only):
    //   no status ever records "the payroll run applied it" (nothing
    //   flips pushed_to_payroll afterwards and this summary never
    //   reads hr_employee_adjustments), so a pushed shortage remains
    //   in the net even after the run deducts it; the pushed bucket
    //   is the admin's view of that amount. Same for a cash-settled
    //   shortage, which remains in the gross position with the
    //   settled bucket showing it as collected.
    // - 'settled' bonus/commission cannot occur today (the cash branch
    //   rejects non-shortages with SETTLEMENT_CASH_UNSUPPORTED; push
    //   flips to pushed_to_payroll), but the != 'waived' rule covers
    //   it as earned if a future path ever settles one by payment.
    // - Overages (cash_overage / stock_overage, born 'settled' at
    //   settleTrip, INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE) are company
    //   gains (Cr 7100), never a claim on the rep, so they are shown
    //   as totalOverages / per-rep overages and NEVER folded into the
    //   net balance. Display-only: no journal, no status flip, no
    //   migration.
    let totalPendingShortages = 0;
    let totalSettledShortages = 0;
    let totalWaivedShortages = 0;
    let totalPushedToPayroll = 0;
    let totalCommissions = 0;
    let totalOverages = 0;

    const repMap = new Map<number, {
      repId: number;
      repName: string;
      repPhone?: string;
      employeeId?: number | null;
      employeeName?: string | null;
      pendingShortages: number;
      settledShortages: number;
      waivedShortages: number;
      pushedToPayroll: number;
      commissions: number;
      overages: number;
      netBalance: number;
      itemsCount: number;
    }>();

    for (const it of items) {
      const amt = Number(it.amount || 0);
      const isShortage = ['cash_shortage', 'stock_shortage'].includes(it.entryType);
      const isBonus = ['commission', 'bonus'].includes(it.entryType);
      const isOverage = ['cash_overage', 'stock_overage'].includes(it.entryType);
      const isWaived = it.status === 'waived';

      if (isShortage) {
        if (it.status === 'pending') totalPendingShortages += amt;
        else if (it.status === 'settled') totalSettledShortages += amt;
        else if (it.status === 'waived') totalWaivedShortages += amt;
        else if (it.status === 'pushed_to_payroll') totalPushedToPayroll += amt;
      } else if (isBonus) {
        // INV-REP-LEDGER-SUMMARY-BALANCE: a waived bonus/commission
        // was forgiven, never earned — it leaves the commission total.
        if (!isWaived) totalCommissions += amt;
      } else if (isOverage) {
        // INV-REP-LEDGER-SUMMARY-BALANCE: overages are shown, never
        // netted (company gain, Cr 7100 — not rep money).
        if (!isWaived) totalOverages += amt;
      }

      if (!repMap.has(it.repId)) {
        repMap.set(it.repId, {
          repId: it.repId,
          repName: it.repName,
          repPhone: it.repPhone || undefined,
          employeeId: it.employeeId ? Number(it.employeeId) : null,
          employeeName: it.employeeName || null,
          pendingShortages: 0,
          settledShortages: 0,
          waivedShortages: 0,
          pushedToPayroll: 0,
          commissions: 0,
          overages: 0,
          netBalance: 0,
          itemsCount: 0,
        });
      }

      const repEntry = repMap.get(it.repId)!;
      repEntry.itemsCount++;
      if (isShortage) {
        if (it.status === 'pending') repEntry.pendingShortages += amt;
        else if (it.status === 'settled') repEntry.settledShortages += amt;
        else if (it.status === 'waived') repEntry.waivedShortages += amt;
        else if (it.status === 'pushed_to_payroll') repEntry.pushedToPayroll += amt;
      } else if (isBonus) {
        if (!isWaived) repEntry.commissions += amt;
      } else if (isOverage) {
        if (!isWaived) repEntry.overages += amt;
      }
      // INV-REP-LEDGER-SUMMARY-BALANCE: commissions due (non-waived)
      // minus shortages owed (pending + settled + pushed_to_payroll);
      // waived leaves both sides, overages never enter the net.
      repEntry.netBalance = roundMoney(
        repEntry.commissions - (repEntry.pendingShortages + repEntry.settledShortages + repEntry.pushedToPayroll),
        moneyDigits,
      );
    }

    return {
      items,
      summary: {
        totalPendingShortages: roundMoney(totalPendingShortages, moneyDigits),
        totalSettledShortages: roundMoney(totalSettledShortages, moneyDigits),
        totalWaivedShortages: roundMoney(totalWaivedShortages, moneyDigits),
        totalPushedToPayroll: roundMoney(totalPushedToPayroll, moneyDigits),
        totalCommissions: roundMoney(totalCommissions, moneyDigits),
        totalOverages: roundMoney(totalOverages, moneyDigits),
        netRepBalance: roundMoney(
          totalCommissions - (totalPendingShortages + totalSettledShortages + totalPushedToPayroll),
          moneyDigits,
        ),
        repsBreakdown: Array.from(repMap.values()),
      },
    };
  }

  /**
   * Settle a specific representative financial shortage/variance via cash receipt or administrative waiver.
   *
   * INV-REP-SHORTAGE-CASH-SETTLE: a cash settle is a real cash receipt, so
   * the journal, the drawer row and the status flip commit or roll back in
   * ONE transaction. The item is re-read under lock inside the transaction
   * and the status flip carries a status predicate, so a concurrent second
   * settle waits, then fails closed instead of collecting the same cash
   * twice. Cash is available only for shortage items: bonuses and
   * commissions leave through payroll, never through this cash receipt.
   * A waiver of a cash shortage (or a bonus/commission item) stays
   * record-only, exactly as before. A waiver of a pending stock
   * shortage charged to the rep reverses the trip-settlement custody
   * debit (INV-VAN-REP-SHORTAGE-WAIVER-REVERSAL: Dr 7200 / Cr 1160)
   * in the same transaction, before the status flip, so a posting
   * failure leaves the row pending instead of stranding Dr 1160.
   * M4 (INV-REP-SHORTAGE-CUSTODY-GUARD): both branches first verify
   * that a Dr 1160 custody leg actually stands for this item's trip
   * (see assertRepStockShortageCustodyLeg). Migration 0225 backfilled
   * pending stock_shortage rows without recording whether the rep was
   * charged, so a backfilled row may have no Dr 1160 at all — its
   * trip journal booked Dr 7200 / Cr 1140 instead. Waiving or
   * cash-settling such a row would post a Cr 1160 reversal against
   * nothing, so the guard fails closed with
   * REP_SHORTAGE_NO_CUSTODY_LEG, posts no journal, flips no status,
   * and the blocked attempt is written to audit_logs after the
   * transaction rolls back. The row stays pending for manual review.
   * M5 (INV-REP-WAIVER-APPROVAL-RULE): every waiver also passes the
   * approval gate (assertRepWaiverApproval) BEFORE the M4 guard —
   * a reason is mandatory for every waiver, a waiver above the
   * threshold (settings key repWaiverApprovalThreshold, default 500
   * in tenant base-currency units, the Q6 equivalent; 0 = every
   * waiver needs a PIN) requires a supervisor PIN verified via the
   * shared authorizeManagerSecret, and neither the acting user nor
   * an attributed approver may be the user who settled the trip
   * (maker-checker). The cash branch is untouched: PD3 is
   * waiver-only.
   */
  async settleRepFinancialItem(
    tenantId: string,
    accountId: string,
    id: number,
    payload: {
      method: 'cash' | 'waiver';
      notes?: string;
      reason?: string;
      supervisorPin?: string;
    },
    authContext: AuthContext,
  ) {
    if (payload.method !== 'cash' && payload.method !== 'waiver') {
      throw new AppError('طريقة التسوية غير معروفة', 'SETTLEMENT_METHOD_INVALID', 400);
    }
    const actorUserId = authContext.userId ? Number(authContext.userId) : null;
    return this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      const item = await trxAny
        .selectFrom('van_rep_financial_settlements')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!item) {
        throw new AppError('بند التسوية غير موجود', 'SETTLEMENT_NOT_FOUND', 404);
      }

      if (item.status !== 'pending') {
        throw new AppError('تمت تسوية هذا البند أو إعفاؤه مسبقاً', 'ALREADY_SETTLED', 400);
      }

      const notes = payload.notes
        ? `${item.notes ? item.notes + ' | ' : ''}${payload.notes}`
        : item.notes;

      if (payload.method === 'waiver') {
        // M5 (INV-REP-WAIVER-APPROVAL-RULE): reason is mandatory for
        // every waiver, a waiver above the threshold needs a
        // supervisor PIN, and neither the actor nor an attributed
        // approver may be the user who settled the trip
        // (maker-checker). This gate runs BEFORE the M4 custody guard
        // below: authorization is decided before posting validity.
        await this.assertRepWaiverApproval(trxAny, tenantId, accountId, item, payload, actorUserId);
        const waiverReason = String(payload.reason ?? payload.notes ?? '').trim();
        const waiverNotes = `${item.notes ? item.notes + ' | ' : ''}${waiverReason}`;
        // INV-VAN-REP-SHORTAGE-WAIVER-REVERSAL: a pending stock
        // shortage was charged to the rep at trip settlement
        // (Dr 1160 / Cr 1140). Waiving it must reverse that custody
        // debit (Dr 7200 / Cr 1160) in this same transaction, BEFORE
        // the status flip, so a posting throw leaves the row
        // pending. Cash-shortage waivers need no reversal (Dr 7200
        // already stands) and bonus/commission waivers post nothing.
        // A zero (or negative) stock shortage has nothing to reverse.
        let journalEntryId: number | null = null;
        const waiverEntryType = String(item.entry_type || '');
        if (waiverEntryType === 'stock_shortage') {
          const waiverBookDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
          const waiverAmount = roundMoney(Number(item.amount || 0), waiverBookDigits);
          if (waiverAmount > 0) {
            // M4 (INV-REP-SHORTAGE-CUSTODY-GUARD): only a shortage
            // trip settlement actually charged to the rep (Dr 1160)
            // may be waived into Dr 7200 / Cr 1160. A backfilled
            // row with no Dr 1160 leg fails closed here, before any
            // journal is posted or status flipped.
            await this.assertRepStockShortageCustodyLeg(trxAny, tenantId, item, waiverAmount, waiverBookDigits);
            // Branch/location mirror settleTrip: the trip's van
            // location, branch from that location's row; null when
            // the trip or the location row is missing.
            let waiverLocationId: number | null = null;
            let waiverBranchId: number | null = null;
            if (item.trip_id) {
              const waiverTrip = await trxAny
                .selectFrom('van_sales_trips')
                .select(['van_location_id'])
                .where('id', '=', Number(item.trip_id))
                .where('tenant_id', '=', tenantId)
                .executeTakeFirst();
              waiverLocationId = waiverTrip?.van_location_id ? Number(waiverTrip.van_location_id) : null;
              if (waiverLocationId) {
                const waiverVanLocRow = await trxAny
                  .selectFrom('stock_locations')
                  .select(['branch_id'])
                  .where('id', '=', waiverLocationId)
                  .where('tenant_id', '=', tenantId)
                  .executeTakeFirst();
                waiverBranchId = waiverVanLocRow?.branch_id ? Number(waiverVanLocRow.branch_id) : null;
              }
            }
            journalEntryId = await this.accountingPosting.postRepShortageWaiver(
              trx,
              id,
              { amount: waiverAmount, branchId: waiverBranchId, locationId: waiverLocationId },
              authContext,
            );
          }
        }
        const waived = await trxAny
          .updateTable('van_rep_financial_settlements')
          .set({
            status: 'waived',
            settlement_method: 'waiver',
            settled_at: sql`NOW()`,
            settled_by: actorUserId,
            receipt_voucher_no: null,
            notes: waiverNotes,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', id)
          .where('tenant_id', '=', tenantId)
          .where('status', '=', 'pending')
          .returning('id')
          .execute();
        if (waived.length !== 1) {
          throw new AppError('تمت تسوية هذا البند أو إعفاؤه مسبقاً', 'ALREADY_SETTLED', 400);
        }
        return {
          ok: true,
          id,
          status: 'waived',
          receiptVoucherNo: null,
          journalEntryId,
        };
      }

      const entryType = String(item.entry_type || '');
      if (entryType !== 'cash_shortage' && entryType !== 'stock_shortage') {
        throw new AppError(
          'السداد النقدي متاح لبنود العجز فقط؛ المكافآت والعمولات تُرحَّل للرواتب أو تُعفى إدارياً',
          'SETTLEMENT_CASH_UNSUPPORTED',
          422,
        );
      }

      const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
      const amount = roundMoney(Number(item.amount || 0), bookDigits);
      if (!(amount > 0)) {
        throw new AppError('مبلغ بند التسوية يجب أن يكون أكبر من صفر', 'SETTLEMENT_AMOUNT_INVALID', 400);
      }

      // M4 (INV-REP-SHORTAGE-CUSTODY-GUARD): a stock shortage may
      // only be collected in cash against a Dr 1160 custody leg trip
      // settlement actually charged to the rep. A backfilled row with
      // no such leg fails closed here, before the shift is resolved
      // or any journal is posted, so the operator sees the root cause
      // instead of an incidental missing-shift error. Cash shortages
      // need no custody leg — Dr 7200 already stands for them.
      if (entryType === 'stock_shortage') {
        await this.assertRepStockShortageCustodyLeg(trxAny, tenantId, item, amount, bookDigits);
      }

      const shift = await this.resolveRepShortageReceivingShift(trxAny, {
        tenantId,
        actorUserId,
        tripId: item.trip_id ? Number(item.trip_id) : null,
      });

      const journalEntryId = await this.accountingPosting.postRepShortageCashCollection(
        trx,
        id,
        {
          amount,
          entryType,
          branchId: shift.branch_id ? Number(shift.branch_id) : null,
          locationId: shift.location_id ? Number(shift.location_id) : null,
        },
        authContext,
      );

      const rep = item.rep_id
        ? await trxAny
          .selectFrom('delivery_representatives')
          .select(['name'])
          .where('id', '=', Number(item.rep_id))
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst()
        : null;
      await this.insertRepShortageCashRow(trxAny, {
        tenantId,
        accountId,
        settlementItemId: id,
        repName: rep?.name ? String(rep.name) : 'مندوب التوزيع',
        amount,
        shift,
        createdBy: actorUserId,
      });

      // Deterministic voucher: the settlement item id is the sequence, so a
      // retried settle can never mint a second voucher number for one item.
      // The day part keeps the host-local behaviour this endpoint always
      // had; tenant-timezone day resolution is recorded remaining work.
      const receiptVoucherNo = formatDailyDocumentNumber('REC', id);

      const settled = await trxAny
        .updateTable('van_rep_financial_settlements')
        .set({
          status: 'settled',
          settlement_method: 'cash',
          settled_at: sql`NOW()`,
          settled_by: actorUserId,
          receipt_voucher_no: receiptVoucherNo,
          notes,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', id)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'pending')
        .returning('id')
        .execute();
      if (settled.length !== 1) {
        throw new AppError('تمت تسوية هذا البند أو إعفاؤه مسبقاً', 'ALREADY_SETTLED', 400);
      }

      return {
        ok: true,
        id,
        status: 'settled',
        receiptVoucherNo,
        journalEntryId,
      };
    }).catch(async (error: any) => {
      if (error?.code === 'REP_SHORTAGE_NO_CUSTODY_LEG') {
        // M4: the failing transaction already rolled back, so an
        // audit row written inside it would have vanished with it.
        // Record the blocked attempt AFTER the rollback, on a
        // separate committed write, so an admin can find it in the
        // audit log (event_code REP_SHORTAGE_NO_CUSTODY_LEG) while
        // the row stays pending in the ledger for manual review.
        // Best-effort only: a logging failure (a stub audit service
        // in a harness, a missing table) must never mask the
        // fail-closed error.
        try {
          await this.audit.log(
            'محاولة تسوية عجز مخزني بلا قيد عهدة',
            `تم إيقاف تسوية بند عجز مخزني #${id} بطريقة ${payload.method}: لا يوجد قيد مدين 1160 قائم لهذا البند — البند باقٍ معلق للمراجعة اليدوية`,
            authContext,
            { eventCode: 'REP_SHORTAGE_NO_CUSTODY_LEG' },
          );
        } catch {
          // The audit trail is best-effort; the fail-closed error stands.
        }
      }
      throw error;
    });
  }

  /**
   * M5 (INV-REP-WAIVER-APPROVAL-RULE): the waiver approval threshold,
   * in tenant base-currency units. Settings-backed, defaulting to 500
   * — the Q6 (spirit review, large cash refunds only) equivalent:
   * Q6's threshold is default 500 via `posLargeCashRefundThreshold`;
   * the waiver threshold is a separate key so the two limits stay
   * independently settable. 0 means every waiver needs a supervisor
   * PIN (any positive amount exceeds 0). A missing, unparseable or
   * negative value falls back to the 500 default — a corrupt setting
   * never silently turns the PIN off. Mirrors the settings read in
   * returns.service.ts (getLargeCashRefundThreshold).
   */
  private async getRepWaiverApprovalThreshold(trx: any, tenantId: string): Promise<number> {
    const row = await sql<{ value?: string }>`select value from settings where key = 'repWaiverApprovalThreshold' and tenant_id = ${tenantId}`.execute(trx);
    const raw = String(row.rows?.[0]?.value || '').trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) return parsed;
      } catch { /* fall through to the plain-number parse */ }
      const plain = Number(raw);
      if (Number.isFinite(plain) && plain >= 0) return plain;
    }
    return 500;
  }

  /**
   * M5 (INV-REP-WAIVER-APPROVAL-RULE): the rep's linked login user id,
   * resolved exactly as verifySupervisorPin resolves it
   * (delivery_representatives.phone matched against users.phone or
   * users.username). Null when the rep has no linked login — the rep
   * can then never be the actor or the approver, so there is nothing
   * to refuse on this leg. Canonical implementation lives in
   * van-common.util (shared with the M18 audit attribution).
   */
  private async resolveRepLinkedUserId(dbConn: any, tenantId: string, repId: number | null): Promise<number | null> {
    return resolveRepLinkedUserId(dbConn, tenantId, repId);
  }

  /**
   * M5 (INV-REP-WAIVER-APPROVAL-RULE): the waiver approval gate.
   * Check order (deliberate): (1) reason — a waiver with no recorded
   * reason is refused before any other work; (2) maker-checker on the
   * ACTOR — the user waiving must differ from whoever settled the
   * trip (van_sales_trips.settled_by: the supervisor who decided the
   * shortage is charged to the rep) and from the rep himself; this
   * runs before the PIN check so a self-approval attempt fails without
   * consuming a PIN verification; (3) threshold + supervisor PIN —
   * above the threshold a supervisor PIN is verified via the shared
   * authorizeManagerSecret through verifySupervisorPin (never a
   * plaintext compare, never the rep's own PIN: account-mode
   * self-approval is already refused inside verifySupervisorPin);
   * (4) maker-checker on the APPROVER — an attributed (account-mode)
   * supervisor must also differ from the trip settler. The M4 custody
   * guard runs AFTER this gate: authorization is decided before
   * posting validity, so an unauthorized request is refused as
   * unauthorized, not as a custody problem.
   *
   * Who "decided the load": the trip row records no loader
   * (van_sales_trips has no created_by; the load insert records no
   * actor and its stock movements carry userId null), so no
   * maker-checker against the original loader is enforceable from the
   * data. The enforceable decision-maker is the trip settler
   * (settled_by / supervisor_id), who decided at settleTrip whether
   * the shortage is charged to the rep or waived to warehouse losses
   * — that is the load decision this waiver would undo. When the trip
   * row is missing or settled_by is null the settler leg is skipped
   * (nothing recorded to compare against); the rep leg still applies.
   * A shared-PIN approval carries no identity, so the approver leg
   * cannot be checked in PIN mode — the actor leg is then the only
   * enforceable maker-checker check (the same honest limit
   * verifySupervisorPin documents).
   */
  private async assertRepWaiverApproval(
    trxAny: any,
    tenantId: string,
    accountId: string,
    item: { rep_id?: number | null; trip_id?: number | null; amount?: number | string | null },
    payload: { reason?: string; notes?: string; supervisorPin?: string },
    actorUserId: number | null,
  ): Promise<void> {
    const reason = String(payload.reason ?? payload.notes ?? '').trim();
    if (!reason) {
      throw new AppError(
        'سبب الإعفاء إلزامي — اكتب سبب الاعتماد الإداري قبل إعفاء البند',
        'REP_WAIVER_REASON_REQUIRED',
        400,
      );
    }
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
    const waiverAmount = roundMoney(Number(item.amount || 0), bookDigits);
    const repUserId = await this.resolveRepLinkedUserId(trxAny, tenantId, item.rep_id ? Number(item.rep_id) : null);
    let tripSettledBy: number | null = null;
    if (item.trip_id) {
      const tripRow = await trxAny
        .selectFrom('van_sales_trips')
        .select(['settled_by'])
        .where('id', '=', Number(item.trip_id))
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      tripSettledBy = tripRow?.settled_by ? Number(tripRow.settled_by) : null;
    }
    if (actorUserId && tripSettledBy && actorUserId === tripSettledBy) {
      throw new AppError(
        'لا يجوز لمن اعتمد تصفية الرحلة أن يعفي عجزها بنفسه — يعتمد الإعفاء مشرف آخر (فصل المهام)',
        'REP_WAIVER_MAKER_CHECKER',
        403,
      );
    }
    if (actorUserId && repUserId && actorUserId === repUserId) {
      throw new AppError(
        'لا يجوز للمندوب أن يعفي عجزه بنفسه — يعتمد الإعفاء مشرف آخر (فصل المهام)',
        'REP_WAIVER_MAKER_CHECKER',
        403,
      );
    }
    const threshold = await this.getRepWaiverApprovalThreshold(trxAny, tenantId);
    let supervisorId: number | null = null;
    if (waiverAmount > threshold) {
      const pin = String(payload.supervisorPin || '').trim();
      if (!pin) {
        throw new AppError(
          'الإعفاء فوق حد الاعتماد يتطلب رمز اعتماد المشرف (PIN)',
          'REP_WAIVER_SUPERVISOR_PIN_REQUIRED',
          403,
        );
      }
      const approval = await this.verifySupervisorPin(
        tenantId,
        pin,
        item.rep_id ? Number(item.rep_id) : null,
        trxAny,
        accountId,
      );
      if (!approval.approved) {
        throw new AppError(
          'رمز اعتماد المشرف (PIN) غير صحيح أو غير مصرح له بالاعتماد الاستثنائي',
          'INVALID_SUPERVISOR_PIN',
          403,
        );
      }
      supervisorId = approval.supervisorId ? Number(approval.supervisorId) : null;
    }
    if (supervisorId && tripSettledBy && supervisorId === tripSettledBy) {
      throw new AppError(
        'لا يجوز لمن اعتمد تصفية الرحلة أن يعتمد إعفاء عجزها — يعتمد الإعفاء مشرف آخر (فصل المهام)',
        'REP_WAIVER_MAKER_CHECKER',
        403,
      );
    }
  }

  /**
   * M4 (INV-REP-SHORTAGE-CUSTODY-GUARD): verify that a Dr 1160
   * custody leg actually stands for a pending stock_shortage item
   * before its waiver or cash settlement posts a Cr 1160 reversal.
   *
   * What "stands" means, grounded in postVanTripSettlement: a
   * CHARGED stock shortage books Dr 1160 / Cr 1140 on the trip's
   * van_trip_settlement journal (source_type van_trip_settlement,
   * source_id = trip id, status posted); an UNCHARGED one books
   * Dr 7200 / Cr 1140 instead, so no 1160 leg exists. Migration
   * 0225 backfilled every settled trip with stock variance > 0.01
   * into a PENDING stock_shortage row without recording which leg
   * was booked, so only the trip journal can tell them apart — the
   * linkage that survives is the item's trip_id.
   *
   * The check sums the Dr 1160 legs of the trip's posted settlement
   * journal(s) and subtracts the Cr 1160 legs of any prior waiver /
   * cash-collection reversals for stock_shortage items of the same
   * trip, then requires the net standing custody to cover the item
   * amount within one book-digit unit (10^-bookDigits, the same
   * tolerance the posting service allows between journal sides).
   * A missing trip, a missing journal, an uncharged (Dr 7200) leg,
   * or a leg smaller than the item all fail closed with
   * REP_SHORTAGE_NO_CUSTODY_LEG (422): no journal is posted and no
   * status flips — the row stays pending for manual review. A
   * legitimately charged shortage proceeds exactly as before.
   * Runs inside the caller's transaction, under the item's FOR
   * UPDATE lock, so the journal read sees the same snapshot as the
   * status flip that follows it.
   */
  private async assertRepStockShortageCustodyLeg(
    trx: any,
    tenantId: string,
    item: { trip_id?: number | null },
    amount: number,
    bookDigits: MoneyDigits,
  ): Promise<void> {
    const tolerance = 10 ** -bookDigits;
    let standingCustody = 0;
    const tripId = item.trip_id ? Number(item.trip_id) : null;
    if (tripId) {
      const custodyAccountId = await this.accountingPosting.resolveSystemAccountByCode(trx, tenantId, '1160');
      const chargedRows = await trx
        .selectFrom('journal_entry_lines as l')
        .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
        .select('l.debit as debit')
        .where('je.tenant_id', '=', tenantId)
        .where('je.source_type', '=', 'van_trip_settlement')
        .where('je.source_id', '=', tripId)
        .where('je.status', '=', 'posted')
        .where('l.account_id', '=', custodyAccountId)
        .execute();
      const charged = chargedRows.reduce((sum: number, row: any) => sum + Number(row?.debit || 0), 0);
      // Prior reversals for stock_shortage items of the same trip
      // (each reversal journal's source_id is its settlement item,
      // so the join back to the item recovers the trip): a second
      // pending row for the same trip must not reverse custody that
      // an earlier settle already cleared.
      const reversedRows = await trx
        .selectFrom('journal_entry_lines as l')
        .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
        .innerJoin('van_rep_financial_settlements as s', 's.id', 'je.source_id')
        .select('l.credit as credit')
        .where('je.tenant_id', '=', tenantId)
        .where('je.source_type', 'in', ['rep_shortage_waiver', 'rep_shortage_cash_collection'])
        .where('je.status', '=', 'posted')
        .where('s.trip_id', '=', tripId)
        .where('s.entry_type', '=', 'stock_shortage')
        .where('l.account_id', '=', custodyAccountId)
        .execute();
      const reversed = reversedRows.reduce((sum: number, row: any) => sum + Number(row?.credit || 0), 0);
      standingCustody = charged - reversed;
    }
    if (standingCustody + tolerance < amount) {
      throw new AppError(
        'العجز المخزني غير محمّل على عهدة المندوب — لا يوجد قيد مدين 1160 قائم لهذا البند، راجع تصفية الرحلة قبل التسوية',
        'REP_SHORTAGE_NO_CUSTODY_LEG',
        422,
      );
    }
  }

  /**
   * Receiving shift for a rep shortage cash collection, in the order the
   * drawer truth requires: the settler's own open shift first — the
   * cashier who took the cash is the one whose drawer must grow — then,
   * when the settler holds no shift, the latest open shift on the branch
   * of the trip's van location (the same branch-only fallback granularity
   * the trip-remittance row uses). No open shift anywhere fails closed:
   * cash with no drawer must not settle.
   */
  private async resolveRepShortageReceivingShift(
    trx: any,
    params: {
      tenantId: string;
      actorUserId: number | null;
      tripId: number | null;
    },
  ): Promise<{ id: number; branch_id: number | null; location_id: number | null }> {
    if (params.actorUserId && params.actorUserId > 0) {
      const own = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', params.tenantId)
        .where('status', '=', 'open')
        .where('opened_by', '=', params.actorUserId)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
      if (own) return own;
    }
    if (params.tripId) {
      const trip = await trx
        .selectFrom('van_sales_trips')
        .select(['van_location_id'])
        .where('id', '=', params.tripId)
        .where('tenant_id', '=', params.tenantId)
        .executeTakeFirst();
      const vanLocationId = trip?.van_location_id ? Number(trip.van_location_id) : 0;
      if (vanLocationId > 0) {
        const location = await trx
          .selectFrom('stock_locations')
          .select(['branch_id'])
          .where('id', '=', vanLocationId)
          .where('tenant_id', '=', params.tenantId)
          .executeTakeFirst();
        const branchId = location?.branch_id ? Number(location.branch_id) : null;
        const branchMatch = (eb: any) =>
          branchId == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', branchId);
        const branchShift = await trx
          .selectFrom('cashier_shifts')
          .select(['id', 'branch_id', 'location_id'])
          .where('tenant_id', '=', params.tenantId)
          .where('status', '=', 'open')
          .where(branchMatch)
          .orderBy('id', 'desc')
          .forUpdate()
          .executeTakeFirst();
        if (branchShift) return branchShift;
      }
    }
    throw new AppError('يجب فتح وردية قبل تحصيل نقدية عجز المندوب', 'OPEN_SHIFT_REQUIRED', 400);
  }

  /**
   * The drawer row for a rep shortage cash collection. It reuses the
   * trip-remittance txn_type on purpose — drawer math keys off the signed
   * amount and the 'مندوب' note, so the row lands in delivery cash-in
   * exactly like every other rep handover — with its own deterministic
   * request key, one per settlement item, under the same partial unique
   * index, so a retried collection collides instead of doubling the
   * shift's expected cash.
   */
  private async insertRepShortageCashRow(
    trx: any,
    params: {
      tenantId: string;
      accountId: string;
      settlementItemId: number;
      repName: string;
      amount: number;
      shift: { id: number; branch_id: number | null; location_id: number | null };
      createdBy: number | null;
    },
  ): Promise<void> {
    await trx
      .insertInto('treasury_transactions')
      .values({
        tenant_id: params.tenantId,
        account_id: params.accountId,
        txn_type: 'rep_cash_remittance',
        amount: params.amount,
        note: `توريد نقدية مندوب ${params.repName} - تسوية عجز #${params.settlementItemId}`,
        reference_type: 'cashier_shift',
        reference_id: Number(params.shift.id),
        branch_id: params.shift.branch_id ? Number(params.shift.branch_id) : null,
        location_id: params.shift.location_id ? Number(params.shift.location_id) : null,
        created_by: params.createdBy,
        payment_channel: 'cash',
        request_key: `rep-shortage-cash:${params.settlementItemId}`,
      } as any)
      .execute();
  }

  /**
   * Bridge representative shortages directly into HR Payroll deductions.
   */
  async pushRepShortagesToPayroll(
    tenantId: string,
    accountId: string,
    payload: {
      settlementIds: number[];
      targetMonth?: string;
    },
    authContext: AuthContext,
  ) {
    if (!payload.settlementIds || payload.settlementIds.length === 0) {
      throw new AppError('يجب تحديد بنود للتسوية والترحيل للرواتب', 'NO_ITEMS_SELECTED', 400);
    }

    const rawItems = await this.anyDb
      .selectFrom('van_rep_financial_settlements as fs')
      .innerJoin('delivery_representatives as dr', 'dr.id', 'fs.rep_id')
      .leftJoin('hr_employees as emp', 'emp.id', 'dr.employee_id')
      .select([
        'fs.id',
        'fs.rep_id as repId',
        'dr.name as repName',
        'dr.phone as repPhone',
        'dr.national_id as repNationalId',
        'dr.employee_id as employeeId',
        'emp.id as linkedEmpId',
        'emp.display_name as employeeName',
        'fs.entry_type as entryType',
        'fs.amount',
        'fs.notes',
        'fs.status',
      ])
      .where('fs.id', 'in', payload.settlementIds)
      .where('fs.tenant_id', '=', tenantId)
      .execute();

    const items = rawItems.map((r: any) => ({
      id: Number(r.id),
      repId: Number(r.repId || r.rep_id || r.repid || 0),
      repName: String(r.repName || r.rep_name || r.repname || ''),
      repPhone: r.repPhone || r.rep_phone || r.repphone || null,
      repNationalId: r.repNationalId || r.rep_national_id || r.repnationalid || null,
      employeeId: (r.employeeId || r.employee_id || r.employeeid) ? Number(r.employeeId || r.employee_id || r.employeeid) : null,
      employeeName: r.employeeName || r.employee_name || r.employeename || null,
      entryType: String(r.entryType || r.entry_type || r.entrytype || ''),
      amount: Number(r.amount || 0),
      notes: r.notes || '',
      status: String(r.status || 'pending'),
    }));

    if (items.length === 0) {
      throw new AppError('لم يتم العثور على أي بنود صالحة للترحيل', 'NO_ITEMS_FOUND', 404);
    }

    const actorUserId = authContext.userId ? Number(authContext.userId) : null;
    const targetMonth = payload.targetMonth || new Date().toISOString().slice(0, 7);
    const results: Array<{ id: number; repName: string; amount: number; success: boolean; message: string }> = [];
    // INV-REP-PAYROLL-TARGET-MONTH (M2, PD2): resolved inside the
    // transaction below — the run the deduction is targeted at.
    let effectiveMonth = targetMonth;
    let effectiveRunId: number | null = null;
    let rolledForward = false;

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      // INV-REP-PAYROLL-TARGET-MONTH (M2, PD2): targetMonth is the
      // FIRST payroll run whose period is the target month. The old
      // code dated the adjustment CURRENT_DATE, so payroll ignored
      // the month entirely and the deduction landed in whatever run
      // was built next — the wrong month's wage, or never for a rep
      // who left before the target month. The adjustment is now
      // dated inside the effective run's period, so only that run's
      // rebuild picks it up (pickup is `date <= range.to`). When the
      // target run's period already passed, the deduction rolls
      // forward to the nearest following run and the roll-forward is
      // recorded on the settlement row.
      const targetRunRow = await trxAny
        .selectFrom('hr_payroll_runs')
        .select([
          'id',
          sql<string>`to_char(start_date, 'YYYY-MM-DD')`.as('startDate'),
          sql<boolean>`end_date < CURRENT_DATE`.as('periodPassed'),
        ])
        .where('tenant_id', '=', tenantId)
        .where('period_month', '=', targetMonth)
        .orderBy('start_date', 'asc')
        .executeTakeFirst();
      let effectiveDate = `${targetMonth}-01`;
      if (targetRunRow) {
        const periodPassed = (targetRunRow as any).periodPassed === true;
        if (!periodPassed) {
          effectiveRunId = Number((targetRunRow as any).id);
          effectiveDate = String((targetRunRow as any).startDate || `${targetMonth}-01`);
        } else {
          const followingRunRow = await trxAny
            .selectFrom('hr_payroll_runs')
            .select([
              'id',
              'period_month',
              sql<string>`to_char(start_date, 'YYYY-MM-DD')`.as('startDate'),
            ])
            .where('tenant_id', '=', tenantId)
            .where('period_month', '>', targetMonth)
            .orderBy('period_month', 'asc')
            .orderBy('start_date', 'asc')
            .executeTakeFirst();
          if (followingRunRow) {
            effectiveRunId = Number((followingRunRow as any).id);
            effectiveMonth = String((followingRunRow as any).period_month || (followingRunRow as any).periodMonth || targetMonth);
            effectiveDate = String((followingRunRow as any).startDate || `${effectiveMonth}-01`);
            rolledForward = true;
          } else {
            // No following run exists yet: keep the target run, so
            // the deduction stays dated inside the target month and
            // the next run built picks it up (date <= range.to).
            effectiveRunId = Number((targetRunRow as any).id);
            effectiveDate = String((targetRunRow as any).startDate || `${targetMonth}-01`);
          }
        }
      }
      const rollForwardNote = rolledForward
        ? ` — تم الترحيل لشهر ${effectiveMonth} بدلاً من ${targetMonth} لأن فترة مسير ${targetMonth} انتهت`
        : '';
      // Migration 0225 declares payroll_run_id on the settlement
      // rows; older harnesses model the table without it. The link
      // is traceability only — a missing column must never fail the
      // push itself, so the write is skipped when the column is absent.
      const linkColumn = await sql<{ exists: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'van_rep_financial_settlements'
            AND column_name = 'payroll_run_id'
        ) AS exists
      `.execute(trx);
      const canWriteRunLink = linkColumn.rows[0]?.exists === true;

      for (const item of items) {
        // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the status above comes
        // from a snapshot read before the transaction, so two
        // concurrent pushes both see 'pending' and both insert a
        // payroll adjustment for the same shortage. Re-read the row
        // under lock and flip it with a status predicate, checking
        // the affected row — the loser sees 'pushed_to_payroll' here
        // and records a failure instead of a second deduction.
        const lockedItem = await trxAny
          .selectFrom('van_rep_financial_settlements')
          .select(['id', 'status', 'amount', 'notes'])
          .where('id', '=', item.id)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (!lockedItem) {
          results.push({
            id: Number(item.id),
            repName: item.repName,
            amount: Number(item.amount),
            success: false,
            message: 'البند تمت تسويته مسبقاً',
          });
          continue;
        }

        // INV-PAYROLL-PUSH-FAIL-CLOSED: a row already flipped to
        // pushed_to_payroll is retryable ONLY when no payroll
        // adjustment was ever written for it. The pre-fix code flipped
        // the row and then skipped the insert when no employee was
        // linked, so the shortage vanished with no deduction and no
        // retry. A flipped row WITH an adjustment is genuinely pushed
        // and stays refused, so a re-push can never double-deduct.
        let isRepush = false;
        if (lockedItem.status === 'pushed_to_payroll') {
          const existingAdjustment = await trxAny
            .selectFrom('hr_employee_adjustments')
            .select('id')
            .where('tenant_id', '=', tenantId)
            .where('source_type', '=', 'van_sales_settlement')
            .where('source_id', '=', String(item.id))
            .executeTakeFirst();
          if (existingAdjustment) {
            results.push({
              id: Number(item.id),
              repName: item.repName,
              amount: Number(item.amount),
              success: false,
              message: 'البند تمت تسويته مسبقاً',
            });
            continue;
          }
          isRepush = true;
        } else if (lockedItem.status !== 'pending') {
          results.push({
            id: Number(item.id),
            repName: item.repName,
            amount: Number(item.amount),
            success: false,
            message: 'البند تمت تسويته مسبقاً',
          });
          continue;
        }

        // Try to resolve HR employee if not already linked
        let resolvedEmployeeId = item.employeeId ? Number(item.employeeId) : null;
        if (!resolvedEmployeeId) {
          // INV-REP-EMPLOYEE-MATCH-DETERMINISTIC (M3, A4): the old
          // match was one unordered OR query — `display_name ILIKE
          // %repName%` OR `national_id = …` with executeTakeFirst()
          // and no ORDER BY — so with several matching employees the
          // linked employee was whichever row the planner returned
          // first, and a % or _ in the rep name matched spuriously
          // as a LIKE wildcard. The match is now deterministic in
          // two ordered steps: (1) an exact national_id match wins
          // over any name match; (2) the name match escapes LIKE
          // wildcards (% _ and backslash) and orders by id, so the
          // same input always links the same employee. The link is
          // still permanent (written to delivery_representatives
          // below), so determinism here is what keeps a rep's
          // shortage off the wrong employee's pay.
          let candidateEmp: { id: number; display_name: string } | undefined;
          if (item.repNationalId) {
            candidateEmp = await trxAny
              .selectFrom('hr_employees')
              .select(['id', 'display_name'])
              .where('tenant_id', '=', tenantId)
              .where('national_id', '=', item.repNationalId)
              .orderBy('id', 'asc')
              .executeTakeFirst();
          }
          if (!candidateEmp) {
            const escapedName = String(item.repName || '')
              .replace(/\\/g, '\\\\')
              .replace(/%/g, '\\%')
              .replace(/_/g, '\\_');
            candidateEmp = await trxAny
              .selectFrom('hr_employees')
              .select(['id', 'display_name'])
              .where('tenant_id', '=', tenantId)
              .where(sql<boolean>`display_name ILIKE ${`%${escapedName}%`} ESCAPE '\\'`)
              .orderBy('id', 'asc')
              .executeTakeFirst();
          }

          if (candidateEmp?.id) {
            resolvedEmployeeId = Number(candidateEmp.id);
            await trxAny
              .updateTable('delivery_representatives')
              .set({ employee_id: resolvedEmployeeId, updated_at: sql`NOW()` })
              .where('id', '=', item.repId)
              .where('tenant_id', '=', tenantId)
              .execute();
          }
        }

        // INV-PAYROLL-PUSH-FAIL-CLOSED: fail closed — a push with no
        // linked employee is REFUSED and the row stays pending, so it
        // can be pushed after the rep is linked. The old code flipped
        // the row and reported success with no deduction written.
        if (!resolvedEmployeeId) {
          results.push({
            id: Number(item.id),
            repName: item.repName,
            amount: Number(item.amount),
            success: false,
            message: `لم يتم الترحيل: المندوب ${item.repName} غير مرتبط بموظف في الموارد البشرية — اربط المندوب بموظف ثم أعد الترحيل`,
          });
          continue;
        }

        if (!isRepush) {
          const flipped = await trxAny
            .updateTable('van_rep_financial_settlements')
            .set({
              status: 'pushed_to_payroll',
              settlement_method: 'payroll',
              settled_at: sql`NOW()`,
              settled_by: actorUserId,
              ...(canWriteRunLink && effectiveRunId !== null ? { payroll_run_id: effectiveRunId } : {}),
              notes: `${item.notes ? item.notes + ' | ' : ''}تم ترحيل العجز لمسير رواتب شهر ${effectiveMonth} (موظف #${resolvedEmployeeId})${rollForwardNote}`,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', item.id)
            .where('tenant_id', '=', tenantId)
            .where('status', '=', 'pending')
            .returning('id')
            .execute();
          if (flipped.length !== 1) {
            results.push({
              id: Number(item.id),
              repName: item.repName,
              amount: Number(item.amount),
              success: false,
              message: 'البند تمت تسويته مسبقاً',
            });
            continue;
          }
        } else {
          // The row was already flipped by the failed pre-fix push;
          // record the retry in the notes instead of flipping again.
          await trxAny
            .updateTable('van_rep_financial_settlements')
            .set({
              ...(canWriteRunLink && effectiveRunId !== null ? { payroll_run_id: effectiveRunId } : {}),
              notes: `${lockedItem.notes ? lockedItem.notes + ' | ' : ''}أعيد ترحيل العجز لمسير رواتب شهر ${effectiveMonth} (موظف #${resolvedEmployeeId})${rollForwardNote}`,
              updated_at: sql`NOW()`,
            })
            .where('id', '=', item.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }

        // INV-PAYROLL-PUSH-FAIL-CLOSED: the adjustment is always
        // written now — the no-employee case is refused above, so
        // reaching here without a deduction is impossible. amount_type
        // is 'money': 'fixed' is not a legal unit ('money' | 'days' |
        // 'hours') and made the whole payroll run build fail with
        // HR_PAYROLL_DATED_ADJUSTMENT_INVALID.
        const isShortage = ['cash_shortage', 'stock_shortage'].includes(item.entryType);
        const adjType = isShortage ? 'deduction' : 'allowance';
        const adjReason = isShortage
          ? `استقطاع عجز سيارة فان (حركة #${item.id} - ${item.notes || 'عجز مبيعات'})`
          : `صرف بونص/عمولة سيارة فان (حركة #${item.id} - ${item.notes || 'حافز مبيعات'})`;

        await trxAny
          .insertInto('hr_employee_adjustments')
          .values({
            tenant_id: tenantId,
            employee_id: Number(resolvedEmployeeId),
            adjustment_type: adjType,
            amount_type: 'money',
            amount: Number(lockedItem.amount),
            // INV-REP-PAYROLL-TARGET-MONTH: dated inside the
            // effective run's period, never CURRENT_DATE — the run
            // rebuild picks up adjustments by `date <= range.to`,
            // so this date is what puts the deduction in the
            // targeted month's run.
            date: effectiveDate,
            reason: adjReason,
            status: 'pending',
            source_type: 'van_sales_settlement',
            source_id: String(item.id),
            created_by: actorUserId,
            updated_by: actorUserId,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .execute();

        results.push({
          id: Number(item.id),
          repName: item.repName,
          amount: Number(item.amount),
          success: true,
          message: isRepush
            ? `أعيد الترحيل بنجاح لملف الموظف في مسير شهر ${effectiveMonth}`
            : `تم الترحيل بنجاح لملف الموظف في مسير شهر ${effectiveMonth}`,
        });
      }
    });

    return {
      ok: true,
      targetMonth,
      effectiveMonth,
      effectiveRunId,
      rolledForward,
      processedCount: results.filter((r) => r.success).length,
      results,
    };
  }

  /**
   * Add manual bonus or commission to representative financial ledger.
   */
  async addRepBonusOrCommission(
    tenantId: string,
    accountId: string,
    payload: {
      repId: number;
      entryType: 'bonus' | 'commission';
      amount: number;
      notes: string;
    },
    authContext: AuthContext,
  ) {
    const rep = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name'])
      .where('id', '=', payload.repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!rep) throw new AppError('مندوب التوزيع غير موجود', 'REP_NOT_FOUND', 404);

    // Book digits resolved once (D4): the bonus/commission amount
    // below rounds at book digits, never a hardcoded 2dp.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const amount = roundMoney(Number(payload.amount || 0), moneyDigits);
    if (amount <= 0) throw new AppError('يجب أن يكون المبلغ أكبر من صفر', 'INVALID_AMOUNT', 400);

    const inserted = await this.anyDb
      .insertInto('van_rep_financial_settlements')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        rep_id: payload.repId,
        trip_id: null,
        entry_type: payload.entryType,
        amount,
        status: 'pending',
        notes: payload.notes || (payload.entryType === 'bonus' ? 'مكافأة تميز ميداني' : 'عمولة مبيعات'),
        created_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .returning(['id', 'amount', 'entry_type as entryType', 'status'])
      .executeTakeFirst();

    return {
      ok: true,
      settlement: inserted,
      repName: rep.name,
    };
  }

  /**
   * Link delivery representative to an HR employee.
   */
  async linkRepToEmployee(
    tenantId: string,
    repId: number,
    employeeId: number | null,
  ) {
    await this.anyDb
      .updateTable('delivery_representatives')
      .set({ employee_id: employeeId, updated_at: sql`NOW()` })
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .execute();
    return { ok: true, repId, employeeId };
  }

  /**
   * List active candidate HR employees for linking to delivery representatives.
   */
  async listCandidateEmployees(tenantId: string) {
    const rows = await this.anyDb
      .selectFrom('hr_employees')
      .select([
        'id',
        'employee_no as employeeNo',
        'display_name as displayName',
        'national_id as nationalId',
        'status',
      ])
      .where('tenant_id', '=', tenantId)
      .where('status', '!=', 'terminated')
      .orderBy('display_name', 'asc')
      .execute();

    return rows.map((r: any) => ({
      id: Number(r.id),
      employeeNo: r.employeeNo || r.employeeno || null,
      displayName: r.displayName || r.displayname || '',
      nationalId: r.nationalId || r.nationalid || null,
      status: r.status,
    }));
  }

  /**
   * Automatically create an HR employee record for a delivery representative and link them.
   */
  async autoCreateEmployeeForRep(
    tenantId: string,
    accountId: string,
    repId: number,
    authContext: AuthContext,
  ) {
    const rep = await this.anyDb
      .selectFrom('delivery_representatives')
      .selectAll()
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!rep) throw new AppError('مندوب التوزيع غير موجود', 'REP_NOT_FOUND', 404);

    if (rep.employee_id) {
      const existingEmp = await this.anyDb
        .selectFrom('hr_employees')
        .select(['id', 'display_name', 'employee_no'])
        .where('id', '=', rep.employee_id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (existingEmp) {
        return {
          ok: true,
          employeeId: Number(existingEmp.id),
          displayName: existingEmp.display_name,
          employeeNo: existingEmp.employee_no,
          message: 'المندوب مربوط بالفعل بملف موظف موجود',
        };
      }
    }

    const nameParts = String(rep.name || 'مندوب توزيع').trim().split(/\s+/);
    const firstName = nameParts[0] || 'مندوب';
    const lastName = nameParts.slice(1).join(' ') || '.';
    const displayName = String(rep.name || 'مندوب توزيع').trim();
    const employeeNo = `EMP-${String(rep.id).padStart(4, '0')}`;
    const actorUserId = authContext.userId ? Number(authContext.userId) : null;

    const inserted = await this.anyDb
      .insertInto('hr_employees')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        employee_no: employeeNo,
        first_name: firstName,
        last_name: lastName,
        display_name: displayName,
        national_id: rep.national_id || null,
        status: 'active',
        compensation_type: 'salary',
        pay_frequency: 'monthly',
        overtime_policy: 'default',
        attendance_policy: 'default',
        has_social_insurance: false,
        has_income_tax: false,
        grace_minutes: 15,
        notes: `تم إنشاؤه تلقائياً من منظومة مناديب وسيارات الفان (معرف مندوب #${rep.id})`,
        created_by: actorUserId,
        updated_by: actorUserId,
        mobile_punch_enabled: false,
        used_annual_leaves: 0,
        created_at: sql`NOW()`,
        updated_at: sql`NOW()`,
      })
      .returning(['id', 'employee_no as employeeNo', 'display_name as displayName'])
      .executeTakeFirst();

    if (!inserted) throw new AppError('فشل إنشاء ملف موظف HR', 'CREATE_EMPLOYEE_FAILED', 500);

    await this.anyDb
      .updateTable('delivery_representatives')
      .set({ employee_id: Number(inserted.id), updated_at: sql`NOW()` })
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      ok: true,
      employeeId: Number(inserted.id),
      displayName: inserted.displayName,
      employeeNo: inserted.employeeNo,
    };
  }
}

