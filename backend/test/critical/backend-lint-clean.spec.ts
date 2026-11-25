/*
 * INV-BACKEND-LINT-ERRORS-ZERO: the backend lint must stay at zero
 * errors. This spec runs the repo's own `lint` script (`eslint .`) and
 * asserts it exits 0. Warnings do NOT fail the run: no-explicit-any
 * (12,802) and no-unused-vars (1,488) stay warnings by design, and
 * removing `any` is a separate type-safety campaign, never part of
 * this guard.
 *
 * WHY THIS SHAPE: before L2, `eslint .` reported 228 errors (90
 * no-duplicate-imports, 80 prefer-const, 35 no-require-imports, 20
 * misc, 3 no-undef) over the whole backend. L2 fixed them to zero;
 * this spec is the living proof they stay zero. It invokes `npm run
 * lint` so the exact command CI runs is what is asserted — in CI,
 * `npm ci` installs the deps first, so the script resolves there.
 *
 * Fail-first: on the pre-L2 tree this spec exits 1 (228 errors);
 * after L2 it exits 0.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as path from 'path';

const BACKEND = path.resolve(__dirname, '../..');

function tail(text: string, lines: number): string {
  const parts = text.split('\n');
  return parts.slice(Math.max(0, parts.length - lines)).join('\n');
}

function main(): void {
  const result = spawnSync('npm', ['run', 'lint'], {
    cwd: BACKEND,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 10 * 60 * 1000,
    // The full lint output is several MB (14k+ warnings): the 1 MB
    // spawnSync default would kill npm mid-run with status null.
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `backend "npm run lint" must exit 0 (0 errors). Got exit ${String(result.status)} signal ${String(result.signal)}.\n${tail(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, 30)}`,
  );
  console.log('backend lint clean check passed (0 errors)');
}

main();
