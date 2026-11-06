import { http } from '@/lib/http';
import { unwrapArray } from '@/lib/api/contracts';
import { buildQueryString } from '@/lib/query-string';
import type { Customer, CustomerLedger } from '@/types/domain';

export interface CustomersListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  filter?: 'all' | 'vip' | 'debt' | 'cash';
}

export interface CustomersPageResponse {
  customers: Customer[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: { totalCustomers: number; totalBalance: number; totalCredit: number; vipCount: number };
}

export const customersApi = {
  list: async () => unwrapArray<Customer>(await http<Customer[] | { customers: Customer[] }>('/api/customers'), 'customers'),
  listPage: (params: CustomersListParams) => http<CustomersPageResponse>(`/api/customers${buildQueryString(params)}`),
  listAll: async (params: Omit<CustomersListParams, 'page' | 'pageSize'> = {}) => {
    const pageSize = 200;
    let page = 1;
    const rows: Customer[] = [];
    let summary: CustomersPageResponse['summary'];
    while (true) {
      const payload = await customersApi.listPage({ ...params, page, pageSize });
      rows.push(...(payload.customers || []));
      summary = payload.summary;
      const totalPages = payload.pagination?.totalPages || 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return { customers: rows, summary };
  },
  create: (payload: unknown) => http<Customer>('/api/customers', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: string, payload: unknown) => http<Customer>(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  remove: (id: string) => http<{ ok: boolean }>(`/api/customers/${id}`, { method: 'DELETE' }),
  balances: async () => unwrapArray<Customer>(await http<Customer[] | { customers: Customer[] }>('/api/reports/customer-balances'), 'customers'),
  ledger: (id: string) => http<CustomerLedger>(`/api/reports/customers/${id}/ledger`),
  addresses: (id: string) => http<string[]>(`/api/customers/${id}/addresses`),
  getLoyaltyHistory: (id: string | number) => http<{ ok: boolean; logs: any[] }>(`/api/customers/${id}/loyalty/history`),
  adjustLoyaltyPoints: (id: string | number, pointsChange: number, notes?: string, actionType?: 'earn' | 'redeem' | 'manual_adjust') =>
    http<{ ok: boolean; balance: number }>(`/api/customers/${id}/loyalty/adjust`, {
      method: 'POST',
      body: JSON.stringify({ pointsChange, notes, actionType }),
    }),
  getInactiveMarketing: (days = 30) =>
    http<{
      ok: boolean;
      count: number;
      customers: Array<{
        id: string;
        name: string;
        phone: string;
        balance: number;
        loyaltyPoints: number;
        lastSaleAt: string | null;
        totalSalesCount: number;
      }>;
    }>(`/api/customers/marketing/inactive?days=${days}`),
};
