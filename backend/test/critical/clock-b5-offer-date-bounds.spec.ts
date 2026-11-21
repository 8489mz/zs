/*
 * Clock Batch 5 P1 -- offer date bounds keyed from the STORED day
 * (INV-SINGLE-SERVER-CLOCK-TENANT-TZ continuation).
 *
 * THE DEFECT (re-review 2, NEW-A/NEW-B): product_offers.start_date /
 * end_date are pg DATE columns. node-postgres returns a pg DATE as a
 * host-local-midnight Date (postgres-date: new Date(year, month,
 * day)), and there is NO setTypeParser override anywhere in src --
 * but the offer normalizers assumed the opposite ("PostgreSQL DATE
 * values arrive as UTC-midnight Date objects") and UTC-sliced the
 * bounds. On any host east of UTC an offer ending today was inactive
 * today and an offer starting tomorrow was active today, in four
 * money paths: the POS/van selector (isOfferActive), van pre-sales
 * (two sites), the storefront (isOfferActiveNow), and the catalog
 * offers map (fetchPosOffers). The same UTC slice also moved the
 * installment-interest recognition day one day early (NEW-B), made
 * the pharmacy frozen-expiry guard reject legitimate edits (a
 * same-day DTO-vs-stored comparison), made the container-deposit
 * idempotency check fail a same-payload retry with a spurious
 * duplicate-key conflict, and shifted every van holiday a day early
 * in the rep working-day set.
 *
 * THE FIX (one package, shared root cause): the canonical place is
 * the normalizers. A new shared normalizePgDateOnly (tenant-timezone
 * .util, next to formatLocalCalendarDay) keys pg DATE inputs from the
 * host-local calendar parts; the generic normalizeDateOnly keeps its
 * UTC slice for UTC-midnight Dates built from DTO date-only strings
 * (the two shapes are separated per call site -- a blanket switch
 * would break the DTO shape, which business-date-sales-ops pins).
 * The offer paths, the installment dueDay, the pharmacy expiry
 * text, the deposit dateKey and the holiday iteration all use the
 * pg-aware shape now.
 *
 * RED DESIGN: PGlite returns DATE columns as UTC-midnight Dates, so
 * a plain PGlite spec CANNOT red this on a UTC host. The red runs
 * through a TZ=Africa/Cairo child process (the business-date-display
 * pattern) driving the REAL isOfferActive / isOfferActiveNow with a
 * local-midnight Date -- the shape node-postgres delivers for a pg
 * DATE. On pristine the child prints OFFER_ENDS_TODAY=false (the
 * offer ending today is inactive); on the fixed tree it prints true.
 * The PGlite sections are pins (green on both trees): they prove the
 * wiring still works after the edit. The NEW-B dueDay, pharmacy
 * expiry, deposit dateKey and the van-pre-sales / catalog call sites
 * are source-pinned (the P7/P9 pattern) plus a mechanism proof in
 * the Cairo child.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  isOfferActive,
  normalizeDateOnly,
} from '../../src/modules/sales/helpers/sales-write.helper';
import {
  isOfferActiveNow,
  normalizeDateOnly as storefrontNormalizeDateOnly,
} from '../../src/modules/storefront/engines/storefront-offers.engine';
import { formatLocalCalendarDay } from '../../src/common/utils/tenant-timezone.util';
import { getMonthlyOfficialHolidayDates } from '../../src/modules/delivery-reps/services/van-common.util';

const BACKEND_ROOT = path.resolve(__dirname, '../..');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_ROOT, 'src', rel), 'utf8');
}

async function main(): Promise<void> {
  // ---- §0: Cairo-child mechanism + the genuine RED ----
  // A local-midnight Date is what node-postgres delivers for a pg
  // DATE. Under TZ=Africa/Cairo the UTC slice renders the previous
  // day; the local parts render the stored day. The child runs the
  // REAL isOfferActive / isOfferActiveNow / resolveBestStorefrontOffer.
  const childDir = fs.mkdtempSync(path.join(__dirname, '.tmp-b5p1-'));
  const childFile = path.join(childDir, 'offer-date-bounds-check.ts');
  try {
    fs.writeFileSync(
      childFile,
      `import { isOfferActive, normalizeDateOnly } from '../../../src/modules/sales/helpers/sales-write.helper';
import { isOfferActiveNow, resolveBestStorefrontOffer } from '../../../src/modules/storefront/engines/storefront-offers.engine';
import { formatLocalCalendarDay } from '../../../src/common/utils/tenant-timezone.util';
const lm = (y: number, m: number, d: number): Date => new Date(y, m - 1, d);
const noon = new Date(2026, 10, 14, 12, 0, 0);
const out: string[] = [];
out.push('MECH_UTC_SLICE=' + lm(2026, 11, 14).toISOString().slice(0, 10));
out.push('MECH_LOCAL_PARTS=' + formatLocalCalendarDay(lm(2026, 11, 14)));
out.push('GENERIC_KEPT=' + normalizeDateOnly(lm(2026, 11, 14)));
out.push('OFFER_ENDS_TODAY=' + isOfferActive({ start_date: lm(2026, 11, 14), end_date: lm(2026, 11, 14) }, '2026-11-14', noon));
out.push('OFFER_STARTS_TOMORROW=' + isOfferActive({ start_date: lm(2026, 11, 15) }, '2026-11-14', noon));
out.push('OFFER_ENDED_YESTERDAY=' + isOfferActive({ end_date: lm(2026, 11, 13) }, '2026-11-14', noon));
out.push('SF_ENDS_TODAY=' + isOfferActiveNow({ offer_type: 'percent', value: 20, start_date: lm(2026, 11, 14), end_date: lm(2026, 11, 14), is_active: true }, '2026-11-14', noon, 'Africa/Cairo'));
out.push('SF_STARTS_TOMORROW=' + isOfferActiveNow({ offer_type: 'percent', value: 20, start_date: lm(2026, 11, 15), is_active: true }, '2026-11-14', noon, 'Africa/Cairo'));
const sf = resolveBestStorefrontOffer(100, [{ offer_type: 'percent', value: 20, is_active: true, start_date: lm(2026, 11, 14), end_date: lm(2026, 11, 14) }], 1, '2026-11-14', noon, 'Africa/Cairo', 2);
out.push('SF_BEST_HAS_DISCOUNT=' + sf.hasDiscount);
out.push('DUE_DAY_OLD=' + new Date(lm(2026, 11, 14)).toISOString().slice(0, 10));
out.push('DUE_DAY_NEW=' + formatLocalCalendarDay(lm(2026, 11, 14)));
console.log(out.join('\\n'));
`,
    );
    const childOut = execFileSync('npx', ['ts-node', childFile], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, TZ: 'Africa/Cairo' },
      timeout: 180000,
      encoding: 'utf8',
    });
    console.log(childOut.trim());
    const line = (key: string): string => {
      const found = childOut.split('\n').find((l) => l.startsWith(key + '='));
      assert.ok(found, `child must print ${key}`);
      return found.slice(key.length + 1);
    };
    // Mechanism: the UTC slice is the previous day under Cairo TZ.
    assert.equal(line('MECH_UTC_SLICE'), '2026-11-13');
    assert.equal(line('MECH_LOCAL_PARTS'), '2026-11-14');
    // The generic normalizer keeps its UTC slice (DTO shape) -- the
    // fix did NOT blanket-switch it.
    assert.equal(line('GENERIC_KEPT'), '2026-11-13');
    // THE RED (fails on pristine, passes on the fixed tree): an
    // offer ending today is active today; one starting tomorrow is
    // not; one that ended yesterday is not.
    assert.equal(line('OFFER_ENDS_TODAY'), 'true', 'offer ending today must be active today');
    assert.equal(line('OFFER_STARTS_TOMORROW'), 'false');
    assert.equal(line('OFFER_ENDED_YESTERDAY'), 'false');
    assert.equal(line('SF_ENDS_TODAY'), 'true', 'storefront offer ending today must be active today');
    assert.equal(line('SF_STARTS_TOMORROW'), 'false');
    assert.equal(line('SF_BEST_HAS_DISCOUNT'), 'true', 'storefront must discount the offer ending today');
    // NEW-B mechanism: the old dueDay expression renders the
    // previous day; the local-parts expression renders the due day.
    assert.equal(line('DUE_DAY_OLD'), '2026-11-13');
    assert.equal(line('DUE_DAY_NEW'), '2026-11-14');
    console.log('✓ §0 passed: Cairo child proves the stored day keys (offer bounds + dueDay mechanism)');
  } finally {
    try {
      fs.unlinkSync(childFile);
    } catch {
      /* already gone */
    }
    try {
      fs.rmSync(childDir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }

  // ---- §A: the pg-aware normalizer itself (dynamic import: the
  // export does not exist on pristine, so a static import would fail
  // the whole spec to load before §0 ever runs) ----
  const tzMod: any = await import('../../src/common/utils/tenant-timezone.util');
  const normalizePgDateOnly = tzMod.normalizePgDateOnly as ((v: unknown) => string) | undefined;
  assert.ok(typeof normalizePgDateOnly === 'function', 'normalizePgDateOnly must exist (clock B5-P1)');
  // Local-midnight Dates key to their stored day on every host.
  assert.equal(normalizePgDateOnly(new Date(2026, 0, 15)), '2026-01-15');
  assert.equal(normalizePgDateOnly(new Date(2026, 10, 14)), '2026-11-14');
  assert.equal(normalizePgDateOnly('2026-01-15'), '2026-01-15');
  assert.equal(normalizePgDateOnly('15 Jan 2026'), '2026-01-15');
  assert.equal(normalizePgDateOnly(''), '');
  assert.equal(normalizePgDateOnly(new Date(Number.NaN)), '');
  assert.equal(normalizePgDateOnly(null), '');
  console.log('✓ §A passed: normalizePgDateOnly keys pg DATEs from local parts, strings pass through');

  // ---- §B: the DTO shape is preserved (generic normalizers keep
  // the UTC slice for UTC-midnight Dates built from date-only
  // strings) ----
  assert.equal(normalizeDateOnly(new Date('2026-01-15T00:00:00.000Z')), '2026-01-15');
  assert.equal(normalizeDateOnly('15 Jan 2026'), '2026-01-15');
  assert.equal(normalizeDateOnly('2026-01-15'), '2026-01-15');
  assert.equal(normalizeDateOnly(''), '');
  assert.equal(storefrontNormalizeDateOnly(new Date('2026-11-08T00:00:00.000Z')), '2026-11-08');
  assert.equal(storefrontNormalizeDateOnly('2026-11-08'), '2026-11-08');
  // String bounds still drive the selector (the ::text loaders and
  // every spec fixture pass strings).
  const localNoon = new Date(2026, 10, 14, 12, 0, 0);
  assert.equal(isOfferActive({ start_date: '2026-11-14', end_date: '2026-11-14' }, '2026-11-14', localNoon), true);
  assert.equal(isOfferActive({ start_date: '2026-11-15' }, '2026-11-14', localNoon), false);
  assert.equal(
    isOfferActiveNow({ offer_type: 'percent', value: 20, start_date: '2026-11-14', end_date: '2026-11-14', is_active: true }, '2026-11-14', localNoon, 'Africa/Cairo'),
    true,
  );
  console.log('✓ §B passed: DTO shape preserved in both generic normalizers; string bounds still work');

  // ---- §C: NEW-B -- the installment-interest dueDay is source-
  // pinned (PGlite returns DATE as UTC-midnight, so no service RED
  // exists on this host; the mechanism is proven in §0 and the
  // posting method still runs -- see posting-book-precision.spec.ts
  // in the related run) ----
  const cashPosting = readSrc('modules/accounting/services/inventory-manufacturing-cash-posting/installment-interest.slice.ts');
  assert.ok(
    cashPosting.includes('formatLocalCalendarDay(item.due_date)'),
    'dueDay must key from local calendar parts',
  );
  assert.ok(!cashPosting.includes('new Date(item.due_date).toISOString()'), 'the UTC-sliced dueDay must be gone');
  console.log('✓ §C passed: installment-interest dueDay keys from the stored day');

  // ---- §D: C1/C2 -- pharmacy expiry + deposit dateKey are
  // source-pinned (both are file-private; the mixed-shape
  // comparison is proven by the §0 mechanism: a DTO day string
  // keys to the written day while a stored local-midnight Date
  // UTC-sliced to the previous day) ----
  const pharmacy = readSrc('modules/pharmacy/pharmacy/pharmacy-helpers.slice.ts');
  assert.ok(
    pharmacy.includes('if (value instanceof Date) return formatLocalCalendarDay(value);'),
    'pharmacyExpiryText must key stored expiries from local parts',
  );
  assert.ok(
    !pharmacy.includes('if (value instanceof Date) return value.toISOString().slice(0, 10);'),
    'the UTC-sliced pharmacy expiry must be gone',
  );
  const importSales = readSrc('modules/import-sales/import-container-helpers/import-container-helpers.ts');
  assert.ok(
    /dateKey[\s\S]{0,900}formatLocalCalendarDay\(value\)/.test(importSales),
    'dateKey must key stored return dates from local parts',
  );
  console.log('✓ §D passed: pharmacy expiry + deposit dateKey key stored days from local parts');

  // ---- §E: holiday iteration -- driven on PGlite (pin: PGlite
  // returns DATE as UTC-midnight, so the old code also passes here;
  // the Cairo-child mechanism in §0 is the proof) + source pin ----
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(
      `CREATE TABLE hr_holidays (id bigint PRIMARY KEY, tenant_id text, start_date date, end_date date);
       INSERT INTO hr_holidays VALUES (1, 't1', '2026-11-14', '2026-11-14');
       INSERT INTO hr_holidays VALUES (2, 't1', '2026-11-10', '2026-11-12');`,
    );
    const holidays = await getMonthlyOfficialHolidayDates(db, 't1', new Date(2026, 10, 1), new Date(2026, 10, 30, 23, 59, 59));
    assert.ok(holidays.includes('2026-11-14'), `holiday ending today must be in the set (got ${holidays.join(',')})`);
    assert.ok(holidays.includes('2026-11-10') && holidays.includes('2026-11-11') && holidays.includes('2026-11-12'));
    assert.ok(!holidays.includes('2026-11-13'), 'no day is shifted a day early');
    const vanCommon = readSrc('modules/delivery-reps/services/van-common.util.ts');
    assert.ok(vanCommon.includes('formatLocalCalendarDay(startOfMonth)'), 'month bounds must key from local parts');
    assert.ok(vanCommon.includes('formatLocalCalendarDay(cur)'), 'iterated holiday days must key from local parts');
    assert.ok(!vanCommon.includes('toISOString().slice(0, 10)'), 'no UTC slice may remain in the holiday iteration');
    console.log('✓ §E passed: holiday set carries the stored days (PGlite pin + source pin)');
  } finally {
    await db.destroy();
  }

  // ---- §F: the van-pre-sales + catalog call sites are wired to
  // the pg-aware shape (source pins; the shared function is proven
  // in §0/§A and the selector is the decision point) ----
  // File #53 split: the offer-date sites moved to the S1 (warehouse-catalog)
  // + S2 (create-pre-sales-order) slices; the facade keeps only delegates.
  const vanPreSales =
    readSrc('modules/delivery-reps/services/van-pre-sales/warehouse-catalog.ts') +
    readSrc('modules/delivery-reps/services/van-pre-sales/create-pre-sales-order.ts');
  assert.ok(vanPreSales.includes('normalizePgDateOnly(off.start_date)'), 'van pre-sales must use the pg-aware normalizer');
  assert.ok(!vanPreSales.includes('normalizeDateOnly(off.start_date)'), 'van pre-sales must not use the UTC slice on stored bounds');
  // The catalog offers map lives in the P4 pos slice now (catalog-product
  // split 2026-11-16); the facade keeps only a delegate. normalizePgDateOnly
  // is imported into the slice, and the old private normalizeDateOnly is gone.
  const catalog = readSrc('modules/catalog/services/catalog-product-pos.service.ts');
  assert.ok(catalog.includes('normalizePgDateOnly(offer.start_date)'), 'catalog offers map must use the pg-aware normalizer');
  assert.ok(!catalog.includes('this.normalizeDateOnly(offer.start_date)'), 'the catalog UTC-slice normalizer must be gone');
  assert.ok(!catalog.includes('private normalizeDateOnly'), 'the catalog private UTC-slice normalizer must be deleted');
  const salesHelper = readSrc('modules/sales/helpers/sales-write.helper.ts');
  assert.ok(salesHelper.includes('normalizePgDateOnly(offer.start_date)'), 'isOfferActive must use the pg-aware normalizer');
  const storefront = readSrc('modules/storefront/engines/storefront-offers.engine.ts');
  assert.ok(storefront.includes('normalizePgDateOnly(offer.start_date)'), 'isOfferActiveNow must use the pg-aware normalizer');
  console.log('✓ §F passed: van pre-sales + catalog + both selectors wired to normalizePgDateOnly');

  console.log('CLOCK-B5-P1 CHECKS PASSED');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
