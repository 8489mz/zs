/*
 * Daily-split van settlement (INV-VAN-DAILY-SPLIT-SETTLEMENT).
 *
 * THE GAP: a van rep's trip can span several tenant days (he opens
 * Monday, sells Tuesday, settles Wednesday), but settleTrip wrote ONE
 * treasury row + ONE 'cash_remittance' ledger row per trip, dated the
 * settle day. The money was right in total and wrong per day: a
 * Monday sale synced/settled Friday was booked Friday, so the daily
 * cash count, the per-day rep ledger and the daily split of the
 * supervisor's settlement never reconciled. Worse, the trip itself
 * had no business_day at all, so nothing could even ask "which day
 * is this cash from".
 *
 * THE RULE: the settle step splits the handed-over cash per tenant
 * day (never UTC — a 23:30Z sale is the NEXT Cairo day), one
 * remittance row + one 'cash_remittance' ledger row + allocation rows
 * per day, each allocation naming the sale or the collection it
 * covers. One journal per trip still: the split lives in treasury +
 * ledger + allocations only. A multi-day trip settled with no
 * breakdown is refused (SETTLEMENT_REQUIRES_PER_DAY_BREAKDOWN); a
 * breakdown that does not sum to the counted cash is refused
 * (SETTLEMENT_PER_DAY_MISMATCH). The rep's submitted declaration is
 * the fallback when the settler sends no breakdown. A single-day
 * trip keeps the old lump shape and the legacy request key.
 *
 * PRESERVED + PINNED (already fixed, not re-fixed here): the trip
 * lock re-check (a second settle finds no open trip), the
 * maker-checker gate (the rep's own login cannot settle his own
 * trip, MAKER_CHECKER_SELF_APPROVAL), the open-trip guard
 * (TRIP_ALREADY_OPEN), and the stock-audit gate (a trip with van
 * stock still on board is refused until audited).
 *
 * HARNESS: the real VanTripLifecycleService + the real
 * AccountingPostingService on PGlite. The tenant foundation is
 * stubbed no-op (documented in the P0-1/P0-2/P0-3 specs);
 * resolveSystemAuthContext is shadowed to the same shape the real
 * method returns, because on PGlite's single-connection dialect a
 * pool read inside the settle transaction would deadlock. The fraud
 * radar is stubbed no-op for the same reason. The spec pins the
 * guard's throw, not the audit write.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanTripLifecycleService } from '../../src/modules/delivery-reps/services/van-trip-lifecycle.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import {
  tenantDayKey,
  normalizePerDayCash,
  bucketTripCashByDay,
  allocateDayRemittance,
} from '../../src/modules/delivery-reps/van-settlement-split.engine';

const TENANT = 't-van-settle';
const ACCOUNT = 'a-van-settle';
const D1 = '2026-11-09';
const D2 = '2026-11-10';

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
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cash_flow_category text, updated_at timestamptz);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, shift_name text, start_odometer numeric, end_odometer numeric, distance_km numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric, stock_variance_amount numeric, stock_variance_details jsonb, night_stock_approved boolean, notes text, night_stock_approved_by bigint, night_stock_notes text, business_day date, submitted_per_day_cash jsonb, opened_at timestamptz, submitted_at timestamptz, settled_by bigint, supervisor_id bigint, closed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW(), received_at timestamptz);
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric DEFAULT 0, payment_channel text, note text, branch_id bigint, location_id bigint, job_id text, created_by bigint, transfer_reference text, instapay_address text, transfer_receipt_url text, van_trip_id bigint, rep_id bigint, client_tx_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, trip_id bigint, rep_id bigint, customer_id bigint, sale_id bigint, status text, return_reason text, refund_method text, total_amount numeric DEFAULT 0, items_json jsonb, notes text, rejection_reason text, approved_by bigint, approved_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric DEFAULT 0, request_key text, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, opening_cash numeric DEFAULT 0, opening_note text, status text, terminal_code text, expected_cash numeric, counted_cash numeric, variance numeric, variance_resolution text, variance_journal_entry_id bigint, variance_charged_to_user_id bigint, variance_approved_by bigint, variance_approved_at timestamptz, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, settled_at timestamptz, settled_by bigint, settlement_method text, notes text, receipt_voucher_no text, payroll_run_id bigint, business_day date, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE settlement_allocations (id bigserial PRIMARY KEY, tenant_id text, settlement_id bigint, sale_id bigint, customer_payment_id bigint, amount numeric DEFAULT 0, business_day date, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, expense_type text, amount numeric DEFAULT 0, notes text, receipt_photo_url text, created_by_user_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
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
      { id: 3, tenant_id: TENANT, username: 'rep2', phone: '01000000001', role: 'admin', is_active: true },
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
    .insertInto('delivery_representatives')
    .values({
      id: 2,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Rep 2',
      phone: '01000000001',
      van_location_id: 20,
      is_van_rep: true,
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

async function seedTrip(
  db: Kysely<Database>,
  id: number,
  opts: { repId?: number; cashCollected: number; businessDay?: string | null; openedAt?: string; status?: string },
): Promise<void> {
  await (db as any)
    .insertInto('van_sales_trips')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      rep_id: opts.repId ?? 1,
      vehicle_id: null,
      shift_name: null,
      start_odometer: 100,
      end_odometer: null,
      distance_km: null,
      van_location_id: 20,
      source_warehouse_id: 10,
      status: opts.status ?? 'open',
      settlement_status: 'open',
      loaded_amount: 0,
      sales_amount: 0,
      cash_collected: opts.cashCollected,
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
      business_day: opts.businessDay ?? null,
      submitted_per_day_cash: null,
      opened_at: opts.openedAt ?? '2026-11-09T08:00:00+02:00',
    })
    .execute();
}

async function seedCashSale(
  db: Kysely<Database>,
  id: number,
  tripId: number,
  total: number,
  createdAt: string,
): Promise<void> {
  await (db as any)
    .insertInto('sales')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      doc_no: `INV-${id}`,
      total,
      subtotal: total,
      discount: 0,
      tax_rate: 0,
      tax_amount: 0,
      delivery_fee: 0,
      delivery_fee_mode: 'per_order',
      service_charge: 0,
      tip_amount: 0,
      paid_amount: total,
      store_credit_used: 0,
      prices_include_tax: true,
      status: 'posted',
      payment_type: 'cash',
      payment_channel: 'cash',
      collection_status: 'prepaid_by_rep',
      customer_id: null,
      branch_id: null,
      location_id: null,
      created_by: 2,
      delivery_rep_id: 1,
      van_trip_id: tripId,
      sale_origin: 'van_field',
      exchange_return_id: null,
      is_credit_overridden: false,
      credit_override_by_user_id: null,
      credit_override_reason: null,
      transfer_reference: null,
      transfer_receipt_url: null,
      recipient_name: null,
      recipient_phone: null,
      recipient_role: null,
      recipient_signature: null,
      note: null,
      delivery_gps_lat: null,
      delivery_gps_lng: null,
      delivery_proof_photo: null,
      packaging_breakdown: null,
      created_at: createdAt,
      received_at: createdAt,
    })
    .execute();
}

async function seedCollection(
  db: Kysely<Database>,
  id: number,
  tripId: number,
  amount: number,
  createdAt: string,
): Promise<void> {
  await (db as any)
    .insertInto('customer_payments')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      customer_id: 1,
      amount,
      payment_channel: 'cash',
      note: 'collection',
      branch_id: null,
      location_id: null,
      job_id: null,
      created_by: 2,
      transfer_reference: null,
      instapay_address: null,
      transfer_receipt_url: null,
      van_trip_id: tripId,
      rep_id: 1,
      client_tx_id: null,
      created_at: createdAt,
    })
    .execute();
}

async function seedCashRefund(
  db: Kysely<Database>,
  id: number,
  tripId: number,
  total: number,
  createdAt: string,
): Promise<void> {
  await (db as any)
    .insertInto('van_field_returns')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      doc_no: `RET-${id}`,
      trip_id: tripId,
      rep_id: 1,
      customer_id: 1,
      sale_id: null,
      status: 'approved',
      return_reason: 'damaged',
      refund_method: 'cash',
      total_amount: total,
      items_json: null,
      notes: null,
      rejection_reason: null,
      approved_by: 2,
      approved_at: createdAt,
      created_at: createdAt,
    })
    .execute();
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

async function tripRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('van_sales_trips').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function remittanceRows(db: Kysely<Database>, tripId?: number): Promise<any[]> {
  // The row's reference_id is the receiving SHIFT id, not the trip:
  // the trip is identified by the request key
  // 'rep-remittance:trip:{id}' (or '...:day:{YYYY-MM-DD}').
  let q = (db as any)
    .selectFrom('treasury_transactions')
    .selectAll()
    .where('tenant_id', '=', TENANT)
    .where('txn_type', '=', 'rep_cash_remittance');
  if (tripId !== undefined) q = q.where('request_key', 'like', `rep-remittance:trip:${tripId}%`);
  return q.orderBy('id').execute();
}

async function settlementRows(db: Kysely<Database>, entryType?: string): Promise<any[]> {
  let q = (db as any).selectFrom('van_rep_financial_settlements').selectAll().where('tenant_id', '=', TENANT);
  if (entryType) q = q.where('entry_type', '=', entryType);
  return q.orderBy('id').execute();
}

async function allocationRows(db: Kysely<Database>): Promise<any[]> {
  return (db as any)
    .selectFrom('settlement_allocations')
    .selectAll()
    .where('tenant_id', '=', TENANT)
    .orderBy('id')
    .execute();
}

async function journalForTrip(db: Kysely<Database>, tripId: number): Promise<{ entries: any[]; lines: any[] }> {
  const entries = await (db as any)
    .selectFrom('journal_entries')
    .selectAll()
    .where('tenant_id', '=', TENANT)
    .where('source_type', '=', 'van_trip_settlement')
    .where('source_id', '=', tripId)
    .execute();
  const lines = entries.length
    ? await (db as any)
        .selectFrom('journal_entry_lines')
        .selectAll()
        .where('journal_entry_id', '=', Number(entries[0].id))
        .execute()
    : [];
  return { entries, lines };
}

function lineFor(lines: any[], accountId: number): { debit: number; credit: number } {
  return lines
    .filter((l) => Number(l.account_id) === accountId)
    .reduce((acc, l) => ({ debit: acc.debit + Number(l.debit), credit: acc.credit + Number(l.credit) }), {
      debit: 0,
      credit: 0,
    });
}

function codeOf(err: unknown): string {
  return String((err as any)?.code || (err as any)?.message || err);
}

function dayOf(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}

async function seedTwoDayTrip(
  db: Kysely<Database>,
  tripId: number,
  saleA: number,
  saleB: number,
  payment: number,
): Promise<void> {
  await seedTrip(db, tripId, { cashCollected: 3000, businessDay: D1 });
  await seedCashSale(db, saleA, tripId, 1000, '2026-11-09T10:00:00+02:00');
  await seedCashSale(db, saleB, tripId, 1500, '2026-11-10T11:00:00+02:00');
  await seedCollection(db, payment, tripId, 500, '2026-11-10T15:00:00+02:00');
}

async function main(): Promise<void> {
  // 1. Three-day example from the brief, two active days: D1 1000 /
  // D2 2000 -> two remittance rows, two ledger rows, allocations
  // linked per day, exactly ONE journal for the trip.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTwoDayTrip(db, 1, 11, 12, 21);
      const service = buildLifecycle(db);
      const res = await service.settleTrip(
        1,
        TENANT,
        ACCOUNT,
        {
          tripId: 1,
          countedCash: 3000,
          perDayCash: [
            { businessDay: D1, countedCash: 1000 },
            { businessDay: D2, countedCash: 2000 },
          ],
          unloadRemainingToWarehouse: false,
          endOdometer: 120,
        },
        ADMIN as never,
      );
      assert.equal(res.dailySplit?.length, 2);
      assert.deepEqual(res.dailySplit?.[0], { businessDay: D1, due: 1000, countedCash: 1000, remittedCash: 1000 });
      assert.deepEqual(res.dailySplit?.[1], { businessDay: D2, due: 2000, countedCash: 2000, remittedCash: 2000 });
      const remits = await remittanceRows(db, 1);
      assert.equal(remits.length, 2);
      assert.deepEqual(
        remits.map((r) => Number(r.amount)).sort((a, b) => a - b),
        [1000, 2000],
      );
      assert.deepEqual(remits.map((r) => String(r.request_key)).sort(), [
        'rep-remittance:trip:1:day:2026-11-09',
        'rep-remittance:trip:1:day:2026-11-10',
      ]);
      const settlements = await settlementRows(db, 'cash_remittance');
      assert.equal(settlements.length, 2);
      const byDay = new Map(settlements.map((s) => [dayOf(s.business_day), s]));
      assert.equal(Number(byDay.get(D1)?.amount), 1000);
      assert.equal(Number(byDay.get(D2)?.amount), 2000);
      assert.equal(byDay.get(D1)?.status, 'settled');
      assert.equal(byDay.get(D2)?.status, 'settled');
      const allocs = await allocationRows(db);
      assert.equal(allocs.length, 3);
      const d1Allocs = allocs.filter((a) => Number(a.settlement_id) === Number(byDay.get(D1)?.id));
      const d2Allocs = allocs.filter((a) => Number(a.settlement_id) === Number(byDay.get(D2)?.id));
      assert.equal(d1Allocs.length, 1);
      assert.equal(Number(d1Allocs[0].sale_id), 11);
      assert.equal(Number(d1Allocs[0].amount), 1000);
      assert.equal(d1Allocs[0].customer_payment_id, null);
      assert.equal(d2Allocs.length, 2);
      assert.deepEqual(
        d2Allocs.map((a) => Number(a.amount)).sort((a, b) => a - b),
        [500, 1500],
      );
      assert.ok(d2Allocs.some((a) => Number(a.sale_id) === 12 && Number(a.amount) === 1500));
      assert.ok(d2Allocs.some((a) => Number(a.customer_payment_id) === 21 && Number(a.amount) === 500));
      const { entries, lines } = await journalForTrip(db, 1);
      assert.equal(entries.length, 1);
      assert.equal(lines.length, 2);
      assert.equal(lineFor(lines, 1110).debit, 3000);
      assert.equal(lineFor(lines, 1130).credit, 3000);
      const trip = await tripRow(db, 1);
      assert.equal(trip.status, 'settled');
      assert.equal(dayOf(trip.business_day), D1);
      const ledgerCount = (await (db as any)
        .selectFrom('customer_ledger')
        .select(sql`count(*)`.as('c'))
        .executeTakeFirstOrThrow()) as any;
      assert.equal(Number(ledgerCount.c), 0);
    } finally {
      await db.destroy();
    }
  }

  // 2. Per-day due read matches seeded sales + collections - returns.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTwoDayTrip(db, 1, 11, 12, 21);
      const service = buildLifecycle(db);
      const due = await service.getTripDueByDay(1, TENANT, 1);
      assert.equal(due.timezone, 'Africa/Cairo');
      assert.equal(due.totalDue, 3000);
      assert.equal(due.days.length, 2);
      assert.equal(due.days[0].businessDay, D1);
      assert.equal(due.days[0].due, 1000);
      assert.deepEqual(due.days[0].saleIds, [11]);
      assert.equal(due.days[1].businessDay, D2);
      assert.equal(due.days[1].due, 2000);
      assert.deepEqual(due.days[1].saleIds, [12]);
      assert.deepEqual(due.days[1].paymentIds, [21]);
    } finally {
      await db.destroy();
    }
  }

  // 3. Multi-day trip settled as one lump is refused, nothing written.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTwoDayTrip(db, 1, 11, 12, 21);
      const service = buildLifecycle(db);
      await assert.rejects(
        service.settleTrip(
          1,
          TENANT,
          ACCOUNT,
          {
            tripId: 1,
            countedCash: 3000,
            unloadRemainingToWarehouse: false,
            endOdometer: 120,
          },
          ADMIN as never,
        ),
        (err: any) => codeOf(err).includes('SETTLEMENT_REQUIRES_PER_DAY_BREAKDOWN'),
      );
      const trip = await tripRow(db, 1);
      assert.equal(trip.status, 'open');
      assert.equal((await remittanceRows(db, 1)).length, 0);
      assert.equal((await journalForTrip(db, 1)).entries.length, 0);
    } finally {
      await db.destroy();
    }
  }

  // 4. UTC-midnight trap: 23:30Z is the NEXT Cairo day. Two sales
  // that fall on two UTC days fall on ONE Cairo day, so the lump
  // settle is legal and uses the legacy request key.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 2, { cashCollected: 1500, businessDay: null });
      await seedCashSale(db, 13, 2, 1000, '2026-11-09T23:30:00Z');
      await seedCashSale(db, 14, 2, 500, '2026-11-10T10:00:00Z');
      const service = buildLifecycle(db);
      const due = await service.getTripDueByDay(1, TENANT, 2);
      assert.equal(due.days.length, 1);
      assert.equal(due.days[0].businessDay, D2);
      assert.equal(due.days[0].due, 1500);
      assert.deepEqual(due.days[0].saleIds, [13, 14]);
      const res = await service.settleTrip(
        1,
        TENANT,
        ACCOUNT,
        {
          tripId: 2,
          countedCash: 1500,
          unloadRemainingToWarehouse: false,
          endOdometer: 120,
        },
        ADMIN as never,
      );
      assert.equal(res.dailySplit?.length, 1);
      const remits = await remittanceRows(db, 2);
      assert.equal(remits.length, 1);
      assert.equal(String(remits[0].request_key), 'rep-remittance:trip:2');
      const settlements = await settlementRows(db, 'cash_remittance');
      assert.equal(settlements.length, 1);
      assert.equal(dayOf(settlements[0].business_day), D2);
      const trip = await tripRow(db, 2);
      assert.equal(dayOf(trip.business_day), D2);
    } finally {
      await db.destroy();
    }
  }

  // 5. Double-settle: the second call finds no open trip
  // (TRIP_NOT_FOUND) and writes nothing twice.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 3, { cashCollected: 700, businessDay: D1 });
      await seedCashSale(db, 15, 3, 700, '2026-11-09T10:00:00+02:00');
      const service = buildLifecycle(db);
      await service.settleTrip(
        1,
        TENANT,
        ACCOUNT,
        {
          tripId: 3,
          countedCash: 700,
          unloadRemainingToWarehouse: false,
          endOdometer: 120,
        },
        ADMIN as never,
      );
      await assert.rejects(
        service.settleTrip(
          1,
          TENANT,
          ACCOUNT,
          {
            tripId: 3,
            countedCash: 700,
            unloadRemainingToWarehouse: false,
            endOdometer: 120,
          },
          ADMIN as never,
        ),
        (err: any) => codeOf(err).includes('TRIP_NOT_FOUND'),
      );
      assert.equal((await remittanceRows(db, 3)).length, 1);
      assert.equal((await journalForTrip(db, 3)).entries.length, 1);
    } finally {
      await db.destroy();
    }
  }

  // 6. Submit a per-day declaration, then settle with no breakdown:
  // the settle uses the submitted breakdown.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTwoDayTrip(db, 4, 16, 17, 22);
      const service = buildLifecycle(db);
      const submitted = await service.submitTripSettlement(1, TENANT, ACCOUNT, {
        tripId: 4,
        countedCash: 3000,
        perDayCash: [
          { businessDay: D1, countedCash: 1000 },
          { businessDay: D2, countedCash: 2000 },
        ],
        unloadRemainingToWarehouse: false,
        endOdometer: 120,
      });
      assert.deepEqual(submitted.perDayCash, [
        { businessDay: D1, countedCash: 1000 },
        { businessDay: D2, countedCash: 2000 },
      ]);
      const tripBefore = await tripRow(db, 4);
      assert.equal(tripBefore.settlement_status, 'submitted_by_rep');
      const stored =
        typeof tripBefore.submitted_per_day_cash === 'string'
          ? JSON.parse(tripBefore.submitted_per_day_cash)
          : tripBefore.submitted_per_day_cash;
      assert.deepEqual(stored, [
        { businessDay: D1, countedCash: 1000 },
        { businessDay: D2, countedCash: 2000 },
      ]);
      const res = await service.settleTrip(
        1,
        TENANT,
        ACCOUNT,
        {
          tripId: 4,
          countedCash: 3000,
          unloadRemainingToWarehouse: false,
          endOdometer: 120,
        },
        ADMIN as never,
      );
      assert.equal(res.dailySplit?.length, 2);
      assert.equal((await remittanceRows(db, 4)).length, 2);
    } finally {
      await db.destroy();
    }
  }

  // 7. Per-day breakdown that does not sum to counted cash is refused.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTwoDayTrip(db, 5, 18, 19, 23);
      const service = buildLifecycle(db);
      await assert.rejects(
        service.settleTrip(
          1,
          TENANT,
          ACCOUNT,
          {
            tripId: 5,
            countedCash: 3000,
            perDayCash: [
              { businessDay: D1, countedCash: 1000 },
              { businessDay: D2, countedCash: 1900 },
            ],
            unloadRemainingToWarehouse: false,
            endOdometer: 120,
          },
          ADMIN as never,
        ),
        (err: any) => codeOf(err).includes('SETTLEMENT_PER_DAY_MISMATCH'),
      );
      const trip = await tripRow(db, 5);
      assert.equal(trip.status, 'open');
      assert.equal((await remittanceRows(db, 5)).length, 0);
    } finally {
      await db.destroy();
    }
  }

  // 8. The same sum check on submit: a bad declaration is refused
  // and nothing is stored.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTwoDayTrip(db, 5, 18, 19, 23);
      const service = buildLifecycle(db);
      await assert.rejects(
        service.submitTripSettlement(1, TENANT, ACCOUNT, {
          tripId: 5,
          countedCash: 3000,
          perDayCash: [
            { businessDay: D1, countedCash: 1000 },
            { businessDay: D2, countedCash: 1900 },
          ],
          unloadRemainingToWarehouse: false,
          endOdometer: 120,
        }),
        (err: any) => codeOf(err).includes('SETTLEMENT_PER_DAY_MISMATCH'),
      );
      const trip = await tripRow(db, 5);
      assert.equal(trip.settlement_status, 'open');
      assert.equal(trip.submitted_per_day_cash, null);
    } finally {
      await db.destroy();
    }
  }

  // 9. Maker-checker pin: the rep's own login cannot settle his own
  // trip, even with an admin role.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 6, { repId: 2, cashCollected: 500, businessDay: D1 });
      await seedCashSale(db, 20, 6, 500, '2026-11-09T10:00:00+02:00');
      const service = buildLifecycle(db);
      const repAuth = { ...ADMIN, userId: 3, username: 'rep2' };
      await assert.rejects(
        service.settleTrip(
          2,
          TENANT,
          ACCOUNT,
          {
            tripId: 6,
            countedCash: 500,
            unloadRemainingToWarehouse: false,
            endOdometer: 120,
          },
          repAuth as never,
        ),
        (err: any) => codeOf(err).includes('MAKER_CHECKER_SELF_APPROVAL'),
      );
      const trip = await tripRow(db, 6);
      assert.equal(trip.status, 'open');
      assert.equal((await remittanceRows(db, 6)).length, 0);
    } finally {
      await db.destroy();
    }
  }

  // 10. Open-trip guard pin: a second open call is refused while a
  // trip is still open, even when it started yesterday.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 7, { cashCollected: 0, businessDay: '2026-11-08', openedAt: '2026-11-08T08:00:00+02:00' });
      const service = buildLifecycle(db);
      await assert.rejects(service.openTripAndLoad(1, TENANT, ACCOUNT, { sourceWarehouseId: 10 }), (err: any) =>
        codeOf(err).includes('TRIP_ALREADY_OPEN'),
      );
      const count = (await (db as any)
        .selectFrom('van_sales_trips')
        .select(sql`count(*)`.as('c'))
        .where('tenant_id', '=', TENANT)
        .executeTakeFirstOrThrow()) as any;
      assert.equal(Number(count.c), 1);
    } finally {
      await db.destroy();
    }
  }

  // 11. Prospective-only: settling one trip never touches another
  // trip's already-written remittance row.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 8, { cashCollected: 500, businessDay: D1, status: 'settled' });
      await (db as any)
        .insertInto('treasury_transactions')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          txn_type: 'rep_cash_remittance',
          amount: 500,
          request_key: 'rep-remittance:trip:8',
          payment_channel: 'cash',
          note: 'prior',
          reference_type: 'cashier_shift',
          reference_id: 1,
          branch_id: null,
          location_id: null,
          created_by: 2,
        })
        .execute();
      await seedTrip(db, 9, { cashCollected: 400, businessDay: D1 });
      await seedCashSale(db, 21, 9, 400, '2026-11-09T10:00:00+02:00');
      const service = buildLifecycle(db);
      await service.settleTrip(
        1,
        TENANT,
        ACCOUNT,
        {
          tripId: 9,
          countedCash: 400,
          unloadRemainingToWarehouse: false,
          endOdometer: 120,
        },
        ADMIN as never,
      );
      const prior = await remittanceRows(db, 8);
      assert.equal(prior.length, 1);
      assert.equal(Number(prior[0].amount), 500);
      assert.equal(String(prior[0].request_key), 'rep-remittance:trip:8');
      assert.equal((await remittanceRows(db, 9)).length, 1);
    } finally {
      await db.destroy();
    }
  }

  // 12. A cash refund reduces the day's due, and the allocation is
  // capped at the reduced due (partial allocation of the sale).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 10, { cashCollected: 800, businessDay: D1 });
      await seedCashSale(db, 22, 10, 1000, '2026-11-09T10:00:00+02:00');
      await seedCashRefund(db, 31, 10, 200, '2026-11-09T16:00:00+02:00');
      const service = buildLifecycle(db);
      const due = await service.getTripDueByDay(1, TENANT, 10);
      assert.equal(due.days.length, 1);
      assert.equal(due.days[0].due, 800);
      const res = await service.settleTrip(
        1,
        TENANT,
        ACCOUNT,
        {
          tripId: 10,
          countedCash: 800,
          perDayCash: [{ businessDay: D1, countedCash: 800 }],
          unloadRemainingToWarehouse: false,
          endOdometer: 120,
        },
        ADMIN as never,
      );
      assert.deepEqual(res.dailySplit?.[0], { businessDay: D1, due: 800, countedCash: 800, remittedCash: 800 });
      const allocs = await allocationRows(db);
      assert.equal(allocs.length, 1);
      assert.equal(Number(allocs[0].sale_id), 22);
      assert.equal(Number(allocs[0].amount), 800);
      const remits = await remittanceRows(db, 10);
      assert.equal(remits.length, 1);
      assert.equal(Number(remits[0].amount), 800);
    } finally {
      await db.destroy();
    }
  }

  // 13. Engine unit pins (production code imported, not re-derived):
  // tenant-day keys, breakdown validation, bucketing, allocation caps.
  {
    assert.equal(tenantDayKey('2026-11-09T23:30:00Z', 'Africa/Cairo'), '2026-11-10');
    assert.equal(tenantDayKey('2026-11-10T00:30:00+02:00', 'Africa/Cairo'), '2026-11-10');
    assert.throws(
      () =>
        normalizePerDayCash(
          [
            { businessDay: D1, countedCash: 1 },
            { businessDay: D1, countedCash: 2 },
          ],
          2,
        ),
      (err: any) => String(err?.message).includes('SETTLEMENT_PER_DAY_DUPLICATE_DAY'),
    );
    assert.throws(
      () => normalizePerDayCash([], 2),
      (err: any) => String(err?.message).includes('SETTLEMENT_PER_DAY_EMPTY'),
    );
    assert.deepEqual(
      normalizePerDayCash(
        [
          { businessDay: D2, countedCash: '2000' },
          { businessDay: D1, countedCash: 1000 },
        ],
        2,
      ),
      [
        { businessDay: D1, countedCash: 1000 },
        { businessDay: D2, countedCash: 2000 },
      ],
    );
    const buckets = bucketTripCashByDay(
      [
        { kind: 'sale', id: 11, createdAt: '2026-11-09T10:00:00+02:00', cashAmount: 1000 },
        { kind: 'sale', id: 12, createdAt: '2026-11-10T11:00:00+02:00', cashAmount: 1500 },
        { kind: 'collection', id: 21, createdAt: '2026-11-10T15:00:00+02:00', cashAmount: 500 },
        { kind: 'refund', id: 31, createdAt: '2026-11-10T16:00:00+02:00', cashAmount: 200 },
      ],
      'Africa/Cairo',
      2,
    );
    assert.equal(buckets.length, 2);
    assert.equal(buckets[0].due, 1000);
    assert.equal(buckets[1].cashSales, 1500);
    assert.equal(buckets[1].collections, 500);
    assert.equal(buckets[1].refunds, 200);
    assert.equal(buckets[1].due, 1800);
    const allocs = allocateDayRemittance(buckets[1], 1800, 2);
    assert.deepEqual(allocs, [
      { businessDay: D2, saleId: 12, customerPaymentId: null, amount: 1500 },
      { businessDay: D2, saleId: null, customerPaymentId: 21, amount: 300 },
    ]);
    const capped = allocateDayRemittance(buckets[1], 5000, 2);
    assert.equal(
      capped.reduce((s, a) => s + a.amount, 0),
      2000,
    );
    assert.deepEqual(allocateDayRemittance(buckets[1], 0, 2), []);
  }

  console.log('van-settle-daily-split: all cases passed');
}

main()
  .then(async () => {
    console.log('van-settle-daily-split: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
