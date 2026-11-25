/* Scale / PLU leading-zero equivalence and style_code fallback for
 * CatalogProductService.listPosProducts({ barcode }) on PGlite.
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';

const ACTOR: any = {
  userId: 10,
  sessionId: 'session-pos-scale',
  username: 'cashier',
  role: 'cashier',
  permissions: ['sales'],
  tenantId: 'tenant-scale',
  accountId: 'account-scale',
};

async function main() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });
  try {
    await sql`CREATE TABLE products (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, name TEXT, name_en TEXT, barcode TEXT, sku TEXT, item_type TEXT, item_kind TEXT, style_code TEXT, color TEXT, size TEXT, retail_price NUMERIC(14,2) DEFAULT 0, wholesale_price NUMERIC(14,2) DEFAULT 0, credit_price NUMERIC(14,2), consumer_price NUMERIC(14,2), min_selling_price NUMERIC(14,2), stock_qty NUMERIC(14,3) DEFAULT 0, min_stock_qty NUMERIC(14,3) DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT true, category_id INTEGER, track_serials BOOLEAN NOT NULL DEFAULT false, metadata JSONB)`.execute(
      db,
    );
    await sql`CREATE TABLE manufacturing_boms (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER, is_active BOOLEAN NOT NULL DEFAULT true)`.execute(
      db,
    );
    await sql`CREATE TABLE product_serials (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER, serial_number TEXT, imei_2 TEXT, status TEXT)`.execute(
      db,
    );
    await sql`CREATE TABLE product_units (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER, name TEXT, multiplier NUMERIC(14,3) DEFAULT 1, barcode TEXT, is_base_unit BOOLEAN NOT NULL DEFAULT false, is_sale_unit_default BOOLEAN NOT NULL DEFAULT false, is_purchase_unit_default BOOLEAN NOT NULL DEFAULT false)`.execute(
      db,
    );
    await sql`CREATE TABLE product_offers (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER, offer_type TEXT, value NUMERIC(14,2), start_date DATE, end_date DATE, is_active BOOLEAN NOT NULL DEFAULT true)`.execute(
      db,
    );
    await sql`CREATE TABLE product_location_stock (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER, location_id INTEGER, branch_id INTEGER, qty NUMERIC(14,3) DEFAULT 0, reserved_qty NUMERIC(14,3) DEFAULT 0)`.execute(
      db,
    );

    await sql`INSERT INTO products (tenant_id, account_id, name, barcode, sku, style_code, item_type, item_kind, retail_price, wholesale_price, stock_qty, is_active) VALUES
      ('tenant-scale', 'account-scale', 'Unpadded Cheese PLU', '9', 'SKU-9', NULL, 'product', 'standard', 120, 100, 10, true),
      ('tenant-scale', 'account-scale', 'Padded Spice SKU', '62200012', '12', NULL, 'product', 'standard', 80, 70, 5, true),
      ('tenant-scale', 'account-scale', 'Style PLU Meat', '62200015', 'SKU-MEAT', '15', 'product', 'standard', 250, 220, 4, true),
      ('tenant-scale', 'account-scale', 'Weighted Unit Box', '', 'SKU-U21', NULL, 'product', 'standard', 50, 45, 8, true),
      ('tenant-scale', 'account-scale', 'Exact Bar Priority', '00033', 'SKU-33E', NULL, 'product', 'standard', 40, 35, 3, true),
      ('tenant-scale', 'account-scale', 'Fallback Num 33', '33', 'SKU-33F', NULL, 'product', 'standard', 40, 35, 3, true),
      ('other-tenant', 'other-account', 'Isolated Tenant Item', '9', '12', '15', 'product', 'standard', 10, 10, 1, true)`.execute(
      db,
    );

    await sql`INSERT INTO product_units (tenant_id, account_id, product_id, name, multiplier, barcode, is_base_unit, is_sale_unit_default, is_purchase_unit_default) VALUES
      ('tenant-scale', 'account-scale', 4, 'kg', 1, '21', true, true, true)`.execute(db);

    const service = new CatalogProductService(
      db as never,
      {} as never,
      { assertLocationScope: async (locationId: number) => ({ id: locationId, name: 'Main', branchId: 1 }) } as never,
    );

    const ids = (r: any) => (r.products as any[]).map((p) => String(p.id));

    // Padded scale PLU '00009' resolves unpadded barcode '9'
    assert.deepEqual(
      ids(await service.listPosProducts({ barcode: '00009' }, ACTOR)),
      ['1'],
      '00009 resolves unpadded barcode 9',
    );
    // Padded scale PLU '00012' resolves unpadded SKU '12'
    assert.deepEqual(
      ids(await service.listPosProducts({ barcode: '00012' }, ACTOR)),
      ['2'],
      '00012 resolves unpadded SKU 12',
    );
    // Padded scale PLU '00015' resolves unpadded style_code '15'
    assert.deepEqual(
      ids(await service.listPosProducts({ barcode: '00015' }, ACTOR)),
      ['3'],
      '00015 resolves unpadded style_code 15',
    );
    // Padded scale PLU '00021' resolves unpadded unit barcode '21'
    const unitRes = await service.listPosProducts({ barcode: '00021' }, ACTOR);
    assert.deepEqual(ids(unitRes), ['4'], '00021 resolves unpadded unit barcode 21');
    assert.equal((unitRes.products as any[])[0].matchedUnit?.barcode, '21', 'matchedUnit carries stored unit barcode');
    // Exact barcode wins over leading-zero fallback
    assert.deepEqual(
      ids(await service.listPosProducts({ barcode: '00033' }, ACTOR)),
      ['5'],
      'exact barcode 00033 wins over 33',
    );
    // Arabic-Indic digits normalize cleanly
    assert.deepEqual(
      ids(await service.listPosProducts({ barcode: '٠٠٠٠٩' }, ACTOR)),
      ['1'],
      'Arabic-Indic PLU resolves unpadded barcode 9',
    );
    // Other tenant stays strictly isolated
    assert.equal(
      ids(await service.listPosProducts({ barcode: '00009' }, ACTOR)).includes('7'),
      false,
      'other tenant stays isolated',
    );

    console.log('pos-weighted-barcode-lookup backend checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
