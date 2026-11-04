import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0292 — GRN pending-review receipt (spirit-of-law Q9).
 *
 * A receipt may now post while its purchase order is still unapproved
 * (draft) or while a line exceeds the ordered quantity. The stock, WAC
 * and GRNI journal post exactly as before (money-strict); these additive
 * columns record WHY the receipt is pending review so supplier billing
 * stays blocked until the order is approved and the over-receipt
 * variance stays visible. Pre-0292 rows keep pending_review FALSE and
 * over_received_qty 0 (review state not recorded); no backfill, no data
 * rewrite, no existing column touched.
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS pending_review BOOLEAN NOT NULL DEFAULT FALSE`.execute(db);
  await sql`ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS pending_review_reason TEXT`.execute(db);
  await sql`ALTER TABLE goods_receipt_lines ADD COLUMN IF NOT EXISTS over_received_qty NUMERIC(15, 4) NOT NULL DEFAULT 0`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`ALTER TABLE goods_receipt_lines DROP COLUMN IF EXISTS over_received_qty`.execute(db);
  await sql`ALTER TABLE goods_receipt_notes DROP COLUMN IF EXISTS pending_review_reason`.execute(db);
  await sql`ALTER TABLE goods_receipt_notes DROP COLUMN IF EXISTS pending_review`.execute(db);
}

export const migration: Migration = { up, down };
