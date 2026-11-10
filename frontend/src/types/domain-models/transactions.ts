export interface SaleItem {
  id: string;
  productId: string;
  name: string;
  qty: number;
  price: number;
  originalPrice?: number;
  offerDiscount?: number;
  offerName?: string;
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
  status: string;
  note: string;
  createdBy: string;
  branchId: string;
  branchName: string;
  locationId: string;
  locationName: string;
  date: string;
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
  createdByName?: string;
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
  items?: Array<{ productId?: string; productName?: string; qty?: number; total?: number; unitTotal?: number }>;
}

export interface TreasuryTransaction {
  id: string;
  txnType: string;
  type?: string;
  amount: number;
  note: string;
  referenceType?: string;
  referenceId?: string;
  branchId?: string;
  branchName?: string;
  locationId?: string;
  locationName?: string;
  createdAt: string;
  date?: string;
  createdByName?: string;
}

export interface ServiceRecord {
  id: string;
  name: string;
  amount: number;
  notes: string;
  serviceDate: string;
  createdByName?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  details: string;
  detailsSummary?: string;
  createdAt: string;
  created_at?: string;
  createdByName?: string;
  createdBy?: string;
}

export interface ShiftMovementItem {
  id: string;
  kind: 'cash_in' | 'cash_out' | 'delivery' | 'expense' | 'supplier_payment' | 'return';
  kindLabel: string;
  amount: number;
  note: string;
  createdAt: string;
}

export interface CashierShift {
  id: string;
  docNo: string;
  status: string;
  openingCash: number;
  expectedCash: number;
  countedCash: number;
  variance: number;
  openingNote?: string;
  closeNote?: string;
  note?: string;
  branchId?: string;
  branchName?: string;
  locationId?: string;
  locationName?: string;
  openedById?: string;
  createdAt: string;
  closedAt?: string;
  openedByName?: string;
  closedByName?: string;
  closedBy?: string;
  closedById?: string;
  cashSalesTotal?: number;
  cardSalesTotal?: number;
  walletSalesTotal?: number;
  instapaySalesTotal?: number;
  creditSalesTotal?: number;
  deliverySalesTotal?: number;
  deliveryFeeTotal?: number;
  freelanceDeliveryFeeTotal?: number;
  storeDeliveryFeeTotal?: number;
  netStoreSalesTotal?: number;
  shiftSalesTotal?: number;
  tipSalesTotal?: number;
  serviceCashTotal?: number;
  serviceCardTotal?: number;
  serviceTotal?: number;
  cashDrawerMovementTotal?: number;
  cashDrawerCashInTotal?: number;
  cashDrawerDeliveryCashInTotal?: number;
  cashDrawerManualCashInTotal?: number;
  cashDrawerCashOutTotal?: number;
  supplierPaymentsTotal?: number;
  expensesTotal?: number;
  saleReturnCashRefundTotal?: number;
  saleReturnCardRefundTotal?: number;
  saleReturnTotal?: number;
  movementItems?: ShiftMovementItem[];
}

export interface ExpenseRecord {
  id: string;
  title: string;
  amount: number;
  date: string;
  note?: string;
  createdBy?: string;
  branchId?: string;
  branchName?: string;
  locationId?: string;
  locationName?: string;
}
