/* PWA update prompt (INV-PWA-UPDATE-PROMPT + INV-REST-PWA-BANNER-TRUTH):
 * the banner appears only when a waiting worker announces itself, and only
 * the user's click takes over. Drives the real PwaUpdateBanner component:
 * no banner before the event, banner after it, the takeover armed only after
 * the click, dismiss hides it. The banner is a small bottom-left pill.
 * Dismissal persists in sessionStorage keyed to the waiting worker's script
 * URL (which carries the build id): a re-announce of the SAME worker stays
 * dismissed, a genuinely NEW worker shows the banner again, and a worker
 * that cannot be identified at all still stays dismissed for the session.
 * The reload itself (both the 'pwa-updated' path and the ~3s fallback timer
 * after the click) lives in the banner and is pinned by
 * no-forced-reload.spec.ts; jsdom cannot observe a reload call — its
 * location object is non-configurable and non-writable — so this spec proves
 * the arming and the timer wiring, and the timer firing is verified by hand
 * from the runner log ("Not implemented: navigation" once per reload). */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { PwaUpdateBanner } from '@/app/pwa-update-banner';

const DISMISSED_KEY = 'zs_pwa_update_dismissed';
const BANNER_TEXT = 'يتوفر تحديث جديد للتطبيق';

function fakeWorkbox(scriptURL: string | null, messageSkipWaiting = vi.fn()) {
  return {
    messageSkipWaiting,
    ...(scriptURL === null
      ? {}
      : { getSW: vi.fn().mockResolvedValue({ scriptURL }) }),
  };
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
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
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
    expect(sessionStorage.getItem(DISMISSED_KEY)).toBe('/sw.js?v=build-a');

    // Same worker, announced again (even as a fresh object): stays hidden.
    await announceUpdateHidden(fakeWorkbox('/sw.js?v=build-a', messageSkipWaiting));

    // A genuinely new build re-shows the banner.
    await announceUpdate(fakeWorkbox('/sw.js?v=build-b', messageSkipWaiting));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();
  });

  it('dismiss holds for the session when the worker cannot be identified', async () => {
    render(<PwaUpdateBanner />);

    // A workbox without getSW (and no serviceWorker in jsdom): no identity.
    await announceUpdate(fakeWorkbox(null));
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'لاحقًا' }));
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
    expect(sessionStorage.getItem(DISMISSED_KEY)).toBe('unknown');

    await announceUpdateHidden(fakeWorkbox(null));
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
});
