import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { navigationItems } from '@/app/router/registry';
import { canAccessNavigationItem, getHrHomePath, isDesktopOfflineApp, isPlatformAdmin, tenantHasFeature } from '@/app/router/access';
import { getMaintenanceProfile } from '@/features/maintenance/constants/maintenance-profiles';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import type { AuthTenant, AuthUser } from '@/types/auth';
import type { AppSettings } from '@/types/domain';
import { contractingOrder, maritimeOrder, warehousingOrder, wholesaleVanOrder } from '@/shared/layout/app-shell/app-shell-navigation-orders-a';
import { importOrder, manufacturingOrder, servicesOrder, standardOrder } from '@/shared/layout/app-shell/app-shell-navigation-orders-b';

export type UseVisibleNavigationItemsParams = {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  settings: AppSettings | undefined;
  isEtaActive: boolean;
  totalOnlineOrdersCount: number;
};

export function useVisibleNavigationItems({
  user,
  tenant,
  settings,
  isEtaActive,
  totalOnlineOrdersCount,
}: UseVisibleNavigationItemsParams) {
  const { t } = useTranslation();

  return useMemo(() => {
    const currentVertical = resolveCurrentVertical(tenant, settings);
    const isContractingVertical = currentVertical === 'contracting';
    const isMaritimeVertical = currentVertical === 'maritime';
    const isRestaurantVertical = currentVertical === 'restaurant';
    const isPharmacyVertical = currentVertical === 'pharmacy';
    const isManufacturingVertical = currentVertical === 'manufacturing';
    const isElectronicsVertical = currentVertical === 'maintenance';
    const isServicesVertical = currentVertical === 'services';
    const isWholesaleVanVertical = currentVertical === 'wholesale_van';
    const isWarehousingVertical = currentVertical === 'warehousing';
    const isImportVertical = currentVertical === 'import_export';
    const isRetailOrMarketVertical = currentVertical === 'retail_general';

    const preferredOrder = isContractingVertical
      ? contractingOrder
      : isMaritimeVertical
      ? maritimeOrder
      : isManufacturingVertical
      ? manufacturingOrder
      : isImportVertical
      ? importOrder
      : isServicesVertical
      ? servicesOrder
      : isWholesaleVanVertical
      ? wholesaleVanOrder
      : isWarehousingVertical
      ? warehousingOrder
      : standardOrder;

    const maintenanceProfile = getMaintenanceProfile(settings?.maintenanceProfile);
    const labelOverrides: Record<string, string> = {
      dashboard: t('sidebar.dashboard', 'الرئيسية'),
      'cash-drawer': t('sidebar.cash-drawer', 'الوردية والدرج النقدي'),
      pos: t('sidebar.pos', 'نقطة البيع'),
      crm: t('sidebar.crm', 'إدارة علاقات العملاء (CRM)'),
      'sales-orders': t('sidebar.sales-orders', 'أوامر البيع وحجز المخزون'),
      'price-lists': t('sidebar.price-lists', 'قوائم الأسعار والشرائح'),
      sales: t('sidebar.sales', 'سجل الفواتير'),
      quotations: t('sidebar.quotations', 'عروض الأسعار'),
      'online-orders': t('sidebar.online-orders', 'طلبات الأونلاين'),
      returns: t('sidebar.returns', 'مرتجعات المبيعات'),
      customers: t('sidebar.customers', 'العملاء'),
      'delivery-reps': t('sidebar.delivery-reps', 'مناديب التوصيل والدليفري'),
      'van-sales-admin': t('sidebar.van-sales-admin', 'مبيعات وتوزيع الفان'),
      'tax-dispatcher': t('sidebar.tax-dispatcher', 'الفاتورة الإلكترونية'),
      installments: t('sidebar.installments', 'مبيعات التقسيط'),
      'vat-declaration': t('sidebar.vat-declaration', 'الإقرار الضريبي'),
      kds: t('sidebar.kds', 'شاشات المطبخ'),
      signage: t('sidebar.signage', 'شاشات العروض'),
      'purchases-orders': t('sidebar.purchases-orders', 'أوامر الشراء'),
      'purchases-rfqs': t('sidebar.purchases-rfqs', 'عروض الأسعار (RFQ)'),
      'purchases-reorder': t('sidebar.purchases-reorder', 'مقترح إعادة الطلب'),
      purchases: t('sidebar.purchases', 'فواتير المشتريات'),
      'purchases-new': t('sidebar.purchases-new', 'إنشاء فاتورة شراء'),
      'purchase-returns': t('sidebar.purchase-returns', 'مرتجعات المشتريات'),
      suppliers: t('sidebar.suppliers', 'الموردين'),
      products: t('sidebar.products', 'دليل الأصناف'),
      'product-new': t('sidebar.product-new', 'إضافة صنف جديد'),
      'product-categories': t('sidebar.product-categories', 'أقسام الأصناف'),
      'product-modifiers': t('sidebar.product-modifiers', 'خيارات الأصناف'),
      'pricing-center': t('sidebar.pricing-center', 'مركز التسعير'),
      'inventory-warehouses': t('sidebar.inventory-warehouses', 'المستودعات والفروع'),
      'inventory-bins': t('sidebar.inventory-bins', 'الأرفف والتخزين'),
      'inventory-tree': t('sidebar.inventory-tree', 'شجرة المخازن'),
      inventory: t('sidebar.inventory', 'جرد وتسويات المخزون'),
      'inventory-issue-orders': t('sidebar.inventory-issue-orders', 'أذونات الصرف والتحويل'),
      'inventory-issue-order-new': t('sidebar.inventory-issue-order-new', 'إذن صرف جديد'),
      services: t('sidebar.services', 'الخدمات'),
      treasury: t('sidebar.treasury', 'الخزينة والبنوك'),
      expenses: t('sidebar.expenses', 'المصروفات'),
      accounts: t('sidebar.accounts', 'أرصدة الحسابات'),
      'accounting-accounts': t('sidebar.accounting-accounts', 'شجرة الحسابات'),
      'accounting-cost-centers': t('sidebar.accounting-cost-centers', 'مراكز التكلفة'),
      'accounting-journal-entries': t('sidebar.accounting-journal-entries', 'القيود وسندات اليومية'),
      'accounting-payment-allocation': t('sidebar.accounting-payment-allocation', 'تسوية المدفوعات'),
      'accounting-bank-reconciliation': t('sidebar.accounting-bank-reconciliation', 'التسويات البنكية'),
      'accounting-cheques': t('sidebar.accounting-cheques', 'حافظة الشيكات'),
      'accounting-withholding-tax': t('sidebar.accounting-withholding-tax', 'الخصم والإضافة'),
      'accounting-balance-sheet': t('sidebar.accounting-balance-sheet', 'التقارير والقوائم المالية'),
      'accounting-cash-flow': t('sidebar.accounting-cash-flow', 'التدفقات النقدية'),
      'accounting-aged-debts': t('sidebar.accounting-aged-debts', 'أعمار الديون'),
      'accounting-fixed-assets': t('sidebar.accounting-fixed-assets', 'الأصول والإهلاك'),
      'accounting-settings': t('sidebar.accounting-settings', 'إعدادات الحسابات'),
      maintenance: t('sidebar.maintenance', 'تذاكر الصيانة'),
      'trade-in': t('sidebar.trade-in', 'شراء واستبدال الأجهزة'),
      'imei-history': t('sidebar.imei-history', maintenanceProfile.sidebarSerialLabel),
      'pharmacy-dashboard': t('sidebar.pharmacy-dashboard', 'لوحة تحكم الصيدلية'),
      'pharmacy-drugs': t('sidebar.pharmacy-drugs', 'دليل الأدوية والبدائل'),
      'pharmacy-prescriptions': t('sidebar.pharmacy-prescriptions', 'الروشتات والتأمين'),
      'pharmacy-shortages': t('sidebar.pharmacy-shortages', 'كشكول النواقص'),
      'pharmacy-batches': t('sidebar.pharmacy-batches', 'الصلاحيات والمرتجعات'),
      'pharmacy-clinical': t('sidebar.pharmacy-clinical', 'الفحوصات والخدمات'),
      'import-command-center': t('sidebar.import-command-center', 'مركز قيادة الاستيراد'),
      'import-projects': t('sidebar.import-projects', 'مشاريع الاستيراد والجدوى'),
      'import-china-sourcing': t('sidebar.import-china-sourcing', 'توريد ومصانع الصين'),
      'import-fx-treasury': t('sidebar.import-fx-treasury', 'خزينة العملات الأجنبية'),
      'import-supplier-credit': t('sidebar.import-supplier-credit', 'حوالات وسداد الموردين'),
      'import-compliance': t('sidebar.import-compliance', 'الجمارك ومنظومة ACI'),
      'import-shipments': t('sidebar.import-shipments', 'إدارة الشحنات والحاويات'),
      'import-customs-brokers': t('sidebar.import-customs-brokers', 'المخلصون والعهد الجمركية'),
      'import-container-deposits': t('sidebar.import-container-deposits', 'تأمينات وغرامات الحاويات'),
      'import-approvals': t('sidebar.import-approvals', 'اعتمادات الاستيراد والحوكمة'),
      'import-reconciliation': t('sidebar.import-reconciliation', 'مطابقة وتسوية الاستيراد'),
      'import-profit-pool': t('sidebar.import-profit-pool', 'أرباح الشركاء والإقفال'),
      'manufacturing-components': t('sidebar.manufacturing-components', 'مكونات التصنيع'),
      'manufacturing-work-orders': t('sidebar.manufacturing-work-orders', 'أوامر الإنتاج'),
      'manufacturing-boms': t('sidebar.manufacturing-boms', 'قوائم المكونات'),
      'manufacturing-work-centers': t('sidebar.manufacturing-work-centers', 'مراكز العمل والماكينات'),
      'manufacturing-settings': t('sidebar.manufacturing-settings', 'إعدادات التصنيع'),
      'maritime-inquiries': t('sidebar.maritime-inquiries', 'استفسارات الشحن'),
      'maritime-rfqs': t('sidebar.maritime-rfqs', 'عروض تسعير الخطوط'),
      'maritime-matrix': t('sidebar.maritime-matrix', 'مقارنة عروض الخطوط'),
      'maritime-quotations': t('sidebar.maritime-quotations', 'عروض أسعار العملاء'),
      'maritime-jobs': t('sidebar.maritime-jobs', 'أوامر تشغيل الشحنات'),
      'maritime-radar': t('sidebar.maritime-radar', 'رادار الغرامات وفترات السماح'),
      'maritime-audit': t('sidebar.maritime-audit', 'تدقيق فواتير النواقل'),
      'maritime-agents': t('sidebar.maritime-agents', 'مقاصة الوكلاء (SOA)'),
      'maritime-trucking': t('sidebar.maritime-trucking', 'النقل البري والترحيل'),
      'maritime-containers': t('sidebar.maritime-containers', 'تتبع الحاويات والطرود'),
      'maritime-lines': t('sidebar.maritime-lines', 'دليل النواقل والموانئ والمطارات'),
      'maritime-portal': t('sidebar.maritime-portal', 'بوابة عملاء الشحن (B2B)'),
      'maritime-settings': t('sidebar.maritime-settings', 'إعدادات وسياسات الشحن'),
      'contracting-projects': t('sidebar.contracting-projects', 'سجل المشاريع'),
      'contracting-boq': t('sidebar.contracting-boq', 'جداول الكميات'),
      'contracting-change-orders': t('sidebar.contracting-change-orders', 'الأوامر التغييرية'),
      'contracting-invoices': t('sidebar.contracting-invoices', 'المستخلصات'),
      'contracting-financials': t('sidebar.contracting-financials', 'المالية والمستخلصات'),
      'contracting-procurement': t('sidebar.contracting-procurement', 'مقاولو الباطن والتوريد'),
      'contracting-field': t('sidebar.contracting-field', 'الميدان والجدول الزمني'),
      'contracting-master-boq': t('sidebar.contracting-master-boq', 'بنك بنود المقاولات'),
      'contracting-subcontracts': t('sidebar.contracting-subcontracts', 'عقود مقاولي الباطن'),
      'contracting-daily-logs': t('sidebar.contracting-daily-logs', 'اليوميات الميدانية'),
      'contracting-rfis': t('sidebar.contracting-rfis', 'استفسارات الموقع'),
      'reports-overview': t('sidebar.reports-overview', 'ملخص الأداء'),
      'reports-sales': t('sidebar.reports-sales', 'تقارير المبيعات'),
      'reports-purchases': t('sidebar.reports-purchases', 'تقارير المشتريات'),
      'reports-inventory': t('sidebar.reports-inventory', 'تقارير المخزون'),
      'reports-treasury': t('sidebar.reports-treasury', 'الخزينة والمصروفات'),
      'reports-balances': t('sidebar.reports-balances', 'أرصدة الحسابات'),
      'reports-employees': t('sidebar.reports-employees', 'تقارير الموظفين'),
      hr: t('sidebar.hr', 'الموارد البشرية'),
      'hr-settlements': t('sidebar.hr-settlements', 'مخالصات نهاية الخدمة'),
      audit: t('sidebar.audit', 'سجل النشاط'),
      apps: t('sidebar.apps', 'متجر التطبيقات'),
      settings: t('sidebar.settings', 'الإعدادات العامة'),
      'saas-admin-tenants': t('sidebar.saas-admin-tenants', 'إدارة المشتركين'),
      'saas-admin-plans': t('sidebar.saas-admin-plans', 'باقات الاشتراكات'),
    };
    if (isMaritimeVertical) {
      labelOverrides['customers'] = t('sidebar.maritime-customers', 'الشاحنون والمستوردون');
      labelOverrides['suppliers'] = t('sidebar.maritime-suppliers', 'النواقل ومقدمو الخدمات');
    }
    if (isWholesaleVanVertical) {
      labelOverrides['delivery-reps'] = t('sidebar.delivery-reps', 'مناديب التوصيل والدليفري');
      labelOverrides['van-sales-admin'] = t('sidebar.van-fleet', 'مبيعات وتوزيع الفان');
      labelOverrides['sales'] = t('sidebar.van-sales', 'فواتير المبيعات والتوزيع');
      labelOverrides['returns'] = t('sidebar.van-returns', 'مرتجعات التوزيع');
      labelOverrides['inventory-warehouses'] = t('sidebar.van-warehouses', 'المستودعات وسيارات الفان');
      labelOverrides['inventory-issue-orders'] = t('sidebar.van-issue', 'تحويل وصرف سيارات الفان');
    }
    const isPlatformAdminUser = isPlatformAdmin(user);
    const isEnterpriseCommerceActive = isContractingVertical || isMaritimeVertical || isManufacturingVertical || isImportVertical || settings?.enableEnterpriseFeatures === true || Boolean(tenant?.features?.includes('accounting'));

    const hasFeature = (feat: string) => {
      if (isPlatformAdminUser) return true;
      if (feat === 'import' && (isImportVertical || settings?.importModuleEnabled === true)) return true;

      if (feat === 'deliveryReps') return tenantHasFeature('deliveryReps', tenant, user);
      // 1. Strict Plan-Tier Entitlement: if tenant has an explicit features payload from the active plan
      if (Array.isArray(tenant?.features) && tenant.features.length > 0 && !isImportVertical) {
        if (['catalog', 'products', 'sales'].includes(feat)) return true;
        return tenant.features.includes(feat);
      }

      // 2. Fallback & Dedicated Vertical Suite Entitlements:
      if (isContractingVertical) {
        const contractingSuiteFeatures = ['contracting', 'crm', 'purchases', 'inventory', 'products', 'suppliers', 'customers', 'accounting', 'hr', 'fixed_assets', 'vat_declaration', 'reports', 'approvals', 'treasury'];
        if (contractingSuiteFeatures.includes(feat)) return true;
      }
      if (isMaritimeVertical) {
        const maritimeSuiteFeatures = ['maritime_freight', 'crm', 'purchases', 'sales', 'suppliers', 'customers', 'accounting', 'hr', 'vat_declaration', 'reports', 'approvals', 'treasury'];
        if (maritimeSuiteFeatures.includes(feat)) return true;
      }
      if (isManufacturingVertical) {
        const manufacturingSuiteFeatures = ['manufacturing', 'crm', 'purchases', 'inventory', 'products', 'suppliers', 'customers', 'sales', 'pricing', 'accounting', 'hr', 'fixed_assets', 'vat_declaration', 'reports', 'approvals', 'treasury'];
        if (manufacturingSuiteFeatures.includes(feat)) return true;
      }
      if (isImportVertical) {
        const importSuiteFeatures = ['import', 'crm', 'purchases', 'inventory', 'products', 'catalog', 'suppliers', 'customers', 'sales', 'pricing', 'accounting', 'hr', 'fixed_assets', 'vat_declaration', 'reports', 'approvals', 'treasury', 'expenses'];
        if (importSuiteFeatures.includes(feat)) return true;
      }
      if (isWholesaleVanVertical) {
        const wholesaleVanSuiteFeatures = ['deliveryReps', 'sales', 'inventory', 'products', 'catalog', 'purchases', 'suppliers', 'customers', 'treasury', 'expenses', 'reports', 'pricing', 'installments'];
        if (wholesaleVanSuiteFeatures.includes(feat)) return true;
      }
      if (isWarehousingVertical) {
        const warehousingSuiteFeatures = ['inventory', 'products', 'catalog', 'purchases', 'suppliers', 'sales', 'customers', 'treasury', 'expenses', 'reports', 'pricing'];
        if (warehousingSuiteFeatures.includes(feat)) return true;
      }
      if (isRetailOrMarketVertical || isRestaurantVertical || isPharmacyVertical || isElectronicsVertical || (!isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isServicesVertical && !isWarehousingVertical)) {
        const commerceRetailSuiteFeatures = ['pos', 'sales', 'inventory', 'products', 'catalog', 'purchases', 'suppliers', 'customers', 'treasury', 'expenses', 'reports', 'pricing', 'installments'];
        if (isEnterpriseCommerceActive) {
          commerceRetailSuiteFeatures.push('accounting', 'crm');
        }
        if (commerceRetailSuiteFeatures.includes(feat)) return true;
      }
      return Boolean(tenant?.features?.includes(feat));
    };

    return navigationItems
      .filter((item) => {
        if (!user || !canAccessNavigationItem(user, item)) return false;
        if (isDesktopOfflineApp() && (item.key === 'saas-admin-tenants' || item.key === 'saas-admin-plans' || item.key?.startsWith('saas-admin'))) return false;
        if (item.key === 'tax-dispatcher' && !isEtaActive) return false;

        // Strict bidirectional vertical isolation:
        if (isContractingVertical) {
          if (['pos', 'cash-drawer', 'kds', 'displays', 'signage', 'product-modifiers', 'delivery-reps', 'trade-in', 'imei-history', 'maintenance', 'sales', 'returns', 'sales-orders', 'price-lists'].includes(item.key)) return false;
          if (item.key?.startsWith('maritime-') || item.key === 'maritime' || item.key === 'maritime-freight' || item.key?.startsWith('pharmacy-') || item.key?.startsWith('manufacturing-') || (item.key?.startsWith('import-') && settings?.importModuleEnabled !== true)) return false;
        }

        if (isMaritimeVertical) {
          const maritimeDisallowed = [
            'pos',
            'cash-drawer',
            'kds',
            'displays',
            'signage',
            'product-modifiers',
            'delivery-reps',
            'trade-in',
            'imei-history',
            'maintenance',
            'sales',
            'sales-orders',
            'returns',
            'price-lists',
            'quotations',
            'purchases-rfqs',
            'purchases-orders',
            'purchases-reorder',
            'purchases',
            'purchases-new',
            'purchase-returns',
            'reports-sales',
            'reports-purchases',
            'installments',
          ];
          if (settings?.inventoryModuleEnabled !== true) {
            maritimeDisallowed.push('pricing-center', 'products', 'product-categories', 'inventory', 'inventory-warehouses', 'inventory-bins', 'inventory-tree', 'inventory-issue-orders', 'inventory-issue-order-new', 'reports-inventory');
          }
          if (maritimeDisallowed.includes(item.key)) return false;
          if (item.key?.startsWith('contracting-') || item.key === 'contracting' || item.key?.startsWith('pharmacy-') || item.key?.startsWith('manufacturing-') || (item.key?.startsWith('import-') && settings?.importModuleEnabled !== true)) return false;
        }

        if (isRetailOrMarketVertical) {
          if ((item.key?.startsWith('contracting-') && settings?.contractingModuleEnabled !== true) || (item.key?.startsWith('maritime-') && settings?.maritimeFreightModuleEnabled !== true) || item.key?.startsWith('pharmacy-') || item.key === 'maintenance' || item.key === 'trade-in' || item.key === 'imei-history' || (item.key?.startsWith('import-') && settings?.importModuleEnabled !== true)) return false;
        }

        if (isRestaurantVertical) {
          if ((item.key?.startsWith('contracting-') && settings?.contractingModuleEnabled !== true) || (item.key?.startsWith('maritime-') && settings?.maritimeFreightModuleEnabled !== true) || item.key?.startsWith('pharmacy-') || item.key === 'maintenance' || item.key === 'trade-in' || item.key === 'imei-history' || (item.key?.startsWith('import-') && settings?.importModuleEnabled !== true)) return false;
        }

        if (isPharmacyVertical) {
          if ((item.key?.startsWith('contracting-') && settings?.contractingModuleEnabled !== true) || (item.key?.startsWith('maritime-') && settings?.maritimeFreightModuleEnabled !== true) || item.key === 'kds' || item.key === 'displays' || item.key === 'signage' || item.key === 'maintenance' || item.key === 'trade-in' || item.key === 'imei-history' || (item.key?.startsWith('import-') && settings?.importModuleEnabled !== true)) return false;
        }

        if (isElectronicsVertical) {
          if ((item.key?.startsWith('contracting-') && settings?.contractingModuleEnabled !== true) || (item.key?.startsWith('maritime-') && settings?.maritimeFreightModuleEnabled !== true) || item.key?.startsWith('pharmacy-') || item.key === 'kds' || item.key === 'displays' || item.key === 'signage' || (item.key?.startsWith('import-') && settings?.importModuleEnabled !== true)) return false;
        }

        if (isManufacturingVertical) {
          if (['pos', 'cash-drawer', 'kds', 'displays', 'signage', 'product-modifiers', 'delivery-reps', 'trade-in', 'imei-history', 'maintenance', 'clothing'].includes(item.key)) return false;
          if ((item.key?.startsWith('contracting-') && settings?.contractingModuleEnabled !== true) || (item.key?.startsWith('maritime-') && settings?.maritimeFreightModuleEnabled !== true) || item.key?.startsWith('pharmacy-') || (item.key?.startsWith('import-') && settings?.importModuleEnabled !== true)) return false;
        }

        if (isImportVertical) {
          if (['kds', 'displays', 'signage', 'product-modifiers', 'delivery-reps', 'trade-in', 'imei-history', 'maintenance'].includes(item.key)) return false;
          if ((item.key?.startsWith('contracting-') && settings?.contractingModuleEnabled !== true) || (item.key?.startsWith('maritime-') && settings?.maritimeFreightModuleEnabled !== true) || item.key?.startsWith('pharmacy-') || item.key?.startsWith('manufacturing-')) return false;
        }

        if (isServicesVertical) {
          if (['pos', 'cash-drawer', 'kds', 'displays', 'signage', 'product-modifiers', 'products', 'product-categories', 'inventory', 'inventory-warehouses', 'inventory-bins', 'inventory-tree', 'inventory-issue-orders', 'inventory-issue-order-new', 'reports-inventory', 'delivery-reps', 'trade-in', 'imei-history', 'maintenance', 'purchases-reorder'].includes(item.key)) return false;
          if ((item.key?.startsWith('contracting-') && settings?.contractingModuleEnabled !== true) || (item.key?.startsWith('maritime-') && settings?.maritimeFreightModuleEnabled !== true) || item.key?.startsWith('pharmacy-') || item.key?.startsWith('manufacturing-') || (item.key?.startsWith('import-') && settings?.importModuleEnabled !== true)) return false;
        }

        if (isWholesaleVanVertical) {
          if (['pos', 'cash-drawer', 'kds', 'displays', 'signage', 'product-modifiers', 'trade-in', 'imei-history', 'maintenance', 'clothing'].includes(item.key)) return false;
          if (item.key?.startsWith('contracting-') || item.key === 'contracting' || item.key?.startsWith('maritime-') || item.key === 'maritime' || item.key?.startsWith('pharmacy-') || item.key?.startsWith('manufacturing-') || (item.key?.startsWith('import-') && settings?.importModuleEnabled !== true)) return false;
        }

        if (isWarehousingVertical) {
          if (['pos', 'cash-drawer', 'kds', 'displays', 'signage', 'product-modifiers', 'trade-in', 'imei-history', 'maintenance', 'clothing', 'delivery-reps', 'van-sales-admin'].includes(item.key)) return false;
          if (item.key?.startsWith('contracting-') || item.key === 'contracting' || item.key?.startsWith('maritime-') || item.key === 'maritime' || item.key?.startsWith('pharmacy-') || item.key?.startsWith('manufacturing-') || (item.key?.startsWith('import-') && settings?.importModuleEnabled !== true)) return false;
        }

        // Feature & Setting gating:
        if (item.key?.startsWith('import-') && !isImportVertical && (settings?.importModuleEnabled !== true || !hasFeature('import'))) return false;
        if ((item.key === 'maintenance' || item.key === 'trade-in' || item.key === 'imei-history') && (settings?.enableMobileStoreFeatures !== true || !hasFeature('maintenance'))) return false;
        if (item.key?.startsWith('pharmacy-') && (settings?.enablePharmacyModule !== true || !hasFeature('pharmacy'))) return false;
        if (item.key?.startsWith('manufacturing-') && (settings?.manufacturingModuleEnabled !== true || !hasFeature('manufacturing'))) return false;
        if (item.key === 'services' && (settings?.servicesModuleEnabled !== true || (!hasFeature('purchases') && !hasFeature('services')))) return false;
        // INV-STOREFRONT-ORDERS: /online-orders route stays reachable directly (vertical + 'sales' permission)
        // without requiring the Storefront feature on the route itself, while the sidebar menu entry is shown
        // only if the tenant is entitled to 'storefront' OR already has recorded online orders in the database.
        if (item.key === 'online-orders' && !hasFeature('storefront') && totalOnlineOrdersCount <= 0) return false;
        if (item.key === 'installments' && (!hasFeature('installments') || settings?.installmentsModuleEnabled === false)) return false;
        if (item.key === 'vat-declaration' && !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isImportVertical && (!hasFeature('vat_declaration') || settings?.taxDeclarationModuleEnabled === false)) return false;
        // Delivery Reps (Retail / Stores / Last-Mile Courier):
        const isDeliveryRepsEnabled = Boolean(
          settings?.deliveryRepsModuleEnabled !== false &&
          (settings?.deliveryRepsModuleEnabled === true || settings?.deliveryFleetModuleEnabled === true || hasFeature('deliveryReps'))
        );
        if (item.key === 'delivery-reps' && (!isDeliveryRepsEnabled || !hasFeature('deliveryReps'))) return false;

        // Van Sales & Field Fleet (Wholesale / FMCG Distribution):
        const isVanSalesEnabled = Boolean(
          settings?.vanSalesModuleEnabled === true ||
          isWholesaleVanVertical ||
          (settings?.deliveryFleetModuleEnabled === true && isWholesaleVanVertical)
        );
        if (item.key === 'van-sales-admin' && (!isVanSalesEnabled || (!hasFeature('deliveryReps') && !isWholesaleVanVertical))) return false;
        if (item.key === 'kds' && (settings?.restaurantModuleEnabled !== true || !hasFeature('restaurant'))) return false;
        if (item.key === 'product-modifiers' && (settings?.restaurantModuleEnabled !== true || !hasFeature('restaurant'))) return false;
        // kds and signage are accessed via /displays portal - hide them as direct sidebar items
        if (item.key === 'kds' || item.key === 'signage') return false;
        // displays portal: only visible when restaurant module is enabled and plan includes restaurant
        if (item.key === 'displays' && (settings?.restaurantModuleEnabled !== true || !hasFeature('restaurant'))) return false;
        // POS & Retail Sales gating:
        // P10 (INV-VAN-GENERAL-FEATURE-OVERRIDES): a super-admin override
        // grant (visible in tenant.features, which the backend builds
        // override-aware) opens the item even where the module switch is
        // off or the vertical blocks it; without a grant the old rules
        // stand. The direct features check (not hasFeature) keeps the
        // platform-admin bypass out of this gate.
        if (item.key === 'pos' && (settings?.posModuleEnabled === false || isWholesaleVanVertical || isWarehousingVertical) && !tenant?.features?.includes('pos')) return false;
        if (item.key === 'cash-drawer' && (settings?.posModuleEnabled === false || isWholesaleVanVertical || isWarehousingVertical) && !tenant?.features?.includes('cashDrawer')) return false;
        if ((item.key === 'sales' || item.key === 'returns') && settings?.posModuleEnabled === false && !isWholesaleVanVertical && !isWarehousingVertical && !isImportVertical && !isEnterpriseCommerceActive) return false;
        if (item.key === 'customers' && settings?.posModuleEnabled === false && !isEnterpriseCommerceActive && settings?.installmentsModuleEnabled === false && !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isImportVertical && !isWholesaleVanVertical && !isWarehousingVertical) return false;

        // Enterprise Sales gating (CRM, Sales Orders, Price Lists, Quotations):
        if (item.key === 'crm' && !isMaritimeVertical && !isContractingVertical && !isImportVertical && !isManufacturingVertical && !isServicesVertical && (!isEnterpriseCommerceActive || settings?.crmModuleEnabled !== true)) return false;
        if ((item.key === 'sales-orders' || item.key === 'quotations') && !isMaritimeVertical && !isContractingVertical && !isManufacturingVertical && !isImportVertical && !isWarehousingVertical && !isEnterpriseCommerceActive) return false;
        // INV-VAN-PRICE-LIST-WIRING (F8): price lists are a wholesale/
        // van core need (a named list per customer drives the field
        // price), not an enterprise extra — the trial on test10k
        // found "no price list exists anywhere" only because this
        // gate hid the sidebar entry for wholesale_van tenants
        // (the route itself is 'catalog'-gated and reachable, and
        // the customer form already offers the assignment). Van
        // tenants keep the gate off sales-orders/quotations above.
        if (item.key === 'price-lists' && !isMaritimeVertical && !isContractingVertical && !isManufacturingVertical && !isImportVertical && !isWarehousingVertical && !isWholesaleVanVertical && !isEnterpriseCommerceActive) return false;

        // Purchases gating:
        if ((item.key === 'purchases-orders' || item.key === 'purchases-rfqs' || item.key === 'purchases-reorder') && !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isImportVertical && !isWarehousingVertical && (!isEnterpriseCommerceActive || settings?.purchasesModuleEnabled === false || (!hasFeature('purchases') && settings?.purchasesModuleEnabled !== true))) return false;
        if ((item.key === 'purchases-new' || item.key === 'purchases' || item.key === 'purchase-returns' || item.key === 'suppliers' || item.key === 'reports-purchases') && !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isImportVertical && !isWarehousingVertical && (settings?.purchasesModuleEnabled === false || (settings?.purchasesModuleEnabled !== true && !hasFeature('purchases')))) return false;

        // Inventory warehouse-specific gating:
        if ((item.key === 'inventory-tree' || item.key === 'inventory-bins' || item.key === 'inventory-issue-orders' || item.key === 'inventory-issue-order-new') && !isContractingVertical && !isManufacturingVertical && !isImportVertical && !isWarehousingVertical && !isEnterpriseCommerceActive) return false;
        if ((item.key === 'inventory' || item.key === 'inventory-warehouses' || item.key === 'reports-inventory') && !isContractingVertical && !isManufacturingVertical && !isImportVertical && !isWarehousingVertical && (settings?.inventoryModuleEnabled === false || (!hasFeature('inventory') && settings?.inventoryModuleEnabled !== true))) return false;

        // Products catalog gating (products, product-new, product-categories, pricing-center):
        if ((item.key === 'products' || item.key === 'product-new' || item.key === 'product-categories' || item.key === 'pricing-center') && !isContractingVertical && !isManufacturingVertical && !isImportVertical && !isRetailOrMarketVertical && !isRestaurantVertical && !isPharmacyVertical && !isElectronicsVertical && !isWarehousingVertical && !hasFeature('catalog') && !hasFeature('products') && !hasFeature('inventory')) return false;

        // Reports & Dashboard gating:
        if ((item.key?.startsWith('reports-') || item.key === 'audit' || item.key === 'dashboard' || item.key === 'owner-companion' || item.key === 'owner-mobile') && !isImportVertical && !hasFeature('reports')) return false;
        if (item.key === 'reports-balances' && !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isImportVertical && !isEnterpriseCommerceActive) return false;

        // HR gating:
        if ((item.key === 'hr' || item.key === 'hr-settlements' || item.key === 'reports-employees') && !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isImportVertical && (!hasFeature('hr') || settings?.hrModuleEnabled === false)) return false;

        // Accounting tree & journal gating:
        if ((item.key?.startsWith('accounting-') || item.key === 'accounts') && !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isImportVertical && (!isEnterpriseCommerceActive || !hasFeature('accounting'))) return false;

        // Maritime Freight gating:
        if (item.key?.startsWith('maritime-') && !isMaritimeVertical && (settings?.maritimeFreightModuleEnabled !== true || !hasFeature('maritime_freight'))) return false;

        // Contracting & Construction gating:
        if (item.key?.startsWith('contracting-') && !isContractingVertical && (settings?.contractingModuleEnabled !== true || !hasFeature('contracting'))) return false;

        return true;
      })
      .map((item) => ({ ...item, to: item.key === 'hr' ? getHrHomePath(user) : item.to, label: labelOverrides[item.key] || t(`sidebar.${item.key}`, item.label) }))
      .sort((a, b) => {
        const aIndex = preferredOrder.indexOf(a.key);
        const bIndex = preferredOrder.indexOf(b.key);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      });
  }, [user, tenant?.features, tenant?.activityType, tenant?.pillar, t, isEtaActive, totalOnlineOrdersCount, settings?.activityType, settings?.businessIndustry, settings?.posModuleEnabled, settings?.importModuleEnabled, settings?.enableMobileStoreFeatures, settings?.maintenanceProfile, settings?.enablePharmacyModule, settings?.manufacturingModuleEnabled, settings?.servicesModuleEnabled, settings?.storefrontModuleEnabled, settings?.installmentsModuleEnabled, settings?.fixedAssetsModuleEnabled, settings?.taxDeclarationModuleEnabled, settings?.deliveryFleetModuleEnabled, settings?.deliveryRepsModuleEnabled, settings?.vanSalesModuleEnabled, settings?.purchasesModuleEnabled, settings?.inventoryModuleEnabled, settings?.hrModuleEnabled, settings?.enableEnterpriseFeatures, settings?.restaurantModuleEnabled, settings?.maritimeFreightModuleEnabled, settings?.contractingModuleEnabled]);
}
