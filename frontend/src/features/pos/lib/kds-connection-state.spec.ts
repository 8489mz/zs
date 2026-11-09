/*
 * R-B6 (INV-REST-KDS-LOUD-FAILURE): the KDS tickets query and the
 * order-status-board query used to read only `data` and treat "no data" as
 * "no orders" — on a 401 / network error / server error the tickets list
 * was `[]` and the screens rendered their calm empty states ("all stations
 * ready / no pending orders", "no orders preparing"). The kitchen had no
 * way to know it was blind.
 *
 * These tests drive the pure resolver that replaces that logic: a failed
 * query with nothing to show is 'disconnected' (never 'standby'), a failed
 * query with previous data still on screen is 'stale' (tickets stay AND a
 * loud banner says they may be out of date), and only a successful empty
 * query is 'standby'.
 */

import { describe, expect, it } from 'vitest';
import { resolveKitchenTicketsState } from '@/features/pos/lib/kds-connection-state';

describe('resolveKitchenTicketsState (R-B6)', () => {
  it('pins the reported case: query error with no tickets is disconnected, never standby', () => {
    expect(resolveKitchenTicketsState({ isLoading: false, isError: true, ticketCount: 0 })).toBe('disconnected');
  });

  it('query error with previous tickets on screen is stale, not tickets-as-live', () => {
    // TanStack keeps the last success (placeholderData: keepPreviousData),
    // so a mid-service network drop leaves a frozen board. It must be
    // labelled stale, never presented as live.
    expect(resolveKitchenTicketsState({ isLoading: false, isError: true, ticketCount: 3 })).toBe('stale');
  });

  it('first load in flight with no tickets is loading', () => {
    expect(resolveKitchenTicketsState({ isLoading: true, isError: false, ticketCount: 0 })).toBe('loading');
  });

  it('loading with previous tickets on screen keeps showing the tickets, not a spinner', () => {
    expect(resolveKitchenTicketsState({ isLoading: true, isError: false, ticketCount: 2 })).toBe('tickets');
  });

  it('successful empty query is standby — the only state that may say "no orders"', () => {
    expect(resolveKitchenTicketsState({ isLoading: false, isError: false, ticketCount: 0 })).toBe('standby');
  });

  it('successful query with tickets is tickets', () => {
    expect(resolveKitchenTicketsState({ isLoading: false, isError: false, ticketCount: 2 })).toBe('tickets');
  });

  it('a failed attempt beats loading: error is a known fact, never a spinner', () => {
    expect(resolveKitchenTicketsState({ isLoading: true, isError: true, ticketCount: 0 })).toBe('disconnected');
    expect(resolveKitchenTicketsState({ isLoading: true, isError: true, ticketCount: 1 })).toBe('stale');
  });
});
