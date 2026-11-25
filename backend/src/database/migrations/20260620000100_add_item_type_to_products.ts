import { Kysely } from 'kysely';

export const migration = {
  up: async (db: Kysely<unknown>): Promise<void> => {
    // Add item_type column to products table
    // Can be 'product' or 'raw_material'
    await db.schema
      .alterTable('products')
      .addColumn('item_type', 'varchar', (col) => col.notNull().defaultTo('product'))
      .execute();

    // Create an index for faster lookup since we will filter by item_type often
    await db.schema.createIndex('idx_products_item_type').on('products').column('item_type').execute();
  },

  down: async (db: Kysely<unknown>): Promise<void> => {
    await db.schema.dropIndex('idx_products_item_type').execute();

    await db.schema.alterTable('products').dropColumn('item_type').execute();
  },
};
