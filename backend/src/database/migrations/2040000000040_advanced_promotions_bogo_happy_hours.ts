import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 1. Update offer_type constraint to include 'bogo'
    await sql`ALTER TABLE product_offers DROP CONSTRAINT IF EXISTS product_offers_type_valid`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers ADD CONSTRAINT product_offers_type_valid CHECK (offer_type IN ('percent','fixed','price','bundle','bogo'))`
      .execute(db)
      .catch(() => undefined);

    // 2. Add BOGO specific columns
    await sql`ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS bogo_buy_qty NUMERIC NULL`.execute(db);
    await sql`ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS bogo_get_qty NUMERIC NULL`.execute(db);
    await sql`ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS bogo_discount_percent NUMERIC NULL DEFAULT 100`.execute(
      db,
    );

    // 3. Add Happy Hours & Day-of-week scheduling columns
    await sql`ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS happy_hour_start VARCHAR(10) NULL`.execute(db);
    await sql`ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS happy_hour_end VARCHAR(10) NULL`.execute(db);
    await sql`ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS days_of_week VARCHAR(50) NULL`.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`ALTER TABLE product_offers DROP COLUMN IF EXISTS days_of_week`.execute(db);
    await sql`ALTER TABLE product_offers DROP COLUMN IF EXISTS happy_hour_end`.execute(db);
    await sql`ALTER TABLE product_offers DROP COLUMN IF EXISTS happy_hour_start`.execute(db);
    await sql`ALTER TABLE product_offers DROP COLUMN IF EXISTS bogo_discount_percent`.execute(db);
    await sql`ALTER TABLE product_offers DROP COLUMN IF EXISTS bogo_get_qty`.execute(db);
    await sql`ALTER TABLE product_offers DROP COLUMN IF EXISTS bogo_buy_qty`.execute(db);

    await sql`ALTER TABLE product_offers DROP CONSTRAINT IF EXISTS product_offers_type_valid`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers ADD CONSTRAINT product_offers_type_valid CHECK (offer_type IN ('percent','fixed','price','bundle'))`
      .execute(db)
      .catch(() => undefined);
  },
};
