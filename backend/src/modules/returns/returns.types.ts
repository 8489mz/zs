import type { RefundTender } from './engines/refund-tender.engine';

// Phase 1 B7 — ExchangeReturnContext moved to the shared port
// (backend/src/common/utils/exchange-return.port.ts) so the sales
// module can use the type without importing the returns module.
// This re-export keeps every returns-internal consumer unchanged.
export type { ExchangeReturnContext } from '../../common/utils/exchange-return.port';

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
