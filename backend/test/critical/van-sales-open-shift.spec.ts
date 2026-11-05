/*
 * Van-sales E2E shift gate (INV-E2E-VAN-SALES-OPEN-SHIFT):
 * the van-sales E2E opens a cashier shift on the trip's branch before
 * settling a trip with cash. The remittance gate is decided behavior:
 * VanSalesService.insertRepCashRemittanceRow throws 400
 * OPEN_SHIFT_REQUIRED when no open shift exists on the branch, so the
 * E2E must open a shift first -- the test was wrong, not the gate.
 * (CI run 41987439265: settleTrip with counted 80 vs expected 85
 * threw at van-sales.service.ts:4439; the E2E had zero shift mentions.)
 *
 * HOW THIS IS DRIVEN: the real CashDrawerService.openCashierShift on
 * PGlite, plus a verbatim mirror of the receiving-shift lookup in
 * insertRepCashRemittanceRow (van-sales.service.ts:4411-4440) -- the
 * exact predicate that decides the throw -- plus a static check that
 * the E2E file opens the shift (on the trip's branch) before it calls
 * settleTrip. The schema is the minimal table set the shift-open path
 * and its listing hydration touch, copied from the
 * shift-open-password-verification harness.
 *
 * WHAT THIS DOES NOT PROVE: the E2E file itself needs a live Postgres
 * (no running server involved -- the E2E drives VanSalesService
 * directly), which this VM does not have. The authoritative proof for
 * the E2E is the CI run (test:e2e:van-sales) going green.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { CashDrawerService } from '../../src/modules/cash-drawer/cash-drawer.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't-van';
const ACCOUNT = 'a-van';
const LOCATION_ID = 10;
const BRANCH_ID = 7;

const adminAuth: AuthContext = {
  userId: 2, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['cashDrawer'], tenantId: TENANT, accountId: ACCOUNT,
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
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, invoice_type text, invoice_id bigint);
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
    CREATE TABLE expenses (id bigserial PRIMARY KEY, tenant_id text, created_by bigint, expense_date timestamptz, created_at timestamptz DEFAULT NOW(), branch_id bigint, location_id bigint, amount numeric, title text, note text);
    `);
  return { pg, db };
}

async function seed(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('users').values({
    id: 2, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true,
  }).execute();
  // The trip's branch: the van location inherits the tenant's first
  // active branch, so settleTrip's branchId is this branch.
  await anyDb.insertInto('branches').values({
    id: BRANCH_ID, tenant_id: TENANT, name: 'Van Test Branch', is_active: true,
  }).execute();
  // Mirrors the E2E-created location: internal warehouse with NO branch.
  await anyDb.insertInto('stock_locations').values({
    id: LOCATION_ID, tenant_id: TENANT, account_id: ACCOUNT, branch_id: null,
    name: 'E2E warehouse', location_type: 'internal_warehouse', is_active: true,
  }).execute();
}

function buildDrawer(db: Kysely<Database>): CashDrawerService {
  const foundation = {
    ensureForAuth: async () => {},
    ensureForScope: async () => {},
  } as unknown as AccountingTenantFoundationService;
  const posting = new AccountingPostingService(foundation);
  return new CashDrawerService(db, new TransactionHelper(), posting);
}

// Verbatim mirror of the receiving-shift lookup in
// VanSalesService.insertRepCashRemittanceRow (van-sales.service.ts
// :4411-4440): the ONLY thing standing between settleTrip and the
// OPEN_SHIFT_REQUIRED throw. actorUserId is 0 here, exactly as in the
// E2E (settleTrip is called without an auth context), so the opened_by
// lookup is skipped and only the branch fallback runs.
async function findReceivingShift(
  db: Kysely<Database>,
  tenantId: string,
  branchId: number | null,
  actorUserId: number,
): Promise<{ id: number; branch_id: number | null; location_id: number | null } | undefined> {
  const branchMatch = (eb: any) =>
    branchId == null ? eb('branch_id', 'is', null) : eb('branch_id', '=', branchId);
  return db.transaction().execute(async (trx) => {
    let shift: { id: number; branch_id: number | null; location_id: number | null } | undefined;
    if (actorUserId > 0) {
      shift = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .where('opened_by', '=', actorUserId)
        .where(branchMatch)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
    }
    if (!shift) {
      shift = await trx
        .selectFrom('cashier_shifts')
        .select(['id', 'branch_id', 'location_id'])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .where(branchMatch)
        .orderBy('id', 'desc')
        .forUpdate()
        .executeTakeFirst();
    }
    return shift;
  });
}

function checkE2eFileShape(): void {
  const src = readFileSync(join(__dirname, '..', 'e2e', 'van-sales-field-flow.e2e.ts'), 'utf8');
  const openIdx = src.indexOf('drawer.openCashierShift(');
  const settleIdx = src.indexOf('vanSales.settleTrip(');
  assert.ok(openIdx > -1, 'E2E must open a cashier shift before settling the trip');
  assert.ok(settleIdx > -1, 'E2E must still settle the trip');
  assert.ok(openIdx < settleIdx, 'shift-open must come before the settleTrip call in the E2E');
  const openCall = src.slice(openIdx, openIdx + 400);
  assert.ok(
    openCall.includes('branchId: Number(branch.id)'),
    'shift-open must pass the trip branch (branchId: Number(branch.id))',
  );
  assert.ok(
    src.includes("'cashier_shifts'"),
    'E2E cleanup must delete cashier_shifts so a re-run does not hit SHIFT_ALREADY_OPEN',
  );
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    await seed(db);
    const drawer = buildDrawer(db);

    // 1. No shift on the branch -> the gate lookup finds nothing, which
    // is exactly what makes insertRepCashRemittanceRow throw 400
    // OPEN_SHIFT_REQUIRED (the CI failure).
    assert.equal(
      await findReceivingShift(db, TENANT, BRANCH_ID, 0),
      undefined,
      'no open shift on the branch must mean the remittance gate is closed',
    );

    // 2. Opening the shift through the real service (same call the E2E
    // makes, service-level) succeeds and lists an open shift on the branch.
    const opened = await drawer.openCashierShift(
      { openingCash: 0, branchId: BRANCH_ID, note: 'E2E van sales shift' },
      adminAuth,
    );
    assert.equal(opened.ok, true, 'shift-open must succeed');
    const shifts = (opened.cashierShifts as Array<Record<string, unknown>>).length;
    assert.ok(shifts >= 1, 'opened shift must be listed');
    const listed = (opened.cashierShifts as Array<Record<string, unknown>>).find(
      (row) => row.status === 'open' && Number(row.branchId) === BRANCH_ID,
    );
    assert.ok(listed?.id, 'listed shift must be open on the trip branch');

    // 3. After the open, the gate lookup finds the receiving shift -- the
    // remittance row can be written and settleTrip may proceed.
    const receiving = await findReceivingShift(db, TENANT, BRANCH_ID, 0);
    assert.ok(receiving?.id, 'open shift on the branch must satisfy the remittance gate');
    assert.equal(Number(receiving?.branch_id), BRANCH_ID, 'receiving shift must be on the trip branch');
    // The opened_by lookup (used when settleTrip runs with an auth
    // context) finds the same shift.
    const byOpener = await findReceivingShift(db, TENANT, BRANCH_ID, Number(adminAuth.userId));
    assert.equal(Number(byOpener?.id), Number(receiving?.id), 'opened_by lookup must find the same shift');
  } finally {
    await db.destroy();
  }

  // 4. The E2E file itself opens the shift on the trip's branch before settling.
  checkE2eFileShape();

  console.log('van-sales-open-shift: OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
