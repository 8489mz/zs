/*
 * INV-HR-WITHDRAWALS-SQL-PAGINATION: `withdrawals` must fetch only the
 * requested page from the database — never merge two unbounded queries
 * in memory and slice one page out of them.
 *
 * THE BUG: withdrawals ran TWO unbounded SELECTs (all loans + all ledger
 * repayments for one employee), merged them in memory, applied the
 * status filter, the period filter and the sort in memory, reduced 7
 * money sums over the full merged set, then sliced one page with
 * paginateRows(rows, query, { defaultSize: 50 }) — maxSize defaults to
 * 100, so a client asking pageSize=150 silently received 100 rows, and
 * every request paid for the employee's whole loan history.
 *
 * RULES PINNED HERE, driving the REAL HrService (facade) on PGlite:
 * 1. The page-size cap is 200: pageSize=150 returns 150 rows (the old
 *    code returned 100), pageSize=1000 returns 200 rows.
 * 2. Only the requested page is returned, ORDER BY movementAt DESC,
 *    id DESC preserved (filler loans share one movementAt, so the id
 *    tie-break is pinned too).
 * 3. The default page is 50 rows (defaultSize 50 preserved).
 * 4. A page past the end clamps to the last page (page 99 -> 5).
 * 5. The 4 period-filtered sums stay exact over the FULL filtered set:
 *    totalWithdrawals / totalRepayments / totalManualCashRepayments /
 *    totalSalaryDeductionRepayments.
 * 6. The 3 loan-set sums stay exact over the UNFILTERED loan set
 *    (never period-filtered): totalRemaining / totalSalaryDeductionDue /
 *    openLoanCount — pinned by a custom range that excludes loans from
 *    the page while the sums still count them.
 * 7. The movement-date rule is preserved exactly: paid-branch statuses
 *    (paid/disbursed/partially_repaid/repaid) use disbursedAt, then
 *    createdAt, then issueDate; other statuses use issueDate, then
 *    createdAt. Draft/approved loans never appear; a `repaid` loan
 *    appears in the rows but never in the remaining sums.
 * 8. Ledger rows of another entry_type, or of another employee, never
 *    appear; repayment amounts are absolute values.
 *
 * Session timezone is pinned to UTC so the to_char() movement times
 * are deterministic (production renders them in the server timezone).
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
  userId: 1,
  sessionId: 'sess-spec',
  username: 'actor-1',
  role: 'admin',
  permissions: [],
  tenantId: 't1',
  accountId: 'a1',
} as unknown as AuthContext;

type WithdrawalRow = {
  id: string;
  type: string;
  amount: number;
  movementAt: string;
  status: string;
};

type WithdrawalsResult = {
  rows: WithdrawalRow[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: {
    employeeId: string;
    employeeName: string;
    from: string;
    to: string;
    totalWithdrawals: number;
    totalRepayments: number;
    totalManualCashRepayments: number;
    totalSalaryDeductionRepayments: number;
    totalSalaryDeductionDue: number;
    totalRemaining: number;
    openLoanCount: number;
  };
};

async function list(
  hr: HrService,
  query: Record<string, unknown>,
  auth: AuthContext,
): Promise<WithdrawalsResult> {
  return (await hr.withdrawals(query, auth)) as unknown as WithdrawalsResult;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const hr = new HrService(db, new TransactionHelper(), { log: async () => {} } as never, {} as never, {} as never, undefined);

  try {
    await pg.exec(`SET TIME ZONE 'UTC'`);
    await pg.exec(`
      CREATE TABLE settings (id bigserial PRIMARY KEY, tenant_id text, key text, value text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, display_name text, hire_date date);
      CREATE TABLE hr_employee_loans (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, loan_no text, loan_type text, principal_amount numeric, paid_amount numeric, remaining_amount numeric, installment_count int, installment_amount numeric, repayment_mode text, monthly_installment_amount numeric, status text, issue_date date, first_due_date date, salary_due_date date, created_by bigint, notes text, created_at timestamptz, updated_at timestamptz, approved_at timestamptz, disbursed_at timestamptz, branch_id bigint, location_id bigint);
      CREATE TABLE hr_employee_ledger (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, reference_id bigint, reference_type text, entry_type text, amount numeric, balance_after numeric, repayment_method text, note text, created_by bigint, created_at timestamptz);
      CREATE TABLE hr_employee_loan_installments (id bigint PRIMARY KEY, tenant_id text, loan_id bigint, paid_at timestamptz);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, display_name text, username text);
      INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'timezone', 'Africa/Cairo');
      INSERT INTO hr_employees (id, tenant_id, display_name, hire_date) VALUES
        (1, 't1', 'Test Employee', '2020-01-01'),
        (2, 't1', 'Other Employee', '2020-01-01');
      INSERT INTO users (id, tenant_id, display_name, username) VALUES (1, 't1', 'Admin User', 'admin');
      INSERT INTO hr_employee_loans (id, tenant_id, account_id, employee_id, loan_no, loan_type, principal_amount, paid_amount, remaining_amount, installment_count, installment_amount, repayment_mode, monthly_installment_amount, status, issue_date, created_by, notes, created_at, updated_at, disbursed_at) VALUES
        (1, 't1', 'a1', 1, 'L001', 'loan', 1000.00, 600.00, 400.00, 10, 100.00, 'manual_cash', NULL, 'disbursed', '2026-01-10', 1, '', '2026-01-09 08:00:00+00', '2026-01-09 08:00:00+00', '2026-01-10 09:00:00+00'),
        (2, 't1', 'a1', 1, 'L002', 'advance', 500.00, 500.00, 0.00, 5, 100.00, 'salary_deduction', NULL, 'paid', '2026-02-15', 1, '', '2026-02-14 08:00:00+00', '2026-02-14 08:00:00+00', '2026-02-15 10:00:00+00'),
        (3, 't1', 'a1', 1, 'L003', 'loan', 800.00, 500.00, 300.00, 8, 100.00, 'monthly_salary_installment', 100.00, 'partially_repaid', '2026-03-20', 1, '', '2026-03-19 08:00:00+00', '2026-03-19 08:00:00+00', NULL),
        (4, 't1', 'a1', 1, 'L004', 'advance', 200.00, 200.00, 0.00, 2, 100.00, 'manual_cash', NULL, 'repaid', '2026-04-05', 1, '', '2026-04-04 08:00:00+00', '2026-04-04 08:00:00+00', '2026-04-05 11:00:00+00'),
        (5, 't1', 'a1', 1, 'L005', 'loan', 999.00, 0.00, 999.00, 1, 999.00, 'manual_cash', NULL, 'draft', '2026-05-01', 1, '', '2026-05-01 08:00:00+00', '2026-05-01 08:00:00+00', NULL),
        (6, 't1', 'a1', 1, 'L006', 'loan', 100.00, 0.00, 100.00, 1, 100.00, 'manual_cash', NULL, 'disbursed', NULL, 1, '', '2026-06-01 08:00:00+00', '2026-06-01 08:00:00+00', NULL),
        (7, 't1', 'a1', 1, 'L007', 'loan', 50.00, 0.00, 50.00, 1, 50.00, 'manual_cash', NULL, 'disbursed', '2026-07-01', 1, '', '2026-06-30 08:00:00+00', '2026-06-30 08:00:00+00', NULL),
        (8, 't1', 'a1', 1, 'L008', 'loan', 70.00, 0.00, 70.00, 1, 70.00, 'manual_cash', NULL, 'approved', '2026-08-01', 1, '', '2026-08-01 08:00:00+00', '2026-08-01 08:00:00+00', NULL);
      INSERT INTO hr_employee_loans (id, tenant_id, account_id, employee_id, loan_no, loan_type, principal_amount, paid_amount, remaining_amount, installment_count, installment_amount, repayment_mode, monthly_installment_amount, status, issue_date, created_by, notes, created_at, updated_at, disbursed_at)
        SELECT gs, 't1', 'a1', 1, 'F' || gs, 'loan', 10.00, 0.00, 10.00, 1, 10.00, 'manual_cash', NULL, 'disbursed', '2026-01-01', 1, '', '2026-01-01 08:00:00+00', '2026-01-01 08:00:00+00', '2026-01-01 09:00:00+00' FROM generate_series(11, 250) AS gs;
      INSERT INTO hr_employee_ledger (id, tenant_id, account_id, employee_id, reference_id, reference_type, entry_type, amount, balance_after, repayment_method, note, created_by, created_at) VALUES
        (1, 't1', 'a1', 1, 1, 'hr_employee_loan', 'loan_repayment', -150.00, 250.00, 'manual_cash', 'cash', 1, '2026-02-01 10:00:00+00'),
        (2, 't1', 'a1', 1, 1, 'hr_employee_loan', 'loan_repayment', 80.00, 170.00, 'salary_deduction', '', 1, '2026-02-02 11:00:00+00'),
        (3, 't1', 'a1', 1, 2, 'hr_employee_loan', 'loan_repayment', 25.50, 144.50, 'manual_cash', '', 1, '2026-03-01 09:30:00+00'),
        (4, 't1', 'a1', 1, 1, 'hr_employee_loan', 'loan_disbursement', 999.00, 999.00, 'manual_cash', '', 1, '2026-03-05 10:00:00+00'),
        (5, 't1', 'a1', 2, 1, 'hr_employee_loan', 'loan_repayment', 777.00, 777.00, 'manual_cash', '', 1, '2026-03-06 10:00:00+00');
    `);

    // 249 merged rows: 6 named loans in the rows set + 240 fillers + 3 repayments.
    // (draft loan-5, approved loan-8, ledger-4 wrong entry_type, ledger-5 other employee.)
    const all = { employeeId: 1, period: 'all' };

    // 1. The old 100 cap is gone: pageSize=150 must return 150 rows.
    const p150 = await list(hr, { ...all, pageSize: 150 }, AUTH);
    assert.equal(p150.rows.length, 150, 'pageSize=150 must return 150 rows');
    assert.equal(p150.pagination.pageSize, 150, 'pageSize must stay 150');
    assert.equal(p150.pagination.totalItems, 249, 'totalItems must count the full merged set');
    assert.equal(p150.pagination.totalPages, 2, 'totalPages must be ceil(249 / 150)');
    assert.equal(p150.rows[0].id, 'loan-7', 'page 1 must start at loan-7 (latest movementAt)');
    assert.equal(p150.rows[0].movementAt, '2026-06-30 08:00', 'loan-7 movementAt is createdAt (paid branch prefers created over issue)');
    assert.equal(p150.rows[149].id, 'loan-190', 'page 1 of 150 must end at loan-190 (id tie-break DESC, lexicographic)');

    // 1b. The 200 cap: pageSize=1000 returns 200 rows.
    const capped = await list(hr, { ...all, pageSize: 1000 }, AUTH);
    assert.equal(capped.rows.length, 200, 'pageSize=1000 must return at most 200 rows');
    assert.equal(capped.pagination.pageSize, 200, 'pageSize must clamp to 200');
    assert.equal(capped.pagination.totalItems, 249, 'capped totalItems must count the full merged set');

    // 2. Page 2 of 200 holds the remaining 49 rows, same order.
    const page2 = await list(hr, { ...all, page: 2, pageSize: 200 }, AUTH);
    assert.equal(page2.rows.length, 49, 'page 2 of 200 must hold the remaining 49 rows');
    assert.equal(page2.rows[0].id, 'loan-144', 'page 2 must start at loan-144');
    assert.equal(page2.rows[48].id, 'loan-100', 'page 2 must end at loan-100');

    // 3. The default page is 50 rows (defaultSize 50 preserved).
    const def = await list(hr, { ...all }, AUTH);
    assert.equal(def.rows.length, 50, 'default pageSize must be 50');
    assert.equal(def.pagination.page, 1, 'default page must be 1');
    assert.equal(def.pagination.totalPages, 5, 'default totalPages must be ceil(249 / 50)');
    assert.equal(def.rows[9].id, 'loan-99', 'default page 1 filler run must start at loan-99 (lexicographic DESC)');
    assert.equal(def.rows[49].id, 'loan-59', 'default page 1 must end at loan-59');

    // 4. A page past the end clamps to the last page.
    const clamped = await list(hr, { ...all, page: 99, pageSize: 50 }, AUTH);
    assert.equal(clamped.pagination.page, 5, 'page 99 must clamp to the last page 5');
    assert.equal(clamped.rows.length, 49, 'clamped last page must hold 49 rows');
    assert.equal(clamped.rows[0].id, 'loan-144', 'clamped last page must start at loan-144');

    // 5. The 4 period-filtered sums stay exact over the full filtered set.
    assert.equal(def.summary.totalWithdrawals, 5050, 'totalWithdrawals must be 5050 (2650 named + 2400 filler)');
    assert.equal(def.summary.totalRepayments, 255.5, 'totalRepayments must be 255.50');
    assert.equal(def.summary.totalManualCashRepayments, 175.5, 'totalManualCashRepayments must be 175.50');
    assert.equal(def.summary.totalSalaryDeductionRepayments, 80, 'totalSalaryDeductionRepayments must be 80');
    assert.equal(def.summary.employeeId, '1', 'summary employeeId must be 1');
    assert.equal(def.summary.employeeName, 'Test Employee', 'summary employeeName must match');
    assert.equal(def.summary.from, '', 'period all must report an empty from');
    assert.equal(def.summary.to, '', 'period all must report an empty to');

    // 6. The 3 loan-set sums are NOT period-filtered — pinned by a custom
    // range that excludes most loans from the page.
    const ranged = await list(hr, { employeeId: 1, period: 'custom', from: '2026-02-01', to: '2026-03-31' }, AUTH);
    assert.equal(ranged.rows.length, 5, 'custom range must hold exactly 5 rows');
    assert.deepEqual(
      ranged.rows.map((row) => row.id),
      ['loan-3', 'ledger-3', 'loan-2', 'ledger-2', 'ledger-1'],
      'custom range rows must be the Feb-Mar movements in order',
    );
    assert.equal(ranged.summary.totalWithdrawals, 1300, 'ranged totalWithdrawals must be 1300 (loan-3 + loan-2)');
    assert.equal(ranged.summary.totalRepayments, 255.5, 'ranged totalRepayments must still be 255.50');
    assert.equal(ranged.summary.totalRemaining, 3250, 'totalRemaining must still count the whole loan set (3250)');
    assert.equal(ranged.summary.totalSalaryDeductionDue, 300, 'totalSalaryDeductionDue must still be 300');
    assert.equal(ranged.summary.openLoanCount, 244, 'openLoanCount must still be 244');
    assert.equal(ranged.summary.from, '2026-02-01', 'custom range must report from');
    assert.equal(ranged.summary.to, '2026-03-31', 'custom range must report to');

    // 7. The repaid loan is in the rows but never in the remaining sums;
    // the draft and approved loans never appear at all.
    const allIds = [...def.rows, ...page2.rows].map((row) => row.id);
    assert.ok(allIds.includes('loan-4'), 'repaid loan-4 must appear in the rows');
    assert.ok(!allIds.includes('loan-5'), 'draft loan-5 must never appear');
    assert.ok(!allIds.includes('loan-8'), 'approved loan-8 must never appear');
    assert.ok(!allIds.includes('ledger-4'), 'ledger-4 (wrong entry_type) must never appear');
    assert.ok(!allIds.includes('ledger-5'), 'ledger-5 (other employee) must never appear');

    // 8. Repayment amounts are absolute values.
    const ledger1 = def.rows.find((row) => row.id === 'ledger-1');
    assert.equal(ledger1?.amount, 150, 'ledger-1 amount must be the absolute value 150');
    assert.equal(ledger1?.type, 'repayment', 'ledger-1 type must be repayment');

    console.log('HR advances withdrawals SQL pagination tests passed.');
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
