/*
New file: backend/test/critical/negative-stock-wac.spec.ts
Style follows backend/test/critical/cash-drawer-expected-cash-precision.spec.ts
(node:assert + PGlite, imports production code, no duplicated formulas).

WHAT THIS PINS: one WAC policy for negative stock (INV-NEGATIVE-STOCK-WAC).
Before this package, three receipt paths disagreed: purchases-write clamped a negative
prior quantity to zero, goods-receipt fell back to the incoming cost, and the strict
weightedReceiptCost engine THREW on beforeQty < 0 — blocking legitimate receipts after
overselling (sale returns, manufacturing completions, trade-ins, maintenance returns),
even though allowNegativeStockSales is a supported setting. The unified policy is the
algebraic blend through negative pools, because sales and consumptions expense at the
then-current cost_price, so the blend preserves book value exactly while its result
stays non-negative. The pure cases pin the formula and its two degenerate fallbacks;
the PGlite gate pins the previously-throwing path: valueStockReceipt after overselling
now updates cost_price instead of throwing.

THE ECONOMICS, WORKED ONCE (case 2): stock -10 at WAC 5 (10 units oversold, 50 already
expensed as COGS), then 20 units arrive at 6 (value 120). New WAC = (-50 + 120) / 10 = 7:
the 10 units on hand hold 70, exactly the received value minus what was already expensed.
The old clamp gave 6 (inventory 60 — 10 of value silently vanished); the old fallback
gave 6 as well. The old throw gave nothing at all, blocking the receipt.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { weightedReceiptCost } from '../../src/modules/accounting/engines/inventory-valuation.engine';
import { valueStockReceipt } from '../../src/modules/accounting/inventory-valuation';

async function main() {
  // Pure engine cases: positive pools behave exactly as before.
  assert.equal(weightedReceiptCost(100, 5, 20, 120), 5.166667);
  assert.equal(weightedReceiptCost(0, 5, 20, 120), 6);

  // Negative pool, recovered: the economics example above.
  assert.equal(weightedReceiptCost(-10, 5, 20, 120), 7);
  // Negative pool, still short, sane price: book value preserved exactly
  // (-10 * 5 + 36 = -14 for -4 units -> 3.5), so the next recovery blends exactly.
  assert.equal(weightedReceiptCost(-10, 5, 6, 36), 3.5);
  // Receipt exactly empties the pool: keep the last booked cost (stored cost is
  // irrelevant to future blends: 0 * cost == 0).
  assert.equal(weightedReceiptCost(-10, 5, 10, 60), 5);
  // Pathological price collapse on a recovered pool: algebraic would be -1, so fall
  // back to the incoming unit cost instead of storing a negative unit cost.
  assert.equal(weightedReceiptCost(-10, 5, 20, 40), 2);
  // Pathological price spike while still short: algebraic would be -17.5, so keep
  // the last booked cost instead of storing a negative unit cost.
  assert.equal(weightedReceiptCost(-10, 5, 6, 120), 5);

  // Remaining guards are unchanged: non-finite, negative unit cost, non-positive
  // receipt quantity, negative receipt value all still throw.
  assert.throws(() => weightedReceiptCost(100, 5, 0, 10), /Invalid inventory valuation inputs/);
  assert.throws(() => weightedReceiptCost(100, 5, 10, -1), /Invalid inventory valuation inputs/);
  assert.throws(() => weightedReceiptCost(100, -1, 10, 50), /Invalid inventory valuation inputs/);
  assert.throws(() => weightedReceiptCost(NaN, 5, 10, 50), /Invalid inventory valuation inputs/);

  // PGlite gate: valueStockReceipt after overselling no longer throws.
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, cost_price numeric);
      INSERT INTO products VALUES (1, 't1', 5), (2, 't1', 5);
    `);
    // Stock -5 at WAC 5, return 8 units at original cost 6: beforeQty -5, new WAC
    // (-25 + 48) / 3 = 7.666667. Before this package this call threw.
    await valueStockReceipt(db, 't1', 1, 3, 8, 48);
    const afterReturn = await db
      .selectFrom('products')
      .select('cost_price')
      .where('id', '=', 1)
      .where('tenant_id', '=', 't1')
      .executeTakeFirstOrThrow();
    assert.equal(Number(afterReturn.cost_price), 7.666667);
    // Exact-empty pool through the integrated path: stock -8, receipt 8, keep 5.
    await valueStockReceipt(db, 't1', 2, 0, 8, 48);
    const afterEmpty = await db
      .selectFrom('products')
      .select('cost_price')
      .where('id', '=', 2)
      .where('tenant_id', '=', 't1')
      .executeTakeFirstOrThrow();
    assert.equal(Number(afterEmpty.cost_price), 5);
  } finally {
    await db.destroy();
  }

  console.log('Negative-stock WAC tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
