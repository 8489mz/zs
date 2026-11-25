/*
New file: backend/test/critical/van-sales-list-date-filter.spec.ts
Pins INV-VAN-SALES-LIST-DATE-FILTER, driving the real SalesQueryService
+ ReportsService on PGlite.

WHAT THE AUDIT FEARED: the sales list had no date filter at all, and
every range helper in the codebase silently dropped the last day — a
bare `to` passed through parseRange as midnight UTC. A supervisor
filtering "today" saw nothing from today, and a mistyped date returned
everything with no error.

WHAT THIS PINS, driving the real listSales / repSupplierSummary:
1. A filter for one tenant day returns exactly that day's invoices.
2. An offline sale made Monday and synced Friday shows on its SALE
   day (created_at, P2 semantics), never on its sync day.
3. A bare `to` date includes the WHOLE `to` day (the parseRange trap).
4. `from` after `to` and garbage bounds are 400 INVALID_DATE_RANGE.
5. Summary totals follow the filter (filtered total != unfiltered).
6. The combined report returns sales grouped by rep + purchases
   grouped by supplier in one response, both bounded by the same range.
7. No-date call keeps the existing unfiltered behavior.
*/
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { ReportsService } from '../../src/modules/reports/reports.service';

const TENANT = 't-van-date-filter';
const ACCOUNT = 'a-van-date-filter';
const AUTH: any = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'super_admin',
  permissions: ['sales', 'reports'],
  tenantId: TENANT,
  accountId: ACCOUNT,
};

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, display_name text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text);
      CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, status text, note text, table_number text, order_type text, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, collection_status text, delivery_status text, delivery_fee_mode text, received_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric, net_line_total numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, price_type text, modifiers text, serials text, tenant_id text, account_id text);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, tenant_id text, account_id text);
      CREATE TABLE return_documents (id bigserial PRIMARY KEY, doc_no text, invoice_id bigint, total numeric, return_type text, settlement_mode text, refund_method text, created_at timestamptz DEFAULT NOW(), tenant_id text, account_id text);
      CREATE TABLE purchases (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, total numeric DEFAULT 0, status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    `);

    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'timezone', value: 'Africa/Cairo' }).execute();
    await anyDb
      .insertInto('currency_exchange_rates')
      .values({ tenant_id: TENANT, currency_code: 'EGP', is_base: true, exchange_rate: 1 })
      .execute();
    await anyDb
      .insertInto('delivery_representatives')
      .values([
        { id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep One' },
        { id: 2, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep Two' },
      ])
      .execute();
    await anyDb
      .insertInto('suppliers')
      .values([
        { id: 1, tenant_id: TENANT, name: 'Supplier One' },
        { id: 2, tenant_id: TENANT, name: 'Supplier Two' },
      ])
      .execute();

    const queryService = new SalesQueryService(db, new SalesAuthorizationService(db));
    const reportsService = new ReportsService(db);

    async function seedSale(
      docNo: string,
      total: number,
      createdAtUtc: string,
      repId: number | null,
      receivedAtUtc?: string,
    ): Promise<number> {
      const row = await anyDb
        .insertInto('sales')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          doc_no: docNo,
          total,
          subtotal: total,
          status: 'posted',
          payment_type: 'cash',
          payment_channel: 'cash',
          delivery_rep_id: repId,
          created_at: createdAtUtc,
          received_at: receivedAtUtc || null,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      return Number(row.id);
    }

    // Three sales on three tenant days (10:00 Cairo = 08:00Z) + one
    // offline sale made Monday 2026-11-09, synced Friday 2026-11-13.
    const saleA = await seedSale('Z-A', 100, '2026-11-10T08:00:00Z', 1);
    const saleB = await seedSale('Z-B', 200, '2026-11-11T08:00:00Z', 1);
    const saleC = await seedSale('Z-C', 300, '2026-11-12T08:00:00Z', 2);
    const saleD = await seedSale('Z-D', 400, '2026-11-09T08:00:00Z', 1, '2026-11-13T13:00:00Z');
    await anyDb
      .insertInto('purchases')
      .values([
        {
          tenant_id: TENANT,
          account_id: ACCOUNT,
          supplier_id: 1,
          total: 500,
          status: 'posted',
          created_at: '2026-11-10T08:00:00Z',
        },
        {
          tenant_id: TENANT,
          account_id: ACCOUNT,
          supplier_id: 2,
          total: 700,
          status: 'posted',
          created_at: '2026-11-12T08:00:00Z',
        },
        {
          tenant_id: TENANT,
          account_id: ACCOUNT,
          supplier_id: 1,
          total: 50,
          status: 'posted',
          created_at: '2026-11-13T08:00:00Z',
        },
      ])
      .execute();

    const docNos = (res: any): string[] => (res.sales as any[]).map((s: any) => s.docNo).sort();

    // (a) one tenant day returns exactly that day's invoice.
    const middle = await queryService.listSales({ from: '2026-11-11', to: '2026-11-11' }, AUTH);
    assert.deepEqual(docNos(middle), ['Z-B']);
    assert.equal((middle.pagination as any).totalItems, 1);

    // (b) offline sale shows on its SALE day (Monday), never its sync day (Friday).
    const monday = await queryService.listSales({ from: '2026-11-09', to: '2026-11-09' }, AUTH);
    assert.deepEqual(docNos(monday), ['Z-D']);
    const friday = await queryService.listSales({ from: '2026-11-13', to: '2026-11-13' }, AUTH);
    assert.deepEqual(docNos(friday), []);

    // (c) a bare `to` date includes the WHOLE `to` day (parseRange trap).
    const through12 = await queryService.listSales({ from: '2026-11-10', to: '2026-11-12' }, AUTH);
    assert.deepEqual(docNos(through12), ['Z-A', 'Z-B', 'Z-C']);
    const only12 = await queryService.listSales({ from: '2026-11-12', to: '2026-11-12' }, AUTH);
    assert.deepEqual(docNos(only12), ['Z-C']);

    // (d) from after to is a 400, not a silent empty/full answer.
    await assert.rejects(
      queryService.listSales({ from: '2026-11-12', to: '2026-11-10' }, AUTH),
      (err: any) => err && err.code === 'INVALID_DATE_RANGE' && err.statusCode === 400,
    );

    // (e) garbage bounds are a 400, not a silent full-range answer.
    await assert.rejects(
      queryService.listSales({ from: 'not-a-date', to: '2026-11-12' }, AUTH),
      (err: any) => err && err.code === 'INVALID_DATE_RANGE' && err.statusCode === 400,
    );

    // (f) summary totals follow the filter.
    assert.equal(Number((middle.summary as any).totalSales), 200);
    const unfiltered = await queryService.listSales({}, AUTH);
    assert.equal(Number((unfiltered.summary as any).totalSales), 1000);
    assert.equal((unfiltered.pagination as any).totalItems, 4);

    // (g) combined report: sales by rep + purchases by supplier, one
    // response, same range — the 11-13 purchase stays outside it.
    const combined = (await reportsService.repSupplierSummary({ from: '2026-11-10', to: '2026-11-12' }, AUTH)) as any;
    assert.equal(String(combined.from).slice(0, 10), '2026-11-09');
    assert.ok(String(combined.from).includes('22:00:00'), 'from is the tenant-midnight instant (22:00Z)');
    const byRep = new Map<number, any>(combined.salesByRep.map((r: any) => [r.repId, r] as [number, any]));
    assert.equal(byRep.get(1).salesCount, 2);
    assert.equal(Number(byRep.get(1).totalAmount), 300);
    assert.equal(byRep.get(2).salesCount, 1);
    assert.equal(Number(byRep.get(2).totalAmount), 300);
    const bySup = new Map<number, any>(
      combined.purchasesBySupplier.map((r: any) => [r.supplierId, r] as [number, any]),
    );
    assert.equal(bySup.get(1).purchasesCount, 1);
    assert.equal(Number(bySup.get(1).totalAmount), 500);
    assert.equal(bySup.get(2).purchasesCount, 1);
    assert.equal(Number(bySup.get(2).totalAmount), 700);
    assert.equal(Number(combined.totals.salesTotal), 600);
    assert.equal(Number(combined.totals.purchasesTotal), 1200);

    // (h) no-date call keeps the existing unfiltered behavior.
    assert.deepEqual(docNos(unfiltered), ['Z-A', 'Z-B', 'Z-C', 'Z-D']);
    assert.ok([saleA, saleB, saleC, saleD].every((id) => id > 0));
    console.log('van sales-list date filter checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
