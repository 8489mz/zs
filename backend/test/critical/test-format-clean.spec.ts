/*
 * L7 scoped guard: test/ must stay Prettier-clean under the repo
 * config (backend/.prettierrc: singleQuote, printWidth 120). No
 * files are excluded — test files are NOT under the code cap
 * ("Specs are not under the code cap" in the guardrails script),
 * so there is no size-cap STOP class here; the AST check + this
 * spec's exact-set pin are the proof instead. The scope holds 865
 * files (864 .ts at the L6b base + this spec); 791 failed
 * `prettier --check` at the L6b base (914663ab3, re-counted at fix
 * time — the grounding's 789 at ea44b1bcb + 2: the 6 guard specs
 * added by L1–L6 contribute exactly 2 failing files, the other 4
 * are already clean) and L7 formats all 791 of them with a pure
 * `prettier --write`.
 *
 * SPLIT DECISION (agent, recorded): one package for all 791
 * files, NOT split into test/critical vs rest. The review
 * instrument is mechanical (the AST check + this spec + tsc +
 * the guards), not human diff reading — it scales to 791 files
 * exactly as it scaled to L5's 514; splitting would double the
 * package overhead (two specs, two pushes, two ci-fast cycles)
 * and L8 deletes the scoped specs anyway.
 *
 * SIZE NOTE: test files are not under the cap, but a giant test
 * file is still worth flagging — the largest HEAD counts are
 * import-e2e-business-simulation 2411, import-postgres-integration
 * 2026, core-accounting.postgres 1983 (acceptance). Their
 * post-format counts are recorded in
 * ~/workspace/audit/lint-prettier-log.md L7.
 *
 * L8 deletes this spec when the global backend-format-clean guard
 * lands — the global guard asserts the whole backend, test/
 * included.
 *
 * This spec invokes `npx prettier --check` on the scope glob so
 * the exact tool CI runs is what is asserted — in CI, `npm ci`
 * installs prettier (devDep, lock 3.10.1), so npx resolves the local
 * binary there; locally it uses the npx cache.
 *
 * Fail-first: on the pre-L7 tree this spec exits 1 (791 files
 * fail, not 0); after L7 it exits 0 (no files fail). A second shape
 * is proven by reverting one formatted file (see the log): the spec
 * goes red until it is restored.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'path';

const BACKEND = path.resolve(__dirname, '../..');
const GLOBS = ['test/**/*.ts'];

/** Files deliberately left unformatted (see header). */
const EXCLUDED: string[] = [];

function countTsRecursive(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += countTsRecursive(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      total += 1;
    }
  }
  return total;
}

function tail(text: string, lines: number): string {
  const parts = text.split('\n');
  return parts.slice(Math.max(0, parts.length - lines)).join('\n');
}

function main(): void {
  const total = countTsRecursive(path.join(BACKEND, 'test'));
  assert.ok(total > 0, 'the L7 scope must contain files');
  const result = spawnSync('npx', ['prettier', '--check', ...GLOBS], {
    cwd: BACKEND,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 5 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const failing = combined
    .split('\n')
    .filter((line) => line.startsWith('[warn] '))
    .map((line) => line.slice('[warn] '.length).trim())
    .filter((line) => line.endsWith('.ts'))
    .sort();
  const expected = [...EXCLUDED].sort();
  if (expected.length === 0) {
    assert.equal(
      result.status,
      0,
      `prettier --check on the L7 scope must exit 0 (no files fail). Got exit ${String(result.status)} signal ${String(result.signal)}.\n${tail(combined, 30)}`,
    );
    assert.deepEqual(
      failing,
      expected,
      `no files must fail prettier --check in the L7 scope.\nFailing: ${JSON.stringify(failing)}`,
    );
  } else {
    assert.equal(
      result.status,
      1,
      `prettier --check on the L7 scope must exit 1 (exactly the ${String(EXCLUDED.length)} excluded file(s) fail). Got exit ${String(result.status)} signal ${String(result.signal)}.\n${tail(combined, 30)}`,
    );
    assert.deepEqual(
      failing,
      expected,
      `the failing files must be exactly the ${String(EXCLUDED.length)} excluded file(s).\nFailing: ${JSON.stringify(failing)}\nExpected: ${JSON.stringify(expected)}`,
    );
  }
  console.log(`L7 scope format clean check passed (${total} files, ${EXCLUDED.length} excluded)`);
}

main();
