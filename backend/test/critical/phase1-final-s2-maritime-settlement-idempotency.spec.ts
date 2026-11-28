import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { ConflictException } from '@nestjs/common';
import { defer, lastValueFrom, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Database } from '../../src/database/database.types';
import { MaritimeFreightService } from '../../src/modules/maritime-freight/maritime-freight.service';
import { IdempotencyInterceptor } from '../../src/core/idempotency/idempotency.interceptor';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';
import { AppError } from '../../src/common/errors/app-error';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { migration } from '../../src/database/migrations/2040000000343_maritime_agent_settlement_reference_unique';

/*
 * Phase 1 final inspection, slice 2 — maritime agent-settlement
 * idempotency (INV-MARITIME-AGENT-SETTLEMENT-IDEMPOTENCY).
 *
 * THE GAP: createAgentSettlement inserted a settlement row
 * unconditionally — no key, no duplicate check, no unique index
 * on reference_number (the R2 review recorded it as a GAP,
 * record-only). A lost response + retry booked the same agent
 * settlement twice: the books showed two settlements for one
 * real settlement, and the agent statement of account summed
 * both.
 *
 * THE RULE, two halves in this package:
 * (1) The request key: POST agent-settlements carries
 * @UseInterceptors(IdempotencyInterceptor) (per-method, the R2
 * pattern — the controller's other mutating endpoints are
 * untouched). A retry with the same x-idempotency-key returns
 * the original response with no second row; the same key with
 * a different payload is rejected loudly. No header means
 * pass-through — zero behaviour change for today's keyless
 * callers (the frontend sends no keys today).
 * (2) The storage backstop: migration 0343 adds the unique
 * index uq_maritime_agent_settlements_tenant_reference on
 * (tenant_id, reference_number), with a loud duplicate
 * pre-check and a post-check. A duplicate supplied reference
 * with a different key fails loudly with 23505 instead of
 * landing silently.
 *
 * SCOPE DECISIONS (recorded): the only caller is the
 * MaritimeAgentsTab form (free-text optional reference); the
 * generated reference is unique by row id via
 * formatDailyDocumentNumber; no import, batch or system flow
 * reuses a reference — so a duplicate number is an error,
 * not a second document. The pre-check excludes NULL
 * references: Postgres unique indexes permit multiple NULLs,
 * while a GROUP BY would group NULLs together and refuse on
 * rows the index itself would accept. Frontend sending keys
 * is NOT part of this slice (a behaviour change; the user
 * must be told first) — so a keyless retry with NO supplied
 * reference still double-books, each retry generating a new
 * unique ref. That residual is recorded in the invariant, not
 * hidden: the key closes the keyed retry, the index closes
 * the supplied-reference retry.
 *
 * WHAT THIS PINS, driving the REAL interceptor + the REAL
 * service + the REAL facade on PGlite (EGP base tenant,
 * registered USD rate 48, supplied rate 48 so the FX
 * behaviour is slice 1's spec's job, not this one):
 * - §1: the keyed retry runs once — same key + same body
 *   twice returns the identical cached response, one
 *   handler invocation, one settlement row, operation
 *   'committed'; same key + different payload rejects
 *   IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD; no key
 *   passes through (two runs, two rows); a concurrent
 *   duplicate while processing gets 409 and the work runs
 *   once.
 * - §2: the unique backstop on the real service — a second
 *   create with the same supplied reference and a different
 *   key fails with 23505 and leaves one row (operation
 *   'failed'); the same reference under a different tenant
 *   succeeds; two generated references are distinct and
 *   match the daily-number shape.
 * - §3: the real migration 0343 on PGlite — up creates the
 *   index and is idempotent; a duplicate insert fails
 *   23505; down removes the guard (duplicate then lands);
 *   a final up restores it; up refuses loudly on
 *   pre-existing duplicates and leaves no index; two NULL
 *   rows do not block up.
 * - §4: CONTROL — the same handler without the interceptor
 *   double-applies (two rows): the gap the interceptor
 *   closes.
 * - §5: static pins — the controller annotation (exactly
 *   one, on createAgentSettlement), the migration file, the
 *   engine-map idempotency row.
 * - §6: the INV exists exactly once in
 *   ARCHITECTURE_INVARIANTS.md and exactly once in the
 *   guard tail.
 * - §7: wiring 408 in both lists, this spec last,
 *   all earlier specs re-pinned (counts, last-entry).
 * - §8: the re-pin sweep is complete (no stale count,
 *   last-entry or guard INV remains).
 * - §9: the guard re-pin list (every earlier spec's
 *   guard assertion points at the new INV).
 * - §10: boundary / frontend / baseline / write pins do
 *   not move (backend 740, delivery-reps->accounting
 *   109, frontend 105/44, baselines 57/152, writes 5)
 *   and the two "highest migration" pins re-point to 0343.
 *
 * PGlite HANG NOTE: the interceptor's reserve/finalize run
 * OUTSIDE the service transaction (reserve first, handler
 * second, finalize after the handler completes), so no pool
 * read happens inside an open transaction — the hang shape
 * the slice-1 log documents does not occur here. The
 * service's own transaction is opened by the service
 * itself, exactly as the rate-resolved spec drives it.
 *
 * Wiring: both critical lists carry 408 specs in identical
 * order, this spec last.
 */

const REPO_ROOT = path.join(__dirname, '../../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const BOUNDARY_SPEC = path.join(BACKEND, 'test', 'critical', 'module-boundary.spec.ts');
const FEATURE_BOUNDARY_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'feature-boundary.json');
const IMPORT_LAYER_BASELINE = path.join(FRONTEND, 'scripts', 'baselines', 'import-layer.json');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');
const GUARD_SPEC = path.join(BACKEND, 'test', 'critical', 'architecture-guard.spec.ts');
const ENGINE_MAP = path.join(REPO_ROOT, 'docs', 'ENGINE_MAP.md');
const CONTROLLER = path.join(BACKEND, 'src', 'modules', 'maritime-freight', 'maritime-freight.controller.ts');
const MIGRATIONS_DIR = path.join(BACKEND, 'src', 'database', 'migrations');
const MIGRATION_FILE = '2040000000345_import_fx_payout_idempotency_keys.ts';
const B1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b1-reports-sales.spec.ts');
const B2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b2-sales-settings.spec.ts');
const B3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b3-sales-storefront.spec.ts');
const B4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b4-accounting-hr.spec.ts');
const B5_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b5-accounting-manufacturing.spec.ts');
const B6_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b6-accounting-purchases.spec.ts');
const B7_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b7-returns-sales.spec.ts');
const B8_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-b8-delivery-reps-sales.spec.ts');
const F2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f2-feature-public-indices.spec.ts');
const F3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f3-feature-boundary-legs.spec.ts');
const F4_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f4-settings-access-door.spec.ts');
const F5A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5a-audit-settings.spec.ts');
const F5B_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5b-products-settings.spec.ts');
const F5C_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5c-accounts-purchases.spec.ts');
const F5D_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5d-maintenance-products.spec.ts');
const F5E_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5e-accounting-treasury.spec.ts');
const F5F_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5f-cash-drawer-pos.spec.ts');
const F5G_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5g-customers-sales.spec.ts');
const F5H_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-pos-sales.spec.ts');
const F5I_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5i-pos-settings.spec.ts');
const F5H_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-sales-envelope-check.spec.ts');
const F5J_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-inventory-products.spec.ts');
const F5H_REPAIR_2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5h-repair-2-dialog-spec-mock.spec.ts');
const F5K_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5k-pos-products.spec.ts');
const F5J_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5j-repair-expiry-spec-import.spec.ts');
const F5L_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-pos-storefront.spec.ts');
const F5L_REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-f5l-repair-bundle-budget.spec.ts');
const D_M1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m1-job-fields.spec.ts');
const D_M3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-m3-mail-nested.spec.ts');
const D_D10A_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-d-d10a-serials-payload.spec.ts');
const DISCOUNT_FIX_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-discount-fix-line-amount.spec.ts');
const CLEANUP_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-cleanup-as-any-reduction.spec.ts');
const P1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p1-frontend-lint.spec.ts');
const P2_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p2-dev-passcode.spec.ts');
const P3_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-p3-van-writer.spec.ts');
const REPAIR_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-eval-repair-type-imports.spec.ts');
const S1_SPEC = path.join(BACKEND, 'test', 'critical', 'phase1-final-s1-fx-maritime-close-asof.spec.ts');
const DEPOSIT_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'import-deposit-amount-3dp.spec.ts');
const VAN_TRANSFER_3DP_SPEC = path.join(BACKEND, 'test', 'critical', 'van-transfer-loaded-amount-3dp.spec.ts');
const CRITICAL_JSON = path.join(BACKEND, 'scripts', 'critical-specs.json');
const PACKAGE_JSON = path.join(BACKEND, 'package.json');
const WRITES_SPEC = path.join(BACKEND, 'test', 'critical', 'stock-movements-writes.spec.ts');
const WRITES_DOC = path.join(REPO_ROOT, 'docs', 'STOCK_MOVEMENTS_WRITES.md');

const NEW_INV = 'INV-MARITIME-AGENT-SETTLEMENT-IDEMPOTENCY';
const NEW_SPEC_NAME = 'phase1-final-s2-maritime-settlement-idempotency.spec.ts';

const TENANT = 't1';
const TENANT2 = 't2';
const ACCOUNT = 'a1';
const ROUTE_PATH = '/api/maritime-freight/agent-settlements';

const authFor = (tenantId: string): AuthContext =>
  ({ tenantId, accountId: ACCOUNT, role: 'admin', userId: 1, permissions: [] }) as unknown as AuthContext;

function makeRequest(opts: { key?: string; body?: Record<string, unknown>; tenantId?: string }): any {
  return {
    headers: opts.key ? { 'x-idempotency-key': opts.key } : {},
    authContext: { tenantId: opts.tenantId || TENANT, accountId: ACCOUNT },
    method: 'POST',
    route: { path: ROUTE_PATH },
    path: ROUTE_PATH,
    body: opts.body || {},
    params: {},
  };
}

function makeContext(req: any): any {
  return { switchToHttp: () => ({ getRequest: () => req }) };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms),
    ),
  ]);
}

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE currency_exchange_rates (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean);
    CREATE TABLE currency_exchange_rate_history (id bigserial PRIMARY KEY, tenant_id text, currency_code text, exchange_rate numeric, is_base boolean, effective_from timestamptz, created_at timestamptz);
    CREATE TABLE maritime_agent_settlements (id bigserial PRIMARY KEY, tenant_id text, agent_id text, agent_name text, job_id text, job_number text, settlement_type text, currency text, amount numeric, profit_share_percent numeric, local_equivalent_amount numeric, exchange_rate numeric, reference_number text, status text, notes text);
    CREATE TABLE operation_executions (id serial PRIMARY KEY, tenant_id varchar(50) NOT NULL, account_id varchar(50) NOT NULL, idempotency_key varchar(100) NOT NULL, operation_type varchar(50) NOT NULL, status varchar(50) NOT NULL, request_hash varchar(255) NOT NULL, document_id varchar(100), response_payload text, error_code varchar(100), created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at timestamp);
    CREATE UNIQUE INDEX idx_operation_executions_unique ON operation_executions (tenant_id, account_id, idempotency_key, operation_type);
    INSERT INTO settings VALUES ('t1','currency','EGP'), ('t2','currency','EGP');
    INSERT INTO currency_exchange_rates (tenant_id, currency_code, exchange_rate, is_base) VALUES ('t1','EGP',1,true),('t1','USD',48,false),('t2','EGP',1,true),('t2','USD',48,false);
    INSERT INTO currency_exchange_rate_history (tenant_id, currency_code, exchange_rate, is_base, effective_from) VALUES ('t1','EGP',1,true,'2020-01-01 00:00:00+00'),('t1','USD',48,false,'2020-01-01 00:00:00+00'),('t2','EGP',1,true,'2020-01-01 00:00:00+00'),('t2','USD',48,false,'2020-01-01 00:00:00+00');
  `);
  return { pg, db };
}

async function settlementCount(db: Kysely<Database>, tenantId = TENANT): Promise<number> {
  const row = await sql<{ n: string }>`
    SELECT COUNT(*)::text AS n FROM maritime_agent_settlements WHERE tenant_id = ${tenantId}
  `.execute(db);
  return Number(row.rows[0]?.n || 0);
}

async function operationStatus(db: Kysely<Database>, key: string): Promise<string | null> {
  const row = await sql<{ status: string }>`
    SELECT status FROM operation_executions
    WHERE tenant_id = ${TENANT} AND account_id = ${ACCOUNT} AND idempotency_key = ${key}
  `.execute(db);
  return row.rows[0]?.status || null;
}

async function indexCount(db: Kysely<Database>): Promise<number> {
  const rows = await sql<{ n: string }>`
    SELECT COUNT(*) AS n FROM pg_indexes
    WHERE indexname = 'uq_maritime_agent_settlements_tenant_reference'
  `.execute(db);
  return Number(rows.rows[0]?.n ?? 0);
}

const baseDto = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  agentName: 'Agent',
  settlementType: 'debit_note',
  amount: 100,
  currency: 'USD',
  exchangeRate: 48,
  referenceNumber: 'REF-001',
  ...overrides,
});

async function main(): Promise<void> {
  // §1: the keyed retry runs once — real interceptor + real
  // service + real facade.
  {
    const { pg, db } = await makeDb();
    try {
      await migration.up(db as any);
      const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);
      const idempotency = new IdempotencyService(db as never);
      const interceptor = new IdempotencyInterceptor(idempotency);
      const auth = authFor(TENANT);
      const state = { calls: 0 };
      const handlerFor = (dto: Record<string, unknown>) => ({
        handle: () =>
          defer(async () => {
            state.calls += 1;
            return service.createAgentSettlement(auth, dto as never);
          }),
      });
      const callThrough = (req: any, handler: any): Promise<any> =>
        lastValueFrom(interceptor.intercept(makeContext(req), handler) as any);

      // Case 1a: same key + same body twice => one run, one row,
      // identical cached response, operation committed.
      console.log('Case 1a: same key + same body twice => one run, one row, identical response');
      {
        const dto = baseDto();
        const req = makeRequest({ key: 's2-key-001', body: dto });
        const res1 = await withTimeout(callThrough(req, handlerFor(dto)), 60000, 'case 1a first call');
        const res2 = await withTimeout(callThrough(req, handlerFor(dto)), 60000, 'case 1a retry');
        // The cache stores JSON, so the retry is compared against
        // the JSON round-trip of the first response (timestamptz
        // columns would come back as strings, not Dates).
        assert.deepEqual(res2, JSON.parse(JSON.stringify(res1)), '1a: retry returns the identical cached response');
        assert.equal(res2.reference_number, 'REF-001', '1a: cached response is the same settlement');
        assert.equal(state.calls, 1, '1a: handler invoked exactly once');
        assert.equal(await settlementCount(db), 1, '1a: exactly one settlement row written');
        assert.equal(await operationStatus(db, 's2-key-001'), 'committed', '1a: operation row committed');
        console.log(`  ✓ responses identical (settlement ${res1.id}), calls=1, rows=1, status=committed`);
      }

      // Case 1b: same key, different payload is rejected loudly.
      console.log('Case 1b: same key + different payload => AppError');
      {
        const dto = baseDto({ amount: 200 });
        const req = makeRequest({ key: 's2-key-001', body: dto });
        let caught: any = null;
        try {
          await withTimeout(callThrough(req, handlerFor(dto)), 60000, 'case 1b');
        } catch (err) {
          caught = err;
        }
        assert.ok(caught instanceof AppError, '1b: rejects with AppError');
        assert.equal(caught.code, 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD', '1b: payload-mismatch code');
        assert.equal(await settlementCount(db), 1, '1b: no second row from the rejected retry');
        console.log('  ✓ IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
      }

      // Case 1c: no key header => pass-through (no behaviour
      // change for keyless callers). Generated references keep
      // the two rows distinct under the unique index.
      console.log('Case 1c: no key header => pass-through (two runs, two rows)');
      {
        const callsBefore = state.calls;
        const rowsBefore = await settlementCount(db);
        const dto = baseDto({ referenceNumber: undefined });
        delete (dto as any).referenceNumber;
        const req = makeRequest({ body: dto });
        await withTimeout(callThrough(req, handlerFor(dto)), 60000, 'case 1c first');
        await withTimeout(callThrough(req, handlerFor(dto)), 60000, 'case 1c second');
        assert.equal(state.calls, callsBefore + 2, '1c: handler runs on every keyless call');
        assert.equal(await settlementCount(db), rowsBefore + 2, '1c: keyless calls are not deduped');
        console.log('  ✓ 2 keyless calls => 2 runs, 2 rows');
      }

      // Case 1d: concurrent duplicate while processing => 409,
      // work still runs once.
      console.log('Case 1d: concurrent duplicate while processing => 409');
      {
        const callsBefore = state.calls;
        const rowsBefore = await settlementCount(db);
        const dto = baseDto({ referenceNumber: 'REF-SLOW-001' });
        const slowHandler = {
          handle: () =>
            timer(300).pipe(
              switchMap(() =>
                defer(async () => {
                  state.calls += 1;
                  return service.createAgentSettlement(auth, dto as never);
                }),
              ),
            ),
        };
        const req = makeRequest({ key: 's2-key-004', body: dto });
        const first = callThrough(req, slowHandler);
        const second = callThrough(req, slowHandler);
        const settled = await Promise.allSettled([first, second]);
        const fulfilled = settled.filter((r) => r.status === 'fulfilled');
        const rejected = settled.filter((r) => r.status === 'rejected');
        assert.equal(fulfilled.length, 1, '1d: exactly one call succeeds');
        assert.equal(rejected.length, 1, '1d: exactly one call is rejected');
        const reason: any = (rejected[0] as PromiseRejectedResult).reason;
        assert.ok(reason instanceof ConflictException, '1d: rejection is a 409 ConflictException');
        assert.equal(reason.message, 'Operation is currently processing', '1d: processing message');
        assert.equal(state.calls, callsBefore + 1, '1d: work ran exactly once');
        assert.equal(await settlementCount(db), rowsBefore + 1, '1d: exactly one settlement row');
        console.log('  ✓ one success + one 409, calls+1, rows+1');
      }
    } finally {
      await db.destroy();
    }
  }

  // §2: the unique backstop on the real service — a duplicate
  // supplied reference with a different key fails loudly.
  {
    const { pg, db } = await makeDb();
    try {
      await migration.up(db as any);
      const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);
      const idempotency = new IdempotencyService(db as never);
      const interceptor = new IdempotencyInterceptor(idempotency);
      const auth = authFor(TENANT);
      const callThrough = (req: any, handler: any): Promise<any> =>
        lastValueFrom(interceptor.intercept(makeContext(req), handler) as any);

      console.log('Case 2a: duplicate supplied reference, different key => 23505, one row');
      {
        const dto = baseDto({ referenceNumber: 'REF-DUP-001' });
        const first = await withTimeout(
          callThrough(makeRequest({ key: 's2-key-010', body: dto }), {
            handle: () => defer(async () => service.createAgentSettlement(auth, dto as never)),
          }),
          60000,
          'case 2a first call',
        );
        assert.equal(first.reference_number, 'REF-DUP-001', '2a: first create books the reference');
        assert.equal(await settlementCount(db), 1, '2a: one row after the first create');
        let caught: any = null;
        try {
          await withTimeout(
            callThrough(makeRequest({ key: 's2-key-011', body: dto }), {
              handle: () => defer(async () => service.createAgentSettlement(auth, dto as never)),
            }),
            60000,
            'case 2a retry with a different key',
          );
        } catch (err) {
          caught = err;
        }
        assert.ok(caught, '2a: the duplicate reference must fail');
        assert.equal(caught.code, '23505', '2a: duplicate fails with a unique-violation 23505');
        assert.equal(await settlementCount(db), 1, '2a: still exactly one row');
        assert.equal(await operationStatus(db, 's2-key-011'), 'failed', '2a: the failed operation is recorded');
        console.log('  ✓ 23505, rows=1, operation failed');
      }

      console.log('Case 2b: same reference under a different tenant succeeds');
      {
        const dto = baseDto({ referenceNumber: 'REF-DUP-001' });
        const other = await service.createAgentSettlement(authFor(TENANT2), dto as never);
        assert.equal(other.reference_number, 'REF-DUP-001', '2b: the reference is tenant-scoped');
        assert.equal(await settlementCount(db, TENANT2), 1, '2b: one row under the second tenant');
        assert.equal(await settlementCount(db, TENANT), 1, '2b: the first tenant still holds one row');
        console.log('  ✓ tenant scoping kept');
      }

      console.log('Case 2c: two generated references are distinct and daily-numbered');
      {
        const first = await service.createAgentSettlement(auth, baseDto({ referenceNumber: undefined }) as never);
        const second = await service.createAgentSettlement(auth, baseDto({ referenceNumber: undefined }) as never);
        assert.ok(
          /^(APS|ADN|ACN)-\d{6}-\d{4}$/.test(String(first.reference_number)),
          '2c: generated reference follows PREFIX-YYMMDD-XXXX (ADN for a debit note)',
        );
        assert.ok(
          /^(APS|ADN|ACN)-\d{6}-\d{4}$/.test(String(second.reference_number)),
          '2c: generated reference follows PREFIX-YYMMDD-XXXX (ADN for a debit note)',
        );
        assert.notEqual(
          first.reference_number,
          second.reference_number,
          '2c: two generated references must differ (row-id suffix)',
        );
        console.log(`  ✓ ${first.reference_number} vs ${second.reference_number}`);
      }
    } finally {
      await db.destroy();
    }
  }

  // §3: the real migration 0343 on PGlite — up / down /
  // pre-check / NULL rows (the 0297 spec's shape).
  async function makeMigrationDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    await pg.exec(`
      CREATE TABLE maritime_agent_settlements (id bigserial PRIMARY KEY, tenant_id text NOT NULL, reference_number text);
    `);
    return { pg, db };
  }
  async function insertSettlement(db: any, tenant: string, ref: string | null): Promise<void> {
    await db.insertInto('maritime_agent_settlements').values({ tenant_id: tenant, reference_number: ref }).execute();
  }
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 3a: up() creates the index and is idempotent');
      await migration.up(db as any);
      assert.equal(await indexCount(db), 1, 'up() must create the unique index');
      await migration.up(db as any);
      assert.equal(await indexCount(db), 1, 'up() must be idempotent (up -> up keeps exactly one index)');
      console.log('  ✓ index created once, up -> up stable');
    } finally {
      await db.destroy();
    }
  }
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 3b: duplicate reference fails 23505; tenant scoping kept');
      await migration.up(db as any);
      await insertSettlement(db, 't1', 'REF-261128-0001');
      await assert.rejects(
        async () => insertSettlement(db, 't1', 'REF-261128-0001'),
        (err: any) => err?.code === '23505',
        'A duplicate reference for the same tenant must fail with 23505',
      );
      await insertSettlement(db, 't2', 'REF-261128-0001');
      await insertSettlement(db, 't1', 'REF-261128-0002');
      const n = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM maritime_agent_settlements`.execute(db);
      assert.equal(Number(n.rows[0].n), 3, 'Three rows must exist (t1 x2, t2 x1)');
      console.log('  ✓ 23505 on duplicate, other tenant and other number fine');
    } finally {
      await db.destroy();
    }
  }
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 3c: down() removes the guard — duplicate then lands (fail-without-fix sensitivity)');
      await migration.up(db as any);
      await insertSettlement(db, 't1', 'REF-261128-0001');
      await assert.rejects(
        async () => insertSettlement(db, 't1', 'REF-261128-0001'),
        (err: any) => err?.code === '23505',
        'Duplicate must fail while the index exists',
      );
      await migration.down(db as any);
      assert.equal(await indexCount(db), 0, 'down() must remove the index');
      await insertSettlement(db, 't1', 'REF-261128-0001');
      const n = await sql<{ n: string }>`
        SELECT COUNT(*) AS n FROM maritime_agent_settlements WHERE reference_number = 'REF-261128-0001'
      `.execute(db);
      assert.equal(Number(n.rows[0].n), 2, 'Without the index the duplicate lands silently (the defect)');
      // Remove the duplicate this case itself created so the final
      // up() can succeed (test teardown only — no production row).
      const dupes: any[] = await (db as any)
        .selectFrom('maritime_agent_settlements')
        .select(['id'])
        .where('reference_number', '=', 'REF-261128-0001')
        .orderBy('id', 'desc')
        .execute();
      await (db as any).deleteFrom('maritime_agent_settlements').where('id', '=', Number(dupes[0].id)).execute();
      await migration.up(db as any);
      assert.equal(await indexCount(db), 1, 'A final up() must restore the index');
      console.log('  ✓ down drops the guard, up restores it');
    } finally {
      await db.destroy();
    }
  }
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 3d: up() refuses loudly on pre-existing duplicates and leaves no index');
      await insertSettlement(db, 't1', 'REF-261128-0001');
      await insertSettlement(db, 't1', 'REF-261128-0001');
      await assert.rejects(
        async () => migration.up(db as any),
        /maritime agent-settlement reference backstop refused: maritime_agent_settlements already holds 1 duplicate/,
        'up() must refuse loudly on pre-existing duplicates, naming the table',
      );
      assert.equal(await indexCount(db), 0, 'A refused up() must leave no index behind');
      console.log('  ✓ loud refusal, no index created');
    } finally {
      await db.destroy();
    }
  }
  {
    const { pg, db } = await makeMigrationDb();
    try {
      console.log('Case 3e: two NULL references do not block up() (unique indexes permit multiple NULLs)');
      await insertSettlement(db, 't1', null);
      await insertSettlement(db, 't1', null);
      await migration.up(db as any);
      assert.equal(await indexCount(db), 1, 'up() must succeed with legacy NULL references present');
      console.log('  ✓ NULL rows are not duplicates');
    } finally {
      await db.destroy();
    }
  }

  // §4: CONTROL — the same handler without the interceptor
  // double-applies (two rows): the gap the interceptor closes.
  // Generated references keep the two rows distinct under the
  // unique index, so the control isolates the interceptor.
  {
    const { pg, db } = await makeDb();
    try {
      await migration.up(db as any);
      const service = new MaritimeFreightService(db, {} as never, {} as never, {} as never);
      const auth = authFor(TENANT);
      console.log('Case 4 (control): direct calls without the interceptor, twice => two rows (the gap)');
      const rowsBefore = await settlementCount(db);
      const dto = baseDto({ referenceNumber: undefined });
      delete (dto as any).referenceNumber;
      await service.createAgentSettlement(auth, dto as never);
      await service.createAgentSettlement(auth, dto as never);
      assert.equal(await settlementCount(db), rowsBefore + 2, '4: without the interceptor the retry double-applies');
      console.log('  ✓ 2 direct runs => 2 rows (gap proven; the interceptor is what closes it)');
    } finally {
      await db.destroy();
    }
  }

  // §5: static pins — the controller annotation (exactly one,
  // on createAgentSettlement), the migration file, the
  // engine-map idempotency row.
  {
    const controller = fs.readFileSync(CONTROLLER, 'utf8');
    assert.ok(
      controller.includes("import { IdempotencyInterceptor } from '../../core/idempotency/idempotency.interceptor';"),
      'the controller must import the interceptor',
    );
    assert.equal(
      (controller.match(/@UseInterceptors\(IdempotencyInterceptor\)/g) || []).length,
      1,
      'exactly one interceptor annotation on the maritime-freight controller',
    );
    const methodIdx = controller.indexOf('createAgentSettlement(');
    assert.ok(methodIdx > 0, 'createAgentSettlement must exist on the controller');
    const routeIdx = controller.lastIndexOf("@Post('agent-settlements')", methodIdx);
    assert.ok(routeIdx > 0, 'the agent-settlements route decorator must precede the method');
    assert.ok(
      controller.slice(routeIdx, methodIdx).includes('@UseInterceptors(IdempotencyInterceptor)'),
      'the single annotation must sit on createAgentSettlement, between its route and the method',
    );
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts'))
      .sort();
    assert.ok(files.includes(MIGRATION_FILE), 'the 0345 migration file must exist in the migrations directory');
    assert.equal(
      files[files.length - 1],
      MIGRATION_FILE,
      'the 0345 migration must be the highest-numbered migration on disk',
    );
    const engineMap = fs.readFileSync(ENGINE_MAP, 'utf8');
    assert.ok(engineMap.includes(NEW_INV), 'the engine-map idempotency row must cite the new INV');
    assert.ok(
      engineMap.includes('unique (tenant_id, reference_number)'),
      'the engine-map idempotency row must state the unique backstop',
    );
    assert.ok(
      engineMap.includes('maritime-freight createAgentSettlement (1 method'),
      'the engine-map idempotency row must list the new interceptor coverage',
    );
    console.log('  ✓ controller annotation x1 on createAgentSettlement, migration 0345 highest, engine-map row');
  }

  // §6: The INV entry exists exactly once in both places (never
  // quote another INV id literally).
  {
    const invariants = fs.readFileSync(INVARIANTS, 'utf8');
    const invCount = (invariants.match(new RegExp(NEW_INV, 'g')) || []).length;
    assert.equal(invCount, 1, 'ARCHITECTURE_INVARIANTS.md must carry the new INV exactly once');
    const guard = fs.readFileSync(GUARD_SPEC, 'utf8');
    const guardCount = (guard.match(/INV-MODULE-DOCUMENTATION-S10/g) || []).length;
    assert.equal(guardCount, 1, 'architecture-guard.spec.ts must carry the new INV exactly once');
  }

  // §7: Wiring: both critical lists carry 408 specs in identical
  // order, this spec last.
  {
    const specsJson = JSON.parse(fs.readFileSync(CRITICAL_JSON, 'utf8')) as { specs: string[] };
    const specs = specsJson.specs;
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: { 'test:critical:serial': string };
    };
    const chain = pkg.scripts['test:critical:serial']
      .split('&&')
      .map((part) => part.trim().replace(/^ts-node\s+/, ''))
      .filter((part) => part.endsWith('.spec.ts'));
    assert.equal(specs.length, 426);
    assert.equal(chain.length, 426);
    assert.deepEqual(specs, chain, 'critical-specs.json and the serial chain must list the same 408 specs in order');
    assert.equal(specs[specs.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts');
    assert.equal(chain[chain.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts');
    for (const [label, specPath] of [
      ['B1', B1_SPEC],
      ['B2', B2_SPEC],
      ['B3', B3_SPEC],
      ['B4', B4_SPEC],
      ['B5', B5_SPEC],
      ['B6', B6_SPEC],
      ['B7', B7_SPEC],
      ['B8', B8_SPEC],
      ['F2', F2_SPEC],
      ['F3', F3_SPEC],
      ['F4', F4_SPEC],
      ['F5a', F5A_SPEC],
      ['F5b', F5B_SPEC],
      ['F5c', F5C_SPEC],
      ['F5d', F5D_SPEC],
      ['F5e', F5E_SPEC],
      ['F5f', F5F_SPEC],
      ['F5g', F5G_SPEC],
      ['F5h', F5H_SPEC],
      ['F5i', F5I_SPEC],
      ['F5h-REPAIR', F5H_REPAIR_SPEC],
      ['F5j', F5J_SPEC],
      ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
      ['F5k', F5K_SPEC],
      ['F5j-REPAIR', F5J_REPAIR_SPEC],
      ['F5l', F5L_SPEC],
      ['F5l-REPAIR', F5L_REPAIR_SPEC],
      ['D-M1', D_M1_SPEC],
      ['D-M3', D_M3_SPEC],
      ['D-D10a', D_D10A_SPEC],
      ['discount-fix', DISCOUNT_FIX_SPEC],
      ['cleanup', CLEANUP_SPEC],
      ['P1', P1_SPEC],
      ['P2', P2_SPEC],
      ['P3', P3_SPEC],
      ['repair', REPAIR_SPEC],
      ['S1', S1_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('assert.equal(specs.length, 426);') && src.includes('assert.equal(chain.length, 426);'),
        `${label} spec wiring must re-pin to 408`,
      );
      assert.ok(
        src.includes("specs[specs.length - 1], 'test/critical/phase1-final-s10-module-documentation.spec.ts'"),
        `${label} spec last-entry must re-pin to the new spec`,
      );
    }
  }

  // §8: The wiring re-pin sweep is complete: no critical spec
  // may still pin the old count, point its last-entry at the
  // slice-1 spec, or pin the old guard INV. (The patterns below
  // are built by concatenation so this block's own source never
  // contains the patterns it scans for.)
  {
    const staleCount: string[] = [];
    const staleLastEntry: string[] = [];
    const staleGuard: string[] = [];
    const prevName = 'phase1-final-s1-fx-maritime-close-' + 'asof.spec.ts';
    const prevInv = 'INV-FX-MARITIME-CLOSE-' + 'ASOF';
    const staleSpecs = 'specs.length, 40' + '7';
    const staleChain = 'chain.length, 40' + '7';
    const staleList = 'list.length, 40' + '7';
    for (const file of fs.readdirSync(path.join(BACKEND, 'test', 'critical'))) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = fs.readFileSync(path.join(BACKEND, 'test', 'critical', file), 'utf8');
      if (src.includes(staleSpecs) || src.includes(staleChain) || src.includes(staleList)) staleCount.push(file);
      if (src.includes(`specs[specs.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`chain[chain.length - 1], 'test/critical/${prevName}'`)) staleLastEntry.push(file);
      if (src.includes(`guard.match(/${prevInv}/g)`)) staleGuard.push(file);
    }
    assert.deepEqual(staleCount, [], 'no critical spec may still pin the old wiring count (407)');
    assert.deepEqual(staleLastEntry, [], 'no critical spec may still point its last-entry at the slice-1 spec');
    assert.deepEqual(staleGuard, [], 'no critical spec may still pin the old guard INV (slice 1)');
  }

  // §9: The guard tail holds ONLY the newest id, so this package
  // re-pins the B3/B4/B5/B6/B7/B8/F2/F3/F4/F5a/F5b/F5c/F5d/F5e/
  // F5f/F5g/F5h/F5i/F5h-REPAIR/F5j/F5h-REPAIR-2/F5k/F5j-REPAIR/
  // F5l/F5l-REPAIR/D-M1/D-M3/D-D10a/discount-fix/cleanup/P1/P2/
  // P3/repair/S1 specs' guard assertions to the new INV; their
  // invariants-file assertions still pin their own id (each line
  // stays in ARCHITECTURE_INVARIANTS.md exactly once).
  {
    for (const [label, specPath] of [
      ['B3', B3_SPEC],
      ['B4', B4_SPEC],
      ['B5', B5_SPEC],
      ['B6', B6_SPEC],
      ['B7', B7_SPEC],
      ['B8', B8_SPEC],
      ['F2', F2_SPEC],
      ['F3', F3_SPEC],
      ['F4', F4_SPEC],
      ['F5a', F5A_SPEC],
      ['F5b', F5B_SPEC],
      ['F5c', F5C_SPEC],
      ['F5d', F5D_SPEC],
      ['F5e', F5E_SPEC],
      ['F5f', F5F_SPEC],
      ['F5g', F5G_SPEC],
      ['F5h', F5H_SPEC],
      ['F5i', F5I_SPEC],
      ['F5h-REPAIR', F5H_REPAIR_SPEC],
      ['F5j', F5J_SPEC],
      ['F5h-REPAIR-2', F5H_REPAIR_2_SPEC],
      ['F5k', F5K_SPEC],
      ['F5j-REPAIR', F5J_REPAIR_SPEC],
      ['F5l', F5L_SPEC],
      ['F5l-REPAIR', F5L_REPAIR_SPEC],
      ['D-M1', D_M1_SPEC],
      ['D-M3', D_M3_SPEC],
      ['D-D10a', D_D10A_SPEC],
      ['discount-fix', DISCOUNT_FIX_SPEC],
      ['cleanup', CLEANUP_SPEC],
      ['P1', P1_SPEC],
      ['P2', P2_SPEC],
      ['P3', P3_SPEC],
      ['repair', REPAIR_SPEC],
      ['S1', S1_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes('guard.match(/INV-MODULE-DOCUMENTATION-S10/g)'),
        `${label} spec guard assertion must re-pin to the new INV`,
      );
    }
  }

  // §10: The module-boundary pins do not move in this package
  // (the controller gains one import from core/idempotency,
  // and core imports carry no module edge — the controller
  // already imports from core/auth — so no edge and no total
  // moves). The two "highest migration" pins re-point to 0343
  // because this package's migration is the highest on disk.
  {
    const boundary = fs.readFileSync(BOUNDARY_SPEC, 'utf8');
    assert.ok(
      boundary.includes('const PINNED_BACKEND_TOTAL = 740;'),
      'module-boundary must still pin the backend total 740',
    );
    assert.ok(
      boundary.includes("'delivery-reps->accounting': 109,"),
      'module-boundary must still pin delivery-reps->accounting 109',
    );
    assert.ok(
      boundary.includes('const PINNED_FRONTEND_TOTAL = 105;'),
      'module-boundary must still pin the frontend total 105',
    );
    assert.ok(
      boundary.includes('Object.keys(PINNED_BACKEND_EDGES).length, 63,'),
      'module-boundary must still pin 63 backend edges',
    );
    assert.ok(
      boundary.includes('Object.keys(PINNED_FRONTEND_EDGES).length, 44,'),
      'module-boundary must still pin 44 frontend edges',
    );
    assert.ok(
      boundary.includes('const FRONTEND_EDGE_FLOOR = 44;'),
      'module-boundary must still pin the frontend edge floor 44',
    );
    assert.ok(
      boundary.includes('const PINNED_FRONTEND_BIDIRECTIONAL_PAIRS: string[] = [];'),
      'the frontend bidirectional pair list must stay empty',
    );
    const featureBaseline = JSON.parse(fs.readFileSync(FEATURE_BOUNDARY_BASELINE, 'utf8')) as string[];
    assert.equal(featureBaseline.length, 57, 'feature-boundary baseline must stay exactly 57');
    const importBaseline = JSON.parse(fs.readFileSync(IMPORT_LAYER_BASELINE, 'utf8')) as string[];
    assert.equal(importBaseline.length, 152, 'import-layer baseline must stay exactly 152');
    const writesSpec = fs.readFileSync(WRITES_SPEC, 'utf8');
    const writesDoc = fs.readFileSync(WRITES_DOC, 'utf8');
    assert.ok(
      writesSpec.includes('const PINNED_WRITE_COUNT = 5;'),
      'stock-movements-writes must pin the write count 5',
    );
    assert.ok(writesDoc.includes('Total business writes: **5**'), 'the writes doc must state the total 5');
    for (const [label, specPath] of [
      ['deposit-3dp', DEPOSIT_3DP_SPEC],
      ['van-transfer-3dp', VAN_TRANSFER_3DP_SPEC],
    ] as const) {
      const src = fs.readFileSync(specPath, 'utf8');
      assert.ok(
        src.includes(`const HIGHEST_MIGRATION_FILE = '${MIGRATION_FILE}';`),
        `${label} spec highest-migration pin must re-point to 0345`,
      );
      assert.ok(
        src.includes('the 0345 migration must be the highest-numbered migration on disk'),
        `${label} spec highest-migration message must re-point to 0345`,
      );
    }
  }

  console.log('phase1 final slice 2 checks passed (maritime agent-settlement idempotency, 408 specs wired)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
