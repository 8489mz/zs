/* INV-POS-CATEGORY-TILE-FILTER: selecting a category tile must refetch the
   POS catalog from the server filtered by that category. The tile can no
   longer filter only the bounded browse window (first 300 by name)
   client-side — a category whose products sit outside that window showed
   EMPTY even though the category has products. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePosCatalog } from './usePosCatalog';

const { queryMock, current, lookupProductsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  current: { tenantId: 'tenant-a' },
  lookupProductsMock: vi.fn(async () => []),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: queryMock }));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { tenantId: current.tenantId } }) },
}));
vi.mock('@/shared/hooks/use-debounced-value', () => ({
  useDebouncedValue: (value: string) => value,
}));
vi.mock('@/features/pos/api/pos.api', () => ({
  posApi: { lookupProducts: lookupProductsMock },
}));
vi.mock('@/features/pos/lib/pos-catalog-storage', () => ({
  searchCatalogFromStorage: vi.fn(async () => []),
  getAllCatalogFromStorage: vi.fn(async () => []),
  getStoredTenantIdFromStorage: vi.fn(async () => null),
  clearCatalogStorage: vi.fn(async () => {}),
  isPosCachedTenantCompatible: (active: string, stored: string | null) =>
    Boolean(active && stored && active === stored),
}));

describe('POS catalog category filter', () => {
  beforeEach(() => {
    current.tenantId = 'tenant-a';
    queryMock.mockReset().mockReturnValue({ data: [], isFetching: false });
    lookupProductsMock.mockClear();
  });

  it('includes the selected category in the query key so switching tiles refetches', () => {
    renderHook(() => usePosCatalog('', 'branch-1', 'location-1', 'all', '7'));
    const first = queryMock.mock.calls[queryMock.mock.calls.length - 1][0];
    expect(first.queryKey).toContain('7');
  });

  it('fetches the selected category from the server', async () => {
    renderHook(() => usePosCatalog('', 'branch-1', 'location-1', 'all', '7'));
    const first = queryMock.mock.calls[queryMock.mock.calls.length - 1][0];
    await first.queryFn();
    expect(lookupProductsMock).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: '7' }),
    );
  });

  it('does not send a category filter when no tile is selected', async () => {
    renderHook(() => usePosCatalog('', 'branch-1', 'location-1', 'all', null));
    const first = queryMock.mock.calls[queryMock.mock.calls.length - 1][0];
    expect(first.queryKey).not.toContain('7');
    await first.queryFn();
    const params = lookupProductsMock.mock.calls[0][0];
    expect(params.categoryId).toBeUndefined();
  });
});
