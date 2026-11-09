/**
 * The ECR bridge may time out AFTER the payment terminal charged the customer.
 * Retrying through a second route is never safe once dispatch has started.
 */
export function shouldTryAlternateTerminalCharge(chargeRequestIssued: boolean): boolean {
  return !chargeRequestIssued;
}

/** An already approved card transaction must not be silently detached from the POS cart. */
export function canChangePaymentAfterTerminalApproval(authCode?: string | null, rrn?: string | null): boolean {
  return !Boolean(String(authCode || '').trim() || String(rrn || '').trim());
}

/*
 * INV-REST-PAID-GATES-2 (R4-D, I40): an approval is live when the
 * terminal produced an auth code or an RRN — the same condition the
 * payment inputs already use. While it is live the total-changing
 * inputs (discount, tip, delivery fee, order type) are frozen too,
 * because any of them would move the amount the terminal approved.
 */
export function isTerminalApprovalLive(details?: { authCode?: string | null; rrn?: string | null } | null): boolean {
  return !canChangePaymentAfterTerminalApproval(details?.authCode, details?.rrn);
}

/** Never invent an authorization code when the bank/terminal did not provide one. */
export function terminalAuthorizationLabel(authCode?: string | null, transactionReference?: string | null): string {
  const approvedCode = String(authCode || '').trim();
  if (approvedCode) return `تمت الموافقة بنجاح (رقم التفويض: ${approvedCode})`;
  const reference = String(transactionReference || '').trim();
  return reference
    ? `تمت الموافقة؛ رقم التفويض غير متاح من الماكينة (مرجع العملية: ${reference})`
    : 'تمت الموافقة؛ رقم التفويض غير متاح من الماكينة. راجع إيصال جهاز الدفع';
}

