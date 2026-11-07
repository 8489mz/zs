import { nextAccountingDay } from '../engines/accounting-date.engine';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../engines/money-minor-units.engine';
import { classifyCashFlow } from '../engines/cash-flow-classification.engine';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';

export interface CashFlowLine {
  labelAr: string;
  labelEn: string;
  amount: number;
  note?: string;
  noteEn?: string;
}

export interface CashFlowSection {
  titleAr: string;
  titleEn: string;
  total: number;
  lines: CashFlowLine[];
}

export interface CashFlowReportData {
  dateFrom: string;
  dateTo: string;
  operatingActivities: CashFlowSection;
  investingActivities: CashFlowSection;
  financingActivities: CashFlowSection;
  netCashFlow: number;
  beginningCash: number;
  endingCash: number;
  reconciledCashActual: number;
  isReconciled: boolean;
  isClassified: boolean;
  unclassifiedActivities: CashFlowSection;
}

@Injectable()
export class CashFlowService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private toMoney(value: unknown, digits: MoneyDigits): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? roundMoney(n, digits) : 0;
  }

  async getCashFlowStatement(
    auth: AuthContext,
    params: { dateFrom?: string; dateTo?: string; branchId?: number },
  ): Promise<CashFlowReportData> {
    const tenantId = auth.tenantId;
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId ?? ''));

    // UTC calendar bounds include every database microsecond of the last day.
    const parseReportBoundary = (input?: string, isEnd = false): { date: Date; dateStr: string } => {
      const today = new Date().toISOString().slice(0, 10);
      const dateStr = input ? input.slice(0, 10) : isEnd ? today : `${today.slice(0, 4)}-01-01`;
      let end: Date;
      try { end = nextAccountingDay(dateStr); }
      catch { throw new BadRequestException('تاريخ التقرير غير صالح.'); }
      return { date: isEnd ? end : new Date(`${dateStr}T00:00:00.000Z`), dateStr };
    };

    const fromBoundary = parseReportBoundary(params.dateFrom, false);
    const toBoundary = parseReportBoundary(params.dateTo, true);
    const fromDate = fromBoundary.date;
    const toDate = toBoundary.date;
    if (toDate <= fromDate) throw new BadRequestException('نهاية التقرير تسبق بدايته.');
    const fromDateStr = fromBoundary.dateStr;
    const toDateStr = toBoundary.dateStr;

    // 1. Fetch cash & bank accounts (Cash & Cash Equivalents)
    const cashAccounts = await (this.db as any)
      .selectFrom('accounting_accounts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('is_cash_bank', '=', true)
      .where('code', 'not in', ['1121', '1122'])
      .execute();

    const cashAccountIds = cashAccounts.map((a: any) => Number(a.id));

    // 2. Beginning cash balance (posted up to before fromDate)
    let begQuery = (this.db as any)
      .selectFrom('journal_entry_lines as jel')
      .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
      .select([
        sql<number>`COALESCE(SUM(jel.debit), 0)`.as('debit_sum'),
        sql<number>`COALESCE(SUM(jel.credit), 0)`.as('credit_sum'),
      ])
      .where('je.tenant_id', '=', tenantId)
      .where('jel.tenant_id', '=', tenantId)
      .where('je.status', '=', 'posted')
      .where('je.entry_date', '<', fromDate);

    if (cashAccountIds.length > 0) {
      begQuery = begQuery.where('jel.account_id', 'in', cashAccountIds);
    } else {
      begQuery = begQuery.where('jel.account_id', '=', -1);
    }
    if (params.branchId) {
      begQuery = begQuery.where('jel.branch_id', '=', params.branchId);
    }
    const begRow = await begQuery.executeTakeFirst();
    const beginningCash = this.toMoney(Number(begRow?.debit_sum || 0) - Number(begRow?.credit_sum || 0), digits);

    // 3. Ending cash balance (posted up to toDate)
    let endQuery = (this.db as any)
      .selectFrom('journal_entry_lines as jel')
      .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
      .select([
        sql<number>`COALESCE(SUM(jel.debit), 0)`.as('debit_sum'),
        sql<number>`COALESCE(SUM(jel.credit), 0)`.as('credit_sum'),
      ])
      .where('je.tenant_id', '=', tenantId)
      .where('jel.tenant_id', '=', tenantId)
      .where('je.status', '=', 'posted')
      .where('je.entry_date', '<', toDate);

    if (cashAccountIds.length > 0) {
      endQuery = endQuery.where('jel.account_id', 'in', cashAccountIds);
    } else {
      endQuery = endQuery.where('jel.account_id', '=', -1);
    }
    if (params.branchId) {
      endQuery = endQuery.where('jel.branch_id', '=', params.branchId);
    }
    const endRow = await endQuery.executeTakeFirst();
    const endingCash = this.toMoney(Number(endRow?.debit_sum || 0) - Number(endRow?.credit_sum || 0), digits);

    const flows = await sql<{ id: number; explicit_category: 'operating' | 'investing' | 'financing' | null; cash: number; operating: number; investing: number; financing: number }>`
      with legs as (
        select j.id, j.cash_flow_category as explicit_category, l.debit, l.credit,
          case when a.id = any(${cashAccountIds}::bigint[]) then 'cash'
               when a.account_type in ('equity', 'contra_equity') or a.code like '22%' then 'financing'
               when a.account_type in ('asset', 'contra_asset') and
                 (a.account_group in ('fixed_assets', 'non_current_assets', 'accumulated_depreciation') or a.code like '12%') then 'investing'
               else 'operating' end as category
        from journal_entries j join journal_entry_lines l on l.journal_entry_id = j.id and l.tenant_id = j.tenant_id
        join accounting_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id
        where j.tenant_id = ${tenantId} and j.status = 'posted' and j.entry_date >= ${fromDate} and j.entry_date < ${toDate}
          ${params.branchId ? sql`and l.branch_id = ${params.branchId}` : sql``}
      )
      select id, max(explicit_category) as explicit_category,
        coalesce(sum(debit - credit) filter (where category = 'cash'), 0) as cash,
        coalesce(sum(credit - debit) filter (where category = 'operating'), 0) as operating,
        coalesce(sum(credit - debit) filter (where category = 'investing'), 0) as investing,
        coalesce(sum(credit - debit) filter (where category = 'financing'), 0) as financing
      from legs group by id having sum(debit - credit) filter (where category = 'cash') <> 0
    `.execute(this.db);
    const totals = { operating: 0, investing: 0, financing: 0, unclassified: 0 };
    let unclassifiedCount = 0;
    for (const row of flows.rows) {
      const amounts = classifyCashFlow(Number(row.cash), Number(row.operating), Number(row.investing), Number(row.financing), row.explicit_category);
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += amounts[key];
      if (amounts.unclassified !== 0) unclassifiedCount++;
    }
    const section = (titleAr: string, titleEn: string, amount: number): CashFlowSection => ({ titleAr, titleEn, total: this.toMoney(amount, digits),
      lines: [{ labelAr: titleAr, labelEn: titleEn, amount: this.toMoney(amount, digits) }],
    });
    const netCashFlow = this.toMoney(totals.operating + totals.investing + totals.financing + totals.unclassified, digits);
    return {
      dateFrom: fromDateStr, dateTo: toDateStr,
      operatingActivities: section('صافي التدفقات التشغيلية', 'Net Operating Cash Flows', totals.operating),
      investingActivities: section('صافي التدفقات الاستثمارية', 'Net Investing Cash Flows', totals.investing),
      financingActivities: section('صافي التدفقات التمويلية', 'Net Financing Cash Flows', totals.financing),
      unclassifiedActivities: section('تدفقات مختلطة تتطلب تصنيفاً محاسبياً', 'Mixed Cash Flows Requiring Attribution', totals.unclassified),
      isClassified: unclassifiedCount === 0,
      netCashFlow, beginningCash, endingCash,
      reconciledCashActual: this.toMoney(endingCash - beginningCash, digits),
      // Tolerance stays 0.01: the section classifier
      // (cash-flow-classification.engine.ts) still rounds to cents, so
      // a half-minor-unit tolerance would false-flag 3dp tenants until
      // that engine is digits-aware. The tolerance is a report flag,
      // never a posting.
      isReconciled: Math.abs(this.toMoney(endingCash - beginningCash - netCashFlow, digits)) < 0.01,
    };
  }
}
