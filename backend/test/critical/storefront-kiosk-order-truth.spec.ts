/*
 * R3-B (INV-REST-KIOSK-ORDER-TRUTH): a kiosk order must carry the server's
 * truth. Three server decisions are pinned here, driving the real
 * StorefrontService over PGlite (one fresh database per case, no
 * SalesService chain and no gateway — createOnlineOrder never calls them):
 *
 * (a) SHIFT GATE: a dine-in or pickup order is refused when no cashier
 *     shift is open for the tenant — the kitchen cannot cook an order
 *     nobody is staffed to make, and a kiosk left on overnight must not
 *     keep taking them. Plain delivery is fulfilled later and is NOT
 *     gated (same scoping precedent as the POS-only shift check in
 *     sales-write.service.ts).
 * (b) IDEMPOTENCY: the server already dedupes on idempotencyKey (the
 *     kiosk simply never sent one until R3-B). Two creates with the same
 *     key produce ONE order row; the second returns the same order with
 *     idempotentDuplicate: true — and a replay still returns the existing
 *     order after the shift closes, because replaying creates no new
 *     kitchen work.
 * (c) SERVER TOTAL: the recorded total comes from the server's own
 *     prices and offers, never the caller's sum. With a live 20% offer
 *     the response totalAmount is 80 on a 100 raw sum — that is the
 *     number the kiosk confirmation must show (the client half is pinned
 *     in useSelfOrderingKiosk.spec.ts).
 * (d) PHONE: a dine-in order needs no phone (the ticket has the table
 *     number; the service skips phone validation there and stores '');
 *     a takeaway order without one is rejected. The DTO accepts a
 *     missing phone (@IsOptional) — a provided phone is still validated
 *     by the pattern — which the last case pins directly against the DTO.
 *
 * HOW THIS IS DRIVEN: the real StorefrontService over PGlite, one fresh
 * database per case, restaurant tenant with an explicit 'storefront'
 * grant so the entitlement gate passes; out-of-stock ordering allowed
 * for restaurants, so no stock reservation runs. `salesService` /
 * `kdsService` / `media` are stubs — createOnlineOrder never calls them.
 *
 * (g) MODIFIER-LESS WRITE (INV-REST-KIOSK-OWN-CATALOG-TRUTH, T14-B):
 *     a kiosk takeaway order whose lines carry no modifiers PLACES —
 *     real order number + server total — and its kitchen-draft
 *     sale_items row stores modifiers '[]'. The draft insert used to
 *     write explicit NULL for a modifier-less line while the column is
 *     JSONB NOT NULL DEFAULT '[]', so EVERY kiosk order rolled back on
 *     Postgres 23502 (the client masked it as MSG_REQUIRED_FIELD).
 * (h) DINE-IN VARIANT: the same modifier-less write places for
 *     dine-in, with the draft carrying order_type 'dine_in'.
 * (i) MODIFIERS PRESERVED: a line WITH modifiers still stores the
 *     server-re-priced selection on the draft (spoofed 999 -> 5).
 *
 * The PGlite sale_items table mirrors the real column here
 * (modifiers JSONB NOT NULL DEFAULT '[]'::jsonb, migration
 * 20260620000200_advanced_manufacturing_tables.ts) — without the
 * constraint the 23502 could never fire in this spec.
 *
 * RED PROOF: on the unfixed tree cases (a) and (b-shift) fail — the
 * order is created with no shift open — while (b-delivery), (c), (d)
 * and (e) pass unchanged: idempotency, the server total and the phone
 * rules already existed; only the shift gate is new behaviour here.
 * Cases (g) and (h) fail at base with 23502 (no order row, no draft)
 * and pass with the fix; (i) fails at base the same way (its draft
 * insert is the same statement) and passes with the fix.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
// The idempotent access token is derived from SESSION_CSRF_SECRET (≥16
// chars); the test harness sets a test-only value when none is configured.
process.env.SESSION_CSRF_SECRET ??= 'test-only-kiosk-order-truth-secret';
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

async function seedPercentOffer(db: Kysely<Database>): Promise<void> {
  await (db as any).insertInto('product_offers').values({
    id: 1, tenant_id: TENANT, product_id: 101, offer_type: 'percent', value: 20,
    start_date: '2026-01-01', end_date: '2026-12-31', is_active: true,
  }).execute();
}

async function openShift(db: Kysely<Database>): Promise<void> {
  await (db as any).insertInto('cashier_shifts').values({
    tenant_id: TENANT, account_id: `${TENANT}:main`, opened_by: 7, status: 'open',
    branch_id: 1, location_id: null,
  }).execute();
}

async function closeAllShifts(db: Kysely<Database>): Promise<void> {
  await (db as any).updateTable('cashier_shifts').set({ status: 'closed' })
    .where('tenant_id', '=', TENANT).execute();
}

function buildService(db: Kysely<Database>): StorefrontService {
  const checker = new PlanFeatureService(undefined as any);
  return new StorefrontService(db, {} as never, {} as never, {} as never, undefined, checker);
}

async function readOrder(db: Kysely<Database>, orderId: number): Promise<any> {
  return (db as any).selectFrom('online_orders').selectAll()
    .where('id', '=', orderId).executeTakeFirstOrThrow();
}

async function readDraftItems(db: Kysely<Database>, saleId: number): Promise<any[]> {
  return (db as any).selectFrom('sale_items').selectAll()
    .where('sale_id', '=', saleId).where('tenant_id', '=', TENANT).execute();
}

function parseModifiers(value: unknown): any[] {
  if (typeof value === 'string') return JSON.parse(value);
  return Array.isArray(value) ? value : [];
}

/** One optional modifier group + one priced option, linked to product 101. */
async function seedModifierTruth(db: Kysely<Database>): Promise<void> {
  const anyDb = db as any;
  await anyDb.insertInto('pos_modifier_groups').values({
    id: 1, tenant_id: TENANT, account_id: `${TENANT}:main`, name: 'Extras',
    selection_type: 'multiple', is_mandatory: false, min_selections: 0, max_selections: 10, is_active: true,
  }).execute();
  await anyDb.insertInto('pos_modifier_options').values({
    id: 12, tenant_id: TENANT, account_id: `${TENANT}:main`, group_id: 1,
    name: 'Mayo', price: 5, cost_price: 1, is_active: true,
  }).execute();
  await anyDb.insertInto('product_pos_modifiers').values({
    id: 1, tenant_id: TENANT, account_id: `${TENANT}:main`, product_id: 101, modifier_group_id: 1,
  }).execute();
}

async function countOrders(db: Kysely<Database>): Promise<number> {
  const rows = await (db as any).selectFrom('online_orders').select('id')
    .where('tenant_id', '=', TENANT).execute();
  return rows.length;
}

async function main(): Promise<void> {
  // (a) SHIFT GATE, dine-in: no open shift refuses the order; an open shift lets it through.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const service = buildService(db);
      await assert.rejects(
        service.createOnlineOrder(SLUG, {
          customerName: 'عميل اختبار',
          countryCode: 'EG',
          orderType: 'dine_in',
          tableNumber: '5',
          items: [{ productId: 101, quantity: 2 }],
          paymentMethod: 'cod',
        } as any),
        /وردية/,
        'a dine-in order with no open shift must be refused',
      );
      assert.equal(await countOrders(db), 0, 'the refused order leaves no order row');
      await openShift(db);
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        countryCode: 'EG',
        orderType: 'dine_in',
        tableNumber: '5',
        items: [{ productId: 101, quantity: 2 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'a dine-in order with an open shift must be created');
      assert.ok(result.orderNumber, 'the created order has a real order number');
    } finally {
      await db.destroy();
    }
    console.log('  dine-in shift gate passed');
  }

  // (b) SHIFT GATE, pickup vs delivery: pickup is refused with no shift; plain delivery is not gated.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      const service = buildService(db);
      await assert.rejects(
        service.createOnlineOrder(SLUG, {
          customerName: 'عميل اختبار',
          customerPhone: '01012345678',
          countryCode: 'EG',
          orderType: 'delivery',
          fulfillmentType: 'pickup',
          items: [{ productId: 101, quantity: 2 }],
          paymentMethod: 'cod',
        } as any),
        /وردية/,
        'a pickup order with no open shift must be refused',
      );
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
      assert.equal(result.ok, true, 'a plain delivery order needs no open shift');
      assert.equal(await countOrders(db), 1, 'only the delivery order was created');
    } finally {
      await db.destroy();
    }
    console.log('  pickup shift gate + delivery scope guard passed');
  }

  // (c) IDEMPOTENCY: the same key twice creates one order; the replay still works after the shift closes.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await openShift(db);
      const service = buildService(db);
      const payload = {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        orderType: 'delivery',
        fulfillmentType: 'pickup',
        items: [{ productId: 101, quantity: 2 }],
        paymentMethod: 'cod',
        idempotencyKey: 'kiosk-test-0001',
      } as any;
      const first: any = await service.createOnlineOrder(SLUG, payload);
      assert.equal(first.ok, true, 'the first create must succeed');
      assert.equal(first.idempotentDuplicate, undefined, 'the first create is not a replay');
      const second: any = await service.createOnlineOrder(SLUG, payload);
      assert.equal(second.ok, true, 'the replay must succeed');
      assert.equal(second.idempotentDuplicate, true, 'the second create is a replay');
      assert.equal(second.orderId, first.orderId, 'the replay returns the same order');
      assert.equal(second.orderNumber, first.orderNumber, 'the replay returns the same order number');
      assert.equal(Number(second.totalAmount), Number(first.totalAmount), 'the replay returns the same total');
      assert.equal(await countOrders(db), 1, 'one key means one order row');
      await closeAllShifts(db);
      const third: any = await service.createOnlineOrder(SLUG, payload);
      assert.equal(third.idempotentDuplicate, true, 'the replay still works after the shift closes');
      assert.equal(third.orderId, first.orderId, 'the late replay returns the same order');
      assert.equal(await countOrders(db), 1, 'the late replay creates no second order');
    } finally {
      await db.destroy();
    }
    console.log('  idempotency dedupe + replay after close passed');
  }

  // (d) SERVER TOTAL: a live 20% offer reprices the order — the recorded total is 80, not the raw 100.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedPercentOffer(db);
      await openShift(db);
      const service = buildService(db);
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        orderType: 'delivery',
        fulfillmentType: 'pickup',
        items: [{ productId: 101, quantity: 2 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'the order must be created');
      assert.equal(Number(result.totalAmount), 80, 'the response total is the server repriced total (2 x 40), not the raw 100');
      const order = await readOrder(db, Number(result.orderId));
      assert.equal(Number(order.total_amount), 80, 'the stored total is the server total');
      assert.equal(Number(result.items[0].total), 80, 'the stored line total is repriced too');
    } finally {
      await db.destroy();
    }
    console.log('  server total repriced by offer passed');
  }

  // (e) PHONE: dine-in needs no phone (stored empty); takeaway without one is rejected.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await openShift(db);
      const service = buildService(db);
      const dineIn: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        countryCode: 'EG',
        orderType: 'dine_in',
        tableNumber: '5',
        items: [{ productId: 101, quantity: 2 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(dineIn.ok, true, 'a dine-in order without a phone must be created');
      const dineInOrder = await readOrder(db, Number(dineIn.orderId));
      assert.equal(dineInOrder.customer_phone, '', 'a dine-in order without a phone stores an empty phone, never a fake one');
      await assert.rejects(
        service.createOnlineOrder(SLUG, {
          customerName: 'عميل اختبار',
          countryCode: 'EG',
          orderType: 'delivery',
          fulfillmentType: 'pickup',
          items: [{ productId: 101, quantity: 2 }],
          paymentMethod: 'cod',
        } as any),
        /هاتف/,
        'a takeaway order without a phone must be rejected',
      );
    } finally {
      await db.destroy();
    }
    console.log('  dine-in no phone + takeaway phone required passed');
  }

  // (g) MODIFIER-LESS WRITE, takeaway: the kiosk's everyday order places
  // and the draft stores modifiers '[]' — never NULL.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await openShift(db);
      const service = buildService(db);
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        orderType: 'delivery',
        fulfillmentType: 'pickup',
        items: [{ productId: 101, quantity: 2 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'a modifier-less takeaway order must place');
      assert.match(result.orderNumber, /^ON-/, 'the placed order has a real ON- order number');
      assert.equal(Number(result.totalAmount), 100, 'the server total is 2 x 50');
      const order = await readOrder(db, Number(result.orderId));
      assert.ok(order.kitchen_draft_sale_id, 'the takeaway order links a kitchen draft sale');
      const draftItems = await readDraftItems(db, Number(order.kitchen_draft_sale_id));
      assert.equal(draftItems.length, 1, 'the draft has one line');
      assert.deepEqual(parseModifiers(draftItems[0].modifiers), [], 'the draft line stores modifiers as an empty list, never NULL');
    } finally {
      await db.destroy();
    }
    console.log('  modifier-less takeaway places + draft stores [] passed');
  }

  // (h) MODIFIER-LESS WRITE, dine-in: same write, dine-in draft.
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await openShift(db);
      const service = buildService(db);
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        countryCode: 'EG',
        orderType: 'dine_in',
        tableNumber: '5',
        items: [{ productId: 101, quantity: 2 }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'a modifier-less dine-in order must place');
      assert.match(result.orderNumber, /^ON-/, 'the placed order has a real ON- order number');
      const order = await readOrder(db, Number(result.orderId));
      const draft = await (db as any).selectFrom('sales').selectAll()
        .where('id', '=', Number(order.kitchen_draft_sale_id)).executeTakeFirstOrThrow();
      assert.equal(draft.order_type, 'dine_in', 'the draft carries the dine-in order type');
      const draftItems = await readDraftItems(db, Number(order.kitchen_draft_sale_id));
      assert.deepEqual(parseModifiers(draftItems[0].modifiers), [], 'the dine-in draft line stores modifiers as an empty list, never NULL');
    } finally {
      await db.destroy();
    }
    console.log('  modifier-less dine-in places + draft stores [] passed');
  }

  // (i) MODIFIERS PRESERVED: a line with modifiers stores the
  // server-re-priced selection on the draft (spoofed 999 -> 5).
  {
    const { pg, db } = await makeDb();
    try {
      await seedFoundation(db);
      await seedModifierTruth(db);
      await openShift(db);
      const service = buildService(db);
      const result: any = await service.createOnlineOrder(SLUG, {
        customerName: 'عميل اختبار',
        customerPhone: '01012345678',
        countryCode: 'EG',
        orderType: 'delivery',
        fulfillmentType: 'pickup',
        items: [{ productId: 101, quantity: 2, modifiers: [{ optionId: 12, qty: 1, price: 999 }] }],
        paymentMethod: 'cod',
      } as any);
      assert.equal(result.ok, true, 'an order with modifiers must place');
      assert.equal(Number(result.totalAmount), 110, 'the total is 2 x (50 + re-priced 5), not the spoofed 999');
      const order = await readOrder(db, Number(result.orderId));
      const draftItems = await readDraftItems(db, Number(order.kitchen_draft_sale_id));
      const draftMods = parseModifiers(draftItems[0].modifiers);
      assert.equal(draftMods.length, 1, 'the draft line carries the one modifier');
      assert.equal(Number(draftMods.find((m: any) => m.optionId === 12)?.price), 5, 'the draft carries the re-priced modifier price 5, not the spoofed 999');
    } finally {
      await db.destroy();
    }
    console.log('  modifiers preserved + re-priced on draft passed');
  }

  // (f) DTO: a missing customerPhone validates (the service decides where a phone is required);
  // a provided but malformed phone still fails validation.
  {
    const withoutPhone = plainToInstance(CreateOnlineOrderDto, {
      customerName: 'عميل اختبار',
      items: [{ productId: 101, quantity: 2 }],
    });
    const withoutPhoneErrors = await validate(withoutPhone);
    assert.deepEqual(
      withoutPhoneErrors.map((e) => e.property),
      [],
      'a DTO without a phone must validate — the service enforces the phone where it is needed',
    );
    const badPhone = plainToInstance(CreateOnlineOrderDto, {
      customerName: 'عميل اختبار',
      customerPhone: 'abc',
      items: [{ productId: 101, quantity: 2 }],
    });
    const badPhoneErrors = await validate(badPhone);
    assert.ok(
      badPhoneErrors.some((e) => e.property === 'customerPhone'),
      'a DTO with a malformed phone must still fail validation',
    );
  }
  console.log('  DTO phone optional + malformed phone rejected passed');

  console.log('storefront-kiosk-order-truth.spec: all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
