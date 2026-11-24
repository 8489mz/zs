import { Button } from '@/shared/ui/button';
import { SmartphoneIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { NavigateFunction } from 'react-router-dom';

export interface EmployeeSelfServiceHeaderProps {
  __t: ReturnType<typeof useTranslation>['t'];
  navigate: NavigateFunction;
}
export function EmployeeSelfServiceHeader({ __t, navigate }: EmployeeSelfServiceHeaderProps) {
  return (
    <>
    {/* Header Info Banner */}
    <div
      style={{
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '14px 18px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: '#eff6ff',
            color: '#170e5e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SmartphoneIcon size={22} color="#170e5e" />
        </div>
        <div>
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            {__t('settings.user_management.unified_access_directory_panel.s44', "إدارة وصول موظفي الخدمة الذاتية وبصمة الموبايل")}
          </h4>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {__t('settings.user_management.unified_access_directory_panel.s45', "تعيين وتغيير رموز الـ PIN السريعة لبصمة الموبايل الذكية (GPS) وبوابة الموظف الذاتية (ESS).")}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button
          variant="secondary"
          style={{ fontSize: '12px', padding: '6px 12px' }}
          onClick={() => navigate('/hr/employees')}
        >
          {__t('settings.user_management.unified_access_directory_panel.s46', "سجل الموظفين في الموارد البشرية ↗")}
        </Button>
      </div>
    </div>
    </>
  );
}
