import { http } from '@/lib/http';
import { getDriverAuthHeaders } from './van-sales-driver-auth';
import type { RepTargetMetrics } from './van-sales-types-a';
import type {
  CustomerEligibleSale,
  DriverAvailableProduct,
  DriverSaleHistoryItem,
  DriverWarehouse,
  VanActiveTripResponse,
  VanLoadRequisitionRecord,
} from './van-sales-types-b';

export const vanDriverCoreApi = {
  getActiveTrip: async (): Promise<VanActiveTripResponse> => {
    return http<VanActiveTripResponse>('/api/driver-portal/van-sales/active-trip', {
      headers: getDriverAuthHeaders(),
    });
  },

  openTrip: async (payload?: {
    sourceWarehouseId?: number;
    items?: { productId: number; qty: number }[];
    notes?: string;
  }): Promise<{ ok: boolean; tripId: number; totalLoadedValue: number; itemsCount: number }> => {
    return http('/api/driver-portal/van-sales/trips/open', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload || {}),
    });
  },

  executeSale: async (payload: {
    tripId: number;
    customerId?: number;
    customerName?: string;
    customerPhone?: string;
    paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
    paidAmount?: number;
    items: {
      productId: number;
      qty: number;
      unitPrice?: number;
      unitName?: string;
      unitMultiplier?: number;
      isBonus?: boolean;
      bonusReason?: string;
      originalPrice?: number;
      // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: per-line TOTAL
      // discount amount (POS lineDiscount semantics).
      lineDiscount?: number;
    }[];
    notes?: string;
    deliveryGpsLat?: number;
    deliveryGpsLng?: number;
    // INV-VAN-OFFLINE-TIMESTAMPS: why no GPS fix was captured at
    // submit time ('timeout' | 'denied' | 'unavailable').
    gpsMissingReason?: 'timeout' | 'denied' | 'unavailable';
    deliveryProofPhoto?: string;
    packagingBreakdown?: { cartonsCount?: number; piecesCount?: number; itemsCount?: number };
    clientTxId?: string;
    cashDiscountAmount?: number;
    supervisorOverridePin?: string;
    supervisorOverrideReason?: string;
    transferReference?: string;
    transferReceiptUrl?: string;
    recipientName?: string;
    recipientPhone?: string;
    recipientRole?: string;
    recipientSignature?: string;
    // INV-VAN-OFFLINE-TIMESTAMPS: the instant the sale was made
    // offline (outbox createdAt, ISO with offset).
    offlineCreatedAt?: string;
  }): Promise<{
    ok: boolean;
    saleId: number;
    docNo: string;
    total: number;
    subtotal?: number;
    discount?: number;
    // INV-VAN-PRICE-LIST-WIRING: the system cash discount for this
    // sale (server-computed from the tenant setting, after the
    // rep-cap check). Included in `discount` above.
    systemCashDiscountAmount?: number;
    paymentMethod: string;
    customerName: string;
    itemsCount: number;
    cashPaid?: number;
    creditOwed?: number;
  }> => {
    return http('/api/driver-portal/van-sales/sales', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  getDriverSales: async (params?: {
    dateScope?: 'today' | 'yesterday' | 'week' | 'all';
    customerId?: number;
    paymentMethod?: string;
    search?: string;
    tripId?: number;
    // INV-VAN-PROFIT-REP-REPORTING: discounted-invoices-only.
    discountedOnly?: boolean;
  }): Promise<{ ok: boolean; sales: DriverSaleHistoryItem[] }> => {
    const sp = new URLSearchParams();
    if (params?.dateScope) sp.set('dateScope', params.dateScope);
    if (params?.customerId) sp.set('customerId', String(params.customerId));
    if (params?.paymentMethod) sp.set('paymentMethod', params.paymentMethod);
    if (params?.search) sp.set('search', params.search);
    if (params?.tripId) sp.set('tripId', String(params.tripId));
    if (params?.discountedOnly) sp.set('discountedOnly', 'true');
    const qs = sp.toString();
    return http(`/api/driver-portal/van-sales/sales${qs ? '?' + qs : ''}`, {
      method: 'GET',
      headers: getDriverAuthHeaders(),
    });
  },

  recordCollection: async (payload: {
    tripId: number;
    customerId: number;
    amount: number;
    paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer';
    transferReference?: string;
    transferReceiptUrl?: string;
    notes?: string;
    gpsLat?: number;
    gpsLng?: number;
    // INV-VAN-OFFLINE-TIMESTAMPS: the instant the collection was made
    // offline (outbox createdAt, ISO with offset).
    offlineCreatedAt?: string;
  }): Promise<{
    ok: boolean;
    receiptNo: string;
    amount: number;
    customerName: string;
    newBalance: number;
  }> => {
    return http('/api/driver-portal/van-sales/collections', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  executeDamagedSwap: async (
    tripId: number,
    payload: {
      customerId?: number;
      damagedProductId: number;
      damagedQty: number;
      damageReason?: string;
      replacementProductId: number;
      replacementQty: number;
      notes?: string;
    },
  ): Promise<{
    ok: boolean;
    swapId: number;
    damagedProductName: string;
    replacementProductName: string;
    damagedQty: number;
    replacementQty: number;
    priceDifference: number;
    messageAr: string;
  }> => {
    return http(`/api/driver-portal/van-sales/trips/${tripId}/damaged-swap`, {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  listTripDamagedSwaps: async (
    tripId: number,
  ): Promise<{
    ok: boolean;
    swaps: Array<{
      id: number;
      tripId: number;
      repId: number;
      customerId?: number | null;
      customerName?: string;
      damagedProductId: number;
      damagedProductName: string;
      damagedQty: number;
      damageReason: string;
      replacementProductId: number;
      replacementProductName: string;
      replacementQty: number;
      priceDifference: number;
      notes?: string | null;
      createdAt: string;
    }>;
  }> => {
    return http(`/api/driver-portal/van-sales/trips/${tripId}/damaged-swaps`, {
      headers: getDriverAuthHeaders(),
    });
  },

  getCustomerEligibleSales: async (customerId: number): Promise<CustomerEligibleSale[]> => {
    const res = await http<{ ok: boolean; sales: CustomerEligibleSale[] }>(
      `/api/driver-portal/van-sales/customers/${customerId}/eligible-sales`,
      { headers: getDriverAuthHeaders() },
    );
    return res.sales || [];
  },

  submitFieldReturn: async (payload: {
    tripId: number;
    customerId: number;
    // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: the original invoice is
    // REQUIRED for a new van field return — unlinked returns are
    // refused by the server (RETURN_REQUIRES_SALE_ID).
    saleId: number;
    returnReason: 'damaged' | 'expired' | 'manufacturing_defect' | 'stagnant' | 'order_mismatch' | 'customer_request';
    refundMethod?: 'credit' | 'cash';
    items: { productId: number; qty: number; unitPrice: number; saleItemId?: number }[];
    notes?: string;
    // INV-VAN-OFFLINE-TIMESTAMPS: the instant the return was made
    // offline (outbox createdAt, ISO with offset).
    offlineCreatedAt?: string;
  }): Promise<{ ok: boolean; returnDocNo: string; returnId: number; status: string; totalAmount: number }> => {
    return http('/api/driver-portal/van-sales/field-returns', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  submitLoadRequisition: async (payload: {
    sourceWarehouseId?: number;
    items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
    notes?: string;
  }): Promise<{ ok: boolean; docNo: string; requisitionId: number }> => {
    return http('/api/driver-portal/van-sales/requisitions', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },

  listMyRequisitions: async (): Promise<VanLoadRequisitionRecord[]> => {
    const res = await http<{ ok: boolean; requisitions: VanLoadRequisitionRecord[] }>(
      '/api/driver-portal/van-sales/requisitions',
      { headers: getDriverAuthHeaders() },
    );
    return res.requisitions || [];
  },

  cancelMyRequisition: async (id: number): Promise<{
    ok: boolean;
    requisitionId: number;
    docNo: string;
    previousItems: any[];
    notes?: string;
    sourceWarehouseId?: number;
  }> => {
    return http(`/api/driver-portal/van-sales/requisitions/${id}`, {
      method: 'DELETE',
      headers: getDriverAuthHeaders(),
    });
  },

  getWarehouses: async (): Promise<DriverWarehouse[]> => {
    const res = await http<{ ok: boolean; warehouses: DriverWarehouse[] }>(
      '/api/driver-portal/van-sales/warehouses',
      { headers: getDriverAuthHeaders() },
    );
    return res.warehouses || [];
  },

  getAvailableProducts: async (warehouseId?: string): Promise<DriverAvailableProduct[]> => {
    const query = warehouseId && warehouseId !== 'all' ? `?warehouseId=${warehouseId}` : '';
    const res = await http<{ ok: boolean; products: DriverAvailableProduct[] }>(
      `/api/driver-portal/van-sales/available-products${query}`,
      { headers: getDriverAuthHeaders() },
    );
    return res.products || [];
  },

  getMyTarget: async (month?: string): Promise<{ repId: number; repName: string; metrics: RepTargetMetrics }> => {
    return http(`/api/driver-portal/van-sales/my-target${month ? `?month=${month}` : ''}`, {
      headers: getDriverAuthHeaders(),
    });
  },

  settleTrip: async (payload: {
    tripId: number;
    countedCash: number;
    // INV-VAN-DAILY-SPLIT-SETTLEMENT: counted cash split per tenant
    // day; omitted for a single-day trip (legacy lump path).
    perDayCash?: { businessDay: string; countedCash: number }[];
    unloadRemainingToWarehouse: boolean;
    countedStock?: { productId: number; countedQty: number }[];
    // INV-VAN-SELF-SETTLE-PIN-REQUIRED: the rep's phone never sends a
    // charge/waive decision. nightStockApproved is the supervisor's
    // explicit approval (authorized by the supervisor PIN) to keep
    // remaining stock in the van overnight instead of unloading it.
    nightStockApproved?: boolean;
    endOdometer?: number;
    activeVisitCustomerId?: number;
    notes?: string;
    supervisorPin?: string;
  }): Promise<{
    ok: boolean;
    tripId: number;
    expectedCash: number;
    countedCash: number;
    dailySplit?: Array<{ businessDay: string; due: number; countedCash: number; remittedCash: number }>;
    tripExpenses?: number;
    variance: number;
    stockVarianceAmount?: number;
    unloadedItemsCount: number;
    distanceKm?: number;
    status: 'settled';
    cashierName?: string;
    cashierId?: number | null;
    repName?: string;
    settledAt?: string;
    salesAmount?: number;
    cashSales?: number;
    creditSales?: number;
    collectionsTotal?: number;
    returnsAmount?: number;
    cashRefunds?: number;
    creditReturns?: number;
    stockVariances?: Array<{
      productId: number;
      productName: string;
      systemQty: number;
      countedQty?: number;
      varianceQty: number;
      costPrice: number;
      varianceCost: number;
      status: string;
    }>;
  }> => {
    return http('/api/driver-portal/van-sales/trips/settle', {
      method: 'POST',
      headers: getDriverAuthHeaders(),
      body: JSON.stringify(payload),
    });
  },
};
