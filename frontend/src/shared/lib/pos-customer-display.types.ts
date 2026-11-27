export type CustomerDisplayStatus = 'idle' | 'scanning' | 'payment' | 'completed';

export interface CustomerDisplayModifier {
  name: string;
  qty: number;
  price: number;
}

export interface CustomerDisplayItem {
  id: string | number;
  name: string;
  qty: number;
  price: number;
  lineTotal: number;
  barcode?: string;
  categoryName?: string;
  /* R5-A (INV-REST-TOTALS-TRUTH-2, R-I14): the modifier lines the
   * display renders under the item, and the line note. price is the
   * charged per-unit price (base + modifiers), so the visible lines
   * sum to the shown total. */
  modifiers?: CustomerDisplayModifier[];
  notes?: string;
  /* INV-POS-LINE-DISCOUNT: the line's own discount (0 when none),
   * rendered under the item so the customer sees why the line total
   * is below qty x price. */
  lineDiscount?: number;
}

export interface CustomerDisplayCustomerInfo {
  name: string;
  phone?: string;
  loyaltyPoints?: number;
}

export interface CustomerDisplayPaymentInfo {
  channel?: string;
  paymentType?: string;
  paidAmount?: number;
  change?: number;
  total?: number;
  qrData?: string;
  qrLabel?: string;
}

export interface CustomerDisplayCompletedSale {
  docNo: string;
  total: number;
  paidAmount: number;
  change: number;
}

export interface CustomerDisplayPromotion {
  id: string;
  title: string;
  subtitle: string;
  badge?: string;
  icon?: string;
}

export interface CustomerDisplayPayload {
  status: CustomerDisplayStatus;
  storeName: string;
  storeLogo?: string;
  branchName?: string;
  items: CustomerDisplayItem[];
  subtotal: number;
  discount: number;
  /* INV-POS-LINE-DISCOUNT: the sum of the per-line discounts, shown
   * as its own breakdown row on the customer display (the discount
   * field stays the header discount only, like the receipt). */
  lineDiscountTotal?: number;
  tax: number;
  /* R5-A (INV-REST-TOTALS-TRUTH-2, R-I14): the breakdown rows the
   * display was missing — without them the visible rows never summed
   * to the total on a dine-in (service charge) or delivery/tip sale. */
  serviceCharge?: number;
  deliveryFee?: number;
  tipAmount?: number;
  total: number;
  itemCount: number;
  customer?: CustomerDisplayCustomerInfo | null;
  payment?: CustomerDisplayPaymentInfo | null;
  completedSale?: CustomerDisplayCompletedSale | null;
  promotions?: CustomerDisplayPromotion[];
  updatedAt: number;
}

export const POS_CFD_BROADCAST_CHANNEL = 'pos_cfd_broadcast_channel';
export const POS_CFD_STORAGE_KEY = 'pos_cfd_live_state';
