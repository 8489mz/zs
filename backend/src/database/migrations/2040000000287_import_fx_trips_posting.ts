import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000287: FX acquisition posting links + trip
 * expense posting link (INV-IMPORT-FX-TRIPS-POSTING).
 *
 * An FX acquisition is no longer a memo row: it posts a balanced
 * treasury journal (journal_entry_id), optionally funds one
 * foreign transfer (supplier_payment_id), and carries a
 * collision-free serial so the journal and treasury rows can
 * reference it numerically. A sourcing trip becomes a posted
 * project expense through the same pattern (journal_entry_id).
 * The migration is additive only and touches no existing row:
 * legacy acquisitions keep a NULL journal link (memo history,
 * never rewritten) and legacy trips keep a NULL journal link
 * (estimates, excluded from the profit report until posted).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_fx_acquisitions
    ADD COLUMN IF NOT EXISTS serial_id bigserial,
    ADD COLUMN IF NOT EXISTS journal_entry_id BIGINT,
    ADD COLUMN IF NOT EXISTS supplier_payment_id BIGINT`.execute(db);
  await sql`ALTER TABLE import_sourcing_trips
    ADD COLUMN IF NOT EXISTS serial_id bigserial,
    ADD COLUMN IF NOT EXISTS journal_entry_id BIGINT`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_sourcing_trips
    DROP COLUMN IF EXISTS journal_entry_id,
    DROP COLUMN IF EXISTS serial_id`.execute(db);
  await sql`ALTER TABLE import_fx_acquisitions
    DROP COLUMN IF EXISTS supplier_payment_id,
    DROP COLUMN IF EXISTS journal_entry_id,
    DROP COLUMN IF EXISTS serial_id`.execute(db);
}

export const migration = { up, down };
