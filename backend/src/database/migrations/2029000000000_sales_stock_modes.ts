import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    // Add sales_stock_mode and allow_external_sales_stock to branches
    await db.schema
      .alterTable('branches')
      .addColumn('sales_stock_mode', 'varchar(50)', (col) => col.notNull().defaultTo('single_location'))
      .addColumn('allow_external_sales_stock', 'boolean', (col) => col.notNull().defaultTo(false))
      .execute();

    // Create sale_line_stock_allocations table
    await db.schema
      .createTable('sale_line_stock_allocations')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(50)', (col) => col.notNull())
      .addColumn('account_id', 'varchar(50)', (col) => col.notNull())
      .addColumn('sale_id', 'bigint', (col) => col.notNull().references('sales.id').onDelete('cascade'))
      .addColumn('sale_line_id', 'bigint', (col) => col.notNull().references('sale_items.id').onDelete('cascade'))
      .addColumn('product_id', 'bigint', (col) => col.notNull().references('products.id').onDelete('cascade'))
      .addColumn('location_id', 'bigint', (col) => col.notNull().references('stock_locations.id').onDelete('cascade'))
      .addColumn('quantity', 'decimal(12, 3)', (col) => col.notNull())
      .addColumn('allocation_order', 'integer', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
      .execute();

    await db.schema
      .createIndex('sale_line_stock_allocations_sale_line_id_idx')
      .on('sale_line_stock_allocations')
      .column('sale_line_id')
      .execute();

    await db.schema
      .createIndex('sale_line_stock_allocations_sale_id_idx')
      .on('sale_line_stock_allocations')
      .column('sale_id')
      .execute();
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await db.schema.dropTable('sale_line_stock_allocations').execute();
    await db.schema
      .alterTable('branches')
      .dropColumn('allow_external_sales_stock')
      .dropColumn('sales_stock_mode')
      .execute();
  },
};
