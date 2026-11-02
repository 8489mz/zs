import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000284: Form 4 number/date columns on
 * import_shipments (INV-IMPORT-FORM4-CLEARANCE-GATE).
 *
 * The clearance gate (package 2) needs somewhere to record the
 * Form 4 that authorizes clearance. The transfer-level Form 4
 * columns arrived in migration 0283; a shipment may also carry
 * its own Form 4 (issued against the shipment after the transfer),
 * so the shipment row records it directly. Both columns are
 * additive and nullable: the migration cannot fail on legacy
 * data and changes no existing row. Nothing is backfilled: a
 * shipment with no Form 4 on record is a shipment with no Form 4
 * on record, and the gate treats it as such.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_shipments ADD COLUMN IF NOT EXISTS form4_number TEXT`.execute(db);
  await sql`ALTER TABLE import_shipments ADD COLUMN IF NOT EXISTS form4_date DATE`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_shipments DROP COLUMN IF EXISTS form4_date`.execute(db);
  await sql`ALTER TABLE import_shipments DROP COLUMN IF EXISTS form4_number`.execute(db);
}

export const migration = { up, down };
