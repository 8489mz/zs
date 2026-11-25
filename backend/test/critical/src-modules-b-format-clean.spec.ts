/*
 * L5 scoped guard: src modules B must stay Prettier-clean under the
 * repo config (backend/.prettierrc: singleQuote, printWidth 120),
 * EXCEPT any files named in EXCLUDED below that are deliberately
 * left unformatted. The thirty directories hold 691 .ts files; 533
 * failed `prettier --check` at the L4b base (98fed26bb, re-counted
 * at fix time — the grounding census named only 7 of the 30 dirs:
 * delivery-reps 124, storefront 52, hr 49, settings 56,
 * maritime-freight 39, contracting 36, import-sales 30 = 386; the
 * other 23 dirs add 147 more failing files) and L5 formats 514 of
 * them with a pure `prettier --write`.
 *
 * SIZE-CAP EXCLUSIONS (L4 way): `prettier --write` grows 19 files
 * past the 1000-line file-size cap (or past their recorded baseline
 * count) purely by breaking their very long lines — the code does
 * not grow, the lines do (e.g. settings-backup 949 -> 1516, longest
 * HEAD line 2167 chars; pricing 330 -> 1132, longest 1213 chars;
 * reports 976 -> 1314; users 1012 -> 1183, grown from baseline
 * 1012; execute-field-sale-internal 1466 -> 1606, grown from
 * baseline 1468; employee-portal 1010 -> 1072, grown from baseline
 * 1010; full table in ~/workspace/audit/lint-prettier-log.md L5).
 * 9 of the 19 land at or below the user's 1110-line split cutoff
 * after formatting (ai-agent 1025, settle-trip 1076, van-sales
 * 1025, employee-portal 1072, biometric-log-parser 1035,
 * hr-employees 1103, import-commercial 1093,
 * import-projects-partners 1016, manufacturing 1102) and could be
 * formatted + baselined under the L4b precedent — but that decision
 * belongs to the parent, so they are STOPPED here like the other
 * 10. The guard pins the exception set exactly: if a 20th file
 * fails, or one of the 19 gets formatted, this spec goes red until
 * the list is updated deliberately. L8 deletes this spec when the
 * global backend-format-clean guard lands — the global guard
 * inherits the same exclusion until the 19 are resolved.
 *
 * This spec invokes `npx prettier --check` on the module globs so
 * the exact tool CI runs is what is asserted — in CI, `npm ci`
 * installs prettier (devDep, lock 3.10.1), so npx resolves the local
 * binary there; locally it uses the npx cache.
 *
 * Fail-first: on the pre-L5 tree this spec exits 1 (533 files fail,
 * not the 19); after L5 it exits 1 with exactly the 19 excluded
 * files failing. A second shape is proven by reverting one
 * formatted file (see the log): the spec goes red until it is
 * restored.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'path';

const BACKEND = path.resolve(__dirname, '../..');
const MODULES = [
  'activation',
  'addons',
  'ai-copilot',
  'approvals',
  'bosta',
  'cash-drawer',
  'contracting',
  'crm',
  'delivery-reps',
  'gcc-shipping',
  'hr',
  'import-sales',
  'maintenance',
  'manager-actions',
  'manufacturing',
  'maritime-freight',
  'partners',
  'pharmacy',
  'pricing',
  'public',
  'reports',
  'saas-admin',
  'services',
  'sessions',
  'settings',
  'storefront',
  'tenant-subscription',
  'tradein',
  'treasury',
  'users',
];

/** Files prettier --write would grow past the file-size cap. */
const EXCLUDED: string[] = [
  'src/modules/ai-copilot/services/ai-agent.service.ts',
  'src/modules/cash-drawer/cash-drawer-write.service.ts',
  'src/modules/contracting/services/contracting-pricing.service.ts',
  'src/modules/delivery-reps/services/van-field-sales/execute-field-sale-internal.ts',
  'src/modules/delivery-reps/services/van-trip-lifecycle/settle-trip.service.ts',
  'src/modules/delivery-reps/van-sales.service.ts',
  'src/modules/hr/employee-portal.service.ts',
  'src/modules/hr/engines/biometric-log-parser.engine.ts',
  'src/modules/hr/services/hr-employees.service.ts',
  'src/modules/import-sales/services/import-commercial.service.ts',
  'src/modules/import-sales/services/import-projects-partners.service.ts',
  'src/modules/import-sales/services/import-receipt-posting.service.ts',
  'src/modules/import-sales/services/import-shipments.service.ts',
  'src/modules/manufacturing/services/manufacturing.service.ts',
  'src/modules/pricing/pricing.service.ts',
  'src/modules/reports/reports.service.ts',
  'src/modules/settings/services/demo-data/settings-demo-data-seed.ts',
  'src/modules/settings/services/settings-backup.service.ts',
  'src/modules/users/users.service.ts',
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
  if (expected.length === 0) {
    assert.equal(
      result.status,
      0,
      `prettier --check on src modules B must exit 0 (no files fail). Got exit ${String(result.status)} signal ${String(result.signal)}.\n${tail(combined, 30)}`,
    );
    assert.deepEqual(
      failing,
      expected,
      `no files must fail prettier --check in src modules B.\nFailing: ${JSON.stringify(failing)}`,
    );
  } else {
    assert.equal(
      result.status,
      1,
      `prettier --check on src modules B must exit 1 (exactly the ${String(EXCLUDED.length)} excluded files fail). Got exit ${String(result.status)} signal ${String(result.signal)}.\n${tail(combined, 30)}`,
    );
    assert.deepEqual(
      failing,
      expected,
      `the failing files must be exactly the ${String(EXCLUDED.length)} excluded files.\nFailing: ${JSON.stringify(failing)}\nExpected: ${JSON.stringify(expected)}`,
    );
  }
  console.log(`src modules B format clean check passed (${total} files, ${EXCLUDED.length} excluded by size cap)`);
}

main();
