/*
 * Price-list wiring (INV-VAN-PRICE-LIST-WIRING).
 *
 * THE GAP: the pricing engine existed but was orphaned — the only
 * caller of PriceListsService.calculateEffectivePrice was the
 * preview endpoint POST /api/sales/price-lists/calculate, whose
 * body had no paymentTerms, so its credit branch could never run;
 * no sale path ever consulted a customer's list. The POS charged
 * whatever priceType the client sent (retail unless the client said
 * wholesale), the van charged the tier base from the customer type
 * with no list at all, and there was no half-wholesale price
 * anywhere (the product form has cost / retail / wholesale /
 * credit / SRP, but no half-wholesale field). The cash discount
 * was not a system concept at all.
 *
 * THE RULE (user, 2026-11-16): purchase price + 4 selling prices
 * (retail, half-wholesale NEW, wholesale, credit = the BASE price
 * reps sell at) + a cash-discount % (tenant setting) off the
 * selling price on immediate cash payment — cash is NOT a stored
 * price. The engine is now ONE shared computation
 * (price-list-resolution.engine.ts) imported identically by the
 * preview endpoint, the POS sale path and the van sale path.
 * Resolution order: the customer's assigned list when it exists
 * AND is active; otherwise the tenant's active default list;
 * otherwise the base price. The tier is derived server-side from
 * the customer type (the client-supplied priceType is accepted by
 * the DTO but is never the authority). When a list rule applies,
 * the list price replaces the tier base and public offers do NOT
 * stack on it. The cash discount is a SEPARATE SYSTEM channel:
 * computed server-side from the tenant setting AFTER the rep-cap
 * combined check, applied in the immediate-cash branch only,
 * recorded distinctly in sales.system_cash_discount_amount — it
 * NEVER travels through cashDiscountAmount (the rep-entered,
 * cap-gated channel), so a rep already at the 5% cap still posts
 * with a 10% cash discount and no supervisor PIN is required.
 *
 * HARNESS: the real VanSalesService facade + the real
 * AccountingPostingService + a RECORDING fraud-radar stub on
 * PGlite (same reason as the P3 spec: the real radar writes via
 * the pool handle inside the sale's open transaction, which hangs
 * silently on PGlite's single connection). The real
 * PriceListsService (db only) and the real PartnersService (audit
 * stub, no opening balance posted at 0) drive the assignment and
 * delete pins. The tenant foundation is stubbed no-op;
 * resolveSystemAuthContext is shadowed on the facade instance
 * after construction. Tear down is db.destroy() only.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { hashManagerPin } from '../../src/common/utils/manager-approval';
import { getCashDiscountPercent } from '../../src/modules/delivery-reps/rep-target.engine';
import { resolveListEffectivePrice, resolvePriceListContext } from '../../src/modules/sales/engines/price-list-resolution.engine';
import { PriceListsService } from '../../src/modules/sales/services/price-lists.service';
import { PartnersService } from '../../src/modules/partners/partners.service';
import { calculateAllowedSaleUnitPrice } from '../../src/modules/sales/helpers/sales-write.helper';

const TENANT = 't-van-price-list';
const ACCOUNT = 'a-van-price-list';

const ADMIN = {
  userId: 2,
  sessionId: 'spec',
  username: 'sup',
  role: 'admin',
  permissions: ['deliveryReps', 'accounting', 'canManageSettings'],
  tenantId: TENANT,
  accountId: ACCOUNT,
};

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE cost_centers (id bigserial PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE hr_employees (id bigserial PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cash_flow_category text, updated_at timestamptz);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, permissions jsonb, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, plate_number text, model_name text, vehicle_type text, current_odometer numeric, fuel_type text, license_expires_at timestamptz, status text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, metadata text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, half_wholesale_price numeric, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE inventory_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30), quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, shift_name text, start_odometer numeric, end_odometer numeric, distance_km numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric, stock_variance_amount numeric, stock_variance_details jsonb, night_stock_approved boolean, notes text, night_stock_approved_by bigint, night_stock_notes text, business_day date, submitted_per_day_cash jsonb, opened_at timestamptz, submitted_at timestamptz, settled_by bigint, supervisor_id bigint, closed_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, gps_missing_reason text, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW(), received_at timestamptz);
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_inventory_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, store_credit_balance numeric DEFAULT 0, company_name text, tax_number text, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, price_list_id bigint, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, gps_lat numeric, gps_lng numeric, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric DEFAULT 0, payment_channel text, note text, branch_id bigint, location_id bigint, job_id text, created_by bigint, transfer_reference text, instapay_address text, transfer_receipt_url text, van_trip_id bigint, rep_id bigint, client_tx_id text, created_at timestamptz DEFAULT NOW(), received_at timestamptz);
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, trip_id bigint, rep_id bigint, customer_id bigint, sale_id bigint, status text, return_reason text, refund_method text, total_amount numeric DEFAULT 0, items_json jsonb, notes text, rejection_reason text, approved_by bigint, approved_at timestamptz, created_at timestamptz DEFAULT NOW(), received_at timestamptz, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric DEFAULT 0, request_key text, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, opening_cash numeric DEFAULT 0, opening_note text, status text, terminal_code text, expected_cash numeric, counted_cash numeric, variance numeric, variance_resolution text, variance_journal_entry_id bigint, variance_approved_by bigint, variance_approved_at timestamptz, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, settled_at timestamptz, settled_by bigint, settlement_method text, notes text, receipt_voucher_no text, payroll_run_id bigint, business_day date, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE settlement_allocations (id bigserial PRIMARY KEY, tenant_id text, settlement_id bigint, sale_id bigint, customer_payment_id bigint, amount numeric DEFAULT 0, business_day date, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, expense_type text, amount numeric DEFAULT 0, notes text, receipt_photo_url text, created_by_user_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE delivery_rep_targets (id bigserial PRIMARY KEY, tenant_id text, rep_id bigint, period_month text, target_amount numeric DEFAULT 0, collection_target numeric, visits_target numeric);
      CREATE TABLE van_damaged_swaps (id bigserial PRIMARY KEY, tenant_id text, trip_id bigint, customer_id bigint, damaged_product_id bigint, damaged_qty numeric, damage_reason text, replacement_product_id bigint, replacement_qty numeric, price_difference numeric, notes text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE hr_holidays (id bigserial PRIMARY KEY, tenant_id text, start_date date, end_date date);
      CREATE TABLE product_units (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, name text, multiplier numeric);
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, action text, event_code text, idempotency_key text, details text, target_tenant_id text, created_by bigint, impersonated_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text, type text, default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
      CREATE TABLE price_list_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, price_list_id bigint, product_id bigint, product_name text, category_id bigint, min_quantity numeric DEFAULT 1, fixed_price numeric, discount_percent numeric, created_at timestamptz DEFAULT NOW());
    `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values([
    { tenant_id: TENANT, key: 'currency', value: 'EGP' },
    { tenant_id: TENANT, key: 'timezone', value: 'Africa/Cairo' },
  ]).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values([
    { id: 1, tenant_id: TENANT, username: 'sys', phone: null, is_active: true },
    { id: 2, tenant_id: TENANT, username: 'sup', phone: null, role: 'admin', is_active: true },
  ]).execute();
  const accounts: Array<[number, string, string]> = [
    [1110, '1110', 'asset'], [1120, '1120', 'asset'], [1130, '1130', 'asset'], [1140, '1140', 'asset'],
    [1160, '1160', 'asset'], [2120, '2120', 'liability'], [4100, '4100', 'revenue'], [4300, '4300', 'revenue'],
    [5100, '5100', 'expense'], [6400, '6400', 'expense'], [7100, '7100', 'revenue'], [7200, '7200', 'expense'],
  ];
  for (const [id, code, type] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, account_type: type, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, inventory_account_id: 1140,
    sales_revenue_account_id: 4100, sales_discount_account_id: 4300,
    cogs_account_id: 5100, sales_tax_account_id: 2120,
    lock_date_all: null, lock_date_non_adviser: null, lock_date_tax: null,
  }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, name: 'Van', location_type: 'van', is_active: true }).execute();
  // Rep 1: BOTH discounts (per-line + invoice), stored cap 0 (inert).
  await anyDb.insertInto('delivery_representatives').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 1', phone: null, van_location_id: 20, is_van_rep: true, permissions: JSON.stringify({ can_give_discount: true, can_give_invoice_discount: true, max_discount_percent: 0, can_collect_cash: true }) }).execute();
  await anyDb.insertInto('customers').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Customer 1', balance: 500, credit_limit: 10000, is_active: true }).execute();
  // The foundation seeds id 1 explicitly; move the bigserial
  // sequence past it so service inserts (case 11/12) do not collide.
  await sql`SELECT setval(pg_get_serial_sequence('customers', 'id'), (SELECT MAX(id) FROM customers))`.execute(db);
  await anyDb.insertInto('cashier_shifts').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'CS-1', opened_by: 2, opening_cash: 0, status: 'open', branch_id: null, location_id: null }).execute();
}

async function seedTrip(db: Kysely<Database>, id: number, repId = 1): Promise<void> {
  await (db as any).insertInto('van_sales_trips').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, rep_id: repId, vehicle_id: null,
    shift_name: null, start_odometer: 100, end_odometer: null, distance_km: null,
    van_location_id: 20, source_warehouse_id: 10, status: 'open',
    settlement_status: 'open', loaded_amount: 0, sales_amount: 0, cash_collected: 0,
    credit_sales: 0, returns_amount: 0, cash_refunds: 0, total_instapay_sales: 0,
    total_instapay_collections: 0, variance: null, stock_variance_details: null, notes: null,
    night_stock_approved_by: null, night_stock_notes: null,
    business_day: null, submitted_per_day_cash: null,
    opened_at: '2026-11-09T08:00:00+02:00',
  }).execute();
}

async function seedProduct(
  db: Kysely<Database>,
  id: number,
  prices: { retail: number; wholesale: number; half?: number | null; credit: number; cost?: number },
  vanQty = 100,
): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('products').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, name: `Product ${id}`,
    stock_qty: vanQty, cost_price: prices.cost ?? 50,
    retail_price: prices.retail, wholesale_price: prices.wholesale,
    half_wholesale_price: prices.half ?? null, credit_price: prices.credit,
    is_active: true,
  }).execute();
  await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: id, location_id: 20, qty: vanQty }).execute();
}

async function seedCustomer(db: Kysely<Database>, id: number, type: string, priceListId: number | null = null): Promise<void> {
  await (db as any).insertInto('customers').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, name: `Customer ${id}`,
    balance: 0, credit_limit: 100000, customer_type: type, price_list_id: priceListId, is_active: true,
  }).execute();
}

async function seedList(
  db: Kysely<Database>,
  id: number,
  opts: { isDefault?: boolean; isActive?: boolean; defaultDiscount?: number; name?: string } = {},
): Promise<void> {
  await (db as any).insertInto('price_lists').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, name: opts.name || `List ${id}`, code: `L${id}`,
    currency: 'EGP', type: 'percentage', default_discount_percent: opts.defaultDiscount ?? 0,
    is_default: opts.isDefault ?? false, is_active: opts.isActive ?? true, notes: null,
  }).execute();
}

async function seedListItem(
  db: Kysely<Database>,
  listId: number,
  productId: number,
  opts: { minQty?: number; fixedPrice?: number | null; discountPercent?: number | null } = {},
): Promise<void> {
  await (db as any).insertInto('price_list_items').values({
    tenant_id: TENANT, account_id: ACCOUNT, price_list_id: listId, product_id: productId,
    min_quantity: opts.minQty ?? 1,
    fixed_price: opts.fixedPrice ?? null, discount_percent: opts.discountPercent ?? null,
  }).execute();
}

async function seedOffer(db: Kysely<Database>, productId: number, value: number): Promise<void> {
  await (db as any).insertInto('product_offers').values({
    product_id: productId, offer_type: 'percent', value, min_qty: 1,
    start_date: '2020-01-01', end_date: '2030-12-31',
    bogo_buy_qty: null, bogo_get_qty: null, bogo_discount_percent: null,
    happy_hour_start: null, happy_hour_end: null, days_of_week: null,
    tenant_id: TENANT, is_active: true,
  }).execute();
}

function buildService(db: Kysely<Database>): VanSalesService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const recordedFraudEvents: any[] = [];
  const fraudStub = {
    recordSuspicionEvent: async (params: any) => { recordedFraudEvents.push(params); },
    getSummary: async () => ({}),
    getEvents: async () => [],
  };
  const service = new VanSalesService(db, {} as never, {} as never, posting as never,
    undefined, undefined, undefined, undefined, undefined, undefined, fraudStub as never);
  (service as any).recordedFraudEvents = recordedFraudEvents;
  (service as any).resolveSystemAuthContext = async () => ({
    userId: 1, sessionId: 'spec', username: 'spec', role: 'admin',
    permissions: ['accounting'], tenantId: TENANT, accountId: ACCOUNT,
  });
  return service;
}

async function saleRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('sales').selectAll().where('id', '=', id).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
}

async function saleItems(db: Kysely<Database>, saleId: number): Promise<any[]> {
  return (db as any).selectFrom('sale_items').selectAll().where('sale_id', '=', saleId).where('tenant_id', '=', TENANT).execute();
}

async function setSetting(db: Kysely<Database>, key: string, value: string): Promise<void> {
  await (db as any).insertInto('settings').values({ tenant_id: TENANT, key, value }).execute();
}

async function setCashDiscount(db: Kysely<Database>, pct: number): Promise<void> {
  await setSetting(db, 'cashDiscountPercent', String(pct));
}

async function seedPin(db: Kysely<Database>, pin: string): Promise<void> {
  const hash = await hashManagerPin(pin);
  await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: hash }).execute();
}

function errorCode(e: unknown): string {
  return (e as any)?.code ? String((e as any).code) : '';
}

async function main(): Promise<void> {
  // 0. The engine itself + the cash-discount resolver + the service
  // delegation (no sale): context order, item rules, credit branch,
  // default fallback, and calculateEffectivePrice == engine.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      // Cash-discount resolver: no row = 0 (off); 10 = 10; 250
      // clamps to 100; garbage = 0; 0 = 0.
      assert.equal(await getCashDiscountPercent(db as any, TENANT), 0);
      await setCashDiscount(db, 10);
      assert.equal(await getCashDiscountPercent(db as any, TENANT), 10);
      await (db as any).updateTable('settings').set({ value: '250' }).where('tenant_id', '=', TENANT).where('key', '=', 'cashDiscountPercent').execute();
      assert.equal(await getCashDiscountPercent(db as any, TENANT), 100);
      await (db as any).updateTable('settings').set({ value: 'not-a-number' }).where('tenant_id', '=', TENANT).where('key', '=', 'cashDiscountPercent').execute();
      assert.equal(await getCashDiscountPercent(db as any, TENANT), 0);
      await (db as any).updateTable('settings').set({ value: '0' }).where('tenant_id', '=', TENANT).where('key', '=', 'cashDiscountPercent').execute();
      assert.equal(await getCashDiscountPercent(db as any, TENANT), 0);

      await seedList(db, 1, { isDefault: true, defaultDiscount: 0 });
      await seedList(db, 2, { defaultDiscount: 0 });
      await seedList(db, 3, { isActive: false });
      await seedList(db, 4, { defaultDiscount: 15 });
      await seedCustomer(db, 2, 'cash', 2);
      await seedCustomer(db, 3, 'cash', 3);
      await seedCustomer(db, 4, 'cash', 999);
      await seedCustomer(db, 5, 'cash', 4);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedProduct(db, 102, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedProduct(db, 103, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedListItem(db, 2, 101, { discountPercent: 10 });
      await seedListItem(db, 2, 103, { fixedPrice: 55 });

      // Context: assigned active list wins; an inactive assigned
      // list and an unknown assigned id both fall through to the
      // default list; no customer resolves the default list.
      const ctx2 = await resolvePriceListContext(db as any, TENANT, 2);
      assert.equal(ctx2?.priceListId, 2);
      const ctx3 = await resolvePriceListContext(db as any, TENANT, 3);
      assert.equal(ctx3?.priceListId, 1);
      const ctx4 = await resolvePriceListContext(db as any, TENANT, 4);
      assert.equal(ctx4?.priceListId, 1);
      const ctxWalkIn = await resolvePriceListContext(db as any, TENANT, null);
      assert.equal(ctxWalkIn?.priceListId, 1);
      const ctx5 = await resolvePriceListContext(db as any, TENANT, 5);
      assert.equal(ctx5?.priceListId, 4);

      // Item discount off the tier base.
      const itemDisc = await resolveListEffectivePrice(db as any, TENANT, ctx2, 101, 1, 80);
      assert.equal(itemDisc.effectivePrice, 72);
      assert.equal(itemDisc.discountPercent, 10);
      assert.equal(itemDisc.appliedRule, 'product_discount');
      assert.equal(itemDisc.priceListId, 2);
      // Fixed price, with the discount % derived from the base.
      const fixed = await resolveListEffectivePrice(db as any, TENANT, ctx2, 103, 1, 100);
      assert.equal(fixed.effectivePrice, 55);
      assert.equal(fixed.discountPercent, 45);
      assert.equal(fixed.appliedRule, 'product_fixed_price');
      // List default discount when no item matches the product.
      const listDefault = await resolveListEffectivePrice(db as any, TENANT, ctx5, 102, 1, 100);
      assert.equal(listDefault.effectivePrice, 85);
      assert.equal(listDefault.discountPercent, 15);
      assert.equal(listDefault.appliedRule, 'list_default_discount');
      // Credit branch: the base is re-based to the credit price
      // FIRST, then the item discount applies on the credit base
      // (90 * 0.9 = 81, not 72).
      const credit = await resolveListEffectivePrice(db as any, TENANT, ctx2, 101, 1, 80, { paymentTerms: 'credit' });
      assert.equal(credit.effectivePrice, 81);
      assert.equal(credit.appliedRule, 'product_discount');
      // No context = the base price, rule 'none'.
      const none = await resolveListEffectivePrice(db as any, TENANT, null, 101, 1, 80);
      assert.equal(none.effectivePrice, 80);
      assert.equal(none.appliedRule, 'none');
      assert.equal(none.priceListId, null);

      // The preview endpoint delegates to the same engine: the
      // numbers must match the direct engine calls above, and the
      // credit branch is now reachable through the body.
      const svc = new PriceListsService(db as any);
      const preview = await svc.calculateEffectivePrice(ADMIN as never, 2, 101, 1, 80);
      assert.equal(preview.effectivePrice, 72);
      assert.equal(preview.appliedRule, 'product_discount');
      const previewCredit = await svc.calculateEffectivePrice(ADMIN as never, 2, 101, 1, 80, { paymentTerms: 'credit' });
      assert.equal(previewCredit.effectivePrice, 81);
      console.log('0. engine + resolvers + service delegation passed');
    } finally { await db.destroy(); }
  }

  // 0b. No default list anywhere: the context is null and the
  // engine returns the base price.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedCustomer(db, 2, 'cash', null);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      assert.equal(await resolvePriceListContext(db as any, TENANT, 2), null);
      assert.equal(await resolvePriceListContext(db as any, TENANT, null), null);
      const none = await resolveListEffectivePrice(db as any, TENANT, null, 101, 1, 80);
      assert.equal(none.effectivePrice, 80);
      console.log('0b. no-list fallback passed');
    } finally { await db.destroy(); }
  }

  // 1. Wholesale customer + assigned list: the list discounts FROM
  // the wholesale base (80 * 0.9 = 72), and the server price wins
  // over the retail price the old client still sends (100).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedList(db, 1, { isDefault: true });
      await seedList(db, 2, {});
      await seedListItem(db, 2, 101, { discountPercent: 10 });
      await seedCustomer(db, 2, 'wholesale', 2);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 2, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(res.total, 720);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.total), 720);
      assert.equal(Number(sale.discount), 0);
      const items = await saleItems(db, res.saleId);
      assert.equal(items.length, 1);
      assert.equal(Number(items[0].unit_price), 72);
      assert.equal(Number(items[0].line_total), 720);
      assert.equal(items[0].pricing_tier_type, 'wholesale');
      console.log('1. wholesale + list discounts from wholesale base passed');
    } finally { await db.destroy(); }
  }

  // 2. Half-wholesale customer with a set half price: charged the
  // half price (70), tier stored as half_wholesale.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedCustomer(db, 3, 'half_wholesale', null);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 3, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(res.total, 700);
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].unit_price), 70);
      assert.equal(items[0].pricing_tier_type, 'half_wholesale');
      console.log('2. half-wholesale price passed');
    } finally { await db.destroy(); }
  }

  // 3. Half-wholesale customer with a NULL half price: falls back
  // to wholesale (80) — never to zero, never straight to retail
  // while wholesale is set.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: null, credit: 90 });
      await seedCustomer(db, 3, 'half_wholesale', null);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 3, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(res.total, 800);
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].unit_price), 80);
      assert.equal(items[0].pricing_tier_type, 'half_wholesale');
      console.log('3. half-wholesale NULL falls back to wholesale passed');
    } finally { await db.destroy(); }
  }

  // 4. Credit: a credit customer on a credit sale is charged the
  // credit price (90); a wholesale customer on a credit sale keeps
  // the wholesale price (80) — wholesale beats credit.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedCustomer(db, 4, 'credit', null);
      await seedCustomer(db, 2, 'wholesale', null);
      await seedTrip(db, 1, 1);
      await seedTrip(db, 2, 1);
      const service = buildService(db);
      const creditRes = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 4, paymentMethod: 'credit',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(creditRes.total, 900);
      const creditItems = await saleItems(db, creditRes.saleId);
      assert.equal(Number(creditItems[0].unit_price), 90);
      assert.equal(creditItems[0].pricing_tier_type, 'credit');
      const wholesaleRes = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 2, customerId: 2, paymentMethod: 'credit',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(wholesaleRes.total, 800);
      const wholesaleItems = await saleItems(db, wholesaleRes.saleId);
      assert.equal(Number(wholesaleItems[0].unit_price), 80);
      assert.equal(wholesaleItems[0].pricing_tier_type, 'wholesale');
      console.log('4. credit price + wholesale-beats-credit passed');
    } finally { await db.destroy(); }
  }

  // 5. VIP without a list prices at retail (100); VIP with a list
  // prices at the list (100 * 0.9 = 90) — VIP has no price effect
  // of its own.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedList(db, 1, { isDefault: true });
      await seedList(db, 2, {});
      await seedListItem(db, 2, 101, { discountPercent: 10 });
      await seedCustomer(db, 5, 'vip', null);
      await seedCustomer(db, 6, 'vip', 2);
      await seedTrip(db, 1, 1);
      await seedTrip(db, 2, 1);
      const service = buildService(db);
      const noList = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 5, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(noList.total, 1000);
      const withList = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 2, customerId: 6, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(withList.total, 900);
      const items = await saleItems(db, withList.saleId);
      assert.equal(Number(items[0].unit_price), 90);
      console.log('5. VIP retail without list, list with list passed');
    } finally { await db.destroy(); }
  }

  // 6. Walk-in (no customer) prices at retail.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(res.total, 1000);
      console.log('6. walk-in retail passed');
    } finally { await db.destroy(); }
  }

  // 7. P4 x P3: a rep already AT the 5% cap (lineDiscount 50 on a
  // 1000 gross) still posts with a 10% system cash discount — the
  // system discount is computed on the NET (950 * 10% = 95, not
  // 100), recorded distinctly, and needs no supervisor PIN.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setCashDiscount(db, 10);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, unitPrice: 100, lineDiscount: 50 }],
      });
      assert.equal(res.total, 855);
      assert.equal(res.systemCashDiscountAmount, 95);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.total), 855);
      assert.equal(Number(sale.subtotal), 1000);
      assert.equal(Number(sale.discount), 145);
      assert.equal(Number(sale.system_cash_discount_amount), 95);
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].line_discount), 50);
      console.log('7. rep at cap + 10% system cash discount posts passed');
    } finally { await db.destroy(); }
  }

  // 8. The system cash discount NEVER applies off immediate cash:
  // credit, card and split sales all post with 0.
  {
    // 8a. Credit.
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setCashDiscount(db, 10);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 100 });
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 1, paymentMethod: 'credit',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(res.total, 1000);
      assert.equal(res.systemCashDiscountAmount, 0);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.system_cash_discount_amount), 0);
      console.log('8a. no system cash discount on credit passed');
    } finally { await db.destroy(); }
  }
  {
    // 8b. Card (evidence gate: PIN + reference).
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedPin(db, '1234');
      await setCashDiscount(db, 10);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 1, paymentMethod: 'card',
        supervisorOverridePin: '1234', supervisorOverrideReason: 'card receipt 123',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(res.total, 1000);
      assert.equal(res.systemCashDiscountAmount, 0);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.system_cash_discount_amount), 0);
      console.log('8b. no system cash discount on card passed');
    } finally { await db.destroy(); }
  }
  {
    // 8c. Split. Note the tier base for a split sale IS the credit
    // price (the van's own isCreditSale covers credit OR split, so
    // the engine's credit branch re-bases 100 -> 90): the pin here
    // is the system amount 0, not the tier base.
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await setCashDiscount(db, 10);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 1, paymentMethod: 'split', paidAmount: 500,
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(res.total, 900);
      assert.equal(res.systemCashDiscountAmount, 0);
      assert.equal(res.cashPaid, 500);
      assert.equal(res.creditOwed, 400);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.system_cash_discount_amount), 0);
      console.log('8c. no system cash discount on split passed');
    } finally { await db.destroy(); }
  }

  // 9. Cash discount setting off (no row): totals unchanged,
  // system amount 0.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(res.total, 1000);
      assert.equal(res.systemCashDiscountAmount, 0);
      const sale = await saleRow(db, res.saleId);
      assert.equal(Number(sale.system_cash_discount_amount), 0);
      assert.equal(Number(sale.discount), 0);
      console.log('9. cash discount off leaves totals unchanged passed');
    } finally { await db.destroy(); }
  }

  // 10. List vs offer: the product has a live 20% public offer AND
  // a 10% list rule — the list price (72) wins; the offer is NOT
  // stacked (not 64, not 57.6) and no offer savings are recorded.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProduct(db, 101, { retail: 100, wholesale: 80, half: 70, credit: 90 });
      await seedOffer(db, 101, 20);
      await seedList(db, 1, { isDefault: true });
      await seedList(db, 2, {});
      await seedListItem(db, 2, 101, { discountPercent: 10 });
      await seedCustomer(db, 2, 'wholesale', 2);
      await seedTrip(db, 1, 1);
      const service = buildService(db);
      const res = await service.executeFieldSale(1, TENANT, ACCOUNT, {
        tripId: 1, customerId: 2, paymentMethod: 'cash',
        items: [{ productId: 101, qty: 10, unitPrice: 100 }],
      });
      assert.equal(res.total, 720);
      const items = await saleItems(db, res.saleId);
      assert.equal(Number(items[0].unit_price), 72);
      assert.equal(Number(items[0].line_total), 720);
      assert.equal(Number(items[0].unit_offer_savings || 0), 0);
      console.log('10. list wins over offer, no stacking passed');
    } finally { await db.destroy(); }
  }

  // 11. Assignment validation through the real PartnersService:
  // the payloads carry a valid phone (F4 gate) so the call reaches
  // the price-list check instead of stopping at CUSTOMER_PHONE_REQUIRED;
  // an unknown list id is refused (400, nothing written); a real
  // list id is stored; clearing with null works; an unknown id on
  // update is refused too.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedList(db, 1, {});
      const partners = new PartnersService(db as any, { log: async () => {} } as never, {} as never);
      let thrown: unknown = null;
      try {
        await partners.createCustomer({ name: 'Bad', creditLimit: 0, priceListId: 999, phone: '01012345678' } as never, ADMIN as never);
      } catch (e) { thrown = e; }
      assert.ok(thrown, 'an unknown list id must throw');
      assert.equal(errorCode(thrown), 'PRICE_LIST_NOT_FOUND');
      const before = await (db as any).selectFrom('customers').selectAll().where('tenant_id', '=', TENANT).execute();
      assert.equal(before.length, 1);
      const created = await partners.createCustomer({ name: 'Good', creditLimit: 0, priceListId: 1, phone: '01012345678' } as never, ADMIN as never);
      assert.equal(created.ok, true);
      const goodId = Number((created as any).id);
      const goodRow = await (db as any).selectFrom('customers').selectAll().where('id', '=', goodId).executeTakeFirstOrThrow();
      assert.equal(Number(goodRow.price_list_id), 1);
      thrown = null;
      try {
        await partners.updateCustomer(goodId, { name: 'Good', creditLimit: 0, priceListId: 999, phone: '01012345678' } as never, ADMIN as never);
      } catch (e) { thrown = e; }
      assert.ok(thrown, 'an unknown list id on update must throw');
      assert.equal(errorCode(thrown), 'PRICE_LIST_NOT_FOUND');
      await partners.updateCustomer(goodId, { name: 'Good', creditLimit: 0, priceListId: null, phone: '01012345678' } as never, ADMIN as never);
      const cleared = await (db as any).selectFrom('customers').selectAll().where('id', '=', goodId).executeTakeFirstOrThrow();
      assert.equal(cleared.price_list_id, null);
      console.log('11. assignment validation passed');
    } finally { await db.destroy(); }
  }

  // 12. Assign-then-delete detaches: deleting a list nulls the
  // assignment on its customers (existing service behavior, now
  // reachable through the assignment write path).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedList(db, 1, {});
      const partners = new PartnersService(db as any, { log: async () => {} } as never, {} as never);
      const created = await partners.createCustomer({ name: 'Listed', creditLimit: 0, priceListId: 1, phone: '01012345678' } as never, ADMIN as never);
      const custId = Number((created as any).id);
      const lists = new PriceListsService(db as any);
      await lists.deletePriceList(ADMIN as never, 1);
      const row = await (db as any).selectFrom('customers').selectAll().where('id', '=', custId).executeTakeFirstOrThrow();
      assert.equal(row.price_list_id, null);
      const gone = await (db as any).selectFrom('price_lists').selectAll().where('id', '=', 1).executeTakeFirst();
      assert.equal(gone, undefined);
      console.log('12. delete detaches customers passed');
    } finally { await db.destroy(); }
  }

  // 13. POS allowed price (pure helper): the 4 tiers, the
  // half-wholesale fallback, and the list price overriding offers.
  {
    const digits = 2 as const;
    const offer20 = { offer_type: 'percent', value: 20, min_qty: 1, start_date: '2020-01-01', end_date: '2030-12-31' };
    assert.equal(calculateAllowedSaleUnitPrice({ retailPrice: 100, wholesalePrice: 80, halfWholesalePrice: 70, creditPrice: 90, priceType: 'half_wholesale', moneyDigits: digits }), 70);
    assert.equal(calculateAllowedSaleUnitPrice({ retailPrice: 100, wholesalePrice: 80, halfWholesalePrice: null, creditPrice: 90, priceType: 'half_wholesale', moneyDigits: digits }), 80);
    assert.equal(calculateAllowedSaleUnitPrice({ retailPrice: 100, wholesalePrice: 80, halfWholesalePrice: 70, creditPrice: 90, priceType: 'credit', moneyDigits: digits }), 90);
    assert.equal(calculateAllowedSaleUnitPrice({ retailPrice: 100, wholesalePrice: 80, priceType: 'wholesale', offers: [offer20], moneyDigits: digits }), 80);
    assert.equal(calculateAllowedSaleUnitPrice({ retailPrice: 100, wholesalePrice: 80, priceType: 'retail', offers: [offer20], moneyDigits: digits }), 80);
    // A list price is the authority: the 20% offer does not stack.
    assert.equal(calculateAllowedSaleUnitPrice({ retailPrice: 100, wholesalePrice: 80, priceType: 'retail', listEffectivePrice: 72, offers: [offer20], moneyDigits: digits }), 72);
    assert.equal(calculateAllowedSaleUnitPrice({ retailPrice: 100, wholesalePrice: 80, priceType: 'retail', moneyDigits: digits }), 100);
    console.log('13. POS allowed-price tiers + list override passed');
  }

  console.log('ALL VAN PRICE-LIST WIRING CASES PASSED');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
