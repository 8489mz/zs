/* PWA update prompt (INV-PWA-UPDATE-PROMPT): a deployed build is OFFERED,
 * never forced. main.tsx dispatches 'pwa-update-available' when a new service
 * worker is waiting; this banner is the only place that can take it over —
 * and only after the user presses "تحديث الآن", which asks the waiting worker
 * to take over and reloads once the new worker takes control ('pwa-updated').
 * Dismissing hides the banner for this session; a later waiting worker shows
 * it again. Nothing here reloads on deploy, focus, or visibility — the reload
 * below runs only after the user's click. */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Workbox } from 'workbox-window';

export function PwaUpdateBanner() {
  const { t } = useTranslation();
  const [workbox, setWorkbox] = useState<Workbox | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const onAvailable = (event: Event) => {
      const wb = (event as CustomEvent<{ workbox?: Workbox }>).detail?.workbox;
      if (wb) {
        setWorkbox(wb);
        setApplying(false);
      }
    };
    window.addEventListener('pwa-update-available', onAvailable);
    return () => window.removeEventListener('pwa-update-available', onAvailable);
  }, []);

  useEffect(() => {
    if (!applying) return;
    const onUpdated = () => {
      window.location.reload();
    };
    window.addEventListener('pwa-updated', onUpdated);
    return () => window.removeEventListener('pwa-updated', onUpdated);
  }, [applying]);

  if (!workbox) return null;

  const handleApplyUpdate = () => {
    setApplying(true);
    void workbox.messageSkipWaiting();
  };

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px 16px',
        backgroundColor: '#170e5e',
        color: '#ffffff',
        fontSize: 13,
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
          padding: '6px 14px',
          backgroundColor: '#ffffff',
          color: '#170e5e',
          fontSize: 13,
          fontWeight: 700,
          cursor: applying ? 'default' : 'pointer',
        }}
      >
        {t('pwaUpdate.applyNow', applying ? 'جارٍ التحديث…' : 'تحديث الآن')}
      </button>
      <button
        type="button"
        onClick={() => setWorkbox(null)}
        disabled={applying}
        style={{
          border: '1px solid rgba(255,255,255,0.6)',
          borderRadius: 6,
          padding: '6px 14px',
          backgroundColor: 'transparent',
          color: '#ffffff',
          fontSize: 13,
          cursor: applying ? 'default' : 'pointer',
        }}
      >
        {t('pwaUpdate.later', 'لاحقًا')}
      </button>
    </div>
  );
}
