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

  console.log('--- Setting up Test Data (via APIs) ---');

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
  const employeeId = dbEmp.rows[0]?.id;

  // Set up contract so that employee has a salary
  await admin.post(`/api/hr/employees/${employeeId}/contracts`, {
    startDate: '2020-01-01',
    baseSalary: 5000,
    status: 'active',
  });

  // Helper to create a ready-to-approve payroll run
  async function createReviewedPayrollRun() {
    const randomYear = 2030 + Math.floor(Math.random() * 1000);
    const period =
      randomYear +
      '-' +
      Math.floor(Math.random() * 12 + 1)
        .toString()
        .padStart(2, '0');
    const runRes = await admin.post('/api/hr/payroll-runs', { periodMonth: period });
    const runId =
      runRes?.data?.id ||
      runRes?.id ||
      (runRes as any)?.record?.id ||
      Object.values(runRes || {}).find((v) => (v as any)?.id)?.id;
    if (!runId) {
      console.error('Could not find runId in:', runRes);
      throw new Error('runId missing');
    }
    // Recalculate to generate items
    await admin.post(`/api/hr/payroll-runs/${runId}/recalculate`, {});
    // Review
    await admin.post(`/api/hr/payroll-runs/${runId}/review`, {});
    return runId;
  }

  const TEST_FILTER = String(process.env.TEST_FILTER || 'ALL');

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'PAY_ACC_1') {
    console.log('\n--- PAY_ACC_1 ---');
    try {
      const runId = await createReviewedPayrollRun();
      const approveRes = await admin.post(`/api/hr/payroll-runs/${runId}/approve`, {});

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'hr_payroll_accrual' AND source_id = $1",
        [runId],
      );
      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [journalQuery.rows[0]?.id],
      );

      let pass = true;
      let actual = '';
      if (journalQuery.rows.length !== 1) {
        pass = false;
        actual += `Found ${journalQuery.rows.length} journals. `;
      } else {
        let totalDebit = 0,
          totalCredit = 0;
        let has6200 = false,
          has2140 = false;
        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          totalCredit += Number(line.credit || 0);
          if (line.account_code === '6200' && Number(line.debit) > 0) has6200 = true;
          if (line.account_code === '2140' && Number(line.credit) > 0) has2140 = true;
        }
        if (totalDebit !== totalCredit) {
          pass = false;
          actual += `Debit ${totalDebit} != Credit ${totalCredit}. `;
        }
        if (!has6200) {
          pass = false;
          actual += `Missing Debit 6200. `;
        }
        if (!has2140) {
          pass = false;
          actual += `Missing Credit 2140. `;
        }

        const resStatus =
          (approveRes as any)?.run?.status ||
          approveRes?.data?.status ||
          approveRes?.status ||
          approveRes?.record?.status;
        if (resStatus !== 'approved') {
          pass = false;
          actual += `Run status is ${resStatus}. `;
        }

        if (!pass) console.log('DB lines:', linesQuery.rows);
      }
      if (pass) actual = 'OK';
      logResult('PAY_ACC_1', pass ? 'PASS' : 'FAIL', 'Accrual journal created correctly', actual);
    } catch (e: any) {
      logResult('PAY_ACC_1', 'FAIL', 'Accrual journal created correctly', 'Exception', e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'PAY_ACC_DUP') {
    console.log('\n--- PAY_ACC_DUP ---');
    try {
      const runId = await createReviewedPayrollRun();
      await admin.post(`/api/hr/payroll-runs/${runId}/approve`, {});

      let pass = true;
      let actual = '';
      try {
        const res: any = await admin.post(`/api/hr/payroll-runs/${runId}/approve`, undefined, 400);
        if (res.error?.code !== 'HR_PAYROLL_APPROVE_LOCKED') {
          pass = false;
          actual += `Wrong error: ${res.error?.code}. `;
        }
      } catch (e: any) {
        pass = false;
        actual += `Unexpected exception: ${e.message}. `;
      }

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'hr_payroll_accrual' AND source_id = $1",
        [runId],
      );
      if (journalQuery.rows.length !== 1) {
        pass = false;
        actual += `Found ${journalQuery.rows.length} journals. `;
      }

      if (pass) actual = 'OK';
      logResult('PAY_ACC_DUP', pass ? 'PASS' : 'FAIL', 'Duplicate accrual prevented', actual);
    } catch (e: any) {
      logResult('PAY_ACC_DUP', 'FAIL', 'Duplicate accrual prevented', 'Exception', e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'PAY_CASH_1') {
    console.log('\n--- PAY_CASH_1 ---');
    try {
      const runId = await createReviewedPayrollRun();
      await admin.post(`/api/hr/payroll-runs/${runId}/approve`, {});

      const payRes = await admin.post(`/api/hr/payroll-runs/${runId}/pay`, { paymentChannel: 'cash' });

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'hr_payroll_payment' AND source_id = $1",
        [runId],
      );
      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [journalQuery.rows[0]?.id],
      );
      const treasuryQuery = await pg.query(
        "SELECT * FROM treasury_transactions WHERE reference_type = 'hr_payroll_payment' AND reference_id = $1",
        [runId],
      );

      let pass = true;
      let actual = '';
      if (journalQuery.rows.length !== 1) {
        pass = false;
        actual += `Found ${journalQuery.rows.length} journals. `;
      } else {
        let totalDebit = 0;
        let has2140 = false,
          has1110 = false;
        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          if (line.account_code === '2140' && Number(line.debit) > 0) has2140 = true;
          if (line.account_code === '1110' && Number(line.credit) > 0) has1110 = true;
        }
        if (!has2140) {
          pass = false;
          actual += `Missing Debit 2140. `;
        }
        if (!has1110) {
          pass = false;
          actual += `Missing Credit 1110. `;
        }

        const treasuryQuery = await pg.query(
          "SELECT * FROM treasury_transactions WHERE reference_type = 'hr_payroll_payment' AND reference_id = $1",
          [runId],
        );
        if (treasuryQuery.rows.length !== 1) {
          pass = false;
          actual += `Expected 1 treasury tx, got ${treasuryQuery.rows.length}. `;
        } else if (Number(treasuryQuery.rows[0].amount) !== -totalDebit) {
          pass = false;
          actual += `Treasury amount ${treasuryQuery.rows[0].amount} != ${-totalDebit}. `;
        }

        const resStatus =
          (payRes as any)?.run?.status || payRes?.data?.status || payRes?.status || payRes?.record?.status;
        if (resStatus !== 'paid') {
          pass = false;
          actual += `Run status is ${resStatus}. `;
        }

        if (!pass) console.log('DB lines CASH:', linesQuery.rows, 'Treasury:', treasuryQuery.rows);
        if (pass) actual = 'OK';
      }

      logResult('PAY_CASH_1', pass ? 'PASS' : 'FAIL', 'Cash payment journal and treasury created', actual);
    } catch (e: any) {
      logResult('PAY_CASH_1', 'FAIL', 'Cash payment journal and treasury created', 'Exception', e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'PAY_BANK_1') {
    console.log('\n--- PAY_BANK_1 ---');
    try {
      const runId = await createReviewedPayrollRun();
      await admin.post(`/api/hr/payroll-runs/${runId}/approve`, {});

      const payRes = await admin.post(`/api/hr/payroll-runs/${runId}/pay`, { paymentChannel: 'bank' });

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'hr_payroll_payment' AND source_id = $1",
        [runId],
      );
      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [journalQuery.rows[0]?.id],
      );
      const treasuryQuery = await pg.query(
        "SELECT * FROM treasury_transactions WHERE reference_type = 'hr_payroll_payment' AND reference_id = $1",
        [runId],
      );

      let pass = true;
      let actual = '';
      if (journalQuery.rows.length !== 1) {
        pass = false;
        actual += `Found ${journalQuery.rows.length} journals. `;
      } else {
        let has2140 = false,
          has1120 = false;
        for (const line of linesQuery.rows) {
          if (line.account_code === '2140' && Number(line.debit) > 0) has2140 = true;
          if (line.account_code === '1120' && Number(line.credit) > 0) has1120 = true;
        }
        if (!has2140) {
          pass = false;
          actual += `Missing Debit 2140. `;
        }
        if (!has1120) {
          pass = false;
          actual += `Missing Credit 1120. `;
        }

        const treasuryQuery = await pg.query(
          "SELECT * FROM treasury_transactions WHERE reference_type = 'hr_payroll_payment' AND reference_id = $1",
          [runId],
        );
        if (treasuryQuery.rows.length !== 0) {
          pass = false;
          actual += `Expected 0 treasury tx, got ${treasuryQuery.rows.length}. `;
        }

        const resStatus =
          (payRes as any)?.run?.status || payRes?.data?.status || payRes?.status || payRes?.record?.status;
        if (resStatus !== 'paid') {
          pass = false;
          actual += `Run status is ${resStatus}. `;
        }

        if (!pass) console.log('DB lines BANK:', linesQuery.rows, 'Treasury:', treasuryQuery.rows);
      }
      if (pass) actual = 'OK';
      logResult('PAY_BANK_1', pass ? 'PASS' : 'FAIL', 'Bank payment journal created, no treasury', actual);
    } catch (e: any) {
      logResult('PAY_BANK_1', 'FAIL', 'Bank payment journal created, no treasury', 'Exception', e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'PAY_DUP_1') {
    console.log('\n--- PAY_DUP_1 ---');
    try {
      const runId = await createReviewedPayrollRun();
      await admin.post(`/api/hr/payroll-runs/${runId}/approve`, {});
      await admin.post(`/api/hr/payroll-runs/${runId}/pay`, { paymentChannel: 'cash' });

      let pass = true;
      let actual = '';
      try {
        const res: any = await admin.post(`/api/hr/payroll-runs/${runId}/pay`, { paymentChannel: 'cash' }, 400);
        if (res.error?.code !== 'HR_PAYROLL_PAY_LOCKED') {
          pass = false;
          actual += `Wrong error: ${res.error?.code}. `;
        }
      } catch (e: any) {
        pass = false;
        actual += `Unexpected exception: ${e.message}. `;
      }

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'hr_payroll_payment' AND source_id = $1",
        [runId],
      );
      const treasuryQuery = await pg.query(
        "SELECT * FROM treasury_transactions WHERE reference_type = 'hr_payroll_payment' AND reference_id = $1",
        [runId],
      );

      if (journalQuery.rows.length !== 1) {
        pass = false;
        actual += `Found ${journalQuery.rows.length} journals. `;
      }
      if (treasuryQuery.rows.length !== 1) {
        pass = false;
        actual += `Found ${treasuryQuery.rows.length} treasury txns. `;
      }

      const statusQuery = await pg.query('SELECT status FROM hr_payroll_runs WHERE id = $1', [runId]);
      if (statusQuery.rows[0]?.status !== 'paid') {
        pass = false;
        actual += `Run status is ${statusQuery.rows[0]?.status}. `;
      }

      if (pass) actual = 'OK';
      logResult('PAY_DUP_1', pass ? 'PASS' : 'FAIL', 'Duplicate payment prevented', actual);
    } catch (e: any) {
      logResult('PAY_DUP_1', 'FAIL', 'Duplicate payment prevented', 'Exception', e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'PAY_LOCK_1') {
    console.log('\n--- PAY_LOCK_1 ---');
    try {
      const runId = await createReviewedPayrollRun();

      let pass = true;
      let actual = '';

      // Try paying reviewed run
      try {
        await admin.post(`/api/hr/payroll-runs/${runId}/pay`, { paymentChannel: 'cash' });
        pass = false;
        actual += `Paid reviewed run. `;
      } catch (e: any) {
        if (!e.message?.includes('HR_PAYROLL_PAY_LOCKED')) {
          pass = false;
          actual += `Wrong error on pay reviewed: ${e.message}. `;
        }
      }

      // Approve and Pay
      await admin.post(`/api/hr/payroll-runs/${runId}/approve`, {});
      await admin.post(`/api/hr/payroll-runs/${runId}/pay`, { paymentChannel: 'cash' });

      // Double pay
      try {
        await admin.post(`/api/hr/payroll-runs/${runId}/pay`, { paymentChannel: 'cash' });
        pass = false;
        actual += `Double paid. `;
      } catch (e: any) {
        if (!e.message?.includes('HR_PAYROLL_PAY_LOCKED') && !e.message?.includes('HR_PAYROLL_PAYMENT_FAILED')) {
          pass = false;
          actual += `Wrong error on double pay: ${e.message}. `;
        }
      }

      // Cancel paid
      try {
        await admin.post(`/api/hr/payroll-runs/${runId}/cancel`, {});
        pass = false;
        actual += `Cancelled paid run. `;
      } catch (e: any) {
        if (!e.message?.includes('HR_PAYROLL_CANCEL_LOCKED')) {
          pass = false;
          actual += `Wrong error on cancel paid run: ${e.message}. `;
        }
      }

      // Recalculate paid
      try {
        await admin.post(`/api/hr/payroll-runs/${runId}/recalculate`, {});
        pass = false;
        actual += `Recalculated paid run. `;
      } catch (e: any) {
        if (!e.message?.includes('HR_PAYROLL_RECALCULATE_LOCKED')) {
          pass = false;
          actual += `Wrong error on recalculate paid run: ${e.message}. `;
        }
      }

      if (pass) actual = 'OK';
      logResult('PAY_LOCK_1', pass ? 'PASS' : 'FAIL', 'Invalid transitions blocked', actual);
    } catch (e: any) {
      logResult('PAY_LOCK_1', 'FAIL', 'Invalid transitions blocked', 'Exception', e);
    }
  }

  await pg.end();
  console.log('--- E2E Tests Complete ---');
}

main().catch((e) => {
  console.error('Fatal error', e);
  process.exit(1);
});
