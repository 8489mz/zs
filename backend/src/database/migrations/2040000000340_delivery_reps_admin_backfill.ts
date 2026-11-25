import { type Migration, sql } from 'kysely';

/*
 * 0340 — backfill the 'deliveryRepsAdmin' permission to existing
 * supervisor users (F12, trial problem 15).
 *
 * GROUNDING (verified at merge, base 43febdd35):
 * - F12 splits the van-admin permission: every route of
 *   VanSalesAdminController except financial-ledger/push-to-payroll
 *   now requires the new supervisor-only key 'deliveryRepsAdmin'
 *   (@RequirePermissions('deliveryRepsAdmin')) instead of any
 *   'deliveryReps' holder. The key is registered in
 *   SUPER_ADMIN_PERMISSIONS (new owners get it at activation) and
 *   in the FE admin template — but templates only affect NEW users
 *   and role re-assignment. Existing users' stored permissions_json
 *   still lacks the key, so an existing tenant admin who runs the
 *   van center today would get 403 on every admin route after this
 *   lands. A session-layer expansion was rejected for the same
 *   reason as migration 0309 ('kitchen'): the session builds
 *   effective permissions inline in three places
 *   (session.service.ts:306, :743, :901) and would permanently mask
 *   stored data being wrong; a one-time additive backfill is
 *   durable, reversible, and follows the repo's migration pattern.
 * - users.permissions_json is JSONB NOT NULL DEFAULT '[]'::jsonb
 *   (1710000001000-phase2-relational-schema.ts:21).
 *
 * WHAT THIS DOES:
 * - Grants 'deliveryRepsAdmin' to every user with role 'admin' or
 *   'super_admin' whose stored permissions already contain
 *   'deliveryReps' and who does not already have the new key.
 *   Role is the supervisor boundary: a rep login is a cashier-role
 *   user, and a cashier holding 'deliveryReps' must NEVER gain the
 *   key from this backfill — that is the leak being closed.
 * - An admin who never held 'deliveryReps' gains nothing: he never
 *   had van-admin access, and this migration does not expand it.
 * - Idempotent: the NOT clause means a re-run changes zero rows.
 * - No catch-all swallowing: a bad permissions_json value fails the
 *   migration loudly instead of being skipped (repo AGENTS.md §13).
 * - down() removes 'deliveryRepsAdmin' from exactly the same
 *   population (admin/super_admin users with 'deliveryReps').
 *   Honest limit: that also removes it from anyone who held the key
 *   before the backfill — a rollback is a manual operation, and
 *   re-running up re-applies the grant.
 */

export async function up(db: any): Promise<void> {
  await sql`
    UPDATE users
    SET permissions_json = permissions_json || '["deliveryRepsAdmin"]'::jsonb
    WHERE role IN ('admin', 'super_admin')
      AND permissions_json @> '["deliveryReps"]'::jsonb
      AND NOT (permissions_json @> '["deliveryRepsAdmin"]'::jsonb)
  `.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`
    UPDATE users
    SET permissions_json = permissions_json - 'deliveryRepsAdmin'
    WHERE role IN ('admin', 'super_admin')
      AND permissions_json @> '["deliveryReps"]'::jsonb
      AND permissions_json @> '["deliveryRepsAdmin"]'::jsonb
  `.execute(db);
}

export const migration: Migration = { up, down };
