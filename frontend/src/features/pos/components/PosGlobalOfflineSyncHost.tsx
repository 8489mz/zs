import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePosOfflineSync } from '@/features/pos/hooks/usePosOfflineSync';
import { getActiveOfflineProvisionalShifts } from '@/features/pos/lib/pos-offline-vault';
import { APP_UNAUTHORIZED_EVENT } from '@/lib/http';

/**
 * Global background host for POS offline outbox & provisional shift synchronization.
 * Mounted lazily inside AppShellMain so offline sales keep syncing even when the cashier
 * navigates from `/pos` to `/cash-drawer` (to close their shift) or `/dashboard`, and
 * protects unsynced sales against accidental browser tab closure or silent 401 expiry.
 */
export function PosGlobalOfflineSyncHost() {
  const { offlineQueue, hasAuthRequiredSales } = usePosOfflineSync();
  const location = useLocation();
  const navigate = useNavigate();
  const [sessionExpiredOnPos, setSessionExpiredOnPos] = useState(false);

  const hasUnsyncedWork =
    offlineQueue.some((item) => item.status !== 'committed') ||
    getActiveOfflineProvisionalShifts().some((s) => s.status !== 'synced');

  useEffect(() => {
    if (!hasUnsyncedWork || typeof window === 'undefined') return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'توجد فواتير أوفلاين معلقة قيد المزامنة على هذا الجهاز.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsyncedWork]);

  useEffect(() => {
    const handleUnauthorized = () => {
      if (location.pathname.startsWith('/pos')) {
        setSessionExpiredOnPos(true);
      }
    };
    window.addEventListener(APP_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(APP_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [location.pathname]);

  if (!sessionExpiredOnPos && !hasAuthRequiredSales) {
    return null;
  }

  if (!location.pathname.startsWith('/pos')) {
    return null;
  }

  return (
    <div
      dir="rtl"
      role="alert"
      style={{
        position: 'fixed',
        bottom: '14px',
        left: '14px',
        zIndex: 9990,
        background: '#ffffff',
        border: '1.5px solid #f59e0b',
        borderRadius: '12px',
        padding: '10px 14px',
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        maxWidth: '460px',
      }}
    >
      <div style={{ fontSize: '12.5px', color: '#0f172a', fontWeight: 600, lineHeight: 1.45 }}>
        انتهت صلاحية الجلسة السحابية. جميع فواتيرك الأوفلاين محفوظة بأمان على الجهاز — سجّل الدخول لاستئناف ترحيلها تلقائياً.
      </div>
      <button
        type="button"
        onClick={() => navigate('/login?reason=expired')}
        style={{
          background: '#170e5e',
          color: '#ffffff',
          border: 'none',
          borderRadius: '8px',
          padding: '7px 12px',
          fontSize: '12px',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          cursor: 'pointer',
        }}
      >
        تسجيل الدخول
      </button>
    </div>
  );
}
