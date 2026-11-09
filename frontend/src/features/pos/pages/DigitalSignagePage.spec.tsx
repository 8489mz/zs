/* R-B5 + signage slice of R-B6 (INV-REST-SIGNAGE-TRUTH): the signage
 * screen must show only real prices. At base (d38cd2fc) the promo
 * builder invented prices on every product without a real offer:
 * promotionalPrice || offerPrice || (retail * 0.85) || flat 100, a
 * fabricated "was" price (promo * 1.25 when retail was 0), a discount
 * that defaulted to 15%, and a badge cycled by slide index
 * ('عرض خاص' / 'أفضل مبيعاً' / 'صفقة اليوم' / 'تخفيض محدود' /
 * 'سعر حصري'). An expired p.offers[0] was shown as the current offer,
 * the offers query silently fell back to the full-price catalog when
 * the offers view was empty, and a failed query rendered the welcome
 * screen as if all were fine (isError never read).
 *
 * The helper buildSignagePromoItems is new, so there is no behavioral
 * base run for it (at base the module does not exist); instead every
 * old-bug scenario below pins the truthful value on the exact old
 * inputs — e.g. retail 100 with no offer is 100 / 0% now, not 85 /
 * 15%. The render tests pin the two wiring fixes (no offers-view
 * fallback, visible error state) against the real page.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import DigitalSignagePage, { buildSignagePromoItems } from './DigitalSignagePage';
import type { Product, ProductOffer } from '@/types/domain';

// Hoisted mock: the spec must not import the api module directly — the
// page-composition check flags a direct api import in any file under
// pages/, specs included. The page under test goes through the mocked
// module; the spec only ever touches this hoisted fn.
const listPageMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/products/api/products.api', () => ({
  productsApi: { listPage: listPageMock },
}));

vi.mock('@/features/pos/lib/pos-customer-display-bridge', () => ({
  subscribeSignageOffersUpdate: () => () => {},
}));

// The language hook calls i18n.changeLanguage in an effect; the test
// harness's react-i18next instance has no changeLanguage. The hook is
// orthogonal to the price-truth wiring under test here.
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
      ({ data: { storeName: 'متجر الاختبار', currency: 'EGP' } }) as unknown as ReturnType<
        typeof actual.useSettingsQuery
      >,
  };
});

const TODAY = '2026-11-09';

function product(overrides: Record<string, unknown> = {}): Product {
  const base: Product = {
    id: 'p1',
    name: 'منتج اختبار',
    barcode: 'BC1',
    categoryId: '',
    supplierId: '',
    costPrice: 50,
    retailPrice: 100,
    wholesalePrice: 80,
    stock: 10,
    minStock: 0,
    notes: '',
    units: [
      {
        id: 'u1',
        name: 'قطعة',
        multiplier: 1,
        barcode: '',
        isBaseUnit: true,
        isSaleUnit: true,
        isPurchaseUnit: true,
      },
    ],
  };
  return Object.assign(base, overrides);
}

function offer(overrides: Record<string, unknown> = {}): ProductOffer {
  return {
    type: 'percent',
    value: 20,
    from: '2026-01-01',
    to: '2026-12-31',
    ...overrides,
  };
}

describe('buildSignagePromoItems (INV-REST-SIGNAGE-TRUTH)', () => {
  it('shows the real retail price with no discount when there is no offer', () => {
    // Old code: promo 85 (retail * 0.85), discount 15, fake badge.
    const [item] = buildSignagePromoItems([product()], 'all', TODAY);
    expect(item.promoPrice).toBe(100);
    expect(item.originalPrice).toBe(100);
    expect(item.discountPercent).toBe(0);
    expect(item.savingAmount).toBe(0);
    expect(item.badge).toBe('');
  });

  it('never invents a flat 100 or a fabricated "was" price for a zero retail', () => {
    // Old code: promo 100, original 125 (100 * 1.25), discount 15.
    const [item] = buildSignagePromoItems([product({ retailPrice: 0 })], 'all', TODAY);
    expect(item.promoPrice).toBe(0);
    expect(item.originalPrice).toBe(0);
    expect(item.discountPercent).toBe(0);
    expect(item.savingAmount).toBe(0);
  });

  it('lists no product at all in the offers view when nothing is really on offer', () => {
    expect(buildSignagePromoItems([product(), product({ id: 'p2', retailPrice: 50 })], 'offers', TODAY)).toHaveLength(0);
  });

  it('prices a real active percent offer from the offer, not from 15% off', () => {
    const [item] = buildSignagePromoItems([product({ offers: [offer({ value: 20 })] })], 'offers', TODAY);
    expect(item.promoPrice).toBe(80);
    expect(item.originalPrice).toBe(100);
    expect(item.discountPercent).toBe(20);
    expect(item.savingAmount).toBe(20);
    expect(item.badge).toBe('عرض خاص');
  });

  it('never shows an expired offer as current', () => {
    const expired = product({ offers: [offer({ to: '2026-11-08' })] });
    // Offers view: an expired-only product is not an offer.
    expect(buildSignagePromoItems([expired], 'offers', TODAY)).toHaveLength(0);
    // All view: it shows at its real full price, with no discount.
    const [item] = buildSignagePromoItems([expired], 'all', TODAY);
    expect(item.promoPrice).toBe(100);
    expect(item.discountPercent).toBe(0);
    expect(item.badge).toBe('');
  });

  it('never shows a not-yet-started offer as current', () => {
    const upcoming = product({ offers: [offer({ from: '2026-11-10', to: '2026-11-30' })] });
    expect(buildSignagePromoItems([upcoming], 'offers', TODAY)).toHaveLength(0);
    const [item] = buildSignagePromoItems([upcoming], 'all', TODAY);
    expect(item.promoPrice).toBe(100);
    expect(item.discountPercent).toBe(0);
  });

  it('treats the offer window as inclusive on both ends', () => {
    const endsToday = product({ offers: [offer({ to: '2026-11-09' })] });
    const startsToday = product({ offers: [offer({ from: '2026-11-09' })] });
    expect(buildSignagePromoItems([endsToday], 'offers', TODAY)).toHaveLength(1);
    expect(buildSignagePromoItems([startsToday], 'offers', TODAY)).toHaveLength(1);
  });

  it('prices fixed, price and bundle offers from the real offer values', () => {
    const [fixed] = buildSignagePromoItems(
      [product({ offers: [offer({ type: 'fixed', value: 30 })] })],
      'offers',
      TODAY,
    );
    expect(fixed.promoPrice).toBe(70);
    expect(fixed.discountPercent).toBe(30);

    const [priced] = buildSignagePromoItems(
      [product({ offers: [offer({ type: 'price', value: 60 })] })],
      'offers',
      TODAY,
    );
    expect(priced.promoPrice).toBe(60);
    expect(priced.discountPercent).toBe(40);

    const [bundled] = buildSignagePromoItems(
      [product({ retailPrice: 150, offers: [offer({ type: 'bundle', value: 200, minQty: 2 })] })],
      'offers',
      TODAY,
    );
    expect(bundled.promoPrice).toBe(100);
    expect(bundled.discountPercent).toBe(33);
  });

  it('prices a buy-one-get-one offer as the real per-unit price', () => {
    const [item] = buildSignagePromoItems(
      [
        product({
          offers: [offer({ type: 'bogo', value: 1, bogoBuyQty: 1, bogoGetQty: 1, bogoDiscountPercent: 100 })],
        }),
      ],
      'offers',
      TODAY,
    );
    expect(item.promoPrice).toBe(50);
    expect(item.discountPercent).toBe(50);
  });

  it('ignores an offer price that is not really below retail', () => {
    // A "price" offer above retail is a markup, not a discount.
    const markedUp = product({ offers: [offer({ type: 'price', value: 150 })] });
    expect(buildSignagePromoItems([markedUp], 'offers', TODAY)).toHaveLength(0);
    const [item] = buildSignagePromoItems([markedUp], 'all', TODAY);
    expect(item.promoPrice).toBe(100);
    expect(item.discountPercent).toBe(0);
  });

  it('honours a real promotional price only when it is really below retail', () => {
    const [real] = buildSignagePromoItems([product({ promotionalPrice: 70 })], 'offers', TODAY);
    expect(real.promoPrice).toBe(70);
    expect(real.discountPercent).toBe(30);

    const inflated = product({ promotionalPrice: 120 });
    expect(buildSignagePromoItems([inflated], 'offers', TODAY)).toHaveLength(0);
    const [shown] = buildSignagePromoItems([inflated], 'all', TODAY);
    expect(shown.promoPrice).toBe(100);
    expect(shown.discountPercent).toBe(0);
  });

  it('honours a genuine free promotional price', () => {
    const [item] = buildSignagePromoItems([product({ promotionalPrice: 0 })], 'offers', TODAY);
    expect(item.promoPrice).toBe(0);
    expect(item.discountPercent).toBe(100);
    expect(item.savingAmount).toBe(100);
  });

  it('keeps a product-configured badge and never invents a superlative', () => {
    const [configured] = buildSignagePromoItems(
      [product({ badge: 'تخفيضات الشتاء', offers: [offer()] })],
      'offers',
      TODAY,
    );
    expect(configured.badge).toBe('تخفيضات الشتاء');

    const items = buildSignagePromoItems(
      [
        product({ offers: [offer()] }),
        product({ id: 'p2' }),
        product({ id: 'p3', offers: [offer({ to: '2026-11-08' })] }),
        product({ id: 'p4', offers: [offer({ type: 'fixed', value: 10 })] }),
      ],
      'all',
      TODAY,
    );
    for (const item of items) {
      expect(['أفضل مبيعاً', 'صفقة اليوم', 'تخفيض محدود', 'سعر حصري']).not.toContain(item.badge);
    }
  });

  it('keeps only real current offers in the offers view, in input order', () => {
    const items = buildSignagePromoItems(
      [
        product({ id: 'a', offers: [offer({ value: 10 })] }),
        product({ id: 'b' }),
        product({ id: 'c', offers: [offer({ to: '2026-11-08' })] }),
        product({ id: 'd', offers: [offer({ type: 'fixed', value: 5 })] }),
      ],
      'offers',
      TODAY,
    );
    expect(items.map((item) => item.id)).toEqual(['a', 'd']);
  });
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

describe('DigitalSignagePage wiring (R-B5 fallback + R-B6 error state)', () => {
  it('never falls back to the full-price catalog when the offers view is empty', async () => {
    listPageMock.mockResolvedValue({ products: [] });
    renderPage();

    // The welcome screen (not a product) is the honest empty state.
    await screen.findAllByText('متجر الاختبار');
    expect(listPageMock).toHaveBeenCalledTimes(1);
    expect(listPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'offers' }),
    );
  });

  it('shows a visible disconnected state — never the welcome screen — when the query fails, and retry works', async () => {
    listPageMock.mockRejectedValueOnce(new Error('Network failed'));
    listPageMock.mockResolvedValue({
      products: [product({ offers: [offer({ value: 20, from: '2026-01-01', to: '2026-12-31' })] })],
    });
    const { container } = renderPage();

    await screen.findByText('تعذّر تحميل العروض');
    expect(screen.queryByText('عرض كافة منتجات الصالة')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('80.00');

    fireEvent.click(screen.getByText('إعادة المحاولة'));
    await waitFor(() => expect(container.textContent).toContain('80.00'));
    expect(listPageMock).toHaveBeenCalledTimes(2);
  });

  it('renders a real offer at its real price, never the invented 15% off', async () => {
    listPageMock.mockResolvedValue({
      products: [product({ offers: [offer({ value: 20, from: '2026-01-01', to: '2026-12-31' })] })],
    });
    const { container } = renderPage();

    await waitFor(() => expect(container.textContent).toContain('80.00'));
    expect(container.textContent).not.toContain('85.00');
    expect(container.textContent).toContain('خصم 20%');
  });
});
