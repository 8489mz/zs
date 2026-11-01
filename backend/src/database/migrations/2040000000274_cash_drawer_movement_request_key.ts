import { sql, type Kysely } from 'kysely';

/**
 * Cash-drawer movement idempotency key (INV-CASH-DRAWER-MOVEMENT-IDEMPOTENCY):
 * a drawer movement is written to the shared treasury_transactions table
 * (reference_type 'cashier_shift'), so it has no dedicated row to carry a
 * key. Without a stored client-supplied key, a retried
 * POST /api/cashier-shifts/:id/cash-movement inserts a second treasury
 * row, recomputes expected_cash on the doubled total, and posts a second
 * journal -- the expense sibling (expenses.request_key, migration 0272)
 * already solved this for expenses, and drawer movements had no
 * equivalent.
 *
 * The key is nullable and the unique index is partial and scoped to
 * drawer rows only (reference_type = 'cashier_shift'), so rows written
 * before this migration (no key) and treasury rows of every other kind
 * keep working untouched: no backfill, prospective only. The
 * application layer makes the key mandatory for new drawer movements;
 * the database constraint is the concurrent-retry backstop, scoped per
 * tenant exactly like the expense constraint. A key reused on a
 * different shift still collides on (tenant_id, request_key) and is a
 * conflict, because a key identifies one movement.
 *
 * Follows the 0263-0272 information_schema guard pattern: re-running
 * the migration is a no-op. Rollback deliberately does NOT drop the
 * column or the index: dropping the column would destroy the only
 * record of which retries were deduplicated.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const { rows } = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'treasury_transactions' AND column_name = 'request_key'
  `.execute(db);
  if (!rows.length) {
    await sql`ALTER TABLE "treasury_transactions" ADD COLUMN "request_key" TEXT NULL`.execute(db);
  }
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_treasury_txns_drawer_request_key_uniq"
    ON "treasury_transactions" ("tenant_id", "request_key")
    WHERE "request_key" IS NOT NULL AND "reference_type" = 'cashier_shift'
  `.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never destroy idempotency history on rollback: the column and the
  // partial unique index are kept, and pre-migration rows are untouched.
}

export const migration = { up, down };
