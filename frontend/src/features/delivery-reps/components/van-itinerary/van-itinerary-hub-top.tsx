// Van-itinerary hub top (C-hub-top) — pure move from VanItineraryTab.tsx (slice C-hub-top).
// Hub header + capsules + timer bar (own useTranslation). The facade renders it inside the
// hub div and passes selectedCustomerForHub + visit/timer values as props.

import React, {type Dispatch, type SetStateAction} from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import {
  MapPinIcon,
  ClockIcon,
  PhoneIcon,
  ArrowRightIcon,
  PlayIcon,
} from '@/shared/components/icons/AppIcons';
import type { VanCustomerItineraryItem } from '@/features/delivery-reps/api/van-sales.api';

interface VanItineraryHubTopProps {
  selectedCustomerForHub: VanCustomerItineraryItem;
  setSelectedCustomerForHub: Dispatch<SetStateAction<VanCustomerItineraryItem | null>>;
  elapsedVisitSeconds: number;
  formatElapsed: (seconds: number) => string;
  activeVisit?: {
    customerId: number;
    customerName: string;
    startedAt: number;
    startedTimeStr?: string;
  } | null;
  onStartVisit?: (customerId: number, customerName: string, onSuccess?: () => void) => void;
  onEndVisit?: () => void;
}

export const VanItineraryHubTop: React.FC<VanItineraryHubTopProps> = ({
  selectedCustomerForHub,
  setSelectedCustomerForHub,
  elapsedVisitSeconds,
  formatElapsed,
  activeVisit,
  onStartVisit,
  onEndVisit,
}) => {
  const { t } = useTranslation();

  return (
    <>
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
              onClick={() => setSelectedCustomerForHub(null)}
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
              title={selectedCustomerForHub.customerName}
            >
              {selectedCustomerForHub.customerName}
            </h2>
          </div>

          {/* Call & GPS Action Buttons with soft squircle styling */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {selectedCustomerForHub.customerPhone ? (
              <a
                href={`tel:${selectedCustomerForHub.customerPhone}`}
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
                title={selectedCustomerForHub.customerPhone}
              >
                <PhoneIcon size={12} color="#170e5e" />
                <span>{t('delivery_reps.van_itinerary_tab.s5', "اتصال")}</span>
              </a>
            ) : null}

            {selectedCustomerForHub.locationUrl ? (
              <a
                href={selectedCustomerForHub.locationUrl}
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
              [{selectedCustomerForHub.customerCode.replace(/^#/, '')}]
            </span>

            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedCustomerForHub.district ? `حي: ${selectedCustomerForHub.district}` : (selectedCustomerForHub.route ? `خط: ${selectedCustomerForHub.route}` : '')}
              {selectedCustomerForHub.customerAddress ? ` • ${selectedCustomerForHub.customerAddress}` : ''}
            </span>
          </div>

          {/* Status Badge */}
          <div style={{ flexShrink: 0 }}>
            {selectedCustomerForHub.visitStatus === 'positive' && (
              <span style={{ backgroundColor: '#dcfce7', color: '#15803d', fontSize: '10px', fontWeight: 800, padding: '2px 7px', borderRadius: '6px', border: '1px solid #86efac' }}>
                {t('delivery_reps.van_itinerary_tab.s6', "تم البيع")}
              </span>
            )}
            {selectedCustomerForHub.visitStatus === 'negative' && (
              <span style={{ backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '10px', fontWeight: 800, padding: '2px 7px', borderRadius: '6px', border: '1px solid #fca5a5' }}>
                {t('delivery_reps.van_itinerary_tab.s7', "زيارة سلبية")}
              </span>
            )}
            {selectedCustomerForHub.visitStatus === 'pending' && (
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
            border: selectedCustomerForHub.creditLimit > 0 && selectedCustomerForHub.balance > selectedCustomerForHub.creditLimit ? '1px solid #fecaca' : '1px solid #e2e8f0',
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
          <strong style={{ fontSize: '14px', fontWeight: 900, color: selectedCustomerForHub.balance > 0 ? '#b91c1c' : '#0f172a', display: 'block', lineHeight: 1.15 }}>
            {Number(selectedCustomerForHub.balance.toFixed(0)).toLocaleString()} <CurrencySymbol />
          </strong>
          {selectedCustomerForHub.creditLimit > 0 && selectedCustomerForHub.balance > selectedCustomerForHub.creditLimit && (
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
            {Number(selectedCustomerForHub.creditLimit.toFixed(0)).toLocaleString()} <CurrencySymbol />
          </strong>
          {selectedCustomerForHub.creditLimit > 0 ? (
            selectedCustomerForHub.balance >= selectedCustomerForHub.creditLimit ? (
              <span style={{ fontSize: '9px', color: '#b91c1c', fontWeight: 700, display: 'block', marginTop: '2px' }}>
                {t('delivery_reps.van_itinerary_tab.s12', "المتاح: 0")} <CurrencySymbol />
              </span>
            ) : (
              <span style={{ fontSize: '9px', color: '#15803d', fontWeight: 700, display: 'block', marginTop: '2px' }}>
                {t('delivery_reps.van_itinerary_tab.s13', "المتاح:")} {Number((selectedCustomerForHub.creditLimit - selectedCustomerForHub.balance).toFixed(0)).toLocaleString()} <CurrencySymbol />
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
      {activeVisit?.customerId === selectedCustomerForHub.customerId ? (
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
                {formatElapsed(elapsedVisitSeconds)}
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
          onClick={() => onStartVisit?.(selectedCustomerForHub.customerId, selectedCustomerForHub.customerName)}
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
    </>
  );
};
