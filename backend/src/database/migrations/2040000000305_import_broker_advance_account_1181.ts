import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0305 — seed account 1181 "عهد المخلصين الجمركيين" (Customs Broker
 * Advances) for every tenant that already has a chart of accounts.
 *
 * GROUNDING (I6-D, 2026-11-09):
 * - What 1181 is: the dedicated broker-advance asset account.
 *   resolveTenantAccount('broker_advance') looks for it FIRST, before
 *   1230 (import-sales.service.ts, candidates ['1181', '1230']), and
 *   the role check rejects any receivable/cash-bank/inventory/payable
 *   account and codes 1110/1120/1130/1140/1100. The three paths that
 *   resolve it are disburseBrokerAdvance (Dr 1181 / Cr bank),
 *   liquidateBrokerExpenses post-receipt settlement (Dr 1140 /
 *   Cr 1181) and receipt posting of folded broker costs (Cr 1181).
 *   Live trial phase 2 proved the flow is real: JE-00015026/27
 *   posted a broker advance and its settlement through 1130
 *   Customers because no 1181/1230 row existed, and I4-D9
 *   (INV-IMPORT-BROKER-ADVANCE-ACCOUNT, commit 4504934c) now
 *   fail-closes instead of posting to Customers. 1181 is the
 *   account D9's committed design names, and its exact row already
 *   exists in the e2e fixture and the D9 spec fixture — this
 *   migration invents no new account.
 * - 1230 is NOT seeded here: no name, label or definition for it
 *   exists anywhere in the repo (only the second fallback candidate
 *   in the resolver). A tenant-created 1230 keeps working as the
 *   fallback; inventing a 1230 row would be inventing a COA
 *   account the business never approved.
 * - Why a NEW migration, not an edit of the seed file: the seeded
 *   COA file 20260529000300_accounting_coa_upgrade.ts already ran
 *   on every live database (Kysely records executed migrations and
 *   never re-runs one), and its INSERT carries no tenant_id at all
 *   (single-tenant era, ON CONFLICT (code) on global rows) — so
 *   editing it would change nothing for any existing tenant,
 *   including test10k. A new migration runs at deploy for every
 *   existing tenant (migrations run before the swap) and also runs
 *   on fresh installs, in order, after the seed. Precedent:
 *   migration 0106 seeded GRNI (2125) / PPV (5190) per tenant the
 *   same way; migration 0294 repaired live rows while fixing the
 *   seed alongside.
 * - Row shape mirrors 1160 (Employee Advances), the closest
 *   analogue, and the e2e fixture: asset, debit, parent 1100,
 *   group 'current_assets', manual entries allowed, NOT a control
 *   account, NO role flag set (cash-bank / receivable / payable /
 *   inventory / tax all false) — so the resolver accepts it and
 *   the partner subledger sync never reads it as a control
 *   account.
 * - Scope: one row per tenant that HAS a chart (distinct
 *   tenant_id in accounting_accounts). A tenant with no chart
 *   gets nothing — it cannot disburse anyway (no bank account),
 *   and a lone 1181 without a chart would be noise. Tenants
 *   whose chart is seeded later by
 *   AccountingTenantFoundationService.ensureForScope are a
 *   known follow-up: DEFAULT_SEED_ACCOUNTS still lacks 1181, so
 *   a brand-new tenant's chart will not contain it until that
 *   list gains the same row (one line, same values).
 *
 * Up is idempotent (WHERE NOT EXISTS per tenant; the live unique
 * index on (tenant_id, code) is the backstop) and a no-op where
 * the tenant already has 1181 — including a tenant-created one,
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
      '1181',
      'عهد المخلصين الجمركيين',
      'Customs Broker Advances',
      'asset',
      'debit',
      TRUE,
      TRUE,
      1181,
      (SELECT id FROM accounting_accounts WHERE tenant_id = t.tenant_id AND code = '1100' LIMIT 1),
      'current_assets',
      TRUE,
      FALSE,
      FALSE,
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
      WHERE aa.tenant_id = t.tenant_id AND aa.code = '1181'
    )
  `.execute(db);

  // Reconciliation: no tenant may end up with two 1181 rows (the
  // unique index on (tenant_id, code) is the backstop; fail loudly
  // instead of silently leaving a duplicated chart).
  const dup = await sql<{ c: string }>`
    SELECT COUNT(*)::text AS c
    FROM (SELECT tenant_id FROM accounting_accounts WHERE code = '1181' GROUP BY tenant_id HAVING COUNT(*) > 1) d
  `.execute(db);
  if (Number(dup.rows[0]?.c ?? 0) !== 0) {
    throw new Error('migration 0305 left a tenant with more than one account 1181; refusing to continue');
  }
}

export async function down(db: any): Promise<void> {
  await sql`
    DELETE FROM accounting_accounts
    WHERE code = '1181'
      AND is_system IS TRUE
      AND name_ar = 'عهد المخلصين الجمركيين'
      AND name_en = 'Customs Broker Advances'
      AND NOT EXISTS (
        SELECT 1 FROM journal_entry_lines
        WHERE journal_entry_lines.account_id = accounting_accounts.id
      )
  `.execute(db);
}

export const migration: Migration = { up, down };
