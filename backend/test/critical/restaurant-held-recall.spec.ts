/*
New file: backend/test/critical/restaurant-held-recall.spec.ts

WHAT THIS PINS (INV-REST-HOLD-RECALL-TRUTH, R5-B I29/I30/I31): the
server held-draft round-trip. Before this package a held draft lost
tip / loyalty / pager / delivery-fee mode / online order / dining
course / guest count / check-printed time on the header, and lineKey /
unitId / serials / originalPrice / offer fields / weighted / quantity
chunks on every line — saveHeldSale never persisted them, the DTO
rejected them as non-whitelisted, and mapHeldSalesRows rebuilt the
lineKey from product/unit/price (so two identical lines collapsed to
one key) and returned no delivery fee at all.

After the fix: save a draft with every field, list it, and assert
every field survives — including the stored lineKey, and including an
old draft whose modifiers envelope has no `held` block (lineKey falls
back to the rebuilt key).

HOW THIS IS DRIVEN: the real saveHeldSale / listHeldSales on PGlite,
with the real authorization, query and audit services (same harness
as restaurant-paid-gates.spec.ts). The PGlite held_sales schema below
mirrors migration 2040000000310 exactly, including the new columns.
Teardown is db.destroy() only.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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
import { HeldSaleDto } from '../../src/modules/sales/dto/held-sale.dto';
import { requestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

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
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code varchar(32));
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, rep_type text, is_active boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz, terminal_code varchar(32));
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_discount numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, amount numeric, title text, note text);
    -- held_sales schema mirrors migration 2040000000310 exactly, new columns included.
    CREATE TABLE held_sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, payment_type text, payment_channel text, paid_amount numeric DEFAULT 0, cash_amount numeric DEFAULT 0, card_amount numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, note text, search text, table_number text, order_type text, price_type text, branch_id bigint, location_id bigint, delivery_rep_id bigint, collection_status text, tip_amount numeric(15, 3) DEFAULT 0, loyalty_points_redeemed integer DEFAULT 0, pager_number text, delivery_fee_mode text, online_order_id bigint, dining_course text, guest_count integer, guest_check_printed_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE held_sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, held_sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, unit_name text, unit_multiplier numeric, price_type text, notes text, modifiers jsonb, created_at timestamptz DEFAULT NOW());
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
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'Widget 101',
    stock_qty: 100, cost_price: 10, retail_price: 100,
    wholesale_price: 100, min_selling_price: 1,
    is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('customers').values({
    id: 7, tenant_id: TENANT, account_id: ACCOUNT, name: 'Customer Seven',
    balance: 0, credit_limit: 0, is_credit_blocked: false, is_active: true,
  }).execute();
  await anyDb.insertInto('delivery_representatives').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep One', is_active: true,
  }).execute();
}

function buildServices(db: Kysely<Database>): SalesWriteService {
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
  return new SalesWriteService(
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
  );
}

function heldPayload(overrides: Record<string, unknown> = {}): any {
  return {
    items: [{
      productId: 101, name: 'Widget 101', qty: 2, price: 100, unitName: 'قطعة', unitMultiplier: 1,
      priceType: 'retail', lineKey: '101::u1::retail::seat-1', unitId: 'u1',
      serials: ['SN-1', 'SN-2'], originalPrice: 120, offerDiscount: 20, offerName: 'Deal',
      isWeighted: false, quantityChunks: [1, 1], seatNumber: 1, course: 'main',
    }],
    customerId: 7, paymentType: 'cash', paymentChannel: 'cash',
    cashAmount: 0, cardAmount: 0, transferAmount: 0, discount: 0, deliveryFee: 15,
    note: 'no onions', search: '', priceType: 'retail', branchId: 1, locationId: 10,
    orderType: 'delivery', tableNumber: '', deliveryRepId: 1, collectionStatus: 'prepaid_by_rep',
    tipAmount: 5, loyaltyPointsRedeemed: 10, pagerNumber: 'A12', deliveryFeeMode: 'store_fleet',
    onlineOrderId: 77, diningCourse: 'dessert', guestCount: 4,
    guestCheckPrintedAt: '2026-11-09T12:00:00.000Z',
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

  // 1. The DTO whitelists every new field: the real request pipe
  // (whitelist + forbidNonWhitelisted) accepts a full payload and the
  // transformed DTO keeps every field — including isWeighted:false,
  // which a missing decorator would silently strip.
  await check('HeldSaleDto accepts the full snapshot payload', async () => {
    const dto = plainToInstance(HeldSaleDto, heldPayload());
    const errors = await validate(dto);
    assert.equal(errors.length, 0, `DTO must validate, got ${JSON.stringify(errors).slice(0, 400)}`);
    const piped: any = await requestValidationPipe.transform(heldPayload(), { type: 'body', metatype: HeldSaleDto, data: '' });
    assert.equal(Number(piped.tipAmount), 5, 'pipe keeps tipAmount');
    assert.equal(Number(piped.loyaltyPointsRedeemed), 10, 'pipe keeps loyaltyPointsRedeemed');
    assert.equal(piped.pagerNumber, 'A12', 'pipe keeps pagerNumber');
    assert.equal(piped.deliveryFeeMode, 'store_fleet', 'pipe keeps deliveryFeeMode');
    assert.equal(Number(piped.onlineOrderId), 77, 'pipe keeps onlineOrderId');
    assert.equal(piped.diningCourse, 'dessert', 'pipe keeps diningCourse');
    assert.equal(Number(piped.guestCount), 4, 'pipe keeps guestCount');
    assert.equal(piped.items[0].lineKey, '101::u1::retail::seat-1', 'pipe keeps item lineKey');
    assert.deepEqual(piped.items[0].serials, ['SN-1', 'SN-2'], 'pipe keeps item serials');
    assert.equal(piped.items[0].isWeighted, false, 'pipe keeps isWeighted:false (not stripped)');
    assert.deepEqual(piped.items[0].quantityChunks, [1, 1], 'pipe keeps quantityChunks');
  });

  // 2. Full round-trip: save a draft with every field, list it, assert
  // every field survives — header, delivery, and every line field.
  await check('save + list round-trips every held field', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const sales = buildServices(db);
      const saved: any = await sales.saveHeldSale(heldPayload(), cashierAuth);
      const listed = (saved.heldSales || []) as Array<Record<string, unknown>>;
      assert.equal(listed.length, 1, 'one held draft is listed');
      const draft = listed[0] as any;
      assert.equal(Number(draft.tipAmount), 5, 'tip survives');
      assert.equal(Number(draft.loyaltyPointsRedeemed), 10, 'loyalty survives');
      assert.equal(draft.pagerNumber, 'A12', 'pager survives');
      assert.equal(draft.deliveryFeeMode, 'store_fleet', 'delivery fee mode survives');
      assert.equal(Number(draft.onlineOrderId), 77, 'online order id survives');
      assert.equal(draft.diningCourse, 'dessert', 'dining course survives');
      assert.equal(Number(draft.guestCount), 4, 'guest count survives');
      assert.ok(String(draft.guestCheckPrintedAt || '').startsWith('2026-11-09T12:00'), 'check-printed time survives');
      assert.equal(Number(draft.deliveryFee), 15, 'delivery fee survives');
      assert.equal(String(draft.deliveryRepId), '1', 'delivery rep survives');
      assert.equal(draft.collectionStatus, 'prepaid_by_rep', 'collection status survives');
      assert.equal(String(draft.branchId), '1', 'branch survives');
      assert.equal(String(draft.locationId), '10', 'location survives');
      const cart = draft.cart as Array<Record<string, unknown>>;
      assert.equal(cart.length, 1, 'one line is listed');
      const item = cart[0] as any;
      assert.equal(item.lineKey, '101::u1::retail::seat-1', 'stored lineKey survives (not rebuilt)');
      assert.equal(String(item.unitId), 'u1', 'unitId survives');
      assert.deepEqual(item.serials, ['SN-1', 'SN-2'], 'serials survive');
      assert.equal(Number(item.originalPrice), 120, 'originalPrice survives');
      assert.equal(Number(item.offerDiscount), 20, 'offerDiscount survives');
      assert.equal(item.offerName, 'Deal', 'offerName survives');
      assert.equal(item.isWeighted, false, 'isWeighted survives');
      assert.deepEqual(item.quantityChunks, [1, 1], 'quantityChunks survive');
      assert.equal(item.seatNumber, 1, 'seatNumber survives');
      assert.equal(item.course, 'main', 'course survives');
    } finally {
      await db.destroy();
    }
  });

  // 3. Two identical product/unit/price lines keep distinct stored keys.
  await check('two identical lines keep distinct keys', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const sales = buildServices(db);
      const payload = heldPayload();
      payload.items = [
        { ...payload.items[0], lineKey: '101::u1::retail::seat-1', seatNumber: 1 },
        { ...payload.items[0], lineKey: '101::u1::retail::seat-2', seatNumber: 2, serials: [] },
      ];
      const saved: any = await sales.saveHeldSale(payload, cashierAuth);
      const draft = (saved.heldSales || [])[0] as any;
      const keys = (draft.cart as any[]).map((entry) => entry.lineKey);
      assert.deepEqual(keys, ['101::u1::retail::seat-1', '101::u1::retail::seat-2'], 'distinct stored keys survive');
    } finally {
      await db.destroy();
    }
  });

  // 4. Old drafts (plain modifiers array, no `held` envelope) still list
  // with the rebuilt lineKey fallback — the migration must not break them.
  await check('old draft without held envelope falls back to rebuilt lineKey', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const anyDb = db as any;
      const inserted: any = await anyDb.insertInto('held_sales').values({
        tenant_id: TENANT, account_id: ACCOUNT, payment_type: 'cash', payment_channel: 'cash',
        paid_amount: 0, cash_amount: 0, card_amount: 0, discount: 0, delivery_fee: 0,
        note: '', search: '', price_type: 'retail', branch_id: 1, location_id: 10,
        created_by: 2,
      }).returning('id').executeTakeFirstOrThrow();
      await anyDb.insertInto('held_sale_items').values({
        tenant_id: TENANT, account_id: ACCOUNT, held_sale_id: Number(inserted.id),
        product_id: 101, product_name: 'Widget 101', qty: 1, unit_price: 100,
        unit_name: 'قطعة', unit_multiplier: 1, price_type: 'retail', notes: '',
        modifiers: JSON.stringify([]),
      }).execute();
      const query = new SalesQueryService(db, new SalesAuthorizationService(db));
      const listed: any = await query.listHeldSales(cashierAuth);
      const draft = (listed.heldSales || [])[0] as any;
      assert.ok(draft, 'old draft is listed');
      assert.equal(draft.cart[0].lineKey, '101::قطعة::retail', 'lineKey falls back to the rebuilt key');
    } finally {
      await db.destroy();
    }
  });

  if (failures.length) throw new Error(`${failures.length} held-recall case(s) failed: ${failures.join(', ')}`);
  console.log('Restaurant held-recall tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
