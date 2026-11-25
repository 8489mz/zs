import { Kysely, sql } from 'kysely';

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    // 1. Add credit_price and consumer_price to products
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS credit_price NUMERIC(14,2) DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS consumer_price NUMERIC(14,2) DEFAULT NULL`.execute(db);

    // 2. Add consumer_price, pricing_tier_type, and unit_offer_savings to sale_items
    await sql`ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS consumer_price NUMERIC(14,2) DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS pricing_tier_type VARCHAR(32) DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_offer_savings NUMERIC(14,2) DEFAULT NULL`.execute(
      db,
    );

    // 3. Enhance sales_orders for Pre-Sales Booking by reps
    await sql`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS rep_id INT REFERENCES delivery_representatives(id) ON DELETE SET NULL`.execute(
      db,
    );
    await sql`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS warehouse_location_id INT REFERENCES stock_locations(id) ON DELETE SET NULL`.execute(
      db,
    );
    await sql`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS order_source VARCHAR(32) DEFAULT 'standard'`.execute(
      db,
    );
    await sql`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(32) DEFAULT 'cash'`.execute(db);
    await sql`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS supervisor_approved_at TIMESTAMPTZ DEFAULT NULL`.execute(
      db,
    );
    await sql`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS supervisor_approved_by INT DEFAULT NULL`.execute(db);
    await sql`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS supervisor_rejection_reason TEXT DEFAULT NULL`.execute(
      db,
    );

    // 4. Enhance sales_order_items
    await sql`ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS consumer_price NUMERIC(14,2) DEFAULT NULL`.execute(
      db,
    );
    await sql`ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS pricing_tier_type VARCHAR(32) DEFAULT NULL`.execute(
      db,
    );
    await sql`ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS unit_multiplier NUMERIC(10,3) DEFAULT 1`.execute(
      db,
    );
    await sql`ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS unit_offer_savings NUMERIC(14,2) DEFAULT NULL`.execute(
      db,
    );

    // Indexes for efficient querying of rep pre-sales orders
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_orders_tenant_rep_status
      ON sales_orders (tenant_id, rep_id, status) WHERE rep_id IS NOT NULL`.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP INDEX IF EXISTS idx_sales_orders_tenant_rep_status`.execute(db);

    await sql`ALTER TABLE sales_order_items DROP COLUMN IF EXISTS unit_offer_savings`.execute(db);
    await sql`ALTER TABLE sales_order_items DROP COLUMN IF EXISTS unit_multiplier`.execute(db);
    await sql`ALTER TABLE sales_order_items DROP COLUMN IF EXISTS pricing_tier_type`.execute(db);
    await sql`ALTER TABLE sales_order_items DROP COLUMN IF EXISTS consumer_price`.execute(db);

    await sql`ALTER TABLE sales_orders DROP COLUMN IF EXISTS supervisor_rejection_reason`.execute(db);
    await sql`ALTER TABLE sales_orders DROP COLUMN IF EXISTS supervisor_approved_by`.execute(db);
    await sql`ALTER TABLE sales_orders DROP COLUMN IF EXISTS supervisor_approved_at`.execute(db);
    await sql`ALTER TABLE sales_orders DROP COLUMN IF EXISTS payment_terms`.execute(db);
    await sql`ALTER TABLE sales_orders DROP COLUMN IF EXISTS order_source`.execute(db);
    await sql`ALTER TABLE sales_orders DROP COLUMN IF EXISTS warehouse_location_id`.execute(db);
    await sql`ALTER TABLE sales_orders DROP COLUMN IF EXISTS rep_id`.execute(db);

    await sql`ALTER TABLE sale_items DROP COLUMN IF EXISTS unit_offer_savings`.execute(db);
    await sql`ALTER TABLE sale_items DROP COLUMN IF EXISTS pricing_tier_type`.execute(db);
    await sql`ALTER TABLE sale_items DROP COLUMN IF EXISTS consumer_price`.execute(db);

    await sql`ALTER TABLE products DROP COLUMN IF EXISTS consumer_price`.execute(db);
    await sql`ALTER TABLE products DROP COLUMN IF EXISTS credit_price`.execute(db);
  },
};
