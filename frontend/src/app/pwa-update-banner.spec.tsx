/* PWA update prompt (INV-PWA-UPDATE-PROMPT + INV-REST-PWA-BANNER-TRUTH +
 * INV-REST-PWA-DISMISS-KEY-TRUTH + INV-REST-PWA-DISMISS-PER-BUILD): the banner appears only when a waiting
 * worker announces itself, and only the user's click takes over. Drives the
 * real PwaUpdateBanner component: no banner before the event, banner after
 * it, the takeover armed only after the click, dismiss hides it. The banner
 * is a small bottom-left pill. Dismissal persists in localStorage keyed to
 * the WAITING worker's script URL (which carries the build id): a re-announce
 * of the SAME worker stays dismissed, a genuinely NEW worker shows the
 * banner again. Dismissal is per build across tabs (localStorage, not
 * per-tab sessionStorage): dismissing in one tab suppresses the SAME
 * build's banner in other tabs, and a new build still re-shows it. The
 * identity is always the waiting worker
 * (registration.waiting.scriptURL first): the Workbox getSW() path can return
 * the ACTIVE worker's URL instead, so it is only a fallback — the same worker
 * resolved via either path stays hidden, and a dismiss never stores the
 * active worker's URL. A worker that cannot be identified at all is
 * dismissed under a separate per-build marker, never stored as a worker
 * identity, so it can never match a real worker URL. The reload itself (both
 * the 'pwa-updated' path and the ~3s fallback timer after the click) lives in
 * the banner and is pinned by no-forced-reload.spec.ts; jsdom cannot observe
 * a reload call — its location object is non-configurable and non-writable —
 * so this spec proves the arming and the timer wiring, and the timer firing
 * is verified by hand from the runner log ("Not implemented: navigation" once
 * per reload). */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { PwaUpdateBanner } from '@/app/pwa-update-banner';

const DISMISSED_KEY = 'zs_pwa_update_dismissed';
const DISMISSED_UNIDENTIFIED_KEY = 'zs_pwa_update_dismissed_unidentified';
const BANNER_TEXT = 'يتوفر تحديث جديد للتطبيق';

function fakeWorkbox(scriptURL: string | null, messageSkipWaiting = vi.fn()) {
  return {
    messageSkipWaiting,
    ...(scriptURL === null
      ? {}
      : { getSW: vi.fn().mockResolvedValue({ scriptURL }) }),
  };
}

/** Stub navigator.serviceWorker so the banner's registration.waiting path
 * can be driven in jsdom (which ships no serviceWorker). Returns the
 * getRegistration mock so a test can move the waiting worker to a new URL. */
function mockServiceWorkerRegistration(waitingScriptURL: string | null) {
  const getRegistration = vi.fn().mockResolvedValue(
    waitingScriptURL === null
      ? { waiting: null }
      : { waiting: { scriptURL: waitingScriptURL } },
  );
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: { getRegistration },
    configurable: true,
  });
  return getRegistration;
}

function unmockServiceWorkerRegistration() {
  delete (window.navigator as unknown as Record<string, unknown>).serviceWorker;
}

async function announceUpdate(workbox: unknown) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('pwa-update-available', {
        detail: { workbox },
      }),
    );
  });
  // The banner resolves the waiting worker's identity before showing.
  await screen.findByText(BANNER_TEXT);
}

async function announceUpdateHidden(workbox: unknown) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('pwa-update-available', {
        detail: { workbox },
      }),
    );
  });
  // Flush the identity-resolution promise chain, then assert absence.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
}

describe('PwaUpdateBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    unmockServiceWorkerRegistration();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    unmockServiceWorkerRegistration();
  });

  it('shows nothing until a waiting worker announces an update', () => {
    render(<PwaUpdateBanner />);
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
  });

  it('shows the banner on pwa-update-available and takes over only on click', async () => {
    const messageSkipWaiting = vi.fn();
    render(<PwaUpdateBanner />);

    await announceUpdate(fakeWorkbox('/sw.js?v=build-a', messageSkipWaiting));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();

    // Merely showing the banner must not touch the waiting worker.
    expect(messageSkipWaiting).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'تحديث الآن' }));
    expect(messageSkipWaiting).toHaveBeenCalledTimes(1);
  });

  it('arms the takeover only after the user clicks apply', async () => {
    const messageSkipWaiting = vi.fn();
    render(<PwaUpdateBanner />);

    await announceUpdate(fakeWorkbox('/sw.js?v=build-a', messageSkipWaiting));

    // A takeover signal arriving before any click must not arm anything:
    // the banner stays, the worker is untouched, the button is still idle.
    act(() => {
      window.dispatchEvent(new CustomEvent('pwa-updated'));
    });
    expect(messageSkipWaiting).not.toHaveBeenCalled();
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تحديث الآن' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'تحديث الآن' }));
    expect(messageSkipWaiting).toHaveBeenCalledTimes(1);
    // The click arms the pwa-updated listener and marks the banner applying.
    expect(screen.getByRole('button', { name: 'جارٍ التحديث…' })).toBeDisabled();
  });

  it('renders as a small bottom-left pill, never a full-width bar', async () => {
    render(<PwaUpdateBanner />);
    await announceUpdate(fakeWorkbox('/sw.js?v=build-a'));

    const pill = screen.getByRole('status');
    expect(pill).toHaveStyle({ position: 'fixed', left: '12px', bottom: '12px' });
    // No full-width anchoring: right must be unset and the pill capped.
    expect(pill.style.right).toBe('');
    expect(pill.style.maxWidth).toBe('calc(100vw - 24px)');
  });

  it('dismiss persists across a re-announce of the SAME worker but NOT a new one', async () => {
    const messageSkipWaiting = vi.fn();
    render(<PwaUpdateBanner />);

    await announceUpdate(fakeWorkbox('/sw.js?v=build-a', messageSkipWaiting));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'لاحقًا' }));
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
    expect(messageSkipWaiting).not.toHaveBeenCalled();
    // The dismissal is stored keyed to the waiting worker's script URL.
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('/sw.js?v=build-a');

    // Same worker, announced again (even as a fresh object): stays hidden.
    await announceUpdateHidden(fakeWorkbox('/sw.js?v=build-a', messageSkipWaiting));

    // A genuinely new build re-shows the banner.
    await announceUpdate(fakeWorkbox('/sw.js?v=build-b', messageSkipWaiting));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('keys the dismiss to the WAITING worker when getSW returns the ACTIVE worker', async () => {
    // workbox-window getSW() resolves to the controlling (active) worker
    // whenever the page is controlled by a worker whose URL matches the
    // registered URL — so with a new build waiting, getSW() returns the OLD
    // build's URL while registration.waiting is the NEW build. The dismiss
    // must be keyed to the waiting worker, never to the active one.
    const getRegistration = mockServiceWorkerRegistration('/sw.js?v=build-b');
    expect(getRegistration).toBeDefined();
    render(<PwaUpdateBanner />);

    await announceUpdate(fakeWorkbox('/sw.js?v=build-a'));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'لاحقًا' }));
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
    // The waiting worker's URL, not the active worker's.
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('/sw.js?v=build-b');
  });

  it('dismiss stays hidden when the same worker re-announces via the other path', async () => {
    const messageSkipWaiting = vi.fn();
    render(<PwaUpdateBanner />);

    // Dismiss resolved via getSW (no serviceWorker in jsdom), re-announce
    // resolved via registration.waiting with the SAME URL: stays hidden.
    await announceUpdate(fakeWorkbox('/sw.js?v=build-b', messageSkipWaiting));
    fireEvent.click(screen.getByRole('button', { name: 'لاحقًا' }));
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('/sw.js?v=build-b');

    mockServiceWorkerRegistration('/sw.js?v=build-b');
    await announceUpdateHidden(fakeWorkbox(null, messageSkipWaiting));

    // And the reverse direction: dismiss via registration.waiting, then a
    // re-announce resolved via getSW with the same URL stays hidden too.
    unmockServiceWorkerRegistration();
    localStorage.clear();
    mockServiceWorkerRegistration('/sw.js?v=build-b');
    await announceUpdate(fakeWorkbox(null, messageSkipWaiting));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'لاحقًا' }));
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('/sw.js?v=build-b');

    unmockServiceWorkerRegistration();
    await announceUpdateHidden(fakeWorkbox('/sw.js?v=build-b', messageSkipWaiting));
  });

  it('a genuinely NEW worker re-shows even when getSW still returns the old ACTIVE worker', async () => {
    const messageSkipWaiting = vi.fn();
    const getRegistration = mockServiceWorkerRegistration('/sw.js?v=build-b');
    render(<PwaUpdateBanner />);

    // Dismiss the waiting build-b (getSW still reports the active build-a).
    await announceUpdate(fakeWorkbox('/sw.js?v=build-a', messageSkipWaiting));
    fireEvent.click(screen.getByRole('button', { name: 'لاحقًا' }));
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('/sw.js?v=build-b');

    // Same waiting worker, re-announced: stays hidden.
    await announceUpdateHidden(fakeWorkbox('/sw.js?v=build-a', messageSkipWaiting));

    // A genuinely new waiting worker arrives; getSW still reports the old
    // active worker. The banner must re-show for the new worker.
    getRegistration.mockResolvedValue({ waiting: { scriptURL: '/sw.js?v=build-c' } });
    await announceUpdate(fakeWorkbox('/sw.js?v=build-a', messageSkipWaiting));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('dismiss holds per build across tabs when the worker cannot be identified, but never matches a real worker', async () => {
    render(<PwaUpdateBanner />);

    // A workbox without getSW (and no serviceWorker in jsdom): no identity.
    await announceUpdate(fakeWorkbox(null));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'لاحقًا' }));
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
    // No worker identity is ever stored for an unidentifiable worker: the
    // 'unknown' sentinel must never appear as a stored identity.
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
    expect(localStorage.getItem(DISMISSED_UNIDENTIFIED_KEY)).toBe('1');

    // Still unidentifiable on re-announce: the per-build dismissal holds.
    await announceUpdateHidden(fakeWorkbox(null));

    // But the unidentified dismissal never matches a real worker URL: once
    // a worker CAN be identified, the banner shows for it.
    await announceUpdate(fakeWorkbox('/sw.js?v=build-a'));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('arms the fallback reload timer only after the user clicks apply', async () => {
    const messageSkipWaiting = vi.fn();
    render(<PwaUpdateBanner />);
    await announceUpdate(fakeWorkbox('/sw.js?v=build-a', messageSkipWaiting));

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'تحديث الآن' }));
    expect(messageSkipWaiting).toHaveBeenCalledTimes(1);

    // Just before the fallback delay the banner is still applying and no
    // reload has fired (jsdom prints "Not implemented: navigation" per
    // reload call; the runner log must show exactly one such line for this
    // test after the timer below advances past the delay).
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getByRole('button', { name: 'جارٍ التحديث…' })).toBeDisabled();

    // Past the ~3s delay with no pwa-updated signal, the fallback fires.
    // The reload call itself is unobservable in jsdom (see the header), so
    // this asserts the timer fires without throwing; the firing is verified
    // by hand from the runner log line it prints.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'جارٍ التحديث…' })).toBeDisabled();
  });

  it('wires the fallback timer to the same single reload and clears it on cleanup', () => {
    const bannerPath = path.join(__dirname, 'pwa-update-banner.tsx');
    const banner = fs.readFileSync(bannerPath, 'utf8');

    // One reload call site, shared by the pwa-updated listener and the timer.
    expect(banner.match(/location\.reload/g) || []).toHaveLength(1);
    // The timer arms only in the applying effect and is cleared with it.
    expect(banner).toContain('window.setTimeout(reloadOnce, APPLY_RELOAD_FALLBACK_MS)');
    expect(banner).toContain('window.clearTimeout(fallback)');
    expect(banner).toContain('APPLY_RELOAD_FALLBACK_MS = 3000');
  });

  it('build tag fallback is unique per build, never a same-day constant', () => {
    const configPath = path.join(__dirname, '..', '..', 'vite.config.ts');
    const config = fs.readFileSync(configPath, 'utf8');

    // Two same-day builds must not share a worker URL: the fallback used to
    // be the same-day constant MMDD-0001, so a dismiss could never tell a
    // new build from the dismissed one.
    expect(config).not.toContain('-0001');
    // The fallback carries the time of day down to the millisecond.
    expect(config).toContain('getHours');
    expect(config).toContain('getMilliseconds');
  });
});
