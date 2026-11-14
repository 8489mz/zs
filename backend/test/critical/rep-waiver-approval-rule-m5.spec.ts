/*
 * M5 (INV-REP-WAIVER-APPROVAL-RULE) — a waiver of a rep financial item
 * is approved under PD3: a reason is mandatory for every waiver; a
 * waiver above the threshold needs a supervisor PIN; and the waived
 * amount is never approved by whoever decided the load (maker-checker).
 *
 * THE DEFECT (A6): settleRepFinancialItem's waiver branch took only
 * `notes` (optional) and never checked role, maker-checker or PIN —
 * anyone holding one of the three broad permissions could write off a
 * rep shortage of any amount with one click and no recorded reason
 * (VanFinancialLedgerAdminTab.tsx settle modal), posting a real
 * Dr 7200 waiver.
 *
 * THE FIX: in settleRepFinancialItem, the waiver branch first passes
 * assertRepWaiverApproval (inside the same transaction, under the
 * item's FOR UPDATE lock), BEFORE the M4 custody guard — authorization
 * is decided before posting validity, so an unauthorized request is
 * refused as unauthorized, not as a custody problem:
 *  (1) reason mandatory — payload.reason (or notes) must be non-empty,
 *      else REP_WAIVER_REASON_REQUIRED (400); the pre-existing item
 *      notes do NOT count — the reason must be supplied at waiver time;
 *  (2) maker-checker on the ACTOR — the waiving user must differ from
 *      the trip settler (van_sales_trips.settled_by, the supervisor who
 *      decided at settleTrip that the shortage is charged to the rep)
 *      and from the rep himself (rep linked login via phone), else
 *      REP_WAIVER_MAKER_CHECKER (403);
 *  (3) threshold + PIN — above the threshold the supervisor PIN is
 *      verified via the shared authorizeManagerSecret through the
 *      existing verifySupervisorPin (never a plaintext compare, never
 *      the rep's own PIN — account-mode self-approval is already
 *      refused inside verifySupervisorPin); missing PIN is
 *      REP_WAIVER_SUPERVISOR_PIN_REQUIRED (403), a wrong PIN is
 *      INVALID_SUPERVISOR_PIN (403);
 *  (4) maker-checker on the APPROVER — an attributed (account-mode)
 *      supervisor must also differ from the trip settler.
 * The threshold is settings-backed (key repWaiverApprovalThreshold,
 * default 500 in tenant base-currency units, 0 = every waiver needs a
 * PIN) — the Q6 (spirit review, large cash refunds only) equivalent:
 * Q6's threshold is default 500 via posLargeCashRefundThreshold, and
 * the waiver threshold is a separate key so the two limits stay
 * independently settable.
 *
 * WHO "DECIDED THE LOAD": the trip row records no loader
 * (van_sales_trips has no created_by; the load insert records no
 * actor and its stock movements carry userId null), so no
 * maker-checker against the original loader is enforceable from the
 * data. The enforceable decision-maker is the trip settler
 * (settled_by / supervisor_id), who decided at settleTrip whether the
 * shortage is charged to the rep or waived to warehouse losses — that
 * is the load decision this waiver would undo. When the trip row is
 * missing or settled_by is null the settler leg is skipped (nothing
 * recorded to compare against); the rep leg still applies. A shared-PIN
 * approval carries no identity, so the approver leg cannot be checked
 * in PIN mode — the actor leg is then the only enforceable
 * maker-checker check (the same honest limit verifySupervisorPin
 * documents). Actor == approver is NOT refused: PD3's rule is against
 * the load decider, not against the operator also holding the PIN.
 *
 * WHAT IS DRIVEN: the REAL VanSalesAdminController.settleRepFinancialItem
 * (POST api/van-sales/admin/financial-ledger/:id/settle) with a real
 * req.authContext (M13/M14 precedent — a service-level spec cannot
 * catch controller wiring), the REAL settleRepFinancialItem, the REAL
 * postVanTripSettlement that books the charged (Dr 1160 / Cr 1140)
 * trip journals the waiver reverses, the REAL verifySupervisorPin /
 * authorizeManagerSecret (admin login passwords seeded via
 * createPasswordRecord), and the REAL waiver / cash collection
 * postings. GL totals are summed from the posted journal lines, never
 * re-implemented.
 *
 * DECISIONS PINNED HERE: (1) the gate runs before the M4 custody
 * guard (authorization before posting validity); (2) the threshold is
 * a settings key defaulting to 500, not a hardcoded 500, and 0 means
 * every waiver needs a PIN (any positive amount exceeds 0; a zero
 * amount needs none — there is nothing to approve); (3) the boundary
 * is strict: amount == threshold needs no PIN, amount > threshold
 * does; (4) the cash branch is untouched — PD3 is waiver-only, so a
 * cash settle needs no reason and no PIN; (5) settleTrip's own
 * waiver creation (a non-charged shortage created as `waived` at
 * settle time) is a different decision point — it is decided at trip
 * settlement under the supervisor-decision flag and settleTrip's own
 * maker-checker, and is NOT gated here; (6) the approver identity is
 * not stored on the item row (no column for it) — the recorded reason
 * is the audit trail on the row.
 *
 * BASE-RED: at base, cases 1, 3, 4, 6, 7, 8 and 11 pass the settle
 * (a waiver with no reason, no PIN, or by the trip settler succeeds);
 * cases 2, 5, 9 and 10 already pass at base.
 *
 * Run: npx ts-node test/critical/rep-waiver-approval-rule-m5.spec.ts
 * (from backend/). Same PGlite script harness as
 * rep-stock-shortage-custody-guard-m4.spec.ts: one fresh in-memory
 * database per case, db.destroy() teardown only.
 *
 * NOT DRIVEN: a live-Postgres rehearsal; the frontend settle modal
 * (reason + PIN fields, button disabled without them — code-reviewed,
 * no frontend spec harness exists for this tab); a shared-PIN
 * (managerPin setting) approval — the spec drives account-mode PINs
 * (admin login passwords), which is the attributable path; the
 * shared-PIN path runs the same authorizeManagerSecret code.
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
import { createPasswordRecord } from '../../src/core/auth/utils/password-hasher';

const TENANT = 't1';
const ACCOUNT = 'a1';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';
const REASON = 'تسوية إدارية: عجز مقبول بقرار الإدارة';
// Admin 1 settled the trip in every fixture (settled_by = 1); admin 2
// is the second supervisor who may waive it. The rep's linked login
// is user 3 (phone matches the rep row).
const ADMIN_ONE_PASS = 'admin-one-pass';
const ADMIN_TWO_PASS = 'admin-two-pass';
const REP_PASS = 'rep-pass';

function authFor(userId: number, role: string, username: string): AuthContext {
  return {
    userId, sessionId: `spec-m5-${userId}`, username, role,
    permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
  } as unknown as AuthContext;
}
const adminOneAuth = authFor(1, 'admin', 'admin-one');
const adminTwoAuth = authFor(2, 'admin', 'admin-two');
const repAuth = authFor(3, 'cashier', 'rep-user');

function controllerReqFor(auth: AuthContext): any {
  return { authContext: auth } as any;
}

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, display_name text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
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
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
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
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric, title text, note text);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  const adminOne = await createPasswordRecord(ADMIN_ONE_PASS);
  const adminTwo = await createPasswordRecord(ADMIN_TWO_PASS);
  const rep = await createPasswordRecord(REP_PASS);
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin-one', role: 'admin', password_hash: adminOne.hash, password_salt: adminOne.salt, is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'admin-two', role: 'admin', password_hash: adminTwo.hash, password_salt: adminTwo.salt, is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 3, tenant_id: TENANT, username: 'rep-user', phone: '01000000001', role: 'cashier', password_hash: rep.hash, password_salt: rep.salt, is_active: true }).execute();
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
  await anyDb.insertInto('delivery_representatives').values({ id: 4, tenant_id: TENANT, account_id: ACCOUNT, name: 'Rep One', phone: '01000000001', van_location_id: 10 }).execute();
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: openedBy, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, created_at: SHIFT_OPENED_AT,
  }).execute();
}

/** The trip, settled by admin 1 by default (settled_by = 1): admin 1 is
 * the supervisor who decided the shortage is charged to the rep. */
async function seedTrip(db: Kysely<Database>, settledBy: number | null = 1): Promise<void> {
  await (db as any).insertInto('van_sales_trips').values({
    id: 11, tenant_id: TENANT, account_id: ACCOUNT, rep_id: 4, vehicle_id: null,
    start_odometer: 100, end_odometer: null, van_location_id: 10, source_warehouse_id: 10,
    status: 'settled', settlement_status: 'settled', sales_amount: 0, cash_collected: 0,
    credit_sales: 0, returns_amount: 0, cash_refunds: 0,
    settled_by: settledBy, supervisor_id: settledBy,
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
  // Fraud-radar stub: verifySupervisorPin records a suspicion event on
  // a wrong PIN; the real writer needs its own table, which this
  // harness does not seed — the wrong-PIN cases assert the error code,
  // not the suspicion row.
  const fraudRadarStub = { recordSuspicionEvent: async () => {} } as never;
  const van = new VanSalesService(db, audit, {} as never, posting, undefined, undefined, undefined, undefined, undefined, undefined, fraudRadarStub);
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  const controller = new VanSalesAdminController(van, {} as never, {} as never, {} as never, {} as never);
  return { van, drawer, posting, controller };
}

/** The real trip-settlement booking for a stock shortage: charged
 * books Dr 1160 / Cr 1140, uncharged books Dr 7200 / Cr 1140. The
 * waiver under test reverses exactly this journal. */
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
    adminOneAuth,
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

  // 1. Below-threshold waiver WITHOUT a reason is refused: the
  // pre-existing item notes ('shortage fixture') do NOT count as a
  // reason — the reason must be supplied at waiver time. Row stays
  // pending, no journal.
  await check('M5 below-threshold waiver without a reason refused: REP_WAIVER_REASON_REQUIRED, row stays pending', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { controller } = buildServices(db);
      await seedSettlementItem(db, 301, 'cash_shortage', 25);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 301, { method: 'waiver' }),
        (err: any) => err && err.code === 'REP_WAIVER_REASON_REQUIRED',
        'the waiver must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 301)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
      assert.equal((await treasuryRows(db)).length, 0, 'no treasury row');
    } finally {
      await db.destroy();
    }
  });

  // 2. Below-threshold waiver WITH a reason passes (actor admin 2,
  // trip settled by admin 1): the charged custody leg reverses
  // Dr 7200 40 / Cr 1160 40, status waived, the reason is recorded.
  await check('M5 below-threshold waiver with a reason passes: Dr 7200 / Cr 1160, status waived', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { posting, controller } = buildServices(db);
      const tripPosted = await postTripSettlementJournal(db, posting, 40, true);
      assert.equal(tripPosted.posted, true, 'the charged trip journal posts');
      const tripJournal = await journalByCode(db, 'van_trip_settlement', 11);
      assert.equal(tripJournal.get('1160')?.debit, 40, 'trip settlement charged Dr 1160 40 to the rep');
      await seedSettlementItem(db, 302, 'stock_shortage', 40);
      const result: any = await controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 302, { method: 'waiver', notes: REASON });
      assert.equal(result.status, 'waived');
      assert.equal(result.receiptVoucherNo, null);
      assert.ok(Number(result.journalEntryId) > 0, 'the waiver journal id is returned');
      assert.equal((await itemRow(db, 302)).status, 'waived');
      assert.ok(String((await itemRow(db, 302)).notes || '').includes(REASON), 'the reason is recorded on the item');
      assert.equal((await treasuryRows(db)).length, 0, 'a waiver moves no cash');
      const entries = await (db as any).selectFrom('journal_entries').select('id').where('source_type', '=', 'rep_shortage_waiver').execute();
      assert.equal(entries.length, 1, 'exactly one waiver journal');
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'debit'), 40, 'the custody debit is taken to expense');
      assert.equal(await journalLeg(db, Number(entries[0].id), 1160, 'credit'), 40, 'the rep custody balance is cleared');
    } finally {
      await db.destroy();
    }
  });

  // 3. Above-threshold (600 > 500) waiver WITHOUT a PIN is refused,
  // even with a reason. Row stays pending, no journal.
  await check('M5 above-threshold waiver without a PIN refused: REP_WAIVER_SUPERVISOR_PIN_REQUIRED, row stays pending', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { posting, controller } = buildServices(db);
      await postTripSettlementJournal(db, posting, 600, true);
      await seedSettlementItem(db, 303, 'stock_shortage', 600);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 303, { method: 'waiver', notes: REASON }),
        (err: any) => err && err.code === 'REP_WAIVER_SUPERVISOR_PIN_REQUIRED',
        'the waiver must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 303)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
    } finally {
      await db.destroy();
    }
  });

  // 4. Above-threshold waiver with a WRONG PIN is refused
  // (INVALID_SUPERVISOR_PIN from the shared authorizeManagerSecret).
  await check('M5 above-threshold waiver with a wrong PIN refused: INVALID_SUPERVISOR_PIN, row stays pending', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { posting, controller } = buildServices(db);
      await postTripSettlementJournal(db, posting, 600, true);
      await seedSettlementItem(db, 304, 'stock_shortage', 600);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 304, { method: 'waiver', notes: REASON, supervisorPin: 'wrong-pin-000' }),
        (err: any) => err && err.code === 'INVALID_SUPERVISOR_PIN',
        'the waiver must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 304)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
    } finally {
      await db.destroy();
    }
  });

  // 5. Above-threshold waiver with a VALID supervisor PIN + reason
  // passes: actor admin 2 presents admin 2's own login password
  // (account mode, supervisorId 2 — not the trip settler 1).
  await check('M5 above-threshold waiver with a valid supervisor PIN + reason passes: Dr 7200 600 / Cr 1160 600', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { posting, controller } = buildServices(db);
      await postTripSettlementJournal(db, posting, 600, true);
      const tripJournal = await journalByCode(db, 'van_trip_settlement', 11);
      assert.equal(tripJournal.get('1160')?.debit, 600, 'trip settlement charged Dr 1160 600 to the rep');
      await seedSettlementItem(db, 305, 'stock_shortage', 600);
      const result: any = await controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 305, { method: 'waiver', notes: REASON, supervisorPin: ADMIN_TWO_PASS });
      assert.equal(result.status, 'waived');
      assert.ok(Number(result.journalEntryId) > 0, 'the waiver journal id is returned');
      assert.equal((await itemRow(db, 305)).status, 'waived');
      assert.ok(String((await itemRow(db, 305)).notes || '').includes(REASON), 'the reason is recorded on the item');
      const entries = await (db as any).selectFrom('journal_entries').select('id').where('source_type', '=', 'rep_shortage_waiver').execute();
      assert.equal(entries.length, 1, 'exactly one waiver journal');
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'debit'), 600);
      assert.equal(await journalLeg(db, Number(entries[0].id), 1160, 'credit'), 600);
    } finally {
      await db.destroy();
    }
  });

  // 6. Maker-checker on the APPROVER: above threshold, actor admin 2
  // presents the TRIP SETTLER's (admin 1) password — a valid PIN, but
  // the approver is the user who decided the load, so the waiver is
  // refused even with a PIN.
  await check('M5 waiver approved by the load decision-maker refused: REP_WAIVER_MAKER_CHECKER, even with a valid PIN', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { posting, controller } = buildServices(db);
      await postTripSettlementJournal(db, posting, 600, true);
      await seedSettlementItem(db, 306, 'stock_shortage', 600);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 306, { method: 'waiver', notes: REASON, supervisorPin: ADMIN_ONE_PASS }),
        (err: any) => err && err.code === 'REP_WAIVER_MAKER_CHECKER',
        'the waiver must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 306)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
    } finally {
      await db.destroy();
    }
  });

  // 7. Maker-checker on the ACTOR: below threshold, the trip settler
  // (admin 1) waives with a reason and no PIN — refused, because the
  // settler may never waive his own load decision.
  await check('M5 waiver by the trip settler refused: REP_WAIVER_MAKER_CHECKER, below threshold with a reason', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { controller } = buildServices(db);
      await seedSettlementItem(db, 307, 'cash_shortage', 25);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReqFor(adminOneAuth), 307, { method: 'waiver', notes: REASON }),
        (err: any) => err && err.code === 'REP_WAIVER_MAKER_CHECKER',
        'the waiver must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 307)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
    } finally {
      await db.destroy();
    }
  });

  // 8. Maker-checker on the ACTOR (rep leg): the rep's own linked
  // login (user 3, phone matches the rep row) waives his own shortage
  // with a reason — refused.
  await check('M5 waiver by the rep himself refused: REP_WAIVER_MAKER_CHECKER', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { controller } = buildServices(db);
      await seedSettlementItem(db, 308, 'cash_shortage', 25);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReqFor(repAuth), 308, { method: 'waiver', notes: REASON }),
        (err: any) => err && err.code === 'REP_WAIVER_MAKER_CHECKER',
        'the waiver must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 308)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
    } finally {
      await db.destroy();
    }
  });

  // 9. Cash-settle path unaffected (PD3 is waiver-only): a cash settle
  // of a charged shortage needs no reason and no PIN, even above the
  // threshold — it collects real cash, it does not write anything off.
  await check('M5 cash-settle path unaffected: no reason, no PIN, status settled', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { drawer, posting, controller } = buildServices(db);
      await postTripSettlementJournal(db, posting, 40, true);
      await seedSettlementItem(db, 309, 'stock_shortage', 40);
      const result: any = await controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 309, { method: 'cash' });
      assert.equal(result.status, 'settled');
      assert.equal(result.receiptVoucherNo, formatDailyDocumentNumber('REC', 309), 'the voucher is deterministic, never random');
      assert.ok(Number(result.journalEntryId) > 0, 'the journal id is returned');
      const rows = await treasuryRows(db);
      assert.equal(rows.length, 1, 'exactly one treasury row for the collection');
      assert.equal(Number(rows[0].amount), 40);
      assert.equal(await drawer.computeShiftExpectedCash(1, adminTwoAuth), 40, 'the receiving shift expects the collected cash');
      assert.equal((await itemRow(db, 309)).status, 'settled');
    } finally {
      await db.destroy();
    }
  });

  // 10. Boundary: amount exactly AT the threshold (500) with a reason
  // and no PIN passes — the PIN is required only ABOVE the threshold.
  await check('M5 boundary: amount exactly 500 with a reason and no PIN passes', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { posting, controller } = buildServices(db);
      await postTripSettlementJournal(db, posting, 500, true);
      await seedSettlementItem(db, 310, 'stock_shortage', 500);
      const result: any = await controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 310, { method: 'waiver', notes: REASON });
      assert.equal(result.status, 'waived');
      assert.equal((await itemRow(db, 310)).status, 'waived');
      const entries = await (db as any).selectFrom('journal_entries').select('id').where('source_type', '=', 'rep_shortage_waiver').execute();
      assert.equal(entries.length, 1, 'exactly one waiver journal');
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'debit'), 500);
      assert.equal(await journalLeg(db, Number(entries[0].id), 1160, 'credit'), 500);
    } finally {
      await db.destroy();
    }
  });

  // 11. Zero threshold setting (0 = every waiver needs a PIN): a
  // below-threshold amount with a reason but no PIN is refused; the
  // same item then passes with a valid supervisor PIN.
  await check('M5 zero threshold: every waiver needs a PIN; refusal then passes with a valid PIN', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'repWaiverApprovalThreshold', value: '0' }).execute();
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { controller } = buildServices(db);
      await seedSettlementItem(db, 311, 'cash_shortage', 40);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 311, { method: 'waiver', notes: REASON }),
        (err: any) => err && err.code === 'REP_WAIVER_SUPERVISOR_PIN_REQUIRED',
        'with a zero threshold the waiver must fail closed without a PIN',
      );
      assert.equal((await itemRow(db, 311)).status, 'pending', 'the row stays pending after the refused attempt');
      const result: any = await controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 311, { method: 'waiver', notes: REASON, supervisorPin: ADMIN_TWO_PASS });
      assert.equal(result.status, 'waived');
      assert.equal((await itemRow(db, 311)).status, 'waived');
    } finally {
      await db.destroy();
    }
  });

  // 12. Source pins: the gate exists in the settle path, the error
  // codes are named, the threshold key and the shared PIN verifier
  // are the ones being used, and the M4 custody guard still runs
  // after the gate (the waiver branch still calls it).
  {
    const here = __dirname;
    const vanSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/services/van-rep-financial-ledger.service.ts'), 'utf8');
    assert.ok(vanSource.includes('INV-REP-WAIVER-APPROVAL-RULE'), 'the settle names the waiver-approval invariant');
    assert.ok(vanSource.includes('REP_WAIVER_REASON_REQUIRED'), 'the reason-required code is named');
    assert.ok(vanSource.includes('REP_WAIVER_SUPERVISOR_PIN_REQUIRED'), 'the PIN-required code is named');
    assert.ok(vanSource.includes('REP_WAIVER_MAKER_CHECKER'), 'the maker-checker code is named');
    assert.ok(vanSource.includes('repWaiverApprovalThreshold'), 'the threshold settings key is named');
    assert.ok(vanSource.includes('verifySupervisorPin'), 'the waiver gate verifies via the shared supervisor PIN');
    assert.ok(vanSource.includes('assertRepStockShortageCustodyLeg'), 'the M4 custody guard is still called');
    assert.equal(
      vanSource.split('assertRepWaiverApproval(').length - 1,
      2,
      'the gate is defined once and called from the waiver branch',
    );
    const controllerSource = readFileSync(resolve(here, '../../src/modules/delivery-reps/van-sales.controller.ts'), 'utf8');
    assert.ok(controllerSource.includes('supervisorPin'), 'the controller forwards the supervisor PIN');
    assert.ok(controllerSource.includes('req.authContext!'), 'the controller forwards the real auth context');
    console.log('  PASS M5 source pins');
  }

  if (failures.length) throw new Error(`${failures.length} M5 case(s) failed: ${failures.join(', ')}`);
  console.log('M5 rep waiver-approval-rule tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
