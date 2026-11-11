/*
New file: backend/test/critical/storefront-reaper-service.spec.ts

WHAT THIS PINS (INV-SF-REAPER-HEARTBEAT-LOGGING): the expired-reservation
reaper actually reaps — the real StorefrontService.reapExpiredReservations
on PGlite, not just the pure engine. The old spec (storefront-stock-
reaper.spec.ts) tested only isReservationExpired boundaries; the service
SQL, the transaction, the release and the scheduler timers were entirely
unpinned, which is how D-SF-12 shipped: the selection rule was correct
and both sweepers were wired, yet order ON-261110-0008 (instapay_wallet,
131.60, placed 19:58 EET 2026-11-10) sat pending ~2h54m through ~48
sweeps with zero trace — an empty per-order catch swallowed errors, a
wedged `running` flag had no timeout, empty sweeps logged nothing, and
the SQL pre-filter `stock_reserved_at < cutoff` with no COALESCE to
created_at could never select a NULL-timestamp row even though the
engine would expire it.

THE CASES, WORKED ONCE (goods product 101, location 10, branch 1,
tenant 't1', location stock qty 10 / reserved 2, product reserved 2):
(a) Online (instapay) order, 31 min old, reserved -> reaped: status
cancelled, payment_status failed, stock_reserved false, reserved_qty
released at location + global (2 -> 0), qty untouched (10).
(b) Same order, 29 min old -> NOT reaped, row + reservation untouched.
(c) COD boundaries in one sweep: 23h59m NOT reaped, 24h01m reaped;
scanned counts both (the SQL pre-filter uses the 30-min online cutoff,
the engine applies the 24-h COD rule per row).
(d) Protected rows never reaped: paid (45 min), converted (sale_id set),
processing (45 min) — sweep reaps 0, rows + reservation untouched.
(e) NULL stock_reserved_at with created_at 45 min old -> reaped (the
COALESCE case: fails if the COALESCE is removed from the selector).
(f) Scheduler: a sweep invokes the service and records the heartbeat;
a wedged `running` flag older than the stale timeout is reset + the
sweep proceeds (wedgedReset true); a fresh `running` flag skips the
sweep without calling the service (skippedWhileRunning true).

HOW THIS IS DRIVEN: the real StorefrontService over the real SalesService
facade (real SalesQueryService + real SalesWriteService chain) on PGlite,
with the fixture foundation copied from
storefront-convert-atomic-status.spec.ts. No coupons in any case, so the
coupon-release branch is not exercised here.

HONEST LIMITS, STATED NOT HIDDEN: the db-maintenance second sweeper
carries the same COALESCE + logging fix but is not driven here —
runFastCleanup runs every cleanup step, not just the reaper, and its
other steps need tables outside this fixture; its fix is verified by
backend tsc + the identical SQL pattern. The live branch question
(timers dead vs per-order path throws) is answered by the fix's own
logging + heartbeat at the final live trial, not by this spec.

RED PROOF: with the COALESCE removed from the storefront selector, case
(e) fails — the NULL-timestamp row is never selected and stays pending.
With the per-order release removed, case (a) fails — the order cancels
but reserved_qty stays 2. Both proven by targeted reversal, file
restored with cp afterwards (never git checkout on uncommitted work).
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
import { StorefrontReservationSchedulerService } from '../../src/modules/storefront/services/storefront-reservation-scheduler.service';

const TENANT = 't1';
const ACCOUNT = 'a1';

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
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_override_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
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
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('cashier_shifts').values({
    tenant_id: TENANT, account_id: ACCOUNT, opened_by: 1, status: 'open', branch_id: 1,
  }).execute();
  // Product 101: 10 on hand, 2 reserved — the reservation the reaper must release.
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'Product 101',
    stock_qty: 10, reserved_qty: 2, cost_price: 10, retail_price: 50,
    wholesale_price: 50, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: 10, reserved_qty: 2,
  }).execute();
  await anyDb.insertInto('delivery_representatives').values({
    id: 2, tenant_id: TENANT, account_id: ACCOUNT, name: 'Store Rep',
    phone: null, is_active: true, rep_type: 'store_fleet',
  }).execute();
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
    items_json: JSON.stringify([{ productId: 101, quantity: 2, unitPrice: 50, total: 100 }]),
    subtotal: 100, delivery_fee: 0, total_amount: 100, status: 'pending',
    payment_method: 'instapay_wallet', payment_status: 'pending', gateway_provider: null,
    fulfillment_type: 'delivery', branch_id: 1, sale_id: null,
    discount_amount: 0, coupon_code: null,
    stock_reserved: true, reserved_branch_id: 1, reserved_location_id: 10,
    stock_reserved_at: new Date(Date.now() - 31 * 60 * 1000),
    created_at: new Date(Date.now() - 31 * 60 * 1000),
  };
  await (db as any).insertInto('online_orders').values({ ...base, ...overrides }).execute();
}

async function readOrder(db: Kysely<Database>, orderId: number): Promise<any> {
  return (db as any).selectFrom('online_orders').selectAll()
    .where('id', '=', orderId).executeTakeFirstOrThrow();
}

async function locationReserved(db: Kysely<Database>): Promise<{ qty: number; reserved: number }> {
  const row = await (db as any).selectFrom('product_location_stock').select(['qty', 'reserved_qty'])
    .where('product_id', '=', 101).where('location_id', '=', 10).executeTakeFirstOrThrow();
  return { qty: Number(row.qty), reserved: Number(row.reserved_qty) };
}

async function productReserved(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('products').select('reserved_qty')
    .where('id', '=', 101).executeTakeFirstOrThrow();
  return Number(row.reserved_qty);
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

async function main(): Promise<void> {
  // (a) 31-min online order: reaped, reservation released at both levels.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOrder(db, {});
      const { storefront } = buildServices(db);
      const result = await storefront.reapExpiredReservations();
      assert.equal(result.scannedCount, 1, 'the 31-min order must be a candidate');
      assert.equal(result.reapedOrdersCount, 1, 'the 31-min online order must be reaped');
      assert.deepEqual(result.reapedOrderNumbers, ['ON-1'], 'the reaped order number is recorded');
      const order = await readOrder(db, 77);
      assert.equal(order.status, 'cancelled', 'the reaped order must be cancelled');
      assert.equal(order.payment_status, 'failed', 'the reaped order must be marked failed');
      assert.equal(order.stock_reserved, false, 'the reaped order must release its reservation flag');
      const loc = await locationReserved(db);
      assert.equal(loc.reserved, 0, 'the location reservation must be released (2 -> 0)');
      assert.equal(loc.qty, 10, 'the release must not touch on-hand qty');
      assert.equal(await productReserved(db), 0, 'the global reservation must be released (2 -> 0)');
    } finally {
      await db.destroy();
    }
    console.log('  (a) 31-min online order reaped + reservation released passed');
  }

  // (b) 29-min online order: inside the timeout — untouched.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOrder(db, { stock_reserved_at: minutesAgo(29), created_at: minutesAgo(29) });
      const { storefront } = buildServices(db);
      const result = await storefront.reapExpiredReservations();
      assert.equal(result.scannedCount, 0, 'the 29-min order must not be a candidate');
      assert.equal(result.reapedOrdersCount, 0, 'the 29-min order must not be reaped');
      const order = await readOrder(db, 77);
      assert.equal(order.status, 'pending', 'the 29-min order must stay pending');
      assert.equal(order.stock_reserved, true, 'the 29-min order must keep its reservation');
      assert.equal((await locationReserved(db)).reserved, 2, 'the reservation must be untouched');
    } finally {
      await db.destroy();
    }
    console.log('  (b) 29-min online order untouched passed');
  }

  // (c) COD boundaries in one sweep: 23h59m kept, 24h01m reaped.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      // Two orders hold 2 units each — raise the seeded reservation to 4.
      await (db as any).updateTable('product_location_stock').set({ reserved_qty: 4 }).where('product_id', '=', 101).execute();
      await (db as any).updateTable('products').set({ reserved_qty: 4 }).where('id', '=', 101).execute();
      await seedOrder(db, {
        id: 77, order_number: 'ON-COD-YOUNG', payment_method: 'cod',
        stock_reserved_at: minutesAgo(23 * 60 + 59), created_at: minutesAgo(23 * 60 + 59),
      });
      await seedOrder(db, {
        id: 78, order_number: 'ON-COD-OLD', payment_method: 'cod',
        stock_reserved_at: minutesAgo(24 * 60 + 1), created_at: minutesAgo(24 * 60 + 1),
      });
      const { storefront } = buildServices(db);
      const result = await storefront.reapExpiredReservations();
      assert.equal(result.scannedCount, 2, 'both COD rows pass the 30-min SQL pre-filter');
      assert.equal(result.reapedOrdersCount, 1, 'only the 24h01m COD order must be reaped');
      assert.deepEqual(result.reapedOrderNumbers, ['ON-COD-OLD'], 'the reaped order is the old COD one');
      const young = await readOrder(db, 77);
      assert.equal(young.status, 'pending', 'the 23h59m COD order must stay pending');
      assert.equal(young.stock_reserved, true, 'the 23h59m COD order must keep its reservation');
      const old = await readOrder(db, 78);
      assert.equal(old.status, 'cancelled', 'the 24h01m COD order must be cancelled');
      assert.equal((await locationReserved(db)).reserved, 2, 'only the old order releases (4 -> 2)');
      assert.equal(await productReserved(db), 2, 'the global reservation drops by the old order only');
    } finally {
      await db.destroy();
    }
    console.log('  (c) COD 23h59m kept + 24h01m reaped passed');
  }

  // (d) Protected rows: paid, converted, processing — never reaped.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      // Three orders hold 2 units each — raise the seeded reservation to 6.
      await (db as any).updateTable('product_location_stock').set({ reserved_qty: 6 }).where('product_id', '=', 101).execute();
      await (db as any).updateTable('products').set({ reserved_qty: 6 }).where('id', '=', 101).execute();
      await seedOrder(db, {
        id: 77, order_number: 'ON-PAID', payment_status: 'paid',
        stock_reserved_at: minutesAgo(45), created_at: minutesAgo(45),
      });
      await seedOrder(db, {
        id: 78, order_number: 'ON-CONVERTED', sale_id: 105,
        stock_reserved_at: minutesAgo(45), created_at: minutesAgo(45),
      });
      await seedOrder(db, {
        id: 79, order_number: 'ON-PROCESSING', status: 'processing',
        stock_reserved_at: minutesAgo(45), created_at: minutesAgo(45),
      });
      const { storefront } = buildServices(db);
      const result = await storefront.reapExpiredReservations();
      assert.equal(result.scannedCount, 0, 'no protected row may be a candidate');
      assert.equal(result.reapedOrdersCount, 0, 'no protected row may be reaped');
      const paid = await readOrder(db, 77);
      assert.equal(paid.status, 'pending', 'the paid order must stay pending');
      assert.equal(paid.payment_status, 'paid', 'the paid order must stay paid');
      const converted = await readOrder(db, 78);
      assert.equal(Number(converted.sale_id), 105, 'the converted order must keep its sale link');
      const processing = await readOrder(db, 79);
      assert.equal(processing.status, 'processing', 'the processing order must stay processing');
      assert.equal((await locationReserved(db)).reserved, 6, 'no reservation may be released');
    } finally {
      await db.destroy();
    }
    console.log('  (d) paid / converted / processing never reaped passed');
  }

  // (e) NULL stock_reserved_at with created_at 45 min old — the COALESCE case.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOrder(db, { stock_reserved_at: null, created_at: minutesAgo(45) });
      const { storefront } = buildServices(db);
      const result = await storefront.reapExpiredReservations();
      assert.equal(result.scannedCount, 1, 'the NULL-timestamp row must be a candidate via created_at');
      assert.equal(result.reapedOrdersCount, 1, 'the NULL-timestamp row must be reaped');
      const order = await readOrder(db, 77);
      assert.equal(order.status, 'cancelled', 'the NULL-timestamp order must be cancelled');
      assert.equal((await locationReserved(db)).reserved, 0, 'its reservation must be released');
    } finally {
      await db.destroy();
    }
    console.log('  (e) NULL stock_reserved_at + old created_at reaped (COALESCE) passed');
  }

  // (f1) Scheduler: a sweep invokes the service and records the heartbeat.
  {
    let calls = 0;
    const stub = {
      reapExpiredReservations: async () => {
        calls += 1;
        return { reapedOrdersCount: 2, reapedOrderNumbers: ['ON-1', 'ON-2'], scannedCount: 5 };
      },
    };
    const scheduler = new StorefrontReservationSchedulerService(stub as never);
    await scheduler.sweepExpiredReservations();
    assert.equal(calls, 1, 'the sweep must call the service once');
    const heartbeat = scheduler.getLastResults();
    assert.ok(heartbeat, 'the sweep must record a heartbeat');
    assert.equal(heartbeat!.scannedCount, 5, 'the heartbeat carries the scanned count');
    assert.equal(heartbeat!.reapedOrdersCount, 2, 'the heartbeat carries the reaped count');
    assert.deepEqual(heartbeat!.reapedOrderNumbers, ['ON-1', 'ON-2'], 'the heartbeat carries the order numbers');
    assert.equal(heartbeat!.skippedWhileRunning, false, 'a run sweep is not a skip');
    assert.equal(heartbeat!.wedgedReset, false, 'a clean sweep resets nothing');
    assert.equal(heartbeat!.error, null, 'a clean sweep has no error');
    console.log('  (f1) sweep invokes the service + records the heartbeat passed');
  }

  // (f2) Scheduler: a wedged `running` flag older than the stale timeout is
  // reset and the sweep proceeds instead of staying wedged forever.
  {
    let calls = 0;
    const stub = {
      reapExpiredReservations: async () => {
        calls += 1;
        return { reapedOrdersCount: 0, reapedOrderNumbers: [], scannedCount: 0 };
      },
    };
    const scheduler = new StorefrontReservationSchedulerService(stub as never);
    (scheduler as any).running = true;
    (scheduler as any).sweepStartedAt = Date.now() - 6 * 60 * 1000;
    await scheduler.sweepExpiredReservations();
    assert.equal(calls, 1, 'a wedged sweep must be reset and run, not skipped forever');
    assert.equal(scheduler.getLastResults()!.wedgedReset, true, 'the heartbeat must flag the reset');
    console.log('  (f2) wedged running flag resets after the stale timeout passed');
  }

  // (f3) Scheduler: a fresh `running` flag skips the sweep without calling
  // the service — and the skip is recorded, not silent.
  {
    let calls = 0;
    const stub = {
      reapExpiredReservations: async () => {
        calls += 1;
        return { reapedOrdersCount: 0, reapedOrderNumbers: [], scannedCount: 0 };
      },
    };
    const scheduler = new StorefrontReservationSchedulerService(stub as never);
    (scheduler as any).running = true;
    (scheduler as any).sweepStartedAt = Date.now();
    await scheduler.sweepExpiredReservations();
    assert.equal(calls, 0, 'a fresh running sweep must skip, not overlap');
    assert.equal(scheduler.getLastResults()!.skippedWhileRunning, true, 'the skip must be recorded in the heartbeat');
    console.log('  (f3) fresh running sweep skips + records the skip passed');
  }

  console.log('Storefront reaper service tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
