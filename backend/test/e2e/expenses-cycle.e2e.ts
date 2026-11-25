import { E2EClient } from './e2e-utils';
import { Client } from 'pg';
import assert from 'node:assert/strict';

async function logResult(testId: string, status: string, expected: string, actual: string, additionalInfo?: any) {
  console.log(`\n================================`);
  console.log(`Test ID: ${testId}`);
  console.log(`Expected: ${expected}`);
  console.log(`Actual: ${actual}`);
  console.log(`Status: ${status}`);
  if (additionalInfo) console.log(`Additional Info: ${JSON.stringify(additionalInfo, null, 2)}`);
  console.log(`================================`);
  if (status === 'FAIL') process.exitCode = 1;
}

async function main() {
  let pg = new Client({ user: 'postgres', password: 'password', host: '127.0.0.1', port: 5433, database: 'zs_dev' });
  try {
    await pg.connect();
  } catch(e) {
    pg = new Client({ user: 'postgres', password: 'postgres', host: '127.0.0.1', port: 5433, database: 'zs_dev' });
    await pg.connect();
  }

  const suffix = Date.now().toString();
  const tenantA = `T_A_${suffix}`;
  const tenantB = `T_B_${suffix}`;

  // 1. Create DB Setup for Multi-Tenant Isolation
  await pg.query(`INSERT INTO tenants (id, business_name, slug, owner_name, owner_phone, trial_starts_at, trial_ends_at, created_at, updated_at) VALUES ($1, $1, $1, 'Owner A', '12345678', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())`, [tenantA]);
  await pg.query(`INSERT INTO tenants (id, business_name, slug, owner_name, owner_phone, trial_starts_at, trial_ends_at, created_at, updated_at) VALUES ($1, $1, $1, 'Owner B', '12345678', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())`, [tenantB]);

  await pg.query(`
    INSERT INTO users (tenant_id, account_id, display_name, username, password_hash, password_salt, role, is_active, permissions_json, must_change_password, failed_login_count, created_at) 
    VALUES ($1, 'MAIN', 'User A', $2, '$2b$12$NMJgmP42bRkfNTfua19mbORWo1Cfhg2.oJz6rq2NNp/bbps7LOWMC', 'salt', 'super_admin', true, '["treasury", "accounting", "settings"]', false, 0, NOW())
  `, [tenantA, `user_a_${suffix}`]);
  
  await pg.query(`
    INSERT INTO users (tenant_id, account_id, display_name, username, password_hash, password_salt, role, is_active, permissions_json, must_change_password, failed_login_count, created_at) 
    VALUES ($1, 'MAIN', 'User B', $2, '$2b$12$NMJgmP42bRkfNTfua19mbORWo1Cfhg2.oJz6rq2NNp/bbps7LOWMC', 'salt', 'super_admin', true, '["treasury", "accounting", "settings"]', false, 0, NOW())
  `, [tenantB, `user_b_${suffix}`]);

  await pg.query(`INSERT INTO stock_locations (tenant_id, account_id, name, is_active, created_at, updated_at) VALUES ($1, 'MAIN', 'Loc A', true, NOW(), NOW())`, [tenantA]);
  await pg.query(`INSERT INTO stock_locations (tenant_id, account_id, name, is_active, created_at, updated_at) VALUES ($1, 'MAIN', 'Loc B', true, NOW(), NOW())`, [tenantB]);

  const locA = await pg.query('SELECT id FROM stock_locations WHERE tenant_id = $1 LIMIT 1', [tenantA]);
  const locIdA = locA.rows[0].id;

  const clientA = new E2EClient();
  await clientA.login(`user_a_${suffix}`, '123456');
  await clientA.get('/api/accounting/accounts'); // Seed foundation

  const clientB = new E2EClient();
  await clientB.login(`user_b_${suffix}`, '123456');
  await clientB.get('/api/accounting/accounts'); // Seed foundation

  // 2. Validate invalid expense data
  try {
    const invalidReq = await clientA.request('POST', '/api/expenses', {
      title: 'Invalid Expense',
      amount: -50,
      date: new Date().toISOString().split('T')[0],
      locationId: locIdA
    });
    if (invalidReq.response.status === 400) {
      await logResult('INVALID_EXPENSE_AMOUNT', 'PASS', '400', '400');
    } else {
      await logResult('INVALID_EXPENSE_AMOUNT', 'FAIL', '400', String(invalidReq.response.status), invalidReq.json);
    }
  } catch (e: any) {
    await logResult('INVALID_EXPENSE_AMOUNT', 'FAIL', '400', e.message);
  }

  // 3. Create Valid Expense in Tenant A
  let expenseIdA: number;
  try {
    const validExpense = await clientA.post('/api/expenses', {
      title: 'Office Supplies',
      amount: 1500,
      date: new Date().toISOString().split('T')[0],
      locationId: locIdA,
      note: 'Pens and paper'
    });
    // Check if it's returned in list
    const expenses = await clientA.get('/api/expenses');
    const exp = expenses.expenses.find((e: any) => e.title === 'Office Supplies');
    if (exp) {
      expenseIdA = Number(exp.id);
      await logResult('CREATE_VALID_EXPENSE', 'PASS', 'Success', 'Success', { id: expenseIdA, amount: exp.amount });
    } else {
      await logResult('CREATE_VALID_EXPENSE', 'FAIL', 'Success', 'Not found in list');
      process.exit(1);
    }
  } catch (e: any) {
    await logResult('CREATE_VALID_EXPENSE', 'FAIL', 'Success', e.message);
    process.exit(1);
  }

  // 4. Verify DB records for Tenant A
  try {
    const expDb = await pg.query('SELECT * FROM expenses WHERE id = $1', [expenseIdA!]);
    const txnDb = await pg.query('SELECT * FROM treasury_transactions WHERE reference_type = $1 AND reference_id = $2', ['expense', expenseIdA!]);
    const journalDb = await pg.query('SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2', ['expense', String(expenseIdA!)]);
    
    let pass = true;
    const issues = [];

    if (expDb.rows.length === 0) { pass = false; issues.push("Expense not in DB"); }
    else if (expDb.rows[0].tenant_id !== tenantA) { pass = false; issues.push("Wrong tenant_id in expense"); }

    if (txnDb.rows.length === 0) { pass = false; issues.push("Treasury transaction not found"); }
    else if (Number(txnDb.rows[0].amount) !== -1500) { pass = false; issues.push("Treasury amount not -1500"); }
    else if (txnDb.rows[0].tenant_id !== tenantA) { pass = false; issues.push("Wrong tenant_id in treasury_transaction"); }

    if (journalDb.rows.length === 0) { pass = false; issues.push("Journal entry not found"); }
    else {
      const jLines = await pg.query('SELECT * FROM journal_entry_lines WHERE journal_entry_id = $1', [journalDb.rows[0].id]);
      const debitLine = jLines.rows.find(r => Number(r.debit) === 1500);
      const creditLine = jLines.rows.find(r => Number(r.credit) === 1500);
      
      if (!debitLine || !creditLine) { pass = false; issues.push("Journal lines unbalanced or missing"); }
      if (journalDb.rows[0].tenant_id !== tenantA) { pass = false; issues.push("Wrong tenant_id in journal_entry"); }
    }

    if (pass) {
      await logResult('VERIFY_EXPENSE_RECORDS', 'PASS', 'Records match', 'Records match');
    } else {
      await logResult('VERIFY_EXPENSE_RECORDS', 'FAIL', 'Records match', issues.join(', '));
    }
  } catch (e: any) {
    await logResult('VERIFY_EXPENSE_RECORDS', 'FAIL', 'No exception', e.message);
  }

  // 5. Verify Isolation (Tenant B cannot see Tenant A's expense)
  try {
    const expensesB = await clientB.get('/api/expenses');
    const expB = expensesB.expenses.find((e: any) => e.id === String(expenseIdA));
    if (!expB) {
      await logResult('ISOLATION_READ', 'PASS', 'Not Found', 'Not Found');
    } else {
      await logResult('ISOLATION_READ', 'FAIL', 'Not Found', 'Found Expense A in Tenant B list');
    }
  } catch (e: any) {
    await logResult('ISOLATION_READ', 'FAIL', 'No exception', e.message);
  }

  // 6. Test Rollback (Cause accounting posting to fail)
  // To fail accounting, we can delete the cash account setting for Tenant A temporarily or make amount massive to trigger out of bounds. 
  // Wait, better yet, we can set cash_account_id to null or a deleted account.
  try {
    await pg.query("UPDATE accounting_settings SET cash_account_id = NULL WHERE tenant_id = $1", [tenantA]);
    
    const failingReq = await clientA.request('POST', '/api/expenses', {
      title: 'Failing Expense',
      amount: 2500,
      date: new Date().toISOString().split('T')[0],
      locationId: locIdA
    });

    if (failingReq.response.status === 500) {
      // It should rollback
      const countExp = await pg.query("SELECT COUNT(*) as c FROM expenses WHERE title = 'Failing Expense' AND tenant_id = $1", [tenantA]);
      const countTxn = await pg.query("SELECT COUNT(*) as c FROM treasury_transactions WHERE note LIKE '%Failing Expense%' AND tenant_id = $1", [tenantA]);
      
      if (Number(countExp.rows[0].c) === 0 && Number(countTxn.rows[0].c) === 0) {
        await logResult('ROLLBACK_ON_FAILURE', 'PASS', 'Rolled back', 'Rolled back');
      } else {
        await logResult('ROLLBACK_ON_FAILURE', 'FAIL', 'Rolled back', 'Records persisted!', { expenses: countExp.rows[0].c, txns: countTxn.rows[0].c });
      }
    } else {
      await logResult('ROLLBACK_ON_FAILURE', 'FAIL', '500 Internal Error', String(failingReq.response.status), failingReq.json);
    }
  } catch(e: any) {
    await logResult('ROLLBACK_ON_FAILURE', 'FAIL', 'Managed Exception', e.message);
  }

  console.log("All expense cycle tests finished!");
  await pg.end();
}

main().catch(e => {
  console.error("Fatal Error:", e);
  process.exit(1);
});
