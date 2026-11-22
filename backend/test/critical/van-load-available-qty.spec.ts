/*
 * New file: backend/test/critical/van-load-available-qty.spec.ts
 *
 * WHAT THIS PINS (F10 — trial problems 13 + 32): three different
 * "available" numbers disagreed BY CONSTRUCTION. The load form
 * (getDriverAvailableProducts) showed the raw on-hand qty, the
 * openTripAndLoad pre-check compared against the raw on-hand qty,
 * and the real gate (moveVanStock -> applyStockDelta) allowed only
 * on-hand MINUS reserved_qty — so a request for 19 pcs (1 carton of
 * 12 + 7 loose), exactly the on-hand qty, failed at the gate with
 * "رصيد غير كافٍ لتنفيذ حركة سيارة التوزيع" while the form had shown
 * 19, and the form and the server reported different availables
 * (2/3 vs 0). The fix is one canonical function,
 * computeVanLoadAvailableQty (location-stock-ledger.ts) — the minimum
 * of the ledger's location leg and global leg, i.e. exactly what the
 * gate enforces — read by the form, by both trip-open pre-checks,
 * and by the admin review list, plus surfacing of the pending load
 * requisitions that will draw from the same stock.
 *
 * WHAT IS DRIVEN (real PGlite, real service methods — the only stubs
 * are the seams production itself owns: a stubbed audit sink, a
 * stubbed postVanStockTransfer, and resolveSystemAuthContext):
 * (a) 19 pcs (1 carton of 12 + 7 loose) at exactly the available qty
 *     LOADS when unreserved — form, pre-check and gate agree on 19;
 * (b) the same 19 FAILS when 7 pcs are reserved — the pre-check
 *     refuses with INSUFFICIENT_SOURCE_STOCK naming available 12,
 *     the form shows available 12 against on-hand 19, and no trip
 *     is created;
 * (c) one number, three places: form available == pre-check number
 *     in the thrown message == gate number from the ledger, and the
 *     real gate refuses -13 but allows -12;
 * (d) surfacing: a pending requisition (REQ-261121-0002, 25 pcs)
 *     appears in the form's pendingHolds and is named in the
 *     pre-check failure — while NOT reducing the available number
 *     (a pending permit reserves nothing; it only waits to draw);
 * (e) fully reserved stock reads available 0 while on-hand stays 19
 *     (problem 32's "0" against the form's on-hand number);
 * (f) the supplementary-load pre-check uses the same canonical
 *     number — it refuses 19 when 7 are reserved and loads 12.
 *
 * NOT DRIVEN: the stuck trial permit REQ-261121-0002 itself (trial
 * data on test10k, not code — no data fix here); true two-connection
 * concurrency (PGlite is single-connection); the frontend screens
 * (their clamp reads the same availableQty field, CI typechecks).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanRequisitionsService } from '../../src/modules/delivery-reps/services/van-requisitions.service';
import { TripOpenLoadService } from '../../src/modules/delivery-reps/services/van-trip-lifecycle/trip-open-load.service';
import {
  getOrCreateVanLocation,
  moveVanStock,
  sortItemsByProductId,
} from '../../src/modules/delivery-reps/services/van-common.util';
import { moveVanInventoryBatches } from '../../src/modules/delivery-reps/services/van-inventory-batches.helper';
import { StockBatchHelpersService } from '../../src/modules/delivery-reps/van-sales/stock-batch-helpers';
import {
  computeVanLoadAvailableQty,
  getLocationAvailability,
  reserveLocationStock,
} from '../../src/common/utils/location-stock-ledger';

const TENANT = 't1';
const ACCOUNT = 'a1';
const REP = 4;
const WAREHOUSE = 1;
const VAN_LOC = 10;
const PRODUCT = 1;
const ON_HAND = 19;
const CARTON = 12;

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
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, end_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, business_day date, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric DEFAULT 0, stock_variance_amount numeric DEFAULT 0, stock_variance_details text, night_stock_approved boolean, night_stock_approved_by bigint, night_stock_notes text, distance_km numeric, notes text, opened_at timestamptz, submitted_at timestamptz, closed_at timestamptz, settled_by bigint, supervisor_id bigint, updated_at timestamptz);
    CREATE TABLE van_load_requisitions (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, rep_id bigint, source_warehouse_id bigint, status text, requested_items text, approved_items text, notes text, rejection_reason text, trip_id bigint, reviewed_by bigint, reviewed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE suppliers (id bigint PRIMARY KEY, name text);
    CREATE TABLE product_categories (id bigint PRIMARY KEY, name text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, supplier_id bigint, category_id bigint, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, is_active boolean DEFAULT true, default_location_id bigint, metadata text, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE product_units (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, name text, multiplier numeric DEFAULT 1, is_base_unit boolean DEFAULT false);
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number text, expiry_date text, quantity numeric DEFAULT 0, location_id bigint, status text, unit_cost numeric DEFAULT 0, supplier_name text, updated_at timestamptz);
    CREATE TABLE inventory_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number text, expiry_date text, quantity numeric DEFAULT 0, location_id bigint, status text, unit_cost numeric DEFAULT 0, supplier_name text, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric DEFAULT 0, before_qty numeric DEFAULT 0, after_qty numeric DEFAULT 0, unit_cost numeric DEFAULT 0, total_cost numeric DEFAULT 0, reason text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: WAREHOUSE, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Warehouse', code: 'WH', is_active: true, location_type: 'branch_stock' }).execute();
  await anyDb.insertInto('stock_locations').values({ id: VAN_LOC, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Van', code: 'VAN_4', is_active: true, location_type: 'van_stock' }).execute();
  await anyDb.insertInto('delivery_representatives').values({
    id: REP, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 4',
    phone: null, vehicle_plate: null, van_location_id: VAN_LOC, employee_id: null, national_id: null,
  }).execute();
  await anyDb.insertInto('products').values({
    id: PRODUCT, tenant_id: TENANT, account_id: ACCOUNT, name: 'صنف التحميل',
    barcode: '6220000000019', supplier_id: null, category_id: null,
    cost_price: 10, retail_price: 20, stock_qty: ON_HAND, reserved_qty: 0, is_active: true,
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: PRODUCT,
    branch_id: null, location_id: WAREHOUSE, qty: ON_HAND, reserved_qty: 0,
  }).execute();
  await anyDb.insertInto('product_units').values({ tenant_id: TENANT, product_id: PRODUCT, name: 'قطعة', multiplier: 1, is_base_unit: true }).execute();
  await anyDb.insertInto('product_units').values({ tenant_id: TENANT, product_id: PRODUCT, name: 'كرتون', multiplier: CARTON, is_base_unit: false }).execute();
}

async function locationQty(db: Kysely<Database>, locationId: number): Promise<number> {
  const row = await (db as any)
    .selectFrom('product_location_stock')
    .select('qty')
    .where('product_id', '=', PRODUCT)
    .where('location_id', '=', locationId)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirst();
  return Number(row?.qty || 0);
}

function buildReqService(db: any): any {
  const service = Object.create(VanRequisitionsService.prototype);
  service.db = db;
  return service;
}

function buildTripService(db: any): any {
  const batchHelpers = new StockBatchHelpersService(db);
  const service = Object.create(TripOpenLoadService.prototype);
  service.db = db;
  service.audit = { logWithExecutor: async () => undefined };
  service.accountingPosting = { postVanStockTransfer: async () => 1 };
  service.getOrCreateVanLocation = (repId: number, tenantId: string, accountId: string) =>
    getOrCreateVanLocation(db, repId, tenantId, accountId);
  service.sortItemsByProductId = sortItemsByProductId;
  service.moveVanStock = moveVanStock;
  service.moveVanPharmacyBatches = (trx: any, scope: any, productId: number, qty: number, from: number, to: number) =>
    batchHelpers.moveVanPharmacyBatches(trx, scope, productId, qty, from, to);
  service.moveVanInventoryBatches = moveVanInventoryBatches;
  service.resolveSystemAuthContext = async () => adminAuth;
  return service;
}

async function formProduct(reqService: any, warehouseId?: number, repId?: number): Promise<any> {
  const products = await reqService.getDriverAvailableProducts(TENANT, warehouseId, repId);
  const found = (products || []).find((p: any) => Number(p.id) === PRODUCT);
  assert.ok(found, 'the product must be listed by the form');
  return found;
}

function assertPreCheckRefusal(error: any, expectedAvailable: number): void {
  assert.equal(error?.code, 'INSUFFICIENT_SOURCE_STOCK', 'the pre-check refuses with its own code, not the gate code');
  assert.match(
    String(error?.message || ''),
    new RegExp(`المتوفر للتحميل: ${expectedAvailable}`),
    'the refusal names the canonical available number',
  );
}

async function main(): Promise<void> {
  // (a) 19 pcs = 1 carton (12) + 7 loose, exactly the available qty,
  // loads when unreserved.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      const reqService = buildReqService(db);
      const tripService = buildTripService(db);
      const form = await formProduct(reqService, WAREHOUSE);
      assert.equal(form.availableQty, ON_HAND, 'form available is the full on-hand qty when nothing is reserved');
      assert.equal(form.onHandQty, ON_HAND, 'form on-hand is 19');
      assert.equal(form.totalStock, ON_HAND, 'totalStock keeps its on-hand meaning');
      assert.deepEqual(form.pendingHolds, [], 'no pending holds');
      const opened = await tripService.openTripAndLoad(REP, TENANT, ACCOUNT, {
        sourceWarehouseId: WAREHOUSE,
        items: [{ productId: PRODUCT, qty: ON_HAND }],
      });
      assert.equal(opened.ok, true, 'the exact-available load opens the trip');
      assert.ok(Number(opened.tripId) > 0, 'the trip has an id');
      assert.equal(Number(opened.totalLoadedValue), ON_HAND * 20, 'loaded value is 19 x retail 20');
      assert.equal(await locationQty(db, WAREHOUSE), 0, 'the source warehouse is emptied');
      assert.equal(await locationQty(db, VAN_LOC), ON_HAND, 'the van carries all 19 pcs');
    } finally {
      await db.destroy();
    }
    console.log('  (a) 19 pcs at exactly the available qty loads when unreserved passed');
  }

  // (b) The same 19 FAILS when 7 pcs are reserved: the pre-check
  // refuses naming available 12, and no trip is created.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await reserveLocationStock(db as any, {
        tenantId: TENANT, accountId: ACCOUNT, locationId: WAREHOUSE,
        items: [{ productId: PRODUCT, qty: 7 }],
      });
      const reqService = buildReqService(db);
      const tripService = buildTripService(db);
      const form = await formProduct(reqService, WAREHOUSE);
      assert.equal(form.availableQty, 12, 'form available nets the 7 reserved pcs off');
      assert.equal(form.onHandQty, ON_HAND, 'form on-hand still shows 19');
      assert.equal(form.reservedQty, 7, 'form reserved shows the 7 held pcs');
      await assert.rejects(
        () => tripService.openTripAndLoad(REP, TENANT, ACCOUNT, {
          sourceWarehouseId: WAREHOUSE,
          items: [{ productId: PRODUCT, qty: ON_HAND }],
        }),
        (e: any) => {
          assertPreCheckRefusal(e, 12);
          return true;
        },
      );
      assert.equal(
        await (db as any).selectFrom('van_sales_trips').selectAll().execute().then((r: any[]) => r.length),
        0, 'no trip was created by the refused load',
      );
      assert.equal(await locationQty(db, WAREHOUSE), ON_HAND, 'the source stock is untouched');
    } finally {
      await db.destroy();
    }
    console.log('  (b) 19 pcs fails when 7 are reserved, pre-check names 12 passed');
  }

  // (c) One number, three places: form == pre-check message == gate.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await reserveLocationStock(db as any, {
        tenantId: TENANT, accountId: ACCOUNT, locationId: WAREHOUSE,
        items: [{ productId: PRODUCT, qty: 7 }],
      });
      const reqService = buildReqService(db);
      const tripService = buildTripService(db);
      const formAvailable = (await formProduct(reqService, WAREHOUSE)).availableQty;
      assert.equal(formAvailable, 12, 'form available is 12');

      let preCheckAvailable: number | null = null;
      await assert.rejects(
        () => tripService.openTripAndLoad(REP, TENANT, ACCOUNT, {
          sourceWarehouseId: WAREHOUSE,
          items: [{ productId: PRODUCT, qty: 13 }],
        }),
        (e: any) => {
          const m = String(e?.message || '').match(/المتوفر للتحميل: (\d+(?:\.\d+)?)/);
          preCheckAvailable = m ? Number(m[1]) : null;
          assertPreCheckRefusal(e, 12);
          return true;
        },
      );
      assert.equal(preCheckAvailable, 12, 'pre-check available is 12');

      const gateAvailability = await getLocationAvailability(db as any, {
        tenantId: TENANT, accountId: ACCOUNT, productId: PRODUCT, locationId: WAREHOUSE,
      });
      const gateAvailable = computeVanLoadAvailableQty(gateAvailability);
      assert.equal(gateAvailable, 12, 'gate available is 12');
      assert.equal(formAvailable, preCheckAvailable, 'form == pre-check');
      assert.equal(formAvailable, gateAvailable, 'form == gate');

      // The real gate enforces the same number: -13 refuses, -12 moves.
      await assert.rejects(
        () => (db as any).transaction().execute(async (trx: any) => {
          await moveVanStock(trx, {
            productId: PRODUCT, delta: -13, locationId: WAREHOUSE,
            tenantId: TENANT, accountId: ACCOUNT, userId: null,
            movementType: 'van_load_out', note: 'spec probe', referenceType: 'van_sales_trip',
            referenceId: 0, skipGlobalUpdate: false, unitCost: 10,
          });
        }),
        (e: any) => e?.code === 'INSUFFICIENT_VAN_STOCK',
      );
      await (db as any).transaction().execute(async (trx: any) => {
        await moveVanStock(trx, {
          productId: PRODUCT, delta: -12, locationId: WAREHOUSE,
          tenantId: TENANT, accountId: ACCOUNT, userId: null,
          movementType: 'van_load_out', note: 'spec probe', referenceType: 'van_sales_trip',
          referenceId: 0, skipGlobalUpdate: false, unitCost: 10,
        });
      });
      assert.equal(await locationQty(db, WAREHOUSE), 7, 'exactly the 7 reserved pcs stay behind');
    } finally {
      await db.destroy();
    }
    console.log('  (c) one number, three places (form == pre-check == gate) passed');
  }

  // (d) Surfacing: a pending requisition shows as a hold and is named
  // in the pre-check failure — without reducing the available number.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await reserveLocationStock(db as any, {
        tenantId: TENANT, accountId: ACCOUNT, locationId: WAREHOUSE,
        items: [{ productId: PRODUCT, qty: 7 }],
      });
      await (db as any).insertInto('van_load_requisitions').values({
        tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'REQ-261121-0002', rep_id: REP,
        source_warehouse_id: WAREHOUSE, status: 'pending',
        requested_items: JSON.stringify([{ productId: PRODUCT, qty: 25, sourceWarehouseId: WAREHOUSE }]),
        approved_items: JSON.stringify([{ productId: PRODUCT, qty: 25, sourceWarehouseId: WAREHOUSE }]),
        notes: 'trial permit',
      }).execute();
      const reqService = buildReqService(db);
      const tripService = buildTripService(db);
      const form = await formProduct(reqService, WAREHOUSE, REP);
      assert.equal(form.availableQty, 12, 'a pending permit does not itself reserve stock');
      assert.equal((form.pendingHolds || []).length, 1, 'one pending hold is surfaced');
      assert.equal(form.pendingHolds[0].docNo, 'REQ-261121-0002', 'the hold names the permit');
      assert.equal(form.pendingHolds[0].qty, 25, 'the hold shows the permit qty');
      await assert.rejects(
        () => tripService.openTripAndLoad(REP, TENANT, ACCOUNT, {
          sourceWarehouseId: WAREHOUSE,
          items: [{ productId: PRODUCT, qty: ON_HAND }],
        }),
        (e: any) => {
          assertPreCheckRefusal(e, 12);
          assert.match(String(e?.message || ''), /REQ-261121-0002/, 'the refusal names the pending permit');
          return true;
        },
      );
    } finally {
      await db.destroy();
    }
    console.log('  (d) pending requisition surfaced as a hold, named in the refusal passed');
  }

  // (e) Fully reserved stock reads available 0 while on-hand stays 19
  // (problem 32: the server's "0" against the form's on-hand number).
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await reserveLocationStock(db as any, {
        tenantId: TENANT, accountId: ACCOUNT, locationId: WAREHOUSE,
        items: [{ productId: PRODUCT, qty: ON_HAND }],
      });
      const reqService = buildReqService(db);
      const tripService = buildTripService(db);
      const form = await formProduct(reqService, WAREHOUSE);
      assert.equal(form.availableQty, 0, 'fully reserved stock shows available 0');
      assert.equal(form.onHandQty, ON_HAND, 'on-hand still shows 19');
      await assert.rejects(
        () => tripService.openTripAndLoad(REP, TENANT, ACCOUNT, {
          sourceWarehouseId: WAREHOUSE,
          items: [{ productId: PRODUCT, qty: 1 }],
        }),
        (e: any) => {
          assertPreCheckRefusal(e, 0);
          return true;
        },
      );
    } finally {
      await db.destroy();
    }
    console.log('  (e) fully reserved reads available 0, on-hand 19 passed');
  }

  // (f) The supplementary-load pre-check uses the same canonical
  // number: it refuses 19 when 7 are reserved and loads 12.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db);
      await reserveLocationStock(db as any, {
        tenantId: TENANT, accountId: ACCOUNT, locationId: WAREHOUSE,
        items: [{ productId: PRODUCT, qty: 7 }],
      });
      await (db as any).insertInto('van_sales_trips').values({
        tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP, vehicle_id: null,
        start_odometer: 100, van_location_id: VAN_LOC, source_warehouse_id: WAREHOUSE,
        status: 'open', settlement_status: 'open', loaded_amount: 0, sales_amount: 0,
        cash_collected: 0, credit_sales: 0, returns_amount: 0, variance: 0,
      }).execute();
      const tripRow = await (db as any).selectFrom('van_sales_trips').select('id').where('rep_id', '=', REP).executeTakeFirst();
      const tripId = Number(tripRow.id);
      const tripService = buildTripService(db);
      await assert.rejects(
        () => tripService.loadSupplementaryStockToActiveTrip(REP, TENANT, ACCOUNT, tripId, {
          sourceWarehouseId: WAREHOUSE,
          items: [{ productId: PRODUCT, qty: ON_HAND }],
        }),
        (e: any) => {
          assertPreCheckRefusal(e, 12);
          return true;
        },
      );
      const loaded = await tripService.loadSupplementaryStockToActiveTrip(REP, TENANT, ACCOUNT, tripId, {
        sourceWarehouseId: WAREHOUSE,
        items: [{ productId: PRODUCT, qty: 12 }],
      });
      assert.equal(loaded.ok, true, 'the exact-available supplementary load succeeds');
      assert.equal(await locationQty(db, VAN_LOC), 12, 'the van carries the 12 pcs');
      assert.equal(await locationQty(db, WAREHOUSE), 7, 'the 7 reserved pcs stay behind');
    } finally {
      await db.destroy();
    }
    console.log('  (f) supplementary load uses the same canonical pre-check passed');
  }

  // Source pins: the canonical function is defined once in the ledger
  // and both readers call it — the arithmetic is not re-implemented
  // per call site.
  {
    const here = __dirname;
    const ledger = readFileSync(resolve(here, '../../src/common/utils/location-stock-ledger.ts'), 'utf8');
    assert.ok(ledger.includes('export function computeVanLoadAvailableQty'), 'the ledger defines the canonical function');
    assert.ok(ledger.includes('INV-VAN-LOAD-AVAILABLE-QTY'), 'the ledger names the invariant');
    const reqSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-requisitions.service.ts'), 'utf8');
    assert.ok(reqSource.includes('computeVanLoadAvailableQty'), 'the form reader uses the canonical function');
    assert.ok(reqSource.includes('pendingHolds'), 'the form surfaces pending holds');
    const tripSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-trip-lifecycle/trip-open-load.service.ts'), 'utf8');
    assert.ok(tripSource.includes('computeVanLoadAvailableQty'), 'the trip-open pre-check uses the canonical function');
    assert.ok(tripSource.includes('getLocationAvailability'), 'the pre-check reads through the ledger');
    console.log('  source pins passed');
  }

  console.log('van-load-available-qty: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
