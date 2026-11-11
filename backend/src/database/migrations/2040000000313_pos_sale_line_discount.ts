import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0313 — per-line discount column on sale items
 * (INV-POS-LINE-DISCOUNT).
 *
 * GROUNDING (verified at base daf58fa9): the backend already accepts a
 * per-line TOTAL discount (SaleItemDto.lineDiscount, INV-CONVERSION-
 * LINE-DISCOUNTS-PRESERVED) and buildPreparedSaleItem subtracts it from
 * the line gross before the header discount is allocated — but the POS
 * never sent it, and the sale_items insert stored only line_total (net
 * of the line discount), net_line_total and allocated_discount (the
 * header share). The per-line discount was therefore unrecoverable as
 * its own fact: qty x unit_price - line_total conflates it with
 * nothing else today, but a later reader cannot tell a line discount
 * from a repriced line, and the invoice detail / receipt / sales
 * register cannot show "this piece was discounted".
 *
 * WHAT THIS DOES: adds sale_items.line_discount, nullable (NULL reads
 * as zero, the same convention as the 0311/0312 relief columns;
 * pre-migration rows never carried one). createSale / updateSale
 * record the line's own discount here at creation; getSaleById /
 * listSales surface it so the invoice detail and the receipt show the
 * discount on the piece it was granted on. Money is numeric(15, 3):
 * a discount is money at book precision, as in 0278/0310/0311/0312.
 * Prospective only: old rows keep NULL (zero), no backfill — a
 * backfill would invent discounts history never recorded.
 */

export async function up(db: any): Promise<void> {
  await sql`
    ALTER TABLE sale_items
      ADD COLUMN IF NOT EXISTS line_discount numeric(15, 3);
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`
    ALTER TABLE sale_items
      DROP COLUMN IF EXISTS line_discount;
  `.execute(db);
}

export const migration: Migration = { up, down };
