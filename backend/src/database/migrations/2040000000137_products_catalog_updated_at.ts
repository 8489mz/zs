import { sql, type Kysely } from 'kysely';

// PERF-9 (PERFORMANCE_CONSTITUTION.md, formerly open item PO-1).
//
// Every POS terminal keeps the whole catalog in IndexedDB so it can keep selling when the internet
// drops, and re-downloads it when GET /api/catalog/pos-products/version changes. That version was
// built from MAX(products.updated_at) — and applyStockDelta stamps updated_at on EVERY sale. So one
// sale anywhere made every terminal re-download the full catalog (up to 25k products) on its next
// 5-minute heartbeat, all day long, although no price, name or barcode had changed.
//
// `catalog_updated_at` moves only when something a cashier's offline catalog depends on changes.
// It is maintained by a trigger, not by application code, on purpose: prices are written from many
// places (product form, pricing center bulk runs, margin protection, imports, restore) and a column
// that each writer must remember to bump is exactly the "correct logic, not wired" failure mode of
// ARCHITECTURE_INVARIANTS.md §1. The trigger compares the whole row minus the columns below, so a
// column added to `products` later counts as a catalog change by default (fail-safe = extra reload).
//
// Excluded (never shown in the POS catalog, or refreshed by the hourly full reload instead):
//   stock_qty, reserved_qty   stock moves on every sale/reservation — the reason for this migration
//   cost_price                weighted average cost moves on every purchase receipt; not in the POS payload
//   updated_at, catalog_updated_at
export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.execute(
      db,
    );
    await sql`UPDATE products SET catalog_updated_at = COALESCE(updated_at, created_at, NOW())`.execute(db);

    await sql`
      CREATE OR REPLACE FUNCTION products_touch_catalog_updated_at() RETURNS trigger AS $$
      BEGIN
        IF (to_jsonb(NEW) - 'stock_qty' - 'reserved_qty' - 'cost_price' - 'updated_at' - 'catalog_updated_at')
           IS DISTINCT FROM
           (to_jsonb(OLD) - 'stock_qty' - 'reserved_qty' - 'cost_price' - 'updated_at' - 'catalog_updated_at') THEN
          NEW.catalog_updated_at := NOW();
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `.execute(db);

    await sql`DROP TRIGGER IF EXISTS trg_products_catalog_updated_at ON products`.execute(db);
    await sql`
      CREATE TRIGGER trg_products_catalog_updated_at
      BEFORE UPDATE ON products
      FOR EACH ROW EXECUTE PROCEDURE products_touch_catalog_updated_at()
    `.execute(db);

    // The version query is MAX(catalog_updated_at) per tenant over active products.
    await sql`CREATE INDEX IF NOT EXISTS idx_products_tenant_catalog_updated ON products (tenant_id, catalog_updated_at DESC)`.execute(
      db,
    );
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TRIGGER IF EXISTS trg_products_catalog_updated_at ON products`.execute(db);
    await sql`DROP FUNCTION IF EXISTS products_touch_catalog_updated_at()`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_products_tenant_catalog_updated`.execute(db);
    await sql`ALTER TABLE products DROP COLUMN IF EXISTS catalog_updated_at`.execute(db);
  },
};
