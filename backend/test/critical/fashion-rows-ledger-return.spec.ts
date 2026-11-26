import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { InventoryScopeService } from '../../src/modules/inventory/services/inventory-scope.service';
import { AuditService } from '../../src/core/audit/audit.service';
import { stockMovementTotal } from '../../src/modules/catalog/engines/stock-movement-total.engine';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Phase 1 A3 — fashion rows stamp from the ledger return
 * (INV-PHASE1-A3-FASHION-ROWS-LEDGER-RETURN).
 *
 * THE GAP (grounding phase1-grounding-stock-movements.md §4.3): in
 * saveFashionGroup the three consolidation / stock-edit rows
 * (catalog-product-fashion.service.ts:489/:510/:738) discard the
 * applyStockDelta return and stamp before_qty/after_qty from cached
 * in-memory quantities — prevTargetStock/nextTargetStock and
 * prevRemovedStock from the byId map, currentStock/targetStock from
 * the draft snapshot. Every other paired site stamps from the ledger
 * return. If the ledger's post-lock quantity differs from the cached
 * one (multi-location stock, a stale browser snapshot, a concurrent
 * move), the row and the balance disagree and the audit trail lies.
 *
 * THE RULE: the three sites go through A0's recordStockMovement, which
 * runs the delta and writes exactly one row from the returned
 * scopeBefore/scopeAfter, all on the save transaction — so the row's
 * before/after are the LOCATION balances the delta actually moved
 * (the row's location_id), never the product's cached global stock.
 * - The in-loop byId cache updates use the leg's globalAfter (the
 *   ledger's reconciled global), not the old computed value: when the
 *   cache was right they are identical; when it was stale, globalAfter
 *   is the truth. The drafts loop later reads prior.stock_qty for kept
 *   variants, so the cache update stays load-bearing.
 * - total_cost is UNCHANGED: stockMovementTotal(qty, unitCost, digits)
 *   is roundMoney(qty * unitCost, digits), and every old site passed a
 *   positive qty, so the writer's roundMoney(|delta| * unitCost,
 *   moneyDigits) computes the identical total. A10 unifies rounding;
 *   this package only moves the stamping.
 * - location_id becomes the ledger call's rawLocId (where the balance
 *   actually moved), not effectiveLocId (a fallback guess when the stock
 *   sits in the unassigned pool).
 * - Deliberately OUT of this package: :583 (zeroing deduct — stamps by
 *   construction, full-location deduct, converted by the mechanical
 *   A6–A9 pass) and :893 (opening balance — converted by Phase 1 A4,
 *   which adds the 4th recordStockMovement call in this file).
 *
 * WHAT THIS PINS, driving the REAL CatalogProductService.saveFashionGroup
 * on PGlite (fresh database per case; no posting service, so the journal
 * call stays skipped — the journal-from-row behavior is already pinned
 * by catalog-stock-totals-book-digits.spec.ts Case 5):
 * - Consolidation: both legs of each location stamp the ledger's
 *   location balances (target 10→14 / 5→7, removed 4→0 / 2→0), with
 *   totals equal to stockMovementTotal, and the final globals are the
 *   reconciled sums (target 21, removed 0, removed archived).
 * - Stock edit: a +5 edit on a 15-global / 10-location-A variant stamps
 *   before 10 / after 15 (location A), not the cached global 15 → 20.
 * - Rollback: a save that throws AFTER the consolidation rows (outsider
 *   name collision) leaves zero movement rows and balances unchanged —
 *   the writer runs inside the save transaction.
 * - Source pins: exactly 4 recordStockMovement(trx, …) calls in the
 *   fashion file (3 from this package + the A4 opening-balance branch);
 *   none of the three cached stamps remain; the
 *   applyStockDelta import stays (the :583 zeroing path still calls it).
 * This is not an end-to-end run on live Postgres.
 */

type LooseDb = Record<string, Record<string, unknown>>;

const auth = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'tester',
  permissions: ['canAdjustInventory', 'canEditPrice'],
} as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE products (
      id bigserial PRIMARY KEY, tenant_id text, account_id text,
      name text, name_en text, barcode text, sku text,
      catalog_updated_at timestamptz, item_type text, item_kind text,
      style_code text, color text, size text, bin_location text,
      track_serials boolean, category_id bigint, supplier_id bigint,
      cost_price numeric, retail_price numeric, wholesale_price numeric,
      credit_price numeric, consumer_price numeric, min_selling_price numeric,
      stock_qty numeric, reserved_qty numeric, min_stock_qty numeric, default_location_id bigint,
      notes text, metadata jsonb, is_active boolean,
      calories numeric, allergens jsonb, is_spicy boolean,
      is_vegetarian boolean, is_gluten_free boolean,
      created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW()
    );
    CREATE TABLE product_units (
      id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text,
      name text, multiplier numeric, barcode text,
      is_base_unit boolean, is_sale_unit_default boolean, is_purchase_unit_default boolean
    );
    CREATE TABLE product_offers (
      id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text,
      offer_type text, value numeric, start_date text, end_date text, is_active boolean
    );
    CREATE TABLE product_customer_prices (
      id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text,
      customer_id bigint, price numeric
    );
    CREATE TABLE manufacturing_boms (
      id bigserial PRIMARY KEY, product_id bigint, tenant_id text, account_id text, is_active boolean
    );
    CREATE TABLE stock_locations (
      id bigserial PRIMARY KEY, tenant_id text, account_id text,
      name text, is_active boolean, location_type text, branch_id bigint
    );
    CREATE TABLE product_location_stock (
      id bigserial PRIMARY KEY, product_id bigint, location_id bigint, branch_id bigint,
      tenant_id text, account_id text, qty numeric, reserved_qty numeric, updated_at timestamptz
    );
    CREATE TABLE stock_movements (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, movement_type text, qty numeric, before_qty numeric, after_qty numeric, reason text, note text, reference_type text, reference_id bigint, created_by bigint, branch_id bigint, location_id bigint, unit_cost numeric, total_cost numeric, import_receipt_id bigint, serial_tracking jsonb, batch_tracking jsonb, created_at timestamptz NOT NULL DEFAULT NOW());
    CREATE TABLE import_shipment_items (id bigserial PRIMARY KEY, product_id bigint, tenant_id text);
    CREATE TABLE purchase_items (id bigserial PRIMARY KEY, product_id bigint, tenant_id text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, product_id bigint, tenant_id text);
    INSERT INTO settings VALUES ('t1', 'currency', '"EGP"');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1', 'EGP', 1, true);
    INSERT INTO stock_locations (id, tenant_id, account_id, name, is_active, location_type) VALUES
      (10, 't1', 'a1', 'A', true, NULL),
      (20, 't1', 'a1', 'B', true, NULL);
  `);
  return { pg, db };
}

function makeServices(db: Kysely<Database>): CatalogProductService {
  const fakeAudit = { log: async () => undefined };
  return new CatalogProductService(db, fakeAudit as unknown as AuditService, new InventoryScopeService(db));
}

async function seedProduct(
  db: Kysely<Database>,
  row: {
    id: number;
    name: string;
    color: string;
    size: string;
    barcode: string;
    sku: string;
    style: string;
    cost: number;
    stock: number;
  },
): Promise<void> {
  const anyDb = db as unknown as Kysely<LooseDb>;
  await anyDb
    .insertInto('products')
    .values({
      id: row.id,
      tenant_id: 't1',
      account_id: 'a1',
      name: row.name,
      name_en: null,
      barcode: row.barcode,
      sku: row.sku,
      item_type: 'product',
      item_kind: 'fashion',
      style_code: row.style,
      color: row.color,
      size: row.size,
      cost_price: row.cost,
      retail_price: row.cost + 5,
      wholesale_price: row.cost + 2,
      credit_price: null,
      consumer_price: null,
      min_selling_price: null,
      stock_qty: row.stock,
      reserved_qty: 0,
      min_stock_qty: 0,
      default_location_id: 10,
      notes: '',
      metadata: '{}',
      is_active: true,
      calories: null,
      allergens: '[]',
      is_spicy: false,
      is_vegetarian: false,
      is_gluten_free: false,
    })
    .execute();
  await anyDb
    .insertInto('product_units')
    .values({
      product_id: row.id,
      tenant_id: 't1',
      account_id: 'a1',
      name: 'قطعة',
      multiplier: 1,
      barcode: row.barcode,
      is_base_unit: true,
      is_sale_unit_default: true,
      is_purchase_unit_default: true,
    })
    .execute();
}

async function seedLocationStock(
  db: Kysely<Database>,
  productId: number,
  locationId: number,
  qty: number,
): Promise<void> {
  const anyDb = db as unknown as Kysely<LooseDb>;
  await anyDb
    .insertInto('product_location_stock')
    .values({
      product_id: productId,
      location_id: locationId,
      branch_id: null,
      tenant_id: 't1',
      account_id: 'a1',
      qty,
      reserved_qty: 0,
    })
    .execute();
}

function fashionRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'قميص أحمر',
    barcode: 'T-RED-S',
    sku: 'SKU-RED-S',
    itemType: 'product',
    itemKind: 'fashion',
    styleCode: '1001',
    color: 'red',
    size: 'S',
    costPrice: 10,
    retailPrice: 15,
    wholesalePrice: 12,
    units: [
      { name: 'قطعة', multiplier: 1, barcode: 'T-RED-S', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true },
    ],
    offers: [],
    customerPrices: [],
    fashionVariants: [],
    ...overrides,
  };
}

type MovementRow = {
  product_id: number;
  movement_type: string;
  qty: string;
  before_qty: string;
  after_qty: string;
  unit_cost: string;
  total_cost: string;
  reason: string;
  reference_type: string;
  reference_id: number;
  location_id: number | null;
};

async function readRows(db: Kysely<Database>): Promise<MovementRow[]> {
  const anyDb = db as unknown as Kysely<LooseDb>;
  return (await anyDb.selectFrom('stock_movements').selectAll().orderBy('id').execute()) as MovementRow[];
}

async function readBalances(
  db: Kysely<Database>,
  productId: number,
): Promise<{ globalQty: number; byLocation: Map<number, number> }> {
  const anyDb = db as unknown as Kysely<LooseDb>;
  const product = (await anyDb
    .selectFrom('products')
    .select('stock_qty')
    .where('id', '=', productId)
    .executeTakeFirst()) as { stock_qty: string };
  const locs = (await anyDb
    .selectFrom('product_location_stock')
    .select(['location_id', 'qty'])
    .where('product_id', '=', productId)
    .execute()) as Array<{ location_id: number; qty: string }>;
  return {
    globalQty: Number(product.stock_qty),
    byLocation: new Map(locs.map((l) => [Number(l.location_id), Number(l.qty)])),
  };
}

async function seedConsolidationGroup(db: Kysely<Database>): Promise<void> {
  // Target: global 15 = loc A 10 + loc B 5. Removed: global 6 = loc A 4 + loc B 2.
  // Same cost (10) on both — assertFashionRemovedStockSafe requires equal costs.
  await seedProduct(db, {
    id: 1,
    name: 'قميص أحمر',
    color: 'red',
    size: 'S',
    barcode: 'T-RED-S',
    sku: 'SKU-RED-S',
    style: '1001',
    cost: 10,
    stock: 15,
  });
  await seedProduct(db, {
    id: 2,
    name: 'قميص أحمر',
    color: 'red',
    size: 'M',
    barcode: 'T-RED-M',
    sku: 'SKU-RED-M',
    style: '1001',
    cost: 10,
    stock: 6,
  });
  await seedLocationStock(db, 1, 10, 10);
  await seedLocationStock(db, 1, 20, 5);
  await seedLocationStock(db, 2, 10, 4);
  await seedLocationStock(db, 2, 20, 2);
}

async function main(): Promise<void> {
  // Block 1: consolidation — both legs of each location stamp the ledger's
  // location balances, not the cached global stock. Pre-fix the target leg
  // stamps before 15 / after 19 (global) instead of 10 → 14 (loc A).
  {
    const { db } = await makeDb();
    try {
      await seedConsolidationGroup(db);
      const catalog = makeServices(db);
      const result = (await catalog.saveFashionGroup(
        '1001',
        { rows: [fashionRow({ id: 1 })], consolidateStock: true } as never,
        auth,
      )) as Record<string, unknown>;
      assert.equal(result.ok, true);
      assert.equal(result.updated, 1);
      assert.equal(result.archived, 1);

      const rows = await readRows(db);
      assert.equal(rows.length, 4, `expected 4 consolidation rows, got ${rows.length}`);
      const key = (r: MovementRow): string => `${r.product_id}@${r.location_id}`;
      const byKey = new Map(rows.map((r) => [key(r), r]));
      const expectRow = (k: string, qty: number, before: number, after: number): void => {
        const row = byKey.get(k);
        assert.ok(row, `missing consolidation row ${k}`);
        assert.equal(row!.movement_type, 'transfer');
        assert.equal(row!.reason, 'variant_consolidation');
        assert.equal(Number(row!.qty), qty, `${k} qty`);
        assert.equal(
          Number(row!.before_qty),
          before,
          `${k} before_qty must be the ledger's location balance, not the cached global`,
        );
        assert.equal(
          Number(row!.after_qty),
          after,
          `${k} after_qty must be the ledger's location balance, not the cached global`,
        );
        assert.equal(Number(row!.unit_cost), 10);
        assert.equal(Number(row!.total_cost), stockMovementTotal(Math.abs(qty), 10, 2), `${k} total_cost`);
      };
      expectRow('1@10', 4, 10, 14);
      expectRow('1@20', 2, 5, 7);
      expectRow('2@10', -4, 4, 0);
      expectRow('2@20', -2, 2, 0);
      assert.equal(byKey.get('1@10')!.reference_id, 2);
      assert.equal(byKey.get('2@10')!.reference_id, 1);

      const target = await readBalances(db, 1);
      assert.equal(target.globalQty, 21);
      assert.equal(target.byLocation.get(10), 14);
      assert.equal(target.byLocation.get(20), 7);
      const removed = await readBalances(db, 2);
      assert.equal(removed.globalQty, 0);
      assert.equal(removed.byLocation.get(10), 0);
      assert.equal(removed.byLocation.get(20), 0);
      const anyDb = db as unknown as Kysely<LooseDb>;
      const removedRow = (await anyDb
        .selectFrom('products')
        .select('is_active')
        .where('id', '=', 2)
        .executeTakeFirst()) as { is_active: boolean };
      assert.equal(removedRow.is_active, false);
      console.log('  1. consolidation legs stamp the ledger return, passed');
    } finally {
      await db.destroy();
    }
  }

  // Block 2: per-variant stock edit — a +5 edit on a 15-global / 10-location-A
  // variant stamps before 10 / after 15 (location A), not the cached global
  // 15 → 20. Pre-fix the row reads before_qty 15 / after_qty 20.
  {
    const { db } = await makeDb();
    try {
      await seedProduct(db, {
        id: 1,
        name: 'قميص أحمر',
        color: 'red',
        size: 'S',
        barcode: 'T-RED-S',
        sku: 'SKU-RED-S',
        style: '1001',
        cost: 10,
        stock: 15,
      });
      await seedLocationStock(db, 1, 10, 10);
      await seedLocationStock(db, 1, 20, 5);
      const catalog = makeServices(db);
      const result = (await catalog.saveFashionGroup(
        '1001',
        { rows: [fashionRow({ id: 1, stock: 20, expectedStock: 15 })] } as never,
        auth,
      )) as Record<string, unknown>;
      assert.equal(result.ok, true);
      assert.equal(result.updated, 1);

      const rows = await readRows(db);
      assert.equal(rows.length, 1, `expected 1 adjustment row, got ${rows.length}`);
      const row = rows[0];
      assert.equal(row.movement_type, 'add');
      assert.equal(row.reason, 'fashion_matrix_adjustment');
      assert.equal(Number(row.qty), 5);
      assert.equal(
        Number(row.before_qty),
        10,
        'before_qty must be the ledger location balance, not the cached global 15',
      );
      assert.equal(
        Number(row.after_qty),
        15,
        'after_qty must be the ledger location balance, not the requested target 20',
      );
      assert.equal(Number(row.unit_cost), 10);
      assert.equal(Number(row.total_cost), stockMovementTotal(5, 10, 2));
      assert.equal(row.reference_type, 'inventory_adjustment');
      assert.equal(row.reference_id, 1);
      assert.equal(row.location_id, 10);

      const balances = await readBalances(db, 1);
      assert.equal(balances.globalQty, 20);
      assert.equal(balances.byLocation.get(10), 15);
      assert.equal(balances.byLocation.get(20), 5);
      console.log('  2. stock edit stamps the ledger return, passed');
    } finally {
      await db.destroy();
    }
  }

  // Block 3: rollback — a save that throws AFTER the consolidation rows
  // (outsider name collision) leaves zero movement rows and balances
  // unchanged: the writer runs inside the save transaction.
  {
    const { db } = await makeDb();
    try {
      await seedConsolidationGroup(db);
      await seedProduct(db, {
        id: 3,
        name: 'قميص أحمر',
        color: 'blue',
        size: 'L',
        barcode: 'OUT-1',
        sku: 'OUT-1',
        style: '2002',
        cost: 10,
        stock: 0,
      });
      const catalog = makeServices(db);
      await assert.rejects(
        catalog.saveFashionGroup('1001', { rows: [fashionRow({ id: 1 })], consolidateStock: true } as never, auth),
        /already in use/,
      );
      const rows = await readRows(db);
      assert.equal(rows.length, 0, `a rolled-back save must leave zero movement rows, got ${rows.length}`);
      const target = await readBalances(db, 1);
      assert.equal(target.globalQty, 15);
      assert.equal(target.byLocation.get(10), 10);
      assert.equal(target.byLocation.get(20), 5);
      const removed = await readBalances(db, 2);
      assert.equal(removed.globalQty, 6);
      assert.equal(removed.byLocation.get(10), 4);
      assert.equal(removed.byLocation.get(20), 2);
      console.log('  3. rollback leaves no row and balances unchanged, passed');
    } finally {
      await db.destroy();
    }
  }

  // Block 4: source pins + wiring (363 specs — the purchases-writer spec is the last entry).
  {
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/catalog/services/catalog-product-fashion.service.ts'),
      'utf8',
    );
    const writerCalls = source.match(/recordStockMovement\(trx/g) ?? [];
    assert.equal(
      writerCalls.length,
      4,
      `expected exactly 4 recordStockMovement(trx, …) calls, found ${writerCalls.length}`,
    );
    assert.ok(
      !source.includes('before_qty: prevTargetStock'),
      'the consolidation target leg must not stamp the cached global',
    );
    assert.ok(
      !source.includes('before_qty: prevRemovedStock'),
      'the consolidation removed leg must not stamp the cached global',
    );
    assert.ok(!source.includes('before_qty: currentStock'), 'the stock-edit row must not stamp the cached global');
    assert.ok(
      !source.includes('after_qty: nextTargetStock'),
      'the consolidation target leg must not stamp the computed global',
    );
    assert.ok(!source.includes('after_qty: targetStock'), 'the stock-edit row must not stamp the requested target');
    assert.ok(
      source.includes('common/utils/stock-movement-writer'),
      'the fashion file must import the ledger-module row-writer',
    );
    assert.ok(
      source.includes('import { applyStockDelta }'),
      'the applyStockDelta import stays — the :583 zeroing path still calls it',
    );
    console.log('  4. source pins: passed');

    const specs = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/critical-specs.json'), 'utf8'))
      .specs as string[];
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const serial = String(pkg.scripts['test:critical:serial']);
    const chain = serial.split(' ').filter((t: string) => t.endsWith('.spec.ts'));
    assert.equal(specs.length, 372);
    assert.equal(chain.length, 372);
    assert.deepEqual(chain, specs);
    assert.ok(specs.includes('test/critical/opening-balances-ledger.spec.ts'));
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-b3-sales-storefront.spec.ts');
    console.log('  5. evidence spec wired into both critical lists (372 = 372, identical order), passed');
  }

  console.log('fashion-rows-ledger-return: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
