/*
New file: backend/test/critical/rep-scoped-customer-reads-h7.spec.ts
Pins INV-REP-SCOPED-CUSTOMER-READS (H7: D1 + D5 + D14), driving the REAL
VanSalesService, VanRoutesService (via the service) and
VanFieldExecutionService on PGlite.

WHAT THE AUDIT FEARED: getActiveTrip returned the tenant's whole active
customer book (phones, addresses, balances, credit limits, GPS links)
to any driver; checkInVisit / recordFieldVisit inserted a visit for any
customer/trip with no check, so one check-in manufactured the very
visit row that opens another rep's customer reads; and
getDriverTodayItinerary fell back to returning every unassigned
customer to any rep with no explicit assignments.

WHAT THIS PINS:
1. (D1) getActiveTrip returns only the rep's own customers — assigned
   in customer metadata plus served (field visit, pre-sale order, or
   delivered sale) — and excludes another rep's customer and
   unassigned customers, with the same per-customer field shape.
2. (D5) checkInVisit refuses an unassigned customer with no owned trip
   (REP_CUSTOMER_NOT_ASSIGNED 403), refuses another rep's trip
   (REP_TRIP_NOT_OWNED 403), and refuses a missing trip (TRIP_NOT_FOUND
   404); it allows an assigned customer with no trip and any customer
   on the rep's own trip. recordFieldVisit refuses another rep's trip
   (REP_TRIP_NOT_OWNED 403), refuses linking another rep's sale
   (REP_SALE_NOT_OWNED 403) and a sale for a different customer
   (VISIT_SALE_CUSTOMER_MISMATCH 400), and allows a visit on the rep's
   own trip.
3. (D14) getDriverTodayItinerary for a rep with no assignments returns
   only customers he served or transacted with in the ledger — never the
   unassigned pool — and for a rep with assignments returns assigned +
   served + ledger-active only. A field collection writes a ledger row
   but no visit row, so the ledger leg (rep-scoped byRepId) is what
   keeps a collected-from customer on the itinerary.

Deliberately NOT driven here: the controller wiring (verifyDriverToken
-> driver.repId -> service) is one-line call sites verified by
inspection; the HTTP layer is not booted in this harness.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanFieldExecutionService } from '../../src/modules/delivery-reps/services/van-field-execution.service';

const TENANT = 't-rep-scope-h7';
const ACCOUNT = 'a-rep-scope-h7';
const REP_OWN = 11;
const REP_OTHER = 22;
const REP_NONE = 33;

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, full_name text, name text, phone text, van_location_id bigint, vehicle_plate text, is_active boolean DEFAULT true);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, location_type text, is_active boolean DEFAULT true);
      CREATE TABLE fleet_vehicles (id bigserial PRIMARY KEY, tenant_id text, account_id text, plate_number text, model_name text, vehicle_type text, current_odometer numeric DEFAULT 0, fuel_type text, license_expires_at timestamptz, status text, assigned_rep_id bigint, van_location_id bigint);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text, barcode text, metadata text, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint, location_id bigint, tenant_id text, qty numeric DEFAULT 0);
      CREATE TABLE product_units (id bigserial PRIMARY KEY, product_id bigint, name text, multiplier numeric DEFAULT 1, is_base_unit boolean DEFAULT false);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, batch_number text, expiry_date date, quantity numeric DEFAULT 0);
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric DEFAULT 0, start_date date, end_date date, min_qty numeric, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_active boolean DEFAULT true, metadata text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text, is_active boolean DEFAULT true);
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_id bigint, customer_name text, customer_phone text, customer_address text, rep_id bigint, warehouse_location_id bigint, order_source text, payment_terms text, subtotal numeric DEFAULT 0, discount_amount numeric DEFAULT 0, total_amount numeric DEFAULT 0, status text, supervisor_approved_at timestamptz, supervisor_approved_by bigint, supervisor_rejection_reason text, notes text, delivery_date date, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, van_location_id bigint, source_warehouse_id bigint, vehicle_id bigint, status text, settlement_status text, opened_at timestamptz, closed_at timestamptz, submitted_at timestamptz, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, variance numeric DEFAULT 0, distance_km numeric DEFAULT 0, stock_variance_amount numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, night_stock_approved boolean DEFAULT false, notes text, start_odometer numeric DEFAULT 0, end_odometer numeric DEFAULT 0);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, negative_reason text, postponed_to_date date, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz DEFAULT NOW(), created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_store_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, customer_name text, check_in_at timestamptz, check_in_lat numeric, check_in_lng numeric, is_geofence_valid boolean, geofence_distance_meters numeric, store_inventory text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, status text, payment_type text, customer_id bigint, delivery_rep_id bigint, van_trip_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, entry_type text, amount numeric DEFAULT 0, note text, van_trip_id bigint, reference_id bigint, reference_type text, gps_lat numeric, gps_lng numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, doc_no text, total_amount numeric DEFAULT 0, return_reason text, refund_method text, status text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_damaged_swaps (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, damaged_product_id bigint, replacement_product_id bigint, damaged_qty numeric DEFAULT 0, damage_reason text, replacement_qty numeric DEFAULT 0, price_difference numeric DEFAULT 0, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE delivery_rep_targets (id bigserial PRIMARY KEY, tenant_id text, rep_id bigint, period_month text, target_amount numeric DEFAULT 0, collection_target numeric, visits_target numeric);
      CREATE TABLE hr_holidays (id bigserial PRIMARY KEY, tenant_id text, start_date date, end_date date);
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    `);

    const postingStub = {
      postSale: async () => undefined,
      clearPostingFailure: async () => undefined,
      postVanStockTransfer: async () => undefined,
    };
    const vanService = new VanSalesService(db, {} as never, {} as never, postingStub as never);
    const fraudStub = { recordSuspicionEvent: async () => undefined };
    const fieldExecution = new VanFieldExecutionService(db, fraudStub as never);

    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
    await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', is_base: true, exchange_rate: 1 }).execute();

    await anyDb.insertInto('delivery_representatives').values([
      { id: REP_OWN, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'Own Rep', name: 'Own Rep', phone: '01000000001', van_location_id: 10, is_active: true },
      { id: REP_OTHER, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'Other Rep', name: 'Other Rep', phone: '01000000002', van_location_id: 10, is_active: true },
      { id: REP_NONE, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'No Assign Rep', name: 'No Assign Rep', phone: '01000000003', van_location_id: 10, is_active: true },
    ]).execute();
    await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'Van', location_type: 'van', is_active: true }).execute();
    await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, display_name: 'Sys', username: 'sys', is_active: true }).execute();

    // Customers:
    // 100 assigned to OWN; 200 assigned to + served by OTHER; 300
    // unassigned + served by nobody; 400 served by OWN via field visit;
    // 500 served by OWN via pre-sale order; 600 served by OWN via a
    // delivered sale; 700 served by NONE via field visit (unassigned).
    await anyDb.insertInto('customers').values([
      { id: 100, tenant_id: TENANT, name: 'Assigned Own', phone: '011100', address: 'Addr 100', balance: 50, credit_limit: 100, is_active: true, metadata: JSON.stringify({ assigned_rep_ids: [REP_OWN] }) },
      { id: 200, tenant_id: TENANT, name: 'Other Rep Customer', phone: '011200', address: 'Addr 200', balance: 70, credit_limit: 200, is_active: true, metadata: JSON.stringify({ assigned_rep_ids: [REP_OTHER] }) },
      { id: 300, tenant_id: TENANT, name: 'Unassigned Stranger', phone: '011300', address: 'Addr 300', balance: 999, credit_limit: 500, is_active: true, metadata: null },
      { id: 400, tenant_id: TENANT, name: 'Visited By Own', phone: '011400', address: 'Addr 400', balance: 10, credit_limit: 0, is_active: true, metadata: null },
      { id: 500, tenant_id: TENANT, name: 'Ordered By Own', phone: '011500', address: 'Addr 500', balance: 20, credit_limit: 0, is_active: true, metadata: null },
      { id: 600, tenant_id: TENANT, name: 'Sold To By Own', phone: '011600', address: 'Addr 600', balance: 30, credit_limit: 0, is_active: true, metadata: null },
      { id: 700, tenant_id: TENANT, name: 'Visited By None', phone: '011700', address: 'Addr 700', balance: 40, credit_limit: 0, is_active: true, metadata: null },
      { id: 800, tenant_id: TENANT, name: 'Collected From By Own', phone: '011800', address: 'Addr 800', balance: 0, credit_limit: 0, is_active: true, metadata: null },
    ]).execute();

    // Trips: 1 belongs to OWN, 2 belongs to OTHER, 3 belongs to NONE.
    await anyDb.insertInto('van_sales_trips').values([
      { id: 1, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_OWN, van_location_id: 10, source_warehouse_id: 10, status: 'open', settlement_status: 'open' },
      { id: 2, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_OTHER, van_location_id: 10, source_warehouse_id: 10, status: 'open', settlement_status: 'open' },
      { id: 3, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_NONE, van_location_id: 10, source_warehouse_id: 10, status: 'open', settlement_status: 'open' },
    ]).execute();

    // Served evidence: OWN visited 400, ordered for 500, sold to 600;
    // OTHER sold to 200; NONE visited 700.
    await anyDb.insertInto('van_field_visits').values([
      { tenant_id: TENANT, account_id: ACCOUNT, trip_id: 1, rep_id: REP_OWN, customer_id: 400, visit_type: 'positive' },
      { tenant_id: TENANT, account_id: ACCOUNT, trip_id: 3, rep_id: REP_NONE, customer_id: 700, visit_type: 'positive' },
    ]).execute();
    await anyDb.insertInto('sales_orders').values(
      { tenant_id: TENANT, account_id: ACCOUNT, order_number: 'SO-500', customer_id: 500, customer_name: 'Ordered By Own', customer_phone: '011500', customer_address: 'Addr 500', rep_id: REP_OWN, warehouse_location_id: 10, status: 'pending', subtotal: 20, total_amount: 20 },
    ).execute();
    await anyDb.insertInto('sales').values([
      { id: 60, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'INV-60', total: 30, subtotal: 30, discount: 0, paid_amount: 30, status: 'posted', payment_type: 'cash', customer_id: 600, delivery_rep_id: REP_OWN, van_trip_id: 1 },
      { id: 70, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'INV-70', total: 70, subtotal: 70, discount: 0, paid_amount: 70, status: 'posted', payment_type: 'cash', customer_id: 200, delivery_rep_id: REP_OTHER, van_trip_id: 2 },
    ]).execute();

    const codes = (err: any) => err && typeof err.code === 'string' ? err.code : '';
    const isCode = (code: string, status: number) => (err: any) =>
      err && err.code === code && err.statusCode === status;

    // 1. (D1) getActiveTrip returns only OWN's assigned + served
    // customers, with the same per-customer field shape.
    const active = await vanService.getActiveTrip(REP_OWN, TENANT, ACCOUNT);
    const activeIds = (active.customers || []).map((c: any) => Number(c.id)).sort((a: number, b: number) => a - b);
    assert.deepEqual(activeIds, [100, 400, 500, 600]);
    assert.ok(!activeIds.includes(200), 'another rep customer must not leak');
    assert.ok(!activeIds.includes(300), 'unassigned customer must not leak');
    assert.ok(!activeIds.includes(700), 'a third rep served customer must not leak');
    const assigned = (active.customers || []).find((c: any) => Number(c.id) === 100);
    assert.ok(assigned, 'assigned customer 100 must be present');
    assert.equal(assigned.name, 'Assigned Own');
    assert.equal(assigned.phone, '011100');
    assert.equal(assigned.address, 'Addr 100');
    assert.equal(Number(assigned.balance), 50);
    assert.equal(Number(assigned.creditLimit), 100);
    assert.deepEqual(assigned.assignedRepIds, [REP_OWN]);

    // 2a. (D5) checkInVisit: unassigned customer with no owned trip is
    // refused with a specific error naming the missing assignment.
    await assert.rejects(
      fieldExecution.checkInVisit(TENANT, 1, REP_OWN, { customerId: 300 }),
      isCode('REP_CUSTOMER_NOT_ASSIGNED', 403),
    );
    // Another rep's trip is refused with a specific error naming the trip.
    await assert.rejects(
      fieldExecution.checkInVisit(TENANT, 1, REP_OWN, { tripId: 2, customerId: 100 }),
      isCode('REP_TRIP_NOT_OWNED', 403),
    );
    // A missing trip fails closed instead of recording against nothing.
    await assert.rejects(
      fieldExecution.checkInVisit(TENANT, 1, REP_OWN, { tripId: 999, customerId: 100 }),
      isCode('TRIP_NOT_FOUND', 404),
    );
    // Assigned customer with no trip is allowed, and any customer on
    // the rep's own trip is allowed (the owned trip is the scope).
    const checkInAssigned = await fieldExecution.checkInVisit(TENANT, 1, REP_OWN, { customerId: 100 });
    assert.equal(checkInAssigned.ok, true);
    const checkInOwnTrip = await fieldExecution.checkInVisit(TENANT, 1, REP_OWN, { tripId: 1, customerId: 300 });
    assert.equal(checkInOwnTrip.ok, true);

    // 2b. (D5) recordFieldVisit: another rep's trip is refused.
    await assert.rejects(
      vanService.recordFieldVisit(TENANT, ACCOUNT, REP_OWN, { tripId: 2, customerId: 100, visitType: 'positive' }),
      isCode('REP_TRIP_NOT_OWNED', 403),
    );
    // Linking another rep's sale, or a sale for a different customer,
    // is refused with a specific error.
    await assert.rejects(
      vanService.recordFieldVisit(TENANT, ACCOUNT, REP_OWN, { tripId: 1, customerId: 200, visitType: 'positive', saleId: 70 }),
      isCode('REP_SALE_NOT_OWNED', 403),
    );
    await assert.rejects(
      vanService.recordFieldVisit(TENANT, ACCOUNT, REP_OWN, { tripId: 1, customerId: 100, visitType: 'positive', saleId: 70 }),
      isCode('VISIT_SALE_CUSTOMER_MISMATCH', 400),
    );
    // 3a. (D14) Itinerary for a rep WITH assignments: assigned + served
    // only — never another rep's customer or the unassigned pool.
    const itineraryOwn = await vanService.getDriverTodayItinerary(TENANT, REP_OWN);
    const ownIds = itineraryOwn.map((c: any) => Number(c.customerId)).sort((a: number, b: number) => a - b);
    assert.deepEqual(ownIds, [100, 400, 500, 600]);
    assert.ok(!ownIds.includes(300), 'unassigned customer must not appear in the itinerary');

    // 3b. (D14) Itinerary for a rep with NO assignments anywhere: only
    // the customers he served — the open-region fallback is closed, so
    // the unassigned pool (300) and other reps' customers never appear.
    const itineraryNone = await vanService.getDriverTodayItinerary(TENANT, REP_NONE);
    const noneIds = itineraryNone.map((c: any) => Number(c.customerId)).sort((a: number, b: number) => a - b);
    assert.deepEqual(noneIds, [700]);
    assert.ok(!noneIds.includes(300), 'rep with no assignments must not see the unassigned pool');

    // 3c. (D14 repair) Ledger-active-only customer: OWN collected from
    // 800 on his own trip — recordFieldCollectionInternal writes a
    // customer_ledger row (reference_type 'van_collection',
    // van_trip_id = the rep's trip) and NO van_field_visits row, so 800
    // is neither assigned nor served. The rep-scoped ledger leg
    // (byRepId[OWN]) must still return 800 in the itinerary, while the
    // unassigned customer with no activity (300) stays out.
    await anyDb.insertInto('customer_ledger').values(
      { tenant_id: TENANT, account_id: ACCOUNT, customer_id: 800, entry_type: 'collection', amount: 25, note: 'field collection', van_trip_id: 1, reference_id: 1, reference_type: 'van_collection' },
    ).execute();
    const itineraryLedger = await vanService.getDriverTodayItinerary(TENANT, REP_OWN);
    const ledgerIds = itineraryLedger.map((c: any) => Number(c.customerId)).sort((a: number, b: number) => a - b);
    assert.deepEqual(ledgerIds, [100, 400, 500, 600, 800]);
    assert.ok(!ledgerIds.includes(300), 'unassigned customer with no activity must not appear in the itinerary');
    // The same ledger row under another rep's trip must NOT open 800
    // to that rep: the leg is rep-scoped, not a leak.
    const itineraryOther = await vanService.getDriverTodayItinerary(TENANT, REP_OTHER);
    const otherIds = itineraryOther.map((c: any) => Number(c.customerId)).sort((a: number, b: number) => a - b);
    assert.deepEqual(otherIds, [200]);
    assert.ok(!otherIds.includes(800), 'another rep must not see a customer he never transacted with');

    // Allowed visit, last: a visit on the rep's own trip is allowed,
    // including for an unassigned customer (owned trip is the scope
    // leg). It runs after the itinerary checks because recording it
    // makes customer 300 served by OWN.
    const visit = await vanService.recordFieldVisit(TENANT, ACCOUNT, REP_OWN, { tripId: 1, customerId: 300, visitType: 'negative', negativeReason: 'shop_closed' });
    assert.equal(visit.ok, true);
    assert.ok(Number(visit.visitId) > 0);
    // The refusals above left no visit row behind for the other rep.
    const otherTripVisits = await anyDb
      .selectFrom('van_field_visits')
      .select(['id'])
      .where('tenant_id', '=', TENANT)
      .where('trip_id', '=', 2)
      .execute();
    assert.equal(otherTripVisits.length, 0);

    // The specific errors name the problem (not a generic message).
    await assert.rejects(
      fieldExecution.checkInVisit(TENANT, 1, REP_OWN, { customerId: 300 }),
      (err: any) => codes(err) === 'REP_CUSTOMER_NOT_ASSIGNED' && String(err.message || '').includes('غير مسند'),
    );

    console.log('rep scoped customer reads H7 checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
