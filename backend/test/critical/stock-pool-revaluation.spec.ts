/*
New file: backend/test/critical/stock-pool-revaluation.spec.ts
Pins costing unification package 2 (INV-STOCK-POOL-REVALUATION):
a late cost that lands on stock already on hand is a POOL
REVALUATION, not a receipt blend — one pure primitive spreads
the additional value over the existing pool, and one writer
applies it. The purchase landed-cost bump and the late shipment
expense bump used to inline the same identity in two different
forms (JS math in one, a SQL increment in the other, rounding
the increase first in the second). Both now go through the
primitive, which rounds the RESULT once.

WHAT THIS PINS:
- Pure rule table for revalueStockPool: the identity
  (qty * cost + additional) / qty at 6dp; a zero addition
  keeps the cost; a missing or non-positive pool, a negative
  cost, or a negative addition fails closed.
- The real revalueStockCost writer on PGlite: it reads the
  stored cost, writes the primitive's result, stamps
  updated_at (a repricing event, unlike a receipt), and
  rejects a missing product instead of writing nowhere.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { revalueStockCost } from '../../src/modules/accounting/inventory-valuation';
import { revalueStockPool } from '../../src/modules/accounting/engines/inventory-valuation.engine';

async function main(): Promise<void> {
  // ---- Pure primitive ----
  assert.equal(revalueStockPool(100, 5, 50), 5.5);
  assert.equal(revalueStockPool(100, 5, 0), 5);
  assert.equal(revalueStockPool(3, 2, 1), 2.333333);
  assert.equal(revalueStockPool(7, 10, 3.5), 10.5);
  assert.throws(() => revalueStockPool(0, 5, 50), /Invalid stock pool revaluation inputs/);
  assert.throws(() => revalueStockPool(-4, 5, 50), /Invalid stock pool revaluation inputs/);
  assert.throws(() => revalueStockPool(10, -1, 50), /Invalid stock pool revaluation inputs/);
  assert.throws(() => revalueStockPool(10, 5, -50), /Invalid stock pool revaluation inputs/);
  assert.throws(() => revalueStockPool(10, 5, Number.NaN), /Invalid stock pool revaluation inputs/);

  // ---- Real writer on PGlite ----
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text,
        cost_price numeric(19,6) DEFAULT 0, updated_at timestamptz);
    `);
    const stamp = new Date('2026-01-01T00:00:00.000Z');
    await pg.exec(
      `INSERT INTO products (id, tenant_id, cost_price, updated_at) VALUES (1, 't1', 5, '${stamp.toISOString()}')`,
    );

    await revalueStockCost(db as any, 't1', 1, 100, 50);
    const row: any = await db
      .selectFrom('products' as any)
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    assert.equal(Number(row.cost_price), 5.5);
    assert.ok(new Date(row.updated_at).getTime() > stamp.getTime(), 'revaluation stamps updated_at');

    await assert.rejects(revalueStockCost(db as any, 't1', 999, 100, 50));
    await assert.rejects(revalueStockCost(db as any, 't1', 1, 0, 50));

    console.log('Stock pool revaluation tests passed.');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
