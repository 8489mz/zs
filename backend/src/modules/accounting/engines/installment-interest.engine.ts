import { MoneyDigits, toMinorUnits, fromMinorUnits } from './money-minor-units.engine';

/**
 * Effective-interest allocation of fixed monthly repayments, preserving the final minor unit.
 *
 * INV-INSTALLMENT-INTEREST-PRECISION: the allocation runs entirely in the tenant's
 * minor units (required `minorUnits`, never a hard-coded 2), so the allocation rows
 * sum to exactly the interest the journal leg posts. The old cents-based version
 * rounded a KWD 7.125 interest to 7.13 for the allocation rows while the journal
 * leg was exact at 7.125; recognition then debited the 2155 deferred account by
 * 7.13 against a 7.125 credit, leaking 0.005 per plan into a permanently
 * over-released deferred balance. The last installment still absorbs the
 * remainder, so the sum is exact at any precision.
 */
/**
 * Even minor-unit split of a book-precision total across installments.
 *
 * INV-CUSTOMER-INSTALLMENTS-MINOR-UNITS: the schedule is split in the
 * tenant's minor units (required `minorUnits`, never a hard-coded 2):
 * every row except the last gets the floored share and the LAST row
 * absorbs the remainder, so the rows sum exactly to the total at book
 * digits — the same last-row-remainder shape as the supplier schedule
 * builder and as allocateInstallmentInterest below. The total must
 * already be rounded at book digits by the caller (roundMoney); a
 * sub-minor total throws via toMinorUnits, and the count must leave
 * at least one minor unit per row. The old cents split gave the
 * remainder to the FIRST rows; the new shape deliberately moves it
 * to the last row.
 */
export function splitInstallmentSchedule(totalWithInterest: number, installmentCount: number, minorUnits: MoneyDigits): number[] {
  if (!Number.isFinite(totalWithInterest) || totalWithInterest <= 0) throw new Error('Invalid installment total');
  if (!Number.isSafeInteger(installmentCount) || installmentCount < 1) throw new Error('Invalid installment count');
  const totalMinor = toMinorUnits(totalWithInterest, minorUnits);
  if (installmentCount > totalMinor) throw new Error('Installment count exceeds available minor units');
  const base = Math.floor(totalMinor / installmentCount);
  const extra = totalMinor % installmentCount;
  const rows: number[] = [];
  for (let index = 0; index < installmentCount; index++) {
    rows.push(fromMinorUnits(index === installmentCount - 1 ? base + extra : base, minorUnits));
  }
  return rows;
}

export function allocateInstallmentInterest(principal: number, payments: number[], totalInterest: number, minorUnits: MoneyDigits): number[] {
  if (!Number.isFinite(principal) || principal <= 0 || !payments.length || payments.some(p => !Number.isFinite(p) || p <= 0) || !Number.isFinite(totalInterest) || totalInterest < 0) throw new Error('Invalid financing terms');
  const factor = 10 ** minorUnits;
  const interestMinor = toMinorUnits(totalInterest, minorUnits);
  if (payments.reduce((sum, payment) => sum + toMinorUnits(payment, minorUnits), 0) !== toMinorUnits(principal, minorUnits) + interestMinor) throw new Error('Financing schedule does not reconcile');
  if (!interestMinor) return payments.map(() => 0);
  const presentValue = (rate: number) => payments.reduce((sum, payment, index) => sum + payment / Math.pow(1 + rate, index + 1), 0);
  let low = 0;
  let high = 1;
  while (presentValue(high) > principal) high *= 2;
  for (let iteration = 0; iteration < 100; iteration++) {
    const middle = (low + high) / 2;
    if (presentValue(middle) > principal) low = middle;
    else high = middle;
  }
  const rate = (low + high) / 2;
  let outstanding = principal;
  let remaining = interestMinor;
  return payments.map((payment, index) => {
    const minor = index === payments.length - 1 ? remaining : Math.min(remaining, Math.max(0, Math.round(outstanding * rate * factor)));
    remaining -= minor;
    outstanding = Math.max(0, outstanding + minor / factor - payment);
    return fromMinorUnits(minor, minorUnits);
  });
}
