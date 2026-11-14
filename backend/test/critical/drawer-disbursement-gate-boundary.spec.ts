/*
 * Drawer-disbursement gate boundary (INV-DRAWER-DISBURSE-CASHIER-PASSWORD).
 *
 * THE USER DECISION: drawer disbursements (cash_out + safe_drop ONLY)
 * accept the CASHIER'S OWN password instead of a manager PIN — the
 * same current-user confirmation as deposits; the cashier is recorded
 * in the audit trail (treasury row created_by). Posted-invoice edit
 * and stock-count approval STAY manager-gated and are NOT touched.
 *
 * WHAT THIS PINS, driving the REAL services on PGlite:
 * - Part A (CashDrawerService.recordCashMovement): a cashier's OWN
 *   password opens cash_out and safe_drop (to the seeded safe
 *   account 1111); the treasury row records created_by = the
 *   cashier; a wrong password is rejected (CURRENT_USER_PASSWORD_
 *   INVALID) with no write; the manager PIN is still accepted as a
 *   fallback (the deposits pattern); a safe_drop to the drawer cash
 *   account itself (1110) is rejected with the clear
 *   DRAWER_COUNTERPART_SAME_AS_CASH before any write.
 * - Part B (SalesWriteService.updateSale): the SAME cashier password
 *   presented as a manager PIN does NOT open a posted-invoice edit
 *   (MANAGER_AUTH_INVALID), and no manager PIN at all is still
 *   MANAGER_AUTH_REQUIRED; the manager PIN still passes the gate
 *   (the failure after it is SALE_NOT_FOUND, i.e. downstream of the
 *   gate, because no such sale exists in the fixture).
 * - Part C (InventoryCountService.postStockCountSession): the SAME
 *   cashier password does NOT approve a count variance
 *   (ADMIN_PASSWORD_INVALID — the cashier is not a manager user);
 *   the shared manager PIN cannot approve either
 *   (STOCK_COUNT_APPROVER_NOT_IDENTIFIED); a different manager's
 *   password still approves and is recorded as approved_by.
 *
 * RED: on pristine, Part A fails — a cashier's own password is
 * rejected for cash_out/safe_drop (MANAGER_PIN_INVALID) and no
 * safe_drop to 1111 can succeed. Parts B and C already pass on
 * pristine: they are the regression guards proving the gate change
 * did not leak into the manager-gated paths.
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
import { InventoryCountService } from '../../src/modules/inventory/services/inventory-count.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const TENANT = 't1';
const ACCOUNT = 'a1';
const MANAGER_PIN = '1234';
const CASHIER_PASSWORD = 'cashier-secret-1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['sales', 'canEditPrice'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const cashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec-cashier', username: 'cashier-a', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err: any) {
    assert.equal(err?.code, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
    return;
  }
  assert.fail(`expected rejection with ${code}`);
}

// ---------------------------------------------------------------- Part A
// Drawer harness: the cash-drawer-movement-types DDL (with the
// terminal_code column split-1 added to cashier_shifts), a shift
// opened BY the cashier, and the cashier's own password seeded.

async function makeDrawerDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
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
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, normal_balance text, is_cash_bank boolean, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
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
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
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
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz, terminal_code text);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, request_key text, created_at timestamptz DEFAULT NOW());
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
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text, cancelled_at timestamptz, cancelled_by bigint, cancel_reason text);
  `);
  return { pg, db };
}

async function seedDrawerFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'cashier-a', role: 'cashier', is_active: true }).execute();
  const accounts: Array<[number, string, string, string, boolean]> = [
    [1110, '1110', 'asset', 'debit', true], [1111, '1111', 'asset', 'debit', true], [1120, '1120', 'asset', 'debit', true],
    [1130, '1130', 'asset', 'debit', false], [1140, '1140', 'asset', 'debit', false],
    [2120, '2120', 'liability', 'credit', false], [4100, '4100', 'income', 'credit', false],
    [4300, '4300', 'income', 'credit', false], [5100, '5100', 'expense', 'debit', false],
    [6950, '6950', 'expense', 'debit', false], [7100, '7100', 'income', 'credit', false],
  ];
  for (const [id, code, accountType, normalBalance, isCashBank] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, account_type: accountType, normal_balance: normalBalance, is_cash_bank: isCashBank, is_active: true, is_tax: false }).execute();
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
  const cashierRecord = await createPasswordRecord(CASHIER_PASSWORD);
  await (db as any).updateTable('users').set({ password_hash: cashierRecord.hash, password_salt: cashierRecord.salt }).where('id', '=', 2).execute();
}

async function seedCashierShift(db: Kysely<Database>, id: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: 2, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: SHIFT_OPENED_AT,
  }).execute();
}

function buildDrawerServices(db: Kysely<Database>): { drawer: CashDrawerService } {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  return { drawer };
}

async function treasuryRows(db: Kysely<Database>, shiftId: number): Promise<any[]> {
  const res = await sql<any>`select id, txn_type, amount, note, created_by from treasury_transactions where reference_type = 'cashier_shift' and reference_id = ${shiftId} order by id asc`.execute(db);
  return res.rows || [];
}

async function journalLines(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<any[]> {
  const res = await sql<any>`select je.id as entry_id, jel.account_id, jel.debit, jel.credit from journal_entries je join journal_entry_lines jel on jel.journal_entry_id = je.id where je.source_type = ${sourceType} and je.source_id = ${sourceId} order by jel.id asc`.execute(db);
  return res.rows || [];
}

async function journalTotals(db: Kysely<Database>): Promise<number> {
  const res = await sql<any>`select count(*) as n from journal_entries`.execute(db);
  return Number(res.rows[0].n);
}

// ---------------------------------------------------------------- Part B
// Posted-invoice edit gate: the manager check in updateSale runs
// BEFORE any sale is read, so the gate itself is drivable on a
// minimal DB (settings + users only). No sale row is needed: the
// gate either throws (MANAGER_AUTH_*) or passes through to the
// downstream SALE_NOT_FOUND.

async function makeEditGateDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    INSERT INTO currency_exchange_rates VALUES ('t1', 'EGP', 1, true);
    CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, exchange_return_id bigint, zatca_status text);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    INSERT INTO settings VALUES ('t1', 'managerPin', '"1234"');
    INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true);
  `);
  const cashierRecord = await createPasswordRecord(CASHIER_PASSWORD);
  await sql`INSERT INTO users VALUES (2, 't1', 'cashier-a', 1, 'cashier', ${cashierRecord.hash}, ${cashierRecord.salt}, true)`.execute(db);
  return { pg, db };
}

function buildEditGateServices(db: Kysely<Database>): { sales: SalesWriteService } {
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
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  const sales = new SalesWriteService(
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
    undefined, undefined, drawer,
  );
  return { sales };
}

function editPayload(managerPin?: string): any {
  return {
    items: [{ productId: 101, qty: 1, price: 100, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: 100 }], tenderedAmount: 100,
    branchId: 1, locationId: 10, source: 'pos',
    editReason: 'تصحيح سعر الصنف',
    ...(managerPin !== undefined ? { managerPin } : {}),
  };
}

// ---------------------------------------------------------------- Part C
// Count-approval gate: the stock-count-dual-approval harness, trimmed
// to one variance session. The cashier presents their OWN password;
// a manager password (a different admin) is the only credential
// that can approve.

const ADMIN1 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin1', permissions: ['canAdjustInventory'] } as unknown as AuthContext;
const COUNT_CASHIER = { tenantId: 't1', accountId: 'a1', role: 'cashier', userId: 2, username: 'cashier', permissions: ['canAdjustInventory'] } as unknown as AuthContext;
const ADMIN2 = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 3, username: 'admin2', permissions: ['canAdjustInventory'] } as unknown as AuthContext;

async function makeCountDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    INSERT INTO tenants VALUES ('t1');
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
    INSERT INTO settings VALUES ('t1','currency','EGP');
    INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', is_active boolean DEFAULT true, is_tax boolean DEFAULT false);
    INSERT INTO accounting_accounts (id, tenant_id, code, account_type) VALUES (1140,'t1','1140','asset'), (5200,'t1','5200','expense'), (5300,'t1','5300','expense'), (7100,'t1','7100','revenue');
    CREATE TABLE accounting_settings (id bigint, tenant_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    INSERT INTO accounting_settings VALUES (1,'t1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,NULL,NULL,NULL,NULL,NULL);
    CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
    INSERT INTO branches VALUES (1, 't1', 'Main', 1);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    INSERT INTO stock_locations VALUES (1, 't1', 1, 'Main Store', 'MAIN', true, 'branch_stock');
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
    INSERT INTO users VALUES (1, 't1', 'admin1', 1, 'admin', '', '', true);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_count_sessions (id bigint PRIMARY KEY, tenant_id text, account_id text, doc_no text, branch_id bigint, location_id bigint, status text, note text, counted_by bigint, approved_by bigint, posted_at timestamptz, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE stock_count_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, session_id bigint, product_id bigint, product_name text, expected_qty numeric, counted_qty numeric, variance_qty numeric, reason text, note text, counted_serials text, batch_counts text, posted_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE stock_transfers (id bigint PRIMARY KEY, tenant_id text, status text);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, branch_id bigint, location_id bigint, cost_price numeric, purchase_id bigint, purchase_item_id bigint, sale_id bigint, sale_item_id bigint, warranty_end_date date, notes text, updated_at timestamptz);
    CREATE TABLE pharmacy_batches (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number text, expiry_date text, quantity numeric, unit_cost numeric, location_id bigint, supplier_name text, status text, notes text, updated_at timestamptz);
    CREATE TABLE pharmacy_drugs (id bigserial PRIMARY KEY, tenant_id text, product_id bigint);
    CREATE TABLE damaged_stock_records (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric, reason text, note text, created_by bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, product_id bigint, status text, remaining_quantity numeric, location_id bigint, receipt_date date, created_at timestamptz DEFAULT NOW());
  `);
  const admin1Record = await createPasswordRecord('admin1-pass');
  await sql`UPDATE users SET password_hash = ${admin1Record.hash}, password_salt = ${admin1Record.salt} WHERE id = 1`.execute(db);
  const admin2Record = await createPasswordRecord('admin2-pass');
  await sql`INSERT INTO users VALUES (3, 't1', 'admin2', 1, 'admin', ${admin2Record.hash}, ${admin2Record.salt}, true)`.execute(db);
  const cashierRecord = await createPasswordRecord(CASHIER_PASSWORD);
  await sql`INSERT INTO users VALUES (2, 't1', 'cashier', 1, 'cashier', ${cashierRecord.hash}, ${cashierRecord.salt}, true)`.execute(db);
  await sql`INSERT INTO settings VALUES ('t1', 'managerPin', '"2468"')`.execute(db);
  return { pg, db };
}

function buildCountService(db: Kysely<Database>): InventoryCountService {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  return new InventoryCountService(
    db as never,
    new TransactionHelper(),
    new AuditService(db as never),
    new InventoryScopeService(db as never),
    { check: async () => null } as unknown as IdempotencyService,
    posting,
  );
}

async function seedCountSession(db: Kysely<Database>, sessionId: number, productId: number, countedBy: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, is_active, track_serials) VALUES (${productId}, 't1', 'a1', ${`Product ${productId}`}, 100, 0, 10, true, false)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${productId}, 1, 1, 100, 0)`.execute(db);
  await sql`UPDATE product_location_stock SET qty = 90 WHERE product_id = ${productId} AND location_id = 1`.execute(db);
  await sql`INSERT INTO stock_count_sessions (id, tenant_id, account_id, doc_no, branch_id, location_id, status, note, counted_by, created_at, updated_at) VALUES (${sessionId}, 't1', 'a1', ${`ZSC-${sessionId}`}, 1, 1, 'draft', '', ${countedBy}, NOW(), NOW())`.execute(db);
  await sql`INSERT INTO stock_count_items (tenant_id, account_id, session_id, product_id, product_name, expected_qty, counted_qty, variance_qty, reason, note, counted_serials, batch_counts) VALUES ('t1', 'a1', ${sessionId}, ${productId}, ${`Product ${productId}`}, 90, 85, -5, 'shortage found', '', null, null)`.execute(db);
}

async function countSessionState(db: Kysely<Database>, id: number): Promise<{ status: string; approvedBy: number | null }> {
  const row = await sql<{ status: string; approved_by: number | null }>`SELECT status, approved_by FROM stock_count_sessions WHERE id = ${id}`.execute(db);
  return { status: row.rows[0].status, approvedBy: row.rows[0].approved_by == null ? null : Number(row.rows[0].approved_by) };
}

async function main(): Promise<void> {
  // Part A1: cash_out with the cashier's OWN password succeeds, and
  // the treasury row records the cashier as the actor.
  {
    const { pg, db } = await makeDrawerDb();
    try {
      await seedDrawerFoundation(db);
      await seedCashierShift(db, 1);
      const { drawer } = buildDrawerServices(db);
      await drawer.recordCashMovement(1, { type: 'cash_out', amount: 10, note: 'صرف نقدي', managerPin: CASHIER_PASSWORD, requestKey: 'gate-cash-out-0001' } as never, cashierAuth);
      const rows = await treasuryRows(db, 1);
      assert.equal(rows.length, 1, 'one treasury row');
      assert.equal(Number(rows[0].amount), -10, 'a cash_out leaves the drawer');
      assert.equal(Number(rows[0].created_by), 2, 'the cashier is recorded as the actor');
      const lines = await journalLines(db, 'cash_drawer_cash_out', Number(rows[0].id));
      assert.deepEqual([Number(lines[0].account_id), Number(lines[0].debit)], [6950, 10], 'cash_out Dr expense');
      assert.deepEqual([Number(lines[1].account_id), Number(lines[1].credit)], [1110, 10], 'cash_out Cr cash');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  cash_out accepts the cashier own password passed');
  }

  // Part A2: safe_drop to the seeded safe account 1111 with the
  // cashier's OWN password succeeds — Dr 1111 / Cr 1110.
  {
    const { pg, db } = await makeDrawerDb();
    try {
      await seedDrawerFoundation(db);
      await seedCashierShift(db, 1);
      const { drawer } = buildDrawerServices(db);
      await drawer.recordCashMovement(1, { type: 'safe_drop', amount: 300, note: 'إيداع الخزينة', managerPin: CASHIER_PASSWORD, requestKey: 'gate-safe-drop-0001', counterpartAccountId: 1111 } as never, cashierAuth);
      const rows = await treasuryRows(db, 1);
      assert.equal(rows.length, 1, 'one treasury row');
      assert.equal(Number(rows[0].amount), -300, 'a safe drop leaves the drawer');
      assert.equal(Number(rows[0].created_by), 2, 'the cashier is recorded as the actor');
      const lines = await journalLines(db, 'cash_drawer_safe_drop', Number(rows[0].id));
      assert.deepEqual([Number(lines[0].account_id), Number(lines[0].debit), Number(lines[0].credit)], [1111, 300, 0], 'Dr safe account 1111');
      assert.deepEqual([Number(lines[1].account_id), Number(lines[1].debit), Number(lines[1].credit)], [1110, 0, 300], 'Cr drawer cash');
      assert.equal(await drawer.computeShiftExpectedCash(1, cashierAuth), -300, 'expected cash reflects the drop');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  safe_drop to 1111 accepts the cashier own password passed');
  }

  // Part A3: safe_drop to the drawer cash account itself (1110) is
  // rejected with the clear code before any write — even with the
  // cashier's own (now valid) password, so the pre-check, not the
  // gate, is what stops it.
  {
    const { pg, db } = await makeDrawerDb();
    try {
      await seedDrawerFoundation(db);
      await seedCashierShift(db, 1);
      const { drawer } = buildDrawerServices(db);
      await expectCode(
        drawer.recordCashMovement(1, { type: 'safe_drop', amount: 300, note: 'إيداع الخزينة', managerPin: CASHIER_PASSWORD, requestKey: 'gate-safe-drop-0002', counterpartAccountId: 1110 } as never, cashierAuth),
        'DRAWER_COUNTERPART_SAME_AS_CASH',
      );
      assert.equal((await treasuryRows(db, 1)).length, 0, 'no treasury row is written');
      assert.equal(await journalTotals(db), 0, 'no journal is written');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  safe_drop to the drawer cash account itself is rejected passed');
  }

  // Part A4: a wrong password still fails closed with no write.
  {
    const { pg, db } = await makeDrawerDb();
    try {
      await seedDrawerFoundation(db);
      await seedCashierShift(db, 1);
      const { drawer } = buildDrawerServices(db);
      await expectCode(
        drawer.recordCashMovement(1, { type: 'cash_out', amount: 10, note: 'صرف نقدي', managerPin: 'wrong-password', requestKey: 'gate-cash-out-0002' } as never, cashierAuth),
        'CURRENT_USER_PASSWORD_INVALID',
      );
      assert.equal((await treasuryRows(db, 1)).length, 0, 'no treasury row is written');
      assert.equal(await journalTotals(db), 0, 'no journal is written');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  wrong password still fails closed passed');
  }

  // Part A5: the manager PIN is still accepted as a fallback for a
  // disbursement (the deposits pattern) — the gate widened, it did
  // not drop the old credential.
  {
    const { pg, db } = await makeDrawerDb();
    try {
      await seedDrawerFoundation(db);
      await seedCashierShift(db, 1);
      const { drawer } = buildDrawerServices(db);
      await drawer.recordCashMovement(1, { type: 'cash_out', amount: 10, note: 'صرف نقدي', managerPin: MANAGER_PIN, requestKey: 'gate-cash-out-0003' } as never, cashierAuth);
      assert.equal((await treasuryRows(db, 1)).length, 1, 'one treasury row');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  manager PIN still accepted as fallback passed');
  }

  // Part A6: cash_in with the cashier's own password still works —
  // the deposits pattern the disbursements now share is unchanged.
  {
    const { pg, db } = await makeDrawerDb();
    try {
      await seedDrawerFoundation(db);
      await seedCashierShift(db, 1);
      const { drawer } = buildDrawerServices(db);
      await drawer.recordCashMovement(1, { type: 'cash_in', amount: 20, note: 'توريد', managerPin: CASHIER_PASSWORD, requestKey: 'gate-cash-in-00001' } as never, cashierAuth);
      const rows = await treasuryRows(db, 1);
      assert.equal(rows.length, 1, 'one treasury row');
      assert.equal(Number(rows[0].amount), 20, 'a cash_in enters the drawer');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  cash_in with the cashier own password unchanged passed');
  }

  // Part B1: the cashier's own password presented as a manager PIN
  // does NOT open a posted-invoice edit.
  {
    const { pg, db } = await makeEditGateDb();
    try {
      const { sales } = buildEditGateServices(db);
      await expectCode(sales.updateSale(999, editPayload(CASHIER_PASSWORD), cashierAuth), 'MANAGER_AUTH_INVALID');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  posted-invoice edit rejects the cashier own password passed');
  }

  // Part B2: no manager PIN at all is still MANAGER_AUTH_REQUIRED
  // for a posted-invoice edit.
  {
    const { pg, db } = await makeEditGateDb();
    try {
      const { sales } = buildEditGateServices(db);
      await expectCode(sales.updateSale(999, editPayload(), cashierAuth), 'MANAGER_AUTH_REQUIRED');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  posted-invoice edit still requires a manager PIN passed');
  }

  // Part B3: the manager PIN still passes the edit gate — the
  // failure after it is SALE_NOT_FOUND, downstream of the gate.
  {
    const { pg, db } = await makeEditGateDb();
    try {
      const { sales } = buildEditGateServices(db);
      await expectCode(sales.updateSale(999, editPayload(MANAGER_PIN), cashierAuth), 'SALE_NOT_FOUND');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  posted-invoice edit still opens with the manager PIN passed');
  }

  // Part C1: the cashier's own password does NOT approve a count
  // variance — the cashier is not a manager user.
  // Part C2: the shared manager PIN cannot approve either.
  // Part C3: a different manager's password still approves and is
  // recorded as approved_by.
  {
    const { pg, db } = await makeCountDb();
    try {
      const service = buildCountService(db);
      await seedCountSession(db, 301, 1, 1);
      await expectCode(service.postStockCountSession(301, COUNT_CASHIER, CASHIER_PASSWORD), 'ADMIN_PASSWORD_INVALID');
      assert.equal((await countSessionState(db, 301)).status, 'draft', 'session stays draft');
      await expectCode(service.postStockCountSession(301, COUNT_CASHIER, '2468'), 'STOCK_COUNT_APPROVER_NOT_IDENTIFIED');
      assert.equal((await countSessionState(db, 301)).status, 'draft', 'session stays draft');
      await service.postStockCountSession(301, COUNT_CASHIER, 'admin2-pass');
      const approved = await countSessionState(db, 301);
      assert.equal(approved.status, 'posted', 'session posts with a manager approval');
      assert.equal(approved.approvedBy, 3, 'approved_by is the approving manager, not the poster');
    } finally {
      await db.destroy(); (globalThis as any).gc?.();
    }
    console.log('  count approval stays manager-gated passed');
  }

  console.log('Drawer disbursement gate boundary tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
