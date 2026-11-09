/*
 * R-I9 (INV-REST-FNB-TRUTH-2): the food-waste summary must respect the
 * branch filter and must not count pending waste as posted cost.
 *
 * On the unfixed tree getVarianceSummary takes branchId but never uses
 * it (both queries filter tenant + 30 days only), and it sums
 * total_cost over ALL rows — including pending incidents, which have
 * no stock deduction and no journal (their stored total_cost is real
 * while the logWaste response honestly reports totalCost: 0). There
 * is no status column: pending is inferred by the absence of a
 * stock_movements row with reference_type='food_waste' + the log id —
 * the definition reconcilePendingWaste already uses. listLogs also
 * inner-joins products, so a log whose product was later deleted
 * disappears from the list.
 *
 * The fix, driven here against the real service over PGlite (one
 * shared database, db.destroy() teardown):
 * - the branchId filter applies to the summary (posted and pending
 *   alike);
 * - pending cost/incidents are reported as separate fields
 *   (pendingWasteCost / pendingWasteIncidents) and NEVER inside
 *   totalWasteCost / totalWasteIncidents (byReason follows the same
 *   posted-only rule);
 * - listLogs left-joins products, so a deleted product's log still
 *   appears (product_name null).
 *
 * RED PROOF: on the unfixed tree the branch-A summary returns 700
 * (branch B's 500 leaks in) with the pending 70 inside it, and the
 * deleted-product log is missing from listLogs — see the base-run
 * note at the end of the report.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { RestaurantFoodWasteService } from '../../src/modules/sales/services/restaurant-food-waste.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 't1:main';

const DDL = `
  CREATE TABLE tenants (id text PRIMARY KEY);
  CREATE TABLE settings (tenant_id text, key text, value text);
  CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
  CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
  CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, name text);
  CREATE TABLE restaurant_food_waste_logs (id bigserial PRIMARY KEY, tenant_id text, account_id text,
    branch_id bigint, product_id bigint, quantity numeric(14, 3), cost_price numeric(14, 2) DEFAULT 0,
    total_cost numeric(14, 2) DEFAULT 0, reason text, notes text, logged_by bigint,
    created_at timestamptz DEFAULT NOW());
  CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, product_id bigint,
    reference_type text, reference_id bigint);
`;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(DDL);
  const anyDb = db as any;
  await anyDb.insertInto('tenants').values({ id: TENANT }).execute();
  await anyDb.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: '"EGP"' }).execute();
  await anyDb.insertInto('currency_exchange_rates').values({
    tenant_id: TENANT, currency_code: 'EGP', is_base: true, exchange_rate: 1,
  }).execute();
  await anyDb.insertInto('branches').values({ id: 1, tenant_id: TENANT, name: 'Branch A', default_stock_location_id: null }).execute();
  await anyDb.insertInto('branches').values({ id: 2, tenant_id: TENANT, name: 'Branch B', default_stock_location_id: null }).execute();
  for (const [id, name] of [[101, 'Rice'], [102, 'Chicken'], [103, 'Sauce'], [104, 'Bread']] as const) {
    await anyDb.insertInto('products').values({ id, tenant_id: TENANT, name }).execute();
  }
  // log 1: branch A, posted (has a stock movement), cost 100.
  // log 2: branch B, posted, cost 500.
  // log 3: branch A, PENDING (no stock movement), cost 70.
  // log 4: branch A, posted, cost 30 — its product is deleted below.
  const logs = [
    { branch_id: 1, product_id: 101, quantity: 2, cost_price: 50, total_cost: 100, reason: 'spoilage' },
    { branch_id: 2, product_id: 102, quantity: 5, cost_price: 100, total_cost: 500, reason: 'expired' },
    { branch_id: 1, product_id: 103, quantity: 1, cost_price: 70, total_cost: 70, reason: 'prep_error', notes: '[بانتظار تسوية المخزون]' },
    { branch_id: 1, product_id: 104, quantity: 3, cost_price: 10, total_cost: 30, reason: 'spoilage' },
  ];
  for (const log of logs) {
    await anyDb.insertInto('restaurant_food_waste_logs').values({
      tenant_id: TENANT, account_id: ACCOUNT, ...log,
    }).execute();
  }
  for (const refId of [1, 2, 4]) {
    await anyDb.insertInto('stock_movements').values({
      tenant_id: TENANT, product_id: 101, reference_type: 'food_waste', reference_id: refId,
    }).execute();
  }
  await anyDb.deleteFrom('products').where('id', '=', 104).execute();
  return { pg, db };
}

function buildService(db: Kysely<Database>): RestaurantFoodWasteService {
  // getVarianceSummary / listLogs never touch the posting service.
  return new RestaurantFoodWasteService(db, {} as never);
}

const auth = { tenantId: TENANT, accountId: ACCOUNT, userId: 1, role: 'admin' } as unknown as AuthContext;

async function main() {
  // One PGlite instance shared by all cases (a fresh instance per
  // case OOM-killed the VM when sibling agents ran alongside). All
  // three cases only read the same seeded rows.
  const { pg, db } = await makeDb();
  const service = buildService(db);
  try {
  // 1. Branch A summary: only A's POSTED cost (100 + 30); the pending
  // 70 is reported separately, never inside totalWasteCost; branch B's
  // 500 does not leak in.
  {
      const summary = await service.getVarianceSummary(auth, 1);
      assert.equal(Number(summary.totalWasteCost), 130);
      assert.equal(Number(summary.totalWasteIncidents), 2);
      assert.equal(Number((summary as any).pendingWasteCost), 70);
      assert.equal(Number((summary as any).pendingWasteIncidents), 1);
      const byReason = (summary as any).byReason as Array<{ reason: string; cost: number; count: number }>;
      const spoilage = byReason.find((r) => r.reason === 'spoilage');
      assert.equal(Number(spoilage?.cost), 130);
      assert.equal(Number(spoilage?.count), 2);
  }

  // 2. No branch filter: all branches' POSTED cost (630), pending
  // still separate (70).
  {
      const summary = await service.getVarianceSummary(auth);
      assert.equal(Number(summary.totalWasteCost), 630);
      assert.equal(Number(summary.totalWasteIncidents), 3);
      assert.equal(Number((summary as any).pendingWasteCost), 70);
      assert.equal(Number((summary as any).pendingWasteIncidents), 1);
  }

  // 3. listLogs still returns the log whose product was deleted
  // (product_name null), and the branch filter still applies.
  {
      const all = await service.listLogs(auth);
      assert.equal(all.length, 4);
      const deleted = (all as any[]).find((row) => Number(row.id) === 4);
      assert.ok(deleted, 'the deleted-product log must still appear');
      assert.equal(deleted.product_name, null);
      const branchB = await service.listLogs(auth, { branchId: 2 });
      assert.equal(branchB.length, 1);
      assert.equal(Number((branchB as any[])[0].id), 2);
  }
  } finally { await db.destroy(); }

  console.log('Food waste summary tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
