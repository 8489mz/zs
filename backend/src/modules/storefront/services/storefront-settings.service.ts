import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { type Selectable, Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { UpdateStorefrontSettingsDto } from '../dto/update-storefront-settings.dto';
import { StorefrontMediaService } from '../storefront-media.service';
import { maskGatewaySecret, isMaskedGatewaySecret } from '../engines/gateway-secret-mask.engine';
import { buildStorePublicBase, isReservedStoreSlug } from '../engines/store-public-url.engine';
import { normalizeStorefrontStockMode } from '../../../common/engines/branch-sellable-locations.engine';

/**
 * StorefrontSettingsService — slice T7 of the storefront split.
 * Pure move of 5 methods from StorefrontService (getStorefrontSettings,
 * updateStorefrontSettings, updateProductImage, updateCategoryImage,
 * getTablesQrCodes). No behavior change: the bodies are byte-identical.
 * The facade keeps thin delegates with the same names/signatures.
 * Deps: db + media (StorefrontMediaService, ctor-injected in the facade)
 * + kernel getTenantBySlug + getTenantSettingsMap (stay REAL private
 * methods in the facade, passed bound via the HR kernel pattern) +
 * invalidateCatalogCache (T6a, bound dep — on this generation tree bound
 * from the facade's own method; at merge it repoints to the T6a slice via
 * the facade ctor, T6a merges BEFORE T7). getStorefrontSettings is called
 * by updateStorefrontSettings inside this slice (intra-slice call).
 * No shared-helper import: the moved text uses no free function from the
 * shared helpers module; its one engine binding comes through the facade
 * imports with the rewritten path. Date sites move byte-identical: 3 row
 * stamps. No toFixed(2), no Math.round, no FX in this slice.
 * MERGE NOTE: at merge, repoint the invalidateCatalogCache bound dep in
 * the facade ctor to the T6a slice instance; the facade delegate for
 * invalidateCatalogCache stays until T6a merges (it is the source of the
 * bound dep on this tree).
 */

export interface StorefrontSettingsDeps {
  db: Kysely<Database>;
  media: StorefrontMediaService;
  getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
  // Bound T6a method (same name as the facade member on this generation
  // tree; at merge it repoints to the T6a slice via
  // this.catalogService.invalidateCatalogCache.bind(this)).
  invalidateCatalogCache: (slug?: string) => void;
}

@Injectable()
export class StorefrontSettingsService {
  private readonly db: Kysely<Database>;
  private readonly media: StorefrontMediaService;
  private readonly getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  private readonly getTenantSettingsMap: (tenantId: string) => Promise<Map<string, string>>;
  private readonly invalidateCatalogCache: (slug?: string) => void;

  constructor(deps: StorefrontSettingsDeps) {
    this.db = deps.db;
    this.media = deps.media;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.getTenantSettingsMap = deps.getTenantSettingsMap;
    this.invalidateCatalogCache = deps.invalidateCatalogCache;
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
    const isGcc =
      ['KW', 'SA', 'AE', 'QA', 'BH', 'OM'].includes(countryCode) ||
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
        ? payload.customDomain
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .split('/')[0]
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
        const currentStoreSlug = String(currentSetting?.value ?? '')
          .replace(/^"|"$/g, '')
          .trim()
          .toLowerCase();
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
    if (payload.announcement !== undefined)
      entries.push({ key: 'storefront_announcement', value: payload.announcement });
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
    if (payload.bannerPosition !== undefined)
      entries.push({ key: 'storefront_banner_position', value: payload.bannerPosition });
    if (payload.bannerPositions !== undefined)
      entries.push({ key: 'storefront_banner_positions', value: payload.bannerPositions });
    if (payload.bannerIntervalSeconds !== undefined)
      entries.push({ key: 'storefront_banner_interval', value: payload.bannerIntervalSeconds });
    if (payload.smartDealsEnabled !== undefined)
      entries.push({ key: 'storefront_smart_deals', value: payload.smartDealsEnabled });
    if (payload.deliveryFee !== undefined) entries.push({ key: 'storefront_delivery_fee', value: payload.deliveryFee });
    if (payload.minOrder !== undefined) entries.push({ key: 'storefront_min_order', value: payload.minOrder });
    if (payload.freeShippingEnabled !== undefined)
      entries.push({ key: 'storefront_free_shipping_enabled', value: payload.freeShippingEnabled });
    if (payload.freeShippingMinOrder !== undefined)
      entries.push({ key: 'storefront_free_shipping_min_order', value: payload.freeShippingMinOrder });
    if (payload.whatsappPhone !== undefined) entries.push({ key: 'storefront_whatsapp', value: payload.whatsappPhone });
    if (payload.onlinePaymentEnabled !== undefined)
      entries.push({ key: 'storefront_online_payment_enabled', value: payload.onlinePaymentEnabled });
    if (payload.onlinePaymentProvider !== undefined)
      entries.push({ key: 'storefront_online_payment_provider', value: payload.onlinePaymentProvider });
    if (payload.paymobApiKey !== undefined && !isMaskedGatewaySecret(payload.paymobApiKey))
      entries.push({ key: 'storefront_paymob_api_key', value: payload.paymobApiKey });
    if (payload.paymobIntegrationId !== undefined)
      entries.push({ key: 'storefront_paymob_integration_id', value: payload.paymobIntegrationId });
    if (payload.paymobIframeId !== undefined)
      entries.push({ key: 'storefront_paymob_iframe_id', value: payload.paymobIframeId });
    if (payload.paymobHmacSecret !== undefined && !isMaskedGatewaySecret(payload.paymobHmacSecret))
      entries.push({ key: 'storefront_paymob_hmac_secret', value: payload.paymobHmacSecret });
    if (payload.paymobTestMode !== undefined)
      entries.push({ key: 'storefront_paymob_test_mode', value: payload.paymobTestMode });
    if (payload.xpayApiKey !== undefined && !isMaskedGatewaySecret(payload.xpayApiKey))
      entries.push({ key: 'storefront_xpay_api_key', value: payload.xpayApiKey });
    if (payload.xpayCommunityId !== undefined)
      entries.push({ key: 'storefront_xpay_community_id', value: payload.xpayCommunityId });
    if (payload.xpayTestMode !== undefined)
      entries.push({ key: 'storefront_xpay_test_mode', value: payload.xpayTestMode });
    if (payload.tapSecretKey !== undefined && !isMaskedGatewaySecret(payload.tapSecretKey))
      entries.push({ key: 'storefront_tap_secret_key', value: payload.tapSecretKey });
    if (payload.tapPublishableKey !== undefined)
      entries.push({ key: 'storefront_tap_publishable_key', value: payload.tapPublishableKey });
    if (payload.tapTestMode !== undefined)
      entries.push({ key: 'storefront_tap_test_mode', value: payload.tapTestMode });
    if (payload.stripeSecretKey !== undefined && !isMaskedGatewaySecret(payload.stripeSecretKey))
      entries.push({ key: 'storefront_stripe_secret_key', value: payload.stripeSecretKey });
    if (payload.stripePublishableKey !== undefined)
      entries.push({ key: 'storefront_stripe_publishable_key', value: payload.stripePublishableKey });
    if (payload.stripeWebhookSecret !== undefined && !isMaskedGatewaySecret(payload.stripeWebhookSecret))
      entries.push({ key: 'storefront_stripe_webhook_secret', value: payload.stripeWebhookSecret });
    if (payload.stripeTestMode !== undefined)
      entries.push({ key: 'storefront_stripe_test_mode', value: payload.stripeTestMode });
    if (payload.brandColor !== undefined) entries.push({ key: 'storefront_brand_color', value: payload.brandColor });
    if (payload.brandSecondaryColor !== undefined)
      entries.push({ key: 'storefront_brand_secondary_color', value: payload.brandSecondaryColor });
    if (payload.brandSurfaceColor !== undefined)
      entries.push({ key: 'storefront_brand_surface_color', value: payload.brandSurfaceColor });
    if (payload.themePreset !== undefined) entries.push({ key: 'storefront_theme_preset', value: payload.themePreset });
    if (payload.metaPixelId !== undefined)
      entries.push({ key: 'storefront_meta_pixel_id', value: payload.metaPixelId });
    if (payload.ga4Id !== undefined) entries.push({ key: 'storefront_ga4_id', value: payload.ga4Id });
    if (payload.tiktokPixelId !== undefined)
      entries.push({ key: 'storefront_tiktok_pixel_id', value: payload.tiktokPixelId });
    if (payload.snapchatPixelId !== undefined)
      entries.push({ key: 'storefront_snapchat_pixel_id', value: payload.snapchatPixelId });
    if (payload.pickupEnabled !== undefined)
      entries.push({ key: 'storefront_pickup_enabled', value: payload.pickupEnabled });
    if (payload.heroHeadline !== undefined)
      entries.push({ key: 'storefront_hero_headline', value: payload.heroHeadline });
    if (payload.heroSubtitle !== undefined)
      entries.push({ key: 'storefront_hero_subtitle', value: payload.heroSubtitle });
    if (payload.supportEmail !== undefined)
      entries.push({ key: 'storefront_support_email', value: payload.supportEmail });
    if (payload.contactPhone !== undefined)
      entries.push({ key: 'storefront_contact_phone', value: payload.contactPhone });
    if (payload.facebookUrl !== undefined) entries.push({ key: 'storefront_facebook_url', value: payload.facebookUrl });
    if (payload.instagramUrl !== undefined)
      entries.push({ key: 'storefront_instagram_url', value: payload.instagramUrl });
    if (payload.twitterUrl !== undefined) entries.push({ key: 'storefront_twitter_url', value: payload.twitterUrl });
    if (payload.tiktokUrl !== undefined) entries.push({ key: 'storefront_tiktok_url', value: payload.tiktokUrl });
    if (payload.youtubeUrl !== undefined) entries.push({ key: 'storefront_youtube_url', value: payload.youtubeUrl });
    if (payload.telegramUrl !== undefined) entries.push({ key: 'storefront_telegram_url', value: payload.telegramUrl });
    if (payload.allowOutOfStockOrders !== undefined)
      entries.push({ key: 'storefront_allow_out_of_stock', value: payload.allowOutOfStockOrders });
    if (payload.showOutOfStockProducts !== undefined)
      entries.push({ key: 'storefront_show_out_of_stock', value: payload.showOutOfStockProducts });
    if (payload.stockMode !== undefined)
      entries.push({ key: 'storefront_stock_mode', value: normalizeStorefrontStockMode(payload.stockMode) });
    if (payload.midBannersEnabled !== undefined)
      entries.push({ key: 'storefront_mid_banners_enabled', value: payload.midBannersEnabled });
    if (payload.heroBannerFullBleed !== undefined)
      entries.push({ key: 'storefront_hero_full_bleed', value: payload.heroBannerFullBleed });
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
}
