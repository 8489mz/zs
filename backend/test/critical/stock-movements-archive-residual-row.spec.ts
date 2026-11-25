/*
 * INV-STOCK-MOVEMENTS-ARCHIVE-ROW: the archive residual gets its own
 * stock_movements row.
 *
 * THE GAP (P0-3, docs/STOCK_MOVEMENTS_WRITES.md): in
 * CatalogProductArchiveService.toggleProductArchive, the zeroStock
 * branch deducts per-location stock with a 'deduct' movement row
 * each, then — when the location rows sum to LESS than the global
 * stock_qty (a historical drift the archive zeroing exists to
 * eliminate) — deducts the residual through applyStockDelta with
 * NO movement row. The balance moved; the audit trail had no row
 * for it, so the movements no longer summed to the balance change.
 *
 * THE RULE: the residual deduct writes a 'deduct' row mirroring
 * the sibling rows exactly (movement_type 'deduct', qty
 * -remainingGlobal, before_qty remainingGlobal, after_qty 0,
 * unit_cost the product cost_price, total_cost through
 * stockMovementTotal at book digits, reason
 * 'archive_stock_zeroing', reference inventory_adjustment /
 * product id, location the fallback location, plus the same
 * postInventoryAdjustment call the siblings make). A zero
 * residual writes no row: the row exists iff a residual balance
 * actually moved.
 *
 * WHAT THIS PINS, driving the REAL toggleProductArchive through
 * the REAL CatalogProductService facade on PGlite (fresh database
 * per case; accountingPosting omitted, so the journal call is
 * skipped exactly as the siblings skip it without a posting
 * service; book digits resolve from the seeded EGP tenant):
 * - Residual case (global 10, one location row 6): TWO rows —
 *   the location leg (-6, before 6, after 0) and the residual
 *   (-4, before 4, after 0, unit_cost 5, total_cost 20) — and
 *   the product + location end at 0.
 * - Exact case (location 10 = global 10): exactly ONE row, no
 *   residual row.
 * - No-location-rows case (global 7, no location balances):
 *   exactly ONE row (-7, before 7, after 0) — the pre-existing
 *   else branch, pinned so the fix does not disturb it.
 * Fail-first: on the unpatched code the residual case writes
 * only ONE row and the residual-row assertions fail.
 * Prospective only; no posted row is rewritten.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

const adminAuth: AuthContext = {
  userId: 1,
  sessionId: 'spec',
  username: 'admin',
  role: 'admin',
  permissions: ['canAdjustInventory'],
  tenantId: TENANT,
  accountId: ACCOUNT,
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, sku text, style_code text, item_kind text, item_type text, color text, size text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, wholesale_price numeric DEFAULT 0, min_stock_qty numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, default_location_id bigint, catalog_updated_at timestamptz, updated_at timestamptz);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, created_at timestamptz DEFAULT NOW());
    CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
  `);
  await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: '"EGP"' }).execute();
  await (db as any)
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();
  await (db as any)
    .insertInto('stock_locations')
    .values({
      id: 10,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      branch_id: 1,
      name: 'Main warehouse',
      location_type: 'internal_warehouse',
      is_active: true,
    })
    .execute();
  return { pg, db };
}

async function seedProduct(db: Kysely<Database>, stockQty: number, locationQty: number | null): Promise<void> {
  await (db as any)
    .insertInto('products')
    .values({
      id: 101,
      tenant_id: TENANT,
      account_id: ACCOUNT,
      name: 'Widget 101',
      barcode: 'W101',
      sku: 'W101',
      style_code: null,
      item_kind: 'standard',
      item_type: 'product',
      color: null,
      size: null,
      stock_qty: stockQty,
      reserved_qty: 0,
      cost_price: 5,
      retail_price: 100,
      wholesale_price: 100,
      min_stock_qty: 0,
      is_active: true,
      track_serials: false,
      default_location_id: 10,
    })
    .execute();
  if (locationQty !== null) {
    await (db as any)
      .insertInto('product_location_stock')
      .values({
        tenant_id: TENANT,
        account_id: ACCOUNT,
        product_id: 101,
        branch_id: 1,
        location_id: 10,
        qty: locationQty,
        reserved_qty: 0,
      })
      .execute();
  }
}

function buildService(db: Kysely<Database>): CatalogProductService {
  const auditStub = { log: async () => undefined };
  const inventoryScopeStub = { assertLocationScope: async () => ({ id: 10, name: 'Main warehouse', branchId: 1 }) };
  return new CatalogProductService(db as any, auditStub as any, inventoryScopeStub as any);
}

async function movementRows(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('stock_movements').selectAll().orderBy('id', 'asc').execute();
}

async function main(): Promise<void> {
  // 1. Residual case: global 10, one location row 6 — the residual
  //    4 must get its own row.
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 10, 6);
      const service = buildService(db);
      const result: any = await service.toggleProductArchive(101, adminAuth, { zeroStock: true });
      assert.equal(result.isActive, false, 'the product is archived');
      const rows = await movementRows(db);
      assert.equal(rows.length, 2, `residual case must write exactly 2 movement rows, got ${rows.length}`);
      const [leg, residual] = rows;
      assert.equal(leg.movement_type, 'deduct');
      assert.equal(Number(leg.qty), -6);
      assert.equal(Number(leg.before_qty), 6);
      assert.equal(Number(leg.after_qty), 0);
      assert.equal(residual.movement_type, 'deduct');
      assert.equal(Number(residual.qty), -4, 'residual row qty is -remainingGlobal');
      assert.equal(Number(residual.before_qty), 4, 'residual row before_qty is remainingGlobal');
      assert.equal(Number(residual.after_qty), 0);
      assert.equal(Number(residual.unit_cost), 5, 'residual row carries the product cost_price');
      assert.equal(Number(residual.total_cost), 20, 'residual row total is 4 x 5 at book digits');
      assert.equal(residual.reason, 'archive_stock_zeroing');
      assert.equal(residual.reference_type, 'inventory_adjustment');
      assert.equal(Number(residual.reference_id), 101);
      assert.equal(Number(residual.location_id), 10, 'residual row location is the fallback location');
      const product: any = await (db as any)
        .selectFrom('products')
        .select(['stock_qty', 'is_active'])
        .where('id', '=', 101)
        .executeTakeFirst();
      assert.equal(Number(product.stock_qty), 0, 'global stock ends at 0');
      assert.equal(product.is_active, false);
      const loc: any = await (db as any)
        .selectFrom('product_location_stock')
        .select('qty')
        .where('product_id', '=', 101)
        .executeTakeFirst();
      assert.equal(Number(loc.qty), 0, 'location stock ends at 0');
    } finally {
      await db.destroy();
    }
    console.log('  archive residual writes its own movement row passed');
  }

  // 2. Exact case: location 10 = global 10 — no residual, exactly
  //    one row, and no spurious residual row appears.
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 10, 10);
      const service = buildService(db);
      await service.toggleProductArchive(101, adminAuth, { zeroStock: true });
      const rows = await movementRows(db);
      assert.equal(rows.length, 1, `exact case must write exactly 1 movement row, got ${rows.length}`);
      assert.equal(Number(rows[0].qty), -10);
      assert.equal(Number(rows[0].before_qty), 10);
      assert.equal(Number(rows[0].after_qty), 0);
    } finally {
      await db.destroy();
    }
    console.log('  archive exact zeroing writes no residual row passed');
  }

  // 3. No-location-rows case: global 7, no balances — the
  //    pre-existing else branch writes exactly one row.
  {
    const { pg, db } = await makeDb();
    try {
      await seedProduct(db, 7, null);
      const service = buildService(db);
      await service.toggleProductArchive(101, adminAuth, { zeroStock: true });
      const rows = await movementRows(db);
      assert.equal(rows.length, 1, `no-location case must write exactly 1 movement row, got ${rows.length}`);
      assert.equal(Number(rows[0].qty), -7);
      assert.equal(Number(rows[0].before_qty), 7);
      assert.equal(Number(rows[0].after_qty), 0);
      assert.equal(Number(rows[0].unit_cost), 5);
      assert.equal(Number(rows[0].total_cost), 35);
    } finally {
      await db.destroy();
    }
    console.log('  archive global-only zeroing keeps its single row passed');
  }

  console.log('stock movements archive residual row checks passed (3 cases)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
