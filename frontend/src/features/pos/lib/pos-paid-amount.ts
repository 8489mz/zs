/*
 * INV-REST-PAID-DEFINITION (R-B13): one definition of "paid" for the POS workspace.
 *
 * Paid is always the sum of all three payment legs — cash + card + transfer —
 * rounded once at the tenant's book digits. It never depends on the payment
 * channel. The display total (usePosWorkspace), the submit gate
 * (createPosWorkspaceAsyncActions initialPaidAmount) and the posted payload
 * (effectivePaidAmount) all call this one function, so no channel can
 * silently drop a leg: a wallet sale used to drop the cash leg in the gate
 * (the gate saw 0 for cash 20 + transfer 0 and "assumed" a full transfer
 * payment), and a cash/card sale used to drop the transfer leg on screen
 * (the screen showed an amount due the submit path would not charge).
 *
 * Pure module: no React, no DOM, no state — safe to import from Vitest and
 * from the workspace hook and the submit actions alike.
 */

import { roundMoneyValue } from '@/shared/utils/money';
import type { MoneyDigits } from '@/shared/utils/money';

export interface PosPaymentLegs {
  cashAmount?: number | null;
  cardAmount?: number | null;
  transferAmount?: number | null;
}

export function computePaidAmount(legs: PosPaymentLegs, digits: MoneyDigits): number {
  return roundMoneyValue(
    Number(legs.cashAmount || 0) + Number(legs.cardAmount || 0) + Number(legs.transferAmount || 0),
    digits,
  );
}

/*
 * INV-REST-PAID-GATES-2 (R4-D, I45): change is cash-only. A card (or
 * wallet) leg can never produce change — the money never passed
 * through the drawer — so change is the cash leg minus the part of
 * the total the non-cash legs did not cover. The old display summed
 * every leg, so card 120 on a 100 total showed 20 change for cash
 * never received. Non-cash overpay is already blocked at submit
 * (validatePosSaleInput), so the non-cash share is capped at the
 * total here and the change is 0 in that case.
 */
export function computeCashChange(legs: PosPaymentLegs, total: number, digits: MoneyDigits): number {
  const nonCashPaid = Number(legs.cardAmount || 0) + Number(legs.transferAmount || 0);
  const cashOwed = Math.max(0, Number(total || 0) - nonCashPaid);
  return roundMoneyValue(Math.max(0, Number(legs.cashAmount || 0) - cashOwed), digits);
}
