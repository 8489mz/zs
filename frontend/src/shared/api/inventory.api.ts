import { http } from '@/lib/http';
import { unwrapArray, unwrapByKey, type PaginationMeta } from '@/lib/api/contracts';
import type { DamagedStockRecord, InventoryReport, Product, StockCountSession, StockMovementRecord, StockTransfer, Location } from '@/types/domain';
import { buildQueryString } from '@/lib/query-string';

export interface StockMovementsPageQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: 'all' | string;
  productId?: number | string;
  locationId?: number | string;
}

export interface InventoryPageQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: 'all' | string;
  locationId?: string;
}

interface StockMovementsPageResponse {
  stockMovements?: StockMovementRecord[];
  pagination?: PaginationMeta;
  summary?: {
    positive: number;
    negative: number;
    totalItems: number;
  };
}

interface StockTransfersPageResponse {
  stockTransfers?: StockTransfer[];
  pagination?: PaginationMeta;
  summary?: {
    totalItems: number;
    sent: number;
    received: number;
    cancelled: number;
    totalQty: number;
  };
}

interface StockCountSessionsPageResponse {
  stockCountSessions?: StockCountSession[];
  pagination?: PaginationMeta;
  summary?: {
    totalItems: number;
    draft: number;
    posted: number;
    totalVariance: number;
  };
}

interface DamagedStockPageResponse {
  damagedStockRecords?: DamagedStockRecord[];
  pagination?: PaginationMeta;
  summary?: {
    totalItems: number;
    totalQty: number;
  };
}

export const inventoryApi = {
  products: async () => unwrapArray<Product>(await http<Product[] | { products: Product[] }>('/api/products?pageSize=5000&brief=true'), 'products'),
  searchProducts: async (query: string) => unwrapArray<Product>(await http<Product[] | { products: Product[] }>(`/api/products?q=${encodeURIComponent(query)}&pageSize=50`), 'products'),
  locations: async () => unwrapArray<Location>(await http<Location[] | { locations: Location[] }>('/api/locations?includeInactive=true'), 'locations'),
  report: async () => unwrapByKey<InventoryReport>(await http<InventoryReport | { inventory: InventoryReport }>('/api/reports/inventory'), 'inventory', {} as InventoryReport),
  locationStocks: async () => unwrapArray<{ productId: string; locationId: string; qty: number }>(await http<{ stocks: { productId: string; locationId: string; qty: number }[] }>('/api/location-stocks'), 'stocks'),
  // INV-ADJUST-SINGLE-QTY-BASIS: the adjustment dialog's prefill read --
  // the location's available qty on the same basis the adjustment
  // targets (location qty minus reserved plus unassigned available,
  // capped by the global available). Read-only; served by the
  // inventory-permissioned endpoint, not the sales-gated one.
  productAvailability: async (productId: number, locationId: number | null) => http<{ productId: number; locationId: number | null; branchId: number | null; locationQty: number; locationReservedQty: number; unassignedQty: number; unassignedReservedQty: number; availableAtLocation: number; globalAvailable: number }>(`/api/inventory/product-availability?productId=${productId}${locationId != null ? `&locationId=${locationId}` : ''}`),
  locationCategories: async (locationId: number) => unwrapArray<{ id: string; name: string }>(await http<{ categories: { id: string; name: string }[] }>(`/api/locations/${locationId}/categories`), 'categories'),
  locationCategoryProducts: async (locationId: number, categoryId: string | number) => unwrapArray<{ id: string; name: string; barcode: string; stockQty: number; globalStockQty?: number }>(await http<{ products: { id: string; name: string; barcode: string; stockQty: number; globalStockQty?: number }[] }>(`/api/locations/${locationId}/categories/${categoryId}/products`), 'products'),
  assignProductsToLocation: async (locationId: number, productIds: number[]) => await http<{ success: boolean }>(`/api/locations/${locationId}/assign-products`, { method: 'POST', body: JSON.stringify({ productIds }) }),
  removeProductFromLocation: async (locationId: number, productId: number) => await http<{ success: boolean }>(`/api/locations/${locationId}/products/${productId}`, { method: 'DELETE' }),
  createInventoryAdjustment: (payload: unknown, headers?: Record<string, string>) => http('/api/inventory-adjustments', { method: 'POST', body: JSON.stringify(payload), headers }),
  createDamaged: (payload: unknown) => http('/api/damaged-stock', { method: 'POST', body: JSON.stringify(payload) }),
  stockTransfers: async () => unwrapArray<StockTransfer>(await http<StockTransfer[] | { stockTransfers: StockTransfer[] }>('/api/stock-transfers'), 'stockTransfers'),
  stockTransfersPage: async (params: InventoryPageQueryParams = {}) => {
    const response = await http<StockTransfersPageResponse>(`/api/stock-transfers${buildQueryString(params as Record<string, string | number | undefined | null>)}`);
    return {
      rows: Array.isArray(response.stockTransfers) ? response.stockTransfers : [],
      pagination: response.pagination || {
        page: 1,
        pageSize: params.pageSize || 10,
        totalItems: Array.isArray(response.stockTransfers) ? response.stockTransfers.length : 0,
        totalPages: 1,
        rangeStart: Array.isArray(response.stockTransfers) && response.stockTransfers.length ? 1 : 0,
        rangeEnd: Array.isArray(response.stockTransfers) ? response.stockTransfers.length : 0,
      },
      summary: response.summary || { totalItems: 0, sent: 0, received: 0, cancelled: 0, totalQty: 0 },
    };
  },
  listAllTransfers: async (params: InventoryPageQueryParams = {}) => {
    const pageSize = 100;
    let page = 1;
    let totalPages = 1;
    const rows: StockTransfer[] = [];
    do {
      const response = await inventoryApi.stockTransfersPage({ ...params, page, pageSize });
      rows.push(...response.rows);
      totalPages = response.pagination.totalPages || 1;
      page += 1;
    } while (page <= totalPages);
    return rows;
  },
  stockMovements: async () => unwrapArray<StockMovementRecord>(await http<StockMovementRecord[] | { stockMovements: StockMovementRecord[] }>('/api/stock-movements'), 'stockMovements'),
  stockMovementsPage: async (params: StockMovementsPageQueryParams = {}) => {
    const response = await http<StockMovementsPageResponse>(`/api/stock-movements${buildQueryString(params as Record<string, string | number | undefined | null>)}`);
    return {
      rows: Array.isArray(response.stockMovements) ? response.stockMovements : [],
      pagination: response.pagination || {
        page: 1,
        pageSize: params.pageSize || 20,
        totalItems: Array.isArray(response.stockMovements) ? response.stockMovements.length : 0,
        totalPages: 1,
        rangeStart: Array.isArray(response.stockMovements) && response.stockMovements.length ? 1 : 0,
        rangeEnd: Array.isArray(response.stockMovements) ? response.stockMovements.length : 0,
      },
      summary: response.summary || { positive: 0, negative: 0, totalItems: 0 },
    };
  },
  createStockTransfer: (payload: unknown, headers?: Record<string, string>) => http('/api/stock-transfers', { method: 'POST', body: JSON.stringify(payload), headers }),
  internalTransferProducts: (payload: unknown, headers?: Record<string, string>) => http('/api/internal-transfer', { method: 'POST', body: JSON.stringify(payload), headers }),
  internalTransferCategory: (payload: unknown, headers?: Record<string, string>) => http('/api/internal-transfer-category', { method: 'POST', body: JSON.stringify(payload), headers }),
  receiveStockTransfer: (transferId: string, headers?: Record<string, string>, receiptPayload?: { items?: Array<{ itemId: number; receivedQty: number; receivedSerials?: string[]; batchReceipts?: Array<{ transitBatchId: number; receivedQty: number }> }>; varianceReason?: string; approvalSecret?: string }) => http(`/api/stock-transfers/${transferId}/receive`, { method: 'POST', headers, body: JSON.stringify(receiptPayload || {}) }),
  cancelStockTransfer: (transferId: string, headers?: Record<string, string>) => http(`/api/stock-transfers/${transferId}/cancel`, { method: 'POST', headers }),
  stockCountSessions: async () => {
    const payload = await http<{ stockCountSessions?: StockCountSession[]; damagedStockRecords?: DamagedStockRecord[] }>('/api/stock-count-sessions');
    return {
      stockCountSessions: Array.isArray(payload?.stockCountSessions) ? payload.stockCountSessions : [],
      damagedStockRecords: Array.isArray(payload?.damagedStockRecords) ? payload.damagedStockRecords : []
    };
  },
  stockCountSessionsPage: async (params: InventoryPageQueryParams = {}) => {
    const response = await http<StockCountSessionsPageResponse>(`/api/stock-count-sessions${buildQueryString(params as Record<string, string | number | undefined | null>)}`);
    return {
      rows: Array.isArray(response.stockCountSessions) ? response.stockCountSessions : [],
      pagination: response.pagination || {
        page: 1,
        pageSize: params.pageSize || 8,
        totalItems: Array.isArray(response.stockCountSessions) ? response.stockCountSessions.length : 0,
        totalPages: 1,
        rangeStart: Array.isArray(response.stockCountSessions) && response.stockCountSessions.length ? 1 : 0,
        rangeEnd: Array.isArray(response.stockCountSessions) ? response.stockCountSessions.length : 0,
      },
      summary: response.summary || { totalItems: 0, draft: 0, posted: 0, totalVariance: 0 },
    };
  },
  listAllStockCountSessions: async (params: InventoryPageQueryParams = {}) => {
    const pageSize = 100;
    let page = 1;
    let totalPages = 1;
    const rows: StockCountSession[] = [];
    do {
      const response = await inventoryApi.stockCountSessionsPage({ ...params, page, pageSize });
      rows.push(...response.rows);
      totalPages = response.pagination.totalPages || 1;
      page += 1;
    } while (page <= totalPages);
    return rows;
  },
  damagedStockPage: async (params: InventoryPageQueryParams = {}) => {
    const response = await http<DamagedStockPageResponse>(`/api/damaged-stock${buildQueryString(params as Record<string, string | number | undefined | null>)}`);
    return {
      rows: Array.isArray(response.damagedStockRecords) ? response.damagedStockRecords : [],
      pagination: response.pagination || {
        page: 1,
        pageSize: params.pageSize || 10,
        totalItems: Array.isArray(response.damagedStockRecords) ? response.damagedStockRecords.length : 0,
        totalPages: 1,
        rangeStart: Array.isArray(response.damagedStockRecords) && response.damagedStockRecords.length ? 1 : 0,
        rangeEnd: Array.isArray(response.damagedStockRecords) ? response.damagedStockRecords.length : 0,
      },
      summary: response.summary || { totalItems: 0, totalQty: 0 },
    };
  },
  listAllDamagedStock: async (params: InventoryPageQueryParams = {}) => {
    const pageSize = 100;
    let page = 1;
    let totalPages = 1;
    const rows: DamagedStockRecord[] = [];
    do {
      const response = await inventoryApi.damagedStockPage({ ...params, page, pageSize });
      rows.push(...response.rows);
      totalPages = response.pagination.totalPages || 1;
      page += 1;
    } while (page <= totalPages);
    return rows;
  },
  createStockCountSession: (payload: unknown, headers?: Record<string, string>) => http('/api/stock-count-sessions', { method: 'POST', body: JSON.stringify(payload), headers }),
  postStockCountSession: (sessionId: string, payload: unknown) => http(`/api/stock-count-sessions/${sessionId}/post`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteStockCountSession: (sessionId: string) => http(`/api/stock-count-sessions/${sessionId}`, { method: 'DELETE' }),
  transferCategory: (payload: { categoryId: number; fromLocationId: number; toLocationId: number; notes?: string }) => http('/api/transfer-category', { method: 'POST', body: JSON.stringify(payload) }),
  advancedOverview: () => http<any>('/api/inventory/advanced-overview')
};
