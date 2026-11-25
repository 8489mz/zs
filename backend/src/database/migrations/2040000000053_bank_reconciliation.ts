import { type Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    try {
      await db.schema
        .createTable('bank_statements')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('tenant_id', 'varchar(255)')
        .addColumn('account_id', 'integer', (col) => col.notNull())
        .addColumn('statement_no', 'varchar(100)', (col) => col.notNull())
        .addColumn('statement_date', 'date', (col) => col.notNull())
        .addColumn('starting_balance', 'numeric(15, 2)', (col) => col.defaultTo(0).notNull())
        .addColumn('ending_balance', 'numeric(15, 2)', (col) => col.defaultTo(0).notNull())
        .addColumn('status', 'varchar(50)', (col) => col.defaultTo('draft').notNull())
        .addColumn('notes', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
        .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
        .execute();
    } catch (e) {
      // Table might already exist
    }

    try {
      await db.schema
        .createTable('bank_statement_lines')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('tenant_id', 'varchar(255)')
        .addColumn('statement_id', 'integer', (col) => col.notNull())
        .addColumn('line_date', 'date', (col) => col.notNull())
        .addColumn('description', 'text', (col) => col.notNull())
        .addColumn('reference', 'varchar(100)')
        .addColumn('amount', 'numeric(15, 2)', (col) => col.notNull())
        .addColumn('is_reconciled', 'boolean', (col) => col.defaultTo(false).notNull())
        .addColumn('matched_journal_line_id', 'integer')
        .addColumn('reconciled_at', 'timestamptz')
        .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
        .execute();
    } catch (e) {
      // Table might already exist
    }

    try {
      await db.schema
        .alterTable('journal_entry_lines')
        .addColumn('is_reconciled', 'boolean', (col) => col.defaultTo(false).notNull())
        .execute();
    } catch (e) {
      // Column might already exist
    }

    try {
      await db.schema.alterTable('journal_entry_lines').addColumn('reconciled_at', 'timestamptz').execute();
    } catch (e) {
      // Column might already exist
    }
  },

  async down(db: Kysely<any>): Promise<void> {
    try {
      await db.schema.dropTable('bank_statement_lines').ifExists().execute();
    } catch (e) {}
    try {
      await db.schema.dropTable('bank_statements').ifExists().execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('journal_entry_lines').dropColumn('is_reconciled').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('journal_entry_lines').dropColumn('reconciled_at').execute();
    } catch (e) {}
  },
};
