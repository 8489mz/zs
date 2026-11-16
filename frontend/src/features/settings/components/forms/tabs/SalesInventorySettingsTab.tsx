import { useTranslation } from 'react-i18next';
import { memo } from 'react';
import { LightbulbIcon, RotateCcwIcon, CheckIcon, ShieldAlertIcon, InfoIcon, PlusCircleIcon, Trash2Icon, CheckCircleIcon } from '@/shared/components/icons/AppIcons';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';
import type { PosTerminalDeviceConfig } from '@/types/domain-models/settings';
import { FormSection } from '@/shared/components/form-section';
import { CustomSelect } from '@/shared/ui/custom-select';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { TaxCalcIcon, NegativeStockIcon, ZeroCostIcon, LowStockIndicatorIcon, IssueModeDocIcon, premiumCardStyle, iconBadgeStyle, premiumCardTextStyle, premiumCheckboxInputStyle, fieldControlStyle } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-shared';
import { SalesInventorySalesTax } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-sales-tax';
import { ContractingVerticalSection, MaritimeVerticalSection, ImportVerticalSection, ServicesVerticalSection, ManufacturingVerticalSection } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-verticals';
import { SalesInventoryRules, useSalesInventoryRulesState } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-rules';
import { SalesInventoryBarcode } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-barcode';
import { SalesInventoryPosCustom } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-pos-custom';
import { SalesInventoryZpay } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-zpay';
import { useSalesInventoryTerminals } from '@/features/settings/components/forms/tabs/sales-inventory/use-sales-inventory-terminals';

interface SalesInventoryTabProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  activeTab: string;
  settings?: AppSettings;
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
  // INV-FE3-FRONTEND-BOOK-DIGITS: the live loyalty preview (points ×
  // redeem value) is money; it rounds at the tenant's book digits, not
  // hardcoded 2dp. (The redeem rate % rendered with it is a percent and
  // keeps 1dp.)
  const loyaltyBookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
  const loyaltyPreviewPoints = Math.floor((1000 / 100) * Number(form.watch('loyaltyPointsPer100Egp') || 10));
  const loyaltyPreviewValue = roundMoneyValue(loyaltyPreviewPoints * Number(form.watch('loyaltyPointRedeemValue') || 0.1), loyaltyBookDigits);
  const rawActivity = String(form.watch('businessIndustry') || settings?.businessIndustry || (settings as any)?.activityType || 'retail_general').trim().toLowerCase();
  const isContractingVertical = rawActivity === 'contracting' || rawActivity === 'construction' || rawActivity === 'مقاولات' || Boolean(form.watch('contractingModuleEnabled'));
  const isMaritimeVertical = rawActivity === 'maritime_freight' || rawActivity === 'maritime' || rawActivity === 'freight' || rawActivity === 'shipping' || rawActivity === 'شحن' || Boolean(form.watch('maritimeFreightModuleEnabled'));
  const isManufacturingVertical = rawActivity === 'manufacturing' || rawActivity === 'production' || rawActivity === 'تصنيع' || rawActivity === 'مصنع' || Boolean(form.watch('manufacturingModuleEnabled'));
  const isServicesVertical = rawActivity === 'services' || rawActivity === 'consulting' || rawActivity === 'استشارات';
  const isImportVertical = rawActivity === 'import_export' || rawActivity === 'import';
  const isRestaurantVertical = ['restaurant', 'cafe', 'مطعم', 'كافيه'].includes(rawActivity) || Boolean(form.watch('restaurantModuleEnabled'));
  const isRetailCommerce = !isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isServicesVertical;
  const weightedBarcodeEnabled = Boolean(form.watch('weightedBarcodeEnabled'));
  const isPosModuleEnabled = Boolean(form.watch('posModuleEnabled') ?? settings?.posModuleEnabled ?? true);
  const showPosSettings = isPosModuleEnabled && isRetailCommerce;
  const showPhysicalInventory = !isServicesVertical;

  const isStoreFleet = form.watch('deliveryFeeMode') === 'store_fleet';
  const rules = useSalesInventoryRulesState();
  const terminals = useSalesInventoryTerminals({ form, settings });

  return (
    <div style={{ display: activeTab === 'sales_inventory' ? 'block' : 'none' }}>
      <SalesInventorySalesTax form={form} disabled={disabled} settings={settings} />
      {isContractingVertical && (
        <ContractingVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isMaritimeVertical && (
        <MaritimeVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isImportVertical && (
        <ImportVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isServicesVertical && (
        <ServicesVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isManufacturingVertical && (
        <ManufacturingVerticalSection form={form} disabled={disabled} settings={settings} />
      )}
      {isRetailCommerce && (
        <SalesInventoryRules form={form} disabled={disabled} settings={settings} isRestaurantVertical={isRestaurantVertical} showPosSettings={showPosSettings} showPhysicalInventory={showPhysicalInventory} isStoreFleet={isStoreFleet} isChangingPin={rules.isChangingPin} setIsChangingPin={rules.setIsChangingPin} />
      )}
      {weightedBarcodeEnabled ? (
        <SalesInventoryBarcode form={form} disabled={disabled} settings={settings} weightedBarcodeEnabled={weightedBarcodeEnabled} />
      ) : null}

      {showPosSettings && (
        <SalesInventoryPosCustom form={form} disabled={disabled} settings={settings} showPosSettings={showPosSettings} />
      )}

      {showPosSettings && (
        <SalesInventoryZpay form={form} disabled={disabled} settings={settings} showPosSettings={showPosSettings} />
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
                    checked={terminals.isMasterPosTerminalEnabled}
                    onChange={(e) => {
                      const val = e.target.checked;
                      terminals.setIsMasterPosTerminalEnabled(val);
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
                    {__t('settings.forms.tabs.sales_inventory_settings_tab.s198', "إجمالي الماكينات:")} {terminals.terminalsList.length}
                  </span>

                  <button
                    type="button"
                    disabled={disabled || !terminals.isMasterPosTerminalEnabled}
                    onClick={terminals.handleAddTerminal}
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
                      cursor: (disabled || !terminals.isMasterPosTerminalEnabled) ? 'not-allowed' : 'pointer',
                      opacity: (disabled || !terminals.isMasterPosTerminalEnabled) ? 0.6 : 1,
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
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: disabled || !terminals.isMasterPosTerminalEnabled ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="checkbox"
                    {...form.register('posTerminalAutoFinalize')}
                    disabled={disabled || !terminals.isMasterPosTerminalEnabled}
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
                gridTemplateColumns: terminals.terminalsList.length > 1 ? 'repeat(auto-fit, minmax(360px, 1fr))' : '1fr',
                gap: '14px',
              }}
            >
              {terminals.terminalsList.map((term, index) => (
                <PosTerminalCard
                  key={term.id}
                  terminal={term}
                  index={index}
                  totalCount={terminals.terminalsList.length}
                  disabled={disabled}
                  isMasterEnabled={terminals.isMasterPosTerminalEnabled}
                  onUpdate={terminals.handleUpdateTerminal}
                  onRemove={terminals.handleRemoveTerminal}
                  onSetDefault={terminals.handleSetDefaultTerminal}
                  onTest={terminals.handleTestTerminalDevice}
                  isTesting={terminals.testingTerminalId === term.id}
                  testResult={terminals.terminalTestResults[term.id]}
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
                    {loyaltyPreviewPoints} {__t('settings.forms.tabs.sales_inventory_settings_tab.s238', "نقطة")}
                  </strong>{' '}
                  {__t('settings.forms.tabs.sales_inventory_settings_tab.s239', "قيمتها")}{' '}
                  <strong style={{ color: '#170e5e' }}>
                    {loyaltyPreviewValue.toFixed(loyaltyBookDigits)} <CurrencySymbol />
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
