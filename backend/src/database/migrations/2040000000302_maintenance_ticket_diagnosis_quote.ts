import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0302 — add maintenance_tickets.diagnosis / quoted_cost /
 * quote_approved_at / quote_approved_by (all nullable).
 *
 * Diagnosis was free-text technician_notes only (review P2-5): no
 * structured diagnosis, and no customer-approval step on the quoted
 * price before repair started. The service records diagnosis +
 * quoted cost through the status-update path during 'inspecting',
 * records the customer approval as quote_approved_at/by on an
 * explicit approveQuote flag, and gates the move to 'in_progress'
 * on an approved quote whenever a quoted cost exists. There is no
 * customer portal — approval is recorded by staff, never a customer
 * signature.
 *
 * New nullable columns only — no constraint, no backfill. Existing
 * rows keep NULL (no quote was ever recorded for them; the gate
 * treats a NULL quoted cost as "quick job, no approval needed").
 * Up is idempotent (ADD COLUMN IF NOT EXISTS); down drops the
 * four columns.
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE "maintenance_tickets" ADD COLUMN IF NOT EXISTS "diagnosis" TEXT`.execute(db);
  await sql`ALTER TABLE "maintenance_tickets" ADD COLUMN IF NOT EXISTS "quoted_cost" NUMERIC(14,3)`.execute(db);
  await sql`ALTER TABLE "maintenance_tickets" ADD COLUMN IF NOT EXISTS "quote_approved_at" TIMESTAMPTZ`.execute(db);
  await sql`ALTER TABLE "maintenance_tickets" ADD COLUMN IF NOT EXISTS "quote_approved_by" INTEGER`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`ALTER TABLE "maintenance_tickets" DROP COLUMN IF EXISTS "quote_approved_by"`.execute(db);
  await sql`ALTER TABLE "maintenance_tickets" DROP COLUMN IF EXISTS "quote_approved_at"`.execute(db);
  await sql`ALTER TABLE "maintenance_tickets" DROP COLUMN IF EXISTS "quoted_cost"`.execute(db);
  await sql`ALTER TABLE "maintenance_tickets" DROP COLUMN IF EXISTS "diagnosis"`.execute(db);
}

export const migration: Migration = { up, down };
