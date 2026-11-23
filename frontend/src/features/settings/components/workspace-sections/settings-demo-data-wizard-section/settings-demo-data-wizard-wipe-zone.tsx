import { Trash2Icon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';

export interface SettingsDemoDataWizardWipeZoneProps {
  isPlatform: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  setShowClearModal: React.Dispatch<React.SetStateAction<boolean>>;
}

export function SettingsDemoDataWizardWipeZone(props: SettingsDemoDataWizardWipeZoneProps) {
  const { isPlatform, t, setShowClearModal } = props;
  return (
    <>
    {/* ─── Clean Demo Wipe & Safe Reset Zone (Super Admin only) ────────────────── */}
    {isPlatform && (
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '16px',
          padding: '22px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#0f172a' }}>
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s30', "تفريغ البيانات التجريبية وبدء العمل الفعلي (Clean Production Reset)")}
          </h4>
          <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b', maxWidth: '650px', lineHeight: 1.5 }}>
            {t('settings.workspace_sections.settings_demo_data_wizard_section.s31', "عند الانتهاء من تجربة وفحص النظام ورغبتك في بدء العمل الحقيقي، يمكنك مسح كافة الأصناف والفواتير التجريبية بأمان دون التأثير على إعداداتك أو مستخدميك.")}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowClearModal(true)}
          style={{
            background: '#fff1f2',
            color: '#be123c',
            border: '1px solid #fecdd3',
            borderRadius: '10px',
            padding: '10px 20px',
            fontWeight: 800,
            fontSize: '0.86rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#ffe4e6';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#fff1f2';
          }}
        >
          <Trash2Icon size={16} />
          <span>{t('settings.workspace_sections.settings_demo_data_wizard_section.s32', "تفريغ ومسح البيانات التجريبية فقط")}</span>
        </button>
      </div>
    )}
    </>
  );
}
