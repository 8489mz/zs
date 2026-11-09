/*
New file: backend/test/critical/loyalty-split-redemption.spec.ts

WHAT THIS PINS (INV-REST-LOYALTY-TRUTH, R6-C): the server side of the
split-bill loyalty decision — split bills DO redeem loyalty points,
capped per part at that part's total, deducted once across parts
server-side. The frontend (PosSplitBillModal) allocates POINTS across
parts and posts per part discount = manual share only +
loyaltyPointsRedeemed = points share; this spec pins what the real
createSale writer does with those part-sales. No backend production
change belongs to this package: the per-sale cap, the customer-row
FOR UPDATE lock, the balance check and the deduction already exist
in sales-write.service.ts — this spec proves they compose across
parts exactly once.

- Two part-sales splitting 100 points (60 + 40) reduce the customer
  balance by exactly 100 once (1000 -> 900), write two `redeem` log
  rows keyed by the two sale ids (-60 / -40, balance_after 940 /
  900), and store the per-part loyalty discount on each sale (6 / 4).
- A third sale redeeming past the remaining balance is rejected 400
  INSUFFICIENT_LOYALTY_POINTS, writes no sale and moves no balance.
- A part sent points worth more than its subtotal x cap gets its
  DISCOUNT capped (600 points x 0.1 = 60 capped to 50 at maxPct 50)
  while ALL 600 points are still deducted — the backend behaviour
  the frontend cap exists to avoid (Trap 2: never send a part more
  points than floor(partMaxDiscount / pointValue)).
- A part carrying a manual discount AND points posts the sum once
  (manual 10 + loyalty 6 = 16), never the loyalty share twice.

WHAT THIS DELIBERATELY DOES NOT PIN: the award side. The award is
floor(paidAmount / 100) x pointsPer100Egp PER PART (loses < 1 point
per part vs the whole-order award) — trivial and acceptable by the
recorded decision, so the fixture sets loyaltyPointsPer100Egp = 0
and the balance assertions are exact. The per-part floor award is
not re-pinned here.

HOW THIS IS DRIVEN: the real createSale on PGlite, with the real
authorization, finance, query, posting, idempotency and audit
services (same harness as restaurant-paid-gates.spec.ts). Teardown
is db.destroy() only. No harness exists that runs a full successful
createSale on a live Postgres here, so live-Postgres acceptance
remains deferred by written decision.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
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
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const cashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec-loyalty', username: 'cashier-a', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  SalesWriteService.invalidateSettingsCache(TENANT);
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
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
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, created_by bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code varchar(32));
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, rep_type text, is_active boolean DEFAULT true, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz, terminal_code varchar(32));
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
    CREATE TABLE held_sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, payment_type text, payment_channel text, paid_amount numeric DEFAULT 0, cash_amount numeric DEFAULT 0, card_amount numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, note text, search text, table_number text, order_type text, price_type text, branch_id bigint, location_id bigint, delivery_rep_id bigint, collection_status text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), tip_amount numeric(15, 3) DEFAULT 0, loyalty_points_redeemed integer DEFAULT 0, pager_number text, delivery_fee_mode text, online_order_id bigint, dining_course text, guest_count integer, guest_check_printed_at timestamptz);
    CREATE TABLE held_sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, held_sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, unit_name text, unit_multiplier numeric, price_type text, notes text, modifiers jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT true, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'cashier-a', role: 'cashier', is_active: true }).execute();
  const accounts: Array<[number, string]> = [
    [1110, '1110'], [1120, '1120'], [1130, '1130'], [1140, '1140'],
    [2120, '2120'], [4100, '4100'], [4300, '4300'], [5100, '5100'],
  ];
  for (const [id, code] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, inventory_account_id: 1140,
    sales_revenue_account_id: 4100, sales_discount_account_id: 4300,
    cogs_account_id: 5100, sales_tax_account_id: 2120,
  }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'Widget 101',
    stock_qty: 100, cost_price: 10, retail_price: 100,
    wholesale_price: 100, min_selling_price: 1,
    is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: 100,
  }).execute();
  await anyDb.insertInto('customers').values({
    id: 7, tenant_id: TENANT, account_id: ACCOUNT, name: 'Customer Seven',
    balance: 0, credit_limit: 0, is_credit_blocked: false, is_active: true,
    loyalty_points: 1000,
  }).execute();
  await anyDb.insertInto('delivery_representatives').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep One', is_active: true,
  }).execute();
}

/** Loyalty tenant settings. The award is set to 0 points per 100 on
 * purpose (see the header): the per-part floor award would otherwise
 * move the balance between the redeem assertions. */
async function seedLoyalty(db: Kysely<Database>, maxDiscountPercentage: number): Promise<void> {
  const anyDb = db as any;
  const rows: Array<[string, string]> = [
    ['loyaltyEnabled', 'true'],
    ['loyaltyPointRedeemValue', '0.1'],
    ['loyaltyMinRedeemPoints', '0'],
    ['loyaltyMaxDiscountPercentage', String(maxDiscountPercentage)],
    ['loyaltyPointsPer100Egp', '0'],
  ];
  for (const [key, value] of rows) {
    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key, value }).execute();
  }
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: openedBy, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: SHIFT_OPENED_AT,
  }).execute();
}

function buildServices(db: Kysely<Database>): { sales: SalesWriteService } {
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
  const planFeatures = { hasFeature: () => false };
  const returnsStub = {};
  const sales = new SalesWriteService(
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
  );
  return { sales };
}

/** Base POS payload: one Widget 101 at the given subtotal, fully paid in cash. */
function posPayload(total: number, overrides: Record<string, unknown> = {}): any {
  return {
    items: [{ productId: 101, qty: 1, price: total, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: total }],
    tenderedAmount: total, branchId: 1, locationId: 10, source: 'pos',
    ...overrides,
  };
}

async function createAndGetId(service: SalesWriteService, payload: any, auth: AuthContext): Promise<number> {
  const created: any = await service.createSale(payload, auth);
  const id = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
  assert.ok(Number.isInteger(id) && id > 0, `createSale must return a sale id, got ${JSON.stringify(created)?.slice(0, 120)}`);
  return id;
}

async function customerPoints(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('customers').select('loyalty_points')
    .where('id', '=', 7).executeTakeFirstOrThrow();
  return Number((row as any).loyalty_points);
}

async function redeemLogs(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('customer_loyalty_logs')
    .select(['points_change', 'balance_after', 'action_type', 'sale_id'])
    .where('customer_id', '=', 7).orderBy('id').execute();
}

async function saleMoney(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('sales').select(['discount', 'total', 'paid_amount'])
    .where('id', '=', id).executeTakeFirstOrThrow();
}

async function salesCount(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('sales').select(sql`count(*)`.as('n')).executeTakeFirst();
  return Number((row as any).n);
}

async function main(): Promise<void> {
  const failures: string[] = [];
  async function check(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`  PASS ${name}`);
    } catch (error) {
      failures.push(name);
      console.log(`  FAIL ${name}: ${String((error as Error)?.message || error).split('\n')[0]}`);
    }
  }

  // 1. Two part-sales splitting 100 points deduct exactly 100 once.
  await check('two part-sales splitting 100 points deduct exactly 100 once', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedLoyalty(db, 100);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      // Part 1: subtotal 100, 60 points x 0.1 = 6 discount, total 94.
      const part1 = await createAndGetId(sales, posPayload(100, {
        customerId: 7, loyaltyPointsRedeemed: 60,
        payments: [{ paymentChannel: 'cash', amount: 94 }],
        tenderedAmount: 94, expectedTotal: 94,
      }), cashierAuth);
      assert.equal(await customerPoints(db), 940, '60 points deducted after part 1');
      // Part 2: subtotal 100, 40 points x 0.1 = 4 discount, total 96.
      const part2 = await createAndGetId(sales, posPayload(100, {
        customerId: 7, loyaltyPointsRedeemed: 40,
        payments: [{ paymentChannel: 'cash', amount: 96 }],
        tenderedAmount: 96, expectedTotal: 96,
      }), cashierAuth);
      assert.equal(await customerPoints(db), 900, 'balance reduced by exactly 100 once');
      const first = await saleMoney(db, part1);
      assert.equal(Number(first.discount), 6, 'part 1 stores its own loyalty discount');
      assert.equal(Number(first.total), 94);
      const second = await saleMoney(db, part2);
      assert.equal(Number(second.discount), 4, 'part 2 stores its own loyalty discount');
      assert.equal(Number(second.total), 96);
      const logs = await redeemLogs(db);
      assert.equal(logs.length, 2, 'exactly two redeem log rows');
      assert.equal(logs[0].action_type, 'redeem');
      assert.equal(Number(logs[0].points_change), -60);
      assert.equal(Number(logs[0].sale_id), part1, 'first log row is keyed by part 1');
      assert.equal(Number(logs[0].balance_after), 940);
      assert.equal(logs[1].action_type, 'redeem');
      assert.equal(Number(logs[1].points_change), -40);
      assert.equal(Number(logs[1].sale_id), part2, 'second log row is keyed by part 2');
      assert.equal(Number(logs[1].balance_after), 900);
    } finally {
      await db.destroy();
    }
  });

  // 2. A third sale redeeming past the remaining balance is rejected.
  await check('a third sale past the remaining balance is rejected', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedLoyalty(db, 100);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      await createAndGetId(sales, posPayload(100, {
        customerId: 7, loyaltyPointsRedeemed: 60,
        payments: [{ paymentChannel: 'cash', amount: 94 }],
        tenderedAmount: 94, expectedTotal: 94,
      }), cashierAuth);
      await createAndGetId(sales, posPayload(100, {
        customerId: 7, loyaltyPointsRedeemed: 40,
        payments: [{ paymentChannel: 'cash', amount: 96 }],
        tenderedAmount: 96, expectedTotal: 96,
      }), cashierAuth);
      assert.equal(await customerPoints(db), 900, '900 points remain after the split');
      await assert.rejects(
        createAndGetId(sales, posPayload(100, {
          customerId: 7, loyaltyPointsRedeemed: 901,
          payments: [{ paymentChannel: 'cash', amount: 100 }],
          tenderedAmount: 100, expectedTotal: 100,
        }), cashierAuth),
        (err: any) => err && err.code === 'INSUFFICIENT_LOYALTY_POINTS' && err.statusCode === 400,
      );
      assert.equal(await salesCount(db), 2, 'the rejected sale writes nothing');
      assert.equal(await customerPoints(db), 900, 'the rejected sale moves no balance');
      assert.equal((await redeemLogs(db)).length, 2, 'the rejected sale writes no log row');
    } finally {
      await db.destroy();
    }
  });

  // 3. A part sent points past its subtotal x cap: discount capped,
  // points still deducted (the backend behaviour the frontend cap
  // exists to avoid — Trap 2).
  await check('a part past its cap gets its discount capped but burns all sent points', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedLoyalty(db, 50);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      // Subtotal 100, cap 50%: 600 points are worth 60, capped to 50.
      const saleId = await createAndGetId(sales, posPayload(100, {
        customerId: 7, loyaltyPointsRedeemed: 600,
        payments: [{ paymentChannel: 'cash', amount: 50 }],
        tenderedAmount: 50, expectedTotal: 50,
      }), cashierAuth);
      const row = await saleMoney(db, saleId);
      assert.equal(Number(row.discount), 50, 'the loyalty discount is capped at subtotal x maxPct');
      assert.equal(Number(row.total), 50);
      assert.equal(await customerPoints(db), 400, 'all 600 sent points are deducted, not just the capped share');
      const logs = await redeemLogs(db);
      assert.equal(logs.length, 1);
      assert.equal(Number(logs[0].points_change), -600);
      assert.equal(Number(logs[0].balance_after), 400);
    } finally {
      await db.destroy();
    }
  });

  // 4. Manual discount + points post once, never double-counted.
  await check('manual discount plus points post once without double-counting', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedLoyalty(db, 100);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      // Subtotal 100, manual 10 + 60 points x 0.1 = 6 loyalty: total 84.
      const saleId = await createAndGetId(sales, posPayload(100, {
        customerId: 7, discount: 10, managerPin: '1234', loyaltyPointsRedeemed: 60,
        payments: [{ paymentChannel: 'cash', amount: 84 }],
        tenderedAmount: 84, expectedTotal: 84,
      }), cashierAuth);
      const row = await saleMoney(db, saleId);
      assert.equal(Number(row.discount), 16, 'effective discount is manual + loyalty, once');
      assert.equal(Number(row.total), 84);
      assert.equal(await customerPoints(db), 940, 'only the 60 points are deducted');
      const logs = await redeemLogs(db);
      assert.equal(logs.length, 1);
      assert.equal(Number(logs[0].points_change), -60);
    } finally {
      await db.destroy();
    }
  });

  if (failures.length) throw new Error(`${failures.length} loyalty-split case(s) failed: ${failures.join(', ')}`);
  console.log('Loyalty split redemption tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
