import { http } from '@/lib/http';
import { vanFraudPromotionsApi } from './van-sales/van-sales-fraud-promotions';
import { vanExpensesPackagingApi } from './van-sales/van-sales-expenses-packaging';
import { vanPreSalesApi } from './van-sales/van-sales-presales';
import { vanAdminOpsApi } from './van-sales/van-sales-admin-ops';
import { vanAdminTripsApi } from './van-sales/van-sales-admin-trips';
import { vanDriverFleetApi } from './van-sales/van-sales-driver-fleet';
import { vanDriverCoreApi } from './van-sales/van-sales-driver-core';

export type {
  VanStockItem,
  VanTripExpense,
  VanPackagingMovement,
  CustomerPackagingBalance,
  PreSalesCatalogItem,
  PreSalesOrderItemInput,
  PreSalesOrderRecord,
  VanTripSummary,
  FleetVehicle,
  RepTargetMetrics,
  VanAssignedVehicle,
} from './van-sales/van-sales-types-a';


export type { RepTargetSummary, TripAdminDetails, VanCustomerItineraryItem, FleetFuelLogRecord, FleetOilChangeRecord, FleetMaintenanceAlert, VehicleDriverShiftRecord, InterVanTransferRecord, SupervisorRouteKpiSummary } from './van-sales/van-sales-types-c';


export const vanSalesApi = {
  ...vanDriverCoreApi,

  ...vanDriverFleetApi,

  ...vanAdminTripsApi,

  ...vanAdminOpsApi,

  ...vanPreSalesApi,

  ...vanExpensesPackagingApi,

  ...vanFraudPromotionsApi,

  // =========================================================================
  // FMCG FIELD EXECUTION, VISITS, TRADE MARKETING & BREADCRUMBS
  // =========================================================================

  checkInVisit: async (payload: {
    tripId?: number;
    customerId: number;
    customerName?: string;
    latitude?: number | null;
    longitude?: number | null;
  }): Promise<{ ok: boolean; visitId: number; customerName: string; geofence: any; checkInAt: string }> => {
    return http('/api/driver-portal/van-sales/visits/check-in', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  recordVisitInventory: async (visitId: number, payload: { items: any[] }): Promise<{ ok: boolean; visitId: number }> => {
    return http(`/api/driver-portal/van-sales/visits/${visitId}/inventory`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  recordVisitNoSale: async (visitId: number, payload: { noSaleReason: string; noSaleNotes?: string }): Promise<{ ok: boolean; visitId: number; reason: string }> => {
    return http(`/api/driver-portal/van-sales/visits/${visitId}/no-sale`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  checkOutVisit: async (visitId: number, payload?: {
    hasSale?: boolean;
    saleId?: number;
    saleAmount?: number;
    hasCollection?: boolean;
    collectionAmount?: number;
  }): Promise<{ ok: boolean; visitId: number; dwellTimeSeconds: number; dwellTimeMinutes: number }> => {
    return http(`/api/driver-portal/van-sales/visits/${visitId}/check-out`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
      headers: getDriverAuthHeaders(),
    });
  },

  recordTradeSurvey: async (payload: any): Promise<{ ok: boolean; surveyId: number }> => {
    return http('/api/driver-portal/van-sales/trade-surveys', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  recordBreadcrumb: async (payload: { tripId: number; latitude: number; longitude: number; speedKmh?: number; batteryLevel?: number }): Promise<{ ok: boolean }> => {
    return http('/api/driver-portal/van-sales/breadcrumbs', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  getVisitsHistory: async (params?: {
    tripId?: number;
    repId?: number;
    customerId?: number;
    date?: string;
    noSaleOnly?: boolean;
  }): Promise<{ ok: boolean; metrics: any; visits: any[] }> => {
    const q = new URLSearchParams();
    if (params?.tripId) q.set('tripId', String(params.tripId));
    if (params?.repId) q.set('repId', String(params.repId));
    if (params?.customerId) q.set('customerId', String(params.customerId));
    if (params?.date) q.set('date', params.date);
    if (params?.noSaleOnly) q.set('noSaleOnly', 'true');
    const qs = q.toString() ? `?${q.toString()}` : '';
    return http(`/api/van-sales/admin/visits${qs}`);
  },

  getTradeSurveys: async (params?: {
    tripId?: number;
    customerId?: number;
    surveyType?: string;
  }): Promise<{ ok: boolean; surveys: any[] }> => {
    const q = new URLSearchParams();
    if (params?.tripId) q.set('tripId', String(params.tripId));
    if (params?.customerId) q.set('customerId', String(params.customerId));
    if (params?.surveyType) q.set('surveyType', params.surveyType);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return http(`/api/van-sales/admin/trade-surveys${qs}`);
  },

  getLiveTripBreadcrumbs: async (tripId: number): Promise<{ ok: boolean; tripId: number; pointsCount: number; breadcrumbs: any[] }> => {
    return http(`/api/van-sales/admin/trips/${tripId}/breadcrumbs`);
  },

  getRepFinancialLedger: async (params?: {
    repId?: number;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<VanRepFinancialLedgerResponse> => {
    const q = new URLSearchParams();
    if (params?.repId) q.set('repId', String(params.repId));
    if (params?.status) q.set('status', params.status);
    if (params?.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params?.dateTo) q.set('dateTo', params.dateTo);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return http<VanRepFinancialLedgerResponse>(`/api/van-sales/admin/financial-ledger${qs}`);
  },

  settleRepFinancialItem: async (
    id: number,
    payload: { method: 'cash' | 'waiver'; notes?: string; reason?: string; supervisorPin?: string }
  ): Promise<{ ok: boolean; id: number; status: string; receiptVoucherNo?: string }> => {
    return http(`/api/van-sales/admin/financial-ledger/${id}/settle`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  pushRepShortagesToPayroll: async (payload: {
    settlementIds: number[];
    targetMonth?: string;
  }): Promise<{ ok: boolean; targetMonth: string; processedCount: number; results: any[] }> => {
    return http('/api/van-sales/admin/financial-ledger/push-to-payroll', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  addRepBonusOrCommission: async (payload: {
    repId: number;
    entryType: 'bonus' | 'commission';
    amount: number;
    notes: string;
  }): Promise<{ ok: boolean; repName: string; settlement: any }> => {
    return http('/api/van-sales/admin/financial-ledger/bonus', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  linkRepToEmployee: async (payload: {
    repId: number;
    employeeId: number | null;
  }): Promise<{ ok: boolean; repId: number; employeeId: number | null }> => {
    return http('/api/van-sales/admin/financial-ledger/link-employee', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getCandidateEmployees: async (): Promise<
    Array<{ id: number; employeeNo?: string | null; displayName: string; nationalId?: string | null }>
  > => {
    return http('/api/van-sales/admin/financial-ledger/candidate-employees');
  },

  autoCreateEmployee: async (payload: {
    repId: number;
  }): Promise<{ ok: boolean; employeeId: number; displayName: string; employeeNo?: string; message?: string }> => {
    return http('/api/van-sales/admin/financial-ledger/auto-create-employee', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export type { VanRepFinancialSettlementItem, VanRepLedgerBreakdown, VanRepFinancialLedgerResponse, FmcgPromotion, RouteOptimizationResult, VanFraudRadarEvent, VanRepRiskProfile, VanFraudRadarSummaryResponse } from './van-sales/van-sales-types-d';

export type {
  CustomerEligibleSale,
  CustomerEligibleSaleItem,
  CustomerRepBalanceItem,
  DriverAvailableProduct,
  DriverProductStock,
  DriverSaleHistoryItem,
  DriverWarehouse,
  RequisitionItemRecord,
  SupervisorCustomerRouteItem,
  VanActiveTripResponse,
  VanFieldReturnRecord,
  VanLoadRequisitionRecord,
} from './van-sales/van-sales-types-b';
