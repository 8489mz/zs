import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getMaintenanceProfile } from '@/features/maintenance/constants/maintenance-profiles';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import { isPlatformAdmin } from '@/app/router/access';
import type { AuthTenant, AuthUser } from '@/types/auth';
import type { AppSettings } from '@/types/domain';
import type { SidebarGroupDefinition } from '@/shared/layout/app-shell/app-shell-types';

export type UseSidebarGroupsParams = {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  settings: AppSettings | undefined;
};

export function useSidebarGroups({ user, tenant, settings }: UseSidebarGroupsParams): SidebarGroupDefinition[] {
  const { t } = useTranslation();
  return useMemo<SidebarGroupDefinition[]>(() => {
    const isPlatformAdminUser = isPlatformAdmin(user);
    const maintenanceProfile = getMaintenanceProfile(settings?.maintenanceProfile);

    const currentVertical = resolveCurrentVertical(tenant, settings);
    const isDedicatedContractingOnly = currentVertical === 'contracting';
    const isDedicatedMaritimeOnly = currentVertical === 'maritime';
    const isDedicatedManufacturingOnly = currentVertical === 'manufacturing';
    const isDedicatedImportOnly = currentVertical === 'import_export';
    const isDedicatedServicesOnly = currentVertical === 'services';
    const isDedicatedWarehousingOnly = currentVertical === 'warehousing';
    const isWholesaleVanVertical = currentVertical === 'wholesale_van';
    const isRestaurantVertical = currentVertical === 'restaurant';
    const isPharmacyVertical = currentVertical === 'pharmacy';
    const isElectronicsVertical = currentVertical === 'maintenance';
    const isRetailOrMarketVertical = currentVertical === 'retail_general';

    const isContractingVertical = isDedicatedContractingOnly;
    const isMaritimeVertical = isDedicatedMaritimeOnly;
    const isManufacturingVertical = isDedicatedManufacturingOnly;

    const isEnterpriseCommerceActive = isDedicatedContractingOnly || isDedicatedMaritimeOnly || isDedicatedManufacturingOnly || isDedicatedImportOnly || settings?.enableEnterpriseFeatures === true || Boolean(tenant?.features?.includes('accounting'));
    const hasAccounting = isPlatformAdminUser || isDedicatedContractingOnly || isDedicatedMaritimeOnly || isDedicatedManufacturingOnly || isDedicatedImportOnly || (isEnterpriseCommerceActive && Boolean(tenant?.features?.includes('accounting')));
    const hasRestaurant = isPlatformAdminUser || Boolean(tenant?.features?.includes('restaurant'));
    const hasMaritimeFreight = isPlatformAdminUser || isDedicatedMaritimeOnly || Boolean(tenant?.features?.includes('maritime_freight'));
    const hasContracting = isPlatformAdminUser || isDedicatedContractingOnly || Boolean(tenant?.features?.includes('contracting'));
    const hasManufacturing = isPlatformAdminUser || isDedicatedManufacturingOnly || Boolean(tenant?.features?.includes('manufacturing'));
    const hasImport = isPlatformAdminUser || isDedicatedImportOnly || settings?.importModuleEnabled === true || Boolean(tenant?.features?.includes('import'));
    const hasInventory = isPlatformAdminUser || isDedicatedContractingOnly || isDedicatedManufacturingOnly || isDedicatedImportOnly || isRetailOrMarketVertical || isRestaurantVertical || isPharmacyVertical || isElectronicsVertical || Boolean(tenant?.features?.includes('inventory')) || Boolean(tenant?.features?.includes('catalog')) || Boolean(tenant?.features?.includes('products'));
    const hasPurchases = isPlatformAdminUser || isDedicatedContractingOnly || isDedicatedMaritimeOnly || isDedicatedManufacturingOnly || isDedicatedImportOnly || isRetailOrMarketVertical || isRestaurantVertical || isPharmacyVertical || isElectronicsVertical || Boolean(tenant?.features?.includes('purchases'));

    // 1. Dedicated Contracting Enterprise Workspace
    if (isDedicatedContractingOnly) {
      return [
        {
          key: 'contracting-group',
          label: 'المقاولات والمشاريع',
          itemKeys: ['contracting-projects', 'contracting-boq', 'contracting-financials', 'contracting-procurement', 'contracting-field', 'contracting-master-boq'],
          iconKey: 'contracting',
        },
        {
          key: 'crm-group',
          label: 'العملاء والصفقات',
          itemKeys: ['crm', 'quotations', 'customers'],
          iconKey: 'crm',
        },
        {
          key: 'purchases-group',
          label: 'المشتريات والتوريد',
          itemKeys: ['purchases', 'purchases-orders', 'suppliers'],
          iconKey: 'purchases',
        },
        {
          key: 'contracting-inventory-group',
          label: 'المخازن والمستودعات',
          itemKeys: ['products', 'product-categories', 'inventory-issue-orders', 'inventory-warehouses', 'inventory'],
          iconKey: 'inventory',
        },
        {
          key: 'accounting-group',
          label: 'المالية والمحاسبة',
          itemKeys: ['accounting-journal-entries', 'accounting-accounts', 'accounting-cost-centers', 'treasury', 'expenses', 'accounting-balance-sheet', 'accounting-fixed-assets'],
          iconKey: 'treasury',
        },
        {
          key: 'hr-group',
          label: 'الموارد البشرية',
          itemKeys: ['hr'],
          iconKey: 'users',
        },
        {
          key: 'reports-group',
          label: 'تقارير المشاريع',
          itemKeys: ['reports-overview', 'reports-purchases', 'reports-inventory', 'reports-treasury', 'reports-balances', 'reports-employees'],
          iconKey: 'reports',
        },
        ...(isPlatformAdminUser ? [{
          key: 'saas-group',
          label: 'إدارة المنصة والساس',
          itemKeys: ['saas-admin-tenants', 'saas-admin-plans'],
          iconKey: 'saas-admin-tenants',
        }] : []),
        {
          key: 'admin-group',
          label: t('sidebar.admin-group', 'الإدارة والنظام'),
          itemKeys: ['audit', 'settings', 'updates'],
          iconKey: 'admin',
        },
      ];
    }

    // 2. Dedicated Maritime Freight Enterprise Workspace
    if (isDedicatedMaritimeOnly) {
      return [
        {
          key: 'maritime-group',
          label: 'الشحن واللوجستيات',
          itemKeys: [
            'maritime-inquiries',
            'maritime-rfqs',
            'maritime-matrix',
            'maritime-quotations',
            'maritime-jobs',
            'maritime-radar',
            'maritime-audit',
            'maritime-agents',
            'maritime-trucking',
            'maritime-containers',
            'maritime-lines',
            'maritime-portal',
            'maritime-settings',
          ],
          iconKey: 'ship',
        },
        {
          key: 'customers-group',
          label: 'الشاحنون والعملاء',
          itemKeys: ['customers', 'crm'],
          iconKey: 'users',
        },
        {
          key: 'carriers-group',
          label: 'النواقل ومقدمو الخدمات',
          itemKeys: ['suppliers'],
          iconKey: 'purchases',
        },
        ...(settings?.inventoryModuleEnabled ? [{
          key: 'inventory-group',
          label: 'المستودعات والمخازن',
          itemKeys: ['products', 'product-categories', 'inventory-issue-orders', 'inventory-warehouses', 'inventory'],
          iconKey: 'inventory',
        }] : []),
        {
          key: 'accounting-group',
          label: 'المالية والمحاسبة',
          itemKeys: ['accounting-journal-entries', 'accounting-accounts', 'treasury', 'expenses', 'accounting-balance-sheet', 'accounting-fixed-assets'],
          iconKey: 'treasury',
        },
        {
          key: 'hr-group',
          label: 'الموارد البشرية',
          itemKeys: ['hr'],
          iconKey: 'users',
        },
        {
          key: 'reports-group',
          label: 'تقارير الشحن',
          itemKeys: ['reports-overview', 'reports-treasury', 'reports-balances', 'reports-employees'],
          iconKey: 'reports',
        },
        ...(isPlatformAdminUser ? [{
          key: 'saas-group',
          label: 'إدارة المنصة والساس',
          itemKeys: ['saas-admin-tenants', 'saas-admin-plans'],
          iconKey: 'saas-admin-tenants',
        }] : []),
        {
          key: 'admin-group',
          label: t('sidebar.admin-group', 'الإدارة والنظام'),
          itemKeys: ['audit', 'settings', 'updates'],
          iconKey: 'admin',
        },
      ];
    }

    // 3. Dedicated Manufacturing & Industrial Production Workspace
    if (isDedicatedManufacturingOnly) {
      return [
        {
          key: 'manufacturing-group',
          label: 'التصنيع والإنتاج الصناعي',
          itemKeys: ['manufacturing-work-orders', 'manufacturing-boms', 'manufacturing-components', 'manufacturing-work-centers', 'manufacturing-settings'],
          iconKey: 'manufacturing',
        },
        {
          key: 'sales-group',
          label: 'المبيعات وعروض الأسعار',
          itemKeys: ['quotations', 'sales', 'customers'],
          iconKey: 'sales',
        },
        {
          key: 'purchases-group',
          label: 'المشتريات والتوريد الخام',
          itemKeys: ['purchases', 'purchases-orders', 'suppliers'],
          iconKey: 'purchases',
        },
        {
          key: 'manufacturing-inventory-group',
          label: 'المستودعات والمخازن',
          itemKeys: ['products', 'product-categories', 'inventory-issue-orders', 'inventory-warehouses', 'inventory'],
          iconKey: 'inventory',
        },
        {
          key: 'accounting-group',
          label: 'المالية ومراكز التكلفة',
          itemKeys: ['accounting-journal-entries', 'accounting-accounts', 'accounting-cost-centers', 'treasury', 'expenses', 'accounting-balance-sheet', 'accounting-fixed-assets'],
          iconKey: 'treasury',
        },
        {
          key: 'hr-group',
          label: 'الموارد البشرية وفريق العمل',
          itemKeys: ['hr'],
          iconKey: 'users',
        },
        {
          key: 'reports-group',
          label: 'تقارير الإنتاج والمصنع',
          itemKeys: ['reports-overview', 'reports-sales', 'reports-purchases', 'reports-inventory', 'reports-treasury', 'reports-balances', 'reports-employees'],
          iconKey: 'reports',
        },
        ...(isPlatformAdminUser ? [{
          key: 'saas-group',
          label: 'إدارة المنصة والساس',
          itemKeys: ['saas-admin-tenants', 'saas-admin-plans'],
          iconKey: 'saas-admin-tenants',
        }] : []),
        {
          key: 'admin-group',
          label: t('sidebar.admin-group', 'الإدارة والنظام'),
          itemKeys: ['audit', 'settings', 'updates'],
          iconKey: 'admin',
        },
      ];
    }

    // 4. Dedicated Import & Export Enterprise Workspace
    if (isDedicatedImportOnly) {
      const hasPos = settings?.posModuleEnabled !== false || Boolean(tenant?.features?.includes('pos'));
      return [
        ...(hasPos ? [{
          key: 'pos-group',
          label: 'نقطة البيع والوردية',
          itemKeys: ['pos', 'cash-drawer'],
          iconKey: 'pos' as const,
        }] : []),
        {
          key: 'import-group',
          label: 'الاستيراد والتجارة الدولية',
          itemKeys: [
            'import-command-center',
            'import-projects',
            'import-china-sourcing',
            'import-fx-treasury',
            'import-supplier-credit',
            'import-compliance',
            'import-shipments',
            'import-customs-brokers',
            'import-container-deposits',
            'import-approvals',
            'import-reconciliation',
            'import-profit-pool',
          ],
          iconKey: 'import',
        },
        {
          key: 'purchases-group',
          label: 'المشتريات والموردون الدوليون',
          itemKeys: ['purchases', 'purchases-orders', 'purchases-rfqs', 'purchase-returns', 'suppliers'],
          iconKey: 'purchases',
        },
        {
          key: 'inventory-group',
          label: 'المستودعات والرقابة المخزنية',
          itemKeys: ['products', 'product-categories', 'pricing-center', 'inventory-issue-orders', 'inventory-warehouses', 'inventory'],
          iconKey: 'inventory',
        },
        {
          key: 'sales-group',
          label: 'المبيعات والجملة والعملاء',
          itemKeys: ['crm', 'quotations', 'sales-orders', 'price-lists', 'sales', 'returns', 'customers'],
          iconKey: 'sales',
        },
        {
          key: 'accounting-group',
          label: hasAccounting ? 'المالية ومحاسبة الاستيراد' : 'الخزينة والمصروفات',
          itemKeys: ['accounting-journal-entries', 'accounting-accounts', 'accounting-cost-centers', 'treasury', 'expenses', 'accounting-payment-allocation', 'accounting-bank-reconciliation', 'accounting-cheques', 'accounting-balance-sheet', 'accounting-fixed-assets'],
          iconKey: 'treasury',
        },
        {
          key: 'reports-group',
          label: 'تقارير الشحنات والربحية',
          itemKeys: ['reports-overview', 'reports-purchases', 'reports-inventory', 'reports-sales', 'reports-treasury', 'reports-balances', 'reports-employees'],
          iconKey: 'reports',
        },
        ...(isPlatformAdminUser ? [{
          key: 'saas-group',
          label: 'إدارة المنصة والساس',
          itemKeys: ['saas-admin-tenants', 'saas-admin-plans'],
          iconKey: 'saas-admin-tenants',
        }] : []),
        {
          key: 'admin-group',
          label: t('sidebar.admin-group', 'الإدارة والنظام'),
          itemKeys: ['hr', 'audit', 'settings', 'updates'],
          iconKey: 'admin',
        },
      ];
    }

    // 4. Dedicated Services & Consulting Workspace
    if (isDedicatedServicesOnly) {
      const hasPos = settings?.posModuleEnabled !== false || Boolean(tenant?.features?.includes('pos'));
      return [
        ...(hasPos ? [{
          key: 'pos-group',
          label: 'نقطة البيع والوردية',
          itemKeys: ['pos', 'cash-drawer'],
          iconKey: 'pos',
        }] : []),
        {
          key: 'services-group',
          label: 'الخدمات والعقود',
          itemKeys: ['services', 'crm', 'quotations', 'sales', 'customers'],
          iconKey: 'services',
        },
        {
          key: 'purchases-group',
          label: 'المصروفات والموردون',
          itemKeys: ['purchases', 'suppliers'],
          iconKey: 'purchases',
        },
        {
          key: 'accounting-group',
          label: 'المالية والمحاسبة',
          itemKeys: ['accounting-journal-entries', 'accounting-accounts', 'accounting-cost-centers', 'treasury', 'expenses', 'accounting-balance-sheet', 'accounting-fixed-assets'],
          iconKey: 'treasury',
        },
        {
          key: 'reports-group',
          label: 'تقارير الأداء',
          itemKeys: ['reports-overview', 'reports-sales', 'reports-purchases', 'reports-treasury', 'reports-balances', 'reports-employees'],
          iconKey: 'reports',
        },
        ...(isPlatformAdminUser ? [{
          key: 'saas-group',
          label: 'إدارة المنصة والساس',
          itemKeys: ['saas-admin-tenants', 'saas-admin-plans'],
          iconKey: 'saas-admin-tenants',
        }] : []),
        {
          key: 'admin-group',
          label: t('sidebar.admin-group', 'الإدارة والنظام'),
          itemKeys: ['hr', 'audit', 'settings', 'updates'],
          iconKey: 'admin',
        },
      ];
    }

    // 5. Dedicated Wholesale Van & Fleet Distribution Workspace
    if (isWholesaleVanVertical) {
      const isDeliveryRepsEnabled = Boolean(
        settings?.deliveryRepsModuleEnabled === true ||
        (settings?.deliveryFleetModuleEnabled === true && !isWholesaleVanVertical)
      );
      return [
        {
          key: 'sales-group',
          label: 'المبيعات وتوزيع الفان',
          itemKeys: ['sales', 'returns', ...(isDeliveryRepsEnabled ? ['delivery-reps'] : []), 'customers', 'quotations'],
          iconKey: 'van-sales-admin',
        },
        {
          key: 'purchases-group',
          label: 'المشتريات والتوريد',
          itemKeys: ['purchases', 'suppliers'],
          iconKey: 'purchases',
        },
        {
          key: 'inventory-group',
          label: 'المستودعات وسيارات الفان',
          itemKeys: ['products', 'product-categories', 'inventory-issue-orders', 'inventory-warehouses', 'inventory'],
          iconKey: 'inventory',
        },
        {
          key: 'accounting-group',
          label: 'المالية ومراكز التكلفة',
          itemKeys: ['accounting-journal-entries', 'accounting-accounts', 'treasury', 'expenses', 'accounting-balance-sheet'],
          iconKey: 'treasury',
        },
        {
          key: 'hr-group',
          label: 'الموارد البشرية وفريق العمل',
          itemKeys: ['hr'],
          iconKey: 'users',
        },
        {
          key: 'reports-group',
          label: 'تقارير التوزيع والأسطول',
          itemKeys: ['reports-overview', 'reports-sales', 'reports-purchases', 'reports-inventory', 'reports-treasury', 'reports-balances', 'reports-employees'],
          iconKey: 'reports',
        },
        ...(isPlatformAdminUser ? [{
          key: 'saas-group',
          label: 'إدارة المنصة والساس',
          itemKeys: ['saas-admin-tenants', 'saas-admin-plans'],
          iconKey: 'saas-admin-tenants',
        }] : []),
        {
          key: 'admin-group',
          label: t('sidebar.admin-group', 'الإدارة والنظام'),
          itemKeys: ['audit', 'settings', 'updates'],
          iconKey: 'admin',
        },
      ];
    }

    // 6. Dedicated Warehousing & Multi-Branch Inventory Workspace
    if (isDedicatedWarehousingOnly) {
      return [
        {
          key: 'warehousing-inventory-group',
          label: 'المستودعات والتحويلات',
          itemKeys: [
            'inventory',
            'inventory-warehouses',
            'inventory-issue-orders',
            'inventory-tree',
            'inventory-bins',
          ],
          iconKey: 'inventory',
        },
        {
          key: 'products-group',
          label: 'الأصناف والباركود',
          itemKeys: ['products', 'product-categories'],
          iconKey: 'products',
        },
        {
          key: 'purchases-group',
          label: 'المشتريات والتوريد',
          itemKeys: ['purchases', 'purchases-orders', 'purchases-reorder', 'purchase-returns', 'suppliers'],
          iconKey: 'purchases',
        },
        {
          key: 'sales-group',
          label: 'المبيعات وصرف البضاعة',
          itemKeys: ['sales-orders', 'sales', 'quotations', 'customers', 'returns'],
          iconKey: 'sales',
        },
        {
          key: 'accounting-group',
          label: hasAccounting ? 'المالية والمحاسبة' : 'الخزينة والمصروفات',
          itemKeys: [
            'accounting-journal-entries',
            'accounting-accounts',
            'accounting-cost-centers',
            'treasury',
            'expenses',
            'accounting-balance-sheet',
          ],
          iconKey: 'treasury',
        },
        {
          key: 'hr-group',
          label: 'الموارد البشرية وفريق العمل',
          itemKeys: ['hr'],
          iconKey: 'users',
        },
        {
          key: 'reports-group',
          label: 'تقارير المخزون والأداء',
          itemKeys: [
            'reports-overview',
            'reports-inventory',
            'reports-purchases',
            'reports-sales',
            'reports-treasury',
            'reports-balances',
            'reports-employees',
          ],
          iconKey: 'reports',
        },
        ...(isPlatformAdminUser ? [{
          key: 'saas-group',
          label: 'إدارة المنصة والساس',
          itemKeys: ['saas-admin-tenants', 'saas-admin-plans'],
          iconKey: 'saas-admin-tenants',
        }] : []),
        {
          key: 'admin-group',
          label: t('sidebar.admin-group', 'الإدارة والنظام'),
          itemKeys: ['audit', 'settings', 'updates'],
          iconKey: 'admin',
        },
      ];
    }

    // 7. Multi-Modular & Enterprise Standard Workspace (Supports all modules simultaneously)
    return [
      ...(!isDedicatedMaritimeOnly && settings?.contractingModuleEnabled && hasContracting ? [{
        key: 'contracting-group',
        label: 'المقاولات والمشاريع',
        itemKeys: [
          'contracting-projects',
          'contracting-boq',
          'contracting-financials',
          'contracting-procurement',
          'contracting-field',
          'contracting-master-boq',
        ],
        iconKey: 'contracting',
      }] : []),
      ...(!isDedicatedContractingOnly && settings?.maritimeFreightModuleEnabled && hasMaritimeFreight ? [{
        key: 'maritime-group',
        label: 'الشحن واللوجستيات',
        itemKeys: ['maritime-inquiries', 'maritime-rfqs', 'maritime-matrix', 'maritime-quotations', 'maritime-jobs', 'maritime-containers', 'maritime-lines', 'maritime-settings'],
        iconKey: 'ship',
      }] : []),
      ...(settings?.importModuleEnabled && !isDedicatedImportOnly && hasImport ? [{
        key: 'import-group',
        label: 'الاستيراد والتجارة الدولية',
        itemKeys: [
          'import-command-center',
          'import-projects',
          'import-china-sourcing',
          'import-fx-treasury',
          'import-supplier-credit',
          'import-compliance',
          'import-shipments',
          'import-customs-brokers',
          'import-container-deposits',
          'import-approvals',
          'import-reconciliation',
          'import-profit-pool',
        ],
        iconKey: 'import',
      }] : []),
      ...((settings?.posModuleEnabled !== false || settings?.enableEnterpriseFeatures || settings?.installmentsModuleEnabled || isWholesaleVanVertical) ? [{
        key: 'sales-group',
        label: isWholesaleVanVertical ? 'المبيعات وتوزيع الفان' : t('sidebar.sales-group', 'المبيعات'),
        itemKeys: isWholesaleVanVertical
          ? ['sales', 'returns', ...(settings?.deliveryRepsModuleEnabled ? ['delivery-reps'] : []), 'customers', 'quotations']
          : isEnterpriseCommerceActive
          ? ['sales', 'quotations', 'returns', ...(settings?.installmentsModuleEnabled ? ['installments'] : []), 'customers', 'delivery-reps', 'van-sales-admin', 'tax-dispatcher']
          : ['sales', 'returns', ...(settings?.installmentsModuleEnabled ? ['installments'] : []), 'customers', 'delivery-reps', 'van-sales-admin', 'tax-dispatcher'],
        iconKey: 'sales',
      }] : []),
      ...((settings?.purchasesModuleEnabled !== false && hasPurchases) ? [{
        key: 'purchases-group',
        label: t('sidebar.purchases-group', 'المشتريات والموردين'),
        itemKeys: (isContractingVertical || isMaritimeVertical || isManufacturingVertical || isEnterpriseCommerceActive)
          ? ['purchases', 'purchases-orders', 'suppliers']
          : ['purchases', 'suppliers'],
        iconKey: 'purchases',
      }] : []),
      ...((settings?.inventoryModuleEnabled !== false && hasInventory) ? [{
        key: 'inventory-group',
        label: t('sidebar.inventory-group', 'المخزون والأصناف'),
        itemKeys: ['products', 'product-categories', 'inventory-issue-orders', 'inventory-warehouses', 'inventory', 'services'].filter(k => k !== 'services' || settings?.servicesModuleEnabled === true),
        iconKey: 'inventory',
      }] : (settings?.inventoryModuleEnabled === false && (isRetailOrMarketVertical || isRestaurantVertical || isPharmacyVertical || isElectronicsVertical || (!isDedicatedContractingOnly && !isDedicatedMaritimeOnly && !isDedicatedManufacturingOnly))) ? [{
        key: 'inventory-group',
        label: 'دليل الأصناف والكتالوج',
        itemKeys: ['products', 'product-new', 'product-categories', 'pricing-center'],
        iconKey: 'inventory',
      }] : []),
      {
        key: 'accounting-group',
        label: isEnterpriseCommerceActive ? t('sidebar.accounting-group', 'المالية والمحاسبة') : 'الخزينة والمصروفات',
        itemKeys: isEnterpriseCommerceActive
          ? ['accounting-journal-entries', 'accounting-accounts', 'accounting-cost-centers', 'treasury', 'accounting-cheques', 'accounting-bank-reconciliation', 'expenses', 'accounting-balance-sheet', 'accounting-fixed-assets']
          : ['treasury', 'expenses'],
        iconKey: 'treasury'
      },
      ...(settings?.restaurantModuleEnabled && hasRestaurant ? [{
        key: 'restaurant-group',
        label: 'المطاعم والكافيهات',
        itemKeys: ['displays', 'product-modifiers'],
        iconKey: 'kds',
      }] : []),
      ...(!isRetailOrMarketVertical && !isRestaurantVertical && !isPharmacyVertical && settings?.enableMobileStoreFeatures ? [{
        key: 'mobile-group',
        label: maintenanceProfile.sidebarTitle,
        itemKeys: ['maintenance', 'trade-in', 'imei-history'],
        iconKey: 'mobile',
      }] : []),
      ...(!isRetailOrMarketVertical && !isRestaurantVertical && !isElectronicsVertical && settings?.enablePharmacyModule ? [{
        key: 'pharmacy-group',
        label: 'قسم الصيدلية والأدوية',
        itemKeys: ['pharmacy-dashboard', 'pharmacy-drugs', 'pharmacy-prescriptions', 'pharmacy-shortages', 'pharmacy-batches', 'pharmacy-clinical'],
        iconKey: 'pharmacy',
      }] : []),
      ...(settings?.manufacturingModuleEnabled && hasManufacturing ? [{
        key: 'manufacturing-group',
        label: t('sidebar.manufacturing-group', 'التصنيع والإنتاج'),
        itemKeys: ['manufacturing-work-orders', 'manufacturing-boms', 'manufacturing-components', 'manufacturing-work-centers', 'manufacturing-settings'],
        iconKey: 'manufacturing',
      }] : []),
      { key: 'reports-group', label: t('sidebar.reports-group', 'التقارير والتحليلات'), itemKeys: ['reports-overview', 'reports-sales', 'reports-purchases', 'reports-inventory', 'reports-treasury', 'reports-balances', 'reports-employees'], iconKey: 'reports' },
      ...(isPlatformAdminUser ? [{
        key: 'saas-group',
        label: 'إدارة المنصة والساس',
        itemKeys: ['saas-admin-tenants', 'saas-admin-plans'],
        iconKey: 'saas-admin-tenants',
      }] : []),
      { key: 'admin-group', label: t('sidebar.admin-group', 'الإدارة والنظام'), itemKeys: ['hr', 'audit', 'settings', 'updates'], iconKey: 'admin' },
    ];
  }, [t, settings?.businessIndustry, settings?.activityType, settings?.maintenanceProfile, settings?.restaurantModuleEnabled, settings?.enableMobileStoreFeatures, settings?.enablePharmacyModule, settings?.importModuleEnabled, settings?.manufacturingModuleEnabled, settings?.enableEnterpriseFeatures, settings?.maritimeFreightModuleEnabled, settings?.contractingModuleEnabled, settings?.posModuleEnabled, settings?.purchasesModuleEnabled, settings?.inventoryModuleEnabled, settings?.installmentsModuleEnabled, tenant?.features, tenant?.activityType, tenant?.pillar, user]);
}
