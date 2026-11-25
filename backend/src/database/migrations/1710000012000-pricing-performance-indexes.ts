import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await sql`CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id)`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id)`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active)`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE INDEX IF NOT EXISTS idx_products_stock_qty ON products(stock_qty)`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE INDEX IF NOT EXISTS idx_product_offers_product_id ON product_offers(product_id)`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE INDEX IF NOT EXISTS idx_product_customer_prices_product_id ON product_customer_prices(product_id)`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE INDEX IF NOT EXISTS idx_price_change_runs_status_id ON price_change_runs(status, id DESC)`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE INDEX IF NOT EXISTS idx_product_pricing_profiles_group_mode ON product_pricing_profiles(pricing_group_key, pricing_mode)`
      .execute(db)
      .catch(() => undefined);
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`DROP INDEX IF EXISTS idx_product_pricing_profiles_group_mode`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS idx_price_change_runs_status_id`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS idx_product_customer_prices_product_id`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS idx_product_offers_product_id`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS idx_products_stock_qty`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS idx_products_is_active`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS idx_products_category_id`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS idx_products_supplier_id`.execute(db).catch(() => undefined);
  },
};
