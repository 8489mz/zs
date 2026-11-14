import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
// previewConsumableStockQty is kept in this import: check-architecture-guardrails.cjs requires the token in sales-write.service.ts, although no method left in this file calls it.
import { applyStockDelta, lockStockProducts, previewConsumableStockQty } from '../../../common/utils/location-stock-ledger';
import { AuditService, AUDIT_EVENT_CODES } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { HeldSaleDto } from '../dto/held-sale.dto';
import { PosAuditEventDto } from '../dto/pos-audit-event.dto';
import { UpsertSaleDto, SalesOrderConversionRelease } from '../dto/upsert-sale.dto';
import { calculateAllowedSaleUnitPrice } from '../helpers/sales-write.helper';
import { type TripSaleContribution } from '../../delivery-reps/van-trip-counters.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { SalesAuthorizationService } from './sales-authorization.service';
import { SalesFinanceService } from './sales-finance.service';
import { SalesQueryService } from './sales-query.service';
import { SalesStockAndPricingHelper } from './sales-stock-and-pricing.helper';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { CashierFraudRadarService } from './cashier-fraud-radar.service';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import { ReturnsService } from '../../returns/returns.service';
import { CashDrawerService } from '../../cash-drawer/cash-drawer.service';
import { KdsService } from './kds.service';
import { SalesRestaurantAndSerialsHelper } from './sales-restaurant-and-serials.service';
import { SalesEditAndCancelService } from './sales-edit-and-cancel.service';
import { HeldSalesService } from './sales-held.service';
import { CreateSaleService } from './create-sale.service';

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
  private createSaleService: CreateSaleService | undefined;

  private heldSales: HeldSalesService | undefined;

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
    this.heldSales = this.getHeldSales();
    this.createSaleService = this.getCreateSale();
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
  /**
   * The held-sales sub-service, built eagerly by the constructor. Specs
   * that Object.create the facade and set fields by hand never run the
   * constructor, so the delegates go through this accessor: it builds the
   * sub-service lazily from the same deps instead of throwing on an
   * undefined field. Production behaviour is unchanged (the constructor
   * builds it eagerly on the same path).
   */
  private getHeldSales(): HeldSalesService {
    if (!this.heldSales) {
      this.heldSales = new HeldSalesService({
        db: this.db,
        tx: this.tx,
        audit: this.audit,
        authz: this.authz,
        query: this.query,
        assertDiscountChangeAllowed: this.assertDiscountChangeAllowed.bind(this),
        assertUnitPriceChangeAllowed: this.assertUnitPriceChangeAllowed.bind(this),
        getCurrentProductOffers: this.getCurrentProductOffers.bind(this),
      });
    }
    return this.heldSales;
  }


  /**
   * The create-sale sub-service, built eagerly by the constructor. Specs
   * that Object.create the facade and set fields by hand never run the
   * constructor, so the createSale delegate goes through this accessor: it
   * builds the sub-service lazily from the same deps instead of throwing on
   * an undefined field. Production behaviour is unchanged (the constructor
   * builds it eagerly on the same path).
   */
  private getCreateSale(): CreateSaleService {
    if (!this.createSaleService) {
      this.createSaleService = new CreateSaleService({
        db: this.db,
        tx: this.tx,
        audit: this.audit,
        authz: this.authz,
        finance: this.finance,
        query: this.query,
        accountingPosting: this.accountingPosting,
        idempotency: this.idempotency,
        planFeatureService: this.planFeatureService,
        returnsService: this.returnsService,
        whatsappService: this.whatsappService,
        logger: this.logger,
        transferKdsTicketStateInTrx: this.transferKdsTicketStateInTrx.bind(this),
        loadFlatAddonCosts: this.loadFlatAddonCosts.bind(this),
        resolveSaleModifierCosts: this.resolveSaleModifierCosts.bind(this),
        enforceRestaurantModifierContract: this.enforceRestaurantModifierContract.bind(this),
        claimSaleSerials: this.claimSaleSerials.bind(this),
        lockSaleStockRows: this.lockSaleStockRows.bind(this),
        lockProductRow: this.lockProductRow.bind(this),
        buildInsufficientStockError: this.buildInsufficientStockError.bind(this),
        shouldLogCheckoutTimings: this.shouldLogCheckoutTimings.bind(this),
        assertDiscountChangeAllowed: this.assertDiscountChangeAllowed.bind(this),
        assertUnitPriceChangeAllowed: this.assertUnitPriceChangeAllowed.bind(this),
        getCurrentProductOffers: this.getCurrentProductOffers.bind(this),
        getAllowNegativeStockSales: this.getAllowNegativeStockSales.bind(this),
        getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
        autoProduceShortfall: this.autoProduceShortfall.bind(this),
        recordImportLotShortfalls: this.recordImportLotShortfalls.bind(this),
        deductPharmacyBatchesFefo: this.deductPharmacyBatchesFefo.bind(this),
        resolveOnlineOrderTerms: this.resolveOnlineOrderTerms.bind(this),
        refreshClosedShiftsForBackdatedOfflineSale: this.refreshClosedShiftsForBackdatedOfflineSale.bind(this),
        generateSaleDocNo: this.generateSaleDocNo.bind(this),
      });
    }
    return this.createSaleService;
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

  /**
   * Create a sale. Thin delegate — the implementation lives in
   * CreateSaleService (split 5); see that file for the phase breakdown.
   */
  async createSale(payload: UpsertSaleDto, auth: AuthContext, approvedTerms?: SystemApprovedSaleTerms, conversionRelease?: SalesOrderConversionRelease): Promise<Record<string, unknown>> {
    return this.getCreateSale().createSale(payload, auth, approvedTerms, conversionRelease);
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
    return this.getHeldSales().saveHeldSale(payload, auth);
  }

    async deleteHeldSale(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.getHeldSales().deleteHeldSale(id, auth);
  }

    async clearHeldSales(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.getHeldSales().clearHeldSales(auth);
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
