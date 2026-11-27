/*
 * Return linkage + payment lock (INV-VAN-RETURN-LINKAGE-PAYMENT-LOCK).
 *
 * THE GAP: a van field return could be recorded with no original
 * invoice (saleId null) — then the refund-tender leg check was
 * skipped by an `if (linkedSale)` guard, so a cash refund could be
 * paid out of a credit sale, and the per-line caps had no sale to
 * check against. And separately, `updateSale` re-stated a posted
 * sale's payment legs on every edit (deleteFrom + re-insert of
 * sale_payments from the client's payload), so an edit could silently
 * rewrite how a sale was paid.
 *
 * THE RULE: (1) every NEW field return must name its original sale
 * — missing saleId is refused 400 RETURN_REQUIRES_SALE_ID before any
 * other validation, nothing is written; the unlinked branch is
 * deleted and the leg check is unconditional. No NOT NULL on
 * van_field_returns.sale_id: historical unlinked returns still exist
 * and the approval flow keeps its legacy branch for them. (2)
 * updateSale never touches sale_payments — the stored legs are the
 * sale's payments and an edit leaves them byte-identical; a restated
 * total above the stored legs is refused 422
 * SALE_EDIT_OVERPAID_LEGS (the journal would unbalance), while a
 * restated total below the legs is absorbed by the receivable. (3)
 * The ONLY writer of sale_payments after posting is the new
 * PIN-gated POST /api/sales/:id/payment-adjustment, which replaces
 * the complete leg set, reuses postSaleEdit for the reversing
 * journal, and is audit-logged with reason + actor. It posts a
 * sale_edit journal, so it consumes the sale's single-edit
 * allowance — a later updateSale AND a second adjustment are both
 * refused SALE_EDIT_ALREADY_APPLIED.
 *
 * F7 VERIFIED PRESENT (not added): every approved field return
 * posts a journal via postVanFieldReturn (Dr revenue, Cr
 * receivable/rep-custody, COGS reversal Dr 1140 / Cr 5100, lines
 * tagged with the target location — the damaged location for
 * damaged returns). There is NO separate 5300 damaged-expense leg:
 * a plain damaged return quarantines goods at cost in the damaged
 * location, it is not an automatic write-off.
 *
 * HARNESS: the real VanReturnsService + the real
 * SalesEditAndCancelService (real authz/finance/query/posting,
 * function-dep stubs, planFeatureService stub, no cash-drawer
 * service so the post-close refresh no-ops) + the real
 * VanTripLifecycleService via P1's deps-object pattern, on PGlite.
 * Sales are seeded directly as posted rows (the van insert writes
 * paid_amount 0 for cash/credit/split sales — only card/instapay
 * get paid_amount = total — so the refund legs derive from
 * payment_type + receivable + the customer_ledger sale_credit row
 * for splits). Tear down is db.destroy() only.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { VanReturnsService } from '../../src/modules/delivery-reps/services/van-returns.service';
import { VanTripLifecycleService } from '../../src/modules/delivery-reps/services/van-trip-lifecycle.service';
import { SalesEditAndCancelService } from '../../src/modules/sales/services/sales-edit-and-cancel.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AdjustSalePaymentsDto } from '../../src/modules/sales/dto/adjust-sale-payments.dto';
import { CreateReturnDto } from '../../src/modules/returns/dto/create-return.dto';
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
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, metadata text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, half_wholesale_price numeric, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric, item_type text, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE manufacturing_boms (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, is_active boolean DEFAULT true);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100), expiry_date varchar(30), quantity numeric, unit_cost numeric, location_id integer, supplier_name varchar(150), status varchar(50), notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, shift_name text, start_odometer numeric, end_odometer numeric, distance_km numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric, stock_variance_amount numeric, stock_variance_details jsonb, night_stock_approved boolean, notes text, night_stock_approved_by bigint, night_stock_notes text, business_day date, submitted_per_day_cash jsonb, opened_at timestamptz, submitted_at timestamptz, settled_by bigint, supervisor_id bigint, closed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, delivery_status text, table_number text, customer_id bigint, customer_name text, customer_phone text, customer_address text, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, order_type text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, gps_missing_reason text, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW(), received_at timestamptz, updated_at timestamptz);
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, net_unit_price numeric, net_line_total numeric, allocated_discount numeric DEFAULT 0, allocated_tax numeric DEFAULT 0, cost_price numeric, consumer_price numeric, pricing_tier_type text, price_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, serials jsonb, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, quantity numeric, allocation_order int);
      CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, qty numeric, quantity numeric, lot_id bigint, allocation_type text, reversal_of_allocation_id bigint);
      CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, qty numeric, quantity numeric, remaining_quantity numeric, status text, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
      CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, invoice_type text, invoice_id bigint, amount numeric);
      CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points numeric, points_change numeric, balance_after numeric, action_type text, notes text, sale_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
      CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_type text, invoice_id bigint, doc_no text, total numeric DEFAULT 0, total_amount numeric DEFAULT 0, settlement_mode text, refund_method text, status text, created_at timestamptz DEFAULT NOW());
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
  } = {},
): Promise<number[]> {
  const anyDb = db as any;
  const total = opts.total ?? 1000;
  const qty = opts.qty ?? 10;
  const unitPrice = opts.unitPrice ?? 100;
  await anyDb
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
      created_by: 2,
      delivery_rep_id: 1,
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
      line_discount: 0,
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

function buildReturns(db: Kysely<Database>): { service: VanReturnsService; recordedAudit: any[] } {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const recordedAudit: any[] = [];
  const auditStub = {
    log: async (action: string, details: string) => {
      recordedAudit.push({ action, details });
    },
    logWithExecutor: async () => {},
  };
  const service = new VanReturnsService(db, posting, undefined, auditStub as never);
  return { service, recordedAudit };
}

function buildEdit(db: Kysely<Database>): { service: SalesEditAndCancelService; recordedAudit: any[] } {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const recordedAudit: any[] = [];
  const auditStub = {
    log: async (action: string, details: string) => {
      recordedAudit.push({ action, details });
    },
    logWithExecutor: async () => {},
  };
  const authz = new SalesAuthorizationService(db as never);
  const finance = new SalesFinanceService(db as never);
  const query = new SalesQueryService(db as never, authz);
  const service = new SalesEditAndCancelService({
    db: db as never,
    tx: new TransactionHelper(),
    audit: auditStub as never,
    authz,
    finance,
    query,
    accountingPosting: posting,
    planFeatureService: { hasFeature: async () => false } as never,
    logger: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {} } as never,
    assertDiscountChangeAllowed: async () => {},
    assertUnitPriceChangeAllowed: async () => {},
    getTenantSettingsMap: async () => new Map<string, any>(),
    claimSaleSerials: async () => [],
    releaseSaleSerials: async () => {},
    resolveSaleModifierCosts: async () => {},
    loadFlatAddonCosts: async () => new Map<number, number>(),
    enforceRestaurantModifierContract: async () => {},
    autoProduceShortfall: async () => {},
    deductPharmacyBatchesFefo: async () => {},
    restoreSalePharmacyBatches: async () => {},
    deductInventoryBatchesFefo: async () => {},
    restoreSaleInventoryBatches: async () => {},
    recordImportLotShortfalls: async () => {},
    getAllowNegativeStockSales: async () => false,
    buildInsufficientStockError: (async () => {
      throw new Error('unexpected stock error');
    }) as never,
    lockProductRow: async () => {},
    lockSaleStockRows: async () => {},
    getCurrentProductOffers: async () => [],
  });
  return { service, recordedAudit };
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
    moveVanInventoryBatches: async () => 0,
    deductVanSaleInventoryBatches: async () => [],
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

function editPayload(items: any[], extra: Record<string, unknown> = {}): any {
  return {
    items,
    discount: 0,
    paymentType: 'cash',
    paymentChannel: 'cash',
    customerId: 1,
    // The stock allocation needs an explicit sellable location: a
    // null eligible location skips the pool fallback and reads zero
    // availability, so the edit would fail "insufficient stock".
    locationId: 20,
    editReason: 'spec correction',
    managerPin: '',
    ...extra,
  };
}

async function main(): Promise<void> {
  // 1. No saleId is refused before any other validation, nothing
  // written; a sale of another customer and a sale of another rep
  // are refused too.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 1);
      await seedProduct(db, 101);
      const { service } = buildReturns(db);
      const [itemId] = await seedVanSale(db, 100, { tripId: 1, customerId: 1, paymentType: 'cash' });
      await expectCode(
        service.submitFieldReturn(1, TENANT, ACCOUNT, {
          tripId: 1,
          customerId: 1,
          saleId: null,
          returnReason: 'damaged',
          refundMethod: 'cash',
          items: [{ productId: 101, qty: 1, unitPrice: 100, saleItemId: itemId }],
        }),
        'RETURN_REQUIRES_SALE_ID',
      );
      await expectCode(
        service.submitFieldReturn(1, TENANT, ACCOUNT, {
          tripId: 1,
          customerId: 1,
          returnReason: 'damaged',
          refundMethod: 'cash',
          items: [{ productId: 101, qty: 1, unitPrice: 100, saleItemId: itemId }],
        }),
        'RETURN_REQUIRES_SALE_ID',
      );
      // Another customer's sale.
      const [otherItemId] = await seedVanSale(db, 105, { tripId: 1, customerId: 2, paymentType: 'cash' });
      await expectCode(
        service.submitFieldReturn(1, TENANT, ACCOUNT, {
          tripId: 1,
          customerId: 1,
          saleId: 105,
          returnReason: 'damaged',
          refundMethod: 'cash',
          items: [{ productId: 101, qty: 1, unitPrice: 100, saleItemId: otherItemId }],
        }),
        'SALE_CUSTOMER_MISMATCH',
      );
      // Another rep's sale (no trip link, so the rep resolves from
      // the sale's own delivery_rep_id).
      const [rep2ItemId] = await seedVanSale(db, 107, { tripId: null, customerId: 1, paymentType: 'cash' });
      await (db as any).updateTable('sales').set({ delivery_rep_id: 2 }).where('id', '=', 107).execute();
      await expectCode(
        service.submitFieldReturn(1, TENANT, ACCOUNT, {
          tripId: 1,
          customerId: 1,
          saleId: 107,
          returnReason: 'damaged',
          refundMethod: 'cash',
          items: [{ productId: 101, qty: 1, unitPrice: 100, saleItemId: rep2ItemId }],
        }),
        'SALE_REP_MISMATCH',
      );
      assert.equal(await countRows(db, 'van_field_returns'), 0);
      assert.equal(await countRows(db, 'journal_entries'), 0);
      assert.equal(await countRows(db, 'stock_movements'), 0);
      console.log('1. no-saleId + foreign-sale refusals, nothing written, passed');
    } finally {
      await db.destroy();
    }
  }

  // 2. Credit sale + cash refund is refused by the (now
  // unconditional) leg check; the same sale refunds as credit.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 1);
      await seedProduct(db, 101);
      const { service } = buildReturns(db);
      const [itemId] = await seedVanSale(db, 101, {
        tripId: 1,
        customerId: 1,
        paymentType: 'credit',
        paymentChannel: 'credit',
      });
      await expectCode(
        service.submitFieldReturn(1, TENANT, ACCOUNT, {
          tripId: 1,
          customerId: 1,
          saleId: 101,
          returnReason: 'customer_request',
          refundMethod: 'cash',
          items: [{ productId: 101, qty: 1, unitPrice: 100, saleItemId: itemId }],
        }),
        'REFUND_METHOD_MISMATCH',
      );
      const ok = await service.submitFieldReturn(1, TENANT, ACCOUNT, {
        tripId: 1,
        customerId: 1,
        saleId: 101,
        returnReason: 'customer_request',
        refundMethod: 'credit',
        items: [{ productId: 101, qty: 1, unitPrice: 100, saleItemId: itemId }],
      });
      assert.equal(ok.status, 'pending_approval');
      assert.equal(Number(ok.totalAmount), 100);
      assert.equal(await countRows(db, 'van_field_returns'), 1);
      console.log('2. credit sale: cash refund refused, credit refund posts, passed');
    } finally {
      await db.destroy();
    }
  }

  // 3. Split refund respects per-leg caps net of prior returns:
  // total 1000 = cash leg 600 + credit leg 400 (ledger sale_credit).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 1);
      await seedProduct(db, 101);
      const { service } = buildReturns(db);
      const [itemId] = await seedVanSale(db, 102, {
        tripId: 1,
        customerId: 1,
        paymentType: 'split',
        paymentChannel: 'mixed',
        ledgerCredit: 400,
      });
      const ret = (refundMethod: 'cash' | 'credit', qty: number) =>
        service.submitFieldReturn(1, TENANT, ACCOUNT, {
          tripId: 1,
          customerId: 1,
          saleId: 102,
          returnReason: 'customer_request',
          refundMethod,
          items: [{ productId: 101, qty, unitPrice: 100, saleItemId: itemId }],
        });
      await expectCode(ret('cash', 7), 'REFUND_METHOD_MISMATCH');
      await ret('cash', 3);
      await expectCode(ret('cash', 4), 'REFUND_METHOD_MISMATCH');
      await ret('credit', 3);
      await expectCode(ret('credit', 4), 'REFUND_METHOD_MISMATCH');
      assert.equal(await countRows(db, 'van_field_returns'), 2);
      console.log('3. split per-leg caps net of prior returns, passed');
    } finally {
      await db.destroy();
    }
  }

  // 4. An edit leaves sale_payments byte-identical (same ids,
  // amounts, channels, tendered, change) even when the total moves
  // 1000 -> 1200; the sale row keeps the stored paid amount.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101);
      const { service } = buildEdit(db);
      await seedVanSale(db, 200, {
        tripId: null,
        customerId: 1,
        paymentType: 'cash',
        paymentChannel: 'cash',
        total: 1000,
        paidAmount: 1000,
        legs: [{ channel: 'cash', amount: 1000 }],
      });
      const before = await legs(db, 200);
      assert.equal(before.length, 1);
      await service.updateSale(
        200,
        editPayload([
          { productId: 101, qty: 12, price: 100, unitName: 'piece', unitMultiplier: 1, priceType: 'retail' },
        ]),
        ADMIN as never,
      );
      const after = await legs(db, 200);
      assert.deepEqual(after, before);
      const sale = await saleRow(db, 200);
      assert.equal(Number(sale.total), 1200);
      assert.equal(Number(sale.paid_amount), 1000);
      // The edit leaves the sale underpaid (1200 total, 1000 paid)
      // with a customer, so the unchanged isPartialCredit rule flips
      // the TYPE to 'credit' — the receivable absorbs the 200 — while
      // the CHANNEL stays the stored leg's channel ('cash').
      assert.equal(sale.payment_type, 'credit');
      assert.equal(sale.payment_channel, 'cash');
      const edits = await journals(db, 'sale_edit', 200);
      assert.equal(edits.length, 1);
      const lines = await journalLines(db, Number(edits[0].id));
      const debit = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      assert.equal(debit, credit);
      assert.ok(debit > 0);
      console.log('4. edit leaves legs byte-identical, passed');
    } finally {
      await db.destroy();
    }
  }

  // 5. An edit that restates the total BELOW the stored legs is
  // refused (overpaid legs would unbalance the journal) and writes
  // nothing.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101);
      const { service } = buildEdit(db);
      await seedVanSale(db, 201, {
        tripId: null,
        customerId: 1,
        paymentType: 'cash',
        paymentChannel: 'cash',
        total: 1000,
        paidAmount: 1000,
        legs: [{ channel: 'cash', amount: 1000 }],
      });
      await expectCode(
        service.updateSale(
          201,
          editPayload([
            { productId: 101, qty: 8, price: 100, unitName: 'piece', unitMultiplier: 1, priceType: 'retail' },
          ]),
          ADMIN as never,
        ),
        'SALE_EDIT_OVERPAID_LEGS',
      );
      const sale = await saleRow(db, 201);
      assert.equal(Number(sale.total), 1000);
      const after = await legs(db, 201);
      assert.equal(after.length, 1);
      assert.equal(Number(after[0].amount), 1000);
      assert.equal((await journals(db, 'sale_edit', 201)).length, 0);
      console.log('5. overpaid-legs edit refused, nothing written, passed');
    } finally {
      await db.destroy();
    }
  }

  // 6. The adjustment endpoint: PIN + reason gates, legs replaced,
  // reversing journal + new sale_edit journal, audit-logged;
  // overpaid legs refused; one money edit per sale (a later
  // updateSale AND a second adjustment are both refused).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101);
      await seedPin(db, '4321');
      const { service, recordedAudit } = buildEdit(db);
      await seedVanSale(db, 210, {
        tripId: null,
        customerId: 1,
        paymentType: 'cash',
        paymentChannel: 'cash',
        total: 1000,
        paidAmount: 1000,
        legs: [{ channel: 'cash', amount: 1000 }],
      });
      const adjust = (payload: Partial<AdjustSalePaymentsDto>, auth: any) =>
        service.adjustSalePayments(210, payload as AdjustSalePaymentsDto, auth);
      await expectCode(
        adjust({ payments: [{ paymentChannel: 'card', amount: 1000 }], reason: 'card instead of cash' }, CASHIER),
        'MANAGER_AUTH_REQUIRED',
      );
      await expectCode(
        adjust({ payments: [{ paymentChannel: 'card', amount: 1000 }], reason: '' }, CASHIER),
        'PAYMENT_ADJUSTMENT_REASON_REQUIRED',
      );
      await expectCode(
        adjust(
          { payments: [{ paymentChannel: 'card', amount: 1000 }], reason: 'card instead of cash', managerPin: '0000' },
          CASHIER,
        ),
        'MANAGER_AUTH_INVALID',
      );
      const res = (await adjust(
        { payments: [{ paymentChannel: 'card', amount: 1000 }], reason: 'card instead of cash', managerPin: '4321' },
        CASHIER,
      )) as any;
      assert.equal(res.ok, true);
      assert.equal(Number(res.remainingReceivable), 0);
      const after = await legs(db, 210);
      assert.equal(after.length, 1);
      assert.equal(after[0].payment_channel, 'card');
      assert.equal(Number(after[0].amount), 1000);
      assert.equal(Number(after[0].tendered_amount), 1000);
      assert.equal(Number(after[0].change_amount), 0);
      const sale = await saleRow(db, 210);
      assert.equal(Number(sale.paid_amount), 1000);
      assert.equal(sale.payment_type, 'cash');
      assert.equal(sale.payment_channel, 'card');
      // No reversal (there was no prior journal) + exactly one
      // sale_edit journal, balanced.
      assert.equal((await journals(db, 'sale_reversal', 210)).length, 0);
      const edits = await journals(db, 'sale_edit', 210);
      assert.equal(edits.length, 1);
      const lines = await journalLines(db, Number(edits[0].id));
      const debit = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      assert.equal(debit, credit);
      assert.ok(debit > 0);
      // The old cash leg was reversed in treasury; no new cash leg.
      const treasury = await (db as any)
        .selectFrom('treasury_transactions')
        .selectAll()
        .where('tenant_id', '=', TENANT)
        .where('reference_id', '=', 210)
        .execute();
      assert.ok(treasury.some((t: any) => Number(t.amount) === -1000));
      assert.ok(!treasury.some((t: any) => Number(t.amount) === 1000));
      // Audit-logged with reason + actor after commit.
      assert.ok(recordedAudit.some((a: any) => String(a.action || '').includes('تعديل دفعات')));
      // One money edit per sale: a later item edit is refused...
      await expectCode(
        service.updateSale(
          210,
          editPayload([
            { productId: 101, qty: 11, price: 100, unitName: 'piece', unitMultiplier: 1, priceType: 'retail' },
          ]),
          ADMIN as never,
        ),
        'SALE_EDIT_ALREADY_APPLIED',
      );
      // ...and so is a second adjustment.
      await expectCode(
        adjust(
          { payments: [{ paymentChannel: 'cash', amount: 1000 }], reason: 'back to cash', managerPin: '4321' },
          CASHIER,
        ),
        'SALE_EDIT_ALREADY_APPLIED',
      );
      // Overpaid legs on a fresh sale are refused, legs untouched.
      await seedVanSale(db, 211, {
        tripId: null,
        customerId: 1,
        paymentType: 'cash',
        paymentChannel: 'cash',
        total: 1000,
        paidAmount: 1000,
        legs: [{ channel: 'cash', amount: 1000 }],
      });
      await expectCode(
        service.adjustSalePayments(
          211,
          {
            payments: [
              { paymentChannel: 'cash', amount: 600 },
              { paymentChannel: 'card', amount: 500 },
            ],
            reason: 'overpaid legs',
          } as AdjustSalePaymentsDto,
          ADMIN as never,
        ),
        'SALE_PAYMENT_ADJUSTMENT_OVERPAID',
      );
      const legs211 = await legs(db, 211);
      assert.equal(legs211.length, 1);
      assert.equal(Number(legs211[0].amount), 1000);
      console.log('6. adjustment gates + success + audit + one-edit rule, passed');
    } finally {
      await db.destroy();
    }
  }

  // 7. F7: a damaged return on a credit sale approves into the
  // damaged location and posts a journal (Dr revenue, Cr receivable,
  // COGS reversal Dr 1140 / Cr 5100) — and NO 5300 write-off leg.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db, 1);
      await seedProduct(db, 101);
      const { service } = buildReturns(db);
      const [itemId] = await seedVanSale(db, 103, {
        tripId: 1,
        customerId: 1,
        paymentType: 'credit',
        paymentChannel: 'credit',
      });
      const submitted = await service.submitFieldReturn(1, TENANT, ACCOUNT, {
        tripId: 1,
        customerId: 1,
        saleId: 103,
        returnReason: 'damaged',
        refundMethod: 'credit',
        items: [{ productId: 101, qty: 2, unitPrice: 100, saleItemId: itemId }],
      });
      await service.approveFieldReturn(TENANT, ACCOUNT, Number(submitted.returnId), 2);
      const ret = await returnRow(db, Number(submitted.returnId));
      assert.equal(ret.status, 'approved');
      const damagedStock = await (db as any)
        .selectFrom('product_location_stock')
        .selectAll()
        .where('tenant_id', '=', TENANT)
        .where('product_id', '=', 101)
        .where('location_id', '=', 30)
        .executeTakeFirst();
      assert.ok(damagedStock, 'damaged location should hold the restocked qty');
      assert.equal(Number(damagedStock.qty), 2);
      const entries = await journals(db, 'van_field_return', Number(submitted.returnId));
      assert.equal(entries.length, 1);
      const lines = await journalLines(db, Number(entries[0].id));
      const debit = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const credit = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      assert.equal(debit, credit);
      assert.ok(
        lines.some((l: any) => Number(l.location_id) === 30),
        'journal lines must be tagged with the damaged location',
      );
      assert.equal(lineFor(lines, 4100).debit, 200);
      assert.equal(lineFor(lines, 1130).credit, 200);
      assert.equal(lineFor(lines, 1140).debit, 100);
      assert.equal(lineFor(lines, 5100).credit, 100);
      assert.ok(!lines.some((l: any) => Number(l.account_id) === 5300), 'no automatic damaged write-off leg');
      console.log('7. damaged return: damaged location + journal, no 5300 leg, passed');
    } finally {
      await db.destroy();
    }
  }

  // 8. The orphan evidence spec is wired into BOTH critical lists,
  // in identical order (377 specs — P8 wired the date-filter spec, P9 wired the FEFO spec, file #11 wired 6 marketplace specs, P10 wired the feature-overrides spec, F2 wired the POS collection-balance-cap spec, F5 wired the shift-close-password-identity spec, F19 wired the final-issue-paired-movement spec, F7 wired the pos-sale-trip-attribution spec, F7c wired the pos-collection-trip-attribution spec, F3 wired the van-route-sale-gate spec, F8 wired the pos-cash-discount spec, F4 wired the customer-phone-validation spec, F9 wired the pos-van-stock-pool spec, F10 wired the van-load-available-qty spec, F12 wired the van-admin-permission-split spec, F13 wired the reports-discount-profit spec, F18 wired the van-presales-consolidate-delivery-rep-alias spec and the van-presales-order-details-line-total spec, F20 wired the van-portal-sale-rep-attribution-f20 spec, A8 wired the purchases-writer spec, A10 wired the three phase1-a10 specs, B1 wired the phase1-b1-reports-sales spec, B2 wired the phase1-b2-sales-settings spec, B3 wired the phase1-b3-sales-storefront spec, B4 wired the phase1-b4-accounting-hr spec, B5 wired the phase1-b5-accounting-manufacturing spec, B6 wired the phase1-b6-accounting-purchases spec, B7 wired the phase1-b7-returns-sales spec).
  {
    const specDir = __dirname;
    const jsonPath = path.join(specDir, '..', '..', 'scripts', 'critical-specs.json');
    const pkgPath = path.join(specDir, '..', '..', 'package.json');
    const list = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).specs as string[];
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const chain = String(pkg.scripts['test:critical:serial'])
      .split(' && ')
      .map((x) => x.replace(/^ts-node /, ''));
    assert.equal(list.length, 405);
    assert.equal(chain.length, 405);
    assert.deepEqual(list, chain);
    assert.ok(list.includes('test/critical/van-field-noncash-evidence.spec.ts'));
    const idx = list.indexOf('test/critical/van-field-noncash-evidence.spec.ts');
    assert.equal(list[idx - 1], 'test/critical/van-field-sale-wholesale-price.spec.ts');
    console.log('8. evidence spec wired into both critical lists (377 = 377, identical order), passed');
  }

  // 9. Regressions: (a) a main return without invoiceId is refused
  // by the real DTO validation; (b) cancelling a sale with a later
  // payment allocation is refused; (c) P1's getTripDueByDay still
  // tolerates an old approved cash return with sale_id NULL.
  {
    // (a) Pure DTO validation, no DB.
    const dto = plainToInstance(CreateReturnDto, {
      type: 'sale',
      items: [{ productId: 101, qty: 1 }],
    });
    const errors = await validate(dto);
    assert.ok(
      errors.some((e: any) => e.property === 'invoiceId'),
      'invoiceId must be a validation error',
    );
    const valid = plainToInstance(CreateReturnDto, {
      type: 'sale',
      invoiceId: 5,
      items: [{ productId: 101, qty: 1 }],
    });
    assert.equal((await validate(valid)).length, 0);

    // (b) Cancel with a later payment allocation.
    {
      const { pg, db } = await makeDb();
      try {
        await seedFoundation(db);
        await seedProduct(db, 101);
        const { service } = buildEdit(db);
        await seedVanSale(db, 220, {
          tripId: null,
          customerId: 1,
          paymentType: 'cash',
          paymentChannel: 'cash',
          total: 1000,
          paidAmount: 1000,
          legs: [{ channel: 'cash', amount: 1000 }],
        });
        await (db as any)
          .insertInto('payment_allocations')
          .values({
            tenant_id: TENANT,
            account_id: ACCOUNT,
            invoice_type: 'sale',
            invoice_id: 220,
            amount: 500,
          })
          .execute();
        await expectCode(service.cancelSale(220, 'test cancel', '', ADMIN as never), 'SALE_CANCEL_HAS_LATER_PAYMENTS');
        assert.equal((await saleRow(db, 220)).status, 'posted');
        console.log('9a/9b. DTO invoiceId + cancel-with-later-payments refusals, passed');
      } finally {
        await db.destroy();
      }
    }

    // (c) Legacy NULL-sale_id return still reduces the trip due.
    {
      const { pg, db } = await makeDb();
      try {
        await seedFoundation(db);
        await seedTrip(db, 10, { cashCollected: 800, businessDay: D1 });
        await seedCashSaleForDue(db, 22, 10, 1000, '2026-11-09T10:00:00+02:00');
        await seedLegacyCashRefund(db, 31, 10, 200, '2026-11-09T16:00:00+02:00');
        const lifecycle = buildLifecycle(db);
        const due = await lifecycle.getTripDueByDay(1, TENANT, 10);
        assert.equal(due.days.length, 1);
        assert.equal(due.days[0].due, 800);
        console.log('9c. legacy NULL-sale_id return still reduces the trip due, passed');
      } finally {
        await db.destroy();
      }
    }
  }

  console.log('ALL VAN RETURN LINKAGE + PAYMENT LOCK CASES PASSED');
}

main()
  .then(async () => {
    console.log('van-return-linkage-payment-lock: all cases passed');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
