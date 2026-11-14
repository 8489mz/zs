import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
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
} from './van-trip-reconciliation.engine';
import {
  sortItemsByProductId,
  moveVanStock,
  getOrCreateVanLocation,
  generateDailySequenceNumber,
  FLEET_VEHICLE_STATUSES,
  fieldCollectionPaymentScope,
  resolveFieldCollectionChannel,
  resolveRepLinkedUserId,
} from './services/van-common.util';
import {
  extractCoordinatesFromCustomerLocation,
  evaluateGeofenceCompliance,
  isValidCoordinatePair,
  type RepTargetCalculationResult,
} from './rep-target.engine';
import { VanFleetService } from './services/van-fleet.service';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { todayLocalIsoDate } from '../sales/helpers/sales-write.helper';
import { VanRequisitionsService } from './services/van-requisitions.service';
import { VanReturnsService } from './services/van-returns.service';
import { VanTargetsService } from './services/van-targets.service';
import { VanTransfersService } from './services/van-transfers.service';
import { VanRoutesService } from './services/van-routes.service';
import { VanFraudRadarService, RecordVanSuspicionParams } from './services/van-fraud-radar.service';
import { VanCollectionsAndSwapsService } from './services/van-collections-and-swaps.service';
import { VanFieldSalesService } from './services/van-field-sales.service';
import { VanTripLifecycleService } from './services/van-trip-lifecycle.service';
import { VanRepFinancialLedgerService } from './services/van-rep-financial-ledger.service';
import { VanExpensesPackagingCustomersService } from './services/van-expenses-packaging-customers.service';
import { VanRepEmployeeLinkService } from './services/van-rep-employee-link.service';
import { VanRequisitionDispatchService } from './services/van-requisition-dispatch.service';
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
  private collectionsAndSwaps: VanCollectionsAndSwapsService | undefined;
  private fieldSales: VanFieldSalesService | undefined;
  private tripLifecycle: VanTripLifecycleService | undefined;
  private repFinancialLedger: VanRepFinancialLedgerService | undefined;
  private expensesPackagingCustomers: VanExpensesPackagingCustomersService | undefined;
  private repEmployeeLink: VanRepEmployeeLinkService | undefined;
  private requisitionDispatch: VanRequisitionDispatchService | undefined;

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
    this.getCollectionsAndSwaps();
  }

  private getCollectionsAndSwaps(): VanCollectionsAndSwapsService {
    if (!this.collectionsAndSwaps) {
      this.collectionsAndSwaps = new VanCollectionsAndSwapsService({
        db: this.db,
        audit: this.audit,
        accountingPosting: this.accountingPosting,
        vanFraudRadarService: this.vanFraudRadarService ?? new VanFraudRadarService(this.db),
        generateDailySequenceNumber: this.generateDailySequenceNumber.bind(this),
        recordSuspicionEvent: this.recordSuspicionEvent.bind(this),
        resolveSystemAuthContext: this.resolveSystemAuthContext.bind(this),
        verifySupervisorPin: this.verifySupervisorPin.bind(this),
        moveVanStock: this.moveVanStock.bind(this),
      });
    }
    return this.collectionsAndSwaps;
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

  // Lazy accessor (sales-write S2 pattern), LAZY-ONLY by design: the
  // ctor must NOT call getRepFinancialLedgerService() — an eager bind
  // would freeze the REAL verifySupervisorPin before specs can mock
  // it. The waiver gate (assertRepWaiverApproval) verifies a
  // supervisor PIN above the threshold, and specs mock
  // verifySupervisorPin on the instance AFTER construction. The
  // accessor binds on first delegate call, after any mock is
  // assigned, so Object.create specs (no ctor) and new-constructed
  // specs (mock after ctor) both work. Named
  // getRepFinancialLedgerService() because getRepFinancialLedger()
  // itself is a delegate method name on this class.
  private getRepFinancialLedgerService(): VanRepFinancialLedgerService {
    if (!this.repFinancialLedger) {
      this.repFinancialLedger = new VanRepFinancialLedgerService({
        db: this.db,
        audit: this.audit,
        accountingPosting: this.accountingPosting,
        verifySupervisorPin: this.verifySupervisorPin.bind(this),
      });
    }
    return this.repFinancialLedger;
  }

  // Lazy accessor (sales-write S2/S3 pattern), LAZY-ONLY by design: the
  // ctor must NOT call getExpensesPackagingCustomers() — an eager bind would
  // freeze the REAL verifySupervisorPin before specs can mock it
  // post-construction (van-field-sale-tax-optional mocks it). The accessor
  // binds on first delegate call, after any mock is assigned, so
  // Object.create specs (no ctor) and new-constructed specs (mock after
  // ctor) both work. Production is unaffected: Nest never monkey-patches,
  // and the helper is stateless, so first-call construction is
  // behaviorally identical to ctor construction.
  private getExpensesPackagingCustomers(): VanExpensesPackagingCustomersService {
    if (!this.expensesPackagingCustomers) {
      this.expensesPackagingCustomers = new VanExpensesPackagingCustomersService({
        db: this.db,
        audit: this.audit,
        verifySupervisorPin: this.verifySupervisorPin.bind(this),
        recordSuspicionEvent: this.recordSuspicionEvent.bind(this),
        assertTripOwnedByRep: this.assertTripOwnedByRep.bind(this),
        assertRepServedCustomer: this.assertRepServedCustomer.bind(this),
        getOrCreateVanLocation: this.getOrCreateVanLocation.bind(this),
        resolveRepLinkedUserId: this.resolveRepLinkedUserId.bind(this),
      });
    }
    return this.expensesPackagingCustomers;
  }

  // Lazy accessor (sales-write S2 pattern), LAZY-ONLY by design: the
  // ctor must NOT call getRequisitionDispatch() — an eager bind would
  // freeze the REAL approveAndDispatchRequisition before specs can
  // mock it post-construction (driver-requisition-dto-whitelist case
  // (d) mocks it on the facade instance). The accessor binds on first
  // delegate call, after any mock is assigned, so Object.create specs
  // (no ctor) and new-constructed specs (mock after ctor) both work.
  // Production is unaffected: Nest never monkey-patches, and the
  // helper is stateless, so first-call construction is behaviorally
  // identical to ctor construction.
  private getRequisitionDispatch(): VanRequisitionDispatchService {
    if (!this.requisitionDispatch) {
      this.requisitionDispatch = new VanRequisitionDispatchService({
        db: this.db,
        vanRequisitionsService: this.vanRequisitionsService,
        submitLoadRequisition: this.submitLoadRequisition.bind(this),
        dispatchRequisition: this.approveAndDispatchRequisition.bind(this),
        loadSupplementaryStockToActiveTrip: this.loadSupplementaryStockToActiveTrip.bind(this),
        openTripAndLoad: this.openTripAndLoad.bind(this),
      });
    }
    return this.requisitionDispatch;
  }

  // Lazy accessor (sales-write S2/S3 pattern), LAZY-ONLY by design: the
  // ctor must NOT call getRepEmployeeLink() — Object.create specs drive
  // facade methods with no constructor, and the accessor binds on first
  // delegate call, after any mock is assigned, so Object.create specs
  // (no ctor) and new-constructed specs (mock after ctor) both work.
  // The moved methods use only this.anyDb, so no facade helper is
  // bound here and no post-construction mock can be frozen.
  private getRepEmployeeLink(): VanRepEmployeeLinkService {
    if (!this.repEmployeeLink) {
      this.repEmployeeLink = new VanRepEmployeeLinkService({
        db: this.db,
      });
    }
    return this.repEmployeeLink;
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

  private async recordFieldCollectionInternal(repId: number, tenantId: string, accountId: string, payload: {
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
    }) {
    return this.getCollectionsAndSwaps().recordFieldCollectionInternal(repId, tenantId, accountId, payload);
  }

  async executeDamagedSwap(repId: number, tenantId: string, accountId: string, payload: {
      tripId: number;
      customerId?: number;
      damagedProductId: number;
      damagedQty: number;
      damageReason?: string;
      replacementProductId: number;
      replacementQty: number;
      notes?: string;
      clientTxId?: string;
    }): Promise<{
    ok: boolean;
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }> {
    return this.getCollectionsAndSwaps().executeDamagedSwap(repId, tenantId, accountId, payload);
  }







  /**
   * Lists all damaged goods swaps performed on a trip.
   */
  private async assertTripOwnedByRep(tenantId: string, tripId: number, repId: number): Promise<void> {
    return this.getCollectionsAndSwaps().assertTripOwnedByRep(tenantId, tripId, repId);
  }

  private async listRepServedCustomerIds(tenantId: string, repId: number): Promise<Set<number>> {
    return this.getCollectionsAndSwaps().listRepServedCustomerIds(tenantId, repId);
  }

  private async assertRepServedCustomer(tenantId: string, repId: number, customerId: number): Promise<void> {
    return this.getCollectionsAndSwaps().assertRepServedCustomer(tenantId, repId, customerId);
  }

  async listTripDamagedSwaps(tenantId: string, tripId: number, repId?: number) {
    return this.getCollectionsAndSwaps().listTripDamagedSwaps(tenantId, tripId, repId);
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

  async createLoadRequisitionByAdmin(tenantId: string, accountId: string, userId: number, payload: {
      repId: number;
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
      notes?: string;
      dispatchImmediately?: boolean;
    }) {
    return this.getRequisitionDispatch().createLoadRequisitionByAdmin(tenantId, accountId, userId, payload);
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
    return this.getRequisitionDispatch().approveAndDispatchRequisition(tenantId, accountId, requisitionId, reviewedByUserId);
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
    return this.getExpensesPackagingCustomers().recordTripExpense(repId, tenantId, accountId, payload, authContext);
  }

  async getTripExpenses(tripId: number, tenantId: string, repId?: number) {
    return this.getExpensesPackagingCustomers().getTripExpenses(tripId, tenantId, repId);
  }

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
    return this.getExpensesPackagingCustomers().recordPackagingMovement(repId, tenantId, accountId, payload);
  }

  async getTripPackagingMovements(tripId: number, tenantId: string, repId?: number) {
    return this.getExpensesPackagingCustomers().getTripPackagingMovements(tripId, tenantId, repId);
  }

  async getCustomerPackagingBalance(customerId: number, tenantId: string, repId?: number) {
    return this.getExpensesPackagingCustomers().getCustomerPackagingBalance(customerId, tenantId, repId);
  }

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
    return this.getExpensesPackagingCustomers().createDriverCustomer(repId, tenantId, accountId, body);
  }

  async getCustomerSuggestedOrder(tenantId: string, accountId: string, repId: number, customerId: number) {
    return this.getExpensesPackagingCustomers().getCustomerSuggestedOrder(tenantId, accountId, repId, customerId);
  }

  async getCustomerLastSoldPrices(tenantId: string, customerId: number, repId?: number) {
    return this.getExpensesPackagingCustomers().getCustomerLastSoldPrices(tenantId, customerId, repId);
  }

  async getCustomerFieldStatement(tenantId: string, customerId: number, repId?: number) {
    return this.getExpensesPackagingCustomers().getCustomerFieldStatement(tenantId, customerId, repId);
  }

  async getRepFinancialLedger(tenantId: string, filters: {
      repId?: number;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    }) {
    return this.getRepFinancialLedgerService().getRepFinancialLedger(tenantId, filters);
  }

  async settleRepFinancialItem(tenantId: string, accountId: string, id: number, payload: {
      method: 'cash' | 'waiver';
      notes?: string;
      reason?: string;
      supervisorPin?: string;
    }, authContext: AuthContext) {
    return this.getRepFinancialLedgerService().settleRepFinancialItem(tenantId, accountId, id, payload, authContext);
  }



  private async resolveRepLinkedUserId(dbConn: any, tenantId: string, repId: number | null): Promise<number | null> {
    return this.getRepFinancialLedgerService().resolveRepLinkedUserId(dbConn, tenantId, repId);
  }









  async pushRepShortagesToPayroll(tenantId: string, accountId: string, payload: {
      settlementIds: number[];
      targetMonth?: string;
    }, authContext: AuthContext) {
    return this.getRepFinancialLedgerService().pushRepShortagesToPayroll(tenantId, accountId, payload, authContext);
  }

  async addRepBonusOrCommission(tenantId: string, accountId: string, payload: {
      repId: number;
      entryType: 'bonus' | 'commission';
      amount: number;
      notes: string;
    }, authContext: AuthContext) {
    return this.getRepFinancialLedgerService().addRepBonusOrCommission(tenantId, accountId, payload, authContext);
  }

  /**
   * Link delivery representative to an HR employee.
   */
  async linkRepToEmployee(
    tenantId: string,
    repId: number,
    employeeId: number | null,
  ) {
    return this.getRepEmployeeLink().linkRepToEmployee(tenantId, repId, employeeId);
  }

  /**
   * List active candidate HR employees for linking to delivery representatives.
   */
  async listCandidateEmployees(tenantId: string) {
    return this.getRepEmployeeLink().listCandidateEmployees(tenantId);
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
    return this.getRepEmployeeLink().autoCreateEmployeeForRep(tenantId, accountId, repId, authContext);
  }
}

