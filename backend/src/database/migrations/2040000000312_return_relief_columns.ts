import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0312 — relief columns on the return document
 * (INV-REST-RETURN-RELIEF-TRUTH, T10-D).
 *
 * GROUNDING (verified at base 55cb6eac): createSaleReturn already
 * computes the tip/courier relief and pays total + relief, but the
 * relief lived only in refund_allocations JSON (a tender split —
 * cash/card/store_credit — not a relief-type split), while
 * return_documents.total stored the goods total only. Every
 * user-facing figure therefore said 75 for a return the books paid
 * 85 for. The allocations JSON cannot carry the relief-type split,
 * so the document gets its own columns.
 *
 * WHAT THIS DOES: adds tip_relief / courier_relief to
 * return_documents, both nullable (NULL reads as zero relief, the
 * same convention as migration 0311's exchange_* columns; purchase
 * returns never set them). ReturnsService records the computed
 * relief here at creation; getReturnById / listReturns surface it
 * so the register shows the actual refund. Money is numeric(15, 3):
 * relief is money at book precision, as in 0278/0310/0311.
 */

export async function up(db: any): Promise<void> {
  await sql`
    ALTER TABLE return_documents
      ADD COLUMN IF NOT EXISTS tip_relief numeric(15, 3),
      ADD COLUMN IF NOT EXISTS courier_relief numeric(15, 3);
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`
    ALTER TABLE return_documents
      DROP COLUMN IF EXISTS tip_relief,
      DROP COLUMN IF EXISTS courier_relief;
  `.execute(db);
}

export const migration: Migration = { up, down };
