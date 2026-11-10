/*
New file: backend/test/critical/storefront-convert-atomic-status.spec.ts

WHAT THIS PINS (INV-SF-CONVERT-ATOMIC-STATUS): a failed storefront
conversion never strands the order in 'processing', and the storefront
placement promise governs the conversion stock gate.

ROOT CAUSE (live, trial T4, 2026-11-10): converting out-of-stock COD
order ON-261110-0005 was refused with INSUFFICIENT_STOCK — but the
order's status had already flipped جديد -> جاري التجهيز. convertToSale
took the SF-6 pending->processing lock as a standalone auto-commit
UPDATE before createSale ran, and createSale's stock refusal rolled
back only the sale. The flipped status was never compensated: customer
cancel/edit both require 'pending', the expiry reaper only selects
'pending', and updateOrderStatus refuses moving backwards — so the
order sat in "being prepared" forever, and for a paid order there was
no UI escape at all.

SECOND HALF (same defect): placement and conversion enforced stock
under two different settings nothing synced. Placement allowed the
order under storefront_allow_out_of_stock (isOutOfStockOrderingAllowed)
while conversion refused it under the separate POS
allowNegativeStockSales setting — so an order the store was allowed to
take could never convert. The fix makes the placement setting govern
the conversion too, through the internal-only SystemApprovedSaleTerms
(allowNegativeStock), which resolveOnlineOrderTerms preserves and
createSale honours. Walk-in POS sales pass no flag and keep the POS
setting alone.

THE CASES, WORKED ONCE (goods product 101, 1 unit at 50, location
stock 0, branch 1 with default location 10, tenant 'test10k' retail):
(a) Live reproduction: COD pending, storefront_allow_out_of_stock
'false' -> convertToSale throws INSUFFICIENT_STOCK -> re-read row is
still 'pending' with sale_id null (the reaper's status/payment/sale
conditions hold) -> customer cancel succeeds.
(b) Paid variant: same, but payment_status 'paid' (manual) -> convert
throws INSUFFICIENT_STOCK -> status still 'pending' -> customer cancel
is refused with the specific paid-order message (the order is back in
'pending'; the paid rule still protects the money).
(c) Gate unification: storefront_allow_out_of_stock 'true',
allowNegativeStockSales unset -> convertToSale SUCCEEDS -> sale posted
(total 50, COD), location stock falls 0 -> -1, the order ships linked
to the sale, and the sale journal balances.
(d) Non-stock failure restores too: branch with no default location
and no reserved location -> convert throws the specific location error
-> status still 'pending' (the restore covers the whole post-lock body,
not just the stock throw).
(e) POS boundary unchanged: a direct createSale with no online order
and no terms still throws INSUFFICIENT_STOCK at stock 0 — the
storefront flag does not leak into walk-in POS sales.
(f) prepareOrderForPos: the same lock-then-restore contract — loading
a pending order into the POS cart flips it to 'processing' (the cart
holds it) and returns the cart items.

HONEST LIMITS, STATED NOT HIDDEN: the reaper additionally requires a
reservation (isReservationExpired rule 1: stock_reserved must be true),
and an out-of-stock order never had one — so case (a) asserts the
status/payment/sale conditions the restore returns, not a full reaper
run. Whether reservation-less orders should expire is the D-SF-12
reaper question (SF-3), not this package. prepareOrderForPos has no
deterministic post-lock failure to drive its restore branch (its
post-lock steps are reads plus a caught customer upsert), so case (f)
pins the lock behaviour and the restore is proven through the shared
helper in cases (a)/(b)/(d). The final-update-after-posted-sale edge
(a sale exists but online_orders.sale_id was never set) is pre-existing
and identical with or without this fix — the restore's WHERE
(status 'processing' AND sale_id IS NULL) cannot see it, and the
already-invoiced retry path has the same shape; recorded, not fixed
here.

HOW THIS IS DRIVEN: the real StorefrontService over the real
SalesService facade (real SalesQueryService + real SalesWriteService
chain) on PGlite, with the fixture foundation copied from
storefront-confirm-manual-payment.spec.ts. Journal legs are read from
the posted rows, never re-implemented.

RED PROOF: with the restore call removed from convertToSale, case (a)
fails — the row stays 'processing' and the customer cancel throws the
"being prepared" refusal. With allowNegativeStock dropped from the
approved terms (or from createSale's OR), case (c) throws
INSUFFICIENT_STOCK. Both proven by targeted reversal, file restored
with cp afterwards (never git checkout on uncommitted work).
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
import { SalesService } from '../../src/modules/sales/sales.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { issueOrderAccessToken } from '../../src/modules/storefront/engines/online-order-access.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['sales', 'canEditPrice', 'canDiscount'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  SalesWriteService.invalidateSettingsCache(TENANT);
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY, slug text, activity_type text);
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
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, created_by bigint);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigint PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, is_active boolean DEFAULT true, rep_type text, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, opened_by bigint, status text, branch_id bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL, operation_type text NOT NULL, status text NOT NULL, request_hash text NOT NULL, document_id text, response_payload text, error_code text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), completed_at timestamptz);
    CREATE TABLE online_orders (id bigint PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_name text, customer_phone text, customer_address text, customer_notes text, items_json text, subtotal numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, total_amount numeric DEFAULT 0, status text, payment_method text, payment_status text, gateway_provider text, gateway_transaction_id text, gateway_order_id text, gateway_response_json text, paid_at timestamptz, pager_number text, coupon_code text, discount_amount numeric DEFAULT 0, delivery_zone_id bigint, delivery_zone_name text, branch_id bigint, sale_id bigint, shipping_carrier text, fulfillment_type text, country_code text, pickup_branch_id bigint, access_token_hash text, kitchen_draft_sale_id bigint, order_type text, table_number text, stock_reserved boolean DEFAULT false, reserved_branch_id bigint, reserved_location_id bigint, stock_reserved_at timestamptz, idempotency_key text, dispatched_at timestamptz, delivered_at timestamptz, driver_cash_settled boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT false, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations text, exchange_sale_id bigint, exchange_tip_relief numeric, exchange_courier_relief numeric, tip_relief numeric, courier_relief numeric, total numeric DEFAULT 0, note text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT, slug: 'test10k', activity_type: 'retail' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'taxRate', value: '14' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  const accounts: Array<[number, string]> = [
    [1110, '1110'], [1120, '1120'], [1130, '1130'], [1140, '1140'],
    [2115, '2115'], [2120, '2120'], [4100, '4100'], [4200, '4200'], [4300, '4300'], [5100, '5100'],
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
  // Branch 2 has no default stock location — case (d) converts against it.
  await anyDb.insertInto('branches').values({ id: 2, tenant_id: TENANT, name: 'No Location Branch' }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('cashier_shifts').values({
    tenant_id: TENANT, account_id: ACCOUNT, opened_by: 1, status: 'open', branch_id: 1,
  }).execute();
  // Product 101: zero stock everywhere — the out-of-stock subject.
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'Product 101',
    stock_qty: 0, cost_price: 10, retail_price: 50,
    wholesale_price: 50, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: 0,
  }).execute();
  await anyDb.insertInto('delivery_representatives').values({
    id: 2, tenant_id: TENANT, account_id: ACCOUNT, name: 'Store Rep',
    phone: null, is_active: true, rep_type: 'store_fleet',
  }).execute();
}

async function seedSettings(db: Kysely<Database>, entries: Array<[string, string]>): Promise<void> {
  for (const [key, value] of entries) {
    await (db as any).insertInto('settings').values({ tenant_id: TENANT, key, value }).execute();
  }
}

function buildServices(db: Kysely<Database>): { storefront: StorefrontService; sales: SalesService } {
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
  const salesWrite = new SalesWriteService(
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
  );
  const salesService = new SalesService(query, salesWrite);
  const storefront = new StorefrontService(db, salesService, {} as never, {} as never);
  return { storefront, sales: salesService };
}

async function seedOrder(
  db: Kysely<Database>,
  overrides: Record<string, unknown>,
): Promise<void> {
  const base: Record<string, unknown> = {
    id: 77, tenant_id: TENANT, account_id: ACCOUNT, order_number: 'ON-1',
    customer_name: 'Online Customer', customer_phone: '01012345678', customer_address: 'Cairo',
    items_json: JSON.stringify([{ productId: 101, quantity: 1, unitPrice: 50, total: 50 }]),
    subtotal: 50, delivery_fee: 0, total_amount: 50, status: 'pending',
    payment_method: 'cod', payment_status: 'pending', gateway_provider: null,
    fulfillment_type: 'delivery', branch_id: 1, sale_id: null,
    discount_amount: 0, coupon_code: null,
  };
  await (db as any).insertInto('online_orders').values({ ...base, ...overrides }).execute();
}

async function readOrder(db: Kysely<Database>, orderId: number): Promise<any> {
  return (db as any).selectFrom('online_orders').selectAll()
    .where('id', '=', orderId).executeTakeFirstOrThrow();
}

async function readSale(db: Kysely<Database>, saleId: number): Promise<any> {
  return (db as any).selectFrom('sales').selectAll()
    .where('id', '=', saleId).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
}

async function journalTotals(db: Kysely<Database>, saleId: number): Promise<{ debit: number; credit: number }> {
  const entries = await (db as any).selectFrom('journal_entries').select('id')
    .where('source_type', '=', 'sale').where('source_id', '=', saleId).execute();
  assert.equal(entries.length, 1, 'exactly one posted sale journal');
  const rows = await (db as any).selectFrom('journal_entry_lines').select(['debit', 'credit'])
    .where('journal_entry_id', '=', entries[0].id).execute();
  return rows.reduce((acc: { debit: number; credit: number }, row: any) => ({
    debit: acc.debit + Number(row.debit || 0),
    credit: acc.credit + Number(row.credit || 0),
  }), { debit: 0, credit: 0 });
}

async function locationQty(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('product_location_stock').select('qty')
    .where('product_id', '=', 101).where('location_id', '=', 10).executeTakeFirstOrThrow();
  return Number(row.qty);
}

async function expectConvertError(
  service: StorefrontService,
  orderId: number,
  code: string,
  pattern: RegExp,
  label: string,
): Promise<any> {
  let err: any = null;
  try {
    await service.convertToSale(orderId, adminAuth);
  } catch (e) {
    err = e;
  }
  assert.ok(err, `${label}: convert must throw`);
  assert.equal(err?.code, code, `${label}: error code must be ${code}, got ${err?.code}: ${err?.message}`);
  assert.match(String(err?.message || ''), pattern, `${label}: error must name the specific problem`);
  return err;
}

async function main(): Promise<void> {
  // (a) Live reproduction: COD out-of-stock, storefront promise OFF ->
  // convert throws INSUFFICIENT_STOCK -> status stays 'pending' ->
  // customer cancel still works.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedSettings(db, [['storefront_allow_out_of_stock', 'false']]);
      const { token, hash } = issueOrderAccessToken();
      await seedOrder(db, { access_token_hash: hash });
      const { storefront } = buildServices(db);
      await expectConvertError(storefront, 77, 'INSUFFICIENT_STOCK', /Product 101/, 'live reproduction');
      const order = await readOrder(db, 77);
      assert.equal(order.status, 'pending', 'the failed conversion must leave the order pending, not processing');
      assert.equal(order.sale_id, null, 'the failed conversion must not link a sale');
      assert.equal(order.payment_status, 'pending', 'the failed conversion leaves payment pending');
      // Reaper conditions the restore returns: pending + unpaid + no sale.
      assert.equal(order.status, 'pending', 'reaper rule 3 (still pending) holds after the restore');
      const cancelled: any = await storefront.cancelCustomerOrder('test10k', 'ON-1', token);
      assert.equal(cancelled.ok, true, 'the customer must still be able to cancel the restored order');
      const afterCancel = await readOrder(db, 77);
      assert.equal(afterCancel.status, 'cancelled', 'the cancel lands after the restore');
    } finally {
      await db.destroy();
    }
    console.log('  live reproduction (failed COD conversion restores pending + cancel works) passed');
  }

  // (b) Paid variant: a paid out-of-stock order fails conversion the
  // same way — back to 'pending', and the paid-cancel rule still holds.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedSettings(db, [['storefront_allow_out_of_stock', 'false']]);
      const { token, hash } = issueOrderAccessToken();
      await seedOrder(db, {
        access_token_hash: hash,
        payment_status: 'paid', gateway_provider: 'manual', paid_at: new Date(),
      });
      const { storefront } = buildServices(db);
      await expectConvertError(storefront, 77, 'INSUFFICIENT_STOCK', /Product 101/, 'paid variant');
      const order = await readOrder(db, 77);
      assert.equal(order.status, 'pending', 'a failed paid conversion must also leave the order pending');
      assert.equal(order.sale_id, null, 'a failed paid conversion must not link a sale');
      let cancelErr: any = null;
      try {
        await storefront.cancelCustomerOrder('test10k', 'ON-1', token);
      } catch (e) {
        cancelErr = e;
      }
      assert.ok(cancelErr, 'cancelling a paid order must still be refused');
      assert.match(String(cancelErr?.message || ''), /سداده/, 'the paid-cancel refusal must name the payment');
      const stillPending = await readOrder(db, 77);
      assert.equal(stillPending.status, 'pending', 'the refused cancel leaves the order pending, not stranded');
    } finally {
      await db.destroy();
    }
    console.log('  paid variant (failed paid conversion restores pending) passed');
  }

  // (c) Gate unification: storefront promise ON, POS setting unset ->
  // the conversion SUCCEEDS and posts negative stock.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedSettings(db, [['storefront_allow_out_of_stock', 'true']]);
      await seedOrder(db, {});
      const { storefront } = buildServices(db);
      const converted: any = await storefront.convertToSale(77, adminAuth);
      assert.equal(converted.ok, true, 'a conversion under the storefront promise must succeed');
      const sale = await readSale(db, Number(converted.saleId));
      assert.equal(Number(sale.total), 50, 'the posted total is the order total');
      assert.equal(sale.collection_status, 'cod', 'the unconfirmed COD order converts as COD');
      assert.equal(Number(sale.paid_amount), 0, 'the COD sale is unpaid at conversion');
      assert.equal(await locationQty(db), -1, 'the conversion deducts stock below zero under the promise');
      const totals = await journalTotals(db, Number(converted.saleId));
      assert.equal(totals.debit, totals.credit, 'the negative-stock sale journal balances');
      assert.ok(totals.debit > 0, 'the negative-stock sale journal posts real legs');
      const order = await readOrder(db, 77);
      assert.equal(order.status, 'shipped', 'a converted delivery order ships');
      assert.equal(Number(order.sale_id), Number(converted.saleId), 'the order links the posted sale');
    } finally {
      await db.destroy();
    }
    console.log('  gate unification (storefront promise converts at zero stock) passed');
  }

  // (d) Non-stock failure restores too: no default location anywhere.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedSettings(db, [['storefront_allow_out_of_stock', 'false']]);
      await seedOrder(db, { branch_id: 2, reserved_branch_id: null, reserved_location_id: null });
      const { storefront } = buildServices(db);
      let err: any = null;
      try {
        await storefront.convertToSale(77, adminAuth);
      } catch (e) {
        err = e;
      }
      assert.ok(err, 'the location-less conversion must throw');
      assert.match(String(err?.message || ''), /مخزون افتراضي/, 'the location error must name the missing branch default');
      const order = await readOrder(db, 77);
      assert.equal(order.status, 'pending', 'a non-stock post-lock failure must also restore pending');
      assert.equal(order.sale_id, null, 'the location failure must not link a sale');
    } finally {
      await db.destroy();
    }
    console.log('  non-stock failure (missing location restores pending) passed');
  }

  // (e) POS boundary unchanged: a direct sale with no online order and
  // no terms still refuses at zero stock.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedSettings(db, [['storefront_allow_out_of_stock', 'true']]);
      const { sales } = buildServices(db);
      let err: any = null;
      try {
        await sales.createSale({
          items: [{ productId: 101, qty: 1, quantity: 1, price: 50, unitPrice: 50, unitName: 'قطعة', unitMultiplier: 1, priceType: 'retail', discount: 0 }],
          branchId: 1, locationId: 10, paymentType: 'cash', orderType: 'takeaway',
        } as any, adminAuth);
      } catch (e) {
        err = e;
      }
      assert.ok(err, 'a walk-in POS sale must still refuse at zero stock');
      assert.equal(err?.code, 'INSUFFICIENT_STOCK', `POS refusal must be INSUFFICIENT_STOCK, got ${err?.code}`);
      const salesRows = await (db as any).selectFrom('sales').select('id').execute();
      assert.equal(salesRows.length, 0, 'the refused POS sale must not post anything');
    } finally {
      await db.destroy();
    }
    console.log('  POS boundary (direct sale still refuses at zero stock) passed');
  }

  // (f) prepareOrderForPos: the same lock — loading a pending order
  // into the POS cart flips it to 'processing' and returns the cart.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedSettings(db, [['storefront_allow_out_of_stock', 'false']]);
      await seedOrder(db, {});
      const { storefront } = buildServices(db);
      const prepared: any = await storefront.prepareOrderForPos(77, adminAuth);
      assert.equal(prepared.ok, true, 'loading the order into the POS cart must succeed');
      assert.equal(prepared.items.length, 1, 'the cart carries the ordered line');
      assert.equal(Number(prepared.items[0].productId), 101, 'the cart line is product 101');
      const order = await readOrder(db, 77);
      assert.equal(order.status, 'processing', 'the loaded order is locked in processing while the cart holds it');
      assert.equal(order.sale_id, null, 'loading into the cart posts no sale');
    } finally {
      await db.destroy();
    }
    console.log('  prepareOrderForPos (lock held while the cart holds the order) passed');
  }

  console.log('Storefront convert atomic status tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
