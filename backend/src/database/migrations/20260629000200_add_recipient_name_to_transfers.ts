import { Kysely } from 'kysely';

export const migration = {
  up: async (db: Kysely<unknown>): Promise<void> => {
    await db.schema.alterTable('stock_transfers').addColumn('recipient_name', 'varchar(255)').execute();
  },
  down: async (db: Kysely<unknown>): Promise<void> => {
    await db.schema.alterTable('stock_transfers').dropColumn('recipient_name').execute();
  },
};
