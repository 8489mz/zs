/*
 * Rep field-collection total-debt cap (INV-REP-COLLECTION-TOTAL-BALANCE-CAP).
 *
 * THE GAP (B2): validateIsolatedRepCollection refused a collection only
 * when it exceeded the rep's own share AND another rep held balance on
 * the same customer (`amount > repPreviousBalance && otherRepsBalance > 0`).
 * When otherRepsBalance == 0 — the common sole-rep customer — ANY amount
 * returned allowed: true, and recordFieldCollectionInternal then executed
 * `customers.balance = COALESCE(balance, 0) - amount` with no floor, so a
 * rep collecting 150 against a 100 debt drove customers.balance and 1130
 * to -50 while rep custody held +150 — over-collection with no recorded
 * advance intent.
 *
 * THE RULE: a field collection is refused when amount > TOTAL customer
 * debt (this rep's share + other reps' balances + any unassigned
 * balance), unless the payload explicitly records an advance. Grounding
 * at 2f9c0a68: there is NO advance concept on the field-collection path
 * — no advance flag on the recordFieldCollection payload, no advance
 * column on customer_payments, zero "advance" hits in modules/delivery-reps
 * — so the fix is a hard refuse above total debt with a SPECIFIC error
 * naming both amounts (collected vs total debt). The pre-existing
 * cross-rep guard still runs first: collecting another rep's share stays
 * refused under its own code even when the total would allow it.
 * Defence in depth at the balance write: the write itself throws (rolling
 * the whole collection transaction back) if the post-write balance would
 * be negative at book digits, so no future caller can commit a negative
 * customer balance even by bypassing the engine gate.
 *
 * HARNESS: the real VanSalesService + the real AccountingPostingService
 * on ONE shared PGlite database, same stubs as the
 * van-field-noncash-evidence spec (resolveSystemAuthContext shadowed,
 * fraud radar stubbed no-op — a pool read inside the open transaction
 * deadlocks on PGlite's single connection). Engine-level cases drive the
 * real validateIsolatedRepCollection directly; service-level cases drive
 * the real recordFieldCollection end to end (cash, so the non-cash
 * evidence gate is untouched). Cases are isolated by distinct trip /
 * customer ids on the single shared database.
 *
 * LIMITS (recorded, not fixed here): the receipt's rep new balance
 * (repPreviousBalance - amount) can go negative when a rep collects
 * unassigned legacy balance beyond his own share (case 3: 100 - 120 =
 * -20) — the MONEY (customers.balance / 1130) is exact, only that
 * informational rep figure is unclamped; it is display-only, so per the
 * standing rule it is recorded here, not fixed in this package.
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
import { validateIsolatedRepCollection } from '../../src/modules/delivery-reps/rep-target.engine';

const TENANT = 't-rep-collection-total-debt-cap';
const ACCOUNT = 'a-rep-collection-total-debt-cap';

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
  // One open trip per service case (1-4), one customer per case (21-24).
  for (let tripId = 1; tripId <= 4; tripId++) {
    await anyDb.insertInto('van_sales_trips').values({ id: tripId, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 1, van_location_id: 20, status: 'open' }).execute();
  }
  // Customer 21: owes 100, all of it rep 1's share (ledger +100 via trip 1).
  await anyDb.insertInto('customers').values({ id: 21, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 21', balance: 100, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  await anyDb.insertInto('customer_ledger').values({ customer_id: 21, entry_type: 'sale', amount: 100, balance_after: 100, reference_type: 'sale', reference_id: null, van_trip_id: 1, tenant_id: TENANT, account_id: ACCOUNT }).execute();
  // Customer 22: owes 100, all of it rep 1's share (ledger +100 via trip 2) — the B2 hole customer.
  await anyDb.insertInto('customers').values({ id: 22, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 22', balance: 100, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  await anyDb.insertInto('customer_ledger').values({ customer_id: 22, entry_type: 'sale', amount: 100, balance_after: 100, reference_type: 'sale', reference_id: null, van_trip_id: 2, tenant_id: TENANT, account_id: ACCOUNT }).execute();
  // Customer 23: owes 150 total = rep 1's share 100 + 50 unassigned legacy balance.
  await anyDb.insertInto('customers').values({ id: 23, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 23', balance: 150, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  await anyDb.insertInto('customer_ledger').values({ customer_id: 23, entry_type: 'sale', amount: 100, balance_after: 150, reference_type: 'sale', reference_id: null, van_trip_id: 3, tenant_id: TENANT, account_id: ACCOUNT }).execute();
  // Customer 24: owes 100, all of it rep 1's share (ledger +100 via trip 4) — boundary customer.
  await anyDb.insertInto('customers').values({ id: 24, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 24', balance: 100, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  await anyDb.insertInto('customer_ledger').values({ customer_id: 24, entry_type: 'sale', amount: 100, balance_after: 100, reference_type: 'sale', reference_id: null, van_trip_id: 4, tenant_id: TENANT, account_id: ACCOUNT }).execute();
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
  // caches, so a refused-then-retried collection in the next case
  // must not read a stale hit.
  (VanSalesService as any).recentCollectionsCache?.clear?.();
  (VanSalesService as any).inFlightCollectionPromises?.clear?.();
}

async function customerBalance(db: Kysely<Database>, customerId: number): Promise<number> {
  const row = await (db as any).selectFrom('customers').select('balance').where('id', '=', customerId).executeTakeFirstOrThrow() as any;
  return Number(row.balance);
}

async function paymentsCount(db: Kysely<Database>): Promise<number> {
  const rows = await (db as any).selectFrom('customer_payments').selectAll().where('tenant_id', '=', TENANT).execute();
  return rows.length;
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

    // E1. Engine: amount == total debt is allowed.
    {
      const v = validateIsolatedRepCollection({
        repId: 1, collectionAmount: 100, repBalance: 100, otherRepsBalance: 0, totalCustomerBalance: 100, moneyDigits: 2,
      });
      assert.equal(v.allowed, true);
      assert.equal(v.companyPreviousBalance, 100);
      assert.equal(v.companyNewBalance, 0);
      assert.equal(v.repNewBalance, 0);
      console.log('  (E1) engine: amount == total debt allowed passed');
    }

    // E2. Engine: amount > total debt with otherRepsBalance == 0 is
    // REFUSED — the exact B2 hole (before the fix this returned
    // allowed: true). The error names both amounts.
    {
      const v = validateIsolatedRepCollection({
        repId: 1, collectionAmount: 150, repBalance: 100, otherRepsBalance: 0, totalCustomerBalance: 100, moneyDigits: 2,
      });
      assert.equal(v.allowed, false);
      assert.equal(v.errorCode, 'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE');
      assert.ok((v.errorMessage || '').includes('150'), 'error names the collected amount');
      assert.ok((v.errorMessage || '').includes('100'), 'error names the total debt');
      assert.equal(v.repNewBalance, 100, 'rep balance unchanged on refusal');
      assert.equal(v.companyNewBalance, 100, 'company balance unchanged on refusal');
      console.log('  (E2) engine: amount > total debt with no other rep refused passed');
    }

    // E3. Engine: amount > the rep's own share but <= total debt is
    // allowed (the excess comes out of the unassigned legacy balance,
    // nobody else's custody — otherRepsBalance is 0).
    {
      const v = validateIsolatedRepCollection({
        repId: 1, collectionAmount: 120, repBalance: 100, otherRepsBalance: 0, totalCustomerBalance: 150, moneyDigits: 2,
      });
      assert.equal(v.allowed, true);
      assert.equal(v.companyPreviousBalance, 150);
      assert.equal(v.companyNewBalance, 30);
      console.log('  (E3) engine: amount above own share but within total debt allowed passed');
    }

    // E4. Engine + source pin: amount > total debt with an explicitly
    // recorded advance would be allowed — but there IS no advance
    // concept on the field-collection path, so it is refused. The
    // collection payload carries no advance field and customer_payments
    // carries no advance column.
    {
      const here = __dirname;
      const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
      const payloadAt = vanSource.indexOf('async recordFieldCollection(');
      assert.ok(payloadAt > 0, 'recordFieldCollection exists');
      const payloadSlice = vanSource.slice(payloadAt, payloadAt + 1200);
      assert.ok(!/advance/i.test(payloadSlice), 'the collection payload carries no advance flag');
      const engineSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/rep-target.engine.ts'), 'utf8');
      assert.ok(engineSource.includes('INV-REP-COLLECTION-TOTAL-BALANCE-CAP'), 'the engine names the invariant');
      const v = validateIsolatedRepCollection({
        repId: 1, collectionAmount: 150, repBalance: 100, otherRepsBalance: 0, totalCustomerBalance: 100, moneyDigits: 2,
      });
      assert.equal(v.allowed, false);
      assert.equal(v.errorCode, 'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE');
      console.log('  (E4) engine: over-total collection refused, no advance concept exists passed');
    }

    // S1. Service: collecting exactly the total debt posts — the
    // customer balance drops to exactly 0, never below.
    {
      clearCollectionCaches();
      const journalsBefore = await journalCount(db, 'van_field_collection');
      const res = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 21, amount: 100, paymentMethod: 'cash',
      });
      assert.equal(res.ok, true);
      assert.equal(res.amount, 100);
      assert.equal(await customerBalance(db, 21), 0, '100 collected off the 100 balance');
      assert.equal(await journalCount(db, 'van_field_collection'), journalsBefore + 1, 'exactly one collection journal posted');
      console.log('  (S1) service: amount == total debt posts, balance 0 passed');
    }

    // S2 + case (5). Service: collecting 150 against a 100 total debt
    // with no other rep is REFUSED (the B2 hole, end to end) — and
    // after the refusal the customer balance is unchanged, never
    // negative: no payment row, no journal, trip cash untouched.
    {
      clearCollectionCaches();
      const journalsBefore = await journalCount(db, 'van_field_collection');
      const paymentsBefore = await paymentsCount(db);
      await assert.rejects(
        () => service.recordFieldCollection(1, TENANT, ACCOUNT, {
          tripId: 2, customerId: 22, amount: 150, paymentMethod: 'cash',
        }),
        (err: any) => err.code === 'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE',
        'an over-total collection must be refused with the total-cap code',
      );
      assert.equal(await customerBalance(db, 22), 100, 'customer balance unchanged after refusal');
      assert.ok((await customerBalance(db, 22)) >= 0, 'customer balance never negative');
      assert.equal(await paymentsCount(db), paymentsBefore, 'no customer_payments row was written');
      assert.equal(await journalCount(db, 'van_field_collection'), journalsBefore, 'no collection journal was posted');
      const trip = await tripRow(db, 2);
      assert.equal(Number(trip.cash_collected), 0, 'trip cash total untouched');
      console.log('  (S2) service: amount > total debt refused, balance unchanged passed');
    }

    // S3. Service: collecting 120 against a 150 total debt (rep share
    // 100 + 50 unassigned) posts — the balance drops to 30.
    {
      clearCollectionCaches();
      const res = await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 3, customerId: 23, amount: 120, paymentMethod: 'cash',
      });
      assert.equal(res.ok, true);
      assert.equal(res.amount, 120);
      assert.equal(await customerBalance(db, 23), 30, '120 collected off the 150 balance');
      console.log('  (S3) service: amount above own share but within total debt posts passed');
    }

    // S4. Service: the cap is exact — 100.01 against a 100 total debt
    // is refused, not rounded away.
    {
      clearCollectionCaches();
      await assert.rejects(
        () => service.recordFieldCollection(1, TENANT, ACCOUNT, {
          tripId: 4, customerId: 24, amount: 100.01, paymentMethod: 'cash',
        }),
        (err: any) => err.code === 'REP_COLLECTION_EXCEEDS_TOTAL_BALANCE',
        'one minor unit over the total debt must still be refused',
      );
      assert.equal(await customerBalance(db, 24), 100, 'customer balance unchanged after refusal');
      console.log('  (S4) service: one minor unit over total debt refused passed');
    }

    // Source pins: the floor guard sits at the balance write, and the
    // invariant id is present at both enforcement points.
    {
      const here = __dirname;
      const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-collections-and-swaps.service.ts'), 'utf8');
      assert.ok(vanSource.includes('INV-REP-COLLECTION-TOTAL-BALANCE-CAP'), 'van-sales names the invariant');
      assert.ok(vanSource.includes('roundMoney(finalBalance, moneyDigits) < 0'), 'the balance write carries the negative-balance floor guard');
      assert.ok(vanSource.includes('REP_COLLECTION_EXCEEDS_TOTAL_BALANCE'), 'van-sales uses the total-cap error code');
      console.log('  source pins passed');
    }

    console.log('rep-collection-total-debt-cap: all cases passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(async () => {
    console.log('rep-collection-total-debt-cap: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
