import { describe, expect, it } from 'vitest';
import type { NavigationItemDefinition } from '@/app/router/types';
import { canAccessNavigationItem, canAccessPath, findFirstAccessibleRoute, getFirstAccessibleRoute, getRoutePermissionRequirement, hasAnyPermission, hasRequiredFeature, matchesNavigationSearch, tenantHasFeature } from '@/app/router/access';
import { normalizeArabicSearchKey } from '@/lib/arabic-normalization';
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
        features: ['sales', 'catalog', 'accounting', 'inventory', 'purchases'],
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
});
