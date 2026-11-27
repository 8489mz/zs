import { http } from '@/lib/http';
import { unwrapArray, unwrapEntity, type PaginationMeta } from '@/lib/api/contracts';
import type { Product, Sale } from '@/types/domain';
import { buildQueryString } from '@/lib/query-string';

type SalesEnvelope = { sale: Sale };
type SalesMutationEnvelope = { ok?: boolean; sale: Sale };

export interface SalesListSummary {
  totalItems: number;
  totalSales: number;
  todaySalesCount: number;
  todaySalesTotal: number;
  cashTotal: number;
  creditTotal: number;
  cancelledCount: number;
  cashiers: string[];
  topCustomers: Array<{ name: string; total: number; count: number }>;
}

export type SalesListFilter = 'all' | 'cash' | 'card' | 'credit' | 'wallet' | 'instapay' | 'mixed' | 'cancelled';

export interface SalesListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: SalesListFilter;
  cashier?: string;
  // INV-VAN-SALES-LIST-DATE-FILTER: bare YYYY-MM-DD dates; the server
  // expands each to the whole tenant day (from = tenant midnight,
  // to = tenant 23:59:59.999). Sent verbatim via buildQueryString.
  dateFrom?: string;
  dateTo?: string;
}

interface SalesListResponse {
  sales?: Sale[];
  pagination?: PaginationMeta;
  summary?: SalesListSummary;
}

const defaultSummary: SalesListSummary = {
  totalItems: 0,
  totalSales: 0,
  todaySalesCount: 0,
  todaySalesTotal: 0,
  cashTotal: 0,
  creditTotal: 0,
  cancelledCount: 0,
  cashiers: [],
  topCustomers: [],
};

export const salesApi = {
  list: async () => unwrapArray<Sale>(await http<Sale[] | { sales: Sale[] }>('/api/sales'), 'sales'),
  listPage: async (params: SalesListParams = {}) => {
    const response = await http<SalesListResponse>(`/api/sales${buildQueryString(params)}`);
    const sales = Array.isArray(response.sales) ? response.sales : [];
    const page = response.pagination?.page || params.page || 1;
    const pageSize = response.pagination?.pageSize || params.pageSize || 30;
    const totalItems = response.pagination?.totalItems ?? sales.length;
    const totalPages = response.pagination?.totalPages || Math.max(1, Math.ceil(totalItems / pageSize));
    const rangeStart = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
    const rangeEnd = totalItems > 0 ? Math.min(page * pageSize, totalItems) : 0;

    return {
      rows: sales,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        rangeStart: response.pagination?.rangeStart != null && response.pagination.rangeStart > 0 ? response.pagination.rangeStart : rangeStart,
        rangeEnd: response.pagination?.rangeEnd != null && response.pagination.rangeEnd > 0 ? response.pagination.rangeEnd : rangeEnd,
      },
      summary: response.summary || defaultSummary,
    };
  },
  listAll: async (params: Omit<SalesListParams, 'page' | 'pageSize'> = {}) => {
    const firstPage = await salesApi.listPage({ ...params, page: 1, pageSize: 200 });
    const allRows = [...firstPage.rows];
    const totalPages = firstPage.pagination?.totalPages || 1;
    for (let page = 2; page <= totalPages; page += 1) {
      const nextPage = await salesApi.listPage({ ...params, page, pageSize: 200 });
      allRows.push(...nextPage.rows);
    }
    return { rows: allRows, summary: firstPage.summary, pagination: firstPage.pagination };
  },
  products: async () => unwrapArray<Product>(await http<Product[] | { products: Product[] }>('/api/products'), 'products'),
  getById: async (saleId: string) => unwrapEntity<Sale>(await http<Sale | SalesEnvelope>(`/api/sales/${saleId}`), 'sale'),
  create: async (payload: unknown) => unwrapEntity<Sale>(await http<Sale | SalesMutationEnvelope>('/api/sales', { method: 'POST', body: JSON.stringify(payload) }), 'sale'),
  cancel: async (saleId: string, reason: string, managerPin: string) => unwrapEntity<Sale>(await http<Sale | SalesMutationEnvelope>(`/api/sales/${saleId}/cancel`, { method: 'POST', body: JSON.stringify({ reason, managerPin }) }), 'sale'),
  update: async (saleId: string, payload: unknown) => unwrapEntity<Sale>(await http<Sale | SalesMutationEnvelope>(`/api/sales/${saleId}`, { method: 'PUT', body: JSON.stringify(payload) }), 'sale'),
  // INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK: the ONLY writer of a posted
  // sale's payment legs, besides the original sale insert. updateSale
  // never touches the legs; a money correction comes here.
  adjustPayments: async (saleId: string, payload: { payments: Array<{ paymentChannel: string; amount: number }>; reason: string; managerPin?: string }) => unwrapEntity<Sale>(await http<Sale | SalesMutationEnvelope>(`/api/sales/${saleId}/payment-adjustment`, { method: 'POST', body: JSON.stringify(payload) }), 'sale')
};
