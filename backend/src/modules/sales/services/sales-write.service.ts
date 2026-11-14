import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { assertBusinessAccountingDate } from '../../accounting/accounting-boundaries';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import {
  ALL_OPERATIONAL_LOCATIONS,
  resolveBranchSellableLocations,
} from '../../../common/engines/branch-sellable-locations.engine';
import { computeInvoiceTotals } from '../../../common/utils/invoice-totals';
import { ensureUniqueFlowItems } from '../../../common/utils/financial-integrity';
// previewConsumableStockQty is kept in this import: check-architecture-guardrails.cjs requires the token in sales-write.service.ts, although no method left in this file calls it.
import { applyStockDelta, lockStockProducts, previewConsumableStockQty, releaseLocationStock } from '../../../common/utils/location-stock-ledger';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { HeldSaleDto } from '../dto/held-sale.dto';
import { PosAuditEventDto } from '../dto/pos-audit-event.dto';
import { UpsertSaleDto, SalesOrderConversionRelease } from '../dto/upsert-sale.dto';
import { normalizeSalePayload } from '../helpers/sales-payload.helper';
import { buildPreparedSaleItem, calculateAllowedSaleUnitPrice, calculateCollectibleTotal, calculateStoreCreditBalance, computeSaleAllocationLegs, findBelowFloorSaleItems, resolvePostedSalePaymentChannel, roundSaleInvoiceTotals, roundSaleResidual } from '../helpers/sales-write.helper';
import { assertProductsNot86ed } from './restaurant-advanced-fnb.service';
import { allocateSaleTenders, shouldSuppressTenderFallback, type SaleTenderChannel } from '../engines/sale-tender.engine';
import { assertPosSubmitGates } from '../engines/pos-submit-gates.engine';
import { allocateInvoiceDiscount } from '../engines/invoice-discount.engine';
import { resolveSaleTaxRate } from '../engines/sale-tax-rate.engine';
import { resolveSaleServiceCharge } from '../engines/sale-service-charge.engine';
import { type TripSaleContribution } from '../../delivery-reps/van-trip-counters.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { SalesAuthorizationService } from './sales-authorization.service';
import { SalesFinanceService } from './sales-finance.service';
import { formatCreditLimitExceededMessage } from './credit-limit-message';
import { SalesQueryService } from './sales-query.service';
import { SalesStockAndPricingHelper } from './sales-stock-and-pricing.helper';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../../core/idempotency/idempotency.context';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { CashierFraudRadarService } from './cashier-fraud-radar.service';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import { ReturnsService, type ExchangeReturnContext } from '../../returns/returns.service';
import { CashDrawerService } from '../../cash-drawer/cash-drawer.service';
import { KdsService } from './kds.service';
import { SalesRestaurantAndSerialsHelper } from './sales-restaurant-and-serials.service';
import { validateOfflineCreatedAt } from '../../cash-drawer/helpers/cash-drawer.helper';
import { allocateSaleFromImportLots } from '../../import-sales/helpers/import-lot-allocation.helper';
import { SalesEditAndCancelService } from './sales-edit-and-cancel.service';

/**
 * Pre-approved commercial terms for a sale created by the system on behalf of a merchant user
 * (e.g. converting a storefront order). Internal-only: it is a second argument, never part of the
 * HTTP DTO, so no client can claim it.
 *
 * Why it exists: an online order's coupon discount and line prices were fixed by the server at
 * checkout (from the merchant's own coupon and catalog). Re-running the POS cashier gates on them
 * (canDiscount / canEditPrice / manager PIN) forced whoever converts the order either to drop the
 * discount — overcharging the customer at the door — or to fail the conversion.
 */
export interface SystemApprovedSaleTerms {
  /** Discount amount already approved; only the excess (if any) goes through the discount gate. */
  approvedDiscount?: number;
  /** productId -> approved unit price; a line at exactly this price skips the price-edit gate. */
  approvedUnitPrices?: Record<number, number>;
  /**
   * SF-2 D-SF-11: the storefront placement promise for this order —
   * isOutOfStockOrderingAllowed already let the store take it, so the
   * conversion must not re-refuse it on the separate POS
   * allowNegativeStockSales setting. Internal-only like the other
   * fields: set server-side by StorefrontService, never from a request.
   */
  allowNegativeStock?: boolean;
  /**
   * SF-3 D-SF-03: modifier prices frozen at order time, keyed by
   * `option:<optionId>` or `product:<productId>`; a line whose modifier
   * has an approved price converts at that price instead of being
   * re-priced from current server truth. Internal-only like the other
   * fields: built server-side from the stored order row by
   * resolveOnlineOrderTerms, never from a request.
   */
  approvedModifierPrices?: Record<string, number>;
}

@Injectable()
export class SalesWriteService {
  private readonly logger = new Logger(SalesWriteService.name);
  private restaurantSerials: SalesRestaurantAndSerialsHelper | undefined;

  private stockPricing: SalesStockAndPricingHelper | undefined;

  private salesEditAndCancel: SalesEditAndCancelService | undefined;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly authz: SalesAuthorizationService,
    private readonly finance: SalesFinanceService,
    private readonly query: SalesQueryService,
    private readonly accountingPosting: AccountingPostingService,
    private readonly idempotency: IdempotencyService,
    private readonly planFeatureService: PlanFeatureService,
    private readonly returnsService: ReturnsService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
    @Optional() private readonly fraudRadarService?: CashierFraudRadarService,
    // INV-CLOSED-SHIFT-POST-CLOSE-REFRESH: the drawer service refreshes
    // a closed shift's stored figures after a post-close edit/cancel.
    // Optional so existing manual constructions keep compiling; the
    // refresh helper below refuses loudly when it is absent.
    @Optional() private readonly cashDrawerService?: CashDrawerService,
    // R4-E I17: the KDS transfer inside the release block. Optional so
    // existing manual constructions keep compiling; the transfer helper
    // below refuses loudly when it is absent. KdsService is provided and
    // exported by sales.module.ts, so Nest injects it in production.
    @Optional() private readonly kdsService?: KdsService,
  ) {
    this.restaurantSerials = new SalesRestaurantAndSerialsHelper({
      kdsService: this.kdsService,
      accountingPosting: this.accountingPosting,
      planFeatureService: this.planFeatureService,
    });
    this.stockPricing = new SalesStockAndPricingHelper({
      authz: this.authz,
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
      loadFlatAddonCosts: this.loadFlatAddonCosts.bind(this),
    });
    this.salesEditAndCancel = this.editAndCancel();
  }

  // Lazy accessor for the restaurant/serials helper: Nest always runs the
  // constructor (eager build above), but several specs drive createSale
  // via Object.create(SalesWriteService.prototype) with no constructor
  // run — the first delegate call then builds the helper from the
  // instance's own kds/accounting/planFeature deps.
  private getRestaurantSerials(): SalesRestaurantAndSerialsHelper {
    if (!this.restaurantSerials) {
      this.restaurantSerials = new SalesRestaurantAndSerialsHelper({
        kdsService: this.kdsService,
        accountingPosting: this.accountingPosting,
        planFeatureService: this.planFeatureService,
      });
    }
    return this.restaurantSerials;
  }

  // Lazy accessor for the stock/pricing helper: Nest always runs the
  // constructor (eager build above), but several specs drive createSale
  // via Object.create(SalesWriteService.prototype) with no constructor
  // run — the first delegate call then builds the helper from the
  // instance's own authz + the two bound facade methods.
  private getStockPricing(): SalesStockAndPricingHelper {
    if (!this.stockPricing) {
      this.stockPricing = new SalesStockAndPricingHelper({
        authz: this.authz,
        getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
        loadFlatAddonCosts: this.loadFlatAddonCosts.bind(this),
      });
    }
    return this.stockPricing;
  }

  /**
   * The edit/cancel sub-service, built eagerly by the constructor. Specs
   * that Object.create the facade and set fields by hand never run the
   * constructor, so the delegates go through this accessor: it builds the
   * sub-service lazily from the same deps instead of throwing on an
   * undefined field. Production behaviour is unchanged (the constructor
   * builds it eagerly on the same path).
   */
  private editAndCancel(): SalesEditAndCancelService {
    if (!this.salesEditAndCancel) {
      this.salesEditAndCancel = new SalesEditAndCancelService({
        db: this.db,
        tx: this.tx,
        audit: this.audit,
        authz: this.authz,
        finance: this.finance,
        query: this.query,
        accountingPosting: this.accountingPosting,
        planFeatureService: this.planFeatureService,
        cashDrawerService: this.cashDrawerService,
        logger: this.logger,
        assertDiscountChangeAllowed: this.assertDiscountChangeAllowed.bind(this),
        assertUnitPriceChangeAllowed: this.assertUnitPriceChangeAllowed.bind(this),
        getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
        claimSaleSerials: this.claimSaleSerials.bind(this),
        releaseSaleSerials: this.releaseSaleSerials.bind(this),
        resolveSaleModifierCosts: this.resolveSaleModifierCosts.bind(this),
        loadFlatAddonCosts: this.loadFlatAddonCosts.bind(this),
        enforceRestaurantModifierContract: this.enforceRestaurantModifierContract.bind(this),
        autoProduceShortfall: this.autoProduceShortfall.bind(this),
        deductPharmacyBatchesFefo: this.deductPharmacyBatchesFefo.bind(this),
        restoreSalePharmacyBatches: this.restoreSalePharmacyBatches.bind(this),
        recordImportLotShortfalls: this.recordImportLotShortfalls.bind(this),
        getAllowNegativeStockSales: this.getAllowNegativeStockSales.bind(this),
        buildInsufficientStockError: this.buildInsufficientStockError.bind(this),
        lockProductRow: this.lockProductRow.bind(this),
        lockSaleStockRows: this.lockSaleStockRows.bind(this),
        getCurrentProductOffers: this.getCurrentProductOffers.bind(this),
      });
    }
    return this.salesEditAndCancel;
  }


  private async transferKdsTicketStateInTrx(
    trx: Transaction<Database>,
    tenantId: string,
    draftSaleId: number,
    postedSaleId: number,
  ): Promise<void> {
    return this.getRestaurantSerials().transferKdsTicketStateInTrx(trx, tenantId, draftSaleId, postedSaleId);
  }


  private async loadFlatAddonCosts(
    trx: Kysely<Database> | Transaction<Database>,
    tenantId: string,
    items: any[],
  ): Promise<Map<number, number>> {
    return this.getRestaurantSerials().loadFlatAddonCosts(trx, tenantId, items);
  }

  private async resolveSaleModifierCosts(
    trx: Kysely<Database> | Transaction<Database>, items: any[],
    tenantId: string, restaurantEnabled: boolean,
    approvedModifierPrices?: Record<string, number>,
  ): Promise<void> {
    return this.getRestaurantSerials().resolveSaleModifierCosts(trx, items, tenantId, restaurantEnabled, approvedModifierPrices);
  }

  private async enforceRestaurantModifierContract(
    trx: Kysely<Database> | Transaction<Database>, items: any[],
    tenantId: string, restaurantEnabled: boolean,
    approvedModifierPrices?: Record<string, number>,
  ): Promise<void> {
    return this.getRestaurantSerials().enforceRestaurantModifierContract(trx, items, tenantId, restaurantEnabled, approvedModifierPrices);
  }

  private async claimSaleSerials(
    trx: Kysely<Database>, item: { productId: number; requiredQty: number; serials?: unknown },
    saleId: number, saleItemId: number, tenantId: string,
  ): Promise<string[]> {
    return this.getRestaurantSerials().claimSaleSerials(trx, item, saleId, saleItemId, tenantId);
  }

  private async releaseSaleSerials(trx: Kysely<Database>, saleId: number, tenantId: string): Promise<void> {
    return this.getRestaurantSerials().releaseSaleSerials(trx, saleId, tenantId);
  }

  // Keep only settings needed by checkout; other settings can contain large JSON payloads.
  // On a cache miss the caller's transaction connection must be reused: opening a second
  // pool connection while every cashier holds a transaction can exhaust the whole pool.
  private static readonly SALE_SETTING_KEYS = [
    'posMaxDiscountThresholdEnabled', 'posMaxDiscountThresholdType', 'posMaxDiscountThresholdValue',
    'posSmallDiscountFlatAllowance',
    'taxRate', 'tax_rate', 'allowNegativeStockSales', 'allowSellingBelowStock', 'loyaltyEnabled',
    'loyaltyPointsPer100Egp', 'loyaltyPointRedeemValue', 'loyaltyMinRedeemPoints',
    'loyaltyMaxDiscountPercentage', 'requireCashierShiftForSales', 'deliveryFeeMode',
    // R4-A (INV-REST-SALE-MONEY-TRUTH): the dine-in service charge is
    // recomputed server-side, so its tenant settings must be fetched
    // here too (camelCase is the live key; the snake spellings are a
    // fallback only — they have no writer).
    'restaurantServiceChargeEnabled', 'restaurantServiceChargePercent',
    'restaurant_service_charge_enabled', 'restaurant_service_charge_rate',
    'invoiceNumberingScheme',
  ];
  private static readonly tenantSettingsMapCache = new Map<string, { map: Map<string, any>; expiresAt: number }>();
  private static readonly SETTINGS_MAP_CACHE_TTL_MS = 60_000; // 60s TTL

  public static invalidateSettingsCache(tenantId?: string): void {
    if (tenantId) {
      SalesWriteService.tenantSettingsMapCache.delete(tenantId);
    } else {
      SalesWriteService.tenantSettingsMapCache.clear();
    }
  }

  private async getTenantSettingsMap(trx: Kysely<Database> | Transaction<Database>, tenantId: string): Promise<Map<string, any>> {
    const now = Date.now();
    const cached = SalesWriteService.tenantSettingsMapCache.get(tenantId);
    if (cached && cached.expiresAt > now) {
      return cached.map;
    }

    const rows = await trx
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('key', 'in', SalesWriteService.SALE_SETTING_KEYS)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .execute();

    const map = new Map<string, any>();
    for (const row of rows) {
      try {
        map.set(row.key, JSON.parse(row.value));
      } catch {
        map.set(row.key, row.value);
      }
    }

    SalesWriteService.tenantSettingsMapCache.set(tenantId, {
      map,
      expiresAt: now + SalesWriteService.SETTINGS_MAP_CACHE_TTL_MS,
    });

    return map;
  }

  private shouldLogCheckoutTimings(): boolean {
    return this.getStockPricing().shouldLogCheckoutTimings();
  }

  private async assertDiscountChangeAllowed(
    trx: Kysely<Database> | Transaction<Database>,
    auth: AuthContext,
    discount: number,
    managerPin?: string | null,
    subtotal?: number,
  ): Promise<void> {
    return this.getStockPricing().assertDiscountChangeAllowed(trx, auth, discount, managerPin, subtotal);
  }

  private async assertUnitPriceChangeAllowed(trx: Kysely<Database> | Transaction<Database>, auth: AuthContext, providedPrice: number, allowedPrice: number, productId: number, managerPin?: string, saleId?: number): Promise<void> {
    return this.getStockPricing().assertUnitPriceChangeAllowed(trx, auth, providedPrice, allowedPrice, productId, managerPin, saleId);
  }

  private async getCurrentProductOffers(trx: Kysely<Database> | Transaction<Database>, productId: number, tenantId: string) {
    return this.getStockPricing().getCurrentProductOffers(trx, productId, tenantId);
  }

  /**
   * Takes the canonical first lock for a product's stock mutation.
   * applyStockDelta locks products before product_location_stock; every stock path must do the same
   * or concurrent sales/purchases/transfers deadlock on inverted lock order.
   */
  private async lockProductRow(
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    scope: { tenantId: string; accountId: string },
  ): Promise<void> {
    return this.getStockPricing().lockProductRow(trx, productId, scope);
  }

  private async lockSaleStockRows(
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    items: any[],
  ): Promise<void> {
    return this.getStockPricing().lockSaleStockRows(trx, scope, items);
  }

  private async getAllowNegativeStockSales(trx: Kysely<Database> | Transaction<Database>, tenantId: string): Promise<boolean> {
    return this.getStockPricing().getAllowNegativeStockSales(trx, tenantId);
  }

  private async buildInsufficientStockError(
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
  ): Promise<AppError> {
    return this.getStockPricing().buildInsufficientStockError(trx, params);
  }

  private async autoProduceShortfall(
    trx: Kysely<Database> | Transaction<Database>,
    items: { productId: number; requiredQty: number; availableQty: number; hasBOM?: boolean; bomId?: number; unitMultiplier?: number }[],
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    scope: { tenantId: string; accountId: string },
    auth: AuthContext,
    visitedProductIds: Set<number> = new Set(),
    depth = 0,
  ) {
    return this.getRestaurantSerials().autoProduceShortfall(trx, items, saleId, branchId, locationId, scope, auth, visitedProductIds, depth);
  }

  private async recordImportLotShortfalls(
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleLineId: number,
    allocation: { items: Array<{ productId: number; requestedQty: number; allocatedQty: number; shortfallQty: number; fullyCovered: boolean; reason: string }> },
    auth: AuthContext,
  ): Promise<void> {
    return this.getRestaurantSerials().recordImportLotShortfalls(trx, scope, saleId, saleLineId, allocation, auth);
  }

  private async deductPharmacyBatchesFefo(
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    allocations: Array<{ locationId: number | null; qty: number }>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleItemId: number,
  ): Promise<void> {
    return this.getRestaurantSerials().deductPharmacyBatchesFefo(trx, productId, allocations, scope, saleId, saleItemId);
  }

  private async restoreSalePharmacyBatches(
    trx: Kysely<Database> | Transaction<Database>, saleId: number,
    items: Array<{ id: number; product_id: number | null }>,
    scope: { tenantId: string; accountId: string }, removeAllocations: boolean,
  ): Promise<void> {
    return this.getRestaurantSerials().restoreSalePharmacyBatches(trx, saleId, items, scope, removeAllocations);
  }

  async authorizeDiscountOverride(secret: string, auth: AuthContext): Promise<Record<string, unknown>> {
    const result = await this.authz.authorizeDiscountOverride(String(secret || '').trim(), auth, this.db);
    return { ok: true, authorized: true, mode: result.mode, authorizedByName: result.authorizedByName };
  }

  async logPosAuditEvent(payload: PosAuditEventDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const reason = String(payload.note || '').trim();
    const event = {
      tenant_id: scope.tenantId,
      account_id: scope.accountId,
      event_type: payload.eventType,
      user_id: auth.userId,
      sale_id: null,
      product_id: payload.productId || null,
      amount: Number(payload.total || 0),
      reason,
      metadata: { branchId: payload.branchId, productName: payload.productName, qty: payload.qty, cartItemsCount: payload.cartItemsCount },
    };
    if (payload.eventType === 'no_sale') {
      const branchId = Number(payload.branchId);
      // INV-SPIRIT-NO-SALE-DRAWER: a no-sale opening needs only a
      // short recorded reason (non-empty) and an open shift; no
      // manager PIN. The opening itself is logged below (pos_audit
      // event with shiftId + username, and the audit log entry).
      if (!branchId || !reason) throw new AppError('حدد الفرع وسبب فتح الدرج', 'NO_SALE_REASON_REQUIRED', 400);
      await this.tx.runInTransaction(this.db, async (trx) => {
        if (!await this.authz.hasOpenCashierShift(trx, auth, branchId)) {
          throw new AppError('وردية كاشير مفتوحة مطلوبة لفتح الدرج', 'OPEN_SHIFT_REQUIRED', 400);
        }
        const shift = await trx.selectFrom('cashier_shifts').select('id')
          .where('tenant_id', '=', scope.tenantId).where('opened_by', '=', auth.userId)
          .where('branch_id', '=', branchId).where('status', '=', 'open')
          .orderBy('id', 'desc').forUpdate().executeTakeFirstOrThrow();
        await trx.insertInto('pos_audit_events').values({
          ...event, metadata: { ...event.metadata, shiftId: Number(shift.id), username: auth.username },
        }).execute();
      });
    } else {
      await this.db.insertInto('pos_audit_events').values(event).execute();
    }
    let detailInfo = '';

    if (payload.eventType === 'cart_remove') {
      const detailsParts = [
        `تم حذف عنصر من السلة بواسطة ${auth.username}`,
        payload.productName ? `الصنف: ${payload.productName}` : '',
        payload.productId ? `#${payload.productId}` : '',
        payload.qty ? `الكمية: ${payload.qty}` : '',
        typeof payload.total === 'number' ? `الإجمالي بعد الحذف: ${payload.total}` : '',
        typeof payload.cartItemsCount === 'number' ? `عدد العناصر: ${payload.cartItemsCount}` : '',
        payload.note ? `ملاحظة: ${payload.note}` : '',
      ].filter(Boolean);
      await this.audit.log('حدث أمني - حذف عنصر من السلة', detailsParts.join(' | '), auth, { eventCode: AUDIT_EVENT_CODES.POS_CART_ITEM_REMOVED });
      detailInfo = payload.productName ? `${payload.productName} (كمية: ${payload.qty || 1})` : (payload.note || 'حذف صنف من السلة');
    } else if (payload.eventType === 'no_sale') {
      detailInfo = reason || 'فتح درج بدون بيع';
      await this.audit.log('حدث أمني - فتح درج بدون بيع', detailInfo, auth, { eventCode: AUDIT_EVENT_CODES.POS_DRAFT_SALE_CANCELLED });
    } else {
      const cancelDetailsParts = [
        `تم إلغاء/حذف فاتورة قبل الإرسال بواسطة ${auth.username}`,
        typeof payload.total === 'number' ? `الإجمالي: ${payload.total}` : '',
        typeof payload.cartItemsCount === 'number' ? `عدد العناصر: ${payload.cartItemsCount}` : '',
        payload.note ? `ملاحظة: ${payload.note}` : '',
      ].filter(Boolean);
      await this.audit.log('حدث أمني - إلغاء/حذف فاتورة', cancelDetailsParts.join(' | '), auth, { eventCode: AUDIT_EVENT_CODES.POS_DRAFT_SALE_CANCELLED });
      detailInfo = `إلغاء فاتورة بقيمة ${payload.total || 0} ج.م`;
    }

    // Trigger proactive fraud radar anomaly check in the background
    if (this.fraudRadarService) {
      this.fraudRadarService.checkAndAlertAnomaly(
        scope.tenantId,
        auth.userId,
        auth.username,
        payload.eventType,
        detailInfo,
      ).catch((err) => this.logger.warn(`Fraud radar anomaly check error: ${err?.message}`));
    }

    return { ok: true };
  }

  /**
   * O62: reads the storefront order and returns what the server already approved for it: the coupon
   * discount it was quoted with, and the unit price each line was sold at. A cancelled or already
   * invoiced order approves nothing.
   */
  private async resolveOnlineOrderTerms(
    onlineOrderId: number,
    tenantId: string,
    existing?: SystemApprovedSaleTerms,
  ): Promise<SystemApprovedSaleTerms | undefined> {
    const order = await this.db
      .selectFrom('online_orders')
      .select(['id', 'status', 'sale_id', 'discount_amount', 'items_json'])
      .where('id', '=', onlineOrderId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst()
      .catch(() => undefined);

    if (!order || ['cancelled', 'payment_failed', 'review_required'].includes(order.status) || order.sale_id) return existing;

    let items: Array<Record<string, unknown>> = [];
    try {
      const raw = (order as any).items_json;
      items = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
    } catch {
      items = [];
    }

    const approvedUnitPrices: Record<number, number> = { ...(existing?.approvedUnitPrices || {}) };
    for (const item of items) {
      const productId = Number((item as any).productId);
      const unitPrice = Number((item as any).unitPrice ?? (item as any).price);
      if (productId > 0 && Number.isFinite(unitPrice) && unitPrice >= 0) approvedUnitPrices[productId] = unitPrice;
    }

    // SF-3 D-SF-03: the stored modifiers were validated + re-priced by the
    // server at placement — freeze those prices, keyed the way the
    // contract resolves them (option first, then product). The order row
    // is the authority; an internal caller's older map never overrides it.
    const approvedModifierPrices: Record<string, number> = { ...(existing?.approvedModifierPrices || {}) };
    for (const item of items) {
      const modifiers = Array.isArray((item as any).modifiers) ? (item as any).modifiers : [];
      for (const mod of modifiers) {
        const optionId = Number(mod?.optionId || mod?.option_id || 0);
        const productId = Number(mod?.productId || mod?.componentProductId || mod?.component_product_id || 0);
        const price = Number(mod?.price);
        if (!Number.isFinite(price) || price < 0) continue;
        if (optionId > 0) approvedModifierPrices[`option:${optionId}`] = price;
        else if (productId > 0) approvedModifierPrices[`product:${productId}`] = price;
      }
    }

    return {
      approvedDiscount: Math.max(Number(existing?.approvedDiscount || 0), Math.max(0, Number(order.discount_amount || 0))),
      approvedUnitPrices,
      approvedModifierPrices,
      // SF-2 D-SF-11: the caller-computed terms are rebuilt here, so the
      // storefront placement promise must ride along or it is lost.
      allowNegativeStock: existing?.allowNegativeStock === true,
    };
  }

  async createSale(payload: UpsertSaleDto, auth: AuthContext, approvedTerms?: SystemApprovedSaleTerms, conversionRelease?: SalesOrderConversionRelease): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const requestStartedAt = Date.now();

    // Idempotency: check for a previously committed result for this key
    const idemCtx = idempotencyStorage.getStore();
    if (payload.offlineDocNo && !idemCtx?.idempotencyKey) {
      throw new AppError('فاتورة الأوفلاين تتطلب مفتاح منع تكرار ثابتاً', 'OFFLINE_IDEMPOTENCY_REQUIRED', 400);
    }
    if (idemCtx?.idempotencyKey) {
      const cached = await this.idempotency.check(idemCtx.idempotencyKey, scope);
      if (cached) {
        if (cached.response?.sale) return cached.response as Record<string, unknown>;
        if (cached.response?.saleId) {
          const sale = await this.query.getSaleById(Number(cached.response.saleId), auth);
          return { ok: true, sale: sale.sale };
        }
        return cached.response as Record<string, unknown>;
      }
    }

    // O62: a cart loaded from a storefront order carries that order's id. The terms the server fixed
    // at checkout are read here from the order row itself — never from the request — and added to any
    // terms an internal caller already passed (convertToSale).
    const effectiveTerms = payload.onlineOrderId
      ? await this.resolveOnlineOrderTerms(Number(payload.onlineOrderId), scope.tenantId, approvedTerms)
      : approvedTerms;

    const returnedItems = (payload.items || []).filter((item) => Number(item.qty) < 0);
    const isExchange = Boolean(payload.exchangeSaleId);
    if (returnedItems.length && !isExchange) throw new AppError('السطور السالبة تتطلب فاتورة أصلية للاستبدال', 'EXCHANGE_SOURCE_REQUIRED', 400);
    if (isExchange && (!returnedItems.length || payload.source !== 'pos' || payload.onlineOrderId || payload.offlineDocNo ||
      payload.paymentType === 'credit' || payload.paymentChannel === 'credit' || payload.orderType === 'delivery' ||
      Number(payload.deliveryFee || 0) !== 0 ||
      Number(payload.storeCreditUsed || 0) > 0 || Number(payload.loyaltyPointsRedeemed || 0) > 0 ||
      returnedItems.some((item) => !Number.isInteger(item.originalSaleItemId) || Number(item.originalSaleItemId) <= 0))) {
      throw new AppError('الاستبدال يتطلب سطور مرتجع مرتبطة بالأصل دون طلب متجر أو خصم نقاط إضافي', 'EXCHANGE_REQUEST_INVALID', 400);
    }
    const normalized = normalizeSalePayload(isExchange ? { ...payload, items: payload.items.filter((item) => Number(item.qty) >= 0) } : payload);
    if (!normalized.items.length) throw new AppError('Sale must include at least one item', 'SALE_ITEMS_REQUIRED', 400);
    ensureUniqueFlowItems(normalized.items, 'SALE_DUPLICATE_PRODUCT', 'Sale must not contain duplicate product rows with the same unit and price');

    const txStartedAt = Date.now();
    const saleId = await this.tx.runInTransaction(this.db, async (trx) => {
      await assertBusinessAccountingDate(trx, scope.tenantId, new Date(), true);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      // R4-C INV-REST-MODIFIER-CONTRACT-2: re-price modifiers from
      // server truth and enforce group rules FIRST — before any stock
      // lock, so an unverifiable modifier price fails as 422
      // RESTAURANT_MODIFIER_PRICE_UNVERIFIED instead of the stock
      // lock's 404 PRODUCT_NOT_FOUND for a ghost modifier productId,
      // and before the prepared-items loop freezes lineTotal.
      await this.enforceRestaurantModifierContract(
        trx, normalized.items, scope.tenantId,
        this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant'),
        // SF-3 D-SF-03: an online order converts at its frozen modifier
        // prices (resolveOnlineOrderTerms above); a walk-in sale passes
        // none and keeps re-pricing from current truth.
        effectiveTerms?.approvedModifierPrices,
      );
      // INV-REST-FNB-TRUTH-2 (R-I11): 86 enforcement at line
      // validation, before totals and before any stock lock — an
      // 86'd line fails as 422 ITEM_86ED naming the item, including
      // a held draft whose item became 86'd after the hold. The
      // line is never silently dropped; the cashier removes it.
      await assertProductsNot86ed(
        trx, scope.tenantId, normalized.branchId ?? null,
        normalized.items.map((item: any) => ({ productId: item.productId })),
      );
      let exchange: ExchangeReturnContext | undefined;
      if (isExchange) {
        const original = await trx.selectFrom('sales').select(['id', 'customer_id', 'branch_id'])
          .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(payload.exchangeSaleId))
          .where('status', '=', 'posted').forUpdate().executeTakeFirst();
        if (!original || !normalized.customerId || Number(original.customer_id) !== normalized.customerId ||
          Number(original.branch_id) !== Number(normalized.branchId)) {
          throw new AppError('الاستبدال يتطلب نفس العميل المسجل وفرع الفاتورة الأصلية', 'EXCHANGE_SOURCE_MISMATCH', 422);
        }
        await this.lockSaleStockRows(trx, scope, [...normalized.items, ...returnedItems]);
        await trx.selectFrom('customers').select('id').where('tenant_id', '=', scope.tenantId)
          .where('id', '=', normalized.customerId).forUpdate().executeTakeFirstOrThrow();
        exchange = await this.returnsService.prepareExchangeReturn(trx, {
          type: 'sale', invoiceId: Number(original.id), managerPin: payload.managerPin,
          note: 'استبدال فوري ذري', items: returnedItems.map((item) => ({
            productId: item.productId, qty: Math.abs(item.qty), saleItemId: item.originalSaleItemId,
            serials: item.serials,
          })),
        }, auth);
      }
      let onlineOrderToRelease: any = null;
      if (payload.onlineOrderId) {
        onlineOrderToRelease = await trx
          .selectFrom('online_orders')
          .selectAll()
          .where('id', '=', Number(payload.onlineOrderId))
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .forUpdate()
          .executeTakeFirst();

        if (onlineOrderToRelease?.sale_id) {
          throw new AppError('تم تحويل هذا الطلب لفاتورة مبيعات مسبقاً', 'ORDER_ALREADY_INVOICED', 400);
        }
        if (!onlineOrderToRelease || ['cancelled', 'payment_failed', 'review_required'].includes(onlineOrderToRelease.status)) {
          throw new AppError('لا يمكن إصدار فاتورة لهذا الطلب قبل تسوية حالة الدفع', 'ORDER_PAYMENT_REVIEW_REQUIRED', 400);
        }
        if (onlineOrderToRelease.gateway_order_id && onlineOrderToRelease.payment_status !== 'paid') {
          throw new AppError('توجد جلسة دفع إلكترونية معلقة لهذا الطلب', 'ORDER_PAYMENT_PENDING', 400);
        }

        if (onlineOrderToRelease?.stock_reserved) {
          let orderItems: Array<any> = [];
          try {
            const raw = onlineOrderToRelease.items_json;
            orderItems = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
          } catch {}
          if (orderItems.length > 0) {
            await this.lockSaleStockRows(trx, scope, [...normalized.items, ...orderItems]);
            await releaseLocationStock(trx, {
              branchId: onlineOrderToRelease.reserved_branch_id ?? onlineOrderToRelease.branch_id,
              locationId: onlineOrderToRelease.reserved_location_id,
              tenantId: scope.tenantId,
              accountId: scope.accountId,
              items: orderItems.map((it) => ({
                productId: Number(it.productId),
                qty: Number(it.quantity ?? it.qty ?? 1),
              })),
            });
          }
        }
      }

      if (!onlineOrderToRelease?.stock_reserved) {
        await this.lockSaleStockRows(trx, scope, normalized.items);
      }

      if (normalized.discount < 0) throw new AppError('Discount cannot be negative', 'INVALID_DISCOUNT', 400);
      if (normalized.storeCreditUsed < 0) throw new AppError('Store credit cannot be negative', 'INVALID_STORE_CREDIT', 400);

      // INV-SALES-ORDER-CONVERSION-STOCK-LEGS: a sales-order conversion
      // releases its reservation here, inside the sale transaction, under
      // the product locks taken above — never before the sale, where a
      // concurrent sale could consume the freed stock, and never after,
      // where a rollback would leave the reservation silently lost.
      // The order must still be in the 'converting' state claimed by
      // convertToSale; anything else fails closed before any stock moves.
      if (conversionRelease && conversionRelease.items.length > 0) {
        const converting = await trx
          .selectFrom('sales_orders')
          .select('id')
          .where('id', '=', conversionRelease.salesOrderId)
          .where('tenant_id', '=', scope.tenantId)
          .where('status', '=', 'converting')
          .forUpdate()
          .executeTakeFirst();
        if (!converting) {
          throw new AppError('Sales order is not being converted', 'SALES_ORDER_NOT_CONVERTING', 409);
        }
        await releaseLocationStock(trx, {
          branchId: conversionRelease.branchId,
          locationId: conversionRelease.locationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          items: conversionRelease.items,
        });
      }

      const customer = normalized.customerId
        ? await trx.selectFrom('customers').select(['id', 'name', 'balance', 'credit_limit', 'store_credit_balance', 'loyalty_points', 'is_credit_blocked', 'credit_block_reason']).where('id', '=', normalized.customerId).where('tenant_id', '=', scope.tenantId).where('is_active', '=', true).forUpdate().executeTakeFirst()
        : null;
      if (normalized.customerId && !customer) throw new AppError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
      if (normalized.paymentType === 'credit' && !customer) throw new AppError('Credit sale requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);

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

      // أي المخازن يجوز لهذا الفرع السحب منها — القاعدة في `branch-sellable-locations.engine.ts`،
      // ويستدعيها مسار طلب المتجر الإلكتروني أيضاً. كانت مكتوبة هنا وحدها، فكان الكاشير يبيع صنفاً
      // يرفضه الموقع على نفس الفرع ونفس المخزون.
      let eligibleLocations: Array<{ id: number | null; branchId: number | null }> =
        [{ id: normalized.locationId, branchId: normalized.branchId }];
      if (normalized.source === 'pos' && branch?.sales_stock_mode === ALL_OPERATIONAL_LOCATIONS) {
        const allLocs = await trx.selectFrom('stock_locations')
          .select(['id', 'location_type', 'branch_id'])
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true)
          .execute();
        eligibleLocations = resolveBranchSellableLocations(branch, normalized.branchId, allLocs);
      }

      // SF-2 D-SF-11: one stock gate for storefront orders — the
      // conversion honours the storefront placement promise carried in
      // the approved terms (an order the store was allowed to take must
      // be convertible), OR the POS negative-stock policy. Walk-in POS
      // sales carry no terms flag and keep the POS setting alone.
      const allowNegativeStockSales = (await this.getAllowNegativeStockSales(trx, scope.tenantId)) || effectiveTerms?.allowNegativeStock === true;

      const productIds = Array.from(new Set(normalized.items.map((it) => it.productId)));
      const productRows = productIds.length > 0
        ? await trx.selectFrom('products as p')
            .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').onRef('b.tenant_id', '=', 'p.tenant_id').on('b.is_active', '=', true))
            .select(['p.id', 'p.name', 'p.name_en', 'p.stock_qty', 'p.reserved_qty', 'p.retail_price', 'p.wholesale_price', 'p.cost_price', 'p.min_selling_price', 'p.item_type', 'b.id as bom_id'])
            .where('p.id', 'in', productIds)
            .where(sql<boolean>`p.tenant_id = ${scope.tenantId}`)
            .where('p.is_active', '=', true)
            .execute()
        : [];
      const productMap = new Map(productRows.map((p) => [Number(p.id), p]));

      const allOffers = productIds.length > 0
        ? await trx
            .selectFrom('product_offers')
            .select([
              'product_id',
              'offer_type',
              'value',
              'start_date',
              'end_date',
              'min_qty',
              'bogo_buy_qty',
              'bogo_get_qty',
              'bogo_discount_percent',
              'happy_hour_start',
              'happy_hour_end',
              'days_of_week',
            ])
            .where('product_id', 'in', productIds)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .where('is_active', '=', true)
            .orderBy('id', 'desc')
            .execute()
        : [];
      const offersByProductId = new Map<number, typeof allOffers>();
      for (const off of allOffers) {
        const pId = Number(off.product_id);
        if (!offersByProductId.has(pId)) offersByProductId.set(pId, []);
        offersByProductId.get(pId)!.push(off);
      }

      const bomIds = productRows.map((p) => (p.bom_id ? Number(p.bom_id) : 0)).filter((id) => id > 0);
      const allBomLines = bomIds.length > 0
        ? await trx.selectFrom('manufacturing_bom_lines as l')
            .innerJoin('products as p', (join) => join.onRef('p.id', '=', 'l.component_product_id').on('p.tenant_id', '=', scope.tenantId))
            .select(['l.bom_id', 'p.name as component_name'])
            .where('l.bom_id', 'in', bomIds)
            .execute()
        : [];
      const bomNamesByBomId = new Map<number, string[]>();
      for (const bl of allBomLines) {
        const bId = Number(bl.bom_id);
        if (!bomNamesByBomId.has(bId)) bomNamesByBomId.set(bId, []);
        bomNamesByBomId.get(bId)!.push(String(bl.component_name || ''));
      }

      const allStockRows = normalized.locationId && productIds.length > 0
        ? await trx.selectFrom('product_location_stock')
            .select(['product_id', 'location_id', 'branch_id', 'qty', 'reserved_qty'])
            .where('product_id', 'in', productIds)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute()
        : [];
      const stockRowsByProductId = new Map<number, typeof allStockRows>();
      for (const sr of allStockRows) {
        const pId = Number(sr.product_id);
        if (!stockRowsByProductId.has(pId)) stockRowsByProductId.set(pId, []);
        stockRowsByProductId.get(pId)!.push(sr);
      }

      let subtotal = 0;
      const preparedItems = [];
      const autoProduceItems = [];
      for (const item of normalized.items) {
        if (Number(item.price || 0) <= 0) {
          throw new AppError('Sale item price must be greater than zero', 'INVALID_SALE_PRICE', 400);
        }
        const product = productMap.get(item.productId);
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);
        
        const activeOffers = offersByProductId.get(item.productId) || [];
        const allowedUnitPrice = calculateAllowedSaleUnitPrice({
          retailPrice: product.retail_price,
          wholesalePrice: product.wholesale_price,
          priceType: item.priceType,
          offers: activeOffers,
          qty: item.qty,
          unitMultiplier: item.unitMultiplier,
          moneyDigits,
        });
        const approvedUnitPrice = effectiveTerms?.approvedUnitPrices?.[item.productId];
        const isApprovedPrice = approvedUnitPrice !== undefined && Math.abs(Number(item.price || 0) - Number(approvedUnitPrice)) <= 0.0001;
        if (!isApprovedPrice) {
          await this.assertUnitPriceChangeAllowed(trx, auth, Number(item.price || 0), allowedUnitPrice, item.productId, normalized.managerPin);
        }
        const effectiveAllowedUnitPrice = isApprovedPrice && approvedUnitPrice !== undefined
          ? Number(approvedUnitPrice)
          : allowedUnitPrice;

        let availableStockQty = 0;
        const productStockRows = stockRowsByProductId.get(item.productId) || [];
        if (!normalized.locationId) {
          availableStockQty = Math.max(0, Number(product.stock_qty || 0) - Number(product.reserved_qty || 0));
        } else if (eligibleLocations.length === 1) {
          const locRow = productStockRows.find((r) => Number(r.location_id) === Number(normalized.locationId));
          const unassignedRow = productStockRows.find((r) => r.location_id == null && r.branch_id == null);
          const locAvail = Math.max(0, Number(locRow?.qty || 0) - Number(locRow?.reserved_qty || 0));
          const unassignedAvail = Math.max(0, Number(unassignedRow?.qty || 0) - Number(unassignedRow?.reserved_qty || 0));
          availableStockQty = Number((locAvail + unassignedAvail).toFixed(3));
        } else {
          // If all_operational_locations is enabled, sum the stock of all eligible locations + unassigned
          const locIds = eligibleLocations.map(l => l.id).filter(id => id != null);
          let totalEligible = 0;
          for (const row of productStockRows) {
            const rowAvail = Math.max(0, Number(row.qty || 0) - Number(row.reserved_qty || 0));
            if (row.location_id == null && row.branch_id == null) {
              totalEligible += rowAvail;
            } else if (row.location_id != null && locIds.includes(Number(row.location_id))) {
              totalEligible += rowAvail;
            }
          }
          availableStockQty = Number(totalEligible.toFixed(3));
        }
          
        const hasBOM = !!product.bom_id;
        let finalProductName = product.name;

        if (hasBOM) {
          const bomLines = bomNamesByBomId.get(Number(product.bom_id)) || [];
          if (bomLines.length > 0) {
            finalProductName = `${product.name} (${bomLines.join(' + ')})`;
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
          effectiveAllowedUnitPrice,
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

      // Fetch loyalty and cashier settings from high-speed in-memory cache
      const settingsMap = await this.getTenantSettingsMap(trx, scope.tenantId);

      // Tax F1: the invoice tax rate is the tenant's configured rate or
      // 0 (exempt) — never whatever the client sent. resolveSaleTaxRate
      // throws SALE_TAX_RATE_MISMATCH before any totals, stock, or
      // journal work; the resolved rate replaces the payload rate so
      // the stored tax_rate and the computed totals agree exactly.
      // The legacy `tax_rate` spelling falls back behind `taxRate`,
      // mirroring the held-draft bill formatter's defensive read.
      normalized.taxRate = resolveSaleTaxRate(
        normalized.taxRate,
        settingsMap.get('taxRate') ?? settingsMap.get('tax_rate'),
      );

      const loyaltyEnabledVal = settingsMap.get('loyaltyEnabled');
      const loyaltyEnabled = loyaltyEnabledVal === true || loyaltyEnabledVal === 'true';
      const pointsPer100Egp = Number(settingsMap.get('loyaltyPointsPer100Egp') ?? 10);
      const pointRedeemValue = Number(settingsMap.get('loyaltyPointRedeemValue') ?? 0.1);
      const minRedeemPoints = Number(settingsMap.get('loyaltyMinRedeemPoints') ?? 0);
      const maxDiscountPercentage = Number(settingsMap.get('loyaltyMaxDiscountPercentage') ?? 100);

      let effectiveDiscount = normalized.discount;
      let loyaltyDiscount = 0;
      let pointsAfterRedeem = Number((customer as any)?.loyalty_points || 0);

      if (normalized.loyaltyPointsRedeemed > 0 && customer) {
        if (!loyaltyEnabled) {
          throw new AppError('برنامج نقاط الولاء معطل حالياً في إعدادات النظام', 'LOYALTY_PROGRAM_DISABLED', 400);
        }
        const availablePoints = Number((customer as any)?.loyalty_points || 0);
        if (normalized.loyaltyPointsRedeemed > availablePoints + 0.001) {
          throw new AppError('رصيد نقاط الولاء غير كافٍ للاستبدال', 'INSUFFICIENT_LOYALTY_POINTS', 400);
        }
        if (minRedeemPoints > 0 && availablePoints < minRedeemPoints - 0.001) {
          throw new AppError(`الحد الأدنى لرصيد النقاط للاستبدال هو ${minRedeemPoints} نقطة`, 'MIN_LOYALTY_POINTS_NOT_MET', 400);
        }
        const calculatedDiscount = roundSaleResidual(normalized.loyaltyPointsRedeemed * pointRedeemValue, moneyDigits);
        const maxAllowedDiscount = roundSaleResidual((subtotal * maxDiscountPercentage) / 100, moneyDigits);
        loyaltyDiscount = Math.min(calculatedDiscount, maxAllowedDiscount);
        effectiveDiscount = roundSaleResidual(effectiveDiscount + loyaltyDiscount, moneyDigits);
        pointsAfterRedeem = Math.max(0, Number((availablePoints - normalized.loyaltyPointsRedeemed).toFixed(2)));
      }

      // INV-CONVERSION-LINE-DISCOUNTS-PRESERVED: per-line discounts are
      // discounts granted at conversion too, so they count toward the
      // gated amount alongside the header discount (the POS sends
      // lineDiscount too since INV-POS-LINE-DISCOUNT, so a direct
      // sale's gated amount includes its line discounts).
      const lineDiscountTotal = roundSaleResidual(normalized.items.reduce((sum, item) => sum + Number((item as { lineDiscount?: number }).lineDiscount || 0), 0), moneyDigits);
      const unapprovedDiscount = Math.max(0, roundSaleResidual(roundSaleResidual(normalized.discount - Number(approvedTerms?.approvedDiscount || 0), moneyDigits) + lineDiscountTotal, moneyDigits));
      await this.assertDiscountChangeAllowed(trx, auth, unapprovedDiscount, normalized.managerPin, subtotal);
      if (effectiveDiscount > subtotal) throw new AppError('Discount cannot exceed subtotal', 'INVALID_DISCOUNT', 400);
      // R4-A (INV-REST-SALE-MONEY-TRUTH): the dine-in service charge
      // is a tenant decision, not a client assertion — same shape as
      // the Tax F1 gate above. The engine returns null for a non-POS
      // source (the charge stays exactly as sent) and 0 for a
      // non-dine-in order or a disabled charge; otherwise it
      // recomputes (subtotal - effectiveDiscount) x percent at book
      // digits. This overwrite happens BEFORE computeInvoiceTotals,
      // so the stored sales.service_charge, the totals, the tender
      // allocation and postSale all consume the recomputed truth.
      const recomputedServiceCharge = resolveSaleServiceCharge({
        orderType: normalized.orderType,
        source: normalized.source,
        enabled: settingsMap.get('restaurantServiceChargeEnabled') ?? settingsMap.get('restaurant_service_charge_enabled'),
        percent: settingsMap.get('restaurantServiceChargePercent') ?? settingsMap.get('restaurant_service_charge_rate'),
        netBase: subtotal - effectiveDiscount,
        digits: moneyDigits,
      });
      if (recomputedServiceCharge !== null) normalized.serviceCharge = recomputedServiceCharge;
      // Pre-round the sale-side totals to book digits before allocation
      // (INV-SALE-TAX-BOOK-DIGITS-PRE-ROUND): computeInvoiceTotals
      // always rounds to 3 decimals, but the allocation engine fails
      // closed on anything finer than book digits. The shared totals
      // util is untouched; postSale re-rounds these same book-digits
      // values, so the journal legs are unchanged.
      const { taxAmount, total } = roundSaleInvoiceTotals(
        computeInvoiceTotals(subtotal, effectiveDiscount, normalized.taxRate, normalized.pricesIncludeTax, normalized.deliveryFee, normalized.serviceCharge, Number((normalized as any).tipAmount || 0)),
        moneyDigits,
      );
      // R5-A (INV-REST-TOTALS-TRUTH-2, R-I53): the POS sends the total
      // it displayed as expectedTotal. The server never trusts it —
      // it cross-checks it against the total it just recomputed, and a
      // drift bigger than one minor unit is a loud 422 naming both
      // totals, never a silently posted wrong invoice. This is what
      // catches the next frontend/backend formula drift (today: the
      // loyalty cap and the service-charge percent disagreed three
      // ways). Callers that never send expectedTotal (dashboard,
      // order conversions, offline sync) skip the check. Placed here,
      // after computeInvoiceTotals and before any stock, journal or
      // tender work, so a mismatch writes nothing.
      if (normalized.expectedTotal != null && Number(normalized.expectedTotal) > 0) {
        const expectedTotalDrift = Math.abs(total - Number(normalized.expectedTotal));
        if (expectedTotalDrift > Math.pow(10, -moneyDigits)) {
          throw new AppError(
            `إجمالي الفاتورة المعروض (${Number(normalized.expectedTotal)}) لا يطابق الإجمالي المحسوب (${total})`,
            'SALE_TOTAL_MISMATCH',
            422,
          );
        }
      }
      const { taxAmount: itemOnlyTaxAmount } = roundSaleInvoiceTotals(
        computeInvoiceTotals(subtotal, effectiveDiscount, normalized.taxRate, normalized.pricesIncludeTax, 0, 0, 0),
        moneyDigits,
      );
      const allocatedLines = allocateInvoiceDiscount({
        lines: preparedItems.map((item) => ({ lineTotal: item.lineTotal, qty: item.qty })),
        invoiceDiscount: effectiveDiscount, invoiceTax: itemOnlyTaxAmount, pricesIncludeTax: normalized.pricesIncludeTax, digits: moneyDigits,
      });
      const allocationByItem = new Map(preparedItems.map((item, index) => [item, allocatedLines[index]]));
      if (normalized.storeCreditUsed > total + 0.0001) throw new AppError('Store credit cannot exceed invoice total', 'INVALID_STORE_CREDIT', 400);

      // Distribute the invoice discount across lines before checking the real selling floor.
      // INV-SALE-EDIT-COST-FLOOR: the floor computation is the shared
      // findBelowFloorSaleItems helper, also called by updateSale.
      const belowFloorItems = findBelowFloorSaleItems(preparedItems.map((item) => {
        const product = productMap.get(item.productId);
        return {
          productId: item.productId,
          isService: item.isService,
          costPrice: item.costPrice,
          unitMultiplier: item.unitMultiplier,
          qty: item.qty,
          minSellingPrice: Number(product?.min_selling_price || 0),
          effectiveAllowedUnitPrice: item.effectiveAllowedUnitPrice,
          netLineTotal: allocationByItem.get(item)!.netLineTotal,
        };
      }));
      // INV-POS-ADMIN-DISCOUNT-AUTHORITY: an admin selling below the
      // floor is not blocked (the admin is the approver); the lines are
      // still recorded in the sale note below. A cashier still needs the
      // manager approval.
      const isAdminSeller = auth.role === 'admin' || auth.role === 'super_admin';
      const floorApproval = belowFloorItems.length && !isAdminSeller
        ? await this.authz.authorizeDiscountOverride(normalized.managerPin, auth, trx)
        : null;

      if (exchange) {
        const settlement = await this.returnsService.settleExchangeReturn(trx, exchange, total,
          payload.exchangeRefundMethod || 'cash', auth);
        normalized.storeCreditUsed = settlement.appliedCredit;
        if (!customer) throw new AppError('عميل الاستبدال غير موجود', 'CUSTOMER_NOT_FOUND', 404);
        const refreshed = await trx.selectFrom('customers').select('store_credit_balance')
          .where('tenant_id', '=', scope.tenantId).where('id', '=', normalized.customerId!)
          .forUpdate().executeTakeFirstOrThrow();
        customer.store_credit_balance = refreshed.store_credit_balance;
      }
      const collectibleTotal = calculateCollectibleTotal(total, normalized.storeCreditUsed, moneyDigits);
      
      if (normalized.source === 'pos') {
        // INV-REST-SHIFT-CLOSE-CONTROL (I23): the POS gate honours
        // requireCashierShiftForSales — tenants that run without
        // shifts (wholesale/van/contracting/maritime, where the
        // setting is forced false) are no longer told shifts are
        // off while sales still demand one. Missing setting fails
        // closed to demanding a shift.
        const hasOpenShift = await this.authz.hasOpenCashierShiftForSale(trx, auth, normalized.branchId, settingsMap);
        if (!hasOpenShift) throw new AppError('Open cashier shift is required before posting a POS sale', 'OPEN_SHIFT_REQUIRED', 400);
      } else if (normalized.paymentType !== 'credit' && (normalized.payments.some((entry) => entry.paymentChannel === 'cash') || normalized.paymentChannel === 'cash')) {
        // INV-ADMIN-CASH-SALE-SHIFT-REQUIRED: every cash receipt
        // needs an open shift, regardless of role. Admins used to be
        // exempt here, so a back-office cash sale wrote GL cash with
        // no shift attribution and surfaced as a false overage at
        // close. Admins can hold shifts (openCashierShift exempts
        // them from branch assignment), so this never deadlocks.
        // The setting-aware gate applies here too: a tenant that
        // runs without shifts must not be blocked on a cash sale.
        const hasOpenShift = await this.authz.hasOpenCashierShiftForSale(trx, auth, normalized.branchId, settingsMap);
        if (!hasOpenShift) throw new AppError('Open cashier shift is required before posting a cash sale', 'OPEN_SHIFT_REQUIRED', 400);
      }

      // INV-REST-COD-TENDER-TRUTH (R7-D): a no-legs COD delivery must
      // post as an unpaid receivable (paid 0), never as fully-paid
      // cash. The status is read off the raw payload here:
      // normalizeSalePayload never carries collectionStatus into
      // `normalized`, so this is the only place the allocation can
      // see it. Computed BEFORE allocateSaleTenders: the fallback
      // fires inside the allocation, and the isCod derivation below
      // reads the post-allocation paidAmount.
      const suppressTenderFallback = shouldSuppressTenderFallback({
        orderType: normalized.orderType,
        collectionStatus: (payload as any).collectionStatus,
        paymentType: normalized.paymentType,
      });
      // INV-REST-COD-COLLECTION-TRUTH (T11-D, D-T11-1): a delivery
      // WITH a courier rep must never infer prepaid from full payment
      // alone. An absent collectionStatus + a courier means the
      // courier collects: the cash legs that rode in on the default
      // cash channel are NOT money in hand, so they are withheld
      // from the tender allocation (paid 0, COD receivable, rep
      // custody) instead of posting a cash leg that settlement then
      // refuses (paid_amount > 0.009). Prepaid needs an explicit
      // prepaid status or an online-channel leg (wallet/instapay) —
      // a verifiable gateway receipt. Card legs are kept as declared
      // (bank money, not cash in hand). Non-courier deliveries,
      // credit sales and explicit statuses keep the existing
      // inference exactly. The rep id is parsed here only; the
      // delivery block below still validates that the rep exists.
      const rawCollectionStatusForTender = String((payload as any).collectionStatus || '').trim();
      const tenderCourierRepId = Number((payload as any).deliveryRepId || 0);
      const hasOnlineChannelTender = normalized.payments.some(
        (entry) => entry.paymentChannel === 'wallet' || entry.paymentChannel === 'instapay',
      );
      const inferCodFromCourier = String(normalized.orderType || '').trim() === 'delivery'
        && !rawCollectionStatusForTender
        && normalized.paymentType !== 'credit'
        && Number.isFinite(tenderCourierRepId) && tenderCourierRepId > 0
        && !hasOnlineChannelTender;
      const strippedCashLegs = inferCodFromCourier
        && normalized.payments.some((entry) => entry.paymentChannel === 'cash');
      const tenderPayments = inferCodFromCourier
        ? normalized.payments.filter((entry) => entry.paymentChannel !== 'cash')
        : normalized.payments;
      const tenderAllocation = allocateSaleTenders({
        paymentType: normalized.paymentType, payments: tenderPayments, collectibleTotal,
        fallbackChannel: (['card', 'wallet', 'instapay'].includes(normalized.paymentChannel) ? normalized.paymentChannel : 'cash') as SaleTenderChannel,
        tenderedCash: strippedCashLegs ? 0 : normalized.tenderedAmount, digits: moneyDigits,
        suppressFallback: suppressTenderFallback,
      });
      const payments = tenderAllocation.payments;
      const paidAmount = tenderAllocation.appliedAmount;
      // INV-REST-COD-UNPAID-POST-TRUTH (T12-H1, D-T12-H1): an
      // explicit-'cod' delivery carrying a declared cash leg that
      // covers the FULL total is REFUSED, never silently stripped —
      // a declared cash leg is money the cashier says is in hand,
      // while COD means the courier collects it at the door; both
      // cannot be true. The refusal fires only on the genuine
      // contradiction (paid in full): a PARTIAL cash leg posts
      // exactly as typed (cash in hand now, remainder COD — see
      // restaurant-paid-gates.spec.ts test 19), and the T11-D
      // absent-status strip above stays as-is. The frontend gate
      // fix makes the normal COD path send no cash leg at all, so
      // this backstop fires only on a stale or foreign caller. The
      // specific code + message reach the cashier verbatim through
      // getSubmitSaleErrorMessage (pos-submit-error.ts). T13-N1
      // (INV-REST-COD-DELIVERY-ONLY): delivery-only — the
      // contradiction exists only when a courier collects at the
      // door; a takeaway/dine-in sale carrying a stray 'cod' status
      // posts its cash leg normally. The message names the آجل path
      // explicitly: the old "غيّر حالة التحصيل" invited a status
      // change that then blocked the 0-cash attempt (Trial 5, J2).
      const hasDeclaredCashLeg = normalized.payments.some(
        (entry) => entry.paymentChannel === 'cash' && Number(entry.amount || 0) > 0,
      );
      if (String(normalized.orderType || '').trim() === 'delivery' && rawCollectionStatusForTender === 'cod' && hasDeclaredCashLeg && paidAmount + 0.0001 >= collectibleTotal) {
        throw new AppError(
          'الدليفري بنظام الدفع عند الاستلام لا يقبل مبلغًا نقديًا يغطي الإجمالي كاملًا: النقد المعلن يعني أن المبلغ في الخزينة، بينما COD يعني أن المندوب سيحصّله عند التسليم. صحّح المبلغ النقدي أو حوّل العملية إلى آجل صراحةً.',
          'SALE_COD_CASH_LEG_CONTRADICTION',
          400,
        );
      }
      const remainingDebt = roundMoney(Math.max(0, collectibleTotal - paidAmount), moneyDigits);
      const isDelivery = String(normalized.orderType || '').trim() === 'delivery';

      if (remainingDebt > 0 && (customer || !isDelivery)) {
        if (!customer) throw new AppError('الدين المتبقي يتطلب عميلاً مسجلاً', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
        if (customer.is_credit_blocked) {
          throw new AppError(
            `تم تعليق البيع الآجل لهذا العميل بقرار تحصيل: ${customer.credit_block_reason || 'متأخرات غير مسددة'}`,
            'CUSTOMER_CREDIT_BLOCKED',
            400,
          );
        }
        const nextBalance = Number(customer.balance || 0) + remainingDebt;
        if (Number(customer.credit_limit || 0) > 0 && nextBalance > Number(customer.credit_limit || 0) + 0.001) {
          throw new AppError(
            formatCreditLimitExceededMessage({
              creditLimit: Number(customer.credit_limit || 0),
              currentBalance: Number(customer.balance || 0),
              requestedAmount: remainingDebt,
              digits: moneyDigits,
            }),
            'CUSTOMER_CREDIT_LIMIT',
            400,
          );
        }
      }

      if (normalized.storeCreditUsed > 0) {
        if (!customer) throw new AppError('Store credit requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
        if (normalized.storeCreditUsed > Number(customer.store_credit_balance || 0) + 0.0001) {
          throw new AppError('Store credit exceeds available balance', 'STORE_CREDIT_EXCEEDED', 400);
        }
      }
      let deliveryRepId: number | null = null;
      let deliveryStatus: string | null = null;
      let collectionStatus: string | null = null;
      let resolvedDeliveryFeeMode: 'freelance_courier' | 'store_fleet' = (payload as any).deliveryFeeMode === 'store_fleet' ? 'store_fleet' : ((payload as any).deliveryFeeMode === 'freelance_courier' ? 'freelance_courier' : (null as any));

      if (isDelivery) {
        const rawRepId = (payload as any).deliveryRepId;
        const parsedRepId = rawRepId ? Number(rawRepId) : 0;
        const rawCollectionStatus = (payload as any).collectionStatus;
        const isCod = rawCollectionStatus === 'cod' || (!rawCollectionStatus && paidAmount + 0.0001 < collectibleTotal);

        if (isCod && (!parsedRepId || Number.isNaN(parsedRepId) || parsedRepId <= 0)) {
          throw new AppError('يجب اختيار مندوب التوصيل لطلبات الدليفري لتسجيل عهدة التحصيل عليه', 'DELIVERY_REP_REQUIRED', 400);
        }

        if (parsedRepId && !Number.isNaN(parsedRepId) && parsedRepId > 0) {
          const rep = await trx
            .selectFrom('delivery_representatives')
            .select(['id', 'name', 'rep_type', 'is_active'])
            .where('id', '=', parsedRepId)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
          if (!rep) {
            throw new AppError('مندوب التوصيل المختار غير موجود', 'DELIVERY_REP_NOT_FOUND', 400);
          }
          if (rep.is_active === false) {
            throw new AppError('مندوب التوصيل المختار غير نشط', 'DELIVERY_REP_INACTIVE', 400);
          }
          deliveryRepId = parsedRepId;
          if (!resolvedDeliveryFeeMode && rep.rep_type === 'store_fleet') {
            resolvedDeliveryFeeMode = 'store_fleet';
          }
        }

        deliveryStatus = (payload as any).deliveryStatus || 'pending';
        const hasUnpaidAmount = paidAmount + 0.0001 < collectibleTotal;
        if (rawCollectionStatus && !['cod', 'prepaid_by_rep', 'prepaid_online'].includes(rawCollectionStatus)) {
          throw new AppError('حالة تحصيل الدليفري غير صالحة', 'DELIVERY_COLLECTION_STATUS_INVALID', 400);
        }
        // INV-REST-COD-COLLECTION-TRUTH (T11-D, D-T11-1): the
        // courier inference above already withheld the cash legs, so
        // a courier delivery with no stated status lands here unpaid
        // — it is COD, never prepaid_online, even when the tender
        // arrived fully paid in cash. An online-channel tender keeps
        // prepaid_online (see the inference above).
        // INV-REP-COD-CASH-CHANNEL (M11, C6, PD4): the same rule
        // extends to a delivery with NO rep — a fully-paid tender
        // carrying a declared cash leg and no online-channel leg
        // is cash in hand, not an online payment, so it is COD,
        // never prepaid_online: no order without a gateway receipt
        // is treated as an online payment. A card-only tender keeps
        // the old fallback (bank money with a terminal trail,
        // outside the decided cash scope), and an online-channel
        // leg still proves prepaid_online. The rep-required gate
        // above is untouched: this shape is fully paid, so it never
        // trips it, and the sale posts with collection_status 'cod'
        // and its cash leg intact (postSale still debits 1110 from
        // the legs; the drawer treats COD cash as out for delivery,
        // exactly as for an explicit COD with a declared cash leg).
        // It also stops the phantom courier-fee cash_out below: with
        // no rep there is no courier to pay from the drawer.
        collectionStatus = rawCollectionStatus
          || (inferCodFromCourier ? 'cod' : (hasUnpaidAmount ? 'cod' : ((hasDeclaredCashLeg && !hasOnlineChannelTender) ? 'cod' : 'prepaid_online')));
      }

      const isCodDelivery = isDelivery && (collectionStatus === 'cod' || collectionStatus === 'pending' || paidAmount + 0.0001 < collectibleTotal);
      // INV-REST-PAID-GATES-2 (R4-D, I28, D-R4D-1/D-R4D-4): no silent
      // flip for POS sales — an underpaid cash sale with a customer is
      // rejected by the INVALID_PAID_AMOUNT throw below instead of
      // being reclassified as credit. Non-POS conversions keep the old
      // flip (deposit-carrying and guest COD conversions).
      const isPartialCredit = normalized.source !== 'pos' && Boolean(normalized.customerId) && paidAmount + 0.0001 < collectibleTotal;
      const effectivePaymentType = (isPartialCredit || normalized.paymentType === 'credit') ? 'credit' : 'cash';
      if (effectivePaymentType !== 'credit' && !isCodDelivery && paidAmount + 0.0001 < collectibleTotal) {
        throw new AppError('Paid amount cannot be less than invoice total', 'INVALID_PAID_AMOUNT', 400);
      }
      // INV-REST-PAID-GATES-2 (R4-D): POS-only submit gates — zero
      // total, dine-in without a table, unpaid remainder without a
      // customer (the COD hole: the :1631 block above still exempts
      // deliveries, so this is the enforcement point for POS), and
      // the terminal-approved-amount pin. Runs on the allocated legs,
      // so the pinned card leg is the one that posts. Non-POS sources
      // return early inside the helper.
      assertPosSubmitGates({
        source: normalized.source,
        customerId: normalized.customerId,
        paidAmount,
        collectibleTotal,
        total,
        orderType: normalized.orderType,
        collectionStatus,
        tableNumber: normalized.tableNumber,
        cardAmount: payments.find((entry) => entry.paymentChannel === 'card')?.amount ?? 0,
        terminalApprovedAmount: normalized.terminalApprovedAmount,
        terminalAuthCode: normalized.terminalAuthCode,
        discount: effectiveDiscount,
        subtotal,
      });

      const finalTenderedAmount = tenderAllocation.tenderedAmount;
      const changeAmount = tenderAllocation.changeAmount;

      if (!resolvedDeliveryFeeMode) {
        const deliveryFeeModeVal = settingsMap.get('deliveryFeeMode');
        if (deliveryFeeModeVal && String(deliveryFeeModeVal).includes('store_fleet')) {
          resolvedDeliveryFeeMode = 'store_fleet';
        } else {
          resolvedDeliveryFeeMode = 'freelance_courier';
        }
      }

      const offlineDocNo = String(payload.offlineDocNo || '').trim();
      // INV-REST-SHIFT-CLOSE-CONTROL (I26): an offline sale keeps
      // its ORIGINAL timestamp (savedAt) as created_at, so it lands
      // in the shift whose window actually held it instead of the
      // next shift's. An invalid timestamp rejects outright — never
      // silently clamped to sync time.
      const offlineCreatedAt = validateOfflineCreatedAt(payload.offlineCreatedAt);
      // INV-REST-SHIFT-CLOSE-CONTROL (I24): the POS station code,
      // stored on the sale so its cash attributes to its station's
      // shift. Read off the DTO directly: normalizeSalePayload
      // does not carry it, and this is the only read site.
      const posTerminalCode = String(payload.terminalCode || '').trim() || null;
      let saleNote = normalized.note;
      if (offlineDocNo && !saleNote.includes(offlineDocNo)) {
        const offlineTag = `[إيصال أوفلاين: ${offlineDocNo}]`;
        saleNote = saleNote ? `${saleNote} | ${offlineTag}` : offlineTag;
      }
      if (floorApproval) {
        saleNote = `${saleNote ? `${saleNote} | ` : ''}[اعتماد بيع تحت الحد: ${floorApproval.authorizedByName}; أصناف ${belowFloorItems.join(',')}]`;
      } else if (belowFloorItems.length) {
        saleNote = `${saleNote ? `${saleNote} | ` : ''}[بيع تحت الحد: أصناف ${belowFloorItems.join(',')}]`;
      }
      if (normalized.terminalAuthCode) {
        const terminalTag = `[تفويض شبكة: ${normalized.cardScheme || 'بطاقة'} | ${normalized.terminalAuthCode}${normalized.terminalRrn ? ` | مرجع: ${normalized.terminalRrn}` : ''}]`;
        saleNote = saleNote ? `${saleNote} | ${terminalTag}` : terminalTag;
      }

      const saleInsert = await trx
        .insertInto('sales')
        .values({
          customer_id: normalized.customerId,
          customer_name: customer?.name || 'عميل نقدي',
          customer_phone: payload.customerPhone || null,
          customer_address: payload.customerAddress || null,
          payment_type: effectivePaymentType,
          payment_channel: resolvePostedSalePaymentChannel(effectivePaymentType, payments),
          subtotal: roundMoney(subtotal, moneyDigits),
          discount: effectiveDiscount,
          delivery_fee: normalized.deliveryFee,
          delivery_fee_mode: resolvedDeliveryFeeMode,
          tax_rate: normalized.taxRate,
          tax_amount: taxAmount,
          prices_include_tax: normalized.pricesIncludeTax,
          total,
          paid_amount: paidAmount,
          applied_amount: paidAmount,
          tendered_amount: finalTenderedAmount,
          change_amount: changeAmount,
          store_credit_used: normalized.storeCreditUsed,
          exchange_return_id: exchange?.returnId ?? null,
          status: 'posted',
          note: saleNote,
          branch_id: normalized.branchId,
          location_id: normalized.locationId,
          table_number: String(normalized.tableNumber || '').trim(),
          order_type: String(normalized.orderType || 'takeaway').trim(),
          dining_course: normalized.diningCourse || null,
          service_charge: normalized.serviceCharge || 0,
          tip_amount: Number((normalized as any).tipAmount || 0),
          guest_count: normalized.guestCount || 1,
          delivery_rep_id: deliveryRepId,
          delivery_status: deliveryStatus,
          collection_status: collectionStatus,
          created_by: auth.userId,
          cancel_reason: '',
          terminal_id: normalized.terminalId || null,
          terminal_auth_code: normalized.terminalAuthCode || null,
          terminal_rrn: normalized.terminalRrn || null,
          card_scheme: normalized.cardScheme || null,
          card_last_four: normalized.cardLastFour || null,
          pager_number: normalized.pagerNumber || null,
          // INV-REST-SHIFT-CLOSE-CONTROL (I24/I26): the station
          // code for shift attribution, and the offline sale's
          // original timestamp (only when the client sent a valid
          // one — otherwise the column default NOW() applies).
          pos_terminal_code: posTerminalCode,
          ...(offlineCreatedAt ? { created_at: offlineCreatedAt.toISOString() } : {}),
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const id = Number(saleInsert.id);
      if (exchange) {
        const linkedReturn = await trx.updateTable('return_documents').set({ exchange_sale_id: id })
          .where('tenant_id', '=', scope.tenantId).where('id', '=', exchange.returnId)
          .where('exchange_sale_id', 'is', null).returning('id').executeTakeFirst();
        if (!linkedReturn) throw new AppError('تعذر ربط طرفَي الاستبدال', 'EXCHANGE_LINK_FAILED', 409);
      }
      const docNo = await this.generateSaleDocNo(trx, id, scope.tenantId);
      await trx.updateTable('sales').set({ doc_no: docNo, updated_at: sql`NOW()` }).where('id', '=', id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();

      if (payments.length > 0) {
        await trx.insertInto('sale_payments').values(
          payments.map((payment) => ({
            sale_id: id,
            payment_channel: payment.paymentChannel,
            amount: payment.amount,
            applied_amount: payment.amount,
            tendered_amount: payment.tenderedAmount,
            change_amount: payment.changeAmount,
            terminal_id: payment.paymentChannel === 'card' ? (normalized.terminalId || null) : null,
            card_auth_code: payment.paymentChannel === 'card' ? (normalized.terminalAuthCode || null) : null,
            card_rrn: payment.paymentChannel === 'card' ? (normalized.terminalRrn || null) : null,
            card_scheme: payment.paymentChannel === 'card' ? (normalized.cardScheme || null) : null,
            card_last_four: payment.paymentChannel === 'card' ? (normalized.cardLastFour || null) : null,
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          }))
        ).execute();
      }

      if (normalized.terminalAuthCode) {
        await trx.insertInto('pos_audit_events').values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          event_type: 'terminal_payment_approved',
          user_id: auth.userId,
          sale_id: id,
          product_id: null,
          amount: payments.find((p) => p.paymentChannel === 'card')?.amount || total,
          reason: `تفويض دفع إلكتروني ناجح من جهاز ${normalized.terminalId || 'EDC'} (${normalized.cardScheme || 'بطاقة'})`,
          metadata: JSON.stringify({
            terminalId: normalized.terminalId,
            authCode: normalized.terminalAuthCode,
            rrn: normalized.terminalRrn,
            cardScheme: normalized.cardScheme,
            cardLastFour: normalized.cardLastFour,
          }),
        }).execute();
      }

      await this.lockSaleStockRows(trx, scope, preparedItems);
      await this.autoProduceShortfall(trx, autoProduceItems, id, normalized.branchId, normalized.locationId, scope, auth);
      await this.resolveSaleModifierCosts(trx, preparedItems, scope.tenantId,
        this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant'),
        // SF-3 D-SF-03: an online order costs its frozen modifiers the
        // same way it prices them; a walk-in sale passes none.
        effectiveTerms?.approvedModifierPrices);

      // Deadlock prevention: stock rows (products + product_location_stock) must always be
      // locked in a deterministic global order. Client-supplied item order is arbitrary, so two
      // concurrent sales carrying the same products in opposite order would deadlock (SQLSTATE 40P01).
      // Sorting by productId enforces one canonical lock order across all concurrent transactions.
      // R8-A INV-REST-FLAT-ADDON-COSTING: flat addons carry no stock —
      // the deduction loop below must skip them entirely (no lock, no
      // movement, no allocation). Cost without stock.
      const flatAddonCosts = await this.loadFlatAddonCosts(trx, scope.tenantId, preparedItems);
      const stockOrderedItems = [...preparedItems].sort((a, b) => Number(a.productId || 0) - Number(b.productId || 0));

      for (const item of stockOrderedItems) {
        const itemSerials = Array.isArray(item.serials) ? item.serials : [];
        const insertedLine = await trx
          .insertInto('sale_items')
          .values({
            sale_id: id,
            product_id: item.productId,
            product_name: item.productName,
            product_name_en: item.productNameEn || null,
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
            notes: item.notes,
            modifiers: (item.originalPrice || item.offerDiscount || item.offerName)
              ? JSON.stringify({
                  mods: Array.isArray(item.modifiers) ? item.modifiers : [],
                  offer: {
                    originalPrice: item.originalPrice,
                    offerDiscount: item.offerDiscount,
                    offerName: item.offerName,
                  },
                })
              : (item.modifiers ? JSON.stringify(item.modifiers) : '[]'),
            serials: itemSerials.length > 0 ? JSON.stringify(itemSerials) : '[]',
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          } as any)
          .returning('id')
          .executeTakeFirstOrThrow();
        const saleLineId = Number(insertedLine.id);

        const claimedSerials = await this.claimSaleSerials(trx, item, id, saleLineId, scope.tenantId);
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
          
          await trx
            .insertInto('stock_movements')
            .values({
              product_id: item.productId,
              movement_type: 'sale',
              qty: -alloc.qty,
              before_qty: stockChange.scopeBefore,
              after_qty: stockChange.scopeAfter,
              reason: 'sale',
              note: `Sale S-${id}`,
              reference_type: 'sale',
              reference_id: id,
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
             sale_id: id,
             sale_line_id: saleLineId,
             product_id: item.productId,
             location_id: alloc.locationId as number,
             quantity: alloc.qty,
             allocation_order: allocationOrder++,
          }).execute();
        }

        await this.deductPharmacyBatchesFefo(trx, item.productId, allocations, scope, id, saleLineId);
        for (const alloc of allocations) {
          const lotAllocation = await allocateSaleFromImportLots(trx, {
            tenantId: scope.tenantId,
            saleId: id,
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
          await this.recordImportLotShortfalls(trx, scope, id, saleLineId, lotAllocation, auth);
        }

        if (item.modifiers && Array.isArray(item.modifiers) && this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant')) {
          for (const mod of item.modifiers) {
            const rawModProductId = Number(mod.productId || 0);
            const consumptionRate = Number(mod.consumptionQty || 1);

            // R8-A: a flat addon (no optionId, productId is an addons
            // row) has no stock to deduct — skip the whole loop body.
            const isFlatAddon = rawModProductId > 0
              && !Number(mod.optionId || mod.option_id || mod.id || 0)
              && flatAddonCosts.has(rawModProductId);
            if (rawModProductId > 0 && !isFlatAddon) {
              const modifierQty = Number((Number(mod.qty || 1) * Number(item.qty || 1) * consumptionRate).toFixed(3));
              
              let modRemainingQty = modifierQty;
              let modAllocationOrder = 1;
              const modAllocations = [];

              // Same canonical lock order as the parent item (products -> product_location_stock).
              await this.lockProductRow(trx, rawModProductId, scope);

              // INV-FLOATING-POOL-ALLOCATION-LEG: same assigned-first,
              // pool-last leg computation as the parent item (see
              // computeSaleAllocationLegs in sales-write.helper.ts).
              const modLocationAvailabilities: Array<{ locationId: number | null; branchId: number | null; availableQty: number }> = [];
              for (const loc of eligibleLocations) {
                const locStock = await trx.selectFrom('product_location_stock')
                  .select(['qty', 'reserved_qty'])
                  .where('product_id', '=', rawModProductId)
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
                  .where('product_id', '=', rawModProductId)
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
                  productId: rawModProductId,
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
                    product_id: rawModProductId,
                    movement_type: 'sale',
                    qty: -alloc.qty,
                    before_qty: modStockChange.scopeBefore,
                    after_qty: modStockChange.scopeAfter,
                    reason: 'sale_modifier',
                    note: `Sale S-${id} (${item.productName})`,
                    reference_type: 'sale',
                    reference_id: id,
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
                   sale_id: id,
                   sale_line_id: saleLineId,
                   product_id: rawModProductId,
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
        await trx
          .updateTable('customers')
          .set({ store_credit_balance: calculateStoreCreditBalance(Number(customer.store_credit_balance || 0), -normalized.storeCreditUsed, moneyDigits), updated_at: sql`NOW()` })
          .where('id', '=', customer.id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();
      }

      if (normalized.loyaltyPointsRedeemed > 0 && customer) {
        await trx
          .updateTable('customers')
          .set({ loyalty_points: pointsAfterRedeem, updated_at: sql`NOW()` } as any)
          .where('id', '=', customer.id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();

        await trx
          .insertInto('customer_loyalty_logs')
          .values({
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
            customer_id: customer.id,
            points_change: -normalized.loyaltyPointsRedeemed,
            balance_after: pointsAfterRedeem,
            action_type: 'redeem',
            sale_id: id,
            notes: `استبدال ${normalized.loyaltyPointsRedeemed} نقطة بخصم ${loyaltyDiscount} ج.م في الفاتورة S-${id}`,
            created_at: sql`NOW()`,
          } as any)
          .execute();
      }

      // Automatically award loyalty points based on paid amount
      if (customer && paidAmount > 0 && loyaltyEnabled && pointsPer100Egp > 0) {
        const pointsEarned = Math.floor((paidAmount / 100) * pointsPer100Egp);
        if (pointsEarned > 0) {
          const startingPoints = normalized.loyaltyPointsRedeemed > 0 ? pointsAfterRedeem : Number((customer as any)?.loyalty_points || 0);
          const finalPoints = Number((startingPoints + pointsEarned).toFixed(2));

          await trx
            .updateTable('customers')
            .set({ loyalty_points: finalPoints, updated_at: sql`NOW()` } as any)
            .where('id', '=', customer.id)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .execute();

          await trx
            .insertInto('customer_loyalty_logs')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              customer_id: customer.id,
              points_change: pointsEarned,
              balance_after: finalPoints,
              action_type: 'earn',
              sale_id: id,
              notes: `اكتساب ${pointsEarned} نقطة من مشتريات الفاتورة S-${id} (بمعدل ${pointsPer100Egp} نقطة لكل 100 ج.م)`,
              created_at: sql`NOW()`,
            } as any)
            .execute();
        }
      }

      if (customer && remainingDebt > 0) {
        await this.finance.createCustomerLedgerEntry(
          trx,
          customer.id,
          remainingDebt,
          `فاتورة بيع S-${id}${paidAmount > 0 ? ' (متبقي آجل)' : ''}`,
          id,
          auth,
        );
      } else if (customer && remainingDebt === 0) {
        // INV-CUSTOMER-SUPPLIER-STATEMENTS: a fully-settled sale used to
        // write no customer-ledger row at all, so the invoice (and a
        // later return of it) vanished from the customer statement even
        // though the final balance was right. Post the charge and its
        // settlement as a pair netting to zero, so the document stays
        // visible while the balance stays exactly unchanged. The pair
        // must not go through createCustomerLedgerEntry: its limit gate
        // would block a settled sale for a customer near the limit.
        // 'sale_paid' (not 'sale_credit') keeps the van split-sale and
        // trip-counter readers, which take the latest 'sale_credit'
        // row as the unpaid portion, from mistaking this charge for
        // a debt.
        const settled = roundMoney(collectibleTotal - remainingDebt, moneyDigits);
        if (settled > 0) {
          await this.finance.addCustomerLedgerLeg(trx, customer.id, settled, 'sale_paid', `فاتورة بيع S-${id}`, 'sale', id, auth);
          await this.finance.addCustomerPaymentLedgerEntry(trx, customer.id, -settled, `سداد فاتورة بيع S-${id}`, 'sale', id, auth, normalized.branchId, normalized.locationId);
        }
      }

      if (!isCodDelivery) {
        for (const payment of payments) {
          if (payment.paymentChannel !== 'cash') continue;
          await this.finance.addTreasuryTransaction(
            trx,
            payment.amount,
            `فاتورة بيع S-${id} - نقدي`,
            id,
            auth,
            normalized.branchId,
            normalized.locationId,
          );
        }

        // When a delivery order with a freelance courier is fully prepaid online (prepaid_online),
        // the courier takes their delivery fee in cash directly from the active cash drawer.
        // Auto-record a cash_out treasury transaction so the cashier's expected cash in drawer decreases accurately.
        if (
          isDelivery &&
          resolvedDeliveryFeeMode === 'freelance_courier' &&
          normalized.deliveryFee > 0
        ) {
          // Only eligible when customer prepaid online in full (never for credit/COD)



          const isElectronicPaidInFull =
            payments.length > 0 &&
            payments.every((p) => p.paymentChannel === 'wallet' || p.paymentChannel === 'instapay') &&
            paidAmount + 0.0001 >= collectibleTotal;

          const isEligiblePrepaidOnlineDelivery =
            (collectionStatus === 'prepaid_online' || isElectronicPaidInFull) &&
            effectivePaymentType !== 'credit' &&
            collectionStatus !== 'cod' &&
            paidAmount + 0.0001 >= collectibleTotal;
          if (collectionStatus !== 'prepaid_by_rep' && isEligiblePrepaidOnlineDelivery) {
            const openShift = await trx
              .selectFrom('cashier_shifts')
              .select(['id', 'branch_id', 'location_id'])
              .where('opened_by', '=', auth.userId)
              .where('status', '=', 'open')
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .orderBy('id', 'desc')
              .executeTakeFirst();

            if (openShift) {
              const repRow = deliveryRepId
                ? await trx
                    .selectFrom('delivery_representatives')
                    .select(['name'])
                    .where('id', '=', Number(deliveryRepId))
                    .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
                    .executeTakeFirst()
                : null;
              const repLabel = repRow?.name ? repRow.name : `مندوب #${deliveryRepId || ''}`;

              await trx
                .insertInto('treasury_transactions')
                .values({
                  txn_type: 'cash_out',
                  amount: -Math.abs(normalized.deliveryFee),
                  note: `صرف أجرة توصيل نقداً للمندوب ${repLabel} عن فاتورة #${docNo || id}`,
                  reference_type: 'cashier_shift',
                  reference_id: openShift.id,
                  branch_id: normalized.branchId || openShift.branch_id,
                  location_id: normalized.locationId || openShift.location_id,
                  created_by: auth.userId,
                  tenant_id: scope.tenantId,
                  account_id: scope.accountId,
                } as any)
                .execute();

              // R8-A (M12): no stored expected_cash update here — the
              // live recompute (computeShiftCashDrawerMovements) already
              // nets this treasury leg for open shifts, and the close
              // path recomputes and overwrites; writing it here
              // subtracted the fee twice, and hr.service reads the
              // stored value as a fallback. The treasury leg above is
              // the record of the payout.
            }
          }
        }
      }

      // A journal failure must roll back stock, tenders and the invoice together.
      await this.accountingPosting.postSale(trx, id, auth);
      await this.accountingPosting.clearPostingFailure(trx, scope, 'sale', id);

      // Commit idempotency record atomically inside the business transaction
      if (idemCtx?.idempotencyKey && idemCtx?.operationType) {
        await this.idempotency.commitOperation(
          trx,
          { tenantId: scope.tenantId, accountId: scope.accountId, idempotencyKey: idemCtx.idempotencyKey, operationType: idemCtx.operationType },
          { ok: true, saleId: id },
          String(id)
        );
      }

      if (onlineOrderToRelease) {
        await trx
          .updateTable('online_orders')
          .set({
            sale_id: id,
            stock_reserved: false,
            status: normalized.orderType === 'delivery' ? 'shipped' : 'delivered',
            updated_at: new Date(),
          })
          .where('id', '=', onlineOrderToRelease.id)
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();

        if (onlineOrderToRelease.kitchen_draft_sale_id) {
          const draftSaleId = Number(onlineOrderToRelease.kitchen_draft_sale_id);
          if (draftSaleId && draftSaleId !== id) {
            // R4-E I17: move the kitchen ticket's progress BEFORE the draft
            // rows are deleted — the pointer is nulled below, so any later
            // transfer (retireKitchenDraft) would find nothing to move.
            // Trx-aware on purpose: the public transfer opens its own
            // transaction, which would nest inside this one.
            await this.transferKdsTicketStateInTrx(trx, scope.tenantId, draftSaleId, id);
            await trx
              .deleteFrom('sale_items')
              .where('sale_id', '=', draftSaleId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();
            await trx
              .deleteFrom('sales')
              .where('id', '=', draftSaleId)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .where('status', '=', 'draft')
              .execute();
            await trx
              .updateTable('online_orders')
              .set({ kitchen_draft_sale_id: null, updated_at: new Date() })
              .where('id', '=', onlineOrderToRelease.id)
              .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
              .execute();
          }
        }
      }

      // INV-REST-SHIFT-CLOSE-CONTROL (I26): a backdated offline
      // sale may belong to a shift that already closed. Correct
      // that shift's stored figures now, inside this transaction,
      // so the close record reflects the sale that actually
      // happened inside its window. A no-op when no closed shift
      // contains the timestamp.
      if (offlineCreatedAt) {
        await this.refreshClosedShiftsForBackdatedOfflineSale(
          trx, offlineCreatedAt, id, normalized.branchId, normalized.locationId, auth, scope.tenantId,
        );
      }

      return id;
    });
    const transactionDurationMs = Date.now() - txStartedAt;

    const postReadsStartedAt = Date.now();
    await this.audit.log('إنشاء فاتورة بيع', `تم إنشاء الفاتورة S-${saleId} بواسطة ${auth.username}`, auth);

    // Non-blocking auto WhatsApp invoice notification
    if (this.whatsappService) {
      void this.whatsappService.sendInvoiceNotification(saleId, auth, { autoOnly: true }).catch((err) => {
        this.logger.warn(`WhatsApp auto-invoice notification failed for sale ${saleId}: ${err?.message || err}`);
      });
    }

    const sale = await this.query.getSaleById(saleId, auth);
    const postTransactionReadsDurationMs = Date.now() - postReadsStartedAt;
    const totalRequestDurationMs = Date.now() - requestStartedAt;

    if (this.shouldLogCheckoutTimings()) {
      this.logger.log(
        `[checkout-timing] saleId=${saleId} items=${normalized.items.length} txMs=${transactionDurationMs} postReadsMs=${postTransactionReadsDurationMs} totalMs=${totalRequestDurationMs}`,
      );
    }

    return { ok: true, sale: sale.sale };
  }

  async updateSale(saleId: number, payload: UpsertSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.editAndCancel().updateSale(saleId, payload, auth);
  }

  private async refreshClosedShiftsForBackdatedOfflineSale(
    trx: Kysely<Database> | Transaction<Database>,
    offlineCreatedAt: Date,
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    tenantId: string,
  ): Promise<void> {
    return this.editAndCancel().refreshClosedShiftsForBackdatedOfflineSale(trx, offlineCreatedAt, saleId, branchId, locationId, auth, tenantId);
  }

  async cancelSale(saleId: number, reason: string, managerPin: string, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.editAndCancel().cancelSale(saleId, reason, managerPin, auth);
  }

  async saveHeldSale(payload: HeldSaleDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const heldSaleId = await this.tx.runInTransaction(this.db, async (trx) => {
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const items = (Array.isArray(payload.items) ? payload.items : [])
        .map((item) => ({
          productId: Number(item.productId || 0),
          productName: String(item.name || '').trim(),
          qty: Number(item.qty || 0),
          unitPrice: Number(item.price || 0),
          unitName: String(item.unitName || 'قطعة').trim() || 'قطعة',
          unitMultiplier: Number(item.unitMultiplier || 1) || 1,
          priceType: (item.priceType === 'wholesale' ? 'wholesale' : 'retail') as 'retail' | 'wholesale',
          notes: String(item.notes || '').trim(),
          modifiers: item.modifiers || [],
          seatNumber: item.seatNumber ? Number(item.seatNumber) : undefined,
          course: item.course ? String(item.course).trim() : undefined,
          /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the item fields the old
           * hold dropped. They ride in the modifiers JSON envelope. */
          lineKey: item.lineKey ? String(item.lineKey) : undefined,
          unitId: item.unitId ? String(item.unitId) : undefined,
          serials: Array.isArray(item.serials) ? item.serials.map((entry) => String(entry)) : undefined,
          originalPrice: item.originalPrice != null ? Number(item.originalPrice) : undefined,
          offerDiscount: item.offerDiscount != null ? Number(item.offerDiscount) : undefined,
          /* INV-POS-LINE-DISCOUNT: the per-line discount rides the same
           * R5-B envelope as offerDiscount — a held line keeps its own
           * discount, so recall + submit posts the price the cashier
           * agreed instead of silently re-adding it. */
          lineDiscount: item.lineDiscount != null ? Number(item.lineDiscount) : undefined,
          offerName: item.offerName ? String(item.offerName) : undefined,
          isWeighted: item.isWeighted != null ? Boolean(item.isWeighted) : undefined,
          quantityChunks: Array.isArray(item.quantityChunks) ? item.quantityChunks.map((entry) => Number(entry)) : undefined,
        }))
        .filter((entry) => entry.productId > 0 && entry.qty > 0);

      if (!items.length) throw new AppError('Held draft must include at least one item', 'HELD_DRAFT_ITEMS_REQUIRED', 400);
      /* INV-POS-LINE-DISCOUNT: the hold gate counts line discounts
       * exactly like createSale does — holding a discounted draft is
       * granting the discount, not deferring it. */
      const heldLineDiscountTotal = roundMoney(items.reduce((sum, item) => sum + Number((item as { lineDiscount?: number }).lineDiscount || 0), 0), moneyDigits);
      await this.assertDiscountChangeAllowed(trx, auth, roundMoney(Number(payload.discount || 0) + heldLineDiscountTotal, moneyDigits), payload.managerPin);

      for (const item of items) {
        let finalProductName = item.productName;
        const product = await trx.selectFrom('products as p')
          .leftJoin('manufacturing_boms as b', (join) => join.onRef('b.product_id', '=', 'p.id').on('b.is_active', '=', true))
          .select(['p.id', 'p.retail_price', 'p.wholesale_price', 'b.id as bom_id'])
          .where('p.id', '=', item.productId)
          .where(sql<boolean>`p.tenant_id = ${scope.tenantId}`)
          .where('p.is_active', '=', true)
          .executeTakeFirst();
        
        if (!product) throw new AppError(`Product #${item.productId} not found`, 'PRODUCT_NOT_FOUND', 404);

        if (product.bom_id) {
          const bomLines = await trx.selectFrom('manufacturing_bom_lines as l')
            .innerJoin('products as p', 'p.id', 'l.component_product_id')
            .select('p.name')
            .where('l.bom_id', '=', Number(product.bom_id))
            .execute();
          
          if (bomLines.length > 0) {
            finalProductName = `${item.productName} (${bomLines.map(l => l.name).join(' + ')})`;
          }
        }
        item.productName = finalProductName;

        const activeOffers = await this.getCurrentProductOffers(trx, item.productId, scope.tenantId);
        const allowedUnitPrice = calculateAllowedSaleUnitPrice({
          retailPrice: product.retail_price,
          wholesalePrice: product.wholesale_price,
          priceType: item.priceType,
          offers: activeOffers,
          qty: item.qty,
          moneyDigits,
        });
        await this.assertUnitPriceChangeAllowed(trx, auth, item.unitPrice, allowedUnitPrice, item.productId, payload.managerPin);
      }

      type SalePaymentChannel = 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit';
      const rawRequestedChannel = String(payload.paymentChannel || '').trim();
      const requestedChannel: SalePaymentChannel | '' = (['cash', 'card', 'wallet', 'instapay', 'mixed', 'credit'] as const)
        .includes(rawRequestedChannel as SalePaymentChannel)
        ? (rawRequestedChannel as SalePaymentChannel)
        : '';
      const paymentType = payload.paymentType === 'credit' ? 'credit' : 'cash';
      const cashAmount = paymentType === 'credit' ? 0 : Math.max(0, Number(payload.cashAmount || 0));
      const cardAmount = paymentType === 'credit' ? 0 : Math.max(0, Number(payload.cardAmount || 0));
      const transferAmount = paymentType === 'credit' ? 0 : Math.max(0, Number(payload.transferAmount || 0));
      const paidAmount = paymentType === 'credit'
        ? 0
        : roundMoney(cashAmount + cardAmount + transferAmount, moneyDigits);

      const paymentChannel: 'cash' | 'card' | 'wallet' | 'instapay' | 'mixed' | 'credit' = paymentType === 'credit'
        ? 'credit'
        : (() => {
          if (requestedChannel === 'wallet' || requestedChannel === 'instapay') return requestedChannel;
          const hasCash = cashAmount > 0.0001;
          const hasCard = cardAmount > 0.0001;
          const hasTransfer = transferAmount > 0.0001;

          if ((hasCash && hasCard) || (hasCash && hasTransfer) || (hasCard && hasTransfer)) return 'mixed';
          if (hasCard) return 'card';
          if (hasTransfer) return 'wallet';
          if (requestedChannel === 'card') return 'card';
          return 'cash';
        })();

      const heldTableNumber = String(payload.tableNumber || '').trim();
      // INV-REST-PAID-GATES-2 (R4-D, I42): one open held draft per
      // table. A held row IS the open draft (recall/complete deletes
      // it), so an existing row for the same tenant + table blocks a
      // second hold. The branch is matched when the payload names
      // one; without a branch any open draft on that table blocks.
      if (heldTableNumber) {
        let occupantQuery = trx
          .selectFrom('held_sales')
          .select('id')
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('table_number', '=', heldTableNumber);
        if (payload.branchId) {
          occupantQuery = occupantQuery.where('branch_id', '=', Number(payload.branchId));
        }
        const occupant = await occupantQuery.executeTakeFirst();
        if (occupant) {
          throw new AppError(`الطاولة ${heldTableNumber} مشغولة بالفعل بطلب محفوظ.`, 'HELD_DRAFT_TABLE_OCCUPIED', 409);
        }
      }

      const heldInsert = await trx
        .insertInto('held_sales')
        .values({
          customer_id: payload.customerId ? Number(payload.customerId) : null,
          payment_type: paymentType,
          payment_channel: paymentChannel,
          paid_amount: paidAmount,
          cash_amount: cashAmount,
          card_amount: cardAmount,
          discount: Number(payload.discount || 0),
          delivery_fee: Number(payload.deliveryFee || 0),
          note: String(payload.note || '').trim(),
          search: String(payload.search || '').trim(),
          table_number: String(payload.tableNumber || '').trim(),
          order_type: String(payload.orderType || 'takeaway').trim(),
          price_type: payload.priceType === 'wholesale' ? 'wholesale' : 'retail',
          branch_id: payload.branchId ? Number(payload.branchId) : null,
          location_id: payload.locationId ? Number(payload.locationId) : null,
          delivery_rep_id: (payload as any).deliveryRepId ? Number((payload as any).deliveryRepId) : null,
          /* INV-REST-HOLD-RECALL-TRUTH (R5-B): persist the stated
           * collection status whenever the hold names one — the old code
           * stored it only when a rep was set, so a prepaid_online order
           * with no rep yet came back as COD. */
          collection_status: (payload as any).collectionStatus ? String((payload as any).collectionStatus) : null,
          /* INV-REST-HOLD-RECALL-TRUTH (R5-B, 0310 columns): the header
           * fields the old hold dropped. */
          tip_amount: Number(payload.tipAmount || 0),
          loyalty_points_redeemed: Number(payload.loyaltyPointsRedeemed || 0),
          pager_number: payload.pagerNumber ? String(payload.pagerNumber).trim() : null,
          delivery_fee_mode: payload.deliveryFeeMode ? String(payload.deliveryFeeMode) : null,
          online_order_id: payload.onlineOrderId ? Number(payload.onlineOrderId) : null,
          dining_course: payload.diningCourse ? String(payload.diningCourse).trim() : null,
          guest_count: payload.guestCount != null ? Number(payload.guestCount) : null,
          guest_check_printed_at: payload.guestCheckPrintedAt ? String(payload.guestCheckPrintedAt) : null,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const id = Number(heldInsert.id);
      for (const item of items) {
        const itemModifiers = item.modifiers || [];
        /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the held line fields ride in
         * the existing modifiers JSON envelope (the seat/course precedent
         * below) — no second migration. isWeighted:false and
         * offerDiscount:0 are real values, so presence is tested with
         * != null / length, never truthiness. */
        const heldMeta: Record<string, unknown> = {
          ...(item.lineKey ? { lineKey: item.lineKey } : {}),
          ...(item.unitId ? { unitId: item.unitId } : {}),
          ...(Array.isArray(item.serials) && item.serials.length ? { serials: item.serials } : {}),
          ...(item.originalPrice != null ? { originalPrice: item.originalPrice } : {}),
          ...(item.offerDiscount != null ? { offerDiscount: item.offerDiscount } : {}),
          ...(item.lineDiscount != null ? { lineDiscount: item.lineDiscount } : {}),
          ...(item.offerName ? { offerName: item.offerName } : {}),
          ...(item.isWeighted != null ? { isWeighted: item.isWeighted } : {}),
          ...(Array.isArray(item.quantityChunks) && item.quantityChunks.length ? { quantityChunks: item.quantityChunks } : {}),
        };
        const hasHeldMeta = Object.keys(heldMeta).length > 0;
        const hasExtraMeta = item.seatNumber != null || Boolean(item.course) || hasHeldMeta;
        const finalModifiers = hasExtraMeta
          ? {
              mods: Array.isArray(itemModifiers) ? itemModifiers : [],
              ...(item.seatNumber != null ? { seatNumber: item.seatNumber } : {}),
              ...(item.course ? { course: item.course } : {}),
              ...(hasHeldMeta ? { held: heldMeta } : {}),
            }
          : itemModifiers;

        await trx
          .insertInto('held_sale_items')
          .values({
            held_sale_id: id,
            product_id: item.productId,
            product_name: item.productName,
            qty: item.qty,
            unit_price: item.unitPrice,
            unit_name: item.unitName,
            unit_multiplier: item.unitMultiplier,
            price_type: item.priceType as 'retail' | 'wholesale',
            notes: item.notes || '',
            modifiers: JSON.stringify(finalModifiers),
            tenant_id: scope.tenantId,
            account_id: scope.accountId,
          } as any)
          .execute();
      }

      return id;
    });

    await this.audit.log('حفظ فاتورة معلقة', `تم حفظ فاتورة معلقة #${heldSaleId} بواسطة ${auth.username}`, auth);
    return { ok: true, heldSales: (await this.query.listHeldSales(auth)).heldSales };
  }

  async deleteHeldSale(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const heldSale = await this.db
      .selectFrom('held_sales')
      .select(['id', 'created_by'])
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    if (!heldSale || !this.authz.canAccessHeldSale(auth, heldSale)) {
      throw new AppError('Held sale not found', 'HELD_SALE_NOT_FOUND', 404);
    }

    await this.db.deleteFrom('held_sales').where('id', '=', id).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
    await this.audit.log('حذف فاتورة معلقة', `تم حذف فاتورة معلقة #${id} بواسطة ${auth.username}`, auth);
    return { ok: true, heldSales: (await this.query.listHeldSales(auth)).heldSales };
  }

  async clearHeldSales(auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const canManageHeldSales = this.authz.canManageHeldSales(auth);
    const ownerUserId = this.authz.heldSaleOwnerUserId(auth);
    const result = await this.db
      .deleteFrom('held_sales')
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .$if(!canManageHeldSales, (qb) => qb.where('created_by', '=', ownerUserId ?? -1))
      .execute();
    const deletedCount = Number(result?.[0]?.numDeletedRows ?? NaN);
    const scopeLabel = canManageHeldSales ? 'privileged broader management' : 'own held sales';
    const countLabel = Number.isFinite(deletedCount) ? ` | deletedCount=${deletedCount}` : '';
    await this.audit.log('حذف كل الفواتير المعلقة', `تم حذف كل الفواتير المعلقة بواسطة ${auth.username} | scope=${scopeLabel}${countLabel}`, auth);
    return { ok: true, heldSales: (await this.query.listHeldSales(auth)).heldSales };
  }

  private async generateSaleDocNo(trx: Kysely<Database>, saleId: number, tenantId: string): Promise<string> {
    const settingsMap = await this.getTenantSettingsMap(trx, tenantId);
    let scheme = settingsMap.get('invoiceNumberingScheme') || 'daily';
    if (typeof scheme !== 'string') {
      scheme = String(scheme || 'daily');
    }

    if (scheme === 'sequential') {
      return `Z-${saleId}`;
    }

    // Daily date-based numbering: Z-YYMMDD-0001
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;
    const seq = String(saleId).padStart(4, '0');
    return `Z-${datePrefix}-${seq}`;
  }
}
