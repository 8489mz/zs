/*
 * INV-MARKETPLACE-SIMULATION-STOCK-ATOMIC: a simulated incoming
 * marketplace order and its ledger stock deduction are one atomic
 * unit.
 *
 * WHAT THE AUDIT FEARED: simulateIncomingOrder inserted the online
 * order (status confirmed, payment_status paid) on the pool handle,
 * then called applyStockDelta(this.db, ...) inside a try/catch that
 * only logged a warning. When the ledger deduction failed, the order
 * stayed paid and confirmed, the WhatsApp message and the audit log
 * both claimed the stock had been reserved, and nothing was deducted
 * — a silent oversell. The pool-handle call also meant the ledger
 * locks (products before balances, FOR UPDATE) ran outside any
 * transaction, so the serialization the ledger relies on did not
 * hold for this path.
 *
 * WHAT THIS PINS, driving the REAL MarketplaceSyncService on PGlite
 * (syncInventory and audit are stubbed: they are neighbours, not the
 * unit under test; the WhatsApp gateway is omitted):
 * 1. Happy path: stock 5 -> the simulated order is created paid and
 *    confirmed, products.stock_qty and the unassigned location
 *    balance both fall to 4.
 * 2. Atomicity: when the ledger deduction fails (the location
 *    balance table carries CHECK (qty >= 0) in this harness, so a
 *    deduction from zero stock violates it), simulateIncomingOrder
 *    THROWS and NO online order row survives — the paid order is
 *    rolled back with the failed deduction instead of staying paid.
 *    On the old code this case leaves one paid order behind.
 * 3. The service file no longer calls applyStockDelta on the pool
 *    handle (the architecture guard spec pins this globally too).
 *
 * Deliberately NOT driven here: syncInventory behaviour, WhatsApp
 * notification content, and real marketplace webhook ingestion.
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
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't-mkt';
const ACCOUNT = 'a-mkt';

function auth(): AuthContext {
  return {
    userId: 1,
    sessionId: 'sess-spec',
    username: 'actor-1',
    role: 'admin',
    permissions: [],
    tenantId: TENANT,
    accountId: ACCOUNT,
  } as unknown as AuthContext;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const anyDb = db as any;
  try {
    await pg.exec(`
      CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY (tenant_id, key));
      CREATE TABLE products (id bigserial PRIMARY KEY, name text NOT NULL, barcode text, retail_price numeric NOT NULL DEFAULT 0, stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, tenant_id text NOT NULL, account_id text NOT NULL, is_active boolean NOT NULL DEFAULT true, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0 CHECK (qty >= 0), reserved_qty numeric NOT NULL DEFAULT 0, tenant_id text NOT NULL, account_id text NOT NULL, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_name text, customer_phone text, customer_address text, customer_notes text, items_json text, subtotal numeric NOT NULL DEFAULT 0, delivery_fee numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, payment_method text, payment_status text, gateway_provider text, shipping_carrier text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    `);

    const auditStub = { log: async () => undefined };
    const service = new MarketplaceSyncService(db, auditStub as never, {} as never);
    (service as any).syncInventory = async () => ({ syncedCount: 0, updatedMappings: [] });

    async function seedProduct(stock: number): Promise<number> {
      const inserted = await anyDb
        .insertInto('products')
        .values({
          name: 'Spec Product', barcode: 'SPEC-1', retail_price: 150,
          stock_qty: stock, reserved_qty: 0,
          tenant_id: TENANT, account_id: ACCOUNT, is_active: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const productId = Number(inserted.id);
      await anyDb
        .insertInto('product_location_stock')
        .values({
          product_id: productId, branch_id: null, location_id: null,
          qty: stock, reserved_qty: 0, tenant_id: TENANT, account_id: ACCOUNT,
        })
        .execute();
      return productId;
    }

    async function readStock(productId: number): Promise<{ global: number; balance: number }> {
      const product = await anyDb.selectFrom('products').select(['stock_qty']).where('id', '=', productId).executeTakeFirstOrThrow();
      const balance = await anyDb
        .selectFrom('product_location_stock')
        .select(['qty'])
        .where('product_id', '=', productId)
        .executeTakeFirstOrThrow();
      return { global: Number(product.stock_qty), balance: Number(balance.qty) };
    }

    async function orderCount(): Promise<number> {
      const rows = await anyDb.selectFrom('online_orders').select(['id']).execute();
      return rows.length;
    }

    // 1. Happy path: deduction and order commit together.
    const happyId = await seedProduct(5);
    const result = await service.simulateIncomingOrder('amazon', auth());
    assert.equal(result.success, true);
    assert.equal(await orderCount(), 1);
    const order = await anyDb.selectFrom('online_orders').selectAll().executeTakeFirstOrThrow();
    assert.equal(order.status, 'confirmed');
    assert.equal(order.payment_status, 'paid');
    assert.deepEqual(await readStock(happyId), { global: 4, balance: 4 });

    // 2. Atomicity: a failing deduction rolls the order back too.
    // Point the noon mapping at the zero-stock product (and deactivate
    // the happy-path product) so the simulated order deterministically
    // targets the product whose deduction must fail.
    await anyDb.updateTable('products').set({ is_active: false }).where('id', '=', happyId).execute();
    const zeroId = await seedProduct(0);
    await anyDb
      .insertInto('settings')
      .values({
        key: 'marketplace_sku_mappings',
        value: JSON.stringify([{ id: 'spec-1', productId: zeroId, marketplace: 'noon', marketplaceSku: 'NOON-1' }]),
        tenant_id: TENANT,
        account_id: ACCOUNT,
      })
      .execute();
    await assert.rejects(() => service.simulateIncomingOrder('noon', auth()));
    assert.equal(await orderCount(), 1, 'no second (paid, undeducted) order may survive a failed deduction');

    // 3. No pool-handle stock call remains in this service.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/storefront/services/marketplace-sync.service.ts'),
      'utf8',
    );
    assert.ok(!source.includes('applyStockDelta(this.db'), 'stock deduction must run on a transaction handle');
    assert.ok(source.includes('applyStockDelta(trx'), 'stock deduction must run inside the order transaction');

    console.log('marketplace simulation stock atomicity checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
