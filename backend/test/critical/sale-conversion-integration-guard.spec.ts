/*
New file: backend/test/critical/sale-conversion-integration-guard.spec.ts

WHAT THIS PINS (INV-CONVERSION-INTEGRATION-GUARD): the tax
pre-rounding seam and the order/quotation conversion wiring are
actually reached by the REAL createSale end to end on PGlite —
not only by the seam/unit specs that pin them in isolation. The
phase-1 guard audit (GAP-2) found the integrated path undriven:
the tax spec drove computeInvoiceTotals through the seam stub,
and the conversion specs drove convertToSale against a capturing
stub writer, so a removed seam call or a broken conversion
payload would have passed every guard.

THE CASES, WORKED ONCE:
(a) Tax pre-rounding, integrated: one line, 2 units at 50, header
discount 33.33, tax rate 14. The raw tax is 9.3338; the stored
tax_amount and the posted tax leg must both be 9.33, the stored
total 76.00, and the journal balanced — the seam's
roundSaleInvoiceTotals result, not a re-rounded client figure.
(b) Order conversion, cash (SERVICE items — see FINDING
below): an order of 2x50 minus 5 plus 1x30
minus 5 (stored discount_amount 10, total_amount 120, exempt)
lands line nets 95 and 25 in the posted sale, total 120, cash
journal 120 — the lineDiscount wiring, not the legacy per-item
`discount` field.
(c) Order conversion, credit (SERVICE items): the same order with stored
payment_terms 'credit' lands a full-credit sale (payment_type
credit, paid 0), a customer-ledger entry, and a receivable
journal — the terms wiring, not a forced cash sale.
(d) Quotation conversion (SERVICE items): a quotation with the same line
discounts lands the same nets in the posted sale.

HOW THIS IS DRIVEN: the real SalesWriteService (real
authorization, finance, query, posting, idempotency and audit
services, plan-feature stub with restaurant off) plus the real
SalesOrdersService / QuotationsService with the real
IdempotencyService fallback, on PGlite. Journal legs are read
from the posted journal rows, never re-implemented. PGlite is
single-connection, so true two-connection conversion races stay
deferred to the live-Postgres acceptance (GAP-3); this spec pins
the single-attempt integrated path only.

FINDING FROM THIS DRIVE, FIXED BY THE CONVERSION STOCK
DEDUCTION PACKAGE (INV-CONVERSION-STOCK-DEDUCTION): a GOODS
order/quotation conversion used to fail through the real path
with INSUFFICIENT_STOCK even when the stock existed in a real
location. convertToSale built its sale payload with NO
locationId (sales-orders.service.ts / quotations.service.ts),
and createSale only defaulted locationId from the branch
default for POS source — so for the dashboard-source conversion
payload the deduction loop read zero availability (Kysely
renders `.where('location_id', '=', null)` as `= NULL`, which
matches nothing) and skipped the pool re-read, because an
eligible location IS null. Both convertToSale methods now carry
the branch default stock location into the sale payload, so a
goods conversion deducts from the branch's default location
exactly like a POS sale; a branch with no default location
keeps the prior null-location behaviour. Cases (e) and (f)
below drive the goods leg end to end; cases (b)–(d) keep
SERVICE items for the discount/terms/journal wiring.
(e) Goods order conversion deducts stock: 2x50 + 1x30 at cost
10, location stock 100 each, lands location stock 98/99, a
stock allocation per line at location 10, and the 30 COGS leg.
(f) Goods quotation conversion deducts stock the same way.
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
import { SalesOrdersService } from '../../src/modules/sales/services/sales-orders.service';
import { QuotationsService } from '../../src/modules/sales/services/quotations.service';
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
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigint PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, opened_by bigint, status text, branch_id bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL, operation_type text NOT NULL, status text NOT NULL, request_hash text NOT NULL, document_id text, response_payload text, error_code text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), completed_at timestamptz);
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, notes text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, sale_id bigint, payment_terms text, updated_at timestamptz NOT NULL DEFAULT NOW(), created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, sales_order_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, reserved_quantity numeric NOT NULL DEFAULT 0, delivered_quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE quotations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, valid_until timestamptz, status text NOT NULL, sale_id bigint, notes text, terms_conditions text, created_by bigint, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE quotation_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
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
  // The admin holds an open shift: createSale's cash-sale gate
  // (INV-ADMIN-CASH-SALE-SHIFT-REQUIRED) requires it for the
  // dashboard-source cash payloads the conversions build.
  await anyDb.insertInto('cashier_shifts').values({
    tenant_id: TENANT, account_id: ACCOUNT, opened_by: 1, status: 'open', branch_id: 1,
  }).execute();
}

async function seedProducts(db: Kysely<Database>, itemType = 'product'): Promise<void> {
  const anyDb = db as any;
  for (const [id, retail] of [[101, 50], [102, 30]] as const) {
    await anyDb.insertInto('products').values({
      id, tenant_id: TENANT, account_id: ACCOUNT, name: `Product ${id}`,
      stock_qty: 100, cost_price: itemType === 'service' ? 0 : 10, retail_price: retail,
      wholesale_price: retail, min_selling_price: 0,
      is_active: true, item_type: itemType,
    }).execute();
    if (itemType !== 'service') {
      await anyDb.insertInto('product_location_stock').values({
        tenant_id: TENANT, account_id: ACCOUNT, product_id: id, branch_id: 1, location_id: 10, qty: 100,
      }).execute();
    }
  }
}

function buildServices(db: Kysely<Database>): { salesWrite: SalesWriteService; orders: SalesOrdersService; quotations: QuotationsService } {
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
  const orders = new SalesOrdersService(db, salesWrite);
  const quotations = new QuotationsService(db, salesWrite);
  return { salesWrite, orders, quotations };
}

async function seedOrderItems(db: Kysely<Database>, orderId: number): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('sales_order_items').values({
    tenant_id: TENANT, account_id: ACCOUNT, sales_order_id: orderId,
    product_id: 101, product_name: 'Product 101', quantity: 2, unit_price: 50, discount: 5, total: 95,
  }).execute();
  await anyDb.insertInto('sales_order_items').values({
    tenant_id: TENANT, account_id: ACCOUNT, sales_order_id: orderId,
    product_id: 102, product_name: 'Product 102', quantity: 1, unit_price: 30, discount: 5, total: 25,
  }).execute();
}

async function seedQuotationItems(db: Kysely<Database>, quotationId: number): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('quotation_items').values({
    tenant_id: TENANT, account_id: ACCOUNT, quotation_id: quotationId,
    product_id: 101, product_name: 'Product 101', quantity: 2, unit_price: 50, discount: 5, total: 95,
  }).execute();
  await anyDb.insertInto('quotation_items').values({
    tenant_id: TENANT, account_id: ACCOUNT, quotation_id: quotationId,
    product_id: 102, product_name: 'Product 102', quantity: 1, unit_price: 30, discount: 5, total: 25,
  }).execute();
}

async function readSale(db: Kysely<Database>, saleId: number): Promise<any> {
  return (db as any).selectFrom('sales').selectAll()
    .where('id', '=', saleId).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
}

async function readSaleItems(db: Kysely<Database>, saleId: number): Promise<Array<any>> {
  return (db as any).selectFrom('sale_items').selectAll()
    .where('sale_id', '=', saleId).where('tenant_id', '=', TENANT)
    .orderBy('id', 'asc').execute();
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
  // (a) Tax pre-rounding through the real createSale: raw tax
  // 9.3338 must land as 9.33 in the stored row AND the journal.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProducts(db);
      const { salesWrite } = buildServices(db);
      const created: any = await salesWrite.createSale({
        items: [{ productId: 101, qty: 2, price: 50, priceType: 'retail', unitMultiplier: 1 }],
        discount: 33.33, taxRate: 14, paymentType: 'cash', paymentChannel: 'cash',
        payments: [{ paymentChannel: 'cash', amount: 76 }],
        tenderedAmount: 76, branchId: 1, locationId: 10, source: 'dashboard',
      }, adminAuth);
      const saleId = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
      assert.ok(Number.isInteger(saleId) && saleId > 0, 'createSale must return a sale id');
      const sale = await readSale(db, saleId);
      assert.equal(Number(sale.tax_amount), 9.33, 'stored tax is the pre-rounded book figure');
      assert.equal(Number(sale.total), 76, 'stored total is the pre-rounded book figure');
      assert.equal(await journalLeg(db, saleId, 2120, 'credit'), 9.33, 'posted tax leg equals the stored tax');
      assert.equal(await journalLeg(db, saleId, 4100, 'credit'), 100, 'posted revenue leg equals the gross subtotal');
      assert.equal(await journalLeg(db, saleId, 4300, 'debit'), 33.33, 'posted discount leg equals the header discount');
      assert.equal(await journalLeg(db, saleId, 1110, 'debit'), 76, 'posted cash leg equals the collected total');
      assert.equal(await journalLeg(db, saleId, 5100, 'debit'), 20, 'posted COGS leg covers both units at cost');
      const totals = await journalTotals(db, saleId);
      assert.equal(totals.debit, totals.credit, 'the sale journal balances');
    } finally {
      await db.destroy();
    }
    console.log('  integrated tax pre-rounding passed');
  }

  // (b) Cash order conversion lands the line discounts in the
  // posted sale: nets 95 + 25, total 120, cash journal 120.
  // SERVICE items: goods conversions cannot deduct stock through
  // the real path today (see the FINDING in the header) — the
  // wiring guarded here is discounts/terms/journal, not the
  // goods stock leg.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProducts(db, 'service');
      const { orders } = buildServices(db);
      await (db as any).insertInto('sales_orders').values({
        id: 1, tenant_id: TENANT, account_id: ACCOUNT, order_number: 'SO-1',
        customer_name: 'Cust', branch_id: 1, discount_amount: 10, total_amount: 120,
        status: 'confirmed',
      }).execute();
      await seedOrderItems(db, 1);
      const result: any = await orders.convertToSale(1, adminAuth);
      const saleId = Number(result?.saleId);
      assert.ok(Number.isInteger(saleId) && saleId > 0, 'conversion must return a sale id');
      const sale = await readSale(db, saleId);
      assert.equal(Number(sale.total), 120, 'converted total carries the line discounts');
      assert.equal(Number(sale.tax_amount), 0, 'an omitted payload rate is exempt');
      const items = await readSaleItems(db, saleId);
      assert.equal(items.length, 2, 'both order lines land');
      assert.equal(Number(items[0].net_line_total), 95, 'first line net carries its 5 discount');
      assert.equal(Number(items[1].net_line_total), 25, 'second line net carries its 5 discount');
      assert.equal(await journalLeg(db, saleId, 1110, 'debit'), 120, 'cash leg equals the converted total');
      assert.equal(await journalLeg(db, saleId, 4100, 'credit'), 120, 'revenue leg equals the converted total');
      const order = await (db as any).selectFrom('sales_orders').select(['status', 'sale_id'])
        .where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(order.status, 'converted', 'the order is marked converted');
      assert.equal(Number(order.sale_id), saleId, 'the order links the posted sale');
    } finally {
      await db.destroy();
    }
    console.log('  cash order conversion discounts passed');
  }

  // (c) Credit order conversion lands the payment terms: a
  // full-credit sale, a customer-ledger entry, a receivable
  // journal — never a forced cash sale.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProducts(db, 'service');
      await (db as any).insertInto('customers').values({
        id: 201, tenant_id: TENANT, account_id: ACCOUNT, name: 'Credit Cust',
        balance: 0, credit_limit: 1000, is_credit_blocked: false,
      }).execute();
      const { orders } = buildServices(db);
      await (db as any).insertInto('sales_orders').values({
        id: 2, tenant_id: TENANT, account_id: ACCOUNT, order_number: 'SO-2',
        customer_id: 201, customer_name: 'Credit Cust', branch_id: 1,
        discount_amount: 10, total_amount: 120, status: 'confirmed', payment_terms: 'credit',
      }).execute();
      await seedOrderItems(db, 2);
      const result: any = await orders.convertToSale(2, adminAuth);
      const saleId = Number(result?.saleId);
      assert.ok(Number.isInteger(saleId) && saleId > 0, 'conversion must return a sale id');
      const sale = await readSale(db, saleId);
      assert.equal(sale.payment_type, 'credit', 'the sale carries the stored credit terms');
      assert.equal(Number(sale.paid_amount), 0, 'a credit sale collects nothing at conversion');
      assert.equal(Number(sale.total), 120, 'the credit total carries the line discounts');
      const ledger = await (db as any).selectFrom('customer_ledger').selectAll()
        .where('customer_id', '=', 201).execute();
      assert.equal(ledger.length, 1, 'exactly one customer-ledger entry');
      assert.equal(Number(ledger[0].amount), 120, 'the ledger entry is the converted total');
      assert.equal(Number(ledger[0].balance_after), 120, 'the ledger balance carries the converted total');
      const customer = await (db as any).selectFrom('customers').select('balance')
        .where('id', '=', 201).executeTakeFirstOrThrow();
      assert.equal(Number(customer.balance), 120, 'the customer balance carries the converted total');
      assert.equal(await journalLeg(db, saleId, 1130, 'debit'), 120, 'receivable leg equals the converted total');
      assert.equal(await journalLeg(db, saleId, 4100, 'credit'), 120, 'revenue leg equals the converted total');
      assert.equal(await journalLeg(db, saleId, 1110, 'debit'), 0, 'no cash leg on a credit sale');
    } finally {
      await db.destroy();
    }
    console.log('  credit order conversion terms passed');
  }

  // (d) Quotation conversion lands the same line discounts.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProducts(db, 'service');
      const { quotations } = buildServices(db);
      await (db as any).insertInto('quotations').values({
        id: 1, tenant_id: TENANT, account_id: ACCOUNT, quotation_number: 'Q-1',
        customer_name: 'Cust', branch_id: 1, discount_amount: 10, total_amount: 120,
        status: 'draft',
      }).execute();
      await seedQuotationItems(db, 1);
      const result: any = await quotations.convertToSale(1, adminAuth);
      const saleId = Number(result?.saleId);
      assert.ok(Number.isInteger(saleId) && saleId > 0, 'conversion must return a sale id');
      const sale = await readSale(db, saleId);
      assert.equal(Number(sale.total), 120, 'converted total carries the line discounts');
      const items = await readSaleItems(db, saleId);
      assert.equal(Number(items[0].net_line_total), 95, 'first line net carries its 5 discount');
      assert.equal(Number(items[1].net_line_total), 25, 'second line net carries its 5 discount');
      assert.equal(await journalLeg(db, saleId, 1110, 'debit'), 120, 'cash leg equals the converted total');
      const quotation = await (db as any).selectFrom('quotations').select(['status', 'sale_id'])
        .where('id', '=', 1).executeTakeFirstOrThrow();
      assert.equal(quotation.status, 'converted', 'the quotation is marked converted');
      assert.equal(Number(quotation.sale_id), saleId, 'the quotation links the posted sale');
    } finally {
      await db.destroy();
    }
    console.log('  quotation conversion discounts passed');
  }

  // (e) Goods order conversion deducts stock from the branch
  // default location: location stock 100 -> 98/99, one allocation
  // per line at location 10, and the 30 COGS leg. Before the fix
  // this case failed INSUFFICIENT_STOCK: the payload carried no
  // locationId, so the deduction loop saw zero availability.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProducts(db);
      const { orders } = buildServices(db);
      await (db as any).insertInto('sales_orders').values({
        id: 3, tenant_id: TENANT, account_id: ACCOUNT, order_number: 'SO-3',
        customer_name: 'Cust', branch_id: 1, discount_amount: 10, total_amount: 120,
        status: 'confirmed',
      }).execute();
      await seedOrderItems(db, 3);
      const result: any = await orders.convertToSale(3, adminAuth);
      const saleId = Number(result?.saleId);
      assert.ok(Number.isInteger(saleId) && saleId > 0, 'conversion must return a sale id');
      const sale = await readSale(db, saleId);
      assert.equal(Number(sale.total), 120, 'converted total carries the line discounts');
      assert.equal(Number(sale.location_id), 10, 'the posted sale carries the branch default location');
      const locStock = await (db as any).selectFrom('product_location_stock')
        .select(['product_id', 'qty']).where('tenant_id', '=', TENANT)
        .where('location_id', '=', 10)
        .orderBy('product_id', 'asc').execute();
      assert.equal(Number(locStock[0].qty), 98, 'location stock deducts the 2 sold units');
      assert.equal(Number(locStock[1].qty), 99, 'location stock deducts the 1 sold unit');
      const allocations = await (db as any).selectFrom('sale_line_stock_allocations')
        .select(['product_id', 'location_id', 'quantity'])
        .where('sale_id', '=', saleId).orderBy('product_id', 'asc').execute();
      assert.equal(allocations.length, 2, 'one stock allocation per converted line');
      assert.equal(Number(allocations[0].location_id), 10, 'first allocation targets the default location');
      assert.equal(Number(allocations[0].quantity), 2, 'first allocation deducts 2 units');
      assert.equal(Number(allocations[1].location_id), 10, 'second allocation targets the default location');
      assert.equal(Number(allocations[1].quantity), 1, 'second allocation deducts 1 unit');
      const movements = await (db as any).selectFrom('stock_movements')
        .select(['product_id', 'qty', 'location_id'])
        .where('reference_type', '=', 'sale').where('reference_id', '=', saleId)
        .orderBy('product_id', 'asc').execute();
      assert.equal(movements.length, 2, 'one stock movement per converted line');
      assert.equal(Number(movements[0].qty), -2, 'first movement removes 2 units');
      assert.equal(Number(movements[0].location_id), 10, 'first movement is booked at the default location');
      assert.equal(await journalLeg(db, saleId, 5100, 'debit'), 30, 'COGS leg covers 3 units at cost 10');
      assert.equal(await journalLeg(db, saleId, 1140, 'credit'), 30, 'inventory leg releases 3 units at cost 10');
    } finally {
      await db.destroy();
    }
    console.log('  goods order conversion deducts stock passed');
  }

  // (f) Goods quotation conversion deducts stock the same way.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedProducts(db);
      const { quotations } = buildServices(db);
      await (db as any).insertInto('quotations').values({
        id: 2, tenant_id: TENANT, account_id: ACCOUNT, quotation_number: 'Q-2',
        customer_name: 'Cust', branch_id: 1, discount_amount: 10, total_amount: 120,
        status: 'draft',
      }).execute();
      await seedQuotationItems(db, 2);
      const result: any = await quotations.convertToSale(2, adminAuth);
      const saleId = Number(result?.saleId);
      assert.ok(Number.isInteger(saleId) && saleId > 0, 'conversion must return a sale id');
      const locStock = await (db as any).selectFrom('product_location_stock')
        .select(['product_id', 'qty']).where('tenant_id', '=', TENANT)
        .where('location_id', '=', 10)
        .orderBy('product_id', 'asc').execute();
      assert.equal(Number(locStock[0].qty), 98, 'location stock deducts the 2 sold units');
      assert.equal(Number(locStock[1].qty), 99, 'location stock deducts the 1 sold unit');
      const allocations = await (db as any).selectFrom('sale_line_stock_allocations')
        .select(['location_id']).where('sale_id', '=', saleId).execute();
      assert.equal(allocations.length, 2, 'one stock allocation per converted line');
      assert.ok(allocations.every((a: any) => Number(a.location_id) === 10), 'allocations target the default location');
      assert.equal(await journalLeg(db, saleId, 5100, 'debit'), 30, 'COGS leg covers 3 units at cost 10');
    } finally {
      await db.destroy();
    }
    console.log('  goods quotation conversion deducts stock passed');
  }

  // 5. Source + invariant pins (presence, never last-line: order
  // ownership lives in architecture-guard.spec.ts alone).
  {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const writeSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/sales-write.service.ts'), 'utf8');
    assert.ok(writeSource.includes('roundSaleInvoiceTotals'), 'createSale rounds totals through the shared seam');
    const ordersSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/sales-orders.service.ts'), 'utf8');
    assert.ok(ordersSource.includes('resolveConversionDiscounts'), 'order conversion reconciles line discounts');
    assert.ok(ordersSource.includes('resolveConversionPaymentTerms'), 'order conversion carries payment terms');
    assert.ok(ordersSource.includes('lineDiscount'), 'order conversion payloads carry lineDiscount');
    const quotationsSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/quotations.service.ts'), 'utf8');
    assert.ok(quotationsSource.includes('resolveConversionDiscounts'), 'quotation conversion reconciles line discounts');
    assert.ok(quotationsSource.includes('lineDiscount'), 'quotation conversion payloads carry lineDiscount');
    assert.ok(ordersSource.includes('INV-CONVERSION-STOCK-DEDUCTION'), 'order conversion carries the branch default location');
    assert.ok(quotationsSource.includes('INV-CONVERSION-STOCK-DEDUCTION'), 'quotation conversion carries the branch default location');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-CONVERSION-INTEGRATION-GUARD').length - 1, 1, 'the invariant entry must exist exactly once');
    assert.equal(invariants.split('INV-CONVERSION-STOCK-DEDUCTION').length - 1, 1, 'the stock-deduction invariant entry must exist exactly once');
    console.log('  source + invariant pins passed');
  }

  console.log('Sale conversion integration guard tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
