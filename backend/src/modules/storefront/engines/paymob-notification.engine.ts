/**
 * Paymob transaction classification.
 *
 * A Paymob callback with success=true and pending=false is NOT by itself
 * proof that money was captured. Paymob notifies every lifecycle event
 * with the same success/pending shape: a standalone sale, a capture of a
 * prior authorization, an authorization-only hold, a void, and a refund
 * all arrive as "successful, not pending". Only the transaction-type
 * flags say which one it is, and the webhook handler must never mark an
 * order paid on anything but a capture:
 *
 * - capture: is_capture (capture of a prior authorization) or
 *   is_standalone_payment (a one-step sale: authorization + capture
 *   together). This is the only kind that proves money was taken. The
 *   existing passing webhook fixture is this shape: a standalone card
 *   payment with is_capture=false, is_auth=false,
 *   is_standalone_payment=true.
 * - authorization_only: is_auth with neither capture flag. Funds are
 *   held, not taken; the order must stay pending until the capture
 *   callback arrives. Marking it paid here (or failed) would be wrong
 *   in both directions.
 * - void_or_refund: is_voided or is_refunded wins over every other
 *   flag — a voided capture is a void, not a capture. An unpaid order
 *   receiving one has no money and must take the failure path; a paid
 *   order receiving one keeps its existing additional-payment review.
 * - unclassified: a successful callback carrying none of the flags.
 *   Paymob always sends them; a flag-less payload is treated as
 *   unproven and routed to human review, never marked paid outright.
 */
export type PaymobTransactionKind = 'capture' | 'authorization_only' | 'void_or_refund' | 'unclassified';

export type PaymobTransactionFlags = {
  is_auth?: unknown;
  is_capture?: unknown;
  is_refunded?: unknown;
  is_standalone_payment?: unknown;
  is_voided?: unknown;
};

export function classifyPaymobTransaction(flags: PaymobTransactionFlags): PaymobTransactionKind {
  if (flags.is_voided === true || flags.is_refunded === true) return 'void_or_refund';
  if (flags.is_capture === true || flags.is_standalone_payment === true) return 'capture';
  if (flags.is_auth === true) return 'authorization_only';
  return 'unclassified';
}
