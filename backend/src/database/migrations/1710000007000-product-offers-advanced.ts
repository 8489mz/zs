import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await sql`ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS min_qty NUMERIC NOT NULL DEFAULT 1`.execute(db);
    await sql`ALTER TABLE product_offers DROP CONSTRAINT IF EXISTS product_offers_type_valid`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers ADD CONSTRAINT product_offers_type_valid CHECK (offer_type IN ('percent','fixed','price'))`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers DROP CONSTRAINT IF EXISTS chk_product_offers_min_qty_positive`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers ADD CONSTRAINT chk_product_offers_min_qty_positive CHECK (min_qty >= 1)`
      .execute(db)
      .catch(() => undefined);
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`ALTER TABLE product_offers DROP CONSTRAINT IF EXISTS chk_product_offers_min_qty_positive`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers DROP CONSTRAINT IF EXISTS product_offers_type_valid`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers ADD CONSTRAINT product_offers_type_valid CHECK (offer_type IN ('percent','fixed'))`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers DROP COLUMN IF EXISTS min_qty`.execute(db).catch(() => undefined);
  },
};
