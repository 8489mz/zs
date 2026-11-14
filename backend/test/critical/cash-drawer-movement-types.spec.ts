/*
New file: backend/test/critical/cash-drawer-movement-types.spec.ts

WHAT THIS PINS (INV-CASH-DRAWER-MOVEMENT-TYPES): drawer
movements have four types. Safe drops and replenishments post
asset-to-asset transfer journals — never the 6950 expense or
7100 income legs — and unknown movement types fail closed
instead of coercing to cash_in.

THE DEFECT: only cash_in/cash_out existed and anything else
coerced to cash_in, so a safe drop recorded as cash_out hit the
6950 expense account and a replenishment recorded as cash_in
hit 7100 misc income — both misstating profit. There is no
safe/cash-box account in the chart of accounts, so the transfer
counterpart is caller-named (counterpartAccountId) and validated
exactly like a treasury transfer: an active is_cash_bank asset
with a debit normal balance, different from the drawer cash
account. No treasury_transfers row is written.

WHAT IS DRIVEN: the real recordCashMovement (with the real
journal writer postCashDrawerMovement, the real expected-cash
recomputation, and the real listing) on PGlite, with the
operator's password seeded via createPasswordRecord. The
counterpart used here is the seeded bank account 1120 — the
chart has no safe account to name, which is the point: any
active cash/bank account in the tenant can be the safe.

NOT DRIVEN: the frontend movement form (still offers only
cash_in/cash_out — the new types are API-available first); the
denomination/count breakdown (no count table or shape exists in
the backend, so none is built here); live-Postgres acceptance
(deferred by written decision); two-terminal concurrency
(PGlite is single-connection; the shift-row lock serializes
movements for one shift).
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

const TENANT = 't1';
const ACCOUNT = 'a1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

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
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
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

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'cashier-a', role: 'cashier', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 3, tenant_id: TENANT, username: 'cashier-b', role: 'cashier', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 4, tenant_id: TENANT, username: 'other-login', role: 'cashier', is_active: true }).execute();
  const accounts: Array<[number, string, string, string, boolean]> = [
    [1110, '1110', 'asset', 'debit', true], [1120, '1120', 'asset', 'debit', true],
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
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: openedBy, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: SHIFT_OPENED_AT,
  }).execute();
}

/**
 * A posted cash sale row exactly as the write path leaves it (sale +
 * sale_payments + sale-linked treasury row), created by a login with
 * no shift of their own. Used for the other-login / ambiguous /
 * rep-custody read-rule cases, which must stay valid on every
 * chained tree. withTreasury=false mirrors the van flow, which
 * writes no sale treasury row (field cash sits with the rep).
 */

function buildServices(db: Kysely<Database>): { sales: SalesWriteService; drawer: CashDrawerService; posting: AccountingPostingService } {
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
  return { sales, drawer, posting };
}




async function seedOperatorPassword(db: Kysely<Database>): Promise<void> {
  const { createPasswordRecord } = await import('../../src/core/auth/utils/password-hasher');
  const record = await createPasswordRecord(PASSWORD);
  await (db as any).updateTable('users').set({ password_hash: record.hash, password_salt: record.salt }).where('id', '=', 1).execute();
}

async function treasuryRows(db: Kysely<Database>, shiftId: number): Promise<any[]> {
  const res = await sql<any>`select id, txn_type, amount, note from treasury_transactions where reference_type = 'cashier_shift' and reference_id = ${shiftId} order by id asc`.execute(db);
  return res.rows || [];
}

async function journalLines(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<any[]> {
  const res = await sql<any>`select je.id as entry_id, jel.account_id, jel.debit, jel.credit from journal_entries je join journal_entry_lines jel on jel.journal_entry_id = je.id where je.source_type = ${sourceType} and je.source_id = ${sourceId} order by jel.id asc`.execute(db);
  return res.rows || [];
}

async function journalTotals(db: Kysely<Database>): Promise<{ count: number; byAccount: Record<string, { debit: number; credit: number }> }> {
  const res = await sql<any>`select jel.account_id, coalesce(sum(jel.debit), 0) as debit, coalesce(sum(jel.credit), 0) as credit from journal_entry_lines jel join journal_entries je on je.id = jel.journal_entry_id group by jel.account_id`.execute(db);
  const byAccount: Record<string, { debit: number; credit: number }> = {};
  for (const row of res.rows || []) byAccount[String(row.account_id)] = { debit: Number(row.debit), credit: Number(row.credit) };
  const countRes = await sql<any>`select count(*) as n from journal_entries`.execute(db);
  return { count: Number(countRes.rows[0].n), byAccount };
}

const PASSWORD = 'operator-password-1';

async function main(): Promise<void> {
  // 1. Safe drop: treasury row signed negative, transfer journal
  // Dr 1120 / Cr 1110, no 6950 debit, no 7100 credit, and the
  // shift's expected cash drops by the amount.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOperatorPassword(db);
      await seedShift(db, 1, 1);
      const { drawer } = buildServices(db);
      await drawer.recordCashMovement(1, { type: 'safe_drop', amount: 50, note: 'إيداع آمن', managerPin: PASSWORD, requestKey: 'safe-drop-key-001', counterpartAccountId: 1120 } as never, adminAuth);
      const rows = await treasuryRows(db, 1);
      assert.equal(rows.length, 1, 'one treasury row');
      assert.equal(rows[0].txn_type, 'safe_drop', 'the row carries the new type');
      assert.equal(Number(rows[0].amount), -50, 'a safe drop leaves the drawer');
      const lines = await journalLines(db, 'cash_drawer_safe_drop', Number(rows[0].id));
      assert.equal(lines.length, 2, 'one transfer journal with two legs');
      assert.deepEqual([Number(lines[0].account_id), Number(lines[0].debit), Number(lines[0].credit)], [1120, 50, 0], 'Dr bank counterpart');
      assert.deepEqual([Number(lines[1].account_id), Number(lines[1].debit), Number(lines[1].credit)], [1110, 0, 50], 'Cr drawer cash');
      const totals = await journalTotals(db);
      assert.equal(Number(totals.byAccount['6950']?.debit || 0), 0, 'no expense leg');
      assert.equal(Number(totals.byAccount['7100']?.credit || 0), 0, 'no income leg');
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), -50, 'expected cash reflects the drop');
    } finally {
      await db.destroy();
    }
    console.log('  safe drop posts a transfer journal passed');
  }

  // 2. Safe replenishment: treasury row signed positive,
  // transfer journal Dr 1110 / Cr 1120, expected cash rises.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOperatorPassword(db);
      await seedShift(db, 1, 1);
      const { drawer } = buildServices(db);
      await drawer.recordCashMovement(1, { type: 'safe_replenishment', amount: 30, note: 'تغذية الدرج', managerPin: PASSWORD, requestKey: 'safe-repl-key-001', counterpartAccountId: 1120 } as never, adminAuth);
      const rows = await treasuryRows(db, 1);
      assert.equal(rows.length, 1, 'one treasury row');
      assert.equal(rows[0].txn_type, 'safe_replenishment', 'the row carries the new type');
      assert.equal(Number(rows[0].amount), 30, 'a replenishment enters the drawer');
      const lines = await journalLines(db, 'cash_drawer_safe_replenishment', Number(rows[0].id));
      assert.equal(lines.length, 2, 'one transfer journal with two legs');
      assert.deepEqual([Number(lines[0].account_id), Number(lines[0].debit), Number(lines[0].credit)], [1110, 30, 0], 'Dr drawer cash');
      assert.deepEqual([Number(lines[1].account_id), Number(lines[1].debit), Number(lines[1].credit)], [1120, 0, 30], 'Cr bank counterpart');
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), 30, 'expected cash reflects the replenishment');
    } finally {
      await db.destroy();
    }
    console.log('  safe replenishment posts a transfer journal passed');
  }

  // 3. Missing counterpart: DRAWER_COUNTERPART_REQUIRED before
  // any write — no treasury row, no journal.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOperatorPassword(db);
      await seedShift(db, 1, 1);
      const { drawer } = buildServices(db);
      await assert.rejects(
        drawer.recordCashMovement(1, { type: 'safe_drop', amount: 50, note: 'بلا طرف', managerPin: PASSWORD, requestKey: 'safe-drop-key-002' } as never, adminAuth),
        (err: any) => err && err.code === 'DRAWER_COUNTERPART_REQUIRED',
      );
      assert.equal((await treasuryRows(db, 1)).length, 0, 'no treasury row is written');
      assert.equal((await journalTotals(db)).count, 0, 'no journal is written');
    } finally {
      await db.destroy();
    }
    console.log('  missing counterpart fails closed before any write passed');
  }

  // 4. Invalid counterparts: the cash account itself and a
  // non-cash-bank account both fail closed before any write.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOperatorPassword(db);
      await seedShift(db, 1, 1);
      const { drawer } = buildServices(db);
      await assert.rejects(
        drawer.recordCashMovement(1, { type: 'safe_drop', amount: 50, note: 'نفس الحساب', managerPin: PASSWORD, requestKey: 'safe-drop-key-003', counterpartAccountId: 1110 } as never, adminAuth),
        (err: any) => err && err.code === 'DRAWER_COUNTERPART_SAME_AS_CASH',
      );
      await assert.rejects(
        drawer.recordCashMovement(1, { type: 'safe_drop', amount: 50, note: 'حساب مصروف', managerPin: PASSWORD, requestKey: 'safe-drop-key-004', counterpartAccountId: 6950 } as never, adminAuth),
        (err: any) => err && err.code === 'TREASURY_ACCOUNT_NOT_FOUND',
      );
      assert.equal((await treasuryRows(db, 1)).length, 0, 'no treasury row is written');
      assert.equal((await journalTotals(db)).count, 0, 'no journal is written');
    } finally {
      await db.destroy();
    }
    console.log('  invalid counterparts fail closed before any write passed');
  }

  // 5. Unknown type: DRAWER_MOVEMENT_TYPE_UNKNOWN before any
  // write — the old coercion to cash_in is gone.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOperatorPassword(db);
      await seedShift(db, 1, 1);
      const { drawer } = buildServices(db);
      await assert.rejects(
        drawer.recordCashMovement(1, { type: 'mystery', amount: 50, note: 'نوع مجهول', managerPin: PASSWORD, requestKey: 'mystery-key-0001' } as never, adminAuth),
        (err: any) => err && err.code === 'DRAWER_MOVEMENT_TYPE_UNKNOWN',
      );
      assert.equal((await treasuryRows(db, 1)).length, 0, 'no treasury row is written');
      assert.equal((await journalTotals(db)).count, 0, 'no journal is written');
    } finally {
      await db.destroy();
    }
    console.log('  unknown movement type fails closed before any write passed');
  }

  // 6. Existing types unchanged: cash_in still posts
  // Dr 1110 / Cr 7100 and cash_out still posts Dr 6950 / Cr
  // 1110, with the new accounts seeded in this fixture.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOperatorPassword(db);
      await seedShift(db, 1, 1);
      const { drawer } = buildServices(db);
      await drawer.recordCashMovement(1, { type: 'cash_in', amount: 20, note: 'توريد', managerPin: PASSWORD, requestKey: 'cash-in-key-00001' } as never, adminAuth);
      await drawer.recordCashMovement(1, { type: 'cash_out', amount: 10, note: 'صرف', managerPin: PASSWORD, requestKey: 'cash-out-key-0001' } as never, adminAuth);
      const rows = await treasuryRows(db, 1);
      assert.equal(rows.length, 2, 'two treasury rows');
      const inLines = await journalLines(db, 'cash_drawer_cash_in', Number(rows[0].id));
      assert.deepEqual([Number(inLines[0].account_id), Number(inLines[0].debit)], [1110, 20], 'cash_in Dr cash');
      assert.deepEqual([Number(inLines[1].account_id), Number(inLines[1].credit)], [7100, 20], 'cash_in Cr income');
      const outLines = await journalLines(db, 'cash_drawer_cash_out', Number(rows[1].id));
      assert.deepEqual([Number(outLines[0].account_id), Number(outLines[0].debit)], [6950, 10], 'cash_out Dr expense');
      assert.deepEqual([Number(outLines[1].account_id), Number(outLines[1].credit)], [1110, 10], 'cash_out Cr cash');
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), 10, 'expected cash nets the two movements');
    } finally {
      await db.destroy();
    }
    console.log('  existing cash_in and cash_out journals unchanged passed');
  }

  // 7. Movement items show the distinct safe labels while
  // keeping the cash_in/cash_out kind union.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedOperatorPassword(db);
      await seedShift(db, 1, 1);
      const { drawer } = buildServices(db);
      await drawer.recordCashMovement(1, { type: 'safe_drop', amount: 50, note: 'إيداع آمن', managerPin: PASSWORD, requestKey: 'safe-drop-key-005', counterpartAccountId: 1120 } as never, adminAuth);
      const listing: any = await drawer.listCashierShifts({}, adminAuth);
      const row = (listing.cashierShifts as any[]).find((entry) => Number(entry.id) === 1);
      const items = (row.movementItems || []) as any[];
      const drop = items.find((entry) => entry.kindLabel === 'تحويل نقدية للخزنة (إيداع آمن)');
      assert.ok(drop, 'the safe drop item carries its distinct label');
      assert.equal(drop.kind, 'cash_out', 'the kind union is unchanged');
      assert.equal(drop.amount, 50, 'the item amount is the absolute drop');
    } finally {
      await db.destroy();
    }
    console.log('  movement items carry distinct safe labels passed');
  }

  // 8. Source + invariant pins: the transfer branches exist in
  // the journal writer, the silent else-branch is gone, and the
  // invariant is exactly once (presence-pinned).
  {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const here = __dirname;
    const postingSource = readFileSync(resolve(here, '../../src/modules/accounting/accounting-posting.service.ts'), 'utf8');
    assert.ok(postingSource.includes('`cash_drawer_${movementType}`'), 'the writer builds the source type from the movement type');
    assert.ok(postingSource.includes("movementType === 'safe_drop'"), 'the writer branches on the safe-drop type');
    assert.ok(postingSource.includes("movementType === 'safe_replenishment'"), 'the writer branches on the replenishment type');
    assert.ok(postingSource.includes('DRAWER_MOVEMENT_TYPE_UNKNOWN'), 'the writer fails closed on unknown types');
    const helperSource = readFileSync(resolve(here, '../../src/modules/cash-drawer/helpers/cash-drawer.helper.ts'), 'utf8');
    assert.ok(helperSource.includes("throw new AppError('نوع حركة الدرج غير معروف', 'DRAWER_MOVEMENT_TYPE_UNKNOWN'"), 'the normalizer validates instead of coercing');
    const invariants = readFileSync(resolve(here, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-CASH-DRAWER-MOVEMENT-TYPES').length - 1, 1, 'the invariant entry must exist exactly once');
    assert.equal(invariants.split('INV-ADMIN-CASH-SALE-SHIFT-REQUIRED').length - 1, 1, 'the P3 invariant must still exist exactly once');
    assert.equal(invariants.split('INV-SHIFT-SALE-CASH-ATTRIBUTION').length - 1, 1, 'the P2 invariant must still exist exactly once');
    assert.equal(invariants.split('INV-CROSS-SHIFT-CANCEL-CASH-ATTRIBUTION').length - 1, 1, 'the P1 invariant must still exist exactly once');
    console.log('  source + invariant pins passed');
  }

  console.log('Cash drawer movement types tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
