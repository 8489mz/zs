import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await sql`
      CREATE TABLE IF NOT EXISTS price_change_runs (
        id SERIAL PRIMARY KEY,
        filters_json TEXT NOT NULL DEFAULT '{}',
        operation_json TEXT NOT NULL DEFAULT '{}',
        options_json TEXT NOT NULL DEFAULT '{}',
        summary_json TEXT NOT NULL DEFAULT '{}',
        affected_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'applied',
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        undone_at TIMESTAMP NULL,
        undone_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL
      )
    `.execute(db);

    await sql`
      CREATE TABLE IF NOT EXISTS price_change_items (
        id SERIAL PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES price_change_runs(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        old_retail_price NUMERIC(14,2) NOT NULL,
        new_retail_price NUMERIC(14,2) NOT NULL,
        old_wholesale_price NUMERIC(14,2) NOT NULL,
        new_wholesale_price NUMERIC(14,2) NOT NULL,
        has_active_offer BOOLEAN NOT NULL DEFAULT FALSE,
        has_customer_price BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `.execute(db);

    await sql`CREATE INDEX IF NOT EXISTS idx_price_change_runs_created_at ON price_change_runs(created_at DESC)`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE INDEX IF NOT EXISTS idx_price_change_items_run_id ON price_change_items(run_id)`
      .execute(db)
      .catch(() => undefined);
    await sql`CREATE INDEX IF NOT EXISTS idx_price_change_items_product_id ON price_change_items(product_id)`
      .execute(db)
      .catch(() => undefined);
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`DROP INDEX IF EXISTS idx_price_change_items_product_id`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS idx_price_change_items_run_id`.execute(db).catch(() => undefined);
    await sql`DROP INDEX IF EXISTS idx_price_change_runs_created_at`.execute(db).catch(() => undefined);
    await sql`DROP TABLE IF EXISTS price_change_items`.execute(db).catch(() => undefined);
    await sql`DROP TABLE IF EXISTS price_change_runs`.execute(db).catch(() => undefined);
  },
};
