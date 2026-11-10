/*
 * INV-SF-SIMULATE-ORDER-GATE (D-SF-06): a simulated incoming marketplace
 * order is a paid order like any other, so it must pass the same
 * storefront entitlement gate as createOnlineOrder, and it must never
 * invent a price.
 *
 * WHAT THE AUDIT FOUND: simulateIncomingOrder created a confirmed +
 * paid order (payment_method 'marketplace_prepaid') with NO entitlement
 * check, and priced it with `Number(product.retail_price || 150)` — a
 * zero-price product was billed 150. An admin click fabricated a paid
 * order on any tenant, bypassing the gate that blocks real orders.
 *
 * WHAT THIS PINS, driving the REAL MarketplaceSyncService on PGlite
 * (syncInventory and audit are stubbed: neighbours, not the unit under
 * test; the WhatsApp gateway is omitted; the plan resolver is the REAL
 * PlanFeatureService with an empty plan cache, so entitlement comes
 * from the industry profile defaults exactly like production):
 * 1. Non-entitled tenant (warehousing, basic plan): simulate is refused
 *    with the same named message as createOnlineOrder, before any stock
 *    or money moves — no order row, stock untouched.
 * 2. Gate order: a non-entitled tenant with a zero-price product gets
 *    the entitlement refusal, not the price error — the gate runs first.
 * 3. Zero-price product on an entitled tenant: refused with a specific
 *    error naming the product and its missing retail price; no order,
 *    no stock move, and no 150 fallback order.
 * 4. Null-price product on an entitled tenant: refused the same way.
 * 5. Happy path: entitled tenant + priced product (250) still simulates
 *    — confirmed + paid order at 250 (not 150), stock 5 -> 4.
 * 6. Source pins: the service calls isStorefrontEntitledForOrders and
 *    the 150 fallback is gone from the simulate path.
 *
 * Deliberately NOT driven here: real marketplace webhook ingestion,
 * syncInventory behaviour, and WhatsApp notification content.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { MarketplaceSyncService } from '../../src/modules/storefront/services/marketplace-sync.service';
import { PlanFeatureService } from '../../src/core/auth/services/plan-feature.service';
import { STOREFRONT_NOT_ENTITLED_MESSAGE } from '../../src/modules/storefront/engines/storefront-entitlement.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const ENTITLED_TENANT = 't-mkt-gate-ok';
const BLOCKED_TENANT = 't-mkt-gate-no';
const ACCOUNT = 'a-mkt-gate';

function auth(tenantId: string): AuthContext {
  return {
    userId: 1,
    sessionId: 'sess-spec',
    username: 'actor-1',
    role: 'admin',
    permissions: [],
    tenantId,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, plan_id text, extra_features text, activity_type text, status text, trial_ends_at timestamptz);
      CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY (tenant_id, key));
      CREATE TABLE products (id bigserial PRIMARY KEY, name text NOT NULL, barcode text, retail_price numeric DEFAULT 0, stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, tenant_id text NOT NULL, account_id text NOT NULL, is_active boolean NOT NULL DEFAULT true, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0 CHECK (qty >= 0), reserved_qty numeric NOT NULL DEFAULT 0, tenant_id text NOT NULL, account_id text NOT NULL, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_name text, customer_phone text, customer_address text, customer_notes text, items_json text, subtotal numeric NOT NULL DEFAULT 0, delivery_fee numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, payment_method text, payment_status text, gateway_provider text, shipping_carrier text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    `);

    // Entitled tenant: ecommerce profile carries the storefront by
    // default, so the real resolver grants it with an empty plan cache.
    await anyDb
      .insertInto('tenants')
      .values({
        id: ENTITLED_TENANT, plan_id: 'plan_basic', extra_features: '[]',
        activity_type: 'ecommerce', status: 'active', trial_ends_at: null,
      })
      .execute();
    // Non-entitled tenant: warehousing structurally excludes the
    // storefront, and no trial is active to re-grant it.
    await anyDb
      .insertInto('tenants')
      .values({
        id: BLOCKED_TENANT, plan_id: 'plan_basic', extra_features: '[]',
        activity_type: 'warehousing', status: 'active', trial_ends_at: null,
      })
      .execute();

    const auditStub = { log: async () => undefined };
    const checker = new PlanFeatureService(undefined as any);
    const service = new MarketplaceSyncService(db, auditStub as never, {} as never, undefined, checker as never);
    (service as any).syncInventory = async () => ({ syncedCount: 0, updatedMappings: [] });

    async function seedProduct(tenantId: string, name: string, price: number | null, stock: number): Promise<number> {
      const inserted = await anyDb
        .insertInto('products')
        .values({
          name, barcode: `SPEC-${name}`, retail_price: price,
          stock_qty: stock, reserved_qty: 0,
          tenant_id: tenantId, account_id: ACCOUNT, is_active: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const productId = Number(inserted.id);
      await anyDb
        .insertInto('product_location_stock')
        .values({
          product_id: productId, branch_id: null, location_id: null,
          qty: stock, reserved_qty: 0, tenant_id: tenantId, account_id: ACCOUNT,
        })
        .execute();
      return productId;
    }

    async function orderCount(tenantId: string): Promise<number> {
      const rows = await anyDb
        .selectFrom('online_orders')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .execute();
      return rows.length;
    }

    async function readStock(productId: number): Promise<number> {
      const product = await anyDb
        .selectFrom('products')
        .select(['stock_qty'])
        .where('id', '=', productId)
        .executeTakeFirstOrThrow();
      return Number(product.stock_qty);
    }

    // 1. Non-entitled tenant: refused with the createOnlineOrder message,
    // before any stock or money moves.
    const blockedPricedId = await seedProduct(BLOCKED_TENANT, 'Blocked Priced', 250, 5);
    await assert.rejects(
      () => service.simulateIncomingOrder('amazon', auth(BLOCKED_TENANT)),
      (error: any) => error.message === STOREFRONT_NOT_ENTITLED_MESSAGE,
    );
    assert.equal(await orderCount(BLOCKED_TENANT), 0, 'no simulated order may be created for a non-entitled tenant');
    assert.equal(await readStock(blockedPricedId), 5, 'stock must be untouched by a refused simulation');

    // 2. Gate runs before the price check: a non-entitled tenant with a
    // zero-price product still gets the entitlement refusal, not the
    // price error.
    await anyDb.updateTable('products').set({ is_active: false }).where('id', '=', blockedPricedId).execute();
    await seedProduct(BLOCKED_TENANT, 'Blocked Free', 0, 5);
    await assert.rejects(
      () => service.simulateIncomingOrder('noon', auth(BLOCKED_TENANT)),
      (error: any) => error.message === STOREFRONT_NOT_ENTITLED_MESSAGE,
    );
    assert.equal(await orderCount(BLOCKED_TENANT), 0);

    // 3. Zero-price product on an entitled tenant: refused with a specific
    // error naming the product and its missing price — never billed 150.
    const zeroId = await seedProduct(ENTITLED_TENANT, 'Zero Price Product', 0, 5);
    await assert.rejects(
      () => service.simulateIncomingOrder('amazon', auth(ENTITLED_TENANT)),
      (error: any) =>
        typeof error.message === 'string' &&
        error.message.includes('Zero Price Product') &&
        error.message.includes('no retail price'),
    );
    assert.equal(await orderCount(ENTITLED_TENANT), 0, 'no 150 fallback order may be created for a zero-price product');
    assert.equal(await readStock(zeroId), 5, 'stock must be untouched by a refused simulation');

    // 4. Null-price product on an entitled tenant: refused the same way.
    await anyDb.updateTable('products').set({ is_active: false }).where('id', '=', zeroId).execute();
    const nullId = await seedProduct(ENTITLED_TENANT, 'Null Price Product', null, 5);
    await assert.rejects(
      () => service.simulateIncomingOrder('amazon', auth(ENTITLED_TENANT)),
      (error: any) =>
        typeof error.message === 'string' &&
        error.message.includes('Null Price Product') &&
        error.message.includes('no retail price'),
    );
    assert.equal(await orderCount(ENTITLED_TENANT), 0);
    assert.equal(await readStock(nullId), 5);

    // 5. Happy path: entitled tenant + priced product still simulates —
    // confirmed + paid at the real price (250, not 150), stock 5 -> 4.
    await anyDb.updateTable('products').set({ is_active: false }).where('id', '=', nullId).execute();
    const pricedId = await seedProduct(ENTITLED_TENANT, 'Priced Product', 250, 5);
    const result = await service.simulateIncomingOrder('amazon', auth(ENTITLED_TENANT));
    assert.equal(result.success, true);
    assert.equal(result.totalAmount, 250, 'the simulated order must bill the real retail price, not a 150 fallback');
    assert.equal(result.reservedProductName, 'Priced Product');
    assert.equal(await orderCount(ENTITLED_TENANT), 1);
    const order = await anyDb.selectFrom('online_orders').selectAll().executeTakeFirstOrThrow();
    assert.equal(order.status, 'confirmed');
    assert.equal(order.payment_status, 'paid');
    assert.equal(Number(order.total_amount), 250);
    assert.equal(await readStock(pricedId), 4);

    // 6. Source pins: the gate is the canonical check, and the 150
    // fallback is gone from the simulate path.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/storefront/services/marketplace-sync.service.ts'),
      'utf8',
    );
    assert.ok(source.includes('isStorefrontEntitledForOrders'), 'simulate must call the canonical entitlement check');
    assert.ok(source.includes('STOREFRONT_NOT_ENTITLED_MESSAGE'), 'simulate must refuse with the named entitlement message');
    assert.ok(!source.includes('retail_price || 150'), 'the 150 price fallback must be gone from the simulate path');

    console.log('storefront simulate-order gate checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
