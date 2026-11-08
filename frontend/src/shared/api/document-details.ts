import { http } from '@/lib/http';
import type { Purchase, Sale } from '@/types/domain';

type AnyRecord = Record<string, unknown>;
type SaleDetailPayload = Sale | { sale?: Sale | null; data?: unknown; result?: unknown };
type PurchaseDetailPayload = Purchase | { purchase?: Purchase | null; data?: unknown; result?: unknown };

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' ? value as AnyRecord : null;
}

function unwrapByKey<T>(payload: unknown, key: string): T {
  const record = asRecord(payload);
  if (!record) return payload as T;

  const direct = record[key];
  if (direct && typeof direct === 'object') return unwrapByKey<T>(direct, key);

  if (record.data && typeof record.data === 'object') return unwrapByKey<T>(record.data, key);
  if (record.result && typeof record.result === 'object') return unwrapByKey<T>(record.result, key);

  return payload as T;
}

export interface SupplierPaymentDetail {
  id: string;
  docNo: string;
  supplierId: string;
  supplierName: string;
  amount: number;
  note: string;
  date: string;
  paymentChannel: string;
  instapayAddress: string;
  branchId: string;
  locationId: string;
  branchName: string;
  locationName: string;
  createdBy: string;
  journalEntryId: string;
  journalNo: string;
}

type SupplierPaymentDetailPayload = SupplierPaymentDetail | { supplierPayment?: SupplierPaymentDetail | null; data?: unknown; result?: unknown };

export interface ReturnDocumentItem {
  id: string;
  productId: string;
  productName: string;
  qty: number;
  unitTotal: number;
  lineTotal: number;
  allocatedTax: number;
}

export interface ReturnDocumentDetail {
  id: string;
  docNo: string;
  returnType: string;
  invoiceId: string;
  invoiceDocNo: string;
  partyName: string;
  total: number;
  note: string;
  settlementMode: string;
  refundMethod: string;
  date: string;
  branchName: string;
  locationName: string;
  createdBy: string;
  journalEntryId: string;
  journalNo: string;
  items: ReturnDocumentItem[];
}

type ReturnDocumentDetailPayload = ReturnDocumentDetail | { returnDocument?: ReturnDocumentDetail | null; data?: unknown; result?: unknown };

export const documentDetailsApi = {
  saleById: async (id: string) => unwrapByKey<Sale>(await http<SaleDetailPayload>(`/api/sales/${id}`), 'sale'),
  purchaseById: async (id: string) => unwrapByKey<Purchase>(await http<PurchaseDetailPayload>(`/api/purchases/${id}`), 'purchase'),
  /* INV-STATEMENT-PAYMENT-DETAILS: a supplier statement payment row is a
   * payment, not an invoice -- its details come from the single-payment
   * read, never from purchaseById (a payment id fed to /api/purchases/:id
   * either 404s or returns an unrelated invoice on an id collision). */
  supplierPaymentById: async (id: string) => unwrapByKey<SupplierPaymentDetail>(await http<SupplierPaymentDetailPayload>(`/api/supplier-payments/${id}`), 'supplierPayment'),
  /* INV-STATEMENT-RETURN-ROW-DETAILS: a statement return row is a return,
   * not its parent invoice -- its details come from the single-return
   * read, never from purchaseById / saleById (a return id fed to
   * /api/purchases/:id or /api/sales/:id either 404s or returns an
   * unrelated invoice on an id collision). */
  returnById: async (id: string) => unwrapByKey<ReturnDocumentDetail>(await http<ReturnDocumentDetailPayload>(`/api/returns/${id}`), 'returnDocument'),
};
