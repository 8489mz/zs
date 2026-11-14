/*
 * New file: backend/test/critical/van-trip-started-audit.spec.ts
 *
 * WHAT THIS PINS (INV-VAN-TRIP-STARTED-AUDIT): opening a van trip
 * (openTripAndLoad — the "بدء الرحلة مباشرة" direct start and the
 * load-and-start path) wrote NO audit row at all, so a trip's start
 * was invisible in the admin audit log while its end (settlement)
 * is audited — the live trial opened trip #5 and a search for "رحلة"
 * in the audit log returned 0 records. M18
 * (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION) deliberately scoped itself
 * to van MONEY actions only, so trip start was never in its audited
 * set; this package closes that lifecycle gap with the same pattern:
 * one logWithExecutor row in the same transaction as the trip insert
 * (a rolled-back open leaves no audit trace), naming the real actor
 * via resolveVanMoneyAuditActor (the acting rep's linked login, or
 * null with the rep named in the details when the rep has no linked
 * login — never 0, never the tenant's first user).
 *
 * WHAT IS DRIVEN (real PGlite, real service method, real AuditService
 * — no mocks except the two seams the production code itself owns: a
 * stubbed accountingPosting / recordSuspicionEvent / resolveSystemAuthContext,
 * none of which the items:[] open path touches):
 * (a) opening a trip with no items writes exactly one audit_logs row
 *     with event_code VAN_TRIP_STARTED, naming the rep in its details
 *     (created_by null when the rep has no linked login);
 * (b) a rep WITH a linked login (users row whose phone matches the
 *     rep's phone) is named by that user id in created_by;
 * (c) a refused second open (TRIP_ALREADY_OPEN) writes no second row.
 *
 * NOT DRIVEN: load-requisition transition audit (submit / review /
 * approve / dispatch / reject — van-requisitions.service.ts still has
 * zero audit calls; separate follow-up), supplementary-load audit,
 * return approve/reject audit; a live Postgres run (PGlite only); the
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
import { AuditService } from '../../src/core/audit/audit.service';

const TENANT = 't1';
const ACCOUNT = 'a1';
const REP_ID = 4;
const REP_PHONE = '01099990001';

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
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, stock_qty numeric DEFAULT 0, is_active boolean DEFAULT true, default_location_id bigint, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, display_name text, phone text, pin text, pin_hash text, permissions_json text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, end_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric DEFAULT 0, stock_variance_amount numeric DEFAULT 0, stock_variance_details text, night_stock_approved boolean, night_stock_approved_by bigint, night_stock_notes text, distance_km numeric, notes text, opened_at timestamptz, submitted_at timestamptz, closed_at timestamptz, settled_by bigint, supervisor_id bigint, updated_at timestamptz);
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, idempotency_key text, created_at timestamptz DEFAULT NOW());
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

async function seedRep(db: Kysely<Database>, repId: number, phone: string | null): Promise<void> {
  await (db as any).insertInto('delivery_representatives').values({
    id: repId, tenant_id: TENANT, account_id: ACCOUNT, name: `Rep ${repId}`,
    phone, vehicle_plate: null, van_location_id: 10, employee_id: null, national_id: null,
  }).execute();
}

async function auditRows(db: Kysely<Database>, eventCode: string): Promise<any[]> {
  return (db as any)
    .selectFrom('audit_logs')
    .selectAll()
    .where('tenant_id', '=', TENANT)
    .where('event_code', '=', eventCode)
    .orderBy('id', 'asc')
    .execute();
}

function buildVanService(db: Kysely<Database>): any {
  const service = Object.create(VanSalesService.prototype);
  service.db = db;
  service.audit = new AuditService(db as any);
  service.accountingPosting = {
    postVanTripSettlement: async () => 1,
    postVanStockTransfer: async () => 1,
  };
  service.recordSuspicionEvent = async () => undefined;
  service.resolveSystemAuthContext = async () => ({
    userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
    permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
  });
  return service;
}

async function main(): Promise<void> {
  // (a) Opening a trip with no items writes exactly one
  // VAN_TRIP_STARTED row naming the rep (created_by null: this rep
  // has no linked login).
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db, REP_ID, null);
      const service = buildVanService(db);
      const opened = await service.openTripAndLoad(REP_ID, TENANT, ACCOUNT, { items: [] });
      assert.equal(opened.ok, true, 'the trip opens');
      assert.ok(Number(opened.tripId) > 0, 'the trip has an id');
      const rows = await auditRows(db, 'VAN_TRIP_STARTED');
      assert.equal(rows.length, 1, 'exactly one trip-started audit row');
      assert.equal(rows[0].created_by, null, 'no linked login means created_by null, never 0 or the first user');
      assert.ok(String(rows[0].details).includes(`Rep ${REP_ID}`), 'the details name the rep');
      assert.ok(String(rows[0].details).includes(String(opened.tripId)), 'the details name the trip id');
      assert.equal(rows[0].tenant_id, TENANT, 'the row is tenant-scoped');
    } finally {
      await db.destroy();
    }
    console.log('  (a) trip open writes one VAN_TRIP_STARTED row passed');
  }

  // (b) A rep WITH a linked login is named by that user id.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db, REP_ID, REP_PHONE);
      await (db as any).insertInto('users').values({
        id: 77, tenant_id: TENANT, username: REP_PHONE, display_name: 'Rep 4',
        phone: REP_PHONE, pin: null, pin_hash: null, permissions_json: null,
        default_branch_id: 1, role: 'driver', password_hash: null,
        password_salt: null, is_active: true,
      }).execute();
      const service = buildVanService(db);
      const opened = await service.openTripAndLoad(REP_ID, TENANT, ACCOUNT, { items: [] });
      assert.equal(opened.ok, true, 'the trip opens');
      const rows = await auditRows(db, 'VAN_TRIP_STARTED');
      assert.equal(rows.length, 1, 'exactly one trip-started audit row');
      assert.equal(Number(rows[0].created_by), 77, 'created_by is the rep linked login');
      assert.ok(String(rows[0].details).includes(`Rep ${REP_ID}`), 'the details still name the rep');
    } finally {
      await db.destroy();
    }
    console.log('  (b) linked-login rep is named by user id passed');
  }

  // (c) A refused second open writes no second row.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedRep(db, REP_ID, null);
      const service = buildVanService(db);
      const opened = await service.openTripAndLoad(REP_ID, TENANT, ACCOUNT, { items: [] });
      assert.equal(opened.ok, true, 'the first trip opens');
      await assert.rejects(
        () => service.openTripAndLoad(REP_ID, TENANT, ACCOUNT, { items: [] }),
        /TRIP_ALREADY_OPEN/,
        'the second open is refused',
      );
      const rows = await auditRows(db, 'VAN_TRIP_STARTED');
      assert.equal(rows.length, 1, 'still exactly one trip-started row — the refusal wrote none');
    } finally {
      await db.destroy();
    }
    console.log('  (c) refused second open writes no second row passed');
  }

  // Source pins: the code exists, and the call sits in openTripAndLoad.
  {
    const here = __dirname;
    const auditSource = readFileSync(resolve(here, '../../src/core/audit/audit.service.ts'), 'utf8');
    assert.ok(
      auditSource.includes("VAN_TRIP_STARTED: 'VAN_TRIP_STARTED'"),
      'AUDIT_EVENT_CODES declares VAN_TRIP_STARTED',
    );
    const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-trip-lifecycle.service.ts'), 'utf8');
    assert.ok(
      vanSource.includes('eventCode: AUDIT_EVENT_CODES.VAN_TRIP_STARTED'),
      'openTripAndLoad writes the trip-started audit row',
    );
    assert.ok(
      vanSource.includes('INV-VAN-TRIP-STARTED-AUDIT'),
      'van-sales names the invariant',
    );
    console.log('  source pins passed');
  }

  console.log('Van trip started audit tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
