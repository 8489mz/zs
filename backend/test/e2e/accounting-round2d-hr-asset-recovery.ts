import { E2EClient } from './e2e-utils';
import { Client } from 'pg';
import assert from 'node:assert';

const URL = process.env.API_URL || 'http://127.0.0.1:3101';
const PG_PORT = process.env.PG_PORT || '5433';
const PG_DB = process.env.PG_DB || 'zs_dev';

let testMonthCounter = 1;
let currentYear = 2030;
async function getNextUnusedMonth(testId: string) {
  const pg = new Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/${PG_DB}` });
  await pg.connect();
  let periodMonth = '';
  while (true) {
    let m = testMonthCounter++;
    if (m > 12) {
      testMonthCounter = 1;
      m = 1;
      currentYear++;
    }
    periodMonth = `${currentYear}-${String(m).padStart(2, '0')}`;
    const res = await pg.query('SELECT id FROM hr_payroll_runs WHERE period_month = $1', [periodMonth]);
    if (res.rows.length === 0) break;
  }
  await pg.end();
  console.log(`[${testId}] Selected periodMonth: ${periodMonth}`);
  return periodMonth;
}

async function preflightCleanup() {
  const pg = new Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/${PG_DB}` });
  await pg.connect();

  const empRes = await pg.query(`
    SELECT id FROM hr_employees 
    WHERE first_name = 'R2D_ASSET_TEST' 
       OR (first_name = 'Asset' AND last_name LIKE 'Emp %')
  `);
  const empIds = empRes.rows.map((r) => r.id);

  let deletedAdjs = 0;
  if (empIds.length > 0) {
    const adjRes = await pg.query(
      `
      DELETE FROM hr_employee_adjustments
      WHERE status = 'pending'
        AND (accounting_category = 'asset_recovery' OR source_type = 'hr_employee_asset')
        AND employee_id = ANY($1::int[])
      RETURNING id
    `,
      [empIds],
    );
    deletedAdjs = adjRes.rowCount || 0;

    await pg.query(
      `
      UPDATE hr_employees
      SET status = 'terminated'
      WHERE id = ANY($1::int[])
    `,
      [empIds],
    );
  }

  await pg.end();
  console.log(`[TEST CLEANUP] employees=${empIds.length} adjustments=${deletedAdjs}`);
}

async function createEmployee(admin: E2EClient, periodMonth: string) {
  const uniqueNumber = String(Date.now()).slice(-9);
  const res: any = await admin.post('/api/hr/employees', {
    firstName: 'R2D_ASSET_TEST',
    lastName: `Emp ${uniqueNumber}`,
    employeeNo: uniqueNumber,
    nationalId: uniqueNumber + '12345',
    status: 'active',
    hireDate: `${periodMonth}-01`,
    departmentId: 1,
    jobTitleId: 1,
    compensationType: 'monthly',
  });
  const id = res.id || res.employees?.[0]?.id;
  assert.ok(id);

  await admin.post(`/api/hr/employees/${id}/contracts`, {
    startDate: `${periodMonth}-01`,
    baseSalary: 10000,
    status: 'active',
  });
  return id;
}

async function runTest1() {
  console.log('--- ASSET_RECOVERY_1 ---');
  const admin = new E2EClient(URL);
  await admin.login('zs', 'secret');

  const periodMonth = await getNextUnusedMonth('TEST');
  const empId = await createEmployee(admin, periodMonth);

  const issueRes: any = await admin.post('/api/hr/assets', {
    employeeId: empId,
    assetName: 'R2D_ASSET_TEST_Laptop',
    assetType: 'laptop',
  });
  const assetId = issueRes.id || issueRes.assets?.[0]?.id;
  assert.ok(assetId);

  await admin.post(`/api/hr/assets/${assetId}/lost`, {
    returnedAt: `${periodMonth}-10`,
    deductionAmount: 1000,
  });

  const runRes: any = await admin.post('/api/hr/payroll-runs', { periodMonth });
  const runId = runRes.id || runRes.run?.id || runRes.runs?.[0]?.id;
  await admin.post(`/api/hr/payroll-runs/${runId}/recalculate`, {});

  let getRun: any = await admin.get(`/api/hr/payroll-runs/${runId}`);
  let items = getRun.items || getRun.run?.items;
  let item = items.find((i: any) => i.employeeId === empId || i.employee_id === empId);

  await admin.post(`/api/hr/payroll-run-items/${item.id}/adjustments`, {
    adjustmentType: 'deduction',
    label: 'Ordinary deduction',
    amount: 500,
  });

  await admin.post(`/api/hr/payroll-runs/${runId}/recalculate`, {});

  getRun = await admin.get(`/api/hr/payroll-runs/${runId}`);
  items = getRun.items || getRun.run?.items;
  item = items.find((i: any) => i.employeeId === empId || i.employee_id === empId);

  await admin.post(`/api/hr/payroll-runs/${runId}/review`, {});
  await admin.post(`/api/hr/payroll-runs/${runId}/approve`, {});

  const pg = new Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/${PG_DB}` });
  await pg.connect();
  const j = await pg.query("SELECT * FROM journal_entries WHERE source_type='hr_payroll_accrual' AND source_id=$1", [
    runId,
  ]);
  assert.strictEqual(j.rows.length, 1);
  const jId = j.rows[0].id;

  const l = await pg.query(
    'SELECT a.code, jl.debit, jl.credit FROM journal_entry_lines jl JOIN accounting_accounts a ON jl.account_id = a.id WHERE jl.journal_entry_id = $1',
    [jId],
  );

  const allItems = getRun.items || getRun.run?.items || [];
  let expectedNetPay = 0;
  let expectedLoanDeduction = 0;
  let expectedAssetRecovery = 0;

  for (const it of allItems) {
    expectedNetPay += Number(it.netPay || it.net_pay || 0);
    expectedLoanDeduction += Number(it.loanDeductionAmount || it.loan_deduction_amount || 0);
    expectedAssetRecovery += Number(it.assetRecoveryDeductionAmount || it.asset_recovery_deduction_amount || 0);
  }
  const expectedSalaryExpense = expectedNetPay + expectedLoanDeduction + expectedAssetRecovery;

  const exp6200 = l.rows.find((r: any) => r.code === '6200');
  const exp2140 = l.rows.find((r: any) => r.code === '2140');
  const exp7100 = l.rows.find((r: any) => r.code === '7100');
  const exp1160 = l.rows.find((r: any) => r.code === '1160');

  assert.strictEqual(Number(exp6200?.debit || 0), expectedSalaryExpense);
  assert.strictEqual(Number(exp2140?.credit || 0), expectedNetPay);
  assert.strictEqual(Number(exp7100?.credit || 0), expectedAssetRecovery);
  if (expectedLoanDeduction > 0) {
    assert.strictEqual(Number(exp1160?.credit || 0), expectedLoanDeduction);
  }

  assert.strictEqual(Number(item.baseSalary || item.base_salary), 10000);
  assert.strictEqual(Number(item.deductionAmount || item.deduction_amount), 1500);
  assert.strictEqual(Number(item.assetRecoveryDeductionAmount || item.asset_recovery_deduction_amount), 1000);
  assert.strictEqual(Number(item.netPay || item.net_pay), 8500);

  const t = await pg.query(
    "SELECT * FROM treasury_transactions WHERE reference_type = 'hr_employee_asset' AND reference_id = $1",
    [assetId],
  );
  assert.strictEqual(t.rows.length, 0);

  await pg.end();
  console.log('PASSED');
}

async function runTest2() {
  console.log('--- ASSET_GENERIC_DEDUCTION ---');
  const admin = new E2EClient(URL);
  await admin.login('zs', 'secret');

  const periodMonth = await getNextUnusedMonth('TEST');
  const empId = await createEmployee(admin, periodMonth);

  const runRes: any = await admin.post('/api/hr/payroll-runs', { periodMonth });
  const runId = runRes.id || runRes.run?.id || runRes.runs?.[0]?.id;
  await admin.post(`/api/hr/payroll-runs/${runId}/recalculate`, {});

  let getRun: any = await admin.get(`/api/hr/payroll-runs/${runId}`);
  let items = getRun.items || getRun.run?.items;
  let item = items.find((i: any) => i.employeeId === empId || i.employee_id === empId);

  await admin.post(`/api/hr/payroll-run-items/${item.id}/adjustments`, {
    adjustmentType: 'deduction',
    label: 'Ordinary deduction 2',
    amount: 500,
  });

  await admin.post(`/api/hr/payroll-runs/${runId}/recalculate`, {});

  getRun = await admin.get(`/api/hr/payroll-runs/${runId}`);
  items = getRun.items || getRun.run?.items;
  item = items.find((i: any) => i.employeeId === empId || i.employee_id === empId);

  assert.strictEqual(Number(item.netPay || item.net_pay), 9500);
  assert.strictEqual(Number(item.assetRecoveryDeductionAmount || item.asset_recovery_deduction_amount || 0), 0);

  await admin.post(`/api/hr/payroll-runs/${runId}/review`, {});
  await admin.post(`/api/hr/payroll-runs/${runId}/approve`, {});

  const pg = new Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/${PG_DB}` });
  await pg.connect();
  const j = await pg.query("SELECT id FROM journal_entries WHERE source_type='hr_payroll_accrual' AND source_id=$1", [
    runId,
  ]);
  const jId = j.rows[0].id;
  const l = await pg.query(
    'SELECT a.code, jl.debit, jl.credit FROM journal_entry_lines jl JOIN accounting_accounts a ON jl.account_id = a.id WHERE jl.journal_entry_id = $1',
    [jId],
  );

  const exp6200 = l.rows.find((r) => r.code === '6200');
  const exp2140 = l.rows.find((r) => r.code === '2140');
  const exp7100 = l.rows.find((r) => r.code === '7100');

  assert.ok(Number(exp6200.debit) >= 9500);
  assert.ok(Number(exp2140.credit) >= 9500);
  assert.strictEqual(exp7100, undefined);

  await pg.end();
  console.log('PASSED');
}

async function runTest3() {
  console.log('--- ASSET_DUPLICATE_BLOCK ---');
  const admin = new E2EClient(URL);
  await admin.login('zs', 'secret');

  const periodMonth = await getNextUnusedMonth('TEST');
  const empId = await createEmployee(admin, periodMonth);

  const issueRes: any = await admin.post('/api/hr/assets', {
    employeeId: empId,
    assetName: 'R2D_ASSET_TEST_Phone',
    assetType: 'phone',
  });
  const assetId = issueRes.id || issueRes.assets?.[0]?.id;

  await admin.post(`/api/hr/assets/${assetId}/lost`, {
    returnedAt: `${periodMonth}-10`,
    deductionAmount: 200,
  });

  await admin.post(
    `/api/hr/assets/${assetId}/lost`,
    {
      returnedAt: `${periodMonth}-11`,
      deductionAmount: 300,
    },
    201,
  );

  const pg = new Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/${PG_DB}` });
  await pg.connect();
  const adjs = await pg.query(
    "SELECT * FROM hr_employee_adjustments WHERE source_type='hr_employee_asset' AND source_id=$1",
    [String(assetId)],
  );
  assert.strictEqual(adjs.rows.length, 1);
  assert.strictEqual(Number(adjs.rows[0].amount), 200);
  await pg.end();
  console.log('PASSED');
}

async function runTest4() {
  console.log('--- ASSET_EXCEEDS_PAY_ROLLBACK ---');
  const admin = new E2EClient(URL);
  await admin.login('zs', 'secret');

  const periodMonth = await getNextUnusedMonth('TEST');
  const empId = await createEmployee(admin, periodMonth);

  const issueRes: any = await admin.post('/api/hr/assets', {
    employeeId: empId,
    assetName: 'R2D_ASSET_TEST_Server',
    assetType: 'server',
  });
  const assetId = issueRes.id || issueRes.assets?.[0]?.id;

  await admin.post(`/api/hr/assets/${assetId}/lost`, {
    returnedAt: `${periodMonth}-10`,
    deductionAmount: 12000,
  });

  const adminAny = admin as any;
  const cookieEntries = adminAny.cookies.entries() as Iterable<[string, string]>;
  const cookieStr = Array.from(cookieEntries)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
  const csrfToken = adminAny.cookies.get('zs_dev_csrf_token') || adminAny.cookies.get('zs_csrf_token');
  const res = await fetch(`${URL}/api/hr/payroll-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieStr, 'x-csrf-token': csrfToken },
    body: JSON.stringify({ periodMonth }),
  });

  assert.strictEqual(res.status, 400);
  const errBody: any = await res.json();
  assert.strictEqual(errBody.error?.code || errBody.code, 'HR_PAYROLL_ASSET_DEDUCTION_EXCEEDS_AVAILABLE_PAY');

  const pg = new Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/${PG_DB}` });
  await pg.connect();
  const runCheck = await pg.query('SELECT id FROM hr_payroll_runs WHERE period_month = $1', [periodMonth]);
  assert.strictEqual(runCheck.rows.length, 0);

  const adjs = await pg.query(
    "SELECT status FROM hr_employee_adjustments WHERE source_type='hr_employee_asset' AND source_id=$1",
    [String(assetId)],
  );
  assert.strictEqual(adjs.rows[0].status, 'pending');
  await pg.end();
  console.log('PASSED');
}

async function runTest5() {
  console.log('--- ASSET_NO_FINANCIAL_DEDUCTION ---');
  const admin = new E2EClient(URL);
  await admin.login('zs', 'secret');

  const periodMonth = await getNextUnusedMonth('TEST');
  const empId = await createEmployee(admin, periodMonth);

  const issueRes: any = await admin.post('/api/hr/assets', {
    employeeId: empId,
    assetName: 'R2D_ASSET_TEST_Mouse',
    assetType: 'accessory',
  });
  const assetId = issueRes.id || issueRes.assets?.[0]?.id;

  await admin.post(`/api/hr/assets/${assetId}/damaged`, {
    returnedAt: `${periodMonth}-10`,
    deductionAmount: 0,
  });

  const pg = new Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/${PG_DB}` });
  await pg.connect();
  const adjs = await pg.query(
    "SELECT * FROM hr_employee_adjustments WHERE source_type='hr_employee_asset' AND source_id=$1",
    [String(assetId)],
  );
  assert.strictEqual(adjs.rows.length, 0);
  await pg.end();
  console.log('PASSED');
}

(async () => {
  try {
    await preflightCleanup();
    await runTest1();
    await runTest2();
    await runTest3();
    await runTest4();
    await runTest5();
    console.log('ALL PASSED');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
