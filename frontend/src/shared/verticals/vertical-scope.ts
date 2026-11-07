export type BusinessVertical =
  | 'maritime'
  | 'contracting'
  | 'wholesale_van'
  | 'warehousing'
  | 'manufacturing'
  | 'restaurant'
  | 'pharmacy'
  | 'maintenance'
  | 'services'
  | 'import_export'
  | 'retail_general';

export interface MobileNavItemConfig {
  to: string;
  label: string;
  iconType: 'home' | 'sales' | 'maritime-jobs' | 'contracting-projects' | 'contracting-invoices' | 'van-sales' | 'manufacturing-orders' | 'pos' | 'inventory' | 'quotations';
  activeMatchPrefixes: string[];
}

export interface MobileBottomNavConfig {
  home: MobileNavItemConfig;
  secondary: MobileNavItemConfig;
  centerActionLabel: string;
  primary: MobileNavItemConfig;
}

export interface MobileQuickActionItem {
  id: string;
  title: string;
  subtitle: string;
  to?: string;
  actionKey?: 'quickProduct' | 'priceChecker';
  bg: string;
  color: string;
  iconType:
    | 'ship'
    | 'container'
    | 'inquiry'
    | 'quotation'
    | 'customer'
    | 'treasury'
    | 'project'
    | 'ipc'
    | 'dailyLog'
    | 'changeOrder'
    | 'supplier'
    | 'truck'
    | 'invoice'
    | 'checker'
    | 'reps'
    | 'gear'
    | 'bom'
    | 'purchase'
    | 'pos'
    | 'product'
    | 'inventory';
}

/**
 * Single source of truth to resolve the tenant's primary business vertical.
 */
export function resolveCurrentVertical(tenant?: any, settings?: any): BusinessVertical {
  const isFlagActive = (val: any) => val === true || val === 'true' || val === 1 || val === '1';

  // 0. Enterprise operational module switches take precedence over generic retail
  if (isFlagActive(settings?.maritimeFreightModuleEnabled)) return 'maritime';
  if (isFlagActive(settings?.contractingModuleEnabled)) return 'contracting';

  const hasPosEntitlement = Boolean(
    tenant?.features?.includes('pos') ||
    tenant?.features?.includes('cashDrawer') ||
    tenant?.plan_id === 'plan_ultimate' ||
    tenant?.plan_id === 'plan_omnichannel' ||
    (isFlagActive(settings?.posModuleEnabled) && !isFlagActive(settings?.contractingModuleEnabled) && !isFlagActive(settings?.maritimeFreightModuleEnabled) && !isFlagActive(settings?.manufacturingModuleEnabled))
  );

  // 1. Explicit configured vertical indicator: HIGHEST AUTHORITY (The tenant's chosen business identity)
  const candidates = [
    settings?.businessIndustry,
    settings?.activityType,
    tenant?.activityType,
    tenant?.pillar,
  ].map((s) => String(s ?? '').trim().toLowerCase().replace(/^"|"$/g, ''))
   .filter((s) => s && s !== 'general' && s !== 'retail_general' && s !== 'retail' && s !== 'store' && s !== 'commerce');

  const explicit = candidates[0] || String(settings?.businessIndustry || tenant?.activityType || '').trim().toLowerCase();

  if (explicit) {
    if (
      explicit === 'maritime_freight' ||
      explicit === 'maritime' ||
      explicit === 'freight' ||
      explicit === 'shipping' ||
      explicit.includes('شحن') ||
      explicit.includes('maritime') ||
      explicit.includes('ملاحة') ||
      explicit.includes('لوجست')
    ) {
      return 'maritime';
    }

    if (
      explicit === 'contracting' ||
      explicit === 'construction' ||
      explicit.includes('مقاول') ||
      explicit.includes('تشييد') ||
      explicit.includes('إنشاء')
    ) {
      return 'contracting';
    }

    if (
      explicit === 'wholesale_van' ||
      explicit === 'wholesale' ||
      explicit === 'distribution' ||
      explicit.includes('توزيع') ||
      explicit.includes('فان') ||
      explicit.includes('مناديب') ||
      explicit.includes('جمل') ||
      explicit.includes('موزعون') ||
      explicit.includes('وكلاء')
    ) {
      return 'wholesale_van';
    }

    if (
      explicit === 'warehousing' ||
      explicit === 'warehouse' ||
      explicit === 'inventory' ||
      explicit === 'wms' ||
      explicit.includes('مخازن') ||
      explicit.includes('مستودع') ||
      explicit.includes('تخزين') ||
      explicit.includes('لوجستيات المستودعات')
    ) {
      return 'warehousing';
    }

    if (
      explicit === 'manufacturing' ||
      explicit === 'production' ||
      explicit.includes('تصنيع') ||
      explicit.includes('مصنع') ||
      explicit.includes('إنتاج') ||
      explicit.includes('معامل') ||
      explicit.includes('ورش')
    ) {
      return 'manufacturing';
    }

    if (
      explicit === 'restaurant' ||
      explicit === 'cafe' ||
      explicit.includes('مطعم') ||
      explicit.includes('كافيه') ||
      explicit.includes('أغذية مجهزة')
    ) {
      return 'restaurant';
    }

    if (
      explicit === 'pharmacy' ||
      explicit.includes('صيدل') ||
      explicit.includes('أدوية') ||
      explicit.includes('علاجية')
    ) {
      return 'pharmacy';
    }

    if (
      explicit === 'electronics' ||
      explicit === 'maintenance' ||
      explicit === 'repair' ||
      explicit.includes('صيانة') ||
      explicit.includes('إلكترون') ||
      explicit.includes('موبايل')
    ) {
      return 'maintenance';
    }

    if (
      explicit === 'services' ||
      explicit.includes('خدمات') ||
      explicit.includes('استشار')
    ) {
      if (hasPosEntitlement || tenant?.slug === 'almhnds' || tenant?.id === 'almhnds') {
        return 'retail_general';
      }
      return 'services';
    }

    if (
      explicit === 'import_export' ||
      explicit === 'import' ||
      explicit === 'export' ||
      explicit.includes('استيراد') ||
      explicit.includes('تصدير') ||
      explicit.includes('جمارك')
    ) {
      return 'import_export';
    }

    if (
      explicit === 'retail' ||
      explicit === 'retail_general' ||
      explicit === 'general' ||
      explicit === 'store' ||
      explicit === 'supermarket' ||
      explicit === 'clothing' ||
      explicit === 'fashion' ||
      explicit === 'spices' ||
      explicit === 'perfumes' ||
      explicit === 'auto_parts' ||
      explicit === 'appliances_installments' ||
      explicit === 'ecommerce' ||
      explicit === 'storefront' ||
      explicit.includes('تجزئة') ||
      explicit.includes('متاجر') ||
      explicit.includes('سوبرماركت') ||
      explicit.includes('ملابس') ||
      explicit.includes('أزياء') ||
      explicit.includes('أحذية')
    ) {
      // If explicit is generic retail, but an operational enterprise module switch was turned on, honor it
      if (isFlagActive(settings?.maritimeFreightModuleEnabled)) return 'maritime';
      if (isFlagActive(settings?.contractingModuleEnabled)) return 'contracting';
      if (
        isFlagActive(settings?.manufacturingModuleEnabled) &&
        !['clothing', 'fashion', 'spices', 'perfumes', 'supermarket', 'auto_parts', 'appliances_installments', 'ecommerce', 'storefront'].includes(explicit)
      ) {
        return 'manufacturing';
      }
      if (isFlagActive(settings?.restaurantModuleEnabled)) return 'restaurant';
      if (isFlagActive(settings?.enablePharmacyModule)) return 'pharmacy';
      if (isFlagActive(settings?.enableMobileStoreFeatures)) return 'maintenance';
      if (isFlagActive(settings?.importModuleEnabled)) return 'import_export';
      if ((isFlagActive(settings?.vanSalesModuleEnabled) || isFlagActive(settings?.deliveryFleetModuleEnabled)) && isFlagActive(settings?.enableEnterpriseFeatures) && settings?.posModuleEnabled === false) return 'wholesale_van';

      return 'retail_general';
    }
  }

  // 2. Fallback to operational settings flags if no candidate specified
  if (isFlagActive(settings?.maritimeFreightModuleEnabled)) return 'maritime';
  if (isFlagActive(settings?.contractingModuleEnabled)) return 'contracting';
  if (isFlagActive(settings?.manufacturingModuleEnabled)) return 'manufacturing';
  if (isFlagActive(settings?.restaurantModuleEnabled)) return 'restaurant';
  if (isFlagActive(settings?.enablePharmacyModule)) return 'pharmacy';
  if (isFlagActive(settings?.enableMobileStoreFeatures)) return 'maintenance';
  if (isFlagActive(settings?.servicesModuleEnabled) && settings?.posModuleEnabled === false && settings?.inventoryModuleEnabled === false) return 'services';
  if (isFlagActive(settings?.importModuleEnabled)) return 'import_export';
  if ((isFlagActive(settings?.vanSalesModuleEnabled) || isFlagActive(settings?.deliveryFleetModuleEnabled)) && isFlagActive(settings?.enableEnterpriseFeatures) && settings?.posModuleEnabled === false) return 'wholesale_van';

  // 3. Store name / Business name heuristic fallback
  const nameFallback = String(
    tenant?.businessName ||
    settings?.storeName ||
    settings?.brandName ||
    (settings as any)?.companyName ||
    ''
  ).trim().toLowerCase();

  if (nameFallback) {
    if (nameFallback.includes('شحن') || nameFallback.includes('ملاحة')) return 'maritime';
    if (nameFallback.includes('مقاول') || nameFallback.includes('تشييد')) return 'contracting';
    if (nameFallback.includes('توزيع') || nameFallback.includes('فان') || nameFallback.includes('مناديب')) return 'wholesale_van';
    if (nameFallback.includes('تصنيع') || nameFallback.includes('مصنع')) return 'manufacturing';
    if (nameFallback.includes('مطعم') || nameFallback.includes('كافيه')) return 'restaurant';
    if (nameFallback.includes('صيدل')) return 'pharmacy';
    if (nameFallback.includes('صيانة')) return 'maintenance';
    if (nameFallback.includes('استيراد') || nameFallback.includes('تصدير')) return 'import_export';
  }

  return 'retail_general';
}

function normalizeKey(target: string): string {
  const trimmed = String(target || '').trim();
  if (!trimmed || trimmed === '/') return '/';
  return trimmed.replace(/^\//, '').replace(/\/$/, '') || '/';
}

/**
 * Universal Vertical Isolation Check:
 * Enforces strict boundaries between business models across desktop, mobile, search, and routes.
 */
export function isRouteAllowedInVertical(vertical: BusinessVertical, target: string, settings?: any): boolean {
  const key = normalizeKey(target);

  // INV-STOREFRONT-ORDERS: the recorded-orders list is the tenant's own order record,
  // not a storefront feature — every vertical allows it so an admin can always reach
  // orders recorded while the storefront was on. The store itself, its settings and
  // marketplaces stay blocked per vertical below. The page is still permission-gated
  // to 'sales' by the router (routePermissionMap).
  if (key === 'online-orders') {
    return true;
  }

  // Specific settings routes that belong exclusively to retail e-commerce or retail warehouse management
  if (
    key === 'settings/storefront' ||
    key === 'settings/marketplaces' ||
    key === 'settings/locations' ||
    key === 'settings/reference' ||
    key === 'settings/demo-data' ||
    key.startsWith('settings/storefront/') ||
    key.startsWith('settings/marketplaces/') ||
    key.startsWith('settings/locations/') ||
    key.startsWith('settings/reference/') ||
    key.startsWith('settings/demo-data/')
  ) {
    if (vertical === 'maritime') {
      return false;
    }
    if (vertical === 'contracting' && key !== 'settings/reference' && !key.startsWith('settings/reference/')) {
      return false;
    }
    if (key.includes('storefront') || key.includes('marketplaces')) {
      return settings?.storefrontModuleEnabled !== false;
    }
  }

  // Common universal infrastructure routes (always permitted for all verticals)
  if (
    key === '/' ||
    key === 'dashboard' ||
    key === 'login' ||
    key === 'onboarding' ||
    key === 'settings' ||
    key.startsWith('settings/') ||
    key.startsWith('settings-') ||
    key === 'audit' ||
    key === 'apps' ||
    key.startsWith('saas-admin') ||
    key.startsWith('hr') ||
    key === 'treasury' ||
    key === 'expenses' ||
    key.startsWith('accounting') ||
    key === 'accounts' ||
    key === 'vat-declaration'
  ) {
    return true;
  }

  switch (vertical) {
    case 'maritime': {
      // Strictly block retail POS, barcode, pricing center, general retail stock, other verticals
      const blockedKeys = [
        'pos',
        'cash-drawer',
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'pricing-center',
        'products',
        'products/new',
        'product-new',
        'product-categories',
        'products/categories',
        'inventory',
        'inventory-warehouses',
        'inventory/warehouses',
        'inventory-bins',
        'inventory/bins',
        'inventory-tree',
        'inventory/tree',
        'inventory-issue-orders',
        'inventory/issue-orders',
        'inventory-issue-order-new',
        'inventory/issue-orders/new',
        'inventory/van-sales',
        'reports-inventory',
        'reports/inventory',
        'delivery-reps',
        'van-sales-admin',
        'van-sales',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'sales',
        'sales/invoices',
        'sales-orders',
        'sales/orders',
        'returns',
        'price-lists',
        'sales/price-lists',
        'quotations',
        'purchases-rfqs',
        'purchases/rfqs',
        'purchases-orders',
        'purchases/orders',
        'purchases-reorder',
        'purchases',
        'purchases-new',
        'purchases/new',
        'purchase-returns',
        'reports-sales',
        'reports/sales',
        'reports-purchases',
        'reports/purchases',
        'installments',
        'contracting',
        'pharmacy',
        'manufacturing',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) return false;

      return true;
    }

    case 'contracting': {
      const blockedKeys = [
        'pos',
        'cash-drawer',
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'pricing-center',
        'delivery-reps',
        'van-sales-admin',
        'van-sales',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'sales-orders',
        'price-lists',
        'maritime',
        'pharmacy',
        'manufacturing',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) return false;

      return true;
    }

    case 'wholesale_van': {
      const blockedKeys = [
        'pos',
        'maritime',
        'contracting',
        'kds',
        'displays',
        'signage',
        'pharmacy',
        'manufacturing',
        'maintenance',
        'trade-in',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) return false;

      return true;
    }

    case 'warehousing': {
      const blockedKeys = [
        'pos',
        'cash-drawer',
        'storefront',
        'marketplaces',
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'maritime',
        'contracting',
        'pharmacy',
        'manufacturing',
        'delivery-reps',
        'van-sales-admin',
        'van-sales',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) return false;
      if (key.startsWith('van-sales') || key.startsWith('driver-mobile')) return false;

      return true;
    }

    case 'manufacturing': {
      const blockedKeys = [
        'pos',
        'cash-drawer',
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'delivery-reps',
        'van-sales-admin',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'maritime',
        'contracting',
        'pharmacy',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;

      return true;
    }

    case 'import_export': {
      if ((key === 'pos' || key === 'cash-drawer') && settings?.posModuleEnabled === false) {
        return false;
      }

      const blockedKeys = [
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'delivery-reps',
        'van-sales-admin',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'maritime',
        'contracting',
        'pharmacy',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;

      return true;
    }

    case 'services': {
      const blockedKeys = [
        'pos',
        'cash-drawer',
        'online-orders',
        'kds',
        'displays',
        'signage',
        'product-modifiers',
        'delivery-reps',
        'van-sales-admin',
        'van-sales',
        'trade-in',
        'imei-history',
        'maintenance',
        'clothing',
        'maritime',
        'contracting',
        'pharmacy',
        'manufacturing',
        'pricing-center',
        'products',
        'products/new',
        'product-categories',
        'products/categories',
        'inventory',
        'inventory-warehouses',
        'inventory/warehouses',
        'inventory-bins',
        'inventory-tree',
        'inventory-issue-orders',
        'inventory-issue-order-new',
        'reports-inventory',
        'purchases-reorder',
      ];

      if (blockedKeys.some((b) => key === b || key.startsWith(`${b}/`))) {
        return false;
      }
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) return false;
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) return false;
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) return false;
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) return false;

      return true;
    }

    case 'retail_general':
    default: {
      // General retail blocks deep vertical suites unless explicitly activated
      if (key.startsWith('maritime-') || key.startsWith('maritime/')) {
        return settings?.maritimeFreightModuleEnabled === true;
      }
      if (key.startsWith('contracting-') || key.startsWith('contracting/')) {
        return settings?.contractingModuleEnabled === true;
      }
      if (key.startsWith('manufacturing-') || key.startsWith('manufacturing/')) {
        return settings?.manufacturingModuleEnabled === true;
      }
      if (key.startsWith('pharmacy-') || key.startsWith('pharmacy/')) {
        return settings?.pharmacyModuleEnabled === true;
      }
      return true;
    }
  }
}

/**
 * Mobile Bottom Navigation Configuration per Vertical
 */
export function getMobileBottomNavConfig(vertical: BusinessVertical, settings?: any): MobileBottomNavConfig {
  const isPosActive = settings?.posModuleEnabled !== false;

  switch (vertical) {
    case 'maritime':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/sales',
          label: 'الفواتير',
          iconType: 'sales',
          activeMatchPrefixes: ['/sales', '/quotations'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/maritime/jobs',
          label: 'أوامر التشغيل',
          iconType: 'maritime-jobs',
          activeMatchPrefixes: ['/maritime/jobs', '/maritime/containers', '/maritime'],
        },
      };

    case 'contracting':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/contracting/projects',
          label: 'المشاريع',
          iconType: 'contracting-projects',
          activeMatchPrefixes: ['/contracting/projects'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/contracting/invoices',
          label: 'المستخلصات',
          iconType: 'contracting-invoices',
          activeMatchPrefixes: ['/contracting/invoices', '/contracting/financials', '/contracting'],
        },
      };

    case 'wholesale_van':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/sales',
          label: 'فواتير الجملة',
          iconType: 'sales',
          activeMatchPrefixes: ['/sales', '/sales/orders'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/van-sales/admin',
          label: 'المناديب والتوزيع',
          iconType: 'van-sales',
          activeMatchPrefixes: ['/van-sales', '/delivery-reps', '/inventory/van-sales'],
        },
      };

    case 'warehousing':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/inventory',
          label: 'المستودعات والتحويلات',
          iconType: 'inventory',
          activeMatchPrefixes: ['/inventory'],
        },
        centerActionLabel: 'إجراء مخزني',
        primary: {
          to: '/purchases',
          label: 'المشتريات والتوريد',
          iconType: 'sales',
          activeMatchPrefixes: ['/purchases'],
        },
      };

    case 'manufacturing':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/manufacturing/work-orders',
          label: 'أوامر الإنتاج',
          iconType: 'manufacturing-orders',
          activeMatchPrefixes: ['/manufacturing/work-orders', '/manufacturing'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/inventory',
          label: 'الخامات والمخزون',
          iconType: 'inventory',
          activeMatchPrefixes: ['/inventory', '/products'],
        },
      };

    case 'import_export':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/purchases',
          label: 'المشتريات',
          iconType: 'sales',
          activeMatchPrefixes: ['/purchases'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/import/shipments',
          label: 'الشحنات',
          iconType: 'inventory',
          activeMatchPrefixes: ['/import'],
        },
      };

    case 'services':
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/sales',
          label: 'الفواتير',
          iconType: 'sales',
          activeMatchPrefixes: ['/sales', '/quotations'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: {
          to: '/services',
          label: 'الخدمات',
          iconType: 'quotations',
          activeMatchPrefixes: ['/services'],
        },
      };

    case 'retail_general':
    default:
      return {
        home: {
          to: '/',
          label: 'الرئيسية',
          iconType: 'home',
          activeMatchPrefixes: ['/'],
        },
        secondary: {
          to: '/sales',
          label: 'الفواتير',
          iconType: 'sales',
          activeMatchPrefixes: ['/sales', '/returns'],
        },
        centerActionLabel: 'إجراء سريع',
        primary: isPosActive
          ? {
              to: '/pos',
              label: 'نقطة البيع',
              iconType: 'pos',
              activeMatchPrefixes: ['/pos'],
            }
          : {
              to: '/inventory',
              label: 'المخزون',
              iconType: 'inventory',
              activeMatchPrefixes: ['/inventory', '/products'],
            },
      };
  }
}

/**
 * Mobile Quick Actions (Center '+' Sheet) per Vertical:
 * Returns 6 highly relevant, operational actions strictly aligned with the vertical.
 */
export function getMobileQuickActionsConfig(vertical: BusinessVertical, settings?: any): MobileQuickActionItem[] {
  const isPosActive = settings?.posModuleEnabled !== false;

  switch (vertical) {
    case 'maritime':
      return [
        {
          id: 'maritime-job',
          title: 'أمر تشغيل شحنة',
          subtitle: 'إنشاء ملف شحنة وعمليات',
          to: '/maritime/jobs?action=new',
          bg: '#eef2ff',
          color: '#170e5e',
          iconType: 'ship',
        },
        {
          id: 'maritime-containers',
          title: 'تتبع الحاويات',
          subtitle: 'فحص الحاويات ومواقعها',
          to: '/maritime/containers',
          bg: '#e0f2fe',
          color: '#0369a1',
          iconType: 'container',
        },
        {
          id: 'maritime-inquiry',
          title: 'استفسار شحن جديد',
          subtitle: 'تسجيل طلب شحن لعميل',
          to: '/maritime/inquiries?action=new',
          bg: '#f3e8ff',
          color: '#7c3aed',
          iconType: 'inquiry',
        },
        {
          id: 'maritime-quotation',
          title: 'عرض أسعار لعميل',
          subtitle: 'تسعير نولون وخدمات بحرية',
          to: '/maritime/quotations?action=new',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'quotation',
        },
        {
          id: 'maritime-customer',
          title: 'إضافة عميل جديد',
          subtitle: 'تسجيل شاحن أو مستورد',
          to: '/customers?action=new',
          bg: '#ffe4e6',
          color: '#be123c',
          iconType: 'customer',
        },
        {
          id: 'maritime-treasury',
          title: 'الخزينة والمصروفات',
          subtitle: 'سند قبض أو مصروف تشغيلي',
          to: '/treasury',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'treasury',
        },
      ];

    case 'contracting':
      return [
        {
          id: 'contracting-project',
          title: 'مشروع جديد',
          subtitle: 'تسجيل موقع عمل أو مشروع',
          to: '/contracting/projects?action=new',
          bg: '#eef2ff',
          color: '#170e5e',
          iconType: 'project',
        },
        {
          id: 'contracting-ipc',
          title: 'مستخلص أعمال (IPC)',
          subtitle: 'إصدار مستخلص جاري أو ختامي',
          to: '/contracting/invoices?action=new',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'ipc',
        },
        {
          id: 'contracting-daily-log',
          title: 'يوميات الموقع',
          subtitle: 'تسجيل تقرير ميداني يومي',
          to: '/contracting/daily-logs?action=new',
          bg: '#e0f2fe',
          color: '#0369a1',
          iconType: 'dailyLog',
        },
        {
          id: 'contracting-change-order',
          title: 'أمر تغيير ومطالبة',
          subtitle: 'طلب إضافة أو تعديل بنود',
          to: '/contracting/change-orders?action=new',
          bg: '#ffedd5',
          color: '#c2410c',
          iconType: 'changeOrder',
        },
        {
          id: 'contracting-subcontractor',
          title: 'إضافة مقاول / مورد',
          subtitle: 'تسجيل مقاول باطن أو مورد',
          to: '/suppliers?action=new',
          bg: '#ffe4e6',
          color: '#be123c',
          iconType: 'supplier',
        },
        {
          id: 'contracting-treasury',
          title: 'الخزينة والعهد',
          subtitle: 'سند صرف عهدة أو مستحقات',
          to: '/treasury',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'treasury',
        },
      ];

    case 'wholesale_van':
      return [
        {
          id: 'van-load-order',
          title: 'إذن تحميل سيارة',
          subtitle: 'تحميل بضاعة لسيارة مندوب',
          to: '/inventory/van-sales',
          bg: '#eef2ff',
          color: '#170e5e',
          iconType: 'truck',
        },
        {
          id: 'van-sale-invoice',
          title: 'فاتورة بيع جملة',
          subtitle: 'تسجيل فاتورة توريد جديدة',
          to: '/sales?action=new',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'invoice',
        },
        {
          id: 'van-customer',
          title: 'إضافة متجر / عميل',
          subtitle: 'تسجيل منفذ بيع أو بقالة',
          to: '/customers?action=new',
          bg: '#ffe4e6',
          color: '#be123c',
          iconType: 'customer',
        },
        {
          id: 'van-stock-checker',
          title: 'فاحص رصيد المخزن',
          subtitle: 'معاينة رصيد سيارة أو مخزن',
          actionKey: 'priceChecker',
          bg: '#ffedd5',
          color: '#c2410c',
          iconType: 'checker',
        },
        {
          id: 'van-collection',
          title: 'تحصيل وسند قبض',
          subtitle: 'إثبات تحصيل دفعة أو شيك',
          to: '/treasury',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'treasury',
        },
        {
          id: 'van-reps-tracking',
          title: 'المناديب وسيارات الفان',
          subtitle: 'متابعة خطوط السير والعهد',
          to: '/delivery-reps',
          bg: '#e0f2fe',
          color: '#0369a1',
          iconType: 'reps',
        },
      ];

    case 'warehousing':
      return [
        {
          id: 'warehouse-transfer',
          title: 'تحويل بين المستودعات',
          subtitle: 'نقل بضاعة بين مستودعين',
          to: '/inventory?tab=transfers',
          bg: '#eef2ff',
          color: '#170e5e',
          iconType: 'inventory',
        },
        {
          id: 'warehouse-issue-order',
          title: 'إذن صرف / إضافة',
          subtitle: 'تسجيل حركة مخزنية جديدة',
          to: '/inventory/issue-orders/new',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'invoice',
        },
        {
          id: 'warehouse-item',
          title: 'إضافة صنف جديد',
          subtitle: 'تسجيل باركود وتوصيف صنف',
          to: '/products/new',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'product',
        },
        {
          id: 'warehouse-audit',
          title: 'جلسة جرد مخزني',
          subtitle: 'مطابقة الأرصدة والباركود',
          to: '/inventory?tab=counts',
          bg: '#f3e8ff',
          color: '#7e22ce',
          iconType: 'checker',
        },
        {
          id: 'warehouse-purchase',
          title: 'فاتورة توريد وشراء',
          subtitle: 'استلام بضاعة من مورد',
          to: '/purchases/new',
          bg: '#ffedd5',
          color: '#c2410c',
          iconType: 'purchase',
        },
        {
          id: 'warehouse-dispatches',
          title: 'صرف بضاعة لعميل',
          subtitle: 'فاتورة بيع وصرف مستودع',
          to: '/sales?action=new',
          bg: '#e0f2fe',
          color: '#0369a1',
          iconType: 'customer',
        },
      ];

    case 'manufacturing':
      return [
        {
          id: 'mfg-work-order',
          title: 'أمر تشغيل وإنتاج',
          subtitle: 'إصدار أمر تشغيل على خط',
          to: '/manufacturing/work-orders?action=new',
          bg: '#eef2ff',
          color: '#170e5e',
          iconType: 'gear',
        },
        {
          id: 'mfg-bom',
          title: 'هيكل منتج (BOM)',
          subtitle: 'تعديل أو إنشاء مقادير خامات',
          to: '/manufacturing/boms?action=new',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'bom',
        },
        {
          id: 'mfg-raw-receipt',
          title: 'استلام خامات ومشتريات',
          subtitle: 'إدخال توريدة خامات من مورد',
          to: '/purchases/new',
          bg: '#cffafe',
          color: '#0e7490',
          iconType: 'purchase',
        },
        {
          id: 'mfg-stock-checker',
          title: 'فاحص أرصدة الخامات',
          subtitle: 'مطابقة الخامات والتام',
          actionKey: 'priceChecker',
          bg: '#ffedd5',
          color: '#c2410c',
          iconType: 'checker',
        },
        {
          id: 'mfg-supplier',
          title: 'إضافة مورد خامات',
          subtitle: 'تسجيل مورد أو مقاول تصنيع',
          to: '/suppliers?action=new',
          bg: '#ffe4e6',
          color: '#be123c',
          iconType: 'supplier',
        },
        {
          id: 'mfg-treasury',
          title: 'الخزينة والمصروفات',
          subtitle: 'تسجيل تكاليف أو سند قبض',
          to: '/treasury',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'treasury',
        },
      ];

    case 'retail_general':
    default:
      return [
        isPosActive
          ? {
              id: 'pos',
              title: 'نقطة البيع (POS)',
              subtitle: 'كاشير وبيع مباشر سريع',
              to: '/pos',
              bg: '#ede9fe',
              color: '#6d28d9',
              iconType: 'pos',
            }
          : {
              id: 'sales',
              title: 'سجل الفواتير والمبيعات',
              subtitle: 'فواتير الشركات والمبيعات',
              to: '/sales',
              bg: '#ede9fe',
              color: '#6d28d9',
              iconType: 'invoice',
            },
        {
          id: 'price-checker',
          title: 'فاحص الأسعار والمخزون',
          subtitle: 'مسح باركود ومعاينة الرصيد',
          actionKey: 'priceChecker',
          bg: '#ffedd5',
          color: '#c2410c',
          iconType: 'checker',
        },
        {
          id: 'quick-product',
          title: 'إضافة صنف جديد',
          subtitle: 'تسجيل صنف أو خدمة فوراً',
          actionKey: 'quickProduct',
          bg: '#dcfce7',
          color: '#15803d',
          iconType: 'product',
        },
        {
          id: 'new-purchase',
          title: 'فاتورة شراء جديدة',
          subtitle: 'إدخال بضاعة من مورد',
          to: '/purchases/new',
          bg: '#cffafe',
          color: '#0e7490',
          iconType: 'purchase',
        },
        {
          id: 'new-customer',
          title: 'إضافة عميل جديد',
          subtitle: 'تسجيل بيانات العميل وهاتفه',
          to: '/customers?action=new',
          bg: '#ffe4e6',
          color: '#be123c',
          iconType: 'customer',
        },
        {
          id: 'treasury-expense',
          title: 'الخزينة والمصروفات',
          subtitle: 'سند قبض أو تسجيل مصروف',
          to: '/treasury',
          bg: '#fef3c7',
          color: '#b45309',
          iconType: 'treasury',
        },
      ];
  }
}
