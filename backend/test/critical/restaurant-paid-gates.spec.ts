/*
New file: backend/test/critical/restaurant-paid-gates.spec.ts

WHAT THIS PINS (INV-REST-PAID-GATES-2, R4-D "paid gates leftovers",
I27/I28/I39-I45): the POS submit gates that the frontend used to
enforce alone — or not at all. Before this package:

- I28: an underpaid cash sale with a customer silently flipped to
  payment_type 'credit' (isPartialCredit), so a cashier's short
  payment posted as a receivable with the cash/card channel intact.
- I40: a terminal approval recorded no amount anywhere, so a card
  leg edited after approval posted for a different amount than the
  terminal charged.
- I42: a dine-in sale with no table posted, and a second held draft
  could claim a table that already had one.
- I43: a COD delivery with no customer and paid 0 posted as a cash
  sale with no debtor and no receivable; COD + customer flipped to
  credit instead of staying cash/COD with a customer-ledger debt.
  (Grounded correction, 2026-11-09: an EMPTY payments array does NOT
  reproduce the short payment — allocateSaleTenders synthesises a
  full cash payment on the fallback channel when no leg is declared,
  so a no-legs COD sale posts fully paid. The reproducible hole needs
  a declared partial leg, e.g. cash 50 on a 100 total. The no-legs
  COD shape posting as fully paid while treasury skips COD is a
  separate follow-up on the tender fallback, not this package:
  sale-tender.engine.ts is hands-off here.)
- I44: a 100%-discounted cart posted a zero-total sale.

After the fix all five are rejected (or, for COD + customer, posted
in the cash/COD shape with the ledger debt) by the pure
assertPosSubmitGates helper, called from createSale — and, for the
flip, from updateSale — with POS-source-only scope. Dashboard
conversions keep the old flip: an unpaid storefront COD conversion
still posts as credit, and an underpaid dashboard edit still flips.

THE FIX: backend/src/modules/sales/engines/pos-submit-gates.engine.ts
(pure, unit-testable) + one call in createSale after tender
allocation, one call in updateSale at the same flip, and one
duplicate-table SELECT before the held_sales insert in saveHeldSale.

WHAT R7-D (INV-REST-COD-TENDER-TRUTH) PINS, in the same harness:
the follow-up the R4-D header named and left open — a no-legs COD
sale posted as fully paid because allocateSaleTenders invented a
full cash leg, while treasury skips COD and settlement then refused
the order (paid_amount > 0.009). After the fix the engine takes a
suppressFallback flag computed by the pure
shouldSuppressTenderFallback helper (delivery + not explicitly
prepaid), createSale and updateSale both pass it, and the edit
path also gains createSale's COD carve-out on its underpaid gate
(it had none — the fallback had always masked it). A no-legs COD
sale now posts paid 0, payment_type cash, collection_status 'cod',
zero sale_payments rows, Dr 1130 for the full total with no Dr 1110
leg, a customer-ledger debt, and no treasury row — and the real
DeliveryRepsService.settleOrder then settles it end to end
(treasury cash_in of total minus fee, settlement journal Dr 1110 +
Dr 2115 / Cr 1130, ledger nets to zero). The counter-cash fallback
is untouched (a no-legs takeaway sale still posts fully paid cash),
a declared partial COD leg posts exactly as typed, an explicit
prepaid_online delivery keeps the fallback, and a non-delivery
underpaid edit still throws INVALID_PAID_AMOUNT.

REGRESSION GUARDS (already enforced at base — these cases pass
before the fix too, and must keep passing): I41 — a credit sale
with no open shift is rejected OPEN_SHIFT_REQUIRED by the backend
gate; I27 — a recalled discount / edited price without a manager
PIN is rejected by assertDiscountChangeAllowed /
assertUnitPriceChangeAllowed.

HOW THIS IS DRIVEN: the real createSale / saveHeldSale on PGlite,
with the real authorization, finance, query, posting, idempotency
and audit services (same harness as
admin-cash-sale-shift-required.spec.ts). Teardown is db.destroy()
only. No harness exists that runs a full successful createSale on
a live Postgres here, so live-Postgres acceptance remains deferred
by written decision.
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
import { allocateSaleTenders, shouldSuppressTenderFallback } from '../../src/modules/sales/engines/sale-tender.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';
const MANAGER_PIN = '1234';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const cashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec-a', username: 'cashier-a', role: 'cashier',
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
  // R7-D: the freelance-courier fee credits 2115 on postSale. Seed
  // it as a liability (the type resolveSystemAccountByCode enforces)
  // instead of relying on the auto-create, whose insert needs
  // normal_balance / is_system columns this harness does not carry.
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

/** Base POS payload: one Widget 101 at the given total, fully paid in cash. */
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

async function saleRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('sales').select(['payment_type', 'total', 'paid_amount', 'table_number', 'order_type'])
    .where('id', '=', id).executeTakeFirstOrThrow();
}

async function ledgerRows(db: Kysely<Database>, customerId: number): Promise<any[]> {
  return (db as any).selectFrom('customer_ledger').select(['amount', 'reference_id'])
    .where('customer_id', '=', customerId).execute();
}

// R7-D helpers: the full sale row, its payment rows, treasury rows,
// and one journal's legs summed per account code.
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

/** The R7-D fixture: five Widget 101 at 100 (= 500 goods) + a 30 freelance-courier fee = 530 total, COD, no legs. */
function codPayload(overrides: Record<string, unknown> = {}): any {
  return {
    items: [{ productId: 101, qty: 5, price: 100, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [], tenderedAmount: 0, branchId: 1, locationId: 10, source: 'pos',
    customerId: 7, orderType: 'delivery', collectionStatus: 'cod', deliveryRepId: 1,
    deliveryFee: 30,
    ...overrides,
  };
}

function heldPayload(tableNumber: string, overrides: Record<string, unknown> = {}): any {
  return {
    items: [{ productId: 101, name: 'Widget 101', qty: 1, price: 100, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail' }],
    customerId: null, paymentType: 'cash', paymentChannel: 'cash',
    cashAmount: 0, cardAmount: 0, transferAmount: 0, discount: 0, deliveryFee: 0,
    note: '', search: '', priceType: 'retail', branchId: 1, locationId: 10,
    orderType: 'dine_in', tableNumber,
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

  // 1. I28 — underpaid cash + customer: at base this silently flips to
  // payment_type 'credit' and posts. After the fix it is rejected
  // INVALID_PAID_AMOUNT; the cashier must complete the payment or
  // switch explicitly to credit (D-R4D-1).
  await check('I28 underpaid cash + customer no longer flips to credit', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      await assert.rejects(
        createAndGetId(sales, posPayload(100, {
          customerId: 7,
          payments: [{ paymentChannel: 'cash', amount: 50 }],
          tenderedAmount: 50,
        }), cashierAuth),
        (err: any) => err && err.code === 'INVALID_PAID_AMOUNT',
      );
      const count = await (db as any).selectFrom('sales').select(sql`count(*)`.as('n')).executeTakeFirst();
      assert.equal(Number((count as any).n), 0, 'no sale is written');
    } finally {
      await db.destroy();
    }
  });

  // 2. I28, explicit credit still works: an underpaid sale the cashier
  // explicitly marked credit posts as credit with the customer attached.
  await check('I28 explicit credit still posts as credit', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, posPayload(100, {
        customerId: 7, paymentType: 'credit', paymentChannel: 'credit', payments: [],
        tenderedAmount: 0,
      }), cashierAuth);
      const row = await saleRow(db, saleId);
      assert.equal(row.payment_type, 'credit', 'explicit credit posts as credit');
    } finally {
      await db.destroy();
    }
  });

  // 3. I40 — terminal approval for 100, card leg 90: at base the
  // approved amount is dropped and the sale posts. After the fix it is
  // rejected 422 TERMINAL_AMOUNT_MISMATCH.
  await check('I40 card leg below the terminal-approved amount is rejected', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      await assert.rejects(
        createAndGetId(sales, posPayload(100, {
          paymentChannel: 'card',
          payments: [
            { paymentChannel: 'card', amount: 90 },
            { paymentChannel: 'cash', amount: 10 },
          ],
          tenderedAmount: 10,
          terminalAuthCode: 'AUTH-1',
          terminalApprovedAmount: 100,
        }), cashierAuth),
        (err: any) => err && err.code === 'TERMINAL_AMOUNT_MISMATCH' && err.statusCode === 422,
      );
    } finally {
      await db.destroy();
    }
  });

  // 4. I40, matching leg posts: card 100 against an approval for 100.
  await check('I40 card leg equal to the terminal-approved amount posts', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, posPayload(100, {
        paymentChannel: 'card',
        payments: [{ paymentChannel: 'card', amount: 100 }],
        tenderedAmount: 0,
        terminalAuthCode: 'AUTH-1',
        terminalApprovedAmount: 100,
      }), cashierAuth);
      assert.ok(saleId > 0, 'the matching terminal sale posts');
    } finally {
      await db.destroy();
    }
  });

  // 5. I42 — dine-in with no table: at base it posts with an empty
  // table number. After the fix it is rejected DINE_IN_TABLE_REQUIRED.
  await check('I42 dine-in without a table is rejected', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      await assert.rejects(
        createAndGetId(sales, posPayload(100, { orderType: 'dine_in' }), cashierAuth),
        (err: any) => err && err.code === 'DINE_IN_TABLE_REQUIRED',
      );
    } finally {
      await db.destroy();
    }
  });

  // 6. I42, dine-in WITH a table posts.
  await check('I42 dine-in with a table posts', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, posPayload(100, { orderType: 'dine_in', tableNumber: 'T1' }), cashierAuth);
      const row = await saleRow(db, saleId);
      assert.equal(row.table_number, 'T1', 'the table number is stored');
    } finally {
      await db.destroy();
    }
  });

  // 7. I42 — second held draft on the same table: at base it inserts.
  // After the fix it is rejected 409 HELD_DRAFT_TABLE_OCCUPIED. A
  // different table and a blank table still hold fine.
  await check('I42 second held draft on one table is rejected', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { sales } = buildServices(db);
      const first: any = await sales.saveHeldSale(heldPayload('T1'), cashierAuth);
      assert.ok(Array.isArray(first?.heldSales) && first.heldSales.length === 1, 'the first hold is saved');
      await assert.rejects(
        sales.saveHeldSale(heldPayload('T1'), cashierAuth),
        (err: any) => err && err.code === 'HELD_DRAFT_TABLE_OCCUPIED' && err.statusCode === 409,
      );
      const second: any = await sales.saveHeldSale(heldPayload('T2'), cashierAuth);
      assert.ok(Array.isArray(second?.heldSales) && second.heldSales.some((h: any) => h.tableNumber === 'T2'), 'a different table still holds');
      const blank: any = await sales.saveHeldSale(heldPayload(''), cashierAuth);
      assert.ok(Array.isArray(blank?.heldSales) && blank.heldSales.some((h: any) => !h.tableNumber), 'a hold without a table still holds');
    } finally {
      await db.destroy();
    }
  });

  // 8. I43 — COD delivery, no customer, short-paid: at base it posts
  // as a cash sale with no debtor and no receivable (the !isDelivery
  // carve-out at :1631 skips the customer-required check). After the
  // fix it is rejected CUSTOMER_REQUIRED_FOR_CREDIT. (A declared
  // partial leg is the reproducing shape: an empty payments array is
  // auto-filled to full by the tender fallback — see the header.)
  await check('I43 COD with no customer and a short payment is rejected', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      await assert.rejects(
        createAndGetId(sales, posPayload(100, {
          orderType: 'delivery', collectionStatus: 'cod', deliveryRepId: 1,
          payments: [{ paymentChannel: 'cash', amount: 50 }], tenderedAmount: 50,
        }), cashierAuth),
        (err: any) => err && err.code === 'CUSTOMER_REQUIRED_FOR_CREDIT',
      );
    } finally {
      await db.destroy();
    }
  });

  // 9. I43 — COD + customer + short-paid: at base it flips to credit.
  // After the fix it stays cash/COD and the remainder is written to
  // the customer ledger as a debt (D-R4D-3).
  await check('I43 COD + customer stays cash with a ledger debt', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, posPayload(100, {
        customerId: 7, orderType: 'delivery', collectionStatus: 'cod', deliveryRepId: 1,
        payments: [{ paymentChannel: 'cash', amount: 50 }], tenderedAmount: 50,
      }), cashierAuth);
      const row = await saleRow(db, saleId);
      assert.equal(row.payment_type, 'cash', 'COD + customer stays cash, never reclassified to credit');
      const legs = await ledgerRows(db, 7);
      assert.ok(
        legs.some((leg) => Number(leg.reference_id) === saleId && Number(leg.amount) === 50),
        'the unpaid 50 is a customer-ledger debt on this sale',
      );
    } finally {
      await db.destroy();
    }
  });

  // 10. I44 — 100% discount: at base a zero-total sale posts. After
  // the fix it is rejected ZERO_TOTAL_SALE (D-R4D-2: no comp flow
  // exists; comps are a future feature, not a silent zero sale).
  await check('I44 zero-total POS sale is rejected', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      await assert.rejects(
        createAndGetId(sales, posPayload(100, { discount: 100, payments: [], tenderedAmount: 0, managerPin: '1234' }), cashierAuth),
        (err: any) => err && err.code === 'ZERO_TOTAL_SALE',
      );
    } finally {
      await db.destroy();
    }
  });

  // 11. I41 REGRESSION GUARD (passes at base): a credit sale with no
  // open shift is already rejected by the backend gate — the frontend
  // fix only aligns the workspace flag with it.
  await check('I41 backend credit-sale shift gate still rejects without a shift', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { sales } = buildServices(db);
      await assert.rejects(
        createAndGetId(sales, posPayload(100, {
          customerId: 7, paymentType: 'credit', paymentChannel: 'credit', payments: [],
          tenderedAmount: 0,
        }), cashierAuth),
        (err: any) => err && err.code === 'OPEN_SHIFT_REQUIRED',
      );
    } finally {
      await db.destroy();
    }
  });

  // 12. I27 REGRESSION GUARD (passes at base): a recalled discount
  // without a manager PIN, and an edited price without a PIN, are
  // already rejected by the backend gates — the frontend fix only
  // wires the workspace flags into handleSubmit.
  await check('I27 backend discount/price gates still reject without a PIN', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { sales } = buildServices(db);
      await assert.rejects(
        createAndGetId(sales, posPayload(100, { discount: 5 }), cashierAuth),
        (err: any) => err && err.code === 'MANAGER_AUTH_REQUIRED',
      );
      await assert.rejects(
        createAndGetId(sales, {
          items: [{ productId: 101, qty: 1, price: 90, priceType: 'retail', unitMultiplier: 1 }],
          discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
          payments: [{ paymentChannel: 'cash', amount: 90 }],
          tenderedAmount: 90, branchId: 1, locationId: 10, source: 'pos',
        }, cashierAuth),
        (err: any) => err && err.code === 'MANAGER_AUTH_REQUIRED',
      );
    } finally {
      await db.destroy();
    }
  });

  // 13. D-R4D-4 — dashboard conversions keep the old flip: an unpaid
  // storefront-style COD conversion (source 'dashboard', customer
  // attached, no payments) still posts as credit, and an underpaid
  // dashboard edit still flips. The POS-only gates never touch them.
  await check('D-R4D-4 dashboard conversions keep the old flip', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const codId = await createAndGetId(sales, posPayload(100, {
        source: 'dashboard', customerId: 7, orderType: 'delivery',
        collectionStatus: 'cod', deliveryRepId: 1,
        payments: [{ paymentChannel: 'cash', amount: 50 }], tenderedAmount: 50,
      }), cashierAuth);
      assert.equal((await saleRow(db, codId)).payment_type, 'credit', 'dashboard COD conversion still flips to credit');
      const partialId = await createAndGetId(sales, posPayload(100, {
        source: 'dashboard', customerId: 7,
        payments: [{ paymentChannel: 'cash', amount: 50 }], tenderedAmount: 50,
      }), cashierAuth);
      assert.equal((await saleRow(db, partialId)).payment_type, 'credit', 'dashboard underpaid conversion still flips to credit');
    } finally {
      await db.destroy();
    }
  });

  // 14. Happy path: a normal POS cash sale with a shift still posts.
  await check('happy-path POS cash sale still posts', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, posPayload(100), cashierAuth);
      const row = await saleRow(db, saleId);
      assert.equal(row.payment_type, 'cash', 'the happy-path sale posts as cash');
      assert.equal(Number(row.total), 100, 'the happy-path total is 100');
      assert.equal(Number(row.paid_amount), 100, 'the happy-path paid is 100');
    } finally {
      await db.destroy();
    }
  });

  // 15. R7-D pure engine: the suppressFallback flag stops the
  // invented leg, and the helper decides it from delivery + status.
  await check('R7-D tender fallback suppression is a pure engine decision', async () => {
    const base = { paymentType: 'cash' as const, payments: [], collectibleTotal: 500, fallbackChannel: 'cash' as const };
    const suppressed = allocateSaleTenders({ ...base, suppressFallback: true });
    assert.deepEqual(suppressed.payments, [], 'a suppressed fallback invents no leg');
    assert.equal(suppressed.appliedAmount, 0, 'a suppressed fallback applies nothing');
    const kept = allocateSaleTenders(base);
    assert.equal(kept.payments.length, 1, 'without the flag the fallback still fires');
    assert.equal(kept.payments[0].paymentChannel, 'cash', 'the fallback leg is cash');
    assert.equal(kept.appliedAmount, 500, 'the fallback leg covers the full total');
    // The helper: COD and unstated-status deliveries suppress; explicit
    // prepaid deliveries, non-deliveries and credit sales do not.
    assert.equal(shouldSuppressTenderFallback({ orderType: 'delivery', collectionStatus: 'cod', paymentType: 'cash' }), true);
    assert.equal(shouldSuppressTenderFallback({ orderType: 'delivery', collectionStatus: null, paymentType: 'cash' }), true);
    assert.equal(shouldSuppressTenderFallback({ orderType: 'delivery', collectionStatus: undefined, paymentType: 'cash' }), true);
    assert.equal(shouldSuppressTenderFallback({ orderType: 'delivery', collectionStatus: 'prepaid_online', paymentType: 'cash' }), false);
    assert.equal(shouldSuppressTenderFallback({ orderType: 'delivery', collectionStatus: 'prepaid_by_rep', paymentType: 'cash' }), false);
    assert.equal(shouldSuppressTenderFallback({ orderType: 'takeaway', collectionStatus: 'cod', paymentType: 'cash' }), false);
    assert.equal(shouldSuppressTenderFallback({ orderType: 'delivery', collectionStatus: 'cod', paymentType: 'credit' }), false);
  });

  // 16. R7-D createSale: a no-legs COD delivery posts as an unpaid
  // receivable — paid 0, cash type, 'cod', zero sale_payments rows,
  // Dr 1130 for the full 530 with NO Dr 1110 leg, a customer-ledger
  // debt of 530, and no treasury row. At base the fallback invented
  // a 530 cash leg, so paid_amount was 530 and the journal debited
  // 1110 instead of 1130.
  await check('R7-D no-legs COD posts as a receivable, never as paid cash', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, codPayload(), cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(Number(row.total), 530, 'goods 500 + courier fee 30');
      assert.equal(Number(row.paid_amount), 0, 'no cash has changed hands yet');
      assert.equal(row.payment_type, 'cash', 'a COD sale stays a cash-type sale, never reclassified to credit');
      assert.equal(row.payment_channel, 'cash', 'no leg was declared, so the channel stays cash');
      assert.equal(row.collection_status, 'cod', 'the collection status is COD');
      assert.equal(Number(row.delivery_rep_id), 1, 'the rep carries the custody');
      assert.deepEqual(await paymentRows(db, saleId), [], 'no invented sale_payments row exists');
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
    } finally {
      await db.destroy();
    }
  });

  // 17. R7-D settleability, end to end: the same COD sale settles
  // through the real DeliveryRepsService.settleOrder — at base that
  // threw 409 DELIVERY_PARTIAL_PAYMENT_RECONCILIATION_REQUIRED
  // because paid_amount was the full total. After the fix it returns
  // ok, marks the order settled, records treasury cash_in of
  // 530 - 30 = 500, and the settlement journal debits 1110 500 +
  // 2115 30 against Cr 1130 530, so 1130 lands at zero and the
  // customer ledger nets to zero too.
  await check('R7-D a no-legs COD order settles end to end', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales, reps } = buildServices(db);
      const saleId = await createAndGetId(sales, codPayload(), cashierAuth);
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

  // 18. R7-D REGRESSION GUARD: the counter-cash fallback is
  // untouched — a no-legs takeaway sale still posts fully paid cash.
  await check('R7-D counter cash with no legs still falls back to full cash', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, posPayload(100, { payments: [], tenderedAmount: 0 }), cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(Number(row.paid_amount), 100, 'the counter sale is fully paid by the fallback');
      assert.equal((await paymentRows(db, saleId)).length, 1, 'the fallback leg is recorded');
      const journal = await journalByCode(db, 'sale', saleId);
      assert.equal(journal.get('1110')?.debit, 100, 'counter cash still debits the till');
      assert.equal(journal.get('1130'), undefined, 'no receivable exists for a paid counter sale');
    } finally {
      await db.destroy();
    }
  });

  // 19. R7-D: a COD sale with a declared partial leg posts exactly
  // that leg — the fallback never topped a declared payment up, and
  // it still does not. Paid 200 of 530, debt 330.
  await check('R7-D COD with a partial leg posts the typed leg only', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, codPayload({
        payments: [{ paymentChannel: 'cash', amount: 200 }], tenderedAmount: 200,
      }), cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(Number(row.paid_amount), 200, 'only the typed 200 is paid');
      const payments = await paymentRows(db, saleId);
      assert.equal(payments.length, 1, 'exactly one payment row exists');
      assert.equal(Number(payments[0].amount), 200, 'the payment row is the typed 200');
      const journal = await journalByCode(db, 'sale', saleId);
      assert.equal(journal.get('1110')?.debit, 200, 'only the typed cash debits the till');
      assert.equal(journal.get('1130')?.debit, 330, 'the remainder stays receivable');
      const legs = await ledgerRows(db, 7);
      assert.ok(
        legs.some((leg) => Number(leg.reference_id) === saleId && Number(leg.amount) === 330),
        'the unpaid 330 is a customer-ledger debt on this sale',
      );
    } finally {
      await db.destroy();
    }
  });

  // 20. R7-D: a no-legs COD delivery with no customer is still
  // rejected — the fix must not open an unpaid sale with no debtor.
  // At base the fallback made it look paid, so it posted.
  await check('R7-D no-legs COD with no customer is rejected', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      await assert.rejects(
        createAndGetId(sales, codPayload({ customerId: null }), cashierAuth),
        (err: any) => err && err.code === 'CUSTOMER_REQUIRED_FOR_CREDIT',
      );
      const count = await (db as any).selectFrom('sales').select(sql`count(*)`.as('n')).executeTakeFirst();
      assert.equal(Number((count as any).n), 0, 'no sale is written');
    } finally {
      await db.destroy();
    }
  });

  // 21. R7-D: a delivery with NO collection status stated and no
  // legs is COD by the downstream default, so it suppresses too —
  // paid 0, collection_status 'cod'. At base it posted fully paid
  // as 'prepaid_online'.
  await check('R7-D delivery with no stated status and no legs defaults to COD', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const payload = codPayload();
      delete payload.collectionStatus;
      const saleId = await createAndGetId(sales, payload, cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(Number(row.paid_amount), 0, 'an unstated-status delivery is unpaid');
      assert.equal(row.collection_status, 'cod', 'the unstated status defaults to COD');
      assert.deepEqual(await paymentRows(db, saleId), [], 'no invented payment row exists');
    } finally {
      await db.destroy();
    }
  });

  // 22. R7-D carve-out boundary: an EXPLICITLY prepaid delivery
  // keeps the fallback — the money is already in, so a no-legs
  // shape is a paid sale. The invented leg rides the declared
  // channel (card), never cash.
  await check('R7-D explicitly prepaid delivery keeps the fallback', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, posPayload(100, {
        source: 'dashboard', customerId: 7, orderType: 'delivery',
        collectionStatus: 'prepaid_online', deliveryRepId: 1,
        paymentChannel: 'card', payments: [], tenderedAmount: 0,
      }), cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(Number(row.paid_amount), 100, 'the prepaid delivery is fully paid');
      assert.equal(row.payment_channel, 'card', 'the fallback leg rides the declared card channel');
      assert.equal(row.collection_status, 'prepaid_online', 'the prepaid status is kept');
      const journal = await journalByCode(db, 'sale', saleId);
      assert.equal(journal.get('1120')?.debit, 100, 'the prepaid amount debits the bank, not the till');
      assert.equal(journal.get('1110'), undefined, 'no cash leg exists for a card prepayment');
    } finally {
      await db.destroy();
    }
  });

  // 23. R7-D edit path: editing a COD sale with no legs invents no
  // cash leg — paid stays 0, no sale_payments rows, no treasury row,
  // and the reposted journal still debits 1130 for the full 530.
  // At base the edit invented the same 530 cash leg as creation.
  await check('R7-D editing a COD sale with no legs invents no cash leg', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, codPayload(), cashierAuth);
      const editPayload = {
        ...codPayload(),
        editReason: 'تصحيح بيانات التوصيل بعد مراجعة العميل',
        managerPin: '1234',
      };
      const edited: any = await sales.updateSale(saleId, editPayload, cashierAuth);
      assert.equal(edited?.ok, true, 'the COD edit succeeds');
      const row = await saleFullRow(db, saleId);
      assert.equal(Number(row.paid_amount), 0, 'the edited COD sale is still unpaid');
      assert.equal(row.collection_status, 'cod', 'the edit keeps the COD status');
      assert.deepEqual(await paymentRows(db, saleId), [], 'the edit writes no payment rows');
      assert.deepEqual(await treasuryRows(db), [], 'the edit writes no treasury row');
      const journal = await journalByCode(db, 'sale_edit', saleId);
      assert.equal(journal.get('1130')?.debit, 530, 'the reposted journal still debits the receivable');
      assert.equal(journal.get('1110'), undefined, 'the reposted journal has no cash leg');
    } finally {
      await db.destroy();
    }
  });

  // 24. R7-D edit-path boundary: the COD carve-out is delivery-only
  // — a non-delivery underpaid edit still throws INVALID_PAID_AMOUNT.
  await check('R7-D non-delivery underpaid edit still throws', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, posPayload(100, { customerId: 7 }), cashierAuth);
      await assert.rejects(
        sales.updateSale(saleId, posPayload(100, {
          customerId: 7,
          payments: [{ paymentChannel: 'cash', amount: 50 }], tenderedAmount: 50,
          editReason: 'تصحيح المبلغ بعد مراجعة العميل',
          managerPin: '1234',
        }), cashierAuth),
        (err: any) => err && err.code === 'INVALID_PAID_AMOUNT',
      );
    } finally {
      await db.destroy();
    }
  });

  // 23. T12-H1, the Trial 4 shape: COD + customer + cash + paid 0
  // posts unpaid — paid 0, cash type, 'cod', Dr 1130 for the full
  // 530 with no Dr 1110 leg, and a customer-ledger debt of 530.
  // (Passes at base via R7-D; pinned here as the trial shape the
  // frontend gate used to block.)
  await check('T12-H1 COD + customer + cash + paid 0 posts unpaid', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, codPayload(), cashierAuth);
      const row = await saleFullRow(db, saleId);
      assert.equal(Number(row.total), 530, 'goods 500 + courier fee 30');
      assert.equal(Number(row.paid_amount), 0, 'nothing has been paid yet');
      assert.equal(row.payment_type, 'cash', 'a COD sale stays a cash-type sale, never reclassified to credit');
      assert.equal(row.collection_status, 'cod', 'the explicit COD status is stored');
      assert.deepEqual(await paymentRows(db, saleId), [], 'no sale_payments row exists for the unpaid COD sale');
      const journal = await journalByCode(db, 'sale', saleId);
      assert.equal(journal.get('1130')?.debit, 530, 'the full total is a customer receivable');
      assert.equal(journal.get('1110'), undefined, 'no cash-in-till leg exists for money with the courier');
      const legs = await ledgerRows(db, 7);
      assert.ok(
        legs.some((leg) => Number(leg.reference_id) === saleId && Number(leg.amount) === 530),
        'the unpaid 530 is a customer-ledger debt on this sale',
      );
    } finally {
      await db.destroy();
    }
  });

  // 24. T12-H1, the آجل control: an explicitly-credit delivery with
  // a customer and paid 0 still posts unpaid as credit — the COD
  // cash-leg refusal touches only explicit-'cod' sales with a
  // declared cash leg, never the credit path.
  await check('T12-H1 explicit credit delivery + customer + paid 0 still posts unpaid as credit', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 2);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, posPayload(100, {
        customerId: 7, paymentType: 'credit', paymentChannel: 'credit',
        payments: [], tenderedAmount: 0,
        orderType: 'delivery', deliveryRepId: 1,
      }), cashierAuth);
      const row = await saleRow(db, saleId);
      assert.equal(row.payment_type, 'credit', 'explicit credit posts as credit');
      assert.equal(Number(row.paid_amount), 0, 'the credit sale is unpaid');
    } finally {
      await db.destroy();
    }
  });

  if (failures.length) throw new Error(`${failures.length} paid-gate case(s) failed: ${failures.join(', ')}`);
  console.log('Restaurant paid gates tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
