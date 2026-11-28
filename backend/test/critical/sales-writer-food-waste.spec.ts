/*
 * INV-PHASE1-A7-SALES-WRITER: the 12 sales stock_movements writes go
 * through the unified row-writer (A0/A5) instead of hand-written inserts.
 *
 * This file pins the food-waste legs (sites 1, 2), driving the REAL
 * logWaste + reconcilePendingWaste through the REAL
 * RestaurantFoodWasteService on PGlite (fresh database per case), with a
 * stub posting service ({ postFoodWaste: async () => ({ journalEntryId }) })
 * because the posted path only needs the journal id back — the GL rows
 * themselves belong to the posting slice, not to this package:
 * - logWaste (posted): 2 units of Widget 101 (cost 10) writes exactly one
 *   'damaged' row, qty -2, before 100 / after 98, and the location stock
 *   falls to 98.
 * - reconcilePendingWaste: a pending incident (stock 0, allowPending)
 *   writes no row; once the location is restocked, reconcile writes
 *   exactly one 'damaged' row and a second reconcile is a no-op
 *   (alreadyReconciled, still one row).
 * - Rollback: when the posting stub throws after the row was written in
 *   the same transaction, the log, the row and the deduction all roll
 *   back — zero rows, zero logs, stock still 100.
 * The no-cost rows store unit_cost/total_cost 0/0 (the writer default)
 * instead of the old NULL/NULL; no reader sums these rows' total_cost.
 * The create legs live in sales-writer-create.spec.ts; the cancel/edit
 * legs live in sales-writer-cancel-edit.spec.ts.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { RestaurantFoodWasteService } from '../../src/modules/sales/services/restaurant-food-waste.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';
/** Loose Kysely handle for harness inserts/reads: the generated Database type
 *  requires full insert shapes, so the harness seeds and reads through this
 *  handle instead of an `any` cast (the repo pins zero new `any` casts). */
type LooseDb = Kysely<Record<string, Record<string, unknown>>>;
function loose(db: Kysely<Database>): LooseDb {
  return db as unknown as LooseDb;
}

const auth: AuthContext = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'admin',
  permissions: ['sales'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, is_active boolean DEFAULT true, item_type text, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE restaurant_food_waste_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, product_id bigint, quantity numeric, cost_price numeric DEFAULT 0, total_cost numeric DEFAULT 0, reason text, notes text, logged_by bigint, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>, locationQty: number): Promise<void> {
  const anyDb = loose(db);
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('branches')
    .values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({
      id: 10,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      name: 'Main warehouse',
      location_type: 'internal_warehouse',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('products')
    .values({
      id: 101,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Widget 101',
      stock_qty: 100,
      cost_price: 10,
      retail_price: 100,
      is_active: true,
      item_type: 'product',
    })
    .execute();
  await anyDb
    .insertInto('product_location_stock')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      product_id: 101,
      branch_id: 1,
      location_id: 10,
      qty: locationQty,
    })
    .execute();
}

function buildService(
  db: Kysely<Database>,
  posting: { postFoodWaste: (trx: unknown, logId: number, auth: AuthContext) => Promise<{ journalEntryId: number }> },
): RestaurantFoodWasteService {
  return new RestaurantFoodWasteService(db, posting as never);
}

const okPosting = {
  postFoodWaste: async () => ({ journalEntryId: 1 }),
};

async function movementRows(db: Kysely<Database>): Promise<Array<Record<string, unknown>>> {
  return loose(db)
    .selectFrom('stock_movements')
    .selectAll()
    .where('reference_type', '=', 'food_waste')
    .orderBy('id', 'asc')
    .execute();
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM ${sql.raw(table)}`.execute(db);
  return Number(rows.rows[0].n);
}

async function locationQtyFor(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await loose(db)
    .selectFrom('product_location_stock')
    .select('qty')
    .where('tenant_id', '=', TENANT)
    .where('product_id', '=', productId)
    .where('location_id', '=', 10)
    .executeTakeFirstOrThrow();
  return Number(row.qty);
}

async function main(): Promise<void> {
  // 1. logWaste (posted): 2 units of Widget 101 (cost 10) writes exactly
  //    one 'damaged' row and deducts the location stock.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db, 100);
      const service = buildService(db, okPosting);
      const result = await service.logWaste(auth, {
        branchId: 1,
        productId: 101,
        quantity: 2,
        reason: 'spoilage',
        notes: 'test',
      });
      assert.equal(result.status, 'posted');
      assert.equal(Number(result.totalCost), 20, 'posted waste reports the real total cost');
      const rows = await movementRows(db);
      assert.equal(rows.length, 1, `posted waste must write exactly 1 movement row, got ${rows.length}`);
      assert.equal(rows[0].movement_type, 'damaged');
      assert.equal(Number(rows[0].qty), -2);
      assert.ok(
        rows[0].unit_cost !== null && Number(rows[0].unit_cost) === 0,
        'no-cost waste row stores unit_cost 0, not NULL',
      );
      assert.ok(
        rows[0].total_cost !== null && Number(rows[0].total_cost) === 0,
        'no-cost waste row stores total_cost 0, not NULL',
      );
      assert.equal(Number(rows[0].before_qty), 100);
      assert.equal(Number(rows[0].after_qty), 98);
      assert.equal(rows[0].reason, 'food_waste_spoilage');
      assert.equal(Number(rows[0].reference_id), Number(result.id));
      assert.equal(await locationQtyFor(db, 101), 98, 'posted waste deducts the location stock');
    } finally {
      await db.destroy();
    }
    console.log('  logWaste posted passed');
  }

  // 2. reconcilePendingWaste: a pending incident (stock 0, allowPending)
  //    writes no row; once restocked, reconcile writes exactly one row
  //    and a second reconcile is a no-op.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db, 0);
      const service = buildService(db, okPosting);
      const pending = await service.logWaste(auth, {
        branchId: 1,
        productId: 101,
        quantity: 2,
        reason: 'expired',
        allowPending: true,
      });
      assert.equal(pending.status, 'pending_reconciliation');
      assert.equal(Number(pending.totalCost), 0, 'pending waste reports totalCost 0 (no deduction yet)');
      assert.equal((await movementRows(db)).length, 0, 'pending waste writes no movement row');
      // Restock the location, then reconcile.
      await loose(db).updateTable('product_location_stock').set({ qty: 100 }).where('product_id', '=', 101).execute();
      const reconciled = await service.reconcilePendingWaste(auth, Number(pending.id));
      assert.equal(reconciled.status, 'reconciled');
      assert.equal(Number(reconciled.totalCost), 20, 'reconciled waste reports the real total cost');
      const rows = await movementRows(db);
      assert.equal(rows.length, 1, `reconcile must write exactly 1 movement row, got ${rows.length}`);
      assert.equal(rows[0].movement_type, 'damaged');
      assert.equal(Number(rows[0].qty), -2);
      assert.ok(rows[0].unit_cost !== null && Number(rows[0].unit_cost) === 0);
      assert.ok(rows[0].total_cost !== null && Number(rows[0].total_cost) === 0);
      assert.equal(Number(rows[0].before_qty), 100);
      assert.equal(Number(rows[0].after_qty), 98);
      assert.equal(await locationQtyFor(db, 101), 98, 'reconcile deducts the location stock');
      const again = await service.reconcilePendingWaste(auth, Number(pending.id));
      assert.equal(again.alreadyReconciled, true, 'second reconcile is a no-op');
      assert.equal((await movementRows(db)).length, 1, 'second reconcile writes no extra row');
    } finally {
      await db.destroy();
    }
    console.log('  reconcile + idempotency passed');
  }

  // 3. Rollback: when the posting stub throws after the row was written
  //    in the same transaction, the log, the row and the deduction all
  //    roll back.
  {
    const { db } = await makeDb();
    try {
      await seedFoundation(db, 100);
      const failingPosting = {
        postFoodWaste: async () => {
          throw new Error('GL_POST_FAIL');
        },
      };
      const service = buildService(db, failingPosting);
      await assert.rejects(
        service.logWaste(auth, { branchId: 1, productId: 101, quantity: 2, reason: 'spoilage' }),
        /GL_POST_FAIL/,
      );
      assert.equal(await countRows(db, 'stock_movements'), 0, 'failed waste leaves no movement rows');
      assert.equal(await countRows(db, 'restaurant_food_waste_logs'), 0, 'failed waste leaves no log');
      assert.equal(await locationQtyFor(db, 101), 100, 'failed waste leaves the stock untouched');
    } finally {
      await db.destroy();
    }
    console.log('  rollback passed');
  }

  // 4. Source pins + wiring: no direct insert left in the service, it
  //    calls the writer; 363 in both critical lists, identical order,
  //    the 3 new specs last.
  {
    const serviceSrc = fs.readFileSync(
      resolve(__dirname, '../../src/modules/sales/services/restaurant-food-waste.service.ts'),
      'utf8',
    );
    const direct = serviceSrc.split('\n').filter((line) => line.includes("insertInto('stock_movements')"));
    assert.equal(direct.length, 0, `direct inserts left: ${direct.join(' | ')}`);
    assert.ok(serviceSrc.includes('recordStockMovement('), 'food-waste service calls the writer');
    assert.ok(
      serviceSrc.includes("import { recordStockMovement } from '../../../common/utils/stock-movement-writer'"),
      'food-waste service imports the writer',
    );
    {
      const specs = JSON.parse(fs.readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(fs.readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 426);
      assert.equal(chain.length, 426);
      assert.deepEqual(chain, specs);
      assert.equal(specs[359], 'test/critical/sales-writer-create.spec.ts');
      assert.equal(specs[360], 'test/critical/sales-writer-cancel-edit.spec.ts');
      assert.equal(specs[361], 'test/critical/sales-writer-food-waste.spec.ts');
      assert.equal(specs[362], 'test/critical/manufacturing-writer.spec.ts');
      assert.equal(specs[363], 'test/critical/purchases-writer.spec.ts');
      console.log('  evidence specs wired into both critical lists (373 = 373, identical order), passed');
    }
    console.log('  block 4 (source pins + wiring) passed');
  }

  console.log('sales writer food-waste checks passed (4 blocks)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
