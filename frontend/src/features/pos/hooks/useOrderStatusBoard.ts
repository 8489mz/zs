import { useQuery } from '@tanstack/react-query';
import { kdsApi, KdsTicket } from '@/features/pos/api/kds.api';
import { resolveKitchenTicketsState } from '@/features/pos/lib/kds-connection-state';

export function useOrderStatusBoard() {
  const { data, refetch, isFetching, isError, isLoading } = useQuery({
    queryKey: ['order-status-board-tickets'],
    queryFn: () => kdsApi.getTickets(),
    refetchInterval: 4_000,
  });

  const tickets: KdsTicket[] = data?.tickets || [];
  const preparingTickets = tickets.filter((t) => t.status === 'pending' || t.status === 'cooking');
  const readyTickets = tickets.filter((t) => t.status === 'ready');

  return {
    tickets,
    preparingTickets,
    readyTickets,
    isFetching,
    // INV-REST-KDS-LOUD-FAILURE (R-B6): the hook used to expose no error
    // state at all, so the board read two empty lists on a failed query
    // and rendered its calm per-column "no orders" empties. The page must
    // read `screenState` and render the loud disconnected state on
    // 'disconnected' / 'stale' instead of the "no orders" empties.
    isError,
    isLoading,
    screenState: resolveKitchenTicketsState({ isLoading, isError, ticketCount: tickets.length }),
    refetch,
  };
}
