/*
New file: backend/test/critical/rep-shortage-cash-settle.spec.ts

WHAT THIS PINS (INV-REP-SHORTAGE-CASH-SETTLE): when a rep later pays a
pending shortage in cash through settleRepFinancialItem, the cash is real
money movement, not a status flip: exactly one balanced journal (Dr 1110 /
Cr 7200 for a cash shortage, Cr 1160 for a stock shortage charged to the
rep) through postDomainJournal, exactly one treasury row
(txn_type rep_cash_remittance, reference_type cashier_shift, deterministic
request_key rep-shortage-cash:<itemId>) linked to the receiving shift, and
the status flip, all in ONE transaction. The receiving shift is the
settler's own open shift first, else the latest open shift on the branch of
the trip's van location; no open shift fails the whole settle closed with
OPEN_SHIFT_REQUIRED. A waiver stays record-only. Cash on a
bonus/commission item fails closed: those leave through payroll, never
through this cash receipt. The receipt voucher is deterministic
(REC-<date>-<itemId>), never a random number.

WHAT IS DRIVEN: the real settleRepFinancialItem (real tenant-currency
resolution at book digits, real postRepShortageCashCollection journal,
real shift resolution, real treasury insert) plus the real
CashDrawerService.computeShiftExpectedCash, on PGlite. GL totals are
summed from the posted journal lines, never re-implemented.

DELEGATED DECISIONS, FLAGGED FOR REVERSAL: (1) the credit accounts —
7200 for a cash shortage (reversing the shortage expense trip settlement
booked) and 1160 for a stock shortage (clearing the rep custody trip
settlement booked) — are the same codes postVanTripSettlement used, so
the recovery reverses exactly what was booked; (2) the settler-shift-first
order with a branch fallback, and no cross-cashier attribution beyond
that branch; (3) the voucher day keeps the host-local behaviour this
endpoint always had (tenant-timezone day resolution is recorded
remaining work, as in the numbering util).

NOT DRIVEN: two-terminal concurrency (PGlite is single-connection — the
FOR UPDATE lock plus the status-predicate flip that serializes concurrent
settlers is code-reviewed, not driven concurrently); a live
Postgres run; a physical cash handover at a real counter; the frontend
settle modal (untouched).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { formatDailyDocumentNumber } from '../../src/common/utils/document-number.util';

const TENANT = 't1';
const ACCOUNT = 'a1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const cashierBAuth: AuthContext = {
  userId: 3, sessionId: 'spec-b', username: 'cashier-b', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
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
    CREATE TABLE accounting_fiscal_years (id bigint PRIMARY KEY, tenant_id text, status text, closing_entry_id bigint);
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
    CREATE TABLE product_offers (id bigint PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, end_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric DEFAULT 0, stock_variance_amount numeric DEFAULT 0, stock_variance_details text, night_stock_approved boolean, night_stock_approved_by bigint, night_stock_notes text, distance_km numeric, notes text, opened_at timestamptz, submitted_at timestamptz, closed_at timestamptz, settled_by bigint, supervisor_id bigint, updated_at timestamptz);
    CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, amount numeric DEFAULT 0, created_at timestamptz DEFAULT NOW());
    CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, notes text, settled_at timestamptz, settled_by bigint, settlement_method text, receipt_voucher_no text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, expected_cash numeric, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, request_key text, created_at timestamptz DEFAULT NOW());
    CREATE UNIQUE INDEX idx_treasury_txns_drawer_request_key_uniq ON treasury_transactions (tenant_id, request_key) WHERE request_key IS NOT NULL AND reference_type = 'cashier_shift';
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigint PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 3, tenant_id: TENANT, username: 'cashier-b', role: 'cashier', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 4, tenant_id: TENANT, username: 'rep-user', role: 'driver', is_active: true }).execute();
  const accounts: Array<[number, string]> = [
    [1110, '1110'], [1120, '1120'], [1130, '1130'], [1140, '1140'],
    [1160, '1160'], [2120, '2120'], [4100, '4100'], [4300, '4300'],
    [5100, '5100'], [6400, '6400'], [7100, '7100'], [7200, '7200'],
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
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Van', location_type: 'van', is_active: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: 4, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep One', phone: null, van_location_id: 10 }).execute();
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: openedBy, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: SHIFT_OPENED_AT,
  }).execute();
}

async function seedTrip(db: Kysely<Database>): Promise<void> {
  await (db as any).insertInto('van_sales_trips').values({
    id: 11, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 4, vehicle_id: null,
    start_odometer: 100, end_odometer: null, van_location_id: 10, source_warehouse_id: 10,
    status: 'open', settlement_status: 'open', sales_amount: 0, cash_collected: 0,
    credit_sales: 0, returns_amount: 0, cash_refunds: 0,
  }).execute();
}

async function seedSettlementItem(db: Kysely<Database>, id: number, entryType: string, amount: number): Promise<void> {
  await (db as any).insertInto('van_rep_financial_settlements').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 4, trip_id: 11,
    entry_type: entryType, amount, status: 'pending', notes: 'shortage fixture',
  }).execute();
}

function buildServices(db: Kysely<Database>): { van: VanSalesService; drawer: CashDrawerService; posting: AccountingPostingService } {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const van = new VanSalesService(db, {} as never, {} as never, posting);
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  return { van, drawer, posting };
}

async function treasuryRows(db: Kysely<Database>): Promise<Array<Record<string, any>>> {
  return (db as any).selectFrom('treasury_transactions').selectAll().orderBy('id', 'asc').execute();
}

async function journalEntries(db: Kysely<Database>): Promise<Array<Record<string, any>>> {
  return (db as any).selectFrom('journal_entries').selectAll().where('source_type', '=', 'rep_shortage_cash_collection').execute();
}

async function journalLeg(db: Kysely<Database>, entryId: number, accountId: number, side: 'debit' | 'credit'): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .select([side])
    .where('journal_entry_id', '=', entryId)
    .where('account_id', '=', accountId)
    .execute();
  return rows.reduce((sum: number, row: any) => sum + Number(row[side] || 0), 0);
}

async function itemRow(db: Kysely<Database>, id: number): Promise<Record<string, any>> {
  return (db as any).selectFrom('van_rep_financial_settlements').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function main(): Promise<void> {
  // 1. Cash shortage, cash settle: the settler's own shift receives the
  // cash, the other shift is untouched, exactly one balanced journal
  // (Dr 1110 / Cr 7200), exactly one deterministic treasury row.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedShift(db, 2, 3);
      await seedTrip(db);
      await seedSettlementItem(db, 101, 'cash_shortage', 25);
      const { van, drawer } = buildServices(db);
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), 0, 'nothing expected before the collection');
      const result = await van.settleRepFinancialItem(TENANT, ACCOUNT, 101, { method: 'cash' }, adminAuth);
      assert.equal(result.status, 'settled');
      assert.equal(result.receiptVoucherNo, formatDailyDocumentNumber('REC', 101), 'the voucher is deterministic, never random');
      assert.ok(Number(result.journalEntryId) > 0, 'the journal id is returned');
      const rows = await treasuryRows(db);
      assert.equal(rows.length, 1, 'exactly one treasury row for the collection');
      assert.equal(rows[0].txn_type, 'rep_cash_remittance');
      assert.equal(rows[0].reference_type, 'cashier_shift');
      assert.equal(Number(rows[0].reference_id), 1, 'the row links the settler shift');
      assert.equal(Number(rows[0].amount), 25);
      assert.equal(rows[0].request_key, 'rep-shortage-cash:101');
      assert.ok(String(rows[0].note || '').includes('مندوب'), 'the note classifies the row as a delivery receipt');
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), 25, 'the receiving shift expects the collected cash');
      assert.equal(await drawer.computeShiftExpectedCash(2, cashierBAuth), 0, 'the other shift stays untouched');
      const entries = await journalEntries(db);
      assert.equal(entries.length, 1, 'exactly one collection journal');
      assert.equal(Number(entries[0].branch_id), 1, 'the journal carries the receiving shift branch');
      assert.equal(Number(entries[0].location_id), 10, 'the journal carries the receiving shift location');
      assert.equal(await journalLeg(db, Number(entries[0].id), 1110, 'debit'), 25, 'GL cash is debited exactly once');
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'credit'), 25, 'the shortage expense is recovered, not booked as new income');
      assert.equal(await journalLeg(db, Number(entries[0].id), 1110, 'credit'), 0);
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'debit'), 0);
      const item = await itemRow(db, 101);
      assert.equal(item.status, 'settled');
      assert.equal(item.settlement_method, 'cash');
      assert.equal(item.receipt_voucher_no, result.receiptVoucherNo);
    } finally {
      await db.destroy();
    }
    console.log('  cash shortage settles into the settler shift with one balanced journal passed');
  }

  // 2. Stock shortage charged to the rep: the same cash-in shape, but the
  // credit clears the rep custody account 1160 trip settlement booked.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      await seedSettlementItem(db, 102, 'stock_shortage', 40);
      const { van, drawer } = buildServices(db);
      const result = await van.settleRepFinancialItem(TENANT, ACCOUNT, 102, { method: 'cash' }, adminAuth);
      assert.equal(result.status, 'settled');
      assert.equal((await treasuryRows(db)).length, 1);
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), 40);
      const entries = await journalEntries(db);
      assert.equal(entries.length, 1);
      assert.equal(await journalLeg(db, Number(entries[0].id), 1110, 'debit'), 40);
      assert.equal(await journalLeg(db, Number(entries[0].id), 1160, 'credit'), 40, 'the rep custody balance is cleared');
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'credit'), 0, 'no shortage-expense credit for a stock shortage');
    } finally {
      await db.destroy();
    }
    console.log('  stock shortage settles against rep custody passed');
  }

  // 3. Settler holds no shift: the branch fallback shift (the trip's van
  // location branch) receives the cash.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 2, 3);
      await seedTrip(db);
      await seedSettlementItem(db, 103, 'cash_shortage', 30);
      const { van, drawer } = buildServices(db);
      const shiftlessSupervisor = {
        userId: 5, sessionId: 'spec-s', username: 'supervisor', role: 'admin',
        permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
      } as unknown as AuthContext;
      const result = await van.settleRepFinancialItem(TENANT, ACCOUNT, 103, { method: 'cash' }, shiftlessSupervisor);
      assert.equal(result.status, 'settled');
      const rows = await treasuryRows(db);
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].reference_id), 2, 'the branch fallback shift receives it');
      assert.equal(await drawer.computeShiftExpectedCash(2, cashierBAuth), 30);
    } finally {
      await db.destroy();
    }
    console.log('  branch fallback shift receives the collection passed');
  }

  // 4. No open shift anywhere: the whole settle fails closed, the item
  // stays pending, and nothing is written.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedTrip(db);
      await seedSettlementItem(db, 104, 'cash_shortage', 25);
      const { van } = buildServices(db);
      await assert.rejects(
        () => van.settleRepFinancialItem(TENANT, ACCOUNT, 104, { method: 'cash' }, adminAuth),
        /OPEN_SHIFT_REQUIRED/,
      );
      assert.equal((await itemRow(db, 104)).status, 'pending', 'the item stays pending');
      assert.equal((await treasuryRows(db)).length, 0, 'no treasury row');
      assert.equal((await journalEntries(db)).length, 0, 'no journal either: the failure rolls the transaction back');
    } finally {
      await db.destroy();
    }
    console.log('  no open shift fails closed passed');
  }

  // 5. Waiver stays record-only: no journal, no treasury row, no voucher.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      await seedSettlementItem(db, 105, 'cash_shortage', 25);
      const { van, drawer } = buildServices(db);
      const result = await van.settleRepFinancialItem(TENANT, ACCOUNT, 105, { method: 'waiver' }, adminAuth);
      assert.equal(result.status, 'waived');
      assert.equal(result.receiptVoucherNo, null);
      assert.equal((await itemRow(db, 105)).status, 'waived');
      assert.equal((await treasuryRows(db)).length, 0, 'a waiver moves no cash');
      assert.equal((await journalEntries(db)).length, 0, 'a waiver posts no journal');
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), 0);
    } finally {
      await db.destroy();
    }
    console.log('  waiver stays record-only passed');
  }

  // 6. Cash on a bonus item fails closed: bonuses leave through payroll,
  // never through this cash receipt. Nothing is written.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      await seedSettlementItem(db, 106, 'bonus', 50);
      const { van } = buildServices(db);
      await assert.rejects(
        () => van.settleRepFinancialItem(TENANT, ACCOUNT, 106, { method: 'cash' }, adminAuth),
        /SETTLEMENT_CASH_UNSUPPORTED/,
      );
      assert.equal((await itemRow(db, 106)).status, 'pending', 'the bonus stays pending');
      assert.equal((await treasuryRows(db)).length, 0, 'no treasury row');
      assert.equal((await journalEntries(db)).length, 0, 'no journal');
    } finally {
      await db.destroy();
    }
    console.log('  cash on a bonus fails closed passed');
  }

  // 7. A second settle is rejected and never doubles the row, the
  // expected cash, or the journal.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      await seedSettlementItem(db, 107, 'cash_shortage', 25);
      const { van, drawer } = buildServices(db);
      await van.settleRepFinancialItem(TENANT, ACCOUNT, 107, { method: 'cash' }, adminAuth);
      await assert.rejects(
        () => van.settleRepFinancialItem(TENANT, ACCOUNT, 107, { method: 'cash' }, adminAuth),
        /ALREADY_SETTLED/,
      );
      assert.equal((await treasuryRows(db)).length, 1, 'still one treasury row');
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), 25, 'expected cash is not doubled');
      assert.equal((await journalEntries(db)).length, 1, 'still one journal');
    } finally {
      await db.destroy();
    }
    console.log('  duplicate settle never doubles passed');
  }

  // 8. An unknown settle method fails closed instead of silently
  // waiving the item, as the old ternary did for any non-cash value.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      await seedSettlementItem(db, 108, 'cash_shortage', 25);
      const { van } = buildServices(db);
      await assert.rejects(
        () => van.settleRepFinancialItem(TENANT, ACCOUNT, 108, { method: 'bogus' } as any, adminAuth),
        /SETTLEMENT_METHOD_INVALID/,
      );
      assert.equal((await itemRow(db, 108)).status, 'pending', 'the item stays pending');
      assert.equal((await treasuryRows(db)).length, 0, 'no treasury row');
      assert.equal((await journalEntries(db)).length, 0, 'no journal');
    } finally {
      await db.destroy();
    }
    console.log('  unknown method fails closed passed');
  }

  // 9. Source + invariant pins: the collection posting exists in the
  // posting service and the settle names the invariant; the invariant
  // entry exists exactly once (tail order is NOT pinned — the flexible
  // invariant method appends it wherever the file ends).
  {
    const here = __dirname;
    const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
    assert.ok(vanSource.includes('INV-REP-SHORTAGE-CASH-SETTLE'), 'settleRepFinancialItem names the invariant');
    assert.ok(vanSource.includes('postRepShortageCashCollection'), 'the settle calls the collection posting');
    assert.ok(vanSource.includes('rep-shortage-cash:'), 'the deterministic treasury request key exists');
    const postingSource = readFileSync(resolve(here, '../../src/modules/accounting/accounting-posting.service.ts'), 'utf8');
    assert.ok(postingSource.includes('rep_shortage_cash_collection'), 'the collection journal source type exists');
    const invariants = readFileSync(resolve(here, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-REP-SHORTAGE-CASH-SETTLE').length - 1, 1, 'the invariant entry must exist exactly once');
    console.log('  source + invariant pins passed');
  }

  console.log('Rep shortage cash settle tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
