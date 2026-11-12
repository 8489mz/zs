/*
 * backend/test/critical/import-sale-allocations-allocation-type.spec.ts
 * Pins INV-RETURN-IMPORT-ALLOCATION-TYPE-COLUMN:
 * Migration 0319 ensures import_sale_allocations.allocation_type exists
 * with default 'sale' so restoreImportLotsFromSalesReturn does not crash
 * on databases where the table was created without this column.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { migration } from '../../src/database/migrations/2040000000319_import_sale_allocations_allocation_type';

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });

  try {
    // 1. Create import_sale_allocations WITHOUT allocation_type (legacy state)
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY);
      INSERT INTO tenants VALUES ('t1');

      CREATE TABLE import_sale_allocations (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        sale_id bigint NOT NULL,
        sale_item_id bigint,
        lot_id text NOT NULL,
        project_id text,
        shipment_id text,
        product_id bigint NOT NULL,
        quantity numeric(12, 2) NOT NULL,
        unit_sale_price_egp numeric(15, 2) NOT NULL,
        unit_cost_egp numeric(15, 4) NOT NULL,
        gross_margin_egp numeric(15, 2) NOT NULL,
        created_at timestamptz DEFAULT NOW()
      );
    `);

    // Insert legacy row before migration
    await sql`
      INSERT INTO import_sale_allocations (
        id, tenant_id, sale_id, sale_item_id, lot_id, product_id,
        quantity, unit_sale_price_egp, unit_cost_egp, gross_margin_egp
      ) VALUES (
        'alloc-1', 't1', 100, 10, 'lot-1', 50,
        5.00, 100.00, 80.00, 100.00
      );
    `.execute(db);

    // 2. Run migration up()
    await migration.up(db as never);

    // 3. Verify legacy row now reads allocation_type = 'sale'
    const legacyRow = await db
      .selectFrom('import_sale_allocations')
      .selectAll()
      .where('id', '=', 'alloc-1')
      .executeTakeFirstOrThrow();

    assert.equal(legacyRow.allocation_type, 'sale', 'legacy row must have default allocation_type of sale');

    // 4. Verify new insert with allocation_type = 'return' works
    await sql`
      INSERT INTO import_sale_allocations (
        id, tenant_id, sale_id, sale_item_id, lot_id, product_id,
        quantity, unit_sale_price_egp, unit_cost_egp, gross_margin_egp,
        allocation_type
      ) VALUES (
        'alloc-2', 't1', 100, 10, 'lot-1', 50,
        -2.00, 100.00, 80.00, -40.00,
        'return'
      );
    `.execute(db);

    const returnRow = await db
      .selectFrom('import_sale_allocations')
      .selectAll()
      .where('id', '=', 'alloc-2')
      .executeTakeFirstOrThrow();

    assert.equal(returnRow.allocation_type, 'return', 'new row can specify allocation_type = return');

    // 5. Query filtering on allocation_type = 'sale' returns only the sale row
    const saleRows = await db
      .selectFrom('import_sale_allocations')
      .selectAll()
      .where('allocation_type', '=', 'sale')
      .execute();

    assert.equal(saleRows.length, 1);
    assert.equal(saleRows[0].id, 'alloc-1');

    // 6. Migration up() is idempotent (re-running it does not fail)
    await migration.up(db as never);

    // 7. Migration down() drops the column cleanly
    assert.ok(migration.down, 'migration.down must be defined');
    await migration.down(db as never);

    const colsAfterDown = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'import_sale_allocations' AND column_name = 'allocation_type'
    `.execute(db);
    assert.equal(colsAfterDown.rows.length, 0, 'down() must drop allocation_type');

    console.log('import_sale_allocations allocation_type migration checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
