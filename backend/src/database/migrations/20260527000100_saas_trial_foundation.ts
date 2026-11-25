import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('tenants')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('slug', 'text', (col) => col.notNull().unique())
      .addColumn('business_name', 'text', (col) => col.notNull())
      .addColumn('owner_name', 'text', (col) => col.notNull())
      .addColumn('owner_phone', 'text', (col) => col.notNull())
      .addColumn('owner_email', 'text')
      .addColumn('activity_type', 'text')
      .addColumn('status', 'text', (col) => col.notNull().defaultTo('trial'))
      .addColumn('trial_starts_at', 'timestamptz', (col) => col.notNull())
      .addColumn('trial_ends_at', 'timestamptz', (col) => col.notNull())
      .addColumn('activated_at', 'timestamptz')
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addCheckConstraint('tenants_status_valid', sql`status in ('trial', 'active', 'expired', 'suspended')`)
      .execute();

    await db.schema
      .createTable('trial_signups')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('tenant_id', 'text', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
      .addColumn('source', 'text')
      .addColumn('campaign', 'text')
      .addColumn('utm_source', 'text')
      .addColumn('utm_campaign', 'text')
      .addColumn('notes', 'text')
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema.createIndex('tenants_slug_idx').ifNotExists().on('tenants').column('slug').execute();
    await db.schema.createIndex('tenants_status_idx').ifNotExists().on('tenants').column('status').execute();
    await db.schema
      .createIndex('tenants_trial_ends_at_idx')
      .ifNotExists()
      .on('tenants')
      .column('trial_ends_at')
      .execute();
    await db.schema
      .createIndex('trial_signups_tenant_id_idx')
      .ifNotExists()
      .on('trial_signups')
      .column('tenant_id')
      .execute();

    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`.execute(db);
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id TEXT NOT NULL DEFAULT ''`.execute(db);
    await db.schema.createIndex('users_tenant_id_idx').ifNotExists().on('users').column('tenant_id').execute();
    await db.schema.createIndex('users_account_id_idx').ifNotExists().on('users').column('account_id').execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropIndex('users_account_id_idx').ifExists().execute();
    await db.schema.dropIndex('users_tenant_id_idx').ifExists().execute();
    await sql`ALTER TABLE users DROP COLUMN IF EXISTS account_id`.execute(db);
    await sql`ALTER TABLE users DROP COLUMN IF EXISTS tenant_id`.execute(db);
    await db.schema.dropIndex('trial_signups_tenant_id_idx').ifExists().execute();
    await db.schema.dropIndex('tenants_trial_ends_at_idx').ifExists().execute();
    await db.schema.dropIndex('tenants_status_idx').ifExists().execute();
    await db.schema.dropIndex('tenants_slug_idx').ifExists().execute();
    await db.schema.dropTable('trial_signups').ifExists().execute();
    await db.schema.dropTable('tenants').ifExists().execute();
  },
};
