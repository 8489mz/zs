import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // 1. GCC shipping columns for online_orders
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS gcc_shipping_carrier VARCHAR(32)`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS gcc_shipping_id VARCHAR(128)`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS gcc_tracking_number VARCHAR(128)`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS gcc_shipping_status VARCHAR(64)`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS gcc_awb_url TEXT`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS gcc_shipping_created_at TIMESTAMPTZ`.execute(db);

    // 2. Fast tracking lookup index
    await sql`CREATE INDEX IF NOT EXISTS idx_online_orders_gcc_tracking ON online_orders (tenant_id, gcc_tracking_number)`.execute(
      db,
    );

    // 3. Columns for sales table
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS gcc_shipping_carrier VARCHAR(32)`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS gcc_tracking_number VARCHAR(128)`.execute(db);
  },

  async down(db: Kysely<any>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_online_orders_gcc_tracking`.execute(db);

    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS gcc_shipping_created_at`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS gcc_awb_url`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS gcc_shipping_status`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS gcc_tracking_number`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS gcc_shipping_id`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS gcc_shipping_carrier`.execute(db);

    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS gcc_tracking_number`.execute(db);
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS gcc_shipping_carrier`.execute(db);
  },
};
