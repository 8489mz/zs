import { type Migration, sql } from 'kysely';

/*
 * 0325 — add sales.received_at (server receipt instant for offline sales).
 *
 * GROUNDING (single-server-clock audit, RC-6 / P2 — the biggest tampering
 * hole): the POS offline gate (validateOfflineCreatedAt) bounded the
 * FUTURE (now+5min) but not the past — anything back to 2000-01-01
 * passed, so a device clock set back booked sales into any past
 * day/month inside an open period. The gate now bounds the past to 7
 * days (see cash-drawer.helper.ts). This migration adds the second half
 * of the fix: every offline sale carries, alongside the client's claimed
 * business day (sales.created_at, kept verbatim), the server's receipt
 * instant — sales.received_at, stamped by the server at insert time
 * (create-sale.service.ts, offlineSaleTimestamps). Online sales carry
 * no received_at (NULL): their created_at already IS the server instant.
 *
 * Column is NULLABLE with no default: historical rows (online sales and
 * offline sales synced before this migration) legitimately have no
 * receipt stamp, and backfilling one would invent an instant the server
 * never recorded. Prospective only: it adds a column, never amounts,
 * dates of existing rows, or posted journals.
 *
 * Up is idempotent (ADD COLUMN IF NOT EXISTS) and a no-op when the
 * column already exists. Down drops the column (rollback only).
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NULL`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`ALTER TABLE sales DROP COLUMN IF EXISTS received_at`.execute(db);
}

export const migration: Migration = { up, down };
