import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Products list paginates in SQL instead of re-reading the whole catalog
 * per page (INV-SLOW-INITIAL-LOADS).
 *
 * THE GAP: CatalogProductService.listProducts fetched EVERY active product
 * of the tenant (~40 columns incl. metadata, 2 joins) with no LIMIT on
 * every call, then filtered / sorted / paginated in Node — and the
 * frontend listAll() loop (useProductsQuery) repeats that whole pass
 * once per page, SEQUENTIALLY (pageSize 1000, so 10 passes for the
 * 10,000-product test10k tenant). Every initial load of a page that
 * needs the catalog (products page, create sales order / quotation,
 * price lists, kitchen display, quick product modal, new product form,
 * import shipment dialog) paid N full-catalog passes: ~15-20s on
 * test10k, build 1.1.40. Verified against live main HEAD 80156043:
 * backend/src/modules/catalog/services/catalog-product.service.ts is
 * byte-identical to live and still has the unbounded `.execute()`.
 *
 * THE RULE: an unfiltered list (no q, no category/supplier/location
 * filter, view 'all' or 'archived', default id-desc sort, no fashion
 * grouping) pages in SQL — LIMIT/OFFSET for the page rows, COUNT(*) for
 * the total, SQL aggregates for the summary — so one page request reads
 * one page of products, not the catalog. Any filtered / sorted /
 * grouped request keeps the old full-fetch + JS-filter path, so search,
 * low/out/offers/special views and custom sorts keep their exact
 * semantics. Prospective only.
 *
 * WHAT THIS PINS, driving the REAL CatalogProductService.listProducts
 * on PGlite (tenant t1, 2000 seeded products, integer prices/qtys so
 * the summary sums are exact):
 * - a page request issues a products SELECT with a LIMIT (fails at
 *   base, where the SELECT has no LIMIT and reads all 2000 rows);
 * - page 1 returns exactly pageSize rows, pagination totals match the
 *   seeded catalog, and the summary equals the hand-computed summary
 *   over the seed (totalProducts / low / out / inventoryCost /
 *   inventorySaleValue / activeOffersCount / customerPriceCount);
 * - walking all pages returns every product id exactly once, in
 *   id-desc order (no dropped or duplicated rows);
 * - filtered requests still filter correctly (q search, 'low' view,
 *   archived view) — the slow path is preserved, not broken;
 * - timing is logged (listAll-style sequential page loop) so the
 *   before/after measurement is visible in the run output; it is not
 *   asserted on wall time, which is noisy on PGlite.
 * This is not a live-Postgres timing proof: PGlite timings are
 * relative only, and the production latency still rests on the
 * deployed build.
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

const PRODUCT_COUNT = 2000;

interface LoggedQuery { sql: string; ms: number }

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database>; queries: LoggedQuery[] }> {
  const pg = new PGlite();
  const queries: LoggedQuery[] = [];
  const db = new Kysely<Database>({
    dialect: new PGliteDialect(pg),
    log: (event) => {
      if (event.level === 'query') queries.push({ sql: event.query.sql, ms: event.queryDurationMillis });
    },
  });
  await pg.exec(`
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, sku text, catalog_updated_at timestamptz, item_type text, item_kind text, style_code text, color text, size text, bin_location text, track_serials boolean, category_id bigint, supplier_id bigint, cost_price numeric, retail_price numeric, wholesale_price numeric, credit_price numeric, consumer_price numeric, min_selling_price numeric, stock_qty numeric, min_stock_qty numeric, default_location_id bigint, notes text, metadata jsonb, is_active boolean, calories numeric, allergens text, is_spicy boolean, is_vegetarian boolean, is_gluten_free boolean);
    CREATE TABLE manufacturing_boms (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, is_active boolean);
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean);
    CREATE TABLE product_categories (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean);
    CREATE TABLE suppliers (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, is_active boolean);
    CREATE TABLE product_location_stock (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, location_id bigint, branch_id bigint, qty numeric, reserved_qty numeric);
    CREATE TABLE product_units (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, name text, multiplier numeric, barcode text, is_base_unit boolean, is_sale_unit_default boolean, is_purchase_unit_default boolean);
    CREATE TABLE product_offers (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, offer_type text, value numeric, start_date date, end_date date, min_qty numeric, is_active boolean);
    CREATE TABLE product_customer_prices (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint, customer_id bigint, price numeric);
    CREATE TABLE stock_movements (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint);
    CREATE TABLE import_shipment_items (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint);
    CREATE TABLE purchase_items (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint);
    CREATE TABLE sale_items (id bigint PRIMARY KEY, tenant_id text, account_id text, product_id bigint);
  `);
  return { pg, db, queries };
}

async function seed(db: Kysely<Database>): Promise<void> {
  await db.insertInto('stock_locations' as never).values([
    { id: 1, tenant_id: 't1', account_id: 'a1', name: 'Main', is_active: true },
    { id: 2, tenant_id: 't1', account_id: 'a1', name: 'Branch', is_active: true },
  ] as never).execute();
  await db.insertInto('product_categories' as never).values([
    { id: 1, tenant_id: 't1', account_id: 'a1', name: 'General', is_active: true },
  ] as never).execute();
  await db.insertInto('suppliers' as never).values([
    { id: 1, tenant_id: 't1', account_id: 'a1', name: 'Supplier One', is_active: true },
  ] as never).execute();

  // Deterministic integer pattern so the expected summary is exact:
  // cost = (i % 7) + 1, retail = cost + 2, stock = i % 5, min = 3.
  // Products 1..5 carry one active offer each + one customer price each;
  // product 6 carries one INACTIVE offer (must not count).
  // Products 1999..2000 are archived (is_active false).
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i <= PRODUCT_COUNT; i++) {
    const cost = (i % 7) + 1;
    rows.push({
      id: i, tenant_id: 't1', account_id: 'a1',
      name: `Product ${i}`, name_en: `Product ${i}`, barcode: `BC${i}`, sku: `SKU${i}`,
      catalog_updated_at: new Date('2026-11-01T00:00:00.000Z'),
      item_type: 'product', item_kind: 'standard', style_code: null, color: null, size: null,
      bin_location: null, track_serials: false, category_id: 1, supplier_id: 1,
      cost_price: cost, retail_price: cost + 2, wholesale_price: cost + 1,
      credit_price: cost + 2, consumer_price: cost + 2, min_selling_price: cost,
      stock_qty: i % 5, min_stock_qty: 3,
      default_location_id: 1, notes: '', metadata: { icon: 'box' },
      is_active: i <= 1998, calories: null, allergens: null,
      is_spicy: false, is_vegetarian: false, is_gluten_free: false,
    });
  }
  for (let s = 0; s < rows.length; s += 400) {
    await db.insertInto('products' as never).values(rows.slice(s, s + 400) as never).execute();
  }
  const stockRows: Record<string, unknown>[] = [];
  for (let i = 1; i <= PRODUCT_COUNT; i++) {
    stockRows.push({ id: i, tenant_id: 't1', account_id: 'a1', product_id: i, location_id: 1, branch_id: null, qty: i % 5, reserved_qty: 0 });
  }
  for (let s = 0; s < stockRows.length; s += 400) {
    await db.insertInto('product_location_stock' as never).values(stockRows.slice(s, s + 400) as never).execute();
  }
  const offers: Record<string, unknown>[] = [];
  for (let i = 1; i <= 5; i++) {
    offers.push({ id: i, tenant_id: 't1', account_id: 'a1', product_id: i, offer_type: 'discount', value: 5, start_date: '2026-01-01', end_date: '2027-01-01', min_qty: 1, is_active: true });
  }
  offers.push({ id: 6, tenant_id: 't1', account_id: 'a1', product_id: 6, offer_type: 'discount', value: 5, start_date: '2026-01-01', end_date: '2027-01-01', min_qty: 1, is_active: false });
  await db.insertInto('product_offers' as never).values(offers as never).execute();
  const prices: Record<string, unknown>[] = [];
  for (let i = 1; i <= 5; i++) {
    prices.push({ id: i, tenant_id: 't1', account_id: 'a1', product_id: i, customer_id: 1, price: 10 + i });
  }
  await db.insertInto('product_customer_prices' as never).values(prices as never).execute();
}

function expectedSummary(): Record<string, number> {
  let low = 0;
  let out = 0;
  let cost = 0;
  let sale = 0;
  for (let i = 1; i <= 1998; i++) {
    const c = (i % 7) + 1;
    const stock = i % 5;
    if (stock <= 3) low += 1;
    if (stock <= 0) out += 1;
    cost += stock * c;
    sale += stock * (c + 2);
  }
  return { totalProducts: 1998, lowStockCount: low, outOfStockCount: out, inventoryCost: cost, inventorySaleValue: sale, activeOffersCount: 5, customerPriceCount: 5 };
}

async function main(): Promise<void> {
  const { pg, db, queries } = await makeDb();
  try {
    await seed(db);
    const service = new CatalogProductService(
      db,
      {} as never,
      { assertLocationScope: async () => null } as never,
    );

    // MEASUREMENT (logged, not asserted): the listAll-style loop the
    // frontend runs on every catalog-needing page — sequential page
    // requests of 1000 rows over the seeded catalog.
    const t0 = Date.now();
    const first = await service.listProducts({ page: 1, pageSize: 1000 }, auth) as { products: unknown[]; pagination: { totalPages: number } };
    const second = await service.listProducts({ page: 2, pageSize: 1000 }, auth) as { products: unknown[]; pagination: { totalPages: number } };
    const loopMs = Date.now() - t0;
    const productSelects = queries.filter((q) => /from\s+"products"/i.test(q.sql));
    console.log(`[measure] listAll-style loop: 2 sequential page requests took ${loopMs}ms; products-table SELECTs in the loop: ${productSelects.length}; products SELECT SQL has LIMIT: ${productSelects.some((q) => /limit\s+\$\d+/i.test(q.sql))}`);
    console.log(`[measure] page 1 rows: ${(first.products as unknown[]).length}, page 2 rows: ${(second.products as unknown[]).length}, totalPages: ${first.pagination.totalPages}`);
    queries.length = 0;

    // PIN 1 — one page request reads one page, not the catalog: the
    // products SELECT carries a LIMIT. (Fails at base.)
    const page = await service.listProducts({ page: 1, pageSize: 20 }, auth) as {
      products: Array<Record<string, unknown>>;
      pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
      summary: Record<string, number | null>;
    };
    const selects = queries.filter((q) => /from\s+"products"/i.test(q.sql));
    assert.ok(selects.length >= 1, 'expected at least one products-table SELECT');
    assert.ok(
      selects.some((q) => /limit\s+\$\d+/i.test(q.sql)),
      `the products SELECT must carry a LIMIT (page request must not read the whole catalog); got: ${selects.map((q) => q.sql).join(' | ')}`,
    );
    assert.equal(page.products.length, 20, 'page 1 must return exactly pageSize rows');
    assert.equal(page.pagination.totalItems, 1998, 'totalItems must count the whole active catalog');
    assert.equal(page.pagination.totalPages, 100, 'totalPages must be ceil(1998 / 20)');
    assert.equal(page.pagination.page, 1);
    assert.equal(page.pagination.pageSize, 20);
    // Page rows are the newest products first (default id-desc sort).
    assert.deepEqual(
      page.products.map((p) => Number(p.id)),
      Array.from({ length: 20 }, (_, k) => 1998 - k),
      'page 1 must be ids 1998..1979 in id-desc order',
    );
    const expected = expectedSummary();
    assert.equal(page.summary.totalProducts, expected.totalProducts, 'summary.totalProducts');
    assert.equal(page.summary.lowStockCount, expected.lowStockCount, 'summary.lowStockCount');
    assert.equal(page.summary.outOfStockCount, expected.outOfStockCount, 'summary.outOfStockCount');
    assert.equal(Number(page.summary.inventoryCost), expected.inventoryCost, 'summary.inventoryCost');
    assert.equal(Number(page.summary.inventorySaleValue), expected.inventorySaleValue, 'summary.inventorySaleValue');
    assert.equal(page.summary.activeOffersCount, expected.activeOffersCount, 'summary.activeOffersCount (inactive offer must not count)');
    assert.equal(page.summary.customerPriceCount, expected.customerPriceCount, 'summary.customerPriceCount');

    // PIN 2 — walking all pages returns the whole catalog exactly once.
    const seen: number[] = [];
    const totalPages = page.pagination.totalPages;
    for (let p = 1; p <= totalPages; p++) {
      const res = await service.listProducts({ page: p, pageSize: 20 }, auth) as { products: Array<Record<string, unknown>> };
      for (const row of res.products) seen.push(Number(row.id));
    }
    assert.equal(seen.length, 1998, 'all pages together must return 1998 rows');
    assert.equal(new Set(seen).size, 1998, 'no duplicated product across pages');
    assert.deepEqual(seen, Array.from({ length: 1998 }, (_, k) => 1998 - k), 'pages walk the catalog in id-desc order with no gaps');

    // PIN 3 — the slow path is preserved for filtered requests.
    const searched = await service.listProducts({ page: 1, pageSize: 20, q: 'Product 42' }, auth) as {
      products: Array<Record<string, unknown>>;
      pagination: { totalItems: number };
    };
    assert.ok(searched.pagination.totalItems >= 1, 'q search must find matching products');
    assert.ok(
      searched.products.every((p) => String(p.name).includes('42')),
      'every searched row must match the query',
    );
    const low = await service.listProducts({ page: 1, pageSize: 20, view: 'low' }, auth) as {
      products: Array<Record<string, unknown>>;
      pagination: { totalItems: number };
    };
    assert.ok(low.pagination.totalItems > 0, 'low view must return low-stock products');
    assert.ok(
      low.products.every((p) => Number(p.stock) <= Number(p.minStock)),
      'every low-view row must be at or below its minimum stock',
    );
    const archived = await service.listProducts({ page: 1, pageSize: 20, view: 'archived' }, auth) as {
      products: Array<Record<string, unknown>>;
      pagination: { totalItems: number };
    };
    assert.equal(archived.pagination.totalItems, 2, 'archived view must return exactly the 2 archived products');
    assert.deepEqual(
      archived.products.map((p) => Number(p.id)).sort((a, b) => a - b),
      [1999, 2000],
      'archived view must return products 1999 and 2000',
    );

    console.log('list-products-sql-pagination checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
