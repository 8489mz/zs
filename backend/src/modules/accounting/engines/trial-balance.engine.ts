/* Trial balance engine (INV-TRIAL-BALANCE-PAGE): a trial balance lists EVERY
 * tenant account (ordered by code) with its posted debit/credit totals and
 * shows the balance in a single debit column or a single credit column.
 * A zero-balance account is INCLUDED with 0.00 / 0.00 (documented rule) so
 * the accountant sees the whole chart, not only accounts that moved. Only
 * posted journal lines feed the sums; the service owns that filter.
 */

export interface TrialBalanceAccountInput {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: string;
}

export interface TrialBalanceSumsInput {
  accountId: number;
  totalDebit: number;
  totalCredit: number;
}

export interface TrialBalanceRow {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  /** Net debit balance (0 when the account nets to credit or zero). */
  debit: number;
  /** Net credit balance (0 when the account nets to debit or zero). */
  credit: number;
}

export interface TrialBalanceReportData {
  asOfDate: string;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  difference: number;
  isBalanced: boolean;
}

function toMoney(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

export function buildTrialBalance(
  asOfDate: string,
  accounts: TrialBalanceAccountInput[],
  sums: TrialBalanceSumsInput[],
): TrialBalanceReportData {
  const sumsByAccountId = new Map<number, { debit: number; credit: number }>();
  for (const row of sums) {
    sumsByAccountId.set(Number(row.accountId), {
      debit: toMoney(row.totalDebit),
      credit: toMoney(row.totalCredit),
    });
  }

  const rows: TrialBalanceRow[] = [...accounts]
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))
    .map((acc) => {
      const s = sumsByAccountId.get(Number(acc.id)) || { debit: 0, credit: 0 };
      const net = toMoney(s.debit - s.credit);
      return {
        id: Number(acc.id),
        code: String(acc.code),
        nameAr: String(acc.nameAr || ''),
        nameEn: String(acc.nameEn || ''),
        accountType: String(acc.accountType || ''),
        totalDebit: s.debit,
        totalCredit: s.credit,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? toMoney(-net) : 0,
      };
    });

  const totalDebit = toMoney(rows.reduce((sum, r) => sum + r.debit, 0));
  const totalCredit = toMoney(rows.reduce((sum, r) => sum + r.credit, 0));
  const difference = toMoney(totalDebit - totalCredit);
  return {
    asOfDate,
    rows,
    totalDebit,
    totalCredit,
    difference,
    // Every money value is rounded to 2dp by toMoney before the difference
    // is computed, so float dust is already gone: a real 0.01 difference is
    // a real one-cent imbalance and must NOT read as balanced (money strict).
    isBalanced: difference === 0,
  };
}
