import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .createTable('tenant_tax_settings')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar', (col) => col.notNull())
      .addColumn('account_id', 'varchar', (col) => col.notNull())
      .addColumn('provider', 'varchar', (col) => col.notNull()) // e.g. 'ETA_EGYPT'
      .addColumn('client_id', 'varchar')
      .addColumn('client_secret', 'varchar')
      .addColumn('tax_id', 'varchar')
      .addColumn('environment', 'varchar', (col) => col.defaultTo('sandbox'))
      .addColumn('is_active', 'boolean', (col) => col.defaultTo(true).notNull())
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
      .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
      .addUniqueConstraint('tenant_tax_settings_tenant_id_provider_key', ['tenant_id', 'provider'])
      .execute();

    await db.schema
      .alterTable('products')
      .addColumn('tax_code_type', 'varchar')
      .addColumn('tax_code', 'varchar')
      .execute();

    await db.schema
      .alterTable('sales')
      .addColumn('eta_uuid', 'varchar')
      .addColumn('eta_status', 'varchar', (col) => col.defaultTo('pending'))
      .addColumn('eta_submission_id', 'varchar')
      .execute();

    await db.schema
      .alterTable('return_documents')
      .addColumn('eta_uuid', 'varchar')
      .addColumn('eta_status', 'varchar', (col) => col.defaultTo('pending'))
      .addColumn('eta_submission_id', 'varchar')
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .alterTable('return_documents')
      .dropColumn('eta_submission_id')
      .dropColumn('eta_status')
      .dropColumn('eta_uuid')
      .execute();

    await db.schema
      .alterTable('sales')
      .dropColumn('eta_submission_id')
      .dropColumn('eta_status')
      .dropColumn('eta_uuid')
      .execute();

    await db.schema.alterTable('products').dropColumn('tax_code').dropColumn('tax_code_type').execute();

    await db.schema.dropTable('tenant_tax_settings').execute();
  },
};
