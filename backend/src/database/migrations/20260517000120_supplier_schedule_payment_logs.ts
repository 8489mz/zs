import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('supplier_payment_schedule_logs')
      .ifNotExists()
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('schedule_id', 'integer', (col) =>
        col.notNull().references('supplier_payment_schedules.id').onDelete('cascade'),
      )
      .addColumn('supplier_id', 'integer', (col) => col.notNull().references('suppliers.id'))
      .addColumn('amount', 'numeric', (col) => col.notNull())
      .addColumn('note', 'text', (col) => col.notNull().defaultTo(''))
      .addColumn('created_by', 'integer', (col) => col.references('users.id'))
      .addColumn('created_by_name', 'varchar(120)', (col) => col.notNull().defaultTo(''))
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createIndex('supplier_payment_schedule_logs_schedule_idx')
      .ifNotExists()
      .on('supplier_payment_schedule_logs')
      .column('schedule_id')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('supplier_payment_schedule_logs').ifExists().execute();
  },
};
