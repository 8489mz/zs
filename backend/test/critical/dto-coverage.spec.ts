/*
 * D1 DTO coverage guard: the whole-body @Body() sites whose type is not a
 * *Dto class are pinned at exactly 249 at D2 (240 convertible + the 9
 * pinned exclusions below; 264 at D1). The count is produced by
 * backend/scripts/dto-coverage-check.mjs, a port of the item-(5)
 * (~/workspace/audit/dto-census.py, re-counted at d1989b74e: 681 @Body(
 * occurrences — 624 whole-body + 57 property-form; whole-body buckets
 * dto-class 360, dto-interface 47, inline-object 151, any 43,
 * inline-other 9, named-interface 5, unknown 4, record 4, no-annotation 1).
 *
 * D2 (INV-DTO-PILOT-PURCHASES-INVENTORY): the pilot converts 15 sites
 * (purchases 8 + inventory 7) and the pin moves 264 -> 249 (240
 * convertible + the 9 pinned exclusions below). Whole-body total stays
 * 624; the buckets move dto-class 360 -> 375, dto-interface 47 -> 39,
 * inline-object 151 -> 146, any 43 -> 42, named-interface 5 -> 4.
 *
 * WHY THE NUMBER IS 264 AND NOT 211: the verification files counted 211
 * sites without a *Dto-named type, but 47 of the 407 "with DTO" sites use
 * an INTERFACE named *Dto, not a class — and the global ValidationPipe
 * does nothing for interfaces (it only validates classes). The real
 * unvalidated population is 217 + 47 = 264.
 *
 * THE 9 PINNED EXCLUSIONS (a DTO on any of these breaks a real flow):
 * - 3 x device-push `unknown` (biometric-attendance.controller.ts:153,
 *   :196, :227): ZKTeco/Hikvision push — the handler reads the body as
 *   raw text/Buffer, not JSON. A DTO class would fail or mangle a
 *   non-JSON body and silently lose fingerprint punches.
 * - 4 x `Record<string, unknown>` settings endpoints
 *   (settings.controller.ts:52, settings-backup.controller.ts:60, :68,
 *   tenant-transfer.controller.ts:53): open-ended key/value map by
 *   design — no fixed field set exists to validate.
 * - 1 x `any` (tenant-subscription.controller.ts:396): POST
 *   webhooks/:gateway — the payload shape is the provider's (it can add
 *   fields at any time; forbidNonWhitelisted would 400 a legitimate new
 *   event) and signature verification reads req.rawBody.
 * - 1 x `unknown` (logs.controller.ts:15): POST frontend-error — a
 *   free-form error sink (any JSON up to 10 KB, rate-limited). An error
 *   report's shape is arbitrary by definition; a DTO would reject
 *   legitimate error reports and blind the team to frontend failures.
 *
 * THE PIN IS FAIL-CLOSED: a new unvalidated @Body() site moves the count
 * up and this spec goes red until the pin is updated deliberately; a
 * converted site moves it down by exactly N in the same package (the pin
 * arithmetic is part of each package's proof, like the L8 spec arithmetic
 * 333 - 5 + 1 = 329); "fixing" an exclusion removes it from the set and
 * goes red until the exclusion is deliberately unpinned. The script's own
 * pinned constants cross-check the spec's: if the script's constant is
 * edited without the spec's, the script exits 1; if the spec's is edited
 * without the script's, the JSON assertion below fails.
 *
 * Property-form @Body('prop') (57 sites) is OUT of scope (decision D2:
 * single-property extraction, usually a primitive; the pipe cannot
 * validate a bare string/number) and is not counted here.
 *
 * Fail-first: this spec is new in D1 — on the unpatched tree the census
 * script does not exist, so the spawn fails (MODULE_NOT_FOUND) and the
 * spec exits 1 (see the log). GREEN means the script exists, exits 0,
 * and reports exactly 249 with exactly the 9 exclusions.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as path from 'path';

const BACKEND = path.resolve(__dirname, '../..');
const SCRIPT = 'scripts/dto-coverage-check.mjs';

/** Whole-body @Body() sites whose type is not a *Dto class — pinned at D2 (249 after the pilot converts 15). */
const PINNED_COUNT = 249;

/** Convertible sites inside the pinned count (249 - 9 exclusions). */
const CONVERTIBLE_COUNT = 240;

/** The 9 pinned exclusions (paths relative to backend/, line = @Body() line). */
const PINNED_EXCLUSIONS: Array<{ file: string; line: number }> = [
  { file: 'src/core/logging/logs.controller.ts', line: 15 },
  { file: 'src/modules/hr/controllers/biometric-attendance.controller.ts', line: 153 },
  { file: 'src/modules/hr/controllers/biometric-attendance.controller.ts', line: 196 },
  { file: 'src/modules/hr/controllers/biometric-attendance.controller.ts', line: 227 },
  { file: 'src/modules/settings/controllers/settings-backup.controller.ts', line: 60 },
  { file: 'src/modules/settings/controllers/settings-backup.controller.ts', line: 68 },
  { file: 'src/modules/settings/controllers/tenant-transfer.controller.ts', line: 53 },
  { file: 'src/modules/settings/settings.controller.ts', line: 52 },
  { file: 'src/modules/tenant-subscription/tenant-subscription.controller.ts', line: 396 },
];

interface CoverageSite {
  file: string;
  line: number;
  bucket: string;
  type: string;
}

interface CoverageReport {
  pinnedCount: number;
  nonDtoCount: number;
  wholeBodyTotal: number;
  propertyFormTotal: number;
  exclusions: CoverageSite[];
}

function tail(text: string, lines: number): string {
  const parts = text.split('\n');
  return parts.slice(Math.max(0, parts.length - lines)).join('\n');
}

function main(): void {
  const result = spawnSync('node', [SCRIPT, '--json'], {
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
    `dto-coverage-check.mjs must exit 0 (count == pinned ${PINNED_COUNT} and exclusions match). Got exit ${String(result.status)} signal ${String(result.signal)}.\n${tail(combined, 30)}`,
  );

  const report = JSON.parse(result.stdout) as CoverageReport;
  assert.equal(
    report.pinnedCount,
    PINNED_COUNT,
    `the script's pinned count must be ${PINNED_COUNT} (edit script + spec together when a package moves the pin)`,
  );
  assert.equal(report.nonDtoCount, PINNED_COUNT, `non-DTO whole-body @Body() sites must be exactly ${PINNED_COUNT}`);
  assert.equal(
    report.nonDtoCount - report.exclusions.length,
    CONVERTIBLE_COUNT,
    `convertible sites must be exactly ${CONVERTIBLE_COUNT} (${PINNED_COUNT} - ${PINNED_EXCLUSIONS.length} exclusions)`,
  );

  const exclusions = report.exclusions.map((site) => `${site.file}:${site.line}`).sort();
  const expected = PINNED_EXCLUSIONS.map((site) => `${site.file}:${site.line}`).sort();
  assert.deepEqual(
    exclusions,
    expected,
    `the pinned exclusion set must be exactly the ${PINNED_EXCLUSIONS.length} sites.\nExclusions: ${JSON.stringify(exclusions)}\nExpected: ${JSON.stringify(expected)}`,
  );

  console.log(
    `dto coverage check passed (${report.nonDtoCount} non-DTO sites, ${report.exclusions.length} pinned exclusions, ${report.wholeBodyTotal} whole-body, ${report.propertyFormTotal} property-form)`,
  );
}

main();
