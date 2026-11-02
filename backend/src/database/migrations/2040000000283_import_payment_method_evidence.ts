import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000283: payment-method evidence columns on
 * supplier_payments (INV-IMPORT-PAYMENT-METHODS).
 *
 * Foreign transfers previously recorded no payment method at all:
 * every transfer looked like a bank transfer whether the money
 * moved by bank, by a cash-carrying traveller, under a letter of
 * credit, against documents, or on open account. The method and
 * its evidence are part of the money record, so they are stored
 * on the payment row itself, prospectively only: existing rows
 * keep NULL (unrecorded method), never backfilled with a guess.
 * Form 4 number/date are optional at transfer recording; the
 * clearance gate (package 2) enforces them before clearance.
 *
 * All columns are additive and nullable: the migration cannot
 * fail on legacy data and changes no existing row.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS payment_method TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS payment_reference TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS bank_swift_code TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS form4_number TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS form4_date DATE`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS evidence_carrier_name TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS evidence_travel_date DATE`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS evidence_handover_receipt TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS evidence_lc_number TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS evidence_lc_issuing_bank TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS evidence_lc_expiry DATE`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS evidence_lc_documents TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS evidence_cad_proof TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS evidence_payment_terms TEXT`.execute(db);
  await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS evidence_payment_due_date DATE`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS evidence_payment_due_date`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS evidence_payment_terms`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS evidence_cad_proof`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS evidence_lc_documents`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS evidence_lc_expiry`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS evidence_lc_issuing_bank`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS evidence_lc_number`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS evidence_handover_receipt`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS evidence_travel_date`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS evidence_carrier_name`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS form4_date`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS form4_number`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS bank_swift_code`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS payment_reference`.execute(db);
  await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS payment_method`.execute(db);
}

export const migration = { up, down };
