/*
 * D1 DTO coverage guard: the whole-body @Body() sites whose type is not a
 * *Dto class are pinned at exactly 111 at D6 (102 convertible + the 9
 * pinned exclusions below; 264 at D1, 249 at D2, 191 at D3, 163 at D4, 136 at D5).
 * Package C keeps the pin at 136 (136 + 0 CRLF + 1 reveal - 1 convert). The count is produced by
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
 * D3 (INV-DTO-DELIVERY-REPS-58): delivery-reps converts 58 sites
 * (driver portal 3 + delivery-reps 4 + admin 27 + driver 24) and the
 * pin moves 249 -> 191 (182 convertible + the 9 pinned exclusions
 * below). Whole-body total stays 624; the buckets move dto-class
 * 375 -> 433, inline-object 146 -> 94, any 42 -> 37, no-annotation
 * 1 -> 0.
 *
 * D4 (INV-DTO-MARITIME-FREIGHT-28): maritime-freight converts 28 sites
 * (customer portal 5 + freight controller 22 + public tracking 1) and
 * the pin moves 191 -> 163 (154 convertible + the 9 pinned exclusions
 * below). Whole-body total stays 624; the buckets move dto-class
 * 433 -> 461, inline-object 94 -> 81, any 37 -> 25, dto-interface
 * 39 -> 38, inline-other 9 -> 7.
 *
 * D5 (INV-DTO-SALES-27): sales converts 27 sites (13 dto-interface +
 * 13 inline-object + 1 named-interface) and the pin moves 163 -> 136
 * (127 convertible + the 9 pinned exclusions below). Whole-body total
 * stays 624; the buckets move dto-class 461 -> 488, inline-object
 * 81 -> 68, dto-interface 38 -> 25, named-interface 4 -> 3.
 *
 * Package C (INV-DTO-SALES-QUOTATION-CREATE): the census script is
 * fixed in two ways (CRLF split + per-import declaration resolution)
 * and the sales CreateQuotationDto is converted. The pin does NOT
 * move: 136 + 0 (CRLF — the tree has no \r) + 1 (the per-import fix
 * reveals the quotations create site as dto-interface) - 1 (the
 * conversion) = 136 (127 convertible + the 9 pinned exclusions
 * below). Whole-body total stays 624; the buckets end where D5 left
 * them (dto-class 488, dto-interface 25, inline-object 68, any 25,
 * inline-other 7, named-interface 3, unknown 4, record 4).
 *
 * D6 (INV-DTO-ACCOUNTING-25): accounting converts 25 sites (11
 * dto-interface + 11 inline-object + 3 any) and the pin moves
 * 136 -> 111 (102 convertible + the 9 pinned exclusions below).
 * The live census re-derived the list (the grounding's 25 held
 * exactly). Whole-body total stays 624; the buckets move dto-class
 * 488 -> 513, inline-object 68 -> 57, any 25 -> 22, dto-interface
 * 25 -> 14.
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
 * and reports exactly 136 with exactly the 9 exclusions.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as path from 'path';

const BACKEND = path.resolve(__dirname, '../..');
const SCRIPT = 'scripts/dto-coverage-check.mjs';

/** Whole-body @Body() sites whose type is not a *Dto class — pinned at D6 (111 after accounting converts 25). */
const PINNED_COUNT = 111;

/** Convertible sites inside the pinned count (111 - 9 exclusions). */
const CONVERTIBLE_COUNT = 102;

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
