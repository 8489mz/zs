import { http } from '@/lib/http';
import { getDriverAuthHeaders } from './van-sales-driver-auth';
import type {
  FmcgPromotion,
  RouteOptimizationResult,
  VanFraudRadarEvent,
  VanFraudRadarSummaryResponse,
} from './van-sales-types-d';

export const vanFraudPromotionsApi = {
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
};
