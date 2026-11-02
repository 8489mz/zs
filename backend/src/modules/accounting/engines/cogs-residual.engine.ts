/*
 * COGS remainder absorption (INV-COGS-REMAINDER-ABSORPTION).
 *
 * THE GAP: postSale rounded the TOTAL COGS once at book digits
 * (qty x frozen unit cost, summed, then rounded). The remaining
 * stock keeps its full-precision weighted cost, so the two halves
 * can each round up and exceed the whole by one minor unit:
 * 16 units at 15.3125 = 245.00; selling 10 posts COGS 153.13
 * (153.125 rounded up) while the remaining 6 x 15.3125 = 91.875
 * reconciles to 91.88 — GL 91.87 vs physical 91.88.
 *
 * THE RULE: derive the remaining stock value at book digits
 * first, and let the COGS leg be the residual (pre-sale value
 * minus remaining value, both rounded at book digits, per
 * product and unit cost). The residual is computed in minor
 * units so the difference of two book-digit amounts is exact.
 * When nothing remains, the residual equals the old total
 * rounding exactly; when the sale empties only part of the
 * stock, the half-unit lands in COGS and GL equals physical.
 * Non-finite quantities or costs fail closed through the
 * canonical rounder. The remaining quantity is read by the
 * caller AFTER the sale's stock movement, on the same
 * transaction handle, so the read and the journal commit or
 * roll back together.
 */

import { fromMinorUnits, roundMoney, toMinorUnits, type MoneyDigits } from './money-minor-units.engine';

export interface CogsResidualGroup {
  qtySold: number;
  unitCost: number;
  qtyRemaining: number;
}

export function cogsResidualAmount(groups: CogsResidualGroup[], digits: MoneyDigits): number {
  if (digits !== 2 && digits !== 3) throw new Error('Invalid book digits');
  let residualMinor = 0;
  for (const group of groups) {
    const preSaleValue = roundMoney((group.qtyRemaining + group.qtySold) * group.unitCost, digits);
    const remainingValue = roundMoney(group.qtyRemaining * group.unitCost, digits);
    residualMinor += toMinorUnits(preSaleValue, digits) - toMinorUnits(remainingValue, digits);
  }
  return fromMinorUnits(residualMinor, digits);
}
