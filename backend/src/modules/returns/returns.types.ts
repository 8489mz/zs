import type { allocateRefundTenders, RefundTender } from './engines/refund-tender.engine';

export interface ExchangeReturnContext {
  returnId: number;
  total: number;
  customerId: number;
  branchId: number | null;
  locationId: number | null;
  refundBase: Omit<Parameters<typeof allocateRefundTenders>[0], 'amount' | 'requested'>;
}

export type ReturnInputItem = {
  productId: number;
  productName: string;
  qty: number;
  saleItemId?: number;
  purchaseItemId?: number;
  batchId?: number;
  serials?: string[];
};
export type ReturnDocumentInput = {
  returnType: 'sale' | 'purchase';
  invoiceId: number;
  settlementMode: string;
  refundMethod: string;
  total: number;
  note: string;
  branchId: number | null;
  locationId: number | null;
  refundAllocations?: Array<{ tender: RefundTender | 'payable'; amount: number }>;
  tipRelief?: number;
  courierRelief?: number;
  forfeitedHeaderDiscount?: number | null;
  goodwillAmount?: number | null;
  goodwillReason?: string | null;
  headerDiscountMode?: string | null;
};
