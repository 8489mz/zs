import { http } from '@/lib/http';
import { getDriverAuthHeaders } from './van-sales-driver-auth';
import type {
  FleetFuelLogRecord,
  FleetMaintenanceAlert,
  InterVanTransferRecord,
  VanCustomerItineraryItem,
} from './van-sales-types-c';

export const vanDriverFleetApi = {
  // INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day cash due for one trip —
  // the settle tab's per-day inputs read this; the server settles
  // from the same buckets.
  getTripDueByDay: async (tripId: number): Promise<{
    ok: boolean;
    tripId: number;
    businessDay: string | null;
    timezone: string;
    days: Array<{
      businessDay: string;
      cashSales: number;
      collections: number;
      refunds: number;
      due: number;
      saleIds: number[];
      paymentIds: number[];
      refundIds: number[];
      hasActivity: boolean;
    }>;
    totalDue: number;
  }> => {
    return http(`/api/driver-portal/van-sales/trips/${tripId}/due-by-day`, {
      headers: getDriverAuthHeaders(),
    });
  },

  // Driver Field Itinerary & Visits
  getMyItinerary: async (): Promise<VanCustomerItineraryItem[]> => {
    const res = await http<{ ok: boolean; itinerary: VanCustomerItineraryItem[] }>(
      '/api/driver-portal/van-sales/itinerary',
      { headers: getDriverAuthHeaders() },
    );
    return res.itinerary || [];
  },

  recordFieldVisit: async (payload: {
    tripId: number;
    customerId: number;
    visitType: 'positive' | 'negative';
    saleId?: number;
    negativeReason?: 'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other';
    postponedToDate?: string;
    gpsLat?: number;
    gpsLng?: number;
    notes?: string;
  }): Promise<{ ok: boolean; visitId: number; consecutiveNegativeAlert: boolean }> => {
    return http('/api/driver-portal/van-sales/field-visits', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  // Driver Fleet Fuel & Maintenance
  recordDriverFuelLog: async (payload: {
    vehicleId: number;
    tripId?: number;
    odometer: number;
    liters: number;
    pricePerLiter: number;
    stationName?: string;
    notes?: string;
  }): Promise<{ ok: boolean; fuelLogId: number; kmSinceLastFuel: number; consumptionRate: number; totalCost: number }> => {
    return http('/api/driver-portal/van-sales/fuel-logs', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  getDriverFuelLogs: async (): Promise<FleetFuelLogRecord[]> => {
    const res = await http<{ ok: boolean; logs: FleetFuelLogRecord[] }>(
      '/api/driver-portal/van-sales/fuel-logs',
      { headers: getDriverAuthHeaders() },
    );
    return res.logs || [];
  },

  recordDriverOilChange: async (payload: {
    vehicleId: number;
    odometerAtChange: number;
    oilType: string;
    ratedKm: number;
    withFilter: boolean;
    alertKmBefore?: number;
    cost?: number;
    performedBy?: string;
    notes?: string;
  }): Promise<{ ok: boolean; oilChangeId: number; nextDueOdometer: number; alertKmBefore: number }> => {
    return http('/api/driver-portal/van-sales/oil-changes', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  getDriverMaintenanceAlerts: async (): Promise<FleetMaintenanceAlert[]> => {
    const res = await http<{ ok: boolean; alerts: FleetMaintenanceAlert[] }>(
      '/api/driver-portal/van-sales/maintenance-alerts',
      { headers: getDriverAuthHeaders() },
    );
    return res.alerts || [];
  },

  // Driver Inter-Van Transfers
  createDriverTransfer: async (payload: {
    toRepId: number;
    fromTripId?: number;
    toTripId?: number;
    items: { productId: number; qty: number }[];
    notes?: string;
  }): Promise<{ ok: boolean; transferId: number; transferNo: string; status: string }> => {
    return http('/api/driver-portal/van-sales/transfers', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  getDriverTransfers: async (): Promise<InterVanTransferRecord[]> => {
    const res = await http<{ ok: boolean; transfers: InterVanTransferRecord[] }>(
      '/api/driver-portal/van-sales/transfers',
      { headers: getDriverAuthHeaders() },
    );
    return res.transfers || [];
  },

  acceptDriverTransfer: async (transferId: number): Promise<{ ok: boolean; transferId: number; status: string }> => {
    return http(`/api/driver-portal/van-sales/transfers/${transferId}/accept`, {
      method: 'POST',
      headers: getDriverAuthHeaders(),
    });
  },

  rejectDriverTransfer: async (transferId: number, reason?: string): Promise<{ ok: boolean; transferId: number; status: string }> => {
    return http(`/api/driver-portal/van-sales/transfers/${transferId}/reject`, {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify({ reason }),
    });
  },

  getPeerReps: async (): Promise<Array<{ id: number; name: string; phone?: string; vehiclePlate?: string }>> => {
    const res = await http<{ ok: boolean; reps: any[] }>('/api/driver-portal/van-sales/peer-reps', {
      headers: getDriverAuthHeaders(),
    });
    return res.reps || [];
  },
};
