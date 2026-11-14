import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0324 — seed account 1111 "الخزينة الآمنة" (Safe / Cash Box) for
 * every tenant that already has a chart of accounts.
 *
 * GROUNDING (INV-DRAWER-DISBURSE-CASHIER-PASSWORD, spice trial T31):
 * - A safe transfer (safe_drop, 300, counterpart 1110 — الخزينة)
 *   fails with DRAWER_COUNTERPART_SAME_AS_CASH because the drawer
 *   cash account IS 1110 and the code stated "There is no
 *   safe/cash-box account in the chart". With counterpart 1120 the
 *   same call succeeds. So "transfer to the safe" had no account to
 *   land in: 1110 is the drawer itself, 1120 is the bank.
 * - The transfer counterpart validation (recordCashMovement
 *   pre-check and postCashDrawerMovement) requires an active
 *   is_cash_bank asset with a debit normal balance, different from
 *   the drawer cash account — so the seeded row MUST be
 *   is_cash_bank true, or the transfer still fail-closes. That is
 *   the one shape difference from the 1181 precedent (migration
 *   0305), whose row is NOT cash/bank.
 * - Row shape mirrors 1110 (Cash), the closest analogue: asset,
 *   debit, parent 1100, group 'cash_bank', manual entries allowed,
 *   NOT a control account, is_cash_bank TRUE, no other role flag.
 * - Why a NEW migration, not an edit of the seed list: the seeded
 *   COA list already ran on every live database, so editing it
 *   alone would change nothing for any existing tenant. A new
 *   migration runs at deploy for every existing tenant and also
 *   runs on fresh installs, in order, after the seed. Precedent:
 *   migration 0106 seeded GRNI (2125) / PPV (5190) per tenant the
 *   same way; migration 0305 seeded 1181 the same way. The same
 *   row is ALSO added to DEFAULT_SEED_ACCOUNTS
 *   (accounting-tenant-foundation.service.ts) so a brand-new
 *   tenant's chart contains it from the start.
 * - 1111 is free: no 1111 code exists in the COA seed or in any
 *   migration (verified by grep before this package).
 * - Scope: one row per tenant that HAS a chart (distinct
 *   tenant_id in accounting_accounts). A tenant with no chart
 *   gets nothing — it cannot transfer anyway (no drawer cash
 *   account), and a lone 1111 without a chart would be noise.
 *
 * Up is idempotent (WHERE NOT EXISTS per tenant; the live unique
 * index on (tenant_id, code) is the backstop) and a no-op where
 * the tenant already has 1111 — including a tenant-created one,
 * which is never overwritten. Down removes only rows this
 * migration added (is_system + the exact seeded names) and never
 * a row any journal line references.
 * Prospective only: it adds a chart row, never amounts, names of
 * existing rows, or posted journals.
 */
export async function up(db: any): Promise<void> {
  await sql`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS account_group TEXT NOT NULL DEFAULT ''`.execute(db);
  await sql`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS allow_manual_entries BOOLEAN NOT NULL DEFAULT TRUE`.execute(db);
  await sql`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS is_control_account BOOLEAN NOT NULL DEFAULT FALSE`.execute(db);
  await sql`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS is_cash_bank BOOLEAN NOT NULL DEFAULT FALSE`.execute(db);
  await sql`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS is_receivable BOOLEAN NOT NULL DEFAULT FALSE`.execute(db);
  await sql`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS is_payable BOOLEAN NOT NULL DEFAULT FALSE`.execute(db);
  await sql`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS is_inventory BOOLEAN NOT NULL DEFAULT FALSE`.execute(db);
  await sql`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS is_tax BOOLEAN NOT NULL DEFAULT FALSE`.execute(db);
  await sql`ALTER TABLE accounting_accounts ADD COLUMN IF NOT EXISTS description_ar TEXT NOT NULL DEFAULT ''`.execute(db);

  await sql`
    INSERT INTO accounting_accounts (
      tenant_id, account_id, code, name_ar, name_en, account_type,
      normal_balance, is_active, is_system, sort_order, parent_id,
      account_group, allow_manual_entries, is_control_account,
      is_cash_bank, is_receivable, is_payable, is_inventory, is_tax,
      description_ar, created_at, updated_at
    )
    SELECT
      t.tenant_id,
      t.tenant_id,
      '1111',
      'الخزينة الآمنة',
      'Safe / Cash Box',
      'asset',
      'debit',
      TRUE,
      TRUE,
      1111,
      (SELECT id FROM accounting_accounts WHERE tenant_id = t.tenant_id AND code = '1100' LIMIT 1),
      'cash_bank',
      TRUE,
      FALSE,
      TRUE,
      FALSE,
      FALSE,
      FALSE,
      FALSE,
      '',
      NOW(),
      NOW()
    FROM (
      SELECT DISTINCT tenant_id
      FROM accounting_accounts
      WHERE tenant_id IS NOT NULL AND tenant_id <> ''
    ) t
    WHERE NOT EXISTS (
      SELECT 1 FROM accounting_accounts aa
      WHERE aa.tenant_id = t.tenant_id AND aa.code = '1111'
    )
  `.execute(db);

  // Reconciliation: no tenant may end up with two 1111 rows (the
  // unique index on (tenant_id, code) is the backstop; fail loudly
  // instead of silently leaving a duplicated chart).
  const dup = await sql<{ c: string }>`
    SELECT COUNT(*)::text AS c
    FROM (SELECT tenant_id FROM accounting_accounts WHERE code = '1111' GROUP BY tenant_id HAVING COUNT(*) > 1) d
  `.execute(db);
  if (Number(dup.rows[0]?.c ?? 0) !== 0) {
    throw new Error('migration 0324 left a tenant with more than one account 1111; refusing to continue');
  }
}

export async function down(db: any): Promise<void> {
  await sql`
    DELETE FROM accounting_accounts
    WHERE code = '1111'
      AND is_system IS TRUE
      AND name_ar = 'الخزينة الآمنة'
      AND name_en = 'Safe / Cash Box'
      AND NOT EXISTS (
        SELECT 1 FROM journal_entry_lines
        WHERE journal_entry_lines.account_id = accounting_accounts.id
      )
  `.execute(db);
}

export const migration: Migration = { up, down };
