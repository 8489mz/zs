/*
 * M4 (INV-REP-SHORTAGE-CUSTODY-GUARD) — a pending stock_shortage row
 * may only be waived or cash-settled when a Dr 1160 custody leg
 * actually stands for it.
 *
 * THE DEFECT: migration 0225 backfilled every settled trip with stock
 * variance > 0.01 into a PENDING stock_shortage row in
 * van_rep_financial_settlements WITHOUT recording whether the rep was
 * actually charged (Dr 1160). The waiver and cash paths then assumed
 * Dr 1160 stands: waiving such a row posts Dr 7200 / Cr 1160 even
 * though trip settlement already booked Dr 7200 for the uncharged
 * shortage (double expense), and cash-settling it posts Cr 1160
 * against nothing (a negative 1160 custody balance). Current
 * settleTrip rows are safe — a non-charged shortage is created as
 * `waived` — only the backfilled pending rows are at risk.
 *
 * THE FIX (prospective only, no backfill, no data rewrite): in
 * settleRepFinancialItem, both the waiver and the cash branch verify
 * — inside the same transaction, under the item's FOR UPDATE lock —
 * that the trip's posted van_trip_settlement journal still carries a
 * Dr 1160 leg covering the item amount (net of any prior waiver /
 * cash reversals for stock_shortage items of the same trip). The
 * linkage that survives is the item's trip_id. Otherwise the settle
 * fails closed with REP_SHORTAGE_NO_CUSTODY_LEG (422): no journal,
 * no status flip, the row stays pending for manual review, and the
 * blocked attempt is written to audit_logs AFTER the transaction
 * rolls back (a write inside the failing transaction would roll back
 * with it), under event_code REP_SHORTAGE_NO_CUSTODY_LEG.
 *
 * WHAT IS DRIVEN: the REAL VanSalesAdminController.settleRepFinancialItem
 * (POST api/van-sales/admin/financial-ledger/:id/settle) with a real
 * req.authContext (M13/M14 precedent — a service-level spec cannot
 * catch controller wiring), the REAL
 * settleRepFinancialItem, the REAL postVanTripSettlement that books
 * the charged (Dr 1160 / Cr 1140) and uncharged (Dr 7200 / Cr 1140)
 * trip journals the guard reads, and the REAL waiver / cash
 * collection postings. GL totals are summed from the posted journal
 * lines, never re-implemented.
 *
 * DECISIONS PINNED HERE: (1) the guard reads the trip-settlement
 * journal — the only record of whether the rep was charged, since
 * migration 0225 kept trip_id but no charge flag; (2) the amount
 * must be covered within one book-digit unit (10^-bookDigits, the
 * tolerance the posting service allows between journal sides), so a
 * partial leg (Dr 1160 25 against a 40 item) fails closed; (3) the
 * cash branch checks the guard BEFORE resolving the receiving shift,
 * so the operator sees the root cause instead of an incidental
 * missing-shift error; (4) audit_logs is the review record — the
 * pending row stays findable in the ledger, and the audit row adds a
 * timestamped, actor-attributed, event-coded record of the blocked
 * attempt; the audit write is best-effort and can never mask the
 * fail-closed error; (5) cash_shortage items need no custody leg —
 * Dr 7200 already stands for them — and are untouched.
 *
 * BASE-RED: at base, cases 3, 4 and 6 pass the settle (waiver posts
 * Dr 7200 / Cr 1160, cash posts Cr 1160) because no guard exists;
 * cases 1, 2 and 5 already pass at base.
 *
 * Run: npx ts-node test/critical/rep-stock-shortage-custody-guard-m4.spec.ts
 * (from backend/). Same PGlite script harness as
 * rep-shortage-cash-settle.spec.ts: one fresh in-memory database per
 * case, db.destroy() teardown only.
 *
 * NOT DRIVEN: a live-Postgres rehearsal driving the real settleTrip
 * end to end (trip load, sales, count, settle) into a settle — the
 * charged/uncharged journals here are produced by the real
 * postVanTripSettlement, which is the exact code settleTrip calls;
 * two-terminal concurrency (PGlite is single-connection — the
 * FOR UPDATE lock plus the status-predicate flip is code-reviewed,
 * not driven concurrently); the frontend settle modal (untouched).
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
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanSalesAdminController } from '../../src/modules/delivery-reps/van-sales.controller';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { formatDailyDocumentNumber } from '../../src/common/utils/document-number.util';

const TENANT = 't1';
const ACCOUNT = 'a1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec-m4', username: 'admin', role: 'admin',
  permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

const controllerReq = { authContext: adminAuth } as any;

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
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz);
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
    status: 'settled', settlement_status: 'settled', sales_amount: 0, cash_collected: 0,
    credit_sales: 0, returns_amount: 0, cash_refunds: 0,
  }).execute();
}

async function seedSettlementItem(db: Kysely<Database>, id: number, entryType: string, amount: number): Promise<void> {
  await (db as any).insertInto('van_rep_financial_settlements').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 4, trip_id: 11,
    entry_type: entryType, amount, status: 'pending', notes: 'shortage fixture',
  }).execute();
}

function buildServices(db: Kysely<Database>): { van: VanSalesService; drawer: CashDrawerService; posting: AccountingPostingService; controller: VanSalesAdminController } {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const audit = new AuditService(db);
  const van = new VanSalesService(db, audit, {} as never, posting);
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  const controller = new VanSalesAdminController(van, {} as never, {} as never, {} as never, {} as never);
  return { van, drawer, posting, controller };
}

/** The real trip-settlement booking for a stock shortage: charged
 * books Dr 1160 / Cr 1140, uncharged books Dr 7200 / Cr 1140. The
 * guard under test reads exactly this journal. */
async function postTripSettlementJournal(
  db: Kysely<Database>,
  posting: AccountingPostingService,
  stockShortageAmount: number,
  chargeToRep: boolean,
): Promise<{ posted: boolean; journalEntryId: number | null }> {
  return posting.postVanTripSettlement(
    db as any,
    11,
    {
      expectedCash: 0,
      countedCash: 0,
      tripExpenses: 0,
      branchId: 1,
      locationId: 10,
      stockShortageAmount,
      stockOverageAmount: 0,
      chargeStockVarianceToRep: chargeToRep,
    },
    adminAuth,
  );
}

async function journalByCode(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<Map<string, { debit: number; credit: number }>> {
  const entries = await (db as any).selectFrom('journal_entries').select('id')
    .where('source_type', '=', sourceType).where('source_id', '=', sourceId).execute();
  assert.equal(entries.length, 1, `expected exactly one ${sourceType} journal for ${sourceId}`);
  const rows = await (db as any).selectFrom('journal_entry_lines as l')
    .innerJoin('accounting_accounts as a', 'a.id', 'l.account_id')
    .select(['a.code as code', 'l.debit as debit', 'l.credit as credit'])
    .where('l.journal_entry_id', '=', Number(entries[0].id)).execute();
  const byCode = new Map<string, { debit: number; credit: number }>();
  for (const row of rows) {
    const code = String((row as any).code);
    const prev = byCode.get(code) || { debit: 0, credit: 0 };
    byCode.set(code, { debit: prev.debit + Number((row as any).debit || 0), credit: prev.credit + Number((row as any).credit || 0) });
  }
  return byCode;
}

async function journalCount(db: Kysely<Database>, sourceType: string): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entries').select('id').where('source_type', '=', sourceType).execute();
  return rows.length;
}

async function journalLeg(db: Kysely<Database>, entryId: number, accountId: number, side: 'debit' | 'credit'): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .select([side])
    .where('journal_entry_id', '=', entryId)
    .where('account_id', '=', accountId)
    .execute();
  return rows.reduce((sum: number, row: any) => sum + Number(row[side] || 0), 0);
}

async function treasuryRows(db: Kysely<Database>): Promise<Array<Record<string, any>>> {
  return (db as any).selectFrom('treasury_transactions').selectAll().orderBy('id', 'asc').execute();
}

async function auditRows(db: Kysely<Database>): Promise<Array<Record<string, any>>> {
  return (db as any).selectFrom('audit_logs').selectAll().orderBy('id', 'asc').execute();
}

async function itemRow(db: Kysely<Database>, id: number): Promise<Record<string, any>> {
  return (db as any).selectFrom('van_rep_financial_settlements').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
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

  // 1. Waiver of a CHARGED pending stock shortage proceeds exactly as
  // before: the trip journal really booked Dr 1160 40 / Cr 1140 40,
  // the waiver reverses it Dr 7200 40 / Cr 1160 40, status waived, no
  // treasury row, no voucher, no audit row.
  await check('M4 charged waiver proceeds: Dr 7200 / Cr 1160, status waived', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { drawer, posting, controller } = buildServices(db);
      const tripPosted = await postTripSettlementJournal(db, posting, 40, true);
      assert.equal(tripPosted.posted, true, 'the charged trip journal posts');
      const tripJournal = await journalByCode(db, 'van_trip_settlement', 11);
      assert.equal(tripJournal.get('1160')?.debit, 40, 'trip settlement charged Dr 1160 40 to the rep');
      assert.equal(tripJournal.get('1140')?.credit, 40, 'trip settlement credited inventory 1140 40');
      assert.equal(tripJournal.get('7200'), undefined, 'no expense leg on a charged shortage');
      await seedSettlementItem(db, 201, 'stock_shortage', 40);
      const result: any = await controller.settleRepFinancialItem(controllerReq, 201, { method: 'waiver', notes: 'تسوية إدارية: عجز مقبول بقرار الإدارة' });
      assert.equal(result.status, 'waived');
      assert.equal(result.receiptVoucherNo, null);
      assert.ok(Number(result.journalEntryId) > 0, 'the waiver journal id is returned');
      assert.equal((await itemRow(db, 201)).status, 'waived');
      assert.equal((await treasuryRows(db)).length, 0, 'a waiver moves no cash');
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), 0, 'no drawer row, so no shift expects cash');
      assert.equal(await journalCount(db, 'rep_shortage_cash_collection'), 0, 'no cash-collection journal');
      const entries = await (db as any).selectFrom('journal_entries').select('id').where('source_type', '=', 'rep_shortage_waiver').execute();
      assert.equal(entries.length, 1, 'exactly one waiver journal');
      assert.equal(Number(entries[0].id), Number(result.journalEntryId), 'the returned id is the posted waiver journal');
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'debit'), 40, 'the custody debit is taken to expense');
      assert.equal(await journalLeg(db, Number(entries[0].id), 1160, 'credit'), 40, 'the rep custody balance is cleared');
      assert.equal(await journalLeg(db, Number(entries[0].id), 1160, 'debit'), 0);
      assert.equal((await auditRows(db)).length, 0, 'a legitimate settle writes no block audit row');
    } finally {
      await db.destroy();
    }
  });

  // 2. Cash settlement of a CHARGED pending stock shortage proceeds
  // exactly as before: Dr 1110 40 / Cr 1160 40, one treasury row into
  // the settler shift, deterministic voucher, status settled.
  await check('M4 charged cash settle proceeds: Dr 1110 / Cr 1160, status settled', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { drawer, posting, controller } = buildServices(db);
      await postTripSettlementJournal(db, posting, 40, true);
      await seedSettlementItem(db, 202, 'stock_shortage', 40);
      const result: any = await controller.settleRepFinancialItem(controllerReq, 202, { method: 'cash' });
      assert.equal(result.status, 'settled');
      assert.equal(result.receiptVoucherNo, formatDailyDocumentNumber('REC', 202), 'the voucher is deterministic, never random');
      assert.ok(Number(result.journalEntryId) > 0, 'the journal id is returned');
      const rows = await treasuryRows(db);
      assert.equal(rows.length, 1, 'exactly one treasury row for the collection');
      assert.equal(Number(rows[0].amount), 40);
      assert.equal(Number(rows[0].reference_id), 1, 'the row links the settler shift');
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), 40, 'the receiving shift expects the collected cash');
      const entries = await (db as any).selectFrom('journal_entries').select('id').where('source_type', '=', 'rep_shortage_cash_collection').execute();
      assert.equal(entries.length, 1, 'exactly one collection journal');
      assert.equal(await journalLeg(db, Number(entries[0].id), 1110, 'debit'), 40);
      assert.equal(await journalLeg(db, Number(entries[0].id), 1160, 'credit'), 40, 'the rep custody balance is cleared');
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'credit'), 0, 'no shortage-expense credit for a stock shortage');
      assert.equal((await itemRow(db, 202)).status, 'settled');
      assert.equal((await auditRows(db)).length, 0, 'a legitimate settle writes no block audit row');
    } finally {
      await db.destroy();
    }
  });

  // 3. Waiver of a BACKFILLED pending stock shortage with NO Dr 1160
  // leg fails closed: the trip journal booked the uncharged shape
  // (Dr 7200 / Cr 1140), so the waiver would double-book the
  // expense. Specific code, no journal, row stays pending, and the
  // blocked attempt is recorded in audit_logs.
  await check('M4 backfilled waiver blocked: uncharged trip journal, REP_SHORTAGE_NO_CUSTODY_LEG, row stays pending', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { posting, controller } = buildServices(db);
      await postTripSettlementJournal(db, posting, 40, false);
      const tripJournal = await journalByCode(db, 'van_trip_settlement', 11);
      assert.equal(tripJournal.get('7200')?.debit, 40, 'the uncharged trip journal expensed Dr 7200 40');
      assert.equal(tripJournal.get('1140')?.credit, 40, 'the uncharged trip journal credited inventory 1140 40');
      assert.equal(tripJournal.get('1160'), undefined, 'no custody leg stands for the uncharged shortage');
      await seedSettlementItem(db, 203, 'stock_shortage', 40);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReq, 203, { method: 'waiver', notes: 'تسوية إدارية: عجز مقبول بقرار الإدارة' }),
        (err: any) => err && err.code === 'REP_SHORTAGE_NO_CUSTODY_LEG',
        'the waiver must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 203)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
      assert.equal(await journalCount(db, 'rep_shortage_cash_collection'), 0, 'no collection journal either');
      assert.equal((await treasuryRows(db)).length, 0, 'no treasury row');
      const after = await journalByCode(db, 'van_trip_settlement', 11);
      assert.equal(after.get('7200')?.debit, 40, 'the trip expense leg is untouched — no double booking');
      const audits = await auditRows(db);
      assert.equal(audits.length, 1, 'exactly one audit row records the blocked attempt');
      assert.equal(audits[0].event_code, 'REP_SHORTAGE_NO_CUSTODY_LEG', 'the audit row carries the stable event code');
      assert.ok(String(audits[0].details || '').includes('#203'), 'the audit row names the blocked item');
      assert.equal(audits[0].tenant_id, TENANT, 'the audit row is tenant-scoped');
    } finally {
      await db.destroy();
    }
  });

  // 4. Cash settlement of the same backfilled row fails closed
  // identically — here the trip journal is missing entirely (the
  // trip settled before journals were kept), so there is no leg at
  // all to reverse. No journal, no treasury row, row stays pending,
  // audit row recorded.
  await check('M4 backfilled cash settle blocked: no trip journal at all, same code, row stays pending', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { controller } = buildServices(db);
      await seedSettlementItem(db, 204, 'stock_shortage', 40);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReq, 204, { method: 'cash' }),
        (err: any) => err && err.code === 'REP_SHORTAGE_NO_CUSTODY_LEG',
        'the cash settle must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 204)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_cash_collection'), 0, 'no collection journal is posted');
      assert.equal(await journalCount(db, 'van_trip_settlement'), 0, 'no trip journal exists in this fixture');
      assert.equal((await treasuryRows(db)).length, 0, 'no treasury row');
      const audits = await auditRows(db);
      assert.equal(audits.length, 1, 'exactly one audit row records the blocked attempt');
      assert.equal(audits[0].event_code, 'REP_SHORTAGE_NO_CUSTODY_LEG');
      assert.ok(String(audits[0].details || '').includes('#204'), 'the audit row names the blocked item');
    } finally {
      await db.destroy();
    }
  });

  // 5a. Cash-shortage cash settle is unchanged: it needs no custody
  // leg (Dr 7200 already stands for a cash shortage), so it settles
  // Dr 1110 / Cr 7200 even with no trip journal at all.
  await check('M4 cash-shortage cash settle unchanged: Dr 1110 / Cr 7200 with no trip journal', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { drawer, controller } = buildServices(db);
      await seedSettlementItem(db, 205, 'cash_shortage', 25);
      const result: any = await controller.settleRepFinancialItem(controllerReq, 205, { method: 'cash' });
      assert.equal(result.status, 'settled');
      assert.equal((await treasuryRows(db)).length, 1, 'exactly one treasury row');
      assert.equal(await drawer.computeShiftExpectedCash(1, adminAuth), 25);
      const entries = await (db as any).selectFrom('journal_entries').select('id').where('source_type', '=', 'rep_shortage_cash_collection').execute();
      assert.equal(entries.length, 1, 'exactly one collection journal');
      assert.equal(await journalLeg(db, Number(entries[0].id), 1110, 'debit'), 25);
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'credit'), 25, 'the shortage expense is recovered');
      assert.equal(await journalLeg(db, Number(entries[0].id), 1160, 'credit'), 0, 'custody is untouched by a cash shortage');
      assert.equal((await auditRows(db)).length, 0, 'no block audit row');
    } finally {
      await db.destroy();
    }
  });

  // 5b. Cash-shortage waiver stays record-only: no journal, no
  // treasury row, no voucher — the guard does not touch it.
  await check('M4 cash-shortage waiver unchanged: record-only, no journal', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { controller } = buildServices(db);
      await seedSettlementItem(db, 206, 'cash_shortage', 25);
      const result: any = await controller.settleRepFinancialItem(controllerReq, 206, { method: 'waiver', notes: 'تسوية إدارية: عجز مقبول بقرار الإدارة' });
      assert.equal(result.status, 'waived');
      assert.equal(result.receiptVoucherNo, null);
      assert.equal(result.journalEntryId, null, 'a cash-shortage waiver returns no journal id');
      assert.equal((await itemRow(db, 206)).status, 'waived');
      assert.equal((await treasuryRows(db)).length, 0, 'a waiver moves no cash');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'a cash-shortage waiver posts no waiver journal');
      assert.equal((await auditRows(db)).length, 0, 'no block audit row');
    } finally {
      await db.destroy();
    }
  });

  // 6. A PARTIAL custody leg fails closed too: Dr 1160 25 stands
  // against a 40 item, so reversing the full 40 would over-clear
  // custody by 15. The amount must be covered, not merely present.
  await check('M4 partial custody leg blocked: Dr 1160 25 against a 40 item fails closed', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { posting, controller } = buildServices(db);
      await postTripSettlementJournal(db, posting, 25, true);
      const tripJournal = await journalByCode(db, 'van_trip_settlement', 11);
      assert.equal(tripJournal.get('1160')?.debit, 25, 'only Dr 1160 25 stands');
      await seedSettlementItem(db, 207, 'stock_shortage', 40);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReq, 207, { method: 'waiver', notes: 'تسوية إدارية: عجز مقبول بقرار الإدارة' }),
        (err: any) => err && err.code === 'REP_SHORTAGE_NO_CUSTODY_LEG',
        'a partial leg must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 207)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
      const audits = await auditRows(db);
      assert.equal(audits.length, 1, 'exactly one audit row records the blocked attempt');
      assert.equal(audits[0].event_code, 'REP_SHORTAGE_NO_CUSTODY_LEG');
    } finally {
      await db.destroy();
    }
  });

  // 7. Source pins: the guard exists in the settle path (both
  // branches call it, once defined), the error code is named, and
  // the cash/waiver postings are still the ones being called.
  {
    const here = __dirname;
    const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
    assert.ok(vanSource.includes('INV-REP-SHORTAGE-CUSTODY-GUARD'), 'the settle names the guard invariant');
    assert.ok(vanSource.includes('REP_SHORTAGE_NO_CUSTODY_LEG'), 'the specific error code is named');
    assert.ok(vanSource.includes('van_trip_settlement'), 'the guard reads the trip-settlement journal');
    assert.equal(
      vanSource.split('assertRepStockShortageCustodyLeg(').length - 1,
      3,
      'the guard is defined once and called from both branches',
    );
    assert.ok(vanSource.includes('postRepShortageCashCollection'), 'the cash branch still calls the collection posting');
    assert.ok(vanSource.includes('postRepShortageWaiver'), 'the waiver branch still calls the waiver reversal posting');
    assert.ok(vanSource.includes('audit.log'), 'the blocked attempt is recorded via the audit log');
    console.log('  PASS M4 source pins');
  }

  if (failures.length) throw new Error(`${failures.length} M4 case(s) failed: ${failures.join(', ')}`);
  console.log('M4 rep stock-shortage custody-guard tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
