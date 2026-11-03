import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000288: version stamp on customs tariffs
 * (INV-IMPORT-TARIFF-VERSIONING).
 *
 * The bundled official tariff snapshot is explicit versioned data:
 * every row inserted by the manual refresh carries the data
 * version it came from, so a read can always say which snapshot
 * it used. The migration is additive only: the column is
 * nullable and no existing row is touched — legacy rows keep a
 * NULL version (pre-versioning data, never rewritten).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_customs_tariffs
    ADD COLUMN IF NOT EXISTS data_version TEXT`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_customs_tariffs
    DROP COLUMN IF EXISTS data_version`.execute(db);
}

export const migration = { up, down };
