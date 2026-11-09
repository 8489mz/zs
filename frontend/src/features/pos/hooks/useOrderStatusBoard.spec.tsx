/*
 * R-B6 (INV-REST-KDS-LOUD-FAILURE): useOrderStatusBoard used to expose no
 * error state at all — it returned only the ticket lists, so on a failed
 * query the board read two empty lists and rendered its calm per-column
 * "no orders" empties. These tests drive the hook itself: on a rejected
 * tickets query it must surface isError and a 'disconnected' screen state
 * (never a board that looks empty-but-fine), and on success it must split
 * the tickets and report 'tickets' / 'standby'.
 */

import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useOrderStatusBoard } from '@/features/pos/hooks/useOrderStatusBoard';
import type { KdsTicket, KdsTicketStatus } from '@/features/pos/api/kds.api';

const { getTicketsMock } = vi.hoisted(() => ({ getTicketsMock: vi.fn() }));

vi.mock('@/features/pos/api/kds.api', () => ({
  kdsApi: { getTickets: getTicketsMock },
}));

function ticket(id: number, status: KdsTicketStatus): KdsTicket {
  return {
    id,
    docNo: `KDS-${id}`,
    orderNumber: `#${id}`,
    orderType: 'dine_in',
    status,
    elapsedMinutes: 0,
    elapsedSeconds: 0,
    createdAt: '',
    updatedAt: '',
    items: [],
    urgencyLevel: 'normal',
  };
}

const emptyStats = { pendingCount: 0, cookingCount: 0, readyCount: 0, criticalCount: 0, avgPrepMinutes: 0 };

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useOrderStatusBoard (R-B6)', () => {
  it('pins the reported case: a rejected tickets query surfaces isError and a disconnected screen state', async () => {
    getTicketsMock.mockRejectedValue(new Error('Network Error'));

    const { result, unmount } = renderHook(() => useOrderStatusBoard(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.tickets).toEqual([]);
    expect(result.current.preparingTickets).toEqual([]);
    expect(result.current.readyTickets).toEqual([]);
    expect(result.current.screenState).toBe('disconnected');
    unmount();
  });

  it('splits preparing and ready tickets on success and reports the tickets state', async () => {
    getTicketsMock.mockResolvedValue({
      tickets: [ticket(1, 'pending'), ticket(2, 'cooking'), ticket(3, 'ready')],
      stats: { ...emptyStats, pendingCount: 1, cookingCount: 1, readyCount: 1 },
    });

    const { result, unmount } = renderHook(() => useOrderStatusBoard(), { wrapper });

    await waitFor(() => expect(result.current.tickets).toHaveLength(3));
    expect(result.current.preparingTickets.map((t) => t.id)).toEqual([1, 2]);
    expect(result.current.readyTickets.map((t) => t.id)).toEqual([3]);
    expect(result.current.isError).toBe(false);
    expect(result.current.screenState).toBe('tickets');
    unmount();
  });

  it('reports standby on a successful empty query — the only state that may look empty', async () => {
    getTicketsMock.mockResolvedValue({ tickets: [], stats: emptyStats });

    const { result, unmount } = renderHook(() => useOrderStatusBoard(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.screenState).toBe('standby');
    unmount();
  });
});
