export interface CustomerPaymentPayloadInput {
  customerId: string;
  amount: number;
  note?: string;
  paymentChannel?: 'cash'|'bank'|'card'|'wallet'|'instapay';
  /* INV-INSTAPAY-FIELD-MISSING: the customer InstaPay account number
   * (IPA) this receipt came from. Carried only when the channel is
   * 'instapay'. */
  instapayAddress?: string;
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
}

function normalizeMoney(value: number) {
  return Number(Number(value || 0).toFixed(2));
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

export function buildCustomerPaymentPayload(input: CustomerPaymentPayloadInput) {
  if (!input.customerId) throw new Error('اختر العميل أولًا');
  if (Number(input.amount || 0) <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');

  return {
    customerId: input.customerId,
    amount: normalizeMoney(input.amount),
    note: String(input.note || '').trim(),
    paymentChannel: input.paymentChannel || 'cash',
    instapayAddress: normalizePaymentInstapayAddress(input.paymentChannel, input.instapayAddress),
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
  };
}
