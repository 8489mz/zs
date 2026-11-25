/*
 * L3 scoped guard: src/database/migrations must stay Prettier-clean
 * under the repo config (backend/.prettierrc: singleQuote, printWidth
 * 120). The directory holds 441 migration files; 197 failed
 * `prettier --check` at the L2 base (31d98009f, exact match to the
 * grounding census) and L3 formats them with a pure `prettier --write`.
 * L8 deletes this spec when the global backend-format-clean guard
 * lands — the global guard supersedes the five scoped specs.
 *
 * This spec invokes `npx prettier --check` on the migrations glob so
 * the exact tool CI runs is what is asserted — in CI, `npm ci`
 * installs prettier (devDep, lock 3.10.1), so npx resolves the local
 * binary there; locally it uses the npx cache.
 *
 * Fail-first: on the pre-L3 tree this spec exits 1 (197 files fail);
 * after L3 it exits 0.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'path';

const BACKEND = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(BACKEND, 'src', 'database', 'migrations');

function tail(text: string, lines: number): string {
  const parts = text.split('\n');
  return parts.slice(Math.max(0, parts.length - lines)).join('\n');
}

function main(): void {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length > 0, 'migrations directory must contain .ts files');
  const result = spawnSync('npx', ['prettier', '--check', 'src/database/migrations/**/*.ts'], {
    cwd: BACKEND,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 5 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  assert.equal(
    result.status,
    0,
    `prettier --check on src/database/migrations must exit 0. Got exit ${String(result.status)} signal ${String(result.signal)}.\n${tail(combined, 30)}`,
  );
  assert.ok(
    combined.includes('All matched files use Prettier code style!'),
    `prettier --check must report all matched files clean.\n${tail(combined, 10)}`,
  );
  console.log(`migrations format clean check passed (${files.length} files)`);
}

main();
