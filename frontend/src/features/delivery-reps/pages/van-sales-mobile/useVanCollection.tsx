// Collection (cash + returns) for the van sales mobile page — pure move
// of the col* state, the record-collection mutation, the submit handler,
// the collection tab, and the collection receipt modal.
// The facade calls the hook once and passes hook values as props; the
// collection tab takes the trip data, the customer list, the visit state,
// and the trip-start mutation as props, and the receipt modal takes the
// trip data as a prop.
import { useTranslation } from 'react-i18next';
import React, { useState, useRef } from 'react';
import {useMutation, type QueryClient} from '@tanstack/react-query';
import { vanSalesApi, VanActiveTripResponse } from '@/features/delivery-reps/api/van-sales.api';
import { DriverPortalUser } from '@/shared/api/delivery-reps.api';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { Button } from '@/shared/ui/button';
import { ReceiptIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { vanOfflineDb } from '@/features/delivery-reps/offline/van-sales-offline.db';
import { VanCollectionTab } from '@/features/delivery-reps/components/VanCollectionTab';
import { VanCollectionReceiptModal } from '@/features/delivery-reps/components/VanCollectionReceiptModal';
import { VanCollectionReceiptData } from '@/features/delivery-reps/utils/van-collection-receipt.utils';

export type VanActiveVisit = {
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
} | null;

export interface UseVanCollectionDeps {
  session: { token: string; rep: DriverPortalUser } | null;
  queryClient: QueryClient;
  setPendingSyncCount: React.Dispatch<React.SetStateAction<number>>;
  showAlert: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
  data: VanActiveTripResponse | undefined;
  allAvailableCustomers: any[];
  activeVisit: VanActiveVisit;
}

export function useVanCollection({ session, queryClient, setPendingSyncCount, showAlert, data, allAvailableCustomers, activeVisit }: UseVanCollectionDeps) {
  const [colCustomerId, setColCustomerId] = useState<number | ''>('');
  const [colAmount, setColAmount] = useState<string>('');
  const [colSubMode, setColSubMode] = useState<'collection' | 'return'>('collection');
  const [colReturnCustomerId, setColReturnCustomerId] = useState<number | ''>('');

  const [lastCollectionReceipt, setLastCollectionReceipt] = useState<VanCollectionReceiptData | null>(null);

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

  return {
    colCustomerId,
    setColCustomerId,
    colAmount,
    setColAmount,
    colSubMode,
    setColSubMode,
    colReturnCustomerId,
    setColReturnCustomerId,
    lastCollectionReceipt,
    setLastCollectionReceipt,
    isCollectionProcessing,
    setIsCollectionProcessing,
    isCollectionProcessingRef,
    recordCollectionMutation,
    submitCollection,
  };
}

export interface CollectionTabProps {
  collection: ReturnType<typeof useVanCollection>;
  data: VanActiveTripResponse | undefined;
  allAvailableCustomers: any[];
  activeVisit: VanActiveVisit;
  handleStartVisit: (customerId: number, customerName: string, onSuccess?: () => void) => Promise<void>;
  session: { token: string; rep: DriverPortalUser } | null;
  startTripMutation: { mutate: (...args: any[]) => void; isPending: boolean };
  showAlert: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}

export const CollectionTab: React.FC<CollectionTabProps> = ({
  collection,
  data,
  allAvailableCustomers,
  activeVisit,
  handleStartVisit,
  session,
  startTripMutation,
  showAlert,
}) => {
  const { t: __t } = useTranslation();
  const {
    colCustomerId,
    setColCustomerId,
    colAmount,
    setColAmount,
    colSubMode,
    colReturnCustomerId,
    isCollectionProcessing,
    isCollectionProcessingRef,
    recordCollectionMutation,
    submitCollection,
  } = collection;
  return (
    <>
            {/* TAB CONTENT: COLLECTION */}
              {data?.hasActiveTrip ? (
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
              )}
    </>
  );
};

export interface CollectionReceiptModalProps {
  collection: ReturnType<typeof useVanCollection>;
  data: VanActiveTripResponse | undefined;
}

export const CollectionReceiptModal: React.FC<CollectionReceiptModalProps> = ({ collection, data }) => {
  const { t: __t } = useTranslation();
  const { lastCollectionReceipt, setLastCollectionReceipt } = collection;
  return (
    <>
      {/* Field Collection Receipt Modal */}
      {lastCollectionReceipt && (
        <VanCollectionReceiptModal
          receipt={lastCollectionReceipt}
          onClose={() => setLastCollectionReceipt(null)}
          storeName={data?.trip?.sourceWarehouseName || __t('delivery_reps.van_sales_mobile_page.s184', __t('delivery_reps.van_sales_mobile_page.s184', "إدارة التوزيع والتحصيل الميداني"))}
        />
      )}
    </>
  );
};
