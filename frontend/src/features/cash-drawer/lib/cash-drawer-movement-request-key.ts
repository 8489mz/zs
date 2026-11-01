/**
 * Stable per-submission request keys for cash-drawer movements.
 *
 * The backend (INV-CASH-DRAWER-MOVEMENT-IDEMPOTENCY) requires a
 * mandatory client-supplied requestKey (8-160 chars, trimmed, no
 * server default) on POST /api/cashier-shifts/:id/cash-movement. A
 * retry with the same key and the same payload returns the current
 * listing without posting twice; the same key with different data is
 * a 409 conflict. A key generated fresh for every attempt therefore
 * cannot deduplicate the retry it was generated for, so the key must
 * be held for one submission and reused for retries of the identical
 * payload. This mirrors the expense attempt helper
 * (features/treasury/lib/expense-request-key.ts).
 *
 * The note is trimmed in the normalized payload because the server
 * trims it before storing and comparing, so 'x ' and 'x' are the same
 * movement server-side and must share a fingerprint here. The manager
 * PIN is an approval credential, not payload identity, and is
 * deliberately excluded from the fingerprint. The attempt is
 * deliberately in-memory only; a page reload loses it and no
 * localStorage persistence is added here.
 */

export interface CashDrawerMovementFormPayload {
  shiftId: string;
  type: 'cash_in' | 'cash_out';
  amount: string | number;
  note: string;
}

/** The exact movement body sent, minus managerPin and requestKey. */
export interface CashDrawerMovementRequestPayload {
  shiftId: string;
  type: 'cash_in' | 'cash_out';
  amount: number;
  note: string;
}

export interface CashDrawerMovementRequestAttempt {
  requestKey: string;
  fingerprint: string;
}

/**
 * Normalize a form payload to the exact body the mutation sends.
 * The mapping is preserved unchanged: amount is coerced with Number
 * and the note is trimmed, exactly as the server stores it.
 */
export function normalizeCashDrawerMovementRequestPayload(
  payload: CashDrawerMovementFormPayload,
): CashDrawerMovementRequestPayload {
  return {
    shiftId: payload.shiftId,
    type: payload.type,
    amount: Number(payload.amount || 0),
    note: String(payload.note || '').trim(),
  };
}

/**
 * Canonical fingerprint of the normalized payload, in a fixed field
 * order. Two form submissions that would send the identical body
 * share a fingerprint even when the raw form values differ in
 * representation (for example amount '10' versus 10).
 */
export function cashDrawerMovementRequestFingerprint(
  payload: CashDrawerMovementRequestPayload,
): string {
  return JSON.stringify([payload.shiftId, payload.type, payload.amount, payload.note]);
}

function defaultGenerateCashDrawerMovementRequestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('Drawer movement request key generation is unavailable in this environment');
}

/**
 * Generate one requestKey and validate it against the backend range
 * (8-160 chars after trimming). A UUID is 36 chars, inside the range.
 */
export function createCashDrawerMovementRequestKey(
  generateKey: () => string = defaultGenerateCashDrawerMovementRequestKey,
): string {
  const requestKey = String(generateKey() || '').trim();
  if (requestKey.length < 8 || requestKey.length > 160) {
    throw new Error('Drawer movement request key must be between 8 and 160 characters');
  }
  return requestKey;
}

/**
 * Acquire the attempt for one submission. With no previous attempt a
 * fresh key is generated; an identical payload reuses the previous
 * key; a changed payload throws before any HTTP call, because the
 * previous attempt may already be committed and a new key would
 * silently post a second movement.
 */
export function acquireCashDrawerMovementRequestAttempt(
  previous: CashDrawerMovementRequestAttempt | null,
  payload: CashDrawerMovementRequestPayload,
  generateKey: () => string = defaultGenerateCashDrawerMovementRequestKey,
): CashDrawerMovementRequestAttempt {
  const fingerprint = cashDrawerMovementRequestFingerprint(payload);
  if (previous) {
    if (previous.fingerprint !== fingerprint) {
      throw new Error(
        'The previous drawer movement outcome is unconfirmed. Resubmit the same movement data before changing it.',
      );
    }
    return previous;
  }
  return { requestKey: createCashDrawerMovementRequestKey(generateKey), fingerprint };
}

/**
 * Whether a failed attempt may be released so the next submission
 * gets a fresh key. Only known client rejections (HTTP 4xx) release:
 * the server decided before committing. A 408 timeout is excluded
 * because the request may have committed before the timeout, and
 * network errors (status 0) and 5xx keep the attempt for the same
 * reason. An error without a numeric status never releases.
 */
export function mayReleaseCashDrawerMovementRequestAttempt(error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : NaN;
  if (!Number.isFinite(status)) return false;
  return status >= 400 && status < 500 && status !== 408;
}
