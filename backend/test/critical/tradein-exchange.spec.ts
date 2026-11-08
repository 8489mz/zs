/*
New file: backend/test/critical/tradein-exchange.spec.ts
Pins batch M3 package 10 (review P2-8: exchange was rejected).

THE GAP: any exchange (transaction_type != 'cash_purchase' with
agreed > 0) was rejected 422 TRADEIN_POSTING_UNSUPPORTED, and
trade_in_transactions.sale_id existed but was only client-supplied —
nothing validated it, so an exchange could never link the new-device
sale it settles against.

THE FIX (tradein module only — service + DTO):
- transaction_type 'exchange_trade_in' is accepted. It MUST link a
  sale_id that references an existing, posted sale of the same tenant
  (missing -> 422 TRADEIN_EXCHANGE_SALE_REQUIRED; unknown or
  other-tenant sale -> 404 TRADEIN_EXCHANGE_SALE_NOT_FOUND; a sale
  that is not posted -> 422 TRADEIN_EXCHANGE_SALE_NOT_POSTED).
- A valued exchange must stock the used device (linked product or
  auto-add) or it is rejected 422 TRADEIN_EXCHANGE_PRODUCT_REQUIRED.
- The exchange reuses the cash path's intake machinery unchanged
  (advisory lock on tenant+serial, duplicate-serial rejection,
  in-stock serial check, product link / auto-create, stock delta,
  WAC valuation, serial registration, atomic transaction,
  delete-block once posted) and stores payment_method 'exchange'.
- The exchange posts NO cash payout (no treasury row) and never
  calls postTradeInCashPurchase.

POSTING DECISION D-M3-P10-1 (recorded, see package report): the
exchange posts NO journal in this package. The accounts exist and
are resolvable cleanly (Dr 1140 inventory / Cr 1130 receivable via
the public resolveSystemAccountByCode + postDomainJournal), so the
account side is NOT the blocker. The blockers are:
 (A) the remaining-receivable cap has no clean source inside this
     package: the authoritative formula lives in
     PaymentAllocationService.sumReversedLiabilities (private) plus
     return_documents.refund_allocations parsing; re-implementing
     it in tradein.service.ts would duplicate a money formula. The
     postSale-time formula alone can over-credit 1130 when the
     linked sale already has returns.
 (B) the sale flow cannot absorb the credit: payment-allocation,
     getOpenInvoices and dunning derive a sale's remaining from
     sales.paid_amount / store_credit_used / returns only — they
     never read trade-in journals. A GL-only credit would leave the
     sale showing the full amount still collectible (double
     collection), and bumping sales.paid_amount would misstate cash
     collected. Absorbing the credit needs a sales/allocation-domain
     change outside this package's file list.
A missing journal with this recorded open question is the
acceptable outcome; a wrong (unabsorbed / uncapped) journal is not.
Follow-up package: teach the allocation readers to subtract posted
trade-in exchange credits for the linked sale (or add a dedicated
credit record), then post Dr 1140 / Cr 1130 capped at the remaining
receivable through postDomainJournal.

WHAT THIS PINS, driving the REAL service on PGlite (Part A):
- Exchange happy path: accepted, linked to the posted sale, intake
  stocked (+1, WAC = agreed), serial registered in_stock, ZERO
  treasury rows, posting stub never called, payment_method
  'exchange'; the linked sale row itself is untouched.
- Missing / other-tenant / non-posted sale rejected with the named
  codes above; valued exchange without a product rejected.
- Cash path unchanged: cash_purchase still writes its treasury
  expense row, still calls postTradeInCashPurchase once, still
  stores payment_method 'cash'.
- Duplicate-serial guard still rejects a second intake while the
  serial is in stock; delete of an exchange is blocked
  (TRADEIN_REVERSAL_REQUIRED).
- DTO: saleId is required (and >= 1) exactly for exchanges, and
  transaction_type is restricted to cash_purchase /
  exchange_trade_in.
- Pure helper assertExchangeSaleLink: null -> 404, non-posted ->
  422, posted -> no throw.

NOT pinned here: the real-journal cash proof (already covered by
backend/test/acceptance/core-accounting.postgres.spec.ts, trade-in
section). Part B below is the CI-only live-Postgres rerun of the
transactional flow (advisory lock + row lock + tx) in an isolated
schema; it also SKIPs without ACCEPTANCE_DATABASE_URL.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TradeInService, assertExchangeSaleLink } from '../../src/modules/tradein/tradein.service';
import { UpsertTradeInDto } from '../../src/modules/tradein/dto/upsert-tradein.dto';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';

const AUTH = { tenantId: 't1', accountId: 'a1', userId: 1 } as any;

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

type PostingStub = {
  calls: number;
  postTradeInCashPurchase: (...args: unknown[]) => Promise<number>;
};

function buildService(db: Kysely<Database>): { service: TradeInService; posting: PostingStub } {
  const posting: PostingStub = {
    calls: 0,
    postTradeInCashPurchase: async () => {
      posting.calls += 1;
      return 1;
    },
  };
  const service = new TradeInService(
    db as any,
    new TransactionHelper(),
    { log: async () => undefined } as any,
    posting as any,
  );
  return { service, posting };
}

function basePayload(overrides: Record<string, unknown> = {}): any {
  return {
    sellerName: 'Ahmed',
    sellerPhone: '01000000000',
    sellerNationalId: '12345678901234',
    deviceBrand: 'Samsung',
    deviceModel: 'Galaxy S21',
    serialNumber: 'IMEI-EX-1',
    agreedPurchasePrice: 500,
    transactionType: 'exchange_trade_in',
    autoAddToInventory: true,
    ...overrides,
  };
}

async function assertRejectsCode(promise: Promise<unknown>, code: string, status?: number): Promise<void> {
  try {
    await promise;
  } catch (error: any) {
    assert.equal(
      error?.code,
      code,
      `expected rejection ${code}, got ${error?.code}: ${error?.message}`,
    );
    if (status !== undefined) assert.equal(error?.statusCode, status);
    return;
  }
  assert.fail(`expected rejection with ${code}, but the call succeeded`);
}

async function insertSale(
  exec: (query: string, params?: unknown[]) => Promise<any>,
  tenantId: string,
  status: string,
): Promise<number> {
  const res = await exec(
    `INSERT INTO sales (tenant_id, account_id, status, doc_no, total, paid_amount)
     VALUES ($1, 'a1', $2, 'INV-1', 2000, 0) RETURNING id`,
    [tenantId, status],
  );
  return Number(res.rows[0].id);
}

async function runPartA(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(FIXTURE_DDL);
    const { service, posting } = buildService(db);
    const query = (text: string, params?: unknown[]) => pg.query(text, params as any);

    const postedSaleId = await insertSale(query, 't1', 'posted');
    const draftSaleId = await insertSale(query, 't1', 'draft');
    const otherTenantSaleId = await insertSale(query, 't2', 'posted');

    // Exchange happy path: accepted, linked, stocked, no cash out.
    const created = await service.createTransaction(
      basePayload({ saleId: postedSaleId }),
      AUTH,
    );
    assert.equal(created.ok, true);
    const exchangeId = Number(created.id);
    assert.match(created.docNo, /^TRD-\d{6}-\d{4}$/);
    const row = await db
      .selectFrom('trade_in_transactions')
      .select(['transaction_type', 'sale_id', 'payment_method', 'created_product_id', 'agreed_purchase_price'])
      .where('id', '=', exchangeId)
      .executeTakeFirstOrThrow();
    assert.equal(row.transaction_type, 'exchange_trade_in');
    assert.equal(Number(row.sale_id), postedSaleId);
    assert.equal(row.payment_method, 'exchange', 'an exchange records no payout rail');
    assert.equal(Number(row.agreed_purchase_price), 500);
    assert.ok(Number(row.created_product_id) > 0, 'auto-created product is linked');

    // Intake machinery reused: +1 stock, WAC = agreed, serial in stock.
    const product = await db
      .selectFrom('products')
      .select(['stock_qty', 'cost_price', 'track_serials'])
      .where('id', '=', Number(row.created_product_id))
      .executeTakeFirstOrThrow();
    assert.equal(Number(product.stock_qty), 1);
    assert.equal(Number(product.cost_price), 500);
    assert.equal(product.track_serials, true);
    const movement = await db
      .selectFrom('stock_movements')
      .select(['movement_type', 'qty', 'total_cost', 'reference_type', 'reference_id'])
      .where('reference_type', '=', 'trade_in')
      .where('reference_id', '=', exchangeId)
      .executeTakeFirstOrThrow();
    assert.equal(movement.movement_type, 'tradein_in');
    assert.equal(Number(movement.qty), 1);
    assert.equal(Number(movement.total_cost), 500);
    const serial = await db
      .selectFrom('product_serials')
      .select(['status', 'serial_number'])
      .where('serial_number', '=', 'IMEI-EX-1')
      .executeTakeFirstOrThrow();
    assert.equal(serial.status, 'in_stock');

    // No cash payout and no posting call for the exchange (D-M3-P10-1).
    const treasuryRows = await db
      .selectFrom('treasury_transactions')
      .select('id')
      .where('reference_type', '=', 'trade_in')
      .where('reference_id', '=', exchangeId)
      .execute();
    assert.equal(treasuryRows.length, 0, 'exchange must not write a treasury payout');
    assert.equal(posting.calls, 0, 'exchange must not call postTradeInCashPurchase');

    // The linked sale row itself is untouched (no paid_amount bump:
    // a trade-in credit is not cash collected).
    const saleAfter = await db
      .selectFrom('sales')
      .select(['paid_amount', 'status'])
      .where('id', '=', postedSaleId)
      .executeTakeFirstOrThrow();
    assert.equal(Number(saleAfter.paid_amount), 0);
    assert.equal(saleAfter.status, 'posted');

    // getTransaction exposes the link.
    const fetched = await service.getTransaction(exchangeId, AUTH);
    assert.equal(fetched.transaction.saleId, String(postedSaleId));
    assert.equal(fetched.transaction.transactionType, 'exchange_trade_in');

    // Sale-link validation: missing / other-tenant / non-posted sale.
    await assertRejectsCode(
      service.createTransaction(basePayload({ serialNumber: 'IMEI-EX-2', saleId: 999999 }), AUTH),
      'TRADEIN_EXCHANGE_SALE_NOT_FOUND',
      404,
    );
    await assertRejectsCode(
      service.createTransaction(basePayload({ serialNumber: 'IMEI-EX-3', saleId: otherTenantSaleId }), AUTH),
      'TRADEIN_EXCHANGE_SALE_NOT_FOUND',
      404,
    );
    await assertRejectsCode(
      service.createTransaction(basePayload({ serialNumber: 'IMEI-EX-4', saleId: draftSaleId }), AUTH),
      'TRADEIN_EXCHANGE_SALE_NOT_POSTED',
      422,
    );
    await assertRejectsCode(
      service.createTransaction(basePayload({ serialNumber: 'IMEI-EX-5' }), AUTH),
      'TRADEIN_EXCHANGE_SALE_REQUIRED',
      422,
    );
    // Valued exchange with nowhere to stock the device.
    await assertRejectsCode(
      service.createTransaction(
        basePayload({ serialNumber: 'IMEI-EX-6', saleId: postedSaleId, autoAddToInventory: false }),
        AUTH,
      ),
      'TRADEIN_EXCHANGE_PRODUCT_REQUIRED',
      422,
    );

    // Zero-value exchange with a link: recorded, still no cash out.
    const zero = await service.createTransaction(
      basePayload({ serialNumber: 'IMEI-EX-7', saleId: postedSaleId, agreedPurchasePrice: 0, autoAddToInventory: false }),
      AUTH,
    );
    assert.equal(zero.ok, true);
    assert.equal(posting.calls, 0, 'zero-value exchange still posts nothing');

    // Cash path unchanged: treasury expense + one posting call.
    const cash = await service.createTransaction(
      basePayload({
        serialNumber: 'IMEI-CASH-1',
        transactionType: 'cash_purchase',
        paymentMethod: 'cash',
        agreedPurchasePrice: 400,
      }),
      AUTH,
    );
    assert.equal(cash.ok, true);
    const cashId = Number(cash.id);
    const payout = await db
      .selectFrom('treasury_transactions')
      .select(['txn_type', 'amount', 'payment_channel'])
      .where('reference_type', '=', 'trade_in')
      .where('reference_id', '=', cashId)
      .executeTakeFirstOrThrow();
    assert.equal(payout.txn_type, 'expense');
    assert.equal(Number(payout.amount), -400);
    assert.equal(payout.payment_channel, 'cash');
    assert.equal(posting.calls, 1, 'cash path still routes to postTradeInCashPurchase once');
    const cashRow = await db
      .selectFrom('trade_in_transactions')
      .select(['payment_method', 'transaction_type'])
      .where('id', '=', cashId)
      .executeTakeFirstOrThrow();
    assert.equal(cashRow.payment_method, 'cash');
    assert.equal(cashRow.transaction_type, 'cash_purchase');

    // Guards still hold on the exchange path: duplicate serial while
    // in stock, and delete-block once posted.
    await assertRejectsCode(
      service.createTransaction(basePayload({ serialNumber: 'IMEI-EX-1', saleId: postedSaleId }), AUTH),
      'TRADEIN_DUPLICATE_SERIAL',
      409,
    );
    await assertRejectsCode(
      service.deleteTransaction(exchangeId, AUTH),
      'TRADEIN_REVERSAL_REQUIRED',
      409,
    );

    console.log('tradein-exchange.spec.ts Part A (PGlite) passed');
  } finally {
    await db.destroy();
  }
}

function testDtos(): void {
  const valid = (payload: unknown) => {
    const errors = validateSync(plainToInstance(UpsertTradeInDto, payload) as object);
    assert.equal(errors.length, 0, `expected valid DTO, got ${JSON.stringify(errors)}`);
  };
  const invalid = (payload: unknown) => {
    const errors = validateSync(plainToInstance(UpsertTradeInDto, payload) as object);
    assert.ok(errors.length > 0, `expected DTO to be invalid: ${JSON.stringify(payload)}`);
  };
  const base = {
    sellerName: 'Ahmed',
    sellerPhone: '01000000000',
    sellerNationalId: '12345678901234',
    deviceModel: 'Galaxy S21',
    serialNumber: 'IMEI-EX-1',
    agreedPurchasePrice: 500,
  };
  valid({ ...base, transactionType: 'cash_purchase' });
  valid({ ...base, transactionType: 'cash_purchase', saleId: 7 });
  valid({ ...base, transactionType: 'exchange_trade_in', saleId: 7 });
  invalid({ ...base, transactionType: 'exchange_trade_in' });
  invalid({ ...base, transactionType: 'exchange_trade_in', saleId: 0 });
  invalid({ ...base, transactionType: 'barter', saleId: 7 });
  console.log('tradein-exchange.spec.ts DTO checks passed');
}

function testPureHelper(): void {
  assert.throws(
    () => assertExchangeSaleLink(null),
    (error: any) => error?.code === 'TRADEIN_EXCHANGE_SALE_NOT_FOUND' && error?.statusCode === 404,
  );
  assert.throws(
    () => assertExchangeSaleLink(undefined),
    (error: any) => error?.code === 'TRADEIN_EXCHANGE_SALE_NOT_FOUND',
  );
  assert.throws(
    () => assertExchangeSaleLink({ status: 'draft' }),
    (error: any) => error?.code === 'TRADEIN_EXCHANGE_SALE_NOT_POSTED' && error?.statusCode === 422,
  );
  assert.throws(
    () => assertExchangeSaleLink({ status: 'cancelled' }),
    (error: any) => error?.code === 'TRADEIN_EXCHANGE_SALE_NOT_POSTED',
  );
  assert.doesNotThrow(() => assertExchangeSaleLink({ status: 'posted' }));
  console.log('tradein-exchange.spec.ts pure-helper checks passed');
}

// CI-only live section: same transactional flow on real PostgreSQL
// (advisory lock + row lock + tx) inside an isolated schema, so no
// real table is ever touched. Skips without ACCEPTANCE_DATABASE_URL.
// The real-journal cash proof stays in
// backend/test/acceptance/core-accounting.postgres.spec.ts.
async function runPartB(): Promise<void> {
  const target = process.env.ACCEPTANCE_DATABASE_URL;
  if (!target) {
    console.log(
      'tradein-exchange.spec.ts Part B SKIPPED: set ACCEPTANCE_DATABASE_URL to a fully migrated disposable PostgreSQL database (CI-only live section)',
    );
    return;
  }
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Acceptance tests are local-only');
  assert.ok(
    /^\/(zs_core_audit_test|zs_acceptance_[a-z0-9_]+)$/.test(url.pathname),
    'Refusing a non-test database',
  );
  const pool = new Pool({
    connectionString: target,
    options: '-c search_path=tradein_exchange_spec',
  });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  try {
    await pool.query('CREATE SCHEMA IF NOT EXISTS tradein_exchange_spec');
    await pool.query(FIXTURE_DDL);
    const { service, posting } = buildService(db);
    const query = (text: string, params?: unknown[]) => pool.query(text, params as any);
    const postedSaleId = await insertSale(query, 't1', 'posted');
    const created = await service.createTransaction(
      basePayload({ saleId: postedSaleId }),
      AUTH,
    );
    assert.equal(created.ok, true);
    const exchangeId = Number(created.id);
    const treasury = await pool.query(
      `SELECT id FROM treasury_transactions WHERE reference_type = 'trade_in' AND reference_id = $1`,
      [exchangeId],
    );
    assert.equal(treasury.rows.length, 0, 'live: exchange must not write a treasury payout');
    assert.equal(posting.calls, 0, 'live: exchange must not call postTradeInCashPurchase');
    await assertRejectsCode(
      service.createTransaction(basePayload({ serialNumber: 'IMEI-LIVE-2', saleId: 999999 }), AUTH),
      'TRADEIN_EXCHANGE_SALE_NOT_FOUND',
      404,
    );
    console.log('tradein-exchange.spec.ts Part B (live Postgres) passed');
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS tradein_exchange_spec CASCADE').catch(() => undefined);
    await db.destroy();
    await pool.end();
  }
}

async function main(): Promise<void> {
  await runPartA();
  testDtos();
  testPureHelper();
  await runPartB();
  console.log('tradein-exchange.spec.ts passed');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
