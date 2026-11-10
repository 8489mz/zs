/*
New file: backend/test/critical/customer-supplier-statements.spec.ts
Pins the customer/supplier statement gaps (INV-CUSTOMER-SUPPLIER-STATEMENTS).

THE GAP (proven live on test10k, build 1.1.40):
(a) A fully-paid sale wrote NO customer-ledger row: createSale only
posted `remainingDebt`, so a 150.00 Visa sale (debt 0) left the
statement empty. Its card refund likewise wrote nothing -- the
return loop only posts a ledger leg for the 'receivable' tender,
and allocateRefundTenders returns 'card' for a fully-paid Visa
sale. The invoice and its return were both invisible in the
statement (0 entries, debit 0, credit 0) although the final
balance was arithmetically right.
(b) The supplier schedule showed a phantom 1,000.00 payment for an
unpaid 1,000.00 credit purchase: the statement payload derived
debit/credit from the signed amount with the CUSTOMER convention
(positive amount = debit) for both parties, while a positive
supplier amount is a purchase owed (credit). The schedule card
takes credit from the amount but debit from the derived field,
so both columns showed 1,000.00.

THE RULE:
- A fully-settled sale posts a +charge / -settlement pair netting
  to zero (entry types 'sale_paid' / 'customer_payment'), so the
  invoice stays visible while the customer balance stays exactly
  unchanged. The charge leg must NOT use createCustomerLedgerEntry:
  its limit gate would block a settled sale for a customer near
  the credit limit, and 'sale_credit' would corrupt the van
  split-sale / trip-counter readers that take the latest
  'sale_credit' row as the unpaid portion.
- A return that posts no 'receivable' leg (the original sale was
  fully settled) posts a -reversal / +refund pair netting to zero
  ('sale_return' / 'sale_return_refund'), so the return document
  stays visible while the balance stays exactly unchanged.
- A sale with remaining debt is unchanged: one +remainingDebt
  'sale_credit' row only, no pair.
- The statement payload carries direction-correct debit/credit:
  customer positive = debit, supplier positive = credit; the
  supplier summary totals are swapped the same way (closing
  balance still comes from the raw amounts).

WHAT THIS PINS, driving the REAL createSale / createReturn /
ReportsSummaryService on PGlite (fresh database per case):
- fully-paid Visa sale 150: ledger rows +150 'sale_paid'
  (balance_after 150) then -150 'customer_payment' (balance_after
  0); customer balance stays 0. Its full card return adds -150
  'sale_return' (balance_after -150) then +150
  'sale_return_refund' (balance_after 0); balance stays 0. The
  statement endpoint returns all 4 entries in order with the
  running balances above and totalEntries 4.
- unpaid credit sale 150: exactly one row, +150 'sale_credit',
  balance 150 (no pair -- regression guard).
- partially-paid cash sale 150 (cash 50, open shift): exactly one
  row, +100 'sale_credit', balance 100 (no pair -- regression
  guard).
- supplier with an unpaid 1,000.00 credit purchase and a 400.00
  payment: the statement entries carry debit 0 / credit 1,000
  (balance_after 1,000) and debit 400 / credit 0 (balance_after
  600); summary totalDebits 400, totalCredits 1,000,
  closingBalance 600. The unpaid purchase shows paid 0.00, not a
  phantom 1,000.00 payment.
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
import { ReturnsService } from '../../src/modules/returns/returns.service';
import { ReportsSummaryService } from '../../src/modules/reports/services/reports-summary.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const ADMIN = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['sales', 'canEditPrice'], tenantId: TENANT, accountId: ACCOUNT,
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
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text, phone text, balance numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE supplier_ledger (id bigserial PRIMARY KEY, tenant_id text, account_id text, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE supplier_payment_schedules (id bigint PRIMARY KEY, tenant_id text, purchase_id bigint, paid_amount numeric DEFAULT 0);
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code varchar(32));
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, note text, branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-02', exchange_return_id bigint, exchange_tip_relief numeric(15, 3), exchange_courier_relief numeric(15, 3),
      tip_relief numeric(15, 3), courier_relief numeric(15, 3));
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT true, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, return_document_id bigint, product_id bigint, product_name text, qty numeric, unit_total numeric, line_total numeric, allocated_tax numeric, cost_price numeric, sale_item_id bigint, purchase_item_id bigint);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE damaged_stock_records (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reason text, note text, created_by bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE purchases (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, supplier_id bigint, payment_type text, subtotal numeric, discount numeric DEFAULT 0, tax_amount numeric, total numeric, paid_amount numeric DEFAULT 0, branch_id bigint, location_id bigint, created_by bigint DEFAULT 1, created_at timestamptz DEFAULT '2026-10-01', grn_id bigint, po_id bigint, lifecycle_status text, three_way_match_status text, status text DEFAULT 'posted', prices_include_tax boolean DEFAULT false, tax_rate numeric DEFAULT 0);
    CREATE TABLE purchase_items (id bigint PRIMARY KEY, tenant_id text, account_id text, purchase_id bigint, product_id bigint, qty numeric, unit_cost numeric, unit_multiplier numeric DEFAULT 1, line_total numeric, location_id bigint, batch_number text, grn_line_id bigint, grni_amount numeric);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
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
  for (const [id, code] of [
    [1110, '1110'], [1120, '1120'], [1130, '1130'], [1140, '1140'], [1150, '1150'],
    [2110, '2110'], [2120, '2120'], [4100, '4100'], [4300, '4300'], [5100, '5100'],
    [5190, '5190'], [5200, '5200'], [5300, '5300'], [7100, '7100'],
  ] as Array<[number, string]>) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true, is_tax: code === '1150' || code === '2120' }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, supplier_payable_account_id: 2110, inventory_account_id: 1140,
    sales_revenue_account_id: 4100, sales_discount_account_id: 4300,
    cogs_account_id: 5100, sales_tax_account_id: 2120,
  }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'Widget 101',
    stock_qty: 100, cost_price: 10, retail_price: 150,
    wholesale_price: 150, min_selling_price: 1,
    is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: 100,
  }).execute();
  await anyDb.insertInto('customers').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'عميل اختبار', phone: '010',
    balance: 0, credit_limit: 0, is_credit_blocked: false, store_credit_balance: 0,
    loyalty_points: 0, is_active: true,
  }).execute();
  await anyDb.insertInto('suppliers').values({
    id: 1, tenant_id: TENANT, name: 'مورد اختبار', phone: '020', balance: 0, is_active: true,
  }).execute();
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: openedBy, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: '2026-01-01T00:00:00.000Z',
  }).execute();
}

function buildSalesService(db: Kysely<Database>): SalesWriteService {
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

function buildReturnsService(db: Kysely<Database>): ReturnsService {
  const foundation = {
    ensureForAuth: async () => undefined,
    ensureForScope: async () => undefined,
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const auditStub = { log: async () => undefined, logWithExecutor: async () => undefined };
  const idempotencyStub = { check: async () => null, commitOperation: async () => undefined };
  return new ReturnsService(db as any, new TransactionHelper(), auditStub as any, posting as any, idempotencyStub as any);
}

function buildReportsService(db: Kysely<Database>): ReportsSummaryService {
  return new ReportsSummaryService(db);
}

function salePayload(total: number, extra: Record<string, unknown>): any {
  return {
    items: [{ productId: 101, qty: 1, price: total, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0,
    branchId: 1, locationId: 10, source: 'dashboard',
    ...extra,
  };
}

async function createSaleId(service: SalesWriteService, payload: any): Promise<number> {
  const created: any = await service.createSale(payload, ADMIN);
  const id = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
  assert.ok(Number.isInteger(id) && id > 0, `createSale must return a sale id, got ${JSON.stringify(created)?.slice(0, 120)}`);
  return id;
}

type LedgerRow = { amount: number; balance_after: number; entry_type: string; reference_type: string; reference_id: number };

async function customerLedgerRows(db: Kysely<Database>, customerId: number): Promise<LedgerRow[]> {
  const rows = await sql<LedgerRow>`SELECT amount, balance_after, entry_type, reference_type, reference_id FROM customer_ledger WHERE customer_id = ${customerId} AND tenant_id = ${TENANT} ORDER BY id ASC`.execute(db);
  return rows.rows.map((row) => ({
    amount: Number(row.amount),
    balance_after: Number(row.balance_after),
    entry_type: String(row.entry_type),
    reference_type: String(row.reference_type || ''),
    reference_id: Number(row.reference_id || 0),
  }));
}

async function customerBalance(db: Kysely<Database>, customerId: number): Promise<number> {
  const row = await sql<{ balance: string }>`SELECT balance FROM customers WHERE id = ${customerId}`.execute(db);
  return Number(row.rows[0]?.balance || 0);
}

async function main(): Promise<void> {
  // Case 1: fully-paid Visa sale + full card return -- both documents
  // stay visible in the statement, balance stays exactly 0.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const sales = buildSalesService(db);
      const returns = buildReturnsService(db);
      const reports = buildReportsService(db);

      const saleId = await createSaleId(sales, salePayload(150, {
        customerId: 1, paymentType: 'cash', paymentChannel: 'card',
        payments: [{ paymentChannel: 'card', amount: 150 }],
        tenderedAmount: 0,
      }));
      assert.deepEqual(await customerLedgerRows(db, 1), [
        { amount: 150, balance_after: 150, entry_type: 'sale_paid', reference_type: 'sale', reference_id: saleId },
        { amount: -150, balance_after: 0, entry_type: 'customer_payment', reference_type: 'sale', reference_id: saleId },
      ]);
      assert.equal(await customerBalance(db, 1), 0);

      const itemRow = await sql<{ id: number }>`SELECT id FROM sale_items WHERE sale_id = ${saleId}`.execute(db);
      const result = await returns.createReturn({
        type: 'sale', invoiceId: saleId, note: 'customer changed mind',
        items: [{ productId: 101, productName: 'Widget 101', qty: 1, saleItemId: Number(itemRow.rows[0].id) }],
        settlementMode: 'refund', refundMethod: 'card',
      } as never, ADMIN) as unknown as { ok: boolean; id: number };
      assert.equal(result.ok, true);
      assert.deepEqual(await customerLedgerRows(db, 1), [
        { amount: 150, balance_after: 150, entry_type: 'sale_paid', reference_type: 'sale', reference_id: saleId },
        { amount: -150, balance_after: 0, entry_type: 'customer_payment', reference_type: 'sale', reference_id: saleId },
        { amount: -150, balance_after: -150, entry_type: 'sale_return', reference_type: 'return_document', reference_id: Number(result.id) },
        { amount: 150, balance_after: 0, entry_type: 'sale_return_refund', reference_type: 'return_document', reference_id: Number(result.id) },
      ]);
      assert.equal(await customerBalance(db, 1), 0);

      const statement: any = await reports.customerLedger(1, {} as never, ADMIN);
      const entries = statement.entries as any[];
      assert.equal(entries.length, 4, 'the statement shows the paid invoice and its return');
      assert.deepEqual(entries.map((entry) => entry.amount), [150, -150, -150, 150]);
      assert.deepEqual(entries.map((entry) => entry.balanceAfter), [150, 0, -150, 0]);
      assert.deepEqual(entries.map((entry) => entry.type), ['sale_paid', 'customer_payment', 'sale_return', 'sale_return_refund']);
      assert.equal((statement.summary as any).totalEntries, 4);
      assert.equal(Number((statement.summary as any).closingBalance), 0);
    } finally {
      await db.destroy();
    }
    console.log('  fully-paid Visa sale and its card return stay visible passed');
  }

  // Case 2: unpaid credit sale -- exactly one +remainingDebt row, no pair.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const sales = buildSalesService(db);
      const saleId = await createSaleId(sales, salePayload(150, {
        customerId: 1, paymentType: 'credit', paymentChannel: 'card',
        payments: [],
        tenderedAmount: 0,
      }));
      assert.deepEqual(await customerLedgerRows(db, 1), [
        { amount: 150, balance_after: 150, entry_type: 'sale_credit', reference_type: 'sale', reference_id: saleId },
      ]);
      assert.equal(await customerBalance(db, 1), 150);
    } finally {
      await db.destroy();
    }
    console.log('  unpaid credit sale still posts a single debt row passed');
  }

  // Case 3: partially-paid cash sale -- exactly one +remainingDebt row, no pair.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      const sales = buildSalesService(db);
      const saleId = await createSaleId(sales, salePayload(150, {
        customerId: 1, paymentType: 'cash', paymentChannel: 'cash',
        payments: [{ paymentChannel: 'cash', amount: 50 }],
        tenderedAmount: 50,
      }));
      assert.deepEqual(await customerLedgerRows(db, 1), [
        { amount: 100, balance_after: 100, entry_type: 'sale_credit', reference_type: 'sale', reference_id: saleId },
      ]);
      assert.equal(await customerBalance(db, 1), 100);
    } finally {
      await db.destroy();
    }
    console.log('  partially-paid sale still posts a single debt row passed');
  }

  // Case 4: supplier with an unpaid 1,000.00 credit purchase and a
  // 400.00 payment -- the purchase shows paid 0.00 in its own row
  // (debit 0 / credit 1,000), the payment shows debit 400, and the
  // summary totals are oriented the same way.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const reports = buildReportsService(db);
      const anyDb = db as any;
      // Rows exactly as purchases-write posts them: a credit purchase
      // writes +total 'purchase_credit'; a payment writes -amount.
      await anyDb.insertInto('supplier_ledger').values({
        tenant_id: TENANT, account_id: ACCOUNT, supplier_id: 1,
        entry_type: 'purchase_credit', amount: 1000, balance_after: 1000,
        note: 'فاتورة شراء PUR-1', reference_type: 'purchase', reference_id: 1,
        branch_id: 1, location_id: 10, created_by: 1,
      }).execute();
      await anyDb.insertInto('supplier_ledger').values({
        tenant_id: TENANT, account_id: ACCOUNT, supplier_id: 1,
        entry_type: 'supplier_payment', amount: -400, balance_after: 600,
        note: 'دفع إلى مورد اختبار', reference_type: 'supplier_payment', reference_id: 1,
        branch_id: 1, location_id: 10, created_by: 1,
      }).execute();
      await anyDb.updateTable('suppliers').set({ balance: 600 }).where('id', '=', 1).execute();

      const statement: any = await reports.supplierLedger(1, {} as never, ADMIN);
      const entries = statement.entries as any[];
      assert.equal(entries.length, 2);
      assert.equal(entries[0].amount, 1000);
      assert.equal(entries[0].debit, 0);
      assert.equal(entries[0].credit, 1000);
      assert.equal(entries[0].balanceAfter, 1000);
      assert.equal(entries[1].amount, -400);
      assert.equal(entries[1].debit, 400);
      assert.equal(entries[1].credit, 0);
      assert.equal(entries[1].balanceAfter, 600);
      assert.equal((statement.summary as any).totalDebits, 400);
      assert.equal((statement.summary as any).totalCredits, 1000);
      assert.equal(Number((statement.summary as any).closingBalance), 600);
      assert.equal(Number((statement.supplier as any).balance), 600);
    } finally {
      await db.destroy();
    }
    console.log('  supplier unpaid purchase shows no phantom payment passed');
  }

  console.log('customer-supplier statements checks passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
