import { E2EClient } from './e2e-utils';
import { Client } from 'pg';

let pg: Client;
let admin: E2EClient;

const logResult = (id: string, status: string, expected: string, actual: string, error?: any) => {
  console.log('\n================================');
  console.log(`Test ID: ${id}`);
  console.log(`Expected: ${expected}`);
  console.log(`Actual: ${actual}`);
  console.log(`Status: ${status}`);
  if (error) console.log(`Error/Details:`, error);
  console.log('================================\n');
};

async function main() {
  console.log('MAIN EXECUTING');
  admin = new E2EClient(process.env.API_URL || process.env.E2E_BASE_URL || 'http://127.0.0.1:3101');
  const testAdminPassword = process.env.TEST_ADMIN_PASSWORD || 'secret';
  await admin.login('zs', testAdminPassword);

  const pgPort = process.env.PG_PORT || '5433';
  const pgDb = process.env.PG_DB || 'zs_dev';
  pg = new Client({
    connectionString: process.env.DATABASE_URL || `postgres://postgres:postgres@127.0.0.1:${pgPort}/${pgDb}`,
  });
  await pg.connect();

  console.log('--- Setting up Test Data ---');

  const createEmp = async () => {
    const empCode = String(Math.floor(Math.random() * 900000) + 100000);
    const empRes = await admin.post('/api/hr/employees', {
      firstName: 'Test',
      lastName: 'LoanDeduction',
      employeeNo: empCode,
      nationalId: Date.now().toString() + '1',
      status: 'active',
      hireDate: '2026-01-01',
      departmentId: 1,
      jobTitleId: 1,
      compensationType: 'monthly',
    });
    return (empRes as any)?.id || (empRes as any)?.employees?.[0]?.id;
  };

  const createLoan = async (empId: number, mode: string, amount: number, installments: number) => {
    const res = await admin.post('/api/hr/loans', {
      employeeId: empId,
      principalAmount: amount,
      installmentCount: installments,
      issueDate: '2026-01-01',
      firstDueDate: '2026-02-01',
      loanType: 'loan',
      repaymentMode: mode,
    });
    const id = (res as any)?.id || (res as any)?.loans?.[0]?.id;
    await admin.post(`/api/hr/loans/${id}/approve`, {});
    await admin.post(`/api/hr/loans/${id}/disburse`, { paymentChannel: 'cash' });
    return id;
  };

  // unique suffix to avoid HR_PAYROLL_REVIEW_LOCKED (can't re-review same period)
  const rnd = () => 2100 + Math.floor(Math.random() * 800);
  const genPeriod = () => `${rnd()}-${String(Math.floor(Math.random() * 12 + 1)).padStart(2, '0')}`;

  try {
    // ── PAY_LOAN_NEXT_1 ──────────────────────────────────────────
    const emp1 = await createEmp();
    const loanNextId = await createLoan(emp1, 'deduct_next_salary', 1000, 1);

    const run1Res = await admin.post('/api/hr/payroll-runs', { periodMonth: genPeriod() });
    const run1Id = (run1Res as any)?.run?.id || (run1Res as any)?.id;
    await admin.post(`/api/hr/payroll-runs/${run1Id}/review`, {});
    await pg.query(
      `UPDATE hr_payroll_run_items SET loan_deduction_amount = 1000 WHERE run_id = $1 AND employee_id = $2`,
      [run1Id, emp1],
    );
    await admin.post(`/api/hr/payroll-runs/${run1Id}/approve`, {});

    const loanNextCheck = await pg.query(`SELECT status, remaining_amount FROM hr_employee_loans WHERE id = $1`, [
      loanNextId,
    ]);
    const allocCheck1 = await pg.query(
      `SELECT count(*) as c FROM hr_payroll_loan_deduction_allocations WHERE payroll_run_id = $1`,
      [run1Id],
    );
    const ledgerCheck1 = await pg.query(
      `SELECT count(*) as c FROM hr_employee_ledger WHERE reference_type = 'hr_payroll_loan_deduction' AND employee_id = $1`,
      [emp1],
    );
    const treasuryCheck1 = await pg.query(
      `SELECT count(*) as c FROM treasury_transactions WHERE reference_type = 'hr_payroll_loan_deduction'`,
    );
    const journalCheck1 = await pg.query(
      `SELECT count(*) as c FROM journal_entries WHERE source_type = 'hr_payroll_accrual' AND source_id = $1`,
      [run1Id],
    );

    const passNext =
      loanNextCheck.rows[0].status === 'repaid' &&
      Number(loanNextCheck.rows[0].remaining_amount) === 0 &&
      Number(allocCheck1.rows[0].c) === 1 &&
      Number(ledgerCheck1.rows[0].c) === 1 &&
      Number(treasuryCheck1.rows[0].c) === 0 &&
      Number(journalCheck1.rows[0].c) === 1;

    logResult(
      'PAY_LOAN_NEXT_1',
      passNext ? 'PASS' : 'FAIL',
      '1 allocation, 1 ledger, 0 treasury, repaid, 0 remaining',
      JSON.stringify({
        status: loanNextCheck.rows[0].status,
        remaining: loanNextCheck.rows[0].remaining_amount,
        alloc: allocCheck1.rows[0].c,
        ledger: ledgerCheck1.rows[0].c,
        treasury: treasuryCheck1.rows[0].c,
        journal: journalCheck1.rows[0].c,
      }),
    );

    // ── PAY_LOAN_MONTHLY_1 ───────────────────────────────────────
    const emp2 = await createEmp();
    const loanMonthlyId = await createLoan(emp2, 'monthly_salary_installment', 2000, 2);

    const run2Res = await admin.post('/api/hr/payroll-runs', { periodMonth: genPeriod() });
    const run2Id = (run2Res as any)?.run?.id || (run2Res as any)?.id;
    await admin.post(`/api/hr/payroll-runs/${run2Id}/review`, {});
    await pg.query(
      `UPDATE hr_payroll_run_items SET loan_deduction_amount = 1000 WHERE run_id = $1 AND employee_id = $2`,
      [run2Id, emp2],
    );
    await admin.post(`/api/hr/payroll-runs/${run2Id}/approve`, {});

    const loanMonthlyCheck = await pg.query(`SELECT status, remaining_amount FROM hr_employee_loans WHERE id = $1`, [
      loanMonthlyId,
    ]);
    const allocCheck2 = await pg.query(
      `SELECT count(*) as c FROM hr_payroll_loan_deduction_allocations WHERE payroll_run_id = $1`,
      [run2Id],
    );

    const passMonthly =
      loanMonthlyCheck.rows[0].status === 'partially_repaid' &&
      Number(loanMonthlyCheck.rows[0].remaining_amount) === 1000 &&
      Number(allocCheck2.rows[0].c) === 1;

    logResult(
      'PAY_LOAN_MONTHLY_1',
      passMonthly ? 'PASS' : 'FAIL',
      'partially_repaid, 1000 remaining, 1 allocation',
      JSON.stringify({
        status: loanMonthlyCheck.rows[0].status,
        remaining: loanMonthlyCheck.rows[0].remaining_amount,
        alloc: allocCheck2.rows[0].c,
      }),
    );

    // ── PAY_LOAN_MANUAL_IGNORE ───────────────────────────────────
    const emp3 = await createEmp();
    const loanManualId = await createLoan(emp3, 'manual_cash', 1000, 1);

    const run3Res = await admin.post('/api/hr/payroll-runs', { periodMonth: genPeriod() });
    const run3Id = (run3Res as any)?.run?.id || (run3Res as any)?.id;
    await admin.post(`/api/hr/payroll-runs/${run3Id}/review`, {});
    await admin.post(`/api/hr/payroll-runs/${run3Id}/approve`, {});

    const loanManualCheck = await pg.query(`SELECT status, remaining_amount FROM hr_employee_loans WHERE id = $1`, [
      loanManualId,
    ]);
    const allocCheck3 = await pg.query(
      `SELECT count(*) as c FROM hr_payroll_loan_deduction_allocations WHERE payroll_run_id = $1`,
      [run3Id],
    );

    const passManual =
      loanManualCheck.rows[0].status === 'paid' &&
      Number(loanManualCheck.rows[0].remaining_amount) === 1000 &&
      Number(allocCheck3.rows[0].c) === 0;

    logResult(
      'PAY_LOAN_MANUAL_IGNORE',
      passManual ? 'PASS' : 'FAIL',
      'paid, 1000 remaining, 0 allocation',
      JSON.stringify({
        status: loanManualCheck.rows[0].status,
        remaining: loanManualCheck.rows[0].remaining_amount,
        alloc: allocCheck3.rows[0].c,
      }),
    );

    // ── PAY_LOAN_DUP_LOCK ────────────────────────────────────────
    // run1Id is already 'approved' – re-approving should return HR_PAYROLL_APPROVE_LOCKED
    const dupRes = await admin.post(`/api/hr/payroll-runs/${run1Id}/approve`, {}, 400);
    const dupCode = (dupRes as any)?.error?.code || (dupRes as any)?.code;
    const allocCheckDup = await pg.query(
      `SELECT count(*) as c FROM hr_payroll_loan_deduction_allocations WHERE payroll_run_id = $1`,
      [run1Id],
    );
    const journalCheckDup = await pg.query(
      `SELECT count(*) as c FROM journal_entries WHERE source_type = 'hr_payroll_accrual' AND source_id = $1`,
      [run1Id],
    );

    const passDup =
      dupCode === 'HR_PAYROLL_APPROVE_LOCKED' &&
      Number(allocCheckDup.rows[0].c) === 1 &&
      Number(journalCheckDup.rows[0].c) === 1;

    logResult(
      'PAY_LOAN_DUP_LOCK',
      passDup ? 'PASS' : 'FAIL',
      'HR_PAYROLL_APPROVE_LOCKED, 1 allocation, 1 journal',
      JSON.stringify({ code: dupCode, alloc: allocCheckDup.rows[0].c, journal: journalCheckDup.rows[0].c }),
    );

    // ── PAY_LOAN_MISMATCH_ROLLBACK ───────────────────────────────
    const emp4 = await createEmp();
    const loanMisId = await createLoan(emp4, 'deduct_next_salary', 500, 1);

    const run4Res = await admin.post('/api/hr/payroll-runs', { periodMonth: genPeriod() });
    const run4Id = (run4Res as any)?.run?.id || (run4Res as any)?.id;
    await admin.post(`/api/hr/payroll-runs/${run4Id}/review`, {});
    await pg.query(
      `UPDATE hr_payroll_run_items SET loan_deduction_amount = 1000 WHERE run_id = $1 AND employee_id = $2`,
      [run4Id, emp4],
    );

    const misRes = await admin.post(`/api/hr/payroll-runs/${run4Id}/approve`, {}, 400);
    const misCode = (misRes as any)?.error?.code || (misRes as any)?.code;
    const loanMisCheck = await pg.query(`SELECT status, remaining_amount FROM hr_employee_loans WHERE id = $1`, [
      loanMisId,
    ]);
    const allocCheckMis = await pg.query(
      `SELECT count(*) as c FROM hr_payroll_loan_deduction_allocations WHERE payroll_run_id = $1`,
      [run4Id],
    );

    const passMis =
      misCode === 'HR_PAYROLL_LOAN_ALLOCATION_MISMATCH' &&
      loanMisCheck.rows[0].status === 'paid' &&
      Number(loanMisCheck.rows[0].remaining_amount) === 500 &&
      Number(allocCheckMis.rows[0].c) === 0;

    logResult(
      'PAY_LOAN_MISMATCH_ROLLBACK',
      passMis ? 'PASS' : 'FAIL',
      'HR_PAYROLL_LOAN_ALLOCATION_MISMATCH, rollback everything',
      JSON.stringify({
        code: misCode,
        status: loanMisCheck.rows[0].status,
        remaining: loanMisCheck.rows[0].remaining_amount,
        alloc: allocCheckMis.rows[0].c,
      }),
    );
  } catch (err: any) {
    console.error('Unhandled Error:', err?.response?.data || err?.message || err);
  } finally {
    await pg.end();
  }
}

main();
