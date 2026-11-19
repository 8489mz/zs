import { http } from '@/lib/http';
import type { SupervisorCustomerRouteItem } from './van-sales-types-b';
import type {
  FleetFuelLogRecord,
  FleetMaintenanceAlert,
  FleetOilChangeRecord,
  InterVanTransferRecord,
  RepTargetSummary,
  SupervisorRouteKpiSummary,
  VehicleDriverShiftRecord,
} from './van-sales-types-c';

export const vanAdminOpsApi = {
  // Admin Rep Targets API
  listRepTargets: async (month?: string): Promise<RepTargetSummary[]> => {
    const res = await http<{ ok: boolean; targets: RepTargetSummary[] }>(`/api/van-sales/admin/targets${month ? `?month=${month}` : ''}`);
    return res.targets || [];
  },

  setRepTarget: async (
    repId: number,
    month: string,
    targetAmount: number,
    collectionTarget?: number | null,
    visitsTarget?: number | null,
    commissionRates?: {
      salesCommissionRate?: number;
      collectionCommissionRate?: number;
      targetBonusRate?: number;
    },
  ) => {
    return http('/api/van-sales/admin/targets', {
      method: 'POST',
      body: JSON.stringify({
        repId,
        month,
        targetAmount,
        collectionTarget,
        visitsTarget,
        ...(commissionRates || {}),
      }),
    });
  },

  getCommissionConfig: async (): Promise<{
    defaultSalesRate: number;
    defaultCollectionRate: number;
    defaultTargetBonusRate: number;
    repRates: Record<string, { salesRate: number; collectionRate: number; targetBonusRate: number }>;
  }> => {
    return http('/api/van-sales/admin/targets/commission-config');
  },

  saveCommissionConfig: async (payload: {
    defaultSalesRate?: number;
    defaultCollectionRate?: number;
    defaultTargetBonusRate?: number;
    repId?: number;
    salesRate?: number;
    collectionRate?: number;
    targetBonusRate?: number;
  }) => {
    return http('/api/van-sales/admin/targets/commission-config', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  settleRepCommission: async (payload: {
    repId: number;
    month: string;
    amount: number;
    paymentMethod?: 'cash' | 'bank_transfer';
    notes?: string;
  }): Promise<{
    ok: boolean;
    repId: number;
    month: string;
    settledAmount: number;
    expenseId?: number;
  }> => {
    return http('/api/van-sales/admin/targets/settle-commission', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Supervisor Route KPIs & Field Visits API
  fetchSupervisorRouteKpis: async (params?: { dateFrom?: string; dateTo?: string }): Promise<SupervisorRouteKpiSummary> => {
    const sp = new URLSearchParams();
    if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params?.dateTo) sp.set('dateTo', params.dateTo);
    const qs = sp.toString();
    const res = await http<SupervisorRouteKpiSummary & { ok: boolean }>(`/api/van-sales/admin/kpis${qs ? `?${qs}` : ''}`);
    return res;
  },

  fetchAdminFieldVisits: async (filters?: {
    repId?: number;
    customerId?: number;
    visitType?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<any[]> => {
    const sp = new URLSearchParams();
    if (filters?.repId) sp.set('repId', String(filters.repId));
    if (filters?.customerId) sp.set('customerId', String(filters.customerId));
    if (filters?.visitType) sp.set('visitType', filters.visitType);
    if (filters?.dateFrom) sp.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) sp.set('dateTo', filters.dateTo);
    const qs = sp.toString();
    const res = await http<{ ok: boolean; visits: any[] }>(`/api/van-sales/admin/field-visits${qs ? `?${qs}` : ''}`);
    return res.visits || [];
  },

  setCustomerRouteSchedule: async (
    customerId: number,
    payload: {
      route?: string;
      routeSequence?: number;
      visitDays?: string[];
      customerCode?: string;
      locationUrl?: string;
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      assignedRepName?: string;
      repSchedules?: Array<{ repId: number; repName?: string; days: string[] }>;
    },
  ) => {
    return http(`/api/van-sales/admin/customers/${customerId}/route-schedule`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getSupervisorCustomerRoutes: async (filters?: {
    search?: string;
    repId?: number | string;
    route?: string;
    unassignedOnly?: boolean;
  }): Promise<SupervisorCustomerRouteItem[]> => {
    const sp = new URLSearchParams();
    if (filters?.search) sp.set('search', filters.search);
    if (filters?.repId && filters.repId !== 'all') sp.set('repId', String(filters.repId));
    if (filters?.route && filters.route !== 'all') sp.set('route', filters.route);
    if (filters?.unassignedOnly) sp.set('unassignedOnly', 'true');
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    const res = await http<{ ok: boolean; customers: SupervisorCustomerRouteItem[] }>(
      `/api/van-sales/admin/supervisor/customer-routes${qs}`,
    );
    return res.customers || [];
  },

  bulkAssignCustomerRoutes: async (payload: {
    customerIds: number[];
    assignedRepId?: number | null;
    assignedRepIds?: number[];
    appendReps?: boolean;
    assignedRepName?: string;
    route?: string;
    visitDays?: string[];
  }): Promise<{ ok: boolean; updatedCount: number; assignedRepId?: number | null; assignedRepName?: string | null }> => {
    return http<{ ok: boolean; updatedCount: number; assignedRepId?: number | null; assignedRepName?: string | null }>(
      `/api/van-sales/admin/supervisor/customer-routes/bulk-assign`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  },


  // Fleet Fuel Logs API
  fetchAdminFuelLogs: async (filters?: { vehicleId?: number; repId?: number; dateFrom?: string; dateTo?: string }): Promise<FleetFuelLogRecord[]> => {
    const sp = new URLSearchParams();
    if (filters?.vehicleId) sp.set('vehicleId', String(filters.vehicleId));
    if (filters?.repId) sp.set('repId', String(filters.repId));
    if (filters?.dateFrom) sp.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) sp.set('dateTo', filters.dateTo);
    const qs = sp.toString();
    const res = await http<{ ok: boolean; logs: FleetFuelLogRecord[] }>(`/api/van-sales/admin/fuel-logs${qs ? `?${qs}` : ''}`);
    return res.logs || [];
  },

  recordAdminFuelLog: async (payload: {
    vehicleId: number;
    tripId?: number;
    repId?: number;
    odometer: number;
    liters: number;
    pricePerLiter: number;
    stationName?: string;
    notes?: string;
  }) => {
    return http('/api/van-sales/admin/fuel-logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Fleet Oil Changes API
  fetchAdminOilChanges: async (vehicleId?: number): Promise<FleetOilChangeRecord[]> => {
    const res = await http<{ ok: boolean; changes: FleetOilChangeRecord[] }>(
      `/api/van-sales/admin/oil-changes${vehicleId ? `?vehicleId=${vehicleId}` : ''}`,
    );
    return res.changes || [];
  },

  recordAdminOilChange: async (payload: {
    vehicleId: number;
    odometerAtChange: number;
    oilType: string;
    ratedKm: number;
    withFilter: boolean;
    alertKmBefore?: number;
    cost?: number;
    performedBy?: string;
    notes?: string;
    repId?: number;
  }) => {
    return http('/api/van-sales/admin/oil-changes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  fetchMaintenanceAlerts: async (): Promise<FleetMaintenanceAlert[]> => {
    const res = await http<{ ok: boolean; alerts: FleetMaintenanceAlert[] }>('/api/van-sales/admin/maintenance-alerts');
    return res.alerts || [];
  },

  // Multi-Driver Vehicle Shifts API
  fetchVehicleDrivers: async (vehicleId: number): Promise<VehicleDriverShiftRecord[]> => {
    const res = await http<{ ok: boolean; drivers: VehicleDriverShiftRecord[] }>(
      `/api/van-sales/admin/vehicles/${vehicleId}/drivers`,
    );
    return res.drivers || [];
  },

  assignVehicleDriver: async (
    vehicleId: number,
    payload: {
      repId: number;
      shiftName: string;
      shiftStartTime?: string;
      shiftEndTime?: string;
      notes?: string;
    },
  ) => {
    return http(`/api/van-sales/admin/vehicles/${vehicleId}/drivers`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  removeVehicleDriver: async (vehicleId: number, driverId: number) => {
    return http(`/api/van-sales/admin/vehicles/${vehicleId}/drivers/${driverId}`, {
      method: 'DELETE',
    });
  },

  // Inter-Van Transfers Audit API
  fetchAdminTransfers: async (filters?: { repId?: number; status?: string }): Promise<InterVanTransferRecord[]> => {
    const sp = new URLSearchParams();
    if (filters?.repId) sp.set('repId', String(filters.repId));
    if (filters?.status) sp.set('status', filters.status);
    const qs = sp.toString();
    const res = await http<{ ok: boolean; transfers: InterVanTransferRecord[] }>(`/api/van-sales/admin/transfers${qs ? `?${qs}` : ''}`);
    return res.transfers || [];
  },
};
