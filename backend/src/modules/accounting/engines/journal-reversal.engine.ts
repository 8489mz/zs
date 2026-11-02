type ReversalLine = {
  accountId: number;
  debit: number;
  credit: number;
  partnerType?: string | null;
  partnerId?: number | null;
  branchId?: number | null;
  locationId?: number | null;
  costCenterId?: number | null;
};

import type { MoneyDigits } from './money-minor-units.engine';

/**
 * A reversal link means every financial dimension is exactly offset at the
 * tenant's book digits. The comparison nets each dimension in minor units
 * (digits is required, never a silent cents default): journal lines are
 * stored at book digits and draft lines are normalized to book digits by
 * addLine, so rounding each leg once to minor units is the identity on
 * legitimate data and only guards float noise. A non-finite leg answers
 * false instead of throwing, because this predicate gates a link, not a
 * posting; the posting itself still fails closed on non-finite amounts.
 */
export function areOppositeJournalLines(original: ReversalLine[], opposite: ReversalLine[], digits: MoneyDigits): boolean {
  const factor = 10 ** digits;
  const net = new Map<string, number>();
  for (const line of [...original, ...opposite]) {
    if (![line.debit, line.credit].every(Number.isFinite)) return false;
    const key = JSON.stringify([Number(line.accountId), line.partnerType || 'none', line.partnerId == null ? null : Number(line.partnerId),
      line.branchId == null ? null : Number(line.branchId), line.locationId == null ? null : Number(line.locationId),
      line.costCenterId == null ? null : Number(line.costCenterId)]);
    net.set(key, (net.get(key) || 0) + Math.round(line.debit * factor) - Math.round(line.credit * factor));
  }
  return original.length > 0 && opposite.length > 0 && [...net.values()].every(amount => amount === 0);
}
