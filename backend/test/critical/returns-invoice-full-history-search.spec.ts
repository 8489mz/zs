/* Returns full-history invoice search (INV-RETURNS-FULL-HISTORY-SEARCH):
 * the returns dialog's invoice picker loads only the latest 30 sales
 * (GET /api/sales, default pageSize=30, id DESC), so an older invoice
 * is unreachable from the dialog. The backend already searches by
 * doc_no (listSales({ search }) — doc_no ILIKE, tenant-scoped); the
 * frontend fix relies on that search to fetch the old invoice on
 * demand. This spec PINS that behaviour on the REAL
 * SalesQueryService.listSales on PGlite: page 1 holds 30 and excludes
 * the old invoice; search '16455' and the full doc number each return
 * exactly it (with its lines); a same-docNo sale of another tenant
 * never leaks in.
 */
import assert from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';

const TENANT = 't1';
const OLD_DOC_NO = 'Z-261115-16455';
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
    await sql`CREATE TABLE sales (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, doc_no TEXT, customer_id INTEGER, customer_name TEXT, customer_phone TEXT, customer_address TEXT, payment_type TEXT, payment_channel TEXT, subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, discount NUMERIC(14,2) NOT NULL DEFAULT 0, tax_rate NUMERIC(14,2) NOT NULL DEFAULT 0, tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0, prices_include_tax BOOLEAN NOT NULL DEFAULT false, total NUMERIC(14,2) NOT NULL DEFAULT 0, paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0, tendered_amount NUMERIC(14,2) NOT NULL DEFAULT 0, change_amount NUMERIC(14,2) NOT NULL DEFAULT 0, store_credit_used NUMERIC(14,2) NOT NULL DEFAULT 0, delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'posted', note TEXT, table_number TEXT, order_type TEXT, branch_id INTEGER, location_id INTEGER, created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), delivery_rep_id INTEGER, collection_status TEXT, delivery_status TEXT, delivery_fee_mode TEXT)`.execute(
      db,
    );
    await sql`CREATE TABLE customers (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT, phone TEXT, address TEXT)`.execute(
      db,
    );
    await sql`CREATE TABLE branches (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT)`.execute(db);
    await sql`CREATE TABLE stock_locations (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT)`.execute(db);
    await sql`CREATE TABLE users (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, username TEXT)`.execute(db);
    await sql`CREATE TABLE delivery_representatives (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT)`.execute(
      db,
    );
    await sql`CREATE TABLE sale_items (id SERIAL PRIMARY KEY, sale_id INTEGER NOT NULL, tenant_id TEXT NOT NULL, product_id INTEGER, product_name TEXT, product_name_en TEXT, qty NUMERIC(14,3) NOT NULL DEFAULT 0, unit_price NUMERIC(14,2) NOT NULL DEFAULT 0, line_total NUMERIC(14,2) NOT NULL DEFAULT 0, line_discount NUMERIC(14,2), net_line_total NUMERIC(14,2), allocated_tax NUMERIC(14,2), unit_name TEXT, unit_multiplier NUMERIC(14,3) NOT NULL DEFAULT 1, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0, price_type TEXT, modifiers TEXT, serials TEXT)`.execute(
      db,
    );
    await sql`CREATE TABLE sale_payments (id SERIAL PRIMARY KEY, sale_id INTEGER NOT NULL, tenant_id TEXT NOT NULL, payment_channel TEXT, amount NUMERIC(14,2) NOT NULL DEFAULT 0)`.execute(
      db,
    );
    await sql`CREATE TABLE return_documents (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, doc_no TEXT, return_type TEXT, invoice_id INTEGER, settlement_mode TEXT, refund_method TEXT, total NUMERIC(14,2) NOT NULL DEFAULT 0, note TEXT, branch_id INTEGER, location_id INTEGER, created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`.execute(
      db,
    );
    await sql`CREATE TABLE settings (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT)`.execute(
      db,
    );
    await sql`CREATE TABLE currency_exchange_rates (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, currency_code TEXT NOT NULL, exchange_rate NUMERIC(14,6) NOT NULL DEFAULT 1, is_base BOOLEAN NOT NULL DEFAULT false)`.execute(
      db,
    );

    await sql`INSERT INTO users (id, tenant_id, username) VALUES (1, ${TENANT}, ${'cashier1'})`.execute(db);
    // 35 posted sales: id 1 is the old invoice, ids 2..35 are newer.
    // The newer doc numbers never contain '16455' as a substring.
    await sql`INSERT INTO sales (id, tenant_id, doc_no, payment_type, payment_channel, subtotal, total, paid_amount, tendered_amount, status, order_type, created_by) VALUES (1, ${TENANT}, ${OLD_DOC_NO}, ${'cash'}, ${'cash'}, 100, 100, 100, 100, ${'posted'}, ${'takeaway'}, 1)`.execute(
      db,
    );
    for (let i = 2; i <= 35; i += 1) {
      const docNo = `Z-261116-${10000 + i - 1}`;
      await sql`INSERT INTO sales (id, tenant_id, doc_no, payment_type, payment_channel, subtotal, total, paid_amount, tendered_amount, status, order_type, created_by) VALUES (${i}, ${TENANT}, ${docNo}, ${'cash'}, ${'cash'}, 10, 10, 10, 10, ${'posted'}, ${'takeaway'}, 1)`.execute(
        db,
      );
    }
    // Same doc number, another tenant: must never leak into t1 results.
    await sql`INSERT INTO sales (id, tenant_id, doc_no, payment_type, payment_channel, subtotal, total, paid_amount, tendered_amount, status, order_type, created_by) VALUES (100, ${'t2'}, ${OLD_DOC_NO}, ${'cash'}, ${'cash'}, 999, 999, 999, 999, ${'posted'}, ${'takeaway'}, 1)`.execute(
      db,
    );
    await sql`INSERT INTO sale_items (sale_id, tenant_id, product_id, product_name, qty, unit_price, line_total) VALUES (1, ${TENANT}, 10, ${'صنف قديم'}, 2, 50, 100)`.execute(
      db,
    );

    const service = new SalesQueryService(db as never, new SalesAuthorizationService(db as never));

    const page1 = (await service.listSales({}, ACTOR)) as any;
    assert.equal(page1.sales.length, 30, 'page 1 holds the backend default of 30 sales');
    assert.equal(
      page1.pagination.totalItems,
      35,
      '35 posted sales of this tenant in total (the other tenant excluded)',
    );
    assert.ok(
      !page1.sales.some((s: any) => s.docNo === OLD_DOC_NO),
      'the old invoice is beyond the first page and unreachable from the latest-30 list',
    );

    const byFragment = (await service.listSales({ search: '16455' }, ACTOR)) as any;
    assert.equal(byFragment.sales.length, 1, 'fragment search returns exactly the old invoice');
    assert.equal(byFragment.sales[0].docNo, OLD_DOC_NO, 'fragment search finds the old invoice by its number');
    assert.equal(byFragment.sales[0].id, '1', 'fragment search returns the t1 invoice, not the other tenant copy');
    assert.equal(byFragment.sales[0].items.length, 1, 'the found invoice carries its lines for the return dialog');

    const byFull = (await service.listSales({ search: OLD_DOC_NO }, ACTOR)) as any;
    assert.equal(byFull.sales.length, 1, 'full doc-number search returns exactly one invoice');
    assert.equal(byFull.sales[0].docNo, OLD_DOC_NO, 'full doc-number search finds the old invoice');
    assert.equal(
      byFull.sales[0].id,
      '1',
      'full doc-number search never returns the other tenant sale with the same doc number',
    );

    console.log('returns-invoice-full-history-search backend checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
