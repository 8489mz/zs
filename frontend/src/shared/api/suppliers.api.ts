import { http } from '@/lib/http';
import { unwrapArray } from '@/lib/api/contracts';
import { buildQueryString } from '@/lib/query-string';
import type { Supplier, SupplierLedger } from '@/types/domain';

export interface SuppliersListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  filter?: 'all' | 'debt' | 'withNotes';
}

export interface SuppliersPageResponse {
  suppliers: Supplier[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: { totalSuppliers: number; totalBalance: number; withNotes: number };
}

export interface SupplierLedgerParams {
  page?: number;
  pageSize?: number;
  search?: string;
  from?: string;
  to?: string;
}

export const suppliersApi = {
  list: async () => unwrapArray<Supplier>(await http<Supplier[] | { suppliers: Supplier[] }>('/api/suppliers'), 'suppliers'),
  listPage: (params: SuppliersListParams) => http<SuppliersPageResponse>(`/api/suppliers${buildQueryString(params)}`),
  listAll: async (params: Omit<SuppliersListParams, 'page' | 'pageSize'> = {}) => {
    const pageSize = 200;
    let page = 1;
    const rows: Supplier[] = [];
    let summary: SuppliersPageResponse['summary'];
    while (true) {
      const payload = await suppliersApi.listPage({ ...params, page, pageSize });
      rows.push(...(payload.suppliers || []));
      summary = payload.summary;
      const totalPages = payload.pagination?.totalPages || 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return { suppliers: rows, summary };
  },
  create: (payload: unknown) => http<Supplier>('/api/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: string, payload: unknown) => http<Supplier>(`/api/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  remove: (id: string) => http<{ ok: boolean }>(`/api/suppliers/${id}`, { method: 'DELETE' }),
  ledger: (id: string, params: SupplierLedgerParams = {}) =>
    http<SupplierLedger>(`/api/reports/suppliers/${id}/ledger${buildQueryString(params)}`),
  listAllLedger: async (id: string, params: Omit<SupplierLedgerParams, 'page' | 'pageSize'> = {}): Promise<SupplierLedger> => {
    const pageSize = 200;
    let page = 1;
    const entries: SupplierLedger['entries'] = [];
    let supplier: SupplierLedger['supplier'];
    let summary: SupplierLedger['summary'];
    let pagination: SupplierLedger['pagination'];
    while (true) {
      const payload = await suppliersApi.ledger(id, { ...params, page, pageSize });
      supplier = payload.supplier;
      summary = payload.summary;
      pagination = payload.pagination;
      entries.push(...(payload.entries || []));
      const totalPages = payload.pagination?.totalPages || 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return { supplier, entries, summary, pagination };
  },
};
