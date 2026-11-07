/*
 * INV-CI-REPAIR: reports-summary aggregate path on real SQL.
 *
 * The FakeDb-backed reports-financial-summary.spec.ts exercises only
 * the row-evaluation fallback of reportSummary (its FakeQuery has no
 * groupBy). The production path on PostgreSQL runs the eleven SQL
 * aggregates in buildReportSummaryAggregates (reports-summary.helper.ts)
 * instead. This spec drives that aggregate path on PGlite with the
 * same fixture figures (sales returns 80.00 + invoice discounts 20.00
 * = card 100.00; the 50.00 purchase return stays out of the card) so
 * a regression in the extracted aggregate — e.g. dropping the
 * sales_discounts_total select — fails here.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ReportsService } from '../../src/modules/reports/reports.service';
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
    { id: 1, tenant_id: TENANT, account_id: ACCOUNT, total: 1000, tax_amount: 0, discount: 0, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-01T10:00:00.000Z', status: 'posted' },
    { id: 2, tenant_id: TENANT, account_id: ACCOUNT, total: 500, tax_amount: 0, discount: 20, delivery_fee: 0, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-02T10:00:00.000Z', status: 'posted' },
  ]).execute();
  await anyDb.insertInto('purchases').values([
    { id: 1, tenant_id: TENANT, account_id: ACCOUNT, total: 700, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-01T10:00:00.000Z', status: 'posted' },
  ]).execute();
  await anyDb.insertInto('expenses').values([
    { id: 1, tenant_id: TENANT, account_id: ACCOUNT, amount: 120, branch_id: 1, location_id: 1, created_by: 1, expense_date: '2026-04-03T10:00:00.000Z' },
    { id: 2, tenant_id: TENANT, account_id: ACCOUNT, amount: 30, branch_id: 1, location_id: 1, created_by: 1, expense_date: '2026-04-04T10:00:00.000Z' },
  ]).execute();
  await anyDb.insertInto('return_documents').values([
    { id: 1, tenant_id: TENANT, account_id: ACCOUNT, return_type: 'sale', total: 80, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-03T10:00:00.000Z' },
    { id: 2, tenant_id: TENANT, account_id: ACCOUNT, return_type: 'purchase', total: 50, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-04T10:00:00.000Z' },
  ]).execute();
  await anyDb.insertInto('treasury_transactions').values([
    { tenant_id: TENANT, account_id: ACCOUNT, amount: 1000, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-01T10:00:00.000Z' },
    { tenant_id: TENANT, account_id: ACCOUNT, amount: -150, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-03T10:00:00.000Z' },
    { tenant_id: TENANT, account_id: ACCOUNT, amount: -50, branch_id: 1, location_id: 1, created_by: 1, created_at: '2026-04-04T10:00:00.000Z' },
  ]).execute();
  await anyDb.insertInto('sale_items').values([
    { tenant_id: TENANT, sale_id: 1, product_id: 1, product_name: 'A', qty: 2, line_total: 400, cost_price: 100 },
    { tenant_id: TENANT, sale_id: 2, product_id: 2, product_name: 'B', qty: 1, line_total: 300, cost_price: 150 },
  ]).execute();
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    await seed(db);
    const service = new ReportsService(db);
    const summary = await service.reportSummary(
      { from: '2026-04-01T00:00:00.000Z', to: '2026-04-30T23:59:59.999Z' },
      AUTH,
    );

    assert.equal((summary.sales as any).total, 1500);
    assert.equal((summary.sales as any).netSales, 1420);
    assert.equal((summary.purchases as any).total, 700);
    assert.equal((summary.purchases as any).netPurchases, 650);
    assert.equal((summary.expenses as any).total, 150);
    assert.equal((summary.expenses as any).count, 2);
    // INV-SALES-REPORT-RETURNS-CARD via the SQL aggregate path: the card
    // is sales returns (80) + sales discounts (20) = 100. The 50.00
    // purchase return must not enter it; it stays visible only as
    // returns.purchasesTotal.
    assert.equal((summary.returns as any).total, 100);
    assert.equal((summary.returns as any).salesTotal, 80);
    assert.equal((summary.returns as any).discountsTotal, 20);
    assert.equal((summary.returns as any).purchasesTotal, 50);
    assert.equal((summary.returns as any).salesCount, 1);
    assert.equal((summary.returns as any).purchasesCount, 1);
    assert.equal((summary.commercial as any).cogs, 350);
    assert.equal((summary.commercial as any).grossProfit, 1070);
    assert.equal((summary.commercial as any).netOperatingProfit, 920);
    assert.equal((summary.treasury as any).cashIn, 1000);
    assert.equal((summary.treasury as any).cashOut, 200);
    assert.equal((summary.treasury as any).net, 800);
  } finally {
    await db.destroy();
  }

  console.log('reports-summary-aggregate.spec: ok');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
