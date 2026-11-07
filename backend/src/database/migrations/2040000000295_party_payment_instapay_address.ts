import { sql, type Kysely } from 'kysely';

/*
 * 0295 — party-payment InstaPay address (INV-INSTAPAY-FIELD-MISSING).
 *
 * The live audit (2026-11-07, test10k) found no InstaPay account-number
 * (IPA) field in any payment form or in supplier edit. Batch 8 P2 only
 * fixed the store's own Z-Pay settings load-back; the payment rows
 * themselves had nowhere to store a counterparty IPA:
 * supplier_payments, customer_payments and
 * supplier_payment_schedule_logs all carry payment_channel (incl.
 * 'instapay') but no IPA column. supplier_payments.payment_reference
 * is import-payment-method evidence and must NOT be overloaded.
 *
 * Adds a nullable instapay_address (varchar 100) to the three payment
 * tables. NULL means "no IPA recorded" (legacy rows and non-InstaPay
 * payments); the value is stored only when the payment channel is
 * 'instapay' (see normalizeInstapayAddress). No backfill, no existing
 * column touched, no data rewrite. Prospective only.
 */
export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS instapay_address VARCHAR(100)`.execute(db);
    await sql`ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS instapay_address VARCHAR(100)`.execute(db);
    await sql`ALTER TABLE supplier_payment_schedule_logs ADD COLUMN IF NOT EXISTS instapay_address VARCHAR(100)`.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE supplier_payments DROP COLUMN IF EXISTS instapay_address`.execute(db);
    await sql`ALTER TABLE customer_payments DROP COLUMN IF EXISTS instapay_address`.execute(db);
    await sql`ALTER TABLE supplier_payment_schedule_logs DROP COLUMN IF EXISTS instapay_address`.execute(db);
  },
};
