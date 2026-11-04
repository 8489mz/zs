import { Inject, Injectable, NotFoundException, BadRequestException, UnauthorizedException, Optional, Logger } from '@nestjs/common';
import { Kysely, sql, type Transaction, type Selectable } from 'kysely';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { getTenantTimezone, isValidTimezone, todayTenantDate } from '../../common/utils/tenant-timezone.util';
import { verifyPassword } from '../../core/auth/utils/password-hasher';
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
import { CustomerOrderRefDto } from './dto/customer-order-lookup.dto';
import { resolveOrderLinePrice, formatVariantLineName } from './engines/online-order-pricing.engine';
import { computeTableBillPaymentTotal, computeTableBillTotals } from './engines/table-bill.engine';
import { maskGatewaySecret, isMaskedGatewaySecret } from './engines/gateway-secret-mask.engine';
import { buildStorePublicBase, isReservedStoreSlug } from './engines/store-public-url.engine';
import {
  issueOrderAccessToken,
  issueIdempotentOrderAccessToken,
  verifyOrderAccessToken,
  resolveOnlineOrderCollection,
  MANUALLY_CONFIRMED_PAYMENT_METHODS,
  buildOrderTrackingUrl,
  unwrapConvertedSale,
} from './engines/online-order-access.engine';
import { reserveLocationStock, releaseLocationStock } from '../../common/utils/location-stock-ledger';
import {
  ALL_OPERATIONAL_LOCATIONS,
  availableAcrossLocations,
  normalizeStorefrontStockMode,
  pickLocationCoveringOrder,
  resolveBranchSellableLocations,
  resolveStorefrontSalesStockMode,
} from '../../common/engines/branch-sellable-locations.engine';
import {
  isReservationExpired,
  extractReservationItems,
  DEFAULT_ONLINE_PAYMENT_TIMEOUT_MS,
  DEFAULT_COD_STALE_TIMEOUT_MS,
} from './engines/storefront-reservation.engine';
import {
  resolveBestStorefrontOffer,
  RawStorefrontOffer,
} from './engines/storefront-offers.engine';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';

/** Country-aware phone rule shared by order creation and edit (O56: edit used to accept Egypt only). */
function assertValidCustomerPhone(rawPhone: string | undefined, countryCode: string): void {
  const cleanCustomerPhone = String(rawPhone || '').replace(/[^0-9+]/g, '');
  const digitsOnly = cleanCustomerPhone.replace(/\D/g, '');
  if (countryCode === 'EG' && (cleanCustomerPhone.startsWith('01') || cleanCustomerPhone.length === 11)) {
    if (!/^01[0125]\d{8}$/.test(digitsOnly)) {
      throw new BadRequestException('يرجى إدخال رقم هاتف محمول مصري صحيح مكون من 11 رقماً ويبدأ بـ (010، 011، 012، 015)');
    }
  } else if (digitsOnly.length < 7 || digitsOnly.length > 16) {
    throw new BadRequestException('يرجى إدخال رقم هاتف صحيح');
  }
}

function offerTimezone(settings: Map<string, string>): string {
  const configured = settings.get('timezone') || process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';
  return isValidTimezone(configured) ? configured : 'Africa/Cairo';
}

/**
 * Book digits for storefront display and checkout pricing
 * (INV-STOREFRONT-PRICING-DIGITS), from the same currency source the
 * order functions already read (settings currency, then the tenant's
 * currency, then EGP). An unreadable currency string keeps the
 * historical 2-decimal display instead of failing a public catalog
 * read; the posting path (tenantBaseCurrency) still throws on it, so
 * no order can post on a misconfigured currency.
 */
function storefrontMoneyDigits(settings: Map<string, string>, tenant?: unknown): MoneyDigits {
  const tenantCurrency = (tenant as { currency?: unknown } | null | undefined)?.currency;
  const code = String(settings.get('currency') || tenantCurrency || 'EGP').trim().toUpperCase();
  try {
    return currencyMoneyDigits(code);
  } catch {
    return 2;
  }
}

function catalogImageRef(value: unknown): string {
  return typeof value === 'string' && value && !value.startsWith('data:') ? value : '';
}

/** Same rule the public catalog uses to show items as orderable when stock is zero. */
function isOutOfStockOrderingAllowed(
  settings: Map<string, string>,
  tenantSlug: string,
  tenantActivity?: string | null,
): boolean {
  const normActivity = (tenantActivity || '').toLowerCase().trim();
  const normSettingType = (settings.get('activityType') || '').toLowerCase().trim();
  const normIndustry = (settings.get('businessIndustry') || '').toLowerCase().trim();
  const normLegacyInd = (settings.get('industry') || '').toLowerCase().trim();
  const normLegacyBiz = (settings.get('business_type') || '').toLowerCase().trim();

  const isRestaurant =
    normActivity === 'restaurant' ||
    normActivity === 'مطعم' ||
    normActivity === 'مطاعم' ||
    normActivity.includes('مطعم') ||
    normActivity.includes('كافيه') ||
    normSettingType === 'restaurant' ||
    normSettingType === 'مطعم' ||
    normSettingType.includes('مطعم') ||
    normIndustry === 'restaurant' ||
    normIndustry === 'مطعم' ||
    normIndustry.includes('مطعم') ||
    normLegacyInd === 'restaurant' ||
    normLegacyBiz === 'restaurant';

  const explicitSetting = settings.get('storefront_allow_out_of_stock');
  if (explicitSetting === 'false' || explicitSetting === false as any) return false;
  if (explicitSetting === 'true' || explicitSetting === true as any) return true;
  if (settings.get('storefront_unlimited_stock') === 'true') return true;

  if (isRestaurant) return true;

  const cleanSlug = (tenantSlug || '').toLowerCase().trim();
  const isDemoOrDev =
    cleanSlug === 'default' ||
    cleanSlug === 'dev-tenant';

  return isDemoOrDev;
}

/**
 * O58: the old check was `stock_qty <= 0`, so a product with 1 unit left accepted an order for 50.
 * It is still an advisory check (the stock is actually moved when the cashier posts the sale through
 * SalesService, which enforces it for real), but it stops the store from promising what it cannot ship.
 */
function assertOnlineStockAvailable(name: string, stockQty: number, requestedQty: number, allowOutOfStock: boolean): void {
  if (allowOutOfStock) return;
  if (stockQty <= 0) {
    throw new BadRequestException(`عفواً، نفد مخزون الصنف "${name}"، يرجى حذفه من السلة لإتمام الطلب.`);
  }
  if (requestedQty > stockQty) {
    throw new BadRequestException(`عفواً، المتاح من الصنف "${name}" هو ${stockQty} فقط، يرجى تعديل الكمية في السلة.`);
  }
}

export { unwrapConvertedSale };

@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly salesService: SalesService,
    private readonly kdsService: KdsService,
    private readonly media: StorefrontMediaService,
    @Optional() private readonly whatsappService?: WhatsAppGatewayService,
  ) {}

  /**
   * O53: removes a dine-in order's kitchen DRAFT sale once the real invoice is posted (or the order
   * is cancelled), and hands the kitchen ticket's progress to the posted sale.
   *
   * Deleting is correct here and only here: the draft is not a financial document (status 'draft',
   * no stock movement, no journal, no payments), and the WHERE clause refuses to touch anything that
   * is not still a draft. `postedSaleId` must be a posted sale of the same tenant, otherwise the draft
   * is kept — the kitchen keeps the ticket rather than losing it to a bad link.
   */
  private async retireKitchenDraft(tenantId: string, orderId: number, postedSaleId: number | null): Promise<void> {
    const order = await this.db
      .selectFrom('online_orders')
      .select(['id', 'kitchen_draft_sale_id'])
      .where('id', '=', orderId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();
    const draftSaleId = order?.kitchen_draft_sale_id ? Number(order.kitchen_draft_sale_id) : 0;
    if (!draftSaleId) return;

    if (postedSaleId) {
      if (postedSaleId === draftSaleId) return;
      const posted = await this.db
        .selectFrom('sales')
        .select(['id'])
        .where('id', '=', postedSaleId)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '=', 'posted')
        .executeTakeFirst();
      if (!posted) return;
    }

    const removed = await this.db.transaction().execute(async (trx) => {
      const draft = await trx
        .selectFrom('sales')
        .select(['id'])
        .where('id', '=', draftSaleId)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '=', 'draft')
        .forUpdate()
        .executeTakeFirst();

      if (draft) {
        await trx
          .deleteFrom('sale_items')
          .where('sale_id', '=', draftSaleId)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .execute();
        await trx
          .deleteFrom('sales')
          .where('id', '=', draftSaleId)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .where('status', '=', 'draft')
          .execute();
      }

      await trx
        .updateTable('online_orders')
        .set({ kitchen_draft_sale_id: null, updated_at: new Date() })
        .where('id', '=', orderId)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      return Boolean(draft);
    });

    if (removed) {
      await this.kdsService.transferTicketState(tenantId, draftSaleId, postedSaleId).catch(() => undefined);
    }
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


  /**
   * المخازن التي يبيع منها المتجر الإلكتروني لهذه المنشأة — **يُستدعى من الكتالوج ومن إنشاء الطلب
   * معاً**، فلا يعرض الكتالوج رصيداً لا يستطيع الطلب حجزه.
   *
   * كان الكتالوج يعرض الرصيد **العام** (`stock_qty - reserved_qty`) بينما الطلب يفحص مخزن الفرع.
   * فعلى منشأة مخزونها في مخزن آخر: الزبون يرى «متاح» ويُرفض عند الطلب. توسيع مسار الطلب وحده
   * عالج نصف المشكلة؛ هذا يقفل الجذر: الرقمان صارا من مصدر واحد.
   */
  private async resolveStorefrontStockScope(
    tenantId: string,
    settings: Map<string, string>,
    branchId?: number | null,
  ): Promise<{ branchId: number | null; locations: Array<{ id: number; branchId: number | null }> }> {
    const branch = branchId
      ? await this.db
          .selectFrom('branches')
          .select(['id', 'default_stock_location_id', 'sales_stock_mode', 'allow_external_sales_stock'])
          .where('id', '=', branchId)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .executeTakeFirst()
      : await this.db
          .selectFrom('branches')
          .select(['id', 'default_stock_location_id', 'sales_stock_mode', 'allow_external_sales_stock'])
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .where('is_active', '=', true)
          .orderBy('id', 'asc')
          .executeTakeFirst();

    if (!branch) return { branchId: null, locations: [] };

    const resolvedBranchId = Number(branch.id);
    const effectiveMode = resolveStorefrontSalesStockMode(
      branch.sales_stock_mode,
      normalizeStorefrontStockMode(settings.get('storefront_stock_mode')),
    );

    if (effectiveMode !== ALL_OPERATIONAL_LOCATIONS) {
      const defaultLocationId = branch.default_stock_location_id ? Number(branch.default_stock_location_id) : null;
      return {
        branchId: resolvedBranchId,
        locations: defaultLocationId ? [{ id: defaultLocationId, branchId: resolvedBranchId }] : [],
      };
    }

    const allLocations = await this.db
      .selectFrom('stock_locations')
      .select(['id', 'location_type', 'branch_id'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('is_active', '=', true)
      .execute();

    return {
      branchId: resolvedBranchId,
      locations: resolveBranchSellableLocations({ ...branch, sales_stock_mode: effectiveMode }, resolvedBranchId, allLocations),
    };
  }

  /**
   * الرصيد المتاح لكل صنف عبر مخازن المتجر — نفس حساب `reserveLocationStock` (يشمل الرصيد غير
   * المخصص لأي مخزن، لأن الحجز يحتسبه).
   */
  private async loadStorefrontAvailability(
    tenantId: string,
    locationIds: number[],
    productIds?: number[],
  ): Promise<Map<number, number>> {
    const rows = await this.db
      .selectFrom('product_location_stock')
      .select(['product_id', 'location_id', 'qty', 'reserved_qty'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .$if(Boolean(productIds), (qb) => qb.where('product_id', 'in', productIds || []))
      .where((eb) => eb.or([
        eb('location_id', 'is', null),
        ...(locationIds.length > 0 ? [eb('location_id', 'in', locationIds)] : []),
      ]))
      .execute();

    const eligible = new Set(locationIds);
    const assigned = new Map<number, Array<{ qty: number; reserved: number }>>();
    const unassigned = new Map<number, { qty: number; reserved: number }>();

    for (const row of rows) {
      const productId = Number(row.product_id);
      const entry = { qty: Number(row.qty || 0), reserved: Number(row.reserved_qty || 0) };
      if (row.location_id == null) {
        unassigned.set(productId, entry);
      } else if (eligible.has(Number(row.location_id))) {
        if (!assigned.has(productId)) assigned.set(productId, []);
        assigned.get(productId)!.push(entry);
      }
    }

    const available = new Map<number, number>();
    const stockProductIds = new Set<number>([...assigned.keys(), ...unassigned.keys()]);
    for (const productId of stockProductIds) {
      available.set(
        productId,
        availableAcrossLocations(assigned.get(productId) || [], unassigned.get(productId) || { qty: 0, reserved: 0 }),
      );
    }
    return available;
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

  /**
   * الكتالوج العام مخزَّن **ككائن وكنصّ مُسلسَل معاً**.
   *
   * الكائن يلزم لمن يقرأه داخلياً (بطاقة المعاينة الاجتماعية)، والنصّ يلزم للردّ على الطلبات:
   * كان كل طلب يعيد `JSON.stringify` لكامل الكتالوج، فمنشأةٌ بـ12,140 صنفاً تبني نحو ثلاثة
   * ميجابايت من النصّ **في كل طلب** حتى وهو مخزَّن. التخزين يوفّر الاستعلام ولا يوفّر التسلسل،
   * والتسلسل هو المعالج. الآن يُسلسَل مرة واحدة لكل بناء.
   */
  private static catalogCache = new Map<string, { data: any; json: string; expiresAt: number; staleUntil: number }>();
  // Each entry keeps both a catalog object and its serialized JSON; 1,000 tenant entries can
  // consume gigabytes even though the entries have a short TTL.
  private static readonly MAX_CACHED_CATALOGS = 16;
  private static inFlightCatalogPromises = new Map<string, Promise<any>>();
  private static catalogGeneration = 0;

  private get catalogCache() {
    return StorefrontService.catalogCache;
  }

  private set catalogCache(val: Map<string, { data: any; json: string; expiresAt: number; staleUntil: number }>) {
    StorefrontService.catalogCache = val;
  }

  private get inFlightCatalogPromises() {
    return StorefrontService.inFlightCatalogPromises;
  }

  private set inFlightCatalogPromises(val: Map<string, Promise<any>>) {
    StorefrontService.inFlightCatalogPromises = val;
  }

  private get MAX_CACHED_CATALOGS() {
    return StorefrontService.MAX_CACHED_CATALOGS;
  }

  public static invalidateGlobalCatalogCache(slug?: string) {
    // An older in-flight build must not repopulate a cache invalidated by a write.
    StorefrontService.catalogGeneration++;
    if (slug) {
      const key = slug.toLowerCase().trim();
      StorefrontService.catalogCache.delete(key);
      StorefrontService.inFlightCatalogPromises.delete(key);
    } else {
      StorefrontService.catalogCache.clear();
      StorefrontService.inFlightCatalogPromises.clear();
    }
  }

  public invalidateCatalogCache(slug?: string) {
    StorefrontService.invalidateGlobalCatalogCache(slug);
  }

  // --- Public Storefront Methods ---

  async getStorefrontInfo(slug: string) {
    const tenant = await this.getTenantBySlug(slug);
    const settings = await this.getTenantSettingsMap(tenant.id);

    const isEnabled = settings.get('storefront_enabled') !== 'false';
    const title = settings.get('storefront_title') || settings.get('storeName') || tenant.business_name;
    const address = settings.get('storefront_address') || settings.get('address') || '';
    const bio = settings.get('storefront_bio') || '';
    const logoUrl = settings.get('storefront_logo_url') || settings.get('logo_url') || '';
    const announcement = settings.get('storefront_announcement') || '';
    const bannerUrl = settings.get('storefront_banner_url') || '';
    const rawBannerUrls = settings.get('storefront_banner_urls');
    let bannerUrls: string[] = [];
    if (rawBannerUrls) {
      try {
        const parsed = JSON.parse(rawBannerUrls);
        if (Array.isArray(parsed)) bannerUrls = parsed.filter(Boolean);
      } catch {}
    }
    if (bannerUrls.length === 0 && bannerUrl) {
      bannerUrls = [bannerUrl];
    }

    const deliveryFee = Number(settings.get('storefront_delivery_fee') || 0);
    const minOrder = Number(settings.get('storefront_min_order') || 0);
    const whatsappPhone = settings.get('storefront_whatsapp') || settings.get('phone') || tenant.owner_phone || '';
    const currency = settings.get('currency') || 'EGP';

    const bannerFit = settings.get('storefront_banner_fit') || 'contain';
    const bannerPosition = settings.get('storefront_banner_position') || 'center';
    const bannerIntervalSeconds = Math.max(1, Number(settings.get('storefront_banner_interval') || 4));
    const smartDealsEnabled = settings.get('storefront_smart_deals') === 'true';
    const freeShippingEnabled = settings.get('storefront_free_shipping_enabled') === 'true';
    const freeShippingMinOrder = Number(settings.get('storefront_free_shipping_min_order') || 0);
    let bannerPositions: string[] = [];
    try {
      const rawPos = settings.get('storefront_banner_positions');
      if (rawPos) {
        const parsed = JSON.parse(rawPos);
        if (Array.isArray(parsed)) bannerPositions = parsed.filter(Boolean);
      }
    } catch {}

    let deliveryZones: Array<{ id: number; name: string; deliveryFee: number; estimatedTime: string }> = [];
    try {
      const deliveryZoneRows = await this.db
        .selectFrom('storefront_delivery_zones')
        .selectAll()
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where('is_active', '=', true)
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .execute();

      deliveryZones = deliveryZoneRows.map((z) => ({
        id: z.id,
        name: z.name,
        deliveryFee: Number(z.delivery_fee || 0),
        estimatedTime: z.estimated_time || '',
      }));
    } catch {
      deliveryZones = [];
    }

    const onlinePaymentEnabled = settings.get('storefront_online_payment_enabled') === 'true';
    const onlinePaymentTestMode = settings.get('storefront_paymob_test_mode') !== 'false';
    const onlinePaymentProvider = settings.get('storefront_online_payment_provider') || 'paymob';

    const midBannersEnabled = settings.get('storefront_mid_banners_enabled') !== 'false';
    const heroBannerFullBleed = settings.get('storefront_hero_full_bleed') !== 'false';
    let midBanners: any[] = [];
    try {
      const rawMid = settings.get('storefront_mid_banners');
      if (rawMid) {
        const parsed = JSON.parse(rawMid);
        if (Array.isArray(parsed)) midBanners = parsed.filter(Boolean);
      }
    } catch {}

    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      businessName: tenant.business_name,
      enabled: isEnabled,
      title,
      address,
      bio,
      logo_url: logoUrl,
      logoUrl,
      announcement,
      bannerUrl: bannerUrls[0] || bannerUrl,
      bannerUrls,
      bannerFit,
      bannerPosition,
      bannerPositions,
      bannerIntervalSeconds,
      smartDealsEnabled,
      deliveryFee,
      deliveryZones,
      minOrder,
      freeShippingEnabled,
      freeShippingMinOrder,
      whatsappPhone,
      currency,
      onlinePaymentEnabled,
      onlinePaymentTestMode,
      onlinePaymentProvider,
      brandColor: settings.get('storefront_brand_color') || '#170e5e',
      brandSecondaryColor: settings.get('storefront_brand_secondary_color') || '#f59e0b',
      brandSurfaceColor: settings.get('storefront_brand_surface_color') || '#f8fafc',
      themePreset: settings.get('storefront_theme_preset') || 'royal_navy',
      metaPixelId: settings.get('storefront_meta_pixel_id') || '',
      ga4Id: settings.get('storefront_ga4_id') || '',
      tiktokPixelId: settings.get('storefront_tiktok_pixel_id') || '',
      snapchatPixelId: settings.get('storefront_snapchat_pixel_id') || '',
      pickupEnabled: settings.get('storefront_pickup_enabled') !== 'false',
      allowOutOfStockOrders: isOutOfStockOrderingAllowed(settings, tenant.slug, tenant.activity_type),
      showOutOfStockProducts: settings.get('storefront_show_out_of_stock') !== 'false',
      midBannersEnabled,
      midBanners,
      heroBannerFullBleed,
      heroHeadline: settings.get('storefront_hero_headline') || '',
      heroSubtitle: settings.get('storefront_hero_subtitle') || '',
      supportEmail: settings.get('storefront_support_email') || settings.get('email') || '',
      contactPhone: settings.get('storefront_contact_phone') || '',
      facebookUrl: settings.get('storefront_facebook_url') || '',
      instagramUrl: settings.get('storefront_instagram_url') || '',
      twitterUrl: settings.get('storefront_twitter_url') || '',
      tiktokUrl: settings.get('storefront_tiktok_url') || '',
      youtubeUrl: settings.get('storefront_youtube_url') || '',
      telegramUrl: settings.get('storefront_telegram_url') || '',
    };
  }

  /**
   * الكتالوج كنصّ JSON جاهز — **هذا ما يُرَدّ به على الطلبات العامة**.
   *
   * الفرق ليس تجميلياً: `getStorefrontCatalog` تعيد كائناً يُسلسِله Express في كل طلب. على كتالوج
   * من 12 ألف صنف كان ذلك ثلاثة ميجابايت من بناء النصّ لكل زائر، على نواتين، بينما البيانات نفسها
   * مخزَّنة أصلاً. هنا يُقرأ النصّ المُسلسَل مرة واحدة عند البناء.
   */
  async getStorefrontCatalogJson(slug: string): Promise<string> {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    const cached = this.catalogCache.get(cleanSlug);
    if (cached && cached.json && cached.expiresAt > Date.now()) {
      this.catalogCache.delete(cleanSlug);
      this.catalogCache.set(cleanSlug, cached);
      return cached.json;
    }
    const data = await this.getStorefrontCatalog(slug);
    const fresh = this.catalogCache.get(cleanSlug);
    if (fresh && fresh.json) return fresh.json;
    return JSON.stringify(data);
  }

  /**
   * صفحة واحدة من الكتالوج، مع تصفية بالتصنيف والبحث — **على السيرفر**.
   *
   * الواجهة الحالية تبحث وتفرز في المتصفح على المصفوفة كاملة، فهي تطلب الكتالوج كله ولا تستطيع
   * التصفّح بعد. هذا المسار موجود ليتحرّك العميل إليه: الحدّ الأقصى 200 صنف للصفحة، ومعه
   * `totalCount` و`hasMore`. وحتى يهاجر العميل، الطلب بلا معاملات يظل يعيد الكتالوج كاملاً كما
   * كان — لا كسر لأحد.
   */
  async getStorefrontCatalogPage(
    slug: string,
    query: { page?: unknown; pageSize?: unknown; limit?: unknown; categoryId?: unknown; q?: unknown },
  ) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    const tenant = await this.getTenantBySlug(cleanSlug);
    if (query.pageSize == null && query.limit != null) query.pageSize = query.limit;
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const page = Math.min(10_000, Math.max(1, Math.trunc(Number(query.page) || 1)));
    const categoryId = Number(query.categoryId || 0);
    const search = String(query.q || '').trim().slice(0, 100);
    const base = this.db.selectFrom('products')
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('is_active', '=', true)
      .where((eb) => eb.or([eb('item_type', '=', 'product'), eb('item_type', 'is', null)]))
      .$if(Number.isSafeInteger(categoryId) && categoryId > 0, (qb) => qb.where('category_id', '=', categoryId))
      .$if(Boolean(search), (qb) => qb.where((eb) => eb.or([
        eb('name', 'ilike', `%${search}%`), eb('barcode', 'ilike', `%${search}%`),
      ])));
    const [categories, catImagesRow, countRow, products, settings] = await Promise.all([
      this.db.selectFrom('product_categories').select(['id', 'name'])
        .where(sql<boolean>`tenant_id = ${tenant.id}`).orderBy('name', 'asc').execute(),
      this.db.selectFrom('settings').select('value')
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where('key', '=', 'storefront_category_images').executeTakeFirst(),
      base.select(sql<number>`count(*)::int`.as('count')).executeTakeFirst(),
      base.select(['id', 'name', 'barcode', 'retail_price', 'stock_qty', 'reserved_qty',
        'category_id', 'notes', 'metadata', 'item_type'])
        .orderBy('name', 'asc').orderBy('id', 'asc')
        .limit(pageSize).offset((page - 1) * pageSize).execute(),
      this.getTenantSettingsMap(tenant.id),
    ]);
    const productIds = products.map((p) => Number(p.id));
    const [reviews, stockScope, rawOffers] = await Promise.all([
      productIds.length
        ? this.db.selectFrom('product_reviews')
          .select(['product_id', sql<number>`round(avg(rating)::numeric, 1)`.as('avg_rating'),
            sql<number>`count(*)::int`.as('review_count')])
          .where(sql<boolean>`tenant_id = ${tenant.id}`)
          .where('is_approved', '=', true).where('product_id', 'in', productIds)
          .groupBy('product_id').execute()
        : Promise.resolve([]),
      this.resolveStorefrontStockScope(tenant.id, settings),
      productIds.length
        ? this.db.selectFrom('product_offers')
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
          .where('product_id', 'in', productIds)
          .where('is_active', '=', true)
          .execute()
        : Promise.resolve([]),
    ]);
    const availability = productIds.length
      ? await this.loadStorefrontAvailability(
        tenant.id, stockScope.locations.map((location) => location.id), productIds,
      )
      : new Map<number, number>();
    const ratings = new Map(reviews.map((r) => [
      Number(r.product_id), { rating: Number(r.avg_rating || 0), reviewCount: Number(r.review_count || 0) },
    ]));
    const offersMap = new Map<number, RawStorefrontOffer[]>();
    for (const off of (rawOffers as RawStorefrontOffer[])) {
      const pid = Number(off.product_id);
      if (!offersMap.has(pid)) offersMap.set(pid, []);
      offersMap.get(pid)!.push(off);
    }
    const categoryNames = new Map(categories.map((c) => [Number(c.id), c.name]));
    let categoryImages: Record<string, string> = {};
    if (catImagesRow?.value) {
      try {
        const parsed = JSON.parse(catImagesRow.value);
        const value = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
        if (value && typeof value === 'object' && !Array.isArray(value)) categoryImages = value;
      } catch {}
    }
    const allowOutOfStock = isOutOfStockOrderingAllowed(settings, cleanSlug, tenant.activity_type);
    return {
      categories: categories.map((c) => ({
        id: c.id, name: c.name, imageUrl: catalogImageRef(categoryImages[String(c.id)]),
      })),
      products: products.map((p) => {
        let meta: Record<string, unknown> = {};
        if (p.metadata) {
          try {
            const parsed = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
          } catch {}
        }
        const productId = Number(p.id);
        const rawStock = availability.get(productId) ?? 0;
        const mainImg = catalogImageRef(meta.imageUrl || meta.image);
        const gallery = Array.isArray(meta.gallery)
          ? meta.gallery.map(catalogImageRef).filter(Boolean)
          : [mainImg].filter(Boolean);
        const available = allowOutOfStock || rawStock > 0;
        const retailPrice = Number(p.retail_price || 0);
        const pOffers = offersMap.get(productId) || [];
        const bestOffer = resolveBestStorefrontOffer(retailPrice, pOffers, 1, undefined, new Date(), offerTimezone(settings), storefrontMoneyDigits(settings, tenant));
        const finalPrice = bestOffer.hasDiscount ? bestOffer.price : retailPrice;
        const bogoOffer = pOffers.find((o) => o.offer_type === 'bogo');
        const bundleOffer = pOffers.find((o) => o.offer_type === 'bundle');

        return {
          id: productId, name: p.name, barcode: p.barcode || '',
          price: finalPrice,
          originalPrice: (bestOffer.hasDiscount || bestOffer.offerType === 'bogo') ? retailPrice : undefined,
          hasDiscount: bestOffer.hasDiscount,
          discountPercent: bestOffer.hasDiscount ? bestOffer.discountPercent : undefined,
          offerBadge: bestOffer.offerBadge,
          offerType: bestOffer.offerType,
          offerValue: bestOffer.hasDiscount ? bestOffer.offerValue : undefined,
          bogoBuyQty: bogoOffer?.bogo_buy_qty ? Number(bogoOffer.bogo_buy_qty) : undefined,
          bogoGetQty: bogoOffer?.bogo_get_qty ? Number(bogoOffer.bogo_get_qty) : undefined,
          bogoDiscountPercent: bogoOffer?.bogo_discount_percent !== undefined ? Number(bogoOffer.bogo_discount_percent) : undefined,
          minQty: bundleOffer?.min_qty ? Number(bundleOffer.min_qty) : undefined,
          categoryId: p.category_id ? Number(p.category_id) : null,
          categoryName: p.category_id ? categoryNames.get(Number(p.category_id)) || 'عام' : 'عام',
          stockQty: allowOutOfStock ? (rawStock > 0 ? rawStock : 999) : rawStock,
          inStock: available, isLowStock: !allowOutOfStock && rawStock > 0 && rawStock <= 5,
          icon: typeof meta.icon === 'string' ? meta.icon : '',
          imageUrl: mainImg, gallery: gallery.length ? gallery : (mainImg ? [mainImg] : []),
          variants: Array.isArray(meta.variants) ? meta.variants : [],
          addOns: Array.isArray(meta.addOns) ? meta.addOns : (Array.isArray(meta.add_ons) ? meta.add_ons : []),
          description: p.notes || (typeof meta.description === 'string' ? meta.description : ''),
          rating: ratings.get(productId)?.rating || 0,
          reviewCount: ratings.get(productId)?.reviewCount || 0,
        };
      }),
      page, pageSize,
      totalCount: Number(countRow?.count || 0),
      hasMore: page * pageSize < Number(countRow?.count || 0),
    };
  }

  async getStorefrontCatalog(slug: string) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    const now = Date.now();
    const cached = this.catalogCache.get(cleanSlug);

    // 1. Fresh cache hit: Return immediately from memory (< 1ms)
    if (cached && cached.expiresAt > now) {
      this.catalogCache.delete(cleanSlug);
      this.catalogCache.set(cleanSlug, cached);
      return cached.data;
    }

    // 2. Singleflight Deduplication: If a fetch is already running for this slug, await it
    const inFlight = this.inFlightCatalogPromises.get(cleanSlug);
    if (inFlight) {
      // Stale-While-Revalidate: If stale data is available, return it immediately while in-flight completes
      if (cached && cached.staleUntil > now) {
        return cached.data;
      }
      return inFlight;
    }

    // PERF-4 (ARCHITECTURE_INVARIANTS.md §2.6): true stale-while-revalidate. Past the 60s fresh window
    // but inside the stale window, the shopper gets the cached catalog immediately and the refresh runs
    // in the background — previously the first visitor after every minute waited for the full rebuild.
    // Prices/stock shown here are display-only: order creation re-prices and re-checks stock server-side.
    const serveStale = Boolean(cached && cached.staleUntil > now);


    // 3. Initiate singleflight worker promise
    const generation = StorefrontService.catalogGeneration;
    const fetchPromise = (async () => {
      const tenant = await this.getTenantBySlug(cleanSlug);

        // PERF-4: the five reads below are independent once the tenant is known — run them together
        // instead of five sequential round-trips (the catalog rebuild is on the shopper's critical path).
        const [categories, catImagesRow, products, reviewsSummary, rawOffers, settings] = await Promise.all([
          // 1. Categories
          this.db
            .selectFrom('product_categories')
            .select(['id', 'name'])
            .where(sql<boolean>`tenant_id = ${tenant.id}`)
            .orderBy('name', 'asc')
            .execute(),
          // Category images from settings
          this.db
            .selectFrom('settings')
            .select(['value'])
            .where(sql<boolean>`tenant_id = ${tenant.id}`)
            .where('key', '=', 'storefront_category_images')
            .executeTakeFirst(),
          // 2. Products
          this.db
            .selectFrom('products')
            .select([
              'id',
              'name',
              'barcode',
              'retail_price',
              'stock_qty',
              'reserved_qty',
              'category_id',
              'notes',
              'metadata',
              'item_type',
            ])
            .where(sql<boolean>`tenant_id = ${tenant.id}`)
            // O52: soft-deleted products (is_active = false) must not be sold online.
            .where('is_active', '=', true)
            .where((eb) => eb.or([
              eb('item_type', '=', 'product'),
              eb('item_type', 'is', null)
            ]))
            .orderBy('name', 'asc')
            .execute(),
          // 3. Real product reviews / ratings summary (optional: a failure yields no ratings, not an error)
          this.db
            .selectFrom('product_reviews')
            .select([
              'product_id',
              sql<number>`ROUND(AVG(rating)::numeric, 1)`.as('avg_rating'),
              sql<number>`COUNT(*)::int`.as('review_count'),
            ])
            .where(sql<boolean>`tenant_id = ${tenant.id}`)
            .where('is_approved', '=', true)
            .groupBy('product_id')
            .execute()
            .catch(() => [] as Array<{ product_id: number; avg_rating: number; review_count: number }>),
          // 4. Active product offers / discounts from ERP
          this.db
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
            .where('is_active', '=', true)
            .execute(),
          this.getTenantSettingsMap(tenant.id),
        ]);

        let catImageMap: Record<string, string> = {};
        if (catImagesRow?.value) {
          try {
            const parsed = JSON.parse(catImagesRow.value);
            catImageMap = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
          } catch {}
        }

        const formattedCategories = categories.map((c) => ({
          id: c.id,
          name: c.name,
          imageUrl: catalogImageRef(catImageMap[String(c.id)]),
        }));

        const catMap = new Map<number, string>();
        for (const c of categories) {
          catMap.set(c.id, c.name);
        }

        const ratingMap = new Map<number, { avgRating: number; reviewCount: number }>();
        for (const r of reviewsSummary) {
          ratingMap.set(Number(r.product_id), {
            avgRating: Number(r.avg_rating) || 0,
            reviewCount: Number(r.review_count) || 0,
          });
        }

        const offersByProductId = new Map<number, RawStorefrontOffer[]>();
        for (const off of (rawOffers as RawStorefrontOffer[])) {
          const pid = Number(off.product_id);
          if (!offersByProductId.has(pid)) offersByProductId.set(pid, []);
          offersByProductId.get(pid)!.push(off);
        }

        const allowOutOfStock = isOutOfStockOrderingAllowed(settings, cleanSlug, tenant.activity_type);

        const stockScope = await this.resolveStorefrontStockScope(tenant.id, settings);
        const storefrontAvailability = await this.loadStorefrontAvailability(
          tenant.id,
          stockScope.locations.map((location) => location.id),
        );

        const formattedProducts = products.map((p) => {
          let meta: Record<string, any> = {};
          if (p.metadata) {
            try {
              meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
            } catch {}
          }

          // الرصيد المعروض هو ما يستطيع مسار الطلب حجزه فعلاً، لا الرصيد العام. عرض الرصيد
          // العام كان يجعل الزبون يرى «متاح» ثم يُرفض عند الطلب — نفس الرقم من نفس المخازن الآن.
          const rawStock = storefrontAvailability.get(Number(p.id)) ?? 0;
          const stockQty = allowOutOfStock ? (rawStock > 0 ? rawStock : 999) : rawStock;
          const inStock = allowOutOfStock ? true : (rawStock > 0);
          const isLowStock = !allowOutOfStock && rawStock > 0 && rawStock <= 5;
          const retailPrice = Number(p.retail_price ?? 0);
          const pOffers = offersByProductId.get(Number(p.id)) || [];
          const bestOffer = resolveBestStorefrontOffer(retailPrice, pOffers, 1, undefined, new Date(), offerTimezone(settings), storefrontMoneyDigits(settings, tenant));
          const finalPrice = bestOffer.hasDiscount ? bestOffer.price : retailPrice;
          const bogoOffer = pOffers.find((o) => o.offer_type === 'bogo');
          const bundleOffer = pOffers.find((o) => o.offer_type === 'bundle');

          const reviewStats = ratingMap.get(Number(p.id)) || { avgRating: 0, reviewCount: 0 };
          // SF-9: the catalog never ships inline base64. Migration 135 moved existing images to
          // storefront_media and every writer now stores URLs; this guard keeps one stray data URL
          // (written by some other path) from re-bloating the response for every visitor.
          const mainImg = catalogImageRef(meta.imageUrl || meta.image);
          const gallery = Array.isArray(meta.gallery) ? meta.gallery.map(catalogImageRef).filter(Boolean) : [mainImg].filter(Boolean);
          const variants = Array.isArray(meta.variants) ? meta.variants : [];
          const addOns = Array.isArray(meta.addOns) ? meta.addOns : (Array.isArray(meta.add_ons) ? meta.add_ons : []);

          return {
            id: Number(p.id) || p.id,
            name: p.name,
            barcode: p.barcode || '',
            price: finalPrice,
            originalPrice: (bestOffer.hasDiscount || bestOffer.offerType === 'bogo') ? retailPrice : undefined,
            hasDiscount: bestOffer.hasDiscount,
            discountPercent: bestOffer.hasDiscount ? bestOffer.discountPercent : undefined,
            offerBadge: bestOffer.offerBadge,
            offerType: bestOffer.offerType,
            offerValue: bestOffer.hasDiscount ? bestOffer.offerValue : undefined,
            bogoBuyQty: bogoOffer?.bogo_buy_qty ? Number(bogoOffer.bogo_buy_qty) : undefined,
            bogoGetQty: bogoOffer?.bogo_get_qty ? Number(bogoOffer.bogo_get_qty) : undefined,
            bogoDiscountPercent: bogoOffer?.bogo_discount_percent !== undefined ? Number(bogoOffer.bogo_discount_percent) : undefined,
            minQty: bundleOffer?.min_qty ? Number(bundleOffer.min_qty) : undefined,
            categoryId: p.category_id ? Number(p.category_id) : null,
            categoryName: (p.category_id && catMap.get(p.category_id)) || 'عام',
            stockQty,
            inStock,
            isLowStock,
            icon: meta.icon || '',
            imageUrl: mainImg,
            gallery: gallery.length > 0 ? gallery : (mainImg ? [mainImg] : []),
            variants,
            addOns,
            description: p.notes || meta.description || '',
            rating: reviewStats.avgRating,
            reviewCount: reviewStats.reviewCount,
          };
        });

        const showOutOfStock = settings.get('storefront_show_out_of_stock') !== 'false';
        const catalogProducts = showOutOfStock
          ? formattedProducts
          : formattedProducts.filter((p) => p.inStock);

        const result = {
          categories: formattedCategories,
          products: catalogProducts,
          // العدد الكلي معلن: عميلٌ يريد التصفّح يعرف كم يطلب، وقارئُ الاستجابة يرى حجمها.
          totalCount: catalogProducts.length,
        };

        // Cache in-memory: 60s fresh, 5 mins stale-while-revalidate
        if (generation === StorefrontService.catalogGeneration) {
          this.catalogCache.delete(cleanSlug);
          this.catalogCache.set(cleanSlug, {
            data: result,
            json: JSON.stringify(result),
            expiresAt: Date.now() + 60_000,
            staleUntil: Date.now() + 300_000,
          });
          while (this.catalogCache.size > this.MAX_CACHED_CATALOGS) {
            const oldest = this.catalogCache.keys().next().value;
            if (oldest === undefined) break;
            this.catalogCache.delete(oldest);
          }
        }

        return result;
    })();

    this.inFlightCatalogPromises.set(cleanSlug, fetchPromise);
    fetchPromise
      .finally(() => {
        if (this.inFlightCatalogPromises.get(cleanSlug) === fetchPromise) {
          this.inFlightCatalogPromises.delete(cleanSlug);
        }
      })
      .catch(() => undefined);

    if (serveStale) {
      // Background refresh: a failure keeps serving the stale copy until staleUntil, never an unhandled rejection.
      fetchPromise.catch(() => undefined);
      return cached!.data;
    }
    return fetchPromise;
  }

  async getSearchSuggestions(slug: string, query: string) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) {
      return { categories: [], products: [] };
    }

    const catalog = await this.getStorefrontCatalog(slug);
    const normalizeText = (t: string) =>
      (t || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();

    const normalizedQ = normalizeText(q);

    const matchedCats = (catalog.categories || [])
      .filter((c: any) => normalizeText(c.name).includes(normalizedQ))
      .slice(0, 4);

    const matchedProds = (catalog.products || [])
      .filter((p: any) => {
        const normName = normalizeText(p.name);
        const normCat = normalizeText(p.categoryName);
        const barcode = (p.barcode || '').toLowerCase();
        return normName.includes(normalizedQ) || normCat.includes(normalizedQ) || barcode.includes(q);
      })
      .slice(0, 6);

    return {
      categories: matchedCats,
      products: matchedProds,
    };
  }

  async getProductDetails(slug: string, productId: number) {
    const catalog = await this.getStorefrontCatalog(slug);
    const product = (catalog.products || []).find((p: any) => Number(p.id) === Number(productId));
    if (!product) {
      throw new NotFoundException('المنتج غير موجود في المتجر');
    }

    // Related products in the same category
    const related = (catalog.products || [])
      .filter((p: any) => Number(p.id) !== Number(productId) && p.categoryId === product.categoryId && p.inStock)
      .slice(0, 6);

    // Cross-sell suggestions (other in-stock items with price > 0)
    const crossSell = (catalog.products || [])
      .filter((p: any) => Number(p.id) !== Number(productId) && p.inStock && p.price > 0 && p.categoryId !== product.categoryId)
      .slice(0, 4);

    return {
      product,
      related,
      crossSell,
    };
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
    const { isDineIn, isPickup, subtotal } = params;
    let deliveryFee = (isDineIn || isPickup) ? 0 : Number(settings.get('storefront_delivery_fee') || 0);
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

    const codeUpper = String(params.couponCode || '').trim().toUpperCase();
    if (codeUpper) {
      const coupon = await this.db
        .selectFrom('storefront_coupons')
        .selectAll()
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('code', '=', codeUpper)
        .where('is_active', '=', true)
        .executeTakeFirst();

      if (coupon) {
        const alreadyClaimed = String(params.alreadyClaimedCouponCode || '').toUpperCase() === coupon.code.toUpperCase();
        const nowDate = new Date();
        const isStarted = !coupon.start_date || new Date(coupon.start_date) <= nowDate;
        const isNotExpired = !coupon.end_date || new Date(coupon.end_date) >= nowDate;
        const hasRemainingUsage = alreadyClaimed || coupon.usage_limit === null || Number(coupon.times_used || 0) < coupon.usage_limit;
        const meetsMinOrder = subtotal >= Number(coupon.min_order_amount || 0);

        if (isStarted && isNotExpired && hasRemainingUsage && meetsMinOrder) {
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

  /** Atomic conditional claim of one coupon use (lost-update safe, enforces usage_limit on the live row). */
  private async claimCouponUse(trx: Transaction<Database>, tenantId: string, couponId: number): Promise<void> {
    const claim = await trx
      .updateTable('storefront_coupons')
      .set({ times_used: sql`times_used + 1`, updated_at: new Date() })
      .where('id', '=', couponId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where(sql<boolean>`(usage_limit IS NULL OR times_used < usage_limit)`)
      .executeTakeFirst();
    if (Number(claim?.numUpdatedRows || 0) === 0) {
      throw new BadRequestException('تم استنفاد عدد مرات استخدام كوبون الخصم.');
    }
  }

  /** Gives back a use claimed by an order that no longer carries that coupon (edit swapped/removed it). */
  async releaseCouponUse(trx: Transaction<Database>, tenantId: string, couponCode: string): Promise<void> {
    await trx
      .updateTable('storefront_coupons')
      .set({ times_used: sql`GREATEST(times_used - 1, 0)`, updated_at: new Date() })
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('code', '=', couponCode.toUpperCase())
      .execute();
  }

  /**
   * Authoritative server-side pricing quote for cart & checkout preview.
   * Calculates exact line totals, volume/BOGO discounts, coupons, and delivery fees without creating records.
   */
  async quoteOnlineOrder(slug: string, dto: {
    items: Array<{ productId: number | string; quantity: number; variantName?: string | null }>;
    couponCode?: string;
    deliveryZoneId?: number;
    deliveryZoneName?: string;
    fulfillmentType?: 'delivery' | 'pickup';
    orderType?: string;
    tableNumber?: string;
  }) {
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
    for (const off of (activeOffers as RawStorefrontOffer[])) {
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
      const prod = productMap.get(item.productId) ?? productMap.get(Number(item.productId)) ?? productMap.get(String(item.productId));
      if (!prod) continue;

      const priced = resolveOrderLinePrice(Number(prod.retail_price || 0), prod.metadata, item.variantName, moneyDigits);
      const baseUnitPrice = priced.ok ? priced.unitPrice : Number(prod.retail_price || 0);
      const resolvedVariantName = priced.ok ? priced.variantName : (item.variantName || null);
      const quantity = Math.max(1, Number(item.quantity || 1));
      const pOffers = offersByProductId.get(Number(prod.id)) || [];
      const bestOffer = resolveBestStorefrontOffer(baseUnitPrice, pOffers, quantity, undefined, new Date(), offerTimezone(settings), moneyDigits);
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

    const {
      deliveryFee,
      deliveryZoneId,
      deliveryZoneName,
      discountAmount,
      appliedCouponCode,
    } = await this.resolveOrderCharges(tenant.id, settings, {
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

  async createOnlineOrder(slug: string, dto: CreateOnlineOrderDto, publicOrigin?: string) {
    const tenant = await this.getTenantBySlug(slug);
    const settings = await this.getTenantSettingsMap(tenant.id);

    if (settings.get('storefront_enabled') === 'false') {
      throw new BadRequestException('المتجر الإلكتروني متوقف حالياً عن استقبال الطلبات');
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
    const accessToken = cleanKey
      ? issueIdempotentOrderAccessToken(tenant.id, cleanKey)
      : issueOrderAccessToken();
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
        ok: true, orderId: existingOrder.id, orderNumber: existingOrder.order_number,
        accessToken: accessToken.token,
        trackingUrl: buildOrderTrackingUrl(publicOrigin, slug, existingOrder.order_number, accessToken.token),
        totalAmount: Number(existingOrder.total_amount), subtotal: Number(existingOrder.subtotal),
        deliveryFee: Number(existingOrder.delivery_fee), discountAmount: Number(existingOrder.discount_amount || 0),
        couponCode: existingOrder.coupon_code, items,
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

    const countryCode = (dto.countryCode || 'EG').toUpperCase();

    if (!isDineIn) {
      assertValidCustomerPhone(dto.customerPhone, countryCode);
    }

    const cleanCustomerName = (dto.customerName || (isDineIn ? `عميل طاولة ${dto.tableNumber}` : '')).trim();
    const nameLetters = (cleanCustomerName.match(/[\p{L}\p{M}]/gu) || []).length;
    if (cleanCustomerName.length < 3 || nameLetters < 3) {
      throw new BadRequestException('يرجى إدخال اسم مستلم صحيح لا يقل عن 3 أحرف (مثال: علي، مازن، محمد)');
    }

    let cleanCustomerAddress = isDineIn
      ? `طاولة رقم ${dto.tableNumber}`
      : isPickup
      ? 'استلام ذاتي من الفرع'
      : (dto.customerAddress || '').trim();

    if (!isDineIn && !isPickup && cleanCustomerAddress) {
      const addressLetters = (cleanCustomerAddress.match(/[\p{L}\p{M}]/gu) || []).length;
      if (cleanCustomerAddress.length < 5 || addressLetters < 3) {
        throw new BadRequestException('يرجى إدخال عنوان توصيل واضح ومفصل لا يقل عن 5 أحرف');
      }
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
    for (const off of (activeOffers as RawStorefrontOffer[])) {
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

    const orderCurrency = String(settings.get('currency') || (tenant as any).currency || 'EGP').trim().toUpperCase();
    // Same canonical digits as the quote (INV-STOREFRONT-LINE-TOTAL-DIGITS).
    const moneyDigits = storefrontMoneyDigits(settings, tenant);

    let subtotal = 0;
    // One line per product: the sales engine that will invoice this order rejects two rows of the
    // same product and unit (ensureUniqueFlowItems), so two variants of one product cannot both be
    // invoiced. The storefront cart already keeps a single variant per product.
    const seenProductIds = new Set<number>();
    const validatedItems = dto.items.map((item) => {
      const prod = productMap.get(item.productId) ?? productMap.get(Number(item.productId)) ?? productMap.get(String(item.productId));
      if (!prod) {
        throw new BadRequestException(`عفواً، أحد الأصناف المطلوبة غير متاح في المتجر حالياً، يرجى تحديث السلة.`);
      }
      if (seenProductIds.has(Number(prod.id))) {
        throw new BadRequestException(`لا يمكن طلب أكثر من مقاس أو سطر للصنف "${prod.name}" في نفس الطلب، يرجى توحيده في سطر واحد.`);
      }
      seenProductIds.add(Number(prod.id));
      const availableStock = Math.max(0, Number(prod.stock_qty ?? 0) - Number(prod.reserved_qty ?? 0));
      assertOnlineStockAvailable(prod.name, availableStock, Math.max(1, Number(item.quantity || 1)), allowOutOfStock);
      // SF-4 / O54: the chosen variant is priced here, from the product's own metadata.
      const priced = resolveOrderLinePrice(Number(prod.retail_price || 0), prod.metadata, item.variantName, storefrontMoneyDigits(settings, tenant));
      if (!priced.ok) {
        throw new BadRequestException(`عفواً، المقاس المختار للصنف "${prod.name}" لم يعد متاحاً، يرجى تحديث السلة.`);
      }
      const quantity = Math.max(1, Number(item.quantity || 1));
      const pOffers = offersByProductId.get(Number(prod.id)) || [];
      const bestOffer = resolveBestStorefrontOffer(priced.unitPrice, pOffers, quantity, undefined, new Date(), offerTimezone(settings), storefrontMoneyDigits(settings, tenant));
      const unitPrice = bestOffer.hasDiscount ? bestOffer.price : priced.unitPrice;
      const lineTotal = roundMoney(unitPrice * quantity, moneyDigits);
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
    let targetBranch: { id: number | string; default_stock_location_id?: number | string | null; sales_stock_mode?: string | null; allow_external_sales_stock?: boolean | null } | undefined;
    if (targetBranchId) {
      targetBranch = primaryBranch && targetBranchId === Number(primaryBranch.id)
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
          .where('location_id', 'in', eligible.map((location) => location.id))
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
    // The order and (for dine-in) its kitchen draft are written together: a QR order the kitchen never
    // sees, or a kitchen ticket with no order behind it, are both worse than a clear error.
    const creation = await this.db.transaction().execute(async (trx) => {
      // O57: numbering was MAX+1 outside any lock, so two checkouts in the same instant got the same
      // ON-YYMMDD-NNNN. A per-tenant transaction-scoped advisory lock serialises only this step (it is
      // released at commit/rollback), and the unique index from migration 134 backs it up.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'online_orders:' + tenant.id}))`.execute(trx);
      if (cleanKey) {
        const existing = await trx.selectFrom('online_orders').selectAll()
          .where(sql<boolean>`tenant_id = ${tenant.id}`)
          .where('idempotency_key', '=', cleanKey).executeTakeFirst();
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
          throw new BadRequestException(
            err?.message || 'عفواً، الكمية المطلوبة غير متوفرة في مخزون الفرع المحدد.'
          );
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
        delivery_fee: deliveryFee,
        delivery_zone_id: deliveryZoneId,
        delivery_zone_name: deliveryZoneName,
        discount_amount: discountAmount,
        coupon_code: appliedCouponCode,
        total_amount: totalAmount,
        status: 'pending',
        payment_method: dto.paymentMethod || 'cod',
        payment_status: 'pending',
        branch_id: branchId,
        order_type: isDineIn ? 'dine_in' : 'delivery',
        fulfillment_type: isDineIn ? 'dine_in' : (isPickup ? 'pickup' : 'delivery'),
        country_code: countryCode,
        pickup_branch_id: isPickup ? (dto.pickupBranchId || branchId) : null,
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


      if (isDineIn) {
        // O53: a DRAFT sale, not a posted one. It exists only so the kitchen display (which reads
        // `sales`) shows the ticket immediately. It moves no stock, posts no journal and counts as no
        // revenue. The cashier posts the real invoice through SalesService (load into POS cart or
        // convert); retireKitchenDraft() then removes this draft and hands its ticket state over.
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
            discount: discountAmount,
            tax_rate: 0,
            tax_amount: 0,
            delivery_fee: 0,
            prices_include_tax: false,
            total: totalAmount,
            paid_amount: 0,
            tendered_amount: 0,
            change_amount: 0,
            store_credit_used: 0,
            status: 'draft',
            note: `طلب ذاتي من الطاولة (${dto.tableNumber}) بالـ QR — مسودة للمطبخ، تُرحَّل من الكاشير`,
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
            order_type: 'dine_in',
            table_number: String(dto.tableNumber).trim(),
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
              modifiers: null,
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
    const trackingUrl = buildOrderTrackingUrl(publicOrigin, slug, String(insertedOrder.order_number), accessToken.token);

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

    const currencySymbol = orderCurrency === 'KWD' ? 'د.ك' : orderCurrency === 'SAR' ? 'ر.س' : orderCurrency === 'AED' ? 'د.إ' : orderCurrency === 'QAR' ? 'ر.ق' : orderCurrency === 'BHD' ? 'د.ب' : orderCurrency === 'OMR' ? 'ر.ع' : 'ج';
    const formatMoney = (n: number) => moneyDigits === 3 ? n.toFixed(3) : (orderCurrency === 'EGP' && n % 1 === 0 ? n.toFixed(0) : n.toFixed(2));

    const itemsSummary = validatedItems
      .map((i) => `- ${i.name} (×${i.quantity}) = ${formatMoney(i.total)} ${currencySymbol}`)
      .join('\n');

    const paymentLabel = (dto.paymentMethod === 'credit_card')
      ? 'بطاقة بنكية أونلاين (فيزا / ماستركارد)'
      : (dto.paymentMethod === 'instapay_wallet')
      ? 'تحويل مسبق (إنستاباي / محفظة)'
      : 'دفع عند الاستلام (كاش)';
    const notesPart = dto.customerNotes ? `\nملاحظات: ${dto.customerNotes}` : '';
    const zonePart = deliveryZoneName ? `\nالمنطقة: ${deliveryZoneName}` : '';
    const discountPart = discountAmount > 0 ? `\nالخصم (${appliedCouponCode}): -${formatMoney(discountAmount)} ${currencySymbol}` : '';
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
      `الإجمالي: ${formatMoney(totalAmount)} ${currencySymbol} (${shippingText})`
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
      deliveryFee,
      deliveryZoneId,
      deliveryZoneName,
      discountAmount,
      couponCode: appliedCouponCode,
      items: validatedItems,
      whatsappUrl,
    };
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
    const rows = candidates.filter((r) => verifyOrderAccessToken(tokenByNumber.get(r.order_number), r.access_token_hash));

    return {
      ok: true,
      orders: rows.map((r) => {
        let items: any[] = [];
        try {
          items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : r.items_json;
        } catch {}

        let effectiveStatus: string = r.status;
        if (r.status !== 'cancelled') {
          if (r.status === 'delivered' || r.sale_delivery_status === 'delivered' || r.sale_delivery_status === 'settled') {
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
      throw new BadRequestException('لا يمكن إلغاء طلب تم سداده إلكترونياً من هنا، يرجى التواصل مع المتجر لاسترداد المبلغ');
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
      const cleanCustomerName = dto.customerName.trim();
      const nameLetters = (cleanCustomerName.match(/[\p{L}\p{M}]/gu) || []).length;
      if (cleanCustomerName.length < 3 || nameLetters < 3) {
        throw new BadRequestException('يرجى إدخال اسم مستلم صحيح لا يقل عن 3 أحرف (مثال: علي، مازن، محمد)');
      }
    }

    if (dto.customerAddress) {
      const cleanCustomerAddress = dto.customerAddress.trim();
      const addressLetters = (cleanCustomerAddress.match(/[\p{L}\p{M}]/gu) || []).length;
      if (cleanCustomerAddress.length < 5 || addressLetters < 3) {
        throw new BadRequestException('يرجى إدخال عنوان توصيل واضح ومفصل لا يقل عن 5 أحرف');
      }
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

    const activeOffers = await this.db.selectFrom('product_offers')
      .select(['id', 'product_id', 'offer_type', 'value', sql<string>`start_date::text`.as('start_date'),
        sql<string>`end_date::text`.as('end_date'), 'min_qty', 'is_active',
        'bogo_buy_qty', 'bogo_get_qty', 'bogo_discount_percent', 'happy_hour_start', 'happy_hour_end', 'days_of_week'])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('product_id', 'in', rawProductIds)
      .where('is_active', '=', true).execute();
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
    }> = [];

    const updateAllowsOutOfStock = isOutOfStockOrderingAllowed(settings, tenant.slug, tenant.activity_type);
    // Same canonical digits as quote/create (INV-STOREFRONT-LINE-TOTAL-DIGITS).
    const moneyDigits = storefrontMoneyDigits(settings, tenant);
    const seenProductIds = new Set<number>();
    for (const item of dto.items) {
      const p = productMap.get(Number(item.productId));
      if (!p) {
        throw new BadRequestException('أحد أصناف الطلب لم يعد متاحاً، يرجى تحديث السلة');
      }
      if (seenProductIds.has(Number(p.id))) {
        throw new BadRequestException(`لا يمكن طلب أكثر من مقاس أو سطر للصنف "${p.name}" في نفس الطلب، يرجى توحيده في سطر واحد.`);
      }
      seenProductIds.add(Number(p.id));
      assertOnlineStockAvailable(p.name, Number(p.stock_qty ?? 0), Math.max(1, Number(item.quantity || 1)), updateAllowsOutOfStock);

      const priced = resolveOrderLinePrice(Number(p.retail_price || 0), p.metadata, item.variantName, moneyDigits);
      if (!priced.ok) {
        throw new BadRequestException(`عفواً، المقاس المختار للصنف "${p.name}" لم يعد متاحاً، يرجى تحديث السلة.`);
      }
      const qty = Math.max(1, Number(item.quantity || 1));
      const bestOffer = resolveBestStorefrontOffer(priced.unitPrice, offersByProductId.get(Number(p.id)), qty,
        undefined, new Date(), offerTimezone(settings), moneyDigits);
      const price = bestOffer.hasDiscount ? bestOffer.price : priced.unitPrice;
      const lineTotal = roundMoney(price * qty, moneyDigits);

      subtotal += lineTotal;
      validatedItems.push({
        productId: Number(p.id),
        name: formatVariantLineName(p.name, priced.variantName),
        variantName: priced.variantName,
        quantity: qty,
        unitPrice: price,
        total: lineTotal,
        notes: item.notes ? String(item.notes).trim() : undefined,
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

      if (lockedOrder.status !== 'pending' || lockedOrder.sale_id || lockedOrder.payment_status === 'paid' ||
          lockedOrder.kitchen_draft_sale_id || lockedOrder.gateway_order_id) {
        throw new BadRequestException('لا يمكن تعديل الطلب لتغير حالته أثناء الحفظ، يرجى إعادة المحاولة.');
      }
      if (String(lockedOrder.items_json) !== String(order.items_json) ||
          String(lockedOrder.coupon_code || '') !== String(order.coupon_code || '') ||
          Number(lockedOrder.total_amount) !== Number(order.total_amount)) {
        throw new BadRequestException('تغير الطلب أثناء التعديل، يرجى تحديث الصفحة وإعادة المحاولة');
      }

      if (charges.couponId) {
        await this.claimCouponUse(trx, tenant.id, charges.couponId);
      }
      // The order no longer carries the coupon it consumed (removed, swapped, or no longer eligible).
      const currentOrderCoupon = lockedOrder.coupon_code ? String(lockedOrder.coupon_code) : null;
      if (currentOrderCoupon && currentOrderCoupon.toUpperCase() !== String(charges.appliedCouponCode || '').toUpperCase()) {
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
          throw new BadRequestException(
            err?.message || 'عفواً، الكمية المطلوبة بعد التعديل غير متوفرة في مخزون الفرع.'
          );
        }
      }

      const result = await trx
      .updateTable('online_orders')
      .set({
        items_json: JSON.stringify(validatedItems),
        subtotal,
        delivery_fee: deliveryFee,
        delivery_zone_id: charges.deliveryZoneId,
        delivery_zone_name: charges.deliveryZoneName,
        discount_amount: discountAmount,
        coupon_code: charges.appliedCouponCode,
        total_amount: totalAmount,
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
      totalAmount,
      subtotal,
      deliveryFee,
      discountAmount,
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
  }): Promise<{ reapedOrdersCount: number; reapedOrderNumbers: string[] }> {
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
      .where('stock_reserved', '=', true)
      .where('status', '=', 'pending')
      .where('payment_status', '!=', 'paid')
      .where('sale_id', 'is', null)
      .$if(Boolean(options?.tenantId), (qb) => qb.where(sql<boolean>`tenant_id = ${options!.tenantId!}`))
      .where('stock_reserved_at', '<', cutoffDate)
      .limit(batchLimit)
      .execute();

    const reapedOrderNumbers: string[] = [];

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
            .where('stock_reserved', '=', true)
            .where('status', '=', 'pending')
            .where('payment_status', '!=', 'paid')
            .where('sale_id', 'is', null)
            .forUpdate()
            .executeTakeFirst();

          if (!row || !isReservationExpired(row, new Date(), options)) return;

          // 1. Release location stock
          const items = extractReservationItems(row.items_json);
          if (items.length > 0) {
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
        // Individual order failure shouldn't abort the whole batch
      }
    }

    return {
      reapedOrdersCount: reapedOrderNumbers.length,
      reapedOrderNumbers,
    };
  }

  // --- Merchant Admin Methods ---

  async getOrderCounts(actor: AuthContext) {
    const tenantId = actor.tenantId;
    const counts: Record<string, number> = {
      all: 0,
      active: 0,
      pending: 0,
      confirmed: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
    };

    try {
      const countRows = await this.db
        .selectFrom('online_orders')
        .select(['status', sql<number>`COUNT(*)::int`.as('cnt')])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .groupBy('status')
        .execute();

      for (const cr of countRows) {
        const s = String(cr.status);
        const c = Number(cr.cnt || 0);
        counts[s] = (counts[s] || 0) + c;
        counts.all += c;
        if (['pending', 'confirmed', 'processing', 'shipped'].includes(s)) {
          counts.active += c;
        }
      }
    } catch {
      // Ignore count aggregation failure
    }

    return { counts };
  }

  async bulkCancelOrders(adminPassword: string, targetStatus = 'pending', actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);

    if (!adminPassword || typeof adminPassword !== 'string' || !adminPassword.trim()) {
      throw new BadRequestException('كلمة مرور الأدمن مطلوبة لتأكيد العملية.');
    }

    // Verify admin credentials strictly: only users with role 'admin' or 'super_admin' in this tenant
    const adminUsers = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'role', 'password_hash', 'password_salt'])
      .where('is_active', '=', true)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where((eb) => eb.or([eb('role', '=', 'admin'), eb('role', '=', 'super_admin')]))
      .execute();

    let authorizedAdminName: string | null = null;
    for (const adminUser of adminUsers) {
      const check = await verifyPassword(
        adminPassword.trim(),
        String(adminUser.password_hash || ''),
        String(adminUser.password_salt || ''),
      );
      if (check.valid) {
        authorizedAdminName = String(adminUser.username || 'المدير');
        break;
      }
    }

    if (!authorizedAdminName) {
      throw new UnauthorizedException('كلمة المرور غير صحيحة أو لا تنتمي لحساب أدمن. فقط مدير المنشأة مخول بإلغاء الطلبات جماعياً.');
    }

    const validStatus = ['pending', 'confirmed', 'processing', 'all'].includes(targetStatus) ? targetStatus : 'pending';

    let cancelledCount = 0;

    await this.db.transaction().execute(async (trx) => {
      let ordersQb = trx
        .selectFrom('online_orders')
        .select(['id', 'order_number', 'status', 'payment_status', 'sale_id', 'coupon_code', 'stock_reserved', 'reserved_branch_id', 'reserved_location_id', 'branch_id', 'account_id', 'items_json'])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '!=', 'cancelled')
        .where('status', '!=', 'delivered')
        .where('sale_id', 'is', null) // Never cancel orders already converted to sales invoices
        .where('payment_status', '!=', 'paid'); // Never bulk-cancel orders paid online without refund flow

      if (validStatus !== 'all') {
        ordersQb = ordersQb.where('status', '=', validStatus as any);
      }

      const ordersToCancel = await ordersQb.forUpdate().execute();
      if (ordersToCancel.length === 0) {
        return;
      }

      const orderIds = ordersToCancel.map((o) => o.id);
      cancelledCount = orderIds.length;

      // Update all orders in batch
      await trx
        .updateTable('online_orders')
        .set({
          status: 'cancelled',
          stock_reserved: false,
          updated_at: new Date(),
        })
        .where('id', 'in', orderIds)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      // A failed release must roll back the order cancellation as well.
      for (const row of ordersToCancel) {
        if (row.coupon_code) {
          try {
            await this.releaseCouponUse(trx, tenantId, String(row.coupon_code));
          } catch (err: any) {
            this.logger.error(`bulkCancelOrders: Failed to release coupon ${row.coupon_code} for order ${row.order_number || row.id}: ${err?.message}`);
            throw err;
          }
        }

        if (row.stock_reserved) {
          let orderItems: Array<any> = [];
          try {
            const raw = row.items_json;
            orderItems = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
          } catch {}
          if (orderItems.length > 0) {
            try {
              await releaseLocationStock(trx, {
                branchId: row.reserved_branch_id ?? row.branch_id,
                locationId: row.reserved_location_id,
                tenantId,
                accountId: row.account_id,
                items: orderItems.map((it) => ({
                  productId: Number(it.productId),
                  qty: Number(it.quantity ?? it.qty ?? 1),
                })),
              });
            } catch (err: any) {
              this.logger.error(`bulkCancelOrders: Failed to release stock for order ${row.order_number || row.id}: ${err?.message}`);
              throw err;
            }
          }
        }
      }
    });

    return {
      ok: true,
      cancelledCount,
      message: `تم إلغاء ${cancelledCount} طلب بنجاح بتفويض من: ${authorizedAdminName}`,
    };
  }

  async listOrders(query: Record<string, unknown>, actor: AuthContext) {
    const tenantId = actor.tenantId;
    const status = typeof query.status === 'string' ? query.status.trim() : '';

    let qb = this.db
      .selectFrom('online_orders')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`);

    if (status && status !== 'all') {
      if (status === 'active') {
        qb = qb.where('status', 'in', ['pending', 'confirmed', 'processing', 'shipped']);
      } else {
        qb = qb.where('status', '=', status as any);
      }
    }

    const page = Math.max(1, Number(query.page || 1));
    const hasExplicitLimit = query.limit !== undefined && query.limit !== '' && Number(query.limit) > 0;
    const limit = hasExplicitLimit ? Math.min(Number(query.limit), 200) : (query.all === 'true' ? 10000 : 50);
    const offset = (page - 1) * limit;

    const rows = await qb.orderBy('created_at', 'desc').limit(limit).offset(offset).execute();

    const counts: Record<string, number> = {
      all: 0,
      active: 0,
      pending: 0,
      confirmed: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
    };

    try {
      const countRows = await this.db
        .selectFrom('online_orders')
        .select(['status', sql<number>`COUNT(*)::int`.as('cnt')])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .groupBy('status')
        .execute();

      for (const cr of countRows) {
        const s = String(cr.status);
        const c = Number(cr.cnt || 0);
        counts[s] = (counts[s] || 0) + c;
        counts.all += c;
        if (['pending', 'confirmed', 'processing', 'shipped'].includes(s)) {
          counts.active += c;
        }
      }
    } catch {
      // Ignore count aggregation failure
    }

    return {
      orders: rows.map((r) => {
        let items: any[] = [];
        try {
          items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : r.items_json;
        } catch {}

        return {
          id: r.id,
          orderNumber: r.order_number,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          customerAddress: r.customer_address,
          customerNotes: r.customer_notes,
          subtotal: Number(r.subtotal),
          deliveryFee: Number(r.delivery_fee),
          deliveryZoneId: r.delivery_zone_id ? Number(r.delivery_zone_id) : null,
          deliveryZoneName: r.delivery_zone_name || null,
          discountAmount: Number(r.discount_amount || 0),
          couponCode: r.coupon_code || null,
          totalAmount: Number(r.total_amount),
          status: r.status,
          paymentMethod: r.payment_method,
          paymentStatus: r.payment_status,
          gatewayProvider: r.gateway_provider,
          saleId: r.sale_id,
          shippingCarrier: r.shipping_carrier,
          bostaDeliveryId: r.bosta_delivery_id,
          bostaTrackingNumber: r.bosta_tracking_number,
          bostaStatus: r.bosta_status,
          bostaAwbUrl: r.bosta_awb_url,
          gccShippingCarrier: r.gcc_shipping_carrier,
          gccShippingId: r.gcc_shipping_id,
          gccTrackingNumber: r.gcc_tracking_number,
          gccShippingStatus: r.gcc_shipping_status,
          gccAwbUrl: r.gcc_awb_url,
          gccShippingCreatedAt: r.gcc_shipping_created_at,
          gcc_shipping_carrier: r.gcc_shipping_carrier,
          gcc_shipping_id: r.gcc_shipping_id,
          gcc_tracking_number: r.gcc_tracking_number,
          gcc_shipping_status: r.gcc_shipping_status,
          gcc_awb_url: r.gcc_awb_url,
          gcc_shipping_created_at: r.gcc_shipping_created_at,
          countryCode: r.country_code || null,
          country_code: r.country_code || null,
          createdAt: r.created_at,
          items,
        };
      }),
      counts,
    };
  }

  async getOrder(id: number, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const order = await this.db
      .selectFrom('online_orders')
      .selectAll()
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    if (!order) throw new NotFoundException('الطلب غير موجود');

    let items: any[] = [];
    try {
      items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : order.items_json;
    } catch {}

    return {
      ...order,
      subtotal: Number(order.subtotal),
      deliveryFee: Number(order.delivery_fee),
      deliveryZoneId: order.delivery_zone_id ? Number(order.delivery_zone_id) : null,
      deliveryZoneName: order.delivery_zone_name || null,
      discountAmount: Number(order.discount_amount || 0),
      couponCode: order.coupon_code || null,
      totalAmount: Number(order.total_amount),
      items,
    };
  }

  async updateOrderStatus(id: number, status: string, actor: AuthContext, saleId?: number) {
    const { tenantId } = requireTenantScope(actor);
    const allowed = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) {
      throw new BadRequestException('حالة الطلب غير صالحة');
    }

    const updatePayload: any = {
      status: status as any,
      updated_at: new Date(),
    };
    let linkedStatus: string | undefined;
    await this.db.transaction().execute(async (trx) => {
      if (saleId !== undefined) {
        // POS sends the already-posted sale id as an acknowledgement. Only accept the
        // exact link established atomically by SalesWriteService; never create it here.
        const linkedOrder = await trx.selectFrom('online_orders')
          .select(['sale_id', 'status'])
          .where('id', '=', id).where(sql<boolean>`tenant_id = ${tenantId}`)
          .forUpdate().executeTakeFirst();
        if (!linkedOrder || Number(linkedOrder.sale_id) !== saleId) {
          throw new BadRequestException('الفاتورة غير مرتبطة بهذا الطلب');
        }
        linkedStatus = linkedOrder.status;
      }
      if (saleId !== undefined) {
        // SalesWriteService already linked and finalized the order in its transaction.
        // A delayed POS acknowledgement must not regress `shipped` to `processing`.
        return;
      }
      if (status === 'cancelled') {
        const row = await trx
          .selectFrom('online_orders')
          .select(['id', 'status', 'payment_status', 'sale_id', 'coupon_code', 'stock_reserved', 'reserved_branch_id', 'reserved_location_id', 'branch_id', 'account_id', 'items_json'])
          .where('id', '=', id)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .forUpdate()
          .executeTakeFirst();

        if (!row) throw new NotFoundException('الطلب غير موجود');
        if (row.payment_status === 'paid' || row.sale_id) {
          throw new BadRequestException('الطلب المدفوع أو المحول لفاتورة يحتاج إجراء استرداد/إلغاء مالي مستقل');
        }
        if (row && row.status !== 'cancelled') {
          await trx
            .updateTable('online_orders')
            .set({
              ...updatePayload,
              stock_reserved: false,
            })
            .where('id', '=', id)
            .where(sql<boolean>`tenant_id = ${tenantId}`)
            .execute();

          if (row.coupon_code) {
            await this.releaseCouponUse(trx, tenantId, String(row.coupon_code));
          }

          if (row.stock_reserved) {
            let orderItems: Array<any> = [];
            try {
              const raw = row.items_json;
              orderItems = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
            } catch {}
            if (orderItems.length > 0) {
              await releaseLocationStock(trx, {
                branchId: row.reserved_branch_id ?? row.branch_id,
                locationId: row.reserved_location_id,
                tenantId,
                accountId: row.account_id,
                items: orderItems.map((it) => ({
                  productId: Number(it.productId),
                  qty: Number(it.quantity ?? it.qty ?? 1),
                })),
              });
            }
          }
        }
      } else {
        const current = await trx.selectFrom('online_orders')
          .select(['status', 'payment_status', 'sale_id'])
          .where('id', '=', id).where(sql<boolean>`tenant_id = ${tenantId}`)
          .forUpdate().executeTakeFirst();
        if (!current) throw new NotFoundException('الطلب غير موجود');
        if (current.status === 'review_required' || current.status === 'payment_failed' || current.status === 'cancelled') {
          throw new BadRequestException('لا يمكن تغيير حالة طلب قيد مراجعة الدفع أو ملغي يدوياً');
        }
        const progress = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
        if (progress.indexOf(status) < progress.indexOf(current.status) ||
            (current.sale_id && progress.indexOf(status) < progress.indexOf('shipped'))) {
          throw new BadRequestException('لا يمكن إرجاع الطلب إلى حالة سابقة بعد بدء تجهيزه أو إصدار فاتورته');
        }
        await trx
          .updateTable('online_orders')
          .set(updatePayload)
          .where('id', '=', id)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .execute();

        if (status === 'delivered' && current.sale_id) {
          await trx.updateTable('sales')
            .set({ delivery_status: 'delivered', updated_at: sql`NOW()` })
            .where('id', '=', current.sale_id)
            .where('delivery_status', 'in', ['pending', 'out_for_delivery', null])
            .where(sql<boolean>`tenant_id = ${tenantId}`)
            .execute();
        }
      }
    });

    if (saleId !== undefined && saleId > 0) {
      await this.retireKitchenDraft(tenantId, id, saleId);
    } else if (status === 'cancelled') {
      await this.retireKitchenDraft(tenantId, id, null);
    }

    return { ok: true, status: linkedStatus || status, saleId };
  }

  /**
   * SF-3: a merchant user confirms that an out-of-gateway transfer (InstaPay / wallet) actually
   * arrived. Only after this does the delivery invoice skip cash collection.
   * The conditional UPDATE is the guard: a concurrent confirmation or conversion changes zero rows.
   */
  async confirmManualPayment(id: number, reference: string | undefined, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const order = await this.db
      .selectFrom('online_orders')
      .select(['id', 'payment_method', 'payment_status', 'status', 'sale_id'])
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    if (!order) throw new NotFoundException('الطلب غير موجود');
    if (!(MANUALLY_CONFIRMED_PAYMENT_METHODS as readonly string[]).includes(order.payment_method)) {
      throw new BadRequestException('تأكيد الدفع اليدوي متاح لطلبات التحويل (إنستاباي / محفظة) فقط');
    }
    if (order.payment_status === 'paid') {
      throw new BadRequestException('تم تأكيد سداد هذا الطلب مسبقاً');
    }
    if (order.status === 'cancelled') {
      throw new BadRequestException('لا يمكن تأكيد سداد طلب ملغي');
    }
    if (order.sale_id) {
      throw new BadRequestException('تم إصدار فاتورة لهذا الطلب بالفعل؛ يُسجَّل التحصيل من شاشة الفاتورة');
    }

    const cleanReference = String(reference || '').trim().slice(0, 120);
    const now = new Date();
    const result = await this.db
      .updateTable('online_orders')
      .set({
        payment_status: 'paid',
        gateway_provider: 'manual',
        gateway_transaction_id: cleanReference || null,
        paid_at: now,
        gateway_response_json: JSON.stringify({
          manual: true,
          confirmedByUserId: actor.userId ?? null,
          reference: cleanReference || null,
          confirmedAt: now.toISOString(),
        }),
        updated_at: now,
      })
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where(sql<boolean>`COALESCE(payment_status, 'pending') <> 'paid'`)
      .where('status', 'not in', ['cancelled', 'payment_failed', 'review_required'])
      .where('sale_id', 'is', null)
      .executeTakeFirst();

    if (Number(result?.numUpdatedRows || 0) === 0) {
      throw new BadRequestException('تغيرت حالة الطلب أثناء التأكيد، يرجى تحديث الصفحة');
    }

    return { ok: true, paymentStatus: 'paid' };
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
    if (order.status === 'pending') {
      await this.db
        .updateTable('online_orders')
        .set({ status: 'processing', updated_at: new Date() })
        .where('id', '=', id)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '=', 'pending')
        .execute();
      const lockedOrder = await this.getOrder(id, actor);
      Object.assign(order, lockedOrder);
      if (lockedOrder.status === 'cancelled') {
        throw new BadRequestException('لا يمكن تحويل طلب ملغي إلى فاتورة');
      }
    }

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
    const locationId = order.reserved_location_id || branch?.default_stock_location_id || 1;

    const isDineIn = order.order_type === 'dine_in' || order.fulfillment_type === 'dine_in';
    const isPickup = order.fulfillment_type === 'pickup' || order.order_type === 'pickup';
    const effectiveOrderType = isDineIn ? 'dine_in' : (isPickup ? 'takeaway' : 'delivery');

    // 2.5 Resolve delivery representative (only for delivery orders)
    let repId: number | undefined = undefined;
    let repName = isPickup ? 'استلام من الفرع' : (isDineIn ? 'صالة المطعم' : 'توصيل المتجر');
    if (effectiveOrderType === 'delivery') {
      repId = explicitRepId ? Number(explicitRepId) : 0;
      if (!repId || Number.isNaN(repId) || repId <= 0) {
        let activeRep = await this.db
          .selectFrom('delivery_representatives')
          .select(['id', 'name'])
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .where('is_active', '=', true)
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
      deliveryFeeMode: effectiveOrderType === 'delivery' ? 'store_fleet' : null,
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
    if (order.status === 'pending') {
      await this.db
        .updateTable('online_orders')
        .set({ status: 'processing', updated_at: new Date() })
        .where('id', '=', id)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '=', 'pending')
        .execute();
    }

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
  }

  async getStorefrontSettings(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const tenant = await this.db
      .selectFrom('tenants')
      .select(['slug', 'business_name', 'owner_phone', 'custom_domain', 'country_code'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const settings = await this.getTenantSettingsMap(tenantId);
    const bannerUrl = settings.get('storefront_banner_url') || '';
    const rawBannerUrls = settings.get('storefront_banner_urls');
    let bannerUrls: string[] = [];
    if (rawBannerUrls) {
      try {
        const parsed = JSON.parse(rawBannerUrls);
        if (Array.isArray(parsed)) bannerUrls = parsed.filter(Boolean);
      } catch {}
    }
    if (bannerUrls.length === 0 && bannerUrl) {
      bannerUrls = [bannerUrl];
    }

    const bannerIntervalSeconds = Math.max(1, Number(settings.get('storefront_banner_interval') || 4));
    let bannerPositions: string[] = [];
    try {
      const rawPos = settings.get('storefront_banner_positions');
      if (rawPos) {
        const parsed = JSON.parse(rawPos);
        if (Array.isArray(parsed)) bannerPositions = parsed.filter(Boolean);
      }
    } catch {}

    const rawCurrency = (settings.get('currency') || 'EGP').toUpperCase();
    let countryCode = ((tenant as any)?.country_code || settings.get('country') || '').toUpperCase();
    if (!countryCode) {
      if (rawCurrency === 'KWD') countryCode = 'KW';
      else if (rawCurrency === 'SAR') countryCode = 'SA';
      else if (rawCurrency === 'AED') countryCode = 'AE';
      else if (rawCurrency === 'QAR') countryCode = 'QA';
      else if (rawCurrency === 'BHD') countryCode = 'BH';
      else if (rawCurrency === 'OMR') countryCode = 'OM';
      else countryCode = 'EG';
    }
    const isGcc = ['KW', 'SA', 'AE', 'QA', 'BH', 'OM'].includes(countryCode) ||
      ['KWD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR'].includes(rawCurrency);
    const defaultProvider = isGcc ? 'tap' : 'paymob';

    return {
      slug: settings.get('storefront_slug') || tenant?.slug || '',
      customDomain: tenant?.custom_domain || null,
      enabled: settings.get('storefront_enabled') !== 'false',
      title: settings.get('storefront_title') || settings.get('storeName') || tenant?.business_name || '',
      address: settings.get('storefront_address') || settings.get('address') || '',
      bio: settings.get('storefront_bio') || '',
      logoUrl: settings.get('storefront_logo_url') || settings.get('logo_url') || '',
      logo_url: settings.get('storefront_logo_url') || settings.get('logo_url') || '',
      announcement: settings.get('storefront_announcement') || '',
      bannerUrl: bannerUrls[0] || bannerUrl,
      bannerUrls,
      bannerFit: settings.get('storefront_banner_fit') || 'contain',
      bannerPosition: settings.get('storefront_banner_position') || 'center',
      bannerPositions,
      bannerIntervalSeconds,
      smartDealsEnabled: settings.get('storefront_smart_deals') === 'true',
      deliveryFee: Number(settings.get('storefront_delivery_fee') || 0),
      minOrder: Number(settings.get('storefront_min_order') || 0),
      freeShippingEnabled: settings.get('storefront_free_shipping_enabled') === 'true',
      freeShippingMinOrder: Number(settings.get('storefront_free_shipping_min_order') || 0),
      whatsappPhone: settings.get('storefront_whatsapp') || settings.get('phone') || tenant?.owner_phone || '',
      countryCode,
      currency: rawCurrency,
      onlinePaymentEnabled: settings.get('storefront_online_payment_enabled') === 'true',
      onlinePaymentProvider: settings.get('storefront_online_payment_provider') || defaultProvider,
      paymobApiKey: maskGatewaySecret(settings.get('storefront_paymob_api_key')),
      paymobIntegrationId: settings.get('storefront_paymob_integration_id') || '',
      paymobIframeId: settings.get('storefront_paymob_iframe_id') || '',
      paymobHmacSecret: maskGatewaySecret(settings.get('storefront_paymob_hmac_secret')),
      paymobTestMode: settings.get('storefront_paymob_test_mode') !== 'false',
      xpayApiKey: maskGatewaySecret(settings.get('storefront_xpay_api_key')),
      xpayCommunityId: settings.get('storefront_xpay_community_id') || '',
      xpayTestMode: settings.get('storefront_xpay_test_mode') !== 'false',
      tapSecretKey: maskGatewaySecret(settings.get('storefront_tap_secret_key')),
      tapPublishableKey: settings.get('storefront_tap_publishable_key') || '',
      tapTestMode: settings.get('storefront_tap_test_mode') !== 'false',
      stripeSecretKey: maskGatewaySecret(settings.get('storefront_stripe_secret_key')),
      stripePublishableKey: settings.get('storefront_stripe_publishable_key') || '',
      stripeWebhookSecret: maskGatewaySecret(settings.get('storefront_stripe_webhook_secret')),
      stripeTestMode: settings.get('storefront_stripe_test_mode') !== 'false',
      brandColor: settings.get('storefront_brand_color') || '#170e5e',
      brandSecondaryColor: settings.get('storefront_brand_secondary_color') || '#f59e0b',
      brandSurfaceColor: settings.get('storefront_brand_surface_color') || '#f8fafc',
      themePreset: settings.get('storefront_theme_preset') || 'royal_navy',
      metaPixelId: settings.get('storefront_meta_pixel_id') || '',
      ga4Id: settings.get('storefront_ga4_id') || '',
      tiktokPixelId: settings.get('storefront_tiktok_pixel_id') || '',
      pickupEnabled: settings.get('storefront_pickup_enabled') !== 'false',
      heroHeadline: settings.get('storefront_hero_headline') || '',
      heroSubtitle: settings.get('storefront_hero_subtitle') || '',
      supportEmail: settings.get('storefront_support_email') || settings.get('email') || '',
      contactPhone: settings.get('storefront_contact_phone') || '',
      facebookUrl: settings.get('storefront_facebook_url') || '',
      instagramUrl: settings.get('storefront_instagram_url') || '',
      twitterUrl: settings.get('storefront_twitter_url') || '',
      tiktokUrl: settings.get('storefront_tiktok_url') || '',
      youtubeUrl: settings.get('storefront_youtube_url') || '',
      telegramUrl: settings.get('storefront_telegram_url') || '',
      midBannersEnabled: settings.get('storefront_mid_banners_enabled') !== 'false',
      heroBannerFullBleed: settings.get('storefront_hero_full_bleed') !== 'false',
      midBanners: (() => {
        try {
          const raw = settings.get('storefront_mid_banners');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.filter(Boolean);
          }
        } catch {}
        return [];
      })(),
    };
  }

  async updateStorefrontSettings(payload: UpdateStorefrontSettingsDto, actor: AuthContext) {
    const { tenantId, accountId } = requireTenantScope(actor);

    // SF-9: banners are the heaviest images in /info; store them once and keep only URLs.
    if (payload.bannerUrl !== undefined) {
      payload.bannerUrl = await this.media.normalizeImageRef(tenantId, payload.bannerUrl);
    }
    const rawLogo = payload.logoUrl ?? payload.logo_url;
    if (rawLogo !== undefined) {
      payload.logoUrl = (await this.media.normalizeImageRef(tenantId, rawLogo)) || '';
    }
    if (Array.isArray(payload.bannerUrls)) {
      const normalized: string[] = [];
      for (const url of payload.bannerUrls) {
        const ref = await this.media.normalizeImageRef(tenantId, url);
        if (ref) normalized.push(ref);
      }
      payload.bannerUrls = normalized;
    }

    if (payload.customDomain !== undefined) {
      const cleanDomain = payload.customDomain?.trim()
        ? payload.customDomain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]
        : null;
      await this.db
        .updateTable('tenants')
        .set({ custom_domain: cleanDomain, updated_at: new Date() })
        .where('id', '=', tenantId)
        .execute();
    }

    if (payload.slug !== undefined) {
      const cleanSlug = String(payload.slug || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

      // A store that already carries a now-reserved name keeps working and can still save its
      // other settings; only switching TO a reserved name is refused.
      let keepsReservedSlug = false;
      if (isReservedStoreSlug(cleanSlug)) {
        const [current, currentSetting] = await Promise.all([
          this.db.selectFrom('tenants').select('slug').where('id', '=', tenantId).executeTakeFirst(),
          this.db
            .selectFrom('settings')
            .select('value')
            .where(sql<boolean>`tenant_id = ${tenantId}`)
            .where('key', '=', 'storefront_slug')
            .executeTakeFirst(),
        ]);
        const currentStoreSlug = String(currentSetting?.value ?? '').replace(/^"|"$/g, '').trim().toLowerCase();
        keepsReservedSlug = cleanSlug === String(current?.slug || '').toLowerCase() || cleanSlug === currentStoreSlug;
        if (!keepsReservedSlug) {
          throw new BadRequestException('هذا الاسم محجوز للنظام ولا يمكن استخدامه كرابط للمتجر');
        }
      }

      if (cleanSlug && cleanSlug.length >= 3 && !keepsReservedSlug) {
        const existing = await this.db
          .selectFrom('tenants')
          .select('id')
          .where('slug', '=', cleanSlug)
          .where('id', '!=', tenantId)
          .executeTakeFirst();

        if (existing) {
          throw new BadRequestException('هذا الرابط مستخدم بالفعل من متجر آخر، يرجى اختيار رابط مختلف.');
        }

        await this.db
          .updateTable('tenants')
          .set({ slug: cleanSlug, updated_at: new Date() })
          .where('id', '=', tenantId)
          .execute();
      }
    }

    const entries: Array<{ key: string; value: any }> = [];
    if (payload.slug !== undefined) {
      const cleanSlug = String(payload.slug || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (cleanSlug && cleanSlug.length >= 3 && !isReservedStoreSlug(cleanSlug)) {
        entries.push({ key: 'storefront_slug', value: cleanSlug });
      }
    }
    if (payload.enabled !== undefined) entries.push({ key: 'storefront_enabled', value: payload.enabled });
    if (payload.title !== undefined) entries.push({ key: 'storefront_title', value: payload.title });
    if (payload.address !== undefined) entries.push({ key: 'storefront_address', value: payload.address });
    if (payload.bio !== undefined) entries.push({ key: 'storefront_bio', value: payload.bio });
    if (payload.logoUrl !== undefined) entries.push({ key: 'storefront_logo_url', value: payload.logoUrl });
    if (payload.announcement !== undefined) entries.push({ key: 'storefront_announcement', value: payload.announcement });
    if (payload.bannerUrl !== undefined) entries.push({ key: 'storefront_banner_url', value: payload.bannerUrl });
    if (payload.bannerUrls !== undefined) {
      entries.push({ key: 'storefront_banner_urls', value: payload.bannerUrls });
      if (payload.bannerUrls.length > 0 && payload.bannerUrl === undefined) {
        entries.push({ key: 'storefront_banner_url', value: payload.bannerUrls[0] });
      } else if (payload.bannerUrls.length === 0 && payload.bannerUrl === undefined) {
        entries.push({ key: 'storefront_banner_url', value: '' });
      }
    }
    if (payload.bannerFit !== undefined) entries.push({ key: 'storefront_banner_fit', value: payload.bannerFit });
    if (payload.bannerPosition !== undefined) entries.push({ key: 'storefront_banner_position', value: payload.bannerPosition });
    if (payload.bannerPositions !== undefined) entries.push({ key: 'storefront_banner_positions', value: payload.bannerPositions });
    if (payload.bannerIntervalSeconds !== undefined) entries.push({ key: 'storefront_banner_interval', value: payload.bannerIntervalSeconds });
    if (payload.smartDealsEnabled !== undefined) entries.push({ key: 'storefront_smart_deals', value: payload.smartDealsEnabled });
    if (payload.deliveryFee !== undefined) entries.push({ key: 'storefront_delivery_fee', value: payload.deliveryFee });
    if (payload.minOrder !== undefined) entries.push({ key: 'storefront_min_order', value: payload.minOrder });
    if (payload.freeShippingEnabled !== undefined) entries.push({ key: 'storefront_free_shipping_enabled', value: payload.freeShippingEnabled });
    if (payload.freeShippingMinOrder !== undefined) entries.push({ key: 'storefront_free_shipping_min_order', value: payload.freeShippingMinOrder });
    if (payload.whatsappPhone !== undefined) entries.push({ key: 'storefront_whatsapp', value: payload.whatsappPhone });
    if (payload.onlinePaymentEnabled !== undefined) entries.push({ key: 'storefront_online_payment_enabled', value: payload.onlinePaymentEnabled });
    if (payload.onlinePaymentProvider !== undefined) entries.push({ key: 'storefront_online_payment_provider', value: payload.onlinePaymentProvider });
    if (payload.paymobApiKey !== undefined && !isMaskedGatewaySecret(payload.paymobApiKey)) entries.push({ key: 'storefront_paymob_api_key', value: payload.paymobApiKey });
    if (payload.paymobIntegrationId !== undefined) entries.push({ key: 'storefront_paymob_integration_id', value: payload.paymobIntegrationId });
    if (payload.paymobIframeId !== undefined) entries.push({ key: 'storefront_paymob_iframe_id', value: payload.paymobIframeId });
    if (payload.paymobHmacSecret !== undefined && !isMaskedGatewaySecret(payload.paymobHmacSecret)) entries.push({ key: 'storefront_paymob_hmac_secret', value: payload.paymobHmacSecret });
    if (payload.paymobTestMode !== undefined) entries.push({ key: 'storefront_paymob_test_mode', value: payload.paymobTestMode });
    if (payload.xpayApiKey !== undefined && !isMaskedGatewaySecret(payload.xpayApiKey)) entries.push({ key: 'storefront_xpay_api_key', value: payload.xpayApiKey });
    if (payload.xpayCommunityId !== undefined) entries.push({ key: 'storefront_xpay_community_id', value: payload.xpayCommunityId });
    if (payload.xpayTestMode !== undefined) entries.push({ key: 'storefront_xpay_test_mode', value: payload.xpayTestMode });
    if (payload.tapSecretKey !== undefined && !isMaskedGatewaySecret(payload.tapSecretKey)) entries.push({ key: 'storefront_tap_secret_key', value: payload.tapSecretKey });
    if (payload.tapPublishableKey !== undefined) entries.push({ key: 'storefront_tap_publishable_key', value: payload.tapPublishableKey });
    if (payload.tapTestMode !== undefined) entries.push({ key: 'storefront_tap_test_mode', value: payload.tapTestMode });
    if (payload.stripeSecretKey !== undefined && !isMaskedGatewaySecret(payload.stripeSecretKey)) entries.push({ key: 'storefront_stripe_secret_key', value: payload.stripeSecretKey });
    if (payload.stripePublishableKey !== undefined) entries.push({ key: 'storefront_stripe_publishable_key', value: payload.stripePublishableKey });
    if (payload.stripeWebhookSecret !== undefined && !isMaskedGatewaySecret(payload.stripeWebhookSecret)) entries.push({ key: 'storefront_stripe_webhook_secret', value: payload.stripeWebhookSecret });
    if (payload.stripeTestMode !== undefined) entries.push({ key: 'storefront_stripe_test_mode', value: payload.stripeTestMode });
    if (payload.brandColor !== undefined) entries.push({ key: 'storefront_brand_color', value: payload.brandColor });
    if (payload.brandSecondaryColor !== undefined) entries.push({ key: 'storefront_brand_secondary_color', value: payload.brandSecondaryColor });
    if (payload.brandSurfaceColor !== undefined) entries.push({ key: 'storefront_brand_surface_color', value: payload.brandSurfaceColor });
    if (payload.themePreset !== undefined) entries.push({ key: 'storefront_theme_preset', value: payload.themePreset });
    if (payload.metaPixelId !== undefined) entries.push({ key: 'storefront_meta_pixel_id', value: payload.metaPixelId });
    if (payload.ga4Id !== undefined) entries.push({ key: 'storefront_ga4_id', value: payload.ga4Id });
    if (payload.tiktokPixelId !== undefined) entries.push({ key: 'storefront_tiktok_pixel_id', value: payload.tiktokPixelId });
    if (payload.snapchatPixelId !== undefined) entries.push({ key: 'storefront_snapchat_pixel_id', value: payload.snapchatPixelId });
    if (payload.pickupEnabled !== undefined) entries.push({ key: 'storefront_pickup_enabled', value: payload.pickupEnabled });
    if (payload.heroHeadline !== undefined) entries.push({ key: 'storefront_hero_headline', value: payload.heroHeadline });
    if (payload.heroSubtitle !== undefined) entries.push({ key: 'storefront_hero_subtitle', value: payload.heroSubtitle });
    if (payload.supportEmail !== undefined) entries.push({ key: 'storefront_support_email', value: payload.supportEmail });
    if (payload.contactPhone !== undefined) entries.push({ key: 'storefront_contact_phone', value: payload.contactPhone });
    if (payload.facebookUrl !== undefined) entries.push({ key: 'storefront_facebook_url', value: payload.facebookUrl });
    if (payload.instagramUrl !== undefined) entries.push({ key: 'storefront_instagram_url', value: payload.instagramUrl });
    if (payload.twitterUrl !== undefined) entries.push({ key: 'storefront_twitter_url', value: payload.twitterUrl });
    if (payload.tiktokUrl !== undefined) entries.push({ key: 'storefront_tiktok_url', value: payload.tiktokUrl });
    if (payload.youtubeUrl !== undefined) entries.push({ key: 'storefront_youtube_url', value: payload.youtubeUrl });
    if (payload.telegramUrl !== undefined) entries.push({ key: 'storefront_telegram_url', value: payload.telegramUrl });
    if (payload.allowOutOfStockOrders !== undefined) entries.push({ key: 'storefront_allow_out_of_stock', value: payload.allowOutOfStockOrders });
    if (payload.showOutOfStockProducts !== undefined) entries.push({ key: 'storefront_show_out_of_stock', value: payload.showOutOfStockProducts });
    if (payload.stockMode !== undefined) entries.push({ key: 'storefront_stock_mode', value: normalizeStorefrontStockMode(payload.stockMode) });
    if (payload.midBannersEnabled !== undefined) entries.push({ key: 'storefront_mid_banners_enabled', value: payload.midBannersEnabled });
    if (payload.heroBannerFullBleed !== undefined) entries.push({ key: 'storefront_hero_full_bleed', value: payload.heroBannerFullBleed });
    if (payload.midBanners !== undefined) {
      const normalizedBanners: any[] = [];
      if (Array.isArray(payload.midBanners)) {
        for (const b of payload.midBanners) {
          if (!b) continue;
          const normalizedImg = b.imageUrl ? await this.media.normalizeImageRef(tenantId, b.imageUrl) : '';
          normalizedBanners.push({
            ...b,
            imageUrl: normalizedImg,
          });
        }
      }
      entries.push({ key: 'storefront_mid_banners', value: normalizedBanners });
    }
    await this.db.transaction().execute(async (trx) => {
      for (const e of entries) {
        await sql`
          INSERT INTO settings (key, value, tenant_id, account_id)
          VALUES (${e.key}, ${JSON.stringify(e.value)}, ${tenantId}, ${accountId})
          ON CONFLICT (tenant_id, key)
          DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id
        `.execute(trx);
      }
    });
    this.invalidateCatalogCache();

    return this.getStorefrontSettings(actor);
  }

  async updateProductImage(productId: number, imageUrl: string, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const existing = await this.db
      .selectFrom('products')
      .select(['id', 'metadata'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', productId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('الصنف غير موجود');
    }

    // SF-9: store the picture as binary and keep only its URL in metadata (never the base64 itself).
    const storedUrl = await this.media.normalizeImageRef(tenantId, imageUrl);
    const currentMeta = typeof existing.metadata === 'object' && existing.metadata ? existing.metadata : {};
    const updatedMeta = { ...currentMeta, imageUrl: storedUrl };

    await this.db
      .updateTable('products')
      .set({
        metadata: JSON.stringify(updatedMeta) as any,
        updated_at: new Date(),
      })
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', productId)
      .execute();

    this.invalidateCatalogCache();

    return { success: true, productId, imageUrl: storedUrl };
  }

  async updateCategoryImage(categoryId: number, rawImageUrl: string, actor: AuthContext) {
    const { tenantId, accountId } = requireTenantScope(actor);
    const imageUrl = await this.media.normalizeImageRef(tenantId, rawImageUrl);

    // Fetch existing category image map
    const existing = await this.db
      .selectFrom('settings')
      .select(['value'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('key', '=', 'storefront_category_images')
      .executeTakeFirst();

    let map: Record<string, string> = {};
    if (existing?.value) {
      try {
        const parsed = JSON.parse(existing.value);
        map = typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
      } catch {}
    }

    if (imageUrl) {
      map[String(categoryId)] = imageUrl;
    } else {
      delete map[String(categoryId)];
    }

    await sql`
      INSERT INTO settings (key, value, tenant_id, account_id)
      VALUES ('storefront_category_images', ${JSON.stringify(JSON.stringify(map))}, ${tenantId}, ${accountId})
      ON CONFLICT (tenant_id, key)
      DO UPDATE SET value = EXCLUDED.value, account_id = EXCLUDED.account_id
    `.execute(this.db);

    this.invalidateCatalogCache();

    return { success: true, categoryId, imageUrl };
  }

  async submitProductReview(slug: string, productId: number, dto: CreateProductReviewDto) {
    const tenant = await this.getTenantBySlug(slug);

    // Verify product exists for this tenant
    const product = await this.db
      .selectFrom('products')
      .select(['id', 'name'])
      .where('id', '=', productId)
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (!product) {
      throw new NotFoundException('المنتج غير موجود');
    }

    const rating = Math.max(1, Math.min(5, Math.round(Number(dto.rating) || 5)));
    const customerName = (dto.customerName || '').trim() || 'عميل المتجر';
    const customerPhone = (dto.customerPhone || '').trim();
    const comment = (dto.comment || '').trim();

    await this.db
      .insertInto('product_reviews')
      .values({
        tenant_id: tenant.id,
        account_id: tenant.id,
        product_id: productId,
        rating,
        customer_name: customerName,
        customer_phone: customerPhone || null,
        comment: comment || null,
        is_approved: true,
      })
      .execute();

    // Invalidate cache immediately so new rating is live!
    this.invalidateCatalogCache(slug);

    // Calculate new summary for this product
    const stats = await this.db
      .selectFrom('product_reviews')
      .select([
        sql<number>`ROUND(AVG(rating)::numeric, 1)`.as('avg_rating'),
        sql<number>`COUNT(*)::int`.as('review_count'),
      ])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('product_id', '=', productId)
      .where('is_approved', '=', true)
      .executeTakeFirst();

    return {
      ok: true,
      productId,
      avgRating: Number(stats?.avg_rating) || rating,
      reviewCount: Number(stats?.review_count) || 1,
      message: 'شكراً لك! تم تسجيل تقييمك بنجاح.',
    };
  }

  async getProductReviews(slug: string, productId: number) {
    const tenant = await this.getTenantBySlug(slug);

    const reviews = await this.db
      .selectFrom('product_reviews')
      .select(['id', 'rating', 'customer_name', 'comment', 'created_at'])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('product_id', '=', productId)
      .where('is_approved', '=', true)
      .orderBy('created_at', 'desc')
      .limit(30)
      .execute();

    return {
      ok: true,
      productId,
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: Number(r.rating),
        customerName: r.customer_name || 'عميل المتجر',
        comment: r.comment || '',
        createdAt: r.created_at,
      })),
    };
  }

  // --- Coupon & Promo Code Management ---

  async validateCoupon(slug: string, code: string, subtotal: number) {
    const tenant = await this.getTenantBySlug(slug);
    const codeUpper = String(code || '').trim().toUpperCase();
    if (!codeUpper) {
      throw new BadRequestException('يرجى إدخال كود الكوبون');
    }

    const coupon = await this.db
      .selectFrom('storefront_coupons')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('code', '=', codeUpper)
      .executeTakeFirst();

    if (!coupon) {
      return { ok: false, message: 'كود الكوبون غير صحيح أو غير مسجل' };
    }

    if (!coupon.is_active) {
      return { ok: false, message: 'هذا الكوبون تم إيقافه حالياً من قِبل المتجر' };
    }

    const now = new Date();
    if (coupon.start_date && new Date(coupon.start_date) > now) {
      return { ok: false, message: 'عذراً، هذا الكوبون لم يبدأ بعد' };
    }
    if (coupon.end_date && new Date(coupon.end_date) < now) {
      return { ok: false, message: 'عذراً، هذا الكوبون انتهت فترة صلاحيته' };
    }

    if (coupon.usage_limit !== null && Number(coupon.times_used || 0) >= coupon.usage_limit) {
      return { ok: false, message: 'عذراً، استنفد هذا الكوبون الحد الأقصى لمرات الاستخدام المتاحة' };
    }

    const minOrder = Number(coupon.min_order_amount || 0);
    if (subtotal < minOrder) {
      return {
        ok: false,
        message: `لتفعيل هذا الكوبون، يجب أن تبلغ قيمة المشتريات ${minOrder} ج على الأقل (مشترياتك الآن: ${subtotal.toFixed(0)} ج)`,
      };
    }

    let discountAmount = 0;
    let isFreeShipping = false;
    if (coupon.discount_type === 'free_shipping') {
      isFreeShipping = true;
    } else if (coupon.discount_type === 'percentage') {
      const rawDiscount = (subtotal * Number(coupon.discount_value)) / 100;
      discountAmount = coupon.max_discount_amount
        ? Math.min(rawDiscount, Number(coupon.max_discount_amount))
        : rawDiscount;
    } else if (coupon.discount_type === 'fixed') {
      discountAmount = Math.min(subtotal, Number(coupon.discount_value));
    }

    return {
      ok: true,
      code: coupon.code,
      discountType: coupon.discount_type,
      discountValue: Number(coupon.discount_value),
      discountAmount: Number(discountAmount.toFixed(2)),
      isFreeShipping,
      minOrderAmount: minOrder,
      maxDiscountAmount: coupon.max_discount_amount ? Number(coupon.max_discount_amount) : null,
      message: isFreeShipping
        ? 'تم تطبيق كوبون الشحن المجاني بنجاح!'
        : `تم تطبيق كود الخصم بنجاح (- ${discountAmount.toFixed(0)} ج)!`,
    };
  }

  async listCoupons(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const rows = await this.db
      .selectFrom('storefront_coupons')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .orderBy('created_at', 'desc')
      .execute();

    return {
      ok: true,
      coupons: rows.map((c) => ({
        id: c.id,
        code: c.code,
        discountType: c.discount_type,
        discountValue: Number(c.discount_value),
        minOrderAmount: Number(c.min_order_amount),
        maxDiscountAmount: c.max_discount_amount ? Number(c.max_discount_amount) : null,
        usageLimit: c.usage_limit,
        timesUsed: Number(c.times_used || 0),
        isActive: Boolean(c.is_active),
        startDate: c.start_date,
        endDate: c.end_date,
        createdAt: c.created_at,
      })),
    };
  }

  async createCoupon(dto: CreateCouponDto, actor: AuthContext) {
    const { tenantId, accountId } = requireTenantScope(actor);
    const codeClean = dto.code.trim().toUpperCase();

    const existing = await this.db
      .selectFrom('storefront_coupons')
      .select('id')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('code', '=', codeClean)
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException(`كود الكوبون "${codeClean}" موجود بالفعل، يرجى اختيار كود آخر`);
    }

    if (dto.discountType === 'percentage' && (Number(dto.discountValue) <= 0 || Number(dto.discountValue) > 100)) {
      throw new BadRequestException('نسبة الخصم يجب أن تكون بين 1% و 100%');
    }

    const inserted = await this.db
      .insertInto('storefront_coupons')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        code: codeClean,
        discount_type: dto.discountType,
        discount_value: dto.discountValue,
        min_order_amount: dto.minOrderAmount || 0,
        max_discount_amount: dto.maxDiscountAmount || null,
        usage_limit: dto.usageLimit || null,
        times_used: 0,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
        start_date: dto.startDate ? new Date(dto.startDate) : null,
        end_date: dto.endDate ? new Date(dto.endDate) : null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { ok: true, coupon: inserted };
  }

  async updateCoupon(id: number, dto: UpdateCouponDto, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const existing = await this.db
      .selectFrom('storefront_coupons')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('الكوبون غير موجود');
    }

    const effectiveType = dto.discountType || existing.discount_type;
    const effectiveValue = dto.discountValue !== undefined ? dto.discountValue : existing.discount_value;
    if (effectiveType === 'percentage' && (Number(effectiveValue) <= 0 || Number(effectiveValue) > 100)) {
      throw new BadRequestException('نسبة الخصم يجب أن تكون بين 1% و 100%');
    }

    const payload: any = { updated_at: new Date() };
    if (dto.code !== undefined) {
      payload.code = dto.code.trim().toUpperCase();
    }
    if (dto.discountType !== undefined) payload.discount_type = dto.discountType;
    if (dto.discountValue !== undefined) payload.discount_value = dto.discountValue;
    if (dto.minOrderAmount !== undefined) payload.min_order_amount = dto.minOrderAmount;
    if (dto.maxDiscountAmount !== undefined) payload.max_discount_amount = dto.maxDiscountAmount;
    if (dto.usageLimit !== undefined) payload.usage_limit = dto.usageLimit;
    if (dto.isActive !== undefined) payload.is_active = dto.isActive;
    if (dto.startDate !== undefined) payload.start_date = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) payload.end_date = dto.endDate ? new Date(dto.endDate) : null;

    await this.db
      .updateTable('storefront_coupons')
      .set(payload)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .execute();

    return { ok: true, id };
  }

  async deleteCoupon(id: number, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    await this.db
      .deleteFrom('storefront_coupons')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .execute();

    return { ok: true, id };
  }

  // --- Delivery Zones Management ---

  async listDeliveryZones(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const rows = await this.db
      .selectFrom('storefront_delivery_zones')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
      .execute();

    return {
      ok: true,
      zones: rows.map((z) => ({
        id: z.id,
        name: z.name,
        deliveryFee: Number(z.delivery_fee || 0),
        estimatedTime: z.estimated_time || '',
        isActive: Boolean(z.is_active),
        sortOrder: Number(z.sort_order || 0),
        createdAt: z.created_at,
        updatedAt: z.updated_at,
      })),
    };
  }

  async createDeliveryZone(dto: CreateDeliveryZoneDto, actor: AuthContext) {
    const { tenantId, accountId } = requireTenantScope(actor);
    const nameClean = dto.name.trim();

    const inserted = await this.db
      .insertInto('storefront_delivery_zones')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        name: nameClean,
        delivery_fee: dto.deliveryFee,
        estimated_time: dto.estimatedTime ? dto.estimatedTime.trim() : null,
        is_active: dto.isActive !== undefined ? dto.isActive : true,
        sort_order: dto.sortOrder !== undefined ? dto.sortOrder : 0,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      ok: true,
      zone: {
        id: inserted.id,
        name: inserted.name,
        deliveryFee: Number(inserted.delivery_fee || 0),
        estimatedTime: inserted.estimated_time || '',
        isActive: Boolean(inserted.is_active),
        sortOrder: Number(inserted.sort_order || 0),
      },
    };
  }

  async updateDeliveryZone(id: number, dto: UpdateDeliveryZoneDto, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const existing = await this.db
      .selectFrom('storefront_delivery_zones')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('منطقة التوصيل غير موجودة');
    }

    const payload: any = { updated_at: new Date() };
    if (dto.name !== undefined) payload.name = dto.name.trim();
    if (dto.deliveryFee !== undefined) payload.delivery_fee = dto.deliveryFee;
    if (dto.estimatedTime !== undefined) payload.estimated_time = dto.estimatedTime ? dto.estimatedTime.trim() : null;
    if (dto.isActive !== undefined) payload.is_active = dto.isActive;
    if (dto.sortOrder !== undefined) payload.sort_order = dto.sortOrder;

    await this.db
      .updateTable('storefront_delivery_zones')
      .set(payload)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .execute();

    return { ok: true, id };
  }

  async deleteDeliveryZone(id: number, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    await this.db
      .deleteFrom('storefront_delivery_zones')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .execute();

    return { ok: true, id };
  }

  async getTablesQrCodes(slug: string, fromTable: number = 1, toTable: number = 20, baseUrl?: string) {
    const tenant = await this.getTenantBySlug(slug);
    const origin = baseUrl || process.env.APP_URL || 'http://localhost:5173';
    const start = Math.max(1, Number(fromTable || 1));
    const end = Math.min(100, Math.max(start, Number(toTable || 20)));

    const tables = [];
    const storeBase = buildStorePublicBase(origin, slug) || `${origin}/st/${slug}`;
    for (let i = start; i <= end; i++) {
      const qrUrl = `${storeBase}?table=${i}`;
      tables.push({
        tableNumber: i,
        tableName: `طاولة ${i}`,
        url: qrUrl,
        slug,
        tenantName: tenant.business_name,
      });
    }

    return {
      ok: true,
      slug,
      tenantName: tenant.business_name,
      totalTables: tables.length,
      tables,
    };
  }

  // --- Abandoned Carts & Recovery ---

  async recordAbandonedCart(slug: string, dto: RecordAbandonedCartDto) {
    const tenant = await this.getTenantBySlug(slug);
    const cleanPhone = (dto.customerPhone || '').trim();
    if (!cleanPhone || cleanPhone.length < 6) return { ok: false };

    const recent = await (this.db as any)
      .selectFrom('storefront_abandoned_carts')
      .select(['id'])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('customer_phone', '=', cleanPhone)
      .where('recovered', '=', false)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    if (recent) {
      await (this.db as any)
        .updateTable('storefront_abandoned_carts')
        .set({
          customer_name: dto.customerName || null,
          country_code: dto.countryCode || 'EG',
          items_json: JSON.stringify(dto.items || []),
          subtotal: Number(dto.subtotal || 0),
          updated_at: new Date(),
        })
        .where('id', '=', recent.id)
        .where('tenant_id', '=', tenant.id)
        .execute();
      return { ok: true, cartId: recent.id };
    }

    const inserted = await (this.db as any)
      .insertInto('storefront_abandoned_carts')
      .values({
        tenant_id: tenant.id,
        customer_name: dto.customerName || null,
        customer_phone: cleanPhone,
        country_code: dto.countryCode || 'EG',
        items_json: JSON.stringify(dto.items || []),
        subtotal: Number(dto.subtotal || 0),
        recovered: false,
      })
      .returning(['id'])
      .executeTakeFirst();

    return { ok: true, cartId: inserted?.id };
  }

  async listAbandonedCarts(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const carts = await (this.db as any)
      .selectFrom('storefront_abandoned_carts')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();

    return carts.map((c: any) => {
      let items: any[] = [];
      try {
        items = JSON.parse(c.items_json);
      } catch {}
      return {
        id: c.id,
        customerName: c.customer_name || 'عميل محتمل',
        customerPhone: c.customer_phone,
        countryCode: c.country_code || 'EG',
        items,
        subtotal: Number(c.subtotal || 0),
        recovered: Boolean(c.recovered),
        createdAt: c.created_at,
      };
    });
  }

  async deleteAbandonedCart(id: number, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    await (this.db as any)
      .deleteFrom('storefront_abandoned_carts')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .execute();
    return { ok: true };
  }

  // --- Storefront Analytics & KPIs ---

  async getStorefrontAnalytics(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);

    const stats = await this.db
      .selectFrom('online_orders')
      .select([
        sql<number>`COUNT(*)::int`.as('total_orders'),
        sql<number>`COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_amount ELSE 0 END), 0)::float`.as('total_revenue'),
        sql<number>`COUNT(CASE WHEN status = 'pending' THEN 1 END)::int`.as('pending_orders'),
        sql<number>`COUNT(CASE WHEN status = 'confirmed' THEN 1 END)::int`.as('confirmed_orders'),
        sql<number>`COUNT(CASE WHEN status = 'processing' THEN 1 END)::int`.as('processing_orders'),
        sql<number>`COUNT(CASE WHEN status = 'shipped' THEN 1 END)::int`.as('shipped_orders'),
        sql<number>`COUNT(CASE WHEN status = 'delivered' THEN 1 END)::int`.as('delivered_orders'),
        sql<number>`COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::int`.as('cancelled_orders'),
      ])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    const todayStats = await this.db
      .selectFrom('online_orders')
      .select([
        sql<number>`COUNT(*)::int`.as('today_orders'),
        sql<number>`COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_amount ELSE 0 END), 0)::float`.as('today_revenue'),
      ])
      .where(sql<boolean>`tenant_id = ${tenantId} AND created_at >= CURRENT_DATE`)
      .executeTakeFirst();

    const cartStats = await (this.db as any)
      .selectFrom('storefront_abandoned_carts')
      .select([
        sql<number>`COUNT(*)::int`.as('total_abandoned'),
        sql<number>`COUNT(CASE WHEN recovered = false THEN 1 END)::int`.as('unrecovered_abandoned'),
        sql<number>`COUNT(CASE WHEN recovered = true THEN 1 END)::int`.as('recovered_abandoned'),
      ])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    const totalOrders = Number(stats?.total_orders || 0);
    const totalRevenue = Number(stats?.total_revenue || 0);
    const deliveredOrders = Number(stats?.delivered_orders || 0);
    const cancelledOrders = Number(stats?.cancelled_orders || 0);
    const pendingOrders = Number(stats?.pending_orders || 0);
    const confirmedOrders = Number(stats?.confirmed_orders || 0);
    const processingOrders = Number(stats?.processing_orders || 0);
    const shippedOrders = Number(stats?.shipped_orders || 0);

    const validOrders = Math.max(0, totalOrders - cancelledOrders);
    const averageOrderValue = validOrders > 0 ? Math.round(totalRevenue / validOrders) : 0;

    const unrecoveredAbandoned = Number(cartStats?.unrecovered_abandoned || 0);
    const recoveredAbandoned = Number(cartStats?.recovered_abandoned || 0);
    const totalSessions = totalOrders + unrecoveredAbandoned;
    const conversionRate = totalSessions > 0 ? Math.round((totalOrders / totalSessions) * 100) : 0;

    // Aggregate Top-Selling Products from recent orders
    const recentOrders = await this.db
      .selectFrom('online_orders')
      .select(['items_json', 'status', 'created_at'])
      .where(sql<boolean>`tenant_id = ${tenantId} AND status != 'cancelled'`)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();

    const productSalesMap = new Map<number, { productId: number; productName: string; quantity: number; revenue: number }>();
    for (const o of recentOrders) {
      try {
        const items = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : (o.items_json || []);
        for (const it of items) {
          const pId = Number(it.productId || it.id);
          if (!pId) continue;
          const existing = productSalesMap.get(pId) || {
            productId: pId,
            productName: String(it.productName || it.name || 'صنف'),
            quantity: 0,
            revenue: 0,
          };
          existing.quantity += Number(it.quantity || 1);
          existing.revenue += Number(it.total || (Number(it.unitPrice || 0) * Number(it.quantity || 1)));
          productSalesMap.set(pId, existing);
        }
      } catch {}
    }
    const topSellingProducts = Array.from(productSalesMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // Low stock warnings for products visible in store
    const lowStockRows = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'stock_qty', 'retail_price'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('is_active', '=', true)
      .where(sql<boolean>`(item_type = 'product' OR item_type IS NULL)`)
      .where(sql<boolean>`stock_qty <= 5`)
      .orderBy('stock_qty', 'asc')
      .limit(6)
      .execute();

    const lowStockStorefrontProducts = lowStockRows.map((r: any) => ({
      id: Number(r.id),
      name: String(r.name),
      stock: Number(r.stock_qty || 0),
      price: Number(r.retail_price || 0),
    }));

    return {
      totalOrders,
      totalRevenue,
      deliveredOrders,
      cancelledOrders,
      pendingOrders,
      confirmedOrders,
      processingOrders,
      shippedOrders,
      averageOrderValue,
      unrecoveredAbandoned,
      recoveredAbandoned,
      abandonedCartsCount: unrecoveredAbandoned,
      conversionRate,
      todayOrders: Number(todayStats?.today_orders || 0),
      todayRevenue: Number(todayStats?.today_revenue || 0),
      topSellingProducts,
      lowStockStorefrontProducts,
      statusBreakdown: {
        pending: pendingOrders,
        confirmed: confirmedOrders,
        processing: processingOrders,
        shipped: shippedOrders,
        delivered: deliveredOrders,
        cancelled: cancelledOrders,
      },
    };
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
   * Next-Gen F&B: Pay active table check / bill via QR online checkout
   */
  async payActiveTableBill(
    slug: string,
    tableNumber: string,
    dto: { tipAmount?: number; paymentMethod?: string; guestName?: string; guestPhone?: string },
  ) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    const cleanTable = String(tableNumber || '').trim();
    const tenant = await this.getTenantBySlug(cleanSlug);

    const bill = await this.getActiveTableBill(cleanSlug, cleanTable);
    if (!bill.hasActiveBill) {
      throw new BadRequestException('لا يوجد شيك مفتوح حالياً لهذه الطاولة');
    }

    const tipAmount = Math.max(0, Number(dto?.tipAmount || 0));
    const billAmount = Number(bill.total || 0);
    // Book digits from the bill's own currency (the bill already carries
    // the tenant currency; an unreadable code keeps the historical
    // 2-decimal total instead of failing a public payment, mirroring
    // storefrontMoneyDigits' lenient fallback).
    let billDigits: MoneyDigits = 2;
    try {
      billDigits = currencyMoneyDigits(String(bill.currency || 'SAR'));
    } catch {
      billDigits = 2;
    }
    const totalWithTip = computeTableBillPaymentTotal(billAmount, tipAmount, billDigits);
    const paymentRef = `TAB-PAY-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    if (bill.source === 'held_draft' && bill.billId) {
      await this.db
        .updateTable('held_sales')
        .set({
          paid_online: true,
          paid_online_amount: totalWithTip,
          paid_online_ref: paymentRef,
          note: sql`COALESCE(note, '') || ${' [مسدد إلكترونياً بالكامل - مرجع: ' + paymentRef + ']'}` as any,
        })
        .where('id', '=', bill.billId)
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .execute();
    }

    // Insert or update resolved table service call for floor plan and waiter station
    await this.db
      .insertInto('restaurant_table_service_calls')
      .values({
        tenant_id: tenant.id,
        table_number: cleanTable,
        call_type: 'bill_paid',
        status: 'resolved',
        bill_amount: billAmount,
        tip_amount: tipAmount,
        payment_reference: paymentRef,
        payment_status: 'paid',
        resolved_at: new Date(),
      })
      .execute();

    return {
      success: true,
      paidOnline: true,
      tableNumber: cleanTable,
      billAmount,
      tipAmount,
      totalPaid: totalWithTip,
      paymentReference: paymentRef,
      guestName: dto?.guestName || '',
      currency: bill.currency || 'SAR',
      paidAt: new Date().toISOString(),
      message: 'تم سداد حساب الطاولة بنجاح! شكراً لزيارتكم ونتمنى لكم وقتاً ممتعاً.',
    };
  }
}

