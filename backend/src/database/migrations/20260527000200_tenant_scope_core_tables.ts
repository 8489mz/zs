import { sql, type Kysely } from 'kysely';

const TABLES = [
  'product_categories',
  'suppliers',
  'customers',
  'products',
  'product_units',
  'product_offers',
  'product_customer_prices',
  'sales',
  'sale_items',
  'purchases',
  'purchase_items',
  'customer_ledger',
  'supplier_ledger',
  'stock_movements',
  'product_location_stock',
] as const;

function demoTenantId(): string {
  return String(process.env.TENANT_ID || 'default').trim() || 'default';
}

function demoAccountId(): string {
  return String(process.env.ACCOUNT_ID || demoTenantId()).trim() || demoTenantId();
}

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    const tenantId = demoTenantId();
    const accountId = demoAccountId();

    for (const table of TABLES) {
      await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`.execute(
        db,
      );
      await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT ''`.execute(
        db,
      );
      await sql`UPDATE ${sql.table(table)} SET tenant_id = ${tenantId} WHERE tenant_id = ''`.execute(db);
      await sql`UPDATE ${sql.table(table)} SET account_id = ${accountId} WHERE account_id = ''`.execute(db);
    }
  },

  async down(db: Kysely<unknown>): Promise<void> {
    for (const table of [...TABLES].reverse()) {
      await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS account_id`.execute(db);
      await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN IF EXISTS tenant_id`.execute(db);
    }
  },
};
