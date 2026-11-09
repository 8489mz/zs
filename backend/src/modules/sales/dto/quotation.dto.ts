export interface QuotationItemDto {
  productId: number;
  productName: string;
  unitName?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  total: number;
  notes?: string;
}

export interface CreateQuotationDto {
  customerId?: number | null;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  branchId?: number | null;
  subtotal: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount: number;
  validUntil?: string;
  notes?: string;
  termsConditions?: string;
  items: QuotationItemDto[];
  // I10-A (R8): creation-time status. Only 'sent' may be set here —
  // the approve-and-save button issues the quotation instead of
  // leaving it a draft. 'accepted' is the customer's response and
  // 'converted' is set by convertToSale; both are rejected by the
  // service whitelist, which fails closed to 'draft'.
  status?: 'draft' | 'sent';
}

export interface UpdateQuotationDto
  extends Omit<Partial<CreateQuotationDto>, 'status'> {
  // Update keeps the full lifecycle vocabulary; creation (above) is
  // narrowed to 'draft' | 'sent' — the Omit is required because a
  // redeclared status must be assignable to the base field's type.
  status?: 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted';
}
