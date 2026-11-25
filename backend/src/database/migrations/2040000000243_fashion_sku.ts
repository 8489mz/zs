import { Kysely, sql } from 'kysely';

// All SKUs are unique per tenant among active products; archived products retain their history.
export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT`.execute(db);
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_active_sku_uidx ON products (tenant_id, lower(sku)) WHERE sku IS NOT NULL AND sku <> '' AND is_active = true`.execute(
      db,
    );
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS products_tenant_active_sku_uidx`.execute(db);
    await sql`ALTER TABLE products DROP COLUMN IF EXISTS sku`.execute(db);
  },
};
