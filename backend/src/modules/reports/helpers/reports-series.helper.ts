import { type Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { ReportRangeQueryDto } from '../dto/report-query.dto';
import { applyReportScopeFilter, buildTenantPredicate } from './reports-query.helper';
import { dateKey } from './reports-range.helper';
import { toMoney } from './reports-math.helper';

// INV-REPORTS-REAL-SALES-PURCHASES-SERIES: the /reports/overview
// sales-purchases trend chart is drawn from real invoice totals.
// Each point is one business-date bucket of the selected range
// (daily up to 92 days, monthly beyond), computed with exactly the
// same netting as the card totals in buildCommercialSummary:
//   sales point = (posted sales total + active services - sales tax)
//     - (sale returns - sale-return tax)
//   purchases point = posted purchases total - purchase returns
// Invoice discounts are NOT subtracted again: they already sit
// inside sales.total, exactly as in the totals formula. Every
// bucket in the range is present, even zero. Per-bucket values are
// rounded with the same toMoney (2dp) as the totals, and any
// rounding drift is put on the last non-zero bucket of that side,
// so the points always sum exactly to netSales / netPurchases.
// No ratio, no interpolation, no fabricated point: if the series
// cannot be built, the caller returns no series and the UI keeps
// the honest two-number boxes.

export type SalesPurchasesSeriesGranularity = 'day' | 'month';

export interface SalesPurchasesSeriesPoint {
  date: string;
  sales: number;
  purchases: number;
}

export interface SalesPurchasesSeries {
  granularity: SalesPurchasesSeriesGranularity;
  points: SalesPurchasesSeriesPoint[];
}

// Raw (unrounded) component sums for one business day. The SQL
// aggregate path and the row-evaluation path both produce these;
// the combiner below is the single place that nets and rounds them.
export interface SeriesDayComponents {
  bucket: string;
  salesTotal: number;
  salesTax: number;
  servicesTotal: number;
  saleReturns: number;
  saleReturnTax: number;
  purchasesTotal: number;
  purchaseReturns: number;
}

const DAILY_CUTOFF_DAYS = 92;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function emptyDayComponents(bucket: string): SeriesDayComponents {
  return {
    bucket,
    salesTotal: 0,
    salesTax: 0,
    servicesTotal: 0,
    saleReturns: 0,
    saleReturnTax: 0,
    purchasesTotal: 0,
    purchaseReturns: 0,
  };
}

export function buildSeriesBuckets(
  fromDate: Date,
  toDate: Date,
  timezone: string,
): { granularity: SalesPurchasesSeriesGranularity; buckets: string[] } {
  const fromKey = dateKey(fromDate, timezone);
  const toKey = dateKey(toDate, timezone);
  if (!fromKey || !toKey || fromKey > toKey) {
    return { granularity: 'day', buckets: [] };
  }
  const [fromYear, fromMonth, fromDay] = fromKey.split('-').map(Number);
  const [toYear, toMonth, toDay] = toKey.split('-').map(Number);
  const spanDays =
    Math.round(
      (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000,
    ) + 1;
  if (spanDays <= DAILY_CUTOFF_DAYS) {
    const buckets: string[] = [];
    const cursor = new Date(Date.UTC(fromYear, fromMonth - 1, fromDay));
    for (let index = 0; index < spanDays; index += 1) {
      buckets.push(
        `${cursor.getUTCFullYear()}-${pad2(cursor.getUTCMonth() + 1)}-${pad2(cursor.getUTCDate())}`,
      );
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return { granularity: 'day', buckets };
  }
  const buckets: string[] = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    buckets.push(`${year}-${pad2(month)}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { granularity: 'month', buckets };
}

export function combineSalesPurchasesSeries(args: {
  buckets: string[];
  granularity: SalesPurchasesSeriesGranularity;
  dayComponents: SeriesDayComponents[];
  netSalesTotal: number;
  netPurchasesTotal: number;
}): SalesPurchasesSeriesPoint[] {
  const { buckets, granularity, dayComponents, netSalesTotal, netPurchasesTotal } = args;
  const byBucket = new Map<string, SeriesDayComponents>();
  for (const day of dayComponents) {
    const key = granularity === 'month' ? day.bucket.slice(0, 7) : day.bucket;
    const target = byBucket.get(key) || emptyDayComponents(key);
    target.salesTotal += Number(day.salesTotal || 0);
    target.salesTax += Number(day.salesTax || 0);
    target.servicesTotal += Number(day.servicesTotal || 0);
    target.saleReturns += Number(day.saleReturns || 0);
    target.saleReturnTax += Number(day.saleReturnTax || 0);
    target.purchasesTotal += Number(day.purchasesTotal || 0);
    target.purchaseReturns += Number(day.purchaseReturns || 0);
    byBucket.set(key, target);
  }

  const salesRounded = buckets.map((bucket) => {
    const c = byBucket.get(bucket) || emptyDayComponents(bucket);
    return toMoney(c.salesTotal + c.servicesTotal - c.salesTax - (c.saleReturns - c.saleReturnTax));
  });
  const purchasesRounded = buckets.map((bucket) => {
    const c = byBucket.get(bucket) || emptyDayComponents(bucket);
    return toMoney(c.purchasesTotal - c.purchaseReturns);
  });

  // Rounding drift (at most a few cents when an input carries a
  // third decimal) goes on the last non-zero bucket of that side so
  // the points sum exactly to the card totals. With 2dp inputs the
  // drift is 0 and no bucket is touched.
  const applyRemainder = (rounded: number[], controlTotal: number): void => {
    const drift = toMoney(controlTotal - rounded.reduce((sum, value) => sum + value, 0));
    if (drift === 0 || rounded.length === 0) return;
    let target = rounded.length - 1;
    for (let index = rounded.length - 1; index >= 0; index -= 1) {
      if (rounded[index] !== 0) {
        target = index;
        break;
      }
    }
    rounded[target] = toMoney(rounded[target] + drift);
  };
  applyRemainder(salesRounded, netSalesTotal);
  applyRemainder(purchasesRounded, netPurchasesTotal);

  return buckets.map((bucket, index) => ({
    date: bucket,
    sales: salesRounded[index],
    purchases: purchasesRounded[index],
  }));
}

export function buildSalesPurchasesSeries(args: {
  fromDate: Date;
  toDate: Date;
  timezone: string;
  dayComponents: SeriesDayComponents[];
  netSalesTotal: number;
  netPurchasesTotal: number;
}): SalesPurchasesSeries {
  const { fromDate, toDate, timezone, dayComponents, netSalesTotal, netPurchasesTotal } = args;
  const { granularity, buckets } = buildSeriesBuckets(fromDate, toDate, timezone);
  // No dated row at all means the series cannot be built honestly
  // (e.g. a mock row set without dates): return no points and let
  // the UI keep the two-number boxes, rather than letting the
  // remainder rule below lump the whole period total onto the last
  // bucket. A genuinely empty period shows the same honest boxes.
  if (dayComponents.length === 0) {
    return { granularity, points: [] };
  }
  return {
    granularity,
    points: combineSalesPurchasesSeries({
      buckets,
      granularity,
      dayComponents,
      netSalesTotal,
      netPurchasesTotal,
    }),
  };
}

type SeriesRow = {
  total?: string | number | null;
  tax_amount?: string | number | null;
  return_type?: string | null;
  allocated_tax?: string | number | null;
  created_at?: Date | string | null;
};

// Row-evaluation path (FakeDb-backed tests): the same netting as the
// SQL path, bucketed in Node with the business-date key.
export function buildSeriesDayComponentsFromRows(args: {
  salesRows?: SeriesRow[];
  servicesRows?: SeriesRow[];
  purchasesRows?: SeriesRow[];
  returnsRows?: SeriesRow[];
  returnedSaleItemsRows?: SeriesRow[];
  timezone: string;
}): SeriesDayComponents[] {
  const {
    salesRows = [],
    servicesRows = [],
    purchasesRows = [],
    returnsRows = [],
    returnedSaleItemsRows = [],
    timezone,
  } = args;
  const byBucket = new Map<string, SeriesDayComponents>();
  const at = (value: Date | string | null | undefined): SeriesDayComponents | null => {
    const bucket = dateKey(value, timezone);
    if (!bucket) return null;
    const target = byBucket.get(bucket) || emptyDayComponents(bucket);
    byBucket.set(bucket, target);
    return target;
  };
  for (const row of salesRows) {
    const target = at(row.created_at);
    if (!target) continue;
    target.salesTotal += Number(row.total || 0);
    target.salesTax += Number(row.tax_amount || 0);
  }
  for (const row of servicesRows) {
    const target = at(row.created_at);
    if (!target) continue;
    target.servicesTotal += Number(row.total || 0);
  }
  for (const row of purchasesRows) {
    const target = at(row.created_at);
    if (!target) continue;
    target.purchasesTotal += Number(row.total || 0);
  }
  for (const row of returnsRows) {
    const target = at(row.created_at);
    if (!target) continue;
    if (row.return_type === 'sale') target.saleReturns += Number(row.total || 0);
    else if (row.return_type === 'purchase') target.purchaseReturns += Number(row.total || 0);
  }
  for (const row of returnedSaleItemsRows) {
    const target = at(row.created_at);
    if (!target) continue;
    target.saleReturnTax += Number(row.allocated_tax || 0);
  }
  return [...byBucket.values()];
}

// Production path: six grouped SQL aggregates over exactly the same
// rows, statuses, date columns and scope filters as the totals in
// buildReportSummaryAggregates — a row counted in a total is counted
// in its bucket, and vice versa. The timezone is the tenant business
// timezone, so a row's bucket is its business date, not its UTC date.
export async function buildSalesPurchasesSeriesComponents(args: {
  db: Kysely<Database>;
  query: ReportRangeQueryDto;
  fromDate: Date;
  toDate: Date;
  tenantId: string;
  timezone: string;
}): Promise<SeriesDayComponents[]> {
  const { db, query, fromDate, toDate, tenantId, timezone } = args;
  const dayBucket = (column: string) =>
    sql<string>`to_char(${sql.ref(column)} AT TIME ZONE ${timezone}, 'YYYY-MM-DD')`;
  const salesQuery = applyReportScopeFilter(
    db
      .selectFrom('sales')
      .select([
        dayBucket('created_at').as('bucket'),
        sql<number>`coalesce(sum(total), 0)`.as('sales_total'),
        sql<number>`coalesce(sum(tax_amount), 0)`.as('sales_tax'),
      ])
      .where('status', '=', 'posted')
      .where('created_at', '>=', fromDate)
      .where('created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId))
      .groupBy('bucket'),
    query,
  );

  const servicesQuery = applyReportScopeFilter(
    (db as any)
      .selectFrom('services')
      .select([
        dayBucket('service_date').as('bucket'),
        sql<number>`coalesce(sum(amount), 0)`.as('services_total'),
      ])
      .where('is_active', '=', true)
      .where('service_date', '>=', fromDate)
      .where('service_date', '<=', toDate)
      .where(buildTenantPredicate(tenantId))
      .groupBy('bucket'),
    query,
  );

  const saleReturnsQuery = applyReportScopeFilter(
    db
      .selectFrom('return_documents')
      .select([
        dayBucket('created_at').as('bucket'),
        sql<number>`coalesce(sum(total), 0)`.as('sale_returns'),
      ])
      .where('return_type', '=', 'sale')
      .where('created_at', '>=', fromDate)
      .where('created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId))
      .groupBy('bucket'),
    query,
  );

  const saleReturnTaxQuery = applyReportScopeFilter(
    db
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) =>
        join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'),
      )
      .select([
        dayBucket('rd.created_at').as('bucket'),
        sql<number>`coalesce(sum(ri.allocated_tax), 0)`.as('sale_return_tax'),
      ])
      .where('rd.return_type', '=', 'sale')
      .where('rd.created_at', '>=', fromDate)
      .where('rd.created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId, 'rd'))
      .where(buildTenantPredicate(tenantId, 'ri'))
      .groupBy('bucket'),
    query,
    'rd',
  );

  const purchasesQuery = applyReportScopeFilter(
    db
      .selectFrom('purchases')
      .select([
        dayBucket('created_at').as('bucket'),
        sql<number>`coalesce(sum(total), 0)`.as('purchases_total'),
      ])
      .where('status', '=', 'posted')
      .where('created_at', '>=', fromDate)
      .where('created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId))
      .groupBy('bucket'),
    query,
  );

  const purchaseReturnsQuery = applyReportScopeFilter(
    db
      .selectFrom('return_documents')
      .select([
        dayBucket('created_at').as('bucket'),
        sql<number>`coalesce(sum(total), 0)`.as('purchase_returns'),
      ])
      .where('return_type', '=', 'purchase')
      .where('created_at', '>=', fromDate)
      .where('created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId))
      .groupBy('bucket'),
    query,
  );

  const [salesRows, servicesRows, saleReturnsRows, saleReturnTaxRows, purchasesRows, purchaseReturnsRows] =
    await Promise.all([
      salesQuery.execute(),
      servicesQuery.execute(),
      saleReturnsQuery.execute(),
      saleReturnTaxQuery.execute(),
      purchasesQuery.execute(),
      purchaseReturnsQuery.execute(),
    ]);

  const byBucket = new Map<string, SeriesDayComponents>();
  const at = (bucket: unknown): SeriesDayComponents | null => {
    const key = String(bucket || '');
    if (!key) return null;
    const target = byBucket.get(key) || emptyDayComponents(key);
    byBucket.set(key, target);
    return target;
  };
  for (const row of salesRows as any[]) {
    const target = at(row.bucket);
    if (!target) continue;
    target.salesTotal += Number(row.sales_total || 0);
    target.salesTax += Number(row.sales_tax || 0);
  }
  for (const row of servicesRows as any[]) {
    const target = at(row.bucket);
    if (!target) continue;
    target.servicesTotal += Number(row.services_total || 0);
  }
  for (const row of saleReturnsRows as any[]) {
    const target = at(row.bucket);
    if (!target) continue;
    target.saleReturns += Number(row.sale_returns || 0);
  }
  for (const row of saleReturnTaxRows as any[]) {
    const target = at(row.bucket);
    if (!target) continue;
    target.saleReturnTax += Number(row.sale_return_tax || 0);
  }
  for (const row of purchasesRows as any[]) {
    const target = at(row.bucket);
    if (!target) continue;
    target.purchasesTotal += Number(row.purchases_total || 0);
  }
  for (const row of purchaseReturnsRows as any[]) {
    const target = at(row.bucket);
    if (!target) continue;
    target.purchaseReturns += Number(row.purchase_returns || 0);
  }
  return [...byBucket.values()];
}
