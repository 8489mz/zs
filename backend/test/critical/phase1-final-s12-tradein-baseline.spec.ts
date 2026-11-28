import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TradeInService } from '../../src/modules/tradein/tradein.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AppError } from '../../src/common/errors/app-error';

/*
 * Phase 1 final-inspection slice 12 — baseline spec for the tradein
 * module (one of the 10 modules with zero primary specs on 95858d5).
 *
 * GROUNDING (live code, read before writing):
 * - TradeInService (tradein/tradein.service.ts) — the cash-purchase
 *   path (postTradeInCashPurchase) posts a treasury expense, writes
 *   the stock movement + serial, and (when autoAddToInventory) creates
 *   the used device as a new product. The exchange path already has
 *   its own spec (tradein-exchange.spec.ts, wired here); this spec
 *   proves the OTHER transaction type.
 * - FIXTURE_DDL is copied verbatim from tradein-exchange.spec.ts
 *   (same service, same tables — the slim harness DDL that matches
 *   the columns the service actually writes); buildService uses the
 *   real TransactionHelper like that spec.
 *
 * WHAT THIS PROVES (real service on PGlite):
 * - Cash purchase happy path: doc number TRD-YYMMDD-####, treasury
 *   expense -500 cash, stock movement 'tradein_in' qty 1, serial
 *   registered in_stock at cost 500, product auto-created with
 *   track_serials, posting stub called once, list/get round-trip.
 * - Guards: duplicate in-stock serial -> 409
 *   TRADEIN_DUPLICATE_SERIAL; invalid price -> 400
 *   TRADEIN_COST_INVALID; unsupported type -> 422
 *   TRADEIN_TYPE_UNSUPPORTED; cash with no product and no auto-add
 *   -> 422 TRADEIN_POSTING_UNSUPPORTED; bank channel recorded.
 * - Delete: a zero-impact draft deletes; a valued posted purchase
 *   refuses with 409 TRADEIN_REVERSAL_REQUIRED; deleting twice ->
 *   404 TRADEIN_NOT_FOUND.
 *
 * NOT RUN: the exchange path (its own spec), UI, live Postgres.
 */

const FIXTURE_DDL = `
  CREATE TABLE trade_in_transactions (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    doc_no VARCHAR(60) NOT NULL,
    seller_name VARCHAR(255) NOT NULL,
    seller_phone VARCHAR(50) NOT NULL,
    seller_national_id VARCHAR(30) NOT NULL,
    device_brand VARCHAR(100),
    device_model VARCHAR(150) NOT NULL,
    serial_number VARCHAR(120) NOT NULL,
    imei_2 VARCHAR(120),
    device_condition_notes TEXT,
    agreed_purchase_price NUMERIC(14, 3) NOT NULL DEFAULT 0,
    transaction_type VARCHAR(50) NOT NULL DEFAULT 'cash_purchase',
    created_product_id INTEGER,
    sale_id INTEGER,
    payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
    signature_data TEXT,
    branch_id INTEGER,
    location_id INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    barcode VARCHAR(255),
    cost_price NUMERIC(14, 3) NOT NULL DEFAULT 0,
    retail_price NUMERIC(14, 3) NOT NULL DEFAULT 0,
    wholesale_price NUMERIC(14, 3) NOT NULL DEFAULT 0,
    stock_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
    min_stock_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    track_serials BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    reserved_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE product_location_stock (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    branch_id INTEGER,
    location_id INTEGER,
    qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
    reserved_qty NUMERIC(14, 3) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE stock_movements (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL,
    movement_type VARCHAR(50) NOT NULL,
    qty NUMERIC(14, 3) NOT NULL,
    before_qty NUMERIC(14, 3),
    after_qty NUMERIC(14, 3),
    unit_cost NUMERIC(14, 3),
    total_cost NUMERIC(14, 3),
    reason TEXT,
    note TEXT,
    reference_type VARCHAR(50),
    reference_id INTEGER,
    branch_id INTEGER,
    location_id INTEGER,
    created_by INTEGER,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    import_receipt_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE product_serials (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    serial_number VARCHAR(255) NOT NULL,
    imei_2 VARCHAR(255),
    status VARCHAR(50) NOT NULL,
    cost_price NUMERIC(14, 3),
    branch_id INTEGER,
    location_id INTEGER,
    notes TEXT,
    sale_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE treasury_transactions (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    txn_type VARCHAR(50) NOT NULL,
    amount NUMERIC(14, 3) NOT NULL,
    payment_channel VARCHAR(50) NOT NULL,
    note TEXT,
    reference_type VARCHAR(100),
    reference_id INTEGER,
    branch_id INTEGER,
    location_id INTEGER,
    created_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE sales (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    status VARCHAR(50) NOT NULL,
    doc_no VARCHAR(60),
    customer_id INTEGER,
    total NUMERIC(14, 3) NOT NULL DEFAULT 0,
    paid_amount NUMERIC(14, 3) NOT NULL DEFAULT 0,
    store_credit_used NUMERIC(14, 3) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE settings (
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT
  );
  CREATE TABLE currency_exchange_rates (
    tenant_id TEXT NOT NULL,
    currency_code VARCHAR(3) NOT NULL,
    exchange_rate NUMERIC NOT NULL,
    is_base BOOLEAN NOT NULL DEFAULT FALSE
  );
`;

function basePayload(overrides: Record<string, unknown> = {}): any {
  return {
    sellerName: 'أحمد محمد',
    sellerPhone: '01012345678',
    sellerNationalId: '29501011234567',
    deviceBrand: 'Samsung',
    deviceModel: 'Galaxy S21',
    serialNumber: 'IMEI-CASH-1',
    agreedPurchasePrice: 500,
    transactionType: 'cash_purchase',
    paymentMethod: 'cash',
    autoAddToInventory: true,
    deviceConditionNotes: 'حالة جيدة',
    ...overrides,
  };
}

const auth = {
  tenantId: 't1',
  accountId: 'a1',
  userId: 7,
  username: 'admin',
  role: 'admin',
  permissions: [],
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(FIXTURE_DDL);
  return { pg, db };
}

function buildService(db: Kysely<Database>): { service: TradeInService; posting: { calls: number } } {
  const posting = {
    calls: 0,
    postTradeInCashPurchase: async () => {
      posting.calls += 1;
      return {};
    },
    postTradeInExchange: async () => {
      posting.calls += 1;
      return {};
    },
  };
  const audit = { log: async () => undefined };
  const service = new TradeInService(db, new TransactionHelper(), audit as any, posting as any);
  return { service, posting };
}

async function expectAppError(promise: Promise<unknown>, code: string, status: number): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AppError, `expected AppError, got ${String(error)}`);
    const appError = error as AppError;
    assert.equal(appError.code, code, `expected code ${code}, got ${appError.code}`);
    assert.equal(appError.statusCode, status, `expected status ${status}, got ${appError.statusCode}`);
    return;
  }
  assert.fail(`expected AppError ${code}, but the call succeeded`);
}

async function main(): Promise<void> {
  // ---- Part A: cash purchase happy path ----
  {
    const { pg, db } = await makeDb();
    try {
      const { service, posting } = buildService(db);
      const created = await service.createTransaction(basePayload(), auth);
      assert.ok(/^TRD-\d{6}-\d{4}$/.test(created.docNo), `doc number is TRD-YYMMDD-####, got ${created.docNo}`);
      const txnId = Number(created.id);
      const fetchedCreated = await service.getTransaction(txnId, auth);
      assert.equal(fetchedCreated.transaction.agreedPurchasePrice, 500, 'the agreed price is 500');

      const txn = await pg.query<{ transaction_type: string; payment_method: string; created_product_id: string }>(
        `SELECT transaction_type, payment_method, created_product_id FROM trade_in_transactions WHERE id=$1`,
        [txnId],
      );
      assert.equal(txn.rows[0].transaction_type, 'cash_purchase', 'the transaction is a cash purchase');
      assert.equal(txn.rows[0].payment_method, 'cash', 'the payment method is cash');
      assert.ok(txn.rows[0].created_product_id, 'the device was auto-added as a product');

      const productId = Number(txn.rows[0].created_product_id);
      const product = await pg.query<{ name: string; cost_price: string; track_serials: boolean; stock_qty: string }>(
        `SELECT name, cost_price, track_serials, stock_qty FROM products WHERE id=$1`,
        [productId],
      );
      assert.equal(product.rows[0].name, 'Samsung Galaxy S21 (مستعمل)', 'the product name marks the device as used');
      assert.equal(Number(product.rows[0].cost_price), 500, 'the product cost is the agreed price');
      assert.equal(product.rows[0].track_serials, true, 'the product tracks serials');
      assert.equal(Number(product.rows[0].stock_qty), 1, 'the product has one unit in stock');

      const movement = await pg.query<{
        movement_type: string;
        qty: string;
        reference_type: string;
        reference_id: number;
      }>(`SELECT movement_type, qty, reference_type, reference_id FROM stock_movements WHERE product_id=$1`, [
        productId,
      ]);
      assert.equal(movement.rows.length, 1, 'one stock movement exists');
      assert.equal(movement.rows[0].movement_type, 'tradein_in', 'the movement is a trade-in receipt');
      assert.equal(Number(movement.rows[0].qty), 1, 'one unit was received');
      assert.equal(movement.rows[0].reference_type, 'trade_in', 'the movement references a trade-in');
      assert.equal(Number(movement.rows[0].reference_id), txnId, 'the movement references the transaction');

      const serial = await pg.query<{ status: string; cost_price: string }>(
        `SELECT status, cost_price FROM product_serials WHERE product_id=$1`,
        [productId],
      );
      assert.equal(serial.rows.length, 1, 'one serial is registered');
      assert.equal(serial.rows[0].status, 'in_stock', 'the serial is in stock');
      assert.equal(Number(serial.rows[0].cost_price), 500, 'the serial cost is the agreed price');

      const treasury = await pg.query<{
        txn_type: string;
        amount: string;
        payment_channel: string;
        reference_type: string;
        reference_id: number;
      }>(`SELECT txn_type, amount, payment_channel, reference_type, reference_id FROM treasury_transactions`);
      assert.equal(treasury.rows.length, 1, 'one treasury row exists');
      assert.equal(treasury.rows[0].txn_type, 'expense', 'the cash purchase posts a treasury expense');
      assert.equal(Number(treasury.rows[0].amount), -500, 'the expense is -500');
      assert.equal(treasury.rows[0].payment_channel, 'cash', 'the expense channel is cash');
      assert.equal(treasury.rows[0].reference_type, 'trade_in', 'the expense references a trade-in');
      assert.equal(Number(treasury.rows[0].reference_id), txnId, 'the expense references the transaction');

      assert.equal(posting.calls, 1, 'the posting stub was called once');

      const listed = await service.listTransactions(auth);
      assert.equal(listed.pagination.totalItems, 1, 'one transaction is listed');
      assert.equal(listed.transactions[0].docNo, created.docNo, 'the listed transaction is the created one');
      const fetched = await service.getTransaction(txnId, auth);
      assert.equal(fetched.transaction.serialNumber, 'IMEI-CASH-1', 'get returns the serial');
    } finally {
      await db.destroy();
    }
    console.log('  cash purchase happy path passed');
  }

  // ---- Part B: guards ----
  {
    const { db } = await makeDb();
    try {
      const { service } = buildService(db);

      await service.createTransaction(basePayload(), auth);
      await expectAppError(service.createTransaction(basePayload(), auth), 'TRADEIN_DUPLICATE_SERIAL', 409);
      await expectAppError(
        service.createTransaction(basePayload({ serialNumber: 'IMEI-CASH-2', agreedPurchasePrice: -5 }), auth),
        'TRADEIN_COST_INVALID',
        400,
      );
      await expectAppError(
        service.createTransaction(basePayload({ serialNumber: 'IMEI-CASH-3', transactionType: 'gift' }), auth),
        'TRADEIN_TYPE_UNSUPPORTED',
        422,
      );
      await expectAppError(
        service.createTransaction(basePayload({ serialNumber: 'IMEI-CASH-4', autoAddToInventory: false }), auth),
        'TRADEIN_POSTING_UNSUPPORTED',
        422,
      );
      const bank = await service.createTransaction(
        basePayload({ serialNumber: 'IMEI-CASH-5', paymentMethod: 'bank' }),
        auth,
      );
      assert.ok(bank.id, 'a bank-channel cash purchase creates');
    } finally {
      await db.destroy();
    }
    console.log('  cash purchase guards passed');
  }

  // ---- Part C: delete rules ----
  {
    const { db } = await makeDb();
    try {
      const { service } = buildService(db);

      const draft = await service.createTransaction(
        basePayload({ serialNumber: 'IMEI-CASH-9', agreedPurchasePrice: 0, autoAddToInventory: false }),
        auth,
      );
      const removed = await service.deleteTransaction(Number(draft.id), auth);
      assert.equal(removed.ok, true, 'a zero-impact draft deletes');
      await expectAppError(service.deleteTransaction(Number(draft.id), auth), 'TRADEIN_NOT_FOUND', 404);

      const valued = await service.createTransaction(basePayload({ serialNumber: 'IMEI-CASH-10' }), auth);
      await expectAppError(service.deleteTransaction(Number(valued.id), auth), 'TRADEIN_REVERSAL_REQUIRED', 409);
    } finally {
      await db.destroy();
    }
    console.log('  delete rules passed');
  }

  console.log('phase1 final slice 12 tradein baseline passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
