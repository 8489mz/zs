import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { InterVanTransferRecord, SupervisorCustomerRouteItem } from '../../api/van-sales.api';
import { TruckIcon, MapPinIcon, SlidersIcon } from '@/shared/components/icons/AppIcons';

export interface RoutesKpiSectionTabsProps {
  activeSection: 'transfers' | 'visits' | 'scheduling';
  setActiveSection: Dispatch<SetStateAction<'transfers' | 'visits' | 'scheduling'>>;
  transfers: InterVanTransferRecord[];
  fieldVisits: any[];
  customerRoutes: SupervisorCustomerRouteItem[];
}

export function RoutesKpiSectionTabs({
  activeSection,
  setActiveSection,
  transfers,
  fieldVisits,
  customerRoutes,
}: RoutesKpiSectionTabsProps) {
  const { t: __t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        background: '#ffffff',
        padding: '6px',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
      }}
    >
      <button
        type="button"
        onClick={() => setActiveSection('transfers')}
        style={{
          flex: 1,
          padding: '8px 12px',
          borderRadius: '6px',
          border: 'none',
          fontSize: '12.5px',
          fontWeight: 600,
          cursor: 'pointer',
          background: activeSection === 'transfers' ? '#170e5e' : 'transparent',
          color: activeSection === 'transfers' ? '#ffffff' : '#475569',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
        }}
      >
        <TruckIcon size={14} />
        {__t('delivery_reps.van_routes_kpi_admin_tab.s28', __t('delivery_reps.van_routes_kpi_admin_tab.s28', "شريط مناقلات سيارات الشارع ("))}{transfers.length})
      </button>

      <button
        type="button"
        onClick={() => setActiveSection('visits')}
        style={{
          flex: 1,
          padding: '8px 12px',
          borderRadius: '6px',
          border: 'none',
          fontSize: '12.5px',
          fontWeight: 600,
          cursor: 'pointer',
          background: activeSection === 'visits' ? '#170e5e' : 'transparent',
          color: activeSection === 'visits' ? '#ffffff' : '#475569',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
        }}
      >
        <MapPinIcon size={14} />
        {__t('delivery_reps.van_routes_kpi_admin_tab.s29', __t('delivery_reps.van_routes_kpi_admin_tab.s29', "سجل الزيارات وأسباب الرفض ("))}{fieldVisits.length})
      </button>

      <button
        type="button"
        onClick={() => setActiveSection('scheduling')}
        style={{
          flex: 1,
          padding: '8px 12px',
          borderRadius: '6px',
          border: 'none',
          fontSize: '12.5px',
          fontWeight: 600,
          cursor: 'pointer',
          background: activeSection === 'scheduling' ? '#170e5e' : 'transparent',
          color: activeSection === 'scheduling' ? '#ffffff' : '#475569',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
        }}
      >
        <SlidersIcon size={14} />
        {__t('delivery_reps.van_routes_kpi_admin_tab.s30', __t('delivery_reps.van_routes_kpi_admin_tab.s30', "تخصيص خطوط السير والمناديب ("))}{customerRoutes.length})
      </button>
    </div>
  );
}
