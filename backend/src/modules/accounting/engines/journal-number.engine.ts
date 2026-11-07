import type { Kysely } from '../../../database/kysely';
import { sql } from '../../../database/kysely';
import type { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';

/*
 * Gapless journal numbering (INV-JE-NUMBERING-GAP).
 *
 * The visible journal number used to be the row identity itself:
 * entry_no = 'JE-' + String(journal_entries.id).padStart(8, '0').
 * Postgres identity values are consumed by failed inserts and are never
 * reclaimed on rollback, so every failed or rolled-back posting attempt
 * burned a number forever -- the duplicate-posting race is the proven
 * in-code path: two concurrent postings for the same source both pass
 * the SELECT dedup check, both insert, and the loser fails on the
 * partial unique index (23505) after its identity value is already
 * gone. There is no delete path in production code (only the demo-data
 * reset), so a missing number like JE-00014975 is a consumed identity,
 * not a deleted journal.
 *
 * The visible number is therefore computed from the highest VISIBLE
 * number, not from any consumable sequence: under a global transaction
 * advisory lock, allocate MAX(entry_no) + 1 over the committed rows.
 * The lock is held until the posting transaction ends, so a concurrent
 * allocator waits until the first posting commits and then sees its
 * row; a rollback leaves nothing behind to skip over, because no
 * counter ever advanced -- a failed posting leaves no gap. This is the
 * same mechanism the daily document sequence already relies on
 * (generateDailySequenceNumber: advisory lock + MAX, fail closed on a
 * pool handle). No new table and no migration: journal_entries already
 * carries the unique entry_no index, and the range predicate below lets
 * the MAX read use it (temporary numbers JE-TMP-* / JE-DRAFT-TMP-*
 * sort outside the 'JE-00000000'..'JE-99999999' range).
 *
 * Allocation happens BEFORE the insert and AFTER every validation, so
 * a validation failure consumes nothing. The identity column stays the
 * primary key; only the visible number changes source. Posted journals
 * and closed periods are never renumbered: the first new number is one
 * above the highest existing number.
 *
 * Price of gaplessness: the advisory lock serializes journal postings
 * globally for the tail of their transaction (they already serialize
 * per tenant on the accounting-period lock). That is the deliberate
 * trade-off for a gapless audit sequence.
 */

export function formatJournalEntryNo(sequence: number): string {
  return `JE-${String(sequence).padStart(8, '0')}`;
}

/**
 * Allocate the next gapless journal number inside the caller's
 * transaction. The handle MUST be a transaction: on a pool handle the
 * advisory lock would release the moment the SELECT returns, so the
 * call fails closed instead of issuing an unguarded number.
 */
export async function allocateJournalNumber(queryable: Kysely<Database>): Promise<number> {
  const handle = queryable as unknown as { isTransaction?: boolean };
  if (!handle?.isTransaction) {
    throw new AppError(
      'Journal numbering requires a transaction handle',
      'JOURNAL_NUMBER_REQUIRES_TRANSACTION',
      500,
    );
  }
  try {
    await sql`SELECT pg_advisory_xact_lock(hashtext('journal-number'))`.execute(queryable);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      'Journal number lock failed; the journal was not numbered',
      'JOURNAL_NUMBER_LOCK_FAILED',
      500,
    );
  }
  const result = await sql<{ last_no: string | null }>`
    SELECT MAX(entry_no) AS last_no FROM journal_entries
    WHERE entry_no >= 'JE-00000000' AND entry_no <= 'JE-99999999'
  `.execute(queryable);
  const last = result.rows[0]?.last_no;
  return (last ? Number(last.slice(3)) : 0) + 1;
}

/**
 * Read back the stored number of a journal just posted in this
 * transaction. Callers that used to derive the number from the returned
 * id (`JE-${id}`) must read it instead: the number no longer equals the id.
 */
export async function readJournalEntryNo(
  queryable: Kysely<Database>,
  tenantId: string,
  entryId: number,
): Promise<string | null> {
  const row = await queryable
    .selectFrom('journal_entries')
    .select('entry_no')
    .where('id', '=', entryId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  return row?.entry_no ?? null;
}
