export type ExecuteFieldSaleInternalPayload = {
  tripId: number;
  customerId?: number;
  customerName?: string;
  customerPhone?: string;
  paymentMethod: 'cash' | 'credit' | 'card' | 'split' | 'instapay' | 'vodafone_cash';
  paidAmount?: number;
  transferReference?: string;
  transferReceiptUrl?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientRole?: string;
  recipientSignature?: string;
  items: {
    productId: number;
    qty: number;
    unitPrice?: number;
    unitName?: string;
    unitMultiplier?: number;
    isBonus?: boolean;
    bonusReason?: string;
    originalPrice?: number;
    // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: per-line TOTAL
    // discount amount (POS lineDiscount semantics: subtracted
    // from this line's gross total, not a per-unit amount).
    // Deliberately NOT named `discount`: conversion payloads
    // historically sent a per-item `discount` that
    // normalizeSalePayload drops.
    lineDiscount?: number;
  }[];
  notes?: string;
  deliveryGpsLat?: number;
  deliveryGpsLng?: number;
  // INV-VAN-OFFLINE-TIMESTAMPS: why no GPS fix was captured at
  // submit time ('timeout' | 'denied' | 'unavailable'). Recorded,
  // never a block: a dead fix in a basement must not refuse a sale.
  gpsMissingReason?: 'timeout' | 'denied' | 'unavailable';
  deliveryProofPhoto?: string;
  packagingBreakdown?: { cartonsCount?: number; piecesCount?: number; itemsCount?: number };
  clientTxId?: string;
  supervisorOverridePin?: string;
  supervisorOverrideReason?: string;
  cashDiscountAmount?: number;
  // INV-VAN-OFFLINE-TIMESTAMPS: the instant the sale was made
  // offline (outbox createdAt, ISO with offset). Absent on the
  // online path, where the server clock stamps the row instead.
  offlineCreatedAt?: string;
};

export type ListDriverSalesFilters = {
  dateScope?: 'today' | 'yesterday' | 'week' | 'all';
  customerId?: number;
  paymentMethod?: string;
  search?: string;
  tripId?: number;
  discountedOnly?: boolean;
  limit?: number;
};
