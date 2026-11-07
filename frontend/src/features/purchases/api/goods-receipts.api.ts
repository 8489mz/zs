import { http } from '@/lib/http';

export interface GoodsReceiptLineItem {
  id?: number;
  productId: number;
  productName?: string;
  productSku?: string;
  purchaseOrderItemId?: number | null;
  orderedQty?: number;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty?: number;
  rejectionReason?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  manufacturingDate?: string | null;
  unitCost?: number;
  quarantineLocationId?: number | null;
  coaDocumentId?: number | null;
  overReceivedQty?: number;
  notes?: string | null;
}

export interface GoodsReceiptRecord {
  id: number;
  docNo: string;
  purchaseOrderId: number | null;
  poDocNo?: string | null;
  supplierId: number;
  supplierName: string;
  locationId: number;
  receivedAt: string;
  status: 'draft' | 'posted' | 'cancelled';
  pendingReview?: boolean;
  pendingReviewReason?: string | null;
  supplierDeliveryNoteRef?: string | null;
  grniJournalEntryId?: number | null;
  notes?: string | null;
  createdAt: string;
  lines?: GoodsReceiptLineItem[];
}

export interface CreateGoodsReceiptPayload {
  purchaseOrderId?: number | null;
  supplierId: number;
  locationId?: number;
  supplierDeliveryNoteRef?: string | null;
  receivedAt?: string;
  notes?: string | null;
  // INV-SHIPPING-ALLOCATION: freight (shipping) on this receipt,
  // allocated to item cost at posting time. Absent or 0 means no
  // freight and the receipt posts exactly as before.
  freight?: number;
  lines: Array<{
    productId: number;
    purchaseOrderItemId?: number | null;
    orderedQty?: number;
    receivedQty: number;
    acceptedQty: number;
    rejectedQty?: number;
    rejectionReason?: string | null;
    batchNumber?: string | null;
    expiryDate?: string | null;
    manufacturingDate?: string | null;
    unitCost?: number;
    quarantineLocationId?: number | null;
    coaDocumentId?: number | null;
    notes?: string | null;
  }>;
}

export interface VerifyThreeWayMatchPayload {
  tolerancePercent?: number;
  managerOverride?: boolean;
  overrideReason?: string;
}

export interface ThreeWayMatchResult {
  purchaseId: number;
  docNo: string;
  status: string;
  matchResult: {
    matched: boolean;
    overallStatus: 'matched' | 'tolerance_exceeded' | 'quantity_mismatch' | 'service_approved';
    requiresApproval: boolean;
    isServiceApproved: boolean;
    lines: Array<{
      productId: number;
      productName?: string;
      orderedQty: number;
      grnAcceptedQty: number;
      invoicedQty: number;
      poUnitPrice: number;
      invoicedUnitPrice: number;
      priceVariancePercent: number;
      priceVarianceAmount: number;
      lineGrniAmount: number;
      lineApAmount: number;
      status: 'matched' | 'tolerance_exceeded' | 'quantity_mismatch' | 'service_approved';
    }>;
    financialSummary: {
      totalGrniAmount: number;
      totalApAmount: number;
      totalPpvVariance: number;
      totalVatAmount: number;
      discrepancy: number;
    };
  };
}

export const goodsReceiptsApi = {
  list: (params?: { supplierId?: number; status?: string; search?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.supplierId) searchParams.set('supplierId', String(params.supplierId));
    if (params?.status) searchParams.set('status', params.status);
    if (params?.search) searchParams.set('search', params.search);
    const qs = searchParams.toString();
    return http<GoodsReceiptRecord[]>(`/api/goods-receipts${qs ? `?${qs}` : ''}`);
  },

  getById: (id: number) => http<GoodsReceiptRecord>(`/api/goods-receipts/${id}`),

  create: (data: CreateGoodsReceiptPayload) =>
    http<GoodsReceiptRecord>('/api/goods-receipts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  post: (id: number) =>
    http<{ success: boolean; grnId: number; grniJournalEntryId: number; message: string }>(
      `/api/goods-receipts/${id}/post`,
      {
        method: 'POST',
      },
    ),

  verifyThreeWayMatch: (purchaseId: number, data?: VerifyThreeWayMatchPayload) =>
    http<ThreeWayMatchResult>(`/api/goods-receipts/purchases/${purchaseId}/verify-three-way-match`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
};
