/* R5-A (INV-REST-TOTALS-TRUTH-2, M24): the ONE balance helper for the POS
 * cart and checkout. Three sites used to compute the same balance three
 * ways: getBalancePreview (PosCheckoutDialogSections) returned NEGATIVE
 * remaining, PosCartSummary showed positive remaining, and its 4th tile
 * showed changeAmount on a credit sale with a partial payment while the
 * 3rd tile showed the remaining debt. One sign convention now — remaining
 * positive, change positive — and one threshold (0.009): dust below it is
 * settled, not a debt. Change is shown only for non-credit sales: an
 * overpaid credit sale owes nothing and returns no change. */

export type BalanceKind = 'remaining' | 'change';
export type BalanceTone = 'danger' | 'primary';

export interface BalanceStateInput {
  paymentType: string;
  customerId?: string | number | null;
  paidAmount: number;
  amountDue: number;
  changeAmount: number;
  total: number;
}

export interface BalanceState {
  kind: BalanceKind;
  label: string;
  value: number;
  tone: BalanceTone;
}

const BALANCE_SETTLED_THRESHOLD = 0.009;

export function getBalanceState(input: BalanceStateInput): BalanceState {
  const total = Number(input.total || 0);
  const paid = Number(input.paidAmount || 0);
  // Single source of truth for what is still owed: total minus paid.
  // amountDue is accepted for call-site compatibility (the derived
  // hook computes the same figure) but never overrides this.
  void input.amountDue;
  const remainingDebt = Math.max(0, total - paid);
  const isCredit = input.paymentType === 'credit';
  const hasCustomer = Boolean(String(input.customerId || '').trim());

  if (remainingDebt > BALANCE_SETTLED_THRESHOLD) {
    return {
      kind: 'remaining',
      label: isCredit || hasCustomer ? 'المتبقي (آجل)' : 'المتبقي',
      value: remainingDebt,
      tone: 'danger',
    };
  }

  const change = Number(input.changeAmount || 0);
  if (!isCredit && change > BALANCE_SETTLED_THRESHOLD) {
    return { kind: 'change', label: 'الباقي', value: change, tone: 'primary' };
  }

  return { kind: 'remaining', label: 'المتبقي', value: 0, tone: 'primary' };
}
