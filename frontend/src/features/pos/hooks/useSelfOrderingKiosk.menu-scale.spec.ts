/* T10-B (INV-REST-KIOSK-MENU-SCALE): the kiosk fetched and rendered the
 * tenant's ENTIRE catalog as cards in one pass — no pagination, no
 * virtualization, no render cap — and a 10 s clock tick re-rendered it
 * all because useKiosk86Items returned a new array identity every
 * render, busting the products/filteredProducts memos. On the trial
 * tenant (10,000 products) the tap that mounts the menu froze the tab.
 *
 * The fix: the kiosk fetches ONE server-side page at a time through
 * storefrontApi.getCatalogPage (GET /api/storefront/:slug/catalog
 * ?page=&pageSize=, max 200/page, with totalCount/hasMore), search and
 * category filtering move server-side (q/categoryId params), the
 * rendered window is capped at KIOSK_CATALOG_PAGE_SIZE cards even if
 * the server ignores pageSize, and the 86-ids are memoized so the
 * clock tick no longer recomputes the grid. Empty/failed catalogs
 * still fail closed to the honest empty state (no slug → no menu,
 * fetch failure → empty menu, never another tenant's menu).
 *
 * These tests drive the real hook against a 10,000-item mock server
 * catalog: the paged fetch is asserted (never the whole-catalog
 * getCatalog), the exposed window is bounded, paging/filtering go
 * through the server, and the 86-ids keep their identity across
 * re-renders. The api-level shape of getCatalogPage (URL, paging
 * fields, error propagation) is pinned in
 * storefront-catalog-no-demo.spec.ts next to getCatalog.
 *
 * RED PROOF: at base getCatalogPage, boundKioskMenuWindow and
 * kioskMenuTotalPages do not exist, the hook calls the whole-catalog
 * getCatalog, and useKiosk86Items maps a fresh array on every render —
 * every case below fails on the base tree. */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useSelfOrderingKiosk,
  useKiosk86Items,
  boundKioskMenuWindow,
  kioskMenuTotalPages,
  KIOSK_CATALOG_PAGE_SIZE,
} from '@/features/pos/hooks/useSelfOrderingKiosk';

const { getCatalogPageMock, getCatalogMock, get86ItemsMock } = vi.hoisted(() => ({
  getCatalogPageMock: vi.fn(),
  getCatalogMock: vi.fn(),
  get86ItemsMock: vi.fn(),
}));

vi.mock('@/features/storefront', () => ({
  storefrontApi: { getCatalogPage: getCatalogPageMock, getCatalog: getCatalogMock },
}));

vi.mock('@/features/pos/api/restaurant-advanced-fnb.api', () => ({
  restaurantAdvancedFnbApi: { get86Items: get86ItemsMock },
}));

/* A 10,000-product tenant catalog, the trial tenant's scale. Five
 * categories; names are searchable so the server-side q filter can be
 * driven through the real hook. */
const ALL_PRODUCTS = Array.from({ length: 10_000 }, (_, i) => ({
  id: i + 1,
  name: `وجبة ${i + 1}`,
  barcode: `T10K-${String(i + 1).padStart(6, '0')}`,
  price: 10 + (i % 90),
  categoryId: (i % 5) + 1,
  categoryName: `قسم ${(i % 5) + 1}`,
  stockQty: 40,
  inStock: true,
  icon: '',
  imageUrl: '',
  description: `وصف وجبة ${i + 1}`,
}));

const CATEGORIES = [1, 2, 3, 4, 5].map((id) => ({ id, name: `قسم ${id}`, imageUrl: '' }));

/* The mock server: filters by categoryId/q, then serves ONE page. */
function mockServerPage(
  _slug: string,
  opts: { page?: number; pageSize?: number; categoryId?: number; q?: string } = {},
) {
  const page = opts.page || 1;
  const pageSize = opts.pageSize || 50;
  let rows = ALL_PRODUCTS;
  if (opts.categoryId && Number(opts.categoryId) > 0) {
    rows = rows.filter((p) => p.categoryId === Number(opts.categoryId));
  }
  if (opts.q && String(opts.q).trim()) {
    const q = String(opts.q).trim().toLowerCase();
    rows = rows.filter(
      (p) => p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q),
    );
  }
  const totalCount = rows.length;
  const start = (page - 1) * pageSize;
  return Promise.resolve({
    categories: CATEGORIES,
    products: rows.slice(start, start + pageSize),
    page,
    pageSize,
    totalCount,
    hasMore: page * pageSize < totalCount,
  });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCatalogPageMock.mockImplementation(mockServerPage);
  getCatalogMock.mockResolvedValue({ categories: CATEGORIES, products: ALL_PRODUCTS });
  get86ItemsMock.mockResolvedValue([]);
});

describe('boundKioskMenuWindow (T10-B)', () => {
  it('caps a 10,000-item list at one page — the rendered window is bounded', () => {
    expect(KIOSK_CATALOG_PAGE_SIZE).toBe(50);
    const window = boundKioskMenuWindow(ALL_PRODUCTS);
    expect(window).toHaveLength(50);
    expect(window[0].id).toBe(1);
    expect(window[49].id).toBe(50);
  });

  it('keeps a small menu untouched and an empty menu empty', () => {
    const small = ALL_PRODUCTS.slice(0, 3);
    expect(boundKioskMenuWindow(small)).toHaveLength(3);
    expect(boundKioskMenuWindow([])).toEqual([]);
  });
});

describe('kioskMenuTotalPages (T10-B)', () => {
  it('10,000 items at 50/page is 200 pages; a partial last page still counts', () => {
    expect(kioskMenuTotalPages(10_000, 50)).toBe(200);
    expect(kioskMenuTotalPages(51, 50)).toBe(2);
    expect(kioskMenuTotalPages(50, 50)).toBe(1);
    expect(kioskMenuTotalPages(0, 50)).toBe(1);
  });
});

describe('useSelfOrderingKiosk paged menu (T10-B)', () => {
  it('fetches ONE server page — never the whole 10k catalog', async () => {
    const { result } = renderHook(() => useSelfOrderingKiosk('test10k'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.catalogData).toBeDefined());
    await waitFor(() => expect(result.current.catalogData?.products).toHaveLength(50));
    // The whole-catalog endpoint is never called for the kiosk menu.
    expect(getCatalogMock).not.toHaveBeenCalled();
    expect(getCatalogPageMock).toHaveBeenCalledWith(
      'test10k',
      expect.objectContaining({ page: 1, pageSize: 50 }),
    );
    // The server total is known, the window is bounded.
    expect(result.current.catalogTotalCount).toBe(10_000);
    expect(result.current.catalogHasMore).toBe(true);
    expect(result.current.catalogData?.products).toHaveLength(50);
    expect(result.current.catalogPage).toBe(1);
  });

  it('bounds the window even when the server ignores pageSize and returns everything', async () => {
    getCatalogPageMock.mockImplementationOnce(async () => ({
      categories: CATEGORIES,
      products: ALL_PRODUCTS,
      page: 1,
      pageSize: 50,
      totalCount: 10_000,
      hasMore: true,
    }));
    const { result } = renderHook(() => useSelfOrderingKiosk('test10k'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.catalogData).toBeDefined());
    await waitFor(() => expect(result.current.catalogData?.products).toHaveLength(50));
    expect(result.current.catalogTotalCount).toBe(10_000);
  });

  it('page 2 fetches the next server page — different items, same bound', async () => {
    const { result } = renderHook(() => useSelfOrderingKiosk('test10k'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.catalogData?.products).toHaveLength(50));
    act(() => {
      result.current.setCatalogPage(2);
    });
    await waitFor(() => expect(result.current.catalogPage).toBe(2));
    await waitFor(() => expect(result.current.catalogData?.products[0].id).toBe(51));
    expect(result.current.catalogData?.products).toHaveLength(50);
    expect(getCatalogPageMock).toHaveBeenCalledWith(
      'test10k',
      expect.objectContaining({ page: 2, pageSize: 50 }),
    );
  });

  it('a category change filters server-side and resets to page 1', async () => {
    const { result, rerender } = renderHook(
      ({ categoryId }: { categoryId?: number | 'all' }) =>
        useSelfOrderingKiosk('test10k', { categoryId }),
      { wrapper: createWrapper(), initialProps: { categoryId: 'all' as const } },
    );
    await waitFor(() => expect(result.current.catalogData?.products).toHaveLength(50));
    act(() => {
      result.current.setCatalogPage(3);
    });
    await waitFor(() => expect(result.current.catalogPage).toBe(3));
    rerender({ categoryId: 3 });
    await waitFor(() =>
      expect(getCatalogPageMock).toHaveBeenCalledWith(
        'test10k',
        expect.objectContaining({ page: 1, pageSize: 50, categoryId: 3 }),
      ),
    );
    await waitFor(() => expect(result.current.catalogPage).toBe(1));
    await waitFor(() => expect(result.current.catalogTotalCount).toBe(2_000));
    expect(
      (result.current.catalogData?.products || []).every((p: any) => p.categoryId === 3),
    ).toBe(true);
  });

  it('a search filters server-side via q — the browser never holds the whole catalog', async () => {
    const { result, rerender } = renderHook(
      ({ search }: { search?: string }) => useSelfOrderingKiosk('test10k', { search }),
      { wrapper: createWrapper(), initialProps: { search: '' } },
    );
    await waitFor(() => expect(result.current.catalogData?.products).toHaveLength(50));
    rerender({ search: 'وجبة 9999' });
    await waitFor(
      () =>
        expect(getCatalogPageMock).toHaveBeenCalledWith(
          'test10k',
          expect.objectContaining({ q: 'وجبة 9999' }),
        ),
      { timeout: 5_000 },
    );
    await waitFor(() => expect(result.current.catalogTotalCount).toBe(1));
    expect(result.current.catalogData?.products).toHaveLength(1);
    expect(result.current.catalogData?.products[0].id).toBe(9999);
  });

  it('fails closed on an unknown slug: no fetch, empty menu', async () => {
    const { result } = renderHook(() => useSelfOrderingKiosk(null), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.catalogData).toBeDefined());
    expect(getCatalogPageMock).not.toHaveBeenCalled();
    expect(getCatalogMock).not.toHaveBeenCalled();
    expect(result.current.catalogData?.products).toEqual([]);
    expect(result.current.catalogTotalCount).toBe(0);
    expect(result.current.catalogHasMore).toBe(false);
  });

  it('a failed fetch renders the honest empty menu — never another tenant or a crash', async () => {
    getCatalogPageMock.mockRejectedValueOnce(new Error('Request failed with status code 500'));
    const { result } = renderHook(() => useSelfOrderingKiosk('test10k'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.catalogData).toBeDefined());
    expect(result.current.catalogData?.products).toEqual([]);
    expect(result.current.catalogTotalCount).toBe(0);
    expect(result.current.isCatalogLoading).toBe(false);
  });
});

describe('useKiosk86Items identity (T10-B)', () => {
  it('returns the SAME array identity across re-renders — the clock tick must not bust the memos', async () => {
    get86ItemsMock.mockResolvedValue([{ product_id: 5 }, { product_id: 9 }]);
    const { result, rerender } = renderHook(() => useKiosk86Items('test10k'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current).toEqual([5, 9]));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    rerender();
    expect(result.current).toBe(first);
  });
});
