import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Kysely, sql, type Transaction, type Selectable } from 'kysely';
import { Database } from '../../../database/database.types';
import { CreateOnlineOrderDto } from '../dto/create-online-order.dto';
import { CustomerOrderRefDto } from '../dto/customer-order-lookup.dto';
import { resolveOrderLinePrice, formatVariantLineName } from '../engines/online-order-pricing.engine';
import { verifyOrderAccessToken } from '../engines/online-order-access.engine';
import { reserveLocationStock, releaseLocationStock } from '../../../common/utils/location-stock-ledger';
import {
  isReservationExpired,
  extractReservationItems,
  DEFAULT_ONLINE_PAYMENT_TIMEOUT_MS,
} from '../engines/storefront-reservation.engine';
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
 * StorefrontCustomerOrdersService — slice T3 of the storefront split.
 * Pure move of 5 methods from StorefrontService (lookupCustomerOrders,
 * findCustomerOrderByToken, cancelCustomerOrder, updateCustomerOrder,
 * reapExpiredReservations). No behavior change: the bodies are byte-identical;
 * the facade keeps thin delegates with the same names and signatures for the
 * 4 public methods. findCustomerOrderByToken was private in the facade and
 * stays PRIVATE here (its only callers are cancel/updateCustomerOrder inside
 * this slice) — the facade keeps NO delegate for it by design.
 * Deps: db + the facade kernel fns getTenantBySlug / getTenantSettingsMap
 * (bound deps) + the T1 order-quote methods resolveOrderCharges /
 * normalizeOnlineOrderModifiers / onlineOrderModifiersTotal /
 * enforceOnlineOrderModifierContract + the T8 coupon methods claimCouponUse /
 * releaseCouponUse (bound method deps — the moved text calls them as
 * this.<method> byte-identically) + the facade logger (reapExpiredReservations).
 * GENERATION-TREE NOTE: the ctor binds the T1/T8 methods from this.<method>
 * (they are still facade methods on the generation tree). At merge, T1 and T8
 * have already merged, so the coordinator repoints those six binds to
 * this.orderQuoteService.<m>.bind(this.orderQuoteService) (T1 x4) and
 * this.couponsService.<m>.bind(this.couponsService) (T8 x2).
 * Clock: NO todayTenantDate / getTenantTimezone sites in this slice (grep 0/0)
 * — only new Date() stamps, byte-identical. The 3 transaction callbacks use
 * trx only (no this.db reads inside) — PGlite trap N/A, verified by AST.
 * The 7 free functions used here come from '../storefront-helpers' (module
 * root, created by the T8 merge — T8 merges FIRST, so it exists at merge).
 */

export interface StorefrontCustomerOrdersDeps {
  db: Kysely<Database>;
  getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
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
    /** Coupon whose use must be claimed in the order transaction (null when none, or already claimed). */
    couponId: number | null;
  }>;
  normalizeOnlineOrderModifiers: (raw: unknown) => any[];
  onlineOrderModifiersTotal: (modifiers: any[] | undefined) => number;
  enforceOnlineOrderModifierContract: (
    items: Array<{ productId: number; modifiers?: any[] }>,
    tenant: { id: string; plan_id?: string | null; extra_features?: unknown; activity_type?: string | null },
  ) => Promise<void>;
  claimCouponUse: (trx: Transaction<Database>, tenantId: string, couponId: number) => Promise<void>;
  releaseCouponUse: (trx: Transaction<Database>, tenantId: string, couponCode: string) => Promise<void>;
  logger: Logger;
}

@Injectable()
export class StorefrontCustomerOrdersService {
  private readonly db: Kysely<Database>;
  private readonly getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  private readonly getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
  private readonly resolveOrderCharges: StorefrontCustomerOrdersDeps['resolveOrderCharges'];
  private readonly normalizeOnlineOrderModifiers: (raw: unknown) => any[];
  private readonly onlineOrderModifiersTotal: (modifiers: any[] | undefined) => number;
  private readonly enforceOnlineOrderModifierContract: StorefrontCustomerOrdersDeps['enforceOnlineOrderModifierContract'];
  private readonly claimCouponUse: (trx: Transaction<Database>, tenantId: string, couponId: number) => Promise<void>;
  private readonly releaseCouponUse: (
    trx: Transaction<Database>,
    tenantId: string,
    couponCode: string,
  ) => Promise<void>;
  private readonly logger: Logger;

  constructor(deps: StorefrontCustomerOrdersDeps) {
    this.db = deps.db;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
    this.resolveOrderCharges = deps.resolveOrderCharges;
    this.normalizeOnlineOrderModifiers = deps.normalizeOnlineOrderModifiers;
    this.onlineOrderModifiersTotal = deps.onlineOrderModifiersTotal;
    this.enforceOnlineOrderModifierContract = deps.enforceOnlineOrderModifierContract;
    this.claimCouponUse = deps.claimCouponUse;
    this.releaseCouponUse = deps.releaseCouponUse;
    this.logger = deps.logger;
  }

  /**
   * Public "my orders". Each order is reachable only with its own access token (SF-1).
   * Lookup by phone number was removed: a phone number is not a secret, and it returned the
   * name, address and order history of whoever owned that number.
   */
  async lookupCustomerOrders(slug: string, refs: CustomerOrderRefDto[]) {
    const tenant = await this.getTenantBySlug(slug);
    const tokenByNumber = new Map<string, string>();
    for (const ref of (refs || []).slice(0, 30)) {
      const num = String(ref?.orderNumber || '').trim();
      const tok = String(ref?.token || '').trim();
      if (num && tok) tokenByNumber.set(num, tok);
    }

    if (tokenByNumber.size === 0) {
      return { ok: true, orders: [] };
    }

    const qb = this.db
      .selectFrom('online_orders as o')
      .leftJoin('sales as s', (join) =>
        join.onRef('s.id', '=', 'o.sale_id').on(sql<boolean>`s.tenant_id = ${tenant.id}`),
      )
      .leftJoin('delivery_representatives as dr', (join) =>
        join.onRef('dr.id', '=', 's.delivery_rep_id').on(sql<boolean>`dr.tenant_id = ${tenant.id}`),
      )
      .select([
        'o.id',
        'o.order_number',
        'o.customer_name',
        'o.customer_phone',
        'o.customer_address',
        'o.customer_notes',
        'o.items_json',
        'o.subtotal',
        'o.delivery_fee',
        'o.delivery_zone_id',
        'o.delivery_zone_name',
        'o.total_amount',
        'o.status',
        'o.payment_method',
        'o.coupon_code',
        'o.discount_amount',
        'o.sale_id',
        'o.created_at',
        'o.updated_at',
        'dr.name as delivery_rep_name',
        'dr.phone as delivery_rep_phone',
        's.delivery_status as sale_delivery_status',
        'o.access_token_hash',
      ])
      .where(sql<boolean>`o.tenant_id = ${tenant.id}`)
      .where('o.order_number', 'in', Array.from(tokenByNumber.keys()));

    const candidates = await qb.orderBy('o.created_at', 'desc').limit(60).execute();
    // order_number is not unique even inside a tenant, so every candidate row is checked against
    // its own hash — a token proves ownership of one row, not of a number.
    const rows = candidates.filter((r) =>
      verifyOrderAccessToken(tokenByNumber.get(r.order_number), r.access_token_hash),
    );

    return {
      ok: true,
      orders: rows.map((r) => {
        let items: any[] = [];
        try {
          items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : r.items_json;
        } catch {}

        let effectiveStatus: string = r.status;
        if (r.status !== 'cancelled') {
          if (
            r.status === 'delivered' ||
            r.sale_delivery_status === 'delivered' ||
            r.sale_delivery_status === 'settled'
          ) {
            effectiveStatus = 'delivered';
          } else if (r.status === 'shipped' || r.sale_delivery_status === 'out_for_delivery') {
            effectiveStatus = 'shipped';
          }
        }

        return {
          id: r.id,
          orderNumber: r.order_number,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          customerAddress: r.customer_address,
          customerNotes: r.customer_notes,
          deliveryZoneId: r.delivery_zone_id ? Number(r.delivery_zone_id) : null,
          deliveryZoneName: r.delivery_zone_name || null,
          subtotal: Number(r.subtotal),
          deliveryFee: Number(r.delivery_fee),
          discountAmount: Number(r.discount_amount || 0),
          couponCode: r.coupon_code || null,
          totalAmount: Number(r.total_amount),
          status: effectiveStatus,
          paymentMethod: r.payment_method,
          saleId: r.sale_id,
          deliveryRepName: r.delivery_rep_name || null,
          deliveryRepPhone: r.delivery_rep_phone || null,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          items,
        };
      }),
    };
  }

  /**
   * SF-1: resolves a public order reference to the single row whose token hash matches.
   * A missing order and a wrong token return the same 404, so the route is not an oracle for
   * which order numbers exist.
   */
  private async findCustomerOrderByToken(tenantId: string, orderNumber: string, token: string | undefined) {
    const cleanOrderNumber = String(orderNumber || '').trim();
    if (!cleanOrderNumber || !token) {
      throw new NotFoundException('الطلب غير موجود');
    }

    const candidates = await this.db
      .selectFrom('online_orders')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('order_number', '=', cleanOrderNumber)
      .limit(10)
      .execute();

    const order = candidates.find((row) => verifyOrderAccessToken(token, row.access_token_hash));
    if (!order) {
      throw new NotFoundException('الطلب غير موجود');
    }
    return order;
  }

  async cancelCustomerOrder(slug: string, orderNumber: string, token: string | undefined) {
    const tenant = await this.getTenantBySlug(slug);
    const order = await this.findCustomerOrderByToken(tenant.id, orderNumber, token);

    if (order.status !== 'pending') {
      throw new BadRequestException('لا يمكن إلغاء الطلب لأنه قيد التجهيز أو تم اعتماده بالفعل من المتجر');
    }

    // A dine-in order is already on the kitchen screen; changes go through the staff.
    if (order.kitchen_draft_sale_id) {
      throw new BadRequestException('تم إرسال طلبك للمطبخ بالفعل، يرجى طلب الإلغاء من فريق الخدمة');
    }

    if (order.sale_id) {
      throw new BadRequestException('لا يمكن إلغاء الطلب لأنه تم إصدار فاتورة له');
    }

    // Paid online orders are not cancelled from the public side: the money has to be refunded,
    // and that is a merchant decision.
    if (order.payment_status === 'paid') {
      throw new BadRequestException(
        'لا يمكن إلغاء طلب تم سداده إلكترونياً من هنا، يرجى التواصل مع المتجر لاسترداد المبلغ',
      );
    }

    await this.db.transaction().execute(async (trx) => {
      const cancelled = await trx
        .updateTable('online_orders')
        .set({
          status: 'cancelled',
          stock_reserved: false,
          updated_at: new Date(),
        })
        .where('id', '=', order.id)
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where('status', '=', 'pending')
        .where('sale_id', 'is', null)
        .executeTakeFirst();

      if (Number(cancelled?.numUpdatedRows || 0) === 0) {
        // The store picked the order up (loaded it into the POS cart / started preparing it) between
        // our read and this write.
        throw new BadRequestException('لا يمكن إلغاء الطلب لأن المتجر بدأ في تجهيزه بالفعل');
      }

      if (order.stock_reserved) {
        let orderItems: Array<any> = [];
        try {
          const raw = order.items_json;
          orderItems = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
        } catch {}
        if (orderItems.length > 0) {
          await releaseLocationStock(trx, {
            branchId: order.reserved_branch_id ?? order.branch_id,
            locationId: order.reserved_location_id,
            tenantId: tenant.id,
            accountId: order.account_id,
            items: orderItems.map((it) => ({
              productId: Number(it.productId),
              qty: Number(it.quantity ?? it.qty ?? 1),
            })),
          });
        }
      }

      // A cancelled order gives its coupon use back (only the transition to 'cancelled' reaches here).
      if (order.coupon_code) {
        await this.releaseCouponUse(trx, tenant.id, String(order.coupon_code));
      }
    });

    return { ok: true, message: 'تم إلغاء الطلب بنجاح' };
  }

  async updateCustomerOrder(slug: string, orderNumber: string, token: string | undefined, dto: CreateOnlineOrderDto) {
    const tenant = await this.getTenantBySlug(slug);
    const order = await this.findCustomerOrderByToken(tenant.id, orderNumber, token);

    if (order.status !== 'pending') {
      throw new BadRequestException('لا يمكن تعديل الطلب لأنه قيد التجهيز أو تم اعتماده من المتجر');
    }

    if (order.kitchen_draft_sale_id) {
      throw new BadRequestException('تم إرسال طلبك للمطبخ بالفعل، يرجى طلب التعديل من فريق الخدمة');
    }

    if (order.sale_id) {
      throw new BadRequestException('لا يمكن تعديل الطلب لأنه تم إصدار فاتورة له');
    }

    // Changing items after payment would leave the paid amount out of step with the order total.
    if (order.payment_status === 'paid') {
      throw new BadRequestException('لا يمكن تعديل طلب تم سداده، يرجى التواصل مع المتجر');
    }

    const settings = await this.getTenantSettingsMap(tenant.id);
    const isEnabled = settings.get('storefront_enabled') !== 'false';
    if (!isEnabled) throw new BadRequestException('المتجر الإلكتروني متوقف حالياً');

    // The order keeps how it is fulfilled; an edit changes items, address, zone, coupon and notes.
    const isPickup = order.fulfillment_type === 'pickup';
    const isDineIn = order.fulfillment_type === 'dine_in' || order.order_type === 'dine_in';
    const minOrder = isDineIn ? 0 : Number(settings.get('storefront_min_order') || 0);

    if (dto.customerPhone) {
      assertValidCustomerPhone(dto.customerPhone, String(dto.countryCode || order.country_code || 'EG').toUpperCase());
    }

    if (dto.customerName) {
      assertValidCustomerName(dto.customerName.trim());
    }

    if (dto.customerAddress) {
      assertValidCustomerAddress(dto.customerAddress.trim());
    }

    const rawProductIds = dto.items.map((i) => Number(i.productId)).filter(Boolean);
    if (rawProductIds.length === 0) {
      throw new BadRequestException('يجب إضافة أصناف في السلة');
    }

    const catalogProducts = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'retail_price', 'stock_qty', 'metadata'])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('is_active', '=', true)
      .where((eb) => eb.or([eb('item_type', '=', 'product'), eb('item_type', 'is', null)]))
      .where('id', 'in', rawProductIds)
      .execute();

    const activeOffers = await this.db
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
      .where('product_id', 'in', rawProductIds)
      .where('is_active', '=', true)
      .execute();
    const offersByProductId = new Map<number, RawStorefrontOffer[]>();
    for (const offer of activeOffers) {
      const id = Number(offer.product_id);
      const list = offersByProductId.get(id) || [];
      list.push(offer);
      offersByProductId.set(id, list);
    }

    const productMap = new Map(catalogProducts.map((p) => [Number(p.id), p]));

    let subtotal = 0;
    const validatedItems: Array<{
      productId: number;
      name: string;
      variantName: string | null;
      quantity: number;
      unitPrice: number;
      total: number;
      notes?: string;
      modifiers?: any[];
    }> = [];

    const updateAllowsOutOfStock = isOutOfStockOrderingAllowed(settings, tenant.slug, tenant.activity_type);
    // Same canonical digits as quote/create (INV-STOREFRONT-LINE-TOTAL-DIGITS).
    const moneyDigits = storefrontMoneyDigits(settings, tenant);
    const seenProductIds = new Set<number>();
    // INV-REST-KIOSK-MODIFIER-UI (R7-B1): the edit path shares the
    // DTO, so it enforces the same contract — otherwise editing an
    // order that carries modifiers would silently drop them from
    // items_json (O56's lesson: the edit path must not silently change
    // what the customer owes or ordered).
    const updateContractItems = dto.items.map((item) => ({
      productId: Number(item.productId),
      modifiers: this.normalizeOnlineOrderModifiers(item.modifiers),
    }));
    await this.enforceOnlineOrderModifierContract(updateContractItems, tenant);
    for (const [itemIndex, item] of dto.items.entries()) {
      const p = productMap.get(Number(item.productId));
      if (!p) {
        throw new BadRequestException('أحد أصناف الطلب لم يعد متاحاً، يرجى تحديث السلة');
      }
      if (seenProductIds.has(Number(p.id))) {
        throw new BadRequestException(
          `لا يمكن طلب أكثر من مقاس أو سطر للصنف "${p.name}" في نفس الطلب، يرجى توحيده في سطر واحد.`,
        );
      }
      seenProductIds.add(Number(p.id));
      assertOnlineStockAvailable(
        p.name,
        Number(p.stock_qty ?? 0),
        Math.max(1, Number(item.quantity || 1)),
        updateAllowsOutOfStock,
      );

      const priced = resolveOrderLinePrice(Number(p.retail_price || 0), p.metadata, item.variantName, moneyDigits);
      if (!priced.ok) {
        throw new BadRequestException(`عفواً، المقاس المختار للصنف "${p.name}" لم يعد متاحاً، يرجى تحديث السلة.`);
      }
      const qty = Math.max(1, Number(item.quantity || 1));
      const bestOffer = resolveBestStorefrontOffer(
        priced.unitPrice,
        offersByProductId.get(Number(p.id)),
        qty,
        undefined,
        new Date(),
        offerTimezone(settings),
        moneyDigits,
      );
      const price = bestOffer.hasDiscount ? bestOffer.price : priced.unitPrice;
      // INV-REST-KIOSK-MODIFIER-UI (R7-B1): same POS line formula as
      // create — qty × (base + Σ re-priced modifier price × qty).
      const updateModifiers = updateContractItems[itemIndex].modifiers || [];
      const lineTotal = roundMoney((price + this.onlineOrderModifiersTotal(updateModifiers)) * qty, moneyDigits);

      subtotal += lineTotal;
      validatedItems.push({
        productId: Number(p.id),
        name: formatVariantLineName(p.name, priced.variantName),
        variantName: priced.variantName,
        quantity: qty,
        unitPrice: price,
        total: lineTotal,
        notes: item.notes ? String(item.notes).trim() : undefined,
        ...(updateModifiers.length > 0 ? { modifiers: updateModifiers } : {}),
      });
    }

    if (validatedItems.length === 0) {
      throw new BadRequestException('الأصناف المطلوبة غير متوفرة حالياً');
    }

    if (minOrder > 0 && subtotal < minOrder) {
      throw new BadRequestException(`الحد الأدنى للطلب هو ${minOrder} ج`);
    }

    const previousCoupon = order.coupon_code ? String(order.coupon_code) : null;
    const charges = await this.resolveOrderCharges(tenant.id, settings, {
      isDineIn,
      isPickup,
      deliveryZoneId: dto.deliveryZoneId ?? order.delivery_zone_id ?? null,
      deliveryZoneName: dto.deliveryZoneName ?? order.delivery_zone_name ?? null,
      subtotal,
      couponCode: dto.couponCode,
      alreadyClaimedCouponCode: previousCoupon,
    });
    const { deliveryFee, discountAmount } = charges;
    const totalAmount = Math.max(0, subtotal - discountAmount) + deliveryFee;
    // D-SF-08: same rounding as createOnlineOrder — the stored row
    // totals are rounded at book digits (see the note there).
    subtotal = roundMoney(subtotal, moneyDigits);
    const roundedDeliveryFee = roundMoney(deliveryFee, moneyDigits);
    const roundedDiscountAmount = roundMoney(discountAmount, moneyDigits);
    const roundedTotalAmount = roundMoney(
      Math.max(0, subtotal - roundedDiscountAmount) + roundedDeliveryFee,
      moneyDigits,
    );

    await this.db.transaction().execute(async (trx) => {
      const lockedOrder = await trx
        .selectFrom('online_orders')
        .selectAll()
        .where('id', '=', order.id)
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedOrder) {
        throw new NotFoundException('الطلب غير موجود');
      }

      if (
        lockedOrder.status !== 'pending' ||
        lockedOrder.sale_id ||
        lockedOrder.payment_status === 'paid' ||
        lockedOrder.kitchen_draft_sale_id ||
        lockedOrder.gateway_order_id
      ) {
        throw new BadRequestException('لا يمكن تعديل الطلب لتغير حالته أثناء الحفظ، يرجى إعادة المحاولة.');
      }
      if (
        String(lockedOrder.items_json) !== String(order.items_json) ||
        String(lockedOrder.coupon_code || '') !== String(order.coupon_code || '') ||
        Number(lockedOrder.total_amount) !== Number(order.total_amount)
      ) {
        throw new BadRequestException('تغير الطلب أثناء التعديل، يرجى تحديث الصفحة وإعادة المحاولة');
      }

      if (charges.couponId) {
        await this.claimCouponUse(trx, tenant.id, charges.couponId);
      }
      // The order no longer carries the coupon it consumed (removed, swapped, or no longer eligible).
      const currentOrderCoupon = lockedOrder.coupon_code ? String(lockedOrder.coupon_code) : null;
      if (
        currentOrderCoupon &&
        currentOrderCoupon.toUpperCase() !== String(charges.appliedCouponCode || '').toUpperCase()
      ) {
        await this.releaseCouponUse(trx, tenant.id, currentOrderCoupon);
      }

      if (lockedOrder.stock_reserved) {
        let oldItems: Array<any> = [];
        try {
          const raw = lockedOrder.items_json;
          oldItems = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
        } catch {}
        if (oldItems.length > 0) {
          await releaseLocationStock(trx, {
            branchId: lockedOrder.reserved_branch_id ?? lockedOrder.branch_id,
            locationId: lockedOrder.reserved_location_id,
            tenantId: tenant.id,
            accountId: lockedOrder.account_id,
            items: oldItems.map((it) => ({
              productId: Number(it.productId),
              qty: Number(it.quantity ?? it.qty ?? 1),
            })),
          });
        }
      }

      let nextStockReserved = false;
      if (!updateAllowsOutOfStock) {
        try {
          await reserveLocationStock(trx, {
            branchId: lockedOrder.reserved_branch_id ?? lockedOrder.branch_id,
            locationId: lockedOrder.reserved_location_id,
            tenantId: tenant.id,
            accountId: lockedOrder.account_id,
            items: validatedItems.map((it) => ({
              productId: it.productId,
              qty: it.quantity,
            })),
          });
          nextStockReserved = true;
        } catch (err: any) {
          throw new BadRequestException(err?.message || 'عفواً، الكمية المطلوبة بعد التعديل غير متوفرة في مخزون الفرع.');
        }
      }

      const result = await trx
        .updateTable('online_orders')
        .set({
          items_json: JSON.stringify(validatedItems),
          subtotal,
          delivery_fee: roundedDeliveryFee,
          delivery_zone_id: charges.deliveryZoneId,
          delivery_zone_name: charges.deliveryZoneName,
          discount_amount: roundedDiscountAmount,
          coupon_code: charges.appliedCouponCode,
          total_amount: roundedTotalAmount,
          stock_reserved: nextStockReserved,
          stock_reserved_at: nextStockReserved ? new Date() : null,
          customer_name: (dto.customerName || order.customer_name).trim(),
          customer_phone: (dto.customerPhone || order.customer_phone).trim(),
          customer_address: dto.customerAddress ? dto.customerAddress.trim() : order.customer_address,
          customer_notes: dto.customerNotes ? dto.customerNotes.trim() : order.customer_notes,
          payment_method: dto.paymentMethod || order.payment_method,
          updated_at: new Date(),
        })
        .where('id', '=', order.id)
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        // SF-6: the edit only lands while the store has not picked the order up. Without this, an edit
        // racing the cashier's "load into cart" rewrote an order the cashier was already billing.
        .where('status', '=', 'pending')
        .where('sale_id', 'is', null)
        .executeTakeFirst();

      // Throwing inside the transaction also rolls back the coupon claim/release above.
      if (Number(result?.numUpdatedRows || 0) === 0) {
        throw new BadRequestException('لا يمكن تعديل الطلب لأن المتجر بدأ في تجهيزه بالفعل');
      }
    });

    return {
      ok: true,
      orderNumber: order.order_number,
      totalAmount: roundedTotalAmount,
      subtotal,
      deliveryFee: roundedDeliveryFee,
      discountAmount: roundedDiscountAmount,
      couponCode: charges.appliedCouponCode,
      items: validatedItems,
      message: 'تم تحديث طلبك بنجاح!',
    };
  }

  /**
   * Reaps expired online order reservations to prevent Denial-of-Inventory.
   * Restores product_location_stock, releases claimed coupons, and marks the order cancelled.
   */
  async reapExpiredReservations(options?: {
    tenantId?: string;
    onlineTimeoutMs?: number;
    codTimeoutMs?: number;
    limit?: number;
  }): Promise<{ reapedOrdersCount: number; reapedOrderNumbers: string[]; scannedCount: number }> {
    const now = new Date();
    const batchLimit = Math.max(1, Math.min(100, options?.limit ?? 50));
    const onlineTimeout = options?.onlineTimeoutMs ?? DEFAULT_ONLINE_PAYMENT_TIMEOUT_MS;
    const cutoffDate = new Date(now.getTime() - onlineTimeout);

    const candidates = await this.db
      .selectFrom('online_orders')
      .select([
        'id',
        'tenant_id',
        'order_number',
        'status',
        'payment_method',
        'payment_status',
        'stock_reserved',
        'stock_reserved_at',
        'reserved_branch_id',
        'reserved_location_id',
        'branch_id',
        'account_id',
        'coupon_code',
        'items_json',
        'sale_id',
        'created_at',
      ])
      // INV-SF-REAPER-UNRESERVED-EXPIRY: no stock_reserved filter here.
      // Placement stores stock_reserved = false whenever the storefront
      // setting "allow ordering without stock" is ON, so requiring a
      // reservation hid every such order from the reaper. Expiry is by
      // the order clock; only the stock release below is reservation-gated.
      .where('status', '=', 'pending')
      .where('payment_status', '!=', 'paid')
      .where('sale_id', 'is', null)
      .$if(Boolean(options?.tenantId), (qb) => qb.where(sql<boolean>`tenant_id = ${options!.tenantId!}`))
      // D-SF-12: the engine falls back to created_at when stock_reserved_at is NULL —
      // the selector must do the same, or NULL-timestamp rows can never be reaped.
      .where(sql<boolean>`COALESCE(stock_reserved_at, created_at) < ${cutoffDate}`)
      .orderBy(sql`COALESCE(stock_reserved_at, created_at)`, 'asc')
      .limit(batchLimit)
      .execute();

    const reapedOrderNumbers: string[] = [];
    const scannedCount = candidates.length;

    for (const candidate of candidates) {
      if (!isReservationExpired(candidate, now, options)) {
        continue;
      }

      try {
        await this.db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('online_orders')
            .select([
              'id',
              'tenant_id',
              'order_number',
              'status',
              'payment_status',
              'payment_method',
              'stock_reserved',
              'stock_reserved_at',
              'created_at',
              'sale_id',
              'reserved_branch_id',
              'reserved_location_id',
              'branch_id',
              'account_id',
              'coupon_code',
              'items_json',
            ])
            .where('id', '=', candidate.id)
            .where(sql<boolean>`tenant_id = ${candidate.tenant_id}`)
            // INV-SF-REAPER-UNRESERVED-EXPIRY: no stock_reserved filter —
            // see the candidate select above.
            .where('status', '=', 'pending')
            .where('payment_status', '!=', 'paid')
            .where('sale_id', 'is', null)
            .forUpdate()
            .executeTakeFirst();

          if (!row || !isReservationExpired(row, new Date(), options)) return;

          // 1. Release location stock — ONLY when the order actually
          // reserved stock. An unreserved order holds nothing to release;
          // releasing its items would wrongly decrement another order's
          // reservation (INV-SF-REAPER-UNRESERVED-EXPIRY).
          const items = extractReservationItems(row.items_json);
          if (row.stock_reserved && items.length > 0) {
            await releaseLocationStock(trx, {
              tenantId: row.tenant_id,
              accountId: row.account_id,
              branchId: row.reserved_branch_id ?? row.branch_id,
              locationId: row.reserved_location_id,
              items: items.map((it) => ({ productId: it.productId, qty: it.quantity })),
            });
          }

          // 2. Release claimed coupon
          if (row.coupon_code) {
            await this.releaseCouponUse(trx, row.tenant_id, String(row.coupon_code));
          }

          // 3. Mark order as cancelled due to expired reservation
          await trx
            .updateTable('online_orders')
            .set({
              stock_reserved: false,
              status: 'cancelled',
              payment_status: row.payment_status === 'pending' ? 'failed' : row.payment_status,
              customer_notes: sql`CONCAT(COALESCE(customer_notes, ''), ' [تم إلغاء الطلب تلقائياً لانتهاء مهلة حجز المخزون والسداد]')`,
              updated_at: new Date(),
            })
            .where('id', '=', row.id)
            .where(sql<boolean>`tenant_id = ${row.tenant_id}`)
            .execute();

          reapedOrderNumbers.push(row.order_number);
        });
      } catch (err) {
        // Individual order failure shouldn't abort the whole batch — but it must never
        // vanish silently (D-SF-12): the order number + error name the failing row.
        this.logger.error(
          `Reaper failed for order ${candidate.order_number}: ${(err as Error)?.message || String(err)}`,
        );
      }
    }

    return {
      reapedOrdersCount: reapedOrderNumbers.length,
      reapedOrderNumbers,
      scannedCount,
    };
  }
}
