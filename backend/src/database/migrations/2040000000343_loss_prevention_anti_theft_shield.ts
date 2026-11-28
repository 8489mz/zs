import { Kysely, sql } from 'kysely';

/*
 * Enterprise Loss Prevention & Anti-Theft Shield (INV-LOSS-PREVENTION-SHIELD)
 * Purely additive, idempotent schema additions across sales, stock_transfers,
 * damaged_stock_records, stock_count_sessions, products, and delivery_representatives.
 * Every column has a safe default or allows NULL so historical rows and existing
 * workflows keep operating unchanged unless strict anti-theft controls are enabled.
 */
export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // 1. Receipt reprint tracking on sales
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS reprint_count INTEGER NOT NULL DEFAULT 0`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS last_reprinted_at TIMESTAMPTZ`.execute(db);
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS last_reprinted_by INTEGER`.execute(db);

    // 2. Carrier custody & in-transit aging alert tracking on stock_transfers
    await sql`ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS carrier_employee_id INTEGER`.execute(db);
    await sql`ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS carrier_name VARCHAR(255)`.execute(db);
    await sql`ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS in_transit_alerted_at TIMESTAMPTZ`.execute(db);

    // 3. Approval & photo evidence on damaged_stock_records
    await sql`ALTER TABLE damaged_stock_records ADD COLUMN IF NOT EXISTS approved_by INTEGER`.execute(db);
    await sql`ALTER TABLE damaged_stock_records ADD COLUMN IF NOT EXISTS evidence_image_url TEXT`.execute(db);

    // 4. Server-enforced blind count & hot-SKU spot-check scope on stock_count_sessions
    await sql`ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS is_blind BOOLEAN NOT NULL DEFAULT FALSE`.execute(
      db,
    );
    await sql`ALTER TABLE stock_count_sessions ADD COLUMN IF NOT EXISTS count_scope VARCHAR(40) NOT NULL DEFAULT 'standard'`.execute(
      db,
    );

    // 5. High-risk shrinkage (Hot SKU) tagging on products
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_high_risk_shrinkage BOOLEAN NOT NULL DEFAULT FALSE`.execute(
      db,
    );

    // 6. Cash custody ceiling on delivery_representatives
    await sql`ALTER TABLE delivery_representatives ADD COLUMN IF NOT EXISTS max_cash_custody_limit NUMERIC(14, 3)`.execute(
      db,
    );

    // Helpful partial index for in-transit aging monitor
    await sql`CREATE INDEX IF NOT EXISTS idx_stock_transfers_in_transit_aging
      ON stock_transfers (tenant_id, status, created_at)
      WHERE status = 'sent'`.execute(db);

    // Helpful partial index for hot-SKU spot checks
    await sql`CREATE INDEX IF NOT EXISTS idx_products_high_risk_shrinkage
      ON products (tenant_id, id)
      WHERE is_high_risk_shrinkage = TRUE AND is_active = TRUE`.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_products_high_risk_shrinkage`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_stock_transfers_in_transit_aging`.execute(db);

    await sql`ALTER TABLE delivery_representatives DROP COLUMN IF EXISTS max_cash_custody_limit`.execute(db);
    await sql`ALTER TABLE products DROP COLUMN IF EXISTS is_high_risk_shrinkage`.execute(db);
    await sql`ALTER TABLE stock_count_sessions DROP COLUMN IF EXISTS count_scope`.execute(db);
    await sql`ALTER TABLE stock_count_sessions DROP COLUMN IF EXISTS is_blind`.execute(db);
    await sql`ALTER TABLE damaged_stock_records DROP COLUMN IF EXISTS evidence_image_url`.execute(db);
    await sql`ALTER TABLE damaged_stock_records DROP COLUMN IF EXISTS approved_by`.execute(db);
    await sql`ALTER TABLE stock_transfers DROP COLUMN IF EXISTS in_transit_alerted_at`.execute(db);
    await sql`ALTER TABLE stock_transfers DROP COLUMN IF EXISTS carrier_name`.execute(db);
    await sql`ALTER TABLE stock_transfers DROP COLUMN IF EXISTS carrier_employee_id`.execute(db);
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS last_reprinted_by`.execute(db);
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS last_reprinted_at`.execute(db);
    await sql`ALTER TABLE sales DROP COLUMN IF EXISTS reprint_count`.execute(db);
  },
};
