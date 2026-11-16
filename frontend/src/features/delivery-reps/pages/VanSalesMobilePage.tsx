import { useTranslation } from 'react-i18next';
import { useState, useMemo, useEffect, useRef } from 'react';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { useQuery, useMutation } from '@tanstack/react-query';
import { vanSalesApi } from '../api/van-sales.api';
import { driverPortalApi } from '@/shared/api/delivery-reps.api';
import { Button } from '@/shared/ui/button';
import {
  TruckIcon,
  PackageIcon,
  MapPinIcon,
  ClockIcon,
  ReceiptIcon,
  RefreshCwIcon,
  CreditCardIcon,
  HomeIcon,
  ShoppingBagIcon,
} from '@/shared/components/icons/AppIcons';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import { vanOfflineDb } from '../offline/van-sales-offline.db';
import { vanSyncEngine } from '../offline/van-sync.engine';
import { VanSalesLogin } from '../components/VanSalesLogin';
import { VanCollectionReceiptModal } from '../components/VanCollectionReceiptModal';
import { VanCollectionReceiptData } from '../utils/van-collection-receipt.utils';
import { VanSettlementReceiptModal } from '../components/VanSettlementReceiptModal';
import { VanSettlementReceiptData } from '../utils/van-settlement-receipt.utils';
import { VanCollectionTab } from '../components/VanCollectionTab'; // live-synced
import { VanSettleTab } from '../components/VanSettleTab';
import { DriverNewLoadRequisitionView } from '../components/DriverNewLoadRequisitionView';
import { VanTripExpenseModal } from '../components/VanTripExpenseModal';
import { VanTripPackagingModal } from '../components/VanTripPackagingModal';
import { ActiveVisitBanner, ItineraryTab, GpsMandatoryModal, useVanVisit } from '@/features/delivery-reps/pages/van-sales-mobile/useVanVisit';
import {
  useVanTrip,
  TargetMetricsCard,
  KpiStrip,
} from '@/features/delivery-reps/pages/van-sales-mobile/useVanTrip';
import { useVanShell } from '@/features/delivery-reps/pages/van-sales-mobile/useVanShell';
import { CockpitTab, FleetTab, useVanCockpit } from '@/features/delivery-reps/pages/van-sales-mobile/useVanCockpit';
import { SaleTab, PreSalesTab, SalesHistoryTab, SaleCheckoutModal, SalesReceiptModal, useVanSale } from '@/features/delivery-reps/pages/van-sales-mobile/useVanSale';
import { InventoryTab, RequisitionsTab, TransferModal, DamagedSwapModal, useVanInventory } from '@/features/delivery-reps/pages/van-sales-mobile/useVanInventory';

export default function VanSalesMobilePage() {
  const { t: __t } = useTranslation();
  const {
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
  } = useVanShell();

  const [activeTab, setActiveTab] = useState<'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions'>('cockpit');
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [packagingModalOpen, setPackagingModalOpen] = useState(false);

  const [colCustomerId, setColCustomerId] = useState<number | ''>('');
  const [colAmount, setColAmount] = useState<string>('');
  const [colSubMode, setColSubMode] = useState<'collection' | 'return'>('collection');
  const [colReturnCustomerId, setColReturnCustomerId] = useState<number | ''>('');

  const [countedCash, setCountedCash] = useState<string>('');
  const [unloadRemaining, setUnloadRemaining] = useState<boolean>(true);
  const [lastCollectionReceipt, setLastCollectionReceipt] = useState<VanCollectionReceiptData | null>(null);
  const [lastSettlementReceipt, setLastSettlementReceipt] = useState<VanSettlementReceiptData | null>(null);
  const { showFleetInCockpit, setShowFleetInCockpit } = useVanCockpit();
  const [isCollectionProcessing, setIsCollectionProcessing] = useState<boolean>(false);
  const isCollectionProcessingRef = useRef<boolean>(false);

  const recordCollectionMutation = useMutation({
    networkMode: 'always',
    mutationFn: async (payload: any) => {
      const isActuallyOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isActuallyOffline) {
        const cust = allAvailableCustomers.find((c) => Number(c.id) === Number(payload.customerId));
        const offRes = await vanOfflineDb.recordOfflineCollection({
          tripId: payload.tripId,
          customerId: payload.customerId,
          customerName: cust?.name || 'العميل',
          amount: payload.amount,
          note: payload.notes,
          gpsLat: payload.gpsLat,
          gpsLng: payload.gpsLng,
        });
        return {
          ok: true,
          receiptNo: offRes.docNo,
          amount: payload.amount,
          customerName: cust?.name || 'العميل',
          newBalance: Math.max(0, (cust?.balance || 0) - payload.amount),
          isOffline: true,
        };
      }

      try {
        return await vanSalesApi.recordCollection(payload);
      } catch (err: any) {
        const isNetworkErr =
          !err?.status ||
          err?.status === 0 ||
          err?.message?.toLowerCase().includes('failed to fetch');
        if (isNetworkErr) {
          const cust = allAvailableCustomers.find((c) => Number(c.id) === Number(payload.customerId));
          const offRes = await vanOfflineDb.recordOfflineCollection({
            tripId: payload.tripId,
            customerId: payload.customerId,
            customerName: cust?.name || 'العميل',
            amount: payload.amount,
            note: payload.notes,
            gpsLat: payload.gpsLat,
            gpsLng: payload.gpsLng,
          });
          return {
            ok: true,
            receiptNo: offRes.docNo,
            amount: payload.amount,
            customerName: cust?.name || 'العميل',
            newBalance: Math.max(0, (cust?.balance || 0) - payload.amount),
            isOffline: true,
          };
        }
        throw err;
      }
    },
    onSuccess: (res: any) => {
      vanOfflineDb.getPendingCount().then(setPendingSyncCount);
      if (res?.isOffline) {
        toast.success(`تم حفظ التحصيل أوفلاين #${res.receiptNo} بمبلغ ${res.amount} ${getGlobalCurrencySymbol()} وسيتم ترحيله آلياً.`);
      } else {
        showAlert('success', `تم تسجيل تحصيل ${res.amount} ${getGlobalCurrencySymbol()} من "${res.customerName}"، الرصيد المتبقي: ${res.newBalance} ${getGlobalCurrencySymbol()}`);
      }

      const matchedCust = allAvailableCustomers.find((c) => String(c.id) === String(colCustomerId));
      const amountNum = Number(res?.amount || colAmount || 0);
      const newBalNum = Number(res?.newBalance ?? Math.max(0, Number(matchedCust?.balance || 0) - amountNum));
      const prevBalNum = Number(res?.previousBalance ?? (matchedCust?.balance != null ? Number(matchedCust.balance) : (newBalNum + amountNum)));

      setLastCollectionReceipt({
        receiptNo: res?.receiptNo || `REC-${Date.now().toString().slice(-6)}`,
        amount: amountNum,
        previousBalance: prevBalNum,
        newBalance: newBalNum,
        customerName: res?.customerName || matchedCust?.name || 'العميل',
        customerPhone: matchedCust?.phone || '',
        customerCode: matchedCust?.customerCode || '',
        customerAddress: (matchedCust as any)?.district || (matchedCust as any)?.route || (matchedCust as any)?.address || '',
        repName: data?.trip?.repName || (session?.rep as any)?.name || 'مندوب التوزيع',
        vehiclePlate: data?.assignedVehicle?.plateNumber || data?.trip?.vehiclePlate || '',
        warehouseName: data?.trip?.sourceWarehouseName || '',
        date: new Date().toISOString(),
        isOffline: Boolean(res?.isOffline),
      });

      setColAmount('');
      setColCustomerId('');
      queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] });
      queryClient.invalidateQueries({ queryKey: ['driver-itinerary'] });
      queryClient.invalidateQueries({ queryKey: ['driver-sales-history'] });
    },
    onError: (err: any) => showAlert('error', err?.message || 'فشل تسجيل التحصيل'),
    onSettled: () => {
      isCollectionProcessingRef.current = false;
      setIsCollectionProcessing(false);
    },
  });

  // INV-VAN-COLLECTION-GUARD-CONTINUATION: the collection submit body,
  // extracted so the visit guard can pass it as handleStartVisit's
  // onSuccess continuation instead of discarding the submit. It
  // deliberately performs NO visit check of its own: the flag-OFF
  // branch calls onSuccess synchronously, before React re-renders, so
  // a re-check here would still see activeVisit === null and refuse
  // again. The caller (onSubmitCollection) owns the busy/validation/
  // visit gates; this runs only after they pass or via the visit
  // continuation.
  const submitCollection = async () => {
    if (!data?.trip) return;
    isCollectionProcessingRef.current = true;
    setIsCollectionProcessing(true);

    const clientTxId = `van_col_${data.trip.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    let gpsLat: number | undefined;
    let gpsLng: number | undefined;
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3500, enableHighAccuracy: true });
        });
        gpsLat = pos.coords.latitude;
        gpsLng = pos.coords.longitude;
      } catch {}
    }
    try {
      recordCollectionMutation.mutate({
        tripId: data.trip.id,
        clientTxId,
        customerId: Number(colCustomerId),
        amount: Number(colAmount),
        gpsLat: gpsLat || activeVisit?.latitude,
        gpsLng: gpsLng || activeVisit?.longitude,
      });
    } catch (err) {
      isCollectionProcessingRef.current = false;
      setIsCollectionProcessing(false);
    }
  };

  const settleTripMutation = useMutation({
    mutationFn: vanSalesApi.settleTrip,
    onSuccess: (res) => {
      const isBlind = Boolean(data?.isBlindSettlement);
      if (isBlind) {
        showAlert('success', 'تم إغلاق وتصفية رحلة التوزيع بنجاح وتسليم النقدية الفعلية للخزينة للمطابقة الرقابية!');
      } else {
        showAlert('success', `تم إغلاق وتصفية رحلة التوزيع بنجاح! عجز/زيادة الكاش: ${res.variance} ${getGlobalCurrencySymbol()}`);
      }
      setCountedCash('');
      setActiveTab('cockpit');
      handleEndVisit();
      queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] });
      queryClient.invalidateQueries({ queryKey: ['driver-itinerary'] });
      queryClient.invalidateQueries({ queryKey: ['driver-fuel-logs'] });

      // Automatically launch Cash Handover Clearance Certificate Modal
      const receiptData: VanSettlementReceiptData = {
        tripId: res.tripId,
        receiptNo: `SETTLE-TRIP-${res.tripId}`,
        repName: res.repName || session?.rep?.name || 'مندوب التوزيع',
        repPhone: session?.rep?.phone || undefined,
        cashierName: res.cashierName || 'أمين الخزينة',
        vehiclePlate: data?.trip?.vehiclePlate || undefined,
        warehouseName: data?.trip?.sourceWarehouseName || undefined,
        settledAt: res.settledAt || new Date().toISOString(),
        salesAmount: res.salesAmount ?? Number(data?.trip?.salesAmount || 0),
        cashSales: res.cashSales ?? Math.max(0, Number(data?.trip?.salesAmount || 0) - Number(data?.trip?.creditSales || 0)),
        creditSales: res.creditSales ?? Number(data?.trip?.creditSales || 0),
        collectionsTotal: res.collectionsTotal ?? Number(data?.trip?.cashCollected || 0),
        returnsAmount: res.returnsAmount ?? Number(data?.trip?.returnsAmount || 0),
        cashRefunds: res.cashRefunds ?? Number(data?.trip?.cashRefunds || 0),
        creditReturns: res.creditReturns ?? 0,
        tripExpenses: res.tripExpenses ?? 0,
        expectedCash: res.expectedCash,
        countedCash: res.countedCash,
        variance: res.variance,
        stockVarianceAmount: res.stockVarianceAmount ?? 0,
        unloadedItemsCount: res.unloadedItemsCount ?? 0,
        distanceKm: res.distanceKm,
        stockVariances: res.stockVariances as any,
      };
      setLastSettlementReceipt(receiptData);
    },
    onError: (err: any) => showAlert('error', err?.message || 'فشل تصفية الرحلة'),
  });

  const {
    data, isLoading, refetch,
    myRequisitions, itinerary, isItineraryLoading, refetchItinerary,
    fuelLogs, refetchFuelLogs, maintenanceAlerts, peerTransfers, refetchTransfers, peerReps,
    tripExpensesList, tripPackagingList, refetchTripExpenses, refetchTripPackaging,
    isGlobalRefreshing, handleManualSync, handleGlobalRefresh,
    isTargetMetricsExpanded, setIsTargetMetricsExpanded,
    startTripMutation, totalInventoryValue, vehicle,
  } = useVanTrip({ session, setSession, isOnline, queryClient, showAlert, setIsSyncing, setPendingSyncCount, setActiveTab });

  const currentTab = useMemo(() => {
    if (data?.hasActiveTrip && activeTab === 'cockpit') return 'sale';
    return activeTab;
  }, [data?.hasActiveTrip, activeTab]);
  const visit = useVanVisit({ session, data });
  const { activeVisit, handleStartVisit, handleEndVisit } = visit;
  const sale = useVanSale({
    session,
    queryClient,
    setPendingSyncCount,
    showAlert,
    data,
    itinerary,
    activeVisit,
    handleEndVisit,
  });
  const {
    selectedCustomerId,
    setSelectedCustomerId,
    setNewCustomerName,
    cart,
    addToCart,
    updateCartQty,
    allAvailableCustomers,
    cartTotal,
  } = sale;
  const inv = useVanInventory({ data });
  const { setInventorySubMode } = inv;

  if (!session) {
    return <VanSalesLogin onLoginSuccess={(sess) => { setSession(sess); queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] }); }} />;
  }

  if (viewMode === 'new-requisition') {
    return (
      <DriverNewLoadRequisitionView
        onBack={() => setViewMode('dashboard')}
        onRequisitionSubmitted={(docNo: string) => {
          showAlert('success', `تم إرسال طلب إذن التحميل #${docNo} للمشرف بنجاح!`);
          setViewMode('dashboard');
          refetch();
          queryClient.invalidateQueries({ queryKey: ['driver-my-requisitions'] });
        }}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px) * 0.8)', fontFamily: 'inherit', overflowX: 'clip' }} dir="rtl">
      {/* Responsive Styles for Mobile vs Desktop */}
      <style>{`
        @media (max-width: 640px) {
          .van-erp-link { display: none !important; }
        }
        @media (max-width: 767px) {
          .van-top-nav-tabs { display: none !important; }
          .van-bottom-nav { display: flex !important; }
        }
        @media (min-width: 768px) {
          .van-top-nav-tabs { display: flex !important; }
          .van-bottom-nav { display: none !important; }
        }
        @keyframes vanSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Top Header - Clean Enterprise SaaS White Header */}
      <header
        style={{
          backgroundColor: '#ffffff',
          color: '#0f172a',
          paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))',
          paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
          paddingBottom: '8px',
          paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
          borderBottom: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          transform: 'translateZ(0)',
          WebkitTransform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <TruckIcon size={14} color="#170e5e" />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1
              style={{
                margin: 0,
                fontSize: '13px',
                fontWeight: 800,
                color: '#0f172a',
                lineHeight: 1.3,
                WebkitFontSmoothing: 'antialiased',
                textRendering: 'optimizeLegibility',
              }}
            >
              {__t('delivery_reps.van_sales_mobile_page.s0', __t('delivery_reps.van_sales_mobile_page.s0', "مبيعات وتوزيع الفان"))}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session.rep?.fullName || session.rep?.name || __t('delivery_reps.van_sales_mobile_page.s1', __t('delivery_reps.van_sales_mobile_page.s1', "المندوب"))} • {vehicle?.plate ? `سيارة [${vehicle.plate}]` : __t('delivery_reps.van_sales_mobile_page.s2', __t('delivery_reps.van_sales_mobile_page.s2', "الميدان"))}
              </span>
              <span
                onClick={() => window.location.reload()}
                title={__t('delivery_reps.van_sales_mobile_page.s3', __t('delivery_reps.van_sales_mobile_page.s3', "رقم إصدار البيلد - انقر للتحديث الفوري"))}
                style={{
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  color: '#475569',
                  borderRadius: '4px',
                  padding: '0 4px',
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev'}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <a
            href="/inventory/van-sales"
            title={__t('delivery_reps.van_sales_mobile_page.s4', __t('delivery_reps.van_sales_mobile_page.s4', "الانتقال إلى لوحة إدارة المشرف والأسطول المركزية"))}
            className="van-erp-link"
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#170e5e',
              borderRadius: '6px',
              padding: '0 6px',
              height: '26px',
              fontSize: '10px',
              textDecoration: 'none',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              whiteSpace: 'nowrap',
            }}
          >
            {__t('delivery_reps.van_sales_mobile_page.s5', __t('delivery_reps.van_sales_mobile_page.s5', "لوحة الإدارة (ERP)"))}
          </a>
          <button
            type="button"
            onClick={handleGlobalRefresh}
            disabled={isGlobalRefreshing}
            title={__t('delivery_reps.van_sales_mobile_page.s6', __t('delivery_reps.van_sales_mobile_page.s6', "تحديث البيانات"))}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#0f172a',
              borderRadius: '6px',
              height: '26px',
              padding: '0 6px',
              fontSize: '10px',
              cursor: isGlobalRefreshing ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              opacity: isGlobalRefreshing ? 0.7 : 1,
            }}
          >
            <RefreshCwIcon
              size={11}
              color="#170e5e"
              style={{ animation: isGlobalRefreshing ? 'vanSpin 0.8s linear infinite' : 'none' }}
            />
            <span>{isGlobalRefreshing ? __t('delivery_reps.van_sales_mobile_page.s7', __t('delivery_reps.van_sales_mobile_page.s7', "جاري...")) : __t('delivery_reps.van_sales_mobile_page.s8', __t('delivery_reps.van_sales_mobile_page.s8', "تحديث"))}</span>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            title={__t('delivery_reps.van_sales_mobile_page.s9', __t('delivery_reps.van_sales_mobile_page.s9', "تسجيل الخروج"))}
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#475569',
              borderRadius: '6px',
              height: '26px',
              padding: '0 6px',
              fontSize: '10px',
              cursor: 'pointer',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {__t('delivery_reps.van_sales_mobile_page.s10', __t('delivery_reps.van_sales_mobile_page.s10', "خروج"))}
          </button>
        </div>
      </header>

      {/* Offline & Sync Status Banner */}
      {(!isOnline || pendingSyncCount > 0) && (
        <div
          style={{
            backgroundColor: !isOnline ? '#fffbeb' : '#eff6ff',
            borderBottom: `1px solid ${!isOnline ? '#fde68a' : '#bfdbfe'}`,
            padding: '8px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            fontWeight: 700,
            color: !isOnline ? '#b45309' : '#1e40af',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: !isOnline ? '#f59e0b' : '#3b82f6',
                display: 'inline-block',
              }}
            />
            <span>
              {!isOnline
                ? __t('delivery_reps.van_sales_mobile_page.s11', __t('delivery_reps.van_sales_mobile_page.s11', "وضع عدم الاتصال (أوفلاين) • فواتيرك تُحفظ محلياً وتُطبع فوراً"))
                : `تم الاتصال بالإنترنت • يوجد ${pendingSyncCount} عمليات جاهزة للمزامنة`}
            </span>
            {pendingSyncCount > 0 && (
              <span
                style={{
                  backgroundColor: !isOnline ? '#fef3c7' : '#dbeafe',
                  color: !isOnline ? '#92400e' : '#1e3a8a',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 800,
                }}
              >
                {pendingSyncCount} {__t('delivery_reps.van_sales_mobile_page.s12', __t('delivery_reps.van_sales_mobile_page.s12', "معلقة"))}
              </span>
            )}
          </div>
          {isOnline && pendingSyncCount > 0 && (
            <button
              type="button"
              onClick={handleManualSync}
              disabled={isSyncing}
              style={{
                backgroundColor: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <RefreshCwIcon size={12} color="#ffffff" style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }} />
              {isSyncing ? __t('delivery_reps.van_sales_mobile_page.s13', __t('delivery_reps.van_sales_mobile_page.s13', "جاري المزامنة...")) : __t('delivery_reps.van_sales_mobile_page.s14', __t('delivery_reps.van_sales_mobile_page.s14', "مزامنة الآن"))}
            </button>
          )}
        </div>
      )}

      {/* Alert Banner */}
      {alert && (
        <div
          style={{
            backgroundColor:
              alert.type === 'success'
                ? '#10b981'
                : alert.type === 'warning'
                ? '#f59e0b'
                : alert.type === 'info'
                ? '#3b82f6'
                : '#ef4444',
            color: '#ffffff',
            padding: '10px 16px',
            fontSize: '12.5px',
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          {alert.message}
        </div>
      )}

      {/* Active Customer Visit Running Timer Banner */}
      <ActiveVisitBanner
        visit={visit}
        currentTab={currentTab}
        setActiveTab={setActiveTab}
        setSelectedCustomerId={setSelectedCustomerId}
      />

      {/* Main Container */}
      <main style={{ padding: '8px 10px 85px', maxWidth: '1280px', width: '100%', margin: '0 auto', boxSizing: 'border-box', minWidth: 0 }}>
        <TargetMetricsCard data={data} isTargetMetricsExpanded={isTargetMetricsExpanded} setIsTargetMetricsExpanded={setIsTargetMetricsExpanded} />
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontWeight: 700 }}>{__t('delivery_reps.van_sales_mobile_page.s52', __t('delivery_reps.van_sales_mobile_page.s52', "جاري تحميل بيانات رحلة الفان..."))}</div>
        ) : (
          <>
            <KpiStrip data={data} />
            {/* Navigation Tabs Bar - Visible only on Desktop/Tablet, hidden on Mobile where Bottom Navigation is used */}
            <div className="van-top-nav-tabs" style={{ display: 'flex', backgroundColor: '#e2e8f0', padding: '4px', borderRadius: '10px', marginBottom: '14px', fontSize: '11.5px', fontWeight: 600, overflowX: 'auto', gap: '3px' }}>
              {data?.hasActiveTrip ? (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveTab('itinerary')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'itinerary' ? '#170e5e' : 'transparent',
                      color: currentTab === 'itinerary' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s58', __t('delivery_reps.van_sales_mobile_page.s58', "خط السير"))} {itinerary.length > 0 && `(${itinerary.filter((i) => i.visitStatus !== 'pending').length}/${itinerary.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('inventory')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'inventory' ? '#170e5e' : 'transparent',
                      color: currentTab === 'inventory' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s59', __t('delivery_reps.van_sales_mobile_page.s59', "بضاعة السيارة ("))}{data.inventory.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sale')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'sale' ? '#170e5e' : 'transparent',
                      color: currentTab === 'sale' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s60', __t('delivery_reps.van_sales_mobile_page.s60', "فاتورة بيع"))} {cart.length > 0 && `(${cart.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('pre-sales')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'pre-sales' ? '#170e5e' : 'transparent',
                      color: currentTab === 'pre-sales' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s61', __t('delivery_reps.van_sales_mobile_page.s61', "حجز من المخزن"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sales-history')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'sales-history' ? '#170e5e' : 'transparent',
                      color: currentTab === 'sales-history' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s62', __t('delivery_reps.van_sales_mobile_page.s62', "سجل الفواتير"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('collection')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'collection' ? '#170e5e' : 'transparent',
                      color: currentTab === 'collection' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s63', __t('delivery_reps.van_sales_mobile_page.s63', "تحصيل / مرتجع"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('fleet')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'fleet' ? '#170e5e' : 'transparent',
                      color: currentTab === 'fleet' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      position: 'relative',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s64', __t('delivery_reps.van_sales_mobile_page.s64', "السيارة والوقود"))}
                    {maintenanceAlerts.some((a) => a.severity === 'critical') && (
                      <span
                        style={{
                          display: 'inline-block',
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: '#ef4444',
                          marginRight: '4px',
                        }}
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('settle')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'settle' ? '#170e5e' : 'transparent',
                      color: currentTab === 'settle' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s65', __t('delivery_reps.van_sales_mobile_page.s65', "تصفية اليومية"))}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveTab('cockpit')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'cockpit' ? '#170e5e' : 'transparent',
                      color: currentTab === 'cockpit' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s66', __t('delivery_reps.van_sales_mobile_page.s66', "مركز القيادة"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('itinerary')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'itinerary' ? '#170e5e' : 'transparent',
                      color: currentTab === 'itinerary' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s67', __t('delivery_reps.van_sales_mobile_page.s67', "خط السير"))} {itinerary.length > 0 && `(${itinerary.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('inventory')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'inventory' ? '#170e5e' : 'transparent',
                      color: currentTab === 'inventory' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s68', __t('delivery_reps.van_sales_mobile_page.s68', "المخزون والشحن"))} {data?.inventory?.length ? `(${data.inventory.length})` : '(0)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sale')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'sale' ? '#170e5e' : 'transparent',
                      color: currentTab === 'sale' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s69', __t('delivery_reps.van_sales_mobile_page.s69', "فاتورة بيع"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('pre-sales')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'pre-sales' ? '#170e5e' : 'transparent',
                      color: currentTab === 'pre-sales' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s70', __t('delivery_reps.van_sales_mobile_page.s70', "حجز من المخزن"))}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sales-history')}
                    style={{
                      flex: 1,
                      minWidth: '70px',
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: currentTab === 'sales-history' ? '#170e5e' : 'transparent',
                      color: currentTab === 'sales-history' ? '#ffffff' : '#475569',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s71', __t('delivery_reps.van_sales_mobile_page.s71', "سجل الفواتير"))}
                  </button>
                </>
              )}
            </div>

            {!data?.hasActiveTrip && currentTab === 'cockpit' && (
              <CockpitTab
                showFleetInCockpit={showFleetInCockpit}
                setShowFleetInCockpit={setShowFleetInCockpit}
                data={data}
                fuelLogs={fuelLogs}
                itinerary={itinerary}
                maintenanceAlerts={maintenanceAlerts}
                myRequisitions={myRequisitions}
                refetch={refetch}
                refetchFuelLogs={refetchFuelLogs}
                startTripMutation={startTripMutation}
                totalInventoryValue={totalInventoryValue}
                vehicle={vehicle}
                setViewMode={setViewMode}
                setActiveTab={setActiveTab}
                setInventorySubMode={setInventorySubMode}
              />
            )}
            {currentTab === 'itinerary' && (
              <ItineraryTab
                visit={visit}
                data={data}
                itinerary={itinerary}
                isItineraryLoading={isItineraryLoading}
                refetchItinerary={refetchItinerary}
                queryClient={queryClient}
                allAvailableCustomers={allAvailableCustomers}
                setSelectedCustomerId={setSelectedCustomerId}
                setNewCustomerName={setNewCustomerName}
                setColCustomerId={setColCustomerId}
                setColSubMode={setColSubMode}
                setColReturnCustomerId={setColReturnCustomerId}
                setActiveTab={setActiveTab}
              />
            )}
            {currentTab === 'inventory' && (
              <InventoryTab
                inv={inv}
                data={data}
                myRequisitions={myRequisitions}
                peerTransfers={peerTransfers}
                cart={cart}
                cartTotal={cartTotal}
                addToCart={addToCart}
                updateCartQty={updateCartQty}
                setActiveTab={setActiveTab}
                queryClient={queryClient}
                setViewMode={setViewMode}
                showAlert={showAlert}
              />
            )}

            {currentTab === 'fleet' && (
              <FleetTab
                vehicle={vehicle}
                data={data}
                maintenanceAlerts={maintenanceAlerts}
                fuelLogs={fuelLogs}
                refetch={refetch}
                refetchFuelLogs={refetchFuelLogs}
                setActiveTab={setActiveTab}
              />
            )}
            {currentTab === 'requisitions' && (
              <RequisitionsTab
                inv={inv}
                myRequisitions={myRequisitions}
                setActiveTab={setActiveTab}
                queryClient={queryClient}
                setViewMode={setViewMode}
                showAlert={showAlert}
              />
            )}
            {currentTab === 'sale' && (
              <SaleTab
                sale={sale}
                data={data}
                startTripMutation={startTripMutation}
                activeVisit={activeVisit}
                handleStartVisit={handleStartVisit}
                session={session}
                showAlert={showAlert}
                setActiveTab={setActiveTab}
              />
            )}
            {currentTab === 'pre-sales' && (
              <PreSalesTab sale={sale} activeVisit={activeVisit} handleStartVisit={handleStartVisit} session={session} />
            )}
            {currentTab === 'sales-history' && (
              <SalesHistoryTab sale={sale} data={data} setActiveTab={setActiveTab} />
            )}

            {/* TAB CONTENT: COLLECTION */}
            {currentTab === 'collection' && (
              data?.hasActiveTrip ? (
                <VanCollectionTab
                  tripId={data.trip!.id}
                  customers={allAvailableCustomers}
                  inventory={data?.inventory || []}
                  colCustomerId={colCustomerId}
                  onColCustomerChange={setColCustomerId}
                  colAmount={colAmount}
                  onColAmountChange={setColAmount}
                  initialSubMode={colSubMode}
                  initialReturnCustomerId={colReturnCustomerId}
                  onSubmitCollection={async () => {
                    if (isCollectionProcessingRef.current || recordCollectionMutation.isPending) {
                      return;
                    }
                    if (!colCustomerId || !Number(colAmount)) {
                      showAlert('error', __t('delivery_reps.van_sales_mobile_page.s174', __t('delivery_reps.van_sales_mobile_page.s174', "يرجى اختيار العميل وإدخال مبلغ التحصيل")));
                      return;
                    }
                    if (colCustomerId && (!activeVisit || activeVisit.customerId !== Number(colCustomerId))) {
                      const cust = allAvailableCustomers.find((c) => c.id === Number(colCustomerId));
                      // INV-VAN-COLLECTION-GUARD-CONTINUATION: the submit
                      // is passed as handleStartVisit's onSuccess — the
                      // old code started the visit and discarded the
                      // submit, so the first attempt after every sale
                      // (which auto-ends the visit) never recorded.
                      // The GPS warning shows only when GPS is actually
                      // mandatory for this rep (flag !== false).
                      if (session?.rep?.permissions?.require_gps_on_visit !== false) {
                        showAlert('warning', `يلزم تفعيل الـ GPS وبدء زيارة العميل "${cust?.name || ''}" أولاً لتسجيل سند التحصيل.`);
                      }
                      if (cust) {
                        handleStartVisit(Number(colCustomerId), cust.name, () => {
                          void submitCollection();
                        });
                      }
                      return;
                    }

                    await submitCollection();
                  }}
                  isSubmitting={isCollectionProcessing || recordCollectionMutation.isPending}
                  onReturnSuccess={(docNo, amount) => {
                    showAlert('success', `تم رفع إذن المرتجع #${docNo} بقيمة ${amount.toFixed(2)} ${getGlobalCurrencySymbol()} للإدارة بنجاح`);
                  }}
                />
              ) : (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '36px 20px', textAlign: 'center' }}>
                  <div style={{ width: '56px', height: '56px', backgroundColor: '#ecfdf5', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                    <ReceiptIcon size={28} color="#059669" />
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>{__t('delivery_reps.van_sales_mobile_page.s175', __t('delivery_reps.van_sales_mobile_page.s175', "تحصيل المديونيات والمرتجعات"))}</h3>
                  <p style={{ fontSize: '12.5px', color: '#64748b', margin: '0 auto 16px', maxWidth: '380px', lineHeight: 1.5 }}>
                    {__t('delivery_reps.van_sales_mobile_page.s176', __t('delivery_reps.van_sales_mobile_page.s176', "لبدء تسجيل سندات القبض والتحصيل النقدي من العملاء، يرجى بدء رحلة التوزيع أولاً."))}
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => startTripMutation.mutate()}
                    disabled={startTripMutation.isPending}
                    style={{ backgroundColor: '#170e5e', color: '#ffffff', fontSize: '12.5px', fontWeight: 800 }}
                  >
                    {startTripMutation.isPending ? __t('delivery_reps.van_sales_mobile_page.s177', __t('delivery_reps.van_sales_mobile_page.s177', "جاري بدء الرحلة...")) : __t('delivery_reps.van_sales_mobile_page.s178', __t('delivery_reps.van_sales_mobile_page.s178', "بدء رحلة التوزيع الآن"))}
                  </Button>
                </div>
              )
            )}

            {/* TAB CONTENT: SETTLE (Active Trip Only) */}
            {currentTab === 'settle' && (
              data?.hasActiveTrip ? (
                <VanSettleTab
                  tripData={data.trip}
                  activeVisit={activeVisit}
                  sales={data.sales || []}
                  collections={data.collections || []}
                  returns={data.returns || []}
                  expenses={tripExpensesList}
                  packagingMovements={tripPackagingList}
                  onOpenExpenseModal={() => setExpenseModalOpen(true)}
                  onOpenPackagingModal={() => setPackagingModalOpen(true)}
                  inventory={data.inventory || []}
                  countedCash={countedCash}
                  onCountedCashChange={setCountedCash}
                  unloadRemaining={unloadRemaining}
                  onUnloadRemainingChange={setUnloadRemaining}
                  requireSupervisorPin={Boolean(data?.requireSupervisorPinForSettlement)}
                  isBlindSettlement={Boolean(data?.isBlindSettlement)}
                  onSubmitSettle={async (
                    supervisorPin?: string,
                    countedStock?: { productId: number; countedQty: number }[],
                    nightStockApproved?: boolean,
                  ) => {
                    const isBlind = Boolean(data?.isBlindSettlement);
                    const expectedToRemit = Number((data.trip as any)?.expectedCashToRemit ?? data.trip?.cashCollected ?? 0);
                    const finalCountedCash = isBlind ? countedCash : (countedCash === '' ? (expectedToRemit === 0 ? '0' : '') : countedCash);
                    if (finalCountedCash === '') {
                      showAlert('error', __t('delivery_reps.van_sales_mobile_page.s179', __t('delivery_reps.van_sales_mobile_page.s179', "يرجى جرد وإدخال النقدية الفعلية الموجودة معك للتوريد")));
                      return;
                    }

                    // Security Invariant: Outbox Zero-Debt Settlement Gate
                    // Block trip settlement if there are unsynced sales or collections in local storage
                    try {
                      const pendingOutbox = await vanOfflineDb.getPendingOutbox();
                      if (pendingOutbox && pendingOutbox.length > 0) {
                        showAlert('warning', `توجد ${pendingOutbox.length} حركة مبيعات أو تحصيل معلقة في ذاكرة الهاتف. جاري محاولة المزامنة مع السيرفر أولاً...`);
                        await vanSyncEngine.syncAll();
                        const remaining = await vanOfflineDb.getPendingOutbox();
                        if (remaining && remaining.length > 0) {
                          showAlert('error', `تعذر إتمام التصفية: توجد ${remaining.length} حركة بيع أو تحصيل معلقة لم يتم ترحيلها للسيرفر بعد. يرجى التأكد من اتصال الإنترنت ثم الضغط على "مزامنة العمليات المعلقة" قبل تسليم العهدة.`);
                          return;
                        }
                        showAlert('success', __t('delivery_reps.van_sales_mobile_page.s180', __t('delivery_reps.van_sales_mobile_page.s180', "تمت مزامنة العمليات المعلقة بنجاح، جاري استكمال تصفية اليومية...")));
                      }
                    } catch (err) {
                      console.warn('[SettlementGate] Outbox verification error:', err);
                    }

                    const activeCustId = activeVisit?.customerId;
                    // INV-VAN-SELF-SETTLE-PIN-REQUIRED: the rep's phone
                    // never sends chargeStockVarianceToRep — the backend
                    // treats a driver-path shortage as pending until a
                    // supervisor decides from the admin side.
                    // nightStockApproved is the supervisor's explicit
                    // approval (authorized by the PIN) to keep stock
                    // in the van overnight; without it the backend
                    // refuses the settlement when stock remains.
                    settleTripMutation.mutate({
                      tripId: data.trip!.id,
                      countedCash: Number(finalCountedCash),
                      unloadRemainingToWarehouse: unloadRemaining,
                      countedStock,
                      nightStockApproved,
                      activeVisitCustomerId: activeCustId,
                      supervisorPin,
                    });
                  }}
                  isSubmitting={settleTripMutation.isPending}
                />
              ) : (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '36px 20px', textAlign: 'center' }}>
                  <div style={{ width: '56px', height: '56px', backgroundColor: '#fef3c7', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                    <ClockIcon size={28} color="#d97706" />
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>{__t('delivery_reps.van_sales_mobile_page.s181', __t('delivery_reps.van_sales_mobile_page.s181', "تصفية اليومية وإغلاق العهدة"))}</h3>
                  <p style={{ fontSize: '12.5px', color: '#64748b', margin: '0 auto 16px', maxWidth: '380px', lineHeight: 1.5 }}>
                    {__t('delivery_reps.van_sales_mobile_page.s182', __t('delivery_reps.van_sales_mobile_page.s182', "لا توجد رحلة توزيع مفتوحة لتصفيتها حالياً. يتم فتح هذا القسم بعد انطلاق الرحلة لتسليم النقدية ومطابقة العهدة المسائية."))}
                  </p>
                </div>
              )
            )}
          </>
        )}
      </main>

      <TransferModal
        inv={inv}
        data={data}
        peerReps={peerReps}
        peerTransfers={peerTransfers}
        refetch={refetch}
        refetchTransfers={refetchTransfers}
      />
      <SaleCheckoutModal sale={sale} data={data} session={session} />
      <SalesReceiptModal sale={sale} data={data} />

      {/* Field Collection Receipt Modal */}
      {lastCollectionReceipt && (
        <VanCollectionReceiptModal
          receipt={lastCollectionReceipt}
          onClose={() => setLastCollectionReceipt(null)}
          storeName={data?.trip?.sourceWarehouseName || __t('delivery_reps.van_sales_mobile_page.s184', __t('delivery_reps.van_sales_mobile_page.s184', "إدارة التوزيع والتحصيل الميداني"))}
        />
      )}

      {/* Cashier Handover Clearance Receipt Modal */}
      {lastSettlementReceipt && (
        <VanSettlementReceiptModal
          receipt={lastSettlementReceipt}
          onClose={() => setLastSettlementReceipt(null)}
          storeName={data?.trip?.sourceWarehouseName || __t('delivery_reps.van_sales_mobile_page.s185', __t('delivery_reps.van_sales_mobile_page.s185', "إدارة مبيعات وتوزيع الفان"))}
        />
      )}

      {/* Trip Operational Expenses Modal */}
      {data?.trip && expenseModalOpen && (
        <VanTripExpenseModal
          open={expenseModalOpen}
          onClose={() => setExpenseModalOpen(false)}
          tripId={data.trip.id}
          onSuccess={() => {
            refetch();
            refetchTripExpenses();
          }}
        />
      )}

      {/* Returnable Packaging Movements Modal */}
      {data?.trip && packagingModalOpen && (
        <VanTripPackagingModal
          open={packagingModalOpen}
          onClose={() => setPackagingModalOpen(false)}
          tripId={data.trip.id}
          customers={allAvailableCustomers}
          defaultCustomerId={selectedCustomerId ? Number(selectedCustomerId) : (activeVisit?.customerId || null)}
          onSuccess={() => {
            refetch();
            refetchTripPackaging();
          }}
        />
      )}
      <DamagedSwapModal
        inv={inv}
        data={data}
        allAvailableCustomers={allAvailableCustomers}
        selectedCustomerId={selectedCustomerId}
        activeVisit={activeVisit}
        refetch={refetch}
      />
      <GpsMandatoryModal visit={visit} />

      {/* Mobile Fixed Bottom Navigation Bar - Pinned Docked Standard with Curved Top Corners */}
      <nav
        dir="rtl"
        aria-label={__t('delivery_reps.van_sales_mobile_page.s186', __t('delivery_reps.van_sales_mobile_page.s186', "شريط الملاحة الميداني السريع للمندوب"))}
        className="van-bottom-nav"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          width: '100%',
          backgroundColor: '#ffffff',
          borderTopLeftRadius: '14px',
          borderTopRightRadius: '14px',
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          border: '1px solid #e2e8f0',
          borderBottom: 'none',
          boxShadow: '0 -2px 10px rgba(15, 23, 42, 0.05)',
          zIndex: 90,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            maxWidth: '520px',
            margin: '0 auto',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            paddingTop: '5px',
            paddingBottom: 'calc(3px + env(safe-area-inset-bottom, 0px) * 0.4)',
            paddingLeft: '4px',
            paddingRight: '4px',
            boxSizing: 'border-box',
          }}
        >
        {data?.hasActiveTrip ? (
          <>
            <button
              type="button"
              onClick={() => setActiveTab('itinerary')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'itinerary' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'itinerary' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <MapPinIcon size={14} color={currentTab === 'itinerary' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s187', __t('delivery_reps.van_sales_mobile_page.s187', "خط السير"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('sale')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: (currentTab === 'sale' || currentTab === 'sales-history') ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: (currentTab === 'sale' || currentTab === 'sales-history') ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  transition: 'none',
                }}
              >
                <ReceiptIcon size={14} color={(currentTab === 'sale' || currentTab === 'sales-history') ? '#170e5e' : '#64748b'} />
                {cart.length > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-3px',
                      right: '-4px',
                      backgroundColor: '#dc2626',
                      color: '#ffffff',
                      fontSize: '9px',
                      fontWeight: 900,
                      borderRadius: '6px',
                      padding: '0 3px',
                      lineHeight: '12px',
                      minWidth: '12px',
                      textAlign: 'center',
                    }}
                  >
                    {cart.length}
                  </span>
                )}
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s188', __t('delivery_reps.van_sales_mobile_page.s188', "فاتورة بيع"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pre-sales')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'pre-sales' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'pre-sales' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <ShoppingBagIcon size={14} color={currentTab === 'pre-sales' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s189', __t('delivery_reps.van_sales_mobile_page.s189', "طلبيات"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'inventory' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'inventory' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <PackageIcon size={14} color={currentTab === 'inventory' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s190', __t('delivery_reps.van_sales_mobile_page.s190', "المخزون"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('collection')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'collection' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'collection' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <CreditCardIcon size={14} color={currentTab === 'collection' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s191', __t('delivery_reps.van_sales_mobile_page.s191', "التحصيل"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('settle')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: (currentTab === 'settle' || currentTab === 'fleet') ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: (currentTab === 'settle' || currentTab === 'fleet') ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <ClockIcon size={14} color={(currentTab === 'settle' || currentTab === 'fleet') ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s192', __t('delivery_reps.van_sales_mobile_page.s192', "اليومية"))}</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setActiveTab('cockpit')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'cockpit' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'cockpit' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <HomeIcon size={14} color={currentTab === 'cockpit' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s193', __t('delivery_reps.van_sales_mobile_page.s193', "الرئيسية"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('itinerary')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'itinerary' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'itinerary' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <MapPinIcon size={14} color={currentTab === 'itinerary' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s194', __t('delivery_reps.van_sales_mobile_page.s194', "خط السير"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pre-sales')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'pre-sales' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'pre-sales' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <ShoppingBagIcon size={14} color={currentTab === 'pre-sales' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s195', __t('delivery_reps.van_sales_mobile_page.s195', "طلبيات"))}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                padding: '2px 0',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: currentTab === 'inventory' ? '#170e5e' : '#64748b',
                fontWeight: 600,
                fontSize: '10px',
                whiteSpace: 'nowrap',
                transition: 'none',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '18px',
                  borderRadius: '9px',
                  backgroundColor: currentTab === 'inventory' ? '#eef2ff' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <PackageIcon size={14} color={currentTab === 'inventory' ? '#170e5e' : '#64748b'} />
              </div>
              <span>{__t('delivery_reps.van_sales_mobile_page.s196', __t('delivery_reps.van_sales_mobile_page.s196', "المخزون"))}</span>
            </button>
          </>
        )}
        </div>
      </nav>
    </div>
  );
}
