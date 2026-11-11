import { sql, type Kysely } from 'kysely';

/**
 * Allow `location_type = 'quarantine'` on stock_locations.
 *
 * INV-GRN-REAL-QUARANTINE: goods-receipt quarantine was name-only —
 * the accepted quantity was posted to the normal warehouse even when
 * a quarantine location was recorded on the GRN line, because no
 * quarantine location type existed and every sales availability read
 * treats any non-damaged / non-in-transit location as sellable. A
 * quarantine location must be a real type so the sales path can
 * exclude it exactly like `damaged` and `in_transit`.
 */
export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await sql`ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_type_valid`.execute(db);
    await sql`
      ALTER TABLE stock_locations
      ADD CONSTRAINT stock_locations_type_valid
      CHECK (location_type IN ('branch_stock', 'internal_warehouse', 'external_warehouse', 'damaged', 'in_transit', 'van_stock', 'quarantine'))
    `.execute(db);
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await sql`ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_type_valid`.execute(db);
    await sql`
      ALTER TABLE stock_locations
      ADD CONSTRAINT stock_locations_type_valid
      CHECK (location_type IN ('branch_stock', 'internal_warehouse', 'external_warehouse', 'damaged', 'in_transit', 'van_stock'))
    `.execute(db);
  },
};
