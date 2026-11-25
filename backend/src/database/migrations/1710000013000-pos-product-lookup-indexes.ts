import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await sql`CREATE INDEX IF NOT EXISTS idx_products_active_barcode ON products(barcode) WHERE is_active = true AND barcode IS NOT NULL AND barcode <> ''`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_product_units_barcode ON product_units(barcode) WHERE barcode IS NOT NULL AND barcode <> ''`.execute(
      db,
    );
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`DROP INDEX IF EXISTS idx_product_units_barcode`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_products_active_barcode`.execute(db);
  },
};
