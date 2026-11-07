import { type Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { ReportRangeQueryDto } from '../dto/report-query.dto';
import { applyReportScopeFilter, buildTenantPredicate } from './reports-query.helper';
import { sumMoney, toMoney } from './reports-math.helper';

export type SummaryCounts = {
  salesCount: number;
  servicesCount: number;
  purchasesCount: number;
  expensesCount: number;
  returnsCount: number;
  salesReturnCount: number;
  purchaseReturnCount: number;
};

export type SummaryTotals = {
  salesTotal: number;
  servicesTotal: number;
  purchasesTotal: number;
  expensesTotal: number;
  operatingMaterialsTotal?: number;
  salesReturnsTotal: number;
  purchaseReturnsTotal: number;
  // INV-SALES-REPORT-RETURNS-CARD: the sales-report "returns and discounts"
  // card is sales returns + sales discounts. Purchase returns must never
  // enter it (they are a purchase-side figure, exposed separately as
  // returns.purchasesTotal). Optional so direct buildCommercialSummary
  // callers that predate the discount total keep compiling.
  salesDiscountsTotal?: number;
  salesTaxTotal?: number;
  salesReturnTaxTotal?: number;
  cashIn: number;
  cashOut: number;
  cogs: number;
  deliveryTotal?: number;
  deliveryCount?: number;
  deliveryFeeMode?: string;
  deliveryStoreProfit?: number;
  freelanceCount?: number;
  freelanceTotal?: number;
  storeFleetCount?: number;
  storeFleetTotal?: number;
  storeFleetCourierShare?: number;
  storeFleetCommissionRate?: number;
};

type TopProductAccumulatorRow = {
  product_id?: string | number | null;
  product_name?: string | null;
  qty?: string | number | null;
  line_total?: string | number | null;
};

type SummaryReturnRow = {
  return_type?: string | null;
  total?: string | number | null;
};

type SummaryMoneyRow = {
  total?: string | number | null;
  // Invoice-level discount granted on a posted sale (sales.discount).
  // Only sales rows carry it; summed into salesDiscountsTotal.
  discount?: string | number | null;
};

type SummaryExpenseRow = {
  amount?: string | number | null;
};

type SummaryTreasuryRow = {
  amount?: string | number | null;
};

type SummarySaleItemRow = {
  qty?: string | number | null;
  cost_price?: string | number | null;
  product_id?: string | number | null;
  product_name?: string | null;
  line_total?: string | number | null;
  allocated_tax?: string | number | null;
};

export function buildTopProducts(rows: TopProductAccumulatorRow[], limit = 10): Array<{ name: string; qty: number; revenue: number; total: number }> {
  const topProductsMap = new Map<string, { name: string; qty: number; revenue: number; total: number }>();

  for (const row of rows) {
    const key = String(row.product_name || row.product_id || '');
    const item = topProductsMap.get(key) || { name: String(row.product_name || ''), qty: 0, revenue: 0, total: 0 };
    item.qty += Number(row.qty || 0);
    item.revenue += Number(row.line_total || 0);
    item.total += Number(row.line_total || 0);
    topProductsMap.set(key, item);
  }

  return [...topProductsMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

export function buildCommercialSummary(counts: SummaryCounts, totals: SummaryTotals) {
  // INV-SALES-REPORT-RETURNS-CARD: the returns-and-discounts card is sales
  // returns + sales discounts only. Adding purchase returns here showed
  // 250.00 (150.00 sale returns + 100.00 purchase returns) for a card whose
  // correct value is 165.00 (150.00 + 15.00 discounts). Purchase returns
  // stay visible separately as returns.purchasesTotal.
  const salesDiscountsTotal = toMoney(totals.salesDiscountsTotal || 0);
  const returnsTotal = toMoney(totals.salesReturnsTotal + salesDiscountsTotal);
  const merchandiseSalesTotal = toMoney(totals.salesTotal);
  const servicesTotal = toMoney(totals.servicesTotal);
  const revenueTotal = toMoney(merchandiseSalesTotal + servicesTotal);
  // Recognise revenue net of output VAT and the net (excluding VAT) returned sales.
  // The merchandise sales/return totals remain gross for invoice reconciliation.
  const salesNetOfTax = toMoney(revenueTotal - Number(totals.salesTaxTotal || 0));
  const returnedNetOfTax = toMoney(totals.salesReturnsTotal - Number(totals.salesReturnTaxTotal || 0));
  const netSales = toMoney(salesNetOfTax - returnedNetOfTax);
  const netPurchases = toMoney(totals.purchasesTotal - totals.purchaseReturnsTotal);
  const grossProfit = toMoney(netSales - totals.cogs);
  const grossMarginPercent = netSales > 0 ? toMoney((grossProfit / netSales) * 100) : 0;
  const netOperatingProfit = toMoney(grossProfit - totals.expensesTotal);

  return {
    sales: {
      // INV-REPORTS-OVERVIEW-FIGURES: the overview "sales movement" card must
      // count and total merchandise sales invoices only. Services are their own
      // revenue line (services.total); folding them into sales.count and
      // sales.total counted the 75.00 services invoice twice (5 invoices
      // instead of 4, 1,000.80 instead of 925.80) on /reports/overview.
      count: counts.salesCount,
      invoiceCount: counts.salesCount,
      servicesCount: counts.servicesCount,
      total: merchandiseSalesTotal,
      merchandiseTotal: merchandiseSalesTotal,
      servicesTotal,
      netSales,
    },
    services: {
      count: counts.servicesCount,
      total: servicesTotal,
    },
    purchases: {
      count: counts.purchasesCount,
      total: totals.purchasesTotal,
      netPurchases,
    },
    expenses: {
      count: counts.expensesCount,
      total: totals.expensesTotal,
      operatingMaterialsTotal: toMoney(totals.operatingMaterialsTotal || 0),
    },
    returns: {
      count: counts.returnsCount,
      total: returnsTotal,
      salesCount: counts.salesReturnCount,
      purchasesCount: counts.purchaseReturnCount,
      salesTotal: totals.salesReturnsTotal,
      discountsTotal: salesDiscountsTotal,
      purchasesTotal: totals.purchaseReturnsTotal,
    },
    treasury: {
      cashIn: totals.cashIn,
      cashOut: totals.cashOut,
      net: toMoney(totals.cashIn - totals.cashOut),
    },
    commercial: {
      cogs: totals.cogs,
      grossProfit,
      grossMarginPercent,
      netOperatingProfit,
      informationalOnlyPurchasesInPeriod: netPurchases,
    },
    delivery: {
      count: totals.deliveryCount ?? 0,
      total: totals.deliveryTotal ?? 0,
      mode: totals.deliveryFeeMode ?? 'freelance_courier',
      storeProfit: totals.deliveryStoreProfit ?? 0,
      freelanceCount: totals.freelanceCount ?? 0,
      freelanceTotal: totals.freelanceTotal ?? 0,
      storeFleetCount: totals.storeFleetCount ?? 0,
      storeFleetTotal: totals.storeFleetTotal ?? 0,
      storeFleetCourierShare: totals.storeFleetCourierShare ?? 0,
      commissionRate: totals.storeFleetCommissionRate ?? 0,
    },
  };
}

export function splitReturnRowsByType(rows: SummaryReturnRow[]) {
  const sales = rows.filter((row) => row.return_type === 'sale');
  const purchases = rows.filter((row) => row.return_type === 'purchase');

  return {
    sales,
    purchases,
  };
}

export function buildReportSummaryPayload(args: {
  salesRows?: SummaryMoneyRow[];
  servicesRows?: SummaryMoneyRow[];
  purchasesRows?: SummaryMoneyRow[];
  expensesRows?: SummaryExpenseRow[];
  returnsRows?: SummaryReturnRow[];
  treasuryRows?: SummaryTreasuryRow[];
  saleItemsRows?: SummarySaleItemRow[];
  returnedSaleItemsRows?: SummarySaleItemRow[];
  cogsOverride?: number;
  topProductsOverride?: Array<{ name: string; qty: number; revenue: number; total: number }>;
  countsOverride?: Partial<SummaryCounts>;
  totalsOverride?: Partial<SummaryTotals>;
  topProductsLimit?: number;
  deliveryFeeMode?: string;
  storeFleetCommissionRate?: number;
}) {
  const {
    salesRows = [],
    servicesRows = [],
    purchasesRows = [],
    expensesRows = [],
    returnsRows = [],
    treasuryRows = [],
    saleItemsRows = [],
    returnedSaleItemsRows = [],
    cogsOverride,
    topProductsOverride,
    countsOverride,
    totalsOverride,
    topProductsLimit = 10,
    deliveryFeeMode = 'freelance_courier',
    storeFleetCommissionRate = 0,
  } = args;
  const splitReturns = splitReturnRowsByType(returnsRows);

  const salesTotal = totalsOverride?.salesTotal != null ? toMoney(totalsOverride.salesTotal) : sumMoney(salesRows, (row) => row.total);
  const servicesTotal = totalsOverride?.servicesTotal != null ? toMoney(totalsOverride.servicesTotal) : sumMoney(servicesRows, (row) => row.total);
  const purchasesTotal = totalsOverride?.purchasesTotal != null ? toMoney(totalsOverride.purchasesTotal) : sumMoney(purchasesRows, (row) => row.total);
  const expensesTotal = totalsOverride?.expensesTotal != null ? toMoney(totalsOverride.expensesTotal) : sumMoney(expensesRows, (row) => row.amount);
  const salesReturnsTotal = totalsOverride?.salesReturnsTotal != null ? toMoney(totalsOverride.salesReturnsTotal) : sumMoney(splitReturns.sales, (row) => row.total);
  const purchaseReturnsTotal = totalsOverride?.purchaseReturnsTotal != null ? toMoney(totalsOverride.purchaseReturnsTotal) : sumMoney(splitReturns.purchases, (row) => row.total);
  // INV-SALES-REPORT-RETURNS-CARD: sum the invoice discount granted on
  // posted sales in the period (sales.discount, already selected by the
  // row-evaluation path). The aggregate path supplies it via override.
  const salesDiscountsTotal = totalsOverride?.salesDiscountsTotal != null ? toMoney(totalsOverride.salesDiscountsTotal) : sumMoney(salesRows, (row) => row.discount);
  
  const salesTaxTotal = totalsOverride?.salesTaxTotal != null
    ? toMoney(totalsOverride.salesTaxTotal)
    : sumMoney(salesRows as Array<{ tax_amount?: number | string | null }>, (row) => row.tax_amount);
  const salesReturnTaxTotal = totalsOverride?.salesReturnTaxTotal != null
    ? toMoney(totalsOverride.salesReturnTaxTotal)
    : sumMoney(returnedSaleItemsRows, (row) => row.allocated_tax);
  const rawCogs = saleItemsRows.reduce((sum, row) => sum + (Number(row.qty || 0) * Number(row.cost_price || 0)), 0);
  const returnedCogs = returnedSaleItemsRows.reduce((sum, row) => sum + (Number(row.qty || 0) * Number(row.cost_price || 0)), 0);
  const cogs = cogsOverride != null ? toMoney(cogsOverride) : (totalsOverride?.cogs != null ? toMoney(totalsOverride.cogs) : toMoney(rawCogs - returnedCogs));
  
  const cashIn = totalsOverride?.cashIn != null ? toMoney(totalsOverride.cashIn) : sumMoney(treasuryRows.filter((row) => Number(row.amount || 0) > 0), (row) => row.amount);
  const cashOut = totalsOverride?.cashOut != null ? toMoney(totalsOverride.cashOut) : Math.abs(sumMoney(treasuryRows.filter((row) => Number(row.amount || 0) < 0), (row) => row.amount));

  const deliveryRows = (salesRows as any[]) || [];
  const freelanceRows = deliveryRows.filter((row) => Number(row.delivery_fee || 0) > 0 && (row.delivery_fee_mode === 'freelance_courier' || (!row.delivery_fee_mode && deliveryFeeMode === 'freelance_courier')));
  const storeFleetRows = deliveryRows.filter((row) => Number(row.delivery_fee || 0) > 0 && (row.delivery_fee_mode === 'store_fleet' || (!row.delivery_fee_mode && deliveryFeeMode === 'store_fleet')));

  const freelanceTotal = totalsOverride?.freelanceTotal != null ? toMoney(totalsOverride.freelanceTotal) : toMoney(freelanceRows.reduce((sum, row) => sum + Number(row.delivery_fee || 0), 0));
  const freelanceCount = totalsOverride?.freelanceCount != null ? Number(totalsOverride.freelanceCount) : freelanceRows.length;

  const storeFleetTotal = totalsOverride?.storeFleetTotal != null ? toMoney(totalsOverride.storeFleetTotal) : toMoney(storeFleetRows.reduce((sum, row) => sum + Number(row.delivery_fee || 0), 0));
  const storeFleetCount = totalsOverride?.storeFleetCount != null ? Number(totalsOverride.storeFleetCount) : storeFleetRows.length;

  const commissionRate = Math.max(0, Math.min(100, Number(storeFleetCommissionRate || 0)));
  const storeFleetCourierShare = toMoney(storeFleetTotal * (commissionRate / 100));
  const deliveryStoreProfit = toMoney(Math.max(0, storeFleetTotal - storeFleetCourierShare));

  const deliveryTotal = toMoney(freelanceTotal + storeFleetTotal);
  const deliveryCount = freelanceCount + storeFleetCount;

  return {
    ...buildCommercialSummary({
      salesCount: countsOverride?.salesCount ?? salesRows.length,
      servicesCount: countsOverride?.servicesCount ?? servicesRows.length,
      purchasesCount: countsOverride?.purchasesCount ?? purchasesRows.length,
      expensesCount: countsOverride?.expensesCount ?? expensesRows.length,
      returnsCount: countsOverride?.returnsCount ?? returnsRows.length,
      salesReturnCount: countsOverride?.salesReturnCount ?? splitReturns.sales.length,
      purchaseReturnCount: countsOverride?.purchaseReturnCount ?? splitReturns.purchases.length,
    }, {
      salesTotal,
      servicesTotal,
      purchasesTotal,
      expensesTotal,
      operatingMaterialsTotal: totalsOverride?.operatingMaterialsTotal ?? 0,
      salesReturnsTotal,
      purchaseReturnsTotal,
      salesDiscountsTotal,
      salesTaxTotal,
      salesReturnTaxTotal,
      cashIn,
      cashOut,
      cogs,
      deliveryTotal,
      deliveryCount,
      deliveryFeeMode,
      deliveryStoreProfit,
      freelanceCount,
      freelanceTotal,
      storeFleetCount,
      storeFleetTotal,
      storeFleetCourierShare,
      storeFleetCommissionRate: commissionRate,
    }),
    topProducts: topProductsOverride != null ? topProductsOverride : buildTopProducts(saleItemsRows, topProductsLimit),
  };
}

export async function buildReportSummaryAggregates(args: {
  db: Kysely<Database>;
  query: ReportRangeQueryDto;
  fromDate: Date;
  toDate: Date;
  tenantId: string;
  deliveryFeeMode: string;
}): Promise<{
  countsOverride: SummaryCounts;
  totalsOverride: SummaryTotals;
  cogsOverride: number;
  topProductsOverride: Array<{ name: string; qty: number; revenue: number; total: number }>;
}> {
  const { db, query, fromDate, toDate, tenantId, deliveryFeeMode } = args;

  const isStoreFleetDefault = deliveryFeeMode === 'store_fleet';
  const freelanceCondition = isStoreFleetDefault
    ? sql<boolean>`delivery_fee > 0 and delivery_fee_mode = 'freelance_courier'`
    : sql<boolean>`delivery_fee > 0 and (delivery_fee_mode = 'freelance_courier' or delivery_fee_mode is null)`;
  const storeFleetCondition = isStoreFleetDefault
    ? sql<boolean>`delivery_fee > 0 and (delivery_fee_mode = 'store_fleet' or delivery_fee_mode is null)`
    : sql<boolean>`delivery_fee > 0 and delivery_fee_mode = 'store_fleet'`;

  const salesAggQuery = applyReportScopeFilter(
    db
      .selectFrom('sales')
      .select([
        sql<number>`count(*)`.as('sales_count'),
        sql<number>`coalesce(sum(total), 0)`.as('sales_total'),
        sql<number>`coalesce(sum(tax_amount), 0)`.as('sales_tax_total'),
        // INV-SALES-REPORT-RETURNS-CARD: invoice discounts granted on
        // posted sales in the period feed the returns-and-discounts card.
        sql<number>`coalesce(sum(discount), 0)`.as('sales_discounts_total'),
        sql<number>`count(*) filter (where ${freelanceCondition})`.as('freelance_count'),
        sql<number>`coalesce(sum(delivery_fee) filter (where ${freelanceCondition}), 0)`.as('freelance_total'),
        sql<number>`count(*) filter (where ${storeFleetCondition})`.as('store_fleet_count'),
        sql<number>`coalesce(sum(delivery_fee) filter (where ${storeFleetCondition}), 0)`.as('store_fleet_total'),
      ])
      .where('status', '=', 'posted')
      .where('created_at', '>=', fromDate)
      .where('created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId)),
    query,
  );

  const purchasesAggQuery = applyReportScopeFilter(
    db
      .selectFrom('purchases')
      .select([
        sql<number>`count(*)`.as('purchases_count'),
        sql<number>`coalesce(sum(total), 0)`.as('purchases_total'),
      ])
      .where('status', '=', 'posted')
      .where('created_at', '>=', fromDate)
      .where('created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId)),
    query,
  );

  const servicesAggQuery = applyReportScopeFilter(
    (db as any)
      .selectFrom('services')
      .select([
        sql<number>`count(*)`.as('services_count'),
        sql<number>`coalesce(sum(amount), 0)`.as('services_total'),
      ])
      .where('is_active', '=', true)
      .where('service_date', '>=', fromDate)
      .where('service_date', '<=', toDate)
      .where(buildTenantPredicate(tenantId)),
    query,
  );

  const expensesAggQuery = applyReportScopeFilter(
    db
      .selectFrom('expenses')
      .select([
        sql<number>`count(*)`.as('expenses_count'),
        sql<number>`coalesce(sum(amount), 0)`.as('expenses_total'),
      ])
      .where('expense_date', '>=', fromDate)
      .where('expense_date', '<=', toDate)
      .where(buildTenantPredicate(tenantId)),
    query,
  );

  // Stock issued permanently for operations is expensed to account 6900,
  // without a row in the standalone expenses table. Excluding it from this
  // summary overstates operating profit compared with the general ledger.
  const operatingMaterialsQuery = applyReportScopeFilter(
    db.selectFrom('stock_movements as m')
      .select(sql<number>`coalesce(sum(m.total_cost), 0)`.as('materials_total'))
      .where('m.movement_type', '=', 'transfer_final_issue')
      .where('m.reason', '=', 'final_issue')
      .where('m.created_at', '>=', fromDate)
      .where('m.created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId, 'm')),
    query, 'm',
  );

  const returnsAggQuery = applyReportScopeFilter(
    db
      .selectFrom('return_documents')
      .select([
        'return_type',
        sql<number>`count(*)`.as('count'),
        sql<number>`coalesce(sum(total), 0)`.as('total'),
      ])
      .where('created_at', '>=', fromDate)
      .where('created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId))
      .groupBy('return_type'),
    query,
  );

  const salesReturnTaxQuery = applyReportScopeFilter(
    db.selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'))
      .select(sql<number>`coalesce(sum(ri.allocated_tax), 0)`.as('tax_total'))
      .where('rd.return_type', '=', 'sale')
      .where('rd.created_at', '>=', fromDate)
      .where('rd.created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId, 'rd'))
      .where(buildTenantPredicate(tenantId, 'ri')),
    query,
    'rd',
  );

  const treasuryAggQuery = applyReportScopeFilter(
    db
      .selectFrom('treasury_transactions')
      .select([
        sql<number>`coalesce(sum(case when amount > 0 then amount else 0 end), 0)`.as('cash_in'),
        sql<number>`coalesce(abs(sum(case when amount < 0 then amount else 0 end)), 0)`.as('cash_out'),
      ])
      .where('created_at', '>=', fromDate)
      .where('created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId)),
    query,
  );

  const rawCogsQuery = applyReportScopeFilter(
    db
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', (join) => join.onRef('s.id', '=', 'si.sale_id').onRef('s.tenant_id', '=', 'si.tenant_id'))
      .select(sql<number>`coalesce(sum(si.qty * si.cost_price), 0)`.as('raw_cogs'))
      .where('s.status', '=', 'posted')
      .where('s.created_at', '>=', fromDate)
      .where('s.created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId, 's'))
      .where(buildTenantPredicate(tenantId, 'si')),
    query,
    's',
  );

  const returnedCogsQuery = applyReportScopeFilter(
    db
      .selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'))
      .leftJoin('sale_items as si', (join) =>
        join.onRef('si.id', '=', 'ri.sale_item_id').onRef('si.tenant_id', '=', 'ri.tenant_id'),
      )
      .leftJoin('products as p', (join) => join.onRef('p.id', '=', 'ri.product_id').onRef('p.tenant_id', '=', 'ri.tenant_id'))
      .select(
        sql<number>`coalesce(sum(ri.qty * coalesce(ri.cost_price, si.cost_price, p.cost_price, 0)), 0)`.as('returned_cogs'),
      )
      .where('rd.return_type', '=', 'sale')
      .where('rd.created_at', '>=', fromDate!)
      .where('rd.created_at', '<=', toDate!)
      .where(buildTenantPredicate(tenantId, 'rd'))
      .where(buildTenantPredicate(tenantId, 'ri')),
    query,
    'rd',
  );

  const topProductsQuery = applyReportScopeFilter(
    db
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', (join) => join.onRef('s.id', '=', 'si.sale_id').onRef('s.tenant_id', '=', 'si.tenant_id'))
      .select([
        sql<string>`coalesce(si.product_name, 'صنف غير محدد')`.as('name'),
        sql<number>`coalesce(sum(si.qty), 0)`.as('qty'),
        sql<number>`coalesce(sum(si.line_total), 0)`.as('revenue'),
        sql<number>`coalesce(sum(si.line_total), 0)`.as('total'),
      ])
      .where('s.status', '=', 'posted')
      .where('s.created_at', '>=', fromDate)
      .where('s.created_at', '<=', toDate)
      .where(buildTenantPredicate(tenantId, 's'))
      .where(buildTenantPredicate(tenantId, 'si'))
      .where('si.product_name', 'is not', null)
      .groupBy('si.product_name')
      .orderBy(sql`sum(si.line_total)`, 'desc')
      .limit(10),
    query,
    's',
  );

  const [
    salesAggRow,
    purchasesAggRow,
    servicesAggRow,
    expensesAggRow,
    operatingMaterialsRow,
    returnsAggRows,
    salesReturnTaxRow,
    treasuryAggRow,
    rawCogsRow,
    returnedCogsRow,
    topProductsRows,
  ] = await Promise.all([
    salesAggQuery.executeTakeFirst(),
    purchasesAggQuery.executeTakeFirst(),
    servicesAggQuery.executeTakeFirst(),
    expensesAggQuery.executeTakeFirst(),
    operatingMaterialsQuery.executeTakeFirst(),
    returnsAggQuery.execute(),
    salesReturnTaxQuery.executeTakeFirst(),
    treasuryAggQuery.executeTakeFirst(),
    rawCogsQuery.executeTakeFirst(),
    returnedCogsQuery.executeTakeFirst(),
    topProductsQuery.execute(),
  ]);

  let returnsCount = 0;
  let salesReturnCount = 0;
  let purchaseReturnCount = 0;
  let salesReturnsTotal = 0;
  let purchaseReturnsTotal = 0;
  for (const r of returnsAggRows || []) {
    const c = Number((r as any).count || 0);
    const t = Number((r as any).total || 0);
    returnsCount += c;
    if (r.return_type === 'sale') {
      salesReturnCount += c;
      salesReturnsTotal += t;
    } else if (r.return_type === 'purchase') {
      purchaseReturnCount += c;
      purchaseReturnsTotal += t;
    }
  }

  const rawCogs = Number((rawCogsRow as any)?.raw_cogs || 0);
  const returnedCogs = Number((returnedCogsRow as any)?.returned_cogs || 0);
  // Return COGS can exceed new-sale COGS in a quiet period; do not clamp it away.
  const cogsOverride = rawCogs - returnedCogs;

  const topProductsOverride = (topProductsRows || []).map((r: any) => ({
    name: String(r.name || 'صنف غير محدد'),
    qty: Number(r.qty || 0),
    revenue: Number(r.revenue || 0),
    total: Number(r.total || 0),
  }));

  const countsOverride = {
    salesCount: Number((salesAggRow as any)?.sales_count || 0),
    servicesCount: Number((servicesAggRow as any)?.services_count || 0),
    purchasesCount: Number((purchasesAggRow as any)?.purchases_count || 0),
    expensesCount: Number((expensesAggRow as any)?.expenses_count || 0),
    returnsCount,
    salesReturnCount,
    purchaseReturnCount,
  };

  const totalsOverride = {
    salesTotal: Number((salesAggRow as any)?.sales_total || 0),
    salesTaxTotal: Number((salesAggRow as any)?.sales_tax_total || 0),
    salesReturnTaxTotal: Number((salesReturnTaxRow as any)?.tax_total || 0),
    servicesTotal: Number((servicesAggRow as any)?.services_total || 0),
    purchasesTotal: Number((purchasesAggRow as any)?.purchases_total || 0),
    expensesTotal: Number((expensesAggRow as any)?.expenses_total || 0) + Number((operatingMaterialsRow as any)?.materials_total || 0),
    operatingMaterialsTotal: Number((operatingMaterialsRow as any)?.materials_total || 0),
    salesReturnsTotal,
    purchaseReturnsTotal,
    salesDiscountsTotal: Number((salesAggRow as any)?.sales_discounts_total || 0),
    cashIn: Number((treasuryAggRow as any)?.cash_in || 0),
    cashOut: Number((treasuryAggRow as any)?.cash_out || 0),
    cogs: cogsOverride,
    freelanceCount: Number((salesAggRow as any)?.freelance_count || 0),
    freelanceTotal: Number((salesAggRow as any)?.freelance_total || 0),
    storeFleetCount: Number((salesAggRow as any)?.store_fleet_count || 0),
    storeFleetTotal: Number((salesAggRow as any)?.store_fleet_total || 0),
  };

  return { countsOverride, totalsOverride, cogsOverride, topProductsOverride };
}

export interface CustomerRfmRow {
  customerId: number | string;
  customerName: string;
  customerPhone?: string | null;
  currentBalance?: number | string | null;
  loyaltyPoints?: number | string | null;
  frequency?: number | string | null;
  monetary?: number | string | null;
  lastSaleDate?: string | null;
}

export function buildCustomerRfmPayload(rows: CustomerRfmRow[], targetSegment?: string) {
  const now = Date.now();

  const mapped = rows.map((r) => {
    const frequency = Number(r.frequency || 0);
    const monetary = Number(Number(r.monetary || 0).toFixed(2));
    const lastDate = r.lastSaleDate ? new Date(r.lastSaleDate).getTime() : 0;
    const recencyDays = lastDate ? Math.max(0, Math.floor((now - lastDate) / (1000 * 60 * 60 * 24))) : 999;
    const aov = frequency > 0 ? Number((monetary / frequency).toFixed(2)) : 0;

    let segment: 'champions' | 'loyal' | 'promising' | 'at_risk' | 'lost' = 'promising';
    if (recencyDays <= 30 && frequency >= 4) {
      segment = 'champions';
    } else if (recencyDays <= 60 && frequency >= 3) {
      segment = 'loyal';
    } else if (recencyDays <= 30) {
      segment = 'promising';
    } else if (recencyDays > 120) {
      segment = 'lost';
    } else if (recencyDays > 60 && frequency >= 2) {
      segment = 'at_risk';
    } else {
      segment = 'at_risk';
    }

    return {
      id: String(r.customerId),
      name: r.customerName,
      phone: r.customerPhone || '',
      balance: Number(r.currentBalance || 0),
      loyaltyPoints: Number(r.loyaltyPoints || 0),
      frequency,
      monetary,
      recencyDays,
      lastSaleDate: r.lastSaleDate,
      aov,
      segment,
    };
  });

  const totalCustomers = mapped.length;
  const championsCount = mapped.filter((c) => c.segment === 'champions').length;
  const loyalCount = mapped.filter((c) => c.segment === 'loyal').length;
  const promisingCount = mapped.filter((c) => c.segment === 'promising').length;
  const atRiskCount = mapped.filter((c) => c.segment === 'at_risk').length;
  const lostCount = mapped.filter((c) => c.segment === 'lost').length;
  const totalRevenue = Number(mapped.reduce((sum, c) => sum + c.monetary, 0).toFixed(2));
  const totalOrders = mapped.reduce((sum, c) => sum + c.frequency, 0);
  const averageAov = totalOrders > 0 ? Number((totalRevenue / totalOrders).toFixed(2)) : 0;
  const repeatCount = mapped.filter((c) => c.frequency > 1).length;
  const repeatRate = totalCustomers > 0 ? Number(((repeatCount / totalCustomers) * 100).toFixed(1)) : 0;

  const items = targetSegment && targetSegment !== 'all'
    ? mapped.filter((c) => c.segment === targetSegment)
    : mapped;

  items.sort((a, b) => b.monetary - a.monetary);

  return {
    summary: {
      totalCustomers,
      championsCount,
      loyalCount,
      promisingCount,
      atRiskCount,
      lostCount,
      totalRevenue,
      averageAov,
      repeatRate,
    },
    items,
  };
}

