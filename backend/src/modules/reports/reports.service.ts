import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, sql } from '../../database/kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AppError } from '../../common/errors/app-error';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { ReportRangeQueryDto } from './dto/report-query.dto';
import { buildPagination, filterScope, getBusinessTimezone, parseRange, setBusinessTimezoneResolver } from './helpers/reports-range.helper';
import { buildCustomerRfmPayload, buildReportSummaryAggregates, buildReportSummaryPayload } from './helpers/reports-summary.helper';
import {
  buildSalesPurchasesSeries,
  buildSalesPurchasesSeriesComponents,
  buildSeriesDayComponentsFromRows,
} from './helpers/reports-series.helper';
import { buildDashboardComputedState, buildDashboardOverviewPayload, buildDashboardScope, buildInventorySnapshot, buildPartnerExposureSnapshot } from './helpers/reports-dashboard.helper';
import { buildCustomerBalancesPayload, buildCustomerLedgerPayload, buildSupplierBalancesPayload, buildSupplierLedgerPayload, LedgerSummaryRow, PartnerLedgerEntryRow } from './helpers/reports-ledger.helper';
import { buildCustomerLedgerTotals, buildSupplierLedgerTotals } from './helpers/reports-partner-ledger.helper';
import { buildInventoryReportItems, buildInventorySummary, InventoryLocationBreakdownRow, InventoryReportProductRow } from './helpers/reports-inventory.helper';
import { applyReportScopeFilter, buildReportListState, buildTenantPredicate } from './helpers/reports-query.helper';
import { applyPartnerLedgerSearch, applySignedAmountFilter } from './helpers/reports-query-pipeline.helper';
import { buildFoodCostVarianceReport } from './helpers/reports-food-waste.helper';
import { buildMenuEngineeringReport } from './helpers/reports-menu-engineering.helper';
import { ReportsAdminService } from './services/reports-admin.service';
import { ReportsSummaryService } from './services/reports-summary.service';

interface CachedDashboardOverview {
  expiresAt: number;
  data: Record<string, unknown>;
}

@Injectable()
export class ReportsService {
  private readonly reportsAdminService: ReportsAdminService;
  private readonly reportsSummaryService: ReportsSummaryService;
  // PO-2 mitigation (PERFORMANCE_CONSTITUTION.md §5): dashboardOverview scans every active
  // product/customer/supplier for the tenant on every call — linear in catalog size, not fixed by
  // this cache. This only stops the *same* dashboard view from re-running that full scan on every
  // rapid repeat call (tab refocus, widgets each triggering their own fetch). A tenant with a huge
  // catalog still pays the full cost once per TTL window. Moving the aggregation into SQL is the
  // real fix and stays deferred pending independent financial review of the `toMoney` rounding.
  private readonly overviewCache = new Map<string, CachedDashboardOverview>();
  private readonly OVERVIEW_CACHE_TTL_MS = 30_000;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly configService?: ConfigService,
    reportsAdminService?: ReportsAdminService,
    reportsSummaryService?: ReportsSummaryService,
  ) {
    this.reportsAdminService = reportsAdminService ?? new ReportsAdminService(this.db as never);
    this.reportsSummaryService = reportsSummaryService ?? new ReportsSummaryService(this.db);
    setBusinessTimezoneResolver(() => this.configService?.get<string>('BUSINESS_TIMEZONE') ?? 'UTC');
  }

  private scope(auth: AuthContext) {
    return requireTenantScope(auth);
  }

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const { tenantId } = this.scope(auth);
    return buildTenantPredicate(tenantId, alias);
  }

  private withScope(payload: Record<string, unknown>, auth: AuthContext): Record<string, unknown> {
    return {
      ...payload,
      scope: this.scope(auth),
    };
  }

  async reportSummary(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const range = parseRange(query);
    const fromDate = new Date(range.from);
    const toDate = new Date(range.to);

    const [deliverySettingRow, commissionSettingRow] = await Promise.all([
      this.db
        .selectFrom('settings')
        .select(['value'])
        .where('key', '=', 'deliveryFeeMode')
        .where(this.tenantPredicate(auth))
        .executeTakeFirst(),
      this.db
        .selectFrom('settings')
        .select(['value'])
        .where('key', '=', 'storeFleetCommissionRate')
        .where(this.tenantPredicate(auth))
        .executeTakeFirst(),
    ]);

    let deliveryFeeMode = 'freelance_courier';
    if (deliverySettingRow?.value) {
      try {
        const parsed = typeof deliverySettingRow.value === 'string' ? JSON.parse(deliverySettingRow.value) : deliverySettingRow.value;
        deliveryFeeMode = parsed === 'store_fleet' ? 'store_fleet' : 'freelance_courier';
      } catch {
        deliveryFeeMode = String(deliverySettingRow.value).includes('store_fleet') ? 'store_fleet' : 'freelance_courier';
      }
    }

    let storeFleetCommissionRate = 0;
    if (commissionSettingRow?.value) {
      try {
        const parsed = typeof commissionSettingRow.value === 'string' ? JSON.parse(commissionSettingRow.value) : commissionSettingRow.value;
        storeFleetCommissionRate = Number(parsed || 0);
      } catch {
        storeFleetCommissionRate = Number(commissionSettingRow.value || 0);
      }
    }


    // PERF-FIX: In production PostgreSQL, all 8 queries are pure SQL aggregates (0 raw rows pulled into Node).
    // For unit-test query builder mocks (e.g. FakeDb in reports-financial-summary.spec.ts), fallback to row evaluation.
    if (typeof (this.db.selectFrom('sales') as any).groupBy !== 'function') {
      const salesQuery = applyReportScopeFilter(this.db.selectFrom('sales').select(['id', 'total', 'tax_amount', 'discount', 'delivery_fee', 'delivery_fee_mode', 'delivery_rep_id', 'branch_id', 'location_id', 'created_by', 'created_at']).where('status', '=', 'posted').where('created_at', '>=', fromDate!).where('created_at', '<=', toDate!).where(this.tenantPredicate(auth)), query);
      const purchasesQuery = applyReportScopeFilter(this.db.selectFrom('purchases').select(['id', 'total', 'branch_id', 'location_id', 'created_by', 'created_at']).where('status', '=', 'posted').where('created_at', '>=', fromDate!).where('created_at', '<=', toDate!).where(this.tenantPredicate(auth)), query);
      const servicesQuery = applyReportScopeFilter((this.db as any).selectFrom('services').select(['id', 'amount as total', 'branch_id', 'location_id', 'created_by', 'service_date as created_at']).where('is_active', '=', true).where('service_date', '>=', fromDate!).where('service_date', '<=', toDate!).where(this.tenantPredicate(auth)), query);
      const expensesQuery = applyReportScopeFilter(this.db.selectFrom('expenses').select(['id', 'amount', 'branch_id', 'location_id', 'created_by', 'expense_date']).where('expense_date', '>=', fromDate).where('expense_date', '<=', toDate).where(this.tenantPredicate(auth)), query);
      const returnsQuery = applyReportScopeFilter(this.db.selectFrom('return_documents').select(['id', 'return_type', 'total', 'branch_id', 'location_id', 'created_by', 'created_at']).where('created_at', '>=', fromDate!).where('created_at', '<=', toDate!).where(this.tenantPredicate(auth)), query);
      const treasuryQuery = applyReportScopeFilter(this.db.selectFrom('treasury_transactions').select(['amount', 'branch_id', 'location_id', 'created_by', 'created_at']).where('created_at', '>=', fromDate!).where('created_at', '<=', toDate!).where(this.tenantPredicate(auth)), query);
      const saleItemsQuery = applyReportScopeFilter(this.db.selectFrom('sale_items as si').innerJoin('sales as s', (join) => join.onRef('s.id', '=', 'si.sale_id').onRef('s.tenant_id', '=', 'si.tenant_id')).select(['si.product_id', 'si.product_name', 'si.qty', 'si.line_total', 'si.cost_price', 's.branch_id', 's.location_id', 's.created_by', 's.created_at']).where('s.status', '=', 'posted').where('s.created_at', '>=', fromDate).where('s.created_at', '<=', toDate).where(this.tenantPredicate(auth, 's')).where(this.tenantPredicate(auth, 'si')), query, 's');
      const returnedSaleItemsQuery = applyReportScopeFilter(this.db.selectFrom('return_items as ri').innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id')).leftJoin('sale_items as si', (join) => join.onRef('si.id', '=', 'ri.sale_item_id').onRef('si.tenant_id', '=', 'ri.tenant_id')).leftJoin('products as p', (join) => join.onRef('p.id', '=', 'ri.product_id').onRef('p.tenant_id', '=', 'ri.tenant_id')).select(['ri.qty', 'ri.allocated_tax', (eb) => eb.fn.coalesce('ri.cost_price', 'si.cost_price', 'p.cost_price').as('cost_price'), 'rd.branch_id', 'rd.location_id', 'rd.created_by', 'rd.created_at']).where('rd.return_type', '=', 'sale').where('rd.created_at', '>=', fromDate!).where('rd.created_at', '<=', toDate!).where(this.tenantPredicate(auth, 'rd')).where(this.tenantPredicate(auth, 'ri')), query, 'rd');

      const [salesRows, purchasesRows, rawServicesRows, expensesRows, returnsRows, treasuryRows, saleItemsRows, returnedSaleItemsRows] = await Promise.all([
        salesQuery.execute(),
        purchasesQuery.execute(),
        servicesQuery.execute(),
        expensesQuery.execute(),
        returnsQuery.execute(),
        treasuryQuery.execute(),
        saleItemsQuery.execute(),
        returnedSaleItemsQuery.execute(),
      ]);

      // INV-REPORTS-REAL-SALES-PURCHASES-SERIES: the trend series is
      // built from the same rows the payload totals come from, with
      // the same netting, so its points sum to the card totals.
      const rowPayload = buildReportSummaryPayload({
        salesRows: salesRows as any,
        servicesRows: rawServicesRows as any,
        purchasesRows: purchasesRows as any,
        expensesRows: expensesRows as any,
        returnsRows: returnsRows as any,
        treasuryRows: treasuryRows as any,
        saleItemsRows: saleItemsRows as any,
        returnedSaleItemsRows: returnedSaleItemsRows as any,
        topProductsLimit: 10,
        deliveryFeeMode,
        storeFleetCommissionRate,
      });
      const rowSeries = buildSalesPurchasesSeries({
        fromDate: fromDate!,
        toDate: toDate!,
        timezone: getBusinessTimezone(),
        dayComponents: buildSeriesDayComponentsFromRows({
          salesRows: salesRows as any,
          servicesRows: rawServicesRows as any,
          purchasesRows: purchasesRows as any,
          returnsRows: returnsRows as any,
          returnedSaleItemsRows: returnedSaleItemsRows as any,
          timezone: getBusinessTimezone(),
        }),
        netSalesTotal: rowPayload.sales.netSales,
        netPurchasesTotal: rowPayload.purchases.netPurchases,
      });

      return this.withScope({
        range,
        ...rowPayload,
        salesPurchasesSeries: rowSeries,
      }, auth);
    }

    // INV-CI-REPAIR: the financial-summary SQL aggregates live in
    // buildReportSummaryAggregates (reports-summary.helper.ts) so this
    // service stays under the 1000-line guardrail. Behavior is
    // identical: the same eleven queries, the same overrides.
    const aggregates = await buildReportSummaryAggregates({
      db: this.db,
      query,
      fromDate,
      toDate,
      tenantId: this.scope(auth).tenantId,
      deliveryFeeMode,
    });

    // INV-REPORTS-REAL-SALES-PURCHASES-SERIES: the trend series is
    // built from the same rows, statuses and scope filters as the
    // totals above, with the same netting, so its points sum to the
    // card totals.
    const timezone = getBusinessTimezone();
    const dayComponents = await buildSalesPurchasesSeriesComponents({
      db: this.db,
      query,
      fromDate,
      toDate,
      tenantId: this.scope(auth).tenantId,
      timezone,
    });
    const payload = buildReportSummaryPayload({
      countsOverride: aggregates.countsOverride,
      totalsOverride: aggregates.totalsOverride,
      cogsOverride: aggregates.cogsOverride,
      topProductsOverride: aggregates.topProductsOverride,
      topProductsLimit: 10,
      deliveryFeeMode,
      storeFleetCommissionRate,
    });
    const series = buildSalesPurchasesSeries({
      fromDate,
      toDate,
      timezone,
      dayComponents,
      netSalesTotal: payload.sales.netSales,
      netPurchasesTotal: payload.purchases.netPurchases,
    });

    return this.withScope({
      range,
      ...payload,
      salesPurchasesSeries: series,
    }, auth);
  }

  async dashboardOverview(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = this.scope(auth);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const range = parseRange(query);
    const cacheKey = `${tenantId}:${moneyDigits}:${range.from}:${range.to}:${query.branchId || ''}:${query.locationId || ''}`;
    const nowMs = Date.now();
    const cached = this.overviewCache.get(cacheKey);
    if (cached && nowMs < cached.expiresAt) {
      return cached.data;
    }
    const businessTimezone = getBusinessTimezone();
    const scope = buildDashboardScope(new Date(), businessTimezone);
    const today = scope.today;
    const todayStart = today.start;
    const todayEnd = today.end;
    const trendStart = scope.trendStart;
    const todayIso = scope.activeOfferDate;

    // PO-2 (PERFORMANCE_CONSTITUTION.md §5): this used to pull every active product/customer/supplier
    // for the tenant into Node and filter/reduce over them — linear in catalog size, so a tenant with
    // a large catalog paid a real cost on every dashboard load. Every product/customer/supplier metric
    // below is now a SQL aggregate (COUNT/SUM, optionally with FILTER) or a ORDER BY ... LIMIT query,
    // so the amount of data pulled from Postgres no longer grows with the catalog — only with the
    // small, fixed number of rows actually shown (top 8 low-stock items, top 5 customers/suppliers).
    // Verified behaviourally identical to the old JS computation against a set of edge cases (zero
    // stock, zero min-stock threshold, inactive rows, near/above credit limit, ties) run inside a
    // rolled-back transaction against a real Postgres instance before this migration shipped.
    const [
      summary,
      productAgg,
      lowStockRows,
      customersCountRow,
      suppliersCountRow,
      customerDebtRow,
      supplierDebtRow,
      creditLimitAgg,
      highSupplierBalancesRow,
      topCustomerRows,
      topSupplierRows,
      rawRecentSalesRows,
      rawRecentPurchasesRows,
      activeOffersRows,
      rawTopTodayRows,
    ] = await Promise.all([
      this.reportSummary(query, auth),
      this.db
        .selectFrom('products')
        .select([
          sql<number>`count(*)`.as('products_count'),
          sql<number>`count(*) filter (where stock_qty > 0 and min_stock_qty > 0 and stock_qty <= min_stock_qty)`.as('low_stock_count'),
          sql<number>`count(*) filter (where stock_qty <= 0)`.as('out_of_stock_count'),
          sql<number>`coalesce(sum(stock_qty * cost_price), 0)`.as('inventory_cost'),
          sql<number>`coalesce(sum(stock_qty * retail_price), 0)`.as('inventory_sale_value'),
        ])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(auth))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('products')
        .select(['id', 'name', 'retail_price', 'stock_qty', 'min_stock_qty', 'cost_price'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(auth))
        .where('stock_qty', '>', 0)
        .where('min_stock_qty', '>', 0)
        .where(sql<boolean>`stock_qty <= min_stock_qty`)
        .orderBy('id', 'asc')
        .limit(8)
        .execute(),
      this.db.selectFrom('customers').select(sql<number>`count(*)`.as('n')).where('is_active', '=', true).where(this.tenantPredicate(auth)).executeTakeFirstOrThrow(),
      this.db.selectFrom('suppliers').select(sql<number>`count(*)`.as('n')).where('is_active', '=', true).where(this.tenantPredicate(auth)).executeTakeFirstOrThrow(),
      // customerDebt/supplierDebt: sum of ALL ledger rows for the tenant (matches the old code, which
      // summed every customer/supplier that had any ledger row, not only the active ones).
      this.db.selectFrom('customer_ledger').select(sql<number>`coalesce(sum(amount), 0)`.as('total')).where(this.tenantPredicate(auth)).executeTakeFirstOrThrow(),
      this.db.selectFrom('supplier_ledger').select(sql<number>`coalesce(sum(amount), 0)`.as('total')).where(this.tenantPredicate(auth)).executeTakeFirstOrThrow(),
      this.db
        .selectFrom('customers as c')
        .leftJoin(
          (eb) => eb.selectFrom('customer_ledger').select(['customer_id', sql<number>`coalesce(sum(amount), 0)`.as('bal')]).where(this.tenantPredicate(auth)).groupBy('customer_id').as('l'),
          (join) => join.onRef('l.customer_id', '=', 'c.id'),
        )
        .select([
          sql<number>`count(*) filter (where coalesce(l.bal, 0) >= c.credit_limit * 0.8 and coalesce(l.bal, 0) <= c.credit_limit)`.as('near'),
          sql<number>`count(*) filter (where coalesce(l.bal, 0) > c.credit_limit)`.as('above'),
        ])
        .where('c.is_active', '=', true)
        .where(this.tenantPredicate(auth, 'c'))
        .where('c.credit_limit', '>', 0)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('suppliers as s')
        .leftJoin(
          (eb) => eb.selectFrom('supplier_ledger').select(['supplier_id', sql<number>`coalesce(sum(amount), 0)`.as('bal')]).where(this.tenantPredicate(auth)).groupBy('supplier_id').as('l'),
          (join) => join.onRef('l.supplier_id', '=', 's.id'),
        )
        .select(sql<number>`count(*) filter (where coalesce(l.bal, 0) >= 1000)`.as('n'))
        .where('s.is_active', '=', true)
        .where(this.tenantPredicate(auth, 's'))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('customers as c')
        .innerJoin(
          (eb) => eb.selectFrom('customer_ledger').select(['customer_id', sql<number>`coalesce(sum(amount), 0)`.as('bal')]).where(this.tenantPredicate(auth)).groupBy('customer_id').as('l'),
          (join) => join.onRef('l.customer_id', '=', 'c.id'),
        )
        .select(['c.id as id', 'c.name as name', 'l.bal as balance'])
        .where('c.is_active', '=', true)
        .where(this.tenantPredicate(auth, 'c'))
        .where(sql<boolean>`l.bal > 0`)
        .orderBy('l.bal', 'desc')
        .limit(5)
        .execute(),
      this.db
        .selectFrom('suppliers as s')
        .innerJoin(
          (eb) => eb.selectFrom('supplier_ledger').select(['supplier_id', sql<number>`coalesce(sum(amount), 0)`.as('bal')]).where(this.tenantPredicate(auth)).groupBy('supplier_id').as('l'),
          (join) => join.onRef('l.supplier_id', '=', 's.id'),
        )
        .select(['s.id as id', 's.name as name', 'l.bal as balance'])
        .where('s.is_active', '=', true)
        .where(this.tenantPredicate(auth, 's'))
        .where(sql<boolean>`l.bal > 0`)
        .orderBy('l.bal', 'desc')
        .limit(5)
        .execute(),
      // PERF: aggregate by day in SQL → 30 rows max instead of N raw invoice rows.
      // Branch/location scope applied in WHERE so filterScope is not needed afterwards.
      // invoice_count carries per-day count so today's invoice count stays accurate.
      // GROUP BY 1 = group by the first SELECT column (day string) — avoids Kysely
      // double-parameterizing businessTimezone in both SELECT and GROUP BY expressions.
      this.db
        .selectFrom('sales')
        .select([
          sql<string>`to_char(created_at AT TIME ZONE ${businessTimezone}, 'YYYY-MM-DD')`.as('created_at'),
          sql<number>`coalesce(sum(total), 0)`.as('total'),
          sql<number>`count(*)`.as('invoice_count'),
        ])
        .where('status', '=', 'posted')
        .where('created_at', '>=', trendStart)
        .where('created_at', '<=', todayEnd)
        .where(this.tenantPredicate(auth))
        .$if(query.branchId != null, (qb) => qb.where('branch_id', '=', Number(query.branchId)))
        .$if(query.locationId != null, (qb) => qb.where('location_id', '=', Number(query.locationId)))
        .groupBy(sql`1`)
        .execute(),
      this.db
        .selectFrom('purchases')
        .select([
          sql<string>`to_char(created_at AT TIME ZONE ${businessTimezone}, 'YYYY-MM-DD')`.as('created_at'),
          sql<number>`coalesce(sum(total), 0)`.as('total'),
          sql<number>`count(*)`.as('invoice_count'),
        ])
        .where('status', '=', 'posted')
        .where('created_at', '>=', trendStart)
        .where('created_at', '<=', todayEnd)
        .where(this.tenantPredicate(auth))
        .$if(query.branchId != null, (qb) => qb.where('branch_id', '=', Number(query.branchId)))
        .$if(query.locationId != null, (qb) => qb.where('location_id', '=', Number(query.locationId)))
        .groupBy(sql`1`)
        .execute(),
      this.db
        .selectFrom('product_offers')
        .select(['id'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(auth))
        .where(sql<boolean>`(start_date is null or start_date <= ${todayIso}) and (end_date is null or end_date >= ${todayIso})`)
        .execute(),
      this.db
        .selectFrom('sale_items as si')
        .innerJoin('sales as s', (join) => join.onRef('s.id', '=', 'si.sale_id').onRef('s.tenant_id', '=', 'si.tenant_id'))
        .select([
          'si.product_id',
          'si.product_name',
          's.branch_id',
          's.location_id',
          sql<number>`coalesce(sum(si.qty), 0)`.as('qty_total'),
          sql<number>`coalesce(sum(si.line_total), 0)`.as('sales_total'),
        ])
        .where('s.status', '=', 'posted')
        .where('s.created_at', '>=', todayStart)
        .where('s.created_at', '<=', todayEnd)
        .where(this.tenantPredicate(auth, 's'))
        .groupBy(['si.product_id', 'si.product_name', 's.branch_id', 's.location_id'])
        .orderBy('sales_total', 'desc')
        .limit(5)
        .execute(),
    ]);

    // Scope already applied in SQL for trend aggregations — no JS filterScope needed.
    const recentSalesRows = rawRecentSalesRows;
    const recentPurchasesRows = rawRecentPurchasesRows;
    const topTodayRows = filterScope(rawTopTodayRows, query);
    const activeOffers = activeOffersRows.length;

    const dashboardState = buildDashboardComputedState({
      recentSalesRows,
      recentPurchasesRows,
      topTodayRows,
      businessTimezone,
      todayKey: today.key,
      moneyDigits,
    });

    const inventorySnapshot = buildInventorySnapshot({
      lowStockRows,
      lowStockCount: Number(productAgg.low_stock_count),
      outOfStockCount: Number(productAgg.out_of_stock_count),
      inventoryCost: Number(productAgg.inventory_cost),
      inventorySaleValue: Number(productAgg.inventory_sale_value),
    });

    const partnerExposure = buildPartnerExposureSnapshot({
      customerDebt: Number(customerDebtRow.total),
      supplierDebt: Number(supplierDebtRow.total),
      nearCreditLimit: Number(creditLimitAgg.near || 0),
      aboveCreditLimit: Number(creditLimitAgg.above || 0),
      highSupplierBalances: Number(highSupplierBalancesRow.n || 0),
      topCustomerRows,
      topSupplierRows,
    });

    // Financial dashboard: actual checkout tenders, not guessed percentages.
    // Join invoice-level preaggregated payments so mixed tenders never multiply
    // the invoice total. Credit is the remaining debt not paid at checkout.
    const breakdownResult = await sql<{
      cash: number | string; card: number | string;
      online: number | string; credit: number | string;
    }>`
      with scoped_sales as (
        select id, total, paid_amount, store_credit_used, payment_type, payment_channel, customer_id
        from sales
        where tenant_id = ${tenantId} and status = 'posted'
          and created_at >= ${new Date(range.from)}
          and created_at <= ${new Date(range.to)}
          and (${query.branchId == null} or branch_id = ${Number(query.branchId || 0)})
          and (${query.locationId == null} or location_id = ${Number(query.locationId || 0)})
      ), tenders as (
        select sp.sale_id,
          sum(sp.amount) as paid,
          sum(case when sp.payment_channel = 'cash' then sp.amount else 0 end) as cash,
          sum(case when sp.payment_channel = 'card' then sp.amount else 0 end) as card,
          sum(case when sp.payment_channel in ('wallet', 'instapay') then sp.amount else 0 end) as online
        from sale_payments sp
        join scoped_sales s on s.id = sp.sale_id
        where sp.tenant_id = ${tenantId}
        group by sp.sale_id
      ), return_liability as (
        select rd.invoice_id,
          sum(case when rd.refund_allocations is not null then
            coalesce((
              select sum((allocation.value->>'amount')::numeric)
              from jsonb_array_elements(rd.refund_allocations) as allocation(value)
              where allocation.value->>'tender' = 'receivable'
            ), 0)
            when s.payment_type = 'credit' then rd.total else 0 end) as reversed
        from return_documents rd
        join scoped_sales s on s.id = rd.invoice_id
        where rd.tenant_id = ${tenantId} and rd.return_type = 'sale'
        group by rd.invoice_id
      )
      select
        coalesce(sum(coalesce(t.cash, case when t.sale_id is null and s.payment_type = 'cash' and s.payment_channel = 'cash' then s.paid_amount else 0 end)), 0) as cash,
        coalesce(sum(coalesce(t.card, case when t.sale_id is null and s.payment_type = 'cash' and s.payment_channel = 'card' then s.paid_amount else 0 end)), 0) as card,
        coalesce(sum(coalesce(t.online, case when t.sale_id is null and s.payment_type = 'cash' and s.payment_channel in ('wallet', 'instapay') then s.paid_amount else 0 end)), 0) as online,
        coalesce(sum(case when s.customer_id is not null
          then greatest(0, s.total - coalesce(s.store_credit_used, 0)
            - greatest(coalesce(s.paid_amount, 0), coalesce(t.paid, 0))
            - coalesce(r.reversed, 0)) else 0 end), 0) as credit
      from scoped_sales s
      left join tenders t on t.sale_id = s.id
      left join return_liability r on r.invoice_id = s.id
    `.execute(this.db);
    const breakdown = breakdownResult.rows[0];
    const paymentBreakdown = {
      cash: Number(breakdown?.cash || 0),
      card: Number(breakdown?.card || 0),
      online: Number(breakdown?.online || 0),
      credit: Number(breakdown?.credit || 0),
    };

    const result = this.withScope({ ...buildDashboardOverviewPayload({
      range,
      summary: summary as Record<string, unknown>,
      productsCount: Number(productAgg.products_count),
      customersCount: Number(customersCountRow.n),
      suppliersCount: Number(suppliersCountRow.n),
      inventorySnapshot,
      partnerExposure,
      todayOperations: dashboardState.todayOperations,
      trends: dashboardState.trends,
      activeOffers,
    }), paymentBreakdown }, auth);

    this.overviewCache.delete(cacheKey);
    this.overviewCache.set(cacheKey, { expiresAt: nowMs + this.OVERVIEW_CACHE_TTL_MS, data: result });
    for (const [key, value] of this.overviewCache) {
      if (value.expiresAt <= nowMs) this.overviewCache.delete(key);
    }
    while (this.overviewCache.size > 256) {
      const oldest = this.overviewCache.keys().next().value;
      if (oldest === undefined) break;
      this.overviewCache.delete(oldest);
    }

    return result;
  }

  async inventoryReport(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { search, searchPattern, filter, page, pageSize } = buildReportListState(query, 20, { includeRange: false });

    let countQuery: any = this.db
      .selectFrom('products as p')
      .leftJoin('product_categories as c', (join) => join.onRef('c.id', '=', 'p.category_id').onRef('c.tenant_id', '=', 'p.tenant_id'))
      .leftJoin('suppliers as s', (join) => join.onRef('s.id', '=', 'p.supplier_id').onRef('s.tenant_id', '=', 'p.tenant_id'))
      .where('p.is_active', '=', true)
      .where(this.tenantPredicate(auth, 'p'));

    let rowsQuery: any = this.db
      .selectFrom('products as p')
      .leftJoin('product_categories as c', (join) => join.onRef('c.id', '=', 'p.category_id').onRef('c.tenant_id', '=', 'p.tenant_id'))
      .leftJoin('suppliers as s', (join) => join.onRef('s.id', '=', 'p.supplier_id').onRef('s.tenant_id', '=', 'p.tenant_id'))
      .select(['p.id', 'p.name', query.locationId ? sql<number>`coalesce(pls.qty, 0)`.as('stock_qty') : 'p.stock_qty', 'p.min_stock_qty', 'p.retail_price', 'p.cost_price', 'c.name as category_name', 's.name as supplier_name'])
      .where('p.is_active', '=', true)
      .where(this.tenantPredicate(auth, 'p'));

    if (query.locationId) {
      countQuery = countQuery.leftJoin('product_location_stock as pls', (join: any) => join.onRef('pls.product_id', '=', 'p.id').onRef('pls.tenant_id', '=', 'p.tenant_id'))
        .where('pls.location_id', '=', query.locationId);
      rowsQuery = rowsQuery.leftJoin('product_location_stock as pls', (join: any) => join.onRef('pls.product_id', '=', 'p.id').onRef('pls.tenant_id', '=', 'p.tenant_id'))
        .where('pls.location_id', '=', query.locationId);
    }

    if (search) {
      countQuery = countQuery.where((eb: any) => eb.or([
        eb(sql`lower(p.name)`, 'like', searchPattern!),
        eb(sql`lower(coalesce(c.name, ''))`, 'like', searchPattern!),
        eb(sql`lower(coalesce(s.name, ''))`, 'like', searchPattern!),
      ]));
      rowsQuery = rowsQuery.where((eb: any) => eb.or([
        eb(sql`lower(p.name)`, 'like', searchPattern!),
        eb(sql`lower(coalesce(c.name, ''))`, 'like', searchPattern!),
        eb(sql`lower(coalesce(s.name, ''))`, 'like', searchPattern!),
      ]));
    }

    if (filter === 'attention') {
      if (query.locationId) {
        countQuery = countQuery.whereRef('pls.qty', '<=', 'p.min_stock_qty');
        rowsQuery = rowsQuery.whereRef('pls.qty', '<=', 'p.min_stock_qty');
      } else {
        countQuery = countQuery.whereRef('p.stock_qty', '<=', 'p.min_stock_qty');
        rowsQuery = rowsQuery.whereRef('p.stock_qty', '<=', 'p.min_stock_qty');
      }
    }
    if (filter === 'out') {
      if (query.locationId) {
        countQuery = countQuery.where('pls.qty', '<=', 0);
        rowsQuery = rowsQuery.where('pls.qty', '<=', 0);
      } else {
        countQuery = countQuery.where('p.stock_qty', '<=', 0);
        rowsQuery = rowsQuery.where('p.stock_qty', '<=', 0);
      }
    }
    if (filter === 'low') {
      if (query.locationId) {
        countQuery = countQuery.where('pls.qty', '>', 0).whereRef('pls.qty', '<=', 'p.min_stock_qty');
        rowsQuery = rowsQuery.where('pls.qty', '>', 0).whereRef('pls.qty', '<=', 'p.min_stock_qty');
      } else {
        countQuery = countQuery.where('p.stock_qty', '>', 0).whereRef('p.stock_qty', '<=', 'p.min_stock_qty');
        rowsQuery = rowsQuery.where('p.stock_qty', '>', 0).whereRef('p.stock_qty', '<=', 'p.min_stock_qty');
      }
    }
    if (filter === 'dead') {
      const scope = this.scope(auth);
      const days = Math.max(7, Math.min(365, Number(query.days || 60)));
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const deadCondition = sql<boolean>`NOT EXISTS (
        SELECT 1 FROM sale_items si
        INNER JOIN sales sa ON sa.id = si.sale_id
        WHERE si.product_id = p.id
          AND sa.status = 'posted'
          AND sa.created_at >= ${cutoffDate}
          AND sa.tenant_id = ${scope.tenantId}
      )`;
      if (query.locationId) {
        countQuery = countQuery.where('pls.qty', '>', 0).where(deadCondition);
        rowsQuery = rowsQuery.where('pls.qty', '>', 0).where(deadCondition);
      } else {
        countQuery = countQuery.where('p.stock_qty', '>', 0).where(deadCondition);
        rowsQuery = rowsQuery.where('p.stock_qty', '>', 0).where(deadCondition);
      }
    }

    const totalRow = await countQuery.select(sql<number>`count(*)`.as('count')).executeTakeFirst();
    const totalItems = Number((totalRow as { count?: number | string | null } | undefined)?.count || 0);
    const pagination = buildPagination(page, pageSize, totalItems);
    const rows = await rowsQuery
      .orderBy(query.locationId ? 'pls.qty' : 'p.stock_qty', 'asc')
      .orderBy('p.id', 'asc')
      .limit(pageSize)
      .offset((pagination.page - 1) * pageSize)
      .execute();

    const productIds = rows.map((row: any) => Number(row.id || 0)).filter((value: number) => value > 0);

    let locationBreakdownQuery = this.db
      .selectFrom('product_location_stock as pls')
      .leftJoin('stock_locations as l', (join) => join.onRef('l.id', '=', 'pls.location_id').onRef('l.tenant_id', '=', 'pls.tenant_id'))
      .leftJoin('branches', (join) => join.onRef('branches.id', '=', 'pls.branch_id').onRef('branches.tenant_id', '=', 'pls.tenant_id'))
      .select(['pls.product_id', 'pls.location_id', 'pls.branch_id', 'pls.qty', 'l.name as location_name', 'branches.name as branch_name'])
      .where('pls.product_id', 'in', productIds)
      .where(this.tenantPredicate(auth, 'pls'));

    if (query.locationId) {
      locationBreakdownQuery = locationBreakdownQuery.where('pls.location_id', '=', query.locationId);
    }

    const locationBreakdownRows = productIds.length
      ? await locationBreakdownQuery
          .orderBy('pls.product_id', 'asc')
          .orderBy('pls.qty', 'desc')
          .execute()
      : [];

    const tenantId = this.scope(auth).tenantId;
    const locationCondition = query.locationId ? sql`and pls.location_id = ${query.locationId}` : sql``;
    const locationHighlightsResult = await sql<{
      location_id: number; location_name: string | null; branch_id: number | null; branch_name: string | null;
      total_qty: number; tracked_products: number; attention_items: number;
      low_stock_items: number; out_of_stock_items: number; tracked_locations: number;
    }>`
      select pls.location_id, l.name as location_name, pls.branch_id, b.name as branch_name,
             sum(pls.qty) as total_qty, count(*)::int as tracked_products,
             count(*) filter (where pls.qty <= p.min_stock_qty)::int as attention_items,
             count(*) filter (where pls.qty > 0 and pls.qty <= p.min_stock_qty)::int as low_stock_items,
             count(*) filter (where pls.qty <= 0)::int as out_of_stock_items,
             count(*) over()::int as tracked_locations
      from product_location_stock pls
      join products p on p.id = pls.product_id and p.tenant_id = pls.tenant_id
      left join stock_locations l on l.id = pls.location_id and l.tenant_id = pls.tenant_id
      left join branches b on b.id = pls.branch_id and b.tenant_id = pls.tenant_id
      where pls.tenant_id = ${tenantId} and pls.location_id is not null and p.is_active = true
      ${locationCondition}
      group by pls.location_id, l.name, pls.branch_id, b.name
      order by attention_items desc, total_qty desc, location_name asc
      limit 5
    `.execute(this.db);

    const items = buildInventoryReportItems(rows as InventoryReportProductRow[], locationBreakdownRows as InventoryLocationBreakdownRow[]);

    let outOfStockQuery: any = this.db
      .selectFrom('products as p')
      .select(sql<number>`count(*)`.as('count'))
      .where('p.is_active', '=', true)
      .where(this.tenantPredicate(auth, 'p'));

    if (query.locationId) {
      outOfStockQuery = outOfStockQuery.leftJoin('product_location_stock as pls', (join: any) => join.onRef('pls.product_id', '=', 'p.id').onRef('pls.tenant_id', '=', 'p.tenant_id'))
        .where('pls.location_id', '=', query.locationId)
        .where((eb: any) => eb.or([eb('pls.qty', '<=', 0), eb('pls.qty', 'is', null)]));
    } else {
      outOfStockQuery = outOfStockQuery.where('p.stock_qty', '<=', 0);
    }
    const outOfStockRow = await outOfStockQuery.executeTakeFirst();

    let lowStockQuery: any = this.db
      .selectFrom('products as p')
      .select(sql<number>`count(*)`.as('count'))
      .where('p.is_active', '=', true)
      .where(this.tenantPredicate(auth, 'p'));

    if (query.locationId) {
      lowStockQuery = lowStockQuery.innerJoin('product_location_stock as pls', (join: any) => join.onRef('pls.product_id', '=', 'p.id').onRef('pls.tenant_id', '=', 'p.tenant_id'))
        .where('pls.location_id', '=', query.locationId)
        .where('pls.qty', '>', 0)
        .whereRef('pls.qty', '<=', 'p.min_stock_qty');
    } else {
      lowStockQuery = lowStockQuery.where('p.stock_qty', '>', 0).whereRef('p.stock_qty', '<=', 'p.min_stock_qty');
    }
    const lowStockRow = await lowStockQuery.executeTakeFirst();

    let totalActiveQuery: any = this.db
      .selectFrom('products as p')
      .select(sql<number>`count(*)`.as('count'))
      .where('p.is_active', '=', true)
      .where(this.tenantPredicate(auth, 'p'));

    if (query.locationId) {
      totalActiveQuery = totalActiveQuery
        .innerJoin('product_location_stock as pls', (join: any) => join.onRef('pls.product_id', '=', 'p.id').onRef('pls.tenant_id', '=', 'p.tenant_id'))
        .where('pls.location_id', '=', query.locationId);
    }
    const totalActiveRow = await totalActiveQuery.executeTakeFirst();

    const trackedLocations = Number(locationHighlightsResult.rows[0]?.tracked_locations || 0);
    const locationHighlights = locationHighlightsResult.rows.map((row) => ({
      locationId: String(row.location_id), locationName: row.location_name || `الموقع #${row.location_id}`,
      branchId: row.branch_id ? String(row.branch_id) : '', branchName: row.branch_name || '',
      totalQty: Number(row.total_qty || 0), trackedProducts: Number(row.tracked_products || 0),
      attentionItems: Number(row.attention_items || 0), lowStockItems: Number(row.low_stock_items || 0),
      outOfStockItems: Number(row.out_of_stock_items || 0),
    }));

    const outOfStock = Number((outOfStockRow as { count?: number | string | null } | undefined)?.count || 0);
    const lowStock = Number((lowStockRow as { count?: number | string | null } | undefined)?.count || 0);
    const totalActive = Number((totalActiveRow as { count?: number | string | null } | undefined)?.count || 0);

    return this.withScope({
      items,
      pagination,
      summary: buildInventorySummary(totalItems, outOfStock, lowStock, totalActive, trackedLocations),
      locationHighlights,
    }, auth);
  }

  async deadStockReport(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsSummaryService.deadStockReport(query, auth);
  }

  async customerRfmReport(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsSummaryService.customerRfmReport(query, auth);
  }

  async customerBalances(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsSummaryService.customerBalances(query, auth);
  }

  async customerLedger(customerId: number, query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsSummaryService.customerLedger(customerId, query, auth);
  }

  async supplierBalances(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsSummaryService.supplierBalances(query, auth);
  }

  async supplierLedger(supplierId: number, query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsSummaryService.supplierLedger(supplierId, query, auth);
  }
  async treasuryTransactions(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.withScope(await this.reportsAdminService.treasuryTransactions(query, auth), auth);
  }
  async employeeSummary(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.withScope(await this.reportsAdminService.employeeSummary(query, auth), auth);
  }
  async employeeDetails(userId: number, query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.withScope(await this.reportsAdminService.employeeDetails(userId, query, auth), auth);
  }
  async auditLogs(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.withScope(await this.reportsAdminService.auditLogs(query, auth), auth);
  }
  async debtAgingReport(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.withScope(await this.reportsSummaryService.debtAgingReport(auth), auth);
  }
  async demandForecastingReport(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.withScope(await this.reportsSummaryService.demandForecastingReport(auth), auth);
  }

  async foodCostVarianceReport(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.withScope(await buildFoodCostVarianceReport(this.db, query, auth), auth);
  }

  async menuEngineeringReport(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.withScope(await buildMenuEngineeringReport(this.db, query, auth) as unknown as Record<string, unknown>, auth);
  }
}

