import { sql, type Kysely } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // =========================================================================
    // 1. Purchase Order linkage columns.
    // Migration 106 added grn_id / grn_line_id but never po_id / po_item_id, while the
    // three-way-match service reads purchase.po_id and purchase_items.po_item_id. Both were always
    // undefined, so poItems was always empty and the price-variance leg (MATCH-2) never fired:
    // the "three-way" match was structurally a two-way match.
    // =========================================================================
    await sql`
      ALTER TABLE purchases
        ADD COLUMN IF NOT EXISTS po_id BIGINT NULL,
        ADD COLUMN IF NOT EXISTS landed_cost_reapplied_count INTEGER NOT NULL DEFAULT 0;
    `.execute(db);

    await sql`
      ALTER TABLE purchase_items
        ADD COLUMN IF NOT EXISTS po_item_id BIGINT NULL;
    `.execute(db);

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_purchase_orders_tenant_id') THEN
          ALTER TABLE purchase_orders
            ADD CONSTRAINT uq_purchase_orders_tenant_id UNIQUE (tenant_id, id);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchases_po_tenant') THEN
          ALTER TABLE purchases
            ADD CONSTRAINT fk_purchases_po_tenant
            FOREIGN KEY (tenant_id, po_id)
            REFERENCES purchase_orders(tenant_id, id)
            ON DELETE RESTRICT NOT VALID;
        END IF;
      END $$;
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_purchases_po_id
        ON purchases (tenant_id, po_id) WHERE po_id IS NOT NULL;
    `.execute(db);

    await sql`
      CREATE INDEX IF NOT EXISTS idx_purchase_items_po_item
        ON purchase_items (tenant_id, po_item_id) WHERE po_item_id IS NOT NULL;
    `.execute(db);

    // =========================================================================
    // 2. Machine-readable blocking codes on the stored match result.
    // Overall status was previously derived by substring-matching Arabic prose.
    // =========================================================================
    await sql`
      ALTER TABLE purchase_three_way_matches
        ADD COLUMN IF NOT EXISTS blocking_codes TEXT[] NULL,
        ADD COLUMN IF NOT EXISTS reconciliation_discrepancy NUMERIC(15, 4) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS override_scope TEXT NULL;
    `.execute(db);

    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_three_way_override_scope') THEN
          ALTER TABLE purchase_three_way_matches
            ADD CONSTRAINT chk_three_way_override_scope
            CHECK (override_scope IS NULL OR override_scope IN ('price_only', 'full'));
        END IF;
      END $$;
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE purchase_three_way_matches DROP CONSTRAINT IF EXISTS chk_three_way_override_scope;`.execute(
      db,
    );
    await sql`
      ALTER TABLE purchase_three_way_matches
        DROP COLUMN IF EXISTS blocking_codes,
        DROP COLUMN IF EXISTS reconciliation_discrepancy,
        DROP COLUMN IF EXISTS override_scope;
    `.execute(db);
    await sql`DROP INDEX IF EXISTS idx_purchase_items_po_item;`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_purchases_po_id;`.execute(db);
    await sql`ALTER TABLE purchases DROP CONSTRAINT IF EXISTS fk_purchases_po_tenant;`.execute(db);
    await sql`ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS uq_purchase_orders_tenant_id;`.execute(db);
    await sql`ALTER TABLE purchase_items DROP COLUMN IF EXISTS po_item_id;`.execute(db);
    await sql`
      ALTER TABLE purchases
        DROP COLUMN IF EXISTS po_id,
        DROP COLUMN IF EXISTS landed_cost_reapplied_count;
    `.execute(db);
  },
};
