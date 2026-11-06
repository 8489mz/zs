import { http } from '@/lib/http';

export interface PurchaseOrderItem {
  id?: number;
  purchase_order_id?: number;
  productId?: number;
  productName: string;
  product_name?: string;
  unitName?: string;
  unit_name?: string;
  quantity: number;
  received_quantity?: number;
  unitCost: number;
  unit_cost?: number;
  taxRate?: number;
  tax_rate?: number;
  discount?: number;
  total: number;
  notes?: string;
  current_stock?: number;
}

export interface PurchaseOrderRecord {
  id: number;
  tenant_id: string;
  account_id: string;
  order_number: string;
  supplier_id: number | null;
  supplier_name: string;
  supplier_phone: string | null;
  warehouse_id: number | null;
  warehouse_name: string | null;
  subtotal: number | string;
  tax_amount: number | string;
  discount_amount: number | string;
  total_amount: number | string;
  status: 'draft' | 'pending_approval' | 'confirmed' | 'partially_received' | 'received' | 'converted_to_bill' | 'cancelled';
  expected_delivery_date: string | null;
  converted_purchase_id: number | null;
  notes: string | null;
  terms_conditions: string | null;
  created_at: string;
  updated_at: string;
  items?: PurchaseOrderItem[];
}

export interface CreatePurchaseOrderPayload {
  supplierId?: number | null;
  supplierName: string;
  supplierPhone?: string;
  warehouseId?: number | null;
  warehouseName?: string;
  subtotal: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount: number;
  expectedDeliveryDate?: string | null;
  notes?: string;
  termsConditions?: string;
  /**
   * When true, the server creates the order and runs the approval check
   * in the same call (INV-PURCHASE-ORDER-DRAFT-APPROVE). When omitted
   * the order is created as a server-side draft.
   */
  submitForApproval?: boolean;
  items: Array<{
    productId?: number;
    productName: string;
    unitName?: string;
    quantity: number;
    unitCost: number;
    taxRate?: number;
    discount?: number;
    total: number;
    notes?: string;
  }>;
}

export interface PurchaseOrderSummaryResponse {
  orders: PurchaseOrderRecord[];
  summary: {
    all: number;
    draft: number;
    confirmed: number;
    partially_received: number;
    received: number;
    converted_to_bill: number;
    cancelled: number;
  };
}

export const purchaseOrdersApi = {
  list: (params?: { status?: string; search?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.search) searchParams.set('search', params.search);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const qs = searchParams.toString();
    return http<PurchaseOrderSummaryResponse>(`/api/purchase-orders${qs ? `?${qs}` : ''}`);
  },

  getById: (id: number) => http<{ order: PurchaseOrderRecord; items: PurchaseOrderItem[] }>(`/api/purchase-orders/${id}`),

  create: (data: CreatePurchaseOrderPayload) =>
    http<{ success: boolean; id: number; orderNumber: string; status?: PurchaseOrderRecord['status']; message: string }>('/api/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: Partial<CreatePurchaseOrderPayload> & { status?: string }) =>
    http<{ success: boolean; message: string }>(`/api/purchase-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  confirm: (id: number) =>
    http<{ success: boolean; status?: PurchaseOrderRecord['status']; message: string }>(`/api/purchase-orders/${id}/confirm`, {
      method: 'POST',
    }),

  convertToBill: (id: number) =>
    http<{ success: boolean; convertedPurchaseId?: number; message: string }>(`/api/purchase-orders/${id}/convert-to-bill`, {
      method: 'POST',
    }),

  cancel: (id: number) =>
    http<{ success: boolean; message: string }>(`/api/purchase-orders/${id}/cancel`, {
      method: 'POST',
    }),

  delete: (id: number) =>
    http<{ success: boolean; message: string }>(`/api/purchase-orders/${id}`, {
      method: 'DELETE',
    }),
};
