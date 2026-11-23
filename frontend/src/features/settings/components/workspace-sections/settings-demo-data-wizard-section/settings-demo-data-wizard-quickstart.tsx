import { CompassIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { useNavigate } from 'react-router-dom';

export interface SettingsDemoDataWizardQuickstartProps {
  isQuickStart: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  navigate: ReturnType<typeof useNavigate>;
}

export function SettingsDemoDataWizardQuickstart(props: SettingsDemoDataWizardQuickstartProps) {
  const { isQuickStart, t, navigate } = props;
  return (
    <>
    {/* ─── QuickStart Setup Step 2 Banner ────────────────────────────────────── */}
    {isQuickStart && (
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderInlineStart: '4px solid #170e5e',
          borderRadius: '12px',
          padding: '16px 20px',
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
                {t('settings.workspace_sections.settings_demo_data_wizard_section.s0', "دليل التجهيز السريع — الخطوة 2 من 3: إضافة وتجهيز الأصناف في المخزون")}
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
                {t('settings.workspace_sections.settings_demo_data_wizard_section.s1', "الخطوة 2 من 3")}
              </span>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '0.83rem', color: '#64748b' }}>
              {t('settings.workspace_sections.settings_demo_data_wizard_section.s2', "اختر نشاطك التجاري واضغط استيراد لملء المخزن فورياً بـ 50 صنفاً وفواتير جاهزة، أو يمكنك إضافة أصناف يدوياً.")}
            </p>
          </div>

        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => navigate('/products')}
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
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s3', "إضافة أصناف يدوياً")}
          </button>
          <button
            type="button"
            onClick={() => navigate('/pos')}
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '7px 14px',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#475569',
              cursor: 'pointer',
            }}
          >
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s4', "تخطي للخطوة 3 (الكاشير)")}
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
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s5', "العودة للرئيسية")}
          </button>
        </div>
      </div>
    )}
    </>
  );
}
