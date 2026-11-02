import { sql, type Kysely } from 'kysely';

/*
 * Migration 2040000000281: drop the silent DEFAULT 1 on
 * import_shipments.exchange_rate_at_arrival
 * (INV-IMPORT-ARRIVAL-RATE-FAIL-CLOSED).
 *
 * Migration 2033 defined the column with DEFAULT '1', so every
 * shipment created without an explicit rate silently costed and
 * posted at rate 1. New rows must now carry NULL until a real
 * arrival rate is recorded; the service fails closed on NULL.
 * Existing rows keep their stored values untouched — a legacy
 * row stored at exactly 1 remains indistinguishable from a
 * genuinely entered 1, which is a recorded residual, not
 * something this migration can repair.
 *
 * The drop is guarded on information_schema: re-running the
 * migration after the default is gone is a harmless skip.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const { rows } = await sql<{ column_default: string | null }>`
    select column_default from information_schema.columns
    where table_schema = current_schema() and table_name = 'import_shipments' and column_name = 'exchange_rate_at_arrival'
  `.execute(db);
  if (!rows.length) throw new Error('Required column missing: import_shipments.exchange_rate_at_arrival');
  if (rows[0].column_default === null) return;
  await sql`ALTER TABLE import_shipments ALTER COLUMN exchange_rate_at_arrival DROP DEFAULT`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Schema rollback symmetry only: restores the pre-migration
  // default. No row values are touched in either direction.
  await sql`ALTER TABLE import_shipments ALTER COLUMN exchange_rate_at_arrival SET DEFAULT '1'`.execute(db);
}

export const migration = { up, down };
