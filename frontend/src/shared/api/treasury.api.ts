import { http } from '@/lib/http';
import type { PaginationMeta } from '@/lib/api/contracts';
import type { ExpenseRecord, TreasuryTransaction } from '@/types/domain';
import { buildQueryString } from '@/lib/query-string';

export interface TreasuryTransactionsQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: 'all' | 'in' | 'out' | 'expense' | 'today';
}

export interface ExpensesQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

interface TreasuryTransactionsResponse {
  treasury?: TreasuryTransaction[];
  pagination?: PaginationMeta;
  summary?: {
    cashIn: number;
    cashOut: number;
    net: number;
  };
}

interface ExpensesResponse {
  expenses?: ExpenseRecord[];
  pagination?: PaginationMeta;
  summary?: {
    totalItems: number;
    totalAmount: number;
  };
}

export const treasuryApi = {
  list: async (params: TreasuryTransactionsQueryParams = {}) => {
    const response = await http<TreasuryTransactionsResponse>(`/api/treasury-transactions${buildQueryString(params as Record<string, string | number | undefined | null>)}`);
    return {
      rows: Array.isArray(response.treasury) ? response.treasury : [],
      pagination: response.pagination || {
        page: 1,
        pageSize: params.pageSize || 25,
        totalItems: Array.isArray(response.treasury) ? response.treasury.length : 0,
        totalPages: 1,
        rangeStart: Array.isArray(response.treasury) && response.treasury.length ? 1 : 0,
        rangeEnd: Array.isArray(response.treasury) ? response.treasury.length : 0,
      },
      summary: response.summary || { cashIn: 0, cashOut: 0, net: 0 },
    };
  },
  listAllTransactions: async (params: Omit<TreasuryTransactionsQueryParams, 'page' | 'pageSize'> = {}) => {
    const firstPage = await treasuryApi.list({ ...params, page: 1, pageSize: 100 });
    const allRows = [...firstPage.rows];
    const totalPages = firstPage.pagination?.totalPages || 1;
    for (let page = 2; page <= totalPages; page += 1) {
      const nextPage = await treasuryApi.list({ ...params, page, pageSize: 100 });
      allRows.push(...nextPage.rows);
    }
    return { rows: allRows, summary: firstPage.summary, pagination: firstPage.pagination };
  },
  expenses: async (params: ExpensesQueryParams = {}) => {
    const response = await http<ExpensesResponse>(`/api/expenses${buildQueryString(params as Record<string, string | number | undefined | null>)}`);
    return {
      rows: Array.isArray(response.expenses) ? response.expenses : [],
      pagination: response.pagination || {
        page: 1,
        pageSize: params.pageSize || 20,
        totalItems: Array.isArray(response.expenses) ? response.expenses.length : 0,
        totalPages: 1,
        rangeStart: Array.isArray(response.expenses) && response.expenses.length ? 1 : 0,
        rangeEnd: Array.isArray(response.expenses) ? response.expenses.length : 0,
      },
      summary: response.summary || { totalItems: 0, totalAmount: 0 },
    };
  },
  listAllExpenses: async (params: Omit<ExpensesQueryParams, 'page' | 'pageSize'> = {}) => {
    const firstPage = await treasuryApi.expenses({ ...params, page: 1, pageSize: 100 });
    const allRows = [...firstPage.rows];
    const totalPages = firstPage.pagination?.totalPages || 1;
    for (let page = 2; page <= totalPages; page += 1) {
      const nextPage = await treasuryApi.expenses({ ...params, page, pageSize: 100 });
      allRows.push(...nextPage.rows);
    }
    return { rows: allRows, summary: firstPage.summary, pagination: firstPage.pagination };
  },
  createExpense: (payload: unknown) => http('/api/expenses', { method: 'POST', body: JSON.stringify(payload) }),
  cancelExpense: (id: string | number, payload: { reason?: string } = {}) =>
    http(`/api/expenses/${id}/cancel`, { method: 'POST', body: JSON.stringify(payload) }),
};
