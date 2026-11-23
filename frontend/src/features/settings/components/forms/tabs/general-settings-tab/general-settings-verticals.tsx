import type { useTranslation } from 'react-i18next';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';

export interface GeneralSettingsVerticalsProps {
  isContractingVertical: boolean;
  isMaritimeVertical: boolean;
  isManufacturingVertical: boolean;
  isWholesaleVertical: boolean;
  isWarehousingVertical: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
  disabled: boolean;
}

export function GeneralSettingsVerticals({ isContractingVertical, isMaritimeVertical, isManufacturingVertical, isWholesaleVertical, isWarehousingVertical, t, form, disabled }: GeneralSettingsVerticalsProps) {
  return (
    <>
    {/* Card: نمط تشغيل المنشأة ونطاق العمل (Facility Operation Mode) */}
    {!isContractingVertical && !isMaritimeVertical && !isManufacturingVertical && !isWholesaleVertical && !isWarehousingVertical && (
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '16px 20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <strong style={{ fontSize: '0.95rem', color: '#0f172a', fontWeight: 800, display: 'block' }}>
              {t('settings.forms.tabs.general_settings_tab.s45', "نمط تشغيل المنشأة ونطاق العمل (Operation Mode)")}
            </strong>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
              {t('settings.forms.tabs.general_settings_tab.s46', "اختر النمط المناسب لحجم نشاطك لضبط القوائم والواجهات؛ يتم تدوين القيود المحاسبية في الخلفية تلقائياً في كلا النمطين.")}
            </span>
          </div>
          <span style={{
            fontSize: '0.72rem',
            fontWeight: 800,
            background: form.watch('enableEnterpriseFeatures') ? '#eff6ff' : '#f0fdf4',
            color: form.watch('enableEnterpriseFeatures') ? '#1d4ed8' : '#166534',
            border: `1px solid ${form.watch('enableEnterpriseFeatures') ? '#bfdbfe' : '#bbf7d0'}`,
            padding: '3px 10px',
            borderRadius: '6px',
          }}>
            {form.watch('enableEnterpriseFeatures') ? t('settings.forms.tabs.general_settings_tab.s47', "النمط المؤسسي المتقدم") : t('settings.forms.tabs.general_settings_tab.s48', "النمط التجاري المبسط")}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
          {/* Option 1: Simple Retail Mode */}
          <div
            onClick={() => {
              if (disabled) return;
              form.setValue('enableEnterpriseFeatures', false, { shouldDirty: true, shouldValidate: true });
            }}
            style={{
              border: !form.watch('enableEnterpriseFeatures') ? '2px solid #170e5e' : '1px solid #e2e8f0',
              background: !form.watch('enableEnterpriseFeatures') ? '#f8fafc' : '#ffffff',
              borderRadius: '10px',
              padding: '14px 16px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: !form.watch('enableEnterpriseFeatures') ? '5px solid #170e5e' : '2px solid #cbd5e1',
                  boxSizing: 'border-box',
                  display: 'inline-block',
                  flexShrink: 0,
                }} />
                <strong style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: 800 }}>
                  {t('settings.forms.tabs.general_settings_tab.s49', "محل تجاري ونقاط بيع مبسطة (Simple Retail)")}
                </strong>
              </div>
              <span style={{ fontSize: '0.7rem', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                {t('settings.forms.tabs.general_settings_tab.s50', "موصى به للمحلات")}
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
              {t('settings.forms.tabs.general_settings_tab.s51', "واجهة رشيقة وسريعة للكاشير ونقاط البيع والفواتير المباشرة والمخزون، مع الخزينة والمصروفات اليومية. تخفي الشيكات والبنوك وقيود اليومية وأوامر الشراء والأرفف لمنع التشتيت وسرعة الإنجاز.")}
            </p>
          </div>

          {/* Option 2: Enterprise Trading Mode */}
          <div
            onClick={() => {
              if (disabled) return;
              form.setValue('enableEnterpriseFeatures', true, { shouldDirty: true, shouldValidate: true });
            }}
            style={{
              border: form.watch('enableEnterpriseFeatures') ? '2px solid #170e5e' : '1px solid #e2e8f0',
              background: form.watch('enableEnterpriseFeatures') ? '#f8fafc' : '#ffffff',
              borderRadius: '10px',
              padding: '14px 16px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: form.watch('enableEnterpriseFeatures') ? '5px solid #170e5e' : '2px solid #cbd5e1',
                  boxSizing: 'border-box',
                  display: 'inline-block',
                  flexShrink: 0,
                }} />
                <strong style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: 800 }}>
                  {t('settings.forms.tabs.general_settings_tab.s52', "مؤسسة تجارية متقدمة (Enterprise Trading)")}
                </strong>
              </div>
              <span style={{ fontSize: '0.7rem', background: '#eff6ff', color: '#1d4ed8', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                {t('settings.forms.tabs.general_settings_tab.s53', "محاسبة متقدمة")}
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
              {t('settings.forms.tabs.general_settings_tab.s54', "تفعيل الدورة المستندية الكاملة: أوامر الشراء والبيع، عروض الأسعار (RFQ)، شجرة المخازن والأرفف، المحاسبة العامة، شجرة الحسابات، قيود اليومية، حافظة الشيكات (PDC)، والتسويات البنكية ومراكز التكلفة.")}
            </p>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
