import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000285: receipt-reversal ledger
 * (INV-IMPORT-RECEIPT-REVERSAL).
 *
 * A posted import receipt is never rewritten and never deleted:
 * its correction is a reversal record that links the original
 * receipt, the approval that authorized the correction, and the
 * reversal journal that mirrors the original posting. One
 * reversal per receipt: the (tenant_id, receipt_id) unique
 * constraint makes a second reversal of the same receipt
 * impossible at the database level, on top of the service
 * guards. journal_entry_id is NULL when the original receipt
 * posted no journal (zero-value receipt): a reversal with no
 * journal to mirror still restores stock, lots and preorders.
 * The table is additive only and touches no existing row.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS import_inventory_receipt_reversals (
    id bigserial PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    receipt_id BIGINT NOT NULL,
    shipment_id TEXT NOT NULL,
    approval_request_id TEXT NOT NULL,
    journal_entry_id BIGINT,
    reason TEXT NOT NULL,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, receipt_id)
  )`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS import_inventory_receipt_reversals`.execute(db);
}

export const migration = { up, down };
