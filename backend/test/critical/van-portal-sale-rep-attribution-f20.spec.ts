/*
 * Portal sale rep attribution (F20 — trial problem 38).
 *
 * THE GAP (grounded on live HEAD 09a91bdf): every portal field sale
 * was attributed to the tenant's first active user (normally the
 * admin) in any created_by-grouped report. resolveSystemAuthContext
 * returned the rep's linked login only when one existed; otherwise
 * it fell back to the FIRST active user in the tenant, and the field
 * sale wrote that id into sales.created_by (execute-field-sale-
 * internal.ts). The Staff Report (employeeSummary) groups sales by
 * created_by, so the rep read 0.00 and the admin carried the rep's
 * sales. The same false attribution fed the sale journal through
 * postSale's createdBy fallback.
 *
 * THE RULE (F20): when the acting rep is named, the posting
 * identity is his linked login — or honestly NOBODY. A rep with no
 * linked login resolves to userId 0 (never the first active user),
 * and the sale row records created_by NULL (the field-sale path
 * already maps 0 to null) while the journal boundary
 * (insertPostedJournal) already maps createdBy/postedBy <= 0 to
 * NULL, so no FK'd journal ever names user 0 or the admin. The
 * rep's own identity is never lost: delivery_rep_id and
 * van_trip_id are set on the sale either way, and the per-rep
 * profit view already groups by delivery_rep_id (F13). When NO
 * rep is named the old first-active-user fallback stays: those
 * callers (trip load journals, damaged swap before F20) are system
 * actions with no acting rep, and the journal needs a real FK'd
 * user. The damaged swap is rep-acted (driver endpoint, trip
 * locked by rep), so it now passes repId like the sale and the
 * collection do. No user is ever created silently at sale time;
 * whether rep creation should link/create a login user is a
 * separate decision (follow-up, not built here).
 *
 * WHAT THE TRIAL RE-RUN SEES for an unlinked rep: his portal sale
 * posts normally (status posted, totals unchanged) with
 * created_by NULL — the Staff Report per-user view shows NEITHER
 * the rep NOR the admin carrying it (created_by IS NULL rows are
 * excluded from every user's row), while the per-rep profit view
 * still shows it under the rep via delivery_rep_id.
 *
 * HARNESS: the real VanSalesService + the real AuditService + the
 * real VanFraudRadarService + the real AccountingPostingService on
 * ONE shared PGlite database, driven through the REAL
 * VanSalesController (the driver token verifier is stubbed — it
 * resolves the driver from a portal token, not from req.authContext,
 * and carries no money logic). Rep 1's phone links him to user 7
 * (his own login); user 1 is the tenant's first active user (the
 * old false attribution); rep 3 has no phone, so no linked login.
 * Tear down is db.destroy() only.
 */

/* F20 (trial problem 38): portal sales must name the selling rep's
 * linked login as created_by — or nobody (NULL) when the rep has no
 * linked login — never the tenant's first active user. */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanSalesController } from '../../src/modules/delivery-reps/van-sales.controller';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AuditService } from '../../src/core/audit/audit.service';
import { VanFraudRadarService } from '../../src/modules/delivery-reps/services/van-fraud-radar.service';
import { AuthAndPinService } from '../../src/modules/delivery-reps/van-sales/auth-and-pin';
import { hashManagerPin } from '../../src/common/utils/manager-approval';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const TENANT = 't-van-portal-sale-rep-f20';
const ACCOUNT = 'a-van-portal-sale-rep-f20';
const SUPERVISOR_PIN = '4321';
const SUPERVISOR_PASSWORD = 'Sup3rvisor!';
const REP_PASSWORD = 'R3pPassw0rd!';
// Rep 1's linked login (user 7). User 1 is the tenant's first active
// user — the old false attribution the fix must NOT produce.
const REP_LINKED_USER_ID = 7;
const FIRST_USER_ID = 1;

const DRIVER_REP1 = {
  repId: 1,
  tenantId: TENANT,
  accountId: ACCOUNT,
  name: 'Rep 1',
  phone: '5550001',
  tenantSuspended: false,
};
const DRIVER_REP3 = {
  repId: 3,
  tenantId: TENANT,
  accountId: ACCOUNT,
  name: 'Rep 3',
  phone: null,
  tenantSuspended: false,
};

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
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, pin_hash text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric, plate_number text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, display_name text, phone text, pin text, pin_hash text, permissions_json text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, metadata text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, half_wholesale_price numeric, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, shift_name text, start_odometer numeric, end_odometer numeric, distance_km numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric, stock_variance_amount numeric, stock_variance_details jsonb, night_stock_approved boolean, notes text, night_stock_approved_by bigint, night_stock_notes text, business_day date, submitted_per_day_cash jsonb, opened_at timestamptz, submitted_at timestamptz, settled_by bigint, supervisor_id bigint, closed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, gps_missing_reason text, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW(), received_at timestamptz);
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE inventory_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30), quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigint PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz, price_list_id bigint, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, address text, company_name text, tax_number text);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, gps_lat numeric, gps_lng numeric, tenant_id text, account_id text);
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, note text, transfer_reference text, transfer_receipt_url text, payment_channel text, van_trip_id bigint, rep_id bigint, client_tx_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, trip_id bigint, rep_id bigint, customer_id bigint, sale_id bigint, status text, return_reason text, refund_method text, total_amount numeric DEFAULT 0, items_json text, notes text, rejection_reason text, approved_by bigint, approved_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, idempotency_key text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, expense_type text, amount numeric DEFAULT 0, notes text, receipt_photo_url text, created_by_user_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_stock_transfers (id bigserial PRIMARY KEY, tenant_id text, account_id text, transfer_no text, from_rep_id bigint, from_trip_id bigint, from_van_location_id bigint, to_rep_id bigint, to_trip_id bigint, to_van_location_id bigint, status text, total_items_count int, total_qty numeric DEFAULT 0, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE van_stock_transfer_items (id bigserial PRIMARY KEY, transfer_id bigint, tenant_id text, product_id bigint, qty numeric DEFAULT 0, unit_cost numeric DEFAULT 0, unit_price numeric DEFAULT 0);
      CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, settled_at timestamptz, settled_by bigint, settlement_method text, notes text, receipt_voucher_no text, payroll_run_id bigint, business_day date, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, location_id bigint, status text, opened_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE price_lists (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text, type text, default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE price_list_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, price_list_id bigint, product_id bigint, product_name text, category_id bigint, min_quantity numeric DEFAULT 1, fixed_price numeric, discount_percent numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric DEFAULT 0, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, payment_channel text, request_key text, created_at timestamptz DEFAULT NOW());
    `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb
    .insertInto('settings')
    .values({ tenant_id: TENANT, key: 'managerPin', value: JSON.stringify(await hashManagerPin(SUPERVISOR_PIN)) })
    .execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', is_active: true }).execute();
  // User 1: the tenant's first active user (the old false attribution).
  await anyDb
    .insertInto('users')
    .values({
      id: 1,
      tenant_id: TENANT,
      username: 'admin',
      display_name: 'Admin',
      phone: '5550000',
      role: 'admin',
      is_active: true,
    })
    .execute();
  // User 2: the account-mode supervisor (a different admin).
  const supPassword = await createPasswordRecord(SUPERVISOR_PASSWORD);
  await anyDb
    .insertInto('users')
    .values({
      id: 2,
      tenant_id: TENANT,
      username: 'sup',
      display_name: 'Supervisor',
      phone: '5550002',
      role: 'admin',
      password_hash: supPassword.hash,
      password_salt: supPassword.salt,
      is_active: true,
    })
    .execute();
  // User 7: rep 1's own login, linked by phone.
  const repPassword = await createPasswordRecord(REP_PASSWORD);
  await anyDb
    .insertInto('users')
    .values({
      id: 7,
      tenant_id: TENANT,
      username: '5550001',
      display_name: 'Rep 1',
      phone: '5550001',
      role: 'admin',
      password_hash: repPassword.hash,
      password_salt: repPassword.salt,
      is_active: true,
    })
    .execute();
  const accounts: Array<[number, string, string]> = [
    [1110, '1110', 'asset'],
    [1120, '1120', 'asset'],
    [1130, '1130', 'asset'],
    [1140, '1140', 'asset'],
    [2120, '2120', 'liability'],
    [4100, '4100', 'revenue'],
    [4300, '4300', 'revenue'],
    [5100, '5100', 'expense'],
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
    })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({
      id: 10,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      name: 'Main warehouse',
      location_type: 'internal_warehouse',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({
      id: 20,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      name: 'Van 1',
      location_type: 'van',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({
      id: 21,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      name: 'Van 2',
      location_type: 'van',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('delivery_representatives')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Rep 1',
      phone: '5550001',
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
      phone: '5550002',
      van_location_id: 21,
      is_van_rep: true,
    })
    .execute();
  // Rep 3 has NO phone, so no linked login: his rows must stay
  // honestly actorless (created_by null), never borrowed from user 1.
  await anyDb
    .insertInto('delivery_representatives')
    .values({
      id: 3,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Rep 3',
      phone: null,
      van_location_id: 20,
      is_van_rep: true,
    })
    .execute();
  await anyDb
    .insertInto('products')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Item 1',
      stock_qty: 10,
      cost_price: 5,
      retail_price: 10,
      credit_price: 10,
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('product_location_stock')
    .values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 1, location_id: 20, qty: 10 })
    .execute();
  await anyDb
    .insertInto('product_location_stock')
    .values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 1, location_id: 21, qty: 0 })
    .execute();
  // Customer 41 is the cash walk-in for the field sale.
  await anyDb
    .insertInto('customers')
    .values({
      id: 41,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Shop Customer 41',
      balance: 0,
      credit_limit: 0,
      customer_type: 'cash',
      metadata: '{}',
      is_active: true,
    })
    .execute();
  // Customer 42 is rep 3's first-sale walk-in: no serving history
  // anywhere, so the F3 route gate lets the first sale through
  // (it CREATES the association). Sharing customer 41 would put
  // rep 1 in the serving set and refuse rep 3 with
  // CUSTOMER_NOT_ON_REP_ROUTE.
  await anyDb
    .insertInto('customers')
    .values({
      id: 42,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Shop Customer 42',
      balance: 0,
      credit_limit: 0,
      customer_type: 'cash',
      metadata: '{}',
      is_active: true,
    })
    .execute();
  for (let tripId = 1; tripId <= 10; tripId++) {
    await anyDb
      .insertInto('van_sales_trips')
      .values({
        id: tripId,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        rep_id: 1,
        van_location_id: 20,
        source_warehouse_id: 10,
        status: 'open',
        settlement_status: 'open',
      })
      .execute();
  }
  // Trip 11 belongs to rep 3 (unlinked): his sale runs from his own trip.
  await anyDb
    .insertInto('van_sales_trips')
    .values({
      id: 11,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      rep_id: 3,
      van_location_id: 20,
      source_warehouse_id: 10,
      status: 'open',
      settlement_status: 'open',
    })
    .execute();
  await anyDb
    .insertInto('cashier_shifts')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      location_id: null,
      status: 'open',
      opened_by: 1,
    })
    .execute();
}

function buildService(db: Kysely<Database>): VanSalesService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const audit = new AuditService(db);
  const radar = new VanFraudRadarService(db);
  const service = new VanSalesService(
    db,
    audit as never,
    {} as never,
    posting as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    radar as never,
  );
  return service;
}

function buildDriverController(
  service: VanSalesService,
  driver: {
    repId: number;
    tenantId: string;
    accountId: string;
    name: string;
    phone: string | null;
    tenantSuspended: boolean;
  },
): VanSalesController {
  return new VanSalesController(
    service,
    {
      verifyDriverToken: async () => ({ ...driver }),
      verifyDriverTokenForSettlement: async () => ({ ...driver }),
      assertDriverPinChanged: async () => undefined,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function clearSaleCaches(): void {
  (VanSalesService as any).recentSalesCache?.clear?.();
  (VanSalesService as any).inFlightSalePromises?.clear?.();
}

async function saleRow(db: Kysely<Database>, saleId: number): Promise<any> {
  return (db as any).selectFrom('sales').selectAll().where('id', '=', saleId).executeTakeFirstOrThrow();
}

async function journalsForSale(db: Kysely<Database>, saleId: number): Promise<any[]> {
  return (db as any)
    .selectFrom('journal_entries')
    .selectAll()
    .where('source_id', '=', saleId)
    .where('tenant_id', '=', TENANT)
    .orderBy('id', 'asc')
    .execute();
}

async function adminSaleCount(db: Kysely<Database>): Promise<number> {
  const row: any = await (db as any)
    .selectFrom('sales')
    .select((eb: any) => eb.fn.countAll().as('count'))
    .where('tenant_id', '=', TENANT)
    .where('created_by', '=', FIRST_USER_ID)
    .executeTakeFirst();
  return Number(row?.count || 0);
}

async function main(): Promise<void> {
  const { db } = await makeDb();
  try {
    await seedFoundation(db);
    const service = buildService(db);
    const controllerRep1 = buildDriverController(service, DRIVER_REP1);
    const controllerRep3 = buildDriverController(service, DRIVER_REP3);
    const authAndPin = new AuthAndPinService(db as any, () => ({}) as never);

    // S1. The resolver itself, driven directly: a linked rep
    // resolves to his own login; an unlinked rep resolves to 0
    // (honest "no user"), never the tenant's first active user;
    // with no rep named the system fallback (first active user)
    // stays, because those callers are system actions, not a rep's.
    {
      const linked = await authAndPin.resolveSystemAuthContext(TENANT, ACCOUNT, 1);
      assert.equal(linked.userId, REP_LINKED_USER_ID, 'linked rep resolves to his own login user');
      assert.notEqual(linked.userId, FIRST_USER_ID, 'linked rep must not resolve to the first user');
      const unlinked = await authAndPin.resolveSystemAuthContext(TENANT, ACCOUNT, 3);
      assert.equal(unlinked.userId, 0, 'unlinked rep resolves to userId 0, never a borrowed user');
      assert.notEqual(unlinked.userId, FIRST_USER_ID, 'unlinked rep must not resolve to the first user');
      const noRep = await authAndPin.resolveSystemAuthContext(TENANT, ACCOUNT);
      assert.equal(noRep.userId, FIRST_USER_ID, 'no rep named keeps the first-active-user system fallback');
      const nullRep = await authAndPin.resolveSystemAuthContext(TENANT, ACCOUNT, null);
      assert.equal(nullRep.userId, FIRST_USER_ID, 'null repId keeps the system fallback');
      console.log('  (S1) resolver: linked 7, unlinked 0, no-rep fallback 1 passed');
    }

    // S2. Linked rep's portal sale through the REAL controller: the
    // sale row, its journal and the rep link all name the rep — and
    // the admin (user 1) carries zero sales.
    {
      clearSaleCaches();
      const res: any = await controllerRep1.executeSale('Bearer <redacted>', {
        tripId: 1,
        customerId: 41,
        customerName: 'Shop Customer 41',
        paymentMethod: 'cash',
        paidAmount: 20,
        items: [{ productId: 1, qty: 2, unitPrice: 10 }],
        clientTxId: 'f20-sale-linked-1',
      });
      assert.equal(res.ok, true);
      const saleId = Number(res.saleId);
      assert.ok(saleId > 0, 'the sale was created');
      const row = await saleRow(db, saleId);
      assert.equal(Number(row.created_by), REP_LINKED_USER_ID, 'linked rep sale names his login as created_by');
      assert.equal(Number(row.delivery_rep_id), 1, 'the sale still names the rep');
      assert.equal(Number(row.van_trip_id), 1, 'the sale still names the trip');
      assert.equal(row.status, 'posted', 'the sale still posts');
      assert.equal(Number(row.total), 20, 'the sale total is unchanged');
      const journals = await journalsForSale(db, saleId);
      assert.ok(journals.length > 0, 'the sale posted at least one journal');
      for (const journal of journals) {
        assert.equal(
          Number(journal.created_by),
          REP_LINKED_USER_ID,
          `journal ${journal.source_type} names the rep linked login`,
        );
      }
      assert.equal(await adminSaleCount(db), 0, 'the admin carries zero sales after the linked sale');
      console.log('  (S2) linked rep portal sale names his login passed');
    }

    // S3. Unlinked rep's portal sale through the REAL controller:
    // the sale POSTS normally, but created_by is NULL — not the
    // admin, not 0 — and every journal for the sale is NULL too.
    // The admin still carries zero sales: the Staff Report
    // per-user view shows neither the rep nor the admin carrying
    // it, while delivery_rep_id keeps the rep attribution.
    {
      clearSaleCaches();
      const res: any = await controllerRep3.executeSale('Bearer <redacted>', {
        tripId: 11,
        customerId: 42,
        customerName: 'Shop Customer 42',
        paymentMethod: 'cash',
        paidAmount: 20,
        items: [{ productId: 1, qty: 2, unitPrice: 10 }],
        clientTxId: 'f20-sale-unlinked-1',
      });
      assert.equal(res.ok, true);
      const saleId = Number(res.saleId);
      assert.ok(saleId > 0, 'the unlinked rep sale was created');
      const row = await saleRow(db, saleId);
      assert.equal(row.created_by, null, 'unlinked rep sale records created_by NULL, never the first user');
      assert.equal(Number(row.delivery_rep_id), 3, 'the sale still names the unlinked rep');
      assert.equal(Number(row.van_trip_id), 11, 'the sale still names the trip');
      assert.equal(row.status, 'posted', 'the unlinked rep sale still posts');
      assert.equal(Number(row.total), 20, 'the unlinked rep sale total is unchanged');
      const journals = await journalsForSale(db, saleId);
      assert.ok(journals.length > 0, 'the unlinked sale posted at least one journal');
      for (const journal of journals) {
        assert.equal(
          journal.created_by,
          null,
          `journal ${journal.source_type} records created_by NULL, never the first user or 0`,
        );
        assert.equal(
          journal.posted_by,
          null,
          `journal ${journal.source_type} records posted_by NULL, never the first user or 0`,
        );
      }
      assert.equal(await adminSaleCount(db), 0, 'the admin carries zero sales after the unlinked sale');
      console.log('  (S3) unlinked rep portal sale is honestly NULL passed');
    }

    // S4. Source pins: the damaged-swap caller (a rep-acted driver
    // action, trip locked by rep) passes repId like the sale and
    // the collection do, so its journal follows the same rule.
    {
      const swapSource = fs.readFileSync(
        path.join(
          __dirname,
          '../../src/modules/delivery-reps/services/van-collections-and-swaps/execute-damaged-swap.slice.ts',
        ),
        'utf8',
      );
      assert.ok(
        swapSource.includes('resolveSystemAuthContext(tenantId, accountId, repId)'),
        'the damaged swap passes repId into resolveSystemAuthContext',
      );
      console.log('  (S4) damaged-swap caller passes repId passed');
    }

    // S5. F20 spec wired into both critical lists (349 specs,
    // identical order) and green (proven by its standalone run).
    {
      const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 363);
      assert.equal(chain.length, 363);
      assert.deepEqual(chain, specs);
      assert.ok(specs.includes('test/critical/van-portal-sale-rep-attribution-f20.spec.ts'));
      // No last-entry assertion: the last slot belongs to whichever spec was wired most recently (P3 appended migration-0339-idempotent after F20); presence above + count + order already prove the wiring.
      assert.equal(
        specs[specs.indexOf('test/critical/van-portal-sale-rep-attribution-f20.spec.ts') - 1],
        'test/critical/van-presales-order-details-line-total.spec.ts',
      );
    }

    console.log('van-portal-sale-rep-attribution-f20: all cases passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(async () => {
    console.log('van-portal-sale-rep-attribution-f20: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
