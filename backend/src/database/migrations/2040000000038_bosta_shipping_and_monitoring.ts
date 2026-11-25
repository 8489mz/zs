import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 1. Columns for online_orders
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(32) DEFAULT 'internal'`.execute(
      db,
    );
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS bosta_delivery_id VARCHAR(128)`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS bosta_tracking_number VARCHAR(128)`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS bosta_status VARCHAR(64)`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS bosta_awb_url TEXT`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS bosta_created_at TIMESTAMPTZ`.execute(db);

    // 2. Columns for sales (in case orders converted to sales retain courier details)
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS shipping_carrier VARCHAR(32) DEFAULT 'internal'`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS bosta_delivery_id VARCHAR(128)`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS bosta_tracking_number VARCHAR(128)`.execute(db);

    // 3. Index for fast tracking lookup
    await sql`CREATE INDEX IF NOT EXISTS idx_online_orders_bosta_tracking ON online_orders (tenant_id, bosta_tracking_number)`.execute(
      db,
    );
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_online_orders_bosta_tracking`.execute(db);

    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS bosta_created_at`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS bosta_awb_url`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS bosta_status`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS bosta_tracking_number`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS bosta_delivery_id`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS shipping_carrier`.execute(db);

    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS bosta_tracking_number`.execute(db);
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS bosta_delivery_id`.execute(db);
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS shipping_carrier`.execute(db);
  },
};
