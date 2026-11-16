import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { driverPortalApi } from '@/shared/api/delivery-reps.api';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import { vanOfflineDb } from '@/features/delivery-reps/offline/van-sales-offline.db';
import { vanSyncEngine } from '@/features/delivery-reps/offline/van-sync.engine';

export function useVanShell() {
  const queryClient = useQueryClient();

  const [session, setSession] = useState(() => driverPortalApi.getStoredSession());
  const [viewMode, setViewMode] = useState<'dashboard' | 'new-requisition'>('dashboard');
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Monitor connectivity, load pending outbox items, and listen to sync completion
  useEffect(() => {
    vanOfflineDb.getPendingCount().then(setPendingSyncCount);

    const cleanup = vanSyncEngine.startAutoSyncListener((online) => {
      setIsOnline(online);
      vanOfflineDb.getPendingCount().then(setPendingSyncCount);
    });

    const handleSyncComplete = (e: any) => {
      vanOfflineDb.getPendingCount().then(setPendingSyncCount);
      queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] });
      queryClient.invalidateQueries({ queryKey: ['driver-itinerary'] });
      queryClient.invalidateQueries({ queryKey: ['driver-sales-history'] });
      const synced = e?.detail?.syncedCount || 0;
      if (synced > 0) {
        toast.success(`تمت مزامنة ${synced} عملية ميدانية مع الخادم بنجاح!`);
      }
    };

    window.addEventListener('van-offline-sync-completed', handleSyncComplete);

    return () => {
      cleanup();
      window.removeEventListener('van-offline-sync-completed', handleSyncComplete);
    };
  }, [queryClient]);

  const handleLogout = async () => {
    const confirmed = await systemConfirm({
      title: 'تسجيل الخروج',
      message: 'هل تود بالتأكيد تسجيل الخروج من بوابة مبيعات الفان الميدانية؟',
      confirmText: 'تسجيل الخروج',
      cancelText: 'إلغاء',
      variant: 'danger',
    });
    if (confirmed) {
      driverPortalApi.logout();
      setSession(null);
      queryClient.clear();
      toast.info('تم تسجيل الخروج بنجاح');
    }
  };

  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null);

  const showAlert = (type: 'success' | 'error' | 'warning' | 'info', message: string) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  return {
    queryClient,
    session,
    setSession,
    viewMode,
    setViewMode,
    isOnline,
    pendingSyncCount,
    setPendingSyncCount,
    isSyncing,
    setIsSyncing,
    handleLogout,
    alert,
    showAlert,
  };
}
