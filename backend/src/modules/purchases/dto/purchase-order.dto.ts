export interface PurchaseOrderItemDto {
  productId: number;
  productName: string;
  unitName?: string;
  quantity: number;
  receivedQuantity?: number;
  unitCost: number;
  taxRate?: number;
  discount?: number;
  total: number;
  notes?: string;
}

export interface CreatePurchaseOrderDto {
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
   * When true, the order is created and immediately run through the
   * same approval check as confirmOrder (INV-PURCHASE-ORDER-DRAFT-APPROVE):
   * 'confirmed' when no approval rule applies, 'pending_approval' when
   * one does. When false/omitted the order stays a server-side draft.
   * The status is never taken from the client: only this intent flag is.
   */
  submitForApproval?: boolean;
  items: PurchaseOrderItemDto[];
}

export interface UpdatePurchaseOrderDto extends Partial<CreatePurchaseOrderDto> {
  status?: 'draft' | 'confirmed' | 'partially_received' | 'received' | 'converted_to_bill' | 'cancelled';
}

