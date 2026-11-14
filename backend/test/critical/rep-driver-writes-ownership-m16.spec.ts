/*
 * Rep driver-writes ownership (M16: D6 + D7, plus the H4 van-sales
 * driver-endpoint PIN ride-along).
 *
 * THE GAPS:
 * - D6: recordVisitInventory / recordVisitNoSale / checkOutVisit
 *   looked the visit up by id + tenant_id only and never checked
 *   rep_id, so any rep could overwrite another rep's visit record.
 *   checkOutVisit also accepted caller-supplied hasSale / saleId /
 *   saleAmount / hasCollection / collectionAmount and wrote them onto
 *   the visit, so invented sale/collection money could be attached to
 *   another rep's visit.
 * - D7: recordPackagingMovement took tripId/customerId while its
 *   repId parameter was never used; recordLiveBreadcrumb wrote GPS
 *   into any tripId; recordTradeSurvey took any visitId/tripId/
 *   customerId; recordFuelLog took any vehicleId/tripId and bumped
 *   the vehicle odometer; recordOilChange had the same shape (its
 *   insert is now fully traced here: complete prior active rows for
 *   the vehicle + insert + GREATEST odometer bump).
 * - H4 ride-along: assertDriverPinChanged gated the driver portal's
 *   own routes, but the van-sales driver endpoints never called it —
 *   a default-PIN rep was blocked from the portal yet could still
 *   write through the van-sales endpoints.
 *
 * THE FIX (INV-REP-DRIVER-WRITES-OWNERSHIP):
 * - Visits: recordVisitInventory / recordVisitNoSale / checkOutVisit
 *   take the caller repId (the driver controller forwards
 *   driver.repId) and refuse another rep's visit with
 *   REP_VISIT_NOT_OWNED 403 before any write. Staff callers pass
 *   null and skip the ownership check.
 * - checkOutVisit amounts are REJECTED outright when unanchored,
 *   never ignored-and-derived silently: a saleId must resolve to a
 *   sale of this visit's customer, on this visit's trip, belonging
 *   to the caller (same rule as H7's recordFieldVisit); a supplied
 *   saleAmount must equal that sale's total within 0.01, and is
 *   derived from the sale when omitted; a saleAmount or a sale claim
 *   with no verified sale is REP_VISIT_SALE_UNVERIFIED 403; a
 *   collectionAmount must equal the cash paid on the linked sale or
 *   the sum of the caller's field collections for this trip +
 *   customer (REP_VISIT_COLLECTION_UNVERIFIED 403). No shipped UI
 *   sends these amounts without a sale, so rejecting unanchored
 *   amounts narrows nothing in use.
 * - Packaging: recordPackagingMovement asserts trip ownership with
 *   the existing assertTripOwnedByRep before inserting. NO rep_id
 *   column is added: trip_id already determines ownership
 *   deterministically (van_sales_trips.rep_id) and the read side
 *   gates on the same trip.
 * - Breadcrumb / survey: the trip / visit / customer anchors must
 *   each be the caller's own (REP_TRIP_NOT_OWNED / REP_VISIT_NOT_OWNED
 *   / REP_CUSTOMER_NOT_ASSIGNED 403). A survey customer counts as
 *   the caller's when assigned, served before, or checked in by him.
 * - Fuel / oil: the vehicle must be usable by the caller — assigned
 *   rep, active multi-driver shift row, a supplied trip he owns
 *   whose vehicle this is, or one of his open trips naming this
 *   vehicle (REP_VEHICLE_NOT_ASSIGNED 403, reusing M19's code). The
 *   gate runs before the insert, before completing prior active oil
 *   rows, and before the odometer bump. Staff callers pass null.
 * - PIN gate: VanSalesController routes every driver
 *   verifyDriverToken call through a private verifyDriver helper
 *   that also calls assertDriverPinChanged, and the two
 *   settle-only verifications get the same call inline — 51 driver
 *   endpoints in total. The change-PIN endpoint lives in
 *   DriverPortalController and is the only escape hatch.
 *
 * HARNESS: the REAL VanFieldExecutionService, VanSalesService,
 * DeliveryRepsService and VanSalesController on ONE shared PGlite
 * database. Two reps (A/B) with own trips, vehicles, visits and
 * sales, plus a third rep still on the default PIN 1234 for the
 * PIN-gate cases. Tokens come from the real driverLogin, exactly as
 * the controller derives the driver identity.
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
import { VanFieldExecutionService } from '../../src/modules/delivery-reps/services/van-field-execution.service';
import { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { VanSalesController } from '../../src/modules/delivery-reps/van-sales.controller';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';
import { AppError } from '../../src/common/errors/app-error';

const TENANT = 't-rep-driver-writes-m16';
const ACCOUNT = 'a-rep-driver-writes-m16';
const REP_A = 1;
const REP_B = 2;
const REP_DEFAULT = 3;
const TRIP_A = 11;
const TRIP_B = 12;
const TRIP_A_POOL = 13;
const TRIP_DEFAULT = 14;
const VEH_A = 21;
const VEH_B = 22;
const VEH_POOL = 23;
const CUST_A = 201;
const CUST_B = 202;
const CUST_FREE = 203;
const VISIT_A = 101;
const VISIT_B = 102;
const VISIT_A_CHECKOUT = 103;
const VISIT_DEFAULT = 104;
const VISIT_A_FREE = 105;
const SALE_A = 301;
const SALE_B = 302;
const SALE_B_SAME_CUSTOMER = 303;

async function expectCode(promise: Promise<unknown>, code: string, status?: number): Promise<void> {
  let thrown: any = null;
  try {
    await promise;
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, `expected a refusal with code ${code}, but the call succeeded`);
  assert.ok(thrown instanceof AppError, `expected an AppError, got ${String(thrown)}`);
  assert.equal(thrown.code, code, `expected error code ${code}`);
  if (status !== undefined) assert.equal(thrown.statusCode, status, `expected status ${status} for ${code}`);
}

async function main(): Promise<void> {
  const savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'rep-driver-writes-m16-spec-secret';
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, slug text, custom_domain text, business_name text, status text, trial_ends_at timestamptz);
      CREATE TABLE tenant_subscriptions (id bigserial PRIMARY KEY, tenant_id text, status text, created_at timestamptz DEFAULT NOW(), ends_at timestamptz, grace_ends_at timestamptz, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, full_name text, name text, phone text, vehicle_plate text, pin_hash text, pin_salt text, is_van_rep boolean DEFAULT false, van_location_id bigint, permissions text, metadata jsonb NOT NULL DEFAULT '{}', is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_active boolean DEFAULT true, metadata text);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, status text, payment_type text, customer_id bigint, delivery_rep_id bigint, van_trip_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, rep_id bigint);
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, payment_channel text, van_trip_id bigint, rep_id bigint, client_tx_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, van_location_id bigint, status text, settlement_status text, opened_at timestamptz, closed_at timestamptz, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, start_odometer numeric DEFAULT 0, end_odometer numeric DEFAULT 0);
      CREATE TABLE van_store_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, customer_name text, check_in_at timestamptz, check_out_at timestamptz, dwell_time_seconds numeric, check_in_lat numeric, check_in_lng numeric, is_geofence_valid boolean, geofence_distance_meters numeric, has_sale boolean DEFAULT false, sale_id bigint, sale_amount numeric DEFAULT 0, has_collection boolean DEFAULT false, collection_amount numeric DEFAULT 0, no_sale_reason text, no_sale_notes text, store_inventory text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_trade_marketing_surveys (id bigserial PRIMARY KEY, tenant_id text, account_id text, visit_id bigint, trip_id bigint, rep_id bigint, customer_id bigint, survey_type text, asset_id text, asset_name text, asset_condition text, is_pure_company_products boolean, temperature_celsius numeric, cleanliness_rating int, photo_url text, competitor_name text, competitor_product text, competitor_price numeric, competitor_offer_details text, notes text, metadata text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_rep_live_breadcrumbs (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, latitude numeric, longitude numeric, speed_kmh numeric, battery_level numeric, recorded_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_trip_packaging_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, customer_id bigint, package_type text, delivered_qty numeric DEFAULT 0, returned_qty numeric DEFAULT 0, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigserial PRIMARY KEY, tenant_id text, account_id text, plate_number text, model_name text, vehicle_type text, current_odometer numeric DEFAULT 0, fuel_type text, license_expires_at timestamptz, status text, assigned_rep_id bigint, van_location_id bigint, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicle_drivers (id bigserial PRIMARY KEY, tenant_id text, account_id text, vehicle_id bigint, rep_id bigint, shift_name text, is_active boolean DEFAULT true, created_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_fuel_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, vehicle_id bigint, trip_id bigint, rep_id bigint, odometer numeric, liters numeric, price_per_liter numeric, total_cost numeric, station_name text, km_since_last_fuel numeric, consumption_rate numeric, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_oil_changes (id bigserial PRIMARY KEY, tenant_id text, account_id text, vehicle_id bigint, rep_id bigint, odometer_at_change numeric, oil_type text, rated_km numeric, with_filter boolean, alert_km_before numeric, next_due_odometer numeric, cost numeric, performed_by text, status text, notes text, created_at timestamptz DEFAULT NOW());
    `);

    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await anyDb.insertInto('tenants').values({ id: TENANT, slug: TENANT, business_name: 'Test Co', status: 'active', trial_ends_at: null }).execute();
    await anyDb.insertInto('tenant_subscriptions').values({ tenant_id: TENANT, status: 'active', ends_at: future, grace_ends_at: null }).execute();
    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
    await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', is_base: true, exchange_rate: 1 }).execute();

    const pinA = await createPasswordRecord('5829');
    const pinB = await createPasswordRecord('5829');
    const pinDefault = await createPasswordRecord('1234');
    await anyDb.insertInto('delivery_representatives').values([
      { id: REP_A, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'Rep A', name: 'Rep A', phone: '01000000001', pin_hash: pinA.hash, pin_salt: pinA.salt, is_active: true },
      { id: REP_B, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'Rep B', name: 'Rep B', phone: '01000000002', pin_hash: pinB.hash, pin_salt: pinB.salt, is_active: true },
      { id: REP_DEFAULT, tenant_id: TENANT, account_id: ACCOUNT, full_name: 'Rep Default', name: 'Rep Default', phone: '01000000003', pin_hash: pinDefault.hash, pin_salt: pinDefault.salt, is_active: true },
    ]).execute();

    const now = new Date().toISOString();
    await anyDb.insertInto('fleet_vehicles').values([
      { id: VEH_A, tenant_id: TENANT, account_id: ACCOUNT, plate_number: 'A-100', status: 'available', assigned_rep_id: REP_A, current_odometer: 10000 },
      { id: VEH_B, tenant_id: TENANT, account_id: ACCOUNT, plate_number: 'B-200', status: 'available', assigned_rep_id: REP_B, current_odometer: 20000 },
      { id: VEH_POOL, tenant_id: TENANT, account_id: ACCOUNT, plate_number: 'P-300', status: 'available', assigned_rep_id: null, current_odometer: 5000 },
    ]).execute();
    await anyDb.insertInto('van_sales_trips').values([
      { id: TRIP_A, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_A, vehicle_id: VEH_A, status: 'open' },
      { id: TRIP_B, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_B, vehicle_id: VEH_B, status: 'open' },
      { id: TRIP_A_POOL, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_A, vehicle_id: VEH_POOL, status: 'open' },
      { id: TRIP_DEFAULT, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_DEFAULT, vehicle_id: VEH_POOL, status: 'open' },
    ]).execute();
    await anyDb.insertInto('customers').values([
      { id: CUST_A, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop A', balance: 0, metadata: JSON.stringify({ assigned_rep_ids: [REP_A] }), is_active: true },
      { id: CUST_B, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop B', balance: 0, metadata: JSON.stringify({ assigned_rep_ids: [REP_B] }), is_active: true },
      { id: CUST_FREE, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Free', balance: 0, metadata: JSON.stringify({}), is_active: true },
    ]).execute();
    await anyDb.insertInto('van_store_visits').values([
      { id: VISIT_A, tenant_id: TENANT, account_id: ACCOUNT, trip_id: TRIP_A, rep_id: REP_A, customer_id: CUST_A, customer_name: 'Shop A', check_in_at: now, store_inventory: '[]', created_at: now, updated_at: now },
      { id: VISIT_B, tenant_id: TENANT, account_id: ACCOUNT, trip_id: TRIP_B, rep_id: REP_B, customer_id: CUST_B, customer_name: 'Shop B', check_in_at: now, store_inventory: '[]', created_at: now, updated_at: now },
      { id: VISIT_A_CHECKOUT, tenant_id: TENANT, account_id: ACCOUNT, trip_id: TRIP_A, rep_id: REP_A, customer_id: CUST_A, customer_name: 'Shop A', check_in_at: now, store_inventory: '[]', created_at: now, updated_at: now },
      { id: VISIT_DEFAULT, tenant_id: TENANT, account_id: ACCOUNT, trip_id: TRIP_DEFAULT, rep_id: REP_DEFAULT, customer_id: CUST_A, customer_name: 'Shop A', check_in_at: now, store_inventory: '[]', created_at: now, updated_at: now },
      { id: VISIT_A_FREE, tenant_id: TENANT, account_id: ACCOUNT, trip_id: TRIP_A, rep_id: REP_A, customer_id: CUST_FREE, customer_name: 'Shop Free', check_in_at: now, store_inventory: '[]', created_at: now, updated_at: now },
    ]).execute();
    await anyDb.insertInto('sales').values([
      { id: SALE_A, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'S-301', total: 150, paid_amount: 150, status: 'paid', payment_type: 'cash', customer_id: CUST_A, delivery_rep_id: REP_A, van_trip_id: TRIP_A },
      { id: SALE_B, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'S-302', total: 200, paid_amount: 200, status: 'paid', payment_type: 'cash', customer_id: CUST_B, delivery_rep_id: REP_B, van_trip_id: TRIP_B },
      { id: SALE_B_SAME_CUSTOMER, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'S-303', total: 77, paid_amount: 77, status: 'paid', payment_type: 'cash', customer_id: CUST_A, delivery_rep_id: REP_B, van_trip_id: TRIP_B },
    ]).execute();
    await anyDb.insertInto('customer_payments').values({
      tenant_id: TENANT, account_id: ACCOUNT, customer_id: CUST_A, amount: 50,
      payment_channel: 'cash', van_trip_id: TRIP_A, rep_id: REP_A, client_tx_id: 'm16-anchor',
    }).execute();
    await anyDb.insertInto('fleet_oil_changes').values({
      tenant_id: TENANT, account_id: ACCOUNT, vehicle_id: VEH_A, rep_id: REP_A,
      odometer_at_change: 9000, oil_type: '10W-40', rated_km: 5000, with_filter: true,
      alert_km_before: 500, next_due_odometer: 14000, cost: 0, status: 'active',
    }).execute();

    const postingStub = {
      postSale: async () => undefined,
      clearPostingFailure: async () => undefined,
      postVanStockTransfer: async () => undefined,
    };
    const fraudStub = { recordSuspicionEvent: async () => undefined };
    const fieldExecution = new VanFieldExecutionService(db, fraudStub as never);
    const vanService = new VanSalesService(db, {} as never, {} as never, postingStub as never);
    const repsService = new DeliveryRepsService(db, {} as never, {} as never, {} as never);
    const controller = new VanSalesController(
      vanService, repsService, {} as never, {} as never, {} as never, fieldExecution,
    );

    const visitRow = async (id: number): Promise<any> =>
      (db as any).selectFrom('van_store_visits').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const countRows = async (table: string, where: (q: any) => any): Promise<number> => {
      let q = (db as any).selectFrom(table).selectAll();
      q = where(q);
      return (await q.execute()).length;
    };
    const vehicleOdometer = async (id: number): Promise<number> => {
      const row = await (db as any).selectFrom('fleet_vehicles').select('current_odometer').where('id', '=', id).executeTakeFirstOrThrow() as any;
      return Number(row.current_odometer);
    };
    const oilRowStatus = async (vehicleId: number): Promise<string[]> => {
      const rows = await (db as any).selectFrom('fleet_oil_changes').select('status').where('vehicle_id', '=', vehicleId).orderBy('id', 'asc').execute();
      return rows.map((r: any) => String(r.status));
    };

    // (1) Rep B writes inventory on rep A's visit -> refused, nothing written.
    {
      await expectCode(
        fieldExecution.recordVisitInventory(TENANT, VISIT_A, { items: [{ productId: 1, productName: 'X', qtyOnShelf: 5 }] }, REP_B),
        'REP_VISIT_NOT_OWNED', 403,
      );
      assert.equal(await visitRow(VISIT_A).then((v: any) => v.store_inventory), '[]', 'the other rep’s visit inventory is untouched');
      console.log('  (1) B inventory on A visit refused, nothing written passed');
    }

    // (2) Rep B no-sale on rep A's visit -> refused, nothing written.
    {
      await expectCode(
        fieldExecution.recordVisitNoSale(TENANT, VISIT_A, { noSaleReason: 'shop_closed' }, REP_B),
        'REP_VISIT_NOT_OWNED', 403,
      );
      assert.equal((await visitRow(VISIT_A)).no_sale_reason, null, 'the no-sale reason is untouched');
      console.log('  (2) B no-sale on A visit refused, nothing written passed');
    }

    // (3) Rep B checks out rep A's visit -> refused, visit still open.
    {
      await expectCode(
        fieldExecution.checkOutVisit(TENANT, VISIT_A, {}, REP_B),
        'REP_VISIT_NOT_OWNED', 403,
      );
      assert.equal((await visitRow(VISIT_A)).check_out_at, null, 'the visit is still open');
      console.log('  (3) B check-out on A visit refused, visit still open passed');
    }

    // (4) Invented amounts on the caller's OWN visit are refused and
    // the visit is unchanged; a verified linked sale then checks out
    // with its amount derived from the sale itself.
    {
      const before = await visitRow(VISIT_A_CHECKOUT);
      await expectCode(
        fieldExecution.checkOutVisit(TENANT, VISIT_A_CHECKOUT, { saleAmount: 999 }, REP_A),
        'REP_VISIT_SALE_UNVERIFIED', 403,
      );
      await expectCode(
        fieldExecution.checkOutVisit(TENANT, VISIT_A_CHECKOUT, { saleId: SALE_B }, REP_A),
        'VISIT_SALE_CUSTOMER_MISMATCH', 400,
      );
      await expectCode(
        fieldExecution.checkOutVisit(TENANT, VISIT_A_CHECKOUT, { saleId: SALE_B_SAME_CUSTOMER }, REP_A),
        'REP_SALE_NOT_OWNED', 403,
      );
      await expectCode(
        fieldExecution.checkOutVisit(TENANT, VISIT_A_CHECKOUT, { saleId: SALE_A, saleAmount: 999 }, REP_A),
        'REP_VISIT_SALE_AMOUNT_MISMATCH', 403,
      );
      await expectCode(
        fieldExecution.checkOutVisit(TENANT, VISIT_A_CHECKOUT, { collectionAmount: 999 }, REP_A),
        'REP_VISIT_COLLECTION_UNVERIFIED', 403,
      );
      await expectCode(
        fieldExecution.checkOutVisit(TENANT, VISIT_A_CHECKOUT, { hasSale: true }, REP_A),
        'REP_VISIT_SALE_UNVERIFIED', 403,
      );
      const still = await visitRow(VISIT_A_CHECKOUT);
      assert.equal(still.check_out_at, before.check_out_at, 'no refused checkout closed the visit');
      assert.equal(Number(still.sale_amount || 0), Number(before.sale_amount || 0), 'no invented sale amount landed');
      assert.equal(Number(still.collection_amount || 0), Number(before.collection_amount || 0), 'no invented collection amount landed');

      const ok = await fieldExecution.checkOutVisit(TENANT, VISIT_A_CHECKOUT, { saleId: SALE_A }, REP_A);
      assert.equal(ok.ok, true);
      assert.equal(ok.hasSale, true);
      const done = await visitRow(VISIT_A_CHECKOUT);
      assert.ok(done.check_out_at, 'the verified checkout closed the visit');
      assert.equal(Number(done.sale_amount), 150, 'the sale amount is derived from the linked sale total');
      assert.equal(Number(done.sale_id), SALE_A, 'the linked sale is recorded');
      console.log('  (4) invented amounts refused, verified sale derives its amount passed');
    }

    // (4b) A collection amount that matches a real field collection
    // for this trip + customer is accepted; the visit keeps it.
    {
      const ok = await fieldExecution.checkOutVisit(
        TENANT, VISIT_A, { hasCollection: true, collectionAmount: 50 }, REP_A,
      );
      assert.equal(ok.ok, true);
      assert.equal(ok.hasCollection, true);
      assert.equal(Number((await visitRow(VISIT_A)).collection_amount), 50, 'the anchored collection amount is recorded');
      console.log('  (4b) anchored collection amount accepted passed');
    }

    // (5) Rep B packaging movement on rep A's trip -> refused, no row.
    {
      await expectCode(
        vanService.recordPackagingMovement(REP_B, TENANT, ACCOUNT, {
          tripId: TRIP_A, customerId: CUST_A, packageType: 'crate_plastic', deliveredQty: 3, returnedQty: 0,
        }),
        'FORBIDDEN', 403,
      );
      assert.equal(
        await countRows('van_trip_packaging_movements', (q: any) => q.where('trip_id', '=', TRIP_A)),
        0, 'no packaging row was written for the refused trip',
      );
      const ok = await vanService.recordPackagingMovement(REP_A, TENANT, ACCOUNT, {
        tripId: TRIP_A, customerId: CUST_A, packageType: 'crate_plastic', deliveredQty: 3, returnedQty: 1,
      });
      assert.equal(ok.ok, true);
      assert.equal(
        await countRows('van_trip_packaging_movements', (q: any) => q.where('trip_id', '=', TRIP_A)),
        1, 'the owner’s packaging movement is recorded',
      );
      console.log('  (5) B packaging on A trip refused, owner’s movement recorded passed');
    }

    // (6) Rep B breadcrumb into rep A's trip -> refused, no row.
    {
      await expectCode(
        fieldExecution.recordLiveBreadcrumb(TENANT, 0, REP_B, { tripId: TRIP_A, latitude: 30.0, longitude: 31.0 }),
        'REP_TRIP_NOT_OWNED', 403,
      );
      assert.equal(
        await countRows('van_rep_live_breadcrumbs', (q: any) => q.where('trip_id', '=', TRIP_A)),
        0, 'no breadcrumb was written for the refused trip',
      );
      const ok = await fieldExecution.recordLiveBreadcrumb(TENANT, 0, REP_A, { tripId: TRIP_A, latitude: 30.0, longitude: 31.0 });
      assert.equal(ok.ok, true);
      console.log('  (6) B breadcrumb into A trip refused, owner’s breadcrumb recorded passed');
    }

    // (7) Rep B survey on rep A's visit / trip / customer -> refused,
    // no row. The survey customer gate also fires with no trip anchor
    // (on the unlinked customer — B's sale 303 to customer A makes
    // him a server of A under the H7 served definition, so the
    // no-anchor refusal is proven on the free customer instead).
    {
      await expectCode(
        fieldExecution.recordTradeSurvey(TENANT, 0, REP_B, { tripId: TRIP_A, customerId: CUST_A, surveyType: 'competitor_survey' }),
        'REP_TRIP_NOT_OWNED', 403,
      );
      await expectCode(
        fieldExecution.recordTradeSurvey(TENANT, 0, REP_B, { visitId: VISIT_A, customerId: CUST_A, surveyType: 'competitor_survey' }),
        'REP_VISIT_NOT_OWNED', 403,
      );
      await expectCode(
        fieldExecution.recordTradeSurvey(TENANT, 0, REP_B, { customerId: CUST_FREE, surveyType: 'competitor_survey' }),
        'REP_CUSTOMER_NOT_ASSIGNED', 403,
      );
      assert.equal(
        await countRows('van_trade_marketing_surveys', (q: any) => q),
        0, 'no survey was written for the refused anchors',
      );
      const okTrip = await fieldExecution.recordTradeSurvey(TENANT, 0, REP_A, { tripId: TRIP_A, customerId: CUST_A, surveyType: 'competitor_survey' });
      assert.equal(okTrip.ok, true);
      // Unassigned + unserved customer, but rep A checked in there
      // (VISIT_A_FREE) — the check-in itself was H7-gated, so the
      // survey is allowed through the store-visit anchor.
      const okFree = await fieldExecution.recordTradeSurvey(TENANT, 0, REP_A, { customerId: CUST_FREE, surveyType: 'cooler_inspection' });
      assert.equal(okFree.ok, true);
      console.log('  (7) B survey on A anchors refused, owner’s surveys recorded passed');
    }

    // (8) Rep B fuel log on rep A's vehicle / trip -> refused, no row,
    // odometer unchanged. Naming another rep's trip on his own vehicle
    // is refused too: the trip anchor is checked first.
    {
      const odoBefore = await vehicleOdometer(VEH_A);
      await expectCode(
        vanService.recordFuelLog(TENANT, ACCOUNT, REP_B, { vehicleId: VEH_A, odometer: 10100, liters: 10, pricePerLiter: 15 }),
        'REP_VEHICLE_NOT_ASSIGNED', 403,
      );
      await expectCode(
        vanService.recordFuelLog(TENANT, ACCOUNT, REP_B, { vehicleId: VEH_B, tripId: TRIP_A, odometer: 20100, liters: 10, pricePerLiter: 15 }),
        'REP_TRIP_NOT_OWNED', 403,
      );
      assert.equal(
        await countRows('fleet_fuel_logs', (q: any) => q.where('vehicle_id', '=', VEH_A)),
        0, 'no fuel row was written for the refused vehicle',
      );
      assert.equal(await vehicleOdometer(VEH_A), odoBefore, 'the odometer did not move on refusal');
      const ok = await vanService.recordFuelLog(TENANT, ACCOUNT, REP_A, { vehicleId: VEH_A, tripId: TRIP_A, odometer: 10100, liters: 10, pricePerLiter: 15 });
      assert.equal(ok.ok, true);
      assert.equal(ok.totalCost, 150, 'fuel cost is 10 litres at 15');
      assert.equal(await vehicleOdometer(VEH_A), 10100, 'the accepted write bumps the odometer');
      // Pool vehicle with no assignment: the caller's own open trip
      // naming it is the anchor.
      const okPool = await vanService.recordFuelLog(TENANT, ACCOUNT, REP_A, { vehicleId: VEH_POOL, tripId: TRIP_A_POOL, odometer: 5100, liters: 20, pricePerLiter: 15 });
      assert.equal(okPool.ok, true);
      assert.equal(await vehicleOdometer(VEH_POOL), 5100, 'the trip-anchored fuel write bumps the pool odometer');
      console.log('  (8) B fuel on A vehicle/trip refused, owner’s fuel recorded passed');
    }

    // (9) Rep B oil change on rep A's vehicle -> refused, no row, the
    // prior active oil-change row stays active, odometer unchanged.
    {
      const odoBefore = await vehicleOdometer(VEH_A);
      await expectCode(
        vanService.recordOilChange(TENANT, ACCOUNT, REP_B, {
          vehicleId: VEH_A, odometerAtChange: 10200, oilType: '10W-40', ratedKm: 5000, withFilter: true,
        }),
        'REP_VEHICLE_NOT_ASSIGNED', 403,
      );
      assert.equal(
        await countRows('fleet_oil_changes', (q: any) => q.where('vehicle_id', '=', VEH_A)),
        1, 'no oil-change row was written for the refused vehicle',
      );
      assert.deepEqual(await oilRowStatus(VEH_A), ['active'], 'the prior active oil change is untouched');
      assert.equal(await vehicleOdometer(VEH_A), odoBefore, 'the odometer did not move on refusal');
      const ok = await vanService.recordOilChange(TENANT, ACCOUNT, REP_A, {
        vehicleId: VEH_A, odometerAtChange: 10500, oilType: '10W-40', ratedKm: 5000, withFilter: true,
      });
      assert.equal(ok.ok, true);
      assert.equal(ok.nextDueOdometer, 15500, 'next due is change odometer + rated km');
      assert.deepEqual(await oilRowStatus(VEH_A), ['completed', 'active'], 'the accepted change completes the prior row and opens a new one');
      assert.equal(await vehicleOdometer(VEH_A), 10500, 'the accepted write bumps the odometer');
      console.log('  (9) B oil change on A vehicle refused, owner’s change recorded passed');
    }

    // (10) Positive control, end to end on the owner's own visit: the
    // refusals above left the visit usable — inventory, then the
    // collection checkout in (4b), already proved it. A second own
    // inventory write still lands.
    {
      const ok = await fieldExecution.recordVisitInventory(
        TENANT, VISIT_A, { items: [{ productId: 7, productName: 'Tea', qtyOnShelf: 12 }] }, REP_A,
      );
      assert.equal(ok.ok, true);
      assert.equal(ok.itemsCount, 1);
      const after = await visitRow(VISIT_A);
      assert.equal(JSON.parse(String(after.store_inventory)).length, 1, 'the owner’s inventory landed');
      assert.equal(Number(after.collection_amount), 50, 'the earlier anchored checkout amount is still there');
      console.log('  (10) owner writes still succeed end to end passed');
    }

    // (11) PIN gate (H4 ride-along) through the REAL controller: a
    // default-PIN driver is refused on van-sales driver endpoints and
    // the service is never reached; after the PIN change the same
    // endpoint passes through.
    {
      const loginDefault = await repsService.driverLogin({ phone: '01000000003', pinCode: '1234' });
      assert.equal(loginDefault.mustChangePin, true);
      await expectCode(
        controller.recordVisitInventory(loginDefault.token, VISIT_DEFAULT, { items: [{ productId: 1, productName: 'X', qtyOnShelf: 1 }] }),
        'PIN_CHANGE_REQUIRED', 403,
      );
      assert.equal(
        await visitRow(VISIT_DEFAULT).then((v: any) => v.store_inventory), '[]',
        'the PIN-refused inventory write never reached the service',
      );
      await expectCode(
        controller.recordPackagingMovement(loginDefault.token, TRIP_DEFAULT, {
          customerId: CUST_A, packageType: 'crate_plastic', deliveredQty: 1, returnedQty: 0,
        }),
        'PIN_CHANGE_REQUIRED', 403,
      );
      assert.equal(
        await countRows('van_trip_packaging_movements', (q: any) => q.where('trip_id', '=', TRIP_DEFAULT)),
        0, 'the PIN-refused packaging write never reached the service',
      );
      const driver = await repsService.verifyDriverToken(loginDefault.token);
      const changed = await repsService.driverChangePin(driver, { currentPin: '1234', newPin: '5829' });
      assert.equal(changed.mustChangePin, false);
      const ok = await controller.recordVisitInventory(changed.token, VISIT_DEFAULT, { items: [{ productId: 1, productName: 'X', qtyOnShelf: 1 }] });
      assert.equal(ok.ok, true);
      assert.equal(JSON.parse(String((await visitRow(VISIT_DEFAULT)).store_inventory)).length, 1, 'after the PIN change the endpoint passes through');
      console.log('  (11) default-PIN driver refused on van-sales endpoints, passes after change passed');
    }

    // (12) Admin path still works: staff callers pass repId null, so
    // no ownership gate fires, while the checkout amount anchor
    // (linked sale exists) still applies.
    {
      const okInv = await fieldExecution.recordVisitInventory(
        TENANT, VISIT_B, { items: [{ productId: 2, productName: 'Y', qtyOnShelf: 3 }] }, null,
      );
      assert.equal(okInv.ok, true);
      const okFuel = await vanService.recordFuelLog(TENANT, ACCOUNT, null, {
        vehicleId: VEH_A, odometer: 10600, liters: 5, pricePerLiter: 15,
      });
      assert.equal(okFuel.ok, true);
      assert.equal(await vehicleOdometer(VEH_A), 10600, 'the staff fuel write bumps the odometer');
      const okOil = await vanService.recordOilChange(TENANT, ACCOUNT, null, {
        vehicleId: VEH_B, odometerAtChange: 20100, oilType: '5W-30', ratedKm: 10000, withFilter: false,
      });
      assert.equal(okOil.ok, true);
      assert.equal(await vehicleOdometer(VEH_B), 20100, 'the staff oil write bumps the odometer');
      const okOut = await fieldExecution.checkOutVisit(TENANT, VISIT_B, { saleId: SALE_B }, null);
      assert.equal(okOut.ok, true);
      assert.equal(Number((await visitRow(VISIT_B)).sale_amount), 200, 'the staff checkout derives the linked sale amount');
      const reads = await vanService.getTripPackagingMovements(TRIP_A, TENANT);
      assert.equal(reads.length, 1, 'the staff packaging read still lists the trip’s movement');
      console.log('  (12) admin path still works passed');
    }

    // Source pins: the guards are wired where the caller reaches them.
    {
      const here = __dirname;
      const fieldSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-field-execution.service.ts'), 'utf8');
      const fleetSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-fleet.service.ts'), 'utf8');
      const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-expenses-packaging-customers.service.ts'), 'utf8');
      const controllerSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.controller.ts'), 'utf8');
      assert.ok(fieldSource.includes('INV-REP-DRIVER-WRITES-OWNERSHIP'), 'the field-execution fix names its invariant');
      assert.ok(fieldSource.includes('REP_VISIT_NOT_OWNED'), 'the visit guard names its error code');
      assert.ok(fieldSource.includes('REP_VISIT_SALE_UNVERIFIED'), 'the checkout amount guard names its error code');
      assert.ok(fieldSource.includes('REP_VISIT_COLLECTION_UNVERIFIED'), 'the checkout collection guard names its error code');
      assert.ok(fleetSource.includes('assertVehicleUsableByRep'), 'the fleet gate exists');
      assert.ok(fleetSource.includes('REP_VEHICLE_NOT_ASSIGNED'), 'the fleet gate names its error code');
      const pkgAt = vanSource.indexOf('async recordPackagingMovement(');
      assert.ok(pkgAt > 0, 'recordPackagingMovement exists');
      assert.ok(
        vanSource.slice(pkgAt, pkgAt + 2000).includes('assertTripOwnedByRep'),
        'the packaging write asserts trip ownership before inserting',
      );
      assert.ok(!vanSource.slice(pkgAt, pkgAt + 2000).includes('rep_id:'), 'no rep_id column was invented on the packaging row');
      assert.ok(controllerSource.includes('private async verifyDriver(authHeader: string)'), 'the controller routes driver calls through one PIN-gated helper');
      assert.ok(controllerSource.includes('assertDriverPinChanged(driver)'), 'the helper calls the H4 PIN gate');
      assert.ok(
        controllerSource.includes('recordVisitInventory(driver.tenantId, id, body, driver.repId)'),
        'the controller forwards the caller repId into the visit inventory write',
      );
      assert.ok(
        controllerSource.includes('checkOutVisit(driver.tenantId, id, body, driver.repId)'),
        'the controller forwards the caller repId into the visit check-out',
      );
      const ungatedTokenCalls = controllerSource.split('this.deliveryRepsService.verifyDriverToken(authHeader);').length - 1;
      assert.equal(ungatedTokenCalls, 1, 'exactly one raw verifyDriverToken call remains, inside the PIN-gated helper');
      const gatedHelperCalls = controllerSource.split('this.verifyDriver(authHeader)').length - 1;
      assert.ok(gatedHelperCalls >= 49, 'every driver endpoint routes through the PIN-gated helper');
      console.log('  source pins passed');
    }

    console.log('rep-driver-writes-ownership-m16: all cases passed');
  } finally {
    await db.destroy();
    if (savedSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSecret;
  }
}

main()
  .then(async () => {
    console.log('rep-driver-writes-ownership-m16: all cases passed');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
