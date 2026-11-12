/*
New file: backend/test/critical/storefront-convert-delivery-fee-mode.spec.ts

WHAT THIS PINS (INV-STOREFRONT-DELIVERY-FEE-MODE): convertToSale
must honour the tenant's own deliveryFeeMode setting instead of
hardcoding 'store_fleet' (C3). Before this fix, every converted
delivery order posted its fee as store revenue Cr 4200 even when
the tenant's mode was courier/freelance — so the fee never reached
the rep payable Cr 2115, and at settlement the fee was never
deducted (the rep had to hand over the full amount including his
own fee, with no 2115 payable to pay him from). The same
conversion also picked the lowest-id active rep with no rep_type
filter, so a van rep could be picked for a storefront delivery,
and the auto-created store rep carried no marking at all.

THE CASES, WORKED ONCE (goods product 101: 2 units at 50,
cost 10, location stock 100; delivery fee 20; order total 120;
all orders unpaid COD, so the fee leg is what distinguishes
the modes):
(a) Tenant mode freelance_courier, with a store_fleet rep as
the only rep: the converted sale carries delivery_fee_mode
'freelance_courier' — the setting beats both the old hardcode
AND createSale's rep-type inference — and the fee posts
Cr 2115 = 20, Cr 4200 = 0; the journal balances.
(b) Tenant mode store_fleet preserved: the sale carries
'store_fleet' and the fee posts Cr 4200 = 20, Cr 2115 = 0;
the journal balances.
(c) Rep selection: a van rep (id 1, rep_type 'van') and a
delivery rep (id 2, rep_type 'delivery') are both active; the
conversion picks the delivery rep (sale.delivery_rep_id = 2),
never the lower-id van rep.
(d) Auto-created store rep: with no reps at all, conversion
creates the store rep marked metadata.auto_created_store_rep
= true, rep_type 'store_fleet', with no phone and no PIN
(pin_hash/pin_salt null), and the sale links to it.

HOW THIS IS DRIVEN: the real StorefrontService over the real
SalesService facade (real SalesQueryService + real
SalesWriteService chain) on PGlite, with the fixture
foundation copied from storefront-paid-delivery-conversion
plus the 2115/4200 accounts and the pin/metadata columns on
delivery_representatives. Journal legs are read from the
posted journal rows, never re-implemented.

RED PROOF: on the unfixed tree case (a) posts Cr 4200 = 20
and Cr 2115 = 0, case (c) links the van rep (id 1), and
case (d) creates the rep with no metadata marking.
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
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code varchar(32), settled_at timestamptz, settled_by bigint, delivery_signature text, delivery_photo_url text, delivery_notes text, dispatched_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric(15, 3), net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigint PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, is_active boolean DEFAULT true, rep_type text, pin_hash text, pin_salt text, metadata jsonb, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT false, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
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
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, tip_relief numeric, courier_relief numeric, exchange_tip_relief numeric(15, 3), exchange_courier_relief numeric(15, 3), branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_document_id bigint, product_id bigint, product_name text, sale_item_id bigint, purchase_item_id bigint, qty numeric, unit_total numeric, line_total numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE held_sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, payment_type text, payment_channel text, paid_amount numeric DEFAULT 0, cash_amount numeric DEFAULT 0, card_amount numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, note text, search text, table_number text, order_type text, price_type text, branch_id bigint, location_id bigint, delivery_rep_id bigint, collection_status text, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), tip_amount numeric(15, 3) DEFAULT 0, loyalty_points_redeemed integer DEFAULT 0, pager_number text, delivery_fee_mode text, online_order_id bigint, dining_course text, guest_count integer, guest_check_printed_at timestamptz);
    CREATE TABLE held_sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, held_sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, unit_name text, unit_multiplier numeric, price_type text, notes text, modifiers jsonb, created_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

type SeedRep = { id: number; name: string; rep_type: string; is_van_rep?: boolean };

async function seedFoundation(
  db: Kysely<Database>,
  opts: { deliveryFeeMode?: string; reps?: SeedRep[] },
): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'taxRate', value: '14' }).execute();
  if (opts.deliveryFeeMode) {
    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'deliveryFeeMode', value: opts.deliveryFeeMode }).execute();
  }
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  const accounts: Array<[number, string, string | null]> = [
    [1110, '1110', null], [1120, '1120', null], [1130, '1130', null], [1140, '1140', null],
    [2115, '2115', 'liability'], [2120, '2120', null], [4100, '4100', null], [4200, '4200', 'revenue'], [4300, '4300', null], [5100, '5100', null],
  ];
  for (const [id, code, accountType] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true, is_tax: false, account_type: accountType }).execute();
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
  for (const rep of opts.reps || []) {
    await anyDb.insertInto('delivery_representatives').values({
      id: rep.id, tenant_id: TENANT, account_id: ACCOUNT, name: rep.name,
      phone: null, is_active: true, rep_type: rep.rep_type, is_van_rep: rep.is_van_rep || false,
    }).execute();
  }
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

async function seedOrder(db: Kysely<Database>): Promise<void> {
  // Unpaid COD delivery order: goods 100 + delivery fee 20 = 120.
  const base: Record<string, unknown> = {
    id: 77, tenant_id: TENANT, account_id: ACCOUNT, order_number: 'ON-1',
    customer_name: 'Online Customer', customer_phone: '01012345678', customer_address: 'Cairo',
    items_json: JSON.stringify([{ productId: 101, quantity: 2, unitPrice: 50, total: 100 }]),
    subtotal: 100, delivery_fee: 20, total_amount: 120, status: 'confirmed',
    payment_method: 'cod', payment_status: 'pending', gateway_provider: '',
    fulfillment_type: 'delivery', branch_id: 1, sale_id: null,
    discount_amount: 0, coupon_code: null,
  };
  await (db as any).insertInto('online_orders').values(base).execute();
}

async function readSale(db: Kysely<Database>, saleId: number): Promise<any> {
  return (db as any).selectFrom('sales').selectAll()
    .where('id', '=', saleId).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
}

async function readReps(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('delivery_representatives').selectAll()
    .where('tenant_id', '=', TENANT).orderBy('id', 'asc').execute();
}

async function journalLeg(db: Kysely<Database>, saleId: number, accountId: number, side: 'debit' | 'credit'): Promise<number> {
  const entries = await (db as any).selectFrom('journal_entries').select('id')
    .where('source_type', '=', 'sale').where('source_id', '=', saleId).execute();
  assert.equal(entries.length, 1, 'exactly one posted sale journal');
  const rows = await (db as any).selectFrom('journal_entry_lines').select([side])
    .where('journal_entry_id', '=', entries[0].id)
    .where('account_id', '=', accountId).execute();
  return rows.reduce((sum: number, row: any) => sum + Number(row[side] || 0), 0);
}

async function journalTotals(db: Kysely<Database>, saleId: number): Promise<{ debit: number; credit: number }> {
  const entries = await (db as any).selectFrom('journal_entries').select('id')
    .where('source_type', '=', 'sale').where('source_id', '=', saleId).execute();
  const rows = await (db as any).selectFrom('journal_entry_lines').select(['debit', 'credit'])
    .where('journal_entry_id', '=', entries[0].id).execute();
  return rows.reduce((acc: { debit: number; credit: number }, row: any) => ({
    debit: acc.debit + Number(row.debit || 0),
    credit: acc.credit + Number(row.credit || 0),
  }), { debit: 0, credit: 0 });
}

async function main(): Promise<void> {
  // (a) Tenant mode freelance_courier beats the old hardcode AND
  // the rep-type inference (the only rep is a store_fleet rep).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, {
        deliveryFeeMode: 'freelance_courier',
        reps: [{ id: 2, name: 'Store Rep', rep_type: 'store_fleet' }],
      });
      await seedOrder(db);
      const service = buildServices(db);
      const result: any = await service.convertToSale(77, adminAuth);
      assert.equal(result.ok, true, 'courier-mode conversion must succeed');
      const saleId = Number(result.saleId);
      assert.ok(Number.isInteger(saleId) && saleId > 0, 'conversion must return a sale id');
      const sale = await readSale(db, saleId);
      assert.equal(sale.delivery_fee_mode, 'freelance_courier', 'the sale carries the tenant courier mode, not store_fleet');
      assert.equal(Number(sale.delivery_rep_id), 2, 'the conversion links the store rep');
      assert.equal(await journalLeg(db, saleId, 2115, 'credit'), 20, 'the courier fee posts Cr 2115 (rep payable)');
      assert.equal(await journalLeg(db, saleId, 4200, 'credit'), 0, 'no delivery fee reaches Cr 4200 store revenue');
      const totals = await journalTotals(db, saleId);
      assert.equal(totals.debit, totals.credit, 'the sale journal balances');
    } finally {
      await db.destroy();
    }
    console.log('  courier tenant mode posts Cr 2115 passed');
  }

  // (b) Tenant mode store_fleet preserved: fee is store revenue.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, {
        deliveryFeeMode: 'store_fleet',
        reps: [{ id: 2, name: 'Delivery Rep', rep_type: 'delivery' }],
      });
      await seedOrder(db);
      const service = buildServices(db);
      const result: any = await service.convertToSale(77, adminAuth);
      assert.equal(result.ok, true, 'store-fleet conversion must succeed');
      const sale = await readSale(db, Number(result.saleId));
      assert.equal(sale.delivery_fee_mode, 'store_fleet', 'the sale carries the tenant store_fleet mode');
      assert.equal(await journalLeg(db, Number(result.saleId), 4200, 'credit'), 20, 'the store-fleet fee posts Cr 4200 (store revenue)');
      assert.equal(await journalLeg(db, Number(result.saleId), 2115, 'credit'), 0, 'no delivery fee reaches Cr 2115 rep payable');
      const totals = await journalTotals(db, Number(result.saleId));
      assert.equal(totals.debit, totals.credit, 'the sale journal balances');
    } finally {
      await db.destroy();
    }
    console.log('  store_fleet tenant mode posts Cr 4200 passed');
  }

  // (c) Rep selection skips the lower-id van rep for a delivery rep.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, {
        reps: [
          { id: 1, name: 'Van Rep', rep_type: 'van', is_van_rep: true },
          { id: 2, name: 'Delivery Rep', rep_type: 'delivery' },
        ],
      });
      await seedOrder(db);
      const service = buildServices(db);
      const result: any = await service.convertToSale(77, adminAuth);
      assert.equal(result.ok, true, 'conversion with van + delivery reps must succeed');
      const sale = await readSale(db, Number(result.saleId));
      assert.equal(Number(sale.delivery_rep_id), 2, 'a storefront delivery picks the delivery-type rep, not the lower-id van rep');
      assert.equal(sale.delivery_fee_mode, 'freelance_courier', 'with no tenant mode set, createSale falls back to freelance_courier for a delivery-type rep');
      assert.equal(await journalLeg(db, Number(result.saleId), 2115, 'credit'), 20, 'the fee posts Cr 2115 for the delivery rep');
    } finally {
      await db.destroy();
    }
    console.log('  delivery-type rep picked over van rep passed');
  }

  // (d) Auto-created store rep is marked, has no phone and no PIN.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, {});
      await seedOrder(db);
      const service = buildServices(db);
      const result: any = await service.convertToSale(77, adminAuth);
      assert.equal(result.ok, true, 'conversion with no reps must succeed');
      const reps = await readReps(db);
      assert.equal(reps.length, 1, 'exactly one rep is auto-created');
      const auto = reps[0];
      assert.equal(auto.name, 'توصيل المتجر', 'the auto rep keeps the store name');
      assert.equal(auto.rep_type, 'store_fleet', 'the auto rep is a store_fleet rep');
      assert.equal(auto.phone, null, 'the auto rep has no phone');
      assert.equal(auto.pin_hash, null, 'the auto rep has no PIN hash');
      assert.equal(auto.pin_salt, null, 'the auto rep has no PIN salt');
      const meta = typeof auto.metadata === 'string' ? JSON.parse(auto.metadata) : auto.metadata;
      assert.equal(meta?.auto_created_store_rep, true, 'the auto rep carries the auto_created_store_rep marking');
      const sale = await readSale(db, Number(result.saleId));
      assert.equal(Number(sale.delivery_rep_id), Number(auto.id), 'the sale links the auto-created rep');
      assert.equal(sale.delivery_fee_mode, 'store_fleet', 'with no tenant mode set, createSale infers store_fleet from the auto store rep');
      assert.equal(await journalLeg(db, Number(result.saleId), 4200, 'credit'), 20, 'the auto store rep fee posts Cr 4200');
    } finally {
      await db.destroy();
    }
    console.log('  auto-created store rep marked and PIN-less passed');
  }

  console.log('Storefront convert delivery fee mode tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
