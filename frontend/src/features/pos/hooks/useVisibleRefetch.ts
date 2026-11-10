/* INV-REST-FLOOR-VERIFY-REFETCH (T13-A, H7): live boards have no reliable
 * refresh when returning to a backgrounded tab. Browsers throttle timers
 * in background tabs, so a poll stalls while the tab is hidden — and the
 * safety net is gone too: the global QueryClient sets focus refetch off
 * outright (providers.tsx) while its 5-minute staleTime would neuter any
 * refetch that did run on fresh data. This hook is the shared fix for
 * those boards: on document.visibilitychange -> visible, force a refetch
 * of the given query. refetchQueries fetches even when the data counts
 * as fresh, so it bypasses BOTH the disabled focus flag and staleTime.
 *
 * Scope is deliberate: visibilitychange only. The hook is a no-op while
 * the tab stays visible at mount (it only subscribes; nothing fires),
 * it never listens to window focus, and it only refetches queries that
 * are currently active — an unmounted board fetches nothing. It never
 * touches the global QueryClient defaults.
 */
import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

export function useVisibleRefetch(queryKey: QueryKey): void {
  const queryClient = useQueryClient();
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void queryClient.refetchQueries({ queryKey: keyRef.current, type: 'active' });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [queryClient]);
}
