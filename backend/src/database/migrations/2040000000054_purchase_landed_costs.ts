import { type Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<any>): Promise<void> {
    try {
      await db.schema
        .createTable('purchase_landed_costs')
        .addColumn('id', 'serial', (col) => col.primaryKey())
        .addColumn('tenant_id', 'varchar(255)')
        .addColumn('purchase_id', 'integer', (col) => col.notNull())
        .addColumn('cost_type', 'varchar(50)', (col) => col.defaultTo('freight').notNull())
        .addColumn('description', 'text', (col) => col.notNull())
        .addColumn('amount', 'numeric(15, 2)', (col) => col.notNull())
        .addColumn('vendor_id', 'integer')
        .addColumn('allocation_method', 'varchar(20)', (col) => col.defaultTo('value').notNull())
        .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
        .execute();
    } catch (e) {
      // Table might already exist
    }

    try {
      await db.schema
        .alterTable('purchases')
        .addColumn('landed_cost_total', 'numeric(15, 2)', (col) => col.defaultTo(0))
        .execute();
    } catch (e) {}

    try {
      await db.schema.alterTable('purchases').addColumn('landed_cost_allocation_method', 'varchar(20)').execute();
    } catch (e) {}

    try {
      await db.schema.alterTable('purchases').addColumn('landed_cost_notes', 'text').execute();
    } catch (e) {}

    try {
      await db.schema.alterTable('purchases').addColumn('landed_cost_applied_at', 'timestamptz').execute();
    } catch (e) {}

    try {
      await db.schema
        .alterTable('purchase_items')
        .addColumn('allocated_landed_cost', 'numeric(15, 2)', (col) => col.defaultTo(0))
        .execute();
    } catch (e) {}

    try {
      await db.schema.alterTable('purchase_items').addColumn('landed_unit_cost', 'numeric(15, 2)').execute();
    } catch (e) {}
  },

  async down(db: Kysely<any>): Promise<void> {
    try {
      await db.schema.dropTable('purchase_landed_costs').ifExists().execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('purchases').dropColumn('landed_cost_total').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('purchases').dropColumn('landed_cost_allocation_method').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('purchases').dropColumn('landed_cost_notes').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('purchases').dropColumn('landed_cost_applied_at').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('purchase_items').dropColumn('allocated_landed_cost').execute();
    } catch (e) {}
    try {
      await db.schema.alterTable('purchase_items').dropColumn('landed_unit_cost').execute();
    } catch (e) {}
  },
};
