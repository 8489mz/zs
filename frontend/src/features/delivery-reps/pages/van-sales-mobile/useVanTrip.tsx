/* Van sales mobile page slice V1 — trip queries + target card + KPI strip.
   Pure move from the van sales mobile page (HEAD 9cacbf32b): hook + 2 components,
   byte-identical except import lines, the local translation function, and props. */

import { useTranslation } from 'react-i18next';
import { useState, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useQuery, useMutation, type QueryClient } from '@tanstack/react-query';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import {
  vanSalesApi,
  VanActiveTripResponse,
  VanLoadRequisitionRecord,
} from '@/features/delivery-reps/api/van-sales.api';
import { driverPortalApi } from '@/shared/api/delivery-reps.api';
import { toast } from '@/shared/components/system-alert';
import { vanOfflineDb } from '@/features/delivery-reps/offline/van-sales-offline.db';
import { vanSyncEngine } from '@/features/delivery-reps/offline/van-sync.engine';

export type VanTab = 'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions';

export interface UseVanTripDeps {
  session: ReturnType<typeof driverPortalApi.getStoredSession>;
  setSession: Dispatch<SetStateAction<ReturnType<typeof driverPortalApi.getStoredSession>>>;
  isOnline: boolean;
  queryClient: QueryClient;
  showAlert: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
  setIsSyncing: Dispatch<SetStateAction<boolean>>;
  setPendingSyncCount: Dispatch<SetStateAction<number>>;
  setActiveTab: (tab: VanTab) => void;
}

export function useVanTrip({
  session,
  setSession,
  isOnline,
  queryClient,
  showAlert,
  setIsSyncing,
  setPendingSyncCount,
  setActiveTab,
}: UseVanTripDeps) {

  const handleManualSync = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      toast.warning('أنت غير متصل بالإنترنت حالياً للمزامنة');
      return;
    }
    setIsSyncing(true);
    try {
      const res = await vanSyncEngine.syncAll();
      await vanOfflineDb.getPendingCount().then(setPendingSyncCount);
      if (res.syncedCount > 0) {
        toast.success(`تمت مزامنة ${res.syncedCount} عملية بنجاح!`);
        refetch();
      } else if (res.failedCount > 0) {
        toast.error(`فشلت مزامنة ${res.failedCount} عملية: ${res.errors.join(' | ')}`);
      } else {
        toast.info('جميع العمليات متزامنة بالفعل مع الخادم');
      }
    } catch (err: any) {
      toast.error(err?.message || 'تعذرت المزامنة');
    } finally {
      setIsSyncing(false);
    }
  };

  const { data, isLoading, refetch } = useQuery<VanActiveTripResponse>({
    queryKey: ['van-sales-active-trip'],
    queryFn: async () => {
      // Fast Path 1: If offline, retrieve active trip immediately from local IndexedDB (<5ms)
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const offlineData = await vanOfflineDb.getOfflineActiveTrip();
        if (offlineData) return offlineData;
      }

      try {
        const live = await vanSalesApi.getActiveTrip();
        if (live) {
          if (live.hasActiveTrip) {
            void vanOfflineDb.saveSnapshot(live, session);
          }
          // Prefetch & cache warehouse requisition catalog whenever online so driver can always create morning load requisitions offline
          void Promise.allSettled([vanSalesApi.getWarehouses(), vanSalesApi.getAvailableProducts()]).then(([whRes, prodRes]) => {
            const wh = whRes.status === 'fulfilled' ? whRes.value : [];
            const prod = prodRes.status === 'fulfilled' ? prodRes.value : [];
            if (wh.length || prod.length) {
              void vanOfflineDb.saveRequisitionCatalog(wh, prod);
            }
          });
        }
        return live;
      } catch (err: any) {
        if (err?.status === 401) {
          driverPortalApi.logout();
          setSession(null);
          throw err;
        }
        // Fallback to offline cached snapshot from IndexedDB
        const offlineData = await vanOfflineDb.getOfflineActiveTrip();
        if (offlineData) {
          return offlineData;
        }
        throw err;
      }
    },
    enabled: Boolean(session),
    networkMode: 'always',
    refetchInterval: isOnline ? 60000 : false,
    staleTime: 30000,
    retry: false,
  });

  // Query driver's recent requisitions (supporting local outbox requisitions when offline)
  const { data: myRequisitions = [] } = useQuery<VanLoadRequisitionRecord[]>({
    queryKey: ['driver-my-requisitions'],
    queryFn: async () => {
      const pendingOutbox = await vanOfflineDb.getPendingOutbox();
      const offlineReqs: VanLoadRequisitionRecord[] = pendingOutbox
        .filter((item) => item.type === 'load_requisition')
        .map((item, idx) => ({
          id: -(idx + 1),
          docNo: item.docNo,
          tripId: data?.trip?.id,
          repId: item.payload?.repId || session?.rep?.id || 0,
          repName: item.payload?.repName || session?.rep?.fullName || session?.rep?.name || 'مندوب التوزيع الميداني',
          vehiclePlate: item.payload?.vehiclePlate || session?.rep?.vehiclePlate || 'سيارة التوزيع',
          sourceWarehouseId: item.payload?.sourceWarehouseId || 1,
          sourceWarehouseName: item.payload?.items?.[0]?.sourceWarehouseName || 'الفرع الرئيسي',
          status: 'pending' as const,
          itemCount: item.payload?.items?.length || 0,
          totalQty: item.payload?.items?.reduce((s: number, i: any) => s + (i.qty || 0), 0) || 0,
          notes: item.payload?.notes || '(طلب محلي بانتظار المزامنة)',
          createdAt: item.createdAt,
          requestedItems: (item.payload?.items || []).map((i: any) => ({
            productId: i.productId,
            productName: i.productName || 'صنف مطلوب',
            qty: i.qty || 0,
          })),
          approvedItems: [],
        }));

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return offlineReqs;
      }
      try {
        const live = await vanSalesApi.listMyRequisitions();
        return [...offlineReqs, ...(Array.isArray(live) ? live : [])];
      } catch {
        return offlineReqs;
      }
    },
    enabled: Boolean(session),
    networkMode: 'always',
    staleTime: 60000,
  });

  // Itinerary Query - Always enabled for driver to plan their day (on-demand updates, no CPU-heavy polling)
  const { data: itinerary = [], isLoading: isItineraryLoading, refetch: refetchItinerary } = useQuery({
    queryKey: ['driver-itinerary'],
    queryFn: async () => {
      // Fast Path 2: If offline, retrieve cached itinerary immediately from IndexedDB
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const cached = await vanOfflineDb.getItinerary();
        if (cached && cached.length > 0) return cached;
      }

      try {
        const live = await vanSalesApi.getMyItinerary();
        if (Array.isArray(live) && live.length > 0) {
          void vanOfflineDb.saveItinerary(live);
        }
        return live;
      } catch (err: any) {
        const cached = await vanOfflineDb.getItinerary();
        if (cached && cached.length > 0) {
          return cached;
        }
        throw err;
      }
    },
    enabled: Boolean(session),
    networkMode: 'always',
    staleTime: 60000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Fuel Logs Query - Always enabled to track vehicle history
  const { data: fuelLogs = [], refetch: refetchFuelLogs } = useQuery({
    queryKey: ['driver-fuel-logs'],
    queryFn: () => vanSalesApi.getDriverFuelLogs(),
    enabled: Boolean(session),
    staleTime: 120000,
    refetchOnWindowFocus: false,
  });

  // Maintenance Alerts Query - Critical for vehicle health & oil changes
  const { data: maintenanceAlerts = [] } = useQuery({
    queryKey: ['driver-maintenance-alerts'],
    queryFn: () => vanSalesApi.getDriverMaintenanceAlerts(),
    enabled: Boolean(session),
    staleTime: 120000,
    refetchOnWindowFocus: false,
  });

  // Peer Inter-Van Transfers Query
  const { data: peerTransfers = [], refetch: refetchTransfers } = useQuery({
    queryKey: ['driver-transfers'],
    queryFn: () => vanSalesApi.getDriverTransfers(),
    enabled: Boolean(session),
    refetchInterval: 45000,
    staleTime: 20000,
  });

  // Peer Delivery Reps for Street Transfers
  const { data: peerReps = [] } = useQuery({
    queryKey: ['driver-peer-reps'],
    queryFn: () => vanSalesApi.getPeerReps(),
    enabled: Boolean(session),
    staleTime: 60000,
  });

  // Trip Expenses Query
  const { data: tripExpensesData, refetch: refetchTripExpenses } = useQuery({
    queryKey: ['van-trip-expenses', data?.trip?.id],
    queryFn: () => (data?.trip?.id ? vanSalesApi.getTripExpenses(data.trip.id) : Promise.resolve({ expenses: [], totalExpenses: 0 })),
    enabled: Boolean(data?.trip?.id),
    staleTime: 30000,
  });
  const tripExpensesList = useMemo(() => {
    if (!tripExpensesData) return [];
    if (Array.isArray(tripExpensesData)) return tripExpensesData;
    return (tripExpensesData as any).expenses || [];
  }, [tripExpensesData]);

  // Trip Packaging Movements Query
  const { data: tripPackagingData, refetch: refetchTripPackaging } = useQuery({
    queryKey: ['van-trip-packaging', data?.trip?.id],
    queryFn: () => (data?.trip?.id ? vanSalesApi.getTripPackagingMovements(data.trip.id) : Promise.resolve([])),
    enabled: Boolean(data?.trip?.id),
    staleTime: 30000,
  });
  const tripPackagingList = useMemo(() => {
    if (!tripPackagingData) return [];
    if (Array.isArray(tripPackagingData)) return tripPackagingData;
    return (tripPackagingData as any).movements || [];
  }, [tripPackagingData]);

  const [isGlobalRefreshing, setIsGlobalRefreshing] = useState(false);

  const handleGlobalRefresh = async () => {
    if (isGlobalRefreshing) return;
    setIsGlobalRefreshing(true);
    try {
      await Promise.allSettled([
        refetch(),
        refetchItinerary(),
        refetchFuelLogs(),
        refetchTransfers(),
        refetchTripExpenses(),
        refetchTripPackaging(),
        queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-itinerary'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-sales-history'] }),
        queryClient.invalidateQueries({ queryKey: ['driver-maintenance-alerts'] }),
      ]);
      toast.success('تم تحديث خط السير وكافة البيانات بنجاح');
    } catch {
      toast.error('تعذر استكمال التحديث، يرجى التحقق من الاتصال');
    } finally {
      setIsGlobalRefreshing(false);
    }
  };
  const [isTargetMetricsExpanded, setIsTargetMetricsExpanded] = useState(false);

  const startTripMutation = useMutation({
    mutationFn: (notes?: string | void) => vanSalesApi.openTrip({ notes: typeof notes === 'string' ? notes : undefined }),
    onSuccess: (res) => {
      showAlert('success', `تم بدء رحلة التوزيع بنجاح! رقم الرحلة #${res.tripId}`);
      setActiveTab('sale');
      queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] });
      queryClient.invalidateQueries({ queryKey: ['driver-itinerary'] });
      queryClient.invalidateQueries({ queryKey: ['driver-fuel-logs'] });
    },
    onError: (err: any) => showAlert('error', err?.message || 'فشل بدء رحلة التوزيع'),
  });

  const totalInventoryValue = useMemo(() => {
    if (!data?.inventory) return 0;
    return data.inventory.reduce((sum, item) => sum + item.qty * item.retailPrice, 0);
  }, [data?.inventory]);


  const vehicle = useMemo(() => {
    if (data?.trip?.vehiclePlate) {
      return {
        id: data.trip.vehicleId,
        plate: data.trip.vehiclePlate,
        model: data.trip.vehicleModel,
        startOdometer: data.trip.startOdometer,
        endOdometer: data.trip.endOdometer,
        fuelType: data.assignedVehicle?.fuelType || 'petrol_92',
        licenseExpiresAt: data.assignedVehicle?.licenseExpiresAt,
        status: data.assignedVehicle?.status || 'assigned',
      };
    }
    if (data?.assignedVehicle) {
      return {
        id: data.assignedVehicle.id,
        plate: data.assignedVehicle.plateNumber,
        model: data.assignedVehicle.modelName,
        startOdometer: data.assignedVehicle.currentOdometer,
        endOdometer: undefined,
        fuelType: data.assignedVehicle.fuelType,
        licenseExpiresAt: data.assignedVehicle.licenseExpiresAt,
        status: data.assignedVehicle.status,
      };
    }
    if (session?.rep?.vehiclePlate) {
      return {
        id: undefined,
        plate: session.rep.vehiclePlate,
        model: 'فان توزيع ميداني',
        startOdometer: 0,
        endOdometer: undefined,
        fuelType: 'petrol_92',
        licenseExpiresAt: undefined,
        status: 'assigned',
      };
    }
    return undefined;
  }, [data?.trip, data?.assignedVehicle, session?.rep]);

  return {
    data,
    isLoading,
    refetch,
    myRequisitions,
    itinerary,
    isItineraryLoading,
    refetchItinerary,
    fuelLogs,
    refetchFuelLogs,
    maintenanceAlerts,
    peerTransfers,
    refetchTransfers,
    peerReps,
    tripExpensesList,
    tripPackagingList,
    refetchTripExpenses,
    refetchTripPackaging,
    isGlobalRefreshing,
    handleManualSync,
    handleGlobalRefresh,
    isTargetMetricsExpanded,
    setIsTargetMetricsExpanded,
    startTripMutation,
    totalInventoryValue,
    vehicle,
  };
}

export interface TargetMetricsCardProps {
  data: VanActiveTripResponse | undefined;
  isTargetMetricsExpanded: boolean;
  setIsTargetMetricsExpanded: Dispatch<SetStateAction<boolean>>;
}

export function TargetMetricsCard({ data, isTargetMetricsExpanded, setIsTargetMetricsExpanded }: TargetMetricsCardProps) {
  const { t: __t } = useTranslation();
  return (
    <>
      {/* Monthly Multi-Dimensional Target Progress Card */}
      {data?.targetMetrics && (
        (data.targetMetrics.targetAmount > 0) ||
        ((data.targetMetrics.collectionTarget ?? 0) > 0) ||
        ((data.targetMetrics.visitsTarget ?? 0) > 0)
      ) && (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            padding: '14px 16px',
            border: '1px solid #e2e8f0',
            marginBottom: '14px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isTargetMetricsExpanded ? '12px' : '0', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
              <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                {__t('delivery_reps.van_sales_mobile_page.s22', __t('delivery_reps.van_sales_mobile_page.s22', "مستهدفات وإنجازات الشهر ("))}{data.targetMetrics.periodMonth})
              </span>
              <button
                type="button"
                onClick={() => setIsTargetMetricsExpanded((prev) => !prev)}
                style={{
                  border: 'none',
                  background: '#eef2ff',
                  color: '#170e5e',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {isTargetMetricsExpanded ? __t('delivery_reps.van_sales_mobile_page.s23', __t('delivery_reps.van_sales_mobile_page.s23', "إخفاء التفاصيل ▲")) : __t('delivery_reps.van_sales_mobile_page.s24', __t('delivery_reps.van_sales_mobile_page.s24', "عرض التفاصيل ▼"))}
              </button>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#475569',
                backgroundColor: '#f1f5f9',
                padding: '3px 10px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
              }}
            >
              {__t('delivery_reps.van_sales_mobile_page.s25', __t('delivery_reps.van_sales_mobile_page.s25', "متبقي"))} {data.targetMetrics.remainingWorkingDays} {__t('delivery_reps.van_sales_mobile_page.s26', __t('delivery_reps.van_sales_mobile_page.s26', "يوم عمل (مستبعداً الجمعات)"))}
            </span>
          </div>

          {/* Compact summary when collapsed */}
          {!isTargetMetricsExpanded && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-around',
                paddingTop: '10px',
                marginTop: '10px',
                borderTop: '1px dashed #e2e8f0',
                fontSize: '11.5px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              {data.targetMetrics.targetAmount > 0 && (
                <div>
                  <span style={{ color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s27', __t('delivery_reps.van_sales_mobile_page.s27', "المبيعات:"))} </span>
                  <strong style={{ color: data.targetMetrics.isTargetAchieved ? '#16a34a' : '#1d4ed8' }}>
                    {data.targetMetrics.achievementRate}% ({data.targetMetrics.actualSalesMTD.toFixed(0)}/{data.targetMetrics.targetAmount.toFixed(0)})
                  </strong>
                </div>
              )}
              {(data.targetMetrics.collectionTarget ?? 0) > 0 && (
                <div>
                  <span style={{ color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s28', __t('delivery_reps.van_sales_mobile_page.s28', "التحصيل:"))} </span>
                  <strong style={{ color: data.targetMetrics.isCollectionAchieved ? '#16a34a' : '#0284c7' }}>
                    {data.targetMetrics.collectionAchievementRate ?? 0}% ({(data.targetMetrics.actualCollectionsMTD ?? 0).toFixed(0)}/{(data.targetMetrics.collectionTarget ?? 0).toFixed(0)})
                  </strong>
                </div>
              )}
              {(data.targetMetrics.visitsTarget ?? 0) > 0 && (
                <div>
                  <span style={{ color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s29', __t('delivery_reps.van_sales_mobile_page.s29', "الزيارات:"))} </span>
                  <strong style={{ color: data.targetMetrics.isVisitsAchieved ? '#16a34a' : '#7c3aed' }}>
                    {data.targetMetrics.visitsAchievementRate ?? 0}% ({data.targetMetrics.actualVisitsMTD ?? 0}/{data.targetMetrics.visitsTarget ?? 0})
                  </strong>
                </div>
              )}
            </div>
          )}

          {/* Target Dimensions Grid */}
          {isTargetMetricsExpanded && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '12px',
              }}
            >
            {/* 1. Sales Target */}
            {data.targetMetrics.targetAmount > 0 && (
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#1e293b' }}>
                    {__t('delivery_reps.van_sales_mobile_page.s30', __t('delivery_reps.van_sales_mobile_page.s30', "المبيعات:"))} {data.targetMetrics.targetAmount.toFixed(0)} {getGlobalCurrencySymbol()}
                  </span>
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 800,
                      color: data.targetMetrics.isTargetAchieved ? '#15803d' : '#1d4ed8',
                      backgroundColor: data.targetMetrics.isTargetAchieved ? '#dcfce7' : '#eff6ff',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {data.targetMetrics.isTargetAchieved ? __t('delivery_reps.van_sales_mobile_page.s31', __t('delivery_reps.van_sales_mobile_page.s31', "تم الإنجاز")) : `${data.targetMetrics.achievementRate}%`}
                  </span>
                </div>

                <div style={{ width: '100%', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                  <div
                    style={{
                      width: `${Math.min(100, data.targetMetrics.achievementRate)}%`,
                      height: '100%',
                      backgroundColor: data.targetMetrics.isTargetAchieved ? '#16a34a' : '#170e5e',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                <div style={{ fontSize: '10.5px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s32', __t('delivery_reps.van_sales_mobile_page.s32', "المحقق بالشهر:"))} <strong style={{ color: '#0f172a' }}>{data.targetMetrics.actualSalesMTD.toFixed(0)}</strong></span>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s33', __t('delivery_reps.van_sales_mobile_page.s33', "المتبقي:"))} <strong style={{ color: '#dc2626' }}>{data.targetMetrics.remainingTarget.toFixed(0)}</strong></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #e2e8f0', paddingTop: '3px', marginTop: '2px' }}>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s34', __t('delivery_reps.van_sales_mobile_page.s34', "بيع رحلة اليوم:"))} <strong style={{ color: '#16a34a' }}>{(data.targetMetrics.todaySales ?? 0).toFixed(0)}</strong></span>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s35', __t('delivery_reps.van_sales_mobile_page.s35', "المطلوب يومياً:"))} <strong style={{ color: '#d97706' }}>{data.targetMetrics.requiredDailyTarget.toFixed(0)}{__t('delivery_reps.van_sales_mobile_page.s36', __t('delivery_reps.van_sales_mobile_page.s36', "/يوم"))}</strong></span>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Collection Target */}
            {(data.targetMetrics.collectionTarget ?? 0) > 0 && (
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#1e293b' }}>
                    {__t('delivery_reps.van_sales_mobile_page.s37', __t('delivery_reps.van_sales_mobile_page.s37', "التحصيل:"))} {(data.targetMetrics.collectionTarget ?? 0).toFixed(0)} {getGlobalCurrencySymbol()}
                  </span>
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 800,
                      color: data.targetMetrics.isCollectionAchieved ? '#15803d' : '#0369a1',
                      backgroundColor: data.targetMetrics.isCollectionAchieved ? '#dcfce7' : '#e0f2fe',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {data.targetMetrics.isCollectionAchieved ? __t('delivery_reps.van_sales_mobile_page.s38', __t('delivery_reps.van_sales_mobile_page.s38', "تم الإنجاز")) : `${data.targetMetrics.collectionAchievementRate ?? 0}%`}
                  </span>
                </div>

                <div style={{ width: '100%', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                  <div
                    style={{
                      width: `${Math.min(100, data.targetMetrics.collectionAchievementRate ?? 0)}%`,
                      height: '100%',
                      backgroundColor: data.targetMetrics.isCollectionAchieved ? '#16a34a' : '#0284c7',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                <div style={{ fontSize: '10.5px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s39', __t('delivery_reps.van_sales_mobile_page.s39', "المحصل بالشهر:"))} <strong style={{ color: '#0f172a' }}>{(data.targetMetrics.actualCollectionsMTD ?? 0).toFixed(0)}</strong></span>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s40', __t('delivery_reps.van_sales_mobile_page.s40', "المتبقي:"))} <strong style={{ color: '#dc2626' }}>{(data.targetMetrics.remainingCollection ?? 0).toFixed(0)}</strong></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #e2e8f0', paddingTop: '3px', marginTop: '2px' }}>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s41', __t('delivery_reps.van_sales_mobile_page.s41', "كاش رحلة اليوم:"))} <strong style={{ color: '#0284c7' }}>{(data.targetMetrics.todayCollections ?? 0).toFixed(0)}</strong></span>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s42', __t('delivery_reps.van_sales_mobile_page.s42', "المطلوب يومياً:"))} <strong style={{ color: '#d97706' }}>{(data.targetMetrics.requiredDailyCollection ?? 0).toFixed(0)}{__t('delivery_reps.van_sales_mobile_page.s43', __t('delivery_reps.van_sales_mobile_page.s43', "/يوم"))}</strong></span>
                  </div>
                </div>
              </div>
            )}

            {/* 3. Field Visits Target */}
            {(data.targetMetrics.visitsTarget ?? 0) > 0 && (
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#1e293b' }}>
                    {__t('delivery_reps.van_sales_mobile_page.s44', __t('delivery_reps.van_sales_mobile_page.s44', "الزيارات:"))} {data.targetMetrics.visitsTarget} {__t('delivery_reps.van_sales_mobile_page.s45', __t('delivery_reps.van_sales_mobile_page.s45', "زيارة"))}
                  </span>
                  <span
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 800,
                      color: data.targetMetrics.isVisitsAchieved ? '#15803d' : '#7c3aed',
                      backgroundColor: data.targetMetrics.isVisitsAchieved ? '#dcfce7' : '#f5f3ff',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {data.targetMetrics.isVisitsAchieved ? __t('delivery_reps.van_sales_mobile_page.s46', __t('delivery_reps.van_sales_mobile_page.s46', "تم الإنجاز")) : `${data.targetMetrics.visitsAchievementRate ?? 0}%`}
                  </span>
                </div>

                <div style={{ width: '100%', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', overflow: 'hidden', marginBottom: '8px' }}>
                  <div
                    style={{
                      width: `${Math.min(100, data.targetMetrics.visitsAchievementRate ?? 0)}%`,
                      height: '100%',
                      backgroundColor: data.targetMetrics.isVisitsAchieved ? '#16a34a' : '#7c3aed',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                <div style={{ fontSize: '10.5px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s47', __t('delivery_reps.van_sales_mobile_page.s47', "منجز بالشهر:"))} <strong style={{ color: '#0f172a' }}>{data.targetMetrics.actualVisitsMTD ?? 0}</strong></span>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s48', __t('delivery_reps.van_sales_mobile_page.s48', "المتبقي:"))} <strong style={{ color: '#dc2626' }}>{data.targetMetrics.remainingVisits ?? 0}</strong></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #e2e8f0', paddingTop: '3px', marginTop: '2px' }}>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s49', __t('delivery_reps.van_sales_mobile_page.s49', "زيارات اليوم:"))} <strong style={{ color: '#7c3aed' }}>{data.targetMetrics.todayVisits ?? 0}</strong></span>
                    <span>{__t('delivery_reps.van_sales_mobile_page.s50', __t('delivery_reps.van_sales_mobile_page.s50', "المطلوب يومياً:"))} <strong style={{ color: '#d97706' }}>{data.targetMetrics.requiredDailyVisits ?? 0} {__t('delivery_reps.van_sales_mobile_page.s51', __t('delivery_reps.van_sales_mobile_page.s51', "زيارة/يوم"))}</strong></span>
                  </div>
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      )}

    </>
  );
}

export interface KpiStripProps {
  data: VanActiveTripResponse | undefined;
}

export function KpiStrip({ data }: KpiStripProps) {
  const { t: __t } = useTranslation();
  return (
    <>
      {/* Live Financial & KPI Strip - Active Trip Mode */}
      {data?.hasActiveTrip && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '4px',
            marginBottom: '8px',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            padding: '6px 8px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            textAlign: 'center',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ flex: '1 1 0', minWidth: 0, borderInlineEnd: '1px solid #f1f5f9', padding: '2px 2px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', display: 'block', whiteSpace: 'nowrap' }}>{__t('delivery_reps.van_sales_mobile_page.s53', __t('delivery_reps.van_sales_mobile_page.s53', "مبيعات"))}</span>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
              {Number((data.trip?.salesAmount ?? 0).toFixed(0)).toLocaleString()} <CurrencySymbol />
            </span>
          </div>
          <div style={{ flex: '1 1 0', minWidth: 0, borderInlineEnd: '1px solid #f1f5f9', padding: '2px 2px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', display: 'block', whiteSpace: 'nowrap' }}>{__t('delivery_reps.van_sales_mobile_page.s54', __t('delivery_reps.van_sales_mobile_page.s54', "كاش"))}</span>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
              {Number((data.trip?.cashCollected ?? 0).toFixed(0)).toLocaleString()} <CurrencySymbol />
            </span>
          </div>
          <div style={{ flex: '1 1 0', minWidth: 0, borderInlineEnd: '1px solid #f1f5f9', padding: '2px 2px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', display: 'block', whiteSpace: 'nowrap' }}>{__t('delivery_reps.van_sales_mobile_page.s55', __t('delivery_reps.van_sales_mobile_page.s55', "آجل"))}</span>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
              {Number((data.trip?.creditSales ?? 0).toFixed(0)).toLocaleString()} <CurrencySymbol />
            </span>
          </div>
          <div style={{ flex: '1 1 0', minWidth: 0, padding: '2px 2px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', display: 'block', whiteSpace: 'nowrap' }}>{__t('delivery_reps.van_sales_mobile_page.s56', __t('delivery_reps.van_sales_mobile_page.s56', "بضاعة"))}</span>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
              {data.inventory.length} {__t('delivery_reps.van_sales_mobile_page.s57', __t('delivery_reps.van_sales_mobile_page.s57', "صنف"))}
            </span>
          </div>
        </div>
      )}

    </>
  );
}
