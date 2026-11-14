import type { Migration } from 'kysely';
import { sql } from 'kysely';

/*
 * 0323 — seed account 1185 "دفعات مقدمة للموردين" (Supplier Advances)
 * for every tenant that already has a chart of accounts, and mark
 * supplier advance payments on `supplier_payments`
 * (INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT).
 *
 * GROUNDING (spice trial D08, 2026-11-14): a 200 EGP supplier advance
 * was posted as an ordinary supplier payment — Dr 2110 Accounts
 * Payable / Cr cash — netting the payable 300 -> 100, although no
 * bill had been settled. `createSupplierPayment` rejected a true
 * advance outright (SUPPLIER_NO_BALANCE with a zero balance,
 * SUPPLIER_OVERPAYMENT above it), and the chart had no dedicated
 * supplier-advance asset account (1160/1170/1180/1181 exist; 1165
 * lives only in a fallback map for subcontractor advances and must
 * not be reused). The advance therefore had nowhere to live except
 * inside the payable.
 *
 * Why 1185: it is free — no code, seed, fallback map or fixture
 * references it anywhere — and it sits in the advance cluster next
 * to 1180 (container deposits) and 1181 (broker advances), mirroring
 * the 1160 employee-advance shape. 1111-1119 are NOT used: they are
 * reserved for package #9's safe account.
 *
 * Row shape mirrors 1160/1181: asset, debit, parent 1100, group
 * 'current_assets', manual entries allowed, NOT a control account,
 * NO role flag set — so the partner-subledger sync never reads it
 * as a control account, and `resolveSystemAccountByCode('1185')`
 * auto-creates it from the fallback map for any tenant the
 * migration missed.
 *
 * `supplier_payments.is_advance` marks the payment as an advance
 * (Dr 1185 / Cr cash-or-bank, payable balance untouched) instead of
 * a settlement (Dr 2110 / Cr cash-or-bank). `applied_amount` is the
 * cumulative amount of the advance already applied against later
 * bills (Dr 2110 / Cr 1185); the outstanding advance is
 * amount - applied_amount, and every apply is capped at it.
 *
 * Up is idempotent (WHERE NOT EXISTS per tenant for the account;
 * information_schema guard for the columns) and a no-op where the
 * tenant already has 1185. Down removes only rows this migration
 * added (is_system + the exact seeded names) and never a row any
 * journal line references; the payment columns are kept on rollback
 * (dropping them would destroy the only record of which payments
 * were advances and how much of each was applied).
 * Prospective only: it adds a chart row and two nullable-by-default
 * columns, never amounts, names of existing rows, or posted journals.
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
      '1185',
      'دفعات مقدمة للموردين',
      'Supplier Advances',
      'asset',
      'debit',
      TRUE,
      TRUE,
      1185,
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
      WHERE aa.tenant_id = t.tenant_id AND aa.code = '1185'
    )
  `.execute(db);

  // Reconciliation: no tenant may end up with two 1185 rows (the
  // unique index on (tenant_id, code) is the backstop; fail loudly
  // instead of silently leaving a duplicated chart).
  const dup = await sql<{ c: string }>`
    SELECT COUNT(*)::text AS c
    FROM (SELECT tenant_id FROM accounting_accounts WHERE code = '1185' GROUP BY tenant_id HAVING COUNT(*) > 1) d
  `.execute(db);
  if (Number(dup.rows[0]?.c ?? 0) !== 0) {
    throw new Error('migration 0323 left a tenant with more than one account 1185; refusing to continue');
  }

  for (const [column, ddl] of [
    ['is_advance', `ALTER TABLE "supplier_payments" ADD COLUMN "is_advance" BOOLEAN NOT NULL DEFAULT FALSE`],
    ['applied_amount', `ALTER TABLE "supplier_payments" ADD COLUMN "applied_amount" NUMERIC(14,3) NOT NULL DEFAULT 0`],
  ] as Array<[string, string]>) {
    const { rows } = await sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'supplier_payments' AND column_name = ${column}
    `.execute(db);
    if (rows.length) continue;
    await sql.raw(ddl).execute(db);
  }
}

export async function down(db: any): Promise<void> {
  await sql`
    DELETE FROM accounting_accounts
    WHERE code = '1185'
      AND is_system IS TRUE
      AND name_ar = 'دفعات مقدمة للموردين'
      AND name_en = 'Supplier Advances'
      AND NOT EXISTS (
        SELECT 1 FROM journal_entry_lines
        WHERE journal_entry_lines.account_id = accounting_accounts.id
      )
  `.execute(db);
  // The supplier_payments columns are deliberately kept on rollback:
  // dropping them would destroy the record of which payments were
  // advances and how much of each was applied.
}

export const migration: Migration = { up, down };
