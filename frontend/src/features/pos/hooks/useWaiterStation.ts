import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { posApi } from '@/features/pos/api/pos.api';
import { settingsApi } from '@/shared/api/settings.api';
import { printKitchenTicket } from '@/lib/pos-printing/kitchen';
import { toast } from '@/shared/components/system-alert';
import { tableCallsApi, type TableServiceCall } from '@/shared/api/table-calls.api';

export interface WaiterCartItem {
  id: string;
  productId: number;
  name: string;
  price: number;
  qty: number;
  notes?: string;
  modifiers?: Array<{ name: string; price: number }>;
}

const OFFLINE_QUEUE_KEY = 'waiter_offline_orders_queue';
const CACHED_PRODUCTS_KEY = 'waiter_cached_products';

export function useWaiterStation() {
  const queryClient = useQueryClient();

  // Network Connectivity State
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncingQueue, setIsSyncingQueue] = useState<boolean>(false);
  const [offlineQueue, setOfflineQueue] = useState<any[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    } catch {
      return [];
    }
  });

  // Settings & Configuration
  const { data: settings } = useQuery({
    queryKey: ['waiter-settings'],
    queryFn: () => settingsApi.settings(),
  });
  const tablesCount = Math.max(1, Number(settings?.restaurantTablesCount || 20));

  // Products Catalog (with resilient Offline LocalStorage Caching)
  const { data: productsData, isLoading: isCatalogLoading } = useQuery({
    queryKey: ['waiter-products'],
    queryFn: async () => {
      try {
        const res = await posApi.lookupProducts({ fullCatalog: true, limit: 100 });
        if (res && res.length > 0) {
          localStorage.setItem(CACHED_PRODUCTS_KEY, JSON.stringify(res));
        }
        return res;
      } catch (err) {
        const cached = localStorage.getItem(CACHED_PRODUCTS_KEY);
        if (cached) {
          return JSON.parse(cached);
        }
        throw err;
      }
    },
  });

  // Fallback to cache if query data is missing
  const products = useMemo(() => {
    if (productsData && productsData.length > 0) return productsData;
    try {
      const cached = localStorage.getItem(CACHED_PRODUCTS_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  }, [productsData]);

  // Active Held Drafts (To know occupied tables and their items)
  const { data: heldDrafts = [], refetch: refetchDrafts } = useQuery({
    queryKey: ['waiter-held-drafts'],
    queryFn: () => posApi.listHeldDrafts(),
    refetchInterval: 10_000,
  });

  const occupiedTablesMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const d of heldDrafts) {
      if (d.tableNumber && String(d.tableNumber).trim()) {
        map.set(String(d.tableNumber).trim(), d);
      }
    }
    // Also mark any locally queued tables as occupied
    for (const q of offlineQueue) {
      if (q.tableNumber) {
        map.set(String(q.tableNumber).trim(), {
          ...q,
          isOfflineQueued: true,
        });
      }
    }
    return map;
  }, [heldDrafts, offlineQueue]);

  // Real-time table service calls (Waiters & Bill requests)
  const { data: pendingCalls = [] } = useQuery({
    queryKey: ['waiter-station-table-calls'],
    queryFn: () => tableCallsApi.listPendingCalls(),
    refetchInterval: 5_000,
  });

  const pendingCallsByTable = useMemo(() => {
    const map = new Map<string, TableServiceCall[]>();
    for (const call of pendingCalls) {
      const tNum = String(call.table_number).trim();
      if (!map.has(tNum)) {
        map.set(tNum, []);
      }
      map.get(tNum)!.push(call);
    }
    return map;
  }, [pendingCalls]);

  const resolveCallMutation = useMutation({
    mutationFn: (callId: number) => tableCallsApi.resolveCall(callId),
    onSuccess: () => {
      toast.success('تم تأكيد تلبية نداء الطاولة');
      queryClient.invalidateQueries({ queryKey: ['waiter-station-table-calls'] });
    },
    onError: () => {
      toast.error('فشل تحديث حالة النداء');
    },
  });

  // Offline Queue Synchronizer
  const syncOfflineQueue = useCallback(async () => {
    const currentQueue: any[] = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    if (!currentQueue.length || isSyncingQueue) return;

    setIsSyncingQueue(true);
    let successCount = 0;
    const remainingQueue: any[] = [];

    for (const item of currentQueue) {
      try {
        await posApi.saveHeldDraft(item);
        successCount++;
      } catch {
        remainingQueue.push(item);
      }
    }

    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remainingQueue));
    setOfflineQueue(remainingQueue);
    setIsSyncingQueue(false);

    if (successCount > 0) {
      toast.success(`تمت مزامنة ${successCount} طلبات معلقة من وضع عدم الاتصال إلى المطبخ بنجاح!`);
      queryClient.invalidateQueries({ queryKey: ['waiter-held-drafts'] });
      queryClient.invalidateQueries({ queryKey: ['pos-floor-kds-tickets'] });
    }
  }, [isSyncingQueue, queryClient]);

  // Network Listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.info('تم استعادة الاتصال بالشبكة! جاري مزامنة طلبات الويتر...');
      void syncOfflineQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('تم فقدان الاتصال بالشبكة. محطة الويتر تعمل الآن في وضع عدم الاتصال (Offline Mode).');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncOfflineQueue]);

  // Submit & Send to Kitchen Mutation
  const sendToKitchenMutation = useMutation({
    mutationFn: async ({
      selectedTable,
      guestCount,
      waiterPin,
      cart,
    }: {
      selectedTable: string;
      guestCount: number;
      waiterPin: string;
      cart: WaiterCartItem[];
    }) => {
      if (!selectedTable || cart.length === 0) return;

      const existingDraft = occupiedTablesMap.get(selectedTable);
      const existingCart = existingDraft?.cart || [];

      // Consolidate payload
      const combinedCart = [
        ...existingCart,
        ...cart.map((c) => ({
          productId: c.productId,
          productName: c.name,
          name: c.name,
          price: c.price,
          qty: c.qty,
          notes: c.notes,
          modifiers: c.modifiers || [],
        })),
      ];

      const draftPayload = {
        id: existingDraft?.id || `draft-${Date.now()}`,
        tableNumber: selectedTable,
        orderType: 'dine_in',
        guestCount,
        waiterPin,
        cart: combinedCart,
        updatedAt: new Date().toISOString(),
      };

      // 1. Try sending online, or fallback to offline queue if disconnected / network error
      if (!navigator.onLine) {
        const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
        queue.push(draftPayload);
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        setOfflineQueue(queue);
        toast.warning(`أنت غير متصل: تم حفظ طلب طاولة ${selectedTable} محلياً وسيتم إرساله للمطبخ تلقائياً فور عودة الاتصال.`);
        return { isOfflineSaved: true };
      }

      try {
        await posApi.saveHeldDraft(draftPayload);
      } catch (networkErr: any) {
        // Enqueue locally on network exception
        const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
        queue.push(draftPayload);
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        setOfflineQueue(queue);
        toast.warning(`تعذر الوصول للسيرفر: تم حفظ طلب طاولة ${selectedTable} محلياً بنجاح للمزامنة.`);
        return { isOfflineSaved: true };
      }

      // 2. Thermal Kitchen Order Ticket (KOT)
      try {
        printKitchenTicket({
          ticketNumber: String(draftPayload.id).slice(-4),
          tableNumber: selectedTable,
          orderType: 'dine_in',
          items: cart.map((c) => ({
            name: c.name,
            qty: c.qty,
            notes: c.notes,
            modifiers: c.modifiers,
          })),
          timestamp: new Date(),
          serverName: `ويتر #${waiterPin}`,
        } as any, settings);
      } catch {
        // Kitchen print non-blocking
      }

      return { isOfflineSaved: false };
    },
    onSuccess: (res, variables) => {
      if (!res?.isOfflineSaved) {
        toast.success(`تم إرسال طلب طاولة ${variables.selectedTable} إلى المطبخ بنجاح!`);
      }
      queryClient.invalidateQueries({ queryKey: ['waiter-held-drafts'] });
      queryClient.invalidateQueries({ queryKey: ['pos-floor-kds-tickets'] });
    },
    onError: () => {
      toast.error('تعذر إرسال الطلب إلى المطبخ.');
    },
  });

  return {
    tablesCount,
    products,
    isCatalogLoading,
    heldDrafts,
    refetchDrafts,
    occupiedTablesMap,
    pendingCalls,
    pendingCallsByTable,
    isOnline,
    offlineQueueCount: offlineQueue.length,
    syncOfflineQueue,
    isSyncingQueue,
    handleResolveCall: (callId: number) => resolveCallMutation.mutateAsync(callId),
    sendToKitchen: sendToKitchenMutation.mutateAsync,
    isSendingToKitchen: sendToKitchenMutation.isPending,
  };
}
