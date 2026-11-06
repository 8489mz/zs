import { sql, type Kysely } from 'kysely';

/**
 * INV-ACCOUNTS-CHART-LABELS repair (2026-11-06): the standard seed wrote
 * the root groups with subgroup values — 1000 as 'fixed_assets' and 2000
 * as 'current_liabilities' — and migrations 00500/00600 force-updated the
 * seed rows with the same wrong values, so live rows still carry them
 * (verified on test10k: 1000 shows 'أصول ثابتة', 2000 shows 'خصوم
 * متداولة'). The seed itself is fixed alongside this migration; this
 * repair corrects the rows that already exist, for every tenant.
 *
 * Also normalizes any 'cost_of_sales' group spelling on the COGS leaves
 * 5100/5200/5300 to the single standard value 'cogs' (the posting
 * fallback used that spelling; the seed and all other writers use
 * 'cogs'). Each UPDATE is conditional on the row holding the wrong
 * value, so the migration is idempotent and a no-op where rows are
 * already correct. Prospective only: it changes a classification
 * column, never amounts, names, or posted journals.
 */
async function countWrongGroups(db: Kysely<unknown>): Promise<number> {
  const result = await sql<{ c: string }>`
    SELECT COUNT(*)::text AS c
    FROM accounting_accounts
    WHERE (code = '1000' AND account_group <> 'assets')
      OR (code = '2000' AND account_group <> 'liabilities')
      OR (code IN ('5100', '5200', '5300') AND account_group = 'cost_of_sales')
  `.execute(db);
  return Number(result.rows[0]?.c ?? 0);
}

async function countRows(db: Kysely<unknown>): Promise<number> {
  const result = await sql<{ c: string }>`
    SELECT COUNT(*)::text AS c FROM accounting_accounts
  `.execute(db);
  return Number(result.rows[0]?.c ?? 0);
}

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS account_group TEXT NOT NULL DEFAULT ''`.execute(db);

    const rowsBefore = await countRows(db);
    const wrongBefore = await countWrongGroups(db);

    await sql`
      UPDATE accounting_accounts
      SET account_group = 'assets', updated_at = NOW()
      WHERE code = '1000' AND account_group <> 'assets'
    `.execute(db);
    await sql`
      UPDATE accounting_accounts
      SET account_group = 'liabilities', updated_at = NOW()
      WHERE code = '2000' AND account_group <> 'liabilities'
    `.execute(db);
    await sql`
      UPDATE accounting_accounts
      SET account_group = 'cogs', updated_at = NOW()
      WHERE code IN ('5100', '5200', '5300') AND account_group = 'cost_of_sales'
    `.execute(db);

    const rowsAfter = await countRows(db);
    const wrongAfter = await countWrongGroups(db);
    if (rowsAfter !== rowsBefore) {
      throw new Error(
        `accounts chart root-groups repair changed the row count (${rowsBefore} -> ${rowsAfter}); refusing to continue`,
      );
    }
    if (wrongAfter !== 0) {
      throw new Error(
        `accounts chart root-groups repair left ${wrongAfter} rows with a wrong group (was ${wrongBefore}); refusing to continue`,
      );
    }
  },

  async down(): Promise<void> {},
};
