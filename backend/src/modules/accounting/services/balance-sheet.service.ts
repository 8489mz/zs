import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../engines/money-minor-units.engine';

export interface BalanceSheetAccountRow {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: string;
  accountGroup: string;
  amount: number;
  compareAmount?: number;
  varianceAmount?: number;
  variancePercent?: number;
}

export interface BalanceSheetSection {
  titleAr: string;
  titleEn: string;
  total: number;
  compareTotal?: number;
  varianceAmount?: number;
  variancePercent?: number;
  accounts: BalanceSheetAccountRow[];
}

export interface BalanceSheetReportData {
  asOfDate: string;
  compareDate?: string;
  isBalanced: boolean;
  difference: number;
  assets: {
    currentAssets: BalanceSheetSection;
    nonCurrentAssets: BalanceSheetSection;
    totalAssets: number;
    compareTotalAssets?: number;
  };
  liabilities: {
    currentLiabilities: BalanceSheetSection;
    nonCurrentLiabilities: BalanceSheetSection;
    totalLiabilities: number;
    compareTotalLiabilities?: number;
  };
  equity: {
    section: BalanceSheetSection;
    currentPeriodNetProfit: number;
    compareCurrentPeriodNetProfit?: number;
    totalEquity: number;
    compareTotalEquity?: number;
  };
  totalLiabilitiesAndEquity: number;
  compareTotalLiabilitiesAndEquity?: number;
}

@Injectable()
export class BalanceSheetService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  /* Digits-aware rounding at the tenant's book digits. Non-finite
   * input still shapes to 0, as before. */
  private toMoney(value: unknown, digits: MoneyDigits): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? roundMoney(n, digits) : 0;
  }

  async getBalanceSheet(
    auth: AuthContext,
    params: { asOfDate?: string; compareDate?: string; branchId?: number },
  ): Promise<BalanceSheetReportData> {
    const tenantId = auth.tenantId;
    // Book digits resolved on the caller's handle (P2 pattern): every
    // amount below is rounded at the tenant's minor-unit precision.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(tenantId)));
    const unit = 10 ** -digits;
    const targetDate = params.asOfDate ? new Date(params.asOfDate) : new Date();
    targetDate.setHours(23, 59, 59, 999);

    const hasCompare = !!params.compareDate;
    let compareDate: Date | null = null;
    if (hasCompare) {
      compareDate = new Date(params.compareDate!);
      compareDate.setHours(23, 59, 59, 999);
    }

    // 1. Fetch all accounting accounts (including inactive ones that may carry historical posted balances)
    const accounts = await (this.db as any)
      .selectFrom('accounting_accounts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('code', 'asc')
      .execute();

    // 2. Fetch posted debit and credit sums per account up to targetDate
    let mainQuery = (this.db as any)
      .selectFrom('journal_entry_lines as jel')
      .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
      .select([
        'jel.account_id',
        sql<number>`COALESCE(SUM(jel.debit), 0)`.as('total_debit'),
        sql<number>`COALESCE(SUM(jel.credit), 0)`.as('total_credit'),
      ])
      .where('je.tenant_id', '=', tenantId)
      .where('jel.tenant_id', '=', tenantId)
      .where('je.status', '=', 'posted')
      .where('je.entry_date', '<=', targetDate)
      .groupBy('jel.account_id');

    if (params.branchId) {
      mainQuery = mainQuery.where('jel.branch_id', '=', params.branchId);
    }

    const mainBalances = await mainQuery.execute();
    const balanceByAccountId = new Map<number, { debit: number; credit: number }>();
    for (const row of mainBalances) {
      balanceByAccountId.set(Number(row.account_id), {
        debit: this.toMoney(row.total_debit, digits),
        credit: this.toMoney(row.total_credit, digits),
      });
    }

    // 3. Fetch comparative sums if requested
    const compareBalanceByAccountId = new Map<number, { debit: number; credit: number }>();
    if (hasCompare && compareDate) {
      let compQuery = (this.db as any)
        .selectFrom('journal_entry_lines as jel')
        .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
        .select([
          'jel.account_id',
          sql<number>`COALESCE(SUM(jel.debit), 0)`.as('total_debit'),
          sql<number>`COALESCE(SUM(jel.credit), 0)`.as('total_credit'),
        ])
        .where('je.tenant_id', '=', tenantId)
        .where('jel.tenant_id', '=', tenantId)
        .where('je.status', '=', 'posted')
        .where('je.entry_date', '<=', compareDate)
        .groupBy('jel.account_id');

      if (params.branchId) {
        compQuery = compQuery.where('jel.branch_id', '=', params.branchId);
      }

      const compBalances = await compQuery.execute();
      for (const row of compBalances) {
        compareBalanceByAccountId.set(Number(row.account_id), {
          debit: this.toMoney(row.total_debit, digits),
          credit: this.toMoney(row.total_credit, digits),
        });
      }
    }

    // 4. Calculate Net Profit/Loss for Current Period (Revenues - Expenses)
    let currentPeriodNetProfit = 0;
    let compareCurrentPeriodNetProfit = 0;

    const currentAssetsRows: BalanceSheetAccountRow[] = [];
    const nonCurrentAssetsRows: BalanceSheetAccountRow[] = [];
    const currentLiabilitiesRows: BalanceSheetAccountRow[] = [];
    const nonCurrentLiabilitiesRows: BalanceSheetAccountRow[] = [];
    const equityRows: BalanceSheetAccountRow[] = [];

    for (const acc of accounts) {
      const accId = Number(acc.id);
      const b = balanceByAccountId.get(accId) || { debit: 0, credit: 0 };
      const cb = compareBalanceByAccountId.get(accId) || { debit: 0, credit: 0 };

      // Normal balance calculation
      // Assets & Contra-Assets: Debit - Credit (contra-assets naturally have Credit > Debit -> negative)
      // Liabilities & Equity: Credit - Debit (drawings naturally have Debit > Credit -> negative)
      // Revenues & Contra-Revenues: Credit - Debit (increases/decreases profit)
      // Expenses & Contra-Expenses: Debit - Credit (decreases profit)
      let amount = 0;
      let compareAmount = 0;

      const type = String(acc.account_type || '').toLowerCase();
      const group = String(acc.account_group || '').toLowerCase();
      const code = String(acc.code || '');

      if (type === 'asset' || type === 'contra_asset') {
        const isContraAsset = type === 'contra_asset' || code.startsWith('129') || group === 'accumulated_depreciation';
        amount = this.toMoney(b.debit - b.credit, digits);
        compareAmount = this.toMoney(cb.debit - cb.credit, digits);

        const row = this.createAccountRow(acc, amount, hasCompare ? compareAmount : undefined, digits);

        if (group === 'fixed_assets' || group === 'non_current_assets' || isContraAsset || code.startsWith('12')) {
          if (amount !== 0 || compareAmount !== 0) nonCurrentAssetsRows.push(row);
        } else {
          if (amount !== 0 || compareAmount !== 0) currentAssetsRows.push(row);
        }
      } else if (type === 'liability' || type === 'contra_liability') {
        amount = this.toMoney(b.credit - b.debit, digits);
        compareAmount = this.toMoney(cb.credit - cb.debit, digits);
        const row = this.createAccountRow(acc, amount, hasCompare ? compareAmount : undefined, digits);

        if (group === 'long_term_liabilities' || group === 'non_current_liabilities' || code.startsWith('22')) {
          if (amount !== 0 || compareAmount !== 0) nonCurrentLiabilitiesRows.push(row);
        } else {
          if (amount !== 0 || compareAmount !== 0) currentLiabilitiesRows.push(row);
        }
      } else if (type === 'equity' || type === 'contra_equity') {
        amount = this.toMoney(b.credit - b.debit, digits);
        compareAmount = this.toMoney(cb.credit - cb.debit, digits);

        const row = this.createAccountRow(acc, amount, hasCompare ? compareAmount : undefined, digits);
        if (amount !== 0 || compareAmount !== 0) equityRows.push(row);
      } else if (type === 'revenue' || type === 'contra_revenue') {
        const rev = this.toMoney(b.credit - b.debit, digits);
        currentPeriodNetProfit += rev;
        if (hasCompare) {
          compareCurrentPeriodNetProfit += this.toMoney(cb.credit - cb.debit, digits);
        }
      } else if (type === 'expense' || type === 'contra_expense') {
        const exp = this.toMoney(b.debit - b.credit, digits);
        currentPeriodNetProfit -= exp;
        if (hasCompare) {
          compareCurrentPeriodNetProfit -= this.toMoney(cb.debit - cb.credit, digits);
        }
      }
    }

    currentPeriodNetProfit = this.toMoney(currentPeriodNetProfit, digits);
    compareCurrentPeriodNetProfit = this.toMoney(compareCurrentPeriodNetProfit, digits);

    // Build sections with totals
    const currentAssetsSec = this.createSection('الأصول المتداولة', 'Current Assets', currentAssetsRows, hasCompare, digits);
    const nonCurrentAssetsSec = this.createSection('الأصول غير المتداولة', 'Non-Current Assets', nonCurrentAssetsRows, hasCompare, digits);
    const totalAssets = this.toMoney(currentAssetsSec.total + nonCurrentAssetsSec.total, digits);
    const compareTotalAssets = hasCompare ? this.toMoney((currentAssetsSec.compareTotal || 0) + (nonCurrentAssetsSec.compareTotal || 0), digits) : undefined;

    const currentLiabilitiesSec = this.createSection('الالتزامات المتداولة', 'Current Liabilities', currentLiabilitiesRows, hasCompare, digits);
    const nonCurrentLiabilitiesSec = this.createSection('الالتزامات غير المتداولة', 'Non-Current Liabilities', nonCurrentLiabilitiesRows, hasCompare, digits);
    const totalLiabilities = this.toMoney(currentLiabilitiesSec.total + nonCurrentLiabilitiesSec.total, digits);
    const compareTotalLiabilities = hasCompare ? this.toMoney((currentLiabilitiesSec.compareTotal || 0) + (nonCurrentLiabilitiesSec.compareTotal || 0), digits) : undefined;

    const equitySec = this.createSection('حقوق الملكية', 'Equity', equityRows, hasCompare, digits);
    // Add current period profit to equity
    const totalEquity = this.toMoney(equitySec.total + currentPeriodNetProfit, digits);
    const compareTotalEquity = hasCompare ? this.toMoney((equitySec.compareTotal || 0) + compareCurrentPeriodNetProfit, digits) : undefined;

    const totalLiabilitiesAndEquity = this.toMoney(totalLiabilities + totalEquity, digits);
    const compareTotalLiabilitiesAndEquity = hasCompare ? this.toMoney((compareTotalLiabilities || 0) + (compareTotalEquity || 0), digits) : undefined;

    const difference = this.toMoney(totalAssets - totalLiabilitiesAndEquity, digits);
    const isBalanced = Math.abs(difference) <= 5 * unit;

    return {
      asOfDate: targetDate.toISOString().slice(0, 10),
      compareDate: hasCompare ? compareDate?.toISOString().slice(0, 10) : undefined,
      isBalanced,
      difference,
      assets: {
        currentAssets: currentAssetsSec,
        nonCurrentAssets: nonCurrentAssetsSec,
        totalAssets,
        compareTotalAssets,
      },
      liabilities: {
        currentLiabilities: currentLiabilitiesSec,
        nonCurrentLiabilities: nonCurrentLiabilitiesSec,
        totalLiabilities,
        compareTotalLiabilities,
      },
      equity: {
        section: equitySec,
        currentPeriodNetProfit,
        compareCurrentPeriodNetProfit: hasCompare ? compareCurrentPeriodNetProfit : undefined,
        totalEquity,
        compareTotalEquity,
      },
      totalLiabilitiesAndEquity,
      compareTotalLiabilitiesAndEquity,
    };
  }

  private createAccountRow(acc: any, amount: number, compareAmount: number | undefined, digits: MoneyDigits): BalanceSheetAccountRow {
    let varianceAmount: number | undefined;
    let variancePercent: number | undefined;

    if (compareAmount !== undefined) {
      varianceAmount = this.toMoney(amount - compareAmount, digits);
      if (compareAmount !== 0) {
        variancePercent = this.toMoney((varianceAmount / Math.abs(compareAmount)) * 100, digits);
      } else {
        variancePercent = amount !== 0 ? 100 : 0;
      }
    }

    return {
      id: Number(acc.id),
      code: acc.code,
      nameAr: acc.name_ar,
      nameEn: acc.name_en || '',
      accountType: acc.account_type,
      accountGroup: acc.account_group || '',
      amount,
      compareAmount,
      varianceAmount,
      variancePercent,
    };
  }

  private createSection(titleAr: string, titleEn: string, rows: BalanceSheetAccountRow[], hasCompare: boolean, digits: MoneyDigits): BalanceSheetSection {
    const total = this.toMoney(rows.reduce((sum, r) => sum + r.amount, 0), digits);
    let compareTotal: number | undefined;
    let varianceAmount: number | undefined;
    let variancePercent: number | undefined;

    if (hasCompare) {
      compareTotal = this.toMoney(rows.reduce((sum, r) => sum + (r.compareAmount || 0), 0), digits);
      varianceAmount = this.toMoney(total - compareTotal, digits);
      if (compareTotal !== 0) {
        variancePercent = this.toMoney((varianceAmount / Math.abs(compareTotal)) * 100, digits);
      } else {
        variancePercent = total !== 0 ? 100 : 0;
      }
    }

    return {
      titleAr,
      titleEn,
      total,
      compareTotal,
      varianceAmount,
      variancePercent,
      accounts: rows,
    };
  }
}
