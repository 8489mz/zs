import { useTranslation } from 'react-i18next';
import { buildStorePublicUrl } from '@/lib/store-public-url';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storefrontApi } from '../api/storefront.api';
import { bostaApi } from '../api/bosta.api';
import { gccShippingApi } from '../api/gcc-shipping.api';
import { OnlineOrderRecord, AbandonedCartRecord } from '../types/storefront.types';
import { ConvertDeliveryModal } from '../components/ConvertDeliveryModal';
import { BostaShipmentModal } from '../components/BostaShipmentModal';
import { GccShipmentModal } from '../components/GccShipmentModal';
import { MerchantOrdersTable } from '../components/MerchantOrdersTable';
import { MerchantOrderDetailModal } from '../components/MerchantOrderDetailModal';
import { loadOnlineOrderIntoPosCart } from '../lib/storefront-pos-loader';
import { PosSaleSuccessDialog } from '@/features/pos/components/pos-workspace/PosSaleSuccessDialog';
import { printPostedSaleReceipt } from '@/lib/pos-printing';
import type { Sale } from '@/types/domain';
import { PageHeader } from '@/shared/components/page-header';
import { StandardDialog } from '@/shared/components/StandardDialog';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import { getGlobalCurrencySymbol, getGlobalSystemCurrency, isThreeDecimalCurrency } from '@/lib/currencies';
import { TrendingUpIcon, MessageSquareIcon, Trash2Icon, CopyIcon, CheckIcon, AlertTriangleIcon, SlidersIcon } from '@/shared/components/icons/AppIcons';

export function MerchantOnlineOrdersPage() {
  const { t } = useTranslation();
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
        <PageHeader
          title={t('storefront.merchant_online_orders_page.s0', "إدارة ومتابعة طلبات المتجر الإلكتروني")}
          badge={<span className="nav-pill" style={{ background: '#f0f3ff', color: '#170e5e', border: '1px solid #d8e0fc' }}>{t('storefront.merchant_online_orders_page.s1', "مباشر ومربوط بالمخزن")}</span>}
          description={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
              <span style={{ fontSize: '12.5px', color: '#64748b' }}>{t('storefront.merchant_online_orders_page.s2', "رابط متجرك للزبائن:")}</span>
              <span style={{ fontSize: '13px', fontFamily: 'monospace', direction: 'ltr', color: '#170e5e', fontWeight: 800 }}>
                {storeUrl}
              </span>
            </div>
          }
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {pendingOrdersCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setAdminPassword('');
                    setIsBulkCancelModalOpen(true);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    height: '36px',
                    padding: '0 14px',
                    borderRadius: '8px',
                    background: '#fef2f2',
                    color: '#dc2626',
                    border: '1px solid #fecaca',
                    fontWeight: 700,
                    fontSize: '13px',
                    cursor: 'pointer',
                    boxShadow: '0 1px 2px rgba(220, 38, 38, 0.05)',
                    boxSizing: 'border-box',
                  }}
                >
                  <Trash2Icon size={14} color="#dc2626" />
                  <span>{t('storefront.merchant_online_orders_page.s3', "إلغاء الطلبات المعلقة (")}{pendingOrdersCount.toLocaleString()})</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyLink}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '36px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  background: '#ffffff',
                  color: copySuccess ? '#166534' : '#334155',
                  border: copySuccess ? '1.5px solid #22c55e' : '1px solid #cbd5e1',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                  boxSizing: 'border-box',
                }}
              >
                {copySuccess ? <CheckIcon size={14} color="#166534" /> : <CopyIcon size={14} color="#64748b" />}
                <span>{copySuccess ? t('storefront.merchant_online_orders_page.s4', "تم نسخ الرابط!") : t('storefront.merchant_online_orders_page.s5', "نسخ رابط المتجر")}</span>
              </button>
              <a
                href={storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '36px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  background: '#170e5e',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 700,
                  textDecoration: 'none',
                  boxShadow: '0 1px 3px rgba(23,14,94,0.2)',
                  boxSizing: 'border-box',
                }}
              >
                <span>{t('storefront.merchant_online_orders_page.s6', "معاينة المتجر كزبون")}</span>
                <span style={{ fontSize: '13px' }}>↗</span>
              </a>
              {/* D-SF-12: manual expired-reservation reap — the scheduler runs it every 2 min; this runs it now. */}
              <button
                type="button"
                onClick={handleReapExpired}
                disabled={reapExpiredMutation.isPending}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '36px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  background: '#ffffff',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: reapExpiredMutation.isPending ? 'wait' : 'pointer',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                  boxSizing: 'border-box',
                }}
              >
                <span>{reapExpiredMutation.isPending ? t('storefront.merchant_online_orders_page.s59', "جارٍ فحص الطلبات المنتهية...") : t('storefront.merchant_online_orders_page.s60', "فحص الطلبات المنتهية الآن")}</span>
              </button>
            </div>
          }
        />

        {/* D-SF-12: reaper heartbeat — the last automatic sweep, so a dead scheduler is visible. */}
        {reapStatusQuery.data && (
          <div style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '12px' }}>
            {reapStatusQuery.data.lastSweep ? (
              <>
                <span>{t('storefront.merchant_online_orders_page.s61', "آخر فحص تلقائي للطلبات المنتهية: ")}</span>
                <span>{new Date(reapStatusQuery.data.lastSweep.completedAt).toLocaleString(t('common.locale', 'en-US') === 'en-US' ? 'en-US' : 'ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span>{t('storefront.merchant_online_orders_page.s62', " — تم فحص ")}</span>
                <span>{reapStatusQuery.data.lastSweep.scannedCount.toLocaleString()}</span>
                <span>{t('storefront.merchant_online_orders_page.s63', " طلب، وأُلغي ")}</span>
                <span>{reapStatusQuery.data.lastSweep.reapedOrdersCount.toLocaleString()}</span>
                {reapStatusQuery.data.lastSweep.skippedWhileRunning && (
                  <span>{t('storefront.merchant_online_orders_page.s64', " — تم تخطي الفحص لأن الفحص السابق كان لا يزال يعمل")}</span>
                )}
                {reapStatusQuery.data.lastSweep.error && (
                  <span>{t('storefront.merchant_online_orders_page.s65', " — خطأ: ")}{reapStatusQuery.data.lastSweep.error}</span>
                )}
              </>
            ) : (
              <span>{t('storefront.merchant_online_orders_page.s66', "الفحص التلقائي للطلبات المنتهية لم يعمل بعد.")}</span>
            )}
          </div>
        )}


        {/* KPI Summary Cards Grid */}
        <div
          className="merchant-orders-kpi-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          {/* Card 1: Revenue */}
          <div
            className="merchant-orders-kpi-card"
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '14px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>
              <span>{t('storefront.merchant_online_orders_page.s7', "إجمالي إيرادات المتجر")}</span>
              <TrendingUpIcon size={16} color="#16a34a" />
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
              {totalRevenueAmount.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600 }}>{getGlobalCurrencySymbol()}</span>
            </div>
            <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>
              {t('storefront.merchant_online_orders_page.s8', "الطلبات الصالحة والمسلمة")}
            </span>
          </div>

          {/* Card 2: Orders Count */}
          <div
            className="merchant-orders-kpi-card"
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '14px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>
              <span>{t('storefront.merchant_online_orders_page.s9', "إجمالي عدد الطلبات")}</span>
              <span style={{ fontSize: '11px', color: '#170e5e', fontWeight: 700, background: '#f0f3ff', padding: '1px 6px', borderRadius: '4px' }}>{t('storefront.merchant_online_orders_page.s10', "متجر")}</span>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
              {totalOrdersCount.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600 }}>{t('storefront.merchant_online_orders_page.s11', "طلب")}</span>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {t('storefront.merchant_online_orders_page.s12', "قيد التنفيذ:")} {pendingOrdersCount} {t('storefront.merchant_online_orders_page.s13', "طلبات")}
            </span>
          </div>

          {/* Card 3: AOV */}
          <div
            className="merchant-orders-kpi-card"
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '14px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>
              <span>{t('storefront.merchant_online_orders_page.s14', "متوسط قيمة السلة (AOV)")}</span>
              <span style={{ fontSize: '11px', color: '#0369a1', fontWeight: 700, background: '#f0f9ff', padding: '1px 6px', borderRadius: '4px' }}>{t('storefront.merchant_online_orders_page.s15', "معدل")}</span>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
              {averageOrderVal.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 600 }}>{getGlobalCurrencySymbol()}</span>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {t('storefront.merchant_online_orders_page.s16', "متوسط الفاتورة لكل عميل")}
            </span>
          </div>

          {/* Card 4: Conversion Rate & Abandoned */}
          <div
            className="merchant-orders-kpi-card"
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '14px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>
              <span>{t('storefront.merchant_online_orders_page.s17', "معدل التحويل والسلات")}</span>
              <span style={{ fontSize: '11px', color: '#d97706', fontWeight: 700, background: '#fffbeb', padding: '1px 6px', borderRadius: '4px' }}>{t('storefront.merchant_online_orders_page.s18', "تحويل")}</span>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>
              {conversionRateVal}%
            </div>
            <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>
              {t('storefront.merchant_online_orders_page.s19', "سلات متروكة:")} {unrecoveredCount} {t('storefront.merchant_online_orders_page.s20', "سلة")}
            </span>
          </div>
        </div>

        {/* View Mode Switcher: Overview vs Orders vs Abandoned Carts vs Settings */}
        <div
          className="merchant-orders-view-switcher"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            marginBottom: '14px',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            maxWidth: '100%',
            paddingBottom: '4px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setViewMode('overview')}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: viewMode === 'overview' ? '2px solid #170e5e' : '1px solid #cbd5e1',
                background: viewMode === 'overview' ? '#170e5e' : '#ffffff',
                color: viewMode === 'overview' ? '#ffffff' : '#334155',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: viewMode === 'overview' ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <TrendingUpIcon size={14} color={viewMode === 'overview' ? '#ffffff' : '#475569'} />
              <span>لوحة القيادة والتحليلات (Overview)</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('orders')}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: viewMode === 'orders' ? '2px solid #170e5e' : '1px solid #cbd5e1',
                background: viewMode === 'orders' ? '#170e5e' : '#ffffff',
                color: viewMode === 'orders' ? '#ffffff' : '#334155',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: viewMode === 'orders' ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span>{t('storefront.merchant_online_orders_page.s21', "طلبات المتجر ومسار التجهيز")}</span>
              <span
                style={{
                  fontSize: '11px',
                  padding: '1px 6px',
                  borderRadius: '999px',
                  background: viewMode === 'orders' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                  color: viewMode === 'orders' ? '#ffffff' : '#0f172a',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {counts?.all || 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('abandoned')}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: viewMode === 'abandoned' ? '2px solid #170e5e' : '1px solid #cbd5e1',
                background: viewMode === 'abandoned' ? '#170e5e' : '#ffffff',
                color: viewMode === 'abandoned' ? '#ffffff' : '#334155',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: viewMode === 'abandoned' ? '0 2px 6px rgba(23, 14, 94, 0.2)' : 'none',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span>{t('storefront.merchant_online_orders_page.s22', "السلات المتروكة (Abandoned Carts)")}</span>
              {(analyticsQuery.data?.unrecoveredAbandoned ?? 0) > 0 ? (
                <span
                  style={{
                    fontSize: '11px',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    background: viewMode === 'abandoned' ? '#ef4444' : '#fee2e2',
                    color: viewMode === 'abandoned' ? '#ffffff' : '#991b1b',
                    fontWeight: 800,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {analyticsQuery.data?.unrecoveredAbandoned}
                </span>
              ) : null}
            </button>
          </div>

          <button
            type="button"
            onClick={() => navigate('/settings/storefront')}
            style={{
              padding: '7px 14px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              color: '#170e5e',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <SlidersIcon size={14} color="#170e5e" />
            <span>تهيئة وهوية المتجر (Settings)</span>
          </button>
        </div>

        {/* Overview Tab: Institutional Dashboard & Catalog Insights */}
        {viewMode === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Realtime Quick Stats Banner */}
            <div
              style={{
                background: '#ffffff',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                padding: '16px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ borderInlineEnd: '1px solid #f1f5f9', paddingInlineEnd: '12px' }}>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, display: 'block' }}>مبيعات المتجر اليوم</span>
                <span style={{ fontSize: '22px', fontWeight: 900, color: '#16a34a', display: 'block', marginTop: '2px' }}>
                  {formatAmount(analyticsQuery.data?.todayRevenue || 0)} <span style={{ fontSize: '13px', fontWeight: 700 }}>{getGlobalCurrencySymbol()}</span>
                </span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  الطلبات اليومية: <strong>{analyticsQuery.data?.todayOrders || 0}</strong> طلبات
                </span>
              </div>

              <div style={{ borderInlineEnd: '1px solid #f1f5f9', paddingInlineEnd: '12px' }}>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, display: 'block' }}>طلبات بحاجة للمراجعة والتأكيد</span>
                <span style={{ fontSize: '22px', fontWeight: 900, color: (analyticsQuery.data?.pendingOrders || 0) > 0 ? '#b45309' : '#0f172a', display: 'block', marginTop: '2px' }}>
                  {analyticsQuery.data?.pendingOrders || 0} <span style={{ fontSize: '13px', fontWeight: 700 }}>طلب</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('orders');
                    setStatusFilter('pending');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#170e5e',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  عرض الطلبات المعلقة فوراً ←
                </button>
              </div>

              <div>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, display: 'block' }}>السلات المتروكة غير المستردة</span>
                <span style={{ fontSize: '22px', fontWeight: 900, color: (analyticsQuery.data?.unrecoveredAbandoned || 0) > 0 ? '#dc2626' : '#0f172a', display: 'block', marginTop: '2px' }}>
                  {analyticsQuery.data?.unrecoveredAbandoned || 0} <span style={{ fontSize: '13px', fontWeight: 700 }}>سلة</span>
                </span>
                <button
                  type="button"
                  onClick={() => setViewMode('abandoned')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#170e5e',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  استرداد المبيعات عبر واتساب ←
                </button>
              </div>
            </div>

            {/* Symmetrical 2-Column Insights Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '14px' }}>
              {/* Card 1: Top-Selling Online Products */}
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  padding: '16px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <TrendingUpIcon size={16} color="#16a34a" />
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>الأصناف الأكثر طلباً ومبيعاً أونلاين</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>أعلى 5 منتجات</span>
                </div>

                {(!analyticsQuery.data?.topSellingProducts || analyticsQuery.data.topSellingProducts.length === 0) ? (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
                    لا توجد بيانات مبيعات أونلاين مسجلة حتى الآن. ستظهر المنتجات الأكثر طلباً هنا تلقائياً عند ورود الطلبات.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {analyticsQuery.data.topSellingProducts.map((p, idx) => (
                      <div
                        key={p.productId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          background: '#f8fafc',
                          border: '1px solid #f1f5f9',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              width: '22px',
                              height: '22px',
                              borderRadius: '50%',
                              background: idx === 0 ? '#fef3c7' : idx === 1 ? '#e2e8f0' : '#f1f5f9',
                              color: idx === 0 ? '#b45309' : '#475569',
                              fontSize: '11px',
                              fontWeight: 800,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {idx + 1}
                          </span>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>{p.productName}</span>
                        </div>
                        <div style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 700, background: '#dcfce7', padding: '2px 6px', borderRadius: '4px' }}>
                            {p.quantity} مبيعات
                          </span>
                          <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#0f172a' }}>
                            {formatAmount(p.revenue)} {getGlobalCurrencySymbol()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Card 2: Low-Stock Storefront Alerts */}
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  padding: '16px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertTriangleIcon size={16} color="#d97706" />
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>تنبيهات نواقص مخزون المتجر</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#d97706', fontWeight: 700 }}>رصيد 5 قطع أو أقل</span>
                </div>

                {(!analyticsQuery.data?.lowStockStorefrontProducts || analyticsQuery.data.lowStockStorefrontProducts.length === 0) ? (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: '#16a34a', fontSize: '12px', fontWeight: 600 }}>
                    مخزون الأصناف المعروضة بالمتجر في حالة ممتازة ولا توجد نواقص حرجة حالياً.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {analyticsQuery.data.lowStockStorefrontProducts.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          background: '#fffbeb',
                          border: '1px solid #fef3c7',
                        }}
                      >
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', display: 'block' }}>{p.name}</span>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>
                            السعر: {formatAmount(p.price)} {getGlobalCurrencySymbol()}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: '4px',
                            background: p.stock <= 0 ? '#fef2f2' : '#fee2e2',
                            color: p.stock <= 0 ? '#b91c1c' : '#dc2626',
                            border: '1px solid #fecaca',
                          }}
                        >
                          {p.stock <= 0 ? 'نفد من المخزن' : `متبقي ${p.stock} فقط`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Card 3: Order Fulfillment Pipeline Kanban Cards */}
            <div
              style={{
                background: '#ffffff',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                padding: '16px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                  خط سير وتجهيز الطلبات (Fulfillment Pipeline)
                </span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  انقر على أي مرحلة للانتقال المباشر لجدول طلباتها
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                {[
                  { id: 'pending', label: 'جديد / قيد الانتظار', count: counts?.pending ?? 0, bg: '#fefce8', color: '#854d0e', border: '#fef08a' },
                  { id: 'confirmed', label: 'تم التأكيد', count: counts?.confirmed ?? 0, bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' },
                  { id: 'processing', label: 'جاري التجهيز', count: counts?.processing ?? 0, bg: '#f0f9ff', color: '#0369a1', border: '#bae6fd' },
                  { id: 'shipped', label: 'خرجت للتوصيل', count: counts?.shipped ?? 0, bg: '#fff7ed', color: '#c2410c', border: '#ffedd5' },
                  { id: 'delivered', label: 'مكتملة ومسلمة', count: counts?.delivered ?? 0, bg: '#f0fdf4', color: '#15803d', border: '#dcfce7' },
                ].map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => {
                      setViewMode('orders');
                      setStatusFilter(step.id);
                    }}
                    style={{
                      background: step.bg,
                      border: `1px solid ${step.border}`,
                      borderRadius: '8px',
                      padding: '10px 8px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'transform 0.1s ease',
                    }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 700, color: step.color, display: 'block', marginBottom: '4px' }}>
                      {step.label}
                    </span>
                    <span style={{ fontSize: '18px', fontWeight: 900, color: '#0f172a' }}>
                      {step.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {viewMode === 'orders' && (
        /* Main Orders Card: Filter Tabs + Table */
        <div
          className="card"
          style={{
            background: '#ffffff',
            borderRadius: '14px',
            border: '1px solid #e2e8f0',
            padding: '16px',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {/* Status Filter Tabs */}
          <div
            className="merchant-orders-status-tabs"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              paddingBottom: '8px',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            {[
              { id: 'all', label: t('storefront.merchant_online_orders_page.s23', "جميع الطلبات"), count: counts?.all },
              { id: 'pending', label: t('storefront.merchant_online_orders_page.s24', "قيد الانتظار (جديدة)"), count: counts?.pending },
              { id: 'confirmed', label: t('storefront.merchant_online_orders_page.s25', "تم التأكيد"), count: counts?.confirmed },
              { id: 'processing', label: t('storefront.merchant_online_orders_page.s26', "جاري التجهيز"), count: counts?.processing },
              { id: 'shipped', label: t('storefront.merchant_online_orders_page.s27', "خرجت للتوصيل"), count: counts?.shipped },
              { id: 'delivered', label: t('storefront.merchant_online_orders_page.s28', "مكتملة ومسلمة"), count: counts?.delivered },
              { id: 'cancelled', label: t('storefront.merchant_online_orders_page.s29', "ملغية"), count: counts?.cancelled },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.id);
                  setPage(1);
                }}
                style={{
                  padding: '7px 14px',
                  borderRadius: '999px',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  background: statusFilter === tab.id ? '#170e5e' : '#ffffff',
                  color: statusFilter === tab.id ? '#ffffff' : '#475569',
                  border: statusFilter === tab.id ? '1px solid #170e5e' : '1px solid #e2e8f0',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>{tab.label}</span>
                {typeof tab.count === 'number' && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      padding: '1px 6px',
                      borderRadius: '999px',
                      background: statusFilter === tab.id ? 'rgba(255, 255, 255, 0.25)' : '#f1f5f9',
                      color: statusFilter === tab.id ? '#ffffff' : '#64748b',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Orders Table */}
          <MerchantOrdersTable
            orders={orders}
            isLoading={ordersQuery.isLoading}
            onSelectOrder={setSelectedOrder}
            onConvertToDelivery={(order) => setDeliveryModalOrder(order)}
            onShipBosta={(order) => setBostaModalOrder(order)}
            onShipGcc={(order) => setGccModalOrder(order)}
            onLoadToPos={handleLoadToPos}
            loadingPosOrderId={loadingPosOrderId}
            onUpdateStatus={(id, status) => updateStatusMutation.mutate({ id, status })}
            isUpdatingStatus={updateStatusMutation.isPending}
            isBostaConfigured={isBostaConfigured}
            isGccConfigured={isGccConfigured}
          />

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '12px',
                borderTop: '1px solid #f1f5f9',
                marginTop: '4px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div style={{ fontSize: '12.5px', color: '#64748b' }}>
                {t('storefront.merchant_online_orders_page.s30', "عرض")} <strong>{((page - 1) * pageSize) + 1}</strong> {t('storefront.merchant_online_orders_page.s31', "إلى")} <strong>{Math.min(page * pageSize, totalFilteredCount)}</strong> {t('storefront.merchant_online_orders_page.s32', "من إجمالي")} <strong>{totalFilteredCount.toLocaleString()}</strong> {t('storefront.merchant_online_orders_page.s33', "طلب")}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: page <= 1 ? '#f8fafc' : '#ffffff',
                    color: page <= 1 ? '#94a3b8' : '#334155',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: page <= 1 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {t('storefront.merchant_online_orders_page.s34', "الصفحة السابقة")}
                </button>
                <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#170e5e', padding: '0 8px' }}>
                  {t('storefront.merchant_online_orders_page.s35', "صفحة")} {page} {t('storefront.merchant_online_orders_page.s36', "من")} {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: page >= totalPages ? '#f8fafc' : '#ffffff',
                    color: page >= totalPages ? '#94a3b8' : '#334155',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                  }}
                >
                  {t('storefront.merchant_online_orders_page.s37', "الصفحة التالية")}
                </button>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Abandoned Carts View */}
        {viewMode === 'abandoned' && (
          <div
            className="card"
            style={{
              background: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '16px',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                  {t('storefront.merchant_online_orders_page.s38', "السلات التي بدأ الزبائن بملئها ولم تكتمل")}
                </h3>
                <span style={{ fontSize: '11.5px', color: '#64748b' }}>
                  {t('storefront.merchant_online_orders_page.s39', "تواصل مع هؤلاء الزبائن عبر واتساب مباشرة لتحفيزهم على إتمام الشراء وتقديم خصم تشجيعي")}
                </span>
              </div>
              <span style={{ fontSize: '12px', color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '3px 10px', borderRadius: '6px', fontWeight: 700 }}>
                {t('storefront.merchant_online_orders_page.s40', "استرداد فوري بنقرة واحدة")}
              </span>
            </div>

            {abandonedQuery.isLoading ? (
              <div style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>{t('storefront.merchant_online_orders_page.s41', "جاري تحميل السلات المتروكة...")}</div>
            ) : !abandonedQuery.data?.carts || abandonedQuery.data.carts.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                  {t('storefront.merchant_online_orders_page.s42', "لا توجد سلات متروكة حالياً")}
                </div>
                <div style={{ fontSize: '12px' }}>
                  {t('storefront.merchant_online_orders_page.s43', "جميع العملاء الذين بدأوا الشراء أكملوا طلباتهم بنجاح")}
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#475569', textAlign: 'right' }}>
                      <th style={{ padding: '10px 12px' }}>{t('storefront.merchant_online_orders_page.s44', "تاريخ السلة")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('storefront.merchant_online_orders_page.s45', "بيانات العميل والهاتف")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('storefront.merchant_online_orders_page.s46', "الأصناف في السلة")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('storefront.merchant_online_orders_page.s47', "قيمة السلة")}</th>
                      <th style={{ padding: '10px 12px' }}>{t('storefront.merchant_online_orders_page.s48', "الحالة")}</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>{t('storefront.merchant_online_orders_page.s49', "إجراءات الاسترداد")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abandonedQuery.data.carts.map((cart: AbandonedCartRecord) => {
                      const phoneClean = cart.customerPhone.replace(/\D/g, '');
                      const countryDial = cart.countryCode === 'SA' ? '966' : cart.countryCode === 'AE' ? '971' : '20';
                      const fullIntlPhone = phoneClean.startsWith('0') ? `${countryDial}${phoneClean.slice(1)}` : phoneClean;
                      const itemsText = cart.items.map((i) => `${i.name} (×${i.quantity})`).join(t('storefront.merchant_online_orders_page.s50', "، "));
                      const waMessage = `مرحباً ${cart.customerName || t('storefront.merchant_online_orders_page.s51', "عزيزي العميل")}، لاحظنا اهتمامك بطلب الأصناف التالية من متجرنا: (${itemsText}). هل تود إتمام طلبك الآن وتأكيده؟ يسعدنا مساعدتك وتوصيل طلبك في أسرع وقت!`;
                      const waLink = `https://wa.me/${fullIntlPhone}?text=${encodeURIComponent(waMessage)}`;

                      return (
                        <tr key={cart.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 12px', color: '#64748b', fontSize: '11.5px', whiteSpace: 'nowrap' }}>
                            {new Date(cart.createdAt).toLocaleString(t('common.locale', 'en-US') === 'en-US' ? 'en-US' : 'ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{cart.customerName || t('storefront.merchant_online_orders_page.s52', "عميل المتجر")}</div>
                            <div style={{ fontFamily: 'monospace', direction: 'ltr', textAlign: 'right', fontSize: '12px', color: '#170e5e', fontWeight: 700 }}>
                              {cart.customerPhone} ({cart.countryCode})
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', maxWidth: '300px' }}>
                            <div style={{ fontSize: '12px', color: '#334155', lineHeight: 1.4 }}>
                              {cart.items.map((i: any, idx: number) => (
                                <span key={idx} style={{ display: 'inline-block', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px', margin: '2px', fontSize: '11px' }}>
                                  {i.name} × {i.quantity}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                            {formatAmount(cart.subtotal)} {getGlobalCurrencySymbol()}
                          </td>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                            {cart.recovered ? (
                              <span style={{ fontSize: '11px', color: '#166534', background: '#dcfce7', padding: '2px 7px', borderRadius: '4px', fontWeight: 700 }}>
                                {t('storefront.merchant_online_orders_page.s53', "تم الاسترداد والشراء")}
                              </span>
                            ) : (
                              <span style={{ fontSize: '11px', color: '#c2410c', background: '#ffedd5', padding: '2px 7px', borderRadius: '4px', fontWeight: 700 }}>
                                {t('storefront.merchant_online_orders_page.s54', "متروكة بانتظار المتابعة")}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              <a
                                href={waLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  padding: '5px 12px',
                                  borderRadius: '6px',
                                  background: '#16a34a',
                                  color: '#ffffff',
                                  fontSize: '11.5px',
                                  fontWeight: 700,
                                  textDecoration: 'none',
                                  boxShadow: '0 1px 3px rgba(22,163,74,0.25)',
                                }}
                              >
                                <MessageSquareIcon size={13} />
                                <span>{t('storefront.merchant_online_orders_page.s55', "استرداد عبر واتساب")}</span>
                              </a>
                              <button
                                type="button"
                                onClick={() => deleteAbandonedMutation.mutate(cart.id)}
                                title={t('storefront.merchant_online_orders_page.s56', "حذف من القائمة")}
                                style={{
                                  padding: '5px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid #fecaca',
                                  background: '#fef2f2',
                                  color: '#dc2626',
                                  cursor: 'pointer',
                                }}
                              >
                                <Trash2Icon size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Order Details Modal with 1-Click Convert to Sale */}
      <MerchantOrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onUpdateStatus={(id, status) => updateStatusMutation.mutate({ id, status })}
        isUpdatingStatus={updateStatusMutation.isPending}
        onConfirmPayment={(id, reference) => confirmPaymentMutation.mutate({ id, reference })}
        isConfirmingPayment={confirmPaymentMutation.isPending}
        onConvertToDelivery={(order) => {
          setSelectedOrder(null);
          setDeliveryModalOrder(order);
        }}
        onShipBosta={(order) => {
          setSelectedOrder(null);
          setBostaModalOrder(order);
        }}
        onShipGcc={(order) => {
          setSelectedOrder(null);
          setGccModalOrder(order);
        }}
        onLoadToPos={(orderId) => {
          setSelectedOrder(null);
          handleLoadToPos(orderId);
        }}
        loadingPosOrderId={loadingPosOrderId}
        isBostaConfigured={isBostaConfigured}
        isGccConfigured={isGccConfigured}
      />

      {/* Bosta Courier Express Modal */}
      {bostaModalOrder && (
        <BostaShipmentModal
          order={bostaModalOrder}
          onClose={() => setBostaModalOrder(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
            setSelectedOrder(null);
          }}
        />
      )}

      {/* GCC Courier Express Modal (Aramex / SMSA) */}
      {gccModalOrder && (
        <GccShipmentModal
          order={gccModalOrder}
          onClose={() => setGccModalOrder(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
            setSelectedOrder(null);
          }}
        />
      )}

      {/* Delivery Representative & Quick Convert Modal */}
      <ConvertDeliveryModal
        order={deliveryModalOrder}
        isOpen={Boolean(deliveryModalOrder)}
        onClose={() => setDeliveryModalOrder(null)}
        onSuccess={(data) => {
          queryClient.invalidateQueries({ queryKey: ['storefront-admin-orders'] });
          setSelectedOrder(null);
          setDeliveryModalOrder(null);
          if (data?.sale) {
            setCompletedSale(data.sale);
            setIsSuccessModalOpen(true);
          }
        }}
        onLoadToPos={handleLoadToPos}
      />

      {/* POS Success & Receipt Printing Dialog */}
      <PosSaleSuccessDialog
        open={isSuccessModalOpen && Boolean(completedSale)}
        sale={completedSale}
        customer={(completedSale as any)?.customer ? (completedSale as any).customer : { name: completedSale?.customerName || '', phone: (completedSale as any)?.customerPhone || '' } as any}
        settings={settings as any}
        onClose={() => {
          setIsSuccessModalOpen(false);
          setCompletedSale(null);
        }}
        onNewSale={() => {
          setIsSuccessModalOpen(false);
          setCompletedSale(null);
        }}
        onPrintReceipt={() => {
          if (completedSale) {
            printPostedSaleReceipt(completedSale, { pageSize: 'receipt', settings: settings as any });
          }
        }}
        onPrintA4={() => {
          if (completedSale) {
            printPostedSaleReceipt(completedSale, { pageSize: 'a4', settings: settings as any });
          }
        }}
      />
      {/* Bulk Cancel Modal Protected by Admin Password */}
      <StandardDialog
        open={isBulkCancelModalOpen}
        onClose={() => {
          if (!bulkCancelMutation.isPending) {
            setIsBulkCancelModalOpen(false);
            setAdminPassword('');
          }
        }}
        title={t('storefront.merchant_online_orders_page.s57', "إلغاء جماعي للطلبات المعلقة")}
        subtitle={t('storefront.merchant_online_orders_page.s58', "يتطلب إدخال كلمة مرور مسؤول النظام (Admin) لتأكيد الإلغاء")}
        width="480px"
        footerActions={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
            <button
              type="button"
              disabled={bulkCancelMutation.isPending}
              onClick={() => {
                setIsBulkCancelModalOpen(false);
                setAdminPassword('');
              }}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontSize: '13px',
                fontWeight: 700,
                cursor: bulkCancelMutation.isPending ? 'not-allowed' : 'pointer',
              }}
            >
              {t('storefront.merchant_online_orders_page.s59', "تراجع")}
            </button>
            <button
              type="button"
              disabled={bulkCancelMutation.isPending || !adminPassword.trim()}
              onClick={() => bulkCancelMutation.mutate()}
              style={{
                padding: '8px 18px',
                borderRadius: '8px',
                border: 'none',
                background: '#dc2626',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 700,
                cursor: (bulkCancelMutation.isPending || !adminPassword.trim()) ? 'not-allowed' : 'pointer',
                opacity: (bulkCancelMutation.isPending || !adminPassword.trim()) ? 0.6 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {bulkCancelMutation.isPending ? t('storefront.merchant_online_orders_page.s60', "جاري الإلغاء وفك الحجز...") : `تأكيد إلغاء ${pendingOrdersCount.toLocaleString()} طلب`}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '6px 0' }}>
          <div
            style={{
              background: '#fff1f2',
              border: '1px solid #fecdd3',
              borderRadius: '8px',
              padding: '12px 14px',
              color: '#9f1239',
              fontSize: '12.5px',
              lineHeight: 1.5,
            }}
          >
            <strong>{t('storefront.merchant_online_orders_page.s61', "تنبيه أمني وإداري:")}</strong> {t('storefront.merchant_online_orders_page.s62', "سيتم إلغاء كافة الطلبات ذات الحالة \"قيد الانتظار\" (")}{pendingOrdersCount.toLocaleString()} {t('storefront.merchant_online_orders_page.s63', "طلب) وإلغاء حجز المخزون الخاص بها فوراً. هذا الإجراء مخصص لمسؤولي المنشأة فقط ولا يُسمح للكاشير بتنفيذه.")}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
              {t('storefront.merchant_online_orders_page.s64', "كلمة مرور المسؤول (Admin Password)")} <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder={t('storefront.merchant_online_orders_page.s65', "أدخل كلمة مرور الأدمن للتأكيد...")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && adminPassword.trim() && !bulkCancelMutation.isPending) {
                  bulkCancelMutation.mutate();
                }
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1.5px solid #cbd5e1',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <span style={{ display: 'block', fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
              {t('storefront.merchant_online_orders_page.s66', "لن يتم قبول كلمة مرور الكاشير أو أي مستخدم لا يملك صلاحية مدير النظام (Admin).")}
            </span>
          </div>
        </div>
      </StandardDialog>
    </div>
  );
}
