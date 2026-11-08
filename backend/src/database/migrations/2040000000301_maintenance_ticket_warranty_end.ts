import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0301 — add maintenance_tickets.warranty_end (timestamptz, nullable).
 *
 * The warranty was a printed promise only (review P1-4): warranty_days
 * was stored and printed on the receipt, but no expiry date was ever
 * computed, so nothing could answer "is this device still under
 * warranty?". The service computes warranty_end when repaired_at is
 * first set (repaired_at + warranty_days) and exposes it in getTicket
 * and listTickets; this migration only adds the nullable column.
 *
 * Existing rows keep NULL (no repair date to compute from); the
 * column is nullable precisely so the migration never rewrites
 * history. Up is idempotent (ADD COLUMN IF NOT EXISTS); down drops
 * the column.
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE "maintenance_tickets" ADD COLUMN IF NOT EXISTS "warranty_end" TIMESTAMPTZ`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`ALTER TABLE "maintenance_tickets" DROP COLUMN IF EXISTS "warranty_end"`.execute(db);
}

export const migration: Migration = { up, down };
