import { CustomSelect } from '@/shared/ui/custom-select';
import { SUPPORTED_CURRENCIES } from '@/lib/currencies';
import { ShieldCheckIcon } from '@/shared/components/icons/AppIcons';
import { toast } from '@/shared/components/system-alert';
import type { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';

export interface GeneralSettingsPreferencesProps {
  t: ReturnType<typeof useTranslation>['t'];
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
}

export function GeneralSettingsPreferences({ t, form, disabled }: GeneralSettingsPreferencesProps) {
  return (
    <>
    {/* Card 3: التفضيلات والمنطقة والتواصل (Regional & Preferences) */}
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 800, display: 'block' }}>
            {t('settings.forms.tabs.general_settings_tab.s55', "اللغة والمنطقة والتواصل")}
          </strong>
          <span style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.general_settings_tab.s56', "العملة، التوقيت، وتنسيق التواريخ والواتساب")}</span>
        </div>
        <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '4px', border: '1px solid #e2e8f0', fontWeight: 600, flexShrink: 0 }}>
          {t('settings.forms.tabs.general_settings_tab.s57', "التفضيلات")}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
        <div className="field">
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s58', "دولة المقر / التشغيل")}</label>
          <CustomSelect
            value={form.watch('country') || (form.watch('currency') === 'KWD' ? 'KW' : form.watch('currency') === 'SAR' ? 'SA' : 'EG')}
            onChange={(val) => {
              form.setValue('country', val, { shouldDirty: true, shouldValidate: true });
              if (val === 'KW') {
                form.setValue('currency', 'KWD', { shouldDirty: true, shouldValidate: true });
                form.setValue('timezone', 'Asia/Kuwait', { shouldDirty: true, shouldValidate: true });
                form.setValue('taxRate', 0, { shouldDirty: true, shouldValidate: true });
                form.setValue('taxNumber', '', { shouldDirty: true, shouldValidate: true });
                form.setValue('printShowTaxNumber', false, { shouldDirty: true, shouldValidate: true });
                form.setValue('posTerminalProvider', 'knet_pos', { shouldDirty: true, shouldValidate: true });
                form.setValue('printNumberFormat', 'english', { shouldDirty: true, shouldValidate: true });
                toast.success(t('settings.forms.tabs.general_settings_tab.s59', "تم تفعيل إعدادات دولة الكويت بنجاح: د.ك (3 خانات - فلس)، أرقام لاتينية قياسية، ضريبة 0%، وشبكة كي نت K-NET."));
              } else if (val === 'SA') {
                form.setValue('currency', 'SAR', { shouldDirty: true, shouldValidate: true });
                form.setValue('timezone', 'Asia/Riyadh', { shouldDirty: true, shouldValidate: true });
                form.setValue('taxRate', 15, { shouldDirty: true, shouldValidate: true });
                form.setValue('printShowTaxNumber', true, { shouldDirty: true, shouldValidate: true });
                toast.success(t('settings.forms.tabs.general_settings_tab.s60', "تم تفعيل إعدادات المملكة العربية السعودية: ريال سعودي، ضريبة 15%، وهيئة الزكاة والضريبة ZATCA."));
              } else if (val === 'EG') {
                form.setValue('currency', 'EGP', { shouldDirty: true, shouldValidate: true });
                form.setValue('timezone', 'Africa/Cairo', { shouldDirty: true, shouldValidate: true });
                form.setValue('taxRate', 14, { shouldDirty: true, shouldValidate: true });
              } else if (val === 'AE') {
                form.setValue('currency', 'AED', { shouldDirty: true, shouldValidate: true });
                form.setValue('timezone', 'Asia/Dubai', { shouldDirty: true, shouldValidate: true });
                form.setValue('taxRate', 5, { shouldDirty: true, shouldValidate: true });
              } else if (val === 'QA') {
                form.setValue('currency', 'QAR', { shouldDirty: true, shouldValidate: true });
                form.setValue('timezone', 'Asia/Qatar', { shouldDirty: true, shouldValidate: true });
                form.setValue('taxRate', 0, { shouldDirty: true, shouldValidate: true });
              } else if (val === 'BH') {
                form.setValue('currency', 'BHD', { shouldDirty: true, shouldValidate: true });
                form.setValue('timezone', 'Asia/Bahrain', { shouldDirty: true, shouldValidate: true });
                form.setValue('taxRate', 10, { shouldDirty: true, shouldValidate: true });
              } else if (val === 'OM') {
                form.setValue('currency', 'OMR', { shouldDirty: true, shouldValidate: true });
                form.setValue('timezone', 'Asia/Muscat', { shouldDirty: true, shouldValidate: true });
                form.setValue('taxRate', 5, { shouldDirty: true, shouldValidate: true });
              }
            }}
            options={[
              { value: 'KW', label: t('settings.forms.tabs.general_settings_tab.s61', "دولة الكويت (Kuwait)") },
              { value: 'SA', label: t('settings.forms.tabs.general_settings_tab.s62', "المملكة العربية السعودية (KSA)") },
              { value: 'EG', label: t('settings.forms.tabs.general_settings_tab.s63', "جمهورية مصر العربية (Egypt)") },
              { value: 'AE', label: t('settings.forms.tabs.general_settings_tab.s64', "دولة الإمارات (UAE)") },
              { value: 'QA', label: t('settings.forms.tabs.general_settings_tab.s65', "دولة قطر (Qatar)") },
              { value: 'BH', label: t('settings.forms.tabs.general_settings_tab.s66', "مملكة البحرين (Bahrain)") },
              { value: 'OM', label: t('settings.forms.tabs.general_settings_tab.s67', "سلطنة عُمان (Oman)") },
            ]}
            disabled={disabled}
          />
        </div>

        <div className="field">
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s68', "لغة النظام")}</label>
          <CustomSelect
            value={form.watch('uiLanguage') || 'ar'}
            onChange={(val) => {
              form.setValue('uiLanguage', val as any, { shouldDirty: true, shouldValidate: true });
              if (val === 'en' || val === 'ar') {
                import('@/lib/i18n').then(({ default: i18n }) => {
                  i18n.changeLanguage(val);
                });
              }
            }}
            options={[
              { value: 'ar', label: t('settings.forms.tabs.general_settings_tab.s69', "العربية") },
              { value: 'en', label: 'English' },
            ]}
            disabled={disabled}
          />
        </div>

        <div className="field">
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s70', "العملة")}</label>
          <CustomSelect
            value={form.watch('currency') || 'EGP'}
            onChange={(val) => {
              form.setValue('currency', val, { shouldDirty: true, shouldValidate: true });
              if (val === 'KWD' && form.watch('country') !== 'KW') {
                form.setValue('country', 'KW', { shouldDirty: true, shouldValidate: true });
              } else if (val === 'SAR' && form.watch('country') !== 'SA') {
                form.setValue('country', 'SA', { shouldDirty: true, shouldValidate: true });
              }
            }}
            options={SUPPORTED_CURRENCIES.map((c) => ({ value: c.code, label: c.label }))}
            disabled={disabled}
          />
        </div>

        <div className="field">
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s71', "المنطقة الزمنية")}</label>
          <CustomSelect
            value={form.watch('timezone') || 'Africa/Cairo'}
            onChange={(val) => form.setValue('timezone', val, { shouldDirty: true, shouldValidate: true })}
            options={[
              { value: 'Africa/Cairo', label: t('settings.forms.tabs.general_settings_tab.s72', "مصر (Africa/Cairo)") },
              { value: 'Asia/Riyadh', label: t('settings.forms.tabs.general_settings_tab.s73', "السعودية (Asia/Riyadh)") },
              { value: 'Asia/Kuwait', label: t('settings.forms.tabs.general_settings_tab.s74', "الكويت (Asia/Kuwait)") },
              { value: 'Asia/Qatar', label: t('settings.forms.tabs.general_settings_tab.s75', "قطر (Asia/Qatar)") },
              { value: 'Asia/Dubai', label: t('settings.forms.tabs.general_settings_tab.s76', "الإمارات (Asia/Dubai)") },
              { value: 'Asia/Bahrain', label: t('settings.forms.tabs.general_settings_tab.s77', "البحرين (Asia/Bahrain)") },
              { value: 'Asia/Muscat', label: t('settings.forms.tabs.general_settings_tab.s78', "عُمان (Asia/Muscat)") },
              { value: 'UTC', label: t('settings.forms.tabs.general_settings_tab.s79', "التوقيت العالمي (UTC)") },
            ]}
            disabled={disabled}
          />
        </div>

        <div className="field">
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s80', "صيغة التاريخ")}</label>
          <CustomSelect
            value={form.watch('dateFormat') || 'dd/MM/yyyy'}
            onChange={(val) => form.setValue('dateFormat', val as any, { shouldDirty: true, shouldValidate: true })}
            options={[
              { value: 'yyyy-MM-dd', label: '2026-06-07 (ISO)' },
              { value: 'dd/MM/yyyy', label: '07/06/2026' },
            ]}
            disabled={disabled}
          />
        </div>

        <div className="field">
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s81', "صيغة الوقت")}</label>
          <CustomSelect
            value={form.watch('timeFormat') || '12h'}
            onChange={(val) => form.setValue('timeFormat', val as any, { shouldDirty: true, shouldValidate: true })}
            options={[
              { value: '24h', label: t('settings.forms.tabs.general_settings_tab.s82', "24 ساعة") },
              { value: '12h', label: t('settings.forms.tabs.general_settings_tab.s83', "12 ساعة (ص/م)") },
            ]}
            disabled={disabled}
          />
        </div>

        <div className="field">
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s84', "رابط إرسال الواتساب")}</label>
          <CustomSelect
            value={form.watch('whatsappLinkMode') || 'wa_me'}
            onChange={(val) => form.setValue('whatsappLinkMode', val as any, { shouldDirty: true, shouldValidate: true })}
            options={[
              { value: 'wa_me', label: t('settings.forms.tabs.general_settings_tab.s85', "افتراضي (يسأل المستخدم)") },
              { value: 'web', label: t('settings.forms.tabs.general_settings_tab.s86', "واتساب ويب مباشرة") },
              { value: 'app', label: t('settings.forms.tabs.general_settings_tab.s87', "تطبيق الواتساب مباشرة") },
            ]}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Kuwait Regional Profile Active Banner */}
      {(form.watch('country') === 'KW' || form.watch('currency') === 'KWD') && (
        <div style={{
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '10px',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '0.8rem',
          color: '#166534',
          marginTop: '4px',
        }}>
          <ShieldCheckIcon size={18} color="#16a34a" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <strong style={{ fontSize: '0.84rem' }}>{t('settings.forms.tabs.general_settings_tab.s88', "الملف الإقليمي لدولة الكويت مفعّل بالكامل")}</strong>
            <span style={{ fontSize: '0.74rem', color: '#15803d' }}>
              {t('settings.forms.tabs.general_settings_tab.s89', "دقة الأسعار 3 خانات عشرية (فلس)، ضريبة 0%، شبكة كي نت (K-NET)، منصة كاري (Cari)، ونموذج عناوين المعلومات المدنية (PACI). يمكنك تعديل أي حقل مخصص يدوياً بحرية.")}
            </span>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
