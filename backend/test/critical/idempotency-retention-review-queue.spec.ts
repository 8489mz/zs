/*
 * INV-IDEMPOTENCY-RETENTION-REVIEW-QUEUE (D5 decision, user-approved
 * 2026-11-01): terminal idempotency rows are pruned after 30 days,
 * and stuck / recovery_required rows surface to a manual review
 * queue. No automatic retry, ever.
 *
 * WHAT THIS PINS, driving the REAL IdempotencyService on PGlite
 * against a real operation_executions table:
 * 1. Prune deletes ONLY committed/failed rows with completed_at at
 *    least 30 days old (31-day committed + 40-day failed go;
 *    29-day committed stays; NULL completed_at stays — unknown age
 *    is never pruned; a smaller requested retention is clamped up
 *    to 30 days).
 * 2. Prune NEVER deletes 'processing' or 'recovery_required' rows,
 *    however old — they are the review queue's input, and deleting
 *    them would destroy the only trace of an ambiguous operation.
 * 3. Prune and the review queue are tenant-scoped: another tenant's
 *    rows are untouched and invisible.
 * 4. The review queue returns stuck 'processing' rows (updated more
 *    than 60s ago, the same threshold reserveOperation and the
 *    status endpoint use) plus 'recovery_required' rows of any age,
 *    oldest first — and never a fresh 'processing' row.
 *
 * Deliberately NOT covered here: the HTTP endpoints (thin wrappers
 * over these two methods, same guards as the existing status
 * endpoint plus canManageSettings for the prune), and any scheduler
 * — none exists in this codebase, so the prune stays an explicit
 * staff action rather than a new background job.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { IdempotencyService } from '../../src/core/idempotency/idempotency.service';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ago = (ms: number): Date => new Date(NOW - ms);

async function seed(db: Kysely<Database>, rows: any[]): Promise<void> {
  for (const row of rows) {
    await db.insertInto('operation_executions').values(row).execute();
  }
}

async function remainingKeys(db: Kysely<Database>): Promise<string[]> {
  const rows = await db
    .selectFrom('operation_executions')
    .select(['idempotency_key'])
    .where('tenant_id', '=', 't1')
    .where('account_id', '=', 'a1')
    .orderBy('idempotency_key', 'asc')
    .execute();
  return rows.map((row) => row.idempotency_key);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE operation_executions (
        id bigserial PRIMARY KEY,
        tenant_id text NOT NULL,
        account_id text NOT NULL,
        idempotency_key text NOT NULL,
        operation_type text NOT NULL,
        status text NOT NULL,
        request_hash text NOT NULL,
        document_id text,
        response_payload text,
        error_code text,
        created_at timestamptz DEFAULT NOW(),
        updated_at timestamptz DEFAULT NOW(),
        completed_at timestamptz
      );
    `);
    const service = new IdempotencyService(db as never);

    await seed(db, [
      { tenant_id: 't1', account_id: 'a1', idempotency_key: 'old-committed', operation_type: 'POST:/sales', status: 'committed', request_hash: 'h', completed_at: ago(31 * DAY), updated_at: ago(31 * DAY) },
      { tenant_id: 't1', account_id: 'a1', idempotency_key: 'recent-committed', operation_type: 'POST:/sales', status: 'committed', request_hash: 'h', completed_at: ago(29 * DAY), updated_at: ago(29 * DAY) },
      { tenant_id: 't1', account_id: 'a1', idempotency_key: 'old-failed', operation_type: 'POST:/sales', status: 'failed', request_hash: 'h', completed_at: ago(40 * DAY), updated_at: ago(40 * DAY), error_code: 'E1' },
      { tenant_id: 't1', account_id: 'a1', idempotency_key: 'null-completed', operation_type: 'POST:/sales', status: 'failed', request_hash: 'h', completed_at: null, updated_at: ago(40 * DAY), error_code: 'E2' },
      { tenant_id: 't1', account_id: 'a1', idempotency_key: 'stuck-processing', operation_type: 'POST:/sales', status: 'processing', request_hash: 'h', completed_at: null, updated_at: ago(61 * 1000) },
      { tenant_id: 't1', account_id: 'a1', idempotency_key: 'old-processing', operation_type: 'POST:/sales', status: 'processing', request_hash: 'h', completed_at: null, updated_at: ago(40 * DAY) },
      { tenant_id: 't1', account_id: 'a1', idempotency_key: 'fresh-processing', operation_type: 'POST:/sales', status: 'processing', request_hash: 'h', completed_at: null, updated_at: ago(10 * 1000) },
      { tenant_id: 't1', account_id: 'a1', idempotency_key: 'recovery-old', operation_type: 'POST:/sales', status: 'recovery_required', request_hash: 'h', completed_at: ago(40 * DAY), updated_at: ago(5 * DAY), error_code: 'IDEMPOTENCY_FINALIZE_FAILED' },
      { tenant_id: 't2', account_id: 'a1', idempotency_key: 'other-tenant-old', operation_type: 'POST:/sales', status: 'committed', request_hash: 'h', completed_at: ago(40 * DAY), updated_at: ago(40 * DAY) },
    ]);

    // Review queue BEFORE the prune: stuck + recovery, oldest first, fresh processing excluded.
    const queue = await service.listOperationsNeedingReview({ tenantId: 't1', accountId: 'a1' });
    assert.deepEqual(
      queue.map((item) => item.idempotencyKey),
      ['old-processing', 'recovery-old', 'stuck-processing'],
      'queue must hold the old stuck row, the recovery row, and the 61s-stuck row, oldest first',
    );
    assert.ok(queue.every((item) => item.status === 'recovery_required'));
    const otherQueue = await service.listOperationsNeedingReview({ tenantId: 't2', accountId: 'a1' });
    assert.deepEqual(otherQueue, [], 'another tenant sees an empty queue');

    // Prune with a 1-day request: the 30-day floor must still apply (29-day row survives).
    const pruned = await service.pruneTerminalOperations({ tenantId: 't1', accountId: 'a1' }, 1);
    assert.equal(pruned.deleted, 2, 'only the 31-day committed and 40-day failed rows go');
    assert.deepEqual(await remainingKeys(db), [
      'fresh-processing',
      'null-completed',
      'old-processing',
      'recent-committed',
      'recovery-old',
      'stuck-processing',
    ]);
    const otherTenant = await db
      .selectFrom('operation_executions')
      .select(['idempotency_key'])
      .where('tenant_id', '=', 't2')
      .execute();
    assert.equal(otherTenant.length, 1, 'the other tenant row must survive');

    console.log('idempotency retention + review queue checks passed');
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
