/*
New file: backend/test/critical/pos-credit-limit.spec.ts

WHAT THIS PINS (INV-POS-CREDIT-LIMIT): a credit sale over the
customer's limit is rejected with an Arabic message that names the
actual numbers — the limit, the current balance, the amount this
sale would add, and the excess — instead of the generic
'تعذر تنفيذ العملية المطلوبة.'.

THE BUG, WORKED ONCE (test10k, build 1.1.40): customer D, limit
500.00, balance 79.80, credit sale 494.20 (next balance 574.00,
excess 74.00) was rejected with only the generic message, and the
POS checkout dialog showed neither the limit nor the balance before
confirmation. The gate itself worked (79.80 allowed, 189.00 to the
exact limit allowed); only the reason was unknown.

THE ROOT CAUSE: all four CUSTOMER_CREDIT_LIMIT throw sites (the
create path and the edit path of SalesWriteService, and both
rejections in SalesFinanceService.createCustomerLedgerEntry) threw
the bare English 'Customer credit limit exceeded'. The backend
error translator (translateErrorMessageFromCode) has no entry for
that code, no matching _SUFFIX pattern, and no known-English
translation for that string, so it fell through to the generic
message — the server replaced the reason before the frontend ever
saw it. The frontend code map (ARABIC_CODE_MESSAGES) has no
CUSTOMER_CREDIT_LIMIT entry either, and pos.api.ts retried the
sale on the generic message. The fix names the four numbers in
one Arabic message built by the shared formatCreditLimitExceededMessage
helper; an Arabic message passes the translator through untouched
(its looksArabic branch) and the frontend mapper returns it as-is
(it is not a technical message), so the numbers reach the POS
submit message verbatim and the retry guard no longer matches.
No static code-map entry is added anywhere: a static entry would
replace this dynamic message with a number-less one.

HOW THIS IS DRIVEN: the real createSale + real updateSale + real
createCustomerLedgerEntry on PGlite, with the real authorization,
finance, query, posting, idempotency and audit services, plus the
pure helper pinned directly and the translator pinned directly.
The checkout-dialog display (limit/balance/warning before
confirmation) is pinned by the frontend PosCreditLimitNotice spec,
not here. No harness exists that runs a full successful createSale
on a live Postgres here, so live-Postgres acceptance remains
deferred by written decision; the PGlite drive is the real service
path on Postgres semantics.
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
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { formatCreditLimitExceededMessage } from '../../src/modules/sales/services/credit-limit-message';
import { translateErrorMessageFromCode } from '../../src/common/errors/error-translations';

const TENANT = 't1';
const ACCOUNT = 'a1';
const MANAGER_PIN = '1234';
const CUSTOMER_ID = 201;
const CREDIT_LIMIT = 500;
const OPENING_BALANCE = 79.8;
const OVER_LIMIT_AMOUNT = 494.2;
const EXACT_LIMIT_AMOUNT = 420.2;
const EXPECTED_MESSAGE =
  'تجاوز الحد الائتماني للعميل: الحد الائتماني 500.00، والرصيد الحالي 79.80، والمبلغ المطلوب 494.20، والزيادة عن الحد 74.00.';

const adminAuth: AuthContext = {
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
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, created_by bigint, branch_id bigint, location_id bigint);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigint PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, supplier_id bigint, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, name text);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, amount numeric, title text, note text);
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
    id: CUSTOMER_ID, tenant_id: TENANT, account_id: ACCOUNT, name: 'عميل اختبار القسم D',
    balance: OPENING_BALANCE, credit_limit: CREDIT_LIMIT,
    is_active: true, is_credit_blocked: false,
  }).execute();
}

function buildServices(db: Kysely<Database>): { sales: SalesWriteService; finance: SalesFinanceService; drawer: CashDrawerService } {
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
  return { sales, finance, drawer };
}

function creditSalePayload(total: number): any {
  return {
    items: [{ productId: 101, qty: 1, price: total, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'credit', paymentChannel: 'credit',
    payments: [], customerId: CUSTOMER_ID,
    tenderedAmount: 0, branchId: 1, locationId: 10, source: 'dashboard',
  };
}

async function createAndGetId(service: SalesWriteService, payload: any, auth: AuthContext): Promise<number> {
  const created: any = await service.createSale(payload, auth);
  const id = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
  assert.ok(Number.isInteger(id) && id > 0, `createSale must return a sale id, got ${JSON.stringify(created)?.slice(0, 120)}`);
  return id;
}

async function readCustomerBalance(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('customers').select('balance')
    .where('id', '=', CUSTOMER_ID).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow() as any;
  return Number(row.balance);
}

async function readSaleTotal(db: Kysely<Database>, saleId: number): Promise<number> {
  const row = await (db as any).selectFrom('sales').select('total')
    .where('id', '=', saleId).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow() as any;
  return Number(row.total);
}

async function salesCount(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('sales').select(sql`count(*)`.as('n')).executeTakeFirst() as any;
  return Number(row.n);
}

function assertLimitRejection(error: any): void {
  assert.equal(error?.code, 'CUSTOMER_CREDIT_LIMIT', `expected CUSTOMER_CREDIT_LIMIT, got ${error?.code}: ${error?.message}`);
  assert.equal(error?.message, EXPECTED_MESSAGE, `the rejection must name the four numbers, got: ${error?.message}`);
  assert.ok(!String(error?.message || '').includes('تعذر تنفيذ العملية المطلوبة'), 'the generic fallback must never appear');
}

async function main(): Promise<void> {
  // 0. Pure helper pin: the worked example, exactly, and the digits
  // parameter is honoured (a 3dp tenant gets 3dp numbers, never a
  // silent 2dp default).
  {
    assert.equal(
      formatCreditLimitExceededMessage({ creditLimit: 500, currentBalance: 79.8, requestedAmount: 494.2, digits: 2 }),
      EXPECTED_MESSAGE,
    );
    assert.equal(
      formatCreditLimitExceededMessage({ creditLimit: 500, currentBalance: 79.8, requestedAmount: 494.2, digits: 3 }),
      'تجاوز الحد الائتماني للعميل: الحد الائتماني 500.000، والرصيد الحالي 79.800، والمبلغ المطلوب 494.200، والزيادة عن الحد 74.000.',
    );
    // The translator must pass this Arabic message through untouched:
    // this is the exact mechanism that used to replace it with the
    // generic fallback when the message was English.
    assert.equal(
      translateErrorMessageFromCode('CUSTOMER_CREDIT_LIMIT', EXPECTED_MESSAGE, 400),
      EXPECTED_MESSAGE,
    );
    console.log('  pure helper + translator pass-through passed');
  }

  // 1. Over-limit credit sale: rejected with the four numbers, and
  // nothing is written (no sale, balance untouched).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { sales } = buildServices(db);
      await assert.rejects(
        createAndGetId(sales, creditSalePayload(OVER_LIMIT_AMOUNT), adminAuth),
        (err: any) => { assertLimitRejection(err); return true; },
      );
      assert.equal(await salesCount(db), 0, 'no sale is written');
      assert.equal(await readCustomerBalance(db), OPENING_BALANCE, 'balance untouched');
    } finally {
      await db.destroy();
    }
    console.log('  over-limit credit sale names the four numbers passed');
  }

  // 2. Within-limit credit sale (79.80): created, balance grows by
  // the sale amount.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, creditSalePayload(OPENING_BALANCE), adminAuth);
      assert.ok(saleId > 0, 'the sale is created');
      assert.equal(await readCustomerBalance(db), 159.6, 'balance grows by the sale amount');
    } finally {
      await db.destroy();
    }
    console.log('  within-limit credit sale still allowed passed');
  }

  // 3. Exact-limit credit sale (420.20 -> next balance exactly
  // 500.00): created — reaching the limit is allowed.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, creditSalePayload(EXACT_LIMIT_AMOUNT), adminAuth);
      assert.ok(saleId > 0, 'the sale is created');
      assert.equal(await readCustomerBalance(db), 500, 'balance reaches the limit exactly');
    } finally {
      await db.destroy();
    }
    console.log('  exact-limit credit sale still allowed passed');
  }

  // 4. Edit path: a within-limit sale edited over the limit is
  // rejected with the same four numbers (the old debt is reversed
  // before the re-read, so the numbers are the worked example's),
  // and the original sale and balance are unchanged.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { sales } = buildServices(db);
      const saleId = await createAndGetId(sales, creditSalePayload(OPENING_BALANCE), adminAuth);
      assert.equal(await readCustomerBalance(db), 159.6, 'setup balance');
      await assert.rejects(
        sales.updateSale(saleId, {
          ...creditSalePayload(OVER_LIMIT_AMOUNT),
          editReason: 'تصحيح مبلغ الفاتورة الآجلة بعد مراجعة العميل',
          managerPin: MANAGER_PIN,
        }, adminAuth),
        (err: any) => { assertLimitRejection(err); return true; },
      );
      assert.equal(await readSaleTotal(db, saleId), OPENING_BALANCE, 'the original sale total is unchanged');
      assert.equal(await readCustomerBalance(db), 159.6, 'the balance is unchanged');
    } finally {
      await db.destroy();
    }
    console.log('  over-limit edit names the four numbers passed');
  }

  // 5. Finance-service site: a direct ledger entry over the limit
  // is rejected with the same numbered message.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const { finance } = buildServices(db);
      await assert.rejects(
        finance.createCustomerLedgerEntry(db, CUSTOMER_ID, OVER_LIMIT_AMOUNT, 'spec', 999, adminAuth),
        (err: any) => { assertLimitRejection(err); return true; },
      );
      assert.equal(await readCustomerBalance(db), OPENING_BALANCE, 'balance untouched');
    } finally {
      await db.destroy();
    }
    console.log('  finance-service limit rejection names the four numbers passed');
  }

  // 6. Source pins: the bare English throw is gone from every site
  // (this fails the moment the fix is reverted), and both services
  // route through the shared helper.
  {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const here = __dirname;
    const writeSource = readFileSync(resolve(here, '../../src/modules/sales/services/sales-write.service.ts'), 'utf8');
    const financeSource = readFileSync(resolve(here, '../../src/modules/sales/services/sales-finance.service.ts'), 'utf8');
    assert.ok(!writeSource.includes("throw new AppError('Customer credit limit exceeded'"), 'no bare English throw may remain in sales-write');
    assert.ok(!financeSource.includes("throw new AppError('Customer credit limit exceeded'"), 'no bare English throw may remain in sales-finance');
    assert.ok(writeSource.includes('formatCreditLimitExceededMessage'), 'sales-write must use the shared helper');
    assert.ok(financeSource.includes('formatCreditLimitExceededMessage'), 'sales-finance must use the shared helper');
    assert.ok(writeSource.includes("import { formatCreditLimitExceededMessage } from './credit-limit-message'"), 'sales-write must import the helper');
    assert.ok(financeSource.includes("import { formatCreditLimitExceededMessage } from './credit-limit-message'"), 'sales-finance must import the helper');
    console.log('  source pins passed');
  }

  console.log('POS credit limit tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
