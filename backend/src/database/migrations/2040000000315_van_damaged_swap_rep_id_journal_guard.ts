import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0315 — van damaged swaps: missing rep_id column + journal guard (INV-VAN-DAMAGED-SWAP-JOURNAL-QUARANTINE).
 *
 * GROUNDING (verified at base 6d5dcd43): executeDamagedSwap inserts
 * `rep_id` into van_damaged_swaps and listTripDamagedSwaps selects
 * `vds.rep_id`, but migration 2040000000223 — the only migration that
 * ever creates the table — never defines the column, and neither does
 * database.types.ts (VanDamagedSwapTable has no rep_id). On real
 * Postgres the swap insert fails with "column rep_id does not exist",
 * so the whole swap path is dead at the database level; the
 * driver-portal spec's PGlite schema already assumes the column
 * exists. The same migration also left customer_id NOT NULL while the
 * service and controller treat customerId as optional, and
 * price_difference NUMERIC(14,2) while the service rounds the
 * difference at tenant book digits — on a 3-decimal tenant the stored
 * row truncates the value the idempotent retry reads back.
 *
 * WHAT THIS DOES:
 * 1. ADD COLUMN rep_id BIGINT (nullable; the trip already owns the
 *    rep, the column is attribution for the list read).
 * 2. customer_id DROP NOT NULL — the API allows a customer-less swap.
 * 3. price_difference NUMERIC(14,2) -> NUMERIC(18,3) so the row holds
 *    a book-digits difference on 3-decimal tenants (same widening
 *    shape as migration 2040000000177).
 * 4. Extend idx_journal_entries_van_sales_uniq (migrations 0151/0156
 *    pattern: DROP + CREATE) to cover the new 'van_damaged_swap'
 *    journal source, so the unique index — not just the pre-insert
 *    SELECT — is the race backstop for the swap journal.
 * No backfill: ADD COLUMN is nullable, the type widening only adds
 * scale, and the index rebuild fails loudly on a real duplicate
 * instead of silently merging one.
 */

export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE van_damaged_swaps ADD COLUMN IF NOT EXISTS rep_id BIGINT`.execute(db);
  await sql`ALTER TABLE van_damaged_swaps ALTER COLUMN customer_id DROP NOT NULL`.execute(db);
  await sql`ALTER TABLE van_damaged_swaps ALTER COLUMN price_difference TYPE NUMERIC(18, 3)`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_journal_entries_van_sales_uniq`.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_van_sales_uniq
    ON journal_entries(tenant_id, source_type, source_id)
    WHERE source_type IN ('van_trip_settlement', 'van_field_collection', 'van_field_return', 'van_damaged_swap')
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`ALTER TABLE van_damaged_swaps ALTER COLUMN price_difference TYPE NUMERIC(14, 2)`.execute(db);
  await sql`ALTER TABLE van_damaged_swaps ALTER COLUMN customer_id SET NOT NULL`.execute(db);
  await sql`ALTER TABLE van_damaged_swaps DROP COLUMN IF EXISTS rep_id`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_journal_entries_van_sales_uniq`.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_van_sales_uniq
    ON journal_entries(tenant_id, source_type, source_id)
    WHERE source_type IN ('van_trip_settlement', 'van_field_collection', 'van_field_return')
  `.execute(db);
}

export const migration: Migration = { up, down };
