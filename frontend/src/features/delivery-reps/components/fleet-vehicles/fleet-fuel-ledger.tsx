import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import type { FleetFuelLogRecord, FleetVehicle } from '../../api/van-sales.api';

export interface FleetFuelLedgerProps {
  allFuelLogs: FleetFuelLogRecord[];
  vehicles: FleetVehicle[];
  setMaintenanceVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
  isFuelLoading: boolean;
}

export function FleetFuelLedger({
  allFuelLogs,
  vehicles,
  setMaintenanceVehicle,
  setIsMaintenanceOpen,
  isFuelLoading,
}: FleetFuelLedgerProps) {
  const { t } = useTranslation();
  return (
    <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
            {t('delivery_reps.fleet_vehicles_tab.s61', "سجل استهلاك وتفويل الوقود للأسطول (")}{allFuelLogs.length})
          </h3>
          <span style={{ fontSize: '11.5px', color: '#64748b' }}>
            {t('delivery_reps.fleet_vehicles_tab.s62', "معدلات الحرق (كم/لتر) وتكلفة المحروقات لسيارات الشركة")}
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
          style={{ background: '#0284c7', color: '#ffffff', fontWeight: 700, fontSize: '12px' }}
        >
          {t('delivery_reps.fleet_vehicles_tab.s63', "+ تسجيل تفويل وقود لسيارة")}
        </Button>
      </div>

      {isFuelLoading ? (
        <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>{t('delivery_reps.fleet_vehicles_tab.s64', "جاري تحميل سجلات الوقود...")}</div>
      ) : allFuelLogs.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '12.5px' }}>
          {t('delivery_reps.fleet_vehicles_tab.s65', "لا توجد سجلات تفويل مسجلة لأسطول الشركة حتى الآن.")}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s66', "لوحة المركبة")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s67', "قراءة العداد")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s68', "الكمية")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s69', "سعر اللتر")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s70', "الإجمالي")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s71', "المسافة المقطوعة")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s72', "معدل الاستهلاك")}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s73', "المحطة / التاريخ")}</th>
              </tr>
            </thead>
            <tbody>
              {allFuelLogs.map((fl: any) => (
                <tr key={fl.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 800, color: '#0f172a' }}>
                    {fl.plateNumber || `#${fl.vehicleId}`}
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 700 }}>
                    {Number(fl.odometer).toLocaleString()} {t('delivery_reps.fleet_vehicles_tab.s74', "كم")}
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                    {fl.liters} {t('delivery_reps.fleet_vehicles_tab.s75', "لتر")}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {fl.pricePerLiter} <CurrencySymbol />
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 800, color: '#170e5e' }}>
                    {fl.totalCost} <CurrencySymbol />
                  </td>
                  <td style={{ padding: '8px 10px', color: '#059669', fontWeight: 600 }}>
                    {fl.kmSinceLastFuel > 0 ? `${fl.kmSinceLastFuel} كم` : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 800, color: '#0284c7' }}>
                    {fl.consumptionRate > 0 ? `${fl.consumptionRate} كم/لتر` : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: '11px', color: '#64748b' }}>
                    <div>{fl.stationName || t('delivery_reps.fleet_vehicles_tab.s76', "محطة وقود")}</div>
                    <div>{new Date(fl.createdAt).toLocaleDateString('ar-EG')}</div>
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
