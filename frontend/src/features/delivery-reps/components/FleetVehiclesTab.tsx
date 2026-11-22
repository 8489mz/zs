import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/shared/components/system-alert';
import {
  vanSalesApi,
  type FleetVehicle,
  type FleetMaintenanceAlert,
  type FleetOilChangeRecord,
  type FleetFuelLogRecord,
} from '../api/van-sales.api';
import { deliveryRepsApi, type DeliveryRep } from '@/shared/api/delivery-reps.api';
import { UpsertFleetVehicleModal } from './UpsertFleetVehicleModal';
import { AssignDriverModal } from './AssignDriverModal';
import { VehicleMaintenanceModal } from './VehicleMaintenanceModal';
import { SendToMaintenanceModal } from './SendToMaintenanceModal';
import { CompleteMaintenanceModal } from './CompleteMaintenanceModal';
import { FleetKpiGrid } from './fleet-vehicles/fleet-kpi-grid';
import { FleetFilterBar } from './fleet-vehicles/fleet-filter-bar';
import { FleetWorkshopTable } from './fleet-vehicles/fleet-workshop-table';
import { FleetAlertsGrid } from './fleet-vehicles/fleet-alerts-grid';
import { FleetOilLedger } from './fleet-vehicles/fleet-oil-ledger';
import { FleetFuelLedger } from './fleet-vehicles/fleet-fuel-ledger';
import { FleetVehiclesTable } from './fleet-vehicles/fleet-vehicles-table';

export function FleetVehiclesTab() {
  const queryClient = useQueryClient();
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState<'all' | 'available' | 'assigned' | 'maintenance'>('all');
  const [isUpsertVehicleOpen, setIsUpsertVehicleOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<FleetVehicle | null>(null);
  const [isAssignDriverOpen, setIsAssignDriverOpen] = useState(false);
  const [assigningVehicle, setAssigningVehicle] = useState<FleetVehicle | null>(null);
  const [isMaintenanceOpen, setIsMaintenanceOpen] = useState(false);
  const [maintenanceVehicle, setMaintenanceVehicle] = useState<FleetVehicle | null>(null);
  const [isSendToMaintenanceOpen, setIsSendToMaintenanceOpen] = useState(false);
  const [sendToMaintenanceVehicle, setSendToMaintenanceVehicle] = useState<FleetVehicle | null>(null);
  const [isCompleteMaintenanceOpen, setIsCompleteMaintenanceOpen] = useState(false);
  const [completeMaintenanceVehicle, setCompleteMaintenanceVehicle] = useState<FleetVehicle | null>(null);

  // 1. Fetch Fleet Vehicles
  const {
    data: vehicles = [],
    isLoading: isVehiclesLoading,
    refetch: refetchVehicles,
  } = useQuery<FleetVehicle[]>({
    queryKey: ['fleet-vehicles'],
    queryFn: vanSalesApi.listVehicles,
    refetchInterval: 25000,
  });

  // 2. Fetch Representatives
  const {
    data: reps = [],
    refetch: refetchReps,
  } = useQuery<DeliveryRep[]>({
    queryKey: ['delivery-reps'],
    queryFn: deliveryRepsApi.list,
  });

  // 3. Fetch Fleet Maintenance Alerts
  const {
    data: allAlerts = [],
    refetch: refetchAlerts,
  } = useQuery<FleetMaintenanceAlert[]>({
    queryKey: ['fleet-maintenance-alerts'],
    queryFn: vanSalesApi.fetchMaintenanceAlerts,
    refetchInterval: 30000,
  });

  // 4. Fetch All Oil Changes
  const {
    data: allOilChanges = [],
    isLoading: isOilLoading,
    refetch: refetchOilChanges,
  } = useQuery<FleetOilChangeRecord[]>({
    queryKey: ['fleet-oil-changes-all'],
    queryFn: () => vanSalesApi.fetchAdminOilChanges(),
  });

  // 5. Fetch All Fuel Logs
  const {
    data: allFuelLogs = [],
    isLoading: isFuelLoading,
    refetch: refetchFuelLogs,
  } = useQuery<FleetFuelLogRecord[]>({
    queryKey: ['fleet-fuel-logs-all'],
    queryFn: () => vanSalesApi.fetchAdminFuelLogs(),
  });

  const totalVehiclesCount = vehicles.length;
  const assignedVehiclesCount = vehicles.filter((v) => v.status === 'assigned' || v.assignedRepId).length;
  const availableVehiclesCount = vehicles.filter((v) => v.status === 'available' && !v.assignedRepId).length;
  const maintenanceVehiclesCount = vehicles.filter((v) => v.status === 'maintenance').length;

  const filteredVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      if (vehicleStatusFilter !== 'all' && v.status !== vehicleStatusFilter) return false;
      if (vehicleSearch.trim()) {
        const q = vehicleSearch.toLowerCase().trim();
        const matchesPlate = (v.plateNumber || '').toLowerCase().includes(q);
        const matchesModel = (v.modelName || '').toLowerCase().includes(q);
        const matchesRep = (v.assignedRepName || '').toLowerCase().includes(q);
        return matchesPlate || matchesModel || matchesRep;
      }
      return true;
    });
  }, [vehicles, vehicleStatusFilter, vehicleSearch]);

  const refreshAll = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fleet-vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['delivery-reps'] }),
        queryClient.invalidateQueries({ queryKey: ['fleet-maintenance-alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['fleet-oil-changes'] }),
        queryClient.invalidateQueries({ queryKey: ['fleet-fuel-logs'] }),
        refetchVehicles(),
        refetchReps(),
        refetchAlerts(),
        refetchOilChanges(),
        refetchFuelLogs(),
      ]);
      await new Promise((r) => setTimeout(r, 450));
      toast.success('تم تحديث أسطول السيارات بنجاح');
    } catch {
      toast.error('حدث خطأ أثناء تحديث البيانات');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* KPI Metrics */}
      <FleetKpiGrid
        setVehicleStatusFilter={setVehicleStatusFilter}
        vehicleStatusFilter={vehicleStatusFilter}
        totalVehiclesCount={totalVehiclesCount}
        assignedVehiclesCount={assignedVehiclesCount}
        availableVehiclesCount={availableVehiclesCount}
        allAlerts={allAlerts}
        maintenanceVehiclesCount={maintenanceVehiclesCount}
      />

      {/* Action and Filter Bar */}
      <FleetFilterBar
        vehicleStatusFilter={vehicleStatusFilter}
        vehicleSearch={vehicleSearch}
        setVehicleSearch={setVehicleSearch}
        vehicles={vehicles}
        assignedVehiclesCount={assignedVehiclesCount}
        availableVehiclesCount={availableVehiclesCount}
        maintenanceVehiclesCount={maintenanceVehiclesCount}
        setVehicleStatusFilter={setVehicleStatusFilter}
        setSendToMaintenanceVehicle={setSendToMaintenanceVehicle}
        setIsSendToMaintenanceOpen={setIsSendToMaintenanceOpen}
        setEditingVehicle={setEditingVehicle}
        setIsUpsertVehicleOpen={setIsUpsertVehicleOpen}
        isRefreshing={isRefreshing}
        refreshAll={refreshAll}
      />

      {/* VIEW MODE 1: FLEET MAINTENANCE & WORKSHOP HUB */}
      {vehicleStatusFilter === 'maintenance' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Section 1: Vehicles In Workshop */}
          <FleetWorkshopTable
            maintenanceVehiclesCount={maintenanceVehiclesCount}
            setSendToMaintenanceVehicle={setSendToMaintenanceVehicle}
            setIsSendToMaintenanceOpen={setIsSendToMaintenanceOpen}
            vehicles={vehicles}
            setCompleteMaintenanceVehicle={setCompleteMaintenanceVehicle}
            setIsCompleteMaintenanceOpen={setIsCompleteMaintenanceOpen}
            setMaintenanceVehicle={setMaintenanceVehicle}
            setIsMaintenanceOpen={setIsMaintenanceOpen}
          />

          {/* Section 2: Fleet Preventive Maintenance Alerts */}
          <FleetAlertsGrid
            allAlerts={allAlerts}
            vehicles={vehicles}
            setMaintenanceVehicle={setMaintenanceVehicle}
            setIsMaintenanceOpen={setIsMaintenanceOpen}
          />

          {/* Section 3: Fleet Oil Changes Ledger */}
          <FleetOilLedger
            allOilChanges={allOilChanges}
            vehicles={vehicles}
            setMaintenanceVehicle={setMaintenanceVehicle}
            setIsMaintenanceOpen={setIsMaintenanceOpen}
            isOilLoading={isOilLoading}
          />

          {/* Section 4: Fleet Fuel Logs Ledger */}
          <FleetFuelLedger
            allFuelLogs={allFuelLogs}
            vehicles={vehicles}
            setMaintenanceVehicle={setMaintenanceVehicle}
            setIsMaintenanceOpen={setIsMaintenanceOpen}
            isFuelLoading={isFuelLoading}
          />
        </div>
      ) : (
        /* VIEW MODE 2: REGULAR FLEET VEHICLES TABLE */
        <FleetVehiclesTable
          isVehiclesLoading={isVehiclesLoading}
          filteredVehicles={filteredVehicles}
          vehicles={vehicles}
          vehicleSearch={vehicleSearch}
          vehicleStatusFilter={vehicleStatusFilter}
          setMaintenanceVehicle={setMaintenanceVehicle}
          setIsMaintenanceOpen={setIsMaintenanceOpen}
          setCompleteMaintenanceVehicle={setCompleteMaintenanceVehicle}
          setIsCompleteMaintenanceOpen={setIsCompleteMaintenanceOpen}
          setSendToMaintenanceVehicle={setSendToMaintenanceVehicle}
          setIsSendToMaintenanceOpen={setIsSendToMaintenanceOpen}
          setAssigningVehicle={setAssigningVehicle}
          setIsAssignDriverOpen={setIsAssignDriverOpen}
          setEditingVehicle={setEditingVehicle}
          setIsUpsertVehicleOpen={setIsUpsertVehicleOpen}
        />
      )}

      {/* Modals */}
      <UpsertFleetVehicleModal
        open={isUpsertVehicleOpen}
        onClose={() => {
          setIsUpsertVehicleOpen(false);
          setEditingVehicle(null);
        }}
        vehicle={editingVehicle}
        reps={reps}
      />

      <AssignDriverModal
        open={isAssignDriverOpen}
        onClose={() => {
          setIsAssignDriverOpen(false);
          setAssigningVehicle(null);
        }}
        vehicle={assigningVehicle}
        reps={reps}
      />

      <VehicleMaintenanceModal
        open={isMaintenanceOpen}
        onClose={() => {
          setIsMaintenanceOpen(false);
          setMaintenanceVehicle(null);
        }}
        vehicle={maintenanceVehicle}
      />

      <SendToMaintenanceModal
        open={isSendToMaintenanceOpen}
        onClose={() => {
          setIsSendToMaintenanceOpen(false);
          setSendToMaintenanceVehicle(null);
        }}
        vehicles={vehicles}
        preselectedVehicle={sendToMaintenanceVehicle}
        onSuccess={refreshAll}
      />

      <CompleteMaintenanceModal
        open={isCompleteMaintenanceOpen}
        onClose={() => {
          setIsCompleteMaintenanceOpen(false);
          setCompleteMaintenanceVehicle(null);
        }}
        vehicle={completeMaintenanceVehicle}
        onSuccess={refreshAll}
      />
    </div>
  );
}
