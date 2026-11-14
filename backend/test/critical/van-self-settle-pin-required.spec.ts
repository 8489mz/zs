/*
 * New file: backend/test/critical/van-self-settle-pin-required.spec.ts
 *
 * WHAT THIS PINS (INV-VAN-SELF-SETTLE-PIN-REQUIRED): self-settlement by
 * the rep was the default. The supervisor-PIN requirement defaulted to
 * false (no settings row meant no PIN), the driver settle endpoint
 * called settleTrip with authContext=undefined whenever no PIN was
 * supplied so the maker-checker check never ran, the controller
 * auto-approved night stock from `!unloadRemainingToWarehouse`, and
 * the rep's own phone decided chargeStockVarianceToRep (default true
 * in the UI) — the person charged decided whether his own shortage was
 * charged or waived (1160 rep receivable vs 7200 warehouse loss).
 *
 * WHAT IS DRIVEN (real PGlite, real service + real driver controller —
 * the only stubs are the two seams the production code itself owns:
 * stubbed postVanTripSettlement/postVanStockTransfer on the posting
 * service, and a stubbed driver-token verifier for the controller):
 * (1) the PIN requirement defaults to true with no settings row, and
 *     only an explicit false disables it (unparseable values fail
 *     closed to true);
 * (2) a driver settle with no PIN is refused SETTLEMENT_REQUIRES_SUPERVISOR_PIN;
 * (3) a driver settle with the rep's own admin credential is refused
 *     MAKER_CHECKER_SELF_APPROVAL;
 * (4) a driver settle with a valid supervisor PIN settles and runs
 *     maker-checker — PIN mode carries no attribution, so the trip
 *     records NO settler id (honest null, not the first supervisor);
 * (5) maker == checker is refused at the service level too;
 * (6) a rep-supplied chargeStockVarianceToRep=false on the driver path
 *     is ignored: the stock shortage stays pending on the rep and the
 *     posting is told to charge him (fail closed);
 * (7) the admin settle path is unchanged: a supervisor decision of
 *     false waives the shortage, true charges it;
 * (8) night stock without explicit approval is refused
 *     NIGHT_STOCK_UNAPPROVED, and with explicit approval + PIN it
 *     settles with night_stock_approved recorded (approved_by null:
 *     PIN mode carries no attribution);
 * (9) a legacy direct service call without authContext still settles
 *     (documented boundary: the four live-Postgres e2e suites call
 *     settleTrip that way; enforcement lives at the HTTP boundary and
 *     a future service-level guard must update those callers first).
 *
 * VERIFICATION (INV-VAN-SUPERVISOR-PIN-AUTHORIZED, F6): the plaintext
 * PIN comparison is gone — verifySupervisorPin now goes through the
 * shared authorizeManagerSecret rule. The fixtures moved with it: the
 * supervisor PIN is a bcrypt managerPin in settings, and the rep's
 * own credential is his admin login password (bcrypt). A plaintext
 * users.pin would never approve; PIN-mode approval attributes to no
 * user, so settled_by / supervisor_id / night_stock_approved_by are
 * null on PIN-approved settles. The frontend removal of the rep-side
 * checkbox is not driven here (no frontend runner in this VM); it is
 * verified by code inspection.
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
import { VanSalesController } from '../../src/modules/delivery-reps/van-sales.controller';
import { hashManagerPin } from '../../src/common/utils/manager-approval';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const TENANT = 't1';
const ACCOUNT = 'a1';

// Rep 4's phone links him to user 7 (his own login, an admin whose
// own password is '1111'); the supervisor PIN is the shared bcrypt
// managerPin in settings. User 1 is the admin used by the
// service-level (admin path) cases.
const adminAuth: any = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
};
const repAsAdminAuth: any = {
  userId: 7, sessionId: 'spec', username: 'rep7', role: 'admin',
  permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
};
const DRIVER = {
  repId: 4, tenantId: TENANT, accountId: ACCOUNT,
  name: 'Rep 4', phone: '5550001', tenantSuspended: false,
};

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, display_name text, phone text, role text, pin text, pin_hash text, password_hash text, password_salt text, permissions_json text, is_active boolean DEFAULT true);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, pin_hash text, vehicle_plate text, van_location_id bigint, employee_id bigint, national_id text, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric, plate_number text);
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, end_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric DEFAULT 0, stock_variance_amount numeric DEFAULT 0, stock_variance_details text, night_stock_approved boolean, night_stock_approved_by bigint, night_stock_notes text, distance_km numeric, notes text, opened_at timestamptz, submitted_at timestamptz, closed_at timestamptz, settled_by bigint, supervisor_id bigint, updated_at timestamptz);
    CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, amount numeric DEFAULT 0, created_at timestamptz DEFAULT NOW());
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, is_active boolean DEFAULT true, default_location_id bigint, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, notes text, settled_at timestamptz, settled_by bigint, settlement_method text, receipt_voucher_no text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
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
  // Supervisor approval is the bcrypt manager PIN in settings (the
  // shared rule); the rep's own login (id 7, phone = rep phone) is an
  // admin whose own login password is '1111'. The rep must never
  // authorize himself — his own credential is what case (3) refuses.
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: JSON.stringify(await hashManagerPin('4321')) }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'sup', display_name: 'Supervisor', phone: '5550002', role: 'supervisor', pin: null, pin_hash: null, password_hash: '', password_salt: '', permissions_json: null, is_active: true }).execute();
  const repPassword = await createPasswordRecord('1111');
  await anyDb.insertInto('users').values({ id: 7, tenant_id: TENANT, username: '5550001', display_name: 'Rep 4', phone: '5550001', role: 'admin', pin: null, pin_hash: null, password_hash: repPassword.hash, password_salt: repPassword.salt, permissions_json: null, is_active: true }).execute();
}

async function seedRep(db: Kysely<Database>): Promise<void> {
  await (db as any).insertInto('delivery_representatives').values({
    id: 4, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 4',
    phone: '5550001', pin_hash: null, vehicle_plate: null, van_location_id: 10,
    employee_id: null, national_id: null,
  }).execute();
}

async function seedTrip(db: Kysely<Database>, tripId: number): Promise<void> {
  await (db as any).insertInto('van_sales_trips').values({
    id: tripId, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 4, vehicle_id: null,
    start_odometer: 100, end_odometer: null, van_location_id: 10, source_warehouse_id: 1,
    status: 'open', settlement_status: 'open', loaded_amount: 0, sales_amount: 0,
    cash_collected: 0, credit_sales: 0, returns_amount: 0, cash_refunds: 0,
    total_instapay_sales: 0, total_instapay_collections: 0, variance: 0,
  }).execute();
}

// Van holds 10 units of product 1 at cost 5. Counting 8 leaves a
// shortage of 2 units = 10.00, the amount the charge/waive decision
// turns into a pending rep claim (charge) or a waived loss (waive).
async function seedVanStock(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('products').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Item', name_en: 'Item',
    barcode: '1', cost_price: 5, retail_price: 10, stock_qty: 10, reserved_qty: 0,
    is_active: true, default_location_id: 1,
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 1, branch_id: 1,
    location_id: 10, qty: 10, reserved_qty: 0,
  }).execute();
}

async function tripRow(db: Kysely<Database>, tripId: number): Promise<any> {
  return (db as any).selectFrom('van_sales_trips').selectAll().where('id', '=', tripId).executeTakeFirst();
}

async function stockShortageRows(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('van_rep_financial_settlements').selectAll().where('entry_type', '=', 'stock_shortage').execute();
}

function buildService(db: any, postCalls: unknown[]): any {
  const service = Object.create(VanSalesService.prototype);
  service.db = db;
  service.accountingPosting = {
    postVanTripSettlement: async (_trx: unknown, _tripId: number, params: unknown, _auth: unknown) => {
      postCalls.push(params);
      return 1;
    },
    postVanStockTransfer: async () => 1,
  };
  service.recordSuspicionEvent = async () => undefined;
  service.vanFraudRadarService = { recordSuspicionEvent: async () => undefined };
  service.resolveSystemAuthContext = async () => adminAuth;
  return service;
}

function buildController(service: any): any {
  const controller = Object.create(VanSalesController.prototype);
  controller.vanSalesService = service;
  controller.deliveryRepsService = {
    verifyDriverTokenForSettlement: async () => ({ ...DRIVER }),
  };
  return controller;
}

async function main(): Promise<void> {
  // (1) The PIN requirement defaults to true: no settings row, and an
  // unparseable value, both fail closed. Only an explicit false turns
  // the PIN off.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      const service = buildService(db, []);
      assert.equal(await service.isSupervisorPinRequiredForSettlement(TENANT), true, 'no settings row means PIN required');
      await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'vanSettlementRequireSupervisorPin', value: 'false' }).execute();
      assert.equal(await service.isSupervisorPinRequiredForSettlement(TENANT), false, 'explicit false disables the PIN');
      await (db as any).updateTable('settings').set({ value: 'maybe' }).where('tenant_id', '=', TENANT).where('key', '=', 'vanSettlementRequireSupervisorPin').execute();
      assert.equal(await service.isSupervisorPinRequiredForSettlement(TENANT), true, 'an unparseable value fails closed to PIN required');
      await (db as any).updateTable('settings').set({ value: 'true' }).where('tenant_id', '=', TENANT).where('key', '=', 'vanSettlementRequireSupervisorPin').execute();
      assert.equal(await service.isSupervisorPinRequiredForSettlement(TENANT), true, 'explicit true keeps the PIN required');
    } finally {
      await db.destroy();
    }
    console.log('  (1) PIN requirement defaults to true passed');
  }

  // (2) Driver settle with no PIN is refused; the trip stays open.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db);
      await seedTrip(db, 11);
      const postCalls: unknown[] = [];
      const controller = buildController(buildService(db, postCalls));
      await assert.rejects(
        () => controller.settleTrip('Bearer driver', {
          tripId: 11, countedCash: 0, unloadRemainingToWarehouse: true,
        }),
        /SETTLEMENT_REQUIRES_SUPERVISOR_PIN/,
      );
      assert.equal((await tripRow(db, 11)).status, 'open', 'the refused settle leaves the trip open');
      assert.equal(postCalls.length, 0, 'no posting was attempted');
    } finally {
      await db.destroy();
    }
    console.log('  (2) driver settle without PIN refused passed');
  }

  // (3) Driver settle with the rep's own admin credential is refused
  // (maker == checker, even when the rep holds an admin role on his
  // own login).
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db);
      await seedTrip(db, 11);
      const controller = buildController(buildService(db, []));
      await assert.rejects(
        () => controller.settleTrip('Bearer driver', {
          tripId: 11, countedCash: 0, unloadRemainingToWarehouse: true,
          supervisorPin: '1111',
        }),
        /MAKER_CHECKER_SELF_APPROVAL/,
      );
      assert.equal((await tripRow(db, 11)).status, 'open', 'the self-approved settle leaves the trip open');
    } finally {
      await db.destroy();
    }
    console.log('  (3) driver settle with the rep’s own PIN refused passed');
  }

  // (4) Driver settle with a valid supervisor PIN settles and runs
  // maker-checker. PIN mode carries no attribution, so the trip
  // records NO settler id (honest null — the old "first supervisor
  // by id" attribution was false and is gone).
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db);
      await seedTrip(db, 11);
      const controller = buildController(buildService(db, []));
      const result = await controller.settleTrip('Bearer driver', {
        tripId: 11, countedCash: 0, unloadRemainingToWarehouse: true,
        supervisorPin: '4321',
      });
      assert.equal(result.status, 'settled', 'the supervisor-PIN settle completes');
      const trip = await tripRow(db, 11);
      assert.equal(trip.status, 'settled', 'the trip is settled');
      assert.equal(trip.settled_by, null, 'PIN mode attributes the approval to no user');
      assert.equal(trip.supervisor_id, null, 'PIN mode records no supervisor id');
    } finally {
      await db.destroy();
    }
    console.log('  (4) driver settle with supervisor PIN settles passed');
  }

  // (5) Maker == checker is refused at the service level too: the
  // settling actor is the rep's own linked user. (9) shares this DB:
  // a legacy direct service call without an authContext still settles.
  // The four live-Postgres e2e suites call settleTrip that way, and no
  // production HTTP caller does — both controllers always pass an
  // authContext now. Enforcement lives at the HTTP boundary; a future
  // service-level guard must update those e2e callers first.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db);
      await seedTrip(db, 11);
      await seedTrip(db, 12);
      const service = buildService(db, []);
      await assert.rejects(
        () => service.settleTrip(4, TENANT, ACCOUNT, {
          tripId: 11, countedCash: 0, unloadRemainingToWarehouse: true, endOdometer: 120,
        }, repAsAdminAuth),
        /MAKER_CHECKER_SELF_APPROVAL/,
      );
      assert.equal((await tripRow(db, 11)).status, 'open', 'the refused settle leaves the trip open');
      const legacy = await service.settleTrip(4, TENANT, ACCOUNT, {
        tripId: 12, countedCash: 0, unloadRemainingToWarehouse: true, endOdometer: 120,
      });
      assert.equal(legacy.status, 'settled', 'the legacy direct call still settles');
    } finally {
      await db.destroy();
    }
    console.log('  (5) service-level maker == checker refused passed');
    console.log('  (9) legacy direct service call without authContext settles passed');
  }

  // (6) A rep-supplied chargeStockVarianceToRep=false on the driver
  // path is ignored: the 10.00 shortage stays pending on the rep and
  // the posting is told to charge him — the rep cannot waive his own
  // shortage into a warehouse loss.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db);
      await seedTrip(db, 11);
      await seedVanStock(db);
      const postCalls: any[] = [];
      const controller = buildController(buildService(db, postCalls));
      const result = await controller.settleTrip('Bearer driver', {
        tripId: 11, countedCash: 0, unloadRemainingToWarehouse: true,
        countedStock: [{ productId: 1, countedQty: 8 }],
        chargeStockVarianceToRep: false,
        supervisorPin: '4321',
      });
      assert.equal(result.status, 'settled', 'the settle completes');
      assert.equal(result.stockVarianceAmount, 10, 'the shortage is 2 units at cost 5');
      const rows = await stockShortageRows(db);
      assert.equal(rows.length, 1, 'exactly one stock shortage row');
      assert.equal(Number(rows[0].amount), 10, 'the shortage amount is 10.00');
      assert.equal(rows[0].status, 'pending', 'the shortage stays pending on the rep, not waived');
      assert.equal(postCalls.length, 1, 'one settlement posting');
      assert.equal(postCalls[0].chargeStockVarianceToRep, true, 'the posting charges the rep');
    } finally {
      await db.destroy();
    }
    console.log('  (6) rep-supplied charge flag ignored on the driver path passed');
  }

  // (7) The admin settle path is unchanged: a supervisor decision of
  // false waives the shortage (and posts it waived), true charges it.
  // Both sub-cases share one DB; the van stock is re-seeded between
  // them because the first settle unloads it.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db);
      await seedTrip(db, 11);
      await seedTrip(db, 12);
      await seedVanStock(db);
      const postCalls: any[] = [];
      const service = buildService(db, postCalls);
      const result = await service.settleTrip(4, TENANT, ACCOUNT, {
        tripId: 11, countedCash: 0, unloadRemainingToWarehouse: true, endOdometer: 120,
        countedStock: [{ productId: 1, countedQty: 8 }],
        chargeStockVarianceToRep: false,
        chargeStockVarianceDecidedBySupervisor: true,
      }, adminAuth);
      assert.equal(result.status, 'settled', 'the admin settle completes');
      let rows = await stockShortageRows(db);
      assert.equal(rows.length, 1, 'exactly one stock shortage row');
      assert.equal(rows[0].status, 'waived', 'the supervisor’s waive decision is honored');
      assert.equal(rows[0].settlement_method, 'waiver', 'the waiver is recorded');
      assert.equal(postCalls[0].chargeStockVarianceToRep, false, 'the posting waives the shortage');
      // Re-seed the van stock for the charge sub-case (product row
      // already exists; only the location balance is restored).
      await (db as any).deleteFrom('product_location_stock').execute();
      await (db as any).updateTable('products').set({ stock_qty: 10 }).execute();
      await (db as any).insertInto('product_location_stock').values({
        tenant_id: TENANT, account_id: ACCOUNT, product_id: 1, branch_id: 1,
        location_id: 10, qty: 10, reserved_qty: 0,
      }).execute();
      await service.settleTrip(4, TENANT, ACCOUNT, {
        tripId: 12, countedCash: 0, unloadRemainingToWarehouse: true, endOdometer: 120,
        countedStock: [{ productId: 1, countedQty: 8 }],
        chargeStockVarianceToRep: true,
        chargeStockVarianceDecidedBySupervisor: true,
      }, adminAuth);
      rows = await stockShortageRows(db);
      assert.equal(rows.length, 2, 'one shortage row per settled trip');
      assert.equal(rows[1].status, 'pending', 'the supervisor’s charge decision is honored');
      assert.equal(postCalls[1].chargeStockVarianceToRep, true, 'the posting charges the rep');
    } finally {
      await db.destroy();
    }
    console.log('  (7a) admin settle waive decision honored passed');
    console.log('  (7b) admin settle charge decision honored passed');
  }

  // (8) Night stock without explicit approval is refused, even with a
  // valid supervisor PIN; with explicit approval + PIN it settles and
  // records the approval. Both sub-cases share one DB (the refusal
  // leaves trip 11 open and the stock untouched).
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db);
      await seedTrip(db, 11);
      await seedTrip(db, 12);
      await seedVanStock(db);
      const controller = buildController(buildService(db, []));
      await assert.rejects(
        () => controller.settleTrip('Bearer driver', {
          tripId: 11, countedCash: 0, unloadRemainingToWarehouse: false,
          countedStock: [{ productId: 1, countedQty: 10 }],
          supervisorPin: '4321',
        }),
        /NIGHT_STOCK_UNAPPROVED/,
      );
      assert.equal((await tripRow(db, 11)).status, 'open', 'the refused settle leaves the trip open');
      const result = await controller.settleTrip('Bearer driver', {
        tripId: 12, countedCash: 0, unloadRemainingToWarehouse: false,
        countedStock: [{ productId: 1, countedQty: 10 }],
        nightStockApproved: true,
        supervisorPin: '4321',
      });
      assert.equal(result.status, 'settled', 'the approved night-stock settle completes');
      const trip = await tripRow(db, 12);
      assert.equal(trip.night_stock_approved, true, 'night stock approval is recorded');
      assert.equal(trip.night_stock_approved_by, null, 'PIN mode attributes the approval to no user');
    } finally {
      await db.destroy();
    }
    console.log('  (8a) night stock without explicit approval refused passed');
    console.log('  (8b) night stock with explicit approval + PIN settles passed');
  }

  // Source pins: the invariant name is present in every touched
  // production file, the driver endpoint no longer derives night stock
  // approval from unload, and the rep-side checkbox is gone from the
  // settle tab. (The ARCHITECTURE_INVARIANTS.md entry itself is owned
  // by the coordinator and is not pinned here.)
  {
    const here = __dirname;
    const serviceSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-trip-lifecycle.service.ts'), 'utf8');
    assert.ok(serviceSource.includes('INV-VAN-SELF-SETTLE-PIN-REQUIRED'), 'service names the invariant');
    assert.ok(serviceSource.includes('chargeStockVarianceDecidedBySupervisor'), 'service carries the supervisor-decision flag');
    const controllerSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.controller.ts'), 'utf8');
    assert.ok(controllerSource.includes('INV-VAN-SELF-SETTLE-PIN-REQUIRED'), 'controller names the invariant');
    assert.ok(!controllerSource.includes('nightStockApproved: !body.unloadRemainingToWarehouse'), 'the controller no longer auto-approves night stock');
    const tabSource = readFileSync(resolve(here, '../../../frontend/src/features/delivery-reps/components/VanSettleTab.tsx'), 'utf8');
    assert.ok(tabSource.includes('INV-VAN-SELF-SETTLE-PIN-REQUIRED'), 'settle tab names the invariant');
    assert.ok(!tabSource.includes('setChargeStockVarianceToRep'), 'the rep-side charge checkbox is gone');
    const pageSource = readFileSync(resolve(here, '../../../frontend/src/features/delivery-reps/pages/VanSalesMobilePage.tsx'), 'utf8');
    assert.ok(pageSource.includes('INV-VAN-SELF-SETTLE-PIN-REQUIRED'), 'mobile page names the invariant');
    console.log('  source pins passed');
  }

  console.log('Van self-settle PIN-required tests passed');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
