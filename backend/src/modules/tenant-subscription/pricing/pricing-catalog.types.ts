/**
 * أنواع كتالوج التسعير — مكتوبة يداً ولا تُولَّد.
 *
 * المصدر الوحيد للأرقام هو `pricing/pricing-catalog.json` في جذر المستودع،
 * ويُولَّد منه `pricing-catalog.generated.ts` بأمر `node pricing/validate-catalog.mjs`.
 * المرجع: `PRICING_AND_PACKAGING.md` §13 · الثابت PRICE-2 · النمط المحظور F40.
 */

export interface CatalogFeatureGroup {
  name: string;
  items: string[];
}

export interface CatalogLevelPrice {
  currency: string;
  monthly: number;
  annual: number;
  /** مصر فقط تحمل سعراً صريحاً؛ غيرها يُحسب بـ offline.perpetualMultiplierFromAnnual */
  perpetual?: number;
}

export interface CatalogLevelLimits {
  branches?: number | null;
  posTerminals?: number | null;
  users?: number | null;
  activeProjects?: number | null;
  containersPerMonth?: number | null;
  multiCompany?: boolean;
}

export interface CatalogLevel {
  publicName: string;
  limits: CatalogLevelLimits;
  prices: Record<string, CatalogLevelPrice>;
}

export interface CatalogBand {
  /** داخلي — لا يُرسَل إلى العميل أبداً */
  internalName: string;
  publishBandItself?: boolean;
  quoteAnnuallyOnly?: boolean;
  quoteAnnuallyReason?: string;
  levelGroups: Record<string, string[]>;
  levels: Record<string, CatalogLevel>;
}

export interface CatalogProduct {
  id: string;
  /** المفتاح في `IndustryPresetId` بالواجهة و`settings.businessIndustry` */
  presetId: string;
  publicName: string;
  /** داخلي — لا يُرسَل إلى العميل أبداً */
  band: string;
  pos: boolean;
  sellOffline: boolean;
  sellOfflineReason?: string;
  levelGroupsOverride?: Record<string, string[]>;
  sectorFeatures: string[];
  marketingForbiddenWords?: string[];
  extraBranchNote?: string;
}

export interface CatalogFloor {
  id: string;
  name: string;
  featureGroup?: string;
  includedFromLevel: string | null;
  prices?: Record<string, number | null>;
  annualPrices?: Record<string, number | null>;
  minPrices?: Record<string, number | null>;
  pricingRule?: string;
  salesLineOnly?: boolean;
  offlineOnly?: boolean;
}

export interface CatalogCountry {
  name: string;
  currency?: string;
  status: 'ready' | 'partial' | 'blocked';
  vatRate?: number;
  localization?: string;
  requiresWrittenDisclosure?: boolean;
  reason?: string;
}

export interface CatalogLaunchOffer {
  percentOffFirstYear: number;
  firstYearOnly: boolean;
  newCustomersOnly: boolean;
}

export interface CatalogOffline {
  supportRateFromYearTwo: number;
  firstYearSupportIncluded: boolean;
  supportRateMarketReference?: string;
  perpetualMultiplierFromAnnual: number;
  perpetualMultiplierAppliesTo: string[];
  installmentPlan: { downPaymentRate: number; months: number };
  notSoldOffline: string[];
  notSoldOfflineProducts: string[];
  notSoldOfflineReason?: string;
}

export interface CatalogAddonBucket {
  monthly?: Record<string, Record<string, number>>;
  perpetual?: Record<string, Record<string, number>>;
  perpetualRule?: string;
}

export interface PricingCatalog {
  version: string;
  updatedAt: string;
  reviewDueAt: string;
  vatIncluded: boolean;
  annualEqualsMonths: number;
  launchOffer: CatalogLaunchOffer;
  trialDays: number;
  trialMaxUsers: number;
  fx: { base: string; asOf: string; rates: Record<string, number> };
  /** خطوات بناء بطاقة الباقة — توثيق للمستهلك، لا منطق */
  resolution?: { steps: string[] };
  featureGroups: Record<string, CatalogFeatureGroup>;
  bands: Record<string, CatalogBand>;
  products: CatalogProduct[];
  floors: { items: CatalogFloor[] };
  addons: {
    extraUser: CatalogAddonBucket;
    extraBranch: CatalogAddonBucket;
    extraPosTerminal: CatalogAddonBucket;
    setupAndMigration: Record<string, Record<string, Record<string, number>>>;
  };
  offline: CatalogOffline;
  countries: Record<string, CatalogCountry>;
  blockedCountryPolicy: Record<string, string>;
  /** داخلي صرف — يُستخدم في الخادم فقط ولا يُسرَّب في أي استجابة */
  internalOnly: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * الشكل العام المسموح بإرساله إلى المتصفح — لا نطاقات ولا مضاعفات
 * جغرافية ولا أرضيات تفاوض ولا بيانات منافسين.
 * ------------------------------------------------------------------ */

export interface PublicPricingLevel {
  id: string;
  name: string;
  limits: CatalogLevelLimits;
  currency: string;
  monthly: number;
  annual: number;
  featureGroups: CatalogFeatureGroup[];
  /** ميزات النشاط نفسه — في المستوى الأول فقط */
  sectorFeatures: string[];
}

export interface PublicPricingFloor {
  id: string;
  name: string;
  /** null يعني لا سعر منشور لهذا البلد بعد ⇒ اتصل بنا */
  monthly: number | null;
  contactForPrice: boolean;
  includedFromLevel: string | null;
  pricingRule?: string;
}

export interface PublicPricing {
  catalogVersion: string;
  product: { id: string; name: string; pos: boolean; sellOffline: boolean };
  country: { code: string; currency: string; requiresWrittenDisclosure: boolean };
  /** المقاولات والشحن تُعرض بالسنوي فقط (PRICE-S4) */
  quoteAnnuallyOnly: boolean;
  annualEqualsMonths: number;
  trialDays: number;
  /** عرض الإطلاق المعلن في الكتالوج — نسبة الخصم على السنة الأولى فقط */
  launchOffer: CatalogLaunchOffer;
  /** الأسعار المعروضة غير شاملة ضريبة القيمة المضافة (من مصدر الكتالوج) */
  vatIncluded: boolean;
  levels: PublicPricingLevel[];
  floors: PublicPricingFloor[];
  addons: {
    extraUserMonthly: number | null;
    extraBranchMonthly: number | null;
  };
}
