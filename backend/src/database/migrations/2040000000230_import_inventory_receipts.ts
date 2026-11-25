import { Kysely, sql } from 'kysely';

/**
 * Continue the actual Kysely lexical tail (2040000000229). Historical 14-digit
 * 2026 prefixes sort BEFORE that tail; their numeric maximum is not execution order.
 * Additive only: historical stock, costs, notes and references are never rewritten.
 * Deploy with old import writers stopped until both migrations and new code are ready.
 */
export const migration = {
  up: async (db: Kysely<unknown>): Promise<void> => {
    // These indexes support the tenant-qualified receipt FKs and lookups.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_import_shipments_tenant_id
      ON import_shipments (tenant_id, id)`.execute(db);
    await sql`
      CREATE TABLE IF NOT EXISTS import_inventory_receipts (
        id BIGSERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        shipment_id UUID NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('posted', 'legacy_review_required')),
        review_reason TEXT,
        posted_at TIMESTAMPTZ,
        created_by BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, shipment_id),
        UNIQUE (tenant_id, id),
        CHECK ((state = 'posted' AND posted_at IS NOT NULL AND review_reason IS NULL)
          OR (state = 'legacy_review_required' AND posted_at IS NULL AND review_reason IS NOT NULL))
      )
    `.execute(db);
    await sql`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS import_receipt_id BIGINT`.execute(db);
    await sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_import_receipt_shipment'
          AND conrelid = 'import_inventory_receipts'::regclass) THEN
          ALTER TABLE import_inventory_receipts ADD CONSTRAINT fk_import_receipt_shipment
            FOREIGN KEY (tenant_id, shipment_id) REFERENCES import_shipments (tenant_id, id)
            ON DELETE RESTRICT NOT VALID;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_stock_import_receipt'
          AND conrelid = 'stock_movements'::regclass) THEN
          ALTER TABLE stock_movements ADD CONSTRAINT fk_stock_import_receipt
            FOREIGN KEY (tenant_id, import_receipt_id) REFERENCES import_inventory_receipts (tenant_id, id)
            ON DELETE RESTRICT NOT VALID;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_stock_import_receipt_reference'
          AND conrelid = 'stock_movements'::regclass) THEN
          ALTER TABLE stock_movements ADD CONSTRAINT ck_stock_import_receipt_reference CHECK (
            (import_receipt_id IS NULL AND reference_type IS DISTINCT FROM 'import_inventory_receipt')
            OR (import_receipt_id IS NOT NULL AND reference_type IS NOT NULL
              AND reference_type = 'import_inventory_receipt' AND reference_id IS NOT NULL
              AND reference_id = import_receipt_id AND product_id IS NOT NULL
              AND movement_type = 'import_receipt')
          ) NOT VALID;
        END IF;
      END $$
    `.execute(db);
    // One aggregated movement per product per new receipt; legacy rows remain unrestricted.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_import_receipt_product
      ON stock_movements (tenant_id, import_receipt_id, product_id)
      WHERE import_receipt_id IS NOT NULL`.execute(db);
  },
  down: async (): Promise<void> => {
    throw new Error(
      'Import receipt references are permanent. Use a reviewed forward migration; do not drop receipt evidence.',
    );
  },
};
