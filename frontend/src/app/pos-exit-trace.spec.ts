/**
 * Spec for the POS-exit runtime trace logger (INV-POS-EXIT-TRACE).
 *
 * The logger is inert unless localStorage `zs:pos-exit-trace` is `1`. When ON it
 * records queryCache writes, notifyManager flushes, tabs-store writes, sidebar
 * nav clicks, 0-delay timers scheduled just after a nav click, and route changes
 * — each as a performance.mark + console entry + ring-buffer entry — so one
 * recorded POS exit names the timer that scheduled the 5.4 s React render.
 * When OFF it installs nothing: no subscriptions, no wrappers, no marks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { notifyManager } from '@tanstack/query-core';
import {
  POS_EXIT_TRACE_FLAG,
  getPosExitTraceEntries,
  installPosExitTrace,
  isPosExitTraceEnabled,
} from './pos-exit-trace';
import { useTabsStore } from '@/stores/tabs-store';

function flush(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('pos-exit-trace', () => {
  let queryClient: QueryClient;
  let uninstall: (() => void) | undefined;
  let origSetTimeout: typeof window.setTimeout;
  let origPushState: typeof window.history.pushState;
  let origSchedule: typeof notifyManager.schedule;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleTableSpy: ReturnType<typeof vi.spyOn>;
  let markSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });
    origSetTimeout = window.setTimeout;
    origPushState = window.history.pushState;
    origSchedule = notifyManager.schedule;
    window.localStorage.removeItem(POS_EXIT_TRACE_FLAG);
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleTableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});
    markSpy = vi.spyOn(performance, 'mark').mockImplementation(() => undefined as never);
    window.history.pushState({}, '', '/');
  });

  afterEach(async () => {
    uninstall?.();
    uninstall = undefined;
    window.history.pushState({}, '', '/');
    window.localStorage.removeItem(POS_EXIT_TRACE_FLAG);
    consoleInfoSpy.mockRestore();
    consoleTableSpy.mockRestore();
    markSpy.mockRestore();
    queryClient.clear();
  });

  it('OFF: installs nothing — no entries, no marks, no wrappers, no console output', async () => {
    expect(isPosExitTraceEnabled()).toBe(false);
    uninstall = installPosExitTrace({ queryClient });
    queryClient.setQueryData(['settings'], { storeName: 'x' });
    useTabsStore.getState().syncCurrentRoute('/products', 'Products', 'products');
    await flush();
    expect(getPosExitTraceEntries()).toHaveLength(0);
    expect(markSpy).not.toHaveBeenCalled();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(window.setTimeout).toBe(origSetTimeout);
    expect(window.history.pushState).toBe(origPushState);
    expect(notifyManager.schedule).toBe(origSchedule);
  });

  it('ON: records a queryCache write with its key', async () => {
    window.localStorage.setItem(POS_EXIT_TRACE_FLAG, '1');
    expect(isPosExitTraceEnabled()).toBe(true);
    uninstall = installPosExitTrace({ queryClient, dumpDelayMs: 10 });
    queryClient.setQueryData(['settings'], { storeName: 'x' });
    await flush();
    const entries = getPosExitTraceEntries();
    const write = entries.find(
      (e) => e.kind === 'cache-write' && e.detail.includes('settings'),
    );
    expect(write).toBeDefined();
    expect(markSpy).toHaveBeenCalledWith(
      expect.stringContaining('pos-exit:cache-write'),
    );
    expect(consoleInfoSpy).toHaveBeenCalled();
  });

  it('ON: records a tabs-store write with the active path change', async () => {
    window.localStorage.setItem(POS_EXIT_TRACE_FLAG, '1');
    uninstall = installPosExitTrace({ queryClient, dumpDelayMs: 10 });
    const before = useTabsStore.getState();
    const prevTabs = before.tabs;
    const prevActiveId = before.activeTabId;
    useTabsStore.getState().syncCurrentRoute('/pos', 'POS', 'pos');
    await flush();
    const entries = getPosExitTraceEntries();
    expect(
      entries.some((e) => e.kind === 'tabs-write' && e.detail.includes('/pos')),
    ).toBe(true);
    useTabsStore.setState({ tabs: prevTabs, activeTabId: prevActiveId });
  });

  it('ON: records notifyManager schedule + flush', async () => {
    window.localStorage.setItem(POS_EXIT_TRACE_FLAG, '1');
    uninstall = installPosExitTrace({ queryClient, dumpDelayMs: 10 });
    notifyManager.schedule(() => {});
    await flush();
    const entries = getPosExitTraceEntries();
    expect(entries.some((e) => e.kind === 'notify-scheduled')).toBe(true);
    expect(entries.some((e) => e.kind === 'notify-flush')).toBe(true);
  });

  it('ON: records route changes with from -> to', async () => {
    window.localStorage.setItem(POS_EXIT_TRACE_FLAG, '1');
    uninstall = installPosExitTrace({ queryClient, dumpDelayMs: 10 });
    window.history.pushState({}, '', '/pos');
    window.history.pushState({}, '', '/dashboard');
    await flush();
    const entries = getPosExitTraceEntries();
    expect(
      entries.some(
        (e) => e.kind === 'route-change' && e.detail.includes('/pos -> /dashboard'),
      ),
    ).toBe(true);
  });

  it('ON: records a sidebar nav click and a 0-delay timer fired just after it', async () => {
    window.localStorage.setItem(POS_EXIT_TRACE_FLAG, '1');
    uninstall = installPosExitTrace({ queryClient, dumpDelayMs: 10 });
    const link = document.createElement('a');
    link.className = 'sidebar-link';
    link.setAttribute('data-key', 'dashboard');
    link.setAttribute('href', '/dashboard');
    document.body.appendChild(link);
    try {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      window.setTimeout(() => {}, 0);
      await flush();
      const entries = getPosExitTraceEntries();
      expect(
        entries.some((e) => e.kind === 'nav-click' && e.detail.includes('dashboard')),
      ).toBe(true);
      expect(entries.some((e) => e.kind === 'timer-0-fired')).toBe(true);
    } finally {
      link.remove();
    }
  });

  it('ON: dumps the buffer with console.table after leaving /pos', async () => {
    window.localStorage.setItem(POS_EXIT_TRACE_FLAG, '1');
    uninstall = installPosExitTrace({ queryClient, dumpDelayMs: 10 });
    window.history.pushState({}, '', '/pos');
    window.history.pushState({}, '', '/dashboard');
    await flush(80);
    expect(consoleTableSpy).toHaveBeenCalled();
  });

  it('uninstall restores setTimeout, pushState and notifyManager.schedule', () => {
    window.localStorage.setItem(POS_EXIT_TRACE_FLAG, '1');
    const stop = installPosExitTrace({ queryClient });
    expect(window.setTimeout).not.toBe(origSetTimeout);
    expect(notifyManager.schedule).not.toBe(origSchedule);
    stop();
    expect(window.setTimeout).toBe(origSetTimeout);
    expect(window.history.pushState).toBe(origPushState);
    expect(notifyManager.schedule).toBe(origSchedule);
  });
});
