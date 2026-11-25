import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('purchase_attachments')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('purchase_id', 'integer', (col) => col.notNull().references('purchases.id').onDelete('cascade'))
      .addColumn('file_name', 'text', (col) => col.notNull())
      .addColumn('file_url', 'text', (col) => col.notNull())
      .addColumn('file_size', 'integer', (col) => col.notNull())
      .addColumn('file_type', 'text', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createIndex('purchase_attachments_purchase_id_idx')
      .ifNotExists()
      .on('purchase_attachments')
      .column('purchase_id')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropIndex('purchase_attachments_purchase_id_idx').ifExists().execute();
    await db.schema.dropTable('purchase_attachments').ifExists().execute();
  },
};
