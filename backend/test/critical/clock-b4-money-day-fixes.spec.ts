import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { accountingDateKey } from '../../src/modules/accounting/accounting-tax-lock';
import { formatLocalCalendarDay } from '../../src/common/utils/tenant-timezone.util';

/*
 * Clock B4-P1 (RC-3 #1-#4): money-critical UTC-slice fixes.
 *
 * THE DEFECT: four money paths derived a business day by slicing the UTC
 * rendering of a pg DATE value — `value.toISOString().slice(0, 10)`.
 * node-postgres returns a DATE column as a host-local-midnight Date
 * (postgres-date parses YYYY-MM-DD as new Date(year, month, day)), so
 * on any host east of UTC the slice yields the PREVIOUS day:
 * - trip-expense date (import-sales postSourcingTripExpense) posts a
 *   journal one day early, crossing a period boundary when the trip
 *   starts on the 1st;
 * - fiscal-year end_date (journal-posting-core) is compared against
 *   the tenant-resolved postingDate, so a closing entry dated exactly
 *   year-end is REJECTED with INVALID_FISCAL_TRANSITION on non-UTC
 *   hosts — the fiscal-year close can be blocked entirely;
 * - accountingDateKey (accounting-tax-lock) + the inline lockDay in
 *   accounting-boundaries derive the period-lock key one day early,
 *   so a posting dated exactly the lock date is ALLOWED when it
 *   should be blocked (lock under-enforced);
 * - quotation expiry_date (import-sales selectQuotation) is computed
 *   as expired yesterday, so a quotation expiring today is rejected
 *   one day early.
 *
 * THE FIX: every site derives the day with formatLocalCalendarDay,
 * which builds the YYYY-MM-DD key from the host-local calendar parts
 * — exact for pg DATE values on every host. The accountingDateKey doc
 * comment claiming "slicing its UTC rendering is exact" is corrected:
 * that premise is wrong on any non-UTC host. No comparison, error, or
 * caller changes — only the day derivation.
 *
 * RED DESIGN (this VM is UTC, so the bugs cannot manifest here, and
 * PGlite returns DATE columns as UTC-midnight Dates, unlike
 * node-postgres — a plain PGlite spec cannot RED these):
 * - §A runs the REAL accountingDateKey under TZ=Africa/Cairo in a
 *   child ts-node process (the business-date-display.spec.ts pattern),
 *   on a local-midnight Date shaped exactly as node-postgres returns
 *   a pg DATE on a Cairo host. Pristine yields 2026-11-13 for a
 *   2026-11-14 DATE — the child exits 1 and this spec exits 1.
 * - §B-§E pin the three inline sites by source: the fixed
 *   formatLocalCalendarDay call must be present and the UTC slice
 *   absent. The derivation is inline in its service method (not an
 *   exported helper), so a source pin is the honest RED for it — the
 *   same pattern the P7/P8/P9 specs use for wiring that cannot be
 *   driven behaviourally on this host. Each pin is paired with the
 *   §A mechanism contrast proving WHY the slice is wrong.
 * - §F pins the unchanged behaviour: DATE strings pass through, and
 *   the existing UTC-instant assertions still hold on a UTC host.
 *
 * HONEST LIMITS: the trip-expense, fiscal-year and quotation paths
 * are source-pinned, not service-driven (their PGlite DATE round-trip
 * is UTC-midnight, so no RED exists on this host even under a Cairo
 * child). A live-Postgres rehearsal on a Cairo host with a non-Cairo
 * tenant is still owed for the end-to-end paths — see the re-review.
 */

const SRC = path.resolve(__dirname, '../../src');

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

async function main(): Promise<void> {
  // §A — Cairo child: the REAL accountingDateKey on pg-DATE-shaped
  // local-midnight Dates, under TZ=Africa/Cairo. Runs FIRST so the
  // pristine failure is the behavioural one, with the exact assertion.
  const childDir = fs.mkdtempSync(path.join(__dirname, '.tmp-b4p1-'));
  const childTmp = path.join(childDir, 'cairo-check.ts');
  try {
    fs.writeFileSync(
      childTmp,
      `import { accountingDateKey } from '../../../src/modules/accounting/accounting-tax-lock';
import { formatLocalCalendarDay } from '../../../src/common/utils/tenant-timezone.util';
async function main(): Promise<void> {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone !== 'Africa/Cairo') { console.error('child zone is ' + zone + ', want Africa/Cairo'); process.exit(2); }
  const tripDay = new Date(2026, 10, 14);
  const got = accountingDateKey(tripDay);
  if (got !== '2026-11-14') { console.error('accountingDateKey(local-midnight 2026-11-14) = ' + got + ', want 2026-11-14'); process.exit(1); }
  const yearEnd = new Date(2026, 11, 31);
  const gotYear = accountingDateKey(yearEnd);
  if (gotYear !== '2026-12-31') { console.error('accountingDateKey(local-midnight 2026-12-31) = ' + gotYear + ', want 2026-12-31'); process.exit(1); }
  if (accountingDateKey('2026-11-14') !== '2026-11-14') { console.error('accountingDateKey string passthrough broken'); process.exit(1); }
  if (tripDay.toISOString().slice(0, 10) !== '2026-11-13') { console.error('expected the UTC slice to yield 2026-11-13 under Cairo TZ (the bug)'); process.exit(1); }
  if (formatLocalCalendarDay(tripDay) !== '2026-11-14') { console.error('formatLocalCalendarDay must yield 2026-11-14 under Cairo TZ'); process.exit(1); }
  console.log('CAIRO-CHILD-OK');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
`,
    );
    const out = execFileSync('npx', ['ts-node', childTmp], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, TZ: 'Africa/Cairo' },
      timeout: 180000,
      encoding: 'utf8',
    });
    assert.ok(out.includes('CAIRO-CHILD-OK'), `Cairo child must pass (got: ${out.trim()})`);
    console.log('✓ §A passed: accountingDateKey keys a pg DATE to its stored day under Cairo TZ');
  } finally {
    try {
      fs.unlinkSync(childTmp);
    } catch {
      /* already gone */
    }
    try {
      fs.rmSync(childDir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }

  // §B — fiscal-year end_date derivation pin.
  const postingCore = read('modules/accounting/services/journal-posting-core.service.ts');
  assert.ok(
    postingCore.includes('formatLocalCalendarDay(fiscalYear.end_date)'),
    'fiscal-year end_date derives via formatLocalCalendarDay',
  );
  assert.ok(
    !postingCore.includes('fiscalYear.end_date.toISOString().slice(0, 10)'),
    'fiscal-year end_date no longer uses the UTC slice',
  );
  console.log('✓ §B passed: fiscal-year closing comparison keys on the stored year-end day');

  // §C — trip-expense date pin.
  // postSourcingTripExpense lives in the sourcing slice since the
  // import-sales split (slice S2); the pin follows the method, the
  // assertion text is unchanged.
  const sourcing = read('modules/import-sales/services/import-sourcing.service.ts');
  assert.ok(
    sourcing.includes('formatLocalCalendarDay(trip.start_date)'),
    'trip expense date derives via formatLocalCalendarDay',
  );
  assert.ok(
    !sourcing.includes('trip.start_date.toISOString().slice(0, 10)'),
    'trip expense date no longer uses the UTC slice',
  );
  console.log('✓ §C passed: trip expense posts on the trip start day, not the day before');

  // §D — quotation expiry normalizer pin.
  // selectQuotation lives in the commercial slice since the
  // import-sales split (slice S7); the pin follows the method, the
  // assertion text is unchanged.
  const commercial = read('modules/import-sales/services/import-commercial.service.ts');
  assert.ok(
    commercial.includes('return formatLocalCalendarDay(v);'),
    'quotation expiry derives via formatLocalCalendarDay',
  );
  assert.ok(
    !commercial.includes('return v.toISOString().slice(0, 10);'),
    'quotation expiry no longer uses the UTC slice',
  );
  console.log('✓ §D passed: a quotation expiring today is selectable today');

  // §E — period-lock key pin + accountingDateKey doc correction pin.
  const boundaries = read('modules/accounting/accounting-boundaries.ts');
  assert.ok(boundaries.includes('formatLocalCalendarDay(raw)'), 'lock day derives via formatLocalCalendarDay');
  assert.ok(!boundaries.includes('raw.toISOString().slice(0, 10)'), 'lock day no longer uses the UTC slice');
  const taxLock = read('modules/accounting/accounting-tax-lock.ts');
  assert.ok(
    !taxLock.includes('slicing its UTC rendering is exact'),
    'accountingDateKey doc no longer claims the UTC slice is exact',
  );
  console.log('✓ §E passed: period-lock key is the stored lock day, and its doc states the correct premise');

  // §F — regression: unchanged behaviour on this (UTC) host.
  assert.equal(accountingDateKey('2026-11-08'), '2026-11-08', 'stored DATE string passes through');
  assert.equal(
    accountingDateKey(new Date('2026-10-01T00:00:00Z')),
    '2026-10-01',
    'UTC-midnight instant keys to its UTC day on a UTC host (existing pin)',
  );
  assert.equal(
    formatLocalCalendarDay(new Date(2026, 10, 14)),
    '2026-11-14',
    'local-midnight Date keys to its own day on this host',
  );
  console.log('✓ §F passed: string passthrough and UTC-instant behaviour unchanged');

  console.log('CLOCK-B4-P1 CHECKS PASSED');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
