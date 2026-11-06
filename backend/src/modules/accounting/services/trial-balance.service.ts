import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import {
  buildTrialBalance,
  TrialBalanceReportData,
} from '../engines/trial-balance.engine';

/* Trial balance service (INV-TRIAL-BALANCE-PAGE): one dedicated read of the
 * posted general ledger, per account, as of a date. Same source and same
 * filters as the balance sheet (BalanceSheetService): only journals with
 * status 'posted' and entry_date <= asOf count, tenant-scoped, with an
 * optional branch filter on the journal lines. Draft/cancelled entries and
 * other tenants never enter the sums.
 */
@Injectable()
export class TrialBalanceService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async getTrialBalance(
    auth: AuthContext,
    params: { asOfDate?: string; branchId?: number },
  ): Promise<TrialBalanceReportData> {
    // Fail closed when the caller carries no tenant scope: a trial balance
    // must never run unscoped (it would leak or silently empty the book).
    const { tenantId } = requireTenantScope(auth);
    const targetDate = params.asOfDate ? new Date(params.asOfDate) : new Date();
    targetDate.setHours(23, 59, 59, 999);

    // 1. Every account of the tenant, including inactive ones that may carry
    // historical posted balances and zero-balance accounts (the engine
    // includes zero rows with 0.00 / 0.00 by documented rule).
    const accounts = await this.db
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'name_ar', 'name_en', 'account_type'])
      .where('tenant_id', '=', tenantId)
      .orderBy('code', 'asc')
      .execute();

    // 2. Posted debit/credit sums per account up to the target date.
    let sumsQuery = this.db
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
      sumsQuery = sumsQuery.where('jel.branch_id', '=', params.branchId);
    }

    const sums = await sumsQuery.execute();

    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getDate()).padStart(2, '0');
    return buildTrialBalance(
      `${y}-${m}-${d}`,
      accounts.map((acc) => ({
        id: Number(acc.id),
        code: String(acc.code),
        nameAr: String(acc.name_ar || ''),
        nameEn: String(acc.name_en || ''),
        accountType: String(acc.account_type || ''),
      })),
      sums.map((row) => ({
        accountId: Number(row.account_id),
        totalDebit: Number(row.total_debit),
        totalCredit: Number(row.total_credit),
      })),
    );
  }
}
