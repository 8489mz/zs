import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0307 — seed account 1180 "تأمينات الحاويات المستردة" (Refundable
 * Container Deposits) for every tenant that already has a chart of
 * accounts.
 *
 * GROUNDING (I8-D, 2026-11-09):
 * - What 1180 is: the dedicated container-deposit asset account.
 *   resolveTenantAccount('container_deposit') looks for it FIRST
 *   (import-sales.service.ts, candidates ['1180', '1182',
 *   '1240']), and the role check rejects any cash/bank, inventory
 *   or payable account and codes 1110/1120/1140/1100. The only
 *   path that resolves it is recordContainerDeposit (Dr 1180 /
 *   Cr bank) plus the refund path that relieves it.
 *   Live re-test 6(a) (deployed 4d811676) proved the flow is
 *   real: a valid 100 EGP deposit was rejected with "فشل إثبات
 *   التأمين: تعذر تحديد حساب محاسبي نشط ومصنف لدور
 *   (container_deposit) في دليل الحسابات…" — list stayed 0
 *   deposits / 0.00, no JE — because the seeded chart has no
 *   1180/1182/1240 row at all. The D8 payload/validation fix
 *   already works (re-test 6(b) PASS); the missing account is
 *   the only remaining blocker.
 * - Why 1180 and not 1182/1240: 1180 is the resolver's FIRST
 *   candidate, the exact code the existing deposit spec pins
 *   (import-container-deposit.spec.ts: JE Dr 1180 / Cr 1120),
 *   and its Arabic name 'تأمينات الحاويات المستردة' is the
 *   resolver's own role label — 1180 is the account the design
 *   already names. No name, label or definition for 1182 or
 *   1240 exists anywhere in the repo (only the second/third
 *   fallback candidates in the resolver). Seeding either would
 *   invent a COA account the business never approved, and a
 *   tenant-created 1182/1240 keeps working as the fallback.
 *   Same convention as 1181 in I6-D (migration 0305 seeded
 *   the first broker_advance candidate, not 1230).
 * - Contracting cross-check: contracting.service.ts lists
 *   1180 among the retention fallbacks ['1135', '1180',
 *   '1160'] with no ORDER BY. Seeded charts resolve that
 *   fallback to 1160 today (1135/1180 absent); 1180 sorts
 *   after 1160, so the indexed/heap order keeps 1160 first
 *   and the retention leg is unaffected by this seed. If
 *   contracting ever orders that fallback explicitly, this
 *   note is the place to re-check.
 * - Why a NEW migration, not an edit of the seed file: the
 *   seeded COA file 20260529000300 already ran on every live
 *   database (Kysely records executed migrations and never
 *   re-runs one), and its INSERT carries no tenant_id at all
 *   (single-tenant era, ON CONFLICT (code) on global rows) —
 *   so editing it would change nothing for any existing
 *   tenant, including test10k. A new migration runs at deploy
 *   for every existing tenant (migrations run before the
 *   swap) and also runs on fresh installs, in order, after
 *   the seed. Precedent: migration 0106 seeded GRNI (2125) /
 *   PPV (5190) per tenant the same way; migration 0305 seeded
 *   1181 the same way.
 * - Row shape mirrors 1160 (Employee Advances), the closest
 *   analogue, and the deposit spec fixture: asset, debit,
 *   parent 1100, group 'current_assets', manual entries
 *   allowed, NOT a control account, NO role flag set
 *   (cash-bank / receivable / payable / inventory / tax all
 *   false) — so the resolver accepts it and the partner
 *   subledger sync never reads it as a control account.
 * - Scope: one row per tenant that HAS a chart (distinct
 *   tenant_id in accounting_accounts). A tenant with no chart
 *   gets nothing — it cannot record a deposit anyway (no bank
 *   account), and a lone 1180 without a chart would be noise.
 *   Brand-new tenants are covered alongside by the matching
 *   1180 row in DEFAULT_SEED_ACCOUNTS
 *   (accounting-tenant-foundation.service.ts), so a chart
 *   seeded after this migration also contains it.
 *
 * Up is idempotent (WHERE NOT EXISTS per tenant; the live unique
 * index on (tenant_id, code) is the backstop) and a no-op where
 * the tenant already has 1180 — including a tenant-created one,
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
      '1180',
      'تأمينات الحاويات المستردة',
      'Container Deposits',
      'asset',
      'debit',
      TRUE,
      TRUE,
      1180,
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
      WHERE aa.tenant_id = t.tenant_id AND aa.code = '1180'
    )
  `.execute(db);

  // Reconciliation: no tenant may end up with two 1180 rows (the
  // unique index on (tenant_id, code) is the backstop; fail loudly
  // instead of silently leaving a duplicated chart).
  const dup = await sql<{ c: string }>`
    SELECT COUNT(*)::text AS c
    FROM (SELECT tenant_id FROM accounting_accounts WHERE code = '1180' GROUP BY tenant_id HAVING COUNT(*) > 1) d
  `.execute(db);
  if (Number(dup.rows[0]?.c ?? 0) !== 0) {
    throw new Error('migration 0307 left a tenant with more than one account 1180; refusing to continue');
  }
}

export async function down(db: any): Promise<void> {
  await sql`
    DELETE FROM accounting_accounts
    WHERE code = '1180'
      AND is_system IS TRUE
      AND name_ar = 'تأمينات الحاويات المستردة'
      AND name_en = 'Container Deposits'
      AND NOT EXISTS (
        SELECT 1 FROM journal_entry_lines
        WHERE journal_entry_lines.account_id = accounting_accounts.id
      )
  `.execute(db);
}

export const migration: Migration = { up, down };
