import { Kysely } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable('import_shipments').addColumn('pricing_exchange_rate', 'numeric(14, 4)').execute();

    await db.schema
      .alterTable('import_shipment_items')
      .addColumn('target_retail_margin', 'numeric(5, 2)')
      .addColumn('target_wholesale_margin', 'numeric(5, 2)')
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema.alterTable('import_shipments').dropColumn('pricing_exchange_rate').execute();

    await db.schema
      .alterTable('import_shipment_items')
      .dropColumn('target_retail_margin')
      .dropColumn('target_wholesale_margin')
      .execute();
  },
};
