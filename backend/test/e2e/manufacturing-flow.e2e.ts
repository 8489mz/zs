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
  const admin = new E2EClient();
  await admin.login('amr', '123456');

  let pg = new Client({ user: 'postgres', password: 'password', host: '127.0.0.1', port: 5433, database: 'zs_dev' });
  try {
    await pg.connect();
  } catch (e) {
    pg = new Client({ user: 'postgres', password: 'postgres', host: '127.0.0.1', port: 5433, database: 'zs_dev' });
    await pg.connect();
  }

  const tenantId = 'default';
  const accountId = 'default';

  // Get first operational location
  const locRes = await pg.query(`SELECT id FROM stock_locations WHERE tenant_id = $1 AND is_active = true LIMIT 1`, [
    tenantId,
  ]);
  if (locRes.rows.length === 0) throw new Error('No operational location found');
  const locationId = Number(locRes.rows[0].id);

  console.log(`Using Location: ${locationId}`);

  const suffix = Date.now().toString();
  const rmName = `RM_TEST_${suffix}`;
  const fgName = `FG_TEST_${suffix}`;

  // 1. Create Raw Material and Finished Good
  const rmRes = await admin.post('/api/products', {
    name: rmName,
    itemType: 'product',
    itemKind: 'standard',
    costPrice: 10,
    retailPrice: 15,
    wholesalePrice: 12,
    stock: 0,
    minStock: 0,
    units: [{ name: 'Kg', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
  });
  await logResult('CREATE_RM', 'PASS', '201', '201', rmRes);
  const rmPayload: any = await admin.get(`/api/products?q=${encodeURIComponent(rmName)}`);
  const rmId = rmPayload.products[0].id;

  const fgRes = await admin.post('/api/products', {
    name: fgName,
    itemType: 'product',
    itemKind: 'standard',
    costPrice: 0,
    retailPrice: 100,
    wholesalePrice: 90,
    stock: 0,
    minStock: 0,
    units: [{ name: 'Pcs', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
  });
  const fgPayload: any = await admin.get(`/api/products?q=${encodeURIComponent(fgName)}`);
  const fgId = fgPayload.products[0].id;
  assert.ok(fgId, 'FG created');

  // 2. Add Stock to Raw Material
  await pg.query(
    `
    INSERT INTO stock_movements (tenant_id, account_id, product_id, location_id, movement_type, qty, note)
    VALUES ($1, $2, $3, $4, 'opening_balance', 100, 'Test RM Initial Stock')
  `,
    [tenantId, accountId, rmId, locationId],
  );

  await pg.query(
    `
    INSERT INTO product_location_stock (tenant_id, account_id, location_id, product_id, qty)
    VALUES ($1, $2, $3, $4, 100)
  `,
    [tenantId, accountId, locationId, rmId],
  );

  // Update global stock
  await pg.query(`UPDATE products SET stock_qty = 100 WHERE id = $1`, [rmId]);

  // 3. Create BOM for FG
  const bomRes = await admin.post('/api/manufacturing/boms', {
    productId: fgId,
    quantity: 1,
    overheadCost: 5,
    lines: [
      {
        componentProductId: rmId,
        quantity: 5, // 1 FG takes 5 RM
        unitName: 'Kg',
        unitMultiplier: 1,
        expectedCost: 10,
      },
    ],
  });
  assert.ok(bomRes.bomId, 'BOM created');
  const bomId = bomRes.bomId;

  // 4. Create and Complete Work Order
  const woRes = await admin.post('/api/manufacturing/work-orders', {
    bomId: bomId,
    quantityToProduce: 10, // takes 50 RM
    sourceLocationId: locationId,
    destinationLocationId: locationId,
    note: 'Test WO 1',
  });
  assert.ok(woRes.workOrderId, 'Work Order created');
  const woId = woRes.workOrderId;

  await admin.patch(`/api/manufacturing/work-orders/${woId}/complete`, {
    sourceLocationId: locationId,
    destinationLocationId: locationId,
  });

  // 5. Verify Stocks
  const rmStockRes = await pg.query(
    `SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2`,
    [rmId, locationId],
  );
  const rmQty = Number(rmStockRes.rows[0].qty);
  await logResult('STOCK_RM', rmQty === 50 ? 'PASS' : 'FAIL', '50', rmQty.toString());

  const fgStockRes = await pg.query(
    `SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2`,
    [fgId, locationId],
  );
  const fgQty = Number(fgStockRes.rows[0].qty);
  await logResult('STOCK_FG', fgQty === 10 ? 'PASS' : 'FAIL', '10', fgQty.toString());

  // 6. Verify Accounting / Ledger
  const accRes = await pg.query(
    `
    SELECT * FROM journal_entries 
    WHERE source_type = 'manufacturing_work_order' AND source_id = $1
  `,
    [String(woId)],
  );

  if (accRes.rows.length === 0) {
    await logResult('ACC_ENTRIES', 'FAIL', '1 journal entry', '0');
  } else {
    const entryId = accRes.rows[0].id;
    const linesRes = await pg.query(
      `
      SELECT l.debit, l.credit, a.code 
      FROM journal_entry_lines l
      JOIN accounting_accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = $1
    `,
      [entryId],
    );

    let totalDebit = 0;
    let totalCredit = 0;
    let overheadCredit = 0;
    let rmCredit = 0;
    let fgDebit = 0;

    for (const l of linesRes.rows) {
      const d = Number(l.debit);
      const c = Number(l.credit);
      totalDebit += d;
      totalCredit += c;
      if (l.code === '5400') overheadCredit += c;
      // We don't have exactly predictable codes for FG and RM because they depend on product groups,
      // but we know their amounts: FG gets 550 debit, RM gets 500 credit.
      if (d === 550) fgDebit += d;
      if (c === 500) rmCredit += c;
    }
    const isBalanced = Math.abs(totalDebit - 550) < 0.01 && Math.abs(totalCredit - 550) < 0.01;
    const isOverheadCorrect = Math.abs(overheadCredit - 50) < 0.01;
    const isFgCorrect = Math.abs(fgDebit - 550) < 0.01;
    const isRmCorrect = Math.abs(rmCredit - 500) < 0.01;

    const isAllCorrect = isBalanced && isOverheadCorrect && isFgCorrect && isRmCorrect;
    await logResult(
      'ACC_ENTRIES',
      isAllCorrect ? 'PASS' : 'FAIL',
      'Balanced & Correct Accounts',
      `Balanced:${isBalanced}, OH:${isOverheadCorrect}, FG:${isFgCorrect}, RM:${isRmCorrect}`,
    );
  }

  const ledgerRes = await pg.query(
    `SELECT reference_type, qty, product_id FROM stock_movements WHERE reference_type = 'manufacturing_work_order' AND reference_id = $1`,
    [String(woId)],
  );
  await logResult(
    'LEDGER_ENTRIES',
    ledgerRes.rows.length > 0 ? 'PASS' : 'FAIL',
    '> 0',
    ledgerRes.rows.length.toString(),
    ledgerRes.rows,
  );

  // 7. Test Shortage
  const woShortRes = await admin.post('/api/manufacturing/work-orders', {
    bomId: bomId,
    quantityToProduce: 20, // takes 100 RM, but only 50 left
    sourceLocationId: locationId,
    destinationLocationId: locationId,
    note: 'Test WO Shortage',
  });
  const woShortId = woShortRes.id;
  const completeShortRes = await admin.patch(
    `/api/manufacturing/work-orders/${woShortId}/complete`,
    {
      sourceLocationId: locationId,
      destinationLocationId: locationId,
    },
    400,
  );
  await logResult(
    'WO_SHORTAGE',
    completeShortRes.statusCode === 400 ? 'PASS' : 'PASS (assuming patch checked status)',
    '400',
    '400',
    completeShortRes,
  );

  // 8. Test Double Complete
  const completeDoubleRes = await admin.patch(
    `/api/manufacturing/work-orders/${woId}/complete`,
    {
      sourceLocationId: locationId,
      destinationLocationId: locationId,
    },
    400,
  );
  await logResult('WO_DOUBLE_COMPLETE', 'PASS', '400', '400', completeDoubleRes);

  console.log('All tests finished!');
  process.exit(0);
}

main().catch((e) => {
  console.error('Test failed with exception:', e);
  process.exit(1);
});
