/*
 * INV-HR-LOANS-PAYROLL-SQL-PAGINATION: `listLoans` and `listPayrollRuns`
 * must fetch only the requested page from the database — never load the
 * whole tenant set and slice one page out of it in memory.
 *
 * THE BUG: both methods ran one unbounded SELECT, mapped the full set in
 * memory, then sliced one page with paginateRows(rows, query,
 * { defaultSize: 25 }) — maxSize defaults to 100, so a client asking
 * pageSize=150 silently received 100 rows.
 *
 * RULES PINNED HERE, driving the REAL HrService (facade) on PGlite:
 * 1. The page-size cap is 200: pageSize=150 returns 150 rows (the old
 *    code returned 100), pageSize=1000 returns 200 rows. Both methods.
 * 2. Only the requested page is returned, the old ORDER BY preserved
 *    (loans: id DESC; runs: period_month DESC, id DESC).
 * 3. The default page is 25 rows (defaultSize 25 preserved). Both methods.
 * 4. A page past the end clamps to the last page (page 99 -> last).
 * 5. LOANS — the post-paging queries (installments, repayments, due
 *    summary) already operate only on the paged loan ids and are
 *    UNCHANGED; the summary stays exact over the FULL filtered set:
 *    totalItems via COUNT with the same predicates, outstandingAmount =
 *    roundMoney(SQL SUM of remaining_amount, book digits) — the JS
 *    rounding stays in JS on the SQL sum. periodMonth affects ONLY the
 *    due summary, never the page or the summary totals.
 * 6. LOANS — installment remainingAmount keeps the JS rounding
 *    (roundMoney(amount - paidAmount, book digits)); repayment amounts
 *    stay absolute values; the latest-paid timestamp still comes from
 *    the MAX(paid_at) subquery.
 * 7. RUNS — the per-run aggregates were already in SQL (GROUP BY +
 *    SUMs); the COUNT is taken over the grouped set and the page reads
 *    the same grouped query with LIMIT/OFFSET. Excluded items
 *    (status 'excluded') count in NEITHER itemCount NOR the sums.
 *    serverTime/serverTimezone are kept (single-server-clock).
 *
 * Prospective only; PGlite only.
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

const AUTH = {
  userId: 1, sessionId: 'sess-spec', username: 'actor-1', role: 'admin',
  permissions: [], tenantId: 't1', accountId: 'a1',
} as unknown as AuthContext;

type Page = { page: number; pageSize: number; totalItems: number; totalPages: number };
type InstallmentRow = {
  id: string; loanId: string; installmentNumber: number; dueDate: string;
  amount: number; paidAmount: number; remainingAmount: number; status: string; paidAt: string;
};
type RepaymentRow = {
  id: string; loanId: string; entryType: string; amount: number; balanceAfter: number;
  repaymentMethod: string; note: string; createdAt: string;
  receivedById: string; receivedByUsername: string; receivedByName: string;
};
type LoanRow = {
  id: string; employeeId: string; employeeName: string; loanNo: string; loanType: string;
  principalAmount: number; paidAmount: number; remainingAmount: number;
  installmentCount: number; installmentAmount: number; repaymentMode: string;
  monthlyInstallmentAmount: number | null; status: string; issueDate: string;
  firstDueDate: string; salaryDueDate: string; createdAt: string; updatedAt: string;
  approvedAt: string; disbursedAt: string; paidAt: string;
  branchId: string; locationId: string; notes: string;
  dueInstallmentsAmount: number; dueInstallmentsCount: number;
  installments: InstallmentRow[]; repayments: RepaymentRow[];
};
type LoansResult = {
  loans: LoanRow[]; pagination: Page;
  summary: { totalItems: number; outstandingAmount: number };
};
type RunRow = {
  id: string; periodMonth: string; startDate: string; endDate: string;
  payFrequency: string; status: string; notes: string;
  createdBy: string; reviewedBy: string; approvedBy: string;
  createdAt: string; reviewedAt: string; approvedAt: string; updatedAt: string;
  itemCount: number; totalBaseSalary: number; totalAllowanceAmount: number;
  totalDeductionAmount: number; totalLoanDeductionAmount: number;
  totalAssetRecoveryDeductionAmount: number; totalEmployeeSocialInsurance: number;
  totalEmployerSocialInsurance: number; totalIncomeTax: number;
  totalPenaltyDeduction: number; totalCarriedForwardDeduction: number;
  totalGrossPay: number; totalNetPay: number;
};
type RunsResult = {
  runs: RunRow[]; pagination: Page; summary: { totalItems: number };
  serverTime: string; serverTimezone: string;
};

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const hr = new HrService(db, new TransactionHelper(), { log: async () => {} } as never, {} as never, {} as never, undefined);

  try {
    await pg.exec(`SET TIME ZONE 'UTC'`);
    await pg.exec(`
      CREATE TABLE settings (id bigserial PRIMARY KEY, tenant_id text, key text, value text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, employee_no text, display_name text, department_id bigint, job_title_id bigint, compensation_type text, hourly_rate numeric, expected_daily_hours numeric, delay_policy text, attendance_policy text, grace_minutes int, status text, scheduled_check_in_time text, scheduled_check_out_time text, overtime_policy text);
      CREATE TABLE hr_employee_loans (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, loan_no text, loan_type text, principal_amount numeric, paid_amount numeric, remaining_amount numeric, installment_count int, installment_amount numeric, repayment_mode text, monthly_installment_amount numeric, status text, issue_date date, first_due_date date, salary_due_date date, created_by bigint, notes text, created_at timestamptz, updated_at timestamptz, approved_at timestamptz, disbursed_at timestamptz, branch_id bigint, location_id bigint);
      CREATE TABLE hr_employee_loan_installments (id bigint PRIMARY KEY, tenant_id text, loan_id bigint, installment_no int, due_date date, amount numeric, paid_amount numeric, status text, paid_at timestamptz);
      CREATE TABLE hr_employee_ledger (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, reference_id bigint, reference_type text, entry_type text, amount numeric, balance_after numeric, repayment_method text, note text, created_by bigint, created_at timestamptz);
      CREATE TABLE hr_payroll_loan_deduction_allocations (id bigint PRIMARY KEY, loan_id bigint);
      CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, account_id text, period_month text, start_date date, end_date date, pay_frequency text, status text, notes text, created_by bigint, reviewed_by bigint, approved_by bigint, created_at timestamptz, reviewed_at timestamptz, approved_at timestamptz, updated_at timestamptz);
      CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, run_id bigint, tenant_id text, employee_id bigint, status text, base_salary numeric, allowance_amount numeric, deduction_amount numeric, loan_deduction_amount numeric, asset_recovery_deduction_amount numeric, employee_social_insurance numeric, employer_social_insurance numeric, income_tax numeric, penalty_deduction numeric, carried_forward_deduction numeric, gross_pay numeric, net_pay numeric);
      INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'timezone', 'UTC'), ('t1', 'currency', 'EGP');
      INSERT INTO users (id, tenant_id, display_name, username) VALUES (1, 't1', 'Admin User', 'admin');
      INSERT INTO hr_employees (id, tenant_id, employee_no, display_name, department_id, job_title_id, compensation_type, hourly_rate, expected_daily_hours, delay_policy, attendance_policy, grace_minutes, status, scheduled_check_in_time, scheduled_check_out_time, overtime_policy) VALUES
        (1, 't1', 'E001', 'Ahmed Ali', NULL, NULL, 'monthly', 0, NULL, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only'),
        (2, 't1', 'E002', 'Sara Ahmed', NULL, NULL, 'monthly', 0, NULL, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only');
      INSERT INTO hr_employee_loans (id, tenant_id, account_id, employee_id, loan_no, loan_type, principal_amount, paid_amount, remaining_amount, installment_count, installment_amount, repayment_mode, monthly_installment_amount, status, issue_date, first_due_date, salary_due_date, created_by, notes, created_at, updated_at, approved_at, disbursed_at, branch_id, location_id) VALUES
        (1, 't1', 'a1', 1, 'L001', 'loan', 1000.00, 600.00, 400.00, 10, 100.00, 'manual_cash', NULL, 'disbursed', '2026-01-10', NULL, NULL, 1, '', '2026-01-09 08:00:00+00', '2026-01-09 08:00:00+00', NULL, '2026-01-10 09:00:00+00', NULL, NULL),
        (2, 't1', 'a1', 1, 'L002', 'advance', 500.00, 500.00, 0.00, 5, 100.00, 'salary_deduction', NULL, 'paid', '2026-02-15', NULL, NULL, 1, '', '2026-02-14 08:00:00+00', '2026-02-14 08:00:00+00', NULL, '2026-02-15 10:00:00+00', NULL, NULL),
        (3, 't1', 'a1', 2, 'L003', 'loan', 800.00, 500.00, 300.00, 8, 100.00, 'monthly_salary_installment', 100.00, 'partially_repaid', '2026-03-20', '2026-04-01', NULL, 1, '', '2026-03-19 08:00:00+00', '2026-03-19 08:00:00+00', NULL, NULL, NULL, NULL),
        (4, 't1', 'a1', 2, 'L004', 'advance', 200.00, 200.00, 0.00, 2, 100.00, 'manual_cash', NULL, 'repaid', '2026-04-05', NULL, NULL, 1, '', '2026-04-04 08:00:00+00', '2026-04-04 08:00:00+00', NULL, '2026-04-05 11:00:00+00', NULL, NULL),
        (5, 't1', 'a1', 1, 'L005', 'loan', 999.00, 0.00, 999.00, 1, 999.00, 'manual_cash', NULL, 'draft', '2026-05-01', NULL, NULL, 1, '', '2026-05-01 08:00:00+00', '2026-05-01 08:00:00+00', NULL, NULL, NULL, NULL),
        (6, 't1', 'a1', 1, 'L006', 'loan', 100.50, 0.00, 100.50, 1, 100.50, 'manual_cash', NULL, 'disbursed', '2026-06-01', NULL, NULL, 1, '', '2026-06-01 08:00:00+00', '2026-06-01 08:00:00+00', NULL, NULL, NULL, NULL);
      INSERT INTO hr_employee_loans (id, tenant_id, account_id, employee_id, loan_no, loan_type, principal_amount, paid_amount, remaining_amount, installment_count, installment_amount, repayment_mode, monthly_installment_amount, status, issue_date, first_due_date, salary_due_date, created_by, notes, created_at, updated_at, approved_at, disbursed_at, branch_id, location_id)
        SELECT gs, 't1', 'a1', 1, 'F' || gs, 'loan', 10.00, 0.00, 10.00, 1, 10.00, 'manual_cash', NULL, 'disbursed', '2026-01-01', NULL, NULL, 1, '', '2026-01-01 08:00:00+00', '2026-01-01 08:00:00+00', NULL, '2026-01-01 09:00:00+00', NULL, NULL FROM generate_series(100, 339) AS gs;
      INSERT INTO hr_employee_loan_installments (id, tenant_id, loan_id, installment_no, due_date, amount, paid_amount, status, paid_at) VALUES
        (1, 't1', 1, 1, '2026-02-01', 100.00, 100.00, 'paid', '2026-02-01 10:00:00+00'),
        (2, 't1', 1, 2, '2026-03-01', 100.00, 0.00, 'pending', NULL),
        (3, 't1', 3, 1, '2026-04-01', 100.00, 50.00, 'partial', NULL);
      INSERT INTO hr_employee_ledger (id, tenant_id, account_id, employee_id, reference_id, reference_type, entry_type, amount, balance_after, repayment_method, note, created_by, created_at) VALUES
        (1, 't1', 'a1', 1, 1, 'hr_employee_loan', 'loan_repayment', -150.00, 250.00, 'manual_cash', 'cash', 1, '2026-02-01 10:00:00+00'),
        (2, 't1', 'a1', 1, 1, 'hr_employee_loan', 'loan_repayment', 80.00, 170.00, 'salary_deduction', '', 1, '2026-02-02 11:00:00+00'),
        (3, 't1', 'a1', 1, 2, 'hr_employee_loan', 'loan_disbursement', 500.00, 500.00, 'manual_cash', '', 1, '2026-02-15 10:00:00+00'),
        (4, 't1', 'a1', 2, 3, 'hr_employee_loan', 'loan_repayment', 25.50, 274.50, 'manual_cash', '', 1, '2026-03-01 09:30:00+00');
      INSERT INTO hr_payroll_runs (id, tenant_id, account_id, period_month, start_date, end_date, pay_frequency, status, notes, created_by, reviewed_by, approved_by, created_at, reviewed_at, approved_at, updated_at) VALUES
        (1, 't1', 'a1', '2026-11', '2026-11-01', '2026-11-30', 'monthly', 'draft', '', 1, NULL, NULL, '2026-11-20 10:00:00+00', NULL, NULL, '2026-11-20 10:00:00+00'),
        (2, 't1', 'a1', '2026-10', '2026-10-01', '2026-10-31', 'monthly', 'approved', '', 1, 1, 1, '2026-10-20 10:00:00+00', '2026-10-21 10:00:00+00', '2026-10-22 10:00:00+00', '2026-10-22 10:00:00+00'),
        (3, 't1', 'a1', '2026-10', '2026-10-01', '2026-10-31', 'monthly', 'paid', '', 1, 1, 1, '2026-10-19 10:00:00+00', '2026-10-20 10:00:00+00', '2026-10-21 10:00:00+00', '2026-10-21 10:00:00+00'),
        (4, 't1', 'a1', '2026-09', '2026-09-01', '2026-09-30', 'monthly', 'draft', '', 1, NULL, NULL, '2026-09-20 10:00:00+00', NULL, NULL, '2026-09-20 10:00:00+00'),
        (5, 't1', 'a1', '2026-08', '2026-08-01', '2026-08-31', 'monthly', 'draft', '', 1, NULL, NULL, '2026-08-20 10:00:00+00', NULL, NULL, '2026-08-20 10:00:00+00'),
        (6, 't1', 'a1', '2026-11', '2026-11-01', '2026-11-30', 'monthly', 'draft', '', 1, NULL, NULL, '2026-11-21 10:00:00+00', NULL, NULL, '2026-11-21 10:00:00+00');
      INSERT INTO hr_payroll_runs (id, tenant_id, account_id, period_month, start_date, end_date, pay_frequency, status, notes, created_by, reviewed_by, approved_by, created_at, reviewed_at, approved_at, updated_at)
        SELECT gs, 't1', 'a1', '2025-06', '2025-06-01', '2025-06-30', 'monthly', 'draft', '', 1, NULL, NULL, '2025-06-20 10:00:00+00', NULL, NULL, '2025-06-20 10:00:00+00' FROM generate_series(100, 219) AS gs;
      INSERT INTO hr_payroll_run_items (id, run_id, tenant_id, employee_id, status, base_salary, allowance_amount, deduction_amount, loan_deduction_amount, asset_recovery_deduction_amount, employee_social_insurance, employer_social_insurance, income_tax, penalty_deduction, carried_forward_deduction, gross_pay, net_pay) VALUES
        (1, 1, 't1', 1, 'approved', 3000.00, 500.00, 100.00, 0, 0, 0, 0, 0, 0, 0, 3400.00, 3300.00),
        (2, 1, 't1', 2, 'approved', 2000.00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2000.00, 2000.00),
        (3, 1, 't1', 1, 'excluded', 9999.00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9999.00, 9999.00),
        (4, 2, 't1', 1, 'approved', 3000.00, 0, 100.00, 50.00, 0, 0, 0, 0, 0, 0, 3000.00, 2900.00),
        (5, 3, 't1', 2, 'approved', 2000.00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2000.00, 2000.00),
        (6, 4, 't1', 1, 'approved', 3000.00, 0, 0, 0, 0, 0, 0, 0, 25.00, 0, 3000.00, 3000.00),
        (7, 6, 't1', 1, 'approved', 3000.00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3000.00, 3000.00);
    `);

    // ---------------- LOANS: 246 loans, outstanding 1799.50 + 240*10 = 4199.50 ----------------
    const def = await hr.listLoans({}, AUTH) as unknown as LoansResult;
    assert.equal(def.loans.length, 25, 'loans default page is 25 rows');
    assert.equal(def.pagination.totalItems, 246, 'loans totalItems is the FULL set');
    assert.equal(def.pagination.totalPages, 10, 'loans totalPages = ceil(246/25)');
    assert.equal(def.pagination.page, 1);
    assert.equal(def.pagination.pageSize, 25);
    assert.equal(def.summary.totalItems, 246, 'loans summary totalItems is the FULL set');
    assert.equal(def.summary.outstandingAmount, 4199.50, 'loans summary outstanding is exact over the FULL set');
    assert.equal(def.loans[0].id, '339', 'loans order is id DESC');
    assert.equal(def.loans[24].id, '315', 'loans default page ends at id 315');

    const cap150 = await hr.listLoans({ pageSize: 150 }, AUTH) as unknown as LoansResult;
    assert.equal(cap150.loans.length, 150, 'loans pageSize=150 returns 150 rows (old code: 100)');
    assert.equal(cap150.pagination.pageSize, 150);
    assert.equal(cap150.pagination.totalPages, 2);
    assert.equal(cap150.loans[149].id, '190', 'loans page 1 of 150 ends at id 190');
    assert.equal(cap150.summary.outstandingAmount, 4199.50, 'loans summary stays exact on a 150 page');

    const cap1000 = await hr.listLoans({ pageSize: 1000 }, AUTH) as unknown as LoansResult;
    assert.equal(cap1000.loans.length, 200, 'loans pageSize=1000 caps at 200 rows');
    assert.equal(cap1000.pagination.pageSize, 200);

    const page2 = await hr.listLoans({ page: 2, pageSize: 200 }, AUTH) as unknown as LoansResult;
    assert.equal(page2.loans.length, 46, 'loans page 2 of 200 has the remaining 46 rows');
    assert.equal(page2.loans[0].id, '139', 'loans page 2 of 200 starts at id 139');
    assert.equal(page2.loans[45].id, '1', 'loans page 2 of 200 ends at id 1');
    assert.equal(page2.summary.totalItems, 246, 'loans summary stays exact on page 2');

    const clamp = await hr.listLoans({ page: 99 }, AUTH) as unknown as LoansResult;
    assert.equal(clamp.pagination.page, 10, 'loans page 99 clamps to the last page');
    assert.equal(clamp.loans.length, 21, 'loans last page has 21 rows');
    assert.equal(clamp.loans[0].id, '114', 'loans last page starts at id 114');

    const e2 = await hr.listLoans({ employeeId: 2 }, AUTH) as unknown as LoansResult;
    assert.deepEqual(e2.loans.map((r) => r.id), ['4', '3'], 'loans employeeId=2 returns only her 2 loans');
    assert.equal(e2.summary.totalItems, 2, 'loans summary follows the employee filter');
    assert.equal(e2.summary.outstandingAmount, 300, 'loans e2 outstanding is 300 + 0');

    const e1 = await hr.listLoans({ employeeId: 1 }, AUTH) as unknown as LoansResult;
    assert.equal(e1.summary.totalItems, 244, 'loans employeeId=1 has 244 loans');
    assert.equal(e1.summary.outstandingAmount, 3899.50, 'loans e1 outstanding is 4199.50 - 300');

    // L1 detail: the LAST row of e1's page 2 (200). Installments, repayments
    // and the latest-paid timestamp all come from the post-paging queries.
    const e1p2 = await hr.listLoans({ employeeId: 1, page: 2, pageSize: 200 }, AUTH) as unknown as LoansResult;
    assert.equal(e1p2.loans.length, 44, 'loans e1 page 2 of 200 has 44 rows');
    const l6 = e1p2.loans[40];
    assert.equal(l6.id, '6', 'loans e1 page 2 row 40 is L006');
    assert.equal(l6.remainingAmount, 100.5, 'loans L006 remaining keeps the .50');
    assert.equal(l6.principalAmount, 100.5);
    assert.equal(l6.loanType, 'loan');
    assert.equal(l6.repaymentMode, 'manual_cash');
    assert.equal(l6.issueDate, '2026-06-01');
    const l1 = e1p2.loans[43];
    assert.equal(l1.id, '1', 'loans e1 page 2 last row is L001');
    assert.equal(l1.employeeName, 'Ahmed Ali');
    assert.equal(l1.loanNo, 'L001');
    assert.equal(l1.remainingAmount, 400);
    assert.equal(l1.paidAt, '2026-02-01 10:00', 'loans L001 latest paid timestamp from MAX(paid_at)');
    assert.equal(l1.installments.length, 2, 'loans L001 has 2 installments');
    assert.equal(l1.installments[0].installmentNumber, 1);
    assert.equal(l1.installments[0].remainingAmount, 0, 'loans paid installment remaining is 0');
    assert.equal(l1.installments[0].paidAt, '2026-02-01 10:00');
    assert.equal(l1.installments[1].installmentNumber, 2);
    assert.equal(l1.installments[1].remainingAmount, 100, 'loans pending installment remaining is the full amount');
    assert.equal(l1.installments[1].status, 'pending');
    assert.equal(l1.repayments.length, 2, 'loans L001 has 2 ledger rows');
    assert.equal(l1.repayments[0].amount, 80, 'loans repayments are id DESC, absolute values');
    assert.equal(l1.repayments[0].repaymentMethod, 'salary_deduction');
    assert.equal(l1.repayments[1].amount, 150, 'loans the -150 repayment reads as 150');
    assert.equal(l1.repayments[1].repaymentMethod, 'manual_cash');
    assert.equal(l1.repayments[1].receivedByName, 'Admin User');
    assert.equal(l1.repayments[1].receivedById, '1');
    assert.equal(l1.dueInstallmentsCount, 0, 'loans no month -> no due summary');
    assert.equal(l1.dueInstallmentsAmount, 0);

    // L3 detail: month 2026-04, e2 only. periodMonth affects ONLY the due
    // summary — never the page or the summary totals.
    const apr = await hr.listLoans({ employeeId: 2, month: '2026-04' }, AUTH) as unknown as LoansResult;
    assert.deepEqual(apr.loans.map((r) => r.id), ['4', '3'], 'loans month filter does not change the page');
    assert.equal(apr.summary.totalItems, 2, 'loans month filter does not change the summary');
    assert.equal(apr.summary.outstandingAmount, 300, 'loans month filter does not change outstanding');
    const l3 = apr.loans[1];
    assert.equal(l3.id, '3', 'loans April page row 1 is L003');
    assert.equal(l3.dueInstallmentsCount, 1, 'loans L003 has 1 installment due in April');
    assert.equal(l3.dueInstallmentsAmount, 50, 'loans L003 due amount is 100 - 50 paid');
    assert.equal(l3.installments.length, 1);
    assert.equal(l3.installments[0].remainingAmount, 50, 'loans partial installment remaining is 100 - 50');
    assert.equal(l3.repayments.length, 1);
    assert.equal(l3.repayments[0].amount, 25.5, 'loans L003 repayment 25.50');
    const l3NoMonth = e2.loans[1];
    assert.equal(l3NoMonth.id, '3');
    assert.equal(l3NoMonth.dueInstallmentsCount, 0, 'loans without month -> L003 due summary is 0');
    assert.equal(l3NoMonth.dueInstallmentsAmount, 0);

    // ---------------- RUNS: 126 runs, order period_month DESC, id DESC ----------------
    const runsDef = await hr.listPayrollRuns({}, AUTH) as unknown as RunsResult;
    assert.equal(runsDef.runs.length, 25, 'runs default page is 25 rows');
    assert.equal(runsDef.pagination.totalItems, 126, 'runs totalItems is the FULL set');
    assert.equal(runsDef.pagination.totalPages, 6, 'runs totalPages = ceil(126/25)');
    assert.equal(runsDef.pagination.page, 1);
    assert.equal(runsDef.pagination.pageSize, 25);
    assert.equal(runsDef.summary.totalItems, 126, 'runs summary totalItems is the FULL set');
    assert.equal(runsDef.serverTimezone, 'UTC', 'runs serverTimezone comes from the tenant');
    assert.ok(typeof runsDef.serverTime === 'string' && runsDef.serverTime.length > 0, 'runs serverTime is present');
    assert.deepEqual(
      runsDef.runs.slice(0, 6).map((r) => r.id),
      ['6', '1', '3', '2', '4', '5'],
      'runs order is period_month DESC, id DESC',
    );
    const r6 = runsDef.runs[0];
    assert.equal(r6.periodMonth, '2026-11');
    assert.equal(r6.itemCount, 1);
    assert.equal(r6.totalBaseSalary, 3000);
    assert.equal(r6.totalNetPay, 3000);
    const r1 = runsDef.runs[1];
    assert.equal(r1.periodMonth, '2026-11');
    assert.equal(r1.itemCount, 2, 'runs the excluded item counts in NEITHER itemCount NOR the sums');
    assert.equal(r1.totalBaseSalary, 5000, 'runs R1 base = 3000 + 2000 (excluded 9999 not counted)');
    assert.equal(r1.totalAllowanceAmount, 500);
    assert.equal(r1.totalDeductionAmount, 100);
    assert.equal(r1.totalGrossPay, 5400);
    assert.equal(r1.totalNetPay, 5300);
    const r2 = runsDef.runs[3];
    assert.equal(r2.periodMonth, '2026-10');
    assert.equal(r2.status, 'approved');
    assert.equal(r2.totalLoanDeductionAmount, 50);
    assert.equal(r2.totalNetPay, 2900);
    const r4 = runsDef.runs[4];
    assert.equal(r4.periodMonth, '2026-09');
    assert.equal(r4.totalPenaltyDeduction, 25);
    const r5 = runsDef.runs[5];
    assert.equal(r5.periodMonth, '2026-08');
    assert.equal(r5.itemCount, 0, 'runs a run with no items has itemCount 0');
    assert.equal(r5.totalBaseSalary, 0);
    assert.equal(r5.totalNetPay, 0);
    assert.equal(runsDef.runs[6].id, '219', 'runs first filler after the named runs is 219');
    assert.equal(runsDef.runs[24].id, '201', 'runs default page ends at id 201');

    const runs150 = await hr.listPayrollRuns({ pageSize: 150 }, AUTH) as unknown as RunsResult;
    assert.equal(runs150.runs.length, 126, 'runs pageSize=150 returns all 126 runs (old code: 100)');
    assert.equal(runs150.pagination.totalPages, 1);

    const runs1000 = await hr.listPayrollRuns({ pageSize: 1000 }, AUTH) as unknown as RunsResult;
    assert.equal(runs1000.runs.length, 126, 'runs pageSize=1000 returns all 126 runs');
    assert.equal(runs1000.pagination.pageSize, 200, 'runs pageSize=1000 caps at 200');

    const oct = await hr.listPayrollRuns({ month: '2026-10' }, AUTH) as unknown as RunsResult;
    assert.deepEqual(oct.runs.map((r) => r.id), ['3', '2'], 'runs month 2026-10 returns only its 2 runs');
    assert.equal(oct.summary.totalItems, 2, 'runs summary follows the month filter');

    const nov = await hr.listPayrollRuns({ month: '2026-11' }, AUTH) as unknown as RunsResult;
    assert.deepEqual(nov.runs.map((r) => r.id), ['6', '1'], 'runs month 2026-11 returns only its 2 runs');

    const none = await hr.listPayrollRuns({ month: '2020-01' }, AUTH) as unknown as RunsResult;
    assert.equal(none.runs.length, 0, 'runs an empty month has no rows');
    assert.equal(none.summary.totalItems, 0);
    assert.equal(none.pagination.totalPages, 1, 'runs an empty month has totalPages 1');

    const runsClamp = await hr.listPayrollRuns({ page: 99 }, AUTH) as unknown as RunsResult;
    assert.equal(runsClamp.pagination.page, 6, 'runs page 99 clamps to the last page');
    assert.equal(runsClamp.runs.length, 1, 'runs last page has 1 row');
    assert.equal(runsClamp.runs[0].id, '100', 'runs last page row is id 100');

    console.log('hr-loans-payroll-sql-pagination: ok');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
