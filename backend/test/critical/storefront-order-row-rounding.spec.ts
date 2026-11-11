/*
New file: backend/test/critical/storefront-order-row-rounding.spec.ts

WHAT THIS PINS (INV-SF-ORDER-ROW-ROUNDING): the stored order row totals
are rounded at book digits. D-SF-08: createOnlineOrder and
updateCustomerOrder computed totalAmount = max(0, subtotal - discount)
+ deliveryFee as raw float arithmetic and stored subtotal /
delivery_fee / discount_amount / total_amount unrounded, while the
quote path rounded every output. A sum of rounded lines can still
carry float dust (0.1 + 0.2 = 0.30000000000000004), so the stored row
disagreed with the quote the customer saw and with the invoice the
conversion recomputes — by a fraction of a piastre, on every dusty
order, silently.

THE FIX: both functions round the four stored values at book digits
(storefrontMoneyDigits) right where totalAmount is computed, and the
total is recomputed from the rounded components so the stored total
equals the stored parts exactly. The kitchen-draft sale row (dine-in /
pickup only) carries the same rounded discount + total. The quote path
is untouched — it already rounded its outputs.

THE CASES, WORKED ONCE (tenant 't1', EGP, 2dp; products 101 @ 0.10,
102 @ 0.20, 103 @ 0.30, stock 100):
(a) Create, two dusty lines (0.10 + 0.20): the stored subtotal is
exactly 0.30 and the stored total_amount is exactly 0.30 — not
0.30000000000000004. The response total is 0.30 too, and the stored
line totals sum to the stored subtotal.
(b) Create with a dusty settings delivery fee (7.335): the stored
delivery_fee equals roundMoney(7.335, 2) and the stored total equals
the rounded sum of the stored parts (subtotal + fee - discount).
(c) Update, three dusty lines (0.10 + 0.20 + 0.30 = 0.6000000000000001
raw): the stored subtotal is exactly 0.60 and the stored total is
exactly 0.60.

HOW THIS IS DRIVEN: the real createOnlineOrder / updateCustomerOrder
on PGlite, with the fixture copied from
storefront-kiosk-order-truth.spec.ts (same tenant, branch, products,
real PlanFeatureService; delivery orders need no open shift). The
update case uses the access token the create result returns, exactly
as the customer flow does.

HONEST LIMITS, STATED NOT HIDDEN: the dust asserted here is the
classic 0.1 + 0.2 float case at 2dp; 3-decimal tenants round at 3dp
by the same code path (storefrontMoneyDigits), covered by the
line-total-digits spec for the quote — the stored-row 3dp case is
not re-driven here.

RED PROOF: removing the rounding block in createOnlineOrder makes
case (a) fail — the stored subtotal reads 0.30000000000000004.
Proven by targeted reversal, file restored afterwards (never git
checkout on uncommitted work).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
// The idempotent access token is derived from SESSION_CSRF_SECRET (≥16
// chars); the test harness sets a test-only value when none is configured.
process.env.SESSION_CSRF_SECRET ??= 'test-only-order-row-rounding-secret';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';
import { roundMoney } from '../../src/modules/accounting/engines/money-minor-units.engine';

const TENANT = 't1';
const SLUG = 'test-shop';

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY, slug text, custom_domain text, activity_type text, plan_id text, extra_features jsonb, owner_phone text, created_at timestamptz DEFAULT NOW());
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, credit_price numeric DEFAULT 0, consumer_price numeric DEFAULT 0, min_selling_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, item_type text, metadata jsonb, updated_at timestamptz);
    CREATE TABLE product_offers (id bigint PRIMARY KEY, tenant_id text, product_id bigint, offer_type text, value numeric, min_qty numeric, start_date text, end_date text, bogo_buy_qty numeric, bogo_get_qty numeric, bogo_discount_percent numeric, happy_hour_start text, happy_hour_end text, days_of_week text, is_active boolean DEFAULT true);
    CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, is_active boolean DEFAULT true, default_stock_location_id bigint, sales_stock_mode text, allow_external_sales_stock boolean DEFAULT false);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_name text, customer_phone text, customer_address text, customer_notes text, items_json text, subtotal numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, total_amount numeric DEFAULT 0, status text, payment_method text, payment_status text, gateway_provider text, gateway_transaction_id text, gateway_order_id text, gateway_response_json text, paid_at timestamptz, pager_number text, coupon_code text, discount_amount numeric DEFAULT 0, delivery_zone_id bigint, delivery_zone_name text, branch_id bigint, sale_id bigint, shipping_carrier text, fulfillment_type text, country_code text, pickup_branch_id bigint, access_token_hash text, kitchen_draft_sale_id bigint, order_type text, table_number text, stock_reserved boolean DEFAULT false, reserved_branch_id bigint, reserved_location_id bigint, stock_reserved_at timestamptz, idempotency_key text, dispatched_at timestamptz, delivered_at timestamptz, driver_cash_settled boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, cancelled_at timestamptz, cancelled_by bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, settled_at timestamptz, settled_by bigint, eta_uuid text, eta_submission_id text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb NOT NULL DEFAULT '[]'::jsonb, serials jsonb);
    CREATE TABLE storefront_abandoned_carts (id bigserial PRIMARY KEY, tenant_id text, customer_phone text, recovered boolean DEFAULT false, updated_at timestamptz);
    CREATE TABLE pos_modifier_groups (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, selection_type text DEFAULT 'multiple', is_mandatory boolean DEFAULT false, min_selections int DEFAULT 0, max_selections int DEFAULT 10, display_order int DEFAULT 0, is_active boolean DEFAULT true);
    CREATE TABLE pos_modifier_options (id bigint PRIMARY KEY, tenant_id text, account_id text, group_id bigint, name text, name_en text, price numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_default boolean DEFAULT false, is_active boolean DEFAULT true, display_order int DEFAULT 0, component_product_id bigint);
    CREATE TABLE product_pos_modifiers (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, modifier_group_id bigint);
    CREATE TABLE addons (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, price numeric DEFAULT 0, cost_price numeric DEFAULT 0, is_active boolean DEFAULT true);
    CREATE TABLE cashier_shifts (id bigserial PRIMARY KEY, tenant_id text, account_id text, opened_by bigint, status text, branch_id bigint, location_id bigint, opening_cash numeric, expected_cash numeric, counted_cash numeric, variance numeric, closed_at timestamptz, closed_by bigint, created_at timestamptz DEFAULT NOW());
    CREATE TABLE restaurant_86_items (id bigserial PRIMARY KEY, tenant_id text, branch_id bigint, product_id bigint, product_name text, component_product_id bigint, is_86ed boolean DEFAULT true, reason text);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>, deliveryFee?: string): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({
    id: TENANT, slug: SLUG, activity_type: 'restaurant', plan_id: 'plan_basic',
    extra_features: '["storefront"]', owner_phone: null,
  }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'timezone', value: 'Africa/Cairo' }).execute();
  if (deliveryFee !== undefined) {
    await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'storefront_delivery_fee', value: deliveryFee }).execute();
  }
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', is_active: true }).execute();
  for (const [id, price] of [[101, 0.10], [102, 0.20], [103, 0.30]] as Array<[number, number]>) {
    await anyDb.insertInto('products').values({
      id, tenant_id: TENANT, account_id: `${TENANT}:main`, name: `Product ${id}`,
      stock_qty: 100, cost_price: 0.05, retail_price: price,
      wholesale_price: price, min_selling_price: 0, is_active: true, item_type: 'product',
    }).execute();
    await anyDb.insertInto('product_location_stock').values({
      tenant_id: TENANT, account_id: `${TENANT}:main`, product_id: id, branch_id: 1, location_id: 10, qty: 100,
    }).execute();
  }
}

function buildService(db: Kysely<Database>): StorefrontService {
  const checker = new PlanFeatureService(undefined as any);
  return new StorefrontService(db, {} as never, {} as never, {} as never, undefined, checker);
}

async function readOrder(db: Kysely<Database>, orderId: number): Promise<any> {
  return (db as any).selectFrom('online_orders').selectAll()
    .where('id', '=', orderId).executeTakeFirstOrThrow();
}

function storedLineTotal(order: any): number {
  const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : order.items_json;
  return (Array.isArray(items) ? items : []).reduce((sum: number, line: any) => sum + Number(line.total || 0), 0);
}

async function main(): Promise<void> {
  // (a) Create, two dusty lines (0.10 + 0.20 = 0.30000000000000004 raw).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const service = buildService(db);
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        customerAddress: 'شارع التحرير 12، القاهرة',
        orderType: 'delivery',
        fulfillmentType: 'delivery',
        items: [{ productId: 101, quantity: 1 }, { productId: 102, quantity: 1 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'the order must be created');
      assert.equal(Number(result.totalAmount), 0.3, 'the response total is exactly 0.30');
      const order = await readOrder(db, Number(result.orderId));
      assert.equal(Number(order.subtotal), 0.3, 'the stored subtotal is exactly 0.30, not 0.30000000000000004');
      assert.equal(Number(order.total_amount), 0.3, 'the stored total is exactly 0.30');
      assert.equal(Number(order.delivery_fee), 0, 'the stored delivery fee is 0');
      assert.equal(Number(order.discount_amount), 0, 'the stored discount is 0');
      assert.equal(roundMoney(storedLineTotal(order), 2), Number(order.subtotal),
        'the stored subtotal equals the rounded sum of the stored lines');
    } finally {
      await db.destroy();
    }
    console.log('  (a) create stores 0.10 + 0.20 as exactly 0.30 passed');
  }

  // (b) Create with a dusty settings delivery fee (7.335).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db, '7.335');
      const service = buildService(db);
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        customerAddress: 'شارع التحرير 12، القاهرة',
        orderType: 'delivery',
        fulfillmentType: 'delivery',
        items: [{ productId: 101, quantity: 1 }, { productId: 102, quantity: 1 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'the order must be created');
      const expectedFee = roundMoney(7.335, 2);
      const expectedTotal = roundMoney(0.3 + expectedFee, 2);
      const order = await readOrder(db, Number(result.orderId));
      assert.equal(Number(order.delivery_fee), expectedFee, 'the stored fee is the rounded fee');
      assert.equal(Number(order.total_amount), expectedTotal, 'the stored total is the rounded sum of the rounded parts');
      assert.equal(
        roundMoney(Number(order.subtotal) + Number(order.delivery_fee) - Number(order.discount_amount), 2),
        Number(order.total_amount),
        'the stored total equals the rounded sum of the stored parts',
      );
    } finally {
      await db.destroy();
    }
    console.log('  (b) dusty delivery fee stored rounded passed');
  }

  // (c) Update, three dusty lines (0.10 + 0.20 + 0.30 = 0.6000000000000001 raw).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const service = buildService(db);
      const created: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        customerAddress: 'شارع التحرير 12، القاهرة',
        orderType: 'delivery',
        fulfillmentType: 'delivery',
        items: [{ productId: 101, quantity: 1 }, { productId: 102, quantity: 1 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(created.ok, true, 'the order must be created first');
      assert.ok(created.accessToken, 'the create result carries the customer token');
      const updated: any = await service.updateCustomerOrder(SLUG, created.orderNumber, created.accessToken, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        customerAddress: 'شارع التحرير 12، القاهرة',
        orderType: 'delivery',
        fulfillmentType: 'delivery',
        items: [{ productId: 101, quantity: 1 }, { productId: 102, quantity: 1 }, { productId: 103, quantity: 1 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(updated.ok, true, 'the update must succeed');
      assert.equal(Number(updated.totalAmount), 0.6, 'the response total is exactly 0.60');
      const order = await readOrder(db, Number(created.orderId));
      assert.equal(Number(order.subtotal), 0.6, 'the stored subtotal is exactly 0.60, not 0.6000000000000001');
      assert.equal(Number(order.total_amount), 0.6, 'the stored total is exactly 0.60');
      assert.equal(roundMoney(storedLineTotal(order), 2), Number(order.subtotal),
        'the stored subtotal equals the rounded sum of the stored lines');
    } finally {
      await db.destroy();
    }
    console.log('  (c) update stores 0.10 + 0.20 + 0.30 as exactly 0.60 passed');
  }

  console.log('Storefront order row rounding tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
