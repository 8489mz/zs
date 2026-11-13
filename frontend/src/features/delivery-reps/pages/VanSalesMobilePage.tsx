import { useTranslation } from 'react-i18next';
import { useState, useMemo, useEffect, useRef } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vanSalesApi, VanActiveTripResponse, VanStockItem, VanLoadRequisitionRecord } from '../api/van-sales.api';
import { driverPortalApi } from '@/shared/api/delivery-reps.api';
import { Button } from '@/shared/ui/button';
import {
  TruckIcon,
  PackageIcon,
  MapPinIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
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
import { VanSalesReceiptModal } from '../components/VanSalesReceiptModal';
import { VanCollectionReceiptModal } from '../components/VanCollectionReceiptModal';
import { VanCollectionReceiptData } from '../utils/van-collection-receipt.utils';
import { VanSettlementReceiptModal } from '../components/VanSettlementReceiptModal';
import { VanSettlementReceiptData } from '../utils/van-settlement-receipt.utils';
import { VanInventoryTab } from '../components/VanInventoryTab';
import { VanSaleTab, CartItem } from '../components/VanSaleTab';
import { VanSaleCheckoutModal } from '../components/VanSaleCheckoutModal';
import { VanCollectionTab } from '../components/VanCollectionTab'; // live-synced
import { VanSettleTab } from '../components/VanSettleTab';
import { VanItineraryTab } from '../components/VanItineraryTab';
import { VanFleetTab } from '../components/VanFleetTab';
import { VanTransferModal } from '../components/VanTransferModal';
import { DriverNewLoadRequisitionView } from '../components/DriverNewLoadRequisitionView';
import { VanSalesHistoryTab } from '../components/VanSalesHistoryTab';
import { VanPreSalesTab } from '../components/VanPreSalesTab';
import { VanTripExpenseModal } from '../components/VanTripExpenseModal';
import { VanTripPackagingModal } from '../components/VanTripPackagingModal';
import { VanDamagedSwapModal } from '../components/VanDamagedSwapModal';
import { VanGpsMandatoryModal } from '../components/VanGpsMandatoryModal';

export default function VanSalesMobilePage() {
  const { t: __t } = useTranslation();
  const queryClient = useQueryClient();

  const [session, setSession] = useState(() => driverPortalApi.getStoredSession());
  const [viewMode, setViewMode] = useState<'dashboard' | 'new-requisition'>('dashboard');
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // Monitor connectivity, load pending outbox items, and listen to sync completion
  useEffect(() => {
    vanOfflineDb.getPendingCount().then(setPendingSyncCount);

    const cleanup = vanSyncEngine.startAutoSyncListener((online) => {
      setIsOnline(online);
      vanOfflineDb.getPendingCount().then(setPendingSyncCount);
    });

    const handleSyncComplete = (e: any) => {
      vanOfflineDb.getPendingCount().then(setPendingSyncCount);
      queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] });
      queryClient.invalidateQueries({ queryKey: ['driver-itinerary'] });
      queryClient.invalidateQueries({ queryKey: ['driver-sales-history'] });
      const synced = e?.detail?.syncedCount || 0;
      if (synced > 0) {
        toast.success(`تمت مزامنة ${synced} عملية ميدانية مع الخادم بنجاح!`);
      }
    };

    window.addEventListener('van-offline-sync-completed', handleSyncComplete);

    return () => {
      cleanup();
      window.removeEventListener('van-offline-sync-completed', handleSyncComplete);
    };
  }, [queryClient]);

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

  const handleLogout = async () => {
    const confirmed = await systemConfirm({
      title: 'تسجيل الخروج',
      message: 'هل تود بالتأكيد تسجيل الخروج من بوابة مبيعات الفان الميدانية؟',
      confirmText: 'تسجيل الخروج',
      cancelText: 'إلغاء',
      variant: 'danger',
    });
    if (confirmed) {
      driverPortalApi.logout();
      setSession(null);
      queryClient.clear();
      toast.info('تم تسجيل الخروج بنجاح');
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

  const [activeTab, setActiveTab] = useState<'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions'>('cockpit');
  const [stockSearch, setStockSearch] = useState('');
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [packagingModalOpen, setPackagingModalOpen] = useState(false);
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [saleNotes, setSaleNotes] = useState('');
  const [deliveryProofPhoto, setDeliveryProofPhoto] = useState('');
  const [cartonsCount, setCartonsCount] = useState('');

  const [selectedCustomerId, setSelectedCustomerId] = useState<number | ''>('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit' | 'card' | 'split'>('cash');
  const [cart, setCart] = useState<CartItem[]>([]);

  const [colCustomerId, setColCustomerId] = useState<number | ''>('');
  const [colAmount, setColAmount] = useState<string>('');
  const [colSubMode, setColSubMode] = useState<'collection' | 'return'>('collection');
  const [colReturnCustomerId, setColReturnCustomerId] = useState<number | ''>('');

  // Active Customer Visit Tracking
  const [activeVisit, setActiveVisit] = useState<{
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
    latitude?: number;
    longitude?: number;
  } | null>(() => {
    try {
      const saved = localStorage.getItem('zs_van_active_visit');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });

  const [visitDurationSecs, setVisitDurationSecs] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('zs_van_active_visit');
      if (saved) {
        const parsed = JSON.parse(saved);
        return Math.max(0, Math.floor((Date.now() - parsed.startedAt) / 1000));
      }
    } catch {}
    return 0;
  });

  // GPS Mandatory Check State for Store Visits
  const [isCheckingGps, setIsCheckingGps] = useState<boolean>(false);
  const [gpsBlockedModalOpen, setGpsBlockedModalOpen] = useState<boolean>(false);
  const [gpsBlockedInfo, setGpsBlockedInfo] = useState<{
    customerId: number;
    customerName: string;
    errorMessage?: string;
    onSuccess?: () => void;
  } | null>(null);

  // Ticker for active visit
  useEffect(() => {
    if (!activeVisit) {
      setVisitDurationSecs(0);
      return;
    }
    const updateDuration = () => {
      setVisitDurationSecs(Math.max(0, Math.floor((Date.now() - activeVisit.startedAt) / 1000)));
    };
    updateDuration();
    const interval = setInterval(updateDuration, 1000);
    return () => clearInterval(interval);
  }, [activeVisit]);

  const requestGpsPosition = (): Promise<{ latitude: number; longitude: number }> => {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        return reject(new Error('خدمة تحديد المواقع (GPS) غير مدعومة على هذا الجهاز أو المتصفح.'));
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: Number(pos.coords.latitude.toFixed(6)),
            longitude: Number(pos.coords.longitude.toFixed(6)),
          });
        },
        (err) => {
          let msg = 'خدمة تحديد المواقع (GPS) مقفولة أو يتعذر التقاط الإحداثيات.';
          if (err.code === 1) {
            msg = 'تم رفض إذن الوصول للموقع الجغرافي في المتصفح. يرجى تفعيل إذن الموقع.';
          } else if (err.code === 2) {
            msg = 'خدمة الـ GPS غير مفعّلة في الهاتف أو يتعذر استقبال إشارة الأقمار الصناعية.';
          } else if (err.code === 3) {
            msg = 'انتهت مهلة التقاط الموقع الجغرافي. تأكد من تفعيل الـ GPS بالهاتف ثم أعد المحاولة.';
          }
          reject(new Error(msg));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  };

  const handleStartVisit = async (
    customerId: number,
    customerName: string,
    onSuccess?: () => void,
  ) => {
    if (activeVisit && activeVisit.customerId === customerId) {
      onSuccess?.();
      return;
    }

    // INV-VAN-GPS-FLAG-OFF-VISIT: when the admin has explicitly switched
    // GPS off for this rep (require_gps_on_visit === false), the visit
    // starts without coordinates — no GPS capture, no mandatory dialog.
    // A missing flag stays mandatory (today's behaviour); only an
    // explicit OFF opts out, and the admin toggle remains the only
    // control (no supervisor-PIN override). The visit object carries no
    // coordinates, so the submit re-gates see a valid activeVisit and the
    // backend check-in (which honours the flag) proceeds without them.
    if (session?.rep?.permissions?.require_gps_on_visit === false) {
      const now = Date.now();
      const nowStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      const visitData = {
        customerId,
        customerName,
        startedAt: now,
        startedTimeStr: nowStr,
      };
      setActiveVisit(visitData);
      try {
        localStorage.setItem('zs_van_active_visit', JSON.stringify(visitData));
      } catch {}

      vanSalesApi.checkInVisit({
        tripId: data?.trip?.id,
        customerId,
        customerName,
      }).catch(() => {
        // Silently handled in background
      });

      toast.success(`تم بدء الزيارة: "${customerName}" (${nowStr})`);
      setGpsBlockedModalOpen(false);
      setGpsBlockedInfo(null);
      onSuccess?.();
      return;
    }

    setIsCheckingGps(true);
    try {
      const coords = await requestGpsPosition();
      const now = Date.now();
      const nowStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      const visitData = {
        customerId,
        customerName,
        startedAt: now,
        startedTimeStr: nowStr,
        latitude: coords.latitude,
        longitude: coords.longitude,
      };
      setActiveVisit(visitData);
      try {
        localStorage.setItem('zs_van_active_visit', JSON.stringify(visitData));
      } catch {}

      vanSalesApi.checkInVisit({
        tripId: data?.trip?.id,
        customerId,
        customerName,
        latitude: coords.latitude,
        longitude: coords.longitude,
      }).catch(() => {
        // Silently handled in background
      });

      toast.success(`تم التقاط إحداثيات GPS وبدأت الزيارة: "${customerName}" (${nowStr})`);
      setGpsBlockedModalOpen(false);
      setGpsBlockedInfo(null);
      onSuccess?.();
    } catch (err: any) {
      const errMsg = err?.message || 'خدمة الـ GPS غير مفعلة على الهاتف.';
      setGpsBlockedInfo({
        customerId,
        customerName,
        errorMessage: errMsg,
        onSuccess,
      });
      setGpsBlockedModalOpen(true);
      toast.warning('يلزم تفعيل الـ GPS لبدء الزيارة الميدانية وتوثيق التواجد');
    } finally {
      setIsCheckingGps(false);
    }
  };

  const handleRetryGpsCheck = () => {
    if (!gpsBlockedInfo) return;
    void handleStartVisit(gpsBlockedInfo.customerId, gpsBlockedInfo.customerName, gpsBlockedInfo.onSuccess);
  };

  const handleEndVisit = () => {
    setActiveVisit(null);
    try {
      localStorage.removeItem('zs_van_active_visit');
    } catch {}
  };

  const formatDuration = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const [countedCash, setCountedCash] = useState<string>('');
  const [unloadRemaining, setUnloadRemaining] = useState<boolean>(true);

  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null);
  const [lastSaleReceipt, setLastSaleReceipt] = useState<any | null>(null);
  const [lastCollectionReceipt, setLastCollectionReceipt] = useState<VanCollectionReceiptData | null>(null);
  const [lastSettlementReceipt, setLastSettlementReceipt] = useState<VanSettlementReceiptData | null>(null);
  const [isTargetMetricsExpanded, setIsTargetMetricsExpanded] = useState(false);
  const [inventorySubMode, setInventorySubMode] = useState<'stock' | 'requisitions'>('stock');
  const [showFleetInCockpit, setShowFleetInCockpit] = useState<boolean>(false);
  const [isCheckoutProcessing, setIsCheckoutProcessing] = useState<boolean>(false);
  const isCheckoutProcessingRef = useRef<boolean>(false);
  const pendingAutoShareWhatsAppRef = useRef<boolean>(false);
  const [isCollectionProcessing, setIsCollectionProcessing] = useState<boolean>(false);
  const isCollectionProcessingRef = useRef<boolean>(false);

  const showAlert = (type: 'success' | 'error' | 'warning' | 'info', message: string) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  const filteredInventory = useMemo(() => {
    if (!data?.inventory) return [];
    if (!stockSearch.trim()) return data.inventory;
    const q = stockSearch.toLowerCase();
    return data.inventory.filter(
      (item) => item.productName.toLowerCase().includes(q) || item.barcode.toLowerCase().includes(q),
    );
  }, [data?.inventory, stockSearch]);

  const addToCart = (item: VanStockItem) => {
    setCart((prev) => {
      const exists = prev.find((c) => c.productId === item.productId);
      if (exists) {
        if (exists.qty >= item.qty) {
          showAlert('error', `أقصى كمية متوفرة بالسيارة هي ${item.qty}`);
          return prev;
        }
        return prev.map((c) => (c.productId === item.productId ? { ...c, qty: c.qty + 1 } : c));
      }
      const initialUnit = item.availableUnits?.[0];
      // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: wholesale-typed customer
      // starts the cart line at the wholesale price (per piece, like
      // retailPrice); unit changes re-derive it in changeCartItemUnit.
      const startUnitPrice = selectedCustomer?.customer_type === 'wholesale' && item.wholesalePrice != null && Number(item.wholesalePrice) > 0
        ? Number(item.wholesalePrice)
        : item.retailPrice;
      return [
        ...prev,
        {
          productId: item.productId,
          name: item.productName,
          qty: 1,
          unitPrice: startUnitPrice,
          originalPrice: item.originalPrice,
          offerBadge: item.offerBadge,
          maxQty: item.qty,
          unitName: initialUnit?.name || (typeof item.packagingUnit === 'string' ? item.packagingUnit : item.packagingUnit?.name) || 'قطعة',
          unitMultiplier: initialUnit?.multiplier || 1,
          availableUnits: item.availableUnits,
          isBonus: false,
        },
      ];
    });
  };

  const toggleCartItemBonus = (productId: number) => {
    setCart((prev) =>
      prev.map((c) => {
        if (c.productId === productId) {
          const nextBonus = !c.isBonus;
          if (nextBonus) {
            showAlert('info', 'تم تحديد الصنف كبونص مجاني. سيتطلب اعتماد المشرف برمز PIN عند إتمام الفاتورة ما لم يتوفر عرض ترويجي نشط.');
          }
          return {
            ...c,
            isBonus: nextBonus,
            bonusReason: nextBonus ? 'بونص ترويجي ميداني' : undefined,
            unitPrice: nextBonus ? 0 : (c.originalPrice || c.unitPrice),
          };
        }
        return c;
      }),
    );
  };

  const changeCartItemUnit = (productId: number, unitName: string, multiplier: number) => {
    setCart((prev) =>
      prev.map((c) => {
        if (c.productId === productId) {
          const stockItem = data?.inventory?.find((it) => it.productId === productId);
          // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: wholesale-typed
          // customer re-derives the unit price from wholesalePrice,
          // falling back to the retail chain when it is absent/zero.
          const basePrice = selectedCustomer?.customer_type === 'wholesale' && stockItem?.wholesalePrice != null && Number(stockItem.wholesalePrice) > 0
            ? Number(stockItem.wholesalePrice)
            : (stockItem?.retailPrice || c.originalPrice || c.unitPrice);
          const newUnitPrice = c.isBonus ? 0 : basePrice * (multiplier || 1);
          return {
            ...c,
            unitName,
            unitMultiplier: multiplier,
            unitPrice: newUnitPrice,
          };
        }
        return c;
      }),
    );
  };

  const updateCartQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.productId === productId) {
            const next = c.qty + delta;
            if (next > c.maxQty) {
              showAlert('error', `أقصى كمية متوفرة هي ${c.maxQty}`);
              return c;
            }
            return { ...c, qty: next };
          }
          return c;
        })
        .filter((c) => c.qty > 0),
    );
  };

  const allAvailableCustomers = useMemo(() => {
    const map = new Map<number, any>();
    if (data?.customers && Array.isArray(data.customers)) {
      for (const c of data.customers) {
        map.set(c.id, c);
      }
    }
    if (itinerary && Array.isArray(itinerary)) {
      for (const it of itinerary) {
        if (!map.has(it.customerId)) {
          map.set(it.customerId, {
            id: it.customerId,
            name: it.customerName,
            phone: it.customerPhone,
            address: it.customerAddress,
            balance: it.balance,
            creditLimit: it.creditLimit,
            customerCode: it.customerCode,
            route: it.route,
            district: it.district || it.route || '',
            locationUrl: it.locationUrl,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [data?.customers, itinerary]);

  // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: the cart prices by the
  // selected customer's type — a wholesale-typed customer is charged
  // the wholesale price, everyone else retail/credit as before.
  const selectedCustomer = useMemo(
    () => (selectedCustomerId === '' ? null : allAvailableCustomers.find((c) => String(c.id) === String(selectedCustomerId)) || null),
    [allAvailableCustomers, selectedCustomerId],
  );

  const cartTotal = useMemo(() => cart.reduce((sum, c) => sum + (c.isBonus ? 0 : c.qty * c.unitPrice), 0), [cart]);

  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, c) => {
      if (c.isBonus) return sum;
      const orig = (c.originalPrice && c.originalPrice > c.unitPrice) ? c.originalPrice : c.unitPrice;
      return sum + c.qty * orig;
    }, 0);
  }, [cart]);

  const cartDiscount = useMemo(() => {
    return Math.max(0, cartSubtotal - cartTotal);
  }, [cartSubtotal, cartTotal]);

  const executeSaleMutation = useMutation({
    networkMode: 'always',
    mutationFn: async (payload: any) => {
      const isActuallyOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isActuallyOffline) {
        const offRes = await vanOfflineDb.recordOfflineSale({
          tripId: payload.tripId,
          customerId: payload.customerId,
          customerName: payload.customerName,
          items: payload.items,
          paymentMethod: payload.paymentMethod,
          paidAmount: payload.paidAmount,
          notes: payload.notes,
          gpsLat: payload.deliveryGpsLat,
          gpsLng: payload.deliveryGpsLng,
          deliveryProofPhoto: payload.deliveryProofPhoto,
          cartonsCount: payload.packagingBreakdown?.cartonsCount,
        });
        return {
          ok: true,
          saleId: -Date.now(),
          docNo: offRes.docNo,
          total: offRes.total,
          paymentMethod: payload.paymentMethod,
          customerName: payload.customerName || 'عميل نقدي',
          itemsCount: payload.items.length,
          cashPaid: payload.paymentMethod === 'cash' ? offRes.total : Number(payload.paidAmount || 0),
          creditOwed: payload.paymentMethod === 'credit' ? offRes.total : 0,
          isOffline: true,
        };
      }

      try {
        return await vanSalesApi.executeSale(payload);
      } catch (err: any) {
        const isNetworkErr =
          !err?.status ||
          err?.status === 0 ||
          err?.message?.toLowerCase().includes('failed to fetch') ||
          err?.message?.includes('NetworkError');

        if (isNetworkErr) {
          const offRes = await vanOfflineDb.recordOfflineSale({
            tripId: payload.tripId,
            customerId: payload.customerId,
            customerName: payload.customerName,
            items: payload.items,
            paymentMethod: payload.paymentMethod,
            paidAmount: payload.paidAmount,
            notes: payload.notes,
            gpsLat: payload.deliveryGpsLat,
            gpsLng: payload.deliveryGpsLng,
            deliveryProofPhoto: payload.deliveryProofPhoto,
            cartonsCount: payload.packagingBreakdown?.cartonsCount,
          });
          return {
            ok: true,
            saleId: -Date.now(),
            docNo: offRes.docNo,
            total: offRes.total,
            paymentMethod: payload.paymentMethod,
            customerName: payload.customerName || 'عميل نقدي',
            itemsCount: payload.items.length,
            cashPaid: payload.paymentMethod === 'cash' ? offRes.total : Number(payload.paidAmount || 0),
            creditOwed: payload.paymentMethod === 'credit' ? offRes.total : 0,
            isOffline: true,
          };
        }
        throw err;
      }
    },
    onSuccess: (res: any) => {
      vanOfflineDb.getPendingCount().then(setPendingSyncCount);
      const isOff = res?.isOffline;
      if (isOff) {
        toast.success(`تم حفظ الفاتورة أوفلاين #${res.docNo} بمبلغ ${res.total} ${getGlobalCurrencySymbol()} وسيتم ترحيلها آلياً عند عودة الشبكة.`);
      } else {
        showAlert('success', `تم إصدار الفاتورة #${res.docNo} بمبلغ ${res.total} ${getGlobalCurrencySymbol()} بنجاح!`);
      }
      if (activeVisit) {
        const durationMins = Math.max(1, Math.round((Date.now() - activeVisit.startedAt) / 60000));
        toast.success(`تم إتمام زيارة المحل "${activeVisit.customerName}" (استغرقت ${durationMins} دقيقة)`);
        handleEndVisit();
      }
      const matchedCustomer = allAvailableCustomers.find((c) => String(c.id) === String(selectedCustomerId));
      setLastSaleReceipt({
        ...res,
        autoShareWhatsApp: pendingAutoShareWhatsAppRef.current,
        subtotal: res.subtotal ?? cartSubtotal,
        discount: res.discount ?? cartDiscount,
        paidAmount: res.cashPaid,
        remainingCredit: res.creditOwed,
        customerTotalBalance: matchedCustomer?.balance != null ? Number(matchedCustomer.balance) : undefined,
        packagingBreakdown: {
          cartonsCount: Number(cartonsCount) || 0,
          piecesCount: cart.reduce((s, it) => s + it.qty * (it.unitMultiplier || 1), 0),
          itemsCount: cart.length,
        },
        deliveryProofPhoto: deliveryProofPhoto || undefined,
        customerName: res.customerName || matchedCustomer?.name || newCustomerName || 'عميل نقدي',
        customerPhone: matchedCustomer?.phone || '',
        customerCode: matchedCustomer?.customerCode || '',
        customerAddress: matchedCustomer?.address || '',
        items: cart.map((c) => ({
          productId: c.productId,
          name: c.name,
          qty: c.qty,
          unitPrice: c.unitPrice,
          originalPrice: c.originalPrice,
          lineTotal: c.qty * c.unitPrice,
          unitName: c.unitName,
          unitMultiplier: c.unitMultiplier,
          isBonus: c.isBonus,
          bonusReason: c.bonusReason,
        })),
        repName: data?.trip?.repName || (session?.rep as any)?.name || 'مندوب التوزيع',
        vehiclePlate: data?.assignedVehicle?.plateNumber || data?.trip?.vehiclePlate || '',
        warehouseName: data?.trip?.sourceWarehouseName || '',
        date: new Date().toISOString(),
      });
      setCheckoutModalOpen(false);
      setSaleNotes('');
      setDeliveryProofPhoto('');
      setCartonsCount('');
      setCart([]);
      setSelectedCustomerId('');
      setNewCustomerName('');
      queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] });
      queryClient.invalidateQueries({ queryKey: ['driver-itinerary'] });
      queryClient.invalidateQueries({ queryKey: ['driver-sales-history'] });
    },
    onError: (err: any) => showAlert('error', err?.message || 'فشل إصدار الفاتورة'),
    onSettled: () => {
      isCheckoutProcessingRef.current = false;
      setIsCheckoutProcessing(false);
    },
  });

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

  const currentTab = useMemo(() => {
    if (data?.hasActiveTrip && activeTab === 'cockpit') return 'sale';
    return activeTab;
  }, [data?.hasActiveTrip, activeTab]);

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
      {activeVisit && (
        <div
          dir="rtl"
          style={{
            backgroundColor: '#ffffff',
            color: '#0f172a',
            padding: '4px 10px',
            borderBottom: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'nowrap',
            gap: '8px',
            position: 'sticky',
            top: 0,
            zIndex: 85,
          }}
        >
          {/* Customer info & Duration */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: '24px',
                height: '24px',
                minWidth: '24px',
                borderRadius: '6px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <ClockIcon size={12} color="#170e5e" />
            </div>
            <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
              <div
                style={{
                  fontSize: '11.5px',
                  fontWeight: 800,
                  color: '#0f172a',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.2,
                }}
                title={activeVisit.customerName}
              >
                {activeVisit.customerName}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9.5px', color: '#64748b', whiteSpace: 'nowrap' }}>
                <span style={{ color: '#0f172a', fontWeight: 700 }}>
                  {__t('delivery_reps.van_sales_mobile_page.s15', __t('delivery_reps.van_sales_mobile_page.s15', "المدة:"))} {formatDuration(visitDurationSecs)}
                </span>
                <span>•</span>
                <span>{activeVisit.startedTimeStr || __t('delivery_reps.van_sales_mobile_page.s16', __t('delivery_reps.van_sales_mobile_page.s16', "الآن"))}</span>
              </div>
            </div>
          </div>

          {/* Action buttons on single line - Compact Premium */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            {currentTab !== 'sale' && (
              <button
                type="button"
                onClick={() => {
                  setSelectedCustomerId(activeVisit.customerId);
                  setActiveTab('sale');
                }}
                style={{
                  height: '24px',
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '5px',
                  padding: '0 6px',
                  fontSize: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 1px 2px rgba(23, 14, 94, 0.1)',
                }}
              >
                <ReceiptIcon size={11} color="#ffffff" />
                <span>{__t('delivery_reps.van_sales_mobile_page.s17', __t('delivery_reps.van_sales_mobile_page.s17', "+ فاتورة"))}</span>
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                const confirmed = await systemConfirm({
                  title: __t('delivery_reps.van_sales_mobile_page.s18', __t('delivery_reps.van_sales_mobile_page.s18', "إنهاء الزيارة الميدانية")),
                  message: `هل تود إنهاء زيارة "${activeVisit.customerName}" الآن؟ (المدة المنقضية: ${formatDuration(visitDurationSecs)})`,
                  confirmText: __t('delivery_reps.van_sales_mobile_page.s19', __t('delivery_reps.van_sales_mobile_page.s19', "إنهاء الزيارة")),
                  cancelText: __t('delivery_reps.van_sales_mobile_page.s20', __t('delivery_reps.van_sales_mobile_page.s20', "استمرار الزيارة")),
                });
                if (confirmed) {
                  const mins = Math.max(1, Math.round((Date.now() - activeVisit.startedAt) / 60000));
                  toast.info(`تم إنهاء زيارة "${activeVisit.customerName}" (${mins} دقيقة)`);
                  handleEndVisit();
                }
              }}
              style={{
                height: '24px',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                color: '#475569',
                borderRadius: '5px',
                padding: '0 6px',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {__t('delivery_reps.van_sales_mobile_page.s21', __t('delivery_reps.van_sales_mobile_page.s21', "إنهاء الزيارة"))}
            </button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main style={{ padding: '8px 10px 85px', maxWidth: '1280px', width: '100%', margin: '0 auto', boxSizing: 'border-box', minWidth: 0 }}>
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

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8', fontWeight: 700 }}>{__t('delivery_reps.van_sales_mobile_page.s52', __t('delivery_reps.van_sales_mobile_page.s52', "جاري تحميل بيانات رحلة الفان..."))}</div>
        ) : (
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

            {/* TAB CONTENT: COCKPIT (Idle / Standby Morning Hub) */}
            {!data?.hasActiveTrip && currentTab === 'cockpit' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Quick Actions Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '-4px' }}>
                  <span style={{ width: '3px', height: '12px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                  <h2 style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                    {__t('delivery_reps.van_sales_mobile_page.s72', __t('delivery_reps.van_sales_mobile_page.s72', "الإجراءات الميدانية السريعة"))}
                  </h2>
                </div>

                {/* 2-Column Quick Action Grid (دستور شبكة الإجراءات المتوازنة ثنائية الأعمدة) */}
                <div className="keep-grid-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                  {/* Tile 1: إذن تحميل بضاعة */}
                  <button
                    type="button"
                    onClick={() => setViewMode('new-requisition')}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '11px',
                      padding: '8px 6px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#f3e8ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                      <PackageIcon size={16} color="#7e22ce" />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#0f172a', margin: '0 0 1px', display: 'block' }}>{__t('delivery_reps.van_sales_mobile_page.s73', __t('delivery_reps.van_sales_mobile_page.s73', "إذن تحميل بضاعة"))}</span>
                    <span style={{ fontSize: '9px', fontWeight: 500, color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s74', __t('delivery_reps.van_sales_mobile_page.s74', "طلب شحن من المستودع"))}</span>
                  </button>

                  {/* Tile 2: خط سير اليوم */}
                  <button
                    type="button"
                    onClick={() => setActiveTab('itinerary')}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '11px',
                      padding: '8px 6px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                      <MapPinIcon size={16} color="#15803d" />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#0f172a', margin: '0 0 1px', display: 'block' }}>{__t('delivery_reps.van_sales_mobile_page.s75', __t('delivery_reps.van_sales_mobile_page.s75', "خط سير اليوم"))}</span>
                    <span style={{ fontSize: '9px', fontWeight: 500, color: '#64748b' }}>{itinerary.length} {__t('delivery_reps.van_sales_mobile_page.s76', __t('delivery_reps.van_sales_mobile_page.s76', "متاجر مجدولة"))}</span>
                  </button>

                  {/* Tile 3: تسجيل وقود وصيانة */}
                  <button
                    type="button"
                    onClick={() => setShowFleetInCockpit((prev) => !prev)}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '11px',
                      padding: '8px 6px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                      <TruckIcon size={16} color="#b45309" />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#0f172a', margin: '0 0 1px', display: 'block' }}>{__t('delivery_reps.van_sales_mobile_page.s77', __t('delivery_reps.van_sales_mobile_page.s77', "تفويل وصيانة"))}</span>
                    <span style={{ fontSize: '9px', fontWeight: 500, color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s78', __t('delivery_reps.van_sales_mobile_page.s78', "سجل الوقود والعداد"))}</span>
                  </button>

                  {/* Tile 4: بضاعة ومخزون السيارة */}
                  <button
                    type="button"
                    onClick={() => setActiveTab('inventory')}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '11px',
                      padding: '8px 6px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ width: '30px', height: '30px', borderRadius: '9px', backgroundColor: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
                      <ShoppingBagIcon size={16} color="#0369a1" />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#0f172a', margin: '0 0 1px', display: 'block' }}>{__t('delivery_reps.van_sales_mobile_page.s79', __t('delivery_reps.van_sales_mobile_page.s79', "مخزون السيارة"))}</span>
                    <span style={{ fontSize: '9px', fontWeight: 500, color: '#64748b' }}>{data?.inventory?.length || 0} {__t('delivery_reps.van_sales_mobile_page.s80', __t('delivery_reps.van_sales_mobile_page.s80', "أصناف متوفرة"))}</span>
                  </button>
                </div>

                {/* 1. Vehicle Fleet Status & Health Cockpit */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    padding: '10px 12px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TruckIcon size={15} color="#170e5e" />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{__t('delivery_reps.van_sales_mobile_page.s81', __t('delivery_reps.van_sales_mobile_page.s81', "مركبة التوزيع والأسطول الميداني"))}</h3>
                      <span style={{ fontSize: '10px', color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s82', __t('delivery_reps.van_sales_mobile_page.s82', "حالة السيارة وقراءة العداد وتنبيهات الصيانة"))}</span>
                    </div>
                  </div>

                  {/* Vehicle Specs Grid: 4 Balanced Elegant Tiles */}
                  <div className="keep-grid-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px', marginBottom: '8px', width: '100%', boxSizing: 'border-box' }}>
                    <div style={{ backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '1px' }}>{__t('delivery_reps.van_sales_mobile_page.s83', __t('delivery_reps.van_sales_mobile_page.s83', "رقم لوحة السيارة"))}</span>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#170e5e' }}>{vehicle?.plate || __t('delivery_reps.van_sales_mobile_page.s84', __t('delivery_reps.van_sales_mobile_page.s84', "سيارة التوزيع"))}</span>
                    </div>
                    <div style={{ backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '1px' }}>{__t('delivery_reps.van_sales_mobile_page.s85', __t('delivery_reps.van_sales_mobile_page.s85', "الموديل والنوع"))}</span>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{vehicle?.model || __t('delivery_reps.van_sales_mobile_page.s86', __t('delivery_reps.van_sales_mobile_page.s86', "فان توزيع بضاعة"))}</span>
                    </div>
                    <div style={{ backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '1px' }}>{__t('delivery_reps.van_sales_mobile_page.s87', __t('delivery_reps.van_sales_mobile_page.s87', "عداد الكيلومتر الحالي"))}</span>
                      <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>{vehicle?.startOdometer ? `${vehicle.startOdometer.toLocaleString()} كم` : __t('delivery_reps.van_sales_mobile_page.s88', __t('delivery_reps.van_sales_mobile_page.s88', "0 كم"))}</span>
                    </div>
                    <div style={{ backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '9.5px', color: '#64748b', display: 'block', fontWeight: 600, marginBottom: '1px' }}>{__t('delivery_reps.van_sales_mobile_page.s89', __t('delivery_reps.van_sales_mobile_page.s89', "نوع الوقود"))}</span>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: '#166534', backgroundColor: '#dcfce7', padding: '1px 6px', borderRadius: '5px', display: 'inline-block' }}>
                        {vehicle?.fuelType === 'diesel' ? __t('delivery_reps.van_sales_mobile_page.s90', __t('delivery_reps.van_sales_mobile_page.s90', "سولار")) : __t('delivery_reps.van_sales_mobile_page.s91', __t('delivery_reps.van_sales_mobile_page.s91', "بنزين 92"))}
                      </span>
                    </div>
                  </div>

                  {/* Maintenance & Oil Alerts Strip */}
                  {maintenanceAlerts.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '8px' }}>
                      {maintenanceAlerts.map((al) => (
                        <div
                          key={al.id}
                          style={{
                            backgroundColor: al.severity === 'critical' ? '#fef2f2' : '#fffbeb',
                            border: `1px solid ${al.severity === 'critical' ? '#fecaca' : '#fde68a'}`,
                            borderRadius: '8px',
                            padding: '6px 10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <AlertTriangleIcon size={14} color={al.severity === 'critical' ? '#dc2626' : '#d97706'} />
                            <span style={{ fontSize: '11px', fontWeight: 700, color: al.severity === 'critical' ? '#991b1b' : '#92400e' }}>
                              {al.description || al.title}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowFleetInCockpit(true)}
                            style={{
                              backgroundColor: '#ffffff',
                              border: '1px solid #cbd5e1',
                              color: '#0f172a',
                              borderRadius: '5px',
                              padding: '2px 7px',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {__t('delivery_reps.van_sales_mobile_page.s92', __t('delivery_reps.van_sales_mobile_page.s92', "تسجيل الصيانة"))}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <CheckCircleIcon size={14} color="#16a34a" />
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#166534' }}>
                        {__t('delivery_reps.van_sales_mobile_page.s93', __t('delivery_reps.van_sales_mobile_page.s93', "حالة المركبة ممتازة ولا توجد تنبيهات صيانة أو غيارات زيت متأخرة"))}
                      </span>
                    </div>
                  )}

                  {/* Quick Fleet Toggles */}
                  <div className="keep-grid-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px', width: '100%', boxSizing: 'border-box' }}>
                    <button
                      type="button"
                      onClick={() => setShowFleetInCockpit((prev) => !prev)}
                      style={{
                        backgroundColor: showFleetInCockpit ? '#170e5e' : '#f8fafc',
                        border: '1px solid #cbd5e1',
                        color: showFleetInCockpit ? '#ffffff' : '#170e5e',
                        borderRadius: '7px',
                        padding: '6px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      {showFleetInCockpit ? __t('delivery_reps.van_sales_mobile_page.s94', __t('delivery_reps.van_sales_mobile_page.s94', "إخفاء سجل المركبة")) : __t('delivery_reps.van_sales_mobile_page.s95', __t('delivery_reps.van_sales_mobile_page.s95', "+ تسجيل تفويلة وقود"))}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFleetInCockpit((prev) => !prev)}
                      style={{
                        backgroundColor: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        color: '#0f172a',
                        borderRadius: '7px',
                        padding: '6px 8px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'center',
                      }}
                    >
                      {showFleetInCockpit ? __t('delivery_reps.van_sales_mobile_page.s96', __t('delivery_reps.van_sales_mobile_page.s96', "إغلاق السجل")) : __t('delivery_reps.van_sales_mobile_page.s97', __t('delivery_reps.van_sales_mobile_page.s97', "سجل الوقود والصيانة"))}
                    </button>
                  </div>

                  {/* Embedded Fleet & Fuel Logs Tab inside Vehicle Card */}
                  {showFleetInCockpit && (
                    <div style={{ marginTop: '14px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
                      <VanFleetTab
                        vehicle={vehicle}
                        tripId={data?.trip?.id}
                        maintenanceAlerts={maintenanceAlerts}
                        fuelLogs={fuelLogs}
                        onRefreshFuel={() => {
                          refetchFuelLogs();
                          refetch();
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* 2. Morning Operations & Trip Launch Card */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    padding: '10px 12px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <PackageIcon size={15} color="#170e5e" />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '12.5px', fontWeight: 800, color: '#0f172a' }}>{__t('delivery_reps.van_sales_mobile_page.s98', __t('delivery_reps.van_sales_mobile_page.s98', "بدء رحلة التوزيع والعمليات الميدانية"))}</h3>
                      <span style={{ fontSize: '10px', color: '#64748b' }}>{__t('delivery_reps.van_sales_mobile_page.s99', __t('delivery_reps.van_sales_mobile_page.s99', "إعداد بضاعة السيارة والانطلاق للميدان"))}</span>
                    </div>
                  </div>

                  {/* Existing Stock Banner */}
                  {data?.inventory && data.inventory.length > 0 ? (
                    <div
                      style={{
                        backgroundColor: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        marginBottom: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div>
                        <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#1e40af', display: 'block' }}>
                          {__t('delivery_reps.van_sales_mobile_page.s100', __t('delivery_reps.van_sales_mobile_page.s100', "يوجد بضاعة متوفرة بالسيارة حالياً ("))}{data.inventory.length} {__t('delivery_reps.van_sales_mobile_page.s101', __t('delivery_reps.van_sales_mobile_page.s101', "أصناف)"))}
                        </span>
                        <span style={{ fontSize: '10px', color: '#3b82f6' }}>
                          {__t('delivery_reps.van_sales_mobile_page.s102', __t('delivery_reps.van_sales_mobile_page.s102', "إجمالي القيمة:"))} {totalInventoryValue.toFixed(2)} {getGlobalCurrencySymbol()} {__t('delivery_reps.van_sales_mobile_page.s103', __t('delivery_reps.van_sales_mobile_page.s103', "جاهزة للبيع الفوري"))}
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        onClick={() => startTripMutation.mutate()}
                        disabled={startTripMutation.isPending}
                        style={{
                          backgroundColor: '#170e5e',
                          color: '#ffffff',
                          fontSize: '11.5px',
                          fontWeight: 800,
                          width: '100%',
                          height: '34px',
                          borderRadius: '7px',
                          justifyContent: 'center',
                          boxShadow: '0 2px 6px rgba(23, 14, 94, 0.15)',
                        }}
                      >
                        {startTripMutation.isPending ? __t('delivery_reps.van_sales_mobile_page.s104', __t('delivery_reps.van_sales_mobile_page.s104', "جاري بدء الرحلة...")) : __t('delivery_reps.van_sales_mobile_page.s105', __t('delivery_reps.van_sales_mobile_page.s105', "بدء رحلة التوزيع بالبضاعة الحالية"))}
                      </Button>
                    </div>
                  ) : (
                    <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 8px', lineHeight: 1.45 }}>
                      {__t('delivery_reps.van_sales_mobile_page.s106', __t('delivery_reps.van_sales_mobile_page.s106', "سيارتك جاهزة لبدء العمل! يمكنك إرسال طلب شحن بضاعة لمشرف المستودع للمراجعة وصرف البضاعة، أو بدء الرحلة مباشرة للتحصيل وزيارة المتاجر."))}
                    </p>
                  )}

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
                    <Button
                      variant="primary"
                      onClick={() => setViewMode('new-requisition')}
                      style={{
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                        fontSize: '11.5px',
                        fontWeight: 800,
                        width: '100%',
                        height: '35px',
                        borderRadius: '7px',
                        justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(23, 14, 94, 0.15)',
                      }}
                    >
                      {__t('delivery_reps.van_sales_mobile_page.s107', __t('delivery_reps.van_sales_mobile_page.s107', "+ إنشاء طلب شحن بضاعة (إذن تحميل)"))}
                    </Button>
                    <div
                      className="keep-grid-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: (!data?.inventory || data.inventory.length === 0) ? '1fr 1fr' : '1fr',
                        gap: '6px',
                        width: '100%',
                      }}
                    >
                      {(!data?.inventory || data.inventory.length === 0) && (
                        <Button
                          variant="secondary"
                          onClick={() => startTripMutation.mutate()}
                          disabled={startTripMutation.isPending}
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            width: '100%',
                            height: '33px',
                            borderRadius: '7px',
                            justifyContent: 'center',
                            backgroundColor: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            color: '#0f172a',
                          }}
                        >
                          {startTripMutation.isPending ? __t('delivery_reps.van_sales_mobile_page.s108', __t('delivery_reps.van_sales_mobile_page.s108', "جاري فتح الرحلة...")) : __t('delivery_reps.van_sales_mobile_page.s109', __t('delivery_reps.van_sales_mobile_page.s109', "بدء الرحلة مباشرة"))}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        onClick={() => refetch()}
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          width: '100%',
                          height: '33px',
                          borderRadius: '7px',
                          justifyContent: 'center',
                          backgroundColor: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          color: '#0f172a',
                        }}
                      >
                        {__t('delivery_reps.van_sales_mobile_page.s110', __t('delivery_reps.van_sales_mobile_page.s110', "تحديث حالة الرحلة"))}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* 3. Today's Scheduled Route Strip */}
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    padding: '10px 12px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <MapPinIcon size={15} color="#15803d" />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '12px', fontWeight: 800, color: '#0f172a' }}>
                        {__t('delivery_reps.van_sales_mobile_page.s111', __t('delivery_reps.van_sales_mobile_page.s111', "خط سير اليوم:"))} {itinerary.length} {__t('delivery_reps.van_sales_mobile_page.s112', __t('delivery_reps.van_sales_mobile_page.s112', "متاجر مجدولة"))}
                      </h4>
                      <span style={{ fontSize: '10px', color: '#64748b' }}>
                        {__t('delivery_reps.van_sales_mobile_page.s113', __t('delivery_reps.van_sales_mobile_page.s113', "استعرض قائمة المحلات ومواقعها وأرقام الهواتف للاستعداد الميداني"))}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('itinerary')}
                    style={{
                      width: '100%',
                      height: '33px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      color: '#170e5e',
                      borderRadius: '7px',
                      padding: '0 10px',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'none',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s114', __t('delivery_reps.van_sales_mobile_page.s114', "استعراض خط السير ("))}{itinerary.length} {__t('delivery_reps.van_sales_mobile_page.s115', __t('delivery_reps.van_sales_mobile_page.s115', "متجر مجدول)"))}
                  </button>
                </div>

                {/* 4. Recent Requisitions List */}
                {myRequisitions.length > 0 && (
                  <div
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '16px',
                      border: '1px solid #e2e8f0',
                      padding: '16px 18px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: '3px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
                        <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                          {__t('delivery_reps.van_sales_mobile_page.s116', __t('delivery_reps.van_sales_mobile_page.s116', "أحدث طلبات شحن وتحميل السيارة:"))}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('inventory');
                          setInventorySubMode('requisitions');
                        }}
                        style={{ backgroundColor: 'transparent', border: 'none', color: '#4338ca', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        {__t('delivery_reps.van_sales_mobile_page.s117', __t('delivery_reps.van_sales_mobile_page.s117', "عرض الكل ("))}{myRequisitions.length})
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {myRequisitions.slice(0, 3).map((req) => (
                        <div
                          key={req.id}
                          style={{
                            backgroundColor: '#f8fafc',
                            borderRadius: '8px',
                            padding: '10px 12px',
                            border: '1px solid #e2e8f0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', display: 'block' }}>
                              {__t('delivery_reps.van_sales_mobile_page.s118', __t('delivery_reps.van_sales_mobile_page.s118', "طلب شحن #"))}{req.docNo}
                            </span>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              {__t('delivery_reps.van_sales_mobile_page.s119', __t('delivery_reps.van_sales_mobile_page.s119', "المستودع:"))} {req.sourceWarehouseName} • {req.requestedItems.length} {__t('delivery_reps.van_sales_mobile_page.s120', __t('delivery_reps.van_sales_mobile_page.s120', "أصناف"))}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 800,
                              padding: '3px 8px',
                              borderRadius: '6px',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                              backgroundColor:
                                req.status === 'dispatched'
                                  ? '#dcfce7'
                                  : req.status === 'rejected'
                                  ? '#fee2e2'
                                  : '#fef3c7',
                              color:
                                req.status === 'dispatched'
                                  ? '#15803d'
                                  : req.status === 'rejected'
                                  ? '#b91c1c'
                                  : '#b45309',
                            }}
                          >
                            {req.status === 'dispatched'
                              ? __t('delivery_reps.van_sales_mobile_page.s121', __t('delivery_reps.van_sales_mobile_page.s121', "تم الصرف"))
                              : req.status === 'rejected'
                              ? __t('delivery_reps.van_sales_mobile_page.s122', __t('delivery_reps.van_sales_mobile_page.s122', "مرفوض"))
                              : __t('delivery_reps.van_sales_mobile_page.s123', __t('delivery_reps.van_sales_mobile_page.s123', "قيد المراجعة"))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: ITINERARY (Works before & during active trip) */}
            {currentTab === 'itinerary' && (
              <VanItineraryTab
                itinerary={itinerary}
                tripId={data?.trip?.id}
                isLoading={isItineraryLoading}
                activeVisit={activeVisit}
                onStartVisit={handleStartVisit}
                onEndVisit={handleEndVisit}
                targetMetrics={data?.targetMetrics}
                inventory={data?.inventory || []}
                allAvailableCustomers={allAvailableCustomers}
                onSelectCustomerForSale={(customerId) => {
                  const cust = allAvailableCustomers.find((c) => c.id === customerId);
                  const proceedToSale = () => {
                    setSelectedCustomerId(customerId);
                    setNewCustomerName('');
                    if (data?.hasActiveTrip) {
                      setActiveTab('sale');
                    } else {
                      toast.info(__t('delivery_reps.van_sales_mobile_page.s124', __t('delivery_reps.van_sales_mobile_page.s124', "يرجى بدء رحلة التوزيع أولاً لإصدار فاتورة بيع")));
                    }
                  };
                  if (cust && (!activeVisit || activeVisit.customerId !== customerId)) {
                    handleStartVisit(customerId, cust.name, proceedToSale);
                  } else {
                    proceedToSale();
                  }
                }}
                onSelectCustomerForReturn={(customerId) => {
                  const cust = allAvailableCustomers.find((c) => c.id === customerId);
                  const proceedToReturn = () => {
                    setColSubMode('return');
                    setColReturnCustomerId(customerId);
                    setColCustomerId(customerId);
                    if (data?.hasActiveTrip) {
                      setActiveTab('collection');
                    } else {
                      toast.info(__t('delivery_reps.van_sales_mobile_page.s125', __t('delivery_reps.van_sales_mobile_page.s125', "يرجى بدء رحلة التوزيع أولاً لتسجيل مرتجع بضاعة")));
                    }
                  };
                  if (cust && (!activeVisit || activeVisit.customerId !== customerId)) {
                    handleStartVisit(customerId, cust.name, proceedToReturn);
                  } else {
                    proceedToReturn();
                  }
                }}
                onSelectCustomerForCollection={(customerId) => {
                  const cust = allAvailableCustomers.find((c) => c.id === customerId);
                  const proceedToCollection = () => {
                    setColSubMode('collection');
                    setColCustomerId(customerId);
                    if (data?.hasActiveTrip) {
                      setActiveTab('collection');
                    } else {
                      toast.info(__t('delivery_reps.van_sales_mobile_page.s126', __t('delivery_reps.van_sales_mobile_page.s126', "يرجى بدء رحلة التوزيع أولاً لتسجيل سند تحصيل")));
                    }
                  };
                  if (cust && (!activeVisit || activeVisit.customerId !== customerId)) {
                    handleStartVisit(customerId, cust.name, proceedToCollection);
                  } else {
                    proceedToCollection();
                  }
                }}
                onRefreshItinerary={() => {
                  refetchItinerary();
                  queryClient.invalidateQueries({ queryKey: ['van-sales-active-trip'] });
                }}
              />
            )}

            {/* TAB CONTENT: INVENTORY (بضاعة السيارة & طلبات شحن السيارة) */}
            {currentTab === 'inventory' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                {/* Segmented Sub-Header for Stock vs Requisitions */}
                <div
                  style={{
                    display: 'flex',
                    backgroundColor: '#e2e8f0',
                    padding: '3px',
                    borderRadius: '10px',
                    gap: '4px',
                    width: '100%',
                    minWidth: 0,
                    boxSizing: 'border-box',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setInventorySubMode('stock')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: inventorySubMode === 'stock' ? '#170e5e' : 'transparent',
                      color: inventorySubMode === 'stock' ? '#ffffff' : '#475569',
                      fontWeight: 700,
                      fontSize: '12px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {__t('delivery_reps.van_sales_mobile_page.s127', __t('delivery_reps.van_sales_mobile_page.s127', "بضاعة السيارة"))} {data?.inventory?.length ? `(${data.inventory.length})` : '(0)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInventorySubMode('requisitions')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: inventorySubMode === 'requisitions' ? '#170e5e' : 'transparent',
                      color: inventorySubMode === 'requisitions' ? '#ffffff' : '#475569',
                      fontWeight: 700,
                      fontSize: '12px',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>{__t('delivery_reps.van_sales_mobile_page.s128', __t('delivery_reps.van_sales_mobile_page.s128', "طلبات شحن السيارة"))}</span>
                    {myRequisitions.length > 0 && (
                      <span
                        style={{
                          backgroundColor: inventorySubMode === 'requisitions' ? 'rgba(255,255,255,0.25)' : '#cbd5e1',
                          color: inventorySubMode === 'requisitions' ? '#ffffff' : '#1e293b',
                          padding: '1px 6px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 800,
                        }}
                      >
                        {myRequisitions.length}
                      </span>
                    )}
                  </button>
                </div>

                {inventorySubMode === 'stock' ? (
                  <VanInventoryTab
                    stockSearch={stockSearch}
                    onSearchChange={setStockSearch}
                    filteredInventory={filteredInventory}
                    cart={cart}
                    cartTotal={cartTotal}
                    onAddToCart={(item) => {
                      if (data?.hasActiveTrip) {
                        addToCart(item);
                      } else {
                        toast.info(__t('delivery_reps.van_sales_mobile_page.s129', __t('delivery_reps.van_sales_mobile_page.s129', "يرجى بدء رحلة التوزيع أولاً لإضافة الأصناف للفاتورة")));
                      }
                    }}
                    onUpdateCartQty={updateCartQty}
                    onGoToSale={() => setActiveTab('sale')}
                    onOpenTransferModal={() => setTransferModalOpen(true)}
                    onRequestRequisition={() => setViewMode('new-requisition')}
                    pendingTransfersCount={peerTransfers.filter((t) => t.status === 'pending').length}
                  />
                ) : (
                  <div style={{ backgroundColor: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '14px', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'nowrap', gap: '8px' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {__t('delivery_reps.van_sales_mobile_page.s130', __t('delivery_reps.van_sales_mobile_page.s130', "طلبات شحن السيارة"))}
                        </h3>
                        <span style={{ fontSize: '10.5px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                          {__t('delivery_reps.van_sales_mobile_page.s131', __t('delivery_reps.van_sales_mobile_page.s131', "صرف بضاعة المستودع إلى سيارة التوزيع"))}
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        onClick={() => setViewMode('new-requisition')}
                        style={{
                          backgroundColor: '#170e5e',
                          color: '#ffffff',
                          fontSize: '11.5px',
                          fontWeight: 800,
                          height: '32px',
                          padding: '0 10px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        {__t('delivery_reps.van_sales_mobile_page.s132', __t('delivery_reps.van_sales_mobile_page.s132', "+ طلب شحن جديد"))}
                      </Button>
                    </div>

                    {myRequisitions.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '36px 0', color: '#94a3b8' }}>
                        <PackageIcon size={32} color="#cbd5e1" style={{ margin: '0 auto 8px', display: 'block' }} />
                        <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{__t('delivery_reps.van_sales_mobile_page.s133', __t('delivery_reps.van_sales_mobile_page.s133', "لا توجد طلبات شحن سابقة مسجلة"))}</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {myRequisitions.map((req) => (
                          <div
                            key={req.id}
                            style={{
                              backgroundColor: '#f8fafc',
                              borderRadius: '10px',
                              padding: '12px 14px',
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                                {__t('delivery_reps.van_sales_mobile_page.s134', __t('delivery_reps.van_sales_mobile_page.s134', "طلب شحن #"))}{req.docNo}
                              </span>
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                  backgroundColor:
                                    req.status === 'dispatched'
                                      ? '#dcfce7'
                                      : req.status === 'rejected'
                                      ? '#fee2e2'
                                      : '#fef3c7',
                                  color:
                                    req.status === 'dispatched'
                                      ? '#15803d'
                                      : req.status === 'rejected'
                                      ? '#b91c1c'
                                      : '#b45309',
                                }}
                              >
                                {req.status === 'dispatched'
                                  ? __t('delivery_reps.van_sales_mobile_page.s135', __t('delivery_reps.van_sales_mobile_page.s135', "تم الصرف"))
                                  : req.status === 'rejected'
                                  ? __t('delivery_reps.van_sales_mobile_page.s136', __t('delivery_reps.van_sales_mobile_page.s136', "مرفوض"))
                                  : __t('delivery_reps.van_sales_mobile_page.s137', __t('delivery_reps.van_sales_mobile_page.s137', "قيد المراجعة"))}
                              </span>
                            </div>
                            <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                              <span>{__t('delivery_reps.van_sales_mobile_page.s138', __t('delivery_reps.van_sales_mobile_page.s138', "المستودع المصدر:"))} <strong style={{ color: '#0f172a' }}>{req.sourceWarehouseName}</strong></span>
                              <span>{__t('delivery_reps.van_sales_mobile_page.s139', __t('delivery_reps.van_sales_mobile_page.s139', "الأصناف المطلوبة:"))} <strong style={{ color: '#0f172a' }}>{req.requestedItems.length} {__t('delivery_reps.van_sales_mobile_page.s140', __t('delivery_reps.van_sales_mobile_page.s140', "صنف"))}</strong></span>
                              <span>{__t('delivery_reps.van_sales_mobile_page.s141', __t('delivery_reps.van_sales_mobile_page.s141', "تاريخ الطلب:"))} {new Date(req.createdAt).toLocaleDateString('ar-EG')}</span>
                            </div>
                            {req.rejectionReason && (
                              <div
                                style={{
                                  marginTop: '6px',
                                  padding: '4px 8px',
                                  backgroundColor: '#fef2f2',
                                  border: '1px solid #fee2e2',
                                  borderRadius: '6px',
                                  fontSize: '10.5px',
                                  color: '#b91c1c',
                                  fontWeight: 600,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                                title={req.rejectionReason}
                              >
                                <span style={{ fontWeight: 800, flexShrink: 0 }}>{__t('delivery_reps.van_sales_mobile_page.s142', __t('delivery_reps.van_sales_mobile_page.s142', "سبب الرفض:"))}</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {req.rejectionReason}
                                </span>
                              </div>
                            )}

                            {req.status === 'pending' && (
                              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={async () => {
                                    const confirmed = await systemConfirm({
                                      title: __t('delivery_reps.van_sales_mobile_page.s143', __t('delivery_reps.van_sales_mobile_page.s143', "إلغاء طلب إذن التحميل")),
                                      message: `هل تريد إلغاء طلب إذن التحميل #${req.docNo} وإعادة تجهيز أصنافه؟`,
                                      confirmText: __t('delivery_reps.van_sales_mobile_page.s144', __t('delivery_reps.van_sales_mobile_page.s144', "نعم، إلغاء وتجهيز")),
                                      cancelText: __t('delivery_reps.van_sales_mobile_page.s145', __t('delivery_reps.van_sales_mobile_page.s145', "تراجع")),
                                    });
                                    if (!confirmed) return;
                                    try {
                                      await vanSalesApi.cancelMyRequisition(req.id);
                                      queryClient.invalidateQueries({ queryKey: ['driver-my-requisitions'] });
                                      showAlert('success', `تم إلغاء طلب إذن التحميل #${req.docNo} واسترجاع الأصناف بنجاح`);
                                      setViewMode('new-requisition');
                                    } catch (err: any) {
                                      showAlert('error', err?.message || __t('delivery_reps.van_sales_mobile_page.s146', __t('delivery_reps.van_sales_mobile_page.s146', "فشل إلغاء الطلب")));
                                    }
                                  }}
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    color: '#b45309',
                                    backgroundColor: '#fef3c7',
                                    borderColor: '#fde68a',
                                    padding: '4px 10px',
                                    height: '28px',
                                    borderRadius: '6px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  <RefreshCwIcon size={12} />
                                  <span>{__t('delivery_reps.van_sales_mobile_page.s147', __t('delivery_reps.van_sales_mobile_page.s147', "إلغاء الطلب المعلق وتعديل الأصناف"))}</span>
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: FLEET & FUEL (Works before & during active trip) */}
            {currentTab === 'fleet' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('cockpit')}
                  style={{
                    alignSelf: 'flex-start',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#170e5e',
                    cursor: 'pointer',
                  }}
                >
                  {__t('delivery_reps.van_sales_mobile_page.s148', __t('delivery_reps.van_sales_mobile_page.s148', "← عودة لمركز القيادة (الرئيسية)"))}
                </button>
                <VanFleetTab
                  vehicle={vehicle}
                  tripId={data?.trip?.id}
                  maintenanceAlerts={maintenanceAlerts}
                  fuelLogs={fuelLogs}
                  onRefreshFuel={() => {
                    refetchFuelLogs();
                    refetch();
                  }}
                />
              </div>
            )}

            {/* TAB CONTENT: REQUISITIONS (Direct Link Fallback) */}
            {currentTab === 'requisitions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('inventory');
                    setInventorySubMode('stock');
                  }}
                  style={{
                    alignSelf: 'flex-start',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#170e5e',
                    cursor: 'pointer',
                  }}
                >
                  {__t('delivery_reps.van_sales_mobile_page.s149', __t('delivery_reps.van_sales_mobile_page.s149', "← عودة لبضاعة السيارة (المخزون)"))}
                </button>
                <div style={{ backgroundColor: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'nowrap', gap: '8px' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {__t('delivery_reps.van_sales_mobile_page.s150', __t('delivery_reps.van_sales_mobile_page.s150', "طلبات شحن السيارة"))}
                      </h3>
                      <span style={{ fontSize: '10.5px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
                        {__t('delivery_reps.van_sales_mobile_page.s151', __t('delivery_reps.van_sales_mobile_page.s151', "صرف بضاعة المستودع إلى سيارة التوزيع"))}
                      </span>
                    </div>
                    <Button
                      variant="primary"
                      onClick={() => setViewMode('new-requisition')}
                      style={{
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                        fontSize: '11.5px',
                        fontWeight: 800,
                        height: '32px',
                        padding: '0 10px',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {__t('delivery_reps.van_sales_mobile_page.s152', __t('delivery_reps.van_sales_mobile_page.s152', "+ طلب شحن جديد"))}
                    </Button>
                  </div>

                  {myRequisitions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '36px 0', color: '#94a3b8' }}>
                      <PackageIcon size={32} color="#cbd5e1" style={{ margin: '0 auto 8px', display: 'block' }} />
                      <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{__t('delivery_reps.van_sales_mobile_page.s153', __t('delivery_reps.van_sales_mobile_page.s153', "لا توجد طلبات شحن سابقة مسجلة"))}</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {myRequisitions.map((req) => (
                        <div
                          key={req.id}
                          style={{
                            backgroundColor: '#f8fafc',
                            borderRadius: '10px',
                            padding: '12px 14px',
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                              {__t('delivery_reps.van_sales_mobile_page.s154', __t('delivery_reps.van_sales_mobile_page.s154', "طلب شحن #"))}{req.docNo}
                            </span>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 800,
                                padding: '3px 8px',
                                borderRadius: '6px',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                                backgroundColor:
                                  req.status === 'dispatched'
                                    ? '#dcfce7'
                                    : req.status === 'rejected'
                                    ? '#fee2e2'
                                    : '#fef3c7',
                                color:
                                  req.status === 'dispatched'
                                    ? '#15803d'
                                    : req.status === 'rejected'
                                    ? '#b91c1c'
                                    : '#b45309',
                              }}
                            >
                              {req.status === 'dispatched'
                                ? __t('delivery_reps.van_sales_mobile_page.s155', __t('delivery_reps.van_sales_mobile_page.s155', "تم الصرف"))
                                : req.status === 'rejected'
                                ? __t('delivery_reps.van_sales_mobile_page.s156', __t('delivery_reps.van_sales_mobile_page.s156', "مرفوض"))
                                : __t('delivery_reps.van_sales_mobile_page.s157', __t('delivery_reps.van_sales_mobile_page.s157', "قيد المراجعة"))}
                            </span>
                          </div>
                          <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                            <span>{__t('delivery_reps.van_sales_mobile_page.s158', __t('delivery_reps.van_sales_mobile_page.s158', "المستودع المصدر:"))} <strong style={{ color: '#0f172a' }}>{req.sourceWarehouseName}</strong></span>
                            <span>{__t('delivery_reps.van_sales_mobile_page.s159', __t('delivery_reps.van_sales_mobile_page.s159', "الأصناف المطلوبة:"))} <strong style={{ color: '#0f172a' }}>{req.requestedItems.length} {__t('delivery_reps.van_sales_mobile_page.s160', __t('delivery_reps.van_sales_mobile_page.s160', "صنف"))}</strong></span>
                            <span>{__t('delivery_reps.van_sales_mobile_page.s161', __t('delivery_reps.van_sales_mobile_page.s161', "تاريخ الطلب:"))} {new Date(req.createdAt).toLocaleDateString('ar-EG')}</span>
                          </div>
                          {req.rejectionReason && (
                            <div
                              style={{
                                marginTop: '6px',
                                padding: '4px 8px',
                                backgroundColor: '#fef2f2',
                                border: '1px solid #fee2e2',
                                borderRadius: '6px',
                                fontSize: '10.5px',
                                color: '#b91c1c',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                              title={req.rejectionReason}
                            >
                              <span style={{ fontWeight: 800, flexShrink: 0 }}>{__t('delivery_reps.van_sales_mobile_page.s162', __t('delivery_reps.van_sales_mobile_page.s162', "سبب الرفض:"))}</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {req.rejectionReason}
                              </span>
                            </div>
                          )}

                          {req.status === 'pending' && (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={async () => {
                                  const confirmed = await systemConfirm({
                                    title: __t('delivery_reps.van_sales_mobile_page.s163', __t('delivery_reps.van_sales_mobile_page.s163', "إلغاء طلب إذن التحميل")),
                                    message: `هل تريد إلغاء طلب إذن التحميل #${req.docNo} وإعادة تجهيز أصنافه؟`,
                                    confirmText: __t('delivery_reps.van_sales_mobile_page.s164', __t('delivery_reps.van_sales_mobile_page.s164', "نعم، إلغاء وتجهيز")),
                                    cancelText: __t('delivery_reps.van_sales_mobile_page.s165', __t('delivery_reps.van_sales_mobile_page.s165', "تراجع")),
                                  });
                                  if (!confirmed) return;
                                  try {
                                    await vanSalesApi.cancelMyRequisition(req.id);
                                    queryClient.invalidateQueries({ queryKey: ['driver-my-requisitions'] });
                                    showAlert('success', `تم إلغاء طلب إذن التحميل #${req.docNo} واسترجاع الأصناف بنجاح`);
                                    setViewMode('new-requisition');
                                  } catch (err: any) {
                                    showAlert('error', err?.message || __t('delivery_reps.van_sales_mobile_page.s166', __t('delivery_reps.van_sales_mobile_page.s166', "فشل إلغاء الطلب")));
                                  }
                                }}
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  color: '#b45309',
                                  backgroundColor: '#fef3c7',
                                  borderColor: '#fde68a',
                                  padding: '4px 10px',
                                  height: '28px',
                                  borderRadius: '6px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <RefreshCwIcon size={12} />
                                <span>{__t('delivery_reps.van_sales_mobile_page.s167', __t('delivery_reps.van_sales_mobile_page.s167', "إلغاء الطلب المعلق وتعديل الأصناف"))}</span>
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: SALE */}
            {currentTab === 'sale' && (
              data?.hasActiveTrip ? (
                <VanSaleTab
                  customers={allAvailableCustomers}
                  selectedCustomerId={selectedCustomerId}
                  onSelectCustomer={(val) => {
                    if (val) {
                      const cust = allAvailableCustomers.find((c) => c.id === Number(val));
                      if (cust && (!activeVisit || activeVisit.customerId !== Number(val))) {
                        handleStartVisit(Number(val), cust.name, () => {
                          setSelectedCustomerId(val);
                          setNewCustomerName('');
                        });
                        return;
                      }
                      setSelectedCustomerId(val);
                      setNewCustomerName('');
                    } else {
                      setSelectedCustomerId('');
                    }
                  }}
                  newCustomerName={newCustomerName}
                  onNewCustomerNameChange={setNewCustomerName}
                  paymentMethod={paymentMethod}
                  onPaymentMethodChange={setPaymentMethod}
                  cart={cart}
                  onUpdateCartQty={updateCartQty}
                  onToggleBonus={toggleCartItemBonus}
                  onChangeUnit={changeCartItemUnit}
                  cartTotal={cartTotal}
                  inventory={data?.inventory || []}
                  onAddToCart={addToCart}
                  deliveryProofPhoto={deliveryProofPhoto}
                  onDeliveryProofPhotoChange={setDeliveryProofPhoto}
                  cartonsCount={cartonsCount}
                  onCartonsCountChange={setCartonsCount}
                  onGoToInventory={() => setActiveTab('inventory')}
                  onGoToSalesHistory={() => setActiveTab('sales-history')}
                  onSubmitSale={() => {
                    if (cart.length === 0) {
                      showAlert('error', __t('delivery_reps.van_sales_mobile_page.s168', __t('delivery_reps.van_sales_mobile_page.s168', "السلة فارغة حالياً. يرجى اختيار صنف واحد على الأقل لإصدار الفاتورة.")));
                      return;
                    }
                    if (selectedCustomerId && (!activeVisit || activeVisit.customerId !== Number(selectedCustomerId))) {
                      const cust = allAvailableCustomers.find((c) => c.id === Number(selectedCustomerId));
                      // INV-VAN-COLLECTION-GUARD-CONTINUATION: the visit is
                      // started with the checkout as its continuation —
                      // discarding it here made the first submit a no-op.
                      // The GPS warning shows only when GPS is actually
                      // mandatory for this rep (flag !== false).
                      if (session?.rep?.permissions?.require_gps_on_visit !== false) {
                        showAlert('warning', `يلزم تفعيل الـ GPS وبدء زيارة العميل "${cust?.name || ''}" أولاً لإصدار الفاتورة.`);
                      }
                      if (cust) {
                        handleStartVisit(Number(selectedCustomerId), cust.name, () => setCheckoutModalOpen(true));
                      }
                      return;
                    }
                    setCheckoutModalOpen(true);
                  }}
                  isSubmitting={executeSaleMutation.isPending}
                />
              ) : (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '36px 20px', textAlign: 'center' }}>
                  <div style={{ width: '56px', height: '56px', backgroundColor: '#eef2ff', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                    <ReceiptIcon size={28} color="#170e5e" />
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>{__t('delivery_reps.van_sales_mobile_page.s169', __t('delivery_reps.van_sales_mobile_page.s169', "نقطة بيع الفاتورة السريعة"))}</h3>
                  <p style={{ fontSize: '12.5px', color: '#64748b', margin: '0 auto 16px', maxWidth: '380px', lineHeight: 1.5 }}>
                    {__t('delivery_reps.van_sales_mobile_page.s170', __t('delivery_reps.van_sales_mobile_page.s170', "لبدء إضافة الأصناف وإصدار الفواتير للعملاء وإرفاق صور التسليم، يرجى بدء رحلة التوزيع أولاً."))}
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => startTripMutation.mutate()}
                    disabled={startTripMutation.isPending}
                    style={{ backgroundColor: '#170e5e', color: '#ffffff', fontSize: '12.5px', fontWeight: 800 }}
                  >
                    {startTripMutation.isPending ? __t('delivery_reps.van_sales_mobile_page.s171', __t('delivery_reps.van_sales_mobile_page.s171', "جاري بدء الرحلة...")) : __t('delivery_reps.van_sales_mobile_page.s172', __t('delivery_reps.van_sales_mobile_page.s172', "بدء رحلة التوزيع الآن"))}
                  </Button>
                </div>
              )
            )}

            {/* TAB CONTENT: PRE-SALES (Order Booking from Main Warehouse) */}
            {currentTab === 'pre-sales' && (
              <VanPreSalesTab
                customers={allAvailableCustomers}
                selectedCustomerId={selectedCustomerId}
                onSelectCustomer={(val) => {
                  if (val) {
                    const cust = allAvailableCustomers.find((c) => c.id === Number(val));
                    if (cust && (!activeVisit || activeVisit.customerId !== Number(val))) {
                      handleStartVisit(Number(val), cust.name, () => {
                        setSelectedCustomerId(val);
                        setNewCustomerName('');
                      });
                      return;
                    }
                    setSelectedCustomerId(val);
                    setNewCustomerName('');
                  } else {
                    setSelectedCustomerId('');
                  }
                }}
                repId={session.rep.id}
                repName={session.rep.name}
              />
            )}

            {/* TAB CONTENT: SALES HISTORY */}
            {currentTab === 'sales-history' && (
              <VanSalesHistoryTab
                tripId={data?.trip?.id}
                customers={allAvailableCustomers}
                onViewReceipt={(receiptData) => setLastSaleReceipt(receiptData)}
                onGoToNewSale={() => setActiveTab('sale')}
                storeName={data?.trip?.sourceWarehouseName || __t('delivery_reps.van_sales_mobile_page.s173', __t('delivery_reps.van_sales_mobile_page.s173', "مبيعات التوزيع الميداني"))}
              />
            )}

            {/* TAB CONTENT: COLLECTION */}
            {currentTab === 'collection' && (
              data?.hasActiveTrip ? (
                <VanCollectionTab
                  tripId={data.trip!.id}
                  customers={allAvailableCustomers}
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

      {/* Street Inter-Van Transfer Modal */}
      {(data?.trip || (data?.inventory && data.inventory.length > 0)) && (
        <VanTransferModal
          open={transferModalOpen}
          onClose={() => setTransferModalOpen(false)}
          inventory={data?.inventory || []}
          peerReps={peerReps}
          transfers={peerTransfers}
          onRefreshTransfers={() => refetchTransfers()}
          onRefreshInventory={() => refetch()}
        />
      )}

      {/* Field Sale Checkout & Payment Modal */}
      {data?.trip && checkoutModalOpen && (
        <VanSaleCheckoutModal
          open={checkoutModalOpen}
          onClose={() => setCheckoutModalOpen(false)}
          cart={cart}
          cartTotal={cartTotal}
          cartSubtotal={cartSubtotal}
          cartDiscount={cartDiscount}
          cartItemsCount={cart.length}
          cartTotalPieces={cart.reduce((s, it) => s + it.qty, 0)}
          customer={allAvailableCustomers.find((c) => String(c.id) === String(selectedCustomerId)) || null}
          newCustomerName={newCustomerName}
          cartonsCount={cartonsCount}
          onCartonsCountChange={setCartonsCount}
          deliveryProofPhoto={deliveryProofPhoto}
          onDeliveryProofPhotoChange={setDeliveryProofPhoto}
          notes={saleNotes}
          onNotesChange={setSaleNotes}
          isSubmitting={isCheckoutProcessing || executeSaleMutation.isPending}
          onConfirmCheckout={async (checkoutData) => {
            if (isCheckoutProcessingRef.current || executeSaleMutation.isPending) {
              return;
            }
            isCheckoutProcessingRef.current = true;
            setIsCheckoutProcessing(true);
            pendingAutoShareWhatsAppRef.current = Boolean(checkoutData.autoShareWhatsApp);

            const clientTxId = `van_sale_${data.trip!.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

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
              executeSaleMutation.mutate({
                tripId: data.trip!.id,
                clientTxId,
                customerId: selectedCustomerId ? Number(selectedCustomerId) : undefined,
                customerName: newCustomerName || undefined,
                paymentMethod: checkoutData.paymentMethod,
                paidAmount: checkoutData.paidAmount,
                cashDiscountAmount: checkoutData.cashDiscountAmount,
                subtotal: cartSubtotal,
                discount: cartDiscount,
                notes: checkoutData.notes,
                deliveryGpsLat: gpsLat,
                deliveryGpsLng: gpsLng,
                deliveryProofPhoto: checkoutData.deliveryProofPhoto || deliveryProofPhoto || undefined,
                supervisorOverridePin: checkoutData.supervisorOverridePin,
                supervisorOverrideReason: checkoutData.supervisorOverrideReason,
                transferReference: checkoutData.transferReference,
                transferReceiptUrl: checkoutData.transferReceiptUrl,
                recipientName: checkoutData.recipientName,
                recipientPhone: checkoutData.recipientPhone,
                recipientRole: checkoutData.recipientRole,
                recipientSignature: checkoutData.recipientSignature,
                packagingBreakdown: checkoutData.cartonsCount
                  ? {
                      cartonsCount: Number(checkoutData.cartonsCount) || 0,
                      piecesCount: cart.reduce((s, it) => s + it.qty * (it.unitMultiplier || 1), 0),
                      itemsCount: cart.length,
                    }
                  : undefined,
                items: cart.map((c) => ({
                  productId: c.productId,
                  qty: c.qty,
                  unitPrice: c.unitPrice,
                  originalPrice: c.originalPrice,
                  unitName: c.unitName,
                  unitMultiplier: c.unitMultiplier,
                  isBonus: c.isBonus,
                  bonusReason: c.bonusReason,
                })),
              });
            } catch (err) {
              isCheckoutProcessingRef.current = false;
              setIsCheckoutProcessing(false);
            }
          }}
        />
      )}

      {/* Sale Receipt Modal */}
      {lastSaleReceipt && (
        <VanSalesReceiptModal
          receipt={lastSaleReceipt}
          onClose={() => setLastSaleReceipt(null)}
          storeName={data?.trip?.sourceWarehouseName || __t('delivery_reps.van_sales_mobile_page.s183', __t('delivery_reps.van_sales_mobile_page.s183', "مبيعات التوزيع الميداني"))}
        />
      )}

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

      {/* Field Damaged / Broken Goods Instant Swap Modal */}
      {data?.trip && swapModalOpen && (
        <VanDamagedSwapModal
          open={swapModalOpen}
          onClose={() => setSwapModalOpen(false)}
          tripId={data.trip.id}
          inventory={data.inventory || []}
          customers={allAvailableCustomers}
          defaultCustomerId={selectedCustomerId ? Number(selectedCustomerId) : (activeVisit?.customerId || null)}
          onSwapSuccess={() => {
            refetch();
          }}
        />
      )}

      {/* Mandatory Store Visit GPS Geolocation Modal */}
      <VanGpsMandatoryModal
        open={gpsBlockedModalOpen}
        onClose={() => {
          setGpsBlockedModalOpen(false);
          setGpsBlockedInfo(null);
        }}
        customerName={gpsBlockedInfo?.customerName}
        errorMessage={gpsBlockedInfo?.errorMessage}
        isChecking={isCheckingGps}
        onRetry={handleRetryGpsCheck}
      />

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
