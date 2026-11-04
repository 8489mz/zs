import { useTranslation } from 'react-i18next';
import { useState, useEffect, memo } from 'react';
import { Link } from 'react-router-dom';
import { SlidersIcon, LightbulbIcon, RotateCcwIcon, CheckIcon, ShieldAlertIcon, InfoIcon, PlusCircleIcon, Trash2Icon, CheckCircleIcon, CheckShieldIcon, LockIcon, ClockIcon, EyeOffIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import { posApi, HardwareBridgeClient } from '@/features/pos';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';
import type { PosTerminalDeviceConfig } from '@/types/domain-models/settings';
import { FormSection } from '@/shared/components/form-section';
import { CustomSelect } from '@/shared/ui/custom-select';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalCurrencySymbol, isKuwait, isSaudi } from '@/lib/currencies';

interface SalesInventoryTabProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  activeTab: string;
  settings?: AppSettings;
}

// Premium SVG Line Icons
function TaxCalcIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
      <path d="M12 6v12" />
    </svg>
  );
}

function NegativeStockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 8-2 2-1.5-1.5" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      <path d="m15 5 3 3" />
      <path d="M3 21h18" />
    </svg>
  );
}

function ZeroCostIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function CashierShiftLockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1" />
    </svg>
  );
}

function LowStockIndicatorIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}

function IssueModeDocIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

function DeliveryModeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
      <path d="M5 17H3v-4l2-5h9v9" />
      <path d="m14 7 3 3h4v4h-2" />
      <path d="M9 17h6" />
    </svg>
  );
}

function RestaurantTablesIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16" />
      <path d="M4 10h16" />
      <path d="M6 10v10" />
      <path d="M18 10v10" />
      <path d="M10 10v6" />
      <path d="M14 10v6" />
    </svg>
  );
}

function RestaurantServiceChargeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
      <path d="M16 11l2 2 4-4" />
    </svg>
  );
}

function CourierCommissionIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

function DefaultDeliveryFeeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function ExpiryAlertIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="12" y1="14" x2="12" y2="17" />
      <line x1="12" y1="19" x2="12.01" y2="19" />
    </svg>
  );
}

function StagnantStockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
      <circle cx="18" cy="18" r="3" fill="#fef3c7" stroke="#d97706" />
      <polyline points="18 16.5 18 18 19 18" stroke="#d97706" />
    </svg>
  );
}

function LoyaltyPointsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function PosTerminalIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="16" y1="14" x2="16" y2="14.01" />
      <path d="M8 10h.01" />
      <path d="M12 10h.01" />
      <path d="M16 10h.01" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M8 18h8" />
    </svg>
  );
}

function RetentionShieldIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function AdvanceRecoveryIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function TenderMarginIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function BoqLinkIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function DemurrageClockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function LandedCostIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

const premiumCardStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 18px',
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
  gap: '12px',
};

const iconBadgeStyle = {
  width: '38px',
  height: '38px',
  borderRadius: '8px',
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#0f172a',
  flexShrink: 0,
};

const premiumCardTextStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '3px',
};

const premiumCheckboxInputStyle = {
  width: '18px',
  height: '18px',
  accentColor: '#0f172a',
  cursor: 'pointer',
  flexShrink: 0,
};

const fieldControlStyle: React.CSSProperties = {
  width: '100%',
  height: '38px',
  minHeight: '38px',
  padding: '0 12px',
  fontSize: '0.84rem',
  fontWeight: 600,
  color: '#0f172a',
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: '8px',
  boxSizing: 'border-box',
};

interface PosTerminalTestResult {
  reachable: boolean;
  pingSucceeded: boolean;
  portOpen: boolean;
  ip: string;
  port: number;
  latencyMs?: number;
  message: string;
  details?: string;
  provider?: string;
  timestamp?: number;
}

interface PosTerminalCardProps {
  terminal: PosTerminalDeviceConfig;
  index: number;
  totalCount: number;
  disabled: boolean;
  isMasterEnabled: boolean;
  onUpdate: (updated: PosTerminalDeviceConfig) => void;
  onRemove: (id: string) => void;
  onSetDefault: (id: string) => void;
  onTest: (term: PosTerminalDeviceConfig) => void;
  isTesting: boolean;
  testResult?: PosTerminalTestResult | null;
}

const PosTerminalCard = memo(function PosTerminalCard({
  terminal,
  index,
  totalCount,
  disabled,
  isMasterEnabled,
  onUpdate,
  onRemove,
  onSetDefault,
  onTest,
  isTesting,
  testResult,
}: PosTerminalCardProps) {
  const { t } = useTranslation();
  const providerDisplayMap: Record<string, { label: string; badgeBg: string; badgeColor: string; borderColor: string }> = {
    geidea: { label: 'Geidea POS (جيديا)', badgeBg: '#f8fafc', badgeColor: '#334155', borderColor: '#e2e8f0' },
    paymob: { label: 'Paymob Smart POS (باي موب)', badgeBg: '#f8fafc', badgeColor: '#334155', borderColor: '#e2e8f0' },
    fawry: { label: 'Fawry POS / PAX (فوري / باكس)', badgeBg: '#f8fafc', badgeColor: '#334155', borderColor: '#e2e8f0' },
    knet_pos: { label: 'K-NET POS (كي-نت الكويت)', badgeBg: '#eef2ff', badgeColor: '#1e3a8a', borderColor: '#c7d2fe' },
    network_international: { label: 'Network International (NI)', badgeBg: '#f8fafc', badgeColor: '#334155', borderColor: '#e2e8f0' },
    mock_sandbox: { label: 'محاكي تجريبي (Simulator)', badgeBg: '#f8fafc', badgeColor: '#475569', borderColor: '#e2e8f0' },
  };

  const providerInfo = providerDisplayMap[terminal.provider] || providerDisplayMap.fawry;
  const isCardDisabled = disabled || !isMasterEnabled || !terminal.enabled;

  return (
    <div
      style={{
        background: '#ffffff',
        border: terminal.isDefault ? '1px solid #170e5e' : '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        boxShadow: terminal.isDefault ? '0 3px 10px -2px rgba(23, 14, 94, 0.08), 0 1px 3px rgba(0,0,0,0.02)' : '0 1px 3px rgba(0,0,0,0.02)',
        position: 'relative',
        transition: 'all 0.15s ease',
        opacity: (!isMasterEnabled || !terminal.enabled) ? 0.72 : 1,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: '#f8fafc',
              border: `1px solid ${terminal.isDefault ? '#cbd5e1' : '#e2e8f0'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: terminal.isDefault ? '#170e5e' : '#475569',
              flexShrink: 0,
            }}
          >
            <PosTerminalIcon size={18} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                {terminal.name || `ماكينة ${index + 1}`}
              </strong>
              {terminal.isDefault && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px',
                    fontWeight: 700,
                    background: '#170e5e',
                    color: '#ffffff',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    lineHeight: 1.4,
                  }}
                >
                  <CheckCircleIcon size={11} color="#ffffff" />
                  <span>{t('settings.forms.tabs.sales_inventory_settings_tab.s0', "الافتراضية")}</span>
                </span>
              )}
            </div>
            <span
              style={{
                display: 'inline-block',
                marginTop: '3px',
                fontSize: '11px',
                fontWeight: 600,
                background: providerInfo.badgeBg,
                color: providerInfo.badgeColor,
                border: `1px solid ${providerInfo.borderColor}`,
                padding: '1px 7px',
                borderRadius: '4px',
              }}
            >
              {providerInfo.label}
            </span>
          </div>
        </div>

        {/* Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Active Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={terminal.enabled}
            title={terminal.enabled ? t('settings.forms.tabs.sales_inventory_settings_tab.s1', "الماكينة نشطة ومتاحة في الكاشير") : t('settings.forms.tabs.sales_inventory_settings_tab.s2', "الماكينة معطلة")}
            onClick={() => onUpdate({ ...terminal, enabled: !terminal.enabled })}
            disabled={disabled || !isMasterEnabled}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '3px 8px',
              borderRadius: '6px',
              cursor: (disabled || !isMasterEnabled) ? 'not-allowed' : 'pointer',
              userSelect: 'none',
              transition: 'all 0.15s ease',
            }}
          >
            <span
              style={{
                width: '28px',
                height: '16px',
                borderRadius: '999px',
                background: terminal.enabled ? '#170e5e' : '#cbd5e1',
                position: 'relative',
                display: 'inline-block',
                transition: 'background-color 0.15s ease',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: '#ffffff',
                  position: 'absolute',
                  top: '2px',
                  right: terminal.enabled ? '2px' : '14px',
                  transition: 'right 0.15s ease',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                }}
              />
            </span>
            <span style={{ fontSize: '0.74rem', fontWeight: 600, color: terminal.enabled ? '#0f172a' : '#64748b' }}>
              {terminal.enabled ? t('settings.forms.tabs.sales_inventory_settings_tab.s3', "مفعلة") : t('settings.forms.tabs.sales_inventory_settings_tab.s4', "معطلة")}
            </span>
          </button>

          {/* Set Default Button */}
          {!terminal.isDefault && (
            <button
              type="button"
              disabled={disabled || !isMasterEnabled}
              onClick={() => onSetDefault(terminal.id)}
              style={{
                fontSize: '0.72rem',
                fontWeight: 600,
                color: '#334155',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '3px 9px',
                cursor: (disabled || !isMasterEnabled) ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!disabled && isMasterEnabled) {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#94a3b8';
                  e.currentTarget.style.color = '#0f172a';
                }
              }}
              onMouseLeave={(e) => {
                if (!disabled && isMasterEnabled) {
                  e.currentTarget.style.background = '#ffffff';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                  e.currentTarget.style.color = '#334155';
                }
              }}
            >
              {t('settings.forms.tabs.sales_inventory_settings_tab.s5', "تعيين كافتراضية")}
            </button>
          )}

          {/* Delete Button (if > 1 terminal) */}
          {totalCount > 1 && (
            <button
              type="button"
              disabled={disabled || !isMasterEnabled}
              onClick={() => onRemove(terminal.id)}
              title={t('settings.forms.tabs.sales_inventory_settings_tab.s6', "إزالة هذه الماكينة")}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '26px',
                height: '26px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                color: '#94a3b8',
                borderRadius: '6px',
                cursor: (disabled || !isMasterEnabled) ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!disabled && isMasterEnabled) {
                  e.currentTarget.style.background = '#fef2f2';
                  e.currentTarget.style.borderColor = '#fecaca';
                  e.currentTarget.style.color = '#dc2626';
                }
              }}
              onMouseLeave={(e) => {
                if (!disabled && isMasterEnabled) {
                  e.currentTarget.style.background = '#ffffff';
                  e.currentTarget.style.borderColor = '#e2e8f0';
                  e.currentTarget.style.color = '#94a3b8';
                }
              }}
            >
              <Trash2Icon size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Inputs Form */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
        {/* Terminal Name */}
        <div>
          <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('settings.forms.tabs.sales_inventory_settings_tab.s7', "اسم الماكينة")}
          </label>
          <input
            className="purchase-prototype-field-input"
            value={terminal.name}
            onChange={(e) => onUpdate({ ...terminal, name: e.target.value })}
            disabled={isCardDisabled}
            placeholder={`ماكينة ${index + 1}`}
            style={fieldControlStyle}
          />
        </div>

        {/* Provider */}
        <div>
          <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('settings.forms.tabs.sales_inventory_settings_tab.s8', "مزود الخدمة")}
          </label>
          <CustomSelect
            value={terminal.provider}
            onChange={(val) => onUpdate({ ...terminal, provider: val as any })}
            options={[
              { value: 'fawry', label: t('settings.forms.tabs.sales_inventory_settings_tab.s9', "Fawry POS / PAX (فوري - مصر)") },
              { value: 'paymob', label: t('settings.forms.tabs.sales_inventory_settings_tab.s10', "Paymob Smart POS (باي موب - مصر)") },
              { value: 'knet_pos', label: t('settings.forms.tabs.sales_inventory_settings_tab.s11', "K-NET POS (أجهزة كي-نت - الكويت)") },
              { value: 'geidea', label: t('settings.forms.tabs.sales_inventory_settings_tab.s12', "Geidea POS (جيديا - السعودية ومصر)") },
              { value: 'network_international', label: t('settings.forms.tabs.sales_inventory_settings_tab.s13', "Network International (NI - الإمارات والخليج)") },
              { value: 'mock_sandbox', label: t('settings.forms.tabs.sales_inventory_settings_tab.s14', "محاكي نقاط البيع التجريبي (Mock Simulator)") },
            ]}
            disabled={isCardDisabled}
          />
        </div>

        {/* IP Address */}
        <div>
          <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('settings.forms.tabs.sales_inventory_settings_tab.s15', "عنوان IP الماكينة (Local IP)")}
          </label>
          <input
            className="purchase-prototype-field-input"
            value={terminal.ip}
            onChange={(e) => onUpdate({ ...terminal, ip: e.target.value })}
            disabled={isCardDisabled}
            placeholder="192.168.1.150"
            dir="ltr"
            style={{ ...fieldControlStyle, textAlign: 'left', fontFamily: 'monospace' }}
          />
        </div>

        {/* Port */}
        <div>
          <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('settings.forms.tabs.sales_inventory_settings_tab.s16', "المنفذ (Port)")}
          </label>
          <input
            type="number"
            className="purchase-prototype-field-input"
            value={terminal.port}
            onChange={(e) => onUpdate({ ...terminal, port: Number(e.target.value || 8080) })}
            disabled={isCardDisabled}
            placeholder="8080"
            dir="ltr"
            style={{ ...fieldControlStyle, textAlign: 'center', fontFamily: 'monospace' }}
          />
        </div>

        {/* Pairing Key (Optional) */}
        <div>
          <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('settings.forms.tabs.sales_inventory_settings_tab.s17', "رمز الاقتران الأمني (Pairing Key - اختياري)")}
          </label>
          <input
            className="purchase-prototype-field-input"
            value={terminal.pairingKey || ''}
            onChange={(e) => onUpdate({ ...terminal, pairingKey: e.target.value })}
            disabled={isCardDisabled}
            placeholder={t('settings.forms.tabs.sales_inventory_settings_tab.s18', "مثال: 1234 (إن وُجد بالماكينة)")}
            dir="ltr"
            style={{ ...fieldControlStyle, textAlign: 'left', fontFamily: 'monospace' }}
          />
        </div>

        {/* Terminal TID (Optional) */}
        <div>
          <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            {t('settings.forms.tabs.sales_inventory_settings_tab.s19', "معرف الطرفية السحابي (Terminal TID - اختياري)")}
          </label>
          <input
            className="purchase-prototype-field-input"
            value={terminal.terminalTid || ''}
            onChange={(e) => onUpdate({ ...terminal, terminalTid: e.target.value })}
            disabled={isCardDisabled}
            placeholder={t('settings.forms.tabs.sales_inventory_settings_tab.s20', "مثال: TID-884192")}
            dir="ltr"
            style={{ ...fieldControlStyle, textAlign: 'left', fontFamily: 'monospace' }}
          />
        </div>
      </div>

      {/* Action Button: Ping & ECR Handshake */}
      <div>
        <button
          type="button"
          onClick={() => onTest(terminal)}
          disabled={isCardDisabled || isTesting}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            width: '100%',
            minHeight: '36px',
            padding: '6px 14px',
            borderRadius: '8px',
            fontSize: '0.78rem',
            fontWeight: 700,
            background: '#170e5e',
            color: '#ffffff',
            border: 'none',
            cursor: (isCardDisabled || isTesting) ? 'not-allowed' : 'pointer',
            opacity: (isCardDisabled || isTesting) ? 0.65 : 1,
            boxShadow: '0 1px 2px rgba(23, 14, 94, 0.08)',
            transition: 'all 0.15s ease',
          }}
        >
          <RotateCcwIcon size={14} style={{ animation: isTesting ? 'spin 1s linear infinite' : 'none' }} />
          <span>
            {isTesting
              ? `جاري فحص الاتصال بـ (${terminal.ip || '192.168.1.150'})...`
              : `فحص الاتصال الفعلي بالماكينة (${terminal.name || `ماكينة ${index + 1}`})`}
          </span>
        </button>
      </div>

      {/* Diagnostic Card */}
      {testResult && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            border: `1px solid ${
              testResult.portOpen
                ? '#bbf7d0'
                : testResult.pingSucceeded
                ? '#fed7aa'
                : '#fecaca'
            }`,
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {testResult.portOpen ? (
                <CheckIcon size={16} color="#16a34a" />
              ) : testResult.pingSucceeded ? (
                <InfoIcon size={16} color="#d97706" />
              ) : (
                <ShieldAlertIcon size={16} color="#dc2626" />
              )}
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: testResult.portOpen
                    ? '#166534'
                    : testResult.pingSucceeded
                    ? '#9a3412'
                    : '#991b1b',
                }}
              >
                {testResult.message}
              </span>
            </div>
            {testResult.latencyMs != null && (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  background: '#f1f5f9',
                  color: testResult.portOpen ? '#166534' : '#475569',
                  border: '1px solid #e2e8f0',
                  fontFamily: 'monospace',
                  direction: 'ltr',
                }}
              >
                {testResult.latencyMs}ms
              </span>
            )}
          </div>
          {testResult.details && (
            <div
              style={{
                fontSize: '0.74rem',
                lineHeight: 1.5,
                color: '#475569',
              }}
            >
              {testResult.details}
            </div>
          )}
        </div>
      )}

      {/* Live Status Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: !terminal.enabled || !isMasterEnabled
                ? '#94a3b8'
                : testResult?.portOpen
                ? '#16a34a'
                : testResult?.pingSucceeded
                ? '#d97706'
                : testResult
                ? '#dc2626'
                : '#0284c7',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#334155' }}>
            {!isMasterEnabled || !terminal.enabled
              ? t('settings.forms.tabs.sales_inventory_settings_tab.s21', "الماكينة معطلة")
              : testResult?.portOpen
              ? t('settings.forms.tabs.sales_inventory_settings_tab.s22', "متصلة وجاهزة للعمليات (Ready)")
              : testResult?.pingSucceeded
              ? t('settings.forms.tabs.sales_inventory_settings_tab.s23', "أونلاين (المنفذ مغلق أو يحتاج تفعيل ECR)")
              : testResult
              ? t('settings.forms.tabs.sales_inventory_settings_tab.s24', "غير متصلة (تعذر الوصول للـ IP)")
              : t('settings.forms.tabs.sales_inventory_settings_tab.s25', "في انتظار الفحص الشبكي")}
          </span>
        </div>
        <span style={{ fontSize: '0.71rem', color: '#64748b', fontFamily: 'monospace', direction: 'ltr' }}>
          {terminal.ip}:{terminal.port}
        </span>
      </div>
    </div>
  );
});

export const SalesInventorySettingsTab = memo(function SalesInventorySettingsTab({
  form,
  disabled,
  activeTab,
  settings,
}: SalesInventoryTabProps) {
  const { t: __t } = useTranslation();
  const rawActivity = String(form.watch('businessIndustry') || settings?.businessIndustry || (settings as any)?.activityType || 'retail_general').trim().toLowerCase();
  const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات' || Boolean(form.watch('contractingModuleEnabled'));
  const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن' || Boolean(form.watch('maritimeFreightModuleEnabled'));
  const isManufacturingVertical = rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع' || Boolean(form.watch('manufacturingModuleEnabled'));
  const isServicesVertical = rawActivity === 'services' || rawActivity === 'consulting' || rawActivity === 'استشارات';
  const isImportVertical = rawActivity === 'import_export' || rawActivity === 'import';
  const isRestaurantVertical = ['restaurant', 'cafe', 'مطعم', 'كافيه'].includes(rawActivity) || Boolean(form.watch('restaurantModuleEnabled'));
  const isRetailCommerce = !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isServicesVertical;
  const isPosModuleEnabled = Boolean(form.watch('posModuleEnabled') ?? settings?.posModuleEnabled ?? true);
  const showPosSettings = isPosModuleEnabled && isRetailCommerce;
  const showPhysicalInventory = !isServicesVertical;

  const isStoreFleet = form.watch('deliveryFeeMode') === 'store_fleet';
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [testingTerminalId, setTestingTerminalId] = useState<string | null>(null);
  const [terminalTestResults, setTerminalTestResults] = useState<Record<string, PosTerminalTestResult>>({});

  const [isMasterPosTerminalEnabled, setIsMasterPosTerminalEnabled] = useState<boolean>(() => form.getValues('posTerminalEnabled') === true);

  useEffect(() => {
    if (settings?.posTerminalEnabled !== undefined) {
      setIsMasterPosTerminalEnabled(settings.posTerminalEnabled === true);
    }
  }, [settings?.posTerminalEnabled]);

  // Dedicated local state for terminals to guarantee instant reactivity on add, update, remove, and default change
  const [terminalsList, setTerminalsList] = useState<PosTerminalDeviceConfig[]>(() => {
    const fromForm = form.getValues('posTerminals');
    if (Array.isArray(fromForm) && fromForm.length > 0) return fromForm as PosTerminalDeviceConfig[];
    if (Array.isArray(settings?.posTerminals) && settings.posTerminals.length > 0) return settings.posTerminals as PosTerminalDeviceConfig[];
    const isKw = isKuwait(settings);
    const isSa = isSaudi(settings);
    const defaultProv = isKw ? 'knet_pos' : isSa ? 'geidea' : 'fawry';
    const defaultName = isKw ? 'ماكينة كي-نت الرئيسية (K-NET)' : isSa ? 'ماكينة مدى الرئيسية (mada)' : 'ماكينة فوري / باكس الرئيسية';
    return [
      {
        id: 'term-1',
        name: form.getValues('posTerminalName') || settings?.posTerminalName || defaultName,
        provider: (form.getValues('posTerminalProvider') || settings?.posTerminalProvider || defaultProv) as any,
        ip: form.getValues('posTerminalIp') || settings?.posTerminalIp || '192.168.1.150',
        port: Number(form.getValues('posTerminalPort') || settings?.posTerminalPort || 8080),
        enabled: form.getValues('posTerminalEnabled') === true,
        isDefault: true,
      },
    ];
  });

  // Keep terminals in sync if settings loads from API
  useEffect(() => {
    if (Array.isArray(settings?.posTerminals) && settings.posTerminals.length > 0) {
      setTerminalsList(settings.posTerminals as PosTerminalDeviceConfig[]);
      form.setValue('posTerminals', settings.posTerminals as any);
    }
  }, [settings?.posTerminals]);

  const syncTerminalsAndPrimary = (next: PosTerminalDeviceConfig[]) => {
    setTerminalsList(next);
    form.setValue('posTerminals', next as any, { shouldDirty: true, shouldValidate: true });
    const defaultTerm = next.find((t) => t.isDefault) || next[0];
    if (defaultTerm) {
      form.setValue('posTerminalName', defaultTerm.name, { shouldDirty: true });
      form.setValue('posTerminalProvider', defaultTerm.provider as any, { shouldDirty: true });
      form.setValue('posTerminalIp', defaultTerm.ip, { shouldDirty: true });
      form.setValue('posTerminalPort', defaultTerm.port, { shouldDirty: true });
    }
  };

  const handleUpdateTerminal = (updated: PosTerminalDeviceConfig) => {
    const next = terminalsList.map((t) => (t.id === updated.id ? updated : t));
    syncTerminalsAndPrimary(next);
  };

  const handleAddTerminal = () => {
    const isKw = isKuwait(settings);
    const isSa = isSaudi(settings);
    const nextIdx = terminalsList.length + 1;
    let newProvider = 'fawry';
    let newName = `ماكينة ${nextIdx}`;

    if (isKw) {
      newProvider = 'knet_pos';
      newName = `ماكينة ${nextIdx} (كي-نت)`;
    } else if (isSa) {
      newProvider = 'geidea';
      newName = `ماكينة ${nextIdx} (مدى)`;
    } else {
      newProvider = nextIdx % 2 === 0 ? 'paymob' : 'fawry';
      newName = `ماكينة ${nextIdx} (${nextIdx % 2 === 0 ? 'باي موب' : 'فوري'})`;
    }

    const newTerminal: PosTerminalDeviceConfig = {
      id: `term-${Date.now()}`,
      name: newName,
      provider: newProvider as any,
      ip: `192.168.1.${150 + nextIdx - 1}`,
      port: 8080,
      enabled: true,
      isDefault: false,
      pairingKey: '',
      terminalTid: '',
    };
    const next = [...terminalsList, newTerminal];
    syncTerminalsAndPrimary(next);
    toast.success(`تمت إضافة ${newTerminal.name} بنجاح`);
  };

  const handleRemoveTerminal = (id: string) => {
    if (terminalsList.length <= 1) {
      toast.warning('يجب الإبقاء على ماكينة دفع واحدة على الأقل');
      return;
    }
    let next = terminalsList.filter((t) => t.id !== id);
    if (!next.some((t) => t.isDefault) && next.length > 0) {
      next = next.map((t, idx) => (idx === 0 ? { ...t, isDefault: true } : t));
    }
    syncTerminalsAndPrimary(next);
    toast.info('تمت إزالة الماكينة');
  };

  const handleSetDefaultTerminal = (id: string) => {
    const next = terminalsList.map((t) => ({
      ...t,
      isDefault: t.id === id,
    }));
    syncTerminalsAndPrimary(next);
    const target = next.find((t) => t.id === id);
    toast.success(`تم تعيين (${target?.name || 'الماكينة'}) كافتراضية`);
  };

  const handleTestTerminalDevice = async (term: PosTerminalDeviceConfig) => {
    setTestingTerminalId(term.id);
    try {
      const isBridge = await HardwareBridgeClient.isAvailable();
      let resData: any = null;

      if (isBridge) {
        try {
          const bridgeRes = await HardwareBridgeClient.testTerminal({
            ip: term.ip || '192.168.1.150',
            port: Number(term.port || 8080),
            provider: term.provider || 'fawry',
          });
          if (bridgeRes?.data) {
            resData = {
              reachable: Boolean(bridgeRes.data.reachable),
              portOpen: Boolean(bridgeRes.data.portOpen ?? bridgeRes.data.reachable),
              pingSucceeded: Boolean(bridgeRes.data.pingSucceeded ?? bridgeRes.data.reachable),
              latencyMs: bridgeRes.data.latencyMs,
              message: `${bridgeRes.data.message} (عبر جسر العتاد 127.0.0.1:18181)`,
              details: `استجابة الماكينة: ${bridgeRes.data.latencyMs}ms عبر جسر Z-Systems المحلي`,
            };
          } else {
            const errMsg = bridgeRes?.error || 'المنفذ مغلق أو الماكينة لا تستجيب على الشبكة المحلية';
            resData = {
              reachable: false,
              portOpen: false,
              pingSucceeded: false,
              latencyMs: 0,
              message: `${errMsg} (عبر جسر العتاد 127.0.0.1:18181)`,
              details: `قام الجسر المحلي بفحص ${term.ip}:${term.port} ولكن الجهاز رفض الاتصال أو أن التطبيق غير مفتوح على الماكينة.`,
            };
          }
        } catch (bridgeErr: any) {
          resData = {
            reachable: false,
            portOpen: false,
            pingSucceeded: false,
            latencyMs: 0,
            message: `تعذر الاتصال بالماكينة عبر جسر العتاد: ${bridgeErr?.message || 'خطأ اتصال'}`,
            details: 'تأكد من تشغيل الماكينة واتصالها بنفس الراوتر المحلي.',
          };
        }
      } else {
        const res = await posApi.testTerminalConnection({
          ip: term.ip || '192.168.1.150',
          port: Number(term.port || 8080),
          provider: term.provider || 'fawry',
        });
        resData = res.data;
      }

      if (resData) {
        setTerminalTestResults((prev) => ({
          ...prev,
          [term.id]: {
            ...resData,
            timestamp: Date.now(),
          },
        }));
        if (resData.portOpen || resData.reachable) {
          toast.success(resData.message);
        } else if (resData.pingSucceeded) {
          toast.warning(resData.message);
        } else {
          toast.error(resData.message);
        }
      }
    } catch (err: any) {
      const fallbackResult: PosTerminalTestResult = {
        reachable: false,
        pingSucceeded: false,
        portOpen: false,
        ip: term.ip,
        port: term.port,
        message: err?.message || 'فشل الاتصال بالماكينة',
        details: 'حدث خطأ أثناء محاولة فحص الاتصال بالماكينة. يرجى التأكد من تشغيلها واتصالها بنفس الشبكة.',
        timestamp: Date.now(),
      };
      setTerminalTestResults((prev) => ({
        ...prev,
        [term.id]: fallbackResult,
      }));
      toast.error(fallbackResult.message);
    } finally {
      setTestingTerminalId(null);
    }
  };

  return (
    <div style={{ display: activeTab === 'sales_inventory' ? 'block' : 'none' }}>
      {/* ===== إعدادات البيع والضريبة ===== */}
      <FormSection
        title={__t('settings.forms.tabs.sales_inventory_settings_tab.s26', "إعدادات البيع والضريبة")}
        description={__t('settings.forms.tabs.sales_inventory_settings_tab.s27', "تحديد نسبة الضريبة على المبيعات، وطريقة احتسابها على أسعار الأصناف، والرقم الضريبي.")}
      >
        <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
          {/* Card 1: Tax Mode & Rate */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={iconBadgeStyle}>
                <TaxCalcIcon size={20} />
              </div>
              <div>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s28', "حساب الضريبة على المبيعات")}</strong>
                <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s29', "طريقة إضافة القيمة المضافة ونسبتها")}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s30', "نسبة الضريبة (%)")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  {...form.register('taxRate')}
                  disabled={disabled}
                  placeholder="0"
                  style={{
                    ...fieldControlStyle,
                    textAlign: 'center',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s31', "طريقة احتساب الضريبة")}
                </label>
                <CustomSelect
                  value={form.watch('taxMode') || 'exclusive'}
                  onChange={(val) => form.setValue('taxMode', val as any, { shouldDirty: true, shouldValidate: true })}
                  options={[
                    { value: 'exclusive', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s32', "تضاف فوق السعر") },
                    { value: 'inclusive', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s33', "ضمن السعر") },
                  ]}
                  disabled={disabled}
                />
              </div>
            </div>
          </div>

          {/* Card 2: Organization Tax Number */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s34', "الرقم الضريبي للمنشأة")}</strong>
              <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0', fontWeight: 600 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s35', "الفواتير والإيصالات")}</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {__t('settings.forms.tabs.sales_inventory_settings_tab.s36', "رقم التسجيل الضريبي المطبوع على الفاتورة")}
              </label>
              <input
                {...form.register('taxNumber')}
                disabled={disabled}
                placeholder={__t('settings.forms.tabs.sales_inventory_settings_tab.s37', "مثال: 123-456-789")}
                style={fieldControlStyle}
              />
              <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                {__t('settings.forms.tabs.sales_inventory_settings_tab.s38', "يظهر هذا الرقم أعلى ترويسة فواتير المبيعات، الإيصالات الحرارية، وتقارير الإقرارات الضريبية.")}
              </span>
            </div>
          </div>

          {/* Direct link to Advanced Tax & E-Invoice Integration */}
          <div style={{ gridColumn: '1 / -1', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <span style={{ fontSize: '0.78rem', color: '#475569' }}>
              {__t('settings.forms.tabs.sales_inventory_settings_tab.s39', "للربط السحابي المباشر مع مصلحة الضرائب المصرية (ETA) أو هيئة الزكاة والضريبة والجمارك (ZATCA):")}
            </span>
            <Link
              to="/settings/tax-integration"
              className="btn btn-secondary"
              style={{ padding: '4px 12px', fontSize: '0.78rem', fontWeight: 700 }}
            >
              {__t('settings.forms.tabs.sales_inventory_settings_tab.s40', "إعدادات الضرائب والفاتورة الإلكترونية")}
            </Link>
          </div>
        </div>
      </FormSection>

      {/* ===== مخصص لشركات المقاولات والمشاريع (Contracting Dedicated) ===== */}
      {isContractingVertical && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s41', "ضوابط مشاريع المقاولات والمستخلصات والتسعير (BOQ & IPC Controls)")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s42', "تحديد القواعد المالية والتشغيلية لمشاريع المقاولات، نسب ضمان الأعمال المحتجزة، استقطاع الدفعة المقدمة، وهوامش تسعير العطاءات.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
            {/* Card 1: Retention Percent */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <RetentionShieldIcon size={20} />
                </div>
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s43', "نسبة دفعة ضمان الأعمال المحتجزة (Retention %)")}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s44', "النسبة المحتجزة تلقائياً من المستخلص لصالح فترة الضمان والصيانة")}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  className="purchase-prototype-field-input"
                  {...form.register('contractingRetentionPercent')}
                  disabled={disabled}
                  placeholder="5"
                  style={{ ...fieldControlStyle, width: '100px', textAlign: 'center', fontWeight: 800 }}
                />
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s45', "% (النسبة الشائعة 5% - 10%)")}</span>
              </div>
            </div>

            {/* Card 2: Advance Payment Recovery Mode */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <AdvanceRecoveryIcon size={20} />
                </div>
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s46', "استقطاع الدفعة المقدمة من المستخلصات")}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s47', "طريقة إهلاك وخصم الدفعة المقدمة من مستخلصات التنفيذ")}</span>
                </div>
              </div>
              <CustomSelect
                value={form.watch('contractingAdvanceRecoveryMode') || 'proportional'}
                onChange={(val) => form.setValue('contractingAdvanceRecoveryMode', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'proportional', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s48', "خصم نسبي تلقائي حسب نسبة إنجاز المستخلص") },
                  { value: 'fixed', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s49', "مبلغ قطعي محدد لكل مستخلص") },
                ]}
                disabled={disabled}
              />
            </div>

            {/* Card 3: Tender Pricing Margins (Profit, Overhead, Waste) */}
            <div style={{ gridColumn: '1 / -1', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <TenderMarginIcon size={20} />
                </div>
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s50', "هوامش ونسب التسعير الافتراضية لدراسة العطاءات (Tender Estimator)")}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s51', "النسب المعتمدة افتراضياً في حاسبة تسعير بنود المقايسة لتوليد سعر الوحدة التنافسي")}</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s52', "هامش الربح المستهدف (Profit %)")}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      className="purchase-prototype-field-input"
                      {...form.register('contractingDefaultProfitMargin')}
                      disabled={disabled}
                      placeholder="15"
                      style={{ ...fieldControlStyle, textAlign: 'center', fontWeight: 800 }}
                    />
                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#475569' }}>%</span>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s53', "المصاريف الإدارية والعمومية (Overhead %)")}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      className="purchase-prototype-field-input"
                      {...form.register('contractingDefaultOverhead')}
                      disabled={disabled}
                      placeholder="7"
                      style={{ ...fieldControlStyle, textAlign: 'center', fontWeight: 800 }}
                    />
                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#475569' }}>%</span>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s54', "نسبة الهالك المتوقع للمواد (Waste %)")}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      className="purchase-prototype-field-input"
                      {...form.register('contractingDefaultWaste')}
                      disabled={disabled}
                      placeholder="5"
                      style={{ ...fieldControlStyle, textAlign: 'center', fontWeight: 800 }}
                    />
                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#475569' }}>%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 4: Require BOQ Link for Site Issuance */}
            <label style={{ ...premiumCardStyle, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <div style={iconBadgeStyle}>
                  <BoqLinkIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s55', "اشتراط ربط إذن الصرف ببند مقايسة محدد")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s56', "منع صرف أي مواد من مخازن المشاريع دون تحديد بند الأعمال أو المقايسة المرتبط بالصرف لمطابقة تكاليف التنفيذ")}
                  </small>
                </div>
              </div>
              <input
                type="checkbox"
                style={premiumCheckboxInputStyle}
                {...form.register('contractingRequireBoqLinkForIssue')}
                disabled={disabled}
              />
            </label>

            {/* Card 5: Zero Purchase Cost (Client-Supplied Materials) */}
            <label style={{ ...premiumCardStyle, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <div style={iconBadgeStyle}>
                  <ZeroCostIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s57', "السماح بتوريدات بتكلفة شراء صفر")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s58', "مخصص للمواد الموردة من المالك والعميل مباشرة (Client-Supplied Items) أو العينات الفنية المجانية للاستشاري")}
                  </small>
                </div>
              </div>
              <input
                type="checkbox"
                style={premiumCheckboxInputStyle}
                {...form.register('allowZeroPurchaseCost')}
                disabled={disabled}
              />
            </label>

            {/* Card 6: Site Stock Low Threshold */}
            <div style={{ ...premiumCardStyle, cursor: 'default', gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <div style={iconBadgeStyle}>
                  <LowStockIndicatorIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s59', "حد الأمان لنقص تشوينات الموقع")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s60', "يظهر تنبيه نواقص تشوين عندما يصل رصيد المادة بمخزن الموقع لهذا الحد أو أقل لتفادي تعطل الصب والأعمال الميدانية")}
                  </small>
                </div>
              </div>
              <input
                className="purchase-prototype-field-input"
                type="number"
                min="0"
                {...form.register('lowStockThreshold')}
                disabled={disabled}
                placeholder="5"
                style={{ width: '80px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>
        </FormSection>
      )}

      {/* ===== مخصص لشركات الشحن واللوجستيات (Maritime Dedicated) ===== */}
      {isMaritimeVertical && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s61', "ضوابط الشحن الدولي والعمليات الملاحية (Maritime Operations)")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s62', "تحديد العملة الافتراضية لفواتير الشحن والنولون، وأيام السماح لغرامات الأرضيات والحاويات (Demurrage & Detention).")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <DemurrageClockIcon size={20} />
                </div>
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s63', "أيام السماح المجانية للحاويات (Demurrage Free Days)")}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s64', "عدد الأيام المسموح بها في الميناء قبل بدء احتساب غرامات التأخير اليومية")}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  min="0"
                  max="365"
                  className="purchase-prototype-field-input"
                  {...form.register('maritimeDemurrageFreeDays')}
                  disabled={disabled}
                  placeholder="14"
                  style={{ ...fieldControlStyle, width: '100px', textAlign: 'center', fontWeight: 800 }}
                />
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s65', "يوم (الافتراضي 14 أو 21 يوماً)")}</span>
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s66', "عملة تسعير النولون والخدمات البحرية الافتراضية")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s67', "العملة الأساسية لعروض الأسعار الملاحية والتعامل مع الخطوط الدولية")}</span>
              <CustomSelect
                value={form.watch('maritimeDefaultCurrency') || 'USD'}
                onChange={(val) => form.setValue('maritimeDefaultCurrency', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'USD', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s68', "الدولار الأمريكي (USD $)") },
                  { value: 'EUR', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s69', "اليورو الأوروبي (EUR €)") },
                  { value: 'EGP', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s70', "الجنيه المصري (EGP)") },
                  { value: 'SAR', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s71', "الريال السعودي (SAR)") },
                  { value: 'AED', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s72', "الدرهم الإماراتي (AED)") },
                ]}
                disabled={disabled}
              />
            </div>

            {/* Zero cost */}
            <label style={{ ...premiumCardStyle, gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <ZeroCostIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s73', "السماح بإصدار حركات تكلفة صفرية")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s74', "مخصص لنقل الحاويات الفارغة وإرجاع المعدات الملاحية دون تكلفة شراء مباشرة")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowZeroPurchaseCost')} disabled={disabled} />
            </label>
          </div>
        </FormSection>
      )}

      {/* ===== مخصص لشركات الاستيراد والتصدير (Import/Export Dedicated) ===== */}
      {isImportVertical && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s75', "ضوابط الرسائل الجمركية وتكاليف الاستيراد (Landed Cost & Customs)")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s76', "تحديد معيار توزيع مصاريف الشحن والتخليص الجمركي وضريبة الوارد على بنود وأصناف الرسالة الاستيرادية.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <LandedCostIcon size={20} />
                </div>
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s77', "أساس توزيع تكلفة الاستيراد الإجمالية (Landed Cost)")}</strong>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s78', "المعيار المحاسبي لتوزيع مصاريف الشحن والجمارك على تكلفة الوحدة في المخزن")}</span>
                </div>
              </div>
              <CustomSelect
                value={form.watch('importLandedCostMethod') || 'by_value'}
                onChange={(val) => form.setValue('importLandedCostMethod', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'by_value', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s79', "حسب القيمة المالية لكل صنف (Value Proportional)") },
                  { value: 'by_weight', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s80', "حسب الوزن الإجمالي (Gross Weight - KG/Ton)") },
                  { value: 'by_volume', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s81', "حسب الحجم بالمتر المكعب (CBM)") },
                  { value: 'by_quantity', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s82', "حسب عدد القطع والوحدات (Quantity)") },
                ]}
                disabled={disabled}
              />
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s83', "الربط التلقائي للمصاريف البنكية والاعتمادات")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s84', "إدراج عمولات فتح الاعتماد المستندي (LC) وفروق أسعار الصرف ضمن تكلفة الشحنة")}</span>
              <CustomSelect
                value={form.watch('importAutoLinkBankExpenses') || 'auto_link'}
                onChange={(val) => form.setValue('importAutoLinkBankExpenses', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'auto_link', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s85', "ربط تلقائي بالرسالة الجمركية المفتوحة") },
                  { value: 'manual', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s86', "ترحيل يدوي لحساب المصروفات التمويلية") },
                ]}
                disabled={disabled}
              />
            </div>

            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <ZeroCostIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s87', "السماح بعينات استيرادية مجانية")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s88', "إمكانية استلام عينات تجارية واردة بتكلفة شراء صفر")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowZeroPurchaseCost')} disabled={disabled} />
            </label>

            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <div style={iconBadgeStyle}>
                  <LowStockIndicatorIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s89', "حد التنبيه لنقص المخزون")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s90', "إشعار ببدء إجراءات فتح رسالة استيرادية جديدة عند وصول الرصيد لهذا الحد")}</small>
                </div>
              </div>
              <input
                className="purchase-prototype-field-input"
                type="number"
                min="0"
                {...form.register('lowStockThreshold')}
                disabled={disabled}
                placeholder="5"
                style={{ width: '80px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>
        </FormSection>
      )}

      {/* ===== مخصص للمكاتب والشركات الخدمية (Services Dedicated) ===== */}
      {isServicesVertical && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s91', "ضوابط العقود والخدمات المهنية والاستشارية")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s92', "تحديد نمط فوترة عقود الخدمات وإدارة فترات الاشتراكات والدفعات التعاقدية.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s93', "نمط احتساب وإصدار فواتير الخدمات")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s94', "الأساس المعتمد لفوترة الخدمات المهنية والاستشارية لعملاء الشركة")}</span>
              <CustomSelect
                value={form.watch('servicesBillingMethod') || 'deliverable'}
                onChange={(val) => form.setValue('servicesBillingMethod', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'deliverable', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s95', "حسب تسليم البنود والمراحل (Milestone / Deliverable)") },
                  { value: 'subscription', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s96', "اشتراكات شهرية متكررة (Retainer / Monthly)") },
                  { value: 'hourly', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s97', "حسب ساعات العمل المسجلة (Time & Material)") },
                ]}
                disabled={disabled}
              />
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s98', "فترة الإشعار لتجديد عقود الخدمات")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s99', "أيام الإشعار التلقائي قبل انتهاء مدة العقد أو الاشتراك لطلب التجديد")}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  min="1"
                  max="365"
                  className="purchase-prototype-field-input"
                  {...form.register('servicesContractRenewalNoticeDays')}
                  disabled={disabled}
                  placeholder="30"
                  style={{ ...fieldControlStyle, width: '100px', textAlign: 'center', fontWeight: 800 }}
                />
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s100', "يوم قبل الانتهاء")}</span>
              </div>
            </div>
          </div>
        </FormSection>
      )}

      {/* ===== مخصص للمصانع والإنتاج الصناعي (Manufacturing Dedicated) ===== */}
      {isManufacturingVertical && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s101', "ضوابط التصنيع والإنتاج ومخازن المواد الخام")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s102', "تحديد ضوابط حركة المواد الخام ومكونات الإنتاج وأوامر التشغيل بالمصنع.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
            {/* Card 1: Default Issue Mode for Materials */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s103', "نمط صرف خامات ومكونات الإنتاج الافتراضي")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s104', "آلية خصم الخامات من المخازن عند إصدار إذن تشغيل الإنتاج")}</span>
              <CustomSelect
                value={form.watch('defaultBranchIssueMode') || 'final_issue'}
                onChange={(val) => form.setValue('defaultBranchIssueMode', val as any, { shouldDirty: true, shouldValidate: true })}
                options={[
                  { value: 'final_issue', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s105', "صرف نهائي لأمر التشغيل (يُخصم الرصيد فوراً)") },
                  { value: 'transfer_to_branch_stock', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s106', "تحويل لمستودع تشغيل / خط الإنتاج (قيد الاستخدام)") },
                ]}
                disabled={disabled}
              />
            </div>

            {/* Card 2: Raw Materials Low Stock Threshold */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s107', "حد التنبيه لنقص المواد الخام والمكونات")}</strong>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s108', "إظهار تنبيه نقص المواد الخام في لوحة التحكم عند وصول الرصيد لهذا الحد")}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  min="0"
                  className="purchase-prototype-field-input"
                  {...form.register('lowStockThreshold')}
                  disabled={disabled}
                  placeholder="10"
                  style={{ ...fieldControlStyle, width: '100px', textAlign: 'center', fontWeight: 800 }}
                />
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s109', "وحدة مخزنية")}</span>
              </div>
            </div>

            {/* Card 3: Allow Zero Purchase Cost */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <ZeroCostIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s110', "السماح بسعر شراء صفر لخامات وعينات التشغيل")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s111', "مخصص لخامات التشغيل المهداة، العينات المخبرية، ومخلفات التدوير")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowZeroPurchaseCost')} disabled={disabled} />
            </label>

            {/* Card 4: Allow Negative Stock Sales */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <NegativeStockIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s112', "السماح بصرف الخامات بالسالب")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s113', "تخطي رصيد المخزن لتفادي توقف خطوط الإنتاج قبل وصول أذون الإضافة")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowNegativeStockSales')} disabled={disabled} />
            </label>
          </div>
        </FormSection>
      )}

      {/* ===== خيارات وقواعد البيع والمخزون (للتجارة والتجزئة والأنشطة العامة) ===== */}
      {isRetailCommerce && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s114', "خيارات وقواعد البيع والمخزون")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s115', "ضوابط حركة المخازن والأرصدة وعمليات الكاشير وإصدار أذونات الصرف.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
          {/* Card 1: Negative Stock */}
          {showPhysicalInventory && (
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <NegativeStockIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s116', "السماح بالبيع بالسالب")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s117', "تخطي تحذير عدم كفاية المخزون عند إتمام الفاتورة بالكاشير")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowNegativeStockSales')} disabled={disabled} />
            </label>
          )}

          {/* Card: Hide Out of Stock Items */}
          {showPhysicalInventory && (
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <EyeOffIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.pos_hide_out_of_stock', "إخفاء الأصناف النافذة بالكاشير")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.pos_hide_out_of_stock_desc', "إخفاء المنتجات المنتهية من المخزون تلقائياً من شبكة الكاشير عند حظر البيع بالسالب")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posHideOutOfStockItems')} disabled={disabled} />
            </label>
          )}

          {/* Card 2: Zero Purchase Cost */}
          <label style={premiumCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={iconBadgeStyle}>
                <ZeroCostIcon size={20} />
              </div>
              <div style={premiumCardTextStyle}>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s118', "السماح بسعر شراء صفر")}</strong>
                <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s119', "مخصص للأصناف المهداة، العينات المجانية، والعطايا الترويجية")}</small>
              </div>
            </div>
            <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('allowZeroPurchaseCost')} disabled={disabled} />
          </label>

          {/* Card 3: Require Shift (Only for POS) */}
          {showPosSettings && (
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <CashierShiftLockIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s120', "إجبار فتح وردية لعمليات الكاشير")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s121', "منع البيع قبل فتح الوردية وتحديد العهدة لضبط الخزينة")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('requireCashierShiftForSales')} disabled={disabled} />
            </label>
          )}

          {/* Card 3b: Require Password On Shift Open (Only for POS) */}
          {showPosSettings && (
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <LockIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s120_pwd', "طلب كلمة المرور عند فتح الوردية")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s121_pwd', "التحقق من هوية الكاشير بكلمة المرور قبل بدء الوردية وفتح الصندوق")}</small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('requirePasswordOnShiftOpen')} disabled={disabled} />
            </label>
          )}

          {/* Card 4: Low Stock Alert */}
          {showPhysicalInventory && (
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <LowStockIndicatorIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s122', "حد التنبيه لنقص المخزون")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s123', "يظهر تنبيه نواقص عندما يصل الرصيد لهذا الحد أو أقل")}</small>
                </div>
              </div>
              <input
                className="purchase-prototype-field-input"
                type="number"
                min="0"
                {...form.register('lowStockThreshold')}
                disabled={disabled}
                placeholder="5"
                style={{ width: '80px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          )}

          {/* Card 4.5: Max Cashier Discount Approval Threshold & Manager PIN (Only for POS) */}
          {showPosSettings && (
            <div style={{ gridColumn: '1 / -1', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={iconBadgeStyle}>
                    <CashierShiftLockIcon size={20} />
                  </div>
                  <div>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s124', "سقف خصم الكاشير واعتماد المدير (PIN)")}</strong>
                    <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s125', "اشتراط إدخال PIN المدير عند إعطاء الكاشير خصماً يتجاوز حداً معيناً أو لتعديل العمليات الحساسة")}</span>
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: form.watch('posMaxDiscountThresholdEnabled') ? '#166534' : '#64748b' }}>
                    {form.watch('posMaxDiscountThresholdEnabled') ? __t('settings.forms.tabs.sales_inventory_settings_tab.s126', "سقف الخصم: مفعّل") : __t('settings.forms.tabs.sales_inventory_settings_tab.s127', "سقف الخصم: معطل")}
                  </span>
                  <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posMaxDiscountThresholdEnabled')} disabled={disabled} />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s128', "الرمز السري للمدير (PIN)")}
                  </label>
                  {settings?.hasManagerPin && !isChangingPin ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', minHeight: '38px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#166534' }}>
                          {__t('settings.forms.tabs.sales_inventory_settings_tab.s129', "تم حفظ وتفعيل رمز سري للمدير")}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsChangingPin(true);
                          form.setValue('managerPin', '', { shouldDirty: true });
                        }}
                        disabled={disabled}
                        style={{
                          padding: '3px 10px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          color: '#170c5c',
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '5px',
                          cursor: 'pointer',
                        }}
                      >
                        {__t('settings.forms.tabs.sales_inventory_settings_tab.s130', "تغيير الرمز")}
                      </button>
                    </div>
                  ) : !settings?.hasManagerPin && !isChangingPin ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', minHeight: '38px' }}>
                      <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {__t('settings.forms.tabs.sales_inventory_settings_tab.s131', "لم يتم تعيين رمز سري بعد (اختياري)")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsChangingPin(true);
                          form.setValue('managerPin', '', { shouldDirty: true });
                        }}
                        disabled={disabled}
                        style={{
                          padding: '3px 10px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          color: '#170c5c',
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '5px',
                          cursor: 'pointer',
                        }}
                      >
                        {__t('settings.forms.tabs.sales_inventory_settings_tab.s132', "تعيين رمز PIN")}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="password"
                          inputMode="numeric"
                          autoComplete="new-password"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          maxLength={10}
                          className="purchase-prototype-field-input"
                          {...form.register('managerPin')}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                            form.setValue('managerPin', digits, { shouldValidate: true, shouldDirty: true });
                          }}
                          disabled={disabled}
                          placeholder={__t('settings.forms.tabs.sales_inventory_settings_tab.s133', "أدخل الرمز الجديد (4 - 10 أرقام)")}
                          style={fieldControlStyle}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setIsChangingPin(false);
                            form.setValue('managerPin', '', { shouldDirty: false });
                            form.clearErrors('managerPin');
                          }}
                          style={{
                            padding: '7px 12px',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            color: '#64748b',
                            background: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {__t('settings.forms.tabs.sales_inventory_settings_tab.s134', "إلغاء")}
                        </button>
                      </div>
                      <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                        {__t('settings.forms.tabs.sales_inventory_settings_tab.s135', "الرمز السري المطلوب لاعتماد العمليات الحساسة وتجاوز سقف الخصم بالكاشير.")}
                      </small>
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s142', "الخصم الصغير المسموح لأي كاشير بدون اعتماد")} {`(${getGlobalCurrencySymbol()})`}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="purchase-prototype-field-input"
                    {...form.register('posSmallDiscountFlatAllowance')}
                    disabled={disabled}
                    placeholder={__t('settings.forms.tabs.sales_inventory_settings_tab.s143', "مثال: 2")}
                    style={fieldControlStyle}
                  />
                  <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s144', "أي كاشير، حتى بدون صلاحية خصم، يقدر يخصم لحد المبلغ ده من غير رمز مدير (تقريب الفكة، مثال: 232 تبقى 230).")}
                  </small>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s145', "حد المرتجع النقدي الكبير الذي يتطلب اعتماد المدير")} {`(${getGlobalCurrencySymbol()})`}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className="purchase-prototype-field-input"
                    {...form.register('posLargeCashRefundThreshold')}
                    disabled={disabled}
                    placeholder={__t('settings.forms.tabs.sales_inventory_settings_tab.s146', "مثال: 500")}
                    style={fieldControlStyle}
                  />
                  <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s147', "المرتجع النقدي الأصغر من المبلغ ده يتم من غير رمز مدير؛ الأكبر أو المساوي له يتطلب رمز اعتماد المدير أو كلمة مرور المدير.")}
                  </small>
                </div>

                {form.watch('posMaxDiscountThresholdEnabled') && (
                  <>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        {__t('settings.forms.tabs.sales_inventory_settings_tab.s136', "طريقة حساب سقف الخصم")}
                      </label>
                      <CustomSelect
                        value={form.watch('posMaxDiscountThresholdType') || 'percentage'}
                        onChange={(val) => form.setValue('posMaxDiscountThresholdType', val as any, { shouldDirty: true, shouldValidate: true })}
                        options={[
                          { value: 'percentage', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s137', "نسبة مئوية من إجمالي الفاتورة (%)") },
                          { value: 'fixed', label: `مبلغ ثابت بالعملة (${getGlobalCurrencySymbol()})` },
                        ]}
                        disabled={disabled}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                        {__t('settings.forms.tabs.sales_inventory_settings_tab.s138', "قيمة سقف الخصم المسموح به")} {form.watch('posMaxDiscountThresholdType') === 'fixed' ? `(${getGlobalCurrencySymbol()})` : '(%)'}
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        className="purchase-prototype-field-input"
                        {...form.register('posMaxDiscountThresholdValue')}
                        disabled={disabled}
                        placeholder={form.watch('posMaxDiscountThresholdType') === 'fixed' ? __t('settings.forms.tabs.sales_inventory_settings_tab.s139', "مثال: 50") : __t('settings.forms.tabs.sales_inventory_settings_tab.s140', "مثال: 15")}
                        style={fieldControlStyle}
                      />
                      <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                        {__t('settings.forms.tabs.sales_inventory_settings_tab.s141', "عند تطبيق خصم أعلى من هذا الحد بالكاشير، لن تكتمل الفاتورة إلا بإدخال رمز مرور المدير (PIN).")}
                      </small>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Card 5: Default Branch Issue Mode (Span 2) */}
          {showPhysicalInventory && (
            <div style={{ gridColumn: '1 / -1', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={iconBadgeStyle}>
                  <IssueModeDocIcon size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s142', "وضع إذن الصرف الافتراضي")}</strong>
                    <div style={{ minWidth: '280px' }}>
                      <CustomSelect
                        value={form.watch('defaultBranchIssueMode') || 'final_issue'}
                        onChange={(val) => form.setValue('defaultBranchIssueMode', val as any, { shouldDirty: true, shouldValidate: true })}
                        options={[
                          { value: 'final_issue', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s143', "صرف نهائي (يتم خصم الرصيد فوراً)") },
                          { value: 'transfer_to_branch_stock', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s144', "تحويل إلى رصيد فرع (يبقى بانتظار الاستلام)") },
                        ]}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                  <span style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s145', "استخدم")} <strong>{__t('settings.forms.tabs.sales_inventory_settings_tab.s146', "الصرف النهائي")}</strong> {__t('settings.forms.tabs.sales_inventory_settings_tab.s147', "إذا كان الفرع لا يدار مخزونه على النظام، أو")} <strong>{__t('settings.forms.tabs.sales_inventory_settings_tab.s148', "تحويل إلى رصيد فرع")}</strong> {__t('settings.forms.tabs.sales_inventory_settings_tab.s149', "إذا كان الفرع يبيع من رصيده على النظام.")}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Delivery Handling Cards (Only for POS / Retail / Fleets) */}
          {showPosSettings && (
            <>
              {/* Card 6: Delivery Fee Mode */}
              <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <DeliveryModeIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s150', "معالجة رسوم التوصيل")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {isStoreFleet ? __t('settings.forms.tabs.sales_inventory_settings_tab.s151', "أسطول المتجر (إيراد للمحل وتُطبق عمولة الطيار)") : __t('settings.forms.tabs.sales_inventory_settings_tab.s152', "مناديب حرة / طياري (100% للمندوب ولا تدخل الخزينة)")}
                    </small>
                  </div>
                </div>
                <div style={{ width: isStoreFleet ? '170px' : '200px' }}>
                  <CustomSelect
                    value={form.watch('deliveryFeeMode') || 'freelance_courier'}
                    onChange={(val) => form.setValue('deliveryFeeMode', val as any, { shouldDirty: true, shouldValidate: true })}
                    options={[
                      { value: 'freelance_courier', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s153', "مناديب حرة (طياري)") },
                      { value: 'store_fleet', label: __t('settings.forms.tabs.sales_inventory_settings_tab.s154', "أسطول المتجر (داخلي)") },
                    ]}
                    disabled={disabled}
                  />
                </div>
              </div>

              {/* Card 7: Default Delivery Fee */}
              <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <DefaultDeliveryFeeIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s155', "رسوم التوصيل الافتراضية")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {__t('settings.forms.tabs.sales_inventory_settings_tab.s156', "تُملأ تلقائياً عند اختيار دليفري وقابلة للتعديل بالكاشير")}
                    </small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    className="purchase-prototype-field-input"
                    type="number"
                    min="0"
                    step="1"
                    {...form.register('defaultDeliveryFee')}
                    disabled={disabled}
                    placeholder="0"
                    style={{ width: '85px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#64748b' }}><CurrencySymbol /></span>
                </div>
              </div>

              {/* Card 8: Store Fleet Courier Commission Rate (Only visible when store fleet is active) */}
              {isStoreFleet && (
                <div style={{ ...premiumCardStyle, cursor: 'default', gridColumn: '1 / -1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                    <div style={iconBadgeStyle}>
                      <CourierCommissionIcon size={20} />
                    </div>
                    <div style={premiumCardTextStyle}>
                      <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s157', "نسبة الطيار من التوصيل")}</strong>
                      <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s158', "عمولة طياري الأسطول (0% للثابت)")}</small>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      className="purchase-prototype-field-input"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      {...form.register('storeFleetCommissionRate')}
                      disabled={disabled}
                      placeholder="0"
                      style={{ width: '70px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    />
                    <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#334155' }}>%</span>
                  </div>
                </div>
              )}

              {/* Card 8.5: Van Sales Settlement Supervisor PIN Requirement */}
              <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <CheckShieldIcon size={20} color="#170e5e" />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s159', "إلزامية رمز المشرف (PIN) لتصفية رحلات المناديب")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {form.watch('vanSettlementRequireSupervisorPin')
                        ? __t('settings.forms.tabs.sales_inventory_settings_tab.s160', "مفعل: يلزم إدخال رمز المشرف (PIN) على هاتف المندوب لإتمام التصفية وإبراء العهدة")
                        : __t('settings.forms.tabs.sales_inventory_settings_tab.s161', "معطل: يقفل المندوب ورديته مباشرة وتعتمد التصفية ويستلم الكاش من لوحة الإدارة")}
                    </small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    id="vanSettlementRequireSupervisorPin"
                    {...form.register('vanSettlementRequireSupervisorPin')}
                    disabled={disabled}
                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#170e5e' }}
                  />
                </div>
              </div>

              {/* Card 8.6: Van Sales Blind Settlement (الجرد والتوريد العمياني) */}
              <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <LockIcon size={20} color="#170e5e" />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s162', "إلزام التوريد العمياني لكاش المناديب (Blind Settlement)")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {form.watch('vanSettlementBlindMode')
                        ? __t('settings.forms.tabs.sales_inventory_settings_tab.s163', "مفعل: إخفاء صافي النقدية المتوقعة وزر المطابقة؛ يُجبر المندوب على عد الكاش الفعلي واحتساب الفروقات رقابياً")
                        : __t('settings.forms.tabs.sales_inventory_settings_tab.s164', "معطل: يظهر صافي النقدية المتوقعة وزر المطابقة أمام المندوب بشفافية لتسريع التصفية")}
                    </small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    id="vanSettlementBlindMode"
                    {...form.register('vanSettlementBlindMode')}
                    disabled={disabled}
                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#170e5e' }}
                  />
                </div>
              </div>

              {/* Card 9: Restaurant Tables Count (Only for Restaurants & Cafes) */}
              {isRestaurantVertical && (
                <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                    <div style={iconBadgeStyle}>
                      <RestaurantTablesIcon size={20} />
                    </div>
                    <div style={premiumCardTextStyle}>
                      <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s165', "عدد طاولات الصالة")}</strong>
                      <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {__t('settings.forms.tabs.sales_inventory_settings_tab.s166', "العدد الافتراضي للطاولات المعروضة في خريطة الصالة والمطاعم")}
                      </small>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      className="purchase-prototype-field-input"
                      type="number"
                      min="1"
                      max="200"
                      step="1"
                      {...form.register('restaurantTablesCount')}
                      disabled={disabled}
                      placeholder="24"
                      style={{ width: '85px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                    />
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s167', "طاولة")}</span>
                  </div>
                </div>
              )}

              {/* Card 10: Restaurant Service Charge (Only for Restaurants & Cafes) */}
              {isRestaurantVertical && (
                <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                    <div style={iconBadgeStyle}>
                      <RestaurantServiceChargeIcon size={20} />
                    </div>
                    <div style={premiumCardTextStyle}>
                      <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s168', "رسوم خدمة الصالة التلقائية (Service Charge)")}</strong>
                      <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {__t('settings.forms.tabs.sales_inventory_settings_tab.s169', "إضافة نسبة مئوية لخدمة الصالة تلقائياً عند اختيار طلب صالة (Dine-in)")}
                      </small>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={__t('settings.forms.tabs.sales_inventory_settings_tab.s170', "تفعيل رسوم خدمة الصالة")}
                      {...form.register('restaurantServiceChargeEnabled')}
                      disabled={disabled}
                      style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        className="purchase-prototype-field-input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        {...form.register('restaurantServiceChargePercent')}
                        disabled={disabled || !form.watch('restaurantServiceChargeEnabled')}
                        placeholder="12"
                        style={{ width: '70px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      />
                      <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#64748b' }}>%</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Card 11: Guest Pagers (Only for Restaurants & Cafes) */}
              {isRestaurantVertical && (
                <div style={{ ...premiumCardStyle, cursor: 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                    <div style={iconBadgeStyle}>
                      <ClockIcon size={20} />
                    </div>
                    <div style={premiumCardTextStyle}>
                      <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s171', "أجهزة بيجر المناداة للزبائن (Guest Pagers)")}</strong>
                      <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                        {__t('settings.forms.tabs.sales_inventory_settings_tab.s172', "إظهار خانة إدخال رقم البيجر في شاشة الكاشير لتسليم أجهزة النداء للزبائن في مطاعم الخدمة الذاتية (مفعل تلقائياً للكويت والسعودية)")}
                      </small>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={__t('settings.forms.tabs.sales_inventory_settings_tab.s173', "تفعيل أجهزة بيجر المناداة")}
                      {...form.register('enableGuestPagers')}
                      disabled={disabled}
                      style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </FormSection>
      )}

      {/* ===== تخصيص واجهة الكاشير والشاشات المتنقلة ===== */}
      {showPosSettings && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.pos_customization_section_title', "تخصيص واجهة الكاشير والشاشات المتنقلة")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.pos_customization_section_desc', "التحكم في إظهار أو إخفاء عناصر واجهة الكاشير (شريط البحث، مبدل السعر، شريط الأقسام، الفلاتر السريعة) وتخصيص نمط وشبكة العرض لأجهزة الكاشير المحمولة والموبايل.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            {/* Card 1: Default POS Product Card Layout */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_card_layout_title', "النمط الافتراضي لكروت المنتجات بالكاشير")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.4 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_card_layout_desc', "اختيار شكل عرض كروت الأصناف في نقطة البيع (موسعة / معرض صور / مضغوطة)")}
                  </small>
                </div>
              </div>
              <div style={{ width: '210px', minWidth: '180px', flexShrink: 0 }}>
                <CustomSelect
                  value={form.watch('posProductCardLayout') || 'comfortable'}
                  onChange={(val) => form.setValue('posProductCardLayout', val as any, { shouldDirty: true, shouldValidate: true })}
                  options={[
                    { value: 'comfortable', label: __t('settings.forms.tabs.sales_inventory_settings_tab.pos_layout_comfortable', "كروت موسعة (افتراضي)") },
                    { value: 'gallery', label: __t('settings.forms.tabs.sales_inventory_settings_tab.pos_layout_gallery', "معرض صور فوتوغرافية") },
                    { value: 'compact', label: __t('settings.forms.tabs.sales_inventory_settings_tab.pos_layout_compact', "كروت مضغوطة مدمجة") },
                  ]}
                  disabled={disabled}
                />
              </div>
            </div>

            {/* Card 2: POS Show Search Bar */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_search_bar_title', "إظهار شريط البحث في شاشة الكاشير")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_search_bar_desc', "يمكن إخفاؤه لتوفير أكبر مساحة لعرض المنتجات في نقاط البيع المعتمدة على اللمس والباركود")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posShowSearchBar')} disabled={disabled} />
            </label>

            {/* Card 3: POS Show Price Tier Toggle */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_price_toggle_title', "إظهار مبدل السعر (قطاعي / جملة)")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_price_toggle_desc', "إتاحة التبديل السريع بين سعر التجزئة والجملة، أو إخفاؤه للالتزام بنوع السعر الافتراضي")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posShowPriceTierToggle')} disabled={disabled} />
            </label>

            {/* Card 4: POS Default Price Type */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_default_price_type_title', "سعر البيع الافتراضي بنقطة البيع")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.4 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_default_price_type_desc', "تحديد السعر المعتمد تلقائياً (قطاعي أو جملة) حتى في حال إخفاء زر التبديل")}
                  </small>
                </div>
              </div>
              <div style={{ width: '210px', minWidth: '180px', flexShrink: 0 }}>
                <CustomSelect
                  value={form.watch('posDefaultPriceType') || 'retail'}
                  onChange={(val) => form.setValue('posDefaultPriceType', val as any, { shouldDirty: true, shouldValidate: true })}
                  options={[
                    { value: 'retail', label: __t('settings.forms.tabs.sales_inventory_settings_tab.pos_price_retail', "سعر التجزئة / قطاعي (افتراضي)") },
                    { value: 'wholesale', label: __t('settings.forms.tabs.sales_inventory_settings_tab.pos_price_wholesale', "سعر الجملة") },
                  ]}
                  disabled={disabled}
                />
              </div>
            </div>

            {/* Card 5: POS Show Categories */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_categories_title', "إظهار شريط الأقسام والتصنيفات")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_categories_desc', "إظهار كبسولات التصنيفات الأفقية أعلى المنتجات أو إخفاؤها لتوسيع مساحة العرض")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posShowCategories')} disabled={disabled} />
            </label>

            {/* Card 6: POS Show Quick Filters */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_quick_filters_title', "إظهار شريط الفلاتر السريعة (المفضلة / العروض)")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_show_quick_filters_desc', "أزرار فلترة الأصناف حسب المفضلة، العروض الخاصة، والخدمات")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posShowQuickFilters')} disabled={disabled} />
            </label>

            {/* Card 7: POS Mobile Grid Columns */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_mobile_cols_title', "عدد أعمدة الأصناف في شاشات الموبايل والمتنقلة")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b', lineHeight: 1.4 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_mobile_cols_desc', "تخصيص شبكة العرض لأجهزة الكاشير المحمولة (iMin / Sunmi): 3 أعمدة لعرض عدد أكبر من الأصناف")}
                  </small>
                </div>
              </div>
              <div style={{ width: '210px', minWidth: '180px', flexShrink: 0 }}>
                <CustomSelect
                  value={form.watch('posMobileGridColumns') || 'auto'}
                  onChange={(val) => form.setValue('posMobileGridColumns', val as any, { shouldDirty: true, shouldValidate: true })}
                  options={[
                    { value: 'auto', label: __t('settings.forms.tabs.sales_inventory_settings_tab.pos_cols_auto', "تلقائي بحسب الشاشة") },
                    { value: '2', label: __t('settings.forms.tabs.sales_inventory_settings_tab.pos_cols_2', "عمودين (افتراضي)") },
                    { value: '3', label: __t('settings.forms.tabs.sales_inventory_settings_tab.pos_cols_3', "3 أعمدة (أجهزة كاشير محمولة iMin/Sunmi)") },
                  ]}
                  disabled={disabled}
                />
              </div>
            </div>

            {/* Card 8: POS Auto-Hide Bottom Nav */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <div style={iconBadgeStyle}>
                  <SlidersIcon size={20} />
                </div>
                <div style={{ ...premiumCardTextStyle, minWidth: 0, flex: 1 }}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_auto_hide_nav_title', "الإخفاء التلقائي للشريط السفلي في شاشات الموبايل")}
                  </strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.pos_auto_hide_nav_desc', "إخفاء شريط التنقل الرئيسي عند التمرير أو عند إضافة أصناف للسلة لمنح أقصى مساحة عرض للمنتجات")}
                  </small>
                </div>
              </div>
              <input type="checkbox" style={premiumCheckboxInputStyle} {...form.register('posAutoHideBottomNav')} disabled={disabled} />
            </label>
          </div>
        </FormSection>
      )}

      {/* ===== منظومة المدفوعات والـ QR الذكي (Z-Pay Smart Payment Hub) ===== */}
      {showPosSettings && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s174', "منظومة المدفوعات والـ QR الذكي (Z-Pay Smart Payment Hub)")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s175', "إعدادات استقبال المدفوعات الفورية عبر إنستاباي (InstaPay Dynamic QR) والمحافظ الإلكترونية (فودافون كاش وميزة) وروابط البطاقات مباشرة على ماكينات Sunmi وشاشات الكاشير.")}
        >
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s176', "عنوان أو رقم إنستاباي للمحل (InstaPay IPA / Phone)")}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  {...form.register('instapayAddress')}
                  disabled={disabled}
                  placeholder={__t('settings.forms.tabs.sales_inventory_settings_tab.s177', "01018017523 أو username@instapay")}
                  style={{
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    width: '100%',
                    boxSizing: 'border-box',
                    textAlign: 'left',
                  }}
                />
                <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s178', "الرقم أو الحساب الذي يستقبل تحويلات إنستاباي اللحظية عند اختيار دفع InstaPay في الكاشير.")}
                </small>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s179', "رقم المحفظة الإلكترونية (Mobile Wallet Number)")}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  {...form.register('walletNumber')}
                  disabled={disabled}
                  placeholder="01018017523"
                  style={{
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    width: '100%',
                    boxSizing: 'border-box',
                    textAlign: 'left',
                  }}
                />
                <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s180', "رقم المحفظة (فودافون كاش، أورنج، اتصالات، وي، سمارت والت) لاستقبال تحويلات المحافظ.")}
                </small>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s181', "اسم مزود خدمة المحفظة الافتراضي")}
                </label>
                <input
                  type="text"
                  {...form.register('walletProviderName')}
                  disabled={disabled}
                  placeholder={__t('settings.forms.tabs.sales_inventory_settings_tab.s182', "فودافون كاش")}
                  style={{
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                />
                <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s183', "الاسم التوضيحي الذي يظهر للكاشير والعميل (مثال: فودافون كاش، محفظة البنك الأهلي).")}
                </small>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', display: 'block', marginBottom: '4px' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s184', "رابط بوابة الدفع الإلكتروني للبطاقات (Payment Link URL - اختياري)")}
                </label>
                <input
                  type="url"
                  dir="ltr"
                  {...form.register('paymentLinkBaseUrl')}
                  disabled={disabled}
                  placeholder="https://accept.paymob.com/..."
                  style={{
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.82rem',
                    width: '100%',
                    boxSizing: 'border-box',
                    textAlign: 'left',
                  }}
                />
                <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s185', "لتوليد كود مسح ودفع بالفيزا والماستركارد وأبل باي أونلاين للعملاء عبر هواتفهم.")}
                </small>
              </div>
            </div>

            {/* Checkboxes Row */}
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                <input
                  type="checkbox"
                  style={premiumCheckboxInputStyle}
                  {...form.register('enableDynamicPaymentQr')}
                  disabled={disabled}
                />
                <div>
                  <strong style={{ fontSize: '0.82rem', color: '#0f172a', fontWeight: 700, display: 'block' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s186', "تفعيل عرض كود الـ QR الديناميكي للدفع فورياً على شاشة ماكينة Sunmi ونقاط البيع")}
                  </strong>
                  <small style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s187', "عرض رمز الـ QR بالمبلغ الصافي ورقم المحفظة فورياً للكاشير والعميل لمسحه بالهاتف.")}
                  </small>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                <input
                  type="checkbox"
                  style={premiumCheckboxInputStyle}
                  {...form.register('printPaymentQrOnReceipt')}
                  disabled={disabled}
                />
                <div>
                  <strong style={{ fontSize: '0.82rem', color: '#0f172a', fontWeight: 700, display: 'block' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s188', "طباعة رمز الـ QR تلقائياً على بون الفاتورة الحرارية (اختياري)")}
                  </strong>
                  <small style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s189', "إدراج كود الدفع السريع أسفل الفاتورة لتمكين العميل من مسح البون المطبوع والدفع لاحقاً.")}
                  </small>
                </div>
              </label>

              {/* Tax E-Receipt Toggle (Strictly Optional & Disabled by default) */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 14px', marginTop: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <strong style={{ fontSize: '0.82rem', color: '#334155', fontWeight: 700, display: 'block' }}>
                      {__t('settings.forms.tabs.sales_inventory_settings_tab.s190', "منظومة الإيصال الإلكتروني لمصلحة الضرائب المصرية (ETA E-Receipt)")}
                    </strong>
                    <small style={{ fontSize: '0.74rem', color: '#64748b' }}>
                      {__t('settings.forms.tabs.sales_inventory_settings_tab.s191', "خيار اختياري تماماً للمنشآت الملزمة فقط. يبقى معطلاً للمحلات والأنشطة العادية دون أي قيود ضريبية.")}
                    </small>
                  </div>
                  <select
                    {...form.register('taxComplianceMode')}
                    disabled={disabled}
                    style={{
                      height: '34px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      padding: '0 10px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      background: '#ffffff',
                      color: '#0f172a',
                    }}
                  >
                    <option value="disabled">{__t('settings.forms.tabs.sales_inventory_settings_tab.s192', "معطل (الافتراضي - بدون أي ربط ضريبي)")}</option>
                    <option value="optional_eta">{__t('settings.forms.tabs.sales_inventory_settings_tab.s193', "تفعيل تجريبي اختياري لمنظومة مصلحة الضرائب")}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </FormSection>
      )}

      {/* ===== ماكينات نقاط البيع والدفع البنكي الذكية (Smart POS Terminals) ===== */}
      {showPosSettings && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s194', "ماكينات نقاط البيع والدفع البنكي الذكية (Smart POS Terminals)")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s195', "الربط الشبكي المباشر مع ماكينات الدفع الإلكتروني البنكية (Geidea, Fawry / PAX, Paymob, Network International) لتمرير مبالغ الفواتير آلياً وقراءة نجاح السحب دون إدخال يدوي. يمكنك ربط عدة ماكينات دفع في نفس الوقت وتعيين الماكينة الافتراضية للكاشير.")}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Top Control Bar: Master Toggle + Add Button + Terminal Count */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '14px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
              }}
            >
              {/* Row 1: Master Toggle on Right, Actions & Count on Left */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                {/* Master Toggle */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <div style={iconBadgeStyle}>
                    <PosTerminalIcon size={20} />
                  </div>
                  <div>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800, display: 'block' }}>
                      {__t('settings.forms.tabs.sales_inventory_settings_tab.s196', "تفعيل خدمة ربط ماكينات الدفع الإلكتروني (POS Terminals)")}
                    </strong>
                    <small style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {__t('settings.forms.tabs.sales_inventory_settings_tab.s197', "إظهار خيار إرسال المبالغ لماكينة البنك آلياً في شاشة الكاشير عند الدفع بالبطاقة")}
                    </small>
                  </div>
                  <input
                    type="checkbox"
                    style={{ ...premiumCheckboxInputStyle, marginRight: '12px' }}
                    checked={isMasterPosTerminalEnabled}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setIsMasterPosTerminalEnabled(val);
                      form.setValue('posTerminalEnabled', val, { shouldDirty: true });
                    }}
                    disabled={disabled}
                  />
                </label>

                {/* Actions & Count */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span
                    style={{
                      fontSize: '0.76rem',
                      fontWeight: 700,
                      color: '#334155',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      padding: '4px 10px',
                      borderRadius: '8px',
                    }}
                  >
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s198', "إجمالي الماكينات:")} {terminalsList.length}
                  </span>

                  <button
                    type="button"
                    disabled={disabled || !isMasterPosTerminalEnabled}
                    onClick={handleAddTerminal}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      height: '36px',
                      padding: '0 14px',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      background: '#170e5e',
                      color: '#ffffff',
                      border: 'none',
                      cursor: (disabled || !isMasterPosTerminalEnabled) ? 'not-allowed' : 'pointer',
                      opacity: (disabled || !isMasterPosTerminalEnabled) ? 0.6 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <PlusCircleIcon size={16} />
                    <span>{__t('settings.forms.tabs.sales_inventory_settings_tab.s199', "إضافة ماكينة دفع إضافية")}</span>
                  </button>
                </div>
              </div>

              {/* Row 2: Zero-Click Checkout Auto Finalize */}
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: disabled || !isMasterPosTerminalEnabled ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="checkbox"
                    {...form.register('posTerminalAutoFinalize')}
                    disabled={disabled || !isMasterPosTerminalEnabled}
                  />
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b' }}>
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s200', "إتمام وطباعة الفاتورة تلقائياً بمجرد موافقة ماكينة الدفع (Zero-Click Checkout)")}
                  </span>
                </label>
                <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px', display: 'block', paddingRight: '22px' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s201', "يغلق الفاتورة ويطبع إيصال مدى / كي نت آلياً فور اعتماد العميل لسحب البطاقة دون أي نقرات إضافية.")}
                </span>
              </div>
            </div>

            {/* Quick Helper Banner */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '10px 14px',
                fontSize: '0.74rem',
                color: '#475569',
                lineHeight: 1.6,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              <InfoIcon size={16} color="#170e5e" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ color: '#1e293b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s202', "إرشادات الربط مع الماكينات (ECR / LAN Direct):")}</strong>
                <span style={{ display: 'block', marginTop: '2px' }}>
                  • <strong>{__t('settings.forms.tabs.sales_inventory_settings_tab.s203', "جيديا (Geidea):")}</strong> {__t('settings.forms.tabs.sales_inventory_settings_tab.s204', "ادخل على إعدادات الماكينة أو تطبيق نقطة البيع > تفعيل ECR / LAN > المنفذ الافتراضي غالبًا")} <strong>8080</strong> {__t('settings.forms.tabs.sales_inventory_settings_tab.s205', "أو")} <strong>8081</strong>.
                </span>
                <span style={{ display: 'block' }}>
                  • <strong>{__t('settings.forms.tabs.sales_inventory_settings_tab.s206', "باكس وفوري (PAX A960 / Fawry):")}</strong> {__t('settings.forms.tabs.sales_inventory_settings_tab.s207', "افتح تطبيق الكاشير أو تطبيق ECR على الماكينة (أو MaxStore) لتفعيل استقبال مبالغ الكاشير > المنفذ الافتراضي")} <strong>8080</strong> {__t('settings.forms.tabs.sales_inventory_settings_tab.s208', "أو")} <strong>10009</strong>.
                </span>
                <span style={{ display: 'block' }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s209', "• تأكد من اتصال جهاز الكمبيوتر وماكينة الدفع بنفس شبكة الـ Wi-Fi / الراوتر المحلي، ثم اضغط")} <strong>{__t('settings.forms.tabs.sales_inventory_settings_tab.s210', "«فحص الاتصال الفعلي»")}</strong> {__t('settings.forms.tabs.sales_inventory_settings_tab.s211', "للتأكد من وصول البينج واستجابة المنفذ.")}
                </span>
              </div>
            </div>

            {/* Terminals Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: terminalsList.length > 1 ? 'repeat(auto-fit, minmax(360px, 1fr))' : '1fr',
                gap: '14px',
              }}
            >
              {terminalsList.map((term, index) => (
                <PosTerminalCard
                  key={term.id}
                  terminal={term}
                  index={index}
                  totalCount={terminalsList.length}
                  disabled={disabled}
                  isMasterEnabled={isMasterPosTerminalEnabled}
                  onUpdate={handleUpdateTerminal}
                  onRemove={handleRemoveTerminal}
                  onSetDefault={handleSetDefaultTerminal}
                  onTest={handleTestTerminalDevice}
                  isTesting={testingTerminalId === term.id}
                  testResult={terminalTestResults[term.id]}
                />
              ))}
            </div>
          </div>
        </FormSection>
      )}

      {/* ===== برنامج نقاط وولاء العملاء ===== */}
      {showPosSettings && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s212', "برنامج نقاط ومكافآت ولاء العملاء (Customer Loyalty Program)")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s213', "تحفيز العملاء على الشراء المتكرر عبر منحهم نقاطاً مع كل فاتورة، وإمكانية استبدالها برصيد وخصم فوري في الفواتير التالية.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            {/* 1. Toggle Loyalty */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <LoyaltyPointsIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s214', "تفعيل برنامج نقاط الولاء")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s215', "احتساب نقاط تلقائياً للعميل عند البيع وإتاحة استبدالها في الكاشير")}</small>
                </div>
              </div>
              <input
                type="checkbox"
                style={premiumCheckboxInputStyle}
                {...form.register('loyaltyEnabled')}
                disabled={disabled}
              />
            </label>

            {/* 2. Print on Receipt */}
            <label style={premiumCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <IssueModeDocIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s216', "إظهار رصيد النقاط في الفاتورة")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s217', "طباعة النقاط المكتسبة والرصيد الإجمالي في الإيصالات الحرارية وفواتير A4")}</small>
                </div>
              </div>
              <input
                type="checkbox"
                style={premiumCheckboxInputStyle}
                {...form.register('printShowLoyaltyPoints')}
                disabled={disabled}
              />
            </label>

            {/* 3. Earning Rate */}
            <div style={{ ...premiumCardStyle, cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <LoyaltyPointsIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s218', "معدل اكتساب النقاط")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s219', "عدد النقاط المكتسبة لكل 100 جنيه مشتريات مسددة:")}</small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    className="purchase-prototype-field-input"
                    type="number"
                    min="0"
                    step="1"
                    {...form.register('loyaltyPointsPer100Egp')}
                    disabled={disabled || !form.watch('loyaltyEnabled')}
                    placeholder="10"
                    style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s220', "نقطة")}</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s221', "5 نقاط"), val: 5 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s222', "10 نقاط"), val: 10 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s223', "20 نقطة"), val: 20 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s224', "50 نقطة"), val: 50 },
                ].map((p) => {
                  const currentVal = Number(form.watch('loyaltyPointsPer100Egp') ?? 10);
                  const isSelected = currentVal === p.val;
                  return (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => form.setValue('loyaltyPointsPer100Egp', p.val, { shouldDirty: true, shouldValidate: true })}
                      disabled={disabled || !form.watch('loyaltyEnabled')}
                      style={{
                        padding: '4px 2px',
                        fontSize: '0.71rem',
                        textAlign: 'center',
                        borderRadius: '6px',
                        border: isSelected ? '1px solid #170e5e' : '1px solid #e2e8f0',
                        background: isSelected ? '#eef2ff' : '#f8fafc',
                        color: isSelected ? '#170e5e' : '#475569',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Redemption Value */}
            <div style={{ ...premiumCardStyle, cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <ZeroCostIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s225', "قيمة النقطة عند الاستبدال")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s226', "القيمة المالية للنقطة الواحدة كخصم بالجنيه:")}</small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    className="purchase-prototype-field-input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    {...form.register('loyaltyPointRedeemValue')}
                    disabled={disabled || !form.watch('loyaltyEnabled')}
                    placeholder="0.10"
                    style={{ width: '85px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}><CurrencySymbol /></span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s227', "0.05 ج (5 قروش)"), val: 0.05 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s228', "0.10 ج (10 قروش)"), val: 0.1 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s229', "0.50 ج (نصف جنيه)"), val: 0.5 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s230', "1.00 ج (جنيه كامل)"), val: 1 },
                ].map((p) => {
                  const currentVal = Number(form.watch('loyaltyPointRedeemValue') ?? 0.1);
                  const isSelected = Math.abs(currentVal - p.val) < 0.001;
                  return (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => form.setValue('loyaltyPointRedeemValue', p.val, { shouldDirty: true, shouldValidate: true })}
                      disabled={disabled || !form.watch('loyaltyEnabled')}
                      style={{
                        padding: '4px 2px',
                        fontSize: '0.71rem',
                        textAlign: 'center',
                        borderRadius: '6px',
                        border: isSelected ? '1px solid #170e5e' : '1px solid #e2e8f0',
                        background: isSelected ? '#eef2ff' : '#f8fafc',
                        color: isSelected ? '#170e5e' : '#475569',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 5. Minimum Redeem Points */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <LoyaltyPointsIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s231', "الحد الأدنى للنقاط للاستبدال")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s232', "أقل رصيد نقاط يجب أن يمتلكه العميل ليتمكن من الخصم")}</small>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  className="purchase-prototype-field-input"
                  type="number"
                  min="0"
                  step="1"
                  {...form.register('loyaltyMinRedeemPoints')}
                  disabled={disabled || !form.watch('loyaltyEnabled')}
                  placeholder="50"
                  style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s233', "نقطة")}</span>
              </div>
            </div>

            {/* 6. Max Discount Percentage */}
            <div style={{ ...premiumCardStyle, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={iconBadgeStyle}>
                  <TaxCalcIcon size={20} />
                </div>
                <div style={premiumCardTextStyle}>
                  <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s234', "سقف الخصم بالنقاط من الفاتورة")}</strong>
                  <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s235', "أقصى نسبة مئوية مسموح بخصمها من إجمالي الفاتورة عبر النقاط")}</small>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  className="purchase-prototype-field-input"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  {...form.register('loyaltyMaxDiscountPercentage')}
                  disabled={disabled || !form.watch('loyaltyEnabled')}
                  placeholder="50"
                  style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>%</span>
              </div>
            </div>
          </div>

          {/* Live Simulation Card */}
          {form.watch('loyaltyEnabled') ? (
            <div style={{
              marginTop: '12px',
              padding: '12px 16px',
              borderRadius: '10px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <LightbulbIcon size={18} color="#170e5e" />
                <span style={{ fontSize: '0.84rem', color: '#1e293b', fontWeight: 700 }}>
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s236', "معاينة حية للمحرك: مشتريات بقيمة")} <strong>1,000 <CurrencySymbol /></strong> {__t('settings.forms.tabs.sales_inventory_settings_tab.s237', "تمنح العميل")}{' '}
                  <strong style={{ color: '#170e5e' }}>
                    {Math.floor((1000 / 100) * Number(form.watch('loyaltyPointsPer100Egp') || 10))} {__t('settings.forms.tabs.sales_inventory_settings_tab.s238', "نقطة")}
                  </strong>{' '}
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s239', "قيمتها")}{' '}
                  <strong style={{ color: '#170e5e' }}>
                    {(Math.floor((1000 / 100) * Number(form.watch('loyaltyPointsPer100Egp') || 10)) * Number(form.watch('loyaltyPointRedeemValue') || 0.1)).toFixed(2)} <CurrencySymbol />
                  </strong>{' '}
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s240', "خصم فوري في مشترياته القادمة (معدل استرجاع")}{' '}
                  <strong>
                    {(((Math.floor((1000 / 100) * Number(form.watch('loyaltyPointsPer100Egp') || 10)) * Number(form.watch('loyaltyPointRedeemValue') || 0.1)) / 1000) * 100).toFixed(1)}%
                  </strong>).
                </span>
              </div>
            </div>
          ) : null}
        </FormSection>
      )}

      {/* ===== تنبيهات الصلاحية والأصناف الراكدة (تجزئة وتجارة عامة فقط) ===== */}
      {isRetailCommerce && (
        <FormSection
          title={__t('settings.forms.tabs.sales_inventory_settings_tab.s241', "تنبيهات الصلاحية وحركة المخزون الراكد")}
          description={__t('settings.forms.tabs.sales_inventory_settings_tab.s242', "تخصيص الفترات الزمنية لتنبيهات قرب انتهاء صلاحية المنتجات وتحديد متى يُصنف الصنف كـ 'راكد' في لوحة التحكم والتقارير.")}
        >
          <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            {/* Card: Expiry Alert Days */}
            <div style={{ ...premiumCardStyle, cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <ExpiryAlertIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s243', "تنبيه قرب انتهاء الصلاحية")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s244', "إظهار تنبيهات وتصنيف الأصناف كـ \"وشيكة الانتهاء\" قبل انتهاء تاريخها بـ:")}</small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    className="purchase-prototype-field-input"
                    type="number"
                    min="1"
                    {...form.register('expiryAlertDays')}
                    disabled={disabled}
                    placeholder="30"
                    style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s245', "يوم")}</span>
                </div>
              </div>
              {/* Quick Presets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s246', "15 يوم"), days: 15 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s247', "30 يوم"), days: 30 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s248', "60 يوم"), days: 60 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s249', "90 يوم"), days: 90 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s250', "180 يوم"), days: 180 },
                ].map((p) => {
                  const currentVal = Number(form.watch('expiryAlertDays') || 30);
                  const isSelected = currentVal === p.days;
                  return (
                    <button
                      key={p.days}
                      type="button"
                      onClick={() => form.setValue('expiryAlertDays', p.days, { shouldDirty: true, shouldValidate: true })}
                      disabled={disabled}
                      style={{
                        padding: '4px 2px',
                        fontSize: '0.71rem',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        borderRadius: '6px',
                        border: isSelected ? '1px solid #170e5e' : '1px solid #e2e8f0',
                        background: isSelected ? '#eef2ff' : '#f8fafc',
                        color: isSelected ? '#170e5e' : '#475569',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Card: Stagnant Product Days */}
            <div style={{ ...premiumCardStyle, cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={iconBadgeStyle}>
                    <StagnantStockIcon size={20} />
                  </div>
                  <div style={premiumCardTextStyle}>
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s251', "معيار الأصناف الراكدة")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s252', "تصنيف الصنف كـ \"راكد\" في لوحة التحكم والتقارير إذا لم يُبَع منه منذ:")}</small>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    className="purchase-prototype-field-input"
                    type="number"
                    min="1"
                    {...form.register('stagnantProductDays')}
                    disabled={disabled}
                    placeholder="30"
                    style={{ width: '75px', height: '36px', textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', borderRadius: '6px', border: '1.5px solid #cbd5e1' }}
                  />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{__t('settings.forms.tabs.sales_inventory_settings_tab.s253', "يوم")}</span>
                </div>
              </div>
              {/* Quick Presets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s254', "30 يوم"), days: 30 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s255', "60 يوم"), days: 60 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s256', "90 يوم"), days: 90 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s257', "120 يوم"), days: 120 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s258', "180 يوم"), days: 180 },
                  { label: __t('settings.forms.tabs.sales_inventory_settings_tab.s259', "365 يوم"), days: 365 },
                ].map((p) => {
                  const currentVal = Number(form.watch('stagnantProductDays') || 30);
                  const isSelected = currentVal === p.days;
                  return (
                    <button
                      key={p.days}
                      type="button"
                      onClick={() => form.setValue('stagnantProductDays', p.days, { shouldDirty: true, shouldValidate: true })}
                      disabled={disabled}
                      style={{
                        padding: '4px 2px',
                        fontSize: '0.71rem',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        borderRadius: '6px',
                        border: isSelected ? '1px solid #170e5e' : '1px solid #e2e8f0',
                        background: isSelected ? '#eef2ff' : '#f8fafc',
                        color: isSelected ? '#170e5e' : '#475569',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </FormSection>
      )}
    </div>
  );
}, (prev, next) => {
  // Freeze inactive tab to preserve 0ms switching performance
  if (prev.activeTab !== 'sales_inventory' && next.activeTab !== 'sales_inventory') {
    return true;
  }
  return false;
});
