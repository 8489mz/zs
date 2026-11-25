import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .createTable('style_code_counters')
      .addColumn('tenant_id', 'varchar(50)', (col) => col.notNull())
      .addColumn('scope', 'varchar(50)', (col) => col.notNull())
      .addColumn('next_value', 'integer', (col) => col.notNull().defaultTo(1001))
      .addPrimaryKeyConstraint('pk_style_code_counters', ['tenant_id', 'scope'])
      .execute();
  },
  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.dropTable('style_code_counters').execute();
  },
};
