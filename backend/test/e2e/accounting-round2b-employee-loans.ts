import { E2EClient } from './e2e-utils';
import { Client } from 'pg';

let pg: Client;
let admin: E2EClient;
let loanId: number;

const logResult = (id: string, status: string, expected: string, actual: string, error?: any) => {
  console.log('\n================================');
  console.log(`Test ID: ${id}`);
  console.log(`Expected: ${expected}`);
  console.log(`Actual: ${actual}`);
  console.log(`Status: ${status}`);
  if (error) console.log(`Error/Details:`, error?.response?.data || error);
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
  let employeeId: number;
  try {
    const empCode = String(Math.floor(Math.random() * 900000) + 100000);
    await admin.post('/api/hr/employees', {
      firstName: 'Test Employee ' + Date.now(),
      lastName: 'Last',
      employeeNo: empCode,
      nationalId: Date.now().toString() + '1',
      status: 'active',
      hireDate: '2026-08-01',
      departmentId: 1,
      jobTitleId: 1,
      compensationType: 'monthly',
    });
    const dbEmp = await pg.query('SELECT id FROM hr_employees WHERE employee_no = $1', [empCode]);
    employeeId = dbEmp.rows[0]?.id;

    // Set up contract so that employee has a salary
    await admin.post(`/api/hr/employees/${employeeId}/contracts`, {
      startDate: '2020-01-01',
      baseSalary: 5000,
    });

    const loanRes = await admin.post('/api/hr/loans', {
      employeeId,
      principalAmount: 2000,
      installmentCount: 2,
      issueDate: '2026-08-01',
      firstDueDate: '2026-08-01',
      loanType: 'loan',
    });
    const loanDbRes = await pg.query(
      'SELECT id FROM hr_employee_loans WHERE employee_id = $1 ORDER BY id DESC LIMIT 1',
      [employeeId],
    );
    loanId = loanDbRes.rows[0].id;
    await admin.post(`/api/hr/loans/${loanId}/approve`, {});
  } catch (e: any) {
    console.error('Setup failed', e?.response?.data || e.message);
    process.exit(1);
  }

  // LOAN_DISB_1
  try {
    await admin.post(`/api/hr/loans/${loanId}/disburse`, {});
    const r1 = await pg.query(
      `SELECT count(*) FROM journal_entries WHERE source_type = 'hr_employee_loan_disbursement' AND source_id = ${loanId}`,
    );
    const r2 = await pg.query(
      `SELECT count(*) FROM treasury_transactions WHERE reference_type = 'hr_employee_loan' AND reference_id = ${loanId} AND txn_type = 'cash_out'`,
    );
    const r3 = await pg.query(
      `SELECT count(*) FROM hr_employee_ledger WHERE entry_type = 'loan_disbursement' AND reference_id = ${loanId}`,
    );
    const r4 = await pg.query(`SELECT status FROM hr_employee_loans WHERE id = ${loanId}`);
    if (r1.rows[0].count == 1 && r2.rows[0].count == 1 && r3.rows[0].count == 1 && r4.rows[0].status === 'paid') {
      logResult('LOAN_DISB_1', 'PASS', '1 journal, 1 cash_out, 1 ledger, status paid', 'Match');
    } else {
      logResult(
        'LOAN_DISB_1',
        'FAIL',
        '1 journal, 1 cash_out, 1 ledger, status paid',
        `journals=${r1.rows[0].count} cash=${r2.rows[0].count} ledgers=${r3.rows[0].count} status=${r4.rows[0].status}`,
      );
    }
  } catch (e) {
    logResult('LOAN_DISB_1', 'FAIL', 'Success', 'Error', e);
  }

  // LOAN_DISB_DUP
  try {
    let errCode = '';
    try {
      const resp = await admin.post(`/api/hr/loans/${loanId}/disburse`, {}, 400);
      errCode = (resp as any)?.error?.code || (resp as any)?.code || 'UNKNOWN';
    } catch (e: any) {
      errCode = e.message;
    }
    const r1 = await pg.query(
      `SELECT count(*) FROM journal_entries WHERE source_type = 'hr_employee_loan_disbursement' AND source_id = ${loanId}`,
    );
    if (errCode === 'HR_LOAN_APPROVAL_REQUIRED' && r1.rows[0].count == 1) {
      logResult('LOAN_DISB_DUP', 'PASS', 'HR_LOAN_APPROVAL_REQUIRED, 1 journal', 'Match');
    } else {
      logResult('LOAN_DISB_DUP', 'FAIL', 'HR_LOAN_APPROVAL_REQUIRED, 1 journal', `${errCode}, ${r1.rows[0].count}`);
    }
  } catch (e) {
    logResult('LOAN_DISB_DUP', 'FAIL', 'Success', 'Error', e);
  }

  // LOAN_REPAY_PARTIAL
  try {
    await admin.post(`/api/hr/loans/${loanId}/repayments`, {
      amount: 1000,
      repaymentMethod: 'manual_cash',
    });
    const loanQuery = await pg.query(`SELECT status, remaining_amount FROM hr_employee_loans WHERE id = ${loanId}`);
    const ledgers = await pg.query(
      `SELECT id FROM hr_employee_ledger WHERE entry_type = 'loan_repayment' AND reference_id = ${loanId}`,
    );
    const ledgerId = ledgers.rows[0].id;
    const r1 = await pg.query(
      `SELECT count(*) FROM journal_entries WHERE source_type = 'hr_employee_loan_repayment' AND source_id = ${ledgerId}`,
    );
    const r2 = await pg.query(
      `SELECT count(*) FROM treasury_transactions WHERE reference_type = 'hr_employee_loan_repayment' AND reference_id = ${ledgerId} AND txn_type = 'cash_in'`,
    );
    if (
      loanQuery.rows[0].status === 'partially_repaid' &&
      Number(loanQuery.rows[0].remaining_amount) === 1000 &&
      r1.rows[0].count == 1 &&
      r2.rows[0].count == 1
    ) {
      logResult('LOAN_REPAY_PARTIAL', 'PASS', 'partially_repaid, 1000 remaining, 1 journal, 1 cash_in', 'Match');
    } else {
      logResult(
        'LOAN_REPAY_PARTIAL',
        'FAIL',
        'partially_repaid, 1000 remaining, 1 journal, 1 cash_in',
        `status=${loanQuery.rows[0].status} rem=${Number(loanQuery.rows[0].remaining_amount)} journals=${r1.rows[0].count} cash=${r2.rows[0].count}`,
      );
    }
  } catch (e) {
    logResult('LOAN_REPAY_PARTIAL', 'FAIL', 'Success', 'Error', e);
  }

  // LOAN_REPAY_FINAL
  try {
    await admin.post(`/api/hr/loans/${loanId}/repayments`, {
      amount: 1000,
      repaymentMethod: 'manual_cash',
    });
    const loanQuery = await pg.query(`SELECT status, remaining_amount FROM hr_employee_loans WHERE id = ${loanId}`);
    const cashInSum = await pg.query(
      `SELECT sum(amount) FROM treasury_transactions WHERE reference_type = 'hr_employee_loan_repayment' AND reference_id IN (SELECT id FROM hr_employee_ledger WHERE reference_id = ${loanId})`,
    );

    if (
      loanQuery.rows[0].status === 'repaid' &&
      Number(loanQuery.rows[0].remaining_amount) === 0 &&
      Number(cashInSum.rows[0].sum) === 2000
    ) {
      logResult('LOAN_REPAY_FINAL', 'PASS', 'repaid, 0 remaining, 2000 cash_in', 'Match');
    } else {
      logResult(
        'LOAN_REPAY_FINAL',
        'FAIL',
        'repaid, 0 remaining, 2000 cash_in',
        `status=${loanQuery.rows[0].status} rem=${Number(loanQuery.rows[0].remaining_amount)} cash_in=${Number(cashInSum.rows[0].sum)}`,
      );
    }
  } catch (e) {
    logResult('LOAN_REPAY_FINAL', 'FAIL', 'Success', 'Error', e);
  }

  // LOAN_OVERPAY
  try {
    let errCode = '';
    const loanRes3 = await admin.post('/api/hr/loans', {
      employeeId,
      principalAmount: 2000,
      installmentCount: 2,
      issueDate: '2026-08-01',
      firstDueDate: '2026-08-01',
      loanType: 'loan',
    });
    const loanDbRes3 = await pg.query(
      'SELECT id FROM hr_employee_loans WHERE employee_id = $1 ORDER BY id DESC LIMIT 1',
      [employeeId],
    );
    const loanId3 = loanDbRes3.rows[0].id;
    await admin.post(`/api/hr/loans/${loanId3}/approve`, {});
    await admin.post(`/api/hr/loans/${loanId3}/disburse`, {});

    try {
      const resp = await admin.post(
        `/api/hr/loans/${loanId3}/repayments`,
        {
          amount: 3000,
          repaymentMethod: 'manual_cash',
        },
        400,
      );
      errCode = (resp as any)?.error?.code || (resp as any)?.code || 'UNKNOWN';
    } catch (e: any) {
      errCode = e.message;
    }
    if (
      errCode === 'HR_LOAN_REPAYMENT_STATUS_INVALID' ||
      errCode === 'HR_LOAN_NO_BALANCE' ||
      errCode === 'HR_LOAN_REPAYMENT_EXCEEDS_BALANCE'
    ) {
      logResult('LOAN_OVERPAY', 'PASS', '400 Blocked', 'Match');
    } else {
      logResult('LOAN_OVERPAY', 'FAIL', '400 Blocked', errCode);
    }
  } catch (e) {
    logResult('LOAN_OVERPAY', 'FAIL', 'Success', 'Error', e);
  }

  // LOAN_SALARY_DIRECT_BLOCK
  try {
    let errCode = '';
    try {
      // Create new loan for this since previous is paid
      const loanRes = await admin.post('/api/hr/loans', {
        employeeId,
        principalAmount: 2000,
        installmentCount: 2,
        issueDate: '2026-08-01',
        firstDueDate: '2026-08-01',
        loanType: 'loan',
      });
      const loanDbRes2 = await pg.query(
        'SELECT id FROM hr_employee_loans WHERE employee_id = $1 ORDER BY id DESC LIMIT 1',
        [employeeId],
      );
      const loanId2 = loanDbRes2.rows[0].id;
      await admin.post(`/api/hr/loans/${loanId2}/approve`, {});
      await admin.post(`/api/hr/loans/${loanId2}/disburse`, {});

      const resp = await admin.post(
        `/api/hr/loans/${loanId2}/repayments`,
        {
          amount: 1000,
          repaymentMethod: 'salary_deduction',
        },
        400,
      );
      errCode = (resp as any)?.error?.code || (resp as any)?.code || 'UNKNOWN';
    } catch (e: any) {
      errCode = e.message;
    }
    if (errCode === 'HR_LOAN_SALARY_DEDUCTION_REQUIRES_PAYROLL') {
      logResult('LOAN_SALARY_DIRECT_BLOCK', 'PASS', 'HR_LOAN_SALARY_DEDUCTION_REQUIRES_PAYROLL', 'Match');
    } else {
      logResult('LOAN_SALARY_DIRECT_BLOCK', 'FAIL', 'HR_LOAN_SALARY_DEDUCTION_REQUIRES_PAYROLL', errCode);
    }
  } catch (e) {
    logResult('LOAN_SALARY_DIRECT_BLOCK', 'FAIL', 'Success', 'Error', e);
  }

  await pg.end();
}
main().catch(console.error);
