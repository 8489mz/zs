/*
 * D1 DTO coverage guard: the whole-body @Body() sites whose type is not a
 * *Dto class are pinned at exactly 15 at D10 (0 convertible + the 15
 * pinned exclusions below; 264 at D1, 249 at D2, 191 at D3, 163 at D4, 136 at D5, 111 at D6, 89 at D7, 75 at D8, 45 at D9).
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
 * D7 (INV-DTO-SETTINGS-22): settings converts 22 sites (3
 * inline-other + 14 inline-object + 5 any) and the pin moves
 * 111 -> 89 (80 convertible + the 9 pinned exclusions below).
 * The live census re-derived the list (the grounding's 22 held
 * exactly). Whole-body total stays 624; the buckets move dto-class
 * 513 -> 535, inline-object 57 -> 43, any 22 -> 17, inline-other
 * 7 -> 4.
 *
 * D8 (INV-DTO-STOREFRONT-14): storefront converts 14 of its 20
 * non-DTO sites (6 inline-object + 2 inline-other + 2
 * named-interface + 4 any) and the pin moves 89 -> 75 (60
 * convertible + the 15 pinned exclusions below — the 9 old ones
 * plus 6 new storefront webhook exclusions). The live census
 * re-derived the list (the grounding's 20 held exactly) but the
 * grounding's 20 do NOT all convert: the 6 webhook `any` sites
 * stay `any` (provider payload + signature verification — the
 * same rationale as the pinned tenant-subscription gateway
 * webhook). Whole-body total stays 624; the buckets move dto-class
 * 535 -> 549, inline-object 43 -> 37, any 17 -> 13, inline-other
 * 4 -> 2, named-interface 3 -> 1. The two DTO files' header
 * comments were reworded first (a literal `@Body(` in a comment
 * is counted as a site by the census script — the D2 trap — and
 * the first post-edit census read 626 whole-body / 77 non-DTO
 * until the reword).
 *
 * D9 (INV-DTO-HR-TAX-APPROVALS-30): hr + tax-integration + approvals
 * convert 30 sites (10 dto-interface + 17 inline-object + 2 any + 1
 * named-class) and the pin moves 75 -> 45 (30 convertible + the 15
 * pinned exclusions below). The live census re-derived the list (the
 * grounding's 30 held exactly). Whole-body total stays 624; the buckets
 * move dto-class 549 -> 579, inline-object 37 -> 21, any 13 -> 11,
 * dto-interface 14 -> 3, named-interface 1 -> 0. Two census traps
 * caught by the live re-count: (1) SettlementCalculateInput does NOT
 * end in Dto, so the classifier counted it named-class even after the
 * in-place conversion — the type is RENAMED
 * SettlementCalculateInputDto (5 backend sites + the D9 spec) so the
 * census sees it; (2) a `| null` union on a DTO property emits Object
 * metadata, so implicit conversion does NOT coerce (the D5 trap in a
 * new shape — biometricPin 42 stayed a number and the pipe 400d) — all
 * DTO `| null` unions are narrowed to their plain scalar type
 * (null still passes via @IsOptional + the service's ?? null).
 * Array elements do NOT coerce without an explicit @Type(() => String)
 * (invoiceIds [1,2] stayed numbers and the pipe 400d) — both tax
 * invoiceIds arrays carry it, and the object-for-string negative is
 * replaced by a coercion pin ('[object Object]' — the D7/D8 trap).
 * The 3 biometric device-push exclusions end at their ORIGINAL lines
 * :153/:196/:227 (the new hr-biometric-write.dto.ts import block grew
 * them +5, merging the two import blocks shrank them -2, then Prettier
 * collapsed two multi-line controller signatures and shrank them -3) —
 * the D8 lesson, re-proven: re-pin from the FRESH census AFTER
 * Prettier, never before. The pins below are the post-Prettier lines.
 * File-size cap: the 4 biometric DTOs were first converted IN PLACE,
 * which pushed biometric-attendance.service.ts 982 -> 1121 (past the
 * 1110 cutoff, so no baseline is possible) — they MOVED to
 * hr-biometric-write.dto.ts instead (service 948 lines after the
 * move). employee-portal.service.ts grew 1072 -> 1073 on one import
 * line; its baseline entry is bumped to 1073 as a deliberate reviewed
 * exception (under the 1110 cutoff).
 *
 * WHY THE NUMBER IS 264 AND NOT 211: the verification files counted 211
 * sites without a *Dto-named type, but 47 of the 407 "with DTO" sites use
 * an INTERFACE named *Dto, not a class — and the global ValidationPipe
 * does nothing for interfaces (it only validates classes). The real
 * unvalidated population is 217 + 47 = 264.
 *
 * THE 15 PINNED EXCLUSIONS (a DTO on any of these breaks a real flow):
 * - 3 x device-push `unknown` (biometric-attendance.controller.ts:153,
 *   :196, :227): ZKTeco/Hikvision push — the handler reads the body as
 *   raw text/Buffer, not JSON. A DTO class would fail or mangle a
 *   non-JSON body and silently lose fingerprint punches.
 * - 4 x `Record<string, unknown>` settings endpoints
 *   (settings.controller.ts:52, settings-backup.controller.ts:61, :69,
 *   tenant-transfer.controller.ts:53): open-ended key/value map by
 *   design — no fixed field set exists to validate.
 * - 1 x `any` (tenant-subscription.controller.ts:401): POST
 *   webhooks/:gateway — the payload shape is the provider's (it can add
 *   fields at any time; forbidNonWhitelisted would 400 a legitimate new
 *   event) and signature verification reads req.rawBody.
 * - 1 x `unknown` (logs.controller.ts:15): POST frontend-error — a
 *   free-form error sink (any JSON up to 10 KB, rate-limited). An error
 *   report's shape is arbitrary by definition; a DTO would reject
 *   legitimate error reports and blind the team to frontend failures.
 * - 6 x `any` storefront webhooks (new in D8, same rationale as the
 *   gateway webhook above — the payload shape is the provider's and
 *   signature verification reads the raw body or concatenated
 *   provider fields):
 *   - marketplace-sync.controller.ts:176: POST marketplaces/webhook/
 *     :marketplace — 4 marketplaces (Amazon SP-API, Noon, Jumia,
 *     Trendyol), each with its own notification schema; the receive
 *     service persists the RAW payload first (a 400 validation
 *     failure is the ACK-and-dropped mode
 *     INV-MARKETPLACE-WEBHOOK-PERSISTENCE was written to kill).
 *   - storefront-public.controller.ts:254: POST webhooks/paymob —
 *     `body?.obj || body` + ~20 fields under obj + custom_fields;
 *     HMAC-SHA512 over concatenated field values.
 *   - storefront-public.controller.ts:264: POST webhooks/xpay —
 *     `body?.data || body`, transaction fields under data or root.
 *   - storefront-public.controller.ts:274: POST webhooks/tap —
 *     body.id/status/metadata/reference/amount/currency/
 *     gateway?.reference/payment_reference/created; HMAC over a
 *     concatenated string of those fields.
 *   - storefront-public.controller.ts:284: POST webhooks/stripe —
 *     body.type + body.data.object; the stripe-signature header is
 *     verified over rawBody, which the service requires.
 *   - storefront-public.controller.ts:303: POST webhooks/marketplace/
 *     :marketplace — same receive path as the :179 webhook.
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
 * D10 (INV-DTO-TAIL-30): the tail converts the last 30 sites
 * (addons 2 + ai-copilot 5 + bosta 2 + catalog 4 + gcc-shipping 2 +
 * import-sales 4 + partners 3 + pharmacy 1 + saas-admin 4 +
 * saas-diagnostics 1 + tenant-subscription 1 + users 1) and the pin
 * moves 45 -> 15 (0 convertible + the 15 pinned exclusions below).
 * The live census re-derived the list (the grounding's 30 held
 * exactly). Whole-body total stays 624; the buckets move dto-class
 * 579 -> 609, inline-object 21 -> 0, any 11 -> 7, dto-interface 3 -> 0,
 * inline-other 2 -> 0. The gateway-webhook exclusion moves :396 -> :401
 * (the new DTO import shifts it +1, then Prettier expands the
 * multi-line controller signatures and shifts it +4) — re-pinned from
 * the fresh census after Prettier, never before. The pin is now the 15 exclusions only: every whole-body
 * site in the repo takes a decorated DTO class.
 *
 * Fail-first: this spec is new in D1 — on the unpatched tree the census
 * script does not exist, so the spawn fails (MODULE_NOT_FOUND) and the
 * spec exits 1 (see the log). GREEN means the script exists, exits 0,
 * and reports exactly 15 with exactly the 15 exclusions.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as path from 'path';

const BACKEND = path.resolve(__dirname, '../..');
const SCRIPT = 'scripts/dto-coverage-check.mjs';

/** Whole-body @Body() sites whose type is not a *Dto class — pinned at D10 (15 — the 15 exclusions only; the tail converts the last 30). */
const PINNED_COUNT = 15;

/** Convertible sites inside the pinned count (15 - 15 exclusions). */
const CONVERTIBLE_COUNT = 0;

/** The 15 pinned exclusions (paths relative to backend/, line = @Body() line). */
const PINNED_EXCLUSIONS: Array<{ file: string; line: number }> = [
  { file: 'src/core/logging/logs.controller.ts', line: 15 },
  { file: 'src/modules/hr/controllers/biometric-attendance.controller.ts', line: 153 },
  { file: 'src/modules/hr/controllers/biometric-attendance.controller.ts', line: 196 },
  { file: 'src/modules/hr/controllers/biometric-attendance.controller.ts', line: 227 },
  { file: 'src/modules/settings/controllers/settings-backup.controller.ts', line: 61 },
  { file: 'src/modules/settings/controllers/settings-backup.controller.ts', line: 69 },
  { file: 'src/modules/settings/controllers/tenant-transfer.controller.ts', line: 53 },
  { file: 'src/modules/settings/settings.controller.ts', line: 52 },
  { file: 'src/modules/tenant-subscription/tenant-subscription.controller.ts', line: 401 },
  { file: 'src/modules/storefront/controllers/marketplace-sync.controller.ts', line: 176 },
  { file: 'src/modules/storefront/storefront-public.controller.ts', line: 254 },
  { file: 'src/modules/storefront/storefront-public.controller.ts', line: 264 },
  { file: 'src/modules/storefront/storefront-public.controller.ts', line: 274 },
  { file: 'src/modules/storefront/storefront-public.controller.ts', line: 284 },
  { file: 'src/modules/storefront/storefront-public.controller.ts', line: 303 },
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
