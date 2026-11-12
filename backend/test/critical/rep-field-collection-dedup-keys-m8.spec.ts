/*
 * Rep field-collection dedup keys (INV-REP-FIELD-COLLECTION-DEDUP-KEYS).
 *
 * THE GAPS (B3 + B7 + B8):
 * - B3: the in-memory dedup fingerprint in recordFieldCollection was
 *   `tenant:trip:rep:customer:amount` — NO channel. A cash collection
 *   then an instapay collection of the same amount within 5s was
 *   swallowed and reported as the first; the electronic receipt never
 *   posted to 1120 and the customer was never credited for the second
 *   payment. The fix includes the resolved payment channel in the
 *   fingerprint, so the same amount via a different channel is a
 *   different collection, while a true retry (same channel, same
 *   everything, within 5s) still dedups.
 * - B7: the two dedup-replay branches (clientTxId hit, twin hit)
 *   returned `{ previousBalance: 0, newBalance: 0 }` with the real
 *   receipt/amount, so a replayed collection showed the customer at
 *   balance 0 in the app even though the real balance was non-zero.
 *   The fix re-reads the customer's current balance and returns
 *   newBalance = current balance, previousBalance = current + the
 *   stored payment amount — the same figure the receipt screen
 *   derives as newBalance + amount.
 * - B8: the client_tx_id dedup lookup matched tenant + customer +
 *   client_tx_id only — NO van_trip_id. A customer key reused on a
 *   different trip returned the first trip's payment as if it were
 *   this trip's, and the new collection was never written. The fix
 *   scopes the lookup (column AND legacy note-tag fallback) by
 *   van_trip_id as well.
 *
 * HARNESS: the real VanSalesService + the real
 * AccountingPostingService on ONE shared PGlite database, same stubs
 * as the rep-collection-total-debt-cap spec (resolveSystemAuthContext
 * shadowed, fraud radar stubbed no-op — a pool read inside the open
 * transaction deadlocks on PGlite's single connection). The supervisor
 * PIN is driven through the REAL verifySupervisorPin: the shared
 * manager PIN is seeded as a bcrypt hash in settings, as in the
 * van-field-noncash-evidence spec. Cases are isolated by distinct
 * trip / customer ids on the single shared database, and the
 * class-level collection caches are cleared between cases so each
 * case exercises the layer it names (in-memory vs database replay).
 * The driver controller is NOT driven here: recordCollection resolves
 * the driver from a portal token, not from req.authContext, and it
 * carries no balance logic — the service is the unit under fix. A
 * source pin below asserts the controller forwards the verified
 * driver's repId / tenantId / accountId to recordFieldCollection.
 *
 * LIMITS (recorded, not fixed here): on a replay, previousBalance is
 * exact when no later collection intervened; a later collection
 * shifts it by that later amount (newBalance is always the live
 * current balance). The exact historical previous lives on the
 * customer_ledger row of the original collection.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { hashManagerPin } from '../../src/common/utils/manager-approval';

const TENANT = 't-rep-field-collection-dedup-keys-m8';
const ACCOUNT = 'a-rep-field-collection-dedup-keys-m8';
const SUPERVISOR_PIN = '4321';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
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
    `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: JSON.stringify(await hashManagerPin(SUPERVISOR_PIN)) }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
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
  // One open trip per case (1-6), one customer per case (31-35).
  for (let tripId = 1; tripId <= 6; tripId++) {
    await anyDb.insertInto('van_sales_trips').values({ id: tripId, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 1, van_location_id: 20, status: 'open' }).execute();
  }
  // Customer 31: owes 200, all of it rep 1's share (ledger +200 via trip 1) — the B3 customer.
  await anyDb.insertInto('customers').values({ id: 31, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 31', balance: 200, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  await anyDb.insertInto('customer_ledger').values({ customer_id: 31, entry_type: 'sale', amount: 200, balance_after: 200, reference_type: 'sale', reference_id: null, van_trip_id: 1, tenant_id: TENANT, account_id: ACCOUNT }).execute();
  // Customer 32: owes 200, all of it rep 1's share (ledger +200 via trip 2) — the true-retry / B7 clientTxId customer.
  await anyDb.insertInto('customers').values({ id: 32, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 32', balance: 200, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  await anyDb.insertInto('customer_ledger').values({ customer_id: 32, entry_type: 'sale', amount: 200, balance_after: 200, reference_type: 'sale', reference_id: null, van_trip_id: 2, tenant_id: TENANT, account_id: ACCOUNT }).execute();
  // Customer 33: owes 200, all of it rep 1's share (ledger +200 via trip 3) — the B7 twin customer.
  await anyDb.insertInto('customers').values({ id: 33, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 33', balance: 200, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  await anyDb.insertInto('customer_ledger').values({ customer_id: 33, entry_type: 'sale', amount: 200, balance_after: 200, reference_type: 'sale', reference_id: null, van_trip_id: 3, tenant_id: TENANT, account_id: ACCOUNT }).execute();
  // Customer 34: owes 300, all of it rep 1's share (ledger +300 via trip 4) — the B8 customer (two trips).
  await anyDb.insertInto('customers').values({ id: 34, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 34', balance: 300, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  await anyDb.insertInto('customer_ledger').values({ customer_id: 34, entry_type: 'sale', amount: 300, balance_after: 300, reference_type: 'sale', reference_id: null, van_trip_id: 4, tenant_id: TENANT, account_id: ACCOUNT }).execute();
  // Customer 35: owes 300, all of it rep 1's share (ledger +300 via trip 6) — the legacy-tag customer.
  // A pre-0268 payment row sits on this customer: note tag only, no
  // client_tx_id column, no van_trip_id — exactly the row the legacy
  // fallback exists for. Its 100 is NOT reflected in the balance:
  // the case asserts only that a new collection with the same key on
  // trip 6 posts as new, never that the legacy row's money moved.
  await anyDb.insertInto('customers').values({ id: 35, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 35', balance: 300, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  await anyDb.insertInto('customer_ledger').values({ customer_id: 35, entry_type: 'sale', amount: 300, balance_after: 300, reference_type: 'sale', reference_id: null, van_trip_id: 6, tenant_id: TENANT, account_id: ACCOUNT }).execute();
  await anyDb.insertInto('customer_payments').values({
    tenant_id: TENANT, account_id: ACCOUNT, customer_id: 35, amount: 100,
    note: 'سند تحصيل نقدي ميداني بواسطة المندوب (#COL-LEGACY) [tx:m8-legacy-key]',
    payment_channel: 'cash', van_trip_id: null, rep_id: 1, client_tx_id: null,
  }).execute();
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

function clearCollectionCaches(): void {
  // recordFieldCollection dedups in memory on the class-level
  // caches, so each case starts with no stale hit.
  (VanSalesService as any).recentCollectionsCache?.clear?.();
  (VanSalesService as any).inFlightCollectionPromises?.clear?.();
}

async function customerBalance(db: Kysely<Database>, customerId: number): Promise<number> {
  const row = await (db as any).selectFrom('customers').select('balance').where('id', '=', customerId).executeTakeFirstOrThrow() as any;
  return Number(row.balance);
}

async function customerPayments(db: Kysely<Database>, customerId: number): Promise<any[]> {
  return (db as any).selectFrom('customer_payments').selectAll().where('tenant_id', '=', TENANT).where('customer_id', '=', customerId).orderBy('id', 'asc').execute();
}

async function journalCount(db: Kysely<Database>, sourceType: string): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entries').selectAll().where('source_type', '=', sourceType).where('tenant_id', '=', TENANT).execute();
  return rows.length;
}

async function tripRow(db: Kysely<Database>, tripId: number): Promise<any> {
  return (db as any).selectFrom('van_sales_trips').selectAll().where('id', '=', tripId).executeTakeFirstOrThrow();
}

async function main(): Promise<void> {
  const { db } = await makeDb();
  try {
    await seedFoundation(db);
    const service = buildService(db);

    // S1 (B3). Same amount, different channel, within the window:
    // 100 cash then 100 instapay on the same trip/customer post as
    // TWO collections. Before the fix the second call hit the
    // channel-blind fingerprint cache and returned the first receipt
    // — the electronic receipt never posted to 1120 and the customer
    // was never credited for the second payment.
    {
      clearCollectionCaches();
      const journalsBefore = await journalCount(db, 'van_field_collection');
      const cash = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 31, amount: 100, paymentMethod: 'cash', clientTxId: 'm8-b3-cash',
      });
      assert.equal(cash.ok, true);
      assert.equal(cash.amount, 100);
      assert.equal(cash.previousBalance, 200, 'cash leg: previous balance is the 200 debt');
      assert.equal(cash.newBalance, 100, 'cash leg: new balance is 100');
      const insta = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 31, amount: 100, paymentMethod: 'instapay',
        supervisorOverridePin: SUPERVISOR_PIN, transferReference: 'IP-778899', clientTxId: 'm8-b3-insta',
      });
      assert.equal(insta.ok, true);
      assert.equal(insta.amount, 100);
      assert.notEqual(insta.receiptNo, cash.receiptNo, 'the instapay leg has its own receipt, not the cash receipt');
      assert.equal(insta.previousBalance, 100, 'instapay leg: previous balance is the 100 left after cash');
      assert.equal(insta.newBalance, 0, 'instapay leg: new balance is 0');
      assert.equal(await customerBalance(db, 31), 0, 'both 100s collected off the 200 debt');
      const payments = await customerPayments(db, 31);
      assert.equal(payments.length, 2, 'two customer_payments rows were written');
      assert.deepEqual(
        payments.map((p: any) => p.payment_channel).sort(),
        ['cash', 'instapay'],
        'one cash leg and one instapay leg',
      );
      assert.equal(await journalCount(db, 'van_field_collection'), journalsBefore + 2, 'exactly two collection journals posted');
      const trip = await tripRow(db, 1);
      assert.equal(Number(trip.cash_collected), 100, 'trip cash total holds only the cash leg');
      assert.equal(Number(trip.total_instapay_collections), 100, 'trip instapay total holds only the electronic leg');
      console.log('  (S1) B3: same amount, different channel posts twice passed');
    }

    // S2 (guard). True retry, same channel, same key, immediately:
    // dedups to the first receipt — no double post. This must keep
    // passing with the fix: the channel is in the key, and a retry
    // carries the same channel.
    {
      clearCollectionCaches();
      const first = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 2, customerId: 32, amount: 100, paymentMethod: 'cash', clientTxId: 'm8-retry-1',
      });
      assert.equal(first.ok, true);
      assert.equal(first.previousBalance, 200);
      assert.equal(first.newBalance, 100);
      const retry = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 2, customerId: 32, amount: 100, paymentMethod: 'cash', clientTxId: 'm8-retry-1',
      });
      assert.equal(retry.receiptNo, first.receiptNo, 'the retry returns the first receipt');
      assert.equal(retry.amount, 100);
      assert.equal(await customerBalance(db, 32), 100, 'the retry moved no further money');
      assert.equal((await customerPayments(db, 32)).length, 1, 'exactly one payment row for the retried collection');
      console.log('  (S2) guard: true retry same channel dedups passed');
    }

    // S3 (B7, clientTxId branch). Same retry as S2, but after the
    // in-memory caches are cleared, so the DATABASE client_tx_id
    // lookup answers: same receipt, and the REAL balances (200/100),
    // not 0/0. Before the fix this returned previousBalance 0 and
    // newBalance 0 while the real balance was 100.
    {
      clearCollectionCaches();
      const first = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 2, customerId: 32, amount: 100, paymentMethod: 'cash', clientTxId: 'm8-retry-1',
      });
      assert.equal(first.receiptNo, (await customerPayments(db, 32))[0].note.match(/#([A-Z0-9-]+)/)?.[1]);
      assert.equal(first.previousBalance, 200, 'database replay: previous balance is the real 200');
      assert.equal(first.newBalance, 100, 'database replay: new balance is the real 100');
      assert.notEqual(first.previousBalance, 0, 'the replay must not report previous balance 0');
      assert.notEqual(first.newBalance, 0, 'the replay must not report new balance 0 while 100 is owed');
      assert.equal(await customerBalance(db, 32), 100, 'no second write happened on the replay');
      assert.equal((await customerPayments(db, 32)).length, 1, 'still exactly one payment row');
      console.log('  (S3) B7: clientTxId replay returns the real balances passed');
    }

    // S4 (B7, twin branch). A collection with NO clientTxId, then the
    // same payload again after the caches are cleared, inside the 4s
    // window: the database twin check answers with the same receipt
    // and the REAL balances (200/100), not 0/0.
    {
      clearCollectionCaches();
      const first = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 3, customerId: 33, amount: 100, paymentMethod: 'cash',
      });
      assert.equal(first.ok, true);
      assert.equal(first.previousBalance, 200);
      assert.equal(first.newBalance, 100);
      clearCollectionCaches();
      const twin = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 3, customerId: 33, amount: 100, paymentMethod: 'cash',
      });
      assert.equal(twin.receiptNo, first.receiptNo, 'the twin replay returns the first receipt');
      assert.equal(twin.amount, 100);
      assert.equal(twin.previousBalance, 200, 'twin replay: previous balance is the real 200');
      assert.equal(twin.newBalance, 100, 'twin replay: new balance is the real 100');
      assert.equal(await customerBalance(db, 33), 100, 'no second write happened on the twin replay');
      assert.equal((await customerPayments(db, 33)).length, 1, 'still exactly one payment row');
      console.log('  (S4) B7: twin replay returns the real balances passed');
    }

    // S5 (B8). The same clientTxId reused on a DIFFERENT trip is a
    // NEW collection for that trip: a second receipt, a second payment
    // row scoped to trip 5, and the balance drops again. Before the
    // fix the trip-unscoped lookup returned the trip-4 payment and
    // the trip-5 collection was never written.
    {
      clearCollectionCaches();
      const first = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 4, customerId: 34, amount: 100, paymentMethod: 'cash', clientTxId: 'm8-shared-key',
      });
      assert.equal(first.ok, true);
      assert.equal(first.previousBalance, 300);
      assert.equal(first.newBalance, 200);
      clearCollectionCaches();
      const second = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 5, customerId: 34, amount: 100, paymentMethod: 'cash', clientTxId: 'm8-shared-key',
      });
      assert.equal(second.ok, true);
      assert.notEqual(second.receiptNo, first.receiptNo, 'the second trip has its own receipt');
      assert.equal(second.previousBalance, 200, 'second trip: previous balance is the 200 left after trip 4');
      assert.equal(second.newBalance, 100, 'second trip: new balance is 100');
      assert.equal(await customerBalance(db, 34), 100, 'both trips collected 100 off the 300 debt');
      const payments = await customerPayments(db, 34);
      assert.equal(payments.length, 2, 'two payment rows were written');
      assert.deepEqual(
        payments.map((p: any) => Number(p.van_trip_id)).sort(),
        [4, 5],
        'one payment row per trip',
      );
      console.log('  (S5) B8: clientTxId reused on a different trip posts as new passed');
    }

    // S6 (B8, legacy tag fallback). A pre-0268 row carries the key
    // only as a [tx:...] note tag, with no client_tx_id column and no
    // van_trip_id. A new collection with that key on trip 6 must post
    // as new: the unscoped fallback would have matched the legacy row
    // and swallowed it. (The legacy row itself is untouched history.)
    {
      clearCollectionCaches();
      const res = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 6, customerId: 35, amount: 100, paymentMethod: 'cash', clientTxId: 'm8-legacy-key',
      });
      assert.equal(res.ok, true);
      assert.equal(res.previousBalance, 300, 'legacy-key collection: previous balance is the 300 debt');
      assert.equal(res.newBalance, 200, 'legacy-key collection: new balance is 200');
      assert.equal(await customerBalance(db, 35), 200, 'the legacy-key collection moved the money');
      const payments = await customerPayments(db, 35);
      assert.equal(payments.length, 2, 'legacy row plus the new collection row');
      const fresh = payments.find((p: any) => p.client_tx_id === 'm8-legacy-key');
      assert.ok(fresh, 'the new row carries the client_tx_id column');
      assert.equal(Number(fresh.van_trip_id), 6, 'the new row is scoped to trip 6');
      console.log('  (S6) B8: legacy note-tag fallback is trip-scoped passed');
    }

    // Source pins: the fingerprint carries the channel, the
    // client_tx_id lookup is trip-scoped, no replay returns 0/0,
    // and the driver controller forwards the verified driver to the
    // service (it resolves the driver from a portal token, not from
    // req.authContext, and carries no balance logic).
    {
      const here = __dirname;
      const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
      assert.ok(vanSource.includes('INV-REP-FIELD-COLLECTION-DEDUP-KEYS'), 'van-sales names the invariant');
      const fnAt = vanSource.indexOf('async recordFieldCollection(');
      assert.ok(fnAt > 0, 'recordFieldCollection exists');
      const fnSlice = vanSource.slice(fnAt, vanSource.indexOf('private async recordFieldCollectionInternal'));
      assert.ok(
        fnSlice.includes(':${resolveFieldCollectionChannel(payload.paymentMethod)}'),
        'the fingerprint key includes the resolved channel',
      );
      const lookupAt = fnSlice.indexOf('existingByColumn');
      assert.ok(lookupAt > 0, 'the client_tx_id column lookup exists');
      assert.ok(
        fnSlice.slice(lookupAt, lookupAt + 700).includes("where('van_trip_id', '=', payload.tripId)"),
        'the client_tx_id lookup is scoped by van_trip_id',
      );
      assert.ok(!fnSlice.includes('previousBalance: 0'), 'no replay branch returns previousBalance 0');
      assert.ok(!fnSlice.includes('newBalance: 0'), 'no replay branch returns newBalance 0');
      const controllerSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.controller.ts'), 'utf8');
      assert.ok(
        controllerSource.includes('recordFieldCollection(driver.repId, driver.tenantId, driver.accountId, body)'),
        'the driver controller forwards the verified driver to recordFieldCollection',
      );
      console.log('  source pins passed');
    }

    console.log('rep-field-collection-dedup-keys-m8: all cases passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(async () => {
    console.log('rep-field-collection-dedup-keys-m8: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
