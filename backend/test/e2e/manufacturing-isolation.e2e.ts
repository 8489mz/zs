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
  } catch (e) {
    pg = new Client({ user: 'postgres', password: 'postgres', host: '127.0.0.1', port: 5433, database: 'zs_dev' });
    await pg.connect();
  }

  const suffix = Date.now().toString();
  const tenantA = `T_A_${suffix}`;
  const tenantB = `T_B_${suffix}`;

  // 1. Create DB Setup for Multi-Tenant Isolation

  // Tenant A
  await pg.query(
    `INSERT INTO tenants (id, business_name, slug, owner_name, owner_phone, trial_starts_at, trial_ends_at, created_at, updated_at) VALUES ($1, $1, $1, 'Owner A', '12345678', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())`,
    [tenantA],
  );

  // Tenant B
  await pg.query(
    `INSERT INTO tenants (id, business_name, slug, owner_name, owner_phone, trial_starts_at, trial_ends_at, created_at, updated_at) VALUES ($1, $1, $1, 'Owner B', '12345678', NOW(), NOW() + INTERVAL '30 days', NOW(), NOW())`,
    [tenantB],
  );

  // Create Users for Tenant A and Tenant B
  await pg.query(
    `
    INSERT INTO users (tenant_id, account_id, display_name, username, password_hash, password_salt, role, is_active, permissions_json, must_change_password, failed_login_count, created_at) 
    VALUES ($1, 'MAIN', 'User A', $2, '$2b$12$NMJgmP42bRkfNTfua19mbORWo1Cfhg2.oJz6rq2NNp/bbps7LOWMC', 'salt', 'super_admin', true, '["products", "manufacturing", "inventory", "accounting", "settings"]', false, 0, NOW())
  `,
    [tenantA, `user_a_${suffix}`],
  );

  await pg.query(
    `
    INSERT INTO users (tenant_id, account_id, display_name, username, password_hash, password_salt, role, is_active, permissions_json, must_change_password, failed_login_count, created_at) 
    VALUES ($1, 'MAIN', 'User B', $2, '$2b$12$NMJgmP42bRkfNTfua19mbORWo1Cfhg2.oJz6rq2NNp/bbps7LOWMC', 'salt', 'super_admin', true, '["products", "manufacturing", "inventory", "accounting", "settings"]', false, 0, NOW())
  `,
    [tenantB, `user_b_${suffix}`],
  );

  // We need locations for each tenant to create work orders
  await pg.query(
    `INSERT INTO stock_locations (tenant_id, account_id, name, is_active, created_at, updated_at) VALUES ($1, 'MAIN', 'Loc A', true, NOW(), NOW())`,
    [tenantA],
  );
  await pg.query(
    `INSERT INTO stock_locations (tenant_id, account_id, name, is_active, created_at, updated_at) VALUES ($1, 'MAIN', 'Loc B', true, NOW(), NOW())`,
    [tenantB],
  );

  // Create foundation logic for each tenant
  const foundationClientA = new E2EClient();
  await foundationClientA.login(`user_a_${suffix}`, '123456');
  await foundationClientA.get('/api/accounting/accounts');

  const foundationClientB = new E2EClient();
  await foundationClientB.login(`user_b_${suffix}`, '123456');
  await foundationClientB.get('/api/accounting/accounts');

  // Verify accounts were seeded separately
  const overheadAccountsA = await pg.query(
    `SELECT account_id FROM accounting_accounts WHERE tenant_id = $1 AND code = '5400'`,
    [tenantA],
  );
  assert.ok(
    overheadAccountsA.rows.find((r) => r.account_id === 'MAIN'),
    'Account A has 5400',
  );

  console.log('Expected: Overhead Accounts for A and B');

  const accDefA = await pg.query(`SELECT count(id) FROM accounting_accounts WHERE tenant_id = $1`, [tenantA]);
  const accDefB = await pg.query(`SELECT count(id) FROM accounting_accounts WHERE tenant_id = $1`, [tenantB]);

  if (Number(accDefA.rows[0].count) > 0 && Number(accDefB.rows[0].count) > 0) {
    await logResult('ISOLATION_SEEDING', 'PASS', 'Overhead Accounts for A and B', 'Seeded Properly');
  } else {
    await logResult('ISOLATION_SEEDING', 'FAIL', 'Overhead Accounts for A and B', 'Not Seeded');
    assert.fail('Accounts not seeded properly');
  }

  // 2. Setup Products for Account A
  const rmRes = await foundationClientA.post('/api/products', {
    name: 'RM_A',
    itemType: 'product',
    itemKind: 'standard',
    costPrice: 10,
    retailPrice: 15,
    wholesalePrice: 12,
    stock: 100, // this sets initial stock
    minStock: 0,
    units: [{ name: 'Kg', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
  });
  const rmIdA = ((await foundationClientA.get(`/api/products?q=RM_A`)) as any).products[0].id;

  const fgRes = await foundationClientA.post('/api/products', {
    name: 'FG_A',
    itemType: 'product',
    itemKind: 'standard',
    costPrice: 0,
    retailPrice: 100,
    wholesalePrice: 90,
    stock: 0,
    minStock: 0,
    units: [{ name: 'Pcs', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
  });
  const fgIdA = ((await foundationClientA.get(`/api/products?q=FG_A`)) as any).products[0].id;

  const crossAccountBOMs = await foundationClientB.get(`/api/manufacturing/boms`);
  assert.ok((crossAccountBOMs as any).boms.length === 0, 'Tenant B should not see Tenant A BOMs');

  // 3. BOM for Account A
  const bomResA = await foundationClientA.post('/api/manufacturing/boms', {
    productId: fgIdA,
    quantity: 1,
    overheadCost: 5,
    lines: [
      {
        componentProductId: rmIdA,
        quantity: 5,
        unitName: 'Kg',
        unitMultiplier: 1,
        expectedCost: 10,
      },
    ],
  });

  const locA = (
    await pg.query(`SELECT id FROM stock_locations WHERE tenant_id = $1 AND account_id = 'MAIN' LIMIT 1`, [tenantA])
  ).rows[0].id;

  // Create Work Order in Account A
  const woA = await foundationClientA.post('/api/manufacturing/work-orders', {
    bomId: bomResA.bomId,
    quantityToProduce: 2, // requires 10 RM
    sourceLocationId: locA,
    destinationLocationId: locA,
    note: 'Test WO for A',
  });

  // 4. Try to access or complete Tenant A's Work Order from Tenant B (should fail)
  const { response: resB } = await foundationClientB.request(
    'PATCH',
    `/api/manufacturing/work-orders/${woA.workOrderId}/complete`,
    {},
  );
  if (resB.status === 200 || resB.status === 201) {
    assert.fail('Should not be able to complete WO from another tenant');
  } else {
    assert.equal(resB.status, 404, 'Cross-tenant access should result in 404 Not Found');
    await logResult('CROSS_TENANT_COMPLETE', 'PASS', '404', resB.status.toString());
  }

  // Verify journal entry has not been created
  const journalBefore = await pg.query(
    `SELECT * FROM journal_entries WHERE source_type = 'manufacturing_work_order' AND source_id = $1`,
    [woA.workOrderId],
  );
  assert.equal(journalBefore.rows.length, 0, 'Journal entry should not exist yet');

  // Complete WO properly as Account A
  await foundationClientA.patch(`/api/manufacturing/work-orders/${woA.workOrderId}/complete`, {});
  await logResult('PROPER_ACCOUNT_COMPLETE', 'PASS', 'Success', 'Success');

  // Verify accounting isolation for the created journal
  const journalAfter = await pg.query(
    `SELECT tenant_id, account_id, id FROM journal_entries WHERE source_type = 'manufacturing_work_order' AND source_id = $1`,
    [woA.workOrderId],
  );
  assert.equal(journalAfter.rows.length, 1);
  assert.equal(journalAfter.rows[0].tenant_id, tenantA);
  assert.equal(journalAfter.rows[0].account_id, 'MAIN');

  const journalLinesAfter = await pg.query(`SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = $1`, [
    journalAfter.rows[0].id,
  ]);

  // Fetch account definitions to ensure they belong to A
  const lineAccountIds = journalLinesAfter.rows.map((r) => r.account_id);
  const accDef = await pg.query(`SELECT tenant_id, account_id FROM accounting_accounts WHERE id = ANY($1::int[])`, [
    lineAccountIds,
  ]);
  for (const def of accDef.rows) {
    assert.equal(def.tenant_id, tenantA);
    assert.equal(def.account_id, 'MAIN', "All accounts used in journal entry lines must belong to Tenant A's account");
  }

  await logResult('ISOLATION_ASSERTION', 'PASS', 'All Journal lines mapped to Account A', 'Mapped to Account A');
  await pg.end();
  console.log('All multi-tenant isolation tests finished!');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Test failed with error:', err);
  process.exitCode = 1;
});
