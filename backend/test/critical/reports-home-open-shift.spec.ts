/*
 * INV-HOME-PROFITS-OPEN-SHIFT: the home "today" figures follow the open
 * cashier shift. A clothes client closes at 2am and sells for weeks on
 * one open shift; after the midnight business-day change the home page
 * showed zero after 00:00 because the "today" snapshot kept only rows
 * whose tenant dateKey equals today's key.
 *
 * RULES PINNED HERE, driving the REAL ReportsService.dashboardOverview
 * on PGlite (tenant Africa/Cairo, branch 1 / location 1):
 * 1. An open shift spanning midnight extends "today" back to the shift's
 *    open instant (cashier_shifts.created_at — there is no opened_at
 *    column): a 300 sale from yesterday 22:00 plus 100 + 50 today read
 *    as todaySalesAmount 450, count 3; purchases 70 + 40 read as 110,
 *    count 2; topToday carries the prior-day product (Shirt 400).
 * 2. The 30-day trends stay calendar-day: yesterday's trend point is
 *    300, today's is 150 — the extension never moves a sale's day.
 * 3. A sale from before the shift opened (999, two days ago) is NOT in
 *    "today": the window starts at the shift, not at the dawn of time.
 * 4. A closed shift, or no shift at all, keeps calendar-day behaviour:
 *    todaySalesAmount 150, count 2; purchases 40, count 1.
 * 5. The branch/location filter scopes the shift like the sales: an
 *    open shift on branch 2 does NOT extend a branch-1 view; with no
 *    branch filter the same shift DOES extend (the view covers all
 *    branches then).
 * 6. Pure window rule: null / opened-after-midnight never extends;
 *    opened-before-midnight extends back to the open instant.
 *
 * Prospective only; PGlite only.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { dateKey, getBusinessDayBounds } from '../../src/modules/reports/helpers/reports-range.helper';
import { resolveOpenShiftTodayWindow } from '../../src/modules/reports/helpers/reports-dashboard.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = {
  userId: 1,
  sessionId: 'sess-spec',
  username: 'actor-1',
  role: 'admin',
  permissions: [],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;

const TZ = 'Africa/Cairo';
const HOUR = 60 * 60 * 1000;

type OverviewResult = {
  stats: {
    todaySalesAmount: number;
    todaySalesCount: number;
    todayPurchasesAmount: number;
    todayPurchasesCount: number;
  };
  topToday: Array<{ productId: string; name: string; qty: number; total: number }>;
  trends: { sales: Array<{ key: string; value: number }>; purchases: Array<{ key: string; value: number }> };
};

async function overview(db: Kysely<Database>, query: Record<string, unknown>): Promise<OverviewResult> {
  // A fresh service per call: dashboardOverview caches for 30s per
  // instance, and the cases below mutate the shift between calls.
  const service = new ReportsService(db as never);
  return (await service.dashboardOverview(query as never, AUTH)) as unknown as OverviewResult;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });

  try {
    await pg.exec(`
      CREATE TABLE settings (id bigserial PRIMARY KEY, tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, account_id text, total numeric, tax_amount numeric, discount numeric, delivery_fee numeric, delivery_fee_mode text, delivery_rep_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, status text, paid_amount numeric, store_credit_used numeric, payment_type text, payment_channel text, customer_id bigint);
      CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, total numeric, status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, supplier_id bigint);
      CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text, amount numeric, is_active boolean, service_date timestamptz, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, amount numeric, expense_date timestamptz, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE stock_movements (id bigint PRIMARY KEY, tenant_id text, total_cost numeric, movement_type text, reason text, created_at timestamptz, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz, invoice_id bigint, refund_allocations jsonb);
      CREATE TABLE return_items (id bigint PRIMARY KEY, tenant_id text, return_document_id bigint, sale_item_id bigint, product_id bigint, qty numeric, allocated_tax numeric, cost_price numeric, created_at timestamptz);
      CREATE TABLE treasury_transactions (id bigint PRIMARY KEY, tenant_id text, amount numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz);
      CREATE TABLE sale_items (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, product_id bigint, product_name text, qty numeric, line_total numeric, cost_price numeric, unit_multiplier numeric);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text, retail_price numeric, stock_qty numeric, min_stock_qty numeric, cost_price numeric, is_active boolean, category_id bigint, supplier_id bigint);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean, credit_limit numeric);
      CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean);
      CREATE TABLE customer_ledger (id bigint PRIMARY KEY, tenant_id text, customer_id bigint, amount numeric);
      CREATE TABLE supplier_ledger (id bigint PRIMARY KEY, tenant_id text, supplier_id bigint, amount numeric);
      CREATE TABLE product_offers (id bigint PRIMARY KEY, tenant_id text, is_active boolean, start_date date, end_date date);
      CREATE TABLE sale_payments (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, amount numeric, payment_channel text);
      CREATE TABLE cashier_shifts (id bigint PRIMARY KEY, tenant_id text, account_id text, opened_by bigint, status text, branch_id bigint, location_id bigint, created_at timestamptz, closed_at timestamptz, closed_by bigint, expected_cash numeric, counted_cash numeric);
    `);

    // All instants derive from Cairo midnight today, so the spec holds
    // at any run hour and across the Cairo DST change: todayStart - 2h
    // is always yesterday 22:00 Cairo, todayStart + 10h today 10:00.
    const todayStart = getBusinessDayBounds(new Date(), TZ).start;
    const shiftOpenedAt = new Date(todayStart.getTime() - 3 * HOUR);
    const saleAAt = new Date(todayStart.getTime() - 2 * HOUR);
    const saleBAt = new Date(todayStart.getTime() + 10 * HOUR);
    const saleCAt = new Date(todayStart.getTime() + 11 * HOUR);
    const saleDAt = new Date(todayStart.getTime() - 26 * HOUR);
    const todayKey = dateKey(todayStart, TZ);
    const yesterdayKey = dateKey(saleAAt, TZ);
    const twoDaysAgoKey = dateKey(saleDAt, TZ);
    assert.notEqual(yesterdayKey, todayKey);
    assert.notEqual(twoDaysAgoKey, yesterdayKey);

    await pg.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'timezone', '"${TZ}"'), ('t1', 'currency', 'EGP')`,
    );
    await pg.query(
      `INSERT INTO products (id, tenant_id, name, retail_price, stock_qty, min_stock_qty, cost_price, is_active) VALUES (1, 't1', 'Shirt', 30, 10, 2, 10, true)`,
    );
    await pg.query(`
      INSERT INTO sales (id, tenant_id, account_id, total, tax_amount, discount, delivery_fee, delivery_fee_mode, delivery_rep_id, branch_id, location_id, created_by, created_at, status, paid_amount, store_credit_used, payment_type, payment_channel, customer_id) VALUES
        (1, 't1', 'a1', 300, 0, 0, 0, NULL, NULL, 1, 1, 1, '${saleAAt.toISOString()}', 'posted', 300, 0, 'cash', 'cash', NULL),
        (2, 't1', 'a1', 100, 0, 0, 0, NULL, NULL, 1, 1, 1, '${saleBAt.toISOString()}', 'posted', 100, 0, 'cash', 'cash', NULL),
        (3, 't1', 'a1', 50, 0, 0, 0, NULL, NULL, 1, 1, 1, '${saleCAt.toISOString()}', 'posted', 50, 0, 'cash', 'cash', NULL),
        (4, 't1', 'a1', 999, 0, 0, 0, NULL, NULL, 1, 1, 1, '${saleDAt.toISOString()}', 'posted', 999, 0, 'cash', 'cash', NULL)
    `);
    await pg.query(`
      INSERT INTO purchases (id, tenant_id, total, status, branch_id, location_id, created_by, created_at, supplier_id) VALUES
        (1, 't1', 70, 'posted', 1, 1, 1, '${saleAAt.toISOString()}', NULL),
        (2, 't1', 40, 'posted', 1, 1, 1, '${saleBAt.toISOString()}', NULL)
    `);
    await pg.query(`
      INSERT INTO sale_items (id, tenant_id, sale_id, product_id, product_name, qty, line_total, cost_price, unit_multiplier) VALUES
        (1, 't1', 1, 1, 'Shirt', 2, 300, 10, 1),
        (2, 't1', 2, 1, 'Shirt', 1, 100, 10, 1),
        (3, 't1', 3, 2, 'Pants', 1, 50, 10, 1),
        (4, 't1', 4, 1, 'Shirt', 1, 999, 10, 1)
    `);

    // 1. Open shift spanning midnight: "today" reaches back to the shift.
    await pg.query(
      `INSERT INTO cashier_shifts (id, tenant_id, account_id, opened_by, status, branch_id, location_id, created_at, closed_at, closed_by, expected_cash, counted_cash) VALUES (1, 't1', 'a1', 1, 'open', 1, 1, '${shiftOpenedAt.toISOString()}', NULL, NULL, NULL, NULL)`,
    );
    {
      const result = await overview(db, { branchId: 1, locationId: 1 });
      assert.equal(result.stats.todaySalesAmount, 450, '300 (yesterday 22:00, in shift) + 100 + 50');
      assert.equal(result.stats.todaySalesCount, 3);
      assert.equal(result.stats.todayPurchasesAmount, 110, '70 (yesterday, in shift) + 40');
      assert.equal(result.stats.todayPurchasesCount, 2);
      assert.equal(result.topToday[0]?.name, 'Shirt');
      assert.equal(result.topToday[0]?.total, 400, '300 prior-day + 100 today');
      assert.equal(result.topToday[0]?.qty, 3);
      assert.ok(result.topToday.some((row) => row.name === 'Pants' && row.total === 50));
      // Trends stay calendar-day: the extension never moves a sale's day.
      assert.equal(result.trends.sales.find((p) => p.key === yesterdayKey)?.value, 300);
      assert.equal(result.trends.sales.find((p) => p.key === todayKey)?.value, 150);
      assert.equal(result.trends.sales.find((p) => p.key === twoDaysAgoKey)?.value, 999);
      assert.equal(result.trends.purchases.find((p) => p.key === yesterdayKey)?.value, 70);
      assert.equal(result.trends.purchases.find((p) => p.key === todayKey)?.value, 40);
      console.log(
        '1. open shift spanning midnight extends today (450 / 3, purchases 110 / 2), trends stay calendar-day, passed',
      );
    }

    // 2. The same shift closed: calendar-day behaviour returns.
    await pg.query(`UPDATE cashier_shifts SET status = 'closed', closed_at = NOW(), closed_by = 1 WHERE id = 1`);
    {
      const result = await overview(db, { branchId: 1, locationId: 1 });
      assert.equal(result.stats.todaySalesAmount, 150);
      assert.equal(result.stats.todaySalesCount, 2);
      assert.equal(result.stats.todayPurchasesAmount, 40);
      assert.equal(result.stats.todayPurchasesCount, 1);
      assert.equal(result.topToday[0]?.name, 'Shirt');
      assert.equal(result.topToday[0]?.total, 100);
      console.log('2. closed shift keeps calendar-day figures (150 / 2, purchases 40 / 1), passed');
    }

    // 3. No shift at all: same calendar-day figures.
    await pg.query(`DELETE FROM cashier_shifts WHERE id = 1`);
    {
      const result = await overview(db, { branchId: 1, locationId: 1 });
      assert.equal(result.stats.todaySalesAmount, 150);
      assert.equal(result.stats.todaySalesCount, 2);
      assert.equal(result.stats.todayPurchasesAmount, 40);
      assert.equal(result.stats.todayPurchasesCount, 1);
      console.log('3. no shift keeps calendar-day figures, passed');
    }

    // 4. An open shift on another branch does NOT extend a branch-1 view;
    //    with no branch filter the same shift DOES extend (whole-tenant view).
    await pg.query(
      `INSERT INTO cashier_shifts (id, tenant_id, account_id, opened_by, status, branch_id, location_id, created_at, closed_at, closed_by, expected_cash, counted_cash) VALUES (2, 't1', 'a1', 1, 'open', 2, 1, '${shiftOpenedAt.toISOString()}', NULL, NULL, NULL, NULL)`,
    );
    {
      const scoped = await overview(db, { branchId: 1, locationId: 1 });
      assert.equal(scoped.stats.todaySalesAmount, 150, 'branch-2 shift must not extend a branch-1 view');
      assert.equal(scoped.stats.todaySalesCount, 2);
      const unscoped = await overview(db, {});
      assert.equal(
        unscoped.stats.todaySalesAmount,
        450,
        'no branch filter: the open shift extends the whole-tenant view',
      );
      assert.equal(unscoped.stats.todaySalesCount, 3);
      console.log('4. other-branch shift does not extend a scoped view but extends the unscoped view, passed');
    }

    // 5. Pure window rule.
    {
      const bounds = getBusinessDayBounds(new Date(), TZ);
      assert.deepEqual(resolveOpenShiftTodayWindow(bounds, null), {
        start: bounds.start,
        end: bounds.end,
        extended: false,
      });
      assert.deepEqual(
        resolveOpenShiftTodayWindow(bounds, new Date(bounds.start.getTime() + HOUR)),
        { start: bounds.start, end: bounds.end, extended: false },
        'a shift opened after midnight does not extend',
      );
      const opened = new Date(bounds.start.getTime() - 3 * HOUR);
      assert.deepEqual(resolveOpenShiftTodayWindow(bounds, opened), { start: opened, end: bounds.end, extended: true });
      console.log('5. pure window rule (null / after-midnight / before-midnight), passed');
    }

    // 6. This spec is wired into both critical lists, in identical order
    // (363 specs — the purchases-writer spec is the last entry).
    {
      const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 370);
      assert.equal(chain.length, 370);
      assert.deepEqual(chain, specs);
      assert.ok(specs.includes('test/critical/reports-home-open-shift.spec.ts'));
      console.log('6. evidence spec wired into both critical lists (370 = 370, identical order), passed');
    }

    console.log('reports-home-open-shift: all cases passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
