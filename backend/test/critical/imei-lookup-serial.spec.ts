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

R2-A (residual A, live-proven 2026-11-08 on deployed 4ade6e01):
after a REAL sale (Z-261108-16322, serial 869123456789022, cash
20.00, JE-00015024, movement ledger 1 -> 0, header chip
"تم البيع للعميل") the header's sale box still read
"لم يتم بيعه بعد". ROOT CAUSE (verified in code at 4ade6e01):
lookupSerial selected neither ps.sale_id nor ps.purchase_id and
joined NO sales/purchases/customers/suppliers table, so it could
never return saleDocNo / purchaseDocNo / supplierName /
customerName / customerPhone — although the frontend type already
declares them as optional and ImeiHistoryPage.tsx already reads
them (sale line: serialItem?.saleDocNo || "لم يتم بيعه بعد";
purchase line: serialItem?.purchaseDocNo || tradeins[0] waiver).
The page renders NO sale/purchase DATE from serialItem (the
"فاتورة وتاريخ" labels show only the doc number), so no date
field is added here.

WHAT R2-A PINS, on the same real service:
- A SOLD serial returns saleDocNo (the sale's doc_no), saleId, and
  the customer name/phone: the sale-row snapshot wins, the
  customers-table row is the fallback (the dual-source pattern of
  sales-query.service.ts).
- A sale with NULL doc_no still yields its canonical display number
  `Z-<sale id>` (the sales-query.service.ts fallback), never
  "لم يتم بيعه بعد" for a device that was really sold.
- A serial received via a purchase returns purchaseDocNo and
  supplierName; a purchase with no doc_no / no supplier returns
  honest nulls (the page keeps its tradeins[0] waiver fallback).
- An UNSOLD serial returns saleDocNo null (page keeps
  "لم يتم بيعه بعد") and customerName null.
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
      CREATE TABLE customers (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(255) NOT NULL
      );
      CREATE TABLE sales (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        doc_no VARCHAR(255),
        customer_id INTEGER,
        customer_name VARCHAR(255),
        customer_phone VARCHAR(255)
      );
      CREATE TABLE suppliers (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        name VARCHAR(255) NOT NULL
      );
      CREATE TABLE purchases (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        doc_no VARCHAR(255),
        supplier_id INTEGER
      );
    `);

    await pg.exec(`
      INSERT INTO products (id, tenant_id, account_id, name, barcode, retail_price, wholesale_price)
        VALUES (1, 't1', 'a1', 'Used Phone (مستعمل)', 'DEV-6789022-1', 150, 120);
      INSERT INTO branches (id, tenant_id, account_id, name)
        VALUES (1, 't1', 'a1', 'Main Branch');
      INSERT INTO stock_locations (id, tenant_id, account_id, name, branch_id)
        VALUES (1, 't1', 'a1', 'Main Warehouse', 1);
      INSERT INTO customers (id, tenant_id, account_id, name, phone)
        VALUES (1, 't1', 'a1', 'Customer Table Name', '+201000000000');
      INSERT INTO sales (id, tenant_id, account_id, doc_no, customer_id, customer_name, customer_phone) VALUES
        (1, 't1', 'a1', 'Z-261108-16322', 1, 'Sale Snapshot Name', NULL),
        (2, 't1', 'a1', NULL, NULL, 'Walk-in Buyer', '+203000000000');
      INSERT INTO suppliers (id, tenant_id, account_id, name)
        VALUES (1, 't1', 'a1', 'Test Supplier');
      INSERT INTO purchases (id, tenant_id, account_id, doc_no, supplier_id) VALUES
        (1, 't1', 'a1', 'P-261108-0001', 1),
        (2, 't1', 'a1', NULL, NULL);
      INSERT INTO product_serials (tenant_id, account_id, product_id, serial_number, imei_2, status, branch_id, location_id, cost_price, warranty_end_date, notes, purchase_id, sale_id) VALUES
        ('t1', 'a1', 1, '869123456789022', NULL, 'in_stock', NULL, NULL, 10, NULL, 'trade-in TRD-261108-0001', 1, NULL),
        ('t1', 'a1', 1, '869123456789033', NULL, 'in_stock', 1, 1, 20, '2026-12-08T10:00:00.000Z', NULL, NULL, NULL),
        ('t1', 'a1', 1, '869123456789044', 'IMEI-2-044', 'sold', 1, NULL, 30, NULL, NULL, NULL, 1),
        ('t1', 'a1', 1, '869123456789066', NULL, 'sold', 1, NULL, 30, NULL, NULL, NULL, 2),
        ('t1', 'a1', 1, '869123456789077', NULL, 'in_stock', NULL, NULL, 10, NULL, NULL, 2, NULL),
        ('t2', 'a1', 1, '869123456789055', NULL, 'in_stock', NULL, NULL, 10, NULL, NULL, NULL, NULL);
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
    // R2-A: received via a real purchase -> doc + supplier come back;
    // never sold -> sale fields stay honestly null.
    assert.equal(tradeInItem.purchaseId, '1', 'purchase link reaches the header');
    assert.equal(tradeInItem.purchaseDocNo, 'P-261108-0001', 'purchase doc number reaches the header');
    assert.equal(tradeInItem.supplierName, 'Test Supplier', 'supplier name reaches the header');
    assert.equal(tradeInItem.saleId, null, 'unsold serial has no sale');
    assert.equal(tradeInItem.saleDocNo, null, 'unsold serial keeps saleDocNo null (page shows "لم يتم بيعه بعد")');
    assert.equal(tradeInItem.customerName, null, 'unsold serial has no customer');

    // Row WITH branch/location returns their names.
    const stocked = await service.lookupSerial('869123456789033', auth);
    assert.equal(stocked.found, true);
    assert.equal((stocked as any).item.branchName, 'Main Branch');
    assert.equal((stocked as any).item.locationName, 'Main Warehouse');
    assert.equal((stocked as any).item.saleDocNo, null, 'unsold stocked serial keeps saleDocNo null');
    assert.equal((stocked as any).item.purchaseDocNo, null, 'serial with no purchase keeps purchaseDocNo null');
    assert.equal(
      new Date((stocked as any).item.warrantyEndDate as any).getTime(),
      new Date('2026-12-08T10:00:00.000Z').getTime(),
      'warranty_end_date passes through when set',
    );

    // Case-insensitive serial_number and imei_2 matches.
    const byImei2 = await service.lookupSerial('imei-2-044', auth);
    assert.equal(byImei2.found, true, 'imei_2 match is case-insensitive');
    assert.equal((byImei2 as any).item.serialNumber, '869123456789044');
    // R2-A: the SOLD serial returns the sale doc + customer. The sale-row
    // snapshot name wins over the customers-table name; the phone falls
    // back to the customers table because the snapshot phone is null.
    assert.equal((byImei2 as any).item.saleId, '1', 'sold serial carries its sale id');
    assert.equal((byImei2 as any).item.saleDocNo, 'Z-261108-16322', 'sold serial returns the sale doc number (live defect: was null)');
    assert.equal((byImei2 as any).item.customerName, 'Sale Snapshot Name', 'sale-row customer snapshot wins');
    assert.equal((byImei2 as any).item.customerPhone, '+201000000000', 'phone falls back to the customers table');
    assert.equal((byImei2 as any).item.purchaseDocNo, null, 'sold serial with no purchase keeps purchaseDocNo null');

    // R2-A: a sale with NULL doc_no still yields its canonical display
    // number Z-<sale id> (sales-query.service.ts fallback) — a really
    // sold device must never read "لم يتم بيعه بعد".
    const nullDocSale = await service.lookupSerial('869123456789066', auth);
    assert.equal(nullDocSale.found, true);
    assert.equal((nullDocSale as any).item.saleId, '2');
    assert.equal((nullDocSale as any).item.saleDocNo, 'Z-2', 'null doc_no falls back to Z-<sale id>');
    assert.equal((nullDocSale as any).item.customerName, 'Walk-in Buyer', 'walk-in sale snapshot name, no customer row');
    assert.equal((nullDocSale as any).item.customerPhone, '+203000000000');

    // R2-A: a purchase with no doc_no and no supplier returns honest
    // nulls — the page keeps its tradeins[0] waiver fallback.
    const nullDocPurchase = await service.lookupSerial('869123456789077', auth);
    assert.equal(nullDocPurchase.found, true);
    assert.equal((nullDocPurchase as any).item.purchaseId, '2');
    assert.equal((nullDocPurchase as any).item.purchaseDocNo, null, 'purchase without doc_no stays null, never invented');
    assert.equal((nullDocPurchase as any).item.supplierName, null, 'purchase without supplier stays null');
    assert.equal((nullDocPurchase as any).item.saleDocNo, null, 'unsold serial keeps saleDocNo null');

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
