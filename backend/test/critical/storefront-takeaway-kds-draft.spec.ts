/*
 * R-B3 (INV-REST-TAKEAWAY-KDS-DRAFT): a kiosk takeaway order never reached
 * the kitchen. The kiosk sends orderType 'delivery' + fulfillmentType
 * 'pickup', and createOnlineOrder created the kitchen DRAFT `sales` row —
 * the only thing getActiveTickets reads — only `if (isDineIn)`, so a
 * takeaway order had an online_orders row and no ticket at all.
 *
 * The fix widens the draft to pickup orders too, with order_type 'takeaway'
 * (the canonical POS type for a pickup order — the same value the convert
 * path maps a pickup order to) and no table number. A plain delivery order
 * still gets no draft: the fix is pickup-only by design.
 *
 * HOW THIS IS DRIVEN: the real StorefrontService over PGlite, one fresh
 * database per case, no SalesService chain (createOnlineOrder never calls
 * it) and no gateway — the restaurant tenant orders out of stock, so no
 * location reservation runs. The tenant carries an explicit 'storefront'
 * grant so the entitlement gate passes.
 *
 * RED PROOF: on the unfixed tree case (a) fails — the order is created
 * with kitchen_draft_sale_id NULL and no `sales` row — while (b) and (c)
 * pass unchanged.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';

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
    CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text, account_id text, order_number text, customer_name text, customer_phone text, customer_address text, customer_notes text, items_json text, subtotal numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, total_amount numeric DEFAULT 0, status text, payment_method text, payment_status text, gateway_provider text, gateway_transaction_id text, gateway_order_id text, gateway_response_json text, paid_at timestamptz, pager_number text, coupon_code text, discount_amount numeric DEFAULT 0, delivery_zone_id bigint, delivery_zone_name text, branch_id bigint, sale_id bigint, shipping_carrier text, fulfillment_type text, country_code text, pickup_branch_id bigint, access_token_hash text, kitchen_draft_sale_id bigint, order_type text, table_number text, stock_reserved boolean DEFAULT false, reserved_branch_id bigint, reserved_location_id bigint, stock_reserved_at timestamptz, idempotency_key text, dispatched_at timestamptz, delivered_at timestamptz, driver_cash_settled boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE sales (id bigserial PRIMARY KEY, tenant_id text, account_id text, doc_no text, customer_id bigint, customer_name text, customer_phone text, customer_address text, payment_type text, payment_channel text, subtotal numeric DEFAULT 0, discount numeric DEFAULT 0, delivery_fee numeric DEFAULT 0, delivery_fee_mode text, service_charge numeric DEFAULT 0, tip_amount numeric DEFAULT 0, tax_rate numeric DEFAULT 0, tax_amount numeric DEFAULT 0, prices_include_tax boolean DEFAULT false, total numeric DEFAULT 0, paid_amount numeric DEFAULT 0, applied_amount numeric DEFAULT 0, tendered_amount numeric DEFAULT 0, change_amount numeric DEFAULT 0, store_credit_used numeric DEFAULT 0, note text, status text, collection_status text, branch_id bigint, location_id bigint, created_by bigint, cancelled_at timestamptz, cancelled_by bigint, delivery_rep_id bigint, table_number text, order_type text, guest_count int, zatca_status text, cancel_reason text, delivery_status text, dining_course text, pager_number text, transfer_reference text, transfer_receipt_url text, recipient_name text, recipient_phone text, recipient_signature text, delivery_gps_lat numeric, delivery_gps_lng numeric, delivery_proof_photo text, packaging_breakdown text, is_credit_overridden boolean DEFAULT false, credit_override_by_user_id bigint, credit_override_reason text, terminal_id text, terminal_auth_code text, terminal_rrn text, card_scheme text, card_last_four text, settled_at timestamptz, settled_by bigint, eta_uuid text, eta_submission_id text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, tenant_id text, account_id text, sale_id bigint, product_id bigint, product_name text, product_name_en text, qty numeric, unit_price numeric, line_total numeric, net_unit_price numeric, net_line_total numeric, allocated_discount numeric, allocated_tax numeric, unit_name text, unit_multiplier numeric, cost_price numeric, consumer_price numeric, pricing_tier_type text, unit_offer_savings numeric, is_bonus boolean DEFAULT false, bonus_reason text, price_type text, notes text, modifiers jsonb, serials jsonb);
    CREATE TABLE storefront_abandoned_carts (id bigserial PRIMARY KEY, tenant_id text, customer_phone text, recovered boolean DEFAULT false, updated_at timestamptz);
  `);
  return { pg, db };
}

async function seedFoundation(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({
    id: TENANT, slug: SLUG, activity_type: 'restaurant', plan_id: 'plan_basic',
    extra_features: '["storefront"]', owner_phone: null,
  }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'timezone', value: 'Africa/Cairo' }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Main', is_active: true }).execute();
  await anyDb.insertInto('products').values({
    id: 101, tenant_id: TENANT, account_id: `${TENANT}:main`, name: 'Product 101',
    stock_qty: 100, cost_price: 10, retail_price: 50,
    wholesale_price: 50, min_selling_price: 0, is_active: true, item_type: 'product',
  }).execute();
}

function buildService(db: Kysely<Database>): StorefrontService {
  const checker = new PlanFeatureService(undefined as any);
  return new StorefrontService(db, {} as never, {} as never, {} as never, undefined, checker);
}

async function readOrder(db: Kysely<Database>, orderId: number): Promise<any> {
  return (db as any).selectFrom('online_orders').selectAll()
    .where('id', '=', orderId).executeTakeFirstOrThrow();
}

async function readDraftSale(db: Kysely<Database>, saleId: number): Promise<any> {
  return (db as any).selectFrom('sales').selectAll()
    .where('id', '=', saleId).where('tenant_id', '=', TENANT).executeTakeFirstOrThrow();
}

async function countSales(db: Kysely<Database>): Promise<number> {
  const rows = await (db as any).selectFrom('sales').select('id')
    .where('tenant_id', '=', TENANT).execute();
  return rows.length;
}

async function readDraftItems(db: Kysely<Database>, saleId: number): Promise<any[]> {
  return (db as any).selectFrom('sale_items').selectAll()
    .where('sale_id', '=', saleId).where('tenant_id', '=', TENANT).execute();
}

async function main(): Promise<void> {
  // (a) A kiosk takeaway order creates a kitchen DRAFT sale the KDS can read.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const service = buildService(db);
      // Exactly what the kiosk sends for takeaway (useSelfOrderingKiosk):
      // orderType 'delivery' + fulfillmentType 'pickup'.
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        orderType: 'delivery',
        fulfillmentType: 'pickup',
        items: [{ productId: 101, quantity: 2 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'takeaway order must be created');
      const order = await readOrder(db, Number(result.orderId));
      assert.equal(order.fulfillment_type, 'pickup', 'the order keeps fulfillment pickup');
      assert.equal(order.order_type, 'delivery', 'the order keeps order type delivery');
      assert.ok(order.kitchen_draft_sale_id, 'a takeaway order must link a kitchen draft sale');
      const draft = await readDraftSale(db, Number(order.kitchen_draft_sale_id));
      assert.equal(draft.status, 'draft', 'the kitchen row is a DRAFT, not a posted sale');
      assert.equal(draft.order_type, 'takeaway', 'the draft carries the canonical pickup order type');
      assert.equal(draft.table_number, '', 'a pickup draft carries no table number');
      assert.equal(draft.doc_no, order.order_number, 'the draft ticket number is the order number');
      assert.equal(Number(draft.total), 100, 'the draft totals the goods (2 x 50)');
      assert.equal(Number(draft.paid_amount), 0, 'the draft moves no money');
      assert.ok(String(draft.note || '').includes('استلام ذاتي'), 'the draft note says pickup, not a table');
      assert.ok(!String(draft.note || '').includes('undefined'), 'the draft note never carries a literal undefined');
      const items = await readDraftItems(db, Number(draft.id));
      assert.equal(items.length, 1, 'the draft carries one line');
      assert.equal(Number(items[0].product_id), 101, 'the draft line is the ordered product');
      assert.equal(Number(items[0].qty), 2, 'the draft line keeps the ordered quantity');
      assert.equal(Number(items[0].line_total), 100, 'the draft line totals the goods');
    } finally {
      await db.destroy();
    }
    console.log('  takeaway order creates a kitchen draft passed');
  }

  // (b) Boundary unchanged: a dine-in QR order still creates its draft.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const service = buildService(db);
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        orderType: 'dine_in',
        tableNumber: '5',
        items: [{ productId: 101, quantity: 2 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'dine-in order must be created');
      const order = await readOrder(db, Number(result.orderId));
      assert.ok(order.kitchen_draft_sale_id, 'a dine-in order must still link a kitchen draft sale');
      const draft = await readDraftSale(db, Number(order.kitchen_draft_sale_id));
      assert.equal(draft.status, 'draft', 'the dine-in kitchen row is a DRAFT');
      assert.equal(draft.order_type, 'dine_in', 'the dine-in draft keeps its order type');
      assert.equal(draft.table_number, '5', 'the dine-in draft keeps its table number');
      assert.ok(String(draft.note || '').includes('طاولة'), 'the dine-in draft note still names the table');
    } finally {
      await db.destroy();
    }
    console.log('  dine-in draft boundary passed');
  }

  // (c) Scope guard: a plain delivery order still creates NO draft.
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
        items: [{ productId: 101, quantity: 2 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'delivery order must be created');
      const order = await readOrder(db, Number(result.orderId));
      assert.equal(order.kitchen_draft_sale_id, null, 'a delivery order must not link a kitchen draft');
      assert.equal(await countSales(db), 0, 'a delivery order must leave no sales row behind');
    } finally {
      await db.destroy();
    }
    console.log('  delivery creates no draft passed');
  }

  console.log('storefront-takeaway-kds-draft.spec: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
