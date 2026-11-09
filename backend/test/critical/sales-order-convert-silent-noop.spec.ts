/*
New file: backend/test/critical/sales-order-convert-silent-noop.spec.ts

Pins I3-D3: convert-to-invoice silently did nothing on all three live
paths (sales-order list button, order-details dialog button,
quotation #QUO-471408 -> invoice). The register stayed at 21 invoices
after every attempt; no toast, no error, no sale.

ROOT CAUSE (shared by all three paths, frontend): every convert call
site guarded its mutation with the synchronous raw `confirm(...)`:
  - SalesOrdersPage.tsx list onConvert: `if (confirm(...)) convertMutation.mutate(order.id)`
  - SalesOrdersPage.tsx details onConvert: `if (confirm(...)) convertMutation.mutate(id)`
  - QuotationsTable.tsx convert button: `if (confirm(...)) onConvert(q.id)`
But SystemAlertProvider (frontend/src/shared/components/system-alert.tsx)
replaces window.confirm with a shim that fires the async enterprise
confirm (whose returned promise nobody awaits) and ALWAYS returns
false. So the guarded mutate NEVER executes: no request is sent, no
toast appears, no invoice is created. The "confirm dialog closed" the
trial saw was the enterprise modal opening and its resolution going
nowhere. Second defect on the quotation path: QuotationsPage's
convertMutation has NO onError handler, so even a backend failure
would stay silent instead of naming the problem.

THE FIX (this package): the three convert call sites use the
sanctioned async `await systemConfirm(...)` (the pattern the MTO
button in SalesOrderDetailsModal already uses), and QuotationsPage's
convertMutation gains an onError toast naming the failure. The
backend convertToSale / quotations convertToSale need no change:
the real integrated goods-conversion path is already proven by
sale-conversion-integration-guard.spec.ts case (e)/(f), and the
claim + idempotency mechanism (second convert returns the existing
sale, never posts twice) is already pinned by
conversion-lifecycle-races.spec.ts.

WHAT THIS PINS, driving the REAL services on PGlite with a capturing
SalesWriteService stub (same seam as
sales-order-conversion-stock-legs.spec.ts):
1. Live shape SO-261108-0008: approved order, 10 x 120 = 1,200.00 EGP,
   reserved stock 10, converts to a sale carrying the same line
   (qty 10, price 120), the same cash payment (1,200.00), and the
   reservation release; order becomes 'converted' with sale_id, items
   delivered 10 / reserved 0.
2. No double conversion: a second convert returns the existing sale
   id and createSale is NOT called again.
3. Loud failure: converting a draft order rejects with an error
   naming the problem (not silent), status stays 'draft', createSale
   is not called.
4. Quotation conversion carries the same lines/amounts (cash 1,200.00)
   and marks the quotation 'converted' with sale_id.
5. Frontend wiring (source pins, fail on base): no synchronous
   `confirm(` guards a convert call site in SalesOrdersPage or
   QuotationsTable (cancel/delete call sites are out of this
   package's region and keep their own confirm gates), both convert
   call sites await systemConfirm, and QuotationsPage's
   convertMutation has an onError toast.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SalesOrdersService } from '../../src/modules/sales/services/sales-orders.service';
import { QuotationsService } from '../../src/modules/sales/services/quotations.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: ['sales'] } as unknown as AuthContext;
const REPO_ROOT = path.resolve(__dirname, '../../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text NOT NULL, default_stock_location_id bigint);
      CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, notes text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, sale_id bigint, payment_terms text, updated_at timestamptz NOT NULL DEFAULT NOW(), created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, sales_order_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, reserved_quantity numeric NOT NULL DEFAULT 0, delivered_quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE quotations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, valid_until timestamptz, status text NOT NULL, sale_id bigint, notes text, terms_conditions text, created_by bigint, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE quotation_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_id bigint NOT NULL, product_id bigint, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL, operation_type text NOT NULL, status text NOT NULL, request_hash text NOT NULL, document_id text, response_payload text, error_code text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), completed_at timestamptz);
    `);

    await db.insertInto('branches').values({ id: 1, tenant_id: 't1', default_stock_location_id: 10 } as any).execute();
    await db.insertInto('products').values({ id: 1, tenant_id: 't1', account_id: 'a1', name: 'اختبار صنف استيراد 001', stock_qty: 10, reserved_qty: 10 } as any).execute();
    await db.insertInto('product_location_stock').values({ tenant_id: 't1', account_id: 'a1', product_id: 1, branch_id: 1, location_id: 10, qty: 10, reserved_qty: 10 } as any).execute();

    let calls = 0;
    let lastPayload: any = null;
    let lastRelease: unknown = 'not-called';
    const stubSalesWrite: any = {
      createSale: async (payload: any, _auth: any, _terms: any, conversionRelease: any) => {
        calls += 1;
        lastPayload = payload;
        lastRelease = conversionRelease;
        return { sale: { id: 501 } };
      },
    };
    const ordersService = new SalesOrdersService(db as any, stubSalesWrite);
    const quotationsService = new QuotationsService(db as any, stubSalesWrite);

    // 1. Live shape SO-261108-0008: approved, 10 x 120 = 1,200.00 EGP, reserved 10.
    await db.insertInto('sales_orders').values({ id: 8, tenant_id: 't1', account_id: 'a1', order_number: 'SO-261108-0008', customer_name: 'عميل اختبار 00001', branch_id: 1, subtotal: 1200, total_amount: 1200, status: 'confirmed', payment_terms: 'cash' } as any).execute();
    await db.insertInto('sales_order_items').values({ tenant_id: 't1', account_id: 'a1', sales_order_id: 8, product_id: 1, product_name: 'اختبار صنف استيراد 001', quantity: 10, reserved_quantity: 10, unit_price: 120, total: 1200 } as any).execute();
    const converted = await ordersService.convertToSale(8, AUTH);
    assert.equal(Number((converted as any).saleId), 501);
    assert.deepEqual(lastPayload.items, [{ productId: 1, qty: 10, price: 120, lineDiscount: 0, unitName: undefined }]);
    assert.deepEqual(lastPayload.payments, [{ paymentChannel: 'cash', amount: 1200 }]);
    assert.equal(lastPayload.locationId, 10);
    assert.deepEqual(lastRelease, { salesOrderId: 8, branchId: 1, locationId: 10, items: [{ productId: 1, qty: 10 }] });
    const orderRow = await db.selectFrom('sales_orders').select(['status', 'sale_id']).where('id', '=', 8).executeTakeFirstOrThrow();
    assert.equal(String(orderRow.status), 'converted');
    assert.equal(Number(orderRow.sale_id), 501);
    const orderItem = await db.selectFrom('sales_order_items').select(['delivered_quantity', 'reserved_quantity']).where('sales_order_id', '=', 8).executeTakeFirstOrThrow();
    assert.equal(Number(orderItem.delivered_quantity), 10);
    assert.equal(Number(orderItem.reserved_quantity), 0);

    // 2. No double conversion: second convert returns the existing sale, writer not called again.
    const callsAfterFirst = calls;
    const again = await ordersService.convertToSale(8, AUTH);
    assert.equal(Number((again as any).saleId), 501);
    assert.equal(calls, callsAfterFirst);

    // 3. Loud failure: a draft order cannot convert — rejects naming the problem, stays draft.
    await db.insertInto('sales_orders').values({ id: 9, tenant_id: 't1', account_id: 'a1', order_number: 'SO-DRAFT-9', customer_name: 'Cust', branch_id: 1, subtotal: 1200, total_amount: 1200, status: 'draft', payment_terms: 'cash' } as any).execute();
    await db.insertInto('sales_order_items').values({ tenant_id: 't1', account_id: 'a1', sales_order_id: 9, product_id: 1, product_name: 'اختبار صنف استيراد 001', quantity: 10, reserved_quantity: 0, unit_price: 120, total: 1200 } as any).execute();
    const callsBeforeDraft = calls;
    await assert.rejects(() => ordersService.convertToSale(9, AUTH), /مسودة|لا يمكن تحويل/);
    assert.equal(calls, callsBeforeDraft);
    const draftRow = await db.selectFrom('sales_orders').select(['status', 'sale_id']).where('id', '=', 9).executeTakeFirstOrThrow();
    assert.equal(String(draftRow.status), 'draft');
    assert.equal(draftRow.sale_id, null);

    // 4. Quotation conversion carries the same lines/amounts and marks converted.
    await db.insertInto('quotations').values({ id: 471408, tenant_id: 't1', account_id: 'a1', quotation_number: 'QUO-471408', customer_name: 'عميل اختبار 00001', branch_id: 1, subtotal: 1200, total_amount: 1200, status: 'draft' } as any).execute();
    await db.insertInto('quotation_items').values({ tenant_id: 't1', account_id: 'a1', quotation_id: 471408, product_id: 1, product_name: 'اختبار صنف استيراد 001', quantity: 10, unit_price: 120, total: 1200 } as any).execute();
    const quoteConverted = await quotationsService.convertToSale(471408, AUTH);
    assert.equal(Number((quoteConverted as any).saleId), 501);
    assert.deepEqual(lastPayload.items, [{ productId: 1, qty: 10, price: 120, lineDiscount: 0, unitName: undefined }]);
    assert.deepEqual(lastPayload.payments, [{ paymentChannel: 'cash', amount: 1200 }]);
    const quoteRow = await db.selectFrom('quotations').select(['status', 'sale_id']).where('id', '=', 471408).executeTakeFirstOrThrow();
    assert.equal(String(quoteRow.status), 'converted');
    assert.equal(Number(quoteRow.sale_id), 501);

    // 5. Frontend wiring: no synchronous confirm() guards a convert call site.
    // SalesOrdersPage keeps exactly the two out-of-region confirm gates
    // (cancel + delete); both convert gates must be async systemConfirm.
    const ordersPage = readSource('frontend/src/features/sales/pages/SalesOrdersPage.tsx');
    assert.equal((ordersPage.match(/if \(confirm\(/g) || []).length, 2, 'SalesOrdersPage must keep only cancel/delete confirm gates; convert gates must be systemConfirm');
    assert.equal((ordersPage.match(/await systemConfirm\(/g) || []).length, 2, 'SalesOrdersPage must await systemConfirm in both convert handlers');
    assert.ok(!/if \(confirm\([^)]*تحويل/.test(ordersPage), 'no sync confirm may guard a convert in SalesOrdersPage');
    // QuotationsTable keeps exactly the delete confirm gate; its convert
    // button must be async systemConfirm.
    const quotesTable = readSource('frontend/src/features/sales/components/quotations/QuotationsTable.tsx');
    assert.equal((quotesTable.match(/if \(confirm\(/g) || []).length, 1, 'QuotationsTable must keep only the delete confirm gate; convert must be systemConfirm');
    assert.equal((quotesTable.match(/await systemConfirm\(/g) || []).length, 1, 'QuotationsTable must await systemConfirm in its convert handler');
    assert.ok(!/if \(confirm\([^)]*تحويل/.test(quotesTable), 'no sync confirm may guard a convert in QuotationsTable');
    // QuotationsPage convertMutation must fail loudly: an onError toast.
    const quotesPage = readSource('frontend/src/features/sales/pages/QuotationsPage.tsx');
    const convertBlock = quotesPage.slice(quotesPage.indexOf('convertMutation = useMutation'));
    const convertMutationBlock = convertBlock.slice(0, convertBlock.indexOf('deleteMutation'));
    assert.ok(/onError/.test(convertMutationBlock), 'QuotationsPage convertMutation must have an onError handler');
    assert.ok(/toast\.error/.test(convertMutationBlock), 'QuotationsPage convertMutation onError must show an error toast naming the failure');

    // eslint-disable-next-line no-console
    console.log('sales order convert silent-noop checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
