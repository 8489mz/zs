import { Kysely } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable('products').addColumn('metadata', 'jsonb').execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable('products').dropColumn('metadata').execute();
  },
};
