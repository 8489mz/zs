import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000289: per-project sector preset
 * (INV-IMPORT-SECTOR-PRESET).
 *
 * Sector is a data choice, never a hardcoded branch: the preset
 * key rides on the project and the import flow reads it. The
 * column is nullable and no existing row is touched — projects
 * created before this migration keep a NULL preset (generic
 * behaviour, no silent defaults). The service validates the key
 * against the preset registry and fails closed on unknown keys;
 * no database CHECK constraint, so future presets need no
 * migration.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_projects
    ADD COLUMN IF NOT EXISTS sector_preset TEXT`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_projects
    DROP COLUMN IF EXISTS sector_preset`.execute(db);
}

export const migration = { up, down };
