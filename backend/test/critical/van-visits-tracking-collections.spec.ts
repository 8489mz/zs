/*
 * Van visits tracking collections (INV-VAN-VISITS-TRACKING-COLLECTIONS, P2).
 *
 * THE GAP (live trial test10k 2026-11-13): the supervisor live-tracking
 * tab showed "تحصيلات 363" while the trips tab showed "نقدية محصلة
 * 651.00" for the same rep. 363 = the two cash SALES (288 + 75); the
 * real 288 collection (COL-261113-0001) never appeared. Two defects
 * in VanFieldExecutionService.getVisitsHistory:
 * (a) the synthetic-visit branch built a visit row per unlinked field
 *     sale and set has_collection = (payment_type === 'cash') with
 *     collection_amount = the sale total — a cash SALE counted as a
 *     COLLECTION. The pure engine (FmcgVisitExecutionEngine) just sums
 *     collection_amount into totalCollectionsAmount, so every cash
 *     sale inflated "تحصيلات".
 * (b) a real field collection never reached the total at all: the
 *     collection tab records it via recordFieldCollection into
 *     customer_payments (van_trip_id + rep_id + customer_id scope),
 *     and collection_amount on van_store_visits is written only at
 *     visit check-out — but the visit auto-ends after a sale, so a
 *     collection recorded after the sale has no open visit to land on.
 *
 * THE RULE: a cash sale is cash in hand, not a collection — the
 * synthetic branch sets has_collection false and collection_amount 0.
 * "تحصيلات" (totalCollectionsAmount) is the sum of the real field
 * collection vouchers (customer_payments with a van_trip_id) in the
 * same scope as the visits (trip / rep / customer / date). The trips
 * tab is untouched: it reads vt.cash_collected, which correctly adds
 * cash sales + real collections (cash the rep holds).
 *
 * HARNESS: the real VanSalesService (executeFieldSale +
 * recordFieldCollection) and the real VanFieldExecutionService on
 * PGlite, same harness as van-field-sale-wholesale-price.spec.ts
 * (tenant foundation stubbed no-op; resolveSystemAuthContext
 * shadowed; fraud radar stubbed no-op). Each case gets its own
 * tenant id: recordFieldCollection keeps a static in-memory dedup
 * cache keyed by tenant+trip+rep+customer+amount+channel, so a
 * shared tenant would swallow a same-amount collection in a later
 * case as a replay.
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
import { VanFieldExecutionService } from '../../src/modules/delivery-reps/services/van-field-execution.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';

const ACCOUNT = 'a-van-tracking';

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
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, customer_name text, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, status text);
      CREATE TABLE van_store_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, customer_name text, check_in_at timestamptz, check_out_at timestamptz, dwell_time_seconds numeric, check_in_lat numeric, check_in_lng numeric, is_geofence_valid boolean, geofence_distance_meters numeric, has_sale boolean, sale_id bigint, sale_amount numeric, has_collection boolean, collection_amount numeric, no_sale_reason text, no_sale_notes text, store_inventory text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, note text, transfer_reference text, transfer_receipt_url text, van_trip_id bigint, rep_id bigint, client_tx_id text, payment_channel text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, gps_lat numeric, gps_lng numeric, tenant_id text, account_id text);
    `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>, tenant: string, currency: string): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: tenant, key: 'currency', value: currency }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: tenant, currency_code: currency, exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: tenant, username: 'sys', is_active: true }).execute();
  const accounts: Array<[number, string, string]> = [
    [1110, '1110', 'asset'], [1120, '1120', 'asset'], [1130, '1130', 'asset'], [1140, '1140', 'asset'],
    [2120, '2120', 'liability'], [4100, '4100', 'revenue'], [4300, '4300', 'revenue'], [5100, '5100', 'expense'],
  ];
  for (const [id, code, type] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: tenant, code, name_ar: code, account_type: type, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: tenant, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, inventory_account_id: 1140,
    sales_revenue_account_id: 4100, sales_discount_account_id: 4300,
    cogs_account_id: 5100, sales_tax_account_id: 2120,
  }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: tenant, account_id: ACCOUNT, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 20, tenant_id: tenant, account_id: ACCOUNT, name: 'Van', location_type: 'van', is_active: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: 1, tenant_id: tenant, account_id: ACCOUNT, name: 'Rep 1', van_location_id: 20, is_van_rep: true }).execute();
  await anyDb.insertInto('van_sales_trips').values({ id: 1, tenant_id: tenant, account_id: ACCOUNT, rep_id: 1, van_location_id: 20, status: 'open' }).execute();
}

async function seedProduct(db: Kysely<Database>, tenant: string, id: number, retail: number, cost: number, vanQty: number): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('products').values({ id, tenant_id: tenant, account_id: ACCOUNT, name: `Product ${id}`, stock_qty: vanQty, cost_price: cost, retail_price: retail, wholesale_price: 0, credit_price: 0, is_active: true }).execute();
  await anyDb.insertInto('product_location_stock').values({ tenant_id: tenant, account_id: ACCOUNT, product_id: id, location_id: 20, qty: vanQty }).execute();
}

async function seedCustomer(db: Kysely<Database>, tenant: string, id: number, customerType: string, balance = 0): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('customers').values({ id, tenant_id: tenant, account_id: ACCOUNT, name: `Customer ${id}`, balance, credit_limit: 5000, customer_type: customerType, metadata: '{}', is_active: true }).execute();
}

function buildSalesService(db: Kysely<Database>, tenant: string): VanSalesService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const fraudStub = { recordSuspicionEvent: async () => {}, getSummary: async () => ({}), getEvents: async () => [] };
  const service = new VanSalesService(db, {} as never, {} as never, posting as never,
    undefined, undefined, undefined, undefined, undefined, undefined, fraudStub as never);
  (service as any).resolveSystemAuthContext = async () => ({
    userId: 1, sessionId: 'spec', username: 'spec', role: 'admin',
    permissions: ['accounting'], tenantId: tenant, accountId: ACCOUNT,
  });
  return service;
}

function buildVisitsService(db: Kysely<Database>): VanFieldExecutionService {
  return new VanFieldExecutionService(db, {} as never);
}

async function main(): Promise<void> {
  // 1. The trial scenario: cash sale 288 + cash sale 75 + credit sale
  // 500 (balance for the collection) + a separate collection voucher
  // 288. "تحصيلات" must be the real collection only (288); sales
  // still total all three sales (863); the cash-sale visit rows carry
  // no collection.
  {
    const TENANT = 't-van-track-1';
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, TENANT, 'EGP');
      await seedProduct(db, TENANT, 101, 12, 5, 100);
      await seedProduct(db, TENANT, 102, 25, 8, 100);
      await seedProduct(db, TENANT, 103, 50, 10, 100);
      await seedCustomer(db, TENANT, 3060, 'cash');
      const sales = buildSalesService(db, TENANT);
      const visits = buildVisitsService(db);
      const cash288 = await sales.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash', customerId: 3060,
        items: [{ productId: 101, qty: 24, unitPrice: 12 }],
      });
      assert.equal(cash288.total, 288);
      const cash75 = await sales.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash', customerId: 3060,
        items: [{ productId: 102, qty: 3, unitPrice: 25 }],
      });
      assert.equal(cash75.total, 75);
      const credit500 = await sales.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'credit', customerId: 3060,
        items: [{ productId: 103, qty: 10, unitPrice: 50 }],
      });
      assert.equal(credit500.total, 500);
      const col = await sales.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 3060, amount: 288, paymentMethod: 'cash',
      });
      assert.equal(col.ok, true);
      assert.equal(col.amount, 288);

      const res = await visits.getVisitsHistory(TENANT, { tripId: 1 });
      assert.equal(res.metrics.totalCollectionsAmount, 288);
      assert.equal(res.metrics.totalSalesAmount, 863);
      assert.equal(res.metrics.totalVisits, 3);
      const cashRows = res.visits.filter((v: any) => v.saleAmount === 288 || v.saleAmount === 75);
      assert.equal(cashRows.length, 2);
      for (const row of cashRows) {
        assert.equal(row.hasCollection, false);
        assert.equal(row.collectionAmount, 0);
      }
      const creditRow = res.visits.find((v: any) => v.saleAmount === 500);
      assert.ok(creditRow);
      assert.equal(creditRow.hasCollection, false);
      assert.equal(creditRow.collectionAmount, 0);

      // Date scoping: today sees the same totals; another date sees nothing.
      const today = new Date().toISOString().slice(0, 10);
      const todayRes = await visits.getVisitsHistory(TENANT, { tripId: 1, date: today });
      assert.equal(todayRes.metrics.totalCollectionsAmount, 288);
      assert.equal(todayRes.metrics.totalSalesAmount, 863);
      const otherRes = await visits.getVisitsHistory(TENANT, { tripId: 1, date: '2000-01-01' });
      assert.equal(otherRes.metrics.totalCollectionsAmount, 0);
      assert.equal(otherRes.metrics.totalSalesAmount, 0);
      assert.equal(otherRes.metrics.totalVisits, 0);
    } finally { await db.destroy(); }
  }

  // 2. Cash sale only, no collection: "تحصيلات" is 0.
  {
    const TENANT = 't-van-track-2';
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, TENANT, 'EGP');
      await seedProduct(db, TENANT, 101, 12, 5, 100);
      await seedCustomer(db, TENANT, 3060, 'cash');
      const sales = buildSalesService(db, TENANT);
      const visits = buildVisitsService(db);
      const res0 = await sales.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash', customerId: 3060,
        items: [{ productId: 101, qty: 24, unitPrice: 12 }],
      });
      assert.equal(res0.total, 288);
      const res = await visits.getVisitsHistory(TENANT, { tripId: 1 });
      assert.equal(res.metrics.totalCollectionsAmount, 0);
      assert.equal(res.metrics.totalSalesAmount, 288);
      assert.equal(res.metrics.totalVisits, 1);
      assert.equal(res.visits[0].hasCollection, false);
      assert.equal(res.visits[0].collectionAmount, 0);
    } finally { await db.destroy(); }
  }

  // 3. Collection with no sale at all: the voucher alone drives
  // "تحصيلات" (200); there is no visit row to carry it.
  {
    const TENANT = 't-van-track-3';
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, TENANT, 'EGP');
      await seedCustomer(db, TENANT, 3060, 'cash', 500);
      const sales = buildSalesService(db, TENANT);
      const visits = buildVisitsService(db);
      const col = await sales.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 3060, amount: 200, paymentMethod: 'cash',
      });
      assert.equal(col.ok, true);
      const res = await visits.getVisitsHistory(TENANT, { tripId: 1 });
      assert.equal(res.metrics.totalCollectionsAmount, 200);
      assert.equal(res.metrics.totalSalesAmount, 0);
      assert.equal(res.metrics.totalVisits, 0);
    } finally { await db.destroy(); }
  }

  // 4. Trip scoping: collections on trip 1 (288) and trip 2 (100)
  // stay separate; the unfiltered total is their sum (388).
  {
    const TENANT = 't-van-track-4';
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, TENANT, 'EGP');
      await seedProduct(db, TENANT, 103, 50, 10, 100);
      await seedCustomer(db, TENANT, 3060, 'cash');
      await (db as any).insertInto('van_sales_trips').values({ id: 2, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 1, van_location_id: 20, status: 'open' }).execute();
      const sales = buildSalesService(db, TENANT);
      const visits = buildVisitsService(db);
      const credit500 = await sales.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'credit', customerId: 3060,
        items: [{ productId: 103, qty: 10, unitPrice: 50 }],
      });
      assert.equal(credit500.total, 500);
      const col1 = await sales.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 3060, amount: 288, paymentMethod: 'cash',
      });
      assert.equal(col1.ok, true);
      const col2 = await sales.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 2, customerId: 3060, amount: 100, paymentMethod: 'cash',
      });
      assert.equal(col2.ok, true);

      const trip1 = await visits.getVisitsHistory(TENANT, { tripId: 1 });
      assert.equal(trip1.metrics.totalCollectionsAmount, 288);
      assert.equal(trip1.metrics.totalSalesAmount, 500);
      const trip2 = await visits.getVisitsHistory(TENANT, { tripId: 2 });
      assert.equal(trip2.metrics.totalCollectionsAmount, 100);
      assert.equal(trip2.metrics.totalSalesAmount, 0);
      assert.equal(trip2.metrics.totalVisits, 0);
      const all = await visits.getVisitsHistory(TENANT, {});
      assert.equal(all.metrics.totalCollectionsAmount, 388);
      assert.equal(all.metrics.totalSalesAmount, 500);
    } finally { await db.destroy(); }
  }

  // 5. Source pin: the synthetic branch no longer counts a cash sale
  // as a collection, and the metric is sourced from the collection
  // vouchers (customer_payments) in getVisitsHistory.
  {
    const source = readFileSync(resolve(__dirname, '../../src/modules/delivery-reps/services/van-field-execution.service.ts'), 'utf8');
    const start = source.indexOf('async getVisitsHistory(');
    const end = source.indexOf('async getTradeSurveys(');
    assert.ok(start > 0 && end > start);
    const body = source.slice(start, end);
    assert.ok(body.includes('has_collection: false'), 'synthetic cash-sale rows carry no collection');
    assert.ok(body.includes("selectFrom('customer_payments')"), 'real collections are sourced from the voucher rows');
    assert.ok(body.includes('totalCollectionsAmount'), 'the metric is overridden with the voucher sum');
  }

  console.log('van-visits-tracking-collections: all cases passed');
}

main()
  .then(async () => {
    console.log('van-visits-tracking-collections: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
