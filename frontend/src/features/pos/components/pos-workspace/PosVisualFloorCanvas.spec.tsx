/*
 * R5-D (INV-REST-FLOOR-STATE-TRUTH): the canvas renders the draft's real
 * money and item count.
 *
 * At base the canvas read draft.cartTotal / draft.totals.total / draft.cart
 * / draft.itemCount — fields HeldPosDraftSummary does not have (it carries
 * total / itemsCount) — so every occupied tile showed 0 and 1 item while
 * the grid next to it showed the real numbers. After the fix the canvas
 * renders from the same buildFloorState record as the grid: total 250.00
 * and 3 items for the draft below.
 *
 * RED PROOF: on the unfixed tree the tile shows "0.00" and "1 صنف".
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/test/test-query-client';
import { PosVisualFloorCanvas } from './PosVisualFloorCanvas';
import { buildFloorState } from '@/features/pos/lib/pos-floor-state';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('@/features/pos/api/restaurant-advanced-fnb.api', () => ({
  restaurantAdvancedFnbApi: {
    getTableLayouts: vi.fn(async () => []),
    saveTableLayouts: vi.fn(async () => []),
    deleteTableLayout: vi.fn(async () => ({ success: true })),
  },
}));

describe('PosVisualFloorCanvas — occupied tile money (R5-D)', () => {
  it('renders draft.total / draft.itemsCount, not 0 / 1 item', async () => {
    const floorState = buildFloorState({
      drafts: [{ id: 'd1', label: 'طاولة 5', total: 250, itemsCount: 3, tableNumber: '5' }],
      tablesCount: 12,
    });
    const queryClient = createTestQueryClient();
    // The canvas waits for the layouts query to resolve (its effect
    // must not run on the `= []` default — a fresh array per render
    // re-ran the effect forever). Seed the cache so the tile renders
    // deterministically.
    queryClient.setQueryData(['restaurant-table-layouts', undefined], [
      { table_number: '5', zone_code: 'main', shape: 'square', x_pos: 10, y_pos: 10, width: 78, height: 78, seats: 4, rotation: 0 },
    ]);
    render(
      <QueryClientProvider client={queryClient}>
        <PosVisualFloorCanvas
          tablesCount={12}
          zones={[]}
          selectedZone="all"
          occupiedMap={new Map([['5', [{ id: 'd1', label: 'طاولة 5', total: 250, itemsCount: 3, tableNumber: '5' }]]])}
          floorState={floorState.byTable}
          currentTableNumber=""
          confirmedReservationsMap={new Map()}
          pendingCallsByTable={new Map()}
          kdsTableMap={new Map()}
          isManager
          onSelectTable={() => {}}
          onRecallDraft={() => {}}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('T-5')).toBeInTheDocument());
    expect(screen.getByText('250.00')).toBeInTheDocument();
    expect(screen.getByText(/3 صنف/)).toBeInTheDocument();
    expect(screen.queryByText('0.00')).toBeNull();
  });
});
