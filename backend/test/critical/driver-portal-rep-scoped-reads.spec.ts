/*
New file: backend/test/critical/driver-portal-rep-scoped-reads.spec.ts
Pins INV-DRIVER-PORTAL-REP-SCOPED-READS: the six driver-portal read
functions scope by the calling rep, driving the REAL VanSalesService and
VanPreSalesService on PGlite.

WHAT THE AUDIT FEARED: the driver-portal reads took tenantId only and
dropped the caller's repId at the controller boundary, so any driver
could read another rep's pre-sale orders, trip swaps, trip expenses,
trip packaging movements, and any customer's field statement and last
sold prices (customer PII + pricing leakage between competing reps).

WHAT THIS PINS:
1. A rep reading his OWN pre-sale order, trip data, and a customer he
   served succeeds exactly as before.
2. A rep reading ANOTHER rep's order / trip swaps / trip expenses /
   trip packaging fails closed with FORBIDDEN 403.
3. A rep reading a customer he never served (no field visit, no
   pre-sale order, no delivered sale) gets FORBIDDEN 403 on the field
   statement and on last sold prices.
4. A customer served through any of the three evidence rows (field
   visit, pre-sale order, delivered sale) is readable by that rep.
5. The staff path (no repId supplied) is unchanged: a staff caller
   reads any tenant record, which is the supervisor view behind a
   staff session, not a driver token.
6. A missing trip fails closed with TRIP_NOT_FOUND 404 on the
   rep-scoped path instead of returning empty lists.

Deliberately NOT driven here: the controller wiring (verifyDriverToken
-> driver.repId -> service) is six one-line call sites verified by
inspection; the HTTP layer is not booted in this harness.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanPreSalesService } from '../../src/modules/delivery-reps/services/van-pre-sales.service';

const TENANT = 't-rep-scope';
const ACCOUNT = 'a-rep-scope';
const REP_OWN = 11;
const REP_OTHER = 22;

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, full_name text, name text, phone text, is_active boolean DEFAULT true);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, location_type text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, customer_type text DEFAULT 'cash', metadata text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text);
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_id bigint, customer_name text, customer_phone text, customer_address text, rep_id bigint, warehouse_location_id bigint, order_source text, payment_terms text, subtotal numeric DEFAULT 0, discount_amount numeric DEFAULT 0, total_amount numeric DEFAULT 0, status text, supervisor_approved_at timestamptz, supervisor_approved_by bigint, supervisor_rejection_reason text, notes text, delivery_date date, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, sales_order_id bigint, tenant_id text, account_id text, product_id bigint, product_name text, unit_name text, unit_multiplier numeric DEFAULT 1, quantity numeric DEFAULT 0, reserved_quantity numeric DEFAULT 0, unit_price numeric DEFAULT 0, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric DEFAULT 0, discount numeric DEFAULT 0, total numeric DEFAULT 0);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text);
      CREATE TABLE van_damaged_swaps (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, damaged_product_id bigint, replacement_product_id bigint, damaged_qty numeric DEFAULT 0, damage_reason text, replacement_qty numeric DEFAULT 0, price_difference numeric DEFAULT 0, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, expense_type text, amount numeric DEFAULT 0, notes text, receipt_photo_url text, created_by_user_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_trip_packaging_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, customer_id bigint, package_type text, delivered_qty numeric DEFAULT 0, returned_qty numeric DEFAULT 0, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, status text, payment_type text, customer_id bigint, delivery_rep_id bigint, van_trip_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, tenant_id text, account_id text, product_id bigint, unit_price numeric DEFAULT 0, created_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric DEFAULT 0, note text, transfer_reference text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, entry_type text, amount numeric DEFAULT 0, note text, created_at timestamptz DEFAULT NOW());
    `);

    const postingStub = {
      postSale: async () => undefined,
      clearPostingFailure: async () => undefined,
      postVanStockTransfer: async () => undefined,
    };
    const vanService = new VanSalesService(db, {} as never, {} as never, postingStub as never);
    // Harness note: resolveSystemAuthContext reads the pool (this.db), not
    // the transaction. On real Postgres that is a second pooled connection;
    // on PGlite's single-connection dialect it deadlocks the transaction
    // that calls it. The posting collaborator is stubbed, so the auth
    // context value is never consumed; shadow it for the harness only.
    (vanService as any).resolveSystemAuthContext = async () => ({ userId: 1, sessionId: 'spec', username: 'spec' });
    const preSalesService = new VanPreSalesService(db as never);

    await anyDb.insertInto('delivery_representatives').values([
      { id: REP_OWN, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'Own Rep', name: 'Own Rep', phone: '01000000001', is_active: true },
      { id: REP_OTHER, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'Other Rep', name: 'Other Rep', phone: '01000000002', is_active: true },
    ]).execute();
    await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'Main', location_type: 'internal_warehouse', is_active: true }).execute();
    await anyDb.insertInto('products').values({ id: 5, tenant_id: TENANT, name: 'Product 5' }).execute();
    await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, display_name: 'Sys', username: 'sys' }).execute();
    // Customers: 100 served by OWN via a field visit, 200 served by OTHER
    // via a delivered sale, 300 served by NOBODY.
    await anyDb.insertInto('customers').values([
      { id: 100, tenant_id: TENANT, name: 'Visited Customer', phone: '011100', address: 'Addr 100', balance: 50, credit_limit: 100, metadata: null },
      { id: 200, tenant_id: TENANT, name: 'Sold-To Customer', phone: '011200', address: 'Addr 200', balance: 0, credit_limit: 0, metadata: null },
      { id: 300, tenant_id: TENANT, name: 'Stranger Customer', phone: '011300', address: 'Addr 300', balance: 999, credit_limit: 500, metadata: null },
    ]).execute();

    // Trips: 1 belongs to OWN, 2 belongs to OTHER.
    await anyDb.insertInto('van_sales_trips').values([
      { id: 1, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_OWN, van_location_id: 10, source_warehouse_id: 10, status: 'open', settlement_status: 'open' },
      { id: 2, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_OTHER, van_location_id: 10, source_warehouse_id: 10, status: 'open', settlement_status: 'open' },
    ]).execute();
    await anyDb.insertInto('van_field_visits').values({ tenant_id: TENANT, account_id: ACCOUNT, trip_id: 1, rep_id: REP_OWN, customer_id: 100, visit_type: 'positive' }).execute();
    await anyDb.insertInto('van_damaged_swaps').values({ tenant_id: TENANT, account_id: ACCOUNT, trip_id: 2, rep_id: REP_OTHER, customer_id: 200, damaged_product_id: 5, replacement_product_id: 5, damaged_qty: 1, replacement_qty: 1, price_difference: 7 }).execute();
    await anyDb.insertInto('van_trip_expenses').values({ tenant_id: TENANT, account_id: ACCOUNT, trip_id: 2, expense_type: 'fuel', amount: 42, created_by_user_id: 1 }).execute();
    await anyDb.insertInto('van_trip_packaging_movements').values({ tenant_id: TENANT, account_id: ACCOUNT, trip_id: 2, customer_id: 200, package_type: 'crate_plastic', delivered_qty: 3, returned_qty: 1 }).execute();

    // Pre-sale orders: 50 belongs to OWN (customer 100), 51 to OTHER.
    await anyDb.insertInto('sales_orders').values([
      { id: 50, tenant_id: TENANT, account_id: ACCOUNT, order_number: 'SO-50', customer_id: 100, customer_name: 'Visited Customer', customer_phone: '011100', customer_address: 'Addr 100', rep_id: REP_OWN, warehouse_location_id: 10, status: 'pending', subtotal: 100, total_amount: 100 },
      { id: 51, tenant_id: TENANT, account_id: ACCOUNT, order_number: 'SO-51', customer_id: 200, customer_name: 'Sold-To Customer', customer_phone: '011200', customer_address: 'Addr 200', rep_id: REP_OTHER, warehouse_location_id: 10, status: 'pending', subtotal: 200, total_amount: 200 },
    ]).execute();
    await anyDb.insertInto('sales_order_items').values({ sales_order_id: 50, tenant_id: TENANT, account_id: ACCOUNT, product_id: 5, product_name: 'Product 5', quantity: 2, unit_price: 50, total: 100 }).execute();

    // Delivered sale by OTHER to customer 200 (evidence row for OTHER).
    await anyDb.insertInto('sales').values({ id: 70, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'INV-70', total: 500, paid_amount: 500, status: 'posted', payment_type: 'cash', customer_id: 200, delivery_rep_id: REP_OTHER, van_trip_id: 2 }).execute();
    await anyDb.insertInto('sale_items').values({ sale_id: 70, tenant_id: TENANT, account_id: ACCOUNT, product_id: 5, unit_price: 123 }).execute();

    const forbidden = (err: any) => err && err.code === 'FORBIDDEN' && err.statusCode === 403;

    // 1. Own order reads succeed.
    const ownOrder = await preSalesService.getPreSalesOrderDetails(50, TENANT, REP_OWN);
    assert.equal(Number((ownOrder as any).id), 50);
    assert.equal((ownOrder as any).items.length, 1);

    // 2. Another rep's order is forbidden.
    await assert.rejects(preSalesService.getPreSalesOrderDetails(51, TENANT, REP_OWN), forbidden);
    await assert.rejects(preSalesService.getPreSalesOrderDetails(50, TENANT, REP_OTHER), forbidden);

    // 3. Own trip reads succeed; another rep's trip reads are forbidden.
    const ownSwaps = await vanService.listTripDamagedSwaps(TENANT, 1, REP_OWN);
    assert.equal(ownSwaps.length, 0);
    await assert.rejects(vanService.listTripDamagedSwaps(TENANT, 2, REP_OWN), forbidden);
    const ownExpenses = await vanService.getTripExpenses(1, TENANT, REP_OWN);
    assert.equal(ownExpenses.expenses.length, 0);
    await assert.rejects(vanService.getTripExpenses(2, TENANT, REP_OWN), forbidden);
    const ownPackaging = await vanService.getTripPackagingMovements(1, TENANT, REP_OWN);
    assert.equal(ownPackaging.length, 0);
    await assert.rejects(vanService.getTripPackagingMovements(2, TENANT, REP_OWN), forbidden);

    // 4. Missing trip fails closed on the rep-scoped path.
    await assert.rejects(
      vanService.getTripExpenses(999, TENANT, REP_OWN),
      (err: any) => err && err.code === 'TRIP_NOT_FOUND' && err.statusCode === 404,
    );

    // 5. Served customers readable; unserved customer forbidden.
    const statement = await vanService.getCustomerFieldStatement(TENANT, 100, REP_OWN);
    assert.equal(Number((statement as any).customer.id), 100);
    assert.equal(Number((statement as any).customer.balance), 50);
    const prices = await vanService.getCustomerLastSoldPrices(TENANT, 200, REP_OTHER);
    assert.equal(Number((prices as any).lastPrices[5].lastPrice), 123);
    await assert.rejects(vanService.getCustomerFieldStatement(TENANT, 300, REP_OWN), forbidden);
    await assert.rejects(vanService.getCustomerFieldStatement(TENANT, 200, REP_OWN), forbidden);
    await assert.rejects(vanService.getCustomerLastSoldPrices(TENANT, 300, REP_OWN), forbidden);
    await assert.rejects(vanService.getCustomerLastSoldPrices(TENANT, 100, REP_OTHER), forbidden);

    // 6. Staff path (no repId) is unchanged: any tenant record reads.
    const staffOrder = await preSalesService.getPreSalesOrderDetails(51, TENANT);
    assert.equal(Number((staffOrder as any).id), 51);
    const staffExpenses = await vanService.getTripExpenses(2, TENANT);
    assert.equal(staffExpenses.expenses.length, 1);
    const staffStatement = await vanService.getCustomerFieldStatement(TENANT, 300);
    assert.equal(Number((staffStatement as any).customer.balance), 999);
    const staffPrices = await vanService.getCustomerLastSoldPrices(TENANT, 200);
    assert.equal(Number((staffPrices as any).lastPrices[5].lastPrice), 123);

    console.log('driver portal rep scoped reads checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
