import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { invalidateSalesDomain } from '@/app/query-invalidation';
import { posApi } from '@/features/pos/api/pos.api';
import { buildPosSalePayload, buildLegacyPosSalePayload, type CreatePosSaleInput } from '@/features/pos/contracts';
import { enqueueOfflineSale, APP_NETWORK_STATE_EVENT } from '@/features/pos/lib/pos-offline-sync';

export function isNetworkOrOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  if (!error) return false;

  const err = error as any;
  if (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504) {
    return true;
  }

  if (
    err.code === 'network_error' ||
    err.code === 'timeout' ||
    err.code === 'ECONNREFUSED' ||
    err.code === 'ENOTFOUND' ||
    err.code === 'ETIMEDOUT'
  ) {
    return true;
  }

  if (
    err.name === 'TypeError' ||
    err.name === 'NetworkError' ||
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError')
  ) {
    return true;
  }

  const message = String(err.message || '').toLowerCase();
  if (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('offline') ||
    message.includes('timeout') ||
    message.includes('تعذر الاتصال') ||
    message.includes('فشل الاتصال') ||
    message.includes('الشبكة') ||
    message.includes('انتهت مهلة')
  ) {
    return true;
  }

  return false;
}

export function usePosSaleMutation() {
  const queryClient = useQueryClient();
  const isInFlightRef = useRef(false);

  return useMutation({
    mutationFn: async (input: CreatePosSaleInput) => {
      if (isInFlightRef.current) throw new Error('Sale already in progress');
      isInFlightRef.current = true;
      try {
        const payload = buildPosSalePayload(input);
        const legacyPayload = buildLegacyPosSalePayload(input);
        const idempotencyKey = crypto.randomUUID();

        try {
          return await posApi.createSale(payload, legacyPayload, { 'x-idempotency-key': idempotencyKey });
        } catch (error: any) {
          if (isNetworkOrOfflineError(error)) {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent(APP_NETWORK_STATE_EVENT, { detail: { online: false } }));
            }
            const offlineSale = enqueueOfflineSale(input, idempotencyKey);
            return { id: offlineSale.id, docNo: (offlineSale.payload as any)?.docNo || offlineSale.id, offline: true, ...input };
          }
          throw error;
        }
      } finally {
        isInFlightRef.current = false;
      }
    },
    onSuccess: (result) => {
      const isOffline = Boolean(result && typeof result === 'object' && (result as any).offline);
      if (isOffline) {
        return;
      }

      const saleId = (result && typeof result === 'object' && 'id' in result)
        ? String((result as { id?: string | number }).id || '')
        : '';

      // The invoice is already committed. Refetching active screens must not delay the
      // cashier's success feedback or block the next sale.
      void invalidateSalesDomain(queryClient, { saleId, includeDashboard: true }).catch((error) => {
        console.error('Failed to refresh sales data after POS checkout:', error);
      });
    }
  });
}
