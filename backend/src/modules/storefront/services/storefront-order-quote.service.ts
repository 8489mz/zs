import { Injectable, BadRequestException } from '@nestjs/common';
import { Selectable, Kysely, sql } from 'kysely';
import { TenantTable, Database } from '../../../database/database.types';
import { couponDayState, getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import { parseTenantExtraFeatures } from '../engines/storefront-entitlement.engine';
import { resolveOrderLinePrice, formatVariantLineName } from '../engines/online-order-pricing.engine';
import { resolveBestStorefrontOffer, RawStorefrontOffer } from '../engines/storefront-offers.engine';
import { roundMoney } from '../../accounting/engines/money-minor-units.engine';
import {
  enforceRestaurantModifierContract,
  type ModifierGroupRule,
  type ModifierPriceTruth,
} from '../../sales/helpers/restaurant-modifier-contract.helper';
import { offerTimezone, storefrontMoneyDigits } from '../storefront-helpers';
import type { QuoteCartDto } from '../dto/storefront-public-write.dto';

/**
 * StorefrontOrderQuoteService — slice T1 of the storefront split.
 * Pure move of 5 methods from StorefrontService (order quote: the
 * modifier normalizer/total/contract, the shared resolveOrderCharges,
 * and the authoritative quoteOnlineOrder). No behavior change: the
 * bodies are byte-identical except the 4 private methods are PUBLIC
 * in this slice only (the facade keeps private delegates with the same
 * names/signatures, and T2/T3 call them via bound deps at their merge).
 * Deps: db + planFeatureService? (optional, guarded ternary in
 * enforceOnlineOrderModifierContract) + kernel getTenantBySlug +
 * getTenantSettingsMap (stay REAL private methods in the facade, passed
 * bound via the HR kernel pattern). getTenantBySlug's dep type is
 * Promise<Selectable<TenantTable>> — the exact inferred return type of
 * the kernel method (selectAll on 'tenants', throws when not found).
 * Free helpers offerTimezone + storefrontMoneyDigits are imported from
 * '../storefront-helpers' (created with the T8 merge — T8 merges FIRST;
 * the file does not exist on this generation tree, EXPECTED transient,
 * merge-owned; HR H0 precedent).
 * Clock pins travel verbatim: couponDayState + todayTenantDate in
 * resolveOrderCharges (business-date-tenant-local :178 asserts
 * 'todayTenantDate(businessTz, now)' — merge-owned repoint to a
 * multi-file read), offerTimezone in quoteOnlineOrder. No instant
 * comparison, no UTC-slice normalizer. No toFixed2, no inlineRound,
 * no FX in this slice. Driving spec: storefront-line-total-digits
 * (quoteOnlineOrder). No spec repoint travels in this patch — prep §7.3
 * rules all eight source-text repoints MERGE-OWNED.
 * MERGE NOTE: at T2/T3's merge, their this.resolveOrderCharges( /
 * this.normalizeOnlineOrderModifiers( / this.onlineOrderModifiersTotal( /
 * this.enforceOnlineOrderModifierContract( calls must resolve through
 * bound deps wired from this slice instance in the facade ctor
 * (HR H1 pattern: this.orderQuoteService.<method>.bind(this.orderQuoteService));
 * the facade's private delegates keep them working until then.
 */

export interface StorefrontOrderQuoteDeps {
  db: Kysely<Database>;
  planFeatureService?: PlanFeatureService;
  getTenantBySlug: (slug: string) => Promise<Selectable<TenantTable>>;
  getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
}

@Injectable()
export class StorefrontOrderQuoteService {
  private readonly db: Kysely<Database>;
  private readonly planFeatureService?: PlanFeatureService;
  private readonly getTenantBySlug: (slug: string) => Promise<Selectable<TenantTable>>;
  private readonly getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;

  constructor(deps: StorefrontOrderQuoteDeps) {
    this.db = deps.db;
    this.planFeatureService = deps.planFeatureService;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
  }

  /**
   * INV-REST-KIOSK-MODIFIER-UI (R7-B1): normalize one line's client-sent
   * modifiers. Absent means none; a present value that is not an array
   * fails closed with a specific error instead of silently dropping the
   * customer's picks (the DTO rejects it as 400 on the HTTP path; this
   * is the service-direct backstop). Entries pass through untouched —
   * the R4-C contract below is what validates and re-prices them.
   */
  normalizeOnlineOrderModifiers(raw: unknown): any[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new BadRequestException('إضافات الصنف يجب أن تكون قائمة صالحة');
    }
    return raw;
  }

  /** Per-line modifier surcharge on already re-priced modifiers: the
   * same formula the POS charges (calcModifiersTotal /
   * buildPreparedSaleItem): Σ price × qty, a modifier with no qty
   * counting once. */
  onlineOrderModifiersTotal(modifiers: any[] | undefined): number {
    return (Array.isArray(modifiers) ? modifiers : []).reduce(
      (sum, mod) => sum + Number(mod?.price || 0) * Number(mod?.qty || 1),
      0,
    );
  }

  /**
   * INV-REST-KIOSK-MODIFIER-UI (R7-B1): the R4-C modifier contract for
   * online orders — the same pure helper createSale runs, fed by the
   * same truth load (sales-write.service.ts enforceRestaurantModifierContract,
   * mirrored here line for line so the two paths can never drift apart):
   * option prices from pos_modifier_options, combo components from
   * products.retail_price, flat legacy addons from addons.price, group
   * rules from the product's linked active groups. A spoofed client
   * price is re-priced to server truth; a modifier with no truth, an
   * unknown optionId, or a violated group rule fails as 422 before any
   * stock, offer or order work — the caller runs this BEFORE pricing
   * the lines, so the re-priced modifiers feed the line totals.
   *
   * Gated on the restaurant feature with the exact call createSale
   * uses, so a non-restaurant tenant keeps today's behaviour (its
   * modifiers, if any, are stored as sent with no group rules) —
   * exactly like a POS sale with the feature off. A missing
   * planFeatureService fails closed to "off" (createOnlineOrder
   * already refuses without it, so this is unreachable there).
   *
   * SCOPE (decided, never-ask): the contract runs ONLY on lines that
   * actually carry modifiers. A modifier-less line is untouched — the
   * web storefront has no modifier UI, so enforcing mandatory groups
   * on its orders would refuse every order of a product with a
   * mandatory group, a blast radius far outside the kiosk. The kiosk
   * picker (Batch 8) blocks add-to-cart until mandatory groups are
   * chosen, so the enforcement still bites exactly where a choice was
   * claimed; the server guarantees whatever is sent is valid and
   * correctly priced. As a side effect this keeps the change strictly
   * additive for every existing modifier-less order: no new table is
   * read when no line carries modifiers.
   */
  async enforceOnlineOrderModifierContract(
    items: Array<{ productId: number; modifiers?: any[] }>,
    tenant: { id: string; plan_id?: string | null; extra_features?: unknown; activity_type?: string | null },
  ): Promise<void> {
    if (!items.some((item) => Array.isArray(item.modifiers) && item.modifiers.length > 0)) return;
    const restaurantEnabled = this.planFeatureService
      ? this.planFeatureService.hasFeature(
          tenant.plan_id ?? undefined,
          parseTenantExtraFeatures(tenant.extra_features),
          'restaurant',
          undefined,
          tenant.activity_type ?? undefined,
        )
      : false;
    if (!restaurantEnabled) return;

    const optionIds = new Set<number>();
    const modProductIds = new Set<number>();
    const lineProductIds = new Set<number>();
    for (const item of items) {
      if (Number(item.productId || 0) > 0) lineProductIds.add(Number(item.productId));
      for (const mod of Array.isArray(item.modifiers) ? item.modifiers : []) {
        const optionId = Number(mod?.optionId || mod?.option_id || 0);
        const productId = Number(mod?.productId || mod?.componentProductId || mod?.component_product_id || 0);
        if (optionId > 0) optionIds.add(optionId);
        if (productId > 0) modProductIds.add(productId);
      }
    }
    const tenantId = tenant.id;
    const optionRows = optionIds.size
      ? await this.db
          .selectFrom('pos_modifier_options')
          .select(['id', 'price', 'group_id'])
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .where('id', 'in', [...optionIds])
          .execute()
      : [];
    const truth: ModifierPriceTruth = {
      options: new Map(
        optionRows.map((row) => [Number(row.id), { price: Number(row.price), groupId: Number(row.group_id) }]),
      ),
      products: new Map(),
      addons: new Map(),
    };
    if (modProductIds.size) {
      const productRows = await this.db
        .selectFrom('products')
        .select(['id', 'retail_price'])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('id', 'in', [...modProductIds])
        .execute();
      for (const row of productRows) truth.products.set(Number(row.id), Number(row.retail_price));
      const addonRows = await this.db
        .selectFrom('addons')
        .select(['id', 'price'])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('id', 'in', [...modProductIds])
        .execute();
      for (const row of addonRows) truth.addons.set(Number(row.id), Number(row.price));
    }
    const linkedGroups = new Map<number, ModifierGroupRule[]>();
    if (lineProductIds.size) {
      const links = await this.db
        .selectFrom('product_pos_modifiers')
        .select(['product_id', 'modifier_group_id'])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('product_id', 'in', [...lineProductIds])
        .execute();
      const groupIds = [...new Set(links.map((l) => Number(l.modifier_group_id)))];
      const groupRows = groupIds.length
        ? await this.db
            .selectFrom('pos_modifier_groups')
            .select(['id', 'name', 'selection_type', 'is_mandatory', 'min_selections', 'max_selections', 'is_active'])
            .where(sql<boolean>`tenant_id = ${tenantId}`)
            .where('id', 'in', groupIds)
            .where('is_active', '=', true)
            .execute()
        : [];
      const groupsById = new Map(
        groupRows.map((g) => [
          Number(g.id),
          {
            id: Number(g.id),
            name: String(g.name),
            selectionType: String(g.selection_type || 'multiple'),
            isMandatory: Boolean(g.is_mandatory),
            minSelections: Number(g.min_selections || 0),
            maxSelections: Number(g.max_selections || 10),
            isActive: Boolean(g.is_active),
          },
        ]),
      );
      for (const link of links) {
        const group = groupsById.get(Number(link.modifier_group_id));
        if (!group) continue;
        const list = linkedGroups.get(Number(link.product_id)) || [];
        list.push(group);
        linkedGroups.set(Number(link.product_id), list);
      }
    }
    const repriced = enforceRestaurantModifierContract(items, truth, linkedGroups);
    repriced.forEach((item, index) => {
      items[index].modifiers = item.modifiers;
    });
  }

  /**
   * Delivery fee, zone, free-shipping rule and coupon for an order — ONE implementation for create
   * and edit. O56: the edit path had its own copy that reset the fee to the flat default and dropped
   * the zone, the coupon, the free-shipping rule and the pickup/dine-in exemption, so editing an
   * order silently changed what the customer owed.
   *
   * `alreadyClaimedCouponCode`: the coupon this order already consumed a use of. Re-applying it on
   * edit neither re-checks its remaining uses nor claims another one.
   */
  async resolveOrderCharges(
    tenantId: string,
    settings: Map<string, string>,
    params: {
      isDineIn: boolean;
      isPickup: boolean;
      deliveryZoneId?: number | null;
      deliveryZoneName?: string | null;
      subtotal: number;
      couponCode?: string | null;
      alreadyClaimedCouponCode?: string | null;
    },
  ): Promise<{
    deliveryFee: number;
    deliveryZoneId: number | null;
    deliveryZoneName: string | null;
    discountAmount: number;
    appliedCouponCode: string | null;
    /** Coupon whose use must be claimed in the order transaction (null when none, or already claimed). */
    couponId: number | null;
  }> {
    const { isDineIn, isPickup, subtotal } = params;
    let deliveryFee = isDineIn || isPickup ? 0 : Number(settings.get('storefront_delivery_fee') || 0);
    let deliveryZoneId: number | null = null;
    let deliveryZoneName: string | null = null;

    if (!isDineIn && !isPickup && params.deliveryZoneId) {
      const zone = await this.db
        .selectFrom('storefront_delivery_zones')
        .selectAll()
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('id', '=', params.deliveryZoneId)
        .where('is_active', '=', true)
        .executeTakeFirst();

      if (zone) {
        deliveryZoneId = zone.id;
        deliveryZoneName = zone.name;
        deliveryFee = Number(zone.delivery_fee || 0);
      }
    } else if (!isDineIn && !isPickup && params.deliveryZoneName && params.deliveryZoneName.trim()) {
      deliveryZoneName = params.deliveryZoneName.trim();
    }

    // Automatic free-shipping rule
    const freeShippingEnabled = settings.get('storefront_free_shipping_enabled') === 'true';
    const freeShippingMinOrder = Number(settings.get('storefront_free_shipping_min_order') || 0);
    if (freeShippingEnabled && freeShippingMinOrder > 0 && subtotal >= freeShippingMinOrder) {
      deliveryFee = 0;
    }

    let discountAmount = 0;
    let appliedCouponCode: string | null = null;
    let couponId: number | null = null;

    const codeUpper = String(params.couponCode || '')
      .trim()
      .toUpperCase();
    if (codeUpper) {
      const coupon = await this.db
        .selectFrom('storefront_coupons')
        .selectAll()
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('code', '=', codeUpper)
        .where('is_active', '=', true)
        .executeTakeFirst();

      if (coupon) {
        const alreadyClaimed =
          String(params.alreadyClaimedCouponCode || '').toUpperCase() === coupon.code.toUpperCase();
        // Coupon bounds are whole tenant days, never instants: a bound
        // stored as UTC midnight dies at 02:00 Cairo on its last day
        // under an instant comparison (NEW-I).
        const couponTimezone = await getTenantTimezone(this.db, tenantId);
        const couponTodayKey = todayTenantDate(couponTimezone);
        const couponUsable =
          couponDayState(coupon.start_date, coupon.end_date, couponTodayKey, couponTimezone) === 'active';
        const hasRemainingUsage =
          alreadyClaimed || coupon.usage_limit === null || Number(coupon.times_used || 0) < coupon.usage_limit;
        const meetsMinOrder = subtotal >= Number(coupon.min_order_amount || 0);

        if (couponUsable && hasRemainingUsage && meetsMinOrder) {
          appliedCouponCode = coupon.code;
          if (coupon.discount_type === 'free_shipping') {
            deliveryFee = 0;
          } else if (coupon.discount_type === 'percentage') {
            const pct = Math.min(100, Math.max(0, Number(coupon.discount_value)));
            const rawDiscount = (subtotal * pct) / 100;
            discountAmount = coupon.max_discount_amount
              ? Math.min(rawDiscount, Number(coupon.max_discount_amount))
              : rawDiscount;
          } else if (coupon.discount_type === 'fixed') {
            discountAmount = Math.min(subtotal, Number(coupon.discount_value));
          }
          // Strictly bound discount amount by subtotal so it can never exceed goods value
          discountAmount = Math.min(subtotal, Math.max(0, discountAmount));
          // Same canonical digits as the quote/create/update totals
          // (INV-STOREFRONT-LINE-TOTAL-DIGITS): the coupon discount
          // feeds those totals, so cutting it to cents here would
          // reintroduce the 2-decimal cut one step upstream. Only
          // the settings currency is available in this helper; it
          // is the primary source storefrontMoneyDigits reads.
          discountAmount = roundMoney(discountAmount, storefrontMoneyDigits(settings));
          // The use is claimed inside the caller's transaction (O57), never here.
          couponId = alreadyClaimed ? null : Number(coupon.id);
        }
      }
    }

    return { deliveryFee, deliveryZoneId, deliveryZoneName, discountAmount, appliedCouponCode, couponId };
  }

  /**
   * Authoritative server-side pricing quote for cart & checkout preview.
   * Calculates exact line totals, volume/BOGO discounts, coupons, and delivery fees without creating records.
   */
  async quoteOnlineOrder(slug: string, dto: QuoteCartDto) {
    const tenant = await this.getTenantBySlug(slug);
    const settings = await this.getTenantSettingsMap(tenant.id);
    const isDineIn = dto.orderType === 'dine_in' || Boolean(dto.tableNumber);
    const isPickup = dto.fulfillmentType === 'pickup';

    if (!dto.items || dto.items.length === 0) {
      return {
        ok: true,
        subtotal: 0,
        originalSubtotal: 0,
        bogoSavings: 0,
        discountAmount: 0,
        deliveryFee: 0,
        totalAmount: 0,
        items: [],
      };
    }

    const numericIds = dto.items.map((i) => Number(i.productId)).filter((id) => !isNaN(id) && id > 0);
    const stringIds = dto.items.map((i) => String(i.productId).trim()).filter(Boolean);

    const [dbProducts, activeOffers] = await Promise.all([
      this.db
        .selectFrom('products')
        .select(['id', 'name', 'retail_price', 'barcode', 'stock_qty', 'reserved_qty', 'metadata'])
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where('is_active', '=', true)
        .where((eb) => eb.or([eb('item_type', '=', 'product'), eb('item_type', 'is', null)]))
        .where((eb) => {
          const conditions = [];
          if (numericIds.length > 0) conditions.push(eb('id', 'in', numericIds));
          if (stringIds.length > 0) conditions.push(eb(sql<string>`CAST(id AS TEXT)`, 'in', stringIds));
          return conditions.length > 0 ? eb.or(conditions) : eb.val(false);
        })
        .execute(),
      numericIds.length > 0
        ? this.db
            .selectFrom('product_offers')
            .select([
              'id',
              'product_id',
              'offer_type',
              'value',
              sql<string>`start_date::text`.as('start_date'),
              sql<string>`end_date::text`.as('end_date'),
              'min_qty',
              'is_active',
              'bogo_buy_qty',
              'bogo_get_qty',
              'bogo_discount_percent',
              'happy_hour_start',
              'happy_hour_end',
              'days_of_week',
            ])
            .where(sql<boolean>`tenant_id = ${tenant.id}`)
            .where('product_id', 'in', numericIds)
            .where('is_active', '=', true)
            .execute()
        : Promise.resolve([]),
    ]);

    const offersByProductId = new Map<number, RawStorefrontOffer[]>();
    for (const off of activeOffers as RawStorefrontOffer[]) {
      const pid = Number(off.product_id);
      if (!offersByProductId.has(pid)) offersByProductId.set(pid, []);
      offersByProductId.get(pid)!.push(off);
    }

    const productMap = new Map<string | number, any>();
    for (const p of dbProducts) {
      productMap.set(p.id, p);
      productMap.set(String(p.id), p);
      const numId = Number(p.id);
      if (!isNaN(numId)) productMap.set(numId, p);
    }

    // One derivation for the whole quote: the line totals, the
    // subtotals, and the per-line engine calls all round at the
    // tenant's canonical book digits (INV-STOREFRONT-LINE-TOTAL-DIGITS).
    const moneyDigits = storefrontMoneyDigits(settings, tenant);

    let subtotal = 0;
    let originalSubtotal = 0;
    const validatedItems = [];

    for (const item of dto.items) {
      const prod =
        productMap.get(item.productId) ??
        productMap.get(Number(item.productId)) ??
        productMap.get(String(item.productId));
      if (!prod) continue;

      const priced = resolveOrderLinePrice(
        Number(prod.retail_price || 0),
        prod.metadata,
        item.variantName,
        moneyDigits,
      );
      const baseUnitPrice = priced.ok ? priced.unitPrice : Number(prod.retail_price || 0);
      const resolvedVariantName = priced.ok ? priced.variantName : item.variantName || null;
      const quantity = Math.max(1, Number(item.quantity || 1));
      const pOffers = offersByProductId.get(Number(prod.id)) || [];
      const bestOffer = resolveBestStorefrontOffer(
        baseUnitPrice,
        pOffers,
        quantity,
        undefined,
        new Date(),
        offerTimezone(settings),
        moneyDigits,
      );
      const unitPrice = bestOffer.hasDiscount ? bestOffer.price : baseUnitPrice;
      const lineTotal = roundMoney(unitPrice * quantity, moneyDigits);
      const originalLineTotal = roundMoney(baseUnitPrice * quantity, moneyDigits);

      subtotal += lineTotal;
      originalSubtotal += originalLineTotal;

      validatedItems.push({
        productId: prod.id,
        name: formatVariantLineName(prod.name, resolvedVariantName),
        variantName: resolvedVariantName,
        barcode: prod.barcode || '',
        quantity,
        baseUnitPrice,
        unitPrice,
        total: lineTotal,
        originalTotal: originalLineTotal,
        hasDiscount: bestOffer.hasDiscount,
        discountPercent: bestOffer.discountPercent,
        offerBadge: bestOffer.offerBadge,
        offerType: bestOffer.offerType,
      });
    }

    const { deliveryFee, deliveryZoneId, deliveryZoneName, discountAmount, appliedCouponCode } =
      await this.resolveOrderCharges(tenant.id, settings, {
        isDineIn,
        isPickup,
        deliveryZoneId: dto.deliveryZoneId,
        deliveryZoneName: dto.deliveryZoneName,
        subtotal,
        couponCode: dto.couponCode,
      });

    const bogoSavings = Math.max(0, roundMoney(originalSubtotal - subtotal, moneyDigits));
    const totalAmount = Math.max(0, subtotal - discountAmount) + deliveryFee;

    return {
      ok: true,
      subtotal: roundMoney(subtotal, moneyDigits),
      originalSubtotal: roundMoney(originalSubtotal, moneyDigits),
      bogoSavings,
      discountAmount: roundMoney(discountAmount, moneyDigits),
      deliveryFee: roundMoney(deliveryFee, moneyDigits),
      deliveryZoneId,
      deliveryZoneName,
      appliedCouponCode,
      totalAmount: roundMoney(totalAmount, moneyDigits),
      items: validatedItems,
    };
  }
}
