import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

export interface CustomerPaymentPayloadInput {
  customerId: string;
  amount: number;
  note?: string;
  paymentChannel?: 'cash'|'bank'|'card'|'wallet'|'instapay';
  /* INV-INSTAPAY-FIELD-MISSING: the customer InstaPay account number
   * (IPA) this receipt came from. Carried only when the channel is
   * 'instapay'. */
  instapayAddress?: string;
  /* INV-REP-NONCASH-EVIDENCE-GATE (PD1) + STUCK-RECEIPT: the real
   * transfer reference (bank / card / wallet / InstaPay transaction
   * reference) of this receipt. Mandatory for any non-cash channel —
   * the backend gate refuses the receipt without at least 3
   * characters, and without this field the form could never send
   * one, so every non-cash collection deadlocked. */
  transferReference?: string;
  jobId?: string | number | null;
}

export interface SupplierPaymentPayloadInput {
  supplierId: string;
  amount: number;
  note?: string;
  paymentChannel?: 'cash'|'bank'|'card'|'wallet'|'instapay';
  /* INV-INSTAPAY-FIELD-MISSING: the supplier InstaPay account number
   * (IPA) this payment was sent to. Carried only when the channel is
   * 'instapay'. */
  instapayAddress?: string;
  /* INV-SUPPLIER-ADVANCE-UI-WIRING: true marks this payment as a
   * supplier advance (Dr 1185) instead of a settlement. Carried only
   * when true, so ordinary payments keep their exact old payload. */
  isAdvance?: boolean;
}

// INV-FE3-FRONTEND-BOOK-DIGITS: customer/supplier payment amounts post
// to the ledger, so they round at the tenant's book digits (a KWD
// tenant's 0.125 must survive), not hardcoded 2dp.
function normalizeMoney(value: number) {
  return roundMoneyValue(Number(value || 0), currencyMoneyDigits(getGlobalSystemCurrency()));
}

/* INV-INSTAPAY-FIELD-MISSING: keep the IPA only for an InstaPay
 * payment, trimmed; any other channel (or a blank value) carries
 * nothing, so a stray IPA can never be read as the destination of a
 * cash/bank/card payment. Mirrors the backend normalizeInstapayAddress. */
export function normalizePaymentInstapayAddress(
  paymentChannel: string | undefined,
  rawAddress: string | undefined,
): string | undefined {
  if (paymentChannel !== 'instapay') return undefined;
  const address = String(rawAddress || '').trim();
  return address ? address : undefined;
}

/* INV-INSTAPAY-FIELD-MISSING: the IPA saved on the supplier record
 * (suppliers.metadata.instapayAddress). The supplier payment forms
 * prefill from it when InstaPay is picked, so the merchant never has
 * to retype the supplier's account number. */
export function readSupplierInstapayAddress(supplier: { metadata?: unknown } | undefined | null): string {
  if (!supplier || typeof supplier.metadata !== 'object' || supplier.metadata === null) return '';
  const address = (supplier.metadata as Record<string, unknown>).instapayAddress;
  return typeof address === 'string' ? address.trim() : '';
}

/* INV-REP-NONCASH-EVIDENCE-GATE (PD1) + STUCK-RECEIPT: keep the
 * transfer reference only for a non-cash receipt, trimmed; cash (or
 * a blank value) carries nothing, so a stray reference can never be
 * read as evidence for a cash receipt. Mirrors the backend
 * normalizeTransferReference. */
export function normalizePaymentTransferReference(
  paymentChannel: string | undefined,
  rawReference: string | undefined,
): string | undefined {
  if (!paymentChannel || paymentChannel === 'cash') return undefined;
  const reference = String(rawReference || '').trim();
  return reference ? reference : undefined;
}

export function buildCustomerPaymentPayload(input: CustomerPaymentPayloadInput) {
  if (!input.customerId) throw new Error('اختر العميل أولًا');
  if (Number(input.amount || 0) <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');

  return {
    customerId: input.customerId,
    amount: normalizeMoney(input.amount),
    note: String(input.note || '').trim(),
    paymentChannel: input.paymentChannel || 'cash',
    instapayAddress: normalizePaymentInstapayAddress(input.paymentChannel, input.instapayAddress),
    transferReference: normalizePaymentTransferReference(input.paymentChannel, input.transferReference),
    jobId: input.jobId ? Number(input.jobId) : undefined,
  };
}

export function buildSupplierPaymentPayload(input: SupplierPaymentPayloadInput) {
  if (!input.supplierId) throw new Error('اختر المورد أولًا');
  if (Number(input.amount || 0) <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');

  return {
    supplierId: input.supplierId,
    amount: normalizeMoney(input.amount),
    note: String(input.note || '').trim(),
    paymentChannel: input.paymentChannel || 'cash',
    instapayAddress: normalizePaymentInstapayAddress(input.paymentChannel, input.instapayAddress),
    /* INV-SUPPLIER-ADVANCE-UI-WIRING: the key exists only when true —
     * an ordinary payment keeps its exact old payload shape. */
    ...(input.isAdvance === true ? { isAdvance: true as const } : {}),
  };
}
