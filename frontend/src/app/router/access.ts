import { isDesktopOfflineApp, isPlatformAdmin } from '@/shared/system/runtime-environment';

import type { NavigationItemDefinition } from '@/app/router/types';
import type { AuthUser } from '@/types/auth';

import { useAuthStore } from '@/stores/auth-store';
import { resolveCurrentVertical, isRouteAllowedInVertical } from '@/shared/verticals/vertical-scope';

type RoutePermissionRequirement = string | string[] | null;

export const routePermissionMap: Record<string, RoutePermissionRequirement> = {
  dashboard: 'dashboard',
  '/': 'dashboard',
  products: 'products',
  '/products': 'products',
  'product-modifiers': 'products',
  '/products/modifiers': 'products',
  sales: 'sales',
  '/sales': 'sales',
  'sales-subscriptions': 'sales',
  '/sales/subscriptions': 'sales',
  'sales-orders': 'sales',
  '/sales/orders': 'sales',
  crm: ['sales', 'customers', 'crm', 'contracting', 'maritime_freight', 'manufacturing'],
  '/crm': ['sales', 'customers', 'crm', 'contracting', 'maritime_freight', 'manufacturing'],
  'online-orders': 'sales',
  '/online-orders': 'sales',
  installments: 'sales',
  '/installments': 'sales',
  'vat-declaration': 'sales',
  '/vat-declaration': 'sales',
  displays: 'sales',
  '/displays': 'sales',
  pos: 'sales',
  '/pos': 'sales',
  'cash-drawer': ['cashDrawer', 'treasury'],
  '/cash-drawer': ['cashDrawer', 'treasury'],
  purchases: 'purchases',
  '/purchases': 'purchases',
  'purchases-orders': 'purchases',
  '/purchases/orders': 'purchases',
  'purchases-rfqs': 'purchases',
  '/purchases/rfqs': 'purchases',
  'purchases-reorder': 'purchases',
  '/purchases/reorder': 'purchases',
  'purchases-new': 'purchases',
  '/purchases/new': 'purchases',
  inventory: 'inventory',
  '/inventory': 'inventory',
  'inventory-tree': 'inventory',
  '/inventory-tree': 'inventory',
  'inventory/tree': 'inventory',
  '/inventory/tree': 'inventory',
  'inventory-warehouses': 'inventory',
  '/inventory/warehouses': 'inventory',
  'inventory/warehouses-management': 'inventory',
  '/inventory/warehouses-management': 'inventory',
  'inventory-bins': 'inventory',
  '/inventory/bins': 'inventory',
  'inventory-packages': 'inventory',
  '/inventory/packages': 'inventory',
  'inventory-quality': 'inventory',
  '/inventory/quality': 'inventory',
  'inventory-reordering': 'inventory',
  '/inventory/reordering': 'inventory',
  'inventory-batches': 'inventory',
  '/inventory/batches': 'inventory',
  'inventory-issue-orders': 'inventory',
  '/inventory/issue-orders': 'inventory',
  '/inventory/transfers': 'inventory',
  'inventory-issue-order-new': 'inventory',
  '/inventory/issue-order/new': 'inventory',
  '/inventory/issue-orders/new': 'inventory',
  'price-lists': ['sales', 'products', 'pricingCenterView'],
  '/price-lists': ['sales', 'products', 'pricingCenterView'],
  'sales/price-lists': ['sales', 'products', 'pricingCenterView'],
  '/sales/price-lists': ['sales', 'products', 'pricingCenterView'],
  quotations: ['sales', 'crm'],
  '/quotations': ['sales', 'crm'],
  'quotations/new': ['sales', 'crm'],
  '/quotations/new': ['sales', 'crm'],
  'sales/quotations': ['sales', 'crm'],
  '/sales/quotations': ['sales', 'crm'],
  'sales/quotations/new': ['sales', 'crm'],
  '/sales/quotations/new': ['sales', 'crm'],
  'product-categories': 'products',
  '/product-categories': 'products',
  'products/categories': 'products',
  '/products/categories': 'products',
  'product-new': 'products',
  'products/new': 'products',
  '/products/new': 'products',
  suppliers: 'suppliers',
  '/suppliers': 'suppliers',
  customers: 'customers',
  '/customers': 'customers',
  accounts: 'accounts',
  '/accounts': 'accounts',
  accounting: 'accounting',
  '/accounting': 'accounting',
  'accounting/accounts': 'accounting',
  '/accounting/accounts': 'accounting',
  'accounting/journal-entries': 'accounting',
  '/accounting/journal-entries': 'accounting',
  'accounting-payment-allocation': 'accounting',
  'accounting/payment-allocation': 'accounting',
  '/accounting/payment-allocation': 'accounting',
  'accounting/settings': 'accounting',
  '/accounting/settings': 'accounting',
  'accounting/financial-summary': 'accounting',
  '/accounting/financial-summary': 'accounting',
  'accounting/receivables-payables': 'accounting',
  '/accounting/receivables-payables': 'accounting',
  'accounting/cash-movement': 'accounting',
  '/accounting/cash-movement': 'accounting',
  'accounting/inventory-value': 'accounting',
  '/accounting/inventory-value': 'accounting',
  'accounting/fixed-assets': 'accounting',
  '/accounting/fixed-assets': 'accounting',
  'accounting/cost-centers': 'accounting',
  '/accounting/cost-centers': 'accounting',
  'accounting/balance-sheet': 'accounting',
  '/accounting/balance-sheet': 'accounting',
  'accounting/cash-flow': 'accounting',
  '/accounting/cash-flow': 'accounting',
  'accounting/aged-debts': 'accounting',
  '/accounting/aged-debts': 'accounting',
  'accounting/cheques': 'accounting',
  '/accounting/cheques': 'accounting',
  'accounting/withholding-tax': 'accounting',
  '/accounting/withholding-tax': 'accounting',
  'accounting-accounts': 'accounting',
  'accounting-cost-centers': 'accounting',
  'accounting-journal-entries': 'accounting',
  'accounting-cheques': 'accounting',
  'accounting-withholding-tax': 'accounting',
  'accounting-balance-sheet': 'accounting',
  'accounting-cash-flow': 'accounting',
  'accounting-aged-debts': 'accounting',
  'accounting-fixed-assets': 'accounting',
  'accounting-settings': 'accounting',
  'accounting-financial-summary': 'accounting',
  'accounting-receivables-payables': 'accounting',
  'accounting-cash-movement': 'accounting',
  'accounting-inventory-value': 'accounting',
  returns: 'returns',
  '/returns': 'returns',
  reports: 'reports',
  '/reports': 'reports',
  'reports-overview': 'reports',
  'reports-sales': 'reports',
  'reports-treasury': 'reports',
  'reports-inventory': 'reports',
  'reports-purchases': 'reports',
  'reports-balances': 'reports',
  'reports-employees': 'reports',
  'reports/overview': 'reports',
  '/reports/overview': 'reports',
  'reports/sales': 'reports',
  '/reports/sales': 'reports',
  'reports/treasury': 'reports',
  '/reports/treasury': 'reports',
  'reports/inventory': 'reports',
  '/reports/inventory': 'reports',
  'reports/purchases': 'reports',
  '/reports/purchases': 'reports',
  'reports/balances': 'reports',
  '/reports/balances': 'reports',
  'reports/employees': 'reports',
  '/reports/employees': 'reports',
  audit: 'audit',
  '/audit': 'audit',
  treasury: 'treasury',
  '/treasury': 'treasury',
  expenses: 'treasury',
  '/expenses': 'treasury',
  services: 'services',
  '/services': 'services',
  maintenance: 'sales',
  '/maintenance': 'sales',
  'trade-in': 'purchases',
  '/trade-in': 'purchases',
  'imei-history': 'products',
  '/products/imei-history': 'products',
  hr: 'hr',
  '/hr': 'hr',
  'hr/employees': 'hrEmployees',
  '/hr/employees': 'hrEmployees',
  'hr/employees/new': 'hrEmployees',
  '/hr/employees/new': 'hrEmployees',
  'hr/employees/:id': 'hrEmployees',
  '/hr/employees/:id': 'hrEmployees',
  'hr/employees/:id/edit': 'hrEmployees',
  '/hr/employees/:id/edit': 'hrEmployees',
  'hr/attendance': 'hrAttendance',
  '/hr/attendance': 'hrAttendance',
  'hr/leaves': 'hrEmployees',
  '/hr/leaves': 'hrEmployees',
  'hr/assets': 'hrEmployees',
  '/hr/assets': 'hrEmployees',
  'hr/documents': 'hrEmployees',
  '/hr/documents': 'hrEmployees',
  'hr/loans': 'hrLoans',
  '/hr/loans': 'hrLoans',
  'hr/payroll': 'hrPayrollView',
  '/hr/payroll': 'hrPayrollView',
  'hr-settlements': 'hr',
  'hr/settlements': 'hr',
  '/hr/settlements': 'hr',
  'hr-recruitment': 'hr',
  'hr/recruitment': 'hr',
  '/hr/recruitment': 'hr',
  'hr/reports': 'hr',
  '/hr/reports': 'hr',
  'hr/settings': 'hr',
  '/hr/settings': 'hr',
  'pricing-center': 'pricingCenterView',
  '/pricing-center': 'pricingCenterView',
  'saas-admin/tenants': null,
  '/saas-admin/tenants': null,
  settings: ['settings', 'canManageSettings'],
  '/settings': ['settings', 'canManageSettings'],
  updates: ['settings', 'canManageSettings'],
  '/updates': ['settings', 'canManageSettings'],
  apps: ['settings', 'canManageSettings'],
  '/apps': ['settings', 'canManageSettings'],
  'apps-store': ['settings', 'canManageSettings'],
  '/apps-store': ['settings', 'canManageSettings'],
  'manufacturing-components': 'manufacturing',
  'manufacturing-boms': 'manufacturing',
  'manufacturing-work-orders': 'manufacturing',
  'manufacturing-settings': 'manufacturing',
  'manufacturing/boms': 'manufacturing',
  '/manufacturing/boms': 'manufacturing',
  'manufacturing/boms/new': 'manufacturing',
  '/manufacturing/boms/new': 'manufacturing',
  'manufacturing/work-orders': 'manufacturing',
  '/manufacturing/work-orders': 'manufacturing',
  'manufacturing/work-orders/new': 'manufacturing',
  '/manufacturing/work-orders/new': 'manufacturing',
  'manufacturing/settings': 'manufacturing',
  '/manufacturing/settings': 'manufacturing',
  'manufacturing/components': 'manufacturing',
  '/manufacturing/components': 'manufacturing',
  'purchase-returns': 'returns',
  '/purchase-returns': 'returns',
  maritime: null,
  '/maritime': null,
  'maritime-freight': null,
  '/maritime-freight': null,
  'maritime-inquiries': null,
  'maritime-rfqs': null,
  'maritime-matrix': null,
  'maritime-quotations': null,
  'maritime-jobs': null,
  'maritime-containers': null,
  'maritime-lines': null,
  'maritime-settings': null,
  contracting: null,
  '/contracting': null,
  'contracting-projects': null,
  'contracting-boq': null,
  'contracting-financials': null,
  'contracting-procurement': null,
  'contracting-field': null,
  'contracting-master-boq': null,
  'contracting-change-orders': null,
  'contracting-invoices': null,
  'contracting-subcontracts': null,
  'contracting-daily-logs': null,
  'contracting-rfis': null,
  qz: null,
  '/qz': null,
};

export const routeFeatureMap: Record<string, string | null> = {
  dashboard: 'reports',
  '/': 'reports',
  'owner-companion': 'reports',
  '/owner-companion': 'reports',
  'owner-mobile': 'reports',
  '/owner-mobile': 'reports',
  'mobile/owner': 'reports',
  '/mobile/owner': 'reports',
  catalog: 'catalog',
  products: 'catalog',
  'product-new': 'catalog',
  'products/new': 'catalog',
  '/products/new': 'catalog',
  'product-categories': 'catalog',
  services: 'catalog',
  'sales-orders': 'sales',
  '/sales-orders': 'sales',
  '/sales/orders': 'sales',
  'price-lists': 'catalog',
  '/price-lists': 'catalog',
  '/sales/price-lists': 'catalog',
  crm: null,
  '/crm': null,
  quotations: 'sales',
  '/quotations': 'sales',
  'quotations/new': 'sales',
  '/quotations/new': 'sales',
  'sales/quotations/new': 'sales',
  '/sales/quotations/new': 'sales',
  installments: 'installments',
  '/installments': 'installments',
  'vat-declaration': 'vat_declaration',
  '/vat-declaration': 'vat_declaration',
  displays: 'restaurant',
  '/displays': 'restaurant',
  kds: 'restaurant',
  '/kds': 'restaurant',
  signage: 'restaurant',
  '/signage': 'restaurant',
  '/pos/customer-display': 'restaurant',
  pos: 'sales',
  '/pos': 'sales',
  returns: 'sales',
  '/returns': 'sales',
  customers: 'sales',
  '/customers': 'sales',
  'pricing-center': 'catalog',
  '/pricing-center': 'catalog',
  'cash-drawer': 'cashDrawer',
  '/cash-drawer': 'cashDrawer',
  treasury: 'cashDrawer',
  '/treasury': 'cashDrawer',
  expenses: 'cashDrawer',
  '/expenses': 'cashDrawer',

  // Purchases
  purchases: 'purchases',
  '/purchases': 'purchases',
  'purchases-orders': 'purchases',
  '/purchases/orders': 'purchases',
  'purchases-rfqs': 'purchases',
  '/purchases/rfqs': 'purchases',
  'purchases-new': 'purchases',
  '/purchases/new': 'purchases',
  'purchases-reorder': 'purchases',
  '/purchases/reorder': 'purchases',
  'purchase-returns': 'purchases',
  '/purchase-returns': 'purchases',
  suppliers: 'purchases',
  '/suppliers': 'purchases',

  // Inventory
  inventory: 'inventory',
  '/inventory': 'inventory',
  'inventory-batches': 'inventory',
  '/inventory/batches': 'inventory',
  'inventory-bins': 'inventory',
  '/inventory/bins': 'inventory',
  'inventory-issue-orders': 'inventory',
  '/inventory/transfers': 'inventory',
  'inventory-warehouses': 'inventory',
  '/inventory/warehouses': 'inventory',
  'inventory-tree': 'inventory',
  '/inventory-tree': 'inventory',
  '/inventory/tree': 'inventory',
  'inventory-issue-order-new': 'inventory',
  '/inventory/issue-order/new': 'inventory',

  // Reports
  reports: 'reports',
  '/reports': 'reports',
  'reports-overview': 'reports',
  '/reports/overview': 'reports',
  'reports-sales': 'reports',
  '/reports/sales': 'reports',
  'reports-treasury': 'reports',
  '/reports/treasury': 'reports',
  'reports-inventory': 'reports',
  '/reports/inventory': 'reports',
  'reports-purchases': 'reports',
  '/reports/purchases': 'reports',
  'reports-balances': 'accounting',
  '/reports/balances': 'accounting',
  'reports-employees': 'hr',
  '/reports/employees': 'hr',
  audit: 'reports',
  '/audit': 'reports',

  // HR
  hr: 'hr',
  '/hr': 'hr',
  'hr-settlements': 'hr',
  '/hr/settlements': 'hr',

  // Manufacturing
  manufacturing: 'manufacturing',
  '/manufacturing': 'manufacturing',
  'manufacturing-components': 'manufacturing',
  '/manufacturing/components': 'manufacturing',
  'manufacturing-boms': 'manufacturing',
  '/manufacturing/boms': 'manufacturing',
  'manufacturing-work-orders': 'manufacturing',
  '/manufacturing/work-orders': 'manufacturing',
  'manufacturing-work-centers': 'manufacturing',
  '/manufacturing/work-centers': 'manufacturing',
  'manufacturing-settings': 'manufacturing',
  '/manufacturing/settings': 'manufacturing',

  // Accounting
  accounting: 'accounting',
  '/accounting': 'accounting',
  accounts: 'accounting',
  '/accounts': 'accounting',
  'accounting-accounts': 'accounting',
  '/accounting/accounts': 'accounting',
  'accounting-cost-centers': 'accounting',
  '/accounting/cost-centers': 'accounting',
  'accounting-journal-entries': 'accounting',
  '/accounting/journal-entries': 'accounting',
  'accounting-payment-allocation': 'accounting',
  '/accounting/payment-allocation': 'accounting',
  'accounting-bank-reconciliation': 'accounting',
  '/accounting/bank-reconciliation': 'accounting',
  'accounting-cheques': 'accounting',
  '/accounting/cheques': 'accounting',
  'accounting-withholding-tax': 'accounting',
  '/accounting/withholding-tax': 'accounting',
  'accounting-balance-sheet': 'accounting',
  '/accounting/balance-sheet': 'accounting',
  'accounting-cash-flow': 'accounting',
  '/accounting/cash-flow': 'accounting',
  'accounting-aged-debts': 'accounting',
  '/accounting/aged-debts': 'accounting',
  'accounting-fixed-assets': 'fixed_assets',
  '/accounting-fixed-assets': 'fixed_assets',
  '/accounting/fixed-assets': 'fixed_assets',
  'accounting-settings': 'accounting',
  '/accounting/settings': 'accounting',
  'accounting-financial-summary': 'accounting',
  '/accounting/financial-summary': 'accounting',
  'accounting-receivables-payables': 'accounting',
  '/accounting/receivables-payables': 'accounting',
  'accounting-cash-movement': 'accounting',
  '/accounting/cash-movement': 'accounting',
  'accounting-inventory-value': 'accounting',
  '/accounting/inventory-value': 'accounting',

  // Delivery & Van Sales
  'delivery-reps': 'deliveryReps',
  '/delivery-reps': 'deliveryReps',
  'driver-mobile': 'deliveryReps',
  '/driver-mobile': 'deliveryReps',
  'van-sales-admin': 'deliveryReps',
  '/van-sales/admin': 'deliveryReps',
  '/inventory/van-sales': 'deliveryReps',

  // Tax & Reference
  'tax-dispatcher': 'taxIntegration',
  '/tax-dispatcher': 'taxIntegration',
  'settings/reference': null,
  'settings/tax-integration': 'taxIntegration',

  // Online Storefront
  'online-orders': 'storefront',
  '/online-orders': 'storefront',
  storefront: 'storefront',
  '/storefront': 'storefront',
  'settings/storefront': 'storefront',
  '/settings/storefront': 'storefront',
  'settings/marketplaces': 'storefront',
  '/settings/marketplaces': 'storefront',

  // Mobile / Maintenance
  maintenance: 'maintenance',
  '/maintenance': 'maintenance',
  'trade-in': 'maintenance',
  '/trade-in': 'maintenance',
  'imei-history': 'maintenance',
  '/imei-history': 'maintenance',
  '/products/imei-history': 'maintenance',

  // Pharmacy
  pharmacy: 'pharmacy',
  '/pharmacy': 'pharmacy',
  'pharmacy-dashboard': 'pharmacy',
  '/pharmacy/dashboard': 'pharmacy',
  'pharmacy-drugs': 'pharmacy',
  '/pharmacy/drugs': 'pharmacy',
  'pharmacy-prescriptions': 'pharmacy',
  '/pharmacy/prescriptions': 'pharmacy',
  'pharmacy-shortages': 'pharmacy',
  '/pharmacy/shortages': 'pharmacy',
  'pharmacy-batches': 'pharmacy',
  '/pharmacy/batches': 'pharmacy',
  'pharmacy-clinical': 'pharmacy',
  '/pharmacy/clinical': 'pharmacy',

  // Import
  import: 'import',
  '/import': 'import',
  'import-sales': 'import',
  '/import-sales': 'import',
  'import-command-center': 'import',
  '/import-sales/command-center': 'import',
  'import-projects': 'import',
  '/import-sales/projects': 'import',
  'import-china-sourcing': 'import',
  '/import-sales/china-sourcing': 'import',
  'import-shipments': 'import',
  '/import/shipments': 'import',
  '/import-sales/shipments': 'import',
  'import-compliance': 'import',
  '/import-sales/compliance': 'import',
  'import-customs-brokers': 'import',
  '/import-sales/customs-brokers': 'import',
  'import-container-deposits': 'import',
  '/import-sales/container-deposits': 'import',
  'import-supplier-credit': 'import',
  '/import/supplier-credit': 'import',
  '/import-sales/supplier-credit': 'import',
  'import-fx-treasury': 'import',
  '/import-sales/fx-treasury': 'import',
  'import-approvals': 'import',
  '/import-sales/approvals': 'import',
  'import-reconciliation': 'import',
  '/import-sales/reconciliation': 'import',
  'import-profit-pool': 'import',
  '/import/profit-pool': 'import',
  '/import-sales/profit-pool': 'import',

  // Other modules
  restaurant: 'restaurant',
  '/restaurant': 'restaurant',
  'product-modifiers': 'restaurant',
  '/products/modifiers': 'restaurant',
  clothing: 'clothing',
  '/clothing': 'clothing',

  // Maritime Freight
  maritime: 'maritime_freight',
  '/maritime': 'maritime_freight',
  'maritime-freight': 'maritime_freight',
  '/maritime-freight': 'maritime_freight',
  'maritime-inquiries': 'maritime_freight',
  'maritime-rfqs': 'maritime_freight',
  'maritime-matrix': 'maritime_freight',
  'maritime-quotations': 'maritime_freight',
  'maritime-jobs': 'maritime_freight',
  'maritime-containers': 'maritime_freight',
  'maritime-lines': 'maritime_freight',
  'maritime-settings': 'maritime_freight',

  // Contracting & Construction
  contracting: 'contracting',
  '/contracting': 'contracting',
  'contracting-projects': 'contracting',
  'contracting-boq': 'contracting',
  'contracting-financials': 'contracting',
  'contracting-procurement': 'contracting',
  'contracting-field': 'contracting',
  'contracting-master-boq': 'contracting',
  'contracting-change-orders': 'contracting',
  'contracting-invoices': 'contracting',
  'contracting-subcontracts': 'contracting',
  'contracting-daily-logs': 'contracting',
  'contracting-rfis': 'contracting',
};

function normalizeAccessKey(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '/';
  if (trimmed === '/') return '/';
  return trimmed.replace(/^\//, '').replace(/\/$/, '') || '/';
}

function normalizePermissionList(input: RoutePermissionRequirement): string[] {
  if (!input) return [];
  return Array.isArray(input) ? input.map((entry) => String(entry || '').trim()).filter(Boolean) : [String(input).trim()].filter(Boolean);
}

export function hasAnyPermission(user: AuthUser | null | undefined, required: RoutePermissionRequirement) {
  if (!required) return true;
  if (!user) return false;
  // Only super_admin bypasses granular permissions. An 'admin' must respect the permissions
  // actually granted to them, matching the backend PermissionsGuard (which never exempted
  // 'admin'). The blanket admin bypass added in e5b0bc14 is a regression; see O29.
  if (user.role === 'super_admin') return true;
  const needed = normalizePermissionList(required);
  if (!needed.length) return true;
  const userPermissions = new Set((user.permissions || []).map((permission) => String(permission || '').trim()).filter(Boolean));
  if (userPermissions.has('*')) return true;
  return needed.some((permission) => userPermissions.has(permission));
}

// التعريف انتقل إلى الطبقة المشتركة كي تستطيع مكوّنات الميزات استخدامه بلا اختراق
// طبقة الـapp (حارس frontend-import-layers). يُعاد تصديره هنا لتبقى الاستيرادات القائمة.
export { isDesktopOfflineApp, isPlatformAdmin };



export function getRoutePermissionRequirement(target: string) {
  const normalized = normalizeAccessKey(target);
  const directMatch = routePermissionMap[normalized] ?? routePermissionMap[`/${normalized}`];
  if (directMatch) return directMatch;
  if (normalized.startsWith('hr/')) {
    if (normalized.startsWith('hr/employees')) return routePermissionMap['hr/employees'] ?? 'hrEmployees';
    if (normalized.startsWith('hr/attendance')) return routePermissionMap['hr/attendance'] ?? 'hrAttendance';
    if (normalized.startsWith('hr/leaves')) return routePermissionMap['hr/leaves'] ?? 'hrEmployees';
    if (normalized.startsWith('hr/assets')) return routePermissionMap['hr/assets'] ?? 'hrEmployees';
    if (normalized.startsWith('hr/documents')) return routePermissionMap['hr/documents'] ?? 'hrEmployees';
    if (normalized.startsWith('hr/loans')) return routePermissionMap['hr/loans'] ?? 'hrLoans';
    if (normalized.startsWith('hr/payroll')) return routePermissionMap['hr/payroll'] ?? 'hrPayrollView';
    if (normalized.startsWith('hr/reports')) return routePermissionMap['hr/reports'] ?? 'hr';
    if (normalized.startsWith('hr/settings')) return routePermissionMap['hr/settings'] ?? 'hr';
    return routePermissionMap.hr ?? 'hr';
  }
  const [rootSegment] = normalized.split('/').filter(Boolean);
  if (!rootSegment) return routePermissionMap['/'] ?? null;
  return routePermissionMap[rootSegment] ?? routePermissionMap[`/${rootSegment}`] ?? null;
}

export function getRouteFeatureRequirement(target: string) {
  const normalized = normalizeAccessKey(target);
  const directMatch = routeFeatureMap[normalized] ?? routeFeatureMap[`/${normalized}`];
  if (directMatch !== undefined) return directMatch;
  const [rootSegment] = normalized.split('/').filter(Boolean);
  if (!rootSegment) return null;
  const rootMatch = routeFeatureMap[rootSegment] ?? routeFeatureMap[`/${rootSegment}`];
  if (rootMatch !== undefined) return rootMatch;

  // Prefix fallbacks to prevent any unmapped nested route or hyphenated subroute from leaking
  if (rootSegment.startsWith('purchases')) return 'purchases';
  if (rootSegment.startsWith('inventory')) return 'inventory';
  if (rootSegment.startsWith('reports')) return 'reports';
  if (rootSegment.startsWith('accounting')) return 'accounting';
  if (rootSegment.startsWith('hr')) return 'hr';
  if (rootSegment.startsWith('manufacturing')) return 'manufacturing';
  if (rootSegment.startsWith('pharmacy')) return 'pharmacy';
  if (rootSegment.startsWith('import')) return 'import';
  if (rootSegment.startsWith('maritime')) return 'maritime_freight';
  if (rootSegment.startsWith('contracting')) return 'contracting';
  if (rootSegment.startsWith('van-sales') || rootSegment.startsWith('driver-mobile')) return 'deliveryReps';
  return null;
}

export function hasRequiredFeature(target: string, user?: AuthUser | null): boolean {
  if (isPlatformAdmin(user)) return true;

  const tenant = useAuthStore.getState().tenant;
  const vertical = resolveCurrentVertical(tenant);
  if (!isRouteAllowedInVertical(vertical, target)) {
    return false;
  }

  const requiredFeature = getRouteFeatureRequirement(target);
  if (!requiredFeature) return true;
  
  if (!tenant) return true;

  const isContracting = vertical === 'contracting';
  const isMaritime = vertical === 'maritime';
  const isManufacturing = vertical === 'manufacturing';
  const isWholesaleVan = vertical === 'wholesale_van';
  const isWarehousing = vertical === 'warehousing';
  const isImport = vertical === 'import_export';
  const isCommerce = !isContracting && !isMaritime && !isManufacturing && !isWholesaleVan && !isWarehousing && !isImport;

  if (isImport && ['import', 'inventory', 'catalog', 'products', 'purchases', 'suppliers', 'sales', 'pos', 'cashDrawer', 'customers', 'accounting', 'treasury', 'hr', 'crm', 'pricing', 'reports', 'approvals'].includes(requiredFeature)) {
    return true;
  }
  if (isWarehousing && ['inventory', 'catalog', 'products', 'purchases', 'suppliers', 'sales', 'customers', 'accounting', 'hr', 'crm', 'pricing', 'reports'].includes(requiredFeature)) {
    return true;
  }
  if (isWholesaleVan && ['deliveryReps', 'catalog', 'products', 'sales', 'pos', 'purchases', 'inventory', 'accounting', 'hr', 'crm', 'pricing', 'suppliers', 'customers'].includes(requiredFeature)) {
    return true;
  }
  if (isContracting && ['contracting', 'purchases', 'inventory', 'catalog', 'products', 'suppliers', 'customers', 'crm', 'accounting', 'hr'].includes(requiredFeature)) {
    return true;
  }
  if (isMaritime && ['maritime_freight', 'purchases', 'suppliers', 'customers', 'crm', 'sales', 'accounting', 'hr'].includes(requiredFeature)) {
    return true;
  }
  if (isManufacturing && ['manufacturing', 'purchases', 'inventory', 'catalog', 'products', 'suppliers', 'customers', 'crm', 'sales', 'pricing', 'accounting', 'hr'].includes(requiredFeature)) {
    return true;
  }
  if (isCommerce && ['pos', 'catalog', 'products', 'sales', 'purchases', 'inventory', 'accounting', 'hr', 'crm', 'pricing', 'suppliers', 'customers'].includes(requiredFeature)) {
    return true;
  }

  if (!tenant.features || !Array.isArray(tenant.features)) return false;
  
  if (requiredFeature === 'catalog' && (tenant.features.includes('inventory') || tenant.features.includes('products'))) {
    return true;
  }
  if (requiredFeature === 'inventory' && tenant.features.includes('catalog')) {
    return true;
  }

  return tenant.features.includes(requiredFeature);
}

export function canAccessPath(user: AuthUser | null | undefined, target: string) {
  const normalized = normalizeAccessKey(target);
  if (normalized === 'saas-admin' || normalized === 'saas-admin/tenants' || normalized.startsWith('saas-admin/')) {
    if (isDesktopOfflineApp()) return false;
    return isPlatformAdmin(user);
  }
  if (isPlatformAdmin(user)) return true;
  if (!hasRequiredFeature(target, user)) return false;
  return hasAnyPermission(user, getRoutePermissionRequirement(target));
}

export function canAccessNavigationItem(user: AuthUser | null | undefined, item: NavigationItemDefinition) {
  if (item.platformOnly) return isPlatformAdmin(user);
  if (isPlatformAdmin(user)) return true;
  if (!hasRequiredFeature(item.to, user) || (item.key && !hasRequiredFeature(item.key, user))) return false;
  return hasAnyPermission(user, getRoutePermissionRequirement(item.key || item.to));
}

export function findFirstAccessibleRoute(user: AuthUser | null | undefined, navigationItems: NavigationItemDefinition[]) {
  return navigationItems.find((item) => canAccessNavigationItem(user, item))?.to ?? null;
}

export function getFirstAccessibleRoute(user: AuthUser | null | undefined, navigationItems: NavigationItemDefinition[]) {
  return findFirstAccessibleRoute(user, navigationItems) || '/';
}
