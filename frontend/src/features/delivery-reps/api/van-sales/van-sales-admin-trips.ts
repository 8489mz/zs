import { http } from '@/lib/http';
import type { FleetVehicle, VanTripSummary } from './van-sales-types-a';
import type {
  DriverAvailableProduct,
  DriverWarehouse,
  VanFieldReturnRecord,
  VanLoadRequisitionRecord,
} from './van-sales-types-b';
import type { TripAdminDetails } from './van-sales-types-c';

export const vanAdminTripsApi = {
  listAdminTrips: async (filters?: {
    repId?: number;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<VanTripSummary[]> => {
    const searchParams = new URLSearchParams();
    if (filters?.repId) searchParams.set('repId', String(filters.repId));
    if (filters?.status) searchParams.set('status', filters.status);
    if (filters?.dateFrom) searchParams.set('dateFrom', filters.dateFrom);
    if (filters?.dateTo) searchParams.set('dateTo', filters.dateTo);
    const qs = searchParams.toString();
    const res = await http<{ ok: boolean; trips: VanTripSummary[] }>(`/api/van-sales/admin/trips${qs ? `?${qs}` : ''}`);
    return res.trips || [];
  },

  getTripDetails: async (tripId: number): Promise<TripAdminDetails> => {
    return http<TripAdminDetails>(`/api/van-sales/admin/trips/${tripId}`);
  },

  listVehicles: async (): Promise<FleetVehicle[]> => {
    const res = await http<{ ok: boolean; vehicles: FleetVehicle[] }>('/api/van-sales/admin/vehicles');
    return res.vehicles || [];
  },

  createVehicle: async (payload: {
    plateNumber: string;
    modelName?: string;
    vehicleType?: string;
    vinChassis?: string;
    branchId?: number;
    currentOdometer?: number;
    fuelType?: string;
    licenseExpiresAt?: string;
    assignedRepId?: number;
    notes?: string;
  }): Promise<FleetVehicle[]> => {
    const res = await http<{ ok: boolean; vehicles: FleetVehicle[] }>('/api/van-sales/admin/vehicles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.vehicles || [];
  },

  updateVehicle: async (
    id: number,
    payload: {
      plateNumber?: string;
      modelName?: string;
      vehicleType?: string;
      vinChassis?: string;
      branchId?: number;
      currentOdometer?: number;
      fuelType?: string;
      licenseExpiresAt?: string;
      status?: string;
      assignedRepId?: number | null;
      notes?: string;
    },
  ): Promise<FleetVehicle[]> => {
    const res = await http<{ ok: boolean; vehicles: FleetVehicle[] }>(`/api/van-sales/admin/vehicles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return res.vehicles || [];
  },

  assignVehicleRep: async (
    vehicleId: number,
    payload: { repId: number | null; shiftName?: string },
  ): Promise<FleetVehicle[]> => {
    const res = await http<{ ok: boolean; vehicles: FleetVehicle[] }>(`/api/van-sales/admin/vehicles/${vehicleId}/assign`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.vehicles || [];
  },

  // Admin Field Returns API
  listAdminReturns: async (filters?: {
    status?: string;
    repId?: number;
    tripId?: number;
    customerId?: number;
  }): Promise<VanFieldReturnRecord[]> => {
    const sp = new URLSearchParams();
    if (filters?.status) sp.set('status', filters.status);
    if (filters?.repId) sp.set('repId', String(filters.repId));
    if (filters?.tripId) sp.set('tripId', String(filters.tripId));
    if (filters?.customerId) sp.set('customerId', String(filters.customerId));
    const qs = sp.toString();
    const res = await http<{ ok: boolean; returns: VanFieldReturnRecord[] }>(`/api/van-sales/admin/returns${qs ? `?${qs}` : ''}`);
    return res.returns || [];
  },

  approveReturn: async (id: number): Promise<{ ok: boolean; returnId: number; status: string }> => {
    return http(`/api/van-sales/admin/returns/${id}/approve`, { method: 'POST' });
  },

  rejectReturn: async (id: number, reason: string): Promise<{ ok: boolean; returnId: number; status: string }> => {
    return http(`/api/van-sales/admin/returns/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  // Admin Loading Requisitions API
  listAdminRequisitions: async (filters?: {
    status?: string;
    repId?: number;
  }): Promise<VanLoadRequisitionRecord[]> => {
    const sp = new URLSearchParams();
    if (filters?.status) sp.set('status', filters.status);
    if (filters?.repId) sp.set('repId', String(filters.repId));
    const qs = sp.toString();
    const res = await http<{ ok: boolean; requisitions: VanLoadRequisitionRecord[] }>(`/api/van-sales/admin/requisitions${qs ? `?${qs}` : ''}`);
    return res.requisitions || [];
  },

  getAdminWarehouses: async (): Promise<DriverWarehouse[]> => {
    const res = await http<{ ok: boolean; warehouses: DriverWarehouse[] }>('/api/van-sales/admin/warehouses');
    return res.warehouses || [];
  },

  createAdminLoadRequisition: async (payload: {
    repId: number;
    sourceWarehouseId?: number;
    items: { productId: number; qty: number; productName?: string; barcode?: string }[];
    notes?: string;
    dispatchImmediately?: boolean;
  }): Promise<{ ok: boolean; docNo: string; requisitionId: number; dispatched: boolean; tripId?: number }> => {
    return http('/api/van-sales/admin/requisitions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getAdminAvailableProducts: async (warehouseId?: number | string): Promise<DriverAvailableProduct[]> => {
    const query = warehouseId && warehouseId !== 'all' ? `?warehouseId=${warehouseId}` : '';
    const res = await http<{ ok: boolean; products: DriverAvailableProduct[] }>(
      `/api/van-sales/admin/available-products${query}`,
    );
    return res.products || [];
  },

  reviewRequisition: async (
    id: number,
    approvedItems: { productId: number; qty: number }[],
    notes?: string,
    sourceWarehouseId?: number,
  ) => {
    return http(`/api/van-sales/admin/requisitions/${id}/review`, {
      method: 'PUT',
      body: JSON.stringify({ approvedItems, notes, sourceWarehouseId }),
    });
  },

  dispatchRequisition: async (id: number): Promise<{ ok: boolean; requisitionId: number; tripId: number; docNo: string; isSupplementary?: boolean }> => {
    return http(`/api/van-sales/admin/requisitions/${id}/dispatch`, { method: 'POST' });
  },

  rejectRequisition: async (id: number, reason: string): Promise<{ ok: boolean; requisitionId: number; status: string }> => {
    return http(`/api/van-sales/admin/requisitions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  deleteRequisition: async (id: number): Promise<{ ok: boolean; requisitionId: number; docNo: string }> => {
    return http(`/api/van-sales/admin/requisitions/${id}`, {
      method: 'DELETE',
    });
  },
};
