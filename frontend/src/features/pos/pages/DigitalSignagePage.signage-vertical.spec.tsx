/* INV-REST-SIGNAGE-VERTICAL-TRUTH (T11-E, F7) — page wiring: the
 * DigitalSignagePage must resolve the tenant vertical from the same
 * source the rest of the app uses (tenant activityType / settings,
 * via resolveCurrentVertical) and hand it to the zero-offers board,
 * and the bottom ticker must default to neutral / vertical-aware
 * copy instead of the hardcoded showroom ticker ('أهلاً بكم في صالة
 * العرض • عروض وتخفيضات كبرى …'). At base the page never resolves
 * a vertical, always renders the showroom board, and always seeds
 * the ticker with showroom copy.
 *
 * Board assertions are scoped to board-only strings (the board
 * badge and the show-all button): the header / side deck still
 * carry showroom chrome, which is outside this package.
 */

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DigitalSignagePage from './DigitalSignagePage';
import { useAuthStore } from '@/stores/auth-store';

// Hoisted mocks: the spec must not import the api module directly —
// the page-composition check flags a direct api import in any file
// under pages/. The page under test goes through the mocked module.
const listPageMock = vi.hoisted(() => vi.fn());
const mockSettings = vi.hoisted(() => ({
  current: { storeName: 'متجر الاختبار', currency: 'EGP' } as Record<string, unknown>,
}));

vi.mock('@/features/products/api/products.api', () => ({
  productsApi: { listPage: listPageMock },
}));

vi.mock('@/features/pos/lib/pos-customer-display-bridge', () => ({
  subscribeSignageOffersUpdate: () => () => {},
}));

vi.mock('@/features/pos/hooks/useIsolatedDisplayLanguage', () => ({
  useIsolatedDisplayLanguage: () => ({
    currentLang: 'ar',
    isEn: false,
    setLanguage: vi.fn(),
    toggleLanguage: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/use-catalog-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/hooks/use-catalog-queries')>();
  return {
    ...actual,
    useSettingsQuery: () =>
      ({ data: mockSettings.current }) as unknown as ReturnType<typeof actual.useSettingsQuery>,
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DigitalSignagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setRestaurantTenant() {
  useAuthStore.setState({
    tenant: {
      id: 't1',
      accountId: 'a1',
      slug: 'restaurant-tenant',
      businessName: 'مطعم الاختبار',
      activityType: 'restaurant',
      status: 'active',
      isTrial: false,
      trialEndsAt: null,
      trialDaysRemaining: null,
    },
  });
}

afterEach(() => {
  useAuthStore.setState({ tenant: null });
  mockSettings.current = { storeName: 'متجر الاختبار', currency: 'EGP' };
});

describe('DigitalSignagePage vertical wiring (INV-REST-SIGNAGE-VERTICAL-TRUTH)', () => {
  it('a restaurant tenant (settings activityType) with zero offers sees the restaurant board, never the showroom board', async () => {
    mockSettings.current = {
      storeName: 'مطعم الاختبار',
      currency: 'EGP',
      activityType: 'restaurant',
    };
    listPageMock.mockResolvedValue({ products: [] });
    renderPage();

    await screen.findByText('قائمة اليوم');
    expect(screen.queryByText('صالة العرض التفاعلية الذكية')).not.toBeInTheDocument();
    expect(screen.getByText('عرض القائمة كاملة')).toBeInTheDocument();
    expect(screen.queryByText('عرض كافة منتجات الصالة')).not.toBeInTheDocument();
  });

  it('a restaurant tenant (tenant activityType, no settings activityType) sees the restaurant board', async () => {
    setRestaurantTenant();
    listPageMock.mockResolvedValue({ products: [] });
    renderPage();

    await screen.findByText('قائمة اليوم');
    expect(screen.queryByText('صالة العرض التفاعلية الذكية')).not.toBeInTheDocument();
  });

  it('a restaurant tenant (restaurantModuleEnabled flag) sees the restaurant board', async () => {
    mockSettings.current = {
      storeName: 'مطعم الاختبار',
      currency: 'EGP',
      restaurantModuleEnabled: true,
    };
    listPageMock.mockResolvedValue({ products: [] });
    renderPage();

    await screen.findByText('قائمة اليوم');
    expect(screen.queryByText('صالة العرض التفاعلية الذكية')).not.toBeInTheDocument();
  });

  it('a retail tenant with zero offers still sees the showroom board', async () => {
    listPageMock.mockResolvedValue({ products: [] });
    renderPage();

    await screen.findByText('صالة العرض التفاعلية الذكية');
    expect(screen.queryByText('قائمة اليوم')).not.toBeInTheDocument();
  });

  it('the ticker defaults to restaurant copy for a restaurant tenant, never the showroom ticker', async () => {
    mockSettings.current = {
      storeName: 'مطعم الاختبار',
      currency: 'EGP',
      activityType: 'restaurant',
    };
    listPageMock.mockResolvedValue({ products: [] });
    const { container } = renderPage();

    await screen.findByText('قائمة اليوم');
    expect(container.textContent).toContain('طازج يومياً');
    expect(container.textContent).not.toContain('عروض وتخفيضات كبرى');
  });

  it('the ticker defaults to neutral copy for a retail tenant, never the showroom ticker', async () => {
    listPageMock.mockResolvedValue({ products: [] });
    const { container } = renderPage();

    await screen.findByText('صالة العرض التفاعلية الذكية');
    expect(container.textContent).toContain('عروض جديدة كل يوم');
    expect(container.textContent).not.toContain('عروض وتخفيضات كبرى');
    expect(container.textContent).not.toContain('أهلاً بكم في صالة العرض');
  });
});
