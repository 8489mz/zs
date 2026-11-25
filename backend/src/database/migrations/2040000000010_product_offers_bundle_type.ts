import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await sql`ALTER TABLE product_offers DROP CONSTRAINT IF EXISTS product_offers_type_valid`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers ADD CONSTRAINT product_offers_type_valid CHECK (offer_type IN ('percent','fixed','price','bundle'))`
      .execute(db)
      .catch(() => undefined);
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`ALTER TABLE product_offers DROP CONSTRAINT IF EXISTS product_offers_type_valid`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers ADD CONSTRAINT product_offers_type_valid CHECK (offer_type IN ('percent','fixed','price'))`
      .execute(db)
      .catch(() => undefined);
  },
};
