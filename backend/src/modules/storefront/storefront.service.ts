import { Inject, Injectable, NotFoundException, BadRequestException, Optional, Logger } from '@nestjs/common';
import { Kysely, sql, type Transaction } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { getTenantTimezone, todayTenantDate } from '../../common/utils/tenant-timezone.util';
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
import { unwrapConvertedSale } from './engines/online-order-access.engine';
import { releaseLocationStock } from '../../common/utils/location-stock-ledger';
import { StorefrontCouponsService } from './services/storefront-coupons.service';
import { StorefrontOrderQuoteService } from './services/storefront-order-quote.service';
import { StorefrontCatalogDetailService } from './services/storefront-catalog-detail.service';
import { StorefrontCatalogService } from './services/storefront-catalog.service';
import { StorefrontCustomerOrdersService } from './services/storefront-customer-orders.service';
import { StorefrontSettingsService } from './services/storefront-settings.service';
import { StorefrontEngagementService } from './services/storefront-engagement.service';
import { StorefrontMerchantOrdersService } from './services/storefront-merchant-orders.service';

import { storefrontMoneyDigits, isOutOfStockOrderingAllowed } from './storefront-helpers';
import { StorefrontOrderCreateService } from './services/storefront-order-create.service';
import { StorefrontOrderConvertService } from './services/storefront-order-convert.service';
import { StorefrontTableBillService } from './services/storefront-table-bill.service';

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

  private readonly orderConvertService: StorefrontOrderConvertService;

  private readonly tableBillService: StorefrontTableBillService;

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
    this.tableBillService = new StorefrontTableBillService({
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
      resolveStorefrontStockScope: this.catalogDetailService.resolveStorefrontStockScope.bind(
        this.catalogDetailService,
      ),
      loadStorefrontAvailability: this.catalogDetailService.loadStorefrontAvailability.bind(this.catalogDetailService),
    });
    this.customerOrdersService = new StorefrontCustomerOrdersService({
      db: this.db,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
      resolveOrderCharges: this.orderQuoteService.resolveOrderCharges.bind(this.orderQuoteService),
      normalizeOnlineOrderModifiers: this.orderQuoteService.normalizeOnlineOrderModifiers.bind(this.orderQuoteService),
      onlineOrderModifiersTotal: this.orderQuoteService.onlineOrderModifiersTotal.bind(this.orderQuoteService),
      enforceOnlineOrderModifierContract: this.orderQuoteService.enforceOnlineOrderModifierContract.bind(
        this.orderQuoteService,
      ),
      claimCouponUse: this.couponsService.claimCouponUse.bind(this.couponsService),
      releaseCouponUse: this.couponsService.releaseCouponUse.bind(this.couponsService),
      logger: this.logger,
    });
    this.orderCreateService = new StorefrontOrderCreateService({
      db: this.db,
      whatsappService: this.whatsappService,
      planFeatureService: this.planFeatureService,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
      claimCouponUse: this.couponsService.claimCouponUse.bind(this.couponsService),
      resolveStorefrontStockScope: this.catalogDetailService.resolveStorefrontStockScope.bind(
        this.catalogDetailService,
      ),
      resolveOrderCharges: this.orderQuoteService.resolveOrderCharges.bind(this.orderQuoteService),
      normalizeOnlineOrderModifiers: this.orderQuoteService.normalizeOnlineOrderModifiers.bind(this.orderQuoteService),
      onlineOrderModifiersTotal: this.orderQuoteService.onlineOrderModifiersTotal.bind(this.orderQuoteService),
      enforceOnlineOrderModifierContract: this.orderQuoteService.enforceOnlineOrderModifierContract.bind(
        this.orderQuoteService,
      ),
      reapExpiredReservations: this.customerOrdersService.reapExpiredReservations.bind(this.customerOrdersService),
    });
    this.settingsService = new StorefrontSettingsService({
      db: this.db,
      media: this.media,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
      invalidateCatalogCache: this.catalogService.invalidateCatalogCache.bind(this.catalogService),
    });
    this.engagementService = new StorefrontEngagementService({
      db: this.db,
      getTenantBySlug: this.getTenantBySlug.bind(this),
      invalidateCatalogCache: this.catalogService.invalidateCatalogCache.bind(this.catalogService),
    });
    this.merchantOrdersService = new StorefrontMerchantOrdersService({
      db: this.db,
      kdsService: this.kdsService,
      logger: this.logger,
      releaseCouponUse: this.couponsService.releaseCouponUse.bind(this.couponsService),
    });
    this.orderConvertService = new StorefrontOrderConvertService({
      db: this.db,
      salesService: this.salesService,
      getTenantSettingsMap: this.getTenantSettingsMap.bind(this),
      getOrder: this.merchantOrdersService.getOrder.bind(this.merchantOrdersService),
      retireKitchenDraft: this.merchantOrdersService.retireKitchenDraft.bind(this.merchantOrdersService),
      logger: this.logger,
    });
  }

  private async getTenantBySlug(slug: string) {
    const cleanSlug = String(slug || '')
      .trim()
      .toLowerCase();
    if (!cleanSlug || cleanSlug === 'admin') throw new NotFoundException('المتجر غير موجود');

    let tenant = await this.db.selectFrom('tenants').selectAll().where('slug', '=', cleanSlug).executeTakeFirst();

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

    if (
      !tenant &&
      (cleanSlug === 'default' ||
        cleanSlug === 'demo' ||
        cleanSlug === 'almhnds' ||
        cleanSlug === 'slmhnds' ||
        cleanSlug === 'elmhnds' ||
        cleanSlug === 'almohandes' ||
        cleanSlug === 'elmohandes')
    ) {
      tenant = await this.db.selectFrom('tenants').selectAll().where('id', '=', 'default').executeTakeFirst();

      if (!tenant) {
        tenant = await this.db.selectFrom('tenants').selectAll().orderBy('created_at', 'asc').executeTakeFirst();
      }
    }

    if (!tenant) throw new NotFoundException('المتجر غير موجود');
    return tenant;
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

  async quoteOnlineOrder(
    slug: string,
    dto: {
      items: Array<{ productId: number | string; quantity: number; variantName?: string | null }>;
      couponCode?: string;
      deliveryZoneId?: number;
      deliveryZoneName?: string;
      fulfillmentType?: 'delivery' | 'pickup';
      orderType?: string;
      tableNumber?: string;
    },
  ) {
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

  async convertToSale(id: number, actor: AuthContext, explicitRepId?: number) {
    return this.orderConvertService.convertToSale(id, actor, explicitRepId);
  }

  async prepareOrderForPos(id: number, actor: AuthContext) {
    return this.orderConvertService.prepareOrderForPos(id, actor);
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

  async getActiveTableBill(slug: string, tableNumber: string) {
    return this.tableBillService.getActiveTableBill(slug, tableNumber);
  }

  async payActiveTableBill(
    slug: string,
    tableNumber: string,
    dto: { tipAmount?: number; paymentMethod?: string; guestName?: string; guestPhone?: string },
  ) {
    return this.tableBillService.payActiveTableBill(slug, tableNumber, dto);
  }
}
