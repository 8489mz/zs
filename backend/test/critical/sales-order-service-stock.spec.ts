/*
New file: backend/test/critical/sales-order-service-stock.spec.ts
Pins INV-SERVICE-STOCK-NO-STOCK-CHECK (spice trial D02), sales-order
half: a service must be sellable without stock along the whole
sales-order -> invoice journey.

THE DEFECT: convertToSale itself is innocent — it delegates to
createSale, whose stock check already exempts services
(sales-write.service.ts:1718,1741,2349). The block is UPSTREAM, at
order creation/confirmation: createOrder defaults to
autoReserve !== false, and confirmAndReserve reserves every line
through reserveLocationStock, which has NO service exemption — a
0-stock service line throws INSUFFICIENT_STOCK, so the order can
never reach 'confirmed', let alone convert. The service also got a
phantom reserved_quantity stamped on its line.

THE FIX: SalesOrdersService skips service lines (products.item_type
= 'service') when reserving — in createOrder and in
confirmAndReserve — and leaves their reserved_quantity at 0. A
stocked product line still reserves; a 0-stock non-service line
still throws. convertToSale then runs unchanged (no reservation to
release for the service line) and createSale's own exemption
carries the invoice.

WHAT THIS PINS, driving the REAL SalesOrdersService on PGlite with
a capturing SalesWriteService stub (the real createSale needs the
full posting/finance harness):
1. createOrder with a 0-stock service line succeeds, status
   'confirmed', reserved_quantity 0, no ledger reservation.
2. createOrder with a 0-stock non-service line still throws
   (the exemption is service-only, not a blanket bypass).
3. createOrder mixed: the stocked product reserves, the service
   does not.
4. A draft service order confirms via confirmAndReserve with no
   reservation stamped.
5. convertToSale on the confirmed service order succeeds through
   the stub, with no conversion release handed over.
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

async function reservedQty(db: Kysely<Database>, productId: number): Promise<{ global: number; location: number }> {
  const product = await db.selectFrom('products').select([sql<number>`COALESCE(reserved_qty, 0)`.as('reserved_qty')]).where('id', '=', productId).executeTakeFirstOrThrow();
  const balance = await db.selectFrom('product_location_stock').select(sql<number>`COALESCE(reserved_qty, 0)`.as('reserved_qty')).where('product_id', '=', productId).where('location_id', '=', 10).executeTakeFirstOrThrow();
  return { global: Number(product.reserved_qty), location: Number(balance.reserved_qty) };
}

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, default_stock_location_id bigint);
      CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT true, branch_id bigint);
      CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, item_type text NOT NULL DEFAULT 'product', stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, notes text, branch_id bigint, warehouse_location_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, sale_id bigint, reservation_expires_at timestamptz, delivery_date timestamptz, quotation_id bigint, terms_conditions text, created_by bigint, updated_at timestamptz NOT NULL DEFAULT NOW(), created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, sales_order_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, reserved_quantity numeric NOT NULL DEFAULT 0, delivered_quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL, operation_type text NOT NULL, status text NOT NULL, request_hash text NOT NULL, document_id text, response_payload text, error_code text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), completed_at timestamptz);
    `);

    await db.insertInto('branches').values({ id: 1, tenant_id: 't1', account_id: 'a1', default_stock_location_id: 10 } as any).execute();
    await db.insertInto('stock_locations').values({ id: 10, tenant_id: 't1', account_id: 'a1', name: 'Main', is_active: true, branch_id: 1 } as any).execute();
    await db.insertInto('products').values({ id: 1, tenant_id: 't1', account_id: 'a1', name: 'Widget', item_type: 'product', stock_qty: 10, reserved_qty: 0 } as any).execute();
    await db.insertInto('products').values({ id: 2, tenant_id: 't1', account_id: 'a1', name: 'Grinding', item_type: 'service', stock_qty: 0, reserved_qty: 0 } as any).execute();
    await db.insertInto('products').values({ id: 3, tenant_id: 't1', account_id: 'a1', name: 'Zero Widget', item_type: 'product', stock_qty: 0, reserved_qty: 0 } as any).execute();
    await db.insertInto('product_location_stock').values({ tenant_id: 't1', account_id: 'a1', product_id: 1, branch_id: 1, location_id: 10, qty: 10, reserved_qty: 0 } as any).execute();
    await db.insertInto('product_location_stock').values({ tenant_id: 't1', account_id: 'a1', product_id: 2, branch_id: 1, location_id: 10, qty: 0, reserved_qty: 0 } as any).execute();
    await db.insertInto('product_location_stock').values({ tenant_id: 't1', account_id: 'a1', product_id: 3, branch_id: 1, location_id: 10, qty: 0, reserved_qty: 0 } as any).execute();

    let calls = 0;
    let lastConversionRelease: unknown = 'not-called';
    const stubSalesWrite: any = {
      createSale: async (_payload: any, _auth: any, _terms: any, conversionRelease: any) => {
        calls += 1;
        lastConversionRelease = conversionRelease;
        return { sale: { id: 99 } };
      },
    };
    const service = new SalesOrdersService(db as any, stubSalesWrite);

    async function orderRow(id: number) {
      return db.selectFrom('sales_orders').select(['status', 'sale_id']).where('id', '=', id).executeTakeFirstOrThrow();
    }
    async function orderItems(orderId: number) {
      const rows = await db.selectFrom('sales_order_items').select(['product_id', 'quantity', 'reserved_quantity', 'delivered_quantity']).where('sales_order_id', '=', orderId).orderBy('product_id', 'asc').execute();
      return rows.map((row) => ({ productId: Number(row.product_id), quantity: Number(row.quantity), reserved: Number(row.reserved_quantity), delivered: Number(row.delivered_quantity) }));
    }
    async function orderCount() {
      const row = await db.selectFrom('sales_orders').select(sql<number>`COUNT(*)`.as('n')).executeTakeFirstOrThrow();
      return Number((row as any).n);
    }

    // 1. createOrder with a 0-stock service line succeeds, confirmed, nothing reserved.
    const created = await service.createOrder({
      customerName: 'Cust',
      subtotal: 100,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 100,
      items: [{ productId: 2, productName: 'Grinding', quantity: 2, unitPrice: 50, total: 100 }],
    } as any, AUTH);
    const serviceOrderId = Number((created as any).order.id);
    assert.equal(String((await orderRow(serviceOrderId)).status), 'confirmed');
    assert.deepEqual(await orderItems(serviceOrderId), [{ productId: 2, quantity: 2, reserved: 0, delivered: 0 }]);
    assert.deepEqual(await reservedQty(db, 2), { global: 0, location: 0 });

    // 2. A 0-stock NON-service line still throws — the exemption is service-only.
    const countBefore = await orderCount();
    await assert.rejects(() => service.createOrder({
      customerName: 'Cust',
      subtotal: 10,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 10,
      items: [{ productId: 3, productName: 'Zero Widget', quantity: 1, unitPrice: 10, total: 10 }],
    } as any, AUTH), /الرصيد المتاح/);
    assert.equal(await orderCount(), countBefore);

    // 3. Mixed order: the stocked product reserves, the service does not.
    const mixed = await service.createOrder({
      customerName: 'Cust',
      subtotal: 100,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 100,
      items: [
        { productId: 1, productName: 'Widget', quantity: 2, unitPrice: 25, total: 50 },
        { productId: 2, productName: 'Grinding', quantity: 1, unitPrice: 50, total: 50 },
      ],
    } as any, AUTH);
    const mixedId = Number((mixed as any).order.id);
    assert.equal(String((await orderRow(mixedId)).status), 'confirmed');
    assert.deepEqual((await orderItems(mixedId)).map((row) => row.reserved), [2, 0]);
    assert.deepEqual(await reservedQty(db, 1), { global: 2, location: 2 });
    assert.deepEqual(await reservedQty(db, 2), { global: 0, location: 0 });

    // 4. A draft service order confirms with no reservation stamped.
    const draft = await service.createOrder({
      customerName: 'Cust',
      subtotal: 100,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 100,
      autoReserve: false,
      items: [{ productId: 2, productName: 'Grinding', quantity: 2, unitPrice: 50, total: 100 }],
    } as any, AUTH);
    const draftId = Number((draft as any).order.id);
    assert.equal(String((await orderRow(draftId)).status), 'draft');
    const confirmed = await service.confirmAndReserve(draftId, AUTH);
    assert.equal((confirmed as any).ok, true);
    assert.equal(String((await orderRow(draftId)).status), 'confirmed');
    assert.deepEqual((await orderItems(draftId)).map((row) => row.reserved), [0]);
    assert.deepEqual(await reservedQty(db, 2), { global: 0, location: 0 });

    // 5. convertToSale on the confirmed service order succeeds, no release handed over.
    const converted = await service.convertToSale(serviceOrderId, AUTH);
    assert.equal(Number((converted as any).saleId), 99);
    assert.equal(calls, 1);
    assert.equal(lastConversionRelease, undefined);
    const convertedRow = await orderRow(serviceOrderId);
    assert.equal(String(convertedRow.status), 'converted');
    assert.equal(Number(convertedRow.sale_id), 99);
    assert.deepEqual((await orderItems(serviceOrderId)).map((row) => ({ delivered: row.delivered, reserved: row.reserved })), [{ delivered: 2, reserved: 0 }]);

    // eslint-disable-next-line no-console
    console.log('sales order service stock checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
