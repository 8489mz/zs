import { http } from '@/lib/http';
import { unwrapArray, unwrapEntity, type PaginationMeta } from '@/lib/api/contracts';
import type { Product, Purchase, Supplier } from '@/types/domain';
import { buildQueryString } from '@/lib/query-string';

type PurchaseEnvelope = { purchase: Purchase };
type PurchaseMutationEnvelope = { ok?: boolean; purchase: Purchase };

export interface PurchaseRepricingInsightRow {
  productId: number;
  name: string;
  itemKind: 'standard' | 'fashion';
  styleCode: string;
  previousCost: number;
  newCost: number;
  costChangePercent: number;
  retailPrice: number;
  wholesalePrice: number;
  recommendedRetailPrice: number;
  recommendedWholesalePrice: number;
  recommendedRetailDelta: number;
  recommendedWholesaleDelta: number;
}

export interface PurchaseRepricingInsights {
  purchaseId: number;
  supplierId: number;
  supplierName: string;
  affectedCount: number;
  increasedCount: number;
  decreasedCount: number;
  unchangedCount: number;
  productIds: number[];
  rows: PurchaseRepricingInsightRow[];
}

export interface PurchaseMutationResult {
  ok?: boolean;
  purchase: Purchase;
  repricingInsights?: PurchaseRepricingInsights | null;
}

export interface PurchasesListSummary {
  totalItems: number;
  totalAmount: number;
  creditTotal: number;
  cancelledCount: number;
  posted: number;
  draft: number;
  topSuppliers: Array<{ name: string; total: number; count: number }>;
}

export interface PurchasesListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: 'all' | 'cash' | 'credit' | 'cancelled';
}

interface PurchasesListResponse {
  purchases?: Purchase[];
  pagination?: PaginationMeta;
  summary?: PurchasesListSummary;
}


const defaultSummary: PurchasesListSummary = {
  totalItems: 0,
  totalAmount: 0,
  creditTotal: 0,
  cancelledCount: 0,
  posted: 0,
  draft: 0,
  topSuppliers: [],
};

export const purchasesApi = {
  list: async () => unwrapArray<Purchase>(await http<Purchase[] | { purchases: Purchase[] }>('/api/purchases'), 'purchases'),
  listPage: async (params: PurchasesListParams = {}) => {
    const response = await http<PurchasesListResponse>(`/api/purchases${buildQueryString(params)}`);
    return {
      rows: Array.isArray(response.purchases) ? response.purchases : [],
      pagination: response.pagination || {
        page: 1,
        pageSize: params.pageSize || 25,
        totalItems: Array.isArray(response.purchases) ? response.purchases.length : 0,
        totalPages: 1,
        rangeStart: Array.isArray(response.purchases) && response.purchases.length ? 1 : 0,
        rangeEnd: Array.isArray(response.purchases) ? response.purchases.length : 0,
      },
      summary: response.summary || defaultSummary,
    };
  },
  listAll: async (params: Omit<PurchasesListParams, 'page' | 'pageSize'> = {}) => {
    const firstPage = await purchasesApi.listPage({ ...params, page: 1, pageSize: 200 });
    const allRows = [...firstPage.rows];
    const totalPages = firstPage.pagination?.totalPages || 1;
    for (let page = 2; page <= totalPages; page += 1) {
      const nextPage = await purchasesApi.listPage({ ...params, page, pageSize: 200 });
      allRows.push(...nextPage.rows);
    }
    return { rows: allRows, summary: firstPage.summary, pagination: firstPage.pagination };
  },
  products: async () => unwrapArray<Product>(await http<Product[] | { products: Product[] }>('/api/products?pageSize=5000'), 'products'),
  searchProducts: async (query: string) => unwrapArray<Product>(await http<Product[] | { products: Product[] }>(`/api/products?q=${encodeURIComponent(query)}&pageSize=100&identityOnly=true`), 'products'),
  suppliers: async () => unwrapArray<Supplier>(await http<Supplier[] | { suppliers: Supplier[] }>('/api/suppliers'), 'suppliers'),
  getById: async (purchaseId: string) => unwrapEntity<Purchase>(await http<Purchase | PurchaseEnvelope>(`/api/purchases/${purchaseId}`), 'purchase'),
  create: async (payload: unknown, headers?: Record<string, string>) => {
    const response = await http<Purchase | PurchaseMutationResult>('/api/purchases', { method: 'POST', headers, body: JSON.stringify(payload) });
    if (response && typeof response === 'object' && 'purchase' in response) return response as PurchaseMutationResult;
    return { purchase: response as Purchase, repricingInsights: null } satisfies PurchaseMutationResult;
  },
  cancel: async (purchaseId: string, reason: string, managerPin: string) => unwrapEntity<Purchase>(await http<Purchase | PurchaseMutationEnvelope>(`/api/purchases/${purchaseId}/cancel`, { method: 'POST', body: JSON.stringify({ reason, managerPin }) }), 'purchase'),
  update: async (purchaseId: string, payload: unknown) => {
    const response = await http<Purchase | PurchaseMutationResult>(`/api/purchases/${purchaseId}`, { method: 'PUT', body: JSON.stringify(payload) });
    if (response && typeof response === 'object' && 'purchase' in response) return response as PurchaseMutationResult;
    return { purchase: response as Purchase, repricingInsights: null } satisfies PurchaseMutationResult;
  },
  uploadAttachment: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return http<{ fileName: string; fileUrl: string; fileSize: number; fileType: string }>('/api/purchases/attachments/upload', {
      method: 'POST',
      body: formData,
    });
  },
  receiveGoods: async (purchaseId: string, receivedItems: { itemId: number; receivedQty: number; serials?: any[] }[]) => {
    return http<{ purchaseId: number; lifecycleStatus: string; matchedStatus: string }>(`/api/purchases/${purchaseId}/receive-goods`, {
      method: 'POST',
      body: JSON.stringify({ receivedItems }),
    });
  },
  getReorderSuggestions: async (params: ReorderSuggestionsParams = {}) => {
    return http<ReorderAnalysisResult>(`/api/purchases/reorder/suggestions${buildQueryString(params as any)}`);
  },
  generateDraftOrders: async (payload: GenerateDraftOrdersPayload) => {
    return http<GenerateDraftOrdersResponse>('/api/purchases/reorder/generate-drafts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getLandedCosts: async (purchaseId: string | number) => {
    return http<PurchaseLandedCostDetails>(`/api/purchases/${purchaseId}/landed-costs`);
  },
  applyLandedCosts: async (purchaseId: string | number, data: ApplyPurchaseLandedCostsInput) => {
    return http<PurchaseLandedCostDetails>(`/api/purchases/${purchaseId}/landed-costs`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

export interface PurchaseLandedCostItem {
  id?: number;
  costType: 'freight' | 'customs' | 'handling' | 'insurance' | 'other';
  description: string;
  amount: number;
  vendorId?: number | null;
  allocationMethod?: 'value' | 'qty' | 'equal';
}

export interface PurchaseLandedCostDetails {
  purchase: {
    id: number;
    docNo: string | null;
    supplierId: number | null;
    supplierName: string;
    subtotal: number;
    total: number;
    landedCostTotal: number;
    landedCostAllocationMethod: 'value' | 'qty' | 'equal';
    landedCostNotes: string;
    landedCostAppliedAt: string | null;
    createdAt: string;
  };
  costs: PurchaseLandedCostItem[];
  items: Array<{
    id: number;
    productId: number | null;
    productName: string;
    qty: number;
    unitCost: number;
    lineTotal: number;
    unitName: string;
    allocatedLandedCost: number;
    landedUnitCost: number;
  }>;
}

export interface ApplyPurchaseLandedCostsInput {
  allocationMethod: 'value' | 'qty' | 'equal';
  notes?: string;
  costs: Array<{
    costType: 'freight' | 'customs' | 'handling' | 'insurance' | 'other';
    description: string;
    amount: number;
    vendorId?: number | null;
  }>;
}

export interface ReorderItemSuggestion {
  productId: number;
  name: string;
  barcode: string;
  categoryName: string;
  currentStock: number;
  minStock: number;
  costPrice: number;
  retailPrice: number;
  qtySoldPeriod: number;
  dailyRunRate: number;
  daysRemaining: number;
  leadTimeDays: number;
  leadTimeDemand: number;
  safetyStock: number;
  reorderPoint: number;
  urgency: 'out_of_stock' | 'critical' | 'warning' | 'healthy' | 'overstocked';
  needsReorder: boolean;
  suggestedQty: number;
  estimatedTotalCost: number;
  supplierId: number | null;
  supplierName: string;
  supplierPhone: string;
  defaultLocationId: number | null;
}

export interface SupplierReorderGroup {
  supplierId: number | null;
  supplierName: string;
  supplierPhone: string;
  leadTimeDays: number;
  itemsCount: number;
  criticalCount: number;
  totalSuggestedQty: number;
  totalEstimatedCost: number;
  items: ReorderItemSuggestion[];
}

export interface ReorderAnalysisSummary {
  totalMonitoredProducts: number;
  needsReorderCount: number;
  outOfStockCount: number;
  criticalCount: number;
  warningCount: number;
  healthyCount: number;
  overstockedCount: number;
  totalEstimatedProcurementCost: number;
  suppliersCount: number;
  daysAnalysis: number;
  targetCoverageDays: number;
}

export interface ReorderAnalysisResult {
  summary: ReorderAnalysisSummary;
  supplierGroups: SupplierReorderGroup[];
  allSuggestions: ReorderItemSuggestion[];
}

export interface ReorderSuggestionsParams {
  daysAnalysis?: number;
  targetCoverageDays?: number;
  defaultLeadTimeDays?: number;
  supplierId?: number;
  urgencyFilter?: 'all' | 'needs_reorder' | 'out_of_stock' | 'critical' | 'warning';
  search?: string;
}

export interface GenerateDraftOrdersPayload {
  orders: Array<{
    supplierId: number;
    locationId?: number;
    notes?: string;
    note?: string;
    items: Array<{
      productId: number;
      qty: number;
      quantity?: number;
      cost?: number;
      costPrice?: number;
      name?: string;
      productName?: string;
    }>;
  }>;
  notes?: string;
}

export interface GenerateDraftOrdersResponse {
  ok: boolean;
  count: number;
  orders?: Array<{
    id: number;
    docNo?: string;
    supplierId: number;
    supplierName?: string;
    total: number;
    itemsCount: number;
    status: string;
    lifecycleStatus: string;
  }>;
  createdOrders: Array<{
    id: number;
    docNo?: string;
    supplierId: number;
    supplierName?: string;
    total: number;
    itemsCount: number;
    status: string;
    lifecycleStatus: string;
  }>;
}

export interface DuplicateBillMatch {
  purchaseId: number;
  docNo: string;
  supplierInvoiceNo?: string;
  total: number;
  date: string;
  reason: 'exact_invoice_no' | 'similar_invoice_no' | 'identical_amount_recent';
  severity: 'blocking' | 'warning';
  message: string;
}

export interface DuplicateBillCheckResult {
  hasDuplicates: boolean;
  hasBlockingDuplicates: boolean;
  hasSuspiciousDuplicates: boolean;
  matches: DuplicateBillMatch[];
}

export interface CheckDuplicateBillParams {
  supplierId: number;
  supplierInvoiceNo?: string;
  total?: number;
  date?: string;
  excludePurchaseId?: number;
}

export async function checkDuplicateBill(params: CheckDuplicateBillParams): Promise<DuplicateBillCheckResult> {
  const query = buildQueryString({
    supplierId: params.supplierId,
    supplierInvoiceNo: params.supplierInvoiceNo || undefined,
    total: params.total !== undefined ? params.total : undefined,
    date: params.date || undefined,
    excludePurchaseId: params.excludePurchaseId || undefined,
  });
  return http<DuplicateBillCheckResult>(`/api/purchases/check-duplicate${query}`);
}