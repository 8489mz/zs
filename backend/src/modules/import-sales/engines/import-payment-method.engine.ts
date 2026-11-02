/**
 * Import payment-method engine: the closed set of payment methods
 * for foreign transfers and broker payments, and the evidence each
 * method requires. Pure and framework-free: imported identically by
 * the production service and the test suite.
 *
 * No method is ever inferred from an account or a default. A caller
 * that supplies no method is recorded as a bank transfer (the
 * historical behaviour: bank account + supplier-payment journal);
 * evidence validation runs only for an explicitly supplied method,
 * so legacy callers keep working unchanged. A caller that DOES
 * supply a method must supply that method's evidence: the evidence
 * is part of the money record, not decoration.
 */

/** Closed payment-method enum. Generic for any importer: no method is tied to one importer's flow. */
export const PAYMENT_METHODS = [
  'bank_transfer',
  'cash_carried',
  'letter_of_credit',
  'cash_against_documents',
  'open_account',
] as const;

export type ImportPaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is ImportPaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Evidence fields carried on the transfer DTO. All optional at the type level; required per method below. */
export interface TransferPaymentEvidence {
  paymentReference?: string | null;
  bankSwiftCode?: string | null;
  form4Number?: string | null;
  form4Date?: string | null;
  carrierName?: string | null;
  travelDate?: string | null;
  handoverReceiptNo?: string | null;
  lcNumber?: string | null;
  lcIssuingBank?: string | null;
  lcExpiryDate?: string | null;
  lcDocuments?: string | null;
  cadHandoverProof?: string | null;
  paymentTerms?: string | null;
  paymentDueDate?: string | null;
}

function requiredText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function requiredDate(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed);
}

/**
 * Throws a plain Error carrying a named code when the evidence for
 * the explicitly supplied method is missing or invalid. The service
 * translates it into a BadRequestException; the code is what specs
 * pin. Form 4 number/date are OPTIONAL at transfer recording for
 * bank transfers (the clearance gate in package 2 enforces them
 * before clearance/receipt posting) — they are never required here.
 */
export function validatePaymentEvidence(
  method: string,
  evidence: TransferPaymentEvidence,
): void {
  if (!isPaymentMethod(method)) {
    throw new Error(
      `[IMPORT_PAYMENT_METHOD_UNKNOWN] Payment method '${method}' is not a supported import payment method.`,
    );
  }
  const missing: string[] = [];
  if (method === 'bank_transfer') {
    if (!requiredText(evidence.paymentReference)) missing.push('paymentReference');
  } else if (method === 'cash_carried') {
    if (!requiredText(evidence.carrierName)) missing.push('carrierName');
    if (!requiredDate(evidence.travelDate)) missing.push('travelDate');
    if (!requiredText(evidence.handoverReceiptNo)) missing.push('handoverReceiptNo');
  } else if (method === 'letter_of_credit') {
    if (!requiredText(evidence.lcNumber)) missing.push('lcNumber');
    if (!requiredText(evidence.lcIssuingBank)) missing.push('lcIssuingBank');
    if (!requiredDate(evidence.lcExpiryDate)) missing.push('lcExpiryDate');
    if (!requiredText(evidence.lcDocuments)) missing.push('lcDocuments');
  } else if (method === 'cash_against_documents') {
    if (!requiredText(evidence.cadHandoverProof)) missing.push('cadHandoverProof');
  } else if (method === 'open_account') {
    if (!requiredText(evidence.paymentTerms)) missing.push('paymentTerms');
    if (!requiredDate(evidence.paymentDueDate)) missing.push('paymentDueDate');
  }
  if (missing.length > 0) {
    throw new Error(
      `[IMPORT_PAYMENT_EVIDENCE_REQUIRED] Payment method '${method}' requires evidence: ${missing.join(', ')}.`,
    );
  }
}
