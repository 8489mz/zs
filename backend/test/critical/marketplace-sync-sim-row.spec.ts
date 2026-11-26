/*
 * Phase 1 A2 — the marketplace-sync simulated order gains its movement row
 * (INV-PHASE1-A2-SIM-MOVEMENT-ROW).
 *
 * THE GAP (grounding phase1-grounding-stock-movements.md §4.5): of the two
 * applyStockDelta calls with no row in the same method, inventory-scope:491 is
 * delta-0 provisioning by design — but marketplace-sync-sim:202 is a GENUINE
 * gap. simulateIncomingOrder deducts REAL stock (delta -1, allowNegative, no
 * locationId so it hits the unassigned pool) and writes a paid online order,
 * but NO stock_movements row at all. A real quantity change with no audit
 * trail: the ledger balance moves and nothing explains why.
 *
 * THE RULE: the deduction goes through A0's recordStockMovement(trx, params)
 * — the direct applyStockDelta call is replaced, not supplemented — so one
 * simulated order writes exactly one row, on the order transaction, and a
 * failed sim rolls the order, the balance AND the row back together.
 * - movement_type 'sale', reason 'sale' (sale-type row, grounding §6.3).
 * - reference_type 'online_order', reference_id the online order id (a NEW
 *   reference value: the row points at online_orders, not a sale, so reusing
 *   'sale' as the reference type would mislabel it).
 * - unit_cost is the product's frozen cost_price (INV-SALE-MOVEMENT-UNIT-COST:
 *   sale rows carry cost, never retail price); total_cost is the book rounding
 *   of |qty| * cost at the tenant's book digits (P2 pattern:
 *   currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId))).
 * - note names the simulated order; created_by is the caller; branch/location
 *   are null (unassigned pool, exactly like the old delta call).
 * - created_at is NOT set by the service: the DB default NOW() stamps it
 *   (server clock, single-server-clock rule).
 * - A currency-config failure aborts the order before any write: without
 *   book digits no correct total_cost can be booked, so the sim fails closed
 *   with the specific currency-settings refusal instead of an unbookable row.
 *
 * WHAT THIS PINS, driving the REAL MarketplaceSyncService on PGlite
 * (syncInventory and audit are stubbed: neighbours, not the unit under test;
 * the WhatsApp gateway is omitted; the plan resolver is the REAL
 * PlanFeatureService with an empty plan cache):
 * 1. Happy path: one simulated order writes exactly ONE movement row with
 *    every field above (cost 80 vs retail 150 so cost and price are
 *    distinguishable), and stock 5 -> 4 (global + unassigned balance).
 * 2. A second simulated order writes exactly one MORE row (one row per
 *    deduction, each pointing at its own order; the first row is unchanged).
 * 3. Rollback: a failing deduction (zero stock, CHECK qty >= 0) leaves no
 *    second order AND no extra row — the row does not survive outside the
 *    transaction.
 * 4. Source pins: the slice calls recordStockMovement(trx, …) and no longer
 *    calls applyStockDelta(trx, …) directly, and holds no
 *    insertInto('stock_movements') of its own.
 * 5. Wiring: this spec is in both critical lists, in identical order
 *    (363 specs — the purchases-writer spec is the last entry).
 *
 * Deliberately NOT driven here: syncInventory behaviour, WhatsApp
 * notification content, real marketplace webhook ingestion, cost-rounding
 * unification (A10), and the delta-0 provisioning exception
 * (inventory-scope:491, row-less by design).
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
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TENANT = 't-mkt-sim';
const ACCOUNT = 'a-mkt-sim';

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
  // Loose harness handle: the spec's tables are not in the app Database
  // type, so the harness queries run through an unknown-columned handle
  // (no `any` — the reads below only assert / Number() / String() them).
  type LooseDb = Record<string, Record<string, unknown>>;
  const anyDb = db as unknown as Kysely<LooseDb>;
  try {
    await pg.exec(`
      CREATE TABLE tenants (id text PRIMARY KEY, plan_id text, extra_features text, activity_type text, status text, trial_ends_at timestamptz);
      CREATE TABLE settings (key text NOT NULL, value text, tenant_id text NOT NULL, account_id text NOT NULL, PRIMARY KEY (tenant_id, key));
      CREATE TABLE products (id bigserial PRIMARY KEY, name text NOT NULL, barcode text, retail_price numeric NOT NULL DEFAULT 0, cost_price numeric NOT NULL DEFAULT 0, stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, tenant_id text NOT NULL, account_id text NOT NULL, is_active boolean NOT NULL DEFAULT true, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0 CHECK (qty >= 0), reserved_qty numeric NOT NULL DEFAULT 0, tenant_id text NOT NULL, account_id text NOT NULL, updated_at timestamptz DEFAULT NOW());
      CREATE TABLE online_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_name text, customer_phone text, customer_address text, customer_notes text, items_json text, subtotal numeric NOT NULL DEFAULT 0, delivery_fee numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, payment_method text, payment_status text, gateway_provider text, shipping_carrier text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
      CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, serial_tracking jsonb, batch_tracking jsonb, created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text, currency_code text NOT NULL, currency_name text, exchange_rate numeric NOT NULL DEFAULT 1, is_base boolean NOT NULL DEFAULT false, symbol text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    `);

    // INV-SF-SIMULATE-ORDER-GATE: simulateIncomingOrder is entitlement-
    // gated, so this harness seeds an entitled tenant (ecommerce profile
    // carries the storefront by default) and passes the real plan
    // resolver with an empty plan cache.
    await anyDb
      .insertInto('tenants')
      .values({
        id: TENANT,
        plan_id: 'plan_basic',
        extra_features: '[]',
        activity_type: 'ecommerce',
        status: 'active',
        trial_ends_at: null,
      })
      .execute();
    // Base currency row, so tenantBaseCurrency resolves EGP (2dp) exactly
    // like production; without the table the digits lookup cannot run.
    await anyDb
      .insertInto('currency_exchange_rates')
      .values({
        tenant_id: TENANT,
        account_id: ACCOUNT,
        currency_code: 'EGP',
        currency_name: 'Egyptian Pound',
        exchange_rate: 1,
        is_base: true,
      })
      .execute();

    const auditStub = { log: async () => undefined };
    const checker = new PlanFeatureService(undefined as never);
    const service = new MarketplaceSyncService(db, auditStub as never, {} as never, undefined, checker as never);
    service.syncInventory = async () => ({ syncedCount: 0, updatedMappings: [] });

    async function seedProduct(stock: number, cost: number, retail: number): Promise<number> {
      const inserted = await anyDb
        .insertInto('products')
        .values({
          name: 'Spec Product',
          barcode: 'SPEC-1',
          retail_price: retail,
          cost_price: cost,
          stock_qty: stock,
          reserved_qty: 0,
          tenant_id: TENANT,
          account_id: ACCOUNT,
          is_active: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const productId = Number(inserted.id);
      await anyDb
        .insertInto('product_location_stock')
        .values({
          product_id: productId,
          branch_id: null,
          location_id: null,
          qty: stock,
          reserved_qty: 0,
          tenant_id: TENANT,
          account_id: ACCOUNT,
        })
        .execute();
      return productId;
    }

    async function readStock(productId: number): Promise<{ global: number; balance: number }> {
      const product = await anyDb
        .selectFrom('products')
        .select(['stock_qty'])
        .where('id', '=', productId)
        .executeTakeFirstOrThrow();
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

    async function movementRows(): Promise<Array<Record<string, unknown>>> {
      const rows = await anyDb.selectFrom('stock_movements').selectAll().orderBy('id').execute();
      return rows;
    }

    // 1. Happy path: one simulated order writes exactly one row, with
    // every field pinned. Cost 80 vs retail 150 keeps the two apart.
    const happyId = await seedProduct(5, 80, 150);
    const result = await service.simulateIncomingOrder('amazon', auth());
    assert.equal(result.success, true);
    assert.ok(result.orderId > 0, 'the simulated order must have an id');
    assert.equal(await orderCount(), 1);
    const order = await anyDb.selectFrom('online_orders').selectAll().executeTakeFirstOrThrow();
    assert.equal(order.status, 'confirmed');
    assert.equal(order.payment_status, 'paid');
    assert.equal(Number(order.total_amount), 150);
    assert.deepEqual(await readStock(happyId), { global: 4, balance: 4 });

    const rows1 = await movementRows();
    assert.equal(rows1.length, 1, `exactly one movement row, got ${rows1.length}`);
    const row = rows1[0];
    assert.equal(row.tenant_id, TENANT);
    assert.equal(row.account_id, ACCOUNT);
    assert.equal(Number(row.product_id), happyId);
    assert.equal(row.movement_type, 'sale');
    assert.equal(Number(row.qty), -1);
    assert.equal(Number(row.before_qty), 5);
    assert.equal(Number(row.after_qty), 4);
    assert.equal(Number(row.unit_cost), 80);
    assert.equal(Number(row.total_cost), 80);
    assert.equal(row.reason, 'sale');
    assert.equal(row.note, `Marketplace simulated order ${result.orderNumber} (amazon)`);
    assert.equal(row.reference_type, 'online_order');
    assert.equal(Number(row.reference_id), result.orderId);
    assert.equal(row.branch_id, null);
    assert.equal(row.location_id, null);
    assert.equal(Number(row.created_by), 1);
    assert.ok(row.created_at, 'created_at must be stamped by the DB default');
    assert.ok(
      Date.now() - new Date(String(row.created_at)).getTime() < 60000,
      'created_at must be recent (server clock)',
    );
    console.log('  1. happy path: exactly one row with every field pinned, passed');

    // 2. A second simulated order writes exactly one MORE row (one row
    // per deduction), each pointing at its own order; the first row is
    // unchanged.
    const result2 = await service.simulateIncomingOrder('amazon', auth());
    assert.equal(result2.success, true);
    assert.equal(await orderCount(), 2);
    assert.deepEqual(await readStock(happyId), { global: 3, balance: 3 });
    const rows2 = await movementRows();
    assert.equal(rows2.length, 2, `one row per deduction, got ${rows2.length}`);
    assert.equal(Number(rows2[0].reference_id), result.orderId);
    assert.equal(Number(rows2[0].before_qty), 5);
    assert.equal(Number(rows2[0].after_qty), 4);
    assert.equal(Number(rows2[1].reference_id), result2.orderId);
    assert.equal(Number(rows2[1].qty), -1);
    assert.equal(Number(rows2[1].before_qty), 4);
    assert.equal(Number(rows2[1].after_qty), 3);
    assert.equal(rows2[1].note, `Marketplace simulated order ${result2.orderNumber} (amazon)`);
    console.log('  2. second order writes exactly one more row, passed');

    // 3. Rollback: a failing deduction (zero stock, CHECK qty >= 0) leaves
    // no second order AND no extra row — the row does not survive outside
    // the transaction.
    await anyDb.updateTable('products').set({ is_active: false }).where('id', '=', happyId).execute();
    const zeroId = await seedProduct(0, 80, 150);
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
    assert.equal(await orderCount(), 2, 'no paid, undeducted order may survive a failed deduction');
    assert.equal((await movementRows()).length, 2, 'no movement row may survive a failed deduction');
    assert.deepEqual(await readStock(zeroId), { global: 0, balance: 0 });
    console.log('  3. rollback: failed deduction leaves no order and no row, passed');

    // 4. Source pins: the deduction goes through the row-writer on the
    // transaction handle; the direct ledger call is gone and the slice
    // holds no insert of its own.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/modules/storefront/services/marketplace-sync-simulation.service.ts'),
      'utf8',
    );
    assert.ok(
      source.includes('recordStockMovement(trx'),
      'the sim deduction must go through the row-writer on the transaction handle',
    );
    assert.ok(
      !source.includes('await applyStockDelta(trx'),
      'the direct ledger call must be replaced by the row-writer',
    );
    assert.ok(!source.includes("insertInto('stock_movements')"), 'the slice must not hand-write its own movement row');
    assert.ok(
      source.includes('common/utils/stock-movement-writer'),
      'the slice must import the ledger-module row-writer',
    );
    console.log('  4. source pins: passed');

    // 5. Wiring: this spec is in both critical lists, in identical order
    // (363 specs — the purchases-writer spec is the last entry).
    {
      const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
        .specs as string[];
      const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      const serial = String(pkg.scripts['test:critical:serial']);
      const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
      assert.equal(specs.length, 369);
      assert.equal(chain.length, 369);
      assert.deepEqual(chain, specs);
      assert.ok(specs.includes('test/critical/marketplace-sync-sim-row.spec.ts'));
      assert.equal(specs[specs.length - 1], 'test/critical/phase1-a10-import-writer.spec.ts');
      console.log('  5. evidence spec wired into both critical lists (369 = 369, identical order), passed');
    }

    console.log('Marketplace sync sim movement row tests passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
