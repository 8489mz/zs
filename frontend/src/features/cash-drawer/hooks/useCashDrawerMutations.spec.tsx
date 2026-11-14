/* Stale cash-drawer page after close (SPICE pkg #1): after a successful
 * close the shifts list must refetch immediately, with no manual refresh
 * — the closed shift must stop showing as open and the open-shift count
 * must drop to 0. Before this fix invalidateTreasuryDomain invalidated
 * the cashier-shifts keys with refetchType 'none' (marks stale, refetches
 * nothing), and the close mutation's only active invalidation targeted
 * the POS 'open:pos' key, which the cash-drawer page never reads; with
 * the global staleTime of 5 minutes and refetchOnWindowFocus off, the
 * mounted page query never refetched on its own, so the shift stayed
 * OPEN on screen until a manual refresh (remount). This spec drives the
 * REAL close mutation + the REAL useCashierShifts page query against a
 * mocked api boundary and asserts the list refetches and shows the
 * closed state right after the close succeeds.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useCashDrawerMutations } from './useCashDrawerMutations';
import { useCashierShifts } from './useCashierShifts';
import { createTestQueryClient } from '@/test/test-query-client';

const mocks = vi.hoisted(() => {
  let closed = false;
  const openShift = {
    id: '1', docNo: 'SHIFT-261113-0027', status: 'open', openedByName: 'cashier_test',
    openingCash: 100, expectedCash: 4283.9, countedCash: null,
  };
  return {
    isClosed: () => closed,
    close: vi.fn(async () => {
      closed = true;
      return { ok: true, cashierShifts: [] };
    }),
    listPage: vi.fn(async () => {
      if (closed) {
        return {
          rows: [{ ...openShift, status: 'pending_review', countedCash: 4283.9 }],
          pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          summary: { totalItems: 1, openShiftCount: 0, pendingReviewCount: 1, openShiftDocNo: '', totalVariance: 0 },
        };
      }
      return {
        rows: [openShift],
        pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        summary: { totalItems: 1, openShiftCount: 1, pendingReviewCount: 0, openShiftDocNo: 'SHIFT-261113-0027', totalVariance: 0 },
      };
    }),
  };
});

vi.mock('@/features/cash-drawer/api/cash-drawer.api', () => ({
  cashDrawerApi: {
    listPage: mocks.listPage,
    close: mocks.close,
    open: vi.fn(async () => ({ ok: true, cashierShifts: [] })),
    movement: vi.fn(async () => ({ ok: true, cashierShifts: [] })),
    reviewClose: vi.fn(async () => ({ ok: true, cashierShifts: [] })),
  },
}));

vi.mock('@/features/pos', () => ({
  getPosTerminalCode: () => 'POS-1',
}));

function renderPageAndMutations() {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => ({
      shifts: useCashierShifts({ page: 1, pageSize: 20, filter: 'all' }),
      mutations: useCashDrawerMutations(),
    }),
    { wrapper },
  );
}

describe('cash-drawer page refresh after close', () => {
  it('refetches the shifts list right after a successful close so the shift stops showing as open', async () => {
    const { result } = renderPageAndMutations();

    await waitFor(() => expect(result.current.shifts.data?.rows).toHaveLength(1), { timeout: 5000 });
    expect(result.current.shifts.data?.rows[0].status).toBe('open');
    expect(result.current.shifts.data?.summary.openShiftCount).toBe(1);
    expect(mocks.listPage).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.mutations.closeMutation.mutateAsync({
        shiftId: '1',
        countedCash: 4283.9,
        cardDeclaredTotal: 0,
        cardOperationCount: 0,
        walletDeclaredTotal: 0,
        walletOperationCount: 0,
        instapayDeclaredTotal: 0,
        instapayOperationCount: 0,
        cardDetails: [],
        walletDetails: [],
        instapayDetails: [],
        note: 'إغلاق وردية تجريبية',
        managerPin: '1234',
      });
    });

    // No manual refresh, no remount: the page query itself must refetch.
    await waitFor(() => expect(mocks.listPage).toHaveBeenCalledTimes(2), { timeout: 5000 });
    await waitFor(
      () => expect(result.current.shifts.data?.rows[0].status).toBe('pending_review'),
      { timeout: 5000 },
    );
    expect(result.current.shifts.data?.summary.openShiftCount).toBe(0);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  }, 20000);
});
