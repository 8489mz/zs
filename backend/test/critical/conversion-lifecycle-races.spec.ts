/*
 * Conversion lifecycle races (INV-CONVERSION-LIFECYCLE-RACES,
 * Slice 5 P6c).
 *
 * THE DEFECTS (grounding section 3, P6 item 3): three lifecycle
 * races in order/quotation conversion.
 * 1. confirmAndReserve read the order and its items OUTSIDE any
 *    transaction with no row lock, so two concurrent confirms both
 *    saw 'draft', both reserved the full quantity, and both set
 *    'confirmed' — a double reservation.
 * 2. Sales-order conversion claimed 'confirmed -> converting'
 *    atomically (ZS-075) but a process dying after createSale
 *    committed and before the 'converted' marking stranded the
 *    order in 'converting' forever (retry threw "currently
 *    converting"), and deleteOrder on a 'converting' order deleted
 *    the rows WITHOUT releasing the reservation (it only released
 *    for 'confirmed'), stranding the reservation counters.
 * 3. Quotation conversion had no claim at all: no 'converting'
 *    state, no idempotency key, status checked outside a
 *    transaction — two concurrent conversions both called
 *    createSale and both marked 'converted', producing two sales
 *    for one quotation (the second overwrote sale_id).
 *
 * SETTLED SHAPE (from the code, not invented):
 * - confirmAndReserve now reads order + items inside one
 *   transaction under FOR UPDATE (the lock-first shape cancelOrder
 *   already used). The second confirmer blocks on the lock, then
 *   reads 'confirmed' and returns without touching stock.
 * - The conversion idempotency key (so_convert_/quote_convert_)
 *   was INERT before this package: no interceptor on these routes
 *   and no reserve call ever wrote an operation_executions row, so
 *   the re-attach recovery the grounding proposed had nothing to
 *   attach to. Both conversions now reserve the row BEFORE
 *   createSale runs; createSale commits it atomically inside the
 *   sale transaction (document_id = sale id), so the row's state
 *   IS the proof of whether the sale exists. Quotation conversion
 *   claims 'converting' atomically (from any status except
 *   'converted'/'converting', restoring the previous status on
 *   failure) and runs createSale under the same idempotency
 *   context as the order path.
 * - A stuck 'converting' document recovers from the durable row
 *   via decideConversionRecovery: 'committed' re-attaches the
 *   existing sale; 'failed' / stale-'processing' / stale-claim
 *   reverts the claim and re-claims atomically; fresh
 *   'processing' / 'recovery_required' / fresh-claim fails closed.
 *   A failed sale records its failure on the reserved row, so the
 *   next retry proceeds at once instead of spinning on
 *   'processing' for the 60s stuck threshold.
 * - deleteOrder on a 'converting' order releases the reservation
 *   and deletes only when the same evidence proves no sale
 *   committed, re-checked under the row lock and again after the
 *   product locks (a late commit rolls the release back).
 *
 * WHAT THIS DRIVES: the REAL services on PGlite with a capturing
 * createSale stub (the established conversion-spec precedent — no
 * harness runs a full successful createSale), the REAL
 * reserve/release ledger functions, and the REAL pure recovery
 * decision helper:
 * 1. Double confirm reserves once (sequential) + lock source pin.
 * 2. Stuck order + committed row re-attaches, createSale uncalled.
 * 3. Stuck order + stale processing row retries and converts.
 * 4. Stuck order + fresh processing row fails closed, unconverted.
 * 5. Stuck order + no row + stale claim retries and converts.
 * 6. Stuck order + no row + fresh claim fails closed, unconverted.
 * 7. Failed sale records 'failed'; immediate retry converts.
 * 8. Quotation: a concurrent (re-entrant) second conversion fails
 *    closed while the first holds the claim; exactly one sale;
 *    a later sequential call returns the same sale id.
 * 9. Quotation stuck + committed row re-attaches; stuck + stale
 *    processing retries; failure restores the previous status.
 * 10. Delete of a stuck-converting order releases the reservation;
 *     delete with a committed sale row refuses, order intact.
 * 11. Pure decideConversionRecovery table + sale-id extraction.
 * 12. Source pins + invariant pin.
 *
 * Deliberately NOT driven here: true two-connection concurrency
 * (PGlite is a single connection — the lock/claim is pinned by
 * source + the re-entrant attempt in case 8, which is the closest
 * concurrency proof this harness supports; two-connection
 * contention is live-Postgres acceptance); the integrated
 * real-createSale path (journal/stock posting inside the sale
 * transaction); live-Postgres acceptance — all still deferred by
 * written decision. cancelOrder on a 'converting' order is
 * unchanged by this package (separate follow-up, noted in the
 * invariant). P6a discounts, P6b payment terms, and storefront
 * conversion are untouched.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { SalesOrdersService } from '../../src/modules/sales/services/sales-orders.service';
import { QuotationsService } from '../../src/modules/sales/services/quotations.service';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { decideConversionRecovery, conversionRecoverySaleId } from '../../src/modules/sales/helpers/sales-write.helper';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';

const AUTH = { tenantId: 't1', accountId: 'a1', role: 'admin', userId: 1, username: 'admin', permissions: [] } as unknown as AuthContext;
const STALE_MS = 120000;
const staleDate = () => new Date(Date.now() - STALE_MS);

async function main() {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text NOT NULL, default_stock_location_id bigint);
      CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, item_type text NOT NULL DEFAULT 'product', stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, notes text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, sale_id bigint, payment_terms text, updated_at timestamptz NOT NULL DEFAULT NOW(), created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, sales_order_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, reserved_quantity numeric NOT NULL DEFAULT 0, delivered_quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE quotations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, branch_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, valid_until timestamptz, status text NOT NULL, sale_id bigint, notes text, terms_conditions text, created_by bigint, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE quotation_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, quotation_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
      CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL, operation_type text NOT NULL, status text NOT NULL, request_hash text NOT NULL, document_id text, response_payload text, error_code text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), completed_at timestamptz);
    `);

    await db.insertInto('branches').values({ id: 1, tenant_id: 't1', default_stock_location_id: 10 } as any).execute();
    await db.insertInto('products').values({ id: 1, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: 100, reserved_qty: 0 } as any).execute();
    await db.insertInto('product_location_stock').values({ tenant_id: 't1', account_id: 'a1', product_id: 1, branch_id: 1, location_id: 10, qty: 100, reserved_qty: 0 } as any).execute();

    async function seedOrder(id: number, status: string, reserved: number, updatedAt?: Date): Promise<void> {
      await db.insertInto('sales_orders').values({ id, tenant_id: 't1', account_id: 'a1', order_number: `SO-${id}`, customer_name: 'Cust', branch_id: 1, total_amount: 100, status, updated_at: updatedAt ?? new Date() } as any).execute();
      await db.insertInto('sales_order_items').values({ tenant_id: 't1', account_id: 'a1', sales_order_id: id, product_id: 1, quantity: 4, reserved_quantity: reserved, unit_price: 25 } as any).execute();
    }

    async function seedQuotation(id: number, status: string, updatedAt?: Date): Promise<void> {
      await db.insertInto('quotations').values({ id, tenant_id: 't1', account_id: 'a1', quotation_number: `Q-${id}`, customer_name: 'Cust', branch_id: 1, total_amount: 100, status, updated_at: updatedAt ?? new Date() } as any).execute();
      await db.insertInto('quotation_items').values({ tenant_id: 't1', account_id: 'a1', quotation_id: id, product_id: 1, quantity: 4, unit_price: 25 } as any).execute();
    }

    async function seedOpRow(key: string, status: string, opts: { documentId?: string; payload?: any; updatedAt?: Date; hashInput: any } = { hashInput: {} }): Promise<void> {
      // The seeded row must carry the exact deterministic hash the
      // service computes for this key, or reserveOperation
      // correctly rejects the retry as a payload mismatch.
      const requestHash = new IdempotencyService(db as any).generateRequestHash(opts.hashInput);
      await db.insertInto('operation_executions').values({
        tenant_id: 't1', account_id: 'a1', idempotency_key: key, operation_type: 'sale',
        status, request_hash: requestHash, document_id: opts.documentId ?? null,
        response_payload: opts.payload ? JSON.stringify(opts.payload) : null,
        error_code: null, updated_at: opts.updatedAt ?? new Date(),
      } as any).execute();
    }

    async function orderRow(id: number): Promise<{ status: string; saleId: number | null; reserved: number }> {
      const row = await db.selectFrom('sales_orders').select(['status', 'sale_id']).where('id', '=', id).executeTakeFirstOrThrow();
      const item = await db.selectFrom('sales_order_items').select(['reserved_quantity', 'delivered_quantity']).where('sales_order_id', '=', id).executeTakeFirstOrThrow();
      return { status: String(row.status), saleId: row.sale_id, reserved: Number(item.reserved_quantity) };
    }

    async function quoteRow(id: number): Promise<{ status: string; saleId: number | null }> {
      const row = await db.selectFrom('quotations').select(['status', 'sale_id']).where('id', '=', id).executeTakeFirstOrThrow();
      return { status: String(row.status), saleId: row.sale_id };
    }

    async function reservedQty(): Promise<{ global: number; location: number }> {
      const product = await db.selectFrom('products').select(sql<number>`COALESCE(reserved_qty, 0)`.as('reserved_qty')).where('id', '=', 1).executeTakeFirstOrThrow();
      const balance = await db.selectFrom('product_location_stock').select(sql<number>`COALESCE(reserved_qty, 0)`.as('reserved_qty')).where('product_id', '=', 1).where('location_id', '=', 10).executeTakeFirstOrThrow();
      return { global: Number(product.reserved_qty), location: Number(balance.reserved_qty) };
    }

    async function opRowStatus(key: string): Promise<string | null> {
      const row = await db.selectFrom('operation_executions').select('status').where('idempotency_key', '=', key).executeTakeFirst();
      return row ? String(row.status) : null;
    }

    let calls = 0;
    let failNext = false;
    let nextSaleId = 99;
    let reenter: (() => Promise<unknown>) | null = null;
    let reenterError: unknown = 'not-run';
    const stubSalesWrite: any = {
      createSale: async () => {
        calls += 1;
        if (reenter) {
          const fn = reenter;
          reenter = null;
          try {
            await fn();
            reenterError = 'no-error';
          } catch (err) {
            reenterError = err;
          }
        }
        if (failNext) {
          failNext = false;
          throw new Error('SALE_FAILED');
        }
        const id = nextSaleId;
        nextSaleId += 1;
        return { sale: { id } };
      },
    };
    // Services constructed with two arguments on purpose: the
    // IdempotencyService fallback over the same db must work for
    // hand-constructed instances (specs, harnesses).
    const orders = new SalesOrdersService(db as any, stubSalesWrite);
    const quotations = new QuotationsService(db as any, stubSalesWrite);

    // 1. Double confirm reserves once.
    await seedOrder(1, 'draft', 0);
    const confirm1: any = await orders.confirmAndReserve(1, AUTH);
    assert.equal(confirm1.ok, true);
    const confirm2: any = await orders.confirmAndReserve(1, AUTH);
    assert.equal(confirm2.ok, true);
    assert.match(String(confirm2.message), /بالفعل/);
    assert.deepEqual(await reservedQty(), { global: 4, location: 4 });
    assert.equal((await orderRow(1)).reserved, 4);

    // 2. Stuck order + committed row re-attaches; createSale uncalled.
    const callsBefore2 = calls;
    await seedOrder(2, 'converting', 4);
    await seedOpRow('so_convert_t1_2', 'committed', { documentId: '77', payload: { ok: true, saleId: 77 }, hashInput: { conversion: 'sales_order', id: 2 } });
    const attached: any = await orders.convertToSale(2, AUTH);
    assert.equal(Number(attached.saleId), 77);
    assert.equal(calls, callsBefore2);
    assert.deepEqual(await orderRow(2), { status: 'converted', saleId: 77, reserved: 0 });

    // 3. Stuck order + stale processing row retries and converts.
    await seedOrder(3, 'converting', 4, staleDate());
    await seedOpRow('so_convert_t1_3', 'processing', { updatedAt: staleDate(), hashInput: { conversion: 'sales_order', id: 3 } });
    const recovered: any = await orders.convertToSale(3, AUTH);
    assert.equal(Number(recovered.saleId), 99);
    assert.deepEqual(await orderRow(3), { status: 'converted', saleId: 99, reserved: 0 });

    // 4. Stuck order + fresh processing row fails closed.
    await seedOrder(4, 'converting', 4);
    await seedOpRow('so_convert_t1_4', 'processing', { hashInput: { conversion: 'sales_order', id: 4 } });
    const callsBefore4 = calls;
    await assert.rejects(() => orders.convertToSale(4, AUTH), /قيد التحويل/);
    assert.equal(calls, callsBefore4);
    assert.equal((await orderRow(4)).status, 'converting');

    // 5. Stuck order + no row + stale claim retries and converts.
    await seedOrder(5, 'converting', 4, staleDate());
    const noRow: any = await orders.convertToSale(5, AUTH);
    assert.equal(Number(noRow.saleId), 100);
    assert.deepEqual(await orderRow(5), { status: 'converted', saleId: 100, reserved: 0 });

    // 6. Stuck order + no row + fresh claim fails closed.
    await seedOrder(6, 'converting', 4);
    const callsBefore6 = calls;
    await assert.rejects(() => orders.convertToSale(6, AUTH), /قيد التحويل/);
    assert.equal(calls, callsBefore6);
    assert.equal((await orderRow(6)).status, 'converting');

    // 7. Failed sale records 'failed'; immediate retry converts.
    await seedOrder(7, 'confirmed', 4);
    failNext = true;
    await assert.rejects(() => orders.convertToSale(7, AUTH), /SALE_FAILED/);
    assert.equal((await orderRow(7)).status, 'confirmed');
    assert.equal(await opRowStatus('so_convert_t1_7'), 'failed');
    const retried: any = await orders.convertToSale(7, AUTH);
    assert.equal(Number(retried.saleId), 101);
    assert.deepEqual(await orderRow(7), { status: 'converted', saleId: 101, reserved: 0 });

    // 8. Quotation: re-entrant second conversion fails closed; one sale.
    await seedQuotation(1, 'draft');
    const callsBefore8 = calls;
    reenter = () => quotations.convertToSale(1, AUTH);
    const qok: any = await quotations.convertToSale(1, AUTH);
    assert.equal(Number(qok.saleId), 102);
    assert.equal(calls, callsBefore8 + 1);
    assert.match(String((reenterError as any)?.message || ''), /قيد التحويل/);
    assert.deepEqual(await quoteRow(1), { status: 'converted', saleId: 102 });
    const qagain: any = await quotations.convertToSale(1, AUTH);
    assert.equal(Number(qagain.saleId), 102);
    assert.equal(calls, callsBefore8 + 1);

    // 9. Quotation stuck + committed row attaches; stale retries;
    //    failure restores the previous status.
    await seedQuotation(2, 'converting');
    await seedOpRow('quote_convert_t1_2', 'committed', { documentId: '88', payload: { ok: true, saleId: 88 }, hashInput: { conversion: 'quotation', id: 2 } });
    const qattached: any = await quotations.convertToSale(2, AUTH);
    assert.equal(Number(qattached.saleId), 88);
    assert.deepEqual(await quoteRow(2), { status: 'converted', saleId: 88 });

    await seedQuotation(3, 'converting', staleDate());
    await seedOpRow('quote_convert_t1_3', 'processing', { updatedAt: staleDate(), hashInput: { conversion: 'quotation', id: 3 } });
    const qrecovered: any = await quotations.convertToSale(3, AUTH);
    assert.equal(Number(qrecovered.saleId), 103);
    assert.deepEqual(await quoteRow(3), { status: 'converted', saleId: 103 });

    await seedQuotation(4, 'sent');
    failNext = true;
    await assert.rejects(() => quotations.convertToSale(4, AUTH), /SALE_FAILED/);
    assert.equal((await quoteRow(4)).status, 'sent');
    assert.equal(await opRowStatus('quote_convert_t1_4'), 'failed');
    const qretried: any = await quotations.convertToSale(4, AUTH);
    assert.equal(Number(qretried.saleId), 104);
    assert.deepEqual(await quoteRow(4), { status: 'converted', saleId: 104 });

    // 10. Delete of a stuck-converting order releases the reservation;
    //     delete with a committed sale row refuses, order intact.
    await seedOrder(8, 'converting', 4, staleDate());
    // Ledger holds only case 1's real reservation (seeding item rows
    // does not move it); the delete must release exactly that.
    assert.deepEqual(await reservedQty(), { global: 4, location: 4 });
    const deleted: any = await orders.deleteOrder(8, AUTH);
    assert.equal(deleted.ok, true);
    assert.deepEqual(await reservedQty(), { global: 0, location: 0 });
    const gone = await db.selectFrom('sales_orders').select('id').where('id', '=', 8).executeTakeFirst();
    assert.equal(gone, undefined);

    await seedOrder(9, 'converting', 4);
    await seedOpRow('so_convert_t1_9', 'committed', { documentId: '91', payload: { ok: true, saleId: 91 }, hashInput: { conversion: 'sales_order', id: 9 } });
    await assert.rejects(() => orders.deleteOrder(9, AUTH), /فاتورة موجودة/);
    assert.equal((await orderRow(9)).status, 'converting');
    assert.deepEqual(await reservedQty(), { global: 0, location: 0 });

    // 11. Pure recovery decision table + sale-id extraction.
    const now = Date.now();
    const fresh = new Date(now - 1000);
    const stale = new Date(now - STALE_MS);
    assert.equal(decideConversionRecovery({ status: 'committed', documentId: '5', responsePayload: null, updatedAt: fresh }, fresh, now), 'attach');
    assert.equal(decideConversionRecovery({ status: 'failed', documentId: null, responsePayload: null, updatedAt: fresh }, fresh, now), 'stale-retry');
    assert.equal(decideConversionRecovery({ status: 'processing', documentId: null, responsePayload: null, updatedAt: fresh }, fresh, now), 'in-flight');
    assert.equal(decideConversionRecovery({ status: 'processing', documentId: null, responsePayload: null, updatedAt: stale }, stale, now), 'stale-retry');
    assert.equal(decideConversionRecovery({ status: 'recovery_required', documentId: null, responsePayload: null, updatedAt: stale }, stale, now), 'in-flight');
    assert.equal(decideConversionRecovery(null, fresh, now), 'in-flight');
    assert.equal(decideConversionRecovery(null, stale, now), 'stale-retry');
    assert.equal(conversionRecoverySaleId({ status: 'committed', documentId: '42', responsePayload: null, updatedAt: fresh }), 42);
    assert.equal(conversionRecoverySaleId({ status: 'committed', documentId: null, responsePayload: { saleId: 43 }, updatedAt: fresh }), 43);
    assert.equal(conversionRecoverySaleId({ status: 'committed', documentId: null, responsePayload: null, updatedAt: fresh }), null);
    assert.equal(conversionRecoverySaleId(null), null);

    // 12. Source pins + invariant pin.
    const orderSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/sales-orders.service.ts'), 'utf8');
    const confirmSlice = orderSource.slice(orderSource.indexOf('async confirmAndReserve'), orderSource.indexOf('async cancelOrder'));
    assert.ok(confirmSlice.includes('forUpdate()'), 'confirmAndReserve must lock the order row');
    assert.ok(confirmSlice.includes('transaction().execute'), 'confirmAndReserve must read inside one transaction');
    assert.ok(orderSource.includes('reserveOperation'), 'order conversion must reserve the operation row');
    assert.ok(orderSource.includes('recordFailure'), 'order conversion must record a failed sale attempt');
    assert.ok(orderSource.includes('getOperationState'), 'order conversion must read the operation row for recovery');
    const quoteSource = readFileSync(resolve(__dirname, '../../src/modules/sales/services/quotations.service.ts'), 'utf8');
    const quoteSlice = quoteSource.slice(quoteSource.indexOf('async convertToSale'));
    assert.ok(quoteSlice.includes("'converting'"), 'quotation conversion must claim a converting state');
    assert.ok(quoteSlice.includes('reserveOperation'), 'quotation conversion must reserve the operation row');
    const invariants = readFileSync(resolve(__dirname, '../../../ARCHITECTURE_INVARIANTS.md'), 'utf8');
    assert.equal(invariants.split('INV-CONVERSION-LIFECYCLE-RACES').length - 1, 1, 'the invariant entry must exist exactly once');
    // Last-line ownership passes to newer entries:
    // INV-SALE-EDIT-COST-FLOOR appends after this entry, so the
    // last-line assertion that held at this package's own landing is
    // relaxed here — test-only, behaviour cases above are unchanged.
    // (Same chaining precedent as P7-2's own relaxation of the
    // P3/P6b last-line pins.)
  } finally {
    await db.destroy();
  }
  console.log('Conversion lifecycle races tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
