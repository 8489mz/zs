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
 * badge and the show-all button).
 *
 * T12-H2 extends this to the offer board itself
 * (INV-REST-SIGNAGE-OFFER-BOARD-TRUTH): with real offers on
 * screen the header, hero card, side deck and marquee footer all
 * receive the same vertical, so a restaurant tenant sees
 * restaurant copy everywhere and zero showroom strings, while
 * other verticals keep the showroom board byte-for-byte. The
 * empty-queue placeholder only renders with a single offer, so
 * it gets its own test below.
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

describe('DigitalSignagePage offer board vertical (INV-REST-SIGNAGE-OFFER-BOARD-TRUTH)', () => {
  function makeOfferProducts(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `p${i + 1}`,
      name: `طبق ${i + 1}`,
      retailPrice: 100,
      promotionalPrice: 80,
      offers: [],
      badge: '',
      categoryName: 'أطباق رئيسية',
      barcode: `B${i + 1}`,
      imageUrl: '',
    }));
  }

  function setRestaurantSettings() {
    mockSettings.current = {
      storeName: 'مطعم الاختبار',
      currency: 'EGP',
      activityType: 'restaurant',
    };
  }

  // Every showroom string the four offer-board components used to
  // render unconditionally (header, hero card, side deck, marquee
  // footer), plus the blanket substrings that catch any of them.
  const SHOWROOM_STRINGS = [
    'صالة العرض',
    'المعرض',
    'Digital Showroom Board',
    'بث مباشر بصالة العرض',
    'شاشة العروض الترويجية والصفقات الحصرية',
    'تسليم فوري من صالة العرض',
    'متوفر بصالة العرض',
    'عروض إضافية بالمعرض',
    'صفقات وتخفيضات المعرض',
    'تصفح منتجاتنا المميزة',
    'مزايا التسوق في صالة العرض',
    'فحص وتجربة فورية',
    'معاينة المنتج قبل الشراء',
    'دفع إلكتروني آمن',
    'استلام فوري',
    'تسليم مباشر بالصالة',
    'ضمان معتمد',
    'فاتورة وضمان استبدال',
    'نشرة العروض',
  ];

  it('a restaurant tenant with 40 offers sees zero showroom strings and the restaurant board', async () => {
    setRestaurantSettings();
    listPageMock.mockResolvedValue({ products: makeOfferProducts(40) });
    const { container } = renderPage();

    await screen.findByText('طبق 1');

    for (const showroom of SHOWROOM_STRINGS) {
      expect(container.textContent).not.toContain(showroom);
    }
    expect(screen.getByText('بث مباشر من المطعم')).toBeInTheDocument();
    expect(
      screen.getByText('شاشة قائمة اليوم وأطباق المطعم • Restaurant Menu Board')
    ).toBeInTheDocument();
    expect(screen.getByText('تحضير طازج في مطبخنا')).toBeInTheDocument();
    expect(screen.getByText('متوفر في قائمة اليوم')).toBeInTheDocument();
    expect(screen.getByText('أطباق إضافية من القائمة')).toBeInTheDocument();
    expect(screen.getByText('مزايا الطلب في مطعمنا')).toBeInTheDocument();
    expect(screen.getByText('طازج كل يوم')).toBeInTheDocument();
    expect(screen.getByText('مكونات طازجة تُحضّر يومياً في مطبخنا')).toBeInTheDocument();
    expect(screen.getByText('دفع آمن بأي طريقة')).toBeInTheDocument();
    expect(screen.getByText('صالة وسفري وتوصيل')).toBeInTheDocument();
    expect(screen.getByText('جودة مضمونة')).toBeInTheDocument();
    expect(screen.getByText('نشرة قائمة اليوم')).toBeInTheDocument();
  });

  it('a restaurant tenant with a single offer sees the restaurant empty-queue placeholder', async () => {
    setRestaurantSettings();
    listPageMock.mockResolvedValue({ products: makeOfferProducts(1) });
    const { container } = renderPage();

    await screen.findByText('طبق 1');

    expect(screen.getByText('عروض وأطباق قائمة اليوم')).toBeInTheDocument();
    expect(screen.getByText('تصفح أطباقنا المميزة بأسعار واضحة وطازجة على مدار اليوم')).toBeInTheDocument();
    expect(container.textContent).not.toContain('صفقات وتخفيضات المعرض');
    expect(container.textContent).not.toContain('تصفح منتجاتنا المميزة');
  });

  it('a retail tenant with 40 offers still sees the showroom board byte-for-byte', async () => {
    listPageMock.mockResolvedValue({ products: makeOfferProducts(40) });
    const { container } = renderPage();

    await screen.findByText('طبق 1');

    expect(screen.getByText('بث مباشر بصالة العرض')).toBeInTheDocument();
    expect(screen.getByText('تسليم فوري من صالة العرض')).toBeInTheDocument();
    expect(screen.getByText('متوفر بصالة العرض')).toBeInTheDocument();
    expect(screen.getByText('عروض إضافية بالمعرض')).toBeInTheDocument();
    expect(screen.getByText('مزايا التسوق في صالة العرض')).toBeInTheDocument();
    expect(screen.getByText('فحص وتجربة فورية')).toBeInTheDocument();
    expect(screen.getByText('دفع إلكتروني آمن')).toBeInTheDocument();
    expect(screen.getByText('ضمان معتمد')).toBeInTheDocument();
    expect(screen.getByText('نشرة العروض')).toBeInTheDocument();
    expect(container.textContent).not.toContain('بث مباشر من المطعم');
    expect(container.textContent).not.toContain('تحضير طازج في مطبخنا');
    expect(container.textContent).not.toContain('متوفر في قائمة اليوم');
    expect(container.textContent).not.toContain('نشرة قائمة اليوم');
    expect(container.textContent).not.toContain('مزايا الطلب في مطعمنا');
  });
});
