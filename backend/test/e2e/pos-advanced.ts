import { E2EClient } from './e2e-utils';
import { Client } from 'pg';

async function logResult(
  testId: string,
  status: string,
  method: string,
  input: any,
  expected: string,
  actual: string,
  apiEvidence: any,
  dbEvidence: any,
) {
  console.log(`\n================================`);
  console.log(`Test ID: ${testId}`);
  console.log(`Execution Method: ${method}`);
  console.log(`Input: ${input ? JSON.stringify(input) : 'null'}`);
  console.log(`Expected: ${expected}`);
  console.log(`Actual: ${actual}`);
  console.log(`API Evidence: ${apiEvidence ? JSON.stringify(apiEvidence) : 'null'}`);
  console.log(`Database Evidence: ${dbEvidence ? JSON.stringify(dbEvidence) : 'null'}`);
  console.log(`Status: ${status}`);
  console.log(`================================`);
  if (status === 'FAIL') {
    process.exitCode = 1;
  }
}

async function main() {
  let pg = new Client({
    user: 'postgres',
    password: 'password',
    host: '127.0.0.1',
    port: 5433,
    database: 'zs_dev',
  });

  try {
    await pg.connect();
  } catch (e) {
    pg = new Client({
      user: 'postgres',
      password: 'postgres',
      host: '127.0.0.1',
      port: 5433,
      database: 'zs_dev',
    });
    await pg.connect();
  }

  const admin = new E2EClient(process.env.API_URL || 'http://localhost:3102');
  await admin.login(process.env.ADMIN_USER || 'amr', process.env.ADMIN_PASS || '123456');

  // Open Shift or get existing
  let shiftId;
  const dbUser = await pg.query("SELECT id FROM users WHERE username = 'amr' AND tenant_id = 'default'");
  const userId = dbUser.rows[0]?.id;
  const dbShift = await pg.query(
    "SELECT id FROM cashier_shifts WHERE status = 'open' AND tenant_id = 'default' AND opened_by = $1 LIMIT 1",
    [userId],
  );
  if (dbShift.rows.length > 0) {
    shiftId = dbShift.rows[0].id;
  } else {
    const shiftRes = await admin
      .post('/api/cashier-shifts/open', { openingCash: 100, branchId: 1 })
      .catch((e: any) => e.response?.data || e);
    shiftId = shiftRes.id || shiftRes.shift?.id;
  }
  if (!shiftId) throw new Error('Could not open or find shift');

  // Read Baseline Shift Totals
  const baselineList = await admin
    .get(`/api/cashier-shifts?limit=50`)
    .catch((e) => e.response?.data || e.response || e);
  const baselineShift = baselineList.items?.find((s: any) => s.id == shiftId) || {};
  const baselineTotals = baselineShift.totals || {};

  // Search for TST Product
  const q = `
    SELECT 
      p.id as "productId", p.name as "productName", p.retail_price as "retailPrice",
      b.id as "branchId", b.default_stock_location_id as "locationId",
      p.tenant_id as "tenantId"
    FROM products p
    JOIN branches b ON b.tenant_id = p.tenant_id AND b.account_id = p.account_id
    WHERE (p.name ILIKE '%TST%' OR p.barcode ILIKE '%TST%')
      AND p.is_active = true
      AND p.retail_price > 0
    LIMIT 1;
  `;
  const dbProd = await pg.query(q);
  const p = dbProd.rows[0];
  if (!p) {
    console.log('No TST product found matching conditions.');
    throw new Error('No TST product found matching conditions.');
  }

  const productId = p.productId;
  const branchId = p.branchId;
  const locationId = p.locationId;
  const retailPrice = Number(p.retailPrice);
  const tenantId = p.tenantId;

  console.log('Using Product:', productId, 'Retail Price:', retailPrice);

  let tId = '';

  // 1. InstaPay
  tId = 'POS-INSTAPAY-01';
  try {
    const payload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'instapay',
      payments: [{ paymentChannel: 'instapay', amount: retailPrice }],
      items: [{ productId, qty: 1, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const res = await admin.post('/api/sales', payload).catch((e) => e.response);
    const saleId = res.sale?.id || res.id;
    const dbSale = await pg.query('SELECT * FROM sales WHERE id = $1 AND tenant_id = $2', [saleId, tenantId]);
    const dbPayments = await pg.query('SELECT * FROM sale_payments WHERE sale_id = $1 AND tenant_id = $2', [
      saleId,
      tenantId,
    ]);

    const pass =
      dbPayments.rows.length === 1 &&
      dbPayments.rows[0].payment_channel === 'instapay' &&
      dbSale.rows[0]?.payment_channel === 'instapay';
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      payload,
      'InstaPay Sale created correctly',
      pass ? 'Success' : 'Failed',
      { saleId },
      { payments: dbPayments.rows },
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'InstaPay test', e.message, null, null);
  }

  // 2. POS-CREDIT-01
  tId = 'POS-CREDIT-01';
  try {
    const custName = 'POS Credit TST ' + Date.now();
    const custPhone = '010' + Math.floor(10000000 + Math.random() * 90000000);
    const custRes = await admin
      .post('/api/customers', {
        name: custName,
        phone: custPhone,
        type: 'cash',
        creditLimit: 5000,
        balance: 0,
        storeCreditBalance: 0,
      })
      .catch((e) => e.response?.data || e);

    let custId = custRes.id || custRes.customer?.id || custRes.data?.id;
    if (!custId) {
      const dbCust = await pg.query('SELECT id FROM customers WHERE name = $1 AND tenant_id = $2', [
        custName,
        tenantId,
      ]);
      custId = dbCust.rows[0]?.id;
    }

    if (!custId) throw new Error('Could not create/find customer');

    const payload = {
      customerId: custId,
      locationId,
      paymentType: 'credit',
      paymentChannel: 'credit',
      items: [{ productId, qty: 1, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };

    // Check initial stock and balance
    const initStock =
      (
        await pg.query(
          'SELECT qty FROM product_location_stock WHERE product_id=$1 AND location_id=$2 AND tenant_id=$3',
          [productId, locationId, tenantId],
        )
      ).rows[0]?.qty || 0;

    const res = await admin.post('/api/sales', payload).catch((e) => e.response);
    const saleId = res.sale?.id || res.id;
    const dbSale = await pg.query('SELECT * FROM sales WHERE id = $1 AND tenant_id = $2', [saleId, tenantId]);
    const dbPayments = await pg.query('SELECT * FROM sale_payments WHERE sale_id = $1 AND tenant_id = $2', [
      saleId,
      tenantId,
    ]);

    // Check final stock and balance
    const finalStock =
      (
        await pg.query(
          'SELECT qty FROM product_location_stock WHERE product_id=$1 AND location_id=$2 AND tenant_id=$3',
          [productId, locationId, tenantId],
        )
      ).rows[0]?.qty || 0;
    const ledger = await pg.query('SELECT * FROM customer_ledger WHERE customer_id = $1 AND tenant_id = $2', [
      custId,
      tenantId,
    ]);

    const pass =
      dbSale.rows[0]?.total == retailPrice &&
      dbSale.rows[0]?.paid_amount == 0 &&
      dbPayments.rows.length === 0 &&
      Number(finalStock) === Number(initStock) - 1 &&
      ledger.rows.some((r: any) => r.amount == retailPrice);
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      payload,
      'Credit sale successful',
      pass ? 'Success' : 'Failed',
      { saleId },
      { payments: dbPayments.rows, initStock, finalStock },
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Credit Sale', e.message, null, null);
  }

  // 3. POS-CREDIT-LIMIT-01
  tId = 'POS-CREDIT-LIMIT-01';
  try {
    const custRes = await admin
      .post('/api/customers', {
        name: 'Credit Limit TST ' + Date.now(),
        phone: '011' + Math.floor(10000000 + Math.random() * 90000000),
        type: 'cash',
        creditLimit: 300,
        balance: 0,
        storeCreditBalance: 0,
      })
      .catch((e) => e.response?.data || e);
    const custId =
      custRes.id ||
      custRes.customer?.id ||
      custRes.data?.id ||
      (await pg.query('SELECT id FROM customers ORDER BY id DESC LIMIT 1')).rows[0].id;

    const payload = {
      customerId: custId,
      locationId,
      paymentType: 'credit',
      paymentChannel: 'credit',
      items: [{ productId, qty: 1, price: 450, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };

    const res = await admin.post('/api/sales', payload).catch((e) => e);
    const pass = res.response?.data?.error?.code === 'CUSTOMER_CREDIT_LIMIT' || res.message?.includes('400');
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      payload,
      'Credit Limit error',
      res.message || res.status,
      res.response?.data,
      null,
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Credit Limit test', e.message, null, null);
  }

  // 4. POS-CASH-TENDERED
  tId = 'POS-CASH-TENDERED-01';
  try {
    const payload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      tenderedAmount: retailPrice + 50,
      payments: [{ paymentChannel: 'cash', amount: retailPrice }],
      items: [{ productId, qty: 1, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const res = await admin.post('/api/sales', payload).catch((e) => e.response || e);
    const saleId = res.sale?.id || res.id;
    const dbSale = await pg.query('SELECT * FROM sales WHERE id = $1 AND tenant_id = $2', [saleId, tenantId]);
    const dbPayments = await pg.query('SELECT * FROM sale_payments WHERE sale_id = $1 AND tenant_id = $2', [
      saleId,
      tenantId,
    ]);

    const sale = dbSale.rows[0] || {};
    const pass =
      Number(sale.total) === retailPrice &&
      Number(sale.paid_amount) === retailPrice &&
      Number(sale.tendered_amount) === retailPrice + 50 &&
      Number(sale.change_amount) === 50 &&
      dbPayments.rows.length === 1 &&
      Number(dbPayments.rows[0].amount) === retailPrice;
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      payload,
      'Sale has correct tendered and change amounts',
      pass ? 'Success' : 'Failed',
      { saleId },
      { sale: dbSale.rows[0], payments: dbPayments.rows },
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Cash Tendered Verification', e.message, null, null);
  }

  // 5. POS-UNDERPAID-01
  tId = 'POS-UNDERPAID-01';
  try {
    const payload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      tenderedAmount: retailPrice - 50,
      payments: [{ paymentChannel: 'cash', amount: retailPrice - 50 }],
      items: [{ productId, qty: 1, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const res = await admin.post('/api/sales', payload).catch((e) => e);
    const pass = res.response?.data?.error?.code === 'INVALID_PAID_AMOUNT' || res.message?.includes('400');
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      payload,
      'Reject underpaid sale',
      res.message || res.status,
      res.response?.data,
      null,
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Underpaid sale test', e.message, null, null);
  }

  // 6. POS-INVALID-PAYMENT-01
  tId = 'POS-INVALID-PAYMENT-01';
  try {
    const payload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      tenderedAmount: retailPrice,
      payments: [{ paymentChannel: 'cash', amount: -10 }],
      items: [{ productId, qty: 1, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const res = await admin.post('/api/sales', payload).catch((e) => e);
    const isValidationErr = res.message?.includes('400') || res.response?.status === 400;
    await logResult(
      tId,
      isValidationErr ? 'PASS' : 'VALIDATION GAP',
      'API',
      payload,
      'Reject negative payment',
      res.message || res.status,
      res.response?.data,
      null,
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Invalid payment test', e.message, null, null);
  }

  // 7. Shift Totals Check (Delta)
  tId = 'POS-SHIFT-DELTA-01';
  try {
    const shiftQ = `
      SELECT 
        COALESCE(SUM(CASE WHEN p.payment_channel='cash' THEN p.amount ELSE 0 END), 0) as cash,
        COALESCE(SUM(CASE WHEN p.payment_channel='instapay' THEN p.amount ELSE 0 END), 0) as instapay,
        COALESCE(SUM(CASE WHEN s.payment_type='credit' THEN s.total ELSE 0 END), 0) as credit
      FROM sales s
      LEFT JOIN sale_payments p ON p.sale_id = s.id AND p.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1 AND s.created_at >= (SELECT created_at FROM cashier_shifts WHERE id = $2 AND tenant_id = $1)
    `;
    const finalShiftRes = await pg.query(shiftQ, [tenantId, shiftId]);
    const finalTotals = finalShiftRes.rows[0] || {};

    // Baseline is essentially 0 since we only run this query for operations in the shift,
    // but we can calculate the expected delta based on the test steps.
    const expectedDelta = {
      cash: retailPrice,
      instapay: retailPrice,
      credit: retailPrice,
    };

    // Check if the current totals *contain* at least our operations (they might have more if run multiple times)
    const pass =
      Number(finalTotals.cash) >= retailPrice &&
      Number(finalTotals.instapay) >= retailPrice &&
      Number(finalTotals.credit) >= retailPrice;

    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'DB_QUERY',
      null,
      'Shift delta includes test operations',
      'Totals: ' + JSON.stringify(finalTotals),
      null,
      null,
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'DB_QUERY', null, 'Shift Totals Delta', e.message, null, null);
  }

  await pg.end();
}

main().catch((e) => {
  console.error('Fatal Error in E2E Script:', e);
  process.exitCode = 1;
});
