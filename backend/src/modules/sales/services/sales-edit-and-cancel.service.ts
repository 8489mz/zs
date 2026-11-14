/*
 * Sale edit + cancel (slice 3 of the sales-write split).
 * Pure move: updateSale, cancelSale, detectPreparedWasteSale and the two
 * closed-shift refresh helpers, plus the trip-counter top-level helpers
 * they use (lockOpenTripRow, applyTripCounterDelta), unchanged, behind
 * the SalesWriteService delegating facade. The facade owns the serials,
 * stock/pricing and restaurant helpers; this service receives them bound
 * via SalesEditAndCancelDeps, so the moved bodies are byte-identical to
 * the originals.
 *
 * Two deliberate deviations from byte-identical: refreshClosedShiftsForBackdatedOfflineSale
 * is public here (not private) because createSale still calls it through a
 * private facade forwarder; and the facade keeps importing
 * previewConsumableStockQty even though no method left in the facade calls
 * it, because check-architecture-guardrails.cjs requires that token in
 * sales-write.service.ts.
 */
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { Logger } from '@nestjs/common';
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { computeInvoiceTotals } from '../../../common/utils/invoice-totals';
import { ensureUniqueFlowItems } from '../../../common/utils/financial-integrity';
import { applyStockDelta, previewConsumableStockQty } from '../../../common/utils/location-stock-ledger';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { UpsertSaleDto } from '../dto/upsert-sale.dto';
import { normalizeSalePayload } from '../helpers/sales-payload.helper';
import { buildPreparedSaleItem, calculateAllowedSaleUnitPrice, calculateCollectibleTotal, calculateRemainingDebt, calculateRestoredStockQuantity, calculateStoreCreditBalance, computeSaleAllocationLegs, findBelowFloorSaleItems, paidAmountExceedsRecordedPayments, resolvePostedSalePaymentChannel, restoreFrozenSaleLineCosts, roundSaleInvoiceTotals, roundSaleResidual } from '../helpers/sales-write.helper';
import { allocateSaleTenders, shouldSuppressTenderFallback, type SaleTenderChannel } from '../engines/sale-tender.engine';
import { assertPosSubmitGates } from '../engines/pos-submit-gates.engine';
import { allocateInvoiceDiscount } from '../engines/invoice-discount.engine';
import { resolveSaleTaxRate } from '../engines/sale-tax-rate.engine';
import { resolveSaleServiceCharge } from '../engines/sale-service-charge.engine';
import { assertSaleNotZatcaSigned } from '../../tax-integration/services/zatca/zatca-invoice-status';
import { diffContributions, negateContribution, tripSaleContribution, type TripSaleContribution } from '../../delivery-reps/van-trip-counters.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { SalesAuthorizationService } from './sales-authorization.service';
import { SalesFinanceService } from './sales-finance.service';
import { formatCreditLimitExceededMessage } from './credit-limit-message';
import { SalesQueryService } from './sales-query.service';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import { CashDrawerService } from '../../cash-drawer/cash-drawer.service';
import { allocateSaleFromImportLots, restoreImportLotsFromCancelledSale } from '../../import-sales/helpers/import-lot-allocation.helper';

/**
 * Trip-counter maintenance for field (van) sales edited or cancelled
 * through the generic writer. The field flow maintains four counters
 * on van_sales_trips at creation time; the generic paths never did,
 * so an edit or a cancellation left settleTrip expecting cash the
 * books no longer showed. The lock is taken early (right after the
 * locked sale row is read, before any stock work — the same order
 * settleTrip uses) and held for the transaction; the counter delta
 * is applied once the replacement rows exist. A settled trip's
 * counters are history: they are never moved, in either method.
 */
async function lockOpenTripRow(
  trx: any,
  tenantId: string,
  tripId: number,
): Promise<boolean> {
  const trip = await trx
    .selectFrom('van_sales_trips')
    .select(['id', 'status'])
    .where('id', '=', tripId)
    .where('tenant_id', '=', tenantId)
    .forUpdate()
    .executeTakeFirst();
  return Boolean(trip) && trip.status !== 'settled';
}

async function applyTripCounterDelta(
  trx: any,
  tenantId: string,
  tripId: number,
  delta: TripSaleContribution,
): Promise<void> {
  if (!delta.salesAmount && !delta.cashCollected && !delta.creditSales && !delta.instapaySales) return;
  await trx
    .updateTable('van_sales_trips')
    .set({
      sales_amount: sql`sales_amount + ${delta.salesAmount}`,
      cash_collected: sql`cash_collected + ${delta.cashCollected}`,
      credit_sales: sql`credit_sales + ${delta.creditSales}`,
      total_instapay_sales: sql`total_instapay_sales + ${delta.instapaySales}`,
      updated_at: sql`NOW()`,
    })
    .where('id', '=', tripId)
    .where('tenant_id', '=', tenantId)
    .execute();
}

export type SalesEditAndCancelDeps = {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  authz: SalesAuthorizationService;
  finance: SalesFinanceService;
  query: SalesQueryService;
  accountingPosting: AccountingPostingService;
  planFeatureService: PlanFeatureService;
  cashDrawerService?: CashDrawerService;
  logger: Logger;
  assertDiscountChangeAllowed: (
    trx: Kysely<Database> | Transaction<Database>,
    auth: AuthContext,
    discount: number,
    managerPin?: string | null,
    subtotal?: number,
  ) => Promise<void>;
  assertUnitPriceChangeAllowed: (
    trx: Kysely<Database> | Transaction<Database>,
    auth: AuthContext,
    providedPrice: number,
    allowedPrice: number,
    productId: number,
    managerPin?: string,
    saleId?: number,
  ) => Promise<void>;
  getTenantSettingsMap: (
    trx: Kysely<Database> | Transaction<Database>,
    tenantId: string,
  ) => Promise<Map<string, any>>;
  claimSaleSerials: (
    trx: Kysely<Database>,
    item: { productId: number; requiredQty: number; serials?: unknown },
    saleId: number,
    saleItemId: number,
    tenantId: string,
  ) => Promise<string[]>;
  releaseSaleSerials: (
    trx: Kysely<Database>,
    saleId: number,
    tenantId: string,
  ) => Promise<void>;
  resolveSaleModifierCosts: (
    trx: Kysely<Database> | Transaction<Database>,
    items: any[],
    tenantId: string,
    restaurantEnabled: boolean,
    approvedModifierPrices?: Record<string, number>,
  ) => Promise<void>;
  loadFlatAddonCosts: (
    trx: Kysely<Database> | Transaction<Database>,
    tenantId: string,
    items: any[],
  ) => Promise<Map<number, number>>;
  enforceRestaurantModifierContract: (
    trx: Kysely<Database> | Transaction<Database>,
    items: any[],
    tenantId: string,
    restaurantEnabled: boolean,
    approvedModifierPrices?: Record<string, number>,
  ) => Promise<void>;
  autoProduceShortfall: (
    trx: Kysely<Database> | Transaction<Database>,
    items: { productId: number; requiredQty: number; availableQty: number; hasBOM?: boolean; bomId?: number; unitMultiplier?: number }[],
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    scope: { tenantId: string; accountId: string },
    auth: AuthContext,
    visitedProductIds?: Set<number>,
    depth?: number,
  ) => Promise<void>;
  deductPharmacyBatchesFefo: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    allocations: Array<{ locationId: number | null; qty: number }>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleItemId: number,
  ) => Promise<void>;
  restoreSalePharmacyBatches: (
    trx: Kysely<Database> | Transaction<Database>,
    saleId: number,
    items: Array<{ id: number; product_id: number | null }>,
    scope: { tenantId: string; accountId: string },
    removeAllocations: boolean,
  ) => Promise<void>;
  recordImportLotShortfalls: (
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleLineId: number,
    allocation: { items: Array<{ productId: number; requestedQty: number; allocatedQty: number; shortfallQty: number; fullyCovered: boolean; reason: string }> },
    auth: AuthContext,
  ) => Promise<void>;
  getAllowNegativeStockSales: (
    trx: Kysely<Database> | Transaction<Database>,
    tenantId: string,
  ) => Promise<boolean>;
  buildInsufficientStockError: (
    trx: Kysely<Database> | Transaction<Database>,
    params: {
      productId: number;
      productName: string;
      currentLocationId?: number | string | null;
      currentLocationName?: string;
      excludedLocationIds?: number[];
      currentAvailableQty: number;
      requiredQty: number;
      tenantId: string;
    },
  ) => Promise<AppError>;
  lockProductRow: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    scope: { tenantId: string; accountId: string },
  ) => Promise<void>;
  lockSaleStockRows: (
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    items: any[],
  ) => Promise<void>;
  getCurrentProductOffers: (
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    tenantId: string,
  ) => Promise<any[]>;
};

export class SalesEditAndCancelService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly authz: SalesAuthorizationService;
  private readonly finance: SalesFinanceService;
  private readonly query: SalesQueryService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly planFeatureService: PlanFeatureService;
  private readonly cashDrawerService?: CashDrawerService;
  private readonly logger: Logger;
  private readonly assertDiscountChangeAllowed: SalesEditAndCancelDeps['assertDiscountChangeAllowed'];
  private readonly assertUnitPriceChangeAllowed: SalesEditAndCancelDeps['assertUnitPriceChangeAllowed'];
  private readonly getTenantSettingsMap: SalesEditAndCancelDeps['getTenantSettingsMap'];
  private readonly claimSaleSerials: SalesEditAndCancelDeps['claimSaleSerials'];
  private readonly releaseSaleSerials: SalesEditAndCancelDeps['releaseSaleSerials'];
  private readonly resolveSaleModifierCosts: SalesEditAndCancelDeps['resolveSaleModifierCosts'];
  private readonly loadFlatAddonCosts: SalesEditAndCancelDeps['loadFlatAddonCosts'];
  private readonly enforceRestaurantModifierContract: SalesEditAndCancelDeps['enforceRestaurantModifierContract'];
  private readonly autoProduceShortfall: SalesEditAndCancelDeps['autoProduceShortfall'];
  private readonly deductPharmacyBatchesFefo: SalesEditAndCancelDeps['deductPharmacyBatchesFefo'];
  private readonly restoreSalePharmacyBatches: SalesEditAndCancelDeps['restoreSalePharmacyBatches'];
  private readonly recordImportLotShortfalls: SalesEditAndCancelDeps['recordImportLotShortfalls'];
  private readonly getAllowNegativeStockSales: SalesEditAndCancelDeps['getAllowNegativeStockSales'];
  private readonly buildInsufficientStockError: SalesEditAndCancelDeps['buildInsufficientStockError'];
  private readonly lockProductRow: SalesEditAndCancelDeps['lockProductRow'];
  private readonly lockSaleStockRows: SalesEditAndCancelDeps['lockSaleStockRows'];
  private readonly getCurrentProductOffers: SalesEditAndCancelDeps['getCurrentProductOffers'];

  constructor(deps: SalesEditAndCancelDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.authz = deps.authz;
    this.finance = deps.finance;
    this.query = deps.query;
    this.accountingPosting = deps.accountingPosting;
    this.planFeatureService = deps.planFeatureService;
    this.cashDrawerService = deps.cashDrawerService;
    this.logger = deps.logger;
    this.assertDiscountChangeAllowed = deps.assertDiscountChangeAllowed;
    this.assertUnitPriceChangeAllowed = deps.assertUnitPriceChangeAllowed;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
    this.claimSaleSerials = deps.claimSaleSerials;
    this.releaseSaleSerials = deps.releaseSaleSerials;
    this.resolveSaleModifierCosts = deps.resolveSaleModifierCosts;
    this.loadFlatAddonCosts = deps.loadFlatAddonCosts;
    this.enforceRestaurantModifierContract = deps.enforceRestaurantModifierContract;
    this.autoProduceShortfall = deps.autoProduceShortfall;
    this.deductPharmacyBatchesFefo = deps.deductPharmacyBatchesFefo;
    this.restoreSalePharmacyBatches = deps.restoreSalePharmacyBatches;
    this.recordImportLotShortfalls = deps.recordImportLotShortfalls;
    this.getAllowNegativeStockSales = deps.getAllowNegativeStockSales;
    this.buildInsufficientStockError = deps.buildInsufficientStockError;
    this.lockProductRow = deps.lockProductRow;
    this.lockSaleStockRows = deps.lockSaleStockRows;
    this.getCurrentProductOffers = deps.getCurrentProductOffers;
  }

  async updateSale(saleId: number, payload: UpsertSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const normalized = normalizeSalePayload(payload);
    const editReason = String((payload as unknown as { editReason?: string })?.editReason || '').trim();
    const managerPin = String((payload as unknown as { managerPin?: string })?.managerPin || '').trim();

    if (!normalized.items.length) throw new AppError('Sale must include at least one item', 'SALE_ITEMS_REQUIRED', 400);
    ensureUniqueFlowItems(normalized.items, 'SALE_DUPLICATE_PRODUCT', 'Sale must not contain duplicate product rows with the same unit and price');
    if (normalized.discount < 0) throw new AppError('Discount cannot be negative', 'INVALID_DISCOUNT', 400);
    if (!editReason) throw new AppError('سبب التعديل مطلوب.', 'SALE_EDIT_REASON_REQUIRED', 400);
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdmin && !managerPin) throw new AppError('رمز اعتماد المدير مطلوب قبل تعديل الفاتورة.', 'MANAGER_AUTH_REQUIRED', 400);
    if (!isAdmin || managerPin) await this.authz.authorizeDiscountOverride(managerPin, auth, this.db);

    let postCloseEdit = false;
    let postCloseShiftId: number | null = null;
    await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const sale = await trx
        .selectFrom('sales')
        .selectAll()
        .where('id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .forUpdate()
        .executeTakeFirst();
      if (!sale) throw new AppError('الفاتورة غير موجودة.', 'SALE_NOT_FOUND', 404);
      if (sale.exchange_return_id) throw new AppError('فاتورة استبدال مترابطة؛ استخدم مرتجعاً بدلاً من تعديلها', 'EXCHANGE_IMMUTABLE', 422);
      if (sale.status !== 'posted') throw new AppError('لا يمكن تعديل فاتورة غير مرحّلة أو ملغاة.', 'SALE_EDIT_STATUS_FORBIDDEN', 400);
      // A signed ZATCA invoice attests to these exact amounts and has
      // consumed an ICV; editing it would leave the attestation stale
      // and burn a second ICV on the replacement. Correct via credit note.
      assertSaleNotZatcaSigned((sale as any).zatca_status);

      // R4-C INV-REST-MODIFIER-CONTRACT-2: same pre-pass as createSale
      // — re-price modifiers from server truth and enforce group rules
      // before the stock lock, so an unverifiable modifier price fails
      // as 422 instead of the lock's 404 PRODUCT_NOT_FOUND.
      await this.enforceRestaurantModifierContract(
        trx, normalized.items, scope.tenantId,
        this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant'),
      );

      // A field sale's trip counters were raised at creation time and
      // must move with the edit. Lock the trip row now (before any
      // stock work, the order settleTrip uses); the delta itself is
      // applied below, once the replacement rows exist. A settled
      // trip's counters are history and stay untouched.
      const tripId = Number((sale as any).van_trip_id || 0) || null;
      const tripOpen = tripId ? await lockOpenTripRow(trx, scope.tenantId, tripId) : false;

      // A cashier shift is a historical cash accountability period. A sale
      // belonging to a closed shift cannot be edited in place: doing so would
      // retroactively change that shift's computed totals and cash exposure.
      const shiftBase = trx.selectFrom('cashier_shifts')
        .select(['id', 'opened_by', 'status'])
        .where('tenant_id', '=', scope.tenantId)
        .where('opened_by', '=', Number(sale.created_by || 0))
        .where('created_at', '<=', sale.created_at)
        .where((eb) => eb.or([eb('closed_at', 'is', null), eb('closed_at', '>=', sale.created_at)]));
      const originalShift = await (sale.branch_id == null
        ? shiftBase.where('branch_id', 'is', null)
        : shiftBase.where('branch_id', '=', sale.branch_id))
        .orderBy('id', 'desc').forUpdate().executeTakeFirst();
      // INV-SPIRIT-POST-CLOSE-EDIT: editing after the original shift closed
      // (closed or pending_review) is allowed with manager PIN/password +
      // reason, and is recorded as post-close below; the closed shift's
      // stored figures are then refreshed (recompute + stamp, see
      // refreshClosedShiftForPostCloseChange) while the posted variance
      // journal is never restated. An OPEN shift belonging to another
      // cashier still blocks the edit, and a missing original shift for
      // a POS sale still blocks it (fail closed).
      postCloseEdit = originalShift ? String(originalShift.status || '') !== 'open' : false;
      postCloseShiftId = postCloseEdit && originalShift ? Number(originalShift.id) : null;
      if (postCloseEdit) {
        if (!managerPin) throw new AppError('رمز اعتماد المدير مطلوب قبل تعديل فاتورة بعد إغلاق ورديتها.', 'MANAGER_AUTH_REQUIRED', 400);
        await this.authz.authorizeDiscountOverride(managerPin, auth, trx);
      }
      if (originalShift && !postCloseEdit && Number(originalShift.opened_by) !== auth.userId) {
        throw new AppError(
          'لا يمكن تعديل فاتورة تخص وردية مقفولة أو وردية كاشير آخر؛ استخدم مستند مرتجع أو تسوية',
          'SALE_EDIT_ORIGINAL_SHIFT_LOCKED', 422,
        );
      }
      if (normalized.source === 'pos' && !originalShift) {
        throw new AppError('لا يمكن تعديل فاتورة كاشير خارج ورديتها الأصلية؛ استخدم مرتجعاً أو تسوية', 'SALE_EDIT_ORIGINAL_SHIFT_MISSING', 422);
      }
      // A later receipt is an independent GL event and must remain attached to
      // the original debt. This edit route reverses the entire old invoice and
      // must not silently leave that receipt allocated against its replacement.
      const laterAllocation = await trx.selectFrom('payment_allocations')
        .select('id').where('tenant_id', '=', scope.tenantId)
        .where('invoice_type', '=', 'sale').where('invoice_id', '=', saleId)
        .limit(1).executeTakeFirst();
      if (laterAllocation) {
        throw new AppError('الفاتورة عليها سند قبض مخصص؛ يلزم مستند تصحيح بدلاً من تعديلها', 'SALE_EDIT_HAS_LATER_PAYMENTS', 422);
      }

      let branch: any = null;
      if (normalized.source === 'pos') {
        if (!normalized.branchId) {
          throw new AppError('يجب تحديد الفرع لعمليات البيع عبر الكاشير.', 'POS_BRANCH_REQUIRED', 400);
        }
        branch = await trx
          .selectFrom('branches')
          .select(['id', 'name', 'default_stock_location_id', 'sales_stock_mode', 'allow_external_sales_stock'])
          .where('id', '=', normalized.branchId)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        const branchLabel = branch?.name ? `"${branch.name}"` : `#${normalized.branchId}`;

        if (!branch?.default_stock_location_id) {
          throw new AppError(
            `الفرع ${branchLabel} لا يملك مخزناً افتراضياً. يرجى الذهاب إلى الإعدادات > الفروع وتعيين مخزن افتراضي صحيح لهذا الفرع قبل البيع.`,
            'POS_DEFAULT_STOCK_REQUIRED',
            400,
          );
        }

        // Verify the assigned default stock location actually exists and is active
        const defaultLocation = await trx
          .selectFrom('stock_locations')
          .select(['id', 'name', 'is_active', 'location_type', 'branch_id'])
          .where('id', '=', branch.default_stock_location_id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        if (!defaultLocation) {
          throw new AppError(
            `المخزن الافتراضي المرتبط بالفرع ${branchLabel} تم حذفه أو لا يوجد. يرجى الذهاب إلى الإعدادات > الفروع وتعيين مخزن افتراضي صحيح.`,
            'POS_DEFAULT_STOCK_DELETED',
            400,
          );
        }

        if (!defaultLocation.is_active) {
          const locationLabel = defaultLocation.name ? `"${defaultLocation.name}"` : `#${defaultLocation.id}`;
          throw new AppError(
            `المخزن الافتراضي ${locationLabel} للفرع ${branchLabel} معطّل. يرجى تفعيل المخزن أو تغيير المخزن الافتراضي من الإعدادات > الفروع.`,
            'POS_DEFAULT_STOCK_INACTIVE',
            400,
          );
        }

        if (['damaged', 'in_transit', 'quarantine'].includes(defaultLocation.location_type || '')) {
          throw new AppError('المخزن الافتراضي لا يجوز أن يكون مخزن تالف أو بضاعة بالطريق أو حجر صحي',
            'POS_DEFAULT_LOCATION_NOT_SELLABLE', 409);
        }
        if (defaultLocation.branch_id != null && Number(defaultLocation.branch_id) !== Number(normalized.branchId)) {
          throw new AppError('المخزن الافتراضي يتبع فرعاً آخر', 'POS_DEFAULT_LOCATION_BRANCH_MISMATCH', 409);
        }
        normalized.locationId = branch.default_stock_location_id;
      }

      // Validate an explicitly selected sale warehouse too: the default branch
      // guard alone does not protect manually entered or edited invoices.
      if (normalized.locationId) {
        const selectedLocation = await trx.selectFrom('stock_locations')
          .select(['id', 'is_active', 'location_type'])
          .where('id', '=', normalized.locationId)
          .where('tenant_id', '=', scope.tenantId)
          .where('account_id', '=', scope.accountId)
          .executeTakeFirst();
        if (!selectedLocation || !selectedLocation.is_active) {
          throw new AppError('مخزن البيع غير موجود أو غير نشط', 'SALE_LOCATION_UNAVAILABLE', 409);
        }
        if (['damaged', 'in_transit', 'quarantine'].includes(selectedLocation.location_type || '')) {
          throw new AppError('لا يمكن بيع المخزون التالف أو البضاعة بالطريق أو المحجوز صحياً', 'SALE_LOCATION_NOT_SELLABLE', 409);
        }
      }

      let eligibleLocations = [{ id: normalized.locationId, branchId: normalized.branchId }];
      if (normalized.source === 'pos' && branch?.sales_stock_mode === 'all_operational_locations') {
        const allLocs = await trx.selectFrom('stock_locations')
          .select(['id', 'location_type', 'branch_id'])
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true)
          .where('location_type', 'not in', ['damaged', 'in_transit', 'quarantine'])
          .execute();
          
        const defaultLocId = branch.default_stock_location_id;
        
        const sortedLocs = allLocs.filter(l => {
           if (l.id === defaultLocId) return true;
           if (l.branch_id === normalized.branchId) return true;
           if (l.location_type === 'internal_warehouse' && l.branch_id === null) return true;
           if (branch.allow_external_sales_stock && l.location_type === 'external_warehouse') return true;
           return false;
        }).sort((a, b) => {
           if (a.id === defaultLocId) return -1;
           if (b.id === defaultLocId) return 1;
           if (a.branch_id === normalized.branchId && b.branch_id !== normalized.branchId) return -1;
           if (a.branch_id !== normalized.branchId && b.branch_id === normalized.branchId) return 1;
           if (a.location_type === 'internal_warehouse' && b.location_type !== 'internal_warehouse') return -1;
           if (a.location_type !== 'internal_warehouse' && b.location_type === 'internal_warehouse') return 1;
           return 0;
        });
        
        eligibleLocations = sortedLocs.map(l => ({ id: l.id, branchId: l.branch_id }));
      }

      const existingReturns = await trx
        .selectFrom('return_documents')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('return_type', '=', 'sale')
        .where('invoice_id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (Number(existingReturns?.count || 0) > 0) {
        throw new AppError('لا يمكن تعديل هذه الفاتورة بعد إلغائها أو وجود عمليات مرتبطة تمنع التعديل.', 'SALE_EDIT_LINKED_OPERATIONS_FORBIDDEN', 400);
      }

      const existingEditedJournal = await trx
        .selectFrom('journal_entries')
        .select(['id'])
        .where('source_type', '=', 'sale_edit')
        .where('source_id', '=', saleId)
        .where('status', 'in', ['draft', 'posted'])
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (existingEditedJournal) {
        throw new AppError('تم تعديل هذه الفاتورة سابقًا. أنشئ فاتورة جديدة بدلًا من إعادة التعديل.', 'SALE_EDIT_ALREADY_APPLIED', 400);
      }

      const currentItems = await trx
        .selectFrom('sale_items')
        .selectAll()
        .where('sale_id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      const currentPayments = await trx
        .selectFrom('sale_payments')
        .select(['amount', 'payment_channel'])
        .where('sale_id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      if (currentPayments.length > 0 &&
          paidAmountExceedsRecordedPayments(currentPayments, sale.paid_amount, moneyDigits)) {
        throw new AppError('الفاتورة عليها تحصيلات إضافية لا يمكن عكسها بتعديل الفاتورة', 'SALE_EDIT_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }
      if (currentPayments.length === 0 && Number(sale.paid_amount || 0) > 0 && sale.payment_channel === 'mixed') {
        throw new AppError('لا يمكن تعديل فاتورة قديمة ذات سداد مختلط دون تفاصيل وسائل الدفع', 'SALE_EDIT_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }

      await this.lockSaleStockRows(trx, scope, [...currentItems, ...(payload.items || [])]);
      await this.restoreSalePharmacyBatches(trx, saleId, currentItems, scope, true);
      // The old and replacement customers may differ. Lock both in ascending ID order
      // after product locks, before reversing the old receivable or testing the new limit.
      for (const customerId of [...new Set([Number(sale.customer_id || 0), Number(normalized.customerId || 0)])]
        .filter((id) => id > 0).sort((a, b) => a - b)) {
        await trx.selectFrom('customers').select('id')
          .where('id', '=', customerId).where('tenant_id', '=', scope.tenantId)
          .forUpdate().executeTakeFirst();
      }
      // INV-SALE-EDIT-PREPARED-WASTE: a served dine-in/takeaway/delivery
      // sale is prepared waste (the same detection cancelSale uses). Its
      // consumed allocations are not resurrected: restoration is capped
      // at the edited lines' new consumption, so kept quantities net to
      // zero and only reduced/removed quantities stay consumed. Retail
      // sales (predicate false) restore exactly as before.
      const isPreparedWaste = await this.detectPreparedWasteSale(trx, sale, scope.tenantId);
      const wasteConsumptionByProduct = new Map<number, number>();
      const wasteRestoredByProduct = new Map<number, number>();
      const restoredBaseBySaleItemId = new Map<number, number>();
      if (isPreparedWaste) {
        const restaurantOn = await this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant');
        const optionIds = new Set<number>();
        for (const payloadItem of normalized.items || []) {
          for (const mod of payloadItem.modifiers || []) {
            if (mod?.optionId) optionIds.add(Number(mod.optionId));
          }
        }
        const modifierOptions = new Map<number, { componentProductId: number; consumptionQty: number }>();
        if (restaurantOn && optionIds.size > 0) {
          const optionRows = await trx.selectFrom('pos_modifier_options').selectAll()
            .where('tenant_id', '=', scope.tenantId).where('id', 'in', [...optionIds]).execute();
          for (const optionRow of optionRows) {
            modifierOptions.set(Number(optionRow.id), {
              componentProductId: Number(optionRow.component_product_id || 0),
              consumptionQty: Number(optionRow.consumption_qty || 1),
            });
          }
        }
        const addWasteConsumption = (productId: number, qty: number): void => {
          if (!productId || !(qty > 0)) return;
          wasteConsumptionByProduct.set(productId, Number((Number(wasteConsumptionByProduct.get(productId) || 0) + qty).toFixed(3)));
        };
        for (const payloadItem of normalized.items || []) {
          const itemQty = Number(payloadItem.qty || 0);
          const itemMultiplier = Number(payloadItem.unitMultiplier || 1);
          addWasteConsumption(Number(payloadItem.productId), Number((itemQty * itemMultiplier).toFixed(3)));
          if (!restaurantOn) continue;
          for (const mod of payloadItem.modifiers || []) {
            const option = mod?.optionId ? modifierOptions.get(Number(mod.optionId)) : undefined;
            const componentId = option ? option.componentProductId : Number(mod?.productId || mod?.componentProductId || 0);
            const consumption = option ? option.consumptionQty : Number(mod?.consumptionQty || mod?.consumption_qty || 1);
            addWasteConsumption(componentId, Number((Number(mod?.qty || 1) * itemQty * consumption).toFixed(3)));
          }
        }
      }
      for (const item of [...currentItems].sort((a, b) => Number(a.product_id || 0) - Number(b.product_id || 0))) {
        if (!item.product_id) continue;
        const restoreQty = Number((Number(item.qty || 0) * Number(item.unit_multiplier || 1)).toFixed(3));

        const allocations = await trx.selectFrom('sale_line_stock_allocations')
           .selectAll()
           .where('sale_line_id', '=', item.id)
           .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
           .execute();

        if (allocations.length > 0) {
           let remainingToRestore = restoreQty;
           for (const alloc of allocations) {
             const isParentProduct = Number(alloc.product_id) === Number(item.product_id);
             if (isParentProduct && remainingToRestore <= 0) continue;
             const allocQty = Number(alloc.quantity || 0);
             let qtyToRestore = isParentProduct ? Math.min(allocQty, remainingToRestore) : allocQty;
             if (isPreparedWaste) {
               const productKey = Number(alloc.product_id);
               const remainingBudget = Math.max(0, Number((Number(wasteConsumptionByProduct.get(productKey) || 0) - Number(wasteRestoredByProduct.get(productKey) || 0)).toFixed(3)));
               qtyToRestore = Math.min(qtyToRestore, remainingBudget);
               if (qtyToRestore > 0) {
                 wasteRestoredByProduct.set(productKey, Number((Number(wasteRestoredByProduct.get(productKey) || 0) + qtyToRestore).toFixed(3)));
                 if (isParentProduct) {
                   restoredBaseBySaleItemId.set(Number(item.id), Number((Number(restoredBaseBySaleItemId.get(Number(item.id)) || 0) + qtyToRestore).toFixed(3)));
                 }
               }
             }
             if (qtyToRestore <= 0) continue;
             if (isParentProduct) {
               remainingToRestore -= qtyToRestore;
             }

             // Find branch for this location
             const locData = await trx.selectFrom('stock_locations').select('branch_id')
               .where('id', '=', alloc.location_id).where('tenant_id', '=', scope.tenantId)
               .executeTakeFirst();
             if (!locData) throw new AppError('مخزن سطر الفاتورة الأصلي غير موجود؛ يجب تسوية المخزون قبل التعديل', 'SALE_EDIT_LOCATION_RECONCILIATION_REQUIRED', 409);
             const branchId = locData.branch_id ?? sale.branch_id;

             const stockChange = await applyStockDelta(trx, {
               productId: Number(alloc.product_id),
               delta: qtyToRestore,
               branchId: branchId,
               locationId: alloc.location_id,
               tenantId: scope.tenantId,
               accountId: scope.accountId,
             });

             await trx.insertInto('stock_movements').values({
               product_id: Number(alloc.product_id),
               movement_type: 'sale_edit_reversal',
               qty: qtyToRestore,
               before_qty: stockChange.scopeBefore,
               after_qty: stockChange.scopeAfter,
               reason: 'sale_edit_reversal',
               note: `Edit reversal S-${saleId}`,
               reference_type: 'sale',
               reference_id: saleId,
               branch_id: branchId,
               location_id: alloc.location_id,
               created_by: auth.userId,
               tenant_id: scope.tenantId,
               account_id: scope.accountId,
             }).execute();
           }
           // Prepared waste: the un-restored remainder is consumed food,
           // not a reconciliation gap, so the completeness throw is
           // skipped exactly for waste sales.
           if (remainingToRestore > 0.0001 && !isPreparedWaste) {
             throw new AppError('توزيع مخزون سطر البيع الأصلي غير مكتمل؛ لا يمكن تعديل الفاتورة دون تسوية', 'SALE_EDIT_STOCK_ALLOCATION_RECONCILIATION_REQUIRED', 409);
           }
        } else {
           // Fallback for legacy sales without allocations. For prepared
           // waste the fallback is capped at the same new-consumption
           // budget, so a removed legacy line stays consumed.
           const fallbackRestoreQty = isPreparedWaste
             ? Math.min(restoreQty, Math.max(0, Number((Number(wasteConsumptionByProduct.get(Number(item.product_id)) || 0) - Number(wasteRestoredByProduct.get(Number(item.product_id)) || 0)).toFixed(3))))
             : restoreQty;
           if (fallbackRestoreQty > 0) {
             const stockChange = await applyStockDelta(trx, {
               productId: Number(item.product_id),
               delta: fallbackRestoreQty,
               branchId: sale.branch_id,
               locationId: sale.location_id,
               tenantId: scope.tenantId,
               accountId: scope.accountId,
             });
             await trx.insertInto('stock_movements').values({
               product_id: item.product_id,
               movement_type: 'sale_edit_reversal',
               qty: fallbackRestoreQty,
               before_qty: stockChange.scopeBefore,
               after_qty: stockChange.scopeAfter,
               reason: 'sale_edit_reversal',
               note: `Edit reversal S-${saleId}`,
               reference_type: 'sale',
               reference_id: saleId,
               branch_id: sale.branch_id,
               location_id: sale.location_id,
               created_by: auth.userId,
               tenant_id: scope.tenantId,
               account_id: scope.accountId,
             }).execute();
             if (isPreparedWaste) {
               wasteRestoredByProduct.set(Number(item.product_id), Number((Number(wasteRestoredByProduct.get(Number(item.product_id)) || 0) + fallbackRestoreQty).toFixed(3)));
               restoredBaseBySaleItemId.set(Number(item.id), Number((Number(restoredBaseBySaleItemId.get(Number(item.id)) || 0) + fallbackRestoreQty).toFixed(3)));
             }
           }
        }
      }

      // INV-SALE-EDIT-PREPARED-WASTE: snapshot the old lines and the
      // restored sold quantity per line so postSaleEdit can exclude the
      // consumed portion's residual COGS from the reversal, exactly as
      // cancelSale excludes it in full. Kept lines restore fully, so
      // their exclusion is zero.
      const preparedWasteEdit = isPreparedWaste ? {
        oldItems: currentItems.map((oldItem) => ({
          id: Number(oldItem.id),
          product_id: Number(oldItem.product_id || 0),
          qty: Number(oldItem.qty || 0),
          cost_price: Number(oldItem.cost_price || 0),
          unit_multiplier: Number(oldItem.unit_multiplier || 1),
          modifiers: oldItem.modifiers ?? null,
        })),
        restoredQtyBySaleItemId: new Map<number, number>(
          [...restoredBaseBySaleItemId.entries()].map(([saleItemId, baseQty]) => {
            const oldItem = currentItems.find((candidate) => Number(candidate.id) === saleItemId);
            const multiplier = Number(oldItem?.unit_multiplier || 1) || 1;
            return [saleItemId, Number((baseQty / multiplier).toFixed(3))] as [number, number];
          }),
        ),
      } : undefined;

      const oldCollectibleTotal = Math.max(0, Number(sale.total || 0) - Number(sale.store_credit_used || 0));
      const oldPaid = currentPayments.length
        ? currentPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        : Number(sale.paid_amount || 0);
      const oldDebt = calculateRemainingDebt(oldCollectibleTotal, oldPaid, moneyDigits);
      if (sale.customer_id && oldDebt > 0) {
        await this.finance.createCustomerLedgerEntry(trx, sale.customer_id, -oldDebt, `عكس تعديل فاتورة بيع S-${saleId}`, saleId, auth);
      }
      for (const payment of currentPayments) {
        if (payment.payment_channel !== 'cash') continue;
        await this.finance.addTreasuryTransaction(trx, -Number(payment.amount || 0), `عكس تعديل فاتورة بيع S-${saleId}`, saleId, auth, sale.branch_id, sale.location_id);
      }

      if (Number(sale.store_credit_used || 0) > 0 && sale.customer_id) {
        const customerBefore = await trx
          .selectFrom('customers')
          .select(['store_credit_balance'])
          .where('id', '=', sale.customer_id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();
        if (customerBefore) {
          await trx.updateTable('customers').set({
            store_credit_balance: calculateStoreCreditBalance(Number(customerBefore.store_credit_balance || 0), Number(sale.store_credit_used || 0), moneyDigits),
            updated_at: sql`NOW()`,
          }).where('id', '=', sale.customer_id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
        }
      }

      // Reconcile Customer Loyalty Points on Edit (ZS-078)
      if (sale.customer_id) {
        const customerId = Number(sale.customer_id);

        const earnLog = await trx
          .selectFrom('customer_loyalty_logs')
          .select(['points_change'])
          .where('sale_id', '=', saleId)
          .where('action_type', '=', 'earn')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        if (earnLog && Number(earnLog.points_change) > 0) {
          const earnedPoints = Number(earnLog.points_change);
          const previousClawbacks = await trx
            .selectFrom('customer_loyalty_logs')
            .select(sql<number>`COALESCE(SUM(ABS(points_change)), 0)`.as('total_clawed'))
            .where('sale_id', '=', saleId)
            .where('action_type', 'in', ['return_clawback', 'cancel_clawback', 'edit_clawback'])
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
          const alreadyClawed = Number(previousClawbacks?.total_clawed || 0);
          const clawbackDelta = Math.max(0, earnedPoints - alreadyClawed);

          if (clawbackDelta > 0) {
            const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
            const currentBal = Number(cust?.loyalty_points || 0);
            const balanceAfter = Math.max(0, Number((currentBal - clawbackDelta).toFixed(2)));

            await trx
              .updateTable('customers')
              .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
              .where('id', '=', customerId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();

            await trx
              .insertInto('customer_loyalty_logs')
              .values({
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
                customer_id: customerId,
                points_change: -clawbackDelta,
                balance_after: balanceAfter,
                action_type: 'edit_clawback',
                sale_id: saleId,
                notes: `عكس ${clawbackDelta} نقطة ولاء مكتسبة بسبب تعديل الفاتورة S-${saleId}`,
                created_at: sql`NOW()`,
              } as any)
              .execute();
          }
        }

        const redeemLog = await trx
          .selectFrom('customer_loyalty_logs')
          .select(['points_change'])
          .where('sale_id', '=', saleId)
          .where('action_type', '=', 'redeem')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        if (redeemLog && Number(redeemLog.points_change) < 0) {
          const totalRedeemed = Math.abs(Number(redeemLog.points_change));
          const previousRefunds = await trx
            .selectFrom('customer_loyalty_logs')
            .select(sql<number>`COALESCE(SUM(points_change), 0)`.as('total_refunded'))
            .where('sale_id', '=', saleId)
            .where('action_type', 'in', ['return_refund', 'cancel_refund', 'edit_refund'])
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
          const alreadyRefunded = Number(previousRefunds?.total_refunded || 0);
          const refundDelta = Math.max(0, totalRedeemed - alreadyRefunded);

          if (refundDelta > 0) {
            const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
            const currentBal = Number(cust?.loyalty_points || 0);
            const balanceAfter = Number((currentBal + refundDelta).toFixed(2));

            await trx
              .updateTable('customers')
              .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
              .where('id', '=', customerId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();

            await trx
              .insertInto('customer_loyalty_logs')
              .values({
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
                customer_id: customerId,
                points_change: refundDelta,
                balance_after: balanceAfter,
                action_type: 'edit_refund',
                sale_id: saleId,
                notes: `رد ${refundDelta} نقطة ولاء مستبدلة سابقاً بسبب تعديل الفاتورة S-${saleId}`,
                created_at: sql`NOW()`,
              } as any)
              .execute();
          }
        }
      }

      // NOTE (Risk #1 / Risk #2): do NOT reverse the sale journal here.
      // postSaleEdit() at the end of this transaction is the sole reverser:
      // it reverses the latest active journal and posts the new sale_edit
      // journal atomically in this same transaction. An explicit reversal
      // here would leave zero active journals, and postSaleEdit() would
      // then throw SALE_ALREADY_REVERSED (it cannot distinguish a reversal
      // made by this edit from one made by a cancellation, from counts alone).
      // The edit reason is still recorded by the audit log after commit.

      await trx.deleteFrom('sale_payments').where('sale_id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      await this.releaseSaleSerials(trx, saleId, scope.tenantId);
      await restoreImportLotsFromCancelledSale(trx, { tenantId: scope.tenantId, saleId });
      await trx.deleteFrom('sale_items').where('sale_id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();

      const customer = normalized.customerId
        ? await trx.selectFrom('customers').select(['id', 'name', 'balance', 'credit_limit', 'store_credit_balance', 'is_credit_blocked']).where('id', '=', normalized.customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).where('is_active', '=', true).forUpdate().executeTakeFirst()
        : null;
      if (normalized.customerId && !customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
      if (normalized.paymentType === 'credit' && !customer) throw new AppError('Credit sale requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
      const allowNegativeStockSales = await this.getAllowNegativeStockSales(trx, scope.tenantId);

      let subtotal = 0;
      const preparedItems = [];
      const autoProduceItems = [];
      for (const item of normalized.items) {
        if (Number(item.price || 0) <= 0) {
          throw new AppError('Sale item price must be greater than zero', 'INVALID_SALE_PRICE', 400);
        }
        const product = await trx.selectFrom('products as p')
          .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
          .select(['p.id', 'p.name', 'p.stock_qty', 'p.retail_price', 'p.wholesale_price', 'p.cost_price', 'p.min_selling_price', 'p.item_type', 'b.id as bom_id'])
          .where('p.id', '=', item.productId)
          .where(sql<boolean>`p.tenant_id = ${scope.tenantId}`)
          .where('p.is_active', '=', true)
          .executeTakeFirst();
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);
        
        const activeOffers = await this.getCurrentProductOffers(trx, item.productId, scope.tenantId);
        const allowedUnitPrice = calculateAllowedSaleUnitPrice({
          retailPrice: product.retail_price,
          wholesalePrice: product.wholesale_price,
          priceType: item.priceType,
          offers: activeOffers,
          qty: item.qty,
          unitMultiplier: item.unitMultiplier,
          moneyDigits,
        });
        await this.assertUnitPriceChangeAllowed(trx, auth, Number(item.price || 0), allowedUnitPrice, item.productId, normalized.managerPin, saleId);
        
        const availableStockQty = normalized.locationId
          ? await previewConsumableStockQty(trx, { productId: item.productId, branchId: normalized.branchId, locationId: normalized.locationId, tenantId: scope.tenantId, accountId: scope.accountId })
          : Number(product.stock_qty || 0);
          
        const hasBOM = !!product.bom_id;
        let finalProductName = product.name;

        if (hasBOM) {
          const bomLines = await trx.selectFrom('manufacturing_bom_lines as l')
            .innerJoin('products as p', 'p.id', 'l.component_product_id')
            .select('p.name')
            .where('l.bom_id', '=', Number(product.bom_id))
            .execute();
          
          if (bomLines.length > 0) {
            finalProductName = `${product.name} (${bomLines.map(l => l.name).join(' + ')})`;
          }
        }

        const requiredQty = Number((Number(item.qty || 0) * Number(item.unitMultiplier || 1)).toFixed(3));
        const canAllowNegative = allowNegativeStockSales || hasBOM || (product as any).item_type === 'service';
        if (!canAllowNegative && availableStockQty < requiredQty) {
          throw await this.buildInsufficientStockError(trx, {
            productId: item.productId,
            productName: finalProductName,
            currentLocationId: eligibleLocations.length === 1 ? eligibleLocations[0].id : null,
            currentLocationName: eligibleLocations.length > 1 ? 'المخازن المتاحة للفرع' : undefined,
            excludedLocationIds: eligibleLocations.map((l) => l.id).filter((id): id is number => id != null),
            currentAvailableQty: availableStockQty,
            requiredQty,
            tenantId: scope.tenantId,
          });
        }

        const preparedItem = buildPreparedSaleItem(
          { ...product, name: finalProductName, stock_qty: availableStockQty }, 
          item, 
          { allowNegativeStockSales: allowNegativeStockSales || hasBOM || (product as any).item_type === 'service', moneyDigits }
        );
        subtotal += preparedItem.lineTotal;
        preparedItems.push({
          ...preparedItem,
          isService: (product as any).item_type === 'service',
          // INV-SALE-EDIT-COST-FLOOR: carry the floor inputs on the
          // rebuilt line so the edit floor check below can use them.
          // The pre-approved override is the edit's own allowed
          // (retail/offer) price, as at creation for non-system-approved
          // sales; updateSale has no approved-terms channel.
          effectiveAllowedUnitPrice: allowedUnitPrice,
          minSellingPrice: Number((product as any).min_selling_price || 0),
        });
        
        if (hasBOM) {
          autoProduceItems.push({
            productId: item.productId,
            requiredQty: preparedItem.requiredQty,
            availableQty: availableStockQty,
            hasBOM: true,
            bomId: Number(product.bom_id),
            unitMultiplier: item.unitMultiplier,
          });
        }
      }

      // INV-CONVERSION-LINE-DISCOUNTS-PRESERVED: same gate inclusion as
      // createSale — per-line discounts count toward the gated amount.
      const editLineDiscountTotal = roundSaleResidual(normalized.items.reduce((sum, item) => sum + Number((item as { lineDiscount?: number }).lineDiscount || 0), 0), moneyDigits);
      await this.assertDiscountChangeAllowed(trx, auth, roundSaleResidual(normalized.discount + editLineDiscountTotal, moneyDigits), managerPin, subtotal);
      if (normalized.discount > subtotal) throw new AppError('Discount cannot exceed subtotal', 'INVALID_DISCOUNT', 400);
      // Tax F1 (same rule as createSale): an edit re-derives the tax
      // from the payload rate, so it must pass the same configured-or-0
      // gate before the replacement totals are computed — otherwise an
      // edit could rewrite a posted invoice's tax rate and history.
      const taxSettingsMap = await this.getTenantSettingsMap(trx, scope.tenantId);
      normalized.taxRate = resolveSaleTaxRate(
        normalized.taxRate,
        taxSettingsMap.get('taxRate') ?? taxSettingsMap.get('tax_rate'),
      );
      // R4-A (INV-REST-SALE-MONEY-TRUTH): same server recompute as
      // createSale — an edit re-derives the charge from the tenant
      // settings, so an edit cannot rewrite a posted invoice's
      // service charge from a tampered payload. The base here is
      // subtotal - normalized.discount (updateSale has no loyalty
      // path); the overwrite happens BEFORE computeInvoiceTotals.
      const recomputedEditServiceCharge = resolveSaleServiceCharge({
        orderType: normalized.orderType,
        source: normalized.source,
        enabled: taxSettingsMap.get('restaurantServiceChargeEnabled') ?? taxSettingsMap.get('restaurant_service_charge_enabled'),
        percent: taxSettingsMap.get('restaurantServiceChargePercent') ?? taxSettingsMap.get('restaurant_service_charge_rate'),
        netBase: subtotal - normalized.discount,
        digits: moneyDigits,
      });
      if (recomputedEditServiceCharge !== null) normalized.serviceCharge = recomputedEditServiceCharge;
      const { taxAmount, total } = roundSaleInvoiceTotals(
        computeInvoiceTotals(subtotal, normalized.discount, normalized.taxRate, normalized.pricesIncludeTax, normalized.deliveryFee, normalized.serviceCharge, Number((normalized as any).tipAmount || 0)),
        moneyDigits,
      );
      const { taxAmount: itemOnlyTaxAmount } = roundSaleInvoiceTotals(
        computeInvoiceTotals(subtotal, normalized.discount, normalized.taxRate, normalized.pricesIncludeTax, 0, 0, 0),
        moneyDigits,
      );
      const allocatedLines = allocateInvoiceDiscount({
        lines: preparedItems.map((item) => ({ lineTotal: item.lineTotal, qty: item.qty })),
        invoiceDiscount: normalized.discount, invoiceTax: itemOnlyTaxAmount, pricesIncludeTax: normalized.pricesIncludeTax, digits: moneyDigits,
      });
      const allocationByItem = new Map(preparedItems.map((item, index) => [item, allocatedLines[index]]));
      if (normalized.storeCreditUsed > total + 0.0001) throw new AppError('Store credit cannot exceed invoice total', 'INVALID_STORE_CREDIT', 400);
      const collectibleTotal = calculateCollectibleTotal(total, normalized.storeCreditUsed, moneyDigits);
      if (normalized.storeCreditUsed > 0) {
        if (!customer) throw new AppError('Store credit requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
        if (normalized.storeCreditUsed > Number(customer.store_credit_balance || 0) + 0.0001) throw new AppError('Store credit exceeds available balance', 'STORE_CREDIT_EXCEEDED', 400);
      }

      // INV-REST-COD-TENDER-TRUTH (R7-D): same suppression as
      // createSale — an edit of a COD sale with no legs must not
      // invent a cash leg either. The status comes from the raw
      // payload, falling back to the stored sale's collection_status
      // when the edit does not restate it (updateSale never rewrites
      // that column, and normalizeSalePayload never carries it).
      const editCollectionStatus = (payload as any).collectionStatus ?? (sale as any).collection_status ?? null;
      const suppressEditTenderFallback = shouldSuppressTenderFallback({
        orderType: normalized.orderType,
        collectionStatus: editCollectionStatus,
        paymentType: normalized.paymentType,
      });
      const tenderAllocation = allocateSaleTenders({
        paymentType: normalized.paymentType, payments: normalized.payments, collectibleTotal,
        fallbackChannel: (['card', 'wallet', 'instapay'].includes(normalized.paymentChannel) ? normalized.paymentChannel : 'cash') as SaleTenderChannel,
        tenderedCash: normalized.tenderedAmount, digits: moneyDigits,
        suppressFallback: suppressEditTenderFallback,
      });
      const payments = tenderAllocation.payments;
      const paidAmount = tenderAllocation.appliedAmount;
      if (normalized.source === 'pos' && !await this.authz.hasOpenCashierShift(trx, auth, normalized.branchId)) {
        throw new AppError('وردية كاشير مفتوحة مطلوبة لتعديل فاتورة نقطة البيع', 'OPEN_SHIFT_REQUIRED', 400);
      }
      // INV-REST-PAID-GATES-2 (R4-D, I28, D-R4D-1/D-R4D-4): same
      // POS-gated flip removal as createSale — the edit path had the
      // same silent reclassification. Today's callers send no source
      // (dashboard), so the helper returns early for them.
      const isPartialCredit = normalized.source !== 'pos' && Boolean(normalized.customerId) && paidAmount + 0.0001 < collectibleTotal;
      const effectivePaymentType = (isPartialCredit || normalized.paymentType === 'credit') ? 'credit' : 'cash';
      // INV-REST-COD-TENDER-TRUTH (R7-D): the edit path had NO COD
      // carve-out here at all — masked until now because the fallback
      // always filled paidAmount to the total. Mirror createSale's
      // isCodDelivery exactly (same status sources, same underpaid
      // disjunct): an underpaid delivery edit is a COD receivable,
      // not an INVALID_PAID_AMOUNT. A non-delivery underpaid edit
      // still throws, as before.
      const isCodDeliveryEdit = String(normalized.orderType || '').trim() === 'delivery' &&
        (editCollectionStatus === 'cod' || editCollectionStatus === 'pending' || paidAmount + 0.0001 < collectibleTotal);
      if (effectivePaymentType !== 'credit' && !isCodDeliveryEdit && paidAmount + 0.0001 < collectibleTotal) throw new AppError('Paid amount cannot be less than invoice total', 'INVALID_PAID_AMOUNT', 400);
      assertPosSubmitGates({
        source: normalized.source,
        customerId: normalized.customerId,
        paidAmount,
        collectibleTotal,
        total,
        orderType: normalized.orderType,
        collectionStatus: normalized.collectionStatus,
        tableNumber: normalized.tableNumber,
        cardAmount: payments.find((entry) => entry.paymentChannel === 'card')?.amount ?? 0,
        terminalApprovedAmount: normalized.terminalApprovedAmount,
        terminalAuthCode: normalized.terminalAuthCode,
        discount: normalized.discount,
        subtotal,
      });
      const newDebt = roundMoney(Math.max(0, collectibleTotal - paidAmount), moneyDigits);
      if (newDebt > 0) {
        if (!customer) throw new AppError('Credit sale requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
        if (Number(customer.balance || 0) + newDebt > Number(customer.credit_limit || 0) + 0.001
          && Number(customer.credit_limit || 0) > 0) {
          throw new AppError(
            formatCreditLimitExceededMessage({
              creditLimit: Number(customer.credit_limit || 0),
              currentBalance: Number(customer.balance || 0),
              requestedAmount: newDebt,
              digits: moneyDigits,
            }),
            'CUSTOMER_CREDIT_LIMIT',
            400,
          );
        }
        if (customer.is_credit_blocked) throw new AppError('Customer credit is blocked', 'CUSTOMER_CREDIT_BLOCKED', 400);
      }

      await trx.updateTable('sales').set({
        customer_id: normalized.customerId,
        customer_name: customer?.name || 'عميل نقدي',
        customer_phone: payload.customerPhone || null,
        customer_address: payload.customerAddress || null,
        payment_type: effectivePaymentType,
        payment_channel: resolvePostedSalePaymentChannel(effectivePaymentType, payments),
        subtotal: roundMoney(subtotal, moneyDigits),
        discount: normalized.discount,
        delivery_fee: normalized.deliveryFee,
        service_charge: normalized.serviceCharge || 0,
        tip_amount: Number((normalized as any).tipAmount || 0),
        tax_rate: normalized.taxRate,
        tax_amount: taxAmount,
        prices_include_tax: normalized.pricesIncludeTax,
        total,
        paid_amount: paidAmount,
        applied_amount: paidAmount,
        tendered_amount: tenderAllocation.tenderedAmount,
        change_amount: tenderAllocation.changeAmount,
        store_credit_used: normalized.storeCreditUsed,
        note: normalized.note,
        branch_id: normalized.branchId,
        location_id: normalized.locationId,
        updated_at: sql`NOW()`,
      } as any).where('id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();

      for (const payment of payments) {
        await trx.insertInto('sale_payments').values({ sale_id: saleId, payment_channel: payment.paymentChannel, amount: payment.amount, applied_amount: payment.amount, tendered_amount: payment.tenderedAmount, change_amount: payment.changeAmount, tenant_id: scope.tenantId, account_id: scope.accountId }).execute();
      }

      // The trip counters move with the edit: the old sale's
      // contribution is reversed and the replacement's applied, as one
      // delta, while the trip row is still locked by this transaction.
      if (tripOpen && tripId) {
        let oldLedgerCredit: number | null = null;
        if (String((sale as any).payment_channel || '').toLowerCase() === 'mixed') {
          const ledgerRow = await trx.selectFrom('customer_ledger').select('amount')
            .where('reference_type', '=', 'sale').where('reference_id', '=', saleId)
            .where('entry_type', '=', 'sale_credit').where('tenant_id', '=', scope.tenantId)
            .orderBy('id', 'desc').executeTakeFirst();
          oldLedgerCredit = ledgerRow ? Number((ledgerRow as any).amount || 0) : null;
        }
        const oldContribution = tripSaleContribution({
          total: (sale as any).total,
          paidAmount: (sale as any).paid_amount,
          paymentChannel: (sale as any).payment_channel,
          payments: currentPayments as any,
          ledgerCreditAmount: oldLedgerCredit ?? undefined,
        });
        const newContribution = tripSaleContribution({
          total,
          paidAmount,
          paymentChannel: resolvePostedSalePaymentChannel(effectivePaymentType, payments),
          payments: payments.map((payment: any) => ({ amount: payment.amount, payment_channel: payment.paymentChannel })),
        });
        await applyTripCounterDelta(trx, scope.tenantId, tripId, diffContributions(newContribution, oldContribution));
      }

      await this.lockSaleStockRows(trx, scope, preparedItems);
      await this.autoProduceShortfall(trx, autoProduceItems, saleId, normalized.branchId, normalized.locationId, scope, auth);
      await this.resolveSaleModifierCosts(trx, preparedItems, scope.tenantId,
        this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant'));

      // INV-SALE-EDIT-FROZEN-COST: resolveSaleModifierCosts just re-costed
      // every rebuilt line at the CURRENT product WAC. Restore the original
      // per-unit cost for lines whose physical composition (product, sold
      // unit, modifiers) is unchanged, so a price/discount/tax-only edit
      // cannot move COGS between periods. currentItems was loaded before
      // the old sale_items rows were deleted, so it still carries the
      // original costs; createSale has no old lines and is untouched.
      restoreFrozenSaleLineCosts(preparedItems, currentItems);

      // INV-SALE-EDIT-COST-FLOOR: creation refuses a net line below the
      // selling floor, but edits previously re-ran only the deviation
      // gate, so an admin could edit below cost with no PIN and a
      // manager approving the edit never saw a floor computation. Run
      // the same shared check here, AFTER the frozen-cost restore, so
      // the floor is computed on the cost that will actually be stored
      // and posted by postSaleEdit. The approval and the sale-note tag
      // mirror creation; the tag is written back to the sales row
      // updated above, inside this same transaction.
      const belowFloorProductIds = findBelowFloorSaleItems(preparedItems.map((item) => ({
        productId: item.productId,
        isService: item.isService,
        costPrice: item.costPrice,
        unitMultiplier: item.unitMultiplier,
        qty: item.qty,
        minSellingPrice: item.minSellingPrice,
        effectiveAllowedUnitPrice: item.effectiveAllowedUnitPrice,
        netLineTotal: allocationByItem.get(item)!.netLineTotal,
      })));
      // INV-POS-ADMIN-DISCOUNT-AUTHORITY: an admin edit below the floor
      // is not blocked; the lines are recorded in the note (no approver).
      const isAdminEditor = auth.role === 'admin' || auth.role === 'super_admin';
      const editFloorApproval = belowFloorProductIds.length && !isAdminEditor
        ? await this.authz.authorizeDiscountOverride(normalized.managerPin, auth, trx)
        : null;
      if (belowFloorProductIds.length) {
        const floorTag = editFloorApproval
          ? `[اعتماد بيع تحت الحد: ${editFloorApproval.authorizedByName}; أصناف ${belowFloorProductIds.join(',')}]`
          : `[بيع تحت الحد: أصناف ${belowFloorProductIds.join(',')}]`;
        const editNote = normalized.note ? `${normalized.note} | ${floorTag}` : floorTag;
        await trx.updateTable('sales').set({ note: editNote } as any)
          .where('id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      }

      // Deadlock prevention: identical canonical lock ordering as createSale (see note there).
      // R8-A INV-REST-FLAT-ADDON-COSTING: flat addons carry no stock —
      // the deduction loop below must skip them entirely (see createSale).
      const flatAddonCosts = await this.loadFlatAddonCosts(trx, scope.tenantId, preparedItems);
      const stockOrderedItems = [...preparedItems].sort((a, b) => Number(a.productId || 0) - Number(b.productId || 0));

      for (const item of stockOrderedItems) {
        const itemSerials = Array.isArray(item.serials) ? item.serials : [];
        const insertedLine = await trx.insertInto('sale_items').values({
          sale_id: saleId,
          product_id: item.productId,
          product_name: item.productName,
          qty: item.qty,
          unit_price: item.unitPrice,
          line_total: item.lineTotal,
          line_discount: Number(item.lineDiscount || 0),
          net_unit_price: allocationByItem.get(item)!.netUnitPrice,
          net_line_total: allocationByItem.get(item)!.netLineTotal,
          allocated_discount: allocationByItem.get(item)!.allocatedDiscount,
          allocated_tax: allocationByItem.get(item)!.allocatedTax,
          unit_name: item.unitName,
          unit_multiplier: item.unitMultiplier,
          cost_price: item.costPrice,
          price_type: item.priceType as 'retail' | 'wholesale',
          modifiers: item.modifiers ? JSON.stringify(item.modifiers) : '[]',
          serials: itemSerials.length > 0 ? JSON.stringify(itemSerials) : '[]',
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any).returning('id').executeTakeFirstOrThrow();
        const saleLineId = Number(insertedLine.id);

        const claimedSerials = await this.claimSaleSerials(trx, item, saleId, saleLineId, scope.tenantId);
        if (claimedSerials.length > 0) await trx.updateTable('sale_items')
          .set({ serials: JSON.stringify(claimedSerials) })
          .where('tenant_id', '=', scope.tenantId).where('id', '=', saleLineId).execute();

        if (item.isService) {
          continue;
        }

        let remainingQty = item.requiredQty;
        let allocationOrder = 1;
        const allocations = [];

        // Lock-order normalization: applyStockDelta (and therefore purchases, transfers and
        // production) always locks products BEFORE product_location_stock. Taking the location rows
        // first here would invert that order and deadlock against those flows (ABBA). Acquiring the
        // product row up front makes the global order products -> product_location_stock everywhere.
        await this.lockProductRow(trx, item.productId, scope);

        // INV-FLOATING-POOL-ALLOCATION-LEG: assigned locations first,
        // then the unassigned pool as the final leg (see
        // computeSaleAllocationLegs in sales-write.helper.ts). The pool
        // row is read only when the assigned legs leave a shortfall,
        // and never when an eligible leg already targets a null
        // location (that read already targets a null-location row).
        const locationAvailabilities: Array<{ locationId: number | null; branchId: number | null; availableQty: number }> = [];
        for (const loc of eligibleLocations) {
          const locStock = await trx.selectFrom('product_location_stock')
            .select(['qty', 'reserved_qty'])
            .where('product_id', '=', item.productId)
            .where('location_id', '=', loc.id)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .forUpdate()
            .executeTakeFirst();

          locationAvailabilities.push({
            locationId: loc.id,
            branchId: loc.branchId,
            availableQty: Math.max(0, Number(locStock?.qty || 0) - Number(locStock?.reserved_qty || 0)),
          });
        }
        let allocationLegs = computeSaleAllocationLegs({
          requiredQty: remainingQty,
          locationAvailabilities,
          poolAvailableQty: 0,
          saleLocationId: normalized.locationId,
          saleBranchId: normalized.branchId,
        });
        if (allocationLegs.remainingQty > 0 && !eligibleLocations.some((loc) => loc.id == null)) {
          const poolRow = await trx.selectFrom('product_location_stock')
            .select(['qty', 'reserved_qty'])
            .where('product_id', '=', item.productId)
            .where('location_id', 'is', null)
            .where('branch_id', 'is', null)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .forUpdate()
            .executeTakeFirst();
          allocationLegs = computeSaleAllocationLegs({
            requiredQty: remainingQty,
            locationAvailabilities,
            poolAvailableQty: Math.max(0, Number(poolRow?.qty || 0) - Number(poolRow?.reserved_qty || 0)),
            saleLocationId: normalized.locationId,
            saleBranchId: normalized.branchId,
          });
        }
        for (const leg of allocationLegs.legs) {
          allocations.push({ locationId: leg.locationId, branchId: leg.branchId, qty: leg.qty });
        }
        remainingQty = allocationLegs.remainingQty;

        if (remainingQty > 0) {
           if (!allowNegativeStockSales) {
              throw await this.buildInsufficientStockError(trx, {
                productId: item.productId,
                productName: item.productName,
                currentLocationId: eligibleLocations.length === 1 ? eligibleLocations[0].id : null,
                currentLocationName: eligibleLocations.length > 1 ? 'المخازن المتاحة للفرع' : undefined,
                excludedLocationIds: eligibleLocations.map((l) => l.id).filter((id): id is number => id != null),
                currentAvailableQty: allocationLegs.pooledAvailableQty,
                requiredQty: item.qty,
                tenantId: scope.tenantId,
              });
           }
           allocations.push({ locationId: normalized.locationId, branchId: normalized.branchId, qty: remainingQty });
           remainingQty = 0;
        }

        for (const alloc of allocations) {
          const stockChange = await applyStockDelta(trx, {
            productId: item.productId,
            delta: -alloc.qty,
            branchId: alloc.branchId,
            locationId: alloc.locationId,
            tenantId: scope.tenantId,
            accountId: scope.accountId,
            errorCode: 'INSUFFICIENT_STOCK',
            errorMessage: `Insufficient stock for ${item.productName}`,
            allowNegative: allowNegativeStockSales,
          });

          await trx.insertInto('stock_movements').values({
            product_id: item.productId,
            movement_type: 'sale_edit',
            qty: -alloc.qty,
            before_qty: stockChange.scopeBefore,
            after_qty: stockChange.scopeAfter,
            reason: 'sale_edit',
            note: `Sale edit S-${saleId}`,
            reference_type: 'sale',
            reference_id: saleId,
            branch_id: alloc.branchId,
            location_id: alloc.locationId,
            created_by: auth.userId,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }).execute();

          await trx.insertInto('sale_line_stock_allocations').values({
             tenant_id: scope.tenantId,
             account_id: scope.accountId,
             sale_id: saleId,
             sale_line_id: saleLineId,
             product_id: item.productId,
             location_id: alloc.locationId as number,
             quantity: alloc.qty,
             allocation_order: allocationOrder++,
          }).execute();
        }

        await this.deductPharmacyBatchesFefo(trx, item.productId, allocations, scope, saleId, saleLineId);
        for (const alloc of allocations) {
          const lotAllocation = await allocateSaleFromImportLots(trx, {
            tenantId: scope.tenantId,
            saleId: saleId,
            locationId: alloc.locationId ?? normalized.locationId,
            items: [{
              itemId: saleLineId,
              productId: item.productId,
              qty: alloc.qty,
              netUnitPrice: allocationByItem.get(item)!.netUnitPrice,
              locationId: alloc.locationId ?? normalized.locationId,
            }],
          });
          // INV-IMPORT-LOT-SHORTFALL-RECORD: never discard the coverage.
          await this.recordImportLotShortfalls(trx, scope, saleId, saleLineId, lotAllocation, auth);
        }

        if (item.modifiers && Array.isArray(item.modifiers) && this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant')) {
          for (const mod of item.modifiers) {
            // R8-A: flat addons have no stock to deduct (see createSale).
            const isFlatAddon = Number(mod.productId || 0) > 0
              && !Number(mod.optionId || mod.option_id || mod.id || 0)
              && flatAddonCosts.has(Number(mod.productId));
            if (mod.productId && !isFlatAddon) {
              const modifierQty = Number((Number(mod.qty || 1) * Number(item.qty || 1) * Number(mod.consumptionQty || 1)).toFixed(3));
              
              let modRemainingQty = modifierQty;
              let modAllocationOrder = 1;
              const modAllocations = [];

              // Same canonical lock order as the parent item (products -> product_location_stock).
              await this.lockProductRow(trx, Number(mod.productId), scope);

              // INV-FLOATING-POOL-ALLOCATION-LEG: same assigned-first,
              // pool-last leg computation as the parent item (see
              // computeSaleAllocationLegs in sales-write.helper.ts).
              const modLocationAvailabilities: Array<{ locationId: number | null; branchId: number | null; availableQty: number }> = [];
              for (const loc of eligibleLocations) {
                const locStock = await trx.selectFrom('product_location_stock')
                  .select(['qty', 'reserved_qty'])
                  .where('product_id', '=', Number(mod.productId))
                  .where('location_id', '=', loc.id)
                  .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
                  .forUpdate()
                  .executeTakeFirst();

                modLocationAvailabilities.push({
                  locationId: loc.id,
                  branchId: loc.branchId,
                  availableQty: Math.max(0, Number(locStock?.qty || 0) - Number(locStock?.reserved_qty || 0)),
                });
              }
              let modAllocationLegs = computeSaleAllocationLegs({
                requiredQty: modRemainingQty,
                locationAvailabilities: modLocationAvailabilities,
                poolAvailableQty: 0,
                saleLocationId: normalized.locationId,
                saleBranchId: normalized.branchId,
              });
              if (modAllocationLegs.remainingQty > 0 && !eligibleLocations.some((loc) => loc.id == null)) {
                const modPoolRow = await trx.selectFrom('product_location_stock')
                  .select(['qty', 'reserved_qty'])
                  .where('product_id', '=', Number(mod.productId))
                  .where('location_id', 'is', null)
                  .where('branch_id', 'is', null)
                  .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
                  .forUpdate()
                  .executeTakeFirst();
                modAllocationLegs = computeSaleAllocationLegs({
                  requiredQty: modRemainingQty,
                  locationAvailabilities: modLocationAvailabilities,
                  poolAvailableQty: Math.max(0, Number(modPoolRow?.qty || 0) - Number(modPoolRow?.reserved_qty || 0)),
                  saleLocationId: normalized.locationId,
                  saleBranchId: normalized.branchId,
                });
              }
              for (const leg of modAllocationLegs.legs) {
                modAllocations.push({ locationId: leg.locationId, branchId: leg.branchId, qty: leg.qty });
              }
              modRemainingQty = modAllocationLegs.remainingQty;

              if (modRemainingQty > 0) {
                 if (!allowNegativeStockSales) {
                    throw new AppError(`Insufficient stock for modifier ${mod.name}`, 'INSUFFICIENT_MODIFIER_STOCK', 400);
                 }
                 modAllocations.push({ locationId: normalized.locationId, branchId: normalized.branchId, qty: modRemainingQty });
                 modRemainingQty = 0;
              }

              for (const alloc of modAllocations) {
                const modStockChange = await applyStockDelta(trx, {
                  productId: Number(mod.productId),
                  delta: -alloc.qty,
                  branchId: alloc.branchId,
                  locationId: alloc.locationId,
                  tenantId: scope.tenantId,
                  accountId: scope.accountId,
                  errorCode: 'INSUFFICIENT_MODIFIER_STOCK',
                  errorMessage: `Insufficient stock for modifier ${mod.name}`,
                  allowNegative: allowNegativeStockSales,
                });

                await trx
                  .insertInto('stock_movements')
                  .values({
                    product_id: Number(mod.productId),
                    movement_type: 'sale_edit',
                    qty: -alloc.qty,
                    before_qty: modStockChange.scopeBefore,
                    after_qty: modStockChange.scopeAfter,
                    reason: 'sale_edit_modifier',
                    note: `Sale edit S-${saleId} (${item.productName})`,
                    reference_type: 'sale',
                    reference_id: saleId,
                    branch_id: alloc.branchId,
                    location_id: alloc.locationId,
                    created_by: auth.userId,
                    tenant_id: scope.tenantId,
                    account_id: scope.accountId,
                  } as any)
                  .execute();

                await trx.insertInto('sale_line_stock_allocations').values({
                   tenant_id: scope.tenantId,
                   account_id: scope.accountId,
                   sale_id: saleId,
                   sale_line_id: saleLineId,
                   product_id: Number(mod.productId),
                   location_id: alloc.locationId as number,
                   quantity: alloc.qty,
                   allocation_order: modAllocationOrder++,
                }).execute();
              }
            }
          }
        }
      }

      if (normalized.storeCreditUsed > 0 && customer) {
        await trx.updateTable('customers').set({
          store_credit_balance: calculateStoreCreditBalance(Number(customer.store_credit_balance || 0), -normalized.storeCreditUsed, moneyDigits),
          updated_at: sql`NOW()`,
        }).where('id', '=', customer.id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      }

      const remainingDebt = roundMoney(Math.max(0, collectibleTotal - paidAmount), moneyDigits);
      if (customer && remainingDebt > 0) {
        await this.finance.createCustomerLedgerEntry(
          trx,
          customer.id,
          remainingDebt,
          `تعديل فاتورة بيع S-${saleId}${paidAmount > 0 ? ' (متبقي آجل)' : ''}`,
          saleId,
          auth,
        );
      } else if (customer && remainingDebt === 0) {
        // INV-CUSTOMER-SUPPLIER-STATEMENTS: same fully-settled pair as
        // createSale above -- a settled edit must leave the invoice
        // visible in the statement instead of writing no row. Net zero,
        // so the balance is unchanged; 'sale_paid' keeps the
        // 'sale_credit' readers (van split sales, trip counters) from
        // mistaking this charge for a debt.
        const settled = roundMoney(collectibleTotal - remainingDebt, moneyDigits);
        if (settled > 0) {
          await this.finance.addCustomerLedgerLeg(trx, customer.id, settled, 'sale_paid', `تعديل فاتورة بيع S-${saleId}`, 'sale', saleId, auth);
          await this.finance.addCustomerPaymentLedgerEntry(trx, customer.id, -settled, `سداد تعديل فاتورة بيع S-${saleId}`, 'sale', saleId, auth, normalized.branchId, normalized.locationId);
        }
      }

      for (const payment of payments) {
        if (payment.paymentChannel !== 'cash') continue;
        await this.finance.addTreasuryTransaction(trx, payment.amount, `تعديل فاتورة بيع S-${saleId}`, saleId, auth, normalized.branchId, normalized.locationId);
      }

      if (postCloseEdit) {
        await trx.insertInto('pos_audit_events').values({
          tenant_id: scope.tenantId, account_id: scope.accountId, event_type: 'sale_edit_post_close',
          user_id: auth.userId, sale_id: saleId, product_id: null, amount: Number(sale.total || 0),
          reason: editReason, metadata: { postClose: true, originalShiftId: postCloseShiftId, managerApproved: true },
        }).execute();
      }

      await this.accountingPosting.postSaleEdit(trx, saleId, auth, editReason, preparedWasteEdit ? { preparedWaste: preparedWasteEdit } : undefined);

      if (postCloseEdit && postCloseShiftId) {
        await this.refreshClosedShiftForPostCloseChange(trx, postCloseShiftId, saleId, 'edit', editReason, auth);
      }
    });

    await this.audit.log('تعديل فاتورة بيع', `تم تعديل الفاتورة S-${saleId} بواسطة ${auth.username} | السبب: ${editReason}${postCloseEdit ? ` | تعديل بعد إغلاق الوردية الأصلية #${postCloseShiftId}` : ''}`, auth);
    const sale = await this.query.getSaleById(saleId, auth);
    return { ok: true, sale: sale.sale };
  }

  /**
   * Shared prepared-waste detection for cancelSale and updateSale:
   * a dine-in/takeaway/delivery sale is prepared waste when it has a
   * consumed-ingredient allocation or a recipe meal AND the kitchen
   * state shows the food was consumed (KDS cooking/ready/served, or a
   * non-pending stage on a sale older than 14h / with an unreadable
   * date). The predicate is cancelSale's original logic, unchanged;
   * both paths call it so the two treatments can never drift apart.
   */
  private async detectPreparedWasteSale(
    trx: Kysely<Database>,
    sale: { id: number; order_type?: string | null; created_at?: Date | string | null },
    tenantId: string,
  ): Promise<boolean> {
    let isPreparedWaste = false;
    const saleId = Number(sale.id);
    if (['dine_in', 'takeaway', 'delivery'].includes(String(sale.order_type || ''))) {
      const consumedIngredient = await trx.selectFrom('sale_line_stock_allocations as a')
        .innerJoin('sale_items as i', (join) => join
          .onRef('i.id', '=', 'a.sale_line_id')
          .onRef('i.tenant_id', '=', 'a.tenant_id'))
        .select('a.id')
        .where('a.tenant_id', '=', tenantId)
        .where('i.sale_id', '=', saleId)
        .whereRef('a.product_id', '!=', 'i.product_id')
        .limit(1).executeTakeFirst();
      const recipeMeal = await trx.selectFrom('sale_items as i')
        .innerJoin('manufacturing_boms as b', (join) => join
          .onRef('b.product_id', '=', 'i.product_id')
          .onRef('b.tenant_id', '=', 'i.tenant_id'))
        .select('i.id')
        .where('i.tenant_id', '=', tenantId)
        .where('i.sale_id', '=', saleId)
        .where('b.is_active', '=', true)
        .limit(1).executeTakeFirst();
      if (consumedIngredient || recipeMeal) {
        const kitchenRecord = await trx.selectFrom('settings').select('value')
          .where('tenant_id', '=', tenantId)
          .where('key', '=', 'kds_tickets_runtime_state').executeTakeFirst();
        let stage: string | undefined;
        try {
          const parsed = kitchenRecord?.value ? JSON.parse(String(kitchenRecord.value)) : null;
          stage = parsed?.tickets?.[String(saleId)]?.status;
        } catch {
          stage = 'pending';
        }
        const createdMs = sale.created_at ? new Date(sale.created_at).getTime() : NaN;
        if (stage === 'cooking' || stage === 'ready' || stage === 'served' ||
            (stage !== 'pending' && (!Number.isFinite(createdMs) ||
              Date.now() - createdMs > 14 * 60 * 60 * 1000))) {
          isPreparedWaste = true;
        }
      }
    }
    return isPreparedWaste;
  }

  /**
   * INV-CLOSED-SHIFT-POST-CLOSE-REFRESH: after a post-close edit or
   * cancel has written the sale's final state in this transaction,
   * refresh the original closed shift's stored figures through the
   * drawer service (recompute + stamp; a no-op when the figures are
   * unchanged). Must run inside the caller's transaction so a failed
   * refresh rolls the sale change back. Refuses loudly when the drawer
   * service was not wired: a post-close change must never silently
   * leave the closed shift stale.
   */
  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I26): after a backdated offline
   * sale has been written in this transaction, refresh every
   * closed / pending_review shift whose [created_at, closed_at]
   * window contains the sale's ORIGINAL timestamp. The sale was
   * already counted by the open shift on read; only already-closed
   * shifts need their stored figures corrected, with a stamp.
   */
  async refreshClosedShiftsForBackdatedOfflineSale(
    trx: Kysely<Database> | Transaction<Database>,
    offlineCreatedAt: Date,
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    tenantId: string,
  ): Promise<void> {
    if (!this.cashDrawerService) {
      throw new AppError('تعذر تحديث أرقام الوردية المغلقة: خدمة الورديات غير موصولة.', 'SHIFT_REFRESH_UNAVAILABLE', 500);
    }
    // A null sale branch/location matches any shift scope (the
    // same null-means-any rule as the attribution predicate); a
    // set one matches only its own scope or an unscoped shift.
    let shiftsQuery = trx
      .selectFrom('cashier_shifts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['closed', 'pending_review'])
      .where('created_at', '<=', offlineCreatedAt)
      .where((eb) => eb.or([
        eb('closed_at', '>=', offlineCreatedAt),
        eb('closed_at', 'is', null),
      ]));
    if (branchId != null) {
      shiftsQuery = shiftsQuery.where((eb) => eb.or([eb('branch_id', 'is', null), eb('branch_id', '=', branchId)]));
    }
    if (locationId != null) {
      shiftsQuery = shiftsQuery.where((eb) => eb.or([eb('location_id', 'is', null), eb('location_id', '=', locationId)]));
    }
    const shifts = await shiftsQuery.execute();
    for (const shift of shifts) {
      await this.refreshClosedShiftForPostCloseChange(
        trx, Number(shift.id), saleId, 'offline_sync', 'مزامنة فاتورة أوفلاين بتاريخها الأصلي', auth,
      );
    }
  }

  private async refreshClosedShiftForPostCloseChange(
    trx: Kysely<Database> | Transaction<Database>,
    shiftId: number,
    saleId: number,
    kind: 'edit' | 'cancel' | 'offline_sync',
    reason: string,
    auth: AuthContext,
  ): Promise<void> {
    if (!this.cashDrawerService) {
      throw new AppError('تعذر تحديث أرقام الوردية المغلقة: خدمة الورديات غير موصولة.', 'SHIFT_REFRESH_UNAVAILABLE', 500);
    }
    await this.cashDrawerService.refreshClosedShiftSummary(trx as Kysely<Database>, shiftId, {
      saleId,
      kind,
      reason,
      auth,
    });
  }

  async cancelSale(saleId: number, reason: string, managerPin: string, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    if (!managerPin) throw new AppError('رمز اعتماد المدير مطلوب لإلغاء الفاتورة.', 'MANAGER_AUTH_REQUIRED', 400);
    await this.authz.authorizeDiscountOverride(managerPin, auth, this.db);
    await this.tx.runInTransaction(this.db, async (trx) => {
      // Cancel previously had no book-digits resolution: its reversal
      // residuals rounded with toFixed(2). Resolve the tenant's digits
      // on this transaction handle, as create/update do, before any
      // reversal amount is computed.
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      // forUpdate is mandatory here: without the row lock two concurrent cancel requests both read
      // status='posted', both pass the guard below, and stock is restored twice while the sale
      // journal is reversed twice. The lock serializes them so the second one hits the guard.
      const sale = await trx.selectFrom('sales').selectAll().where('id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst();
      if (!sale) throw new AppError('Sale not found', 'SALE_NOT_FOUND', 404);
      if (sale.exchange_return_id) throw new AppError('فاتورة استبدال مترابطة؛ استخدم مرتجعاً بدلاً من إلغائها', 'EXCHANGE_IMMUTABLE', 422);
      if (sale.status === 'cancelled') throw new AppError('Sale already cancelled', 'SALE_ALREADY_CANCELLED', 400);
      if (sale.status !== 'posted') throw new AppError('Only posted sales can be cancelled', 'SALE_CANCEL_STATUS_FORBIDDEN', 400);
      // INV-SPIRIT-POST-CLOSE-EDIT: cancelling after the original shift
      // closed was never blocked; the post-close fact is recorded in the
      // audit event below, and the closed shift's stored figures are
      // refreshed (recompute + stamp) below — a cancel normally nets to
      // the same figures, so the refresh writes nothing. Cash attribution
      // for a closed original shift already falls back to the cancelling
      // user's open shift (see below).
      const cancelOriginalShift = await trx.selectFrom('cashier_shifts').select(['id', 'status'])
        .where('tenant_id', '=', scope.tenantId)
        .where('opened_by', '=', Number(sale.created_by || 0))
        .where('created_at', '<=', sale.created_at)
        .where(sql<boolean>`(closed_at is null or closed_at >= ${sale.created_at})`)
        .where(sql<boolean>`(${sale.branch_id}::int is null or branch_id is null or branch_id = ${sale.branch_id})`)
        .orderBy('id', 'desc').executeTakeFirst();
      const postCloseCancel = cancelOriginalShift ? String(cancelOriginalShift.status || '') !== 'open' : false;
      const postCloseCancelShiftId = postCloseCancel && cancelOriginalShift ? Number(cancelOriginalShift.id) : null;
      // Same immutability as the edit path: cancelling a signed invoice
      // would reverse books the signed attestation still describes.
      assertSaleNotZatcaSigned((sale as any).zatca_status);
      // A field sale's trip counters were raised at creation time and
      // must be reversed with the cancellation. Lock the trip row now
      // (before any stock work, the order settleTrip uses); the
      // reversal itself runs below, after the cancellation guards. A
      // settled trip's counters are history and stay untouched.
      const tripId = Number((sale as any).van_trip_id || 0) || null;
      const tripOpen = tripId ? await lockOpenTripRow(trx, scope.tenantId, tripId) : false;
      const existingReturn = await trx.selectFrom('return_documents').select('id')
        .where('return_type', '=', 'sale').where('invoice_id', '=', saleId)
        .where('tenant_id', '=', scope.tenantId).limit(1).executeTakeFirst();
      if (existingReturn) throw new AppError('لا يمكن إلغاء فاتورة لها مرتجعات؛ استخدم تسوية محاسبية.', 'SALE_CANCEL_HAS_RETURNS', 400);
      // A later customer receipt is a separate financial transaction. Cancelling
      // the entire sale would reverse the original receivable while leaving that
      // receipt's ledger entry in place, producing a fictitious customer credit.
      // These invoices must be handled via an explicit return/credit note.
      const laterAllocations = await trx.selectFrom('payment_allocations').select('id')
        .where('tenant_id', '=', scope.tenantId).where('invoice_type', '=', 'sale')
        .where('invoice_id', '=', saleId).limit(1).executeTakeFirst();
      if (laterAllocations) {
        throw new AppError('لا يمكن إلغاء فاتورة تم تحصيل سداد لاحق عليها؛ استخدم مرتجعاً أو تسوية محاسبية', 'SALE_CANCEL_HAS_LATER_PAYMENTS', 422);
      }
      const originalPaymentTotal = await trx.selectFrom('sale_payments')
        .select(sql<number>`coalesce(sum(amount), 0)`.as('amount'))
        .where('tenant_id', '=', scope.tenantId).where('sale_id', '=', saleId).executeTakeFirst();
      const recordedSalePayments = Number(originalPaymentTotal?.amount || 0);
      if (recordedSalePayments > 0 && Number(sale.paid_amount || 0) > recordedSalePayments + 0.009) {
        throw new AppError('الفاتورة تحتوي على تحصيلات لاحقة غير مرتبطة؛ يجب تسويتها قبل الإلغاء', 'SALE_CANCEL_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }

      // Kitchen consumption is irreversible once preparation starts. Reversing the
      // original sale journal would re-credit consumed ingredient inventory and
      // reverse historical COGS. After prep, require the financial-only return path.
      if (sale.delivery_status === 'settled') {
        throw new AppError('لا يمكن إلغاء طلب دليفري تمت تسوية عهدته؛ استخدم مرتجعاً مالياً', 'DELIVERY_SETTLED_CANCEL_USE_RETURN', 409);
      }
      // Reverse the cancelled sale's trip-counter contribution while
      // the trip row is still locked by this transaction.
      if (tripOpen && tripId) {
        const paymentRows = await trx.selectFrom('sale_payments').select(['amount', 'payment_channel'])
          .where('sale_id', '=', saleId).where('tenant_id', '=', scope.tenantId).execute();
        let oldLedgerCredit: number | null = null;
        if (String((sale as any).payment_channel || '').toLowerCase() === 'mixed') {
          const ledgerRow = await trx.selectFrom('customer_ledger').select('amount')
            .where('reference_type', '=', 'sale').where('reference_id', '=', saleId)
            .where('entry_type', '=', 'sale_credit').where('tenant_id', '=', scope.tenantId)
            .orderBy('id', 'desc').executeTakeFirst();
          oldLedgerCredit = ledgerRow ? Number((ledgerRow as any).amount || 0) : null;
        }
        const oldContribution = tripSaleContribution({
          total: (sale as any).total,
          paidAmount: (sale as any).paid_amount,
          paymentChannel: (sale as any).payment_channel,
          payments: paymentRows as any,
          ledgerCreditAmount: oldLedgerCredit ?? undefined,
        });
        await applyTripCounterDelta(trx, scope.tenantId, tripId, negateContribution(oldContribution));
      }
      const isPreparedWaste = await this.detectPreparedWasteSale(trx, sale, scope.tenantId);
      const items = await trx.selectFrom('sale_items').selectAll().where('sale_id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      await this.lockSaleStockRows(trx, scope, items);
      await this.restoreSalePharmacyBatches(trx, saleId, items, scope, false);
      await restoreImportLotsFromCancelledSale(trx, { tenantId: scope.tenantId, saleId });
      for (const item of [...items].sort((a, b) => Number(a.product_id || 0) - Number(b.product_id || 0))) {
        if (!item.product_id) continue;
        const product = await trx.selectFrom('products').select(['stock_qty']).where('id', '=', item.product_id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).executeTakeFirst();
        if (!product) throw new AppError('لا يمكن إلغاء البيع: الصنف الأصلي مفقود ويحتاج تسوية مخزون', 'SALE_CANCEL_PRODUCT_RECONCILIATION_REQUIRED', 409);
        const { restoreQty } = calculateRestoredStockQuantity(product.stock_qty, item.qty, item.unit_multiplier);

        const allocations = await trx.selectFrom('sale_line_stock_allocations')
           .selectAll()
           .where('sale_line_id', '=', item.id)
           .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
           .execute();

        if (allocations.length > 0) {
           for (const alloc of allocations) {
             // If meal was already prepared in kitchen, cooked food and consumed ingredients must not be restored to physical inventory
             if (isPreparedWaste) {
               continue;
             }
             const qtyToRestore = Number(alloc.quantity || 0);

             // Find branch for this location
             const locData = await trx.selectFrom('stock_locations').select('branch_id')
               .where('id', '=', alloc.location_id).where('tenant_id', '=', scope.tenantId)
               .executeTakeFirst();
             if (!locData) throw new AppError('مخزن الفاتورة لم يعد صالحاً؛ يلزم تسوية قبل الإلغاء', 'SALE_CANCEL_LOCATION_RECONCILIATION_REQUIRED', 409);
             const branchId = locData.branch_id ?? sale.branch_id;

             const stockChange = await applyStockDelta(trx, {
               productId: alloc.product_id,
               delta: qtyToRestore,
               branchId: branchId,
               locationId: alloc.location_id,
               tenantId: scope.tenantId,
               accountId: scope.accountId,
               allowNegative: true,
             });

             await trx
               .insertInto('stock_movements')
               .values({
                 product_id: alloc.product_id,
                 movement_type: 'sale_cancel',
                 qty: qtyToRestore,
                 before_qty: stockChange.scopeBefore,
                 after_qty: stockChange.scopeAfter,
                 reason: 'sale_cancel',
                 note: `Cancel S-${saleId}`,
                 reference_type: 'sale',
                 reference_id: saleId,
                 branch_id: branchId,
                 location_id: alloc.location_id,
                 created_by: auth.userId,
                 tenant_id: scope.tenantId,
                 account_id: scope.accountId,
               } as any)
               .execute();
           }
        } else {
           // Fallback for legacy sales without allocations
           if (isPreparedWaste) {
             continue;
           }
           const stockChange = await applyStockDelta(trx, {
             productId: Number(item.product_id),
             delta: restoreQty,
             branchId: sale.branch_id,
             locationId: sale.location_id,
             tenantId: scope.tenantId,
             accountId: scope.accountId,
           });
           await trx
             .insertInto('stock_movements')
             .values({
               product_id: item.product_id,
               movement_type: 'sale_cancel',
               qty: restoreQty,
               before_qty: stockChange.scopeBefore,
               after_qty: stockChange.scopeAfter,
               reason: 'sale_cancel',
               note: `Cancel S-${saleId}`,
               reference_type: 'sale',
               reference_id: saleId,
               branch_id: sale.branch_id,
               location_id: sale.location_id,
               created_by: auth.userId,
               tenant_id: scope.tenantId,
               account_id: scope.accountId,
             } as any)
             .execute();
        }
      }

      await this.releaseSaleSerials(trx, saleId, scope.tenantId);
      const collectibleTotal = Math.max(0, Number(sale.total || 0) - Number(sale.store_credit_used || 0));
      const originalPayments = await trx.selectFrom('sale_payments').select(['amount', 'payment_channel'])
        .where('sale_id', '=', saleId).where('tenant_id', '=', scope.tenantId).execute();
      const originalPaid = originalPayments.length
        ? originalPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        : Number(sale.paid_amount || 0);
      const remainingDebt = calculateRemainingDebt(collectibleTotal, originalPaid, moneyDigits);
      if (sale.customer_id && remainingDebt > 0) {
        await this.finance.createCustomerLedgerEntry(trx, sale.customer_id, -remainingDebt, `عكس فاتورة بيع S-${saleId}`, saleId, auth);
      }
      if (originalPayments.length === 0 && originalPaid > 0 && sale.payment_channel === 'mixed') {
        throw new AppError('فاتورة قديمة بمدفوعات مختلطة دون تفاصيل تحتاج تسوية قبل الإلغاء', 'SALE_CANCEL_PAYMENT_RECONCILIATION_REQUIRED', 409);
      }
      const cashRefundTotal = originalPayments.length > 0
        ? originalPayments.filter((payment) => payment.payment_channel === 'cash')
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        : sale.payment_channel === 'cash' ? originalPaid : 0;
      if (cashRefundTotal > 0) {
        // INV-CROSS-SHIFT-CANCEL-CASH-ATTRIBUTION: the refund belongs
        // to the shift that took the sale's cash — the opener's shift
        // whose window contains the sale, branch-scoped like the
        // fallback lookup and hasOpenCashierShift (one open shift
        // per user, so the creator's open shift on the branch is
        // the drawer that took the cash) — so that shift nets the
        // restored receipt (computeShiftCancelledSaleCashReceipts)
        // against the refund and the cancelling shift is untouched.
        // Only when that original shift is closed does the refund
        // fall back to the cancelling user's latest open shift on the
        // branch, as before; the closed shift's stored figures are
        // refreshed separately by the stamped recompute below (a
        // cancel normally nets to the same figures), and admins with
        // no open shift keep the sale-linked row.
        const originalCashShift = Number(sale.created_by || 0) > 0 && sale.created_at
          ? await trx.selectFrom('cashier_shifts').select(['id', 'status'])
            .where('tenant_id', '=', scope.tenantId)
            .where('opened_by', '=', Number(sale.created_by))
            .where('created_at', '<=', sale.created_at)
            .where(sql<boolean>`(closed_at is null or closed_at >= ${sale.created_at})`)
            .where(sql<boolean>`(${sale.branch_id}::int is null or branch_id is null or branch_id = ${sale.branch_id})`)
            .orderBy('id', 'desc').forUpdate().executeTakeFirst()
          : undefined;
        const refundShiftQuery = trx.selectFrom('cashier_shifts').select('id')
          .where('opened_by', '=', auth.userId).where('status', '=', 'open')
          .where('tenant_id', '=', scope.tenantId);
        const fallbackShift = originalCashShift && String(originalCashShift.status || '') === 'open'
          ? undefined
          : await (sale.branch_id == null
            ? refundShiftQuery.where('branch_id', 'is', null)
            : refundShiftQuery.where('branch_id', '=', sale.branch_id))
            .orderBy('id', 'desc').forUpdate().executeTakeFirst();
        const refundShift = originalCashShift && String(originalCashShift.status || '') === 'open'
          ? originalCashShift
          : fallbackShift;
        if (!refundShift && !['admin', 'super_admin'].includes(auth.role)) {
          throw new AppError('يجب فتح وردية على الفرع قبل رد نقدية فاتورة ملغاة', 'OPEN_SHIFT_REQUIRED', 400);
        }
        await this.finance.addTreasuryTransaction(trx, -roundSaleResidual(cashRefundTotal, moneyDigits),
          `إلغاء فاتورة بيع S-${saleId}`, saleId, auth, sale.branch_id, sale.location_id,
          refundShift?.id || null);
      }

      if (Number(sale.store_credit_used || 0) > 0 && sale.customer_id) {
        const customer = await trx.selectFrom('customers').select(['store_credit_balance']).where('id', '=', sale.customer_id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst();
        if (customer) {
          await trx.updateTable('customers').set({ store_credit_balance: calculateStoreCreditBalance(Number(customer.store_credit_balance || 0), Number(sale.store_credit_used || 0), moneyDigits), updated_at: sql`NOW()` }).where('id', '=', sale.customer_id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
        }
      }

      // Reconcile Customer Loyalty Points on Cancellation (ZS-078)
      if (sale.customer_id) {
        const customerId = Number(sale.customer_id);

        // 1. Claw back earned points
        const earnLog = await trx
          .selectFrom('customer_loyalty_logs')
          .select(['points_change'])
          .where('sale_id', '=', saleId)
          .where('action_type', '=', 'earn')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        if (earnLog && Number(earnLog.points_change) > 0) {
          const earnedPoints = Number(earnLog.points_change);
          const previousClawbacks = await trx
            .selectFrom('customer_loyalty_logs')
            .select(sql<number>`COALESCE(SUM(ABS(points_change)), 0)`.as('total_clawed'))
            .where('sale_id', '=', saleId)
            .where('action_type', 'in', ['return_clawback', 'cancel_clawback'])
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
          const alreadyClawed = Number(previousClawbacks?.total_clawed || 0);
          const clawbackDelta = Math.max(0, earnedPoints - alreadyClawed);

          if (clawbackDelta > 0) {
            const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst();
            const currentBal = Number(cust?.loyalty_points || 0);
            const balanceAfter = Math.max(0, Number((currentBal - clawbackDelta).toFixed(2)));

            await trx
              .updateTable('customers')
              .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
              .where('id', '=', customerId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();

            await trx
              .insertInto('customer_loyalty_logs')
              .values({
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
                customer_id: customerId,
                points_change: -clawbackDelta,
                balance_after: balanceAfter,
                action_type: 'cancel_clawback',
                sale_id: saleId,
                notes: `خصم ${clawbackDelta} نقطة ولاء مكتسبة بسبب إلغاء الفاتورة S-${saleId}`,
                created_at: sql`NOW()`,
              } as any)
              .execute();
          }
        }

        // 2. Refund redeemed points
        const redeemLog = await trx
          .selectFrom('customer_loyalty_logs')
          .select(['points_change'])
          .where('sale_id', '=', saleId)
          .where('action_type', '=', 'redeem')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst();

        if (redeemLog && Number(redeemLog.points_change) < 0) {
          const totalRedeemed = Math.abs(Number(redeemLog.points_change));
          const previousRefunds = await trx
            .selectFrom('customer_loyalty_logs')
            .select(sql<number>`COALESCE(SUM(points_change), 0)`.as('total_refunded'))
            .where('sale_id', '=', saleId)
            .where('action_type', 'in', ['return_refund', 'cancel_refund'])
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
          const alreadyRefunded = Number(previousRefunds?.total_refunded || 0);
          const refundDelta = Math.max(0, totalRedeemed - alreadyRefunded);

          if (refundDelta > 0) {
            const cust = await trx.selectFrom('customers').select(['loyalty_points']).where('id', '=', customerId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).forUpdate().executeTakeFirst();
            const currentBal = Number(cust?.loyalty_points || 0);
            const balanceAfter = Number((currentBal + refundDelta).toFixed(2));

            await trx
              .updateTable('customers')
              .set({ loyalty_points: balanceAfter, updated_at: sql`NOW()` } as any)
              .where('id', '=', customerId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();

            await trx
              .insertInto('customer_loyalty_logs')
              .values({
                tenant_id: scope.tenantId,
                account_id: scope.accountId,
                customer_id: customerId,
                points_change: refundDelta,
                balance_after: balanceAfter,
                action_type: 'cancel_refund',
                sale_id: saleId,
                notes: `رد ${refundDelta} نقطة ولاء مستبدلة سابقاً بسبب إلغاء الفاتورة S-${saleId}`,
                created_at: sql`NOW()`,
              } as any)
              .execute();
          }
        }
      }

      await trx
        .updateTable('sales')
        .set({ status: 'cancelled', cancel_reason: String(reason || '').trim(), cancelled_by: auth.userId, cancelled_at: sql`NOW()`, updated_at: sql`NOW()` })
        .where('id', '=', saleId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      await trx.insertInto('pos_audit_events').values({
        tenant_id: scope.tenantId, account_id: scope.accountId, event_type: 'invoice_cancel',
        user_id: auth.userId, sale_id: saleId, product_id: null, amount: Number(sale.total || 0),
        reason: String(reason || '').trim(), metadata: { managerApproved: true, ...(postCloseCancel ? { postClose: true, originalShiftId: postCloseCancelShiftId } : {}) },
      }).execute();

      try {
        await this.accountingPosting.reverseSaleJournal(trx, saleId, String(reason || '').trim(), auth, { isPreparedWaste });
      } catch (error) {
        this.logger.error(`Failed to post reversal accounting journal for cancelled sale ${saleId}`, error instanceof Error ? error.stack : String(error));
        throw error;
      }

      if (postCloseCancel && postCloseCancelShiftId) {
        await this.refreshClosedShiftForPostCloseChange(trx, postCloseCancelShiftId, saleId, 'cancel', String(reason || '').trim(), auth);
      }
    });

    await this.audit.log('إلغاء فاتورة بيع', `تم إلغاء الفاتورة S-${saleId} بواسطة ${auth.username}`, auth);
    return { ok: true, sales: (await this.query.listSales({}, auth)).sales };
  }
}
