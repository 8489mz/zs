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

/* INV-SUPPLIER-BILL-PLAIN-KIND: a bill line asks "what is this?" in plain
 * words and the account fills itself — the merchant (and the cashier)
 * never picks a raw chart code. Each kind maps to ONE chart account,
 * verified against the tenant chart seed
 * (accounting-tenant-foundation.service.ts, mirrored by migration
 * 20260529000300): software -> 6700 administrative, paper -> 6900
 * operating materials, equipment -> 1210 equipment, furniture -> 1220
 * furniture, freelancer -> 6200 salaries and wages, maintenance -> 6600,
 * transport -> 6400 freight, utilities -> 6300, rent -> 6100,
 * marketing -> 6500. Every mapped account is an expense or asset with
 * a debit balance and is NOT on the engine blocklist. "other" maps to
 * null and keeps the manual account picker as the fallback. The posting
 * is unchanged — the kind only chooses the account; the engine still
 * validates the resulting account exactly as before. */
export type SupplierBillKindId =
  | 'software'
  | 'paper'
  | 'equipment'
  | 'furniture'
  | 'freelancer'
  | 'maintenance'
  | 'transport'
  | 'utilities'
  | 'rent'
  | 'marketing'
  | 'other';

export interface SupplierBillKind {
  id: SupplierBillKindId;
  label: string;
  accountCode: string | null;
}

export const SUPPLIER_BILL_KINDS: SupplierBillKind[] = [
  { id: 'software', label: 'برنامج / اشتراك', accountCode: '6700' },
  { id: 'paper', label: 'ورق ومستلزمات مكتبية', accountCode: '6900' },
  { id: 'equipment', label: 'كابلات ومعدات وأجهزة', accountCode: '1210' },
  { id: 'furniture', label: 'أثاث وتجهيزات', accountCode: '1220' },
  { id: 'freelancer', label: 'أجور فريلانسر / خدمات', accountCode: '6200' },
  { id: 'maintenance', label: 'صيانة', accountCode: '6600' },
  { id: 'transport', label: 'نقل وشحن', accountCode: '6400' },
  { id: 'utilities', label: 'كهرباء ومرافق', accountCode: '6300' },
  { id: 'rent', label: 'إيجار', accountCode: '6100' },
  { id: 'marketing', label: 'تسويق وإعلان', accountCode: '6500' },
  { id: 'other', label: 'أخرى — اختر الحساب بنفسك', accountCode: null },
];

export function supplierBillKindById(id: string | undefined | null): SupplierBillKind | undefined {
  if (!id) return undefined;
  return SUPPLIER_BILL_KINDS.find((kind) => kind.id === id);
}

/* Resolves a kind to the tenant's account id by chart code. Returns null
 * for 'other' (manual picker), for an unknown kind, and when the mapped
 * code is not in this tenant's loaded chart (deactivated) — the form
 * then falls back to the manual picker instead of posting nowhere. */
export function resolveSupplierBillKindAccountId(
  kindId: string | undefined | null,
  accounts: Array<{ id: number | string; code: string | number }>,
): string | null {
  const kind = supplierBillKindById(kindId);
  if (!kind || kind.accountCode === null) return null;
  const found = (accounts || []).find((account) => String(account.code) === kind.accountCode);
  return found ? String(found.id) : null;
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
