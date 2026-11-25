import { Injectable } from '@nestjs/common';
import { type Selectable, Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import {
  ALL_OPERATIONAL_LOCATIONS,
  availableAcrossLocations,
  normalizeStorefrontStockMode,
  resolveBranchSellableLocations,
  resolveStorefrontSalesStockMode,
} from '../../../common/engines/branch-sellable-locations.engine';
import { isOutOfStockOrderingAllowed } from '../storefront-helpers';

/**
 * StorefrontCatalogDetailService — slice T6b of the storefront split.
 * Pure move of 4 methods from StorefrontService (resolveStorefrontStockScope
 * + loadStorefrontAvailability (both private in the facade) + the public
 * getStorefrontInfo + getProductModifiers). No behavior change: the bodies
 * are byte-identical; the facade keeps thin delegates with the same names
 * and signatures. This slice calls nothing but the facade kernel
 * (getTenantBySlug + getTenantSettingsMap, bound deps) and the shared free
 * function isOutOfStockOrderingAllowed (imported from
 * '../storefront-helpers', created with the T8 merge — T8 merges BEFORE
 * T6b, so the module exists at merge; on this generation tree the import
 * is transient, merge-owned — HR hr-helpers precedent).
 * resolveStorefrontStockScope + loadStorefrontAvailability are PUBLIC here
 * (private in the facade delegate) — the facade, a different class, cannot
 * call a private slice method (tsc TS2341); the facade delegates stay
 * private, so the facade public surface is unchanged. Their callers
 * (getStorefrontCatalog / getStorefrontCatalogPage in T6a,
 * createOnlineOrder in T2) reach them through the facade delegate or a
 * bound dep at their own merges. No date sites move with T6b (no new
 * Date() / Date.now() / toISOString() in these methods); the stock-scope
 * resolution is the single source both catalog and order creation read.
 */

export interface StorefrontCatalogDetailDeps {
  db: Kysely<Database>;
  // Bound facade kernel methods (same names as the facade members, so the
  // moved bodies are byte-identical). They stay REAL private methods in
  // the facade forever (prep §2.1).
  getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
}

@Injectable()
export class StorefrontCatalogDetailService {
  private readonly db: Kysely<Database>;
  private readonly getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  private readonly getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;

  constructor(deps: StorefrontCatalogDetailDeps) {
    this.db = deps.db;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
  }

  /**
   * المخازن التي يبيع منها المتجر الإلكتروني لهذه المنشأة — **يُستدعى من الكتالوج ومن إنشاء الطلب
   * معاً**، فلا يعرض الكتالوج رصيداً لا يستطيع الطلب حجزه.
   *
   * كان الكتالوج يعرض الرصيد **العام** (`stock_qty - reserved_qty`) بينما الطلب يفحص مخزن الفرع.
   * فعلى منشأة مخزونها في مخزن آخر: الزبون يرى «متاح» ويُرفض عند الطلب. توسيع مسار الطلب وحده
   * عالج نصف المشكلة؛ هذا يقفل الجذر: الرقمان صارا من مصدر واحد.
   */
  async resolveStorefrontStockScope(
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
      locations: resolveBranchSellableLocations(
        { ...branch, sales_stock_mode: effectiveMode },
        resolvedBranchId,
        allLocations,
      ),
    };
  }

  /**
   * الرصيد المتاح لكل صنف عبر مخازن المتجر — نفس حساب `reserveLocationStock` (يشمل الرصيد غير
   * المخصص لأي مخزن، لأن الحجز يحتسبه).
   */
  async loadStorefrontAvailability(
    tenantId: string,
    locationIds: number[],
    productIds?: number[],
  ): Promise<Map<number, number>> {
    const rows = await this.db
      .selectFrom('product_location_stock')
      .select(['product_id', 'location_id', 'qty', 'reserved_qty'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .$if(Boolean(productIds), (qb) => qb.where('product_id', 'in', productIds || []))
      .where((eb) =>
        eb.or([
          eb('location_id', 'is', null),
          ...(locationIds.length > 0 ? [eb('location_id', 'in', locationIds)] : []),
        ]),
      )
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
   * INV-REST-KIOSK-MODIFIER-UI (R7-B1): the public modifier data for one
   * catalog product — what the kiosk picker shows before the customer
   * picks. Slug-scoped exactly like getProductDetails (the tenant comes
   * from the slug, every read below is tenant-scoped, so another
   * tenant's groups can never leak through a guessed product id), and
   * shaped like the authenticated addons.getProductModifiers MINUS
   * costPrice: a public response must never leak what an option costs
   * the merchant. Only groups linked to this product (R4-C I50: an
   * unlinked product shows NO groups, never all of them) and only active
   * groups / active options are returned. No storefront-entitlement
   * gate: this is a public read like the catalog itself — ordering is
   * still gated in createOnlineOrder.
   */
  async getProductModifiers(slug: string, productId: number) {
    const tenant = await this.getTenantBySlug(slug);

    const linked = await this.db
      .selectFrom('product_pos_modifiers')
      .select(['modifier_group_id'])
      .where('product_id', '=', productId)
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .execute();
    const targetGroupIds = linked.map((l) => Number(l.modifier_group_id));
    if (targetGroupIds.length === 0) {
      return { groups: [] };
    }

    const groups = await this.db
      .selectFrom('pos_modifier_groups as g')
      .selectAll()
      .where(sql<boolean>`g.tenant_id = ${tenant.id}`)
      .where('g.is_active', '=', true)
      .where('g.id', 'in', targetGroupIds)
      .orderBy('g.display_order', 'asc')
      .orderBy('g.id', 'asc')
      .execute();
    const groupIds = groups.map((g) => Number(g.id));

    let options: any[] = [];
    if (groupIds.length > 0) {
      options = await this.db
        .selectFrom('pos_modifier_options as pmo')
        .leftJoin('products as p', (join) =>
          join.onRef('p.id', '=', 'pmo.component_product_id').onRef('p.tenant_id', '=', 'pmo.tenant_id'),
        )
        .select([
          'pmo.id',
          'pmo.group_id',
          'pmo.name',
          'pmo.name_en',
          'pmo.price',
          'pmo.is_default',
          'pmo.display_order',
          'pmo.component_product_id',
          'pmo.consumption_qty',
          'pmo.unit_name',
          'pmo.portion_allowed',
          'pmo.preparation_time_minutes',
          'p.name as component_product_name',
        ])
        .where(sql<boolean>`pmo.tenant_id = ${tenant.id}`)
        .where('pmo.group_id', 'in', groupIds)
        .where('pmo.is_active', '=', true)
        .orderBy('pmo.display_order', 'asc')
        .orderBy('pmo.id', 'asc')
        .execute();
    }

    return {
      groups: groups.map((g) => ({
        id: Number(g.id),
        name: g.name,
        nameEn: g.name_en,
        selectionType: g.selection_type || 'multiple',
        isMandatory: Boolean(g.is_mandatory),
        minSelections: Number(g.min_selections || 0),
        maxSelections: Number(g.max_selections || 10),
        displayOrder: Number(g.display_order || 0),
        isSplittableInHalf: Boolean(g.is_splittable_in_half),
        options: options
          .filter((opt) => Number(opt.group_id) === Number(g.id))
          .map((opt) => ({
            id: Number(opt.id),
            groupId: Number(opt.group_id),
            name: opt.name,
            nameEn: opt.name_en,
            price: Number(opt.price || 0),
            isDefault: Boolean(opt.is_default),
            displayOrder: Number(opt.display_order || 0),
            componentProductId: opt.component_product_id ? Number(opt.component_product_id) : null,
            componentProductName: opt.component_product_name || null,
            consumptionQty:
              opt.consumption_qty !== null && opt.consumption_qty !== undefined ? Number(opt.consumption_qty) : null,
            unitName: opt.unit_name || null,
            portionAllowed: (opt.portion_allowed as 'both' | 'half_only' | 'whole_only') || 'both',
            preparationTimeMinutes: opt.preparation_time_minutes ? Number(opt.preparation_time_minutes) : 0,
          })),
      })),
    };
  }
}
