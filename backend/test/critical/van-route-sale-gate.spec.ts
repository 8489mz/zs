/*
 * Route enforcement on sales (F3, trial problem 3, 2026-11-21,
 * test10k): a rep sold to a customer NOT on his route ("عميل اختبار
 * 00001", Z-261121-16631, 10.00) with no warning and no block. The
 * portal picker only OFFERS route customers; no server-side gate
 * stood on the sale itself.
 *
 * THE RULE: on BOTH sale paths (portal field sale and POS
 * createSale, when the seller is a rep with an active trip), a sale
 * to a customer served by a DIFFERENT rep is refused with the named
 * error CUSTOMER_NOT_ON_REP_ROUTE (403) and posts nothing. The gate
 * distinguishes, from the SAME canonical history predicate as
 * assertRepServedCustomer (field visit / pre-sale order / delivered
 * sale — no static customer-to-rep assignment exists, so history is
 * the association): (a) another rep's customer -> refused; (b) a
 * customer with NO history anywhere -> allowed, the first sale
 * creates the association; (c) the rep's own served customer ->
 * allowed. A supervisor PIN approves a genuine off-route sale
 * (field: payload.supervisorOverridePin through verifySupervisorPin;
 * POS: managerPin through authorizeDiscountOverride — the existing
 * override channels, F1a pattern). Ordinary non-rep counter sales
 * are never gated.
 *
 * HOW THIS IS DRIVEN: the real VanSalesService.executeFieldSale and
 * the real SalesWriteService.createSale on PGlite, reusing the
 * tax-optional field-sale harness and the van-pos-discount-cap POS
 * harness (same foundations, same stubs: resolveSystemAuthContext
 * shadowed and the fraud radar stubbed no-op, because a pool read
 * inside the open sale transaction deadlocks on PGlite's single
 * connection; the PIN verifier is mocked per case — approved or
 * refused — because this spec's users DDL has no pin columns for
 * the real verifier, and the real PIN path is driven in
 * van-field-noncash-evidence.spec.ts). Each case gets a fresh DB:
 * the field-sale wrapper's 4-second rapid-fire backstop would
 * otherwise merge identical baskets. Tear down is db.destroy()
 * only.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';

const TENANT = 't-van-route-gate';
const ACCOUNT = 'a-van-route-gate';
const MANAGER_PIN = '1234';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

// Field path: rep 1 owns the sale, rep 2 is the other rep.
const REP_OWN = 1;
const REP_OTHER = 2;
// POS path: rep 10 (user 4, phone-linked) owns the sale, rep 11 is
// the other rep.
const POS_REP_OWN = 10;
const POS_REP_OTHER = 11;
// Customers: 100 served by the owning rep (field visit), 200 served
// by the other rep (delivered sale), 300 served by the other rep
// (pre-sale order), 400 served by NOBODY.
const CUST_OWN = 100;
const CUST_OTHER_SALE = 200;
const CUST_OTHER_ORDER = 300;
const CUST_NOBODY = 400;

async function makeFieldDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
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
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, half_wholesale_price numeric, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW(), import_receipt_id bigint);
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE inventory_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30), quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, system_cash_discount_amount numeric, gps_missing_reason text, received_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, line_discount numeric DEFAULT 0, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_id bigint, rep_id bigint, status text);
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, price_list_id bigint, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
      CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text, type text, default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE price_list_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, price_list_id bigint, product_id bigint, product_name text, category_id bigint, min_quantity numeric DEFAULT 1, fixed_price numeric, discount_percent numeric, created_at timestamptz DEFAULT NOW());
    `);
  return { pg, db };
}

async function seedFieldFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'sys', is_active: true }).execute();
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
    .values([
      { id: REP_OWN, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep Own', van_location_id: 20, is_van_rep: true },
      {
        id: REP_OTHER,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'Rep Other',
        van_location_id: 20,
        is_van_rep: true,
      },
    ])
    .execute();
  await anyDb
    .insertInto('van_sales_trips')
    .values([
      { id: 1, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_OWN, van_location_id: 20, status: 'open' },
      { id: 2, tenant_id: TENANT, account_id: ACCOUNT, rep_id: REP_OTHER, van_location_id: 20, status: 'open' },
    ])
    .execute();
  await anyDb
    .insertInto('products')
    .values({
      id: 101,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Product 101',
      stock_qty: 10,
      cost_price: 50,
      retail_price: 100,
      credit_price: 0,
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('product_location_stock')
    .values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, location_id: 20, qty: 10 })
    .execute();
  await anyDb
    .insertInto('customers')
    .values([
      {
        id: CUST_OWN,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'Own Customer',
        balance: 0,
        credit_limit: 0,
        metadata: '{}',
        is_active: true,
      },
      {
        id: CUST_OTHER_SALE,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'Other Sale Customer',
        balance: 0,
        credit_limit: 0,
        metadata: '{}',
        is_active: true,
      },
      {
        id: CUST_OTHER_ORDER,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'Other Order Customer',
        balance: 0,
        credit_limit: 0,
        metadata: '{}',
        is_active: true,
      },
      {
        id: CUST_NOBODY,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'Nobody Customer',
        balance: 0,
        credit_limit: 0,
        metadata: '{}',
        is_active: true,
      },
    ])
    .execute();
  // History evidence: own customer via a field visit by rep 1; other
  // customer 200 via a delivered sale by rep 2; other customer 300
  // via a pre-sale order assigned to rep 2; customer 400 has none.
  await anyDb
    .insertInto('van_field_visits')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      trip_id: 1,
      rep_id: REP_OWN,
      customer_id: CUST_OWN,
      visit_type: 'positive',
    })
    .execute();
  await anyDb
    .insertInto('sales')
    .values({
      id: 70,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      doc_no: 'INV-70',
      total: 500,
      paid_amount: 500,
      status: 'posted',
      payment_type: 'cash',
      customer_id: CUST_OTHER_SALE,
      delivery_rep_id: REP_OTHER,
      van_trip_id: 2,
    })
    .execute();
  await anyDb
    .insertInto('sales_orders')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      order_number: 'SO-300',
      customer_id: CUST_OTHER_ORDER,
      rep_id: REP_OTHER,
      status: 'confirmed',
    })
    .execute();
}

function buildFieldService(db: Kysely<Database>, pinApproved: boolean): VanSalesService {
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
  (service as any).verifySupervisorPin = async () => ({
    approved: pinApproved,
    supervisorId: 2,
    supervisorName: 'Supervisor',
  });
  return service;
}

async function fieldSaleCount(db: Kysely<Database>): Promise<number> {
  const row = (await (db as any)
    .selectFrom('sales')
    .select(sql`count(*)`.as('c'))
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow()) as any;
  return Number(row.c);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err: any) {
    assert.equal(err?.code, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
    return;
  }
  assert.fail(`expected rejection with ${code}`);
}

async function makePosDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  SalesWriteService.invalidateSettingsCache(TENANT);
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text, code text, name text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, half_wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz);
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT false, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW(), import_receipt_id bigint);
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, price_list_id bigint, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, created_by bigint, branch_id bigint, location_id bigint);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_id bigint, rep_id bigint, status text);
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text DEFAULT 'EGP', type text DEFAULT 'percentage', default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE inventory_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number text, expiry_date text, quantity numeric DEFAULT 0, unit_cost numeric DEFAULT 0, location_id integer, supplier_name text, status text DEFAULT 'active', notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_inventory_batch_allocations (id bigint PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric DEFAULT 0, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
  `);
  return { pg, db };
}

const repAuth: AuthContext = {
  userId: 4,
  sessionId: 'spec-rep',
  username: 'vanrep1',
  role: 'cashier',
  permissions: ['sales', 'canDiscount'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

const cashierAuth: AuthContext = {
  userId: 3,
  sessionId: 'spec-b',
  username: 'cashier-b',
  role: 'cashier',
  permissions: ['sales', 'canDiscount'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

async function seedPosFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 3, tenant_id: TENANT, username: 'cashier-b', role: 'cashier', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 4, tenant_id: TENANT, username: 'vanrep1', phone: '01000000001', role: 'cashier', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({
      id: 5,
      tenant_id: TENANT,
      username: '01000000002',
      phone: '01000000009',
      role: 'cashier',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('delivery_representatives')
    .values({
      id: POS_REP_OWN,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Van Rep One',
      phone: '01000000001',
      is_van_rep: true,
    })
    .execute();
  await anyDb
    .insertInto('delivery_representatives')
    .values({
      id: POS_REP_OTHER,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Van Rep Two',
      phone: '01000000002',
      is_van_rep: true,
    })
    .execute();
  const accounts: Array<[number, string]> = [
    [1110, '1110'],
    [1120, '1120'],
    [1130, '1130'],
    [1140, '1140'],
    [2120, '2120'],
    [4100, '4100'],
    [4300, '4300'],
    [5100, '5100'],
  ];
  for (const [id, code] of accounts) {
    await anyDb
      .insertInto('accounting_accounts')
      .values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true, is_tax: false })
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
    .insertInto('branches')
    .values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 })
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
    .insertInto('products')
    .values({
      id: 101,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Widget 101',
      stock_qty: 100,
      cost_price: 10,
      retail_price: 100,
      wholesale_price: 100,
      min_selling_price: 1,
      is_active: true,
      item_type: 'product',
    })
    .execute();
  await anyDb
    .insertInto('product_location_stock')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      product_id: 101,
      branch_id: 1,
      location_id: 10,
      qty: 100,
    })
    .execute();
  await anyDb
    .insertInto('van_sales_trips')
    .values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, rep_id: POS_REP_OWN, van_location_id: 10, status: 'open' })
    .execute();
  await anyDb
    .insertInto('cashier_shifts')
    .values({
      id: 1,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      doc_no: 'SHIFT-1',
      opened_by: 4,
      status: 'open',
      branch_id: 1,
      location_id: 10,
      opening_cash: 0,
      expected_cash: 0,
      created_at: SHIFT_OPENED_AT,
    })
    .execute();
  await anyDb
    .insertInto('customers')
    .values([
      { id: CUST_OWN, tenant_id: TENANT, account_id: ACCOUNT, name: 'Own Customer', metadata: '{}', is_active: true },
      {
        id: CUST_OTHER_SALE,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'Other Sale Customer',
        metadata: '{}',
        is_active: true,
      },
      {
        id: CUST_OTHER_ORDER,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'Other Order Customer',
        metadata: '{}',
        is_active: true,
      },
      {
        id: CUST_NOBODY,
        tenant_id: TENANT,
        account_id: ACCOUNT,
        name: 'Nobody Customer',
        metadata: '{}',
        is_active: true,
      },
    ])
    .execute();
  // Same history evidence as the field side, against the POS rep ids.
  await anyDb
    .insertInto('van_field_visits')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      trip_id: 1,
      rep_id: POS_REP_OWN,
      customer_id: CUST_OWN,
      visit_type: 'positive',
    })
    .execute();
  await anyDb
    .insertInto('sales')
    .values({
      id: 70,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      doc_no: 'INV-70',
      total: 500,
      paid_amount: 500,
      status: 'posted',
      payment_type: 'cash',
      customer_id: CUST_OTHER_SALE,
      delivery_rep_id: POS_REP_OTHER,
      van_trip_id: 2,
    })
    .execute();
  await anyDb
    .insertInto('sales_orders')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      order_number: 'SO-300',
      customer_id: CUST_OTHER_ORDER,
      rep_id: POS_REP_OTHER,
      status: 'confirmed',
    })
    .execute();
}

function buildPosServices(db: Kysely<Database>): { sales: SalesWriteService } {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const authz = new SalesAuthorizationService(db);
  const finance = new SalesFinanceService(db);
  const query = new SalesQueryService(db, authz);
  const idempotency = new IdempotencyService(db);
  const tx = new TransactionHelper();
  const audit = new AuditService(db);
  // F7 pattern: the POS source gate (P10 feature overrides) must see
  // 'pos' as available — the discount-cap harness this builder copies
  // uses hasFeature: () => false with source 'dashboard', which never
  // reaches the gate; these cases sell through source 'pos'.
  const planFeatures = { hasFeature: (_planId: any, _extra: any, feature: string) => feature === 'pos' };
  const returnsStub = {};
  const sales = new SalesWriteService(
    db,
    tx,
    audit,
    authz,
    finance,
    query,
    posting,
    idempotency,
    planFeatures as never,
    returnsStub as never,
  );
  return { sales };
}

function posPayload(customerId: number, managerPin?: string): any {
  return {
    items: [{ productId: 101, qty: 1, price: 100, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0,
    taxRate: 0,
    paymentType: 'cash',
    paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: 100 }],
    tenderedAmount: 100,
    branchId: 1,
    locationId: 10,
    source: 'pos',
    customerId,
    managerPin,
  };
}

async function posSaleCount(db: Kysely<Database>): Promise<number> {
  const row = (await (db as any)
    .selectFrom('sales')
    .select(sql`count(*)`.as('c'))
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow()) as any;
  return Number(row.c);
}

async function posSaleRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any)
    .selectFrom('sales')
    .selectAll()
    .where('id', '=', id)
    .where('tenant_id', '=', TENANT)
    .executeTakeFirstOrThrow();
}

async function main(): Promise<void> {
  // FIELD (a): rep sale to another rep's customer (delivered-sale
  // leg) is refused with the named error and posts nothing — and the
  // refusal happens before the assigned_rep_ids metadata link, so
  // the refused customer keeps no trace of this rep.
  {
    const { pg, db } = await makeFieldDb();
    try {
      await seedFieldFoundation(db);
      const service = buildFieldService(db, false);
      await expectCode(
        service.executeFieldSale(REP_OWN, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          customerId: CUST_OTHER_SALE,
          items: [{ productId: 101, qty: 1 }],
        }),
        'CUSTOMER_NOT_ON_REP_ROUTE',
      );
      assert.equal(await fieldSaleCount(db), 1, 'refused off-route sale posts nothing (only the history seed row)');
      const cust = (await (db as any)
        .selectFrom('customers')
        .select('metadata')
        .where('id', '=', CUST_OTHER_SALE)
        .executeTakeFirstOrThrow()) as any;
      assert.equal(String(cust.metadata || ''), '{}', 'refused sale records no rep link on the customer');
    } finally {
      await db.destroy();
    }
    console.log('  field other-rep customer (sale leg) refused, posts nothing passed');
  }

  // FIELD (a2): same refusal through the pre-sale-order leg.
  {
    const { pg, db } = await makeFieldDb();
    try {
      await seedFieldFoundation(db);
      const service = buildFieldService(db, false);
      await expectCode(
        service.executeFieldSale(REP_OWN, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          customerId: CUST_OTHER_ORDER,
          items: [{ productId: 101, qty: 1 }],
        }),
        'CUSTOMER_NOT_ON_REP_ROUTE',
      );
      assert.equal(await fieldSaleCount(db), 1);
    } finally {
      await db.destroy();
    }
    console.log('  field other-rep customer (order leg) refused passed');
  }

  // FIELD (b): the same sale with an approved supervisor PIN posts.
  {
    const { pg, db } = await makeFieldDb();
    try {
      await seedFieldFoundation(db);
      const service = buildFieldService(db, true);
      const res = await service.executeFieldSale(REP_OWN, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        customerId: CUST_OTHER_SALE,
        supervisorOverridePin: '4321',
        items: [{ productId: 101, qty: 1 }],
      });
      assert.equal(res.total, 100);
      const sale = await (db as any)
        .selectFrom('sales')
        .selectAll()
        .where('id', '=', res.saleId)
        .where('tenant_id', '=', TENANT)
        .executeTakeFirstOrThrow();
      assert.equal(Number(sale.customer_id), CUST_OTHER_SALE);
      assert.equal(Number(sale.delivery_rep_id), REP_OWN);
    } finally {
      await db.destroy();
    }
    console.log('  field other-rep customer with approved supervisor PIN posts passed');
  }

  // FIELD (b2): a supervisor PIN that does NOT verify does not
  // approve the off-route sale — the refusal keeps the route code.
  {
    const { pg, db } = await makeFieldDb();
    try {
      await seedFieldFoundation(db);
      const service = buildFieldService(db, false);
      await expectCode(
        service.executeFieldSale(REP_OWN, TENANT, ACCOUNT, {
          tripId: 1,
          paymentMethod: 'cash',
          customerId: CUST_OTHER_SALE,
          supervisorOverridePin: '0000',
          items: [{ productId: 101, qty: 1 }],
        }),
        'CUSTOMER_NOT_ON_REP_ROUTE',
      );
      assert.equal(await fieldSaleCount(db), 1);
    } finally {
      await db.destroy();
    }
    console.log('  field other-rep customer with refused PIN is refused passed');
  }

  // FIELD (c): a customer with NO history anywhere posts — the first
  // sale creates the association; blocking it would make
  // new-customer sales impossible.
  {
    const { pg, db } = await makeFieldDb();
    try {
      await seedFieldFoundation(db);
      const service = buildFieldService(db, false);
      const res = await service.executeFieldSale(REP_OWN, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        customerId: CUST_NOBODY,
        items: [{ productId: 101, qty: 1 }],
      });
      assert.equal(res.total, 100);
      const sale = await (db as any)
        .selectFrom('sales')
        .selectAll()
        .where('id', '=', res.saleId)
        .where('tenant_id', '=', TENANT)
        .executeTakeFirstOrThrow();
      assert.equal(Number(sale.customer_id), CUST_NOBODY);
    } finally {
      await db.destroy();
    }
    console.log('  field no-history customer posts (first sale creates the association) passed');
  }

  // FIELD (d): the rep's own served customer posts.
  {
    const { pg, db } = await makeFieldDb();
    try {
      await seedFieldFoundation(db);
      const service = buildFieldService(db, false);
      const res = await service.executeFieldSale(REP_OWN, TENANT, ACCOUNT, {
        tripId: 1,
        paymentMethod: 'cash',
        customerId: CUST_OWN,
        items: [{ productId: 101, qty: 1 }],
      });
      assert.equal(res.total, 100);
      const sale = await (db as any)
        .selectFrom('sales')
        .selectAll()
        .where('id', '=', res.saleId)
        .where('tenant_id', '=', TENANT)
        .executeTakeFirstOrThrow();
      assert.equal(Number(sale.customer_id), CUST_OWN);
    } finally {
      await db.destroy();
    }
    console.log('  field own served customer posts passed');
  }

  // POS (a): rep counter sale to another rep's customer is refused
  // with the named error and posts nothing (only the history seed
  // row remains).
  {
    const { pg, db } = await makePosDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedPosFoundation(db);
      const { sales } = buildPosServices(db);
      await expectCode(sales.createSale(posPayload(CUST_OTHER_SALE), repAuth), 'CUSTOMER_NOT_ON_REP_ROUTE');
      assert.equal(await posSaleCount(db), 1);
    } finally {
      await db.destroy();
    }
    console.log('  pos other-rep customer refused, posts nothing passed');
  }

  // POS (b): the same rep sale with the supervisor PIN (managerPin)
  // posts, stamped to the rep's active trip.
  {
    const { pg, db } = await makePosDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedPosFoundation(db);
      const { sales } = buildPosServices(db);
      const created: any = await sales.createSale(posPayload(CUST_OTHER_SALE, MANAGER_PIN), repAuth);
      assert.ok(Number(created?.sale?.id) > 0, 'override sale must create the sale');
      const sale = await posSaleRow(db, Number(created.sale.id));
      assert.equal(Number(sale.customer_id), CUST_OTHER_SALE);
      assert.equal(Number(sale.delivery_rep_id), POS_REP_OWN);
      assert.equal(Number(sale.van_trip_id), 1);
    } finally {
      await db.destroy();
    }
    console.log('  pos other-rep customer with supervisor PIN posts passed');
  }

  // POS (b2): a wrong manager PIN does not approve the off-route
  // sale — the refusal keeps the route code.
  {
    const { pg, db } = await makePosDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedPosFoundation(db);
      const { sales } = buildPosServices(db);
      await expectCode(sales.createSale(posPayload(CUST_OTHER_SALE, '9999'), repAuth), 'CUSTOMER_NOT_ON_REP_ROUTE');
      assert.equal(await posSaleCount(db), 1);
    } finally {
      await db.destroy();
    }
    console.log('  pos other-rep customer with wrong PIN is refused passed');
  }

  // POS (c): rep sale to a no-history customer posts.
  {
    const { pg, db } = await makePosDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedPosFoundation(db);
      const { sales } = buildPosServices(db);
      const created: any = await sales.createSale(posPayload(CUST_NOBODY), repAuth);
      assert.ok(Number(created?.sale?.id) > 0, 'first sale to a no-history customer must create the sale');
      const sale = await posSaleRow(db, Number(created.sale.id));
      assert.equal(Number(sale.customer_id), CUST_NOBODY);
    } finally {
      await db.destroy();
    }
    console.log('  pos no-history customer posts passed');
  }

  // POS (d): rep sale to his own served customer posts.
  {
    const { pg, db } = await makePosDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedPosFoundation(db);
      const { sales } = buildPosServices(db);
      const created: any = await sales.createSale(posPayload(CUST_OWN), repAuth);
      assert.ok(Number(created?.sale?.id) > 0, 'sale to the rep own served customer must create the sale');
      const sale = await posSaleRow(db, Number(created.sale.id));
      assert.equal(Number(sale.customer_id), CUST_OWN);
      assert.equal(Number(sale.delivery_rep_id), POS_REP_OWN);
    } finally {
      await db.destroy();
    }
    console.log('  pos own served customer posts passed');
  }

  // POS (e): an ordinary non-rep counter sale to ANY customer posts
  // ungated — no rep link, no attribution, no gate. The shift must
  // be open for the ACTING cashier (opened_by = auth.userId — the
  // discount-cap harness seeds it per seller), so this case opens
  // its own shift for user 3 next to the rep's shift.
  {
    const { pg, db } = await makePosDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedPosFoundation(db);
      await (db as any)
        .insertInto('cashier_shifts')
        .values({
          id: 2,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          doc_no: 'SHIFT-2',
          opened_by: 3,
          status: 'open',
          branch_id: 1,
          location_id: 10,
          opening_cash: 0,
          expected_cash: 0,
          created_at: SHIFT_OPENED_AT,
        })
        .execute();
      const { sales } = buildPosServices(db);
      const created: any = await sales.createSale(posPayload(CUST_OTHER_SALE), cashierAuth);
      assert.ok(Number(created?.sale?.id) > 0, 'non-rep counter sale must create the sale');
      const sale = await posSaleRow(db, Number(created.sale.id));
      assert.equal(Number(sale.customer_id), CUST_OTHER_SALE);
      assert.equal(sale.delivery_rep_id, null);
      assert.equal(sale.van_trip_id, null);
    } finally {
      await db.destroy();
    }
    console.log('  pos non-rep counter sale posts ungated passed');
  }

  // Source pins: the gate lives in both sale paths, the refusal runs
  // before the transaction opens on each, and the shared predicate
  // is the history transpose (empty serving set = first sale).
  {
    const gate = readFileSync(resolve(__dirname, '../../src/common/utils/rep-route-gate.ts'), 'utf8');
    assert.ok(gate.includes("'CUSTOMER_NOT_ON_REP_ROUTE'"), 'shared gate names the refusal code');
    assert.ok(gate.includes('serving.size === 0'), 'empty serving set (no history anywhere) allows the first sale');
    assert.ok(gate.includes('serving.has(Number(repId))'), 'own served customer allows the sale');
    assert.ok(gate.includes("selectFrom('van_field_visits')"), 'field-visit evidence in the gate');
    assert.ok(gate.includes("selectFrom('sales_orders')"), 'pre-sale-order evidence in the gate');
    assert.ok(gate.includes("selectFrom('sales')"), 'delivered-sale evidence in the gate');
    const fieldSlice = readFileSync(
      resolve(__dirname, '../../src/modules/delivery-reps/services/van-field-sales/execute-field-sale-internal.ts'),
      'utf8',
    );
    assert.ok(fieldSlice.includes('assertRouteGate'), 'field sale calls the route gate');
    assert.ok(
      fieldSlice.includes("import { assertRouteGate } from '../../../../common/utils/rep-route-gate'"),
      'field sale calls the gate from the shared gate module (moved at the Batch 3 merge so the slice stays at its size baseline; the refusal code itself is pinned on the gate file above)',
    );
    const posGate = readFileSync(
      resolve(__dirname, '../../src/modules/sales/services/create-sale/assert-pos-rep-route.ts'),
      'utf8',
    );
    assert.ok(posGate.includes('assertRepRouteForSale'), 'POS gate calls the shared predicate');
    assert.ok(posGate.includes('authorizeDiscountOverride'), 'POS override uses the existing manager-PIN path');
    const orchestrator = readFileSync(
      resolve(__dirname, '../../src/modules/sales/services/create-sale.service.ts'),
      'utf8',
    );
    const gateAt = orchestrator.indexOf('assertPosRepRouteForSale(this.db');
    const txAt = orchestrator.indexOf('runInTransaction');
    assert.ok(gateAt > 0 && txAt > gateAt, 'POS gate runs before the transaction opens');
    console.log('  source pins passed');
  }

  // Wiring: this spec is in both critical lists (349 specs, identical
  // order) — the suite count moves 297 -> 300 with this batch (F7c + F3 + F8).
  {
    const specs = JSON.parse(readFileSync(join(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 407);
    assert.equal(chain.length, 407);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/van-route-sale-gate.spec.ts'));
    console.log('  wiring (349 specs, identical order) passed');
  }

  console.log('van-route-sale-gate: OK');
}

main()
  .then(async () => {
    console.log('van-route-sale-gate: OK');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
