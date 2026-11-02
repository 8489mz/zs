import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000280: idempotency key on late-expense events
 * (INV-IMPORT-LATE-EXPENSE-IDEMPOTENCY).
 *
 * A retried late-expense submission (double-click, network retry)
 * used to post twice: the events table had no key and the service
 * recorded no dedup event. The service now records a provisional
 * event row carrying the key before any revaluation; this partial
 * unique index is what makes that row a serialising dedup token.
 * The index is partial (key IS NOT NULL) so keyless historical
 * rows — and keyless calls, which keep the old behaviour — are
 * unaffected. Nullable on purpose: the key is optional for
 * backward compatibility with the existing frontend contract,
 * which sends no key.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE import_late_expense_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT`.execute(db);
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_late_expense_events_tenant_shipment_key ON import_late_expense_events (tenant_id, shipment_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_late_expense_events_tenant_shipment_key`.execute(db);
  await sql`ALTER TABLE import_late_expense_events DROP COLUMN IF EXISTS idempotency_key`.execute(db);
}

export const migration = { up, down };
