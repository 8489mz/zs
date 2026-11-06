/* Pins INV-LOYALTY-STALE-LABELS: a manual loyalty movement is never labelled
   as a purchase earn or a discount redemption, and the loyalty totals only
   count real earns / real redeems. The dialog shows the server-confirmed
   balance after an operation instead of the stale customer snapshot. */

export type LoyaltyMovementActionType =
  | 'earn'
  | 'redeem'
  | 'manual_adjust'
  | 'return_clawback'
  | 'return_refund'
  | 'cancel_clawback'
  | 'edit_clawback'
  | 'cancel_refund'
  | 'edit_refund';

export type LoyaltyMovementTone = 'earn' | 'redeem' | 'clawback' | 'refund' | 'neutral';

export interface LoyaltyMovementLabel {
  /** i18n key suffix under customers.customer_loyalty_modal (s20..s26). */
  key: string;
  /** Arabic label shown when the key is missing from the locale file. */
  fallback: string;
  tone: LoyaltyMovementTone;
}

/**
 * Honest label for one loyalty log row. A manual adjustment is labelled by
 * its direction (manual add / manual deduction) and never borrows the
 * purchase-earn or discount-redemption label, even though both were stored
 * with the same sign before this fix.
 */
export function getLoyaltyMovementLabel(
  actionType: string | null | undefined,
  pointsChange: number | string,
): LoyaltyMovementLabel {
  const change = Number(pointsChange) || 0;
  switch (actionType) {
    case 'earn':
      return { key: 's20', fallback: 'اكتساب مشتريات', tone: 'earn' };
    case 'redeem':
      return { key: 's21', fallback: 'استبدال بخصم', tone: 'redeem' };
    case 'manual_adjust':
      return change >= 0
        ? { key: 's25', fallback: 'إضافة يدوية', tone: 'earn' }
        : { key: 's26', fallback: 'خصم يدوي', tone: 'redeem' };
    case 'return_clawback':
      return { key: 's22', fallback: 'خصم لمرتجع', tone: 'clawback' };
    case 'return_refund':
      return { key: 's23', fallback: 'رد نقاط مرتجع', tone: 'refund' };
    default:
      return { key: 's24', fallback: 'تعديل يدوي', tone: 'neutral' };
  }
}

export interface LoyaltyLogLike {
  action_type: string;
  points_change: number | string;
}

/**
 * Totals for the dialog summary cards. Only rows really earned from a
 * purchase count as earned, and only rows really redeemed for a discount
 * count as redeemed — manual adjustments never inflate either total.
 */
export function summarizeLoyaltyLogs(logs: LoyaltyLogLike[]): {
  totalEarned: number;
  totalRedeemed: number;
} {
  let totalEarned = 0;
  let totalRedeemed = 0;
  for (const log of logs) {
    const change = Number(log.points_change) || 0;
    if (log.action_type === 'earn' && change > 0) totalEarned += change;
    if (log.action_type === 'redeem' && change < 0) totalRedeemed += Math.abs(change);
  }
  return { totalEarned, totalRedeemed };
}

/**
 * Balance shown on the "actual available balance" card. The server-confirmed
 * balance returned by the last operation wins: the customer prop is a
 * snapshot taken when the dialog opened and never refreshes while it is open.
 */
export function resolveDisplayedLoyaltyBalance(
  confirmedBalance: number | null | undefined,
  customerPoints: number | null | undefined,
): number {
  if (typeof confirmedBalance === 'number' && Number.isFinite(confirmedBalance)) return confirmedBalance;
  return Number(customerPoints) || 0;
}
