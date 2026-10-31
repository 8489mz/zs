import { sql, type Kysely } from 'kysely';

/**
 * Expense idempotency key (INV-TREASURY-EXPENSE-IDEMPOTENCY): without a
 * stored client-supplied key, a retried POST /api/expenses creates a
 * second expense and a second journal -- the transfer sibling
 * (treasury_transfers.request_key, migration 0186) already solved this
 * for transfers, and expenses had no equivalent. The key is nullable
 * and the unique index is partial, so rows written before this
 * migration (no key) keep working untouched: no backfill, prospective
 * only. The application layer makes the key mandatory for new writes;
 * the database constraint is the concurrent-retry backstop, scoped per
 * tenant exactly like the transfer constraint.
 *
 * Follows the 0263-0271 information_schema guard pattern: re-running
 * the migration is a no-op. Rollback deliberately does NOT drop the
 * column or the index: dropping the column would destroy the only
 * record of which retries were deduplicated.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const { rows } = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'expenses' AND column_name = 'request_key'
  `.execute(db);
  if (!rows.length) {
    await sql`ALTER TABLE "expenses" ADD COLUMN "request_key" TEXT NULL`.execute(db);
  }
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_expenses_tenant_request_key_uniq"
    ON "expenses" ("tenant_id", "request_key")
    WHERE "request_key" IS NOT NULL
  `.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never destroy idempotency history on rollback: the column and the
  // partial unique index are kept, and pre-migration rows are untouched.
}

export const migration = { up, down };
