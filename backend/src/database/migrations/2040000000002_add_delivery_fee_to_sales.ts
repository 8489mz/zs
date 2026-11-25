import { Kysely } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .alterTable('sales')
      .addColumn('delivery_fee', 'numeric(14, 3)', (cb) => cb.defaultTo('0').notNull())
      .execute();

    await db.schema
      .alterTable('held_sales')
      .addColumn('delivery_fee', 'numeric(14, 3)', (cb) => cb.defaultTo('0').notNull())
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable('sales').dropColumn('delivery_fee').execute();

    await db.schema.alterTable('held_sales').dropColumn('delivery_fee').execute();
  },
};
