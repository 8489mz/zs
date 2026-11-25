import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await db.schema
      .alterTable('stock_transfers')
      .alterColumn('to_location_id', (col) => col.dropNotNull())
      .execute();
  },

  down: async (db: Kysely<Database>): Promise<void> => {
    await db.schema
      .alterTable('stock_transfers')
      .alterColumn('to_location_id', (col) => col.setNotNull())
      .execute();
  },
};
