import { http, ApiError } from '@/lib/http';
import { unwrapArray, unwrapByKey, unwrapEntity } from '@/lib/api/contracts';
import type { AppSettings, Branch, Customer, Location, Product, Sale } from '@/types/domain';
import type { HeldPosDraft } from '@/features/pos/hooks/usePosWorkspace';

type SaleMutationEnvelope = { ok?: boolean; sale?: Sale; saleId?: number };
type PosLookupParams = {
  q?: string;
  barcode?: string;
  branchId?: string;
  locationId?: string;
  limit?: number;
  view?: 'offers' | string;
  fullCatalog?: boolean;
  categoryId?: string | number;
};

export interface PosCustomerSummary {
  customerId: string;
  balance: number;
  creditLimit: number;
  remainingCredit: number | null;
  storeCreditBalance: number;
  loyaltyPoints?: number;
  customerType: string;
  lastSaleAt: string | null;
  totalSalesAmount: number;
  invoiceCount: number;
  averageInvoice: number;
  returnCount: number;
}

export interface PosCustomerDeliveryProfileItem {
  id: number;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  unitName: string;
  unitMultiplier: number;
  modifiers?: any[];
  notes?: string;
}

export interface PosCustomerDeliveryProfileOrder {
  id: number;
  docNo: string;
  total: number;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  orderType: string;
  customerAddress: string;
  note: string;
  createdAt: string;
  branchName?: string;
  items: PosCustomerDeliveryProfileItem[];
}

export interface PosCustomerDeliveryProfile {
  found: boolean;
  isExactMatch?: boolean;
  isMultipleMatches?: boolean;
  query?: string;
  phone?: string;
  customer?: {
    id: string;
    name: string;
    phone: string;
    address: string;
    customerType: string;
    balance: number;
    creditLimit: number;
    storeCreditBalance: number;
    loyaltyPoints: number;
    companyName: string;
    taxNumber: string;
    notes: string;
    preferences: string;
  };
  matchedCustomers?: Array<{
    id: string;
    name: string;
    phone: string;
    address: string;
    customerType: string;
    balance: number;
    loyaltyPoints: number;
  }>;
  addresses: string[];
  recentOrders: PosCustomerDeliveryProfileOrder[];
  stats?: {
    totalSalesAmount: number;
    invoiceCount: number;
    averageInvoice: number;
    lastSaleAt: string | null;
  };
}

function shouldRetrySaleWithFallback(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 400) return false;
  const message = String(error.message || '').trim();
  return !message || message === 'البيانات المرسلة غير صحيحة.' || message === 'تعذر تنفيذ العملية المطلوبة.';
}

async function postSale(payload: unknown, headers?: Record<string, string>) {
  const result = await http<Sale | SaleMutationEnvelope>('/api/sales', { method: 'POST', body: JSON.stringify(payload), headers });
  if ('saleId' in result && result.saleId && !result.sale) {
    // The idempotency interceptor replays the committed operation reference.
    // Fetch the original posted invoice so retries have the same response shape.
    return unwrapEntity<Sale>(await http<Sale | { sale: Sale }>(`/api/sales/${result.saleId}`), 'sale');
  }
  return unwrapEntity<Sale>(result, 'sale');
}

function buildPosLookupPath(params: PosLookupParams = {}) {
  const searchParams = new URLSearchParams();
  const q = String(params.q || '').trim();
  const barcode = String(params.barcode || '').trim();
  const branchId = String(params.branchId || '').trim();
  const locationId = String(params.locationId || '').trim();
  const limit = Number(params.limit || 0);
  const view = String(params.view || '').trim();
  const categoryId = String(params.categoryId ?? '').trim();

  if (q) searchParams.set('q', q);
  if (barcode) searchParams.set('barcode', barcode);
  if (branchId) searchParams.set('branchId', branchId);
  if (locationId) searchParams.set('locationId', locationId);
  if (limit > 0) searchParams.set('limit', String(limit));
  if (view) searchParams.set('view', view);
  if (params.fullCatalog) searchParams.set('fullCatalog', 'true');
  if (categoryId) searchParams.set('categoryId', categoryId);

  const query = searchParams.toString();
  return `/api/catalog/pos-products${query ? `?${query}` : ''}`;
}

export const posApi = {
  getSaleForExchange: (id: number) => http<{ sale: {
    id: string; customerId: string; branchId: string; status: string;
    total: number; paidAmount: number; storeCreditUsed: number;
    items: Array<{ id: string; productId: string; name: string; qty: number;
      total: number; netLineTotal: number | null; allocatedTax: number | null; serials: string[] }>;
  } }>(`/api/sales/${id}`),
  getCatalogVersion: () => http<{ version: string; totalCount: number; lastUpdatedAt: string }>('/api/catalog/pos-products/version'),
  lookupProducts: async (params: PosLookupParams = {}) => unwrapArray<Product>(await http<Product[] | { products: Product[] }>(buildPosLookupPath(params)), 'products'),
  customers: async (params?: { search?: string; limit?: number; recentIds?: string[] }) => {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set('search', params.search);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.recentIds?.length) searchParams.set('recentIds', params.recentIds.join(','));
    const query = searchParams.toString();
    return unwrapArray<Customer>(await http<Customer[] | { customers: Customer[] }>(`/api/customers${query ? `?${query}` : ''}`), 'customers');
  },
  customerPosSummary: (customerId: string) => http<PosCustomerSummary>(`/api/customers/${customerId}/pos-summary`),
  customerDeliveryLookup: (phone: string) => http<PosCustomerDeliveryProfile>(`/api/customers/delivery-lookup?phone=${encodeURIComponent(phone)}`),
  customerDeliveryProfile: (customerId: string | number) => http<PosCustomerDeliveryProfile>(`/api/customers/${customerId}/delivery-profile`),
  addCustomerAddress: (customerId: string | number, address: string) =>
    http<{ ok: boolean; addresses: string[] }>(`/api/customers/${customerId}/addresses`, {
      method: 'POST',
      body: JSON.stringify({ address }),
    }),
  deleteCustomerAddress: (customerId: string | number, address: string) =>
    http<{ ok: boolean; addresses: string[] }>(`/api/customers/${customerId}/addresses`, {
      method: 'DELETE',
      body: JSON.stringify({ address }),
    }),
  settings: async () => unwrapByKey<AppSettings>(await http<AppSettings | { settings: AppSettings }>('/api/settings'), 'settings', {} as AppSettings),
  branches: async () => unwrapArray<Branch>(await http<Branch[] | { branches: Branch[] }>('/api/branches'), 'branches'),
  locations: async () => unwrapArray<Location>(await http<Location[] | { locations: Location[] }>('/api/locations'), 'locations'),
  authorizeDiscountOverride: async (secret: string) => http('/api/sales/discount-authorization', { method: 'POST', body: JSON.stringify({ secret }) }),
  logSecurityEvent: async (payload: {
    eventType: 'no_sale' | 'cart_remove' | 'draft_cancel';
    branchId?: number;
    managerPin?: string;
    productId?: number;
    productName?: string;
    qty?: number;
    total?: number;
    cartItemsCount?: number;
    note?: string;
  }) => http('/api/sales/pos-audit-event', { method: 'POST', body: JSON.stringify(payload) }),
  createSale: async (payload: unknown, legacyPayload?: unknown, headers?: Record<string, string>) => {
    try {
      return await postSale(payload, headers);
    } catch (error) {
      // A keyed checkout may already be committed even when the response is lost.
      // Changing payload or key for a fallback would bypass server idempotency.
      if (headers?.['x-idempotency-key']) throw error;
      if (!legacyPayload || !shouldRetrySaleWithFallback(error)) throw error;
      // R4-C I51: the minimal-payload leg is deleted — a retry that drops
      // modifiers and sale terms would post a modifier sale at base price.
      // The legacy payload is the only retry leg; it preserves them.
      return await postSale(legacyPayload);
    }
  },
  // Resolves what actually happened to a previously submitted sale for a given idempotency key.
  // Used by the offline sync recovery path so a stale reservation is never resubmitted blindly.
  getSaleOperationStatus: async (idempotencyKey: string) =>
    http<{ status: string; documentId?: string | null; response?: unknown; retryAfterMs?: number }>(
      `/api/operations/${encodeURIComponent('POST:/api/sales')}/${encodeURIComponent(idempotencyKey)}/status`,
    ),
  listHeldDrafts: async () => unwrapArray<HeldPosDraft>(await http<HeldPosDraft[] | { heldSales: HeldPosDraft[] }>('/api/held-sales'), 'heldSales'),
  saveHeldDraft: async (payload: unknown) => unwrapEntity<HeldPosDraft>(await http<HeldPosDraft | { draft: HeldPosDraft }>('/api/held-sales', { method: 'POST', body: JSON.stringify(payload) }), 'draft'),
  deleteHeldDraft: async (draftId: string) => http(`/api/held-sales/${draftId}`, { method: 'DELETE' }),
  clearHeldDrafts: async () => http('/api/held-sales', { method: 'DELETE' }),
  listTerminals: async () => http<{ success: boolean; data: any[] }>('/api/sales/pos/terminals'),
  initiateTerminalCharge: async (payload: { terminalId?: string; amount: number; currency?: string; invoiceReference?: string }) =>
    http<{ success: boolean; data: any }>('/api/sales/pos/terminals/charge', { method: 'POST', body: JSON.stringify(payload) }),
  checkTerminalStatus: async (transactionId: string) =>
    http<{ success: boolean; data: any }>(`/api/sales/pos/terminals/status/${encodeURIComponent(transactionId)}`),
  cancelTerminalCharge: async (transactionId: string) =>
    http<{ success: boolean; data: any }>(`/api/sales/pos/terminals/cancel/${encodeURIComponent(transactionId)}`, { method: 'POST' }),
  testTerminalConnection: async (payload: { ip?: string; port?: number; provider?: string }) =>
    http<{
      success: boolean;
      data: {
        reachable: boolean;
        pingSucceeded: boolean;
        portOpen: boolean;
        ip: string;
        port: number;
        latencyMs?: number;
        message: string;
        details?: string;
        provider?: string;
      };
    }>('/api/sales/pos/terminals/test-connection', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
