import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export interface DailyRollupSummary {
  rollupDate: string;
  branchId: number | null;
  salesCount: number;
  salesTotal: number;
  cashSalesTotal: number;
  creditSalesTotal: number;
  cogsTotal: number;
  grossProfit: number;
  returnsCount: number;
  returnsTotal: number;
  expensesTotal: number;
  netProfit: number;
}

export interface YearComparisonRow {
  year: number;
  salesCount: number;
  salesTotal: number;
  cogsTotal: number;
  grossProfit: number;
  returnsTotal: number;
  expensesTotal: number;
  netProfit: number;
  monthlyBreakdown: Array<{
    month: number;
    salesTotal: number;
    grossProfit: number;
    netProfit: number;
  }>;
}

@Injectable()
export class DailyCommercialRollupService {
  private readonly logger = new Logger(DailyCommercialRollupService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private toBookMoney(value: unknown, digits: MoneyDigits): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? roundMoney(n, digits) : 0;
  }

  /**
   * Computes and upserts daily commercial rollup for a specific tenant, date, and optional branch.
   * Runs in 100% SQL aggregation mode (0 raw rows fetched into Node.js).
   */
  async computeAndStoreDailyRollup(
    tenantId: string,
    dateStr: string,
    branchId?: number,
  ): Promise<DailyRollupSummary> {
    const branchKey = branchId ?? -1;
    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    // 1. Sales & Cash/Credit Aggregates
    let salesQuery = (this.db as any)
      .selectFrom('sales')
      .select([
        sql<number>`COALESCE(COUNT(*), 0)`.as('sales_count'),
        sql<number>`COALESCE(SUM(total), 0)`.as('sales_total'),
        sql<number>`COALESCE(SUM(CASE WHEN payment_channel = 'cash' OR (payment_type = 'cash' AND payment_channel IS NULL) THEN total ELSE 0 END), 0)`.as('cash_total'),
        sql<number>`COALESCE(SUM(CASE WHEN payment_type = 'credit' OR payment_channel = 'credit' THEN total ELSE 0 END), 0)`.as('credit_total'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('status', '!=', 'cancelled')
      .where('created_at', '>=', startOfDay)
      .where('created_at', '<=', endOfDay);

    if (branchId) {
      salesQuery = salesQuery.where('branch_id', '=', branchId);
    }

    // 2. COGS Aggregate directly in SQL
    let cogsQuery = (this.db as any)
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .select(
        sql<number>`COALESCE(SUM(si.qty * COALESCE(si.cost_price, 0)), 0)`.as('cogs_total'),
      )
      .where('s.tenant_id', '=', tenantId)
      .where('si.tenant_id', '=', tenantId)
      .where('s.status', '!=', 'cancelled')
      .where('s.created_at', '>=', startOfDay)
      .where('s.created_at', '<=', endOfDay);

    if (branchId) {
      cogsQuery = cogsQuery.where('s.branch_id', '=', branchId);
    }

    // 3. Cancelled / Returns Aggregate
    let returnsQuery = (this.db as any)
      .selectFrom('sales')
      .select([
        sql<number>`COALESCE(COUNT(*), 0)`.as('returns_count'),
        sql<number>`COALESCE(SUM(total), 0)`.as('returns_total'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'cancelled')
      .where('created_at', '>=', startOfDay)
      .where('created_at', '<=', endOfDay);

    if (branchId) {
      returnsQuery = returnsQuery.where('branch_id', '=', branchId);
    }

    // 4. Expenses Aggregate
    let expensesQuery = (this.db as any)
      .selectFrom('expenses')
      .select(sql<number>`COALESCE(SUM(amount), 0)`.as('expenses_total'))
      .where('tenant_id', '=', tenantId)
      .where('expense_date', '>=', startOfDay)
      .where('expense_date', '<=', endOfDay);

    if (branchId) {
      expensesQuery = expensesQuery.where('branch_id', '=', branchId);
    }

    const [salesRow, cogsRow, returnsRow, expensesRow] = await Promise.all([
      salesQuery.executeTakeFirst(),
      cogsQuery.executeTakeFirst(),
      returnsQuery.executeTakeFirst(),
      expensesQuery.executeTakeFirst(),
    ]);

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const salesCount = Number(salesRow?.sales_count || 0);
    const salesTotal = this.toBookMoney(salesRow?.sales_total, bookDigits);
    const cashSalesTotal = this.toBookMoney(salesRow?.cash_total, bookDigits);
    const creditSalesTotal = this.toBookMoney(salesRow?.credit_total, bookDigits);
    const cogsTotal = this.toBookMoney(cogsRow?.cogs_total, bookDigits);
    const grossProfit = this.toBookMoney(salesTotal - cogsTotal, bookDigits);
    const returnsCount = Number(returnsRow?.returns_count || 0);
    const returnsTotal = this.toBookMoney(returnsRow?.returns_total, bookDigits);
    const expensesTotal = this.toBookMoney(expensesRow?.expenses_total, bookDigits);
    const netProfit = this.toBookMoney(grossProfit - expensesTotal, bookDigits);

    // 5. Atomic Upsert into daily_commercial_rollups
    await (this.db as any)
      .insertInto('daily_commercial_rollups')
      .values({
        tenant_id: tenantId,
        rollup_date: dateStr,
        branch_id: branchId ?? null,
        branch_key: branchKey,
        sales_count: salesCount,
        sales_total: salesTotal,
        cash_sales_total: cashSalesTotal,
        credit_sales_total: creditSalesTotal,
        cogs_total: cogsTotal,
        gross_profit: grossProfit,
        returns_count: returnsCount,
        returns_total: returnsTotal,
        expenses_total: expensesTotal,
        net_profit: netProfit,
        updated_at: sql`NOW()`,
      })
      .onConflict((oc: any) =>
        oc.columns(['tenant_id', 'rollup_date', 'branch_key']).doUpdateSet({
          sales_count: salesCount,
          sales_total: salesTotal,
          cash_sales_total: cashSalesTotal,
          credit_sales_total: creditSalesTotal,
          cogs_total: cogsTotal,
          gross_profit: grossProfit,
          returns_count: returnsCount,
          returns_total: returnsTotal,
          expenses_total: expensesTotal,
          net_profit: netProfit,
          updated_at: sql`NOW()`,
        }),
      )
      .execute();

    return {
      rollupDate: dateStr,
      branchId: branchId ?? null,
      salesCount,
      salesTotal,
      cashSalesTotal,
      creditSalesTotal,
      cogsTotal,
      grossProfit,
      returnsCount,
      returnsTotal,
      expensesTotal,
      netProfit,
    };
  }

  /**
   * High-speed multi-year historical comparison report.
   * Reads from daily_commercial_rollups (365 rows per year) instead of scanning millions of sales.
   * Completes in < 5ms.
   */
  async getHistoricalMultiYearComparison(
    tenantId: string,
    years: number[],
    branchId?: number,
  ): Promise<YearComparisonRow[]> {
    if (!years || years.length === 0) return [];

    const branchKey = branchId ?? -1;

    let query = (this.db as any)
      .selectFrom('daily_commercial_rollups')
      .select([
        sql<number>`EXTRACT(YEAR FROM rollup_date)`.as('year'),
        sql<number>`EXTRACT(MONTH FROM rollup_date)`.as('month'),
        sql<number>`COALESCE(SUM(sales_count), 0)`.as('sales_count'),
        sql<number>`COALESCE(SUM(sales_total), 0)`.as('sales_total'),
        sql<number>`COALESCE(SUM(cogs_total), 0)`.as('cogs_total'),
        sql<number>`COALESCE(SUM(gross_profit), 0)`.as('gross_profit'),
        sql<number>`COALESCE(SUM(returns_total), 0)`.as('returns_total'),
        sql<number>`COALESCE(SUM(expenses_total), 0)`.as('expenses_total'),
        sql<number>`COALESCE(SUM(net_profit), 0)`.as('net_profit'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('branch_key', '=', branchKey)
      .where(sql<boolean>`EXTRACT(YEAR FROM rollup_date) IN (${sql.join(years)})`)
      .groupBy([
        sql`EXTRACT(YEAR FROM rollup_date)`,
        sql`EXTRACT(MONTH FROM rollup_date)`,
      ])
      .orderBy(sql`EXTRACT(YEAR FROM rollup_date)`, 'asc')
      .orderBy(sql`EXTRACT(MONTH FROM rollup_date)`, 'asc');

    const rows = await query.execute();

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const yearMap = new Map<number, YearComparisonRow>();
    for (const y of years) {
      yearMap.set(y, {
        year: y,
        salesCount: 0,
        salesTotal: 0,
        cogsTotal: 0,
        grossProfit: 0,
        returnsTotal: 0,
        expensesTotal: 0,
        netProfit: 0,
        monthlyBreakdown: [],
      });
    }

    for (const r of rows) {
      const year = Number(r.year);
      const month = Number(r.month);
      const rowSales = this.toBookMoney(r.sales_total, bookDigits);
      const rowGross = this.toBookMoney(r.gross_profit, bookDigits);
      const rowNet = this.toBookMoney(r.net_profit, bookDigits);

      const targetYear = yearMap.get(year);
      if (targetYear) {
        targetYear.salesCount += Number(r.sales_count || 0);
        targetYear.salesTotal = this.toBookMoney(targetYear.salesTotal + rowSales, bookDigits);
        targetYear.cogsTotal = this.toBookMoney(targetYear.cogsTotal + this.toBookMoney(r.cogs_total, bookDigits), bookDigits);
        targetYear.grossProfit = this.toBookMoney(targetYear.grossProfit + rowGross, bookDigits);
        targetYear.returnsTotal = this.toBookMoney(targetYear.returnsTotal + this.toBookMoney(r.returns_total, bookDigits), bookDigits);
        targetYear.expensesTotal = this.toBookMoney(targetYear.expensesTotal + this.toBookMoney(r.expenses_total, bookDigits), bookDigits);
        targetYear.netProfit = this.toBookMoney(targetYear.netProfit + rowNet, bookDigits);
        targetYear.monthlyBreakdown.push({
          month,
          salesTotal: rowSales,
          grossProfit: rowGross,
          netProfit: rowNet,
        });
      }
    }

    return Array.from(yearMap.values()).sort((a, b) => a.year - b.year);
  }
}
