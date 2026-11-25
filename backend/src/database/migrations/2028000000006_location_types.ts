import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await sql`
      ALTER TABLE stock_locations 
      ADD COLUMN IF NOT EXISTS location_type TEXT NOT NULL DEFAULT 'internal_warehouse';
    `.execute(db);

    await sql`
      ALTER TABLE stock_locations 
      ADD CONSTRAINT stock_locations_type_valid 
      CHECK (location_type IN ('branch_stock', 'internal_warehouse', 'external_warehouse', 'damaged', 'in_transit'));
    `.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`
      ALTER TABLE stock_locations 
      DROP CONSTRAINT IF EXISTS stock_locations_type_valid;
    `.execute(db);

    await sql`
      ALTER TABLE stock_locations 
      DROP COLUMN IF EXISTS location_type;
    `.execute(db);
  },
};
