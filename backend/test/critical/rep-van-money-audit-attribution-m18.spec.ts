/*
 * Van money audit attribution (INV-REP-VAN-MONEY-AUDIT-ATTRIBUTION).
 *
 * THE GAPS (D13, grounded on live HEAD 38773c48):
 * - (a) VanSalesService injected AuditService (van-sales.service.ts:140)
 *   but never called this.audit.log anywhere except the M4 shortage
 *   best-effort post-rollback log (:7619). Field sales, field
 *   collections, trip settlements, expenses, transfers and return
 *   submissions wrote NO audit.log rows.
 * - (b) Suspicion events wrote audit_logs
 *   (services/van-fraud-radar.service.ts:228) with
 *   `created_by: params.actorUserId ?? null`, but NO caller passed
 *   actorUserId — every suspicion row was actorless (only the rep id
 *   inside the JSON details).
 * - (c) In driver PIN-mode settlement the controller fabricated a
 *   supervisor auth context with `Number(pinVerification.supervisorId
 *   || 0)` (van-sales.controller.ts:197-214) — 0 in PIN mode, because
 *   verifySupervisorPin returns no supervisorId for the shared PIN
 *   (only account mode carries one). The settlement was recorded with
 *   NO approver and nothing recorded HOW it was approved.
 *
 * THE FIX:
 * - (a) One audit.log row per van money action, in the same
 *   transaction as the money (or right after it where the action has
 *   no transaction), naming the real actor: the acting rep's linked
 *   login user id, or null with the rep named in the details when the
 *   rep has no linked login. Never 0, never the tenant's first user.
 *   The journal posting identity follows the same rule
 *   (resolveSystemAuthContext prefers the rep's linked login).
 * - (b) The fraud-radar writer resolves the rep's linked login
 *   itself (the one canonical place — every call site already passes
 *   repId), and the call sites that hold a named human thread it
 *   explicitly (settleTrip maker-checker / odometer / shortage,
 *   recordTripExpense governance, submitTripSettlement odometer,
 *   verifySupervisorPin invalid-PIN / self-approval).
 * - (c) verifySupervisorPin returns approvalMode ('pin' | 'account');
 *   the driver controller passes supervisorId + supervisorApprovalMethod
 *   explicitly into settleTrip; PIN mode records supervisor_id NULL,
 *   settled_by NULL, the shared-PIN method in the trip notes and in
 *   the settlement audit row (created_by null), while account mode
 *   records the identified supervisor everywhere.
 *
 * HARNESS: the real VanSalesService + the real AuditService + the
 * real VanFraudRadarService + the real AccountingPostingService on ONE
 * shared PGlite database, driven through the REAL VanSalesController
 * (the driver token verifier is stubbed — it resolves the driver from
 * a portal token, not from req.authContext, and carries no money
 * logic; the PIN is driven through the REAL verifySupervisorPin with
 * a bcrypt managerPin in settings, as in the van-self-settle-pin
 * spec). Rep 1's phone links him to user 7 (his own login); user 1
 * is the tenant's first active user (the old false attribution); user
 * 2 is a different admin whose login password approves in account
 * mode. Cases are isolated by distinct trip ids on the single shared
 * database.
 *
 * LIMITS (recorded, not fixed here): a rep with no linked login keeps
 * the tenant's first active user as the JOURNAL posting identity
 * (resolveSystemAuthContext fallback) — making that honestly null
 * needs a posting-layer decision (AuthContext.userId is number-typed
 * and sale.created_by feeds postSale's fallback). The audit rows
 * themselves are already honestly null there.
 */

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { VanSalesController, VanSalesAdminController } from '../../src/modules/delivery-reps/van-sales.controller';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AuditService } from '../../src/core/audit/audit.service';
import { VanFraudRadarService } from '../../src/modules/delivery-reps/services/van-fraud-radar.service';
import { hashManagerPin } from '../../src/common/utils/manager-approval';
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const TENANT = 't-rep-van-money-audit-m18';
const ACCOUNT = 'a-rep-van-money-audit-m18';
const SUPERVISOR_PIN = '4321';
const SUPERVISOR_PASSWORD = '2222';
const REP_PASSWORD = '1111';
// Rep 1's linked login (user 7). User 1 is the tenant's first active
// user — the old false attribution the fix must NOT produce. User 2
// is the account-mode supervisor (a different admin).
const REP_LINKED_USER_ID = 7;
const FIRST_USER_ID = 1;
const SUPERVISOR_USER_ID = 2;

const adminAuth: any = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
};
const DRIVER = {
  repId: 1, tenantId: TENANT, accountId: ACCOUNT,
  name: 'Rep 1', phone: '5550001', tenantSuspended: false,
};

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
      CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true);
      CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
      CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text);
      CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
      CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cash_flow_category text, updated_at timestamptz);
      CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint);
      CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
      CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
      CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, pin_hash text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric, plate_number text);
      CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, display_name text, phone text, pin text, pin_hash text, permissions_json text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
      CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, updated_at timestamptz);
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
      CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
      CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
      CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, end_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, cash_refunds numeric DEFAULT 0, total_instapay_sales numeric DEFAULT 0, total_instapay_collections numeric DEFAULT 0, variance numeric DEFAULT 0, stock_variance_amount numeric DEFAULT 0, stock_variance_details text, night_stock_approved boolean, night_stock_approved_by bigint, night_stock_notes text, distance_km numeric, notes text, opened_at timestamptz, submitted_at timestamptz, closed_at timestamptz, settled_by bigint, supervisor_id bigint, updated_at timestamptz);
      CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, total numeric DEFAULT 0, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, paid_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, status text, payment_type text, payment_channel text, collection_status text, customer_id bigint, branch_id bigint, location_id bigint, created_by bigint, delivery_rep_id bigint, van_trip_id bigint, sale_origin text, exchange_return_id bigint, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, note text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id bigint, product_id bigint, product_name text, qty numeric, unit_price numeric, line_total numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, unit_name text, unit_multiplier numeric, is_bonus boolean DEFAULT false, bonus_reason text, tenant_id text, account_id text, modifiers jsonb);
      CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
      CREATE TABLE sale_payments (id bigserial PRIMARY KEY, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, tenant_id text, account_id text);
      CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE product_offers (id bigint PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
      CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, is_active boolean DEFAULT true, updated_at timestamptz);
      CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, gps_lat numeric, gps_lng numeric, tenant_id text, account_id text);
      CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, amount numeric, note text, transfer_reference text, transfer_receipt_url text, payment_channel text, van_trip_id bigint, rep_id bigint, client_tx_id text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_field_returns (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, trip_id bigint, rep_id bigint, customer_id bigint, sale_id bigint, status text, return_reason text, refund_method text, total_amount numeric DEFAULT 0, items_json text, notes text, rejection_reason text, approved_by bigint, approved_at timestamptz, created_at timestamptz DEFAULT NOW());
      CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, idempotency_key text, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_trip_expenses (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, expense_type text, amount numeric DEFAULT 0, notes text, receipt_photo_url text, created_by_user_id bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE van_stock_transfers (id bigserial PRIMARY KEY, tenant_id text, account_id text, transfer_no text, from_rep_id bigint, from_trip_id bigint, from_van_location_id bigint, to_rep_id bigint, to_trip_id bigint, to_van_location_id bigint, status text, total_items_count int, total_qty numeric DEFAULT 0, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE van_stock_transfer_items (id bigserial PRIMARY KEY, transfer_id bigint, tenant_id text, product_id bigint, qty numeric DEFAULT 0, unit_cost numeric DEFAULT 0, unit_price numeric DEFAULT 0);
      CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, notes text, settled_at timestamptz, settled_by bigint, settlement_method text, receipt_voucher_no text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, location_id bigint, status text, opened_by bigint, created_at timestamptz DEFAULT NOW());
      CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric DEFAULT 0, note text, reference_type text, reference_id bigint, branch_id bigint, location_id bigint, created_by bigint, payment_channel text, request_key text, created_at timestamptz DEFAULT NOW());
    `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: JSON.stringify(await hashManagerPin(SUPERVISOR_PIN)) }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', is_active: true }).execute();
  // User 1: the tenant's first active user (the old false attribution).
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', display_name: 'Admin', phone: '5550000', role: 'admin', is_active: true }).execute();
  // User 2: the account-mode supervisor (a different admin).
  const supPassword = await createPasswordRecord(SUPERVISOR_PASSWORD);
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'sup', display_name: 'Supervisor', phone: '5550002', role: 'admin', password_hash: supPassword.hash, password_salt: supPassword.salt, is_active: true }).execute();
  // User 7: rep 1's own login, linked by phone (his admin password
  // is his own credential — it must never approve his own actions).
  const repPassword = await createPasswordRecord(REP_PASSWORD);
  await anyDb.insertInto('users').values({ id: 7, tenant_id: TENANT, username: '5550001', display_name: 'Rep 1', phone: '5550001', role: 'admin', password_hash: repPassword.hash, password_salt: repPassword.salt, is_active: true }).execute();
  const accounts: Array<[number, string, string]> = [
    [1110, '1110', 'asset'], [1120, '1120', 'asset'], [1130, '1130', 'asset'], [1140, '1140', 'asset'],
    [2120, '2120', 'liability'], [4100, '4100', 'revenue'], [4300, '4300', 'revenue'], [5100, '5100', 'expense'],
  ];
  for (const [id, code, type] of accounts) {
    await anyDb.insertInto('accounting_accounts').values({ id, tenant_id: TENANT, code, name_ar: code, account_type: type, is_active: true, is_tax: false }).execute();
  }
  await anyDb.insertInto('accounting_settings').values({
    id: 1, tenant_id: TENANT, cash_account_id: 1110, bank_account_id: 1120,
    customer_receivable_account_id: 1130, inventory_account_id: 1140,
    sales_revenue_account_id: 4100, sales_discount_account_id: 4300,
    cogs_account_id: 5100, sales_tax_account_id: 2120,
  }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Van 1', location_type: 'van', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 21, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Van 2', location_type: 'van', is_active: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 1', phone: '5550001', van_location_id: 20, is_van_rep: true }).execute();
  await anyDb.insertInto('delivery_representatives').values({ id: 2, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 2', phone: '5550002', van_location_id: 21, is_van_rep: true }).execute();
  // Rep 3 has NO phone, so no linked login: his rows must stay
  // honestly actorless (created_by null), never borrowed from user 1.
  await anyDb.insertInto('delivery_representatives').values({ id: 3, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep 3', phone: null, van_location_id: 20, is_van_rep: true }).execute();
  await anyDb.insertInto('products').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, name: 'Item 1', stock_qty: 10, cost_price: 5, retail_price: 10, credit_price: 10, is_active: true }).execute();
  await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 1, location_id: 20, qty: 10 }).execute();
  await anyDb.insertInto('product_location_stock').values({ tenant_id: TENANT, account_id: ACCOUNT, product_id: 1, location_id: 21, qty: 0 }).execute();
  // Customer 31 owes 200, all of it rep 1's share (ledger +200 via trip 2).
  await anyDb.insertInto('customers').values({ id: 31, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 31', balance: 200, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  await anyDb.insertInto('customer_ledger').values({ customer_id: 31, entry_type: 'sale', amount: 200, balance_after: 200, reference_type: 'sale', reference_id: null, van_trip_id: 2, tenant_id: TENANT, account_id: ACCOUNT }).execute();
  // Customer 41 is the cash walk-in for the field sale / return.
  await anyDb.insertInto('customers').values({ id: 41, tenant_id: TENANT, account_id: ACCOUNT, name: 'Shop Customer 41', balance: 0, credit_limit: 0, customer_type: 'cash', metadata: '{}', is_active: true }).execute();
  for (let tripId = 1; tripId <= 10; tripId++) {
    await anyDb.insertInto('van_sales_trips').values({ id: tripId, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 1, van_location_id: 20, source_warehouse_id: 10, status: 'open', settlement_status: 'open' }).execute();
  }
  // Trip 6 carries 100 of collected cash for the submit-settlement case.
  await anyDb.updateTable('van_sales_trips').set({ cash_collected: 100 }).where('id', '=', 6).where('tenant_id', '=', TENANT).execute();
  // One open cashier shift receives the settled rep cash (remittance row).
  await anyDb.insertInto('cashier_shifts').values({ id: 1, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, location_id: null, status: 'open', opened_by: 1 }).execute();
}

function buildService(db: Kysely<Database>): VanSalesService {
  const posting = new AccountingPostingService({
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as never);
  const audit = new AuditService(db);
  const radar = new VanFraudRadarService(db);
  const service = new VanSalesService(db, audit as never, {} as never, posting as never,
    undefined, undefined, undefined, undefined, undefined, undefined, radar as never);
  return service;
}

function buildController(service: VanSalesService): { driver: VanSalesController; admin: VanSalesAdminController } {
  const driver = new VanSalesController(
    service,
    {
      verifyDriverToken: async () => ({ ...DRIVER }),
      verifyDriverTokenForSettlement: async () => ({ ...DRIVER }),
      assertDriverPinChanged: async () => undefined,
    } as never,
    {} as never, {} as never, {} as never, {} as never,
  );
  const admin = new VanSalesAdminController(service, {} as never, {} as never, {} as never, {} as never);
  return { driver, admin };
}

function clearSaleCaches(): void {
  (VanSalesService as any).recentSalesCache?.clear?.();
  (VanSalesService as any).inFlightSalePromises?.clear?.();
}

function clearCollectionCaches(): void {
  (VanSalesService as any).recentCollectionsCache?.clear?.();
  (VanSalesService as any).inFlightCollectionPromises?.clear?.();
}

async function auditRows(db: Kysely<Database>, eventCode: string): Promise<any[]> {
  return (db as any).selectFrom('audit_logs').selectAll().where('tenant_id', '=', TENANT).where('event_code', '=', eventCode).orderBy('id', 'asc').execute();
}

async function tripRow(db: Kysely<Database>, tripId: number): Promise<any> {
  return (db as any).selectFrom('van_sales_trips').selectAll().where('id', '=', tripId).executeTakeFirstOrThrow();
}

async function vanStockQty(db: Kysely<Database>): Promise<number> {
  const row = await (db as any).selectFrom('product_location_stock').select('qty').where('product_id', '=', 1).where('location_id', '=', 20).where('tenant_id', '=', TENANT).executeTakeFirst();
  return Number(row?.qty || 0);
}

async function journalFor(db: Kysely<Database>, sourceType: string, sourceId: number): Promise<any> {
  return (db as any).selectFrom('journal_entries').selectAll().where('source_type', '=', sourceType).where('source_id', '=', sourceId).where('tenant_id', '=', TENANT).executeTakeFirst();
}

async function journalByType(db: Kysely<Database>, sourceType: string): Promise<any> {
  return (db as any).selectFrom('journal_entries').selectAll().where('source_type', '=', sourceType).where('tenant_id', '=', TENANT).orderBy('id', 'asc').executeTakeFirst();
}

async function main(): Promise<void> {
  const { db } = await makeDb();
  try {
    await seedFoundation(db);
    const service = buildService(db);
    const { driver: controller, admin: adminController } = buildController(service);
    let saleId = 0;
    let saleItemId = 0;

    // S1 (a). Field sale through the REAL controller: one audit row
    // naming the selling rep's linked login (user 7) — not the
    // tenant's first user (user 1) and not 0. The sale row and its
    // journal carry the same attribution.
    {
      clearSaleCaches();
      const before = await auditRows(db, 'VAN_FIELD_SALE');
      assert.equal(before.length, 0, 'no sale audit rows before the sale');
      const res: any = await controller.executeSale('Bearer driver', {
        tripId: 1, customerId: 41, customerName: 'Shop Customer 41',
        paymentMethod: 'cash', paidAmount: 20,
        items: [{ productId: 1, qty: 2, unitPrice: 10 }],
        clientTxId: 'm18-sale-1',
      });
      assert.equal(res.ok, true);
      saleId = Number(res.saleId);
      assert.ok(saleId > 0, 'the sale was created');
      const rows = await auditRows(db, 'VAN_FIELD_SALE');
      assert.equal(rows.length, 1, 'exactly one audit row for the field sale');
      assert.equal(Number(rows[0].created_by), REP_LINKED_USER_ID, 'the sale audit row names the rep linked login');
      assert.notEqual(Number(rows[0].created_by), FIRST_USER_ID, 'the sale audit row must not name the first user');
      assert.ok(String(rows[0].details).includes(res.docNo), 'the audit row names the sale document');
      const saleRow: any = await (db as any).selectFrom('sales').selectAll().where('id', '=', saleId).executeTakeFirstOrThrow();
      assert.equal(Number(saleRow.created_by), REP_LINKED_USER_ID, 'the sale row names the rep linked login, not the first user');
      const journal = await journalFor(db, 'sale', saleId);
      assert.ok(journal, 'the sale posted a journal');
      assert.equal(Number(journal.created_by), REP_LINKED_USER_ID, 'the sale journal names the rep linked login');
      const items: any[] = await (db as any).selectFrom('sale_items').selectAll().where('sale_id', '=', saleId).execute();
      assert.equal(items.length, 1, 'one sale line');
      saleItemId = Number(items[0].id);
      console.log('  (S1) field sale audit row names the rep passed');
    }

    // S2 (a). Field collection through the REAL controller: one audit
    // row naming the rep; a replay of the same clientTxId returns the
    // first receipt and writes NO second audit row.
    {
      clearCollectionCaches();
      const res: any = await controller.recordCollection('Bearer driver', {
        tripId: 2, customerId: 31, amount: 100, paymentMethod: 'cash', clientTxId: 'm18-coll-1',
      });
      assert.equal(res.ok, true);
      assert.equal(res.amount, 100);
      const rows = await auditRows(db, 'VAN_FIELD_COLLECTION');
      assert.equal(rows.length, 1, 'exactly one audit row for the field collection');
      assert.equal(Number(rows[0].created_by), REP_LINKED_USER_ID, 'the collection audit row names the rep linked login');
      assert.ok(String(rows[0].details).includes(res.receiptNo), 'the audit row names the receipt');
      const journal = await journalByType(db, 'van_field_collection');
      assert.ok(journal, 'the collection posted a journal');
      assert.equal(Number(journal.created_by), REP_LINKED_USER_ID, 'the collection journal names the rep linked login');
      clearCollectionCaches();
      const replay: any = await controller.recordCollection('Bearer driver', {
        tripId: 2, customerId: 31, amount: 100, paymentMethod: 'cash', clientTxId: 'm18-coll-1',
      });
      assert.equal(replay.receiptNo, res.receiptNo, 'the replay returns the first receipt');
      assert.equal((await auditRows(db, 'VAN_FIELD_COLLECTION')).length, 1, 'the replay writes no second audit row');
      console.log('  (S2) field collection audit row + replay writes none passed');
    }

    // S3 (a). Trip expense through the REAL controller: one audit row
    // naming the rep who recorded it.
    {
      const res: any = await controller.recordTripExpense('Bearer driver', 3, {
        expenseType: 'fuel', amount: 50, notes: 'وقود — محطة الطريق',
      });
      assert.equal(res.ok, true);
      const rows = await auditRows(db, 'VAN_TRIP_EXPENSE');
      assert.equal(rows.length, 1, 'exactly one audit row for the trip expense');
      assert.equal(Number(rows[0].created_by), REP_LINKED_USER_ID, 'the expense audit row names the rep linked login');
      assert.ok(String(rows[0].details).includes('fuel'), 'the audit row names the expense type');
      console.log('  (S3) trip expense audit row names the rep passed');
    }

    // S4 (a). Inter-van transfer through the REAL controller: one
    // audit row naming the sending rep.
    {
      const res: any = await controller.createTransfer('Bearer driver', {
        toRepId: 2, fromTripId: 4, items: [{ productId: 1, qty: 2 }], notes: 'تحويل دعم',
      });
      assert.equal(res.ok, true);
      const rows = await auditRows(db, 'VAN_INTER_VAN_TRANSFER');
      assert.equal(rows.length, 1, 'exactly one audit row for the inter-van transfer');
      assert.equal(Number(rows[0].created_by), REP_LINKED_USER_ID, 'the transfer audit row names the sending rep');
      assert.ok(String(rows[0].details).includes(res.transferNo), 'the audit row names the transfer number');
      console.log('  (S4) inter-van transfer audit row names the sending rep passed');
    }

    // S5 (a). Field return submission through the REAL controller: one
    // audit row naming the submitting rep (linked to the S1 sale).
    {
      const res: any = await controller.submitFieldReturn('Bearer driver', {
        tripId: 1, customerId: 41, saleId, returnReason: 'damaged', refundMethod: 'cash',
        items: [{ productId: 1, qty: 1, unitPrice: 10, saleItemId }],
        notes: 'تالف عند العميل',
      });
      assert.equal(res.ok, true);
      const rows = await auditRows(db, 'VAN_FIELD_RETURN_SUBMITTED');
      assert.equal(rows.length, 1, 'exactly one audit row for the field return submission');
      assert.equal(Number(rows[0].created_by), REP_LINKED_USER_ID, 'the return audit row names the submitting rep');
      assert.ok(String(rows[0].details).includes(res.returnDocNo), 'the audit row names the return document');
      console.log('  (S5) field return submission audit row names the rep passed');
    }

    // S6 (a). Trip settlement submission through the REAL controller:
    // one audit row naming the submitting rep.
    {
      const res: any = await controller.submitTripSettlement('Bearer driver', {
        tripId: 6, countedCash: 100, unloadRemainingToWarehouse: false,
      });
      assert.equal(res.ok, true);
      assert.equal(res.status, 'submitted_by_rep');
      const rows = await auditRows(db, 'VAN_TRIP_SETTLEMENT_SUBMITTED');
      assert.equal(rows.length, 1, 'exactly one audit row for the submitted settlement');
      assert.equal(Number(rows[0].created_by), REP_LINKED_USER_ID, 'the submission audit row names the submitting rep');
      console.log('  (S6) trip settlement submission audit row names the rep passed');
    }

    // S7 (a + c, PIN mode). Driver settle with the shared manager PIN
    // through the REAL controller: the trip records supervisor_id NULL
    // and settled_by NULL (never 0), the notes record the shared-PIN
    // approval method, and the settlement audit row records
    // created_by null while naming the rep and the method. The
    // settlement journal likewise records created_by null, not 0.
    {
      // Collect 50 cash onto trip 7 first so the settlement posts a
      // real journal and a remittance row.
      clearCollectionCaches();
      const coll: any = await controller.recordCollection('Bearer driver', {
        tripId: 7, customerId: 31, amount: 50, paymentMethod: 'cash', clientTxId: 'm18-coll-7',
      });
      assert.equal(coll.ok, true);
      const stockQty = await vanStockQty(db);
      const res: any = await controller.settleTrip('Bearer driver', {
        tripId: 7, countedCash: 50, unloadRemainingToWarehouse: false,
        countedStock: [{ productId: 1, countedQty: stockQty }],
        nightStockApproved: true,
        supervisorPin: SUPERVISOR_PIN,
      });
      assert.equal(res.ok, true);
      const trip = await tripRow(db, 7);
      assert.equal(trip.status, 'settled', 'the trip settled');
      assert.equal(trip.settled_by, null, 'PIN-mode settle records settled_by NULL, never 0');
      assert.equal(trip.supervisor_id, null, 'PIN-mode settle records supervisor_id NULL, never 0');
      assert.equal(trip.night_stock_approved_by, null, 'PIN-mode settle records night_stock_approved_by NULL');
      assert.ok(String(trip.notes || '').includes('رمز المدير المشترك'), 'the trip notes record the shared-PIN approval method');
      const rows = await auditRows(db, 'VAN_TRIP_SETTLEMENT');
      const pinRow = rows.find((r: any) => String(r.details).includes('#7 '));
      assert.ok(pinRow, 'a settlement audit row exists for trip 7');
      assert.equal(pinRow.created_by, null, 'the PIN-mode settlement audit row records created_by NULL');
      assert.ok(String(pinRow.details).includes('رمز المدير المشترك'), 'the audit row names the shared-PIN approval method');
      const journal = await journalFor(db, 'van_trip_settlement', 7);
      assert.ok(journal, 'the settlement posted a journal');
      assert.equal(journal.created_by, null, 'the settlement journal records created_by NULL, not 0');
      assert.equal(journal.posted_by, null, 'the settlement journal records posted_by NULL, not 0');
      console.log('  (S7) PIN-mode settle records no supervisor anywhere passed');
    }

    // S8 (c, account mode). Driver settle with the supervisor's login
    // password through the REAL controller: the identified supervisor
    // (user 2) is recorded everywhere — supervisor_id, settled_by,
    // and the audit row's created_by.
    {
      const stockQty = await vanStockQty(db);
      const res: any = await controller.settleTrip('Bearer driver', {
        tripId: 8, countedCash: 0, unloadRemainingToWarehouse: false,
        countedStock: [{ productId: 1, countedQty: stockQty }],
        nightStockApproved: true,
        supervisorPin: SUPERVISOR_PASSWORD,
      });
      assert.equal(res.ok, true);
      const trip = await tripRow(db, 8);
      assert.equal(trip.status, 'settled', 'the trip settled');
      assert.equal(Number(trip.settled_by), SUPERVISOR_USER_ID, 'account-mode settle records the supervisor as settler');
      assert.equal(Number(trip.supervisor_id), SUPERVISOR_USER_ID, 'account-mode settle records the supervisor id');
      const rows = await auditRows(db, 'VAN_TRIP_SETTLEMENT');
      const accRow = rows.find((r: any) => String(r.details).includes('#8 '));
      assert.ok(accRow, 'a settlement audit row exists for trip 8');
      assert.equal(Number(accRow.created_by), SUPERVISOR_USER_ID, 'the account-mode settlement audit row names the supervisor');
      console.log('  (S8) account-mode settle records the identified supervisor passed');
    }

    // S9 (c, admin console). Admin settle through the REAL admin
    // controller endpoint: the admin session user is the supervisor.
    {
      const stockQty = await vanStockQty(db);
      const res: any = await adminController.settleTripAdmin(
        { authContext: adminAuth } as any, 9,
        {
          repId: 1, countedCash: 0, unloadRemainingToWarehouse: false,
          countedStock: [{ productId: 1, countedQty: stockQty }],
          nightStockApproved: true,
          chargeStockVarianceToRep: false, notes: 'تصفية إدارية',
        },
      );
      assert.equal(res.ok, true);
      const trip = await tripRow(db, 9);
      assert.equal(trip.status, 'settled', 'the trip settled');
      assert.equal(Number(trip.settled_by), FIRST_USER_ID, 'admin settle records the admin as settler');
      assert.equal(Number(trip.supervisor_id), FIRST_USER_ID, 'admin settle records the admin as supervisor');
      const rows = await auditRows(db, 'VAN_TRIP_SETTLEMENT');
      const adminRow = rows.find((r: any) => String(r.details).includes('#9 '));
      assert.ok(adminRow, 'a settlement audit row exists for trip 9');
      assert.equal(Number(adminRow.created_by), FIRST_USER_ID, 'the admin settlement audit row names the admin');
      console.log('  (S9) admin settle records the admin session user passed');
    }

    // S10 (b). A wrong supervisor PIN through the REAL
    // verifySupervisorPin: the suspicion row carries the rep's linked
    // login as created_by (was null on every row before the fix).
    {
      const before = await auditRows(db, 'VAN_SUSPICION_INVALID_PIN');
      assert.equal(before.length, 0, 'no invalid-PIN suspicion rows yet');
      await assert.rejects(
        () => service.verifySupervisorPin(TENANT, '9999', 1, undefined, ACCOUNT),
        /INVALID_SUPERVISOR_PIN/,
      );
      const rows = await auditRows(db, 'VAN_SUSPICION_INVALID_PIN');
      assert.equal(rows.length, 1, 'the invalid PIN wrote one suspicion row');
      assert.equal(Number(rows[0].created_by), REP_LINKED_USER_ID, 'the suspicion row names the rep who entered the PIN');
      const payload = JSON.parse(String(rows[0].details));
      assert.equal(Number(payload.actorUserId), REP_LINKED_USER_ID, 'the suspicion JSON carries the actor id too');
      console.log('  (S10) invalid-PIN suspicion names the rep passed');
    }

    // S11 (b). The rep's own password as supervisor approval is
    // refused (maker-checker), and the self-approval suspicion row
    // carries the rep as its actor.
    {
      const stockQty = await vanStockQty(db);
      await assert.rejects(
        () => controller.settleTrip('Bearer driver', {
          tripId: 10, countedCash: 0, unloadRemainingToWarehouse: false,
          countedStock: [{ productId: 1, countedQty: stockQty }],
          supervisorPin: REP_PASSWORD,
        }),
        /MAKER_CHECKER_SELF_APPROVAL/,
      );
      assert.equal((await tripRow(db, 10)).status, 'open', 'the refused settle leaves the trip open');
      const rows = await auditRows(db, 'VAN_SUSPICION_SELF_APPROVAL');
      assert.equal(rows.length, 1, 'the self-approval attempt wrote one suspicion row');
      assert.equal(Number(rows[0].created_by), REP_LINKED_USER_ID, 'the self-approval row names the rep');
      console.log('  (S11) self-approval suspicion names the rep passed');
    }

    // S12 (b). An explicitly passed actor survives, and a rep with no
    // linked login stays honestly actorless (null, rep named in JSON).
    {
      await service.recordSuspicionEvent({
        tenantId: TENANT, accountId: ACCOUNT, repId: 1,
        eventCode: 'VAN_SUSPICION_PRICE_MANIPULATION', severity: 'high',
        titleAr: 'اختبار فاعل صريح', detailsAr: 'اختبار فاعل صريح',
        actorUserId: FIRST_USER_ID,
      });
      const explicit = await auditRows(db, 'VAN_SUSPICION_PRICE_MANIPULATION');
      assert.equal(explicit.length, 1, 'the explicit-actor suspicion wrote one row');
      assert.equal(Number(explicit[0].created_by), FIRST_USER_ID, 'an explicitly passed actor is kept');
      await service.recordSuspicionEvent({
        tenantId: TENANT, accountId: ACCOUNT, repId: 3,
        eventCode: 'VAN_SUSPICION_GEOFENCE_VIOLATION', severity: 'high',
        titleAr: 'اختبار بلا رابط', detailsAr: 'اختبار بلا رابط',
      });
      const unlinked = await auditRows(db, 'VAN_SUSPICION_GEOFENCE_VIOLATION');
      assert.equal(unlinked.length, 1, 'the unlinked-rep suspicion wrote one row');
      assert.equal(unlinked[0].created_by, null, 'a rep with no linked login records created_by NULL');
      const payload = JSON.parse(String(unlinked[0].details));
      assert.equal(Number(payload.repId), 3, 'the JSON still names the rep');
      assert.equal(payload.actorUserId, null, 'the JSON actor is explicitly null, not borrowed');
      console.log('  (S12) explicit actor kept, unlinked rep honestly null passed');
    }

    // Source pins: the controller no longer fabricates supervisor 0,
    // verifySupervisorPin reports its approval mode, and the service
    // threads the supervisor id + method into settleTrip.
    {
      const here = __dirname;
      const controllerSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.controller.ts'), 'utf8');
      assert.ok(
        !controllerSource.includes('Number(pinVerification.supervisorId || 0)'),
        'the controller no longer fabricates supervisor userId 0',
      );
      assert.ok(
        controllerSource.includes('supervisorApprovalMethod'),
        'the controller passes the approval method explicitly',
      );
      const serviceSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
      assert.ok(
        serviceSource.includes('approvalMode'),
        'verifySupervisorPin reports its approval mode',
      );
      assert.ok(
        serviceSource.includes("eventCode: AUDIT_EVENT_CODES.VAN_FIELD_SALE"),
        'the field sale writes its audit row',
      );
      assert.ok(
        serviceSource.includes("eventCode: AUDIT_EVENT_CODES.VAN_TRIP_SETTLEMENT"),
        'the trip settlement writes its audit row',
      );
      const radarSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-fraud-radar.service.ts'), 'utf8');
      assert.ok(
        radarSource.includes('resolveRepLinkedUserId'),
        'the fraud radar resolves the rep linked login for suspicion rows',
      );
      console.log('  source pins passed');
    }

    console.log('rep-van-money-audit-attribution-m18: all cases passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(async () => {
    console.log('rep-van-money-audit-attribution-m18: all cases passed');
    // Let the piped stdout flush before exiting (process.exit discards it).
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
