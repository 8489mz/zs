export interface SalesOrderItemDto {
  productId: number;
  productName: string;
  unitName?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  total: number;
  notes?: string;
}

export interface CreateSalesOrderDto {
  customerId?: number | null;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  branchId?: number | null;
  /**
   * INV-SALES-ORDER-WAREHOUSE-SELECTION: the warehouse the order
   * reserves from. When given, approval validates/reserves stock in
   * THIS warehouse; when omitted, the branch's default selling
   * warehouse applies (previous behaviour, kept).
   */
  warehouseLocationId?: number | null;
  subtotal: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount: number;
  reservationExpiresAt?: string | null;
  deliveryDate?: string | null;
  quotationId?: number | null;
  notes?: string;
  termsConditions?: string;
  autoReserve?: boolean;
  items: SalesOrderItemDto[];
}

export interface UpdateSalesOrderDto extends Partial<CreateSalesOrderDto> {
  status?: 'draft' | 'confirmed' | 'partially_delivered' | 'delivered' | 'converted' | 'cancelled';
}
