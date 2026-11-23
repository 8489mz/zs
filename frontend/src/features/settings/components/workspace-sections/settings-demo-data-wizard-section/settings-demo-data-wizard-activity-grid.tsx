import { RefreshCwIcon } from '@/shared/components/icons/AppIcons';
import type { useTranslation } from 'react-i18next';
import type { DemoActivitySummary } from '@/features/settings/api/demo-data.api';
import { getActivityIcon } from './demo-data-activity-icon';

export interface SettingsDemoDataWizardActivityGridProps {
  t: ReturnType<typeof useTranslation>['t'];
  activitiesQuery: { isLoading: boolean };
  activities: DemoActivitySummary[];
  selectedActivityKey: string;
  setSelectedActivityKey: React.Dispatch<React.SetStateAction<string>>;
}

export function SettingsDemoDataWizardActivityGrid(props: SettingsDemoDataWizardActivityGridProps) {
  const { t, activitiesQuery, activities, selectedActivityKey, setSelectedActivityKey } = props;
  return (
    <>
    {/* ─── Activity Selection Grid ────────────────────────────────────────────── */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
          {t('settings.workspace_sections.settings_demo_data_wizard_section.s12', "1. اختر مجال نشاطك التجاري:")}
        </h3>
        <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
          {t('settings.workspace_sections.settings_demo_data_wizard_section.s13', "5 باقات متكاملة معدة مسبقاً بأدق التفاصيل والأسعار والباركودات")}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(200px, 1fr))',
          gap: '12px',
          width: '100%',
          overflowX: 'auto',
          paddingBottom: '4px',
        }}
      >
        {activitiesQuery.isLoading && (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '0.9rem', gridColumn: '1 / -1' }}>
            <RefreshCwIcon size={20} className="animate-spin" style={{ margin: '0 auto 8px', display: 'block' }} />
            <span>{t('settings.workspace_sections.settings_demo_data_wizard_section.s14', "جاري تحميل باقات الأنشطة التجارية...")}</span>
          </div>
        )}

        {activities.map((act) => {
          const isSelected = act.key === selectedActivityKey;

          return (
            <div
              key={act.key}
              onClick={() => setSelectedActivityKey(act.key)}
              style={{
                background: isSelected ? '#faf9ff' : '#ffffff',
                border: `1.5px solid ${isSelected ? '#170e5e' : '#e2e8f0'}`,
                borderRadius: '14px',
                padding: '16px 14px',
                cursor: 'pointer',
                boxShadow: isSelected ? '0 4px 16px rgba(23, 14, 94, 0.08)' : '0 1px 3px rgba(0, 0, 0, 0.03)',
                transition: 'background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                userSelect: 'none',
                boxSizing: 'border-box',
              }}
            >
              {/* Header row: Radio (Right), Title & Tagline (Center), Icon (Left) */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                {/* Selection Radio Circle */}
                <div
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: `2px solid ${isSelected ? '#170e5e' : '#cbd5e1'}`,
                    background: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    boxSizing: 'border-box',
                    marginTop: '3px',
                    transition: 'border-color 0.15s ease',
                  }}
                >
                  {isSelected && (
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#170e5e',
                      }}
                    />
                  )}
                </div>

                {/* Title & Tagline */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4
                    style={{
                      margin: 0,
                      fontSize: '0.9rem',
                      fontWeight: 800,
                      color: isSelected ? '#170e5e' : '#0f172a',
                      lineHeight: 1.3,
                      transition: 'color 0.15s ease',
                    }}
                  >
                    {act.name}
                  </h4>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      color: '#64748b',
                      display: 'block',
                      marginTop: '3px',
                      lineHeight: 1.35,
                    }}
                  >
                    {act.tagline}
                  </span>
                </div>

                {/* Activity Icon */}
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: isSelected ? '#ede9fe' : '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${isSelected ? '#c4b5fd' : '#e2e8f0'}`,
                    flexShrink: 0,
                    transition: 'background-color 0.15s ease, border-color 0.15s ease',
                  }}
                >
                  {getActivityIcon(act.key, isSelected, 18)}
                </div>
              </div>

              {/* Description */}
              <p
                style={{
                  margin: 0,
                  fontSize: '0.76rem',
                  color: '#475569',
                  lineHeight: 1.45,
                  flex: 1,
                }}
              >
                {act.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
    </>
  );
}
