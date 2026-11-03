/*
New file: backend/test/critical/pos-net-stock-display.spec.ts

WHAT THIS PINS (INV-POS-NET-STOCK-DISPLAY): the POS catalog display
shows the NET available quantity checkout enforces — location qty
minus reserved_qty, at the same location scope checkout uses — not
the gross figure. Before this package, resolveScopedStockByProduct
summed raw `pls.qty`, never read `reserved_qty`, and added a
`stock_qty − Σ assigned` "discrepancy" whenever the unassigned pool
was empty; and mapPosProduct discarded the scoped figure entirely
for branch-only lookups (no explicit locationId), falling back to
the global `stock_qty`. The cashier therefore added a reserved item
and checkout threw INSUFFICIENT_STOCK in front of the customer.

THE CASES, WORKED ONCE (location 10 qty 10, reserved 8; location 20
in another branch qty 50; global stock_qty equals the sum of the
location rows, so no unassigned balance exists unless seeded):
(a) Branch-only lookup, single_location mode: display is 2 — the
reserved 8 are gone and the other branch's 50 never counted. (The
old code returned the gross 10 here; with a global figure above
the location sum it additionally added the whole difference as a
"discrepancy" — phantom stock checkout never credits.)
(b) Explicit locationId lookup: display is 2, the same figure.
(c) all_operational_locations mode, plus location 11 (qty 5,
reserved 1) and a pool row (qty 4, reserved 1): display is
2 + 4 + 3 = 9 — per-row net over eligible locations + pool, the
same sum checkout enforces.
(d) Boundary against the REAL createSale: with display 2, a POS
sale of 3 throws INSUFFICIENT_STOCK and a sale of 2 posts,
leaving location qty 8 and reserved untouched.
(e) The shared helper itself: a row reserved past its qty clamps
to 0 instead of going negative and dragging the sum down.

HOW THIS IS DRIVEN: the real CatalogProductService (real
InventoryScopeService, real Kysely/PGlite) for the display figures,
the real SalesWriteService for the checkout boundary, and the real
availableAcrossLocations helper for the formula table. PGlite is
single-connection; live-Postgres rehearsal of the till display
remains owed by written decision.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
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
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { availableAcrossLocations } from '../../src/common/engines/branch-sellable-locations.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const cashierAuth: AuthContext = {
  userId: 2, sessionId: 'spec-cashier', username: 'cashier', role: 'cashier',
  permissions: ['sales'], tenantId: TENANT, accountId: ACCOUNT,
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
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
    CREATE TABLE accounting_settings (id bigint PRIMARY KEY, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
    CREATE TABLE accounting_accounts (id bigint PRIMARY KEY, tenant_id text, code text, name_ar text, name_en text, account_type text, is_active boolean, is_tax boolean, account_group text, is_control_account boolean DEFAULT false, is_receivable boolean DEFAULT false, is_payable boolean DEFAULT false, is_inventory boolean DEFAULT false, allow_manual_entries boolean DEFAULT true);
    CREATE TABLE accounting_fiscal_periods (id bigserial PRIMARY KEY, tenant_id text, status text, name text, period_number int, start_date date, end_date date);
    CREATE TABLE cost_centers (id bigint PRIMARY KEY, tenant_id text, code text, name text);
    CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text, dedup_key text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, cash_flow_category text, updated_at timestamptz);
    CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, tenant_id text, journal_entry_id bigint, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
    CREATE TABLE accounting_posting_failures (id bigserial PRIMARY KEY, tenant_id text, source_type text, source_id bigint, resolved_at timestamptz, last_attempt_at timestamptz);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, sku text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, min_stock_qty numeric DEFAULT 0, category_id bigint, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, item_kind text, color text, size text, metadata text, updated_at timestamptz);
    CREATE TABLE product_units (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text, multiplier numeric DEFAULT 1, barcode text, is_base_unit boolean DEFAULT false, is_sale_unit_default boolean DEFAULT false, is_purchase_unit_default boolean DEFAULT false);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pharmacy_drugs (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text);
    CREATE TABLE pharmacy_batches (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, drug_id bigint, batch_number varchar(100) NOT NULL, expiry_date varchar(30) NOT NULL, quantity numeric(14,3) DEFAULT 0 NOT NULL, unit_cost numeric(14,3) DEFAULT 0 NOT NULL, location_id integer, supplier_name varchar(150), status varchar(50) DEFAULT 'active' NOT NULL, notes text, created_at timestamptz DEFAULT NOW() NOT NULL, updated_at timestamptz DEFAULT NOW() NOT NULL);
    CREATE TABLE sale_pharmacy_batch_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, product_id bigint, pharmacy_batch_id bigint, quantity numeric);
    CREATE TABLE customers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, credit_limit numeric DEFAULT 0, is_credit_blocked boolean DEFAULT false, credit_block_reason text, customer_type text, location_url text, metadata text, store_credit_balance numeric DEFAULT 0, loyalty_points numeric DEFAULT 0, is_active boolean DEFAULT true, updated_at timestamptz);
    CREATE TABLE customer_ledger (id bigserial PRIMARY KEY, customer_id bigint, supplier_id bigint, entry_type text, amount numeric, balance_after numeric, note text, reference_type text, reference_id bigint, van_trip_id bigint, tenant_id text, account_id text, created_by bigint);
    CREATE TABLE customer_loyalty_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text, customer_id bigint, points_change numeric, balance_after numeric, action_type text, sale_id bigint, notes text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz, sale_origin text, exchange_return_id bigint, van_trip_id bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_role text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE sale_payments (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, payment_channel text, amount numeric, applied_amount numeric, tendered_amount numeric, change_amount numeric, card_rrn text, card_auth_code text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text);
    CREATE TABLE sale_line_stock_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_line_id bigint, product_id bigint, location_id bigint, branch_id bigint, qty numeric, quantity numeric, allocation_order int, created_at timestamptz DEFAULT NOW());
    CREATE TABLE product_offers (id bigserial PRIMARY KEY, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, tenant_id text, account_id text, is_active boolean DEFAULT true);
    CREATE TABLE product_serials (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, serial_number text, imei_2 text, status text, sale_id bigint, sale_item_id bigint, updated_at timestamptz);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, component_product_id bigint, consumption_qty numeric);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE manufacturing_bom_lines (id bigint PRIMARY KEY, tenant_id text, account_id text, bom_id bigint, component_product_id bigint, quantity numeric DEFAULT 1);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, vehicle_plate text, van_location_id bigint, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE van_sales_trips (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, vehicle_id bigint, start_odometer numeric, van_location_id bigint, source_warehouse_id bigint, status text, settlement_status text, loaded_amount numeric DEFAULT 0, sales_amount numeric DEFAULT 0, cash_collected numeric DEFAULT 0, credit_sales numeric DEFAULT 0, returns_amount numeric DEFAULT 0, variance numeric DEFAULT 0, notes text, opened_at timestamptz, updated_at timestamptz);
    CREATE TABLE van_field_visits (id bigserial PRIMARY KEY, tenant_id text, account_id text, trip_id bigint, rep_id bigint, customer_id bigint, visit_type text, sale_id bigint, gps_lat numeric, gps_lng numeric, notes text, visited_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE fleet_vehicles (id bigint PRIMARY KEY, tenant_id text, assigned_rep_id bigint, van_location_id bigint, current_odometer numeric);
    CREATE TABLE pos_audit_events (id bigserial PRIMARY KEY, tenant_id text, account_id text, event_type text, user_id bigint, sale_id bigint, product_id bigint, amount numeric, reason text, metadata jsonb, created_at timestamptz DEFAULT NOW());
    CREATE TABLE payment_allocations (id bigserial PRIMARY KEY, tenant_id text, invoice_type text, invoice_id bigint);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, opened_by bigint, status text, branch_id bigint, created_at timestamptz DEFAULT NOW(), closed_at timestamptz);
    CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text, account_id text, idempotency_key text, operation_type text, status text, document_id text, response_payload text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE return_documents (id bigint PRIMARY KEY, tenant_id text, doc_no text, return_type text, invoice_id bigint, settlement_mode text, refund_method text, refund_allocations jsonb, total numeric, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT '2026-10-02');
    CREATE TABLE return_items (id bigint PRIMARY KEY, tenant_id text, return_document_id bigint, product_id bigint, sale_item_id bigint, qty numeric, cost_price numeric, allocated_tax numeric);
    CREATE TABLE import_sale_allocations (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, sale_item_id bigint, lot_id bigint, allocation_type text, quantity numeric, reversal_of_allocation_id bigint, product_id bigint, location_id bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE import_inventory_lots (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, quantity numeric, remaining_quantity numeric, status text, receipt_date date, lot_number text, cost_price numeric, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>, mode: string | null, globalQty: number): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'managerPin', value: '"1234"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true }).execute();
  await anyDb.insertInto('users').values({ id: 1, tenant_id: TENANT, username: 'admin', role: 'admin', is_active: true }).execute();
  await anyDb.insertInto('users').values({ id: 2, tenant_id: TENANT, username: 'cashier', role: 'cashier', is_active: true }).execute();
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
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', default_stock_location_id: 10, sales_stock_mode: mode }).execute();
  await anyDb.insertInto('branches').values({ id: 2, tenant_id: TENANT, name: 'Other', default_stock_location_id: 20, sales_stock_mode: null }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 10, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Main store', location_type: 'branch_stock', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 11, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 1, name: 'Back store', location_type: 'branch_stock', is_active: true }).execute();
  await anyDb.insertInto('stock_locations').values({ id: 20, tenant_id: TENANT, account_id: ACCOUNT, branch_id: 2, name: 'Other warehouse', location_type: 'internal_warehouse', is_active: true }).execute();
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: ACCOUNT, name: 'Product 101',
    stock_qty: globalQty, reserved_qty: 8, cost_price: 10, retail_price: 100,
    wholesale_price: 100, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 10, qty: 10, reserved_qty: 8,
  }).execute();
  await anyDb.insertInto('product_location_stock').values({
    tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 2, location_id: 20, qty: 50, reserved_qty: 0,
  }).execute();
}

function buildCatalogService(db: Kysely<Database>): CatalogProductService {
  return new CatalogProductService(db, new AuditService(db), new InventoryScopeService(db));
}

function buildSalesService(db: Kysely<Database>): SalesWriteService {
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
  return new SalesWriteService(
    db, tx, audit, authz, finance, query, posting, idempotency,
    planFeatures as never, returnsStub as never,
  );
}

async function displayedStock(service: CatalogProductService, query: Record<string, unknown>): Promise<number> {
  const result: any = await service.listPosProducts(query, cashierAuth);
  assert.equal(result.products.length, 1, `expected exactly one POS product, got ${JSON.stringify(result.products)?.slice(0, 120)}`);
  return Number(result.products[0].stock);
}

async function locationQty(db: Kysely<Database>): Promise<{ qty: number; reserved: number }> {
  const row = await (db as any).selectFrom('product_location_stock').select(['qty', 'reserved_qty'])
    .where('tenant_id', '=', TENANT).where('product_id', '=', 101).where('location_id', '=', 10)
    .executeTakeFirstOrThrow() as any;
  return { qty: Number(row.qty), reserved: Number(row.reserved_qty) };
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error: any) {
    assert.equal(error?.code, code, `expected AppError ${code}, got ${error?.code}: ${error?.message}`);
    return;
  }
  assert.fail(`expected AppError ${code} but the call succeeded`);
}

async function main(): Promise<void> {
  // (e) The shared helper itself: per-row clamp, pool clamp.
  assert.equal(availableAcrossLocations([{ qty: 10, reserved: 8 }]), 2);
  assert.equal(availableAcrossLocations([{ qty: 5, reserved: 9 }]), 0);
  assert.equal(availableAcrossLocations([{ qty: 10, reserved: 8 }], { qty: 4, reserved: 1 }), 5);
  assert.equal(availableAcrossLocations([{ qty: 10, reserved: 8 }], { qty: 1, reserved: 4 }), 2);
  console.log('  helper table passed');

  // (a)+(b) Single-location branch: branch-only and explicit-location
  // lookups both read 2. The old code returned the gross 10 here
  // (and, when the global figure exceeded the location sum, the
  // whole difference on top as a "discrepancy").
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, null, 60);
      const catalog = buildCatalogService(db);
      assert.equal(await displayedStock(catalog, { branchId: 1 }), 2);
      assert.equal(await displayedStock(catalog, { branchId: 1, locationId: 10 }), 2);
      console.log('  single-location display passed');
    } finally {
      await db.destroy();
    }
  }

  // (c) all_operational_locations: eligible nets + pool net = 9; the
  // other branch's 50 never enters the sum.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, 'all_operational_locations', 69);
      const anyDb = db as any;
      await anyDb.insertInto('product_location_stock').values({
        tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: 1, location_id: 11, qty: 5, reserved_qty: 1,
      }).execute();
      await anyDb.insertInto('product_location_stock').values({
        tenant_id: TENANT, account_id: ACCOUNT, product_id: 101, branch_id: null, location_id: null, qty: 4, reserved_qty: 1,
      }).execute();
      const catalog = buildCatalogService(db);
      assert.equal(await displayedStock(catalog, { branchId: 1 }), 9);
      console.log('  all-operational display passed');
    } finally {
      await db.destroy();
    }
  }

  // (d) Checkout boundary on the real createSale: display 2, a sale
  // of 3 is refused, a sale of 2 posts and deducts exactly 2.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, null, 60);
      const anyDb = db as any;
      await anyDb.insertInto('cashier_shifts').values({
        tenant_id: TENANT, account_id: ACCOUNT, opened_by: 2, status: 'open', branch_id: 1,
      }).execute();
      const catalog = buildCatalogService(db);
      const sales = buildSalesService(db);
      assert.equal(await displayedStock(catalog, { branchId: 1 }), 2);
      const payload = (qty: number) => ({
        items: [{ productId: 101, qty, price: 100, priceType: 'retail', unitMultiplier: 1 }],
        discount: 0, taxRate: 0, paymentType: 'cash', paymentChannel: 'cash',
        payments: [{ paymentChannel: 'cash', amount: 100 * qty }],
        tenderedAmount: 100 * qty, branchId: 1, locationId: 10, source: 'pos',
      });
      await expectAppError(sales.createSale(payload(3) as any, cashierAuth), 'INSUFFICIENT_STOCK');
      await sales.createSale(payload(2) as any, cashierAuth);
      assert.deepEqual(await locationQty(db), { qty: 8, reserved: 8 });
      console.log('  checkout boundary passed');
    } finally {
      await db.destroy();
    }
  }

  console.log('pos-net-stock-display: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
