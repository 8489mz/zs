import { http } from '@/lib/http';
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

  // =========================================================================
  // Van Sales Anti-Theft & Suspicion Radar (رادار الشبهات ومكافحة التلاعب)
  // =========================================================================

  getFraudRadarSummary: async (filters?: {
    days?: number;
    repId?: number;
  }): Promise<VanFraudRadarSummaryResponse> => {
    const params = new URLSearchParams();
    if (filters?.days) params.set('days', String(filters.days));
    if (filters?.repId) params.set('repId', String(filters.repId));
    const q = params.toString();
    return http(`/api/van-sales/admin/fraud-radar/summary${q ? `?${q}` : ''}`);
  },

  getFraudRadarEvents: async (filters?: {
    days?: number;
    repId?: number;
    eventCode?: string;
    limit?: number;
  }): Promise<{ ok: boolean; events: VanFraudRadarEvent[] }> => {
    const params = new URLSearchParams();
    if (filters?.days) params.set('days', String(filters.days));
    if (filters?.repId) params.set('repId', String(filters.repId));
    if (filters?.eventCode) params.set('eventCode', filters.eventCode);
    if (filters?.limit) params.set('limit', String(filters.limit));
    const q = params.toString();
    return http(`/api/van-sales/admin/fraud-radar/events${q ? `?${q}` : ''}`);
  },

  getCustomerSuggestedOrder: async (customerId: number): Promise<{
    ok: boolean;
    customerId: number;
    lastOrderDocNo: string | null;
    lastOrderDate: string | null;
    hasPreviousOrders: boolean;
    items: Array<{
      productId: number;
      productName: string;
      suggestedQty: number;
      unitPrice: number;
      unitName: string;
      unitMultiplier: number;
      barcode?: string | null;
      availableVanQty: number;
      isAvailableInVan: boolean;
    }>;
  }> => {
    return http(`/api/driver-portal/van-sales/customers/${customerId}/suggested-order`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getCustomerLastSoldPrices: async (customerId: number): Promise<{
    ok: boolean;
    customerId: number;
    lastPrices: Record<number, { lastPrice: number; lastSaleDate: string; lastDocNo: string }>;
  }> => {
    return http(`/api/driver-portal/van-sales/customers/${customerId}/last-prices`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getCustomerFieldStatement: async (customerId: number): Promise<{
    ok: boolean;
    customer: {
      id: number;
      name: string;
      phone: string;
      address: string;
      balance: number;
      creditLimit: number;
      customerType: string;
      isCreditBlocked: boolean;
      allowedCreditDays: number;
    };
    overdueAnalysis: {
      hasOverdueInvoices: boolean;
      overdueCount: number;
      totalOverdueAmount: number;
      oldestOverdueDays: number;
    };
    packagingBalance: Array<{ packageType: string; totalDelivered: number; totalReturned: number; netOwedToCompany: number }>;
    recentSales: Array<{
      id: number;
      docNo: string;
      saleDate: string;
      paymentType: string;
      total: number;
      paidAmount: number;
      remaining: number;
    }>;
    recentCollections: Array<{
      id: number;
      receiptNumber: string;
      paymentDate: string;
      amount: number;
      paymentMethod: string;
      notes: string;
    }>;
  }> => {
    return http(`/api/driver-portal/van-sales/customers/${customerId}/field-statement`, {
      headers: getDriverAuthHeaders(),
    });
  },

  // FMCG Mix & Match Promotions Endpoints
  fetchDriverPromotions: async (): Promise<{ ok: boolean; promotions: FmcgPromotion[] }> => {
    return http('/api/driver-portal/van-sales/promotions', {
      headers: getDriverAuthHeaders(),
    });
  },

  evaluateCartPromotions: async (payload: {
    cartItems: any[];
    invoiceSubtotal?: number;
    customerType?: string;
  }): Promise<{
    ok: boolean;
    appliedPromotions: any[];
    bonusItemsToAdd: any[];
    totalPromotionalDiscount: number;
    upsellNudges: any[];
  }> => {
    return http('/api/driver-portal/van-sales/promotions/evaluate-cart', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  optimizeDriverRoute: async (payload: {
    customerIds?: number[];
    startLat?: number;
    startLng?: number;
    persistSequence?: boolean;
    route?: string;
  }): Promise<{ ok: boolean } & RouteOptimizationResult> => {
    return http('/api/driver-portal/van-sales/routes/optimize', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getDriverAuthHeaders(),
    });
  },

  fetchAdminPromotions: async (filters?: { isActive?: boolean; promoType?: string }): Promise<{ ok: boolean; promotions: FmcgPromotion[] }> => {
    const params = new URLSearchParams();
    if (filters?.isActive !== undefined) params.set('isActive', String(filters.isActive));
    if (filters?.promoType) params.set('promoType', filters.promoType);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return http(`/api/van-sales/admin/promotions${qs}`);
  },

  createAdminPromotion: async (dto: Partial<FmcgPromotion>): Promise<{ ok: boolean; promotion: FmcgPromotion }> => {
    return http('/api/van-sales/admin/promotions', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  updateAdminPromotion: async (id: number, dto: Partial<FmcgPromotion>): Promise<{ ok: boolean; promotion: FmcgPromotion }> => {
    return http(`/api/van-sales/admin/promotions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
  },

  deleteAdminPromotion: async (id: number): Promise<{ ok: boolean }> => {
    return http(`/api/van-sales/admin/promotions/${id}`, {
      method: 'DELETE',
    });
  },

  toggleAdminPromotionActive: async (id: number, isActive: boolean): Promise<{ ok: boolean; promotion: FmcgPromotion }> => {
    return http(`/api/van-sales/admin/promotions/${id}/toggle-active`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  },

  optimizeSupervisorRoute: async (payload: {
    customerIds?: number[];
    route?: string;
    repId?: number;
    startLat?: number;
    startLng?: number;
    persistSequence?: boolean;
  }): Promise<{ ok: boolean } & RouteOptimizationResult> => {
    return http('/api/van-sales/admin/routes/optimize', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

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
