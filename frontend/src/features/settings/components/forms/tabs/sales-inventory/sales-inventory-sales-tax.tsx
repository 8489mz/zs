// Sales + tax section (Section 1) — pure move from SalesInventorySettingsTab.tsx (slice S0).
// The facade keeps the render and passes form, disabled and settings as props.
// settings is carried in the props interface for uniformity; the moved text never reads it.

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FormSection } from '@/shared/components/form-section';
import { CustomSelect } from '@/shared/ui/custom-select';
import { TaxCalcIcon, iconBadgeStyle, fieldControlStyle } from '@/features/settings/components/forms/tabs/sales-inventory/sales-inventory-shared';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';

export interface SalesInventorySalesTaxProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  settings?: AppSettings;
}

export function SalesInventorySalesTax({ form, disabled }: SalesInventorySalesTaxProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* ===== إعدادات البيع والضريبة ===== */}
      <FormSection
        title={t('settings.forms.tabs.sales_inventory_settings_tab.s26', "إعدادات البيع والضريبة")}
        description={t('settings.forms.tabs.sales_inventory_settings_tab.s27', "تحديد نسبة الضريبة على المبيعات، وطريقة احتسابها على أسعار الأصناف، والرقم الضريبي.")}
      >
        <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
          {/* Card 1: Tax Mode & Rate */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={iconBadgeStyle}>
                <TaxCalcIcon size={20} />
              </div>
              <div>
                <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s28', "حساب الضريبة على المبيعات")}</strong>
                <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block' }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s29', "طريقة إضافة القيمة المضافة ونسبتها")}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s30', "نسبة الضريبة (%)")}
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
                  {t('settings.forms.tabs.sales_inventory_settings_tab.s31', "طريقة احتساب الضريبة")}
                </label>
                <CustomSelect
                  value={form.watch('taxMode') || 'exclusive'}
                  onChange={(val) => form.setValue('taxMode', val as any, { shouldDirty: true, shouldValidate: true })}
                  options={[
                    { value: 'exclusive', label: t('settings.forms.tabs.sales_inventory_settings_tab.s32', "تضاف فوق السعر") },
                    { value: 'inclusive', label: t('settings.forms.tabs.sales_inventory_settings_tab.s33', "ضمن السعر") },
                  ]}
                  disabled={disabled}
                />
              </div>
            </div>
          </div>

          {/* Card 2: Organization Tax Number */}
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: '0.88rem', color: '#0f172a', fontWeight: 800 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s34', "الرقم الضريبي للمنشأة")}</strong>
              <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0', fontWeight: 600 }}>{t('settings.forms.tabs.sales_inventory_settings_tab.s35', "الفواتير والإيصالات")}</span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                {t('settings.forms.tabs.sales_inventory_settings_tab.s36', "رقم التسجيل الضريبي المطبوع على الفاتورة")}
              </label>
              <input
                {...form.register('taxNumber')}
                disabled={disabled}
                placeholder={t('settings.forms.tabs.sales_inventory_settings_tab.s37', "مثال: 123-456-789")}
                style={fieldControlStyle}
              />
              <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
                {t('settings.forms.tabs.sales_inventory_settings_tab.s38', "يظهر هذا الرقم أعلى ترويسة فواتير المبيعات، الإيصالات الحرارية، وتقارير الإقرارات الضريبية.")}
              </span>
            </div>
          </div>

          {/* Direct link to Advanced Tax & E-Invoice Integration */}
          <div style={{ gridColumn: '1 / -1', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <span style={{ fontSize: '0.78rem', color: '#475569' }}>
              {t('settings.forms.tabs.sales_inventory_settings_tab.s39', "للربط السحابي المباشر مع مصلحة الضرائب المصرية (ETA) أو هيئة الزكاة والضريبة والجمارك (ZATCA):")}
            </span>
            <Link
              to="/settings/tax-integration"
              className="btn btn-secondary"
              style={{ padding: '4px 12px', fontSize: '0.78rem', fontWeight: 700 }}
            >
              {t('settings.forms.tabs.sales_inventory_settings_tab.s40', "إعدادات الضرائب والفاتورة الإلكترونية")}
            </Link>
          </div>
        </div>
      </FormSection>
    </>
  );
}
