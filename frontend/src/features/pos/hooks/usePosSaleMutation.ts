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
    onSuccess: (result, input) => {
      const isOffline = Boolean(result && typeof result === 'object' && (result as any).offline);

      // Optimistically deduct sold base quantities in cached POS product lists so the
      // cashier sees updated stock immediately in 0ms without waiting for a network refetch.
      if (input?.cart?.length) {
        const soldByProduct = new Map<string, number>();
        for (const item of input.cart) {
          const pid = String(item.productId || '').trim();
          const baseQty = Number(item.qty || 0) * Math.max(1, Number(item.unitMultiplier || 1));
          if (pid && baseQty > 0) {
            soldByProduct.set(pid, (soldByProduct.get(pid) || 0) + baseQty);
          }
        }
        if (soldByProduct.size > 0) {
          const applyOptimisticStock = (list: any[]) =>
            list.map((p) => {
              const delta = soldByProduct.get(String(p?.id ?? ''));
              if (!delta || typeof p?.stock !== 'number') return p;
              return { ...p, stock: Number((p.stock - delta).toFixed(4)) };
            });
          queryClient.setQueriesData({ queryKey: ['products', 'pos'] }, (old: any) => {
            if (Array.isArray(old)) return applyOptimisticStock(old);
            if (old && Array.isArray(old.products)) {
              return { ...old, products: applyOptimisticStock(old.products) };
            }
            return old;
          });
        }
      }

      if (isOffline) {
        return;
      }

      const saleId = (result && typeof result === 'object' && 'id' in result)
        ? String((result as { id?: string | number }).id || '')
        : '';

      // Defer background invalidation by 180ms so t=0ms receipt HTML dispatch to the
      // local printer bridge / Electron spooler and cart reset run with zero main-thread
      // JSON-parse or TCP pool contention.
      setTimeout(() => {
        void invalidateSalesDomain(queryClient, { saleId, includeDashboard: true }).catch((error) => {
          console.error('Failed to refresh sales data after POS checkout:', error);
        });
      }, 180);
    }
  });
}
