import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0300 — validate the maintenance_tickets.status CHECK constraint
 * (INV-MAINTENANCE-TICKET-STATUS-CHECK).
 *
 * Second half of the deferred-constraint pattern (repo AGENTS.md
 * §13): migration 0299 added
 * chk_maintenance_tickets_status_valid as NOT VALID after a
 * fail-loudly backfill check, so no new row can carry an out-of-set
 * status while legacy rows were still unvalidated. This migration
 * runs VALIDATE CONSTRAINT, which scans the whole table and fails
 * loudly if any row still violates the check. It runs in its own
 * migration so a large legacy table is validated separately from
 * the DDL that created the constraint.
 *
 * Rollback is a no-op: un-validating a constraint has no meaning
 * once the table is proven clean, and dropping the constraint
 * belongs to 0299's down, not here.
 */
export async function up(db: any): Promise<void> {
  await sql`
    ALTER TABLE "maintenance_tickets"
    VALIDATE CONSTRAINT "chk_maintenance_tickets_status_valid"
  `.execute(db);
}

export async function down(_db: any): Promise<void> {
  // No-op by design: validation is a one-way proof that the table is
  // clean. Dropping the constraint is 0299's down.
}

export const migration: Migration = { up, down };
