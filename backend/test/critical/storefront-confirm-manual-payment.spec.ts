/*
New file: backend/test/critical/storefront-confirm-manual-payment.spec.ts

WHAT THIS PINS (INV-SF-INSTAPAY-CONFIRM-FIX): manual InstaPay
confirmation actually flips an instapay_wallet order to paid,
and the confirmed order converts to a PREPAID invoice.

ROOT CAUSE (live, trial T5 + capture 2026-11-10): the merchant
clicked "تأكيد استلام التحويل" and NO toast ever appeared while
payment_status stayed pending — twice, on fresh orders. The
service was innocent: the button in MerchantOrderDetailModal
gated the call on `if (window.confirm(...))`, but the global
SystemAlertProvider (mounted at the app root) replaces
window.confirm with a shim that fires the async enterprise
dialog, DISCARDS its promise and always returns false
(system-alert.tsx:244-259). So onConfirmPayment never ran: no
request, no toast, no flip — even clicking "تأكيد" in the
enterprise dialog resolved a discarded promise. The fix calls
`await systemConfirm(...)` instead, per the repo's own
zero-native-confirm standard.

THE CASES, WORKED ONCE (goods product 101: 2 units at 50,
cost 10, location stock 100; delivery fee 20; order total 120,
instapay_wallet, pending):
(a) Live reproduction: confirm -> the returned payload AND the
re-read row both say payment_status 'paid', gateway_provider
'manual', paid_at set -> convertToSale yields a prepaid invoice
with paidAmount 120 and collection_status 'prepaid_online',
the order ships linked to the sale, location stock falls
100 -> 98, the sale journal balances, and one payment line of
120 is recorded.
(b) Re-confirm: confirming an already-paid order throws the
specific already-confirmed error.
(c) Invoiced order: confirming after conversion throws the
specific already-invoiced error.
(d) Guard alignment: an order in status 'payment_failed' or
'review_required' is refused with its own specific message —
never the generic "changed during confirmation" error the
conditional UPDATE used to throw for statuses the pre-checks
had just approved.
(e) Boundary unchanged: a COD order refuses manual confirm
with the manual-only message.

HOW THIS IS DRIVEN: the real StorefrontService over the real
SalesService facade (real SalesQueryService + real
SalesWriteService chain) on PGlite, with the fixture foundation
copied from storefront-paid-delivery-conversion.spec.ts. Journal
legs and payment lines are read from the posted rows, never
re-implemented.

RED PROOF: with the confirm UPDATE removed, case (a) throws
the generic "changed during confirmation" error and the row
stays pending; with the modal's window.confirm guard restored,
the click never reaches the service at all (proven by code
inspection of the shim — no request, no toast).
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
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
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
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
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
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'Product 101',
    stock_qty: 100, cost_price: 10, retail_price: 50,
    wholesale_price: 50, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: 100,
  }).execute();
  await anyDb.insertInto('delivery_representatives').values({
    id: 2, tenant_id: TENANT, account_id: ACCOUNT, name: 'Store Rep',
    phone: null, is_active: true, rep_type: 'store_fleet',
  }).execute();
}

function buildServices(db: Kysely<Database>): StorefrontService {
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
  return new StorefrontService(db, salesService, {} as never, {} as never);
}

async function seedOrder(
  db: Kysely<Database>,
  overrides: Record<string, unknown>,
): Promise<void> {
  const base: Record<string, unknown> = {
    id: 77, tenant_id: TENANT, account_id: ACCOUNT, order_number: 'ON-1',
    customer_name: 'Online Customer', customer_phone: '01012345678', customer_address: 'Cairo',
    items_json: JSON.stringify([{ productId: 101, quantity: 2, unitPrice: 50, total: 100 }]),
    subtotal: 100, delivery_fee: 20, total_amount: 120, status: 'pending',
    payment_method: 'instapay_wallet', payment_status: 'pending', gateway_provider: null,
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

async function expectConfirmError(
  service: StorefrontService,
  orderId: number,
  reference: string | undefined,
  pattern: RegExp,
  label: string,
): Promise<void> {
  let err: any = null;
  try {
    await service.confirmManualPayment(orderId, reference, adminAuth);
  } catch (e) {
    err = e;
  }
  assert.ok(err, `${label}: confirm must throw`);
  assert.match(String(err?.message || ''), pattern, `${label}: error must name the specific problem`);
}

async function main(): Promise<void> {
  // (a) Live reproduction: instapay_wallet pending -> confirm -> prepaid invoice.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOrder(db, {});
      const service = buildServices(db);
      const result: any = await service.confirmManualPayment(77, 'INSTAPAY-REF-1', adminAuth);
      assert.equal(result.ok, true, 'confirm must succeed');
      assert.equal(result.paymentStatus, 'paid', 'the returned payload carries the stored paid status');
      assert.equal(result.gatewayProvider, 'manual', 'the returned payload carries the stored manual provider');
      assert.ok(result.paidAt, 'the returned payload carries the stored paid_at');
      const order = await readOrder(db, 77);
      assert.equal(order.payment_status, 'paid', 'the re-read row is paid');
      assert.equal(order.gateway_provider, 'manual', 'the re-read row carries the manual provider');
      assert.ok(order.paid_at, 'the re-read row carries paid_at');
      assert.equal(order.gateway_transaction_id, 'INSTAPAY-REF-1', 'the reference is stored on the row');
      const converted: any = await service.convertToSale(77, adminAuth);
      assert.equal(converted.ok, true, 'conversion of the confirmed order must succeed');
      const sale = await readSale(db, Number(converted.saleId));
      assert.equal(sale.collection_status, 'prepaid_online', 'the confirmed order converts as prepaid, not COD');
      assert.equal(Number(sale.total), 120, 'the posted total is goods plus delivery fee');
      assert.equal(Number(sale.paid_amount), 120, 'the confirmed total is fully paid');
      assert.equal(await locationQty(db), 98, 'the conversion deducts branch location stock');
      const payments = await (db as any).selectFrom('sale_payments').selectAll()
        .where('sale_id', '=', Number(converted.saleId)).execute();
      assert.equal(payments.length, 1, 'exactly one payment line is recorded');
      assert.equal(Number(payments[0].amount), 120, 'the payment line covers the full total');
      const totals = await journalTotals(db, Number(converted.saleId));
      assert.equal(totals.debit, totals.credit, 'the prepaid sale journal balances');
      const convertedOrder = await readOrder(db, 77);
      assert.equal(convertedOrder.status, 'shipped', 'a converted delivery order ships');
      assert.equal(Number(convertedOrder.sale_id), Number(converted.saleId), 'the order links the posted sale');
    } finally {
      await db.destroy();
    }
    console.log('  live reproduction (confirm -> prepaid invoice) passed');
  }

  // (b) Re-confirm: a second confirmation is refused with a specific error.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOrder(db, {});
      const service = buildServices(db);
      await service.confirmManualPayment(77, undefined, adminAuth);
      await expectConfirmError(service, 77, undefined, /مسبقاً/, 're-confirm');
    } finally {
      await db.destroy();
    }
    console.log('  re-confirm refusal passed');
  }

  // (c) Invoiced order: confirming an instapay order that was already
  // converted while still pending (COD invoice, sale linked, payment
  // still pending) is refused with a specific error. Note the guard
  // order: a confirmed-then-converted order hits the already-paid check
  // first, and a COD order hits the manual-only check first — so the
  // invoiced branch is exercised through the pending-instapay path,
  // which is the only way an order carries a sale_id while its payment
  // is still unconfirmed.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOrder(db, {});
      const service = buildServices(db);
      await service.convertToSale(77, adminAuth);
      const order = await readOrder(db, 77);
      assert.ok(Number(order.sale_id) > 0, 'the unconfirmed conversion must link a sale');
      assert.equal(order.payment_status, 'pending', 'the unconfirmed conversion leaves payment pending');
      await expectConfirmError(service, 77, undefined, /فاتورة/, 'invoiced-order confirm');
    } finally {
      await db.destroy();
    }
    console.log('  invoiced-order refusal passed');
  }

  // (d) Guard alignment: payment_failed / review_required get specific errors, never the generic one.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOrder(db, { id: 78, order_number: 'ON-2', status: 'payment_failed' });
      await seedOrder(db, { id: 79, order_number: 'ON-3', status: 'review_required' });
      const service = buildServices(db);
      await expectConfirmError(service, 78, undefined, /فشل دفعه/, 'payment_failed confirm');
      await expectConfirmError(service, 79, undefined, /المراجعة/, 'review_required confirm');
      let genericSeen = false;
      try {
        await service.confirmManualPayment(78, undefined, adminAuth);
      } catch (e: any) {
        genericSeen = String(e?.message || '').includes('تغيرت حالة الطلب');
      }
      assert.equal(genericSeen, false, 'the generic changed-during-confirmation error must never fire here');
    } finally {
      await db.destroy();
    }
    console.log('  guard alignment (payment_failed / review_required) passed');
  }

  // (e) Boundary unchanged: a COD order refuses manual confirmation.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOrder(db, { payment_method: 'cod' });
      const service = buildServices(db);
      await expectConfirmError(service, 77, undefined, /التحويل/, 'COD confirm');
    } finally {
      await db.destroy();
    }
    console.log('  COD boundary passed');
  }

  console.log('Storefront manual InstaPay confirmation tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
