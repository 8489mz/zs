/* INV-POS-COLD-ENTRY-CACHED-CATALOG-PAINT (gate half): on a cold POS entry
   the products panel must mount while the network catalog is still in
   flight — the whole workspace must not hide behind "جارٍ تحميل بيانات
   الكاشير..." until the slowest of five queries resolves. The panel paints
   the warm IndexedDB rows while the lookup is pending. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PosWorkspace } from './PosWorkspace';
import { useAuthStore } from '@/stores/auth-store';

const { cachedProducts } = vi.hoisted(() => ({
  cachedProducts: [
    { id: 'cache-1', name: 'Cached Tea', retailPrice: 10, wholesalePrice: 8, stock: 10, units: [] },
    { id: 'cache-2', name: 'Cached Sugar', retailPrice: 20, wholesalePrice: 16, stock: 5, units: [] },
    { id: 'cache-3', name: 'Cached Coffee', retailPrice: 30, wholesalePrice: 24, stock: 8, units: [] },
  ],
}));

vi.mock('@/shared/components/page-header', () => ({
  PageHeader: () => <div data-testid="pos-header" />,
}));

vi.mock('@/shared/components/query-feedback', () => ({
  QueryFeedback: ({ isLoading, loadingText, children }: { isLoading?: boolean; loadingText?: string; children: ReactNode }) => (
    isLoading ? <div data-testid="catalogs-loading">{loadingText}</div> : <>{children}</>
  ),
}));

vi.mock('@/shared/ui/currency-symbol', () => ({
  CurrencySymbol: () => <span>ج.م</span>,
}));

vi.mock('@/features/pos/components/PosProductsPanel', () => ({
  PosProductsPanel: ({ products }: { products: Array<{ id: string | number; name: string }> }) => (
    <div data-testid="pos-products-panel">
      {(products || []).map((p) => <span key={String(p.id)}>{p.name}</span>)}
    </div>
  ),
}));

vi.mock('@/features/pos/components/PosCartPanel', () => ({
  PosCartPanel: () => <div data-testid="pos-cart-panel" />,
}));

vi.mock('@/features/pos/components/pos-workspace/PosWorkspaceDock', () => ({
  PosWorkspaceDock: () => <div data-testid="pos-dock" />,
}));

vi.mock('@/features/pos/components/pos-workspace/PosWorkspaceStatusCards', () => ({
  PosWorkspaceStartupIssues: () => null,
}));

vi.mock('@/features/pos/hooks/usePosUiCustomization', () => ({
  usePosUiCustomization: () => ({ customization: { autoHideBottomNav: false } }),
}));

vi.mock('@/shared/hooks/useSplitter', () => ({
  useSplitter: () => ({ leftRatio: 38, rightRatio: 62, handlePositionPct: 38, startDrag: vi.fn() }),
}));

vi.mock('@/shared/hooks/use-is-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/features/pos/api/pos.api', () => ({
  posApi: {
    customers: async () => [],
    settings: async () => ({ restaurantModuleEnabled: true, currency: 'EGP' }),
    branches: async () => [],
    locations: async () => [],
    // The network catalog never resolves: the cold-entry pending state.
    lookupProducts: () => new Promise(() => {}),
    listHeldDrafts: async () => [],
    getCatalogVersion: async () => ({ version: 'v1', totalCount: 3 }),
    saveHeldDraft: async () => ({}),
    deleteHeldDraft: async () => ({}),
    clearHeldDrafts: async () => ({}),
    authorizeDiscountOverride: async () => ({}),
    logSecurityEvent: async () => ({}),
  },
}));

vi.mock('@/features/pos/api/restaurant-advanced-fnb.api', () => ({
  restaurantAdvancedFnbApi: {
    getZones: async () => [],
    get86Items: async () => [{ product_id: 7 }],
  },
}));

vi.mock('@/lib/api/cash-drawer', () => ({
  cashDrawerApi: {
    listPage: async () => ({ rows: [] }),
  },
}));

vi.mock('@/features/pos/lib/pos-catalog-storage', () => ({
  searchCatalogFromStorage: vi.fn(async () => []),
  getAllCatalogFromStorage: vi.fn(async () => cachedProducts),
  getStoredTenantIdFromStorage: vi.fn(async () => 'tenant-a'),
  getCatalogVersionFromStorage: vi.fn(async () => 'v1'),
  getCatalogCountFromStorage: vi.fn(async () => 3),
  getLastSyncedAtFromStorage: vi.fn(async () => new Date().toISOString()),
  clearCatalogStorage: vi.fn(async () => {}),
  saveCatalogToStorage: vi.fn(async () => {}),
  lookupProductByBarcodeFromStorage: vi.fn(async () => null),
  isPosCachedTenantCompatible: (active: string, stored: string | null) =>
    Boolean(active && stored && active === stored),
}));

describe('POS cold entry — workspace mounts while the catalog is in flight', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    });
    useAuthStore.setState({ user: { id: 'user-1', tenantId: 'tenant-a' } as never });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('mounts the products panel with cached rows while the network lookup is pending', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PosWorkspace />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // The other four queries resolve; the products lookup never does.
    await waitFor(() => {
      expect(screen.queryByTestId('catalogs-loading')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByTestId('pos-products-panel')).toBeInTheDocument();
    expect(screen.getByText('Cached Tea')).toBeInTheDocument();
    expect(screen.getByText('Cached Sugar')).toBeInTheDocument();
    expect(screen.getByText('Cached Coffee')).toBeInTheDocument();
  }, 30000);
});
