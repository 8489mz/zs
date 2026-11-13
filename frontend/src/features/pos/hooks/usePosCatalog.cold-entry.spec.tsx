/* INV-POS-COLD-ENTRY-CACHED-CATALOG-PAINT: on a cold POS entry the product
   grid must paint from the warm IndexedDB catalog while the network lookup
   is still in flight — the grid must not wait on the slowest of five network
   queries. The fallback is browse-only: cached rows are unscoped browse rows,
   so they must never leak into the grid once a search resolves. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePosCatalog } from './usePosCatalog';

const cachedProducts = [
  { id: 'cache-1', name: 'Cached Tea', retailPrice: 10, wholesalePrice: 8, stock: 10, units: [] },
  { id: 'cache-2', name: 'Cached Sugar', retailPrice: 20, wholesalePrice: 16, stock: 5, units: [] },
  { id: 'cache-3', name: 'Cached Coffee', retailPrice: 30, wholesalePrice: 24, stock: 8, units: [] },
];

const searchMatch = { id: 'net-1', name: 'Network Tea', retailPrice: 10, wholesalePrice: 8, stock: 10, units: [] };

const { queryMock, current, getAllMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  current: { tenantId: 'tenant-a' },
  getAllMock: vi.fn(async () => [] as Array<Record<string, unknown>>),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: queryMock }));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { tenantId: current.tenantId } }) },
}));
vi.mock('@/shared/hooks/use-debounced-value', () => ({
  useDebouncedValue: (value: string) => value,
}));
vi.mock('@/features/pos/lib/pos-catalog-storage', () => ({
  searchCatalogFromStorage: vi.fn(async () => []),
  getAllCatalogFromStorage: getAllMock,
  getStoredTenantIdFromStorage: vi.fn(async () => 'tenant-a'),
  clearCatalogStorage: vi.fn(async () => {}),
  isPosCachedTenantCompatible: (active: string, stored: string | null) =>
    Boolean(active && stored && active === stored),
}));

describe('POS cold entry — cached catalog paint', () => {
  beforeEach(() => {
    current.tenantId = 'tenant-a';
    queryMock.mockReset();
    getAllMock.mockReset().mockResolvedValue([]);
  });

  it('shows warm IndexedDB rows in saleProducts while the network lookup is pending', async () => {
    getAllMock.mockResolvedValue(cachedProducts as never);
    queryMock.mockReturnValue({ data: undefined, isLoading: true, isFetching: true });

    const { result } = renderHook(() => usePosCatalog('', 'branch-1', 'location-1'));

    await waitFor(() => {
      expect(result.current.saleProducts.map((p) => p.id)).toEqual(['cache-1', 'cache-2', 'cache-3']);
    }, { timeout: 5000 });
  });

  it('does not leak cached browse rows into the grid once a search resolves', async () => {
    getAllMock.mockResolvedValue(cachedProducts as never);
    queryMock.mockReturnValue({ data: [searchMatch], isLoading: false, isFetching: false });

    const { result } = renderHook(() => usePosCatalog('Network Tea', 'branch-1', 'location-1'));

    await waitFor(() => {
      expect(result.current.saleProducts.map((p) => p.id)).toEqual(['net-1']);
    }, { timeout: 5000 });
  });

  it('shows nothing when the cache is cold and the network is pending (first-ever visit)', async () => {
    getAllMock.mockResolvedValue([]);
    queryMock.mockReturnValue({ data: undefined, isLoading: true, isFetching: true });

    const { result } = renderHook(() => usePosCatalog('', 'branch-1', 'location-1'));

    await waitFor(() => {
      expect(result.current.catalogProducts).toEqual([]);
    }, { timeout: 5000 });
    expect(result.current.saleProducts).toEqual([]);
  });
});
