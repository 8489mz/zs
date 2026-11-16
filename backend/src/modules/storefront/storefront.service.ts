import { Inject, Injectable, NotFoundException, BadRequestException, ServiceUnavailableException, Optional, Logger } from '@nestjs/common';
import { Kysely, sql, type Transaction } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import {  getTenantTimezone,  todayTenantDate } from '../../common/utils/tenant-timezone.util';
import { CreateOnlineOrderDto } from './dto/create-online-order.dto';
import { CreateProductReviewDto } from './dto/create-product-review.dto';
import { UpdateStorefrontSettingsDto } from './dto/update-storefront-settings.dto';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';
import { CreateDeliveryZoneDto, UpdateDeliveryZoneDto } from './dto/delivery-zone.dto';
import { RecordAbandonedCartDto } from './dto/abandoned-cart.dto';
import { SalesService } from '../sales/sales.service';
import { KdsService } from '../sales/services/kds.service';
import { StorefrontMediaService } from './storefront-media.service';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { PlanFeatureService } from '../../core/auth/services/plan-feature.service';
import { CustomerOrderRefDto } from './dto/customer-order-lookup.dto';
import { computeTableBillTotals } from './engines/table-bill.engine';
import {
  resolveOnlineOrderCollection,
  unwrapConvertedSale,
} from './engines/online-order-access.engine';
import { releaseLocationStock } from '../../common/utils/location-stock-ledger';
import { StorefrontCouponsService } from './services/storefront-coupons.service';
import { StorefrontOrderQuoteService } from './services/storefront-order-quote.service';
import { StorefrontCatalogDetailService } from './services/storefront-catalog-detail.service';
import { StorefrontCatalogService } from './services/storefront-catalog.service';
import { StorefrontCustomerOrdersService } from './services/storefront-customer-orders.service';
import { StorefrontSettingsService } from './services/storefront-settings.service';
import { StorefrontEngagementService } from './services/storefront-engagement.service';
import { StorefrontMerchantOrdersService } from './services/storefront-merchant-orders.service';

import {
  storefrontMoneyDigits,
  isOutOfStockOrderingAllowed,
} from './storefront-helpers';
import { StorefrontOrderCreateService } from './services/storefront-order-create.service';

export { unwrapConvertedSale };

@Injectable()
export class StorefrontService {
  private readonly couponsService: StorefrontCouponsService;
  private readonly customerOrdersService: StorefrontCustomerOrdersService;
  private readonly logger = new Logger(StorefrontService.name);

  private readonly orderQuoteService: StorefrontOrderQuoteService;

  private readonly catalogDetailService: StorefrontCatalogDetailService;

  private readonly catalogService: StorefrontCatalogService;

  private readonly orderCreateService: StorefrontOrderCreateService;

  private readonly settingsService: StorefrontSettingsService;

  private readonly engagementService: StorefrontEngagementService;

  private readonly merchantOrdersService: StorefrontMerchantOrdersService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly salesService: SalesService,
    private readonly kdsService: KdsService,
    private readonly media: StorefrontMediaService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
    // Optional only so hand-built test doubles (4-arg construction) keep compiling;
    // under Nest DI the global AuthFoundationModule always provides it, and the gate
    // below fails closed when it is absent.
    @Optional() private readonly planFeatureService?: PlanFeatureService,
  ) {
    this.couponsService = new StorefrontCouponsService({
      db: this.db,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
    });
    this.catalogDetailService = new StorefrontCatalogDetailService({
      db: this.db,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
    });
    this.orderQuoteService = new StorefrontOrderQuoteService({
      db: this.db,
      planFeatureService: this.planFeatureService,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
    });
    this.catalogService = new StorefrontCatalogService({
      db: this.db,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
      resolveStorefrontStockScope: this.resolveStorefrontStockScope.bind(this),
      loadStorefrontAvailability: this.loadStorefrontAvailability.bind(this),
    });
    this.customerOrdersService = new StorefrontCustomerOrdersService({
      db: this.db,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
      resolveOrderCharges: this.resolveOrderCharges.bind(this),
      normalizeOnlineOrderModifiers: this.normalizeOnlineOrderModifiers.bind(this),
      onlineOrderModifiersTotal: this.onlineOrderModifiersTotal.bind(this),
      enforceOnlineOrderModifierContract: this.enforceOnlineOrderModifierContract.bind(this),
      claimCouponUse: this.claimCouponUse.bind(this),
      releaseCouponUse: this.releaseCouponUse.bind(this),
      logger: this.logger,
    });
    this.orderCreateService = new StorefrontOrderCreateService({
      db: this.db,
      whatsappService: this.whatsappService,
      planFeatureService: this.planFeatureService,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
      claimCouponUse: this.couponsService.claimCouponUse.bind(this.couponsService),
      resolveStorefrontStockScope: this.catalogDetailService.resolveStorefrontStockScope.bind(this.catalogDetailService),
      resolveOrderCharges: this.orderQuoteService.resolveOrderCharges.bind(this.orderQuoteService),
      normalizeOnlineOrderModifiers: this.orderQuoteService.normalizeOnlineOrderModifiers.bind(this.orderQuoteService),
      onlineOrderModifiersTotal: this.orderQuoteService.onlineOrderModifiersTotal.bind(this.orderQuoteService),
      enforceOnlineOrderModifierContract: this.orderQuoteService.enforceOnlineOrderModifierContract.bind(this.orderQuoteService),
      reapExpiredReservations: this.customerOrdersService.reapExpiredReservations.bind(this.customerOrdersService),
    });
    this.settingsService = new StorefrontSettingsService({
      db: this.db,
      media: this.media,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
      invalidateCatalogCache: this.invalidateCatalogCache.bind(this),
    });
    this.engagementService = new StorefrontEngagementService({
      db: this.db,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      invalidateCatalogCache: this.invalidateCatalogCache.bind(this),
    });
    this.merchantOrdersService = new StorefrontMerchantOrdersService({
      db: this.db,
      kdsService: this.kdsService,
      logger: this.logger,
      releaseCouponUse: this.releaseCouponUse.bind(this),
    });
  }

  private async getTenantBySlug(slug: string) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    if (!cleanSlug || cleanSlug === 'admin') throw new NotFoundException('المتجر غير موجود');

    let tenant = await this.db
      .selectFrom('tenants')
      .selectAll()
      .where('slug', '=', cleanSlug)
      .executeTakeFirst();

    if (!tenant && cleanSlug.includes('.')) {
      tenant = await this.db
        .selectFrom('tenants')
        .selectAll()
        .where('custom_domain', '=', cleanSlug)
        .executeTakeFirst();
    }

    if (!tenant) {
      const slugSetting = await this.db
        .selectFrom('settings')
        .select('tenant_id')
        .where('key', '=', 'storefront_slug')
        .where(sql<boolean>`LOWER(TRIM(BOTH '"' FROM value)) = ${cleanSlug}`)
        .executeTakeFirst();

      if (slugSetting) {
        tenant = await this.db
          .selectFrom('tenants')
          .selectAll()
          .where('id', '=', slugSetting.tenant_id)
          .executeTakeFirst();
      }
    }

    if (!tenant && (cleanSlug === 'default' || cleanSlug === 'demo' || cleanSlug === 'almhnds' || cleanSlug === 'slmhnds' || cleanSlug === 'elmhnds' || cleanSlug === 'almohandes' || cleanSlug === 'elmohandes')) {
      tenant = await this.db
        .selectFrom('tenants')
        .selectAll()
        .where('id', '=', 'default')
        .executeTakeFirst();

      if (!tenant) {
        tenant = await this.db
          .selectFrom('tenants')
          .selectAll()
          .orderBy('created_at', 'asc')
          .executeTakeFirst();
      }
    }

    if (!tenant) throw new NotFoundException('المتجر غير موجود');
    return tenant;
  }


  private async resolveStorefrontStockScope(
    tenantId: string,
    settings: Map<string, string>,
    branchId?: number | null,
  ): Promise<{ branchId: number | null; locations: Array<{ id: number; branchId: number | null }> }> {
    return this.catalogDetailService.resolveStorefrontStockScope(tenantId, settings, branchId);
  }

  private async loadStorefrontAvailability(
    tenantId: string,
    locationIds: number[],
    productIds?: number[],
  ): Promise<Map<number, number>> {
    return this.catalogDetailService.loadStorefrontAvailability(tenantId, locationIds, productIds);
  }

  private async getTenantSettingsMap(tenantId: string): Promise<Map<string, string>> {
    const rows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .execute();

    const map = new Map<string, string>();
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        // Keep strings as-is; re-serialize arrays/objects so downstream JSON.parse works
        map.set(row.key, typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
      } catch {
        map.set(row.key, row.value);
      }
    }
    return map;
  }


  public static invalidateGlobalCatalogCache(slug?: string) {
    return StorefrontCatalogService.invalidateGlobalCatalogCache(slug);
  }

  public invalidateCatalogCache(slug?: string) {
    return this.catalogService.invalidateCatalogCache(slug);
  }

  // --- Public Storefront Methods ---

  async getStorefrontInfo(slug: string) {
    return this.catalogDetailService.getStorefrontInfo(slug);
  }

  async getStorefrontCatalogJson(slug: string): Promise<string> {
    return this.catalogService.getStorefrontCatalogJson(slug);
  }

  async getStorefrontCatalogPage(
    slug: string,
    query: { page?: unknown; pageSize?: unknown; limit?: unknown; categoryId?: unknown; q?: unknown },
  ) {
    return this.catalogService.getStorefrontCatalogPage(slug, query);
  }

  async getStorefrontCatalog(slug: string) {
    return this.catalogService.getStorefrontCatalog(slug);
  }

  async getSearchSuggestions(slug: string, query: string) {
    return this.catalogService.getSearchSuggestions(slug, query);
  }

  async getProductDetails(slug: string, productId: number) {
    return this.catalogService.getProductDetails(slug, productId);
  }

  async getProductModifiers(slug: string, productId: number) {
    return this.catalogDetailService.getProductModifiers(slug, productId);
  }

  private normalizeOnlineOrderModifiers(raw: unknown): any[] {
    return this.orderQuoteService.normalizeOnlineOrderModifiers(raw);
  }

  private onlineOrderModifiersTotal(modifiers: any[] | undefined): number {
    return this.orderQuoteService.onlineOrderModifiersTotal(modifiers);
  }

  private async enforceOnlineOrderModifierContract(
    items: Array<{ productId: number; modifiers?: any[] }>,
    tenant: { id: string; plan_id?: string | null; extra_features?: unknown; activity_type?: string | null },
  ): Promise<void> {
    return this.orderQuoteService.enforceOnlineOrderModifierContract(items, tenant);
  }

  private async resolveOrderCharges(
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
    return this.orderQuoteService.resolveOrderCharges(tenantId, settings, params);
  }

  async releaseCouponUse(trx: Transaction<Database>, tenantId: string, couponCode: string): Promise<void> {
    return this.couponsService.releaseCouponUse(trx, tenantId, couponCode);
  }

  async quoteOnlineOrder(slug: string, dto: {
    items: Array<{ productId: number | string; quantity: number; variantName?: string | null }>;
    couponCode?: string;
    deliveryZoneId?: number;
    deliveryZoneName?: string;
    fulfillmentType?: 'delivery' | 'pickup';
    orderType?: string;
    tableNumber?: string;
  }) {
    return this.orderQuoteService.quoteOnlineOrder(slug, dto);
  }

  async createOnlineOrder(slug: string, dto: CreateOnlineOrderDto, publicOrigin?: string) {
    return this.orderCreateService.createOnlineOrder(slug, dto, publicOrigin);
  }

  async lookupCustomerOrders(slug: string, refs: CustomerOrderRefDto[]) {
    return this.customerOrdersService.lookupCustomerOrders(slug, refs);
  }

  async cancelCustomerOrder(slug: string, orderNumber: string, token: string | undefined) {
    return this.customerOrdersService.cancelCustomerOrder(slug, orderNumber, token);
  }

  async updateCustomerOrder(slug: string, orderNumber: string, token: string | undefined, dto: CreateOnlineOrderDto) {
    return this.customerOrdersService.updateCustomerOrder(slug, orderNumber, token, dto);
  }

  async reapExpiredReservations(options?: {
    tenantId?: string;
    onlineTimeoutMs?: number;
    codTimeoutMs?: number;
    limit?: number;
  }): Promise<{ reapedOrdersCount: number; reapedOrderNumbers: string[]; scannedCount: number }> {
    return this.customerOrdersService.reapExpiredReservations(options);
  }

  // --- Merchant Admin Methods ---

  async getOrderCounts(actor: AuthContext) {
    return this.merchantOrdersService.getOrderCounts(actor);
  }

  async bulkCancelOrders(adminPassword: string, targetStatus = 'pending', actor: AuthContext) {
    return this.merchantOrdersService.bulkCancelOrders(adminPassword, targetStatus, actor);
  }

  async listOrders(query: Record<string, unknown>, actor: AuthContext) {
    return this.merchantOrdersService.listOrders(query, actor);
  }

  async getOrder(id: number, actor: AuthContext) {
    return this.merchantOrdersService.getOrder(id, actor);
  }

  async updateOrderStatus(id: number, status: string, actor: AuthContext, saleId?: number) {
    return this.merchantOrdersService.updateOrderStatus(id, status, actor, saleId);
  }

  async confirmManualPayment(id: number, reference: string | undefined, actor: AuthContext) {
    return this.merchantOrdersService.confirmManualPayment(id, reference, actor);
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
  private async restorePendingAfterFailedConversion(orderId: number, tenantId: string, tookLock: boolean): Promise<void> {
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
      this.logger.warn(`D-SF-11 restore to pending failed for online order ${orderId}: ${String((restoreErr as any)?.message || restoreErr)}`);
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
      return { ok: true, saleId: order.sale_id, sale: unwrapConvertedSale(fullSale), message: 'تم تحويل الطلب لفاتورة مسبقاً' };
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
      throw new BadRequestException('لا يمكن تحويل الطلب إلى فاتورة: الفرع ليس له مكان مخزون افتراضي ولم يتم حجز مكان للطلب — حدد مكان المخزون الافتراضي للفرع أولاً');
    }

    const isDineIn = order.order_type === 'dine_in' || order.fulfillment_type === 'dine_in';
    const isPickup = order.fulfillment_type === 'pickup' || order.order_type === 'pickup';
    const effectiveOrderType = isDineIn ? 'dine_in' : (isPickup ? 'takeaway' : 'delivery');

    // 2.5 Resolve delivery representative (only for delivery orders)
    let repId: number | undefined = undefined;
    let repName = isPickup ? 'استلام من الفرع' : (isDineIn ? 'صالة المطعم' : 'توصيل المتجر');
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
            } as any)
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
    const tenantDeliveryFeeMode = effectiveOrderType === 'delivery'
      ? await this.resolveTenantDeliveryFeeMode(tenantId)
      : null;

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
      tableNumber: isDineIn ? (order.table_number || undefined) : undefined,
      deliveryRepId: repId,
      deliveryStatus: effectiveOrderType === 'delivery' ? 'pending' : null,
      collectionStatus: isPaidOnline ? 'prepaid_online' : (effectiveOrderType === 'delivery' ? 'cod' : null),
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
      ].filter(Boolean).join(' - '),
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
          return { ok: true, saleId: latestOrder.sale_id, sale: unwrapConvertedSale(fullSale), message: 'تم تحويل الطلب لفاتورة مسبقاً' };
        }
      }
      throw err;
    }
    const saleId = Number((saleResult as any)?.id || (saleResult as any)?.sale?.id || (typeof saleResult === 'number' ? saleResult : 0));

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
      .where((eb) =>
        eb.or([
          eb('phone', '=', cleanCustomerPhone),
          eb('phone', '=', rawPhone),
        ])
      )
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
          .where((eb) =>
            eb.or([
              eb('phone', '=', cleanCustomerPhone),
              eb('phone', '=', rawPhone),
            ])
          )
          .executeTakeFirst();
      }
    }

    // 2. Fetch product details for items
    const rawItems = (order.items || []) as Array<any>;
    const productIds = rawItems.map((it) => Number(it.productId)).filter(Boolean);

    const products = productIds.length > 0
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
        name: it.variantName ? it.name : (p?.name || it.name),
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
      orderType: order.order_type === 'dine_in'
        ? 'dine_in'
        : (order.fulfillment_type === 'pickup' || order.order_type === 'pickup' ? 'takeaway' : 'delivery'),
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

  async getStorefrontSettings(actor: AuthContext) {
    return this.settingsService.getStorefrontSettings(actor);
  }

  async updateStorefrontSettings(payload: UpdateStorefrontSettingsDto, actor: AuthContext) {
    return this.settingsService.updateStorefrontSettings(payload, actor);
  }

  async updateProductImage(productId: number, imageUrl: string, actor: AuthContext) {
    return this.settingsService.updateProductImage(productId, imageUrl, actor);
  }

  async updateCategoryImage(categoryId: number, rawImageUrl: string, actor: AuthContext) {
    return this.settingsService.updateCategoryImage(categoryId, rawImageUrl, actor);
  }

  async submitProductReview(slug: string, productId: number, dto: CreateProductReviewDto) {
    return this.engagementService.submitProductReview(slug, productId, dto);
  }

  async getProductReviews(slug: string, productId: number) {
    return this.engagementService.getProductReviews(slug, productId);
  }

  async validateCoupon(slug: string, code: string, subtotal: number) {
    return this.couponsService.validateCoupon(slug, code, subtotal);
  }

  async listCoupons(actor: AuthContext) {
    return this.couponsService.listCoupons(actor);
  }

  async createCoupon(dto: CreateCouponDto, actor: AuthContext) {
    return this.couponsService.createCoupon(dto, actor);
  }

  async updateCoupon(id: number, dto: UpdateCouponDto, actor: AuthContext) {
    return this.couponsService.updateCoupon(id, dto, actor);
  }

  async deleteCoupon(id: number, actor: AuthContext) {
    return this.couponsService.deleteCoupon(id, actor);
  }

  async listDeliveryZones(actor: AuthContext) {
    return this.couponsService.listDeliveryZones(actor);
  }

  async createDeliveryZone(dto: CreateDeliveryZoneDto, actor: AuthContext) {
    return this.couponsService.createDeliveryZone(dto, actor);
  }

  async updateDeliveryZone(id: number, dto: UpdateDeliveryZoneDto, actor: AuthContext) {
    return this.couponsService.updateDeliveryZone(id, dto, actor);
  }

  async deleteDeliveryZone(id: number, actor: AuthContext) {
    return this.couponsService.deleteDeliveryZone(id, actor);
  }

  async getTablesQrCodes(slug: string, fromTable: number = 1, toTable: number = 20, baseUrl?: string) {
    return this.settingsService.getTablesQrCodes(slug, fromTable, toTable, baseUrl);
  }

  // --- Abandoned Carts & Recovery ---

  async recordAbandonedCart(slug: string, dto: RecordAbandonedCartDto) {
    return this.engagementService.recordAbandonedCart(slug, dto);
  }

  async listAbandonedCarts(actor: AuthContext) {
    return this.engagementService.listAbandonedCarts(actor);
  }

  async deleteAbandonedCart(id: number, actor: AuthContext) {
    return this.engagementService.deleteAbandonedCart(id, actor);
  }

  // --- Storefront Analytics & KPIs ---

  async getStorefrontAnalytics(actor: AuthContext) {
    return this.engagementService.getStorefrontAnalytics(actor);
  }

  /**
   * Next-Gen F&B: Get active table check / bill for Pay-at-Table via QR code
   */
  async getActiveTableBill(slug: string, tableNumber: string) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    const cleanTable = String(tableNumber || '').trim();
    const tenant = await this.getTenantBySlug(cleanSlug);

    // 1. Look for active held sale draft for this table
    const heldSale = await this.db
      .selectFrom('held_sales as hs')
      .select([
        'hs.id',
        'hs.table_number',
        'hs.order_type',
        'hs.discount',
        'hs.note',
        'hs.delivery_fee',
        'hs.paid_online',
        'hs.paid_online_amount',
        'hs.paid_online_ref',
        'hs.created_at',
      ])
      .where(sql<boolean>`hs.tenant_id = ${tenant.id}`)
      .where('hs.table_number', '=', cleanTable)
      .orderBy('hs.id', 'desc')
      .executeTakeFirst();

    if (!heldSale) {
      // Also check if there is an active unpaid dine-in sale in sales
      const activeSale = await this.db
        .selectFrom('sales as s')
        .select([
          's.id',
          's.doc_no',
          's.table_number',
          's.total',
          's.subtotal',
          's.tax_amount',
          's.discount',
          's.service_charge',
          's.tip_amount',
          's.status',
          's.created_at',
        ])
        .where(sql<boolean>`s.tenant_id = ${tenant.id}`)
        .where('s.table_number', '=', cleanTable)
        .where('s.order_type', '=', 'dine_in')
        .where('s.status', 'not in', ['cancelled', 'completed'])
        .orderBy('s.id', 'desc')
        .executeTakeFirst();

      if (!activeSale) {
        return {
          hasActiveBill: false,
          tableNumber: cleanTable,
          message: 'لا توجد فواتير أو طلبات نشطة مسجلة على هذه الطاولة حالياً.',
        };
      }

      const saleItems = await this.db
        .selectFrom('sale_items')
        .select(['id', 'product_name', 'qty', 'unit_price', 'line_total', 'notes'])
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where('sale_id', '=', activeSale.id)
        .execute();

      return {
        hasActiveBill: true,
        source: 'sale',
        billId: Number(activeSale.id),
        invoiceNo: activeSale.doc_no || `SALE-${activeSale.id}`,
        tableNumber: cleanTable,
        isPaidOnline: false,
        paidOnlineAmount: 0,
        paidOnlineRef: null,
        items: saleItems.map((it) => ({
          name: it.product_name,
          qty: Number(it.qty),
          unitPrice: Number(it.unit_price),
          total: Number(it.line_total),
          notes: it.notes || '',
        })),
        subtotal: Number(activeSale.subtotal || 0),
        discount: Number(activeSale.discount || 0),
        serviceCharge: Number(activeSale.service_charge || 0),
        tax: Number(activeSale.tax_amount || 0),
        total: Number(activeSale.total || 0),
        currency: (tenant as any).currency || 'SAR',
      };
    }

    // Held draft found
    const items = await this.db
      .selectFrom('held_sale_items')
      .select(['id', 'product_name', 'qty', 'unit_price', 'modifiers'])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('held_sale_id', '=', heldSale.id)
      .execute();

    const formattedItems = items.map((it) => {
      let mods: any[] = [];
      try {
        if (typeof it.modifiers === 'string' && it.modifiers.trim()) {
          mods = JSON.parse(it.modifiers);
        } else if (Array.isArray(it.modifiers)) {
          mods = it.modifiers;
        }
      } catch {}
      const itemTotal = Number(it.qty) * Number(it.unit_price);
      return {
        name: it.product_name,
        qty: Number(it.qty),
        unitPrice: Number(it.unit_price),
        total: itemTotal,
        modifiers: mods,
      };
    });

    const subtotal = formattedItems.reduce((acc, it) => acc + it.total, 0);
    const discount = Number(heldSale.discount || 0);

    // Read settings to check service charge and tax. Rates arrive raw so
    // the table-bill engine can tell "never set" from "garbled": only an
    // absent rate falls back (0 tax, 12 service percent); a present but
    // invalid rate fails closed inside the engine.
    const settings = await this.getTenantSettingsMap(tenant.id);
    const serviceChargeEnabled = settings.get('restaurant_service_charge_enabled') === 'true' || settings.get('restaurantServiceChargeEnabled') === 'true';
    const totals = computeTableBillTotals({
      subtotal,
      discount,
      serviceChargeEnabled,
      serviceChargePercent: settings.get('restaurant_service_charge_rate') ?? settings.get('restaurantServiceChargePercent'),
      taxRate: settings.get('tax_rate') ?? settings.get('taxRate'),
      digits: storefrontMoneyDigits(settings, tenant),
    });
    const serviceCharge = totals.serviceCharge;
    const tax = totals.tax;
    const grandTotal = totals.total;

    return {
      hasActiveBill: true,
      source: 'held_draft',
      billId: Number(heldSale.id),
      tableNumber: cleanTable,
      isPaidOnline: Boolean(heldSale.paid_online),
      paidOnlineAmount: Number(heldSale.paid_online_amount || 0),
      paidOnlineRef: heldSale.paid_online_ref || null,
      items: formattedItems,
      subtotal,
      discount,
      serviceCharge,
      tax,
      total: grandTotal,
      currency: (tenant as any).currency || 'SAR',
    };
  }

  /**
   * Next-Gen F&B: Pay active table check / bill via QR online checkout.
   *
   * INV-TABLE-BILL-PAY-CLOSED: this endpoint is CLOSED until a verified
   * gateway capture exists. It used to mark the bill paid_online with a
   * generated TAB-PAY reference and no payment of any kind, on a public
   * route anyone could call with a shop slug and a table number — a
   * guest could close a check and walk out with the food unpaid. The
   * throw below runs before any read or write, so no bill state and no
   * service-call row can ever be produced from this route. Re-enable
   * only through a gateway charge plus webhook-verified capture; never
   * by restoring the generated-reference marking. Viewing the bill
   * (getActiveTableBill) is unchanged.
   */
  async payActiveTableBill(
    slug: string,
    tableNumber: string,
    dto: { tipAmount?: number; paymentMethod?: string; guestName?: string; guestPhone?: string },
  ) {
    void slug;
    void tableNumber;
    void dto;
    throw new ServiceUnavailableException(
      'الدفع الإلكتروني لفاتورة الطاولة غير متاح حالياً — ادفع عند الكاشير.',
    );
  }
}

