import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0308 — POS station identity for cashier shifts (INV-REST-SHIFT-CLOSE-CONTROL, I24).
 *
 * GROUNDING (verified at base 996bbc13):
 * - cashier_shifts has NO terminal/drawer/device column (base schema
 *   1710000001000-phase2-relational-schema.ts:434-451). The open guard
 *   is per-user only (SHIFT_ALREADY_OPEN), so a user with a
 *   pending_review shift can open a new one, and two logins at the
 *   same station open two shifts whose cash then attributes to NO
 *   shift (the attribution fallback needs exactly one open shift).
 * - Terminal identity already exists client-side — getPosTerminalCode()
 *   (frontend/src/features/pos/lib/pos-offline-sync.ts, persistent
 *   per-browser code in localStorage zs_pos_terminal_code, e.g. T4A2)
 *   — but it has ZERO callers and is never sent to the backend.
 * - sales.terminal_id is NOT reused: migration 2040000000211 made it
 *   the EDC card-terminal id, null on cash sales. The station code
 *   lives on sales.pos_terminal_code instead.
 *
 * WHAT THIS ADDS:
 * - cashier_shifts.terminal_code varchar(32), nullable: legacy and
 *   unidentified shifts stay NULL and are unaffected.
 * - sales.pos_terminal_code varchar(32), nullable.
 * - Partial unique index on (tenant, coalesce(branch, -1),
 *   terminal_code) where status='open' and terminal_code is not
 *   null: one open shift per branch+terminal. Branch NULL is
 *   coalesced so an admin's unscoped open still conflicts on the
 *   same terminal instead of slipping through NULL-distinctness.
 *   The service pre-checks the same rule and surfaces
 *   SHIFT_TERMINAL_OCCUPIED; the index is the race backstop.
 * No backfill: existing open shifts have no station code to recover.
 */

export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE "cashier_shifts" ADD COLUMN IF NOT EXISTS "terminal_code" VARCHAR(32)`.execute(db);
  await sql`ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "pos_terminal_code" VARCHAR(32)`.execute(db);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_shifts_open_terminal
      ON cashier_shifts (tenant_id, coalesce(branch_id, -1), terminal_code)
      WHERE status = 'open' AND terminal_code IS NOT NULL
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_cashier_shifts_open_terminal`.execute(db);
  await sql`ALTER TABLE "sales" DROP COLUMN IF EXISTS "pos_terminal_code"`.execute(db);
  await sql`ALTER TABLE "cashier_shifts" DROP COLUMN IF EXISTS "terminal_code"`.execute(db);
}

export const migration: Migration = { up, down };
