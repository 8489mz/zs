import { strict as assert } from 'node:assert';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { dateKey } from '../../src/modules/reports/helpers/reports-range.helper';

// PO-2 (PERFORMANCE_CONSTITUTION.md §5): dashboardOverview used to fetch every active
// product/customer/supplier for the tenant as a plain row list and reduce over them in JS — one
// query per table, one shape, which this file's FakeDb could fake convincingly. It is now a set of
// SQL aggregates (COUNT/SUM, some FILTER'd, some joined against a per-partner ledger subquery), and
// the SAME table is queried more than once with DIFFERENT result shapes (products: a single
// aggregate row, then a top-8 list; customers: a count, a credit-limit-boundary count, a top-5 list).
// A table-name-keyed FakeDb cannot tell those calls apart, so it cannot fake real aggregate/JOIN
// arithmetic here without becoming a small SQL engine. That correctness burden moved to
// test/e2e/dashboard-overview-aggregates.e2e.ts, which runs the real query against real Postgres
// inside a rolled-back transaction with edge cases (zero stock, zero min-stock threshold, inactive
// rows, near/above credit-limit boundaries) and is the authority for those numbers.
// What THIS file still verifies for real: today's sales/purchases trends and today-operations math,
// which are untouched by the PO-2 migration and still computed from a single, unambiguous query per
// table (`sales`, `purchases`, `product_offers`, `sale_items as si`).

type RowMap = Record<string, unknown[]>;

class FakeQuery {
  constructor(private readonly rows: unknown[]) {}
  select(): this {
    return this;
  }
  where(): this {
    return this;
  }
  innerJoin(): this {
    return this;
  }
  leftJoin(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  groupBy(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  $if(condition: boolean, callback: (qb: this) => this): this {
    return condition ? callback(this) : this;
  }
  execute(): Promise<unknown[]> {
    return Promise.resolve(this.rows);
  }
  executeTakeFirst(): Promise<unknown> {
    return Promise.resolve(this.rows[0]);
  }
  executeTakeFirstOrThrow(): Promise<unknown> {
    // The real aggregate queries always return exactly one row (COUNT/SUM with no GROUP BY never
    // return zero rows, even over an empty table) — a canned row with sane zero defaults keeps the
    // service's Number(...) calls from producing NaN, without pretending to fake the real arithmetic.
    return Promise.resolve(
      this.rows[0] ?? {
        n: 0,
        total: 0,
        near: 0,
        above: 0,
        products_count: 0,
        low_stock_count: 0,
        out_of_stock_count: 0,
        inventory_cost: 0,
        inventory_sale_value: 0,
      },
    );
  }
}

class FakeDb {
  constructor(private readonly data: RowMap) {}
  selectFrom(table: string): FakeQuery {
    return new FakeQuery(this.data[table] || []);
  }
  getExecutor(): any {
    return {
      transformQuery: (node: unknown) => node,
      compileQuery: () => ({ sql: '', parameters: [] }),
      executeQuery: async () => ({ rows: [{ cash: 0, card: 0, online: 0, credit: 0 }] }),
    };
  }
}

(async () => {
  // The service resolves the tenant timezone from settings; this FakeDb
  // has no settings row, so it resolves the canonical fallback
  // (env BUSINESS_TIMEZONE, else Africa/Cairo) — the expected keys below
  // must use that same zone.
  const businessTimezone = process.env.BUSINESS_TIMEZONE || 'Africa/Cairo';

  const today = new Date();
  today.setUTCHours(10, 0, 0, 0);
  const oneDayAgo = new Date(today);
  oneDayAgo.setUTCDate(oneDayAgo.getUTCDate() - 1);
  const thirtyFiveDaysAgo = new Date(today);
  thirtyFiveDaysAgo.setUTCDate(thirtyFiveDaysAgo.getUTCDate() - 35);

  const service = new ReportsService(
    new FakeDb({
      sales: [
        { id: 1, total: 100, branch_id: 1, location_id: 1, created_at: today.toISOString() },
        { id: 2, total: 50, branch_id: 1, location_id: 1, created_at: oneDayAgo.toISOString() },
        { id: 3, total: 999, branch_id: 1, location_id: 1, created_at: thirtyFiveDaysAgo.toISOString() },
      ],
      purchases: [{ id: 1, total: 80, branch_id: 1, location_id: 1, created_at: today.toISOString() }],
      expenses: [],
      return_documents: [],
      treasury_transactions: [],
      product_offers: [{ id: 1, start_date: null, end_date: null }],
      'sale_items as si': [
        {
          product_id: 1,
          product_name: 'A',
          qty: 2,
          line_total: 20,
          cost_price: 4,
          qty_total: 2,
          sales_total: 20,
          branch_id: 1,
          location_id: 1,
          created_at: today.toISOString(),
        },
      ],
    }) as never,
  );

  const result = await service.dashboardOverview({ branchId: 1, locationId: 1 }, {
    tenantId: 'tenant-a',
    accountId: 'account-a',
  } as never);
  const trends = (result.trends as any).sales as Array<{ key: string; value: number }>;
  const todayKey = dateKey(today, businessTimezone);
  const oneDayAgoKey = dateKey(oneDayAgo, businessTimezone);
  const thirtyFiveDaysAgoKey = dateKey(thirtyFiveDaysAgo, businessTimezone);

  assert.equal(trends.find((item) => item.key === todayKey)?.value, 100);
  assert.equal(trends.find((item) => item.key === oneDayAgoKey)?.value, 50);
  assert.equal(
    trends.some((item) => item.key === thirtyFiveDaysAgoKey),
    false,
  );
  assert.equal((result.stats as any).todaySalesAmount, 100);
  assert.equal((result.summary as any).activeOffers, 1);
  assert.equal(((result.topToday as any[]) || [])[0]?.total, 20);

  // Not a crash, and every PO-2 aggregate field is at least present as a finite number — the exact
  // arithmetic is verified in test/e2e/dashboard-overview-aggregates.e2e.ts, not here (see file header).
  for (const field of [
    'productsCount',
    'customersCount',
    'suppliersCount',
    'inventoryCost',
    'inventorySaleValue',
    'customerDebt',
    'supplierDebt',
    'nearCreditLimit',
    'aboveCreditLimit',
    'highSupplierBalances',
  ]) {
    const value = (result.stats as Record<string, unknown>)[field];
    assert.equal(
      Number.isFinite(Number(value)),
      true,
      `stats.${field} must be a finite number, got ${JSON.stringify(value)}`,
    );
  }
  assert.ok(Array.isArray(result.lowStock), 'lowStock must be an array');
  assert.ok(Array.isArray(result.topCustomers), 'topCustomers must be an array');
  assert.ok(Array.isArray(result.topSuppliers), 'topSuppliers must be an array');

  console.log('reports-dashboard-trends.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
