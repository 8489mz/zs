import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { applyStockDelta } from '../../src/common/utils/location-stock-ledger';
import { recordStockMovement } from '../../src/common/utils/stock-movement-writer';

/*
 * Phase 1 A0 — the unified stock-movements row-writer (INV-PHASE1-A0-ROW-WRITER).
 *
 * THE GAP (grounding phase1-grounding-stock-movements.md): applyStockDelta moves
 * balances only — it writes NO movement row — so all 66 business inserts hand-write
 * their own row, with at least four total_cost spellings and one place (fashion
 * :489/:510/:738) stamping before/after from cached in-memory quantities instead of
 * the ledger return. The only function that already does both halves in one place is
 * moveVanStock (van-common.util.ts:40-81), which is van-specific and rounds
 * total_cost with .toFixed(4).
 *
 * THE RULE: recordStockMovement(trx, params) runs the delta through applyStockDelta
 * and writes EXACTLY ONE stock_movements row from the returned scopeBefore/scopeAfter,
 * all on the caller's trx — and returns the row id plus the ledger result, so later
 * packages can stamp from the return (A3) and post journals against the row (A6-A9).
 * - total_cost = roundMoney(|delta| * unitCost, moneyDigits) — the BOOK rounding, not
 *   .toFixed(4): unitCost 2.345 at 2dp books 2.35, not 2.345.
 * - moneyDigits is a caller-supplied param (P2 pattern, like the trial-balance engine
 *   and stockMovementTotal): the writer never queries settings / exchange rates per row.
 * - reason defaults to movementType; note defaults to ''; unitCost defaults to 0;
 *   createdBy defaults to null; importReceiptId is optional (import-receipt rows set it).
 * - created_at is NOT set by the writer: the DB default NOW() stamps it (server clock,
 *   single-server-clock rule).
 * - The writer ALWAYS writes one row, even for delta 0: its contract is delta+row.
 *   Row-less provisioning keeps calling applyStockDelta directly (inventory-scope:491).
 * - applyStockDelta itself is UNTOUCHED and still writes no row (pinned below).
 * - Cost rounding unification across call sites is A10, not this package: the writer
 *   takes unitCost as given and never looks up product.cost_price.
 *
 * WHAT THIS PINS, driving the REAL code on PGlite (fresh database per case, no mocks):
 * - Deduct: one call moves the balance AND writes exactly one row with the ledger's
 *   before/after, the frozen unit cost and the book-rounded total, and returns the
 *   row id + ledger result.
 * - Add at 3dp: total_cost survives at book digits (50.025, not 50.02 / 50.03).
 * - Book rounding beats .toFixed(4): 2.345 at 2dp is 2.35.
 * - Rollback: a throw after the writer leaves no row and balances unchanged — the
 *   writer runs inside the caller's transaction.
 * - applyStockDelta alone moves balances and writes ZERO rows.
 * - Insufficient stock throws INSUFFICIENT_STOCK with zero rows and unchanged balances.
 * - Delta 0 writes exactly one 0-qty row with before == after (the delta+row contract).
 * - created_at is stamped by the DB (set, within 60s of now) — the writer supplies none.
 * - Reason/note defaults: reason == movementType, note == '' when omitted.
 * - Source pins: the writer holds exactly one insertInto('stock_movements');
 *   location-stock-ledger.ts still holds ZERO stock_movements references; the writer
 *   never imports tenantBaseCurrency (no per-row settings lookup).
 * This is not an end-to-end run on live Postgres.
 */

const TENANT = 't1';
const ACCOUNT = 'a1';

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE products (id bigint PRIMARY KEY, name text, stock_qty numeric, reserved_qty numeric, tenant_id text, account_id text, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reserved_qty numeric, tenant_id text, account_id text, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, serial_tracking jsonb, batch_tracking jsonb, created_at timestamptz NOT NULL DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedStock(db: Kysely<Database>, globalQty: number, locationQty: number): Promise<void> {
  await db
    .insertInto('products' as never)
    .values({
      id: 1,
      name: 'Widget',
      stock_qty: globalQty,
      reserved_qty: 0,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      updated_at: new Date(),
    } as never)
    .execute();
  await db
    .insertInto('product_location_stock' as never)
    .values({
      product_id: 1,
      branch_id: 1,
      location_id: 5,
      qty: locationQty,
      reserved_qty: 0,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      updated_at: new Date(),
    } as never)
    .execute();
}

async function readBalances(db: Kysely<Database>): Promise<{ globalQty: number; locationQty: number }> {
  const product = await db.selectFrom('products').select('stock_qty').where('id', '=', 1).executeTakeFirstOrThrow();
  const location = await db
    .selectFrom('product_location_stock')
    .select('qty')
    .where('product_id', '=', 1)
    .where('location_id', '=', 5)
    .executeTakeFirstOrThrow();
  return { globalQty: Number(product.stock_qty), locationQty: Number(location.qty) };
}

async function readRows(db: Kysely<Database>): Promise<Array<Record<string, unknown>>> {
  const rows = await db.selectFrom('stock_movements').selectAll().execute();
  return rows as unknown as Array<Record<string, unknown>>;
}

function baseParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productId: 1,
    branchId: 1,
    locationId: 5,
    tenantId: TENANT,
    accountId: ACCOUNT,
    movementType: 'sale',
    referenceType: 'sale',
    referenceId: 7,
    moneyDigits: 2,
    unitCost: 12.5,
    createdBy: 1,
    note: 'test sale',
    ...overrides,
  };
}

async function main(): Promise<void> {
  // 1. Deduct: one call moves the balance AND writes exactly one row.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(trx, baseParams({ delta: -10 }) as never);
      });
      assert.equal(result.scopeBefore, 40);
      assert.equal(result.scopeAfter, 30);
      assert.equal(result.globalBefore, 40);
      assert.equal(result.globalAfter, 30);
      const rows = await readRows(db);
      assert.equal(rows.length, 1, 'exactly one movement row');
      const row = rows[0];
      assert.equal(Number(result.movementId), Number(row.id), 'returned id is the row id');
      assert.equal(Number(row.qty), -10);
      assert.equal(Number(row.before_qty), 40);
      assert.equal(Number(row.after_qty), 30);
      assert.equal(row.movement_type, 'sale');
      assert.equal(row.reason, 'sale', 'reason defaults to movementType');
      assert.equal(row.note, 'test sale');
      assert.equal(row.reference_type, 'sale');
      assert.equal(Number(row.reference_id), 7);
      assert.equal(Number(row.unit_cost), 12.5);
      assert.equal(Number(row.total_cost), 125, 'total_cost = roundMoney(10 * 12.5, 2)');
      assert.equal(Number(row.branch_id), 1);
      assert.equal(Number(row.location_id), 5);
      assert.equal(row.tenant_id, TENANT);
      assert.equal(row.account_id, ACCOUNT);
      assert.equal(Number(row.created_by), 1);
      assert.equal(row.import_receipt_id, null);
      const balances = await readBalances(db);
      assert.equal(balances.locationQty, 30);
      assert.equal(balances.globalQty, 30);
      console.log('  deduct: balance + one row, passed');
    } finally {
      await db.destroy();
    }
  }

  // 2. Add at 3dp: total_cost survives at book digits.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(
          trx,
          baseParams({
            delta: 5,
            movementType: 'purchase',
            referenceType: 'purchase',
            unitCost: 10.005,
            moneyDigits: 3,
          }) as never,
        );
      });
      assert.equal(result.scopeBefore, 40);
      assert.equal(result.scopeAfter, 45);
      const rows = await readRows(db);
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].total_cost), 50.025, 'total_cost = roundMoney(5 * 10.005, 3)');
      assert.equal(Number(rows[0].unit_cost), 10.005);
      console.log('  add at 3dp: passed');
    } finally {
      await db.destroy();
    }
  }

  // 3. Book rounding beats .toFixed(4): 2.345 at 2dp books 2.35, not 2.345.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      await db.transaction().execute(async (trx) => {
        await recordStockMovement(trx, baseParams({ delta: -1, unitCost: 2.345, moneyDigits: 2 }) as never);
      });
      const rows = await readRows(db);
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].total_cost), 2.35, 'roundMoney(2.345, 2) = 2.35; .toFixed(4) would give 2.345');
      assert.equal(Number(rows[0].unit_cost), 2.345, 'unit_cost is stored as given');
      console.log('  book rounding beats .toFixed(4): passed');
    } finally {
      await db.destroy();
    }
  }

  // 4. Rollback: a throw after the writer leaves no row and balances unchanged.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      await assert.rejects(
        db.transaction().execute(async (trx) => {
          await recordStockMovement(trx, baseParams({ delta: -10 }) as never);
          throw new Error('force-rollback');
        }),
        /force-rollback/,
      );
      assert.equal((await readRows(db)).length, 0, 'rolled back: no row');
      const balances = await readBalances(db);
      assert.equal(balances.locationQty, 40);
      assert.equal(balances.globalQty, 40);
      console.log('  rollback: passed');
    } finally {
      await db.destroy();
    }
  }

  // 5. applyStockDelta alone moves balances and writes ZERO rows (it is untouched).
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const change = await db.transaction().execute(async (trx) => {
        return applyStockDelta(trx, {
          productId: 1,
          branchId: 1,
          locationId: 5,
          tenantId: TENANT,
          accountId: ACCOUNT,
          delta: -5,
        });
      });
      assert.equal(change.scopeBefore, 40);
      assert.equal(change.scopeAfter, 35);
      assert.equal((await readRows(db)).length, 0, 'applyStockDelta writes no row');
      const balances = await readBalances(db);
      assert.equal(balances.locationQty, 35);
      assert.equal(balances.globalQty, 35);
      console.log('  applyStockDelta writes no row: passed');
    } finally {
      await db.destroy();
    }
  }

  // 6. Insufficient stock throws INSUFFICIENT_STOCK with zero rows, balances unchanged.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      await assert.rejects(
        db.transaction().execute(async (trx) => {
          await recordStockMovement(trx, baseParams({ delta: -999 }) as never);
        }),
        (error: unknown) => (error as { code?: string }).code === 'INSUFFICIENT_STOCK',
      );
      assert.equal((await readRows(db)).length, 0, 'failed delta writes no row');
      const balances = await readBalances(db);
      assert.equal(balances.locationQty, 40);
      assert.equal(balances.globalQty, 40);
      console.log('  insufficient stock: passed');
    } finally {
      await db.destroy();
    }
  }

  // 7. Delta 0 writes exactly one 0-qty row with before == after (delta+row contract).
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovement(trx, baseParams({ delta: 0 }) as never);
      });
      assert.equal(result.scopeBefore, 40);
      assert.equal(result.scopeAfter, 40);
      const rows = await readRows(db);
      assert.equal(rows.length, 1, 'delta 0 still writes one row');
      assert.equal(Number(rows[0].qty), 0);
      assert.equal(Number(rows[0].before_qty), 40);
      assert.equal(Number(rows[0].after_qty), 40);
      assert.equal(Number(rows[0].total_cost), 0);
      console.log('  delta 0 writes one row: passed');
    } finally {
      await db.destroy();
    }
  }

  // 8. created_at is stamped by the DB (set, within 60s of now) — the writer supplies none.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const before = Date.now();
      await db.transaction().execute(async (trx) => {
        await recordStockMovement(trx, baseParams({ delta: -2 }) as never);
      });
      const rows = await readRows(db);
      assert.equal(rows.length, 1);
      const createdAt = rows[0].created_at as Date | string | null;
      assert.ok(createdAt, 'created_at must be set by the DB default');
      const createdMs = new Date(createdAt as string).getTime();
      assert.ok(
        Math.abs(Date.now() - createdMs) < 60_000 && createdMs >= before - 1000,
        'created_at must be the server clock, close to now',
      );
      console.log('  created_at server-stamped: passed');
    } finally {
      await db.destroy();
    }
  }

  // 9. Reason/note defaults: reason == movementType, note == '' when omitted.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 40, 40);
      const params = baseParams({ delta: -3, movementType: 'damaged', referenceType: 'damage' }) as Record<
        string,
        unknown
      >;
      delete params.reason;
      delete params.note;
      await db.transaction().execute(async (trx) => {
        await recordStockMovement(trx, params as never);
      });
      const rows = await readRows(db);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].reason, 'damaged');
      assert.equal(rows[0].note, '');
      console.log('  reason/note defaults: passed');
    } finally {
      await db.destroy();
    }
  }

  // 10. Source pins: exactly one insert in the writer; ledger still row-free;
  //     writer never imports tenantBaseCurrency (no per-row settings lookup).
  {
    const writerSrc = readFileSync(resolve(__dirname, '../../src/common/utils/stock-movement-writer.ts'), 'utf8');
    const insertLines = writerSrc.split('\n').filter((line) => line.includes("insertInto('stock_movements')"));
    assert.equal(insertLines.length, 1, 'the writer must hold exactly one direct write');
    assert.ok(!writerSrc.includes('tenantBaseCurrency'), 'writer must not look up the tenant currency per row');
    assert.ok(writerSrc.includes('roundMoney'), 'writer must use the book rounder');
    assert.ok(!writerSrc.includes('toFixed(4)'), 'writer must not use the .toFixed(4) spelling');
    const ledgerSrc = readFileSync(resolve(__dirname, '../../src/common/utils/location-stock-ledger.ts'), 'utf8');
    assert.ok(!ledgerSrc.includes('stock_movements'), 'applyStockDelta must stay row-free');
    console.log('  source pins: passed');
  }

  // 11. Wiring: this spec is in both critical lists, in identical order
  // (363 specs — the purchases-writer spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 377);
    assert.equal(chain.length, 377);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/stock-movement-writer.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-b8-delivery-reps-sales.spec.ts');
    console.log('  evidence spec wired into both critical lists (373 = 373, identical order), passed');
  }

  console.log('Stock movement writer tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
