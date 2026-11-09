/*
 * INV-REST-KDS-LOUD-FAILURE (R-B6): kitchen screens must fail loudly.
 *
 * The KDS tickets query and the order-status-board query both used to read
 * only `data` and treat "no data" as "no orders": on a 401 / network error
 * / server error the tickets list was `[]` and the screens rendered their
 * calm empty states — the KDS showed "all stations ready / no pending
 * orders" and the board showed "no orders preparing / waiting for dishes".
 * The kitchen had no way to know it was blind: new orders never appeared
 * and nobody was told.
 *
 * This module is the single decision for both screens. It resolves the
 * query state into one of five screen states:
 * - 'loading' — first load still in flight, nothing known yet.
 * - 'disconnected' — the query failed and there is nothing to show: the
 *   screen must render the loud disconnected state, never the standby.
 * - 'stale' — the query failed but previous data is still on screen
 *   (TanStack keeps the last success with placeholderData: keepPreviousData):
 *   the tickets stay visible AND a loud banner says they may be out of
 *   date, because a frozen board presented as live is the same silent
 *   failure.
 * - 'standby' — the query succeeded and there really are no tickets.
 * - 'tickets' — live tickets.
 * The error branch wins over loading: a failed attempt is a known fact,
 * never a spinner.
 *
 * Pure module: no React, no DOM, no state — safe to import from Vitest
 * and from the KDS page and the status-board hook alike.
 */

export type KitchenTicketsState = 'loading' | 'disconnected' | 'stale' | 'standby' | 'tickets';

export interface KitchenTicketsQueryState {
  isLoading: boolean;
  isError: boolean;
  ticketCount: number;
}

export function resolveKitchenTicketsState(state: KitchenTicketsQueryState): KitchenTicketsState {
  if (state.isError && state.ticketCount === 0) return 'disconnected';
  if (state.isError) return 'stale';
  if (state.isLoading && state.ticketCount === 0) return 'loading';
  if (state.ticketCount === 0) return 'standby';
  return 'tickets';
}
