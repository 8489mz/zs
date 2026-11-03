/*
 * Sale floating-pool allocation leg (INV-FLOATING-POOL-ALLOCATION-LEG,
 * Slice 5 P3, Batch 2 package 1).
 *
 * THE DEFECT: createSale's availability check counted the unassigned
 * (floating) pool, but the deduction loops iterated assigned
 * location rows only. Location 2 + pool 100, sell 50 with
 * overselling OFF: the check passed (102 >= 50), the loop allocated
 * 2, and the sale threw INSUFFICIENT_STOCK with
 * currentAvailableQty: 0 although 100 units existed.
 *
 * THE FIX (settled from code): the loops compute their legs through
 * `computeSaleAllocationLegs` — assigned locations first, then the
 * pool as the final leg, capped at pool qty minus pool reserved_qty.
 * Reservations are booked on the LOCATION row by
 * `reserveLocationStock`, never on the pool row, so the pool cap is
 * the pool row's own qty minus its own reserved_qty. The pool leg
 * is attributed to the first leg's location (or the sale location
 * when no assigned leg exists) because
 * `sale_line_stock_allocations.location_id` is NOT NULL with an FK,
 * and `applyStockDelta`'s auto-drain physically re-homes the pool
 * quantity into that location row before deducting — so the
 * existing edit/cancel restore paths round-trip through the same
 * row. A genuinely short sale still fails closed, now reporting
 * the true pooled available quantity instead of 0.
 *
 * WHAT THIS DRIVES: the real `computeSaleAllocationLegs` seam, the
 * real `applyStockDelta` / `reserveLocationStock` /
 * `releaseLocationStock` ledger functions on PGlite (including the
 * drain physics the attribution relies on), and source pins proving
 * all four deduction sites (create + edit, parent + modifier) use
 * the seam. Deliberately NOT driven here: the integrated
 * real-createSale path end to end — the full posting/finance
 * harness is an acceptance-suite concern (the same honest limit
 * recorded by the conversion-stock-legs and tax pre-round specs);
 * the seam, the ledger physics, the failure quantity, and the
 * wiring are all pinned here.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { computeSaleAllocationLegs } from '../../src/modules/sales/helpers/sales-write.helper';
import {
  applyStockDelta,
  releaseLocationStock,
  reserveLocationStock,
} from '../../src/common/utils/location-stock-ledger';

const AUTH_SCOPE = { tenantId: 't1', accountId: 'a1' };

function leg(locationId: number | null, branchId: number | null, availableQty: number) {
  return { locationId, branchId, availableQty };
}

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedProduct(
  db: Kysely<Database>,
  globalQty: number,
  rows: Array<{ branchId: number | null; locationId: number | null; qty: number; reservedQty: number }>,
): Promise<void> {
  await db.insertInto('products').values({ id: 1, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: globalQty, reserved_qty: 0 } as any).execute();
  for (const row of rows) {
    await db.insertInto('product_location_stock').values({
      tenant_id: 't1', account_id: 'a1', product_id: 1,
      branch_id: row.branchId, location_id: row.locationId,
      qty: row.qty, reserved_qty: row.reservedQty,
    } as any).execute();
  }
}

async function balances(db: Kysely<Database>): Promise<{ global: number; location: number; pool: number }> {
  const product = await db.selectFrom('products').select('stock_qty').where('id', '=', 1).executeTakeFirstOrThrow();
  const loc = await db.selectFrom('product_location_stock').select('qty').where('product_id', '=', 1).where('location_id', '=', 10).executeTakeFirst();
  const pool = await db.selectFrom('product_location_stock').select('qty').where('product_id', '=', 1).where('location_id', 'is', null).where('branch_id', 'is', null).executeTakeFirst();
  return { global: Number(product.stock_qty), location: Number(loc?.qty || 0), pool: Number(pool?.qty || 0) };
}

async function main(): Promise<void> {
  // --- Case 1: floating-only stock sells (the reported defect shape).
  {
    const r = computeSaleAllocationLegs({
      requiredQty: 50,
      locationAvailabilities: [leg(10, 1, 0)],
      poolAvailableQty: 100,
      saleLocationId: 10,
      saleBranchId: 1,
    });
    assert.deepEqual(r.legs, [{ locationId: 10, branchId: 1, qty: 50, fromPool: true }]);
    assert.equal(r.remainingQty, 0);
    assert.equal(r.pooledAvailableQty, 100);
  }

  // --- Case 2: location + pool split (the worked illustration).
  {
    const r = computeSaleAllocationLegs({
      requiredQty: 50,
      locationAvailabilities: [leg(10, 1, 2)],
      poolAvailableQty: 100,
      saleLocationId: 10,
      saleBranchId: 1,
    });
    assert.deepEqual(r.legs, [
      { locationId: 10, branchId: 1, qty: 2, fromPool: false },
      { locationId: 10, branchId: 1, qty: 48, fromPool: true },
    ]);
    assert.equal(r.remainingQty, 0);
    assert.equal(r.pooledAvailableQty, 102);
  }

  // --- Case 3: genuinely short sale fails closed with the TRUE pooled figure.
  {
    const r = computeSaleAllocationLegs({
      requiredQty: 50,
      locationAvailabilities: [leg(10, 1, 2)],
      poolAvailableQty: 10,
      saleLocationId: 10,
      saleBranchId: 1,
    });
    assert.deepEqual(r.legs, [
      { locationId: 10, branchId: 1, qty: 2, fromPool: false },
      { locationId: 10, branchId: 1, qty: 10, fromPool: true },
    ]);
    assert.equal(r.remainingQty, 38);
    assert.equal(r.pooledAvailableQty, 12);
  }

  // --- Case 4: pool cap honours the pool row's own reserved_qty.
  {
    const r = computeSaleAllocationLegs({
      requiredQty: 80,
      locationAvailabilities: [leg(10, 1, 0)],
      poolAvailableQty: 70,
      saleLocationId: 10,
      saleBranchId: 1,
    });
    assert.equal(r.legs.length, 1);
    assert.equal(r.legs[0].qty, 70);
    assert.equal(r.remainingQty, 10);
    assert.equal(r.pooledAvailableQty, 70);
  }

  // --- Case 5: multi-location order preserved; pool leg takes the FIRST leg's location.
  {
    const r = computeSaleAllocationLegs({
      requiredQty: 50,
      locationAvailabilities: [leg(20, 1, 2), leg(21, 1, 3)],
      poolAvailableQty: 100,
      saleLocationId: 10,
      saleBranchId: 1,
    });
    assert.deepEqual(r.legs, [
      { locationId: 20, branchId: 1, qty: 2, fromPool: false },
      { locationId: 21, branchId: 1, qty: 3, fromPool: false },
      { locationId: 20, branchId: 1, qty: 45, fromPool: true },
    ]);
    assert.equal(r.remainingQty, 0);
    assert.equal(r.pooledAvailableQty, 105);
  }

  // --- Case 6: no assigned legs — pool leg falls back to the sale location.
  {
    const r = computeSaleAllocationLegs({
      requiredQty: 50,
      locationAvailabilities: [],
      poolAvailableQty: 100,
      saleLocationId: 10,
      saleBranchId: 1,
    });
    assert.deepEqual(r.legs, [{ locationId: 10, branchId: 1, qty: 50, fromPool: true }]);
    assert.equal(r.remainingQty, 0);
  }

  // --- Case 7: no attribution target — no pool leg, fail-closed exactly as before.
  {
    const r = computeSaleAllocationLegs({
      requiredQty: 50,
      locationAvailabilities: [],
      poolAvailableQty: 100,
      saleLocationId: null,
      saleBranchId: null,
    });
    assert.deepEqual(r.legs, []);
    assert.equal(r.remainingQty, 50);
    assert.equal(r.pooledAvailableQty, 100);
  }

  // --- Case 8: assigned stock alone covers the sale — no pool leg, pool untouched by the seam.
  {
    const r = computeSaleAllocationLegs({
      requiredQty: 30,
      locationAvailabilities: [leg(10, 1, 40)],
      poolAvailableQty: 100,
      saleLocationId: 10,
      saleBranchId: 1,
    });
    assert.deepEqual(r.legs, [{ locationId: 10, branchId: 1, qty: 30, fromPool: false }]);
    assert.equal(r.remainingQty, 0);
    assert.equal(r.pooledAvailableQty, 140);
  }

  // --- Case 9: real ledger physics — the attributed legs applied in
  // order through applyStockDelta end exact (auto-drain re-homes the
  // pool into the first leg's location before deducting).
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 102, [
        { branchId: 1, locationId: 10, qty: 2, reservedQty: 0 },
        { branchId: null, locationId: null, qty: 100, reservedQty: 0 },
      ]);
      await db.transaction().execute(async (trx) => {
        await applyStockDelta(trx as any, { productId: 1, delta: -2, branchId: 1, locationId: 10, ...AUTH_SCOPE });
        await applyStockDelta(trx as any, { productId: 1, delta: -48, branchId: 1, locationId: 10, ...AUTH_SCOPE });
      });
      assert.deepEqual(await balances(db), { global: 52, location: 52, pool: 0 });
      // Restore through the same location row round-trips the global exactly.
      await db.transaction().execute(async (trx) => {
        await applyStockDelta(trx as any, { productId: 1, delta: 2, branchId: 1, locationId: 10, ...AUTH_SCOPE });
        await applyStockDelta(trx as any, { productId: 1, delta: 48, branchId: 1, locationId: 10, ...AUTH_SCOPE });
      });
      assert.deepEqual(await balances(db), { global: 102, location: 102, pool: 0 });
    } finally {
      await db.destroy();
    }
  }

  // --- Case 10: reservations are booked on the LOCATION row, never
  // pooled — the settled reservation model the pool cap relies on.
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 110, [
        { branchId: 1, locationId: 10, qty: 40, reservedQty: 0 },
        { branchId: null, locationId: null, qty: 70, reservedQty: 0 },
      ]);
      await db.transaction().execute(async (trx) => {
        await reserveLocationStock(trx as any, {
          ...AUTH_SCOPE, branchId: 1, locationId: 10,
          items: [{ productId: 1, qty: 30 }],
        });
      });
      const locRow = await db.selectFrom('product_location_stock').select(['qty', 'reserved_qty']).where('product_id', '=', 1).where('location_id', '=', 10).executeTakeFirstOrThrow();
      const poolRow = await db.selectFrom('product_location_stock').select(['qty', 'reserved_qty']).where('product_id', '=', 1).where('location_id', 'is', null).where('branch_id', 'is', null).executeTakeFirstOrThrow();
      const product = await db.selectFrom('products').select('reserved_qty').where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(Number(locRow.reserved_qty), 30);
      assert.equal(Number(poolRow.reserved_qty), 0);
      assert.equal(Number(product.reserved_qty), 30);
      // Location avail is 10 (40 - 30); pool avail is the full 70.
      const r = computeSaleAllocationLegs({
        requiredQty: 50,
        locationAvailabilities: [leg(10, 1, 10)],
        poolAvailableQty: 70,
        saleLocationId: 10,
        saleBranchId: 1,
      });
      assert.equal(r.legs[1].qty, 40);
      assert.equal(r.remainingQty, 0);
      // Release round-trips exactly.
      await db.transaction().execute(async (trx) => {
        await releaseLocationStock(trx as any, {
          ...AUTH_SCOPE, branchId: 1, locationId: 10,
          items: [{ productId: 1, qty: 30 }],
        });
      });
      const after = await db.selectFrom('product_location_stock').select('reserved_qty').where('product_id', '=', 1).where('location_id', '=', 10).executeTakeFirstOrThrow();
      assert.equal(Number(after.reserved_qty), 0);
    } finally {
      await db.destroy();
    }
  }

  // --- Case 11: source pins — all four deduction sites use the seam,
  // the pool row is read with the exact null/null predicate, and the
  // hardcoded 0 error quantity is gone.
  {
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/sales/services/sales-write.service.ts'),
      'utf8',
    );
    const seamCalls = source.split('computeSaleAllocationLegs({').length - 1;
    assert.equal(seamCalls, 8, 'computeSaleAllocationLegs must be called twice at each of the four deduction sites (create/edit, parent/modifier)');
    assert.equal(source.split('currentAvailableQty: 0').length - 1, 0, 'the hardcoded 0 pooled-availability error quantity must be gone');
    const poolReads = source.match(/where\('location_id', 'is', null\)\s*\.where\('branch_id', 'is', null\)/g) || [];
    assert.equal(poolReads.length, 4, 'exactly four pool-row reads (one per deduction site) with the location+branch null predicate');
    const helper = readFileSync(
      resolve(__dirname, '../../src/modules/sales/helpers/sales-write.helper.ts'),
      'utf8',
    );
    assert.ok(helper.includes('export function computeSaleAllocationLegs'));
    assert.ok(helper.includes('fromPool: true'));
  }

  // --- Case 12: invariant pin — exactly one entry. (Last-line
  // ownership passes to newer entries: INV-VAN-DEDUP-DISTINGUISHING-KEY
  // appends after this entry, so the last-line assertion that held at
  // this package's own landing is relaxed here — test-only, behaviour
  // cases above are unchanged.)
  {
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-FLOATING-POOL-ALLOCATION-LEG').length - 1, 1, 'the invariant entry must exist exactly once');
  }

  console.log('Sale floating-pool allocation-leg tests passed');
}

main();
