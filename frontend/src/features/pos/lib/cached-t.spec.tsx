import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance, type i18n as I18nInstance } from 'i18next';
import { initReactI18next, I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PosProductsPanel } from '../components/PosProductsPanel';
import { cachedTranslate, clearCachedTranslations, useCachedT } from './cached-t';
import type { Product } from '@/types/domain';

/**
 * Cached i18n t() for the POS hot path.
 *
 * The panel + cart render thousands of identical 2-arg t() calls per
 * render; i18next caches nothing, so every call pays the full lookup.
 * useCachedT() memoizes the plain cases behind a module Map. These tests
 * prove BOTH the saving AND the safety:
 *  1. a re-rendered card issues ~0 underlying i18n.t calls for cached keys;
 *  2. language switches still serve the new language's strings;
 *  3. a key added to the store after its fallback was cached is served
 *     fresh (the missing-key hazard);
 *  4. calls WITH options (count) bypass the cache entirely.
 *
 * The tests run against an isolated i18next instance (I18nextProvider),
 * so they never touch the app's real i18n setup or its auto-translator.
 */

// Keys the memoized product card (PosProductGroupCardComponent) resolves
// with plain 2-arg t() calls. The variant picker also uses
// pos.out_of_stock / pos.add_short, but it is never opened here, so every
// call for these keys during this spec comes from a card.
const CARD_KEYS = new Set([
  'pos.options',
  'pos.out_of_stock',
  'pos.left',
  'pos.pos_products_panel.s24',
  'pos.pos_products_panel.s25',
  'pos.pos_products_panel.s26',
  'pos.pos_products_panel.s27',
  'pos.pos_products_panel.s28',
  'pos.pos_products_panel.s30',
  'pos.pos_products_panel.s31',
  'pos.options_short',
  'pos.add_short',
]);

const RESOURCES = {
  ar: {
    translation: {
      pos: {
        options: 'خيارات',
        out_of_stock: 'نفد',
        left: 'متبقي',
        table_item: 'الصنف',
        pos_products_panel: {
          s24: 'مباشر',
          s25: 'إزالة من المفضلة',
          s26: 'إضافة إلى المفضلة',
          s27: 'افتح الاختيارات',
          s28: 'أضف الآن',
          s30: 'إزالة من المفضلة',
          s31: 'إضافة إلى المفضلة',
        },
        options_short: 'خيارات',
        add_short: 'أضف',
      },
      probe: {
        count: '{{count}} عناصر',
      },
    },
  },
  en: {
    translation: {
      pos: {
        options: 'Options',
        out_of_stock: 'Out of stock',
        left: 'left',
        table_item: 'Item',
        pos_products_panel: {
          s24: 'Direct',
          s25: 'Remove from favorites',
          s26: 'Add to favorites',
          s27: 'Open options',
          s28: 'Add now',
          s30: 'Remove from favorites',
          s31: 'Add to favorites',
        },
        options_short: 'Options',
        add_short: 'Add',
      },
      probe: {
        count: '{{count}} items',
      },
    },
  },
};

async function createTestI18n(): Promise<I18nInstance> {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    lng: 'ar',
    fallbackLng: 'ar',
    resources: RESOURCES,
    interpolation: { escapeValue: false },
  });
  return instance;
}

function createProduct(index: number): Product {
  const suffix = String(index).padStart(3, '0');
  return {
    id: `product-${suffix}`,
    name: `Product ${suffix}`,
    barcode: `barcode-${suffix}`,
    categoryId: 'category-1',
    supplierId: 'supplier-1',
    costPrice: 10,
    retailPrice: 20,
    wholesalePrice: 18,
    stock: 10,
    minStock: 1,
    notes: '',
    units: [],
  };
}

function panelProps(products: Product[], priceType: 'retail' | 'wholesale' = 'retail') {
  return {
    search: '',
    onSearchChange: vi.fn(),
    onSearchSubmitFirstResult: () => false,
    priceType,
    onPriceTypeChange: vi.fn(),
    products,
    recentProducts: [] as Product[],
    onAddProduct: vi.fn(),
    productFilter: 'all' as const,
    onProductFilterChange: vi.fn(),
    searchInputRef: createRef<HTMLInputElement>(),
    posMode: 'touch' as const,
  };
}

/** Renders one cached lookup so the hook (not just the pure fn) is exercised. */
function Probe({ i18nKey, defaultValue }: { i18nKey: string; defaultValue?: string }) {
  const t = useCachedT();
  return <span>{t(i18nKey, defaultValue)}</span>;
}

describe('cached-t', () => {
  let testI18n: I18nInstance;

  beforeEach(async () => {
    clearCachedTranslations();
    testI18n = await createTestI18n();
  });

  it('serves a re-rendered card from cache: ~0 underlying i18n.t calls for cached keys', async () => {
    const products = [createProduct(1), createProduct(2), createProduct(3)];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['settings'], {});
    client.setQueryData(['pos-categories'], []);
    // Spy BEFORE render: useTranslation binds i18n.t at call time, and the
    // cached hook calls i18n.t directly, so the spy sees every real lookup.
    const tSpy = vi.spyOn(testI18n, 't');
    const cardCalls = () =>
      tSpy.mock.calls.filter(([key]) => CARD_KEYS.has(String(key))).length;

    const { rerender } = render(
      <I18nextProvider i18n={testI18n}>
        <QueryClientProvider client={client}>
          <PosProductsPanel {...panelProps(products)} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    await screen.findByText('Product 001');
    await screen.findByText('Product 003');

    // The probe really sees card lookups on first render.
    const firstRenderCardCalls = cardCalls();
    expect(firstRenderCardCalls).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Product 001')).toBeInTheDocument();
    tSpy.mockClear();

    // New priceType forces every card to re-render (its price label
    // changes) while the translated strings stay identical.
    rerender(
      <I18nextProvider i18n={testI18n}>
        <QueryClientProvider client={client}>
          <PosProductsPanel {...panelProps(products, 'wholesale')} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    await screen.findByText('Product 001');

    expect(cardCalls()).toBe(0);
    expect(screen.getByText('Product 001')).toBeInTheDocument();
  });

  it('serves the new language after a language switch, and back again', async () => {
    render(
      <I18nextProvider i18n={testI18n}>
        <Probe i18nKey="pos.table_item" defaultValue="الصنف" />
      </I18nextProvider>,
    );
    expect(screen.getByText('الصنف')).toBeInTheDocument();

    await act(async () => {
      await testI18n.changeLanguage('en');
    });
    expect(screen.getByText('Item')).toBeInTheDocument();

    await act(async () => {
      await testI18n.changeLanguage('ar');
    });
    expect(screen.getByText('الصنف')).toBeInTheDocument();
  });

  it('serves a key added to the store after its fallback was cached', async () => {
    const { rerender } = render(
      <I18nextProvider i18n={testI18n}>
        <Probe i18nKey="pos.probe_missing" defaultValue="قيمة احتياطية" />
      </I18nextProvider>,
    );
    // Missing in both bundles: the defaultValue fallback is what gets cached.
    expect(screen.getByText('قيمة احتياطية')).toBeInTheDocument();

    // The key is added afterwards, in the CURRENT language: the store
    // 'added' event must clear the cache, so the next render serves the
    // new value instead of the cached fallback.
    // NOTE: react-i18next v17 defaults bindI18nStore to '', so a component
    // does NOT spontaneously re-render on a store add (same for raw t());
    // the next render — forced here with rerender — is what must be fresh.
    testI18n.addResourceBundle(
      'ar',
      'translation',
      { pos: { probe_missing: 'قيمة جديدة' } },
      true,
      true,
    );
    rerender(
      <I18nextProvider i18n={testI18n}>
        <Probe i18nKey="pos.probe_missing" defaultValue="قيمة احتياطية" />
      </I18nextProvider>,
    );
    expect(screen.getByText('قيمة جديدة')).toBeInTheDocument();
  });

  it('bypasses the cache for calls with options and reflects a changed count', () => {
    const tSpy = vi.spyOn(testI18n, 't');
    expect(cachedTranslate(testI18n, 'probe.count', { count: 2 })).toBe('2 عناصر');
    expect(cachedTranslate(testI18n, 'probe.count', { count: 5 })).toBe('5 عناصر');
    // Both calls reached the real t(): nothing was cached for count calls.
    expect(tSpy).toHaveBeenCalledTimes(2);

    // ...while a plain call IS cached on its second use.
    tSpy.mockClear();
    expect(cachedTranslate(testI18n, 'pos.table_item', 'الصنف')).toBe('الصنف');
    expect(cachedTranslate(testI18n, 'pos.table_item', 'الصنف')).toBe('الصنف');
    expect(tSpy).toHaveBeenCalledTimes(1);
  });
});
