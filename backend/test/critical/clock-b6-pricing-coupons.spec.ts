/*
 * Clock Batch 6 P1 -- pricing-preview offer check + storefront coupon
 * date bounds (INV-SINGLE-SERVER-CLOCK-TENANT-TZ continuation).
 *
 * THE DEFECTS (re-review 3, NEW-H / NEW-I -- the same day-granularity
 * family as NEW-A): a DATE bound is a whole calendar day, never an
 * instant.
 *
 * NEW-H: pricing.service.ts isOfferActive compared Date.now() against
 * new Date(pg DATE).getTime(). product_offers.start_date/end_date are
 * pg DATE columns, so node-postgres delivers local-midnight Dates and
 * the end instant is midnight at the START of the end day: an offer
 * ending today was inactive for its WHOLE last day. The preview's
 * skipActiveOffers flag then failed to skip those products, and a bulk
 * repricing run overwrote their offer prices (apply() runs the same
 * buildPreview flow). The first re-review had classified this site
 * "tz-independent, correctly untouched" -- instant comparison IS
 * tz-independent, but the instant is derived from a DATE, so the
 * boundary is wrong in ALL cases on the end side. The fix keys the
 * bounds through normalizePgDateOnly against the tenant day, the B5-P1
 * pattern; fetchPreviewFlags resolves the tenant zone once.
 *
 * NEW-I: storefront_coupons.start_date/end_date are TIMESTAMPTZ
 * (migration 2040000000031:20-21) and the DTO takes bare strings, but
 * the writes did new Date(dto.startDate): a date-only string stores
 * as UTC midnight, so the instant read comparisons killed the coupon
 * at 02:00 Cairo on its last day (and started it 2h late). LATENT:
 * the shipped admin UI sends no dates at all, so it fires only on a
 * direct API call with a date-only string. Canonical semantics,
 * decided here and pinned below: a coupon date means the WHOLE tenant
 * day. The write normalizes date-only strings to the tenant day's
 * bounds (couponBoundInstant); the reads compare calendar days in the
 * tenant zone (couponDayState) -- which also heals rows already stored
 * as UTC midnight by the old write.
 *
 * RED DESIGN: §0 is the genuine RED for NEW-H -- a TZ=Africa/Cairo
 * child drives the REAL (private) pricing isOfferActive with
 * local-midnight Dates, the shape node-postgres delivers for a pg
 * DATE, and a todayKey derived from the real clock inside the child,
 * so the RED is time-independent. On pristine the method ignores the
 * second argument and compares instants: OFFER_ENDS_TODAY=false.
 * §B is the genuine RED for NEW-I -- the REAL createCoupon /
 * updateCoupon on PGlite round-trip the stored bounds: on pristine
 * the stored start is UTC midnight, on the fixed tree it is the
 * tenant day's start. §C pins couponDayState directly (fixed-tree
 * behavior); §D/§E are PGlite pins driving the REAL validateCoupon /
 * preview end to end (green on the fixed tree at any hour -- the
 * todayKey is derived from the real clock, never hardcoded).
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
import { todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import { addDaysToDayKey } from '../../src/common/utils/client-date-bounds.util';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { StorefrontService } from '../../src/modules/storefront/storefront.service';

const BACKEND_ROOT = path.resolve(__dirname, '../..');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_ROOT, 'src', rel), 'utf8');
}

// The storefront split (2026-11-16): the facade is a thin delegate shell;
// the coupon pins live in the T8 slice (validate/create/update) and the
// checkout pin in the T1 slice, so source pins read the facade + all slices.
const STOREFRONT_FILES = [
  'modules/storefront/storefront.service.ts',
  'modules/storefront/storefront-helpers.ts',
  'modules/storefront/services/storefront-coupons.service.ts',
  'modules/storefront/services/storefront-order-quote.service.ts',
  'modules/storefront/services/storefront-catalog-detail.service.ts',
  'modules/storefront/services/storefront-catalog.service.ts',
  'modules/storefront/services/storefront-customer-orders.service.ts',
  'modules/storefront/services/storefront-order-create.service.ts',
  'modules/storefront/services/storefront-settings.service.ts',
  'modules/storefront/services/storefront-engagement.service.ts',
  'modules/storefront/services/storefront-merchant-orders.service.ts',
  'modules/storefront/services/storefront-order-convert.service.ts',
  'modules/storefront/services/storefront-table-bill.service.ts',
];
function readStorefrontSrc(): string {
  return STOREFRONT_FILES.map((f) => readSrc(f)).join('\n');
}

async function main(): Promise<void> {
  // ---- §0: Cairo-child mechanism + the genuine RED for NEW-H ----
  // A local-midnight Date is what node-postgres delivers for a pg
  // DATE. Under TZ=Africa/Cairo the UTC slice renders the previous
  // day; the local parts render the stored day. The child runs the
  // REAL pricing isOfferActive (private -- reached by bracket access,
  // the method itself is production code) with a todayKey derived
  // from the real clock inside the child, so the RED does not depend
  // on the hour or the date the suite runs.
  const childDir = fs.mkdtempSync(path.join(__dirname, '.tmp-b6p1-'));
  const childFile = path.join(childDir, 'pricing-offer-check.ts');
  try {
    fs.writeFileSync(
      childFile,
      `import 'reflect-metadata';
import { PricingService } from '../../../src/modules/pricing/pricing.service';
import { formatLocalCalendarDay } from '../../../src/common/utils/tenant-timezone.util';
const svc: any = new PricingService({} as any, {} as any);
const nowLocal = new Date();
const todayKey = formatLocalCalendarDay(nowLocal);
const day = (offset: number): Date => new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate() + offset);
const out: string[] = [];
out.push('MECH_UTC_SLICE=' + day(0).toISOString().slice(0, 10));
out.push('MECH_LOCAL_PARTS=' + formatLocalCalendarDay(day(0)));
out.push('MECH_TODAY_KEY=' + todayKey);
out.push('OFFER_ENDS_TODAY=' + svc.isOfferActive({ product_id: 1, is_active: true, start_date: day(0), end_date: day(0) }, todayKey));
out.push('OFFER_STARTS_TOMORROW=' + svc.isOfferActive({ product_id: 1, is_active: true, start_date: day(1), end_date: null }, todayKey));
out.push('OFFER_ENDED_YESTERDAY=' + svc.isOfferActive({ product_id: 1, is_active: true, start_date: null, end_date: day(-1) }, todayKey));
out.push('OFFER_INACTIVE_FLAG=' + svc.isOfferActive({ product_id: 1, is_active: false, start_date: day(0), end_date: day(0) }, todayKey));
out.push('OFFER_STRING_BOUNDS=' + svc.isOfferActive({ product_id: 1, is_active: true, start_date: todayKey, end_date: todayKey }, todayKey));
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
    assert.equal(line('MECH_UTC_SLICE'), addDaysToDayKey(line('MECH_TODAY_KEY'), -1));
    assert.equal(line('MECH_LOCAL_PARTS'), line('MECH_TODAY_KEY'));
    // THE RED (fails on pristine, passes on the fixed tree): an offer
    // ending today is active today; one starting tomorrow is not; one
    // that ended yesterday is not; is_active=false stays inactive.
    // String bounds (the ::text loader shape) still work.
    assert.equal(line('OFFER_ENDS_TODAY'), 'true', 'offer ending today must be active today');
    assert.equal(line('OFFER_STARTS_TOMORROW'), 'false');
    assert.equal(line('OFFER_ENDED_YESTERDAY'), 'false');
    assert.equal(line('OFFER_INACTIVE_FLAG'), 'false');
    assert.equal(line('OFFER_STRING_BOUNDS'), 'true');
    console.log('✓ §0 passed: Cairo child proves the pricing-preview offer keys the stored day');
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

  // ---- §A: the new coupon helpers exist and pin the tenant-day
  // bounds (dynamic import: the exports do not exist on pristine, so
  // a static import would fail the whole spec to load before §0 ever
  // runs) ----
  const tzMod: any = await import('../../src/common/utils/tenant-timezone.util');
  const couponBoundInstant = tzMod.couponBoundInstant as
    ((v: unknown, tz: string, isEnd: boolean) => Date | null) | undefined;
  const couponDayState = tzMod.couponDayState as
    ((s: unknown, e: unknown, todayKey: string, tz: string) => string) | undefined;
  const tenantDayStartInstant = tzMod.tenantDayStartInstant as ((d: string, tz: string) => Date) | undefined;
  const tenantDayEndInstant = tzMod.tenantDayEndInstant as ((d: string, tz: string) => Date) | undefined;
  assert.ok(typeof couponBoundInstant === 'function', 'couponBoundInstant must exist (clock B6-P1)');
  assert.ok(typeof couponDayState === 'function', 'couponDayState must exist (clock B6-P1)');
  assert.ok(typeof tenantDayStartInstant === 'function', 'tenantDayStartInstant must exist (clock B6-P1)');
  assert.ok(typeof tenantDayEndInstant === 'function', 'tenantDayEndInstant must exist (clock B6-P1)');
  // A date-only string stores as the tenant day's bounds, not UTC
  // midnight: Cairo is UTC+2 (no DST in November), New York is
  // UTC-5 (EST -- DST ended 2026-11-01).
  assert.equal(tenantDayStartInstant('2026-11-14', 'Africa/Cairo').toISOString(), '2026-11-13T22:00:00.000Z');
  assert.equal(tenantDayEndInstant('2026-11-14', 'Africa/Cairo').toISOString(), '2026-11-14T21:59:59.999Z');
  assert.equal(tenantDayStartInstant('2026-11-14', 'America/New_York').toISOString(), '2026-11-14T05:00:00.000Z');
  assert.equal(tenantDayEndInstant('2026-11-14', 'America/New_York').toISOString(), '2026-11-15T04:59:59.999Z');
  assert.equal(couponBoundInstant('2026-11-14', 'Africa/Cairo', false)?.toISOString(), '2026-11-13T22:00:00.000Z');
  assert.equal(couponBoundInstant('2026-11-14', 'Africa/Cairo', true)?.toISOString(), '2026-11-14T21:59:59.999Z');
  // A full ISO timestamp passes through untouched -- an explicit
  // instant means what it says; only date-only input is normalized.
  assert.equal(
    couponBoundInstant('2026-11-14T10:00:00.000Z', 'Africa/Cairo', true)?.toISOString(),
    '2026-11-14T10:00:00.000Z',
  );
  const passthrough = new Date('2026-11-14T10:00:00.000Z');
  assert.equal(couponBoundInstant(passthrough, 'Africa/Cairo', false)?.toISOString(), '2026-11-14T10:00:00.000Z');
  assert.equal(couponBoundInstant('', 'Africa/Cairo', false), null);
  assert.equal(couponBoundInstant(undefined, 'Africa/Cairo', false), null);
  assert.equal(couponBoundInstant(null, 'Africa/Cairo', true), null);
  console.log('✓ §A passed: coupon bounds normalize date-only strings to tenant-day bounds');

  // ---- §B: the genuine RED for NEW-I -- the REAL createCoupon /
  // updateCoupon on PGlite round-trip the stored bounds ----
  // The todayKey is derived from the real clock, so this runs green
  // on the fixed tree at any hour; on pristine the stored start is
  // UTC midnight and both assertions fail.
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(
      `CREATE TABLE settings (tenant_id text, key text, value text);
       INSERT INTO settings VALUES ('t1', 'timezone', '"Africa/Cairo"');
       CREATE TABLE storefront_coupons (
         id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         tenant_id text, account_id text, code text, discount_type text,
         discount_value numeric(12,2), min_order_amount numeric(12,2),
         max_discount_amount numeric(12,2), usage_limit integer,
         times_used integer, is_active boolean,
         start_date timestamptz, end_date timestamptz,
         created_at timestamptz, updated_at timestamptz);
       CREATE TABLE tenants (id text PRIMARY KEY, slug text);
       INSERT INTO tenants VALUES ('t1', 'shop');`,
    );
    const storefront = new StorefrontService(db as any, {} as any, {} as any, {} as any);
    const actor: any = { userId: 1, username: 'tester', tenantId: 't1', accountId: 'a1' };
    const created: any = await storefront.createCoupon(
      {
        code: 'SAVE10',
        discountType: 'percentage',
        discountValue: 10,
        startDate: '2026-11-14',
        endDate: '2026-11-14',
      } as any,
      actor,
    );
    assert.equal(created.ok, true);
    // The stored bounds are the tenant day's bounds, not UTC midnight.
    assert.equal(new Date(created.coupon.start_date).toISOString(), '2026-11-13T22:00:00.000Z');
    assert.equal(new Date(created.coupon.end_date).toISOString(), '2026-11-14T21:59:59.999Z');
    await storefront.updateCoupon(Number(created.coupon.id), { endDate: '2026-11-15' } as any, actor);
    const updated: any = await db
      .selectFrom('storefront_coupons')
      .select(['start_date', 'end_date'])
      .where('id', '=', Number(created.coupon.id))
      .executeTakeFirstOrThrow();
    assert.equal(new Date(updated.start_date).toISOString(), '2026-11-13T22:00:00.000Z');
    assert.equal(new Date(updated.end_date).toISOString(), '2026-11-15T21:59:59.999Z');
    console.log('✓ §B passed: real create/update store the tenant-day bounds (RED on pristine: UTC midnight)');

    // ---- §C: couponDayState on the stored shapes ----
    const now = new Date();
    const cairoToday = todayTenantDate('Africa/Cairo', now);
    const cairoYesterday = addDaysToDayKey(cairoToday, -1)!;
    const cairoTomorrow = addDaysToDayKey(cairoToday, 1)!;
    // A legacy row stored as UTC midnight (the old write) is active
    // for its whole tenant day under the day-key read.
    assert.equal(couponDayState(new Date(`${cairoToday}T00:00:00.000Z`), null, cairoToday, 'Africa/Cairo'), 'active');
    assert.equal(couponDayState(null, new Date(`${cairoToday}T00:00:00.000Z`), cairoToday, 'Africa/Cairo'), 'active');
    // The new end-of-day bound is active on its day too.
    assert.equal(couponDayState(null, new Date(`${cairoToday}T21:59:59.999Z`), cairoToday, 'Africa/Cairo'), 'active');
    assert.equal(
      couponDayState(new Date(`${cairoYesterday}T00:00:00.000Z`), null, cairoToday, 'Africa/Cairo'),
      'active',
    );
    assert.equal(
      couponDayState(null, new Date(`${cairoYesterday}T00:00:00.000Z`), cairoToday, 'Africa/Cairo'),
      'expired',
    );
    assert.equal(
      couponDayState(new Date(`${cairoTomorrow}T00:00:00.000Z`), null, cairoToday, 'Africa/Cairo'),
      'not-started',
    );
    assert.equal(couponDayState(null, null, cairoToday, 'Africa/Cairo'), 'active');
    assert.equal(couponDayState(new Date('invalid'), null, cairoToday, 'Africa/Cairo'), 'active');
    console.log('✓ §C passed: couponDayState keys the stored bounds on the tenant day');

    // ---- §D: PGlite pin -- the REAL validateCoupon end to end ----
    // A legacy UTC-midnight end on the Cairo today validates; one
    // that ended yesterday does not. Green on the fixed tree at any
    // hour (the todayKey is derived from the real clock).
    await pg.exec(
      `INSERT INTO storefront_coupons
         (tenant_id, account_id, code, discount_type, discount_value, min_order_amount,
          max_discount_amount, usage_limit, times_used, is_active, start_date, end_date,
          created_at, updated_at)
       VALUES
         ('t1', 'a1', 'LEGACY', 'fixed', 5, 0, NULL, NULL, 0, true, NULL, '${cairoToday}T00:00:00.000Z', now(), now()),
         ('t1', 'a1', 'OLD', 'fixed', 5, 0, NULL, NULL, 0, true, NULL, '${cairoYesterday}T00:00:00.000Z', now(), now());`,
    );
    const legacy: any = await storefront.validateCoupon('shop', 'LEGACY', 100);
    assert.equal(
      legacy.ok,
      true,
      `legacy UTC-midnight coupon must validate on its tenant day (got ${JSON.stringify(legacy)})`,
    );
    const old: any = await storefront.validateCoupon('shop', 'OLD', 100);
    assert.equal(old.ok, false);
    assert.match(String(old.message), /انتهت/);
    console.log('✓ §D passed: real validateCoupon honors the tenant day for legacy rows');
  } finally {
    await db.destroy();
  }

  // ---- §E: PGlite pin -- the REAL pricing preview end to end ----
  const pg2 = new PGlite();
  const db2 = new Kysely<Database>({ dialect: new PGliteDialect(pg2) });
  try {
    await pg2.exec(
      `CREATE TABLE settings (tenant_id text, key text, value text);
       INSERT INTO settings VALUES ('t1', 'timezone', '"Africa/Cairo"');
       CREATE TABLE products (
         id bigint PRIMARY KEY, name text, barcode text, item_kind text,
         style_code text, category_id bigint, supplier_id bigint,
         cost_price numeric(12,2), retail_price numeric(12,2),
         wholesale_price numeric(12,2), stock_qty numeric(12,2),
         is_active boolean, tenant_id text);
       CREATE TABLE product_pricing_profiles (
         product_id bigint, pricing_group_key text, pricing_mode text, tenant_id text);
       CREATE TABLE product_offers (
         product_id bigint, is_active boolean, start_date date, end_date date, tenant_id text);
       CREATE TABLE product_customer_prices (product_id bigint, tenant_id text);`,
    );
    const cairoToday = todayTenantDate('Africa/Cairo', new Date());
    await pg2.exec(
      `INSERT INTO products VALUES
         (1, 'Offer item', '111', 'standard', NULL, NULL, NULL, 50, 100, 90, 10, true, 't1'),
         (2, 'Plain item', '222', 'standard', NULL, NULL, NULL, 50, 100, 90, 10, true, 't1');
       INSERT INTO product_offers VALUES (1, true, '${cairoToday}', '${cairoToday}', 't1');`,
    );
    const pricing = new PricingService(db2 as any, {} as any);
    const actor: any = { userId: 1, username: 'tester', tenantId: 't1', accountId: 'a1' };
    const preview: any = await pricing.preview(
      {
        filters: { q: '', activeOnly: true, inStockOnly: false },
        operation: { type: 'percent_increase', value: 10 },
        targets: ['retail'],
        rounding: { mode: 'nearest', nearestStep: 0.5 },
        options: {
          applyToWholeStyleCode: false,
          applyToPricingGroup: false,
          skipActiveOffers: true,
          skipCustomerPrices: false,
          skipManualExceptions: false,
        },
        paging: { page: 1, pageSize: 50 },
      } as any,
      actor,
    );
    const offered = preview.rows.find((r: any) => r.productId === 1);
    const plain = preview.rows.find((r: any) => r.productId === 2);
    assert.ok(offered, 'the offered product must be in the preview');
    assert.equal(offered.hasActiveOffer, true, 'the offer ending today must count as active');
    assert.equal(offered.skipped, true);
    assert.ok(
      offered.skipReasons.includes('offer'),
      `skip reasons must include 'offer' (got ${offered.skipReasons.join(',')})`,
    );
    assert.ok(
      plain && plain.hasActiveOffer === false && plain.skipped === false,
      'the plain product must not be skipped',
    );
    assert.equal(preview.summary.skippedOfferCount, 1);
    console.log('✓ §E passed: real preview skips the product whose offer ends today');
  } finally {
    await db2.destroy();
  }

  // ---- §F: wiring source pins ----
  const pricing = readSrc('modules/pricing/pricing.service.ts');
  assert.ok(
    pricing.includes('getTenantTimezone(this.db, this.tenantScope(actor).tenantId)'),
    'fetchPreviewFlags must resolve the tenant zone',
  );
  assert.ok(pricing.includes('todayTenantDate(tenantTimezone)'), 'fetchPreviewFlags must key today in the tenant zone');
  assert.ok(pricing.includes('this.isOfferActive(offer, todayKey)'), 'fetchPreviewFlags must pass the tenant day key');
  assert.ok(
    pricing.includes('normalizePgDateOnly(offer.start_date)'),
    'isOfferActive must key the start bound from the stored day',
  );
  assert.ok(
    pricing.includes('normalizePgDateOnly(offer.end_date)'),
    'isOfferActive must key the end bound from the stored day',
  );
  const isOfferActiveBody = pricing.slice(pricing.indexOf('private isOfferActive'));
  assert.ok(!isOfferActiveBody.includes('Date.now()'), 'isOfferActive must not compare instants');
  assert.ok(!isOfferActiveBody.includes('getTime()'), 'isOfferActive must not derive instants from the bounds');
  const storefront = readStorefrontSrc();
  assert.ok(
    storefront.includes('couponDayState(coupon.start_date, coupon.end_date, couponTodayKey, couponTimezone)'),
    'checkout must read the coupon by tenant day',
  );
  assert.ok(
    storefront.includes(
      'couponState = couponDayState(coupon.start_date, coupon.end_date, couponTodayKey, couponTimezone)',
    ),
    'validate must read the coupon by tenant day',
  );
  assert.ok(
    storefront.includes('couponBoundInstant(dto.startDate, businessTimezone, false)'),
    'create/update must store the start bound by tenant day',
  );
  assert.ok(
    storefront.includes('couponBoundInstant(dto.endDate, businessTimezone, true)'),
    'create/update must store the end bound by tenant day',
  );
  assert.ok(!storefront.includes('new Date(dto.startDate)'), 'the UTC-midnight coupon write must be gone');
  assert.ok(!storefront.includes('new Date(dto.endDate)'), 'the UTC-midnight coupon write must be gone');
  assert.ok(!storefront.includes('new Date(coupon.start_date)'), 'the instant coupon-start read must be gone');
  assert.ok(!storefront.includes('new Date(coupon.end_date)'), 'the instant coupon-end read must be gone');
  console.log('✓ §F passed: both fixes are wired at the decision points, old instant code gone');

  console.log('CLOCK-B6-P1 CHECKS PASSED');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
