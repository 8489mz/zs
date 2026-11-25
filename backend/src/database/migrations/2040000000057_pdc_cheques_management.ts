import { type Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    try {
      await db.schema
        .createTable('accounting_cheques')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('tenant_id', 'varchar(255)', (col) => col.notNull())
        .addColumn('account_id', 'integer')
        .addColumn('type', 'varchar(30)', (col) => col.notNull()) // 'receivable' | 'payable'
        .addColumn('cheque_number', 'varchar(100)', (col) => col.notNull())
        .addColumn('bank_name', 'varchar(150)', (col) => col.notNull())
        .addColumn('branch_name', 'varchar(150)')
        .addColumn('drawer_name', 'varchar(200)')
        .addColumn('partner_type', 'varchar(50)', (col) => col.defaultTo('customer'))
        .addColumn('partner_id', 'integer')
        .addColumn('partner_name', 'varchar(255)', (col) => col.notNull())
        .addColumn('amount', 'numeric(15, 2)', (col) => col.notNull())
        .addColumn('currency', 'varchar(10)', (col) => col.defaultTo('EGP').notNull())
        .addColumn('issue_date', 'date', (col) => col.notNull())
        .addColumn('due_date', 'date', (col) => col.notNull())
        .addColumn('status', 'varchar(50)', (col) => col.defaultTo('in_safe').notNull())
        .addColumn('deposit_bank_id', 'integer')
        .addColumn('deposit_date', 'date')
        .addColumn('cleared_date', 'date')
        .addColumn('bounced_date', 'date')
        .addColumn('bounced_reason', 'text')
        .addColumn('bounced_fee', 'numeric(15, 2)', (col) => col.defaultTo(0))
        .addColumn('endorsed_to_supplier_id', 'integer')
        .addColumn('endorsed_to_supplier_name', 'varchar(255)')
        .addColumn('journal_entry_id', 'integer')
        .addColumn('notes', 'text')
        .addColumn('created_by', 'integer')
        .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
        .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
        .execute();

      await db.schema
        .createIndex('idx_accounting_cheques_tenant')
        .on('accounting_cheques')
        .column('tenant_id')
        .execute();

      await db.schema
        .createIndex('idx_accounting_cheques_type_status')
        .on('accounting_cheques')
        .columns(['tenant_id', 'type', 'status'])
        .execute();

      await db.schema
        .createIndex('idx_accounting_cheques_due_date')
        .on('accounting_cheques')
        .columns(['tenant_id', 'due_date'])
        .execute();

      await db.schema
        .createIndex('idx_accounting_cheques_number')
        .on('accounting_cheques')
        .columns(['tenant_id', 'cheque_number'])
        .execute();
    } catch (e) {
      // Table or index may already exist
    }
  },

  async down(db: Kysely<any>): Promise<void> {
    try {
      await db.schema.dropTable('accounting_cheques').ifExists().execute();
    } catch (e) {}
  },
};
