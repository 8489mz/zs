import { RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { DemoActivitySummary } from '@/features/settings/api/demo-data.api';

export interface SettingsDemoDataWizardLoadingProps {
  seedMutation: { isPending: boolean };
  t: ReturnType<typeof useTranslation>['t'];
  selectedActivity: DemoActivitySummary;
  selectedActivityKey: string;
}

export function SettingsDemoDataWizardLoading(props: SettingsDemoDataWizardLoadingProps) {
  const { seedMutation, t, selectedActivity, selectedActivityKey } = props;
  return (
    <>
    {/* ─── Modal: Full-screen Loading Overlay during seeding ────────────────── */}
    {seedMutation.isPending && (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            borderRadius: '18px',
            padding: '36px 28px',
            maxWidth: '460px',
            width: '100%',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: '#ede9fe',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RefreshCwIcon size={32} color="#170e5e" className="animate-spin" />
          </div>
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s33', "جاري تجهيز وسكب البيانات التجريبية...")}
          </h3>
          <p style={{ margin: 0, fontSize: '0.88rem', color: '#64748b', lineHeight: 1.6 }}>
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s34', "يتم الآن إنشاء الأصناف، الباركودات، فواتير المبيعات، وحركات الخزينة لنشاط (")}{selectedActivity?.name || selectedActivityKey}).
            <br />
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s35', "يرجى الانتظار ثوانٍ معدودة...")}
          </p>
        </div>
      </div>
    )}
    </>
  );
}
