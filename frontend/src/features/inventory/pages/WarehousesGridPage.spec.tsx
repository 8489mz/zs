/*
 * New file: frontend/src/features/inventory/pages/WarehousesGridPage.spec.tsx
 *
 * WHAT THIS PINS (INV-WAREHOUSES-GRID-SHOW-ITEMS-LINK): the
 * "عرض الأصناف" (show items) link on warehouse cards did nothing when
 * clicked — twice, no expansion, no navigation, no error. The element
 * is a plain <div> with NO click handler, inside a bottom action row
 * whose onClick stops propagation, so the click is swallowed and never
 * reaches the card's own navigate. The link is dead on EVERY card
 * type, not just van cards.
 *
 * WHAT IS DRIVEN (real page, mocked data hooks + router): render
 * WarehousesGridPage with one fixed and one van-stock location,
 * click the "عرض الأصناف" link on each card, and assert navigate is
 * called with the location detail route.
 * (a) van-stock card link navigates to /inventory/warehouses/10;
 * (b) fixed card link navigates to /inventory/warehouses/1.
 *
 * NOT DRIVEN: the warehouse detail page itself (untouched); the
 * edit/delete/count/transfer buttons (untouched).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { WarehousesGridPage } from './WarehousesGridPage';

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

const mockLocations = vi.hoisted(() => [
  { id: 1, name: 'رصيد الفرع الرئيسي', code: 'WH-MAIN', branchName: 'الفرع الرئيسي', branchId: 1, locationType: 'branch_stock' },
  { id: 10, name: 'سيارة مندوب: مندوب اختبار جملة', code: 'VAN_38', branchName: '', branchId: 1, locationType: 'van_stock' },
]);

vi.mock('@/features/inventory/hooks/useInventoryActionCatalog', () => ({
  useInventoryActionCatalog: () => ({
    locationsQuery: { data: mockLocations, refetch: vi.fn() },
    branchesQuery: { data: [] },
  }),
}));

vi.mock('@/features/inventory/api/inventory.api', () => ({
  inventoryApi: {
    advancedOverview: vi.fn(() => Promise.resolve({ totalGlobalValue: 0, locations: [] })),
  },
}));

vi.mock('@/shared/hooks/use-location-mutations', () => ({
  useCreateLocationMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateLocationMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteLocationMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: () => ({ data: undefined }),
}));

vi.mock('@/app/router/route-prefetch', () => ({
  prefetchRouteData: vi.fn(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <WarehousesGridPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('WarehousesGridPage show-items link', () => {
  it('(a) the van-stock card link navigates to the location detail', async () => {
    renderPage();
    fireEvent.click(screen.getByText('سيارات التوزيع والمناديب'));
    expect(await screen.findByText('سيارة مندوب: مندوب اختبار جملة')).toBeTruthy();
    fireEvent.click(screen.getByText('عرض الأصناف'));
    expect(mockNavigate).toHaveBeenCalledWith('/inventory/warehouses/10');
  });

  it('(b) the fixed card link navigates to the location detail', async () => {
    renderPage();
    expect(await screen.findByText('رصيد الفرع الرئيسي')).toBeTruthy();
    fireEvent.click(screen.getByText('عرض الأصناف'));
    expect(mockNavigate).toHaveBeenCalledWith('/inventory/warehouses/1');
  });
});
