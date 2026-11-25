import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema
      .alterTable('sales')
      .addColumn('applied_amount', 'numeric(14, 2)', (col) => col.notNull().defaultTo(0))
      .execute();
    await db.schema
      .alterTable('sale_payments')
      .addColumn('applied_amount', 'numeric(14, 2)', (col) => col.notNull().defaultTo(0))
      .addColumn('tendered_amount', 'numeric(14, 2)', (col) => col.notNull().defaultTo(0))
      .addColumn('change_amount', 'numeric(14, 2)', (col) => col.notNull().defaultTo(0))
      .execute();
    await db.schema
      .alterTable('sale_items')
      .addColumn('net_unit_price', 'numeric(14, 6)')
      .addColumn('net_line_total', 'numeric(14, 2)')
      .addColumn('allocated_discount', 'numeric(14, 2)')
      .addColumn('allocated_tax', 'numeric(14, 2)')
      .execute();
    await db.schema
      .alterTable('return_items')
      .addColumn('cost_price', 'numeric(14, 2)')
      .addColumn('allocated_tax', 'numeric(14, 2)')
      .execute();
    await db.schema.alterTable('return_documents').addColumn('refund_allocations', 'jsonb').execute();
    await sql`UPDATE sales SET applied_amount = paid_amount`.execute(db);
    await sql`UPDATE sale_payments SET applied_amount = amount, tendered_amount = amount`.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('return_documents').dropColumn('refund_allocations').execute();
    await db.schema.alterTable('return_items').dropColumn('cost_price').dropColumn('allocated_tax').execute();
    await db.schema
      .alterTable('sale_items')
      .dropColumn('net_unit_price')
      .dropColumn('net_line_total')
      .dropColumn('allocated_discount')
      .dropColumn('allocated_tax')
      .execute();
    await db.schema
      .alterTable('sale_payments')
      .dropColumn('applied_amount')
      .dropColumn('tendered_amount')
      .dropColumn('change_amount')
      .execute();
    await db.schema.alterTable('sales').dropColumn('applied_amount').execute();
  },
};
