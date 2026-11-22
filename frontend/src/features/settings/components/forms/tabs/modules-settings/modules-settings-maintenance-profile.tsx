import { useTranslation } from 'react-i18next';
import { ProfileVectorIcon } from './modules-settings-icons';
import { ChevronDownIcon } from '@/shared/components/icons/AppIcons';
import type { UseFormReturn } from 'react-hook-form';
import type { SettingsFormInput, SettingsFormOutput } from '@/features/settings/schemas/settings.schema';
import type { MaintenanceProfileInfo } from '@/features/maintenance/constants/maintenance-profiles';
import type { Dispatch, SetStateAction } from 'react';

interface ModulesSettingsMaintenanceProfileProps {
  currentProfile: MaintenanceProfileInfo;
  setProfileModalOpen: Dispatch<SetStateAction<boolean>>;
  disabled: boolean;
  form: UseFormReturn<SettingsFormInput, undefined, SettingsFormOutput>;
}

export function ModulesSettingsMaintenanceProfile({ currentProfile, setProfileModalOpen, disabled, form }: ModulesSettingsMaintenanceProfileProps) {
  const { t } = useTranslation();
  return (
    <div style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px', marginTop: 18, boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: '10px',
            background: '#eff6ff',
            border: '1.5px solid #bfdbfe',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2563eb',
            boxShadow: '0 2px 8px rgba(37, 99, 235, 0.08)'
          }}>
            <ProfileVectorIcon type={currentProfile.iconType} size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ fontWeight: 800, fontSize: '0.96rem', color: '#0f172a' }}>{currentProfile.title}</div>
              <span style={{ fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: '12px', fontWeight: 800 }}>{t('settings.forms.tabs.modules_settings_tab.s162', "نشط الآن")}</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>{currentProfile.subtitle}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setProfileModalOpen(true)}
          disabled={disabled}
          style={{
            background: '#ffffff',
            border: '1.5px solid #cbd5e1',
            borderRadius: '8px',
            padding: '7px 16px',
            fontSize: '0.82rem',
            fontWeight: 800,
            color: '#1e40af',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'all 0.15s ease'
          }}
        >
          <span>{t('settings.forms.tabs.modules_settings_tab.s163', "تغيير نشاط الصيانة والقالب")}</span>
          <ChevronDownIcon size={14} color="#64748b" />
        </button>
      </div>

      <div className="document-prototype-grid compact-grid-2">
        <div className="field">
          <label style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px', display: 'block', fontSize: '0.82rem' }}>
            {t('settings.forms.tabs.modules_settings_tab.s164', "نسبة عمولة فني الصيانة من صافي المصنعية (%)")}
          </label>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            className="purchase-prototype-field-input"
            {...form.register('technicianCommissionRate')}
            disabled={disabled}
            placeholder="30"
            style={{ fontWeight: 700, background: '#ffffff' }}
          />
          <small className="muted">{t('settings.forms.tabs.modules_settings_tab.s165', "تُحسب العمولة تلقائيًا كنسبة مئوية من صافي ربح المصنعية بعد خصم سعر قطع الغيار.")}</small>
        </div>

        <div className="field">
          <label style={{ fontWeight: 700, color: '#0f172a', marginBottom: '4px', display: 'block', fontSize: '0.82rem' }}>
            {t('settings.forms.tabs.modules_settings_tab.s166', "الملحقات الافتراضية للفحص والاستلام السريع")}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
            {currentProfile.defaultAccessories.map((acc) => (
              <span key={acc} style={{ background: '#ffffff', border: '1px solid #cbd5e1', padding: '3px 9px', borderRadius: '6px', fontSize: '0.74rem', color: '#334155', fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                + {acc}
              </span>
            ))}
          </div>
          <small className="muted">{t('settings.forms.tabs.modules_settings_tab.s167', "تظهر هذه الملحقات كأزرار سريعة بضغطة زر داخل شاشة تذاكر الصيانة.")}</small>
        </div>
      </div>
    </div>
  );
}
