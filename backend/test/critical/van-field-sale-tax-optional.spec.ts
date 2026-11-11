/*
 * Van field-sale tax, optional per tenant (INV-VAN-SALE-TAX-OPTIONAL).
 *
 * THE GAP: executeFieldSaleInternal inserted every van sale with
 * prices_include_tax: false and never set tax_rate / tax_amount, so
 * a van sale posted zero tax even when the tenant had configured a
 * sales tax rate. resolveSaleTaxRate was never called anywhere in
 * delivery-reps. postSale already reads sale.tax_amount (and credits
 * the tax account from it), so no posting change is needed once the
 * insert carries the two values.
 *
 * THE RULE (user decision): tax on sales is OPTIONAL per business
 * owner — when the tenant configures a rate it applies on top of
 * the price; when no rate is configured the sale posts zero tax.
 * The rate is read from the tenant settings on the transaction
 * handle (key `taxRate`, legacy `tax_rate` fallback — the same
 * spelling order the shop sale writer uses), resolved through the
 * canonical resolveSaleTaxRate engine, and the totals come from the
 * shared computeInvoiceTotals on the net base (subtotal - discount,
 * cash discount already applied), rounded once at the tenant's
 * book digits via toBookMoney — never toFixed(2). The tax-inclusive
 * total flows into paid_amount for card/InstaPay, the trip totals,
 * the customer balance and the journal, exactly like the shop sale.
 *
 * PLACEMENT: the tax block sits directly before the sale insert,
 * after the credit-limit / card gates (those gates therefore still
 * run on the pre-tax amount — recorded limitation, not fixed here).
 * It is deliberately NOT near the head of the function: lines
 * 1919-1936 belong to the parallel F3 package.
 *
 * HARNESS: the real VanSalesService + the real
 * AccountingPostingService on PGlite, following the
 * van-field-sale-book-digits spec (same foundation, same stubs:
 * resolveSystemAuthContext shadowed and the fraud radar stubbed
 * no-op, because a pool read inside the open sale transaction
 * deadlocks on PGlite's single connection). The sales DDL here
 * declares the real tax_rate column (NUMERIC(8,4) on production
 * via the phase-2 schema) that the book-digits spec's DDL omits.
 *
 * LIMITS (recorded, not fixed here): the driver UI shows the
 * pre-submit basket total (qty x unitPrice) with no tax line, so
 * with tax enabled the total the driver sees before submitting is
 * lower than the server total returned after submit; the offline
 * queue records the same pre-tax total until sync replays the sale
 * through this server path. For a split sale the driver-entered
 * cash amount is capped at the pre-tax total, so the tax lands on
 * the unpaid (credit) remainder.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const TENANT = 't-van-sale-tax';
const ACCOUNT = 'a-van-sale-tax';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cash_flow_category text, updated_at timestamptz);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>, currency: string): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: currency }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: currency, exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'sys', is_active: true }).execute();
  const accounts: Array<[number, string, string]> = [
    [1110, '1110', 'asset'], [1120, '1120', 'asset'], [1130, '1130', 'asset'], [1140, '1140', 'asset'],
    [2120, '2120', 'liability'], [4100, '4100', 'revenue'], [4300, '4300', 'revenue'], [5100, '5100', 'expense'],
  ];
  for (const [id, code, type] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, account_type: type, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, inventory_account_id: 1140,
    sales_revenue_account_id: 4100, sales_discount_account_id: 4300,
    cogs_account_id: 5100, sales_tax_account_id: 2120,
  }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, name: 'Van', location_type: 'van', is_active: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 1', van_location_id: 20, is_van_rep: true }).execute();
  await anyDb.insertInto('van_sales_trips').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 1, van_location_id: 20, status: 'open' }).execute();
}

async function seedTaxSetting(db: Kysely<Database>, key: string, value: string): Promise<void> {
  await (db as any).insertInto('settings').values({ tenant_id: TENANT, key, value }).execute();
}

async function seedProduct(db: Kysely<Database>, id: number, retail: number, cost: number, vanQty: number): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('products').values({ id, tenant_id: TENANT, account_id: ACCOUNT, name: `Product ${id}`, stock_qty: vanQty, cost_price: cost, retail_price: retail, credit_price: 0, is_active: true }).execute();
  await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: id, location_id: 20, qty: vanQty }).execute();
}

function buildService(db: Kysely<Database>): VanSalesService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const fraudStub = { recordSuspicionEvent: async () => {}, getSummary: async () => ({}), getEvents: async () => [] };
  const service = new VanSalesService(db, {} as never, {} as never, posting as never,
    undefined, undefined, undefined, undefined, undefined, undefined, fraudStub as never);
  (service as any).resolveSystemAuthContext = async () => ({
    userId: 1, sessionId: 'spec', username: 'spec', role: 'admin',
    permissions: ['accounting'], tenantId: TENANT, accountId: ACCOUNT,
  });
  return service;
}

async function saleRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('sales').selectAll().where('id', '=', id).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
}

async function journalLines(db: Kysely<Database>, saleId: number): Promise<Array<{ accountId: number; debit: number; credit: number }>> {
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .innerJoin('journal_entries', 'journal_entries.id', 'journal_entry_lines.journal_entry_id')
    .select(['journal_entry_lines.account_id', 'journal_entry_lines.debit', 'journal_entry_lines.credit'])
    .where('journal_entries.source_type', '=', 'sale')
    .where('journal_entries.source_id', '=', saleId)
    .where('journal_entries.tenant_id', '=', TENANT)
    .execute() as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({ accountId: Number(r.account_id), debit: Number(r.debit), credit: Number(r.credit) }));
}

function lineFor(lines: Array<{ accountId: number; debit: number; credit: number }>, accountId: number): { debit: number; credit: number } {
  return lines.filter((l) => l.accountId === accountId).reduce((acc, l) => ({ debit: acc.debit + l.debit, credit: acc.credit + l.credit }), { debit: 0, credit: 0 });
}

async function main(): Promise<void> {
  // 1. EGP, tax enabled at 15%: 100 x 2 cash posts tax 30 on top, total 230.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedTaxSetting(db, 'taxRate', '15');
      await seedProduct(db, 101, 100, 50, 10);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 2 }],
      });
      assert.equal(res.total, 230);
      assert.equal(res.cashPaid, 230);
      assert.equal(res.creditOwed, 0);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.tax_rate), 15);
      assert.equal(Number(sale.tax_amount), 30);
      assert.equal(Number(sale.total), 230);
      assert.equal(Number(sale.subtotal), 200);
      assert.equal(sale.prices_include_tax, false);
      const lines = await journalLines(db, res.saleId);
      assert.equal(lineFor(lines, 1130).debit, 230); // rep custody, tax-inclusive
      assert.equal(lineFor(lines, 4100).credit, 200); // revenue, net of tax
      assert.equal(lineFor(lines, 2120).credit, 30); // sales tax payable
      assert.equal(lines.reduce((s, l) => s + l.debit, 0), lines.reduce((s, l) => s + l.credit, 0));
    } finally { await db.destroy(); }
  }

  // 2. EGP, no tax setting at all: the same sale posts zero tax.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedProduct(db, 102, 100, 50, 10);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 102, qty: 2 }],
      });
      assert.equal(res.total, 200);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.tax_rate), 0);
      assert.equal(Number(sale.tax_amount), 0);
      assert.equal(Number(sale.total), 200);
      const lines = await journalLines(db, res.saleId);
      assert.equal(lineFor(lines, 2120).credit, 0);
      assert.equal(lineFor(lines, 4100).credit, 200);
    } finally { await db.destroy(); }
  }

  // 3. EGP, legacy `tax_rate` spelling only: 100 x 1 at 10% posts tax 10.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedTaxSetting(db, 'tax_rate', '10');
      await seedProduct(db, 103, 100, 50, 10);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 103, qty: 1 }],
      });
      assert.equal(res.total, 110);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.tax_rate), 10);
      assert.equal(Number(sale.tax_amount), 10);
    } finally { await db.destroy(); }
  }

  // 4. KWD 3dp at book digits, not toFixed(2): 10.125 x 1 at 15%
  // posts tax 1.519 and total 11.644 (2dp would give 1.52 / 11.65).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'KWD');
      await seedTaxSetting(db, 'taxRate', '15');
      await seedProduct(db, 104, 10.125, 4.005, 10);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 104, qty: 1 }],
      });
      assert.equal(res.total, 11.644);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.tax_rate), 15);
      assert.equal(Number(sale.tax_amount), 1.519);
      assert.equal(Number(sale.total), 11.644);
      const lines = await journalLines(db, res.saleId);
      assert.equal(lineFor(lines, 2120).credit, 1.519);
      assert.equal(lineFor(lines, 4100).credit, 10.125);
    } finally { await db.destroy(); }
  }

  // 5. Split with tax: 200 + 30 tax = 230, cash 100 collected, the
  // tax lands on the unpaid remainder: credit 130, customer owes 130.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedTaxSetting(db, 'taxRate', '15');
      await seedProduct(db, 105, 100, 50, 10);
      await (db as any).insertInto('customers').values({ id: 7, tenant_id: TENANT, account_id: ACCOUNT, name: 'Credit Customer', balance: 0, credit_limit: 1000, customer_type: 'credit', metadata: '{}', is_active: true }).execute();
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'split', paidAmount: 100, customerId: 7,
        items: [{ productId: 105, qty: 2 }],
      });
      assert.equal(res.total, 230);
      assert.equal(res.cashPaid, 100);
      assert.equal(res.creditOwed, 130);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.tax_amount), 30);
      const cust = await (db as any).selectFrom('customers').select('balance').where('id', '=', 7).executeTakeFirstOrThrow() as any;
      assert.equal(Number(cust.balance), 130);
      const trip = await (db as any).selectFrom('van_sales_trips').select(['cash_collected', 'credit_sales']).where('id', '=', 1).executeTakeFirstOrThrow() as any;
      assert.equal(Number(trip.cash_collected), 100);
      assert.equal(Number(trip.credit_sales), 130);
    } finally { await db.destroy(); }
  }

  // 6. InstaPay with tax: the settled amount is the tax-inclusive
  // total — paid_amount and the sale_payments row are both 230.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'EGP');
      await seedTaxSetting(db, 'taxRate', '15');
      await seedProduct(db, 106, 100, 50, 10);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'instapay',
        items: [{ productId: 106, qty: 2 }],
      });
      assert.equal(res.total, 230);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.paid_amount), 230);
      const payment = await (db as any).selectFrom('sale_payments').select(['amount', 'payment_channel']).where('sale_id', '=', res.saleId).executeTakeFirstOrThrow() as any;
      assert.equal(Number(payment.amount), 230);
      assert.equal(payment.payment_channel, 'bank_transfer');
      const trip = await (db as any).selectFrom('van_sales_trips').select(['sales_amount', 'total_instapay_sales']).where('id', '=', 1).executeTakeFirstOrThrow() as any;
      assert.equal(Number(trip.sales_amount), 230);
      assert.equal(Number(trip.total_instapay_sales), 230);
    } finally { await db.destroy(); }
  }

  // 7. Source pin: the canonical engine + shared totals drive the
  // insert, and the block sits directly before the insert (after
  // the credit-limit gate), never near the head of the function.
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
    const start = source.indexOf('private async executeFieldSaleInternal(');
    const end = source.indexOf('async recordFieldCollection(');
    assert.ok(start > 0 && end > start);
    const body = source.slice(start, end);
    assert.ok(body.includes('INV-VAN-SALE-TAX-OPTIONAL'), 'tax block marker present');
    assert.ok(body.includes("resolveSaleTaxRate(configuredTaxRate, configuredTaxRate)"), 'configured rate resolved through the canonical engine');
    assert.ok(body.includes('computeInvoiceTotals(subtotalSale, discountSale, vanTaxRate, false, 0, 0, 0)'), 'shared totals on the net base, tax added on top');
    assert.ok(body.includes('tax_rate: vanTaxRate'), 'stored tax_rate comes from the resolved rate');
    assert.ok(body.includes('tax_amount: vanTaxAmount'), 'stored tax_amount comes from the shared totals');
    const marker = body.indexOf('INV-VAN-SALE-TAX-OPTIONAL');
    const insertAt = body.indexOf("insertInto('sales')");
    assert.ok(marker > 0 && insertAt > marker, 'tax block precedes the sale insert');
    assert.ok(body.indexOf('evaluateCreditLimitCheck') < marker, 'credit-limit gate still runs before the tax block');
    assert.ok(!body.slice(0, marker).includes('resolveSaleTaxRate'), 'no tax resolution before the tax block');
  }

  console.log('van-field-sale-tax-optional: all cases passed');
}

main()
  .then(async () => {
    console.log('van-field-sale-tax-optional: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
