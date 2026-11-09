import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0309 — backfill the 'kitchen' permission to existing users (INV-REST-KDS-TRUTH-2, I18).
 *
 * GROUNDING (verified at merge, base 996bbc13 + R4-A..R4-E):
 * - R4-E makes KDS mutations require the new 'kitchen' permission
 *   (@RequirePermissions('kitchen') on kds.controller.ts) and grants it
 *   alongside 'sales' in the role templates (DEFAULT_ADMIN / OPERATOR /
 *   CASHIER_PERMS, SUPER_ADMIN_PERMISSIONS) — but templates only affect
 *   NEW users and role re-assignment. Existing users' stored
 *   permissions_json still lacks 'kitchen', so an existing cashier who
 *   runs the kitchen today would get 403 on every KDS mutation after
 *   this lands. A session-layer expansion was rejected: the session
 *   builds effective permissions inline in three places
 *   (session.service.ts:306, :743, :901) and would permanently mask
 *   stored data being wrong; a one-time additive backfill is durable,
 *   reversible, and follows the repo's migration pattern.
 * - users.permissions_json is JSONB NOT NULL DEFAULT '[]'::jsonb
 *   (1710000001000-phase2-relational-schema.ts:21).
 *
 * WHAT THIS DOES:
 * - Grants 'kitchen' to every user whose stored permissions already
 *   contain 'sales' and who does not already have 'kitchen'. Kitchen
 *   work is part of the sales workflow, so 'sales' is the right
 *   population; a kitchen-only user (no 'sales') is untouched — the
 *   finer split (kitchen without sales) is a follow-up, not a silent
 *   lockout.
 * - Idempotent: the NOT clause means a re-run changes zero rows.
 * - No catch-all swallowing: a bad permissions_json value fails the
 *   migration loudly instead of being skipped (repo AGENTS.md §13).
 * - down() removes 'kitchen' from exactly the same population
 *   (users with 'sales'). Honest limit: that also removes it from
 *   anyone who held 'kitchen' before the backfill — a rollback is a
 *   manual operation, and re-running up re-applies the grant.
 */

export async function up(db: any): Promise<void> {
  await sql`
    UPDATE users
    SET permissions_json = permissions_json || '["kitchen"]'::jsonb
    WHERE permissions_json @> '["sales"]'::jsonb
      AND NOT (permissions_json @> '["kitchen"]'::jsonb)
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`
    UPDATE users
    SET permissions_json = permissions_json - 'kitchen'
    WHERE permissions_json @> '["sales"]'::jsonb
      AND permissions_json @> '["kitchen"]'::jsonb
  `.execute(db);
}

export const migration: Migration = { up, down };
