/* INV-REST-SIGNAGE-DYNAMIC (T13-H2) — the board is dynamic, not a
 * hardcoded variant: store name, offer names / prices / discounts,
 * category names and the ticker all come from tenant data. At base
 * (6dcf2b60) the four offer-board components branched on a resolved
 * vertical and rendered showroom copy for retail tenants and
 * restaurant copy for restaurant tenants, the ticker defaulted to
 * hardcoded strings, a product with no category was handed an
 * invented category, and the zero-offers board was a welcome board
 * full of invented perks. The user decision (2026-11-10) refines
 * the empty state: with zero offers the board shows an ASSORTED
 * sample of the store's available catalog — varied across
 * categories, never just the first N products of one category —
 * drawn from the real catalog via the existing 'all' view. The
 * truly-empty board (no offers AND an empty catalog) is a neutral
 * no-offers line + store name + QR hub + the switch to the full
 * catalog. These tests pin: real data rendered, zero
 * hardcoded-variant strings anywhere, the ticker derivation, the
 * assortment across categories, and the neutral empty state.
 */

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DigitalSignagePage, {
  buildAssortedSample,
  buildSignagePromoItems,
  deriveSignageTicker,
  topCategoriesByCount,
} from './DigitalSignagePage';
import type { SignagePromoItem } from '../components/signage/types';
import type { Product } from '@/types/domain';

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

function promoItem(overrides: Partial<SignagePromoItem> = {}): SignagePromoItem {
  return {
    id: 'p1',
    name: 'صنف 1',
    categoryName: 'أصناف',
    originalPrice: 100,
    promoPrice: 80,
    discountPercent: 20,
    savingAmount: 20,
    badge: 'عرض خاص',
    barcode: 'B1',
    imageUrl: '',
    ...overrides,
  };
}

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

function makeCatalogProducts() {
  // No offers at all: three categories, uneven sizes, listed in
  // first-seen order (drinks, mains, desserts).
  const rows: { id: string; name: string; categoryName: string }[] = [
    { id: 'd1', name: 'مشروب 1', categoryName: 'مشروبات' },
    { id: 'd2', name: 'مشروب 2', categoryName: 'مشروبات' },
    { id: 'd3', name: 'مشروب 3', categoryName: 'مشروبات' },
    { id: 'm1', name: 'طبق 1', categoryName: 'أطباق رئيسية' },
    { id: 'm2', name: 'طبق 2', categoryName: 'أطباق رئيسية' },
    { id: 'm3', name: 'طبق 3', categoryName: 'أطباق رئيسية' },
    { id: 's1', name: 'حلوى 1', categoryName: 'حلويات' },
  ];
  return rows.map((row) => ({
    ...row,
    retailPrice: 50,
    offers: [],
    badge: '',
    barcode: `B${row.id}`,
    imageUrl: '',
  }));
}

// Every hardcoded-variant string the board used to render (both
// showroom and restaurant variants), plus the blanket substrings
// that catch any of them. The dynamic board must contain NONE of
// these, whatever the tenant.
const FORBIDDEN_STRINGS = [
  'صالة العرض',
  'المعرض',
  'Digital Showroom Board',
  'Restaurant Menu Board',
  'بث مباشر بصالة العرض',
  'بث مباشر من المطعم',
  'شاشة العروض الترويجية',
  'تسليم فوري من صالة العرض',
  'تحضير طازج في مطبخنا',
  'متوفر بصالة العرض',
  'متوفر في قائمة اليوم',
  'عروض إضافية بالمعرض',
  'أطباق إضافية من القائمة',
  'صفقات وتخفيضات المعرض',
  'عروض وأطباق قائمة اليوم',
  'تصفح منتجاتنا المميزة',
  'تصفح أطباقنا المميزة',
  'مزايا التسوق في صالة العرض',
  'مزايا الطلب في مطعمنا',
  'فحص وتجربة فورية',
  'معاينة المنتج قبل الشراء',
  'معاينة وفحص حقيقي',
  'منتج أصلي ومضمون',
  'دفع إلكتروني آمن',
  'دفع آمن بأي طريقة',
  'استلام فوري',
  'تسليم فوري',
  'تسليم مباشر بالصالة',
  'ضمان معتمد',
  'فاتورة وضمان استبدال',
  'جودة مضمونة',
  'نشرة العروض',
  'نشرة قائمة اليوم',
  'قائمة اليوم',
  'قائمة المطعم',
  'أهلاً بكم في مطعمنا',
  'أهلاً بكم في صالة العرض',
  'أهلاً بكم',
  'طازج يومياً',
  'طازج كل يوم',
  'عروض جديدة كل يوم',
  'عروض وتخفيضات كبرى',
  'فيزا',
  'ماستركارد',
  'InstaPay',
  'اطلب من طاولتك',
  'صالة وسفري',
  'تصفح القائمة واطلب',
  'عرض كافة منتجات الصالة',
  'عرض القائمة كاملة',
  'صالة العرض التفاعلية',
  'وجهتكم الأولى',
  'الصفقات الحصرية',
  'التوصيل بضغطة واحدة',
  'التوصيل الفوري',
  'القسم الرئيسي',
  'جاري تجهيز قائمة اليوم',
  'جاري تجهيز وبث عروض',
];

function expectNoForbiddenStrings(container: HTMLElement) {
  const text = container.textContent || '';
  for (const forbidden of FORBIDDEN_STRINGS) {
    expect(text).not.toContain(forbidden);
  }
}

afterEach(() => {
  mockSettings.current = { storeName: 'متجر الاختبار', currency: 'EGP' };
});

describe('deriveSignageTicker (INV-REST-SIGNAGE-DYNAMIC)', () => {
  it('the merchant stored ticker text always wins', () => {
    expect(
      deriveSignageTicker({
        storeName: 'متجر الاختبار',
        customTickerText: '  عرض خاص اليوم  ',
        promoItems: [promoItem()],
      }),
    ).toBe('عرض خاص اليوم');
  });

  it('derives the ticker from live offers — real names + real discount percents', () => {
    expect(
      deriveSignageTicker({
        storeName: 'متجر الاختبار',
        customTickerText: '',
        promoItems: [
          promoItem({ name: 'طبق 1', discountPercent: 20 }),
          promoItem({ name: 'طبق 2', discountPercent: 0 }),
          promoItem({ name: 'طبق 3', discountPercent: 15 }),
        ],
      }),
    ).toBe('خصم 20% على طبق 1 • خصم 15% على طبق 3');
  });

  it('takes at most the first three discounted offers', () => {
    expect(
      deriveSignageTicker({
        storeName: 'متجر الاختبار',
        customTickerText: '',
        promoItems: [1, 2, 3, 4].map((n) =>
          promoItem({ name: `صنف ${n}`, discountPercent: 10 }),
        ),
      }),
    ).toBe('خصم 10% على صنف 1 • خصم 10% على صنف 2 • خصم 10% على صنف 3');
  });

  it('falls back to a neutral store-name + QR line when nothing is on offer', () => {
    expect(
      deriveSignageTicker({
        storeName: 'متجر الاختبار',
        customTickerText: '',
        promoItems: [promoItem({ discountPercent: 0 })],
      }),
    ).toBe('متجر الاختبار • امسح رمز الـ QR للتصفح والطلب من هاتفك');
  });
});

describe('topCategoriesByCount (INV-REST-SIGNAGE-DYNAMIC)', () => {
  it('counts by category, most items first, and skips empty categories', () => {
    const top = topCategoriesByCount([
      promoItem({ categoryName: 'مشروبات' }),
      promoItem({ categoryName: 'أطباق رئيسية' }),
      promoItem({ categoryName: 'مشروبات' }),
      promoItem({ categoryName: '' }),
      promoItem({ categoryName: 'حلويات' }),
    ]);
    expect(top).toEqual([
      { name: 'مشروبات', count: 2 },
      { name: 'أطباق رئيسية', count: 1 },
      { name: 'حلويات', count: 1 },
    ]);
  });

  it('respects the limit', () => {
    const top = topCategoriesByCount(
      [
        promoItem({ categoryName: 'أ' }),
        promoItem({ categoryName: 'ب' }),
        promoItem({ categoryName: 'ج' }),
      ],
      2,
    );
    expect(top).toHaveLength(2);
  });
});

describe('buildAssortedSample (INV-REST-SIGNAGE-DYNAMIC)', () => {
  it('round-robins across categories — never the first N of one category', () => {
    const items = [
      promoItem({ id: 'a1', name: 'أ 1', categoryName: 'أ' }),
      promoItem({ id: 'a2', name: 'أ 2', categoryName: 'أ' }),
      promoItem({ id: 'a3', name: 'أ 3', categoryName: 'أ' }),
      promoItem({ id: 'b1', name: 'ب 1', categoryName: 'ب' }),
      promoItem({ id: 'b2', name: 'ب 2', categoryName: 'ب' }),
      promoItem({ id: 'b3', name: 'ب 3', categoryName: 'ب' }),
      promoItem({ id: 'c1', name: 'ج 1', categoryName: 'ج' }),
    ];
    expect(buildAssortedSample(items, 3).map((item) => item.id)).toEqual(['a1', 'b1', 'c1']);
    expect(buildAssortedSample(items).map((item) => item.id)).toEqual([
      'a1',
      'b1',
      'c1',
      'a2',
      'b2',
      'a3',
      'b3',
    ]);
  });

  it('respects the limit and returns an empty sample for an empty catalog', () => {
    expect(buildAssortedSample([], 8)).toEqual([]);
    const single = [promoItem({ categoryName: 'أ' }), promoItem({ categoryName: 'أ' })];
    expect(buildAssortedSample(single, 1)).toHaveLength(1);
  });
});

describe('buildSignagePromoItems category truth (INV-REST-SIGNAGE-DYNAMIC)', () => {
  it('a product with no category gets an empty categoryName, never an invented one', () => {
    const product = {
      id: 'p1',
      name: 'بلا قسم',
      retailPrice: 100,
      offers: [],
    } as unknown as Product;
    const [item] = buildSignagePromoItems([product], 'all', '2026-11-09');
    expect(item.categoryName).toBe('');
  });
});

describe('DigitalSignagePage dynamic board (INV-REST-SIGNAGE-DYNAMIC)', () => {
  it('renders real store, offer and category data with zero hardcoded-variant strings', async () => {
    listPageMock.mockResolvedValue({ products: makeOfferProducts(40) });
    const { container } = renderPage();

    await screen.findByText('طبق 1');

    expectNoForbiddenStrings(container);
    expect(screen.getByText('متجر الاختبار')).toBeInTheDocument();
    expect(container.textContent).toContain('80.00');
    expect(container.textContent).toContain('خصم 20%');
    expect(screen.getByText('من قسم أطباق رئيسية')).toBeInTheDocument();
    expect(screen.getByText('العروض المعروضة: 40 • أطباق رئيسية')).toBeInTheDocument();
    expect(screen.getByText('عروض أخرى')).toBeInTheDocument();
    expect(screen.getByText('أقسام العروض')).toBeInTheDocument();
    expect(container.textContent).toContain('40 عرض');
    expect(container.textContent).toContain(
      'خصم 20% على طبق 1 • خصم 20% على طبق 2 • خصم 20% على طبق 3',
    );
    expect(screen.getByText('عروض اليوم')).toBeInTheDocument();
    expect(screen.getByText('بث مباشر')).toBeInTheDocument();
  });

  it('a single offer shows the derived empty-queue placeholder', async () => {
    listPageMock.mockResolvedValue({ products: makeOfferProducts(1) });
    const { container } = renderPage();

    await screen.findByText('طبق 1');

    expectNoForbiddenStrings(container);
    // Deck heading + empty-queue placeholder share the derived title.
    expect(screen.getAllByText('عروض أخرى')).toHaveLength(2);
    expect(screen.getAllByText('من قسم أطباق رئيسية')).toHaveLength(2);
  });

  it('a restaurant tenant sees the SAME dynamic board — no restaurant variant', async () => {
    mockSettings.current = {
      storeName: 'مطعم الاختبار',
      currency: 'EGP',
      activityType: 'restaurant',
    };
    listPageMock.mockResolvedValue({ products: makeOfferProducts(3) });
    const { container } = renderPage();

    await screen.findByText('طبق 1');

    expectNoForbiddenStrings(container);
    expect(screen.getByText('مطعم الاختبار')).toBeInTheDocument();
    expect(screen.getByText('عروض أخرى')).toBeInTheDocument();
    expect(container.textContent).toContain('خصم 20% على طبق 1');
  });

  it('zero offers shows assorted catalog items from across categories, never a single-category slice', async () => {
    listPageMock.mockImplementation(({ view }: { view: string }) =>
      Promise.resolve({ products: view === 'offers' ? [] : makeCatalogProducts() }),
    );
    const { container } = renderPage();

    await screen.findByText('مشروب 1');

    expectNoForbiddenStrings(container);
    // Hero + deck span three different categories.
    expect(screen.getByText('طبق 1')).toBeInTheDocument();
    expect(screen.getByText('حلوى 1')).toBeInTheDocument();
    expect(screen.getByText('أصناف من الكتالوج')).toBeInTheDocument();
    expect(screen.getByText('أقسام الكتالوج')).toBeInTheDocument();
    expect(container.textContent).toContain('أصناف معروضة: 7');
    expect(container.textContent).toContain('3 صنف');
    expect(container.textContent).toContain(
      'متجر الاختبار • امسح رمز الـ QR للتصفح والطلب من هاتفك',
    );
    expect(screen.queryByText('لا توجد عروض حالياً')).not.toBeInTheDocument();
  });

  it('zero offers and an empty catalog shows the neutral empty state, never invented copy', async () => {
    listPageMock.mockResolvedValue({ products: [] });
    const { container } = renderPage();

    // Wait for the welcome board itself ('لوحة العروض' renders only
    // there) — the side deck's category block also carries the
    // no-offers line, so waiting on that text alone resolves while
    // the assorted-catalog fetch is still in flight.
    await screen.findByText('لوحة العروض');

    expectNoForbiddenStrings(container);
    expect(screen.getAllByText('متجر الاختبار')).toHaveLength(2);
    expect(screen.getAllByText('لا توجد عروض حالياً')).toHaveLength(2);
    expect(screen.getByText('عرض كل المنتجات')).toBeInTheDocument();
    expect(screen.getByText('لوحة العروض')).toBeInTheDocument();
    expect(screen.getByText('العروض المعروضة: 0')).toBeInTheDocument();
    expect(container.textContent).toContain(
      'متجر الاختبار • امسح رمز الـ QR للتصفح والطلب من هاتفك',
    );
  });
});
