/*
 * New file: backend/test/critical/van-trip-locked-state-recheck.spec.ts
 *
 * WHAT THIS PINS (INV-VAN-TRIP-LOCKED-STATE-RECHECK): seven places read
 * the governing state on an unlocked handle and never re-checked it
 * under lock inside the write transaction, so a trip settled (or a
 * requisition dispatched, an order converted, a shortage pushed)
 * between the pre-check and the commit still went through. Every fix
 * below follows the one pattern settleTrip / settleRepFinancialItem
 * already use correctly: re-read the governing row FOR UPDATE as the
 * first statement of the transaction, and flip it with a status
 * predicate checked against the affected rows.
 *
 * WHAT IS DRIVEN (real PGlite, real service methods — no mocks except
 * the two seams the production code itself owns: a stubbed
 * postVanTripSettlement for the settle test, and a stubbed
 * SalesService.createSale for the conversion test):
 * (a) a field sale on a trip settled mid-flight is rejected INVALID_TRIP;
 * (b) a field collection on a trip settled mid-flight is rejected INVALID_TRIP;
 * (c) settleTrip re-reads expenses + collected cash inside the transaction
 *     (an expense posted mid-flight changes expectedCash);
 * (d) two open trips for one rep are impossible — migration 0314's partial
 *     unique index rejects the second insert, and openTripAndLoad refuses
 *     the second open;
 * (e) markRequisitionDispatched twice: the second call fails ALREADY_DISPATCHED;
 * (f) convertPreSalesOrderToInvoice twice / on a 'converting' order / on a
 *     failed sale: one sale only, claim reverts on failure, in-progress
 *     fails closed;
 * (g) pushRepShortagesToPayroll twice: the second call reports failure and
 *     inserts no second payroll adjustment.
 *
 * The mid-flight races in (a)/(b)/(c) are driven with a transaction
 * proxy: the first in-transaction read of the governing table first
 * applies the concurrent change on the same transaction handle (a
 * second connection cannot exist on PGlite), then delegates to the
 * real read — so the pre-check sees 'open' and the locked re-read
 * sees the new state, exactly as a concurrent request would produce
 * it. Removing any locked re-read makes its test fail (proven by
 * temporary revert during development).
 *
 * NOT DRIVEN: true two-connection concurrency (needs live Postgres —
 * PGlite is single-connection, so the lock's serialization itself is
 * code-reviewed, not driven concurrently); a live Postgres run; the
 * frontend trip screens (untouched).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanRequisitionsService } from '../../src/modules/delivery-reps/services/van-requisitions.service';
import { VanPreSalesService } from '../../src/modules/delivery-reps/services/van-pre-sales.service';
import { up as openTripIndexUp } from '../../src/database/migrations/2040000000314_van_open_trip_unique_index';

const TENANT = 't1';
const ACCOUNT = 'a1';

const adminAuth: any = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
};

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, employee_id bigint, national_id text, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric, plate_number text);
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, end_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric DEFAULT 0, stock_variance_amount numeric DEFAULT 0, stock_variance_details text, night_stock_approved boolean, night_stock_approved_by bigint, night_stock_notes text, distance_km numeric, notes text, opened_at timestamptz, submitted_at timestamptz, closed_at timestamptz, settled_by bigint, supervisor_id bigint, updated_at timestamptz);
    CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, amount numeric DEFAULT 0, created_at timestamptz DEFAULT NOW());
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, stock_qty numeric DEFAULT 0, is_active boolean DEFAULT true, default_location_id bigint, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, metadata text, customer_type text, location_url text, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, notes text, settled_at timestamptz, settled_by bigint, settlement_method text, receipt_voucher_no text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_load_requisitions (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, rep_id bigint, source_warehouse_id bigint, status text, requested_items text, approved_items text, notes text, rejection_reason text, trip_id bigint, reviewed_by bigint, reviewed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, order_source text, status text, sale_id bigint, customer_id bigint, customer_name text, customer_phone text, rep_id bigint, branch_id bigint, warehouse_location_id bigint, payment_terms text, discount_amount numeric DEFAULT 0, total_amount numeric DEFAULT 0, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sales_order_id bigint, product_id bigint, quantity numeric, reserved_quantity numeric DEFAULT 0, delivered_quantity numeric DEFAULT 0, unit_price numeric DEFAULT 0, discount numeric DEFAULT 0, unit_name text);
    CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, account_id text, display_name text, national_id text, status text);
    CREATE TABLE hr_employee_adjustments (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, adjustment_type text, amount_type text, amount numeric, date date, reason text, status text, source_type text, source_id text, created_by bigint, updated_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Warehouse', code: 'WH', is_active: true, location_type: 'branch_stock' }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Van', code: 'VAN_4', is_active: true, location_type: 'van_stock' }).execute();
}

async function seedRep(db: Kysely<Database>, repId: number, extra: Record<string, unknown> = {}): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('delivery_representatives').values({
    id: repId, tenant_id: TENANT, account_id: ACCOUNT, name: `Rep ${repId}`,
    phone: null, vehicle_plate: null, van_location_id: 10, employee_id: null, national_id: null, ...extra,
  }).execute();
}

async function seedTrip(db: Kysely<Database>, tripId: number, repId: number, extra: Record<string, unknown> = {}): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('van_sales_trips').values({
    id: tripId, tenant_id: TENANT, account_id: ACCOUNT, rep_id: repId, vehicle_id: null,
    start_odometer: 100, end_odometer: null, van_location_id: 10, source_warehouse_id: 1,
    status: 'open', settlement_status: 'open', loaded_amount: 0, sales_amount: 0,
    cash_collected: 0, credit_sales: 0, returns_amount: 0, cash_refunds: 0,
    total_instapay_sales: 0, total_instapay_collections: 0, variance: 0, ...extra,
  }).execute();
}

async function tripRow(db: Kysely<Database>, tripId: number): Promise<any> {
  return (db as any).selectFrom('van_sales_trips').selectAll().where('id', '=', tripId).executeTakeFirst();
}

/**
 * A proxy around a Kysely query builder that runs `hook` once, just
 * before the FIRST terminal execution (execute / executeTakeFirst /
 * executeTakeFirstOrThrow) of that builder chain. Kysely builders are
 * immutable — every chained call returns a new builder — so wrapping
 * only the builder selectFrom returns would be dropped by the first
 * .where(); the proxy re-wraps every chained builder instead.
 */
function proxiedBuilder(
  builder: any,
  hook: (() => Promise<void>) | undefined,
  fired: Set<string>,
  key: string,
): any {
  if (!hook) return builder;
  return new Proxy(builder, {
    get(target: any, prop: string) {
      if (prop === 'executeTakeFirst' || prop === 'execute' || prop === 'executeTakeFirstOrThrow') {
        if (!fired.has(key)) {
          return async (...args: any[]) => {
            fired.add(key);
            await hook();
            return target[prop](...args);
          };
        }
        return target[prop].bind(target);
      }
      const value = target[prop];
      if (typeof value === 'function') {
        return (...args: any[]) => {
          const out = value.apply(target, args);
          // Re-wrap only chained builders (which carry a terminal
          // method); promises and plain nodes pass through untouched.
          if (
            out && typeof out === 'object' &&
            (typeof out.executeTakeFirst === 'function' || typeof out.execute === 'function')
          ) {
            return proxiedBuilder(out, hook, fired, key);
          }
          return out;
        };
      }
      return value;
    },
  });
}

/**
 * Wraps a real Kysely db so the transaction handle intercepts the
 * FIRST in-transaction read of a governing table: the hook applies a
 * concurrent change on the same handle first, then the real read
 * runs — the pre-check saw the old state, the locked re-read sees
 * the new one. Outer (pre-check) reads are never intercepted.
 */
function proxyDb(
  realDb: Kysely<Database>,
  hooks: { tripSettled?: (trx: any, tripId: number) => Promise<void>; expenseAdded?: (trx: any, tripId: number) => Promise<void> },
  tripId: number,
): any {
  const fired = new Set<string>();
  const interceptedTrx = (realTrx: any): any =>
    new Proxy(realTrx, {
      get(target: any, prop: string) {
        if (prop === 'selectFrom') {
          return (table: string, ...rest: any[]) => {
            const builder: any = target.selectFrom(table, ...rest);
            if (table === 'van_sales_trips' && hooks.tripSettled) {
              const hook = () => hooks.tripSettled!(realTrx, tripId);
              return proxiedBuilder(builder, hook, fired, 'van_sales_trips');
            }
            if (table === 'van_trip_expenses' && hooks.expenseAdded) {
              const hook = () => hooks.expenseAdded!(realTrx, tripId);
              return proxiedBuilder(builder, hook, fired, 'van_trip_expenses');
            }
            return builder;
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  return {
    selectFrom: (...args: any[]) => (realDb as any).selectFrom(...args),
    insertInto: (...args: any[]) => (realDb as any).insertInto(...args),
    updateTable: (...args: any[]) => (realDb as any).updateTable(...args),
    deleteFrom: (...args: any[]) => (realDb as any).deleteFrom(...args),
    transaction: () => ({
      execute: async (cb: any) =>
        (realDb as any).transaction().execute(async (realTrx: any) => cb(interceptedTrx(realTrx))),
    }),
  };
}

function buildVanService(db: any, extra: Record<string, any> = {}): any {
  const service = Object.create(VanSalesService.prototype);
  service.db = db;
  service.accountingPosting = {
    postVanTripSettlement: async () => 1,
    postVanStockTransfer: async () => 1,
  };
  service.recordSuspicionEvent = async () => undefined;
  service.resolveSystemAuthContext = async () => adminAuth;
  Object.assign(service, extra);
  return service;
}

async function main(): Promise<void> {
  // (a) Field sale on a trip settled mid-flight: rejected INVALID_TRIP.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db, 4);
      await seedTrip(db, 11, 4);
      let hookFired = false;
      const service = buildVanService(proxyDb(db, {
        tripSettled: async (trx: any, tripId: number) => {
          hookFired = true;
          await trx.updateTable('van_sales_trips').set({ status: 'settled' }).where('id', '=', tripId).execute();
        },
      }, 11));
      await assert.rejects(
        () => service.executeFieldSaleInternal(4, TENANT, ACCOUNT, {
          tripId: 11, paymentMethod: 'cash', items: [{ productId: 1, qty: 1 }],
        }),
        /INVALID_TRIP/,
      );
      assert.equal(hookFired, true, 'the concurrent settle must land before the locked re-read');
      // The guard's rejection rolls the transaction back, so the
      // hook's simulated settle is rolled back with it — the trip is
      // 'open' again, and the sale never committed. The proof is the
      // rejection itself plus zero ledger rows below.
      assert.equal((await tripRow(db, 11)).status, 'open', 'the rejected transaction rolled back');
      assert.equal(
        await (db as any).selectFrom('customer_ledger').selectAll().execute().then((r: any[]) => r.length),
        0, 'no collection/sale ledger row was written',
      );
    } finally {
      await db.destroy();
    }
    console.log('  (a) sale on mid-flight settled trip rejected passed');
  }

  // (a2) Field sale on a trip already settled at the pre-check: same rejection, no transaction.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db, 4);
      await seedTrip(db, 11, 4, { status: 'settled', settlement_status: 'settled' });
      const service = buildVanService(db);
      await assert.rejects(
        () => service.executeFieldSaleInternal(4, TENANT, ACCOUNT, {
          tripId: 11, paymentMethod: 'cash', items: [{ productId: 1, qty: 1 }],
        }),
        /INVALID_TRIP/,
      );
    } finally {
      await db.destroy();
    }
    console.log('  (a2) sale on already-settled trip rejected passed');
  }

  // (b) Field collection on a trip settled mid-flight: rejected INVALID_TRIP.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db, 4);
      await seedTrip(db, 11, 4);
      await (db as any).insertInto('customers').values({
        id: 21, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop', phone: null,
        balance: 100, credit_limit: 0, metadata: null, customer_type: 'cash', is_active: true,
      }).execute();
      let hookFired = false;
      const service = buildVanService(proxyDb(db, {
        tripSettled: async (trx: any, tripId: number) => {
          hookFired = true;
          await trx.updateTable('van_sales_trips').set({ status: 'settled' }).where('id', '=', tripId).execute();
        },
      }, 11));
      await assert.rejects(
        () => service.recordFieldCollectionInternal(4, TENANT, ACCOUNT, {
          tripId: 11, customerId: 21, amount: 50,
        }),
        /INVALID_TRIP/,
      );
      assert.equal(hookFired, true, 'the concurrent settle must land before the locked re-read');
      assert.equal(
        await (db as any).selectFrom('customer_ledger').selectAll().execute().then((r: any[]) => r.length),
        0, 'no collection ledger row was written',
      );
    } finally {
      await db.destroy();
    }
    console.log('  (b) collection on mid-flight settled trip rejected passed');
  }

  // (c) settleTrip re-reads the money inside the transaction: an
  // expense posted mid-flight (cash 100, expense 30) settles on
  // expectedCash 70, not the pre-transaction 100.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db, 4);
      await seedTrip(db, 11, 4, { cash_collected: 100 });
      let hookFired = false;
      const service = buildVanService(proxyDb(db, {
        expenseAdded: async (trx: any, tripId: number) => {
          hookFired = true;
          await trx.insertInto('van_trip_expenses').values({
            tenant_id: TENANT, account_id: ACCOUNT, trip_id: tripId, amount: 30,
          }).execute();
        },
      }, 11));
      const result = await service.settleTrip(4, TENANT, ACCOUNT, {
        tripId: 11, countedCash: 0, unloadRemainingToWarehouse: false, endOdometer: 120,
      }, adminAuth);
      assert.equal(hookFired, true, 'the mid-flight expense must land before the locked money re-read');
      assert.equal(result.expectedCash, 70, 'expected cash uses the in-transaction expense total');
      assert.equal(result.tripExpenses, 30, 'trip expenses are the in-transaction total');
      assert.equal(result.variance, -70, 'variance follows the re-read expected cash');
      assert.equal((await tripRow(db, 11)).status, 'settled', 'the trip is settled');
      assert.equal(Number((await tripRow(db, 11)).variance || 0), -70, 'the stored variance is the re-read one');
      const shortages = await (db as any).selectFrom('van_rep_financial_settlements').selectAll().execute();
      assert.equal(shortages.length, 1, 'exactly one shortage row');
      assert.equal(shortages[0].entry_type, 'cash_shortage', 'the shortage is a cash shortage');
      assert.equal(Number(shortages[0].amount || 0), 70, 'the shortage amount is the re-read variance');
    } finally {
      await db.destroy();
    }
    console.log('  (c) settleTrip money re-read inside the transaction passed');
  }

  // (d) Two open trips for one rep are impossible (migration 0314),
  // and openTripAndLoad refuses the second open.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await openTripIndexUp(db as any);
      await seedRep(db, 4);
      await seedRep(db, 5);
      await seedRep(db, 6);
      await seedTrip(db, 11, 4);
      await assert.rejects(
        () => seedTrip(db, 12, 4),
        /uq_van_trips_one_open_per_rep/,
        'the second open insert for the same rep must violate the index',
      );
      await seedTrip(db, 13, 4, { status: 'settled', settlement_status: 'settled' });
      await seedTrip(db, 14, 5);
      const service = buildVanService(db);
      await assert.rejects(
        () => service.openTripAndLoad(4, TENANT, ACCOUNT, { items: [] }),
        /TRIP_ALREADY_OPEN/,
        'openTripAndLoad refuses a second open trip for the same rep',
      );
      const opened = await service.openTripAndLoad(6, TENANT, ACCOUNT, { items: [] });
      assert.equal(opened.ok, true, 'a rep with no open trip opens one');
      assert.ok(Number(opened.tripId) > 0, 'the new trip has an id');
      await assert.rejects(
        () => service.openTripAndLoad(6, TENANT, ACCOUNT, { items: [] }),
        /TRIP_ALREADY_OPEN/,
        'the just-opened trip blocks a second open',
      );
    } finally {
      await db.destroy();
    }
    console.log('  (d) one open trip per rep (index + service) passed');
  }

  // (e) markRequisitionDispatched twice: the second call fails closed.
  {
    const { db } = await makeDb();
    try {
      await (db as any).insertInto('van_load_requisitions').values({
        id: 201, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'REQ-1', rep_id: 4,
        source_warehouse_id: 1, status: 'pending', requested_items: '[]', approved_items: '[]',
        notes: null, rejection_reason: null, trip_id: null, reviewed_by: null,
      }).execute();
      const service = Object.create(VanRequisitionsService.prototype);
      service.db = db;
      const first = await service.markRequisitionDispatched(TENANT, 201, 11, 99);
      assert.equal(first.ok, true, 'the first dispatch succeeds');
      const row = await (db as any).selectFrom('van_load_requisitions').selectAll().where('id', '=', 201).executeTakeFirst();
      assert.equal(row.status, 'dispatched', 'the row is dispatched');
      assert.equal(Number(row.trip_id), 11, 'the dispatch links the first trip');
      await assert.rejects(
        () => service.markRequisitionDispatched(TENANT, 201, 12, 99),
        /ALREADY_DISPATCHED/,
        'the second dispatch fails closed',
      );
      const rowAfter = await (db as any).selectFrom('van_load_requisitions').selectAll().where('id', '=', 201).executeTakeFirst();
      assert.equal(Number(rowAfter.trip_id), 11, 'the second dispatch did not overwrite the trip link');
    } finally {
      await db.destroy();
    }
    console.log('  (e) double dispatch fails closed passed');
  }

  // (f) convertPreSalesOrderToInvoice: one sale only; a failed sale
  // reverts the claim; a 'converting' order fails closed.
  {
    const { db } = await makeDb();
    try {
      const calls: any[][] = [];
      const salesStub = {
        createSale: async (...args: any[]) => {
          calls.push(args);
          return { sale: { id: 77, docNo: 'SALE-77' } };
        },
      };
      const service = Object.create(VanPreSalesService.prototype);
      service.db = db;
      service.salesService = salesStub;
      const seedOrder = async (orderId: number, status: string) => {
        await (db as any).insertInto('sales_orders').values({
          id: orderId, tenant_id: TENANT, account_id: ACCOUNT, order_number: `SO-${orderId}`,
          order_source: 'van_presales', status, sale_id: null, customer_id: null,
          customer_name: null, customer_phone: null, rep_id: 4, branch_id: 1,
          warehouse_location_id: 1, payment_terms: 'cash', discount_amount: 0,
          total_amount: 100, notes: null,
        }).execute();
        await (db as any).insertInto('sales_order_items').values({
          id: orderId, tenant_id: TENANT, account_id: ACCOUNT, sales_order_id: orderId,
          product_id: 1, quantity: 2, reserved_quantity: 2, delivered_quantity: 0,
          unit_price: 50, discount: 0, unit_name: 'piece',
        }).execute();
      };
      const orderRow = async (orderId: number) =>
        (db as any).selectFrom('sales_orders').selectAll().where('id', '=', orderId).executeTakeFirst();
      const itemRow = async (orderId: number) =>
        (db as any).selectFrom('sales_order_items').selectAll().where('sales_order_id', '=', orderId).executeTakeFirst();

      await seedOrder(301, 'approved');
      const converted = await service.convertPreSalesOrderToInvoice(301, adminAuth, {});
      assert.equal(converted.ok, true, 'the conversion succeeds');
      assert.equal(converted.saleId, 77, 'the sale id is the created sale');
      assert.equal(calls.length, 1, 'createSale ran exactly once');
      const release = calls[0][3];
      assert.ok(release, 'the reservation travels with the sale as a conversionRelease');
      assert.equal(release.salesOrderId, 301, 'the release names the order');
      assert.deepEqual(release.items, [{ productId: 1, qty: 2 }], 'the release frees the reserved qty');
      assert.equal((await orderRow(301)).status, 'converted', 'the order is converted');
      assert.equal(Number((await orderRow(301)).sale_id), 77, 'the order links the sale');
      assert.equal(Number((await itemRow(301)).reserved_quantity), 0, 'the reservation is cleared');
      assert.equal(Number((await itemRow(301)).delivered_quantity), 2, 'the items are delivered');
      await assert.rejects(
        () => service.convertPreSalesOrderToInvoice(301, adminAuth, {}),
        /ORDER_ALREADY_CONVERTED/,
        'a second convert of the same order fails closed',
      );
      assert.equal(calls.length, 1, 'the second convert never reached createSale');

      // A 'converting' order (a conversion already in flight) fails closed.
      await seedOrder(303, 'converting');
      await assert.rejects(
        () => service.convertPreSalesOrderToInvoice(303, adminAuth, {}),
        /ORDER_CONVERSION_IN_PROGRESS/,
        'an in-flight conversion fails closed',
      );
      assert.equal(calls.length, 1, 'the in-flight convert never reached createSale');

      // A failed sale reverts the claim to 'approved' — and the
      // reservation was never released outside the sale transaction.
      await seedOrder(302, 'approved');
      service.salesService = { createSale: async () => { throw new Error('SALE_BOOM'); } };
      await assert.rejects(
        () => service.convertPreSalesOrderToInvoice(302, adminAuth, {}),
        /SALE_BOOM/,
      );
      assert.equal((await orderRow(302)).status, 'approved', 'the claim reverts to approved');
      assert.equal(Number((await itemRow(302)).reserved_quantity), 2, 'the reservation is intact');
    } finally {
      await db.destroy();
    }
    console.log('  (f) pre-sales conversion claim + conditional flip passed');
  }

  // (g) pushRepShortagesToPayroll twice: the second push reports
  // failure and inserts no second payroll adjustment.
  {
    const { db } = await makeDb();
    try {
      await seedRep(db, 4, { employee_id: 9 });
      await (db as any).insertInto('hr_employees').values({
        id: 9, tenant_id: TENANT, account_id: ACCOUNT, display_name: 'Rep 4', national_id: null, status: 'active',
      }).execute();
      await (db as any).insertInto('van_rep_financial_settlements').values({
        id: 401, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 4, trip_id: 11,
        entry_type: 'cash_shortage', amount: 25, status: 'pending', notes: 'shortage',
      }).execute();
      const service = buildVanService(db);
      const first = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [401] }, adminAuth);
      assert.equal(first.results[0].success, true, 'the first push succeeds');
      assert.equal(first.processedCount, 1, 'one item processed');
      const itemRow = await (db as any).selectFrom('van_rep_financial_settlements').selectAll().where('id', '=', 401).executeTakeFirst();
      assert.equal(itemRow.status, 'pushed_to_payroll', 'the item is pushed');
      const adjustments = () => (db as any).selectFrom('hr_employee_adjustments').selectAll().execute();
      assert.equal((await adjustments()).length, 1, 'exactly one payroll adjustment');
      assert.equal(Number((await adjustments())[0].amount), 25, 'the adjustment is the shortage amount');
      const second = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [401] }, adminAuth);
      assert.equal(second.results[0].success, false, 'the second push reports failure');
      assert.equal(second.processedCount, 0, 'nothing processed the second time');
      assert.equal((await adjustments()).length, 1, 'still exactly one payroll adjustment');
    } finally {
      await db.destroy();
    }
    console.log('  (g) double payroll push inserts no second deduction passed');
  }

  // Source pins: the invariant name is present in every touched
  // service, the index name is referenced by the open guard, and the
  // sale facade forwards the conversion release. (The
  // ARCHITECTURE_INVARIANTS.md entry itself is owned by the
  // coordinator and is not pinned here.)
  {
    const here = __dirname;
    const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-trip-lifecycle.service.ts'), 'utf8');
    assert.ok(vanSource.includes('INV-VAN-TRIP-LOCKED-STATE-RECHECK'), 'van-sales names the invariant');
    assert.ok(vanSource.includes('uq_van_trips_one_open_per_rep'), 'the open guard names the unique index');
    const reqSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-requisitions.service.ts'), 'utf8');
    assert.ok(reqSource.includes('INV-VAN-TRIP-LOCKED-STATE-RECHECK'), 'requisitions names the invariant');
    const preSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-pre-sales.service.ts'), 'utf8');
    assert.ok(preSource.includes('INV-VAN-TRIP-LOCKED-STATE-RECHECK'), 'pre-sales names the invariant');
    assert.ok(preSource.includes('conversionRelease'), 'pre-sales hands the release to createSale');
    const facadeSource = readFileSync(resolve(here, '../../src/modules/sales/sales.service.ts'), 'utf8');
    assert.ok(facadeSource.includes('conversionRelease'), 'the sale facade forwards the conversion release');
    const migrationSource = readFileSync(resolve(here, '../../src/database/migrations/2040000000314_van_open_trip_unique_index.ts'), 'utf8');
    assert.ok(migrationSource.includes('uq_van_trips_one_open_per_rep'), 'migration 0314 creates the index');
    console.log('  source pins passed');
  }

  console.log('Van trip locked-state recheck tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
