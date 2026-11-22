import { useTranslation } from 'react-i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/shared/ui/button';
import {
  SearchIcon,
  RefreshCwIcon,
  ToolIcon,
} from '@/shared/components/icons/AppIcons';
import type { FleetVehicle } from '../../api/van-sales.api';

export interface FleetFilterBarProps {
  vehicleStatusFilter: 'all' | 'available' | 'assigned' | 'maintenance';
  vehicleSearch: string;
  setVehicleSearch: Dispatch<SetStateAction<string>>;
  vehicles: FleetVehicle[];
  assignedVehiclesCount: number;
  availableVehiclesCount: number;
  maintenanceVehiclesCount: number;
  setVehicleStatusFilter: Dispatch<SetStateAction<'all' | 'available' | 'assigned' | 'maintenance'>>;
  setSendToMaintenanceVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsSendToMaintenanceOpen: Dispatch<SetStateAction<boolean>>;
  setEditingVehicle: Dispatch<SetStateAction<FleetVehicle | null>>;
  setIsUpsertVehicleOpen: Dispatch<SetStateAction<boolean>>;
  isRefreshing: boolean;
  refreshAll: () => Promise<void>;
}

export function FleetFilterBar({
  vehicleStatusFilter,
  vehicleSearch,
  setVehicleSearch,
  vehicles,
  assignedVehiclesCount,
  availableVehiclesCount,
  maintenanceVehiclesCount,
  setVehicleStatusFilter,
  setSendToMaintenanceVehicle,
  setIsSendToMaintenanceOpen,
  setEditingVehicle,
  setIsUpsertVehicleOpen,
  isRefreshing,
  refreshAll,
}: FleetFilterBarProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: '#ffffff',
        padding: '12px 16px',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flex: '1', minWidth: '280px' }}>
        {vehicleStatusFilter !== 'maintenance' && (
          <div style={{ position: 'relative', flex: '1' }}>
            <input
              type="text"
              placeholder={t('delivery_reps.fleet_vehicles_tab.s9', "بحث برقم اللوحة، الموديل، أو اسم السائق...")}
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
            <span style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }}>
              <SearchIcon size={16} />
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: '4px' }}>
          {[
            { label: `الكل (${vehicles.length})`, value: 'all' as const },
            { label: `مسندة (${assignedVehiclesCount})`, value: 'assigned' as const },
            { label: `متاحة (${availableVehiclesCount})`, value: 'available' as const },
            { label: `مركز وسجل الصيانة (${maintenanceVehiclesCount} بالورشة)`, value: 'maintenance' as const },
          ].map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setVehicleStatusFilter(f.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '7px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: vehicleStatusFilter === f.value ? (f.value === 'maintenance' ? '#ea580c' : '#170e5e') : '#f1f5f9',
                color: vehicleStatusFilter === f.value ? '#ffffff' : '#475569',
                transition: 'none',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {vehicleStatusFilter === 'maintenance' ? (
          <Button
            variant="primary"
            style={{ background: '#ea580c', color: '#ffffff', fontWeight: 700, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
            onClick={() => {
              setSendToMaintenanceVehicle(null);
              setIsSendToMaintenanceOpen(true);
            }}
          >
            <ToolIcon size={14} />
            {t('delivery_reps.fleet_vehicles_tab.s10', "+ إدخال سيارة للصيانة بالورشة")}
          </Button>
        ) : (
          <Button
            variant="primary"
            style={{ background: '#170e5e', color: '#ffffff', fontWeight: 700, fontSize: '13px' }}
            onClick={() => {
              setEditingVehicle(null);
              setIsUpsertVehicleOpen(true);
            }}
          >
            {t('delivery_reps.fleet_vehicles_tab.s11', "+ إضافة سيارة للأسطول")}
          </Button>
        )}

        <Button
          variant="secondary"
          disabled={isRefreshing}
          style={{
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: isRefreshing ? 'wait' : 'pointer',
            opacity: isRefreshing ? 0.75 : 1,
          }}
          onClick={refreshAll}
          title={t('delivery_reps.fleet_vehicles_tab.s12', "تحديث بيانات أسطول السيارات من السيرفر")}
        >
          <RefreshCwIcon
            size={14}
            className={isRefreshing ? 'spin-animation' : undefined}
            style={isRefreshing ? { animation: 'spin 0.75s linear infinite' } : undefined}
          />
          {isRefreshing ? t('delivery_reps.fleet_vehicles_tab.s13', "جارٍ التحديث...") : t('delivery_reps.fleet_vehicles_tab.s14', "تحديث")}
        </Button>
      </div>
    </div>
  );
}
