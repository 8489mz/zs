// POS terminals section (Section 11) — pure move from SalesInventorySettingsTab.tsx (slice S7).
// PosTerminalCard (487L) + TerminalsSection + both interfaces + PosTerminalIcon.
// The facade keeps the gate wrapper ({showPosSettings && (...)}) and the S6 hook call,
// and passes form, disabled, settings, showPosSettings + the 10 S6 hook values as props.
// settings + showPosSettings are carried in the props interface for uniformity; the moved
// text never reads them as code identifiers (S0/S3/S5 precedent). Gate flags are NOT
// destructured (S1 correction) — they arrive as props only.
// PREP CORRECTION: fieldControlStyle x5 is a real S7 dep (card body) — prep §3 missed it.
// PosTerminalTestResult stays NON-exported here (S6 D1: S6's hook carries its own local copy;
// structural typing makes the hook return assignable to the card's testResult prop).
import { useTranslation } from 'react-i18next';
import {memo, type Dispatch, type SetStateAction} from 'react';
import { FormSection } from '@/shared/components/form-section';
import { CustomSelect } from '@/shared/ui/custom-select';
import { iconBadgeStyle, premiumCheckboxInputStyle, fieldControlStyle } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-shared';
import { RotateCcwIcon, CheckIcon, ShieldAlertIcon, Trash2Icon, CheckCircleIcon, InfoIcon, PlusCircleIcon } from '@/shared/components/icons/AppIcons';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';
import type { PosTerminalDeviceConfig } from '@/types/domain-models/settings';

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

export interface SalesInventoryTerminalsProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  settings?: AppSettings;
  showPosSettings: boolean;
  testingTerminalId: string | null;
  terminalTestResults: Record<string, PosTerminalTestResult>;
  isMasterPosTerminalEnabled: boolean;
  setIsMasterPosTerminalEnabled: Dispatch<SetStateAction<boolean>>;
  terminalsList: PosTerminalDeviceConfig[];
  handleUpdateTerminal: (updated: PosTerminalDeviceConfig) => void;
  handleAddTerminal: () => void;
  handleRemoveTerminal: (id: string) => void;
  handleSetDefaultTerminal: (id: string) => void;
  handleTestTerminalDevice: (term: PosTerminalDeviceConfig) => Promise<void>;
}

export function SalesInventoryTerminals({ form, disabled, testingTerminalId, terminalTestResults, isMasterPosTerminalEnabled, setIsMasterPosTerminalEnabled, terminalsList, handleUpdateTerminal, handleAddTerminal, handleRemoveTerminal, handleSetDefaultTerminal, handleTestTerminalDevice }: SalesInventoryTerminalsProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== ماكينات نقاط البيع والدفع البنكي الذكية (Smart POS Terminals) ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.s194', "ماكينات نقاط البيع والدفع البنكي الذكية (Smart POS Terminals)")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.s195', "الربط الشبكي المباشر مع ماكينات الدفع الإلكتروني البنكية (Geidea, Fawry / PAX, Paymob, Network International) لتمرير مبالغ الفواتير آلياً وقراءة نجاح السحب دون إدخال يدوي. يمكنك ربط عدة ماكينات دفع في نفس الوقت وتعيين الماكينة الافتراضية للكاشير.")}
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
                      {t('settings.forms.tabs.sales_inventory_settings_tab.s196', "تفعيل خدمة ربط ماكينات الدفع الإلكتروني (POS Terminals)")}
                    </strong>
                    <small style={{ fontSize: '0.76rem', color: '#64748b' }}>
                      {t('settings.forms.tabs.sales_inventory_settings_tab.s197', "إظهار خيار إرسال المبالغ لماكينة البنك آلياً في شاشة الكاشير عند الدفع بالبطاقة")}
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
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s198', "إجمالي الماكينات:")} {terminalsList.length}
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
                    <span>{t('settings.forms.tabs.sales_inventory_settings_tab.s199', "إضافة ماكينة دفع إضافية")}</span>
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
                    {t('settings.forms.tabs.sales_inventory_settings_tab.s200', "إتمام وطباعة الفاتورة تلقائياً بمجرد موافقة ماكينة الدفع (Zero-Click Checkout)")}
                  </span>
                </label>
                <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px', display: 'block', paddingRight: '22px' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s201', "يغلق الفاتورة ويطبع إيصال مدى / كي نت آلياً فور اعتماد العميل لسحب البطاقة دون أي نقرات إضافية.")}
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
                <strong style={{ color: '#1e293b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s202', "إرشادات الربط مع الماكينات (ECR / LAN Direct):")}</strong>
                <span style={{ display: 'block', marginTop: '2px' }}>
                  • <strong>{t('settings.forms.tabs.sales_inventory_settings_tab.s203', "جيديا (Geidea):")}</strong> {t('settings.forms.tabs.sales_inventory_settings_tab.s204', "ادخل على إعدادات الماكينة أو تطبيق نقطة البيع > تفعيل ECR / LAN > المنفذ الافتراضي غالبًا")} <strong>8080</strong> {t('settings.forms.tabs.sales_inventory_settings_tab.s205', "أو")} <strong>8081</strong>.
                </span>
                <span style={{ display: 'block' }}>
                  • <strong>{t('settings.forms.tabs.sales_inventory_settings_tab.s206', "باكس وفوري (PAX A960 / Fawry):")}</strong> {t('settings.forms.tabs.sales_inventory_settings_tab.s207', "افتح تطبيق الكاشير أو تطبيق ECR على الماكينة (أو MaxStore) لتفعيل استقبال مبالغ الكاشير > المنفذ الافتراضي")} <strong>8080</strong> {t('settings.forms.tabs.sales_inventory_settings_tab.s208', "أو")} <strong>10009</strong>.
                </span>
                <span style={{ display: 'block' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s209', "• تأكد من اتصال جهاز الكمبيوتر وماكينة الدفع بنفس شبكة الـ Wi-Fi / الراوتر المحلي، ثم اضغط")} <strong>{t('settings.forms.tabs.sales_inventory_settings_tab.s210', "«فحص الاتصال الفعلي»")}</strong> {t('settings.forms.tabs.sales_inventory_settings_tab.s211', "للتأكد من وصول البينج واستجابة المنفذ.")}
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
    </>
  );
}
