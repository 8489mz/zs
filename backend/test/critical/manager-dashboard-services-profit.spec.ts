/*
 * INV-SERVICES-PROFIT: services revenue counts in dashboard profit.
 *
 * Live defect (test10k audit 2026-11-07): a 75.00 services invoice was
 * inside the sales-report profit (776.51) but outside the dashboard
 * profit (701.51). The sales report adds servicesTotal to revenueTotal
 * before tax/returns/COGS (buildCommercialSummary), while the manager
 * dashboard summed only the `sales` table. This spec drives the real
 * ManagerDashboardService.overview() on PGlite with the same figures
 * (merchandise sale 1000.00, COGS 200.00, expenses 50.00, active
 * services 75.00) and pins profitSummary netSales 1075.00, grossProfit
 * 875.00, netProfit 825.00 — equal to the sales-report commercial
 * figures for the same revenue. An inactive service (100.00) and an
 * out-of-window service (60.00) must stay out, mirroring the
 * sales-report aggregate predicates (is_active + service_date window).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ManagerDashboardService } from '../../src/modules/manager-actions/manager-dashboard.service';
import { buildCommercialSummary } from '../../src/modules/reports/helpers/reports-summary.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 'tenant-a';
const ACCOUNT = 'account-a';

const AUTH = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: [], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const DAY_MS = 24 * 60 * 60 * 1000;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, total numeric, tax_amount numeric DEFAULT 0, status text, created_at timestamptz, prices_include_tax boolean DEFAULT false);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_multiplier numeric, net_line_total numeric, line_total numeric, allocated_discount numeric, allocated_tax numeric, cost_price numeric);
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, total numeric, created_at timestamptz);
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, sale_item_id bigint, product_id bigint, product_name text, qty numeric, unit_multiplier numeric, line_total numeric, allocated_tax numeric, cost_price numeric);
    CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, amount numeric, expense_date timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, total_cost numeric, movement_type text, reason text, created_at timestamptz);
    CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text, name text, amount numeric, notes text, service_date timestamptz, is_active boolean DEFAULT true);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text, category_id bigint, stock_qty numeric, min_stock_qty numeric, cost_price numeric, retail_price numeric, is_active boolean DEFAULT true);
    CREATE TABLE product_categories (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, balance numeric, credit_limit numeric, is_active boolean DEFAULT true);
  `);
  return { pg, db };
}

async function seed(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  const fiveDaysAgo = new Date(Date.now() - 5 * DAY_MS).toISOString();
  const fortyDaysAgo = new Date(Date.now() - 40 * DAY_MS).toISOString();
  await anyDb.insertInto('sales').values([
    { id: 1, tenant_id: TENANT, total: 1000, tax_amount: 0, status: 'posted', created_at: fiveDaysAgo, prices_include_tax: false },
  ]).execute();
  await anyDb.insertInto('sale_items').values([
    { tenant_id: TENANT, sale_id: 1, product_id: 1, product_name: 'A', qty: 2, unit_multiplier: 1, net_line_total: null, line_total: 1000, allocated_discount: 0, allocated_tax: 0, cost_price: 100 },
  ]).execute();
  await anyDb.insertInto('products').values([
    { id: 1, tenant_id: TENANT, name: 'A', category_id: null, stock_qty: 10, min_stock_qty: 0, cost_price: 100, retail_price: 500, is_active: true },
  ]).execute();
  await anyDb.insertInto('expenses').values([
    { id: 1, tenant_id: TENANT, amount: 50, expense_date: fiveDaysAgo },
  ]).execute();
  await anyDb.insertInto('services').values([
    { id: 1, tenant_id: TENANT, name: 'Delivery', amount: 75, notes: '', service_date: fiveDaysAgo, is_active: true },
    { id: 2, tenant_id: TENANT, name: 'Cancelled', amount: 100, notes: '', service_date: fiveDaysAgo, is_active: false },
    { id: 3, tenant_id: TENANT, name: 'Old', amount: 60, notes: '', service_date: fortyDaysAgo, is_active: true },
  ]).execute();
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    await seed(db);
    const service = new ManagerDashboardService(db);
    const overview = await service.overview(AUTH);
    const profit = overview.profitSummary as { netSales: number; cogs: number; grossProfit: number; expenses: number; netProfit: number };

    // The live defect: dashboard profit was 701.51 against the sales
    // report's 776.51 — exactly the 75.00 services invoice missing.
    // Same figures here: merchandise 1000 + services 75, COGS 200,
    // expenses 50.
    assert.equal(profit.netSales, 1075);
    assert.equal(profit.cogs, 200);
    assert.equal(profit.grossProfit, 875);
    assert.equal(profit.expenses, 50);
    assert.equal(profit.netProfit, 825);

    // Merchandise-only figures stay untouched: the sales card still
    // counts invoices, and product profit still counts products only.
    assert.equal((overview.salesLast30 as any).total, 1000);
    assert.equal((overview.profitSources as any).topProducts[0].grossProfit, 800);

    // The sales report must agree with the dashboard for the same
    // revenue: buildCommercialSummary is the report-side profit.
    const commercial = buildCommercialSummary(
      { salesCount: 1, servicesCount: 1, purchasesCount: 0, expensesCount: 1, returnsCount: 0, salesReturnCount: 0, purchaseReturnCount: 0 },
      { salesTotal: 1000, servicesTotal: 75, purchasesTotal: 0, expensesTotal: 50, salesReturnsTotal: 0, purchaseReturnsTotal: 0, salesDiscountsTotal: 0, salesTaxTotal: 0, salesReturnTaxTotal: 0, cashIn: 0, cashOut: 0, cogs: 200 },
    ).commercial;
    assert.equal(commercial.grossProfit, profit.grossProfit);
    assert.equal(commercial.netOperatingProfit, profit.netProfit);
  } finally {
    await db.destroy();
  }

  console.log('manager-dashboard-services-profit.spec: ok');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
