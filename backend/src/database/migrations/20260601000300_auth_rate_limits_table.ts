import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .createTable('auth_rate_limits')
      .ifNotExists()
      .addColumn('key', 'text', (col) => col.primaryKey())
      .addColumn('count', 'integer', (col) => col.notNull())
      .addColumn('reset_at', 'timestamptz', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();

    await db.schema
      .createIndex('auth_rate_limits_reset_at_idx')
      .ifNotExists()
      .on('auth_rate_limits')
      .column('reset_at')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropIndex('auth_rate_limits_reset_at_idx').ifExists().execute();
    await db.schema.dropTable('auth_rate_limits').ifExists().execute();
  },
};
