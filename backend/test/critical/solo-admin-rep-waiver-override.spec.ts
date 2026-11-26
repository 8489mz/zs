/*
 * S4 (INV-SOLO-ADMIN-REP-WAIVER-OVERRIDE) — an admin who settled
 * a van trip may approve the rep shortage waiver alone, with a logged
 * override. No second-manager approval may block any admin, ever
 * (INV-SECOND-MANAGER-PASSWORD-REMOVED) — the override applies whether or not
 * a second admin exists in the tenant.
 *
 * THE DEFECT (S4): assertRepWaiverApproval refused the trip settler
 * as actor (REP_WAIVER_MAKER_CHECKER, 403) and refused an attributed
 * approver equal to the settler, with no escape — a shop with one
 * admin, who necessarily settled the trip himself, could never waive
 * a rep shortage at all. The shared-PIN settlement path was already
 * passable (settled_by null skips the settler leg), so the block bit
 * exactly the attributed, accountable settlement.
 *
 * THE FIX: the two maker-checker legs consult the shared exported
 * isSoloAdminOverride helper (manager-approval.ts, created by P5 —
 * no third copy): the leg is excused only when the actor is an
 * admin/super_admin AND no OTHER active admin/super_admin exists in
 * the tenant, and only for the SAME person — the actor leg when the
 * actor is the settler, the approver leg when the attributed approver
 * is the actor himself (supervisorId === actorUserId). The rep leg
 * (the rep waiving his own shortage) is never excused, the reason
 * stays mandatory (checked first, before any override logic), and
 * the threshold + supervisor PIN still apply above the threshold —
 * the solo admin presents his own password as the PIN, which is the
 * attributed approval the approver leg then excuses. The override is
 * never silent: the waived item's notes carry a stamp naming who
 * settled, who approved, the shortage amount, and that no second
 * admin was available, and one audit_logs row (event code
 * REP_WAIVER_SOLO_ADMIN_OVERRIDE, same transaction) records the same
 * four facts. The stamp appears only when the override actually
 * bites — a waiver that passes without it (different admin, or a
 * shared-PIN settlement with settled_by null) carries no stamp.
 *
 * WHAT IS DRIVEN: the REAL VanSalesAdminController.settleRepFinancialItem
 * (POST api/van-sales/admin/financial-ledger/:id/settle) with a real
 * req.authContext, the REAL settleRepFinancialItem, the REAL
 * postVanTripSettlement that books the charged (Dr 1160 / Cr 1140)
 * trip journals the waiver reverses, the REAL verifySupervisorPin /
 * authorizeManagerSecret (admin login passwords seeded via
 * createPasswordRecord), and the REAL waiver postings. GL totals are
 * summed from the posted journal lines, never re-implemented. The
 * harness is the M5 harness (rep-waiver-approval-rule-m5.spec.ts)
 * with one parameter: seedFoundation(db, withSecondAdmin) — the
 * solo-tenant cases seed admin 1 only.
 *
 * DECISIONS PINNED HERE: (1) the override excuses only the SAME
 * person being settler + actor (+ approver above the threshold): a
 * cashier actor whose PIN approver is the settler still refuses —
 * fail-closed, out of scope; the admin does it by being the
 * actor himself; (2) the gate computes the override lazily, only
 * when a leg would otherwise refuse — a waiver by a different admin
 * costs no extra query and behaves byte-identically; (3) the stamp
 * and the audit row are written in the same transaction as the
 * waiver, so a rolled-back waiver leaves no override record behind;
 * (4) the reason stays mandatory and is checked before the override;
 * (5) shared-PIN settlement (settled_by null) is unchanged — the
 * settler leg is skipped as before and no stamp is written, because
 * no maker-checker leg bit.
 *
 * BASE-RED: at base, cases 1 and 4 fail with the exact old refusal
 * REP_WAIVER_MAKER_CHECKER (the solo settler is refused below the
 * threshold as actor, and above the threshold as approver); cases
 * 2, 3, 5, 6, 7 and 8 already pass at base.
 *
 * Run: npx ts-node test/critical/solo-admin-rep-waiver-override.spec.ts
 * (from backend/). Same PGlite script harness as
 * rep-waiver-approval-rule-m5.spec.ts: one fresh in-memory
 * database per case, db.destroy() teardown only.
 *
 * NOT DRIVEN: a live-Postgres rehearsal; the frontend settle modal
 * (no frontend change — the modal already sends reason + PIN, and
 * the solo admin now succeeds where he was refused); a shared-PIN
 * (managerPin setting) approval above the threshold — the spec
 * drives account-mode PINs (admin login passwords), which is the
 * attributable path; the shared-PIN path runs the same
 * authorizeManagerSecret code.
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
import { VanSalesAdminController } from '../../src/modules/delivery-reps/van-sales-admin.controller';
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
    userId,
    sessionId: `spec-m5-${userId}`,
    username,
    role,
    permissions: ['deliveryReps', 'accounting'],
    tenantId: TENANT,
    accountId: ACCOUNT,
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

async function seedFoundation(db: Kysely<Database>, withSecondAdmin = true): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  const adminOne = await createPasswordRecord(ADMIN_ONE_PASS);
  const adminTwo = await createPasswordRecord(ADMIN_TWO_PASS);
  const rep = await createPasswordRecord(REP_PASS);
  await anyDb
    .insertInto('users')
    .values({
      id: 1,
      tenant_id: TENANT,
      username: 'admin-one',
      role: 'admin',
      password_hash: adminOne.hash,
      password_salt: adminOne.salt,
      is_active: true,
    })
    .execute();
  if (withSecondAdmin)
    await anyDb
      .insertInto('users')
      .values({
        id: 2,
        tenant_id: TENANT,
        username: 'admin-two',
        role: 'admin',
        password_hash: adminTwo.hash,
        password_salt: adminTwo.salt,
        is_active: true,
      })
      .execute();
  await anyDb
    .insertInto('users')
    .values({
      id: 3,
      tenant_id: TENANT,
      username: 'rep-user',
      phone: '01000000001',
      role: 'cashier',
      password_hash: rep.hash,
      password_salt: rep.salt,
      is_active: true,
    })
    .execute();
  const accounts: Array<[number, string]> = [
    [1110, '1110'],
    [1120, '1120'],
    [1130, '1130'],
    [1140, '1140'],
    [1160, '1160'],
    [2120, '2120'],
    [4100, '4100'],
    [4300, '4300'],
    [5100, '5100'],
    [6400, '6400'],
    [7100, '7100'],
    [7200, '7200'],
  ];
  for (const [id, code] of accounts) {
    await anyDb
      .insertInto('accounting_accounts')
      .values({ id, tenant_id: TENANT, code, name_ar: code, is_active: true, is_tax: false })
      .execute();
  }
  await anyDb
    .insertInto('accounting_settings')
    .values({
      id: 1,
      tenant_id: TENANT,
      cash_account_id: 1110,
      bank_account_id: 1120,
      customer_receivable_account_id: 1130,
      inventory_account_id: 1140,
      sales_revenue_account_id: 4100,
      sales_discount_account_id: 4300,
      cogs_account_id: 5100,
      sales_tax_account_id: 2120,
    })
    .execute();
  await anyDb
    .insertInto('branches')
    .values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10 })
    .execute();
  await anyDb
    .insertInto('stock_locations')
    .values({
      id: 10,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      name: 'Van',
      location_type: 'van',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('delivery_representatives')
    .values({
      id: 4,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Rep One',
      phone: '01000000001',
      van_location_id: 10,
    })
    .execute();
}

async function seedShift(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any)
    .insertInto('cashier_shifts')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      doc_no: `SHIFT-${id}`,
      opened_by: openedBy,
      status: 'open',
      branch_id: 1,
      location_id: 10,
      opening_cash: 0,
      expected_cash: 0,
      created_at: SHIFT_OPENED_AT,
    })
    .execute();
}

/** The trip, settled by admin 1 by default (settled_by = 1): admin 1 is
 * the supervisor who decided the shortage is charged to the rep. */
async function seedTrip(db: Kysely<Database>, settledBy: number | null = 1): Promise<void> {
  await (db as any)
    .insertInto('van_sales_trips')
    .values({
      id: 11,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      rep_id: 4,
      vehicle_id: null,
      start_odometer: 100,
      end_odometer: null,
      van_location_id: 10,
      source_warehouse_id: 10,
      status: 'settled',
      settlement_status: 'settled',
      sales_amount: 0,
      cash_collected: 0,
      credit_sales: 0,
      returns_amount: 0,
      cash_refunds: 0,
      settled_by: settledBy,
      supervisor_id: settledBy,
    })
    .execute();
}

async function seedSettlementItem(db: Kysely<Database>, id: number, entryType: string, amount: number): Promise<void> {
  await (db as any)
    .insertInto('van_rep_financial_settlements')
    .values({
      id,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      rep_id: 4,
      trip_id: 11,
      entry_type: entryType,
      amount,
      status: 'pending',
      notes: 'shortage fixture',
    })
    .execute();
}

function buildServices(db: Kysely<Database>): {
  van: VanSalesService;
  drawer: CashDrawerService;
  posting: AccountingPostingService;
  controller: VanSalesAdminController;
} {
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
  const van = new VanSalesService(
    db,
    audit,
    {} as never,
    posting,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fraudRadarStub,
  );
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

async function journalByCode(
  db: Kysely<Database>,
  sourceType: string,
  sourceId: number,
): Promise<Map<string, { debit: number; credit: number }>> {
  const entries = await (db as any)
    .selectFrom('journal_entries')
    .select('id')
    .where('source_type', '=', sourceType)
    .where('source_id', '=', sourceId)
    .execute();
  assert.equal(entries.length, 1, `expected exactly one ${sourceType} journal for ${sourceId}`);
  const rows = await (db as any)
    .selectFrom('journal_entry_lines as l')
    .innerJoin('accounting_accounts as a', 'a.id', 'l.account_id')
    .select(['a.code as code', 'l.debit as debit', 'l.credit as credit'])
    .where('l.journal_entry_id', '=', Number(entries[0].id))
    .execute();
  const byCode = new Map<string, { debit: number; credit: number }>();
  for (const row of rows) {
    const code = String((row as any).code);
    const prev = byCode.get(code) || { debit: 0, credit: 0 };
    byCode.set(code, {
      debit: prev.debit + Number((row as any).debit || 0),
      credit: prev.credit + Number((row as any).credit || 0),
    });
  }
  return byCode;
}

async function journalCount(db: Kysely<Database>, sourceType: string): Promise<number> {
  const rows = await (db as any)
    .selectFrom('journal_entries')
    .select('id')
    .where('source_type', '=', sourceType)
    .execute();
  return rows.length;
}

async function journalLeg(
  db: Kysely<Database>,
  entryId: number,
  accountId: number,
  side: 'debit' | 'credit',
): Promise<number> {
  const rows = await (db as any)
    .selectFrom('journal_entry_lines')
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
  return (db as any)
    .selectFrom('van_rep_financial_settlements')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
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

  // The override stamp, pinned exactly (amount interpolated per case):
  // who settled, who approved, the shortage amount, and that no second
  // admin was available. It is appended to the waived item's notes.
  const stampFor = (amount: number): string =>
    ` — اعتماد منفرد بقرار إداري — سوّى admin-one الرحلة واعتمد إعفاء عجز ${amount} بنفسه`;

  async function overrideAuditRows(db: Kysely<Database>): Promise<Array<Record<string, any>>> {
    return (await auditRows(db)).filter(
      (r) => String((r as any).event_code || '') === 'REP_WAIVER_SOLO_ADMIN_OVERRIDE',
    );
  }

  // 1. Solo admin settler waives his own trip's stock shortage below
  // the threshold with a reason: allowed, Dr 7200 / Cr 1160, status
  // waived, the override stamp on the item, one audit row.
  await check(
    'S4 solo-admin settler waives own-trip shortage below threshold: allowed, stamped + audited',
    async () => {
      const { pg, db } = await makeDb();
      try {
        await seedFoundation(db, false);
        await seedShift(db, 1, 1);
        await seedTrip(db);
        const { posting, controller } = buildServices(db);
        const tripPosted = await postTripSettlementJournal(db, posting, 40, true);
        assert.equal(tripPosted.posted, true, 'the charged trip journal posts');
        const tripJournal = await journalByCode(db, 'van_trip_settlement', 11);
        assert.equal(tripJournal.get('1160')?.debit, 40, 'trip settlement charged Dr 1160 40 to the rep');
        await seedSettlementItem(db, 401, 'stock_shortage', 40);
        const result: any = await controller.settleRepFinancialItem(controllerReqFor(adminOneAuth), 401, {
          method: 'waiver',
          notes: REASON,
        });
        assert.equal(result.status, 'waived');
        assert.ok(Number(result.journalEntryId) > 0, 'the waiver journal id is returned');
        assert.equal((await itemRow(db, 401)).status, 'waived');
        const notes = String((await itemRow(db, 401)).notes || '');
        assert.ok(notes.includes(REASON), 'the reason is recorded on the item');
        assert.ok(notes.includes(stampFor(40)), 'the solo-override stamp is on the item');
        const entries = await (db as any)
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'rep_shortage_waiver')
          .execute();
        assert.equal(entries.length, 1, 'exactly one waiver journal');
        assert.equal(
          await journalLeg(db, Number(entries[0].id), 7200, 'debit'),
          40,
          'the custody debit is taken to expense',
        );
        assert.equal(
          await journalLeg(db, Number(entries[0].id), 1160, 'credit'),
          40,
          'the rep custody balance is cleared',
        );
        const overrides = await overrideAuditRows(db);
        assert.equal(overrides.length, 1, 'exactly one solo-override audit row');
        assert.equal(Number(overrides[0].created_by), 1, 'the audit row attributes the solo admin');
        assert.ok(
          String(overrides[0].details || '').includes('admin-one'),
          'the audit row names who settled and approved',
        );
        assert.ok(String(overrides[0].details || '').includes('40'), 'the audit row names the shortage amount');
        assert.ok(
          !String(overrides[0].details || '').includes('ثانٍ'),
          'the audit row must carry no second-manager reference at all',
        );
      } finally {
        await db.destroy();
      }
    },
  );

  // 2. Second admin present: the settler waiving his own trip's
  // shortage is now allowed, stamped + audited (a cash-shortage
  // waiver posts no reversal journal — only stock shortages do).
  await check('S4 second admin present: settler self-waiver now allowed, stamped + audited', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, true);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { controller } = buildServices(db);
      await seedSettlementItem(db, 402, 'cash_shortage', 25);
      const result: any = await controller.settleRepFinancialItem(controllerReqFor(adminOneAuth), 402, {
        method: 'waiver',
        notes: REASON,
      });
      assert.equal(result.status, 'waived');
      assert.equal((await itemRow(db, 402)).status, 'waived');
      const notes = String((await itemRow(db, 402)).notes || '');
      assert.ok(notes.includes(REASON), 'the reason is recorded on the item');
      assert.ok(notes.includes(stampFor(25)), 'the solo-override stamp is on the item');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'a cash-shortage waiver posts no journal');
      const overrides = await overrideAuditRows(db);
      assert.equal(overrides.length, 1, 'exactly one solo-override audit row');
      assert.equal(Number(overrides[0].created_by), 1, 'the audit row attributes the solo admin');
      assert.ok(
        String(overrides[0].details || '').includes('admin-one'),
        'the audit row names who settled and approved',
      );
      assert.ok(String(overrides[0].details || '').includes('25'), 'the audit row names the shortage amount');
      assert.ok(
        !String(overrides[0].details || '').includes('ثانٍ'),
        'the audit row must carry no second-manager reference at all',
      );
    } finally {
      await db.destroy();
    }
  });

  // 3. Second admin present: a DIFFERENT admin waives with a reason
  // exactly as before (M5 case 2 verbatim) — and no stamp, because
  // no override bit.
  await check('S4 second admin present: different-admin waiver works as before, no stamp', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, true);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { posting, controller } = buildServices(db);
      const tripPosted = await postTripSettlementJournal(db, posting, 40, true);
      assert.equal(tripPosted.posted, true, 'the charged trip journal posts');
      await seedSettlementItem(db, 403, 'stock_shortage', 40);
      const result: any = await controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 403, {
        method: 'waiver',
        notes: REASON,
      });
      assert.equal(result.status, 'waived');
      assert.ok(Number(result.journalEntryId) > 0, 'the waiver journal id is returned');
      assert.equal((await itemRow(db, 403)).status, 'waived');
      const notes = String((await itemRow(db, 403)).notes || '');
      assert.ok(notes.includes(REASON), 'the reason is recorded on the item');
      assert.ok(!notes.includes('اعتماد منفرد'), 'no override stamp when a different admin waives');
      const entries = await (db as any)
        .selectFrom('journal_entries')
        .select('id')
        .where('source_type', '=', 'rep_shortage_waiver')
        .execute();
      assert.equal(entries.length, 1, 'exactly one waiver journal');
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'debit'), 40);
      assert.equal(await journalLeg(db, Number(entries[0].id), 1160, 'credit'), 40);
      assert.equal((await overrideAuditRows(db)).length, 0, 'no override audit row when a different admin waives');
    } finally {
      await db.destroy();
    }
  });

  // 4. Above threshold (600 > 500): the solo admin settler presents
  // his OWN password as the supervisor PIN — the approver leg would
  // refuse him as the settler, but the solo override excuses the
  // same-person approver too. Allowed, stamped, audited.
  await check('S4 solo-admin settler above threshold with own PIN: allowed, stamped + audited', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, false);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { posting, controller } = buildServices(db);
      await postTripSettlementJournal(db, posting, 600, true);
      const tripJournal = await journalByCode(db, 'van_trip_settlement', 11);
      assert.equal(tripJournal.get('1160')?.debit, 600, 'trip settlement charged Dr 1160 600 to the rep');
      await seedSettlementItem(db, 404, 'stock_shortage', 600);
      const result: any = await controller.settleRepFinancialItem(controllerReqFor(adminOneAuth), 404, {
        method: 'waiver',
        notes: REASON,
        supervisorPin: ADMIN_ONE_PASS,
      });
      assert.equal(result.status, 'waived');
      assert.ok(Number(result.journalEntryId) > 0, 'the waiver journal id is returned');
      assert.equal((await itemRow(db, 404)).status, 'waived');
      const notes = String((await itemRow(db, 404)).notes || '');
      assert.ok(notes.includes(REASON), 'the reason is recorded on the item');
      assert.ok(notes.includes(stampFor(600)), 'the solo-override stamp is on the item');
      const entries = await (db as any)
        .selectFrom('journal_entries')
        .select('id')
        .where('source_type', '=', 'rep_shortage_waiver')
        .execute();
      assert.equal(entries.length, 1, 'exactly one waiver journal');
      assert.equal(await journalLeg(db, Number(entries[0].id), 7200, 'debit'), 600);
      assert.equal(await journalLeg(db, Number(entries[0].id), 1160, 'credit'), 600);
      const overrides = await overrideAuditRows(db);
      assert.equal(overrides.length, 1, 'exactly one solo-override audit row');
      assert.equal(Number(overrides[0].created_by), 1, 'the audit row attributes the solo admin');
      assert.ok(String(overrides[0].details || '').includes('600'), 'the audit row names the shortage amount');
    } finally {
      await db.destroy();
    }
  });

  // 5. Above threshold, second admin present: actor admin 2 presents
  // the TRIP SETTLER's (admin 1) password — a valid PIN, but the
  // approver is the load decision-maker and is NOT the actor, so the
  // solo override does not excuse him (M5 case 6 verbatim). This
  // refusal is the approver-identity rule (the approver must differ
  // from the settler), NOT a second-admin requirement: admin 2 is
  // not blocked from waiving — he waives with his own PIN (case 3).
  // INV-SECOND-MANAGER-PASSWORD-REMOVED changes nothing here.
  await check(
    'S4 second admin present: settler-as-approver still refused REP_WAIVER_MAKER_CHECKER, even with a valid PIN',
    async () => {
      const { pg, db } = await makeDb();
      try {
        await seedFoundation(db, true);
        await seedShift(db, 1, 1);
        await seedTrip(db);
        const { posting, controller } = buildServices(db);
        await postTripSettlementJournal(db, posting, 600, true);
        await seedSettlementItem(db, 405, 'stock_shortage', 600);
        await assert.rejects(
          () =>
            controller.settleRepFinancialItem(controllerReqFor(adminTwoAuth), 405, {
              method: 'waiver',
              notes: REASON,
              supervisorPin: ADMIN_ONE_PASS,
            }),
          (err: any) => err && err.code === 'REP_WAIVER_MAKER_CHECKER',
          'the waiver must fail closed with the specific code',
        );
        assert.equal((await itemRow(db, 405)).status, 'pending', 'the row stays pending for manual review');
        assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
        assert.equal((await overrideAuditRows(db)).length, 0, 'no override audit row on a refused waiver');
      } finally {
        await db.destroy();
      }
    },
  );

  // 6. Shared-PIN settlement (settled_by null): the settler leg is
  // skipped as before, so the solo admin waives below threshold with
  // a reason and NO stamp — the override never bit, and the
  // shared-PIN behavior is unchanged.
  await check('S4 shared-PIN settlement (settled_by null): solo admin waives with no stamp', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, false);
      await seedShift(db, 1, 1);
      await seedTrip(db, null);
      const { controller } = buildServices(db);
      await seedSettlementItem(db, 406, 'cash_shortage', 25);
      const result: any = await controller.settleRepFinancialItem(controllerReqFor(adminOneAuth), 406, {
        method: 'waiver',
        notes: REASON,
      });
      assert.equal(result.status, 'waived');
      assert.equal((await itemRow(db, 406)).status, 'waived');
      const notes = String((await itemRow(db, 406)).notes || '');
      assert.ok(notes.includes(REASON), 'the reason is recorded on the item');
      assert.ok(!notes.includes('اعتماد منفرد'), 'no override stamp when the settler leg was skipped');
      assert.equal((await overrideAuditRows(db)).length, 0, 'no override audit row when the settler leg was skipped');
    } finally {
      await db.destroy();
    }
  });

  // 7. Rep leg unchanged in a solo-tenant: the rep's own linked login
  // waives his own shortage with a reason — refused, no stamp.
  await check('S4 rep waiving his own shortage still refused: REP_WAIVER_MAKER_CHECKER, even solo-tenant', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, false);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { controller } = buildServices(db);
      await seedSettlementItem(db, 407, 'cash_shortage', 25);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReqFor(repAuth), 407, { method: 'waiver', notes: REASON }),
        (err: any) => err && err.code === 'REP_WAIVER_MAKER_CHECKER',
        'the waiver must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 407)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
      assert.equal((await overrideAuditRows(db)).length, 0, 'no override audit row on a refused waiver');
    } finally {
      await db.destroy();
    }
  });

  // 8. Reason still mandatory for the solo settler: a waiver with no
  // reason is refused before any override logic runs.
  await check('S4 solo-admin settler waiver without a reason still refused: REP_WAIVER_REASON_REQUIRED', async () => {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, false);
      await seedShift(db, 1, 1);
      await seedTrip(db);
      const { controller } = buildServices(db);
      await seedSettlementItem(db, 408, 'cash_shortage', 25);
      await assert.rejects(
        () => controller.settleRepFinancialItem(controllerReqFor(adminOneAuth), 408, { method: 'waiver' }),
        (err: any) => err && err.code === 'REP_WAIVER_REASON_REQUIRED',
        'the waiver must fail closed with the specific code',
      );
      assert.equal((await itemRow(db, 408)).status, 'pending', 'the row stays pending for manual review');
      assert.equal(await journalCount(db, 'rep_shortage_waiver'), 0, 'no waiver journal is posted');
      assert.equal((await overrideAuditRows(db)).length, 0, 'no override audit row on a refused waiver');
    } finally {
      await db.destroy();
    }
  });

  // 9. Wiring: this spec is in both critical lists, in identical order (363 specs — the purchases-writer spec is the last entry).
  {
    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 371);
    assert.equal(chain.length, 371);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/solo-admin-rep-waiver-override.spec.ts'));
    console.log('wiring: evidence spec in both critical lists (371 = 371, identical order), passed');
  }

  // 10. Source pins: the override reuses the shared helper (no third
  // copy), the gate is defined once (S3) and called from the waiver
  // branch (S2), the service forwards the auth context, and the
  // stamp + audit event code are named in the settle path.
  {
    const here = __dirname;
    const s2Source = readFileSync(
      resolve(
        here,
        '../../src/modules/delivery-reps/services/van-rep-financial-ledger/settle-rep-financial-item.slice.ts',
      ),
      'utf8',
    );
    const s3Source = readFileSync(
      resolve(here, '../../src/modules/delivery-reps/services/van-rep-financial-ledger/rep-waiver-cluster.slice.ts'),
      'utf8',
    );
    const serviceSource = readFileSync(
      resolve(here, '../../src/modules/delivery-reps/services/van-rep-financial-ledger.service.ts'),
      'utf8',
    );
    const helperSource = readFileSync(resolve(here, '../../src/common/utils/manager-approval.ts'), 'utf8');
    const vanSource = s2Source + s3Source;
    assert.ok(
      vanSource.includes('INV-SOLO-ADMIN-REP-WAIVER-OVERRIDE'),
      'the settle names the solo-admin rep-waiver override invariant',
    );
    assert.ok(
      vanSource.includes('INV-REP-WAIVER-APPROVAL-RULE'),
      'the settle still names the waiver-approval invariant',
    );
    assert.ok(s3Source.includes('isSoloAdminOverride'), 'the waiver gate consults the shared solo-admin helper');
    assert.ok(
      s3Source.includes("from '../../../../common/utils/manager-approval'"),
      'the waiver gate imports the shared helper, it does not redefine it',
    );
    assert.ok(
      helperSource.split('export async function isSoloAdminOverride').length - 1 === 1,
      'the shared helper is defined exactly once',
    );
    assert.ok(
      serviceSource.includes('item, payload, actorUserId, auth'),
      'the ledger service forwards the auth context to the waiver gate',
    );
    assert.ok(s2Source.includes('REP_WAIVER_SOLO_ADMIN_OVERRIDE'), 'the settle writes the override audit event');
    assert.ok(s2Source.includes('اعتماد منفرد'), 'the settle stamps the override on the waived item');
    assert.ok(vanSource.includes('REP_WAIVER_MAKER_CHECKER'), 'the maker-checker code is still named');
    assert.equal(
      s3Source.split('assertRepWaiverApproval(').length -
        1 +
        s2Source.split('this.assertRepWaiverApproval(').length -
        1,
      2,
      'the gate is defined once (S3) and called from the waiver branch (S2)',
    );
    console.log('  PASS S4 source pins');
  }

  if (failures.length) throw new Error(`${failures.length} S4 case(s) failed: ${failures.join(', ')}`);
  console.log('S4 solo-admin rep waiver override tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
