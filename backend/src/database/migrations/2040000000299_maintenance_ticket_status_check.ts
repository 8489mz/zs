import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0299 — maintenance_tickets.status CHECK constraint, added NOT VALID
 * (INV-MAINTENANCE-TICKET-STATUS-CHECK).
 *
 * The DTOs validated `status` as a bare string, and the column is a
 * plain varchar(50) with no CHECK, so any text could be stored through
 * the API. This migration adds the storage backstop for the same 8
 * statuses the DTOs now allow with @IsIn: received, inspecting,
 * in_progress, waiting_parts, repaired, delivered, unrepairable,
 * cancelled.
 *
 * Deferred-constraint pattern (repo AGENTS.md §13): the constraint is
 * added NOT VALID here, and only validated by migration 0300. Before
 * adding it, a backfill check FAILS LOUDLY (RAISE EXCEPTION, no
 * catch-all) if any existing row holds a status outside the set (or
 * NULL): resolve those rows first, never silently rewrite them.
 * The check counts NULL too: `status NOT IN (...)` is NULL, not true,
 * for a NULL status, so a bare NOT IN would let NULL rows slip past.
 *
 * Up is idempotent: re-running skips the ADD CONSTRAINT when the
 * constraint already exists. Rollback drops the constraint; rows
 * written while it was active stay as they are.
 */
export async function up(db: any): Promise<void> {
  // Fail loudly on legacy rows outside the allowed set (no catch-all,
  // no silent rewrite): the migration aborts until they are resolved.
  await sql`
    DO $$
    DECLARE
      bad_count integer;
    BEGIN
      SELECT COUNT(*) INTO bad_count
      FROM maintenance_tickets
      WHERE status IS NULL
         OR status NOT IN ('received', 'inspecting', 'in_progress', 'waiting_parts', 'repaired', 'delivered', 'unrepairable', 'cancelled');
      IF bad_count > 0 THEN
        RAISE EXCEPTION 'maintenance_tickets has % rows with a status outside the allowed set; resolve them before adding the status CHECK constraint', bad_count;
      END IF;
    END $$;
  `.execute(db);

  const { rows } = await sql<{ constraint_name: string }>`
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_schema = current_schema()
      AND table_name = 'maintenance_tickets'
      AND constraint_name = 'chk_maintenance_tickets_status_valid'
  `.execute(db);
  if (rows.length === 0) {
    await sql`
      ALTER TABLE "maintenance_tickets"
      ADD CONSTRAINT "chk_maintenance_tickets_status_valid"
      CHECK (status IN ('received', 'inspecting', 'in_progress', 'waiting_parts', 'repaired', 'delivered', 'unrepairable', 'cancelled'))
      NOT VALID
    `.execute(db);
  }
}

export async function down(db: any): Promise<void> {
  await sql`
    ALTER TABLE "maintenance_tickets"
    DROP CONSTRAINT IF EXISTS "chk_maintenance_tickets_status_valid"
  `.execute(db);
}

export const migration: Migration = { up, down };
