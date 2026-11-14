/*
New file: backend/test/critical/sales-order-warehouse-selection.spec.ts
Pins INV-SALES-ORDER-WAREHOUSE-SELECTION (Import Batch I3, D2).

THE DEFECT (live trial phase 2, SO-261108-0008): the 10 test units sat in
"مخزن اختبار تحويل" while approval validated stock only in the branch's
default selling warehouse ("مخزن البيع الأساسي: رصيد الفرع الرئيسي") and
failed "عفواً، الرصيد المتاح من الصنف ... في هذا المخزن هو 0 فقط
(المطلوب 10)." — while the order line itself showed "10 متاح".
Root cause, grounded: sales_orders.warehouse_location_id EXISTS
(migration 0199, van pre-sales already writes it) but
sales-orders.service.ts NEVER read or wrote it — createOrder,
confirmAndReserve, cancelOrder and deleteOrder all resolved the
location solely from branches.default_stock_location_id, and the order
form had no warehouse selector at all. The line "available" badge read
global p.stock, a different warehouse than the approval check.

THE FIX: the order carries its warehouse (warehouse_location_id,
default = the branch's default selling warehouse); create/confirm
validate and reserve in the SELECTED warehouse; cancel/delete release
from that same warehouse; one shared availability read
(getLocationAvailability, same arithmetic as reserveLocationStock)
backs both the approval check and the line display, so display and
validation can never disagree about the warehouse again.

WHAT THIS PINS, driving the REAL SalesOrdersService on PGlite
(fixture mirrors the trial: product global 15 = 5 in the default
warehouse + 10 in the transfer warehouse; order 10 x 120 = 1,200):
1. Availability read: location 20 -> 10, location 10 -> 5, no location
   -> global 15. The display number and the validation number come
   from the same computation.
2. createOrder with warehouseLocationId 20 approves and reserves
   exactly there (location 20 reserved 10, location 10 reserved 0),
   and the order row stores warehouse_location_id 20.
3. getOrderById for that order shows available_qty 0 — the ORDER
   warehouse's availability (10 - 10 reserved), not the global 5.
4. createOrder with warehouseLocationId 10 for qty 10 fails naming
   the 5 available in that warehouse (INSUFFICIENT_LOCATION_STOCK),
   and no order row is created (transaction rolled back).
5. createOrder with NO warehouse falls back to the branch default
   (location 10) and fails the same way — the old behaviour, kept.
6. Draft (autoReserve false) with warehouse 20 creates unreserved,
   then confirmAndReserve reserves in warehouse 20.
7. cancelOrder releases from the SELECTED warehouse (location 20
   reserved back to 0), never from the branch default.
8. An unknown or inactive warehouse is rejected naming the warehouse.
9. After a reservation the availability read drops in that warehouse
   only (location 20 -> 0, location 10 stays 5): display tracks the
   reservation in the same warehouse validation uses.
10. convertToSale releases from the ORDER warehouse (20): the sale
    payload carries locationId 20 and the conversionRelease carries
    locationId 20, so the reservation is released and the sale
    deducted in the warehouse the order reserved in — never the
    branch default. The order becomes converted with sale_id 501.
    Legacy orders with no warehouse still fall back to the branch
    default (pinned by the D3 convert spec, locationId 10).

Deliberately NOT driven here: the frontend selector (covered by
the frontend form spec).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SalesOrdersService } from '../../src/modules/sales/services/sales-orders.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;

async function locationReserved(db: Kysely<Database>, locationId: number, productId: number): Promise<number> {
  const row = await db.selectFrom('product_location_stock').select(sql<number>`COALESCE(reserved_qty, 0)`.as('reserved_qty')).where('product_id', '=', productId).where('location_id', '=', locationId).executeTakeFirst();
  return row ? Number(row.reserved_qty) : 0;
}

async function globalReserved(db: Kysely<Database>, productId: number): Promise<number> {
  const row = await db.selectFrom('products').select(sql<number>`COALESCE(reserved_qty, 0)`.as('reserved_qty')).where('id', '=', productId).executeTakeFirstOrThrow();
  return Number(row.reserved_qty);
}

async function orderCount(db: Kysely<Database>): Promise<number> {
  const row = await db.selectFrom('sales_orders').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
  return Number(row.n);
}

function createDto(productId: number, qty: number, extra: Record<string, unknown> = {}) {
  return {
    customerName: 'عميل اختبار 00001',
    subtotal: qty * 120,
    totalAmount: qty * 120,
    autoReserve: true,
    items: [{ productId, productName: 'اختبار صنف استيراد 001', quantity: qty, unitPrice: 120, total: qty * 120 }],
    ...extra,
  } as any;
}

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, code text, branch_id bigint, location_type text NOT NULL DEFAULT 'internal_warehouse', is_active boolean NOT NULL DEFAULT true);
      CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, item_type text NOT NULL DEFAULT 'product', stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, notes text, terms_conditions text, branch_id bigint, warehouse_location_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, sale_id bigint, quotation_id bigint, reservation_expires_at timestamptz, delivery_date timestamptz, created_by bigint, updated_at timestamptz NOT NULL DEFAULT NOW(), created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, sales_order_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, reserved_quantity numeric NOT NULL DEFAULT 0, delivered_quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL, operation_type text NOT NULL, status text NOT NULL, request_hash text NOT NULL, document_id text, response_payload text, error_code text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), completed_at timestamptz);
    `);

    await db.insertInto('branches').values({ id: 1, tenant_id: 't1', account_id: 'a1', default_stock_location_id: 10 } as any).execute();
    await db.insertInto('stock_locations').values([
      { id: 10, tenant_id: 't1', account_id: 'a1', name: 'مخزن البيع الأساسي', branch_id: 1, location_type: 'branch_stock', is_active: true },
      { id: 20, tenant_id: 't1', account_id: 'a1', name: 'مخزن اختبار تحويل', branch_id: 1, location_type: 'internal_warehouse', is_active: true },
      { id: 30, tenant_id: 't1', account_id: 'a1', name: 'مخزن موقوف', branch_id: 1, location_type: 'internal_warehouse', is_active: false },
    ] as any).execute();
    // Trial shape: global 15 = 5 in the default warehouse + 10 in the transfer warehouse.
    for (const productId of [1, 2, 3]) {
      await db.insertInto('products').values({ id: productId, tenant_id: 't1', account_id: 'a1', name: 'اختبار صنف استيراد 001', stock_qty: 15, reserved_qty: 0 } as any).execute();
      await db.insertInto('product_location_stock').values([
        { tenant_id: 't1', account_id: 'a1', product_id: productId, branch_id: 1, location_id: 10, qty: 5, reserved_qty: 0 },
        { tenant_id: 't1', account_id: 'a1', product_id: productId, branch_id: 1, location_id: 20, qty: 10, reserved_qty: 0 },
      ] as any).execute();
    }

    const service = new SalesOrdersService(db as any, {} as any);

    // 1. One availability read backs display and validation alike.
    const avail20 = await service.getLocationAvailability(1, 20, AUTH);
    assert.equal(Number((avail20 as any).availableAtLocation), 10);
    assert.equal(Number((avail20 as any).globalAvailable), 15);
    assert.equal(Number((await service.getLocationAvailability(1, 10, AUTH) as any).availableAtLocation), 5);
    assert.equal(Number((await service.getLocationAvailability(1, null, AUTH) as any).availableAtLocation), 15);

    // 2. Order in the transfer warehouse approves and reserves THERE.
    const created = await service.createOrder(createDto(1, 10, { warehouseLocationId: 20 }), AUTH);
    const order1Id = Number((created as any).order.id);
    assert.equal((created as any).order.status, 'confirmed');
    const order1Row = await db.selectFrom('sales_orders').select(['status', 'warehouse_location_id']).where('id', '=', order1Id).executeTakeFirstOrThrow();
    assert.equal(Number(order1Row.warehouse_location_id), 20);
    assert.equal(await locationReserved(db, 20, 1), 10);
    assert.equal(await locationReserved(db, 10, 1), 0);
    assert.equal(await globalReserved(db, 1), 10);

    // 3. Details display reads the ORDER warehouse, not the global stock.
    const details = await service.getOrderById(order1Id, AUTH);
    assert.equal(Number((details as any).items[0].available_qty), 0);

    // 9 (checked here, while the reservation is live): display tracks the reservation in the same warehouse only.
    assert.equal(Number((await service.getLocationAvailability(1, 20, AUTH) as any).availableAtLocation), 0);
    assert.equal(Number((await service.getLocationAvailability(1, 10, AUTH) as any).availableAtLocation), 5);

    // 4. Same order against the default warehouse fails naming that warehouse's 5.
    const before = await orderCount(db);
    await assert.rejects(
      () => service.createOrder(createDto(1, 10, { warehouseLocationId: 10 }), AUTH),
      (err: any) => /5 فقط/.test(String(err?.message)) && /المطلوب 10/.test(String(err?.message)),
    );
    assert.equal(await orderCount(db), before);

    // 5. No warehouse at all falls back to the branch default and fails the same way.
    await assert.rejects(
      () => service.createOrder(createDto(1, 10), AUTH),
      (err: any) => /5 فقط/.test(String(err?.message)),
    );
    assert.equal(await orderCount(db), before);

    // 6. Draft with warehouse 20 creates unreserved, then confirms into warehouse 20.
    const draft = await service.createOrder(createDto(2, 4, { warehouseLocationId: 20, autoReserve: false }), AUTH);
    const order2Id = Number((draft as any).order.id);
    assert.equal((draft as any).order.status, 'draft');
    assert.equal(await locationReserved(db, 20, 2), 0);
    const confirmed = await service.confirmAndReserve(order2Id, AUTH);
    assert.equal((confirmed as any).ok, true);
    assert.equal(await locationReserved(db, 20, 2), 4);
    assert.equal(await locationReserved(db, 10, 2), 0);

    // 7. Cancel releases from the SELECTED warehouse, never the default.
    const created3 = await service.createOrder(createDto(3, 4, { warehouseLocationId: 20 }), AUTH);
    const order3Id = Number((created3 as any).order.id);
    assert.equal(await locationReserved(db, 20, 3), 4);
    await service.cancelOrder(order3Id, AUTH);
    assert.equal(await locationReserved(db, 20, 3), 0);
    assert.equal(await locationReserved(db, 10, 3), 0);
    assert.equal(await globalReserved(db, 3), 0);
    assert.equal(Number((await service.getLocationAvailability(3, 20, AUTH) as any).availableAtLocation), 10);

    // 8. Unknown or inactive warehouse is rejected naming the warehouse.
    await assert.rejects(
      () => service.createOrder(createDto(2, 1, { warehouseLocationId: 999 }), AUTH),
      (err: any) => /المخزن/.test(String(err?.message)),
    );
    await assert.rejects(
      () => service.createOrder(createDto(2, 1, { warehouseLocationId: 30 }), AUTH),
      (err: any) => /المخزن/.test(String(err?.message)),
    );

    // 10. Conversion releases from the ORDER warehouse, not the branch default.
    // (Coordinator follow-through: D3 landed frontend-only, so this leg is
    // closed here — same root cause, the order's warehouse ignored.)
    let convertCalls = 0;
    let lastPayload: any = null;
    let lastRelease: any = 'not-called';
    const stubSalesWrite: any = {
      createSale: async (payload: any, _auth: any, _terms: any, conversionRelease: any) => {
        convertCalls += 1;
        lastPayload = payload;
        lastRelease = conversionRelease;
        return { sale: { id: 501 } };
      },
    };
    const convertingService = new SalesOrdersService(db as any, stubSalesWrite);
    const converted = await convertingService.convertToSale(order1Id, AUTH);
    assert.equal(Number((converted as any).saleId), 501);
    assert.equal(convertCalls, 1);
    assert.equal(Number(lastPayload.locationId), 20);
    assert.deepEqual(lastPayload.items, [{ productId: 1, qty: 10, price: 120, lineDiscount: 0, unitName: undefined }]);
    assert.deepEqual(lastRelease, { salesOrderId: order1Id, branchId: 1, locationId: 20, items: [{ productId: 1, qty: 10 }] });
    const convertedRow = await db.selectFrom('sales_orders').select(['status', 'sale_id']).where('id', '=', order1Id).executeTakeFirstOrThrow();
    assert.equal(convertedRow.status, 'converted');
    assert.equal(Number(convertedRow.sale_id), 501);

    // eslint-disable-next-line no-console
    console.log('sales order warehouse selection checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
