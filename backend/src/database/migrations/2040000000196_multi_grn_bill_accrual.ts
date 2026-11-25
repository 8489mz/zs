import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await db.schema.alterTable('purchase_items').addColumn('grni_amount', 'numeric(14, 2)').execute();
    await sql`CREATE INDEX IF NOT EXISTS idx_purchase_items_tenant_grn_line
      ON purchase_items (tenant_id, grn_line_id) WHERE grn_line_id IS NOT NULL`.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_purchase_items_tenant_grn_line`.execute(db);
    await db.schema.alterTable('purchase_items').dropColumn('grni_amount').execute();
  },
};
