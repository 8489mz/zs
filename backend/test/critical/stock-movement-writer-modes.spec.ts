import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  recordStockMovementRow,
  recordStockMovementSet,
  recordStockRelocation,
} from '../../src/common/utils/stock-movement-writer';

/*
 * Phase 1 A5 — writer modes: nextQty set, two-leg relocation, row-only
 * (INV-PHASE1-A5-WRITER-MODES).
 *
 * THE GAP (grounding phase1-grounding-stock-movements.md §4.4): four sites
 * cannot use the A0 delta writer because their balance step is not an
 * applyStockDelta call — count :638 and suppliers-stock :225 set an ABSOLUTE
 * quantity (setScopedStockQty), QA :348/:360 move stock between two locations
 * (relocateStockBetweenLocations), and recordBinMovement :202 writes a row with
 * caller-supplied before/after and no ledger call at all. A5 adds the three
 * modes so A6–A9 have one writer to converge on. NO caller migrates here.
 *
 * THE MODES (all on the caller's trx, all through the ONE shared row-insert
 * in the writer file — the A0 spec pins exactly one insertInto in the writer):
 * - recordStockMovementSet: wraps setScopedStockQty (nextQty); the row carries
 *   qty = actualDelta (scopeAfter - scopeBefore, 3dp) with before/after from
 *   the change — the count shape. Always writes the row, even for a 0 delta
 *   (the writer's contract); callers that skip a zero delta keep their own
 *   guard (suppliers-stock's `if (actualDelta === 0) continue`).
 * - recordStockRelocation: wraps relocateStockBetweenLocations once, then
 *   writes TWO rows — send (qty -qty, source before/after, from
 *   branch/location) + receive (qty +qty, target before/after, to
 *   branch/location) — both legs with the same book-rounded total. No new
 *   applyStockDelta call: the move is already ledger-routed.
 * - recordStockMovementRow: row-only — inserts exactly one row with the
 *   caller-supplied before/after and NO ledger call (the bin-trace shape).
 *   recordBinMovement now delegates to it (its insert site :202 is gone).
 * - total_cost everywhere is the writer's ONE computation:
 *   roundMoney(|delta| * unitCost, moneyDigits) — EXCEPT the explicit
 *   signedTotal flag (default false), which the suppliers-stock re-set needs
 *   because its stored total must agree with its SIGNED journal leg
 *   (INV-GL-INVENTORY-VALUE; the old Math.abs inflated the WAC pool on a
 *   decrease). The QA .toFixed(6) spelling retires when QA migrates (A6–A9):
 *   0.333 x 3 books 1.00 at 2dp, not 0.999. A10 audits the remaining roundings.
 * - quickReassignProduct's direct `products` update (L698) is CLASSIFIED OUT
 *   (see the log): it sets only primary_bin_id / bin_location — a metadata
 *   pointer, never a balance — so the writer does not cover it.
 *
 * WHAT THIS PINS, driving the REAL modes on PGlite (fresh database per case):
 * - Set-mode gain: nextQty lands exactly, one row with the actual delta and
 *   the ledger's before/after, balances + global agree.
 * - Set-mode loss: a decrease stores a SIGNED total only with signedTotal;
 *   the default stores |delta|; a 0 delta still writes its 0-qty row.
 * - Two-leg: one call moves both legs and writes exactly two rows with the
 *   source/target before/after, the same book-rounded total on both legs,
 *   and the global untouched.
 * - Two-leg rollback: insufficient source stock throws before any row and
 *   leaves every balance unchanged.
 * - Row-only: the row carries the caller-supplied before/after verbatim and
 *   moves NO balance (the bin-trace shape).
 * - Source pins: the three modes exist; the writer still holds exactly one
 *   insertInto; the ledger still holds ZERO stock_movements references and
 *   now exports StockSetParams / StockTransferParams / StockTransferResult;
 *   recordBinMovement delegates to the writer (no insertInto left in
 *   warehouse-bins.service.ts); the writer never imports tenantBaseCurrency.
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

async function seedStock(
  db: Kysely<Database>,
  globalQty: number,
  locations: Array<{ locationId: number; qty: number }>,
): Promise<void> {
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
  for (const loc of locations) {
    await db
      .insertInto('product_location_stock' as never)
      .values({
        product_id: 1,
        branch_id: 1,
        location_id: loc.locationId,
        qty: loc.qty,
        reserved_qty: 0,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        updated_at: new Date(),
      } as never)
      .execute();
  }
}

async function readBalances(
  db: Kysely<Database>,
  locationId: number,
): Promise<{ globalQty: number; locationQty: number }> {
  const product = await db.selectFrom('products').select('stock_qty').where('id', '=', 1).executeTakeFirstOrThrow();
  const location = await db
    .selectFrom('product_location_stock')
    .select('qty')
    .where('product_id', '=', 1)
    .where('location_id', '=', locationId)
    .executeTakeFirstOrThrow();
  return { globalQty: Number(product.stock_qty), locationQty: Number(location.qty) };
}

async function readRows(db: Kysely<Database>): Promise<Array<Record<string, unknown>>> {
  const rows = await db.selectFrom('stock_movements').selectAll().orderBy('id', 'asc').execute();
  return rows as unknown as Array<Record<string, unknown>>;
}

async function main(): Promise<void> {
  // 1. Set-mode gain (the count shape): nextQty lands exactly, one row with
  //    the actual delta and the ledger's before/after.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 10, [{ locationId: 5, qty: 10 }]);
      const result = await db.transaction().execute(async (trx) => {
        return recordStockMovementSet(trx, {
          productId: 1,
          branchId: 1,
          locationId: 5,
          tenantId: TENANT,
          accountId: ACCOUNT,
          nextQty: 15,
          disableAutoDrain: true,
          errorCode: 'INSUFFICIENT_STOCK',
          errorMessage: 'Stock count posting cannot drive total stock below zero',
          movementType: 'stock_count_gain',
          referenceType: 'stock_count_session',
          referenceId: 9,
          reason: 'inventory_count',
          unitCost: 4,
          moneyDigits: 2,
          createdBy: 1,
        } as never);
      });
      assert.equal(result.actualDelta, 5);
      assert.equal(result.scopeBefore, 10);
      assert.equal(result.scopeAfter, 15);
      const rows = await readRows(db);
      assert.equal(rows.length, 1, 'exactly one movement row');
      const row = rows[0];
      assert.equal(Number(result.movementId), Number(row.id), 'returned id is the row id');
      assert.equal(Number(row.qty), 5, 'qty is the actual delta, not the target');
      assert.equal(Number(row.before_qty), 10);
      assert.equal(Number(row.after_qty), 15);
      assert.equal(row.movement_type, 'stock_count_gain');
      assert.equal(row.reason, 'inventory_count');
      assert.equal(row.reference_type, 'stock_count_session');
      assert.equal(Number(row.reference_id), 9);
      assert.equal(Number(row.unit_cost), 4);
      assert.equal(Number(row.total_cost), 20, 'total_cost = roundMoney(5 * 4, 2)');
      const balances = await readBalances(db, 5);
      assert.equal(balances.locationQty, 15);
      assert.equal(balances.globalQty, 15);
      console.log('  set-mode gain: passed');
    } finally {
      await db.destroy();
    }
  }

  // 2. Set-mode loss: signed total only with signedTotal; the default stores
  //    |delta|; a 0 delta still writes its 0-qty row.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 20, [{ locationId: 5, qty: 20 }]);
      const signed = await db.transaction().execute(async (trx) => {
        return recordStockMovementSet(trx, {
          productId: 1,
          branchId: 1,
          locationId: 5,
          tenantId: TENANT,
          accountId: ACCOUNT,
          nextQty: 17,
          movementType: 'opening_stock',
          referenceType: 'product',
          referenceId: 1,
          reason: 'inventory_adjustment',
          unitCost: 10,
          moneyDigits: 2,
          createdBy: 1,
          signedTotal: true,
        } as never);
      });
      assert.equal(signed.actualDelta, -3);
      let rows = await readRows(db);
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].qty), -3);
      assert.equal(Number(rows[0].total_cost), -30, 'signed total: roundMoney(-3 * 10, 2)');
      const unsigned = await db.transaction().execute(async (trx) => {
        return recordStockMovementSet(trx, {
          productId: 1,
          branchId: 1,
          locationId: 5,
          tenantId: TENANT,
          accountId: ACCOUNT,
          nextQty: 15,
          movementType: 'opening_stock',
          referenceType: 'product',
          referenceId: 1,
          reason: 'inventory_adjustment',
          unitCost: 10,
          moneyDigits: 2,
          createdBy: 1,
        } as never);
      });
      assert.equal(unsigned.actualDelta, -2);
      rows = await readRows(db);
      assert.equal(rows.length, 2);
      assert.equal(Number(rows[1].qty), -2);
      assert.equal(Number(rows[1].total_cost), 20, 'default total is |delta| * unitCost');
      const zero = await db.transaction().execute(async (trx) => {
        return recordStockMovementSet(trx, {
          productId: 1,
          branchId: 1,
          locationId: 5,
          tenantId: TENANT,
          accountId: ACCOUNT,
          nextQty: 15,
          movementType: 'opening_stock',
          referenceType: 'product',
          referenceId: 1,
          reason: 'inventory_adjustment',
          unitCost: 10,
          moneyDigits: 2,
          createdBy: 1,
        } as never);
      });
      assert.equal(zero.actualDelta, 0);
      rows = await readRows(db);
      assert.equal(rows.length, 3, 'a 0 delta still writes its 0-qty row');
      assert.equal(Number(rows[2].qty), 0);
      assert.equal(Number(rows[2].before_qty), 15);
      assert.equal(Number(rows[2].after_qty), 15);
      const balances = await readBalances(db, 5);
      assert.equal(balances.locationQty, 15);
      assert.equal(balances.globalQty, 15);
      console.log('  set-mode loss + signed total + zero delta: passed');
    } finally {
      await db.destroy();
    }
  }

  // 3. Two-leg happy path (the QA shape): one call moves both legs, exactly
  //    two rows, the same book-rounded total on both legs, global untouched.
  //    0.333 x 3 books 1.00 at 2dp; the old .toFixed(6) spelling stored 0.999.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 8, [
        { locationId: 5, qty: 8 },
        { locationId: 6, qty: 0 },
      ]);
      const moved = await db.transaction().execute(async (trx) => {
        return recordStockRelocation(trx, {
          productId: 1,
          qty: 3,
          fromBranchId: 1,
          fromLocationId: 5,
          toBranchId: 1,
          toLocationId: 6,
          tenantId: TENANT,
          accountId: ACCOUNT,
          unitCost: 0.333,
          moneyDigits: 2,
          referenceType: 'goods_receipt',
          referenceId: 42,
          reason: 'quarantine_release',
          note: 'release test',
          createdBy: 1,
        } as never);
      });
      assert.equal(moved.sourceBefore, 8);
      assert.equal(moved.sourceAfter, 5);
      assert.equal(moved.targetBefore, 0);
      assert.equal(moved.targetAfter, 3);
      assert.equal(moved.globalBefore, 8);
      assert.equal(moved.globalAfter, 8, 'a relocation never moves the global');
      const rows = await readRows(db);
      assert.equal(rows.length, 2, 'exactly two rows, one per leg');
      const send = rows[0];
      assert.equal(Number(moved.sendMovementId), Number(send.id));
      assert.equal(send.movement_type, 'transfer_send');
      assert.equal(Number(send.qty), -3);
      assert.equal(Number(send.before_qty), 8);
      assert.equal(Number(send.after_qty), 5);
      assert.equal(Number(send.branch_id), 1);
      assert.equal(Number(send.location_id), 5);
      assert.equal(Number(send.total_cost), 1, 'book rounding: roundMoney(3 * 0.333, 2) = 1, not 0.999');
      const receive = rows[1];
      assert.equal(Number(moved.receiveMovementId), Number(receive.id));
      assert.equal(receive.movement_type, 'transfer_receive');
      assert.equal(Number(receive.qty), 3);
      assert.equal(Number(receive.before_qty), 0);
      assert.equal(Number(receive.after_qty), 3);
      assert.equal(Number(receive.branch_id), 1);
      assert.equal(Number(receive.location_id), 6);
      assert.equal(Number(receive.total_cost), 1, 'both legs carry the same total');
      assert.equal(receive.reason, 'quarantine_release');
      assert.equal(receive.reference_type, 'goods_receipt');
      assert.equal(Number(receive.reference_id), 42);
      const sourceBalances = await readBalances(db, 5);
      assert.equal(sourceBalances.locationQty, 5);
      const targetBalances = await readBalances(db, 6);
      assert.equal(targetBalances.locationQty, 3);
      assert.equal(targetBalances.globalQty, 8);
      console.log('  two-leg happy path: passed');
    } finally {
      await db.destroy();
    }
  }

  // 4. Two-leg rollback: insufficient source stock throws before any row and
  //    leaves every balance unchanged.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 2, [
        { locationId: 5, qty: 2 },
        { locationId: 6, qty: 0 },
      ]);
      await assert.rejects(
        db.transaction().execute(async (trx) => {
          await recordStockRelocation(trx, {
            productId: 1,
            qty: 5,
            fromBranchId: 1,
            fromLocationId: 5,
            toBranchId: 1,
            toLocationId: 6,
            tenantId: TENANT,
            accountId: ACCOUNT,
            unitCost: 1,
            moneyDigits: 2,
            referenceType: 'goods_receipt',
            referenceId: 42,
            reason: 'quarantine_release',
            createdBy: 1,
          } as never);
        }),
        (error: unknown) => (error as { code?: string }).code === 'INSUFFICIENT_LOCATION_STOCK',
      );
      assert.equal((await readRows(db)).length, 0, 'failed relocation writes no row');
      const sourceBalances = await readBalances(db, 5);
      assert.equal(sourceBalances.locationQty, 2);
      assert.equal(sourceBalances.globalQty, 2);
      const targetBalances = await readBalances(db, 6);
      assert.equal(targetBalances.locationQty, 0);
      console.log('  two-leg rollback: passed');
    } finally {
      await db.destroy();
    }
  }

  // 5. Row-only (the bin-trace shape): the row carries the caller-supplied
  //    before/after verbatim and moves NO balance.
  {
    const { db } = await makeDb();
    try {
      await seedStock(db, 10, [{ locationId: 5, qty: 10 }]);
      const movementId = await db.transaction().execute(async (trx) => {
        return recordStockMovementRow(trx, {
          productId: 1,
          branchId: 1,
          locationId: 5,
          tenantId: TENANT,
          accountId: ACCOUNT,
          movementType: 'bin_reassign',
          delta: 3,
          beforeQty: 2,
          afterQty: 5,
          referenceType: 'bin_reassign',
          referenceId: 7,
          unitCost: 4,
          moneyDigits: 2,
          createdBy: 1,
        } as never);
      });
      const rows = await readRows(db);
      assert.equal(rows.length, 1, 'exactly one row, no ledger call');
      const row = rows[0];
      assert.equal(Number(movementId), Number(row.id), 'returned id is the row id');
      assert.equal(Number(row.qty), 3);
      assert.equal(Number(row.before_qty), 2, 'before_qty is the caller-supplied bin qty, not a ledger scope');
      assert.equal(Number(row.after_qty), 5);
      assert.equal(row.movement_type, 'bin_reassign');
      assert.equal(row.reason, 'bin_reassign', 'reason defaults to movementType');
      assert.equal(row.note, '');
      assert.equal(Number(row.total_cost), 12, 'total_cost = roundMoney(3 * 4, 2)');
      const balances = await readBalances(db, 5);
      assert.equal(balances.locationQty, 10, 'a row-only call moves no balance');
      assert.equal(balances.globalQty, 10);
      console.log('  row-only: passed');
    } finally {
      await db.destroy();
    }
  }

  // 6. Source pins: the three modes exist; the writer still holds exactly one
  //    insertInto; the ledger still holds ZERO stock_movements references and
  //    now exports the set/transfer param types; recordBinMovement delegates
  //    to the writer (no insertInto left in warehouse-bins.service.ts); the
  //    writer never imports tenantBaseCurrency.
  {
    const writerSrc = readFileSync(resolve(__dirname, '../../src/common/utils/stock-movement-writer.ts'), 'utf8');
    assert.ok(writerSrc.includes('export async function recordStockMovementSet'), 'set mode exists');
    assert.ok(writerSrc.includes('export async function recordStockRelocation'), 'two-leg mode exists');
    assert.ok(writerSrc.includes('export async function recordStockMovementRow'), 'row-only mode exists');
    const insertLines = writerSrc.split('\n').filter((line) => line.includes("insertInto('stock_movements')"));
    assert.equal(insertLines.length, 1, 'the writer must hold exactly one direct write');
    assert.ok(!writerSrc.includes('tenantBaseCurrency'), 'writer must not look up the tenant currency per row');
    assert.ok(writerSrc.includes('roundMoney'), 'writer must use the book rounder');
    assert.ok(!writerSrc.includes('toFixed(4)'), 'writer must not use the .toFixed(4) spelling');
    assert.ok(!writerSrc.includes('toFixed(6)'), 'writer must not use the .toFixed(6) spelling');
    const ledgerSrc = readFileSync(resolve(__dirname, '../../src/common/utils/location-stock-ledger.ts'), 'utf8');
    assert.ok(!ledgerSrc.includes('stock_movements'), 'the ledger must stay row-free');
    assert.ok(ledgerSrc.includes('export type StockSetParams'), 'StockSetParams is exported for the set mode');
    assert.ok(
      ledgerSrc.includes('export type StockTransferParams'),
      'StockTransferParams is exported for the two-leg mode',
    );
    assert.ok(
      ledgerSrc.includes('export type StockTransferResult'),
      'StockTransferResult is exported for the two-leg mode',
    );
    const binsSrc = readFileSync(
      resolve(__dirname, '../../src/modules/inventory/services/warehouse-bins.service.ts'),
      'utf8',
    );
    assert.ok(!binsSrc.includes("insertInto('stock_movements')"), 'recordBinMovement no longer inserts directly');
    assert.ok(binsSrc.includes('recordStockMovementRow'), 'recordBinMovement delegates to the writer');
    console.log('  source pins: passed');
  }

  // 7. Wiring: this spec is in both critical lists, in identical order
  // (363 specs — the purchases-writer spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 384);
    assert.equal(chain.length, 384);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/stock-movement-writer-modes.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-f5d-maintenance-products.spec.ts');
    console.log('  evidence spec wired into both critical lists (373 = 373, identical order), passed');
  }

  console.log('Stock movement writer modes tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
