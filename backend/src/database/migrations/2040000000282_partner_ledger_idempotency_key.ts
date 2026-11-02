import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000282: idempotency key on partner capital
 * ledger (INV-IMPORT-SHIPMENT-CAPITAL-GUARDS).
 *
 * A retried capital transaction (double-click, network retry)
 * used to post twice: the ledger had no key and the service
 * recorded no dedup event. The service now pre-checks a supplied
 * key and inserts the ledger row carrying it; this partial
 * unique index is what serialises concurrent retries. The index
 * is partial (key IS NOT NULL) so keyless historical rows — and
 * keyless calls, which keep the old behaviour — are unaffected,
 * and the opening DEPOSIT written by createPartner stays
 * untouched (explicit NULL key).
 *
 * No container migration is included: the (tenant_id,
 * container_number) unique index already exists since migration
 * 2033, and the duplicate container+B/L rule is enforced at the
 * service level (one B/L legitimately covers many containers).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_partner_ledger ADD COLUMN IF NOT EXISTS idempotency_key TEXT`.execute(db);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_ledger_tenant_partner_key ON import_partner_ledger (tenant_id, partner_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_partner_ledger_tenant_partner_key`.execute(db);
  await sql`ALTER TABLE import_partner_ledger DROP COLUMN IF EXISTS idempotency_key`.execute(db);
}

export const migration = { up, down };
