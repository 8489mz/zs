/*
 * R-I11 (INV-REST-FNB-TRUTH-2): 86 is display-only on the unfixed
 * tree — restaurant_86_items is read only by get86Items and toggled
 * by the modal; no ordering path checks it.
 *
 * The fix, driven here against the real code (PGlite, one shared
 * database per part with TRUNCATE between the online-order cases —
 * a fresh instance per case OOM-killed the VM):
 * - Part A (PGlite): the shared assertProductsNot86ed helper throws
 *   AppError ITEM_86ED 422 naming the item when a listed product is
 *   86'd for the order's branch (branch-specific or tenant-wide
 *   rows); a branch-scoped 86 on another branch, and an un-86'd row,
 *   do not block.
 * - Part B (mock transaction, sale-money-truth Part D pattern):
 *   the real createSale rejects a sale containing an 86'd product
 *   with 422 naming it, before any stock or journal work; a clean
 *   sale still reaches the sales insert.
 * - Part C (PGlite, storefront-kiosk-order-truth harness): the real
 *   createOnlineOrder rejects an order containing an 86'd product
 *   with 422 naming it; un-86 (or an 86 scoped to another branch)
 *   lets the order through.
 *
 * RED PROOF: on the unfixed tree Part A throws (no helper exists),
 * Part B's 86'd sale reaches the sales insert, and Part C's 86'd
 * order is created — see the base-run note at the end of the report.
 *
 * BASE NOTE: the sale-money-truth Part D mock is red on this base
 * (its mock never stubbed planFeatureService, and createSale now
 * calls it unguarded); this spec stubs it (restaurant off), so the
 * 86 check is exercised with the modifier contract skipped.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
// The idempotent access token is derived from SESSION_CSRF_SECRET (≥16
// chars); the test harness sets a test-only value when none is configured.
process.env.SESSION_CSRF_SECRET ??= 'test-only-restaurant-86-secret';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  assertProductsNot86ed,
} from '../../src/modules/sales/services/restaurant-advanced-fnb.service';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 't1:main';
const SLUG = 'test-shop';

const EIGHTY_SIX_DDL = `
  CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint,
    product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT true,
    reason text, auto_restore_at timestamptz, created_by bigint,
    created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
`;

// --- Part A: the shared helper over PGlite ---

async function makeHelperDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(EIGHTY_SIX_DDL);
  return { pg, db };
}

async function expect86Error(promise: Promise<unknown>, name: string): Promise<void> {
  try {
    await promise;
  } catch (error: any) {
    assert.equal(error?.code, 'ITEM_86ED', `expected ITEM_86ED, got ${error?.code}: ${error?.message}`);
    assert.equal(error?.statusCode, 422, `expected status 422, got ${error?.statusCode}`);
    assert.ok(String(error?.message || '').includes(name), `error must name the item (${name}): ${error?.message}`);
    return;
  }
  assert.fail('expected ITEM_86ED but the call succeeded');
}

// --- Part B: createSale through the mock transaction ---

function chainable(terminal: Record<string, any>) {
  const builder: any = {};
  for (const key of ['selectAll', 'select', 'where', 'forUpdate', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'onRef', 'on']) {
    builder[key] = (...args: any[]) => {
      if ((key === 'leftJoin' || key === 'innerJoin') && typeof args[1] === 'function') args[1](builder);
      return builder;
    };
  }
  Object.assign(builder, terminal);
  return builder;
}

function buildCreateSaleService(settingsRows: any[], rows86: any[]) {
  const trx: any = {
    executeQuery: async () => ({ rows: [] }),
    getExecutor: () => ({
      compileQuery: (node: any) => ({ sql: '', parameters: [], query: node }),
      transformQuery: (query: any) => query,
      executeQuery: async () => ({ rows: [] }),
    }),
    selectFrom: (table: string) => {
      if (table === 'accounting_settings') {
        return chainable({ executeTakeFirst: async () => ({ lock_date_all: null, lock_date_non_adviser: null, lock_date_tax: null }) });
      }
      if (table === 'accounting_fiscal_periods') {
        return chainable({ executeTakeFirst: async () => null });
      }
      if (table === 'settings') {
        return chainable({
          executeTakeFirst: async () => ({ value: '"EGP"' }),
          execute: async () => settingsRows,
        });
      }
      if (table === 'currency_exchange_rates') {
        return chainable({ execute: async () => [{ currency_code: 'EGP', exchange_rate: 1 }] });
      }
      if (table === 'customers') {
        return chainable({
          executeTakeFirst: async () => ({
            id: 21, name: 'Customer', balance: 0, credit_limit: 0,
            store_credit_balance: 0, loyalty_points: 0,
            is_credit_blocked: false, credit_block_reason: null,
          }),
        });
      }
      if (table === 'products as p') {
        return chainable({
          execute: async () => [{
            id: 1, name: 'Widget', name_en: null, stock_qty: 100, reserved_qty: 0,
            retail_price: 100, wholesale_price: 90, cost_price: 60,
            min_selling_price: 0, item_type: 'product', bom_id: null,
          }],
        });
      }
      if (table === 'product_offers') {
        return chainable({ execute: async () => [] });
      }
      if (table === 'branches') {
        return chainable({
          executeTakeFirst: async () => ({
            id: 1, name: 'Main', default_stock_location_id: 10,
            sales_stock_mode: null, allow_external_sales_stock: false,
          }),
        });
      }
      if (table === 'stock_locations') {
        return chainable({
          executeTakeFirst: async () => ({
            id: 10, name: 'Main', is_active: true, location_type: 'branch_stock', branch_id: 1,
          }),
          execute: async () => [],
        });
      }
      if (table === 'product_location_stock') {
        return chainable({ execute: async () => [{ product_id: 1, location_id: 10, branch_id: 1, qty: 100, reserved_qty: 0 }] });
      }
      if (table === 'restaurant_86_items') {
        return chainable({ execute: async () => rows86 });
      }
      throw new Error(`unexpected (query|write) ${table}`);
    },
    insertInto: (table: string) => ({
      values: (row: any) => {
        if (table === 'sales') throw new Error('SALE_INSERT_REACHED');
        return chainable({
          returningAll: () => chainable({ executeTakeFirstOrThrow: async () => ({ id: 999 }), execute: async () => [] }),
          execute: async () => [],
          executeTakeFirstOrThrow: async () => ({ id: 999 }),
        });
      },
    }),
    updateTable: () => { throw new Error('unexpected write'); },
    deleteFrom: () => { throw new Error('unexpected write'); },
  };
  const service = Object.create(SalesWriteService.prototype);
  service.db = {};
  service.tx = { runInTransaction: async (_db: any, cb: any) => cb(trx) };
  service.lockSaleStockRows = async () => {};
  service.authz = {
    hasOpenCashierShift: async () => true,
    hasOpenCashierShiftForSale: async () => true,
  };
  // The 86 check runs with the restaurant modifier contract skipped
  // (feature off) — the mock predating R4-C never stubbed this.
  // NOTE: createSale passes hasFeature's return value UNawaited, so
  // the stub must return a plain boolean, not a Promise (a Promise
  // is truthy and would run the contract instead of skipping it).
  service.planFeatureService = { hasFeature: () => false };
  return service;
}

function createSalePayload(): { payload: any; auth: any } {
  const payload: any = {
    customerId: 21,
    branchId: 1,
    paymentType: 'cash',
    items: [{ productId: 1, qty: 1, unitPrice: 100 }],
    pricesIncludeTax: false,
    taxRate: 0,
    source: 'pos',
    orderType: 'takeaway',
    serviceCharge: 0,
    payments: [{ paymentChannel: 'cash', amount: 500 }],
  };
  const auth: any = { userId: 1, tenantId: 't-sc-86', accountId: 'a1', role: 'admin', permissions: [], sessionId: 'x', username: 't' };
  return { payload, auth };
}

function saleSettings() {
  return [
    { key: 'currency', value: '"EGP"' },
    { key: 'taxRate', value: '15' },
  ];
}

// --- Part C: createOnlineOrder over PGlite ---

async function makeOnlineDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY, slug text, custom_domain text, activity_type text, plan_id text, extra_features jsonb, owner_phone text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, metadata jsonb, updated_at timestamptz);
    CREATE TABLE product_offers (id bigint PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, is_active boolean DEFAULT true);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, is_active boolean DEFAULT true);
    CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_name text, customer_phone text, customer_address text, customer_notes text, items_json text, subtotal numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, total_amount numeric DEFAULT 0, status text, payment_method text, payment_status text, gateway_provider text, gateway_transaction_id text, gateway_order_id text, gateway_response_json text, paid_at timestamptz, pager_number text, coupon_code text, discount_amount numeric DEFAULT 0, delivery_zone_id bigint, delivery_zone_name text, branch_id bigint, sale_id bigint, shipping_carrier text, fulfillment_type text, country_code text, pickup_branch_id bigint, access_token_hash text, kitchen_draft_sale_id bigint, order_type text, table_number text, stock_reserved boolean DEFAULT false, reserved_branch_id bigint, reserved_location_id bigint, stock_reserved_at timestamptz, idempotency_key text, dispatched_at timestamptz, delivered_at timestamptz, driver_cash_settled boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, cancelled_at timestamptz, cancelled_by bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, settled_at timestamptz, settled_by bigint, eta_uuid text, eta_submission_id text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE storefront_abandoned_carts (id bigserial PRIMARY KEY, tenant_id text, customer_phone text, recovered boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, opened_by bigint, status text, branch_id bigint, location_id bigint, terminal_code text, opening_cash numeric, expected_cash numeric, counted_cash numeric, variance numeric, closed_at timestamptz, closed_by bigint, created_at timestamptz DEFAULT NOW());
    ${EIGHTY_SIX_DDL}
  `);
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({
    id: TENANT, slug: SLUG, activity_type: 'restaurant', plan_id: 'plan_basic',
    extra_features: '["storefront"]', owner_phone: null,
  }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'timezone', value: 'Africa/Cairo' }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', is_active: true }).execute();
  await anyDb.insertInto('branches').values({ id: 2, tenant_id: TENANT, name: 'Second', is_active: true }).execute();
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: `${TENANT}:main`, name: 'Product 101',
    stock_qty: 100, cost_price: 10, retail_price: 50,
    wholesale_price: 50, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
  return { pg, db };
}

function buildOnlineService(db: Kysely<Database>): StorefrontService {
  const checker = new PlanFeatureService(undefined as any);
  return new StorefrontService(db, {} as never, {} as never, {} as never, undefined, checker);
}

function onlineOrderDto() {
  return {
    customerName: 'Test Customer',
    customerPhone: '01012345678',
    customerAddress: 'Cairo',
    orderType: 'delivery',
    items: [{ productId: 101, quantity: 1 }],
  };
}

async function seed86(db: Kysely<Database>, row: { product_id: number; product_name: string; branch_id: number | null; is_86ed: boolean }): Promise<void> {
  await (db as any).insertInto('restaurant_86_items').values({
    tenant_id: TENANT, ...row,
  }).execute();
}

async function main() {
  // Part A: the shared helper.
  {
    const { pg, db } = await makeHelperDb();
    try {
      // Tenant-wide 86 blocks any branch.
      await (db as any).insertInto('restaurant_86_items').values({
        tenant_id: TENANT, branch_id: null, product_id: 5, product_name: 'Shawarma', is_86ed: true,
      }).execute();
      await expect86Error(
        assertProductsNot86ed(db, TENANT, 1, [{ productId: 5 }]),
        'Shawarma',
      );
      // One 86'd line among clean ones names exactly that line.
      await expect86Error(
        assertProductsNot86ed(db, TENANT, 1, [{ productId: 9 }, { productId: 5 }]),
        'Shawarma',
      );
      // A clean product passes.
      await assertProductsNot86ed(db, TENANT, 1, [{ productId: 9 }]);
      // An un-86'd row (is_86ed false) does not block.
      await (db as any).insertInto('restaurant_86_items').values({
        tenant_id: TENANT, branch_id: null, product_id: 6, product_name: 'Fries', is_86ed: false,
      }).execute();
      await assertProductsNot86ed(db, TENANT, 1, [{ productId: 6 }]);
      // A branch-scoped 86 on branch 2 does not block branch 1, but
      // blocks branch 2.
      await (db as any).insertInto('restaurant_86_items').values({
        tenant_id: TENANT, branch_id: 2, product_id: 7, product_name: 'Soup', is_86ed: true,
      }).execute();
      await assertProductsNot86ed(db, TENANT, 1, [{ productId: 7 }]);
      await expect86Error(
        assertProductsNot86ed(db, TENANT, 2, [{ productId: 7 }]),
        'Soup',
      );
    } finally { await db.destroy(); }
  }

  // Part B: createSale.
  {
    // 86'd product -> 422 naming it, before any sale insert.
    const service = buildCreateSaleService(saleSettings(), [{ product_id: 1, product_name: 'Widget' }]);
    const { payload, auth } = createSalePayload();
    await assert.rejects(
      async () => service.createSale(payload, auth),
      (err: any) => err?.code === 'ITEM_86ED' && err?.statusCode === 422 && String(err?.message || '').includes('Widget'),
    );
    // Clean sale -> still reaches the sales insert.
    const cleanService = buildCreateSaleService(saleSettings(), []);
    const { payload: payload2, auth: auth2 } = createSalePayload();
    await assert.rejects(async () => cleanService.createSale(payload2, auth2), /SALE_INSERT_REACHED/);
  }

  // Part C: createOnlineOrder.
  // One PGlite instance shared by all four cases (TRUNCATE between
  // them): a fresh instance per case OOM-killed the VM.
  {
    const { pg, db } = await makeOnlineDb();
    try {
      const service = buildOnlineService(db);
      const resetOnline = async () => {
        await pg.exec('TRUNCATE online_orders, restaurant_86_items RESTART IDENTITY');
      };

      // Tenant-wide 86 -> 422 naming the item, no order row created.
      await seed86(db, { product_id: 101, product_name: 'Product 101', branch_id: null, is_86ed: true });
      await assert.rejects(
        async () => service.createOnlineOrder(SLUG, onlineOrderDto() as any),
        (err: any) => err?.code === 'ITEM_86ED' && err?.statusCode === 422 && String(err?.message || '').includes('Product 101'),
      );
      const count = await (db as any).selectFrom('online_orders').select('id').execute();
      assert.equal(count.length, 0, 'an 86-blocked order must not be recorded');
      await resetOnline();

      // 86 scoped to the order's branch (1) -> 422.
      await seed86(db, { product_id: 101, product_name: 'Product 101', branch_id: 1, is_86ed: true });
      await assert.rejects(
        async () => service.createOnlineOrder(SLUG, onlineOrderDto() as any),
        (err: any) => err?.code === 'ITEM_86ED' && err?.statusCode === 422,
      );
      await resetOnline();

      // 86 scoped to another branch (2) -> the order goes through.
      await seed86(db, { product_id: 101, product_name: 'Product 101', branch_id: 2, is_86ed: true });
      const resultOtherBranch: any = await service.createOnlineOrder(SLUG, onlineOrderDto() as any);
      assert.ok(resultOtherBranch.orderId, 'the order must be created when the 86 is for another branch');
      await resetOnline();

      // Un-86 then order -> success.
      await seed86(db, { product_id: 101, product_name: 'Product 101', branch_id: null, is_86ed: false });
      const result: any = await service.createOnlineOrder(SLUG, onlineOrderDto() as any);
      assert.ok(result.orderId, 'the order must be created once the item is un-86ed');
      assert.equal(Number(result.totalAmount), 50);
    } finally { await db.destroy(); }
  }

  console.log('Restaurant 86 enforcement tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
