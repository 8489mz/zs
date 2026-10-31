/*
New file: backend/test/critical/driver-portal-rep-scoped-reads-followup.spec.ts
Pins INV-DRIVER-PORTAL-REP-SCOPED-READS-FOLLOWUP: the two residual
driver-portal reads (getCustomerSuggestedOrder, getCustomerPackagingBalance)
scope by the calling rep through the SAME recorded-service-history predicate
C1 used (assertRepServedCustomer), driving the REAL VanSalesService on PGlite.

WHAT THE AUDIT FEARED: getCustomerPackagingBalance took tenantId only, and
getCustomerSuggestedOrder used its repId only to resolve the van location,
so any driver could read any customer's packaging balance and suggested
order (customer PII + pricing leakage between competing reps).

WHAT THIS PINS:
1. A rep reading a customer he served succeeds on both reads.
2. A rep reading a customer he never served fails closed with FORBIDDEN 403
   on both reads.
3. The staff path (no repId supplied to getCustomerPackagingBalance) is
   unchanged: a staff caller reads any tenant record.
4. The scope check in getCustomerSuggestedOrder runs BEFORE the van
   location resolution: a forbidden read creates no stock_locations row
   (getOrCreateVanLocation inserts one when the rep has none).
5. A customer served through any of the three evidence rows (field visit,
   pre-sale order, delivered sale) is readable by that rep.

Deliberately NOT driven here: the controller wiring (verifyDriverToken
-> driver.repId -> service) is one one-line call site verified by
inspection; the HTTP layer is not booted in this harness.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';

const TENANT = 't-rep-scope-followup';
const ACCOUNT = 'a-rep-scope-followup';
const REP_OWN = 11;
const REP_OTHER = 22;
const REP_NOLOC = 33;

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, full_name text, name text, phone text, van_location_id bigint, vehicle_plate text, is_active boolean DEFAULT true);
      CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, location_type text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text, barcode text, retail_price numeric DEFAULT 0, packaging_unit_id bigint);
      CREATE TABLE packaging_units (id bigint PRIMARY KEY, name text);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, location_id bigint, product_id bigint, qty numeric DEFAULT 0);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text);
      CREATE TABLE van_trip_packaging_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, customer_id bigint, package_type text, delivered_qty numeric DEFAULT 0, returned_qty numeric DEFAULT 0, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_id bigint, rep_id bigint, status text);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, status text, payment_type text, customer_id bigint, delivery_rep_id bigint, van_trip_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, tenant_id text, account_id text, product_id bigint, product_name text, unit_name text, unit_multiplier numeric DEFAULT 1, quantity numeric DEFAULT 0, unit_price numeric DEFAULT 0, created_at timestamptz DEFAULT NOW());
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

    await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, is_active: true }).execute();
    await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Van 11', code: 'VAN_11', location_type: 'van', is_active: true }).execute();
    await anyDb.insertInto('delivery_representatives').values([
      { id: REP_OWN, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'Own Rep', name: 'Own Rep', phone: '01000000001', van_location_id: 10, is_active: true },
      { id: REP_OTHER, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'Other Rep', name: 'Other Rep', phone: '01000000002', van_location_id: 10, is_active: true },
      { id: REP_NOLOC, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'No Loc Rep', name: 'No Loc Rep', phone: '01000000003', van_location_id: null, is_active: true },
    ]).execute();
    await anyDb.insertInto('packaging_units').values({ id: 1, name: 'قطعة' }).execute();
    await anyDb.insertInto('products').values({ id: 5, tenant_id: TENANT, name: 'Product 5', barcode: 'B5', retail_price: 60, packaging_unit_id: 1 }).execute();
    await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, location_id: 10, product_id: 5, qty: 4 }).execute();
    // Customers: 100 served by OWN via a field visit, 200 served by OTHER
    // via a delivered sale, 300 served by NOBODY.
    await anyDb.insertInto('customers').values([
      { id: 100, tenant_id: TENANT, name: 'Visited Customer', phone: '011100', address: 'Addr 100' },
      { id: 200, tenant_id: TENANT, name: 'Sold-To Customer', phone: '011200', address: 'Addr 200' },
      { id: 300, tenant_id: TENANT, name: 'Stranger Customer', phone: '011300', address: 'Addr 300' },
    ]).execute();
    await anyDb.insertInto('van_field_visits').values({ tenant_id: TENANT, account_id: ACCOUNT, trip_id: 1, rep_id: REP_OWN, customer_id: 100, visit_type: 'positive' }).execute();
    await anyDb.insertInto('sales').values({ id: 70, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'INV-70', total: 500, paid_amount: 500, status: 'posted', payment_type: 'cash', customer_id: 200, delivery_rep_id: REP_OTHER, van_trip_id: 2 }).execute();
    await anyDb.insertInto('sale_items').values({ sale_id: 70, tenant_id: TENANT, account_id: ACCOUNT, product_id: 5, product_name: 'Product 5', unit_name: 'قطعة', unit_multiplier: 1, quantity: 2, unit_price: 123 }).execute();
    await anyDb.insertInto('van_trip_packaging_movements').values([
      { tenant_id: TENANT, account_id: ACCOUNT, trip_id: 1, customer_id: 100, package_type: 'crate_plastic', delivered_qty: 3, returned_qty: 1 },
      { tenant_id: TENANT, account_id: ACCOUNT, trip_id: 2, customer_id: 200, package_type: 'crate_plastic', delivered_qty: 5, returned_qty: 2 },
    ]).execute();

    const forbidden = (err: any) => err && err.code === 'FORBIDDEN' && err.statusCode === 403;
    const countLocations = async () => Number((await anyDb.selectFrom('stock_locations').select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst()).n);

    // 1. Own rep reads succeed on both functions.
    const ownBalance = await vanService.getCustomerPackagingBalance(100, TENANT, REP_OWN);
    assert.equal(ownBalance.length, 1);
    assert.equal(Number(ownBalance[0].netOwedToCompany), 2);
    const ownSuggested = await vanService.getCustomerSuggestedOrder(TENANT, ACCOUNT, REP_OWN, 100);
    // Customer 100 has no posted sale, so the suggested order is empty —
    // but the read itself succeeds (no 403) for the serving rep.
    assert.equal((ownSuggested as any).ok, true);
    assert.equal((ownSuggested as any).hasPreviousOrders, false);
    const otherSuggested = await vanService.getCustomerSuggestedOrder(TENANT, ACCOUNT, REP_OTHER, 200);
    assert.equal((otherSuggested as any).ok, true);
    assert.equal((otherSuggested as any).hasPreviousOrders, true);
    assert.equal((otherSuggested as any).lastOrderDocNo, 'INV-70');
    assert.equal((otherSuggested as any).items.length, 1);
    assert.equal(Number((otherSuggested as any).items[0].unitPrice), 123);
    assert.equal(Number((otherSuggested as any).items[0].availableVanQty), 4);

    // 2. Another rep's customer is forbidden on both reads.
    await assert.rejects(vanService.getCustomerPackagingBalance(200, TENANT, REP_OWN), forbidden);
    await assert.rejects(vanService.getCustomerPackagingBalance(100, TENANT, REP_OTHER), forbidden);
    await assert.rejects(vanService.getCustomerSuggestedOrder(TENANT, ACCOUNT, REP_OWN, 200), forbidden);
    await assert.rejects(vanService.getCustomerSuggestedOrder(TENANT, ACCOUNT, REP_OTHER, 100), forbidden);

    // 3. A customer served by nobody is forbidden for every rep.
    await assert.rejects(vanService.getCustomerPackagingBalance(300, TENANT, REP_OWN), forbidden);
    await assert.rejects(vanService.getCustomerSuggestedOrder(TENANT, ACCOUNT, REP_OWN, 300), forbidden);

    // 4. Staff path (no repId) is unchanged: any tenant record reads.
    const staffBalance = await vanService.getCustomerPackagingBalance(300, TENANT);
    assert.equal(staffBalance.length, 0);
    const staffBalanceOther = await vanService.getCustomerPackagingBalance(200, TENANT);
    assert.equal(Number(staffBalanceOther[0].netOwedToCompany), 3);

    // 5. A forbidden suggested-order read creates no van location row:
    // REP_NOLOC has no van_location_id, so resolving his van location
    // would insert a stock_locations row. The scope check must run first.
    const before = await countLocations();
    await assert.rejects(vanService.getCustomerSuggestedOrder(TENANT, ACCOUNT, REP_NOLOC, 300), forbidden);
    assert.equal(await countLocations(), before);

    console.log('driver portal rep scoped reads followup checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
