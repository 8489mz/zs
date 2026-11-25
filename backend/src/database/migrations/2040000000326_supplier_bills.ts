import { type Migration, sql } from 'kysely';

/*
 * 0326 — non-stock supplier bills (INV-SUPPLIER-NONSTOCK-BILL).
 *
 * GROUNDING: a supplier can be owed money without any goods purchase
 * invoice — a program, a carton of paper, cables, a service — and the
 * system had no document to record that debt. Purchase lines REQUIRE a
 * productId, so the debt could not go through a purchase invoice without
 * corrupting stock; the supplier opening balance exists only at supplier
 * creation and posts Dr 3200 / Cr 2110 (pre-system debt, one journal per
 * supplier); createSupplierPayment refuses a zero-balance supplier.
 *
 * supplier_bills is the new document: one bill per supplier, dated on the
 * tenant business day, numbered SPB-YYMMDD-XXXX. supplier_bill_lines are
 * free-text lines (description + amount + the chart account the amount
 * belongs to — expense or asset). No product, no stock movement, no GRN,
 * no landed cost, no three-way match: this document never touches
 * inventory by design, and the bill service validates every line account
 * against the chart (see supplier-bill.engine.ts).
 *
 * No FK constraints, matching supplier_payments/supplier_ledger: Kysely
 * types are the contract and the service locks the supplier row instead.
 * Up is idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
 * EXISTS). Down drops the lines table first, then the bills table.
 * Prospective only: it adds two empty tables, never amounts or journals.
 */
export async function up(db: any): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS supplier_bills (
      id bigserial PRIMARY KEY,
      tenant_id text NOT NULL,
      account_id text NOT NULL,
      supplier_id bigint NOT NULL,
      doc_no text NOT NULL,
      bill_date date NOT NULL,
      total numeric(14,3) NOT NULL DEFAULT 0,
      note text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'posted',
      created_by bigint,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `.execute(db);
  await sql`
    CREATE TABLE IF NOT EXISTS supplier_bill_lines (
      id bigserial PRIMARY KEY,
      tenant_id text NOT NULL,
      account_id text NOT NULL,
      bill_id bigint NOT NULL,
      description text NOT NULL DEFAULT '',
      chart_account_id bigint NOT NULL,
      amount numeric(14,3) NOT NULL DEFAULT 0,
      sort_order int NOT NULL DEFAULT 0
    )
  `.execute(db);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS supplier_bills_tenant_doc_no_uidx ON supplier_bills (tenant_id, doc_no)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS supplier_bills_tenant_supplier_idx ON supplier_bills (tenant_id, supplier_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS supplier_bill_lines_tenant_bill_idx ON supplier_bill_lines (tenant_id, bill_id)`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`DROP TABLE IF EXISTS supplier_bill_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS supplier_bills`.execute(db);
}

export const migration: Migration = { up, down };
