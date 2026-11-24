import { type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { type Kysely, sql } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { TrendPoint, buildLastNDays, dateKey, getBusinessDayBounds } from './reports-range.helper';
import { buildTenantPredicate } from './reports-query.helper';
import { buildTrendMap, sumMoney, toMoney } from './reports-math.helper';

type ProductRow = {
  id: number | string;
  name?: string | null;
  retail_price?: number | string | null;
  stock_qty?: number | string | null;
  min_stock_qty?: number | string | null;
  cost_price?: number | string | null;
};

type PartnerBalanceRow = {
  id: number | string;
  name?: string | null;
  balance: number | string | null;
};

type TodaySaleItemRow = {
  product_id?: number | string | null;
  product_name?: string | null;
  qty?: number | string | null;
  line_total?: number | string | null;
};

type TodayTopRow = {
  product_id?: number | string | null;
  product_name?: string | null;
  qty_total?: number | string | null;
  sales_total?: number | string | null;
};

type TimedMoneyRow = {
  created_at: Date | string;
  total?: number | string | null;
  // Present when rows are pre-aggregated by day in SQL (PERF optimization)
  invoice_count?: number | string | null;
};

export type DashboardScope = {
  businessTimezone: string;
  trendStart: Date;
  activeOfferDate: string;
  today: {
    key: string;
    start: Date;
    end: Date;
  };
};

export function buildDashboardScope(now: Date, businessTimezone: string): DashboardScope {
  const today = getBusinessDayBounds(now, businessTimezone);
  const trendStart = new Date(today.start);
  trendStart.setUTCDate(trendStart.getUTCDate() - 29);

  return {
    businessTimezone,
    trendStart,
    activeOfferDate: today.key,
    today,
  };
}

export type OpenShiftTodayWindow = {
  start: Date;
  end: Date;
  extended: boolean;
};

/**
 * INV-HOME-PROFITS-OPEN-SHIFT: the home "today" window follows the open
 * cashier shift. A shift opened before today's midnight extends "today"
 * back to the shift's open instant (its created_at — cashier_shifts has
 * no opened_at column), so sales from before midnight still count until
 * the shift closes. No open shift, or a shift opened after midnight,
 * keeps the plain calendar day. The end is always today's end.
 */
export function resolveOpenShiftTodayWindow(
  today: { start: Date; end: Date },
  openShiftOpenedAt: Date | null | undefined,
): OpenShiftTodayWindow {
  if (!openShiftOpenedAt || Number.isNaN(openShiftOpenedAt.getTime())) {
    return { start: today.start, end: today.end, extended: false };
  }
  if (openShiftOpenedAt.getTime() >= today.start.getTime()) {
    return { start: today.start, end: today.end, extended: false };
  }
  return { start: openShiftOpenedAt, end: today.end, extended: true };
}

export type TodayWindowTotals = {
  salesCount: number;
  salesAmount: number;
  purchasesCount: number;
  purchasesAmount: number;
};

/**
 * INV-HOME-PROFITS-OPEN-SHIFT: the earliest open shift for the tenant,
 * as its open instant (cashier_shifts.created_at — there is no
 * opened_at column). The branch/location filter scopes the shift exactly
 * like the sales, so another branch's open shift does not extend this
 * view. Null when no open shift matches.
 */
export async function fetchEarliestOpenShiftOpenedAt(args: {
  db: Kysely<Database>;
  tenantId: string;
  branchId?: number | string | null;
  locationId?: number | string | null;
}): Promise<Date | null> {
  const row = await args.db
    .selectFrom('cashier_shifts')
    .select(sql<Date | null>`min(created_at)`.as('opened_at'))
    .where('status', '=', 'open')
    .where(buildTenantPredicate(args.tenantId))
    .$if(args.branchId != null, (qb) => qb.where('branch_id', '=', Number(args.branchId)))
    .$if(args.locationId != null, (qb) => qb.where('location_id', '=', Number(args.locationId)))
    .executeTakeFirst();
  return row?.opened_at ? new Date(row.opened_at) : null;
}

/**
 * INV-HOME-PROFITS-OPEN-SHIFT: the extended "today" figures for a window
 * that reaches back before midnight. The trend rows are pre-aggregated
 * by calendar day, so they cannot carry the window — a prior-day sale's
 * dateKey is yesterday and the snapshot filter would drop it. These two
 * aggregates are the only source of the extended figures; the 30-day
 * trends keep the calendar-day rows, untouched.
 */
export async function fetchTodayWindowTotals(args: {
  db: Kysely<Database>;
  tenantId: string;
  branchId?: number | string | null;
  locationId?: number | string | null;
  start: Date;
  end: Date;
}): Promise<TodayWindowTotals> {
  const windowQuery = (table: 'sales' | 'purchases') =>
    args.db
      .selectFrom(table)
      .select([
        sql<number>`coalesce(sum(total), 0)`.as('total'),
        sql<number>`count(*)`.as('invoice_count'),
      ])
      .where('status', '=', 'posted')
      .where('created_at', '>=', args.start)
      .where('created_at', '<=', args.end)
      .where(buildTenantPredicate(args.tenantId))
      .$if(args.branchId != null, (qb) => qb.where('branch_id', '=', Number(args.branchId)))
      .$if(args.locationId != null, (qb) => qb.where('location_id', '=', Number(args.locationId)))
      .executeTakeFirstOrThrow();
  const [salesWindowRow, purchasesWindowRow] = await Promise.all([
    windowQuery('sales'),
    windowQuery('purchases'),
  ]);
  return {
    salesCount: Number(salesWindowRow.invoice_count || 0),
    salesAmount: Number(salesWindowRow.total || 0),
    purchasesCount: Number(purchasesWindowRow.invoice_count || 0),
    purchasesAmount: Number(purchasesWindowRow.total || 0),
  };
}

export function buildDashboardComputedState(args: {
  recentSalesRows: TimedMoneyRow[];
  recentPurchasesRows: TimedMoneyRow[];
  topTodayRows: TodayTopRow[];
  businessTimezone: string;
  todayKey: string;
  moneyDigits?: MoneyDigits;
  todayWindowTotals?: TodayWindowTotals;
}) {
  const todaySalesRows = args.recentSalesRows.filter((row) => dateKey(row.created_at, args.businessTimezone) === args.todayKey);
  const todayPurchasesRows = args.recentPurchasesRows.filter((row) => dateKey(row.created_at, args.businessTimezone) === args.todayKey);
  const todayOperations = buildTodayOperationsSnapshot(todaySalesRows, todayPurchasesRows, args.topTodayRows, args.todayWindowTotals);
  const trends = buildSevenDayTrends(args.recentSalesRows, args.recentPurchasesRows, args.businessTimezone, args.moneyDigits);

  return {
    todayOperations,
    trends,
  };
}

// PO-2 (PERFORMANCE_CONSTITUTION.md §5): this used to filter/reduce over every active product for
// the tenant in JS. `lowStockCount`, `outOfStockCount`, `inventoryCost` and `inventorySaleValue` are
// now computed in SQL (COUNT/SUM with FILTER) — this function only shapes the already-aggregated
// numbers and the already-limited (top 8) low-stock rows into the response, so it stays O(8) no
// matter how large the catalog is.
export function buildInventorySnapshot(args: {
  lowStockRows: ProductRow[];
  lowStockCount: number;
  outOfStockCount: number;
  inventoryCost: number;
  inventorySaleValue: number;
}) {
  const lowStock = args.lowStockRows.map((row) => ({
    id: String(row.id),
    name: row.name || '',
    retailPrice: Number(row.retail_price || 0),
    stockQty: Number(row.stock_qty || 0),
    minStockQty: Number(row.min_stock_qty || 0),
    costPrice: Number(row.cost_price || 0),
    status: Number(row.stock_qty || 0) <= 0 ? 'out' : 'low',
  }));

  return {
    lowStock,
    lowStockCount: args.lowStockCount,
    outOfStockCount: args.outOfStockCount,
    inventoryCost: toMoney(args.inventoryCost),
    inventorySaleValue: toMoney(args.inventorySaleValue),
  };
}

// PO-2: same shape change as buildInventorySnapshot — `customerDebt`/`supplierDebt`/`nearCreditLimit`/
// `aboveCreditLimit`/`highSupplierBalances` are now SQL aggregates (SUM/COUNT FILTER over the ledger
// tables, joined against active customers/suppliers only where the original JS did the same active
// filter), and `topCustomerRows`/`topSupplierRows` are already the top-5-by-balance SQL result — this
// function only shapes them, it does not scan every partner.
export function buildPartnerExposureSnapshot(args: {
  customerDebt: number;
  supplierDebt: number;
  nearCreditLimit: number;
  aboveCreditLimit: number;
  highSupplierBalances: number;
  topCustomerRows: PartnerBalanceRow[];
  topSupplierRows: PartnerBalanceRow[];
}) {
  const topCustomers = args.topCustomerRows.map((row) => ({
    key: String(row.id),
    name: row.name || '',
    total: Number(row.balance || 0),
    count: 1,
  }));

  const topSuppliers = args.topSupplierRows.map((row) => ({
    key: String(row.id),
    name: row.name || '',
    total: Number(row.balance || 0),
    count: 1,
  }));

  return {
    customerDebt: toMoney(args.customerDebt),
    supplierDebt: toMoney(args.supplierDebt),
    nearCreditLimit: args.nearCreditLimit,
    aboveCreditLimit: args.aboveCreditLimit,
    highSupplierBalances: args.highSupplierBalances,
    topCustomers,
    topSuppliers,
  };
}

export function buildTodayOperationsSnapshot(
  todaySalesRows: Array<{ total?: number | string | null; invoice_count?: number | string | null }>,
  todayPurchasesRows: Array<{ total?: number | string | null; invoice_count?: number | string | null }>,
  topTodayRows: TodayTopRow[],
  // INV-HOME-PROFITS-OPEN-SHIFT: when the open shift extends "today"
  // back before midnight, the per-day pre-aggregated rows cannot carry
  // the window (a prior-day row's dateKey is yesterday), so the caller
  // passes the window aggregates instead. Trends never use these.
  windowTotals?: TodayWindowTotals,
) {
  // When pre-aggregated by day, invoice_count holds the real invoice count.
  // Fallback to 1 per row for backwards compat with raw row format.
  const todaySalesCount = windowTotals?.salesCount ?? todaySalesRows.reduce((sum, r) => sum + Number(r.invoice_count ?? 1), 0);
  const todayPurchasesCount = windowTotals?.purchasesCount ?? todayPurchasesRows.reduce((sum, r) => sum + Number(r.invoice_count ?? 1), 0);
  return {
    todaySalesCount,
    todaySalesAmount: windowTotals?.salesAmount ?? sumMoney(todaySalesRows, (row) => row.total),
    todayPurchasesCount,
    todayPurchasesAmount: windowTotals?.purchasesAmount ?? sumMoney(todayPurchasesRows, (row) => row.total),
    topToday: topTodayRows
      .map((row) => ({
        productId: String(row.product_id || ''),
        name: String(row.product_name || ''),
        qty: Number(row.qty_total || 0),
        total: Number(row.sales_total || 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5),
  };
}

export function buildSevenDayTrends(
  recentSalesRows: TimedMoneyRow[],
  recentPurchasesRows: TimedMoneyRow[],
  businessTimezone: string,
  moneyDigits: MoneyDigits = 2,
): { sales: TrendPoint[]; purchases: TrendPoint[] } {
  const dayKeys = buildLastNDays(30, businessTimezone, new Date());
  const sales: TrendPoint[] = buildTrendMap(recentSalesRows, dayKeys, (row) => dateKey(row.created_at, businessTimezone), (row) => row.total, moneyDigits);
  const purchases: TrendPoint[] = buildTrendMap(recentPurchasesRows, dayKeys, (row) => dateKey(row.created_at, businessTimezone), (row) => row.total, moneyDigits);
  return { sales, purchases };
}


type DashboardSummaryInput = {
  summary: Record<string, unknown>;
  productsCount: number;
  customersCount: number;
  suppliersCount: number;
  inventorySnapshot: {
    lowStockCount: number;
    outOfStockCount: number;
  };
  activeOffers: number;
};

type DashboardStatsInput = {
  productsCount: number;
  customersCount: number;
  suppliersCount: number;
  todayOperations: {
    todaySalesCount: number;
    todaySalesAmount: number;
    todayPurchasesCount: number;
    todayPurchasesAmount: number;
  };
  inventorySnapshot: {
    inventoryCost: number;
    inventorySaleValue: number;
  };
  partnerExposure: {
    customerDebt: number;
    supplierDebt: number;
    nearCreditLimit: number;
    aboveCreditLimit: number;
    highSupplierBalances: number;
  };
  activeOffers: number;
};

type DashboardOverviewPayloadInput = {
  range: { from: string; to: string };
  summary: Record<string, unknown>;
  productsCount: number;
  customersCount: number;
  suppliersCount: number;
  inventorySnapshot: ReturnType<typeof buildInventorySnapshot>;
  partnerExposure: ReturnType<typeof buildPartnerExposureSnapshot>;
  todayOperations: ReturnType<typeof buildTodayOperationsSnapshot>;
  trends: { sales: TrendPoint[]; purchases: TrendPoint[] };
  activeOffers: number;
};

export function buildDashboardSummary({
  summary,
  productsCount,
  customersCount,
  suppliersCount,
  inventorySnapshot,
  activeOffers,
}: DashboardSummaryInput) {
  return {
    ...summary,
    totalProducts: productsCount,
    totalCustomers: customersCount,
    totalSuppliers: suppliersCount,
    lowStockCount: inventorySnapshot.lowStockCount,
    outOfStockCount: inventorySnapshot.outOfStockCount,
    activeOffers,
  };
}

export function buildDashboardStats({
  productsCount,
  customersCount,
  suppliersCount,
  todayOperations,
  inventorySnapshot,
  partnerExposure,
  activeOffers,
}: DashboardStatsInput) {
  return {
    productsCount,
    customersCount,
    suppliersCount,
    todaySalesCount: todayOperations.todaySalesCount,
    todaySalesAmount: todayOperations.todaySalesAmount,
    todayPurchasesCount: todayOperations.todayPurchasesCount,
    todayPurchasesAmount: todayOperations.todayPurchasesAmount,
    inventoryCost: inventorySnapshot.inventoryCost,
    inventorySaleValue: inventorySnapshot.inventorySaleValue,
    customerDebt: partnerExposure.customerDebt,
    supplierDebt: partnerExposure.supplierDebt,
    nearCreditLimit: partnerExposure.nearCreditLimit,
    aboveCreditLimit: partnerExposure.aboveCreditLimit,
    highSupplierBalances: partnerExposure.highSupplierBalances,
    activeOffers,
  };
}

export function buildDashboardOverviewPayload({
  range,
  summary,
  productsCount,
  customersCount,
  suppliersCount,
  inventorySnapshot,
  partnerExposure,
  todayOperations,
  trends,
  activeOffers,
}: DashboardOverviewPayloadInput): Record<string, unknown> {
  return {
    range,
    summary: buildDashboardSummary({
      summary,
      productsCount,
      customersCount,
      suppliersCount,
      inventorySnapshot,
      activeOffers,
    }),
    stats: buildDashboardStats({
      productsCount,
      customersCount,
      suppliersCount,
      todayOperations,
      inventorySnapshot,
      partnerExposure,
      activeOffers,
    }),
    lowStock: inventorySnapshot.lowStock,
    topToday: todayOperations.topToday,
    topCustomers: partnerExposure.topCustomers,
    topSuppliers: partnerExposure.topSuppliers,
    trends,
  };
}
