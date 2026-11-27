// Van-itinerary hub actions (C-hub-actions) — pure move from VanItineraryTab.tsx (slice C-hub-actions).
// 8 action tiles + today-visit summary (own useTranslation). The facade renders it inside the
// hub div and passes the hub customer + modal setters + visit callbacks as props.

import React, {type Dispatch, type SetStateAction} from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import {
  XCircleIcon,
  SearchIcon,
  CreditCardIcon,
  ReceiptIcon,
  FileTextIcon,
  PackageIcon,
  RefreshCwIcon,
  ClockIcon,
  RotateCcwIcon,
} from '@/shared/components/icons/AppIcons';
import type { VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';

interface VanItineraryHubActionsProps {
  selectedCustomerForHub: VanCustomerItineraryItem;
  setSelectedCustomerForHub: Dispatch<SetStateAction<VanCustomerItineraryItem | null>>;
  setInventoryCustomer: Dispatch<SetStateAction<VanCustomerItineraryItem | null>>;
  setSurveyCustomer: Dispatch<SetStateAction<VanCustomerItineraryItem | null>>;
  setSwapCustomer: Dispatch<SetStateAction<VanCustomerItineraryItem | null>>;
  setStatementModalCust: Dispatch<SetStateAction<VanCustomerItineraryItem | null>>;
  openNegativeVisitModal: (customer: VanCustomerItineraryItem) => void;
  onSelectCustomerForSale: (customerId: number) => void;
  onSelectCustomerForReturn?: (customerId: number) => void;
  onSelectCustomerForCollection?: (customerId: number) => void;
  activeVisit?: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
  } | null;
  onStartVisit?: (customerId: number, customerName: string, onSuccess?: () => void) => void;
  getReasonLabel: (reason?: string) => string;
}

export const VanItineraryHubActions: React.FC<VanItineraryHubActionsProps> = ({
  selectedCustomerForHub,
  setSelectedCustomerForHub,
  setInventoryCustomer,
  setSurveyCustomer,
  setSwapCustomer,
  setStatementModalCust,
  openNegativeVisitModal,
  onSelectCustomerForSale,
  onSelectCustomerForReturn,
  onSelectCustomerForCollection,
  activeVisit,
  onStartVisit,
  getReasonLabel,
}) => {
  const { t } = useTranslation();

  return (
    <>
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
              const cId = selectedCustomerForHub.customerId;
              const cName = selectedCustomerForHub.customerName;
              const proceedToSale = () => {
                setSelectedCustomerForHub(null);
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
              const cId = selectedCustomerForHub.customerId;
              const cName = selectedCustomerForHub.customerName;
              const proceedToReturn = () => {
                setSelectedCustomerForHub(null);
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
              const cId = selectedCustomerForHub.customerId;
              const cName = selectedCustomerForHub.customerName;
              const proceedToCollection = () => {
                setSelectedCustomerForHub(null);
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
              setStatementModalCust(selectedCustomerForHub);
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
              const cust = selectedCustomerForHub;
              const proceedToSwap = () => {
                setSelectedCustomerForHub(null);
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
              const cust = selectedCustomerForHub;
              const proceedToInventory = () => {
                setSelectedCustomerForHub(null);
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
              const cust = selectedCustomerForHub;
              const proceedToSurvey = () => {
                setSelectedCustomerForHub(null);
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
              const cust = selectedCustomerForHub;
              openNegativeVisitModal(cust);
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
      {selectedCustomerForHub.todayVisit && (
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
          {selectedCustomerForHub.todayVisit.visitType === 'positive' ? (
            <span style={{ color: '#15803d', fontWeight: 800 }}>
              {t('delivery_reps.van_itinerary_tab.s37', "فاتورة #")}{selectedCustomerForHub.todayVisit.saleDocNo} ({selectedCustomerForHub.todayVisit.saleTotal} <CurrencySymbol />)
            </span>
          ) : (
            <span style={{ color: '#b91c1c', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {getReasonLabel(selectedCustomerForHub.todayVisit.negativeReason)}
              {selectedCustomerForHub.todayVisit.notes && ` — "${selectedCustomerForHub.todayVisit.notes}"`}
            </span>
          )}
        </div>
      )}
    </>
  );
};
