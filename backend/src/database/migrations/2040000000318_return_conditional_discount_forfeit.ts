import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0318 — conditional header-discount forfeit breakdown on return documents
 * (INV-RETURN-CONDITIONAL-DISCOUNT-FORFEIT).
 *
 * GROUNDING: a header discount is a deal on the whole basket (3 pieces
 * for 800 instead of 900). On a partial return the deal breaks, so the
 * discount forfeits entirely and the kept pieces reprice at original
 * price; the refund is invoice total − prior goods refunded − remaining
 * net at original price. The return document's total already carries
 * the repriced goods value, but the forfeit itself and any goodwill
 * extra above the computed refund were not recoverable as their own
 * facts: total alone cannot tell a forfeited discount from a repriced
 * line, and the goodwill extra would be indistinguishable from the
 * computed refund in every later read (register, details, audit).
 *
 * WHAT THIS DOES: adds four nullable columns to return_documents,
 * following the NULL-reads-as-zero convention of the 0311/0312 relief
 * columns:
 * - forfeited_header_discount numeric(15, 3): header discount this
 *   return forfeited (the whole sale.discount when the forfeit applies).
 * - goodwill_amount numeric(15, 3): goodwill extra above the computed
 *   refund the merchant granted to settle the customer (0 when none).
 * - goodwill_reason text: the reason the merchant gave for the extra.
 * - header_discount_mode text: which of the merchant's two refund
 *   modes priced this return — 'original' (the recorded net line
 *   after discount allocation, e.g. 267) or 'forfeit' (header discount
 *   forfeited, kept pieces at original price, e.g. 200). NULL on old
 *   rows reads as 'original', the behaviour those rows were priced by.
 * Money is numeric(15, 3): amounts are money at book precision, as in
 * 0278/0310/0311/0312/0313. Prospective only: old rows keep NULL (zero
 * / no reason / original mode), no backfill — a backfill would invent forfeits and
 * goodwill history never recorded.
 */

export async function up(db: any): Promise<void> {
  await sql`
    ALTER TABLE return_documents
      ADD COLUMN IF NOT EXISTS forfeited_header_discount numeric(15, 3),
      ADD COLUMN IF NOT EXISTS goodwill_amount numeric(15, 3),
      ADD COLUMN IF NOT EXISTS goodwill_reason text,
      ADD COLUMN IF NOT EXISTS header_discount_mode text;
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`
    ALTER TABLE return_documents
      DROP COLUMN IF EXISTS forfeited_header_discount,
      DROP COLUMN IF EXISTS goodwill_amount,
      DROP COLUMN IF EXISTS goodwill_reason,
      DROP COLUMN IF EXISTS header_discount_mode;
  `.execute(db);
}

export const migration: Migration = { up, down };
