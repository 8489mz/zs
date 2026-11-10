/*
New file: backend/test/critical/rest-cod-collection-truth.spec.ts

WHAT THIS PINS (INV-REST-COD-COLLECTION-TRUTH, T11-D, D-T11-1):
Trial 3, G6 — a COD delivery with a courier and the default cash
channel posted as "خالص مسبقاً (نقدي) / مدفوع مسبقاً بالكامل":
cash recorded as received before the courier collects it. The
defect is the backend inference in createSale
(sales-write.service.ts): an absent collectionStatus + a fully-paid
tender defaulted to 'prepaid_online', so a cash leg posted and no
courier custody was created.

THE FIX: a delivery WITH a courier rep never infers prepaid from
full payment alone. Absent status + courier -> 'cod', and the cash
legs that rode in on the default cash channel are withheld from the
tender allocation (they are NOT money in hand), so the sale posts
paid 0 as a COD receivable in the rep's custody — no sale_payments
row, no treasury row, no Dr 1110 leg — and settles end to end
through the real DeliveryRepsService.settleOrder. Prepaid requires
an explicit prepaid status or an online-channel leg
(wallet/instapay), a verifiable gateway receipt. Card legs are kept
as declared (bank money, not cash in hand). Non-courier deliveries,
credit sales and explicit statuses keep the existing inference
exactly.

WHY THE CASH LEGS ARE WITHHELD, NOT JUST THE STATUS FLIPPED: a
status-only flip would leave paid_amount at the full total, and
settleOrder refuses a COD order with paid_amount > 0.009
(DELIVERY_PARTIAL_PAYMENT_RECONCILIATION_REQUIRED) — the order
would be uncollectable AND unsettleable. The same rule applies to a
partial cash leg with an unstated status: the backend cannot tell a
deliberately typed partial from a default-filled one, so an
unstated status + courier withholds every cash leg (an explicit
'cod' status still posts a declared partial leg exactly as typed —
see restaurant-paid-gates.spec.ts test 19; the line is explicit vs
absent, not full vs partial).

BASE-RED: the main case fails on the unmodified inference
(collection_status 'prepaid_online', paid 530, Dr 1110) and passes
after the fix. Cases 2-4 pass at base and must keep passing.

HOW THIS IS DRIVEN: the real createSale on PGlite, with the real
authorization, finance, query, posting, idempotency and audit
services (same harness as restaurant-paid-gates.spec.ts).
Teardown is db.destroy() only. Live-Postgres acceptance remains
deferred by written decision.
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
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { DeliveryRepsService } from '../../src/modules/delivery-reps/delivery-reps.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const cashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec-t11d', username: 'cashier-a', role: 'cashier',
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
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
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
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code varchar(32), settled_at timestamptz, settled_by bigint, delivery_signature text, delivery_photo_url text, delivery_notes text);
    CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, status text, updated_at timestamptz);
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
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz, terminal_code varchar(32), updated_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, exchange_tip_relief numeric(15, 3), exchange_courier_relief numeric(15, 3), branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
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
  await anyDb.insertInto('users').values({ id: 3, tenant_id: TENANT, username: 'cashier-b', role: 'cashier', is_active: true }).execute();
  const accounts: Array<[number, string]> = [
    [1110, '1110'], [1120, '1120'], [1130, '1130'], [1140, '1140'],
    [2120, '2120'], [4100, '4100'], [4300, '4300'], [5100, '5100'],
  ];
  for (const [id, code] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_accounts').values({ id: 2115, tenant_id: TENANT, code: '2115', name_ar: '2115', is_active: true, is_tax: false, account_type: 'liability', account_group: 'payable' }).execute();
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
  }).execute();
  await anyDb.insertInto('delivery_representatives').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep One', is_active: true,
  }).execute();
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: openedBy, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: SHIFT_OPENED_AT,
  }).execute();
}

function buildServices(db: Kysely<Database>): { sales: SalesWriteService; drawer: CashDrawerService; posting: AccountingPostingService; reps: DeliveryRepsService } {
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
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  const reps = new DeliveryRepsService(db, audit, posting, finance);
  return { sales, drawer, posting, reps };
}

async function createAndGetId(service: SalesWriteService, payload: any, auth: AuthContext): Promise<number> {
  const created: any = await service.createSale(payload, auth);
  const id = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
  assert.ok(Number.isInteger(id) && id > 0, `createSale must return a sale id, got ${JSON.stringify(created)?.slice(0, 120)}`);
  return id;
}

async function saleFullRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('sales')
    .select(['payment_type', 'payment_channel', 'collection_status', 'paid_amount', 'total', 'delivery_rep_id', 'delivery_status', 'delivery_fee', 'delivery_fee_mode'])
    .where('id', '=', id).executeTakeFirstOrThrow();
}

async function paymentRows(db: Kysely<Database>, saleId: number): Promise<any[]> {
  return (db as any).selectFrom('sale_payments').select(['payment_channel', 'amount'])
    .where('sale_id', '=', saleId).execute();
}

async function treasuryRows(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('treasury_transactions').select(['txn_type', 'amount']).execute();
}

async function ledgerRows(db: Kysely<Database>, customerId: number): Promise<any[]> {
  return (db as any).selectFrom('customer_ledger').select(['amount', 'reference_id'])
    .where('customer_id', '=', customerId).execute();
}

async function journalByCode(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<Map<string, { debit: number; credit: number }>> {
  const entries = await (db as any).selectFrom('journal_entries').select('id')
    .where('source_type', '=', sourceType).where('source_id', '=', sourceId).execute();
  assert.equal(entries.length, 1, `expected exactly one ${sourceType} journal for ${sourceId}`);
  const rows = await (db as any).selectFrom('journal_entry_lines as l')
    .innerJoin('accounting_accounts as a', 'a.id', 'l.account_id')
    .select(['a.code as code', 'l.debit as debit', 'l.credit as credit'])
    .where('l.journal_entry_id', '=', Number(entries[0].id)).execute();
  const byCode = new Map<string, { debit: number; credit: number }>();
  for (const row of rows) {
    const code = String((row as any).code);
    const prev = byCode.get(code) || { debit: 0, credit: 0 };
    byCode.set(code, { debit: prev.debit + Number((row as any).debit || 0), credit: prev.credit + Number((row as any).credit || 0) });
  }
  return byCode;
}

/** The T11-D fixture: five Widget 101 at 100 (= 500 goods) + a 30 freelance-courier fee = 530 total, delivery, rep 1, NO collectionStatus stated, fully paid in cash (the trial shape: default نقدي). */
function trialPayload(overrides: Record<string, unknown> = {}): any {
  return {
    items: [{ productId: 101, qty: 5, price: 100, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: 530 }], tenderedAmount: 530,
    branchId: 1, locationId: 10, source: 'pos',
    customerId: 7, orderType: 'delivery', deliveryRepId: 1,
    deliveryFee: 30,
    ...overrides,
  };
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

  // 1. MAIN (base-red): a delivery with a courier, no stated
  // collection status, and a fully-paid cash tender posts as COD
  // with a courier custody and NO cash leg — paid 0, zero
  // sale_payments rows, Dr 1130 for the full 530 with no Dr 1110
  // leg, a customer-ledger debt of 530, no treasury row, and the
  // rep's pending custody holds 530 - 30 fee = 500. At base it
  // posted prepaid_online, paid 530, Dr 1110.
  await check('T11-D courier + unstated status + full cash tender posts COD with no cash leg', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, reps } = buildServices(db);
      const saleId = await createAndGetId(sales, trialPayload(), cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(Number(row.total), 530, 'goods 500 + courier fee 30');
      assert.equal(Number(row.paid_amount), 0, 'no cash has changed hands yet');
      assert.equal(row.payment_type, 'cash', 'a COD sale stays a cash-type sale, never reclassified to credit');
      assert.equal(row.collection_status, 'cod', 'the unstated status defaults to COD when a courier is assigned');
      assert.equal(Number(row.delivery_rep_id), 1, 'the rep carries the custody');
      assert.deepEqual(await paymentRows(db, saleId), [], 'no sale_payments row exists for the withheld cash tender');
      const journal = await journalByCode(db, 'sale', saleId);
      assert.equal(journal.get('1130')?.debit, 530, 'the full total is a customer receivable');
      assert.equal(journal.get('1110'), undefined, 'no cash-in-till leg exists for money with the courier');
      assert.equal(journal.get('4100')?.credit, 500, 'goods revenue is 500');
      assert.equal(journal.get('2115')?.credit, 30, 'the courier fee is a payable, not revenue');
      const legs = await ledgerRows(db, 7);
      assert.ok(
        legs.some((leg) => Number(leg.reference_id) === saleId && Number(leg.amount) === 530),
        'the unpaid 530 is a customer-ledger debt on this sale',
      );
      assert.deepEqual(await treasuryRows(db), [], 'treasury sees nothing: the cash is not in the drawer');
      const summary: any = await reps.getRepSummary(1, cashierAuth);
      assert.equal(Number(summary?.summary?.pendingAmount), 500, 'the rep custody holds total minus the courier fee');
    } finally {
      await db.destroy();
    }
  });

  // 2. Settleability, end to end: the same COD sale settles through
  // the real DeliveryRepsService.settleOrder — at base that threw
  // 409 DELIVERY_PARTIAL_PAYMENT_RECONCILIATION_REQUIRED because
  // paid_amount was the full total. After the fix it returns ok,
  // marks the order settled, records treasury cash_in of 530 - 30
  // = 500, and the settlement journal debits 1110 500 + 2115 30
  // against Cr 1130 530, so 1130 lands at zero and the customer
  // ledger nets to zero too.
  await check('T11-D the courier-COD order settles end to end', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, reps } = buildServices(db);
      const saleId = await createAndGetId(sales, trialPayload(), cashierAuth);
      const settled: any = await reps.settleOrder(saleId, cashierAuth);
      assert.equal(settled?.ok, true, 'settleOrder succeeds on the unpaid COD order');
      const row = await saleFullRow(db, saleId);
      assert.equal(row.delivery_status, 'settled', 'the order is marked settled');
      const treasury = await treasuryRows(db);
      assert.equal(treasury.length, 1, 'exactly one treasury row exists');
      assert.equal(treasury[0].txn_type, 'cash_in', 'settlement brings cash in');
      assert.equal(Number(treasury[0].amount), 500, 'the rep hands over total minus the courier fee');
      const settlement = await journalByCode(db, 'delivery_rep_settlement', saleId);
      assert.equal(settlement.get('1110')?.debit, 500, 'the cash is counted once, at settlement');
      assert.equal(settlement.get('2115')?.debit, 30, 'the courier fee payable is relieved');
      assert.equal(settlement.get('1130')?.credit, 530, 'the receivable is cleared in full');
      const legs = await ledgerRows(db, 7);
      const net = legs.filter((leg) => Number(leg.reference_id) === saleId)
        .reduce((sum, leg) => sum + Number(leg.amount || 0), 0);
      assert.equal(net, 0, 'the customer ledger nets to zero after settlement');
    } finally {
      await db.destroy();
    }
  });

  // 3. REGRESSION GUARD (passes at base): an EXPLICIT prepaid_online
  // delivery keeps its cash leg — the money is already in, so the
  // full cash tender posts prepaid with Dr 1110.
  await check('T11-D explicit prepaid_online keeps the cash leg', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, trialPayload({ collectionStatus: 'prepaid_online' }), cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(row.collection_status, 'prepaid_online', 'the explicit prepaid status is kept');
      assert.equal(Number(row.paid_amount), 530, 'the prepaid delivery is fully paid');
      const journal = await journalByCode(db, 'sale', saleId);
      assert.equal(journal.get('1110')?.debit, 530, 'the prepaid cash debits the till');
      assert.equal(journal.get('1130'), undefined, 'no receivable exists for a prepaid sale');
    } finally {
      await db.destroy();
    }
  });

  // 4. REGRESSION GUARD (passes at base): an unstated status + a
  // courier + a full WALLET tender is prepaid_online — the gateway
  // receipt proves the money is in, so the online channel keeps
  // the prepaid inference and the bank leg.
  await check('T11-D unstated status + courier + wallet tender stays prepaid_online', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, trialPayload({
        paymentChannel: 'wallet',
        payments: [{ paymentChannel: 'wallet', amount: 530 }],
        tenderedAmount: 0,
      }), cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(row.collection_status, 'prepaid_online', 'the online channel proves prepayment');
      assert.equal(Number(row.paid_amount), 530, 'the wallet tender is fully paid');
      const journal = await journalByCode(db, 'sale', saleId);
      assert.equal(journal.get('1120')?.debit, 530, 'the prepaid amount debits the bank, not the till');
      assert.equal(journal.get('1110'), undefined, 'no cash leg exists for a wallet prepayment');
    } finally {
      await db.destroy();
    }
  });

  // 5. REGRESSION GUARD (passes at base): a NON-courier delivery
  // keeps the existing inference — an unstated status + a fully-paid
  // cash tender still posts prepaid_online.
  await check('T11-D non-courier delivery keeps the prepaid inference', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, {
        items: [{ productId: 101, qty: 1, price: 100, priceType: 'retail', unitMultiplier: 1 }],
        discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
        payments: [{ paymentChannel: 'cash', amount: 100 }], tenderedAmount: 100,
        branchId: 1, locationId: 10, source: 'pos',
        customerId: 7, orderType: 'delivery',
      }, cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(row.collection_status, 'prepaid_online', 'no courier means the old fallback still applies');
      assert.equal(Number(row.paid_amount), 100, 'the non-courier delivery is fully paid');
      const journal = await journalByCode(db, 'sale', saleId);
      assert.equal(journal.get('1110')?.debit, 100, 'the cash still debits the till');
    } finally {
      await db.destroy();
    }
  });

  // 6. An unstated status + courier + a PARTIAL cash tender also
  // withholds the cash leg: the backend cannot tell a deliberately
  // typed partial from a default-filled one, so the same fail-closed
  // rule applies — COD, paid 0, no payment rows.
  await check('T11-D courier + unstated status + partial cash tender posts COD paid 0', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, trialPayload({
        payments: [{ paymentChannel: 'cash', amount: 200 }], tenderedAmount: 200,
      }), cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(row.collection_status, 'cod', 'the unstated status defaults to COD');
      assert.equal(Number(row.paid_amount), 0, 'the unstated partial cash leg is withheld');
      assert.deepEqual(await paymentRows(db, saleId), [], 'no sale_payments row exists');
      const journal = await journalByCode(db, 'sale', saleId);
      assert.equal(journal.get('1130')?.debit, 530, 'the full total stays receivable');
      assert.equal(journal.get('1110'), undefined, 'no cash leg exists');
    } finally {
      await db.destroy();
    }
  });

  if (failures.length) throw new Error(`${failures.length} T11-D case(s) failed: ${failures.join(', ')}`);
  console.log('T11-D COD collection truth tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
