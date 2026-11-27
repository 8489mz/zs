import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Kysely, sql, type Selectable } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { SalesService } from '../../sales/sales.service';
import { resolveOnlineOrderCollection, unwrapConvertedSale } from '../engines/online-order-access.engine';
import { isOutOfStockOrderingAllowed } from '../storefront-helpers';

/**
 * StorefrontOrderConvertService — slice T5 of the storefront split.
 * Pure move of 5 methods from StorefrontService (restorePendingAfterFailedConversion,
 * resolveStorefrontOutOfStockAllowance, resolveTenantDeliveryFeeMode,
 * convertToSale, prepareOrderForPos). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names and
 * signatures for the 2 public methods. The 3 privates stay PRIVATE here
 * (their only callers are convertToSale inside this slice) — the facade
 * keeps NO delegate for them by design.
 * Money exit: convertToSale is the most-driven method in the file (20 spec
 * files) and the money leaves via SalesService.createSale (called as
 * this.salesService, a bound dep) — the sale and its journal are posted by
 * SalesService, not here. convertToSale mentions no taxRate/tax_rate
 * (storefront-conversion-tax-exempt pin, grep 0). No posting fallback exists
 * in this file.
 * Deps: db + salesService (ctor-injected, required) + the facade kernel fn
 * getTenantSettingsMap (bound dep — getTenantBySlug is NOT used here, grep 0;
 * the tenant row is read via this.db directly) + the T4 merchant-orders
 * methods getOrder + retireKitchenDraft (bound method deps — the moved text
 * calls them as this.getOrder / this.retireKitchenDraft byte-identically) +
 * the facade logger (restorePendingAfterFailedConversion).
 * GENERATION-TREE NOTE: the ctor binds getOrder + retireKitchenDraft from
 * this.<method> (they are still facade methods on the generation tree). At
 * merge, T4 has already merged, so the coordinator repoints those two binds
 * to this.merchantOrdersService.<m>.bind(this.merchantOrdersService)
 * (T4 merges BEFORE T5). retireKitchenDraft was PRIVATE in the facade, so
 * T4 must make it PUBLIC in its slice (TS2341 otherwise) — the merge
 * coordinator verifies that before/while merging T5.
 * Clock: NO todayTenantDate / getTenantTimezone sites in this slice (grep
 * 0/0) — only 4 new Date() stamps, byte-identical. No transaction sites.
 * The 1 free function used here (isOutOfStockOrderingAllowed) comes from
 * '../storefront-helpers' (module root, created by the T8 merge — T8 merges
 * FIRST, so it exists at merge).
 */

export interface StorefrontOrderConvertDeps {
  db: Kysely<Database>;
  salesService: SalesService;
  getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
  getOrder: (
    id: number,
    actor: AuthContext,
  ) => Promise<
    Selectable<Database['online_orders']> & {
      subtotal: number;
      deliveryFee: number;
      deliveryZoneId: number | null;
      deliveryZoneName: string | null;
      discountAmount: number;
      couponCode: string | null;
      totalAmount: number;
      items: any[];
    }
  >;
  retireKitchenDraft: (tenantId: string, orderId: number, postedSaleId: number | null) => Promise<void>;
  logger: Logger;
}

@Injectable()
export class StorefrontOrderConvertService {
  private readonly db: Kysely<Database>;
  private readonly salesService: SalesService;
  private readonly getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
  private readonly getOrder: StorefrontOrderConvertDeps['getOrder'];
  private readonly retireKitchenDraft: (
    tenantId: string,
    orderId: number,
    postedSaleId: number | null,
  ) => Promise<void>;
  private readonly logger: Logger;

  constructor(deps: StorefrontOrderConvertDeps) {
    this.db = deps.db;
    this.salesService = deps.salesService;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
    this.getOrder = deps.getOrder;
    this.retireKitchenDraft = deps.retireKitchenDraft;
    this.logger = deps.logger;
  }

  /**
   * SF-2 D-SF-11: compensate a failed conversion. The SF-6 lock is a
   * standalone auto-commit write, so a failure after it (stock refusal,
   * missing branch location, any createSale throw) leaves the order in
   * 'processing' unless it is put back. Customer cancel/edit and the
   * expiry reaper all require 'pending', and updateOrderStatus refuses
   * moving backwards — so without this restore the order is stranded
   * with no UI escape. The restore is conditional (still 'processing',
   * still no invoice) so a concurrent conversion that already posted is
   * never clobbered; a restore failure is logged, never thrown, so it
   * cannot mask the original error.
   */
  private async restorePendingAfterFailedConversion(
    orderId: number,
    tenantId: string,
    tookLock: boolean,
  ): Promise<void> {
    if (!tookLock) return;
    try {
      await this.db
        .updateTable('online_orders')
        .set({ status: 'pending', updated_at: new Date() })
        .where('id', '=', orderId)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '=', 'processing')
        .where('sale_id', 'is', null)
        .execute();
    } catch (restoreErr) {
      this.logger.warn(
        `D-SF-11 restore to pending failed for online order ${orderId}: ${String((restoreErr as any)?.message || restoreErr)}`,
      );
    }
  }

  /**
   * SF-2 D-SF-11: the storefront placement promise for this tenant —
   * the same isOutOfStockOrderingAllowed rule placement used when the
   * order was taken. Fails closed (false) when the tenant row cannot
   * be read, so a missing tenant never silently allows negative stock.
   */
  private async resolveStorefrontOutOfStockAllowance(tenantId: string): Promise<boolean> {
    const tenant = await this.db
      .selectFrom('tenants')
      .select(['slug', 'activity_type'])
      .where('id', '=', tenantId)
      .executeTakeFirst()
      .catch(() => undefined);
    if (!tenant) return false;
    const settings = await this.getTenantSettingsMap(tenantId);
    return isOutOfStockOrderingAllowed(settings, tenant.slug, tenant.activity_type);
  }

  /**
   * INV-STOREFRONT-DELIVERY-FEE-MODE (H6, C3): the tenant's own
   * deliveryFeeMode setting governs a converted delivery sale —
   * never a hardcoded 'store_fleet'. Read exactly the way
   * createSale reads it (sales-write.service.ts:2129-2136): a
   * value naming 'store_fleet' keeps the fee as store revenue
   * (Cr 4200); a courier value makes the fee a rep payable
   * (Cr 2115). When the tenant never set a mode, null is returned
   * and createSale resolves it itself — its rep-type inference (a
   * store_fleet rep) plus its own settings fallback
   * (freelance_courier when nothing names store_fleet).
   */
  private async resolveTenantDeliveryFeeMode(tenantId: string): Promise<'store_fleet' | 'freelance_courier' | null> {
    const settings = await this.getTenantSettingsMap(tenantId);
    const raw = String(settings.get('deliveryFeeMode') || '').trim();
    if (!raw) return null;
    if (raw.includes('store_fleet')) return 'store_fleet';
    if (raw.includes('freelance_courier') || raw.includes('freelance')) return 'freelance_courier';
    return null;
  }

  async convertToSale(id: number, actor: AuthContext, explicitRepId?: number) {
    const { tenantId, accountId } = requireTenantScope(actor);
    const order = await this.getOrder(id, actor);

    if (order.sale_id) {
      const fullSale = await this.salesService.getSaleById(order.sale_id, actor);
      return {
        ok: true,
        saleId: order.sale_id,
        sale: unwrapConvertedSale(fullSale),
        message: 'تم تحويل الطلب لفاتورة مسبقاً',
      };
    }

    if (['cancelled', 'review_required', 'payment_failed'].includes(order.status)) {
      throw new BadRequestException('لا يمكن تحويل طلب ملغي إلى فاتورة');
    }

    // SF-6: take the order before billing it, then bill the version that is now locked.
    // SF-2 D-SF-11: the lock below is a standalone auto-commit write. Everything after it runs
    // inside the try that follows, so a failure restores 'pending' instead of stranding the
    // order in 'processing'. The try body is intentionally NOT re-indented: re-indenting
    // ~250 lines would bury the fix in noise; the contract is the try/catch pair itself.
    let tookConversionLock = false;
    if (order.status === 'pending') {
      const lockResult = await this.db
        .updateTable('online_orders')
        .set({ status: 'processing', updated_at: new Date() })
        .where('id', '=', id)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      tookConversionLock = Number(lockResult?.numUpdatedRows || 0) > 0;
      const lockedOrder = await this.getOrder(id, actor);
      Object.assign(order, lockedOrder);
      if (lockedOrder.status === 'cancelled') {
        throw new BadRequestException('لا يمكن تحويل طلب ملغي إلى فاتورة');
      }
    }

    try {
      // 1. Auto-Register / Find Customer in Customers Directory
      const cleanCustomerPhone = (order.customer_phone || '').replace(/\D/g, '');
      let customer = await this.db
        .selectFrom('customers')
        .select(['id', 'name', 'phone', 'address'])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('phone', '=', cleanCustomerPhone)
        .executeTakeFirst();

      let isNewCustomer = false;
      if (!customer && cleanCustomerPhone) {
        try {
          const inserted = await this.db
            .insertInto('customers')
            .values({
              name: (order.customer_name || 'عميل متجر أونلاين').trim(),
              phone: cleanCustomerPhone,
              address: (order.customer_address || '').trim(),
              balance: 0,
              customer_type: 'cash',
              is_active: true,
              tenant_id: tenantId,
              account_id: accountId,
            } as any)
            .returning(['id', 'name', 'phone', 'address'])
            .executeTakeFirst();

          customer = inserted;
          isNewCustomer = true;
        } catch (err) {
          // Fallback if customer insert fails (e.g. duplicate name constraint)
          customer = await this.db
            .selectFrom('customers')
            .select(['id', 'name', 'phone', 'address'])
            .where(sql<boolean>`tenant_id = ${tenantId}`)
            .where('phone', '=', cleanCustomerPhone)
            .executeTakeFirst();
        }
      }

      // 2. Prepare Sale lines
      const items = (order.items || []) as Array<any>;
      const lines = items.map((i) => ({
        productId: Number(i.productId),
        qty: Number(i.quantity ?? i.qty ?? 1),
        quantity: Number(i.quantity ?? i.qty ?? 1),
        price: Number(i.unitPrice ?? i.price ?? 0),
        unitPrice: Number(i.unitPrice ?? i.price ?? 0),
        unitName: 'قطعة',
        unitMultiplier: 1,
        priceType: 'retail',
        discount: 0,
        // INV-REST-KIOSK-MODIFIER-UI (R7-B1): the modifiers stored on
        // the order ride into the posted sale — createSale re-prices,
        // enforces and costs them under its own contract run, so the
        // invoice charges exactly what the customer picked.
        modifiers: i.modifiers,
        notes: (i.variantName ? `المقاس: ${i.variantName} - ` : '') + 'طلب متجر إلكتروني #' + order.order_number,
      }));

      // Find primary location for branch
      const targetBranchId = order.reserved_branch_id || order.branch_id || 1;
      const branch = await this.db
        .selectFrom('branches')
        .select(['id', 'default_stock_location_id'])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('id', '=', targetBranchId)
        .executeTakeFirst();

      const branchId = targetBranchId;
      // INV-STOREFRONT-LOCATION-FALLBACK-FAIL-CLOSED: never fall
      // back to location id 1. With no reserved location and no
      // branch default, conversion used to deduct silently from
      // whatever location 1 is -- a false shortage there and a
      // false surplus at the real location. Fail closed instead,
      // naming the branch default as the remedy.
      const locationId = order.reserved_location_id || branch?.default_stock_location_id;
      if (!locationId) {
        throw new BadRequestException(
          'لا يمكن تحويل الطلب إلى فاتورة: الفرع ليس له مكان مخزون افتراضي ولم يتم حجز مكان للطلب — حدد مكان المخزون الافتراضي للفرع أولاً',
        );
      }

      const isDineIn = order.order_type === 'dine_in' || order.fulfillment_type === 'dine_in';
      const isPickup = order.fulfillment_type === 'pickup' || order.order_type === 'pickup';
      const effectiveOrderType = isDineIn ? 'dine_in' : isPickup ? 'takeaway' : 'delivery';

      // 2.5 Resolve delivery representative (only for delivery orders)
      let repId: number | undefined = undefined;
      let repName = isPickup ? 'استلام من الفرع' : isDineIn ? 'صالة المطعم' : 'توصيل المتجر';
      if (effectiveOrderType === 'delivery') {
        repId = explicitRepId ? Number(explicitRepId) : 0;
        if (!repId || Number.isNaN(repId) || repId <= 0) {
          // INV-STOREFRONT-DELIVERY-FEE-MODE (H6, C3): a storefront
          // delivery picks a delivery-type rep, never a van rep
          // (rep_type 'van' runs van-sales trips, not storefront
          // deliveries). Legacy rows predate rep_type, so a NULL
          // rep_type still counts as a delivery rep.
          let activeRep = await this.db
            .selectFrom('delivery_representatives')
            .select(['id', 'name'])
            .where(sql<boolean>`tenant_id = ${tenantId}`)
            .where('is_active', '=', true)
            .where((eb) => eb.or([eb('rep_type', '!=', 'van'), eb('rep_type', 'is', null)]))
            .orderBy('id', 'asc')
            .executeTakeFirst();

          if (!activeRep) {
            // Auto-create default delivery rep for the store
            const insertedReps = await this.db
              .insertInto('delivery_representatives')
              .values({
                name: 'توصيل المتجر',
                phone: null,
                is_active: true,
                rep_type: 'store_fleet',
                // INV-STOREFRONT-DELIVERY-FEE-MODE (H6, C3): the auto
                // store rep is marked in metadata so it is
                // distinguishable from a merchant-created rep. It
                // carries no phone and no PIN, so it can never log
                // into the driver portal — driverLogin skips reps
                // without phone + pin_hash.
                metadata: { auto_created_store_rep: true },
                tenant_id: tenantId,
                account_id: String(accountId || 1),
              })
              .returning(['id', 'name'])
              .execute();
            activeRep = insertedReps[0];
          }
          repId = Number(activeRep.id);
          repName = activeRep.name;
        }
      }

      // SF-2 D-SF-11: ONE stock gate for storefront orders. Placement
      // allowed this order under isOutOfStockOrderingAllowed (the
      // storefront's own promise: storefront_allow_out_of_stock /
      // restaurant / default tenant); conversion re-refused it under the
      // separate POS allowNegativeStockSales setting, so an order the
      // store was allowed to take could never convert. The placement
      // setting now governs the conversion too, through the internal-only
      // SystemApprovedSaleTerms (never part of the HTTP DTO, so no client
      // can claim it). Walk-in POS sales pass no flag and keep the POS
      // setting alone.
      const storefrontAllowOutOfStock = await this.resolveStorefrontOutOfStockAllowance(tenantId);

      // INV-STOREFRONT-DELIVERY-FEE-MODE (H6, C3): the tenant's own
      // deliveryFeeMode setting governs the converted sale — never a
      // hardcoded 'store_fleet'. A null here (tenant never set a
      // mode) lets createSale resolve it itself.
      const tenantDeliveryFeeMode =
        effectiveOrderType === 'delivery' ? await this.resolveTenantDeliveryFeeMode(tenantId) : null;

      // 3. Call SalesService to create formal sale delivery invoice.
      // SF-3: the invoice is born "collected" only when a real gateway webhook or a merchant user
      // confirmed the money. Choosing InstaPay at checkout, or paying in the sandbox simulator, is
      // not a payment — those stay cash-on-delivery until confirmed (confirmManualPayment).
      const { collected: isPaidOnline, paymentChannel, provider } = resolveOnlineOrderCollection(order);
      // O55: the coupon discount the customer was quoted at checkout must reach the invoice, or the
      // courier collects the undiscounted total at the door.
      const orderDiscount = Math.max(0, Number(order.discountAmount || 0));
      const salePayload: any = {
        onlineOrderId: id,
        customerId: customer ? Number(customer.id) : undefined,
        customerName: customer ? customer.name : order.customer_name,
        customerPhone: cleanCustomerPhone,
        customerAddress: order.customer_address,
        paymentType: 'cash',
        paymentChannel,
        orderType: effectiveOrderType,
        tableNumber: isDineIn ? order.table_number || undefined : undefined,
        deliveryRepId: repId,
        deliveryStatus: effectiveOrderType === 'delivery' ? 'pending' : null,
        collectionStatus: isPaidOnline ? 'prepaid_online' : effectiveOrderType === 'delivery' ? 'cod' : null,
        deliveryFeeMode: tenantDeliveryFeeMode,
        branchId,
        locationId,
        deliveryFee: effectiveOrderType === 'delivery' ? Number(order.deliveryFee || 0) : 0,
        discount: orderDiscount,
        items: lines,
        note: [
          `طلب متجر إلكتروني #${order.order_number}`,
          order.couponCode ? `كوبون ${order.couponCode}` : '',
          provider ? `مسدد عبر ${provider === 'manual' ? 'تحويل مؤكد يدوياً' : provider}` : '',
        ]
          .filter(Boolean)
          .join(' - '),
        paidAmount: isPaidOnline ? order.totalAmount : 0,
        // Cash tender only: the tender engine rejects a cash tender
        // with no cash payment line, and a gateway-paid order has
        // only a card line. Sending the total here used to fail
        // every paid conversion with CASH_TENDER_WITHOUT_CASH
        // before the collection-status gate was ever reached.
        tenderedAmount: 0,
        payments: isPaidOnline
          ? [
              {
                paymentChannel,
                amount: order.totalAmount,
              },
            ]
          : [],
      };

      // Terms fixed by the server at checkout (coupon + catalog prices, SF-4) are pre-approved; anything
      // beyond them still goes through the normal cashier gates.
      const approvedUnitPrices: Record<number, number> = {};
      for (const line of lines) approvedUnitPrices[line.productId] = line.unitPrice;
      let saleResult: any;
      try {
        saleResult = await this.salesService.createSale(salePayload, actor, {
          approvedDiscount: orderDiscount,
          approvedUnitPrices,
          // SF-2 D-SF-11: the storefront placement promise (see above).
          allowNegativeStock: storefrontAllowOutOfStock,
        });
      } catch (err: any) {
        if (err?.code === 'ORDER_ALREADY_INVOICED' || err?.message?.includes('تم تحويل هذا الطلب')) {
          const latestOrder = await this.getOrder(id, actor);
          if (latestOrder.sale_id) {
            const fullSale = await this.salesService.getSaleById(latestOrder.sale_id, actor);
            return {
              ok: true,
              saleId: latestOrder.sale_id,
              sale: unwrapConvertedSale(fullSale),
              message: 'تم تحويل الطلب لفاتورة مسبقاً',
            };
          }
        }
        throw err;
      }
      const saleId = Number(
        saleResult?.id || saleResult?.sale?.id || (typeof saleResult === 'number' ? saleResult : 0),
      );

      // Update order with saleId and status: 'shipped' for delivery, or 'delivered' for pickup/dine-in
      await this.db
        .updateTable('online_orders')
        .set({
          sale_id: saleId > 0 ? saleId : null,
          status: effectiveOrderType === 'delivery' ? 'shipped' : 'delivered',
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      if (saleId > 0) {
        await this.retireKitchenDraft(tenantId, id, saleId);
      }

      const fullSale = saleId > 0 ? await this.salesService.getSaleById(saleId, actor) : null;

      return {
        ok: true,
        saleId,
        sale: unwrapConvertedSale(fullSale || saleResult),
        customerName: customer?.name || order.customer_name,
        isNewCustomer,
        customerId: customer?.id,
        deliveryRepName: repName,
      };
    } catch (err) {
      // SF-2 D-SF-11: the lock already committed — put the order back to
      // 'pending' (no invoice exists on this path; the already-invoiced
      // branch above returns instead of throwing). The restore is
      // conditional on still-'processing' + still-no-invoice, so a
      // concurrent conversion that posted is never clobbered.
      await this.restorePendingAfterFailedConversion(id, tenantId, tookConversionLock);
      throw err;
    }
  }

  async prepareOrderForPos(id: number, actor: AuthContext) {
    const { tenantId, accountId } = requireTenantScope(actor);
    const order = await this.getOrder(id, actor);

    if (['cancelled', 'review_required', 'payment_failed'].includes(order.status)) {
      throw new BadRequestException('هذا الطلب تم إلغاؤه من قبل العميل ولا يمكن تنزيله في السلة');
    }
    if (order.sale_id) {
      throw new BadRequestException(`هذا الطلب تم تحويله لفاتورة مسبقاً برقم #${order.sale_id}`);
    }

    // SF-6: loading the order into the POS cart is the moment the store takes it. Moving it out of
    // 'pending' here is what stops the customer from editing or cancelling it from the storefront
    // while the cashier bills the version they loaded (both customer routes require 'pending').
    // Before this, the order stayed 'pending' until the sale was posted.
    // SF-2 D-SF-11: same defect class as convertToSale — the lock is a standalone auto-commit
    // write, so a failure after it must restore 'pending' (same try/catch contract below; the
    // try body is intentionally NOT re-indented, see convertToSale).
    let tookPosLock = false;
    if (order.status === 'pending') {
      const lockResult = await this.db
        .updateTable('online_orders')
        .set({ status: 'processing', updated_at: new Date() })
        .where('id', '=', id)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      tookPosLock = Number(lockResult?.numUpdatedRows || 0) > 0;
    }

    try {
      // Re-read after taking the order, so the cart gets exactly the version that is now locked
      // (a customer edit may have landed between the first read and the status change).
      const lockedOrder = await this.getOrder(id, actor);
      if (['cancelled', 'review_required', 'payment_failed'].includes(lockedOrder.status)) {
        throw new BadRequestException('هذا الطلب تم إلغاؤه من قبل العميل ولا يمكن تنزيله في السلة');
      }
      Object.assign(order, lockedOrder);

      // 1. Ensure Customer Exists
      const rawPhone = (order.customer_phone || '').trim();
      const cleanCustomerPhone = rawPhone.replace(/\D/g, '');
      let customer = await this.db
        .selectFrom('customers')
        .select(['id', 'name', 'phone', 'address'])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where((eb) => eb.or([eb('phone', '=', cleanCustomerPhone), eb('phone', '=', rawPhone)]))
        .executeTakeFirst();

      let isNewCustomer = false;
      if (!customer) {
        try {
          const inserted = await this.db
            .insertInto('customers')
            .values({
              name: order.customer_name || 'عميل متجر أونلاين',
              phone: cleanCustomerPhone || rawPhone,
              address: order.customer_address || '',
              balance: 0,
              customer_type: 'cash',
              is_active: true,
              tenant_id: tenantId,
              account_id: accountId,
            } as any)
            .returning(['id', 'name', 'phone', 'address'])
            .executeTakeFirst();
          customer = inserted;
          isNewCustomer = true;
        } catch (err) {
          customer = await this.db
            .selectFrom('customers')
            .select(['id', 'name', 'phone', 'address'])
            .where(sql<boolean>`tenant_id = ${tenantId}`)
            .where((eb) => eb.or([eb('phone', '=', cleanCustomerPhone), eb('phone', '=', rawPhone)]))
            .executeTakeFirst();
        }
      }

      // 2. Fetch product details for items
      const rawItems = (order.items || []) as Array<any>;
      const productIds = rawItems.map((it) => Number(it.productId)).filter(Boolean);

      const products =
        productIds.length > 0
          ? await this.db
              .selectFrom('products')
              .select(['id', 'name', 'retail_price', 'cost_price', 'stock_qty'])
              .where(sql<boolean>`tenant_id = ${tenantId}`)
              .where('id', 'in', productIds)
              .execute()
          : [];

      const productMap = new Map(products.map((p) => [Number(p.id), p]));

      const mappedItems = rawItems.map((it: any) => {
        const p = productMap.get(Number(it.productId));
        return {
          productId: Number(it.productId),
          // Keep the variant in the name ("Pizza (Large)") so the cashier sees what was ordered.
          name: it.variantName ? it.name : p?.name || it.name,
          price: Number(it.unitPrice ?? it.price ?? p?.retail_price ?? 0),
          costPrice: Number(p?.cost_price || 0),
          qty: Number(it.quantity ?? it.qty ?? 1),
          stockQty: Number(p?.stock_qty || 0),
          unitName: 'قطعة',
        };
      });

      return {
        ok: true,
        orderId: order.id,
        orderNumber: order.order_number,
        customerId: customer ? Number(customer.id) : null,
        customerName: customer?.name || order.customer_name,
        customerPhone: cleanCustomerPhone,
        customerAddress: customer?.address || order.customer_address || '',
        deliveryFee: Number(order.deliveryFee || 0),
        totalAmount: Number(order.totalAmount || 0),
        discountAmount: Number(order.discountAmount || 0),
        couponCode: order.couponCode || null,
        // A QR table order is posted as dine-in for that table, so the kitchen ticket that replaces its
        // draft (retireKitchenDraft) keeps the right table and order type.
        orderType:
          order.order_type === 'dine_in'
            ? 'dine_in'
            : order.fulfillment_type === 'pickup' || order.order_type === 'pickup'
              ? 'takeaway'
              : 'delivery',
        tableNumber: order.table_number || '',
        items: mappedItems,
        customerNotes: order.customer_notes || '',
        paymentMethod: order.payment_method || 'cod',
        isNewCustomer,
      };
    } catch (err) {
      // SF-2 D-SF-11: the lock already committed and no sale was posted
      // on this path — put the order back to 'pending'.
      await this.restorePendingAfterFailedConversion(id, tenantId, tookPosLock);
      throw err;
    }
  }
}
