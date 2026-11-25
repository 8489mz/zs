/*
New file: backend/test/critical/payroll-accrual-period-end-date.spec.ts
Pins the payroll journal dates (INV-PAYROLL-ACCRUAL-PERIOD-END-DATE).

THE RULE: the accrual journal belongs to the wage period the work
was performed in, so it is dated at the run's period end — never
at the approval date. The payment journals stay dated at the
payment date, because cash leaves on the day of payment.

THE GAP: all three payroll post methods dated their journals
with `new Date()` and none of them read the run's period dates
at all, so an October run approved in November booked its wage
expense in November and left October with no payroll expense.

WHAT THIS PINS, driving the REAL posting methods on PGlite:
- postPayrollAccrual on a run ending 2026-10-31 posts its
  journal dated 2026-10-31 (Dr 6200 / Cr 2140), even though
  the test runs later.
- postPayrollPayment on the same period posts its journal
  dated today, not at the period end.
- A run with no period end date rejects with
  HR_PAYROLL_ACCRUAL_PERIOD_END_MISSING and posts nothing.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

  try {
    await pg.exec(`
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text,
        name_ar text DEFAULT '', name_en text DEFAULT '', is_active boolean DEFAULT true,
        allow_manual_entries boolean DEFAULT true, is_tax boolean DEFAULT false, account_group text DEFAULT '', is_control_account boolean DEFAULT false,is_receivable boolean DEFAULT false,is_payable boolean DEFAULT false,is_inventory boolean DEFAULT false, account_type text DEFAULT '');
      CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint,
        bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint,
        inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint,
        cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint,
        purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint,
        lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text,
        period_number int, start_date date, end_date date);
      CREATE TABLE accounting_fiscal_years (id bigint PRIMARY KEY, tenant_id text, status text, closing_entry_id bigint);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text,
        entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint,
        status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint,
        posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint,
        reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text,
        dedup_key text, cash_flow_category text);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint,
        tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric,
        partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
      CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
      CREATE TABLE tenants (id text PRIMARY KEY);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text, default_branch_id bigint);
      CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
      CREATE TABLE customer_ledger (tenant_id text, customer_id bigint, amount numeric, reference_type text, reference_id bigint, entry_type text);
      CREATE TABLE supplier_ledger (tenant_id text, account_id text, supplier_id bigint, entry_type text,
        amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz);
      CREATE TABLE customers (id bigint, tenant_id text, name text, balance numeric DEFAULT 0);
      CREATE TABLE customer_installment_plans (id bigint PRIMARY KEY, tenant_id text, plan_number text, customer_id bigint, financed_amount numeric, interest_amount numeric, branch_id bigint, created_by bigint, created_at timestamptz);
      CREATE TABLE customer_installments (id bigint PRIMARY KEY, tenant_id text, plan_id bigint, installment_number int, amount numeric, due_date date);
      CREATE TABLE accounting_installment_interest (id bigserial PRIMARY KEY, tenant_id text, plan_id bigint, installment_id bigint, recognition_date date, amount numeric, account_id text, journal_entry_id bigint, UNIQUE(tenant_id, installment_id));
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, display_name text, status text, compensation_type text, hourly_rate numeric, expected_daily_hours numeric);
      CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, account_id text, period_month text, start_date date, end_date date, pay_frequency text, status text, updated_at timestamptz);
      CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, account_id text, run_id bigint, employee_id bigint, contract_id bigint, base_salary numeric, allowance_amount numeric, deduction_amount numeric, loan_deduction_amount numeric, asset_recovery_deduction_amount numeric, employee_social_insurance numeric, employer_social_insurance numeric, income_tax numeric, penalty_deduction numeric, carried_forward_deduction numeric, gross_pay numeric, net_pay numeric, status text, notes text, paid_at timestamptz, paid_by bigint, payment_channel text, journal_entry_id bigint, updated_at timestamptz);
      INSERT INTO tenants VALUES ('t1');
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
      INSERT INTO accounting_settings VALUES
        (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO branches VALUES (10,'t1',NULL);
      INSERT INTO stock_locations VALUES (20,'t1',10);
      INSERT INTO users VALUES (1,'t1','Cashier One','cashier1',NULL);
      INSERT INTO hr_employees VALUES (1,'t1','Emp One','active','monthly',0,8);
      INSERT INTO hr_payroll_runs VALUES (7,'t1','a1','2026-10','2026-10-01','2026-10-31','monthly','reviewed',NOW());
      INSERT INTO hr_payroll_runs VALUES (8,'t1','a1','2026-10','2026-10-01','2026-10-31','monthly','approved',NOW());
      INSERT INTO hr_payroll_runs VALUES (9,'t1','a1','2026-10','2026-10-01',NULL,'monthly','reviewed',NOW());
      INSERT INTO hr_payroll_run_items (id, tenant_id, account_id, run_id, employee_id, contract_id, base_salary, allowance_amount, deduction_amount, loan_deduction_amount, asset_recovery_deduction_amount, employee_social_insurance, employer_social_insurance, income_tax, penalty_deduction, carried_forward_deduction, gross_pay, net_pay, status, notes, updated_at)
        VALUES (1,'t1','a1',7,1,1,5000,0,0,0,0,0,0,0,0,0,5000,5000,'reviewed','',NOW());
      INSERT INTO hr_payroll_run_items (id, tenant_id, account_id, run_id, employee_id, contract_id, base_salary, allowance_amount, deduction_amount, loan_deduction_amount, asset_recovery_deduction_amount, employee_social_insurance, employer_social_insurance, income_tax, penalty_deduction, carried_forward_deduction, gross_pay, net_pay, status, notes, updated_at)
        VALUES (2,'t1','a1',8,1,1,5000,0,0,0,0,0,0,0,0,0,5000,5000,'approved','',NOW());
      INSERT INTO hr_payroll_run_items (id, tenant_id, account_id, run_id, employee_id, contract_id, base_salary, allowance_amount, deduction_amount, loan_deduction_amount, asset_recovery_deduction_amount, employee_social_insurance, employer_social_insurance, income_tax, penalty_deduction, carried_forward_deduction, gross_pay, net_pay, status, notes, updated_at)
        VALUES (3,'t1','a1',9,1,1,5000,0,0,0,0,0,0,0,0,0,5000,5000,'reviewed','',NOW());
    `);
    for (const code of [1110, 1120, 1160, 2140, 2145, 2146, 6200, 6210, 7100]) {
      await pg.query('INSERT INTO accounting_accounts(id,tenant_id,code,account_type) VALUES ($1,$2,$3,$4)', [
        code,
        't1',
        String(code),
        '',
      ]);
    }
    const entryDateKey = async (entryId: number): Promise<string> => {
      const r = await pg.query<{ d: string }>('SELECT entry_date::date::text AS d FROM journal_entries WHERE id=$1', [
        entryId,
      ]);
      return r.rows[0].d;
    };
    const journalLines = async (
      entryId: number,
    ): Promise<Array<{ account_id: number; debit: string; credit: string }>> => {
      const r = await pg.query<{ account_id: number; debit: string; credit: string }>(
        'SELECT account_id, debit::text, credit::text FROM journal_entry_lines WHERE journal_entry_id=$1 ORDER BY id',
        [entryId],
      );
      return r.rows;
    };

    // 1. Accrual: dated at the period end, not at approval time.
    const accrual = await posting.postPayrollAccrual(db, 7, auth);
    assert.equal(accrual.posted, true);
    assert.ok(accrual.journalEntryId);
    assert.equal(await entryDateKey(accrual.journalEntryId), '2026-10-31');
    const accrualLines = await journalLines(accrual.journalEntryId);
    assert.deepEqual(
      accrualLines.map((l) => [l.account_id, Number(l.debit), Number(l.credit)]),
      [
        [6200, 5000, 0],
        [2140, 0, 5000],
      ],
    );

    // 2. Payment: dated today, not at the period end.
    const payment = await posting.postPayrollPayment(db, 8, 'cash', auth);
    assert.equal(payment.posted, true);
    assert.ok(payment.journalEntryId);
    // Local calendar date, not UTC: entry_date is a timestamptz
    // and its date key is read in the machine's timezone, so the
    // expectation must use the same local date (toISOString is
    // UTC and disagrees around midnight).
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assert.equal(await entryDateKey(payment.journalEntryId), todayKey);
    const paymentLines = await journalLines(payment.journalEntryId);
    assert.deepEqual(
      paymentLines.map((l) => [l.account_id, Number(l.debit), Number(l.credit)]),
      [
        [2140, 5000, 0],
        [1110, 0, 5000],
      ],
    );

    // 3. Missing period end: fail closed, nothing posted.
    await assert.rejects(posting.postPayrollAccrual(db, 9, auth), /HR_PAYROLL_ACCRUAL_PERIOD_END_MISSING/);
    const missing = await pg.query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM journal_entries WHERE source_type='hr_payroll_accrual' AND source_id=9",
    );
    assert.equal(Number(missing.rows[0].c), 0);

    console.log('Payroll accrual period end date tests passed.');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
