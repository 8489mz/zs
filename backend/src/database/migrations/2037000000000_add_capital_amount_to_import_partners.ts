import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .alterTable('import_partners')
      .addColumn('capital_amount', 'numeric(15, 2)', (col) => col.defaultTo('0'))
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable('import_partners').dropColumn('capital_amount').execute();
  },
};
