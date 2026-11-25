import { Kysely, sql } from 'kysely';
import { Database } from '../database.types';

/**
 * P0-A: enforce tenant ownership on new MFA and high-value maritime references.
 * NOT VALID intentionally preserves historic records for manual remediation;
 * PostgreSQL still checks ALL new/updated rows immediately.
 * No existing IDs, finance rows or reference values are rewritten.
 */
export const tenantScopedReferences = [
  { child: 'user_mfa', column: 'user_id', parent: 'users', onDelete: 'CASCADE' },
  { child: 'maritime_rfq_bids', column: 'rfq_id', parent: 'maritime_rfqs', onDelete: 'CASCADE' },
  { child: 'maritime_containers', column: 'job_id', parent: 'maritime_jobs', onDelete: 'CASCADE' },
  { child: 'maritime_job_milestones', column: 'job_id', parent: 'maritime_jobs', onDelete: 'CASCADE' },
] as const;

const indexes = ['users', 'maritime_rfqs', 'maritime_jobs'] as const;
function indexName(table: string): string {
  return `uq_core255_${table}_tenant_id`;
}
function fkName(table: string, column: string): string {
  return `fk_core255_${table}_tenant_${column}`;
}

export async function up(db: Kysely<Database>): Promise<void> {
  for (const table of indexes) {
    await sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName(table)} ON ${table} (tenant_id, id)`).execute(db);
  }

  for (const ref of tenantScopedReferences) {
    const name = fkName(ref.child, ref.column);
    await sql
      .raw(
        `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = '${name}' AND conrelid = '${ref.child}'::regclass) THEN
        ALTER TABLE ${ref.child} ADD CONSTRAINT ${name}
        FOREIGN KEY (tenant_id, ${ref.column})
        REFERENCES ${ref.parent} (tenant_id, id)
        ON DELETE ${ref.onDelete} NOT VALID;
      END IF;
    END $$`,
      )
      .execute(db);
  }
}

export async function down(db: Kysely<Database>): Promise<void> {
  for (const ref of [...tenantScopedReferences].reverse()) {
    await sql.raw(`ALTER TABLE ${ref.child} DROP CONSTRAINT IF EXISTS ${fkName(ref.child, ref.column)}`).execute(db);
  }
  // Keep additive unique indexes for other tenant-scoped references on rollback.
}
