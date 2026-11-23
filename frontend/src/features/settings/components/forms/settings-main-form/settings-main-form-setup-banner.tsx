import { CompassIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { useNavigate } from 'react-router-dom';

export interface SettingsMainFormSetupBannerProps {
  setupMode: boolean;
  __t: ReturnType<typeof useTranslation>['t'];
  onSetupAdvance?: () => void;
  navigate: ReturnType<typeof useNavigate>;
}

export function SettingsMainFormSetupBanner(props: SettingsMainFormSetupBannerProps) {
  const { setupMode, __t, onSetupAdvance, navigate } = props;
  return (
    <>
    {/* شريط دليل الإعداد السريع لتشغيل المنشأة */}
    {setupMode && (
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderInlineStart: '4px solid #170e5e',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: '#ede9fe',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#170e5e',
              flexShrink: 0,
            }}
          >
            <CompassIcon size={20} color="#170e5e" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '0.96rem', color: '#0f172a' }}>
                {__t('settings.forms.settings_main_form.s0', "دليل التجهيز السريع — الخطوة 1 من 3: بيانات المنشأة وترويسة الفواتير")}
              </strong>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  background: '#eff6ff',
                  color: '#1d4ed8',
                  border: '1px solid #bfdbfe',
                  padding: '2px 8px',
                  borderRadius: '6px',
                }}
              >
                {__t('settings.forms.settings_main_form.s1', "الخطوة 1 من 3")}
              </span>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '0.83rem', color: '#64748b' }}>
              {__t('settings.forms.settings_main_form.s2', "أدخل اسم المتجر، الهاتف، والعنوان. بعد النقر على \"حفظ الإعدادات\" سيتم نقلك تلقائياً للخطوة 2 (تجهيز الأصناف والبيانات التجريبية).")}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => onSetupAdvance ? onSetupAdvance() : navigate('/settings/demo-data?setup=quickstart')}
            style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              padding: '7px 14px',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#334155',
              cursor: 'pointer',
            }}
          >
            {__t('settings.forms.settings_main_form.s3', "المتابعة للخطوة 2")}
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '7px 10px',
              fontSize: '0.82rem',
              color: '#64748b',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {__t('settings.forms.settings_main_form.s4', "العودة للرئيسية")}
          </button>
        </div>
      </div>
    )}
    </>
  );
}
