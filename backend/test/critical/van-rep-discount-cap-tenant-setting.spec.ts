/*
 * Per-line van discount under the tenant rep cap
 * (INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING).
 *
 * THE GAP: the van had no per-line discount field at all (only the
 * implicit originalPrice − unitPrice cut and an invoice-level cash
 * discount), and the only cap was per-rep — stored as
 * max_discount_percent, default 0% (disabled) or 100% for legacy
 * rows — enforced invoice-level only. A rep could not give 4% on
 * one line, and the tenant admin had no single cap to set.
 *
 * THE RULE (user, 2026-11-16 + 15:31 correction): ONE tenant-level
 * setting vanRepDiscountCapPercent, default 5%, applies to ALL
 * reps. A lineDiscount (per-line TOTAL amount, POS semantics) is
 * enforced per line AND the COMBINED effective discount per invoice
 * (line discounts + invoice discount) must respect the same cap
 * without a supervisor PIN. The invoice discount is a per-rep
 * PERMISSION set at rep creation (both discounts, or per-line
 * only): a per-line-only rep is refused the invoice channel even
 * with a PIN (the flag is the control). The lowered-price delta
 * below the authorized price counts toward the cap together with
 * the explicit line discount, or the 0.05 price-cut band becomes a
 * second, uncapped channel. The per-rep stored max_discount_percent
 * is inert and never read by the sale path. The supervisor PIN
 * stays bcrypt-hashed (F6 was already fixed — pinned here, not
 * re-fixed).
 *
 * HARNESS: the real VanSalesService facade + the real
 * AccountingPostingService + a RECORDING fraud-radar stub on
 * PGlite. The real radar cannot be used inside the sale path:
 * it writes via the pool handle (by design — "on the root DB
 * connection pool (outside any failing transaction)"), and on
 * PGlite's single-connection dialect a pool write inside the
 * sale's own open transaction hangs silently (the await never
 * resolves, the event loop empties, Node exits 0 with no error
 * — proven by this spec's first two runs). The recorder proves
 * the sale path calls the radar with the right event code, and
 * case 0 proves the real radar's audit_logs insert works when
 * called outside any transaction. The tenant foundation is
 * stubbed no-op; resolveSystemAuthContext is shadowed on the
 * facade instance after construction, because on PGlite's
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
import { VanFraudRadarService } from '../../src/modules/delivery-reps/services/van-fraud-radar.service';
import { hashManagerPin } from '../../src/common/utils/manager-approval';
import { getVanRepDiscountCapPercent } from '../../src/modules/delivery-reps/rep-target.engine';

const TENANT = 't-van-discount-cap';
const ACCOUNT = 'a-van-discount-cap';

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
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, permissions jsonb, updated_at timestamptz DEFAULT NOW());
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
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, action text, event_code text, idempotency_key text, details text, target_tenant_id text, created_by bigint, impersonated_by bigint, created_at timestamptz DEFAULT NOW());
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
  // Rep 1: BOTH discounts (per-line + invoice), stored cap 0 (inert).
  // Rep 2: per-line ONLY, legacy stored cap 100 (inert).
  // Rep 3: NO discounting at all.
  // Rep 4: per-line ONLY, stored cap 0 (inert).
  const repPerms: Array<[number, Record<string, unknown>]> = [
    [1, { can_give_discount: true, can_give_invoice_discount: true, max_discount_percent: 0, can_collect_cash: true }],
    [
      2,
      { can_give_discount: true, can_give_invoice_discount: false, max_discount_percent: 100, can_collect_cash: true },
    ],
    [
      3,
      { can_give_discount: false, can_give_invoice_discount: false, max_discount_percent: 0, can_collect_cash: true },
    ],
    [4, { can_give_discount: true, can_give_invoice_discount: false, max_discount_percent: 0, can_collect_cash: true }],
  ];
  for (const [id, perms] of repPerms) {
    await anyDb
      .insertInto('delivery_representatives')
      .values({
        id,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: `Rep ${id}`,
        phone: null,
        van_location_id: 20,
        is_van_rep: true,
        permissions: JSON.stringify(perms),
      })
      .execute();
  }
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

async function seedTrip(db: Kysely<Database>, id: number, repId = 1): Promise<void> {
  await (db as any)
    .insertInto('van_sales_trips')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      rep_id: repId,
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
  // A RECORDING stub, not the real radar: the real radar writes via
  // the pool handle (its doc comment says so — "on the root DB
  // connection pool (outside any failing transaction)"), and on
  // PGlite's single-connection dialect a pool write inside the
  // sale's own open transaction hangs silently (the await never
  // resolves, the event loop empties, Node exits 0 with no error —
  // proven by this spec's first two runs: exit 0 after cases 0-1,
  // nothing after). The recorder proves the sale path CALLS the
  // radar with the right event code; case 0 proves the real
  // radar's insert works, called outside any transaction.
  const recordedFraudEvents: any[] = [];
  const fraudStub = {
    recordSuspicionEvent: async (params: any) => {
      recordedFraudEvents.push(params);
    },
    getSummary: async () => ({}),
    getEvents: async () => [],
  };
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
  (service as any).recordedFraudEvents = recordedFraudEvents;
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

async function saleItems(db: Kysely<Database>, saleId: number): Promise<any[]> {
  return (db as any)
    .selectFrom('sale_items')
    .selectAll()
    .where('sale_id', '=', saleId)
    .where('tenant_id', '=', TENANT)
    .execute();
}

function recordedFraud(service: VanSalesService, eventCode: string): any[] {
  return ((service as any).recordedFraudEvents as any[]).filter((e) => e.eventCode === eventCode);
}

async function auditLogEvents(db: Kysely<Database>, eventCode: string): Promise<any[]> {
  return (db as any)
    .selectFrom('audit_logs')
    .selectAll()
    .where('event_code', '=', eventCode)
    .where('tenant_id', '=', TENANT)
    .execute();
}

async function vanStockQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await (db as any)
    .selectFrom('product_location_stock')
    .select(['qty'])
    .where('product_id', '=', productId)
    .where('location_id', '=', 20)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirst();
  return Number(row?.qty || 0);
}

async function stockMovementsCount(db: Kysely<Database>): Promise<number> {
  const rows = await (db as any).selectFrom('stock_movements').selectAll().where('tenant_id', '=', TENANT).execute();
  return rows.length;
}

async function setCap(db: Kysely<Database>, pct: number): Promise<void> {
  await (db as any)
    .insertInto('settings')
    .values({ tenant_id: TENANT, key: 'vanRepDiscountCapPercent', value: String(pct) })
    .execute();
}

async function seedPin(db: Kysely<Database>, pin: string): Promise<void> {
  const hash = await hashManagerPin(pin);
  await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: hash }).execute();
}

function errorCode(e: unknown): string {
  return (e as any)?.code ? String((e as any).code) : '';
}

async function main(): Promise<void> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const offline3d = new Date(Date.now() - 3 * DAY_MS).toISOString();

  // 0. The resolver itself: no settings row = 5; row 10 = 10;
  // row 0 = 0; garbage = 5; above 100 clamps to 100.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      assert.equal(await getVanRepDiscountCapPercent(db as any, TENANT), 5);
      await setCap(db, 10);
      assert.equal(await getVanRepDiscountCapPercent(db as any, TENANT), 10);
      await (db as any)
        .updateTable('settings')
        .set({ value: '250' })
        .where('tenant_id', '=', TENANT)
        .where('key', '=', 'vanRepDiscountCapPercent')
        .execute();
      assert.equal(await getVanRepDiscountCapPercent(db as any, TENANT), 100);
      await (db as any)
        .updateTable('settings')
        .set({ value: 'not-a-number' })
        .where('tenant_id', '=', TENANT)
        .where('key', '=', 'vanRepDiscountCapPercent')
        .execute();
      assert.equal(await getVanRepDiscountCapPercent(db as any, TENANT), 5);
      // The REAL radar, called OUTSIDE any transaction: its
      // audit_logs insert works (rep 1 is seeded above, currency
      // EGP is seeded, no whatsapp service is configured so the
      // alert dispatch returns early).
      const radar = new VanFraudRadarService(db);
      await radar.recordSuspicionEvent({
        tenantId: TENANT,
        accountId: ACCOUNT,
        repId: 1,
        eventCode: 'VAN_SUSPICION_DISCOUNT_ABOVE_LIMIT',
        titleAr: 'خصم فوق السقف',
        detailsAr: 'خصم 6% فوق سقف 5%',
        amountInvolved: 60,
        wasBlocked: true,
      } as never);
      const rows = await auditLogEvents(db, 'VAN_SUSPICION_DISCOUNT_ABOVE_LIMIT');
      assert.equal(rows.length, 1);
      assert.equal(Number(JSON.parse(String(rows[0].details)).amountInvolved), 60);
      console.log('0. cap resolver defaults + clamp passed');
    } finally {
      await db.destroy();
    }
  }

  // 1. 4% on one line passes under the default cap (5%).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, lineDiscount: 40 }],
      });
      assert.equal(res.total, 960);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.total), 960);
      assert.equal(Number(sale.discount), 40);
      const items = await saleItems(db, res.saleId);
      assert.equal(items.length, 1);
      assert.equal(Number(items[0].line_discount), 40);
      assert.equal(Number(items[0].line_total), 960);
      console.log('1. 4% line passes passed');
    } finally {
      await db.destroy();
    }
  }

  // 2. 6% on one line without PIN -> 403 + fraud event, nothing written.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      let thrown: unknown = null;
      try {
        await service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 10, lineDiscount: 60 }],
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, 'a 6% line without PIN must throw');
      assert.equal(errorCode(thrown), 'LINE_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN');
      assert.equal(await salesCount(db), 0);
      assert.equal(await vanStockQty(db, 101), 10);
      assert.equal(await stockMovementsCount(db), 0);
      const events = recordedFraud(service, 'VAN_SUSPICION_DISCOUNT_ABOVE_LIMIT');
      assert.equal(events.length, 1);
      console.log('2. 6% line refused + fraud event passed');
    } finally {
      await db.destroy();
    }
  }

  // 3. 6% on one line with supervisor PIN -> passes.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedPin(db, '1234');
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, lineDiscount: 60 }],
        supervisorOverridePin: '1234',
      });
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].line_discount), 60);
      assert.equal(Number(items[0].line_total), 940);
      console.log('3. 6% line with PIN passes passed');
    } finally {
      await db.destroy();
    }
  }

  // 4. Tenant admin raises the cap to 10 -> 6% passes without PIN.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setCap(db, 10);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, lineDiscount: 60 }],
      });
      assert.equal(res.total, 940);
      console.log('4. cap 10 lets 6% pass passed');
    } finally {
      await db.destroy();
    }
  }

  // 5. PIN path stays hashed: the stored value is a bcrypt hash,
  // the correct PIN verifies, a wrong PIN fails.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedPin(db, '1234');
      const stored = await (db as any)
        .selectFrom('settings')
        .select(['value'])
        .where('tenant_id', '=', TENANT)
        .where('key', '=', 'managerPin')
        .executeTakeFirst();
      assert.ok(String(stored.value).startsWith('$2b$'), 'the stored PIN must be a bcrypt hash');
      assert.notEqual(stored.value, '1234');
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      let thrown: unknown = null;
      try {
        await service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 10, lineDiscount: 60 }],
          supervisorOverridePin: '9999',
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, 'a wrong PIN must fail');
      // verifySupervisorPin maps the manager-approval failure
      // MANAGER_AUTH_INVALID to the van-facing code
      // INVALID_SUPERVISOR_PIN (400).
      assert.equal(errorCode(thrown), 'INVALID_SUPERVISOR_PIN');
      assert.equal(await salesCount(db), 0);
      console.log('5. PIN stays hashed passed');
    } finally {
      await db.destroy();
    }
  }

  // 6. Offline sale keeps its line discount (and its timestamp).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, lineDiscount: 40 }],
        offlineCreatedAt: offline3d,
      });
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].line_discount), 40);
      const sale = await saleRow(db, res.saleId);
      assert.equal(new Date(sale.created_at).getTime(), new Date(offline3d).getTime());
      assert.ok(sale.received_at);
      console.log('6. offline sale keeps line discount passed');
    } finally {
      await db.destroy();
    }
  }

  // 7. Invoice-level discount reads the tenant cap too.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      let thrown: unknown = null;
      try {
        await service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 10 }],
          cashDiscountAmount: 60,
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, 'a 6% invoice discount without PIN must throw');
      assert.equal(errorCode(thrown), 'CASH_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN');
      assert.equal(await salesCount(db), 0);
      await setCap(db, 10);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10 }],
        cashDiscountAmount: 60,
      });
      assert.equal(res.total, 940);
      console.log('7. invoice discount reads tenant cap passed');
    } finally {
      await db.destroy();
    }
  }

  // 8. Per-rep stored cap values are ignored: rep 2 (per-line only,
  // stored max 100) and rep 4 (per-line only, stored max 0) both
  // post 4% and both are refused 6% without PIN; rep 3 (no
  // discount permission) is refused any line discount.
  //
  // NOTE: every attempt gets its OWN trip. The sale path has a
  // 4-second rapid-fire backstop (step 4 in executeFieldSale)
  // that returns the recent sale when trip + rep + customer +
  // product/qty multiset match — lineDiscount is NOT part of that
  // signature (prices are deliberately excluded), so a second
  // attempt on the same trip seconds later would return the first
  // sale's result instead of reaching the cap check.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 30);
      await seedTrip(db, 1, 2);
      await seedTrip(db, 2, 4);
      await seedTrip(db, 3, 3);
      await seedTrip(db, 4, 2);
      await seedTrip(db, 5, 4);
      const service = buildService(db);
      const ok2 = await service.executeFieldSale(2, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, lineDiscount: 40 }],
      });
      assert.equal(ok2.total, 960);
      let thrown: unknown = null;
      try {
        await service.executeFieldSale(2, TENANT, ACCOUNT, {
          tripId: 4,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 10, lineDiscount: 60 }],
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown);
      assert.equal(errorCode(thrown), 'LINE_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN');
      const ok4 = await service.executeFieldSale(4, TENANT, ACCOUNT, {
        tripId: 2,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, lineDiscount: 40 }],
      });
      assert.equal(ok4.total, 960);
      thrown = null;
      try {
        await service.executeFieldSale(4, TENANT, ACCOUNT, {
          tripId: 5,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 10, lineDiscount: 60 }],
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown);
      assert.equal(errorCode(thrown), 'LINE_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN');
      thrown = null;
      try {
        await service.executeFieldSale(3, TENANT, ACCOUNT, {
          tripId: 3,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 10, lineDiscount: 40 }],
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown);
      assert.equal(errorCode(thrown), 'REP_DISCOUNT_NOT_ALLOWED');
      console.log('8. per-rep stored cap ignored passed');
    } finally {
      await db.destroy();
    }
  }

  // 9. Cap = 0 means no discounting: any lineDiscount > 0 -> 403,
  // zero / absent -> posts.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setCap(db, 0);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      let thrown: unknown = null;
      try {
        await service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 10, lineDiscount: 10 }],
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown);
      assert.equal(errorCode(thrown), 'LINE_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN');
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10 }],
      });
      assert.equal(res.total, 1000);
      console.log('9. cap 0 means no discounting passed');
    } finally {
      await db.destroy();
    }
  }

  // 10. COMBINED cap (the correction): rep 1 has both channels.
  // Line 4% + invoice 4% = 8% > 5% -> 403 without PIN; with PIN
  // it posts. Line 3% + invoice 2% = 5% exactly -> posts
  // without PIN. The boundary sale runs on its own trip (see the
  // note on case 8): the 4-second rapid-fire backstop would
  // otherwise return the PIN sale's result for the identical
  // basket.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedPin(db, '1234');
      await seedProduct(db, 101, 100, 50, 30);
      await seedTrip(db, 1, 1);
      await seedTrip(db, 2, 1);
      const service = buildService(db);
      let thrown: unknown = null;
      try {
        await service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 10, lineDiscount: 40 }],
          cashDiscountAmount: 40,
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, 'line 4% + invoice 4% must throw without PIN');
      assert.equal(errorCode(thrown), 'CASH_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN');
      assert.equal(await salesCount(db), 0);
      const withPin = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, lineDiscount: 40 }],
        cashDiscountAmount: 40,
        supervisorOverridePin: '1234',
      });
      assert.equal(withPin.total, 920);
      const boundary = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 2,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, lineDiscount: 30 }],
        cashDiscountAmount: 20,
      });
      assert.equal(boundary.total, 950);
      console.log('10. combined cap passed');
    } finally {
      await db.destroy();
    }
  }

  // 11. Per-line-only rep applying an invoice discount -> refused
  // (permission, not amount): even 2% — inside the cap — is
  // refused because the rep never got the invoice channel.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 10);
      await seedTrip(db, 1, 2);
      const service = buildService(db);
      let thrown: unknown = null;
      try {
        await service.executeFieldSale(2, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 10 }],
          cashDiscountAmount: 20,
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown);
      assert.equal(errorCode(thrown), 'REP_DISCOUNT_NOT_ALLOWED');
      assert.equal(await salesCount(db), 0);
      console.log('11. per-line-only rep refused invoice discount passed');
    } finally {
      await db.destroy();
    }
  }

  // 12. Price cut + explicit line discount SUM against the cap:
  // unitPrice 99.96 (a 0.04/unit cut, inside the 0.05 band) +
  // lineDiscount 48 = 48.40 (4.84%) posts; the same cut +
  // lineDiscount 52 = 52.40 (5.24%) is refused without PIN.
  // The refused attempt runs on its own trip (see the note on
  // case 8): the 4-second rapid-fire backstop would otherwise
  // return the first sale's result for the identical basket.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, 100, 50, 30);
      await seedTrip(db, 1, 1);
      await seedTrip(db, 2, 1);
      const service = buildService(db);
      const ok = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, unitPrice: 99.96, lineDiscount: 48 }],
      });
      assert.equal(ok.total, 951.6);
      let thrown: unknown = null;
      try {
        await service.executeFieldSale(1, TENANT, ACCOUNT, {
          tripId: 2,
          paymentMethod: 'cash',
          items: [{ productId: 101, qty: 10, unitPrice: 99.96, lineDiscount: 52 }],
        });
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown);
      assert.equal(errorCode(thrown), 'LINE_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN');
      console.log('12. price cut + line discount sum against cap passed');
    } finally {
      await db.destroy();
    }
  }

  console.log('van-rep-discount-cap-tenant-setting: all cases passed');
}

main()
  .then(async () => {
    console.log('van-rep-discount-cap-tenant-setting: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    // 1000ms, not 100ms: under parallel load the flush needs longer.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
