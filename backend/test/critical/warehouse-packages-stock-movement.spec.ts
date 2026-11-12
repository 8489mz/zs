import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { WarehousePackagesService } from '../../src/modules/inventory/services/warehouse-packages.service';
import { reserveLocationStock } from '../../src/common/utils/location-stock-ledger';

/*
New file: backend/test/critical/warehouse-packages-stock-movement.spec.ts
Pins warehouse packages to the canonical stock ledger
(INV-WAREHOUSE-PACKAGE-STOCK-MOVEMENT).

THE GAP: createPackage inserted package items with no availability
check, no reservation and no ledger call, and unpack deleted the
item rows and detached child packages with no stock effect at all.
The same 10 units could therefore be sealed in several packages
and sold on top of that — sealed stock stayed fully sellable, and
unpacking silently dropped the only record that the stock had ever
been sealed.

THE RULE:
- Pack is a RESERVATION through the canonical ledger
  (reserveLocationStock, same call sales orders use). On-hand
  quantities do not move and no journal is posted — sealing is a
  reservation, not a physical count — but reserved_qty rises at the
  package location and globally, so the sealed units are no longer
  sellable and a second pack beyond availability is refused by the
  ledger's own availability check.
- Unpack is a RELEASE through the same ledger
  (releaseLocationStock), in the same transaction as the item-row
  write, at the package's own location — the location the pack
  reserved at. Each item row releases exactly once: unpack_all
  releases only the unpacked package's DIRECT items, remove_item
  releases its item (or only the partial quantity, shrinking the
  row), and detaching a child package releases nothing — the child
  stays sealed and keeps its own reservation until it is unpacked.
- A child package reserves its OWN items only. Stock already sealed
  in the parent is never re-reserved, so a nested pack cannot
  double-count the same units.
- Quantities are validated (finite, > 0, at most 3dp) before any
  write. A release against a package packed before this fix (no
  reservation on the books) clamps at zero and never drives
  reserved_qty negative.

WHAT THIS PINS, driving the REAL WarehousePackagesService on PGlite
(the service runs everything on the transaction handle, so the
direct service drive works — the PGlite single-connection hang
only bites when a method reads the pool handle inside its own
open transaction, which this fix avoids):
- Case 1: pack 10 of 10 available -> global reserved 10, location
  reserved 10, on-hand still 10 / 10, available 0; a sale-style
  reserve of 1 more unit is refused, so the sealed qty is not
  sellable.
- Case 2: packing the same 10 again is refused by the ledger, no
  second package row is created, and reserved stays 10.
- Case 3: unpack_all returns the 10 exactly once — reserved 0,
  available 10 — and a second unpack_all is a no-op (reserved
  stays 0, no double release).
- Case 4: nested pack does not double-count — an empty pallet
  holding a child box of 10 reserves 10 once; unpacking the pallet
  leaves reserved at 10 with the child still sealed and its items
  intact; unpacking the child then returns the 10. Detaching a
  child (remove_child_package) releases nothing.
- Case 5: partial unpack returns only the unpacked qty — remove
  4 of 10 leaves item 6 and reserved 6; removing 7 of the
  remaining 6 is refused; removing the rest returns reserved to 0
  and deletes the row.
- Case 6: 3dp pack (10.125) reserves 10.125 exactly; a 4dp pack
  (1.1234) is refused with no package created.
- Case 7: unpacking a package packed before this fix (item rows
  with no reservation on the books) succeeds and never drives
  reserved_qty below zero.

NOT TESTED HERE: live Postgres, true two-terminal concurrency
(PGlite is a single connection), and the shipped/consumed status
transitions — updateStatus still moves no stock, so a shipped
package keeps its reservation until that lifecycle is decided
(see the package report); the live-Postgres acceptance drive
stays an open item.
*/

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: ['inventory'] } as unknown as AuthContext;

async function makeDb(): Promise<{ pg: InstanceType<typeof PGlite>; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
    INSERT INTO stock_locations VALUES (1, 't1', 1, 'Main Store', 'MAIN', true, 'branch_stock');
    CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, name_en text, barcode text, style_code text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, retail_price numeric DEFAULT 0, is_active boolean DEFAULT true, track_serials boolean DEFAULT false, primary_bin_id bigint, bin_location text, default_location_id bigint, updated_at timestamptz);
    CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text, account_id text, product_id bigint, branch_id bigint, location_id bigint, qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, updated_at timestamptz);
    CREATE TABLE warehouse_packages (id varchar(128) PRIMARY KEY, tenant_id varchar(64) NOT NULL, package_number varchar(64) NOT NULL, package_type varchar(32) NOT NULL DEFAULT 'box', parent_package_id varchar(128), warehouse_id integer, location_id integer, status varchar(32) NOT NULL DEFAULT 'sealed', gross_weight_kg numeric(12, 3), net_weight_kg numeric(12, 3), notes text, created_by varchar(64), created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE warehouse_package_items (id varchar(128) PRIMARY KEY, tenant_id varchar(64) NOT NULL, package_id varchar(128) NOT NULL REFERENCES warehouse_packages(id) ON DELETE CASCADE, product_id integer NOT NULL, quantity numeric(14, 4) NOT NULL, unit_name varchar(32) DEFAULT 'قطعة', batch_number varchar(64), serial_numbers jsonb, created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  return { pg, db };
}

async function seedProduct(db: Kysely<Database>, id: number, qty: number): Promise<void> {
  await sql`INSERT INTO products (id, tenant_id, account_id, name, stock_qty, reserved_qty, cost_price, retail_price, is_active) VALUES (${id}, 't1', 'a1', ${`Product ${id}`}, ${qty}, 0, 10, 0, true)`.execute(db);
  await sql`INSERT INTO product_location_stock (tenant_id, account_id, product_id, branch_id, location_id, qty, reserved_qty) VALUES ('t1', 'a1', ${id}, 1, 1, ${qty}, 0)`.execute(db);
}

type Balances = { stock: number; reserved: number; locQty: number; locReserved: number };

async function balances(db: Kysely<Database>, productId: number): Promise<Balances> {
  const prod = await sql<{ stock_qty: string; reserved_qty: string }>`SELECT stock_qty, reserved_qty FROM products WHERE id = ${productId}`.execute(db);
  const loc = await sql<{ qty: string; reserved_qty: string }>`SELECT qty, reserved_qty FROM product_location_stock WHERE product_id = ${productId} AND location_id = 1`.execute(db);
  return {
    stock: Number(prod.rows[0].stock_qty),
    reserved: Number(prod.rows[0].reserved_qty),
    locQty: loc.rows.length ? Number(loc.rows[0].qty) : 0,
    locReserved: loc.rows.length ? Number(loc.rows[0].reserved_qty) : 0,
  };
}

async function packageCount(db: Kysely<Database>): Promise<number> {
  const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM warehouse_packages`.execute(db);
  return Number(rows.rows[0].n);
}

async function packageItems(db: Kysely<Database>, packageId: string): Promise<Array<{ id: string; product_id: number; quantity: number }>> {
  const rows = await sql<{ id: string; product_id: string; quantity: string }>`SELECT id, product_id, quantity FROM warehouse_package_items WHERE package_id = ${packageId} ORDER BY id`.execute(db);
  return rows.rows.map((r) => ({ id: r.id, product_id: Number(r.product_id), quantity: Number(r.quantity) }));
}

async function packageRow(db: Kysely<Database>, packageId: string): Promise<{ status: string; parent_package_id: string | null }> {
  const rows = await sql<{ status: string; parent_package_id: string | null }>`SELECT status, parent_package_id FROM warehouse_packages WHERE id = ${packageId}`.execute(db);
  return { status: rows.rows[0].status, parent_package_id: rows.rows[0].parent_package_id };
}

async function main(): Promise<void> {
  const { db } = await makeDb();
  const service = new WarehousePackagesService(db as any);
  try {
    // Case 1: pack 10 of 10 — reserved rises, on-hand untouched, sealed qty not sellable.
    await seedProduct(db, 1, 10);
    const pack1 = await service.createPackage(AUTH, { packageType: 'box', locationId: 1, items: [{ productId: 1, quantity: 10 }] } as any);
    assert.equal(pack1.success, true);
    let bal = await balances(db, 1);
    assert.deepEqual(bal, { stock: 10, reserved: 10, locQty: 10, locReserved: 10 });
    assert.equal(bal.stock - bal.reserved, 0);
    assert.equal((await packageRow(db, pack1.packageId)).status, 'sealed');
    const pack1Items = await packageItems(db, pack1.packageId);
    assert.equal(pack1Items.length, 1);
    assert.equal(pack1Items[0].product_id, 1);
    assert.equal(pack1Items[0].quantity, 10);
    // A sale-style reserve of 1 more unit is refused: the sealed qty is not sellable.
    await assert.rejects(
      reserveLocationStock(db as any, { tenantId: 't1', accountId: 'a1', branchId: 1, locationId: 1, items: [{ productId: 1, qty: 1 }] }),
      /المتاح/,
    );
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 10, locQty: 10, locReserved: 10 });

    // Case 2: packing the same 10 again is refused, with no second package row.
    await assert.rejects(
      service.createPackage(AUTH, { packageType: 'box', locationId: 1, items: [{ productId: 1, quantity: 10 }] } as any),
      /المتاح/,
    );
    assert.equal(await packageCount(db), 1);
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 10, locQty: 10, locReserved: 10 });

    // Case 3: unpack returns it exactly once; a second unpack is a no-op.
    const unpacked = await service.unpack(AUTH, pack1.packageId, { action: 'unpack_all' } as any);
    assert.equal(unpacked.success, true);
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 0, locQty: 10, locReserved: 0 });
    assert.deepEqual(await packageItems(db, pack1.packageId), []);
    assert.equal((await packageRow(db, pack1.packageId)).status, 'opened');
    await service.unpack(AUTH, pack1.packageId, { action: 'unpack_all' } as any);
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 0, locQty: 10, locReserved: 0 });

    // Case 4: nested pack does not double-count.
    const pallet = await service.createPackage(AUTH, { packageType: 'pallet', locationId: 1 } as any);
    const child = await service.createPackage(AUTH, { packageType: 'box', parentPackageId: pallet.packageId, items: [{ productId: 1, quantity: 10 }] } as any);
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 10, locQty: 10, locReserved: 10 });
    assert.equal((await packageRow(db, child.packageId)).parent_package_id, pallet.packageId);
    // Detaching the child releases nothing — it stays sealed.
    await service.unpack(AUTH, pallet.packageId, { action: 'remove_child_package', targetChildPackageId: child.packageId } as any);
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 10, locQty: 10, locReserved: 10 });
    assert.equal((await packageRow(db, child.packageId)).parent_package_id, null);
    assert.equal((await packageRow(db, child.packageId)).status, 'sealed');
    assert.equal((await packageItems(db, child.packageId)).length, 1);
    // Re-attach the child, then unpack the pallet: the child's reservation survives.
    await sql`UPDATE warehouse_packages SET parent_package_id = ${pallet.packageId} WHERE id = ${child.packageId}`.execute(db);
    await service.unpack(AUTH, pallet.packageId, { action: 'unpack_all' } as any);
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 10, locQty: 10, locReserved: 10 });
    assert.equal((await packageRow(db, child.packageId)).parent_package_id, null);
    assert.equal((await packageRow(db, child.packageId)).status, 'sealed');
    assert.equal((await packageItems(db, child.packageId)).length, 1);
    // Unpacking the child returns the 10 exactly once.
    await service.unpack(AUTH, child.packageId, { action: 'unpack_all' } as any);
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 0, locQty: 10, locReserved: 0 });

    // Case 5: partial unpack returns only the unpacked qty.
    const pack5 = await service.createPackage(AUTH, { packageType: 'box', locationId: 1, items: [{ productId: 1, quantity: 10 }] } as any);
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 10, locQty: 10, locReserved: 10 });
    const item5 = (await packageItems(db, pack5.packageId))[0];
    await service.unpack(AUTH, pack5.packageId, { action: 'remove_item', targetPackageItemId: item5.id, quantity: 4 } as any);
    assert.deepEqual(await packageItems(db, pack5.packageId), [{ id: item5.id, product_id: 1, quantity: 6 }]);
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 6, locQty: 10, locReserved: 6 });
    await assert.rejects(
      service.unpack(AUTH, pack5.packageId, { action: 'remove_item', targetPackageItemId: item5.id, quantity: 7 } as any),
      /exceeds the packaged quantity/,
    );
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 6, locQty: 10, locReserved: 6 });
    await service.unpack(AUTH, pack5.packageId, { action: 'remove_item', targetPackageItemId: item5.id } as any);
    assert.deepEqual(await packageItems(db, pack5.packageId), []);
    assert.deepEqual(await balances(db, 1), { stock: 10, reserved: 0, locQty: 10, locReserved: 0 });
    await assert.rejects(
      service.unpack(AUTH, pack5.packageId, { action: 'remove_item', targetPackageItemId: item5.id } as any),
      /Package item not found/,
    );

    // Case 6: 3dp pack reserves exactly; a 4dp pack is refused with no package created.
    await seedProduct(db, 2, 10.125);
    const pack6 = await service.createPackage(AUTH, { packageType: 'box', locationId: 1, items: [{ productId: 2, quantity: 10.125 }] } as any);
    assert.deepEqual(await balances(db, 2), { stock: 10.125, reserved: 10.125, locQty: 10.125, locReserved: 10.125 });
    const countBefore = await packageCount(db);
    await assert.rejects(
      service.createPackage(AUTH, { packageType: 'box', locationId: 1, items: [{ productId: 2, quantity: 1.1234 }] } as any),
      /three decimal places/,
    );
    assert.equal(await packageCount(db), countBefore);
    await service.unpack(AUTH, pack6.packageId, { action: 'unpack_all' } as any);
    assert.deepEqual(await balances(db, 2), { stock: 10.125, reserved: 0, locQty: 10.125, locReserved: 0 });

    // Case 7: unpacking a package packed before this fix (no reservation
    // on the books) succeeds and never drives reserved_qty below zero.
    await seedProduct(db, 3, 5);
    await sql`INSERT INTO warehouse_packages (id, tenant_id, package_number, package_type, location_id, status, created_by) VALUES ('pkg_legacy', 't1', 'BOX-LEGACY-0001', 'box', 1, 'sealed', '1')`.execute(db);
    await sql`INSERT INTO warehouse_package_items (id, tenant_id, package_id, product_id, quantity) VALUES ('pkgi_legacy', 't1', 'pkg_legacy', 3, 5)`.execute(db);
    await service.unpack(AUTH, 'pkg_legacy', { action: 'unpack_all' } as any);
    assert.deepEqual(await balances(db, 3), { stock: 5, reserved: 0, locQty: 5, locReserved: 0 });

    console.log('warehouse packages stock movement checks passed');
  } finally {
    await db.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
