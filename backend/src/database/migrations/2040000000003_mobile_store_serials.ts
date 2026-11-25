import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    // 1. Add track_serials to products
    await db.schema
      .alterTable('products')
      .addColumn('track_serials', 'boolean', (cb) => cb.defaultTo(false).notNull())
      .execute();

    // 2. Add serials column to sale_items and purchase_items for direct tracking
    await db.schema
      .alterTable('sale_items')
      .addColumn('serials', 'jsonb', (cb) => cb.defaultTo('[]').notNull())
      .execute();

    await db.schema
      .alterTable('purchase_items')
      .addColumn('serials', 'jsonb', (cb) => cb.defaultTo('[]').notNull())
      .execute();

    await db.schema
      .alterTable('held_sale_items')
      .addColumn('serials', 'jsonb', (cb) => cb.defaultTo('[]').notNull())
      .execute();

    // 3. Create product_serials table
    await db.schema
      .createTable('product_serials')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'text', (col) => col.notNull())
      .addColumn('account_id', 'text', (col) => col.notNull())
      .addColumn('product_id', 'integer', (col) => col.notNull())
      .addColumn('serial_number', 'varchar(120)', (col) => col.notNull())
      .addColumn('imei_2', 'varchar(120)')
      .addColumn('status', 'varchar(50)', (col) => col.defaultTo('in_stock').notNull())
      .addColumn('branch_id', 'integer')
      .addColumn('location_id', 'integer')
      .addColumn('cost_price', 'numeric(14, 3)', (col) => col.defaultTo('0').notNull())
      .addColumn('purchase_id', 'integer')
      .addColumn('purchase_item_id', 'integer')
      .addColumn('sale_id', 'integer')
      .addColumn('sale_item_id', 'integer')
      .addColumn('warranty_end_date', 'date')
      .addColumn('notes', 'text')
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
      .execute();

    // 4. Create indexes
    await db.schema
      .createIndex('idx_product_serials_tenant_serial')
      .on('product_serials')
      .columns(['tenant_id', 'account_id', 'serial_number'])
      .execute();

    await db.schema
      .createIndex('idx_product_serials_product_status')
      .on('product_serials')
      .columns(['tenant_id', 'account_id', 'product_id', 'status'])
      .execute();

    await db.schema
      .createIndex('idx_product_serials_location_status')
      .on('product_serials')
      .columns(['tenant_id', 'location_id', 'status'])
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.dropTable('product_serials').ifExists().execute();
    await db.schema.alterTable('products').dropColumn('track_serials').execute();
    await db.schema.alterTable('sale_items').dropColumn('serials').execute();
    await db.schema.alterTable('purchase_items').dropColumn('serials').execute();
    await db.schema.alterTable('held_sale_items').dropColumn('serials').execute();
  },
};
