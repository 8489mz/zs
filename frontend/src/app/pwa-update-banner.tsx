/* PWA update prompt (INV-PWA-UPDATE-PROMPT + INV-REST-PWA-BANNER-TRUTH): a
 * deployed build is OFFERED, never forced. main.tsx dispatches
 * 'pwa-update-available' when a new service worker is waiting; this banner
 * is the only place that can take it over — and only after the user presses
 * "تحديث الآن", which asks the waiting worker to take over and reloads once
 * the new worker takes control ('pwa-updated'). If that signal never arrives
 * (the prompt registration never claims the current page), a short fallback
 * timer reloads anyway: the activated worker controls the fresh navigation.
 * Dismissing hides the banner for this session, keyed to the waiting
 * worker's script URL (which carries the build id), so a re-announce of the
 * SAME worker stays dismissed while a genuinely new build shows it again.
 * When the worker cannot be identified at all, the dismissal still holds
 * for the session under a single fallback key. The banner is a small pill
 * pinned to the bottom-left corner, never a full-width bar. Nothing here
 * reloads on deploy, focus, or visibility — the reload below runs only
 * after the user's click. */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Workbox } from 'workbox-window';

/** Session key for the dismissed update. The stored value is the waiting
 * worker's script URL, so a new build re-shows the banner. */
const DISMISSED_KEY = 'zs_pwa_update_dismissed';
/** Stored when the waiting worker cannot be identified: the dismissal then
 * holds for the session, since no worker can be told apart from another. */
const UNKNOWN_WORKER = 'unknown';
/** How long to wait for the new worker to take control after the user's
 * click before reloading anyway. */
const APPLY_RELOAD_FALLBACK_MS = 3000;

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(workerId: string): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, workerId);
  } catch {
    // Storage unavailable: the banner still hides for this mount.
  }
}

/** Identify the waiting worker by its script URL, which carries the build
 * id (`/sw.js?v=<build id>`). The Workbox instance knows its waiting worker
 * (getSW); the registration lookup is the fallback. Returns null only when
 * the worker cannot be identified at all. */
async function resolveWaitingWorkerId(wb: Workbox): Promise<string | null> {
  try {
    if (typeof wb.getSW === 'function') {
      const sw = await wb.getSW();
      if (sw?.scriptURL) return sw.scriptURL;
    }
  } catch {
    // Fall through to the registration lookup.
  }
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.waiting?.scriptURL ?? null;
    }
  } catch {
    // Unidentifiable worker.
  }
  return null;
}

export function PwaUpdateBanner() {
  const { t } = useTranslation();
  const [workbox, setWorkbox] = useState<Workbox | null>(null);
  const [waitingId, setWaitingId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const onAvailable = (event: Event) => {
      const wb = (event as CustomEvent<{ workbox?: Workbox }>).detail?.workbox;
      if (!wb) return;
      void resolveWaitingWorkerId(wb).then((id) => {
        const workerId = id ?? UNKNOWN_WORKER;
        if (readDismissed() === workerId) return;
        setWaitingId(workerId);
        setWorkbox(wb);
        setApplying(false);
      });
    };
    window.addEventListener('pwa-update-available', onAvailable);
    return () => window.removeEventListener('pwa-update-available', onAvailable);
  }, []);

  useEffect(() => {
    if (!applying) return;
    let reloaded = false;
    const reloadOnce = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    const onUpdated = () => {
      reloadOnce();
    };
    window.addEventListener('pwa-updated', onUpdated);
    const fallback = window.setTimeout(reloadOnce, APPLY_RELOAD_FALLBACK_MS);
    return () => {
      window.removeEventListener('pwa-updated', onUpdated);
      window.clearTimeout(fallback);
    };
  }, [applying]);

  if (!workbox) return null;

  const handleApplyUpdate = () => {
    setApplying(true);
    void workbox.messageSkipWaiting();
  };

  const handleDismiss = () => {
    writeDismissed(waitingId ?? UNKNOWN_WORKER);
    setWaitingId(null);
    setWorkbox(null);
  };

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 12,
        bottom: 12,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        maxWidth: 'calc(100vw - 24px)',
        padding: '8px 10px',
        backgroundColor: '#170e5e',
        color: '#ffffff',
        fontSize: 12,
        borderRadius: 10,
        boxShadow: '0 6px 20px rgba(15, 23, 42, 0.35)',
        boxSizing: 'border-box',
      }}
    >
      <span>{t('pwaUpdate.available', 'يتوفر تحديث جديد للتطبيق')}</span>
      <button
        type="button"
        onClick={handleApplyUpdate}
        disabled={applying}
        style={{
          border: 'none',
          borderRadius: 6,
          padding: '5px 10px',
          backgroundColor: '#ffffff',
          color: '#170e5e',
          fontSize: 12,
          fontWeight: 700,
          cursor: applying ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {t('pwaUpdate.applyNow', applying ? 'جارٍ التحديث…' : 'تحديث الآن')}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={applying}
        style={{
          border: '1px solid rgba(255,255,255,0.6)',
          borderRadius: 6,
          padding: '5px 10px',
          backgroundColor: 'transparent',
          color: '#ffffff',
          fontSize: 12,
          cursor: applying ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {t('pwaUpdate.later', 'لاحقًا')}
      </button>
    </div>
  );
}
