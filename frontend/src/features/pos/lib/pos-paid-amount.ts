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
