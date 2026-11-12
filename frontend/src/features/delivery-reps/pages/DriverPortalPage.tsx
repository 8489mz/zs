import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { driverPortalApi, DeliveryOrder, SettleOrderPayload, DriverPortalUser } from '../api/delivery-reps.api';
import { DeliverySettlementModal } from '../components/DeliverySettlementModal';
import { DriverPortalLogin } from '../components/DriverPortalLogin';
import { DriverPinChangeScreen } from '../components/DriverPinChangeScreen';
import { DriverTopBar } from '../components/DriverTopBar';
import { DriverOrderCard } from '../components/DriverOrderCard';
import { PackageIcon } from '@/shared/components/icons/AppIcons';

interface OfflineQueueItem {
  orderId: number;
  docNo: string;
  customerName: string;
  total: number;
  payload?: SettleOrderPayload;
  settledAt: string;
}

export function DriverPortalPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [driverUser, setDriverUser] = useState<DriverPortalUser | null>(() => {
    const session = driverPortalApi.getStoredSession();
    return session ? session.rep : null;
  });

  // INV-DRIVER-PIN-FIRST-LOGIN-CHANGE: set from the login response (or
  // from the stored flag when the tab was closed on the change screen).
  // While true the orders list never renders and no orders call is made.
  const [mustChangePin, setMustChangePin] = useState<boolean>(() => driverPortalApi.getStoredMustChangePin());

  const [statusFilter, setStatusFilter] = useState<'pending' | 'settled' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSettleOrder, setActiveSettleOrder] = useState<DeliveryOrder | null>(null);

  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>(() => {
    try {
      const saved = localStorage.getItem('zs_driver_offline_queue');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallPwa = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const { data: orders = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['driver-portal-orders', driverUser?.id, statusFilter],
    queryFn: () => driverPortalApi.getOrders(statusFilter === 'all' ? undefined : statusFilter),
    enabled: Boolean(driverUser?.id) && !mustChangePin,
    refetchInterval: 25000,
  });

  const handleSwitchTenant = () => {
    if (window.confirm('هل تود الانتقال والتبديل إلى منشأة أخرى؟')) {
      driverPortalApi.logout();
      setDriverUser(null);
      setMustChangePin(false);
    }
  };

  const handleLogout = () => {
    if (window.confirm('هل تود تسجيل الخروج من حساب المندوب؟')) {
      driverPortalApi.logout();
      setDriverUser(null);
      setMustChangePin(false);
    }
  };

  const saveToOfflineQueue = (order: DeliveryOrder, payload?: SettleOrderPayload) => {
    const item: OfflineQueueItem = {
      orderId: order.id,
      docNo: order.docNo,
      customerName: order.customerName,
      total: Number(order.total || 0),
      payload,
      settledAt: new Date().toISOString(),
    };
    const updated = [item, ...offlineQueue];
    setOfflineQueue(updated);
    localStorage.setItem('zs_driver_offline_queue', JSON.stringify(updated));
    alert('تم حفظ إثبات التسليم محلياً في وضع عدم الاتصال (Offline) وسيتم رفعه فور عودة الشبكة.');
    setActiveSettleOrder(null);
  };

  const syncOfflineQueue = async () => {
    if (offlineQueue.length === 0 || isSyncingOffline) return;
    setIsSyncingOffline(true);
    const remaining: OfflineQueueItem[] = [];

    for (const item of offlineQueue) {
      try {
        await driverPortalApi.settleOrder(item.orderId, item.payload);
      } catch (err: any) {
        if (!navigator.onLine || err?.message?.includes('Network') || err?.message?.includes('Failed to fetch')) {
          remaining.push(item);
        }
      }
    }

    setOfflineQueue(remaining);
    localStorage.setItem('zs_driver_offline_queue', JSON.stringify(remaining));
    setIsSyncingOffline(false);
    queryClient.invalidateQueries({ queryKey: ['driver-portal-orders'] });

    if (remaining.length === 0) {
      alert('تمت مزامنة جميع الشحنات المعلقة مع السيرفر بنجاح!');
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      void syncOfflineQueue();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [offlineQueue]);

  const settleMutation = useMutation({
    mutationFn: ({ saleId, payload }: { saleId: number; payload?: SettleOrderPayload }) =>
      driverPortalApi.settleOrder(saleId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-portal-orders', driverUser?.id] });
      setActiveSettleOrder(null);
      alert('تم تأكيد تسليم الشحنة بنجاح!');
    },
    onError: (err: any, vars) => {
      if (!navigator.onLine || err?.message?.includes('Network') || err?.message?.includes('Failed to fetch')) {
        if (activeSettleOrder) {
          saveToOfflineQueue(activeSettleOrder, vars.payload);
        }
      } else {
        alert(err.message || 'فشل تأكيد تسليم الشحنة');
      }
    },
  });

  const handleCall = (phone?: string | null) => {
    if (!phone) return alert('رقم هاتف العميل غير متوفر');
    window.location.href = `tel:${phone.replace(/[^0-9+]/g, '')}`;
  };

  const handleWhatsApp = (phone?: string | null, docNo?: string) => {
    if (!phone) return alert('رقم هاتف العميل غير متوفر');
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const target = cleanPhone.startsWith('01') ? `2${cleanPhone}` : cleanPhone;
    const msg = `مرحباً، أنا مندوب التوصيل بخصوص طلبك رقم #${docNo || ''}. أنا في طريقي إليك!`;
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  };

  const handleOpenMap = (address?: string | null) => {
    if (!address) return alert('عنوان العميل غير محدد بدقة');
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener,noreferrer');
  };

  const handleSettleConfirm = (payload: SettleOrderPayload) => {
    if (!activeSettleOrder) return;
    settleMutation.mutate({ saleId: activeSettleOrder.id, payload });
  };

  const filteredOrders = orders.filter((o) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchDoc = String(o.docNo || '').toLowerCase().includes(q);
      const matchName = String(o.customerName || '').toLowerCase().includes(q);
      const matchPhone = String(o.customerPhone || '').includes(q);
      if (!matchDoc && !matchName && !matchPhone) return false;
    }
    return true;
  });

  const pendingCount = orders.filter((o) => !o.settledAt && o.deliveryStatus !== 'settled').length;
  const pendingAmount = orders.filter((o) => !o.settledAt && o.deliveryStatus !== 'settled').reduce((sum, o) => sum + Number(o.total || 0), 0);
  const settledCount = orders.filter((o) => Boolean(o.settledAt) || o.deliveryStatus === 'settled').length;

  if (!driverUser) {
    return (
      <DriverPortalLogin
        onLoginSuccess={(user, mustChange) => {
          setDriverUser(user);
          setMustChangePin(mustChange === true);
        }}
      />
    );
  }

  if (mustChangePin) {
    return (
      <DriverPinChangeScreen
        user={driverUser}
        onChanged={(_token, user) => {
          setDriverUser(user);
          setMustChangePin(false);
        }}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div
      style={{
        maxWidth: '640px',
        margin: '0 auto',
        paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))',
        paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
        paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
        width: '100%',
        boxSizing: 'border-box',
      }}
      dir="rtl"
    >
      <DriverTopBar
        driverUser={driverUser}
        deferredPrompt={deferredPrompt}
        onInstallPwa={handleInstallPwa}
        offlineQueueCount={offlineQueue.length}
        isSyncingOffline={isSyncingOffline}
        onSyncOffline={syncOfflineQueue}
        isFetching={isFetching}
        onRefresh={() => refetch()}
        onSwitchTenant={handleSwitchTenant}
        onLogout={handleLogout}
      />

      {/* KPI Counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px' }}>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.driver_portal_page.s0', "مطلوب تسليمها")}</div>
          <div style={{ fontSize: '18px', fontWeight: 900, color: '#ea580c', marginTop: '2px' }}>{pendingCount}</div>
        </div>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.driver_portal_page.s1', "المطلوب تحصيله")}</div>
          <div style={{ fontSize: '15px', fontWeight: 900, color: '#170e5e', marginTop: '2px' }}>{pendingAmount.toLocaleString('ar-EG')} <CurrencySymbol /></div>
        </div>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', color: '#64748b' }}>{t('delivery_reps.driver_portal_page.s2', "تم تسليمها")}</div>
          <div style={{ fontSize: '18px', fontWeight: 900, color: '#16a34a', marginTop: '2px' }}>{settledCount}</div>
        </div>
      </div>

      {/* Search and Tabs */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '10px 12px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            style={{
              flex: 1,
              padding: '7px 4px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '12px',
              fontWeight: 700,
              background: statusFilter === 'pending' ? '#ea580c' : '#f1f5f9',
              color: statusFilter === 'pending' ? '#ffffff' : '#475569',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            {t('delivery_reps.driver_portal_page.s3', "قيد التسليم (")}{pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('settled')}
            style={{
              flex: 1,
              padding: '7px 4px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '12px',
              fontWeight: 700,
              background: statusFilter === 'settled' ? '#16a34a' : '#f1f5f9',
              color: statusFilter === 'settled' ? '#ffffff' : '#475569',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            {t('delivery_reps.driver_portal_page.s4', "تم تسليمها (")}{settledCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            style={{
              flex: 1,
              padding: '7px 4px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '12px',
              fontWeight: 700,
              background: statusFilter === 'all' ? '#0f172a' : '#f1f5f9',
              color: statusFilter === 'all' ? '#ffffff' : '#475569',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            {t('delivery_reps.driver_portal_page.s5', "الكل (")}{orders.length})
          </button>
        </div>

        <input
          type="text"
          placeholder={t('delivery_reps.driver_portal_page.s6', "ابحث برقم الفاتورة أو اسم العميل أو الموبايل...")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontSize: '12.5px',
            boxSizing: 'border-box',
            outline: 'none',
            background: '#ffffff',
          }}
        />
      </div>

      {/* Orders List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {isLoading && (
          <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
            {t('delivery_reps.driver_portal_page.s7', "جاري تحميل الشحنات...")}
          </div>
        )}

        {!isLoading && filteredOrders.length === 0 && (
          <div style={{ padding: '36px 20px', textAlign: 'center', background: '#ffffff', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
              <PackageIcon size={32} color="#94a3b8" />
            </div>
            <strong style={{ fontSize: '14px', color: '#0f172a' }}>{t('delivery_reps.driver_portal_page.s8', "لا توجد شحنات مطابقة")}</strong>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
              {t('delivery_reps.driver_portal_page.s9', "لا توجد أي طلبات حالياً تحت هذا القسم أو البحث")}
            </p>
          </div>
        )}

        {filteredOrders.map((order) => (
          <DriverOrderCard
            key={order.id}
            order={order}
            onCall={handleCall}
            onWhatsApp={handleWhatsApp}
            onOpenMap={handleOpenMap}
            onSettle={(ord) => setActiveSettleOrder(ord)}
          />
        ))}
      </div>

      {/* Settle Proof Modal */}
      {activeSettleOrder && (
        <DeliverySettlementModal
          order={activeSettleOrder}
          isOpen={Boolean(activeSettleOrder)}
          onClose={() => setActiveSettleOrder(null)}
          onConfirm={handleSettleConfirm}
          isSubmitting={settleMutation.isPending}
        />
      )}
    </div>
  );
}
