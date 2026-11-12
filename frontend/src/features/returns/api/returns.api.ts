import { http } from '@/lib/http';
import { unwrapArray } from '@/lib/api/contracts';
import type { ReturnRecord } from '@/types/domain';
import { buildQueryString } from '@/lib/query-string';

export interface ReturnsListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: 'all' | 'sales' | 'purchase' | 'today';
  employee?: string;
}

export interface ReturnsListResponse {
  returns: ReturnRecord[];
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  summary?: {
    totalItems: number;
    totalAmount: number;
    salesReturns: number;
    purchaseReturns: number;
    todayCount: number;
    latestDocNo?: string;
  };
}


export interface ReturnReliefPreview {
  goodsTotal: number;
  /** INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: the pro-rata goods
   *  total (mode 1, "refund at the recorded price"). The dialog
   *  shows it next to the forfeit amount so the merchant can choose. */
  originalGoodsTotal?: number;
  tipRelief: number;
  courierRelief: number;
  totalRelief: number;
  refundTotal: number;
  /** INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: the forfeit breakdown
   *  the backend computed for this return (present only when the
   *  dialog asked for the forfeit and it applies). */
  forfeit?: {
    applies: boolean;
    invoiceTotal: number;
    priorGoodsRefunded: number;
    remainingNetAtOriginal: number;
    computedGoodsRefund: number;
    forfeitedHeaderDiscount: number;
    repricedReturnedTotal: number;
    goodwillCap: number;
    goodwillAmount: number;
  };
}

export interface ReturnReliefPreviewItem {
  productId: number;
  productName?: string;
  qty: number;
  saleItemId?: number;
  purchaseItemId?: number;
}

export interface ReturnReliefPreviewPayload {
  type: 'sale' | 'purchase';
  invoiceId: string | number;
  items: ReturnReliefPreviewItem[];
  /** INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT: ask the backend to
   *  forfeit the header discount and reprice the kept pieces at
   *  original price; the preview then shows the computed refund. */
  forfeitHeaderDiscount?: boolean;
  /** Requested final goods refund (computed + goodwill). Only valid
   *  with the forfeit; the backend enforces the cap. */
  goodwillRefundAmount?: number;
  goodwillRefundReason?: string;
}

export const returnsApi = {
  list: async () => unwrapArray<ReturnRecord>(await http<ReturnRecord[] | { returns: ReturnRecord[] }>('/api/returns'), 'returns'),
  listPage: (params: ReturnsListParams) => http<ReturnsListResponse>(`/api/returns${buildQueryString(params)}`),
  listAll: async (params: Omit<ReturnsListParams, 'page' | 'pageSize'> = {}) => {
    const pageSize = 200;
    let page = 1;
    const rows: ReturnRecord[] = [];
    let summary: ReturnsListResponse['summary'];
    while (true) {
      const payload = await returnsApi.listPage({ ...params, page, pageSize });
      rows.push(...(payload.returns || []));
      summary = payload.summary;
      const totalPages = payload.pagination?.totalPages || 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return { returns: rows, summary };
  },
  getInvoiceReturnedQuantities: (type: 'sale' | 'purchase', invoiceId: string | number) =>
    http<{ returnedQtyByLine: Record<string, number>; blockedProductIds: string[] }>(
      `/api/returns/invoices/${type}/${encodeURIComponent(String(invoiceId))}/quantities`),
  // T10-D: the refund the backend will actually pay (goods + tip /
  // courier relief, from computeSalesReturnRelief). The dialog reads
  // this preview — it never re-computes the relief ratio locally.
  preview: (payload: ReturnReliefPreviewPayload) =>
    http<ReturnReliefPreview>('/api/returns/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getReturnOperationStatus: (idempotencyKey: string) =>
    http<{ status: string; documentId?: string | null; response?: unknown }>(
      `/api/operations/${encodeURIComponent('POST:/api/returns')}/${encodeURIComponent(idempotencyKey)}/status`),
  create: (payload: unknown, headers?: Record<string, string>) => http('/api/returns', {
    method: 'POST',
    headers: {
      'x-idempotency-key': crypto.randomUUID(),
      ...headers,
    },
    body: JSON.stringify(payload),
  })
};