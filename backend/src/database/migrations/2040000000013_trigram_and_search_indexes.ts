import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

export const migration = {
  up: async (db: Kysely<Database>): Promise<void> => {
    // 1. Enable pg_trgm extension if supported (PostgreSQL)
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);
      await sql`CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops)`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_products_barcode_trgm ON products USING gin (barcode gin_trgm_ops) WHERE barcode IS NOT NULL`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_sales_doc_no_trgm ON sales USING gin (doc_no gin_trgm_ops) WHERE doc_no IS NOT NULL`.execute(
        db,
      );
      await sql`CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm ON customers USING gin (phone gin_trgm_ops) WHERE phone IS NOT NULL`.execute(
        db,
      );
    } catch {
      // Fallback if extension permissions or non-pg database
    }

    // 2. High-performance composite search indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_sales_tenant_doc_no ON sales(tenant_id, doc_no)`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone ON customers(tenant_id, phone) WHERE phone IS NOT NULL AND phone <> ''`.execute(
      db,
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_phone ON suppliers(tenant_id, phone) WHERE phone IS NOT NULL AND phone <> ''`.execute(
      db,
    );
  },

  down: async (db: Kysely<Database>): Promise<void> => {
    await sql`DROP INDEX IF EXISTS idx_sales_tenant_doc_no`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_customers_tenant_phone`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_suppliers_tenant_phone`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_products_name_trgm`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_products_barcode_trgm`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_sales_doc_no_trgm`.execute(db);
    await sql`DROP INDEX IF EXISTS idx_customers_phone_trgm`.execute(db);
  },
};
