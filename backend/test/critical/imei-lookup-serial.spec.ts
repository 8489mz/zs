/*
New file: backend/test/critical/imei-lookup-serial.spec.ts
Pins LF-P4 (mobiles/maintenance live-fix batch, live-proven 2026-11-08
on test10k): the IMEI lookup header showed no branch/warehouse, no
price and warranty always "—" for both test devices (maintenance IMEI
...011, trade-in IMEI ...022), although the page itself rendered.

ROOT CAUSE (verified in code at db4c1cba):
- The backend lookupSerial selected productRetailPrice /
  productWholesalePrice / costPrice, but returned them under the key
  `serial`, while the only frontend consumer
  (frontend/src/features/products/api/product-serials.api.ts) reads
  `res?.item` — so the lookup item NEVER reached the page: serialItem
  was always null, the header fell back to "متاح بالسجل العام", and no
  price, branch or warranty could ever render. Pure wire-shape mismatch.
- Branch/location: a trade-in intake with no branch/location fields
  (form has none; DTO/API accept them as optional) inserts NULL
  branch_id/location_id on the transaction, the stock movement AND the
  product_serials row, and applyStockDelta with a null location lands
  the +1 in the UNASSIGNED balance (a product_location_stock row with
  NULL branch/location) — so no stock-location fallback can ever
  recover a real branch/location for such a device, and no canonical
  intake default is stamped either. The honest read is therefore
  empty branch/location, rendered by the page as "not recorded".
- Warranty: no writer ever sets warranty_end_date on product_serials,
  so it reads null. The ticket repair warranty (M2 P5) lives on
  maintenance_tickets.warranty_end; the page reads it from the tickets
  it already loads (frontend-side, no backend change here).

WHAT THIS PINS, driving the REAL ProductSerialsService.lookupSerial
on PGlite (plain select only, so no PGlite transaction hang):
- The response shape the frontend client actually reads: the key is
  `item` (never `serial`); found:false carries item:null.
- A trade-in-like serial row (NULL branch/location) still returns
  the product retail/wholesale prices and the row cost_price, with
  honestly empty branch/location — no invented location.
- A row WITH branch/location returns their names.
- found:false for an unregistered serial; blank input; case-insensitive
  serial_number and imei_2 matches; tenant scoping (another tenant's
  row never leaks).
- warranty_end_date passes through when set, null otherwise.

NOT pinned here: the frontend header rendering (covered by
frontend/src/features/products/pages/ImeiHistoryPage.spec.tsx) and
the trade-in intake gap itself (named follow-up LF-P4-FU1: add real
branch/location fields to the trade-in intake form; no default is
stamped from the actor's default branch because that branch is not
proven to be where the device was physically received).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { ProductSerialsService } from '../../src/modules/catalog/services/product-serials.service';

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });

  try {
    await pg.exec(`
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        name VARCHAR(255) NOT NULL,
        barcode VARCHAR(255),
        retail_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
        wholesale_price NUMERIC(15, 2) NOT NULL DEFAULT 0
      );
      CREATE TABLE branches (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        name VARCHAR(255) NOT NULL
      );
      CREATE TABLE stock_locations (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        name VARCHAR(255) NOT NULL,
        branch_id INTEGER
      );
      CREATE TABLE product_serials (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        product_id INTEGER NOT NULL,
        serial_number VARCHAR(255) NOT NULL,
        imei_2 VARCHAR(255),
        status VARCHAR(50) NOT NULL,
        branch_id INTEGER,
        location_id INTEGER,
        cost_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
        warranty_end_date TIMESTAMPTZ,
        notes TEXT,
        purchase_id INTEGER,
        purchase_item_id INTEGER,
        sale_id INTEGER,
        sale_item_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ
      );
    `);

    await pg.exec(`
      INSERT INTO products (id, tenant_id, account_id, name, barcode, retail_price, wholesale_price)
        VALUES (1, 't1', 'a1', 'Used Phone (مستعمل)', 'DEV-6789022-1', 150, 120);
      INSERT INTO branches (id, tenant_id, account_id, name)
        VALUES (1, 't1', 'a1', 'Main Branch');
      INSERT INTO stock_locations (id, tenant_id, account_id, name, branch_id)
        VALUES (1, 't1', 'a1', 'Main Warehouse', 1);
      INSERT INTO product_serials (tenant_id, account_id, product_id, serial_number, imei_2, status, branch_id, location_id, cost_price, warranty_end_date, notes) VALUES
        ('t1', 'a1', 1, '869123456789022', NULL, 'in_stock', NULL, NULL, 10, NULL, 'trade-in TRD-261108-0001'),
        ('t1', 'a1', 1, '869123456789033', NULL, 'in_stock', 1, 1, 20, '2026-12-08T10:00:00.000Z', NULL),
        ('t1', 'a1', 1, '869123456789044', 'IMEI-2-044', 'sold', 1, NULL, 30, NULL, NULL),
        ('t2', 'a1', 1, '869123456789055', NULL, 'in_stock', NULL, NULL, 10, NULL, NULL);
    `);

    const service = new ProductSerialsService(db as any, null as any);
    const auth = { tenantId: 't1', accountId: 'a1' } as any;

    // Trade-in-like row: NULL branch/location, but the prices ARE there.
    // The wire shape is what the frontend client reads: `item`, not `serial`.
    const tradeIn = await service.lookupSerial('869123456789022', auth);
    assert.equal(tradeIn.found, true, 'trade-in serial row is found');
    assert.ok('item' in tradeIn, 'lookup returns the `item` key the frontend client reads');
    assert.ok(!('serial' in tradeIn), 'lookup must not return the stale `serial` key nothing reads');
    const tradeInItem = (tradeIn as any).item;
    assert.ok(tradeInItem, 'found lookup carries an item');
    assert.equal(tradeInItem.productRetailPrice, 150, 'retail price reaches the header');
    assert.equal(tradeInItem.productWholesalePrice, 120, 'wholesale price reaches the header');
    assert.equal(tradeInItem.costPrice, 10, 'row cost price reaches the header');
    assert.equal(tradeInItem.branchId, null, 'trade-in row genuinely has no branch');
    assert.equal(tradeInItem.locationId, null, 'trade-in row genuinely has no location');
    assert.equal(tradeInItem.branchName, '', 'no branch is honestly empty, never invented');
    assert.equal(tradeInItem.locationName, '', 'no location is honestly empty, never invented');
    assert.equal(tradeInItem.warrantyEndDate, null, 'no writer sets serial warranty_end_date');

    // Row WITH branch/location returns their names.
    const stocked = await service.lookupSerial('869123456789033', auth);
    assert.equal(stocked.found, true);
    assert.equal((stocked as any).item.branchName, 'Main Branch');
    assert.equal((stocked as any).item.locationName, 'Main Warehouse');
    assert.equal(
      new Date((stocked as any).item.warrantyEndDate as any).getTime(),
      new Date('2026-12-08T10:00:00.000Z').getTime(),
      'warranty_end_date passes through when set',
    );

    // Case-insensitive serial_number and imei_2 matches.
    const byImei2 = await service.lookupSerial('imei-2-044', auth);
    assert.equal(byImei2.found, true, 'imei_2 match is case-insensitive');
    assert.equal((byImei2 as any).item.serialNumber, '869123456789044');

    // Unregistered serial: found:false, item null — the page must never
    // label such a device as available in stock.
    const missing = await service.lookupSerial('869123456789011', auth);
    assert.equal(missing.found, false, 'maintenance-only device has no serial row');
    assert.equal((missing as any).item, null);
    assert.ok(!('serial' in missing), 'not-found shape also uses `item`');

    // Blank input and tenant scoping.
    assert.equal((await service.lookupSerial('', auth)).found, false);
    assert.equal((await service.lookupSerial('   ', auth)).found, false);
    const otherTenant = await service.lookupSerial('869123456789055', auth);
    assert.equal(otherTenant.found, false, 'another tenant row never leaks in');

    console.log('imei-lookup-serial.spec.ts passed');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
