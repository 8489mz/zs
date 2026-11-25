/*
 * New file: backend/test/critical/fmcg-promotion-date-mapping.spec.ts
 *
 * WHAT THIS PINS (money bug, separate from Category 1-a UTC-vs-local):
 * VanPromotionsService.mapPromotionRow did String(r.start_date).slice(0, 10)
 * on pg DATE values. node-postgres returns a DATE column as a local-midnight
 * JS Date, so String() is "Sat Nov 14 2026 ..." and the slice is "Sat Nov 14"
 * -- not a date at all. The engine then compares strings:
 *   - startDate "Sat Nov 14" > "2026-11-14" is ALWAYS true ('S' > '2'),
 *     so EVERY promotion WITH a startDate was skipped in production;
 *   - endDate "Sat Nov 13" < "2026-11-14" is ALWAYS false, so an EXPIRED
 *     promotion was NOT skipped and kept applying.
 * Both directions are pinned here through the real production caller
 * (VanPromotionsService.evaluateCart, the POST /promotions/evaluate-cart
 * path) on a PGlite db with real DATE columns, plus listPromotions and
 * createPromotion, which all funnel through mapPromotionRow.
 *
 * TIMEZONE CONTROL: "now" is fixed to 00:30 Cairo 2026-11-14 (22:30 UTC
 * 2026-11-13), where the UTC day and the Cairo day differ, so the
 * reference day is the Cairo day deterministically. Expected date strings
 * are literal YYYY-MM-DD constants, never built from UTC toISOString()
 * after local-midnight setHours.
 */
process.env.TZ = 'Africa/Cairo';
process.env.BUSINESS_TIMEZONE = 'Africa/Cairo';

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { types as pgTypes } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  VanPromotionsService,
  promotionDateKey,
} from '../../src/modules/delivery-reps/services/van-promotions.service';

// 00:30 Cairo on 2026-11-14 == 22:30 UTC on 2026-11-13.
const CAIRO_HALF_PAST_MIDNIGHT = '2026-11-13T22:30:00.000Z';

const RealDate = Date;
function installFixedDate(iso: string): () => void {
  const fixed = new RealDate(iso).getTime();
  const FixedDate: any = function (this: unknown, ...args: any[]) {
    return Reflect.construct(RealDate, args.length === 0 ? [fixed] : args, FixedDate);
  };
  Object.setPrototypeOf(FixedDate, RealDate);
  FixedDate.prototype = Object.create(RealDate.prototype);
  FixedDate.prototype.constructor = FixedDate;
  FixedDate.now = () => fixed;
  (globalThis as any).Date = FixedDate;
  return () => {
    (globalThis as any).Date = RealDate;
  };
}

const TENANT = 't-egp';

async function setup() {
  const pg = new PGlite();
  const db = new Kysely<any>({ dialect: new PGliteDialect(pg) });

  await sql`CREATE TABLE settings (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL DEFAULT '')`.execute(
    db,
  );
  await sql`CREATE TABLE currency_exchange_rates (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, currency_code TEXT NOT NULL, exchange_rate NUMERIC(14,6) NOT NULL DEFAULT 1, is_base BOOLEAN NOT NULL DEFAULT false)`.execute(
    db,
  );
  // DDL mirrors migration 2040000000221 (fmcg_promotions): start_date and
  // end_date are pg DATE columns, which is what makes the mapping matter.
  await sql`CREATE TABLE fmcg_promotions (id SERIAL PRIMARY KEY, tenant_id VARCHAR(50) NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL, promo_type TEXT NOT NULL, apply_type TEXT NOT NULL, buy_conditions JSONB, reward JSONB, customer_types JSONB, start_date DATE, end_date DATE, is_active BOOLEAN NOT NULL DEFAULT true, max_applications_per_order INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(
    db,
  );

  await db.insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: '"EGP"' }).execute();
  await db
    .insertInto('currency_exchange_rates')
    .values({ tenant_id: TENANT, currency_code: 'EGP', exchange_rate: 1, is_base: true })
    .execute();

  const promo = (code: string, startDate: string | null, endDate: string | null) => ({
    tenant_id: TENANT,
    name: `Promo ${code}`,
    code,
    promo_type: 'mix_and_match',
    apply_type: 'free_bonus',
    buy_conditions: JSON.stringify([{ productId: 10, minQty: 2, productName: 'صنف 10' }]),
    reward: JSON.stringify({ bonusProductId: 30, bonusProductName: 'بونص', bonusQty: 1, bonusUom: 'قطعة' }),
    customer_types: JSON.stringify(['all']),
    start_date: startDate,
    end_date: endDate,
    is_active: true,
    max_applications_per_order: 1,
    priority: 0,
    notes: null,
  });

  await db
    .insertInto('fmcg_promotions')
    .values(promo('PROMO-LIVE', '2026-11-01', '2026-12-31'))
    .execute();
  await db
    .insertInto('fmcg_promotions')
    .values(promo('PROMO-EXPIRED', '2026-10-01', '2026-11-13'))
    .execute();
  await db
    .insertInto('fmcg_promotions')
    .values(promo('PROMO-NODATES', null, null))
    .execute();
  await db
    .insertInto('fmcg_promotions')
    .values(promo('PROMO-FUTURE', '2026-11-15', '2026-12-31'))
    .execute();

  return { db };
}

async function main() {
  const { db } = await setup();
  const promos = new VanPromotionsService(db as any);
  const restore = installFixedDate(CAIRO_HALF_PAST_MIDNIGHT);
  try {
    // ---- A. The mapped rows carry real YYYY-MM-DD dates, not weekday strings ----
    {
      const rows = await promos.listPromotions(TENANT, { isActive: true });
      const byCode = new Map(rows.map((r) => [r.code, r]));
      assert.equal(byCode.get('PROMO-LIVE')?.startDate, '2026-11-01', 'A: live promo startDate must be 2026-11-01');
      assert.equal(byCode.get('PROMO-LIVE')?.endDate, '2026-12-31', 'A: live promo endDate must be 2026-12-31');
      assert.equal(byCode.get('PROMO-EXPIRED')?.endDate, '2026-11-13', 'A: expired promo endDate must be 2026-11-13');
      assert.equal(byCode.get('PROMO-NODATES')?.startDate, null, 'A: dateless promo keeps null startDate');
      assert.equal(byCode.get('PROMO-NODATES')?.endDate, null, 'A: dateless promo keeps null endDate');
      console.log('✓ A Passed: mapped promotion dates are YYYY-MM-DD keys');
    }

    // ---- B. The live caller applies the live + dateless promos, not the expired or future one ----
    {
      const res = await promos.evaluateCart(TENANT, {
        cartItems: [{ productId: 10, productName: 'صنف 10', qty: 2, unitPrice: 100 }],
        customerType: 'regular',
      });
      const applied = res.appliedPromotions.map((p) => p.promoCode).sort();
      assert.deepEqual(
        applied,
        ['PROMO-LIVE', 'PROMO-NODATES'],
        `B: only the live and dateless promos must apply, got ${applied.join(',')}`,
      );
      assert.equal(
        res.bonusItemsToAdd.length,
        2,
        `B: two bonus items (one per applied promo), got ${res.bonusItemsToAdd.length}`,
      );
      assert.ok(
        res.bonusItemsToAdd.every((b) => b.productId === 30 && b.qty === 1),
        'B: bonus items are product 30 x1 each',
      );
      console.log('✓ B Passed: evaluateCart applies live promos and skips expired/future ones');
    }

    // ---- C. createPromotion returns mapped dates too (returningAll goes through mapPromotionRow) ----
    {
      const created = await promos.createPromotion(TENANT, {
        name: 'Promo created',
        code: 'PROMO-CREATED',
        promoType: 'mix_and_match',
        applyType: 'free_bonus',
        buyConditions: [{ productId: 10, minQty: 2 }],
        reward: { bonusProductId: 30, bonusQty: 1 },
        startDate: '2026-11-01',
        endDate: '2026-12-31',
        isActive: true,
      });
      assert.equal(created.startDate, '2026-11-01', 'C: created promo startDate must be 2026-11-01');
      assert.equal(created.endDate, '2026-12-31', 'C: created promo endDate must be 2026-12-31');
      console.log('✓ C Passed: createPromotion returns YYYY-MM-DD dates');
    }

    // ---- D. The converter itself: pg DATE values and plain strings ----
    {
      // pg parses a stored DATE as a local-midnight Date (the production value).
      const pgDate = pgTypes.getTypeParser(1082)('2026-11-14');
      assert.equal(promotionDateKey(pgDate), '2026-11-14', 'D: pg DATE value maps to its stored day');
      assert.equal(promotionDateKey(new Date(2026, 10, 14)), '2026-11-14', 'D: local-midnight Date maps to its day');
      assert.equal(promotionDateKey('2026-11-14'), '2026-11-14', 'D: YYYY-MM-DD string passes through');
      assert.equal(promotionDateKey('2026-11-14T00:00:00.000Z'), '2026-11-14', 'D: ISO string maps to its date part');
      console.log('✓ D Passed: promotionDateKey converts pg DATE values and strings');
    }

    console.log('fmcg-promotion-date-mapping.spec: ok (A mapping, B live caller, C create, D converter)');
  } finally {
    restore();
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
