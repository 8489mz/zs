import type { Migration } from 'kysely';

/*
 * F7 (trial problems 8 and 9, 2026-11-21): POS sales were never
 * linked to the van trip — the portal field-sale path inserts
 * sales with van_trip_id, but the generic createSale path had no
 * such column to write to, so a rep's POS counter sales posted
 * with no trip attribution and the trip's counters stayed 0.00.
 *
 * - sales.van_trip_id BIGINT NULL: the van_sales_trips row the
 *   sale belongs to. NULL on historical rows and on every sale
 *   with no rep + active trip (ordinary retail counter sales
 *   stay NULL — a trip is never fabricated).
 *
 * Prospective only: no backfill (a historical sale cannot be
 * attributed to a trip after the fact — the acting rep and the
 * trip's open window are not recoverable from the row), no
 * foreign key (the deferred-constraint rule: legacy rows must
 * never fail a validated FK; the trip row is locked and
 * re-checked in the sale transaction instead).
 *
 * Follows the 0333 pattern verbatim (plain addColumn; the
 * SalesTable type already declares the nullable column).
 */
export const migration: Migration = {
  async up(db) {
    await db.schema
      .alterTable('sales')
      .addColumn('van_trip_id', 'bigint')
      .execute();
  },
  async down(db) {
    await db.schema.alterTable('sales').dropColumn('van_trip_id').execute();
  },
};
