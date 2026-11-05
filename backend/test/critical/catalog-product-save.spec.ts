import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

/*
 * Product save returns one row, and an omitted English name is preserved
 * (INV-PRODUCTS-WORKSPACE-SAVE).
 *
 * THE GAP: every product create/edit/delete re-ran the full-catalog
 * listProducts (10,001 rows x ~40 cols, no LIMIT/OFFSET) and returned it, so
 * a save paid for a whole catalog scan — and a multi-megabyte payload — that
 * no caller used; the frontend then awaited five more refetchType: 'all'
 * invalidations plus an 11-GET listAll just to find the saved row, which is
 * why a create took 20-30 s and an edit 15-20 s on 10,001 products while the
 * list itself loaded in ~1.3 s. A second, silent gap rode the same code:
 * normalizeProductPayload always assigned nameEn (string-or-null, never
 * undefined), so updateProduct's preserve branch
 * (normalized.nameEn !== undefined ? ... : existing.name_en) was unreachable
 * and every update that did not carry nameEn — barcode/offer/price cards,
 * partial edits — wiped the stored English name to NULL.
 *
 * THE RULE: create/update return only the saved product
 * ({ ok, id?, product: getProduct(id) }); delete returns { ok: true }; and
 * normalizeProductPayload keeps nameEn undefined when the caller omits the
 * key, so omitted means "leave it" and '' means "clear it".
 *
 * WHAT THIS PINS, driving the REAL CatalogProductService on PGlite (fresh
 * database per case; audit is a log stub, no warehouse/category/supplier in
 * the payloads so the scope checks never run):
 * - update without nameEn keeps the stored name_en and returns the single
 *   saved product with no `products` key.
 * - update with nameEn changes it; update with nameEn '' clears it to null.
 * - delete returns { ok: true } with no `products` key, and the row is gone.
 * - getProduct returns the single mapped product (id as string, nameEn).
 * - Source pin: no create/update/delete return runs listProducts anymore,
 *   and create/update return through getProduct.
 *
 * DELIBERATELY UNCHANGED, as separate scope:
 * - createProduct end-to-end on PGlite (its write surface — style-code,
 *   identity, category/supplier, customer-price and opening-stock checks —
 *   needs the full catalog setup; the existing stock-totals spec records the
 *   same boundary). Create's return shape is the same one-line pattern as
 *   update, pinned by the source pin below plus the frontend create-payload
 *   spec (useCreateProductMutation.spec.ts).
 * - The frontend no longer awaits refetchType: 'all' invalidations and
 *   refetchAndSelectProduct fetches one row by id (pinned by
 *   product-workspace.utils.spec.ts); the stock-adjustment cache patch is
 *   pinned by useInventoryMutations.spec.ts.
 * This is not an end-to-end save on live Postgres, and it does not drive a
 * fashion-group create (same boundary as above).
 */

const auth = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, permissions: [] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE products (
      id bigserial PRIMARY KEY, tenant_id text, account_id text,
      name text, name_en text, barcode text, sku text,
      catalog_updated_at timestamptz, item_type text, item_kind text,
      style_code text, color text, size text, bin_location text,
      track_serials boolean, category_id bigint, supplier_id bigint,
      cost_price numeric, retail_price numeric, wholesale_price numeric,
      credit_price numeric, consumer_price numeric, min_selling_price numeric,
      stock_qty numeric, min_stock_qty numeric, default_location_id bigint,
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
      name text, is_active boolean, location_type text
    );
    CREATE TABLE product_location_stock (
      id bigserial PRIMARY KEY, product_id bigint, location_id bigint, branch_id bigint,
      tenant_id text, account_id text, qty numeric, reserved_qty numeric
    );
    CREATE TABLE stock_movements (
      id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint,
      movement_type text, qty numeric, before_qty numeric, after_qty numeric,
      unit_cost numeric, total_cost numeric, reason text, note text,
      reference_type text, reference_id bigint, branch_id bigint, location_id bigint,
      created_by bigint, created_at timestamptz DEFAULT NOW()
    );
    CREATE TABLE import_shipment_items (id bigserial PRIMARY KEY, product_id bigint, tenant_id text);
    CREATE TABLE purchase_items (id bigserial PRIMARY KEY, product_id bigint, tenant_id text);
    CREATE TABLE sale_items (id bigserial PRIMARY KEY, product_id bigint, tenant_id text);
  `);
  return { pg, db };
}

function makeServices(db: Kysely<Database>): CatalogProductService {
  const fakeAudit: any = { log: async () => undefined };
  return new CatalogProductService(db as any, fakeAudit, {} as any);
}

async function seedProduct(db: Kysely<Database>): Promise<void> {
  await (db as any).insertInto('products').values({
    id: 1, tenant_id: 't1', account_id: 'a1',
    name: 'منتج اختبار', name_en: 'Test Product', barcode: 'T10K-1', sku: '',
    item_type: 'product', item_kind: 'standard', style_code: '', color: '', size: '',
    cost_price: 50, retail_price: 70, wholesale_price: 60,
    credit_price: null, consumer_price: null, min_selling_price: null,
    stock_qty: 7, min_stock_qty: 0, default_location_id: null,
    notes: '', metadata: '{}', is_active: true,
    calories: null, allergens: '[]', is_spicy: false, is_vegetarian: false, is_gluten_free: false,
  }).execute();
  await (db as any).insertInto('product_units').values({
    product_id: 1, tenant_id: 't1', account_id: 'a1',
    name: 'قطعة', multiplier: 1, barcode: 'T10K-1',
    is_base_unit: true, is_sale_unit_default: true, is_purchase_unit_default: true,
  }).execute();
}

function updatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'منتج اختبار',
    barcode: 'T10K-1',
    itemType: 'product',
    itemKind: 'standard',
    costPrice: 50,
    retailPrice: 70,
    wholesalePrice: 60,
    units: [{ name: 'قطعة', multiplier: 1, barcode: 'T10K-1', isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true }],
    offers: [],
    customerPrices: [],
    fashionVariants: [],
    ...overrides,
  };
}

async function main(): Promise<void> {
  // Case 1: update without nameEn preserves the stored English name and
  // returns only the saved product — no full-catalog `products` key.
  {
    const { db } = await makeDb();
    try {
      await seedProduct(db);
      const catalog = makeServices(db);
      const result = await catalog.updateProduct(1, updatePayload() as never, auth) as Record<string, unknown>;
      assert.equal(result.ok, true);
      assert.ok(!('products' in result), 'update must not return the full catalog list');
      const product = result.product as Record<string, unknown>;
      assert.equal(product.id, '1');
      assert.equal(product.name, 'منتج اختبار');
      assert.equal(product.nameEn, 'Test Product');
      const row = await (db as any).selectFrom('products').select('name_en').where('id', '=', 1).executeTakeFirst() as { name_en: string };
      assert.equal(row.name_en, 'Test Product');
    } finally {
      await db.destroy();
    }
  }

  // Case 2: update with nameEn changes the stored English name.
  {
    const { db } = await makeDb();
    try {
      await seedProduct(db);
      const catalog = makeServices(db);
      const result = await catalog.updateProduct(1, updatePayload({ nameEn: 'Edited Manual Product' }) as never, auth) as Record<string, unknown>;
      const product = result.product as Record<string, unknown>;
      assert.equal(product.nameEn, 'Edited Manual Product');
      const row = await (db as any).selectFrom('products').select('name_en').where('id', '=', 1).executeTakeFirst() as { name_en: string };
      assert.equal(row.name_en, 'Edited Manual Product');
    } finally {
      await db.destroy();
    }
  }

  // Case 3: update with nameEn '' clears the stored English name (explicit
  // clear — distinct from omitting the key, which preserves it).
  {
    const { db } = await makeDb();
    try {
      await seedProduct(db);
      const catalog = makeServices(db);
      const result = await catalog.updateProduct(1, updatePayload({ nameEn: '' }) as never, auth) as Record<string, unknown>;
      const product = result.product as Record<string, unknown>;
      assert.equal(product.nameEn, '');
      const row = await (db as any).selectFrom('products').select('name_en').where('id', '=', 1).executeTakeFirst() as { name_en: string | null };
      assert.equal(row.name_en, null);
    } finally {
      await db.destroy();
    }
  }

  // Case 4: delete returns { ok: true } with no `products` key, and the row
  // is gone (zero stock, no history, so the pre-checks pass).
  {
    const { db } = await makeDb();
    try {
      await seedProduct(db);
      await (db as any).updateTable('products').set({ stock_qty: 0 }).where('id', '=', 1).execute();
      const catalog = makeServices(db);
      const result = await catalog.deleteProduct(1, auth) as Record<string, unknown>;
      assert.deepEqual(result, { ok: true });
      assert.ok(!('products' in result), 'delete must not return the full catalog list');
      const row = await (db as any).selectFrom('products').select('id').where('id', '=', 1).executeTakeFirst();
      assert.equal(row, undefined);
    } finally {
      await db.destroy();
    }
  }

  // Case 5: getProduct returns the single mapped product.
  {
    const { db } = await makeDb();
    try {
      await seedProduct(db);
      const catalog = makeServices(db);
      const product = await catalog.getProduct(1, auth) as Record<string, unknown>;
      assert.equal(product.id, '1');
      assert.equal(product.name, 'منتج اختبار');
      assert.equal(product.nameEn, 'Test Product');
      assert.equal(Number(product.stock), 7);
    } finally {
      await db.destroy();
    }
  }

  // Case 6: source pin — no save return runs the full-catalog list anymore,
  // and create/update return through getProduct.
  {
    const servicePath = resolve(__dirname, '../../src/modules/catalog/services/catalog-product.service.ts');
    const source = readFileSync(servicePath, 'utf8');
    assert.ok(!source.includes('products: (await this.listProducts({}, actor)).products'),
      'no save return may run listProducts anymore');
    const getProductReturns = source.match(/product: await this\.getProduct\(/g) ?? [];
    assert.equal(getProductReturns.length, 2, `expected create+update to return via getProduct, found ${getProductReturns.length}`);
  }

  console.log('catalog-product-save: all cases passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
