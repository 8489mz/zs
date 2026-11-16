import { useTranslation } from 'react-i18next';
import { useState, useMemo } from 'react';
import {
  TruckIcon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';
import { VanSalesLogin } from '../components/VanSalesLogin';
import { DriverNewLoadRequisitionView } from '../components/DriverNewLoadRequisitionView';
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
import { CollectionTab, CollectionReceiptModal, useVanCollection } from '@/features/delivery-reps/pages/van-sales-mobile/useVanCollection';
import { SettleTab, SettlementReceiptModal, TripExpenseModal, TripPackagingModal, useVanSettle } from '@/features/delivery-reps/pages/van-sales-mobile/useVanSettle';
import { TopNav, BottomNav } from '@/features/delivery-reps/pages/van-sales-mobile/VanMobileNav';

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
  const { showFleetInCockpit, setShowFleetInCockpit } = useVanCockpit();

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
  const collection = useVanCollection({ session, queryClient, setPendingSyncCount, showAlert, data, allAvailableCustomers, activeVisit });
  const { setColCustomerId, setColSubMode, setColReturnCustomerId } = collection;
  const settle = useVanSettle({
    session,
    queryClient,
    showAlert,
    data,
    setActiveTab,
    handleEndVisit,
  });

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
            <TopNav
              currentTab={currentTab}
              setActiveTab={setActiveTab}
              data={data}
              itinerary={itinerary}
              maintenanceAlerts={maintenanceAlerts}
              cart={cart}
            />

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
            {currentTab === 'collection' && (
              <CollectionTab
                collection={collection}
                data={data}
                allAvailableCustomers={allAvailableCustomers}
                activeVisit={activeVisit}
                handleStartVisit={handleStartVisit}
                session={session}
                startTripMutation={startTripMutation}
                showAlert={showAlert}
              />
            )}
            {currentTab === 'settle' && (
              <SettleTab
                settle={settle}
                data={data}
                tripExpensesList={tripExpensesList}
                tripPackagingList={tripPackagingList}
                activeVisit={activeVisit}
                showAlert={showAlert}
              />
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
      <CollectionReceiptModal collection={collection} data={data} />
      <SettlementReceiptModal settle={settle} data={data} />
      <TripExpenseModal settle={settle} data={data} refetch={refetch} refetchTripExpenses={refetchTripExpenses} />
      <TripPackagingModal settle={settle} data={data} allAvailableCustomers={allAvailableCustomers} selectedCustomerId={selectedCustomerId} activeVisit={activeVisit} refetch={refetch} refetchTripPackaging={refetchTripPackaging} />
      <DamagedSwapModal
        inv={inv}
        data={data}
        allAvailableCustomers={allAvailableCustomers}
        selectedCustomerId={selectedCustomerId}
        activeVisit={activeVisit}
        refetch={refetch}
      />
      <GpsMandatoryModal visit={visit} />

      <BottomNav
        currentTab={currentTab}
        setActiveTab={setActiveTab}
        data={data}
        itinerary={itinerary}
        maintenanceAlerts={maintenanceAlerts}
        cart={cart}
      />
    </div>
  );
}
