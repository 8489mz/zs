import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import {
  TruckIcon,
  SlidersIcon,
  ToolIcon,
  CheckCircleIcon,
} from '@/shared/components/icons/AppIcons';
import type { FleetVehicle } from '../../api/van-sales.api';

export interface FleetVehiclesTableProps {
  isVehiclesLoading: boolean;
  filteredVehicles: FleetVehicle[];
  vehicles: FleetVehicle[];
  vehicleSearch: string;
  vehicleStatusFilter: 'all' | 'available' | 'assigned' | 'maintenance';
  setMaintenanceVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
  setCompleteMaintenanceVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsCompleteMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
  setSendToMaintenanceVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsSendToMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
  setAssigningVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsAssignDriverOpen: Dispatch<SetStateAction<boolean>>;
  setEditingVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsUpsertVehicleOpen: Dispatch<SetStateAction<boolean>>;
}

export function FleetVehiclesTable({
  isVehiclesLoading,
  filteredVehicles,
  vehicles,
  vehicleSearch,
  vehicleStatusFilter,
  setMaintenanceVehicle,
  setIsMaintenanceOpen,
  setCompleteMaintenanceVehicle,
  setIsCompleteMaintenanceOpen,
  setSendToMaintenanceVehicle,
  setIsSendToMaintenanceOpen,
  setAssigningVehicle,
  setIsAssignDriverOpen,
  setEditingVehicle,
  setIsUpsertVehicleOpen,
}: FleetVehiclesTableProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        overflowX: 'auto',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      {isVehiclesLoading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontWeight: 700 }}>
          {t('delivery_reps.fleet_vehicles_tab.s77', "جاري تحميل أسطول السيارات...")}
        </div>
      ) : filteredVehicles.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>
          {vehicles.length === 0
            ? t('delivery_reps.fleet_vehicles_tab.s78', "لا توجد مركبات مسجلة في الأسطول حالياً. انقر على \"+ إضافة سيارة للأسطول\" لإضافة أول سيارة لأسطول الشركة.")
            : vehicleSearch
            ? `لا توجد مركبات تطابق بحثك: "${vehicleSearch}"`
            : vehicleStatusFilter === 'assigned'
            ? t('delivery_reps.fleet_vehicles_tab.s79', "لا توجد مركبات مسندة لسائقين حالياً.")
            : vehicleStatusFilter === 'available'
            ? t('delivery_reps.fleet_vehicles_tab.s80', "لا توجد مركبات متاحة بدون إسناد حالياً.")
            : t('delivery_reps.fleet_vehicles_tab.s81', "لا توجد مركبات تطابق التصفية المحددة.")}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12.5px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s82', "لوحة المركبة والطراز")}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s83', "نوع المركبة والوقود")}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s84', "مستودع الفان المتنقل")}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s85', "السائق المسند")}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s86', "قراءة العداد")}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700 }}>{t('delivery_reps.fleet_vehicles_tab.s87', "الحالة")}</th>
              <th style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'center' }}>{t('delivery_reps.fleet_vehicles_tab.s88', "الإجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredVehicles.map((v) => {
              const isAssigned = Boolean(v.assignedRepId);
              return (
                <tr key={v.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '8px',
                          background: '#f0f9ff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <TruckIcon size={18} color="#0284c7" />
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '13.5px' }}>
                          {v.plateNumber}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {v.modelName || t('delivery_reps.fleet_vehicles_tab.s89', "بدون موديل محدد")}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontWeight: 600, color: '#334155' }}>
                      {v.vehicleType === 'van'
                        ? t('delivery_reps.fleet_vehicles_tab.s90', "سيارة فان توزيع")
                        : v.vehicleType === 'truck'
                        ? t('delivery_reps.fleet_vehicles_tab.s91', "شاحنة نقل بضائع")
                        : v.vehicleType === 'motorcycle'
                        ? t('delivery_reps.fleet_vehicles_tab.s92', "دراجة نارية (موتوسيكل)")
                        : t('delivery_reps.fleet_vehicles_tab.s93', "سيارة أخرى")}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {t('delivery_reps.fleet_vehicles_tab.s94', "وقود:")} {v.fuelType === 'gasoline' ? t('delivery_reps.fleet_vehicles_tab.s95', "بنزين") : v.fuelType === 'diesel' ? t('delivery_reps.fleet_vehicles_tab.s96', "سولار / ديزل") : v.fuelType === 'hybrid' ? t('delivery_reps.fleet_vehicles_tab.s97', "هايبرد") : t('delivery_reps.fleet_vehicles_tab.s98', "كهربائي")}
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        background: '#f8fafc',
                        color: '#334155',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: '1px solid #e2e8f0',
                        fontWeight: 600,
                        display: 'inline-block',
                      }}
                    >
                      {v.vanLocationName}
                    </span>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    {isAssigned ? (
                      <div>
                        <span style={{ fontWeight: 700, color: '#0f172a' }}>{v.assignedRepName}</span>
                        {v.assignedRepPhone && (
                          <div style={{ fontSize: '11px', color: '#64748b', direction: 'ltr', textAlign: 'right' }}>
                            {v.assignedRepPhone}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: '11.5px', color: '#94a3b8', fontStyle: 'italic' }}>
                        {t('delivery_reps.fleet_vehicles_tab.s99', "-- بدون سائق مسند --")}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
                    {Number(v.currentOdometer || 0).toLocaleString()} {t('delivery_reps.fleet_vehicles_tab.s100', "كم")}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background:
                          v.status === 'assigned'
                            ? '#e0f2fe'
                            : v.status === 'available'
                            ? '#dcfce7'
                            : v.status === 'maintenance'
                            ? '#ffedd5'
                            : '#f1f5f9',
                        color:
                          v.status === 'assigned'
                            ? '#0369a1'
                            : v.status === 'available'
                            ? '#15803d'
                            : v.status === 'maintenance'
                            ? '#c2410c'
                            : '#475569',
                        border: `1px solid ${
                          v.status === 'assigned'
                            ? '#bae6fd'
                            : v.status === 'available'
                            ? '#bbf7d0'
                            : v.status === 'maintenance'
                            ? '#fed7aa'
                            : '#e2e8f0'
                        }`,
                      }}
                    >
                      {v.status === 'assigned'
                        ? t('delivery_reps.fleet_vehicles_tab.s101', "مسندة بالخدمة")
                        : v.status === 'available'
                        ? t('delivery_reps.fleet_vehicles_tab.s102', "متاحة للتشغيل")
                        : v.status === 'maintenance'
                        ? t('delivery_reps.fleet_vehicles_tab.s103', "تحت الصيانة")
                        : t('delivery_reps.fleet_vehicles_tab.s104', "مستبعدة")}
                    </span>
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', gap: '6px' }}>
                      <Button
                        variant="secondary"
                        style={{ fontSize: '11px', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => {
                          setMaintenanceVehicle(v);
                          setIsMaintenanceOpen(true);
                        }}
                      >
                        <SlidersIcon size={12} />
                        {t('delivery_reps.fleet_vehicles_tab.s105', "الوقود والصيانة")}
                      </Button>

                      {v.status === 'maintenance' ? (
                        <Button
                          variant="primary"
                          style={{
                            fontSize: '11px',
                            padding: '4px 8px',
                            background: '#15803d',
                            color: '#ffffff',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          onClick={() => {
                            setCompleteMaintenanceVehicle(v);
                            setIsCompleteMaintenanceOpen(true);
                          }}
                        >
                          <CheckCircleIcon size={12} />
                          {t('delivery_reps.fleet_vehicles_tab.s106', "إتمام الصيانة")}
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          style={{
                            fontSize: '11px',
                            padding: '4px 8px',
                            color: '#ea580c',
                            borderColor: '#fed7aa',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          onClick={() => {
                            setSendToMaintenanceVehicle(v);
                            setIsSendToMaintenanceOpen(true);
                          }}
                        >
                          <ToolIcon size={12} />
                          {t('delivery_reps.fleet_vehicles_tab.s107', "تحويل للورشة")}
                        </Button>
                      )}

                      <Button
                        variant="secondary"
                        style={{ fontSize: '11px', padding: '4px 10px' }}
                        onClick={() => {
                          setAssigningVehicle(v);
                          setIsAssignDriverOpen(true);
                        }}
                      >
                        {isAssigned ? t('delivery_reps.fleet_vehicles_tab.s108', "إدارة السائقين والورديات") : t('delivery_reps.fleet_vehicles_tab.s109', "تخصيص سائق")}
                      </Button>
                      <Button
                        variant="secondary"
                        style={{ fontSize: '11px', padding: '4px 10px' }}
                        onClick={() => {
                          setEditingVehicle(v);
                          setIsUpsertVehicleOpen(true);
                        }}
                      >
                        {t('delivery_reps.fleet_vehicles_tab.s110', "تعديل")}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
