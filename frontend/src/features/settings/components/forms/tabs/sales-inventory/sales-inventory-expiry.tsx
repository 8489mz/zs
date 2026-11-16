// Section 13 (expiry + stagnant stock) — pure move from SalesInventorySettingsTab.tsx (slice S9).
// The facade keeps the gate wrapper ({isRetailCommerce && (...)}) and passes form, disabled, settings as props.
// isRetailCommerce is NOT carried: 0 code uses in the moved body (S1 precedent) — it is the section's own gate, facade-owned.
// settings is carried in the props interface for uniformity; the moved text never reads it as code (20 word hits, all inside __t key string literals).

import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import { premiumCardStyle, iconBadgeStyle, premiumCardTextStyle } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-shared';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';

export interface SalesInventoryExpiryProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
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

export function SalesInventoryExpiry({ form, disabled }: SalesInventoryExpiryProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== تنبيهات الصلاحية والأصناف الراكدة (تجزئة وتجارة عامة فقط) ===== */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.s241', "تنبيهات الصلاحية وحركة المخزون الراكد")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.s242', "تخصيص الفترات الزمنية لتنبيهات قرب انتهاء صلاحية المنتجات وتحديد متى يُصنف الصنف كـ 'راكد' في لوحة التحكم والتقارير.")}
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
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s243', "تنبيه قرب انتهاء الصلاحية")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s244', "إظهار تنبيهات وتصنيف الأصناف كـ \"وشيكة الانتهاء\" قبل انتهاء تاريخها بـ:")}</small>
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
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s245', "يوم")}</span>
                </div>
              </div>
              {/* Quick Presets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s246', "15 يوم"), days: 15 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s247', "30 يوم"), days: 30 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s248', "60 يوم"), days: 60 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s249', "90 يوم"), days: 90 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s250', "180 يوم"), days: 180 },
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
                    <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s251', "معيار الأصناف الراكدة")}</strong>
                    <small className="muted" style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s252', "تصنيف الصنف كـ \"راكد\" في لوحة التحكم والتقارير إذا لم يُبَع منه منذ:")}</small>
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
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s253', "يوم")}</span>
                </div>
              </div>
              {/* Quick Presets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                {[
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s254', "30 يوم"), days: 30 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s255', "60 يوم"), days: 60 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s256', "90 يوم"), days: 90 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s257', "120 يوم"), days: 120 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s258', "180 يوم"), days: 180 },
                  { label: t('settings.forms.tabs.sales_inventory_settings_tab.s259', "365 يوم"), days: 365 },
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
    </>
  );
}
