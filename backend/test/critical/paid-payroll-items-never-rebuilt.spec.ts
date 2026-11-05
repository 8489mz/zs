/*
New file: backend/test/critical/paid-payroll-items-never-rebuilt.spec.ts
Pins that a paid payroll run item is never recomputed or
status-reset by a rebuild (INV-PAID-PAYROLL-ITEMS-NEVER-REBUILT).

THE GAP: rebuildPayrollRunItems skipped existing items only when
their status was 'approved'. A 'paid' item reached by a rebuild
had every money field recomputed and its status overwritten with
the rebuild target ('draft' / 'reviewed' / 'approved') —
resurrecting it as payable, with its stale journal link still
attached, so a later payment would move drawer cash against an
already-posted (deduped) journal. All current rebuild callers
are gated to draft/reviewed runs, so no live path reaches a paid
item today; the guard belongs on the item itself, not on the
callers, and this spec pins it there.

THE DRIVE: the private rebuild is invoked directly against
PGlite with a draft run holding two items for monthly-salaried
employees with covering contracts — one 'paid' item whose stored
amounts deliberately differ from the recomputed amounts, and
one 'draft' item that must be recomputed. Tables the rebuild
reads but that carry no fixture rows are created empty.

WHAT THIS PINS:
- The paid item keeps its stored net_pay, its 'paid' status,
  and its journal_entry_id link, byte for byte.
- The draft item is recomputed from its contract (net 5000).
- The run's other items are unaffected by the skip.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;
  const service = new HrService(
    db,
    new TransactionHelper(),
    { log: async () => {} } as never,
    {} as never,
    {} as never,
    undefined,
  );

  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE hr_hr_settings (id bigint PRIMARY KEY, tenant_id text, key text, value text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, display_name text, status text, compensation_type text, hourly_rate numeric, expected_daily_hours numeric, hire_date date, end_of_service_date date, has_social_insurance boolean, insurance_salary numeric, has_income_tax boolean, pay_frequency text, user_id bigint, commission_type text, commission_value numeric, commission_target numeric, delay_policy text, approved_leave_days numeric);
      CREATE TABLE hr_employment_contracts (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, base_salary numeric, currency text, status text, start_date date, end_date date);
      CREATE TABLE hr_compensation_packages (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, allowance_amount numeric, deduction_amount numeric, effective_from date, effective_to date);
      CREATE TABLE hr_employee_adjustments (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, run_id bigint, item_id bigint, status text, applied_in_run_id bigint, amount numeric, date date, adjustment_type text, amount_type text, accounting_category text);
      CREATE TABLE hr_payroll_item_adjustments (id bigint PRIMARY KEY, tenant_id text, payroll_item_id bigint, adjustment_type text, amount numeric);
      CREATE TABLE hr_end_of_service_settlements (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, status text);
      CREATE TABLE hr_attendance_records (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, work_date date, status text, check_in_at timestamptz, check_out_at timestamptz, prior_sessions_minutes integer NOT NULL DEFAULT 0);
      CREATE TABLE hr_attendance_exceptions (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, status text, work_date date, exception_type text, approved_duration_minutes numeric, duration_minutes numeric);
      CREATE TABLE hr_leave_requests (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, status text, start_date date, end_date date, leave_type_id bigint, total_days numeric, days_count numeric, leave_type text);
      CREATE TABLE hr_leave_types (id bigint PRIMARY KEY, tenant_id text, is_paid boolean, deduct_from_salary boolean, code text);
      CREATE TABLE hr_holidays (id bigint PRIMARY KEY, tenant_id text, holiday_date date, start_date date, end_date date);
      CREATE TABLE sales_invoices (id bigint PRIMARY KEY, tenant_id text);
      CREATE TABLE hr_employee_loans (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, status text, remaining_amount numeric, first_due_date date, salary_due_date date, repayment_mode text, issue_date date, disbursed_at timestamptz);
      CREATE TABLE hr_employee_loan_installments (id bigint PRIMARY KEY, tenant_id text, loan_id bigint, amount numeric, status text, due_date date, paid_amount numeric, installment_no int);
      CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, account_id text, period_month text, start_date date, end_date date, pay_frequency text, status text, updated_at timestamptz);
      CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, account_id text, run_id bigint, employee_id bigint, contract_id bigint, base_salary numeric, allowance_amount numeric, deduction_amount numeric, loan_deduction_amount numeric, asset_recovery_deduction_amount numeric, employee_social_insurance numeric, employer_social_insurance numeric, income_tax numeric, penalty_deduction numeric, carried_forward_deduction numeric, gross_pay numeric, net_pay numeric, status text, notes text, paid_at timestamptz, paid_by bigint, payment_channel text, journal_entry_id bigint, updated_at timestamptz);
      INSERT INTO settings VALUES ('t1','currency','EGP');
      INSERT INTO hr_employees VALUES (1,'t1','Paid Emp','active','monthly',0,8, '2026-01-01',NULL,false,0,false,'monthly',NULL,NULL,0,NULL,NULL,0);
      INSERT INTO hr_employees VALUES (2,'t1','Draft Emp','active','monthly',0,8, '2026-01-01',NULL,false,0,false,'monthly',NULL,NULL,0,NULL,NULL,0);
      INSERT INTO hr_employment_contracts VALUES (1,'t1',1,5000,'EGP','active','2026-01-01',NULL);
      INSERT INTO hr_employment_contracts VALUES (2,'t1',2,5000,'EGP','active','2026-01-01',NULL);
      INSERT INTO hr_payroll_runs VALUES (7,'t1','a1','2026-10','2026-10-01','2026-10-31','monthly','draft',NOW());
      INSERT INTO hr_payroll_run_items (id, tenant_id, account_id, run_id, employee_id, contract_id, base_salary, allowance_amount, deduction_amount, loan_deduction_amount, asset_recovery_deduction_amount, employee_social_insurance, employer_social_insurance, income_tax, penalty_deduction, carried_forward_deduction, gross_pay, net_pay, status, notes, paid_at, paid_by, payment_channel, journal_entry_id, updated_at)
        VALUES (1,'t1','a1',7,1,1,5000,0,0,0,0,0,0,0,0,0,5000,9999,'paid','',NOW(),1,'drawer',77,NOW());
      INSERT INTO hr_payroll_run_items (id, tenant_id, account_id, run_id, employee_id, contract_id, base_salary, allowance_amount, deduction_amount, loan_deduction_amount, asset_recovery_deduction_amount, employee_social_insurance, employer_social_insurance, income_tax, penalty_deduction, carried_forward_deduction, gross_pay, net_pay, status, notes, paid_at, paid_by, payment_channel, journal_entry_id, updated_at)
        VALUES (2,'t1','a1',7,2,2,0,0,0,0,0,0,0,0,0,0,0,0,'draft','',NULL,NULL,NULL,NULL,NOW());
    `);

    await (service as unknown as { rebuildPayrollRunItems: (db: unknown, runId: number, itemStatus: string, tenantId: string) => Promise<void> })
      .rebuildPayrollRunItems(db, 7, 'draft', 't1');

    const paid = await pg.query<{ net_pay: string; status: string; journal_entry_id: number }>(
      'SELECT net_pay::text, status, journal_entry_id FROM hr_payroll_run_items WHERE id=1',
    );
    assert.equal(Number(paid.rows[0].net_pay), 9999);
    assert.equal(paid.rows[0].status, 'paid');
    assert.equal(Number(paid.rows[0].journal_entry_id), 77);

    const draft = await pg.query<{ net_pay: string; status: string }>(
      'SELECT net_pay::text, status FROM hr_payroll_run_items WHERE id=2',
    );
    assert.equal(draft.rows[0].status, 'draft');
    assert.equal(Number(draft.rows[0].net_pay), 5000);

    console.log('Paid payroll items never rebuilt tests passed.');
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
