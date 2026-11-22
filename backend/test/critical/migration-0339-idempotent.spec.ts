/*
 * Pristine P3 (2026-11-22): migration 0339 idempotency pin.
 *
 * THE FAILURE: migration 0339 originally did a plain Kysely
 * addColumn('van_trip_id', 'bigint'), but migration 0045 had
 * already created sales.van_trip_id as INTEGER. On any database
 * where migrations run in order from scratch, 0339 crashed with
 * column "van_trip_id" of relation "sales" already exists —
 * exactly what killed ci-full #174 in "Start backend for E2E"
 * (the specs were 308/308 green; the E2E step runs
 * `npm run migration:run` before starting the server).
 *
 * THE RULE: 0339 is an idempotent no-op guard only — the column
 * is owned by 0045 and stays INTEGER (0045/0268 convention;
 * SalesTable.van_trip_id is number | null). Running 0045 then
 * 0339 (twice) on the same database must not throw, must leave
 * sales.van_trip_id as integer, and 0339's down() must NOT drop
 * the column (0045 owns it).
 *
 * WHAT THIS PINS, driving the REAL migrations on PGlite:
 * - (a) 0045 up() creates sales.van_trip_id as integer;
 * - (b) 0339 up() after 0045 up() does not throw;
 * - (c) sales.van_trip_id is still integer after 0339 up(),
 *   and after a second 0339 up();
 * - (d) 0339 down() leaves the column in place.
 */

import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { migration as m0045 } from '../../src/database/migrations/2040000000045_van_sales_and_mobile_stock';
import { migration as m0339 } from '../../src/database/migrations/2040000000339_sales_van_trip_id';

async function columnType(db: Kysely<any>): Promise<string | null> {
  const result = await sql<{ data_type: string }>`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'sales' AND column_name = 'van_trip_id'
  `.execute(db);
  return result.rows.length === 0 ? null : result.rows[0].data_type;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  try {
    // Minimal tables 0045 up() needs: delivery_representatives
    // gains two columns (one FKs stock_locations), van_sales_trips
    // FKs delivery_representatives + stock_locations, and sales
    // plus customer_ledger each gain van_trip_id.
    await pg.exec(`
      CREATE TABLE stock_locations (id integer primary key);
      CREATE TABLE delivery_representatives (id integer primary key);
      CREATE TABLE sales (id integer primary key);
      CREATE TABLE customer_ledger (id integer primary key);
    `);

    // (a) 0045 creates the column as INTEGER.
    await m0045.up(db);
    assert.equal(await columnType(db), 'integer', '0045 creates sales.van_trip_id as integer');
    console.log('  (a) 0045 up() creates sales.van_trip_id integer passed');

    // (b) 0339 up() after 0045 up() does not throw (the old plain
    // addColumn crashed here: column already exists).
    await m0339.up(db);
    console.log('  (b) 0339 up() after 0045 up() does not throw passed');

    // (c) the column is still integer, and a second 0339 up() is
    // still a no-op.
    assert.equal(await columnType(db), 'integer', '0339 leaves sales.van_trip_id integer');
    await m0339.up(db);
    assert.equal(await columnType(db), 'integer', 'second 0339 up() leaves sales.van_trip_id integer');
    console.log('  (c) sales.van_trip_id stays integer across repeated 0339 up() passed');

    // (d) 0339 down() is a no-op: the column survives (0045 owns it).
    assert.ok(m0339.down, '0339 defines down');
    await m0339.down(db);
    assert.equal(await columnType(db), 'integer', '0339 down() does not drop sales.van_trip_id');
    console.log('  (d) 0339 down() leaves the column in place passed');
  } finally {
    await db.destroy();
  }

  console.log('Migration 0339 idempotency tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
