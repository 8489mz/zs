import { type Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    try {
      await db.schema
        .createTable('accounting_fiscal_years')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('tenant_id', 'varchar(255)', (col) => col.notNull())
        .addColumn('name', 'varchar(150)', (col) => col.notNull())
        .addColumn('code', 'varchar(50)')
        .addColumn('start_date', 'date', (col) => col.notNull())
        .addColumn('end_date', 'date', (col) => col.notNull())
        .addColumn('status', 'varchar(50)', (col) => col.defaultTo('open').notNull())
        .addColumn('closing_entry_id', 'integer')
        .addColumn('net_profit_loss', 'numeric(15, 2)', (col) => col.defaultTo(0))
        .addColumn('total_revenue', 'numeric(15, 2)', (col) => col.defaultTo(0))
        .addColumn('total_expense', 'numeric(15, 2)', (col) => col.defaultTo(0))
        .addColumn('retained_earnings_account_id', 'integer')
        .addColumn('closed_at', 'timestamptz')
        .addColumn('closed_by', 'integer')
        .addColumn('closing_notes', 'text')
        .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
        .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
        .execute();

      await db.schema
        .createIndex('idx_accounting_fiscal_years_tenant')
        .on('accounting_fiscal_years')
        .column('tenant_id')
        .execute();

      await db.schema
        .createIndex('idx_accounting_fiscal_years_dates')
        .on('accounting_fiscal_years')
        .columns(['tenant_id', 'start_date', 'end_date'])
        .execute();

      await db.schema
        .createIndex('idx_accounting_fiscal_years_status')
        .on('accounting_fiscal_years')
        .columns(['tenant_id', 'status'])
        .execute();
    } catch (e) {
      // Table or index may already exist
    }
  },

  async down(db: Kysely<any>): Promise<void> {
    try {
      await db.schema.dropTable('accounting_fiscal_years').ifExists().execute();
    } catch (e) {}
  },
};
