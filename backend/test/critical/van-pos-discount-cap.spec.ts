/*
 * POS combined discount cap for delivery reps (F1a,
 * INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING).
 *
 * THE GAP: the 5% tenant rep cap was enforced ONLY on the portal
 * (field-sale) path. In POS a rep posted 8% (4% line + 4% invoice,
 * Z-261121-16629) and 50% (25% + 25%, Z-261121-16630) with NO
 * supervisor PIN, because the POS tier gate lets a cashier WITH the
 * discount permission discount any amount while the percentage
 * threshold setting is off (the default).
 *
 * THE RULE: in the POS create-sale path, when the seller is a
 * delivery rep (acting user linked to a delivery_representatives
 * row, by the same phone/username link resolveRepLinkedUserId uses
 * in reverse), the COMBINED discount — line discounts + invoice
 * discount, over the gross subtotal, the portal's
 * combinedDiscountPercent definition — must respect the tenant cap
 * from getVanRepDiscountCapPercent (default 5%) unless a supervisor
 * override is approved through the existing manager-PIN path.
 * Above the cap without an approved PIN the sale is refused with
 * COMBINED_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN (403).
 * Exactly on the cap posts. Ordinary non-rep cashiers keep their
 * tier behaviour, and the admin bypass is unchanged
 * (INV-POS-ADMIN-DISCOUNT-AUTHORITY).
 *
 * HOW THIS IS DRIVEN: the real SalesWriteService.createSale on
 * PGlite, reusing the discount-tiers harness (schema + services).
 * The percentage threshold setting is deliberately NOT seeded, so
 * the tier gate passes and the cap is what fires — the trial's
 * configuration. Tear down is db.destroy() only.
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

const TENANT = 't-van-pos-cap';
const ACCOUNT = 'a-van-pos-cap';
const MANAGER_PIN = '1234';
const SHIFT_OPENED_AT = '2026-01-01T00:00:00.000Z';

const adminAuth: AuthContext = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'admin',
  permissions: ['sales', 'canEditPrice'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

const cashierDiscountAuth: AuthContext = {
  userId: 3,
  sessionId: 'spec-b',
  username: 'cashier-b',
  role: 'cashier',
  permissions: ['sales', 'canDiscount'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

// The rep seller: a cashier WITH the discount permission whose login
// is linked to a delivery_representatives row by phone (the trial's
// vanrep1 shape — canDiscount open, threshold off, so the tier gate
// alone would let any discount through).
const repAuth: AuthContext = {
  userId: 4,
  sessionId: 'spec-rep',
  username: 'vanrep1',
  role: 'cashier',
  permissions: ['sales', 'canDiscount'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

// Second rep seller, linked by username only (rep.phone equals the
// user's username, not the user's phone) — the other leg of the link.
const repByUsernameAuth: AuthContext = {
  userId: 5,
  sessionId: 'spec-rep-u',
  username: '01000000002',
  role: 'cashier',
  permissions: ['sales', 'canDiscount'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  SalesWriteService.invalidateSettingsCache(TENANT);
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY);
    CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, phone text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
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
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, half_wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, updated_at timestamptz);
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT false, reason text, auto_restore_at timestamptz, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, system_cash_discount_amount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, cancelled_by bigint, cancelled_at timestamptz, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, pos_terminal_code text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, line_discount numeric DEFAULT 0, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, bom_id bigint, component_product_id bigint);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, opening_note text, expected_cash numeric, counted_cash numeric, variance numeric, close_note text, closed_by bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, payment_channel text, return_document_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, note text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigserial PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE price_lists (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, code text, currency text DEFAULT 'EGP', type text DEFAULT 'percentage', default_discount_percent numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE inventory_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, batch_number text, expiry_date text, quantity numeric DEFAULT 0, unit_cost numeric DEFAULT 0, location_id integer, supplier_name text, status text DEFAULT 'active', notes text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sale_inventory_batch_allocations (id bigint PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, inventory_batch_id bigint, quantity numeric DEFAULT 0, created_at timestamptz DEFAULT NOW());
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

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 3, tenant_id: TENANT, username: 'cashier-b', role: 'cashier', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({ id: 4, tenant_id: TENANT, username: 'vanrep1', phone: '01000000001', role: 'cashier', is_active: true })
    .execute();
  await anyDb
    .insertInto('users')
    .values({
      id: 5,
      tenant_id: TENANT,
      username: '01000000002',
      phone: '01000000009',
      role: 'cashier',
      is_active: true,
    })
    .execute();
  // Rep link by phone (user 4) and by username only (user 5: the rep
  // row's phone equals the user's username, not the user's phone).
  await anyDb
    .insertInto('delivery_representatives')
    .values({
      id: 10,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Van Rep One',
      phone: '01000000001',
      is_van_rep: true,
    })
    .execute();
  await anyDb
    .insertInto('delivery_representatives')
    .values({
      id: 11,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Van Rep Two',
      phone: '01000000002',
      is_van_rep: true,
    })
    .execute();
  const accounts: Array<[number, string]> = [
    [1110, '1110'],
    [1120, '1120'],
    [1130, '1130'],
    [1140, '1140'],
    [2120, '2120'],
    [4100, '4100'],
    [4300, '4300'],
    [5100, '5100'],
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
      name: 'Main warehouse',
      location_type: 'internal_warehouse',
      is_active: true,
    })
    .execute();
  await anyDb
    .insertInto('products')
    .values({
      id: 101,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Widget 101',
      stock_qty: 100,
      cost_price: 10,
      retail_price: 100,
      wholesale_price: 100,
      min_selling_price: 1,
      is_active: true,
      item_type: 'product',
    })
    .execute();
  await anyDb
    .insertInto('product_location_stock')
    .values({
      tenant_id: TENANT,
      account_id: ACCOUNT,
      product_id: 101,
      branch_id: 1,
      location_id: 10,
      qty: 100,
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

function buildServices(db: Kysely<Database>): {
  sales: SalesWriteService;
  drawer: CashDrawerService;
  posting: AccountingPostingService;
} {
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
    db,
    tx,
    audit,
    authz,
    finance,
    query,
    posting,
    idempotency,
    planFeatures as never,
    returnsStub as never,
  );
  const drawer = new CashDrawerService(db, new TransactionHelper(), posting);
  return { sales, drawer, posting };
}

// One 100-unit line: lineDiscount is the per-line amount, discount is
// the header (invoice) amount; combined percent is their sum over the
// 100 gross subtotal. No posMaxDiscountThreshold settings are seeded:
// the threshold is off by default, so the tier gate passes a
// canDiscount cashier and the rep cap is what fires.
function salePayload(lineDiscount: number, invoiceDiscount: number, managerPin?: string): any {
  const collectible = 100 - lineDiscount - invoiceDiscount;
  return {
    items: [{ productId: 101, qty: 1, price: 100, priceType: 'retail', unitMultiplier: 1, lineDiscount }],
    discount: invoiceDiscount,
    taxRate: 0,
    paymentType: 'cash',
    paymentChannel: 'cash',
    payments: [{ paymentChannel: 'cash', amount: collectible }],
    tenderedAmount: collectible,
    branchId: 1,
    locationId: 10,
    source: 'dashboard',
    managerPin,
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (err: any) {
    assert.equal(err?.code, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
    return;
  }
  assert.fail(`expected rejection with ${code}`);
}

async function main(): Promise<void> {
  // (a) Trial invoice Z-261121-16629: rep, 4% line + 4% invoice = 8%
  // combined, no PIN — refused by the cap.
  {
    const { pg, db } = await makeDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedFoundation(db);
      await seedShift(db, 1, 4);
      const { sales } = buildServices(db);
      await expectCode(
        sales.createSale(salePayload(4, 4), repAuth),
        'COMBINED_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN',
      );
    } finally {
      await db.destroy();
    }
    console.log('  rep 8% combined without PIN is refused passed');
  }

  // (b) Trial invoice Z-261121-16630: rep, 25% + 25% = 50% combined,
  // no PIN — refused by the cap.
  {
    const { pg, db } = await makeDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedFoundation(db);
      await seedShift(db, 1, 4);
      const { sales } = buildServices(db);
      await expectCode(
        sales.createSale(salePayload(25, 25), repAuth),
        'COMBINED_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN',
      );
    } finally {
      await db.destroy();
    }
    console.log('  rep 50% combined without PIN is refused passed');
  }

  // (c) Exactly on the cap: rep, 2.5% line + 2.5% invoice = 5% — posts.
  {
    const { pg, db } = await makeDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedFoundation(db);
      await seedShift(db, 1, 4);
      const { sales } = buildServices(db);
      const created: any = await sales.createSale(salePayload(2.5, 2.5), repAuth);
      assert.ok(Number(created?.sale?.id) > 0, 'exactly-5% combined must create the sale');
    } finally {
      await db.destroy();
    }
    console.log('  rep exactly 5% combined posts passed');
  }

  // (d) Above the cap WITH the supervisor PIN — allowed.
  {
    const { pg, db } = await makeDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedFoundation(db);
      await seedShift(db, 1, 4);
      const { sales } = buildServices(db);
      const created: any = await sales.createSale(salePayload(4, 4, MANAGER_PIN), repAuth);
      assert.ok(Number(created?.sale?.id) > 0, 'above-cap sale with supervisor PIN must create the sale');
    } finally {
      await db.destroy();
    }
    console.log('  rep 8% combined with supervisor PIN posts passed');
  }

  // (e) Admin bypass unchanged: admin, 25% + 25% = 50% combined, no
  // PIN — still posts (INV-POS-ADMIN-DISCOUNT-AUTHORITY).
  {
    const { pg, db } = await makeDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedFoundation(db);
      await seedShift(db, 1, 1);
      const { sales } = buildServices(db);
      const created: any = await sales.createSale(salePayload(25, 25), adminAuth);
      assert.ok(Number(created?.sale?.id) > 0, 'admin 50% combined must still create the sale');
    } finally {
      await db.destroy();
    }
    console.log('  admin 50% combined still posts passed');
  }

  // (f) Ordinary non-rep cashier keeps tier behaviour: cashier WITH
  // canDiscount, 8% combined, no PIN — posts (the cap binds reps
  // only; the threshold setting is off, so tier 2 passes it).
  {
    const { pg, db } = await makeDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedFoundation(db);
      await seedShift(db, 1, 3);
      const { sales } = buildServices(db);
      const created: any = await sales.createSale(salePayload(4, 4), cashierDiscountAuth);
      assert.ok(Number(created?.sale?.id) > 0, 'non-rep cashier 8% combined must create the sale');
    } finally {
      await db.destroy();
    }
    console.log('  non-rep cashier 8% combined still posts passed');
  }

  // (g) Rep linked by username only: 8% combined, no PIN — refused.
  {
    const { pg, db } = await makeDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedFoundation(db);
      await seedShift(db, 1, 5);
      const { sales } = buildServices(db);
      await expectCode(
        sales.createSale(salePayload(4, 4), repByUsernameAuth),
        'COMBINED_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN',
      );
    } finally {
      await db.destroy();
    }
    console.log('  username-linked rep 8% combined without PIN is refused passed');
  }

  // (h) A wrong supervisor PIN does not approve the override: rep,
  // 8% combined, wrong PIN — refused with the cap code (not a
  // manager-auth code: the cap is the condition being refused).
  {
    const { pg, db } = await makeDb();
    try {
      SalesWriteService.invalidateSettingsCache(TENANT);
      await seedFoundation(db);
      await seedShift(db, 1, 4);
      const { sales } = buildServices(db);
      await expectCode(
        sales.createSale(salePayload(4, 4, '9999'), repAuth),
        'COMBINED_DISCOUNT_ABOVE_LIMIT_REQUIRES_SUPERVISOR_PIN',
      );
    } finally {
      await db.destroy();
    }
    console.log('  rep 8% combined with wrong PIN is refused passed');
  }

  console.log('van-pos-discount-cap: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
