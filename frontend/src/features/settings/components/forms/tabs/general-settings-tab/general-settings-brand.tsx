import { BrandAvatarAndTitlePreview } from './brand-avatar-and-title-preview';
import { readFileAsDataUrl, RequiredField } from '@/features/settings/components/forms/settings-forms.shared';
import { ShieldCheckIcon } from '@/shared/components/icons/AppIcons';
import { getIndustrySummary } from './general-settings-tab-shared';
import type { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { getPillarBadgeInfo } from './general-settings-tab-shared';

export interface GeneralSettingsBrandProps {
  t: ReturnType<typeof useTranslation>['t'];
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  accentColor: string;
  logoData: string | undefined;
  disabled: boolean;
  info: ReturnType<typeof getPillarBadgeInfo>;
  isSuperAdmin: boolean;
  storeNameLabel: string;
  storeNamePlaceholder: string;
  rawAct: string;
  isEn: boolean;
}

export function GeneralSettingsBrand({ t, form, accentColor, logoData, disabled, info, isSuperAdmin, storeNameLabel, storeNamePlaceholder, rawAct, isEn }: GeneralSettingsBrandProps) {
  return (
    <>
    {/* Card 1: الهوية وبيانات النشاط (Store Identity & Basic Info) */}
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px',
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
    }}>
      {/* Section Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 800, display: 'block' }}>
            {t('settings.forms.tabs.general_settings_tab.s1', "الهوية وبيانات النشاط")}
          </strong>
          <span style={{ fontSize: '0.76rem', color: '#64748b' }}>{t('settings.forms.tabs.general_settings_tab.s2', "الاسم والشعار وبيانات التواصل المطبوعة")}</span>
        </div>
      </div>

      {/* Interactive Logo & Brand Header with Operational Sector Badge */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '10px',
        padding: '10px 14px',
        flexWrap: 'wrap',
      }}>
        {/* Right: Logo Preview box + Brand details */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: '1 1 200px' }}>
          <BrandAvatarAndTitlePreview control={form.control} accentColor={accentColor} logoData={logoData}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
              <label style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#0f172a',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: '5px',
                padding: '2px 8px',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}>
                {logoData ? t('settings.forms.tabs.general_settings_tab.s3', "تغيير الشعار") : t('settings.forms.tabs.general_settings_tab.s4', "رفع شعار")}
                <input
                  type="file"
                  style={{ display: 'none' }}
                  accept="image/*"
                  disabled={disabled}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      form.setValue('logoData', await readFileAsDataUrl(file), { shouldDirty: true, shouldValidate: true });
                    } finally {
                      event.currentTarget.value = '';
                    }
                  }}
                />
              </label>

              {logoData && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => form.setValue('logoData', '', { shouldDirty: true, shouldValidate: true })}
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: '#b91c1c',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px 6px',
                  }}
                >
                  {t('settings.forms.tabs.general_settings_tab.s5', "حذف")}
                </button>
              )}
            </div>
          </BrandAvatarAndTitlePreview>
        </div>

        {/* Left: Compact Enterprise Sector & Activity Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: info.bg,
            border: `1px solid ${info.borderColor}`,
            borderRadius: '8px',
            padding: '5px 10px',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
          title={
            isSuperAdmin
              ? t('settings.forms.tabs.general_settings_tab.s6', "وضع السوبر أدمن: التعديل متاح من تبويب تخصيص المنظومة والنشاط")
              : t('settings.forms.tabs.general_settings_tab.s7', "نمط معتمد ومثبت للمنشأة لحماية سلامة القيود")
          }
        >
          <ShieldCheckIcon size={14} color={info.color} />
          <strong style={{ fontSize: '0.78rem', color: '#0f172a', fontWeight: 800 }}>
            {info.shortTitle || info.title}
          </strong>
          <span
            style={{
              fontSize: '0.66rem',
              background: '#ffffff',
              color: info.color,
              border: `1px solid ${info.borderColor}`,
              padding: '2px 6px',
              borderRadius: '4px',
              fontWeight: 700,
            }}
          >
            {info.badge}
          </span>
        </div>
      </div>

      {/* Form Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <RequiredField label={storeNameLabel} error={form.formState.errors.storeName?.message}>
          <input
            className="purchase-prototype-field-input"
            placeholder={storeNamePlaceholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-lpignore="true"
            {...form.register('storeName')}
            disabled={disabled}
            style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          />
        </RequiredField>

        <div className="field">
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{t('settings.forms.tabs.general_settings_tab.s8', "نشاط المنشأة والقطاع الفعال")}</span>
            <span style={{ fontSize: '0.7rem', background: info.bg, color: info.color, border: `1px solid ${info.borderColor}`, padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
              {info.badge}
            </span>
          </label>
          <div style={{ padding: '8px 12px', borderRadius: '6px', background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '0.82rem', color: '#0f172a', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
            <span>{getIndustrySummary(form.watch('businessIndustry') || rawAct, isEn)}</span>
            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>{t('settings.forms.tabs.general_settings_tab.s9', "نمط معتمد ومثبت للمنشأة")}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div className="field">
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s10', "الهاتف")}</label>
            <input
              className="purchase-prototype-field-input"
              placeholder="010xxxxxxxx"
              autoComplete="off"
              autoCorrect="off"
              data-lpignore="true"
              {...form.register('phone')}
              disabled={disabled}
              style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
          </div>

          <div className="field">
            <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s11', "العنوان")}</label>
            <input
              className="purchase-prototype-field-input"
              placeholder={t('settings.forms.tabs.general_settings_tab.s12', "المدينة - الشارع")}
              autoComplete="off"
              autoCorrect="off"
              data-lpignore="true"
              {...form.register('address')}
              disabled={disabled}
              style={{ padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
          </div>
        </div>

        {/* Color Selection Inline */}
        <div className="field">
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px', display: 'block' }}>{t('settings.forms.tabs.general_settings_tab.s13', "لون الواجهة المخصص")}</label>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="color"
              value={accentColor}
              onChange={(e) => form.setValue('accentColor', e.target.value, { shouldDirty: true })}
              disabled={disabled}
              style={{ width: '38px', height: '36px', padding: '2px', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer' }}
            />
            <input
              type="text"
              placeholder="#170c5c"
              {...form.register('accentColor')}
              disabled={disabled}
              style={{ flex: 1, padding: '7px 10px', fontSize: '0.84rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontFamily: 'monospace', direction: 'ltr' }}
            />
            <button
              type="button"
              onClick={() => form.setValue('accentColor', '#170c5c', { shouldDirty: true })}
              disabled={disabled}
              style={{ padding: '7px 10px', fontSize: '0.75rem', fontWeight: 600, borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              {t('settings.forms.tabs.general_settings_tab.s14', "الافتراضي")}
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
