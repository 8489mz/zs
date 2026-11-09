/*
 * R7-B1 (INV-REST-KIOSK-MODIFIER-UI): the backend half of kiosk modifiers.
 * Three server promises are pinned here, driving the real StorefrontService
 * over PGlite:
 *
 * (a) PUBLIC FETCH: GET-equivalent getProductModifiers(slug, productId)
 *     returns the product's linked groups with server option prices —
 *     active groups/options only, unlinked products get { groups: [] },
 *     another tenant's slug never serves this tenant's groups, and the
 *     payload never contains a costPrice (public must not leak cost).
 * (b) DTO: OnlineOrderItemDto accepts a modifiers array in the POS
 *     shape (optionId/productId/name/price/qty); a modifier qty of 0
 *     fails validation.
 * (c) ORDER: createOnlineOrder runs the R4-C contract — a spoofed
 *     client modifier price is re-priced to server truth, the line
 *     total is qty x (base + sum(mod price x qty)), the re-priced
 *     modifiers are stored in items_json AND on the kitchen-draft
 *     sale_items row (what the KDS reads); a missing mandatory group,
 *     an unknown optionId, or a modifier with no price truth all fail
 *     as 422 with the contract's specific code and leave no order row.
 *     The contract binds ONLY lines that carry modifiers: a
 *     modifier-less order for a mandatory-group product still
 *     succeeds, so the web storefront (no modifier UI) is untouched.
 * (d) 86: a modifier whose stock component is 86'd fails as 422
 *     ITEM_86ED, like an 86'd line.
 * (e) GATE: the contract runs only for restaurant tenants — the same
 *     feature gate createSale uses. A non-restaurant tenant's modifiers
 *     are stored as sent with no group enforcement (POS parity).
 * (f) EDIT + CONVERT: updateCustomerOrder keeps the modifiers (same
 *     contract, re-priced totals) and convertToSale hands them to the
 *     posted sale's lines (captured salesService stub).
 *
 * HOW THIS IS DRIVEN: the real StorefrontService over PGlite, restaurant
 * tenant with explicit 'storefront' + 'restaurant' grants; out-of-stock
 * ordering allowed for restaurants, so no stock reservation runs.
 * `salesService` is a stub everywhere except case (f-convert), where it
 * only captures the payload createSale would receive. ONE PGlite
 * database serves the whole file (reset + re-seeded per case): ten
 * fresh databases in one process OOM-killed this VM twice while sibling
 * specs ran alongside, always after the sixth database.
 *
 * RED PROOF: on the unfixed tree the fetch method does not exist, the
 * DTO drops modifiers, and the order total omits them (2 x 100 = 200,
 * not 290) with modifiers: null on the draft — cases (a), (c), (d),
 * (e), (f) fail there for the right reason.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
// The idempotent access token is derived from SESSION_CSRF_SECRET (≥16
// chars); the test harness sets a test-only value when none is configured.
process.env.SESSION_CSRF_SECRET ??= 'test-only-kiosk-modifier-secret';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Database } from '../../src/database/database.types';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';
import { CreateOnlineOrderDto } from '../../src/modules/storefront/dto/create-online-order.dto';

const TENANT = 't1';
const SLUG = 'test-shop';
const TENANT2 = 't2';
const SLUG2 = 'other-shop';
const TENANT3 = 't3';
const SLUG3 = 'retail-shop';

const ALL_TABLES = [
  'tenants', 'settings', 'products', 'product_offers', 'branches',
  'online_orders', 'sales', 'sale_items', 'storefront_abandoned_carts',
  'cashier_shifts', 'pos_modifier_groups', 'pos_modifier_options',
  'product_pos_modifiers', 'addons', 'restaurant_86_items', 'customers',
  'delivery_representatives',
].join(', ');

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY, slug text, custom_domain text, activity_type text, plan_id text, extra_features jsonb, owner_phone text, status text, trial_ends_at timestamptz, created_at timestamptz DEFAULT NOW());
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, metadata jsonb, updated_at timestamptz);
    CREATE TABLE product_offers (id bigint PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, is_active boolean DEFAULT true);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_name text, customer_phone text, customer_address text, customer_notes text, items_json text, subtotal numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, total_amount numeric DEFAULT 0, status text, payment_method text, payment_status text, gateway_provider text, gateway_transaction_id text, gateway_order_id text, gateway_response_json text, paid_at timestamptz, pager_number text, coupon_code text, discount_amount numeric DEFAULT 0, delivery_zone_id bigint, delivery_zone_name text, branch_id bigint, sale_id bigint, shipping_carrier text, fulfillment_type text, country_code text, pickup_branch_id bigint, access_token_hash text, kitchen_draft_sale_id bigint, order_type text, table_number text, stock_reserved boolean DEFAULT false, reserved_branch_id bigint, reserved_location_id bigint, stock_reserved_at timestamptz, idempotency_key text, dispatched_at timestamptz, delivered_at timestamptz, driver_cash_settled boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, cancelled_at timestamptz, cancelled_by bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, settled_at timestamptz, settled_by bigint, eta_uuid text, eta_submission_id text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE storefront_abandoned_carts (id bigserial PRIMARY KEY, tenant_id text, customer_phone text, recovered boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, expected_cash numeric, counted_cash numeric, variance numeric, closed_at timestamptz, closed_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE pos_modifier_groups (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, selection_type text DEFAULT 'multiple', is_mandatory boolean DEFAULT false, min_selections int DEFAULT 0, max_selections int DEFAULT 10, display_order int DEFAULT 0, is_active boolean DEFAULT true, is_splittable_in_half boolean DEFAULT false);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, account_id text, group_id bigint, name text, name_en text, price numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, display_order int DEFAULT 0, component_product_id bigint, consumption_qty numeric, unit_name text, portion_allowed text DEFAULT 'both', preparation_time_minutes int DEFAULT 0);
    CREATE TABLE product_pos_modifiers (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, modifier_group_id bigint);
    CREATE TABLE addons (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, price numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true);
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT true, reason text);
    CREATE TABLE customers (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, address text, balance numeric DEFAULT 0, customer_type text, is_active boolean DEFAULT true);
    CREATE TABLE delivery_representatives (id bigserial PRIMARY KEY, tenant_id text, account_id text, name text, phone text, is_active boolean DEFAULT true, rep_type text);
  `);
  return { pg, db };
}

/** Empty every table (identities reset) so each case starts from a clean slate. */
async function resetDb(pg: PGlite): Promise<void> {
  await pg.exec(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE;`);
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({
    id: TENANT, slug: SLUG, activity_type: 'restaurant', plan_id: 'plan_basic',
    extra_features: '["storefront", "restaurant"]', owner_phone: null,
  }).execute();
  await anyDb.insertInto('tenants').values({
    id: TENANT2, slug: SLUG2, activity_type: 'restaurant', plan_id: 'plan_basic',
    extra_features: '["storefront", "restaurant"]', owner_phone: null,
  }).execute();
  await anyDb.insertInto('tenants').values({
    id: TENANT3, slug: SLUG3, activity_type: 'retail_general', plan_id: 'plan_basic',
    extra_features: '["storefront"]', owner_phone: null,
  }).execute();
  for (const tenantId of [TENANT, TENANT2, TENANT3]) {
    await anyDb.insertInto('settings').values({ tenant_id: tenantId, key: 'currency', value: 'EGP' }).execute();
    await anyDb.insertInto('settings').values({ tenant_id: tenantId, key: 'timezone', value: 'Africa/Cairo' }).execute();
  }
  // The retail tenant allows out-of-stock ordering, so its cases stay
  // on the modifier-contract gate instead of detouring into the
  // location-stock scope (pinned by other specs).
  await anyDb.insertInto('settings').values({ tenant_id: TENANT3, key: 'storefront_allow_out_of_stock', value: 'true' }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', is_active: true, default_stock_location_id: 10 }).execute();
  await anyDb.insertInto('branches').values({ id: 2, tenant_id: TENANT2, name: 'Main', is_active: true }).execute();
  await anyDb.insertInto('branches').values({ id: 3, tenant_id: TENANT3, name: 'Main', is_active: true }).execute();
  // Burger 101 (retail 100) + cheese component 102 (retail 5, cost 2).
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: `${TENANT}:main`, name: 'Burger',
    stock_qty: 100, cost_price: 40, retail_price: 100,
    wholesale_price: 100, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('products').values({
    id: 102, tenant_id: TENANT, account_id: `${TENANT}:main`, name: 'Cheese',
    stock_qty: 100, cost_price: 2, retail_price: 5,
    wholesale_price: 5, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('products').values({
    id: 103, tenant_id: TENANT, account_id: `${TENANT}:main`, name: 'Fries, no groups',
    stock_qty: 100, cost_price: 5, retail_price: 30,
    wholesale_price: 30, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('products').values({
    id: 201, tenant_id: TENANT2, account_id: `${TENANT2}:main`, name: 'T2 Shawarma',
    stock_qty: 100, cost_price: 20, retail_price: 50,
    wholesale_price: 50, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
  await anyDb.insertInto('products').values({
    id: 301, tenant_id: TENANT3, account_id: `${TENANT3}:main`, name: 'Retail Shirt',
    stock_qty: 100, cost_price: 30, retail_price: 100,
    wholesale_price: 100, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
  // Groups for the burger: 1 Sauces (mandatory, single) + 2 Extras
  // (optional, multiple) + 3 inactive (never served).
  await anyDb.insertInto('pos_modifier_groups').values([
    { id: 1, tenant_id: TENANT, account_id: `${TENANT}:main`, name: 'Sauces', selection_type: 'single', is_mandatory: true, min_selections: 1, max_selections: 1, display_order: 1, is_active: true },
    { id: 2, tenant_id: TENANT, account_id: `${TENANT}:main`, name: 'Extras', selection_type: 'multiple', is_mandatory: false, min_selections: 0, max_selections: 10, display_order: 2, is_active: true },
    { id: 3, tenant_id: TENANT, account_id: `${TENANT}:main`, name: 'Retired', selection_type: 'multiple', is_mandatory: false, min_selections: 0, max_selections: 10, display_order: 3, is_active: false },
    { id: 4, tenant_id: TENANT2, account_id: `${TENANT2}:main`, name: 'T2 Group', selection_type: 'multiple', is_mandatory: false, min_selections: 0, max_selections: 10, display_order: 1, is_active: true },
    { id: 5, tenant_id: TENANT3, account_id: `${TENANT3}:main`, name: 'Retail Mandatory', selection_type: 'single', is_mandatory: true, min_selections: 1, max_selections: 1, display_order: 1, is_active: true },
  ]).execute();
  await anyDb.insertInto('pos_modifier_options').values([
    { id: 11, tenant_id: TENANT, account_id: `${TENANT}:main`, group_id: 1, name: 'Ketchup', price: 0, cost_price: 0, is_default: true, is_active: true, display_order: 1 },
    { id: 12, tenant_id: TENANT, account_id: `${TENANT}:main`, group_id: 1, name: 'Mayo', price: 5, cost_price: 1, is_default: false, is_active: true, display_order: 2 },
    { id: 13, tenant_id: TENANT, account_id: `${TENANT}:main`, group_id: 2, name: 'Extra cheese', price: 20, cost_price: 2, is_default: false, is_active: true, display_order: 1, component_product_id: 102 },
    { id: 14, tenant_id: TENANT, account_id: `${TENANT}:main`, group_id: 2, name: 'Hidden', price: 99, cost_price: 50, is_default: false, is_active: false, display_order: 2 },
    { id: 15, tenant_id: TENANT2, account_id: `${TENANT2}:main`, group_id: 4, name: 'T2 Option', price: 7, cost_price: 1, is_default: false, is_active: true, display_order: 1 },
    { id: 16, tenant_id: TENANT3, account_id: `${TENANT3}:main`, group_id: 5, name: 'Retail Option', price: 9, cost_price: 1, is_default: false, is_active: true, display_order: 1 },
  ]).execute();
  await anyDb.insertInto('product_pos_modifiers').values([
    { id: 1, tenant_id: TENANT, account_id: `${TENANT}:main`, product_id: 101, modifier_group_id: 1 },
    { id: 2, tenant_id: TENANT, account_id: `${TENANT}:main`, product_id: 101, modifier_group_id: 2 },
    { id: 3, tenant_id: TENANT, account_id: `${TENANT}:main`, product_id: 101, modifier_group_id: 3 },
    { id: 4, tenant_id: TENANT2, account_id: `${TENANT2}:main`, product_id: 201, modifier_group_id: 4 },
    { id: 5, tenant_id: TENANT3, account_id: `${TENANT3}:main`, product_id: 301, modifier_group_id: 5 },
  ]).execute();
}

async function openShift(db: Kysely<Database>): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    tenant_id: TENANT, account_id: `${TENANT}:main`, opened_by: 7, status: 'open',
    branch_id: 1, location_id: null,
  }).execute();
}

function buildService(db: Kysely<Database>, salesService?: any): StorefrontService {
  const checker = new PlanFeatureService(undefined as any);
  return new StorefrontService(db, salesService ?? ({} as never), {} as never, {} as never, undefined, checker);
}

async function readOrder(db: Kysely<Database>, orderId: number): Promise<any> {
  return (db as any).selectFrom('online_orders').selectAll()
    .where('id', '=', orderId).executeTakeFirstOrThrow();
}

async function countOrders(db: Kysely<Database>, tenantId: string): Promise<number> {
  const rows = await (db as any).selectFrom('online_orders').select('id')
    .where('tenant_id', '=', tenantId).execute();
  return rows.length;
}

function storedModifiers(order: any): any[] {
  const items = JSON.parse(order.items_json || '[]');
  return items[0]?.modifiers || [];
}

/** The valid kiosk selection: mayo (server 5) + extra cheese x2 (server 20 each). */
function validModifiers(): any[] {
  return [
    { optionId: 12, productId: 0, groupId: 1, groupName: 'Sauces', name: 'Mayo', qty: 1, price: 999 },
    { optionId: 13, productId: 102, groupId: 2, groupName: 'Extras', name: 'Extra cheese', qty: 2, price: 1 },
  ];
}

function expectAppErrorCode(error: unknown, code: string, statusCode: number): void {
  const err = error as any;
  assert.equal(err?.code, code, `expected AppError code ${code}, got ${err?.code}: ${err?.message}`);
  assert.equal(err?.statusCode, statusCode, `expected status ${statusCode} for ${code}, got ${err?.statusCode}`);
}

async function main(): Promise<void> {
  const { pg, db } = await makeDb();
  try {
    // (a) PUBLIC FETCH: linked groups with server prices, active only,
    // no costPrice anywhere, tenant-isolated, unlinked -> empty.
    {
      await resetDb(pg);
      await seedFoundation(db);
      const service = buildService(db);
      const fetched: any = await service.getProductModifiers(SLUG, 101);
      assert.equal(fetched.groups.length, 2, 'only the two active linked groups are served (inactive group excluded)');
      assert.deepEqual(fetched.groups.map((g: any) => g.name), ['Sauces', 'Extras'], 'groups come back in display order');
      const sauces = fetched.groups[0];
      assert.equal(sauces.isMandatory, true, 'the mandatory flag travels with the group');
      assert.equal(sauces.selectionType, 'single', 'the single-select rule travels with the group');
      assert.deepEqual(sauces.options.map((o: any) => o.name), ['Ketchup', 'Mayo'], 'both sauce options are served');
      assert.deepEqual(sauces.options.map((o: any) => o.price), [0, 5], 'option prices are the server prices');
      const extras = fetched.groups[1];
      assert.deepEqual(extras.options.map((o: any) => o.name), ['Extra cheese'], 'the inactive option is excluded');
      assert.equal(extras.options[0].componentProductId, 102, 'the cheese option names its stock component');
      assert.ok(!JSON.stringify(fetched).includes('costPrice'), 'no cost price leaks into a public response');
      assert.ok(!JSON.stringify(fetched).includes('cost_price'), 'no cost price leaks under any key spelling');
      const unlinked: any = await service.getProductModifiers(SLUG, 103);
      assert.deepEqual(unlinked, { groups: [] }, 'a product with no linked groups shows no groups, never all of them');
      const crossTenant: any = await service.getProductModifiers(SLUG2, 101);
      assert.deepEqual(crossTenant, { groups: [] }, "another tenant's slug never serves this tenant's groups");
      const wrongProduct: any = await service.getProductModifiers(SLUG, 201);
      assert.deepEqual(wrongProduct, { groups: [] }, "this tenant's slug never serves another tenant's product groups");
      const other: any = await service.getProductModifiers(SLUG2, 201);
      assert.equal(other.groups.length, 1, 'the other tenant still sees its own groups on its own slug');
      assert.equal(other.groups[0].options[0].price, 7, 'the other tenant sees its own option price');
      await assert.rejects(
        service.getProductModifiers('no-such-shop', 101),
        /المتجر غير موجود/,
        'an unknown slug is a 404, never an empty catalog',
      );
      console.log('  public modifier fetch passed');
    }

    // (b) DTO: a valid modifiers array validates; a modifier qty of 0 fails.
    {
      const valid = plainToInstance(CreateOnlineOrderDto, {
        customerName: 'عميل اختبار',
        items: [{ productId: 101, quantity: 2, modifiers: validModifiers() }],
      });
      const validErrors = await validate(valid);
      assert.deepEqual(
        validErrors.map((e) => e.property),
        [],
        'a DTO with a valid modifiers array must validate',
      );
      const badQty = plainToInstance(CreateOnlineOrderDto, {
        customerName: 'عميل اختبار',
        items: [{ productId: 101, quantity: 1, modifiers: [{ optionId: 12, qty: 0, price: 5 }] }],
      });
      const badQtyErrors = await validate(badQty);
      assert.ok(
        JSON.stringify(badQtyErrors).includes('qty'),
        'a modifier qty of 0 must fail DTO validation',
      );
      const notArray = plainToInstance(CreateOnlineOrderDto, {
        customerName: 'عميل اختبار',
        items: [{ productId: 101, quantity: 1, modifiers: 'not-an-array' }],
      });
      const notArrayErrors = await validate(notArray);
      assert.ok(notArrayErrors.length > 0, 'modifiers that are not an array must fail DTO validation');
      console.log('  DTO modifier acceptance passed');
    }

    // (c) ORDER: spoofed prices are re-priced, totals include modifiers,
    // items_json + the kitchen draft store the re-priced selection.
    {
      await resetDb(pg);
      await seedFoundation(db);
      await openShift(db);
      const service = buildService(db);
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        countryCode: 'EG',
        orderType: 'dine_in',
        tableNumber: '5',
        items: [{ productId: 101, quantity: 2, modifiers: validModifiers() }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'the order with valid modifiers must be created');
      // 2 x (100 base + 5 mayo + 2 x 20 cheese) = 290 — the spoofed
      // 999 / 1 client prices must not reach the total.
      assert.equal(Number(result.totalAmount), 290, 'the total is the server total with modifiers (2 x 145), not the spoofed sum');
      assert.equal(Number(result.subtotal), 290, 'the subtotal carries the modifiers too');
      const order = await readOrder(db, Number(result.orderId));
      const mods = storedModifiers(order);
      assert.equal(mods.length, 2, 'both modifiers are stored in items_json');
      assert.equal(Number(mods.find((m: any) => m.optionId === 12)?.price), 5, 'the spoofed mayo price 999 is re-priced to the server 5');
      assert.equal(Number(mods.find((m: any) => m.optionId === 13)?.price), 20, 'the spoofed cheese price 1 is re-priced to the server 20');
      assert.equal(Number(result.items[0].total), 290, 'the returned line total carries the modifiers');
      assert.equal(Number(result.items[0].unitPrice), 100, 'the returned unit price stays the base price (POS sale_items shape)');
      // Kitchen draft: the KDS reads sale_items, so the mods must be there.
      const draftItems = await (db as any).selectFrom('sale_items').selectAll()
        .where('sale_id', '=', Number(order.kitchen_draft_sale_id)).execute();
      assert.equal(draftItems.length, 1, 'the draft has one line');
      const draftMods = typeof draftItems[0].modifiers === 'string'
        ? JSON.parse(draftItems[0].modifiers)
        : draftItems[0].modifiers;
      assert.equal(draftMods.length, 2, 'the draft line carries both modifiers for the kitchen');
      assert.equal(Number(draftMods.find((m: any) => m.optionId === 12)?.price), 5, 'the draft carries the re-priced mayo');
      assert.equal(Number(draftItems[0].line_total), 290, 'the draft line total carries the modifiers');
      console.log('  order re-price + totals + storage passed');
    }

    // (d) ORDER: a missing mandatory group fails as 422 and leaves no order.
    {
      await resetDb(pg);
      await seedFoundation(db);
      await openShift(db);
      const service = buildService(db);
      await assert.rejects(
        service.createOnlineOrder(SLUG, {
          customerName: 'عميل اختبار',
          countryCode: 'EG',
          orderType: 'dine_in',
          tableNumber: '5',
          items: [{ productId: 101, quantity: 1, modifiers: [{ optionId: 13, productId: 102, name: 'Extra cheese', qty: 1, price: 20 }] }],
          paymentMethod: 'cod',
        } as any),
        (error: unknown) => {
          expectAppErrorCode(error, 'RESTAURANT_MODIFIER_RULE_VIOLATED', 422);
          return true;
        },
        'skipping the mandatory Sauces group must fail as 422 RULE_VIOLATED',
      );
      assert.equal(await countOrders(db, TENANT), 0, 'the refused order leaves no order row');
      console.log('  mandatory group rejection passed');
    }

    // (e) ORDER: an unknown optionId fails as 422 OPTION_INVALID, no order.
    {
      await resetDb(pg);
      await seedFoundation(db);
      await openShift(db);
      const service = buildService(db);
      await assert.rejects(
        service.createOnlineOrder(SLUG, {
          customerName: 'عميل اختبار',
          countryCode: 'EG',
          orderType: 'dine_in',
          tableNumber: '5',
          items: [{ productId: 101, quantity: 1, modifiers: [{ optionId: 9999, name: 'Ghost', qty: 1, price: 1 }] }],
          paymentMethod: 'cod',
        } as any),
        (error: unknown) => {
          expectAppErrorCode(error, 'RESTAURANT_MODIFIER_OPTION_INVALID', 422);
          return true;
        },
        'an unknown optionId must fail as 422 OPTION_INVALID',
      );
      assert.equal(await countOrders(db, TENANT), 0, 'the refused order leaves no order row');
      console.log('  unknown option rejection passed');
    }

    // (f) ORDER: a modifier with no price truth fails as 422
    // PRICE_UNVERIFIED — a name-only mod, and a negative client price
    // on a bare product mod (no configured price to fall back to).
    {
      await resetDb(pg);
      await seedFoundation(db);
      await openShift(db);
      const service = buildService(db);
      await assert.rejects(
        service.createOnlineOrder(SLUG, {
          customerName: 'عميل اختبار',
          countryCode: 'EG',
          orderType: 'dine_in',
          tableNumber: '5',
          items: [{ productId: 101, quantity: 1, modifiers: [{ name: 'Ghost', qty: 1, price: 50 }] }],
          paymentMethod: 'cod',
        } as any),
        (error: unknown) => {
          expectAppErrorCode(error, 'RESTAURANT_MODIFIER_PRICE_UNVERIFIED', 422);
          return true;
        },
        'a name-only modifier with no server truth must fail as 422 PRICE_UNVERIFIED',
      );
      await assert.rejects(
        service.createOnlineOrder(SLUG, {
          customerName: 'عميل اختبار',
          countryCode: 'EG',
          orderType: 'dine_in',
          tableNumber: '5',
          items: [{ productId: 101, quantity: 1, modifiers: [
            { optionId: 12, name: 'Mayo', qty: 1, price: 5 },
            { productId: 102, name: 'Cheese', qty: 1, price: -5 },
          ] }],
          paymentMethod: 'cod',
        } as any),
        (error: unknown) => {
          expectAppErrorCode(error, 'RESTAURANT_MODIFIER_PRICE_UNVERIFIED', 422);
          return true;
        },
        'a negative client price on a bare product mod must fail as 422 PRICE_UNVERIFIED',
      );
      assert.equal(await countOrders(db, TENANT), 0, 'the refused orders leave no order rows');
      console.log('  unverified modifier price rejection passed');
    }

    // (g) 86: a modifier whose stock component is 86'd fails as 422 ITEM_86ED.
    {
      await resetDb(pg);
      await seedFoundation(db);
      await openShift(db);
      await (db as any).insertInto('restaurant_86_items').values({
        tenant_id: TENANT, branch_id: null, product_id: 102, product_name: 'Cheese', is_86ed: true,
      }).execute();
      const service = buildService(db);
      await assert.rejects(
        service.createOnlineOrder(SLUG, {
          customerName: 'عميل اختبار',
          countryCode: 'EG',
          orderType: 'dine_in',
          tableNumber: '5',
          items: [{ productId: 101, quantity: 1, modifiers: validModifiers() }],
          paymentMethod: 'cod',
        } as any),
        (error: unknown) => {
          expectAppErrorCode(error, 'ITEM_86ED', 422);
          return true;
        },
        'an 86’d cheese component must refuse the order as 422 ITEM_86ED',
      );
      assert.equal(await countOrders(db, TENANT), 0, 'the refused order leaves no order row');
      console.log('  86’d modifier component rejection passed');
    }

    // (h) GATE: a non-restaurant tenant is NOT contract-enforced — the
    // mandatory group is not enforced and an unknown option's client
    // price is stored as sent (POS parity for the feature-off path).
    {
      await resetDb(pg);
      await seedFoundation(db);
      const service = buildService(db);
      const result: any = await service.createOnlineOrder(SLUG3, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        customerAddress: 'شارع التحرير 12، القاهرة',
        orderType: 'delivery',
        fulfillmentType: 'delivery',
        items: [{ productId: 301, quantity: 1, modifiers: [{ optionId: 9999, name: 'Ghost', qty: 1, price: 77 }] }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'the non-restaurant order must be created without contract enforcement');
      assert.equal(Number(result.totalAmount), 177, 'the non-restaurant total keeps the client modifier price as sent (100 + 77)');
      const order = await readOrder(db, Number(result.orderId));
      assert.equal(Number(storedModifiers(order)[0]?.price), 77, 'the non-restaurant modifier is stored as sent');
      console.log('  non-restaurant gate pass-through passed');
    }

    // (i) EDIT: updateCustomerOrder keeps the modifiers, re-priced, with
    // the total following the new quantity.
    {
      await resetDb(pg);
      await seedFoundation(db);
      const service = buildService(db);
      const created: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        customerAddress: 'شارع التحرير 12، القاهرة',
        orderType: 'delivery',
        fulfillmentType: 'delivery',
        items: [{ productId: 101, quantity: 1, modifiers: [
          { optionId: 12, groupId: 1, name: 'Mayo', qty: 1, price: 999 },
        ] }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(Number(created.totalAmount), 105, 'the created delivery order totals 100 + 5 mayo');
      const updated: any = await service.updateCustomerOrder(SLUG, created.orderNumber, created.accessToken, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        customerAddress: 'شارع التحرير 12، القاهرة',
        items: [{ productId: 101, quantity: 2, modifiers: [
          { optionId: 12, groupId: 1, name: 'Mayo', qty: 1, price: 999 },
        ] }],
      } as any);
      assert.equal(updated.ok, true, 'the edit must succeed');
      assert.equal(Number(updated.totalAmount), 210, 'the edited total follows the new quantity with the re-priced mayo (2 x 105)');
      const order = await readOrder(db, Number(created.orderId));
      const mods = storedModifiers(order);
      assert.equal(mods.length, 1, 'the edit keeps the modifier instead of silently dropping it');
      assert.equal(Number(mods[0]?.price), 5, 'the kept modifier is still the server price, not the spoofed 999');
      assert.equal(await countOrders(db, TENANT), 1, 'the edit rewrites the order, it does not create a second one');
      console.log('  edit keeps modifiers passed');
    }

    // (j) CONVERT: convertToSale hands the stored modifiers to the
    // posted sale's lines (captured salesService stub — the real
    // createSale then re-prices, enforces and costs them).
    {
      await resetDb(pg);
      await seedFoundation(db);
      let captured: any = null;
      const salesStub = {
        createSale: async (payload: any) => {
          captured = payload;
          return { id: 999 };
        },
        // convertToSale reads the full sale back after creating it.
        getSaleById: async () => null,
      };
      const service = buildService(db, salesStub);
      const created: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        customerAddress: 'شارع التحرير 12، القاهرة',
        orderType: 'delivery',
        fulfillmentType: 'delivery',
        items: [{ productId: 101, quantity: 1, modifiers: validModifiers() }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(Number(created.totalAmount), 145, 'the delivery order totals 100 + 5 + 40 before conversion');
      const converted: any = await service.convertToSale(Number(created.orderId), {
        tenantId: TENANT, accountId: `${TENANT}:main`, userId: 1, role: 'admin',
      } as any);
      assert.equal(converted.ok, true, 'the conversion must succeed');
      assert.equal(Number(converted.saleId), 999, 'the conversion returns the created sale id');
      assert.ok(captured, 'createSale must have been called');
      assert.equal(captured.items.length, 1, 'one sale line is created');
      assert.equal(captured.items[0].modifiers.length, 2, 'both modifiers ride into the sale line');
      assert.equal(Number(captured.items[0].modifiers.find((m: any) => m.optionId === 12)?.price), 5, 'the sale line carries the re-priced mayo');
      assert.equal(Number(captured.items[0].modifiers.find((m: any) => m.optionId === 13)?.price), 20, 'the sale line carries the re-priced cheese');
      assert.equal(Number(captured.items[0].price), 100, 'the sale line price stays the base price (createSale adds the modifiers)');
      console.log('  conversion carries modifiers passed');
    }

    // (k) SCOPE: a modifier-less order for a product WITH a mandatory
    // group still succeeds — the contract binds only lines that carry
    // modifiers, so the web storefront (no modifier UI) keeps working
    // for grouped products. Only a sent selection is validated.
    {
      await resetDb(pg);
      await seedFoundation(db);
      await openShift(db);
      const service = buildService(db);
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        countryCode: 'EG',
        orderType: 'dine_in',
        tableNumber: '5',
        items: [{ productId: 101, quantity: 1 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'a modifier-less order must still be created even when the product has a mandatory group');
      assert.equal(Number(result.totalAmount), 100, 'the modifier-less total is the base price only');
      const order = await readOrder(db, Number(result.orderId));
      assert.deepEqual(storedModifiers(order), [], 'no modifiers are stored on a modifier-less line');
      console.log('  modifier-less order untouched passed');
    }
  } finally {
    await db.destroy();
  }

  console.log('kiosk-modifier-order.spec: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
