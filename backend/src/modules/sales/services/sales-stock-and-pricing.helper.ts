/*
 * Stock + pricing helpers (split-2 out of SalesWriteService).
 * Pure move: the 8 stock/pricing helpers, unchanged, behind the
 * SalesWriteService delegating facade. The facade owns the settings cache
 * and the two prototype-driven methods (getTenantSettingsMap and
 * resolveOnlineOrderTerms stay in the facade: specs drive them via
 * Object.create(SalesWriteService.prototype) without ever running the
 * constructor, so a delegate calling this.stockPricing.* would throw).
 * This helper receives them bound via SalesStockAndPricingHelperDeps —
 * getTenantSettingsMap bound from the facade, loadFlatAddonCosts bound
 * from the facade (S1's method) — so the moved bodies are byte-identical
 * to the originals (only the leading 'private ' is dropped).
 */
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { lockStockProducts } from '../../../common/utils/location-stock-ledger';
import { SalesAuthorizationService } from './sales-authorization.service';

export type SalesStockAndPricingHelperDeps = {
  authz: SalesAuthorizationService;
  getTenantSettingsMap: (
    trx: Kysely<Database> | Transaction<Database>,
    tenantId: string,
  ) => Promise<Map<string, any>>;
  loadFlatAddonCosts: (
    trx: Kysely<Database> | Transaction<Database>,
    tenantId: string,
    items: any[],
  ) => Promise<Map<number, number>>;
};

export class SalesStockAndPricingHelper {
  private readonly authz: SalesAuthorizationService;
  private readonly getTenantSettingsMap: SalesStockAndPricingHelperDeps['getTenantSettingsMap'];
  private readonly loadFlatAddonCosts: SalesStockAndPricingHelperDeps['loadFlatAddonCosts'];

  constructor(deps: SalesStockAndPricingHelperDeps) {
    this.authz = deps.authz;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
    this.loadFlatAddonCosts = deps.loadFlatAddonCosts;
  }

shouldLogCheckoutTimings(): boolean {
    return String(process.env.CHECKOUT_TIMINGS || '').trim() === '1';
  }

async assertDiscountChangeAllowed(
    trx: Kysely<Database> | Transaction<Database>,
    auth: AuthContext,
    discount: number,
    managerPin?: string | null,
    subtotal?: number,
  ): Promise<void> {
    const discountVal = Math.abs(Number(discount || 0));
    if (discountVal <= 0.0001) return;

    // INV-SPIRIT-DISCOUNT-TIERS: tier 1 -- any cashier, even without the
    // discount permission, may discount up to a small flat allowance
    // (settings-configurable, default 2 tenant currency units: the
    // rounding/faka case, e.g. 232 taken as 230). Tier 2 -- a cashier WITH
    // the discount permission may discount up to the owner-set percentage
    // cap (default 10%). Above the applicable tier, manager PIN/password
    // approval is required. The cost/min-price floor below still always
    // requires manager approval; it is enforced separately in createSale.
    let flatAllowance = 2;
    let exceedsThreshold = false;
    try {
      const scope = requireTenantScope(auth);
      const settingsMap = await this.getTenantSettingsMap(trx, scope.tenantId);

      const configuredAllowance = Number(settingsMap.get('posSmallDiscountFlatAllowance'));
      if (Number.isFinite(configuredAllowance) && configuredAllowance >= 0) {
        flatAllowance = configuredAllowance;
      }

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

    if (discountVal <= flatAllowance + 0.0001) return;

    // INV-POS-ADMIN-DISCOUNT-AUTHORITY: the tenant admin IS the store
    // owner/manager (the highest role inside a customer tenant), so it
    // is treated exactly like super_admin at the discount gate, with the
    // same role pattern as updateSale. The tiers apply to cashiers only.
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (isAdmin || this.authz.hasPermission(auth, '*')) return;

    if (!this.authz.hasPermission(auth, 'canDiscount') || exceedsThreshold) {
      await this.authz.authorizeDiscountOverride(String(managerPin || '').trim(), auth, trx);
    }
  }

async assertUnitPriceChangeAllowed(trx: Kysely<Database> | Transaction<Database>, auth: AuthContext, providedPrice: number, allowedPrice: number, productId: number, managerPin?: string, saleId?: number): Promise<void> {
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
    // INV-POS-ADMIN-DISCOUNT-AUTHORITY: the tenant admin (store owner)
    // edits prices without a manager approval; the audit row is kept.
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdmin && (!this.authz.hasPermission(auth, 'canEditPrice') || exceedsThreshold)) {
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

async getCurrentProductOffers(trx: Kysely<Database> | Transaction<Database>, productId: number, tenantId: string) {
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
  async lockProductRow(
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

async lockSaleStockRows(
    trx: Kysely<Database> | Transaction<Database>,
    scope: { tenantId: string; accountId: string },
    items: any[],
  ): Promise<void> {
    const productIds = new Set<number>();
    const optionIds = new Set<number>();
    // R8-A INV-REST-FLAT-ADDON-COSTING: flat addons are addons-table
    // rows, not products — they must not enter the product lock set,
    // or lockStockProducts throws PRODUCT_NOT_FOUND for an id that was
    // never a product. Resolved from the addons table, once, here.
    const flatAddonCosts = await this.loadFlatAddonCosts(trx, scope.tenantId, items);
    for (const item of items) {
      const id = Number(item.productId ?? item.product_id);
      if (id > 0) productIds.add(id);
      for (const modifier of Array.isArray(item.modifiers) ? item.modifiers : []) {
        const modifierId = Number(modifier.productId || modifier.componentProductId || modifier.component_product_id);
        const optId = Number(modifier.optionId || modifier.option_id || modifier.id);
        const isFlatAddon = !(optId > 0) && modifierId > 0 && flatAddonCosts.has(modifierId);
        if (modifierId > 0 && !isFlatAddon) productIds.add(modifierId);
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

async getAllowNegativeStockSales(trx: Kysely<Database> | Transaction<Database>, tenantId: string): Promise<boolean> {
    const settingsMap = await this.getTenantSettingsMap(trx, tenantId);
    const allowNegative = settingsMap.get('allowNegativeStockSales');
    const allowSellingBelow = settingsMap.get('allowSellingBelowStock');
    return allowNegative === true || allowNegative === 'true' || allowSellingBelow === true || allowSellingBelow === 'true';
  }

async buildInsufficientStockError(
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
      .where('sl.location_type', 'not in', ['damaged', 'in_transit', 'quarantine']);

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
}
