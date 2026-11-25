import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    // Sales & Sale Lines
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_tenant_id_desc ON sales(tenant_id, id DESC)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_tenant_created_at ON sales(tenant_id, created_at DESC)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_tenant_status ON sales(tenant_id, status)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_tenant_customer ON sales(tenant_id, customer_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_tenant_branch_loc_date ON sales(tenant_id, branch_id, location_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_tenant_delivery_rep ON sales(tenant_id, delivery_rep_id, delivery_status)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_sale_items_tenant_sale ON sale_items(tenant_id, sale_id)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_sale_items_tenant_product ON sale_items(tenant_id, product_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_sale_payments_tenant_sale ON sale_payments(tenant_id, sale_id)`.execute(
      db,
    );

    // Products, Offers & Location Stock
    await sql`CREATE INDEX IF NOT EXISTS idx_products_tenant_active_id ON products(tenant_id, is_active, id DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_products_tenant_barcode ON products(tenant_id, barcode) WHERE barcode IS NOT NULL AND barcode <> ''`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_products_tenant_category ON products(tenant_id, category_id) WHERE is_active = true`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_products_tenant_supplier ON products(tenant_id, supplier_id) WHERE is_active = true`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_pls_tenant_prod_loc ON product_location_stock(tenant_id, product_id, location_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_pls_tenant_loc_qty ON product_location_stock(tenant_id, location_id, qty)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_offers_tenant_prod_active ON product_offers(tenant_id, product_id, is_active)`.execute(
      db,
    );

    // Stock Movements & Allocations
    await sql`CREATE INDEX IF NOT EXISTS idx_movements_tenant_prod_loc_date ON stock_movements(tenant_id, product_id, location_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_movements_tenant_ref ON stock_movements(tenant_id, reference_type, reference_id)`.execute(
      db,
    );

    // Accounting & Journals
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_tenant_source ON journal_entries(tenant_id, source_type, source_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_tenant_date ON journal_entries(tenant_id, entry_date DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_lines_tenant_entry ON journal_entry_lines(tenant_id, journal_entry_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_journal_lines_tenant_account ON journal_entry_lines(tenant_id, account_id)`.execute(
      db,
    );

    // Operational & Partners
    await sql`CREATE INDEX IF NOT EXISTS idx_cashier_shifts_tenant_user_status ON cashier_shifts(tenant_id, opened_by, status)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_treasury_tenant_branch_loc_date ON treasury_transactions(tenant_id, branch_id, location_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_customers_tenant_active_name ON customers(tenant_id, is_active, name)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_active_name ON suppliers(tenant_id, is_active, name)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_cust_ledger_tenant_customer ON customer_ledger(tenant_id, customer_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_supp_ledger_tenant_supplier ON supplier_ledger(tenant_id, supplier_id, created_at DESC)`.execute(
      db,
    );

    // Purchases
    await sql`CREATE INDEX IF NOT EXISTS idx_purchases_tenant_id_desc ON purchases(tenant_id, id DESC)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_purchases_tenant_created_at ON purchases(tenant_id, created_at DESC)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_purchases_tenant_supplier ON purchases(tenant_id, supplier_id)`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_purchase_items_tenant_purchase ON purchase_items(tenant_id, purchase_id)`.execute(
      db,
    );
  },

  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`DROP INDEX IF EXISTS idx_sales_tenant_id_desc`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_sales_tenant_created_at`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_sales_tenant_status`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_sales_tenant_customer`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_sales_tenant_branch_loc_date`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_sales_tenant_delivery_rep`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_sale_items_tenant_sale`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_sale_items_tenant_product`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_sale_payments_tenant_sale`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_products_tenant_active_id`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_products_tenant_barcode`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_products_tenant_category`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_products_tenant_supplier`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_pls_tenant_prod_loc`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_pls_tenant_loc_qty`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_offers_tenant_prod_active`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_movements_tenant_prod_loc_date`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_movements_tenant_ref`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_journal_tenant_source`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_journal_tenant_date`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_journal_lines_tenant_entry`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_journal_lines_tenant_account`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_cashier_shifts_tenant_user_status`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_treasury_tenant_branch_loc_date`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_customers_tenant_active_name`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_suppliers_tenant_active_name`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_cust_ledger_tenant_customer`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_supp_ledger_tenant_supplier`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_purchases_tenant_id_desc`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_purchases_tenant_created_at`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_purchases_tenant_supplier`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_purchase_items_tenant_purchase`.execute(db);
  },
};
