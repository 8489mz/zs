// Weighted-barcode section (Section 8) — pure move from SalesInventorySettingsTab.tsx (slice S3).
// The facade keeps the gate wrapper ({weightedBarcodeEnabled ? (...) : null}) and passes form, disabled, settings and weightedBarcodeEnabled as props.
// settings + weightedBarcodeEnabled are carried in the props interface for uniformity; the moved text never reads them.

import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';

export interface SalesInventoryBarcodeProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  settings?: AppSettings;
  weightedBarcodeEnabled: boolean;
}

export function SalesInventoryBarcode({ form, disabled }: SalesInventoryBarcodeProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Scale-barcode format: moved here from the super-admin-only manual
          switches block of ModulesSettingsTab so any tenant admin who enabled
          the scale app (all activities) can configure it. Field labels keep the
          modules-tab i18n keys so existing translations resolve unchanged. */}
        <FormSection
          title={t('settings.forms.tabs.sales_inventory_settings_tab.weighted_barcode_section_title', "إعدادات باركود الميزان")}
          description={t('settings.forms.tabs.sales_inventory_settings_tab.weighted_barcode_section_desc', "تنسيق باركود الميزان: البادئة وطول كود الصنف وخانات الوزن ومحتوى الباركود.")}
        >
          <div className="document-prototype-grid compact-grid-2">
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s176', "بداية باركود الميزان")}</label>
              <input className="purchase-prototype-field-input" inputMode="numeric" {...form.register('weightedBarcodePrefix')} disabled={disabled} placeholder="21" />
            </div>
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s177', "أرقام كود الصنف")}</label>
              <input className="purchase-prototype-field-input" type="number" min="3" max="8" {...form.register('weightedBarcodeProductCodeLength')} disabled={disabled} />
            </div>
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s178', "أرقام الوزن")}</label>
              <input className="purchase-prototype-field-input" type="number" min="3" max="8" {...form.register('weightedBarcodeWeightDigits')} disabled={disabled} />
            </div>
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s179', "دقة الوزن (خانات عشرية)")}</label>
              <input className="purchase-prototype-field-input" type="number" min="0" max="3" {...form.register('weightedBarcodeWeightDecimals')} disabled={disabled} />
            </div>
            <div className="field">
              <label>{t('settings.forms.tabs.modules_settings_tab.s180', "محتوى باركود الميزان")}</label>
              <select className="purchase-prototype-field-input" {...form.register('weightedBarcodeValueMode')} disabled={disabled}>
                <option value="weight">{t('settings.forms.tabs.modules_settings_tab.s181', "وزن الصنف")}</option>
                <option value="price">{t('settings.forms.tabs.modules_settings_tab.s182', "السعر الإجمالي بالصغرى (قرشان / هللتان)")}</option>
              </select>
            </div>
          </div>
        </FormSection>
    </>
  );
}
