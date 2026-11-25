/*
 * L4 scoped guard: src modules A must stay Prettier-clean under the
 * repo config (backend/.prettierrc: singleQuote, printWidth 120),
 * EXCEPT 13 named files that are deliberately left unformatted.
 * The seven directories hold 375 .ts files; 328 failed
 * `prettier --check` at the L3 base (64a023e2d, exact match to the
 * grounding census: accounting 113, sales 88, purchases 46,
 * inventory 28, returns 18, catalog 18, tax-integration 17) and L4
 * formats 315 of them with a pure `prettier --write`.
 *
 * WHY 13 ARE EXCLUDED (not a formatting failure — a size-cap
 * collision): `prettier --write` grows these files past the
 * 1000-line file-size cap (and 9 of them past the user's 1110-line
 * split cutoff) purely by breaking their very long lines — the code
 * does not grow, the lines do (e.g. inventory-transfer 1091 -> 2133,
 * tenant-foundation 266 -> 1210, update-sale 1351 -> 1743; full
 * table in ~/workspace/audit/lint-prettier-log.md L4). Formatting
 * them makes the file-size-cap guard red, and baselining 9 files
 * over the 1110 cutoff unilaterally would contradict the user's
 * split decision — so they are STOPPED here and the decision
 * (baseline them / split them / prettierignore them) belongs to the
 * parent. The guard pins the exception set exactly: if a 14th file
 * fails, or one of the 13 gets formatted, this spec goes red until
 * the list is updated deliberately.
 * L8 deletes this spec when the global backend-format-clean guard
 * lands — the global guard inherits the same exclusion until the
 * 13 are resolved.
 *
 * This spec invokes `npx prettier --check` on the module globs so
 * the exact tool CI runs is what is asserted — in CI, `npm ci`
 * installs prettier (devDep, lock 3.10.1), so npx resolves the local
 * binary there; locally it uses the npx cache.
 *
 * Fail-first: on the pre-L4 tree this spec exits 1 (328 files fail,
 * not the 13); after L4 it exits 0 (exactly the 13 fail).
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'path';

const BACKEND = path.resolve(__dirname, '../..');
const MODULES = [
  'accounting',
  'sales',
  'purchases',
  'inventory',
  'returns',
  'catalog',
  'tax-integration',
];

/** Files prettier --write would grow past the file-size cap. */
const EXCLUDED = [
  'src/modules/accounting/accounting-posting.service.ts',
  'src/modules/accounting/accounting-tenant-foundation.service.ts',
  'src/modules/accounting/services/journal-posting-core.service.ts',
  'src/modules/accounting/services/pdc-posting.service.ts',
  'src/modules/catalog/services/catalog-product-list.service.ts',
  'src/modules/catalog/services/catalog-product-write.service.ts',
  'src/modules/inventory/services/inventory-count.service.ts',
  'src/modules/inventory/services/inventory-transfer.service.ts',
  'src/modules/purchases/services/purchases-write-create.service.ts',
  'src/modules/returns/returns-sale-return.service.ts',
  'src/modules/sales/helpers/sales-write.helper.ts',
  'src/modules/sales/services/sales-edit-and-cancel/update-sale.service.ts',
  'src/modules/sales/services/sales-restaurant-and-serials.service.ts',
];

function countTs(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += countTs(full);
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
  let total = 0;
  for (const mod of MODULES) {
    const dir = path.join(BACKEND, 'src', 'modules', mod);
    const count = countTs(dir);
    assert.ok(count > 0, `src/modules/${mod} must contain .ts files`);
    total += count;
  }
  const globs = MODULES.map((mod) => `src/modules/${mod}/**/*.ts`);
  const result = spawnSync('npx', ['prettier', '--check', ...globs], {
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
  assert.equal(
    result.status,
    1,
    `prettier --check on src modules A must exit 1 (exactly the ${String(EXCLUDED.length)} excluded files fail). Got exit ${String(result.status)} signal ${String(result.signal)}.\n${tail(combined, 30)}`,
  );
  assert.deepEqual(
    failing,
    expected,
    `the failing files must be exactly the ${String(EXCLUDED.length)} excluded files.\nFailing: ${JSON.stringify(failing)}\nExpected: ${JSON.stringify(expected)}`,
  );
  console.log(`src modules A format clean check passed (${total} files, ${EXCLUDED.length} excluded by size cap)`);
}

main();
