/**
 * INV-POS-EXIT-TRACE (2026-11-12): POS-exit runtime trace logger.
 *
 * The 5.4 s freeze on leaving /pos is one synchronous React render rooted at a
 * "Timer fired" task, but no local write could be proven as its trigger: the
 * sidebar close-search setTimeout(0) (app-shell.tsx:2144) is gated on the search
 * being open, and the tabs syncCurrentRoute write (app-shell.tsx:2141) cannot
 * reach the POS tree — zero POS subscribers to the tabs store, and the Outlet
 * element ProtectedLayout passes as AppShell children is referentially stable,
 * so React bails out on the POS subtree on AppShell re-renders. The five
 * network fetches in the exit window were likewise excluded. So instead of a
 * guessed fix, this module records the exit so ONE captured run names the timer.
 *
 * What it records, around one exit (each as a performance.mark — visible in the
 * Performance Timings track — plus a console entry plus a ring-buffer entry):
 *   - every queryCache write (subscribe event type + query key + time)
 *   - every notifyManager schedule + flush (wrapped schedule; flush duration)
 *   - every tabs-store write (subscribe; shallow diff of tabs / activeTabId)
 *   - every sidebar nav click (capture-phase listener on .sidebar-link)
 *   - every 0-delay timer scheduled within 1 s after a nav click, with a stack
 *     snippet naming its scheduler (this is how the close-search timer, the
 *     notifyManager timer, or any other setTimeout(0) is identified)
 *   - every route change (history.pushState/replaceState wrap + popstate)
 * The buffer (max 200 entries) is dumped with console.table 2 s after the
 * route leaves /pos, and 10 s after the first nav click if no route change
 * was seen.
 *
 * Gating: inert by default. Enabled ONLY when localStorage `zs:pos-exit-trace`
 * is `1`, read once at install; one console line confirms it is on. When off,
 * installPosExitTrace returns immediately: zero subscriptions, zero wrappers,
 * zero marks, zero console output, zero behaviour change. No money logic is
 * touched and nothing in POS or in the click handlers is changed.
 *
 * Hookup: one call in AppProviders — `usePosExitTrace(queryClient)`.
 * Prospective only (diagnostic, no production behaviour change).
 * Pinned by pos-exit-trace.spec.ts.
 */
import { useEffect } from 'react';
import { notifyManager } from '@tanstack/query-core';
import type { QueryClient } from '@tanstack/react-query';
import { useTabsStore } from '@/stores/tabs-store';

export const POS_EXIT_TRACE_FLAG = 'zs:pos-exit-trace';

const RING_CAP = 200;
const TIMER_WINDOW_MS = 1000;
const DEFAULT_DUMP_DELAY_MS = 2000;
const FALLBACK_DUMP_MS = 10_000;

export interface PosExitTraceEntry {
  /** performance.now() at record time, ms since page load. */
  t: number;
  kind: string;
  detail: string;
}

const ring: PosExitTraceEntry[] = [];

export function getPosExitTraceEntries(): PosExitTraceEntry[] {
  return [...ring];
}

export function isPosExitTraceEnabled(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.localStorage.getItem(POS_EXIT_TRACE_FLAG) === '1'
    );
  } catch {
    return false;
  }
}

function safeNow(): number {
  try {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  } catch {
    return Date.now();
  }
}

function safeMark(name: string): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(name);
    }
  } catch {
    // Marking must never break the app.
  }
}

function record(kind: string, detail: string): void {
  const entry: PosExitTraceEntry = { t: safeNow(), kind, detail };
  ring.push(entry);
  if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
  safeMark(`pos-exit:${kind}`);
  try {
    // eslint-disable-next-line no-console
    console.info(`[pos-exit-trace] ${entry.t.toFixed(1)}ms ${kind} ${detail}`);
  } catch {
    // Logging must never break the app.
  }
}

export interface InstallPosExitTraceOptions {
  queryClient: QueryClient;
  /** Delay before the buffer dump after leaving /pos. Default 2000 ms. */
  dumpDelayMs?: number;
}

/**
 * Installs the trace when the flag is on; returns an uninstall function that
 * restores every wrapped global. When the flag is off this is a no-op that
 * installs nothing and returns a no-op uninstall.
 */
export function installPosExitTrace(options: InstallPosExitTraceOptions): () => void {
  const noop = (): void => {};
  if (typeof window === 'undefined' || !isPosExitTraceEnabled()) return noop;

  const { queryClient } = options;
  const dumpDelayMs = options.dumpDelayMs ?? DEFAULT_DUMP_DELAY_MS;
  ring.length = 0;

  // eslint-disable-next-line no-console
  console.info(
    '[pos-exit-trace] enabled — recording queryCache writes, notifyManager flushes, ' +
      'tabs-store writes, nav clicks, 0-delay timers and route changes. ' +
      'Exit POS once, then read the console.table dump.',
  );

  let dumped = false;
  let dumpTimer: ReturnType<typeof setTimeout> | undefined;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  let lastNavClickAt = -1;
  let lastPath = window.location.pathname + window.location.search;

  // Originals, saved before wrapping so uninstall restores exactly them.
  const origSetTimeout = window.setTimeout;
  // Loose alias for CALLING the original: this project's type environment
  // resolves window.setTimeout to the Node flavour (Timeout return, generic
  // tuple params), so a plain `.call`/`.apply` with a spread fails the
  // checker. The alias keeps the DOM calling shape; the original above stays
  // untouched so uninstall restores the exact function object.
  const callOrigTimeout = origSetTimeout as unknown as (
    handler: TimerHandler,
    timeout?: number,
    ...args: any[]
  ) => ReturnType<typeof window.setTimeout>;
  const origPushState = window.history.pushState;
  const origReplaceState = window.history.replaceState;
  const origNotifySchedule = notifyManager.schedule;
  // query-core declares `schedule` readonly, so the wrap/restore go through a
  // mutable view. Runtime behaviour is unchanged: the same function object is
  // wrapped and restored.
  const notifyManagerMutable = notifyManager as unknown as {
    schedule: (callback: () => void) => void;
  };

  const dump = (): void => {
    if (dumped) return;
    dumped = true;
    try {
      // eslint-disable-next-line no-console
      console.table([...ring]);
      // eslint-disable-next-line no-console
      console.info(
        `[pos-exit-trace] dumped ${ring.length} entries — copy the table and the ` +
          `marks above; the entry just before the giant React render names the trigger.`,
      );
    } catch {
      // Dumping must never break the app.
    }
  };

  const scheduleDump = (): void => {
    if (dumped || dumpTimer !== undefined) return;
    dumpTimer = callOrigTimeout.call(window, dump, dumpDelayMs);
  };

  // 1. Every queryCache write: event type + query key + time.
  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' && event.type !== 'added' && event.type !== 'removed') {
      return;
    }
    record('cache-write', `${event.type} ${JSON.stringify(event.query.queryKey)}`);
  });

  // 2. Every notifyManager schedule + flush (the "Timer fired" signature).
  notifyManagerMutable.schedule = (callback: () => void): void => {
    record('notify-scheduled', '');
    origNotifySchedule.call(notifyManager, () => {
      const start = safeNow();
      record('notify-flush-start', '');
      try {
        callback();
      } finally {
        record('notify-flush', `${(safeNow() - start).toFixed(1)}ms`);
      }
    });
  };

  // 3. Every tabs-store write: what changed + time.
  const unsubscribeTabs = useTabsStore.subscribe((state, prevState) => {
    const changed: string[] = [];
    if (state.activeTabId !== prevState.activeTabId) {
      changed.push(`activeTabId ${prevState.activeTabId} -> ${state.activeTabId}`);
    }
    if (state.tabs !== prevState.tabs) {
      const prevActive = prevState.tabs.find((t) => t.id === prevState.activeTabId);
      const nextActive = state.tabs.find((t) => t.id === state.activeTabId);
      changed.push(
        `tabs[${state.tabs.length}] active ${prevActive?.path ?? '?'} -> ${nextActive?.path ?? '?'}`,
      );
    }
    if (changed.length > 0) record('tabs-write', changed.join('; '));
  });

  // 4 + 5. Sidebar nav clicks, and 0-delay timers scheduled just after one.
  // The close-search timer (app-shell NavLink onClick, setTimeout(..., 0)) cannot
  // be observed without touching the click handler, so the 1 s post-click window
  // is watched instead: any setTimeout(0) there is logged with a stack snippet
  // naming its scheduler (app-shell onClick, query-core notifyManager, or other).
  const onDocumentClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest?.('.sidebar-link') as HTMLElement | null;
    if (!link) return;
    lastNavClickAt = safeNow();
    record(
      'nav-click',
      `${link.getAttribute('data-key') || ''} -> ${link.getAttribute('href') || ''}`,
    );
    if (fallbackTimer === undefined) {
      fallbackTimer = callOrigTimeout.call(window, dump, FALLBACK_DUMP_MS);
    }
  };
  document.addEventListener('click', onDocumentClick, true);

  // The DOM setTimeout signature takes `...arguments: any[]`; matching it here
  // keeps the spread into the original legal, and the double cast is what TS
  // itself suggests for the NodeJS.Timeout vs number overlap (this project's
  // type environment resolves the call to the Node flavour).
  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    const delay = timeout ?? 0;
    if (
      typeof handler === 'function' &&
      delay === 0 &&
      lastNavClickAt >= 0 &&
      safeNow() - lastNavClickAt <= TIMER_WINDOW_MS
    ) {
      const stack = new Error().stack
        ?.split('\n')
        .slice(2, 5)
        .map((line) => line.trim())
        .join(' | ');
      const wrapped = (): void => {
        const start = safeNow();
        record('timer-0-fired', stack ?? '');
        try {
          (handler as (...a: unknown[]) => void)(...args);
        } finally {
          record('timer-0-done', `${(safeNow() - start).toFixed(1)}ms`);
        }
      };
      return callOrigTimeout.apply(window, [wrapped, 0, ...args]);
    }
    return callOrigTimeout.apply(window, [handler, delay, ...args]);
  }) as unknown as typeof window.setTimeout;

  // 6. Route changes.
  const recordRouteChange = (to: string): void => {
    const from = lastPath;
    lastPath = to;
    record('route-change', `${from} -> ${to}`);
    if (from.startsWith('/pos') && !to.startsWith('/pos')) scheduleDump();
  };
  window.history.pushState = function (...args: Parameters<typeof window.history.pushState>) {
    const result = origPushState.apply(window.history, args);
    recordRouteChange(window.location.pathname + window.location.search);
    return result;
  };
  window.history.replaceState = function (
    ...args: Parameters<typeof window.history.replaceState>
  ) {
    const result = origReplaceState.apply(window.history, args);
    recordRouteChange(window.location.pathname + window.location.search);
    return result;
  };
  const onPopState = (): void => {
    recordRouteChange(window.location.pathname + window.location.search);
  };
  window.addEventListener('popstate', onPopState);

  return () => {
    unsubscribeCache();
    unsubscribeTabs();
    document.removeEventListener('click', onDocumentClick, true);
    window.removeEventListener('popstate', onPopState);
    window.setTimeout = origSetTimeout;
    window.history.pushState = origPushState;
    window.history.replaceState = origReplaceState;
    notifyManagerMutable.schedule = origNotifySchedule;
    if (dumpTimer !== undefined) clearTimeout(dumpTimer);
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
  };
}

/** React hookup for AppProviders: installs the trace once at app bootstrap. */
export function usePosExitTrace(queryClient: QueryClient): void {
  useEffect(() => installPosExitTrace({ queryClient }), [queryClient]);
}
