import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0320 — ensure allocation_type on import_sale_allocations
 * (INV-RETURN-IMPORT-ALLOCATION-TYPE-COLUMN).
 *
 * GROUNDING: restoreImportLotsFromSalesReturn in
 * import-lot-allocation.helper.ts filters on
 * import_sale_allocations.allocation_type ('sale'). On any database
 * where import_sale_allocations was created prior to migration 0239
 * or without that column, every non-composite sales return in
 * ReturnsService.createSaleReturn failed with a 500 database error.
 *
 * WHAT THIS DOES: adds allocation_type VARCHAR(50) DEFAULT 'sale'
 * to import_sale_allocations if it does not already exist.
 */

export async function up(db: any): Promise<void> {
  await sql`
    ALTER TABLE import_sale_allocations
      ADD COLUMN IF NOT EXISTS allocation_type VARCHAR(50) DEFAULT 'sale';
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`
    ALTER TABLE import_sale_allocations
      DROP COLUMN IF EXISTS allocation_type;
  `.execute(db);
}

export const migration: Migration = { up, down };
