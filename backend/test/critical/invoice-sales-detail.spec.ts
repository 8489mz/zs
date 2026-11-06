/* Sales invoice detail (INV-SALES-INVOICE-DETAIL-PAYMENT): getSaleById
 * must expose the sale's payment channel (so the detail card can name
 * the channel instead of guessing from paymentType) and the returns
 * linked to the invoice (return_documents with return_type 'sale' and
 * invoice_id = the sale, tenant-scoped). A return of another tenant or
 * a purchase return on the same invoice id must never leak in. Drives
 * the REAL SalesQueryService.getSaleById on PGlite.
 */
import assert from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';

const TENANT = 't1';
const ACTOR: any = {
  userId: 1,
  sessionId: 's1',
  username: 'admin',
  role: 'super_admin',
  permissions: [],
  tenantId: TENANT,
  accountId: 'a1',
};

async function main() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  try {
    await sql`CREATE TABLE sales (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, doc_no TEXT, customer_id INTEGER, customer_name TEXT, customer_phone TEXT, customer_address TEXT, payment_type TEXT, payment_channel TEXT, subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, discount NUMERIC(14,2) NOT NULL DEFAULT 0, tax_rate NUMERIC(14,2) NOT NULL DEFAULT 0, tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0, prices_include_tax BOOLEAN NOT NULL DEFAULT false, total NUMERIC(14,2) NOT NULL DEFAULT 0, paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0, tendered_amount NUMERIC(14,2) NOT NULL DEFAULT 0, change_amount NUMERIC(14,2) NOT NULL DEFAULT 0, store_credit_used NUMERIC(14,2) NOT NULL DEFAULT 0, delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'posted', note TEXT, table_number TEXT, order_type TEXT, branch_id INTEGER, location_id INTEGER, created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), delivery_rep_id INTEGER)`.execute(db);
    await sql`CREATE TABLE customers (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT, phone TEXT, address TEXT)`.execute(db);
    await sql`CREATE TABLE branches (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT)`.execute(db);
    await sql`CREATE TABLE stock_locations (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT)`.execute(db);
    await sql`CREATE TABLE users (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, username TEXT)`.execute(db);
    await sql`CREATE TABLE delivery_representatives (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT)`.execute(db);
    await sql`CREATE TABLE sale_items (id SERIAL PRIMARY KEY, sale_id INTEGER NOT NULL, tenant_id TEXT NOT NULL, product_id INTEGER, product_name TEXT, product_name_en TEXT, qty NUMERIC(14,3) NOT NULL DEFAULT 0, unit_price NUMERIC(14,2) NOT NULL DEFAULT 0, line_total NUMERIC(14,2) NOT NULL DEFAULT 0, net_line_total NUMERIC(14,2), allocated_tax NUMERIC(14,2), unit_name TEXT, unit_multiplier NUMERIC(14,3) NOT NULL DEFAULT 1, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0, price_type TEXT, modifiers TEXT, serials TEXT)`.execute(db);
    await sql`CREATE TABLE sale_payments (id SERIAL PRIMARY KEY, sale_id INTEGER NOT NULL, tenant_id TEXT NOT NULL, payment_channel TEXT, amount NUMERIC(14,2) NOT NULL DEFAULT 0)`.execute(db);
    await sql`CREATE TABLE return_documents (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, doc_no TEXT, return_type TEXT, invoice_id INTEGER, settlement_mode TEXT, refund_method TEXT, total NUMERIC(14,2) NOT NULL DEFAULT 0, note TEXT, branch_id INTEGER, location_id INTEGER, created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`.execute(db);

    await sql`INSERT INTO users (id, tenant_id, username) VALUES (1, ${TENANT}, ${'cashier1'})`.execute(db);
    await sql`INSERT INTO sales (id, tenant_id, doc_no, payment_type, payment_channel, subtotal, total, paid_amount, tendered_amount, status, order_type, created_by) VALUES (1, ${TENANT}, ${'Z-261105-16304'}, ${'cash'}, ${'card'}, 100, 100, 100, 100, ${'posted'}, ${'takeaway'}, 1), (2, ${TENANT}, ${'Z-261105-16305'}, ${'cash'}, ${'cash'}, 50, 50, 50, 50, ${'posted'}, ${'takeaway'}, 1)`.execute(db);
    await sql`INSERT INTO sale_items (sale_id, tenant_id, product_id, product_name, qty, unit_price, line_total) VALUES (1, ${TENANT}, 10, ${'صنف تجريبي'}, 1, 100, 100)`.execute(db);
    await sql`INSERT INTO sale_payments (sale_id, tenant_id, payment_channel, amount) VALUES (1, ${TENANT}, ${'card'}, 100)`.execute(db);
    await sql`INSERT INTO return_documents (id, tenant_id, doc_no, return_type, invoice_id, settlement_mode, refund_method, total) VALUES (1, ${TENANT}, ${'ZR-261106-0001'}, ${'sale'}, 1, ${'refund'}, ${'cash'}, 25.50), (2, ${TENANT}, ${'ZR-261106-0002'}, ${'sale'}, 2, ${'refund'}, ${'cash'}, 10.00), (3, ${'t2'}, ${'ZR-261106-0003'}, ${'sale'}, 1, ${'refund'}, ${'cash'}, 99.00), (4, ${TENANT}, ${'ZR-261106-0004'}, ${'purchase'}, 1, ${'refund'}, ${'cash'}, 77.00)`.execute(db);

    const service = new SalesQueryService(db as never, new SalesAuthorizationService(db as never));

    const r1 = (await service.getSaleById(1, ACTOR)) as any;
    const s1 = r1.sale;
    assert.equal(s1.paymentType, 'cash', 'paymentType passes through');
    assert.equal(s1.paymentChannel, 'card', 'paymentChannel must be exposed so the card can name the channel');
    assert.ok(Array.isArray(s1.linkedReturns), 'getSaleById must expose linkedReturns');
    assert.equal(s1.linkedReturns.length, 1, 'exactly the one sale return of this tenant links to invoice 1');
    assert.equal(s1.linkedReturns[0].docNo, 'ZR-261106-0001', 'linked return carries its doc number');
    assert.equal(s1.linkedReturns[0].total, 25.5, 'linked return carries its total');

    const r2 = (await service.getSaleById(2, ACTOR)) as any;
    assert.equal(r2.sale.linkedReturns.length, 1, 'invoice 2 links its own return');
    assert.equal(r2.sale.linkedReturns[0].docNo, 'ZR-261106-0002', 'invoice 2 must not see invoice 1 returns');

    console.log('invoice-sales-detail backend checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
