import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000279: unique index on (tenant_id, project_no)
 * for import_projects (INV-IMPORT-PROJECT-NUMBERING).
 *
 * Project numbers were minted with COUNT(*) + 1, which duplicates
 * under concurrency. Numbering now uses the advisory-locked daily
 * sequence generator; this index is the backstop that makes a
 * duplicate number impossible even if two transactions race past
 * the generator. The index is also what rejects a duplicate
 * explicitly supplied projectNo with a 23505 the service
 * translates into a named conflict.
 *
 * FAILS LOUDLY ON PURPOSE: if production already holds two rows
 * with the same (tenant_id, project_no), CREATE UNIQUE INDEX
 * aborts the migration. Resolve duplicates first (pre-flight
 * check in the delivery report) — never silently renumber rows.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_import_projects_tenant_project_no ON import_projects (tenant_id, project_no)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_import_projects_tenant_project_no`.execute(db);
}

export const migration = { up, down };
