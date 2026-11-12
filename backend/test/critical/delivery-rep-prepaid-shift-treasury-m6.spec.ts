/* INV-REP-PREPAID-SHIFT-TREASURY (M6/A7) — a rep-prepaid non-van
 * delivery sale's cash is rep custody, not till cash.
 *
 * THE DEFECT: at creation the sale posts as paid (the POS sends a
 * full cash leg for collection_status 'prepaid_by_rep' — "المبلغ مع
 * المندوب": the amount is WITH THE REP, nothing is collected from
 * the customer at delivery), so the creation shift's expected cash
 * counted it — while the cash sat in the rep's pocket. At
 * settlement no path ever credited any shift: settleOrder and
 * settleAllOrders selected COD only, and getRepSummary counted COD
 * only. The receiving shift's expected cash was therefore wrong by
 * the amount either way: a false shortage if the creation shift
 * closed before settlement, or a false overage if the cash was
 * counted in the receiving shift with no expected leg. The ledger
 * itself was correct (the sale journal already books Dr 1110 at
 * creation) — only the drawer attribution was wrong.
 *
 * THE FIX (both legs, mirroring the COD pattern exactly — COD sales
 * are excluded from shift sale-cash AND get a treasury row at
 * settlement; either leg alone leaves one of the two named false
 * variances in place):
 *  (a) cash-drawer.service.ts shiftSaleCashAttribution: the main
 *      branch now excludes prepaid_by_rep, like the two fallback
 *      branches already did — the creation shift never expects
 *      rep-held cash (the cancelled-sale receipt restore and the
 *      attributed sale-cash list inherit the same rule).
 *  (b) delivery-reps.service.ts: settleOrder / settleAllOrders /
 *      getRepSummary treat prepaid_by_rep like COD for the CASH
 *      handover — a cash_in treasury row credits the receiving
 *      shift for the PAID amount minus the remaining courier fee
 *      (the rep keeps his fee; store-fleet owes the full paid
 *      amount) — but post NO settlement journal and NO customer
 *      ledger leg, because the sale already booked Dr 1110 at
 *      creation and the customer receivable is already zero.
 *      Counted cash applies to rep-prepaid orders exactly like COD
 *      (the rep holds cash); prepaid_online still fails closed with
 *      DELIVERY_SETTLEMENT_COUNTED_CASH_NOT_APPLICABLE.
 *
 * WHAT IS DRIVEN: the real createSale + the real settleOrder /
 * settleAllOrders / getRepSummary + the real
 * CashDrawerService.computeShiftExpectedCash, on PGlite. GL totals
 * are summed from the posted journal lines, never re-implemented.
 *
 * WHAT IS NOT COVERED (recorded for the coordinator, not fixed
 * here): after a rep-prepaid freelance settlement the Cr 2115 fee
 * leg from the sale journal stands unrelieved — no settlement
 * journal relieves it, because this package posts none by design
 * (posting one would double-book the cash). Relieving it needs its
 * own GL decision (Dr 2115 / Cr 1110 for the fee the rep kept).
 * Likewise a counted-short handover surfaces as drawer variance at
 * close, not as a 7200 leg. The van side (rep_cash_remittance) and
 * settleTrip are untouched.
 *
 * BASE-RED: at base the creation shift expects 530.00 before any
 * settle, settleOrder writes no treasury row, settleAllOrders
 * throws NO_ORDERS for a prepaid-only batch, and the rep summary
 * reports pending 0 for a rep holding 500.00.
 *
 * Run: npx ts-node test/critical/delivery-rep-prepaid-shift-treasury-m6.spec.ts
 * (from backend/). Same PGlite script harness as
 * delivery-rep-single-settle-counted-cash.spec.ts: one fresh
 * in-memory database per case, db.destroy() teardown only.
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
  userId: 2, sessionId: 'spec-m6-a', username: 'cashier-a', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const cashierBAuth: AuthContext = {
  userId: 3, sessionId: 'spec-m6-b', username: 'cashier-b', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec-m6-admin', username: 'admin', role: 'admin',
  permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
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
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code varchar(32), settled_at timestamptz, settled_by bigint, delivery_signature text, delivery_photo_url text, delivery_notes text);
    CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text, sale_id bigint, status text, updated_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, line_discount numeric(15, 3), unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigint PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
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
  await anyDb.insertInto('accounting_accounts').values({ id: 7100, tenant_id: TENANT, code: '7100', name_ar: '7100', is_active: true, is_tax: false, account_type: 'revenue', account_group: 'income' }).execute();
  await anyDb.insertInto('accounting_accounts').values({ id: 7200, tenant_id: TENANT, code: '7200', name_ar: '7200', is_active: true, is_tax: false, account_type: 'expense', account_group: 'operating_expenses' }).execute();
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
  await anyDb.insertInto('products').values({
    id: 102, tenant_id: TENANT, account_id: ACCOUNT, name: 'Widget 102',
    stock_qty: 100, cost_price: 10, retail_price: 131.60,
    wholesale_price: 131.60, min_selling_price: 1,
    is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 102, branch_id: 1, location_id: 10, qty: 100,
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

async function treasuryRows(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('treasury_transactions')
    .select(['txn_type', 'amount', 'reference_type', 'reference_id', 'note'])
    .orderBy('id', 'asc').execute();
}

async function shiftTreasuryRows(db: Kysely<Database>): Promise<any[]> {
  return (await treasuryRows(db)).filter((row) => String(row.reference_type) === 'cashier_shift');
}

async function journalCountBySource(db: Kysely<Database>, sourceType: string, sourceId?: number): Promise<number> {
  let query = (db as any).selectFrom('journal_entries').select('id').where('source_type', '=', sourceType);
  if (sourceId !== undefined) query = query.where('source_id', '=', sourceId);
  return (await query.execute()).length;
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

/** Freelance rep-prepaid order: five Widget 101 at 100 (= 500 goods) + a 30 courier fee = 530 total, paid in full by the rep. Cash due at settlement is 500: the rep keeps his 30 fee. */
function prepaidFreelancePayload(overrides: Record<string, unknown> = {}): any {
  return {
    items: [{ productId: 101, qty: 5, price: 100, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: 530 }], tenderedAmount: 530,
    branchId: 1, locationId: 10, source: 'pos',
    customerId: 7, orderType: 'delivery', deliveryRepId: 1,
    deliveryFee: 30, deliveryFeeMode: 'freelance_courier',
    collectionStatus: 'prepaid_by_rep',
    ...overrides,
  };
}

/** Store-fleet rep-prepaid order: one Widget 102 at 131.60, no fee. Cash due at settlement is the full 131.60. */
function prepaidStoreFleetPayload(overrides: Record<string, unknown> = {}): any {
  return {
    items: [{ productId: 102, qty: 1, price: 131.60, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: 131.60 }], tenderedAmount: 131.60,
    branchId: 1, locationId: 10, source: 'pos',
    customerId: 7, orderType: 'delivery', deliveryRepId: 1,
    deliveryFee: 0, deliveryFeeMode: 'store_fleet',
    collectionStatus: 'prepaid_by_rep',
    ...overrides,
  };
}

/** Store-fleet COD order for 131.60: one Widget 102, no fee, unstated status + courier + full cash tender posts COD, paid 0. */
function codStoreFleetPayload(overrides: Record<string, unknown> = {}): any {
  return {
    items: [{ productId: 102, qty: 1, price: 131.60, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: 131.60 }], tenderedAmount: 131.60,
    branchId: 1, locationId: 10, source: 'pos',
    customerId: 7, orderType: 'delivery', deliveryRepId: 1,
    deliveryFee: 0, deliveryFeeMode: 'store_fleet',
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

  // 1. Single settle, same shift (freelance 530 / 500 due): the
  // creation shift expects NOTHING before the settle (the cash is
  // with the rep), the settle writes exactly one cashier-shift
  // treasury row for 500, the shift then expects exactly 500
  // (once — no double count with the sale), and NO settlement
  // journal is posted (the sale journal already booked Dr 1110).
  await check('M6 single settle: creation shift expects 0 before, treasury row 500 after, no second GL journal', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, drawer, reps } = buildServices(db);
      const saleId = await createAndGetId(sales, prepaidFreelancePayload(), cashierAuth);
      const before = await saleFullRow(db, saleId);
      assert.equal(Number(before.total), 530, 'five Widget 101 at 100 + 30 fee');
      assert.equal(Number(before.paid_amount), 530, 'the rep-prepaid sale posts as paid in full');
      assert.equal(before.collection_status, 'prepaid_by_rep', 'the explicit prepaid status is kept');
      const saleJournal = await journalByCode(db, 'sale', saleId);
      assert.equal(saleJournal.get('1110')?.debit, 530, 'the sale journal already debits cash 530 at creation');
      assert.equal(saleJournal.get('2115')?.credit, 30, 'the sale journal credits the courier fee payable 30');
      assert.equal(await drawer.computeShiftExpectedCash(1, cashierAuth), 0, 'the creation shift expects nothing while the rep holds the cash');
      const settled: any = await reps.settleOrder(saleId, cashierAuth);
      assert.equal(settled?.ok, true, 'settleOrder succeeds for a rep-prepaid order');
      assert.equal(Number(settled?.countedCash), 500, 'the return reports the handed-over cash: paid minus the courier fee');
      assert.equal(Number(settled?.expectedCash), 500, 'the return reports the book cash due 500');
      assert.equal(Number(settled?.variance), 0, 'the return reports no variance');
      const row = await saleFullRow(db, saleId);
      assert.equal(row.delivery_status, 'settled', 'the order is marked settled');
      const shiftRows = await shiftTreasuryRows(db);
      assert.equal(shiftRows.length, 1, 'exactly one cashier-shift treasury row exists');
      assert.equal(shiftRows[0].txn_type, 'cash_in', 'settlement brings cash in');
      assert.equal(Number(shiftRows[0].amount), 500, 'the drawer rises by the handed-over 500, never the 530 total');
      assert.equal(Number(shiftRows[0].reference_id), 1, 'the row links the receiving shift');
      assert.equal((await treasuryRows(db)).length, 2, 'only the creation sale row and the settlement row exist');
      assert.equal(await drawer.computeShiftExpectedCash(1, cashierAuth), 500, 'the shift expects exactly 500 — the sale is not counted twice');
      assert.equal(await journalCountBySource(db, 'delivery_rep_settlement', saleId), 0, 'no settlement journal is posted for a rep-prepaid order');
      assert.equal(await journalCountBySource(db, 'sale', saleId), 1, 'the sale journal is still the only GL entry for the order');
    } finally {
      await db.destroy();
    }
  });

  // 2. Two shifts: created by cashier A (shift 1), settled by
  // cashier B (shift 2). The creation shift never expects the cash
  // — even after settlement — and the receiving shift expects the
  // full 500. At base the creation shift expected 530 (false
  // shortage on close) and the receiving shift expected 0 (false
  // overage on the counted cash).
  await check('M6 two shifts: creation shift stays 0, receiving shift expects 500', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      await seedShift(db, 2, 3);
      const { sales, drawer, reps } = buildServices(db);
      const saleId = await createAndGetId(sales, prepaidFreelancePayload(), cashierAuth);
      assert.equal(await drawer.computeShiftExpectedCash(1, cashierAuth), 0, 'the creation shift expects nothing before settlement');
      assert.equal(await drawer.computeShiftExpectedCash(2, cashierBAuth), 0, 'the receiving shift expects nothing before settlement');
      const settled: any = await reps.settleOrder(saleId, cashierBAuth);
      assert.equal(settled?.ok, true, 'the other cashier settles the rep-prepaid order');
      assert.equal(Number(settled?.countedCash), 500, 'the handover is 500');
      const shiftRows = await shiftTreasuryRows(db);
      assert.equal(shiftRows.length, 1, 'exactly one cashier-shift treasury row exists');
      assert.equal(Number(shiftRows[0].reference_id), 2, 'the row links the receiving shift, not the creation shift');
      assert.equal(Number(shiftRows[0].amount), 500, 'the row carries the handed-over 500');
      assert.equal(await drawer.computeShiftExpectedCash(1, cashierAuth), 0, 'the creation shift still expects nothing after settlement');
      assert.equal(await drawer.computeShiftExpectedCash(2, cashierBAuth), 500, 'the receiving shift expects the handed-over 500');
    } finally {
      await db.destroy();
    }
  });

  // 3. Bulk path mirrors the single path: two rep-prepaid orders
  // (freelance 500 due + store-fleet 131.60 due) settle in one
  // batch for 631.60 with a single batch treasury row, both orders
  // settled, the receiving shift expecting exactly 631.60, and no
  // settlement journals. At base settleAllOrders threw NO_ORDERS
  // for a prepaid-only batch.
  await check('M6 bulk settle: two prepaid orders settle for 631.60 with one batch row and no journals', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, drawer, reps } = buildServices(db);
      const firstId = await createAndGetId(sales, prepaidFreelancePayload(), cashierAuth);
      const secondId = await createAndGetId(sales, prepaidStoreFleetPayload(), cashierAuth);
      const settled: any = await reps.settleAllOrders(1, 631.60, cashierAuth);
      assert.equal(settled?.ok, true, 'settleAllOrders succeeds for a prepaid-only batch');
      assert.equal(Number(settled?.settledCount), 2, 'both orders settle');
      assert.equal(Number(settled?.totalAmount), 631.60, 'the batch total is 500 + 131.60');
      assert.equal(Number(settled?.countedCash), 631.60, 'the counted cash is the batch total');
      assert.equal(Number(settled?.variance), 0, 'the batch reports no variance');
      assert.equal((await saleFullRow(db, firstId)).delivery_status, 'settled', 'the freelance order is settled');
      assert.equal((await saleFullRow(db, secondId)).delivery_status, 'settled', 'the store-fleet order is settled');
      const shiftRows = await shiftTreasuryRows(db);
      assert.equal(shiftRows.length, 1, 'exactly one batch treasury row exists');
      assert.equal(Number(shiftRows[0].amount), 631.60, 'the drawer rises by the full batch handover');
      assert.equal(Number(shiftRows[0].reference_id), 1, 'the row links the receiving shift');
      assert.equal(await drawer.computeShiftExpectedCash(1, cashierAuth), 631.60, 'the shift expects exactly the batch handover — no double count');
      assert.equal(await journalCountBySource(db, 'delivery_rep_settlement'), 0, 'no settlement journal is posted for the batch');
    } finally {
      await db.destroy();
    }
  });

  // 4. Rep summary reflects rep-prepaid cash: an unsettled
  // rep-prepaid order (500 due) and an unsettled COD order (131.60
  // due) are both pending; after the prepaid order settles, its
  // 500 moves to collected and pending drops to the COD 131.60.
  // At base the summary reported pending 131.60 only — the rep
  // holding 500 looked like he owed nothing.
  await check('M6 rep summary: prepaid pending 500 + COD pending 131.60, then collected 500 after settle', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, reps } = buildServices(db);
      const prepaidId = await createAndGetId(sales, prepaidFreelancePayload(), cashierAuth);
      await createAndGetId(sales, codStoreFleetPayload(), cashierAuth);
      const before: any = await reps.getRepSummary(1, cashierAuth);
      assert.equal(Number(before.summary?.totalOrders), 2, 'the rep has two orders');
      assert.equal(Number(before.summary?.pendingAmount), 631.60, 'pending counts the prepaid 500 and the COD 131.60');
      assert.equal(Number(before.summary?.collectedAmount), 0, 'nothing collected yet');
      await reps.settleOrder(prepaidId, cashierAuth);
      const after: any = await reps.getRepSummary(1, cashierAuth);
      assert.equal(Number(after.summary?.pendingAmount), 131.60, 'only the COD order is still pending');
      assert.equal(Number(after.summary?.collectedAmount), 500, 'the settled prepaid 500 is collected');
    } finally {
      await db.destroy();
    }
  });

  // 5. Counted cash applies to rep-prepaid orders: counted 480 of
  // a 500 book due reports variance -20 and the drawer rises by
  // the counted 480. A counted amount on a prepaid_online order
  // still fails closed with the D-SF-01 specific code (the gate
  // now admits COD and rep-prepaid only).
  await check('M6 counted cash: prepaid short handover reports -20 and drawer +480; prepaid_online still rejected', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, drawer, reps } = buildServices(db);
      const saleId = await createAndGetId(sales, prepaidFreelancePayload(), cashierAuth);
      const settled: any = await reps.settleOrder(saleId, cashierAuth, { countedCashAmount: 480 });
      assert.equal(Number(settled?.countedCash), 480, 'the return reports the counted cash');
      assert.equal(Number(settled?.expectedCash), 500, 'the return reports the book cash due');
      assert.equal(Number(settled?.variance), -20, 'the return reports the shortage');
      const shiftRows = await shiftTreasuryRows(db);
      assert.equal(shiftRows.length, 1, 'exactly one treasury row exists');
      assert.equal(Number(shiftRows[0].amount), 480, 'the drawer rises by the counted 480, never the book 500');
      assert.equal(await drawer.computeShiftExpectedCash(1, cashierAuth), 480, 'the shift expects the counted cash');
      assert.equal(await journalCountBySource(db, 'delivery_rep_settlement', saleId), 0, 'no settlement journal is posted');
    } finally {
      await db.destroy();
    }
  });

  await check('M6 counted cash on prepaid_online still fails closed with DELIVERY_SETTLEMENT_COUNTED_CASH_NOT_APPLICABLE', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, reps } = buildServices(db);
      const saleId = await createAndGetId(sales, prepaidFreelancePayload({ collectionStatus: 'prepaid_online' }), cashierAuth);
      const before = await saleFullRow(db, saleId);
      assert.equal(before.collection_status, 'prepaid_online', 'the explicit prepaid status is kept');
      await assert.rejects(
        reps.settleOrder(saleId, cashierAuth, { countedCashAmount: 100 }),
        (err: any) => err && err.code === 'DELIVERY_SETTLEMENT_COUNTED_CASH_NOT_APPLICABLE',
      );
      const row = await saleFullRow(db, saleId);
      assert.notEqual(row.delivery_status, 'settled', 'the failed settle leaves the order unsettled');
    } finally {
      await db.destroy();
    }
  });

  // 6. No open shift fails the prepaid settle closed: the cash has
  // no receiving drawer to land in, so nothing is written and the
  // order stays unsettled (mirrors the COD NO_OPEN_SHIFT guard).
  await check('M6 no open shift fails closed with NO_OPEN_SHIFT and writes nothing', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { reps } = buildServices(db);
      await (db as any).insertInto('sales').values({
        id: 90, tenant_id: TENANT, account_id: ACCOUNT, customer_id: 7,
        payment_type: 'cash', payment_channel: 'cash', total: 530, paid_amount: 530,
        delivery_fee: 30, delivery_fee_mode: 'freelance_courier',
        status: 'posted', collection_status: 'prepaid_by_rep', order_type: 'delivery',
        delivery_status: 'pending', delivery_rep_id: 1,
        branch_id: 1, location_id: 10, created_by: 2, created_at: '2026-01-02T00:00:00.000Z',
      }).execute();
      await (db as any).insertInto('sale_payments').values({
        tenant_id: TENANT, account_id: ACCOUNT, sale_id: 90, payment_channel: 'cash', amount: 530,
      }).execute();
      await assert.rejects(
        reps.settleOrder(90, adminAuth),
        (err: any) => err && err.code === 'NO_OPEN_SHIFT',
      );
      const row = await saleFullRow(db, 90);
      assert.notEqual(row.delivery_status, 'settled', 'the failed settle leaves the order unsettled');
      assert.equal((await treasuryRows(db)).length, 0, 'no treasury row is written');
    } finally {
      await db.destroy();
    }
  });

  if (failures.length) throw new Error(`${failures.length} M6 case(s) failed: ${failures.join(', ')}`);
  console.log('M6 rep-prepaid shift treasury tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
