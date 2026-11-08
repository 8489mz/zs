/* maintenance.api counts wiring (package 6 client side): the counts endpoint
 * contract and the KPI groupings the tickets page recomputes from it. The
 * endpoint itself is package 5's work and does not exist on this base — its
 * live proof waits for package 5 to merge. */
import { describe, expect, it, vi } from 'vitest';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

import {
  maintenanceApi,
  summarizeTicketCounts,
  type MaintenanceTicketCounts,
} from '@/features/maintenance/api/maintenance.api';

describe('maintenanceApi.getCounts', () => {
  it('calls the aggregate counts endpoint', async () => {
    httpMock.mockResolvedValueOnce({
      counts: {
        received: 2, inspecting: 1, in_progress: 3, waiting_parts: 1,
        repaired: 4, delivered: 5, unrepairable: 1, cancelled: 2, total: 19,
      },
      totalRemaining: 1250,
    });
    const res = await maintenanceApi.getCounts();
    expect(httpMock).toHaveBeenCalledWith('/api/maintenance/tickets/counts');
    expect(res.totalRemaining).toBe(1250);
    expect(res.counts.total).toBe(19);
  });

  it('passes the payment method through updateStatus', async () => {
    httpMock.mockResolvedValueOnce({ ok: true });
    await maintenanceApi.updateStatus('t1', {
      status: 'delivered',
      finalCost: 900,
      collectedAmount: 600,
      paymentMethod: 'card',
    });
    expect(httpMock).toHaveBeenCalledTimes(1);
    const [url, init] = httpMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('/api/maintenance/tickets/t1/status');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'delivered',
      finalCost: 900,
      collectedAmount: 600,
      paymentMethod: 'card',
    });
  });
});

describe('summarizeTicketCounts', () => {
  it('recomputes the page groupings exactly as the list-based KPIs did', () => {
    const counts: MaintenanceTicketCounts = {
      received: 2, inspecting: 1, in_progress: 3, waiting_parts: 1,
      repaired: 4, delivered: 5, unrepairable: 1, cancelled: 2, total: 19,
    };
    expect(summarizeTicketCounts(counts, 1250)).toEqual({
      inProgressCount: 6, // received + in_progress + waiting_parts
      readyCount: 4, // repaired
      deliveredCount: 5, // delivered
      receivedCount: 2, // received
      totalCount: 19,
      totalRemainingSum: 1250,
    });
  });

  it('returns zeros when every count is zero', () => {
    const counts: MaintenanceTicketCounts = {
      received: 0, inspecting: 0, in_progress: 0, waiting_parts: 0,
      repaired: 0, delivered: 0, unrepairable: 0, cancelled: 0, total: 0,
    };
    expect(summarizeTicketCounts(counts, 0)).toEqual({
      inProgressCount: 0,
      readyCount: 0,
      deliveredCount: 0,
      receivedCount: 0,
      totalCount: 0,
      totalRemainingSum: 0,
    });
  });
});
