import { http } from '@/lib/http';
import { unwrapArray, type PaginationMeta } from '@/lib/api/contracts';
import type { CashierShift } from '@/types/domain';
import { buildQueryString } from '@/lib/query-string';

export interface CashDrawerListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: 'all' | 'open' | 'closed' | 'pending_review' | 'variance' | 'today';
}

export interface CashDrawerSummary {
  totalItems: number;
  openShiftCount: number;
  pendingReviewCount?: number;
  openShiftDocNo: string;
  totalVariance: number;
}

interface CashDrawerResponse {
  cashierShifts?: CashierShift[];
  pagination?: PaginationMeta;
  summary?: CashDrawerSummary;
}


export const cashDrawerApi = {
  list: async () => unwrapArray<CashierShift>(await http<CashierShift[] | { cashierShifts: CashierShift[] }>('/api/cashier-shifts'), 'cashierShifts'),
  listPage: async (params: CashDrawerListParams = {}) => {
    const response = await http<CashDrawerResponse>(`/api/cashier-shifts${buildQueryString(params)}`);
    return {
      rows: Array.isArray(response.cashierShifts) ? response.cashierShifts : [],
      pagination: response.pagination || {
        page: 1,
        pageSize: params.pageSize || 20,
        totalItems: Array.isArray(response.cashierShifts) ? response.cashierShifts.length : 0,
        totalPages: 1,
        rangeStart: Array.isArray(response.cashierShifts) && response.cashierShifts.length ? 1 : 0,
        rangeEnd: Array.isArray(response.cashierShifts) ? response.cashierShifts.length : 0,
      },
      summary: response.summary || { totalItems: 0, openShiftCount: 0, pendingReviewCount: 0, openShiftDocNo: '', totalVariance: 0 },
    };
  },
  listAll: async (params: Omit<CashDrawerListParams, 'page' | 'pageSize'> = {}) => {
    const firstPage = await cashDrawerApi.listPage({ ...params, page: 1, pageSize: 200 });
    const allRows = [...firstPage.rows];
    const totalPages = firstPage.pagination?.totalPages || 1;
    for (let page = 2; page <= totalPages; page += 1) {
      const nextPage = await cashDrawerApi.listPage({ ...params, page, pageSize: 200 });
      allRows.push(...nextPage.rows);
    }
    return { rows: allRows, summary: firstPage.summary, pagination: firstPage.pagination };
  },
  open: (payload: unknown, headers?: Record<string, string>) =>
    http<{ ok: boolean; cashierShifts: CashierShift[] }>('/api/cashier-shifts/open', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers,
    }),
  movement: (id: string, payload: unknown) => http<{ ok: boolean; cashierShifts: CashierShift[] }>(`/api/cashier-shifts/${id}/cash-movement`, { method: 'POST', body: JSON.stringify(payload) }),
  close: (id: string, payload: unknown) => http<{ ok: boolean; cashierShifts: CashierShift[] }>(`/api/cashier-shifts/${id}/close`, { method: 'POST', body: JSON.stringify(payload) }),
  reviewClose: (id: string, payload: unknown) => http<{ ok: boolean; cashierShifts: CashierShift[] }>(`/api/cashier-shifts/${id}/review-close`, { method: 'POST', body: JSON.stringify(payload) })
};
