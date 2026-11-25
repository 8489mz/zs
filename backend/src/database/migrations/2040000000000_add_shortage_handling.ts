import { Kysely } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .alterTable('import_shipment_items')
      .addColumn('shortage_handling_method', 'varchar(50)', (col) => col.defaultTo('capitalize'))
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable('import_shipment_items').dropColumn('shortage_handling_method').execute();
  },
};
