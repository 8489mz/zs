import { useTranslation } from 'react-i18next';
import { ShipIcon, PlusCircleIcon, FileTextIcon, FileCheckIcon, DollarSignIcon } from '@/shared/components/icons/AppIcons';
import type { Dispatch, SetStateAction } from 'react';
import type { ActiveTab } from './maritime-portal-types';

export function MaritimePortalTabNav({ activeTab, setActiveTab }: { activeTab: ActiveTab; setActiveTab: Dispatch<SetStateAction<ActiveTab>> }) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #e2e8f0', padding: '6px', display: 'flex', gap: '6px', marginBottom: '20px', overflowX: 'auto' }}>
      {[
        { id: 'shipments', label: t('maritime_freight.maritime_customer_portal_page.s30', "الشحنات الجارية والتتبع التقديري"), icon: ShipIcon },
        { id: 'request_quote', label: t('maritime_freight.maritime_customer_portal_page.s31', "طلب تسعير جديد (RFQ)"), icon: PlusCircleIcon },
        { id: 'quotes', label: t('maritime_freight.maritime_customer_portal_page.s32', "عروض الأسعار والتعميد"), icon: FileTextIcon },
        { id: 'documents', label: t('maritime_freight.maritime_customer_portal_page.s33', "مركز المستندات والبوالص"), icon: FileCheckIcon },
        { id: 'statement', label: t('maritime_freight.maritime_customer_portal_page.s34', "كشف الحساب والمديونيات"), icon: DollarSignIcon },
      ].map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as ActiveTab)}
            style={{
              flex: 1,
              minWidth: '150px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '10px',
              border: isActive ? '1px solid #170e5e' : '1px solid transparent',
              background: isActive ? '#170e5e' : 'transparent',
              color: isActive ? '#ffffff' : '#475569',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
            }}
          >
            <Icon size={16} color={isActive ? '#ffffff' : '#64748b'} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
