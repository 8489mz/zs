import 'dotenv/config';
import { strict as assert } from 'node:assert';
import { performance } from 'node:perf_hooks';
import { Pool, type PoolClient } from 'pg';
import { resolveDatabaseConfigFromEnv } from '../../src/database/migration-runner';
import { resolvePgSslConfig } from '../../src/database/ssl.util';
import { canonicalLockIds } from '../../src/common/utils/canonical-lock-order';

/**
 * Default mode: self-contained concurrency contract over ten isolated tenant models.
 * Staging mode: shared-database contention smoke:
 * SCALE_TEST_ALLOW_DB=1 npx ts-node test/critical/multi-tenant-1000-scale.spec.ts
 *
 * Requires a migrated PostgreSQL database with sales belonging to at least ten tenants. Runs
 * 1,000 bounded real-table reads through a 20-connection pool and overlapping advisory locks
 * acquired in canonical order. It never writes business rows. This detects cross-tenant result
 * contamination, deadlocks, connection starvation and unexpectedly slow indexed reads; it does
 * not replace checkout/transfer write-path load tests.
 */
const TABLES = ['sales', 'stock_movements', 'journal_entries', 'audit_logs'] as const;
const WORKERS = 20;
const ROUNDS_PER_WORKER = 50;
const MAX_OPERATION_MS = 10_000;

async function oneOperation(
  pool: Pool,
  tenantId: string,
  tenantSlot: number,
  table: (typeof TABLES)[number],
): Promise<number> {
  const client: PoolClient = await pool.connect();
  const started = performance.now();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    // Two overlapping lock keys model multi-row contention without touching production data.
    // All workers acquire them in ascending order, regardless of tenant scheduling.
    const lockSlots = [tenantSlot, (tenantSlot + 1) % 10].sort((a, b) => a - b);
    for (const slot of lockSlots) {
      await client.query('SELECT pg_advisory_xact_lock(918271, $1)', [slot]);
    }
    const result = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM ${table} WHERE tenant_id = $1 ORDER BY id DESC LIMIT 10`,
      [tenantId],
    );
    assert.ok(result.rows.length <= 10, `${table} exceeded the response bound`);
    for (const row of result.rows) assert.equal(row.tenant_id, tenantId, `${table} returned another tenant's row`);
    await client.query('ROLLBACK');
    const elapsed = performance.now() - started;
    assert.ok(elapsed < MAX_OPERATION_MS, `${table} for ${tenantId} took ${Math.round(elapsed)} ms`);
    return elapsed;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  if (process.env.SCALE_TEST_ALLOW_DB !== '1') {
    throw new Error('Set SCALE_TEST_ALLOW_DB=1 and point DATABASE_* at a disposable, migrated staging database');
  }
  const config = resolveDatabaseConfigFromEnv();
  const pool = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.name,
    ssl: resolvePgSslConfig({
      enabled: config.ssl,
      rejectUnauthorized: config.sslRejectUnauthorized,
      caCert: config.sslCaCert,
    }),
    max: WORKERS,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    application_name: 'multi-tenant-1000-scale-spec',
  });
  try {
    const fixtures = await pool.query<{ id: string }>(`
      SELECT t.id FROM tenants AS t
      WHERE EXISTS (SELECT 1 FROM sales AS s WHERE s.tenant_id = t.id)
      ORDER BY t.id LIMIT 10
    `);
    assert.equal(fixtures.rows.length, 10, 'Staging database needs ten tenants with at least one sale each');
    const tenantIds = fixtures.rows.map((row) => String(row.id));
    const samples = await Promise.all(
      Array.from({ length: WORKERS }, async (_, worker) => {
        const times: number[] = [];
        for (let iteration = 0; iteration < ROUNDS_PER_WORKER; iteration += 1) {
          const round = worker * ROUNDS_PER_WORKER + iteration;
          const tenantSlot = round % tenantIds.length;
          const table = TABLES[Math.floor(round / tenantIds.length) % TABLES.length];
          times.push(await oneOperation(pool, tenantIds[tenantSlot], tenantSlot, table));
        }
        return times;
      }),
    );
    const times = samples.flat();
    assert.equal(times.length, 1000);
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    assert.ok(p95 < MAX_OPERATION_MS, `P95 ${Math.round(p95)} ms exceeded the limit`);
    process.stdout.write(
      `1000 tenant-scoped operations, 10 tenants, 20 workers: p95=${Math.round(p95)}ms, max=${Math.round(sorted.at(-1) || 0)}ms; no deadlocks or cross-tenant rows\n`,
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '40P01') throw new Error('Deadlock detected (SQLSTATE 40P01)', { cause: error });
    throw error;
  } finally {
    await pool.end();
  }
}

type MockAccount = 'receivable' | 'sales' | 'cash' | 'bank';
type MockJournal = {
  tenantId: string;
  lines: Array<{ account: MockAccount; debitCents: number; creditCents: number }>;
};
type MockTenant = {
  tenantId: string;
  stock: number;
  customerDebtCents: number;
  cashCents: number;
  bankCents: number;
  journals: MockJournal[];
};

/** Asynchronous row-lock model. Lock keys include the tenant, as DB row IDs do. */
class MockRowLocks {
  private readonly tails = new Map<string, Promise<void>>();

  async within(tenantId: string, ids: number[], work: () => Promise<void>): Promise<void> {
    const releases: Array<() => void> = [];
    try {
      for (const id of canonicalLockIds(ids)) {
        const key = `${tenantId}:${id}`;
        const previous = this.tails.get(key) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const tail = previous.then(() => gate);
        this.tails.set(key, tail);
        await previous;
        releases.push(() => {
          release();
          if (this.tails.get(key) === tail) this.tails.delete(key);
        });
      }
      await work();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }
}

async function runInMemoryConcurrencyContract(): Promise<void> {
  const tenantIds = Array.from({ length: 10 }, (_, index) => `tenant-${index + 1}`);
  const states = new Map<string, MockTenant>(
    tenantIds.map((tenantId) => [
      tenantId,
      {
        tenantId,
        stock: 100,
        customerDebtCents: 0,
        cashCents: 100_000,
        bankCents: 0,
        journals: [],
      },
    ]),
  );
  const locks = new MockRowLocks();
  const observed: string[] = [];
  const run = async () => {
    for (let round = 0; round < 100; round += 1) {
      await Promise.all(
        tenantIds.flatMap((tenantId) => {
          const state = states.get(tenantId)!;
          const sale = locks.within(tenantId, [200, 100], async () => {
            await Promise.resolve(); // allow requests from other cashiers to interleave
            assert.ok(state.stock > 0, 'Sale oversold stock');
            assert.ok(state.customerDebtCents + 100 <= 10_000, 'Sale exceeded customer credit');
            state.stock -= 1;
            state.customerDebtCents += 100;
            state.journals.push({
              tenantId,
              lines: [
                { account: 'receivable', debitCents: 100, creditCents: 0 },
                { account: 'sales', debitCents: 0, creditCents: 100 },
              ],
            });
          });
          const transfer = locks.within(tenantId, round % 2 ? [20, 10] : [10, 20], async () => {
            await Promise.resolve();
            if (round % 2) {
              assert.ok(state.bankCents >= 50, 'Transfer overdrew bank');
              state.bankCents -= 50;
              state.cashCents += 50;
            } else {
              assert.ok(state.cashCents >= 50, 'Transfer overdrew cash');
              state.cashCents -= 50;
              state.bankCents += 50;
            }
            state.journals.push({
              tenantId,
              lines:
                round % 2
                  ? [
                      { account: 'cash', debitCents: 50, creditCents: 0 },
                      { account: 'bank', debitCents: 0, creditCents: 50 },
                    ]
                  : [
                      { account: 'bank', debitCents: 50, creditCents: 0 },
                      { account: 'cash', debitCents: 0, creditCents: 50 },
                    ],
            });
          });
          const stockQuery = locks.within(tenantId, [100], async () => {
            const row = states.get(tenantId);
            assert.equal(row?.tenantId, tenantId, 'Cross-tenant stock query');
            assert.ok(row!.stock >= 0, 'Stock query observed a negative balance');
            observed.push(row!.tenantId);
          });
          return [sale, transfer, stockQuery];
        }),
      );
    }
  };
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(
          () => reject(Object.assign(new Error('Concurrency model deadlocked'), { code: '40P01' })),
          10_000,
        );
      }),
    ]);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
  assert.equal(observed.length, 1_000);
  for (const tenantId of tenantIds) {
    const state = states.get(tenantId)!;
    assert.equal(state.stock, 0);
    assert.equal(state.customerDebtCents, 10_000);
    assert.equal(state.cashCents, 100_000);
    assert.equal(state.bankCents, 0);
    assert.equal(state.journals.length, 200);
    assert.ok(
      state.journals.every((entry) => entry.tenantId === tenantId),
      'Cross-tenant journal leakage',
    );
    const lines = state.journals.flatMap((entry) => entry.lines);
    assert.ok(
      state.journals.every(
        (entry) => entry.lines.reduce((sum, line) => sum + line.debitCents - line.creditCents, 0) === 0,
      ),
      'Unbalanced journal',
    );
    assert.equal(
      lines.reduce((sum, line) => sum + line.debitCents - line.creditCents, 0),
      0,
    );
    const accountBalance = (account: MockAccount) =>
      lines
        .filter((line) => line.account === account)
        .reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
    assert.equal(accountBalance('receivable'), state.customerDebtCents);
    assert.equal(accountBalance('sales'), -state.customerDebtCents);
    assert.equal(accountBalance('cash'), state.cashCents - 100_000);
    assert.equal(accountBalance('bank'), state.bankCents);
  }
  process.stdout.write(
    'In-memory concurrency contract: 10 tenants, 1000 sales, 1000 transfers, 1000 stock reads; all ledgers balanced\n',
  );
}

void (process.env.SCALE_TEST_ALLOW_DB === '1' ? main() : runInMemoryConcurrencyContract()).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
