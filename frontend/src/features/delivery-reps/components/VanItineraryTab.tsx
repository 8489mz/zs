import { useTranslation } from 'react-i18next';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { Button } from '@/shared/ui/button';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { toast } from '@/shared/components/system-alert';
import {
  vanSalesApi,
  VanCustomerItineraryItem,
  RouteOptimizationResult,
  RepTargetMetrics,
  VanStockItem,
} from '../api/van-sales.api';
import {
  MapPinIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  SearchIcon,
  PhoneIcon,
  ArrowRightIcon,
  CalendarIcon,
  AlertTriangleIcon,
  ChevronDownIcon,
  PlusIcon,
  SlidersIcon,
  PlayIcon,
  CreditCardIcon,
  ReceiptIcon,
  RotateCcwIcon,
  FileTextIcon,
  PackageIcon,
  RefreshCwIcon,
} from '@/shared/components/icons/AppIcons';
import { VanCustomerStatementModal } from './VanCustomerStatementModal';
import { VanStoreInventoryModal } from './VanStoreInventoryModal';
import { VanTradeSurveyModal } from './VanTradeSurveyModal';
import { VanDamagedSwapModal } from './VanDamagedSwapModal';
import { VanLiveTargetBoosterWidget } from './VanLiveTargetBoosterWidget';
export { normalizeDayKey, DAY_KEY_TO_ARABIC, ALL_WEEK_DAYS } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-day';
import { VanItineraryPagination } from '@/features/delivery-reps/components/van-itinerary/van-itinerary-pagination';
import { useVanItineraryFilters } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-filters';
import { useVanItineraryOrder } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-order';
import { useVanItineraryVisit } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-visit';
import { useVanItineraryAddCustomer } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-add-customer';
import { useVanItineraryNegativeVisit } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-negative-visit';
import { useVanItineraryList } from '@/features/delivery-reps/components/van-itinerary/use-van-itinerary-list';

interface VanItineraryTabProps {
  itinerary: VanCustomerItineraryItem[];
  tripId?: number;
  onSelectCustomerForSale: (customerId: number) => void;
  onSelectCustomerForReturn?: (customerId: number) => void;
  onSelectCustomerForCollection?: (customerId: number) => void;
  onRefreshItinerary: () => void;
  isLoading?: boolean;
  activeVisit?: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
  } | null;
  onStartVisit?: (customerId: number, customerName: string, onSuccess?: () => void) => void;
  onEndVisit?: () => void;
  targetMetrics?: RepTargetMetrics;
  inventory?: VanStockItem[];
  allAvailableCustomers?: Array<{ id: number; name: string; phone?: string }>;
}
export const VanItineraryTab: React.FC<VanItineraryTabProps> = ({
  itinerary,
  tripId,
  onSelectCustomerForSale,
  onSelectCustomerForReturn,
  onSelectCustomerForCollection,
  onRefreshItinerary,
  isLoading,
  activeVisit,
  onStartVisit,
  onEndVisit,
  targetMetrics,
  inventory,
  allAvailableCustomers,
}) => {
  const { t } = useTranslation();
  const filters = useVanItineraryFilters({ itinerary });
  const visit = useVanItineraryVisit({ activeVisit });
  const [inventoryCustomer, setInventoryCustomer] = useState<VanCustomerItineraryItem | null>(null);
  const [surveyCustomer, setSurveyCustomer] = useState<VanCustomerItineraryItem | null>(null);
  const [swapCustomer, setSwapCustomer] = useState<VanCustomerItineraryItem | null>(null);
  const order = useVanItineraryOrder();
  const add = useVanItineraryAddCustomer({ todayArabicName: filters.todayArabicName, savedDistrictsList: filters.savedDistrictsList, routes: filters.routes, onRefreshItinerary });
  const negative = useVanItineraryNegativeVisit({ tripId, activeVisit, onEndVisit, onRefreshItinerary });
  const [statementModalCust, setStatementModalCust] = useState<VanCustomerItineraryItem | null>(null);


  const list = useVanItineraryList({
    itinerary,
    filters,
    customDistrictOrder: order.customDistrictOrder,
    customCustomerOrder: order.customCustomerOrder,
    saveDistrictOrder: order.saveDistrictOrder,
    saveCustomerOrder: order.saveCustomerOrder,
  });
  // Dynamic Route Optimization (TSP)
  const [isOptimizeModalOpen, setIsOptimizeModalOpen] = useState(false);
  const [isOptimizingRoute, setIsOptimizingRoute] = useState(false);
  const [routeOptimizationResult, setRouteOptimizationResult] = useState<RouteOptimizationResult | null>(null);

  const handleRunRouteOptimization = async () => {
    const targetCustomers = list.filtered.filter((c) => c.visitStatus === 'pending');
    const custsToOptimize = targetCustomers.length > 0 ? targetCustomers : list.filtered;

    if (custsToOptimize.length <= 1) {
      toast.info('يجب وجود عميلين على الأقل لتحسين خط السير');
      return;
    }

    setIsOptimizingRoute(true);

    const executeOpt = async (startCoords?: { lat: number; lng: number }) => {
      try {
        const res = await vanSalesApi.optimizeDriverRoute({
          customerIds: custsToOptimize.map((c) => c.customerId),
          startLat: startCoords?.lat,
          startLng: startCoords?.lng,
          persistSequence: false,
        });

        if (res && res.stats) {
          setRouteOptimizationResult(res);
          setIsOptimizeModalOpen(true);
        } else {
          toast.error('لم يتمكن محرك المسارات من احتساب الترتيب الأمثل');
        }
      } catch (err: any) {
        toast.error(err?.message || 'حدث خطأ أثناء تحسين المسار');
      } finally {
        setIsOptimizingRoute(false);
      }
    };

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          executeOpt({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          executeOpt();
        },
        { timeout: 3500 },
      );
    } else {
      executeOpt();
    }
  };

  const handleApplyOptimalRoute = async () => {
    if (!routeOptimizationResult) return;
    try {
      setIsOptimizingRoute(true);
      const custIds = routeOptimizationResult.orderedStops.map((s) => s.id);
      await vanSalesApi.optimizeDriverRoute({
        customerIds: custIds,
        persistSequence: true,
      });

      const newCustOrderMap: Record<string, number[]> = {};
      for (const stop of routeOptimizationResult.orderedStops) {
        const dName = (stop.district || (stop as any).route || 'المنطقة العامة').trim();
        if (!newCustOrderMap[dName]) newCustOrderMap[dName] = [];
        newCustOrderMap[dName].push(stop.id);
      }

      order.setCustomCustomerOrder(newCustOrderMap);
      try {
        localStorage.setItem('zs_van_customer_order', JSON.stringify(newCustOrderMap));
      } catch {}

      toast.success(
        `تم اعتماد المسار الأمثل! توفير ${routeOptimizationResult.stats.savedDistanceKm} كم (${routeOptimizationResult.stats.savingsPercent}%)`,
      );
      setIsOptimizeModalOpen(false);
      onRefreshItinerary();
    } catch (err: any) {
      toast.error(err?.message || 'فشل حفظ الترتيب الأمثل');
    } finally {
      setIsOptimizingRoute(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: visit.selectedCustomerForHub ? '6px' : '10px', paddingBottom: visit.selectedCustomerForHub ? '85px' : '24px' }}>
      {visit.selectedCustomerForHub ? (
        /* Z-SYSTEMS OFFICIAL MOBILE VISUAL IDENTITY: ZERO-SCROLL CUSTOMER VISIT HUB */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* 1. STORE PROFILE HEADER CARD (Top Bar + Store Info + Quick Actions) */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '8px 12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {/* Row 1: Back Button + Customer Name + Phone / GPS Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                <button
                  type="button"
                  onClick={() => visit.setSelectedCustomerForHub(null)}
                  style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontWeight: 800,
                    color: '#170e5e',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    flexShrink: 0,
                  }}
                >
                  <ArrowRightIcon size={13} color="#170e5e" />
                  <span>{t('delivery_reps.van_itinerary_tab.s4', "خط السير")}</span>
                </button>

                <h2
                  style={{
                    margin: 0,
                    fontSize: '14px',
                    fontWeight: 900,
                    color: '#0f172a',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={visit.selectedCustomerForHub.customerName}
                >
                  {visit.selectedCustomerForHub.customerName}
                </h2>
              </div>

              {/* Call & GPS Action Buttons with soft squircle styling */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                {visit.selectedCustomerForHub.customerPhone ? (
                  <a
                    href={`tel:${visit.selectedCustomerForHub.customerPhone}`}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      color: '#1e293b',
                      borderRadius: '8px',
                      padding: '4px 8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      textDecoration: 'none',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    }}
                    title={visit.selectedCustomerForHub.customerPhone}
                  >
                    <PhoneIcon size={12} color="#170e5e" />
                    <span>{t('delivery_reps.van_itinerary_tab.s5', "اتصال")}</span>
                  </a>
                ) : null}

                {visit.selectedCustomerForHub.locationUrl ? (
                  <a
                    href={visit.selectedCustomerForHub.locationUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      color: '#1e293b',
                      borderRadius: '8px',
                      padding: '4px 8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      textDecoration: 'none',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    }}
                  >
                    <MapPinIcon size={12} color="#170e5e" />
                    <span>GPS</span>
                  </a>
                ) : null}
              </div>
            </div>

            {/* Row 2: Code, District/Route, Address & Status Badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '10.5px', color: '#64748b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, overflow: 'hidden' }}>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '10px',
                    fontWeight: 800,
                    color: '#170e5e',
                    backgroundColor: '#eef2ff',
                    border: '1px solid #c7d2fe',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    flexShrink: 0,
                  }}
                >
                  [{visit.selectedCustomerForHub.customerCode.replace(/^#/, '')}]
                </span>

                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {visit.selectedCustomerForHub.district ? `حي: ${visit.selectedCustomerForHub.district}` : (visit.selectedCustomerForHub.route ? `خط: ${visit.selectedCustomerForHub.route}` : '')}
                  {visit.selectedCustomerForHub.customerAddress ? ` • ${visit.selectedCustomerForHub.customerAddress}` : ''}
                </span>
              </div>

              {/* Status Badge */}
              <div style={{ flexShrink: 0 }}>
                {visit.selectedCustomerForHub.visitStatus === 'positive' && (
                  <span style={{ backgroundColor: '#dcfce7', color: '#15803d', fontSize: '10px', fontWeight: 800, padding: '2px 7px', borderRadius: '6px', border: '1px solid #86efac' }}>
                    {t('delivery_reps.van_itinerary_tab.s6', "تم البيع")}
                  </span>
                )}
                {visit.selectedCustomerForHub.visitStatus === 'negative' && (
                  <span style={{ backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '10px', fontWeight: 800, padding: '2px 7px', borderRadius: '6px', border: '1px solid #fca5a5' }}>
                    {t('delivery_reps.van_itinerary_tab.s7', "زيارة سلبية")}
                  </span>
                )}
                {visit.selectedCustomerForHub.visitStatus === 'pending' && (
                  <span style={{ backgroundColor: '#f1f5f9', color: '#475569', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    {t('delivery_reps.van_itinerary_tab.s8', "بانتظار الزيارة")}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 2. TWO FINANCIAL METRIC CAPSULES (Debt + Credit Limit) - BALANCED 50% ROW */}
          <div
            className="keep-grid-row"
            style={{
              display: 'flex',
              flexDirection: 'row',
              gap: '8px',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {/* Capsule 1: Debt */}
            <div
              style={{
                flex: '1 1 0',
                minWidth: 0,
                backgroundColor: '#ffffff',
                border: visit.selectedCustomerForHub.creditLimit > 0 && visit.selectedCustomerForHub.balance > visit.selectedCustomerForHub.creditLimit ? '1px solid #fecaca' : '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '8px 10px',
                textAlign: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                boxSizing: 'border-box',
              }}
            >
              <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                {t('delivery_reps.van_itinerary_tab.s9', "المديونية المستحقة")}
              </span>
              <strong style={{ fontSize: '14px', fontWeight: 900, color: visit.selectedCustomerForHub.balance > 0 ? '#b91c1c' : '#0f172a', display: 'block', lineHeight: 1.15 }}>
                {Number(visit.selectedCustomerForHub.balance.toFixed(0)).toLocaleString()} <CurrencySymbol />
              </strong>
              {visit.selectedCustomerForHub.creditLimit > 0 && visit.selectedCustomerForHub.balance > visit.selectedCustomerForHub.creditLimit && (
                <span style={{ backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', fontSize: '9px', fontWeight: 800, padding: '1px 5px', borderRadius: '4px', display: 'inline-block', marginTop: '2px' }}>
                  {t('delivery_reps.van_itinerary_tab.s10', "تجاوز سقف الائتمان")}
                </span>
              )}
            </div>

            {/* Capsule 2: Credit Limit */}
            <div
              style={{
                flex: '1 1 0',
                minWidth: 0,
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '8px 10px',
                textAlign: 'center',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                boxSizing: 'border-box',
              }}
            >
              <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: '2px' }}>
                {t('delivery_reps.van_itinerary_tab.s11', "سقف الائتمان")}
              </span>
              <strong style={{ fontSize: '14px', fontWeight: 900, color: '#0f172a', display: 'block', lineHeight: 1.15 }}>
                {Number(visit.selectedCustomerForHub.creditLimit.toFixed(0)).toLocaleString()} <CurrencySymbol />
              </strong>
              {visit.selectedCustomerForHub.creditLimit > 0 ? (
                visit.selectedCustomerForHub.balance >= visit.selectedCustomerForHub.creditLimit ? (
                  <span style={{ fontSize: '9px', color: '#b91c1c', fontWeight: 700, display: 'block', marginTop: '2px' }}>
                    {t('delivery_reps.van_itinerary_tab.s12', "المتاح: 0")} <CurrencySymbol />
                  </span>
                ) : (
                  <span style={{ fontSize: '9px', color: '#15803d', fontWeight: 700, display: 'block', marginTop: '2px' }}>
                    {t('delivery_reps.van_itinerary_tab.s13', "المتاح:")} {Number((visit.selectedCustomerForHub.creditLimit - visit.selectedCustomerForHub.balance).toFixed(0)).toLocaleString()} <CurrencySymbol />
                  </span>
                )
              ) : (
                <span style={{ fontSize: '9px', color: '#64748b', fontWeight: 600, display: 'block', marginTop: '2px' }}>
                  {t('delivery_reps.van_itinerary_tab.s14', "بيع نقدي فوري")}
                </span>
              )}
            </div>
          </div>

          {/* 3. PRIMARY FULL-WIDTH VISIT TIMER BUTTON / COCKPIT BAR */}
          {activeVisit?.customerId === visit.selectedCustomerForHub.customerId ? (
            /* Active Visit Bar */
            <div
              style={{
                width: '100%',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRight: '3.5px solid #170e5e',
                borderRadius: '12px',
                padding: '8px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '8px',
                    backgroundColor: '#eef2ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <ClockIcon size={16} color="#170e5e" />
                </div>
                <div>
                  <span style={{ fontSize: '10.5px', color: '#64748b', fontWeight: 700, display: 'block' }}>
                    {t('delivery_reps.van_itinerary_tab.s15', "الزيارة الميدانية جارية الآن")}
                  </span>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '14px',
                      fontWeight: 900,
                      color: '#0f172a',
                      letterSpacing: '0.5px',
                      lineHeight: 1.1,
                    }}
                  >
                    {visit.formatElapsed(visit.elapsedVisitSeconds)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onEndVisit?.()}
                style={{
                  backgroundColor: '#ffffff',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '5px 12px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                }}
              >
                <span>{t('delivery_reps.van_itinerary_tab.s16', "إنهاء الزيارة")}</span>
              </button>
            </div>
          ) : (
            /* Standalone Primary Full-Width CTA to Start Visit */
            <button
              type="button"
              onClick={() => onStartVisit?.(visit.selectedCustomerForHub.customerId, visit.selectedCustomerForHub.customerName)}
              style={{
                width: '100%',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '9px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer',
                boxShadow: '0 2px 5px rgba(23, 14, 94, 0.18)',
                boxSizing: 'border-box',
                transition: 'all 0.15s ease',
              }}
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <PlayIcon size={12} color="#ffffff" />
              </div>
              <span style={{ fontSize: '13px', fontWeight: 800 }}>{t('delivery_reps.van_itinerary_tab.s17', "بدء الزيارة الميدانية وتفعيل المؤقت")}</span>
            </button>
          )}

          {/* 3. SECTION HEADER (Classic Z-Systems Royal Navy Vertical Accent Bar) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px 0' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              <span style={{ width: '3.5px', height: '14px', backgroundColor: '#170e5e', borderRadius: '2px', display: 'inline-block' }} />
              <span>{t('delivery_reps.van_itinerary_tab.s18', "إجراءات الزيارة الميدانية")}</span>
            </h3>
            <span style={{ fontSize: '10.5px', color: '#64748b' }}>{t('delivery_reps.van_itinerary_tab.s19', "اختر الإجراء المطلوب")}</span>
          </div>

          {/* 4. FOUR OPERATIONAL ACTION TILES (Z-Systems Squircle 2x2 Grid - CALM PREMIUM EXECUTIVE PALETTE) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
            {/* ROW 1: Sale Invoice & Customer Return */}
            <div className="keep-grid-row" style={{ display: 'flex', flexDirection: 'row', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
              {/* Tile 1: New Sale Invoice */}
              <div
                onClick={() => {
                  const cId = visit.selectedCustomerForHub.customerId;
                  const cName = visit.selectedCustomerForHub.customerName;
                  const proceedToSale = () => {
                    visit.setSelectedCustomerForHub(null);
                    onSelectCustomerForSale(cId);
                  };
                  if (!activeVisit || activeVisit.customerId !== cId) {
                    onStartVisit?.(cId, cName, proceedToSale);
                  } else {
                    proceedToSale();
                  }
                }}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '10px 6px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '11px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 6px',
                  }}
                >
                  <ReceiptIcon size={18} color="#170e5e" strokeWidth={2} />
                </div>
                <h4 style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {t('delivery_reps.van_itinerary_tab.s20', "فاتورة بيع جديدة")}
                </h4>
                <p style={{ margin: 0, fontSize: '10px', color: '#64748b', fontWeight: 500 }}>
                  {t('delivery_reps.van_itinerary_tab.s21', "بيع وصرف بضاعة")}
                </p>
              </div>

              {/* Tile 2: Customer Return */}
              <div
                onClick={() => {
                  const cId = visit.selectedCustomerForHub.customerId;
                  const cName = visit.selectedCustomerForHub.customerName;
                  const proceedToReturn = () => {
                    visit.setSelectedCustomerForHub(null);
                    if (onSelectCustomerForReturn) {
                      onSelectCustomerForReturn(cId);
                    } else {
                      onSelectCustomerForSale(cId);
                    }
                  };
                  if (!activeVisit || activeVisit.customerId !== cId) {
                    onStartVisit?.(cId, cName, proceedToReturn);
                  } else {
                    proceedToReturn();
                  }
                }}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '10px 6px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '11px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 6px',
                  }}
                >
                  <RotateCcwIcon size={18} color="#334155" strokeWidth={2} />
                </div>
                <h4 style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {t('delivery_reps.van_itinerary_tab.s22', "مرتجع بضاعة")}
                </h4>
                <p style={{ margin: 0, fontSize: '10px', color: '#64748b', fontWeight: 500 }}>
                  {t('delivery_reps.van_itinerary_tab.s23', "من فواتير العميل")}
                </p>
              </div>
            </div>

            {/* ROW 2: Debt Collection & Field Statement */}
            <div className="keep-grid-row" style={{ display: 'flex', flexDirection: 'row', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
              {/* Tile 3: Debt Collection */}
              <div
                onClick={() => {
                  const cId = visit.selectedCustomerForHub.customerId;
                  const cName = visit.selectedCustomerForHub.customerName;
                  const proceedToCollection = () => {
                    visit.setSelectedCustomerForHub(null);
                    if (onSelectCustomerForCollection) {
                      onSelectCustomerForCollection(cId);
                    }
                  };
                  if (!activeVisit || activeVisit.customerId !== cId) {
                    onStartVisit?.(cId, cName, proceedToCollection);
                  } else {
                    proceedToCollection();
                  }
                }}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '10px 6px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '11px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 6px',
                  }}
                >
                  <CreditCardIcon size={18} color="#047857" strokeWidth={2} />
                </div>
                <h4 style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {t('delivery_reps.van_itinerary_tab.s24', "سند تحصيل نقدية")}
                </h4>
                <p style={{ margin: 0, fontSize: '10px', color: '#64748b', fontWeight: 500 }}>
                  {t('delivery_reps.van_itinerary_tab.s25', "سداد وتخفيض مديونية")}
                </p>
              </div>

              {/* Tile 4: Field Statement */}
              <div
                onClick={() => {
                  setStatementModalCust(visit.selectedCustomerForHub);
                }}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '10px 6px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '11px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 6px',
                  }}
                >
                  <FileTextIcon size={18} color="#170e5e" strokeWidth={2} />
                </div>
                <h4 style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {t('delivery_reps.van_itinerary_tab.s26', "كشف حساب")}
                </h4>
                <p style={{ margin: 0, fontSize: '10px', color: '#64748b', fontWeight: 500 }}>
                  {t('delivery_reps.van_itinerary_tab.s27', "مطابقة وإيصال حراري")}
                </p>
              </div>
            </div>

            {/* ROW 3: Damaged Goods Instant Swap & Shelf Inventory (Optional) */}
            <div className="keep-grid-row" style={{ display: 'flex', flexDirection: 'row', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
              {/* Tile 5: Instant Damaged Goods Swap (Egyptian FMCG Standard) */}
              <div
                onClick={() => {
                  const cust = visit.selectedCustomerForHub;
                  const proceedToSwap = () => {
                    visit.setSelectedCustomerForHub(null);
                    setSwapCustomer(cust);
                  };
                  if (!activeVisit || activeVisit.customerId !== cust.customerId) {
                    onStartVisit?.(cust.customerId, cust.customerName, proceedToSwap);
                  } else {
                    proceedToSwap();
                  }
                }}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '10px 6px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '11px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 6px',
                  }}
                >
                  <RefreshCwIcon size={18} color="#9f1239" strokeWidth={2} />
                </div>
                <h4 style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {t('delivery_reps.van_itinerary_tab.s28', "استبدال تالف / كسر")}
                </h4>
                <p style={{ margin: 0, fontSize: '10px', color: '#64748b', fontWeight: 500 }}>
                  {t('delivery_reps.van_itinerary_tab.s29', "تبديل فوري وحساب الفارق")}
                </p>
              </div>

              {/* Tile 6: Store Shelf Inventory */}
              <div
                onClick={() => {
                  const cust = visit.selectedCustomerForHub;
                  const proceedToInventory = () => {
                    visit.setSelectedCustomerForHub(null);
                    setInventoryCustomer(cust);
                  };
                  if (!activeVisit || activeVisit.customerId !== cust.customerId) {
                    onStartVisit?.(cust.customerId, cust.customerName, proceedToInventory);
                  } else {
                    proceedToInventory();
                  }
                }}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '10px 6px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '11px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 6px',
                  }}
                >
                  <PackageIcon size={18} color="#334155" strokeWidth={2} />
                </div>
                <h4 style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {t('delivery_reps.van_itinerary_tab.s30', "جرد الرف (اختياري)")}
                </h4>
                <p style={{ margin: 0, fontSize: '10px', color: '#64748b', fontWeight: 500 }}>
                  {t('delivery_reps.van_itinerary_tab.s31', "عد المخزون المتبقي")}
                </p>
              </div>
            </div>

            {/* ROW 4: Trade Marketing Survey & Negative Visit */}
            <div className="keep-grid-row" style={{ display: 'flex', flexDirection: 'row', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
              {/* Tile 7: Trade Marketing & Cooler Inspection */}
              <div
                onClick={() => {
                  const cust = visit.selectedCustomerForHub;
                  const proceedToSurvey = () => {
                    visit.setSelectedCustomerForHub(null);
                    setSurveyCustomer(cust);
                  };
                  if (!activeVisit || activeVisit.customerId !== cust.customerId) {
                    onStartVisit?.(cust.customerId, cust.customerName, proceedToSurvey);
                  } else {
                    proceedToSurvey();
                  }
                }}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '10px 6px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '11px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 6px',
                  }}
                >
                  <SearchIcon size={18} color="#475569" strokeWidth={2} />
                </div>
                <h4 style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {t('delivery_reps.van_itinerary_tab.s32', "تفتيش ومنافسين")}
                </h4>
                <p style={{ margin: 0, fontSize: '10px', color: '#64748b', fontWeight: 500 }}>
                  {t('delivery_reps.van_itinerary_tab.s33', "ثلاجة الشركة وأسعار السوق")}
                </p>
              </div>

              {/* Tile 8: Negative Visit */}
              <div
                onClick={() => {
                  const cust = visit.selectedCustomerForHub;
                  negative.openNegativeVisitModal(cust);
                }}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  padding: '10px 6px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '11px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 6px',
                  }}
                >
                  <XCircleIcon size={18} color="#64748b" strokeWidth={2} />
                </div>
                <h4 style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                  {t('delivery_reps.van_itinerary_tab.s34', "تسجيل زيارة سلبية")}
                </h4>
                <p style={{ margin: 0, fontSize: '10px', color: '#64748b', fontWeight: 500 }}>
                  {t('delivery_reps.van_itinerary_tab.s35', "محل مغلق / لم يشترِ")}
                </p>
              </div>
            </div>
          </div>

          {/* 5. Today's Visit Summary if already visited today (Z-Systems Crisp White Card) */}
          {visit.selectedCustomerForHub.todayVisit && (
            <div
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '8px 12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ClockIcon size={13} color="#64748b" />
                <span style={{ fontWeight: 700, color: '#475569', flexShrink: 0 }}>{t('delivery_reps.van_itinerary_tab.s36', "زيارة سابقة اليوم:")}</span>
              </div>
              {visit.selectedCustomerForHub.todayVisit.visitType === 'positive' ? (
                <span style={{ color: '#15803d', fontWeight: 800 }}>
                  {t('delivery_reps.van_itinerary_tab.s37', "فاتورة #")}{visit.selectedCustomerForHub.todayVisit.saleDocNo} ({visit.selectedCustomerForHub.todayVisit.saleTotal} <CurrencySymbol />)
                </span>
              ) : (
                <span style={{ color: '#b91c1c', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {negative.getReasonLabel(visit.selectedCustomerForHub.todayVisit.negativeReason)}
                  {visit.selectedCustomerForHub.todayVisit.notes && ` — "${visit.selectedCustomerForHub.todayVisit.notes}"`}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Live Commission & Target Booster Widget */}
          {targetMetrics && <VanLiveTargetBoosterWidget metrics={targetMetrics} compact={false} />}

          {/* Unified High-Density Itinerary Toolbar */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          padding: '8px 10px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {/* Row 1: Visit Status Quick Filters (Height 28px) */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: '4px', textAlign: 'center', width: '100%' }}>
          <div
            onClick={() => filters.setStatusFilter((prev) => (prev === 'positive' ? 'all' : 'positive'))}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              backgroundColor: filters.statusFilter === 'positive' ? '#15803d' : '#f0fdf4',
              borderRadius: '6px',
              padding: '2px 4px',
              border: filters.statusFilter === 'positive' ? '1.5px solid #15803d' : '1px solid #bbf7d0',
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '28px',
              transition: 'all 0.15s ease',
            }}
            title={t('delivery_reps.van_itinerary_tab.s38', "المحلات التي تم البيع لها")}
          >
            <CheckCircleIcon size={12} color={filters.statusFilter === 'positive' ? '#ffffff' : '#166534'} />
            <span style={{ fontSize: '10px', color: filters.statusFilter === 'positive' ? '#ffffff' : '#166534', fontWeight: 700, whiteSpace: 'nowrap' }}>{t('delivery_reps.van_itinerary_tab.s39', "تم البيع:")}</span>
            <strong style={{ fontSize: '12px', fontWeight: 900, color: filters.statusFilter === 'positive' ? '#ffffff' : '#15803d' }}>{list.positiveCount}</strong>
          </div>

          <div
            onClick={() => filters.setStatusFilter((prev) => (prev === 'negative' ? 'all' : 'negative'))}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              backgroundColor: filters.statusFilter === 'negative' ? '#b91c1c' : '#fef2f2',
              borderRadius: '6px',
              padding: '2px 4px',
              border: filters.statusFilter === 'negative' ? '1.5px solid #b91c1c' : '1px solid #fecaca',
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '28px',
              transition: 'all 0.15s ease',
            }}
            title={t('delivery_reps.van_itinerary_tab.s40', "الزيارات السلبية")}
          >
            <XCircleIcon size={12} color={filters.statusFilter === 'negative' ? '#ffffff' : '#991b1b'} />
            <span style={{ fontSize: '10px', color: filters.statusFilter === 'negative' ? '#ffffff' : '#991b1b', fontWeight: 700, whiteSpace: 'nowrap' }}>{t('delivery_reps.van_itinerary_tab.s41', "سلبية:")}</span>
            <strong style={{ fontSize: '12px', fontWeight: 900, color: filters.statusFilter === 'negative' ? '#ffffff' : '#b91c1c' }}>{list.negativeCount}</strong>
          </div>

          <div
            onClick={() => filters.setStatusFilter((prev) => (prev === 'pending' ? 'all' : 'pending'))}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              backgroundColor: filters.statusFilter === 'pending' ? '#170e5e' : '#f8fafc',
              borderRadius: '6px',
              padding: '2px 4px',
              border: filters.statusFilter === 'pending' ? '1.5px solid #170e5e' : '1px solid #cbd5e1',
              cursor: 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '28px',
              transition: 'all 0.15s ease',
            }}
            title={t('delivery_reps.van_itinerary_tab.s42', "المحلات المتبقية للزيارة")}
          >
            <ClockIcon size={12} color={filters.statusFilter === 'pending' ? '#ffffff' : '#475569'} />
            <span style={{ fontSize: '10px', color: filters.statusFilter === 'pending' ? '#ffffff' : '#475569', fontWeight: 700, whiteSpace: 'nowrap' }}>{t('delivery_reps.van_itinerary_tab.s43', "متبقي:")}</span>
            <strong style={{ fontSize: '12px', fontWeight: 900, color: filters.statusFilter === 'pending' ? '#ffffff' : '#0f172a' }}>{list.pendingCount}</strong>
          </div>
        </div>

        {/* Row 2: Day Filter Segment Switcher (اليوم vs الكل vs يوم آخر) */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: '4px', width: '100%', alignItems: 'stretch' }}>
          <button
            type="button"
            onClick={() => filters.setDayFilter('today')}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              padding: '0 6px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              boxSizing: 'border-box',
              border:
                filters.dayFilter === 'today' || normalizeDayKey(filters.dayFilter) === normalizeDayKey(filters.todayArabicName)
                  ? '1.5px solid #170e5e'
                  : '1px solid #e2e8f0',
              backgroundColor:
                filters.dayFilter === 'today' || normalizeDayKey(filters.dayFilter) === normalizeDayKey(filters.todayArabicName)
                  ? '#170e5e'
                  : '#f8fafc',
              color:
                filters.dayFilter === 'today' || normalizeDayKey(filters.dayFilter) === normalizeDayKey(filters.todayArabicName)
                  ? '#ffffff'
                  : '#334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '30px',
            }}
          >
            <CalendarIcon size={12} style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap' }}>{filters.todayArabicName}</span>
            <span
              style={{
                backgroundColor:
                  filters.dayFilter === 'today' || normalizeDayKey(filters.dayFilter) === normalizeDayKey(filters.todayArabicName)
                    ? 'rgba(255,255,255,0.25)'
                    : '#e2e8f0',
                color:
                  filters.dayFilter === 'today' || normalizeDayKey(filters.dayFilter) === normalizeDayKey(filters.todayArabicName)
                    ? '#ffffff'
                    : '#475569',
                padding: '0 4px',
                borderRadius: '6px',
                fontSize: '9.5px',
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {filters.todayCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => filters.setDayFilter('all')}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              padding: '0 6px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              boxSizing: 'border-box',
              border: filters.dayFilter === 'all' ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
              backgroundColor: filters.dayFilter === 'all' ? '#170e5e' : '#f8fafc',
              color: filters.dayFilter === 'all' ? '#ffffff' : '#334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              height: '30px',
            }}
          >
            <span style={{ whiteSpace: 'nowrap' }}>{t('delivery_reps.van_itinerary_tab.s44', "كافة المحلات")}</span>
            <span
              style={{
                backgroundColor: filters.dayFilter === 'all' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                color: filters.dayFilter === 'all' ? '#ffffff' : '#475569',
                padding: '0 4px',
                borderRadius: '6px',
                fontSize: '9.5px',
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {list.total}
            </span>
          </button>

          {/* Day Picker Button & Dropdown */}
          <div ref={filters.dayDropdownRef} style={{ position: 'relative', flex: '1 1 0', minWidth: 0, height: '30px' }}>
            <button
              type="button"
              onClick={() => filters.setDayDropdownOpen((prev) => !prev)}
              style={{
                width: '100%',
                padding: '0 6px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                boxSizing: 'border-box',
                border:
                  filters.dayFilter !== 'today' && filters.dayFilter !== 'all' && normalizeDayKey(filters.dayFilter) !== normalizeDayKey(filters.todayArabicName)
                    ? '1.5px solid #170e5e'
                    : '1px solid #e2e8f0',
                backgroundColor:
                  filters.dayFilter !== 'today' && filters.dayFilter !== 'all' && normalizeDayKey(filters.dayFilter) !== normalizeDayKey(filters.todayArabicName)
                    ? '#170e5e'
                    : '#f8fafc',
                color:
                  filters.dayFilter !== 'today' && filters.dayFilter !== 'all' && normalizeDayKey(filters.dayFilter) !== normalizeDayKey(filters.todayArabicName)
                    ? '#ffffff'
                    : '#334155',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3px',
                height: '30px',
              }}
            >
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {filters.dayFilter !== 'today' && filters.dayFilter !== 'all' && normalizeDayKey(filters.dayFilter) !== normalizeDayKey(filters.todayArabicName)
                  ? filters.dayFilter
                  : t('delivery_reps.van_itinerary_tab.s45', "يوم...")}
              </span>
              <ChevronDownIcon size={11} style={{ flexShrink: 0 }} />
            </button>

            {filters.dayDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  width: '125px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                  zIndex: 100,
                  overflow: 'hidden',
                  padding: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <div
                  onClick={() => {
                    filters.setDayFilter('all');
                    filters.setDayDropdownOpen(false);
                  }}
                  style={{
                    padding: '6px 8px',
                    fontSize: '11px',
                    fontWeight: filters.dayFilter === 'all' ? 800 : 600,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: filters.dayFilter === 'all' ? '#170e5e' : '#334155',
                    backgroundColor: filters.dayFilter === 'all' ? '#eef2ff' : 'transparent',
                  }}
                >
                  {t('delivery_reps.van_itinerary_tab.s46', "كافة الأيام")}
                </div>
                {filters.arabicDayNames.map((d) => {
                  const isCurrent = d === filters.todayArabicName;
                  const isSelected = filters.dayFilter === d || (isCurrent && filters.dayFilter === 'today');
                  return (
                    <div
                      key={d}
                      onClick={() => {
                        if (isCurrent) {
                          filters.setDayFilter('today');
                        } else {
                          filters.setDayFilter(d);
                        }
                        filters.setDayDropdownOpen(false);
                      }}
                      style={{
                        padding: '6px 8px',
                        fontSize: '11px',
                        fontWeight: isSelected ? 800 : 600,
                        borderRadius: '4px',
                        cursor: 'pointer',
                        color: isSelected ? '#170e5e' : '#334155',
                        backgroundColor: isSelected ? '#eef2ff' : 'transparent',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{t('delivery_reps.van_itinerary_tab.s47', "يوم")} {d}</span>
                      {isCurrent && (
                        <span style={{ fontSize: '9px', color: '#16a34a', fontWeight: 800 }}>{t('delivery_reps.van_itinerary_tab.s48', "اليوم")}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Row 3: Full-width Clean Search Bar */}
        <div style={{ position: 'relative', width: '100%' }}>
          <input
            type="text"
            value={filters.searchTerm}
            onChange={(e) => filters.setSearchTerm(e.target.value)}
            placeholder={t('delivery_reps.van_itinerary_tab.s49', "بحث باسم المحل، الكود، الحي، أو الهاتف...")}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '6px 12px 6px 32px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              height: '35px',
              backgroundColor: '#f8fafc',
            }}
          />
          <span style={{ position: 'absolute', left: '10px', top: '9px', color: '#94a3b8' }}>
            <SearchIcon size={14} />
          </span>
        </div>

        {/* Row 4: Route Actions & Route Filter (Responsive 2-Row Layout to Prevent Mobile Clipping) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
          {/* Sub-row 1: Add Store Button + Route Selector */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', width: '100%' }}>
            <button
              type="button"
              onClick={() => add.setAddCustomerModalOpen(true)}
              style={{
                flex: filters.routes.length > 1 ? 1 : 'none',
                width: filters.routes.length > 1 ? 'auto' : '100%',
                height: '32px',
                padding: '0 10px',
                borderRadius: '8px',
                backgroundColor: '#170e5e',
                color: '#ffffff',
                border: 'none',
                fontSize: '11.5px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                boxShadow: '0 1px 2px rgba(23, 14, 94, 0.15)',
              }}
              title={t('delivery_reps.van_itinerary_tab.s50', "إضافة محل جديد لخط السير")}
            >
              <PlusIcon size={12} color="#ffffff" />
              <span>{t('delivery_reps.van_itinerary_tab.s51', "+ إضافة محل جديد")}</span>
            </button>

            {filters.routes.length > 1 && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <CustomSelect
                  value={filters.routeFilter}
                  onChange={(val) => filters.setRouteFilter(val || 'all')}
                  dropdownAlign="left"
                  options={[
                    { value: 'all', label: t('delivery_reps.van_itinerary_tab.s52', "كافة الخطوط") },
                    ...filters.routes.map((r) => ({ value: r, label: r })),
                  ]}
                  placeholder={t('delivery_reps.van_itinerary_tab.s53', "تصفية بالخط")}
                  style={{ height: '32px', fontSize: '11.5px' }}
                />
              </div>
            )}
          </div>

          {/* Sub-row 2: Reorder Itinerary + Smart Route Optimization (TSP) - Strictly 1 Horizontal Row Side-by-Side */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'nowrap',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {/* Toggle Reordering Mode Button */}
            <button
              type="button"
              onClick={() => order.setIsReorderingMode((prev) => !prev)}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                width: '50%',
                height: '32px',
                padding: '0 8px',
                borderRadius: '8px',
                backgroundColor: order.isReorderingMode ? '#1e293b' : '#ffffff',
                color: order.isReorderingMode ? '#ffffff' : '#334155',
                border: order.isReorderingMode ? '1.5px solid #0f172a' : '1px solid #cbd5e1',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box',
              }}
              title={t('delivery_reps.van_itinerary_tab.s54', "إعادة ترتيب خط السير يدوياً")}
            >
              <SlidersIcon size={12} color={order.isReorderingMode ? '#ffffff' : '#475569'} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {order.isReorderingMode ? t('delivery_reps.van_itinerary_tab.s55', "إنهاء الترتيب") : t('delivery_reps.van_itinerary_tab.s56', "ترتيب السير")}
              </span>
            </button>

            {/* Dynamic Route Optimization Button */}
            <button
              type="button"
              onClick={handleRunRouteOptimization}
              disabled={isOptimizingRoute}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                width: '50%',
                height: '32px',
                padding: '0 8px',
                borderRadius: '8px',
                backgroundColor: '#eef2ff',
                color: '#170e5e',
                border: '1px solid #c7d2fe',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box',
              }}
              title={t('delivery_reps.van_itinerary_tab.s57', "تحسين مسار السير بأقصر مسار جغرافي لتوفير استهلاك الوقود وزمن الرحلة")}
            >
              <MapPinIcon size={12} color="#170e5e" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isOptimizingRoute ? t('delivery_reps.van_itinerary_tab.s58', "جاري التحسين...") : t('delivery_reps.van_itinerary_tab.s59', "أقصر مسار (GPS)")}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Active Reordering Mode Banner */}
      {order.isReorderingMode && (
        <div
          style={{
            backgroundColor: '#f0f7ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '5px',
                backgroundColor: '#dbeafe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <SlidersIcon size={12} color="#1d4ed8" />
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#1e40af',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t('delivery_reps.van_itinerary_tab.s60', "وضع إعادة الترتيب نشط: استخدم الأسهم (▲/▼) لترتيب خط السير")}
            </span>
          </div>
          <button
            type="button"
            onClick={order.resetOrderToDefault}
            style={{
              background: '#ffffff',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              color: '#dc2626',
              fontSize: '11px',
              fontWeight: 700,
              padding: '3px 8px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            }}
            title={t('delivery_reps.van_itinerary_tab.s61', "استعادة ترتيب خط السير الافتراضي")}
          >
            <RotateCcwIcon size={11} color="#dc2626" />
            {t('delivery_reps.van_itinerary_tab.s62', "استعادة الترتيب")}
          </button>
        </div>
      )}

      {/* Active filter badge / reset */}
      {(filters.statusFilter !== 'all' || (filters.dayFilter !== 'today' && filters.dayFilter !== 'all')) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#f1f5f9',
            padding: '5px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            color: '#334155',
            border: '1px solid #e2e8f0',
          }}
        >
          <span>
            {t('delivery_reps.van_itinerary_tab.s63', "تصفية نشطة:")}{' '}
            {filters.dayFilter !== 'today' && filters.dayFilter !== 'all' && (
              <strong style={{ color: '#170e5e', marginInlineEnd: '4px' }}>{t('delivery_reps.van_itinerary_tab.s64', "يوم")} {filters.dayFilter}</strong>
            )}
            {filters.statusFilter !== 'all' && (
              <strong>
                {filters.statusFilter === 'pending'
                  ? t('delivery_reps.van_itinerary_tab.s65', "المحلات المتبقية فقط")
                  : filters.statusFilter === 'positive'
                  ? t('delivery_reps.van_itinerary_tab.s66', "المحلات التي تم البيع لها")
                  : t('delivery_reps.van_itinerary_tab.s67', "الزيارات السلبية")}
              </strong>
            )}{' '}
            ({list.filtered.length} {t('delivery_reps.van_itinerary_tab.s68', "محل)")}
          </span>
          <button
            type="button"
            onClick={() => {
              filters.setStatusFilter('all');
              filters.setDayFilter('today');
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#0284c7',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '11px',
              padding: 0,
            }}
          >
            {t('delivery_reps.van_itinerary_tab.s69', "إلغاء التصفية")}
          </button>
        </div>
      )}

      {/* Customers List */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: '13px' }}>
          {t('delivery_reps.van_itinerary_tab.s70', "جاري تحميل خط السير...")}
        </div>
      ) : list.filtered.length === 0 ? (
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            padding: '30px 16px',
            textAlign: 'center',
            border: '1px dashed #cbd5e1',
            color: '#64748b',
          }}
        >
          {t('delivery_reps.van_itinerary_tab.s71', "لا توجد محلات مسجلة تطابق معايير البحث")}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Top Compact Pagination Bar - only shown if more than 1 page */}
          {list.totalPages > 1 && (
            <VanItineraryPagination
              startIdx={list.startIdx}
              pageSize={filters.pageSize}
              totalCount={list.allSortedCustomers.length}
              currentPage={filters.currentPage}
              totalPages={list.totalPages}
              onPageChange={filters.setCurrentPage}
              onPageSizeChange={filters.handlePageSizeChange}
            />
          )}

          {list.districtGroups.map((group, groupIdx) => {
            return (
              <div
                key={group.name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  backgroundColor: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  padding: '10px 12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                }}
              >
                {/* District Group Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid #f1f5f9',
                    paddingBottom: '8px',
                    marginBottom: '4px',
                    flexWrap: 'wrap',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '26px', height: '26px', borderRadius: '6px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <MapPinIcon size={14} color="#170e5e" />
                    </div>
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a' }}>
                        {group.name}
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          backgroundColor: group.visitedCount === group.totalCount && group.totalCount > 0 ? '#eef2ff' : '#f1f5f9',
                          color: group.visitedCount === group.totalCount && group.totalCount > 0 ? '#170e5e' : '#475569',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          marginInlineStart: '6px',
                        }}
                      >
                        {group.visitedCount} {t('delivery_reps.van_itinerary_tab.s72', "من")} {group.totalCount} {t('delivery_reps.van_itinerary_tab.s73', "تمت زيارتهم")}
                      </span>
                    </div>
                  </div>

                  {/* Reordering controls for District */}
                  {order.isReorderingMode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <button
                        type="button"
                        onClick={() => list.moveDistrict(group.name, 'up')}
                        disabled={groupIdx === 0}
                        style={{
                          width: '26px',
                          height: '24px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 800,
                          backgroundColor: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          cursor: groupIdx === 0 ? 'not-allowed' : 'pointer',
                          opacity: groupIdx === 0 ? 0.35 : 1,
                          color: '#1e293b',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        }}
                        title={t('delivery_reps.van_itinerary_tab.s74', "تقديم الحي في خط السير")}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => list.moveDistrict(group.name, 'down')}
                        disabled={groupIdx === list.districtGroups.length - 1}
                        style={{
                          width: '26px',
                          height: '24px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          fontWeight: 800,
                          backgroundColor: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          cursor: groupIdx === list.districtGroups.length - 1 ? 'not-allowed' : 'pointer',
                          opacity: groupIdx === list.districtGroups.length - 1 ? 0.35 : 1,
                          color: '#1e293b',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                        }}
                        title={t('delivery_reps.van_itinerary_tab.s75', "تأخير الحي في خط السير")}
                      >
                        ▼
                      </button>
                    </div>
                  )}
                </div>

                {/* Stores Cards inside this District */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {group.items.map((item, itemIdx) => {
                    const isPositive = item.visitStatus === 'positive';
                    const isNegative = item.visitStatus === 'negative';
                    const isPending = item.visitStatus === 'pending';
                    const isActiveVisiting = activeVisit?.customerId === item.customerId;

                    return (
                      <div
                        key={item.customerId}
                        onClick={() => visit.setSelectedCustomerForHub(item)}
                        style={{
                          backgroundColor: isActiveVisiting ? '#f8faff' : '#ffffff',
                          borderRadius: '8px',
                          border: isActiveVisiting
                            ? '1.5px solid #2563eb'
                            : isPositive
                            ? '1px solid #bbf7d0'
                            : isNegative
                            ? '1px solid #fecaca'
                            : '1px solid #e2e8f0',
                          padding: '8px 10px',
                          boxShadow: isActiveVisiting ? '0 2px 8px rgba(37,99,235,0.08)' : '0 1px 2px rgba(0,0,0,0.02)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '5px',
                          cursor: 'pointer',
                          transition: 'all 0.1s ease',
                        }}
                      >
                        {/* Header: Sequence, Code, Name, Status Badge & Reorder Arrows */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                            <span
                              style={{
                                backgroundColor: isActiveVisiting ? '#2563eb' : '#170e5e',
                                color: '#ffffff',
                                fontSize: '10px',
                                fontWeight: 800,
                                width: '20px',
                                height: '20px',
                                borderRadius: '5px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {item.globalSeq}
                            </span>
                            <span style={{ fontSize: '10.5px', fontFamily: 'monospace', fontWeight: 800, color: '#475569', flexShrink: 0 }}>
                              [{item.customerCode.replace(/^#/, '')}]
                            </span>
                            <h4
                              style={{
                                margin: 0,
                                fontSize: '13px',
                                fontWeight: 800,
                                color: '#0f172a',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                lineHeight: 1.4,
                              }}
                              title={item.customerName}
                            >
                              {item.customerName}
                            </h4>
                          </div>

                          {/* Status Badge & Actions */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                            {isActiveVisiting && (
                              <span
                                style={{
                                  backgroundColor: '#eff6ff',
                                  color: '#1d4ed8',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #bfdbfe',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                              >
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#2563eb', animation: 'pulse 1.5s infinite' }} />
                                <span>{t('delivery_reps.van_itinerary_tab.s76', "الزيارة جارية (")}{visit.formatElapsed(visit.elapsedVisitSeconds)})</span>
                              </span>
                            )}
                            {isPositive && (
                              <span
                                style={{
                                  backgroundColor: '#ecfdf5',
                                  color: '#047857',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #a7f3d0',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                              >
                                <CheckCircleIcon size={11} color="#047857" />
                                <span>{t('delivery_reps.van_itinerary_tab.s77', "تم البيع")}</span>
                              </span>
                            )}
                            {isNegative && (
                              <span
                                style={{
                                  backgroundColor: '#fef2f2',
                                  color: '#b91c1c',
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #fecaca',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                              >
                                <XCircleIcon size={11} color="#b91c1c" />
                                <span>{t('delivery_reps.van_itinerary_tab.s78', "سلبية")}</span>
                              </span>
                            )}
                            {isPending && !isActiveVisiting && (
                              <span
                                style={{
                                  backgroundColor: '#f8fafc',
                                  color: '#64748b',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid #e2e8f0',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                              >
                                <ClockIcon size={11} color="#64748b" />
                                <span>{t('delivery_reps.van_itinerary_tab.s79', "بالانتظار")}</span>
                              </span>
                            )}

                            {/* Up/Down buttons if in reorder mode */}
                            {order.isReorderingMode && (
                              <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => list.moveCustomer(group.name, item.customerId, 'up')}
                                  disabled={itemIdx === 0}
                                  style={{
                                    width: '24px',
                                    height: '24px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '9.5px',
                                    fontWeight: 800,
                                    backgroundColor: '#ffffff',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '5px',
                                    cursor: itemIdx === 0 ? 'not-allowed' : 'pointer',
                                    opacity: itemIdx === 0 ? 0.3 : 1,
                                    color: '#1e293b',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                                  }}
                                  title={t('delivery_reps.van_itinerary_tab.s80', "تقديم المحل")}
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  onClick={() => list.moveCustomer(group.name, item.customerId, 'down')}
                                  disabled={itemIdx === group.items.length - 1}
                                  style={{
                                    width: '24px',
                                    height: '24px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '9.5px',
                                    fontWeight: 800,
                                    backgroundColor: '#ffffff',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '5px',
                                    cursor: itemIdx === group.items.length - 1 ? 'not-allowed' : 'pointer',
                                    opacity: itemIdx === group.items.length - 1 ? 0.3 : 1,
                                    color: '#1e293b',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                                  }}
                                  title={t('delivery_reps.van_itinerary_tab.s81', "تأخير المحل")}
                                >
                                  ▼
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Repeated Negative Alert Badge */}
                        {item.hasRepeatedNegativeAlert && (
                          <div
                            style={{
                              backgroundColor: '#fffbeb',
                              border: '1px solid #fde68a',
                              borderRadius: '6px',
                              padding: '3px 8px',
                              fontSize: '10px',
                              fontWeight: 700,
                              color: '#b45309',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <AlertTriangleIcon size={12} color="#b45309" />
                            <span>{t('delivery_reps.van_itinerary_tab.s82', "تنبيه:")} {item.repeatedNegativesCount} {t('delivery_reps.van_itinerary_tab.s83', "زيارات سابقة بدون بيع")}</span>
                          </div>
                        )}

                        {/* Sub-info: Phone, Route, Debt */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#475569' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {item.customerPhone && (
                              <span style={{ fontSize: '10.5px', color: '#170e5e', fontWeight: 700 }} dir="ltr">
                                {item.customerPhone}
                              </span>
                            )}
                            <span style={{ fontSize: '10.5px', color: '#64748b' }}>{item.route}</span>
                          </div>
                          <div>
                            <span style={{ color: '#64748b', fontSize: '10.5px' }}>{t('delivery_reps.van_itinerary_tab.s84', "المديونية:")} </span>
                            <strong style={{ color: item.balance > 0 ? '#b91c1c' : item.balance < 0 ? '#0284c7' : '#475569', fontSize: '11.5px' }}>
                              {item.balance === 0
                                ? t('delivery_reps.van_itinerary_tab.s85', "خالص (0)")
                                : item.balance < 0
                                ? `دائن (${Math.abs(item.balance).toFixed(0)})`
                                : item.balance.toFixed(0)}{' '}
                              <CurrencySymbol />
                            </strong>
                          </div>
                        </div>

                        {/* If already visited: show visit outcome details */}
                        {item.todayVisit && (
                          <div style={{ backgroundColor: '#f8fafc', padding: '3px 8px', borderRadius: '4px', fontSize: '10.5px', color: '#475569', border: '1px solid #e2e8f0' }}>
                            {item.todayVisit.visitType === 'positive' ? (
                              <span>
                                {t('delivery_reps.van_itinerary_tab.s86', "فاتورة #")}{item.todayVisit.saleDocNo} {t('delivery_reps.van_itinerary_tab.s87', "بمبلغ")} <strong>{item.todayVisit.saleTotal} <CurrencySymbol /></strong>
                              </span>
                            ) : (
                              <span>
                                {t('delivery_reps.van_itinerary_tab.s88', "السبب:")} <strong>{negative.getReasonLabel(item.todayVisit.negativeReason)}</strong>
                                {item.todayVisit.postponedToDate && ` (تم التأجيل إلى: ${item.todayVisit.postponedToDate})`}
                                {item.todayVisit.notes && ` — "${item.todayVisit.notes}"`}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add New Customer / Store to Route Modal */}
      {add.addCustomerModalOpen && (
        <StandardDialog
          open={add.addCustomerModalOpen}
          onClose={() => add.setAddCustomerModalOpen(false)}
          title={t('delivery_reps.van_itinerary_tab.s89', "إضافة محل جديد لخط السير")}
          subtitle={t('delivery_reps.van_itinerary_tab.s90', "تسجيل بيانات المحل وإدراجه بخط سير اليوم")}
          minHeight="490px"
          footerActions={
            <StandardDialogFooter
              onClose={() => add.setAddCustomerModalOpen(false)}
              cancelText={t('delivery_reps.van_itinerary_tab.s91', "إلغاء")}
              extraActions={
                <Button
                  variant="primary"
                  onClick={add.handleCreateCustomer}
                  disabled={add.isCreatingCustomer || !add.newCustName.trim()}
                  style={{ backgroundColor: '#170e5e', color: '#ffffff', fontWeight: 800 }}
                >
                  {add.isCreatingCustomer ? t('delivery_reps.van_itinerary_tab.s92', "جاري الحفظ...") : t('delivery_reps.van_itinerary_tab.s93', "حفظ وإدراج في خط السير")}
                </Button>
              }
            />
          }
        >
          <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 1. Store Name */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '3px' }}>
                {t('delivery_reps.van_itinerary_tab.s94', "اسم المحل / العميل *")}
              </label>
              <input
                type="text"
                value={add.newCustName}
                onChange={(e) => add.setNewCustName(e.target.value)}
                placeholder={t('delivery_reps.van_itinerary_tab.s95', "مثال: سوبرماركت البركة")}
                style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
              />
            </div>

            {/* 2. Phone + District (2 Columns) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '3px' }}>
                  {t('delivery_reps.van_itinerary_tab.s96', "رقم الهاتف / الموبايل")}
                </label>
                <input
                  type="tel"
                  value={add.newCustPhone}
                  onChange={(e) => add.setNewCustPhone(e.target.value)}
                  placeholder="01xxxxxxxxx"
                  dir="ltr"
                  style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box', textAlign: 'right' }}
                />
              </div>

              {/* District Custom Combobox */}
              <div ref={add.districtContainerRef} style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '3px' }}>
                  {t('delivery_reps.van_itinerary_tab.s97', "الحي / المربع السكني")}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={add.newCustDistrict}
                    onChange={(e) => {
                      add.setNewCustDistrict(e.target.value);
                      if (!add.districtDropdownOpen) add.setDistrictDropdownOpen(true);
                    }}
                    onFocus={() => add.setDistrictDropdownOpen(true)}
                    placeholder={t('delivery_reps.van_itinerary_tab.s98', "اختر أو اكتب الحي...")}
                    style={{
                      width: '100%',
                      height: '36px',
                      padding: '0 26px 0 10px',
                      borderRadius: '6px',
                      border: add.districtDropdownOpen ? '1px solid #170e5e' : '1px solid #cbd5e1',
                      fontSize: '12.5px',
                      boxSizing: 'border-box',
                      backgroundColor: '#ffffff',
                    }}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => add.setDistrictDropdownOpen((prev) => !prev)}
                    style={{
                      position: 'absolute',
                      left: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ChevronDownIcon
                      size={14}
                      style={{
                        transition: 'transform 0.15s ease',
                        transform: add.districtDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </button>
                </div>

                {/* Dropdown Card */}
                {add.districtDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      right: 0,
                      left: 0,
                      maxHeight: '190px',
                      overflowY: 'auto',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
                      zIndex: 100,
                    }}
                  >
                    <div style={{ padding: '6px 10px', fontSize: '10.5px', fontWeight: 700, color: '#64748b', backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                      {t('delivery_reps.van_itinerary_tab.s99', "الأحياء المحفوظة (")}{filters.savedDistrictsList.length}):
                    </div>
                    {add.filteredDistricts.length === 0 && !add.newCustDistrict.trim() && (
                      <div style={{ padding: '10px 12px', fontSize: '11.5px', color: '#94a3b8', textAlign: 'center' }}>
                        {t('delivery_reps.van_itinerary_tab.s100', "لا توجد أحياء مسجلة سابقاً")}
                      </div>
                    )}
                    {add.filteredDistricts.map((d) => (
                      <div
                        key={d}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          add.setNewCustDistrict(d);
                          add.setDistrictDropdownOpen(false);
                        }}
                        style={{
                          padding: '7px 10px',
                          fontSize: '12px',
                          fontWeight: add.newCustDistrict.trim() === d ? 700 : 500,
                          color: add.newCustDistrict.trim() === d ? '#170e5e' : '#0f172a',
                          backgroundColor: add.newCustDistrict.trim() === d ? '#eef2ff' : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: '1px solid #f8fafc',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <MapPinIcon size={13} color={add.newCustDistrict.trim() === d ? '#170e5e' : '#94a3b8'} />
                          <span>{d}</span>
                        </div>
                        {add.newCustDistrict.trim() === d && <CheckCircleIcon size={13} color="#170e5e" />}
                      </div>
                    ))}
                    {add.newCustDistrict.trim() && !filters.savedDistrictsList.some((d) => d.toLowerCase() === add.newCustDistrict.trim().toLowerCase()) && (
                      <div
                        onMouseDown={(e) => {
                          e.preventDefault();
                          add.setDistrictDropdownOpen(false);
                        }}
                        style={{
                          padding: '7px 10px',
                          fontSize: '11.5px',
                          fontWeight: 600,
                          color: '#2563eb',
                          backgroundColor: '#eff6ff',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <PlusIcon size={12} color="#2563eb" />
                        <span>{t('delivery_reps.van_itinerary_tab.s101', "إضافة حي جديد: \"")}{add.newCustDistrict.trim()}&quot;</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Detailed Address / Landmark with GPS button */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  {t('delivery_reps.van_itinerary_tab.s102', "العنوان التفصيلي / علامة مميزة")}
                </label>
                <button
                  type="button"
                  onClick={add.handleCaptureGps}
                  disabled={add.isLocatingGps}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 8px',
                    borderRadius: '5px',
                    border: add.newCustGps ? '1px solid #86efac' : '1px solid #cbd5e1',
                    backgroundColor: add.newCustGps ? '#f0fdf4' : '#f8fafc',
                    color: add.newCustGps ? '#15803d' : '#475569',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <MapPinIcon size={12} color={add.newCustGps ? '#15803d' : '#64748b'} />
                  <span>
                    {add.isLocatingGps
                      ? t('delivery_reps.van_itinerary_tab.s103', "جاري التحديد...")
                      : add.newCustGps
                        ? t('delivery_reps.van_itinerary_tab.s104', "تم تثبيت GPS")
                        : t('delivery_reps.van_itinerary_tab.s105', "التقاط موقع المحل (GPS)")}
                  </span>
                </button>
              </div>
              <input
                type="text"
                value={add.newCustAddress}
                onChange={(e) => add.setNewCustAddress(e.target.value)}
                placeholder={t('delivery_reps.van_itinerary_tab.s106', "مثال: شارع الجمهورية - بجوار مسجد النور")}
                style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12.5px', boxSizing: 'border-box' }}
              />
            </div>

            {/* 4. Scheduled Visit Days */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  {t('delivery_reps.van_itinerary_tab.s107', "أيام الزيارة الأسبوعية المجدولة")}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => add.setNewCustVisitDays([...ALL_WEEK_DAYS])}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: '11px',
                      fontWeight: 700,
                      color: add.newCustVisitDays.length === 7 ? '#170e5e' : '#2563eb',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    {t('delivery_reps.van_itinerary_tab.s108', "كل الأيام")}
                  </button>
                  <span style={{ fontSize: '10px', color: '#cbd5e1' }}>•</span>
                  <button
                    type="button"
                    onClick={() => add.setNewCustVisitDays([filters.todayArabicName])}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    {t('delivery_reps.van_itinerary_tab.s109', "اليوم فقط")}
                  </button>
                </div>
              </div>

              {/* 7 Day Touch Pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {ALL_WEEK_DAYS.map((day) => {
                  const isSelected = add.newCustVisitDays.some(
                    (d) => normalizeDayKey(d) === normalizeDayKey(day)
                  );
                  const isToday = normalizeDayKey(day) === normalizeDayKey(filters.todayArabicName);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          if (add.newCustVisitDays.length > 1) {
                            add.setNewCustVisitDays((prev) =>
                              prev.filter((d) => normalizeDayKey(d) !== normalizeDayKey(day))
                            );
                          } else {
                            toast.warning(t('delivery_reps.van_itinerary_tab.s110', "يجب تحديد يوم واحد على الأقل لزيارة العميل"));
                          }
                        } else {
                          add.setNewCustVisitDays((prev) => [...prev, day]);
                        }
                      }}
                      style={{
                        flex: '1 0 calc(25% - 5px)',
                        minWidth: '46px',
                        height: '28px',
                        padding: '0 4px',
                        borderRadius: '6px',
                        border: isSelected ? '1.5px solid #170e5e' : '1px solid #e2e8f0',
                        backgroundColor: isSelected ? '#170e5e' : '#f8fafc',
                        color: isSelected ? '#ffffff' : '#475569',
                        fontSize: '11px',
                        fontWeight: isSelected ? 700 : 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px',
                        transition: 'none',
                      }}
                    >
                      {isToday && (
                        <span
                          style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            backgroundColor: isSelected ? '#38bdf8' : '#170e5e',
                            display: 'inline-block',
                          }}
                        />
                      )}
                      <span>{day}</span>
                    </button>
                  );
                })}
              </div>
              <span style={{ fontSize: '10px', color: '#64748b', marginTop: '3px', display: 'block' }}>
                {t('delivery_reps.van_itinerary_tab.s111', "يظهر المحل في خط سير المندوب تلقائياً في الأيام المختارة فقط.")}
              </span>
            </div>

            {/* 5. Main Route Combobox */}
            <div ref={add.routeContainerRef} style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  {t('delivery_reps.van_itinerary_tab.s112', "خط السير الرئيسي (Route)")}
                </label>
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  {t('delivery_reps.van_itinerary_tab.s113', "مسار الرحلة الجغرافي")}
                </span>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={add.newCustRoute}
                  onChange={(e) => {
                    add.setNewCustRoute(e.target.value);
                    if (!add.routeDropdownOpen) add.setRouteDropdownOpen(true);
                  }}
                  onFocus={() => add.setRouteDropdownOpen(true)}
                  placeholder={filters.routes[0] || t('delivery_reps.van_itinerary_tab.s114', "مثال: خط فيصل الرئيسي")}
                  style={{
                    width: '100%',
                    height: '36px',
                    padding: '0 26px 0 10px',
                    borderRadius: '6px',
                    border: add.routeDropdownOpen ? '1px solid #170e5e' : '1px solid #cbd5e1',
                    fontSize: '12.5px',
                    boxSizing: 'border-box',
                    backgroundColor: '#ffffff',
                  }}
                />
                {filters.routes.length > 0 && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => add.setRouteDropdownOpen((prev) => !prev)}
                    style={{
                      position: 'absolute',
                      left: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ChevronDownIcon
                      size={14}
                      style={{
                        transition: 'transform 0.15s ease',
                        transform: add.routeDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </button>
                )}
              </div>

              {/* Route Dropdown Card */}
              {add.routeDropdownOpen && filters.routes.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    right: 0,
                    left: 0,
                    maxHeight: '160px',
                    overflowY: 'auto',
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
                    zIndex: 100,
                  }}
                >
                  <div style={{ padding: '6px 10px', fontSize: '10.5px', fontWeight: 700, color: '#64748b', backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                    {t('delivery_reps.van_itinerary_tab.s115', "خطوط سير الرحلة الحالية:")}
                  </div>
                  {add.filteredRoutes.map((r) => (
                    <div
                      key={r}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        add.setNewCustRoute(r);
                        add.setRouteDropdownOpen(false);
                      }}
                      style={{
                        padding: '7px 10px',
                        fontSize: '12px',
                        fontWeight: add.newCustRoute.trim() === r ? 700 : 500,
                        color: add.newCustRoute.trim() === r ? '#170e5e' : '#0f172a',
                        backgroundColor: add.newCustRoute.trim() === r ? '#eef2ff' : 'transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid #f8fafc',
                      }}
                    >
                      <span>{r}</span>
                      {add.newCustRoute.trim() === r && <CheckCircleIcon size={13} color="#170e5e" />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Hint Notice */}
            <div style={{ fontSize: '11px', color: '#64748b', backgroundColor: '#f8fafc', padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircleIcon size={13} color="#15803d" />
              <span>{t('delivery_reps.van_itinerary_tab.s116', "المحل يُسجل بنظام (سداد نقدي) ويُدرج في خط سير اليوم لتبدأ زيارته فوراً، ويتكرر أسبوعياً في الأيام المحددة.")}</span>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* Bottom Pagination Bar */}
      <VanItineraryPagination
        startIdx={list.startIdx}
        pageSize={filters.pageSize}
        totalCount={list.allSortedCustomers.length}
        currentPage={filters.currentPage}
        totalPages={list.totalPages}
        onPageChange={filters.setCurrentPage}
        onPageSizeChange={filters.handlePageSizeChange}
      />
      </>
      )}

      {/* Negative Visit Dialog */}
      {negative.negativeModalOpen && negative.activeCustomer && (
        <StandardDialog
          open={true}
          onClose={() => negative.setNegativeModalOpen(false)}
          title={t('delivery_reps.van_itinerary_tab.s117', "تسجيل زيارة غير موفقة")}
          subtitle={`${negative.activeCustomer.customerName} [${negative.activeCustomer.customerCode.replace(/^#/, '')}]`}
          badge={t('delivery_reps.van_itinerary_tab.s118', "خط السير الميداني")}
          width="min(460px, 95vw)"
          compact={true}
          footerActions={
            <StandardDialogFooter
              onClose={() => negative.setNegativeModalOpen(false)}
              cancelText={t('delivery_reps.van_itinerary_tab.s119', "إلغاء")}
              extraActions={
                <Button
                  variant="primary"
                  onClick={negative.handleSubmitNegativeVisit}
                  disabled={negative.isSubmitting}
                  style={{ backgroundColor: '#dc2626', color: '#ffffff', fontSize: '12px', fontWeight: 800, padding: '6px 14px' }}
                >
                  {negative.isSubmitting ? t('delivery_reps.van_itinerary_tab.s120', "جاري الحفظ...") : t('delivery_reps.van_itinerary_tab.s121', "تأكيد وحفظ الزيارة السلبية")}
                </Button>
              }
            />
          }
        >
          <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
                {t('delivery_reps.van_itinerary_tab.s122', "حدد سبب عدم إتمام البيع (لمسة واحدة):")}
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '6px',
                }}
              >
                {[
                  { value: 'shop_closed', label: t('delivery_reps.van_itinerary_tab.s123', "المحل مغلق") },
                  { value: 'no_cash', label: t('delivery_reps.van_itinerary_tab.s124', "مفيش نقدية / رفض الدفع") },
                  { value: 'sufficient_stock', label: t('delivery_reps.van_itinerary_tab.s125', "لديه بضاعة كافية") },
                  { value: 'item_unavailable', label: t('delivery_reps.van_itinerary_tab.s126', "الصنف غير متوفر بالسيارة") },
                  { value: 'postponed', label: t('delivery_reps.van_itinerary_tab.s127', "تأجيل الزيارة لموعد لاحق") },
                  { value: 'other', label: t('delivery_reps.van_itinerary_tab.s128', "أسباب أخرى") },
                ].map((item) => {
                  const isSelected = negative.negativeReason === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => negative.setNegativeReason(item.value as any)}
                      style={{
                        padding: '7px 8px',
                        borderRadius: '7px',
                        border: isSelected ? '1.5px solid #dc2626' : '1px solid #cbd5e1',
                        backgroundColor: isSelected ? '#fef2f2' : '#ffffff',
                        color: isSelected ? '#991b1b' : '#334155',
                        fontSize: '11.5px',
                        fontWeight: isSelected ? 800 : 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        textAlign: 'center',
                        lineHeight: 1.3,
                        minHeight: '36px',
                      }}
                    >
                      {isSelected && (
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#dc2626', display: 'inline-block' }} />
                      )}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {negative.negativeReason === 'postponed' && (
              <div style={{ backgroundColor: '#eff6ff', padding: '8px 10px', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
                <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 800, color: '#1e40af', marginBottom: '4px' }}>
                  {t('delivery_reps.van_itinerary_tab.s129', "تاريخ التأجيل المقترح:")}
                </label>
                <input
                  type="date"
                  value={negative.postponedDate}
                  onChange={(e) => negative.setPostponedDate(e.target.value)}
                  style={{
                    width: '100%',
                    height: '34px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    border: '1.5px solid #93c5fd',
                    backgroundColor: '#ffffff',
                    fontSize: '12px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '11.5px', fontWeight: 700, color: '#475569', marginBottom: '3px' }}>
                {t('delivery_reps.van_itinerary_tab.s130', "ملاحظات المندوب الميدانية (اختياري):")}
              </label>
              <textarea
                value={negative.negativeNotes}
                onChange={(e) => negative.setNegativeNotes(e.target.value)}
                placeholder={t('delivery_reps.van_itinerary_tab.s131', "أية ملاحظات إضافية حول سبب الزيارة...")}
                rows={2}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '11.5px',
                  boxSizing: 'border-box',
                  resize: 'none',
                }}
              />
            </div>

            <div
              style={{
                backgroundColor: '#f8fafc',
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                fontSize: '10.5px',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <MapPinIcon size={13} color="#0284c7" />
              <span>{t('delivery_reps.van_itinerary_tab.s132', "سيتم التقاط إحداثيات الموقع الجغرافي (GPS) تلقائياً لتوثيق وصول المندوب للمحل.")}</span>
            </div>
          </div>
        </StandardDialog>
      )}

      {/* Field Customer Statement Modal */}
      {statementModalCust && (
        <VanCustomerStatementModal
          open={Boolean(statementModalCust)}
          onClose={() => setStatementModalCust(null)}
          customerId={statementModalCust.customerId}
          customerName={statementModalCust.customerName}
        />
      )}

      {/* Dynamic Route Optimization (TSP) Modal */}
      {isOptimizeModalOpen && routeOptimizationResult && (
        <StandardDialog
          open={isOptimizeModalOpen}
          onClose={() => setIsOptimizeModalOpen(false)}
          title={t('delivery_reps.van_itinerary_tab.s133', "تحسين المسار الجغرافي بأقصر طريق (TSP Route Optimization)")}
          subtitle={t('delivery_reps.van_itinerary_tab.s134', "محرك الذكاء المكاني لحساب أقصر مسار بين المحلات وتوفير استهلاك الوقود وزمن الرحلة")}
          width="680px"
          minHeight="480px"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* KPI Stats Ribbon */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s135', "المسافة قبل التحسين")}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#64748b' }}>
                  {routeOptimizationResult.stats.originalDistanceKm} {t('delivery_reps.van_itinerary_tab.s136', "كم")}
                </div>
              </div>

              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s137', "المسافة بعد التحسين")}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#16a34a' }}>
                  {routeOptimizationResult.stats.optimizedDistanceKm} {t('delivery_reps.van_itinerary_tab.s138', "كم")}
                </div>
              </div>

              <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: '#1e40af', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s139', "التوفير في استهلاك الوقود")}</div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#1d4ed8' }}>
                  {routeOptimizationResult.stats.savedDistanceKm} {t('delivery_reps.van_itinerary_tab.s140', "كم (")}{routeOptimizationResult.stats.savingsPercent}%)
                </div>
              </div>
            </div>

            {/* Stops Preview List */}
            <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#1e293b' }}>
              {t('delivery_reps.van_itinerary_tab.s141', "تسلسل المحطات المقترح (")}{routeOptimizationResult.orderedStops.length} {t('delivery_reps.van_itinerary_tab.s142', "محطة):")}
            </div>

            <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px' }}>
              {routeOptimizationResult.orderedStops.map((stop, sIdx) => (
                <div
                  key={stop.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderBottom: sIdx < routeOptimizationResult.orderedStops.length - 1 ? '1px solid #f1f5f9' : 'none',
                    backgroundColor: stop.isUnmappedGps ? '#fffbeb' : '#ffffff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        backgroundColor: '#170e5e',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {stop.sequenceIndex}
                    </span>
                    <div>
                      <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>{stop.name}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        {stop.district ? `${stop.district} - ` : ''}{stop.address || t('delivery_reps.van_itinerary_tab.s143', "بدون عنوان تفصيلي")}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'left', fontSize: '11.5px' }}>
                    {stop.isUnmappedGps ? (
                      <span style={{ color: '#d97706', fontWeight: 600 }}>{t('delivery_reps.van_itinerary_tab.s144', "بدون GPS (في النهاية)")}</span>
                    ) : (
                      <span style={{ color: '#475569', fontWeight: 600 }}>
                        {sIdx === 0 ? t('delivery_reps.van_itinerary_tab.s145', "نقطة الانطلاق") : `+${(stop.legDistanceMeters / 1000).toFixed(1)} كم`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <StandardDialogFooter>
              <Button type="button" variant="secondary" onClick={() => setIsOptimizeModalOpen(false)}>
                {t('delivery_reps.van_itinerary_tab.s146', "إلغاء")}
              </Button>
              <Button
                type="button"
                onClick={handleApplyOptimalRoute}
                disabled={isOptimizingRoute}
                style={{
                  backgroundColor: '#170e5e',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '13px',
                }}
              >
                {isOptimizingRoute ? t('delivery_reps.van_itinerary_tab.s147', "جاري الاعتماد...") : t('delivery_reps.van_itinerary_tab.s148', "اعتماد وحفظ المسار الأمثل")}
              </Button>
            </StandardDialogFooter>
          </div>
        </StandardDialog>
      )}

      {/* Store Shelf Inventory Modal (Optional) */}
      {inventoryCustomer && (
        <VanStoreInventoryModal
          customer={inventoryCustomer}
          tripId={tripId}
          onClose={() => setInventoryCustomer(null)}
          onSuccess={onRefreshItinerary}
        />
      )}

      {/* Trade Merchandising & Competitor Survey Modal */}
      {surveyCustomer && (
        <VanTradeSurveyModal
          customer={surveyCustomer}
          tripId={tripId}
          onClose={() => setSurveyCustomer(null)}
          onSuccess={onRefreshItinerary}
        />
      )}

      {/* Field Damaged / Broken Goods Instant Swap Modal */}
      {swapCustomer && (
        <VanDamagedSwapModal
          open={Boolean(swapCustomer)}
          onClose={() => setSwapCustomer(null)}
          tripId={tripId || 0}
          inventory={inventory || []}
          customers={
            allAvailableCustomers && allAvailableCustomers.length > 0
              ? allAvailableCustomers
              : itinerary.map((it) => ({ id: it.customerId, name: it.customerName, phone: it.customerPhone }))
          }
          defaultCustomerId={swapCustomer.customerId}
          onSwapSuccess={() => {
            setSwapCustomer(null);
            onRefreshItinerary();
          }}
        />
      )}
    </div>
  );
};

