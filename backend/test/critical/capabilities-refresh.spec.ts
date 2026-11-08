/*
 * C8 capabilities end-refresh (Phase 8 of the engine-unification plan):
 * SYSTEM_CAPABILITIES.md must link docs/ENGINE_MAP.md, and the review
 * register (docs/reviews/README.md) must carry the U1–U4 unification
 * evidence pointers with real 40-char heads — while flipping NO module
 * state, because a state flip needs a full module review (workflow
 * traces + per-module unit/Postgres/UI/UAT/legal evidence), which the
 * U1–U4 engine specs + CI runs are not.
 *
 * Pinned facts (all verified live at HEAD 30a84e93):
 * 1. The index links the engine map (intro line + usage bullet + a
 *    mermaid node), and carries a dated U1–U4 pointer line that states
 *    explicitly it is not a readiness certificate.
 * 2. The register's evidence section names the four U1–U4 heads as
 *    full SHAs; each SHA must exist in this repo as a commit
 *    (asserted via `git cat-file -t`).
 * 3. The register states plainly that C8 flipped no module state, and
 *    the U4 ci-full result is recorded as NOT in hand at write time —
 *    a waived or unrecorded run must never be read as green.
 * 4. module-review-status.json still has last_verified_commit null for
 *    every module (C8 flipped nothing). If a later evidence-backed
 *    review flips a state, update this pin deliberately with the new
 *    evidence — do not weaken it silently.
 *
 * Style follows backend/test/critical/engine-map-corrections.spec.ts:
 * plain node:assert checks run by ts-node, no test runner. The spec
 * reads doc/json files on disk only; it imports no production code and
 * needs no database. Run: npx ts-node test/critical/capabilities-refresh.spec.ts
 */

import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

const U_HEADS: Array<{ batch: string; sha: string; lastPackageInv: string }> = [
  {
    batch: 'U1',
    sha: '4bb975151e30cf874ac78549fc7a6e8c87528f9d',
    lastPackageInv: 'INV-ACCOUNTING-DIGITS-SERVICES',
  },
  {
    batch: 'U2',
    sha: '0f7f82bec0b09138d8ccb5f375b5d71a163ede77',
    lastPackageInv: 'INV-VAN-OPS-TOFIXED-2DP',
  },
  {
    batch: 'U3',
    sha: 'fa58541633922a15bc29d6ab37c4e0980b6a62a9',
    lastPackageInv: 'INV-FX-RATE-HISTORY-CONSUMER',
  },
  {
    batch: 'U4',
    sha: '30a84e93f0534a73e81734d8109426219c5d3b7c',
    lastPackageInv: 'INV-PAYROLL-EOS-DEDUP',
  },
];

async function main(): Promise<void> {
  const indexPath = path.join(REPO_ROOT, 'SYSTEM_CAPABILITIES.md');
  assert.ok(fs.existsSync(indexPath), 'SYSTEM_CAPABILITIES.md must exist');
  const index = fs.readFileSync(indexPath, 'utf8');

  function indexPresent(text: string, label: string): void {
    assert.ok(index.includes(text), `capabilities index must state: ${label}`);
  }

  // 1. The engine-map link (intro + usage bullet + mermaid node).
  indexPresent('[docs/ENGINE_MAP.md](docs/ENGINE_MAP.md)', 'ENGINE_MAP link');
  indexPresent('ENGINE_MAP: canonical money engines', 'mermaid ENGINE_MAP node');
  indexPresent('30a84e93', 'U1–U4 pointer head 30a84e93');
  indexPresent('ليست شهادة جاهزية', 'pointer line is not a readiness certificate');

  // 2. The review register carries the U1–U4 evidence pointers.
  const registerPath = path.join(REPO_ROOT, 'docs/reviews/README.md');
  assert.ok(fs.existsSync(registerPath), 'docs/reviews/README.md must exist');
  const register = fs.readFileSync(registerPath, 'utf8');

  function registerPresent(text: string, label: string): void {
    assert.ok(register.includes(text), `review register must state: ${label}`);
  }

  registerPresent(
    'لم تُقلب أي حالة موديول في هذه الحزمة (C8)',
    'C8 flipped no module state',
  );
  registerPresent(
    'ليست في اليد وقت كتابة هذا القسم',
    'U4 ci-full result recorded as not in hand',
  );

  for (const head of U_HEADS) {
    registerPresent(head.sha, `${head.batch} head SHA in the register`);
    registerPresent(
      head.lastPackageInv,
      `${head.batch} last-package invariant in the register`,
    );
    assert.match(head.sha, /^[0-9a-f]{40}$/, `${head.batch} SHA must be 40 hex chars`);
    const objectType = execSync(`git cat-file -t ${head.sha}`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
    assert.equal(objectType, 'commit', `${head.batch} head ${head.sha} must exist as a commit`);
  }

  // 3. The register data file: C8 flipped nothing.
  const statusPath = path.join(REPO_ROOT, 'docs/reviews/module-review-status.json');
  assert.ok(fs.existsSync(statusPath), 'module-review-status.json must exist');
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as {
    modules: Array<{ module: string; state: string; last_verified_commit: string | null }>;
  };
  assert.ok(Array.isArray(status.modules), 'register must list modules');
  assert.equal(status.modules.length, 37, 'register must list the 37 backend modules');
  for (const entry of status.modules) {
    assert.equal(
      entry.last_verified_commit,
      null,
      `module ${entry.module} must have no verified commit after C8 (C8 flipped nothing)`,
    );
  }

  console.log('capabilities refresh checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
