import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { SlidersIcon } from '@/shared/components/icons/AppIcons';
import type { VanAdminTabKey } from './van-admin-types';
import type { DeliveryRep } from '../../hooks/useVanSalesAdmin';

export interface AdminHeaderProps {
  activeTab: VanAdminTabKey;
  setEditingRep: Dispatch<SetStateAction<DeliveryRep | null>>;
  setIsSettingsModalOpen: Dispatch<SetStateAction<boolean>>;
  setIsUpsertRepOpen: Dispatch<SetStateAction<boolean>>;
}

export function AdminHeader({
  activeTab,
  setEditingRep,
  setIsSettingsModalOpen,
  setIsUpsertRepOpen,
}: AdminHeaderProps) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t('delivery_reps.van_sales_admin_management_page.s0', "مركز إدارة سيارات التوزيع وأسطول الفان (Van Sales & Fleet)")}
      description={t('delivery_reps.van_sales_admin_management_page.s1', "المنظومة المؤسسية لإدارة سيارات التوزيع، ورديات البيع الميداني، وجرد المستودعات المتنقلة")}
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Button
            variant="secondary"
            onClick={() => setIsSettingsModalOpen(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 700,
              fontSize: '12.5px',
              backgroundColor: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#1e293b',
            }}
          >
            <SlidersIcon size={15} color="#170e5e" />
            {t('delivery_reps.van_sales_admin_management_page.s2', "إعدادات التصفية والرقابة")}
          </Button>
          {activeTab === 'drivers' && (
            <Button
              variant="primary"
              style={{ background: '#170e5e', color: '#ffffff', fontWeight: 700, fontSize: '13px' }}
              onClick={() => {
                setEditingRep(null);
                setIsUpsertRepOpen(true);
              }}
            >
              {t('delivery_reps.van_sales_admin_management_page.s3', "+ إضافة مندوب فان جديد")}
            </Button>
          )}
        </div>
      }
    />
  );
}
