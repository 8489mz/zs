import { Inject, Injectable } from '@nestjs/common';
import { type Kysely } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { sql } from '../../../database/kysely';
import { toMoney } from '../helpers/reports-math.helper';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { ReportRangeQueryDto } from '../dto/report-query.dto';
import { buildPagination } from '../helpers/reports-range.helper';
import { buildCustomerRfmPayload } from '../helpers/reports-summary.helper';
import { buildReportListState } from '../helpers/reports-query.helper';
import { applyPartnerLedgerSearch, applySignedAmountFilter } from '../helpers/reports-query-pipeline.helper';
import {
  buildCustomerBalancesPayload,
  buildCustomerLedgerPayload,
  buildSupplierBalancesPayload,
  buildSupplierLedgerPayload,
  LedgerSummaryRow,
  PartnerLedgerEntryRow,
} from '../helpers/reports-ledger.helper';
import { buildCustomerLedgerTotals, buildSupplierLedgerTotals } from '../helpers/reports-partner-ledger.helper';
import { AppError } from '../../../common/errors/app-error';

@Injectable()
export class ReportsSummaryService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private scope(auth: AuthContext) {
    return requireTenantScope(auth);
  }

  private tenantId(auth: AuthContext): string {
    return this.scope(auth).tenantId;
  }

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const { tenantId } = this.scope(auth);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}`
      : sql<boolean>`tenant_id = ${tenantId}`;
  }

  private withScope(payload: Record<string, unknown>, auth: AuthContext): Record<string, unknown> {
    return {
      ...payload,
      scope: this.scope(auth),
    };
  }

  async debtAgingReport(auth: AuthContext): Promise<Record<string, unknown>> {
    const tenantId = this.tenantId(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const toAgingMoney = (amount: number) => toMoney(amount, digits);
    const now = new Date();

    const customerRows = await this.db
      .selectFrom('customers')
      .select(['id', 'name', 'phone', 'balance', 'credit_limit'])
      .where('tenant_id', '=', tenantId)
      .where('balance', '>', 0)
      .orderBy('balance', 'desc')
      .execute();

    const cutoff31 = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const cutoff61 = new Date(now.getTime() - 61 * 24 * 60 * 60 * 1000);
    const cutoff91 = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    const customerAging = customerRows.length ? await sql<{
      partner_id: number; current_amount: number; days_31_to_60: number; days_61_to_90: number;
    }>`
      with ordered as (
        select s.customer_id as partner_id,
               greatest(0, s.total - coalesce(s.paid_amount, 0)) as total,
               s.created_at, c.balance,
               coalesce(sum(greatest(0, s.total - coalesce(s.paid_amount, 0))) over (
                 partition by s.customer_id order by s.created_at desc, s.id desc
                 rows between unbounded preceding and 1 preceding
               ), 0) as prior_total
        from sales s
        join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id
        where s.tenant_id = ${tenantId} and c.balance > 0
          and s.payment_type = 'credit' and s.status = 'posted'
          and s.total - coalesce(s.paid_amount, 0) > 0
      ), allocated as (
        select partner_id, created_at, greatest(0, least(total, balance - prior_total)) as amount
        from ordered
      )
      select partner_id,
             coalesce(sum(amount) filter (where created_at > ${cutoff31}), 0) as current_amount,
             coalesce(sum(amount) filter (where created_at <= ${cutoff31} and created_at > ${cutoff61}), 0) as days_31_to_60,
             coalesce(sum(amount) filter (where created_at <= ${cutoff61} and created_at > ${cutoff91}), 0) as days_61_to_90
      from allocated group by partner_id
    `.execute(this.db) : { rows: [] };
    const agingByCustomer = new Map(customerAging.rows.map((row) => [Number(row.partner_id), row]));

    const receivables = customerRows.map((cust) => {
      const balance = Number(cust.balance || 0);
      const aging = agingByCustomer.get(Number(cust.id));
      const current = Number(aging?.current_amount || 0);
      const days31To60 = Number(aging?.days_31_to_60 || 0);
      const days61To90 = Number(aging?.days_61_to_90 || 0);
      const over90 = Math.max(0, balance - current - days31To60 - days61To90);

      return {
        id: String(cust.id),
        name: cust.name || 'عميل',
        phone: cust.phone || '',
        totalBalance: toAgingMoney(balance),
        current: toAgingMoney(current),
        days31To60: toAgingMoney(days31To60),
        days61To90: toAgingMoney(days61To90),
        over90: toAgingMoney(over90),
      };
    });

    const supplierRows = await this.db
      .selectFrom('suppliers')
      .select(['id', 'name', 'phone', 'balance'])
      .where('tenant_id', '=', tenantId)
      .where('balance', '>', 0)
      .orderBy('balance', 'desc')
      .execute();

    const supplierAging = supplierRows.length ? await sql<{
      partner_id: number; current_amount: number; days_31_to_60: number; days_61_to_90: number;
    }>`
      with ordered as (
        select p.supplier_id as partner_id,
               greatest(0, p.total - coalesce(p.paid_amount, 0)) as total,
               p.created_at, s.balance,
               coalesce(sum(greatest(0, p.total - coalesce(p.paid_amount, 0))) over (
                 partition by p.supplier_id order by p.created_at desc, p.id desc
                 rows between unbounded preceding and 1 preceding
               ), 0) as prior_total
        from purchases p
        join suppliers s on s.id = p.supplier_id and s.tenant_id = p.tenant_id
        where p.tenant_id = ${tenantId} and s.balance > 0
          and p.payment_type = 'credit' and p.status = 'posted'
          and p.total - coalesce(p.paid_amount, 0) > 0
      ), allocated as (
        select partner_id, created_at, greatest(0, least(total, balance - prior_total)) as amount
        from ordered
      )
      select partner_id,
             coalesce(sum(amount) filter (where created_at > ${cutoff31}), 0) as current_amount,
             coalesce(sum(amount) filter (where created_at <= ${cutoff31} and created_at > ${cutoff61}), 0) as days_31_to_60,
             coalesce(sum(amount) filter (where created_at <= ${cutoff61} and created_at > ${cutoff91}), 0) as days_61_to_90
      from allocated group by partner_id
    `.execute(this.db) : { rows: [] };
    const agingBySupplier = new Map(supplierAging.rows.map((row) => [Number(row.partner_id), row]));

    const payables = supplierRows.map((sup) => {
      const balance = Number(sup.balance || 0);
      const aging = agingBySupplier.get(Number(sup.id));
      const current = Number(aging?.current_amount || 0);
      const days31To60 = Number(aging?.days_31_to_60 || 0);
      const days61To90 = Number(aging?.days_61_to_90 || 0);
      const over90 = Math.max(0, balance - current - days31To60 - days61To90);

      return {
        id: String(sup.id),
        name: sup.name || 'مورد',
        phone: sup.phone || '',
        totalBalance: toAgingMoney(balance),
        current: toAgingMoney(current),
        days31To60: toAgingMoney(days31To60),
        days61To90: toAgingMoney(days61To90),
        over90: toAgingMoney(over90),
      };
    });

    const totalReceivables = toAgingMoney(receivables.reduce((sum, r) => sum + r.totalBalance, 0));
    const totalPayables = toAgingMoney(payables.reduce((sum, p) => sum + p.totalBalance, 0));

    const receivablesSummary = {
      total: totalReceivables,
      current: toAgingMoney(receivables.reduce((sum, r) => sum + r.current, 0)),
      days31To60: toAgingMoney(receivables.reduce((sum, r) => sum + r.days31To60, 0)),
      days61To90: toAgingMoney(receivables.reduce((sum, r) => sum + r.days61To90, 0)),
      over90: toAgingMoney(receivables.reduce((sum, r) => sum + r.over90, 0)),
    };

    const payablesSummary = {
      total: totalPayables,
      current: toAgingMoney(payables.reduce((sum, p) => sum + p.current, 0)),
      days31To60: toAgingMoney(payables.reduce((sum, p) => sum + p.days31To60, 0)),
      days61To90: toAgingMoney(payables.reduce((sum, p) => sum + p.days61To90, 0)),
      over90: toAgingMoney(payables.reduce((sum, p) => sum + p.over90, 0)),
    };

    return {
      receivablesSummary,
      payablesSummary,
      receivables,
      payables,
    };
  }

  async demandForecastingReport(auth: AuthContext): Promise<Record<string, unknown>> {
    const tenantId = this.tenantId(auth);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const products = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'barcode', 'stock_qty', 'min_stock_qty', 'cost_price', 'retail_price'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .execute();

    const recentSales = await this.db
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .select([
        'si.product_id',
        sql<number>`SUM(si.qty)`.as('qty_sold_30d'),
        sql<number>`COUNT(DISTINCT s.id)`.as('orders_count_30d'),
      ])
      .where('s.tenant_id', '=', tenantId)
      .where('si.tenant_id', '=', tenantId)
      .where('s.status', '=', 'posted')
      .where('s.created_at', '>=', thirtyDaysAgo)
      .groupBy('si.product_id')
      .execute();

    const salesMap = new Map<number, { qtySold: number; ordersCount: number }>();
    for (const s of recentSales) {
      salesMap.set(Number(s.product_id), {
        qtySold: Number(s.qty_sold_30d || 0),
        ordersCount: Number(s.orders_count_30d || 0),
      });
    }

    const items = products.map((p) => {
      const stock = Number(p.stock_qty || 0);
      const minStock = Number(p.min_stock_qty || 0);
      const saleInfo = salesMap.get(Number(p.id)) || { qtySold: 0, ordersCount: 0 };
      const dailyBurnRate = Number((saleInfo.qtySold / 30).toFixed(2));

      let runwayDays = 999;
      if (dailyBurnRate > 0) {
        runwayDays = Math.max(0, Math.round(stock / dailyBurnRate));
      } else if (stock <= 0) {
        runwayDays = 0;
      }

      let urgency: 'out_of_stock' | 'critical' | 'warning' | 'healthy' | 'overstocked' = 'healthy';
      if (stock <= 0) {
        urgency = 'out_of_stock';
      } else if (runwayDays <= 7 || stock <= minStock) {
        urgency = 'critical';
      } else if (runwayDays <= 15) {
        urgency = 'warning';
      } else if (runwayDays > 60 && stock > 50) {
        urgency = 'overstocked';
      }

      const targetBuffer = (dailyBurnRate * 30) + minStock;
      const suggestedReorderQty = Math.max(0, Math.ceil(targetBuffer - stock));

      return {
        productId: String(p.id),
        name: p.name || '',
        barcode: p.barcode || '',
        sku: '',
        stock,
        minStock,
        costPrice: Number(p.cost_price || 0),
        soldLast30Days: saleInfo.qtySold,
        dailyBurnRate,
        runwayDays: runwayDays > 365 ? 365 : runwayDays,
        urgency,
        suggestedReorderQty,
      };
    });

    items.sort((a, b) => {
      const order = { out_of_stock: 0, critical: 1, warning: 2, healthy: 3, overstocked: 4 };
      if (order[a.urgency] !== order[b.urgency]) {
        return order[a.urgency] - order[b.urgency];
      }
      return a.runwayDays - b.runwayDays;
    });

    const summary = {
      totalMonitoredProducts: items.length,
      outOfStockCount: items.filter((i) => i.urgency === 'out_of_stock').length,
      criticalCount: items.filter((i) => i.urgency === 'critical').length,
      warningCount: items.filter((i) => i.urgency === 'warning').length,
      healthyCount: items.filter((i) => i.urgency === 'healthy').length,
      overstockedCount: items.filter((i) => i.urgency === 'overstocked').length,
    };

    return {
      summary,
      items,
    };
  }

  async deadStockReport(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = this.scope(auth);
    const days = Math.max(7, Math.min(365, Number(query.days || 60)));
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { search, searchPattern, page, pageSize, offset } = buildReportListState(query, 20, { includeRange: false });

    let baseQuery: any = this.db
      .selectFrom('products as p')
      .leftJoin('product_categories as c', 'c.id', 'p.category_id')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .where('p.is_active', '=', true)
      .where(this.tenantPredicate(auth, 'p'));

    if (query.locationId) {
      baseQuery = baseQuery
        .innerJoin('product_location_stock as pls', 'pls.product_id', 'p.id')
        .where('pls.location_id', '=', query.locationId)
        .where('pls.qty', '>', 0);
    } else {
      baseQuery = baseQuery.where('p.stock_qty', '>', 0);
    }

    baseQuery = baseQuery.where(sql<boolean>`NOT EXISTS (
      SELECT 1 FROM sale_items si
      INNER JOIN sales sa ON sa.id = si.sale_id
      WHERE si.product_id = p.id
        AND sa.status = 'posted'
        AND sa.created_at >= ${cutoffDate}
        AND sa.tenant_id = ${scope.tenantId}
    )`);

    if (search) {
      baseQuery = baseQuery.where((eb: any) => eb.or([
        eb(sql`lower(p.name)`, 'like', searchPattern!),
        eb(sql`lower(coalesce(c.name, ''))`, 'like', searchPattern!),
        eb(sql`lower(coalesce(s.name, ''))`, 'like', searchPattern!),
      ]));
    }

    const countRow = await baseQuery.select(sql<number>`count(*)`.as('count')).executeTakeFirst();
    const totalItems = Number((countRow as any)?.count || 0);
    const pagination = buildPagination(page, pageSize, totalItems);

    const stockCol = query.locationId ? sql<number>`coalesce(pls.qty, 0)`.as('stock_qty') : 'p.stock_qty';
    const rows = await baseQuery
      .select([
        'p.id',
        'p.name',
        'p.barcode',
        stockCol,
        'p.cost_price',
        'p.retail_price',
        'c.name as category_name',
        's.name as supplier_name',
        sql<string | null>`(
          SELECT max(sa.created_at) FROM sale_items si
          INNER JOIN sales sa ON sa.id = si.sale_id
          WHERE si.product_id = p.id
            AND sa.status = 'posted'
            AND sa.tenant_id = ${scope.tenantId}
        )`.as('last_sale_date')
      ])
      .orderBy(query.locationId ? 'pls.qty' : 'p.stock_qty', 'desc')
      .orderBy('p.id', 'asc')
      .limit(pageSize)
      .offset(offset)
      .execute();

    const nowMs = Date.now();
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const items = rows.map((r: any) => {
      const stock = Number(r.stock_qty || 0);
      const cost = Number(r.cost_price || 0);
      const tiedCapital = roundMoney(stock * cost, digits);
      const lastSale = r.last_sale_date ? new Date(r.last_sale_date) : null;
      const daysWithoutSale = lastSale
        ? Math.max(0, Math.floor((nowMs - lastSale.getTime()) / (1000 * 60 * 60 * 24)))
        : null;

      return {
        id: Number(r.id),
        name: r.name,
        barcode: r.barcode || '',
        categoryName: r.category_name || 'بدون قسم',
        supplierName: r.supplier_name || 'بدون مورد',
        stock,
        costPrice: cost,
        retailPrice: Number(r.retail_price || 0),
        tiedCapital,
        lastSaleDate: lastSale ? lastSale.toISOString() : null,
        daysWithoutSale,
      };
    });

    const summaryAgg = await baseQuery
      .select([
        sql<number>`coalesce(sum(${query.locationId ? sql`pls.qty` : sql`p.stock_qty`}), 0)`.as('total_qty'),
        sql<number>`coalesce(sum((${query.locationId ? sql`pls.qty` : sql`p.stock_qty`}) * coalesce(p.cost_price, 0)), 0)`.as('total_tied_capital'),
        sql<number>`coalesce(sum((${query.locationId ? sql`pls.qty` : sql`p.stock_qty`}) * coalesce(p.retail_price, 0)), 0)`.as('total_retail_value'),
      ])
      .executeTakeFirst();

    return this.withScope({
      items,
      pagination,
      summary: {
        totalDeadItems: totalItems,
        totalDeadStockQty: Number(Number((summaryAgg as any)?.total_qty || 0).toFixed(2)),
        totalTiedCapital: roundMoney(Number((summaryAgg as any)?.total_tied_capital || 0), digits),
        totalRetailValue: roundMoney(Number((summaryAgg as any)?.total_retail_value || 0), digits),
        daysThreshold: days,
      }
    }, auth);
  }

  async customerRfmReport(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { search, searchPattern } = buildReportListState(query, 50, { includeRange: false });
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, this.tenantId(auth)));

    const twoYearsAgo = new Date();
    twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);

    let baseQuery = (this.db as any)
      .selectFrom('sales as s')
      .innerJoin('customers as c', 'c.id', 's.customer_id')
      .select([
        'c.id as customerId',
        'c.name as customerName',
        'c.phone as customerPhone',
        'c.balance as currentBalance',
        'c.loyalty_points as loyaltyPoints',
        sql<number>`count(s.id)`.as('frequency'),
        sql<number>`coalesce(sum(s.total), 0)`.as('monetary'),
        sql<string>`max(s.created_at)`.as('lastSaleDate'),
      ])
      .where('s.status', '=', 'posted')
      .where('s.created_at', '>=', twoYearsAgo)
      .where(this.tenantPredicate(auth, 's'))
      .where(this.tenantPredicate(auth, 'c'))
      .groupBy(['c.id', 'c.name', 'c.phone', 'c.balance', 'c.loyalty_points']);

    if (search && searchPattern) {
      baseQuery = baseQuery.where((eb: any) => eb.or([
        eb(sql`lower(c.name)`, 'like', searchPattern),
        eb(sql`lower(coalesce(c.phone, ''))`, 'like', searchPattern),
      ]));
    }

    const rows = await baseQuery.limit(500).execute();
    return this.withScope(buildCustomerRfmPayload(rows as any, (query as any).segment, digits), auth);
  }

  private async partnerBalances(type: 'customer' | 'supplier', query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const isCust = type === 'customer';
    const table = isCust ? 'customers' : 'suppliers';
    const ledgerTable = isCust ? 'customer_ledger' : 'supplier_ledger';
    const partnerIdCol = isCust ? 'customer_id' : 'supplier_id';
    const tenantId = this.tenantId(auth);
    const digits = typeof (this.db as any).getExecutor === 'function'
      ? currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId)) : 2;

    if (typeof (this.db as any).getExecutor !== 'function') {
      const partners = await (this.db as any)
        .selectFrom(table)
        .select(isCust ? ['id', 'name', 'phone', 'balance', 'credit_limit'] : ['id', 'name', 'phone', 'balance'])
        .where('is_active', '=', true)
        .where(this.tenantPredicate(auth))
        .orderBy('name', 'asc')
        .execute();

      const ledgerRows = await (this.db as any)
        .selectFrom(ledgerTable)
        .select([partnerIdCol, sql<number>`coalesce(sum(amount), 0)`.as('balance_total')])
        .where(this.tenantPredicate(auth))
        .groupBy(partnerIdCol)
        .execute();

      const totals = isCust
        ? buildCustomerLedgerTotals(ledgerRows as Array<{ customer_id?: number | string | null; balance_total?: number | string | null }>, digits)
        : buildSupplierLedgerTotals(ledgerRows as Array<{ supplier_id?: number | string | null; balance_total?: number | string | null }>, digits);

      const payload = isCust
        ? buildCustomerBalancesPayload(partners, totals, query as Record<string, unknown>, digits)
        : buildSupplierBalancesPayload(partners, totals, query as Record<string, unknown>, digits);

      return this.withScope(payload, auth);
    }

    const { page, pageSize } = buildReportListState(query, 20, { includeRange: false });
    const search = String(query.search || '').trim();
    const filter = String(query.filter || 'all').toLowerCase();
    const creditLimit = isCust ? sql`coalesce(p.credit_limit, 0)` : sql`0::numeric`;
    const balances = sql`
      select p.id, p.name, p.phone, ${creditLimit} as credit_limit,
             coalesce(l.balance_total, p.balance, 0) as balance
      from ${sql.table(table)} p
      left join (
        select ${sql.ref(partnerIdCol)} as partner_id, sum(amount) as balance_total
        from ${sql.table(ledgerTable)} where tenant_id = ${tenantId}
        group by ${sql.ref(partnerIdCol)}
      ) l on l.partner_id = p.id
      where p.tenant_id = ${tenantId} and p.is_active = true
    `;
    const searchClause = search ? sql`and (b.name ilike ${`%${search}%`} or b.phone ilike ${`%${search}%`})` : sql``;
    const filterClause = filter === 'high-balance'
      ? sql`and b.balance >= 1000`
      : isCust && filter === 'over-limit'
        ? sql`and b.credit_limit > 0 and b.balance > b.credit_limit`
        : sql``;
    const filtered = sql`select * from (${balances}) b where b.balance > 0 ${searchClause} ${filterClause}`;
    const summaryResult = await sql<{ total_items: number; total_balance: number; over_limit: number }>`
      select count(*)::int as total_items, coalesce(sum(balance), 0) as total_balance,
             count(*) filter (where credit_limit > 0 and balance > credit_limit)::int as over_limit
      from (${filtered}) f
    `.execute(this.db);
    const summaryRow = summaryResult.rows[0];
    const totalItems = Number(summaryRow?.total_items || 0);
    const pagination = buildPagination(page, pageSize, totalItems);
    const offset = (pagination.page - 1) * pageSize;
    const pageResult = await sql<{ id: number; name: string | null; phone: string | null; balance: number; credit_limit: number }>`
      select id, name, phone, balance, credit_limit from (${filtered}) f
      order by name asc, id asc limit ${pageSize} offset ${offset}
    `.execute(this.db);
    const rows = pageResult.rows.map((row) => {
      const balance = Number(row.balance || 0);
      const base = { id: String(row.id), name: row.name || '', phone: row.phone || '', balance };
      return isCust
        ? { ...base, creditLimit: Number(row.credit_limit || 0), availableCredit: toMoney(Number(row.credit_limit || 0) - balance, digits) }
        : base;
    });
    return this.withScope({
      [isCust ? 'customers' : 'suppliers']: rows,
      pagination,
      summary: {
        totalItems,
        totalBalance: toMoney(summaryRow?.total_balance || 0, digits),
        ...(isCust ? { overLimit: Number(summaryRow?.over_limit || 0) } : {}),
      },
    }, auth);
  }

  private async partnerLedger(type: 'customer' | 'supplier', partnerId: number, query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const isCust = type === 'customer';
    const table = isCust ? 'customers' : 'suppliers';
    const ledgerTable = isCust ? 'customer_ledger' : 'supplier_ledger';
    const partnerIdCol = isCust ? 'customer_id' : 'supplier_id';
    const digits = typeof (this.db as any).getExecutor === 'function'
      ? currencyMoneyDigits(await tenantBaseCurrency(this.db, this.tenantId(auth))) : 2;

    const partner = await (this.db as any)
      .selectFrom(table)
      .select(isCust ? ['id', 'name', 'phone', 'balance', 'credit_limit'] : ['id', 'name', 'phone', 'balance'])
      .where('id', '=', partnerId)
      .where('is_active', '=', true)
      .where(this.tenantPredicate(auth))
      .executeTakeFirst();
    if (!partner) throw new AppError(isCust ? 'Customer not found' : 'Supplier not found', isCust ? 'CUSTOMER_NOT_FOUND' : 'SUPPLIER_NOT_FOUND', 404);

    const { fromDate, toDate, searchPattern, filter, page, pageSize, offset } = buildReportListState(query, 25);

    let countQuery = (this.db as any)
      .selectFrom(ledgerTable)
      .where(partnerIdCol, '=', partnerId)
      .where('created_at', '>=', fromDate!)
      .where('created_at', '<=', toDate!)
      .where(this.tenantPredicate(auth));

    let entriesQuery = (this.db as any)
      .selectFrom(ledgerTable)
      .select(['id', 'entry_type', 'amount', 'balance_after', 'note', 'reference_type', 'reference_id', 'created_at'])
      .where(partnerIdCol, '=', partnerId)
      .where('created_at', '>=', fromDate!)
      .where('created_at', '<=', toDate!)
      .where(this.tenantPredicate(auth));

    countQuery = applySignedAmountFilter(applyPartnerLedgerSearch(countQuery, searchPattern), 'amount', filter);
    entriesQuery = applySignedAmountFilter(applyPartnerLedgerSearch(entriesQuery, searchPattern), 'amount', filter);

    const totalRow = await countQuery.select(sql<number>`count(*)`.as('count')).executeTakeFirst();
    const totalItems = Number((totalRow as { count?: number | string | null } | undefined)?.count || 0);
    const rows = await entriesQuery.orderBy('created_at', 'asc').orderBy('id', 'asc').limit(pageSize).offset(offset).execute();

    const [totalsRow, openingRow] = await Promise.all([
      entriesQuery
        .clearSelect()
        .select([
          sql<number>`coalesce(sum(case when amount > 0 then amount else 0 end), 0)`.as('debits_total'),
          sql<number>`coalesce(sum(case when amount < 0 then amount else 0 end), 0)`.as('credits_total'),
        ])
        .executeTakeFirst(),
      fromDate
        ? (this.db as any)
            .selectFrom(ledgerTable)
            .select(sql<number>`coalesce(sum(amount), 0)`.as('opening_balance'))
            .where(partnerIdCol, '=', partnerId)
            .where('created_at', '<', fromDate)
            .where(this.tenantPredicate(auth))
            .executeTakeFirst()
        : Promise.resolve(null),
    ]);

    const openingBalance = Number(openingRow?.opening_balance || 0);

    const payload = isCust
      ? buildCustomerLedgerPayload({ customer: partner, rows: rows as PartnerLedgerEntryRow[], page, pageSize, totalItems, totalsRow: totalsRow as LedgerSummaryRow | undefined, openingBalance, digits })
      : buildSupplierLedgerPayload({ supplier: partner, rows: rows as PartnerLedgerEntryRow[], page, pageSize, totalItems, totalsRow: totalsRow as LedgerSummaryRow | undefined, openingBalance });

    return this.withScope(payload, auth);
  }

  async customerBalances(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.partnerBalances('customer', query, auth);
  }

  async customerLedger(customerId: number, query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.partnerLedger('customer', customerId, query, auth);
  }

  async supplierBalances(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.partnerBalances('supplier', query, auth);
  }

  async supplierLedger(supplierId: number, query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.partnerLedger('supplier', supplierId, query, auth);
  }
}
