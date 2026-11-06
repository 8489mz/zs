/* Pins INV-LOYALTY-STALE-LABELS: the manual-adjust endpoint records a manual
   adjustment as 'manual_adjust'. It used to default an unspecified action to
   'earn' for a positive change and 'redeem' for a negative one, so every
   manual add was stored (and shown) as a purchase earn and every manual
   deduction as a discount redemption. An explicit earn / redeem is still
   honoured for callers that really earn or redeem points. */

export type LoyaltyAdjustActionType = 'earn' | 'redeem' | 'manual_adjust';

export function resolveLoyaltyAdjustActionType(
  actionType: string | undefined,
): LoyaltyAdjustActionType {
  if (actionType === 'earn' || actionType === 'redeem' || actionType === 'manual_adjust') {
    return actionType;
  }
  return 'manual_adjust';
}
