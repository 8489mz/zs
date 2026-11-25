import { E2EClient } from './e2e-utils';
import { Client } from 'pg';
import * as fs from 'fs';

async function main() {
  const admin = new E2EClient();
  await admin.login('amr', '123456');

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

  const tenantId = 'default';

  // Helper to log test output
  async function logResult(
    testId: string,
    status: string,
    execMethod: string,
    input: any,
    expected: string,
    actualMsg: string,
    apiEvidence: any,
    dbEvidence: any,
  ) {
    console.log(
      `\n================================\nTest ID: ${testId}\nExecution Method: ${execMethod}\nInput: ${input ? JSON.stringify(input) : 'null'}\nExpected: ${expected}\nActual: ${actualMsg}\nAPI Evidence: ${apiEvidence ? JSON.stringify(apiEvidence) : 'null'}\nDatabase Evidence: ${dbEvidence ? JSON.stringify(dbEvidence) : 'null'}\nStatus: ${status}\n================================`,
    );
  }

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
    const shiftRes = await admin.post('/api/cashier-shifts/open', { branchId: 1, openingCash: 1000 });
    shiftId = shiftRes.id;
  }

  // Search for TST Product
  const q = `
    SELECT p.id as product_id, p.name, p.retail_price, l.id as location_id, b.id as branch_id, pls.qty
    FROM products p
    JOIN product_location_stock pls ON p.id = pls.product_id
    JOIN stock_locations l ON pls.location_id = l.id
    JOIN branches b ON l.branch_id = b.id
    WHERE p.tenant_id = $1 AND (p.name LIKE '%TST%' OR p.barcode LIKE '%TST%') 
      AND p.is_active = true AND p.retail_price > 0 AND pls.qty > 50
    ORDER BY pls.qty DESC LIMIT 1
  `;
  const tstRes = await pg.query(q, [tenantId]);
  if (tstRes.rows.length === 0) throw new Error('No TST product found with sufficient stock > 50');

  const product = tstRes.rows[0];
  const productId = Number(product.product_id);
  const locationId = Number(product.location_id);
  const retailPrice = Number(product.retail_price);

  console.log(`Using Product: ${productId} Retail Price: ${retailPrice} Available Qty: ${product.qty}`);

  let tId = '';

  // ==========================================
  // RET-CASH-01: Partial Cash Return
  // ==========================================
  tId = 'RET-CASH-01';
  try {
    // 1. Sell 5 items
    const salePayload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: 5, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const saleRes = await admin.post('/api/sales', salePayload);
    const saleId = Number(saleRes.sale?.id || saleRes.id || saleRes.saleId);

    const initStockRes = await pg.query(
      'SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2 AND tenant_id = $3',
      [productId, locationId, tenantId],
    );
    const initStock = Number(initStockRes.rows[0].qty);

    // 2. Return 2 items
    const returnPayload = {
      type: 'sale',
      invoiceId: saleId,
      settlementMode: 'refund',
      refundMethod: 'cash',
      items: [{ productId, qty: 2 }],
    };

    const returnRes = await admin.post('/api/returns', returnPayload);
    const returnDocumentId = returnRes.createdIds[0];

    const finalStockRes = await pg.query(
      'SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2 AND tenant_id = $3',
      [productId, locationId, tenantId],
    );
    const finalStock = Number(finalStockRes.rows[0].qty);

    const treasuryRes = await pg.query(
      'SELECT * FROM treasury_transactions WHERE return_document_id = $1 AND tenant_id = $2',
      [returnDocumentId, tenantId],
    );
    const dbTreasury = treasuryRes.rows[0] || {};

    const pass =
      finalStock === initStock + 2 && treasuryRes.rows.length === 1 && Number(dbTreasury.amount) === -(retailPrice * 2);
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      returnPayload,
      'Stock returned by 2, treasury deducted by 2 * price',
      pass ? 'Success' : 'Failed',
      { returnDocumentId },
      { initStock, finalStock, treasuryAmount: dbTreasury.amount },
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Cash partial return', e.message, null, null);
  }

  // ==========================================
  // RET-CARD-01: Card Return
  // ==========================================
  tId = 'RET-CARD-01';
  try {
    // 1. Sell 2 items via card
    const salePayload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'card',
      items: [{ productId, qty: 2, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const saleRes = await admin.post('/api/sales', salePayload);
    const saleId = Number(saleRes.sale?.id || saleRes.id || saleRes.saleId);

    const initStockRes = await pg.query(
      'SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2 AND tenant_id = $3',
      [productId, locationId, tenantId],
    );
    const initStock = Number(initStockRes.rows[0].qty);

    // 2. Return 1 item
    const returnPayload = {
      type: 'sale',
      invoiceId: saleId,
      settlementMode: 'refund',
      refundMethod: 'card',
      items: [{ productId, qty: 1 }],
    };

    const returnRes = await admin.post('/api/returns', returnPayload);
    const returnDocumentId = returnRes.createdIds[0];

    const finalStockRes = await pg.query(
      'SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2 AND tenant_id = $3',
      [productId, locationId, tenantId],
    );
    const finalStock = Number(finalStockRes.rows[0].qty);

    const treasuryRes = await pg.query(
      'SELECT * FROM treasury_transactions WHERE return_document_id = $1 AND tenant_id = $2',
      [returnDocumentId, tenantId],
    );

    const pass = finalStock === initStock + 1 && treasuryRes.rows.length === 0;
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      returnPayload,
      'Stock returned by 1, NO treasury deduction for card',
      pass ? 'Success' : 'Failed',
      { returnDocumentId },
      { initStock, finalStock, treasuryRows: treasuryRes.rows.length },
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Card partial return', e.message, null, null);
  }

  // ==========================================
  // RET-CREDIT-01: Credit Sale Return
  // ==========================================
  tId = 'RET-CREDIT-01';
  try {
    const custRes = await admin
      .post('/api/customers', {
        name: 'Return Credit TST ' + Date.now(),
        phone: '011' + Math.floor(10000000 + Math.random() * 90000000),
        type: 'cash',
        creditLimit: 5000,
        balance: 0,
        storeCreditBalance: 0,
      })
      .catch((e) => e.response?.data || e);
    const custId =
      custRes.id ||
      custRes.customer?.id ||
      custRes.data?.id ||
      (await pg.query('SELECT id FROM customers ORDER BY id DESC LIMIT 1')).rows[0].id;

    // 1. Sell 3 items via credit
    const salePayload = {
      customerId: custId,
      locationId,
      paymentType: 'credit',
      paymentChannel: 'credit',
      items: [{ productId, qty: 3, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const saleRes = await admin.post('/api/sales', salePayload);
    const saleId = Number(saleRes.sale?.id || saleRes.id || saleRes.saleId);

    // 2. Return 1 item
    const returnPayload = {
      type: 'sale',
      invoiceId: saleId,
      settlementMode: 'refund',
      refundMethod: 'cash', // Even if cash is sent, it should reduce credit balance according to service logic.
      items: [{ productId, qty: 1 }],
    };

    const returnRes = await admin.post('/api/returns', returnPayload);
    const returnDocumentId = returnRes.createdIds[0];

    const custDbRes = await pg.query('SELECT balance FROM customers WHERE id = $1 AND tenant_id = $2', [
      custId,
      tenantId,
    ]);
    const finalBalance = Number(custDbRes.rows[0].balance);
    const expectedBalance = retailPrice * 2;

    const pass = finalBalance === expectedBalance;
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      returnPayload,
      `Customer balance should be ${expectedBalance}`,
      pass ? 'Success' : 'Failed',
      { returnDocumentId },
      { finalBalance },
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Credit partial return', e.message, null, null);
  }

  // ==========================================
  // RET-OVER-01: Returning more than sold
  // ==========================================
  tId = 'RET-OVER-01';
  try {
    // 1. Sell 1 item
    const salePayload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: 1, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const saleRes = await admin.post('/api/sales', salePayload);
    const saleId = Number(saleRes.sale?.id || saleRes.id || saleRes.saleId);

    // 2. Try to return 2 items
    const returnPayload = {
      type: 'sale',
      invoiceId: saleId,
      settlementMode: 'refund',
      refundMethod: 'cash',
      items: [{ productId, qty: 2 }],
    };

    const returnRes = await admin.post('/api/returns', returnPayload).catch((e) => e);
    const pass =
      returnRes.response?.data?.error?.code === 'RETURN_QTY_EXCEEDS_INVOICE' || returnRes.message?.includes('400');
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      returnPayload,
      'Reject over return',
      returnRes.message || returnRes.status,
      returnRes.response?.data,
      null,
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Over return', e.message, null, null);
  }

  // ==========================================
  // RET-CUMULATIVE-01: Cumulative Returns
  // ==========================================
  tId = 'RET-CUMULATIVE-01';
  try {
    // 1. Sell 2 items
    const salePayload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: 2, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const saleRes = await admin.post('/api/sales', salePayload);
    const saleId = Number(saleRes.sale?.id || saleRes.id || saleRes.saleId);

    // 2. Return 1 item
    await admin.post('/api/returns', {
      type: 'sale',
      invoiceId: saleId,
      settlementMode: 'refund',
      refundMethod: 'cash',
      items: [{ productId, qty: 1 }],
    });

    // 3. Try to return 2 items
    const returnPayload = {
      type: 'sale',
      invoiceId: saleId,
      settlementMode: 'refund',
      refundMethod: 'cash',
      items: [{ productId, qty: 2 }],
    };
    const returnRes = await admin.post('/api/returns', returnPayload).catch((e) => e);

    const pass =
      returnRes.response?.data?.error?.code === 'RETURN_QTY_EXCEEDS_INVOICE' || returnRes.message?.includes('400');
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      returnPayload,
      'Reject second return that exceeds remaining',
      returnRes.message || returnRes.status,
      returnRes.response?.data,
      null,
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Cumulative return', e.message, null, null);
  }

  // ==========================================
  // RET-WEIGHTED-01: Weighted Return
  // ==========================================
  tId = 'RET-WEIGHTED-01';
  try {
    const salePayload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: 0.5, price: retailPrice, unitName: 'KG', unitMultiplier: 1, priceType: 'retail' }],
    };
    const saleRes = await admin.post('/api/sales', salePayload);
    const saleId = Number(saleRes.sale?.id || saleRes.id || saleRes.saleId);

    const initStockRes = await pg.query(
      'SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2 AND tenant_id = $3',
      [productId, locationId, tenantId],
    );
    const initStock = Number(initStockRes.rows[0].qty);

    const returnPayload = {
      type: 'sale',
      invoiceId: saleId,
      settlementMode: 'refund',
      refundMethod: 'cash',
      items: [{ productId, qty: 0.135 }],
    };
    const returnRes = await admin.post('/api/returns', returnPayload);

    const finalStockRes = await pg.query(
      'SELECT qty FROM product_location_stock WHERE product_id = $1 AND location_id = $2 AND tenant_id = $3',
      [productId, locationId, tenantId],
    );
    const finalStock = Number(finalStockRes.rows[0].qty);

    // Check that precision is correct
    const expectedDiff = 0.135;
    const actualDiff = Number((finalStock - initStock).toFixed(3));

    const pass = actualDiff === expectedDiff;
    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API',
      returnPayload,
      `Stock returned exactly 0.135`,
      pass ? 'Success' : 'Failed',
      { returnRes },
      { initStock, finalStock, actualDiff },
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Weighted return', e.message, null, null);
  }

  // ==========================================
  // RET-IDEM-01: Idempotent Return
  // ==========================================
  tId = 'RET-IDEM-01';
  try {
    const salePayload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: 10, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const saleRes = await admin.post('/api/sales', salePayload);
    const saleId = Number(saleRes.sale?.id || saleRes.id || saleRes.saleId);

    const returnPayload = {
      type: 'sale',
      invoiceId: saleId,
      settlementMode: 'refund',
      refundMethod: 'cash',
      items: [{ productId, qty: 5 }],
    };
    const idempotencyKey = 'RET-IDEM-KEY-' + Date.now();

    // 1. Send first request and wait
    const res1 = await (admin as any).request('POST', '/api/returns', returnPayload, {
      'x-idempotency-key': idempotencyKey,
    });

    // 2. Send second request after the first completes
    const res2 = await (admin as any).request('POST', '/api/returns', returnPayload, {
      'x-idempotency-key': idempotencyKey,
    });

    // 3. Send third request after a brief delay
    await new Promise((r) => setTimeout(r, 2000));
    const res3 = await (admin as any).request('POST', '/api/returns', returnPayload, {
      'x-idempotency-key': idempotencyKey,
    });

    const r1 = { status: res1.response.status, body: res1.json };
    const r2 = { status: res2.response.status, body: res2.json };
    const r3 = { status: res3.response.status, body: res3.json };

    const dbReturns = await pg.query('SELECT * FROM return_documents WHERE invoice_id = $1', [saleId]);
    const dbIdem = await pg.query(
      'SELECT status, response_payload, operation_type, tenant_id, account_id FROM operation_executions WHERE idempotency_key = $1',
      [idempotencyKey],
    );

    const idemRow = dbIdem.rows[0] || {};
    const pass =
      dbReturns.rowCount === 1 &&
      r1.status === 201 &&
      r2.status === 201 &&
      r3.status === 201 &&
      idemRow.status === 'committed';

    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API Sequential Same Key',
      null,
      `Only 1 Return Document, all 201`,
      pass ? 'Success' : 'Failed',
      { r1, r2, r3, idempotencyOp: idemRow },
      { returnDocs: dbReturns.rowCount },
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Idempotency', e.message, null, null);
  }

  // ==========================================
  // RET-CONCURRENT-LIMIT-01: Exceed Qty via Concurrency
  // ==========================================
  tId = 'RET-CONCURRENT-LIMIT-01';
  try {
    const salePayload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: 10, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const saleRes = await admin.post('/api/sales', salePayload);
    const saleId = Number(saleRes.sale?.id || saleRes.id || saleRes.saleId);

    const returnPayload = {
      type: 'sale',
      invoiceId: saleId,
      settlementMode: 'refund',
      refundMethod: 'cash',
      items: [{ productId, qty: 6 }],
    };

    // Concurrent requests with DIFFERENT idempotency keys
    const req1 = (admin as any).request('POST', '/api/returns', returnPayload, {
      'x-idempotency-key': 'KEY-1-' + Date.now(),
    });
    const req2 = (admin as any).request('POST', '/api/returns', returnPayload, {
      'x-idempotency-key': 'KEY-2-' + Date.now(),
    });
    const [res1, res2] = await Promise.all([req1, req2]);

    const r1 = res1.json;
    const r2 = res2.json;

    const dbReturns = await pg.query('SELECT * FROM return_documents WHERE invoice_id = $1', [saleId]);

    // One must succeed, one must fail with RETURN_QTY_EXCEEDED (or 400 validation)
    const successCount = (res1.response.status === 201 ? 1 : 0) + (res2.response.status === 201 ? 1 : 0);
    const pass = successCount === 1 && dbReturns.rowCount === 1;

    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API Concurrent Different Keys',
      null,
      `Only 1 succeeds`,
      pass ? 'Success' : 'Failed',
      { res1: r1, res2: r2 },
      { returnDocs: dbReturns.rowCount },
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Concurrent Limits', e.message, null, null);
  }

  // ==========================================
  // RET-CONCURRENT-VALID-01: Valid Concurrency
  // ==========================================
  tId = 'RET-CONCURRENT-VALID-01';
  try {
    const salePayload = {
      customerId: null,
      locationId,
      paymentType: 'cash',
      paymentChannel: 'cash',
      items: [{ productId, qty: 10, price: retailPrice, unitName: 'Piece', unitMultiplier: 1, priceType: 'retail' }],
    };
    const saleRes = await admin.post('/api/sales', salePayload);
    const saleId = Number(saleRes.sale?.id || saleRes.id || saleRes.saleId);

    const returnPayload = {
      type: 'sale',
      invoiceId: saleId,
      settlementMode: 'refund',
      refundMethod: 'cash',
      items: [{ productId, qty: 5 }],
    };

    // Concurrent requests with DIFFERENT idempotency keys, total qty = 10 (valid)
    const req1 = (admin as any).request('POST', '/api/returns', returnPayload, {
      'x-idempotency-key': 'KEY-VALID-1-' + Date.now(),
    });
    const req2 = (admin as any).request('POST', '/api/returns', returnPayload, {
      'x-idempotency-key': 'KEY-VALID-2-' + Date.now(),
    });
    const [res1, res2] = await Promise.all([req1, req2]);

    const r1 = res1.json;
    const r2 = res2.json;

    const dbReturns = await pg.query('SELECT * FROM return_documents WHERE invoice_id = $1', [saleId]);

    const successCount = (res1.response.status === 201 ? 1 : 0) + (res2.response.status === 201 ? 1 : 0);
    const pass = successCount === 2 && dbReturns.rowCount === 2;

    await logResult(
      tId,
      pass ? 'PASS' : 'FAIL',
      'API Concurrent Valid',
      null,
      `Both succeed`,
      pass ? 'Success' : 'Failed',
      { res1: r1, res2: r2 },
      { returnDocs: dbReturns.rowCount },
    );
  } catch (e: any) {
    await logResult(tId, 'BLOCKED', 'API', null, 'Concurrent Valid', e.message, null, null);
  }

  await pg.end();
}

main().catch(console.error);
