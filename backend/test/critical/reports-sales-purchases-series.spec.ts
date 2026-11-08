/*
 * INV-REPORTS-REAL-SALES-PURCHASES-SERIES: the /reports/overview
 * sales-purchases trend chart must be drawn from real invoice totals,
 * never from the period total split by fixed ratios.
 *
 * The chart removed 2026-10-22 (d48d5cf) built its points as
 * netSales * 0.2 / 0.25 / 0.3 / 0.25 per week and similar fixed
 * shares per month — a beautiful curve that invented the shape of
 * the period. This spec drives the real service on PGlite and pins
 * the replacement: one point per calendar day of the selected range
 * (one per month when the range is longer than 92 days), every
 * bucket present even when zero, each point computed with exactly
 * the same netting as the card totals, and the points summing
 * exactly to those totals.
 *
 * Worked fixture (April 2026, UTC business days):
 *   sales posted 04-01 1000.00 (tax 100) + services 75.00
 *     -> day sales 975.00
 *   sales posted 04-02 500.00 (tax 50, discount 20 already in the
 *     total) + sale return 80.00 (return tax 8.00)
 *     -> day sales (500 - 50) - (80 - 8) = 378.00
 *   services 04-03 120.00 -> day sales 120.00
 *   sales posted 04-04 300.00 + sale return 40.00 (no return items)
 *     -> day sales 300 - 40 = 260.00
 *   purchases posted 04-01 700.00, 04-03 200.00, purchase return
 *     04-03 50.00 -> day purchases 700.00 / 0 / 150.00 / 0.
 *   Draft documents, inactive services, other-tenant rows and
 *   out-of-range rows must not move any point.
 * Totals: netSales 1733.00, netPurchases 850.00.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { combineSalesPurchasesSeries } from '../../src/modules/reports/helpers/reports-series.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 'tenant-a';
const ACCOUNT = 'account-a';

const AUTH = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: [], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, total numeric, tax_amount numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, delivery_rep_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, status text);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, status text);
    CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text, account_id text, amount numeric, branch_id bigint, location_id bigint, created_by bigint, service_date timestamptz, is_active boolean DEFAULT true);
    CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, account_id text, amount numeric, branch_id bigint, location_id bigint, created_by bigint, expense_date timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, total_cost numeric, movement_type text, reason text, created_at timestamptz);
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, account_id text, return_type text, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz);
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, sale_item_id bigint, product_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, amount numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, product_id bigint, product_name text, qty numeric, line_total numeric, cost_price numeric);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, cost_price numeric);
  `);
  return { pg, db };
}

async function seed(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('sales').values([
    { id: 1, tenant_id: TENANT, account_id: ACCOUNT, total: 1000, tax_amount: 100, discount: 0, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-01T10:00:00.000Z', status: 'posted' },
    { id: 2, tenant_id: TENANT, account_id: ACCOUNT, total: 500, tax_amount: 50, discount: 20, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-02T10:00:00.000Z', status: 'posted' },
    { id: 3, tenant_id: TENANT, account_id: ACCOUNT, total: 300, tax_amount: 0, discount: 0, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-04T10:00:00.000Z', status: 'posted' },
    // Must not move any point: draft, other tenant, out of range.
    { id: 4, tenant_id: TENANT, account_id: ACCOUNT, total: 999, tax_amount: 0, discount: 0, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-02T10:00:00.000Z', status: 'draft' },
    { id: 5, tenant_id: 'tenant-b', account_id: ACCOUNT, total: 9999, tax_amount: 0, discount: 0, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-01T10:00:00.000Z', status: 'posted' },
    { id: 6, tenant_id: TENANT, account_id: ACCOUNT, total: 888, tax_amount: 0, discount: 0, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-06-02T10:00:00.000Z', status: 'posted' },
  ]).execute();
  await anyDb.insertInto('services').values([
    { id: 1, tenant_id: TENANT, account_id: ACCOUNT, amount: 75, branch_id: 1, location_id: 1, created_by: 1, service_date: '2026-04-01T10:00:00.000Z', is_active: true },
    { id: 2, tenant_id: TENANT, account_id: ACCOUNT, amount: 120, branch_id: 1, location_id: 1, created_by: 1, service_date: '2026-04-03T10:00:00.000Z', is_active: true },
    { id: 3, tenant_id: TENANT, account_id: ACCOUNT, amount: 999, branch_id: 1, location_id: 1, created_by: 1, service_date: '2026-04-02T10:00:00.000Z', is_active: false },
  ]).execute();
  await anyDb.insertInto('purchases').values([
    { id: 1, tenant_id: TENANT, account_id: ACCOUNT, total: 700, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-01T10:00:00.000Z', status: 'posted' },
    { id: 2, tenant_id: TENANT, account_id: ACCOUNT, total: 200, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-03T10:00:00.000Z', status: 'posted' },
    { id: 3, tenant_id: TENANT, account_id: ACCOUNT, total: 999, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-02T10:00:00.000Z', status: 'draft' },
  ]).execute();
  await anyDb.insertInto('return_documents').values([
    { id: 1, tenant_id: TENANT, account_id: ACCOUNT, return_type: 'sale', total: 80, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-02T10:00:00.000Z' },
    { id: 2, tenant_id: TENANT, account_id: ACCOUNT, return_type: 'sale', total: 40, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-04T10:00:00.000Z' },
    { id: 3, tenant_id: TENANT, account_id: ACCOUNT, return_type: 'purchase', total: 50, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-03T10:00:00.000Z' },
  ]).execute();
  await anyDb.insertInto('return_items').values([
    { tenant_id: TENANT, return_document_id: 1, sale_item_id: null, product_id: 1, qty: 1, cost_price: 0, allocated_tax: 8 },
  ]).execute();
}

function sum(points: Array<{ sales: number; purchases: number }>, key: 'sales' | 'purchases'): number {
  return points.reduce((total, point) => total + point[key], 0);
}

async function main(): Promise<void> {
  // The remainder rule, pinned on the pure combiner: three days of
  // 0.125 each round to 0.13 per day (sum 0.39) while the control
  // total rounds to 0.38, so the -0.01 drift lands on the last
  // non-zero day and the points still sum exactly to the total.
  const remainderPoints = combineSalesPurchasesSeries({
    buckets: ['2026-04-01', '2026-04-02', '2026-04-03'],
    granularity: 'day',
    dayComponents: ['2026-04-01', '2026-04-02', '2026-04-03'].map((bucket) => ({
      bucket, salesTotal: 0.125, salesTax: 0, servicesTotal: 0,
      saleReturns: 0, saleReturnTax: 0, purchasesTotal: 0, purchaseReturns: 0,
    })),
    netSalesTotal: 0.38,
    netPurchasesTotal: 0,
  });
  assert.deepEqual(remainderPoints.map((point) => point.sales), [0.13, 0.13, 0.12]);
  assert.equal(sum(remainderPoints, 'sales'), 0.38);
  assert.equal(sum(remainderPoints, 'purchases'), 0);

  const { pg, db } = await makeDb();
  try {
    await seed(db);
    const service = new ReportsService(db);

    // Daily series over the 30-day April range.
    const april = await service.reportSummary(
      { from: '2026-04-01T00:00:00.000Z', to: '2026-04-30T23:59:59.999Z' },
      AUTH,
    );
    // The card totals are unchanged by this package.
    assert.equal((april.sales as any).netSales, 1733);
    assert.equal((april.purchases as any).netPurchases, 850);
    const daily = (april as any).salesPurchasesSeries;
    assert.equal(daily.granularity, 'day');
    assert.equal(daily.points.length, 30);
    assert.deepEqual(daily.points[0], { date: '2026-04-01', sales: 975, purchases: 700 });
    assert.deepEqual(daily.points[1], { date: '2026-04-02', sales: 378, purchases: 0 });
    assert.deepEqual(daily.points[2], { date: '2026-04-03', sales: 120, purchases: 150 });
    assert.deepEqual(daily.points[3], { date: '2026-04-04', sales: 260, purchases: 0 });
    // Every bucket is present, even a zero day.
    assert.deepEqual(daily.points[4], { date: '2026-04-05', sales: 0, purchases: 0 });
    assert.deepEqual(daily.points[29], { date: '2026-04-30', sales: 0, purchases: 0 });
    // The series sums exactly to the card totals.
    assert.equal(sum(daily.points, 'sales'), (april.sales as any).netSales);
    assert.equal(sum(daily.points, 'purchases'), (april.purchases as any).netPurchases);

    // Monthly series over a 151-day range: same rows, same totals.
    const longRange = await service.reportSummary(
      { from: '2026-01-01T00:00:00.000Z', to: '2026-05-31T23:59:59.999Z' },
      AUTH,
    );
    assert.equal((longRange.sales as any).netSales, 1733);
    assert.equal((longRange.purchases as any).netPurchases, 850);
    const monthly = (longRange as any).salesPurchasesSeries;
    assert.equal(monthly.granularity, 'month');
    assert.equal(monthly.points.length, 5);
    assert.deepEqual(monthly.points[0], { date: '2026-01', sales: 0, purchases: 0 });
    assert.deepEqual(monthly.points[3], { date: '2026-04', sales: 1733, purchases: 850 });
    assert.deepEqual(monthly.points[4], { date: '2026-05', sales: 0, purchases: 0 });
    assert.equal(sum(monthly.points, 'sales'), (longRange.sales as any).netSales);
    assert.equal(sum(monthly.points, 'purchases'), (longRange.purchases as any).netPurchases);
  } finally {
    await db.destroy();
  }

  console.log('reports-sales-purchases-series.spec: ok');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
