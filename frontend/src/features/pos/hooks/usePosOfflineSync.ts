import { useEffect, useState, useCallback } from 'react';
import { posApi } from '@/features/pos/api/pos.api';
import { buildPosSalePayload, buildLegacyPosSalePayload, buildMinimalPosSalePayload } from '@/features/pos/contracts';
import { getOfflineSalesQueue, getPosTerminalCode, updateOfflineSaleStatus, removeOfflineSale, OfflinePosSale, APP_NETWORK_STATE_EVENT } from '@/features/pos/lib/pos-offline-sync';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateSalesDomain } from '@/app/query-invalidation';

let isSyncInProgress = false;
let retryCount = 0;
const RETRY_INTERVALS = [30000, 60000, 120000, 120000, 120000];
let retryTimeout: ReturnType<typeof setTimeout> | null = null;

type StaleSaleResolution = 'committed' | 'safe_to_retry' | 'still_processing' | 'needs_manual_review';

/**
 * A stale idempotency reservation means the first attempt may or may not have posted the invoice.
 * Asking the server which of the two happened is the only way to retry without risking a duplicate.
 */
async function resolveStaleOfflineSale(idempotencyKey: string): Promise<StaleSaleResolution> {
  try {
    const result = await posApi.getSaleOperationStatus(idempotencyKey);
    const status = String(result?.status || '');
    // Already posted server-side, or a document was produced: the queue entry is done.
    if (status === 'committed' || result?.documentId) return 'committed';
    if (status === 'processing') return 'still_processing';
    // The server never recorded the attempt, or recorded it as failed: resending is safe.
    // A persisted server-side failure is terminal for this idempotency key.
    // Only an operation that was never reserved can be safely submitted anew.
    if (status === 'not_found') return 'safe_to_retry';
    return 'needs_manual_review';
  } catch {
    // If we cannot confirm, we must not guess: a duplicate invoice is worse than a delayed one.
    return 'needs_manual_review';
  }
}

export function usePosOfflineSync() {
  const [offlineQueue, setOfflineQueue] = useState<OfflinePosSale[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();

  const refreshQueue = useCallback(() => {
    try {
      setOfflineQueue(getOfflineSalesQueue());
      setQueueError(null);
    } catch {
      setQueueError('سجل فواتير الأوفلاين غير قابل للقراءة. لا تحذف بيانات التطبيق ولا تنشئ فاتورة جديدة قبل استعادة السجل.');
    }
  }, []);

  useEffect(() => {
    refreshQueue();
    window.addEventListener('pos-offline-queue-updated', refreshQueue);
    return () => window.removeEventListener('pos-offline-queue-updated', refreshQueue);
  }, [refreshQueue]);

  const syncOfflineSales = useCallback(async (retryFailed = false) => {
    if (isSyncInProgress) return;
    isSyncInProgress = true;

    try {
      const queue = getOfflineSalesQueue();
      // A crash/reload may leave a durable entry in 'syncing'. Never strand it:
      // reconcile its idempotency key with the server before any new send.
      const pendingSales = queue.filter((sale) => sale.status === 'committed' || retryFailed || sale.status !== 'failed');
      
      if (pendingSales.length === 0) return;
      
      setIsSyncing(true);
      
      for (const sale of pendingSales) {
        try {
          // A renderer tenant switch mid-sync must never replay the old tenant's sale.
          if (!getOfflineSalesQueue().some(row => row.id === sale.id && row.tenantId === sale.tenantId && row.accountId === sale.accountId)) {
            throw new Error('تم تغيير المنشأة أثناء المزامنة؛ أوقف هذه العملية ثم راجع طابور المنشأة السابقة');
          }
          if (sale.status === 'committed') {
            removeOfflineSale(sale.id);
            continue;
          }
          // Even a 'pending' row can represent a request that timed out before
          // the status write completed. Always ask the server before replay.
          if (sale.status === 'pending' || sale.status === 'syncing' || sale.status === 'failed') {
            const result = await resolveStaleOfflineSale(sale.id);
            if (result === 'committed') {
              updateOfflineSaleStatus(sale.id, 'committed');
              removeOfflineSale(sale.id);
              continue;
            }
            if (result === 'still_processing') {
              updateOfflineSaleStatus(sale.id, 'syncing', 'الفاتورة قيد الترحيل على الخادم؛ سيُعاد التحقق من حالتها');
              continue;
            }
            if (result !== 'safe_to_retry') {
              updateOfflineSaleStatus(sale.id, 'failed', 'فاتورة تعطل ترحيلها: تعذر التحقق من حالة الخادم؛ راجع الفاتورة قبل إعادة الإرسال');
              continue;
            }
          }
          if (!getOfflineSalesQueue().some(row => row.id === sale.id && row.tenantId === sale.tenantId && row.accountId === sale.accountId)) {
            throw new Error('تغيّر حساب المنشأة قبل إرسال الفاتورة');
          }
          updateOfflineSaleStatus(sale.id, 'syncing');
          const input = sale.payload;
          const offlineDocNo = (input as any).docNo || (input as any).offlineDocNo || sale.id;
          // INV-REST-SHIFT-CLOSE-CONTROL (I26/I24): the sync sends
          // the sale's ORIGINAL timestamp (savedAt) so the server
          // books it into the shift whose window held it, and the
          // station code so its cash attributes to that station's
          // shift. Both ride on every payload shape (full/legacy/
          // minimal) — the fallback retry must carry them too.
          const offlineSyncFields = { offlineDocNo, offlineCreatedAt: sale.savedAt, terminalCode: getPosTerminalCode() };
          const payload = { ...buildPosSalePayload(input), ...offlineSyncFields };
          const legacyPayload = { ...buildLegacyPosSalePayload(input), ...offlineSyncFields };
          const minimalPayload = { ...buildMinimalPosSalePayload(input), ...offlineSyncFields };
          
          try {
            await posApi.createSale(payload, legacyPayload, minimalPayload, { 'x-idempotency-key': sale.id });
            updateOfflineSaleStatus(sale.id, 'committed');
            removeOfflineSale(sale.id);
          } catch (initialError: any) {
            // NEVER mint a fresh idempotency key for the same offline sale. sale.id IS the stable
            // idempotency key; replacing it makes the server treat the retry as a brand-new sale and
            // the invoice is posted twice (stock deducted twice, revenue and cash doubled).
            const errorMessage = String(initialError?.message || '').toLowerCase();
            // Not every HTTP 409 is an idempotency reservation in progress:
            // a business conflict (stock, credit limit, duplicate offline reference)
            // must surface to the cashier rather than retry forever.
            const isProcessing = errorMessage.includes('processing') ||
              errorMessage.includes('operation in progress');
            const needsRecovery = errorMessage.includes('manual recovery') ||
              errorMessage.includes('recovery_required');

            if (isProcessing) {
              // The original request for this key is still executing server-side. Leave it queued and
              // let the backoff timer retry later with the SAME key, which the server will answer from
              // its committed result once the first attempt finishes.
              updateOfflineSaleStatus(sale.id, 'syncing', 'جارٍ ترحيل الفاتورة على الخادم — ستتم إعادة المحاولة تلقائياً');
            } else if (needsRecovery) {
              // A stale reservation means the first attempt may or may not have committed. Resubmitting
              // blindly risks a duplicate invoice, so ask the server what actually happened.
              const resolved = await resolveStaleOfflineSale(sale.id);
              if (resolved === 'committed') {
                updateOfflineSaleStatus(sale.id, 'committed');
                removeOfflineSale(sale.id);
              } else if (resolved === 'safe_to_retry') {
                await posApi.createSale(payload, legacyPayload, minimalPayload, { 'x-idempotency-key': sale.id });
                updateOfflineSaleStatus(sale.id, 'committed');
                removeOfflineSale(sale.id);
              } else if (resolved === 'still_processing') {
                updateOfflineSaleStatus(sale.id, 'syncing', 'الفاتورة ما زالت قيد الترحيل على الخادم');
              } else {
                updateOfflineSaleStatus(
                  sale.id,
                  'failed',
                  'تعذر تأكيد ترحيل الفاتورة على الخادم. يلزم مراجعة يدوية قبل إعادة الإرسال لتفادي التكرار',
                );
              }
            } else {
              throw initialError;
            }
          }
        } catch (error: any) {
          const errMsg = error?.message || 'تعذر ترحيل الفاتورة إلى الخادم';
          if (error?.status === 400 || error?.status === 403 || error?.status === 409 || error?.status === 422) {
            updateOfflineSaleStatus(sale.id, 'failed', errMsg);
          } else {
            updateOfflineSaleStatus(sale.id, 'syncing', errMsg);
          }
        }
      }
      
      await invalidateSalesDomain(queryClient, { includeDashboard: true });

      const remainingPending = getOfflineSalesQueue().filter(item => item.status === 'pending' || item.status === 'syncing' || item.status === 'committed');
      if (remainingPending.length > 0) {
        // Keep backing off while offline; stopping after five attempts could
        // leave completed cashier sales stranded indefinitely on this device.
        const delay = RETRY_INTERVALS[Math.min(retryCount, RETRY_INTERVALS.length - 1)] || 120000;
        retryCount = Math.min(retryCount + 1, RETRY_INTERVALS.length);
        if (retryTimeout) clearTimeout(retryTimeout);
        retryTimeout = setTimeout(() => {
          void syncOfflineSales();
        }, delay);
      } else {
        retryCount = 0;
        if (retryTimeout) {
          clearTimeout(retryTimeout);
          retryTimeout = null;
        }
      }
    } catch {
      setQueueError('تعذر قراءة طابور الفواتير الأوفلاين بأمان؛ لم تُرسل عمليات جديدة.');
    } finally {
      setIsSyncing(false);
      isSyncInProgress = false;
    }
  }, [queryClient]);

  useEffect(() => {
    const handleOnline = () => {
      void syncOfflineSales();
    };
    const handleNetworkState = (e: Event) => {
      const customEvent = e as CustomEvent<{ online?: boolean }>;
      if (customEvent.detail?.online === true) {
        void syncOfflineSales();
      }
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener(APP_NETWORK_STATE_EVENT, handleNetworkState);
    
    // Attempt initial sync on load if queue exists
    try {
      if (getOfflineSalesQueue().length > 0) void syncOfflineSales();
    } catch {
      setQueueError('سجل الفواتير الأوفلاين تالف أو غير متاح؛ يلزم استعادته قبل المزامنة.');
    }
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(APP_NETWORK_STATE_EVENT, handleNetworkState);
    };
  }, [syncOfflineSales]);

  return {
    offlineQueue,
    queueError,
    isSyncing,
    syncOfflineSales: () => syncOfflineSales(true),
    hasPendingSales: offlineQueue.length > 0,
    hasFailedSales: offlineQueue.some(item => item.status === 'failed'),
  };
}
