import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/shared/layout/app-shell';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthUser } from '@/types/auth';

const {
  logoutMock,
  settingsMock,
  branchesMock,
  locationsMock,
  categoriesMock,
  productsListMock,
  customersListMock,
  suppliersListMock,
  dashboardOverviewMock,
  httpMock,
} = vi.hoisted(() => ({
  logoutMock: vi.fn(),
  settingsMock: vi.fn(),
  branchesMock: vi.fn(),
  locationsMock: vi.fn(),
  categoriesMock: vi.fn(),
  productsListMock: vi.fn(),
  customersListMock: vi.fn(),
  suppliersListMock: vi.fn(),
  dashboardOverviewMock: vi.fn(),
  httpMock: vi.fn(),
}));

vi.mock('@/lib/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/http')>();
  return {
    ...actual,
    http: httpMock,
  };
});

vi.mock('@/shared/api/auth', () => ({
  authApi: {
    logout: logoutMock,
  },
}));

vi.mock('@/services/reference-data.api', () => ({
  referenceDataApi: {
    settings: settingsMock,
    branches: branchesMock,
    locations: locationsMock,
  },
}));

vi.mock('@/features/products/api/products.api', () => ({
  productsApi: {
    categories: categoriesMock,
    list: productsListMock,
  },
}));

vi.mock('@/features/customers/api/customers.api', () => ({
  customersApi: {
    list: customersListMock,
  },
}));

vi.mock('@/features/suppliers/api/suppliers.api', () => ({
  suppliersApi: {
    list: suppliersListMock,
  },
}));

vi.mock('@/features/dashboard/api/dashboard.api', () => ({
  dashboardApi: {
    overview: dashboardOverviewMock,
  },
}));

function LocationEcho() {
  const location = useLocation();
  return <div>{`${location.pathname}${location.search}`}</div>;
}

function buildTenant() {
  return {
    id: 't-1',
    accountId: 'a-1',
    slug: 'my-store',
    businessName: 'My Store',
    activityType: 'retail_general',
    status: 'active' as const,
    isTrial: false,
    trialEndsAt: null,
    trialDaysRemaining: null,
    // The shell gates the primary nav (dashboard included) on the tenant's plan
    // features, so a signed-in tenant must be seeded for the nav to be realistic.
    features: ['reports', 'sales', 'pos', 'products', 'inventory', 'treasury'],
  };
}

function seedUser(overrides: Partial<AuthUser> = {}) {
  const user: AuthUser = { ...buildUser(), ...overrides };
  useAuthStore.setState({
    user,
    tenant: buildTenant(),
    storeName: 'My Store',
    theme: 'light',
    initialized: true,
  });
  return user;
}

function buildUser() {
  return {
    id: 'u-admin',
    username: 'manager',
    role: 'admin' as const,
    permissions: ['dashboard', 'products', 'sales', 'treasury'],
    displayName: 'Store Manager',
    branchIds: ['b-1'],
    defaultBranchId: 'b-1',
    mustChangePassword: false,
    usingDefaultAdminPassword: false,
  };
}

function renderShell(initialEntry = '/products', ordersCounts: Record<string, number> = { all: 0, pending: 0 }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  settingsMock.mockResolvedValue({});
  branchesMock.mockResolvedValue([]);
  locationsMock.mockResolvedValue([]);
  categoriesMock.mockResolvedValue([]);
  productsListMock.mockResolvedValue([]);
  customersListMock.mockResolvedValue([]);
  suppliersListMock.mockResolvedValue([]);
  dashboardOverviewMock.mockResolvedValue({});
  httpMock.mockImplementation(async (url: string) => {
    if (url === '/api/storefront/admin/orders/counts') {
      return { counts: ordersCounts };
    }
    return {};
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="*" element={<AppShell><LocationEcho /></AppShell>} />
          <Route path="/login" element={<LocationEcho />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, queryClient };
}

describe('AppShell', () => {
  it('renders only the navigation items the current user can access', async () => {
    seedUser();
    renderShell('/products');

    expect(document.querySelector('[data-key="dashboard"]')).toBeInTheDocument();
    expect(document.querySelector('[data-key="products"]')).toBeInTheDocument();
    expect(document.querySelector('[data-key="pos"]')).toBeInTheDocument();
    // 'cash-drawer' / 'treasury' now live inside a collapsible sidebar group, which only
    // renders its items while expanded, so they are no longer assertable as flat nav links.
    expect(document.querySelector('[data-key="reports"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-key="settings"]')).not.toBeInTheDocument();
  });

  it('renders manager notifications in the global toolbar when accessible', async () => {
    seedUser();
    renderShell('/products');

    expect(screen.getByRole('button', { name: 'تنبيهات المدير' })).toBeInTheDocument();
  });

  it('shows the bootstrap-admin warning globally when the root account is still using the default password', async () => {
    seedUser({
      role: 'super_admin',
      username: 'root',
      displayName: 'Bootstrap Admin',
      usingDefaultAdminPassword: true,
      permissions: [],
    });

    renderShell('/products');

    const warnings = await screen.findAllByText(/حساب التثبيت/);
    expect(warnings.length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent('حساب التثبيت');
  });

  it('clears the query cache and redirects to login after logout', async () => {
    logoutMock.mockResolvedValueOnce({ ok: true });
    seedUser();
    const user = userEvent.setup();
    const { queryClient } = renderShell('/sales');
    queryClient.setQueryData(['stale-session'], { leaked: true });

    await user.click(screen.getByRole('button', { name: /تسجيل الخروج|logout/i }));

    await waitFor(() => {
      expect(screen.getByText(/\/login\?reason=(signed-out|session-updated)/)).toBeInTheDocument();
    });

    expect(useAuthStore.getState().user).toBeNull();
    expect(queryClient.getQueryData(['stale-session'])).toBeUndefined();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('guarantees zero duplicate navigation links in the sidebar across primary shortcuts and groups', () => {
    seedUser();
    renderShell('/dashboard');

    const navLinks = Array.from(document.querySelectorAll('.sidebar-nav a[data-key]'));
    const renderedKeys = navLinks.map((el) => el.getAttribute('data-key'));
    const uniqueKeys = new Set(renderedKeys);

    expect(renderedKeys.length).toBe(uniqueKeys.size);
  });

  it('enforces strict tier-gating: L1 hides purchases, multi-warehouses, and accounting; L2 shows operations', () => {
    // 1. Level 1 Tenant (محل / أساسي): No purchases, no inventory, no accounting
    useAuthStore.setState({
      user: { ...buildUser(), id: '1', username: 'admin', role: 'admin', permissions: ['*'], displayName: 'Admin' },
      tenant: {
        id: 't-l1',
        accountId: 'a-1',
        slug: 'shop-l1',
        businessName: 'محل تجزئة L1',
        activityType: 'retail_general',
        status: 'active',
        isTrial: false,
        trialEndsAt: null,
        trialDaysRemaining: null,
        features: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'reports'],
      },
      storeName: 'محل تجزئة L1',
      theme: 'light',
      initialized: true,
    });

    const { unmount: unmountL1 } = renderShell('/dashboard');
    const l1Keys = Array.from(document.querySelectorAll('.sidebar-nav a[data-key]')).map((el) => el.getAttribute('data-key'));
    expect(l1Keys).toContain('pos');
    expect(l1Keys).toContain('products');
    expect(l1Keys).not.toContain('purchases');
    expect(l1Keys).not.toContain('inventory-warehouses');
    expect(l1Keys).not.toContain('accounting-journal-entries');
    expect(l1Keys).not.toContain('hr');
    unmountL1();

    // 2. Level 2 Tenant (متعدد الفروع): Gains operations (purchases + inventory) but NOT accounting
    useAuthStore.setState({
      tenant: {
        id: 't-l2',
        accountId: 'a-1',
        slug: 'shop-l2',
        businessName: 'متعدد الفروع L2',
        activityType: 'retail_general',
        status: 'active',
        isTrial: false,
        trialEndsAt: null,
        trialDaysRemaining: null,
        features: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'reports', 'purchases', 'inventory'],
      },
    });

    const { unmount: unmountL2 } = renderShell('/dashboard');
    const l2Keys = Array.from(document.querySelectorAll('.sidebar-nav a[data-key]')).map((el) => el.getAttribute('data-key'));
    expect(l2Keys).toContain('purchases');
    expect(l2Keys).toContain('inventory');
    expect(l2Keys).not.toContain('accounting-journal-entries');
    expect(l2Keys).not.toContain('hr');
    expect(l2Keys).not.toContain('online-orders');
    unmountL2();
  });

  it('hides online-orders in sidebar for non-storefront tier when 0 orders exist, and reveals it when recorded orders exist', async () => {
    const proTenant = {
      id: 't-pro-orders',
      accountId: 'a-1',
      slug: 'pro-shop',
      businessName: 'Pro Shop',
      activityType: 'retail_general',
      status: 'active' as const,
      isTrial: false,
      trialEndsAt: null,
      trialDaysRemaining: null,
      features: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'reports', 'purchases', 'inventory'],
    };

    useAuthStore.setState({
      user: { ...buildUser(), role: 'admin', permissions: ['*'] },
      tenant: proTenant,
      storeName: 'Pro Shop',
      theme: 'light',
      initialized: true,
    });

    const firstRender = renderShell('/dashboard', { all: 0, pending: 0 });
    await waitFor(() => {
      expect(httpMock).toHaveBeenCalledWith('/api/storefront/admin/orders/counts');
    });
    expect(firstRender.container.querySelector('.sidebar-nav a[data-key="online-orders"]')).not.toBeInTheDocument();
    firstRender.unmount();

    const secondRender = renderShell('/dashboard', { all: 3, pending: 1 });
    await waitFor(() => {
      expect(secondRender.container.querySelector('.sidebar-nav a[data-key="online-orders"]')).toBeInTheDocument();
    });
    secondRender.unmount();
  });

  it('strictly isolates warehousing mode: hides POS and cash drawer even if slug is almhnds', () => {
    useAuthStore.setState({
      user: { ...buildUser(), id: '1', username: 'admin', role: 'admin', permissions: ['*'], displayName: 'Admin' },
      tenant: {
        id: 'default',
        accountId: 'a-1',
        slug: 'almhnds',
        businessName: 'مستودعات المهندس',
        activityType: 'warehousing',
        status: 'active',
        isTrial: false,
        trialEndsAt: null,
        trialDaysRemaining: null,
        features: ['catalog', 'products', 'sales', 'sessions', 'cashDrawer', 'reports', 'purchases', 'inventory', 'accounting', 'pos', 'storefront'],
      },
      storeName: 'مستودعات المهندس',
      theme: 'light',
      initialized: true,
    });

    settingsMock.mockResolvedValue({
      activityType: 'warehousing',
      businessIndustry: 'warehousing',
      posModuleEnabled: false,
      storefrontModuleEnabled: false,
    });

    const { unmount } = renderShell('/dashboard');
    const keys = Array.from(document.querySelectorAll('.sidebar-nav a[data-key]')).map((el) => el.getAttribute('data-key'));
    expect(keys).not.toContain('pos');
    expect(keys).not.toContain('cash-drawer');
    // INV-STOREFRONT-ORDERS: the recorded-orders list stays in the nav even for a
    // warehousing tenant, so an admin can reach orders recorded while the
    // storefront was on; POS and the cash drawer stay hidden.
    expect(keys).toContain('online-orders');
    expect(keys).toContain('inventory-warehouses');
    expect(keys).toContain('purchases');
    unmount();
  });
});

