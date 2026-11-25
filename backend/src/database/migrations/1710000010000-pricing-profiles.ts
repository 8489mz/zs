import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await sql`
      CREATE TABLE IF NOT EXISTS product_pricing_profiles (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
        pricing_group_key TEXT NULL,
        pricing_mode TEXT NOT NULL DEFAULT 'standard',
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT product_pricing_profiles_mode_valid CHECK (pricing_mode IN ('standard','inherit','manual'))
      )
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_product_pricing_profiles_group_key ON product_pricing_profiles(pricing_group_key)`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE INDEX IF NOT EXISTS idx_product_pricing_profiles_mode ON product_pricing_profiles(pricing_mode)`
      .execute(db)
      .catch(() => undefined);
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`DROP INDEX IF EXISTS idx_product_pricing_profiles_mode`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS idx_product_pricing_profiles_group_key`.execute(db).catch(() => undefined);
    await sql`DROP TABLE IF EXISTS product_pricing_profiles`.execute(db).catch(() => undefined);
  },
};
