import { Kysely } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable('customers').addColumn('metadata', 'jsonb').execute();

    await db.schema.alterTable('suppliers').addColumn('metadata', 'jsonb').execute();
  },
  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable('customers').dropColumn('metadata').execute();

    await db.schema.alterTable('suppliers').dropColumn('metadata').execute();
  },
};
