import { Kysely, sql } from 'kysely';

export const migration = {
  up: async (db: Kysely<any>): Promise<void> => {
    // 1. Update import_shipments
    await db.schema
      .alterTable('import_shipments')
      .addColumn('supplier_id', 'bigint', (col) => col.references('suppliers.id').onDelete('restrict'))
      .addColumn('bill_of_lading', 'varchar(255)')
      .addColumn('shipping_date', 'date')
      .execute();

    // 2. Update import_partners
    await db.schema
      .alterTable('import_partners')
      .addColumn('withdrawn_profit', 'numeric(15, 2)', (col) => col.defaultTo('0'))
      .execute();
  },

  down: async (db: Kysely<any>): Promise<void> => {
    await db.schema
      .alterTable('import_shipments')
      .dropColumn('supplier_id')
      .dropColumn('bill_of_lading')
      .dropColumn('shipping_date')
      .execute();

    await db.schema.alterTable('import_partners').dropColumn('withdrawn_profit').execute();
  },
};
