/*
 * Profit + rep reporting (INV-VAN-PROFIT-REP-REPORTING).
 *
 * THE RULES: (1) pivot profit % is a RATIO OF SUMS per group
 * (SUM(net_profit) / SUM(total_amount) * 100, zero denominator
 * yields 0), never an average of row percents; the pivot offers
 * `net_profit_percent` and a `delivery_rep` dimension (the rep who
 * owns the sale, not the login user who created it). (2) The
 * net-profit view reuses buildCommercialSummary — revenue is already
 * net of discounts, so the discount line is informational, never
 * subtracted twice. (3) The daily rollup subtracts REAL returns
 * (return_documents joined to sales, return_type='sale', return-day
 * window) and stores cogs_total NET of returned-items COGS, so the
 * rollup's net profit equals the summary's netOperatingProfit;
 * cancelled sales are counted nowhere. (4) One shared
 * discounted-invoice predicate (invoice discount OR any line
 * discount > 0) serves listOrders, listDriverSales and the lifetime
 * report. (5) The lifetime endpoint attributes by delivery_rep_id;
 * its per-day due reuses P1's bucketTripCashByDay on rep-wide rows.
 * (6) F1 PINNED, not fixed: van sales already post tax
 * (INV-VAN-SALE-TAX-OPTIONAL) — the tax spec is wired into both
 * critical lists and the profit paths consume sales.tax_amount.
 *
 * HARNESS: the real DynamicPivotService + DailyCommercialRollupService
 * + ReportsService + DeliveryRepsService + VanSalesService facade on
 * PGlite, one fresh DB per pin (no cross-pin pollution). Tear down is
 * db.destroy() only.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanTripLifecycleService } from '../../src/modules/delivery-reps/services/van-trip-lifecycle.service';
import { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { DynamicPivotService } from '../../src/modules/reports/services/dynamic-pivot.service';
import { DailyCommercialRollupService } from '../../src/modules/reports/services/daily-commercial-rollup.service';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { buildDynamicPivotMatrix } from '../../src/modules/reports/engines/pivot-aggregation.engine';
import { buildReportSummaryPayload } from '../../src/modules/reports/helpers/reports-summary.helper';
import { hashManagerPin } from '../../src/common/utils/manager-approval';

const TENANT = 't-van-return-lock';
const ACCOUNT = 'a-van-return-lock';
const D1 = '2026-11-09';

const ADMIN = {
  userId: 2,
  sessionId: 'spec',
  username: 'sup',
  role: 'admin',
  permissions: ['deliveryReps', 'accounting', 'canManageSettings', 'canEditInvoices', 'sales'],
  tenantId: TENANT,
  accountId: ACCOUNT,
};

const CASHIER = {
  userId: 3,
  sessionId: 'spec',
  username: 'cashier',
  role: 'cashier',
  // A real sales-workspace user carries 'sales' (getSaleById, which
  // both updateSale and adjustSalePayments return through, asserts
  // it). Without it the adjustment still commits and then 403s on
  // the return read — pre-existing pattern, same as updateSale.
  permissions: ['deliveryReps', 'sales'],
  tenantId: TENANT,
  accountId: ACCOUNT,
};

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean);
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
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true, display_name text);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, metadata text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, half_wholesale_price numeric, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric, item_type text, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE manufacturing_boms (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, is_active boolean DEFAULT true);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100), expiry_date varchar(30), quantity numeric, unit_cost numeric, location_id integer, supplier_name varchar(150), status varchar(50), notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE inventory_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number text, expiry_date text, quantity numeric DEFAULT 0, unit_cost numeric DEFAULT 0, location_id integer, supplier_name text, status text DEFAULT 'active', notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, shift_name text, start_odometer numeric, end_odometer numeric, distance_km numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric, stock_variance_amount numeric, stock_variance_details jsonb, night_stock_approved boolean, notes text, night_stock_approved_by bigint, night_stock_notes text, business_day date, submitted_per_day_cash jsonb, opened_at timestamptz, submitted_at timestamptz, settled_by bigint, supervisor_id bigint, closed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, delivery_status text, settled_by bigint, settled_at timestamptz, delivery_signature text, delivery_notes text, delivery_photo_url text, table_number text, customer_id bigint, customer_name text, customer_phone text, customer_address text, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, order_type text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, gps_missing_reason text, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW(), received_at timestamptz, updated_at timestamptz);
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, net_unit_price numeric, net_line_total numeric, allocated_discount numeric DEFAULT 0, allocated_tax numeric DEFAULT 0, cost_price numeric, consumer_price numeric, pricing_tier_type text, price_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, serials jsonb, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, quantity numeric, allocation_order int);
      CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, qty numeric, quantity numeric, lot_id bigint, allocation_type text, reversal_of_allocation_id bigint);
      CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, qty numeric, quantity numeric, remaining_quantity numeric, status text, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
      CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, invoice_type text, invoice_id bigint, amount numeric);
      CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points numeric, points_change numeric, balance_after numeric, action_type text, notes text, sale_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
      CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_type text, invoice_id bigint, doc_no text, total numeric DEFAULT 0, total_amount numeric DEFAULT 0, settlement_mode text, refund_method text, status text, created_at timestamptz DEFAULT NOW(), exchange_tip_relief numeric DEFAULT 0, exchange_courier_relief numeric DEFAULT 0);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, company_name text, tax_number text, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, price_list_id bigint, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, branch_id bigint, location_id bigint, created_by bigint, gps_lat numeric, gps_lng numeric, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric DEFAULT 0, payment_channel text, note text, branch_id bigint, location_id bigint, job_id text, created_by bigint, transfer_reference text, instapay_address text, transfer_receipt_url text, van_trip_id bigint, rep_id bigint, client_tx_id text, created_at timestamptz DEFAULT NOW(), received_at timestamptz);
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, trip_id bigint, rep_id bigint, customer_id bigint, sale_id bigint, status text, return_reason text, refund_method text, total_amount numeric DEFAULT 0, items_json jsonb, notes text, rejection_reason text, approved_by bigint, approved_at timestamptz, created_at timestamptz DEFAULT NOW(), received_at timestamptz, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric DEFAULT 0, request_key text, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, opening_cash numeric DEFAULT 0, opening_note text, status text, terminal_code text, expected_cash numeric, counted_cash numeric, variance numeric, variance_resolution text, variance_journal_entry_id bigint, variance_approved_by bigint, variance_approved_at timestamptz, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), closed_at timestamptz);
      CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, settled_at timestamptz, settled_by bigint, settlement_method text, notes text, receipt_voucher_no text, payroll_run_id bigint, business_day date, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE settlement_allocations (id bigserial PRIMARY KEY, tenant_id text, settlement_id bigint, sale_id bigint, customer_payment_id bigint, amount numeric DEFAULT 0, business_day date, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, expense_type text, amount numeric DEFAULT 0, notes text, receipt_photo_url text, created_by_user_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE delivery_rep_targets (id bigserial PRIMARY KEY, tenant_id text, rep_id bigint, period_month text, target_amount numeric DEFAULT 0, collection_target numeric, visits_target numeric);
      CREATE TABLE van_damaged_swaps (id bigserial PRIMARY KEY, tenant_id text, trip_id bigint, customer_id bigint, damaged_product_id bigint, damaged_qty numeric, damage_reason text, replacement_product_id bigint, replacement_qty numeric, price_difference numeric, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE hr_holidays (id bigserial PRIMARY KEY, tenant_id text, start_date date, end_date date);
      CREATE TABLE product_units (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, name text, multiplier numeric);
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, action text, event_code text, idempotency_key text, details text, target_tenant_id text, created_by bigint, impersonated_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text, type text, default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE price_list_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, price_list_id bigint, product_id bigint, product_name text, category_id bigint, min_quantity numeric DEFAULT 1, fixed_price numeric, discount_percent numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE categories (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id bigint;
      CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, amount numeric DEFAULT 0, title text, note text, branch_id bigint, location_id bigint, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE purchases (id bigserial PRIMARY KEY, tenant_id text, account_id text, total numeric DEFAULT 0, status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, account_id text, amount numeric DEFAULT 0, is_active boolean DEFAULT true, branch_id bigint, location_id bigint, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_document_id bigint, sale_item_id bigint, product_id bigint, qty numeric DEFAULT 0, line_total numeric DEFAULT 0, allocated_tax numeric DEFAULT 0, cost_price numeric);
      CREATE TABLE daily_commercial_rollups (id bigserial PRIMARY KEY, tenant_id text, rollup_date date, branch_id bigint, branch_key int, sales_count int DEFAULT 0, sales_total numeric DEFAULT 0, cash_sales_total numeric DEFAULT 0, credit_sales_total numeric DEFAULT 0, cogs_total numeric DEFAULT 0, gross_profit numeric DEFAULT 0, returns_count int DEFAULT 0, returns_total numeric DEFAULT 0, expenses_total numeric DEFAULT 0, net_profit numeric DEFAULT 0, updated_at timestamptz DEFAULT NOW());
      CREATE UNIQUE INDEX idx_daily_rollups_tenant_date_branch ON daily_commercial_rollups (tenant_id, rollup_date, branch_key);
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
      { id: 3, tenant_id: TENANT, username: 'cashier', phone: null, role: 'cashier', is_active: true },
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
    .insertInto('stock_locations')
    .values({
      id: 30,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Damaged',
      location_type: 'damaged',
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
      phone: null,
      van_location_id: 20,
      is_van_rep: true,
      permissions: JSON.stringify({
        can_give_discount: true,
        can_give_invoice_discount: true,
        max_discount_percent: 0,
        can_collect_cash: true,
      }),
    })
    .execute();
  await anyDb
    .insertInto('delivery_representatives')
    .values({
      id: 2,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Rep 2',
      phone: null,
      van_location_id: 20,
      is_van_rep: true,
      permissions: JSON.stringify({ can_give_discount: true, can_collect_cash: true }),
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
    .insertInto('customers')
    .values({
      id: 2,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Customer 2',
      balance: 0,
      credit_limit: 10000,
      is_active: true,
    })
    .execute();
  await sql`SELECT setval(pg_get_serial_sequence('customers', 'id'), (SELECT MAX(id) FROM customers))`.execute(db);
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
  opts: { repId?: number; cashCollected?: number; businessDay?: string | null } = {},
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
      status: 'open',
      settlement_status: 'open',
      loaded_amount: 0,
      sales_amount: 0,
      cash_collected: opts.cashCollected ?? 10000,
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
      opened_at: '2026-11-09T08:00:00+02:00',
    })
    .execute();
}

async function seedProduct(db: Kysely<Database>, id: number, vanQty = 100): Promise<void> {
  const anyDb = db as any;
  await anyDb
    .insertInto('products')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: `Product ${id}`,
      stock_qty: vanQty,
      cost_price: 50,
      retail_price: 100,
      wholesale_price: 80,
      half_wholesale_price: null,
      credit_price: 90,
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('product_location_stock')
    .values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: id, location_id: 20, qty: vanQty })
    .execute();
}

async function seedPin(db: Kysely<Database>, pin: string): Promise<void> {
  const hash = await hashManagerPin(pin);
  await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: hash }).execute();
}

function errorCode(e: unknown): string {
  return (e as any)?.code ? String((e as any).code) : '';
}

/**
 * Seeds a POSTED sale the way the real van insert leaves it:
 * paid_amount is 0 for cash/credit/split (only card/instapay get
 * paid_amount = total), so the refund legs derive from payment_type
 * + receivable + the customer_ledger sale_credit row for splits.
 */
async function seedVanSale(
  db: Kysely<Database>,
  id: number,
  opts: {
    tripId?: number | null;
    customerId?: number | null;
    paymentType?: string;
    paymentChannel?: string;
    total?: number;
    paidAmount?: number;
    qty?: number;
    unitPrice?: number;
    legs?: Array<{ channel: string; amount: number }>;
    ledgerCredit?: number | null;
    createdAt?: string;
    discount?: number;
    lineDiscount?: number;
    deliveryRepId?: number;
    createdBy?: number;
    taxRate?: number;
    taxAmount?: number;
  } = {},
): Promise<number[]> {
  const anyDb = db as any;
  const qty = opts.qty ?? 10;
  const unitPrice = opts.unitPrice ?? 100;
  const lineDiscount = opts.lineDiscount ?? 0;
  const discount = opts.discount ?? 0;
  // The sale total is net of both discounts (the real insert posts
  // the net total); the predicate pins only need discount > 0 /
  // line_discount > 0, but the row stays coherent.
  const total = opts.total ?? qty * unitPrice - lineDiscount - discount;
  await anyDb
    .insertInto('sales')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      doc_no: `INV-${id}`,
      total,
      subtotal: qty * unitPrice,
      discount,
      tax_rate: opts.taxRate ?? 0,
      tax_amount: opts.taxAmount ?? 0,
      delivery_fee: 0,
      delivery_fee_mode: 'per_order',
      service_charge: 0,
      tip_amount: 0,
      paid_amount: opts.paidAmount ?? 0,
      applied_amount: opts.paidAmount ?? 0,
      tendered_amount: opts.paidAmount ?? 0,
      change_amount: 0,
      store_credit_used: 0,
      prices_include_tax: true,
      status: 'posted',
      payment_type: opts.paymentType ?? 'cash',
      payment_channel: opts.paymentChannel ?? 'cash',
      collection_status: null,
      customer_id: opts.customerId === undefined ? 1 : opts.customerId,
      customer_name: 'Customer 1',
      customer_phone: null,
      customer_address: null,
      branch_id: null,
      location_id: 20,
      created_by: opts.createdBy ?? 2,
      delivery_rep_id: opts.deliveryRepId ?? 1,
      van_trip_id: opts.tripId === undefined ? 1 : opts.tripId,
      sale_origin: 'van_field',
      order_type: null,
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
      gps_missing_reason: null,
      delivery_proof_photo: null,
      packaging_breakdown: null,
      created_at: opts.createdAt ?? '2026-11-09T08:00:00+02:00',
      received_at: opts.createdAt ?? '2026-11-09T08:00:00+02:00',
    })
    .execute();
  const itemIds: number[] = [];
  const inserted = await anyDb
    .insertInto('sale_items')
    .values({
      sale_id: id,
      product_id: 101,
      product_name: 'Product 101',
      qty,
      unit_price: unitPrice,
      line_total: qty * unitPrice,
      line_discount: lineDiscount,
      net_line_total: qty * unitPrice - lineDiscount,
      cost_price: 50,
      consumer_price: 100,
      pricing_tier_type: 'retail',
      unit_offer_savings: 0,
      unit_name: 'piece',
      unit_multiplier: 1,
      is_bonus: false,
      bonus_reason: null,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      modifiers: null,
    })
    .returning(['id'])
    .execute();
  itemIds.push(Number(inserted[0].id));
  for (const leg of opts.legs || []) {
    await anyDb
      .insertInto('sale_payments')
      .values({
        sale_id: id,
        payment_channel: leg.channel,
        amount: leg.amount,
        applied_amount: leg.amount,
        tendered_amount: leg.amount,
        change_amount: 0,
        card_rrn: null,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .execute();
  }
  if (opts.ledgerCredit != null) {
    await anyDb
      .insertInto('customer_ledger')
      .values({
        customer_id: opts.customerId ?? 1,
        supplier_id: null,
        entry_type: 'sale_credit',
        amount: opts.ledgerCredit,
        balance_after: null,
        note: 'split credit leg',
        reference_type: 'sale',
        reference_id: id,
        van_trip_id: opts.tripId ?? 1,
        gps_lat: null,
        gps_lng: null,
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .execute();
  }
  return itemIds;
}

// P1's own shape for the due computation (paid_amount = total).
async function seedCashSaleForDue(
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

// P1's shape: an old approved cash return with sale_id NULL.
async function seedLegacyCashRefund(
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

function buildVanSales(db: Kysely<Database>): VanSalesService {
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
    userId: 2,
    sessionId: 'spec',
    username: 'sup',
    role: 'admin',
    permissions: ['accounting', 'deliveryReps'],
    tenantId: TENANT,
    accountId: ACCOUNT,
  });
  return service;
}

function buildPivot(db: Kysely<Database>): DynamicPivotService {
  return new DynamicPivotService(db as never);
}

function buildRollup(db: Kysely<Database>): DailyCommercialRollupService {
  return new DailyCommercialRollupService(db as never);
}

function buildReports(db: Kysely<Database>): ReportsService {
  return new ReportsService(db as never);
}

function buildReps(db: Kysely<Database>): DeliveryRepsService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const auditStub = { log: async () => {}, logWithExecutor: async () => {} };
  // REAL posting service: listOrders calls repOrderCashDue per row,
  // which calls accountingPosting.deliverySettlementBasis.
  return new DeliveryRepsService(db as never, auditStub as never, posting as never, {} as never);
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
    sortItemsByProductId: (items: any[]) => [...items].sort((a, b) => a.productId - b.productId),
    moveVanStock: async () => ({ scopeBefore: 0, scopeAfter: 0 }),
    moveVanPharmacyBatches: async () => 0,
    deductVanSalePharmacyBatches: async () => [],
    resolveSystemAuthContext: async () => ({ ...ADMIN, userId: 2 }) as never,
    recordSuspicionEvent: async () => ({}),
    listRepServedCustomerIds: async () => new Set<number>(),
    resolveRepLinkedUserId: async () => null,
  } as never);
}

async function saleRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any)
    .selectFrom('sales')
    .selectAll()
    .where('id', '=', id)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow();
}

async function legs(db: Kysely<Database>, saleId: number): Promise<any[]> {
  return (db as any)
    .selectFrom('sale_payments')
    .selectAll()
    .where('sale_id', '=', saleId)
    .where('tenant_id', '=', TENANT)
    .orderBy('id')
    .execute();
}

async function returnRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any)
    .selectFrom('van_field_returns')
    .selectAll()
    .where('id', '=', id)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow();
}

async function countRows(db: Kysely<Database>, table: string): Promise<number> {
  const row = (await (db as any)
    .selectFrom(table)
    .select(sql`count(*)`.as('c'))
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow()) as any;
  return Number(row.c);
}

async function journals(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<any[]> {
  return (db as any)
    .selectFrom('journal_entries')
    .selectAll()
    .where('tenant_id', '=', TENANT)
    .where('source_type', '=', sourceType)
    .where('source_id', '=', sourceId)
    .execute();
}

async function journalLines(db: Kysely<Database>, entryId: number): Promise<any[]> {
  return (db as any).selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', entryId).execute();
}

function lineFor(lines: any[], accountId: number): { debit: number; credit: number } {
  return lines
    .filter((l: any) => Number(l.account_id) === accountId)
    .reduce(
      (acc: any, l: any) => ({ debit: acc.debit + Number(l.debit || 0), credit: acc.credit + Number(l.credit || 0) }),
      { debit: 0, credit: 0 },
    );
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (e) {
    assert.equal(errorCode(e), code, `expected ${code}, got ${errorCode(e)} (${(e as any)?.message || e})`);
    return;
  }
  assert.fail(`expected refusal ${code}, but the call succeeded`);
}

async function main(): Promise<void> {
  // 1. Pivot profit % is a RATIO OF SUMS (grouped), never an average
  // of row percents — and it is computed AFTER discounts.
  {
    // 1a. Pure engine: two rows, 90% and 10% — the average of the
    // row percents is 50%, the ratio of sums is 18%.
    const pure = buildDynamicPivotMatrix({
      records: [
        { product: 'A', total_amount: 100, net_profit: 90 },
        { product: 'A', total_amount: 900, net_profit: 90 },
        { product: 'B', total_amount: 0, net_profit: 5 },
      ],
      rowDimension: 'product',
      colDimension: null,
      metric: 'net_profit_percent',
    });
    assert.equal(pure.rowTotals['A'].value, 18);
    assert.equal(pure.rowTotals['B'].value, 0, 'zero denominator yields 0, never NaN');
    assert.equal(pure.grandTotal.value, 18.5);

    // 1b. Real executePivot, grouped by product, after discounts:
    // A: net 180, profit 80 -> 44.44%; B: net 100, profit 10 -> 10%;
    // grand: 90 / 280 -> 32.14%.
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 201);
      await seedProduct(db, 202);
      // seedVanSale seeds every NOT NULL sales column; the items are
      // then re-pointed at the two products (201: net 180 after a
      // 20 line discount, cost 50; 202: net 100, cost 90).
      await seedVanSale(db, 301, {
        tripId: null,
        qty: 2,
        unitPrice: 100,
        lineDiscount: 20,
        deliveryRepId: 1,
        createdAt: '2026-11-09T08:00:00+02:00',
      });
      await seedVanSale(db, 302, {
        tripId: null,
        qty: 1,
        unitPrice: 100,
        deliveryRepId: 2,
        createdAt: '2026-11-09T08:00:00+02:00',
      });
      await (db as any)
        .updateTable('sale_items')
        .set({ product_id: 201, product_name: 'Product 201' })
        .where('sale_id', '=', 301)
        .execute();
      await (db as any)
        .updateTable('sale_items')
        .set({ product_id: 202, product_name: 'Product 202', cost_price: 90 })
        .where('sale_id', '=', 302)
        .execute();
      const pivot = buildPivot(db);
      const byProduct = await pivot.executePivot(
        { ...ADMIN, userId: 2 } as never,
        { dataset: 'sales', rowDimension: 'product', metric: 'net_profit_percent' } as never,
      );
      assert.equal(byProduct.rowTotals['Product 201'].value, 44.44);
      assert.equal(byProduct.rowTotals['Product 202'].value, 10);
      assert.equal(byProduct.grandTotal.value, 32.14);
      // 1c. The rep dimension groups by delivery_rep_id, not the
      // login user: both sales were created by user 2.
      const byRep = await pivot.executePivot(
        { ...ADMIN, userId: 2 } as never,
        { dataset: 'sales', rowDimension: 'delivery_rep', metric: 'total_amount' } as never,
      );
      assert.equal(byRep.rowKeys.length, 2);
      assert.equal(byRep.rowTotals['1'].value, 180);
      assert.equal(byRep.rowTotals['2'].value, 100);
      assert.equal(byRep.rowKeys.find((k: any) => k.key === '1')?.label, 'Rep 1');
    } finally {
      await db.destroy();
    }
  }

  // 2. Discounted-only returns EXACTLY the discounted invoices
  // (invoice discount, line discount, both) and excludes clean ones.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 1);
      await seedProduct(db, 101);
      await seedVanSale(db, 401, { tripId: 1, discount: 50 });
      await seedVanSale(db, 402, { tripId: 1, lineDiscount: 30 });
      await seedVanSale(db, 403, { tripId: 1, discount: 10, lineDiscount: 20 });
      await seedVanSale(db, 404, { tripId: 1 });
      const reps = buildReps(db);
      const all = (await reps.listOrders(1, ADMIN as never, {})) as any;
      assert.equal(all.orders.length, 4);
      const only = (await reps.listOrders(1, ADMIN as never, { discountedOnly: true })) as any;
      assert.deepEqual(only.orders.map((o: any) => Number(o.id)).sort(), [401, 402, 403]);
      const van = buildVanSales(db);
      const driver = await van.listDriverSales(TENANT, 1, { discountedOnly: true });
      assert.deepEqual((driver as any[]).map((o: any) => Number(o.id)).sort(), [401, 402, 403]);
      const driverAll = await van.listDriverSales(TENANT, 1, {});
      assert.equal((driverAll as any[]).length, 4);
    } finally {
      await db.destroy();
    }
  }

  // 3. Rollup net profit equals the summary netOperatingProfit on a
  // seeded day with real returns; cancelled sales count nowhere.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 1);
      await seedProduct(db, 101);
      const [item1] = await seedVanSale(db, 501, {
        tripId: 1,
        qty: 10,
        unitPrice: 100,
        createdAt: '2026-11-09T08:00:00+02:00',
      });
      await seedVanSale(db, 502, { tripId: 1, qty: 4, unitPrice: 100, createdAt: '2026-11-09T09:00:00+02:00' });
      // A cancelled sale on the same day: excluded from salesTotal
      // and NOT counted as a return.
      await (db as any)
        .insertInto('sales')
        .values({
          id: 503,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          doc_no: 'INV-503',
          total: 999,
          subtotal: 999,
          discount: 0,
          tax_rate: 0,
          tax_amount: 0,
          delivery_fee: 0,
          tip_amount: 0,
          paid_amount: 0,
          status: 'cancelled',
          payment_type: 'cash',
          payment_channel: 'cash',
          customer_id: 1,
          branch_id: null,
          location_id: 20,
          created_by: 2,
          delivery_rep_id: 1,
          van_trip_id: 1,
          created_at: '2026-11-09T10:00:00+02:00',
        })
        .execute();
      // A real return of sale 501: 2 units, 200, cost 50 each.
      await (db as any)
        .insertInto('return_documents')
        .values({
          id: 601,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          return_type: 'sale',
          invoice_id: 501,
          doc_no: 'RET-601',
          total: 200,
          total_amount: 200,
          status: 'approved',
          created_at: '2026-11-09T11:00:00+02:00',
        })
        .execute();
      await (db as any)
        .insertInto('return_items')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          return_document_id: 601,
          sale_item_id: item1,
          product_id: 101,
          qty: 2,
          line_total: 200,
          allocated_tax: 0,
          cost_price: 50,
        })
        .execute();
      await (db as any)
        .insertInto('expenses')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          amount: 50,
          title: 'fuel',
          expense_date: '2026-11-09T12:00:00+02:00',
        })
        .execute();
      const rollup = buildRollup(db);
      const day = await rollup.computeAndStoreDailyRollup(TENANT, '2026-11-09');
      assert.equal(day.salesTotal, 1400);
      assert.equal(day.returnsTotal, 200);
      assert.equal(day.returnsCount, 1);
      assert.equal(day.cogsTotal, 600, 'gross COGS 700 minus returned COGS 100');
      assert.equal(day.grossProfit, 600);
      assert.equal(day.expensesTotal, 50);
      assert.equal(day.netProfit, 550);
      // The stored row reconciles from its own columns.
      const stored = (await (db as any)
        .selectFrom('daily_commercial_rollups')
        .selectAll()
        .where('tenant_id', '=', TENANT)
        .where('rollup_date', '=', '2026-11-09')
        .executeTakeFirstOrThrow()) as any;
      assert.equal(
        Number(stored.sales_total) - Number(stored.returns_total) - Number(stored.cogs_total),
        Number(stored.gross_profit),
      );
      // The summary on the same rows agrees to the piastre.
      const summary = buildReportSummaryPayload({
        salesRows: [
          { total: 1000, tax_amount: 0, discount: 0 },
          { total: 400, tax_amount: 0, discount: 0 },
        ] as any,
        returnsRows: [{ return_type: 'sale', total: 200 }] as any,
        saleItemsRows: [
          { qty: 10, cost_price: 50 },
          { qty: 4, cost_price: 50 },
        ] as any,
        returnedSaleItemsRows: [{ qty: 2, cost_price: 50, allocated_tax: 0 }] as any,
        expensesRows: [{ amount: 50 }] as any,
      });
      assert.equal(summary.commercial.netOperatingProfit, 550);
      assert.equal(day.netProfit, summary.commercial.netOperatingProfit);
      // Recompute is idempotent: a second run stores the same row.
      const day2 = await rollup.computeAndStoreDailyRollup(TENANT, '2026-11-09');
      assert.equal(day2.netProfit, 550);
    } finally {
      await db.destroy();
    }
  }

  // 4. Rep lifetime endpoint: from-day-one totals + today + target;
  // a supervisor-created van sale is attributed to the rep, not to
  // the supervisor's user; per-day due agrees with P1's per-trip due.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 1, { repId: 1, businessDay: null });
      await seedTrip(db, 2, { repId: 1, businessDay: null });
      await seedTrip(db, 3, { repId: 2, businessDay: null });
      await seedProduct(db, 101);
      const nowIso = new Date().toISOString();
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      // Supervisor-created (created_by 2), owned by rep 1, today.
      await seedVanSale(db, 701, { tripId: 1, total: 1000, createdAt: nowIso, createdBy: 2, deliveryRepId: 1 });
      // Rep 1, older day this month (trip 2).
      await seedVanSale(db, 702, { tripId: 2, total: 500, createdAt: '2026-11-01T08:00:00+02:00', deliveryRepId: 1 });
      // Rep 2 — must not leak into rep 1's report.
      await seedVanSale(db, 703, { tripId: 3, total: 700, createdAt: nowIso, deliveryRepId: 2 });
      await (db as any)
        .insertInto('customer_payments')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          customer_id: 1,
          amount: 300,
          payment_channel: 'cash',
          van_trip_id: 1,
          rep_id: 1,
          created_at: nowIso,
        })
        .execute();
      await (db as any)
        .insertInto('van_field_returns')
        .values({
          id: 801,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          doc_no: 'RET-801',
          trip_id: 1,
          rep_id: 1,
          customer_id: 1,
          sale_id: 701,
          status: 'approved',
          return_reason: 'damaged',
          refund_method: 'cash',
          total_amount: 100,
          created_at: nowIso,
        })
        .execute();
      await (db as any)
        .insertInto('delivery_rep_targets')
        .values([
          {
            tenant_id: TENANT,
            rep_id: 1,
            period_month: monthKey,
            target_amount: 5000,
            collection_target: 4000,
            visits_target: 20,
          },
          {
            tenant_id: TENANT,
            rep_id: 1,
            period_month: '2026-10',
            target_amount: 3000,
            collection_target: null,
            visits_target: null,
          },
        ])
        .execute();
      const reps = buildReps(db);
      const report = (await reps.getRepLifetimeReport(1, ADMIN as never)) as any;
      assert.equal(report.lifetime.salesCount, 2);
      assert.equal(report.lifetime.salesTotal, 1500, 'includes the supervisor-created sale, excludes rep 2');
      assert.equal(report.lifetime.collectionsTotal, 300);
      assert.equal(report.lifetime.returnsTotal, 100);
      assert.equal(report.today.salesCount, 1);
      assert.equal(report.today.salesTotal, 1000);
      assert.equal(report.currentTarget.targetAmount, 5000);
      assert.equal(report.currentTarget.actualSalesMtd, 1500);
      assert.equal(report.targetsHistory.length, 2);
      assert.equal(report.dueByDay.length, 2, 'today + 2026-11-01');
      assert.equal(
        report.totalDue,
        report.dueByDay.reduce((s: number, d: any) => s + d.due, 0),
      );
      // Cross-check against P1's own per-trip due, summed.
      const lifecycle = buildLifecycle(db);
      const due1 = await lifecycle.getTripDueByDay(1, TENANT, 1);
      const due2 = await lifecycle.getTripDueByDay(1, TENANT, 2);
      assert.equal(report.totalDue, due1.totalDue + due2.totalDue);
      // Rep 2 sees only his own sale.
      const report2 = (await reps.getRepLifetimeReport(2, ADMIN as never)) as any;
      assert.equal(report2.lifetime.salesTotal, 700);
      assert.equal(report2.lifetime.salesCount, 1);
    } finally {
      await db.destroy();
    }
  }

  // 5. Tax pin (F1, not a fix): configured 14% posts tax_amount =
  // 14% of the net base on the van sale; no rate posts zero; the
  // summary's salesTaxTotal includes the van tax.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 1);
      await seedProduct(db, 101);
      await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'taxRate', value: '14' }).execute();
      const van = buildVanSales(db);
      const res = await van.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 2 }],
      });
      assert.equal(res.total, 228);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.tax_rate), 14);
      assert.equal(Number(sale.tax_amount), 28);
      const summary = buildReportSummaryPayload({
        salesRows: [{ total: 228, tax_amount: 28, discount: 0 }] as any,
      });
      assert.equal((summary as any).tax.salesTaxTotal, 28);
    } finally {
      await db.destroy();
    }
    const { pg: pg2, db: db2 } = await makeDb();
    try {
      await seedFoundation(db2);
      await seedTrip(db2, 1);
      await seedProduct(db2, 101);
      const van2 = buildVanSales(db2);
      const res2 = await van2.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        items: [{ productId: 101, qty: 2 }],
      });
      assert.equal(res2.total, 200);
      const sale2 = await saleRow(db2, res2.saleId);
      assert.equal(Number(sale2.tax_amount), 0);
    } finally {
      await db2.destroy();
    }
  }

  // 6. Net-profit view: the discount line is explicit and the lines
  // sum to netOperatingProfit to the piastre (discounts are NOT
  // subtracted twice — revenue is already net of them).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 1);
      await seedProduct(db, 101);
      await seedVanSale(db, 901, {
        tripId: 1,
        qty: 10,
        unitPrice: 100,
        discount: 100,
        createdAt: '2026-11-09T08:00:00+02:00',
      });
      await seedVanSale(db, 902, { tripId: 1, qty: 4, unitPrice: 100, createdAt: '2026-11-09T09:00:00+02:00' });
      await (db as any)
        .insertInto('return_documents')
        .values({
          id: 911,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          return_type: 'sale',
          invoice_id: 901,
          doc_no: 'RET-911',
          total: 200,
          total_amount: 200,
          status: 'approved',
          created_at: '2026-11-09T11:00:00+02:00',
        })
        .execute();
      const [item901] = (await (db as any)
        .selectFrom('sale_items')
        .select('id')
        .where('sale_id', '=', 901)
        .execute()) as any;
      await (db as any)
        .insertInto('return_items')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          return_document_id: 911,
          sale_item_id: Number(item901.id),
          product_id: 101,
          qty: 2,
          line_total: 200,
          allocated_tax: 0,
          cost_price: 50,
        })
        .execute();
      await (db as any)
        .insertInto('expenses')
        .values({
          tenant_id: TENANT,
          account_id: ACCOUNT,
          amount: 50,
          title: 'fuel',
          expense_date: '2026-11-09T12:00:00+02:00',
        })
        .execute();
      const reports = buildReports(db);
      const view = (await reports.netProfitReport(
        { from: '2026-11-09T00:00:00+02:00', to: '2026-11-09T23:59:59+02:00' } as never,
        ADMIN as never,
      )) as any;
      const lines = view.lines;
      assert.equal(lines.revenue, 1300, 'sales 900 + 400 (invoice discount already inside)');
      assert.equal(lines.salesTaxTotal, 0);
      assert.equal(lines.returnsNetOfTax, 200);
      assert.equal(lines.discountsTotal, 100, 'the explicit discount line');
      assert.equal(lines.netSales, 1100);
      assert.equal(lines.cogs, 600);
      assert.equal(lines.grossProfit, 500);
      assert.equal(lines.expensesTotal, 50);
      assert.equal(lines.netOperatingProfit, 450);
      assert.equal(
        lines.revenue - lines.salesTaxTotal - lines.returnsNetOfTax - lines.cogs - lines.expensesTotal,
        lines.netOperatingProfit,
      );
      assert.equal(view.reconciliation.expectedNetOperatingProfit, lines.netOperatingProfit);
    } finally {
      await db.destroy();
    }
  }

  // 7. Tax spec wired into both critical lists (349 specs, identical
  // order) and green (proven by its standalone run, /tmp/p6-tax3.log).
  {
    const specs = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 396);
    assert.equal(chain.length, 396);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/van-field-sale-tax-optional.spec.ts'));
    assert.equal(
      specs[specs.indexOf('test/critical/van-field-sale-tax-optional.spec.ts') - 1],
      'test/critical/van-field-noncash-evidence.spec.ts',
    );
  }

  console.log('van-profit-rep-reporting: all cases passed');
}

main()
  .then(async () => {
    console.log('van-profit-rep-reporting: all cases passed');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
