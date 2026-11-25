import { sql, type Kysely } from 'kysely';

/**
 * Race-window journal uniqueness (rank 7, sub-package 7b;
 * INV-RACE-WINDOW-JOURNAL-UNIQUENESS): the posting methods for these
 * eight source types check for an existing journal with a plain SELECT
 * and then insert. Between the SELECT and the INSERT, a concurrent
 * transaction on another connection can insert the same source, and
 * both journals post. Three of the methods even carry a 23505 catch
 * naming an index that never covered their type (manufacturing and
 * food waste name the round-1 index; van field return names the van
 * index) — dead guards, fixed alongside this migration by repointing
 * the catches at the index created here.
 *
 * The index is partial on active journals only (reversed_by_entry_id
 * IS NULL), PDC-style: postSaleEdit legitimately reverses the latest
 * journal and posts a new 'sale_edit' journal for the same sale, so an
 * unfiltered unique index would break every second sale edit. The
 * application-level SELECT guards stay stricter than the index (they
 * return the existing journal even when it is reversed); the index is
 * the race-proof floor, not the business rule.
 *
 * Deliberately NOT covered: postSaleEdit gets no catch-and-return —
 * a 23505 there means a concurrent edit won the race, and returning
 * the other edit's journal as this edit's posting would be a lie;
 * the edit transaction must fail closed and be retried. Opening
 * balances get a SELECT guard plus a catch in their post methods
 * (they had neither). hr_payroll_item_payment already catches every
 * 23505 and needs no change.
 *
 * The pre-scan fails the migration with a diagnosable error instead
 * of a raw Postgres unique-violation when legacy active duplicates
 * exist: run the 7a integrity checks (DUPLICATE_SOURCE_POSTINGS) on
 * production data first, and repair or reverse the duplicates before
 * applying this migration.
 */
const SOURCE_TYPES = [
  'manufacturing_work_order',
  'delivery_rep_settlement',
  'van_field_return',
  'hr_payroll_item_payment',
  'food_waste',
  'sale_edit',
  'customer_opening_balance',
  'supplier_opening_balance',
];

export async function up(db: Kysely<any>): Promise<void> {
  const { rows } = await sql<{ tenant_id: string; source_type: string; source_id: number; journal_count: number }>`
    SELECT tenant_id, source_type, source_id, count(*) AS journal_count
    FROM journal_entries
    WHERE status = 'posted' AND reversed_by_entry_id IS NULL AND source_id IS NOT NULL
      AND source_type IN (${sql.join(SOURCE_TYPES)})
    GROUP BY tenant_id, source_type, source_id
    HAVING count(*) > 1
    ORDER BY tenant_id, source_type, source_id
    LIMIT 5
  `.execute(db);
  if (rows.length) {
    throw new Error(
      `Race-window uniqueness migration refused: ${rows.length} active duplicate source(s) still posted, ` +
        `repair or reverse them first (DUPLICATE_SOURCE_POSTINGS): ` +
        rows.map((r) => `${r.tenant_id}/${r.source_type}#${r.source_id} x${r.journal_count}`).join(', '),
    );
  }
  // Index predicates cannot take bound parameters: inline the type list
  // as literals (the list is a fixed constant of this migration).
  const typeLiterals = sql.join(SOURCE_TYPES.map((t) => sql.lit(t)));
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_race_window_uniq
    ON journal_entries (tenant_id, source_type, source_id)
    WHERE source_type IN (${typeLiterals}) AND reversed_by_entry_id IS NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Dropping the index removes only the race guard; no journal data changes.
  await sql`DROP INDEX IF EXISTS idx_journal_entries_race_window_uniq`.execute(db);
}

export const migration = { up, down };
