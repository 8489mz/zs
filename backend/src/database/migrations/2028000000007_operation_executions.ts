import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('operation_executions')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(50)', (col) => col.notNull())
      .addColumn('account_id', 'varchar(50)', (col) => col.notNull())
      .addColumn('idempotency_key', 'varchar(100)', (col) => col.notNull())
      .addColumn('operation_type', 'varchar(50)', (col) => col.notNull())
      .addColumn('status', 'varchar(50)', (col) => col.notNull()) // processing, committed, failed, recovery_required
      .addColumn('request_hash', 'varchar(255)', (col) => col.notNull())
      .addColumn('document_id', 'varchar(100)')
      .addColumn('response_payload', 'text')
      .addColumn('error_code', 'varchar(100)')
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('completed_at', 'timestamp')
      .execute();

    await db.schema
      .createIndex('idx_operation_executions_unique')
      .on('operation_executions')
      .columns(['tenant_id', 'account_id', 'idempotency_key', 'operation_type'])
      .unique()
      .execute();

    await db.schema
      .createIndex('idx_operation_executions_status')
      .on('operation_executions')
      .columns(['status', 'updated_at'])
      .execute();

    await db.schema
      .createIndex('idx_operation_executions_document')
      .on('operation_executions')
      .columns(['document_id'])
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('operation_executions').execute();
  },
};
