import { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { AppSettings } from '@/types/domain';
import { FormSection } from '@/shared/components/form-section';
import { CustomSelect } from '@/shared/ui/custom-select';
import { AppIcons } from '@/shared/components/icons/AppIcons';

interface BridgeDirectPrintersSectionProps {
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
  settings?: AppSettings;
  bridgePrinters: string[] | null;
  isScanning?: boolean;
  onRefreshPrinters: () => void;
  showPosSettings: boolean;
  showBarcodePrinter: boolean;
}

function buildBridgePrinterOptions(
  printers: string[],
  currentValue: string,
  emptyLabel: string,
) {
  return [
    { value: '', label: emptyLabel },
    ...(currentValue && !printers.includes(currentValue)
      ? [{ value: currentValue, label: `${currentValue} (محفوظة)` }]
      : []),
    ...printers.map((name) => ({ value: name, label: name })),
  ];
}

export function BridgeDirectPrintersSection({
  form,
  disabled,
  settings,
  bridgePrinters,
  isScanning,
  onRefreshPrinters,
  showPosSettings,
  showBarcodePrinter,
}: BridgeDirectPrintersSectionProps) {
  const { t } = useTranslation();
  if (typeof window !== 'undefined' && (window as any).electronPrinter) return null;
  if (!showPosSettings && !showBarcodePrinter) return null;

  const savedCashier = String(form.watch('posWindowsPrinterName') || settings?.posWindowsPrinterName || '').trim();
  const savedBarcode = String(form.watch('posWindowsBarcodePrinterName') || settings?.posWindowsBarcodePrinterName || '').trim();
  const savedDocument = String(form.watch('posWindowsDocumentPrinterName') || settings?.posWindowsDocumentPrinterName || '').trim();
  const hasBridgeList = bridgePrinters !== null && bridgePrinters.length > 0;
  const defaultOptionLabel = t('settings.forms.tabs.printing_settings_tab.s180', '- الطباعة العادية (نافذة المتصفح) -');

  return (
    <FormSection
      title={t('settings.forms.tabs.printing_settings_tab.s177', 'الطابعات المحفوظة والطباعة الصامتة عبر الجسر (نسخة المتصفح SaaS)')}
      description={t(
        'settings.forms.tabs.printing_settings_tab.s178',
        'اختر طابعات ويندوز مرة واحدة عبر جسر Z-Systems المحلي ليحفظها النظام ويرسل الفواتير والباركود إليها تلقائياً دون اختيارها في كل مرة.',
      )}
    >
      <div className="document-prototype-grid compact-grid-2">
        {showPosSettings && (
          <div className="field">
            <label>{t('settings.forms.tabs.printing_settings_tab.s179', 'اسم طابعة ويندوز للكاشير (الريسيت)')}</label>
            {hasBridgeList ? (
              <CustomSelect
                value={form.watch('posWindowsPrinterName') || ''}
                onChange={(val) => form.setValue('posWindowsPrinterName', val, { shouldDirty: true, shouldValidate: true })}
                options={buildBridgePrinterOptions(bridgePrinters, savedCashier, defaultOptionLabel)}
                disabled={disabled}
              />
            ) : (
              <input
                className="purchase-prototype-field-input"
                {...form.register('posWindowsPrinterName')}
                disabled={disabled}
                placeholder={t('settings.forms.tabs.printing_settings_tab.s181', 'مثال: EPSON WF-C5290BA — اكتب الاسم كما يظهر في ويندوز')}
              />
            )}
          </div>
        )}

        {showBarcodePrinter && (
          <div className="field">
            <label>طابعة الباركود عبر الجسر المحلي (الاستيكر — اختياري)</label>
            {hasBridgeList ? (
              <CustomSelect
                value={form.watch('posWindowsBarcodePrinterName') || ''}
                onChange={(val) => form.setValue('posWindowsBarcodePrinterName', val, { shouldDirty: true, shouldValidate: true })}
                options={buildBridgePrinterOptions(bridgePrinters, savedBarcode, defaultOptionLabel)}
                disabled={disabled}
              />
            ) : (
              <input
                className="purchase-prototype-field-input"
                {...form.register('posWindowsBarcodePrinterName')}
                disabled={disabled}
                placeholder="مثال: Xprinter XP-246B — كما يظهر في طابعات ويندوز"
              />
            )}
          </div>
        )}

        <div className="field">
          <label>طابعة الفواتير والمستندات (A4 — عبر الجسر، اختياري)</label>
          {hasBridgeList ? (
            <CustomSelect
              value={form.watch('posWindowsDocumentPrinterName') || ''}
              onChange={(val) => form.setValue('posWindowsDocumentPrinterName', val, { shouldDirty: true, shouldValidate: true })}
              options={buildBridgePrinterOptions(bridgePrinters, savedDocument, '- نفس طابعة الكاشير / نافذة المتصفح -')}
              disabled={disabled}
            />
          ) : (
            <input
              className="purchase-prototype-field-input"
              {...form.register('posWindowsDocumentPrinterName')}
              disabled={disabled}
              placeholder="مثال: HP LaserJet Pro — اتركه فارغاً للافتراضي"
            />
          )}
        </div>

        <div className="field" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onRefreshPrinters}
            disabled={disabled || isScanning}
            style={{
              height: '36px',
              padding: '0 12px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              background: '#f8fafc',
              color: '#170e5e',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: isScanning ? 'wait' : 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            <AppIcons.RefreshCw size={14} />
            <span>{isScanning ? 'جارٍ فحص طابعات الجسر...' : 'تحديث طابعات الجسر المحلي'}</span>
          </button>
          <small style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', display: 'block' }}>
            {hasBridgeList
              ? t('settings.forms.tabs.printing_settings_tab.s182', 'القائمة محدثة من جسر Z-Systems على هذا الجهاز وتُحفظ تلقائياً بعد حفظ الإعدادات.')
              : t('settings.forms.tabs.printing_settings_tab.s183', 'الجسر غير متصل حالياً — شغّل جسر Z-Systems للاختيار من القائمة أو اكتب اسم الطابعة يدوياً.')}
          </small>
        </div>

        {showPosSettings && (
          <>
            <div className="field">
              <label>{t('settings.forms.tabs.printing_settings_tab.s184', 'عنوان IP لطابعة الشبكة الحرارية')}</label>
              <input
                className="purchase-prototype-field-input"
                {...form.register('posNetworkThermalPrinterIp')}
                disabled={disabled}
                placeholder={t('settings.forms.tabs.printing_settings_tab.s185', 'مثال: 192.168.1.50')}
              />
            </div>

            <div className="field">
              <label>{t('settings.forms.tabs.printing_settings_tab.s186', 'منفذ طابعة الشبكة الحرارية')}</label>
              <input
                type="number"
                className="purchase-prototype-field-input"
                {...form.register('posNetworkThermalPrinterPort', { valueAsNumber: true })}
                disabled={disabled}
                placeholder="9100"
              />
            </div>
          </>
        )}
      </div>
    </FormSection>
  );
}
