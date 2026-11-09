import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0310 — header fields for held drafts (INV-REST-HOLD-RECALL-TRUTH, R5-B I29/I31).
 *
 * GROUNDING (verified at base 8fbc57c9): saveHeldSale never persisted
 * tip / loyalty / pager / delivery-fee mode / online order / dining
 * course / guest count / check-printed time, and mapHeldSalesRows never
 * returned them — a held delivery order came back with fee 0, no rep,
 * COD instead of prepaid, and no tip. The DTO rejected the fields as
 * non-whitelisted, so the loss started at the hold call-site.
 *
 * WHAT THIS DOES: adds the eight header columns to held_sales, all
 * nullable (old drafts simply have no values; list falls back to the
 * old defaults). Item fields (lineKey, unitId, serials, originalPrice,
 * offerDiscount, offerName, isWeighted, quantityChunks) ride in the
 * existing modifiers JSON envelope — no second migration.
 *
 * Money is numeric(15, 3): held tip is money at book precision, and
 * 0278 widened held_sales money columns to 3dp.
 */

export async function up(db: any): Promise<void> {
  await sql`
    ALTER TABLE held_sales
      ADD COLUMN IF NOT EXISTS tip_amount numeric(15, 3) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS loyalty_points_redeemed integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS pager_number text,
      ADD COLUMN IF NOT EXISTS delivery_fee_mode text,
      ADD COLUMN IF NOT EXISTS online_order_id bigint,
      ADD COLUMN IF NOT EXISTS dining_course text,
      ADD COLUMN IF NOT EXISTS guest_count integer,
      ADD COLUMN IF NOT EXISTS guest_check_printed_at timestamptz;
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`
    ALTER TABLE held_sales
      DROP COLUMN IF EXISTS tip_amount,
      DROP COLUMN IF EXISTS loyalty_points_redeemed,
      DROP COLUMN IF EXISTS pager_number,
      DROP COLUMN IF EXISTS delivery_fee_mode,
      DROP COLUMN IF EXISTS online_order_id,
      DROP COLUMN IF EXISTS dining_course,
      DROP COLUMN IF EXISTS guest_count,
      DROP COLUMN IF EXISTS guest_check_printed_at;
  `.execute(db);
}

export const migration: Migration = { up, down };
