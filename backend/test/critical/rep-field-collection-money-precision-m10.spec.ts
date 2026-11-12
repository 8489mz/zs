/*
 * Rep field-collection money precision (M10: B6 + A9).
 *
 * THE GAPS:
 * - B6: recordFieldCollection took the amount raw
 *   (Number(payload.amount || 0)) and wrote it into
 *   customer_payments.amount, subtracted it from customers.balance,
 *   summed it into trip totals and wrote it to
 *   customer_ledger.balance_after — while only the journal rounded
 *   via toBookMoney. An amount with more decimals than the tenant's
 *   book digits (e.g. 100.005 on a 2dp tenant) left the payment row,
 *   customer balance and journal disagreeing by fractions of a minor
 *   unit on every collection. The fix REJECTS (never silently rounds)
 *   an amount that does not fit the tenant's money digits, mirroring
 *   the general customer-payment path (createCustomerPayment,
 *   INVALID_PAYMENT_AMOUNT): resolve the tenant digits via
 *   currencyMoneyDigits(await tenantBaseCurrency(...)), check the
 *   amount against the scale with the same 0.000001 tolerance shape,
 *   and throw a specific 400 naming the tenant precision BEFORE any
 *   write. Rounding would silently alter the cash the driver holds
 *   and the amount the customer paid. A 3dp amount on a 3dp tenant
 *   (KWD 10.125) passes through exact.
 * - A9: van_rep_financial_settlements.amount was still NUMERIC(14,2)
 *   (migration 2040000000225) while settleTrip inserts book-digit
 *   variances, so on a 3dp tenant a 10.125 settlement amount was
 *   stored as 10.13 (0.005 loss per item). Migration 2040000000321
 *   widens it to numeric(14,3), prospective only.
 *
 * HARNESS: the real VanSalesService + the real
 * AccountingPostingService on ONE shared PGlite database, same stubs
 * as the rep-field-collection-dedup-keys-m8 spec
 * (resolveSystemAuthContext shadowed per-tenant, fraud radar stubbed
 * no-op — a pool read inside the open transaction deadlocks on
 * PGlite's single connection). Two tenants share the database: an
 * EGP 2dp tenant and a KWD 3dp tenant, each with its own accounts,
 * rep, trips and customers. Cases are isolated by distinct trip /
 * customer ids, and the class-level collection caches are cleared
 * between cases. The A9 case creates the settlements table with the
 * ORIGINAL 0225 DDL (numeric(14,2)) and then runs the REAL
 * 0321 migration up() against it — the migration is exercised, not
 * mirrored.
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
import { hashManagerPin } from '../../src/common/utils/manager-approval';
import { up as widenSettlementsAmountUp } from '../../src/database/migrations/2040000000321_van_rep_financial_settlements_amount_3dp';

const TENANT = 't-rep-field-collection-money-precision-m10';
const ACCOUNT = 'a-rep-field-collection-money-precision-m10';
const TENANT_KWD = 't-rep-field-collection-money-precision-m10-kwd';
const ACCOUNT_KWD = 'a-rep-field-collection-money-precision-m10-kwd';
const SUPERVISOR_PIN = '4321';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date, PRIMARY KEY (tenant_id, id));
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cash_flow_category text, updated_at timestamptz);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, pin_hash text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, display_name text, phone text, pin text, pin_hash text, permissions_json text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
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
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, gps_lat numeric, gps_lng numeric, tenant_id text, account_id text);
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, note text, transfer_reference text, transfer_receipt_url text, payment_channel text, van_trip_id bigint, rep_id bigint, client_tx_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_returns (id bigint PRIMARY KEY, tenant_id text, rep_id bigint);
      CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric(14, 2) NOT NULL, status text NOT NULL DEFAULT 'pending', settled_at timestamptz, settled_by bigint, settlement_method text, notes text, receipt_voucher_no text, payroll_run_id bigint, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
    `);
  return { pg, db };
}

interface TenantSeed {
  tenant: string;
  account: string;
  currency: string;
  userId: number;
  repId: number;
  whLocId: number;
  vanLocId: number;
  acctBase: number;
  tripIds: number[];
  customers: Array<{ id: number; balance: number; tripId: number }>;
}

async function seedTenant(db: Kysely<Database>, cfg: TenantSeed, pinHash: string): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: cfg.tenant, key: 'currency', value: cfg.currency }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: cfg.tenant, key: 'managerPin', value: JSON.stringify(pinHash) }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: cfg.tenant, currency_code: cfg.currency, exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: cfg.userId, tenant_id: cfg.tenant, username: 'sys', is_active: true }).execute();
  const accounts: Array<[number, string, string]> = [
    [1110, '1110', 'asset'], [1120, '1120', 'asset'], [1130, '1130', 'asset'], [1140, '1140', 'asset'],
    [2120, '2120', 'liability'], [4100, '4100', 'revenue'], [4300, '4300', 'revenue'], [5100, '5100', 'expense'],
  ];
  for (const [code, codeStr, type] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id: cfg.acctBase + code, tenant_id: cfg.tenant, code: codeStr, name_ar: codeStr, account_type: type, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    // Production PK is (tenant_id, id): every tenant holds its
    // singleton row at id 1, and getTenantAccountingSettings queries
    // tenant_id + id = 1 — so both tenants seed id 1 here.
    id: 1, tenant_id: cfg.tenant, cash_account_id: cfg.acctBase + 1110, bank_account_id: cfg.acctBase + 1120,
    customer_receivable_account_id: cfg.acctBase + 1130, inventory_account_id: cfg.acctBase + 1140,
    sales_revenue_account_id: cfg.acctBase + 4100, sales_discount_account_id: cfg.acctBase + 4300,
    cogs_account_id: cfg.acctBase + 5100, sales_tax_account_id: cfg.acctBase + 2120,
  }).execute();
  await anyDb.insertInto('stock_locations').values({ id: cfg.whLocId, tenant_id: cfg.tenant, account_id: cfg.account, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: cfg.vanLocId, tenant_id: cfg.tenant, account_id: cfg.account, name: 'Van', location_type: 'van', is_active: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: cfg.repId, tenant_id: cfg.tenant, account_id: cfg.account, name: `Rep ${cfg.repId}`, van_location_id: cfg.vanLocId, is_van_rep: true }).execute();
  for (const tripId of cfg.tripIds) {
    await anyDb.insertInto('van_sales_trips').values({ id: tripId, tenant_id: cfg.tenant, account_id: cfg.account, rep_id: cfg.repId, van_location_id: cfg.vanLocId, status: 'open' }).execute();
  }
  for (const cust of cfg.customers) {
    await anyDb.insertInto('customers').values({ id: cust.id, tenant_id: cfg.tenant, account_id: cfg.account, name: `Shop Customer ${cust.id}`, balance: cust.balance, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
    await anyDb.insertInto('customer_ledger').values({ customer_id: cust.id, entry_type: 'sale', amount: cust.balance, balance_after: cust.balance, reference_type: 'sale', reference_id: null, van_trip_id: cust.tripId, tenant_id: cfg.tenant, account_id: cfg.account }).execute();
  }
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const pinHash = await hashManagerPin(SUPERVISOR_PIN);
  await seedTenant(db, {
    tenant: TENANT, account: ACCOUNT, currency: 'EGP', userId: 1, repId: 1,
    whLocId: 10, vanLocId: 20, acctBase: 0, tripIds: [11, 12, 13],
    customers: [
      { id: 101, balance: 200, tripId: 11 },
      { id: 102, balance: 500, tripId: 12 },
      { id: 103, balance: 300, tripId: 13 },
    ],
  }, pinHash);
  await seedTenant(db, {
    tenant: TENANT_KWD, account: ACCOUNT_KWD, currency: 'KWD', userId: 2, repId: 2,
    whLocId: 30, vanLocId: 40, acctBase: 20000, tripIds: [21, 22],
    customers: [
      { id: 201, balance: 100, tripId: 21 },
      { id: 202, balance: 50, tripId: 22 },
    ],
  }, pinHash);
}

function buildService(db: Kysely<Database>): VanSalesService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const fraudStub = { recordSuspicionEvent: async () => {}, getSummary: async () => ({}), getEvents: async () => [] };
  const service = new VanSalesService(db, {} as never, {} as never, posting as never,
    undefined, undefined, undefined, undefined, undefined, undefined, fraudStub as never);
  (service as any).resolveSystemAuthContext = async (tenantId: string, accountId: string) => ({
    userId: 1, sessionId: 'spec', username: 'spec', role: 'admin',
    permissions: ['accounting'], tenantId, accountId,
  });
  return service;
}

function clearCollectionCaches(): void {
  // recordFieldCollection dedups in memory on the class-level
  // caches, so each case starts with no stale hit.
  (VanSalesService as any).recentCollectionsCache?.clear?.();
  (VanSalesService as any).inFlightCollectionPromises?.clear?.();
}

async function customerBalance(db: Kysely<Database>, tenant: string, customerId: number): Promise<number> {
  const row = await (db as any).selectFrom('customers').select('balance').where('tenant_id', '=', tenant).where('id', '=', customerId).executeTakeFirstOrThrow() as any;
  return Number(row.balance);
}

async function customerPayments(db: Kysely<Database>, tenant: string, customerId: number): Promise<any[]> {
  return (db as any).selectFrom('customer_payments').selectAll().where('tenant_id', '=', tenant).where('customer_id', '=', customerId).orderBy('id', 'asc').execute();
}

async function customerLedger(db: Kysely<Database>, tenant: string, customerId: number): Promise<any[]> {
  return (db as any).selectFrom('customer_ledger').selectAll().where('tenant_id', '=', tenant).where('customer_id', '=', customerId).orderBy('id', 'asc').execute();
}

async function journalEntriesForPayment(db: Kysely<Database>, tenant: string, paymentId: number): Promise<any[]> {
  return (db as any).selectFrom('journal_entries').selectAll().where('tenant_id', '=', tenant).where('source_type', '=', 'van_field_collection').where('source_id', '=', paymentId).execute();
}

async function journalCount(db: Kysely<Database>, tenant: string, sourceType: string): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entries').selectAll().where('source_type', '=', sourceType).where('tenant_id', '=', tenant).execute();
  return rows.length;
}

async function journalLines(db: Kysely<Database>, tenant: string, entryId: number): Promise<any[]> {
  return (db as any).selectFrom('journal_entry_lines').selectAll().where('tenant_id', '=', tenant).where('journal_entry_id', '=', entryId).orderBy('id', 'asc').execute();
}

async function tripRow(db: Kysely<Database>, tenant: string, tripId: number): Promise<any> {
  return (db as any).selectFrom('van_sales_trips').selectAll().where('tenant_id', '=', tenant).where('id', '=', tripId).executeTakeFirstOrThrow();
}

async function settlementScale(db: Kysely<Database>): Promise<{ precision: number; scale: number }> {
  const { rows } = await sql<{ numeric_precision: number | null; numeric_scale: number | null }>`
    SELECT numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'van_rep_financial_settlements' AND column_name = 'amount'
  `.execute(db);
  assert.equal(rows.length, 1, 'the settlements table has an amount column');
  return { precision: Number(rows[0].numeric_precision), scale: Number(rows[0].numeric_scale) };
}

async function expectInvalidPaymentAmount(
  service: VanSalesService,
  repId: number,
  tenant: string,
  account: string,
  payload: { tripId: number; customerId: number; amount: number; paymentMethod?: 'cash' | 'instapay' | 'vodafone_cash' | 'bank_transfer'; clientTxId?: string },
  digitsHint: RegExp,
): Promise<any> {
  let thrown: any = null;
  try {
    await service.recordFieldCollection(repId, tenant, account, payload);
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, `collecting ${payload.amount} must throw, not post`);
  assert.equal(thrown.code, 'INVALID_PAYMENT_AMOUNT', 'the refusal names the payment-precision error code');
  assert.equal(thrown.statusCode, 400, 'the refusal is a 400');
  assert.match(String(thrown.message), digitsHint, 'the message names the tenant precision');
  return thrown;
}

async function main(): Promise<void> {
  const { db } = await makeDb();
  try {
    await seedFoundation(db);
    const service = buildService(db);

    // S1 (B6, 2dp tenant). A 100.005 collection is REFUSED with the
    // specific error and NOTHING is written: no payment row, balance
    // unchanged, no journal, trip totals unchanged, ledger untouched.
    // Before the fix the 100.005 posted raw while the journal rounded
    // it, so payment row, balance and journal disagreed. A valid
    // 100.00 on the same trip/customer right after still posts, so
    // the refusal leaves no residue (no cache/poisoned promise).
    {
      clearCollectionCaches();
      const paymentsBefore = await customerPayments(db, TENANT, 101);
      const ledgerBefore = await customerLedger(db, TENANT, 101);
      const journalsBefore = await journalCount(db, TENANT, 'van_field_collection');
      const tripBefore = await tripRow(db, TENANT, 11);
      await expectInvalidPaymentAmount(service, 1, TENANT, ACCOUNT,
        { tripId: 11, customerId: 101, amount: 100.005, paymentMethod: 'cash', clientTxId: 'm10-s1' },
        /2 decimal places.*EGP/);
      assert.equal((await customerPayments(db, TENANT, 101)).length, paymentsBefore.length, 'no payment row was written for the refused amount');
      assert.equal(await customerBalance(db, TENANT, 101), 200, 'the customer balance is unchanged');
      assert.equal(await journalCount(db, TENANT, 'van_field_collection'), journalsBefore, 'no journal was posted for the refused amount');
      assert.equal(Number((await tripRow(db, TENANT, 11)).cash_collected), Number(tripBefore.cash_collected), 'trip cash total is unchanged');
      assert.equal((await customerLedger(db, TENANT, 101)).length, ledgerBefore.length, 'no ledger row was written for the refused amount');
      clearCollectionCaches();
      const ok = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 11, customerId: 101, amount: 100, paymentMethod: 'cash', clientTxId: 'm10-s1-valid',
      });
      assert.equal(ok.ok, true);
      assert.equal(ok.previousBalance, 200);
      assert.equal(ok.newBalance, 100);
      assert.equal(await customerBalance(db, TENANT, 101), 100, 'the valid collection after the refusal still posts');
      console.log('  (S1) B6: 100.005 on a 2dp tenant is refused with nothing written passed');
    }

    // S1b (B6, dust). A sub-minor-unit amount (0.001 on a 2dp tenant)
    // is refused the same way — it is positive, so only the precision
    // check refuses it, and again nothing is written.
    {
      clearCollectionCaches();
      await expectInvalidPaymentAmount(service, 1, TENANT, ACCOUNT,
        { tripId: 13, customerId: 103, amount: 0.001, paymentMethod: 'cash', clientTxId: 'm10-s1b' },
        /2 decimal places.*EGP/);
      assert.equal((await customerPayments(db, TENANT, 103)).length, 0, 'no payment row was written for the dust amount');
      assert.equal(await customerBalance(db, TENANT, 103), 300, 'the customer balance is unchanged');
      assert.equal(await journalCount(db, TENANT, 'van_field_collection'), 1, 'no further journal was posted');
      console.log('  (S1b) B6: 0.001 dust on a 2dp tenant is refused with nothing written passed');
    }

    // S2 (B6, 2dp tenant, agreement). 100.00 and 100.01 are accepted
    // and every record agrees exactly: payment row, customer balance,
    // ledger balance_after, journal debit/credit, and the trip cash
    // total.
    {
      clearCollectionCaches();
      const first = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 12, customerId: 102, amount: 100, paymentMethod: 'cash', clientTxId: 'm10-s2-a',
      });
      assert.equal(first.ok, true);
      assert.equal(first.previousBalance, 500);
      assert.equal(first.newBalance, 400);
      const second = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 12, customerId: 102, amount: 100.01, paymentMethod: 'cash', clientTxId: 'm10-s2-b',
      });
      assert.equal(second.ok, true);
      assert.equal(second.previousBalance, 400);
      assert.equal(second.newBalance, 299.99);
      assert.equal(await customerBalance(db, TENANT, 102), 299.99, 'balance is 500 - 100 - 100.01');
      const payments = await customerPayments(db, TENANT, 102);
      assert.equal(payments.length, 2, 'two payment rows were written');
      assert.deepEqual(payments.map((p: any) => Number(p.amount)), [100, 100.01], 'payment rows hold the exact amounts');
      const ledger = await customerLedger(db, TENANT, 102);
      assert.deepEqual(
        ledger.slice(1).map((l: any) => [Number(l.amount), Number(l.balance_after)]),
        [[-100, 400], [-100.01, 299.99]],
        'ledger rows agree with the payment rows and the balance',
      );
      for (const [payment, expected] of [[payments[0], 100], [payments[1], 100.01]] as const) {
        const entries = await journalEntriesForPayment(db, TENANT, Number(payment.id));
        assert.equal(entries.length, 1, 'exactly one journal per collection');
        const lines = await journalLines(db, TENANT, Number(entries[0].id));
        assert.equal(lines.length, 2, 'the journal has its two legs');
        assert.deepEqual(
          lines.map((l: any) => [Number(l.debit), Number(l.credit)]).sort(),
          [[0, expected], [expected, 0]],
          'journal debit/credit equal the collected amount exactly',
        );
      }
      assert.equal(Number((await tripRow(db, TENANT, 12)).cash_collected), 200.01, 'trip cash total is 100 + 100.01');
      console.log('  (S2) B6: 100.00 and 100.01 agree everywhere passed');
    }

    // S3 (B6, 3dp tenant). KWD 10.125 is accepted and stored exact
    // everywhere: payment row, balance, ledger balance_after, journal
    // legs, and the trip cash total — the fix must not over-reject a
    // 3-decimal amount on a 3-decimal tenant.
    {
      clearCollectionCaches();
      const res = await service.recordFieldCollection(2, TENANT_KWD, ACCOUNT_KWD, {
        tripId: 21, customerId: 201, amount: 10.125, paymentMethod: 'cash', clientTxId: 'm10-s3',
      });
      assert.equal(res.ok, true);
      assert.equal(res.previousBalance, 100);
      assert.equal(res.newBalance, 89.875);
      assert.equal(await customerBalance(db, TENANT_KWD, 201), 89.875, 'balance is 100 - 10.125');
      const payments = await customerPayments(db, TENANT_KWD, 201);
      assert.equal(payments.length, 1, 'one payment row was written');
      assert.equal(Number(payments[0].amount), 10.125, 'the payment row holds 10.125 exact');
      const ledger = await customerLedger(db, TENANT_KWD, 201);
      assert.deepEqual(
        ledger.slice(1).map((l: any) => [Number(l.amount), Number(l.balance_after)]),
        [[-10.125, 89.875]],
        'the ledger row agrees with the payment row and the balance',
      );
      const entries = await journalEntriesForPayment(db, TENANT_KWD, Number(payments[0].id));
      assert.equal(entries.length, 1, 'exactly one journal was posted');
      const lines = await journalLines(db, TENANT_KWD, Number(entries[0].id));
      assert.deepEqual(
        lines.map((l: any) => [Number(l.debit), Number(l.credit)]).sort(),
        [[0, 10.125], [10.125, 0]],
        'journal debit/credit equal 10.125 exactly',
      );
      assert.equal(Number((await tripRow(db, TENANT_KWD, 21)).cash_collected), 10.125, 'trip cash total is 10.125');
      console.log('  (S3) B6: KWD 10.125 is accepted and stored exact everywhere passed');
    }

    // S3b (B6, 3dp tenant still rejects). A 4-decimal amount on the
    // 3dp tenant (10.1255) is refused with the same specific error —
    // the check is digits-relative, not "3dp always passes" — and
    // nothing is written.
    {
      clearCollectionCaches();
      await expectInvalidPaymentAmount(service, 2, TENANT_KWD, ACCOUNT_KWD,
        { tripId: 22, customerId: 202, amount: 10.1255, paymentMethod: 'cash', clientTxId: 'm10-s3b' },
        /3 decimal places.*KWD/);
      assert.equal((await customerPayments(db, TENANT_KWD, 202)).length, 0, 'no payment row was written for the refused amount');
      assert.equal(await customerBalance(db, TENANT_KWD, 202), 50, 'the customer balance is unchanged');
      assert.equal(await journalCount(db, TENANT_KWD, 'van_field_collection'), 1, 'no further journal was posted');
      console.log('  (S3b) B6: 10.1255 on a 3dp tenant is refused with nothing written passed');
    }

    // S4 (A9, migration). The settlements table starts at the
    // ORIGINAL 0225 DDL numeric(14,2): a 10.125 insert is stored as
    // 10.13 (the defect). Running the REAL 0321 migration up() then
    // stores 10.125 exact, leaves the pre-migration row untouched
    // (prospective only), and is idempotent on a second run.
    {
      const before = await settlementScale(db);
      assert.deepEqual([before.precision, before.scale], [14, 2], 'the harness table starts at the 0225 numeric(14,2)');
      const legacy = await (db as any).insertInto('van_rep_financial_settlements').values({
        tenant_id: TENANT, account_id: ACCOUNT, rep_id: 1, trip_id: 11,
        entry_type: 'cash_shortage', amount: 10.125, status: 'pending',
        notes: 'm10-s4 legacy row',
      }).returning(['id', 'amount']).executeTakeFirstOrThrow() as any;
      assert.equal(Number(legacy.amount), 10.13, 'pre-migration the 3dp amount rounds to 10.13 on store');
      await widenSettlementsAmountUp(db as any);
      const after = await settlementScale(db);
      assert.deepEqual([after.precision, after.scale], [14, 3], 'the real 0321 migration widens the column to numeric(14,3)');
      const fresh = await (db as any).insertInto('van_rep_financial_settlements').values({
        tenant_id: TENANT, account_id: ACCOUNT, rep_id: 1, trip_id: 12,
        entry_type: 'cash_shortage', amount: 10.125, status: 'pending',
        notes: 'm10-s4 fresh row',
      }).returning(['id', 'amount']).executeTakeFirstOrThrow() as any;
      assert.equal(Number(fresh.amount), 10.125, 'post-migration the 3dp amount is stored exact');
      const legacyAgain = await (db as any).selectFrom('van_rep_financial_settlements').select('amount').where('id', '=', Number(legacy.id)).executeTakeFirstOrThrow() as any;
      assert.equal(Number(legacyAgain.amount), 10.13, 'the pre-migration row is NOT rewritten (prospective only)');
      await widenSettlementsAmountUp(db as any);
      const again = await settlementScale(db);
      assert.deepEqual([again.precision, again.scale], [14, 3], 'a second migration run is a no-op');
      console.log('  (S4) A9: real 0321 migration stores 10.125 exact, prospective only passed');
    }

    // Source pins: the validation sits before the first write in
    // recordFieldCollection (before the internal call), it rejects
    // rather than rounds, and the migration file widens the
    // settlements column to numeric(14,3) behind an
    // information_schema guard.
    {
      const here = __dirname;
      const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
      const fnAt = vanSource.indexOf('async recordFieldCollection(');
      assert.ok(fnAt > 0, 'recordFieldCollection exists');
      const fnSlice = vanSource.slice(fnAt, vanSource.indexOf('private async recordFieldCollectionInternal'));
      assert.ok(fnSlice.includes('INV-REP-FIELD-COLLECTION-MONEY-PRECISION'), 'the fix names its invariant');
      assert.ok(fnSlice.includes('await tenantBaseCurrency(this.anyDb, tenantId)'), 'digits resolve from the tenant base currency');
      assert.ok(fnSlice.includes('currencyMoneyDigits(baseCurrency)'), 'digits come from the tenant currency code');
      assert.ok(fnSlice.includes('INVALID_PAYMENT_AMOUNT'), 'the refusal uses the general-path error code');
      assert.ok(
        fnSlice.indexOf('INVALID_PAYMENT_AMOUNT') < fnSlice.indexOf('recordFieldCollectionInternal(repId'),
        'the validation sits before the internal call (before the first write)',
      );
      assert.ok(!fnSlice.includes('roundMoney('), 'the fix rejects the amount, never rounds it');
      const migSource = readFileSync(resolve(here, '../../src/database/migrations/2040000000321_van_rep_financial_settlements_amount_3dp.ts'), 'utf8');
      assert.ok(migSource.includes('van_rep_financial_settlements'), 'the migration names the settlements table');
      assert.ok(migSource.includes('ALTER COLUMN "amount" TYPE numeric(14, 3)'), 'the migration widens amount to numeric(14,3)');
      assert.ok(migSource.includes('information_schema'), 'the migration guards on information_schema');
      console.log('  source pins passed');
    }

    console.log('rep-field-collection-money-precision-m10: all cases passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(async () => {
    console.log('rep-field-collection-money-precision-m10: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
