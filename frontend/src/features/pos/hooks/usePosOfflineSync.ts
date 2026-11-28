import { useEffect, useState, useCallback } from 'react';
import { posApi } from '@/features/pos/api/pos.api';
import { buildPosSalePayload, buildLegacyPosSalePayload } from '@/features/pos/contracts';
import {
  getOfflineSalesQueue,
  getPosTerminalCode,
  updateOfflineSaleStatus,
  removeOfflineSale,
  hydrateOfflineQueueFromVault,
  OfflinePosSale,
  APP_NETWORK_STATE_EVENT,
} from '@/features/pos/lib/pos-offline-sync';
import {
  getActiveOfflineProvisionalShifts,
  updateOfflineProvisionalShiftStatus,
  isOfflineQuickCustomerId,
  resolveOfflineQuickCustomer,
  removeOfflineQuickCustomer,
  POS_PROVISIONAL_SHIFTS_EVENT,
} from '@/features/pos/lib/pos-offline-vault';
import { cashDrawerApi } from '@/lib/api/cash-drawer';
import { catalogApi } from '@/lib/api/catalog';
import { extractCreatedEntityId } from '@/lib/api/extract-created-entity-id';
import { queryKeys } from '@/app/query-keys';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateSalesDomain } from '@/app/query-invalidation';
import { useAuthStore } from '@/stores/auth-store';

let isSyncInProgress = false;
let retryCount = 0;
const RETRY_INTERVALS = [15000, 30000, 60000, 120000, 120000];
let retryTimeout: ReturnType<typeof setTimeout> | null = null;
const SYNC_WEB_LOCK_NAME = 'zsystems_pos_offline_sync_lock';
const OFFLINE_SYNC_SALE_TIMEOUT_MS = 25_000;

type StaleSaleResolution =
  | { verdict: 'committed' }
  | { verdict: 'safe_to_retry' }
  | { verdict: 'still_processing' }
  | { verdict: 'auth_required' }
  | { verdict: 'needs_manual_review'; message?: string };

function extractServerFailureMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const candidate = payload as { message?: unknown; error?: { message?: unknown } };
  if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message.trim();
  if (Array.isArray(candidate.message) && candidate.message.length > 0) return String(candidate.message[0]);
  if (candidate.error && typeof candidate.error.message === 'string' && candidate.error.message.trim()) {
    return candidate.error.message.trim();
  }
  return undefined;
}

/**
 * Acquires a cross-tab exclusive lock via Web Locks API when available so multiple
 * open POS/ERP tabs never replay the offline outbox concurrently.
 */
async function runWithCrossTabSyncLock(task: () => Promise<void>): Promise<void> {
  if (isSyncInProgress) return;
  const locks = typeof navigator !== 'undefined'
    ? (navigator as unknown as { locks?: { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) => Promise<void> } }).locks
    : undefined;

  if (locks && typeof locks.request === 'function') {
    await locks.request(SYNC_WEB_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock || isSyncInProgress) return;
      isSyncInProgress = true;
      try {
        await task();
      } finally {
        isSyncInProgress = false;
      }
    });
    return;
  }

  isSyncInProgress = true;
  try {
    await task();
  } finally {
    isSyncInProgress = false;
  }
}

/**
 * A stale idempotency reservation means the first attempt may or may not have posted the invoice.
 * Asking the server which of the two happened is the only way to retry without risking a duplicate.
 * When the server confirms `status === 'failed'` with `documentId === null`, the transaction rolled
 * back completely; if the user explicitly requested a retry (`allowResetConfirmedFailed`), we reset
 * that terminal failure row server-side so the fixed sale can post cleanly under the SAME key.
 */
async function resolveStaleOfflineSale(
  idempotencyKey: string,
  allowResetConfirmedFailed: boolean,
): Promise<StaleSaleResolution> {
  try {
    const result = await posApi.getSaleOperationStatus(idempotencyKey);
    const status = String(result?.status || '');
    if (status === 'committed' || result?.documentId) return { verdict: 'committed' };
    if (status === 'processing') return { verdict: 'still_processing' };
    if (status === 'not_found') return { verdict: 'safe_to_retry' };

    if (status === 'failed' && !result?.documentId) {
      if (allowResetConfirmedFailed) {
        try {
          const resetRes = await posApi.resetFailedSaleOperation(idempotencyKey);
          if (resetRes?.reset) {
            return { verdict: 'safe_to_retry' };
          }
        } catch (resetErr: unknown) {
          if ((resetErr as { status?: number })?.status === 401) {
            return { verdict: 'auth_required' };
          }
        }
      }
      return {
        verdict: 'needs_manual_review',
        message: extractServerFailureMessage(result?.response),
      };
    }

    return { verdict: 'needs_manual_review' };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 401) return { verdict: 'auth_required' };
    if (status === 0 || status === 408 || status === 502 || status === 503 || status === 504) {
      return { verdict: 'still_processing' };
    }
    return { verdict: 'needs_manual_review' };
  }
}

async function syncPendingProvisionalShifts(): Promise<'ok' | 'auth_required' | 'network_blocked'> {
  const pendingShifts = getActiveOfflineProvisionalShifts();
  if (pendingShifts.length === 0) return 'ok';

  for (const shift of pendingShifts) {
    updateOfflineProvisionalShiftStatus(shift.id, 'syncing');
    try {
      await cashDrawerApi.open(
        {
          openingCash: shift.openingCash,
          branchId: shift.branchId,
          locationId: shift.locationId,
          note: shift.note ? `${shift.note} | [وردية أوفلاين: ${shift.docNo}]` : `[وردية أوفلاين: ${shift.docNo}]`,
          password: shift.password || undefined,
          terminalCode: shift.terminalCode,
          offlineOpenedAt: shift.openedAt,
        },
        { 'x-idempotency-key': shift.id },
      );
      updateOfflineProvisionalShiftStatus(shift.id, 'synced');
    } catch (error: unknown) {
      const err = error as { status?: number; code?: string; message?: string };
      if (err?.status === 401) {
        updateOfflineProvisionalShiftStatus(shift.id, 'pending_sync', 'انتهت صلاحية الجلسة — سجل الدخول لاستكمال ترحيل الوردية');
        return 'auth_required';
      }
      // If a shift is already open for this cashier or terminal on the server, treat as reconciled
      if (err?.code === 'SHIFT_ALREADY_OPEN' || err?.code === 'SHIFT_TERMINAL_OCCUPIED') {
        updateOfflineProvisionalShiftStatus(shift.id, 'synced');
        continue;
      }
      if (err?.status === 0 || err?.status === 408 || err?.status === 502 || err?.status === 503 || err?.status === 504) {
        updateOfflineProvisionalShiftStatus(shift.id, 'pending_sync');
        return 'network_blocked';
      }
      updateOfflineProvisionalShiftStatus(shift.id, 'failed', err?.message || 'تعذر فتح الوردية الأوفلاين على الخادم');
    }
  }
  return 'ok';
}

async function resolveOfflineCustomerIfNeeded(rawCustomerId: string): Promise<string> {
  if (!isOfflineQuickCustomerId(rawCustomerId)) return rawCustomerId;
  const localCust = resolveOfflineQuickCustomer(rawCustomerId);
  if (!localCust) return '';

  if (localCust.phone) {
    try {
      const matches = await posApi.customers({ search: localCust.phone, limit: 10 });
      const exact = matches.find(
        (m) => !isOfflineQuickCustomerId(m.id) && String((m as { phone?: string }).phone || '').trim() === localCust.phone,
      );
      if (exact?.id) {
        removeOfflineQuickCustomer(rawCustomerId);
        return String(exact.id);
      }
    } catch {
      // Fall through to create
    }
  }

  const created = await catalogApi.createCustomer({
    name: localCust.name,
    phone: localCust.phone,
    address: localCust.address,
    balance: 0,
    type: 'cash',
    creditLimit: 0,
  });
  const createdId = extractCreatedEntityId(created);
  if (createdId) {
    removeOfflineQuickCustomer(rawCustomerId);
    return String(createdId);
  }
  return '';
}

export function usePosOfflineSync() {
  const [offlineQueue, setOfflineQueue] = useState<OfflinePosSale[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();
  const activeUserId = useAuthStore((state) => state.user?.id);

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
    void hydrateOfflineQueueFromVault().then(() => refreshQueue());
    window.addEventListener('pos-offline-queue-updated', refreshQueue);
    window.addEventListener('storage', refreshQueue);
    return () => {
      window.removeEventListener('pos-offline-queue-updated', refreshQueue);
      window.removeEventListener('storage', refreshQueue);
    };
  }, [refreshQueue, activeUserId]);

  const syncOfflineSales = useCallback(async (retryFailed = false) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    await runWithCrossTabSyncLock(async () => {
      try {
        // Step 0: Always sync any provisional offline shift BEFORE replaying sales
        const shiftSyncOutcome = await syncPendingProvisionalShifts();
        if (shiftSyncOutcome === 'auth_required' || shiftSyncOutcome === 'network_blocked') {
          return;
        }
        if (getActiveOfflineProvisionalShifts().length === 0) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.cashierShiftsPage('open:pos') });
        }

        const queue = getOfflineSalesQueue();
        const pendingSales = queue.filter(
          (sale) => sale.status === 'committed' || retryFailed || sale.status !== 'failed',
        );

        if (pendingSales.length === 0) return;

        setIsSyncing(true);

        for (const sale of pendingSales) {
          try {
            if (!getOfflineSalesQueue().some((row) => row.id === sale.id && row.tenantId === sale.tenantId && row.accountId === sale.accountId)) {
              throw new Error('تم تغيير المنشأة أثناء المزامنة؛ أوقف هذه العملية ثم راجع طابور المنشأة السابقة');
            }
            if (sale.status === 'committed') {
              removeOfflineSale(sale.id);
              continue;
            }

            if (sale.status === 'pending' || sale.status === 'syncing' || sale.status === 'failed' || sale.status === 'auth_required') {
              const resolvedState = await resolveStaleOfflineSale(
                sale.id,
                retryFailed || sale.status === 'pending' || sale.status === 'auth_required',
              );
              if (resolvedState.verdict === 'committed') {
                updateOfflineSaleStatus(sale.id, 'committed');
                removeOfflineSale(sale.id);
                continue;
              }
              if (resolvedState.verdict === 'auth_required') {
                updateOfflineSaleStatus(sale.id, 'auth_required', 'انتهت صلاحية الجلسة — سجل الدخول لاستئناف ترحيل الفواتير تلقائياً');
                break;
              }
              if (resolvedState.verdict === 'still_processing') {
                updateOfflineSaleStatus(sale.id, 'syncing', 'الفاتورة قيد الترحيل أو بانتظار استقرار الشبكة؛ ستُعاد المحاولة تلقائياً');
                continue;
              }
              if (resolvedState.verdict !== 'safe_to_retry') {
                updateOfflineSaleStatus(
                  sale.id,
                  'failed',
                  resolvedState.message || sale.error || 'فاتورة تعطل ترحيلها؛ راجع سبب الخطأ ثم أعد المحاولة',
                );
                continue;
              }
            }

            if (!getOfflineSalesQueue().some((row) => row.id === sale.id && row.tenantId === sale.tenantId && row.accountId === sale.accountId)) {
              throw new Error('تغيّر حساب المنشأة قبل إرسال الفاتورة');
            }

            updateOfflineSaleStatus(sale.id, 'syncing');

            let resolvedCustomerId = String(sale.payload.customerId || '').trim();
            if (resolvedCustomerId && isOfflineQuickCustomerId(resolvedCustomerId)) {
              resolvedCustomerId = await resolveOfflineCustomerIfNeeded(resolvedCustomerId);
            }

            const input = resolvedCustomerId !== String(sale.payload.customerId || '').trim()
              ? { ...sale.payload, customerId: resolvedCustomerId }
              : sale.payload;

            const offlineDocNo = (input as unknown as { docNo?: string; offlineDocNo?: string }).docNo
              || (input as unknown as { offlineDocNo?: string }).offlineDocNo
              || sale.id;
            const offlineSyncFields = {
              offlineDocNo,
              offlineCreatedAt: sale.savedAt,
              terminalCode: input.terminalCode || getPosTerminalCode(),
            };
            const payload = { ...buildPosSalePayload(input), ...offlineSyncFields };
            const legacyPayload = { ...buildLegacyPosSalePayload(input), ...offlineSyncFields };
            const syncReqOptions = { timeoutMs: OFFLINE_SYNC_SALE_TIMEOUT_MS, treatTimeoutAsOffline: false };

            try {
              await posApi.createSale(payload, legacyPayload, { 'x-idempotency-key': sale.id }, syncReqOptions);
              updateOfflineSaleStatus(sale.id, 'committed');
              removeOfflineSale(sale.id);
            } catch (initialError: unknown) {
              const err = initialError as { status?: number; message?: string };
              if (err?.status === 401) {
                updateOfflineSaleStatus(sale.id, 'auth_required', 'انتهت صلاحية الجلسة — سجل الدخول لاستئناف ترحيل الفواتير تلقائياً');
                break;
              }

              const errorMessage = String(err?.message || '').toLowerCase();
              const isProcessing = errorMessage.includes('processing') || errorMessage.includes('operation in progress');
              const needsRecovery = errorMessage.includes('manual recovery') || errorMessage.includes('recovery_required');

              if (isProcessing) {
                updateOfflineSaleStatus(sale.id, 'syncing', 'جارٍ ترحيل الفاتورة على الخادم — ستتم إعادة المحاولة تلقائياً');
              } else if (needsRecovery) {
                const resolved = await resolveStaleOfflineSale(sale.id, retryFailed);
                if (resolved.verdict === 'committed') {
                  updateOfflineSaleStatus(sale.id, 'committed');
                  removeOfflineSale(sale.id);
                } else if (resolved.verdict === 'safe_to_retry') {
                  await posApi.createSale(payload, legacyPayload, { 'x-idempotency-key': sale.id }, syncReqOptions);
                  updateOfflineSaleStatus(sale.id, 'committed');
                  removeOfflineSale(sale.id);
                } else if (resolved.verdict === 'still_processing') {
                  updateOfflineSaleStatus(sale.id, 'syncing', 'الفاتورة ما زالت قيد الترحيل على الخادم');
                } else if (resolved.verdict === 'auth_required') {
                  updateOfflineSaleStatus(sale.id, 'auth_required', 'انتهت صلاحية الجلسة — سجل الدخول لاستئناف الترحيل');
                  break;
                } else {
                  updateOfflineSaleStatus(
                    sale.id,
                    'failed',
                    resolved.message || 'تعذر تأكيد ترحيل الفاتورة على الخادم. يلزم مراجعة يدوية قبل إعادة الإرسال لتفادي التكرار',
                  );
                }
              } else {
                throw initialError;
              }
            }
          } catch (error: unknown) {
            const err = error as { status?: number; message?: string };
            const errMsg = err?.message || 'تعذر ترحيل الفاتورة إلى الخادم';
            if (err?.status === 401) {
              updateOfflineSaleStatus(sale.id, 'auth_required', 'انتهت صلاحية الجلسة — سجل الدخول لاستئناف الترحيل');
              break;
            }
            if (err?.status === 400 || err?.status === 403 || err?.status === 409 || err?.status === 422) {
              updateOfflineSaleStatus(sale.id, 'failed', errMsg);
            } else {
              updateOfflineSaleStatus(sale.id, 'syncing', errMsg);
            }
          }
        }

        await invalidateSalesDomain(queryClient, { includeDashboard: true });

        const remainingPending = getOfflineSalesQueue().filter(
          (item) => item.status === 'pending' || item.status === 'syncing' || item.status === 'committed',
        );
        if (remainingPending.length > 0 || getActiveOfflineProvisionalShifts().some((s) => s.status === 'pending_sync')) {
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
      }
    });
  }, [queryClient]);

  useEffect(() => {
    const handleOnline = () => {
      retryCount = 0;
      void syncOfflineSales();
    };
    const handleNetworkState = (e: Event) => {
      const customEvent = e as CustomEvent<{ online?: boolean }>;
      if (customEvent.detail?.online === true) {
        retryCount = 0;
        void syncOfflineSales();
      }
    };
    const handleProvisionalUpdate = () => {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        void syncOfflineSales();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener(APP_NETWORK_STATE_EVENT, handleNetworkState);
    window.addEventListener(POS_PROVISIONAL_SHIFTS_EVENT, handleProvisionalUpdate);

    try {
      if (activeUserId && (getOfflineSalesQueue().length > 0 || getActiveOfflineProvisionalShifts().length > 0)) {
        void syncOfflineSales();
      }
    } catch {
      setQueueError('سجل الفواتير الأوفلاين تالف أو غير متاح؛ يلزم استعادته قبل المزامنة.');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(APP_NETWORK_STATE_EVENT, handleNetworkState);
      window.removeEventListener(POS_PROVISIONAL_SHIFTS_EVENT, handleProvisionalUpdate);
    };
  }, [syncOfflineSales, activeUserId]);

  return {
    offlineQueue,
    queueError,
    isSyncing,
    syncOfflineSales: () => syncOfflineSales(true),
    hasPendingSales: offlineQueue.length > 0,
    hasFailedSales: offlineQueue.some((item) => item.status === 'failed'),
    hasAuthRequiredSales: offlineQueue.some((item) => item.status === 'auth_required'),
  };
}
