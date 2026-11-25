import { Kysely } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .alterTable('return_items')
      .addColumn('sale_item_id', 'integer', (col) => col.references('sale_items.id').onDelete('set null'))
      .addColumn('purchase_item_id', 'integer', (col) => col.references('purchase_items.id').onDelete('set null'))
      .execute();

    await db.schema.createIndex('idx_return_items_sale_item_id').on('return_items').column('sale_item_id').execute();

    await db.schema
      .createIndex('idx_return_items_purchase_item_id')
      .on('return_items')
      .column('purchase_item_id')
      .execute();
  },
  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.dropIndex('idx_return_items_sale_item_id').execute();
    await db.schema.dropIndex('idx_return_items_purchase_item_id').execute();

    await db.schema.alterTable('return_items').dropColumn('sale_item_id').dropColumn('purchase_item_id').execute();
  },
};
