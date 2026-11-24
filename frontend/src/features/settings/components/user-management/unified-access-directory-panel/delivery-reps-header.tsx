import { Button } from '@/shared/ui/button';
import { TruckIcon } from '@/shared/components/icons/AppIcons';
import { useTranslation } from 'react-i18next';
import type { NavigateFunction } from 'react-router-dom';
import type { Dispatch, SetStateAction } from 'react';
import type { DeliveryRep } from '@/shared/api/delivery-reps.api';

export interface DeliveryRepsHeaderProps {
  __t: ReturnType<typeof useTranslation>['t'];
  setUpsertRep: Dispatch<SetStateAction<DeliveryRep | null>>;
  setIsUpsertOpen: Dispatch<SetStateAction<boolean>>;
  navigate: NavigateFunction;
}
export function DeliveryRepsHeader({ __t, setUpsertRep, setIsUpsertOpen, navigate }: DeliveryRepsHeaderProps) {
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
            background: '#fff7ed',
            color: '#ea580c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <TruckIcon size={22} color="#ea580c" />
        </div>
        <div>
          <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            {__t('settings.user_management.unified_access_directory_panel.s0', "إدارة وصول طياري الدليفري وموزعي الفان")}
          </h4>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {__t('settings.user_management.unified_access_directory_panel.s1', "تعديل أرقام الهواتف، رموز الدخول السريع (PIN)، وتجميد الحسابات الميدانية فوراً.")}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button
          variant="primary"
          style={{ fontSize: '12px', padding: '6px 14px', background: '#170e5e', color: '#ffffff' }}
          onClick={() => {
            setUpsertRep(null);
            setIsUpsertOpen(true);
          }}
        >
          {__t('settings.user_management.unified_access_directory_panel.s2', "+ إضافة مندوب جديد")}
        </Button>
        <Button
          variant="secondary"
          style={{ fontSize: '12px', padding: '6px 12px' }}
          onClick={() => navigate('/delivery-reps')}
        >
          {__t('settings.user_management.unified_access_directory_panel.s3', "فتح إدارة المناديب الكاملة ↗")}
        </Button>
      </div>
    </div>
    </>
  );
}
