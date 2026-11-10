/*
 * D-SF-04 (INV-SF-CATEGORY-SEARCH-GLOBAL): searching from a category page
 * searched only within that category — the category filter ran first and the
 * search-term filter ran on the already category-filtered list, so a product
 * in another category never matched (live trial T14: Homeware page /c/350,
 * search "منتج اختبار 00003" (clothing) returned 0 results, while the same
 * search from the homepage found it). These tests drive the real hook: a
 * search term typed while a category is selected must clear the category
 * (search is global, the same scope as the predictive-search suggestions),
 * category browsing without a search term must keep filtering, and clearing
 * the search must not bring the cleared category back.
 */

import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePublicStorefront } from '@/features/storefront/hooks/usePublicStorefront';
import type {
  StorefrontCatalogResponse,
  StorefrontInfo,
  StorefrontProduct,
} from '@/features/storefront/types/storefront.types';

const { getCatalogMock, getInfoMock } = vi.hoisted(() => ({
  getCatalogMock: vi.fn(),
  getInfoMock: vi.fn(),
}));

vi.mock('@/features/storefront/api/storefront.api', () => ({
  storefrontApi: { getCatalog: getCatalogMock, getInfo: getInfoMock },
}));

vi.mock('@/i18n', () => ({
  useStorefrontLang: () => ({ lang: 'ar' as const }),
}));

function product(
  id: number,
  name: string,
  categoryId: number,
  categoryName: string,
): StorefrontProduct {
  return {
    id,
    name,
    barcode: `BAR-${id}`,
    price: 50,
    categoryId,
    categoryName,
    stockQty: 10,
    inStock: true,
    icon: '',
    imageUrl: '',
    description: '',
  };
}

const catalog: StorefrontCatalogResponse = {
  categories: [
    { id: 350, name: 'Homeware' },
    { id: 12, name: 'Clothing' },
  ],
  products: [
    product(1, 'منتج اختبار 00001', 350, 'Homeware'),
    product(2, 'منتج اختبار 00003', 12, 'Clothing'),
    product(3, 'منتج اختبار 00002', 350, 'Homeware'),
  ],
};

const info = {
  tenantId: 't1',
  slug: 'demo',
  businessName: 'Demo Store',
  enabled: true,
  title: 'Demo Store',
  bio: '',
  announcement: '',
  bannerUrl: '',
  deliveryFee: 0,
  minOrder: 0,
  whatsappPhone: '',
  currency: 'EGP',
  smartDealsEnabled: false,
} as unknown as StorefrontInfo;

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

async function renderStorefront() {
  getCatalogMock.mockResolvedValue(catalog);
  getInfoMock.mockResolvedValue(info);
  const rendered = renderHook(() => usePublicStorefront('demo'), { wrapper });
  await waitFor(() => expect(rendered.result.current.filteredProducts).toHaveLength(3));
  return rendered;
}

describe('usePublicStorefront search from a category page (D-SF-04)', () => {
  it('pins the live reproduction: searching a clothing product from the Homeware page finds it and clears the category', async () => {
    const { result, unmount } = await renderStorefront();

    act(() => {
      result.current.setSelectedCategory(350);
    });
    expect(result.current.filteredProducts.map((p) => p.id).sort()).toEqual([1, 3]);

    act(() => {
      result.current.handleSearchChange('منتج اختبار 00003');
    });

    expect(result.current.selectedCategory).toBe('all');
    expect(result.current.filteredProducts.map((p) => p.id)).toEqual([2]);
    unmount();
  });

  it('keeps search global from the homepage', async () => {
    const { result, unmount } = await renderStorefront();

    act(() => {
      result.current.handleSearchChange('منتج اختبار 00003');
    });

    expect(result.current.selectedCategory).toBe('all');
    expect(result.current.filteredProducts.map((p) => p.id)).toEqual([2]);
    unmount();
  });

  it('searches by category name across categories (suggestions and grid agree)', async () => {
    const { result, unmount } = await renderStorefront();

    act(() => {
      result.current.setSelectedCategory(350);
    });
    act(() => {
      result.current.handleSearchChange('Clothing');
    });

    expect(result.current.selectedCategory).toBe('all');
    expect(result.current.filteredProducts.map((p) => p.id)).toEqual([2]);
    unmount();
  });

  it('clearing the search does not bring the cleared category back', async () => {
    const { result, unmount } = await renderStorefront();

    act(() => {
      result.current.setSelectedCategory(350);
    });
    act(() => {
      result.current.handleSearchChange('منتج اختبار 00003');
    });
    act(() => {
      result.current.handleSearchChange('');
    });

    expect(result.current.searchTerm).toBe('');
    expect(result.current.selectedCategory).toBe('all');
    expect(result.current.filteredProducts).toHaveLength(3);
    unmount();
  });

  it('browsing a category without searching still filters to that category', async () => {
    const { result, unmount } = await renderStorefront();

    act(() => {
      result.current.setSelectedCategory(350);
    });

    expect(result.current.selectedCategory).toBe(350);
    expect(result.current.filteredProducts.map((p) => p.id).sort()).toEqual([1, 3]);
    unmount();
  });
});
