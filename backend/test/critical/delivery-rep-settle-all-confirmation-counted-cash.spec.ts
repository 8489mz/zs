/* INV-SETTLE-ALL-CONFIRMATION-COUNTED-CASH (B5 + C7) — the
 * settleAllOrders confirmation gate is bypassed when expectedAmount
 * is omitted, and the batch has no counted-cash / variance path.
 *
 * B5: the gate read `actualTotal - undefined` = NaN, and
 * `NaN > 0.01` is false, so omitting the field settled a short
 * batch as if it had matched. Secondary: the 0.01 tolerance was
 * hardcoded, not the tenant's moneyDigits. After the fix a missing,
 * non-numeric or negative expectedAmount refuses with
 * SETTLEMENT_AMOUNT_INVALID before any write, and the mismatch
 * tolerance is 10^-moneyDigits (the same tolerance the posting
 * service uses).
 *
 * C7: settleAllOrders took only (repId, expectedAmount) and called
 * postDeliveryRepSettlement without opts.countedCash, so the
 * difference was always 0. After the fix it accepts an optional
 * countedCashAmount, allocates it across the orders in id order
 * (each order counted up to its own cash due; any overage beyond
 * every due lands on the last order), and passes each order's
 * counted share to postDeliveryRepSettlement — the same call the
 * single-order path (D-SF-01) already makes — so a shortage books
 * Dr 7200 and an overage Cr 7100, the drawer rises by the counted
 * cash only, and the receivables still clear in full. Omitting the
 * counted amount keeps the old behaviour exactly (counted = book).
 *
 * Base-red: at base the missing-expectedAmount call settles both
 * orders, and a counted shortfall settles with the full book cash
 * in the drawer and no 7200 leg.
 *
 * Run: npx ts-node test/critical/delivery-rep-settle-all-confirmation-counted-cash.spec.ts
 * (from backend/). Same PGlite script harness as
 * delivery-rep-custody-net-returns.spec.ts: one fresh in-memory
 * database per case, db.destroy() teardown only.
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
  userId: 2, sessionId: 'spec-sf1-p1', username: 'cashier-a', role: 'cashier',
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
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, line_discount numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
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
  // The variance accounts are seeded explicitly (like 2115) so the
  // resolver finds them: the auto-create path needs columns this
  // harness DDL does not carry.
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
  // The live reproduction total: one item at 131.60.
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

/** A posted full/partial return of one sale, seeded as the journal
 * itself: return_documents + a 'sales_return' journal whose Cr 1130
 * leg is exactly what priorSalesReturnReceivableCredit (inside
 * deliverySettlementBasis) reads. Mirrors what postSalesReturn posts
 * live for return ZR-261110-0601 (Dr 4100 / Cr 1130). */
async function seedReturn(db: Kysely<Database>, returnDocId: number, journalId: number, saleId: number, amount: number): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('return_documents').values({
    id: returnDocId, tenant_id: TENANT, doc_no: `ZR-TEST-${returnDocId}`,
    return_type: 'sale', invoice_id: saleId, total: amount,
    exchange_tip_relief: 0, exchange_courier_relief: 0, created_by: 2,
  }).execute();
  await anyDb.insertInto('journal_entries').values({
    id: journalId, tenant_id: TENANT, account_id: ACCOUNT,
    entry_no: `JE-TEST-${journalId}`, entry_date: '2026-01-02',
    description: 'test return', source_type: 'sales_return',
    source_id: returnDocId, status: 'posted', created_by: 2,
  }).execute();
  await anyDb.insertInto('journal_entry_lines').values({
    tenant_id: TENANT, journal_entry_id: journalId, account_id: 4100,
    description: 'test return revenue reversal', debit: amount, credit: 0,
  }).execute();
  await anyDb.insertInto('journal_entry_lines').values({
    tenant_id: TENANT, journal_entry_id: journalId, account_id: 1130,
    description: 'test return receivable reversal', debit: 0, credit: amount,
  }).execute();
}

async function summaryOf(reps: DeliveryRepsService): Promise<{ totalOrders: number; collectedAmount: number; pendingAmount: number }> {
  const res: any = await reps.getRepSummary(1, cashierAuth);
  return {
    totalOrders: Number(res?.summary?.totalOrders),
    collectedAmount: Number(res?.summary?.collectedAmount),
    pendingAmount: Number(res?.summary?.pendingAmount),
  };
}

async function createFourSales(sales: SalesWriteService): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < 4; i++) {
    ids.push(await createAndGetId(sales, storeFleetPayload(), cashierAuth));
  }
  return ids;
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

/** Store-fleet COD order for the live total 131.60: one Widget 102, no fee, unstated status + courier + full cash tender posts COD, paid 0. */
function storeFleetPayload(overrides: Record<string, unknown> = {}): any {
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

  async function twoSales(): Promise<{ pg: PGlite; db: Kysely<Database>; saleIds: number[] }> {
    const { pg, db } = await makeDb();
    await seedFoundation(db);
    await seedShift(db, 1, 2);
    const { sales } = buildServices(db);
    const saleIds = [
      await createAndGetId(sales, storeFleetPayload(), cashierAuth),
      await createAndGetId(sales, storeFleetPayload(), cashierAuth),
    ];
    return { pg, db, saleIds };
  }

  async function unsettledCount(db: Kysely<Database>): Promise<number> {
    const rows = await (db as any).selectFrom('sales').select('id')
      .where('delivery_status', '!=', 'settled').execute();
    return rows.length;
  }

  // 1. B5 base-red: omitting expectedAmount settled the batch
  // silently (actualTotal - undefined = NaN, NaN > 0.01 is false).
  // After the fix the call refuses with a specific error and no
  // order is settled.
  await check('B5 missing expectedAmount refuses SETTLEMENT_AMOUNT_INVALID and settles nothing', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, reps } = buildServices(db);
      await createAndGetId(sales, storeFleetPayload(), cashierAuth);
      await createAndGetId(sales, storeFleetPayload(), cashierAuth);
      await assert.rejects(
        reps.settleAllOrders(1, undefined as unknown as number, cashierAuth),
        (error: any) => error.code === 'SETTLEMENT_AMOUNT_INVALID' && String(error.message).includes('Expected settlement amount'),
      );
      assert.equal(await unsettledCount(db), 2, 'both orders stay unsettled after the refusal');
      assert.equal((await treasuryRows(db)).length, 0, 'no treasury row is written');
    } finally {
      await db.destroy();
    }
  });

  // 2. A non-numeric expectedAmount ('abc', NaN) is the same
  // bypass in another shape and must refuse the same way.
  await check('B5 non-numeric expectedAmount refuses SETTLEMENT_AMOUNT_INVALID', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, reps } = buildServices(db);
      await createAndGetId(sales, storeFleetPayload(), cashierAuth);
      await assert.rejects(
        reps.settleAllOrders(1, 'abc' as unknown as number, cashierAuth),
        (error: any) => error.code === 'SETTLEMENT_AMOUNT_INVALID',
      );
      await assert.rejects(
        reps.settleAllOrders(1, NaN, cashierAuth),
        (error: any) => error.code === 'SETTLEMENT_AMOUNT_INVALID',
      );
      assert.equal(await unsettledCount(db), 1, 'the order stays unsettled after both refusals');
    } finally {
      await db.destroy();
    }
  });

  // 3. C7 shortfall: book 263.20 (two store-fleet orders of
  // 131.60, no fee), counted 250.00. The 13.20 shortage must land
  // on Dr 7200 in the second order's settlement journal (the
  // greedy allocation counts the first order in full), the drawer
  // rises by the counted 250.00 only, and both receivables still
  // clear in full (Cr 1130 263.20 in total).
  await check('C7 shortfall: counted 250.00 of 263.20 books Dr 7200 13.20 and drawer +250.00 only', async () => {
    const { pg, db, saleIds } = await twoSales();
    try {
      const { reps } = buildServices(db);
      const settled: any = await reps.settleAllOrders(1, 263.20, cashierAuth, 250.00);
      assert.equal(settled?.ok, true, 'the batch settles with a booked shortage');
      assert.equal(Number(settled?.settledCount), 2, 'both orders settle');
      assert.equal(Number(settled?.totalAmount), 263.20, 'the book total is unchanged');
      assert.equal(Number(settled?.countedCash), 250.00, 'the counted cash is reported');
      assert.equal(Number(settled?.variance), -13.20, 'the variance is the shortage');
      const treasury = await treasuryRows(db);
      assert.equal(treasury.length, 1, 'exactly one treasury row exists');
      assert.equal(Number(treasury[0].amount), 250.00, 'the drawer rises by the counted cash only');
      const first = await journalByCode(db, 'delivery_rep_settlement', saleIds[0]);
      assert.equal(first.get('7200'), undefined, 'the fully-counted first order has no shortage leg');
      assert.equal(first.get('1110')?.debit, 131.60, 'the first order books its full cash');
      assert.equal(first.get('1130')?.credit, 131.60, 'the first order clears its receivable');
      const second = await journalByCode(db, 'delivery_rep_settlement', saleIds[1]);
      assert.equal(second.get('7200')?.debit, 13.20, 'the shortage is booked to 7200');
      assert.equal(second.get('1110')?.debit, 118.40, 'the second order books only the cash counted for it');
      assert.equal(second.get('1130')?.credit, 131.60, 'the second order still clears its full receivable');
      assert.equal(second.get('7100'), undefined, 'no overage leg exists');
      assert.equal(await unsettledCount(db), 0, 'both orders are settled');
    } finally {
      await db.destroy();
    }
  });

  // 4. Counted cash equal to expected settles with zero
  // difference: no 7200/7100 leg anywhere, drawer +263.20.
  await check('C7 counted equals expected: zero difference, no 7200/7100 leg, drawer +263.20', async () => {
    const { pg, db, saleIds } = await twoSales();
    try {
      const { reps } = buildServices(db);
      const settled: any = await reps.settleAllOrders(1, 263.20, cashierAuth, 263.20);
      assert.equal(settled?.ok, true, 'the batch settles');
      assert.equal(Number(settled?.variance), 0, 'the variance is zero');
      const treasury = await treasuryRows(db);
      assert.equal(treasury.length, 1, 'exactly one treasury row exists');
      assert.equal(Number(treasury[0].amount), 263.20, 'the drawer rises by the full book total');
      for (const saleId of saleIds) {
        const journal = await journalByCode(db, 'delivery_rep_settlement', saleId);
        assert.equal(journal.get('7200'), undefined, 'no shortage leg exists');
        assert.equal(journal.get('7100'), undefined, 'no overage leg exists');
        assert.equal(journal.get('1110')?.debit, 131.60, 'each order books its full cash');
        assert.equal(journal.get('1130')?.credit, 131.60, 'each order clears its receivable');
      }
    } finally {
      await db.destroy();
    }
  });

  // 5. Overage mirror: counted 270.00 of 263.20 books the 6.80
  // excess to Cr 7100 and the drawer rises by 270.00.
  await check('C7 overage: counted 270.00 of 263.20 books Cr 7100 6.80 and drawer +270.00', async () => {
    const { pg, db, saleIds } = await twoSales();
    try {
      const { reps } = buildServices(db);
      const settled: any = await reps.settleAllOrders(1, 263.20, cashierAuth, 270.00);
      assert.equal(settled?.ok, true, 'the batch settles with a booked overage');
      assert.equal(Number(settled?.variance), 6.80, 'the variance is the overage');
      const treasury = await treasuryRows(db);
      assert.equal(Number(treasury[0].amount), 270.00, 'the drawer rises by the counted cash');
      const second = await journalByCode(db, 'delivery_rep_settlement', saleIds[1]);
      assert.equal(second.get('7100')?.credit, 6.80, 'the overage is booked to 7100');
      assert.equal(second.get('1110')?.debit, 138.40, 'the second order books its due plus the overage');
      assert.equal(second.get('7200'), undefined, 'no shortage leg exists');
    } finally {
      await db.destroy();
    }
  });

  // 6. A negative counted amount is not a count: refuse it up
  // front, like the single-order path.
  await check('C7 negative countedCashAmount refuses SETTLEMENT_AMOUNT_INVALID', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, reps } = buildServices(db);
      await createAndGetId(sales, storeFleetPayload(), cashierAuth);
      await assert.rejects(
        reps.settleAllOrders(1, 131.60, cashierAuth, -5),
        (error: any) => error.code === 'SETTLEMENT_AMOUNT_INVALID',
      );
      assert.equal(await unsettledCount(db), 1, 'the order stays unsettled');
    } finally {
      await db.destroy();
    }
  });

  // 7. The confirmation gate itself still works: a wrong
  // expectedAmount refuses AMOUNT_MISMATCH even when a counted
  // amount is supplied, and omitting the counted amount keeps the
  // old exact-match behaviour.
  await check('B5 gate intact: wrong expectedAmount still refuses AMOUNT_MISMATCH; omitted counted keeps old behaviour', async () => {
    const { pg, db, saleIds } = await twoSales();
    try {
      const { reps } = buildServices(db);
      await assert.rejects(
        reps.settleAllOrders(1, 200, cashierAuth, 200),
        (error: any) => error.code === 'AMOUNT_MISMATCH',
      );
      assert.equal(await unsettledCount(db), 2, 'nothing settles on a mismatch');
      const settled: any = await reps.settleAllOrders(1, 263.20, cashierAuth);
      assert.equal(settled?.ok, true, 'the old no-counted call still settles on an exact match');
      assert.equal(Number(settled?.countedCash), 263.20, 'omitted counted defaults to the book total');
      assert.equal(Number(settled?.variance), 0, 'no variance without a counted amount');
      const treasury = await treasuryRows(db);
      assert.equal(Number(treasury[0].amount), 263.20, 'the drawer rises by the book total');
    } finally {
      await db.destroy();
    }
  });

  if (failures.length) throw new Error(`${failures.length} settle-all-confirmation case(s) failed: ${failures.join(', ')}`);
  console.log('settle-all-confirmation-counted-cash tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
