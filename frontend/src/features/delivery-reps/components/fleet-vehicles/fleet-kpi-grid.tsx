import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import type { FleetMaintenanceAlert } from '../../api/van-sales.api';

export interface FleetKpiGridProps {
  setVehicleStatusFilter: Dispatch<SetStateAction<'all' | 'available' | 'assigned' | 'maintenance'>>;
  vehicleStatusFilter: 'all' | 'available' | 'assigned' | 'maintenance';
  totalVehiclesCount: number;
  assignedVehiclesCount: number;
  availableVehiclesCount: number;
  allAlerts: FleetMaintenanceAlert[];
  maintenanceVehiclesCount: number;
}

export function FleetKpiGrid({
  setVehicleStatusFilter,
  vehicleStatusFilter,
  totalVehiclesCount,
  assignedVehiclesCount,
  availableVehiclesCount,
  allAlerts,
  maintenanceVehiclesCount,
}: FleetKpiGridProps) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
      <div
        onClick={() => setVehicleStatusFilter('all')}
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '16px',
          border: vehicleStatusFilter === 'all' ? '2px solid #170e5e' : '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', display: 'block' }}>{t('delivery_reps.fleet_vehicles_tab.s0', "إجمالي أسطول الشركة")}</span>
        <span style={{ fontSize: '22px', fontWeight: 800, color: '#0f172a', display: 'block', marginTop: '4px' }}>
          {totalVehiclesCount} <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>{t('delivery_reps.fleet_vehicles_tab.s1', "مركبة")}</span>
        </span>
      </div>

      <div
        onClick={() => setVehicleStatusFilter('assigned')}
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '16px',
          border: vehicleStatusFilter === 'assigned' ? '2px solid #0284c7' : '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#0284c7', display: 'block' }}>{t('delivery_reps.fleet_vehicles_tab.s2', "مركبات مسندة بسائق")}</span>
        <span style={{ fontSize: '22px', fontWeight: 800, color: '#0369a1', display: 'block', marginTop: '4px' }}>
          {assignedVehiclesCount} <span style={{ fontSize: '12px', color: '#7dd3fc', fontWeight: 600 }}>{t('delivery_reps.fleet_vehicles_tab.s3', "في الخدمة")}</span>
        </span>
      </div>

      <div
        onClick={() => setVehicleStatusFilter('available')}
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '16px',
          border: vehicleStatusFilter === 'available' ? '2px solid #16a34a' : '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#16a34a', display: 'block' }}>{t('delivery_reps.fleet_vehicles_tab.s4', "مركبات متاحة للتشغيل")}</span>
        <span style={{ fontSize: '22px', fontWeight: 800, color: '#15803d', display: 'block', marginTop: '4px' }}>
          {availableVehiclesCount} <span style={{ fontSize: '12px', color: '#86efac', fontWeight: 600 }}>{t('delivery_reps.fleet_vehicles_tab.s5', "جاهزة")}</span>
        </span>
      </div>

      <div
        onClick={() => setVehicleStatusFilter('maintenance')}
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '16px',
          border: vehicleStatusFilter === 'maintenance' ? '2px solid #ea580c' : '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#ea580c', display: 'block' }}>{t('delivery_reps.fleet_vehicles_tab.s6', "تحت الصيانة والإصلاح")}</span>
          {allAlerts.length > 0 && (
            <span style={{ fontSize: '10.5px', background: '#fee2e2', color: '#dc2626', fontWeight: 800, padding: '1px 6px', borderRadius: '10px' }}>
              {allAlerts.length} {t('delivery_reps.fleet_vehicles_tab.s7', "تنبيه")}
            </span>
          )}
        </div>
        <span style={{ fontSize: '22px', fontWeight: 800, color: '#c2410c', display: 'block', marginTop: '4px' }}>
          {maintenanceVehiclesCount} <span style={{ fontSize: '12px', color: '#fdba74', fontWeight: 600 }}>{t('delivery_reps.fleet_vehicles_tab.s8', "بالورشة")}</span>
        </span>
      </div>
    </div>
  );
}
