/* INV-REST-FLOOR-VERIFY-REFETCH (T13-A, H7): live boards have no reliable
 * refresh when returning to a backgrounded tab — the 5s KDS poll is
 * throttled in background tabs and the global QueryClient disables focus
 * refetch outright while the 5-minute global staleTime neuters any
 * refetch that does run. This hook is the shared fix: refetch on
 * document.visibilitychange -> visible, forcing the fetch past
 * staleTime. It is a no-op while the tab stays visible and never
 * listens to window focus.
 *
 * The client below mirrors the production defaults (5-min staleTime,
 * focus refetch off) so the "bypasses staleTime" pin is real: with
 * fresh data and no focus refetch, only the visibility event may
 * trigger a fetch.
 */
import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisibleRefetch } from '@/features/pos/hooks/useVisibleRefetch';

const queryFnMock = vi.fn(async () => 'fresh-data');

function createProductionLikeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 5 * 60_000, refetchOnWindowFocus: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/* jsdom reports its own visibilityState; the tests drive it explicitly
 * so the hidden -> visible transition is deterministic. */
function setVisibilityState(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

function useProbe(queryKey: QueryKey) {
  const query = useQuery({ queryKey, queryFn: queryFnMock });
  useVisibleRefetch(queryKey);
  return query;
}

describe('useVisibleRefetch (INV-REST-FLOOR-VERIFY-REFETCH)', () => {
  beforeEach(() => {
    queryFnMock.mockClear();
    setVisibilityState('visible');
  });

  afterEach(() => {
    setVisibilityState('visible');
  });

  it('does not refetch while the tab stays visible', async () => {
    const queryClient = createProductionLikeClient();
    renderHook(() => useProbe(['probe']), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(queryFnMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(queryFnMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when the tab returns to visible even though the data is fresh', async () => {
    const queryClient = createProductionLikeClient();
    renderHook(() => useProbe(['probe']), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(queryFnMock).toHaveBeenCalledTimes(1));

    // Backgrounding alone fetches nothing.
    setVisibilityState('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(queryFnMock).toHaveBeenCalledTimes(1);

    // Returning refetches despite the 5-minute staleTime: the forced
    // refetch bypasses both the global false flag and staleness.
    setVisibilityState('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(queryFnMock).toHaveBeenCalledTimes(2));
  });

  it('does not refetch on window focus alone', async () => {
    const queryClient = createProductionLikeClient();
    renderHook(() => useProbe(['probe']), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(queryFnMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(queryFnMock).toHaveBeenCalledTimes(1);
  });

  it('stops listening after unmount', async () => {
    const queryClient = createProductionLikeClient();
    const { unmount } = renderHook(() => useProbe(['probe']), { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(queryFnMock).toHaveBeenCalledTimes(1));
    unmount();
    setVisibilityState('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    setVisibilityState('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(queryFnMock).toHaveBeenCalledTimes(1);
  });
});
