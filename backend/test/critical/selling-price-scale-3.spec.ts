import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { migration as widenMigration } from '../../src/database/migrations/2040000000278_selling_price_minor_unit_precision';

/*
 * Remaining selling-price storage at three minor units
 * (INV-SELLING-PRICE-SCALE-3).
 *
 * THE CORRECTION: the Slice 2 grounding first reported that
 * selling-price storage was NUMERIC(14,2) everywhere with no
 * widening migration — that reading missed the loop-based
 * widening migrations, which list columns as data, not as
 * ALTER COLUMN statements. The main sale chain was already
 * widened: 0258 (sales totals, sale_items unit_price /
 * line_total, sale_payments, customers, customer_ledger,
 * products retail/wholesale), 0259 (returns), 0277 (journal
 * lines), 0257 (purchases), 0252 (cost_price at 6dp). This
 * migration closes ONLY the remainder: the distribution
 * prices, held-sale amounts, online-order totals, and the
 * optional price-list / offer / per-customer price columns
 * those sweeps missed.
 *
 * THE RULE: migration 2040000000278 widens the required
 * columns to scale 3 (capacity preserved: integer digits
 * unchanged), following the 0257/0258/0277 pattern verbatim
 * — information_schema guard, skip when already scale >= 3,
 * throw when a required column is missing or not a fixed
 * NUMERIC, down is a no-op that never truncates history.
 * Optional columns widen when present as fixed NUMERICs and
 * are skipped silently otherwise. No code change: every
 * computation already rounds at the tenant's book digits;
 * this package closes the storage leg only. Per-tenant
 * behavior still follows the settings currency (KWD = 3,
 * EGP = 2) — a 2-decimal tenant's stored values are unchanged
 * by the wider columns. Prospective only: already-stored
 * prices keep their values byte-for-byte.
 *
 * WHAT THIS PINS, driving the REAL migration on PGlite
 * (fresh database per case):
 * - Migration: applying 0278 to 2dp tables widens every
 *   required column to scale 3, preserves existing rows
 *   unchanged, and afterwards 10.125 survives INSERT and
 *   reads back exactly; a second run is an idempotent no-op.
 * - Optional absence: a database without the optional
 *   tables still migrates without throwing.
 * - 2dp identity: a stored 10.12 reads back 10.12 after
 *   the widening.
 * - Source pin: the migration targets exactly the remaining
 *   columns and re-widens nothing 0258 already widened.
 * This is not an end-to-end run on live Postgres, and the
 * migration has not run against the production database —
 * it must run via the migration runner.
 */

const REQUIRED: Array<[string, string]> = [
  ['products', 'credit_price'],
  ['products', 'consumer_price'],
  ['products', 'min_selling_price'],
  ['sale_items', 'consumer_price'],
  ['sale_items', 'unit_offer_savings'],
  ['sales_order_items', 'consumer_price'],
  ['sales_order_items', 'unit_offer_savings'],
  ['held_sales', 'paid_amount'],
  ['held_sales', 'cash_amount'],
  ['held_sales', 'card_amount'],
  ['held_sales', 'discount'],
  ['held_sales', 'paid_online_amount'],
  ['held_sale_items', 'unit_price'],
  ['online_orders', 'subtotal'],
  ['online_orders', 'delivery_fee'],
  ['online_orders', 'total_amount'],
];

async function columnScales(pg: InstanceType<typeof PGlite>, table: string, columns: string[]): Promise<Array<[string, number, number]>> {
  const info = await pg.query<{ column_name: string; numeric_precision: string; numeric_scale: string }>(
    `SELECT column_name, numeric_precision::text, numeric_scale::text FROM information_schema.columns WHERE table_name='${table}' AND column_name IN (${columns.map((c) => `'${c}'`).join(',')}) ORDER BY column_name`,
  );
  return info.rows.map((r) => [r.column_name, Number(r.numeric_precision), Number(r.numeric_scale)]);
}

async function main(): Promise<void> {
  // Case 1: the migration itself — widen, preserve, round-trip, idempotent.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE products (id bigserial PRIMARY KEY, credit_price numeric(14, 2), consumer_price numeric(14, 2), min_selling_price numeric(14, 2));
        CREATE TABLE sale_items (id bigserial PRIMARY KEY, consumer_price numeric(14, 2), unit_offer_savings numeric(14, 2));
        CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, consumer_price numeric(14, 2), unit_offer_savings numeric(14, 2));
        CREATE TABLE held_sales (id bigserial PRIMARY KEY, paid_amount numeric(14, 2), cash_amount numeric(14, 2), card_amount numeric(14, 2), discount numeric(14, 2), paid_online_amount numeric(15, 2));
        CREATE TABLE held_sale_items (id bigserial PRIMARY KEY, unit_price numeric(14, 2));
        CREATE TABLE online_orders (id bigserial PRIMARY KEY, subtotal numeric(15, 2), delivery_fee numeric(15, 2), total_amount numeric(15, 2));
        INSERT INTO products (credit_price, consumer_price, min_selling_price) VALUES (10.12, 20.12, 5.12);
        INSERT INTO online_orders (subtotal, delivery_fee, total_amount) VALUES (100.12, 2.12, 102.24);
      `);
      await widenMigration.up(db as any);
      for (const [table, column] of REQUIRED) {
        const scales = await columnScales(pg, table, [column]);
        assert.equal(scales.length, 1, `expected ${table}.${column} to exist after migration`);
        assert.equal(scales[0][2], 3, `expected ${table}.${column} at scale 3, got ${scales[0][2]}`);
      }
      // Capacity preserved: (14,2) -> (15,3); (15,2) -> (16,3).
      assert.deepEqual(await columnScales(pg, 'products', ['credit_price']), [['credit_price', 15, 3]]);
      assert.deepEqual(await columnScales(pg, 'online_orders', ['total_amount']), [['total_amount', 16, 3]]);
      // Existing rows preserved byte-for-byte.
      const kept = await pg.query<{ credit_price: string; total_amount: string }>('SELECT credit_price::text, total_amount::text FROM products, online_orders');
      assert.deepEqual(kept.rows.map((r) => [Number(r.credit_price), Number(r.total_amount)]), [[10.12, 102.24]]);
      // 3dp values survive INSERT and read back exactly; 2dp identity holds.
      await pg.exec(`
        INSERT INTO products (credit_price, consumer_price, min_selling_price) VALUES (10.125, 10.12, 10.125);
        INSERT INTO held_sale_items (unit_price) VALUES (10.125);
        INSERT INTO online_orders (subtotal, delivery_fee, total_amount) VALUES (10.125, 0, 10.125);
      `);
      const roundTripped = await pg.query<{ credit_price: string; unit_price: string; total_amount: string }>(
        'SELECT p.credit_price::text, h.unit_price::text, o.total_amount::text FROM products p, held_sale_items h, online_orders o ORDER BY p.id DESC, h.id DESC, o.id DESC LIMIT 1',
      );
      assert.deepEqual(
        roundTripped.rows.map((r) => [Number(r.credit_price), Number(r.unit_price), Number(r.total_amount)]),
        [[10.125, 10.125, 10.125]],
      );
      // Idempotent: a second run is a no-op.
      await widenMigration.up(db as any);
      assert.deepEqual(await columnScales(pg, 'products', ['credit_price']), [['credit_price', 15, 3]]);
    } finally {
      await db.destroy();
    }
  }

  // Case 2: optional absence — no optional tables, migration still succeeds.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE products (id bigserial PRIMARY KEY, credit_price numeric(14, 2), consumer_price numeric(14, 2), min_selling_price numeric(14, 2));
        CREATE TABLE sale_items (id bigserial PRIMARY KEY, consumer_price numeric(14, 2), unit_offer_savings numeric(14, 2));
        CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, consumer_price numeric(14, 2), unit_offer_savings numeric(14, 2));
        CREATE TABLE held_sales (id bigserial PRIMARY KEY, paid_amount numeric(14, 2), cash_amount numeric(14, 2), card_amount numeric(14, 2), discount numeric(14, 2), paid_online_amount numeric(15, 2));
        CREATE TABLE held_sale_items (id bigserial PRIMARY KEY, unit_price numeric(14, 2));
        CREATE TABLE online_orders (id bigserial PRIMARY KEY, subtotal numeric(15, 2), delivery_fee numeric(15, 2), total_amount numeric(15, 2));
      `);
      await widenMigration.up(db as any);
      assert.deepEqual(await columnScales(pg, 'held_sales', ['paid_amount']), [['paid_amount', 15, 3]]);
    } finally {
      await db.destroy();
    }
  }

  // Case 3: source pin — exactly the remaining columns, nothing re-widened.
  {
    const migrationSource = readFileSync(resolve(__dirname, '../../src/database/migrations/2040000000278_selling_price_minor_unit_precision.ts'), 'utf8');
    for (const [table, column] of REQUIRED) {
      assert.ok(migrationSource.includes(`'${table}', '${column}', 3`), `missing required column ${table}.${column}`);
    }
    for (const alreadyWidened of ["'sales', 'total'", "'sale_items', 'unit_price'", "'products', 'retail_price'", "'sale_payments', 'amount'", "'journal_entry_lines', 'debit'"]) {
      assert.ok(!migrationSource.includes(alreadyWidened), `must not re-widen ${alreadyWidened}`);
    }
  }

  console.log('selling-price-scale-3: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
