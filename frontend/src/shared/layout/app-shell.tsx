import { CSSProperties, PropsWithChildren, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import { http } from '@/lib/http';
import { Button } from '@/shared/ui/button';
import { authApi } from '@/shared/api/auth';
import { resetAuthenticatedClient } from '@/lib/query-client-session';
import { DEFAULT_STORE_NAME, useAuthStore } from '@/stores/auth-store';
import { navigationItems } from '@/app/router/registry';
import { canAccessNavigationItem, isDesktopOfflineApp, isPlatformAdmin } from '@/app/router/access';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { PasswordRotationGate } from '@/shared/system/password-rotation-gate';
import { SystemStatusBanner } from '@/shared/system/system-status-banner';
import { BootstrapAdminBanner } from '@/shared/system/bootstrap-admin-banner';
import { TrialStatusBanner } from '@/shared/system/trial-status-banner';
import { ImpersonationBanner } from '@/shared/system/impersonation-banner';
import { PwaInstallBanner } from '@/shared/components/PwaInstallBanner';
import { useOfflineUpdateCheck } from '@/features/updates/hooks/useOfflineUpdateCheck';
import {
  POS_SHELL_VISIBILITY_KEY,
  POS_TOGGLE_CHROME_EVENT,
  POS_TOGGLE_FULLSCREEN_EVENT,
  readPosShellPreference,
  isStandalonePosTerminal,
} from '@/features/pos/lib/pos-shell';
import { QuickAttendanceShortcut } from '@/shared/layout/quick-attendance-shortcut';
import { GlobalAppToolbar } from '@/shared/layout/GlobalAppToolbar';
import { MobileBottomNav } from '@/shared/layout/MobileBottomNav';
import { resolveCurrentVertical } from '@/shared/verticals/vertical-scope';
import { useToolbarStore } from '@/stores/toolbar-store';
import { DialogShell } from '@/shared/components/dialog-shell';
import { SearchIcon, CheckCircleIcon , XIcon } from '@/shared/components/icons/AppIcons';
import { getMaintenanceProfile } from '@/features/maintenance/constants/maintenance-profiles';
import { prefetchRouteData } from '@/app/router/route-prefetch';
import { resolveAutoBreadcrumbs } from '@/shared/layout/breadcrumbs.helper';

const GlobalSearchModal = lazy(() => import('@/shared/components/GlobalSearchModal').then((m) => ({ default: m.GlobalSearchModal })));
const DeveloperActivationPanel = lazy(() => import('@/shared/system/DeveloperActivationPanel').then((m) => ({ default: m.DeveloperActivationPanel })));
const LiveOrderNotificationBanner = lazy(() => import('@/features/storefront/components/LiveOrderNotificationBanner').then((m) => ({ default: m.LiveOrderNotificationBanner })));


type SidebarGroupDefinition = {
  key: string;
  label: string;
  itemKeys: string[];
  iconKey?: string;
};

type IconTone = {
  bg: string;
  border: string;
  fg: string;
  glow: string;
};

const defaultIconTone: IconTone = {
  bg: '#f8fafc',
  border: '#e2e8f0',
  fg: '#475569',
  glow: 'transparent',
};

const activeIconTone: IconTone = {
  bg: '#eef2ff',
  border: '#c7d2fe',
  fg: '#170e5e',
  glow: 'rgba(23, 14, 94, 0.08)',
};


import { AppNavIcon } from '@/shared/layout/nav-icons';
import { openExternalWindow } from '@/shared/layout/AppBrowserTabBar';
import { SidebarContextMenu, type ContextMenuTarget } from '@/shared/layout/SidebarContextMenu';
import { useTabsStore } from '@/stores/tabs-store';
import { toast } from '@/shared/components/system-alert';

import { translateUiText } from '@/lib/auto-translator';

function formatWorkspaceName(name: string, isEn = false) {
  if (isEn) {
    const translated = translateUiText(name);
    return translated || name;
  }
  const match = name.match(/^(.*?) (ل\S+.*)$/);
  if (match) {
    return (
      <>
        {match[1]}<br />{match[2]}
      </>
    );
  }
  return name;
}

export function AppShell({ children }: PropsWithChildren) {
  const { t: __t } = useTranslation();
  const { t, i18n } = useTranslation();
  const isEn = Boolean(i18n.language && i18n.language.startsWith('en'));

  useEffect(() => {
    const targetDir = isEn ? 'ltr' : 'rtl';
    const targetLang = isEn ? 'en' : 'ar';
    if (document.documentElement.dir !== targetDir) {
      document.documentElement.dir = targetDir;
    }
    if (document.documentElement.lang !== targetLang) {
      document.documentElement.lang = targetLang;
    }
  }, [isEn]);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const tenant = useAuthStore((state) => state.tenant);
  const { data: settings } = useSettingsQuery();
  const storeName = useAuthStore((state) => state.storeName);
  const isEtaActive = useAuthStore((state) => state.isEtaActive);
  const clearSession = useAuthStore((state) => state.clearSession);
  const deploymentMode = useAuthStore((state) => state.activationStatus?.deploymentMode);
  const { data: updateInfo } = useOfflineUpdateCheck(deploymentMode);

  const pendingOrdersCountQuery = useQuery({
    queryKey: ['storefront-admin-orders-count'],
    queryFn: async () => {
      try {
        const res = await http<{ counts: Record<string, number> }>('/api/storefront/admin/orders/counts');
        return res.counts?.pending || 0;
      } catch {
        return 0;
      }
    },
    refetchInterval: 20 * 1000,
    staleTime: 15 * 1000,
  });
  const pendingOrdersCount = pendingOrdersCountQuery.data || 0;

  const displayName = user?.displayName || user?.username || 'المستخدم';
  const workspaceName = storeName || DEFAULT_STORE_NAME;
  const isPosRoute = location.pathname.startsWith('/pos');
  const [isPosChromeHidden, setIsPosChromeHidden] = useState(false);
  const [quickAttendanceOpen, setQuickAttendanceOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') return window.localStorage.getItem('zsystems_sidebar_collapsed') === 'true';
    return false;
  });

  const tabsStore = useTabsStore();
  const [sidebarContextMenu, setSidebarContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    target: ContextMenuTarget | null;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    target: null,
  });

  const isPlatformUser = isPlatformAdmin(user);
  const isTenantAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const previewOnboarding = new URLSearchParams(location.search).get('onboarding') === '1';
  const hasEstablishedStoreData = Boolean(
    (settings?.storeName && settings.storeName !== 'Z Systems' && settings.storeName !== 'المتجر الافتراضي' && settings.storeName.trim().length > 0) ||
    settings?.phone ||
    settings?.address ||
    settings?.logoData ||
    settings?.taxNumber
  );
  const shouldRedirectToOnboarding = previewOnboarding || (!isPlatformUser && isTenantAdmin && settings && (settings as any).onboardingCompleted !== true && (settings as any).onboardingCompleted !== 'true' && !hasEstablishedStoreData);

  useEffect(() => {
    if (shouldRedirectToOnboarding && location.pathname !== '/onboarding') {
      navigate('/onboarding', { replace: true });
    }
  }, [shouldRedirectToOnboarding, location.pathname, navigate]);

  const [isMobileScreen, setIsMobileScreen] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth <= 900;
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobileScreen(window.innerWidth <= 900);
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const effectiveSidebarCollapsed = isMobileScreen ? false : isSidebarCollapsed;
  
  const { isMobileSidebarOpen, setMobileSidebarOpen } = useToolbarStore();

  useEffect(() => {
    // Close mobile sidebar on route change
    setMobileSidebarOpen(false);
  }, [location.pathname, setMobileSidebarOpen]);

  const [isSidebarSearchOpen, setIsSidebarSearchOpen] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarSearchInputRef = useRef<HTMLInputElement>(null);
  const sidebarSearchWrapperRef = useRef<HTMLDivElement>(null);

  const handleOpenSidebarSearch = () => {
    if (isSidebarCollapsed) {
      setIsSidebarCollapsed(false);
      window.localStorage.setItem('zsystems_sidebar_collapsed', 'false');
    }
    setIsSidebarSearchOpen(true);
    setTimeout(() => {
      sidebarSearchInputRef.current?.focus();
    }, 60);
  };

  const handleCloseSidebarSearch = () => {
    setIsSidebarSearchOpen(false);
    setSidebarSearchQuery('');
  };

  // Close search on route changes
  useEffect(() => {
    if (isSidebarSearchOpen) {
      setIsSidebarSearchOpen(false);
      setSidebarSearchQuery('');
    }
  }, [location.pathname]);

  // Close search when clicking outside the sidebar
  useEffect(() => {
    if (!isSidebarSearchOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        handleCloseSidebarSearch();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSidebarSearchOpen]);

  // Close search when collapsed
  useEffect(() => {
    if (isSidebarCollapsed && isSidebarSearchOpen) {
      handleCloseSidebarSearch();
    }
  }, [isSidebarCollapsed, isSidebarSearchOpen]);

  const toggleSidebar = () => {
    if (isSidebarSearchOpen) {
      handleCloseSidebarSearch();
    }
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem('zsystems_sidebar_collapsed', String(next));
      return next;
    });
  };

  const visibleNavigationItems = useMemo(() => {
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

    const warehousingOrder = [
      'dashboard',
      'inventory-warehouses',
      'inventory-issue-orders',
      'inventory',
      'inventory-tree',
      'inventory-bins',
      'products',
      'product-categories',
      'purchases-orders',
      'purchases',
      'purchases-new',
      'purchases-reorder',
      'purchase-returns',
      'suppliers',
      'sales-orders',
      'sales',
      'quotations',
      'customers',
      'returns',
      'treasury',
      'expenses',
      'accounts',
      'accounting-payment-allocation',
      'accounting-bank-reconciliation',
      'accounting-cheques',
      'accounting-aged-debts',
      'vat-declaration',
      'accounting-journal-entries',
      'accounting-accounts',
      'accounting-cost-centers',
      'accounting-fixed-assets',
      'reports-overview',
      'reports-inventory',
      'reports-purchases',
      'reports-sales',
      'reports-treasury',
      'reports-balances',
      'reports-employees',
      'hr',
      'audit',
      'apps',
      'settings',
      'saas-admin-tenants',
      'saas-admin-plans',
    ];

    const wholesaleVanOrder = [
      'dashboard',
      'van-sales-admin',
      'delivery-reps',
      'inventory-warehouses',
      'inventory-issue-orders',
      'inventory',
      'inventory-tree',
      'inventory-issue-orders',
      'customers',
      'sales',
      'returns',
      'sales-orders',
      'quotations',
      'price-lists',
      'purchases-orders',
      'purchases',
      'purchases-new',
      'purchases-reorder',
      'purchase-returns',
      'suppliers',
      'products',
      'product-categories',
      'treasury',
      'expenses',
      'accounts',
      'accounting-payment-allocation',
      'accounting-bank-reconciliation',
      'accounting-cheques',
      'accounting-aged-debts',
      'vat-declaration',
      'accounting-journal-entries',
      'accounting-accounts',
      'reports-overview',
      'reports-sales',
      'reports-purchases',
      'reports-inventory',
      'reports-treasury',
      'reports-balances',
      'reports-employees',
      'hr',
      'hr-settlements',
      'audit',
      'apps',
      'settings',
      'saas-admin-tenants',
      'saas-admin-plans',
    ];

    const contractingOrder = [
      'dashboard',
      'contracting-projects',
      'contracting-boq',
      'contracting-financials',
      'contracting-procurement',
      'contracting-field',
      'contracting-master-boq',
      'contracting-invoices',
      'contracting-change-orders',
      'contracting-subcontracts',
      'contracting-daily-logs',
      'contracting-rfis',
      'crm',
      'customers',
      'purchases-orders',
      'purchases-rfqs',
      'purchases',
      'purchases-new',
      'purchases-reorder',
      'purchase-returns',
      'suppliers',
      'products',
      'product-new',
      'product-categories',
      'inventory-warehouses',
      'inventory-tree',
      'inventory-bins',
      'inventory-issue-orders',
      'inventory-issue-order-new',
      'inventory',
      'pricing-center',
      'treasury',
      'expenses',
      'accounts',
      'accounting-payment-allocation',
      'accounting-bank-reconciliation',
      'accounting-cheques',
      'accounting-withholding-tax',
      'accounting-balance-sheet',
      'accounting-cash-flow',
      'accounting-aged-debts',
      'vat-declaration',
      'accounting-journal-entries',
      'accounting-accounts',
      'accounting-cost-centers',
      'accounting-fixed-assets',
      'accounting-settings',
      'reports-overview',
      'reports-purchases',
      'reports-inventory',
      'reports-treasury',
      'reports-balances',
      'reports-employees',
      'hr',
      'hr-settlements',
      'audit',
      'apps',
      'settings',
      'saas-admin-tenants',
      'saas-admin-plans',
    ];

    const maritimeOrder = [
      'dashboard',
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
      'crm',
      'quotations',
      'sales',
      'customers',
      'purchases-orders',
      'purchases-rfqs',
      'purchases',
      'purchases-new',
      'suppliers',
      'treasury',
      'expenses',
      'accounts',
      'accounting-payment-allocation',
      'accounting-bank-reconciliation',
      'accounting-cheques',
      'accounting-balance-sheet',
      'accounting-cash-flow',
      'accounting-aged-debts',
      'vat-declaration',
      'accounting-journal-entries',
      'accounting-accounts',
      'accounting-cost-centers',
      'accounting-settings',
      'reports-overview',
      'reports-sales',
      'reports-purchases',
      'reports-treasury',
      'reports-balances',
      'reports-employees',
      'hr',
      'hr-settlements',
      'audit',
      'apps',
      'settings',
      'saas-admin-tenants',
      'saas-admin-plans',
    ];

    const manufacturingOrder = [
      'dashboard',
      'manufacturing-work-orders',
      'manufacturing-boms',
      'manufacturing-components',
      'manufacturing-work-centers',
      'manufacturing-settings',
      'crm',
      'customers',
      'purchases-orders',
      'purchases-rfqs',
      'purchases',
      'purchases-new',
      'purchases-reorder',
      'purchase-returns',
      'suppliers',
      'products',
      'product-new',
      'product-categories',
      'inventory-warehouses',
      'inventory-bins',
      'inventory-tree',
      'inventory-issue-orders',
      'inventory-issue-order-new',
      'inventory',
      'treasury',
      'expenses',
      'accounts',
      'accounting-payment-allocation',
      'accounting-bank-reconciliation',
      'accounting-cheques',
      'accounting-withholding-tax',
      'accounting-balance-sheet',
      'accounting-cash-flow',
      'accounting-aged-debts',
      'accounting-fixed-assets',
      'vat-declaration',
      'accounting-journal-entries',
      'accounting-accounts',
      'accounting-cost-centers',
      'accounting-settings',
      'reports-overview',
      'reports-purchases',
      'reports-inventory',
      'reports-sales',
      'reports-treasury',
      'reports-balances',
      'reports-employees',
      'hr',
      'hr-settlements',
      'audit',
      'apps',
      'settings',
      'saas-admin-tenants',
      'saas-admin-plans',
    ];

    const importOrder = [
      'dashboard',
      'pos',
      'cash-drawer',
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
      'purchases-orders',
      'purchases-rfqs',
      'purchases',
      'purchases-new',
      'purchases-reorder',
      'purchase-returns',
      'suppliers',
      'products',
      'product-new',
      'product-categories',
      'inventory-warehouses',
      'inventory-bins',
      'inventory-tree',
      'inventory-issue-orders',
      'inventory-issue-order-new',
      'inventory',
      'pricing-center',
      'crm',
      'quotations',
      'sales-orders',
      'price-lists',
      'sales',
      'returns',
      'customers',
      'treasury',
      'expenses',
      'accounts',
      'accounting-payment-allocation',
      'accounting-bank-reconciliation',
      'accounting-cheques',
      'accounting-withholding-tax',
      'accounting-balance-sheet',
      'accounting-cash-flow',
      'accounting-aged-debts',
      'vat-declaration',
      'accounting-journal-entries',
      'accounting-accounts',
      'accounting-cost-centers',
      'accounting-fixed-assets',
      'accounting-settings',
      'reports-overview',
      'reports-purchases',
      'reports-inventory',
      'reports-sales',
      'reports-treasury',
      'reports-balances',
      'reports-employees',
      'hr',
      'hr-settlements',
      'audit',
      'apps',
      'settings',
      'saas-admin-tenants',
      'saas-admin-plans',
    ];

    const servicesOrder = [
      'dashboard',
      'services',
      'crm',
      'quotations',
      'sales',
      'customers',
      'purchases-orders',
      'purchases-rfqs',
      'purchases',
      'purchases-new',
      'suppliers',
      'treasury',
      'expenses',
      'accounts',
      'accounting-payment-allocation',
      'accounting-bank-reconciliation',
      'accounting-cheques',
      'accounting-balance-sheet',
      'accounting-cash-flow',
      'accounting-aged-debts',
      'vat-declaration',
      'accounting-journal-entries',
      'accounting-accounts',
      'accounting-cost-centers',
      'accounting-settings',
      'reports-overview',
      'reports-sales',
      'reports-purchases',
      'reports-treasury',
      'reports-balances',
      'reports-employees',
      'hr',
      'hr-settlements',
      'audit',
      'apps',
      'settings',
      'saas-admin-tenants',
      'saas-admin-plans',
    ];

    const standardOrder = [
      // Quick primary actions
      'dashboard',
      'pos',
      'online-orders',
      'cash-drawer',
      'sales-workspace',

      // 1. Sales & Customers
      'crm',
      'quotations',
      'sales-orders',
      'price-lists',
      'sales',
      'returns',
      'installments',
      'customers',
      'delivery-reps',
      'van-sales-admin',
      'tax-dispatcher',
      'signage',

      // 2. Purchases & Suppliers
      'purchases-rfqs',
      'purchases-orders',
      'purchases-reorder',
      'purchases',
      'purchases-new',
      'purchase-returns',
      'suppliers',

      // 3. Products & Inventory
      'products',
      'product-new',
      'product-categories',
      'product-modifiers',
      'services',
      'pricing-center',
      'inventory',
      'inventory-issue-orders',
      'inventory-warehouses',
      'inventory-bins',
      'inventory-tree',
      'inventory-issue-order-new',

      // 4. Finance & Accounting
      'treasury',
      'expenses',
      'accounts',
      'accounting-payment-allocation',
      'accounting-bank-reconciliation',
      'accounting-cheques',
      'accounting-withholding-tax',
      'accounting-balance-sheet',
      'accounting-cash-flow',
      'accounting-aged-debts',
      'vat-declaration',
      'accounting-journal-entries',
      'accounting-accounts',
      'accounting-cost-centers',
      'accounting-fixed-assets',
      'accounting-settings',

      // 5. Restaurant (Conditional)
      'kds',

      // 6. Mobile & Devices (Conditional)
      'maintenance',
      'trade-in',
      'imei-history',

      // 7. Pharmacy & Medications (Conditional)
      'pharmacy-dashboard',
      'pharmacy-drugs',
      'pharmacy-prescriptions',
      'pharmacy-shortages',
      'pharmacy-batches',
      'pharmacy-clinical',

      // 8. Import & Containers (Conditional)
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

      // 9. Manufacturing (Conditional)
      'manufacturing-components',
      'manufacturing-work-orders',
      'manufacturing-boms',
      'manufacturing-work-centers',
      'manufacturing-settings',

      // 10. Reports & Analytics
      'reports-overview',
      'reports-sales',
      'reports-purchases',
      'reports-inventory',
      'reports-treasury',
      'reports-balances',
      'reports-employees',

      // 11. Admin & System
      'hr',
      'hr-settlements',
      'audit',
      'apps',
      'settings',
      'saas-admin-tenants',
      'saas-admin-plans',
    ];

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

      // 1. Strict Plan-Tier Entitlement: if tenant has an explicit features payload from the active plan
      if (Array.isArray(tenant?.features) && tenant.features.length > 0 && !isImportVertical) {
        if (['catalog', 'products', 'sales'].includes(feat)) {
          return true;
        }
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
        // INV-STOREFRONT-ORDERS: no feature/settings gate on the recorded-orders list —
        // it is the tenant's own order record, not a storefront feature. 'online-orders'
        // is removed from every per-vertical disallowed list above for the same reason,
        // so an admin can always reach orders recorded while the storefront was on.
        // The 'sales' permission still gates the item via canAccessNavigationItem.
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
        if ((item.key === 'pos' || item.key === 'cash-drawer') && (settings?.posModuleEnabled === false || isWholesaleVanVertical || isWarehousingVertical)) return false;
        if ((item.key === 'sales' || item.key === 'returns') && settings?.posModuleEnabled === false && !isWholesaleVanVertical && !isWarehousingVertical && !isImportVertical && !isEnterpriseCommerceActive) return false;
        if (item.key === 'customers' && settings?.posModuleEnabled === false && !isEnterpriseCommerceActive && settings?.installmentsModuleEnabled === false && !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isImportVertical && !isWholesaleVanVertical && !isWarehousingVertical) return false;

        // Enterprise Sales gating (CRM, Sales Orders, Price Lists, Quotations):
        if (item.key === 'crm' && !isMaritimeVertical && !isContractingVertical && !isImportVertical && !isManufacturingVertical && !isServicesVertical && (!isEnterpriseCommerceActive || settings?.crmModuleEnabled !== true)) return false;
        if ((item.key === 'sales-orders' || item.key === 'price-lists' || item.key === 'quotations') && !isMaritimeVertical && !isContractingVertical && !isManufacturingVertical && !isImportVertical && !isWarehousingVertical && !isEnterpriseCommerceActive) return false;

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
      .map((item) => ({ ...item, label: labelOverrides[item.key] || t(`sidebar.${item.key}`, item.label) }))
      .sort((a, b) => {
        const aIndex = preferredOrder.indexOf(a.key);
        const bIndex = preferredOrder.indexOf(b.key);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      });
  }, [user, tenant?.features, tenant?.activityType, tenant?.pillar, t, isEtaActive, settings?.activityType, settings?.businessIndustry, settings?.posModuleEnabled, settings?.importModuleEnabled, settings?.enableMobileStoreFeatures, settings?.maintenanceProfile, settings?.enablePharmacyModule, settings?.manufacturingModuleEnabled, settings?.servicesModuleEnabled, settings?.storefrontModuleEnabled, settings?.installmentsModuleEnabled, settings?.fixedAssetsModuleEnabled, settings?.taxDeclarationModuleEnabled, settings?.deliveryFleetModuleEnabled, settings?.deliveryRepsModuleEnabled, settings?.vanSalesModuleEnabled, settings?.purchasesModuleEnabled, settings?.inventoryModuleEnabled, settings?.hrModuleEnabled, settings?.enableEnterpriseFeatures, settings?.restaurantModuleEnabled, settings?.maritimeFreightModuleEnabled, settings?.contractingModuleEnabled]);

  const navigationMap = useMemo(() => new Map(visibleNavigationItems.map((item) => [item.key, item])), [visibleNavigationItems]);
  const primaryNavigationKeys = useMemo(() => {
    const isPlatformAdminUser = isPlatformAdmin(user);
    const hasReports = isPlatformAdminUser || Boolean(tenant?.features?.includes('reports'));
    const dashKeys = hasReports ? ['dashboard'] : [];

    const currentVertical = resolveCurrentVertical(tenant, settings);
    const isWholesaleVanVertical = currentVertical === 'wholesale_van';

    // INV-STOREFRONT-ORDERS: 'online-orders' is the tenant's own recorded-orders
    // list, not a storefront feature — it is a primary shortcut in every vertical
    // (and unconditional below), so an admin can always reach orders recorded
    // while the storefront was on. The 'sales' permission still gates it in the
    // sidebar filter, and the route itself is permission-gated too.
    if (currentVertical === 'contracting') {
      return [...dashKeys, 'online-orders', 'contracting-projects', 'contracting-boq'];
    }

    if (currentVertical === 'maritime') {
      return [...dashKeys, 'online-orders'];
    }

    if (currentVertical === 'manufacturing') {
      return [...dashKeys, 'online-orders', 'manufacturing-work-orders', 'manufacturing-boms'];
    }

    if (currentVertical === 'import_export') {
      const hasPos = settings?.posModuleEnabled !== false;
      return [...dashKeys, 'online-orders', ...(hasPos ? ['pos', 'cash-drawer'] : [])];
    }

    if (isWholesaleVanVertical) {
      return [...dashKeys, 'online-orders', 'van-sales-admin'];
    }

    if (currentVertical === 'warehousing') {
      return [...dashKeys, 'online-orders', 'inventory', 'inventory-warehouses', 'purchases'];
    }

    if (currentVertical === 'services') {
      const hasPos = Boolean(tenant?.features?.includes('pos'));
      return [...dashKeys, 'online-orders', 'services', ...(hasPos ? ['pos', 'cash-drawer'] : [])];
    }

    if (settings?.posModuleEnabled === false) {
      return [
        ...dashKeys,
        'online-orders',
        ...(settings?.purchasesModuleEnabled ? ['purchases'] : []),
      ];
    }
    return [...dashKeys, 'pos', 'online-orders', 'cash-drawer'];
  }, [settings?.businessIndustry, settings?.activityType, settings?.contractingModuleEnabled, settings?.maritimeFreightModuleEnabled, settings?.importModuleEnabled, settings?.posModuleEnabled, settings?.purchasesModuleEnabled, settings?.storefrontModuleEnabled, settings?.deliveryRepsModuleEnabled, settings?.vanSalesModuleEnabled, settings?.deliveryFleetModuleEnabled, tenant?.features, tenant?.activityType, tenant?.pillar, tenant?.businessName, user]);

  const sidebarGroups = useMemo<SidebarGroupDefinition[]>(() => {
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

  const visiblePrimaryNavigationItems = useMemo(() => primaryNavigationKeys.map((key) => navigationMap.get(key)).filter((item): item is NonNullable<typeof item> => Boolean(item)), [navigationMap, primaryNavigationKeys]);

  // Constitutional Zero-Duplication Invariant (دستور منع التكرار الصارم في القوائم الجانبية):
  // 1. Any item already displayed in primary navigation (top shortcuts) is strictly excluded from all collapsible sidebar groups.
  // 2. Each item key can appear at most once across the entire sidebar (inter-group deduplication).
  // 3. Groups with 0 items remaining after deduplication are cleanly omitted.
  const deduplicatedSidebarGroups = useMemo(() => {
    const claimedKeys = new Set<string>(visiblePrimaryNavigationItems.map((item) => item.key));
    return sidebarGroups
      .map((group) => {
        const uniqueItemKeys = group.itemKeys.filter((key) => {
          if (claimedKeys.has(key)) return false;
          claimedKeys.add(key);
          return true;
        });
        return {
          ...group,
          itemKeys: uniqueItemKeys,
        };
      })
      .filter((group) => group.itemKeys.length > 0);
  }, [sidebarGroups, visiblePrimaryNavigationItems]);

  const activeSidebarGroupKey = useMemo(() => deduplicatedSidebarGroups.find((group) => group.itemKeys.some((itemKey) => {
    const navItem = navigationMap.get(itemKey);
    if (!navItem) return false;
    if (navItem.activePaths?.includes(location.pathname)) return true;
    const navBasePath = navItem.to.split('?')[0];
    if (navItem.end) return location.pathname === navBasePath;
    return location.pathname === navBasePath || location.pathname.startsWith(`${navBasePath}/`);
  }))?.key ?? null, [deduplicatedSidebarGroups, location.pathname, navigationMap]);

  const normalizedSidebarQuery = useMemo(() => normalizeArabicSearchKey(sidebarSearchQuery), [sidebarSearchQuery]);
  const isSearchingSidebar = normalizedSidebarQuery.length > 0;

  const filteredPrimaryNavigationItems = useMemo(() => {
    if (!isSearchingSidebar) return visiblePrimaryNavigationItems;
    return visiblePrimaryNavigationItems.filter((item) => 
      normalizeArabicSearchKey(item.label).includes(normalizedSidebarQuery)
    );
  }, [isSearchingSidebar, normalizedSidebarQuery, visiblePrimaryNavigationItems]);

  const filteredSidebarGroups = useMemo(() => {
    return deduplicatedSidebarGroups.map((group) => {
      const groupItems = group.itemKeys.map((key) => navigationMap.get(key)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (!groupItems.length) return null;

      if (!isSearchingSidebar) {
        return {
          group,
          groupItems,
          isActive: activeSidebarGroupKey === group.key,
          isOpen: !effectiveSidebarCollapsed,
        };
      }

      const matchingItems = groupItems.filter((item) => 
        normalizeArabicSearchKey(item.label).includes(normalizedSidebarQuery) ||
        normalizeArabicSearchKey(group.label).includes(normalizedSidebarQuery)
      );

      if (matchingItems.length === 0) return null;

      return {
        group,
        groupItems: matchingItems,
        isActive: true,
        isOpen: true,
      };
    }).filter((g): g is NonNullable<typeof g> => Boolean(g));
  }, [activeSidebarGroupKey, deduplicatedSidebarGroups, effectiveSidebarCollapsed, isSearchingSidebar, navigationMap, normalizedSidebarQuery]);

  const totalMatchingItemsCount = filteredPrimaryNavigationItems.length + filteredSidebarGroups.reduce((acc, g) => acc + g.groupItems.length, 0);

  useEffect(() => {
    if (!isPosRoute) {
      setIsPosChromeHidden(false);
      return;
    }
    setIsPosChromeHidden(readPosShellPreference());
  }, [isPosRoute]);

  useEffect(() => {
    if (!isPosRoute || typeof window === 'undefined') return;
    window.localStorage.setItem(POS_SHELL_VISIBILITY_KEY, isPosChromeHidden ? 'hidden' : 'shown');
  }, [isPosChromeHidden, isPosRoute]);

  useEffect(() => {
    if (!isPosRoute || typeof window === 'undefined') return undefined;
    const toggleChrome = () => setIsPosChromeHidden((current) => !current);
    const toggleFullscreen = async () => {
      try {
        const electronRuntime = (window as any).electronRuntime;
        if (electronRuntime && typeof electronRuntime.toggleFullScreen === 'function') {
          const isFS = await electronRuntime.toggleFullScreen();
          setIsPosChromeHidden(Boolean(isFS));
          return;
        }
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen?.();
          if ('keyboard' in navigator && typeof (navigator as any).keyboard?.lock === 'function') {
            try {
              await (navigator as any).keyboard.lock(['Escape']);
            } catch {
              // ignore
            }
          }
          setIsPosChromeHidden(true);
          return;
        }
        if ('keyboard' in navigator && typeof (navigator as any).keyboard?.unlock === 'function') {
          try {
            (navigator as any).keyboard.unlock();
          } catch {
            // ignore
          }
        }
        await document.exitFullscreen?.();
        setIsPosChromeHidden(false);
      } catch {
        // ignore fullscreen errors triggered by browser policies
      }
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'F10') {
        event.preventDefault();
        toggleChrome();
        return;
      }
      if (event.key === 'F11') {
        // In Electron, F11 is already handled by main process, but for browser fallback:
        const electronRuntime = (window as any).electronRuntime;
        if (!electronRuntime) {
          event.preventDefault();
          void toggleFullscreen();
        }
      }
    };
    const handleFullscreenChange = async () => {
      if (document.fullscreenElement) {
        if ('keyboard' in navigator && typeof (navigator as any).keyboard?.lock === 'function') {
          try {
            await (navigator as any).keyboard.lock(['Escape']);
          } catch {
            // ignore
          }
        }
        setIsPosChromeHidden(true);
        return;
      }
      if ('keyboard' in navigator && typeof (navigator as any).keyboard?.unlock === 'function') {
        try {
          (navigator as any).keyboard.unlock();
        } catch {
          // ignore
        }
      }
      setIsPosChromeHidden(readPosShellPreference());
    };
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener(POS_TOGGLE_CHROME_EVENT, toggleChrome);
    window.addEventListener(POS_TOGGLE_FULLSCREEN_EVENT, toggleFullscreen);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const electronRuntime = (window as any).electronRuntime;
    let unsubscribeElectronFs: (() => void) | undefined;
    if (electronRuntime && typeof electronRuntime.onFullScreenChange === 'function') {
      unsubscribeElectronFs = electronRuntime.onFullScreenChange((isFS: boolean) => {
        setIsPosChromeHidden(Boolean(isFS));
      });
    }

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener(POS_TOGGLE_CHROME_EVENT, toggleChrome);
      window.removeEventListener(POS_TOGGLE_FULLSCREEN_EVENT, toggleFullscreen);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (unsubscribeElectronFs) unsubscribeElectronFs();
    };
  }, [isPosRoute]);

  useEffect(() => {
    const contentWrap = document.querySelector('.content-wrap') as HTMLElement | null;
    if (contentWrap && contentWrap.scrollTop > 0) {
      contentWrap.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }, [location.pathname]);

  // Dynamic Browser Tab Title based on active page/tab (Lightweight Native DOM property)
  const toolbarBreadcrumbs = useToolbarStore((state) => state.breadcrumbs);
  useEffect(() => {
    let activeLabel = '';

    // 1. Check custom toolbar breadcrumbs set by the active page (most accurate)
    if (toolbarBreadcrumbs && toolbarBreadcrumbs.length > 0) {
      const lastCrumb = toolbarBreadcrumbs[toolbarBreadcrumbs.length - 1];
      if (lastCrumb?.label && lastCrumb.label !== 'الرئيسية') {
        activeLabel = lastCrumb.label;
      }
    }

    // 2. Check visible sidebar navigation items matching current route (exact match first, then longest prefix)
    if (!activeLabel) {
      const exactMatch = visibleNavigationItems.find((item) => item.to === location.pathname || item.activePaths?.includes(location.pathname));
      const prefixMatch = exactMatch || visibleNavigationItems
        .filter((item) => item.to && item.to !== '/' && item.to !== '/dashboard' && !item.end && location.pathname.startsWith(`${item.to}/`))
        .sort((a, b) => b.to.length - a.to.length)[0];
      if (prefixMatch?.label) {
        activeLabel = prefixMatch.label;
      }
    }

    // 3. Fallback to route breadcrumb rules
    if (!activeLabel) {
      const autoCrumbs = resolveAutoBreadcrumbs(location.pathname, []);
      if (autoCrumbs.length > 0) {
        const candidate = autoCrumbs[autoCrumbs.length - 1];
        if (candidate?.label && candidate.label !== 'الرئيسية') {
          activeLabel = candidate.label;
        }
      }
    }

    // Update document title natively and smoothly
    if (activeLabel) {
      document.title = `Z-ERP | ${activeLabel}`;
    } else {
      document.title = 'Z-ERP';
    }
  }, [location.pathname, toolbarBreadcrumbs, visibleNavigationItems]);

  useEffect(() => {
    try {
      const currentVer = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.21';
      localStorage.setItem('zs.app_display_version', currentVer);
    } catch {}
  }, []);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'));
    };
    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      
      // Quick Attendance: Alt + Shift + F9
      if (event.altKey && event.shiftKey && event.key === 'F9') {
        event.preventDefault();
        setQuickAttendanceOpen(true);
        return;
      }

      // Global Navigation Back: Alt + Backspace | Alt + LeftArrow | Alt + RightArrow
      if (
        (event.altKey && event.key === 'Backspace') ||
        (event.altKey && event.key === 'ArrowLeft') ||
        (event.altKey && event.key === 'ArrowRight')
      ) {
        event.preventDefault();
        if (window.history.length > 1 && window.history.state?.idx > 0) {
          navigate(-1);
        } else {
          navigate('/dashboard');
        }
      }
    };
    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
  }, [navigate]);

  async function handleLogout() {
    try {
      await authApi.logout();
    } finally {
      await resetAuthenticatedClient(queryClient, clearSession);
      navigate('/login?reason=signed-out', { replace: true });
    }
  }

  const cleanWorkspaceName = workspaceName.replace(/^\s*["'”“]+|["'”“]+\s*$/g, '').trim() || workspaceName;

  function renderNavItem(item: NonNullable<(typeof visibleNavigationItems)[number]>, keyPrefix: string) {
    const computeActive = (isActive: boolean) => {
      if (item.to.includes('?')) {
        const [itemBasePath, itemQuery] = item.to.split('?');
        if (location.pathname !== itemBasePath) return false;
        const itemParams = new URLSearchParams(itemQuery);
        const currentParams = new URLSearchParams(location.search);
        const targetTab = itemParams.get('tab');
        const defaultTab = location.pathname.includes('contracting') ? 'projects' : 'rfqs';
        const currentTab = currentParams.get('tab') || defaultTab;
        return currentTab === targetTab;
      }
      if (item.activePaths?.includes(location.pathname)) return true;
      if (isActive && item.to !== location.pathname) {
        const hasMoreSpecificItem = visibleNavigationItems.some(
          (other) => other.key !== item.key && (other.to === location.pathname || other.activePaths?.includes(location.pathname))
        );
        if (hasMoreSpecificItem) return false;
      }
      return isActive;
    };

    return (
      <NavLink 
        key={`${keyPrefix}-${item.key}`} 
        to={item.to} 
        end={item.end ?? (item.key === 'hr' || item.key === 'dashboard')} 
        data-key={item.key} 
        data-tooltip={effectiveSidebarCollapsed ? item.label : undefined}
        style={({ isActive }) => {
          const isPathActive = computeActive(isActive);
          const tone = isPathActive ? activeIconTone : defaultIconTone;
          return { '--icon-bg': tone.bg, '--icon-border': tone.border, '--icon-fg': tone.fg, '--icon-glow': tone.glow } as CSSProperties;
        }} 
        onMouseEnter={() => prefetchRouteData(item.to)}
        onFocus={() => prefetchRouteData(item.to)}
        onTouchStart={() => prefetchRouteData(item.to)}
        onContextMenu={(e) => {
          e.preventDefault();
          setSidebarContextMenu({
            isOpen: true,
            position: { x: e.clientX, y: e.clientY },
            target: {
              path: item.to,
              label: item.label,
              iconKey: item.key,
            },
          });
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            const { id } = tabsStore.openTab({
              path: item.to,
              title: item.label,
              iconKey: item.key,
              makeActive: true,
            });
            tabsStore.setActiveTabId(id);
            navigate(item.to);
          }
        }}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault();
        }} 
        onClick={() => {
          tabsStore.syncCurrentRoute(item.to, item.label, item.key);
          if (isSidebarSearchOpen) {
            setTimeout(() => {
              handleCloseSidebarSearch();
            }, 0);
          }
        }}
        className={({ isActive }) => {
          const isPathActive = computeActive(isActive);
          return `sidebar-link ${keyPrefix === 'group' ? 'sidebar-link-sub ' : ''}${isPathActive ? 'active' : ''}`.trim();
        }}
      >
        <span className="sidebar-icon"><AppNavIcon itemKey={item.key} /></span>
        <span className="sidebar-label">{item.label}</span>
        {item.key === 'online-orders' && pendingOrdersCount > 0 && (
          <span
            style={{
              background: '#ef4444',
              color: '#ffffff',
              borderRadius: '999px',
              padding: '1px 7px',
              fontSize: '11px',
              fontWeight: 800,
              marginInlineStart: 'auto',
              boxShadow: '0 1px 4px rgba(239, 68, 68, 0.4)',
            }}
          >
            {pendingOrdersCount}
          </span>
        )}
        <span className="sidebar-link-chevron-spacer" aria-hidden="true" />
      </NavLink>
    );
  }

  return (
    <div 
      dir={isEn ? 'ltr' : 'rtl'}
      className={`app-layout ${effectiveSidebarCollapsed ? 'sidebar-collapsed' : ''} ${isPosRoute ? 'app-layout-pos' : ''} ${isPosRoute && isPosChromeHidden ? 'app-layout-pos-focus' : ''}`.trim()}
    >
      {(!isPosRoute || (!isPosChromeHidden && !isMobileScreen && !isStandalonePosTerminal())) ? (
        <>
          <aside ref={sidebarRef} className={`sidebar-fixed ${isMobileSidebarOpen ? 'is-mobile-open' : ''}`.trim()}>
            <div className="brand">
              <div 
                className="brand-logo" 
                onClick={() => navigate('/')} 
                style={{ cursor: 'pointer' }}
              >
                <img 
                  src="./brand/z-erp-approved-icon.png" 
                  alt="Z-ERP" 
                  className="brand-logo-img"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.dataset.failed) {
                      img.dataset.failed = '1';
                      img.src = '/brand/z-erp-approved-icon.png';
                    }
                  }}
                />
              </div>
              <div className="brand-copy" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', flex: '1 1 auto', minWidth: 0 }}>
                <div className="brand-title" style={{ textAlign: 'center', width: '100%' }} title={isEn ? (translateUiText(cleanWorkspaceName) || cleanWorkspaceName) : cleanWorkspaceName}>{formatWorkspaceName(cleanWorkspaceName, isEn)}</div>
                <div 
                  className="brand-sub-interactive" 
                  onClick={() => setIsAboutModalOpen(true)}
                  title="About Z-Systems & Tech Support"
                  style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', margin: '0 auto' }}
                >
                  <span className="brand-powered-label" style={{ textAlign: 'center', width: '100%', display: 'block' }}>Powered by</span>
                  <span className="brand-powered-name" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', textAlign: 'center' }}>
                    Z-Systems
                  </span>
                </div>
              </div>
              <div className="brand-logo-spacer" aria-hidden="true" />
            </div>

          {/* Centered Expandable Search Micro-Interaction */}
          <div ref={sidebarSearchWrapperRef} className="sidebar-search-wrapper">
            <div 
              className={`sidebar-search-pill ${isSidebarSearchOpen ? 'is-expanded' : ''}`}
              onClick={() => {
                if (!isSidebarSearchOpen) handleOpenSidebarSearch();
              }}
            >
              <button 
                type="button" 
                className="sidebar-search-icon-btn" 
                data-tooltip={effectiveSidebarCollapsed ? (isEn ? "Quick search (Ctrl + K)" : __t('shared.layout.app_shell.s0', "البحث السريع (Ctrl + K)")) : undefined}
                title={isSidebarSearchOpen ? (isEn ? 'Search' : __t('shared.layout.app_shell.s1', "بحث")) : (effectiveSidebarCollapsed ? undefined : (isEn ? 'Quick search in menus & tabs' : __t('shared.layout.app_shell.s2', "بحث سريع في القوائم والتابات")))}
                onClick={(e) => {
                  if (!isSidebarSearchOpen) {
                    e.stopPropagation();
                    handleOpenSidebarSearch();
                  }
                }}
              >
                <SearchIcon size={16} color="#2563eb" strokeWidth={2.4} />
              </button>
              {isSidebarSearchOpen ? (
                <>
                  <input
                    ref={sidebarSearchInputRef}
                    type="text"
                    className="sidebar-search-input"
                    placeholder={isEn ? "Search in tabs & menus..." : __t('shared.layout.app_shell.s3', "ابحث في التابات والقوائم...")}
                    value={sidebarSearchQuery}
                    onChange={(e) => setSidebarSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        handleCloseSidebarSearch();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="sidebar-search-close-btn"
                    title={isEn ? "Close search" : __t('shared.layout.app_shell.s4', "إغلاق البحث")}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (sidebarSearchQuery) {
                        setSidebarSearchQuery('');
                        sidebarSearchInputRef.current?.focus();
                      } else {
                        handleCloseSidebarSearch();
                      }
                    }}
                  ><XIcon size={15} /></button>
                </>
              ) : (
                !effectiveSidebarCollapsed && (
                  <span className="sidebar-search-placeholder-text">
                    {isEn ? "Quick search in menus..." : __t('shared.layout.app_shell.s5', "بحث سريع في القوائم...")}
                  </span>
                )
              )}
            </div>
          </div>

          <nav className="sidebar-nav">
            {filteredPrimaryNavigationItems.map((item) => renderNavItem(item, 'primary'))}
            {filteredSidebarGroups.map(({ group, groupItems, isActive, isOpen }) => {
              const groupIconItemKey = group.iconKey || groupItems[0]?.key || 'settings';
              const tone = (isActive || isOpen) ? activeIconTone : defaultIconTone;
              const toneStyle = { '--icon-bg': tone.bg, '--icon-border': tone.border, '--icon-fg': tone.fg, '--icon-glow': tone.glow } as CSSProperties;
              const groupTitle = t(`sidebar.${group.key}`, group.label);
              return (
                <div key={group.key} className={`sidebar-group ${isActive ? 'is-active' : ''} ${isOpen ? 'is-open' : ''}`.trim()}>
                  <div 
                    className="sidebar-group-trigger" 
                    style={toneStyle}
                    data-tooltip={effectiveSidebarCollapsed ? groupTitle : undefined}
                    onClick={() => {
                      if (effectiveSidebarCollapsed) toggleSidebar();
                    }}
                    role={effectiveSidebarCollapsed ? 'button' : undefined}
                    tabIndex={effectiveSidebarCollapsed ? 0 : undefined}
                  >
                    <span className="sidebar-group-icon" aria-hidden="true"><AppNavIcon itemKey={groupIconItemKey} /></span>
                    <span className="sidebar-label">{groupTitle}</span>
                  </div>
                  {isOpen ? <div className="sidebar-group-items">{groupItems.map((item) => renderNavItem(item, 'group'))}</div> : null}
                </div>
              );
            })}
            {isSearchingSidebar && totalMatchingItemsCount === 0 ? (
              <div className="sidebar-search-empty-state">
                <span className="sidebar-search-empty-state-icon"><SearchIcon size={24} color="#94a3b8" /></span>
                <p className="sidebar-search-empty-state-text">{__t('shared.layout.app_shell.s6', "لا توجد قوائم تطابق \"")}{sidebarSearchQuery}"</p>
              </div>
            ) : null}
          </nav>
          <div className="sidebar-footer">
            <div className="sidebar-footer-info" style={{ marginBottom: 5 }}>
              <div className="muted small" style={{ lineHeight: 1.2 }}>{t("sidebar.welcome_msg")} {displayName}</div>
              <div className="muted small" style={{ opacity: 0.85, marginTop: 2, fontSize: '0.72rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span>{__t('shared.layout.app_shell.s7', "الإصدار:")} {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'}</span>
                {updateInfo?.updateAvailable && (
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--color-warning)', flexShrink: 0 }} title={__t('shared.layout.app_shell.s8', "تحديث جديد متاح")} />
                )}
              </div>
            </div>
            <div className="sidebar-footer-actions">
              <Button variant="danger" onClick={handleLogout} className="sidebar-logout-btn" data-tooltip={effectiveSidebarCollapsed ? t("sidebar.logout") : undefined}>
                <span className="btn-label">{t("sidebar.logout")}</span>
                <span className="btn-icon">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                </span>
              </Button>
              {!isMobileScreen && (
                <button type="button" onClick={toggleSidebar} className="sidebar-toggle-btn" data-tooltip={effectiveSidebarCollapsed ? t("sidebar.expand_menu") : undefined}>
                  {effectiveSidebarCollapsed ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                  )}
                </button>
              )}
            </div>
          </div>
        </aside>
        <div 
          className={`sidebar-mobile-overlay ${isMobileSidebarOpen ? 'is-active' : ''}`.trim()} 
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
        </>
      ) : null}
      <div className="main-col">
        {!isPosRoute && <GlobalAppToolbar />}
        <div className={`content-wrap ${isPosRoute ? 'content-wrap-pos' : ''} ${isPosRoute && isPosChromeHidden ? 'content-wrap-pos-focus' : ''}`.trim()}>
          {!isPosRoute && (
            <div className="stack gap-12" style={{ padding: '12px 16px 0' }}>
              <ImpersonationBanner />
              <BootstrapAdminBanner />
              <TrialStatusBanner />
              <SystemStatusBanner />
            </div>
          )}
          <main className={`page-stack ${isPosRoute ? 'page-stack-pos' : ''} ${isPosRoute && isPosChromeHidden ? 'page-stack-pos-focus' : ''}`.trim()}>{children}</main>
        </div>
      </div>
      {!isPosRoute && !isStandalonePosTerminal() && (isMobileScreen || !isPosChromeHidden) && <MobileBottomNav />}
      <PasswordRotationGate />
      <PwaInstallBanner />
      <QuickAttendanceShortcut open={quickAttendanceOpen} onClose={() => setQuickAttendanceOpen(false)} />
      <Suspense fallback={null}>
        <LiveOrderNotificationBanner />
        <GlobalSearchModal />
        <DeveloperActivationPanel />
      </Suspense>
      {isAboutModalOpen && (
        <DialogShell
          open={true}
          onClose={() => setIsAboutModalOpen(false)}
          width="460px"
        >
          <div style={{ textAlign: 'center', padding: '28px 24px 20px 24px' }}>
            <div style={{
              width: '84px',
              height: '84px',
              margin: '0 auto 14px auto',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 10px 25px rgba(15, 23, 42, 0.2)',
              padding: '10px'
            }}>
              <img 
                src="./brand/z-erp-approved-icon.png" 
                alt="Z Systems" 
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
            
            <h2 style={{ margin: '0 0 4px 0', fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
              Z Systems ERP
            </h2>
            <p style={{ margin: '0 0 14px 0', fontSize: '12.5px', color: '#64748b' }}>
              {__t('shared.layout.app_shell.s9', "منظومة إدارة المبيعات، المخازن، الحسابات، ونقاط البيع")}
            </p>

            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 14px',
              borderRadius: '20px',
              backgroundColor: '#f1f5f9',
              border: '1px solid #e2e8f0',
              fontSize: '12px',
              fontWeight: 700,
              color: '#334155',
              marginBottom: '18px'
            }}>
              <span>{__t('shared.layout.app_shell.s10', "الإصدار:")}</span>
              <span style={{ color: '#2563eb' }}>v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.14'}</span>
              <span style={{ color: '#10b981' }}>{__t('shared.layout.app_shell.s11', "● نسخة مفعلة")}</span>
            </div>

            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '14px 16px',
              textAlign: 'right',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontSize: '12.5px',
              marginBottom: '20px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>{__t('shared.layout.app_shell.s12', "المؤسسة:")}</span>
                <strong style={{ color: '#0f172a' }}>{cleanWorkspaceName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>{__t('shared.layout.app_shell.s13', "المستخدم النشط:")}</span>
                <strong style={{ color: '#0f172a' }}>{displayName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>{__t('shared.layout.app_shell.s14', "حالة الربط والبيانات:")}</span>
                <span style={{ color: '#059669', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircleIcon size={14} color="#059669" /> {__t('shared.layout.app_shell.s15', "متصل ومؤمّن")}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button 
                type="button"
                onClick={() => {
                  window.open('https://wa.me/201018017523', '_blank');
                }}
                style={{ 
                  flex: 1, 
                  padding: '10px 16px', 
                  fontSize: '13px',
                  fontWeight: 700,
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 2px 8px rgba(15, 23, 42, 0.2)',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1e1b4b')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0f172a')}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="#25D366">
                  <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 15 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.53 7.04C9.36 7.04 9.09 7.11 8.87 7.34C8.64 7.58 8 8.18 8 9.4C8 10.62 8.89 11.8 9.01 11.96C9.14 12.12 10.76 14.62 13.23 15.69C13.82 15.94 14.28 16.09 14.64 16.21C15.23 16.4 15.77 16.37 16.2 16.31C16.68 16.24 17.68 15.7 17.89 15.12C18.09 14.54 18.09 14.04 18.03 13.94C17.97 13.84 17.81 13.78 17.56 13.66C17.31 13.53 16.09 12.93 15.86 12.85C15.63 12.77 15.47 12.73 15.3 12.97C15.13 13.22 14.65 13.78 14.51 13.94C14.36 14.11 14.22 14.13 13.97 14C13.72 13.88 12.92 13.62 11.97 12.77C11.23 12.11 10.73 11.29 10.59 11.04C10.44 10.79 10.57 10.66 10.7 10.53C10.81 10.42 10.95 10.24 11.07 10.1C11.19 9.96 11.23 9.85 11.31 9.69C11.39 9.53 11.35 9.39 11.29 9.27C11.23 9.15 10.73 7.93 10.53 7.43C10.33 6.95 10.13 7.01 9.97 7C9.83 7 9.67 7.04 9.53 7.04Z"/>
                </svg>
                {__t('shared.layout.app_shell.s16', "الدعم الفني عبر واتساب")}
              </button>
              <Button 
                variant="secondary" 
                onClick={() => setIsAboutModalOpen(false)}
                style={{ padding: '10px 20px', fontSize: '13px' }}
              >
                {__t('shared.layout.app_shell.s17', "إغلاق")}
              </Button>
            </div>
          </div>
        </DialogShell>
      )}
      <SidebarContextMenu
        isOpen={sidebarContextMenu.isOpen}
        position={sidebarContextMenu.position}
        target={sidebarContextMenu.target}
        mode="sidebar"
        onClose={() => setSidebarContextMenu({ isOpen: false, position: { x: 0, y: 0 }, target: null })}
        onOpenInNewTab={(target) => {
          const { id } = tabsStore.openTab({
            path: target.path,
            title: target.label,
            iconKey: target.iconKey,
            makeActive: true,
          });
          tabsStore.setActiveTabId(id);
          navigate(target.path);
        }}
        onOpenInNewWindow={(target) => {
          openExternalWindow(target.path);
          toast.info(__t('shared.layout.app_shell.s18', "تم فتح الصفحة في نافذة مستقلة"));
        }}
        onCopyLink={(target) => {
          try {
            const isElectron = typeof window !== 'undefined' && (Boolean((window as any).electronAPI) || window.navigator.userAgent.toLowerCase().includes('electron'));
            const fullUrl = isElectron 
              ? `${window.location.origin}${window.location.pathname}#${target.path.replace(/^#?\/?/, '/')}`
              : `${window.location.origin}${target.path}`;
            navigator.clipboard.writeText(fullUrl);
            toast.success(__t('shared.layout.app_shell.s19', "تم نسخ رابط الصفحة إلى الحافظة"));
          } catch (_) {
            toast.error(__t('shared.layout.app_shell.s20', "تعذر نسخ الرابط"));
          }
        }}
      />
    </div>
  );
}
