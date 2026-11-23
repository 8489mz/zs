import { PackageIcon, ReceiptIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { DemoDataStatusResponse } from '@/features/settings/api/demo-data.api';

export interface SettingsDemoDataWizardHeroProps {
  t: ReturnType<typeof useTranslation>['t'];
  statusQuery: { isLoading: boolean };
  status: DemoDataStatusResponse | undefined;
}

export function SettingsDemoDataWizardHero(props: SettingsDemoDataWizardHeroProps) {
  const { t, statusQuery, status } = props;
  return (
    <>
    {/* ─── Hero Overview Card ─────────────────────────────────────────────────── */}
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
      }}
    >
      <div style={{ flex: '1 1 400px' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
          {t('settings.workspace_sections.settings_demo_data_wizard_section.s6', "معالج استيراد البيانات التجريبية حسب النشاط (Demo Wizard)")}
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.88rem', color: '#64748b', lineHeight: 1.5 }}>
          {t('settings.workspace_sections.settings_demo_data_wizard_section.s7', "اختر تخصص نشاطك التجاري لملء النظام فورياً بـ ~50 صنفاً وفواتير كاشير وموردين وحركات مبيعات حقيقية في 5 ثوانٍ، لترى كافة لوحات التحكم والتقارير نابضة بالحياة.")}
        </p>
      </div>

      {/* Status Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {statusQuery.isLoading ? (
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{t('settings.workspace_sections.settings_demo_data_wizard_section.s8', "جاري فحص حالة النظام...")}</span>
        ) : status?.isEmpty ? (
          <div
            style={{
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#065f46',
              borderRadius: '10px',
              padding: '8px 14px',
              fontSize: '0.84rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s9', "النظام فارغ (جاهز للاستيراد الفوري بنقرة واحدة)")}
          </div>
        ) : (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#334155',
              borderRadius: '10px',
              padding: '8px 14px',
              fontSize: '0.84rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <PackageIcon size={14} />
              <span>{status?.productCount || 0} {t('settings.workspace_sections.settings_demo_data_wizard_section.s10', "صنف مسجل")}</span>
            </span>
            <span style={{ color: '#cbd5e1' }}>|</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <ReceiptIcon size={14} />
              <span>{status?.saleCount || 0} {t('settings.workspace_sections.settings_demo_data_wizard_section.s11', "فاتورة")}</span>
            </span>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
