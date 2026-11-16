// Visit tracking for the van sales mobile page — pure move of the
// active-visit state, the GPS-gated start and end visit handlers, the
// active-visit banner, the itinerary tab, and the mandatory GPS modal.
// The facade calls the hook once and passes hook values as props; the
// itinerary tab takes the trip data and the sale and collection setters
// as props, and the banner takes the tab router values as props.
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { vanSalesApi, VanActiveTripResponse, VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';
import { DriverPortalUser } from '@/shared/api/delivery-reps.api';
import { ClockIcon, ReceiptIcon } from '@/shared/components/icons/AppIcons';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import { VanItineraryTab } from '@/features/delivery-reps/components/VanItineraryTab';
import { VanGpsMandatoryModal } from '@/features/delivery-reps/components/VanGpsMandatoryModal';

export type VanMobileTabKey = 'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions';

export interface UseVanVisitDeps {
  session: { token: string; rep: DriverPortalUser } | null;
  data: VanActiveTripResponse | undefined;
}

export function useVanVisit({ session, data }: UseVanVisitDeps) {
  // Active Customer Visit Tracking
  const [activeVisit, setActiveVisit] = useState<{
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
    latitude?: number;
    longitude?: number;
    // P7 (RC-10): the server visit id from checkInVisit — ending the
    // visit calls checkOutVisit on it. Absent when the check-in never
    // reached the server (offline) or for a visit restored from an
    // older localStorage entry written before this field existed.
    visitId?: number;
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
      }).then((res: any) => {
        // P7: keep the server visit id — ending the visit calls
        // checkOutVisit on it (server stamps check-out + dwell).
        // The check-in is fire-and-forget, so a missing id just
        // means there is no server visit to close.
        if (res?.visitId) {
          setActiveVisit((prev) => {
            if (!prev || prev.customerId !== customerId) return prev;
            const withId = { ...prev, visitId: Number(res.visitId) };
            try { localStorage.setItem('zs_van_active_visit', JSON.stringify(withId)); } catch {}
            return withId;
          });
        }
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
      }).then((res: any) => {
        // P7: keep the server visit id — ending the visit calls
        // checkOutVisit on it (server stamps check-out + dwell).
        if (res?.visitId) {
          setActiveVisit((prev) => {
            if (!prev || prev.customerId !== customerId) return prev;
            const withId = { ...prev, visitId: Number(res.visitId) };
            try { localStorage.setItem('zs_van_active_visit', JSON.stringify(withId)); } catch {}
            return withId;
          });
        }
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
    // P7 (RC-10): the server owns the visit end — capture the id
    // BEFORE clearing local state, then close the visit server-side
    // (it stamps check_out_at + dwell_time_seconds; no client time
    // is sent). No server visit (offline check-in, or a visit
    // restored from an older localStorage entry without an id) means
    // there is nothing to close. A repeated call is harmless: the
    // backend re-stamps the same visit instead of erroring.
    const visitId = activeVisit?.visitId;
    setActiveVisit(null);
    try {
      localStorage.removeItem('zs_van_active_visit');
    } catch {}
    if (visitId) {
      vanSalesApi.checkOutVisit(visitId).catch(() => {
        toast.warning('تعذّر إغلاق الزيارة على الخادم — ستظل مفتوحة حتى إعادة المحاولة');
      });
    }
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

  return {
    activeVisit,
    setActiveVisit,
    visitDurationSecs,
    isCheckingGps,
    setIsCheckingGps,
    gpsBlockedModalOpen,
    setGpsBlockedModalOpen,
    gpsBlockedInfo,
    setGpsBlockedInfo,
    requestGpsPosition,
    handleStartVisit,
    handleRetryGpsCheck,
    handleEndVisit,
    formatDuration,
  };
}

export interface ActiveVisitBannerProps {
  visit: ReturnType<typeof useVanVisit>;
  currentTab: VanMobileTabKey;
  setActiveTab: React.Dispatch<React.SetStateAction<VanMobileTabKey>>;
  setSelectedCustomerId: React.Dispatch<React.SetStateAction<number | ''>>;
}

export const ActiveVisitBanner: React.FC<ActiveVisitBannerProps> = ({
  visit,
  currentTab,
  setActiveTab,
  setSelectedCustomerId,
}) => {
  const { t: __t } = useTranslation();
  const { activeVisit, visitDurationSecs, formatDuration, handleEndVisit } = visit;
  return (
    <>
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
    </>
  );
};

export interface ItineraryTabProps {
  visit: ReturnType<typeof useVanVisit>;
  data: VanActiveTripResponse | undefined;
  itinerary: VanCustomerItineraryItem[];
  isItineraryLoading: boolean;
  refetchItinerary: () => void;
  queryClient: QueryClient;
  allAvailableCustomers: any[];
  setSelectedCustomerId: React.Dispatch<React.SetStateAction<number | ''>>;
  setNewCustomerName: React.Dispatch<React.SetStateAction<string>>;
  setColCustomerId: React.Dispatch<React.SetStateAction<number | ''>>;
  setColSubMode: React.Dispatch<React.SetStateAction<'collection' | 'return'>>;
  setColReturnCustomerId: React.Dispatch<React.SetStateAction<number | ''>>;
  setActiveTab: React.Dispatch<React.SetStateAction<VanMobileTabKey>>;
}

export const ItineraryTab: React.FC<ItineraryTabProps> = ({
  visit,
  data,
  itinerary,
  isItineraryLoading,
  refetchItinerary,
  queryClient,
  allAvailableCustomers,
  setSelectedCustomerId,
  setNewCustomerName,
  setColCustomerId,
  setColSubMode,
  setColReturnCustomerId,
  setActiveTab,
}) => {
  const { t: __t } = useTranslation();
  const { activeVisit, handleStartVisit, handleEndVisit } = visit;
  return (
    <>
            {/* TAB CONTENT: ITINERARY (Works before & during active trip) */}
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
    </>
  );
};

export interface GpsMandatoryModalProps {
  visit: ReturnType<typeof useVanVisit>;
}

export const GpsMandatoryModal: React.FC<GpsMandatoryModalProps> = ({ visit }) => {
  const {
    gpsBlockedModalOpen,
    setGpsBlockedModalOpen,
    gpsBlockedInfo,
    setGpsBlockedInfo,
    isCheckingGps,
    handleRetryGpsCheck,
  } = visit;
  return (
    <>
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
    </>
  );
};
