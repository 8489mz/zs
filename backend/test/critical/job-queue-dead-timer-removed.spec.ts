/*
 * INV-JOB-QUEUE-DEAD-TIMER-REMOVED: the dead JobQueueService 1s timer is gone.
 *
 * Grounding (verified in code at HEAD 35cdf065c, not assumed):
 *  - backend/src/common/queue/job-queue.service.ts ran setInterval(1000ms)
 *    in onModuleInit, ticking processNextBatch() over an in-memory Map.
 *  - The Map was ALWAYS empty in production: zero callers. No service in
 *    backend/src injected JobQueueService, no code called enqueue /
 *    registerHandler / getJob / listJobs, and no handler was ever
 *    registered. The only "caller" was backend/test/new-features-audit.spec.ts,
 *    an unwired standalone audit script (in no spec list, no package.json
 *    script, no workflow) that constructed the service manually with `new`.
 *  - The module WAS registered (@Global JobQueueModule, imported in
 *    app.module.ts), so the timer really did tick once a second for the
 *    whole life of the process — doing nothing observable on each tick.
 *  - No wiring target exists: every other background timer in backend/src
 *    (auth-cache sweep, db-maintenance, accounting recovery, schedulers)
 *    is self-contained with real work and none enqueues into JobQueueService;
 *    there is no BullMQ / cron library and no TODO naming a queued-job
 *    consumer. Wiring would have invented a consumer, so the service was
 *    REMOVED, not wired.
 *
 * This spec pins the removal, so the dead timer cannot silently return:
 *  - the backend/src/common/queue directory is gone (service + module);
 *  - no JobQueueService / JobQueueModule / job-queue / processNextBatch /
 *    registerHandler string remains anywhere under backend/src
 *    (the walk is proven to actually scan by a positive control: it must
 *    find 'AppModule' in backend/src before any absence is asserted);
 *  - app.module.ts no longer imports the module;
 *  - the audit script no longer imports or drives the service (its ZATCA
 *    and POS-terminal sections are untouched and still run);
 *  - INV-JOB-QUEUE-DEAD-TIMER-REMOVED appears exactly once in
 *    ARCHITECTURE_INVARIANTS.md (presence only — the architecture-guard
 *    spec owns the last-line tail assertion).
 *
 * Fail-first: run on the unpatched tree this spec exits 1 (the service
 * file exists and the strings are present in backend/src); after the
 * removal it exits 0.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const BACKEND_SRC = path.join(REPO_ROOT, 'backend', 'src');
const QUEUE_DIR = path.join(BACKEND_SRC, 'common', 'queue');
const APP_MODULE = path.join(BACKEND_SRC, 'app.module.ts');
const AUDIT_SPEC = path.join(REPO_ROOT, 'backend', 'test', 'new-features-audit.spec.ts');
const INVARIANTS = path.join(REPO_ROOT, 'ARCHITECTURE_INVARIANTS.md');

const FORBIDDEN_STRINGS = ['JobQueueService', 'JobQueueModule', 'job-queue', 'processNextBatch', 'registerHandler'];

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkTsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

async function main(): Promise<void> {
  // 0. Positive control (fail-first for the walk itself): the scan must
  // find a string known to be present, or an empty/broken walk would
  // falsely pass every absence assertion below.
  const srcFiles = walkTsFiles(BACKEND_SRC);
  assert.ok(srcFiles.length > 100, `backend/src walk must find >100 .ts files, found ${srcFiles.length}`);
  const appModuleText = fs.readFileSync(APP_MODULE, 'utf8');
  assert.ok(appModuleText.includes('AppModule'), 'positive control: app.module.ts must contain AppModule');
  const allSrcText = srcFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.ok(allSrcText.includes('AppModule'), 'positive control: joined backend/src text must contain AppModule');

  // 1. The queue directory (service + module) is gone.
  assert.ok(!fs.existsSync(QUEUE_DIR), 'backend/src/common/queue must not exist');
  assert.ok(
    !fs.existsSync(path.join(BACKEND_SRC, 'common', 'queue', 'job-queue.service.ts')),
    'job-queue.service.ts must not exist',
  );
  assert.ok(
    !fs.existsSync(path.join(BACKEND_SRC, 'common', 'queue', 'job-queue.module.ts')),
    'job-queue.module.ts must not exist',
  );

  // 2. No dead-queue string remains anywhere under backend/src.
  for (const needle of FORBIDDEN_STRINGS) {
    assert.ok(!allSrcText.includes(needle), `backend/src must not reference '${needle}' anywhere`);
  }
  assert.ok(!appModuleText.includes('JobQueueModule'), 'app.module.ts must not import JobQueueModule');

  // 3. The audit script no longer imports or drives the service.
  assert.ok(fs.existsSync(AUDIT_SPEC), 'new-features-audit.spec.ts must still exist (ZATCA + POS sections kept)');
  const auditText = fs.readFileSync(AUDIT_SPEC, 'utf8');
  assert.ok(!auditText.includes('JobQueueService'), 'audit script must not import JobQueueService');
  assert.ok(!auditText.includes('job-queue'), 'audit script must not reference job-queue');
  assert.ok(!auditText.includes('TEST_JOB'), 'audit script must not drive the dead queue test job');

  // 4. The invariant entry pins the removal exactly once (presence only;
  // the architecture-guard spec owns the last-line tail assertion).
  const invariants = fs.readFileSync(INVARIANTS, 'utf8');
  const hits = invariants.split('\n').filter((line) => line.includes('INV-JOB-QUEUE-DEAD-TIMER-REMOVED'));
  assert.equal(hits.length, 1, `INV-JOB-QUEUE-DEAD-TIMER-REMOVED must appear exactly once, found ${hits.length}`);
  assert.ok(
    hits[0].startsWith('- INV-JOB-QUEUE-DEAD-TIMER-REMOVED'),
    'the invariant entry must be a top-level - INV- line',
  );

  console.log('job-queue dead-timer removal checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
