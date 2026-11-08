/*
 * R2 (U5): idempotency coverage — the two exposed controllers the scan
 * proved were missing interceptor coverage.
 *
 * REVIEW VERDICTS (grounded at base 30a84e93, Phase 0 §1.6):
 * - COVERED, no change: sales / returns / services / inventory controllers
 *   already carry IdempotencyInterceptor; purchases createPurchase,
 *   createSupplierPayment and createCustomerPayment carry SERVICE-level
 *   reserve/commit with the header passed through by the controller
 *   (purchases-write.service.ts:292, :1357, :1458 — the service comment
 *   calls createPurchase the SINGLE reservation point, and the
 *   interceptor is deliberately NOT applied to PurchasesController);
 *   settleSupplierSchedule passes the header to payInstallment.
 *   Fiscal-year close re-reads the year FOR UPDATE inside the
 *   transaction and throws when already closed (fiscal-year.service.ts
 *   :596-608). Forex revaluation takes a pg_advisory_xact_lock per
 *   tenant/period/currency and throws on an existing 'posted' run
 *   (forex-revaluation.service.ts:189-260). Payroll-run creation takes
 *   the tenant advisory lock, checks overlapping periods FOR UPDATE,
 *   and REUSES the existing draft run for an exact-period retry
 *   (hr.service.ts:3601-3700). Landed costs refuse a second apply via
 *   landed_cost_applied_at (purchase-landed-costs.service.ts:25-27).
 *   createForPurchase deletes the purchase's schedules before
 *   re-inserting (replace semantics). Import-sales post-expense
 *   refuses a second posting (already-posted Conflict), preorder
 *   refund REQUIRES an idempotency key, and createShipment refuses a
 *   duplicate container/BOL via its unique index.
 * - GAP, fixed here: POST purchases/:id/receive-goods has no key at
 *   all, and its guard only rejects when alreadyReceived + qty >
 *   ordered. A byte-identical retry of a full receipt (received 5 of
 *   10, retry the same 5) passes the guard (5 + 5 <= 10) and moves the
 *   stock a second time — books say 10 received, 5 physically arrived.
 *   The same retry-after-commit shape holds for cancel (retry returns
 *   400 PURCHASE_ALREADY_CANCELLED instead of the original success)
 *   and for landed-costs (retry returns 400 instead of the success).
 *   Import-sales has ~50 mutating endpoints with keys on only five
 *   service methods (foreign-transfer, late-expense, capital
 *   transaction, preorder refund, :7183); recordFxAcquisition inserts
 *   unconditionally and recordPartnerPayout has no key path.
 * - GAP, record-only (file owned by R3b, NOT edited here): maritime
 *   createAgentSettlement inserts a settlement row unconditionally —
 *   no key, no duplicate check, no unique index on reference_number
 *   (maritime-freight.service.ts:6754-6810). A lost response + retry
 *   books the agent settlement twice. Needs a follow-up package.
 *
 * FIX: the interceptor is opt-in (no x-idempotency-key header means
 * pass-through, and the frontend sends no keys to these controllers
 * today), so this changes nothing for existing callers.
 * - purchases.controller.ts: per-method @UseInterceptors
 *   (IdempotencyInterceptor) on the 8 mutating endpoints without a
 *   service-level key — generate-drafts, update, cancel, receive-goods,
 *   create-purchase-schedule, create-supplier-schedule, apply-repricing,
 *   landed-costs. The 4 keyed endpoints keep their single service-level
 *   reservation point; the multipart upload endpoint is excluded
 *   deliberately (FileInterceptor + @Res manual response).
 * - import-sales.controller.ts: class-wide @UseInterceptors
 *   (IdempotencyInterceptor), the services.controller.ts precedent.
 *   No @Res / FileInterceptor endpoints exist there; every handler
 *   returns a JSON record.
 *
 * WHAT THIS SPEC PROVES (real IdempotencyInterceptor + real
 * IdempotencyService on PGlite, no mocks of either):
 * 1. A retried stock-moving handler runs ONCE: same key + same body
 *    twice returns identical responses, one handler invocation, one
 *    receipt row, and the operation row is 'committed'.
 * 2. Same key + different payload is rejected loudly
 *    (IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD).
 * 3. No key header means pass-through (handler runs every time) —
 *    zero behaviour change for today's keyless callers.
 * 4. GET requests are skipped by the interceptor.
 * 5. A concurrent duplicate while the first call is still processing
 *    gets 409 'Operation is currently processing'; the work still
 *    runs exactly once.
 * 6. CONTROL: the same handler WITHOUT the interceptor double-applies
 *    (two rows) — the gap this package closes.
 * 7. WIRING PINS: the 8 purchases methods carry the decorator, the 4
 *    service-keyed endpoints do NOT (single reservation point kept),
 *    and import-sales carries exactly one class-wide decorator.
 * Reverting the controller annotations fails case 7; the mechanism
 * cases (1-6) pin the interceptor behaviour itself.
 *
 * Run: npx ts-node test/critical/idempotency-coverage-r2.spec.ts (from backend/).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { ConflictException } from '@nestjs/common';
import { defer, lastValueFrom, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Database } from '../../src/database/database.types';
import { IdempotencyInterceptor } from '../../src/core/idempotency/idempotency.interceptor';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AppError } from '../../src/common/errors/app-error';

const TENANT = 't-r2';
const ACCOUNT = 'a-r2';
const PURCHASES_CONTROLLER = join(__dirname, '../../src/modules/purchases/purchases.controller.ts');
const IMPORT_SALES_CONTROLLER = join(__dirname, '../../src/modules/import-sales/import-sales.controller.ts');

function makeRequest(opts: {
  key?: string;
  method?: string;
  path?: string;
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
}): any {
  return {
    headers: opts.key ? { 'x-idempotency-key': opts.key } : {},
    authContext: { tenantId: TENANT, accountId: ACCOUNT },
    method: opts.method || 'POST',
    route: { path: opts.path || '/api/purchases/1/receive-goods' },
    path: opts.path || '/api/purchases/1/receive-goods',
    body: opts.body || {},
    params: opts.params || {},
  };
}

function makeContext(req: any): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

async function receiptRowCount(db: Kysely<Database>): Promise<number> {
  const row = await sql<{ n: string }>`SELECT COUNT(*)::text AS n FROM spec_receipts`.execute(db);
  return Number(row.rows[0]?.n || 0);
}

async function operationStatus(db: Kysely<Database>, key: string): Promise<string | null> {
  const row = await sql<{ status: string }>`
    SELECT status FROM operation_executions
    WHERE tenant_id = ${TENANT} AND account_id = ${ACCOUNT} AND idempotency_key = ${key}
  `.execute(db);
  return row.rows[0]?.status || null;
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/* The decorator sits between the route decorator and the method name. */
function assertMethodAnnotated(source: string, methodName: string): void {
  const methodIdx = source.indexOf(`  ${methodName}(`);
  assert.ok(methodIdx > 0, `purchases: method ${methodName} not found`);
  const routeIdx = Math.max(
    source.lastIndexOf('@Post(', methodIdx),
    source.lastIndexOf('@Put(', methodIdx),
    source.lastIndexOf('@Patch(', methodIdx),
    source.lastIndexOf('@Delete(', methodIdx),
    source.lastIndexOf('@Get(', methodIdx),
  );
  assert.ok(routeIdx > 0, `purchases: route decorator for ${methodName} not found`);
  assert.ok(
    source.slice(routeIdx, methodIdx).includes('@UseInterceptors(IdempotencyInterceptor)'),
    `purchases: ${methodName} is missing @UseInterceptors(IdempotencyInterceptor)`,
  );
}

function assertMethodNotAnnotated(source: string, methodName: string): void {
  const methodIdx = source.indexOf(`  ${methodName}(`);
  assert.ok(methodIdx > 0, `purchases: method ${methodName} not found`);
  const routeIdx = Math.max(
    source.lastIndexOf('@Post(', methodIdx),
    source.lastIndexOf('@Put(', methodIdx),
    source.lastIndexOf('@Patch(', methodIdx),
    source.lastIndexOf('@Delete(', methodIdx),
    source.lastIndexOf('@Get(', methodIdx),
  );
  assert.ok(routeIdx > 0, `purchases: route decorator for ${methodName} not found`);
  assert.ok(
    !source.slice(routeIdx, methodIdx).includes('@UseInterceptors(IdempotencyInterceptor)'),
    `purchases: ${methodName} must keep its single service-level reservation point (no interceptor)`,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms),
    ),
  ]);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    /* operation_executions, mirroring migration 2028000000007. */
    await db.schema
      .createTable('operation_executions')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(50)', (col) => col.notNull())
      .addColumn('account_id', 'varchar(50)', (col) => col.notNull())
      .addColumn('idempotency_key', 'varchar(100)', (col) => col.notNull())
      .addColumn('operation_type', 'varchar(50)', (col) => col.notNull())
      .addColumn('status', 'varchar(50)', (col) => col.notNull())
      .addColumn('request_hash', 'varchar(255)', (col) => col.notNull())
      .addColumn('document_id', 'varchar(100)')
      .addColumn('response_payload', 'text')
      .addColumn('error_code', 'varchar(100)')
      .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('completed_at', 'timestamp')
      .execute();
    await db.schema
      .createIndex('idx_operation_executions_unique')
      .on('operation_executions')
      .columns(['tenant_id', 'account_id', 'idempotency_key', 'operation_type'])
      .unique()
      .execute();
    /* Tiny stand-in for the stock side of receive-goods: one row per receipt. */
    await db.schema
      .createTable('spec_receipts')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('tenant_id', 'varchar(50)', (col) => col.notNull())
      .addColumn('product_id', 'integer', (col) => col.notNull())
      .addColumn('qty', 'numeric', (col) => col.notNull())
      .execute();

    const idempotency = new IdempotencyService(db as never);
    const interceptor = new IdempotencyInterceptor(idempotency);

    /* Faithful stand-in for receivePurchaseGoods: writes the receipt row. */
    const state = { calls: 0 };
    const receiveGoodsHandler = {
      handle: () =>
        defer(async () => {
          state.calls += 1;
          const inserted = await sql<{ id: number }>`
            INSERT INTO spec_receipts (tenant_id, product_id, qty)
            VALUES (${TENANT}, ${10}, ${5}) RETURNING id
          `.execute(db);
          return { ok: true, receiptId: Number(inserted.rows[0]?.id || 0), receivedQty: 5 };
        }),
    };
    const callThrough = (req: any, handler: any): Promise<any> =>
      lastValueFrom(interceptor.intercept(makeContext(req), handler) as any);

    const receiveBody = { receivedItems: [{ itemId: 7, receivedQty: 5 }] };
    const receiveParams = { id: '1' };

    // Case 1: retried receive-goods runs once.
    console.log('Case 1: same key + same body twice => one run, one receipt row');
    {
      const before = await receiptRowCount(db);
      const req = makeRequest({ key: 'r2-key-001', body: receiveBody, params: receiveParams });
      const res1 = await withTimeout(callThrough(req, receiveGoodsHandler), 60000, 'case 1 first call');
      const res2 = await withTimeout(callThrough(req, receiveGoodsHandler), 60000, 'case 1 retry');
      assert.deepEqual(res2, res1, '1: retry returns the identical cached response');
      assert.equal(state.calls, 1, '1: handler invoked exactly once');
      assert.equal(await receiptRowCount(db), before + 1, '1: exactly one receipt row written');
      assert.equal(await operationStatus(db, 'r2-key-001'), 'committed', '1: operation row committed');
      console.log(`  ✓ responses identical (receiptId ${res1.receiptId}), calls=1, rows+1, status=committed`);
    }

    // Case 2: same key, different payload is rejected loudly.
    console.log('Case 2: same key + different payload => 400');
    {
      const req = makeRequest({
        key: 'r2-key-001',
        body: { receivedItems: [{ itemId: 7, receivedQty: 9 }] },
        params: receiveParams,
      });
      let caught: any = null;
      try {
        await withTimeout(callThrough(req, receiveGoodsHandler), 60000, 'case 2');
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof AppError, '2: rejects with AppError');
      assert.equal(caught.code, 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD', '2: payload-mismatch code');
      console.log('  ✓ IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    }

    // Case 3: no key header => pass-through, handler runs every time.
    console.log('Case 3: no key header => pass-through (no behaviour change for keyless callers)');
    {
      const callsBefore = state.calls;
      const rowsBefore = await receiptRowCount(db);
      const req = makeRequest({ body: receiveBody, params: receiveParams });
      await withTimeout(callThrough(req, receiveGoodsHandler), 60000, 'case 3 first');
      await withTimeout(callThrough(req, receiveGoodsHandler), 60000, 'case 3 second');
      assert.equal(state.calls, callsBefore + 2, '3: handler runs on every keyless call');
      assert.equal(await receiptRowCount(db), rowsBefore + 2, '3: keyless calls are not deduped');
      console.log('  ✓ 2 keyless calls => 2 runs, 2 rows');
    }

    // Case 4: GET requests are skipped by the interceptor.
    console.log('Case 4: GET with a key => pass-through');
    {
      const callsBefore = state.calls;
      const req = makeRequest({ key: 'r2-key-get', method: 'GET', body: receiveBody, params: receiveParams });
      await withTimeout(callThrough(req, receiveGoodsHandler), 60000, 'case 4 first');
      await withTimeout(callThrough(req, receiveGoodsHandler), 60000, 'case 4 second');
      assert.equal(state.calls, callsBefore + 2, '4: GET is never reserved');
      assert.equal(await operationStatus(db, 'r2-key-get'), null, '4: no operation row for a GET');
      console.log('  ✓ 2 GETs => 2 runs, no operation row');
    }

    // Case 5: concurrent duplicate while processing => 409, work still runs once.
    console.log('Case 5: concurrent duplicate while processing => 409');
    {
      const callsBefore = state.calls;
      const rowsBefore = await receiptRowCount(db);
      const slowHandler = {
        handle: () =>
          timer(300).pipe(
            switchMap(() =>
              defer(async () => {
                state.calls += 1;
                const inserted = await sql<{ id: number }>`
                  INSERT INTO spec_receipts (tenant_id, product_id, qty)
                  VALUES (${TENANT}, ${10}, ${5}) RETURNING id
                `.execute(db);
                return { ok: true, receiptId: Number(inserted.rows[0]?.id || 0), receivedQty: 5 };
              }),
            ),
          ),
      };
      const req = makeRequest({ key: 'r2-key-005', body: receiveBody, params: receiveParams });
      const first = callThrough(req, slowHandler);
      const second = callThrough(req, slowHandler);
      const settled = await Promise.allSettled([first, second]);
      const fulfilled = settled.filter((r) => r.status === 'fulfilled');
      const rejected = settled.filter((r) => r.status === 'rejected');
      assert.equal(fulfilled.length, 1, '5: exactly one call succeeds');
      assert.equal(rejected.length, 1, '5: exactly one call is rejected');
      const reason: any = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(reason instanceof ConflictException, '5: rejection is a 409 ConflictException');
      assert.equal(reason.message, 'Operation is currently processing', '5: processing message');
      assert.equal(state.calls, callsBefore + 1, '5: work ran exactly once');
      assert.equal(await receiptRowCount(db), rowsBefore + 1, '5: exactly one receipt row');
      console.log('  ✓ one success + one 409, calls+1, rows+1');
    }

    // Case 6: CONTROL — the same handler without the interceptor double-applies.
    console.log('Case 6 (control): handler without the interceptor, twice => two rows (the gap)');
    {
      const rowsBefore = await receiptRowCount(db);
      const direct = async (): Promise<any> =>
        lastValueFrom(receiveGoodsHandler.handle() as any);
      await direct();
      await direct();
      assert.equal(await receiptRowCount(db), rowsBefore + 2, '6: without the interceptor the retry double-applies');
      console.log('  ✓ 2 direct runs => 2 rows (gap proven; the interceptor is what closes it)');
    }

    // Case 7: wiring pins on the two controllers.
    console.log('Case 7: wiring pins — interceptor present where the review says it must be');
    {
      const purchases = readFileSync(PURCHASES_CONTROLLER, 'utf8');
      assert.ok(
        purchases.includes("import { IdempotencyInterceptor } from '../../core/idempotency/idempotency.interceptor';"),
        '7a: purchases controller imports the interceptor',
      );
      assert.equal(
        countOccurrences(purchases, '@UseInterceptors(IdempotencyInterceptor)'),
        8,
        '7a: exactly 8 interceptor annotations on the purchases controller',
      );
      for (const method of [
        'generateDraftPurchaseOrders',
        'updatePurchase',
        'cancelPurchase',
        'receivePurchaseGoods',
        'createPurchasePaymentSchedule',
        'createSupplierPaymentSchedule',
        'applyPurchaseRepricing',
        'applyPurchaseLandedCosts',
      ]) {
        assertMethodAnnotated(purchases, method);
      }
      for (const method of [
        'createPurchase',
        'createSupplierPayment',
        'createCustomerPayment',
        'settleSupplierSchedule',
      ]) {
        assertMethodNotAnnotated(purchases, method);
      }
      const importSales = readFileSync(IMPORT_SALES_CONTROLLER, 'utf8');
      assert.ok(
        importSales.includes("import { IdempotencyInterceptor } from '../../core/idempotency/idempotency.interceptor';"),
        '7b: import-sales controller imports the interceptor',
      );
      assert.equal(
        countOccurrences(importSales, '@UseInterceptors(IdempotencyInterceptor)'),
        1,
        '7b: exactly one (class-wide) interceptor annotation on the import-sales controller',
      );
      const classIdx = importSales.indexOf('export class ImportSalesController');
      const controllerIdx = importSales.lastIndexOf('@Controller(', classIdx);
      assert.ok(
        importSales.slice(controllerIdx, classIdx).includes('@UseInterceptors(IdempotencyInterceptor)'),
        '7b: the single annotation sits on the class, above the class declaration',
      );
      console.log('  ✓ purchases: 8 annotated, 4 keyed endpoints unannotated; import-sales: 1 class-wide');
    }

    console.log('\nidempotency-coverage-r2: all cases passed');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (err) => {
    console.error(err);
    process.exitCode = 1;
  },
);
