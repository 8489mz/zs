import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    // 1. Add payment tracking columns to online_orders
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(32) DEFAULT 'pending'`.execute(
      db,
    );
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS gateway_provider VARCHAR(64)`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS gateway_transaction_id VARCHAR(128)`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS gateway_order_id VARCHAR(128)`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS gateway_response_json TEXT`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`.execute(db);

    // 2. Performance index on tenant_id and payment_status
    await db.schema
      .createIndex('idx_online_orders_tenant_payment_status')
      .ifNotExists()
      .on('online_orders')
      .columns(['tenant_id', 'payment_status'])
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.dropIndex('idx_online_orders_tenant_payment_status').ifExists().execute();
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS paid_at`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS gateway_response_json`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS gateway_order_id`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS gateway_transaction_id`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS gateway_provider`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS payment_status`.execute(db);
  },
};
