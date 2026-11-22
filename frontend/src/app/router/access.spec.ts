import { describe, expect, it } from 'vitest';
import type { NavigationItemDefinition } from '@/app/router/types';
import {
  canAccessNavigationItem,
  canAccessPath,
  findFirstAccessibleRoute,
  findWorkspaceFallbackRoute,
  getFirstAccessibleRoute,
  getHrHomePath,
  getRoutePermissionRequirement,
  hasAnyPermission,
  hasRequiredFeature,
  isAttendanceOnlyHrUser,
  matchesNavigationSearch,
  tenantHasFeature,
} from '@/app/router/access';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';
import { deliveryRepsRoutes } from '@/features/delivery-reps/routes';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthUser } from '@/types/auth';

const adminUser: AuthUser = {
  id: 'u-admin',
  username: 'admin',
  role: 'admin',
  permissions: ['dashboard', 'inventory', 'reports', 'treasury'],
  displayName: 'Admin',
  branchIds: ['b-1'],
  defaultBranchId: 'b-1',
};

const superAdminUser: AuthUser = {
  ...adminUser,
  id: 'u-root',
  username: 'root',
  role: 'super_admin',
  permissions: [],
  tenantId: 'default',
  accountId: 'default',
};

const navigationItems: NavigationItemDefinition[] = [
  { key: 'dashboard', label: 'الرئيسية', to: '/' },
  { key: 'inventory', label: 'المخزون', to: '/inventory' },
  { key: 'reports', label: 'التقارير', to: '/reports' },
];

describe('router access guards', () => {
  it('maps nested routes to their top-level permission requirement', () => {
    expect(getRoutePermissionRequirement('/inventory/transfers')).toBe('inventory');
    expect(getRoutePermissionRequirement('/settings/security')).toEqual(['settings', 'canManageSettings']);
  });

  it('allows treasury users to access the cash drawer workspace', () => {
    expect(canAccessPath(adminUser, '/cash-drawer')).toBe(true);
  });

  it('filters navigation items using explicit permissions', () => {
    expect(canAccessNavigationItem(adminUser, { key: 'reports', label: 'التقارير', to: '/reports' })).toBe(true);
    expect(canAccessNavigationItem(adminUser, { key: 'settings', label: 'الإعدادات', to: '/settings' })).toBe(false);
  });

  it('returns the first accessible route in navigation order', () => {
    expect(findFirstAccessibleRoute(adminUser, navigationItems)).toBe('/');
    expect(getFirstAccessibleRoute(adminUser, navigationItems)).toBe('/');
    expect(findFirstAccessibleRoute({ ...adminUser, permissions: ['reports'] }, navigationItems)).toBe('/reports');
  });

  it('returns null when the user has no accessible navigation items', () => {
    expect(findFirstAccessibleRoute({ ...adminUser, permissions: [] }, navigationItems)).toBeNull();
    expect(getFirstAccessibleRoute({ ...adminUser, permissions: [] }, navigationItems)).toBe('/');
  });

  it('grants all permissions to super admins', () => {
    expect(hasAnyPermission(superAdminUser, ['settings', 'canManageSettings'])).toBe(true);
    expect(canAccessPath(superAdminUser, '/settings')).toBe(true);
  });

  it('allows platform admin only to access saas admin route', () => {
    expect(canAccessPath(superAdminUser, '/saas-admin/tenants')).toBe(true);
    expect(canAccessNavigationItem(superAdminUser, { key: 'saas-admin-tenants', label: 'إدارة النسخ', to: '/saas-admin/tenants', platformOnly: true })).toBe(true);
    expect(canAccessPath({ ...superAdminUser, tenantId: 'demo-trial' }, '/saas-admin/tenants')).toBe(false);
    expect(canAccessNavigationItem({ ...superAdminUser, tenantId: 'demo-trial' }, { key: 'saas-admin-tenants', label: 'إدارة النسخ', to: '/saas-admin/tenants', platformOnly: true })).toBe(false);
  });

  it('allows account fallback only when tenant id is missing and account is default', () => {
    expect(canAccessPath({ ...superAdminUser, tenantId: '', accountId: 'default' }, '/saas-admin/tenants')).toBe(true);
    expect(canAccessPath({ ...superAdminUser, tenantId: '', accountId: 'demo:main' }, '/saas-admin/tenants')).toBe(false);
  });

  it('blocks saas-admin completely in electron desktop mode', () => {
    (window as any).electronRuntime = {};
    try {
      expect(canAccessPath(superAdminUser, '/saas-admin/tenants')).toBe(false);
      expect(canAccessNavigationItem(superAdminUser, { key: 'saas-admin-tenants', label: 'إدارة النسخ', to: '/saas-admin/tenants', platformOnly: true })).toBe(false);
      expect(canAccessNavigationItem(superAdminUser, { key: 'saas-admin-plans', label: 'باقات الاشتراك', to: '/saas-admin/plans', platformOnly: true })).toBe(false);
    } finally {
      delete (window as any).electronRuntime;
    }
  });

  it('restricts dashboard route when tenant lacks reports feature', () => {
    useAuthStore.setState({
      tenant: { id: 't-basic', name: 'Basic Store', plan_id: 'plan_basic', features: ['sales', 'catalog', 'sessions', 'cashDrawer'] } as any
    });
    try {
      expect(canAccessPath(adminUser, '/')).toBe(false);
      expect(canAccessNavigationItem(adminUser, { key: 'dashboard', label: 'الرئيسية', to: '/' })).toBe(false);

      useAuthStore.setState({
        tenant: { id: 't-pro', name: 'Pro Store', plan_id: 'plan_pro', features: ['sales', 'catalog', 'sessions', 'cashDrawer', 'reports'] } as any
      });
      expect(canAccessPath(adminUser, '/')).toBe(true);
    } finally {
      useAuthStore.setState({ tenant: null });
    }
  });

  it('allows POS navigation and path access for retail merchant with omnichannel plan', () => {
    useAuthStore.setState({
      tenant: {
        id: 'almhnds',
        slug: 'almhnds',
        businessName: 'المهندس',
        activityType: 'retail_general',
        planId: 'plan_omnichannel',
        // INV-POS-RETAIL-FEATURE-GATE: 'pos' rides in every retail tenant's effective features (profile default) — a list without it is a tenant shape the backend cannot produce.
        features: ['sales', 'catalog', 'accounting', 'inventory', 'purchases', 'pos'],
      } as any,
    });
    try {
      const salesUser: AuthUser = { ...adminUser, permissions: ['sales', 'pos'] };
      const posItem = { key: 'pos', label: 'نقطة البيع', to: '/pos' };
      expect(canAccessNavigationItem(salesUser, posItem)).toBe(true);
      expect(canAccessPath(salesUser, '/pos')).toBe(true);
    } finally {
      useAuthStore.setState({ tenant: null });
    }
  });

  it('enforces tier-gated modules (hr, accounting, installments, inventory, purchases, storefront) on commerce plans', () => {
    const fullAdminUser: AuthUser = { ...adminUser, permissions: ['*'] };
    const proTenant = {
      id: 't-pro',
      name: 'Pro Commerce',
      activityType: 'retail_general',
      plan_id: 'plan_pro',
      // INV-POS-RETAIL-FEATURE-GATE: 'pos' is a retail profile default — a real pro tenant's list carries it.
      features: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'suppliers', 'pos'],
    } as any;
    const basicTenant = {
      id: 't-basic',
      name: 'Basic Commerce',
      activityType: 'retail_general',
      plan_id: 'plan_basic',
      // INV-POS-RETAIL-FEATURE-GATE: same — 'pos' is not tier-gated, every retail profile defaults it in.
      features: ['sales', 'catalog', 'sessions', 'cashDrawer', 'pos'],
    } as any;

    try {
      useAuthStore.setState({ user: fullAdminUser, tenant: proTenant });
      expect(tenantHasFeature('hr', proTenant, fullAdminUser)).toBe(false);
      expect(tenantHasFeature('accounting', proTenant, fullAdminUser)).toBe(false);
      expect(tenantHasFeature('installments', proTenant, fullAdminUser)).toBe(false);
      expect(tenantHasFeature('storefront', proTenant, fullAdminUser)).toBe(false);
      expect(hasRequiredFeature('/hr', fullAdminUser)).toBe(false);
      expect(canAccessPath(fullAdminUser, '/hr')).toBe(false);
      expect(canAccessPath(fullAdminUser, '/accounting')).toBe(false);
      expect(canAccessPath(fullAdminUser, '/installments')).toBe(false);
      expect(canAccessPath(fullAdminUser, '/storefront')).toBe(false);
      // Purchases & Inventory are included in Pro, while /online-orders stays reachable by URL (INV-STOREFRONT-ORDERS).
      expect(canAccessPath(fullAdminUser, '/purchases')).toBe(true);
      expect(canAccessPath(fullAdminUser, '/inventory')).toBe(true);
      expect(canAccessPath(fullAdminUser, '/online-orders')).toBe(true);

      // Basic omits purchases, inventory, reports, hr, accounting — even with 'catalog' present.
      useAuthStore.setState({ user: fullAdminUser, tenant: basicTenant });
      expect(tenantHasFeature('sales', basicTenant, fullAdminUser)).toBe(true);
      expect(tenantHasFeature('catalog', basicTenant, fullAdminUser)).toBe(true);
      expect(tenantHasFeature('purchases', basicTenant, fullAdminUser)).toBe(false);
      expect(tenantHasFeature('inventory', basicTenant, fullAdminUser)).toBe(false);
      expect(canAccessPath(fullAdminUser, '/purchases')).toBe(false);
      expect(canAccessPath(fullAdminUser, '/inventory')).toBe(false);
      expect(canAccessPath(fullAdminUser, '/hr')).toBe(false);
      expect(canAccessPath(fullAdminUser, '/pos')).toBe(true);

      // Dedicated enterprise/ultimate tenants retain explicitly granted features.
      const ultimateTenant = {
        ...proTenant,
        id: 't-ult',
        plan_id: 'plan_ultimate',
        features: [...proTenant.features, 'hr', 'accounting', 'installments'],
      };
      useAuthStore.setState({ user: fullAdminUser, tenant: ultimateTenant });
      expect(canAccessPath(fullAdminUser, '/hr')).toBe(true);
      expect(canAccessPath(fullAdminUser, '/accounting')).toBe(true);
      expect(canAccessPath(fullAdminUser, '/installments')).toBe(true);
    } finally {
      useAuthStore.setState({ user: null, tenant: null });
    }
  });

  it('P10: a super-admin hide override on deliveryReps is respected on wholesale_van', () => {
    const fullAdminUser: AuthUser = { ...adminUser, permissions: ['*'] };
    // Explicit features list WITHOUT deliveryReps: the old hardcoded
    // wholesale_van grant ignored the list and always returned true.
    const hiddenTenant = {
      id: 't-van', name: 'Van Client', activityType: 'wholesale_van',
      plan_id: 'plan_basic',
      features: ['sales', 'catalog', 'vanSales', 'pos', 'cashDrawer'],
    } as any;
    expect(tenantHasFeature('deliveryReps', hiddenTenant, fullAdminUser)).toBe(false);
    // With deliveryReps in the list, the feature is on.
    const shownTenant = { ...hiddenTenant, features: [...hiddenTenant.features, 'deliveryReps'] };
    expect(tenantHasFeature('deliveryReps', shownTenant, fullAdminUser)).toBe(true);
    // Legacy fallback (no explicit list) still grants deliveryReps.
    const legacyTenant = { ...hiddenTenant, features: [] };
    expect(tenantHasFeature('deliveryReps', legacyTenant, fullAdminUser)).toBe(true);
  });

  it('opens delivery reps management on retail tenants on every plan, including starter (INV-DELIVERY-REPS-RETAIL-CORE)', () => {
    const fullAdminUser: AuthUser = { ...adminUser, permissions: ['*'] };
    const proTenant = {
      id: 't-pro',
      name: 'Pro Commerce',
      activityType: 'retail_general',
      plan_id: 'plan_pro',
      features: ['sales', 'catalog', 'sessions', 'cashDrawer', 'purchases', 'inventory', 'reports', 'suppliers'],
    } as any;
    const basicTenant = {
      id: 't-basic',
      name: 'Basic Commerce',
      activityType: 'retail_general',
      plan_id: 'plan_basic',
      features: ['sales', 'catalog', 'sessions', 'cashDrawer'],
    } as any;

    try {
      // Retail core: delivery + rep settlement is a daily money flow for any retail shop,
      // so deliveryReps is open by default on every plan — no explicit tenant feature needed.
      useAuthStore.setState({ user: fullAdminUser, tenant: proTenant });
      expect(tenantHasFeature('deliveryReps', proTenant, fullAdminUser)).toBe(true);
      expect(hasRequiredFeature('/delivery-reps', fullAdminUser)).toBe(true);
      expect(canAccessPath(fullAdminUser, '/delivery-reps')).toBe(true);

      // Starter (plan_basic) gets it too — the gate was vertical + tenant.features, not plan.
      useAuthStore.setState({ user: fullAdminUser, tenant: basicTenant });
      expect(tenantHasFeature('deliveryReps', basicTenant, fullAdminUser)).toBe(true);
      expect(hasRequiredFeature('/delivery-reps', fullAdminUser)).toBe(true);
      expect(canAccessPath(fullAdminUser, '/delivery-reps')).toBe(true);
    } finally {
      useAuthStore.setState({ user: null, tenant: null });
    }
  });

  it('F12: the van supervisor console requires deliveryRepsAdmin — a rep with deliveryReps only is denied', () => {
    const repUser: AuthUser = { ...adminUser, id: 'u-rep', username: 'rep', role: 'cashier', permissions: ['dashboard', 'sales', 'inventory', 'deliveryReps'] };
    const supervisorUser: AuthUser = { ...adminUser, id: 'u-sup', username: 'supervisor', role: 'admin', permissions: ['dashboard', 'sales', 'inventory', 'deliveryReps', 'deliveryRepsAdmin'] };
    const vanTenant = {
      id: 't-van',
      name: 'Van Client',
      activityType: 'wholesale_van',
      plan_id: 'plan_ultimate',
      features: ['deliveryReps', 'sales', 'catalog', 'pos', 'cashDrawer', 'inventory', 'reports'],
    } as any;
    const adminNavItem = { key: 'van-sales-admin', label: 'سيارات التوزيع (الفان)', to: '/inventory/van-sales' };

    try {
      useAuthStore.setState({ user: repUser, tenant: vanTenant });
      // The rep keeps his own screen: the feature is on and the rep list opens.
      expect(hasRequiredFeature('/delivery-reps', repUser)).toBe(true);
      expect(canAccessPath(repUser, '/delivery-reps')).toBe(true);
      // ...but every admin-console path is denied, sidebar item included.
      expect(canAccessPath(repUser, '/inventory/van-sales')).toBe(false);
      expect(canAccessPath(repUser, '/van-sales/admin')).toBe(false);
      expect(canAccessPath(repUser, '/van-sales/management')).toBe(false);
      expect(canAccessNavigationItem(repUser, adminNavItem)).toBe(false);
      // The supervisor passes all three paths.
      useAuthStore.setState({ user: supervisorUser, tenant: vanTenant });
      expect(canAccessPath(supervisorUser, '/inventory/van-sales')).toBe(true);
      expect(canAccessPath(supervisorUser, '/van-sales/admin')).toBe(true);
      expect(canAccessPath(supervisorUser, '/van-sales/management')).toBe(true);
      expect(canAccessNavigationItem(supervisorUser, adminNavItem)).toBe(true);
    } finally {
      useAuthStore.setState({ user: null, tenant: null });
    }
  });
});

// INV-IMPORT-FX-RATE-REGISTRATION (I9-E): the R11 search failure —
// the forex screen existed at /accounting/forex but the global menu
// search for "سعر الصرف" found nothing, because the search matched
// only the label "تقييم العملات وفروق الصرف (IAS 21)", which does
// not contain "سعر الصرف". Keywords close that gap.
describe('matchesNavigationSearch', () => {
  const forexItem: NavigationItemDefinition = {
    key: 'accounting-forex',
    label: 'تقييم العملات وفروق الصرف (IAS 21)',
    to: '/accounting/forex',
    keywords: ['سعر الصرف', 'أسعار الصرف', 'تسجيل سعر الصرف', 'سعر الدولار', 'العملات'],
  };

  it('finds the forex screen for "سعر الصرف" through its keywords', () => {
    const query = normalizeArabicSearchKey('سعر الصرف');
    // The label alone does NOT contain the query — this is the R11 gap.
    expect(normalizeArabicSearchKey(forexItem.label).includes(query)).toBe(false);
    expect(matchesNavigationSearch(forexItem, query)).toBe(true);
    expect(matchesNavigationSearch(forexItem, normalizeArabicSearchKey('أسعار الصرف'))).toBe(true);
    expect(matchesNavigationSearch(forexItem, normalizeArabicSearchKey('تسجيل سعر الصرف'))).toBe(true);
  });

  it('still matches through the label when the query is in it', () => {
    expect(matchesNavigationSearch(forexItem, normalizeArabicSearchKey('العملات'))).toBe(true);
    expect(matchesNavigationSearch(forexItem, normalizeArabicSearchKey('فروق الصرف'))).toBe(true);
  });

  it('does not match unrelated items or queries', () => {
    expect(matchesNavigationSearch(forexItem, normalizeArabicSearchKey('المخزون'))).toBe(false);
    expect(matchesNavigationSearch(
      { key: 'inventory', label: 'المخزون', to: '/inventory' },
      normalizeArabicSearchKey('سعر الصرف'),
    )).toBe(false);
  });

  it('matches everything on an empty query', () => {
    expect(matchesNavigationSearch(forexItem, '')).toBe(true);
  });

  it('INV-DELIVERY-REPS-RETAIL-SELF-INSTALL: matches delivery-reps sidebar navigation by Arabic keywords', () => {
    const repNav = deliveryRepsRoutes.navigation?.[0];
    expect(repNav).toBeDefined();
    if (!repNav) throw new Error('delivery-reps navigation entry missing');
    expect(repNav.key).toBe('delivery-reps');
    for (const term of ['مندوب', 'المناديب', 'توصيل', 'دليفري', 'تسوية']) {
      expect(matchesNavigationSearch(repNav, normalizeArabicSearchKey(term))).toBe(true);
    }
  });
});

describe('INV-HR-ATTENDANCE-SCOPE-AND-OWNER-ROUTE-GUARD', () => {
  const fullFeatureTenant = {
    id: 't-hr',
    accountId: 'a-hr',
    slug: 'hr-shop',
    businessName: 'HR Shop',
    activityType: 'retail_general',
    status: 'active' as const,
    isTrial: false,
    trialEndsAt: null,
    trialDaysRemaining: null,
    // INV-POS-RETAIL-FEATURE-GATE: 'pos' is a retail profile default — a real retail tenant's list carries it.
    features: ['sales', 'catalog', 'sessions', 'cashDrawer', 'reports', 'hr', 'pos'],
  };

  it('locks owner-companion and owner-mobile behind reports and prevents cashier fallback leak', () => {
    const restrictedCashier: AuthUser = {
      ...adminUser,
      id: 'u-cashier-no-dash',
      username: 'cashier-att',
      role: 'cashier',
      permissions: ['sales', 'cashDrawer', 'hr', 'hrAttendance'],
    };
    const defaultCashierWithDashboard: AuthUser = {
      ...restrictedCashier,
      permissions: ['dashboard', 'sales', 'cashDrawer', 'hr', 'hrAttendance'],
    };
    const attendanceOnlyUser: AuthUser = {
      ...restrictedCashier,
      permissions: ['hr', 'hrAttendance'],
    };
    const zeroPermUser: AuthUser = {
      ...restrictedCashier,
      permissions: [],
    };
    const navItems: NavigationItemDefinition[] = [
      { key: 'apps', label: 'متجر التطبيقات', to: '/apps' },
      { key: 'dashboard', label: 'الرئيسية', to: '/' },
      { key: 'owner-companion', label: 'متابعة المالك', to: '/owner-companion' },
      { key: 'owner-mobile', label: 'لوحة المالك (موبايل)', to: '/owner-mobile' },
      { key: 'mobile-hub', label: 'تطبيقات الموبايل', to: '/mobile' },
      { key: 'pos', label: 'نقطة البيع', to: '/pos' },
      { key: 'hr', label: 'الموارد البشرية', to: '/hr' },
    ];

    useAuthStore.setState({ user: restrictedCashier, tenant: fullFeatureTenant });
    try {
      expect(getRoutePermissionRequirement('/owner-companion')).toBe('reports');
      expect(getRoutePermissionRequirement('/owner-mobile')).toBe('reports');
      expect(canAccessPath(restrictedCashier, '/owner-companion')).toBe(false);
      expect(canAccessPath(restrictedCashier, '/owner-mobile')).toBe(false);
      expect(canAccessPath(defaultCashierWithDashboard, '/owner-companion')).toBe(false);
      expect(canAccessPath(defaultCashierWithDashboard, '/owner-mobile')).toBe(false);
      expect(canAccessPath(adminUser, '/owner-companion')).toBe(true);

      // Redirect fallback never lands on /owner-companion, /owner-mobile, or /mobile
      expect(findWorkspaceFallbackRoute(restrictedCashier, navItems)).toBe('/pos');
      expect(findWorkspaceFallbackRoute(attendanceOnlyUser, navItems)).toBe('/hr/attendance');
      expect(findWorkspaceFallbackRoute(zeroPermUser, navItems)).toBeNull();
    } finally {
      useAuthStore.setState({ user: null, tenant: null });
    }
  });

  it('tightens HR sub-routes so bare hr/hrAttendance cashiers cannot open settlements, reports, settings, or recruitment', () => {
    const attendanceCashier: AuthUser = {
      ...adminUser,
      role: 'cashier',
      permissions: ['sales', 'cashDrawer', 'hr', 'hrAttendance'],
    };
    const hrManager: AuthUser = {
      ...adminUser,
      role: 'admin',
      permissions: ['hr', 'hrEmployees', 'hrAttendance', 'hrLoans', 'hrPayrollView', 'hrSalaryView'],
    };

    useAuthStore.setState({ user: attendanceCashier, tenant: fullFeatureTenant });
    try {
      expect(canAccessPath(attendanceCashier, '/hr/attendance')).toBe(true);
      expect(canAccessPath(attendanceCashier, '/hr/employees')).toBe(false);
      expect(canAccessPath(attendanceCashier, '/hr/leaves')).toBe(false);
      expect(canAccessPath(attendanceCashier, '/hr/loans')).toBe(false);
      expect(canAccessPath(attendanceCashier, '/hr/payroll')).toBe(false);
      expect(canAccessPath(attendanceCashier, '/hr/settlements')).toBe(false);
      expect(canAccessPath(attendanceCashier, '/hr/recruitment')).toBe(false);
      expect(canAccessPath(attendanceCashier, '/hr/reports')).toBe(false);
      expect(canAccessPath(attendanceCashier, '/hr/settings')).toBe(false);
      expect(isAttendanceOnlyHrUser(attendanceCashier)).toBe(true);
      expect(getHrHomePath(attendanceCashier)).toBe('/hr/attendance');

      expect(canAccessPath(hrManager, '/hr/employees')).toBe(true);
      expect(canAccessPath(hrManager, '/hr/settlements')).toBe(true);
      expect(canAccessPath(hrManager, '/hr/recruitment')).toBe(true);
      expect(canAccessPath(hrManager, '/hr/reports')).toBe(true);
      expect(canAccessPath(hrManager, '/hr/settings')).toBe(true);
      expect(isAttendanceOnlyHrUser(hrManager)).toBe(false);
      expect(getHrHomePath(hrManager)).toBe('/hr');
    } finally {
      useAuthStore.setState({ user: null, tenant: null });
    }
  });
});
