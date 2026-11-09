/*
 * R4-E (INV-REST-KDS-TRUTH-2): KDS leftovers — I12, I13 (predicate, frontend),
 * I15, I16, I17, I18, I55.
 *
 * WHAT THIS PINS, per item:
 * - I15: station resolution honours the category station before keyword
 *   guessing, and keyword guessing is word-boundary (باربكيو is not the bar).
 *   A category-grill product named "Cappuccino" (no keyword) routes grill;
 *   "باربكيو" with no config routes kitchen, never beverages; a product
 *   configured 'general' keeps station 'general' and is visible under the
 *   general filter.
 * - I16: 201 active sales return truncated === true AND totalActive === 201,
 *   and the stats cover only the 200 shown tickets.
 * - I17: a real createSale with onlineOrderId carries the draft ticket's
 *   cooking progress onto the posted sale (the transfer happens inside the
 *   release block). A transfer-only test would pass at base and prove
 *   nothing, so the caller is driven; transfer semantics are pinned
 *   separately at KdsService level.
 * - I18: setTicketStatus refuses backward / skipping moves (ready -> pending,
 *   cooking -> pending, pending -> served) and fireTicketCourse refuses to
 *   force a ready ticket back to cooking.
 * - I55: a corrupt kds runtime blob, a null / invalid ticket entry inside an
 *   otherwise valid blob, and a corrupt aggregator payload each leave the
 *   other tickets visible instead of killing the whole poll.
 * - I12: a local TCP server receives the ticket bytes for a matched network
 *   printer; an unreachable printer reports ok:false instead of throwing or
 *   claiming success; no matching printer returns []; a category_ids match
 *   routes even when the station does not; printTicketForPostedSale loads
 *   the sale from the DB and resolves stations itself.
 *
 * HOW THIS IS DRIVEN: the real KdsService / KitchenPrintersService /
 * SalesWriteService over PGlite, one fresh database per case. No live
 * Postgres harness exists here, so live-Postgres acceptance remains
 * deferred by written decision (as in the other critical specs).
 *
 * RED PROOF (base 996bbc13): I15 cases A/B fail (Cappuccino -> kitchen,
 * باربكيو -> beverages); I16 fails on totalActive (undefined at base);
 * I17 fails (posted sale has no cooking state); I18 cases fail (the
 * forbidden moves succeed at base); I55 cases fail (getActiveTickets
 * throws); I12 fails (no such service methods); the pure-helper cases
 * fail at the dynamic import (the helper does not exist at base).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as net from 'node:net';
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
import { KdsService } from '../../src/modules/sales/services/kds.service';
import { KitchenPrintersService } from '../../src/modules/sales/services/kitchen-printers.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['sales', 'canEditPrice'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  SalesWriteService.invalidateSettingsCache(TENANT);
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    CREATE TABLE settings (tenant_id text, account_id text, key text, value text);
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
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz, category_id bigint, kitchen_station text);
    CREATE TABLE product_categories (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true, kitchen_station text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, aggregator_channel text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code varchar(32));
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
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
    CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_name text, customer_phone text, customer_address text, items_json text, subtotal numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, total_amount numeric DEFAULT 0, status text, payment_method text, payment_status text, gateway_provider text, gateway_order_id text, fulfillment_type text, order_type text, table_number text, kitchen_draft_sale_id bigint, sale_id bigint, branch_id bigint, stock_reserved boolean DEFAULT false, reserved_branch_id bigint, reserved_location_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE pos_kitchen_printers (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, name text, station_code text, ip_address text, port int, paper_width text, is_active boolean DEFAULT true, category_ids jsonb, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE pos_delivery_aggregators (id bigint PRIMARY KEY, tenant_id text, account_id text, code text, name text, name_en text, commission_rate numeric, price_markup_percentage numeric, price_markup_fixed numeric, is_active boolean DEFAULT true, auto_accept_orders boolean DEFAULT false, api_key text);
    CREATE TABLE pos_aggregator_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, aggregator_id bigint, external_order_id text, display_number text, branch_id bigint, status text, customer_name text, customer_phone text, delivery_address text, rider_name text, rider_phone text, subtotal numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, aggregator_commission numeric DEFAULT 0, net_payout numeric DEFAULT 0, order_payload text, sale_id bigint, kds_ticket_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, account_id: ACCOUNT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, account_id: ACCOUNT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
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
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: openedBy, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: SHIFT_OPENED_AT,
  }).execute();
}

function buildServices(db: Kysely<Database>): {
  sales: SalesWriteService; drawer: CashDrawerService; posting: AccountingPostingService;
  kds: KdsService; printers: KitchenPrintersService;
} {
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
  const kds = new KdsService(db);
  // The KdsService argument is a new optional ctor parameter: cast through
  // any so this spec still compiles against the base tree, where the
  // parameter does not exist yet and the extra argument is ignored.
  const sales = new (SalesWriteService as any)(
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
    undefined, undefined, undefined, kds,
  ) as SalesWriteService;
  const printers = new KitchenPrintersService(db);
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  return { sales, drawer, posting, kds, printers };
}

async function seedKdsState(db: Kysely<Database>, tickets: Record<string, unknown>): Promise<void> {
  await (db as any).insertInto('settings').values({
    tenant_id: TENANT, account_id: 'default',
    key: 'kds_tickets_runtime_state', value: JSON.stringify({ tickets }),
  }).execute();
}

async function readKdsState(db: Kysely<Database>): Promise<any> {
  const row: any = await (db as any).selectFrom('settings').select('value')
    .where('key', '=', 'kds_tickets_runtime_state')
    .where(sql<boolean>`tenant_id = ${TENANT}`).executeTakeFirst();
  return row ? JSON.parse(row.value) : null;
}

async function seedSale(db: Kysely<Database>, id: number, docNo: string, status = 'posted'): Promise<void> {
  await (db as any).insertInto('sales').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: docNo,
    status, order_type: 'dine_in', table_number: '5', total: 100,
    created_at: new Date(),
  }).execute();
}

async function seedSaleItem(db: Kysely<Database>, saleId: number, productId: number, name: string): Promise<void> {
  await (db as any).insertInto('sale_items').values({
    tenant_id: TENANT, account_id: ACCOUNT, sale_id: saleId, product_id: productId,
    product_name: name, qty: 1, unit_price: 100, line_total: 100, unit_name: 'قطعة',
  }).execute();
}

/** A capture TCP server: collects every byte a printer client sends. */
async function startCaptureServer(): Promise<{
  port: number; waitForBytes: (timeoutMs?: number) => Promise<string>; close: () => Promise<void>;
}> {
  const chunks: Buffer[] = [];
  let resolveBytes: ((value: string) => void) | null = null;
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      chunks.push(Buffer.from(data));
      if (resolveBytes) {
        const done = resolveBytes;
        resolveBytes = null;
        done(Buffer.concat(chunks).toString('utf8'));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    waitForBytes: (timeoutMs = 5000) => new Promise<string>((resolve, reject) => {
      if (chunks.length > 0) return resolve(Buffer.concat(chunks).toString('utf8'));
      const timer = setTimeout(() => reject(new Error('timed out waiting for printer bytes')), timeoutMs);
      resolveBytes = (value) => { clearTimeout(timer); resolve(value); };
    }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function main(): Promise<void> {
  // I15 — pure helper: precedence + word-boundary keywords + printer map.
  // The helper does not exist at base, so the dynamic import rejects there.
  {
    // The helper does not exist at base, so the dynamic import rejects there.
    // The specifier is computed (not a literal) so ts-node does not try to
    // resolve it at compile time and the rest of the spec still runs at base.
    const helper: any = await import('../../src/modules/sales/helpers/' + 'kds-station.helper');
    assert.equal(
      helper.resolveItemStation({ productStation: null, categoryStation: 'grill', productName: 'Cappuccino', categoryName: 'مشروبات' }),
      'grill', 'category station beats keyword guessing, even when the name has no keyword',
    );
    assert.equal(
      helper.resolveItemStation({ productStation: 'general', categoryStation: 'grill', productName: 'كباب حلبي' }),
      'general', 'product station beats category station',
    );
    assert.equal(
      helper.resolveItemStation({ productStation: null, categoryStation: null, productName: 'باربكيو' }),
      'kitchen', 'باربكيو must not match the بار beverage keyword',
    );
    assert.equal(
      helper.resolveItemStation({ productStation: null, categoryStation: null, productName: 'مشويات مشكلة' }),
      'grill', 'the grill keyword still matches its real word form',
    );
    assert.equal(
      helper.resolveItemStation({ productStation: null, categoryStation: null, productName: 'البار' }),
      'beverages', 'a real bar word still routes to beverages',
    );
    assert.equal(
      helper.resolveItemStation({ productStation: null, categoryStation: null, productName: 'Cappuccino' }),
      'kitchen', 'a name with no keyword falls through to kitchen',
    );
    assert.equal(
      helper.resolveItemStation({ productStation: 'expo', categoryStation: null, productName: 'كباب' }),
      'grill', 'expo is a filter view, not an item station — it falls through to inference',
    );
    assert.equal(helper.mapPrinterStationToKdsStation('bar'), 'beverages', 'printer bar maps to beverages');
    assert.equal(helper.mapPrinterStationToKdsStation('fryer'), 'kitchen', 'printer fryer maps to kitchen');
    assert.equal(helper.mapPrinterStationToKdsStation('cold'), 'kitchen', 'printer cold maps to kitchen');
    assert.equal(helper.mapPrinterStationToKdsStation('dessert'), 'bakery', 'printer dessert maps to bakery');
    assert.equal(helper.mapPrinterStationToKdsStation('grill'), 'grill', 'printer grill maps to grill');
    assert.equal(helper.mapPrinterStationToKdsStation('nonsense'), null, 'an unknown printer station maps to nothing');
    assert.equal(helper.isAllowedKdsTransition('pending', 'cooking'), true);
    assert.equal(helper.isAllowedKdsTransition('cooking', 'ready'), true);
    assert.equal(helper.isAllowedKdsTransition('ready', 'served'), true);
    assert.equal(helper.isAllowedKdsTransition('pending', 'pending'), false, 'same-state is not a forward step');
    assert.equal(helper.isAllowedKdsTransition('ready', 'pending'), false);
    assert.equal(helper.isAllowedKdsTransition('cooking', 'pending'), false);
    assert.equal(helper.isAllowedKdsTransition('pending', 'served'), false, 'skipping a phase is not allowed');
    assert.equal(helper.isAllowedKdsTransition('served', 'pending'), false);
    assert.equal(helper.isAllowedKdsItemTransition('pending', 'cooking'), true);
    assert.equal(helper.isAllowedKdsItemTransition('cooking', 'ready'), true);
    assert.equal(helper.isAllowedKdsItemTransition('pending', 'ready'), true, 'tap-to-complete: an item may be marked ready directly');
    assert.equal(helper.isAllowedKdsItemTransition('ready', 'cooking'), false, 'an item may not be un-marked');
    assert.equal(helper.isAllowedKdsItemTransition('ready', 'pending'), false);
    assert.equal(helper.isAllowedKdsItemTransition('cooking', 'pending'), false);
    console.log('  I15 pure helper passed');
  }

  // I15 — getActiveTickets: category station drives routing, باربكيو is not
  // the bar, general keeps its station and survives the general filter.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { kds } = buildServices(db);
      const anyDb = db as any;
      await anyDb.insertInto('product_categories').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'مشويات', is_active: true, kitchen_station: 'grill' }).execute();
      await anyDb.insertInto('product_categories').values({ id: 11, tenant_id: TENANT, account_id: ACCOUNT, name: 'مشروبات', is_active: true, kitchen_station: 'beverages' }).execute();
      await anyDb.insertInto('products').values({ id: 201, tenant_id: TENANT, account_id: ACCOUNT, name: 'Cappuccino', stock_qty: 10, cost_price: 5, retail_price: 30, wholesale_price: 30, min_selling_price: 1, is_active: true, item_type: 'product', category_id: 10, kitchen_station: null }).execute();
      await anyDb.insertInto('products').values({ id: 202, tenant_id: TENANT, account_id: ACCOUNT, name: 'باربكيو', stock_qty: 10, cost_price: 5, retail_price: 30, wholesale_price: 30, min_selling_price: 1, is_active: true, item_type: 'product', category_id: null, kitchen_station: null }).execute();
      await anyDb.insertInto('products').values({ id: 203, tenant_id: TENANT, account_id: ACCOUNT, name: 'سلطة', stock_qty: 10, cost_price: 5, retail_price: 30, wholesale_price: 30, min_selling_price: 1, is_active: true, item_type: 'product', category_id: null, kitchen_station: 'general' }).execute();
      await anyDb.insertInto('products').values({ id: 204, tenant_id: TENANT, account_id: ACCOUNT, name: 'كباب حلبي', stock_qty: 10, cost_price: 5, retail_price: 30, wholesale_price: 30, min_selling_price: 1, is_active: true, item_type: 'product', category_id: null, kitchen_station: null }).execute();
      await seedSale(db, 310, 'S-310');
      await seedSaleItem(db, 310, 201, 'Cappuccino');
      await seedSaleItem(db, 310, 202, 'باربكيو');
      await seedSaleItem(db, 310, 203, 'سلطة');
      await seedSaleItem(db, 310, 204, 'كباب حلبي');
      const result: any = await kds.getActiveTickets(adminAuth, {});
      const ticket = result.tickets.find((t: any) => Number(t.id) === 310);
      assert.ok(ticket, 'ticket 310 must be listed');
      const byName = new Map(ticket.items.map((i: any) => [i.name, i.station]));
      assert.equal(byName.get('Cappuccino'), 'grill', 'category grill routes Cappuccino to grill');
      assert.equal(byName.get('باربكيو'), 'kitchen', 'باربكيو must not route to beverages');
      assert.equal(byName.get('سلطة'), 'general', 'a product configured general keeps general');
      assert.equal(byName.get('كباب حلبي'), 'grill', 'the grill keyword still routes');
      const generalOnly: any = await kds.getActiveTickets(adminAuth, { station: 'general' });
      assert.ok(generalOnly.tickets.some((t: any) => Number(t.id) === 310), 'the general filter must still show the ticket');
      assert.deepEqual(
        generalOnly.tickets.find((t: any) => Number(t.id) === 310).items.map((i: any) => i.name),
        ['سلطة'], 'the general filter shows only the general item',
      );
    } finally {
      await db.destroy();
    }
    console.log('  I15 getActiveTickets routing passed');
  }

  // I16 — 201 active sales: truncated is true, the total is known, and the
  // stats cover only the 200 shown tickets.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { kds } = buildServices(db);
      const anyDb = db as any;
      for (let i = 1; i <= 201; i++) {
        await anyDb.insertInto('sales').values({
          id: 1000 + i, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `S-${1000 + i}`,
          status: 'posted', order_type: 'dine_in', total: 10, created_at: new Date(),
        }).execute();
      }
      const result: any = await kds.getActiveTickets(adminAuth, {});
      assert.equal(result.truncated, true, '201 active sales must report truncated');
      assert.equal(result.totalActive, 201, 'the banner needs the real total, not just a flag');
      assert.equal(result.tickets.length, 200, 'only 200 tickets are returned');
      assert.equal(result.stats.pendingCount, 200, 'stats cover the shown tickets only');
    } finally {
      await db.destroy();
    }
    console.log('  I16 truncation + total passed');
  }

  // I18 — setTicketStatus: backward and skipping moves throw; the forward
  // chain still works. fireTicketCourse from ready throws and keeps ready.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { kds } = buildServices(db);
      await seedSale(db, 300, 'S-300');
      await assert.rejects(
        kds.setTicketStatus(adminAuth, 300, 'served'),
        (err: any) => err && err.status === 400,
        'pending -> served must throw (a phase may not be skipped)',
      );
      await kds.setTicketStatus(adminAuth, 300, 'cooking');
      await assert.rejects(
        kds.setTicketStatus(adminAuth, 300, 'pending'),
        (err: any) => err && err.status === 400,
        'cooking -> pending must throw',
      );
      await kds.setTicketStatus(adminAuth, 300, 'ready');
      await assert.rejects(
        kds.setTicketStatus(adminAuth, 300, 'pending'),
        (err: any) => err && err.status === 400,
        'ready -> pending must throw',
      );
      await assert.rejects(
        kds.fireTicketCourse(adminAuth, 300),
        (err: any) => err && err.status === 400,
        'firing a course on a ready ticket must throw instead of forcing cooking',
      );
      const afterFire: any = await kds.getActiveTickets(adminAuth, {});
      assert.equal(
        afterFire.tickets.find((t: any) => Number(t.id) === 300).status, 'ready',
        'the refused fire must leave the ticket ready',
      );
      const served = await kds.setTicketStatus(adminAuth, 300, 'served');
      assert.equal(served.status, 'served', 'ready -> served is the one legal last step');
      // Item moves: tap-to-complete is legal, un-marking is not.
      await seedSale(db, 301, 'S-301');
      await seedSaleItem(db, 301, 101, 'Widget 101');
      const itemRow: any = await (db as any).selectFrom('sale_items').select('id')
        .where('sale_id', '=', 301).executeTakeFirstOrThrow();
      const marked = await kds.setItemStatus(adminAuth, 301, Number(itemRow.id), 'ready');
      assert.equal(marked.itemStatus, 'ready', 'pending -> ready (tap-to-complete) stays legal');
      await assert.rejects(
        kds.setItemStatus(adminAuth, 301, Number(itemRow.id), 'cooking'),
        (err: any) => err && err.status === 400,
        'ready -> cooking must throw (an item may not be un-marked)',
      );
    } finally {
      await db.destroy();
    }
    console.log('  I18 transition guard passed');
  }

  // I18 — transfer semantics (pins: the transfer itself already worked at
  // base; the I17 case below proves the caller). Plus the trx-aware variant
  // used inside createSale's transaction.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { kds } = buildServices(db);
      const now = new Date().toISOString();
      await seedKdsState(db, {
        '500': { status: 'cooking', itemsStatus: { '10': 'ready' }, updatedAt: now },
      });
      await kds.transferTicketState(TENANT, 500, 501);
      let state = await readKdsState(db);
      assert.equal(state.tickets['501'].status, 'cooking', 'the ticket status carries over');
      assert.deepEqual(state.tickets['501'].itemsStatus, {}, 'item status resets (item ids change with the new sale)');
      assert.equal(state.tickets['500'], undefined, 'the draft key is gone');
      await kds.transferTicketState(TENANT, 501, null);
      state = await readKdsState(db);
      assert.equal(state.tickets['501'], undefined, 'toSaleId null drops the state');
      // Trx-aware variant: runs inside a caller transaction, no nesting.
      await seedKdsState(db, {});
      await db.transaction().execute(async (trx) => {
        await (kds as any).transferTicketStateInTrx(TENANT, 500, 502, trx);
      });
      state = await readKdsState(db);
      assert.equal(state.tickets['500'], undefined, 'no stored state means nothing to move, and nothing breaks');
      await (db as any).updateTable('settings').set({ value: JSON.stringify({ tickets: { '500': { status: 'ready', itemsStatus: {}, updatedAt: now } } }) })
        .where('key', '=', 'kds_tickets_runtime_state').execute();
      await db.transaction().execute(async (trx) => {
        await (kds as any).transferTicketStateInTrx(TENANT, 500, 502, trx);
      });
      state = await readKdsState(db);
      assert.equal(state.tickets['502'].status, 'ready', 'the trx-aware transfer moves the status inside the caller transaction');
      assert.equal(state.tickets['500'], undefined);
    } finally {
      await db.destroy();
    }
    console.log('  I18 transfer semantics passed');
  }

  // I17 — the caller: a real createSale with onlineOrderId carries the draft
  // ticket's cooking progress onto the posted sale.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      const { sales, kds } = buildServices(db);
      const anyDb = db as any;
      await anyDb.insertInto('sales').values({
        id: 500, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'DRAFT-500',
        status: 'draft', order_type: 'dine_in', table_number: '5', total: 0,
        created_at: new Date(),
      }).execute();
      await anyDb.insertInto('sale_items').values({
        tenant_id: TENANT, account_id: ACCOUNT, sale_id: 500, product_id: 101,
        product_name: 'Widget 101', qty: 1, unit_price: 100, line_total: 100, unit_name: 'قطعة',
      }).execute();
      await anyDb.insertInto('online_orders').values({
        id: 900, tenant_id: TENANT, account_id: ACCOUNT, order_number: 'ORD-900',
        customer_name: 'عميل', customer_phone: '01012345678', items_json: '[]',
        subtotal: 100, delivery_fee: 0, total_amount: 100, status: 'confirmed',
        payment_method: 'cod', payment_status: 'unpaid',
        kitchen_draft_sale_id: 500, order_type: 'dine_in', fulfillment_type: 'dine_in',
        stock_reserved: false, sale_id: null, branch_id: 1,
      }).execute();
      await seedKdsState(db, {
        '500': { status: 'cooking', itemsStatus: {}, updatedAt: new Date().toISOString() },
      });
      const created: any = await sales.createSale({
        items: [{ productId: 101, qty: 1, price: 100, priceType: 'retail', unitMultiplier: 1 }],
        discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
        payments: [{ paymentChannel: 'cash', amount: 100 }],
        tenderedAmount: 100, branchId: 1, locationId: 10, source: 'pos',
        orderType: 'dine_in', tableNumber: '5', onlineOrderId: 900,
      } as any, adminAuth);
      const newId = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
      assert.ok(Number.isInteger(newId) && newId > 0, `createSale must return the posted sale id, got ${JSON.stringify(created)?.slice(0, 120)}`);
      assert.notEqual(newId, 500, 'the posted sale is a new row, not the draft');
      const state = await readKdsState(db);
      assert.equal(state.tickets[String(newId)]?.status, 'cooking', 'the draft cooking progress must carry onto the posted sale');
      assert.equal(state.tickets['500'], undefined, 'the draft key is gone');
      const order: any = await anyDb.selectFrom('online_orders').selectAll().where('id', '=', 900).executeTakeFirstOrThrow();
      assert.equal(order.kitchen_draft_sale_id, null, 'the draft pointer is cleared');
      assert.equal(order.sale_id, newId, 'the order points at the posted sale');
      const draftGone: any = await anyDb.selectFrom('sales').select('id').where('id', '=', 500).executeTakeFirst();
      assert.equal(draftGone, undefined, 'the draft sale row is deleted by the release block');
      const tickets: any = await kds.getActiveTickets(adminAuth, {});
      assert.equal(
        tickets.tickets.find((t: any) => Number(t.id) === newId)?.status, 'cooking',
        'the KDS shows the posted sale as cooking, not as a brand-new pending ticket',
      );
    } finally {
      await db.destroy();
    }
    console.log('  I17 createSale carries KDS progress passed');
  }

  // I55 — a corrupt runtime blob returns the tickets with a corrupt flag,
  // and the stored row is left untouched.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { kds } = buildServices(db);
      await seedSale(db, 310, 'S-310');
      await (db as any).insertInto('settings').values({
        tenant_id: TENANT, account_id: 'default',
        key: 'kds_tickets_runtime_state', value: '{bad json',
      }).execute();
      const result: any = await kds.getActiveTickets(adminAuth, {});
      assert.ok(result.tickets.some((t: any) => Number(t.id) === 310), 'a corrupt blob must not hide the tickets');
      assert.equal(result.kdsStateCorrupt, true, 'the response must flag the corrupt state for the banner');
      const row: any = await (db as any).selectFrom('settings').select('value')
        .where('key', '=', 'kds_tickets_runtime_state').executeTakeFirstOrThrow();
      assert.equal(row.value, '{bad json', 'the stored row is left untouched, never overwritten with an empty state');
    } finally {
      await db.destroy();
    }
    console.log('  I55 corrupt blob passed');
  }

  // I55 — a null entry and an invalid-status entry inside an otherwise valid
  // blob are quarantined; the good entry keeps its state.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { kds } = buildServices(db);
      await seedSale(db, 311, 'S-311');
      await seedSale(db, 312, 'S-312');
      const now = new Date().toISOString();
      await (db as any).insertInto('settings').values({
        tenant_id: TENANT, account_id: 'default',
        key: 'kds_tickets_runtime_state',
        value: JSON.stringify({ tickets: {
          '311': { status: 'cooking', itemsStatus: {}, updatedAt: now },
          '312': null,
          '313': { status: 'flying', itemsStatus: {}, updatedAt: now },
        } }),
      }).execute();
      const result: any = await kds.getActiveTickets(adminAuth, {});
      assert.equal(
        result.tickets.find((t: any) => Number(t.id) === 311)?.status, 'cooking',
        'the good entry keeps its cooking state',
      );
      assert.equal(
        result.tickets.find((t: any) => Number(t.id) === 312)?.status, 'pending',
        'the null entry is quarantined and the ticket falls back to pending',
      );
      assert.equal(result.kdsStateCorrupt, true, 'quarantined entries flag the corrupt state too');
    } finally {
      await db.destroy();
    }
    console.log('  I55 quarantined entries passed');
  }

  // I55 — a corrupt aggregator payload skips that row instead of killing
  // the whole response.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { kds } = buildServices(db);
      const anyDb = db as any;
      await seedSale(db, 320, 'S-320');
      await anyDb.insertInto('pos_delivery_aggregators').values({
        id: 1, tenant_id: TENANT, account_id: ACCOUNT, code: 'jahez', name: 'Jahez',
      }).execute();
      await anyDb.insertInto('pos_aggregator_orders').values({
        id: 1, tenant_id: TENANT, account_id: ACCOUNT, aggregator_id: 1,
        external_order_id: 'EXT-1', display_number: 'J-1', status: 'received',
        customer_name: 'عميل', rider_name: null, order_payload: '{bad json',
        created_at: new Date(),
      }).execute();
      const result: any = await kds.getActiveTickets(adminAuth, {});
      assert.ok(result.tickets.some((t: any) => Number(t.id) === 320), 'the sale ticket must survive a corrupt aggregator row');
      assert.equal(result.tickets.some((t: any) => Number(t.id) === 10000001), false, 'the corrupt aggregator row is skipped, not shown');
    } finally {
      await db.destroy();
    }
    console.log('  I55 corrupt aggregator payload passed');
  }

  // I12 — a matched network printer receives the ticket bytes; an
  // unreachable printer reports ok:false without throwing; no match
  // returns []; a category_ids match routes even when the station does not.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { printers } = buildServices(db);
      const anyDb = db as any;
      const capture = await startCaptureServer();
      try {
        await anyDb.insertInto('pos_kitchen_printers').values({
          tenant_id: TENANT, name: 'Grill', station_code: 'grill',
          ip_address: '127.0.0.1', port: capture.port, is_active: true, category_ids: '[]',
        }).execute();
        const results: any[] = await (printers as any).printTicketForSale(TENANT, {
          id: 1, docNo: 'S-1', tableNumber: '5', orderType: 'dine_in',
          items: [{ name: 'كباب حلبي', qty: 2, notes: 'بدون بصل' }],
        }, ['grill']);
        assert.equal(results.length, 1, 'one matched printer');
        assert.equal(results[0].ok, true, 'the reachable printer reports ok');
        const bytes = await capture.waitForBytes();
        assert.ok(bytes.includes('كباب حلبي'), 'the ticket bytes carry the item name');
        assert.ok(bytes.includes('S-1'), 'the ticket bytes carry the order number');
        assert.ok(bytes.includes('5'), 'the ticket bytes carry the table number');
      } finally {
        await capture.close();
      }
      // Unreachable printer: ok:false, no throw.
      const deadPort = await freePort();
      await anyDb.insertInto('pos_kitchen_printers').values({
        tenant_id: TENANT, name: 'Dead grill', station_code: 'grill',
        ip_address: '127.0.0.1', port: deadPort, is_active: true, category_ids: '[]',
      }).execute();
      const failed: any[] = await (printers as any).printTicketForSale(TENANT, {
        id: 2, docNo: 'S-2', tableNumber: '5', orderType: 'dine_in',
        items: [{ name: 'كباب حلبي', qty: 1 }],
      }, ['grill']);
      // Both grill printers match: the first case's server is closed by now,
      // so both are unreachable and both must report ok:false.
      assert.equal(failed.length, 2, 'both grill printers match');
      assert.ok(failed.every((r: any) => r.ok === false), 'every unreachable printer reports ok:false, never silent success');
      const dead = failed.find((r: any) => r.printerName === 'Dead grill');
      assert.ok(dead && String(dead.error || '').length > 0, 'the failure carries a reason');
      // No matching printer: empty, so the caller falls back to Electron.
      const none: any[] = await (printers as any).printTicketForSale(TENANT, {
        id: 3, docNo: 'S-3', orderType: 'dine_in',
        items: [{ name: 'كيك', qty: 1 }],
      }, ['bakery']);
      assert.deepEqual(none, [], 'no matching printer returns an empty list');
      // Category match: a bar printer (beverages) with category 10 still
      // fires for a kitchen-station ticket whose item is in category 10.
      const capture2 = await startCaptureServer();
      try {
        await anyDb.insertInto('pos_kitchen_printers').values({
          tenant_id: TENANT, name: 'Bar', station_code: 'bar',
          ip_address: '127.0.0.1', port: capture2.port, is_active: true, category_ids: '[10]',
        }).execute();
        const catResults: any[] = await (printers as any).printTicketForSale(TENANT, {
          id: 4, docNo: 'S-4', orderType: 'dine_in',
          items: [{ name: 'سلطة', qty: 1, categoryId: 10 }],
        }, ['kitchen']);
        assert.ok(catResults.some((r: any) => r.printerName === 'Bar' && r.ok), 'the category_ids match routes the ticket');
        const bytes2 = await capture2.waitForBytes();
        assert.ok(bytes2.includes('S-4'), 'the category-matched printer receives the bytes');
      } finally {
        await capture2.close();
      }
    } finally {
      await db.destroy();
    }
    console.log('  I12 network printer send passed');
  }

  // I12 — printTicketForPostedSale loads the sale from the DB, resolves the
  // stations from product + category, and sends to the matched printer.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { printers } = buildServices(db);
      const anyDb = db as any;
      await anyDb.insertInto('product_categories').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'مشويات', is_active: true, kitchen_station: 'grill' }).execute();
      await anyDb.insertInto('products').values({ id: 201, tenant_id: TENANT, account_id: ACCOUNT, name: 'كباب حلبي', stock_qty: 10, cost_price: 5, retail_price: 30, wholesale_price: 30, min_selling_price: 1, is_active: true, item_type: 'product', category_id: 10, kitchen_station: null }).execute();
      await seedSale(db, 700, 'S-700');
      await seedSaleItem(db, 700, 201, 'كباب حلبي');
      const capture = await startCaptureServer();
      try {
        await anyDb.insertInto('pos_kitchen_printers').values({
          tenant_id: TENANT, name: 'Grill', station_code: 'grill',
          ip_address: '127.0.0.1', port: capture.port, is_active: true, category_ids: '[]',
        }).execute();
        const results: any[] = await (printers as any).printTicketForPostedSale(TENANT, 700);
        assert.equal(results.length, 1, 'the grill printer matches the posted sale');
        assert.equal(results[0].ok, true);
        const bytes = await capture.waitForBytes();
        assert.ok(bytes.includes('كباب حلبي'), 'the posted-sale ticket carries the item');
        assert.ok(bytes.includes('S-700'), 'the posted-sale ticket carries the order number');
      } finally {
        await capture.close();
      }
    } finally {
      await db.destroy();
    }
    console.log('  I12 printTicketForPostedSale passed');
  }

  console.log('kds-truth-2.spec: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
