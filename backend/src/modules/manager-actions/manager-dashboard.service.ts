import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { Kysely, sql } from '../../database/kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';

type Row = Record<string, any>;
function n(value: unknown): number { const x = Number(value ?? 0); return Number.isFinite(x) ? x : 0; }
function m(value: number): number { return Math.round(value * 100) / 100; }
function pct(current: number, previous: number): number | null { return previous ? m(((current - previous) / previous) * 100) : null; }
function ageDays(value: unknown, now: Date): number | null { if (!value) return null; const d = value instanceof Date ? value : new Date(String(value)); return Number.isNaN(d.getTime()) ? null : Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86400000)); }

interface CachedManagerOverview {
  expiresAt: number;
  data: any;
}

@Injectable()
export class ManagerDashboardService {
  private readonly overviewCache = new Map<string, CachedManagerOverview>();
  private readonly OVERVIEW_CACHE_TTL_MS = 30_000;

  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async overview(auth?: AuthContext) {
    const scope = auth ? requireTenantScope(auth) : { tenantId: '', accountId: '' };
    const tenantId = scope.tenantId;
    const nowMs = Date.now();
    const cached = this.overviewCache.get(tenantId);
    if (cached && nowMs < cached.expiresAt) {
      return cached.data;
    }
    const now = new Date();
    const last30Start = new Date(now); last30Start.setUTCDate(last30Start.getUTCDate() - 30);
    const previous30Start = new Date(now); previous30Start.setUTCDate(previous30Start.getUTCDate() - 60);
    const oneYearAgo = new Date(now); oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    const [salesLast30, salesPrevious30, returnsLast30, returnTaxLast30, expensesLast30, issuedMaterialsLast30, servicesLast30, profitRows, products, customers, settingsRows] = await Promise.all([
      // Financial queries must fail visibly instead of falling back to zeros.
      this.salesTotals(last30Start, now, tenantId),
      this.salesTotals(previous30Start, last30Start, tenantId),
      this.returnTotals(last30Start, now, tenantId),
      this.saleReturnTax(last30Start, now, tenantId),
      this.expenseTotals(last30Start, now, tenantId),
      this.issuedMaterialsTotal(last30Start, now, tenantId),
      this.servicesTotals(last30Start, now, tenantId),
      this.profitRows(last30Start, now, tenantId),
      this.safeRows(() => this.productStockRows(last30Start, oneYearAgo, tenantId)),
      this.safeRows(() => this.customerDebtRows(tenantId)),
      this.safeRows(() => this.db.selectFrom('settings').select(['key', 'value']).where(this.tenantClause(tenantId)).execute()),
    ]);
    const settingsMap = settingsRows.reduce<Record<string, any>>((acc, row) => {
      try { acc[row.key] = JSON.parse(row.value); } catch { acc[row.key] = row.value; }
      return acc;
    }, {});
    const stagnantThresholdDays = Number(settingsMap.stagnantProductDays) > 0 ? Number(settingsMap.stagnantProductDays) : 60;
    const salesTotal = m(n(salesLast30?.total));
    const salesCount = n(salesLast30?.count);
    const previousTotal = m(n(salesPrevious30?.total));
    const salesReturnsTotal = m(n(returnsLast30.find((r) => r.return_type === 'sale')?.total));
    const salesTax = m(n(salesLast30?.tax));
    const returnedTax = m(n(returnTaxLast30?.tax));
    // INV-SERVICES-PROFIT: services are real collected revenue, so they
    // count in the dashboard profit exactly as the sales report counts
    // them (buildCommercialSummary adds servicesTotal to revenueTotal
    // before tax/returns/COGS). Before this, the dashboard summed only
    // the `sales` table, so a 75.00 services invoice showed 776.51 in
    // the sales report and 701.51 on the dashboard. Services carry no
    // COGS, so the same amount flows into gross and net profit.
    const servicesTotal = m(n(servicesLast30?.total));
    const netSales = m(salesTotal + servicesTotal - salesTax - salesReturnsTotal + returnedTax);
    const cogs = m(profitRows.reduce((total, row) => total + n(row.cost), 0));
    const grossProfit = m(netSales - cogs);
    const expenses = m(n(expensesLast30?.total) + n(issuedMaterialsLast30?.total));
    const productProfit = this.buildProductProfit(profitRows);
    const categoryProfit = this.buildCategoryProfit(profitRows);
    const result = { scope, salesLast30: { total: salesTotal, count: salesCount, averageInvoice: salesCount > 0 ? m(salesTotal / salesCount) : 0, previousTotal, comparisonPercent: pct(salesTotal, previousTotal) }, profitSummary: { netSales, cogs, grossProfit, expenses, netProfit: m(grossProfit - expenses) }, profitSources: { topProducts: productProfit.filter((r) => r.grossProfit > 0).slice(0, 6), topCategories: categoryProfit.filter((r) => r.grossProfit > 0).slice(0, 6), weakMarginHighSales: productProfit.filter((r) => r.revenue > 0 && r.marginPercent < 15).sort((a, b) => b.revenue - a.revenue).slice(0, 5) }, stagnant: this.buildStagnant(products, now, stagnantThresholdDays), buying: this.buildBuying(products, productProfit), collection: this.buildCollection(customers) };
    this.overviewCache.delete(tenantId);
    this.overviewCache.set(tenantId, { expiresAt: nowMs + this.OVERVIEW_CACHE_TTL_MS, data: result });
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

  private async safeRows<T>(loader: () => Promise<T[]>): Promise<T[]> { try { return await loader(); } catch { return []; } }
  private async safeFirst<T>(loader: () => Promise<T | undefined>): Promise<T | undefined> { try { return await loader(); } catch { return undefined; } }
  private tenantClause(tenantId: string, alias = '') { return alias ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}` : sql<boolean>`tenant_id = ${tenantId}`; }

  private salesTotals(from: Date, to: Date, tenantId: string): Promise<Row | undefined> { return this.db.selectFrom('sales').select([sql<number>`count(*)`.as('count'), sql<number>`coalesce(sum(total), 0)`.as('total'), sql<number>`coalesce(sum(tax_amount), 0)`.as('tax')]).where('status', '=', 'posted').where('created_at', '>=', from).where('created_at', '<', to).where(this.tenantClause(tenantId)).executeTakeFirst(); }
  private returnTotals(from: Date, to: Date, tenantId: string): Promise<Row[]> { return this.db.selectFrom('return_documents').select(['return_type', sql<number>`coalesce(sum(total), 0)`.as('total')]).where('created_at', '>=', from).where('created_at', '<', to).where(this.tenantClause(tenantId)).groupBy('return_type').execute(); }
  private expenseTotals(from: Date, to: Date, tenantId: string): Promise<Row | undefined> { return this.db.selectFrom('expenses').select(sql<number>`coalesce(sum(amount), 0)`.as('total')).where('expense_date', '>=', from).where('expense_date', '<', to).where(this.tenantClause(tenantId)).executeTakeFirst(); }
  // INV-SERVICES-PROFIT: same predicates as the sales-report aggregate
  // (buildReportSummaryAggregates servicesAggQuery): active services only,
  // service_date inside the window. `(db as any)` because the typed
  // ServicesTable omits the real is_active column (migration
  // 1710000001000), the same cast the reports helper already uses.
  private servicesTotals(from: Date, to: Date, tenantId: string): Promise<Row | undefined> {
    return (this.db as any).selectFrom('services')
      .select(sql<number>`coalesce(sum(amount), 0)`.as('total'))
      .where('is_active', '=', true)
      .where('service_date', '>=', from).where('service_date', '<', to)
      .where(this.tenantClause(tenantId)).executeTakeFirst();
  }
  private saleReturnTax(from: Date, to: Date, tenantId: string): Promise<Row | undefined> {
    return this.db.selectFrom('return_items as ri')
      .innerJoin('return_documents as rd', (join) => join.onRef('rd.id', '=', 'ri.return_document_id').onRef('rd.tenant_id', '=', 'ri.tenant_id'))
      .select(sql<number>`coalesce(sum(ri.allocated_tax), 0)`.as('tax'))
      .where('rd.return_type', '=', 'sale').where('rd.created_at', '>=', from).where('rd.created_at', '<', to)
      .where(this.tenantClause(tenantId, 'rd')).where(this.tenantClause(tenantId, 'ri')).executeTakeFirst();
  }
  private issuedMaterialsTotal(from: Date, to: Date, tenantId: string): Promise<Row | undefined> {
    return this.db.selectFrom('stock_movements')
      .select(sql<number>`coalesce(sum(total_cost), 0)`.as('total'))
      .where('movement_type', '=', 'transfer_final_issue').where('reason', '=', 'final_issue')
      .where('created_at', '>=', from).where('created_at', '<', to)
      .where(this.tenantClause(tenantId)).executeTakeFirst();
  }
  private async profitRows(from: Date, to: Date, tenantId: string): Promise<Row[]> {
    // Income and cost use the original sale-line selling unit. cost_price must
    // NOT be multiplied by unit_multiplier again (carton sales were inflated).
    // Use two period-scoped streams: a return today may reference an old sale.
    const result = await sql<Row>`
      with line_activity as (
        select si.product_id, si.product_name,
          (si.qty * coalesce(si.unit_multiplier, 1)) as qty,
          coalesce(si.net_line_total, si.line_total - coalesce(si.allocated_discount, 0)
            - case when s.prices_include_tax then coalesce(si.allocated_tax, 0) else 0 end) as revenue,
          (si.qty * coalesce(si.cost_price, 0)) as cost
        from sale_items si
        join sales s on s.id = si.sale_id and s.tenant_id = si.tenant_id
        where si.tenant_id = ${tenantId} and s.status = 'posted'
          and s.created_at >= ${from} and s.created_at < ${to}
        union all
        select ri.product_id, ri.product_name,
          -(ri.qty * coalesce(si.unit_multiplier, 1)) as qty,
          -(ri.line_total - coalesce(ri.allocated_tax, 0)) as revenue,
          -(ri.qty * coalesce(ri.cost_price, si.cost_price, 0)) as cost
        from return_items ri
        join return_documents rd on rd.id = ri.return_document_id and rd.tenant_id = ri.tenant_id
        left join sale_items si on si.id = ri.sale_item_id and si.tenant_id = ri.tenant_id
        where ri.tenant_id = ${tenantId} and rd.return_type = 'sale'
          and rd.created_at >= ${from} and rd.created_at < ${to}
      )
      select a.product_id, a.product_name, p.category_id, c.name as category_name,
        coalesce(sum(a.qty), 0) as qty,
        coalesce(sum(a.revenue), 0) as revenue,
        coalesce(sum(a.cost), 0) as cost
      from line_activity a
      left join products p on p.id = a.product_id and p.tenant_id = ${tenantId}
      left join product_categories c on c.id = p.category_id and c.tenant_id = ${tenantId}
      group by a.product_id, a.product_name, p.category_id, c.name
    `.execute(this.db);
    return result.rows;
  }
  private productStockRows(last30Start: Date, oneYearAgo: Date, tenantId: string): Promise<Row[]> { return this.db.selectFrom('products as p').leftJoin('product_categories as c', 'c.id', 'p.category_id').leftJoin((eb) => eb.selectFrom('sale_items as si').innerJoin('sales as s', 's.id', 'si.sale_id').select(['si.product_id', sql<Date>`max(s.created_at)`.as('last_sold_at'), sql<number>`coalesce(sum(case when s.created_at >= ${last30Start} then si.qty * si.unit_multiplier else 0 end), 0)`.as('sold_qty_30')]).where('s.status', '=', 'posted').where('s.created_at', '>=', oneYearAgo).where('si.product_id', 'is not', null).where(this.tenantClause(tenantId, 's')).where(this.tenantClause(tenantId, 'si')).groupBy('si.product_id').as('sales_activity'), (join) => join.onRef('sales_activity.product_id', '=', 'p.id')).select(['p.id', 'p.name', 'c.name as category_name', 'p.stock_qty', 'p.min_stock_qty', 'p.cost_price', 'p.retail_price', 'sales_activity.last_sold_at', 'sales_activity.sold_qty_30']).where('p.is_active', '=', true).where(this.tenantClause(tenantId, 'p')).execute(); }
  private customerDebtRows(tenantId: string): Promise<Row[]> { return this.db.selectFrom('customers').select(['id', 'name', 'balance', 'credit_limit']).where('is_active', '=', true).where('balance', '>', 0).where(this.tenantClause(tenantId)).execute(); }

  private buildProductProfit(rows: Row[]) { return rows.map((r) => { const revenue = m(n(r.revenue)); const cost = m(n(r.cost)); const grossProfit = m(revenue - cost); return { productId: String(r.product_id || ''), name: r.product_name || 'صنف غير محدد', categoryName: r.category_name || '', qty: m(n(r.qty)), revenue, cost, grossProfit, marginPercent: revenue > 0 ? m((grossProfit / revenue) * 100) : 0 }; }).sort((a, b) => b.grossProfit - a.grossProfit); }
  private buildCategoryProfit(rows: Row[]) { const map = new Map<string, any>(); for (const r of rows) { const key = String(r.category_id || 'uncategorized'); const item = map.get(key) || { categoryId: key, name: r.category_name || 'بدون قسم', revenue: 0, cost: 0 }; item.revenue += n(r.revenue); item.cost += n(r.cost); map.set(key, item); } return [...map.values()].map((r) => ({ ...r, revenue: m(r.revenue), cost: m(r.cost), grossProfit: m(r.revenue - r.cost), marginPercent: r.revenue > 0 ? m(((r.revenue - r.cost) / r.revenue) * 100) : 0 })).sort((a, b) => b.grossProfit - a.grossProfit); }
  private buildStagnant(products: Row[], now: Date, thresholdDays = 30) { const items = products.map((p) => { const days = ageDays(p.last_sold_at, now); return { productId: String(p.id), name: p.name || '', categoryName: p.category_name || '', stockQty: n(p.stock_qty), costPrice: n(p.cost_price), inventoryValue: m(n(p.stock_qty) * n(p.cost_price)), daysWithoutSales: days }; }).filter((p) => p.stockQty > 0 && p.daysWithoutSales != null && p.daysWithoutSales >= thresholdDays).sort((a, b) => (b.daysWithoutSales || 0) - (a.daysWithoutSales || 0)); return { thresholdDays, days30: items.filter((i) => Number(i.daysWithoutSales) >= 30).length, days60: items.filter((i) => Number(i.daysWithoutSales) >= 60).length, days90: items.filter((i) => Number(i.daysWithoutSales) >= 90).length, daysConfigured: items.filter((i) => Number(i.daysWithoutSales) >= thresholdDays).length, inventoryValue: m(items.reduce((s, i) => s + i.inventoryValue, 0)), items: items.slice(0, 6), itemsTotal: items.length }; }
  private buildBuying(products: Row[], productProfit: ReturnType<ManagerDashboardService['buildProductProfit']>) { const profits = new Map(productProfit.map((r) => [r.productId, r])); const rows = products.map((p) => { const productId = String(p.id); const soldQty30 = n(p.sold_qty_30); const stockQty = n(p.stock_qty); const minStockQty = n(p.min_stock_qty); const dailyVelocity = soldQty30 / 30; const daysToRunOut = dailyVelocity > 0 ? m(stockQty / dailyVelocity) : null; const profit = profits.get(productId); const priorityScore = (stockQty <= 0 ? 100 : 0) + (stockQty > 0 && minStockQty > 0 && stockQty <= minStockQty ? 45 : 0) + (daysToRunOut != null && daysToRunOut <= 14 ? 30 : 0) + Math.max(0, profit?.grossProfit || 0) / 100; return { productId, name: p.name || '', categoryName: p.category_name || '', stockQty, minStockQty, soldQty30, daysToRunOut, grossProfit: profit?.grossProfit || 0, marginPercent: profit?.marginPercent || 0, priorityScore }; }); const outOfStockAll = rows.filter((r) => r.stockQty <= 0); const lowStockAll = rows.filter((r) => r.stockQty > 0 && r.minStockQty > 0 && r.stockQty <= r.minStockQty); const priorityAll = rows.filter((r) => r.priorityScore > 0); return { outOfStock: outOfStockAll.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 6), outOfStockTotal: outOfStockAll.length, lowStock: lowStockAll.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 6), lowStockTotal: lowStockAll.length, priority: priorityAll.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 6), priorityTotal: priorityAll.length }; }
  private buildCollection(customers: Row[]) { const rows = customers.map((c) => { const balance = m(n(c.balance)); const creditLimit = m(n(c.credit_limit)); return { customerId: String(c.id), name: c.name || '', balance, creditLimit, creditUsagePercent: creditLimit > 0 ? m((balance / creditLimit) * 100) : null }; }).filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance); const aboveAll = rows.filter((r) => r.creditLimit > 0 && r.balance > r.creditLimit); const nearAll = rows.filter((r) => r.creditLimit > 0 && r.balance >= r.creditLimit * 0.8 && r.balance <= r.creditLimit); return { topDebts: rows.slice(0, 6), topDebtsTotal: rows.length, aboveCreditLimit: aboveAll.slice(0, 6), aboveCreditLimitTotal: aboveAll.length, nearCreditLimit: nearAll.slice(0, 6), nearCreditLimitTotal: nearAll.length }; }
}
