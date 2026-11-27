import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { resolveBusinessDateKey } from '../../accounting/engines/accounting-date.engine';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { getBusinessDayBounds } from '../helpers/reports-range.helper';
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
  async computeAndStoreDailyRollup(tenantId: string, dateStr: string, branchId?: number): Promise<DailyRollupSummary> {
    const branchKey = branchId ?? -1;
    // The rollup day is a business day (INV-BUSINESS-DATE-TENANT-LOCAL):
    // an empty date defaults to the tenant-local today, and the window
    // is the tenant-local day, not the UTC day. The old UTC window
    // counted the wrong sales around local midnight -- and, with a
    // tenant-local key, would have stored a rollup whose label and
    // contents disagreed (the UTC window of the Cairo day is mostly in
    // the future at 01:00 Cairo).
    const effectiveDate = dateStr?.trim()
      ? dateStr.trim()
      : await resolveBusinessDateKey(this.db, tenantId, new Date());
    const bounds = getBusinessDayBounds(effectiveDate, await getTenantTimezone(this.db, tenantId));
    const startOfDay = bounds.start;
    const endOfDay = bounds.end;

    // 1. Sales & Cash/Credit Aggregates
    let salesQuery = this.db
      .selectFrom('sales')
      .select([
        sql<number>`COALESCE(COUNT(*), 0)`.as('sales_count'),
        sql<number>`COALESCE(SUM(total), 0)`.as('sales_total'),
        sql<number>`COALESCE(SUM(CASE WHEN payment_channel = 'cash' OR (payment_type = 'cash' AND payment_channel IS NULL) THEN total ELSE 0 END), 0)`.as(
          'cash_total',
        ),
        sql<number>`COALESCE(SUM(CASE WHEN payment_type = 'credit' OR payment_channel = 'credit' THEN total ELSE 0 END), 0)`.as(
          'credit_total',
        ),
      ])
      .where('tenant_id', '=', tenantId)
      .where('status', '!=', 'cancelled')
      .where('created_at', '>=', startOfDay)
      .where('created_at', '<=', endOfDay);

    if (branchId) {
      salesQuery = salesQuery.where('branch_id', '=', branchId);
    }

    // 2. COGS Aggregate directly in SQL
    let cogsQuery = this.db
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .select(sql<number>`COALESCE(SUM(si.qty * COALESCE(si.cost_price, 0)), 0)`.as('cogs_total'))
      .where('s.tenant_id', '=', tenantId)
      .where('si.tenant_id', '=', tenantId)
      .where('s.status', '!=', 'cancelled')
      .where('s.created_at', '>=', startOfDay)
      .where('s.created_at', '<=', endOfDay);

    if (branchId) {
      cogsQuery = cogsQuery.where('s.branch_id', '=', branchId);
    }

    // 3. Real returns aggregate (INV-VAN-PROFIT-REP-REPORTING).
    // BEFORE: returns were counted as CANCELLED sales only
    // (status = 'cancelled') — a cancelled sale is not a return, and
    // real return_documents were never subtracted, so the rollup's
    // net profit disagreed with the summary's netOperatingProfit on
    // any day with returns. NOW: real returns (return_documents
    // joined to sales, return_type = 'sale', same tenant-day window
    // on the RETURN's date — the day the return happened, matching
    // the summary, which counts returns in the period regardless of
    // the sale date). Cancelled sales stay excluded from salesTotal
    // (section 1) and are counted nowhere: they never happened
    // commercially. The branch filter uses the return's own branch
    // (rd.branch_id), the same column the summary's scope filter
    // applies to return_documents.
    let returnsQuery = this.db
      .selectFrom('return_documents as rd')
      .innerJoin('sales as s', (j: any) =>
        j.onRef('s.id', '=', 'rd.invoice_id').onRef('s.tenant_id', '=', 'rd.tenant_id'),
      )
      .select([
        sql<number>`COALESCE(COUNT(*), 0)`.as('returns_count'),
        sql<number>`COALESCE(SUM(rd.total), 0)`.as('returns_total'),
      ])
      .where('rd.tenant_id', '=', tenantId)
      .where('rd.return_type', '=', 'sale')
      .where('rd.created_at', '>=', startOfDay)
      .where('rd.created_at', '<=', endOfDay);

    if (branchId) {
      returnsQuery = returnsQuery.where('rd.branch_id', '=', branchId);
    }

    // 3b. Returned-items COGS (same fallback as the pivot's
    // item-level net_profit: the return line's cost, else the sale
    // line's cost). The stored cogs_total below is NET of this, so
    // a stored row reconciles from its own columns:
    // gross_profit = (sales_total − returns_total) − cogs_total.
    let returnedCogsQuery = this.db
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (j: any) =>
        j.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'),
      )
      .leftJoin('sale_items as si', (j: any) =>
        j.onRef('si.id', '=', 'ri.sale_item_id').onRef('si.tenant_id', '=', 'ri.tenant_id'),
      )
      .select(
        sql<number>`COALESCE(SUM(ri.qty * COALESCE(ri.cost_price, si.cost_price, 0)), 0)`.as('returned_cogs_total'),
      )
      .where('rd.tenant_id', '=', tenantId)
      .where('rd.return_type', '=', 'sale')
      .where('rd.created_at', '>=', startOfDay)
      .where('rd.created_at', '<=', endOfDay);

    if (branchId) {
      returnedCogsQuery = returnedCogsQuery.where('rd.branch_id', '=', branchId);
    }

    // 4. Expenses Aggregate
    let expensesQuery = this.db
      .selectFrom('expenses')
      .select(sql<number>`COALESCE(SUM(amount), 0)`.as('expenses_total'))
      .where('tenant_id', '=', tenantId)
      .where('expense_date', '>=', startOfDay)
      .where('expense_date', '<=', endOfDay);

    if (branchId) {
      expensesQuery = expensesQuery.where('branch_id', '=', branchId);
    }

    const [salesRow, cogsRow, returnsRow, returnedCogsRow, expensesRow] = await Promise.all([
      salesQuery.executeTakeFirst(),
      cogsQuery.executeTakeFirst(),
      returnsQuery.executeTakeFirst(),
      returnedCogsQuery.executeTakeFirst(),
      expensesQuery.executeTakeFirst(),
    ]);

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const salesCount = Number(salesRow?.sales_count || 0);
    const salesTotal = this.toBookMoney(salesRow?.sales_total, bookDigits);
    const cashSalesTotal = this.toBookMoney(salesRow?.cash_total, bookDigits);
    const creditSalesTotal = this.toBookMoney(salesRow?.credit_total, bookDigits);
    // INV-VAN-PROFIT-REP-REPORTING: cogs_total is stored NET of
    // returned-items COGS, so gross profit reconciles from the stored
    // row: (sales_total − returns_total) − cogs_total. The pre-P6
    // stored value was gross COGS with returns never subtracted.
    const cogsTotal = this.toBookMoney(
      Number(cogsRow?.cogs_total || 0) - Number(returnedCogsRow?.returned_cogs_total || 0),
      bookDigits,
    );
    const returnsCount = Number(returnsRow?.returns_count || 0);
    const returnsTotal = this.toBookMoney(returnsRow?.returns_total, bookDigits);
    const grossProfit = this.toBookMoney(salesTotal - returnsTotal - cogsTotal, bookDigits);
    const expensesTotal = this.toBookMoney(expensesRow?.expenses_total, bookDigits);
    const netProfit = this.toBookMoney(grossProfit - expensesTotal, bookDigits);

    // 5. Atomic Upsert into daily_commercial_rollups
    await this.db
      .insertInto('daily_commercial_rollups')
      .values({
        tenant_id: tenantId,
        rollup_date: effectiveDate,
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
      rollupDate: effectiveDate,
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
   * INV-VAN-PROFIT-REP-REPORTING: one-off backfill for the P6 returns
   * fix. Stored rollup rows are DERIVED aggregates, not posted
   * journals — recomputing them changes no journal, no sale, no
   * return. Each day in [dateFrom, dateTo] is recomputed through
   * computeAndStoreDailyRollup (idempotent upsert), so the run is
   * safe to repeat. The operator runs it once after deploy for the
   * affected range (e.g. from the first return date); the manual
   * compute-day endpoint and any nightly job keep future days
   * correct automatically. Branch-scoped rows recompute only when
   * branchId is given; otherwise the tenant-wide row (branch_key -1)
   * is recomputed. Returns {recomputedDays} for the caller to log.
   */
  async recomputeRollupsForRange(
    tenantId: string,
    dateFrom: string,
    dateTo: string,
    branchId?: number,
  ): Promise<{ recomputedDays: number; from: string; to: string }> {
    const from = new Date(`${dateFrom}T00:00:00.000Z`);
    const to = new Date(`${dateTo}T00:00:00.000Z`);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from) {
      throw new Error('recomputeRollupsForRange requires a valid dateFrom <= dateTo (YYYY-MM-DD)');
    }
    let recomputedDays = 0;
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
      const key = d.toISOString().slice(0, 10);
      await this.computeAndStoreDailyRollup(tenantId, key, branchId);
      recomputedDays += 1;
    }
    return { recomputedDays, from: dateFrom, to: dateTo };
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

    const query = this.db
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
      .groupBy([sql`EXTRACT(YEAR FROM rollup_date)`, sql`EXTRACT(MONTH FROM rollup_date)`])
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
        targetYear.cogsTotal = this.toBookMoney(
          targetYear.cogsTotal + this.toBookMoney(r.cogs_total, bookDigits),
          bookDigits,
        );
        targetYear.grossProfit = this.toBookMoney(targetYear.grossProfit + rowGross, bookDigits);
        targetYear.returnsTotal = this.toBookMoney(
          targetYear.returnsTotal + this.toBookMoney(r.returns_total, bookDigits),
          bookDigits,
        );
        targetYear.expensesTotal = this.toBookMoney(
          targetYear.expensesTotal + this.toBookMoney(r.expenses_total, bookDigits),
          bookDigits,
        );
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
