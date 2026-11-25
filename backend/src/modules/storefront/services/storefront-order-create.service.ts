import { Injectable, BadRequestException } from '@nestjs/common';
import { Transaction, Kysely, sql, type Selectable } from 'kysely';
import { Database } from '../../../database/database.types';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { CreateOnlineOrderDto } from '../dto/create-online-order.dto';
import { assertProductsNot86ed } from '../../sales/services/restaurant-advanced-fnb.service';
import { WhatsAppGatewayService } from '../../settings/services/whatsapp-gateway.service';
import { PlanFeatureService } from '../../../core/auth/services/plan-feature.service';
import {
  isStorefrontEntitledForOrders,
  STOREFRONT_NOT_ENTITLED_MESSAGE,
} from '../engines/storefront-entitlement.engine';
import { resolveOrderLinePrice, formatVariantLineName } from '../engines/online-order-pricing.engine';
import {
  issueOrderAccessToken,
  issueIdempotentOrderAccessToken,
  verifyOrderAccessToken,
  buildOrderTrackingUrl,
} from '../engines/online-order-access.engine';
import { reserveLocationStock } from '../../../common/utils/location-stock-ledger';
import { pickLocationCoveringOrder } from '../../../common/engines/branch-sellable-locations.engine';
import { resolveBestStorefrontOffer, RawStorefrontOffer } from '../engines/storefront-offers.engine';
import { roundMoney } from '../../accounting/engines/money-minor-units.engine';
import {
  assertValidCustomerPhone,
  assertValidCustomerName,
  assertValidCustomerAddress,
  offerTimezone,
  storefrontMoneyDigits,
  isOutOfStockOrderingAllowed,
  assertOnlineStockAvailable,
} from '../storefront-helpers';

/**
 * StorefrontOrderCreateService — slice T2 of the storefront split.
 * Pure move of 1 method from StorefrontService (createOnlineOrder, the
 * online-order creation path). No behavior change: the body is
 * byte-identical (public in the facade, public here; the facade keeps a
 * thin delegate with the same name/signature).
 * Deps: db + whatsappService? + planFeatureService? (both optional,
 * guarded in the moved text) + kernel getTenantBySlug +
 * getTenantSettingsMap (stay REAL private methods in the facade, passed
 * bound via the HR kernel pattern) + 8 bound method deps from slices
 * that merge BEFORE T2: claimCouponUse (T8, PUBLIC there, no facade
 * delegate by design) + resolveStorefrontStockScope (T6b) +
 * resolveOrderCharges / normalizeOnlineOrderModifiers /
 * onlineOrderModifiersTotal / enforceOnlineOrderModifierContract (T1) +
 * reapExpiredReservations (T3, fire-and-forget at L1804). The moved
 * text calls them as this.<method>(...) — the slice fields carry the
 * same names, so the calls are byte-identical (HR H1 pattern).
 * Free helpers (7) imported from '../storefront-helpers' (created with
 * the T8 merge — T8 merges FIRST; the file does not exist on this
 * generation tree, EXPECTED transient, merge-owned; HR H0 precedent).
 * Clock pins travel verbatim: todayTenantDate(businessTz, now) +
 * getTenantTimezone(this.db, tenant.id) (L2090-2092); new Date() stamps
 * byte-identical. No instant comparison, no UTC-slice normalizer.
 * Transaction: ONE this.db.transaction() site (L2097); its callback
 * (L2097-2283) contains ZERO this.db reads (only the bound
 * this.claimCouponUse dep) — PGlite trap NOT applicable.
 * Guard: the file's SINGLE toFixed2 lives here (L2335 formatMoney,
 * display only) — it moves WITH the slice; inlineRound 0. Allowlist
 * re-split travels in this patch (HR H5 pattern): facade entry 1 -> 0,
 * NEW slice entry toFixed2 1 added right after it.
 * Driving spec: createOnlineOrder driven by 8 spec files (prep §4.4).
 * No spec repoint travels in this patch — prep §7.3 rules all eight
 * source-text repoints MERGE-OWNED.
 * MERGE NOTE: the facade ctor wiring below references sibling slice
 * fields (couponsService, catalogDetailService, orderQuoteService,
 * customerOrdersService) created by the T8/T1/T6b/T3 merges BEFORE T2 —
 * on this generation tree those fields do not exist yet (EXPECTED
 * transient, HR H1 precedent); at merge, place this wiring AFTER the
 * sibling fields exist (the ctor already carries their wiring by then).
 * T3 merges BEFORE T2 (createOnlineOrder fire-and-forgets
 * reapExpiredReservations).
 */

export interface StorefrontOrderCreateDeps {
  db: Kysely<Database>;
  whatsappService?: WhatsAppGatewayService;
  planFeatureService?: PlanFeatureService;
  getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
  claimCouponUse: (trx: Transaction<Database>, tenantId: string, couponId: number) => Promise<void>;
  resolveStorefrontStockScope: (
    tenantId: string,
    settings: Map<string, string>,
    branchId?: number | null,
  ) => Promise<{ branchId: number | null; locations: Array<{ id: number; branchId: number | null }> }>;
  resolveOrderCharges: (
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
  ) => Promise<{
    deliveryFee: number;
    deliveryZoneId: number | null;
    deliveryZoneName: string | null;
    discountAmount: number;
    appliedCouponCode: string | null;
    couponId: number | null;
  }>;
  normalizeOnlineOrderModifiers: (raw: unknown) => any[];
  onlineOrderModifiersTotal: (modifiers: any[] | undefined) => number;
  enforceOnlineOrderModifierContract: (
    items: Array<{ productId: number; modifiers?: any[] }>,
    tenant: { id: string; plan_id?: string | null; extra_features?: unknown; activity_type?: string | null },
  ) => Promise<void>;
  reapExpiredReservations: (options?: {
    tenantId?: string;
    onlineTimeoutMs?: number;
    codTimeoutMs?: number;
    limit?: number;
  }) => Promise<{ reapedOrdersCount: number; reapedOrderNumbers: string[]; scannedCount: number }>;
}

@Injectable()
export class StorefrontOrderCreateService {
  private readonly db: Kysely<Database>;
  private readonly whatsappService?: WhatsAppGatewayService;
  private readonly planFeatureService?: PlanFeatureService;
  private readonly getTenantBySlug: StorefrontOrderCreateDeps['getTenantBySlug'];
  private readonly getTenantSettingsMap: StorefrontOrderCreateDeps['getTenantSettingsMap'];
  private readonly claimCouponUse: StorefrontOrderCreateDeps['claimCouponUse'];
  private readonly resolveStorefrontStockScope: StorefrontOrderCreateDeps['resolveStorefrontStockScope'];
  private readonly resolveOrderCharges: StorefrontOrderCreateDeps['resolveOrderCharges'];
  private readonly normalizeOnlineOrderModifiers: StorefrontOrderCreateDeps['normalizeOnlineOrderModifiers'];
  private readonly onlineOrderModifiersTotal: StorefrontOrderCreateDeps['onlineOrderModifiersTotal'];
  private readonly enforceOnlineOrderModifierContract: StorefrontOrderCreateDeps['enforceOnlineOrderModifierContract'];
  private readonly reapExpiredReservations: StorefrontOrderCreateDeps['reapExpiredReservations'];

  constructor(deps: StorefrontOrderCreateDeps) {
    this.db = deps.db;
    this.whatsappService = deps.whatsappService;
    this.planFeatureService = deps.planFeatureService;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
    this.claimCouponUse = deps.claimCouponUse;
    this.resolveStorefrontStockScope = deps.resolveStorefrontStockScope;
    this.resolveOrderCharges = deps.resolveOrderCharges;
    this.normalizeOnlineOrderModifiers = deps.normalizeOnlineOrderModifiers;
    this.onlineOrderModifiersTotal = deps.onlineOrderModifiersTotal;
    this.enforceOnlineOrderModifierContract = deps.enforceOnlineOrderModifierContract;
    this.reapExpiredReservations = deps.reapExpiredReservations;
  }

  async createOnlineOrder(slug: string, dto: CreateOnlineOrderDto, publicOrigin?: string) {
    const tenant = await this.getTenantBySlug(slug);
    const settings = await this.getTenantSettingsMap(tenant.id);

    if (settings.get('storefront_enabled') === 'false') {
      throw new BadRequestException('المتجر الإلكتروني متوقف حالياً عن استقبال الطلبات');
    }

    // INV-STOREFRONT-ORDERS: the toggle above is tenant-controlled and never proved
    // the storefront app is part of this tenant's plan/activity — a warehousing tenant
    // took orders while its plan excludes the storefront. New orders are refused here,
    // before the idempotency replay and before any stock or money moves. Already-recorded
    // orders are untouched and stay visible to admin in /online-orders.
    if (!this.planFeatureService || !isStorefrontEntitledForOrders(tenant, this.planFeatureService)) {
      throw new BadRequestException(STOREFRONT_NOT_ENTITLED_MESSAGE);
    }

    const isDineIn = dto.orderType === 'dine_in' || Boolean(dto.tableNumber);
    const isPickup = dto.fulfillmentType === 'pickup';

    if (isPickup) {
      const pickupEnabled = settings.get('storefront_pickup_enabled') !== 'false';
      if (!pickupEnabled) {
        throw new BadRequestException('خدمة الاستلام الذاتي من الفرع غير مفعلة لهذا المتجر');
      }
    }

    if (isDineIn) {
      const dineInEnabled = settings.get('storefront_dine_in_enabled') !== 'false';
      if (!dineInEnabled) {
        throw new BadRequestException('خدمة الطلب من الطاولة غير مفعلة لهذا المتجر');
      }
    }

    const cleanKey = dto.idempotencyKey?.trim() || '';
    const accessToken = cleanKey ? issueIdempotentOrderAccessToken(tenant.id, cleanKey) : issueOrderAccessToken();
    const replayResponse = (existingOrder: Selectable<Database['online_orders']>) => {
      if (!verifyOrderAccessToken(accessToken.token, existingOrder.access_token_hash)) {
        throw new BadRequestException('تعذر استعادة الطلب القديم بهذا المفتاح؛ يرجى التواصل مع المتجر');
      }
      let items: unknown[] = [];
      try {
        const parsed: unknown = JSON.parse(existingOrder.items_json || '[]');
        items = Array.isArray(parsed) ? parsed : [];
      } catch {}
      return {
        ok: true,
        orderId: existingOrder.id,
        orderNumber: existingOrder.order_number,
        accessToken: accessToken.token,
        trackingUrl: buildOrderTrackingUrl(publicOrigin, slug, existingOrder.order_number, accessToken.token),
        totalAmount: Number(existingOrder.total_amount),
        subtotal: Number(existingOrder.subtotal),
        deliveryFee: Number(existingOrder.delivery_fee),
        discountAmount: Number(existingOrder.discount_amount || 0),
        couponCode: existingOrder.coupon_code,
        items,
        idempotentDuplicate: true,
      };
    };

    if (cleanKey) {
      const existingOrder = await this.db
        .selectFrom('online_orders')
        .selectAll()
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where('idempotency_key', '=', cleanKey)
        .executeTakeFirst();
      if (existingOrder) return replayResponse(existingOrder);
    }

    // INV-REST-KIOSK-ORDER-TRUTH: a dine-in or pickup order needs staff on
    // site right now — the kitchen cannot cook an order nobody is staffed
    // to make, and a kiosk left on overnight must not keep taking them.
    // The gate mirrors hasOpenCashierShift (cashier_shifts status 'open',
    // tenant-scoped) minus the user/branch scoping: the kiosk is public,
    // with no user and no branch context — any open shift of the tenant
    // means someone is staffed. Plain delivery is fulfilled later, so it
    // is not gated (same scoping precedent as the POS-only shift check in
    // sales-write.service.ts). The replay above still returns an
    // already-created order after the shift closes: replaying creates no
    // new kitchen work.
    if (isDineIn || isPickup) {
      const openShift = await this.db
        .selectFrom('cashier_shifts')
        .select('id')
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where('status', '=', 'open')
        .executeTakeFirst();
      if (!openShift) {
        throw new BadRequestException('لا توجد وردية مفتوحة حالياً — لا يمكن استقبال طلبات جديدة');
      }
    }

    const countryCode = (dto.countryCode || 'EG').toUpperCase();

    if (!isDineIn) {
      assertValidCustomerPhone(dto.customerPhone, countryCode);
    }

    const cleanCustomerName = (dto.customerName || (isDineIn ? `عميل طاولة ${dto.tableNumber}` : '')).trim();
    assertValidCustomerName(cleanCustomerName);

    const cleanCustomerAddress = isDineIn
      ? `طاولة رقم ${dto.tableNumber}`
      : isPickup
        ? 'استلام ذاتي من الفرع'
        : (dto.customerAddress || '').trim();

    // An address that was provided must be non-empty after trimming;
    // no length or letter minimum beyond that. An absent address keeps
    // its previous treatment (optional at the DTO level).
    if (!isDineIn && !isPickup && dto.customerAddress != null && String(dto.customerAddress).length > 0) {
      assertValidCustomerAddress(cleanCustomerAddress);
    }

    const minOrder = isDineIn ? 0 : Number(settings.get('storefront_min_order') || 0);

    // Opportunistically reap expired online reservations for this tenant in the background
    void this.reapExpiredReservations({ tenantId: tenant.id, limit: 20 }).catch(() => {});

    // Fetch products in order to verify price and names
    const numericIds = dto.items.map((i) => Number(i.productId)).filter((id) => !isNaN(id) && id > 0);
    const stringIds = dto.items.map((i) => String(i.productId).trim()).filter(Boolean);

    const [dbProducts, activeOffers] = await Promise.all([
      this.db
        .selectFrom('products')
        .select(['id', 'name', 'retail_price', 'barcode', 'stock_qty', 'reserved_qty', 'metadata'])
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        // Same visibility rule as the public catalog (O52): an order may only contain what the
        // catalog shows. Anything else is "not available" — including deleted items still in a cart.
        .where('is_active', '=', true)
        .where((eb) => eb.or([eb('item_type', '=', 'product'), eb('item_type', 'is', null)]))
        .where((eb) => {
          const conditions = [];
          if (numericIds.length > 0) {
            conditions.push(eb('id', 'in', numericIds));
          }
          if (stringIds.length > 0) {
            conditions.push(eb(sql<string>`CAST(id AS TEXT)`, 'in', stringIds));
          }
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

    // Dual-indexed map (both Number and String keys) to eliminate any serialization type-mismatch
    const productMap = new Map<string | number, any>();
    for (const p of dbProducts) {
      productMap.set(p.id, p);
      productMap.set(String(p.id), p);
      const numId = Number(p.id);
      if (!isNaN(numId)) {
        productMap.set(numId, p);
      }
    }

    const allowOutOfStock = isOutOfStockOrderingAllowed(settings, tenant.slug, tenant.activity_type);

    const orderCurrency = String(settings.get('currency') || (tenant as any).currency || 'EGP')
      .trim()
      .toUpperCase();
    // Same canonical digits as the quote (INV-STOREFRONT-LINE-TOTAL-DIGITS).
    const moneyDigits = storefrontMoneyDigits(settings, tenant);

    // INV-REST-KIOSK-MODIFIER-UI (R7-B1): modifiers are validated and
    // re-priced BEFORE the lines are priced, so the re-priced extras
    // feed the line totals — the same fail-fast order createSale uses
    // (contract first, stock/offer work after). A 422 here leaves no
    // order row, no reservation and no coupon claim.
    const contractItems = dto.items.map((item) => ({
      productId: Number(item.productId),
      modifiers: this.normalizeOnlineOrderModifiers((item as any).modifiers),
    }));
    await this.enforceOnlineOrderModifierContract(contractItems, tenant);

    let subtotal = 0;
    // One line per product: the sales engine that will invoice this order rejects two rows of the
    // same product and unit (ensureUniqueFlowItems), so two variants of one product cannot both be
    // invoiced. The storefront cart already keeps a single variant per product.
    const seenProductIds = new Set<number>();
    const validatedItems = dto.items.map((item, itemIndex) => {
      const prod =
        productMap.get(item.productId) ??
        productMap.get(Number(item.productId)) ??
        productMap.get(String(item.productId));
      if (!prod) {
        throw new BadRequestException(`عفواً، أحد الأصناف المطلوبة غير متاح في المتجر حالياً، يرجى تحديث السلة.`);
      }
      if (seenProductIds.has(Number(prod.id))) {
        throw new BadRequestException(
          `لا يمكن طلب أكثر من مقاس أو سطر للصنف "${prod.name}" في نفس الطلب، يرجى توحيده في سطر واحد.`,
        );
      }
      seenProductIds.add(Number(prod.id));
      const availableStock = Math.max(0, Number(prod.stock_qty ?? 0) - Number(prod.reserved_qty ?? 0));
      assertOnlineStockAvailable(prod.name, availableStock, Math.max(1, Number(item.quantity || 1)), allowOutOfStock);
      // SF-4 / O54: the chosen variant is priced here, from the product's own metadata.
      const priced = resolveOrderLinePrice(
        Number(prod.retail_price || 0),
        prod.metadata,
        item.variantName,
        storefrontMoneyDigits(settings, tenant),
      );
      if (!priced.ok) {
        throw new BadRequestException(`عفواً، المقاس المختار للصنف "${prod.name}" لم يعد متاحاً، يرجى تحديث السلة.`);
      }
      const quantity = Math.max(1, Number(item.quantity || 1));
      const pOffers = offersByProductId.get(Number(prod.id)) || [];
      const bestOffer = resolveBestStorefrontOffer(
        priced.unitPrice,
        pOffers,
        quantity,
        undefined,
        new Date(),
        offerTimezone(settings),
        storefrontMoneyDigits(settings, tenant),
      );
      const unitPrice = bestOffer.hasDiscount ? bestOffer.price : priced.unitPrice;
      // INV-REST-KIOSK-MODIFIER-UI (R7-B1): the line total is the POS
      // formula — qty × (base unit price + Σ re-priced modifier
      // price × qty). The offer discounts the base price only; the
      // extras sit on top. unitPrice stays the base price (as in a
      // POS sale_items row, where unit_price is base and line_total
      // carries the modifiers); the conversion re-derives the same
      // total from price + modifiers.
      const modifiers = contractItems[itemIndex].modifiers || [];
      const modifiersTotal = this.onlineOrderModifiersTotal(modifiers);
      const lineTotal = roundMoney((unitPrice + modifiersTotal) * quantity, moneyDigits);
      subtotal += lineTotal;

      return {
        productId: prod.id,
        name: formatVariantLineName(prod.name, priced.variantName),
        variantName: priced.variantName,
        barcode: prod.barcode || '',
        quantity,
        unitPrice,
        total: lineTotal,
        notes: item.notes || '',
        ...(modifiers.length > 0 ? { modifiers } : {}),
      };
    });

    if (minOrder > 0 && subtotal < minOrder) {
      throw new BadRequestException(`الحد الأدنى للطلب هو ${minOrder} ج`);
    }

    const {
      deliveryFee,
      deliveryZoneId,
      deliveryZoneName,
      discountAmount,
      appliedCouponCode,
      couponId: couponIdToClaim,
    } = await this.resolveOrderCharges(tenant.id, settings, {
      isDineIn,
      isPickup,
      deliveryZoneId: dto.deliveryZoneId,
      deliveryZoneName: dto.deliveryZoneName,
      subtotal,
      couponCode: dto.couponCode,
    });

    const totalAmount = Math.max(0, subtotal - discountAmount) + deliveryFee;
    // D-SF-08: round the stored row totals at book digits — a sum of
    // rounded lines and a raw settings fee can still carry float dust
    // (0.1 + 0.2), and the stored total must equal the quote the
    // customer saw and the invoice the conversion recomputes. The total
    // is recomputed from the rounded components so the stored total
    // equals the stored parts exactly.
    subtotal = roundMoney(subtotal, moneyDigits);
    const roundedDeliveryFee = roundMoney(deliveryFee, moneyDigits);
    const roundedDiscountAmount = roundMoney(discountAmount, moneyDigits);
    const roundedTotalAmount = roundMoney(
      Math.max(0, subtotal - roundedDiscountAmount) + roundedDeliveryFee,
      moneyDigits,
    );

    // Get default primary branch
    const primaryBranch = await this.db
      .selectFrom('branches')
      .select(['id', 'default_stock_location_id', 'sales_stock_mode', 'allow_external_sales_stock'])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('is_active', '=', true)
      .orderBy('id', 'asc')
      .executeTakeFirst();

    const branchId = primaryBranch ? Number(primaryBranch.id) : null;
    const accountId = `${tenant.id}:main`;

    const targetBranchId = isPickup ? (dto.pickupBranchId ? Number(dto.pickupBranchId) : branchId) : branchId;

    // INV-REST-FNB-TRUTH-2 (R-I11): 86 enforcement — an 86'd line
    // fails as 422 ITEM_86ED naming the item, before any stock is
    // reserved or the order recorded. Branch-scoped like createSale:
    // a tenant-wide 86 blocks everywhere, a branch 86 only its branch.
    // INV-REST-KIOSK-MODIFIER-UI (R7-B1): the same check covers
    // modifier components — an 86'd cheese must refuse the order here,
    // not surface later at conversion. Only ids that are real products
    // of this tenant are checked: a flat addon's id lives in another
    // table and must never false-positive against a product id.
    const modifierComponentIds = [
      ...new Set(
        contractItems.flatMap((item) =>
          item.modifiers
            .map((mod: any) => Number(mod.productId || mod.componentProductId || mod.component_product_id || 0))
            .filter((id) => id > 0),
        ),
      ),
    ];
    const modifierComponentChecks: Array<{ productId: number; name?: string }> = [];
    if (modifierComponentIds.length > 0) {
      const componentRows = await this.db
        .selectFrom('products')
        .select(['id'])
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where('id', 'in', modifierComponentIds)
        .execute();
      const realProductIds = new Set(componentRows.map((row) => Number(row.id)));
      const seenComponents = new Set<number>();
      for (const item of contractItems) {
        for (const mod of item.modifiers) {
          const componentId = Number(mod.productId || mod.componentProductId || mod.component_product_id || 0);
          if (componentId > 0 && realProductIds.has(componentId) && !seenComponents.has(componentId)) {
            seenComponents.add(componentId);
            modifierComponentChecks.push({ productId: componentId, name: String(mod.name || '') });
          }
        }
      }
    }
    await assertProductsNot86ed(this.db, tenant.id, targetBranchId, [
      ...validatedItems.map((item) => ({ productId: item.productId, name: item.name })),
      ...modifierComponentChecks,
    ]);

    /**
     * المخزن الذي يُحجز منه هذا الطلب.
     *
     * كان السطر السابق يأخذ `default_stock_location_id` للفرع وينتهي، بلا سؤال عن
     * `sales_stock_mode`. فعلى منشأة مخزونها في «المخزن الرئيسي» بينما الفرع البائع مخزنه الافتراضي
     * فارغ، كان الكتالوج يعرض الصنف متاحاً (لأنه يقرأ الرصيد **العام**) ثم يُرفض الطلب بـ«الرصيد في
     * هذا المخزن 0» — **بينما الكاشير على نفس الفرع يبيعه**، لأنه وحده كان يقرأ ذلك الإعداد.
     *
     * الآن المساران يسألان نفس المحرك. وطلب المتجر يحجز في مخزن واحد (العمود مفرد)، فنختار أول
     * مخزن في ترتيب الأولوية يغطي **كل** أسطر الطلب.
     */
    let targetBranch:
      | {
          id: number | string;
          default_stock_location_id?: number | string | null;
          sales_stock_mode?: string | null;
          allow_external_sales_stock?: boolean | null;
        }
      | undefined;
    if (targetBranchId) {
      targetBranch =
        primaryBranch && targetBranchId === Number(primaryBranch.id)
          ? primaryBranch
          : await this.db
              .selectFrom('branches')
              .select(['id', 'default_stock_location_id', 'sales_stock_mode', 'allow_external_sales_stock'])
              .where('id', '=', targetBranchId)
              .where(sql<boolean>`tenant_id = ${tenant.id}`)
              .executeTakeFirst();
    }

    let targetLocationId: number | null = targetBranch?.default_stock_location_id
      ? Number(targetBranch.default_stock_location_id)
      : null;

    if (!allowOutOfStock) {
      // نفس المخازن التي حسب منها الكتالوج رصيده المعروض.
      const eligible = (await this.resolveStorefrontStockScope(tenant.id, settings, targetBranchId)).locations;

      if (eligible.length > 1) {
        const requiredByProduct = new Map<number, number>();
        for (const item of validatedItems) {
          const productId = Number(item.productId);
          requiredByProduct.set(productId, (requiredByProduct.get(productId) || 0) + Number(item.quantity));
        }

        const stockRows = await this.db
          .selectFrom('product_location_stock')
          .select(['product_id', 'location_id', 'qty', 'reserved_qty'])
          .where(sql<boolean>`tenant_id = ${tenant.id}`)
          .where('product_id', 'in', Array.from(requiredByProduct.keys()))
          .where(
            'location_id',
            'in',
            eligible.map((location) => location.id),
          )
          .execute();
        const availability = new Map<string, number>();
        for (const row of stockRows) {
          availability.set(
            `${Number(row.location_id)}:${Number(row.product_id)}`,
            Math.max(0, Number(row.qty || 0) - Number(row.reserved_qty || 0)),
          );
        }

        const chosen = pickLocationCoveringOrder(
          eligible,
          requiredByProduct,
          (locationId, productId) => availability.get(`${locationId}:${productId}`) || 0,
        );
        // لا مخزن واحد يغطي الطلب كله ⇒ نبقى على الافتراضي، فتظهر رسالة النقص الحقيقية بدل حجز ناقص.
        if (chosen) targetLocationId = chosen.id;
      }
    }

    // Date-based daily sequential numbering: ON-YYMMDD-0001. The day
    // is the TENANT's business day (INV-BUSINESS-DATE-TENANT-LOCAL),
    // never the host-local day: a 00:30 Cairo checkout must number
    // under the same day the period gates check.
    const now = new Date();
    const businessTz = await getTenantTimezone(this.db, tenant.id);
    const [yyyy, mm, dd] = todayTenantDate(businessTz, now).split('-');
    const datePrefix = `${yyyy.slice(-2)}${mm}${dd}`;
    let orderNumber = '';
    // The order and (for dine-in and pickup) its kitchen draft are written together: a QR order the kitchen never
    // sees, or a kitchen ticket with no order behind it, are both worse than a clear error.
    const creation = await this.db.transaction().execute(async (trx) => {
      // O57: numbering was MAX+1 outside any lock, so two checkouts in the same instant got the same
      // ON-YYMMDD-NNNN. A per-tenant transaction-scoped advisory lock serialises only this step (it is
      // released at commit/rollback), and the unique index from migration 134 backs it up.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'online_orders:' + tenant.id}))`.execute(trx);
      if (cleanKey) {
        const existing = await trx
          .selectFrom('online_orders')
          .selectAll()
          .where(sql<boolean>`tenant_id = ${tenant.id}`)
          .where('idempotency_key', '=', cleanKey)
          .executeTakeFirst();
        if (existing) {
          return { order: existing, replayed: true as const };
        }
      }
      const lastDoc = await trx
        .selectFrom('online_orders')
        .select(sql<number>`COALESCE(MAX(CAST(SPLIT_PART(order_number, '-', 3) AS INTEGER)), 0)`.as('last_seq'))
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where(sql<boolean>`order_number ~ ${'^ON-' + datePrefix + '-[0-9]+$'}`)
        .executeTakeFirst();
      orderNumber = `ON-${datePrefix}-${String(Number(lastDoc?.last_seq || 0) + 1).padStart(4, '0')}`;

      // Claim one coupon use ATOMICALLY, in the same transaction as the order (O57): the conditional
      // increment makes the database enforce usage_limit on the live row (no lost update), and a
      // failed order rolls the claim back instead of burning a use.
      if (couponIdToClaim) {
        await this.claimCouponUse(trx, tenant.id, couponIdToClaim);
      }

      let stockReserved = false;
      if (!allowOutOfStock) {
        try {
          await reserveLocationStock(trx, {
            branchId: targetBranchId,
            locationId: targetLocationId,
            tenantId: tenant.id,
            accountId,
            items: validatedItems.map((it) => ({
              productId: it.productId,
              qty: it.quantity,
            })),
          });
          stockReserved = true;
        } catch (err: any) {
          throw new BadRequestException(err?.message || 'عفواً، الكمية المطلوبة غير متوفرة في مخزون الفرع المحدد.');
        }
      }

      const inserted = await trx
        .insertInto('online_orders')
        .values({
          tenant_id: tenant.id,
          account_id: accountId,
          order_number: orderNumber,
          customer_name: cleanCustomerName,
          customer_phone: (dto.customerPhone || '').trim(),
          customer_address: cleanCustomerAddress,
          customer_notes: (dto.customerNotes || '').trim(),
          items_json: JSON.stringify(validatedItems),
          subtotal,
          delivery_fee: roundedDeliveryFee,
          delivery_zone_id: deliveryZoneId,
          delivery_zone_name: deliveryZoneName,
          discount_amount: roundedDiscountAmount,
          coupon_code: appliedCouponCode,
          total_amount: roundedTotalAmount,
          status: 'pending',
          payment_method: dto.paymentMethod || 'cod',
          payment_status: 'pending',
          branch_id: branchId,
          order_type: isDineIn ? 'dine_in' : 'delivery',
          fulfillment_type: isDineIn ? 'dine_in' : isPickup ? 'pickup' : 'delivery',
          country_code: countryCode,
          pickup_branch_id: isPickup ? dto.pickupBranchId || branchId : null,
          table_number: dto.tableNumber ? String(dto.tableNumber).trim() : null,
          sale_id: null,
          access_token_hash: accessToken.hash,
          stock_reserved: stockReserved,
          reserved_branch_id: stockReserved ? targetBranchId : null,
          reserved_location_id: stockReserved ? targetLocationId : null,
          stock_reserved_at: stockReserved ? now : null,
          idempotency_key: cleanKey || null,
        })
        .returning(['id', 'order_number', 'total_amount', 'created_at'])
        .executeTakeFirstOrThrow();

      if (isDineIn || isPickup) {
        // O53: a DRAFT sale, not a posted one. It exists only so the kitchen display (which reads
        // `sales`) shows the ticket immediately. It moves no stock, posts no journal and counts as no
        // revenue. The cashier posts the real invoice through SalesService (load into POS cart or
        // convert); retireKitchenDraft() then removes this draft and hands its ticket state over.
        // INV-REST-TAKEAWAY-KDS-DRAFT: a kiosk takeaway order (orderType 'delivery',
        // fulfillmentType 'pickup') gets a draft too — otherwise the kitchen never sees it,
        // because getActiveTickets reads only `sales` rows. Its order_type is 'takeaway', the
        // canonical POS type for a pickup order (the same value the convert path maps a pickup
        // order to), and it carries no table number. Plain delivery orders still get no draft.
        const draft = await trx
          .insertInto('sales')
          .values({
            tenant_id: tenant.id,
            account_id: accountId,
            doc_no: orderNumber,
            customer_id: null,
            customer_name: cleanCustomerName,
            customer_phone: null,
            customer_address: null,
            payment_type: 'cash',
            payment_channel: 'cash',
            subtotal,
            discount: roundedDiscountAmount,
            tax_rate: 0,
            tax_amount: 0,
            delivery_fee: 0,
            prices_include_tax: false,
            total: roundedTotalAmount,
            paid_amount: 0,
            tendered_amount: 0,
            change_amount: 0,
            store_credit_used: 0,
            status: 'draft',
            note: isDineIn
              ? `طلب ذاتي من الطاولة (${dto.tableNumber}) بالـ QR — مسودة للمطبخ، تُرحَّل من الكاشير`
              : 'طلب استلام ذاتي بالـ QR — مسودة للمطبخ، تُرحَّل من الكاشير',
            branch_id: branchId,
            location_id: null,
            created_by: null,
            cancelled_at: null,
            cancelled_by: null,
            cancel_reason: '',
            delivery_rep_id: null,
            delivery_status: null,
            collection_status: null,
            settled_at: null,
            settled_by: null,
            eta_uuid: null,
            eta_submission_id: null,
            order_type: isDineIn ? 'dine_in' : 'takeaway',
            // Empty string, not null: the sales table type carries table_number as a plain
            // string, and the sales writer uses '' for "no table" everywhere else.
            table_number: isDineIn ? String(dto.tableNumber).trim() : '',
          })
          .returning(['id'])
          .executeTakeFirstOrThrow();

        const draftSaleId = Number(draft.id);
        for (const it of validatedItems) {
          await trx
            .insertInto('sale_items')
            .values({
              tenant_id: tenant.id,
              account_id: accountId,
              sale_id: draftSaleId,
              product_id: Number(it.productId),
              product_name: it.name,
              qty: it.quantity,
              unit_price: it.unitPrice,
              line_total: it.total,
              unit_name: 'قطعة',
              unit_multiplier: 1,
              cost_price: 0,
              price_type: 'retail',
              notes: it.notes || '',
              // INV-REST-KIOSK-MODIFIER-UI (R7-B1): the draft is what
              // the kitchen display reads, so the chosen modifiers
              // ride on it — stored as a JSON string exactly like
              // createSale stores sale_items.modifiers, which the KDS
              // parses (string or array). A line with no modifiers
              // stores '[]', never null: the column is JSONB NOT NULL
              // DEFAULT '[]', so an explicit null rolls the whole
              // order back on Postgres 23502 (INV-REST-KIOSK-OWN-CATALOG-TRUTH).
              modifiers: (it as any).modifiers?.length ? JSON.stringify((it as any).modifiers) : '[]',
            })
            .execute();
        }

        await trx
          .updateTable('online_orders')
          .set({ kitchen_draft_sale_id: draftSaleId })
          .where('id', '=', inserted.id)
          .where(sql<boolean>`tenant_id = ${tenant.id}`)
          .execute();
      }

      return { order: inserted, replayed: false as const };
    });

    if (creation.replayed) return replayResponse(creation.order);
    const insertedOrder = creation.order;

    // Mark matching abandoned carts as recovered
    try {
      const cleanPhone = (dto.customerPhone || '').replace(/\D/g, '');
      if (cleanPhone && cleanPhone.length >= 6) {
        const suffix8 = cleanPhone.slice(-8);
        const phoneCandidates = Array.from(
          new Set(
            [
              cleanPhone,
              suffix8,
              `0${suffix8}`,
              `+20${suffix8}`,
              `+966${suffix8}`,
              dto.customerPhone ? dto.customerPhone.trim() : '',
            ].filter(Boolean),
          ),
        );

        await (this.db as any)
          .updateTable('storefront_abandoned_carts')
          .set({ recovered: true, updated_at: new Date() })
          .where(sql<boolean>`tenant_id = ${tenant.id}`)
          .where('customer_phone', 'in', phoneCandidates)
          .where('recovered', '=', false)
          .execute();
      }
    } catch {}

    // Tracking link for the shopper. The token rides in the URL FRAGMENT (#t=...): browsers never send
    // fragments to a server, so it stays out of access logs and referrers (SF-1). Opening the link on
    // any device registers the order there, which is how "my orders" follows the customer without an
    // account.
    const trackingUrl = buildOrderTrackingUrl(
      publicOrigin,
      slug,
      String(insertedOrder.order_number),
      accessToken.token,
    );

    // Non-blocking auto WhatsApp notification via gateway if enabled
    if (this.whatsappService) {
      void this.whatsappService
        .sendOnlineOrderNotification(insertedOrder.id, tenant.id, { trackingUrl })
        .catch(() => undefined);
    }

    // Prepare WhatsApp Message Text
    const whatsappPhone = settings.get('storefront_whatsapp') || settings.get('phone') || tenant.owner_phone || '';
    const cleanPhone = whatsappPhone.replace(/[^0-9]/g, '');
    const targetPhone = cleanPhone.startsWith('01') ? `2${cleanPhone}` : cleanPhone;

    const currencySymbol =
      orderCurrency === 'KWD'
        ? 'د.ك'
        : orderCurrency === 'SAR'
          ? 'ر.س'
          : orderCurrency === 'AED'
            ? 'د.إ'
            : orderCurrency === 'QAR'
              ? 'ر.ق'
              : orderCurrency === 'BHD'
                ? 'د.ب'
                : orderCurrency === 'OMR'
                  ? 'ر.ع'
                  : 'ج';
    const formatMoney = (n: number) =>
      moneyDigits === 3 ? n.toFixed(3) : orderCurrency === 'EGP' && n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);

    const itemsSummary = validatedItems
      .map((i) => `- ${i.name} (×${i.quantity}) = ${formatMoney(i.total)} ${currencySymbol}`)
      .join('\n');

    const paymentLabel =
      dto.paymentMethod === 'credit_card'
        ? 'بطاقة بنكية أونلاين (فيزا / ماستركارد)'
        : dto.paymentMethod === 'instapay_wallet'
          ? 'تحويل مسبق (إنستاباي / محفظة)'
          : 'دفع عند الاستلام (كاش)';
    const notesPart = dto.customerNotes ? `\nملاحظات: ${dto.customerNotes}` : '';
    const zonePart = deliveryZoneName ? `\nالمنطقة: ${deliveryZoneName}` : '';
    const discountPart =
      discountAmount > 0 ? `\nالخصم (${appliedCouponCode}): -${formatMoney(discountAmount)} ${currencySymbol}` : '';
    const shippingText = deliveryFee === 0 ? 'شحن مجاني' : `شامل التوصيل ${formatMoney(deliveryFee)} ${currencySymbol}`;

    const whatsappMessage = encodeURIComponent(
      `مرحباً، أود متابعة طلبي من متجركم:\n` +
        `رقم الطلب: #${orderNumber}\n` +
        `العميل: ${dto.customerName}\n` +
        `الهاتف: ${dto.customerPhone}\n` +
        `العنوان: ${dto.customerAddress || 'غير محدد'}` +
        `${zonePart}` +
        `${notesPart}\n` +
        `طريقة الدفع: ${paymentLabel}\n\n` +
        `الأصناف المطلوبة:\n${itemsSummary}\n\n` +
        `المجموع: ${formatMoney(subtotal)} ${currencySymbol}${discountPart}\n` +
        `الإجمالي: ${formatMoney(totalAmount)} ${currencySymbol} (${shippingText})`,
    );

    const whatsappUrl = targetPhone ? `https://wa.me/${targetPhone}?text=${whatsappMessage}` : null;

    return {
      ok: true,
      orderId: insertedOrder.id,
      orderNumber: insertedOrder.order_number,
      // Returned exactly once. The customer's browser keeps it; the server only has its hash (SF-1).
      accessToken: accessToken.token,
      trackingUrl,
      totalAmount: Number(insertedOrder.total_amount),
      subtotal,
      deliveryFee: roundedDeliveryFee,
      deliveryZoneId,
      deliveryZoneName,
      discountAmount: roundedDiscountAmount,
      couponCode: appliedCouponCode,
      items: validatedItems,
      whatsappUrl,
    };
  }
}
