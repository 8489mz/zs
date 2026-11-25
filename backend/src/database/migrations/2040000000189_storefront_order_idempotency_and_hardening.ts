import { Kysely, sql } from 'kysely';

/**
 * Migration 189: Storefront Order Hardening & Idempotency.
 *
 * 1. Add `idempotency_key` column to `online_orders` to safely deduplicate client checkout submissions.
 * 2. Partial unique index on `(tenant_id, idempotency_key)` where idempotency_key IS NOT NULL.
 * 3. Partial unique index on `(tenant_id, sale_id)` where sale_id IS NOT NULL to physically prevent
 *    two concurrent conversions from ever linking multiple customer orders to the same sale.
 */
export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await sql`
      ALTER TABLE online_orders
      ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
    `.execute(db);

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_online_orders_tenant_idempotency
      ON online_orders(tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    `.execute(db);

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_online_orders_tenant_sale_id
      ON online_orders(tenant_id, sale_id)
      WHERE sale_id IS NOT NULL;
    `.execute(db);
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await sql`DROP INDEX IF EXISTS idx_online_orders_tenant_sale_id;`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_online_orders_tenant_idempotency;`.execute(db);
    await sql`
      ALTER TABLE online_orders
      DROP COLUMN IF EXISTS idempotency_key;
    `.execute(db);
  },
};
