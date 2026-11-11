export interface SaleItem {
  id: string;
  productId: string;
  name: string;
  nameEn?: string;
  name_en?: string;
  qty: number;
  price: number;
  originalPrice?: number;
  offerDiscount?: number;
  offerName?: string;
  /* INV-POS-LINE-DISCOUNT: the per-line TOTAL discount stored in
   * sale_items.line_discount (0 on rows that carry none). */
  lineDiscount?: number;
  total: number;
  unitName: string;
  unitMultiplier: number;
  cost: number;
  priceType: string;
  notes?: string;
  modifiers?: Array<{ productId?: string | number; name: string; qty: number; price?: number }>;
  serials?: string[];
}

export interface SalePayment {
  id?: string;
  paymentChannel: string;
  amount: number;
}

export interface SaleLinkedReturn {
  id: string;
  docNo: string;
  createdAt: string | null;
  total: number;
  settlementMode?: string | null;
  refundMethod?: string | null;
}

export interface Sale {
  id: string;
  docNo: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  paymentType: string;
  paymentChannel: string;
  subTotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  pricesIncludeTax: boolean;
  total: number;
  paidAmount: number;
  tenderedAmount?: number;
  changeAmount?: number;
  deliveryFee?: number;
  orderType?: string;
  tableNumber?: string;
  deliveryRepId?: number | string | null;
  deliveryRepName?: string | null;
  collectionStatus?: string | null;
  deliveryStatus?: string | null;
  payments?: SalePayment[];
  linkedReturns?: SaleLinkedReturn[];
  status: string;
  note: string;
  createdBy: string;
  createdByName?: string;
  cashierName?: string;
  branchId: string;
  branchName: string;
  locationId: string;
  locationName: string;
  date: string;
  createdAt?: string;
  items: SaleItem[];
  cart?: any[];
}

export interface PurchaseItem {
  id: string;
  productId: string;
  name: string;
  qty: number;
  cost: number;
  total: number;
  unitName: string;
  unitMultiplier: number;
  receivedQty?: number;
  purchaseOrderItemId?: string | number | null;
}

export interface Purchase {
  id: string;
  docNo: string;
  supplierId: string;
  supplierName: string;
  paymentType: string;
  subTotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  pricesIncludeTax: boolean;
  total: number;
  note: string;
  status: string;
  lifecycleStatus?: string;
  matchedStatus?: string;
  purchaseOrderId?: string | number | null;
  poDocNo?: string | null;
  createdBy: string;
  branchId: string;
  branchName: string;
  locationId: string;
  locationName: string;
  date: string;
  items: PurchaseItem[];
  attachments?: any[];
}

export interface ReturnRecord {
  id: string;
  docNo: string;
  returnType?: string;
  type?: string;
  invoiceId?: string;
  invoiceDocNo?: string;
  partyName?: string;
  customerName?: string;
  supplierName?: string;
  orderType?: string;
  productId?: string;
  productName: string;
  qty: number;
  total: number;
  tipRelief?: number;
  courierRelief?: number;
  refundTotal?: number;
  note: string;
  createdAt?: string;
  date?: string;
  settlementMode?: string;
  refundMethod?: string;
  createdBy?: string;
  createdByName?: string;
  items?: { productId: string; productName: string; qty: number; total: number; }[];
}
