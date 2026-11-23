import { buildStorePublicUrl } from '@/lib/store-public-url';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storefrontApi } from '../api/storefront.api';
import { bostaApi } from '../api/bosta.api';
import { gccShippingApi } from '../api/gcc-shipping.api';
import { OnlineOrderRecord } from '../types/storefront.types';
import { loadOnlineOrderIntoPosCart } from '../lib/storefront-pos-loader';
import type { Sale } from '@/types/domain';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import { getGlobalSystemCurrency, isThreeDecimalCurrency } from '@/lib/currencies';
import { MerchantOrdersPageHeader } from './merchant-online-orders/merchant-orders-page-header';
import { MerchantOrdersReaperBanner } from './merchant-online-orders/merchant-orders-reaper-banner';
import { MerchantOrdersKpiGrid } from './merchant-online-orders/merchant-orders-kpi-grid';
import { MerchantOrdersViewSwitcher } from './merchant-online-orders/merchant-orders-view-switcher';
import { MerchantOrdersOverviewTab } from './merchant-online-orders/merchant-orders-overview-tab';
import { MerchantOrdersOrdersTab } from './merchant-online-orders/merchant-orders-orders-tab';
import { MerchantOrdersAbandonedTab } from './merchant-online-orders/merchant-orders-abandoned-tab';
import { MerchantOrdersDetailModal } from './merchant-online-orders/merchant-orders-detail-modal';
import { MerchantOrdersBostaModal } from './merchant-online-orders/merchant-orders-bosta-modal';
import { MerchantOrdersGccModal } from './merchant-online-orders/merchant-orders-gcc-modal';
import { MerchantOrdersDeliveryModal } from './merchant-online-orders/merchant-orders-delivery-modal';
import { MerchantOrdersPosSuccessDialog } from './merchant-online-orders/merchant-orders-pos-success-dialog';
import { MerchantOrdersBulkCancelDialog } from './merchant-online-orders/merchant-orders-bulk-cancel-dialog';

export function MerchantOnlineOrdersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [isBulkCancelModalOpen, setIsBulkCancelModalOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrderRecord | null>(null);
  const [deliveryModalOrder, setDeliveryModalOrder] = useState<OnlineOrderRecord | null>(null);
  const [bostaModalOrder, setBostaModalOrder] = useState<OnlineOrderRecord | null>(null);
  const [gccModalOrder, setGccModalOrder] = useState<OnlineOrderRecord | null>(null);
  const [loadingPosOrderId, setLoadingPosOrderId] = useState<number | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'overview' | 'orders' | 'abandoned'>('overview');

  // Queries
  const settingsQuery = useQuery({
    queryKey: ['storefront-admin-settings'],
    queryFn: storefrontApi.getSettings,
  });

  const bostaSettingsQuery = useQuery({
    queryKey: ['bosta-settings'],
    queryFn: bostaApi.getSettings,
    staleTime: 5 * 60 * 1000,
  });

  const gccSettingsQuery = useQuery({
    queryKey: ['gcc-shipping-settings'],
    queryFn: gccShippingApi.getSettings,
    staleTime: 5 * 60 * 1000,
  });

  const isBostaConfigured = Boolean(
    bostaSettingsQuery.data?.enabled && bostaSettingsQuery.data?.apiKey?.trim()
  );

  const isGccConfigured = Boolean(
    gccSettingsQuery.data?.enabled &&
      (gccSettingsQuery.data?.smsaPassKey?.trim() ||
        gccSettingsQuery.data?.aramexAccountNumber?.trim() ||
        gccSettingsQuery.data?.aramexUserName?.trim())
  );

  const formatAmount = (val: number | null | undefined): string => {
    const num = Number(val || 0);
    const curr = getGlobalSystemCurrency();
    if (isThreeDecimalCurrency(curr)) return num.toFixed(3);
    if (curr === 'EGP') return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    return num.toFixed(2);
  };

  const ordersQuery = useQuery({
    queryKey: ['storefront-admin-orders', statusFilter, page, pageSize],
    queryFn: () => storefrontApi.listOrders(statusFilter, pageSize, page),
    refetchInterval: 10 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const analyticsQuery = useQuery({
    queryKey: ['storefront-admin-analytics'],
    queryFn: storefrontApi.getAnalytics,
    refetchInterval: 30 * 1000,
  });

  const abandonedQuery = useQuery({
    queryKey: ['storefront-admin-abandoned-carts'],
    queryFn: storefrontApi.listAbandonedCarts,
    enabled: viewMode === 'abandoned',
    refetchInterval: 15 * 1000,
  });

  const deleteAbandonedMutation = useMutation({
    mutationFn: (id: number) => storefrontApi.deleteAbandonedCart(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-abandoned-carts'] });
    },
  });

  // Mutations
  const bulkCancelMutation = useMutation({
    mutationFn: () => storefrontApi.bulkCancelOrders(adminPassword, 'pending'),
    onSuccess: (res) => {
      setIsBulkCancelModalOpen(false);
      setAdminPassword('');
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders-counts'] });
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-analytics'] });
      toast.success(res.message || `تم إلغاء ${res.cancelledCount} طلب بنجاح`);
    },
    onError: (err: any) => {
      toast.error(err.message || 'تعذر إلغاء الطلبات، تأكد من صحة كلمة مرور المسؤول (Admin)');
    },
  });

  // D-SF-12: the reaper's last sweep (heartbeat) + the manual "reap now" run.
  const reapStatusQuery = useQuery({
    queryKey: ['storefront-admin-reap-status'],
    queryFn: () => storefrontApi.getReapStatus(),
  });

  const reapExpiredMutation = useMutation({
    mutationFn: () => storefrontApi.reapExpiredOrders(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders-counts'] });
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-reap-status'] });
      toast.success(
        res.reapedOrdersCount > 0
          ? `تم إلغاء ${res.reapedOrdersCount} طلب منتهي وتحرير حجزه`
          : 'لا توجد طلبات منتهية — تم فحص الطلبات ولم يُلغَ شيء',
      );
    },
    onError: (err: any) => {
      toast.error(err.message || 'تعذر تشغيل فحص الطلبات المنتهية');
    },
  });

  const handleReapExpired = async () => {
    const confirmed = await systemConfirm({
      title: 'فحص الطلبات المنتهية الآن',
      message: 'سيتم إلغاء الطلبات المعلقة التي انتهت مهلة الدفع/الحجز وتحرير مخزونها المحجوز. الطلبات غير المنتهية لن تتأثر.',
      confirmText: 'شغّل الفحص',
      cancelText: 'تراجع',
      variant: 'primary',
    });
    if (confirmed) reapExpiredMutation.mutate();
  };

  const confirmPaymentMutation = useMutation({
    mutationFn: ({ id, reference }: { id: number; reference?: string }) =>
      storefrontApi.confirmOrderPayment(id, reference),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
      setSelectedOrder((prev) => (prev && prev.id === vars.id ? { ...prev, paymentStatus: 'paid', gatewayProvider: 'manual' } : prev));
      toast.success('تم تأكيد استلام التحويل، وستصدر فاتورة التوصيل كمحصّلة');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'تعذر تأكيد استلام التحويل');
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      storefrontApi.updateOrderStatus(id, status),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
      if (selectedOrder && selectedOrder.id === vars.id) {
        setSelectedOrder((prev) => (prev ? { ...prev, status: vars.status as any } : null));
      }
    },
  });

  const orders = ordersQuery.data?.orders || [];
  const counts = ordersQuery.data?.counts;
  const settings = settingsQuery.data;
  const totalFilteredCount = counts && statusFilter in counts ? counts[statusFilter] : orders.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));

  // Real-time KPI calculations with fallback to active orders
  const totalOrdersCount = (analyticsQuery.data?.totalOrders && analyticsQuery.data.totalOrders > 0)
    ? analyticsQuery.data.totalOrders
    : (counts?.all ?? orders.length);

  const pendingOrdersCount = counts?.pending ?? orders.filter((o) => o.status === 'pending').length;
  const validOrdersSum = orders.filter((o) => o.status !== 'cancelled').reduce((acc, o) => acc + (Number(o.totalAmount) || 0), 0);
  const totalRevenueAmount = (analyticsQuery.data?.totalRevenue && analyticsQuery.data.totalRevenue > 0)
    ? analyticsQuery.data.totalRevenue
    : validOrdersSum;

  const averageOrderVal = (analyticsQuery.data?.averageOrderValue && analyticsQuery.data.averageOrderValue > 0)
    ? analyticsQuery.data.averageOrderValue
    : (totalOrdersCount > 0 ? Math.round(totalRevenueAmount / totalOrdersCount) : 0);

  const unrecoveredCount = analyticsQuery.data?.unrecoveredAbandoned ?? 0;
  const conversionRateVal = analyticsQuery.data?.conversionRate ?? (
    (totalOrdersCount + unrecoveredCount) > 0
      ? Math.round((totalOrdersCount / (totalOrdersCount + unrecoveredCount)) * 100)
      : (totalOrdersCount > 0 ? 100 : 0)
  );

  const storeSlug = settings?.slug || 'store';
  const storeUrl = buildStorePublicUrl(storeSlug);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(storeUrl);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleLoadToPos = async (orderId: number) => {
    const targetOrder = orders.find((o) => o.id === orderId);
    if (targetOrder?.status === 'cancelled') {
      toast.warning('هذا الطلب تم إلغاؤه من قبل العميل ولا يمكن تنزيله في السلة.');
      return;
    }
    if (targetOrder?.saleId) {
      toast.info(`هذا الطلب تم تحويله لفاتورة مسبقاً (فاتورة #${targetOrder.saleId}).`);
      return;
    }

    setLoadingPosOrderId(orderId);
    try {
      await loadOnlineOrderIntoPosCart(orderId, navigate);
    } catch (err: any) {
      setLoadingPosOrderId(null);
      toast.error(`تعذر تحميل الطلب في السلة: ${err.message || 'خطأ غير متوقع'}`);
    }
  };

  return (
    <div className="page-stack page-shell merchant-online-orders-page" dir="rtl">
      <main
        className="document-prototype-column"
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          width: 'min(100%, 1280px)',
          paddingBottom: '80px',
        }}
      >
        <MerchantOrdersPageHeader storeUrl={storeUrl} pendingOrdersCount={pendingOrdersCount} setAdminPassword={setAdminPassword} setIsBulkCancelModalOpen={setIsBulkCancelModalOpen} handleCopyLink={handleCopyLink} copySuccess={copySuccess} handleReapExpired={handleReapExpired} reapExpiredMutation={reapExpiredMutation} />

        {/* D-SF-12: reaper heartbeat — the last automatic sweep, so a dead scheduler is visible. */}
        {reapStatusQuery.data && (
          <MerchantOrdersReaperBanner reapStatusQuery={reapStatusQuery} />
        )}


        {/* KPI Summary Cards Grid */}
        <MerchantOrdersKpiGrid totalRevenueAmount={totalRevenueAmount} totalOrdersCount={totalOrdersCount} pendingOrdersCount={pendingOrdersCount} averageOrderVal={averageOrderVal} conversionRateVal={conversionRateVal} unrecoveredCount={unrecoveredCount} />

        {/* View Mode Switcher: Overview vs Orders vs Abandoned Carts vs Settings */}
        <MerchantOrdersViewSwitcher setViewMode={setViewMode} viewMode={viewMode} counts={counts} analyticsQuery={analyticsQuery} navigate={navigate} />

        {/* Overview Tab: Institutional Dashboard & Catalog Insights */}
        {viewMode === 'overview' && (
          <MerchantOrdersOverviewTab formatAmount={formatAmount} analyticsQuery={analyticsQuery} setViewMode={setViewMode} setStatusFilter={setStatusFilter} counts={counts} />
        )}

        {viewMode === 'orders' && (
        /* Main Orders Card: Filter Tabs + Table */
        <MerchantOrdersOrdersTab counts={counts} setStatusFilter={setStatusFilter} setPage={setPage} statusFilter={statusFilter} orders={orders} ordersQuery={ordersQuery} setSelectedOrder={setSelectedOrder} setDeliveryModalOrder={setDeliveryModalOrder} setBostaModalOrder={setBostaModalOrder} setGccModalOrder={setGccModalOrder} handleLoadToPos={handleLoadToPos} loadingPosOrderId={loadingPosOrderId} updateStatusMutation={updateStatusMutation} isBostaConfigured={isBostaConfigured} isGccConfigured={isGccConfigured} totalPages={totalPages} page={page} pageSize={pageSize} totalFilteredCount={totalFilteredCount} />
        )}

        {/* Abandoned Carts View */}
        {viewMode === 'abandoned' && (
          <MerchantOrdersAbandonedTab abandonedQuery={abandonedQuery} formatAmount={formatAmount} deleteAbandonedMutation={deleteAbandonedMutation} />
        )}
      </main>

      {/* Order Details Modal with 1-Click Convert to Sale */}
      <MerchantOrdersDetailModal selectedOrder={selectedOrder} setSelectedOrder={setSelectedOrder} updateStatusMutation={updateStatusMutation} confirmPaymentMutation={confirmPaymentMutation} setDeliveryModalOrder={setDeliveryModalOrder} setBostaModalOrder={setBostaModalOrder} setGccModalOrder={setGccModalOrder} handleLoadToPos={handleLoadToPos} loadingPosOrderId={loadingPosOrderId} isBostaConfigured={isBostaConfigured} isGccConfigured={isGccConfigured} />

      {/* Bosta Courier Express Modal */}
      {bostaModalOrder && (
        <MerchantOrdersBostaModal bostaModalOrder={bostaModalOrder} setBostaModalOrder={setBostaModalOrder} queryClient={queryClient} setSelectedOrder={setSelectedOrder} />
      )}

      {/* GCC Courier Express Modal (Aramex / SMSA) */}
      {gccModalOrder && (
        <MerchantOrdersGccModal gccModalOrder={gccModalOrder} setGccModalOrder={setGccModalOrder} queryClient={queryClient} setSelectedOrder={setSelectedOrder} />
      )}

      {/* Delivery Representative & Quick Convert Modal */}
      <MerchantOrdersDeliveryModal deliveryModalOrder={deliveryModalOrder} setDeliveryModalOrder={setDeliveryModalOrder} queryClient={queryClient} setSelectedOrder={setSelectedOrder} setCompletedSale={setCompletedSale} setIsSuccessModalOpen={setIsSuccessModalOpen} handleLoadToPos={handleLoadToPos} />

      {/* POS Success & Receipt Printing Dialog */}
      <MerchantOrdersPosSuccessDialog isSuccessModalOpen={isSuccessModalOpen} completedSale={completedSale} settings={settings} setIsSuccessModalOpen={setIsSuccessModalOpen} setCompletedSale={setCompletedSale} />
      {/* Bulk Cancel Modal Protected by Admin Password */}
      <MerchantOrdersBulkCancelDialog isBulkCancelModalOpen={isBulkCancelModalOpen} bulkCancelMutation={bulkCancelMutation} setIsBulkCancelModalOpen={setIsBulkCancelModalOpen} setAdminPassword={setAdminPassword} adminPassword={adminPassword} pendingOrdersCount={pendingOrdersCount} />
    </div>
  );
}
