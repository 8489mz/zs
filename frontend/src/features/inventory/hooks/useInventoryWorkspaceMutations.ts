import { useMutation, type QueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { invalidateInventoryDomain } from '@/app/query-invalidation';
import { inventoryApi } from '@/features/inventory/api/inventory.api';
import { withIdempotency, checkIdempotencyStatus } from '@/lib/idempotency';
import { INVENTORY_OPERATION_TYPES } from '@/features/inventory/lib/inventory-operation-types';
import { acquireInventoryAttempt, mayReleaseInventoryAttempt, inventoryTransferActionAttemptKey, type InventoryOperationAttempt } from '@/features/inventory/lib/inventory-operation-attempt';
import type { StockCountItem, StockTransferItem, StockTransfer } from '@/types/domain';

async function executeStickyInventoryMutation<T>(
  ref: { current: InventoryOperationAttempt<Record<string, unknown>> | null },
  payload: Record<string, unknown>,
  operationType: string,
  execute: (payload: Record<string, unknown>, headers: Record<string, string>) => Promise<T>,
): Promise<T> {
  const attempt = acquireInventoryAttempt(ref.current, payload, operationType, () => crypto.randomUUID());
  ref.current = attempt;
  try {
    return await withIdempotency((headers) => execute(attempt.payload, headers), operationType, attempt.key);
  } catch (error) {
    let status: Awaited<ReturnType<typeof checkIdempotencyStatus>> | null = null;
    try { status = await checkIdempotencyStatus(operationType, attempt.key); } catch { /* unknown */ }
    if (status?.status === 'committed' && status.response !== undefined) return status.response as T;
    const httpStatus = error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: number }).status) : 0;
    if (mayReleaseInventoryAttempt(httpStatus, status?.status)) ref.current = null;
    throw error;
  }
}

export function useInventoryWorkspaceMutations({
  queryClient,
  transferForm,
  transferItems,
  countForm,
  countItems,
  setTransferItems,
  setTransferForm,
  setCountItems,
  setCountForm,
  setPostingPin,
  setSelectedTransferIds,
  setSelectedSessionIds,
  setCreatedTransfer,
}: {
  queryClient: QueryClient;
  transferForm: { fromLocationId: string; toLocationId: string; note: string; recipientName: string; productId: string; qty: string; serials: string; batchAllocations: string };
  transferItems: StockTransferItem[];
  countForm: { branchId: string; locationId: string; note: string; managerPin: string; productId: string; countedQty: string; reason: string; itemNote: string };
  countItems: StockCountItem[];
  setTransferItems: Dispatch<SetStateAction<StockTransferItem[]>>;
  setTransferForm: Dispatch<SetStateAction<{ fromLocationId: string; toLocationId: string; note: string; recipientName: string; productId: string; qty: string; serials: string; batchAllocations: string }>>;
  setCountItems: Dispatch<SetStateAction<StockCountItem[]>>;
  setCountForm: Dispatch<SetStateAction<{ branchId: string; locationId: string; note: string; managerPin: string; productId: string; countedQty: string; reason: string; itemNote: string }>>;
  setPostingPin: Dispatch<SetStateAction<string>>;
  setSelectedTransferIds: Dispatch<SetStateAction<string[]>>;
  setSelectedSessionIds: Dispatch<SetStateAction<string[]>>;
  setCreatedTransfer: Dispatch<SetStateAction<StockTransfer | null>>;
}) {
  const transferAttempt = useRef<InventoryOperationAttempt<Record<string, unknown>> | null>(null);
  const countAttempt = useRef<InventoryOperationAttempt<Record<string, unknown>> | null>(null);
  const transferActionAttempts = useRef(new Map<string, InventoryOperationAttempt<Record<string, unknown>>>());
  const refreshInventoryQueries = async () => {
    await invalidateInventoryDomain(queryClient, { includeProducts: true, includeDashboard: true });
  };

  const createTransferMutation = useMutation({
    mutationFn: () => executeStickyInventoryMutation(
      transferAttempt,
      {
        fromLocationId: transferForm.fromLocationId,
        toLocationId: transferForm.toLocationId,
        note: transferForm.note,
        recipientName: transferForm.recipientName,
        items: transferItems.map(item => ({
          productId: item.productId, qty: item.qty,
          serials: item.serials, batchAllocations: item.batchAllocations,
        })),
      },
      INVENTORY_OPERATION_TYPES.createTransfer,
      (payload, headers) => inventoryApi.createStockTransfer(payload, headers),
    ),
    onSuccess: async (data: unknown) => {
      transferAttempt.current = null;
      await refreshInventoryQueries();
      setTransferItems([]);
      setTransferForm({ fromLocationId: '', toLocationId: '', note: '', recipientName: '', productId: '', qty: '1', serials: '', batchAllocations: '' });
      setCreatedTransfer((data as { stockTransfer: StockTransfer }).stockTransfer || null);
    },
  });

  const transferActionMutation = useMutation({
    mutationFn: async ({ transferIds, action, receiptItems, varianceReasons, approvalSecrets }: {
      transferIds: string[]; action: 'receive' | 'cancel';
      receiptItems?: Record<string, Array<{ itemId: number; receivedQty: number; receivedSerials?: string[]; batchReceipts?: Array<{ transitBatchId: number; receivedQty: number }> }>>;
      /** Variance reason per transfer, keyed by transfer id; required by the
       *  backend for any short receipt (at least 8 characters). */
      varianceReasons?: Record<string, string>;
      /** Approval password per transfer, keyed by transfer id: the
       *  password of a different admin user than the receiver
       *  (INV-TRANSFER-RECEIPT-SHORTAGE-APPROVAL). */
      approvalSecrets?: Record<string, string>;
    }) => {
      const operationKeys = transferIds.map(id => inventoryTransferActionAttemptKey(action, id));
      const frozenKeys = [...transferActionAttempts.current.keys()];
      if (frozenKeys.some(key => !operationKeys.includes(key))) {
        throw new Error('هناك دفعة استلام أو إلغاء سابقة غير محسومة؛ أعد محاولة نفس الأذونات قبل تغيير الاختيار');
      }
      for (const transferId of transferIds) {
        const actionKey = inventoryTransferActionAttemptKey(action, transferId);
        const ref: { current: InventoryOperationAttempt<Record<string, unknown>> | null } = {
          current: transferActionAttempts.current.get(actionKey) || null,
        };
        const payload: Record<string, unknown> = {
          transferId, action,
          ...(action === 'receive' ? { items: receiptItems?.[transferId], varianceReason: varianceReasons?.[transferId], approvalSecret: approvalSecrets?.[transferId] } : {}),
        };
        try {
          await executeStickyInventoryMutation(ref, payload,
            action === 'receive' ? INVENTORY_OPERATION_TYPES.receiveTransfer : INVENTORY_OPERATION_TYPES.cancelTransfer,
            (frozen, headers) => frozen.action === 'receive'
              ? inventoryApi.receiveStockTransfer(String(frozen.transferId), headers, {
                  items: frozen.items as Array<{
                    itemId: number; receivedQty: number; receivedSerials?: string[];
                    batchReceipts?: Array<{ transitBatchId: number; receivedQty: number }>;
                  }> | undefined,
                  varianceReason: frozen.varianceReason as string | undefined,
                  approvalSecret: frozen.approvalSecret as string | undefined,
                })
              : inventoryApi.cancelStockTransfer(String(frozen.transferId), headers));
        } finally {
          if (ref.current) transferActionAttempts.current.set(actionKey, ref.current);
          else transferActionAttempts.current.delete(actionKey);
        }
      }
    },
    onSuccess: async () => {
      transferActionAttempts.current.clear();
      await refreshInventoryQueries();
      setSelectedTransferIds([]);
    },
  });

  const createCountMutation = useMutation({
    mutationFn: ({ noteOverride }: { noteOverride?: string } = {}) => {
      const countedOnly = countItems.filter(
        (item) => item.isCounted !== false && item.countedQty !== '' && item.countedQty !== null && item.countedQty !== undefined
      );

      if (!countedOnly.length) {
        throw new Error('يرجى إدخال كميات معدودة لصنف واحد على الأقل قبل حفظ جلسة الجرد.');
      }

      const payload: Record<string, unknown> = {
        locationId: Number(countForm.locationId),
        items: countedOnly.map((item) => {
          const countItem: Record<string, unknown> = {
            productId: item.productId,
            countedQty: Number(item.countedQty),
          };

          if (item.countedSerials?.length) countItem.countedSerials = item.countedSerials;
          const batchLines = String(item.batchCountsText || '').split(/[\n,،]+/).map(s => s.trim()).filter(Boolean);
          if (batchLines.length) countItem.batchCounts = batchLines.map(line => {
            const existing = /^(\d+)\s*:\s*(\d+(?:\.\d+)?)$/.exec(line);
            if (existing) return { batchId: Number(existing[1]), countedQty: Number(existing[2]) };
            const novel = /^NEW:([^:]+):(\d{4}-\d{2}-\d{2}):(\d+(?:\.\d+)?)$/i.exec(line);
            if (novel) return { batchNumber: novel[1].trim(), expiryDate: novel[2], countedQty: Number(novel[3]) };
            throw new Error(`صيغة تشغيلة الجرد غير صحيحة للصنف ${item.productName}`);
          });
          if (String(item.reason || '').trim()) countItem.reason = item.reason;
          if (String(item.note || '').trim()) countItem.note = item.note;
          return countItem;
        }),
      };

      if (String(countForm.branchId || '').trim()) payload.branchId = Number(countForm.branchId);
      const effectiveNote = String(noteOverride || '').trim() || String(countForm.note || '').trim();
      if (effectiveNote) payload.note = effectiveNote;
      if (String(countForm.managerPin || '').trim()) payload.managerPin = countForm.managerPin.trim();

      return executeStickyInventoryMutation(countAttempt, payload,
        INVENTORY_OPERATION_TYPES.createStockCount,
        (frozenPayload, headers) => inventoryApi.createStockCountSession(frozenPayload, headers));
    },
    onSuccess: async () => {
      countAttempt.current = null;
      await refreshInventoryQueries();
      setCountItems([]);
      setCountForm({ branchId: '', locationId: '', note: '', managerPin: '', productId: '', countedQty: '0', reason: '', itemNote: '' });
    },
  });

  const postCountMutation = useMutation({
    mutationFn: async ({ sessionIds, managerPin }: { sessionIds: string[]; managerPin?: string }) => {
      // INV-STOCK-COUNT-ADJUSTMENT: keep the per-session results. The
      // caller must know whether items were deferred for a standalone
      // recount instead of toasting a blanket "posted and settled".
      const results: unknown[] = [];
      for (const sessionId of sessionIds) {
        results.push(await inventoryApi.postStockCountSession(sessionId, { adminPassword: managerPin, managerPin }));
      }
      return results;
    },
    onSuccess: async () => {
      await refreshInventoryQueries();
      setPostingPin('');
      setSelectedSessionIds([]);
    },
  });

  const deleteCountMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return inventoryApi.deleteStockCountSession(sessionId);
    },
    onSuccess: async () => {
      await refreshInventoryQueries();
    },
  });

  return {
    refreshInventoryQueries,
    createTransferMutation,
    transferActionMutation,
    createCountMutation,
    postCountMutation,
    deleteCountMutation,
  };
}
