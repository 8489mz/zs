import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    // Add table_number and order_type to sales table
    await db.schema
      .alterTable('sales')
      .addColumn('table_number', 'text', (col) => col.defaultTo('').notNull())
      .addColumn('order_type', 'text', (col) => col.defaultTo('takeaway').notNull())
      .execute();

    // Add table_number and order_type to held_sales table
    await db.schema
      .alterTable('held_sales')
      .addColumn('table_number', 'text', (col) => col.defaultTo('').notNull())
      .addColumn('order_type', 'text', (col) => col.defaultTo('takeaway').notNull())
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('sales').dropColumn('table_number').dropColumn('order_type').execute();

    await db.schema.alterTable('held_sales').dropColumn('table_number').dropColumn('order_type').execute();
  },
};
