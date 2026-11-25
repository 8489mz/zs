import { Kysely } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .alterTable('sales')
      .addColumn('customer_phone', 'varchar(255)')
      .addColumn('customer_address', 'varchar(1024)')
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable('sales').dropColumn('customer_phone').dropColumn('customer_address').execute();
  },
};
