/*
New file: backend/test/critical/sales-order-conversion-stock-legs.spec.ts
Pins INV-SALES-ORDER-CONVERSION-STOCK-LEGS: a sales-order conversion
must never release its stock reservation outside the sale transaction.

THE DEFECT (old code, convertToSale): the reservation was released on
the pool handle (`releaseLocationStock(this.db, ...)`) BEFORE createSale
ran, so between the release and the sale's own transaction a concurrent
sale could consume the freed stock. If createSale then failed, the
catch block tried to re-reserve — swallowed with `.catch(() => undefined)`,
so a failed re-reserve silently left the order 'confirmed' with no
reservation at all, while the order items still claimed the quantity.

THE FIX: convertToSale hands the release to createSale as an internal
fourth argument (SalesOrderConversionRelease — a plain type, never a
DTO field, so no HTTP caller can ask for an arbitrary release).
createSale releases inside its own transaction, under the product
locks, after verifying the order is still in the 'converting' state.
A rolled-back sale rolls the release back with it; no re-reserve
exists anymore.

WHAT THIS PINS, driving the REAL SalesOrdersService on PGlite with a
capturing SalesWriteService stub (the real createSale needs the full
posting/finance harness, so its in-transaction release is covered by
the rollback primitive below plus the acceptance suite):
1. Success: the order converts, items are delivered, and the ledger
   reservation is UNCHANGED by convertToSale itself — the release is
   createSale's job, inside its transaction. The stub receives the
   exact conversion release (order, branch, location, items).
2. Failure: the sale error propagates, the order returns to
   'confirmed', and the ledger reservation is still exactly intact —
   nothing was released, so nothing needs re-reserving.
3. No reservation (reserved_quantity 0): no release is handed over
   (undefined) and conversion still succeeds.
4. Already converted: the idempotent early return, createSale is not
   called again.
5. Empty order: rejected, status restored to 'confirmed', createSale
   is not called.
6. Rollback primitive (REAL ledger functions): a release inside a
   transaction that throws leaves the reservation untouched, and a
   committed release + re-reserve round-trips exactly — the property
   the new design relies on.

Deliberately NOT driven here: the integrated real-createSale path
(release inside the sale transaction, then stock deduction) — the
fixture weight of the full posting/finance harness is an acceptance
suite concern; the seam, the handoff, the failure recovery, and the
transactional primitive are all pinned here.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SalesOrdersService } from '../../src/modules/sales/services/sales-orders.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { releaseLocationStock, reserveLocationStock } from '../../src/common/utils/location-stock-ledger';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;

async function reservedQty(db: Kysely<Database>): Promise<{ global: number; location: number }> {
  const product = await db.selectFrom('products').select(['stock_qty', sql<number>`COALESCE(reserved_qty, 0)`.as('reserved_qty')]).where('id', '=', 1).executeTakeFirstOrThrow();
  const balance = await db.selectFrom('product_location_stock').select(sql<number>`COALESCE(reserved_qty, 0)`.as('reserved_qty')).where('product_id', '=', 1).where('location_id', '=', 10).executeTakeFirstOrThrow();
  return { global: Number(product.reserved_qty), location: Number(balance.reserved_qty) };
}

async function orderStatus(db: Kysely<Database>, id: number): Promise<{ status: string; saleId: number | null }> {
  const row = await db.selectFrom('sales_orders').select(['status', 'sale_id']).where('id', '=', id).executeTakeFirstOrThrow();
  return { status: String(row.status), saleId: row.sale_id };
}

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text NOT NULL, default_stock_location_id bigint);
      CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, notes text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, sale_id bigint, updated_at timestamptz NOT NULL DEFAULT NOW(), created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, sales_order_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, reserved_quantity numeric NOT NULL DEFAULT 0, delivered_quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL, operation_type text NOT NULL, status text NOT NULL, request_hash text NOT NULL, document_id text, response_payload text, error_code text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), completed_at timestamptz);
    `);

    await db.insertInto('branches').values({ id: 1, tenant_id: 't1', default_stock_location_id: 10 } as any).execute();
    await db.insertInto('products').values({ id: 1, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: 10, reserved_qty: 4 } as any).execute();
    await db.insertInto('product_location_stock').values({ tenant_id: 't1', account_id: 'a1', product_id: 1, branch_id: 1, location_id: 10, qty: 10, reserved_qty: 4 } as any).execute();

    async function seedOrder(id: number, reserved: number): Promise<void> {
      await db.insertInto('sales_orders').values({ id, tenant_id: 't1', account_id: 'a1', order_number: `SO-${id}`, customer_name: 'Cust', branch_id: 1, total_amount: 100, status: 'confirmed' } as any).execute();
      if (reserved >= 0) {
        await db.insertInto('sales_order_items').values({ tenant_id: 't1', account_id: 'a1', sales_order_id: id, product_id: 1, quantity: 4, reserved_quantity: reserved, unit_price: 25 } as any).execute();
      }
    }

    let failNext = false;
    let calls = 0;
    let lastConversionRelease: unknown = 'not-called';
    const stubSalesWrite: any = {
      createSale: async (_payload: any, _auth: any, _terms: any, conversionRelease: any) => {
        calls += 1;
        lastConversionRelease = conversionRelease;
        if (failNext) throw new Error('SALE_FAILED');
        return { sale: { id: 99 } };
      },
    };
    const service = new SalesOrdersService(db as any, stubSalesWrite);

    // 1. Success: converts, delivers, reservation untouched by convertToSale.
    await seedOrder(1, 4);
    const ok = await service.convertToSale(1, AUTH);
    assert.equal(Number((ok as any).saleId), 99);
    assert.deepEqual(await orderStatus(db, 1), { status: 'converted', saleId: 99 });
    const items1 = await db.selectFrom('sales_order_items').select(['delivered_quantity', 'reserved_quantity']).where('sales_order_id', '=', 1).executeTakeFirstOrThrow();
    assert.equal(Number(items1.delivered_quantity), 4);
    assert.equal(Number(items1.reserved_quantity), 0);
    assert.deepEqual(await reservedQty(db), { global: 4, location: 4 });
    assert.deepEqual(lastConversionRelease, { salesOrderId: 1, branchId: 1, locationId: 10, items: [{ productId: 1, qty: 4 }] });

    // 2. Failure: status restored, reservation exactly intact, error propagates.
    await seedOrder(2, 4);
    failNext = true;
    await assert.rejects(() => service.convertToSale(2, AUTH), /SALE_FAILED/);
    failNext = false;
    assert.deepEqual(await orderStatus(db, 2), { status: 'confirmed', saleId: null });
    assert.deepEqual(await reservedQty(db), { global: 4, location: 4 });

    // 3. No reservation: no release handed over, conversion still succeeds.
    await seedOrder(3, 0);
    const ok3 = await service.convertToSale(3, AUTH);
    assert.equal(Number((ok3 as any).saleId), 99);
    assert.equal(lastConversionRelease, undefined);
    assert.deepEqual(await orderStatus(db, 3), { status: 'converted', saleId: 99 });

    // 4. Already converted: early return, createSale not called again.
    await seedOrder(4, 0);
    await db.updateTable('sales_orders').set({ status: 'converted', sale_id: 77 } as any).where('id', '=', 4).execute();
    const callsBefore = calls;
    const already = await service.convertToSale(4, AUTH);
    assert.equal(Number((already as any).saleId), 77);
    assert.equal(calls, callsBefore);

    // 5. Empty order: rejected, status restored, createSale not called.
    await seedOrder(5, -1);
    await assert.rejects(() => service.convertToSale(5, AUTH), /فارغ/);
    assert.deepEqual(await orderStatus(db, 5), { status: 'confirmed', saleId: null });
    assert.equal(calls, callsBefore);

    // 6. Rollback primitive on the real ledger functions.
    try {
      await db.transaction().execute(async (trx) => {
        await releaseLocationStock(trx as any, { branchId: 1, locationId: 10, tenantId: 't1', accountId: 'a1', items: [{ productId: 1, qty: 4 }] });
        throw new Error('ROLLBACK_PROBE');
      });
      assert.fail('transaction should have rolled back');
    } catch (error: any) {
      assert.equal(error.message, 'ROLLBACK_PROBE');
    }
    assert.deepEqual(await reservedQty(db), { global: 4, location: 4 });
    await db.transaction().execute(async (trx) => {
      await releaseLocationStock(trx as any, { branchId: 1, locationId: 10, tenantId: 't1', accountId: 'a1', items: [{ productId: 1, qty: 4 }] });
    });
    assert.deepEqual(await reservedQty(db), { global: 0, location: 0 });
    await db.transaction().execute(async (trx) => {
      await reserveLocationStock(trx as any, { branchId: 1, locationId: 10, tenantId: 't1', accountId: 'a1', items: [{ productId: 1, qty: 4 }] });
    });
    assert.deepEqual(await reservedQty(db), { global: 4, location: 4 });

    // eslint-disable-next-line no-console
    console.log('sales order conversion stock legs checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
