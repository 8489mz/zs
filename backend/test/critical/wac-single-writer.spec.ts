/*
New file: backend/test/critical/wac-single-writer.spec.ts
Pins costing unification package 1 (INV-WAC-SINGLE-WRITER): every
stock receipt blends through the one writer, valueStockReceipt —
the purchase, goods-receipt, and import paths no longer re-
implement read-blend-write by hand. The writer is only a thin
shell over the canonical engine: quantity recovery plus the
algebraic blend. The math is unchanged by the convergence; what
this spec pins is that the writer produces EXACTLY the engine's
number from the stored cost, on the real function, against a
real (PGlite) products row — including the negative-pool case —
and that it touches nothing else on the row.

WHAT THIS PINS, driving the REAL valueStockReceipt on PGlite:
- Normal blend, negative pool, and pool-emptying receipts all
  store exactly weightedReceiptCost(recoverWacBeforeQty(...)).
- A zero-quantity receipt rejects (the writer never blends
  nothing); callers guard qty > 0 before calling.
- A missing product row rejects instead of writing nowhere.
- updated_at is NOT touched by the writer: the converged
  purchase/goods-receipt/import paths no longer stamp it on
  receipt. No code reads products.updated_at for valuation.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { valueStockReceipt } from '../../src/modules/accounting/inventory-valuation';
import {
  recoverWacBeforeQty,
  weightedReceiptCost,
} from '../../src/modules/accounting/engines/inventory-valuation.engine';

async function main(): Promise<void> {
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

    async function storedCost(): Promise<number> {
      const row: any = await db
        .selectFrom('products' as any)
        .select('cost_price' as any)
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      return Number(row.cost_price);
    }
    async function storedStamp(): Promise<string> {
      const row: any = await db
        .selectFrom('products' as any)
        .select('updated_at' as any)
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      return new Date(row.updated_at).toISOString();
    }
    async function setCost(cost: number): Promise<void> {
      await db
        .updateTable('products' as any)
        .set({ cost_price: cost } as any)
        .where('id', '=', 1)
        .execute();
    }

    // Normal blend: 10 @ 5 on hand, receive 10 @ 6 -> 5.5.
    await valueStockReceipt(db as any, 't1', 1, 20, 10, 60);
    assert.equal(await storedCost(), 5.5);
    assert.equal(await storedStamp(), stamp.toISOString());

    // Negative pool: -10 @ 5, receive 20 @ 6 -> 7 (algebraic, no clamp).
    await setCost(5);
    await valueStockReceipt(db as any, 't1', 1, 10, 20, 120);
    assert.equal(await storedCost(), 7);

    // Pool-emptying receipt keeps the last booked cost.
    await setCost(5);
    await valueStockReceipt(db as any, 't1', 1, 0, 10, 50);
    assert.equal(await storedCost(), 5);

    // Equivalence table: the writer stores exactly the engine's
    // number for every shape, given the same stored cost.
    const shapes: Array<[number, number, number, number]> = [
      // [beforeQty, beforeCost, receivedQty, receivedValue]
      [100, 4.5, 50, 300],
      [0, 8, 10, 80],
      [-5, 10, 8, 40],
      [3, 2.333333, 7, 21],
    ];
    for (const [beforeQty, beforeCost, qty, value] of shapes) {
      await setCost(beforeCost);
      const afterQty = beforeQty + qty;
      await valueStockReceipt(db as any, 't1', 1, afterQty, qty, value);
      const expected = weightedReceiptCost(recoverWacBeforeQty(afterQty, qty), beforeCost, qty, value);
      assert.equal(await storedCost(), expected);
    }

    // Zero quantity rejects: callers must guard qty > 0.
    await assert.rejects(valueStockReceipt(db as any, 't1', 1, 10, 0, 0));
    // Missing product rejects instead of writing nowhere.
    await assert.rejects(valueStockReceipt(db as any, 't1', 999, 10, 5, 50));

    console.log('WAC single writer tests passed.');
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
