import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import type { FleetOilChangeRecord, FleetVehicle } from '../../api/van-sales.api';

export interface FleetOilLedgerProps {
  allOilChanges: FleetOilChangeRecord[];
  vehicles: FleetVehicle[];
  setMaintenanceVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
  isOilLoading: boolean;
}

export function FleetOilLedger({
  allOilChanges,
  vehicles,
  setMaintenanceVehicle,
  setIsMaintenanceOpen,
  isOilLoading,
}: FleetOilLedgerProps) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.fleet_vehicles_tab.s37', "سجل غيارات الزيت الدورية للأسطول (")}{allOilChanges.length})
          </h3>
          <span style={{ fontSize: '11.5px', color: '#64748b' }}>
            {t('delivery_reps.fleet_vehicles_tab.s38', "بيان بكافة غيارات الزيت المنفذة لجميع سيارات الشركة ومواعيد الغيار القادم")}
          </span>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            const firstVeh = vehicles[0];
            if (firstVeh) {
              setMaintenanceVehicle(firstVeh);
              setIsMaintenanceOpen(true);
            }
          }}
          style={{ background: '#16a34a', color: '#ffffff', fontWeight: 700, fontSize: '12px' }}
        >
          {t('delivery_reps.fleet_vehicles_tab.s39', "+ تسجيل غيار زيت لسيارة")}
        </Button>
      </div>

      {isOilLoading ? (
        <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>{t('delivery_reps.fleet_vehicles_tab.s40', "جاري تحميل غيارات الزيت...")}</div>
      ) : allOilChanges.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '12.5px' }}>
          {t('delivery_reps.fleet_vehicles_tab.s41', "لا توجد غيارات زيت مسجلة لأسطول الشركة حتى الآن.")}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s42', "لوحة المركبة")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s43', "نوع ومواصفة الزيت")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s44', "العداد عند التغيير")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s45', "الفلتر")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s46', "تنبيه قبل")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s47', "الغيّار القادم عند")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s48', "مركز الصيانة")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s49', "التكلفة")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.fleet_vehicles_tab.s50', "الحالة")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s51', "التاريخ")}</th>
              </tr>
            </thead>
            <tbody>
              {allOilChanges.map((oc: any) => (
                <tr key={oc.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 800, color: '#0f172a' }}>
                    {oc.plateNumber}
                  </td>
                  <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 600 }}>
                    {oc.oilType} ({oc.ratedKm} {t('delivery_reps.fleet_vehicles_tab.s52', "كم)")}
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>
                    {Number(oc.odometerAtChange).toLocaleString()} {t('delivery_reps.fleet_vehicles_tab.s53', "كم")}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {oc.withFilter ? (
                      <span style={{ color: '#16a34a', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s54', "مع فلتر جديد")}</span>
                    ) : (
                      <span style={{ color: '#64748b' }}>{t('delivery_reps.fleet_vehicles_tab.s55', "بدون فلتر")}</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', color: '#0284c7', fontWeight: 700 }}>
                    {oc.alertKmBefore} {t('delivery_reps.fleet_vehicles_tab.s56', "كم مسبقاً")}
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 800, color: '#170e5e' }}>
                    {Number(oc.nextDueOdometer).toLocaleString()} {t('delivery_reps.fleet_vehicles_tab.s57', "كم")}
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: '11px', color: '#64748b' }}>
                    {oc.performedBy || '—'}
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 700, color: '#170e5e' }}>
                    {oc.cost ? `${Number(oc.cost).toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: '8px',
                        background: oc.status === 'active' ? '#dcfce7' : oc.status === 'overdue' ? '#fee2e2' : '#f1f5f9',
                        color: oc.status === 'active' ? '#15803d' : oc.status === 'overdue' ? '#b91c1c' : '#475569',
                      }}
                    >
                      {oc.status === 'active' ? t('delivery_reps.fleet_vehicles_tab.s58', "ساري") : oc.status === 'overdue' ? t('delivery_reps.fleet_vehicles_tab.s59', "مستحق التغيير") : t('delivery_reps.fleet_vehicles_tab.s60', "مكتمل")}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: '11px', color: '#64748b' }}>
                    {new Date(oc.createdAt).toLocaleDateString('ar-EG')}
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
