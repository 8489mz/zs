import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
} from '@/shared/components/icons/AppIcons';
import type { FleetVehicle, FleetMaintenanceAlert } from '../../api/van-sales.api';

export interface FleetAlertsGridProps {
  allAlerts: FleetMaintenanceAlert[];
  vehicles: FleetVehicle[];
  setMaintenanceVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
}

export function FleetAlertsGrid({
  allAlerts,
  vehicles,
  setMaintenanceVehicle,
  setIsMaintenanceOpen,
}: FleetAlertsGridProps) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangleIcon size={18} color="#dc2626" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.fleet_vehicles_tab.s31', "تنبيهات الصيانة الوقائية النشطة لأسطول الشركة (")}{allAlerts.length})
            </h3>
            <span style={{ fontSize: '11.5px', color: '#64748b' }}>
              {t('delivery_reps.fleet_vehicles_tab.s32', "التنبيهات المجدولة لغيارات الزيت المستحقة، اقتراب انتهاء التراخيص، والفحص الدوري")}
            </span>
          </div>
        </div>
      </div>

      {allAlerts.length === 0 ? (
        <div
          style={{
            background: '#ecfdf5',
            border: '1px solid #d1fae5',
            borderRadius: '8px',
            padding: '14px 18px',
            color: '#065f46',
            fontSize: '12.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircleIcon size={16} color="#059669" />
          <span>{t('delivery_reps.fleet_vehicles_tab.s33', "حالة أسطول الشركة ممتازة: لا توجد أي تنبيهات صيانة متأخرة أو رخص منتهية حالياً.")}</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '10px' }}>
          {allAlerts.map((alt) => {
            const targetVeh = vehicles.find((v) => v.id === alt.vehicleId);
            return (
              <div
                key={alt.id}
                style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  border: `1px solid ${alt.severity === 'critical' ? '#fca5a5' : '#fed7aa'}`,
                  background: alt.severity === 'critical' ? '#fef2f2' : '#fffbeb',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '13px' }}>
                    {alt.plateNumber}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '6px',
                      background: alt.severity === 'critical' ? '#dc2626' : '#ea580c',
                      color: '#ffffff',
                    }}
                  >
                    {alt.severity === 'critical' ? t('delivery_reps.fleet_vehicles_tab.s34', "عاجل جداً") : t('delivery_reps.fleet_vehicles_tab.s35', "تنبيه موعد")}
                  </span>
                </div>
                <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>{alt.title}</div>
                <div style={{ fontSize: '11.5px', color: '#64748b' }}>{alt.description}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (targetVeh) {
                        setMaintenanceVehicle(targetVeh);
                        setIsMaintenanceOpen(true);
                      }
                    }}
                    style={{ fontSize: '11.5px', padding: '3px 8px', background: '#ffffff' }}
                  >
                    {t('delivery_reps.fleet_vehicles_tab.s36', "تنفيذ الصيانة الآن ←")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
