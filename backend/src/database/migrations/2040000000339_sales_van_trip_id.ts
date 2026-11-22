import { sql, type Migration } from 'kysely';

/*
 * F7 (trial problems 8 and 9, 2026-11-21): POS sales were never
 * linked to the van trip — the portal field-sale path inserts
 * sales with van_trip_id, but the generic createSale path had no
 * such column to write to, so a rep's POS counter sales posted
 * with no trip attribution and the trip's counters stayed 0.00.
 *
 * - sales.van_trip_id INTEGER NULL: the van_sales_trips row the
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
 * CORRECTION (2026-11-22, pristine P3): the column already
 * existed since migration 0045 as INTEGER — the original plain
 * addColumn('van_trip_id', 'bigint') crashed on any database
 * where migrations run in order from scratch (column
 * "van_trip_id" of relation "sales" already exists), which
 * killed ci-full #174 in "Start backend for E2E". This
 * migration is now an idempotent no-op guard only; the column
 * is owned by 0045 and stays INTEGER (0045/0268 convention;
 * SalesTable.van_trip_id is number | null — no ALTER TYPE,
 * a table rewrite for zero benefit).
 */
export const migration: Migration = {
  async up(db) {
    await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS van_trip_id INTEGER`.execute(db);
  },
  async down(_db) {
    // No-op: the column is owned by migration 0045, which also
    // drops it in its own down(). Dropping it here would remove
    // a column the van flow depends on.
  },
};
