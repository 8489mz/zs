import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .createTable('import_partner_ledger')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('tenant_id', 'text', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
      .addColumn('partner_id', 'uuid', (col) => col.notNull().references('import_partners.id').onDelete('cascade'))
      .addColumn('type', 'varchar(50)', (col) => col.notNull()) // 'DEPOSIT', 'WITHDRAWAL', 'PROFIT_PAYOUT'
      .addColumn('amount', 'numeric(15, 2)', (col) => col.notNull())
      .addColumn('transaction_date', 'date', (col) => col.notNull().defaultTo(sql`current_date`))
      .addColumn('note', 'text')
      .addColumn('created_by', 'integer')
      .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createIndex('import_partner_ledger_tenant_partner_idx')
      .on('import_partner_ledger')
      .columns(['tenant_id', 'partner_id'])
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.dropTable('import_partner_ledger').execute();
  },
};
