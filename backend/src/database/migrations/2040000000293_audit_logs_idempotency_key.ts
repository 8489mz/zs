import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0293 — audit_logs idempotency key (INV-AUDIT-GENERAL-LOG-CONTENT).
 *
 * AuditService.log is a blind insert: the same business save replayed
 * twice (double-click / two UI paths calling the same POST) writes two
 * identical audit rows. A caller-supplied idempotency key lets a save
 * path deduplicate its own audit row with ON CONFLICT DO NOTHING.
 *
 * The unique index is a plain (non-partial) index on
 * (tenant_id, idempotency_key): Postgres treats NULL keys as distinct,
 * so legacy rows with a NULL key keep inserting freely and the
 * ON CONFLICT arbiter infers cleanly without a predicate. Same key
 * under a different tenant is allowed. No backfill, no existing
 * column touched, no data rewrite.
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT`.execute(db);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_tenant_idempotency_key_uidx ON audit_logs (tenant_id, idempotency_key)`.execute(db);
}

export async function down(db: any): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_audit_logs_tenant_idempotency_key_uidx`.execute(db);
  await sql`ALTER TABLE audit_logs DROP COLUMN IF EXISTS idempotency_key`.execute(db);
}

export const migration: Migration = { up, down };
