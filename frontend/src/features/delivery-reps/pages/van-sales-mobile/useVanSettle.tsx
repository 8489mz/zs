// Settle tab for the van sales mobile page — pure move of the settle
// state (counted cash, unload flag, expense/packaging modal state, the
// settle mutation, the last settlement receipt), the settle tab, and
// the settlement-receipt, trip-expense and trip-packaging modals.
// The facade calls the hook once and passes hook values as props; the
// tab and modals take the trip data and the visit and router values
// as props.
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { vanSalesApi, VanActiveTripResponse, VanTripExpense, VanPackagingMovement } from '@/features/delivery-reps/api/van-sales.api';
import { vanOfflineDb } from '@/features/delivery-reps/offline/van-sales-offline.db';
import { vanSyncEngine } from '@/features/delivery-reps/offline/van-sync.engine';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { ClockIcon } from '@/shared/components/icons/AppIcons';
import { VanSettleTab } from '@/features/delivery-reps/components/VanSettleTab';
import { VanSettlementReceiptModal } from '@/features/delivery-reps/components/VanSettlementReceiptModal';
import { VanTripExpenseModal } from '@/features/delivery-reps/components/VanTripExpenseModal';
import { VanTripPackagingModal } from '@/features/delivery-reps/components/VanTripPackagingModal';
import { VanSettlementReceiptData } from '@/features/delivery-reps/utils/van-settlement-receipt.utils';
import { DriverPortalUser } from '@/shared/api/delivery-reps.api';

export type VanMobileTabKey = 'cockpit' | 'itinerary' | 'inventory' | 'sale' | 'pre-sales' | 'sales-history' | 'collection' | 'fleet' | 'settle' | 'requisitions';

export interface UseVanSettleDeps {
  session: { token: string; rep: DriverPortalUser } | null;
  queryClient: QueryClient;
  showAlert: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
  data: VanActiveTripResponse | undefined;
  setActiveTab: React.Dispatch<React.SetStateAction<VanMobileTabKey>>;
  handleEndVisit: () => void;
}

export function useVanSettle({
  session,
  queryClient,
  showAlert,
  data,
  setActiveTab,
  handleEndVisit,
}: UseVanSettleDeps) {
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [packagingModalOpen, setPackagingModalOpen] = useState(false);

  const [countedCash, setCountedCash] = useState<string>('');
  const [unloadRemaining, setUnloadRemaining] = useState<boolean>(true);

  // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day counted cash for a trip
  // spanning more than one tenant day. The due comes from the server
  // (same buckets the settle step settles from); the inputs prefill
  // with the due and the rep adjusts what he actually counted.
  const [perDayCash, setPerDayCash] = useState<Record<string, string>>({});
  const [perDayPrefilledFor, setPerDayPrefilledFor] = useState<number | null>(null);
  const tripIdForDue = data?.trip?.id;
  const dueByDayQuery = useQuery({
    queryKey: ['van-trip-due-by-day', tripIdForDue],
    queryFn: () => vanSalesApi.getTripDueByDay(Number(tripIdForDue)),
    enabled: Boolean(tripIdForDue),
  });
  const perDayDue = dueByDayQuery.data?.days ?? [];
  const perDayMode = perDayDue.length > 1;
  React.useEffect(() => {
    if (!tripIdForDue || perDayPrefilledFor === tripIdForDue) return;
    const days = dueByDayQuery.data?.days;
    if (!days || days.length <= 1) return;
    const next: Record<string, string> = {};
    for (const d of days) next[d.businessDay] = String(d.due);
    setPerDayCash(next);
    setCountedCash(String(dueByDayQuery.data?.totalDue ?? ''));
    setPerDayPrefilledFor(tripIdForDue);
  }, [tripIdForDue, dueByDayQuery.data, perDayPrefilledFor]);
  const handlePerDayCashChange = (day: string, val: string) => {
    const next = { ...perDayCash, [day]: val };
    setPerDayCash(next);
    const total = Object.values(next).reduce((s, v) => s + (Number(v) || 0), 0);
    setCountedCash(Object.values(next).every((v) => v === '') ? '' : String(total));
  };
  const fillPerDayWithDue = () => {
    const next: Record<string, string> = {};
    for (const d of perDayDue) next[d.businessDay] = String(d.due);
    setPerDayCash(next);
    setCountedCash(String(perDayDue.reduce((s, d) => s + Number(d.due || 0), 0)));
  };

  const [lastSettlementReceipt, setLastSettlementReceipt] = useState<VanSettlementReceiptData | null>(null);

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
      setPerDayCash({});
      setPerDayPrefilledFor(null);
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

  return {
    expenseModalOpen,
    setExpenseModalOpen,
    packagingModalOpen,
    setPackagingModalOpen,
    countedCash,
    setCountedCash,
    unloadRemaining,
    setUnloadRemaining,
    perDayDue,
    perDayCash,
    perDayMode,
    handlePerDayCashChange,
    fillPerDayWithDue,
    lastSettlementReceipt,
    setLastSettlementReceipt,
    settleTripMutation,
  };
}

export interface SettleTabProps {
  settle: ReturnType<typeof useVanSettle>;
  data: VanActiveTripResponse | undefined;
  tripExpensesList: VanTripExpense[];
  tripPackagingList: VanPackagingMovement[];
  activeVisit: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
    latitude?: number;
    longitude?: number;
    visitId?: number;
  } | null;
  showAlert: UseVanSettleDeps['showAlert'];
}

export const SettleTab: React.FC<SettleTabProps> = ({
  settle,
  data,
  tripExpensesList,
  tripPackagingList,
  activeVisit,
  showAlert,
}) => {
  const { t: __t } = useTranslation();
  const {
    countedCash,
    setCountedCash,
    unloadRemaining,
    setUnloadRemaining,
    setExpenseModalOpen,
    setPackagingModalOpen,
    settleTripMutation,
    perDayDue,
    perDayCash,
    perDayMode,
    handlePerDayCashChange,
    fillPerDayWithDue,
  } = settle;
  return (
    <>
            {/* TAB CONTENT: SETTLE (Active Trip Only) */}
              {data?.hasActiveTrip ? (
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
                  perDayDue={perDayDue}
                  perDayCash={perDayCash}
                  onPerDayCashChange={handlePerDayCashChange}
                  onFillPerDayWithDue={fillPerDayWithDue}
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
                      // INV-VAN-DAILY-SPLIT-SETTLEMENT: multi-day trips
                      // settle per day; single-day trips keep the lump.
                      perDayCash: perDayMode
                        ? perDayDue.map((d) => ({ businessDay: d.businessDay, countedCash: Number(perDayCash[d.businessDay] ?? d.due) }))
                        : undefined,
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
              )}
    </>
  );
};

export interface SettlementReceiptModalProps {
  settle: ReturnType<typeof useVanSettle>;
  data: VanActiveTripResponse | undefined;
}

export const SettlementReceiptModal: React.FC<SettlementReceiptModalProps> = ({
  settle,
  data,
}) => {
  const { t: __t } = useTranslation();
  const { lastSettlementReceipt, setLastSettlementReceipt } = settle;
  return (
    <>
      {/* Cashier Handover Clearance Receipt Modal */}
      {lastSettlementReceipt && (
        <VanSettlementReceiptModal
          receipt={lastSettlementReceipt}
          onClose={() => setLastSettlementReceipt(null)}
          storeName={data?.trip?.sourceWarehouseName || __t('delivery_reps.van_sales_mobile_page.s185', __t('delivery_reps.van_sales_mobile_page.s185', "إدارة مبيعات وتوزيع الفان"))}
        />
      )}
    </>
  );
};

export interface TripExpenseModalProps {
  settle: ReturnType<typeof useVanSettle>;
  data: VanActiveTripResponse | undefined;
  refetch: () => void;
  refetchTripExpenses: () => void;
}

export const TripExpenseModal: React.FC<TripExpenseModalProps> = ({
  settle,
  data,
  refetch,
  refetchTripExpenses,
}) => {
  const { expenseModalOpen, setExpenseModalOpen } = settle;
  return (
    <>
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
    </>
  );
};

export interface TripPackagingModalProps {
  settle: ReturnType<typeof useVanSettle>;
  data: VanActiveTripResponse | undefined;
  allAvailableCustomers: any[];
  selectedCustomerId: number | '';
  activeVisit: SettleTabProps['activeVisit'];
  refetch: () => void;
  refetchTripPackaging: () => void;
}

export const TripPackagingModal: React.FC<TripPackagingModalProps> = ({
  settle,
  data,
  allAvailableCustomers,
  selectedCustomerId,
  activeVisit,
  refetch,
  refetchTripPackaging,
}) => {
  const { packagingModalOpen, setPackagingModalOpen } = settle;
  return (
    <>
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
    </>
  );
};
