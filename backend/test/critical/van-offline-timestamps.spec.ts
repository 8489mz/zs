/*
 * Van offline timestamps + server-clock anchor (INV-VAN-OFFLINE-TIMESTAMPS).
 *
 * THE GAP: a van rep works offline for days, then syncs. The outbox
 * carried the offline instant as `createdAt`, but the sync engine
 * sent only `item.payload` — the stamp never reached the server — so
 * every offline sale, collection and return was booked at the SYNC
 * instant: a Monday sale synced Friday was booked Friday, with
 * received_at NULL, so nothing could even tell it was late. The POS
 * already fixed this (validateOfflineCreatedAt + received_at,
 * migration 0325); the van never adopted it. The van page also
 * stamped its receipt date from the raw device clock
 * (new Date().toISOString()), so a device clock set days off moved
 * printed receipt dates.
 *
 * THE RULE: the offline instant travels inside the payload as
 * offlineCreatedAt and is validated by the POS gate VERBATIM
 * (validateOfflineCreatedAt — 7 days back, 5 minutes forward, naive
 * local-time strings rejected because they carry no offset). A valid
 * stamp is stored verbatim as created_at and the server receipt
 * instant as received_at, on sales, customer_payments and
 * van_field_returns (NOTE: the brief named return_documents, but
 * that is the SHOP returns table — the van leg is
 * van_field_returns). A stale (> 7 days), future (> 5 min),
 * unparseable or pre-2000 stamp is refused with
 * OFFLINE_TIMESTAMP_INVALID and writes nothing. On the sale path the
 * closed-period check runs against the OFFLINE date too, so a
 * backdated sale into a closed period is refused, not silently
 * booked into it. A missing GPS fix is recorded as
 * gps_missing_reason ('timeout' | 'denied' | 'unavailable') and
 * NEVER blocks the sale. getActiveTrip anchors the page on the
 * server clock (serverTime + serverTimezone from the tenant
 * setting), and the receipt date derives from that anchor.
 *
 * PRESERVED + PINNED (already fixed, not re-fixed here): the POS
 * gate itself is imported, not re-implemented; the collection GPS
 * fallback to the visit GPS and the ledger-row GPS columns are
 * untouched.
 *
 * HARNESS: the real VanSalesService facade + the real
 * AccountingPostingService on PGlite (same harness as the
 * book-digits spec); getActiveTrip is driven through the real
 * VanTripLifecycleService with the P1 stub set. The tenant
 * foundation is stubbed no-op; resolveSystemAuthContext is shadowed
 * on the facade instance after construction, because on PGlite's
 * single-connection dialect a pool read inside the transaction
 * would deadlock. Tear down is db.destroy() only.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanTripLifecycleService } from '../../src/modules/delivery-reps/services/van-trip-lifecycle.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { validateOfflineCreatedAt } from '../../src/modules/cash-drawer/helpers/cash-drawer.helper';
import { validateVanOfflineCreatedAt } from '../../src/modules/delivery-reps/van-offline-timestamps.helper';

const TENANT = 't-van-offline';
const ACCOUNT = 'a-van-offline';

const ADMIN = {
  userId: 2,
  sessionId: 'spec',
  username: 'sup',
  role: 'admin',
  permissions: ['deliveryReps', 'accounting'],
  tenantId: TENANT,
  accountId: ACCOUNT,
};

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE hr_employees (id bigserial PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cash_flow_category text, updated_at timestamptz);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, plate_number text, model_name text, vehicle_type text, current_odometer numeric, fuel_type text, license_expires_at timestamptz, status text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, metadata text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, half_wholesale_price numeric, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, shift_name text, start_odometer numeric, end_odometer numeric, distance_km numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric, stock_variance_amount numeric, stock_variance_details jsonb, night_stock_approved boolean, notes text, night_stock_approved_by bigint, night_stock_notes text, business_day date, submitted_per_day_cash jsonb, opened_at timestamptz, submitted_at timestamptz, settled_by bigint, supervisor_id bigint, closed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, gps_missing_reason text, delivery_proof_photo text, packaging_breakdown text, system_cash_discount_amount numeric, created_at timestamptz DEFAULT NOW(), received_at timestamptz);
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, price_list_id bigint, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text, type text, default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE price_list_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, price_list_id bigint, product_id bigint, product_name text, category_id bigint, min_quantity numeric DEFAULT 1, fixed_price numeric, discount_percent numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE inventory_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30), quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, gps_lat numeric, gps_lng numeric, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric DEFAULT 0, payment_channel text, note text, branch_id bigint, location_id bigint, job_id text, created_by bigint, transfer_reference text, instapay_address text, transfer_receipt_url text, van_trip_id bigint, rep_id bigint, client_tx_id text, created_at timestamptz DEFAULT NOW(), received_at timestamptz);
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, trip_id bigint, rep_id bigint, customer_id bigint, sale_id bigint, status text, return_reason text, refund_method text, total_amount numeric DEFAULT 0, items_json jsonb, notes text, rejection_reason text, approved_by bigint, approved_at timestamptz, created_at timestamptz DEFAULT NOW(), received_at timestamptz, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric DEFAULT 0, request_key text, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, opening_cash numeric DEFAULT 0, opening_note text, status text, terminal_code text, expected_cash numeric, counted_cash numeric, variance numeric, variance_resolution text, variance_journal_entry_id bigint, variance_charged_to_user_id bigint, variance_approved_by bigint, variance_approved_at timestamptz, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, settled_at timestamptz, settled_by bigint, settlement_method text, notes text, receipt_voucher_no text, payroll_run_id bigint, business_day date, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE settlement_allocations (id bigserial PRIMARY KEY, tenant_id text, settlement_id bigint, sale_id bigint, customer_payment_id bigint, amount numeric DEFAULT 0, business_day date, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, expense_type text, amount numeric DEFAULT 0, notes text, receipt_photo_url text, created_by_user_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE delivery_rep_targets (id bigserial PRIMARY KEY, tenant_id text, rep_id bigint, period_month text, target_amount numeric DEFAULT 0, collection_target numeric, visits_target numeric);
      CREATE TABLE van_damaged_swaps (id bigserial PRIMARY KEY, tenant_id text, trip_id bigint, customer_id bigint, damaged_product_id bigint, damaged_qty numeric, damage_reason text, replacement_product_id bigint, replacement_qty numeric, price_difference numeric, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE hr_holidays (id bigserial PRIMARY KEY, tenant_id text, start_date date, end_date date);
      CREATE TABLE product_units (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, name text, multiplier numeric);
    `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb
    .insertInto('settings')
    .values([
      { tenant_id: TENANT, key: 'currency', value: 'EGP' },
      { tenant_id: TENANT, key: 'timezone', value: 'Africa/Cairo' },
    ])
    .execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values([
      { id: 1, tenant_id: TENANT, username: 'sys', phone: null, is_active: true },
      { id: 2, tenant_id: TENANT, username: 'sup', phone: null, role: 'admin', is_active: true },
    ])
    .execute();
  const accounts: Array<[number, string, string]> = [
    [1110, '1110', 'asset'],
    [1120, '1120', 'asset'],
    [1130, '1130', 'asset'],
    [1140, '1140', 'asset'],
    [1160, '1160', 'asset'],
    [2120, '2120', 'liability'],
    [4100, '4100', 'revenue'],
    [4300, '4300', 'revenue'],
    [5100, '5100', 'expense'],
    [6400, '6400', 'expense'],
    [7100, '7100', 'revenue'],
    [7200, '7200', 'expense'],
  ];
  for (const [id, code, type] of accounts) {
    await anyDb
      .insertInto('accounting_accounts')
      .values({ id, tenant_id: TENANT, code, name_ar: code, account_type: type, is_active: true, is_tax: false })
      .execute();
  }
  await anyDb
    .insertInto('accounting_settings')
    .values({
      id: 1,
      tenant_id: TENANT,
      cash_account_id: 1110,
      bank_account_id: 1120,
      customer_receivable_account_id: 1130,
      inventory_account_id: 1140,
      sales_revenue_account_id: 4100,
      sales_discount_account_id: 4300,
      cogs_account_id: 5100,
      sales_tax_account_id: 2120,
      lock_date_all: null,
      lock_date_non_adviser: null,
      lock_date_tax: null,
    })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({
      id: 10,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Main warehouse',
      location_type: 'internal_warehouse',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, name: 'Van', location_type: 'van', is_active: true })
    .execute();
  await anyDb
    .insertInto('delivery_representatives')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Rep 1',
      phone: null,
      van_location_id: 20,
      is_van_rep: true,
    })
    .execute();
  await anyDb
    .insertInto('customers')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Customer 1',
      balance: 500,
      credit_limit: 10000,
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('cashier_shifts')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      doc_no: 'CS-1',
      opened_by: 2,
      opening_cash: 0,
      status: 'open',
      branch_id: null,
      location_id: null,
    })
    .execute();
}

async function seedTrip(db: Kysely<Database>, id: number): Promise<void> {
  await (db as any)
    .insertInto('van_sales_trips')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      rep_id: 1,
      vehicle_id: null,
      shift_name: null,
      start_odometer: 100,
      end_odometer: null,
      distance_km: null,
      van_location_id: 20,
      source_warehouse_id: 10,
      status: 'open',
      settlement_status: 'open',
      loaded_amount: 0,
      sales_amount: 0,
      cash_collected: 0,
      credit_sales: 0,
      returns_amount: 0,
      cash_refunds: 0,
      total_instapay_sales: 0,
      total_instapay_collections: 0,
      variance: null,
      stock_variance_details: null,
      notes: null,
      night_stock_approved_by: null,
      night_stock_notes: null,
      business_day: null,
      submitted_per_day_cash: null,
      opened_at: '2026-11-09T08:00:00+02:00',
    })
    .execute();
}

async function seedProduct(
  db: Kysely<Database>,
  id: number,
  retail: number,
  cost: number,
  vanQty: number,
): Promise<void> {
  const anyDb = db as any;
  await anyDb
    .insertInto('products')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: `Product ${id}`,
      stock_qty: vanQty,
      cost_price: cost,
      retail_price: retail,
      credit_price: 0,
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('product_location_stock')
    .values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: id, location_id: 20, qty: vanQty })
    .execute();
}

function buildService(db: Kysely<Database>): VanSalesService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const fraudStub = { recordSuspicionEvent: async () => {}, getSummary: async () => ({}), getEvents: async () => [] };
  const service = new VanSalesService(
    db,
    {} as never,
    {} as never,
    posting as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fraudStub as never,
  );
  (service as any).resolveSystemAuthContext = async () => ({
    userId: 1,
    sessionId: 'spec',
    username: 'spec',
    role: 'admin',
    permissions: ['accounting'],
    tenantId: TENANT,
    accountId: ACCOUNT,
  });
  return service;
}

function buildLifecycle(db: Kysely<Database>): VanTripLifecycleService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  return new VanTripLifecycleService({
    db,
    audit: {} as never,
    accountingPosting: posting as never,
    vanFraudRadarService: {} as never,
    getOrCreateVanLocation: async () => ({ id: 20, name: 'Van' }),
    sortItemsByProductId: (items) => [...items].sort((a, b) => a.productId - b.productId),
    moveVanStock: async () => ({ scopeBefore: 0, scopeAfter: 0 }),
    moveVanPharmacyBatches: async () => 0,
    deductVanSalePharmacyBatches: async () => [],
    moveVanInventoryBatches: async () => 0,
    deductVanSaleInventoryBatches: async () => [],
    resolveSystemAuthContext: async () => ({ ...ADMIN, userId: 2 }) as never,
    recordSuspicionEvent: async () => ({}),
    listRepServedCustomerIds: async () => new Set<number>(),
    resolveRepLinkedUserId: async () => null,
  });
}

async function saleRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any)
    .selectFrom('sales')
    .selectAll()
    .where('id', '=', id)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow();
}

async function paymentRow(db: Kysely<Database>, tripId: number): Promise<any> {
  return (db as any)
    .selectFrom('customer_payments')
    .selectAll()
    .where('van_trip_id', '=', tripId)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow();
}

async function returnRow(db: Kysely<Database>, tripId: number): Promise<any> {
  return (db as any)
    .selectFrom('van_field_returns')
    .selectAll()
    .where('trip_id', '=', tripId)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow();
}

async function salesCount(db: Kysely<Database>): Promise<number> {
  const rows = await (db as any).selectFrom('sales').selectAll().where('tenant_id', '=', TENANT).execute();
  return rows.length;
}

function errorCode(e: unknown): string {
  return (e as any)?.code ? String((e as any).code) : '';
}

function errorMessage(e: unknown): string {
  return (e as any)?.message ? String((e as any).message) : '';
}

async function main(): Promise<void> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  // Friday's offline instant, synced Monday: 3 days back, inside the
  // 7-day gate, but on a different tenant day than the sync.
  const offline3d = new Date(nowMs - 3 * DAY_MS).toISOString();

  // 1. Offline sale keeps its instant; the server receipt is separate.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 1 }],
        offlineCreatedAt: offline3d,
      });
      const sale = await saleRow(db, res.saleId);
      assert.equal(new Date(sale.created_at).getTime(), new Date(offline3d).getTime());
      assert.ok(sale.received_at, 'received_at must be stamped');
      assert.ok(new Date(sale.received_at).getTime() > new Date(offline3d).getTime());
      assert.ok(Math.abs(new Date(sale.received_at).getTime() - Date.now()) < 60_000);
      // The booked day is the offline day, not the sync day.
      assert.notEqual(String(sale.created_at).slice(0, 10), new Date().toISOString().slice(0, 10));
      console.log('1. offline sale keeps its instant passed');
    } finally {
      await db.destroy();
    }
  }

  // 2. A 30-day-old offline stamp is refused and writes nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1);
      const service = buildService(db);
      let thrown: unknown = null;
      try {
        await service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 1 }],
          offlineCreatedAt: new Date(nowMs - 30 * DAY_MS).toISOString(),
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, 'a 30-day-old stamp must throw');
      assert.equal(errorCode(thrown), 'OFFLINE_TIMESTAMP_INVALID');
      assert.equal(await salesCount(db), 0);
      console.log('2. 30-day-old stamp refused passed');
    } finally {
      await db.destroy();
    }
  }

  // 3. The 7-day boundary, pinned against a fixed now (wrapper and
  // the verbatim POS gate agree): 7 days minus 1 minute passes,
  // 7 days plus 1 minute fails.
  {
    const fixedNow = new Date('2026-11-16T12:00:00.000Z');
    const justInside = new Date(fixedNow.getTime() - 7 * DAY_MS + 60_000).toISOString();
    const justOutside = new Date(fixedNow.getTime() - 7 * DAY_MS - 60_000).toISOString();
    assert.ok(validateVanOfflineCreatedAt(justInside, fixedNow) instanceof Date);
    assert.ok(validateOfflineCreatedAt(justInside, fixedNow) instanceof Date);
    let thrown: unknown = null;
    try {
      validateVanOfflineCreatedAt(justOutside, fixedNow);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown);
    assert.equal(errorCode(thrown), 'OFFLINE_TIMESTAMP_INVALID');
    thrown = null;
    try {
      validateOfflineCreatedAt(justOutside, fixedNow);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown);
    assert.equal(errorCode(thrown), 'OFFLINE_TIMESTAMP_INVALID');
    console.log('3. 7-day boundary passed');
  }

  // 4. The future window: +4 minutes passes, +6 minutes fails.
  {
    const fixedNow = new Date('2026-11-16T12:00:00.000Z');
    assert.ok(
      validateVanOfflineCreatedAt(new Date(fixedNow.getTime() + 4 * 60_000).toISOString(), fixedNow) instanceof Date,
    );
    let thrown: unknown = null;
    try {
      validateVanOfflineCreatedAt(new Date(fixedNow.getTime() + 6 * 60_000).toISOString(), fixedNow);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown);
    assert.equal(errorCode(thrown), 'OFFLINE_TIMESTAMP_INVALID');
    console.log('4. future window passed');
  }

  // 5. Garbage and pre-2000 stamps fail; an absent stamp is the
  // online path (null, no throw).
  {
    for (const bad of ['not-a-date', '1999-12-31T00:00:00Z', '32/13/2026']) {
      let thrown: unknown = null;
      try {
        validateVanOfflineCreatedAt(bad);
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, `${bad} must throw`);
      assert.equal(errorCode(thrown), 'OFFLINE_TIMESTAMP_INVALID');
    }
    assert.equal(validateVanOfflineCreatedAt(undefined), null);
    assert.equal(validateVanOfflineCreatedAt(''), null);
    assert.equal(validateVanOfflineCreatedAt(null as unknown as string), null);
    console.log('5. garbage / pre-2000 rejected, absent is online passed');
  }

  // 6. Online sale unchanged: created_at is the server instant,
  // received_at stays NULL.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1);
      const service = buildService(db);
      const before = Date.now();
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 1 }],
      });
      const sale = await saleRow(db, res.saleId);
      assert.ok(Math.abs(new Date(sale.created_at).getTime() - before) < 60_000);
      assert.equal(sale.received_at, null);
      console.log('6. online sale unchanged passed');
    } finally {
      await db.destroy();
    }
  }

  // 7. Collection + return carry their offline stamps too. The
  // return is linked to the posted sale (P5 made saleId mandatory —
  // RETURN_REQUIRES_SALE_ID without it); the stamps are what this
  // case pins.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1);
      const service = buildService(db);
      const saleRes = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        customerId: 1,
        items: [{ productId: 101, qty: 1 }],
      });
      await service.recordFieldCollection(1, TENANT, ACCOUNT, {
        tripId: 1,
        customerId: 1,
        amount: 200,
        paymentMethod: 'cash',
        clientTxId: 'p2-col-1',
        offlineCreatedAt: offline3d,
      });
      const payment = await paymentRow(db, 1);
      assert.equal(new Date(payment.created_at).getTime(), new Date(offline3d).getTime());
      assert.ok(payment.received_at);
      assert.ok(new Date(payment.received_at).getTime() > new Date(offline3d).getTime());
      await service.submitFieldReturn(1, TENANT, ACCOUNT, {
        tripId: 1,
        customerId: 1,
        saleId: saleRes.saleId,
        returnReason: 'damaged',
        refundMethod: 'cash',
        items: [{ productId: 101, qty: 1, unitPrice: 100 }],
        offlineCreatedAt: offline3d,
      });
      const ret = await returnRow(db, 1);
      assert.equal(new Date(ret.created_at).getTime(), new Date(offline3d).getTime());
      assert.ok(ret.received_at);
      assert.ok(new Date(ret.received_at).getTime() > new Date(offline3d).getTime());
      console.log('7. collection + return stamps passed');
    } finally {
      await db.destroy();
    }
  }

  // 8. Closed period: an offline date inside the lock is refused,
  // an online sale today still works.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1);
      const yesterday = new Date(nowMs - DAY_MS).toISOString().slice(0, 10);
      const offline2d = new Date(nowMs - 2 * DAY_MS).toISOString();
      await (db as any)
        .updateTable('accounting_settings')
        .set({ lock_date_all: yesterday })
        .where('tenant_id', '=', TENANT)
        .execute();
      const service = buildService(db);
      let thrown: unknown = null;
      try {
        await service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 1 }],
          offlineCreatedAt: offline2d,
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, 'an offline sale into a closed period must throw');
      assert.ok(
        errorMessage(thrown).includes('مقفلة'),
        `message must name the closed period, got: ${errorMessage(thrown)}`,
      );
      assert.equal(await salesCount(db), 0);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 1 }],
      });
      assert.ok(res.saleId);
      console.log('8. closed-period re-check passed');
    } finally {
      await db.destroy();
    }
  }

  // 9. GPS missing is recorded, never a block.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1);
      await seedTrip(db, 2);
      await seedTrip(db, 3);
      const service = buildService(db);
      const withGps = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 1 }],
        deliveryGpsLat: 30.0,
        deliveryGpsLng: 31.0,
      });
      const gpsSale = await saleRow(db, withGps.saleId);
      assert.equal(Number(gpsSale.delivery_gps_lat), 30);
      assert.equal(gpsSale.gps_missing_reason, null);
      const timedOut = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 2,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 1 }],
        gpsMissingReason: 'timeout',
      });
      const timeoutSale = await saleRow(db, timedOut.saleId);
      assert.equal(timeoutSale.gps_missing_reason, 'timeout');
      assert.equal(timeoutSale.delivery_gps_lat, null);
      const neither = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 3,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 1 }],
      });
      const neitherSale = await saleRow(db, neither.saleId);
      assert.equal(neitherSale.gps_missing_reason, null);
      console.log('9. GPS missing recorded, never a block passed');
    } finally {
      await db.destroy();
    }
  }

  // 10. Naive local-time strings (no offset) are rejected by the
  // wrapper and through the service.
  {
    let thrown: unknown = null;
    try {
      validateVanOfflineCreatedAt('2026-11-13 10:00:00');
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown);
    assert.equal(errorCode(thrown), 'OFFLINE_TIMESTAMP_INVALID');
    thrown = null;
    try {
      validateVanOfflineCreatedAt('2026-11-13T10:00:00');
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown);
    assert.equal(errorCode(thrown), 'OFFLINE_TIMESTAMP_INVALID');
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1);
      const service = buildService(db);
      thrown = null;
      try {
        await service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 1 }],
          offlineCreatedAt: '2026-11-13T10:00:00',
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown);
      assert.equal(errorCode(thrown), 'OFFLINE_TIMESTAMP_INVALID');
      assert.equal(await salesCount(db), 0);
      console.log('10. naive strings rejected passed');
    } finally {
      await db.destroy();
    }
  }

  // 11. getActiveTrip anchors the page on the server clock, with
  // and without an open trip.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const lifecycle = buildLifecycle(db);
      const noTrip = await lifecycle.getActiveTrip(1, TENANT, '2');
      assert.equal(noTrip.hasActiveTrip, false);
      assert.ok(noTrip.serverTime, 'serverTime must be present');
      assert.ok(Math.abs(new Date(noTrip.serverTime).getTime() - Date.now()) < 60_000);
      assert.equal(noTrip.serverTimezone, 'Africa/Cairo');
      await seedTrip(db, 1);
      const withTrip = await lifecycle.getActiveTrip(1, TENANT, '2');
      assert.equal(withTrip.hasActiveTrip, true);
      assert.ok(withTrip.serverTime);
      assert.ok(Math.abs(new Date(withTrip.serverTime).getTime() - Date.now()) < 60_000);
      assert.equal(withTrip.serverTimezone, 'Africa/Cairo');
      console.log('11. server-clock anchor passed');
    } finally {
      await db.destroy();
    }
  }

  console.log('van-offline-timestamps: all cases passed');
}

main()
  .then(async () => {
    console.log('van-offline-timestamps: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
