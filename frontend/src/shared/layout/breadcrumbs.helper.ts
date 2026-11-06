import type { BreadcrumbItem } from '@/stores/toolbar-store';

interface RouteBreadcrumbRule {
  prefix: string;
  crumbs: BreadcrumbItem[];
  exact?: boolean;
}

const STATIC_ROUTE_RULES: RouteBreadcrumbRule[] = [
  // Dashboard
  { prefix: '/', exact: true, crumbs: [{ label: 'الرئيسية' }] },
  { prefix: '/dashboard', exact: true, crumbs: [{ label: 'الرئيسية' }] },

  // Sales & Customers
  { prefix: '/sales/orders', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المبيعات', to: '/sales' }, { label: 'أوامر البيع وحجز المخزون' }] },
  { prefix: '/sales/price-lists', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المبيعات', to: '/sales' }, { label: 'قوائم الأسعار والشرائح' }] },
  { prefix: '/quotations', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المبيعات', to: '/sales' }, { label: 'عروض الأسعار' }] },
  { prefix: '/displays', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المبيعات', to: '/sales' }, { label: 'شاشات العرض' }] },
  { prefix: '/sales', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المبيعات', to: '/sales' }, { label: 'سجل الفواتير' }] },
  { prefix: '/returns', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المبيعات', to: '/sales' }, { label: 'مرتجعات المبيعات' }] },
  { prefix: '/customers', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المبيعات', to: '/sales' }, { label: 'العملاء' }] },
  { prefix: '/delivery-reps', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المبيعات', to: '/sales' }, { label: 'مناديب التوصيل' }] },

  // Purchases & Suppliers
  { prefix: '/purchases/new', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المشتريات والموردين', to: '/purchases' }, { label: 'إنشاء فاتورة شراء' }] },
  { prefix: '/purchases/returns', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المشتريات والموردين', to: '/purchases' }, { label: 'مرتجعات المشتريات' }] },
  { prefix: '/purchases', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المشتريات والموردين', to: '/purchases' }, { label: 'سجل فواتير المشتريات' }] },
  { prefix: '/suppliers', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المشتريات والموردين', to: '/purchases' }, { label: 'الموردين' }] },

  // Maintenance & Trade-In & Serials (High priority matching before general /products)
  { prefix: '/products/imei-history', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'قسم الصيانة', to: '/maintenance' }, { label: 'سجل وسيريالات الأجهزة' }] },
  { prefix: '/maintenance', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'قسم الصيانة', to: '/maintenance' }, { label: 'تذاكر الصيانة' }] },
  { prefix: '/trade-in', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'قسم الصيانة', to: '/maintenance' }, { label: 'شراء واستبدال الأجهزة' }] },

  // Inventory & Products
  { prefix: '/products/categories', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'أقسام الأصناف' }] },
  { prefix: '/products/new', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'إضافة صنف جديد' }] },
  { prefix: '/products', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'قائمة الأصناف' }] },
  { prefix: '/pricing-center', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'مركز التسعير' }] },
  { prefix: '/inventory/warehouses-management', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'أماكن المخزون' }] },
  { prefix: '/inventory/warehouses', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'أماكن المخزون' }] },
  { prefix: '/inventory/tree', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'شجرة المخازن الشاملة' }] },
  { prefix: '/inventory/issue-order/new', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'إذن صرف جديد' }] },
  { prefix: '/inventory/transfers', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'سجل أذونات الصرف والتحويلات' }] },
  { prefix: '/inventory/overview', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'نظرة عامة على المخزون' }] },
  { prefix: '/inventory/counts', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'جلسات الجرد' }] },
  { prefix: '/inventory/damaged', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'الأصناف التالفة' }] },
  { prefix: '/inventory/movements', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'سجل الحركات' }] },
  { prefix: '/inventory/locations', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'إدارة أماكن المخزون' }] },
  { prefix: '/inventory', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'جرد وحركات المخزون' }] },
  { prefix: '/services', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المخزون والأصناف', to: '/inventory' }, { label: 'الخدمات' }] },

  // Finance & Treasury & Accounting
  { prefix: '/treasury', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'الخزينة والبنوك' }] },
  { prefix: '/cash-drawer', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'درج النقدية والورديات' }] },
  { prefix: '/expenses', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'المصروفات' }] },
  { prefix: '/accounts', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'حسابات العملاء والموردين' }] },
  { prefix: '/accounting/accounts', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'شجرة الحسابات' }] },
  { prefix: '/accounting/journal-entries', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'القيود اليومية' }] },
  { prefix: '/accounting/financial-summary', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'الأرباح والملخص المالي' }] },
  { prefix: '/accounting/receivables-payables', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'المديونيات والمستحقات' }] },
  { prefix: '/accounting/inventory-value', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'تقييم المخزون' }] },
  { prefix: '/accounting/cash-movement', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'حركة النقدية' }] },
  { prefix: '/accounting/settings', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'إعدادات الحسابات' }] },
  { prefix: '/accounting/fixed-assets', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'الأصول الثابتة والإهلاك' }] },
  { prefix: '/accounting', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'المالية والمحاسبة', to: '/treasury' }, { label: 'المحاسبة العامة' }] },

  // Pharmacy
  { prefix: '/pharmacy/drugs', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الصيدلية والرعاية الدوائية', to: '/pharmacy' }, { label: 'دليل الأدوية والبدائل' }] },
  { prefix: '/pharmacy/prescriptions', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الصيدلية والرعاية الدوائية', to: '/pharmacy' }, { label: 'الروشتات والتأمين' }] },
  { prefix: '/pharmacy/shortages', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الصيدلية والرعاية الدوائية', to: '/pharmacy' }, { label: 'كشكول النواقص' }] },
  { prefix: '/pharmacy/batches-expiry', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الصيدلية والرعاية الدوائية', to: '/pharmacy' }, { label: 'التشغيلات والصلاحيات' }] },
  { prefix: '/pharmacy/clinical-services', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الصيدلية والرعاية الدوائية', to: '/pharmacy' }, { label: 'الخدمات الإكلينيكية' }] },
  { prefix: '/pharmacy', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الصيدلية والرعاية الدوائية', to: '/pharmacy' }, { label: 'لوحة تحكم الصيدلية' }] },

  // HR
  { prefix: '/hr/employees/new', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'إضافة موظف جديد' }] },
  { prefix: '/hr/employees', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'سجل الموظفين' }] },
  { prefix: '/hr/attendance', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'الحضور والانصراف' }] },
  { prefix: '/hr/payroll', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'المرتبات والمسيرات' }] },
  { prefix: '/hr/leaves', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'الإجازات' }] },
  { prefix: '/hr/loans', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'السلف والعهد المالية' }] },
  { prefix: '/hr/assets', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'العهد العينية والأصول' }] },
  { prefix: '/hr/documents', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'وثائق ومستندات' }] },
  { prefix: '/hr/reports', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'تقارير الموارد البشرية' }] },
  { prefix: '/hr/settings', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'إعدادات الموارد البشرية' }] },
  { prefix: '/hr', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الموارد البشرية', to: '/hr/employees' }, { label: 'نظرة عامة' }] },

  // Manufacturing
  { prefix: '/manufacturing/components', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التصنيع والإنتاج', to: '/manufacturing/components' }, { label: 'مكونات التصنيع' }] },
  { prefix: '/manufacturing/boms/new', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التصنيع والإنتاج', to: '/manufacturing/boms' }, { label: 'إنشاء تركيبة تصنيع' }] },
  { prefix: '/manufacturing/boms', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التصنيع والإنتاج', to: '/manufacturing/boms' }, { label: 'قوائم المكونات (BOM)' }] },
  { prefix: '/manufacturing/work-orders/new', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التصنيع والإنتاج', to: '/manufacturing/work-orders' }, { label: 'إنشاء أمر إنتاج' }] },
  { prefix: '/manufacturing/work-orders', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التصنيع والإنتاج', to: '/manufacturing/work-orders' }, { label: 'أوامر الإنتاج' }] },
  { prefix: '/manufacturing/settings', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التصنيع والإنتاج', to: '/manufacturing/settings' }, { label: 'إعدادات التصنيع' }] },
  { prefix: '/manufacturing', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التصنيع والإنتاج', to: '/manufacturing/components' }, { label: 'لوحة التصنيع' }] },

  // Import & Overseas
  { prefix: '/import-sales/shipments', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الاستيراد والشحن', to: '/import-sales/shipments' }, { label: 'إدارة الحاويات والشحن' }] },
  { prefix: '/import-sales/supplier-credit', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الاستيراد والشحن', to: '/import-sales/shipments' }, { label: 'مديونية الموردين' }] },
  { prefix: '/import-sales/profit-pool', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الاستيراد والشحن', to: '/import-sales/shipments' }, { label: 'أرباح الشركاء' }] },
  { prefix: '/import-sales', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الاستيراد والشحن', to: '/import-sales/shipments' }, { label: 'إدارة الشحن' }] },

  // Maritime & Logistics
  { prefix: '/maritime', exact: true, crumbs: [{ label: 'الشحن واللوجستيات' }] },
  { prefix: '/maritime-freight', exact: true, crumbs: [{ label: 'الشحن واللوجستيات' }] },

  // Contracting & Projects
  { prefix: '/contracting', exact: true, crumbs: [{ label: 'المقاولات والمشاريع' }] },

  // Reports & Audit
  { prefix: '/reports', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التقارير والمراجعة', to: '/reports' }, { label: 'مركز التقارير الشامل' }] },
  { prefix: '/audit', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'التقارير والمراجعة', to: '/reports' }, { label: 'سجل التدقيق والمراجعة' }] },

  // Settings & Profile
  { prefix: '/updates', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الإدارة والنظام' }, { label: 'تحديثات النظام' }] },
  { prefix: '/settings/system-updates', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الإعدادات', to: '/settings' }, { label: 'تحديثات النظام' }] },
  { prefix: '/settings', exact: true, crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الإعدادات', to: '/settings' }, { label: 'إعدادات النظام العامة' }] },
  { prefix: '/saas-admin/tenants', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'إدارة المنظومة', to: '/saas-admin/tenants' }, { label: 'إدارة النسخ والمستأجرين' }] },
  { prefix: '/saas-admin/plans', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'إدارة المنظومة', to: '/saas-admin/tenants' }, { label: 'باقات الاشتراك' }] },
  { prefix: '/saas-admin/offline-releases', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'إدارة المنظومة', to: '/saas-admin/tenants' }, { label: 'إدارة الإصدارات' }] },
  { prefix: '/saas-admin', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'إدارة المنظومة', to: '/saas-admin/tenants' }, { label: 'لوحة المنظومة' }] },
  { prefix: '/profile', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'الملف الشخصي والحساب' }] },
  { prefix: '/activate', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'تفعيل البرنامج والترخيص' }] },
  { prefix: '/setup', crumbs: [{ label: 'الرئيسية', to: '/' }, { label: 'معالج الإعداد الأولي' }] },
];

const MODULE_SECTION_NAMES: Record<string, { label: string; to: string }> = {
  sales: { label: 'المبيعات', to: '/sales' },
  displays: { label: 'المبيعات', to: '/sales' },
  purchases: { label: 'المشتريات والموردين', to: '/purchases' },
  inventory: { label: 'المخزون والأصناف', to: '/inventory' },
  products: { label: 'المخزون والأصناف', to: '/inventory' },
  treasury: { label: 'المالية والمحاسبة', to: '/treasury' },
  accounting: { label: 'المالية والمحاسبة', to: '/treasury' },
  maintenance: { label: 'قسم الصيانة', to: '/maintenance' },
  tradein: { label: 'قسم الصيانة', to: '/maintenance' },
  'trade-in': { label: 'قسم الصيانة', to: '/maintenance' },
  pharmacy: { label: 'الصيدلية والرعاية الدوائية', to: '/pharmacy' },
  hr: { label: 'الموارد البشرية', to: '/hr/employees' },
  manufacturing: { label: 'التصنيع والإنتاج', to: '/manufacturing/components' },
  maritime: { label: 'الشحن واللوجستيات', to: '/maritime' },
  'maritime-freight': { label: 'الشحن واللوجستيات', to: '/maritime' },
  contracting: { label: 'المقاولات والمشاريع', to: '/contracting' },
  'import-sales': { label: 'الاستيراد والشحن', to: '/import-sales/shipments' },
  reports: { label: 'التقارير والمراجعة', to: '/reports' },
  audit: { label: 'التقارير والمراجعة', to: '/reports' },
  settings: { label: 'الإعدادات', to: '/settings' },
  'saas-admin': { label: 'إدارة المنظومة', to: '/saas-admin/tenants' },
};

export function resolveAutoBreadcrumbs(pathname: string, customCrumbs: BreadcrumbItem[]): BreadcrumbItem[] {
  // If custom breadcrumbs are explicitly provided and not empty, enrich them with Home if missing
  if (customCrumbs && customCrumbs.length > 0) {
    if (customCrumbs[0].label !== 'الرئيسية' && pathname !== '/' && pathname !== '/dashboard' && !pathname.startsWith('/maritime') && !pathname.startsWith('/contracting')) {
      return [{ label: 'الرئيسية', to: '/' }, ...customCrumbs];
    }
    return customCrumbs;
  }

  // Exact match first
  const exactMatch = STATIC_ROUTE_RULES.find((rule) => rule.exact && rule.prefix === pathname);
  if (exactMatch) {
    return exactMatch.crumbs;
  }

  // Longest prefix match
  const prefixMatch = STATIC_ROUTE_RULES
    .filter((rule) => !rule.exact && pathname.startsWith(rule.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];

  if (prefixMatch) {
    return prefixMatch.crumbs;
  }

  // Intelligent Section Fallback from URL Segments
  const cleanPath = pathname.replace(/^\/+|\/+$/g, '');
  const segments = cleanPath.split('/');
  const rootSegment = segments[0] || '';

  if (MODULE_SECTION_NAMES[rootSegment]) {
    const mod = MODULE_SECTION_NAMES[rootSegment];
    return [{ label: 'الرئيسية', to: '/' }, { label: mod.label, to: mod.to }];
  }

  return [{ label: 'الرئيسية' }];
}
