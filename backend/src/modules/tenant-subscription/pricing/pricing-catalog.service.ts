import { Injectable } from '@nestjs/common';
import { PRICING_CATALOG } from './pricing-catalog.generated';
import type {
  CatalogFeatureGroup,
  CatalogProduct,
  PublicPricing,
  PublicPricingFloor,
  PublicPricingLevel,
} from './pricing-catalog.types';

/**
 * محرك حل التسعير — المصدر الوحيد لكل رقم سعر يخرج من الخادم.
 *
 * الثوابت الحاكمة (`PRICING_AND_PACKAGING.md` §13 · PRICE-1..PRICE-4 · F40):
 *  1. لا رقم سعر مكتوب في الواجهة. الواجهة تستهلك `resolveForTenant` وحدها.
 *  2. **البلد يُشتق من سجل المنشأة لا من اختيار العميل.** كان العميل يختار عملته
 *     في `TenantSubscriptionPage` من منتقٍ فيرى 99$ بدل 3,500 ج.م (البند C8).
 *  3. **لا يخرج من هنا أي حقل داخلي**: لا `band` ولا `internalName` ولا
 *     `geoMultiplier` ولا أرضيات تفاوض ولا بيانات منافسين. كشف النطاق يفضح أن
 *     المنتجات منصة واحدة، وكشف المضاعف الجغرافي يفضح سبب اختلاف السعر بين بلد وبلد.
 *  4. **يُعرض للمنشأة نطاقها وحده.** لا تُعرض أسعار قطاع آخر ولا ميزاته (PRICE-S1/S3).
 */
@Injectable()
export class PricingCatalogService {
  private readonly catalog = PRICING_CATALOG;
  private readonly LEVELS = ['L1', 'L2', 'L3'] as const;

  /** المنتج الافتراضي عند غياب أو عدم صلاحية نشاط المنشأة */
  private static readonly FALLBACK_PRESET = 'retail';
  /** البلد الافتراضي عند غياب أو حَجْب بلد المنشأة */
  private static readonly FALLBACK_COUNTRY = 'EG';

  get version(): string {
    return this.catalog.version;
  }

  /** الحقول العامة فقط لكل منتج — لا `band` ولا أي حقل داخلي (F40). */
  listProducts(): Array<{ id: string; name: string; pos: boolean; sellOffline: boolean }> {
    return this.catalog.products.map((p) => ({ id: p.id, name: p.publicName, pos: p.pos, sellOffline: p.sellOffline }));
  }

  /** البلدان المنشورة فعلياً فقط — البلد المحظور لا يظهر هنا أصلاً (PRICE-2). */
  listCountries(): Array<{ code: string; name: string; currency: string; status: 'ready' | 'partial' }> {
    return Object.entries(this.catalog.countries)
      .filter((entry): entry is [string, typeof entry[1] & { status: 'ready' | 'partial' }] => entry[1].status !== 'blocked')
      .map(([code, meta]) => ({ code, name: meta.name, currency: meta.currency || 'EGP', status: meta.status }));
  }

  /**
   * يجد المنتج المطابق فقط (مع تطبيع الأسماء البديلة) — بلا أي سقوط افتراضي.
   * يرجع `undefined` عند منتج مجهول؛ المستدعي العام يرفضه، ومسار المنشأة
   * يسقطه على الافتراضي عبر `resolveProduct` (سلوك شاشة الفوترة المحفوظ).
   */
  private findProduct(industryPresetId?: string | null): CatalogProduct | undefined {
    let wanted = String(industryPresetId || '').trim().toLowerCase();
    if (
      wanted === 'maritime_freight' ||
      wanted === 'maritime' ||
      wanted === 'freight' ||
      wanted === 'shipping' ||
      wanted.includes('شحن') ||
      wanted.includes('ملاحة') ||
      wanted.includes('لوجست')
    ) {
      wanted = 'maritime';
    } else if (
      wanted === 'contracting' ||
      wanted === 'construction' ||
      wanted.includes('مقاول') ||
      wanted.includes('تشييد') ||
      wanted.includes('إنشاء')
    ) {
      wanted = 'contracting';
    } else if (
      wanted === 'wholesale_van' ||
      wanted === 'wholesale' ||
      wanted.includes('توزيع') ||
      wanted.includes('فان') ||
      wanted.includes('جمل')
    ) {
      wanted = 'wholesale';
    } else if (
      wanted === 'manufacturing' ||
      wanted === 'production' ||
      wanted.includes('تصنيع') ||
      wanted.includes('إنتاج')
    ) {
      wanted = 'manufacturing';
    } else if (wanted === 'restaurant' || wanted.includes('مطعم') || wanted.includes('كافيه')) {
      wanted = 'restaurant';
    } else if (wanted === 'pharmacy' || wanted.includes('صيدل') || wanted.includes('أدوية')) {
      wanted = 'pharmacy';
    } else if (wanted === 'electronics' || wanted.includes('صيانة') || wanted.includes('إلكترون')) {
      wanted = 'electronics';
    } else if (wanted === 'import_export' || wanted.includes('استيراد') || wanted.includes('تصدير') || wanted.includes('جمارك')) {
      wanted = 'import_export';
    } else if (wanted === 'warehousing' || wanted === 'warehouse' || wanted === 'wms' || wanted.includes('مخازن') || wanted.includes('مستودع') || wanted.includes('تخزين')) {
      wanted = 'warehousing';
    }

    return this.catalog.products.find((p) => p.presetId.toLowerCase() === wanted);
  }

  /**
   * يحل المنتج من `IndustryPresetId` المسجَّل في المنشأة.
   * لا يرمي: نشاط مجهول يسقط على التجزئة العامة بدل أن يُعطِّل شاشة الفوترة.
   * (مسار المنشأة الداخلي فقط — المسار العام يستخدم `resolvePublicOffer` الصارم.)
   */
  private resolveProduct(industryPresetId?: string | null): CatalogProduct {
    return (
      this.findProduct(industryPresetId) ??
      this.catalog.products.find((p) => p.presetId === PricingCatalogService.FALLBACK_PRESET) ??
      this.catalog.products[0]
    );
  }

  /**
   * يحل البلد. البلد المحظور (`status: blocked`) لا يحمل أسعاراً في الكتالوج أصلاً،
   * فلا يجوز السقوط عليه — يُستبدل بالافتراضي ويُبلَّغ المستدعي عبر `isBlocked`.
   */
  private resolveCountry(countryCode?: string | null): { code: string; isBlocked: boolean } {
    const wanted = String(countryCode || '').trim().toUpperCase();
    const entry = this.catalog.countries[wanted];
    if (!entry || entry.status === 'blocked') {
      return { code: PricingCatalogService.FALLBACK_COUNTRY, isBlocked: !!entry && entry.status === 'blocked' };
    }
    return { code: wanted, isBlocked: false };
  }

  private featureGroupsFor(groupIds: string[]): CatalogFeatureGroup[] {
    return groupIds
      .map((id) => this.catalog.featureGroups[id])
      .filter((g): g is CatalogFeatureGroup => !!g);
  }

  /**
   * الحل الصارم للمسار العام فقط: منتج مجهول أو بلد مجهول أو محظور يرجع
   * `null` (المتحكم يرد 404) بدل عرض أسعار منتج أو بلد آخر بصمت.
   */
  resolvePublicOffer(input: {
    industryPresetId?: string | null;
    countryCode?: string | null;
  }): PublicPricing | null {
    const product = this.findProduct(input.industryPresetId);
    if (!product) {
      return null;
    }
    const wanted = String(input.countryCode || '').trim().toUpperCase();
    const entry = this.catalog.countries[wanted];
    if (!entry || entry.status === 'blocked') {
      return null;
    }
    return this.buildPublicPricing(product, wanted);
  }

  /**
   * الشكل العام لشاشة الاشتراك: مستويات نطاق المنشأة الثلاثة بأسعار بلدها،
   * وميزات كل مستوى، والطوابق المفردة، والإضافات.
   * سلوك السقوط الافتراضي محفوظ هنا عمداً (شاشة الفوترة لا تتعطل بنشاط مجهول).
   */
  resolveForTenant(input: {
    industryPresetId?: string | null;
    countryCode?: string | null;
  }): PublicPricing {
    const product = this.resolveProduct(input.industryPresetId);
    const { code: countryCode } = this.resolveCountry(input.countryCode);
    return this.buildPublicPricing(product, countryCode);
  }

  private buildPublicPricing(product: CatalogProduct, countryCode: string): PublicPricing {
    const band = this.catalog.bands[product.band];
    const groupsByLevel = product.levelGroupsOverride ?? band.levelGroups;

    const levels: PublicPricingLevel[] = [];
    for (const levelId of this.LEVELS) {
      const level = band.levels[levelId];
      const price = level?.prices?.[countryCode];
      // الحارس `validate-catalog.mjs` يمنع هذه الحالة، لكن غياب السعر لا يجوز أن
      // يُعرض كصفر — يُحذف المستوى بدلاً من إظهار رقم كاذب.
      if (!level || !price) continue;

      levels.push({
        id: levelId,
        name: level.publicName,
        limits: level.limits,
        currency: price.currency,
        monthly: price.monthly,
        annual: price.annual,
        featureGroups: this.featureGroupsFor(groupsByLevel[levelId] ?? []),
        sectorFeatures: levelId === 'L1' ? product.sectorFeatures : [],
      });
    }

    const floors: PublicPricingFloor[] = this.catalog.floors.items
      // الطوابق السحابية لا تُعرض لمن بلا نقطة بيع، والطوابق الأوفلاين لا تُعرض في السحابة
      .filter((f) => !(f.salesLineOnly && !product.pos))
      .filter((f) => !f.offlineOnly)
      .map((f) => {
        const raw = f.prices?.[countryCode];
        const monthly = typeof raw === 'number' ? raw : null;
        return {
          id: f.id,
          name: f.name,
          monthly,
          // لا سعر منشور لهذا البلد بعد ⇒ «اتصل بنا»، لا رقم مُختلَق (F40)
          contactForPrice: monthly === null && !f.pricingRule,
          includedFromLevel: f.includedFromLevel,
          ...(f.pricingRule ? { pricingRule: f.pricingRule } : {}),
        };
      });

    const countryMeta = this.catalog.countries[countryCode];

    return {
      catalogVersion: this.catalog.version,
      product: { id: product.id, name: product.publicName, pos: product.pos, sellOffline: product.sellOffline },
      country: {
        code: countryCode,
        currency: countryMeta?.currency || 'EGP',
        requiresWrittenDisclosure: !!countryMeta?.requiresWrittenDisclosure,
      },
      quoteAnnuallyOnly: !!band.quoteAnnuallyOnly,
      annualEqualsMonths: this.catalog.annualEqualsMonths,
      trialDays: this.catalog.trialDays,
      vatIncluded: this.catalog.vatIncluded,
      levels,
      floors,
      addons: {
        extraUserMonthly: this.catalog.addons.extraUser.monthly?.[product.band]?.[countryCode] ?? null,
        extraBranchMonthly: this.catalog.addons.extraBranch.monthly?.[product.band]?.[countryCode] ?? null,
      },
    };
  }

  /**
   * ترجمة كود الباقة القديم في `saas_plans` إلى مستوى في النموذج المعتمد.
   * الباقات الأربعة القديمة تبقى في الجدول لأن اشتراكات قائمة تشير إليها
   * (الثابت PRICE-3: الهجرة 135 لا تُعدَّل)، لكن **السعر** لا يُقرأ منها بعد الآن.
   */
  levelIdForLegacyPlanCode(code?: string | null): string | null {
    switch (String(code || '').trim().toUpperCase()) {
      case 'BASIC': return 'L1';
      case 'PRO': return 'L2';
      case 'ULTIMATE':
      case 'ENTERPRISE':
      case 'OMNICHANNEL': return 'L3';
      default: return null;
    }
  }

  /**
   * سعر مستوى بعينه للتحقق الخادمي عند طلب ترقية — كي لا يُصدَّق رقم أرسله العميل.
   * يرجع `null` إن لم يكن المستوى أو البلد ضمن المنشور.
   */
  priceForLevel(input: {
    industryPresetId?: string | null;
    countryCode?: string | null;
    levelId: string;
    billingPeriodMonths: number;
  }): { currency: string; amount: number } | null {
    const product = this.resolveProduct(input.industryPresetId);
    const { code } = this.resolveCountry(input.countryCode);
    const price = this.catalog.bands[product.band]?.levels?.[input.levelId]?.prices?.[code];
    if (!price) return null;
    const amount = input.billingPeriodMonths >= 12 ? price.annual : price.monthly;
    return { currency: price.currency, amount };
  }
}
