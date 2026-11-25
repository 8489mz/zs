export type IndustryPillar = 'contracting' | 'maritime_freight' | 'manufacturing' | 'commerce';

export type CommerceSubVertical =
  | 'retail_general'
  | 'pharmacy'
  | 'restaurant'
  | 'maintenance'
  | 'import_export'
  | 'auto_parts'
  | 'clothing'
  | 'manufacturing'
  | 'wholesale_van'
  | 'warehousing'
  | 'services'
  | 'ecommerce'
  | 'supermarket'
  | 'appliances_installments'
  | 'spices'
  | 'perfumes';

export type IndustryProfileKey = 'contracting' | 'maritime_freight' | 'manufacturing' | CommerceSubVertical;

export interface IndustryProfile {
  key: IndustryProfileKey;
  pillar: IndustryPillar;
  subVertical?: CommerceSubVertical;
  labelAr: string;
  labelEn: string;
  descriptionAr: string;
  defaultRoute: string;
  /**
   * Always granted regardless of the tenant's plan level: the sector-identity flag (if any) and
   * bare POS basics. Anything beyond this (inventory, purchases, reports, accounting, hr, ...)
   * comes from `plan_features` for the tenant's actual (band, level), via `pricingBand` below.
   * PRICE-4 / PRICING_AND_PACKAGING.md §11 C1.
   */
  defaultFeatures: string[];
  allowedExtraFeatures: string[];
  /** The pricing catalog band (1-5) this activity is sold under — see pricing/pricing-catalog.json. */
  pricingBand: 1 | 2 | 3 | 4 | 5;
}

export const INDUSTRY_PROFILES: Record<IndustryProfileKey, IndustryProfile> = {
  contracting: {
    key: 'contracting',
    pillar: 'contracting',
    labelAr: 'قطاع المقاولات وإدارة المشاريع',
    labelEn: 'Contracting & Construction Projects',
    descriptionAr: 'إدارة متكاملة للمشاريع والمقايسات (BOQ) والمستخلصات وعقود مقاولي الباطن والمشتريات والمخازن.',
    defaultRoute: '/contracting',
    defaultFeatures: [
      'contracting',
      'purchases',
      'inventory',
      'catalog',
      'products',
      'suppliers',
      'customers',
      'crm',
      'sales',
      'pricing',
      'accounting',
      'treasury',
      'hr',
      'fixed_assets',
      'vat_declaration',
      'taxIntegration',
      'reports',
      'approvals',
    ],
    allowedExtraFeatures: [],
    pricingBand: 5,
  },

  maritime_freight: {
    key: 'maritime_freight',
    pillar: 'maritime_freight',
    labelAr: 'قطاع الشحن البحري واللوجستيات',
    labelEn: 'Maritime Freight & Logistics',
    descriptionAr: 'إدارة الخطوط الملاحية، الموانئ، عروض النولون، أوامر تشغيل الشحنات، والمصروفات وتتبع الحاويات.',
    defaultRoute: '/maritime-freight',
    defaultFeatures: [
      'maritime_freight',
      'purchases',
      'suppliers',
      'customers',
      'crm',
      'sales',
      'pricing',
      'accounting',
      'treasury',
      'hr',
      'fixed_assets',
      'vat_declaration',
      'taxIntegration',
      'reports',
      'approvals',
    ],
    allowedExtraFeatures: [],
    pricingBand: 5,
  },

  retail_general: {
    key: 'retail_general',
    pillar: 'commerce',
    subVertical: 'retail_general',
    labelAr: 'تجارة عامة وتجزئة وسوبرماركت',
    labelEn: 'General Retail & Supermarket',
    descriptionAr: 'نظام كاشير سريع، باركود ومخازن، مشتريات وموردين، وتقارير أرباح ومبيعات متقدمة.',
    defaultRoute: '/dashboard',
    // INV-POS-RETAIL-FEATURE-GATE (2026-11-18): 'pos' is a profile
    // default, not a plan row — the create-sale POS gate
    // (hasFeature('pos')) reads defaultFeatures before plan_features,
    // and no migration/fallback ever grants the 'pos' code, so without
    // this entry every retail POS sale was refused 403.
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'pos', 'deliveryReps'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 1,
  },

  pharmacy: {
    key: 'pharmacy',
    pillar: 'commerce',
    subVertical: 'pharmacy',
    labelAr: 'صيدليات ومستلزمات طبية',
    labelEn: 'Pharmacy & Medical Supplies',
    descriptionAr: 'محرك تاريخ الصلاحية والتشغيلات (FEFO)، إدارة الأدوية والبدائل والنواقص، والروشتات.',
    defaultRoute: '/dashboard',
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'pos', 'pharmacy', 'deliveryReps'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 2,
  },

  restaurant: {
    key: 'restaurant',
    pillar: 'commerce',
    subVertical: 'restaurant',
    labelAr: 'مطاعم وكافيهات وضيافة',
    labelEn: 'Restaurants & Hospitality',
    descriptionAr: 'شاشات المطبخ الذكية (KDS)، شاشات الانتظار، إضافات الوجبات والمكونات (Modifiers)، والصالات.',
    defaultRoute: '/pos',
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'pos', 'restaurant', 'deliveryReps'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 3,
  },

  manufacturing: {
    key: 'manufacturing',
    pillar: 'commerce',
    subVertical: 'manufacturing',
    labelAr: 'قطاع التصنيع والإنتاج الصناعي',
    labelEn: 'Manufacturing & Industrial Production',
    descriptionAr:
      'منظومة المصانع والمعامل: تخطيط الإنتاج، شجرة المنتج (BOM)، أوامر التشغيل، مستودعات الخامات والمنتج التام، ومحاسبة التكاليف الصناعية.',
    defaultRoute: '/manufacturing/work-orders',
    // Not an isolated pillar: POS stays OFF for manufacturing by design
    // (INV-POS-RETAIL-FEATURE-GATE) — the sidebar hides 'pos' for the
    // manufacturing vertical, the route suite has no 'pos' for it, and
    // the settings layer forces posModuleEnabled=false. The old comment
    // here claimed a factory-outlet counter sells with POS; no enforcing
    // layer ever granted that, so a factory outlet is a separate product
    // decision, not an implication of this profile. The profile DOES
    // install as an add-on module on top of ANY other activity
    // (a restaurant making its own chocolate, a pharmacy compounding) via `extraFeatures: ['manufacturing']`,
    // which `hasFeature`'s literal extraFeatures check already grants regardless of pillar/band.
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'manufacturing'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 4,
  },

  maintenance: {
    key: 'maintenance',
    pillar: 'commerce',
    subVertical: 'maintenance',
    labelAr: 'مراكز صيانة وخدمات وأجهزة',
    labelEn: 'Maintenance & Service Center',
    descriptionAr: 'كروت استلام وفحص الأجهزة، قطع الغيار المستهلكة، تتبع أرقام السيريال والـ IMEI وتسليم الأجهزة.',
    defaultRoute: '/maintenance',
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'pos', 'maintenance', 'deliveryReps'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 2,
  },

  import_export: {
    key: 'import_export',
    pillar: 'commerce',
    subVertical: 'import_export',
    labelAr: 'الاستيراد والتجارة الدولية والتوزيع',
    labelEn: 'Import & International Wholesale',
    descriptionAr: 'إدارة الشحنات والحاويات الجمركية، مديونية الموردين والمصانع الخارجية، وأرباح الشركاء الممولين.',
    defaultRoute: '/import/shipments',
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'import'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 4,
  },

  auto_parts: {
    key: 'auto_parts',
    pillar: 'commerce',
    subVertical: 'auto_parts',
    labelAr: 'قطع غيار السيارات والآليات',
    labelEn: 'Auto Spare Parts & Vehicles',
    descriptionAr: 'دليل قطع الغيار، أرقام القطع الأصلية (OEM)، توافق الموديلات والماركات وسنوات الصنع.',
    defaultRoute: '/dashboard',
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'pos', 'deliveryReps'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 1,
  },

  clothing: {
    key: 'clothing',
    pillar: 'commerce',
    subVertical: 'clothing',
    labelAr: 'الملابس والأزياء والأحذية',
    labelEn: 'Fashion & Apparel',
    descriptionAr: 'إدارة مصفوفة الألوان والمقاسات (Variants)، وتوليد الباركود للأزياء، وتصنيفات الموديلات.',
    defaultRoute: '/dashboard',
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'pos', 'clothing', 'deliveryReps'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 1,
  },

  wholesale_van: {
    key: 'wholesale_van',
    pillar: 'commerce',
    subVertical: 'wholesale_van',
    labelAr: 'تجارة وتوزيع الجملة وأسطول الفان',
    labelEn: 'Wholesale & Van Distribution',
    descriptionAr:
      'منظومة شركات التوزيع وتجارة الجملة: أسطول سيارات الفان، المخازن المتنقلة، خطوط السير، وكود ومواقع المحلات بدون نقاط بيع وكاشير.',
    defaultRoute: '/inventory/van-sales',
    defaultFeatures: [
      'catalog',
      'products',
      'sales',
      'inventory',
      'purchases',
      'suppliers',
      'customers',
      'deliveryReps',
      'vanSales',
      'pricing',
      'treasury',
      'reports',
    ],
    allowedExtraFeatures: ['storefront', 'installments', 'crm'],
    pricingBand: 3,
  },

  warehousing: {
    key: 'warehousing',
    pillar: 'commerce',
    subVertical: 'warehousing',
    labelAr: 'إدارة المخازن والمستودعات والتحويلات',
    labelEn: 'Warehouse & Inventory Management',
    descriptionAr:
      'منظومة المستودعات المركزية والفرعية: التحويلات بين الفروع وتتبع البضاعة بالطريق، أذونات الصرف والإضافة، الجرد ونواقص المخزون بدون نقاط بيع أو كاشير.',
    defaultRoute: '/inventory',
    defaultFeatures: [
      'catalog',
      'products',
      'inventory',
      'purchases',
      'suppliers',
      'customers',
      'sales',
      'pricing',
      'treasury',
      'reports',
    ],
    allowedExtraFeatures: ['installments', 'crm', 'fixed_assets'],
    pricingBand: 3,
  },

  services: {
    key: 'services',
    pillar: 'commerce',
    subVertical: 'services',
    labelAr: 'الشركات والمكاتب الخدمية والاستشارية',
    labelEn: 'Professional Services & Consulting',
    descriptionAr: 'إدارة عقود الخدمات والاستشارات، مطالبات العملاء، المشاريع والمهام والتحصيلات بدون مخزون سلعي.',
    defaultRoute: '/dashboard',
    defaultFeatures: ['catalog', 'sales', 'customers', 'treasury', 'accounting', 'reports'],
    allowedExtraFeatures: ['crm', 'installments'],
    pricingBand: 4,
  },

  ecommerce: {
    key: 'ecommerce',
    pillar: 'commerce',
    subVertical: 'ecommerce',
    labelAr: 'المتاجر الرقمية والتجارة الإلكترونية',
    labelEn: 'E-Commerce & Digital Stores',
    descriptionAr: 'المتجر الإلكتروني، بوابات الدفع، شحن الطلبات، كاشير الكتروني وتتبع المبيعات أونلاين.',
    defaultRoute: '/storefront',
    defaultFeatures: ['catalog', 'products', 'sales', 'pos', 'storefront', 'inventory', 'deliveryReps'],
    allowedExtraFeatures: [],
    pricingBand: 4,
  },

  supermarket: {
    key: 'supermarket',
    pillar: 'commerce',
    subVertical: 'supermarket',
    labelAr: 'السوبرماركت والبقالة والمواد الغذائية',
    labelEn: 'Supermarket & Grocery',
    descriptionAr: 'الباركود الوزني وموازين الباركود، الكاشير السريع، المخزون، ونواقص الرفوف.',
    defaultRoute: '/dashboard',
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'pos', 'inventory', 'deliveryReps'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 1,
  },

  appliances_installments: {
    key: 'appliances_installments',
    pillar: 'commerce',
    subVertical: 'appliances_installments',
    labelAr: 'الأجهزة الكهربائية والمنزلية ومعارض التقسيط',
    labelEn: 'Appliances & Installment Showrooms',
    descriptionAr: 'جدولة أقساط العملاء، غرامات التأخير، إيصالات وشيكات الأمانة، وإدارة معارض الأجهزة.',
    defaultRoute: '/dashboard',
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'pos', 'installments', 'deliveryReps'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 2,
  },

  spices: {
    key: 'spices',
    pillar: 'commerce',
    subVertical: 'spices',
    labelAr: 'العطارة والمحامص والمطاحن والبهارات',
    labelEn: 'Spices & Roasteries',
    descriptionAr: 'خلطات التعبئة والميزان، التجزئة بالأوزان والأحجام، وكاشير سريع للمحامص والمطاحن.',
    defaultRoute: '/dashboard',
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'pos', 'deliveryReps'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 1,
  },

  perfumes: {
    key: 'perfumes',
    pillar: 'commerce',
    subVertical: 'perfumes',
    labelAr: 'العطور ومستحضرات التجميل والتركيبات',
    labelEn: 'Perfumes & Cosmetics',
    descriptionAr: 'تركيبات العطور والزيوت الخام، أحجام الزجاجات والعبوات، والبيع السريع بالباركود.',
    defaultRoute: '/dashboard',
    defaultFeatures: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'pos', 'deliveryReps'],
    allowedExtraFeatures: ['storefront'],
    pricingBand: 1,
  },
};

/**
 * Normalizes an arbitrary activity string to a recognized IndustryProfileKey.
 * Defaults safely to 'retail_general' to ensure zero disruptions.
 */
export function normalizeIndustryProfileKey(raw?: string | null): IndustryProfileKey {
  if (!raw || typeof raw !== 'string') return 'retail_general';
  const trimmed = raw.trim().toLowerCase();

  if (
    trimmed === 'wholesale_van' ||
    trimmed === 'wholesale' ||
    trimmed === 'distribution' ||
    trimmed === 'توزيع' ||
    trimmed === 'فان' ||
    trimmed === 'مناديب' ||
    trimmed === 'جملة' ||
    trimmed === 'جملة_وتوزيع' ||
    trimmed.includes('توزيع') ||
    trimmed.includes('فان') ||
    trimmed.includes('مناديب') ||
    trimmed.includes('جملة') ||
    trimmed.includes('موزعون') ||
    trimmed.includes('وكلاء') ||
    trimmed.includes('wholesale') ||
    trimmed.includes('distribution')
  ) {
    return 'wholesale_van';
  }

  if (
    trimmed === 'warehousing' ||
    trimmed === 'warehouse' ||
    trimmed === 'inventory' ||
    trimmed === 'wms' ||
    trimmed === 'مخازن' ||
    trimmed === 'مستودع' ||
    trimmed === 'مستودعات' ||
    trimmed.includes('مخازن') ||
    trimmed.includes('مستودع') ||
    trimmed.includes('تخزين') ||
    trimmed.includes('لوجستيات المستودعات')
  ) {
    return 'warehousing';
  }

  if (
    trimmed === 'contracting' ||
    trimmed === 'construction' ||
    trimmed === 'مقاولات' ||
    trimmed.includes('مقاول') ||
    trimmed.includes('إنشاءات') ||
    trimmed.includes('مشاريع هندسية')
  ) {
    return 'contracting';
  }

  if (
    trimmed === 'maritime_freight' ||
    trimmed === 'maritime' ||
    trimmed === 'freight' ||
    trimmed === 'shipping' ||
    trimmed === 'شحن' ||
    trimmed.includes('شحن') ||
    trimmed.includes('ملاحة') ||
    trimmed.includes('موانئ') ||
    trimmed.includes('لوجست')
  ) {
    return 'maritime_freight';
  }

  if (
    trimmed === 'pharmacy' ||
    trimmed === 'صيدلية' ||
    trimmed === 'صيدليات' ||
    trimmed.includes('صيدل') ||
    trimmed.includes('علاجية') ||
    trimmed.includes('أدوية')
  ) {
    return 'pharmacy';
  }

  if (
    trimmed === 'restaurant' ||
    trimmed === 'cafe' ||
    trimmed === 'مطعم' ||
    trimmed === 'كافيه' ||
    trimmed.includes('مطعم') ||
    trimmed.includes('مطاعم') ||
    trimmed.includes('كافيه') ||
    trimmed.includes('أغذية مجهزة')
  ) {
    return 'restaurant';
  }

  if (
    trimmed === 'manufacturing' ||
    trimmed === 'production' ||
    trimmed === 'تصنيع' ||
    trimmed === 'مصنع' ||
    trimmed.includes('تصنيع') ||
    trimmed.includes('معامل') ||
    trimmed.includes('ورش')
  ) {
    return 'manufacturing';
  }

  if (
    trimmed === 'maintenance' ||
    trimmed === 'صيانة' ||
    trimmed === 'repair' ||
    trimmed === 'ورشة' ||
    trimmed === 'electronics' ||
    trimmed.includes('صيانة') ||
    trimmed.includes('موبايل') ||
    trimmed.includes('إلكترونيات')
  ) {
    return 'maintenance';
  }

  if (
    trimmed === 'import_export' ||
    trimmed === 'import' ||
    trimmed === 'استيراد' ||
    trimmed === 'شراكة' ||
    trimmed === 'استيراد_وتصدير' ||
    trimmed.includes('استيراد') ||
    trimmed.includes('تصدير') ||
    trimmed.includes('جمارك') ||
    trimmed.includes('حاويات')
  ) {
    return 'import_export';
  }

  if (
    trimmed === 'auto_parts' ||
    trimmed === 'autoparts' ||
    trimmed === 'قطع_غيار' ||
    trimmed === 'قطع غيار' ||
    trimmed.includes('قطع غيار')
  ) {
    return 'auto_parts';
  }

  if (
    trimmed === 'clothing' ||
    trimmed === 'fashion' ||
    trimmed === 'apparel' ||
    trimmed === 'ملابس' ||
    trimmed === 'أزياء' ||
    trimmed.includes('ملابس') ||
    trimmed.includes('أزياء') ||
    trimmed.includes('أحذية')
  ) {
    return 'clothing';
  }

  if (
    trimmed === 'services' ||
    trimmed === 'خدمات' ||
    trimmed === 'استشارات' ||
    trimmed === 'استشارية' ||
    trimmed.includes('خدمات') ||
    trimmed.includes('خدمية') ||
    trimmed.includes('استشار')
  ) {
    return 'services';
  }

  if (
    trimmed === 'ecommerce' ||
    trimmed === 'storefront' ||
    trimmed === 'متجر' ||
    trimmed === 'أونلاين' ||
    trimmed.includes('أونلاين') ||
    trimmed.includes('إلكترون') ||
    trimmed.includes('ecommerce')
  ) {
    return 'ecommerce';
  }

  if (
    trimmed === 'supermarket' ||
    trimmed === 'grocery' ||
    trimmed === 'بقالة' ||
    trimmed === 'سوبرماركت' ||
    trimmed.includes('سوبر') ||
    trimmed.includes('بقالة')
  ) {
    return 'supermarket';
  }

  if (
    trimmed === 'appliances_installments' ||
    trimmed === 'installments' ||
    trimmed === 'تقسيط' ||
    trimmed.includes('تقسيط') ||
    trimmed.includes('أجهزة كهربائية') ||
    trimmed.includes('أثاث')
  ) {
    return 'appliances_installments';
  }

  if (
    trimmed === 'spices' ||
    trimmed === 'عطارة' ||
    trimmed.includes('عطارة') ||
    trimmed.includes('محامص') ||
    trimmed.includes('مطاحن') ||
    trimmed.includes('بهارات')
  ) {
    return 'spices';
  }

  if (
    trimmed === 'perfumes' ||
    trimmed === 'عطور' ||
    trimmed.includes('عطور') ||
    trimmed.includes('تجميل') ||
    trimmed.includes('تركيبات')
  ) {
    return 'perfumes';
  }

  return 'retail_general';
}

export function getIndustryProfile(activityType?: string | null): IndustryProfile {
  const key = normalizeIndustryProfileKey(activityType);
  return INDUSTRY_PROFILES[key] || INDUSTRY_PROFILES.retail_general;
}

export function listSupportedIndustryProfiles(): IndustryProfile[] {
  return Object.values(INDUSTRY_PROFILES);
}

/**
 * Resolves the effective feature list for a tenant based on their activity profile and plan.
 * Pillars strictly protect core domain modules (e.g. contracting will not leak to retail, and vice versa).
 */
export function resolvePillarScopedFeatures(
  activityType: string | null | undefined,
  planFeatures: string[],
  extraFeatures: string[] = [],
  featureOverrides: Record<string, boolean> = {},
): string[] {
  const profile = getIndustryProfile(activityType);
  const extraAdd = extraFeatures.filter((f) => !f.startsWith('+') && !f.startsWith('-'));
  const explicitPlus = extraFeatures.filter((f) => f.startsWith('+')).map((f) => f.substring(1));
  const explicitMinus = extraFeatures.filter((f) => f.startsWith('-')).map((f) => f.substring(1));

  // Combined candidate features from plan and profile defaults
  const candidates = new Set([...profile.defaultFeatures, ...planFeatures, ...extraAdd, ...explicitPlus]);

  // If the tenant is strictly contracting or maritime, remove non-allowed retail modules unless explicitly added
  if (profile.pillar === 'contracting') {
    candidates.delete('pharmacy');
    candidates.delete('restaurant');
    candidates.delete('maritime_freight');
    candidates.delete('manufacturing');
    candidates.delete('storefront');
    candidates.delete('kds');
    candidates.delete('displays');
    candidates.delete('signage');
    candidates.delete('deliveryReps');
    candidates.delete('maintenance');
    candidates.delete('clothing');
    if (!explicitPlus.includes('pos')) candidates.delete('pos');
  } else if (profile.pillar === 'maritime_freight') {
    candidates.delete('pharmacy');
    candidates.delete('restaurant');
    candidates.delete('contracting');
    candidates.delete('manufacturing');
    candidates.delete('storefront');
    candidates.delete('pos');
    candidates.delete('kds');
    candidates.delete('displays');
    candidates.delete('signage');
    candidates.delete('deliveryReps');
    candidates.delete('maintenance');
    candidates.delete('clothing');
    candidates.delete('inventory');
  } else if (profile.pillar === 'manufacturing') {
    candidates.delete('pharmacy');
    candidates.delete('restaurant');
    candidates.delete('contracting');
    candidates.delete('maritime_freight');
    candidates.delete('storefront');
    candidates.delete('kds');
    candidates.delete('displays');
    candidates.delete('signage');
    candidates.delete('deliveryReps');
    candidates.delete('maintenance');
    candidates.delete('clothing');
    if (!explicitPlus.includes('pos')) candidates.delete('pos');
  } else {
    // Pillar is commerce: remove isolated vertical modules (contracting, maritime_freight, manufacturing) unless explicitly granted
    if (!explicitPlus.includes('contracting')) candidates.delete('contracting');
    if (!explicitPlus.includes('maritime_freight')) candidates.delete('maritime_freight');
    if (!explicitPlus.includes('manufacturing')) candidates.delete('manufacturing');

    // Remove specialized commerce verticals that do not match the subVertical unless explicitly granted
    if (profile.subVertical !== 'pharmacy' && !explicitPlus.includes('pharmacy')) {
      candidates.delete('pharmacy');
    }
    if (profile.subVertical !== 'restaurant' && !explicitPlus.includes('restaurant')) {
      candidates.delete('restaurant');
    }
    if (profile.subVertical !== 'maintenance' && !explicitPlus.includes('maintenance')) {
      candidates.delete('maintenance');
    }
    if (profile.subVertical !== 'import_export' && !explicitPlus.includes('import')) {
      candidates.delete('import');
    }
    if (profile.subVertical !== 'clothing' && !explicitPlus.includes('clothing')) {
      candidates.delete('clothing');
    }
    if (profile.subVertical === 'services') {
      if (!explicitPlus.includes('pos')) candidates.delete('pos');
      if (!explicitPlus.includes('inventory')) candidates.delete('inventory');
      candidates.delete('storefront');
      candidates.delete('kds');
      candidates.delete('displays');
      candidates.delete('signage');
      candidates.delete('deliveryReps');
      candidates.delete('cashDrawer');
    }
    if (profile.subVertical === 'wholesale_van') {
      if (!explicitPlus.includes('pos')) candidates.delete('pos');
      candidates.delete('kds');
      candidates.delete('displays');
      candidates.delete('signage');
      candidates.delete('cashDrawer');
    }
    if (profile.subVertical === 'warehousing') {
      if (!explicitPlus.includes('pos')) candidates.delete('pos');
      candidates.delete('storefront');
      candidates.delete('kds');
      candidates.delete('displays');
      candidates.delete('signage');
      candidates.delete('deliveryReps');
      candidates.delete('cashDrawer');
    }
  }

  // Filter out any explicit exclusions
  for (const excluded of explicitMinus) {
    candidates.delete(excluded);
  }

  // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): super-admin per-tenant
  // overrides apply last, over every pillar/subVertical/plan rule above
  // (including the wholesale_van pos/cashDrawer deletions and the
  // explicitMinus exclusions).
  for (const [feature, granted] of Object.entries(featureOverrides)) {
    if (granted) candidates.add(feature);
    else candidates.delete(feature);
  }

  return Array.from(candidates);
}
