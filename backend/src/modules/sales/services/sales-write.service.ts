import { valueStockReceipt } from '../../accounting/inventory-valuation';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { scaledBomOverhead } from '../../manufacturing/engines/manufacturing-overhead.engine';
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
import { applyStockDelta, lockStockProducts, previewConsumableStockQty, previewAssignedLocationStockQty, releaseLocationStock } from '../../../common/utils/location-stock-ledger';
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
import { buildPreparedSaleItem, calculateAllowedSaleUnitPrice, calculateCollectibleTotal, calculateRemainingDebt, calculateRestoredStockQuantity, calculateStoreCreditBalance, computeSaleAllocationLegs, findBelowFloorSaleItems, paidAmountExceedsRecordedPayments, resolvePostedSalePaymentChannel, restoreFrozenSaleLineCosts, roundSaleInvoiceTotals, roundSaleResidual } from '../helpers/sales-write.helper';
import { allocateSaleTenders, type SaleTenderChannel } from '../engines/sale-tender.engine';
import { allocateInvoiceDiscount } from '../engines/invoice-discount.engine';
import { resolveSaleTaxRate } from '../engines/sale-tax-rate.engine';
import { assertSaleNotZatcaSigned } from '../../tax-integration/services/zatca/zatca-invoice-status';
import { diffContributions, negateContribution, tripSaleContribution, type TripSaleContribution } from '../../delivery-reps/van-trip-counters.engine';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { SalesAuthorizationService } from './sales-authorization.service';
import { SalesFinanceService } from './sales-finance.service';
import { SalesQueryService } from './sales-query.service';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { idempotencyStorage } from '../../../core/idempotency/idempotency.context';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { CashierFraudRadarService } from './cashier-fraud-radar.service';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import { ReturnsService, type ExchangeReturnContext } from '../../returns/returns.service';
import { allocateSaleFromImportLots, isAnomalousImportLotShortfall, restoreImportLotsFromCancelledSale } from '../../import-sales/helpers/import-lot-allocation.helper';

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
}

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

@Injectable()
export class SalesWriteService {
  private readonly logger = new Logger(SalesWriteService.name);

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
  ) {}


  /** Cost every restaurant component at the LOCKED tenant product WAC, never
   * at user-supplied modifier.costPrice or modifier.consumptionQty. */
  private async resolveSaleModifierCosts(
    trx: Kysely<Database> | Transaction<Database>, items: any[],
    tenantId: string, restaurantEnabled: boolean,
  ): Promise<void> {
    const optionIds = new Set<number>();
    const componentIds = new Set<number>();
    if (restaurantEnabled) for (const item of items) for (const mod of (Array.isArray(item.modifiers) ? item.modifiers : [])) {
      const optionId = Number(mod.optionId || mod.option_id || mod.id || 0);
      const componentId = Number(mod.productId || mod.componentProductId || mod.component_product_id || 0);
      if (optionId > 0) optionIds.add(optionId);
      if (componentId > 0) componentIds.add(componentId);
    }
    const optionRows = optionIds.size ? await trx.selectFrom('pos_modifier_options')
      .select(['id','component_product_id','consumption_qty'])
      .where('tenant_id','=',tenantId).where('id','in',[...optionIds]).execute() : [];
    const options = new Map(optionRows.map(row => [Number(row.id),row]));
    optionRows.forEach(row => { if (Number(row.component_product_id || 0) > 0) componentIds.add(Number(row.component_product_id)); });
    const ids = [...new Set([...items.map(item => Number(item.productId)), ...componentIds])];
    const costRows = await trx.selectFrom('products').select(['id','cost_price'])
      .where('tenant_id','=',tenantId).where('id','in',ids).execute();
    const costs = new Map(costRows.map(row => [Number(row.id),Number(row.cost_price)]));
    for (const item of items) {
      let modifiersCost = 0;
      item.modifiers = (Array.isArray(item.modifiers) ? item.modifiers : []).map((mod: any) => {
        if (!restaurantEnabled) return {...mod,costPrice:0};
        const optionId = Number(mod.optionId || mod.option_id || mod.id || 0);
        const option = optionId ? options.get(optionId) : undefined;
        if (optionId && !option) throw new AppError('Restaurant modifier option missing',
          'RESTAURANT_MODIFIER_OPTION_INVALID',422);
        const directId = Number(mod.productId || mod.componentProductId || mod.component_product_id || 0);
        const configuredId = Number(option?.component_product_id || 0);
        if (option && directId > 0 && directId !== configuredId) throw new AppError(
          'Restaurant modifier differs from configured stock component',
          'RESTAURANT_MODIFIER_COMPONENT_MISMATCH',422);
        const componentId = configuredId || directId;
        const qty = Number(mod.qty ?? 1);
        const rate = option ? Number(option.consumption_qty ?? 1) : 1;
        const stockUnits = qty * rate;
        if (!Number.isFinite(stockUnits) || stockUnits <= 0 ||
            Math.abs(stockUnits - Number(stockUnits.toFixed(3))) > 0.00000001)
          throw new AppError('Invalid restaurant modifier stock units','RESTAURANT_MODIFIER_QUANTITY_INVALID',422);
        if (componentId > 0 && (!costs.has(componentId) || item.isService))
          throw new AppError('Restaurant modifier component cannot be consumed from this line',
            'RESTAURANT_MODIFIER_STOCK_INVALID',422);
        const unitWac = componentId > 0 ? Number(costs.get(componentId)) : 0;
        if (!Number.isFinite(unitWac) || unitWac < 0)
          throw new AppError('Invalid modifier inventory WAC','RESTAURANT_MODIFIER_COST_INVALID',422);
        modifiersCost += stockUnits * unitWac;
        return {...mod,qty,consumptionQty:rate,costPrice:Number((rate*unitWac).toFixed(6)),
          ...(componentId > 0 ? {productId:componentId} : {})};
      });
      const parentCost = costs.get(Number(item.productId));
      if (parentCost === undefined || !Number.isFinite(parentCost))
        throw new AppError('Sale WAC product missing','SALE_COST_PRODUCT_MISSING',409);
      item.costPrice = Number((parentCost * Number(item.unitMultiplier || 1) + modifiersCost).toFixed(6));
    }
  }

  private async claimSaleSerials(
    trx: Kysely<Database>, item: { productId: number; requiredQty: number; serials?: unknown },
    saleId: number, saleItemId: number, tenantId: string,
  ): Promise<string[]> {
    const product = await trx.selectFrom('products').select('track_serials')
      .where('id', '=', item.productId).where('tenant_id', '=', tenantId).executeTakeFirstOrThrow();
    const submitted = Array.isArray(item.serials) ? item.serials : [];
    if (submitted.some((value) => typeof value !== 'string' || !value.trim())) {
      throw new AppError('أدخل أرقاماً تسلسلية صحيحة للصنف', 'SALE_SERIAL_INVALID', 400);
    }
    const serials = submitted.map((value: string) => value.trim().toLowerCase());
    if (!product.track_serials && serials.length === 0) return [];
    if (!Number.isInteger(item.requiredQty) || serials.length !== item.requiredQty || new Set(serials).size !== serials.length) {
      throw new AppError('عدد الأرقام التسلسلية يجب أن يطابق عدد القطع دون تكرار', 'SALE_SERIAL_COUNT_MISMATCH', 400);
    }
    const rows = await trx.selectFrom('product_serials').select(['id', 'product_id', 'serial_number', 'imei_2', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', item.productId)
      .where('status', '=', 'in_stock')
      .where((eb) => eb.or([
        sql<boolean>`LOWER(serial_number) in (${sql.join(serials)})`,
        sql<boolean>`LOWER(imei_2) in (${sql.join(serials)})`,
      ]))
      .orderBy('id', 'desc').forUpdate().execute();
    if (rows.length !== serials.length ||
        serials.some((serial) => !rows.some((row) => row.serial_number.toLowerCase() === serial || row.imei_2?.toLowerCase() === serial))) {
      throw new AppError('سيريال غير موجود بالمخزون أو سبق بيعه', 'SALE_SERIAL_UNAVAILABLE', 409);
    }
    await trx.updateTable('product_serials').set({ status: 'sold', sale_id: saleId, sale_item_id: saleItemId, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId).where('id', 'in', rows.map((row) => row.id)).execute();
    return rows.map((row) => row.serial_number);
  }

  private async releaseSaleSerials(trx: Kysely<Database>, saleId: number, tenantId: string): Promise<void> {
    await trx.updateTable('product_serials')
      .set({ status: 'in_stock', sale_id: null, sale_item_id: null, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId).where('sale_id', '=', saleId).where('status', '=', 'sold').execute();
  }

  // Keep only settings needed by checkout; other settings can contain large JSON payloads.
  // On a cache miss the caller's transaction connection must be reused: opening a second
  // pool connection while every cashier holds a transaction can exhaust the whole pool.
  private static readonly SALE_SETTING_KEYS = [
    'posMaxDiscountThresholdEnabled', 'posMaxDiscountThresholdType', 'posMaxDiscountThresholdValue',
    'taxRate', 'tax_rate', 'allowNegativeStockSales', 'allowSellingBelowStock', 'loyaltyEnabled',
    'loyaltyPointsPer100Egp', 'loyaltyPointRedeemValue', 'loyaltyMinRedeemPoints',
    'loyaltyMaxDiscountPercentage', 'requireCashierShiftForSales', 'deliveryFeeMode',
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
    return String(process.env.CHECKOUT_TIMINGS || '').trim() === '1';
  }

  private async assertDiscountChangeAllowed(
    trx: Kysely<Database> | Transaction<Database>,
    auth: AuthContext,
    discount: number,
    managerPin?: string | null,
    subtotal?: number,
  ): Promise<void> {
    const discountVal = Math.abs(Number(discount || 0));
    if (discountVal <= 0.0001) return;

    let exceedsThreshold = false;
    try {
      const scope = requireTenantScope(auth);
      const settingsMap = await this.getTenantSettingsMap(trx, scope.tenantId);

      const isThresholdEnabled = settingsMap.get('posMaxDiscountThresholdEnabled') === true || settingsMap.get('posMaxDiscountThresholdEnabled') === 'true';
      const thresholdType = settingsMap.get('posMaxDiscountThresholdType') || 'percentage';
      const thresholdValue = Number(settingsMap.get('posMaxDiscountThresholdValue') || 0);

      if (isThresholdEnabled && thresholdValue > 0) {
        if (thresholdType === 'percentage') {
          const sub = Number(subtotal || 0);
          const pct = sub > 0 ? (discountVal / sub) * 100 : 0;
          exceedsThreshold = pct > thresholdValue;
        } else {
          exceedsThreshold = discountVal > thresholdValue;
        }
      }
    } catch {
      // fallback to permission check
    }

    const isSuperAdmin = this.authz.hasPermission(auth, '*');
    if (isSuperAdmin) return;

    if (!this.authz.hasPermission(auth, 'canDiscount') || exceedsThreshold) {
      await this.authz.authorizeDiscountOverride(String(managerPin || '').trim(), auth, trx);
    }
  }

  private async assertUnitPriceChangeAllowed(trx: Kysely<Database> | Transaction<Database>, auth: AuthContext, providedPrice: number, allowedPrice: number, productId: number, managerPin?: string, saleId?: number): Promise<void> {
    if (Math.abs(Number(providedPrice || 0) - Number(allowedPrice || 0)) <= 0.0001) return;
    const scope = requireTenantScope(auth);
    const settingsMap = await this.getTenantSettingsMap(trx, scope.tenantId);
    const thresholdEnabled = settingsMap.get('posMaxDiscountThresholdEnabled') === true || settingsMap.get('posMaxDiscountThresholdEnabled') === 'true';
    const thresholdType = settingsMap.get('posMaxDiscountThresholdType') || 'percentage';
    const threshold = Number(settingsMap.get('posMaxDiscountThresholdValue') || 0);
    const reduction = Math.max(0, allowedPrice - providedPrice);
    const exceedsThreshold = thresholdEnabled && threshold > 0 &&
      (thresholdType === 'percentage'
        ? allowedPrice > 0 && reduction / allowedPrice * 100 > threshold
        : reduction > threshold);
    let authorizedBy: string | null = null;
    if (!this.authz.hasPermission(auth, 'canEditPrice') || exceedsThreshold) {
      const approval = await this.authz.authorizeDiscountOverride(String(managerPin || '').trim(), auth, trx);
      authorizedBy = approval.authorizedByName;
    }
    await trx.insertInto('pos_audit_events').values({
      tenant_id: scope.tenantId, account_id: scope.accountId,
      event_type: 'price_edit', user_id: auth.userId, sale_id: saleId || null,
      product_id: productId, amount: Number(providedPrice),
      reason: authorizedBy ? `Price ${allowedPrice} -> ${providedPrice}; approved by ${authorizedBy}` : `Price ${allowedPrice} -> ${providedPrice}`,
      metadata: { allowedPrice, providedPrice, authorizedBy },
    }).execute();
  }

  private async getCurrentProductOffers(trx: Kysely<Database> | Transaction<Database>, productId: number, tenantId: string) {
    return trx
      .selectFrom('product_offers')
      .select([
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
      .where('product_id', '=', productId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('is_active', '=', true)
      .orderBy('id', 'desc')
      .execute();
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
    if (!(Number(productId) > 0)) return;
    await trx
      .selectFrom('products')
      .select('id')
      .where('id', '=', Number(productId))
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .where('account_id', '=', scope.accountId)
      .forUpdate()
      .executeTakeFirst();
  }

  private async lockSaleStockRows(
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    items: any[],
  ): Promise<void> {
    const productIds = new Set<number>();
    const optionIds = new Set<number>();
    for (const item of items) {
      const id = Number(item.productId ?? item.product_id);
      if (id > 0) productIds.add(id);
      for (const modifier of Array.isArray(item.modifiers) ? item.modifiers : []) {
        const modifierId = Number(modifier.productId || modifier.componentProductId || modifier.component_product_id);
        if (modifierId > 0) productIds.add(modifierId);
        const optId = Number(modifier.optionId || modifier.option_id || modifier.id);
        if (optId > 0 && !modifierId) optionIds.add(optId);
      }
    }

    const existingSaleLineIds = items
      .filter((item) => Number(item?.id) > 0 && ('sale_id' in item || 'product_id' in item))
      .map((item) => Number(item.id));
    if (existingSaleLineIds.length > 0) {
      const allocProducts = await trx.selectFrom('sale_line_stock_allocations')
        .select('product_id')
        .where('sale_line_id', 'in', existingSaleLineIds)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      for (const row of allocProducts) {
        if (Number(row.product_id) > 0) productIds.add(Number(row.product_id));
      }
    }

    if (optionIds.size > 0) {
      const modOptions = await trx.selectFrom('pos_modifier_options')
        .select(['id', 'component_product_id'])
        .where('id', 'in', [...optionIds])
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      for (const opt of modOptions) {
        if (opt.component_product_id && Number(opt.component_product_id) > 0) {
          productIds.add(Number(opt.component_product_id));
        }
      }
    }

    // Auto-production can consume nested BOM components during the same checkout.
    // Discover the graph before taking the first product/location lock.
    let frontier = [...productIds];
    const visited = new Set<number>();
    while (frontier.length) {
      const unseen = frontier.filter((id) => !visited.has(id));
      if (!unseen.length) break;
      unseen.forEach((id) => visited.add(id));
      const boms = await trx.selectFrom('manufacturing_boms')
        .select('id').where('product_id', 'in', unseen)
        .where('tenant_id', '=', scope.tenantId).where('is_active', '=', true).execute();
      if (!boms.length) break;
      const lines = await trx.selectFrom('manufacturing_bom_lines')
        .select('component_product_id').where('bom_id', 'in', boms.map((bom) => Number(bom.id)))
        .execute();
      frontier = lines.map((line) => Number(line.component_product_id)).filter((id) => id > 0);
      frontier.forEach((id) => productIds.add(id));
    }
    try {
      await lockStockProducts(trx, { ...scope, productIds: [...productIds] });
    } catch (err: any) {
      if (err instanceof AppError && err.code === 'PRODUCT_NOT_FOUND') {
        const missingMatch = err.message.match(/#(\d+)/);
        if (missingMatch) {
          const missingId = Number(missingMatch[1]);
          const matchedItem = items.find(
            (it) => Number(it.productId ?? it.product_id) === missingId,
          );
          const itemName = matchedItem?.name || (matchedItem as any)?.productName;
          if (itemName) {
            throw new AppError(
              `الصنف "${itemName}" (#${missingId}) غير موجود بقاعدة بيانات هذه المنشأة أو ليس لديك صلاحية للوصول إليه`,
              'PRODUCT_NOT_FOUND',
              404,
            );
          }
        }
      }
      throw err;
    }
  }

  private async getAllowNegativeStockSales(trx: Kysely<Database> | Transaction<Database>, tenantId: string): Promise<boolean> {
    const settingsMap = await this.getTenantSettingsMap(trx, tenantId);
    const allowNegative = settingsMap.get('allowNegativeStockSales');
    const allowSellingBelow = settingsMap.get('allowSellingBelowStock');
    return allowNegative === true || allowNegative === 'true' || allowSellingBelow === true || allowSellingBelow === 'true';
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
    let locName = params.currentLocationName || '';
    if (!locName && params.currentLocationId) {
      const loc = await trx
        .selectFrom('stock_locations')
        .select('name')
        .where('id', '=', Number(params.currentLocationId))
        .where(sql<boolean>`tenant_id = ${params.tenantId}`)
        .executeTakeFirst();
      locName = loc?.name || '';
    }

    const excludedIds = new Set<number>();
    if (params.currentLocationId) {
      excludedIds.add(Number(params.currentLocationId));
    }
    if (params.excludedLocationIds) {
      params.excludedLocationIds.forEach((id) => excludedIds.add(Number(id)));
    }

    let otherLocationsQuery = trx
      .selectFrom('product_location_stock as pls')
      .innerJoin('stock_locations as sl', 'sl.id', 'pls.location_id')
      .select(['sl.name as locationName', 'pls.qty'])
      .where('pls.product_id', '=', params.productId)
      .where(sql<boolean>`pls.tenant_id = ${params.tenantId}`)
      .where(sql<boolean>`pls.qty > 0`)
      .where('sl.is_active', '=', true)
      .where('sl.location_type', 'not in', ['damaged', 'in_transit']);

    if (excludedIds.size > 0) {
      otherLocationsQuery = otherLocationsQuery.where('pls.location_id', 'not in', Array.from(excludedIds));
    }

    const otherLocations = await otherLocationsQuery
      .orderBy('pls.qty', 'desc')
      .execute();

    let unassignedQty = 0;
    if (!excludedIds.has(0)) {
      const unassignedRow = await trx
        .selectFrom('product_location_stock as pls')
        .select('pls.qty')
        .where('pls.product_id', '=', params.productId)
        .where('pls.location_id', 'is', null)
        .where(sql<boolean>`pls.tenant_id = ${params.tenantId}`)
        .where(sql<boolean>`pls.qty > 0`)
        .executeTakeFirst();
      unassignedQty = Number(unassignedRow?.qty || 0);
    }

    const currentLocText = locName ? `في مخزن "${locName}"` : 'في المخزن المحدد';
    const availableText = `(المتاح: ${Number(params.currentAvailableQty || 0)})`;

    const alternatives: string[] = otherLocations.map(
      (l) => `"${l.locationName}" (${Number(l.qty)} قطعة)`,
    );
    if (unassignedQty > 0) {
      alternatives.push(`مخزون عام (${unassignedQty} قطعة)`);
    }

    let message = '';
    if (alternatives.length > 0) {
      message = `رصيد الصنف "${params.productName}" غير كافٍ ${currentLocText} ${availableText}. الصنف متوفر في: ${alternatives.join('، ')}.`;
    } else {
      message = `رصيد الصنف "${params.productName}" غير كافٍ ${currentLocText} ${availableText}، ولا يتوفر رصيد له في أي مخزن آخر.`;
    }

    return new AppError(message, 'INSUFFICIENT_STOCK', 400, {
      productId: params.productId,
      productName: params.productName,
      currentLocationName: locName,
      currentAvailableQty: params.currentAvailableQty,
      requiredQty: params.requiredQty,
      alternativeLocations: otherLocations.map((l) => ({
        locationName: l.locationName,
        qty: Number(l.qty),
      })),
    });
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
    if (depth > 6) {
      throw new AppError('تجاوز الحد الأقصى لعمق شجرة التركيبات التصنيعية المتداخلة', 'BOM_RECURSION_LIMIT', 400);
    }

    // Restaurant BOMs are kitchen recipes: restaurants must consume real ingredients
    // even without the unrelated Manufacturing feature. Otherwise hasBOM lets a
    // sale bypass stock checks while no recipe is actually produced.
    if (!this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'manufacturing') &&
        !this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant')) {
      return;
    }

    for (const item of [...items].sort((a, b) => a.productId - b.productId)) {
      if (!item.hasBOM || !item.bomId) continue;
      if (visitedProductIds.has(item.productId)) {
        throw new AppError(`اكتشاف حلقة تكرار دائرية في تركيبة التصنيع للمنتج #${item.productId}`, 'CIRCULAR_BOM_DETECTED', 400);
      }
      const nextVisited = new Set(visitedProductIds);
      nextVisited.add(item.productId);

      const shortfall = item.requiredQty - item.availableQty;
      if (shortfall <= 0) continue;

      const qtyToProduce = shortfall;
      const baseShortfall = Number(qtyToProduce.toFixed(3)); // requiredQty and availableQty are already base stock units
      
      const bom = await trx.selectFrom('manufacturing_boms')
        .select(['expected_cost', 'quantity', 'overhead_cost', 'is_active'])
        .where('id', '=', item.bomId)
        .where('product_id', '=', item.productId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst();
      if (!bom || !bom.is_active || !Number.isFinite(Number(bom.quantity)) || Number(bom.quantity) <= 0) {
        throw new AppError('الوجبة مرتبطة بوصفة BOM غير صالحة أو غير نشطة', 'RESTAURANT_BOM_INVALID', 409);
      }

      const bomQuantity = Number(bom.quantity);
      // Same book-precision rule as manufacturing completion: the work order
      // created here is posted by postManufacturingWorkOrder, so its cost
      // must already be at book precision, not 2dp. (tenantBaseCurrency,
      // currencyMoneyDigits and roundMoney are already imported in this file.)
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      let totalCost = scaledBomOverhead(Number(bom.overhead_cost || 0), baseShortfall, bomQuantity, moneyDigits);
      const wo = await trx.insertInto('manufacturing_work_orders').values({
        bom_id: item.bomId,
        quantity_to_produce: baseShortfall,
        produced_quantity: baseShortfall,
        status: 'done',
        source_location_id: locationId,
        destination_location_id: locationId,
        total_cost: totalCost,
        note: `إنتاج تلقائي للمبيعات فاتورة S-${saleId}`,
        created_by: auth.userId,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      }).returning('id').executeTakeFirstOrThrow();
      
      const woId = Number(wo.id);

      const bomLines = await trx.selectFrom('manufacturing_bom_lines as l')
        .innerJoin('products as p', (join) => join
          .onRef('p.id', '=', 'l.component_product_id')
          .on('p.tenant_id', '=', scope.tenantId))
        .select(['l.component_product_id', 'l.quantity', 'l.unit_multiplier', 'l.expected_cost', 'l.waste_percentage', 'p.name as component_name'])
        .where('l.bom_id', '=', item.bomId)
        .execute();
      if (!bomLines.length) {
        throw new AppError('وصفة الوجبة لا تحتوي على خامات', 'RESTAURANT_BOM_EMPTY', 409);
      }

      for (const line of [...bomLines].sort((a, b) => Number(a.component_product_id) - Number(b.component_product_id))) {
        const wasteFactor = 1 / (1 - (Number(line.waste_percentage || 0) / 100));
        const lineMultiplier = Number(line.unit_multiplier || 1);
        const quantityConsumedInSelectedUnit = Number(line.quantity) * wasteFactor * (baseShortfall / bomQuantity);
        const requiredMaterialQty = Number((quantityConsumedInSelectedUnit * lineMultiplier).toFixed(3));
        if (!Number.isFinite(requiredMaterialQty) || requiredMaterialQty <= 0 ||
            !Number.isFinite(Number(line.waste_percentage)) || Number(line.waste_percentage) < 0 ||
            Number(line.waste_percentage) >= 100) {
          throw new AppError('معدل استهلاك أو نسبة هدر الوصفة غير صالحة', 'RESTAURANT_BOM_QUANTITY_INVALID', 409);
        }

        // Recursive BOM check
        const componentStock = await previewAssignedLocationStockQty(trx, {
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          productId: Number(line.component_product_id),
          branchId,
          locationId: locationId || 0
        });

        if (componentStock < requiredMaterialQty) {
           const subBom = await trx.selectFrom('manufacturing_boms')
            .select(['id', 'is_active'])
            .where('product_id', '=', Number(line.component_product_id))
            .where('is_active', '=', true)
            .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
            .executeTakeFirst();
            
           if (subBom) {
              await this.autoProduceShortfall(trx, [{
                productId: Number(line.component_product_id),
                requiredQty: requiredMaterialQty,
                availableQty: componentStock,
                hasBOM: true,
                bomId: subBom.id,
                unitMultiplier: 1 // base units
              }], saleId, branchId, locationId, scope, auth, nextVisited, depth + 1);
           }
        }

        const material = await trx.selectFrom('products').select('cost_price').where('tenant_id', '=', scope.tenantId).where('id', '=', Number(line.component_product_id)).executeTakeFirstOrThrow();
        const actualUnitCost = Number(material.cost_price);
        if (!Number.isFinite(actualUnitCost) || actualUnitCost < 0) throw new AppError('Invalid material cost', 'MANUFACTURING_COST_INVALID', 409);
        const lineTotalCost = roundMoney(requiredMaterialQty * actualUnitCost, moneyDigits);
        totalCost += lineTotalCost;
        await trx.insertInto('manufacturing_wo_consumptions').values({
          work_order_id: woId,
          component_product_id: Number(line.component_product_id),
          quantity_consumed: requiredMaterialQty,
          unit_cost: actualUnitCost,
          line_total: lineTotalCost,
        }).execute();

        const stockChange = await applyStockDelta(trx, {
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          productId: Number(line.component_product_id),
          branchId,
          locationId,
          delta: -requiredMaterialQty,
          allowNegative: false,
        });

        await trx.insertInto('stock_movements').values({
          product_id: Number(line.component_product_id),
          movement_type: 'manufacturing_consumption',
          unit_cost: actualUnitCost, total_cost: lineTotalCost,
          qty: -requiredMaterialQty,
          before_qty: stockChange.scopeBefore,
          after_qty: stockChange.scopeAfter,
          reason: 'استهلاك تصنيع تلقائي',
          note: `أمر إنتاج تلقائي #${woId} لفاتورة S-${saleId}`,
          reference_type: 'manufacturing_work_order',
          reference_id: woId,
          branch_id: branchId,
          location_id: locationId,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        }).execute();
      }

      const fgStockChange = await applyStockDelta(trx, {
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        productId: item.productId,
        branchId,
        locationId,
        delta: baseShortfall,
      });

      await trx.insertInto('stock_movements').values({
        product_id: item.productId,
        movement_type: 'manufacturing_production',
        // Do not re-round the book amount coarser than itself: totalCost is
        // already at book precision and is also written to the work order
        // that the GL posts. A toFixed(2) here would make the movement
        // disagree with the journal for 3dp tenants.
        unit_cost: totalCost / baseShortfall, total_cost: totalCost,
        qty: baseShortfall,
        before_qty: fgStockChange.scopeBefore,
        after_qty: fgStockChange.scopeAfter,
        reason: 'إنتاج تام تلقائي',
        note: `أمر إنتاج تلقائي #${woId} لفاتورة S-${saleId}`,
        reference_type: 'manufacturing_work_order',
        reference_id: woId,
        branch_id: branchId,
        location_id: locationId,
        created_by: auth.userId,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      }).execute();

      await valueStockReceipt(trx, scope.tenantId, item.productId, fgStockChange.globalAfter, baseShortfall, totalCost);
      await trx.updateTable('manufacturing_work_orders').set({ completed_at: new Date(), total_cost: totalCost } as any).where('tenant_id', '=', scope.tenantId).where('id', '=', woId).execute();

      const posting = await this.accountingPosting.postManufacturingWorkOrder(trx, woId, auth);
      // INV-MANUFACTURING-ZERO-COST: a zero-cost auto-produced order posts
      // no journal by design; only a positive-cost order missing its
      // journal is a ledger failure.
      if (!posting.journalEntryId && totalCost > 0) throw new AppError(`Manufacturing work order ${woId} has no journal entry`, 'LEDGER_POSTING_MISSING', 500);
    }
  }

  /**
   * Record anomalous import-lot shortfalls instead of discarding the
   * allocation result (INV-IMPORT-LOT-SHORTFALL-RECORD). The sale itself
   * is not blocked: for ordinary POS sales the GL COGS comes from WAC,
   * so a lot shortfall is traceability-only — but it must leave a
   * persistent, queryable record (pos_audit_events) when it is
   * anomalous per isAnomalousImportLotShortfall, so an import-tracked
   * product sold with missing provenance is visible instead of silent.
   * Runs inside the sale transaction, so a rolled-back sale leaves no
   * orphan gap record.
   */
  private async recordImportLotShortfalls(
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleLineId: number,
    allocation: { items: Array<{ productId: number; requestedQty: number; allocatedQty: number; shortfallQty: number; fullyCovered: boolean; reason: string }> },
    auth: AuthContext,
  ): Promise<void> {
    for (const item of allocation.items) {
      if (item.fullyCovered || item.shortfallQty <= 0.0001) continue;
      const anyLot = await trx
        .selectFrom('import_inventory_lots')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', '=', Number(item.productId))
        .limit(1)
        .executeTakeFirst();
      if (!isAnomalousImportLotShortfall(item as any, Boolean(anyLot))) continue;
      await trx.insertInto('pos_audit_events').values({
        tenant_id: scope.tenantId, account_id: scope.accountId,
        event_type: 'import_lot_shortfall', user_id: auth.userId, sale_id: saleId,
        product_id: Number(item.productId), amount: Number(item.shortfallQty),
        reason: `Import lot shortfall (${item.reason}): requested ${item.requestedQty}, allocated ${item.allocatedQty}, shortfall ${item.shortfallQty}`,
        metadata: { saleLineId, requestedQty: item.requestedQty, allocatedQty: item.allocatedQty, shortfallQty: item.shortfallQty, reason: item.reason },
      }).execute();
    }
  }

  private async deductPharmacyBatchesFefo(
    trx: Kysely<Database> | Transaction<Database>,
    productId: number,
    allocations: Array<{ locationId: number | null; qty: number }>,
    scope: { tenantId: string; accountId: string },
    saleId: number,
    saleItemId: number,
  ): Promise<void> {
    const drug = await trx.selectFrom('pharmacy_drugs').select('id')
      .where('product_id', '=', productId).where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const linkedBatch = await trx.selectFrom('pharmacy_batches').select('id')
      .where('product_id', '=', productId).where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!drug && !linkedBatch) return;

    const todayIso = new Date().toISOString().slice(0, 10);
    const currentMonthIso = todayIso.slice(0, 7);
    for (const allocation of allocations) {
      let remaining = Number(allocation.qty.toFixed(3));
      const batches = await trx
        .selectFrom('pharmacy_batches')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb('product_id', '=', productId),
            eb(
              'drug_id',
              'in',
              trx
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
        .where((eb) => allocation.locationId == null
          ? eb('location_id', 'is', null)
          : eb.or([eb('location_id', '=', allocation.locationId), eb('location_id', 'is', null)]))
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

        await trx
          .updateTable('pharmacy_batches')
          .set({
            quantity: newQty,
            status: nextStatus,
            updated_at: sql`NOW()`,
          } as any)
          .where('id', '=', Number(batch.id))
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute();
        await trx.insertInto('sale_pharmacy_batch_allocations').values({
          tenant_id: scope.tenantId, account_id: scope.accountId, sale_id: saleId,
          sale_item_id: saleItemId, product_id: productId,
          pharmacy_batch_id: Number(batch.id), quantity: alloc,
        }).execute();

        remaining = Number((remaining - alloc).toFixed(3));
      }
      if (remaining > 0) {
        throw new AppError('لا توجد كمية كافية من تشغيلة دوائية سارية الصلاحية في المخزن المحدد', 'PHARMACY_FEFO_STOCK_UNAVAILABLE', 422);
      }
    }
  }

  private async restoreSalePharmacyBatches(
    trx: Kysely<Database> | Transaction<Database>, saleId: number,
    items: Array<{ id: number; product_id: number | null }>,
    scope: { tenantId: string; accountId: string }, removeAllocations: boolean,
  ): Promise<void> {
    const rows = await trx.selectFrom('sale_pharmacy_batch_allocations').selectAll()
      .where('tenant_id', '=', scope.tenantId).where('sale_id', '=', saleId)
      .orderBy('pharmacy_batch_id', 'asc').forUpdate().execute();
    const tracked = new Set(rows.map((row) => Number(row.sale_item_id)));
    const itemIds = items.map((item) => Number(item.product_id)).filter((id) => id > 0);
    const drugs = itemIds.length ? await trx.selectFrom('pharmacy_drugs').select('product_id')
      .where('tenant_id', '=', scope.tenantId).where('product_id', 'in', itemIds).execute() : [];
    const drugProducts = new Set(drugs.map((drug) => Number(drug.product_id)));
    if (items.some((item) => drugProducts.has(Number(item.product_id)) && !tracked.has(Number(item.id)))) {
      throw new AppError('فاتورة دوائية قديمة بلا ربط بالتشغيلات تحتاج تسوية قبل التعديل أو الإلغاء', 'PHARMACY_BATCH_RECONCILIATION_REQUIRED', 422);
    }
    const today = new Date().toISOString().slice(0, 10);
    for (const row of rows) {
      const batch = await trx.selectFrom('pharmacy_batches').select(['id', 'quantity', 'expiry_date'])
        .where('tenant_id', '=', scope.tenantId).where('id', '=', Number(row.pharmacy_batch_id))
        .forUpdate().executeTakeFirstOrThrow();
      const expiry = String(batch.expiry_date || '').slice(0, 10);
      const expired = !expiry || (expiry.length === 7 ? expiry < today.slice(0, 7) : expiry < today);
      await trx.updateTable('pharmacy_batches').set({
        quantity: Number((Number(batch.quantity) + Number(row.quantity)).toFixed(3)),
        status: expired ? 'expired' : 'active', updated_at: sql`NOW()`,
      }).where('tenant_id', '=', scope.tenantId).where('id', '=', Number(batch.id)).execute();
    }
    if (removeAllocations && rows.length) {
      await trx.deleteFrom('sale_pharmacy_batch_allocations')
        .where('tenant_id', '=', scope.tenantId).where('sale_id', '=', saleId).execute();
    }
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
      if (!branchId || reason.length < 10) throw new AppError('حدد الفرع وسبب فتح الدرج في 10 أحرف على الأقل', 'NO_SALE_REASON_REQUIRED', 400);
      await this.tx.runInTransaction(this.db, async (trx) => {
        if (!await this.authz.hasOpenCashierShift(trx, auth, branchId)) {
          throw new AppError('وردية كاشير مفتوحة مطلوبة لفتح الدرج', 'OPEN_SHIFT_REQUIRED', 400);
        }
        await this.authz.authorizeDiscountOverride(String(payload.managerPin || '').trim(), auth, trx);
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

    return {
      approvedDiscount: Math.max(Number(existing?.approvedDiscount || 0), Math.max(0, Number(order.discount_amount || 0))),
      approvedUnitPrices,
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
    ensureUniqueFlowItems(normalized.items, 'SALE_DUPLICATE_PRODUCT', 'Sale must not contain duplicate product rows with the same unit');

    const txStartedAt = Date.now();
    const saleId = await this.tx.runInTransaction(this.db, async (trx) => {
      await assertBusinessAccountingDate(trx, scope.tenantId, new Date(), true);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
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

        if (['damaged', 'in_transit'].includes(defaultLocation.location_type || '')) {
          throw new AppError('المخزن الافتراضي لا يجوز أن يكون مخزن تالف أو بضاعة بالطريق',
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
        if (['damaged', 'in_transit'].includes(selectedLocation.location_type || '')) {
          throw new AppError('لا يمكن بيع المخزون التالف أو البضاعة بالطريق', 'SALE_LOCATION_NOT_SELLABLE', 409);
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

      const allowNegativeStockSales = await this.getAllowNegativeStockSales(trx, scope.tenantId);

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
      // gated amount alongside the header discount (POS payloads never
      // send lineDiscount, so direct sales are unchanged).
      const lineDiscountTotal = roundSaleResidual(normalized.items.reduce((sum, item) => sum + Number((item as { lineDiscount?: number }).lineDiscount || 0), 0), moneyDigits);
      const unapprovedDiscount = Math.max(0, roundSaleResidual(roundSaleResidual(normalized.discount - Number(approvedTerms?.approvedDiscount || 0), moneyDigits) + lineDiscountTotal, moneyDigits));
      await this.assertDiscountChangeAllowed(trx, auth, unapprovedDiscount, normalized.managerPin, subtotal);
      if (effectiveDiscount > subtotal) throw new AppError('Discount cannot exceed subtotal', 'INVALID_DISCOUNT', 400);
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
      const floorApproval = belowFloorItems.length
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
        const hasOpenShift = await this.authz.hasOpenCashierShift(trx, auth, normalized.branchId);
        if (!hasOpenShift) throw new AppError('Open cashier shift is required before posting a POS sale', 'OPEN_SHIFT_REQUIRED', 400);
      } else if (normalized.paymentType !== 'credit' && (normalized.payments.some((entry) => entry.paymentChannel === 'cash') || normalized.paymentChannel === 'cash')) {
        // INV-ADMIN-CASH-SALE-SHIFT-REQUIRED: every cash receipt
        // needs an open shift, regardless of role. Admins used to be
        // exempt here, so a back-office cash sale wrote GL cash with
        // no shift attribution and surfaced as a false overage at
        // close. Admins can hold shifts (openCashierShift exempts
        // them from branch assignment), so this never deadlocks.
        const hasOpenShift = await this.authz.hasOpenCashierShift(trx, auth, normalized.branchId);
        if (!hasOpenShift) throw new AppError('Open cashier shift is required before posting a cash sale', 'OPEN_SHIFT_REQUIRED', 400);
      }

      const tenderAllocation = allocateSaleTenders({
        paymentType: normalized.paymentType, payments: normalized.payments, collectibleTotal,
        fallbackChannel: (['card', 'wallet', 'instapay'].includes(normalized.paymentChannel) ? normalized.paymentChannel : 'cash') as SaleTenderChannel,
        tenderedCash: normalized.tenderedAmount, digits: moneyDigits,
      });
      const payments = tenderAllocation.payments;
      const paidAmount = tenderAllocation.appliedAmount;
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
          throw new AppError('Customer credit limit exceeded', 'CUSTOMER_CREDIT_LIMIT', 400);
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
        collectionStatus = rawCollectionStatus || (hasUnpaidAmount ? 'cod' : 'prepaid_online');
      }

      const isCodDelivery = isDelivery && (collectionStatus === 'cod' || collectionStatus === 'pending' || paidAmount + 0.0001 < collectibleTotal);
      const isPartialCredit = Boolean(normalized.customerId) && paidAmount + 0.0001 < collectibleTotal;
      const effectivePaymentType = (isPartialCredit || normalized.paymentType === 'credit') ? 'credit' : 'cash';
      if (effectivePaymentType !== 'credit' && !isCodDelivery && paidAmount + 0.0001 < collectibleTotal) {
        throw new AppError('Paid amount cannot be less than invoice total', 'INVALID_PAID_AMOUNT', 400);
      }

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
      let saleNote = normalized.note;
      if (offlineDocNo && !saleNote.includes(offlineDocNo)) {
        const offlineTag = `[إيصال أوفلاين: ${offlineDocNo}]`;
        saleNote = saleNote ? `${saleNote} | ${offlineTag}` : offlineTag;
      }
      if (floorApproval) {
        saleNote = `${saleNote ? `${saleNote} | ` : ''}[اعتماد بيع تحت الحد: ${floorApproval.authorizedByName}; أصناف ${belowFloorItems.join(',')}]`;
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
        this.planFeatureService.hasFeature(auth.planId, auth.extraFeatures, 'restaurant'));

      // Deadlock prevention: stock rows (products + product_location_stock) must always be
      // locked in a deterministic global order. Client-supplied item order is arbitrary, so two
      // concurrent sales carrying the same products in opposite order would deadlock (SQLSTATE 40P01).
      // Sorting by productId enforces one canonical lock order across all concurrent transactions.
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

            if (rawModProductId > 0) {
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

              await sql`
                update cashier_shifts
                set expected_cash = greatest(0, coalesce(expected_cash, 0) - ${normalized.deliveryFee}),
                    updated_at = now()
                where tenant_id = ${scope.tenantId} and id = ${openShift.id}
              `.execute(trx);
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
    const scope = requireTenantScope(auth);
    const normalized = normalizeSalePayload(payload);
    const editReason = String((payload as unknown as { editReason?: string })?.editReason || '').trim();
    const managerPin = String((payload as unknown as { managerPin?: string })?.managerPin || '').trim();

    if (!normalized.items.length) throw new AppError('Sale must include at least one item', 'SALE_ITEMS_REQUIRED', 400);
    ensureUniqueFlowItems(normalized.items, 'SALE_DUPLICATE_PRODUCT', 'Sale must not contain duplicate product rows with the same unit');
    if (normalized.discount < 0) throw new AppError('Discount cannot be negative', 'INVALID_DISCOUNT', 400);
    if (editReason.length < 5) throw new AppError('سبب التعديل مطلوب بشكل واضح.', 'SALE_EDIT_REASON_REQUIRED', 400);
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdmin && !managerPin) throw new AppError('رمز اعتماد المدير مطلوب قبل تعديل الفاتورة.', 'MANAGER_AUTH_REQUIRED', 400);
    if (!isAdmin || managerPin) await this.authz.authorizeDiscountOverride(managerPin, auth, this.db);

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
      if (originalShift && (originalShift.status !== 'open' || Number(originalShift.opened_by) !== auth.userId)) {
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

        if (['damaged', 'in_transit'].includes(defaultLocation.location_type || '')) {
          throw new AppError('المخزن الافتراضي لا يجوز أن يكون مخزن تالف أو بضاعة بالطريق',
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
        if (['damaged', 'in_transit'].includes(selectedLocation.location_type || '')) {
          throw new AppError('لا يمكن بيع المخزون التالف أو البضاعة بالطريق', 'SALE_LOCATION_NOT_SELLABLE', 409);
        }
      }

      let eligibleLocations = [{ id: normalized.locationId, branchId: normalized.branchId }];
      if (normalized.source === 'pos' && branch?.sales_stock_mode === 'all_operational_locations') {
        const allLocs = await trx.selectFrom('stock_locations')
          .select(['id', 'location_type', 'branch_id'])
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .where('is_active', '=', true)
          .where('location_type', 'not in', ['damaged', 'in_transit'])
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

      const tenderAllocation = allocateSaleTenders({
        paymentType: normalized.paymentType, payments: normalized.payments, collectibleTotal,
        fallbackChannel: (['card', 'wallet', 'instapay'].includes(normalized.paymentChannel) ? normalized.paymentChannel : 'cash') as SaleTenderChannel,
        tenderedCash: normalized.tenderedAmount, digits: moneyDigits,
      });
      const payments = tenderAllocation.payments;
      const paidAmount = tenderAllocation.appliedAmount;
      if (normalized.source === 'pos' && !await this.authz.hasOpenCashierShift(trx, auth, normalized.branchId)) {
        throw new AppError('وردية كاشير مفتوحة مطلوبة لتعديل فاتورة نقطة البيع', 'OPEN_SHIFT_REQUIRED', 400);
      }
      const isPartialCredit = Boolean(normalized.customerId) && paidAmount + 0.0001 < collectibleTotal;
      const effectivePaymentType = (isPartialCredit || normalized.paymentType === 'credit') ? 'credit' : 'cash';
      if (effectivePaymentType !== 'credit' && paidAmount + 0.0001 < collectibleTotal) throw new AppError('Paid amount cannot be less than invoice total', 'INVALID_PAID_AMOUNT', 400);
      const newDebt = roundMoney(Math.max(0, collectibleTotal - paidAmount), moneyDigits);
      if (newDebt > 0) {
        if (!customer) throw new AppError('Credit sale requires a customer', 'CUSTOMER_REQUIRED_FOR_CREDIT', 400);
        if (Number(customer.balance || 0) + newDebt > Number(customer.credit_limit || 0) + 0.001
          && Number(customer.credit_limit || 0) > 0) {
          throw new AppError('Customer credit limit exceeded', 'CUSTOMER_CREDIT_LIMIT', 400);
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
      const editFloorApproval = belowFloorProductIds.length
        ? await this.authz.authorizeDiscountOverride(normalized.managerPin, auth, trx)
        : null;
      if (editFloorApproval) {
        const floorTag = `[اعتماد بيع تحت الحد: ${editFloorApproval.authorizedByName}; أصناف ${belowFloorProductIds.join(',')}]`;
        const editNote = normalized.note ? `${normalized.note} | ${floorTag}` : floorTag;
        await trx.updateTable('sales').set({ note: editNote } as any)
          .where('id', '=', saleId).where(sql<boolean>`tenant_id = ${scope.tenantId}`).execute();
      }

      // Deadlock prevention: identical canonical lock ordering as createSale (see note there).
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
            if (mod.productId) {
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
      }

      for (const payment of payments) {
        if (payment.paymentChannel !== 'cash') continue;
        await this.finance.addTreasuryTransaction(trx, payment.amount, `تعديل فاتورة بيع S-${saleId}`, saleId, auth, normalized.branchId, normalized.locationId);
      }

      await this.accountingPosting.postSaleEdit(trx, saleId, auth, editReason, preparedWasteEdit ? { preparedWaste: preparedWasteEdit } : undefined);
    });

    await this.audit.log('تعديل فاتورة بيع', `تم تعديل الفاتورة S-${saleId} بواسطة ${auth.username} | السبب: ${editReason}`, auth);
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
        // Only when that original shift is closed (its stored
        // expected cash is frozen and never restated) does the refund
        // fall back to the cancelling user's latest open shift on the
        // branch, as before; admins with no open shift keep the
        // sale-linked row.
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
        reason: String(reason || '').trim(), metadata: { managerApproved: true },
      }).execute();

      try {
        await this.accountingPosting.reverseSaleJournal(trx, saleId, String(reason || '').trim(), auth, { isPreparedWaste });
      } catch (error) {
        this.logger.error(`Failed to post reversal accounting journal for cancelled sale ${saleId}`, error instanceof Error ? error.stack : String(error));
        throw error;
      }
    });

    await this.audit.log('إلغاء فاتورة بيع', `تم إلغاء الفاتورة S-${saleId} بواسطة ${auth.username}`, auth);
    return { ok: true, sales: (await this.query.listSales({}, auth)).sales };
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
        }))
        .filter((entry) => entry.productId > 0 && entry.qty > 0);

      if (!items.length) throw new AppError('Held draft must include at least one item', 'HELD_DRAFT_ITEMS_REQUIRED', 400);
      await this.assertDiscountChangeAllowed(trx, auth, Number(payload.discount || 0), payload.managerPin);

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
        : Number((cashAmount + cardAmount + transferAmount).toFixed(2));

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
          collection_status: (payload as any).deliveryRepId ? ((payload as any).collectionStatus || null) : null,
          created_by: auth.userId,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const id = Number(heldInsert.id);
      for (const item of items) {
        const itemModifiers = item.modifiers || [];
        const hasExtraMeta = item.seatNumber != null || Boolean(item.course);
        const finalModifiers = hasExtraMeta
          ? {
              mods: Array.isArray(itemModifiers) ? itemModifiers : [],
              ...(item.seatNumber != null ? { seatNumber: item.seatNumber } : {}),
              ...(item.course ? { course: item.course } : {}),
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
