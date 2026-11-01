/**
 * Stable per-submission request keys for expense creation.
 *
 * The backend (INV-TREASURY-EXPENSE-IDEMPOTENCY) requires a mandatory
 * client-supplied requestKey (8-160 chars, trimmed, no server default).
 * A retry with the same key and the same payload returns the original
 * expense; the same key with different data is a 409 conflict. A key
 * generated fresh for every attempt therefore cannot deduplicate the
 * retry it was generated for, so the key must be held for one
 * submission and reused for retries of the identical payload.
 *
 * This helper is pure and holds no state: the hook owns the attempt
 * ref. It mirrors the inventory attempt helper
 * (features/inventory/lib/inventory-operation-attempt.ts): reuse the
 * key for an identical payload, refuse a changed payload while the
 * previous attempt is unresolved, and release only on a known
 * rejection. There is no operation-status endpoint for expenses, so
 * an unknown outcome (network error, 5xx, 408 timeout) keeps the
 * attempt: the user must resubmit the same data or check the register
 * before changing it. The attempt is deliberately in-memory only; a
 * page reload loses it and no localStorage persistence is added here.
 */

export interface ExpenseFormRequestPayload {
  title: string;
  amount: string | number;
  note: string;
  date: string;
  branchId: string;
  locationId: string;
  costCenterId?: string;
}

/** The exact body sent to POST /api/expenses, minus the requestKey. */
export interface ExpenseRequestPayload {
  title: string;
  amount: number;
  note: string;
  date: string;
  branchId?: number;
  locationId?: number;
  costCenterId?: number;
}

export interface ExpenseRequestAttempt {
  requestKey: string;
  fingerprint: string;
}

/**
 * Normalize a form payload to the exact body the mutation sends today.
 * The mapping is preserved unchanged: amount is coerced with Number,
 * the date is converted to an ISO string, and empty scope ids are
 * omitted. Only the requestKey is added by the caller.
 */
export function normalizeExpenseRequestPayload(
  payload: ExpenseFormRequestPayload,
): ExpenseRequestPayload {
  return {
    title: payload.title,
    amount: Number(payload.amount || 0),
    note: payload.note,
    date: new Date(payload.date).toISOString(),
    ...(payload.branchId ? { branchId: Number(payload.branchId) } : {}),
    ...(payload.locationId ? { locationId: Number(payload.locationId) } : {}),
    ...(payload.costCenterId ? { costCenterId: Number(payload.costCenterId) } : {}),
  };
}

/**
 * Canonical fingerprint of the normalized payload, in a fixed field
 * order. Two form submissions that would send the identical body
 * share a fingerprint even when the raw form values differ in
 * representation (for example amount '10' versus 10).
 */
export function expenseRequestFingerprint(payload: ExpenseRequestPayload): string {
  return JSON.stringify([
    payload.title,
    payload.amount,
    payload.note,
    payload.date,
    payload.branchId ?? null,
    payload.locationId ?? null,
    payload.costCenterId ?? null,
  ]);
}

function defaultGenerateExpenseRequestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('Expense request key generation is unavailable in this environment');
}

/**
 * Generate one requestKey and validate it against the backend range
 * (8-160 chars after trimming). A UUID is 36 chars, inside the range.
 */
export function createExpenseRequestKey(
  generateKey: () => string = defaultGenerateExpenseRequestKey,
): string {
  const requestKey = String(generateKey() || '').trim();
  if (requestKey.length < 8 || requestKey.length > 160) {
    throw new Error('Expense request key must be between 8 and 160 characters');
  }
  return requestKey;
}

/**
 * Acquire the attempt for one submission. With no previous attempt a
 * fresh key is generated; an identical payload reuses the previous
 * key; a changed payload throws before any HTTP call, because the
 * previous attempt may already be committed and a new key would
 * silently create a second expense.
 */
export function acquireExpenseRequestAttempt(
  previous: ExpenseRequestAttempt | null,
  payload: ExpenseRequestPayload,
  generateKey: () => string = defaultGenerateExpenseRequestKey,
): ExpenseRequestAttempt {
  const fingerprint = expenseRequestFingerprint(payload);
  if (previous) {
    if (previous.fingerprint !== fingerprint) {
      throw new Error(
        'The previous expense submission outcome is unconfirmed. Resubmit the same expense data before changing it.',
      );
    }
    return previous;
  }
  return { requestKey: createExpenseRequestKey(generateKey), fingerprint };
}

/**
 * Whether a failed attempt may be released so the next submission
 * gets a fresh key. Only known client rejections (HTTP 4xx) release:
 * the server decided before committing. A 408 timeout is excluded
 * because the request may have committed before the timeout, and
 * network errors (status 0) and 5xx keep the attempt for the same
 * reason. An error without a numeric status never releases.
 */
export function mayReleaseExpenseRequestAttempt(error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : NaN;
  if (!Number.isFinite(status)) return false;
  return status >= 400 && status < 500 && status !== 408;
}
