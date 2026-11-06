/* Product name fallback (INV-PRODUCT-NAME-FALLBACK, decision (أ)): no
 * write-time copy — an English-only product is stored with an empty
 * Arabic name and the English name in its own field, and reopening the
 * edit form (read the stored row, submit it back) must not copy the
 * English name into the Arabic field either. Drives the REAL
 * CatalogProductService.createProduct/updateProduct on PGlite.
 *
 * NOTE: create/update end with listProducts(), whose list pipeline needs
 * tables outside this fix; if it throws, the spec catches it (asserting
 * it is never PRODUCT_NAME_REQUIRED) and still proves the stored row,
 * because the write transaction already committed before the list runs.
 */
import assert from 'node:assert';
import { Kysely, sql } from 'kysely';
import { PGlite } from '@electric-sql/pglite';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { CatalogProductService } from '../../src/modules/catalog/services/catalog-product.service';
import { AppError } from '../../src/common/errors/app-error';

const TENANT = 't1';
const ACTOR: any = {
  userId: 1,
  sessionId: 's1',
  username: 'admin',
  role: 'admin',
  permissions: ['*'],
  tenantId: TENANT,
  accountId: 'a1',
};

async function main() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });

  await sql`CREATE TABLE products (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, name TEXT NOT NULL DEFAULT '', name_en TEXT, barcode TEXT, sku TEXT, item_type TEXT NOT NULL DEFAULT 'product', item_kind TEXT NOT NULL DEFAULT 'standard', style_code TEXT, color TEXT, size TEXT, bin_location TEXT, track_serials BOOLEAN NOT NULL DEFAULT false, category_id INTEGER, supplier_id INTEGER, cost_price NUMERIC(14,2) NOT NULL DEFAULT 0, retail_price NUMERIC(14,2) NOT NULL DEFAULT 0, wholesale_price NUMERIC(14,2) NOT NULL DEFAULT 0, credit_price NUMERIC(14,2), consumer_price NUMERIC(14,2), min_selling_price NUMERIC(14,2), stock_qty NUMERIC(14,3) NOT NULL DEFAULT 0, min_stock_qty NUMERIC(14,3) NOT NULL DEFAULT 0, default_location_id INTEGER, notes TEXT, metadata JSONB, calories NUMERIC(14,2), allergens JSONB, is_spicy BOOLEAN NOT NULL DEFAULT false, is_vegetarian BOOLEAN NOT NULL DEFAULT false, is_gluten_free BOOLEAN NOT NULL DEFAULT false, is_active BOOLEAN NOT NULL DEFAULT true, catalog_updated_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`.execute(db);
  await sql`CREATE TABLE product_units (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER NOT NULL, name TEXT NOT NULL, multiplier NUMERIC(14,6) NOT NULL DEFAULT 1, barcode TEXT, is_base_unit BOOLEAN NOT NULL DEFAULT false, is_sale_unit_default BOOLEAN NOT NULL DEFAULT false, is_purchase_unit_default BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(db);
  await sql`CREATE TABLE product_offers (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER NOT NULL)`.execute(db);
  await sql`CREATE TABLE product_customer_prices (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, account_id TEXT, product_id INTEGER NOT NULL)`.execute(db);

  const auditStub = { log: async () => undefined };
  const inventoryScopeStub = { assertLocationScope: async () => undefined };
  const service = new CatalogProductService(db as never, auditStub as never, inventoryScopeStub as never);

  const readByNameEn = async (nameEn: string) =>
    db.selectFrom('products').selectAll().where('name_en', '=', nameEn).executeTakeFirst();

  // 1. Create English-only: stored Arabic stays empty, English in place.
  let createErr: any = null;
  try {
    await service.createProduct({ name: '', nameEn: 'Bluetooth Headphones' } as any, ACTOR);
  } catch (err: any) {
    createErr = err;
  }
  assert.ok(!createErr || createErr?.code !== 'PRODUCT_NAME_REQUIRED', `English-only create must not hit the name guard, got: ${createErr?.code || createErr?.message}`);
  const created = await readByNameEn('Bluetooth Headphones');
  assert.ok(created, 'English-only product must be stored');
  assert.ok(!created.name, `stored Arabic name must stay empty, got: ${JSON.stringify(created.name)}`);
  assert.equal(created.name_en, 'Bluetooth Headphones');
  const createdId = Number(created.id);

  // 2. Create with neither name: the guard still fires.
  await assert.rejects(
    service.createProduct({ name: '', nameEn: '' } as any, ACTOR),
    (err: any) => err instanceof AppError && err.code === 'PRODUCT_NAME_REQUIRED',
  );

  // 3. Create Arabic-only: Arabic stored, no English invented.
  let arabicErr: any = null;
  try {
    await service.createProduct({ name: 'سماعات بلوتوث', nameEn: '' } as any, ACTOR);
  } catch (err: any) {
    arabicErr = err;
  }
  assert.ok(!arabicErr || arabicErr?.code !== 'PRODUCT_NAME_REQUIRED', `Arabic-only create must not hit the name guard, got: ${arabicErr?.code || arabicErr?.message}`);
  const arabicRow = await db.selectFrom('products').selectAll().where('name', '=', 'سماعات بلوتوث').executeTakeFirst();
  assert.ok(arabicRow, 'Arabic-only product must be stored');
  assert.equal(arabicRow.name_en, null);

  // 4. Reopen-edit round trip: submit the stored values back — the copy
  // must not return (Arabic stays empty, English stays in place).
  let updateErr: any = null;
  try {
    await service.updateProduct(createdId, { name: created.name, nameEn: created.name_en } as any, ACTOR);
  } catch (err: any) {
    updateErr = err;
  }
  assert.ok(!updateErr || updateErr?.code !== 'PRODUCT_NAME_REQUIRED', `reopen-edit update must not hit the name guard, got: ${updateErr?.code || updateErr?.message}`);
  const reopened = await db.selectFrom('products').selectAll().where('id', '=', createdId).executeTakeFirstOrThrow();
  assert.ok(!reopened.name, `reopened Arabic name must stay empty, got: ${JSON.stringify(reopened.name)}`);
  assert.equal(reopened.name_en, 'Bluetooth Headphones');

  // 5. Update with neither name: the guard still fires.
  await assert.rejects(
    service.updateProduct(createdId, { name: '', nameEn: '' } as any, ACTOR),
    (err: any) => err instanceof AppError && err.code === 'PRODUCT_NAME_REQUIRED',
  );

  // 6. The shared normalizer itself (used by both create and update):
  // no copy in either direction.
  const normalize = (service as any).normalizeProductPayload.bind(service);
  const englishOnly = normalize({ name: '', nameEn: 'Bluetooth Headphones' });
  assert.equal(englishOnly.name, '');
  assert.equal(englishOnly.nameEn, 'Bluetooth Headphones');
  const both = normalize({ name: 'سماعات', nameEn: 'Headphones' });
  assert.equal(both.name, 'سماعات');
  assert.equal(both.nameEn, 'Headphones');

  await db.destroy();
  console.log('product-name-fallback: PASS (6 cases)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
