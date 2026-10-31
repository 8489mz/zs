import { sql, type Kysely } from 'kysely';

/**
 * Freight portal PIN hashing (INV-FREIGHT-PORTAL-PIN-HASHED): the
 * customer portal login accepted the universal default PIN '1234'
 * for every customer, and migration 0201 backfilled that value in
 * plaintext (`customers.portal_access_pin`) for every active
 * customer with a NULL PIN.
 *
 * This migration adds `portal_pin_hash`/`portal_pin_salt` (bcrypt,
 * the same pattern as `hr_employees`/`delivery_representatives`
 * `pin_hash`/`pin_salt` from migration 0130), drops the index that
 * referenced the plaintext column, and DROPS the plaintext column
 * outright. Existing plaintext values are NEVER hashed: hashing
 * '1234' would preserve the universal default PIN. Customers
 * without a hash must obtain a new PIN through the staff reset
 * endpoint; the staff set path rejects trivial values including
 * '1234' (assertSecurePasscode). No backfill, prospective only.
 * Re-running is a no-op.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const { rows } = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'customers'
      AND column_name IN ('portal_pin_hash', 'portal_pin_salt', 'portal_access_pin')
  `.execute(db);
  const present = new Set(rows.map((row) => row.column_name));
  if (!present.has('portal_pin_hash')) {
    await sql`ALTER TABLE "customers" ADD COLUMN "portal_pin_hash" TEXT NULL`.execute(db);
  }
  if (!present.has('portal_pin_salt')) {
    await sql`ALTER TABLE "customers" ADD COLUMN "portal_pin_salt" TEXT NULL`.execute(db);
  }
  await sql`DROP INDEX IF EXISTS "idx_customers_tenant_phone_pin"`.execute(db);
  if (present.has('portal_access_pin')) {
    await sql`ALTER TABLE "customers" DROP COLUMN "portal_access_pin"`.execute(db);
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never restore plaintext PINs on rollback: the plaintext column is
  // not re-created and the hash columns are kept. Affected customers
  // keep obtaining PINs through the staff reset channel.
}

export const migration = { up, down };
