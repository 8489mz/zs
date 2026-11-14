import { sql, type Kysely } from 'kysely';

/**
 * Expense cancel marker (INV-EXPENSE-CANCEL-REVERSAL): a posted expense
 * (trial G04) could not be cancelled -- there was no cancel path, no
 * status column on `expenses`, and the generic reverseJournalEntry
 * throws for non-manual entries. Cancelling must mark the expense
 * row so the close-screen disbursed total stops counting it, while
 * the posted journal itself is NEVER deleted or rewritten: the
 * cancel posts a separate reversing journal (source_type
 * 'expense_reversal') and a compensating +amount treasury row.
 *
 * The three columns are nullable with no backfill, so rows written
 * before this migration (no marker) keep working untouched:
 * prospective only. Rollback deliberately does NOT drop the columns:
 * dropping them would destroy the only record of which expenses were
 * cancelled and what their reversal entries were.
 *
 * Follows the 0263-0272 information_schema guard pattern: re-running
 * the migration is a no-op.
 */
export async function up(db: Kysely<any>): Promise<void> {
  for (const column of ['cancelled_at', 'cancelled_by', 'cancel_reason']) {
    const { rows } = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'expenses' AND column_name = ${column}
    `.execute(db);
    if (rows.length) continue;
    if (column === 'cancelled_at') {
      await sql`ALTER TABLE "expenses" ADD COLUMN "cancelled_at" TIMESTAMPTZ NULL`.execute(db);
    } else if (column === 'cancelled_by') {
      await sql`ALTER TABLE "expenses" ADD COLUMN "cancelled_by" BIGINT NULL`.execute(db);
    } else {
      await sql`ALTER TABLE "expenses" ADD COLUMN "cancel_reason" TEXT NULL`.execute(db);
    }
  }
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Never destroy cancellation history on rollback: the marker columns
  // are kept, and pre-migration rows are untouched.
}

export const migration = { up, down };
