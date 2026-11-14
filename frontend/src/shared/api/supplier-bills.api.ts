import { http } from '@/lib/http';
import { buildQueryString } from '@/lib/query-string';

export interface SupplierBillLineInput {
  description: string;
  accountId: string | number;
  amount: number;
}

export interface SupplierBillLine {
  description: string;
  accountId: number;
  amount: number;
}

export interface SupplierBill {
  id: string;
  supplierId: string;
  docNo: string;
  billDate: string;
  total: number;
  note: string;
  status: string;
  createdAt: string;
  lines: SupplierBillLine[];
}

export interface CreateSupplierBillPayload {
  supplierId: string;
  lines: SupplierBillLine[];
  note?: string;
  billDate?: string;
}

/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the bill total is summed in
 * integer thousandths (3dp) so 333.33 + 333.33 + 333.34 is exactly
 * 1000 and 333.336 x 3 is exactly 1000.008 — never a float wobble.
 * The total is display-only; the server re-validates every line at
 * tenant book digits and totals in integer minor units. */
export function sumSupplierBillLines(lines: Array<{ amount: number }>): number {
  const thousandths = lines.reduce((sum, line) => sum + Math.round(Number(line.amount || 0) * 1000), 0);
  return thousandths / 1000;
}

/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the single gate the bill form
 * uses before POST /api/supplier-bills. The backend re-validates
 * (account, precision, supplier), but the form must refuse first
 * with a field error instead of sending a bill that can never post. */
export function buildSupplierBillPayload(
  supplierId: string,
  lines: SupplierBillLineInput[],
  note?: string,
): CreateSupplierBillPayload {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('أضف بندًا واحدًا على الأقل');
  }
  const cleanLines: SupplierBillLine[] = lines.map((line) => {
    const description = String(line.description || '').trim();
    if (!description) throw new Error('اكتب وصفًا لكل بند');
    const accountId = Number(line.accountId);
    if (!Number.isFinite(accountId) || !(accountId > 0)) throw new Error('اختر الحساب لكل بند');
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || !(amount > 0)) throw new Error('المبلغ يجب أن يكون أكبر من صفر لكل بند');
    return { description, accountId, amount };
  });
  const trimmedNote = String(note || '').trim();
  return {
    supplierId,
    lines: cleanLines,
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
}

export const supplierBillsApi = {
  list: (supplierId: string) =>
    http<{ ok: boolean; bills: SupplierBill[] }>(`/api/supplier-bills${buildQueryString({ supplierId })}`),
  create: (payload: CreateSupplierBillPayload) =>
    http<{ ok: boolean; bill: SupplierBill; appliedAdvances?: Array<{ paymentId: number; amount: number }> }>(
      '/api/supplier-bills',
      { method: 'POST', body: JSON.stringify(payload) },
    ),
};
