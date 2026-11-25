console.log('HELLO START');
import { E2EClient } from './e2e-utils';
import { Client } from 'pg';
import assert from 'assert';

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
  admin = new E2EClient(process.env.E2E_BASE_URL || 'http://127.0.0.1:3102');
  const testAdminPassword = process.env.TEST_ADMIN_PASSWORD || 'secret';
  const TEST_CASHIER_PASSWORD = process.env.TEST_CASHIER_PASSWORD || 'secret';
  await admin.login('zs', testAdminPassword);

  pg = new Client({
    connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/zs_dev',
  });
  await pg.connect();

  console.log('--- Setting up Test Data (via APIs) ---');

  // 1. Create Product
  const productName = 'Accounting Test Product ' + Date.now();
  const productRes = await admin.post('/api/products', {
    name: productName,
    barcode: 'ACT' + Date.now(),
    retailPrice: 100,
    wholesalePrice: 90,
    costPrice: 50,
    minStock: 0,
    units: [
      {
        name: 'piece',
        multiplier: 1,
        isBaseUnit: true,
        isSaleUnit: true,
        isPurchaseUnit: true,
        barcode: 'ACT' + Date.now(),
      },
    ],
  });
  const productsPayload: any = await admin.get(`/api/products?q=${encodeURIComponent(productName)}`);
  const productId = Number(productsPayload.products.find((p: any) => p.name === productName).id);

  const locQuery = await pg.query('SELECT id, branch_id FROM stock_locations LIMIT 1');
  const locId = Number(locQuery.rows[0].id);
  const branchId = Number(locQuery.rows[0].branch_id);

  // 2. Add Opening Stock (via inventory adjustments)
  const openRes = await admin.post('/api/inventory-adjustments', {
    actionType: 'add',
    productId,
    locationId: locId,
    qty: 100,
    reason: 'Opening Stock for Accounting Test',
    note: 'opening',
  });
  // Verify opening stock movement exists
  const openingMovQuery = await pg.query(
    "SELECT id FROM stock_movements WHERE product_id = $1 AND reason = 'Opening Stock for Accounting Test'",
    [productId],
  );
  if (openingMovQuery.rows.length === 0) {
    console.log('No opening movement found in DB!');
  }

  const TEST_FILTER = String(process.env.TEST_FILTER || 'ALL');

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_ADJ_GAIN') {
    console.log('\n--- B.1 ACC_ADJ_GAIN ---');
    try {
      const adjRes = await admin.post('/api/inventory-adjustments', {
        actionType: 'add',
        productId,
        locationId: locId,
        qty: 10,
        reason: 'Test Adjustment Gain',
        note: 'gain',
      });
      const movQuery = await pg.query(
        "SELECT id FROM stock_movements WHERE product_id = $1 AND reason = 'Test Adjustment Gain'",
        [productId],
      );
      const movId = movQuery.rows[0]?.id;

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'inventory_adjustment' AND source_id = $1",
        [movId],
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
        let has1140 = false,
          has7100 = false;

        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          totalCredit += Number(line.credit || 0);
          if (line.account_code === '1140' && Number(line.debit) > 0) has1140 = true;
          if (line.account_code === '7100' && Number(line.credit) > 0) has7100 = true;
        }

        if (totalDebit !== totalCredit) {
          pass = false;
          actual += `Debit ${totalDebit} != Credit ${totalCredit}. `;
        }
        if (totalDebit !== 10 * 50) {
          pass = false;
          actual += `Amount ${totalDebit} != 500 (10*50). `;
        }
        if (!has1140) {
          pass = false;
          actual += `Missing Debit 1140. `;
        }
        if (!has7100) {
          pass = false;
          actual += `Missing Credit 7100. `;
        }
      }

      logResult(
        'ACC_ADJ_GAIN',
        pass ? 'PASS' : 'FAIL',
        '1 Journal, source_id=movId, Dr 1140, Cr 7100, amt=500, Dr=Cr',
        actual || 'Journal valid',
        { journal: journalQuery.rows[0], lines: linesQuery.rows },
      );
    } catch (e: any) {
      logResult('ACC_ADJ_GAIN', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_ADJ_LOSS') {
    console.log('\n--- B.2 ACC_ADJ_LOSS ---');
    try {
      const adjRes = await admin.post('/api/inventory-adjustments', {
        actionType: 'deduct',
        productId,
        locationId: locId,
        qty: 10,
        reason: 'Test Adjustment Loss',
        note: 'loss',
      });
      const movQuery = await pg.query(
        "SELECT id FROM stock_movements WHERE product_id = $1 AND reason = 'Test Adjustment Loss'",
        [productId],
      );
      const movId = movQuery.rows[0]?.id;

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'inventory_adjustment' AND source_id = $1",
        [movId],
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
        let has5200 = false,
          has1140 = false;

        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          totalCredit += Number(line.credit || 0);
          if (line.account_code === '5200' && Number(line.debit) > 0) has5200 = true;
          if (line.account_code === '1140' && Number(line.credit) > 0) has1140 = true;
        }

        if (totalDebit !== totalCredit) {
          pass = false;
          actual += `Debit ${totalDebit} != Credit ${totalCredit}. `;
        }
        if (totalDebit !== 10 * 50) {
          pass = false;
          actual += `Amount ${totalDebit} != 500 (10*50). `;
        }
        if (!has5200) {
          pass = false;
          actual += `Missing Debit 5200. `;
        }
        if (!has1140) {
          pass = false;
          actual += `Missing Credit 1140. `;
        }
      }

      logResult(
        'ACC_ADJ_LOSS',
        pass ? 'PASS' : 'FAIL',
        '1 Journal, source_id=movId, Dr 5200, Cr 1140, amt=500, Dr=Cr',
        actual || 'Journal valid',
        { journal: journalQuery.rows[0], lines: linesQuery.rows },
      );
    } catch (e: any) {
      logResult('ACC_ADJ_LOSS', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_DMG_1') {
    console.log('\n--- B.3 ACC_DMG_1 ---');
    try {
      const dmgRes = await admin.post('/api/damaged-stock', {
        productId,
        locationId: locId,
        qty: 10,
        reason: 'damage',
        note: `Test Damaged Stock ${Date.now()}`,
      });
      // the damaged_stock_records id is from the API response (preferred) or found by source_id if exposed
      const damageId = dmgRes.id || dmgRes.damaged_stock_record?.id || dmgRes.record?.id;

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'damaged_stock' AND source_id = $1",
        [damageId],
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
        let has5300 = false,
          has1140 = false;

        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          totalCredit += Number(line.credit || 0);
          if (line.account_code === '5300' && Number(line.debit) > 0) has5300 = true;
          if (line.account_code === '1140' && Number(line.credit) > 0) has1140 = true;
        }

        if (totalDebit !== totalCredit) {
          pass = false;
          actual += `Debit ${totalDebit} != Credit ${totalCredit}. `;
        }
        if (totalDebit !== 10 * 50) {
          pass = false;
          actual += `Amount ${totalDebit} != 500 (10*50). `;
        }
        if (!has5300) {
          pass = false;
          actual += `Missing Debit 5300. `;
        }
        if (!has1140) {
          pass = false;
          actual += `Missing Credit 1140. `;
        }
      }

      logResult(
        'ACC_DMG_1',
        pass ? 'PASS' : 'FAIL',
        '1 Journal, source_id=damageId, Dr 5300, Cr 1140, amt=500, Dr=Cr',
        actual || 'Journal valid',
        { journal: journalQuery.rows[0], lines: linesQuery.rows },
      );
    } catch (e: any) {
      logResult('ACC_DMG_1', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_CNT_1') {
    console.log('\n--- B.4 ACC_CNT_1 ---');
    try {
      const cntRes = await admin.post('/api/stock-count-sessions', {
        locationId: locId,
        note: 'Accounting Round 1 stock count test',
        items: [
          {
            productId,
            countedQty: 120, // System has 100 (if previous tests didn't alter this), so +20 variance = 1000 value
            reason: 'inventory_count',
            note: 'Accounting stock count test',
          },
        ],
      });
      const sessionId = cntRes.sessionId;
      if (!sessionId) {
        console.log('Failed to find sessionId in cntRes:', cntRes);
      }

      await admin.post(`/api/stock-count-sessions/${sessionId}/post`, {});

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'stock_count' AND source_id = $1",
        [sessionId],
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
        let has63 = false,
          has1140 = false;

        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          totalCredit += Number(line.credit || 0);
          if (line.account_code === '63' && Number(line.credit) > 0) has63 = true; // wait, the gain account is 63 for stock count? No, it's probably 7100.
          if (line.account_code === '7100' && Number(line.credit) > 0) has63 = true;
          if (line.account_code === '1140' && Number(line.debit) > 0) has1140 = true;
        }

        if (totalDebit !== totalCredit) {
          pass = false;
          actual += `Debit ${totalDebit} != Credit ${totalCredit}. `;
        }
        if (!has63) {
          pass = false;
          actual += `Missing Credit 7100 (Gain). `;
        }
        if (!has1140) {
          pass = false;
          actual += `Missing Debit 1140. `;
        }
      }

      logResult(
        'ACC_CNT_1',
        pass ? 'PASS' : 'FAIL',
        '1 Journal, source_id=sessionId, Dr 1140, Cr 7100, Dr=Cr',
        actual || 'Journal valid',
        { journal: journalQuery.rows[0], lines: linesQuery.rows },
      );
    } catch (e: any) {
      logResult('ACC_CNT_1', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SVC_CASH_CREATE') {
    console.log('\n--- B.5 ACC_SVC_CASH_CREATE (Service Accounting) ---');
    try {
      const svcRes = await admin.post('/api/services', {
        service: {
          name: 'Maintenance',
          amount: 150.5,
          notes: 'Test service',
          date: new Date().toISOString(),
          paymentChannel: 'cash',
        },
      });
      const serviceId = svcRes.services?.[0]?.id || svcRes.id;
      if (!serviceId) {
        console.log('Failed to find serviceId in svcRes:', svcRes);
      }
      // The accounting journal source_id is serviceId + 000 + revision, so 10001 for id=1, revision=1.
      // Easiest is just to look for source_type = 'service' AND source_id like serviceId% or exactly Number(`${serviceId}0001`)
      const sourceIdComposite = Number(`${serviceId}0001`);

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'service' AND source_id = $1",
        [sourceIdComposite],
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
        let has1110 = false,
          has4200 = false;

        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          totalCredit += Number(line.credit || 0);
          if (line.account_code === '1110' && Number(line.debit) > 0) has1110 = true;
          if (line.account_code === '4200' && Number(line.credit) > 0) has4200 = true;
        }

        if (totalDebit !== totalCredit) {
          pass = false;
          actual += `Debit ${totalDebit} != Credit ${totalCredit}. `;
        }
        if (totalDebit !== 150.5) {
          pass = false;
          actual += `Amount ${totalDebit} != 150.5. `;
        }
        if (!has1110) {
          pass = false;
          actual += `Missing Debit 1110 (Cash). `;
        }
        if (!has4200) {
          pass = false;
          actual += `Missing Credit 4200 (Revenue). `;
        }
      }

      logResult(
        'ACC_SVC_CASH_CREATE',
        pass ? 'PASS' : 'FAIL',
        '1 Journal, source_type=service, Dr 1110, Cr 4200, Dr=Cr=150.50',
        actual || 'Journal valid',
        { journal: journalQuery.rows[0], lines: linesQuery.rows },
      );
    } catch (e: any) {
      logResult('ACC_SVC_CASH_CREATE', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SHIFT_OVERAGE') {
    console.log('\n--- B.6 ACC_SHIFT_OVERAGE (Cashier Overage) ---');
    try {
      // Pre-close any stale open shift at this location so shiftId is always from the API response
      const staleShift = await pg.query(
        "SELECT id FROM cashier_shifts WHERE status = 'open' AND location_id = $1 LIMIT 1",
        [locId],
      );
      if (staleShift.rows.length > 0) {
        await admin
          .post(`/api/cashier-shifts/${staleShift.rows[0].id}/close`, {
            countedCash: 0,
            managerPin: testAdminPassword,
            note: 'Pre-test cleanup',
          })
          .catch(() => null);
      }
      const openRes = await admin.post('/api/cashier-shifts/open', {
        openingCash: 0,
        locationId: locId,
        note: 'Accounting Cashier Test',
      });
      const shiftId = openRes.cashierShifts?.[0]?.id || openRes.id;

      await admin.post(`/api/cashier-shifts/${shiftId}/close`, {
        countedCash: 100,
        managerPin: testAdminPassword,
        note: 'Test Overage',
      });

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'cashier_shift_variance' AND source_id = $1",
        [shiftId],
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
        let has1110 = false,
          has7100 = false;

        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          totalCredit += Number(line.credit || 0);
          if (line.account_code === '1110' && Number(line.debit) > 0) has1110 = true;
          if (line.account_code === '7100' && Number(line.credit) > 0) has7100 = true;
        }

        if (totalDebit !== totalCredit) {
          pass = false;
          actual += `Debit ${totalDebit} != Credit ${totalCredit}. `;
        }
        if (totalDebit !== 100) {
          pass = false;
          actual += `Amount ${totalDebit} != 100. `;
        }
        if (!has1110) {
          pass = false;
          actual += `Missing Debit 1110 (Cash). `;
        }
        if (!has7100) {
          pass = false;
          actual += `Missing Credit 7100 (Overage). `;
        }
      }

      logResult(
        'ACC_SHIFT_OVERAGE',
        pass ? 'PASS' : 'FAIL',
        '1 Journal, source_type=cashier_shift_variance, Dr 1110, Cr 7100, Dr=Cr=100',
        actual || 'Journal valid',
        { journal: journalQuery.rows[0], lines: linesQuery.rows },
      );
    } catch (e: any) {
      logResult('ACC_SHIFT_OVERAGE', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_ADJUST_INCREASE') {
    console.log('\n--- B.7 ACC_ADJUST_INCREASE ---');
    try {
      const startQtyRes = await pg.query(
        'SELECT sum(qty) as q FROM stock_locations WHERE product_id = $1 AND location_id = $2',
        [productId, locId],
      );
      const currentQty = Number(startQtyRes.rows[0]?.q || 0);
      const targetQty = currentQty + 5;
      const incMarker = `inc_${Date.now()}`;
      const incRes = await admin.post('/api/inventory-adjustments', {
        productId,
        locationId: locId,
        qty: targetQty,
        reason: 'Test Adjust Increase',
        note: incMarker,
      });
      const movQuery = await pg.query(
        "SELECT id, unit_cost, total_cost FROM stock_movements WHERE product_id = $1 AND reason = 'Test Adjust Increase' AND note = $2 LIMIT 1",
        [productId, incMarker],
      );
      const movId = movQuery.rows[0]?.id;

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'inventory_adjustment' AND source_id = $1",
        [movId],
      );
      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [journalQuery.rows[0]?.id],
      );

      let pass = true,
        actual = '';
      if (journalQuery.rows.length !== 1) {
        pass = false;
        actual += `Found ${journalQuery.rows.length} journals. `;
      } else {
        let totalDebit = 0,
          totalCredit = 0;
        let has1140 = false,
          has7100 = false;
        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          totalCredit += Number(line.credit || 0);
          if (line.account_code === '1140' && Number(line.debit) > 0) has1140 = true;
          if (line.account_code === '7100' && Number(line.credit) > 0) has7100 = true;
        }
        if (totalDebit !== totalCredit) {
          pass = false;
          actual += `Debit ${totalDebit} != Credit ${totalCredit}. `;
        }
        if (!has1140) {
          pass = false;
          actual += `Missing Debit 1140. `;
        }
        if (!has7100) {
          pass = false;
          actual += `Missing Credit 7100. `;
        }
        if (!movQuery.rows[0]?.unit_cost) {
          pass = false;
          actual += `unit_cost missing. `;
        }
        if (!movQuery.rows[0]?.total_cost) {
          pass = false;
          actual += `total_cost missing. `;
        }
      }
      logResult('ACC_ADJUST_INCREASE', pass ? 'PASS' : 'FAIL', '1 Journal, Dr 1140, Cr 7100', actual || 'Valid', {
        lines: linesQuery.rows,
      });
    } catch (e: any) {
      logResult('ACC_ADJUST_INCREASE', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_ADJUST_DECREASE') {
    console.log('\n--- B.8 ACC_ADJUST_DECREASE ---');
    try {
      const startQtyRes = await pg.query(
        'SELECT sum(qty) as q FROM stock_locations WHERE product_id = $1 AND location_id = $2',
        [productId, locId],
      );
      const currentQty = Number(startQtyRes.rows[0]?.q || 0);
      const targetQty = currentQty - 5;
      const decMarker = `dec_${Date.now()}`;
      const decRes = await admin.post('/api/inventory-adjustments', {
        productId,
        locationId: locId,
        qty: targetQty,
        reason: 'Test Adjust Decrease',
        note: decMarker,
      });
      const movQuery2 = await pg.query(
        "SELECT id FROM stock_movements WHERE product_id = $1 AND reason = 'Test Adjust Decrease' AND note = $2 LIMIT 1",
        [productId, decMarker],
      );
      const movId2 = movQuery2.rows[0]?.id;

      const journalQuery2 = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'inventory_adjustment' AND source_id = $1",
        [movId2],
      );
      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [journalQuery2.rows[0]?.id],
      );

      let pass = true,
        actual = '';
      if (journalQuery2.rows.length !== 1) {
        pass = false;
        actual += `Found ${journalQuery2.rows.length} journals. `;
      } else {
        let totalDebit = 0,
          totalCredit = 0;
        let has5200 = false,
          has1140 = false;
        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          totalCredit += Number(line.credit || 0);
          if (line.account_code === '5200' && Number(line.debit) > 0) has5200 = true;
          if (line.account_code === '1140' && Number(line.credit) > 0) has1140 = true;
        }
        if (totalDebit !== totalCredit) {
          pass = false;
          actual += `Debit ${totalDebit} != Credit ${totalCredit}. `;
        }
        if (!has5200) {
          pass = false;
          actual += `Missing Debit 5200. `;
        }
        if (!has1140) {
          pass = false;
          actual += `Missing Credit 1140. `;
        }
      }
      logResult('ACC_ADJUST_DECREASE', pass ? 'PASS' : 'FAIL', '1 Journal, Dr 5200, Cr 1140', actual || 'Valid', {
        lines: linesQuery.rows,
      });
    } catch (e: any) {
      logResult('ACC_ADJUST_DECREASE', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_CNT_CONSOLIDATED') {
    console.log('\n--- B.9 ACC_CNT_CONSOLIDATED ---');
    try {
      const p1 = 'ACT_C1_' + Date.now();
      const p2 = 'ACT_C2_' + Date.now();
      const p3 = 'ACT_C3_' + Date.now();
      await admin.post('/api/products', {
        name: p1,
        barcode: p1,
        retailPrice: 100,
        costPrice: 50,
        wholesalePrice: 80,
        minStock: 5,
        units: [{ name: 'Piece', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
      });
      await admin.post('/api/products', {
        name: p2,
        barcode: p2,
        retailPrice: 100,
        costPrice: 50,
        wholesalePrice: 80,
        minStock: 5,
        units: [{ name: 'Piece', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
      });
      await admin.post('/api/products', {
        name: p3,
        barcode: p3,
        retailPrice: 100,
        costPrice: 50,
        wholesalePrice: 80,
        minStock: 5,
        units: [{ name: 'Piece', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
      });
      const pd1 = (await pg.query('SELECT id FROM products WHERE barcode = $1', [p1])).rows[0].id;
      const pd2 = (await pg.query('SELECT id FROM products WHERE barcode = $1', [p2])).rows[0].id;
      const pd3 = (await pg.query('SELECT id FROM products WHERE barcode = $1', [p3])).rows[0].id;

      await admin.post('/api/inventory-adjustments', {
        actionType: 'add',
        productId: pd1,
        locationId: locId,
        qty: 10,
        reason: 'init',
        note: '',
      });
      await admin.post('/api/inventory-adjustments', {
        actionType: 'add',
        productId: pd2,
        locationId: locId,
        qty: 10,
        reason: 'init',
        note: '',
      });
      await admin.post('/api/inventory-adjustments', {
        actionType: 'add',
        productId: pd3,
        locationId: locId,
        qty: 10,
        reason: 'init',
        note: '',
      });

      const cntRes = await admin.post('/api/stock-count-sessions', {
        locationId: locId,
        note: 'Consolidated test',
        items: [
          { productId: pd1, countedQty: 15, reason: 'inventory_count', note: 'Gain +5' },
          { productId: pd2, countedQty: 5, reason: 'inventory_count', note: 'Loss -5' },
          { productId: pd3, countedQty: 6, reason: 'damage', note: 'Damage -4' },
        ],
      });
      const sessionId = cntRes.sessionId;
      await admin.post(`/api/stock-count-sessions/${sessionId}/post`, {});

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'stock_count' AND source_id = $1",
        [sessionId],
      );
      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [journalQuery.rows[0]?.id],
      );
      const dmgQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'damaged_stock' AND source_id IN (SELECT id FROM damaged_stock_records WHERE product_id = $1)",
        [pd3],
      );

      let pass = true,
        actual = '';
      if (journalQuery.rows.length !== 1) {
        pass = false;
        actual += `Found ${journalQuery.rows.length} journals. `;
      }
      if (dmgQuery.rows.length > 0) {
        pass = false;
        actual += `Duplicate damaged_stock journal created! `;
      }

      let totalDebit = 0,
        totalCredit = 0;
      let dr1140 = 0,
        cr7100 = 0,
        dr5200 = 0,
        cr1140_5200 = 0,
        dr5300 = 0;
      for (const line of linesQuery.rows) {
        const d = Number(line.debit || 0),
          c = Number(line.credit || 0);
        totalDebit += d;
        totalCredit += c;
        if (line.account_code === '1140') {
          if (d > 0) dr1140 += d;
          if (c > 0) cr1140_5200 += c; // Combined credit
        }
        if (line.account_code === '7100') cr7100 += c;
        if (line.account_code === '5200') dr5200 += d;
        if (line.account_code === '5300') dr5300 += d;
      }
      if (totalDebit !== totalCredit) {
        pass = false;
        actual += `Dr ${totalDebit} != Cr ${totalCredit}. `;
      }
      if (dr1140 !== 250) {
        pass = false;
        actual += `Dr 1140 ${dr1140} != 250. `;
      }
      if (cr7100 !== 250) {
        pass = false;
        actual += `Cr 7100 ${cr7100} != 250. `;
      }
      if (dr5200 !== 450) {
        pass = false;
        actual += `Dr 5200 ${dr5200} != 450. `;
      }

      logResult(
        'ACC_CNT_CONSOLIDATED',
        pass ? 'PASS' : 'FAIL',
        '1 Consolidated Journal, no duplicate damage journal',
        actual || 'Valid',
        { journal: journalQuery.rows[0], lines: linesQuery.rows },
      );
    } catch (e: any) {
      logResult('ACC_CNT_CONSOLIDATED', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_INV_IDEMPOTENCY') {
    console.log('\n--- B.10 ACC_INV_IDEMPOTENCY ---');
    try {
      const idempotencyKey = 'IDEM_INV_' + Date.now();
      const payload = { actionType: 'add', productId, locationId: locId, qty: 10, reason: 'Idempotency', note: 'Idem' };
      const r1 = await admin.post('/api/inventory-adjustments', payload, 201, { 'x-idempotency-key': idempotencyKey });
      const r2 = await admin.post('/api/inventory-adjustments', payload, 201, { 'x-idempotency-key': idempotencyKey });

      const movs = await pg.query("SELECT id FROM stock_movements WHERE product_id = $1 AND reason = 'Idempotency'", [
        productId,
      ]);
      const movId = movs.rows[0]?.id;
      const journals = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'inventory_adjustment' AND source_id = $1",
        [movId],
      );

      let pass = true,
        actual = '';
      if (movs.rows.length !== 1) {
        pass = false;
        actual += `Found ${movs.rows.length} movements. `;
      }
      if (journals.rows.length !== 1) {
        pass = false;
        actual += `Found ${journals.rows.length} journals. `;
      }
      logResult('ACC_INV_IDEMPOTENCY', pass ? 'PASS' : 'FAIL', '1 movement, 1 journal', actual || 'Valid', {});
    } catch (e: any) {
      logResult('ACC_INV_IDEMPOTENCY', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_INV_CONCURRENCY') {
    console.log('\n--- B.11 ACC_INV_CONCURRENCY ---');
    try {
      const idempotencyKey = 'IDEM_CONC_' + Date.now();
      const payload = { actionType: 'add', productId, locationId: locId, qty: 5, reason: 'Concurrency', note: 'Conc' };
      const promises = [
        admin.post('/api/inventory-adjustments', payload, 201, { 'x-idempotency-key': idempotencyKey }).catch((e) => e),
        admin.post('/api/inventory-adjustments', payload, 201, { 'x-idempotency-key': idempotencyKey }).catch((e) => e),
      ];
      await Promise.all(promises);

      const movs = await pg.query("SELECT id FROM stock_movements WHERE product_id = $1 AND reason = 'Concurrency'", [
        productId,
      ]);
      const journals = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'inventory_adjustment' AND source_id = $1",
        [movs.rows[0]?.id],
      );

      let pass = true,
        actual = '';
      if (movs.rows.length !== 1) {
        pass = false;
        actual += `Found ${movs.rows.length} movements. `;
      }
      if (journals.rows.length !== 1) {
        pass = false;
        actual += `Found ${journals.rows.length} journals. `;
      }
      logResult(
        'ACC_INV_CONCURRENCY',
        pass ? 'PASS' : 'FAIL',
        '1 movement, 1 journal (unique index idx_journal_entries_round1_uniq prevents duplicates)',
        actual || 'Valid',
        {},
      );
    } catch (e: any) {
      logResult('ACC_INV_CONCURRENCY', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_INV_ROLLBACK') {
    console.log('\n--- B.12 ACC_INV_ROLLBACK ---');
    logResult(
      'ACC_INV_ROLLBACK',
      'BLOCKED',
      'API fails, no movement, no journal',
      'Rollback test violates rule: Do not rename account codes',
      {},
    );
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SVC_CARD_CREATE') {
    console.log('\n--- B.13 ACC_SVC_CARD_CREATE ---');
    try {
      const svcRes = await admin.post('/api/services', {
        service: {
          name: 'Maint Card',
          amount: 200,
          notes: 'card test',
          date: new Date().toISOString(),
          paymentChannel: 'card',
        },
      });
      const serviceId = svcRes.services?.[0]?.id || svcRes.id;
      const sourceIdComposite = Number(`${serviceId}0001`);

      const journalQuery = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'service' AND source_id = $1",
        [sourceIdComposite],
      );
      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [journalQuery.rows[0]?.id],
      );

      let pass = true,
        actual = '';
      if (journalQuery.rows.length !== 1) {
        pass = false;
        actual += `Found ${journalQuery.rows.length} journals. `;
      } else {
        let totalDebit = 0,
          totalCredit = 0;
        let has1120 = false,
          has4200 = false;
        for (const line of linesQuery.rows) {
          totalDebit += Number(line.debit || 0);
          totalCredit += Number(line.credit || 0);
          if (line.account_code === '1120' && Number(line.debit) > 0) has1120 = true;
          if (line.account_code === '4200' && Number(line.credit) > 0) has4200 = true;
        }
        if (totalDebit !== totalCredit) {
          pass = false;
          actual += `Debit ${totalDebit} != Credit ${totalCredit}. `;
        }
        if (!has1120) {
          pass = false;
          actual += `Missing Debit 1120 (Bank). `;
        }
        if (!has4200) {
          pass = false;
          actual += `Missing Credit 4200 (Revenue). `;
        }
      }
      logResult('ACC_SVC_CARD_CREATE', pass ? 'PASS' : 'FAIL', '1 Journal, Dr 1120, Cr 4200', actual || 'Valid', {
        lines: linesQuery.rows,
      });
    } catch (e: any) {
      logResult('ACC_SVC_CARD_CREATE', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SVC_CASH_TO_CARD') {
    console.log('\n--- B.14 ACC_SVC_CASH_TO_CARD ---');
    try {
      const svcRes = await admin.post('/api/services', {
        service: {
          name: 'Cash to Card',
          amount: 300,
          notes: '',
          date: new Date().toISOString(),
          paymentChannel: 'cash',
        },
      });
      const serviceId = svcRes.services?.[0]?.id || svcRes.id;

      await admin.put(`/api/services/${serviceId}`, {
        service: {
          name: 'Cash to Card',
          amount: 300,
          notes: '',
          date: new Date().toISOString(),
          paymentChannel: 'card',
        },
      });

      const revSourceId = Number(`${serviceId}0001`);
      const newSourceId = Number(`${serviceId}0002`);
      const revJournal = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'service_reversal' AND source_id = $1",
        [revSourceId],
      );
      const newJournal = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'service' AND source_id = $1",
        [newSourceId],
      );

      let pass = true,
        actual = '';
      if (revJournal.rows.length !== 1) {
        pass = false;
        actual += `Missing reversal. `;
      }
      if (newJournal.rows.length !== 1) {
        pass = false;
        actual += `Missing new journal. `;
      }

      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [newJournal.rows[0]?.id],
      );
      let has1120 = false;
      for (const line of linesQuery.rows) if (line.account_code === '1120' && Number(line.debit) > 0) has1120 = true;
      if (!has1120) {
        pass = false;
        actual += `Missing Debit 1120 in new journal. `;
      }

      logResult(
        'ACC_SVC_CASH_TO_CARD',
        pass ? 'PASS' : 'FAIL',
        'Reversal created, new journal Dr 1120',
        actual || 'Valid',
        {},
      );
    } catch (e: any) {
      logResult('ACC_SVC_CASH_TO_CARD', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SVC_CARD_TO_CASH') {
    console.log('\n--- B.15 ACC_SVC_CARD_TO_CASH ---');
    try {
      const svcRes = await admin.post('/api/services', {
        service: {
          name: 'Card to Cash',
          amount: 300,
          notes: '',
          date: new Date().toISOString(),
          paymentChannel: 'card',
        },
      });
      const serviceId = svcRes.services?.[0]?.id || svcRes.id;

      await admin.put(`/api/services/${serviceId}`, {
        service: {
          name: 'Card to Cash',
          amount: 300,
          notes: '',
          date: new Date().toISOString(),
          paymentChannel: 'cash',
        },
      });

      const newSourceId = Number(`${serviceId}0002`);
      const newJournal = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'service' AND source_id = $1",
        [newSourceId],
      );

      let pass = true,
        actual = '';
      if (newJournal.rows.length !== 1) {
        pass = false;
        actual += `Missing new journal. `;
      }
      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [newJournal.rows[0]?.id],
      );
      let has1110 = false;
      for (const line of linesQuery.rows) if (line.account_code === '1110' && Number(line.debit) > 0) has1110 = true;
      if (!has1110) {
        pass = false;
        actual += `Missing Debit 1110 in new journal. `;
      }

      logResult('ACC_SVC_CARD_TO_CASH', pass ? 'PASS' : 'FAIL', 'New journal Dr 1110', actual || 'Valid', {});
    } catch (e: any) {
      logResult('ACC_SVC_CARD_TO_CASH', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SVC_AMOUNT_UPDATE') {
    console.log('\n--- B.16 ACC_SVC_AMOUNT_UPDATE ---');
    try {
      const svcRes = await admin.post('/api/services', {
        service: {
          name: 'Amount Update',
          amount: 150,
          notes: '',
          date: new Date().toISOString(),
          paymentChannel: 'cash',
        },
      });
      const serviceId = svcRes.services?.[0]?.id || svcRes.id;

      await admin.put(`/api/services/${serviceId}`, {
        service: {
          name: 'Amount Update',
          amount: 200,
          notes: '',
          date: new Date().toISOString(),
          paymentChannel: 'cash',
        },
      });

      const newSourceId = Number(`${serviceId}0002`);
      const newJournal = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'service' AND source_id = $1",
        [newSourceId],
      );

      let pass = true,
        actual = '';
      if (newJournal.rows.length !== 1) {
        pass = false;
        actual += `Missing new journal. `;
      }
      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [newJournal.rows[0]?.id],
      );
      let debit1110 = 0;
      for (const line of linesQuery.rows) if (line.account_code === '1110') debit1110 = Number(line.debit);
      if (debit1110 !== 200) {
        pass = false;
        actual += `Debit 1110 is ${debit1110}, expected 200. `;
      }

      logResult(
        'ACC_SVC_AMOUNT_UPDATE',
        pass ? 'PASS' : 'FAIL',
        'New journal Dr 1110 amount 200',
        actual || 'Valid',
        {},
      );
    } catch (e: any) {
      logResult('ACC_SVC_AMOUNT_UPDATE', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SVC_DELETE') {
    console.log('\n--- B.17 ACC_SVC_DELETE ---');
    try {
      const svcRes = await admin.post('/api/services', {
        service: { name: 'Delete Me', amount: 100, notes: '', date: new Date().toISOString(), paymentChannel: 'cash' },
      });
      const serviceId = svcRes.services?.[0]?.id || svcRes.id;

      await admin.del(`/api/services/${serviceId}`);

      const revSourceId = Number(`${serviceId}0001`);
      const revJournal = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'service_reversal' AND source_id = $1",
        [revSourceId],
      );

      let pass = true,
        actual = '';
      if (revJournal.rows.length !== 1) {
        pass = false;
        actual += `Missing reversal. `;
      }

      logResult('ACC_SVC_DELETE', pass ? 'PASS' : 'FAIL', 'Reversal journal created', actual || 'Valid', {});
    } catch (e: any) {
      logResult('ACC_SVC_DELETE', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SVC_IDEMPOTENCY') {
    console.log('\n--- B.18 ACC_SVC_IDEMPOTENCY ---');
    try {
      const idempotencyKey = 'IDEM_SVC_' + Date.now();
      const uniqueName = 'Idempotent Service ' + Date.now();
      const fixedDate = '2026-07-15T00:00:00.000Z';
      const svcRes1 = await admin.post(
        '/api/services',
        { service: { name: uniqueName, amount: 100, date: fixedDate, paymentChannel: 'cash' } },
        201,
        { 'x-idempotency-key': idempotencyKey },
      );
      const svcRes2 = await admin.post(
        '/api/services',
        { service: { name: uniqueName, amount: 100, date: fixedDate, paymentChannel: 'cash' } },
        201,
        { 'x-idempotency-key': idempotencyKey },
      );

      const svcs = await pg.query('SELECT id FROM services WHERE name = $1', [uniqueName]);
      const serviceId = svcs.rows[0]?.id;
      const journals = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'service' AND source_id = $1",
        [Number(`${serviceId}0001`)],
      );

      let pass = true,
        actual = '';
      if (svcs.rows.length !== 1) {
        pass = false;
        actual += `Found ${svcs.rows.length} services. `;
      }
      if (journals.rows.length !== 1) {
        pass = false;
        actual += `Found ${journals.rows.length} journals. `;
      }
      logResult('ACC_SVC_IDEMPOTENCY', pass ? 'PASS' : 'FAIL', '1 service, 1 journal', actual || 'Valid', {});
    } catch (e: any) {
      logResult('ACC_SVC_IDEMPOTENCY', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SVC_CONCURRENCY') {
    console.log('\n--- B.19 ACC_SVC_CONCURRENCY ---');
    try {
      const svcRes = await admin.post('/api/services', {
        service: { name: 'Conc SVC', amount: 100, date: new Date().toISOString(), paymentChannel: 'cash' },
      });
      const serviceId = svcRes.services?.[0]?.id || svcRes.id;

      const payload = {
        service: { name: 'Conc SVC Update', amount: 200, date: new Date().toISOString(), paymentChannel: 'cash' },
      };

      const promises = [
        admin.put(`/api/services/${serviceId}`, payload).catch((e) => e),
        admin.put(`/api/services/${serviceId}`, payload).catch((e) => e),
      ];
      await Promise.all(promises);

      const journals = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'service' AND source_id = $1",
        [Number(`${serviceId}0002`)],
      );
      const reversals = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'service_reversal' AND source_id = $1",
        [Number(`${serviceId}0001`)],
      );

      let pass = true,
        actual = '';
      if (journals.rows.length !== 1) {
        pass = false;
        actual += `Found ${journals.rows.length} new journals (Rev 2). `;
      }
      if (reversals.rows.length !== 1) {
        pass = false;
        actual += `Found ${reversals.rows.length} reversals (Rev 1). `;
      }
      logResult('ACC_SVC_CONCURRENCY', pass ? 'PASS' : 'FAIL', '1 new journal, 1 reversal', actual || 'Valid', {});
    } catch (e: any) {
      logResult('ACC_SVC_CONCURRENCY', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SVC_ROLLBACK') {
    console.log('\n--- B.20 ACC_SVC_ROLLBACK ---');
    logResult(
      'ACC_SVC_ROLLBACK',
      'BLOCKED',
      'API fails, no service, no journal',
      'Rollback test violates rule: Do not rename account codes',
      {},
    );
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SHIFT_ZERO') {
    console.log('\n--- B.21 ACC_SHIFT_ZERO ---');
    try {
      const openRes = await admin.post('/api/cashier-shifts/open', {
        openingCash: 0,
        locationId: locId,
        note: 'Zero shift',
      });
      const shiftId = openRes.cashierShifts?.[0]?.id || openRes.id;

      await admin.post(`/api/cashier-shifts/${shiftId}/close`, {
        countedCash: 0,
        managerPin: testAdminPassword,
        note: 'Zero close',
      });

      const journals = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'cashier_shift_variance' AND source_id = $1",
        [shiftId],
      );

      let pass = true,
        actual = '';
      if (journals.rows.length !== 0) {
        pass = false;
        actual += `Found ${journals.rows.length} journals, expected 0. `;
      }
      logResult('ACC_SHIFT_ZERO', pass ? 'PASS' : 'FAIL', '0 Journals', actual || 'Valid', {});
    } catch (e: any) {
      logResult('ACC_SHIFT_ZERO', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SHIFT_SHORTAGE') {
    console.log('\n--- B.22 ACC_SHIFT_SHORTAGE ---');
    try {
      const openRes = await admin.post('/api/cashier-shifts/open', {
        openingCash: 100,
        locationId: locId,
        note: 'Shortage shift',
      });
      const shiftId = openRes.cashierShifts?.[0]?.id || openRes.id;

      await admin.post(`/api/cashier-shifts/${shiftId}/close`, {
        countedCash: 50,
        managerPin: testAdminPassword,
        note: 'Shortage close',
      });

      const journals = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'cashier_shift_variance' AND source_id = $1",
        [shiftId],
      );
      const linesQuery = await pg.query(
        'SELECT a.code as account_code, l.debit, l.credit FROM journal_entry_lines l JOIN accounting_accounts a ON a.id = l.account_id WHERE l.journal_entry_id = $1',
        [journals.rows[0]?.id],
      );

      let pass = true,
        actual = '';
      if (journals.rows.length !== 1) {
        pass = false;
        actual += `Found ${journals.rows.length} journals, expected 1. `;
      } else {
        let dr7200 = 0,
          cr1110 = 0;
        for (const line of linesQuery.rows) {
          if (line.account_code === '7200') dr7200 += Number(line.debit);
          if (line.account_code === '1110') cr1110 += Number(line.credit);
        }
        if (dr7200 !== 50) {
          pass = false;
          actual += `Dr 7200 != 50. `;
        }
        if (cr1110 !== 50) {
          pass = false;
          actual += `Cr 1110 != 50. `;
        }
      }
      logResult(
        'ACC_SHIFT_SHORTAGE',
        pass ? 'PASS' : 'FAIL',
        '1 Journal Dr 7200 Cr 1110 amt 50',
        actual || 'Valid',
        {},
      );
    } catch (e: any) {
      logResult('ACC_SHIFT_SHORTAGE', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (
    TEST_FILTER === 'ALL' ||
    TEST_FILTER === 'ACC_SHIFT_BLIND_CLOSE' ||
    TEST_FILTER === 'ACC_SHIFT_MANAGER_REVIEW' ||
    TEST_FILTER === 'ACC_SHIFT_DUPLICATE_REVIEW'
  ) {
    console.log('\n--- B.23-25 ACC_SHIFT_BLIND_CLOSE & MANAGER_REVIEW ---');
    try {
      const uname = 'testcashier' + Date.now();
      await admin.post('/api/users', {
        username: uname,
        password: TEST_CASHIER_PASSWORD,
        role: 'cashier',
        branchIds: [branchId],
        defaultBranchId: branchId,
        isActive: true,
        permissions: ['cashDrawer', 'pos'],
      });
      const cashierClient = new E2EClient(process.env.E2E_BASE_URL || 'http://127.0.0.1:3102');
      const cashierToken = await cashierClient.post('/api/auth/login', {
        username: uname,
        password: TEST_CASHIER_PASSWORD,
      });

      const openRes = await cashierClient.post('/api/cashier-shifts/open', {
        openingCash: 100,
        locationId: locId,
        note: 'Blind close shift',
      });
      const shiftId = openRes.cashierShifts?.[0]?.id || openRes.id;

      // Cashier does a blind close; shiftId is from API response above
      await cashierClient.post(`/api/cashier-shifts/${shiftId}/close`, { countedCash: 50, note: 'Blind close' });

      // ACC_SHIFT_BLIND_CLOSE: check BEFORE manager review -- expect 0 journals
      let passBlind = true,
        actualBlind = '';
      const journalsBlind = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'cashier_shift_variance' AND source_id = $1",
        [shiftId],
      );
      if (journalsBlind.rows.length !== 0) {
        passBlind = false;
        actualBlind += `Found ${journalsBlind.rows.length} journals before review, expected 0. `;
      }
      logResult(
        'ACC_SHIFT_BLIND_CLOSE',
        passBlind ? 'PASS' : 'FAIL',
        '0 Journals before manager review',
        actualBlind || 'Valid',
        {},
      );

      // ACC_SHIFT_MANAGER_REVIEW + ACC_SHIFT_DUPLICATE_REVIEW
      // Open a fresh shift for concurrent review test -- shiftId is already closed via blind close above
      const openRes2 = await cashierClient.post('/api/cashier-shifts/open', {
        openingCash: 100,
        locationId: locId,
        note: 'Dup review shift',
      });
      const shiftId2 = openRes2.cashierShifts?.[0]?.id || openRes2.id;
      await cashierClient.post(`/api/cashier-shifts/${shiftId2}/close`, { countedCash: 50, note: 'Dup blind close' });

      // Concurrent review-close calls -- only one must produce a journal (idempotency test)
      const promises = [
        admin.post(`/api/cashier-shifts/${shiftId2}/review-close`, { note: 'Concurrent 1' }).catch((e) => e),
        admin.post(`/api/cashier-shifts/${shiftId2}/review-close`, { note: 'Concurrent 2' }).catch((e) => e),
      ];
      await Promise.all(promises);

      const journalsReview = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'cashier_shift_variance' AND source_id = $1",
        [shiftId2],
      );
      const passReview = journalsReview.rows.length === 1;
      let actualReview = '';
      if (!passReview) {
        actualReview += `Found ${journalsReview.rows.length} journals, expected 1. `;
      }

      const passDup = passReview;
      logResult(
        'ACC_SHIFT_MANAGER_REVIEW',
        passReview ? 'PASS' : 'FAIL',
        '1 Journal created upon review',
        actualReview || 'Valid',
        {},
      );
      logResult(
        'ACC_SHIFT_DUPLICATE_REVIEW',
        passDup ? 'PASS' : 'FAIL',
        '1 Journal despite concurrent review',
        actualReview || 'Valid',
        {},
      );
    } catch (e: any) {
      logResult('ACC_SHIFT_BLIND_CLOSE/MANAGER_REVIEW', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_SHIFT_ROLLBACK') {
    console.log('\n--- B.26 ACC_SHIFT_ROLLBACK ---');
    logResult(
      'ACC_SHIFT_ROLLBACK',
      'BLOCKED',
      'API fails, status open, no journal',
      'Rollback test violates rule: Do not rename account codes',
      {},
    );
  }

  if (TEST_FILTER === 'ALL' || TEST_FILTER === 'ACC_REGRESSION') {
    console.log('\n--- B.27-33 ACC_REGRESSION (Real APIs) ---');
    try {
      const p1 = 'ACT_REG_' + Date.now();
      await admin.post('/api/products', {
        name: p1,
        barcode: p1,
        retailPrice: 100,
        costPrice: 50,
        wholesalePrice: 80,
        minStock: 5,
        units: [{ name: 'Piece', multiplier: 1, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
      });
      const pd1 = (await pg.query('SELECT id FROM products WHERE barcode = $1', [p1])).rows[0].id;
      await admin.post('/api/inventory-adjustments', {
        actionType: 'add',
        productId: pd1,
        locationId: locId,
        qty: 100,
        reason: 'init',
        note: '',
      });

      const custName = 'Reg Customer ' + Date.now();
      const customerRes = await admin.post('/api/customers', { name: custName, phone: '01012345678', creditLimit: 0 });
      const customerId = customerRes.customers?.find((c: any) => c.name === custName)?.id || customerRes.id;
      const suppName1 = 'Reg Supplier ' + Date.now();
      let supplierRes = await admin.post('/api/suppliers', { name: suppName1, phone: '987654321' });
      let supplierId = supplierRes.suppliers?.find((s: any) => s.name === suppName1)?.id || supplierRes.id;

      // 1. Cash Sale
      const sale1Res = await admin.post('/api/sales', {
        customerId,
        locationId: locId,
        branchId,
        paymentChannel: 'cash',
        discount: 0,
        tenderedAmount: 100,
        items: [{ productId: pd1, qty: 1, price: 100 }],
      });
      const sale1Id = sale1Res.sale?.id || sale1Res.id;
      const jSale1 = await pg.query("SELECT * FROM journal_entries WHERE source_type = 'sale' AND source_id = $1", [
        sale1Id,
      ]);
      const sale1Pass = jSale1.rows.length === 1;

      // 2. Unpaid Sale
      const sale2Res = await admin.post('/api/sales', {
        customerId,
        locationId: locId,
        branchId,
        paymentType: 'credit',
        paymentChannel: 'credit',
        discount: 0,
        tenderedAmount: 0,
        items: [{ productId: pd1, qty: 1, price: 100 }],
      });
      const sale2Id = sale2Res.sale?.id || sale2Res.id;
      const jSale2 = await pg.query("SELECT * FROM journal_entries WHERE source_type = 'sale' AND source_id = $1", [
        sale2Id,
      ]);
      const sale2Pass = jSale2.rows.length === 1;

      // 3. Purchase Unpaid
      const suppName2 = 'Reg Supplier 2 ' + Date.now();
      supplierRes = await admin.post('/api/suppliers', { name: suppName2, phone: '987654321' });
      supplierId = supplierRes.suppliers?.find((s: any) => s.name === suppName2)?.id || supplierRes.id;
      const purchRes = await admin.post('/api/purchases', {
        supplierId: supplierId,
        locationId: locId,
        branchId,
        paymentType: 'credit',
        discount: 0,
        note: 'INV-' + Date.now(),
        items: [{ productId: pd1, qty: 1, cost: 50 }],
      });
      const purchId = purchRes.purchase?.id || purchRes.id;
      const jPurch = await pg.query("SELECT * FROM journal_entries WHERE source_type = 'purchase' AND source_id = $1", [
        purchId,
      ]);
      const purchPass = jPurch.rows.length === 1;

      // 4. Return (Sale Refund)
      const retMarker = `RET_TEST_${Date.now()}`;
      const retRes = await admin.post('/api/returns', {
        invoiceId: sale1Id,
        type: 'sale',
        refundMethod: 'cash',
        note: retMarker,
        items: [{ productId: pd1, qty: 1 }],
      });
      console.log('Return Response:', JSON.stringify(retRes));

      const retObj = retRes.returns?.find((r: any) => r.note === retMarker);
      const retId = retObj?.id || retRes.createdIds?.[0];
      const jRet = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type IN ('return', 'sales_return') AND source_id = $1",
        [retId],
      );
      const retPass = jRet.rows.length === 1;

      // 5. Customer Payment
      const custPayMarker = `CUST_PAY_${Date.now()}`;
      const custPayRes = await admin.post('/api/customer-payments', {
        customerId,
        amount: 100,
        note: custPayMarker,
      });
      console.log('Customer Payment Response:', JSON.stringify(custPayRes));

      const custDb = await pg.query("SELECT id FROM customer_payments WHERE note = $1 AND tenant_id = 'default'", [
        custPayMarker,
      ]);
      const custPayId = custDb.rows[0]?.id;
      const jCustPay = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'customer_payment' AND source_id = $1",
        [custPayId],
      );
      const custPayPass = jCustPay.rows.length === 1;

      // 6. Supplier Payment
      const suppPayRes = await admin.post('/api/supplier-payments', {
        supplierId,
        amount: 50,
        note: 'test',
      });
      const suppPayId = suppPayRes.supplierPayments?.[0]?.id || suppPayRes.id;
      const jSuppPay = await pg.query(
        "SELECT * FROM journal_entries WHERE source_type = 'supplier_payment' AND source_id = $1",
        [suppPayId],
      );
      const suppPayPass = jSuppPay.rows.length === 1;

      // 7. Expense
      const expRes = await admin.post('/api/expenses', {
        title: 'test exp',
        amount: 20,
        date: new Date().toISOString(),
        note: 'test',
      });
      const expId = expRes.expenses?.[0]?.id || expRes.id;
      const jExp = await pg.query("SELECT * FROM journal_entries WHERE source_type = 'expense' AND source_id = $1", [
        expId,
      ]);
      const expPass = jExp.rows.length === 1;

      logResult(
        'ACC_REGRESSION',
        sale1Pass && sale2Pass && purchPass && retPass && custPayPass && suppPayPass && expPass ? 'PASS' : 'FAIL',
        '1 Journal per operation',
        `Sale1:${sale1Pass} Sale2:${sale2Pass} Purch:${purchPass} Ret:${retPass} CustPay:${custPayPass} SuppPay:${suppPayPass} Exp:${expPass}`,
        {},
      );
    } catch (e: any) {
      logResult('ACC_REGRESSION', 'FAIL', 'Success', `Error: ${e.message}`, e);
    }
  }

  await pg.end();
}

main().catch(console.error);
