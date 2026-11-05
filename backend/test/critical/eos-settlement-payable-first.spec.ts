/*
 * EOS settlement posts the net payable first (D1): the settlement journal
 * credits 2140 Payroll & Settlements Payable, never cash (1110) or a
 * treasury account, and creates zero treasury rows. Cash moves only on a
 * separate, evidenced payout step (follow-up; no such EOS payout flow
 * exists yet). INV-EOS-SETTLEMENT-PAYABLE-FIRST.
 *
 * Bar: 10,000 entitlements, loans 2,000, assets 500, treasury account
 * 1110 explicitly supplied -> Dr 6200 10,000 / Cr 1160 2,000 /
 * Cr 7100 500 / Cr 2140 7,500, no 1110 leg, 0 treasury rows.
 * Run: npx ts-node test/critical/eos-settlement-payable-first.spec.ts (from backend/).
 */

import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const AUTH = { tenantId: 't1', accountId: 'a1', userId: 1, username: 'tester', role: 'admin', permissions: [] } as never;
const FOUNDATION_STUB = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as never;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms)),
  ]);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db: Kysely<any> = new Kysely({ dialect: new PGliteDialect(pg) });
  try {
    const statements = [
      `CREATE TABLE settings (tenant_id text NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY (tenant_id, key))`,
      `CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric)`,
      `CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
        allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '', is_control_account boolean DEFAULT false,is_receivable boolean DEFAULT false,is_payable boolean DEFAULT false,is_inventory boolean DEFAULT false, account_type text DEFAULT '')`,
      `CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
        bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
        inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
        cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
        purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
        lock_date_all date, lock_date_non_adviser date, lock_date_tax date)`,
      `CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text,
        period_number int, start_date date, end_date date)`,
      `CREATE TABLE accounting_fiscal_years (id bigint PRIMARY KEY, tenant_id text, status text, closing_entry_id bigint)`,
      `CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text,
        entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint,
        status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint,
        posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint,
        reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text,
        dedup_key text, cash_flow_category text)`,
      `CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint,
        tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric,
        partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false)`,
      `CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text)`,
      `CREATE TABLE tenants (id text PRIMARY KEY)`,
      `CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint)`,
      `CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint)`,
      `CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text, default_branch_id bigint)`,
      `CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint)`,
      `CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, payment_channel text, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint)`,
      `CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, display_name text, status text)`,
      `CREATE TABLE hr_end_of_service_settlements (id integer PRIMARY KEY, tenant_id text NOT NULL, account_id text, settlement_no text, employee_id integer, settlement_date date, gratuity_amount numeric(14,3) NOT NULL DEFAULT 0, leave_encashment_amount numeric(14,3) NOT NULL DEFAULT 0, pending_salary_amount numeric(14,3) NOT NULL DEFAULT 0, notice_period_amount numeric(14,3) NOT NULL DEFAULT 0, other_entitlements_amount numeric(14,3) NOT NULL DEFAULT 0, unpaid_loans_deduction numeric(14,3) NOT NULL DEFAULT 0, assets_deduction numeric(14,3) NOT NULL DEFAULT 0, other_deductions numeric(14,3) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', journal_entry_id integer, created_at timestamptz DEFAULT now())`,
      `INSERT INTO hr_employees VALUES (1, 't1', 'Ahmed', 'active')`,
      `INSERT INTO tenants VALUES ('t1')`,
      `INSERT INTO settings VALUES ('t1', 'currency', 'KWD')`,
      `INSERT INTO branches VALUES (10,'t1',NULL)`,
      `INSERT INTO stock_locations VALUES (20,'t1',10)`,
      `INSERT INTO users VALUES (1,'t1','Tester','tester',NULL)`,
      `INSERT INTO currency_exchange_rates (tenant_id, currency_code, is_base, exchange_rate) VALUES ('t1', 'KWD', true, 1)`,
      `INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL)`,
      `INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES
        (1110, 't1', '1110', ''), (1120, 't1', '1120', ''), (1160, 't1', '1160', ''),
        (2140, 't1', '2140', ''), (6200, 't1', '6200', ''), (7100, 't1', '7100', '')`,
      `INSERT INTO hr_end_of_service_settlements (id, tenant_id, settlement_no, employee_id, settlement_date, gratuity_amount, leave_encashment_amount, pending_salary_amount, notice_period_amount, other_entitlements_amount, unpaid_loans_deduction, assets_deduction, other_deductions, status) VALUES
        (1, 't1', 'EOS-1', 1, '2026-03-31', 6000, 1000, 3000, 0, 0, 2000, 500, 0, 'draft')`,
    ];
    for (const statement of statements) {
      await sql.raw(statement).execute(db);
    }

    const posting = new AccountingPostingService(FOUNDATION_STUB as never);
    // Treasury account 1110 is supplied deliberately: even then, the
    // settlement journal must not credit cash (D1).
    const res = await withTimeout(
      posting.postEndOfServiceSettlement(db as never, 1, 1110, AUTH),
      25000,
      'postEndOfServiceSettlement',
    );
    assert.equal(res.posted, true);

    const lines = await db.selectFrom('journal_entry_lines').selectAll().execute() as unknown as Array<{ account_id: number; debit: string; credit: string }>;
    const byAccount = new Map<number, { debit: number; credit: number }>();
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      byAccount.set(line.account_id, { debit: Number(line.debit), credit: Number(line.credit) });
      totalDebit += Number(line.debit);
      totalCredit += Number(line.credit);
    }
    assert.equal(totalDebit, totalCredit, 'journal balances');
    assert.equal(byAccount.get(6200)?.debit, 10000, 'Dr 6200 total entitlements');
    assert.equal(byAccount.get(1160)?.credit, 2000, 'Cr 1160 applied loans');
    assert.equal(byAccount.get(7100)?.credit, 500, 'Cr 7100 applied assets');
    assert.equal(byAccount.get(2140)?.credit, 7500, 'Cr 2140 net payable (D1)');
    assert.equal(byAccount.has(1110), false, 'no cash leg: settlement never credits 1110');
    const treasury = await db.selectFrom('treasury_transactions').selectAll().execute();
    assert.equal(treasury.length, 0, 'no treasury row proves cash left');
    console.log('eos-settlement-payable-first.spec: ok (Cr 2140 7500, no 1110 leg, 0 treasury rows)');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => { console.error(error); process.exit(1); },
);
