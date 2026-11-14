/*
 * INV-CLOSED-SHIFT-POST-CLOSE-REFRESH: a closed shift's figures must
 * reflect post-close sale edits and cancels. The stored expected_cash
 * (and its variance) on a closed or pending_review shift is refreshed
 * by recomputing exactly what close would compute — the same
 * computeShiftExpectedCashFromShift over the same closed_at window —
 * inside the edit/cancel transaction, and the correction is STAMPED
 * onto close_note with the original values, the sale, the reason, and
 * the actor, so the original close record is never silently
 * overwritten. When the recomputation equals the stored figures
 * (the cancel case: the sale leaves the breakdown but its cash is
 * restored by the cancelled-receipt rule, and the refund falls back
 * to the cancelling shift), nothing is written and no stamp appears.
 * Open shifts need no refresh: their figures recompute on read. The
 * POSTED variance journal from close is never restated or re-posted
 * (prospective-only); whether a fresh variance adjustment should be
 * posted for a correction is a separate accounting decision, not
 * taken here. Refresh runs only from updateSale/cancelSale; the
 * shift-refresh service must be wired or the post-close change is
 * refused loudly (SHIFT_REFRESH_UNAVAILABLE), never silently skipped.
 *
 * DELEGATED CHOICE, flagged for reversal: recompute-and-stamp (above)
 * instead of recompute-on-read, so the close record stays a stored,
 * auditable summary and list reads stay cheap; the stamp lives in
 * close_note (inside the blind-close JSON for blind closes) rather
 * than a new column or document type.
 *
 * WHAT THIS PINS: Part A drives the REAL refresh method on PGlite
 * (edit delta moves expected + variance + stamp; no-op re-run writes
 * nothing; open shift untouched; blind-close JSON stays parseable
 * with the correction inside it; cancel nets to no change). Part B
 * drives the REAL updateSale/cancelSale end to end on PGlite with
 * the full service graph: a post-close edit moves the stored figures
 * and stamps them; a post-close cancel leaves the stored figures
 * untouched. Part C pins the fail-closed wiring: without the drawer
 * service, a post-close edit is refused and rolls back.
 *
 * Deliberately NOT driven here: the closeCashierShift flow itself
 * (rows are set to the closed state directly, as the cross-shift
 * cancel spec does); blind-close manager review after a correction;
 * live-Postgres proof (deferred by written decision).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AuditService } from '../../src/core/audit/audit.service';
import type { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';
const MANAGER_PIN = '1234';

const adminAuth = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['sales', 'canEditPrice'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;
const cashierAAuth = {
  userId: 2, sessionId: 'spec-a', username: 'cashier-a', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;
const cashierBAuth = {
  userId: 3, sessionId: 'spec-b', username: 'cashier-b', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
} as unknown as AuthContext;

function drawerOnly(db: Kysely<Database>): CashDrawerService {
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  return new CashDrawerService(db, new TransactionHelper(), posting);
}

async function shiftRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('cashier_shifts').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

// ─── Part A: drawer-level refresh on the small precision-style schema ───

const PRECISION_DDL = `
  CREATE TABLE tenants (id text PRIMARY KEY);
  INSERT INTO tenants VALUES ('t1');
  CREATE TABLE settings (tenant_id text, key text, value text);
  INSERT INTO settings VALUES ('t1','currency','EGP');
  CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
  INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
  CREATE TABLE cashier_shifts (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, location_id bigint,
    opened_by bigint, opening_cash numeric, expected_cash numeric, counted_cash numeric, status text,
    created_at timestamptz, closed_at timestamptz, closed_by bigint, variance numeric, close_note text, doc_no text, updated_at timestamptz);
  CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, txn_type text, amount numeric,
    note text, reference_type text, reference_id bigint, payment_channel text, return_document_id bigint,
    branch_id bigint, location_id bigint, created_by bigint, account_id bigint, created_at timestamptz DEFAULT NOW());
  CREATE TABLE services (id bigint PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz,
    created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric);
  CREATE TABLE sales (id bigint PRIMARY KEY, tenant_id text, status text, created_by bigint, created_at timestamptz,
    branch_id bigint, location_id bigint, total numeric, paid_amount numeric, payment_type text,
    payment_channel text, collection_status text, delivery_fee numeric, delivery_fee_mode text, tip_amount numeric);
  CREATE TABLE sale_payments (id bigint PRIMARY KEY, tenant_id text, sale_id bigint, payment_channel text, amount numeric);
  CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, return_type text, created_by bigint,
    created_at timestamptz, branch_id bigint, location_id bigint, total numeric, settlement_mode text,
    refund_method text, refund_allocations jsonb);
  CREATE TABLE supplier_payments (id bigint PRIMARY KEY, tenant_id text, created_by bigint, payment_date timestamptz, created_at timestamptz,
    branch_id bigint, location_id bigint, payment_channel text, amount numeric);
  CREATE TABLE expenses (id bigint PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz,
    created_at timestamptz, branch_id bigint, location_id bigint, amount numeric, cancelled_at timestamptz, cancelled_by bigint, cancel_reason text);
  CREATE TABLE customer_payments (id bigint PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz,
    branch_id bigint, location_id bigint, payment_channel text, amount numeric);
`;

async function seedClosedShiftA(db: Kysely<Database>, closeNote: string): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('cashier_shifts').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, branch_id: null, location_id: null,
    opened_by: 2, opening_cash: 0, expected_cash: 100, counted_cash: 100, variance: 0,
    status: 'closed', created_at: new Date('2026-01-01T00:00:00.000Z'),
    closed_at: new Date('2026-01-01T10:00:00.000Z'), closed_by: 2,
    close_note: closeNote, doc_no: 'SHIFT-1',
  }).execute();
  await anyDb.insertInto('sales').values({
    id: 1, tenant_id: TENANT, status: 'posted', created_by: 2,
    created_at: new Date('2026-01-01T01:00:00.000Z'), branch_id: null, location_id: null,
    total: 100, paid_amount: 100, payment_type: 'cash', payment_channel: 'cash',
    collection_status: '', delivery_fee: 0, delivery_fee_mode: 'freelance_courier', tip_amount: 0,
  }).execute();
  await anyDb.insertInto('sale_payments').values({
    id: 1, tenant_id: TENANT, sale_id: 1, payment_channel: 'cash', amount: 100,
  }).execute();
}

async function runPartA(): Promise<void> {
  // A1: a money edit moves expected + variance and stamps the original values.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(PRECISION_DDL);
      await seedClosedShiftA(db, 'Closed normally');
      const drawer = drawerOnly(db);
      const anyDb = db as any;
      await anyDb.updateTable('sales').set({ total: 150, paid_amount: 150 }).where('id', '=', 1).execute();
      await anyDb.updateTable('sale_payments').set({ amount: 150 }).where('id', '=', 1).execute();
      const result = await (drawer as any).refreshClosedShiftSummary(db, 1, {
        saleId: 1, kind: 'edit', reason: 'price corrected', auth: adminAuth,
      });
      assert.equal(result.refreshed, true, 'a money edit must refresh the closed shift');
      assert.equal(Number(result.previousExpectedCash), 100);
      assert.equal(Number(result.correctedExpectedCash), 150);
      const row = await shiftRow(db, 1);
      assert.equal(Number(row.expected_cash), 150, 'stored expected cash must move to the recomputed figure');
      assert.equal(Number(row.variance), -50, 'variance must be recomputed from the counted cash');
      assert.equal(Number(row.counted_cash), 100, 'counted cash is never rewritten by a refresh');
      assert.ok(String(row.close_note).includes('Closed normally'), 'the original close note must survive');
      assert.ok(String(row.close_note).includes('100'), 'the stamp must preserve the original expected cash');
      assert.ok(String(row.close_note).includes('150'), 'the stamp must record the corrected figure');
      assert.ok(String(row.close_note).includes('S-1'), 'the stamp must name the sale');
      assert.ok(String(row.close_note).includes('price corrected'), 'the stamp must record the reason');

      // A2: a second refresh with no change writes nothing and stamps nothing new.
      const noteBefore = String(row.close_note);
      const again = await (drawer as any).refreshClosedShiftSummary(db, 1, {
        saleId: 1, kind: 'edit', reason: 'price corrected', auth: adminAuth,
      });
      assert.equal(again.refreshed, false, 'an unchanged recomputation must not rewrite the row');
      const rowAgain = await shiftRow(db, 1);
      assert.equal(String(rowAgain.close_note), noteBefore, 'no duplicate stamp on a no-op refresh');
    } finally {
      await db.destroy();
    }
    console.log('  A1/A2 edit refresh + no-op passed');
  }

  // A3: an open shift is never touched.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(PRECISION_DDL);
      await seedClosedShiftA(db, 'Closed normally');
      await (db as any).updateTable('cashier_shifts').set({ status: 'open', closed_at: null }).where('id', '=', 1).execute();
      const drawer = drawerOnly(db);
      const result = await (drawer as any).refreshClosedShiftSummary(db, 1, {
        saleId: 1, kind: 'edit', reason: 'x', auth: adminAuth,
      });
      assert.equal(result.refreshed, false, 'open shifts recompute on read and need no refresh');
      const row = await shiftRow(db, 1);
      assert.equal(Number(row.expected_cash), 100);
      assert.equal(String(row.close_note), 'Closed normally');
    } finally {
      await db.destroy();
    }
    console.log('  A3 open shift untouched passed');
  }

  // A4: blind-close JSON notes stay parseable; the correction lives inside the JSON.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(PRECISION_DDL);
      const blindNote = 'BLIND_CLOSE::' + JSON.stringify({
        blindClose: true,
        declared: { cash: 100, cardTotal: 0, cardCount: 0, walletTotal: 0, walletCount: 0, instapayTotal: 0, instapayCount: 0 },
        detailTotals: { card: 0, wallet: 0, instapay: 0 },
        details: { card: [], wallet: [], instapay: [] },
        note: 'blind close',
      });
      await seedClosedShiftA(db, blindNote);
      const drawer = drawerOnly(db);
      const anyDb = db as any;
      await anyDb.updateTable('sales').set({ total: 130, paid_amount: 130 }).where('id', '=', 1).execute();
      await anyDb.updateTable('sale_payments').set({ amount: 130 }).where('id', '=', 1).execute();
      const result = await (drawer as any).refreshClosedShiftSummary(db, 1, {
        saleId: 1, kind: 'edit', reason: 'price corrected', auth: adminAuth,
      });
      assert.equal(result.refreshed, true);
      const row = await shiftRow(db, 1);
      assert.equal(Number(row.expected_cash), 130);
      const parsed = JSON.parse(String(row.close_note).slice('BLIND_CLOSE::'.length));
      assert.equal(parsed.blindClose, true, 'blind-close metadata must survive the stamp');
      assert.equal(parsed.declared.cash, 100, 'declared totals are never rewritten by a refresh');
      assert.equal(Array.isArray(parsed.postCloseCorrections), true, 'correction must be recorded inside the blind JSON');
      assert.equal(parsed.postCloseCorrections.length, 1);
      assert.equal(Number(parsed.postCloseCorrections[0].previousExpectedCash), 100);
      assert.equal(Number(parsed.postCloseCorrections[0].correctedExpectedCash), 130);
    } finally {
      await db.destroy();
    }
    console.log('  A4 blind-close JSON stamp passed');
  }

  // A5: cancelling the sale nets to no change (breakdown drops, cancelled
  // receipt restores, refund falls back elsewhere) — nothing is written.
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(PRECISION_DDL);
      await seedClosedShiftA(db, 'Closed normally');
      const drawer = drawerOnly(db);
      await (db as any).updateTable('sales').set({ status: 'cancelled' }).where('id', '=', 1).execute();
      const result = await (drawer as any).refreshClosedShiftSummary(db, 1, {
        saleId: 1, kind: 'cancel', reason: 'cancelled after close', auth: adminAuth,
      });
      assert.equal(result.refreshed, false, 'a cancel that nets to the same figure must not rewrite the row');
      const row = await shiftRow(db, 1);
      assert.equal(Number(row.expected_cash), 100);
      assert.equal(String(row.close_note), 'Closed normally');
    } finally {
      await db.destroy();
    }
    console.log('  A5 cancel nets to no change passed');
  }
}

// ─── Part B/C: end-to-end updateSale/cancelSale on the full service graph ───
// DDL mirrors cross-shift-cancel-cash.spec.ts, plus the close-summary
// columns the refresh writes (counted_cash, variance, close_note,
// closed_by, updated_at, opening_note).

async function makeFullDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
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
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz, updated_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigint PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE services (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, service_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE supplier_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, payment_date timestamptz, created_at timestamptz, branch_id bigint, location_id bigint, payment_channel text, amount numeric);
    CREATE TABLE customer_payments (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, payment_channel text, amount numeric, note text);
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text, cancelled_at timestamptz, cancelled_by bigint, cancel_reason text);
  `);
  return { pg, db };
}

async function seedFoundationFull(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'cashier-a', role: 'cashier', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 3, tenant_id: TENANT, username: 'cashier-b', role: 'cashier', is_active: true }).execute();
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
}

async function seedShiftFull(db: Kysely<Database>, id: number, openedBy: number): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, doc_no: `SHIFT-${id}`,
    opened_by: openedBy, status: 'open', branch_id: 1, location_id: 10,
    opening_cash: 0, expected_cash: 0, counted_cash: null, variance: null,
    close_note: null, created_at: new Date('2026-01-01T00:00:00.000Z'),
  }).execute();
}

function buildFullServices(db: Kysely<Database>, withDrawer: boolean): { sales: SalesWriteService; drawer: CashDrawerService } {
  const foundation = { ensureForAuth: async () => {}, ensureForScope: async () => {} } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  const authz = new SalesAuthorizationService(db);
  const finance = new SalesFinanceService(db);
  const query = new SalesQueryService(db, authz);
  const idempotency = new IdempotencyService(db);
  const tx = new TransactionHelper();
  const audit = new AuditService(db);
  const planFeatures = { hasFeature: () => false };
  const returnsStub = {};
  const drawer = drawerOnly(db);
  const sales = new SalesWriteService(
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
  );
  // Fail-first compatible wiring: the drawer is an optional 13th
  // constructor argument in the patched code (Nest DI in production);
  // assigning the field directly keeps this spec compilable on the
  // unpatched tree, where updateSale never consults it.
  if (withDrawer) (sales as any).cashDrawerService = drawer;
  return { sales, drawer };
}

function posPayloadFull(total: number): any {
  return {
    items: [{ productId: 101, qty: 1, price: total, priceType: 'retail', unitMultiplier: 1 }],
    discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: total }], tenderedAmount: total,
    branchId: 1, locationId: 10, source: 'pos',
  };
}

async function closeShiftRow(db: Kysely<Database>, id: number): Promise<void> {
  await (db as any).updateTable('cashier_shifts')
    .set({
      status: 'closed', closed_at: new Date(), expected_cash: 100,
      counted_cash: 100, variance: 0, close_note: 'Closed normally', closed_by: 2,
    })
    .where('id', '=', id).execute();
}

async function runPartB(): Promise<void> {
  // B1: post-close EDIT moves the stored figures and stamps them.
  {
    const { pg, db } = await makeFullDb();
    try {
      await seedFoundationFull(db);
      await seedShiftFull(db, 1, 2);
      const { sales } = buildFullServices(db, true);
      const created: any = await sales.createSale(posPayloadFull(100), cashierAAuth);
      const saleId = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
      assert.ok(Number.isInteger(saleId) && saleId > 0, 'createSale must return a sale id');
      await closeShiftRow(db, 1);
      await seedShiftFull(db, 99, 1);
      const edited: any = await sales.updateSale(saleId, {
        ...posPayloadFull(150), editReason: 'price corrected after close', managerPin: MANAGER_PIN,
      }, adminAuth);
      assert.equal(edited.ok, true, 'post-close edit must succeed');
      const row = await shiftRow(db, 1);
      assert.equal(Number(row.expected_cash), 150, 'stored expected cash must refresh to the edited figure');
      assert.equal(Number(row.variance), -50, 'variance must be recomputed from the counted cash');
      assert.equal(Number(row.counted_cash), 100, 'counted cash is never rewritten');
      assert.ok(String(row.close_note).includes('Closed normally'), 'original close note survives');
      assert.ok(String(row.close_note).includes('100'), 'stamp preserves the original figure');
      assert.ok(String(row.close_note).includes('150'), 'stamp records the corrected figure');
      assert.ok(String(row.close_note).includes(`S-${saleId}`), 'stamp names the sale');
      assert.ok(String(row.close_note).includes('price corrected after close'), 'stamp records the reason');
      const sale = await (db as any).selectFrom('sales').select(['total', 'status']).where('id', '=', saleId).executeTakeFirstOrThrow();
      assert.equal(Number(sale.total), 150, 'the sale itself carries the edited total');
      assert.equal(sale.status, 'posted');
    } finally {
      await db.destroy();
    }
    console.log('  B1 post-close edit refreshes stored figures passed');
  }

  // B2: post-close CANCEL leaves the stored figures untouched (nets to zero).
  {
    const { pg, db } = await makeFullDb();
    try {
      await seedFoundationFull(db);
      await seedShiftFull(db, 1, 2);
      await seedShiftFull(db, 2, 3);
      const { sales } = buildFullServices(db, true);
      const created: any = await sales.createSale(posPayloadFull(100), cashierAAuth);
      const saleId = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
      await closeShiftRow(db, 1);
      await sales.cancelSale(saleId, 'cancelled after close', MANAGER_PIN, cashierBAuth);
      const row = await shiftRow(db, 1);
      assert.equal(Number(row.expected_cash), 100, 'cancel nets to the same figure: stored expected cash untouched');
      assert.equal(Number(row.variance), 0);
      assert.equal(String(row.close_note), 'Closed normally', 'no stamp when the recomputation is unchanged');
      const sale = await (db as any).selectFrom('sales').select('status').where('id', '=', saleId).executeTakeFirstOrThrow();
      assert.equal(sale.status, 'cancelled');
    } finally {
      await db.destroy();
    }
    console.log('  B2 post-close cancel leaves stored figures passed');
  }

  // C: without the drawer service wired, a post-close edit is refused
  // loudly and rolls back — never silently skipped.
  {
    const { pg, db } = await makeFullDb();
    try {
      await seedFoundationFull(db);
      await seedShiftFull(db, 1, 2);
      const { sales } = buildFullServices(db, false);
      const created: any = await sales.createSale(posPayloadFull(100), cashierAAuth);
      const saleId = Number(created?.sale?.id ?? created?.saleId ?? created?.id);
      await closeShiftRow(db, 1);
      await seedShiftFull(db, 99, 1);
      await assert.rejects(
        () => sales.updateSale(saleId, {
          ...posPayloadFull(150), editReason: 'price corrected after close', managerPin: MANAGER_PIN,
        }, adminAuth),
        (error: unknown) => (error as { code?: string }).code === 'SHIFT_REFRESH_UNAVAILABLE',
      );
      const sale = await (db as any).selectFrom('sales').select(['total', 'status']).where('id', '=', saleId).executeTakeFirstOrThrow();
      assert.equal(Number(sale.total), 100, 'the refused edit must roll back');
      const row = await shiftRow(db, 1);
      assert.equal(Number(row.expected_cash), 100);
    } finally {
      await db.destroy();
    }
    console.log('  C missing drawer refuses post-close edit passed');
  }
}

async function main(): Promise<void> {
  await runPartA();
  await runPartB();
  console.log('closed-shift-post-close-refresh.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
