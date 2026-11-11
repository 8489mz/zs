/*
New file: backend/test/critical/van-settle-count-overage.spec.ts

WHAT THIS PINS (INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE): the two
halves of the van stock audit that used to stay invisible.
1. UNCOUNTED: reconcileVanStockAudit used to default an uncounted
   item's countedQty to the system qty, so a partial count certified
   the uncounted remainder as balanced. Now the engine surfaces
   uncounted items explicitly (hasUncountedItems / uncountedItems /
   counted:false) and settleTrip REFUSES to settle while any item is
   uncounted (VAN_STOCK_AUDIT_INCOMPLETE, 422), naming the products
   — inside the transaction, before any stock move, journal, or trip
   update, so the refused trip stays open and untouched.
2. OVERAGE: totalStockOverageCost was computed by the engine but had
   zero consumers — overage units were never added, journaled, or
   recorded. Now settleTrip adds the found units to van stock
   (movement 'van_stock_overage'), postVanTripSettlement journals
   them Dr 1140 / Cr 7100 at book digits, and a settled
   'stock_overage' row lands in the rep financial ledger — the exact
   mirror of the shortage path, never a silent stock/income increase.

THE CASES (EGP, 2 book digits, unless stated; one shared PGlite DB):
1. Engine: a partial count flags the uncounted item (hasUncountedItems,
   uncountedItems lists it, counted:false) while a counted overage
   item still computes its overage cost.
2. Settle refuses a partial count: trip stays open, no journal, van
   stock untouched, no ledger row, error names the uncounted product.
3. Overage settles: system 5, counted 7 at cost 10 — journal Dr 1140
   20 / Cr 7100 20 and balanced, van qty becomes 7, a
   'van_stock_overage' movement of 2 is recorded, a settled
   'stock_overage' ledger row of 20 exists, result.stockOverageAmount
   is 20.
4. Shortage unchanged: system 10, counted 8 at cost 5 — journal
   Dr 1160 10 / Cr 1140 10, van qty becomes 8, a pending
   'stock_shortage' ledger row of 10 exists, result.stockVarianceAmount
   is 10 and stockOverageAmount is 0.
5. Full count, zero variance: settles clean — no journal, no ledger
   rows, van qty unchanged.
6. KWD, 3 book digits: system 10, counted 11 at cost 10.125 —
   journal Dr 1140 10.125 / Cr 7100 10.125 (book digits, not 2dp).

WHAT IS DRIVEN: the real reconcileVanStockAudit, the real settleTrip
(real tenant-currency resolution, real moveVanStock, real
postVanTripSettlement journal) on PGlite, reusing the
journal-legs spec's proven harness shape. Journal legs are summed
from the posted journal rows, never re-implemented.

NOT DRIVEN: a live sale-to-settlement run on Postgres (deferred by
written decision); two-terminal concurrency (PGlite is
single-connection); the driver-phone count UI (the settle endpoint
already accepts countedStock; the refusal error names what to count).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { reconcileVanStockAudit } from '../../src/modules/delivery-reps/van-trip-reconciliation.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const adminAuth: AuthContext = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
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
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
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
  await anyDb.insertInto('cashier_shifts').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, doc_no: 'SHIFT-1',
    opened_by: 1, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: SHIFT_OPENED_AT,
  }).execute();
  // Products: 1 = overage case (cost 10), 2 = refusal case B (cost 5),
  // 3 = shortage case (cost 5), 4 = clean case (cost 5), 5 = KWD case (cost 10.125).
  const products: Array<[number, string, number]> = [
    [1, 'Item A', 10], [2, 'Item B', 5], [3, 'Item C', 5], [4, 'Item D', 5], [5, 'Item E', 10.125],
  ];
  for (const [id, name, cost] of products) {
    await anyDb.insertInto('products').values({
      id, tenant_id: TENANT, account_id: ACCOUNT, name, name_en: name,
      barcode: String(id), cost_price: cost, retail_price: cost * 1.5, stock_qty: 0, reserved_qty: 0,
      is_active: true, default_location_id: 1,
    }).execute();
  }
}

async function seedTrip(db: Kysely<Database>, tripId: number): Promise<void> {
  await (db as any).insertInto('van_sales_trips').values({
    id: tripId, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 4, vehicle_id: null,
    start_odometer: 100, end_odometer: null, van_location_id: 10, source_warehouse_id: 10,
    status: 'open', settlement_status: 'open', sales_amount: 0, cash_collected: 0,
    credit_sales: 0, returns_amount: 0, cash_refunds: 0,
  }).execute();
}

/** Replace the whole van stock with exactly these rows (system qtys). */
async function setVanStock(db: Kysely<Database>, rows: Array<{ productId: number; qty: number }>): Promise<void> {
  const anyDb = db as any;
  await anyDb.deleteFrom('product_location_stock').execute();
  for (const row of rows) {
    await anyDb.insertInto('product_location_stock').values({
      tenant_id: TENANT, account_id: ACCOUNT, product_id: row.productId, branch_id: 1,
      location_id: 10, qty: row.qty, reserved_qty: 0,
    }).execute();
    await anyDb.updateTable('products').set({ stock_qty: row.qty }).where('id', '=', row.productId).execute();
  }
}

function buildServices(db: Kysely<Database>): { van: VanSalesService } {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const van = new VanSalesService(db, {} as never, {} as never, posting);
  return { van };
}

async function journalEntries(db: Kysely<Database>, tripId: number): Promise<Array<Record<string, any>>> {
  return (db as any).selectFrom('journal_entries').selectAll()
    .where('source_type', '=', 'van_trip_settlement').where('source_id', '=', tripId).execute();
}

async function journalLeg(db: Kysely<Database>, entryId: number, accountId: number, side: 'debit' | 'credit'): Promise<number> {
  const rows = await (db as any).selectFrom('journal_entry_lines')
    .select([side])
    .where('journal_entry_id', '=', entryId)
    .where('account_id', '=', accountId)
    .execute();
  return rows.reduce((sum: number, row: any) => sum + Number(row[side] || 0), 0);
}

async function journalTotals(db: Kysely<Database>, entryId: number, digits: number): Promise<{ debit: number; credit: number }> {
  const rows = await (db as any).selectFrom('journal_entry_lines').select(['debit', 'credit'])
    .where('journal_entry_id', '=', entryId).execute();
  const summed = rows.reduce((acc: { debit: number; credit: number }, row: any) => ({
    debit: acc.debit + Number(row.debit || 0),
    credit: acc.credit + Number(row.credit || 0),
  }), { debit: 0, credit: 0 });
  return { debit: Number(summed.debit.toFixed(digits)), credit: Number(summed.credit.toFixed(digits)) };
}

async function tripStatus(db: Kysely<Database>, tripId: number): Promise<string> {
  const row = await (db as any).selectFrom('van_sales_trips').select(['status']).where('id', '=', tripId).executeTakeFirst();
  return String(row?.status || '');
}

async function vanQty(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await (db as any).selectFrom('product_location_stock').select(['qty'])
    .where('product_id', '=', productId).where('location_id', '=', 10).executeTakeFirst();
  return Number(row?.qty ?? 0);
}

async function ledgerRows(db: Kysely<Database>, tripId: number): Promise<Array<Record<string, any>>> {
  return (db as any).selectFrom('van_rep_financial_settlements').selectAll().where('trip_id', '=', tripId).execute();
}

async function movementRows(db: Kysely<Database>, tripId: number, type: string): Promise<Array<Record<string, any>>> {
  return (db as any).selectFrom('stock_movements').selectAll()
    .where('reference_type', '=', 'van_sales_trip').where('reference_id', '=', tripId)
    .where('movement_type', '=', type).execute();
}

async function main(): Promise<void> {
  // 1. Engine: a partial count flags the uncounted item while the
  // counted overage item still computes its overage cost.
  {
    const audit = reconcileVanStockAudit([
      { productId: 1, productName: 'Item A', systemQty: 10, countedQty: 10, costPrice: 10, retailPrice: 15 },
      { productId: 2, productName: 'Item B', systemQty: 5, costPrice: 5, retailPrice: 10 },
      { productId: 3, productName: 'Item C', systemQty: 5, countedQty: 6, costPrice: 30, retailPrice: 45 },
    ], 2);
    assert.equal(audit.totalSystemItems, 3);
    assert.equal(audit.auditedItemsCount, 2, 'only the counted items are audited');
    assert.equal(audit.hasUncountedItems, true, 'the partial count is flagged, not certified');
    assert.equal(audit.uncountedItemsCount, 1);
    assert.equal(audit.uncountedItems[0].productId, 2, 'the uncounted item is named');
    assert.equal(audit.uncountedItems[0].systemQty, 5);
    const uncounted = audit.itemVariances.find((iv) => iv.productId === 2)!;
    assert.equal(uncounted.counted, false, 'the variance row says it was never counted');
    assert.equal(uncounted.countedQty, 5, 'countedQty falls back to system qty for display only');
    assert.equal(uncounted.varianceQty, 0, 'no numeric variance is invented for it');
    assert.equal(audit.totalStockOverageCost, 30, 'the counted overage still computes');
    assert.equal(audit.hasStockDiscrepancy, true, 'the counted overage is the discrepancy');
    console.log('  engine flags a partial count passed');
  }

  const { pg, db } = await makeDb();
  try {
    await seedFoundation(db);
    const { van } = buildServices(db);

    // 2. Settle refuses a partial count: Item B was never counted.
    // The trip stays open and nothing is written anywhere.
    {
      await seedTrip(db, 11);
      await setVanStock(db, [{ productId: 1, qty: 10 }, { productId: 2, qty: 5 }]);
      await assert.rejects(
        () => van.settleTrip(4, TENANT, ACCOUNT, {
          tripId: 11, countedCash: 0, unloadRemainingToWarehouse: true, endOdometer: 120,
          countedStock: [{ productId: 1, countedQty: 10 }],
        }, adminAuth),
        (err: any) =>
          err.code === 'VAN_STOCK_AUDIT_INCOMPLETE' &&
          String(err.message).includes('Item B'),
        'the refusal names the uncounted product',
      );
      assert.equal(await tripStatus(db, 11), 'open', 'the refused settle leaves the trip open');
      assert.equal((await journalEntries(db, 11)).length, 0, 'no settlement journal on a refused settle');
      assert.equal((await ledgerRows(db, 11)).length, 0, 'no ledger row on a refused settle');
      assert.equal(await vanQty(db, 1), 10, 'van stock untouched by the refusal');
      assert.equal(await vanQty(db, 2), 5, 'the uncounted item is untouched');
      assert.equal((await movementRows(db, 11, 'van_stock_shortage')).length, 0);
      assert.equal((await movementRows(db, 11, 'van_stock_overage')).length, 0);
      console.log('  settle refuses a partial count passed');
    }

    // 3. Overage settles with a journal: system 5, counted 7 at cost
    // 10 — the 2 found units are worth 20.00.
    {
      await seedTrip(db, 12);
      await setVanStock(db, [{ productId: 1, qty: 5 }]);
      const result = await van.settleTrip(4, TENANT, ACCOUNT, {
        tripId: 12, countedCash: 0, unloadRemainingToWarehouse: false, endOdometer: 120,
        countedStock: [{ productId: 1, countedQty: 7 }],
        nightStockApproved: true,
      }, adminAuth);
      assert.equal(result.status, 'settled');
      assert.equal(result.stockOverageAmount, 20, 'the overage cost reaches the caller');
      assert.equal(result.stockVarianceAmount, 0, 'no shortage on an overage settle');
      const entries = await journalEntries(db, 12);
      assert.equal(entries.length, 1, 'exactly one settlement journal');
      const entryId = Number(entries[0].id);
      assert.equal(await journalLeg(db, entryId, 1140, 'debit'), 20, 'the found stock raises inventory');
      assert.equal(await journalLeg(db, entryId, 7100, 'credit'), 20, 'the overage gain is credited, not silently kept');
      assert.equal(await journalLeg(db, entryId, 1140, 'credit'), 0, 'no shortage credit on an overage');
      assert.equal(await journalLeg(db, entryId, 7100, 'debit'), 0);
      const totals = await journalTotals(db, entryId, 2);
      assert.equal(totals.debit, totals.credit, 'the settlement journal balances');
      assert.equal(totals.debit, 20, 'both sides equal the overage cost');
      assert.equal(await vanQty(db, 1), 7, 'the found units are now system stock');
      const moves = await movementRows(db, 12, 'van_stock_overage');
      assert.equal(moves.length, 1, 'one overage stock movement is recorded');
      assert.equal(Number(moves[0].qty), 2, 'the movement carries the found units');
      const rows = await ledgerRows(db, 12);
      assert.equal(rows.length, 1, 'exactly one ledger row for the overage');
      assert.equal(rows[0].entry_type, 'stock_overage', 'the overage is visible in the rep ledger');
      assert.equal(Number(rows[0].amount), 20);
      assert.equal(rows[0].status, 'settled', 'an overage is a recorded gain, not a claim on the rep');
      assert.equal(await tripStatus(db, 12), 'settled');
      console.log('  overage is journaled, stocked and recorded passed');
    }

    // 4. Shortage unchanged: system 10, counted 8 at cost 5 — the
    // 2 missing units cost 10.00, charged to the rep by supervisor
    // decision (the admin path).
    {
      await seedTrip(db, 13);
      await setVanStock(db, [{ productId: 3, qty: 10 }]);
      const result = await van.settleTrip(4, TENANT, ACCOUNT, {
        tripId: 13, countedCash: 0, unloadRemainingToWarehouse: false, endOdometer: 120,
        countedStock: [{ productId: 3, countedQty: 8 }],
        chargeStockVarianceToRep: true,
        chargeStockVarianceDecidedBySupervisor: true,
        nightStockApproved: true,
      }, adminAuth);
      assert.equal(result.status, 'settled');
      assert.equal(result.stockVarianceAmount, 10, 'the shortage is 2 units at cost 5');
      assert.equal(result.stockOverageAmount, 0, 'no overage on a shortage settle');
      const entries = await journalEntries(db, 13);
      assert.equal(entries.length, 1, 'exactly one settlement journal');
      const entryId = Number(entries[0].id);
      assert.equal(await journalLeg(db, entryId, 1160, 'debit'), 10, 'the shortage is charged to rep custody');
      assert.equal(await journalLeg(db, entryId, 1140, 'credit'), 10, 'inventory is credited for the missing units');
      assert.equal(await journalLeg(db, entryId, 7100, 'credit'), 0, 'no overage leg on a shortage');
      const totals = await journalTotals(db, entryId, 2);
      assert.equal(totals.debit, totals.credit, 'the shortage journal balances');
      assert.equal(await vanQty(db, 3), 8, 'the missing units leave van stock');
      const rows = await ledgerRows(db, 13);
      assert.equal(rows.length, 1, 'exactly one ledger row for the shortage');
      assert.equal(rows[0].entry_type, 'stock_shortage');
      assert.equal(Number(rows[0].amount), 10);
      assert.equal(rows[0].status, 'pending', 'the shortage stays pending on the rep');
      console.log('  shortage behavior unchanged passed');
    }

    // 5. Full count, zero variance: settles clean — no journal, no
    // ledger rows, van qty unchanged.
    {
      await seedTrip(db, 14);
      await setVanStock(db, [{ productId: 4, qty: 10 }]);
      const result = await van.settleTrip(4, TENANT, ACCOUNT, {
        tripId: 14, countedCash: 0, unloadRemainingToWarehouse: false, endOdometer: 120,
        countedStock: [{ productId: 4, countedQty: 10 }],
        nightStockApproved: true,
      }, adminAuth);
      assert.equal(result.status, 'settled');
      assert.equal(result.stockVarianceAmount, 0);
      assert.equal(result.stockOverageAmount, 0);
      assert.equal((await journalEntries(db, 14)).length, 0, 'a clean settle posts no journal');
      assert.equal((await ledgerRows(db, 14)).length, 0, 'a clean settle writes no ledger row');
      assert.equal(await vanQty(db, 4), 10, 'a clean count leaves stock alone');
      console.log('  full count with zero variance settles clean passed');
    }

    // 6. KWD, 3 book digits: system 10, counted 11 at cost 10.125 —
    // the overage journals at 10.125, not at 2dp.
    {
      await (db as any).updateTable('settings').set({ value: 'KWD' })
        .where('tenant_id', '=', TENANT).where('key', '=', 'currency').execute();
      await (db as any).updateTable('currency_exchange_rates').set({ is_base: false })
        .where('tenant_id', '=', TENANT).execute();
      await (db as any).insertInto('currency_exchange_rates')
        .values({ tenant_id: TENANT, currency_code: 'KWD', exchange_rate: 1, is_base: true }).execute();
      await seedTrip(db, 21);
      await setVanStock(db, [{ productId: 5, qty: 10 }]);
      const result = await van.settleTrip(4, TENANT, ACCOUNT, {
        tripId: 21, countedCash: 0, unloadRemainingToWarehouse: false, endOdometer: 120,
        countedStock: [{ productId: 5, countedQty: 11 }],
        nightStockApproved: true,
      }, adminAuth);
      assert.equal(result.status, 'settled');
      assert.equal(result.stockOverageAmount, 10.125, 'the overage rounds at 3 book digits');
      const entries = await journalEntries(db, 21);
      assert.equal(entries.length, 1, 'exactly one settlement journal');
      const entryId = Number(entries[0].id);
      assert.equal(await journalLeg(db, entryId, 1140, 'debit'), 10.125, 'inventory debited at book digits');
      assert.equal(await journalLeg(db, entryId, 7100, 'credit'), 10.125, 'overage gain credited at book digits');
      const totals = await journalTotals(db, entryId, 3);
      assert.equal(totals.debit, totals.credit, 'the KWD journal balances');
      assert.equal(await vanQty(db, 5), 11, 'the found unit is now system stock');
      const rows = await ledgerRows(db, 21);
      assert.equal(rows.length, 1, 'exactly one ledger row for the KWD overage');
      assert.equal(Number(rows[0].amount), 10.125);
      console.log('  KWD overage at book digits passed');
    }

    // 7. Source pins: the refusal, the overage parameter, and the
    // explicit uncounted surfacing exist in the production sources.
    {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const here = __dirname;
      const engineSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-trip-reconciliation.engine.ts'), 'utf8');
      assert.ok(engineSource.includes('hasUncountedItems'), 'the engine surfaces uncounted items');
      assert.ok(engineSource.includes('uncountedItems'), 'the engine lists the uncounted items');
      const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
      assert.ok(vanSource.includes('VAN_STOCK_AUDIT_INCOMPLETE'), 'settleTrip refuses an incomplete audit');
      assert.ok(vanSource.includes('van_stock_overage'), 'settleTrip adds overage units through a named movement');
      assert.ok(vanSource.includes("entry_type: 'stock_overage'"), 'settleTrip records the overage in the rep ledger');
      const postingSource = readFileSync(resolve(here, '../../src/modules/accounting/accounting-posting.service.ts'), 'utf8');
      assert.ok(postingSource.includes('stockOverageAmount'), 'postVanTripSettlement takes the overage amount');
      console.log('  source pins passed');
    }
  } finally {
    await db.destroy();
  }

  console.log('Van settle count overage tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
