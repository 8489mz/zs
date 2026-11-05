/* PWA update prompt (INV-PWA-UPDATE-PROMPT): the banner appears only when a
 * waiting worker announces itself, and only the user's click takes over.
 * Drives the real PwaUpdateBanner component: no banner before the event,
 * banner after it, messageSkipWaiting on click, the takeover armed only after
 * the click, dismiss hides it. (The single location.reload itself lives in
 * the banner's pwa-updated listener and is pinned by no-forced-reload.spec.ts;
 * jsdom cannot observe a reload call, so this spec proves the arming.) */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PwaUpdateBanner } from '@/app/pwa-update-banner';

function announceUpdate(messageSkipWaiting: () => void) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('pwa-update-available', {
        detail: { workbox: { messageSkipWaiting } },
      }),
    );
  });
}

describe('PwaUpdateBanner', () => {
  it('shows nothing until a waiting worker announces an update', () => {
    render(<PwaUpdateBanner />);
    expect(screen.queryByText('يتوفر تحديث جديد للتطبيق')).not.toBeInTheDocument();
  });

  it('shows the banner on pwa-update-available and takes over only on click', () => {
    const messageSkipWaiting = vi.fn();
    render(<PwaUpdateBanner />);

    announceUpdate(messageSkipWaiting);
    expect(screen.getByText('يتوفر تحديث جديد للتطبيق')).toBeInTheDocument();

    // Merely showing the banner must not touch the waiting worker.
    expect(messageSkipWaiting).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'تحديث الآن' }));
    expect(messageSkipWaiting).toHaveBeenCalledTimes(1);
  });

  it('arms the takeover only after the user clicks apply', () => {
    const messageSkipWaiting = vi.fn();
    render(<PwaUpdateBanner />);

    announceUpdate(messageSkipWaiting);

    // A takeover signal arriving before any click must not arm anything:
    // the banner stays, the worker is untouched, the button is still idle.
    act(() => {
      window.dispatchEvent(new CustomEvent('pwa-updated'));
    });
    expect(messageSkipWaiting).not.toHaveBeenCalled();
    expect(screen.getByText('يتوفر تحديث جديد للتطبيق')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تحديث الآن' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'تحديث الآن' }));
    expect(messageSkipWaiting).toHaveBeenCalledTimes(1);
    // The click arms the pwa-updated listener and marks the banner applying.
    expect(screen.getByRole('button', { name: 'جارٍ التحديث…' })).toBeDisabled();
  });

  it('dismiss hides the banner until another update is announced', () => {
    const messageSkipWaiting = vi.fn();
    render(<PwaUpdateBanner />);

    announceUpdate(messageSkipWaiting);
    expect(screen.getByText('يتوفر تحديث جديد للتطبيق')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'لاحقًا' }));
    expect(screen.queryByText('يتوفر تحديث جديد للتطبيق')).not.toBeInTheDocument();
    expect(messageSkipWaiting).not.toHaveBeenCalled();

    announceUpdate(messageSkipWaiting);
    expect(screen.getByText('يتوفر تحديث جديد للتطبيق')).toBeInTheDocument();
  });
});
