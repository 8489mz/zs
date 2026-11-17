import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import { FormSection } from '@/shared/components/form-section';
import { CustomSelect } from '@/shared/ui/custom-select';

export type ElectronSystemPrinter = { name: string; displayName: string };

export function buildElectronPrinterOptions(
  systemPrinters: ElectronSystemPrinter[],
  savedPrinter: string | undefined,
  defaultLabel: string,
) {
  const trimmedSaved = String(savedPrinter || '').trim();
  const hasSaved = Boolean(trimmedSaved && !systemPrinters.some((p) => p.name === trimmedSaved));
  return [
    { value: '', label: defaultLabel },
    ...(hasSaved ? [{ value: trimmedSaved, label: trimmedSaved }] : []),
    ...systemPrinters.map((p) => ({ value: p.name, label: p.displayName || p.name })),
  ];
}

interface ElectronDirectPrintersSectionProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  systemPrinters: ElectronSystemPrinter[];
  savedCashierPrinter?: string;
  savedBarcodePrinter?: string;
  savedDocumentPrinter?: string;
  showCashierPrinter: boolean;
  showBarcodePrinter: boolean;
}

export function ElectronDirectPrintersSection({
  form,
  disabled,
  systemPrinters,
  savedCashierPrinter,
  savedBarcodePrinter,
  savedDocumentPrinter,
  showCashierPrinter,
  showBarcodePrinter,
}: ElectronDirectPrintersSectionProps) {
  const { t } = useTranslation();
  if (typeof window === 'undefined' || !(window as any).electronPrinter) return null;

  const defaultOptionLabel = t('settings.forms.tabs.printing_settings_tab.s68', '- الطباعة العادية (نافذة المتصفح) -');

  return (
    <FormSection
      title={t('settings.forms.tabs.printing_settings_tab.s187', 'الطابعات المباشرة (نسخة الإلكترون)')}
      description={t(
        'settings.forms.tabs.printing_settings_tab.s188',
        'اختر طابعات ويندوز المتصلة بالجهاز للطباعة المباشرة وتذكّرها تلقائياً بدون نافذة تأكيد في كل مرة (اختياري).',
      )}
    >
      <div className="document-prototype-grid compact-grid-2">
        {showCashierPrinter && (
          <div className="field">
            <label>{t('settings.forms.tabs.printing_settings_tab.s67', 'طابعة الكاشير المباشرة (الريسيت)')}</label>
            <CustomSelect
              value={form.watch('posElectronCashierPrinter') || ''}
              onChange={(val) => form.setValue('posElectronCashierPrinter', val, { shouldDirty: true, shouldValidate: true })}
              options={buildElectronPrinterOptions(systemPrinters, savedCashierPrinter, defaultOptionLabel)}
              disabled={disabled}
            />
          </div>
        )}

        {showBarcodePrinter && (
          <div className="field">
            <label>{t('settings.forms.tabs.printing_settings_tab.barcode_printer_label', 'طابعة الباركود المباشرة (الاستيكر — اختياري)')}</label>
            <CustomSelect
              value={form.watch('posElectronBarcodePrinter') || ''}
              onChange={(val) => form.setValue('posElectronBarcodePrinter', val, { shouldDirty: true, shouldValidate: true })}
              options={buildElectronPrinterOptions(systemPrinters, savedBarcodePrinter, defaultOptionLabel)}
              disabled={disabled}
            />
          </div>
        )}

        <div className="field">
          <label>طابعة الفواتير والمستندات الكبيرة (A4 — اختياري)</label>
          <CustomSelect
            value={form.watch('posElectronDocumentPrinter') || ''}
            onChange={(val) => form.setValue('posElectronDocumentPrinter', val, { shouldDirty: true, shouldValidate: true })}
            options={buildElectronPrinterOptions(systemPrinters, savedDocumentPrinter, defaultOptionLabel)}
            disabled={disabled}
          />
        </div>

        <div className="muted small" style={{ gridColumn: '1 / -1' }}>
          <strong>{t('settings.forms.tabs.printing_settings_tab.s71', 'معلومة:')}</strong>{' '}
          {t(
            'settings.forms.tabs.printing_settings_tab.s189',
            'أي طابعة تختارها وتُحفظ هنا ستبقى مثبتة للطباعة التلقائية بدون نافذة اختيار في كل مرة (ويمكن اختيار طابعة مختلفة لكل جهاز).',
          )}
        </div>
      </div>
    </FormSection>
  );
}
