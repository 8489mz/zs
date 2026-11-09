import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0311 — exchange-collected relief on the return row
 * (INV-REST-RETURN-PAYOUT-TRUTH, R7-A F3).
 *
 * GROUNDING (verified at base 9e3946e2): an exchange return posts
 * no sales_return journal — its lines (including the 2147/2115
 * relief debits) ride inside the NEW sale's journal via the
 * collectExchangeLines branch of postSalesReturn. priorSalesReturnRelief
 * only reads sales_return/return journals, so relief collected by an
 * exchange was invisible to it and a later return of other lines of
 * the same sale could over-relieve (cumulative cap blind to the
 * exchange-collected share).
 *
 * WHAT THIS DOES: adds the two relief columns to return_documents,
 * both nullable (plain returns never set them; a NULL reads as zero
 * relief). postSalesReturn records the computed tip/courier relief
 * on the return row in the collectExchangeLines branch, and
 * priorSalesReturnRelief adds the columns for prior returns that
 * have no return journal. Money is numeric(15, 3): relief is money
 * at book precision, as in 0278/0310.
 */

export async function up(db: any): Promise<void> {
  await sql`
    ALTER TABLE return_documents
      ADD COLUMN IF NOT EXISTS exchange_tip_relief numeric(15, 3),
      ADD COLUMN IF NOT EXISTS exchange_courier_relief numeric(15, 3);
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`
    ALTER TABLE return_documents
      DROP COLUMN IF EXISTS exchange_tip_relief,
      DROP COLUMN IF EXISTS exchange_courier_relief;
  `.execute(db);
}

export const migration: Migration = { up, down };
