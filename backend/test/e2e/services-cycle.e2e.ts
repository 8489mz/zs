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

  // 1. Create DB Setup
  await pg.query(`INSERT INTO tenants (id, business_name, slug, owner_name, owner_phone, trial_starts_at, trial_ends_at, created_at, updated_at) VALUES ($1, $1, $1, 'Owner A', '12345678', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())`, [tenantA]);
  await pg.query(`INSERT INTO tenants (id, business_name, slug, owner_name, owner_phone, trial_starts_at, trial_ends_at, created_at, updated_at) VALUES ($1, $1, $1, 'Owner B', '12345678', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())`, [tenantB]);

  await pg.query(`
    INSERT INTO users (tenant_id, account_id, display_name, username, password_hash, password_salt, role, is_active, permissions_json, must_change_password, failed_login_count, created_at) 
    VALUES ($1, 'MAIN', 'User A', $2, '$2b$12$NMJgmP42bRkfNTfua19mbORWo1Cfhg2.oJz6rq2NNp/bbps7LOWMC', 'salt', 'super_admin', true, '["services", "treasury", "accounting", "settings"]', false, 0, NOW())
  `, [tenantA, `user_a_${suffix}`]);
  
  await pg.query(`
    INSERT INTO users (tenant_id, account_id, display_name, username, password_hash, password_salt, role, is_active, permissions_json, must_change_password, failed_login_count, created_at) 
    VALUES ($1, 'MAIN', 'User B', $2, '$2b$12$NMJgmP42bRkfNTfua19mbORWo1Cfhg2.oJz6rq2NNp/bbps7LOWMC', 'salt', 'super_admin', true, '["services", "treasury", "accounting", "settings"]', false, 0, NOW())
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

  // 2. Open Cashier Shift to satisfy getOpenShiftFinanceScope logic, though it might gracefully fall back to null, better to have one just in case
  // The services module uses `getOpenShiftFinanceScope` which checks `cashier_shifts`. Let's create one.
  const userAId = (await pg.query('SELECT id FROM users WHERE tenant_id=$1', [tenantA])).rows[0].id;
  await pg.query(`INSERT INTO cashier_shifts (tenant_id, account_id, branch_id, location_id, opened_by, status) VALUES ($1, 'MAIN', NULL, $2, $3, 'open')`, [tenantA, locIdA, userAId]);

  // 3. Test Invalid Service
  try {
    const invalidReq = await clientA.request('POST', '/api/services', {
      service: {
        name: 'Invalid Service',
        amount: -100,
        date: new Date().toISOString().split('T')[0],
        paymentChannel: 'cash'
      }
    });
    if (invalidReq.response.status === 400) {
      await logResult('INVALID_SERVICE_AMOUNT', 'PASS', '400', '400');
    } else {
      await logResult('INVALID_SERVICE_AMOUNT', 'FAIL', '400', String(invalidReq.response.status), invalidReq.json);
    }
  } catch (e: any) {
    await logResult('INVALID_SERVICE_AMOUNT', 'FAIL', '400', e.message);
  }

  // 4. Test Cash Service Creation
  let cashServiceId: number;
  const idempotencyKeyCash = `idem_cash_${suffix}`;
  try {
    const cashReq = await clientA.request('POST', '/api/services', {
      service: {
        name: 'Cash Repair',
        amount: 250,
        date: new Date().toISOString().split('T')[0],
        paymentChannel: 'cash'
      }
    }, { 'x-idempotency-key': idempotencyKeyCash });
    
    if (cashReq.response.status === 201) {
      const data = cashReq.json as any;
      const svc = data.services.find((s: any) => s.name === 'Cash Repair');
      cashServiceId = Number(svc.id);
      await logResult('CREATE_CASH_SERVICE', 'PASS', 'Success', 'Success', { id: cashServiceId });
    } else {
      await logResult('CREATE_CASH_SERVICE', 'FAIL', '201', String(cashReq.response.status), cashReq.json);
      process.exit(1);
    }
  } catch (e: any) {
    await logResult('CREATE_CASH_SERVICE', 'FAIL', 'No Exception', e.message);
    process.exit(1);
  }

  // Idempotency check
  try {
    const duplicateReq = await clientA.request('POST', '/api/services', {
      service: {
        name: 'Cash Repair',
        amount: 250,
        date: new Date().toISOString().split('T')[0],
        paymentChannel: 'cash'
      }
    }, { 'x-idempotency-key': idempotencyKeyCash });
    const countTxn = await pg.query("SELECT COUNT(*) as c FROM treasury_transactions WHERE note LIKE '%Cash Repair%' AND tenant_id = $1", [tenantA]);
    if (duplicateReq.response.status === 201 && Number(countTxn.rows[0].c) === 1) {
      await logResult('IDEMPOTENCY_CHECK', 'PASS', 'No Duplicate', 'No Duplicate');
    } else {
      await logResult('IDEMPOTENCY_CHECK', 'FAIL', 'No Duplicate', 'Duplicate or Error', { status: duplicateReq.response.status, count: countTxn.rows[0].c });
    }
  } catch (e: any) {
    await logResult('IDEMPOTENCY_CHECK', 'FAIL', 'No Exception', e.message);
  }

  // Verify Cash Service DB records
  try {
    const srvDb = await pg.query('SELECT * FROM services WHERE id = $1', [cashServiceId!]);
    const txnDb = await pg.query('SELECT * FROM treasury_transactions WHERE reference_type = $1 AND reference_id = $2', ['service', cashServiceId!]);
    const compositeSourceId = Number(`${cashServiceId!}0001`);
    const journalDb = await pg.query('SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2', ['service', String(compositeSourceId)]);
    
    let pass = true;
    const issues = [];

    if (srvDb.rows.length === 0) { pass = false; issues.push("Service not in DB"); }
    else if (srvDb.rows[0].tenant_id !== tenantA) { pass = false; issues.push("Wrong tenant_id in service"); }

    if (txnDb.rows.length === 0) { pass = false; issues.push("Treasury transaction not found"); }
    else if (Number(txnDb.rows[0].amount) !== 250) { pass = false; issues.push("Treasury amount not 250"); }
    else if (txnDb.rows[0].tenant_id !== tenantA) { pass = false; issues.push("Wrong tenant_id in treasury_transaction"); }

    if (journalDb.rows.length === 0) { pass = false; issues.push("Journal entry not found"); }
    else {
      const jLines = await pg.query('SELECT * FROM journal_entry_lines WHERE journal_entry_id = $1', [journalDb.rows[0].id]);
      const debitLine = jLines.rows.find(r => Number(r.debit) === 250);
      const creditLine = jLines.rows.find(r => Number(r.credit) === 250);
      if (!debitLine || !creditLine) { pass = false; issues.push("Journal lines unbalanced or missing"); }
    }

    if (pass) await logResult('VERIFY_CASH_SERVICE_RECORDS', 'PASS', 'Records match', 'Records match');
    else await logResult('VERIFY_CASH_SERVICE_RECORDS', 'FAIL', 'Records match', issues.join(', '));
  } catch (e: any) {
    await logResult('VERIFY_CASH_SERVICE_RECORDS', 'FAIL', 'No exception', e.message);
  }

  // 5. Test Card Service Creation
  let cardServiceId: number;
  try {
    const cardReq = await clientA.request('POST', '/api/services', {
      service: {
        name: 'Card Consultation',
        amount: 500,
        date: new Date().toISOString().split('T')[0],
        paymentChannel: 'card'
      }
    });
    
    if (cardReq.response.status === 201) {
      const data = cardReq.json as any;
      const svc = data.services.find((s: any) => s.name === 'Card Consultation');
      cardServiceId = Number(svc.id);
      
      const txnDb = await pg.query('SELECT * FROM treasury_transactions WHERE reference_type = $1 AND reference_id = $2', ['service', cardServiceId]);
      const compositeSourceId = Number(`${cardServiceId}0001`);
      const journalDb = await pg.query('SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2', ['service', String(compositeSourceId)]);
      
      if (txnDb.rows.length === 0 && journalDb.rows.length === 1) {
        await logResult('CREATE_CARD_SERVICE', 'PASS', 'No Treasury Txn, Yes Journal', 'No Treasury Txn, Yes Journal');
      } else {
        await logResult('CREATE_CARD_SERVICE', 'FAIL', 'No Treasury Txn, Yes Journal', `Txns: ${txnDb.rows.length}, Journals: ${journalDb.rows.length}`);
      }
    } else {
      await logResult('CREATE_CARD_SERVICE', 'FAIL', '201', String(cardReq.response.status), cardReq.json);
    }
  } catch (e: any) {
    await logResult('CREATE_CARD_SERVICE', 'FAIL', 'No Exception', e.message);
  }

  // 6. Test Update Service (Change amount and channel)
  try {
    const updateReq = await clientA.request('PUT', `/api/services/${cashServiceId!}`, {
      service: {
        name: 'Updated Cash Repair',
        amount: 350,
        date: new Date().toISOString().split('T')[0],
        paymentChannel: 'card' // Changed from cash to card
      }
    });
    
    if (updateReq.response.status === 200) {
      // Treasury txn should be deleted (since it's now card)
      const txnDb = await pg.query('SELECT * FROM treasury_transactions WHERE reference_type = $1 AND reference_id = $2', ['service', cashServiceId!]);
      // Revision 1 journal should be reversed, Revision 2 journal should exist
      const j1 = await pg.query('SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2', ['service', String(`${cashServiceId!}0001`)]);
      const j2 = await pg.query('SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2', ['service', String(`${cashServiceId!}0002`)]);
      
      // Let's check the lines of the reversed journal 1
      let reversed = false;
      if (j1.rows.length > 0) {
         const revJ = await pg.query('SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2', ['service_reversal', String(`${cashServiceId!}0001`)]);
         if (revJ.rows.length > 0) reversed = true;
      }
      
      if (txnDb.rows.length === 0 && reversed && j2.rows.length === 1) {
        await logResult('UPDATE_SERVICE_TO_CARD', 'PASS', 'Correct changes applied', 'Correct changes applied');
      } else {
        await logResult('UPDATE_SERVICE_TO_CARD', 'FAIL', 'Correct changes applied', `Txns: ${txnDb.rows.length}, Reversed: ${reversed}, J2: ${j2.rows.length}`);
      }
    } else {
      await logResult('UPDATE_SERVICE_TO_CARD', 'FAIL', '200', String(updateReq.response.status), updateReq.json);
    }
  } catch(e: any) {
    await logResult('UPDATE_SERVICE_TO_CARD', 'FAIL', 'No Exception', e.message);
  }

  // 7. Test Delete Service
  try {
    const delReq = await clientA.request('DELETE', `/api/services/${cardServiceId!}`);
    if (delReq.response.status === 200) {
      const svcDb = await pg.query('SELECT * FROM services WHERE id = $1', [cardServiceId!]);
      const j1 = await pg.query('SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2', ['service', String(`${cardServiceId!}0001`)]);
      let reversed = false;
      if (j1.rows.length > 0) {
         const revJ = await pg.query('SELECT * FROM journal_entries WHERE source_type = $1 AND source_id = $2', ['service_reversal', String(`${cardServiceId!}0001`)]);
         if (revJ.rows.length > 0) reversed = true;
      }

      if (svcDb.rows.length === 0 && reversed) {
        await logResult('DELETE_SERVICE', 'PASS', 'Deleted and Reversed', 'Deleted and Reversed');
      } else {
        await logResult('DELETE_SERVICE', 'FAIL', 'Deleted and Reversed', `Svc: ${svcDb.rows.length}, Reversed: ${reversed}`);
      }
    } else {
      await logResult('DELETE_SERVICE', 'FAIL', '200', String(delReq.response.status), delReq.json);
    }
  } catch(e: any) {
    await logResult('DELETE_SERVICE', 'FAIL', 'No Exception', e.message);
  }

  // 8. Isolation Check
  try {
    const servicesB = await clientB.get('/api/services');
    const svcB = servicesB.services.find((e: any) => e.id === String(cashServiceId));
    if (!svcB) {
      await logResult('ISOLATION_READ', 'PASS', 'Not Found', 'Not Found');
    } else {
      await logResult('ISOLATION_READ', 'FAIL', 'Not Found', 'Found Service A in Tenant B list');
    }
  } catch (e: any) {
    await logResult('ISOLATION_READ', 'FAIL', 'No exception', e.message);
  }

  // 9. Rollback on accounting failure
  try {
    await pg.query("UPDATE accounting_settings SET cash_account_id = NULL WHERE tenant_id = $1", [tenantA]);
    // Also set bank_account to null just in case
    await pg.query("UPDATE accounting_settings SET bank_account_id = NULL WHERE tenant_id = $1", [tenantA]);
    
    // We also need to delete account 1110 to trigger error
    await pg.query("UPDATE accounting_accounts SET is_active = false WHERE code = '1110' AND tenant_id = $1", [tenantA]);

    const failingReq = await clientA.request('POST', '/api/services', {
      service: {
        name: 'Failing Service',
        amount: 2500,
        date: new Date().toISOString().split('T')[0],
        paymentChannel: 'cash'
      }
    });

    if (failingReq.response.status === 500) {
      const countSvc = await pg.query("SELECT COUNT(*) as c FROM services WHERE name = 'Failing Service' AND tenant_id = $1", [tenantA]);
      const countTxn = await pg.query("SELECT COUNT(*) as c FROM treasury_transactions WHERE note LIKE '%Failing Service%' AND tenant_id = $1", [tenantA]);
      
      if (Number(countSvc.rows[0].c) === 0 && Number(countTxn.rows[0].c) === 0) {
        await logResult('ROLLBACK_ON_FAILURE', 'PASS', 'Rolled back', 'Rolled back');
      } else {
        await logResult('ROLLBACK_ON_FAILURE', 'FAIL', 'Rolled back', 'Records persisted!', { services: countSvc.rows[0].c, txns: countTxn.rows[0].c });
      }
    } else {
      await logResult('ROLLBACK_ON_FAILURE', 'FAIL', '500 Internal Error', String(failingReq.response.status), failingReq.json);
    }
  } catch(e: any) {
    await logResult('ROLLBACK_ON_FAILURE', 'FAIL', 'Managed Exception', e.message);
  }

  console.log("All services cycle tests finished!");
  await pg.end();
}

main().catch(e => {
  console.error("Fatal Error:", e);
  process.exit(1);
});
