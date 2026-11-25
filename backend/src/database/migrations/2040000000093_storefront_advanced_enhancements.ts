import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    // 1. Add fulfillment and country columns to online_orders
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(32) DEFAULT 'delivery'`.execute(
      db,
    );
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS country_code VARCHAR(8) DEFAULT 'EG'`.execute(db);
    await sql`ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS pickup_branch_id INTEGER`.execute(db);

    // 2. Create storefront_abandoned_carts table
    await db.schema
      .createTable('storefront_abandoned_carts')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(128)', (col) => col.notNull())
      .addColumn('customer_name', 'varchar(255)')
      .addColumn('customer_phone', 'varchar(64)', (col) => col.notNull())
      .addColumn('country_code', 'varchar(8)', (col) => col.defaultTo('EG').notNull())
      .addColumn('items_json', 'text', (col) => col.defaultTo('[]').notNull())
      .addColumn('subtotal', 'numeric(15, 2)', (col) => col.defaultTo('0').notNull())
      .addColumn('recovered', 'boolean', (col) => col.defaultTo(false).notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .execute();

    // 3. Performance indexes for abandoned carts
    await db.schema
      .createIndex('idx_abandoned_carts_tenant_recovered')
      .ifNotExists()
      .on('storefront_abandoned_carts')
      .columns(['tenant_id', 'recovered'])
      .execute();

    await db.schema
      .createIndex('idx_abandoned_carts_tenant_created')
      .ifNotExists()
      .on('storefront_abandoned_carts')
      .columns(['tenant_id', 'created_at'])
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.dropTable('storefront_abandoned_carts').ifExists().execute();
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS pickup_branch_id`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS country_code`.execute(db);
    await sql`ALTER TABLE online_orders DROP COLUMN IF EXISTS fulfillment_type`.execute(db);
  },
};
