import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import {
  ToolIcon,
  PlusIcon,
  CheckCircleIcon,
} from '@/shared/components/icons/AppIcons';
import type { FleetVehicle } from '../../api/van-sales.api';

export interface FleetWorkshopTableProps {
  maintenanceVehiclesCount: number;
  setSendToMaintenanceVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsSendToMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
  vehicles: FleetVehicle[];
  setCompleteMaintenanceVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsCompleteMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
  setMaintenanceVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
}

export function FleetWorkshopTable({
  maintenanceVehiclesCount,
  setSendToMaintenanceVehicle,
  setIsSendToMaintenanceOpen,
  vehicles,
  setCompleteMaintenanceVehicle,
  setIsCompleteMaintenanceOpen,
  setMaintenanceVehicle,
  setIsMaintenanceOpen,
}: FleetWorkshopTableProps) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ToolIcon size={18} color="#ea580c" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
              {t('delivery_reps.fleet_vehicles_tab.s15', "المركبات تحت الصيانة والإصلاح بالورشة حالياً (")}{maintenanceVehiclesCount})
            </h3>
            <span style={{ fontSize: '11.5px', color: '#64748b' }}>
              {t('delivery_reps.fleet_vehicles_tab.s16', "السيارات المحولة للورش ومسجل لها أعمال فحص أو إصلاح ومستبعدة مؤقتاً من خطوط التوزيع")}
            </span>
          </div>
        </div>

        <Button
          variant="primary"
          onClick={() => {
            setSendToMaintenanceVehicle(null);
            setIsSendToMaintenanceOpen(true);
          }}
          style={{ background: '#ea580c', color: '#ffffff', fontWeight: 700, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <PlusIcon size={13} />
          {t('delivery_reps.fleet_vehicles_tab.s17', "+ إدخال سيارة للصيانة")}
        </Button>
      </div>

      {maintenanceVehiclesCount === 0 ? (
        <div
          style={{
            background: '#f8fafc',
            border: '1px dashed #cbd5e1',
            borderRadius: '10px',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '13.5px', marginBottom: '4px' }}>
            {t('delivery_reps.fleet_vehicles_tab.s18', "جميع سيارات أسطول الشركة جاهزة للتشغيل وفي الخدمة")}
          </div>
          <div style={{ color: '#64748b', fontSize: '12px', marginBottom: '12px' }}>
            {t('delivery_reps.fleet_vehicles_tab.s19', "لا توجد أي مركبات متوقفة بالورشة حالياً. يمكنك إدخال أي مركبة تحتاج صيانة أو إصلاح مباشرة من الزر أعلاه.")}
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: '#fff7ed', borderBottom: '1px solid #ffedd5', color: '#9a3412' }}>
                <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s20', "لوحة المركبة والطراز")}</th>
                <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s21', "السائق المسند")}</th>
                <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s22', "قراءة العداد")}</th>
                <th style={{ padding: '8px 12px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s23', "بيان العطل والورشة")}</th>
                <th style={{ padding: '8px 12px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.fleet_vehicles_tab.s24', "الإجراءات")}</th>
              </tr>
            </thead>
            <tbody>
              {vehicles
                .filter((v) => v.status === 'maintenance')
                .map((v) => (
                  <tr key={v.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 800, color: '#0f172a' }}>
                      <div>{v.plateNumber}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{v.modelName || t('delivery_reps.fleet_vehicles_tab.s25', "بدون موديل")}</div>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#334155' }}>
                      {v.assignedRepName || t('delivery_reps.fleet_vehicles_tab.s26', "-- بدون سائق --")}
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 700 }}>
                      {Number(v.currentOdometer || 0).toLocaleString()} {t('delivery_reps.fleet_vehicles_tab.s27', "كم")}
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '11.5px', color: '#475569' }}>
                      {v.notes || t('delivery_reps.fleet_vehicles_tab.s28', "تحت الصيانة والإصلاح بالورشة")}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <Button
                          variant="primary"
                          onClick={() => {
                            setCompleteMaintenanceVehicle(v);
                            setIsCompleteMaintenanceOpen(true);
                          }}
                          style={{
                            background: '#15803d',
                            color: '#ffffff',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            padding: '4px 10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <CheckCircleIcon size={13} />
                          {t('delivery_reps.fleet_vehicles_tab.s29', "إتمام الصيانة وإعادة للخدمة")}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setMaintenanceVehicle(v);
                            setIsMaintenanceOpen(true);
                          }}
                          style={{ fontSize: '11.5px', padding: '4px 8px' }}
                        >
                          {t('delivery_reps.fleet_vehicles_tab.s30', "الوقود والصيانة")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
