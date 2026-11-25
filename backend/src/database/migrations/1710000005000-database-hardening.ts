import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_product_customer_prices_product_customer ON product_customer_prices(product_id, customer_id)`.execute(
      db,
    );
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_product_units_product_name ON product_units(product_id, lower(name))`.execute(
      db,
    );
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_product_units_product_barcode ON product_units(product_id, lower(barcode)) WHERE barcode IS NOT NULL AND barcode <> ''`.execute(
      db,
    );
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_locations_branch_code ON stock_locations(branch_id, lower(code)) WHERE code IS NOT NULL AND code <> ''`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_branch_location_created_at ON sales(branch_id, location_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_purchases_branch_location_created_at ON purchases(branch_id, location_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_expenses_branch_location_expense_date ON expenses(branch_id, location_id, expense_date DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_treasury_branch_location_created_at ON treasury_transactions(branch_id, location_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer_created_at ON customer_ledger(customer_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_created_at ON supplier_ledger(supplier_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_stock_movements_product_location_created_at ON stock_movements(product_id, location_id, created_at DESC)`.execute(
      db,
    );
    await sql`ALTER TABLE products ADD CONSTRAINT chk_products_cost_price_non_negative CHECK (cost_price >= 0)`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE products ADD CONSTRAINT chk_products_retail_price_non_negative CHECK (retail_price >= 0)`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE products ADD CONSTRAINT chk_products_wholesale_price_non_negative CHECK (wholesale_price >= 0)`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE products ADD CONSTRAINT chk_products_stock_qty_non_negative CHECK (stock_qty >= 0)`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE products ADD CONSTRAINT chk_products_min_stock_qty_non_negative CHECK (min_stock_qty >= 0)`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_units ADD CONSTRAINT chk_product_units_multiplier_positive CHECK (multiplier > 0)`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE product_offers ADD CONSTRAINT chk_product_offers_value_positive CHECK (value > 0)`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE return_items ADD CONSTRAINT chk_return_items_qty_positive CHECK (qty > 0)`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE return_items ADD CONSTRAINT chk_return_items_unit_total_non_negative CHECK (unit_total >= 0)`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE return_items ADD CONSTRAINT chk_return_items_line_total_non_negative CHECK (line_total >= 0)`
      .execute(db)
      .catch(() => undefined);
    await sql`ALTER TABLE return_documents ADD CONSTRAINT chk_return_documents_total_non_negative CHECK (total >= 0)`
      .execute(db)
      .catch(() => undefined);
  },
  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`DROP INDEX IF EXISTS uq_product_customer_prices_product_customer`.execute(db);
    await sql`DROP INDEX IF EXISTS uq_product_units_product_name`.execute(db);
    await sql`DROP INDEX IF EXISTS uq_product_units_product_barcode`.execute(db);
    await sql`DROP INDEX IF EXISTS uq_stock_locations_branch_code`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_sales_branch_location_created_at`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_purchases_branch_location_created_at`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_expenses_branch_location_expense_date`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_treasury_branch_location_created_at`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_customer_ledger_customer_created_at`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_supplier_ledger_supplier_created_at`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_stock_movements_product_location_created_at`.execute(db);
    await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_cost_price_non_negative`.execute(db);
    await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_retail_price_non_negative`.execute(db);
    await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_wholesale_price_non_negative`.execute(db);
    await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_stock_qty_non_negative`.execute(db);
    await sql`ALTER TABLE products DROP CONSTRAINT IF EXISTS chk_products_min_stock_qty_non_negative`.execute(db);
    await sql`ALTER TABLE product_units DROP CONSTRAINT IF EXISTS chk_product_units_multiplier_positive`.execute(db);
    await sql`ALTER TABLE product_offers DROP CONSTRAINT IF EXISTS chk_product_offers_value_positive`.execute(db);
    await sql`ALTER TABLE return_items DROP CONSTRAINT IF EXISTS chk_return_items_qty_positive`.execute(db);
    await sql`ALTER TABLE return_items DROP CONSTRAINT IF EXISTS chk_return_items_unit_total_non_negative`.execute(db);
    await sql`ALTER TABLE return_items DROP CONSTRAINT IF EXISTS chk_return_items_line_total_non_negative`.execute(db);
    await sql`ALTER TABLE return_documents DROP CONSTRAINT IF EXISTS chk_return_documents_total_non_negative`.execute(
      db,
    );
  },
};
