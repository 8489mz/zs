/* POS dashed barcode (INV-POS-BARCODE-DASH): a product whose barcode contains
 * a dash must be found by scanning/typing the full dashed barcode, whatever
 * letter case the cashier types or the scanner sends. The frontend already
 * matches barcodes case-insensitively (trim + lowercase); the backend
 * findPosProductsByBarcode compared with case-sensitive `=`, so a dashed
 * (lettered) barcode failed whenever the typed/scanned case differed from
 * the stored case, while digits-only barcodes always worked. Drives the
 * REAL CatalogProductService.listPosProducts on PGlite.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';

const ACTOR: any = {
  userId: 10,
  sessionId: 'session-pos',
  username: 'cashier',
  role: 'cashier',
  permissions: ['sales'],
  tenantId: 'tenant-a',
  accountId: 'account-a',
};

async function main() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  try {
    await sql`CREATE TABLE products (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, name TEXT, name_en TEXT, barcode TEXT, sku TEXT, item_type TEXT, item_kind TEXT, style_code TEXT, color TEXT, size TEXT, retail_price NUMERIC(14,2) DEFAULT 0, wholesale_price NUMERIC(14,2) DEFAULT 0, credit_price NUMERIC(14,2), consumer_price NUMERIC(14,2), min_selling_price NUMERIC(14,2), stock_qty NUMERIC(14,3) DEFAULT 0, min_stock_qty NUMERIC(14,3) DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, category_id INTEGER, track_serials BOOLEAN NOT NULL DEFAULT false, metadata JSONB)`.execute(db);
    await sql`CREATE TABLE manufacturing_boms (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER, is_active BOOLEAN NOT NULL DEFAULT true)`.execute(db);
    await sql`CREATE TABLE product_serials (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER, serial_number TEXT, imei_2 TEXT, status TEXT)`.execute(db);
    await sql`CREATE TABLE product_units (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER, name TEXT, multiplier NUMERIC(14,3) DEFAULT 1, barcode TEXT, is_base_unit BOOLEAN NOT NULL DEFAULT false, is_sale_unit_default BOOLEAN NOT NULL DEFAULT false, is_purchase_unit_default BOOLEAN NOT NULL DEFAULT false)`.execute(db);
    await sql`CREATE TABLE product_offers (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER, offer_type TEXT, value NUMERIC(14,2), start_date DATE, end_date DATE, is_active BOOLEAN NOT NULL DEFAULT true)`.execute(db);
    await sql`CREATE TABLE product_location_stock (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER, location_id INTEGER, branch_id INTEGER, qty NUMERIC(14,3) DEFAULT 0, reserved_qty NUMERIC(14,3) DEFAULT 0)`.execute(db);

    await sql`INSERT INTO products (tenant_id, account_id, name, barcode, sku, item_type, item_kind, retail_price, wholesale_price, stock_qty, is_active) VALUES
      ('tenant-a', 'account-a', 'Dashed Upper', 'ABC-123-456', 'SKU-DASH-1', 'product', 'standard', 100, 80, 12, true),
      ('tenant-a', 'account-a', 'Dashed Lower', 'def-789-012', 'SKU-DASH-2', 'product', 'standard', 60, 50, 4, true),
      ('tenant-a', 'account-a', 'Plain Numeric', '6221234567890', 'SKU-PLAIN-1', 'product', 'standard', 50, 40, 5, true),
      ('tenant-a', 'account-a', 'Fashion Variant', 'VAR-100', 'BLACK-XL-42', 'product', 'fashion', 90, 70, 2, true),
      ('tenant-a', 'account-a', 'Unit Box', 'UNIT-1', 'SKU-UNIT-1', 'product', 'standard', 30, 25, 6, true),
      ('t2', 't2', 'Other Tenant Dashed', 'ABC-123-456', 'SKU-DASH-9', 'product', 'standard', 10, 8, 1, true)`.execute(db);
    await sql`INSERT INTO product_units (tenant_id, account_id, product_id, name, multiplier, barcode, is_base_unit, is_sale_unit_default, is_purchase_unit_default) VALUES
      ('tenant-a', 'account-a', 5, 'كرتونة', 12, 'BOX-ABC-9', false, false, true)`.execute(db);

    const service = new CatalogProductService(
      db as never,
      {} as never,
      { assertLocationScope: async (locationId: number) => ({ id: locationId, name: 'Main', branchId: 1 }) } as never,
    );

    const ids = (r: any) => (r.products as any[]).map((p) => String(p.id));

    // Exact case still resolves (control).
    assert.deepEqual(ids(await service.listPosProducts({ barcode: 'ABC-123-456' }, ACTOR)), ['1'], 'exact-case dashed barcode resolves');
    // Typed lowercase against stored uppercase: the reported failure.
    assert.deepEqual(ids(await service.listPosProducts({ barcode: 'abc-123-456' }, ACTOR)), ['1'], 'lowercase typed dashed barcode resolves against stored uppercase');
    // Scanned uppercase against stored lowercase (supplier label vs stored value).
    assert.deepEqual(ids(await service.listPosProducts({ barcode: 'DEF-789-012' }, ACTOR)), ['2'], 'uppercase scanned dashed barcode resolves against stored lowercase');
    // Plain digits-only control.
    assert.deepEqual(ids(await service.listPosProducts({ barcode: '6221234567890' }, ACTOR)), ['3'], 'plain numeric barcode still resolves');
    // Dashed SKU fallback is case-insensitive too (fashion SKU BLACK-XL-42).
    assert.deepEqual(ids(await service.listPosProducts({ barcode: 'black-xl-42' }, ACTOR)), ['4'], 'lowercase dashed SKU resolves against stored uppercase SKU');
    // Dashed unit barcode, typed lowercase.
    const unitRes = await service.listPosProducts({ barcode: 'box-abc-9' }, ACTOR);
    assert.deepEqual(ids(unitRes), ['5'], 'lowercase dashed unit barcode resolves');
    assert.equal((unitRes.products as any[])[0].matchedUnit?.barcode, 'BOX-ABC-9', 'unit match carries the stored barcode');
    // The other tenant's identical dashed barcode must never leak across tenants.
    assert.equal(ids(await service.listPosProducts({ barcode: 'ABC-123-456' }, ACTOR)).includes('6'), false, 'other tenant row stays isolated');
    // The text-search leg still finds the dashed product (no regression).
    assert.deepEqual(ids(await service.listPosProducts({ q: 'ABC-123-456' }, ACTOR)), ['1'], 'dashed q search still returns the product');

    console.log('pos-barcode-dash backend checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
