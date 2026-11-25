import { sql, type Kysely } from 'kysely';

/**
 * Migration 2040000000169: Normalize Catalog & Demo Tenant Account IDs
 *
 * Resolves account_id mismatch for seeded demo data or tenants where operational rows
 * were stored with account_id = tenant_id instead of the tenant's standard account_id ('${tenant_id}:main' or user's account_id).
 * This ensures catalog products, categories, stock, and partners align seamlessly with the tenant owner's session.
 */
export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    const tables = [
      'products',
      'product_categories',
      'product_units',
      'product_offers',
      'product_customer_prices',
      'product_location_stock',
      'stock_movements',
      'customers',
      'suppliers',
      'delivery_representatives',
      'branches',
      'stock_locations',
      'sales',
      'sale_items',
      'sale_payments',
      'purchases',
      'purchase_items',
      'users',
    ];

    for (const table of tables) {
      await sql`
        UPDATE ${sql.table(table)} t
        SET account_id = COALESCE(
          (
            SELECT u.account_id 
            FROM users u 
            WHERE u.tenant_id = t.tenant_id 
              AND u.account_id IS NOT NULL 
              AND u.account_id != t.tenant_id 
            ORDER BY u.created_at ASC 
            LIMIT 1
          ),
          t.tenant_id || ':main'
        )
        WHERE t.account_id = t.tenant_id
          AND t.tenant_id IS NOT NULL
          AND t.tenant_id NOT IN ('zs', 'default', 'dev-tenant');
      `
        .execute(db)
        .catch(() => undefined);
    }
  },

  down: async (): Promise<void> => {
    // No-op rollback: normalized account_id preserves tenant isolation
  },
};
