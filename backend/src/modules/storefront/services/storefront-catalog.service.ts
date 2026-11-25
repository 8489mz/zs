import { Injectable, NotFoundException } from '@nestjs/common';
import { type Selectable, Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { resolveBestStorefrontOffer, RawStorefrontOffer } from '../engines/storefront-offers.engine';
import {
  offerTimezone,
  storefrontMoneyDigits,
  catalogImageRef,
  isOutOfStockOrderingAllowed,
} from '../storefront-helpers';

/**
 * StorefrontCatalogService — slice T6a of the storefront split.
 * Pure move of the catalog core from StorefrontService: the static
 * catalog-cache block (JSDoc + 4 static fields + 5 getter/setter shims,
 * L460-493) + 7 methods (invalidateGlobalCatalogCache,
 * invalidateCatalogCache, getStorefrontCatalogJson, getStorefrontCatalogPage,
 * getStorefrontCatalog, getSearchSuggestions, getProductDetails). No
 * behavior change: the bodies are byte-identical except for the mechanical
 * class-name repoint — 13 occurrences of the old class name (followed by a
 * dot) inside the moved text become the new class name (prep §2.4 says 11;
 * grep proves 13: 5 shim bodies + 5 invalidateGlobalCatalogCache body +
 * 1 invalidateCatalogCache body + 2 getStorefrontCatalog; the logger line
 * L188 stays in the facade and is NOT repointed). The facade keeps thin
 * delegates with the same names and signatures, plus a static delegate for
 * invalidateGlobalCatalogCache so the 5 call sites in
 * catalog-product.service.ts keep working with zero external changes.
 * This slice calls the facade kernel (getTenantBySlug +
 * getTenantSettingsMap, bound deps) and the T6b scope/availability methods
 * (resolveStorefrontStockScope + loadStorefrontAvailability, bound deps —
 * on this generation tree bound from the facade's own methods; at merge
 * they repoint to this.catalogDetailService.<method>.bind(this), T6b merges
 * BEFORE T6a) and the shared free functions (offerTimezone,
 * storefrontMoneyDigits, catalogImageRef, isOutOfStockOrderingAllowed —
 * imported from '../storefront-helpers', created with the T8 merge, T8
 * merges BEFORE T6a, so the module exists at merge; on this generation
 * tree the import is transient, merge-owned — HR hr-helpers precedent).
 * Date sites move byte-identical: Date.now() x4 (cache-expiry math) +
 * new Date() x2 (offer-validity now args). No toFixed(2), no Math.round.
 * getSearchSuggestions + getProductDetails live here (they call
 * getStorefrontCatalog) — the T6a<->T6b cycle fix, do not move them back.
 */

export interface StorefrontCatalogDeps {
  db: Kysely<Database>;
  // Bound facade kernel methods (same names as the facade members, so the
  // moved bodies are byte-identical). They stay REAL private methods in
  // the facade forever (prep §2.1).
  getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
  // Bound T6b scope/availability methods (same names as the facade members
  // on this generation tree; at merge they repoint to the T6b slice via
  // this.catalogDetailService.<method>.bind(this)). Their bodies use only
  // this.db, which the facade carries (same Kysely instance).
  resolveStorefrontStockScope: (
    tenantId: string,
    settings: Map<string, string>,
    branchId?: number | null,
  ) => Promise<{ branchId: number | null; locations: Array<{ id: number; branchId: number | null }> }>;
  loadStorefrontAvailability: (
    tenantId: string,
    locationIds: number[],
    productIds?: number[],
  ) => Promise<Map<number, number>>;
}

@Injectable()
export class StorefrontCatalogService {
  private readonly db: Kysely<Database>;
  private readonly getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  private readonly getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
  private readonly resolveStorefrontStockScope: (
    tenantId: string,
    settings: Map<string, string>,
    branchId?: number | null,
  ) => Promise<{ branchId: number | null; locations: Array<{ id: number; branchId: number | null }> }>;
  private readonly loadStorefrontAvailability: (
    tenantId: string,
    locationIds: number[],
    productIds?: number[],
  ) => Promise<Map<number, number>>;

  constructor(deps: StorefrontCatalogDeps) {
    this.db = deps.db;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
    this.resolveStorefrontStockScope = deps.resolveStorefrontStockScope;
    this.loadStorefrontAvailability = deps.loadStorefrontAvailability;
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
    return StorefrontCatalogService.catalogCache;
  }

  private set catalogCache(val: Map<string, { data: any; json: string; expiresAt: number; staleUntil: number }>) {
    StorefrontCatalogService.catalogCache = val;
  }

  private get inFlightCatalogPromises() {
    return StorefrontCatalogService.inFlightCatalogPromises;
  }

  private set inFlightCatalogPromises(val: Map<string, Promise<any>>) {
    StorefrontCatalogService.inFlightCatalogPromises = val;
  }

  private get MAX_CACHED_CATALOGS() {
    return StorefrontCatalogService.MAX_CACHED_CATALOGS;
  }

  public static invalidateGlobalCatalogCache(slug?: string) {
    // An older in-flight build must not repopulate a cache invalidated by a write.
    StorefrontCatalogService.catalogGeneration++;
    if (slug) {
      const key = slug.toLowerCase().trim();
      StorefrontCatalogService.catalogCache.delete(key);
      StorefrontCatalogService.inFlightCatalogPromises.delete(key);
    } else {
      StorefrontCatalogService.catalogCache.clear();
      StorefrontCatalogService.inFlightCatalogPromises.clear();
    }
  }

  public invalidateCatalogCache(slug?: string) {
    StorefrontCatalogService.invalidateGlobalCatalogCache(slug);
  }

  /**
   * الكتالوج كنصّ JSON جاهز — **هذا ما يُرَدّ به على الطلبات العامة**.
   *
   * الفرق ليس تجميلياً: `getStorefrontCatalog` تعيد كائناً يُسلسِله Express في كل طلب. على كتالوج
   * من 12 ألف صنف كان ذلك ثلاثة ميجابايت من بناء النصّ لكل زائر، على نواتين، بينما البيانات نفسها
   * مخزَّنة أصلاً. هنا يُقرأ النصّ المُسلسَل مرة واحدة عند البناء.
   */
  async getStorefrontCatalogJson(slug: string): Promise<string> {
    const cleanSlug = String(slug || '')
      .trim()
      .toLowerCase();
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
    const cleanSlug = String(slug || '')
      .trim()
      .toLowerCase();
    const tenant = await this.getTenantBySlug(cleanSlug);
    if (query.pageSize == null && query.limit != null) query.pageSize = query.limit;
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const page = Math.min(10_000, Math.max(1, Math.trunc(Number(query.page) || 1)));
    const categoryId = Number(query.categoryId || 0);
    const search = String(query.q || '')
      .trim()
      .slice(0, 100);
    const base = this.db
      .selectFrom('products')
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('is_active', '=', true)
      .where((eb) => eb.or([eb('item_type', '=', 'product'), eb('item_type', 'is', null)]))
      .$if(Number.isSafeInteger(categoryId) && categoryId > 0, (qb) => qb.where('category_id', '=', categoryId))
      .$if(Boolean(search), (qb) =>
        qb.where((eb) => eb.or([eb('name', 'ilike', `%${search}%`), eb('barcode', 'ilike', `%${search}%`)])),
      );
    const [categories, catImagesRow, countRow, products, settings] = await Promise.all([
      this.db
        .selectFrom('product_categories')
        .select(['id', 'name'])
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .orderBy('name', 'asc')
        .execute(),
      this.db
        .selectFrom('settings')
        .select('value')
        .where(sql<boolean>`tenant_id = ${tenant.id}`)
        .where('key', '=', 'storefront_category_images')
        .executeTakeFirst(),
      base.select(sql<number>`count(*)::int`.as('count')).executeTakeFirst(),
      base
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
        .orderBy('name', 'asc')
        .orderBy('id', 'asc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
      this.getTenantSettingsMap(tenant.id),
    ]);
    const productIds = products.map((p) => Number(p.id));
    const [reviews, stockScope, rawOffers] = await Promise.all([
      productIds.length
        ? this.db
            .selectFrom('product_reviews')
            .select([
              'product_id',
              sql<number>`round(avg(rating)::numeric, 1)`.as('avg_rating'),
              sql<number>`count(*)::int`.as('review_count'),
            ])
            .where(sql<boolean>`tenant_id = ${tenant.id}`)
            .where('is_approved', '=', true)
            .where('product_id', 'in', productIds)
            .groupBy('product_id')
            .execute()
        : Promise.resolve([]),
      this.resolveStorefrontStockScope(tenant.id, settings),
      productIds.length
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
            .where('product_id', 'in', productIds)
            .where('is_active', '=', true)
            .execute()
        : Promise.resolve([]),
    ]);
    const availability = productIds.length
      ? await this.loadStorefrontAvailability(
          tenant.id,
          stockScope.locations.map((location) => location.id),
          productIds,
        )
      : new Map<number, number>();
    const ratings = new Map(
      reviews.map((r) => [
        Number(r.product_id),
        { rating: Number(r.avg_rating || 0), reviewCount: Number(r.review_count || 0) },
      ]),
    );
    const offersMap = new Map<number, RawStorefrontOffer[]>();
    for (const off of rawOffers as RawStorefrontOffer[]) {
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
        id: c.id,
        name: c.name,
        imageUrl: catalogImageRef(categoryImages[String(c.id)]),
      })),
      products: products.map((p) => {
        let meta: Record<string, unknown> = {};
        if (p.metadata) {
          try {
            const parsed = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
              meta = parsed as Record<string, unknown>;
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
        const bestOffer = resolveBestStorefrontOffer(
          retailPrice,
          pOffers,
          1,
          undefined,
          new Date(),
          offerTimezone(settings),
          storefrontMoneyDigits(settings, tenant),
        );
        const finalPrice = bestOffer.hasDiscount ? bestOffer.price : retailPrice;
        const bogoOffer = pOffers.find((o) => o.offer_type === 'bogo');
        const bundleOffer = pOffers.find((o) => o.offer_type === 'bundle');

        return {
          id: productId,
          name: p.name,
          barcode: p.barcode || '',
          price: finalPrice,
          originalPrice: bestOffer.hasDiscount || bestOffer.offerType === 'bogo' ? retailPrice : undefined,
          hasDiscount: bestOffer.hasDiscount,
          discountPercent: bestOffer.hasDiscount ? bestOffer.discountPercent : undefined,
          offerBadge: bestOffer.offerBadge,
          offerType: bestOffer.offerType,
          offerValue: bestOffer.hasDiscount ? bestOffer.offerValue : undefined,
          bogoBuyQty: bogoOffer?.bogo_buy_qty ? Number(bogoOffer.bogo_buy_qty) : undefined,
          bogoGetQty: bogoOffer?.bogo_get_qty ? Number(bogoOffer.bogo_get_qty) : undefined,
          bogoDiscountPercent:
            bogoOffer?.bogo_discount_percent !== undefined ? Number(bogoOffer.bogo_discount_percent) : undefined,
          minQty: bundleOffer?.min_qty ? Number(bundleOffer.min_qty) : undefined,
          categoryId: p.category_id ? Number(p.category_id) : null,
          categoryName: p.category_id ? categoryNames.get(Number(p.category_id)) || 'عام' : 'عام',
          stockQty: allowOutOfStock ? (rawStock > 0 ? rawStock : 999) : rawStock,
          inStock: available,
          isLowStock: !allowOutOfStock && rawStock > 0 && rawStock <= 5,
          icon: typeof meta.icon === 'string' ? meta.icon : '',
          imageUrl: mainImg,
          gallery: gallery.length ? gallery : mainImg ? [mainImg] : [],
          variants: Array.isArray(meta.variants) ? meta.variants : [],
          addOns: Array.isArray(meta.addOns) ? meta.addOns : Array.isArray(meta.add_ons) ? meta.add_ons : [],
          description: p.notes || (typeof meta.description === 'string' ? meta.description : ''),
          rating: ratings.get(productId)?.rating || 0,
          reviewCount: ratings.get(productId)?.reviewCount || 0,
        };
      }),
      page,
      pageSize,
      totalCount: Number(countRow?.count || 0),
      hasMore: page * pageSize < Number(countRow?.count || 0),
    };
  }

  async getStorefrontCatalog(slug: string) {
    const cleanSlug = String(slug || '')
      .trim()
      .toLowerCase();
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
    const generation = StorefrontCatalogService.catalogGeneration;
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
          .where((eb) => eb.or([eb('item_type', '=', 'product'), eb('item_type', 'is', null)]))
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
      for (const off of rawOffers as RawStorefrontOffer[]) {
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
        const inStock = allowOutOfStock ? true : rawStock > 0;
        const isLowStock = !allowOutOfStock && rawStock > 0 && rawStock <= 5;
        const retailPrice = Number(p.retail_price ?? 0);
        const pOffers = offersByProductId.get(Number(p.id)) || [];
        const bestOffer = resolveBestStorefrontOffer(
          retailPrice,
          pOffers,
          1,
          undefined,
          new Date(),
          offerTimezone(settings),
          storefrontMoneyDigits(settings, tenant),
        );
        const finalPrice = bestOffer.hasDiscount ? bestOffer.price : retailPrice;
        const bogoOffer = pOffers.find((o) => o.offer_type === 'bogo');
        const bundleOffer = pOffers.find((o) => o.offer_type === 'bundle');

        const reviewStats = ratingMap.get(Number(p.id)) || { avgRating: 0, reviewCount: 0 };
        // SF-9: the catalog never ships inline base64. Migration 135 moved existing images to
        // storefront_media and every writer now stores URLs; this guard keeps one stray data URL
        // (written by some other path) from re-bloating the response for every visitor.
        const mainImg = catalogImageRef(meta.imageUrl || meta.image);
        const gallery = Array.isArray(meta.gallery)
          ? meta.gallery.map(catalogImageRef).filter(Boolean)
          : [mainImg].filter(Boolean);
        const variants = Array.isArray(meta.variants) ? meta.variants : [];
        const addOns = Array.isArray(meta.addOns) ? meta.addOns : Array.isArray(meta.add_ons) ? meta.add_ons : [];

        return {
          id: Number(p.id) || p.id,
          name: p.name,
          barcode: p.barcode || '',
          price: finalPrice,
          originalPrice: bestOffer.hasDiscount || bestOffer.offerType === 'bogo' ? retailPrice : undefined,
          hasDiscount: bestOffer.hasDiscount,
          discountPercent: bestOffer.hasDiscount ? bestOffer.discountPercent : undefined,
          offerBadge: bestOffer.offerBadge,
          offerType: bestOffer.offerType,
          offerValue: bestOffer.hasDiscount ? bestOffer.offerValue : undefined,
          bogoBuyQty: bogoOffer?.bogo_buy_qty ? Number(bogoOffer.bogo_buy_qty) : undefined,
          bogoGetQty: bogoOffer?.bogo_get_qty ? Number(bogoOffer.bogo_get_qty) : undefined,
          bogoDiscountPercent:
            bogoOffer?.bogo_discount_percent !== undefined ? Number(bogoOffer.bogo_discount_percent) : undefined,
          minQty: bundleOffer?.min_qty ? Number(bundleOffer.min_qty) : undefined,
          categoryId: p.category_id ? Number(p.category_id) : null,
          categoryName: (p.category_id && catMap.get(p.category_id)) || 'عام',
          stockQty,
          inStock,
          isLowStock,
          icon: meta.icon || '',
          imageUrl: mainImg,
          gallery: gallery.length > 0 ? gallery : mainImg ? [mainImg] : [],
          variants,
          addOns,
          description: p.notes || meta.description || '',
          rating: reviewStats.avgRating,
          reviewCount: reviewStats.reviewCount,
        };
      });

      const showOutOfStock = settings.get('storefront_show_out_of_stock') !== 'false';
      const catalogProducts = showOutOfStock ? formattedProducts : formattedProducts.filter((p) => p.inStock);

      const result = {
        categories: formattedCategories,
        products: catalogProducts,
        // العدد الكلي معلن: عميلٌ يريد التصفّح يعرف كم يطلب، وقارئُ الاستجابة يرى حجمها.
        totalCount: catalogProducts.length,
      };

      // Cache in-memory: 60s fresh, 5 mins stale-while-revalidate
      if (generation === StorefrontCatalogService.catalogGeneration) {
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
    const q = String(query || '')
      .trim()
      .toLowerCase();
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
      .filter(
        (p: any) =>
          Number(p.id) !== Number(productId) && p.inStock && p.price > 0 && p.categoryId !== product.categoryId,
      )
      .slice(0, 4);

    return {
      product,
      related,
      crossSell,
    };
  }
}
