import { assertBusinessAccountingDate } from '../accounting/accounting-boundaries';
import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService, AUDIT_EVENT_CODES } from '../../core/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { boundedPage } from '../../common/utils/bounded-page';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { DeliveryRepsService } from './delivery-reps.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import {
  reconcileTripFinancials,
  reconcileVanStockAudit,
  evaluateCreditLimitCheck,
  evaluateOdometerReadings,
  evaluateMakerCheckerSettlement,
  evaluateNightStockRetention,
  evaluateFieldCardPayment,
  evaluateTripExpenseGovernance,
  evaluateDamagedSwap,
} from './van-trip-reconciliation.engine';
import {
  sortItemsByProductId,
  moveVanStock,
  getOrCreateVanLocation,
  generateDailySequenceNumber,
  getMonthlyOfficialHolidayDates,
  FLEET_VEHICLE_STATUSES,
  normalizeCustomerCode,
  formatCustomerCode,
  getCustomerRepBalancesMap,
  fieldCollectionPaymentScope,
} from './services/van-common.util';
import {
  calculateRepTargetMetrics,
  extractCoordinatesFromCustomerLocation,
  evaluateGeofenceCompliance,
  isValidCoordinatePair,
  evaluateBatchExpiryStatus,
  extractAssignedRepIds,
  resolveIsolatedRepCustomerBalance,
  validateIsolatedRepCollection,
  type RepTargetCalculationResult,
} from './rep-target.engine';
import { VanFleetService } from './services/van-fleet.service';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { isOfferActive, pickBestApplicableOffer, todayLocalIsoDate } from '../sales/helpers/sales-write.helper';
import { resolveSaleTaxRate } from '../sales/engines/sale-tax-rate.engine';
import { computeInvoiceTotals } from '../../common/utils/invoice-totals';
import { computeCashDrawerVariance } from '../cash-drawer/helpers/cash-drawer.helper';
import { VanRequisitionsService } from './services/van-requisitions.service';
import { DAY_KEY_TO_ARABIC, normalizeDayKey } from './van-routes-schedule.util';
import { VanReturnsService } from './services/van-returns.service';
import { VanTargetsService } from './services/van-targets.service';
import { VanTransfersService } from './services/van-transfers.service';
import { VanRoutesService } from './services/van-routes.service';
import { VanFraudRadarService, RecordVanSuspicionParams } from './services/van-fraud-radar.service';
import { authorizeManagerSecret } from '../../common/utils/manager-approval';

export interface VanStockItem {
  productId: number;
  productName: string;
  barcode: string;
  qty: number;
  mainWarehouseQty?: number;
  costPrice: number;
  retailPrice: number;
  unitName?: string;
  originalPrice?: number;
  discountPerUnit?: number;
  hasActiveOffer?: boolean;
  offerBadge?: string;
  packagingUnit?: { name: string; multiplier: number };
  availableUnits?: { id: number; name: string; multiplier: number; isBase: boolean }[];
  earliestExpiryDate?: string | null;
  batchNumber?: string | null;
  expiryStatus?: 'valid' | 'near_expiry' | 'expired' | 'no_expiry';
  daysToExpiry?: number | null;
}

export interface VanTripSummary {
  id: number;
  repId: number;
  repName: string;
  vehicleId?: number;
  vehiclePlate?: string;
  vehicleModel?: string;
  shiftName?: string;
  startOdometer?: number;
  endOdometer?: number;
  vanLocationId: number;
  vanLocationName: string;
  sourceWarehouseId: number;
  sourceWarehouseName: string;
  status: 'open' | 'settled' | string;
  settlementStatus?: 'open' | 'submitted_by_rep' | 'settled' | string;
  openedAt: string;
  closedAt?: string;
  submittedAt?: string;
  loadedAmount: number;
  salesAmount: number;
  cashCollected: number;
  creditSales: number;
  returnsAmount: number;
  cashRefunds?: number;
  variance: number;
  distanceKm?: number;
  stockVarianceAmount?: number;
  nightStockApproved?: boolean;
  totalInstapaySales?: number;
  totalInstapayCollections?: number;
  notes?: string;
}

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
    this.vanReturnsService = vanReturnsService ?? new VanReturnsService(db, accountingPosting, this.vanFraudRadarService);
    this.vanTargetsService = vanTargetsService ?? new VanTargetsService(db);
    this.vanTransfersService = vanTransfersService ?? new VanTransfersService(db);
    this.vanRoutesService = vanRoutesService ?? new VanRoutesService(db, this.vanFleetService, this.vanFraudRadarService);
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
  private async resolveSystemAuthContext(tenantId: string, accountId: string): Promise<AuthContext> {
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

  /**
   * Verifies a supervisor approval secret via the ONE shared
   * manager-approval rule (INV-SPIRIT-MANAGER-APPROVAL-SHARED /
   * INV-VAN-SUPERVISOR-PIN-AUTHORIZED): the shared manager PIN from
   * settings (bcrypt via authorizeManagerSecret; a legacy plaintext
   * stored value verifies once then hashes in place) or the login
   * password of an ACTIVE admin / super_admin. Plaintext
   * users.pin / pin_hash and delivery_representatives.pin_hash are
   * NEVER compared here: a bcrypt hash can never match a plaintext
   * comparison, so hashed PINs could never verify under the old code.
   * Maker-checker still enforced where the secret is attributable:
   * account mode carries the approver id, so the rep's own login
   * password approving his own operation is refused; PIN mode
   * carries no id — the shared PIN belongs to no single user, so no
   * attribution is invented (same honest limit as cash-drawer).
   * A shared-PIN approval therefore records no individual
   * (settled_by / supervisor_id / journal created_by stay null);
   * the old "first supervisor by id" attribution was false and is gone.
   */
  async verifySupervisorPin(
    tenantId: string,
    pinInput?: string | null,
    repId?: number | null,
    queryable?: any,
    accountId?: string | null,
  ): Promise<{
    approved: boolean;
    supervisorId?: number;
    supervisorName?: string;
    supervisorRole?: string;
  }> {
    const cleanPin = String(pinInput || '').trim();
    if (!cleanPin) {
      return { approved: false };
    }

    const dbConn = queryable || this.anyDb;
    // Maker-checker needs the rep's linked login id only. The rep's
    // stored PIN values are never read for comparison here.
    let repUserId: number | null = null;
    if (repId && Number(repId) > 0) {
      const repRow = await dbConn
        .selectFrom('delivery_representatives')
        .select(['phone'])
        .where('id', '=', Number(repId))
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (repRow?.phone) {
        const repUser = await dbConn
          .selectFrom('users')
          .select(['id'])
          .where('tenant_id', '=', tenantId)
          .where(sql<boolean>`(phone = ${String(repRow.phone)} or username = ${String(repRow.phone)})`)
          .executeTakeFirst();
        if (repUser) {
          repUserId = Number(repUser.id);
        }
      }
    }

    // The shared rule needs tenant + account scope. Every production
    // caller passes its accountId; a direct caller that does not gets
    // the tenant's earliest user account as a best effort, and a
    // tenant with no users at all fails closed in requireTenantScope.
    let scopeAccountId = String(accountId || '').trim();
    if (!scopeAccountId) {
      try {
        const scopeUser = await dbConn
          .selectFrom('users')
          .select(['account_id'])
          .where('tenant_id', '=', tenantId)
          .orderBy('id', 'asc')
          .executeTakeFirst();
        scopeAccountId = String((scopeUser as any)?.account_id || '').trim();
      } catch {
        scopeAccountId = '';
      }
    }
    const approvalAuth: AuthContext = {
      userId: 0,
      sessionId: 'van-supervisor-pin',
      username: 'supervisor-pin',
      role: 'supervisor',
      permissions: [],
      tenantId,
      accountId: scopeAccountId,
    };

    let approval: { mode: 'pin' | 'account'; authorizedByName: string; authorizedById?: number };
    try {
      approval = await authorizeManagerSecret(dbConn, approvalAuth, cleanPin);
    } catch (err) {
      const code = (err as AppError)?.code;
      if (code === 'MANAGER_AUTH_INVALID' || code === 'MANAGER_AUTH_REQUIRED') {
        await this.vanFraudRadarService.recordSuspicionEvent({
          tenantId,
          repId: repId ? Number(repId) : null,
          eventCode: 'VAN_SUSPICION_INVALID_PIN',
          severity: 'high',
          titleAr: 'إدخال رمز اعتماد مشرف (PIN) خاطئ أو غير مصرح',
          detailsAr: 'حاول المندوب إدخال رمز اعتماد مشرف غير صحيح لتمرير عملية استثنائية في الميدان.',
        });
        throw new AppError(
          'رمز اعتماد المشرف (PIN) غير صحيح أو غير مصرح له بالاعتماد الاستثنائي',
          'INVALID_SUPERVISOR_PIN',
          403,
        );
      }
      throw err;
    }

    // Account mode carries attribution, so the rep approving his own
    // operation with his own login password is refused here. PIN mode
    // carries no id and is never attributed to any user.
    if (
      approval.mode === 'account' &&
      approval.authorizedById &&
      repUserId &&
      Number(approval.authorizedById) === repUserId
    ) {
      await this.vanFraudRadarService.recordSuspicionEvent({
        tenantId,
        repId: repId ? Number(repId) : null,
        eventCode: 'VAN_SUSPICION_SELF_APPROVAL',
        severity: 'critical',
        titleAr: 'محاولة اعتماد ذاتي من المندوب لنفسه (خرق فصل المهام Maker-Checker)',
        detailsAr: 'حاول المندوب إدخال رمزه السري الشخصي لاعتماد عملية استثنائية لنفسه في الميدان بدلاً من المشرف.',
      });
      throw new AppError(
        'لا يجوز لمندوب المبيعات استخدام رمزه الشخصي لاعتماد عملياته الميدانية طبقاً لمبدأ فصل المهام الرقابي (Maker-Checker)',
        'MAKER_CHECKER_SELF_APPROVAL',
        403,
      );
    }

    if (approval.mode === 'account') {
      if (approval.authorizedById) {
        const supervisorUser = await dbConn
          .selectFrom('users')
          .select(['role', sql<string>`coalesce(display_name, username)`.as('name')])
          .where('id', '=', Number(approval.authorizedById))
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        return {
          approved: true,
          supervisorId: Number(approval.authorizedById),
          supervisorName: String(supervisorUser?.name || approval.authorizedByName || 'مشرف معتمد'),
          supervisorRole: String(supervisorUser?.role || 'admin'),
        };
      }
      return {
        approved: true,
        supervisorName: String(approval.authorizedByName || 'مشرف معتمد'),
        supervisorRole: 'admin',
      };
    }

    return {
      approved: true,
      supervisorName: String(approval.authorizedByName || 'اعتماد المدير'),
      supervisorRole: 'supervisor',
    };
  }

  /**
   * Checks whether the tenant requires supervisor PIN authorization for settling van trips.
   * Configurable via system settings (vanSettlementRequireSupervisorPin).
   * INV-VAN-SELF-SETTLE-PIN-REQUIRED: the PIN is required by DEFAULT
   * (fail closed). Only an explicit false setting disables it — a
   * missing row or an unparseable value never silently turns the PIN
   * off, because the driver settle endpoint must never let a rep
   * self-settle his own trip.
   */
  async isSupervisorPinRequiredForSettlement(tenantId: string): Promise<boolean> {
    const row = await this.anyDb
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('key', '=', 'vanSettlementRequireSupervisorPin'),
          eb('key', '=', 'van_settlement_require_supervisor_pin'),
        ]),
      )
      .executeTakeFirst();
    if (!row?.value) return true;
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      if (parsed === false || parsed === 'false' || parsed === 0 || parsed === '0') return false;
      return true;
    } catch {
      return row.value === 'false' || row.value === '0' ? false : true;
    }
  }

  /**
   * Checks whether the tenant enforces blind cash settlement for van trips.
   * In blind settlement mode, expected cash target and breakdown are hidden from the representative,
   * requiring physical cash counting without target confirmation.
   * Configurable via system settings (vanSettlementBlindMode).
   */
  async isBlindSettlementEnabled(tenantId: string): Promise<boolean> {
    const row = await this.anyDb
      .selectFrom('settings')
      .select(['value'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('key', '=', 'vanSettlementBlindMode'),
          eb('key', '=', 'van_settlement_blind_mode'),
        ]),
      )
      .executeTakeFirst();
    if (!row?.value) return false;
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return Boolean(parsed === true || parsed === 'true' || parsed === 1 || parsed === '1');
    } catch {
      return row.value === 'true' || row.value === '1';
    }
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

  /**
   * Retrieves active open trip and current car inventory for a delivery representative.
   */
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
    const requireSupervisorPinForSettlement = await this.isSupervisorPinRequiredForSettlement(tenantId);
    const isBlindSettlement = await this.isBlindSettlementEnabled(tenantId);
    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);

    const assignedVehicleRow = await this.anyDb
      .selectFrom('fleet_vehicles')
      .select([
        'id',
        'plate_number as plateNumber',
        'model_name as modelName',
        'vehicle_type as vehicleType',
        sql<number>`cast(coalesce(current_odometer, 0) as numeric)`.as('currentOdometer'),
        'fuel_type as fuelType',
        'license_expires_at as licenseExpiresAt',
        'status',
      ])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('assigned_rep_id', '=', repId),
          eb('van_location_id', '=', vanLoc.id),
        ])
      )
      .orderBy('id', 'desc')
      .executeTakeFirst();

    const assignedVehicle = assignedVehicleRow
      ? {
          id: Number(assignedVehicleRow.id),
          plateNumber: String(assignedVehicleRow.plateNumber || ''),
          modelName: assignedVehicleRow.modelName || '',
          vehicleType: assignedVehicleRow.vehicleType || 'van',
          currentOdometer: Number(assignedVehicleRow.currentOdometer || 0),
          fuelType: assignedVehicleRow.fuelType || 'petrol_92',
          licenseExpiresAt: assignedVehicleRow.licenseExpiresAt ? String(assignedVehicleRow.licenseExpiresAt) : undefined,
          status: String(assignedVehicleRow.status || 'assigned'),
        }
      : null;

    const tripRow = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as src', 'src.id', 'vt.source_warehouse_id')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vt.rep_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        'vt.id',
        'vt.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        'vt.vehicle_id as vehicleId',
        sql<string>`coalesce(fv.plate_number, '')`.as('vehiclePlate'),
        sql<string>`coalesce(fv.model_name, '')`.as('vehicleModel'),
        sql<number>`cast(coalesce(vt.start_odometer, fv.current_odometer, 0) as numeric)`.as('startOdometer'),
        sql<number>`cast(coalesce(vt.end_odometer, 0) as numeric)`.as('endOdometer'),
        'vt.van_location_id as vanLocationId',
        sql<string>`coalesce(van.name, '')`.as('vanLocationName'),
        'vt.source_warehouse_id as sourceWarehouseId',
        sql<string>`coalesce(src.name, '')`.as('sourceWarehouseName'),
        'vt.status',
        'vt.settlement_status as settlementStatus',
        'vt.opened_at as openedAt',
        'vt.closed_at as closedAt',
        'vt.submitted_at as submittedAt',
        sql<number>`cast(coalesce(vt.loaded_amount, 0) as numeric)`.as('loadedAmount'),
        sql<number>`cast(coalesce(vt.sales_amount, 0) as numeric)`.as('salesAmount'),
        sql<number>`cast(coalesce(vt.cash_collected, 0) as numeric)`.as('cashCollected'),
        sql<number>`cast(coalesce(vt.credit_sales, 0) as numeric)`.as('creditSales'),
        sql<number>`cast(coalesce(vt.returns_amount, 0) as numeric)`.as('returnsAmount'),
        sql<number>`cast(coalesce(vt.cash_refunds, 0) as numeric)`.as('cashRefunds'),
        sql<number>`cast(coalesce(vt.variance, 0) as numeric)`.as('variance'),
        sql<number>`cast(coalesce(vt.distance_km, 0) as numeric)`.as('distanceKm'),
        sql<number>`cast(coalesce(vt.stock_variance_amount, 0) as numeric)`.as('stockVarianceAmount'),
        sql<number>`cast(coalesce(vt.total_instapay_sales, 0) as numeric)`.as('totalInstapaySales'),
        sql<number>`cast(coalesce(vt.total_instapay_collections, 0) as numeric)`.as('totalInstapayCollections'),
        'vt.night_stock_approved as nightStockApproved',
        'vt.notes',
      ])
      .where('vt.rep_id', '=', repId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .orderBy('vt.id', 'desc')
      .executeTakeFirst();

    // Fetch current inventory in the Van
    const invRows = await this.anyDb
      .selectFrom('product_location_stock as pls')
      .innerJoin('products as p', 'p.id', 'pls.product_id')
      .leftJoin('product_units as pu', (join: any) =>
        join.onRef('pu.product_id', '=', 'p.id').on('pu.multiplier', '>', 1),
      )
      .select([
        'p.id as productId',
        'p.name as productName',
        'p.barcode',
        'p.metadata as productMetadata',
        sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
        sql<number>`cast(coalesce(p.cost_price, 0) as numeric)`.as('costPrice'),
        sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
        'pu.name as unitName',
      ])
      .where('pls.location_id', '=', vanLoc.id)
      .where('pls.tenant_id', '=', tenantId)
      .where(sql<boolean>`cast(pls.qty as numeric) > 0`)
      .orderBy('p.name', 'asc')
      .execute();

    // Determine source warehouse to query main stock
    let sourceWarehouseId = tripRow?.sourceWarehouseId ? Number(tripRow.sourceWarehouseId) : null;
    if (!sourceWarehouseId) {
      const defaultWh = await this.anyDb
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`location_type in ('branch_stock', 'internal_warehouse')`)
        .where('is_active', '=', true)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      if (defaultWh) sourceWarehouseId = Number(defaultWh.id);
    }

    const mainStockMap = new Map<number, number>();
    if (sourceWarehouseId) {
      const sourceStocks = await this.anyDb
        .selectFrom('product_location_stock')
        .select(['product_id', sql<number>`cast(coalesce(qty, 0) as numeric)`.as('qty')])
        .where('location_id', '=', sourceWarehouseId)
        .where('tenant_id', '=', tenantId)
        .execute();
      for (const s of sourceStocks) {
        mainStockMap.set(Number(s.product_id), Number(s.qty || 0));
      }
    }

    // Query active promotional offers for van inventory items
    const prodIds = invRows.map((r: any) => Number(r.productId)).filter((id: number) => id > 0);
    // Offer windows use the pinned shared clock (INV-OFFER-SELECTION-
    // SHARED-POS-VAN): the same helper the sale writers use, so the
    // inventory fetch agrees with the writer instead of sampling UTC.
    const todayIso = todayLocalIsoDate();
    const activeOffers = prodIds.length > 0
      ? await this.anyDb
          .selectFrom('product_offers')
          .select(['id', 'product_id', 'offer_type', 'value', 'start_date', 'end_date', 'min_qty', 'bogo_buy_qty', 'bogo_get_qty', 'bogo_discount_percent'])
          .where('product_id', 'in', prodIds)
          .where('tenant_id', '=', tenantId)
          .where('is_active', '=', true)
          .where((eb: any) =>
            eb.and([
              eb.or([eb('start_date', 'is', null), eb('start_date', '<=', todayIso)]),
              eb.or([eb('end_date', 'is', null), eb('end_date', '>=', todayIso)]),
            ])
          )
          .orderBy('id', 'desc')
          .execute()
      : [];

    const offersByProdId = new Map<number, any>();
    for (const off of activeOffers) {
      const pid = Number(off.product_id);
      if (!offersByProdId.has(pid)) {
        offersByProdId.set(pid, off);
      }
    }

    // Query product units and FEFO batches for van inventory items
    const [rawUnits, batchRows] = prodIds.length > 0
      ? await Promise.all([
          this.anyDb
            .selectFrom('product_units')
            .select(['id', 'product_id', 'name', 'multiplier', 'is_base_unit'])
            .where('product_id', 'in', prodIds)
            .orderBy('multiplier', 'asc')
            .execute(),
          this.anyDb
            .selectFrom('pharmacy_batches')
            .select(['product_id', 'batch_number', 'expiry_date', 'quantity'])
            .where('tenant_id', '=', tenantId)
            .where('product_id', 'in', prodIds)
            .where(sql<boolean>`cast(coalesce(quantity, 0) as numeric) > 0`)
            .orderBy('expiry_date', 'asc')
            .execute()
            .catch(() => []),
        ])
      : [[], []];

    const fefoBatchByProdId = new Map<number, { batchNumber: string | null; expiryDate: string }>();
    for (const b of batchRows || []) {
      const pid = Number(b.product_id);
      if (!pid || !b.expiry_date) continue;
      if (!fefoBatchByProdId.has(pid)) {
        fefoBatchByProdId.set(pid, {
          batchNumber: b.batch_number ? String(b.batch_number) : null,
          expiryDate: String(b.expiry_date),
        });
      }
    }

    const unitsByProdId = new Map<number, any[]>();
    for (const u of rawUnits) {
      const pid = Number(u.product_id);
      if (!unitsByProdId.has(pid)) unitsByProdId.set(pid, []);
      unitsByProdId.get(pid)!.push({
        id: Number(u.id),
        name: u.name,
        multiplier: Number(u.multiplier || 1),
        isBase: Boolean(u.is_base_unit) || Number(u.multiplier) === 1,
      });
    }

    // Book digits resolved once (D4): the offer prices below round
    // at book digits, never a hardcoded 2dp.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const nowRef = new Date();
    const inventory: VanStockItem[] = invRows.map((r: any) => {
      const pid = Number(r.productId);
      const baseRetail = Number(r.retailPrice || 0);
      const offer = offersByProdId.get(pid);
      const availUnits = unitsByProdId.get(pid) || [];
      const packUnitObj = availUnits.find((u) => u.multiplier > 1);
      let effectiveRetail = baseRetail;
      let discountPerUnit = 0;
      let offerBadge: string | undefined;

      if (offer) {
        const offVal = Number(offer.value || 0);
        if (offer.offer_type === 'percent' && offVal > 0) {
          discountPerUnit = roundMoney((baseRetail * offVal) / 100, moneyDigits);
          effectiveRetail = Math.max(0, roundMoney(baseRetail - discountPerUnit, moneyDigits));
          offerBadge = `خصم ${offVal}%`;
        } else if (offer.offer_type === 'fixed' && offVal > 0) {
          discountPerUnit = Math.min(baseRetail, offVal);
          effectiveRetail = Math.max(0, roundMoney(baseRetail - discountPerUnit, moneyDigits));
          offerBadge = `خصم ${offVal} ج.م`;
        } else if (offer.offer_type === 'price' && offVal > 0) {
          effectiveRetail = offVal;
          discountPerUnit = Math.max(0, roundMoney(baseRetail - effectiveRetail, moneyDigits));
          offerBadge = `سعر عرض خاص`;
        } else if (offer.offer_type === 'bundle' && offVal > 0) {
          const minQ = Math.max(1, Number(offer.min_qty || 1));
          effectiveRetail = roundMoney(offVal / minQ, moneyDigits);
          discountPerUnit = Math.max(0, roundMoney(baseRetail - effectiveRetail, moneyDigits));
          offerBadge = `باقة ${minQ} قطع بسعر ${offVal}`;
        } else if (offer.offer_type === 'bogo') {
          const buyQ = Number(offer.bogo_buy_qty || 1);
          const getQ = Number(offer.bogo_get_qty || 1);
          const discPct = Number(offer.bogo_discount_percent ?? 100);
          const cycle = buyQ + getQ;
          const fullDisc = getQ * baseRetail * (discPct / 100);
          effectiveRetail = roundMoney(Math.max(0, (cycle * baseRetail) - fullDisc) / cycle, moneyDigits);
          discountPerUnit = Math.max(0, roundMoney(baseRetail - effectiveRetail, moneyDigits));
          offerBadge = discPct === 100 ? `اشتري ${buyQ} واحصل على ${getQ} مجاناً` : `اشتري ${buyQ} و${getQ} بخصم ${discPct}%`;
        }
      }

      let metaObj: any = null;
      if (r.productMetadata) {
        if (typeof r.productMetadata === 'string') {
          try { metaObj = JSON.parse(r.productMetadata); } catch { metaObj = null; }
        } else if (typeof r.productMetadata === 'object') {
          metaObj = r.productMetadata;
        }
      }
      const fefoBatch = fefoBatchByProdId.get(pid);
      const rawExpiry = fefoBatch?.expiryDate || metaObj?.expiry_date || metaObj?.expiryDate || null;
      const rawBatchNo = fefoBatch?.batchNumber || metaObj?.batch_number || metaObj?.batchNumber || null;
      const expiryInfo = evaluateBatchExpiryStatus(rawExpiry, nowRef, 60);

      return {
        productId: pid,
        productName: r.productName || `صنف #${pid}`,
        barcode: r.barcode || '',
        qty: Number(r.qty || 0),
        mainWarehouseQty: mainStockMap.get(pid) || 0,
        costPrice: Number(r.costPrice || 0),
        retailPrice: effectiveRetail,
        originalPrice: offer && discountPerUnit > 0 ? baseRetail : undefined,
        discountPerUnit: discountPerUnit > 0 ? discountPerUnit : undefined,
        hasActiveOffer: Boolean(offer && discountPerUnit > 0),
        offerBadge,
        unitName: r.unitName || 'قطعة',
        packagingUnit: packUnitObj ? { name: packUnitObj.name, multiplier: packUnitObj.multiplier } : undefined,
        availableUnits: availUnits.length > 0 ? availUnits : undefined,
        earliestExpiryDate: expiryInfo.earliestExpiryDate,
        batchNumber: rawBatchNo ? String(rawBatchNo) : null,
        expiryStatus: expiryInfo.status,
        daysToExpiry: expiryInfo.daysRemaining,
      };
    });

    // Fetch route customers with per-rep isolated debt balances
    const customerRows = await this.anyDb
      .selectFrom('customers as c')
      .select([
        'c.id',
        'c.name',
        'c.phone',
        'c.address',
        'c.metadata',
        sql<number>`cast(coalesce(c.credit_limit, 0) as numeric)`.as('creditLimit'),
        sql<number>`coalesce(c.balance, 0)`.as('balance'),
      ])
      .where('c.tenant_id', '=', tenantId)
      .where('c.is_active', '=', true)
      .orderBy('c.name', 'asc')
      .limit(2500)
      .execute();

    const customerIds: number[] = [];
    const customerTotalBalances: Record<number, number> = {};
    for (const c of customerRows) {
      const cid = Number(c.id);
      customerIds.push(cid);
      customerTotalBalances[cid] = Number(c.balance || 0);
    }

    const repBalancesMap = await getCustomerRepBalancesMap(this.anyDb, tenantId, {
      customerIds,
      customerTotalBalances,
      moneyDigits,
    });

    const customers = customerRows.map((c: any) => {
      const cid = Number(c.id);
      let meta: any = {};
      if (typeof c.metadata === 'string') {
        try { meta = JSON.parse(c.metadata); } catch { meta = {}; }
      } else if (c.metadata && typeof c.metadata === 'object') {
        meta = c.metadata;
      }
      const assignedRepIds = extractAssignedRepIds(meta);
      const isolated = resolveIsolatedRepCustomerBalance({
        repId: Number(repId),
        breakdown: repBalancesMap.get(cid),
        assignedRepIds,
        fallbackTotalBalance: Number(c.balance || 0),
        moneyDigits,
      });
      return {
        id: cid,
        name: c.name || `عميل #${cid}`,
        phone: c.phone || '',
        address: c.address || '',
        balance: isolated.repBalance,
        otherRepsBalance: isolated.otherRepsBalance,
        totalCompanyBalance: isolated.totalCustomerBalance,
        creditLimit: Number(c.creditLimit || 0),
        customerCode: normalizeCustomerCode(meta.customer_code || meta.code, cid),
        route: meta.route || '',
        assignedRepIds,
        locationUrl: meta.location_url || (meta.gps_lat && meta.gps_lng ? `https://maps.google.com/?q=${meta.gps_lat},${meta.gps_lng}` : ''),
      };
    });

    // Fetch sales, collections and returns on this trip
    let recentSales: any[] = [];
    let tripCollections: any[] = [];
    let tripReturns: any[] = [];
    let tripSwaps: any[] = [];
    if (tripRow?.id) {
      const rawSales = await this.anyDb
        .selectFrom('sales as s')
        .leftJoin('customers as c', 'c.id', 's.customer_id')
        .select([
          's.id',
          's.doc_no as docNo',
          sql<number>`cast(s.total as double precision)`.as('total'),
          sql<number>`cast(coalesce(s.subtotal, s.total) as double precision)`.as('subtotal'),
          sql<number>`cast(coalesce(s.discount, 0) as double precision)`.as('discount'),
          's.payment_type as paymentMethod',
          's.created_at as createdAt',
          'c.name as customerName',
        ])
        .where('s.tenant_id', '=', tenantId)
        .where(sql<boolean>`s.van_trip_id = ${Number(tripRow.id)}`)
        .orderBy('s.id', 'desc')
        .limit(100)
        .execute();

      recentSales = rawSales.map((s: any) => ({
        ...s,
        id: Number(s.id),
        total: Number(s.total || 0),
        subtotal: Number(s.subtotal || s.total || 0),
        discount: Number(s.discount || 0),
      }));

      tripCollections = await this.anyDb
        .selectFrom('customer_ledger as cl')
        .leftJoin('customers as c', 'c.id', 'cl.customer_id')
        .select([
          'cl.id',
          sql<number>`cast(abs(coalesce(cl.amount, 0)) as numeric)`.as('amount'),
          'cl.created_at as createdAt',
          sql<string>`coalesce(c.name, 'عميل')`.as('customerName'),
          'cl.note',
          sql<number>`cast(cl.gps_lat as double precision)`.as('gpsLat'),
          sql<number>`cast(cl.gps_lng as double precision)`.as('gpsLng'),
        ])
        .where('cl.tenant_id', '=', tenantId)
        .where(sql<boolean>`cl.van_trip_id = ${Number(tripRow.id)}`)
        .where('cl.entry_type', '=', 'payment')
        .orderBy('cl.id', 'desc')
        .execute();

      tripReturns = await this.anyDb
        .selectFrom('van_field_returns as vfr')
        .leftJoin('customers as c', 'c.id', 'vfr.customer_id')
        .select([
          'vfr.id',
          'vfr.doc_no as docNo',
          sql<number>`cast(coalesce(vfr.total_amount, 0) as numeric)`.as('totalAmount'),
          'vfr.return_reason as returnReason',
          'vfr.refund_method as refundMethod',
          'vfr.status',
          'vfr.created_at as createdAt',
          sql<string>`coalesce(c.name, '')`.as('customerName'),
        ])
        .where('vfr.tenant_id', '=', tenantId)
        .where(sql<boolean>`vfr.trip_id = ${Number(tripRow.id)}`)
        .orderBy('vfr.id', 'desc')
        .execute();

      tripSwaps = await this.anyDb
        .selectFrom('van_damaged_swaps as vds')
        .leftJoin('products as dp', 'dp.id', 'vds.damaged_product_id')
        .leftJoin('products as rp', 'rp.id', 'vds.replacement_product_id')
        .leftJoin('customers as c', 'c.id', 'vds.customer_id')
        .select([
          'vds.id',
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
          sql<string>`coalesce(c.name, '')`.as('customerName'),
        ])
        .where('vds.tenant_id', '=', tenantId)
        .where(sql<boolean>`vds.trip_id = ${Number(tripRow.id)}`)
        .orderBy('vds.id', 'desc')
        .execute();
    }

    // Calculate Monthly Sales Target for this representative
    const now = new Date();
    const currentPeriodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const targetRow = await this.anyDb
      .selectFrom('delivery_rep_targets')
      .select(['target_amount', 'collection_target', 'visits_target'])
      .where('rep_id', '=', repId)
      .where('period_month', '=', currentPeriodMonth)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    const targetAmount = Number(targetRow?.target_amount || 0);
    const collectionTarget = targetRow?.collection_target !== null && targetRow?.collection_target !== undefined
      ? Number(targetRow.collection_target)
      : null;
    const visitsTarget = targetRow?.visits_target !== null && targetRow?.visits_target !== undefined
      ? Number(targetRow.visits_target)
      : null;

    const salesMtdRow = await this.anyDb
      .selectFrom('sales')
      .select([sql<number>`coalesce(sum(cast(total as numeric)), 0)`.as('total_mtd')])
      .where('delivery_rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'posted')
      .where('created_at', '>=', startOfMonth)
      .where('created_at', '<=', endOfMonth)
      .executeTakeFirst();
    const actualSalesMtd = Number(salesMtdRow?.total_mtd || 0);

    const collectionsMtdRow = await this.anyDb
      .selectFrom('van_sales_trips')
      .select([sql<number>`coalesce(sum(cast(cash_collected as numeric)), 0)`.as('total_collected')])
      .where('rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('opened_at', '>=', startOfMonth)
      .where('opened_at', '<=', endOfMonth)
      .executeTakeFirst();
    const actualCollectionsMtd = Number(collectionsMtdRow?.total_collected || 0);

    const visitsMtdRow = await this.anyDb
      .selectFrom('van_field_visits')
      .select([sql<number>`count(*)`.as('total_visits')])
      .where('rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('visited_at', '>=', startOfMonth)
      .where('visited_at', '<=', endOfMonth)
      .executeTakeFirst();
    const actualVisitsMtd = Number(visitsMtdRow?.total_visits || 0);

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const todayVisitsRow = await this.anyDb
      .selectFrom('van_field_visits')
      .select([sql<number>`count(*)`.as('today_visits')])
      .where('rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('visited_at', '>=', startOfToday)
      .where('visited_at', '<=', endOfToday)
      .executeTakeFirst();
    const todayVisits = Number(todayVisitsRow?.today_visits || 0);

    const officialHolidays = await getMonthlyOfficialHolidayDates(this.anyDb, tenantId, startOfMonth, endOfMonth);

    const metricsMoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const baseMetrics = calculateRepTargetMetrics({
      targetAmount,
      actualSalesMTD: actualSalesMtd,
      collectionTarget,
      actualCollectionsMTD: actualCollectionsMtd,
      visitsTarget,
      actualVisitsMTD: actualVisitsMtd,
      currentDate: now,
      weekendDays: [5], // Friday
      officialHolidays,
      moneyDigits: metricsMoneyDigits,
    });

    const todaySales = Number(tripRow?.salesAmount || 0);
    const todayCollections = Number(tripRow?.cashCollected || 0);

    const targetMetrics = {
      ...baseMetrics,
      todaySales,
      todayCollections,
      todayVisits,
    };

    if (!tripRow) {
      return {
        hasActiveTrip: false,
        assignedVehicle,
        vanLocation: vanLoc,
        inventory,
        customers,
        recentSales: [],
        targetMetrics,
        requireSupervisorPinForSettlement,
        isBlindSettlement,
      };
    }

    const trip: VanTripSummary = {
      id: Number(tripRow.id),
      repId: Number(tripRow.repId),
      repName: tripRow.repName,
      vehicleId: tripRow.vehicleId ? Number(tripRow.vehicleId) : (assignedVehicle ? assignedVehicle.id : undefined),
      vehiclePlate: tripRow.vehiclePlate || assignedVehicle?.plateNumber,
      vehicleModel: tripRow.vehicleModel || assignedVehicle?.modelName,
      startOdometer: Number(tripRow.startOdometer || assignedVehicle?.currentOdometer || 0),
      endOdometer: Number(tripRow.endOdometer || 0),
      vanLocationId: Number(tripRow.vanLocationId),
      vanLocationName: tripRow.vanLocationName,
      sourceWarehouseId: Number(tripRow.sourceWarehouseId),
      sourceWarehouseName: tripRow.sourceWarehouseName,
      status: tripRow.status as any,
      openedAt: String(tripRow.openedAt),
      closedAt: tripRow.closedAt ? String(tripRow.closedAt) : undefined,
      loadedAmount: Number(tripRow.loadedAmount || 0),
      salesAmount: Number(tripRow.salesAmount || 0),
      cashCollected: Number(tripRow.cashCollected || 0),
      creditSales: Number(tripRow.creditSales || 0),
      returnsAmount: Number(tripRow.returnsAmount || 0),
      cashRefunds: Number((tripRow as any).cashRefunds || 0),
      totalInstapaySales: Number((tripRow as any).totalInstapaySales || 0),
      totalInstapayCollections: Number((tripRow as any).totalInstapayCollections || 0),
      variance: Number(tripRow.variance || 0),
      notes: tripRow.notes || '',
    };

    return {
      hasActiveTrip: true,
      trip,
      assignedVehicle,
      vanLocation: vanLoc,
      inventory,
      customers,
      recentSales,
      sales: recentSales,
      collections: tripCollections,
      returns: tripReturns,
      swaps: tripSwaps,
      targetMetrics,
      requireSupervisorPinForSettlement,
      isBlindSettlement,
    };
  }

  /**
   * Opens a new morning trip and loads merchandise from the main warehouse into the car stock.
   */
  async openTripAndLoad(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      sourceWarehouseId?: number;
      startOdometer?: number;
      items?: { productId: number; qty: number }[];
      notes?: string;
    },
  ): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    const existingTrip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .select(['vt.id'])
      .where('vt.rep_id', '=', repId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .executeTakeFirst();

    if (existingTrip) {
      throw new AppError('توجد رحلة توزيع مفتوحة بالفعل لهذا المندوب، يرجى تصفيتها أولاً قبل فتح رحلة جديدة', 'TRIP_ALREADY_OPEN', 400);
    }

    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);
    let sourceLocId = payload.sourceWarehouseId ? Number(payload.sourceWarehouseId) : null;
    if (!sourceLocId) {
      const defaultWh = await this.anyDb
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`location_type in ('branch_stock', 'internal_warehouse')`)
        .where('is_active', '=', true)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      sourceLocId = defaultWh ? Number(defaultWh.id) : 0;
    }

    // Lookup rep's assigned vehicle for starting odometer & plate
    const assignedVehicle = await this.anyDb
      .selectFrom('fleet_vehicles')
      .select(['id', 'current_odometer'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('assigned_rep_id', '=', repId),
          eb('van_location_id', '=', vanLoc.id),
        ])
      )
      .orderBy('id', 'desc')
      .executeTakeFirst();

    let totalLoadedValue = 0;
    let totalLoadedCost = 0;
    // Book digits resolved once, before the transaction below opens
    // (D4): the loaded value below rounds at book digits.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    let createdTripId = 0;
    const hasItemsToLoad = Boolean(payload.items && payload.items.length > 0);

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the pre-check above runs on
      // an unlocked read, so two concurrent opens both pass it. This
      // locked re-check is the first statement of the transaction; the
      // partial unique index uq_van_trips_one_open_per_rep (migration
      // 2040000000314) is the backstop for the zero-row case a FOR
      // UPDATE read cannot lock (see the .catch on the transaction
      // below, which translates its violation to TRIP_ALREADY_OPEN).
      const lockedExistingTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id'])
        .where('rep_id', '=', repId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .forUpdate()
        .executeTakeFirst();
      if (lockedExistingTrip) {
        throw new AppError('توجد رحلة توزيع مفتوحة بالفعل لهذا المندوب، يرجى تصفيتها أولاً قبل فتح رحلة جديدة', 'TRIP_ALREADY_OPEN', 400);
      }

      if (hasItemsToLoad) {
        if (sourceLocId === vanLoc.id) {
          throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
        }

        for (const item of this.sortItemsByProductId(payload.items!)) {
          const pid = Number(item.productId);
          const qty = Number(item.qty || 0);
          if (qty <= 0) continue;

          const effectiveLocId = Number((item as any).sourceWarehouseId || sourceLocId);
          if (effectiveLocId === vanLoc.id) {
            throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
          }

          // CANONICAL LOCK ORDER: Lock products first!
          const prod = await trxAny
            .selectFrom('products')
            .select(['id', 'name', 'cost_price', 'retail_price'])
            .where('id', '=', pid)
            .where('tenant_id', '=', tenantId)
            .forUpdate()
            .executeTakeFirst();

          if (!prod) {
            throw new AppError(`الصنف رقم #${pid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
          }

          const sourceStock = await trxAny
            .selectFrom('product_location_stock')
            .select(['qty'])
            .where('product_id', '=', pid)
            .where('location_id', '=', effectiveLocId)
            .where('tenant_id', '=', tenantId)
            .forUpdate()
            .executeTakeFirst();

          const avail = Number(sourceStock?.qty || 0);
          if (avail < qty) {
            throw new AppError(
              `رصيد المستودع المصدر لا يكفي للصنف "${prod?.name || pid}". المتوفر: ${avail}، المطلوب: ${qty}`,
              'INSUFFICIENT_SOURCE_STOCK',
              400,
            );
          }

          const price = Number(prod?.retail_price || 0);
          const cost = Number(prod?.cost_price || 0);
          totalLoadedValue += price * qty;
          totalLoadedCost += cost * qty;

          // Loading a van is a location-to-location move
          await this.moveVanStock(trx, {
            productId: pid,
            delta: -qty,
            locationId: effectiveLocId,
            tenantId,
            accountId,
            userId: null,
            movementType: 'van_load_out',
            note: `تحميل سيارة توزيع - خروج من المستودع`,
            referenceType: 'van_sales_trip',
            referenceId: 0,
            skipGlobalUpdate: false,
            unitCost: cost,
          });

          // INV-VAN-FEFO-BATCHES: the batches travel with the goods.
          await this.moveVanPharmacyBatches(trx, { tenantId, accountId }, pid, qty, effectiveLocId, vanLoc.id);

          await this.moveVanStock(trx, {
            productId: pid,
            delta: qty,
            locationId: vanLoc.id,
            tenantId,
            accountId,
            userId: null,
            movementType: 'van_load_in',
            note: `تحميل سيارة توزيع - دخول للسيارة`,
            referenceType: 'van_sales_trip',
            referenceId: 0,
            skipGlobalUpdate: false,
            unitCost: cost,
          });
        }
      } else {
        // Start trip with existing stock already in van
        const existingStock = await trxAny
          .selectFrom('product_location_stock as pls')
          .innerJoin('products as p', 'p.id', 'pls.product_id')
          .select([
            sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
            sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
            sql<number>`cast(coalesce(p.cost_price, 0) as numeric)`.as('costPrice'),
          ])
          .where('pls.location_id', '=', vanLoc.id)
          .where('pls.tenant_id', '=', tenantId)
          .where(sql<boolean>`cast(pls.qty as numeric) > 0`)
          .execute();

        for (const s of existingStock) {
          totalLoadedValue += Number(s.qty || 0) * Number(s.retailPrice || 0);
          totalLoadedCost += Number(s.qty || 0) * Number(s.costPrice || 0);
        }
      }

      const insertedTrip = await trxAny
        .insertInto('van_sales_trips')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          rep_id: repId,
          vehicle_id: assignedVehicle?.id ? Number(assignedVehicle.id) : null,
          start_odometer: payload.startOdometer != null ? Number(payload.startOdometer) : (assignedVehicle?.current_odometer ? Number(assignedVehicle.current_odometer) : null),
          van_location_id: vanLoc.id,
          source_warehouse_id: sourceLocId || vanLoc.id,
          status: 'open',
          settlement_status: 'open',
          loaded_amount: roundMoney(totalLoadedValue, moneyDigits),
          sales_amount: 0,
          cash_collected: 0,
          credit_sales: 0,
          returns_amount: 0,
          variance: 0,
          notes: payload.notes || (hasItemsToLoad ? 'تحميل وتجهيز بضاعة الصباح لرحلة التوزيع الميداني' : 'بدء رحلة التوزيع بالبضاعة المتوفرة بالسيارة'),
          opened_at: sql`NOW()`,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      createdTripId = Number(insertedTrip.id);

      // Post van loading stock transfer journal
      if (hasItemsToLoad && totalLoadedCost > 0) {
        const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId);
        const vanLocRow = await trxAny
          .selectFrom('stock_locations')
          .select(['branch_id'])
          .where('id', '=', vanLoc.id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;
        await this.accountingPosting.postVanStockTransfer(
          trx,
          createdTripId,
          {
            sourceLocationId: sourceLocId || vanLoc.id,
            targetLocationId: vanLoc.id,
            totalCost: totalLoadedCost,
            branchId,
            type: 'load',
          },
          systemAuth,
        );
      }
    }).catch((err: any) => {
      // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the unique-index backstop
      // (uq_van_trips_one_open_per_rep) fired — a concurrent open won
      // the race. Translate only that index's violation; any other
      // error (journal dedup, stock) rethrows untouched.
      const message = String(err?.message || '');
      if (message.includes('uq_van_trips_one_open_per_rep')) {
        throw new AppError('توجد رحلة توزيع مفتوحة بالفعل لهذا المندوب، يرجى تصفيتها أولاً قبل فتح رحلة جديدة', 'TRIP_ALREADY_OPEN', 400);
      }
      throw err;
    });

    return {
      ok: true,
      tripId: createdTripId,
      totalLoadedValue: roundMoney(totalLoadedValue, moneyDigits),
      itemsCount: payload.items?.length || 0,
    };
  }

  /**
   * Loads supplementary stock into an existing active van trip (e.g. from an approved load requisition).
   * Adheres strictly to canonical lock order, dual stock movements, and ledger posting invariants.
   */
  async loadSupplementaryStockToActiveTrip(
    repId: number,
    tenantId: string,
    accountId: string,
    tripId: number,
    payload: {
      sourceWarehouseId?: number;
      items: { productId: number; qty: number; sourceWarehouseId?: number }[];
      notes?: string;
    },
  ): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> {
    const existingTrip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .selectAll()
      .where('vt.id', '=', tripId)
      .where('vt.rep_id', '=', repId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .executeTakeFirst();

    if (!existingTrip) {
      throw new AppError('رحلة التوزيع المحددة غير موجودة أو تم إغلاقها بالفعل', 'TRIP_NOT_FOUND', 404);
    }

    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);
    let sourceLocId = payload.sourceWarehouseId ? Number(payload.sourceWarehouseId) : null;
    if (!sourceLocId) {
      const defaultWh = await this.anyDb
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`location_type in ('branch_stock', 'internal_warehouse')`)
        .where('is_active', '=', true)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      sourceLocId = defaultWh ? Number(defaultWh.id) : 0;
    }

    let totalLoadedValue = 0;
    let totalLoadedCost = 0;
    // Book digits resolved once, before the transaction below opens
    // (D4): the loaded value below rounds at book digits.
    const moneyDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const hasItemsToLoad = Boolean(payload.items && payload.items.length > 0);

    if (!hasItemsToLoad) {
      return { ok: true, tripId, totalLoadedValue: 0, itemsCount: 0 };
    }

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      if (sourceLocId === vanLoc.id) {
        throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
      }

      for (const item of this.sortItemsByProductId(payload.items)) {
        const pid = Number(item.productId);
        const qty = Number(item.qty || 0);
        if (qty <= 0) continue;

        const effectiveLocId = Number((item as any).sourceWarehouseId || sourceLocId);
        if (effectiveLocId === vanLoc.id) {
          throw new AppError('لا يمكن أن يكون المستودع المصدر هو نفس سيارة المندوب', 'INVALID_SOURCE_WAREHOUSE', 400);
        }

        // CANONICAL LOCK ORDER: Lock products first!
        const prod = await trxAny
          .selectFrom('products')
          .select(['id', 'name', 'cost_price', 'retail_price'])
          .where('id', '=', pid)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!prod) {
          throw new AppError(`الصنف رقم #${pid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
        }

        const sourceStock = await trxAny
          .selectFrom('product_location_stock')
          .select(['qty'])
          .where('product_id', '=', pid)
          .where('location_id', '=', effectiveLocId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        const avail = Number(sourceStock?.qty || 0);
        if (avail < qty) {
          throw new AppError(
            `رصيد المستودع المصدر لا يكفي للصنف "${prod?.name || pid}". المتوفر: ${avail}، المطلوب: ${qty}`,
            'INSUFFICIENT_SOURCE_STOCK',
            400,
          );
        }

        const price = Number(prod?.retail_price || 0);
        const cost = Number(prod?.cost_price || 0);
        totalLoadedValue += price * qty;
        totalLoadedCost += cost * qty;

        // Loading supplementary van stock is a location-to-location move
        await this.moveVanStock(trx, {
          productId: pid,
          delta: -qty,
          locationId: effectiveLocId,
          tenantId,
          accountId,
          userId: null,
          movementType: 'van_load_out',
          note: `تحميل سيارة توزيع إضافي (استعواض) - خروج من المستودع`,
          referenceType: 'van_sales_trip',
          referenceId: tripId,
          skipGlobalUpdate: false,
          unitCost: cost,
        });

        // INV-VAN-FEFO-BATCHES: the batches travel with the goods.
        await this.moveVanPharmacyBatches(trx, { tenantId, accountId }, pid, qty, effectiveLocId, vanLoc.id);

        await this.moveVanStock(trx, {
          productId: pid,
          delta: qty,
          locationId: vanLoc.id,
          tenantId,
          accountId,
          userId: null,
          movementType: 'van_load_in',
          note: `تحميل سيارة توزيع إضافي (استعواض) - دخول للسيارة`,
          referenceType: 'van_sales_trip',
          referenceId: tripId,
          skipGlobalUpdate: false,
          unitCost: cost,
        });
      }

      const additionalNote = payload.notes || 'تحميل بضاعة إضافية (استعواض أثناء اليوم)';
      await trxAny
        .updateTable('van_sales_trips')
        .set({
          loaded_amount: sql`coalesce(loaded_amount, 0) + ${roundMoney(totalLoadedValue, moneyDigits)}`,
          notes: sql`case 
            when notes is null or notes = '' then ${additionalNote}
            else notes || E'\n' || ${additionalNote}
          end`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', tripId)
        .where('tenant_id', '=', tenantId)
        .execute();

      // Post van loading stock transfer journal
      if (totalLoadedCost > 0) {
        const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId);
        const vanLocRow = await trxAny
          .selectFrom('stock_locations')
          .select(['branch_id'])
          .where('id', '=', vanLoc.id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();
        const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;
        await this.accountingPosting.postVanStockTransfer(
          trx,
          tripId,
          {
            sourceLocationId: sourceLocId || vanLoc.id,
            targetLocationId: vanLoc.id,
            totalCost: totalLoadedCost,
            branchId,
            type: 'load',
          },
          systemAuth,
        );
      }
    });

    return {
      ok: true,
      tripId,
      totalLoadedValue: roundMoney(totalLoadedValue, moneyDigits),
      itemsCount: payload.items.length,
    };
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

    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .select(['vt.id', 'vt.van_location_id', 'vt.status', 'van.branch_id as vanBranchId'])
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .executeTakeFirst();

    if (!trip || trip.status !== 'open') {
      throw new AppError('رحلة التوزيع المحددة مغلقة أو غير صالحة', 'INVALID_TRIP', 400);
    }

    let vanLocId = Number(trip.van_location_id);
    let branchId = trip.vanBranchId ? Number(trip.vanBranchId) : null;

    let resolvedCustomerId: number | null = payload.customerId ? Number(payload.customerId) : null;
    let customerName = payload.customerName || 'عميل نقدي ميداني';

    const isCreditOrSplit = payload.paymentMethod === 'credit' || payload.paymentMethod === 'split';
    if (isCreditOrSplit && !resolvedCustomerId && !payload.customerName) {
      throw new AppError('البيع الآجل أو المجزأ يتطلب تحديد أو إدخال اسم العميل / المحل', 'CREDIT_REQUIRES_CUSTOMER', 400);
    }

    let isNewCustomer = false;
    if (!resolvedCustomerId && payload.customerName && payload.customerName.trim() && payload.customerName !== 'عميل نقدي ميداني') {
      const existing = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name', 'metadata'])
        .where('name', '=', payload.customerName.trim())
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (existing) {
        resolvedCustomerId = Number(existing.id);
        customerName = existing.name;
      } else {
        isNewCustomer = true;
        customerName = payload.customerName.trim();
      }
    } else if (resolvedCustomerId) {
      const cust = await this.anyDb
        .selectFrom('customers')
        .select(['name', 'metadata'])
        .where('id', '=', resolvedCustomerId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!cust) throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);
      customerName = cust.name;

      // Ensure shared customer retains multi-rep link in assigned_rep_ids without overwriting primary rep
      let metaObj: any = {};
      if (typeof cust.metadata === 'string') {
        try { metaObj = JSON.parse(cust.metadata); } catch { metaObj = {}; }
      } else if (cust.metadata && typeof cust.metadata === 'object') {
        metaObj = { ...cust.metadata };
      }
      const existingRepIds = extractAssignedRepIds(metaObj);
      if (!existingRepIds.includes(Number(repId))) {
        const nextRepIds = [...existingRepIds, Number(repId)];
        metaObj.assigned_rep_ids = nextRepIds;
        if (!metaObj.assigned_rep_id) {
          metaObj.assigned_rep_id = Number(repId);
        }
        await this.anyDb
          .updateTable('customers')
          .set({ metadata: JSON.stringify(metaObj) })
          .where('id', '=', resolvedCustomerId)
          .where('tenant_id', '=', tenantId)
          .execute();
      }
    }

    let docNo = '';
    let totalSale = 0;
    let subtotalSale = 0;
    let discountSale = 0;
    let createdSaleId = 0;
    let cashPaid = 0;
    let creditOwed = 0;
    // Hoisted so the return echo below the transaction uses the same
    // helper; assigned inside the callback, on the transaction handle.
    let toBookMoney: (value: unknown) => number = (value) => Number(value ?? 0);

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the trip read above runs on
      // an unlocked handle, so a trip settled between it and this
      // transaction would still sell from a closed van. Re-read the
      // governing row under lock FIRST, before any other work, and
      // sell only from the locked row's location/branch.
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id', 'van_location_id', 'status'])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip || lockedTrip.status !== 'open') {
        throw new AppError('رحلة التوزيع المحددة مغلقة أو غير صالحة', 'INVALID_TRIP', 400);
      }
      // Sell only from the locked row's location/branch, never from the
      // unlocked pre-check snapshot.
      vanLocId = Number(lockedTrip.van_location_id);
      const lockedVanLocRow = await trxAny
        .selectFrom('stock_locations')
        .select(['branch_id'])
        .where('id', '=', vanLocId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      branchId = lockedVanLocRow?.branch_id ? Number(lockedVanLocRow.branch_id) : null;
      await assertBusinessAccountingDate(trx, tenantId, new Date(), true);
      // Book digits resolved once on THIS transaction handle (P2 pattern,
      // fail closed on a base-currency/rate mismatch, P0-1/P0-2/P0-3).
      // Every money derivation below rounds once with this helper; the
      // posting boundary re-rounds idempotently from the stored values.
      const bookDigits: MoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      toBookMoney = (value: unknown): number => roundMoney(Number(value ?? 0), bookDigits);
      const saleItemRecords: any[] = [];
      // INV-VAN-FEFO-BATCHES: batch allocations per sale item, in the same
      // order as saleItemRecords (one entry per loop iteration).
      const vanBatchAllocations: Array<Array<{ pharmacyBatchId: number; quantity: number }>> = [];
      const sortedItems = this.sortItemsByProductId(payload.items);
      const productIds = sortedItems.map((it) => Number(it.productId));
      // INV-OFFER-SELECTION-SHARED-POS-VAN: one instant for the whole
      // sale, evaluated in host-local parts — the same clock the POS
      // writer uses (todayLocalIsoDate / `now` defaults). Start/end
      // dates and happy-hour/days-of-week windows are applied by the
      // shared selector below, never pre-filtered here in UTC.
      const saleNow = new Date();
      const offerTodayIso = todayLocalIsoDate(saleNow);

      const rawOffers = productIds.length > 0 ? await trxAny
        .selectFrom('product_offers')
        .select(['product_id', 'offer_type', 'value', 'min_qty', 'start_date', 'end_date', 'bogo_buy_qty', 'bogo_get_qty', 'bogo_discount_percent', 'happy_hour_start', 'happy_hour_end', 'days_of_week'])
        .where('product_id', 'in', productIds)
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .execute() : [];

      const offersByProduct = new Map<number, any[]>();
      for (const off of rawOffers) {
        const pId = Number(off.product_id);
        if (!offersByProduct.has(pId)) offersByProduct.set(pId, []);
        offersByProduct.get(pId)!.push(off);
      }

      // Security Invariant: Pre-resolve supervisor authorization if PIN is provided (with Maker-Checker enforcement)
      let supervisorOverrideApproved = false;
      let overrideSupervisorName = '';
      let overrideSupervisorId: number | null = null;

      if (payload.supervisorOverridePin) {
        const pinVerification = await this.verifySupervisorPin(
          tenantId,
          payload.supervisorOverridePin,
          repId,
          trxAny,
          accountId,
        );
        supervisorOverrideApproved = pinVerification.approved;
        overrideSupervisorId = pinVerification.supervisorId ?? null;
        overrideSupervisorName = pinVerification.supervisorName ?? '';
      }

      // Security Invariant: Transactional Ad-Hoc Customer Creation AFTER PIN Gate
      // Prevents a failed credit attempt from persisting an unapproved customer row that bypasses isNewCustomer on retry
      if (isNewCustomer && !resolvedCustomerId) {
        if (isCreditOrSplit && !supervisorOverrideApproved) {
          await this.vanFraudRadarService.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerName,
            eventCode: 'VAN_SUSPICION_CREDIT_BYPASS',
            severity: 'critical',
            titleAr: 'محاولة بيع آجل لعميل جديد غير مسجل مسبقاً بدون اعتماد مشرف (مديونية وهمية)',
            detailsAr: `حاول المندوب فتح حساب آجل لعميل ميداني جديد غير مسجل ("${customerName}") بدون رمز اعتماد المشرف.`,
          });
          throw new AppError(
            `البيع الآجل لعميل جديد ("${customerName}") غير مسجل مسبقاً يتطلب اعتماد المشرف برمز PIN لمنع المديونيات الوهمية`,
            'NEW_CUSTOMER_CREDIT_REQUIRES_SUPERVISOR_PIN',
            403,
          );
        }
        const initMeta = {
          assigned_rep_id: Number(repId),
          assigned_rep_ids: [Number(repId)],
          created_by_rep_id: Number(repId),
        };
        const [newCust] = await trxAny
          .insertInto('customers')
          .values({
            name: customerName,
            phone: payload.customerPhone || null,
            customer_type: 'cash',
            credit_limit: 0,
            metadata: JSON.stringify(initMeta),
            is_active: true,
            tenant_id: tenantId,
            account_id: accountId,
          })
          .returning(['id', 'name'])
          .execute();
        resolvedCustomerId = Number(newCust.id);
        customerName = newCust.name;
      }

      for (const item of sortedItems) {
        const pid = Number(item.productId);
        const inputQty = Number(item.qty || 0);
        if (inputQty <= 0) continue;

        const multiplier = Number((item as any).unitMultiplier || 1);
        const unitName = (item as any).unitName || null;
        const isBonus = Boolean((item as any).isBonus) || (item.unitPrice !== undefined && item.unitPrice !== null && Number(item.unitPrice) === 0);
        const bonusReason = (item as any).bonusReason || (isBonus ? 'بونص ترويجي / عينة مجانية' : null);
        const baseQty = Number((inputQty * multiplier).toFixed(4));

        // CANONICAL LOCK ORDER: Lock products first!
        const prod = await trxAny
          .selectFrom('products')
          .select(['id', 'name', 'cost_price', 'retail_price', 'wholesale_price', 'credit_price', 'consumer_price'])
          .where('id', '=', pid)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!prod) {
          throw new AppError(`الصنف رقم #${pid} غير موجود في النظام`, 'PRODUCT_NOT_FOUND', 404);
        }

        const activeOffers = offersByProduct.get(pid) || [];

        const isCreditSale = payload.paymentMethod === 'credit' || payload.paymentMethod === 'split';
        const defaultBasePrice = isCreditSale && prod.credit_price != null && Number(prod.credit_price) > 0
          ? Number(prod.credit_price)
          : Number(prod.retail_price || 0);

        // Security Invariant: Gated Bonus Items
        // Free bonus items cannot be arbitrarily flipped by the driver unless an active promotion allows it or supervisor PIN is provided
        if (isBonus) {
          // INV-OFFER-SELECTION-SHARED-POS-VAN: the BOGO that
          // authorises a bonus must be active under the shared rule
          // (date range AND happy-hour/days-of-week windows at the
          // sale instant), not merely date-filtered as before.
          const hasActiveBogoOffer = activeOffers.some((o: any) => o.offer_type === 'bogo' && isOfferActive(o, offerTodayIso, saleNow));
          if (!hasActiveBogoOffer && !supervisorOverrideApproved) {
            const attemptedVal = toBookMoney(defaultBasePrice * multiplier * inputQty);
            await this.vanFraudRadarService.recordSuspicionEvent({
              tenantId,
              accountId,
              repId,
              tripId: payload.tripId,
              customerId: resolvedCustomerId,
              customerName,
              eventCode: 'VAN_SUSPICION_UNAUTHORIZED_BONUS',
              severity: 'high',
              titleAr: 'محاولة صرف بونص عيني مجاني بدون عرض ترويجي أو اعتماد مشرف',
              detailsAr: `حاول المندوب صرف ${inputQty} (${unitName || 'قطعة'}) من الصنف "${prod.name || pid}" كبونص مجاني بقيمة ${attemptedVal} ج.م دون وجود عرض BOGO نشط أو PIN مشرف.`,
              attemptedAmount: attemptedVal,
            });
            throw new AppError(
              `صرف الصنف "${prod.name || pid}" كبونص عيني مجاني يتطلب عرضاً ترويجياً نشطاً أو اعتماد المشرف برمز PIN`,
              'BONUS_REQUIRES_SUPERVISOR_PIN',
              403,
            );
          }
        }

        const vanStock = await trxAny
          .selectFrom('product_location_stock')
          .select(['id', 'qty'])
          .where('product_id', '=', pid)
          .where('location_id', '=', vanLocId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        const currentQty = Number(vanStock?.qty || 0);
        if (currentQty < baseQty) {
          throw new AppError(
            `رصيد سيارة التوزيع لا يكفي للصنف "${prod.name || pid}". المتوفر بالسيارة: ${currentQty} قطعة، المطلوب: ${baseQty} قطعة (${inputQty} ${unitName || 'وحدة'})`,
            'INSUFFICIENT_VAN_STOCK',
            400,
          );
        }

        // O27: name, price and cost must come from this tenant's product, never from a foreign row.
        // A van sale leaves the company for good, so unlike a load it DOES reduce global stock.
        await this.moveVanStock(trx, {
          productId: pid,
          delta: -baseQty,
          locationId: vanLocId,
          tenantId,
          accountId,
          userId: null,
          movementType: 'van_sale',
          note: isBonus ? 'صرف بونص ترويجي من سيارة التوزيع' : 'بيع من سيارة التوزيع',
          referenceType: 'van_sales_trip',
          referenceId: Number(trip?.id || 0),
          skipGlobalUpdate: false,
          unitCost: Number(prod.cost_price || 0),
        });

        // INV-VAN-FEFO-BATCHES: deduct the van's batches earliest-expiry-first;
        // fails closed when the van's valid batches cannot cover the sale.
        vanBatchAllocations.push(
          await this.deductVanSalePharmacyBatches(trx, pid, baseQty, { tenantId, accountId }, vanLocId),
        );

        // The undiscounted unit price at book digits: the single baseline
        // for offer savings and for the original-price fallback below.
        const baseUnitPrice = toBookMoney(defaultBasePrice * multiplier);
        let systemAuthorizedPrice = baseUnitPrice;
        let pricingTierType: 'cash' | 'credit' | 'offer' | 'bonus' = isBonus ? 'bonus' : (isCreditSale ? 'credit' : 'cash');
        let unitOfferSavings = 0;

        if (isBonus) {
          systemAuthorizedPrice = 0;
          pricingTierType = 'bonus';
        } else {
          // INV-OFFER-SELECTION-SHARED-POS-VAN: the winner is the
          // shared POS selector — lowest adjusted price among offers
          // active at the sale instant, qualified on the SOLD
          // quantity (inputQty), never on base units, never by
          // highest minimum quantity. The per-type price derivation
          // below is unchanged and still computes from the winner.
          const matchingOffer = pickBestApplicableOffer(activeOffers, offerTodayIso, inputQty, baseUnitPrice, saleNow, bookDigits);

          if (matchingOffer) {
            const offerVal = Number(matchingOffer.value || 0);
            if (matchingOffer.offer_type === 'percent' && offerVal > 0) {
              const discountedBase = Math.max(0, toBookMoney(defaultBasePrice * (1 - offerVal / 100)));
              systemAuthorizedPrice = toBookMoney(discountedBase * multiplier);
              pricingTierType = 'offer';
              unitOfferSavings = Math.max(0, toBookMoney(baseUnitPrice - systemAuthorizedPrice));
            } else if (matchingOffer.offer_type === 'fixed' && offerVal > 0) {
              const discountedBase = Math.max(0, toBookMoney(defaultBasePrice - offerVal));
              systemAuthorizedPrice = toBookMoney(discountedBase * multiplier);
              pricingTierType = 'offer';
              unitOfferSavings = Math.max(0, toBookMoney(baseUnitPrice - systemAuthorizedPrice));
            } else if (matchingOffer.offer_type === 'price' && offerVal > 0) {
              systemAuthorizedPrice = toBookMoney(offerVal * multiplier);
              pricingTierType = 'offer';
              unitOfferSavings = Math.max(0, toBookMoney(baseUnitPrice - systemAuthorizedPrice));
            } else if (matchingOffer.offer_type === 'bundle' && offerVal > 0) {
              const minQ = Math.max(1, Number(matchingOffer.min_qty || 1));
              const bundles = Math.floor(inputQty / minQ);
              const rem = inputQty % minQ;
              const bundleTotal = (bundles * offerVal) + (rem * defaultBasePrice);
              systemAuthorizedPrice = toBookMoney((bundleTotal / inputQty) * multiplier);
              pricingTierType = 'offer';
              unitOfferSavings = Math.max(0, toBookMoney(baseUnitPrice - systemAuthorizedPrice));
            } else if (matchingOffer.offer_type === 'bogo') {
              const buyQ = Math.max(1, Number(matchingOffer.bogo_buy_qty || 1));
              const getQ = Math.max(1, Number(matchingOffer.bogo_get_qty || 1));
              const discPct = Math.min(100, Math.max(0, Number(matchingOffer.bogo_discount_percent ?? (offerVal || 100))));
              const cycle = buyQ + getQ;
              if (inputQty >= cycle) {
                const fullCycles = Math.floor(inputQty / cycle);
                const rem = inputQty % cycle;
                const freeUnits = (fullCycles * getQ) + Math.max(0, rem - buyQ);
                const discAmt = freeUnits * defaultBasePrice * (discPct / 100);
                const netTot = Math.max(0, (inputQty * defaultBasePrice) - discAmt);
                systemAuthorizedPrice = toBookMoney((netTot / inputQty) * multiplier);
                pricingTierType = 'offer';
                unitOfferSavings = Math.max(0, toBookMoney(baseUnitPrice - systemAuthorizedPrice));
              }
            }
          }
        }

        let unitPrice = systemAuthorizedPrice;

        // Security Invariant: Price Integrity Guard against Client Tampering
        if (!isBonus && item.unitPrice != null) {
          // The client price is rounded at book digits (a 3dp client price
          // must survive); the 0.05 band itself stays ABSOLUTE: it is a
          // fraud-policy allowance for human price deviation, not a
          // rounding artifact, so it does not shrink to one minor unit
          // at 3dp (see the invariant note; the return guards share it).
          const clientPrice = toBookMoney(item.unitPrice);
          if (Math.abs(clientPrice - systemAuthorizedPrice) <= 0.05) {
            unitPrice = clientPrice;
          } else if (clientPrice < systemAuthorizedPrice - 0.05) {
            // Price is lower than authorized system price — requires supervisor PIN
            if (!supervisorOverrideApproved) {
              const attemptedDiff = toBookMoney((systemAuthorizedPrice - clientPrice) * inputQty);
              await this.vanFraudRadarService.recordSuspicionEvent({
                tenantId,
                accountId,
                repId,
                tripId: payload.tripId,
                customerId: resolvedCustomerId,
                customerName,
                eventCode: 'VAN_SUSPICION_PRICE_MANIPULATION',
                severity: 'critical',
                titleAr: 'محاولة تلاعب وخفض سعر بيع صنف تحت السعر المعتمد بدون PIN مشرف',
                detailsAr: `حاول المندوب بيع الصنف "${prod.name || pid}" بسعر (${clientPrice} ج.م) أقل من السعر المعتمد (${systemAuthorizedPrice} ج.م) بفارق إجمالي (${attemptedDiff} ج.م) بدون اعتماد المشرف.`,
                attemptedAmount: attemptedDiff,
              });
              throw new AppError(
                `سعر البيع المحدد للصنف "${prod.name || pid}" (${clientPrice} ج.م) أقل من السعر المعتمد (${systemAuthorizedPrice} ج.م). تعديل أو خفض الأسعار يتطلب اعتماد المشرف برمز PIN`,
                'PRICE_DISCOUNT_REQUIRES_SUPERVISOR_PIN',
                403,
              );
            }
            unitPrice = clientPrice;
          } else {
            // Higher price accepted
            unitPrice = clientPrice;
          }
        }

        const originalPrice = (item as any).originalPrice
          ? toBookMoney((item as any).originalPrice)
          : (isBonus ? baseUnitPrice : Math.max(unitPrice, baseUnitPrice));
        const lineTotal = toBookMoney(unitPrice * inputQty);
        const lineSubtotal = toBookMoney(originalPrice * inputQty);
        totalSale += lineTotal;
        subtotalSale += lineSubtotal;

        saleItemRecords.push({
          product_id: pid,
          product_name: prod.name || `صنف #${pid}`,
          qty: inputQty,
          unit_price: unitPrice,
          line_total: lineTotal,
          cost_price: Number(prod.cost_price || 0) * multiplier,
          consumer_price: prod.consumer_price != null && Number(prod.consumer_price) > 0 ? Number(prod.consumer_price) * multiplier : null,
          pricing_tier_type: pricingTierType,
          unit_offer_savings: unitOfferSavings,
          unit_name: unitName,
          unit_multiplier: multiplier,
          is_bonus: isBonus,
          bonus_reason: bonusReason,
        });
      }

      if (subtotalSale < totalSale) subtotalSale = totalSale;
      discountSale = toBookMoney(Math.max(0, subtotalSale - totalSale));

      const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId);
      const createdByUserId = systemAuth.userId > 0 ? systemAuth.userId : null;

      const isCash = payload.paymentMethod === 'cash';
      const isCard = payload.paymentMethod === 'card';
      const isCredit = payload.paymentMethod === 'credit';
      const isSplit = payload.paymentMethod === 'split';
      const isInstapay = payload.paymentMethod === 'instapay' || payload.paymentMethod === 'vodafone_cash';

      cashPaid = 0;
      creditOwed = 0;

      if (isCash) {
        // The cash discount is rounded once at book digits, before it
        // touches the totals (the old code took it raw and re-rounded
        // the result at 2dp, so a 3dp discount never survived intact).
        const cashDiscount = Math.max(0, toBookMoney(payload.cashDiscountAmount || 0));
        if (cashDiscount > 0 && cashDiscount < totalSale) {
          totalSale = toBookMoney(totalSale - cashDiscount);
          discountSale = toBookMoney(discountSale + cashDiscount);
        }
        cashPaid = totalSale;
        creditOwed = 0;
      } else if (isCredit) {
        cashPaid = 0;
        creditOwed = totalSale;
      } else if (isCard || isInstapay) {
        cashPaid = 0;
        creditOwed = 0;
      } else if (isSplit) {
        const rawPaid = Number(payload.paidAmount || 0);
        cashPaid = Math.max(0, Math.min(totalSale, toBookMoney(rawPaid)));
        creditOwed = Math.max(0, toBookMoney(totalSale - cashPaid));
      }

      // Enforce customer credit limit and credit block in the field
      let isCreditOverridden = false;
      let creditOverrideUserId: number | null = null;
      let creditOverrideReason: string | null = null;

      // INV-VAN-FIELD-NONCASH-EVIDENCE-GATE: instapay / vodafone_cash
      // settle straight to bank 1120 exactly like a card sale, so
      // they run the same evidence gate — supervisor PIN + a
      // reference of at least 3 chars — or the sale is refused.
      // Before this gate, an instapay sale skipped the check
      // entirely and a rep could mark a debt "instapay arrived"
      // with zero evidence while no cash was ever expected of him.
      if ((isCard || isInstapay) && totalSale > 0) {
        // The card leg below is byte-identical to the pre-existing
        // card contract (reference = reason || notes, approval note
        // as the fallback reference). The instapay leg reads the
        // transfer reference first and has NO invented fallback: an
        // instapay / vodafone_cash sale needs a real reference of at
        // least 3 chars on top of the supervisor PIN, or it is
        // refused with CARD_PAYMENT_REFERENCE_REQUIRED.
        const cardCheck = evaluateFieldCardPayment({
          totalSaleAmount: totalSale,
          referenceReason: isCard
            ? (payload.supervisorOverrideReason || payload.notes)
            : (payload.transferReference || payload.supervisorOverrideReason || payload.notes),
          supervisorOverride: supervisorOverrideApproved
            ? {
                approved: true,
                supervisorId: overrideSupervisorId || undefined,
                supervisorName: overrideSupervisorName,
                reason: isCard
                  ? (payload.supervisorOverrideReason || payload.notes || `إيصال شبكة معتمد من ${overrideSupervisorName}`)
                  : (payload.transferReference || payload.supervisorOverrideReason || payload.notes || undefined),
              }
            : undefined,
        });
        if (!cardCheck.allowed) {
          await this.vanFraudRadarService.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: resolvedCustomerId,
            customerName,
            eventCode: 'VAN_SUSPICION_FAKE_CARD_PAYMENT',
            severity: 'critical',
            titleAr: 'محاولة تسجيل دفع إلكتروني وهمي بدون اعتماد مشرف أو رقم إيصال',
            detailsAr: `حاول المندوب تسجيل فاتورة بقيمة ${totalSale} ج.م كدفع ${isCard ? 'بالشبكة/الفيزا' : 'إلكتروني (إنستاباي/فودافون كاش)'} لتجنب مطالبته بتوريد الكاش بالتصفية، دون اعتماد مشرف أو رقم إيصال.`,
            attemptedAmount: totalSale,
          });
          throw new AppError(
            cardCheck.errorMessageAr || 'الدفع بالشبكة في الميدان يتطلب اعتماد المشرف ورقم إيصال الشبكة',
            cardCheck.reasonCode || 'CARD_PAYMENT_REQUIRES_SUPERVISOR_PIN',
            403,
          );
        }
        isCreditOverridden = true;
        creditOverrideUserId = overrideSupervisorId;
        creditOverrideReason = `اعتماد دفع شبكة/تحويل بنكي: ${cardCheck.approvedReference || ''}`;
      }

      if ((isCredit || isSplit) && creditOwed > 0 && resolvedCustomerId) {
        // Security Invariant: Phantom Credit Prevention
        // Rep cannot sell on credit to an ad-hoc unregistered customer without supervisor PIN
        if (isNewCustomer && !supervisorOverrideApproved) {
          await this.vanFraudRadarService.recordSuspicionEvent({
            tenantId,
            accountId,
            repId,
            tripId: payload.tripId,
            customerId: resolvedCustomerId,
            customerName,
            eventCode: 'VAN_SUSPICION_CREDIT_BYPASS',
            severity: 'critical',
            titleAr: 'محاولة بيع آجل لعميل جديد غير مسجل مسبقاً بدون اعتماد مشرف',
            detailsAr: `حاول المندوب بيع آجل بقيمة ${creditOwed} ج.م لعميل جديد ("${customerName}") بدون رمز اعتماد المشرف.`,
            attemptedAmount: creditOwed,
          });
          throw new AppError(
            `البيع الآجل لعميل جديد ("${customerName}") غير مسجل مسبقاً يتطلب اعتماد المشرف برمز PIN لمنع المديونيات الوهمية`,
            'NEW_CUSTOMER_CREDIT_REQUIRES_SUPERVISOR_PIN',
            403,
          );
        }

        const custRecord = await trxAny
          .selectFrom('customers')
          .select(['id', 'name', 'balance', 'credit_limit', 'is_credit_blocked', 'credit_block_reason', 'customer_type', 'metadata'])
          .where('id', '=', resolvedCustomerId)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (custRecord) {
          let custMeta: any = {};
          if (typeof custRecord.metadata === 'string') {
            try { custMeta = JSON.parse(custRecord.metadata); } catch { custMeta = {}; }
          } else if (custRecord.metadata && typeof custRecord.metadata === 'object') {
            custMeta = custRecord.metadata;
          }
          const isFieldCreatedCustomer = Boolean(custMeta?.created_by_rep_id) || isNewCustomer;

          // Security Invariant: Real-Time Geofence Enforcement Gate on Credit Sales (Anti-Phantom Sidewalk Sales)
          // Strictly prevents rep from booking credit sales while physically outside customer location
          const custCoords = extractCoordinatesFromCustomerLocation({
            metadata: custMeta,
            locationUrl: (custRecord as any).location_url || custMeta?.location_url || custMeta?.locationUrl,
          });

          if (custCoords && isValidCoordinatePair(custCoords.lat, custCoords.lng)) {
            const repLat = payload.deliveryGpsLat != null ? Number(payload.deliveryGpsLat) : null;
            const repLng = payload.deliveryGpsLng != null ? Number(payload.deliveryGpsLng) : null;

            const geo = evaluateGeofenceCompliance({
              repLat,
              repLng,
              customerLat: custCoords.lat,
              customerLng: custCoords.lng,
              maxAllowedMeters: 200,
            });

            if ((geo.status === 'outside_geofence' || geo.isCompliant === false) && !supervisorOverrideApproved) {
              await this.vanFraudRadarService.recordSuspicionEvent({
                tenantId,
                accountId,
                repId,
                tripId: payload.tripId,
                customerId: resolvedCustomerId,
                customerName: custRecord.name || customerName,
                eventCode: 'VAN_SUSPICION_GEOFENCE_VIOLATION',
                severity: 'critical',
                titleAr: 'محاولة بيع آجل خارج النطاق الجغرافي المعتمد لدكان العميل (فواتير رصيف)',
                detailsAr: `حاول المندوب إصدار فاتورة بيع آجل بقيمة ${creditOwed} ج.م للعميل "${custRecord.name || customerName}" وهو يبعد مسافة (${geo.distanceMeters} متر) عن موقع المحل (المسموح ${geo.maxAllowedMeters}م) بدون اعتماد المشرف.`,
                attemptedAmount: creditOwed,
                metadata: {
                  distanceMeters: geo.distanceMeters,
                  maxAllowedMeters: geo.maxAllowedMeters,
                  repLat,
                  repLng,
                  customerLat: custCoords.lat,
                  customerLng: custCoords.lng,
                },
              });
              throw new AppError(
                `أنت خارج النطاق الجغرافي المعتمد لدكان العميل (المسافة: ${geo.distanceMeters} متر، المسموح: ${geo.maxAllowedMeters}م). البيع الآجل خارج الموقع يتطلب اعتماد المشرف برمز PIN لمنع المديونيات وفواتير الرصيف الوهمية.`,
                'OUT_OF_GEOFENCE_REQUIRES_SUPERVISOR_PIN',
                403,
              );
            }
          }

          // Financial Governance: Check for overdue unpaid credit sales past allowed grace period
          const allowedCreditDays = Number(custMeta?.credit_days || custMeta?.credit_terms_days || 30);
          const overdueCutoffDate = new Date();
          overdueCutoffDate.setDate(overdueCutoffDate.getDate() - allowedCreditDays);

          const overdueSales = await trxAny
            .selectFrom('sales')
            .select([
              'id',
              'doc_no',
              'total',
              'paid_amount',
              'created_at',
              sql<number>`cast(total - coalesce(paid_amount, 0) as numeric)`.as('remaining'),
            ])
            .where('tenant_id', '=', tenantId)
            .where('customer_id', '=', resolvedCustomerId)
            .where('payment_type', '=', 'credit')
            .where('status', 'in', ['posted', 'completed'])
            .where(sql`total - coalesce(paid_amount, 0) > 0.05`)
            .where('created_at', '<', overdueCutoffDate)
            .orderBy('created_at', 'asc')
            .execute();

          const hasOverdueInvoices = overdueSales.length > 0;
          let oldestOverdueDays = 0;
          let overdueAmount = 0;
          if (hasOverdueInvoices) {
            const oldest = overdueSales[0];
            const oldestDate = new Date(oldest.created_at);
            oldestOverdueDays = Math.max(0, Math.floor((Date.now() - oldestDate.getTime()) / (1000 * 60 * 60 * 24)));
            overdueAmount = toBookMoney(
              overdueSales.reduce((sum: number, s: any) => sum + Number(s.remaining || 0), 0),
            );
          }

          const creditCheck = evaluateCreditLimitCheck({
            moneyDigits: bookDigits,
            customerId: resolvedCustomerId,
            customerName: custRecord.name || customerName,
            currentBalance: Number(custRecord.balance || 0),
            creditLimit: Number(custRecord.credit_limit || 0),
            isCreditBlocked: Boolean(custRecord.is_credit_blocked),
            creditBlockReason: custRecord.credit_block_reason,
            customerType: custRecord.customer_type,
            isFieldCreatedCustomer,
            requestedCreditAmount: creditOwed,
            hasOverdueInvoices,
            oldestOverdueDays,
            overdueAmount,
            supervisorOverride: supervisorOverrideApproved ? {
              approved: true,
              supervisorId: overrideSupervisorId || undefined,
              supervisorName: overrideSupervisorName,
              reason: payload.supervisorOverrideReason || `اعتماد استثنائي من المشرف ${overrideSupervisorName}`,
            } : undefined,
          });

          if (!creditCheck.allowed) {
            await this.vanFraudRadarService.recordSuspicionEvent({
              tenantId,
              accountId,
              repId,
              tripId: payload.tripId,
              customerId: resolvedCustomerId,
              customerName: custRecord.name || customerName,
              eventCode: 'VAN_SUSPICION_CREDIT_BYPASS',
              severity: 'high',
              titleAr: 'محاولة كسر سقف الائتمان أو البيع الآجل لعميل نقدي/محظور بدون PIN مشرف',
              detailsAr: creditCheck.errorMessageAr || `حاول المندوب بيع آجل بقيمة ${creditOwed} ج.م للعميل "${custRecord.name || customerName}" بالمخالفة لضوابط الائتمان.`,
              attemptedAmount: creditOwed,
            });
            throw new AppError(
              creditCheck.errorMessageAr || 'تم رفض العملية لتجاوز سقف الائتمان للعميل',
              creditCheck.reasonCode || 'CREDIT_LIMIT_REJECTED',
              422,
            );
          }

          if (creditCheck.isOverridden) {
            isCreditOverridden = true;
            creditOverrideUserId = overrideSupervisorId;
            creditOverrideReason = creditCheck.overrideReason || null;
          }
        }
      }

      // INV-VAN-SALE-TAX-OPTIONAL: the van sale posts the tenant's
      // configured tax rate, or 0 when the owner never enabled tax
      // on sales (Tax F1: optional per business owner). The driver
      // sends no tax rate, so the configured rate is both the
      // payload and the configured value for resolveSaleTaxRate —
      // an absent or unparseable setting resolves to 0, never a
      // throw. Tax is added ON TOP of the price (prices_include_tax
      // stays false): computeInvoiceTotals on the net base
      // (subtotal - discount, cash discount already applied above)
      // returns the tax and the tax-inclusive total, rounded once
      // at book digits via toBookMoney. Placed here, directly
      // before the insert, so the stored tax_rate/tax_amount, the
      // paid_amount for card/InstaPay (totalSale), the trip totals,
      // the customer balance and postSale (which reads
      // sale.tax_amount only) all consume the same tax-inclusive
      // total. The cash/credit split is topped up by the tax: cash
      // collects the whole tax-inclusive total, credit owes it,
      // and a split sale's unpaid remainder grows by the tax (cash
      // already collected stays as collected). NOTE: the credit
      // limit and card gates above ran on the pre-tax amount; the
      // tax portion is added after them.
      const taxSettingRows = await trxAny
        .selectFrom('settings')
        .select(['key', 'value'])
        .where('tenant_id', '=', tenantId)
        .where('key', 'in', ['taxRate', 'tax_rate'])
        .execute();
      let configuredTaxRate: unknown;
      for (const row of taxSettingRows) {
        const rawValue = (row as any).value;
        let parsedValue: unknown = rawValue;
        try {
          parsedValue = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
        } catch {
          parsedValue = rawValue;
        }
        if ((row as any).key === 'taxRate') {
          configuredTaxRate = parsedValue;
          break;
        }
        if (configuredTaxRate === undefined) configuredTaxRate = parsedValue;
      }
      const vanTaxRate = resolveSaleTaxRate(configuredTaxRate, configuredTaxRate);
      const vanTotals = computeInvoiceTotals(subtotalSale, discountSale, vanTaxRate, false, 0, 0, 0);
      const vanTaxAmount = toBookMoney(vanTotals.taxAmount);
      totalSale = toBookMoney(vanTotals.total);
      if (isCash) cashPaid = totalSale;
      else if (isCredit) creditOwed = totalSale;
      else if (isSplit) creditOwed = toBookMoney(totalSale - cashPaid);

      const tempDocNo = `TMP-VAN-${Date.now()}`;
      const insertedSale = await trxAny
        .insertInto('sales')
        .values({
          doc_no: tempDocNo,
          total: totalSale,
          subtotal: subtotalSale,
          discount: discountSale,
          tax_rate: vanTaxRate,
          tax_amount: vanTaxAmount,
          // Cash/Credit collected in the field sits with the rep (or customer receivable) until settleTrip,
          // whereas verified Card/Bank/InstaPay payments settle directly to Bank via sale_payments.
          paid_amount: (isCard || isInstapay) ? totalSale : 0,
          store_credit_used: 0,
          prices_include_tax: false,
          status: 'posted',
          payment_type: payload.paymentMethod,
          payment_channel: isCash ? 'cash' : (isCard ? 'card' : (isInstapay ? (payload.paymentMethod === 'vodafone_cash' ? 'vodafone_cash' : 'bank_transfer') : (isCredit ? 'credit' : 'mixed'))),
          collection_status: isCash ? 'prepaid_by_rep' : ((isCard || isInstapay) ? 'settled_to_bank' : (isSplit && cashPaid > 0 ? 'prepaid_by_rep' : null)),
          customer_id: resolvedCustomerId,
          branch_id: branchId,
          location_id: vanLocId,
          created_by: createdByUserId,
          delivery_rep_id: repId,
          van_trip_id: payload.tripId,
          sale_origin: 'van_sale',
          is_credit_overridden: isCreditOverridden,
          credit_override_by_user_id: creditOverrideUserId,
          credit_override_reason: creditOverrideReason,
          transfer_reference: payload.transferReference || null,
          transfer_receipt_url: payload.transferReceiptUrl || null,
          recipient_name: payload.recipientName || null,
          recipient_phone: payload.recipientPhone || null,
          recipient_role: payload.recipientRole || null,
          recipient_signature: payload.recipientSignature || null,
          note: payload.clientTxId
            ? `${payload.notes || 'فاتورة بيع ميداني من سيارة المندوب'} [tx:${payload.clientTxId}]`
            : payload.notes || `فاتورة بيع ميداني من سيارة المندوب`,
          delivery_gps_lat: payload.deliveryGpsLat != null ? Number(payload.deliveryGpsLat) : null,
          delivery_gps_lng: payload.deliveryGpsLng != null ? Number(payload.deliveryGpsLng) : null,
          delivery_proof_photo: payload.deliveryProofPhoto || null,
          packaging_breakdown: payload.packagingBreakdown ? JSON.stringify(payload.packagingBreakdown) : null,
          tenant_id: tenantId,
          account_id: accountId,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      createdSaleId = Number(insertedSale.id);
      docNo = await this.generateDailySequenceNumber(trxAny, 'sales', 'doc_no', 'VAN', tenantId);

      await trxAny
        .updateTable('sales')
        .set({ doc_no: docNo })
        .where('id', '=', createdSaleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      if (resolvedCustomerId) {
        await trxAny
          .insertInto('van_field_visits')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            trip_id: payload.tripId,
            rep_id: repId,
            customer_id: resolvedCustomerId,
            visit_type: 'positive',
            sale_id: createdSaleId,
            gps_lat: payload.deliveryGpsLat != null ? Number(payload.deliveryGpsLat) : null,
            gps_lng: payload.deliveryGpsLng != null ? Number(payload.deliveryGpsLng) : null,
            notes: payload.notes || null,
            visited_at: sql`NOW()`,
            created_at: sql`NOW()`,
          })
          .execute();
      }

      for (let recordIdx = 0; recordIdx < saleItemRecords.length; recordIdx++) {
        const it = saleItemRecords[recordIdx];
        const insertedItem = await trxAny
          .insertInto('sale_items')
          .values({
            sale_id: createdSaleId,
            product_id: it.product_id,
            product_name: it.product_name,
            qty: it.qty,
            unit_price: it.unit_price,
            line_total: it.line_total,
            cost_price: it.cost_price,
            consumer_price: it.consumer_price,
            pricing_tier_type: it.pricing_tier_type,
            unit_offer_savings: it.unit_offer_savings,
            unit_name: it.unit_name || 'قطعة',
            unit_multiplier: it.unit_multiplier || 1,
            is_bonus: Boolean(it.is_bonus),
            bonus_reason: it.bonus_reason || null,
            tenant_id: tenantId,
            account_id: accountId,
          })
          .returning(['id'])
          .executeTakeFirstOrThrow();
        // INV-VAN-FEFO-BATCHES: record which van batches this item consumed,
        // so a later edit/cancel can restore them like a shop sale.
        for (const alloc of vanBatchAllocations[recordIdx] || []) {
          await trxAny
            .insertInto('sale_pharmacy_batch_allocations')
            .values({
              tenant_id: tenantId,
              account_id: accountId,
              sale_id: createdSaleId,
              sale_item_id: Number(insertedItem.id),
              product_id: it.product_id,
              pharmacy_batch_id: alloc.pharmacyBatchId,
              quantity: alloc.quantity,
            })
            .execute();
        }
      }

      if ((isCard || isInstapay) && totalSale > 0) {
        await trxAny
          .insertInto('sale_payments')
          .values({
            sale_id: createdSaleId,
            payment_channel: isCard ? 'card' : (payload.paymentMethod === 'vodafone_cash' ? 'vodafone_cash' : 'bank_transfer'),
            amount: totalSale,
            applied_amount: totalSale,
            tendered_amount: totalSale,
            change_amount: 0,
            card_rrn: (payload.transferReference || payload.supervisorOverrideReason) ? String(payload.transferReference || payload.supervisorOverrideReason).trim().slice(0, 64) : null,
            tenant_id: tenantId,
            account_id: accountId,
          })
          .execute();
      }

      if (isCash) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            sales_amount: sql`sales_amount + ${totalSale}`,
            cash_collected: sql`cash_collected + ${totalSale}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else if (isInstapay) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            sales_amount: sql`sales_amount + ${totalSale}`,
            total_instapay_sales: sql`total_instapay_sales + ${totalSale}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else if (isCard) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            sales_amount: sql`sales_amount + ${totalSale}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();
      } else if (isCredit) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            sales_amount: sql`sales_amount + ${totalSale}`,
            credit_sales: sql`credit_sales + ${totalSale}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();

        if (resolvedCustomerId) {
          const updatedCust = await trxAny
            .updateTable('customers')
            .set({ balance: sql`COALESCE(balance, 0) + ${totalSale}`, updated_at: sql`NOW()` })
            .where('id', '=', resolvedCustomerId)
            .where('tenant_id', '=', tenantId)
            .returning(['balance'])
            .executeTakeFirst();
          const balanceAfter = Number(updatedCust?.balance || 0);

          await trxAny
            .insertInto('customer_ledger')
            .values({
              customer_id: resolvedCustomerId,
              entry_type: 'sale_credit',
              amount: totalSale,
              balance_after: balanceAfter,
              note: `فاتورة بيع آجل ميدانية من المندوب (#${docNo})`,
              reference_type: 'sale',
              reference_id: createdSaleId,
              van_trip_id: payload.tripId,
              tenant_id: tenantId,
              account_id: accountId,
            })
            .execute();
        }
      } else if (isSplit) {
        await trxAny
          .updateTable('van_sales_trips')
          .set({
            sales_amount: sql`sales_amount + ${totalSale}`,
            cash_collected: sql`cash_collected + ${cashPaid}`,
            credit_sales: sql`credit_sales + ${creditOwed}`,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', payload.tripId)
          .where('tenant_id', '=', tenantId)
          .execute();

        if (resolvedCustomerId && creditOwed > 0) {
          const updatedCust = await trxAny
            .updateTable('customers')
            .set({ balance: sql`COALESCE(balance, 0) + ${creditOwed}`, updated_at: sql`NOW()` })
            .where('id', '=', resolvedCustomerId)
            .where('tenant_id', '=', tenantId)
            .returning(['balance'])
            .executeTakeFirst();
          const balanceAfter = Number(updatedCust?.balance || 0);

          await trxAny
            .insertInto('customer_ledger')
            .values({
              customer_id: resolvedCustomerId,
              entry_type: 'sale_credit',
              amount: creditOwed,
              balance_after: balanceAfter,
              note: `فاتورة بيع ميدانية مجزأة (#${docNo}) - مسدد نقداً: ${cashPaid.toFixed(2)}، متبقي آجل: ${creditOwed.toFixed(2)}`,
              reference_type: 'sale',
              reference_id: createdSaleId,
              van_trip_id: payload.tripId,
              tenant_id: tenantId,
              account_id: accountId,
            })
            .execute();
        }
      }

      // Post GL journal after customer_ledger so split sales can read their exact credit portion
      // Field stock, rep custody, customer debt and GL either all commit or all roll back.
      await this.accountingPosting.postSale(trx, createdSaleId, systemAuth);
      await this.accountingPosting.clearPostingFailure(trx, { tenantId, accountId }, 'sale', createdSaleId);
    });

    return {
      ok: true,
      saleId: createdSaleId,
      docNo,
      // Echo the stored book-digits values exactly: re-rounding the
      // return at 2dp would report 100.13 for a stored 100.125 sale.
      total: toBookMoney(totalSale),
      subtotal: toBookMoney(subtotalSale),
      discount: toBookMoney(discountSale),
      paymentMethod: payload.paymentMethod,
      customerName,
      itemsCount: payload.items.length,
      cashPaid,
      creditOwed,
    };
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
    const fingerprintKey = `${tenantId}:${payload.tripId}:${repId}:${payload.customerId}:${amount}`;

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
      // 3. Database Idempotency Check via client_tx_id, falling back to
      // the legacy [tx:clientTxId] note tag for rows written before
      // migration 2040000000268 (whose backfill could not parse a tag).
      if (payload.clientTxId) {
        const existingByColumn = await this.anyDb
          .selectFrom('customer_payments')
          .select(['id', 'amount', 'note'])
          .where('tenant_id', '=', tenantId)
          .where('customer_id', '=', payload.customerId)
          .where('client_tx_id', '=', payload.clientTxId)
          .executeTakeFirst();
        const existingPayment = existingByColumn ?? await this.anyDb
          .selectFrom('customer_payments')
          .select(['id', 'amount', 'note'])
          .where('tenant_id', '=', tenantId)
          .where('customer_id', '=', payload.customerId)
          .where('note', 'like', `%[tx:${payload.clientTxId}]%`)
          .executeTakeFirst();

        if (existingPayment) {
          const cust = await this.anyDb.selectFrom('customers').select(['name']).where('id', '=', payload.customerId).where('tenant_id', '=', tenantId).executeTakeFirst();
          return {
            ok: true,
            receiptNo: existingPayment.note?.match(/#([A-Z0-9-]+)/)?.[1] || 'COL-SYNCED',
            amount: Number(existingPayment.amount),
            customerName: cust?.name || 'العميل',
            previousBalance: 0,
            newBalance: 0,
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
        const cust = await this.anyDb.selectFrom('customers').select(['name']).where('id', '=', payload.customerId).where('tenant_id', '=', tenantId).executeTakeFirst();
        return {
          ok: true,
          receiptNo: recentDbPayment.note?.match(/#([A-Z0-9-]+)/)?.[1] || 'COL-SYNCED',
          amount: Number(recentDbPayment.amount),
          customerName: cust?.name || 'العميل',
          previousBalance: 0,
          newBalance: 0,
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
      const systemAuth = await this.resolveSystemAuthContext(tenantId, accountId);
      await this.accountingPosting.postVanFieldCollection(
        trx,
        Number(insertedPayment.id),
        { amount, customerId: payload.customerId, branchId, locationId: vanLocId, paymentMethod: payload.paymentMethod || 'cash', transferReference: payload.transferReference },
        systemAuth,
      );
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
   * INV-DRIVER-PORTAL-REP-SCOPED-READS: a rep may read a customer's
   * field statement and last sold prices only when the codebase already
   * records him serving that customer: a field visit on one of his
   * trips, a pre-sale order assigned to him, or a delivered sale
   * carrying his delivery_rep_id. There is no static customer-to-rep
   * assignment in the schema, so history is the association. Staff
   * callers pass no repId and skip the check.
   */
  private async assertRepServedCustomer(tenantId: string, repId: number, customerId: number): Promise<void> {
    const visit = await this.anyDb
      .selectFrom('van_field_visits')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .where('customer_id', '=', customerId)
      .limit(1)
      .executeTakeFirst();
    if (visit) return;
    const order = await this.anyDb
      .selectFrom('sales_orders')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .where('customer_id', '=', customerId)
      .limit(1)
      .executeTakeFirst();
    if (order) return;
    const sale = await this.anyDb
      .selectFrom('sales')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('delivery_rep_id', '=', repId)
      .where('customer_id', '=', customerId)
      .limit(1)
      .executeTakeFirst();
    if (sale) return;
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

  /**
   * Driver submits daily trip closing report (cash handover, odometer reading, and stock unload request).
   * Status transitions to `submitted_by_rep`, pending supervisor review.
   */
  async submitTripSettlement(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
      tripId: number;
      countedCash: number;
      endOdometer?: number;
      unloadRemainingToWarehouse: boolean;
      activeVisitCustomerId?: number;
      notes?: string;
    },
  ): Promise<{
    ok: boolean;
    tripId: number;
    expectedCash: number;
    countedCash: number;
    variance: number;
    distanceKm: number;
    status: 'submitted_by_rep';
    message: string;
  }> {
    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .selectAll()
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .where((eb: any) => eb.or([eb('vt.status', '=', 'open'), eb('vt.settlement_status', '=', 'open')]))
      .executeTakeFirst();

    if (!trip) {
      throw new AppError('الرحلة غير موجودة أو تم تقديم إقرارها بالفعل', 'TRIP_NOT_FOUND', 404);
    }

    const odometerResult = evaluateOdometerReadings({
      startOdometer: trip.start_odometer,
      endOdometer: payload.endOdometer,
    });

    if (!odometerResult.valid) {
      await this.recordSuspicionEvent({
        tenantId,
        accountId,
        repId,
        tripId: payload.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_ODOMETER_ROLLBACK,
        severity: 'high',
        titleAr: 'تلاعب في قراءة عداد الكيلومترات عند تقديم إقرار التصفية',
        detailsAr: odometerResult.errorMessageAr || `قراءة العداد النهائية (${payload.endOdometer}) غير متسقة مع قراءة البداية (${trip.start_odometer}).`,
        metadata: {
          startOdometer: trip.start_odometer,
          endOdometer: payload.endOdometer,
        },
      });
      throw new AppError(odometerResult.errorMessageAr!, 'INVALID_ODOMETER', 400);
    }

    const expectedCash = Number(trip.cash_collected || 0);
    const countedCash = Number(payload.countedCash || 0);
    // Cash variance at tenant book digits via the shared drawer helper
    // (was hardcoded toFixed(2)).
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const variance = computeCashDrawerVariance(countedCash, expectedCash, bookDigits);

    await this.anyDb
      .updateTable('van_sales_trips')
      .set({
        settlement_status: 'submitted_by_rep',
        submitted_at: sql`NOW()`,
        end_odometer: payload.endOdometer !== undefined ? payload.endOdometer : null,
        distance_km: odometerResult.distanceKm,
        variance,
        notes: payload.notes || `إقرار تصفية مقدم من المندوب بانتظار اعتماد المشرف. عجز/زيادة: ${variance}`,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', payload.tripId)
      .where('tenant_id', '=', tenantId)
      .execute();

    // Auto-record / end active visit if rep had an open visit upon submission
    if (payload.activeVisitCustomerId) {
      const custId = Number(payload.activeVisitCustomerId);
      if (custId > 0) {
        const existingVisit = await this.anyDb
          .selectFrom('van_field_visits')
          .select(['id'])
          .where('trip_id', '=', payload.tripId)
          .where('customer_id', '=', custId)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        if (!existingVisit) {
          const custSale = await this.anyDb
            .selectFrom('sales')
            .select(['id'])
            .where('van_trip_id', '=', payload.tripId)
            .where('customer_id', '=', custId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();

          await this.anyDb
            .insertInto('van_field_visits')
            .values({
              tenant_id: tenantId,
              account_id: accountId,
              trip_id: payload.tripId,
              rep_id: repId,
              customer_id: custId,
              visit_type: custSale?.id ? 'positive' : 'negative',
              sale_id: custSale?.id ? Number(custSale.id) : null,
              negative_reason: custSale?.id ? null : 'other',
              notes: 'تم إنهاء وتوثيق الزيارة تلقائياً عند تقديم إقرار التصفية',
              visited_at: sql`NOW()`,
              created_at: sql`NOW()`,
            })
            .execute();
        }
      }
    }

    return {
      ok: true,
      tripId: payload.tripId,
      expectedCash,
      countedCash,
      variance,
      distanceKm: odometerResult.distanceKm,
      status: 'submitted_by_rep',
      message: 'تم تسليم إقرار الرحلة والنقدية بنجاح، وبانتظار اعتماد المشرف وأمين المستودع',
    };
  }

  /**
   * Final audit and settlement of a van trip.
   * Can be executed by supervisor/cashier (with Maker-Checker check against the rep).
   * Performs physical stock audit, handles overnight stock (Night Stock), unloads inventory
   * to warehouse if requested, updates fleet vehicle odometer, and posts closing GL journals.
   */
  async settleTrip(
    repId: number,
    tenantId: string,
    accountId: string,
    payload: {
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
    },
    authContext?: AuthContext,
  ): Promise<{
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
    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .selectAll()
      .where('vt.id', '=', payload.tripId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.rep_id', '=', repId)
      .where('vt.status', '!=', 'settled')
      .executeTakeFirst();

    if (!trip) {
      throw new AppError('الرحلة غير موجودة أو تم تصفيتها واعتمادها بالفعل', 'TRIP_NOT_FOUND', 404);
    }

    // Lookup rep details to check Maker-Checker against linked user
    const rep = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name', 'phone'])
      .where('id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    const actorUserId = authContext?.userId ? Number(authContext.userId) : 0;
    let repUserId: number | null = null;
    if (rep?.phone) {
      const linkedUser = await this.anyDb
        .selectFrom('users')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`(phone = ${String(rep.phone)} or username = ${String(rep.phone)})`)
        .executeTakeFirst();
      if (linkedUser?.id) repUserId = Number(linkedUser.id);
    }

    if (authContext) {
      const isSupervisor =
        ['admin', 'super_admin'].includes(authContext.role) ||
        (authContext.permissions &&
          authContext.permissions.some((p: string) =>
            ['deliveryReps', 'accounting'].includes(p),
          ));

      const makerChecker = evaluateMakerCheckerSettlement({
        repUserId,
        actorUserId,
        actorRole: authContext.role,
        isSupervisorOrAdmin: Boolean(isSupervisor),
      });

      if (!makerChecker.allowed) {
        await this.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          repName: rep?.name ? String(rep.name) : undefined,
          tripId: payload.tripId,
          eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_UNAUTHORIZED_LOAD_OR_SETTLE,
          severity: 'critical',
          titleAr: 'محاولة تصفية رحلة ذاتياً بدون صلاحية مشرف (خرق Maker-Checker)',
          detailsAr: makerChecker.errorMessageAr || 'حاول المندوب اعتماد وتصفية رحلته بنفسه دون مراجعة المشرف.',
          metadata: {
            reasonCode: makerChecker.reasonCode,
            actorUserId,
            repUserId,
          },
        });
        throw new AppError(makerChecker.errorMessageAr!, makerChecker.reasonCode!, 403);
      }
    }

    // INV-VAN-SELF-SETTLE-PIN-REQUIRED: the rep never decides whether
    // his own stock shortage is charged to him or waived to warehouse
    // losses. Only a supervisor's decision counts (admin settle path,
    // chargeStockVarianceDecidedBySupervisor === true). On the driver
    // path no supervisor charge/waive decision exists, so the shortage
    // stays pending on the rep (fail closed) until a supervisor settles
    // or waives it via settleRepFinancialItem — it is never silently
    // written off by the person charged. Legacy direct callers pass no
    // decision flag and keep the old behavior.
    const effectiveChargeToRep =
      payload.chargeStockVarianceDecidedBySupervisor === true
        ? Boolean(payload.chargeStockVarianceToRep)
        : payload.chargeStockVarianceDecidedBySupervisor === false
          ? true
          : Boolean(payload.chargeStockVarianceToRep);

    // Odometer validation
    const effectiveEndOdometer = payload.endOdometer !== undefined ? payload.endOdometer : (trip.end_odometer !== null ? Number(trip.end_odometer) : undefined);
    const odometerResult = evaluateOdometerReadings({
      startOdometer: trip.start_odometer,
      endOdometer: effectiveEndOdometer,
    });
    if (!odometerResult.valid) {
      await this.recordSuspicionEvent({
        tenantId,
        accountId,
        repId,
        repName: rep?.name ? String(rep.name) : undefined,
        tripId: payload.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_ODOMETER_ROLLBACK,
        severity: 'high',
        titleAr: 'تلاعب في قراءة عداد الكيلومترات عند التصفية النهائية',
        detailsAr: odometerResult.errorMessageAr || `قراءة العداد النهائية (${effectiveEndOdometer}) أقل من قراءة البداية (${trip.start_odometer}).`,
        metadata: {
          startOdometer: trip.start_odometer,
          endOdometer: effectiveEndOdometer,
        },
      });
      throw new AppError(odometerResult.errorMessageAr!, 'INVALID_ODOMETER', 400);
    }

    // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the money inputs below used
    // to be read here, on the pool handle before the transaction — a
    // sale, collection, or expense posted between this read and the
    // settlement commit settled the trip on stale cash. The inputs are
    // now re-read inside the transaction, under the trip row lock
    // (step 0 below), and only the locked values are ever used. The
    // pre-check trip read above stays for the rep/odometer fast-fail
    // only; it no longer feeds any money.
    let totalTripExpenses = 0;
    let grossCashCollected = 0;
    let expectedCash = 0;
    let cashVariance = 0;
    let bookDigits: MoneyDigits = 2;
    let lockedTripTotals: any = null;
    const countedCash = Number(payload.countedCash || 0);
    let unloadedItemsCount = 0;
    let totalStockVarianceCost = 0;
    let totalStockOverageCost = 0;
    let totalUnloadedCost = 0;
    let stockAuditResult: ReturnType<typeof reconcileVanStockAudit> | null = null;

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      // 0. Re-read the trip row under lock and re-check its status inside
      // the transaction. The pre-check above runs on an unlocked read
      // outside any transaction, so two concurrent settles both pass it;
      // without this locked re-check both would run the stock deductions,
      // unload transfers, and trip update, while only the journal was
      // saved (postVanTripSettlement skips a duplicate by its SELECT
      // guard) — duplicated stock effects with no journal. The lock
      // serializes concurrent settlers: the second waits, then sees
      // 'settled' and fails closed instead of repeating the effects.
      const lockedTrip = await trxAny
        .selectFrom('van_sales_trips')
        .select(['id', 'status', 'van_location_id', 'source_warehouse_id', 'cash_collected', 'vehicle_id', 'sales_amount', 'credit_sales', 'returns_amount', 'cash_refunds', 'total_instapay_sales', 'total_instapay_collections'])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .forUpdate()
        .executeTakeFirst();
      if (!lockedTrip) {
        throw new AppError('الرحلة غير موجودة أو تم تصفيتها واعتمادها بالفعل', 'TRIP_NOT_FOUND', 404);
      }
      if (lockedTrip.status === 'settled') {
        throw new AppError('تم تصفية هذه الرحلة بالفعل؛ لا يمكن تصفيتها مرة أخرى', 'TRIP_ALREADY_SETTLED', 409);
      }

      // 0b. Re-read the money inputs inside the transaction, under the
      // lock above: the expenses total and the collected cash as of
      // this instant — never the pre-transaction snapshot. The
      // INV-VAN-SETTLE-BOOK-DIGITS-VARIANCE rule still applies: the
      // variance is computed at tenant book digits through the shared
      // drawer helper, exactly like submitTripSettlement, and the
      // expected side is rounded to book digits before the variance
      // is taken.
      bookDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
      const lockedExpensesRow = await trxAny
        .selectFrom('van_trip_expenses')
        .select(sql<number>`cast(coalesce(sum(amount), 0) as numeric)`.as('totalExpenses'))
        .where('trip_id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      totalTripExpenses = Number(lockedExpensesRow?.totalExpenses || 0);
      grossCashCollected = Number(lockedTrip.cash_collected || 0);
      lockedTripTotals = lockedTrip;
      expectedCash = roundMoney(grossCashCollected - totalTripExpenses, bookDigits);
      cashVariance = computeCashDrawerVariance(countedCash, expectedCash, bookDigits);

      // 1. Fetch current remaining van stock
      const vanLocationId = Number(lockedTrip.van_location_id);
      const remainingStocks = await trxAny
        .selectFrom('product_location_stock as pls')
        .innerJoin('products as p', 'p.id', 'pls.product_id')
        .select([
          'pls.id as stockLocationRecordId',
          'pls.product_id as productId',
          sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
          sql<string>`coalesce(p.name, '')`.as('name'),
          sql<number>`cast(coalesce(p.cost_price, 0) as numeric)`.as('costPrice'),
          sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
        ])
        .where('pls.location_id', '=', vanLocationId)
        .where('pls.tenant_id', '=', tenantId)
        .where(sql<boolean>`cast(pls.qty as numeric) > 0`)
        .execute();

      // 2. Physical Stock Audit Reconciliation via pure engine
      const auditItems = remainingStocks.map((rs: any) => {
        const countedMatch = payload.countedStock?.find((cs) => Number(cs.productId) === Number(rs.productId));
        return {
          productId: Number(rs.productId),
          productName: rs.name,
          systemQty: Number(rs.qty),
          countedQty: countedMatch ? Number(countedMatch.countedQty) : undefined,
          costPrice: Number(rs.costPrice),
          retailPrice: Number(rs.retailPrice),
        };
      });

      const stockAuditDigits = currencyMoneyDigits(await tenantBaseCurrency(trxAny, tenantId));
      stockAuditResult = reconcileVanStockAudit(auditItems, stockAuditDigits);
      totalStockVarianceCost = stockAuditResult.totalStockShortageCost;
      totalStockOverageCost = stockAuditResult.totalStockOverageCost;

      // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: an item nobody counted
      // is NOT certified balanced. Refuse the settle — inside the
      // transaction, before any stock deduction, journal, or trip
      // update — and name the uncounted products in the error so the
      // caller knows exactly what to count. There is no supervisor
      // bypass flag: the supervisor's explicit decision IS a physical
      // count (submit the verified countedQty for that product); a
      // flag certifying an unverified item as balanced would be the
      // same false certification this fix removes. A van with no
      // remaining stock has no uncounted items and settles normally.
      if (stockAuditResult.hasUncountedItems) {
        const names = stockAuditResult.uncountedItems
          .map((u) => `${u.productName} (#${u.productId})`)
          .join('، ');
        throw new AppError(
          `لا يمكن تصفية الرحلة قبل اكتمال الجرد: الأصناف التالية لم تُعدّ بعد — ${names}. أعدّ كل صنف في السيارة (أو أكّد كميته بعد الفحص الفعلي) ثم أعد التصفية.`,
          'VAN_STOCK_AUDIT_INCOMPLETE',
          422,
        );
      }

      // Deduct missing stock items if shortage was detected
      for (const itemVariance of stockAuditResult.itemVariances) {
        if (itemVariance.status === 'shortage' && itemVariance.varianceQty < 0) {
          const shortageQty = Math.abs(itemVariance.varianceQty);
          await this.moveVanStock(trx, {
            productId: itemVariance.productId,
            delta: -shortageQty,
            locationId: vanLocationId,
            tenantId,
            accountId,
            userId: actorUserId || null,
            movementType: 'van_stock_shortage',
            note: `عجز جرد سيارة توزيع - رحلة #${payload.tripId}`,
            referenceType: 'van_sales_trip',
            referenceId: Number(payload.tripId),
            skipGlobalUpdate: false,
            unitCost: itemVariance.costPrice,
          });
          // INV-VAN-FEFO-BATCHES: missing stock leaves the van's batches too.
          // Never fail-closed here: the shortage itself is the variance being
          // settled, so deduct whatever batch cover exists.
          await this.deductVanSalePharmacyBatches(
            trx,
            itemVariance.productId,
            shortageQty,
            { tenantId, accountId },
            vanLocationId,
            false,
          );
        }
      }

      // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: mirror of the shortage
      // loop above. Overage units physically in the van are added to
      // van stock (movement 'van_stock_overage') so the system qty
      // matches the count; the added value is accounted by the
      // settlement journal (Dr 1140 / Cr 7100 in
      // postVanTripSettlement), never by a silent stock or income
      // increase. No pharmacy-batch move: found units carry no batch
      // identity to attach them to.
      for (const itemVariance of stockAuditResult.itemVariances) {
        if (itemVariance.status === 'overage' && itemVariance.varianceQty > 0) {
          await this.moveVanStock(trx, {
            productId: itemVariance.productId,
            delta: itemVariance.varianceQty,
            locationId: vanLocationId,
            tenantId,
            accountId,
            userId: actorUserId || null,
            movementType: 'van_stock_overage',
            note: `زيادة جرد سيارة توزيع - رحلة #${payload.tripId}`,
            referenceType: 'van_sales_trip',
            referenceId: Number(payload.tripId),
            skipGlobalUpdate: false,
            unitCost: itemVariance.costPrice,
          });
        }
      }

      // 3. Night Stock Governance
      const nightStockEval = evaluateNightStockRetention({
        unloadRemainingToWarehouse: payload.unloadRemainingToWarehouse,
        remainingItemsCount: remainingStocks.length,
        nightStockApproved: Boolean(payload.nightStockApproved),
        nightStockNotes: payload.nightStockNotes,
      });

      if (!nightStockEval.allowed) {
        throw new AppError(nightStockEval.errorMessageAr!, 'NIGHT_STOCK_UNAPPROVED', 422);
      }

      // 4. Unload remaining stock to warehouse if requested
      if (payload.unloadRemainingToWarehouse && remainingStocks.length > 0) {
        // Query remaining stock after any shortage deductions, sorted by product_id
        const postAuditStocks = await trxAny
          .selectFrom('product_location_stock as pls')
          .innerJoin('products as p', 'p.id', 'pls.product_id')
          .select([
            'pls.product_id as productId',
            sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
            sql<number>`cast(coalesce(p.cost_price, 0) as numeric)`.as('costPrice'),
          ])
          .where('pls.location_id', '=', vanLocationId)
          .where('pls.tenant_id', '=', tenantId)
          .where(sql<boolean>`cast(pls.qty as numeric) > 0`)
          .orderBy('pls.product_id', 'asc')
          .execute();

        for (const rem of postAuditStocks) {
          const pid = Number(rem.productId);
          const qty = Number(rem.qty);
          const cost = Number(rem.costPrice);
          if (qty <= 0) continue;

          // CANONICAL LOCK ORDER: Lock products first!
          await trxAny
            .selectFrom('products')
            .select(['id'])
            .where('id', '=', pid)
            .where('tenant_id', '=', tenantId)
            .forUpdate()
            .executeTakeFirst();

          // Out from van
          await this.moveVanStock(trx, {
            productId: pid,
            delta: -qty,
            locationId: vanLocationId,
            tenantId,
            accountId,
            userId: actorUserId || null,
            movementType: 'van_unload_out',
            note: 'تصفية رحلة - خروج من السيارة',
            referenceType: 'van_sales_trip',
            referenceId: Number(payload.tripId),
            skipGlobalUpdate: false,
            unitCost: cost,
          });

          // INV-VAN-FEFO-BATCHES: the batches return with the goods.
          await this.moveVanPharmacyBatches(trx, { tenantId, accountId }, pid, qty, vanLocationId, Number(lockedTrip.source_warehouse_id));

          // In to warehouse
          await this.moveVanStock(trx, {
            productId: pid,
            delta: qty,
            locationId: Number(lockedTrip.source_warehouse_id),
            tenantId,
            accountId,
            userId: actorUserId || null,
            movementType: 'van_unload_in',
            note: 'تصفية رحلة - عودة للمستودع',
            referenceType: 'van_sales_trip',
            referenceId: Number(payload.tripId),
            skipGlobalUpdate: false,
            unitCost: cost,
          });

          totalUnloadedCost += qty * cost;
          unloadedItemsCount++;
        }
      }

      // 5. Update vehicle current odometer if vehicle was tracked
      if (lockedTrip.vehicle_id && effectiveEndOdometer !== undefined) {
        await trxAny
          .updateTable('fleet_vehicles')
          .set({
            current_odometer: effectiveEndOdometer,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', Number(lockedTrip.vehicle_id))
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      // 6. Update trip status to settled
      await trxAny
        .updateTable('van_sales_trips')
        .set({
          status: 'settled',
          settlement_status: 'settled',
          closed_at: sql`NOW()`,
          settled_by: actorUserId || null,
          supervisor_id: actorUserId || null,
          stock_variance_amount: totalStockVarianceCost,
          stock_variance_details: stockAuditResult?.itemVariances?.length ? JSON.stringify(stockAuditResult.itemVariances) : null,
          night_stock_approved: Boolean(payload.nightStockApproved),
          night_stock_approved_by: payload.nightStockApproved ? (actorUserId || null) : null,
          night_stock_notes: payload.nightStockNotes || null,
          end_odometer: effectiveEndOdometer ?? null,
          distance_km: odometerResult.distanceKm,
          variance: cashVariance,
          notes: payload.notes || `تم إغلاق وتصفية رحلة التوزيع بنجاح. عجز/زيادة الكاش: ${cashVariance}، عجز المخزون: ${totalStockVarianceCost}`,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .execute();

      // Record cash variance in rep financial ledger. The gate is
      // nonzero-at-book-digits (INV-VAN-SETTLE-BOOK-DIGITS-VARIANCE):
      // the old fixed 0.01 gate dropped real fils variances on
      // 3-decimal tenants. The 0.5 suspicion gate below is a currency
      // materiality policy and is deliberately unchanged.
      if (cashVariance < 0) {
        await trxAny
          .insertInto('van_rep_financial_settlements')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rep_id: repId,
            trip_id: payload.tripId,
            entry_type: 'cash_shortage',
            amount: Math.abs(cashVariance),
            status: 'pending',
            notes: `عجز كاش تصفية رحلة #${payload.tripId} (متوقع ${expectedCash} - مسلّم ${countedCash})`,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .execute();
      } else if (cashVariance > 0) {
        await trxAny
          .insertInto('van_rep_financial_settlements')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rep_id: repId,
            trip_id: payload.tripId,
            entry_type: 'cash_overage',
            amount: cashVariance,
            status: 'settled',
            settled_at: sql`NOW()`,
            settled_by: actorUserId || null,
            settlement_method: 'cash',
            notes: `فائض كاش تصفية رحلة #${payload.tripId} (متوقع ${expectedCash} - مسلّم ${countedCash})`,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .execute();
      }

      // Record stock shortage in rep financial ledger
      if (totalStockVarianceCost > 0.01) {
        await trxAny
          .insertInto('van_rep_financial_settlements')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rep_id: repId,
            trip_id: payload.tripId,
            entry_type: 'stock_shortage',
            amount: totalStockVarianceCost,
            status: effectiveChargeToRep ? 'pending' : 'waived',
            settled_at: effectiveChargeToRep ? null : sql`NOW()`,
            settled_by: effectiveChargeToRep ? null : (actorUserId || null),
            settlement_method: effectiveChargeToRep ? null : 'waiver',
            notes: `عجز جرد بضاعة رحلة #${payload.tripId} ${effectiveChargeToRep ? '(محمل على المندوب)' : '(خسائر مستودع معفاة)'}`,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .execute();
      }

      // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: record stock overage in
      // the rep financial ledger (mirror of the shortage row above).
      // It is settled at once — an overage is a recorded gain, never
      // a claim on the rep — so operators see it in the same ledger
      // where shortages appear, instead of only in the journal. The
      // 0.01 gate mirrors the shortage row's gate exactly.
      if (totalStockOverageCost > 0.01) {
        await trxAny
          .insertInto('van_rep_financial_settlements')
          .values({
            tenant_id: tenantId,
            account_id: accountId,
            rep_id: repId,
            trip_id: payload.tripId,
            entry_type: 'stock_overage',
            amount: totalStockOverageCost,
            status: 'settled',
            settled_at: sql`NOW()`,
            settled_by: actorUserId || null,
            settlement_method: 'stock_audit',
            notes: `زيادة جرد بضاعة رحلة #${payload.tripId} (مسجلة كزيادة مخزنية، غير محملة على المندوب)`,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          })
          .execute();
      }

      // Auto-record / finish any ongoing active customer visit upon settlement
      if (payload.activeVisitCustomerId) {
        const custId = Number(payload.activeVisitCustomerId);
        if (custId > 0) {
          const existingVisit = await trxAny
            .selectFrom('van_field_visits')
            .select(['id'])
            .where('trip_id', '=', payload.tripId)
            .where('customer_id', '=', custId)
            .where('tenant_id', '=', tenantId)
            .executeTakeFirst();

          if (!existingVisit) {
            const custSale = await trxAny
              .selectFrom('sales')
              .select(['id'])
              .where('van_trip_id', '=', payload.tripId)
              .where('customer_id', '=', custId)
              .where('tenant_id', '=', tenantId)
              .executeTakeFirst();

            await trxAny
              .insertInto('van_field_visits')
              .values({
                tenant_id: tenantId,
                account_id: accountId,
                trip_id: payload.tripId,
                rep_id: repId,
                customer_id: custId,
                visit_type: custSale?.id ? 'positive' : 'negative',
                sale_id: custSale?.id ? Number(custSale.id) : null,
                negative_reason: custSale?.id ? null : 'other',
                notes: 'تم إنهاء وتوثيق الزيارة تلقائياً عند تصفية وإغلاق اليومية',
                visited_at: sql`NOW()`,
                created_at: sql`NOW()`,
              })
              .execute();
          }
        }
      }

      // 7. General Ledger Double-Entry Postings
      const vanLocRow = await trxAny
        .selectFrom('stock_locations')
        .select(['branch_id'])
        .where('id', '=', vanLocationId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      const branchId = vanLocRow?.branch_id ? Number(vanLocRow.branch_id) : null;
      const systemAuth = authContext || (await this.resolveSystemAuthContext(tenantId, accountId));

      // Post van trip settlement (cash collected + shortage/overage + stock shortage allocation)
      await this.accountingPosting.postVanTripSettlement(
        trx,
        payload.tripId,
        {
          expectedCash,
          countedCash,
          tripExpenses: totalTripExpenses,
          branchId,
          locationId: vanLocationId,
          stockShortageAmount: totalStockVarianceCost,
          stockOverageAmount: totalStockOverageCost,
          chargeStockVarianceToRep: effectiveChargeToRep,
        },
        systemAuth,
      );

      // 7b. INV-REP-CASH-REMITTANCE-SHIFT: the counted cash the rep
      // physically hands over is drawer cash from here on — the
      // settlement journal above already debited 1110 for it — but no
      // shift's expected cash sees it until a treasury row links it
      // to the receiving shift. Write that row here, in the same
      // transaction as the journal, and post NO second GL leg:
      // postCashDrawerMovement must never run for a handover (it
      // would debit 1110 a second time and credit 7100 income for
      // rep cash). A settle with no counted cash writes no row. The
      // remittance row is written unconditionally once the posting
      // call returns: postVanTripSettlement's contract is
      // journalEntryId: number | null, and a null id with counted
      // cash > 0 is impossible in production (counted cash always
      // builds a 1110 line, so the posting either journals or
      // throws) — gating the row on the id would only break
      // callers that stub the posting, not protect the books.
      const remittedCash = roundMoney(countedCash, bookDigits);
      if (remittedCash > 0) {
        await this.insertRepCashRemittanceRow(trx, {
          tenantId,
          accountId,
          tripId: payload.tripId,
          repName: rep?.name ? String(rep.name) : 'مندوب التوزيع',
          amount: remittedCash,
          branchId,
          actorUserId,
          createdBy: actorUserId > 0 ? actorUserId : (systemAuth.userId ? Number(systemAuth.userId) : null),
        });
      }

      // Post unload stock transfer if items were returned to warehouse
      if (payload.unloadRemainingToWarehouse && totalUnloadedCost > 0) {
        await this.accountingPosting.postVanStockTransfer(
          trx,
          payload.tripId,
          {
            sourceLocationId: vanLocationId,
            targetLocationId: Number(lockedTrip.source_warehouse_id),
            totalCost: totalUnloadedCost,
            branchId,
            type: 'unload',
          },
          systemAuth,
        );
      }
    });

    if (cashVariance < -0.5 || totalStockVarianceCost > 0.5) {
      const cashShortageAmount = cashVariance < 0 ? Math.abs(cashVariance) : 0;
      const totalShortage = roundMoney(cashShortageAmount + totalStockVarianceCost, bookDigits);
      await this.recordSuspicionEvent({
        tenantId,
        accountId,
        repId,
        repName: rep?.name ? String(rep.name) : undefined,
        tripId: payload.tripId,
        eventCode: AUDIT_EVENT_CODES.VAN_SUSPICION_SETTLEMENT_SHORTAGE,
        severity: totalShortage >= 500 ? 'critical' : 'high',
        titleAr: 'رصد عجز نقدي أو مخزني عند تصفية رحلة التوزيع',
        detailsAr: `تم تصفية الرحلة #${payload.tripId} بعجز نقدي قدره (${cashShortageAmount.toFixed(2)}) وعجز بضاعة مفقودة بتكلفة (${totalStockVarianceCost.toFixed(2)}). إجمالي العجز المسجل على المندوب: (${totalShortage.toFixed(2)}).`,
        amountInvolved: totalShortage,
        metadata: {
          expectedCash,
          countedCash,
          cashVariance,
          stockVarianceAmount: totalStockVarianceCost,
          chargeStockVarianceToRep: effectiveChargeToRep,
        },
      });
    }

    // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the return echo reads the
    // locked row's aggregates (captured inside the transaction below),
    // never the pre-transaction snapshot.
    const salesAmount = Number(lockedTripTotals.sales_amount || 0);
    const creditSales = Number(lockedTripTotals.credit_sales || 0);
    const cashSales = Math.max(0, salesAmount - creditSales);
    const returnsAmount = Number(lockedTripTotals.returns_amount || 0);
    const cashRefunds = Number(lockedTripTotals.cash_refunds || 0);
    const creditReturns = Math.max(0, returnsAmount - cashRefunds);
    const collectionsTotal = Math.max(0, roundMoney(grossCashCollected - cashSales + cashRefunds, bookDigits));

    return {
      ok: true,
      tripId: payload.tripId,
      expectedCash,
      countedCash,
      tripExpenses: totalTripExpenses,
      variance: cashVariance,
      stockVarianceAmount: totalStockVarianceCost,
      stockOverageAmount: totalStockOverageCost,
      unloadedItemsCount,
      distanceKm: odometerResult.distanceKm,
      status: 'settled',
      cashierName: authContext?.username || 'أمين الخزينة',
      cashierId: actorUserId || null,
      repName: rep?.name ? String(rep.name) : 'مندوب التوزيع',
      settledAt: new Date().toISOString(),
      salesAmount,
      cashSales,
      creditSales,
      collectionsTotal,
      returnsAmount,
      cashRefunds,
      creditReturns,
      totalInstapaySales: Number(lockedTripTotals.total_instapay_sales || 0),
      totalInstapayCollections: Number(lockedTripTotals.total_instapay_collections || 0),
      expectedBankTransfers: roundMoney(Number(lockedTripTotals.total_instapay_sales || 0) + Number(lockedTripTotals.total_instapay_collections || 0), bookDigits),
      stockVariances: (stockAuditResult as any)?.itemVariances || [],
    };
  }

  /**
   * INV-REP-CASH-REMITTANCE-SHIFT: links a settled trip's counted cash
   * to the receiving shift with a single treasury row — no GL journal.
   * The rep's custody is discharged by the same transaction that
   * posts the settlement journal and marks the trip settled, so the
   * row, the journal, and the custody release commit or roll back
   * together; there is no separate custody balance to update. The
   * receiving shift is the settle actor's own open shift on the
   * branch (the PIN supervisor / admin settler is the person the rep
   * hands the cash to); with no actor, the branch's latest open shift
   * receives it — the same branch-only fallback granularity the
   * cross-shift cancel refund uses. No open shift on the branch fails
   * closed: cash with no drawer must not settle. The deterministic
   * request key (one per trip, scoped by the partial unique index on
   * drawer rows) makes a retried handover collide instead of
   * doubling the shift's expected cash. The note carries 'مندوب' so
   * the drawer listing classifies the row as a delivery receipt, as
   * it does for every other rep handover row operators record.
   */
  private async insertRepCashRemittanceRow(
    trx: any,
    params: {
      tenantId: string;
      accountId: string;
      tripId: number;
      repName: string;
      amount: number;
      branchId: number | null;
      actorUserId: number;
      createdBy: number | null;
    },
  ): Promise<void> {
    const { tenantId, accountId, tripId, amount, branchId } = params;
    const branchMatch = (eb: any) =>
      branchId == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', branchId);
    type ShiftRow = { id: number; branch_id: number | null; location_id: number | null };
    let shift: ShiftRow | undefined;
    if (params.actorUserId > 0) {
      shift = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .where('opened_by', '=', params.actorUserId)
        .where(branchMatch)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
    }
    if (!shift) {
      shift = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .where(branchMatch)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
    }
    if (!shift) {
      throw new AppError('يجب فتح وردية على الفرع قبل توريد نقدية المندوب', 'OPEN_SHIFT_REQUIRED', 400);
    }
    await trx
      .insertInto('treasury_transactions')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        txn_type: 'rep_cash_remittance',
        amount,
        note: `توريد نقدية مندوب ${params.repName} - رحلة #${tripId}`,
        reference_type: 'cashier_shift',
        reference_id: Number(shift.id),
        branch_id: shift.branch_id ? Number(shift.branch_id) : null,
        location_id: shift.location_id ? Number(shift.location_id) : null,
        created_by: params.createdBy,
        payment_channel: 'cash',
        request_key: `rep-remittance:trip:${tripId}`,
      } as any)
      .execute();
  }

  /**
   * Admin audit list of all van trips.
   */
  async listTripsForAdmin(
    tenantId: string,
    filters?: { repId?: number; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<VanTripSummary[]> {
    let query = this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as src', 'src.id', 'vt.source_warehouse_id')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vt.rep_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        'vt.id',
        'vt.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        'vt.vehicle_id as vehicleId',
        sql<string>`coalesce(fv.plate_number, '')`.as('vehiclePlate'),
        sql<string>`coalesce(fv.model_name, '')`.as('vehicleModel'),
        'vt.shift_name as shiftName',
        sql<number>`cast(coalesce(vt.start_odometer, 0) as numeric)`.as('startOdometer'),
        sql<number>`cast(coalesce(vt.end_odometer, 0) as numeric)`.as('endOdometer'),
        'vt.van_location_id as vanLocationId',
        sql<string>`coalesce(van.name, '')`.as('vanLocationName'),
        'vt.source_warehouse_id as sourceWarehouseId',
        sql<string>`coalesce(src.name, '')`.as('sourceWarehouseName'),
        'vt.status',
        'vt.settlement_status as settlementStatus',
        'vt.opened_at as openedAt',
        'vt.closed_at as closedAt',
        'vt.submitted_at as submittedAt',
        sql<number>`cast(coalesce(vt.loaded_amount, 0) as numeric)`.as('loadedAmount'),
        sql<number>`cast(coalesce(vt.sales_amount, 0) as numeric)`.as('salesAmount'),
        sql<number>`cast(coalesce(vt.cash_collected, 0) as numeric)`.as('cashCollected'),
        sql<number>`cast(coalesce(vt.credit_sales, 0) as numeric)`.as('creditSales'),
        sql<number>`cast(coalesce(vt.returns_amount, 0) as numeric)`.as('returnsAmount'),
        sql<number>`cast(coalesce(vt.cash_refunds, 0) as numeric)`.as('cashRefunds'),
        sql<number>`cast(coalesce(vt.variance, 0) as numeric)`.as('variance'),
        sql<number>`cast(coalesce(vt.distance_km, 0) as numeric)`.as('distanceKm'),
        sql<number>`cast(coalesce(vt.stock_variance_amount, 0) as numeric)`.as('stockVarianceAmount'),
        'vt.night_stock_approved as nightStockApproved',
        'vt.notes',
      ])
      .where('vt.tenant_id', '=', tenantId);

    if (filters?.repId) {
      query = query.where('vt.rep_id', '=', Number(filters.repId));
    }
    if (filters?.status) {
      query = query.where('vt.status', '=', filters.status);
    }
    if (filters?.dateFrom) {
      query = query.where('vt.opened_at', '>=', new Date(filters.dateFrom));
    }
    if (filters?.dateTo) {
      query = query.where('vt.opened_at', '<=', new Date(filters.dateTo));
    }

    const rows = await query.orderBy('vt.id', 'desc').limit(50).execute();

    return rows.map((r: any) => ({
      id: Number(r.id),
      repId: Number(r.repId),
      repName: r.repName,
      vehicleId: r.vehicleId ? Number(r.vehicleId) : undefined,
      vehiclePlate: r.vehiclePlate || undefined,
      vehicleModel: r.vehicleModel || undefined,
      shiftName: r.shiftName || 'صباحي',
      startOdometer: Number(r.startOdometer || 0),
      endOdometer: r.endOdometer ? Number(r.endOdometer) : undefined,
      vanLocationId: Number(r.vanLocationId),
      vanLocationName: r.vanLocationName,
      sourceWarehouseId: Number(r.sourceWarehouseId),
      sourceWarehouseName: r.sourceWarehouseName,
      status: r.status as any,
      openedAt: String(r.openedAt),
      closedAt: r.closedAt ? String(r.closedAt) : undefined,
      loadedAmount: Number(r.loadedAmount || 0),
      salesAmount: Number(r.salesAmount || 0),
      cashCollected: Number(r.cashCollected || 0),
      creditSales: Number(r.creditSales || 0),
      returnsAmount: Number(r.returnsAmount || 0),
      cashRefunds: Number(r.cashRefunds || 0),
      variance: Number(r.variance || 0),
      notes: r.notes || '',
    }));
  }

  /**
   * Admin detailed audit of a single van trip, including all sales (with GPS), collections (with GPS), and returns.
   */
  async getTripDetailsForAdmin(tenantId: string, tripId: number, pagination?: { page?: number; pageSize?: number }) {
    const { page, pageSize, offset } = boundedPage(pagination?.page, pagination?.pageSize);
    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as src', 'src.id', 'vt.source_warehouse_id')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vt.rep_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        'vt.id',
        'vt.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        sql<string>`coalesce(dr.phone, '')`.as('repPhone'),
        'vt.vehicle_id as vehicleId',
        sql<string>`coalesce(fv.plate_number, '')`.as('vehiclePlate'),
        sql<string>`coalesce(fv.model_name, '')`.as('vehicleModel'),
        'vt.shift_name as shiftName',
        sql<number>`cast(coalesce(vt.start_odometer, 0) as numeric)`.as('startOdometer'),
        sql<number>`cast(coalesce(vt.end_odometer, 0) as numeric)`.as('endOdometer'),
        'vt.van_location_id as vanLocationId',
        sql<string>`coalesce(van.name, '')`.as('vanLocationName'),
        'vt.source_warehouse_id as sourceWarehouseId',
        sql<string>`coalesce(src.name, '')`.as('sourceWarehouseName'),
        'vt.status',
        'vt.opened_at as openedAt',
        'vt.closed_at as closedAt',
        sql<number>`cast(coalesce(vt.loaded_amount, 0) as numeric)`.as('loadedAmount'),
        sql<number>`cast(coalesce(vt.sales_amount, 0) as numeric)`.as('salesAmount'),
        sql<number>`cast(coalesce(vt.cash_collected, 0) as numeric)`.as('cashCollected'),
        sql<number>`cast(coalesce(vt.credit_sales, 0) as numeric)`.as('creditSales'),
        sql<number>`cast(coalesce(vt.returns_amount, 0) as numeric)`.as('returnsAmount'),
        sql<number>`cast(coalesce(vt.cash_refunds, 0) as numeric)`.as('cashRefunds'),
        sql<number>`cast(coalesce(vt.variance, 0) as numeric)`.as('variance'),
        'vt.notes',
      ])
      .where('vt.id', '=', tripId)
      .where('vt.tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!trip) {
      throw new AppError('رحلة التوزيع الميداني غير موجودة', 'TRIP_NOT_FOUND', 404);
    }

    // Sales executed in this trip
    const sales = await this.anyDb
      .selectFrom('sales as s')
      .leftJoin('customers as c', (join: any) => join.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 's.tenant_id'))
      .select([
        's.id',
        's.doc_no as docNo',
        sql<number>`cast(coalesce(s.total, 0) as numeric)`.as('total'),
        sql<string>`coalesce(s.payment_type, 'cash')`.as('paymentMethod'),
        's.created_at as createdAt',
        sql<string>`coalesce(c.name, 'عميل نقدي')`.as('customerName'),
        sql<string>`coalesce(c.phone, '')`.as('customerPhone'),
        'c.metadata as customerMetadata',
        sql<number>`cast(s.delivery_gps_lat as double precision)`.as('deliveryGpsLat'),
        sql<number>`cast(s.delivery_gps_lng as double precision)`.as('deliveryGpsLng'),
      ])
      .where('s.tenant_id', '=', tenantId)
      .where(sql<boolean>`s.van_trip_id = ${tripId}`)
      .orderBy('s.id', 'desc')
      .limit(pageSize + 1).offset(offset)
      .execute();

    // Collections recorded in this trip
    const collections = await this.anyDb
      .selectFrom('customer_ledger as cl')
      .leftJoin('customers as c', (join: any) => join.onRef('c.id', '=', 'cl.customer_id').onRef('c.tenant_id', '=', 'cl.tenant_id'))
      .select([
        'cl.id',
        sql<number>`cast(abs(coalesce(cl.amount, 0)) as numeric)`.as('amount'),
        'cl.created_at as createdAt',
        sql<string>`coalesce(c.name, 'عميل')`.as('customerName'),
        'c.metadata as customerMetadata',
        'cl.note',
        sql<number>`cast(cl.gps_lat as double precision)`.as('gpsLat'),
        sql<number>`cast(cl.gps_lng as double precision)`.as('gpsLng'),
      ])
      .where('cl.tenant_id', '=', tenantId)
      .where(sql<boolean>`cl.van_trip_id = ${tripId}`)
      .where('cl.entry_type', '=', 'payment')
      .orderBy('cl.id', 'desc')
      .limit(pageSize + 1).offset(offset)
      .execute();

    // Field returns recorded in this trip
    const returns = await this.anyDb
      .selectFrom('van_field_returns as vfr')
      .leftJoin('customers as c', (join: any) => join.onRef('c.id', '=', 'vfr.customer_id').onRef('c.tenant_id', '=', 'vfr.tenant_id'))
      .select([
        'vfr.id',
        'vfr.doc_no as docNo',
        sql<number>`cast(coalesce(vfr.total_amount, 0) as numeric)`.as('totalAmount'),
        'vfr.return_reason as returnReason',
        'vfr.refund_method as refundMethod',
        'vfr.status',
        'vfr.created_at as createdAt',
        sql<string>`coalesce(c.name, '')`.as('customerName'),
      ])
      .where('vfr.tenant_id', '=', tenantId)
      .where('vfr.trip_id', '=', tripId)
      .orderBy('vfr.id', 'desc')
      .limit(pageSize + 1).offset(offset)
      .execute();

    // Inventory currently on van location
    const vanStock = await this.anyDb
      .selectFrom('product_location_stock as pls')
      .innerJoin('products as p', 'p.id', 'pls.product_id')
      .select([
        'p.id as productId',
        'p.name as productName',
        'p.barcode as barcode',
        sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
        sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
      ])
      .where('pls.location_id', '=', Number(trip.vanLocationId))
      .where('pls.tenant_id', '=', tenantId)
      .where(sql<boolean>`pls.qty > 0`)
      .orderBy('p.name', 'asc')
      .execute();

    return {
      trip: {
        ...trip,
        id: Number(trip.id),
        repId: Number(trip.repId),
        startOdometer: Number(trip.startOdometer || 0),
        endOdometer: trip.endOdometer ? Number(trip.endOdometer) : undefined,
        loadedAmount: Number(trip.loadedAmount || 0),
        salesAmount: Number(trip.salesAmount || 0),
        cashCollected: Number(trip.cashCollected || 0),
        creditSales: Number(trip.creditSales || 0),
        returnsAmount: Number(trip.returnsAmount || 0),
        cashRefunds: Number((trip as any).cashRefunds || 0),
        variance: Number(trip.variance || 0),
      },
      pagination: { page, pageSize, salesHasMore: sales.length > pageSize, collectionsHasMore: collections.length > pageSize, returnsHasMore: returns.length > pageSize },
      sales: sales.slice(0, pageSize).map((s: any) => {
        const custCoords = extractCoordinatesFromCustomerLocation({ metadata: s.customerMetadata });
        const geo = evaluateGeofenceCompliance({
          repLat: s.deliveryGpsLat != null ? Number(s.deliveryGpsLat) : null,
          repLng: s.deliveryGpsLng != null ? Number(s.deliveryGpsLng) : null,
          customerLat: custCoords?.lat ?? null,
          customerLng: custCoords?.lng ?? null,
          maxAllowedMeters: 300,
        });
        const { customerMetadata: _cm, ...rest } = s;
        return {
          ...rest,
          id: Number(s.id),
          total: Number(s.total || 0),
          deliveryGpsLat: s.deliveryGpsLat != null ? Number(s.deliveryGpsLat) : undefined,
          deliveryGpsLng: s.deliveryGpsLng != null ? Number(s.deliveryGpsLng) : undefined,
          distanceMeters: geo.distanceMeters,
          isWithinGeofence: geo.isCompliant,
          geofenceStatus: geo.status,
        };
      }),
      collections: collections.slice(0, pageSize).map((c: any) => {
        const custCoords = extractCoordinatesFromCustomerLocation({ metadata: c.customerMetadata });
        const geo = evaluateGeofenceCompliance({
          repLat: c.gpsLat != null ? Number(c.gpsLat) : null,
          repLng: c.gpsLng != null ? Number(c.gpsLng) : null,
          customerLat: custCoords?.lat ?? null,
          customerLng: custCoords?.lng ?? null,
          maxAllowedMeters: 300,
        });
        const { customerMetadata: _cm, ...rest } = c;
        return {
          ...rest,
          id: Number(c.id),
          amount: Number(c.amount || 0),
          gpsLat: c.gpsLat != null ? Number(c.gpsLat) : undefined,
          gpsLng: c.gpsLng != null ? Number(c.gpsLng) : undefined,
          distanceMeters: geo.distanceMeters,
          isWithinGeofence: geo.isCompliant,
          geofenceStatus: geo.status,
        };
      }),
      returns: returns.slice(0, pageSize).map((r: any) => ({
        ...r,
        id: Number(r.id),
        totalAmount: Number(r.totalAmount || 0),
        refundMethod: r.refundMethod || 'credit',
      })),
      vanStock: vanStock.map((v: any) => ({
        ...v,
        productId: Number(v.productId),
        retailPrice: Number(v.retailPrice || 0),
        qty: Number(v.qty || 0),
      })),
    };
  }

  /**
   * Lists field sales executed by or assigned to a delivery representative,
   * supporting filtering by date scope, customer, payment method, or search query.
   * Includes line items for seamless reprinting on thermal receipts or sharing.
   */
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
    let query = this.anyDb
      .selectFrom('sales as s')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 's.delivery_rep_id')
      .leftJoin('van_sales_trips as vt', 'vt.id', 's.van_trip_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        's.id',
        's.doc_no as docNo',
        sql<number>`cast(s.total as numeric)`.as('total'),
        sql<number>`cast(coalesce(s.subtotal, s.total) as numeric)`.as('subtotal'),
        sql<number>`cast(coalesce(s.discount, 0) as numeric)`.as('discount'),
        's.payment_type as paymentMethod',
        's.payment_channel as paymentChannel',
        's.created_at as createdAt',
        's.packaging_breakdown as packagingBreakdown',
        's.delivery_proof_photo as deliveryProofPhoto',
        's.customer_id as customerId',
        'c.name as customerName',
        'c.phone as customerPhone',
        sql<string | null>`null`.as('customerCode'),
        'c.address as customerAddress',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        sql<string>`coalesce(fv.plate_number, dr.vehicle_plate, '')`.as('vehiclePlate'),
        'vt.id as tripId',
      ])
      .where('s.tenant_id', '=', tenantId)
      .where((eb: any) =>
        eb.or([
          eb('s.delivery_rep_id', '=', repId),
          eb('vt.rep_id', '=', repId),
        ]),
      );

    if (filters?.customerId) {
      query = query.where('s.customer_id', '=', filters.customerId);
    }

    if (filters?.paymentMethod && filters.paymentMethod !== 'all') {
      query = query.where('s.payment_type', '=', filters.paymentMethod);
    }

    if (filters?.tripId) {
      query = query.where('s.van_trip_id', '=', filters.tripId);
    }

    if (filters?.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      query = query.where((eb: any) =>
        eb.or([
          eb('s.doc_no', 'ilike', q),
          eb('c.name', 'ilike', q),
          eb('c.phone', 'ilike', q),
        ]),
      );
    }

    if (filters?.dateScope && filters.dateScope !== 'all') {
      const now = new Date();
      if (filters.dateScope === 'today') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        query = query.where('s.created_at', '>=', startOfToday);
      } else if (filters.dateScope === 'yesterday') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
        query = query.where('s.created_at', '>=', startOfYesterday).where('s.created_at', '<', startOfToday);
      } else if (filters.dateScope === 'week') {
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
        query = query.where('s.created_at', '>=', startOfWeek);
      }
    }

    const maxLimit = Math.min(Number(filters?.limit || 100), 200);
    const rows = await query.orderBy('s.id', 'desc').limit(maxLimit).execute();

    if (!rows.length) {
      return [];
    }

    const saleIds = rows.map((r: any) => Number(r.id));
    const items = await this.anyDb
      .selectFrom('sale_items as si')
      .select([
        'si.sale_id as saleId',
        'si.product_id as productId',
        'si.product_name as name',
        sql<number>`cast(si.qty as numeric)`.as('qty'),
        sql<number>`cast(si.unit_price as numeric)`.as('unitPrice'),
        sql<number>`cast(si.line_total as numeric)`.as('lineTotal'),
        sql<number>`cast(si.consumer_price as numeric)`.as('consumerPrice'),
        'si.pricing_tier_type as pricingTierType',
        sql<number>`cast(si.unit_offer_savings as numeric)`.as('unitOfferSavings'),
      ])
      .where('si.tenant_id', '=', tenantId)
      .where('si.sale_id', 'in', saleIds)
      .orderBy('si.id', 'asc')
      .execute();

    const itemsBySaleId = new Map<number, any[]>();
    for (const item of items) {
      const sId = Number(item.saleId);
      if (!itemsBySaleId.has(sId)) {
        itemsBySaleId.set(sId, []);
      }
      itemsBySaleId.get(sId)!.push({
        productId: Number(item.productId),
        name: item.name,
        qty: Number(item.qty),
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
        consumerPrice: item.consumerPrice != null ? Number(item.consumerPrice) : null,
        pricingTierType: item.pricingTierType || null,
        unitOfferSavings: item.unitOfferSavings != null ? Number(item.unitOfferSavings) : 0,
      });
    }

    return rows.map((r: any) => {
      let packagingBreakdown = null;
      if (r.packagingBreakdown) {
        try {
          packagingBreakdown = typeof r.packagingBreakdown === 'string'
            ? JSON.parse(r.packagingBreakdown)
            : r.packagingBreakdown;
        } catch {}
      }

      const saleItems = itemsBySaleId.get(Number(r.id)) || [];

      return {
        id: Number(r.id),
        docNo: r.docNo,
        total: Number(r.total),
        subtotal: Number(r.subtotal),
        discount: Number(r.discount),
        paymentMethod: r.paymentMethod || 'cash',
        createdAt: r.createdAt,
        packagingBreakdown,
        deliveryProofPhoto: r.deliveryProofPhoto || null,
        customerId: r.customerId ? Number(r.customerId) : null,
        customerName: r.customerName || 'عميل نقدي',
        customerPhone: r.customerPhone || null,
        customerCode: r.customerId ? normalizeCustomerCode(r.customerCode, r.customerId) : null,
        customerAddress: r.customerAddress || null,
        repName: r.repName || 'مندوب التوزيع',
        vehiclePlate: r.vehiclePlate || null,
        tripId: r.tripId ? Number(r.tripId) : null,
        itemsCount: saleItems.length,
        items: saleItems,
      };
    });
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

  async getFleetMaintenanceAlerts(tenantId: string, vehicleId?: number) {
    return this.vanFleetService.getFleetMaintenanceAlerts(tenantId, vehicleId);
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

  async getDriverWarehouses(tenantId: string) {
    return this.vanRequisitionsService.getDriverWarehouses(tenantId);
  }

  async getDriverAvailableProducts(tenantId: string, warehouseId?: number) {
    return this.vanRequisitionsService.getDriverAvailableProducts(tenantId, warehouseId);
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

    let totalPendingShortages = 0;
    let totalSettledShortages = 0;
    let totalWaivedShortages = 0;
    let totalPushedToPayroll = 0;
    let totalCommissions = 0;

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
      netBalance: number;
      itemsCount: number;
    }>();

    for (const it of items) {
      const amt = Number(it.amount || 0);
      const isShortage = ['cash_shortage', 'stock_shortage'].includes(it.entryType);
      const isBonus = ['commission', 'bonus'].includes(it.entryType);

      if (isShortage) {
        if (it.status === 'pending') totalPendingShortages += amt;
        else if (it.status === 'settled') totalSettledShortages += amt;
        else if (it.status === 'waived') totalWaivedShortages += amt;
        else if (it.status === 'pushed_to_payroll') totalPushedToPayroll += amt;
      } else if (isBonus) {
        totalCommissions += amt;
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
        repEntry.commissions += amt;
      }
      repEntry.netBalance = roundMoney(repEntry.commissions - repEntry.pendingShortages, moneyDigits);
    }

    return {
      items,
      summary: {
        totalPendingShortages: roundMoney(totalPendingShortages, moneyDigits),
        totalSettledShortages: roundMoney(totalSettledShortages, moneyDigits),
        totalWaivedShortages: roundMoney(totalWaivedShortages, moneyDigits),
        totalPushedToPayroll: roundMoney(totalPushedToPayroll, moneyDigits),
        totalCommissions: roundMoney(totalCommissions, moneyDigits),
        netRepBalance: roundMoney(totalCommissions - totalPendingShortages, moneyDigits),
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
   */
  async settleRepFinancialItem(
    tenantId: string,
    accountId: string,
    id: number,
    payload: {
      method: 'cash' | 'waiver';
      notes?: string;
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
            notes,
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
    });
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

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

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
          .select(['id', 'status', 'amount'])
          .where('id', '=', item.id)
          .where('tenant_id', '=', tenantId)
          .forUpdate()
          .executeTakeFirst();
        if (!lockedItem || lockedItem.status !== 'pending') {
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
          const candidateEmp = await trxAny
            .selectFrom('hr_employees')
            .select(['id', 'display_name'])
            .where('tenant_id', '=', tenantId)
            .where((eb: any) =>
              eb.or([
                item.repNationalId ? eb('national_id', '=', item.repNationalId) : eb('id', '=', -1),
                eb('display_name', 'ilike', `%${item.repName}%`),
              ])
            )
            .executeTakeFirst();

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

        const flipped = await trxAny
          .updateTable('van_rep_financial_settlements')
          .set({
            status: 'pushed_to_payroll',
            settlement_method: 'payroll',
            settled_at: sql`NOW()`,
            settled_by: actorUserId,
            notes: `${item.notes ? item.notes + ' | ' : ''}تم ترحيل العجز لمسير رواتب شهر ${targetMonth}${resolvedEmployeeId ? ` (موظف #${resolvedEmployeeId})` : ' (قيد انتظار ربط الموظف)'}`,
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

        // If resolvedEmployeeId is available, insert into hr_employee_adjustments for HR payroll integration
        if (resolvedEmployeeId) {
          const isShortage = ['cash_shortage', 'stock_shortage'].includes(item.entryType);
          const adjType = isShortage ? 'deduction' : 'allowance';
          const adjReason = isShortage
            ? `استقطاع عجز سيارة فان (حركة #${item.id} - ${item.notes || 'عجز مبيعات'})`
            : `صرف بونص/عمولة سيارة فان (حركة #${item.id} - ${item.notes || 'حافز مبيعات'})`;

          await trxAny
            .insertInto('hr_employee_adjustments')
            .values({
              tenant_id: tenantId,
              employee_id: resolvedEmployeeId,
              adjustment_type: adjType,
              amount_type: 'fixed',
              amount: Number(item.amount),
              date: sql`CURRENT_DATE`,
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
        }

        results.push({
          id: Number(item.id),
          repName: item.repName,
          amount: Number(item.amount),
          success: true,
          message: resolvedEmployeeId
            ? `تم الترحيل بنجاح لملف الموظف في مسير شهر ${targetMonth}`
            : `تم ترحيل البند كعجز معتمد لمسير رواتب شهر ${targetMonth}`,
        });
      }
    });

    return {
      ok: true,
      targetMonth,
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

