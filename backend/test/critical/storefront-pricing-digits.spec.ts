/*
New file: backend/test/critical/storefront-pricing-digits.spec.ts
Pins storefront pricing at the tenant's book digits (money-precision
program, package 3; INV-STOREFRONT-PRICING-DIGITS).

THE GAP: the storefront's two pricing engines rounded every price at
a hard-coded 2 decimals with file-private rounders, while the
checkout functions around them already knew the tenant's currency.
On a 3-decimal tenant (KWD/BHD/OMR) a variant price of 10.125 or an
offer price of 9.1125 was cut to cents before the customer ever saw
a total — the price shown and the price charged were both wrong, in
the same direction, so nothing visibly disagreed.

THE FIX (behavior change ONLY on 3-decimal tenants, and only toward
the correct book precision): book digits are REQUIRED on
resolveOrderLinePrice, calculateOfferAdjustedPrice, and
resolveBestStorefrontOffer, rounding through the canonical engine.
2-decimal tenants compute exactly what they computed before.

WHAT THIS PINS:
- Variant and base prices keep all three decimals at digits 3 and
  round to cents at digits 2.
- Every offer type (percent, fixed, price, bundle, bogo) keeps
  three decimals at digits 3.
- The best-offer result carries the 3-decimal price and original.
- Omitting digits fails closed instead of rounding to cents — the
  old code returned silently, which is the fail-first
  discrimination.
- The non-positive-offer early return still passes the base price
  through unrounded, exactly as before (callers pass an already
  rounded base; preserved, not fixed, here).
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { resolveOrderLinePrice } from '../../src/modules/storefront/engines/online-order-pricing.engine';
import {
  calculateOfferAdjustedPrice,
  resolveBestStorefrontOffer,
  type RawStorefrontOffer,
} from '../../src/modules/storefront/engines/storefront-offers.engine';

const NO_DIGITS = undefined as unknown as 2;
const TODAY = '2026-10-03';
const NOW = new Date('2026-10-03T14:30:00Z');

function activeOffer(patch: Partial<RawStorefrontOffer>): RawStorefrontOffer {
  return {
    offer_type: 'percent',
    value: 10,
    is_active: true,
    start_date: '2026-10-01',
    end_date: '2026-10-10',
    ...patch,
  };
}

async function main(): Promise<void> {
  // Variant / base pricing.
  const variants = {
    variants: [
      { name: 'وسط', extraPrice: 0.125 },
      { name: 'كبير', price: 10.125 },
    ],
  };
  assert.deepEqual(resolveOrderLinePrice(10.125, {}, null, 3), { ok: true, unitPrice: 10.125, variantName: null });
  assert.deepEqual(resolveOrderLinePrice(10.125, {}, null, 2), { ok: true, unitPrice: 10.13, variantName: null });
  assert.deepEqual(resolveOrderLinePrice(10, variants, 'وسط', 3), { ok: true, unitPrice: 10.125, variantName: 'وسط' });
  assert.deepEqual(resolveOrderLinePrice(10, variants, 'وسط', 2), { ok: true, unitPrice: 10.13, variantName: 'وسط' });
  assert.deepEqual(resolveOrderLinePrice(0, variants, 'كبير', 3), { ok: true, unitPrice: 10.125, variantName: 'كبير' });
  assert.deepEqual(resolveOrderLinePrice(100, variants, 'عملاق', 3), { ok: false, reason: 'UNKNOWN_VARIANT' });

  // Every offer type at 3 digits, and the 2-digit answers beside them.
  assert.equal(calculateOfferAdjustedPrice(10.125, activeOffer({}), 1, 3), 9.113);
  assert.equal(calculateOfferAdjustedPrice(10.125, activeOffer({}), 1, 2), 9.11);
  assert.equal(calculateOfferAdjustedPrice(10.126, activeOffer({ offer_type: 'fixed', value: 0.001 }), 1, 3), 10.125);
  assert.equal(calculateOfferAdjustedPrice(10.126, activeOffer({ offer_type: 'fixed', value: 0.001 }), 1, 2), 10.13);
  assert.equal(calculateOfferAdjustedPrice(10.125, activeOffer({ offer_type: 'price', value: 9.999 }), 1, 3), 9.999);
  assert.equal(calculateOfferAdjustedPrice(10.125, activeOffer({ offer_type: 'price', value: 9.999 }), 1, 2), 10);
  assert.equal(
    calculateOfferAdjustedPrice(10.125, activeOffer({ offer_type: 'bundle', value: 20.251, min_qty: 2 }), 2, 3),
    10.126,
  );
  assert.equal(
    calculateOfferAdjustedPrice(10.125, activeOffer({ offer_type: 'bundle', value: 20.251, min_qty: 2 }), 2, 2),
    10.13,
  );
  assert.equal(
    calculateOfferAdjustedPrice(
      10.125,
      activeOffer({ offer_type: 'bogo', bogo_buy_qty: 1, bogo_get_qty: 1, bogo_discount_percent: 100 }),
      2,
      3,
    ),
    5.063,
  );
  assert.equal(
    calculateOfferAdjustedPrice(
      10.125,
      activeOffer({ offer_type: 'bogo', bogo_buy_qty: 1, bogo_get_qty: 1, bogo_discount_percent: 100 }),
      2,
      2,
    ),
    5.06,
  );
  // Non-positive offers pass the base through unrounded, as before.
  assert.equal(calculateOfferAdjustedPrice(10.125, activeOffer({ value: 0 }), 1, 3), 10.125);
  assert.equal(calculateOfferAdjustedPrice(10.125, activeOffer({ value: 0 }), 1, 2), 10.125);

  // Best-offer result at both precisions.
  const best3 = resolveBestStorefrontOffer(10.125, [activeOffer({})], 1, TODAY, NOW, 'Africa/Cairo', 3);
  assert.equal(best3.hasDiscount, true);
  assert.equal(best3.price, 9.113);
  assert.equal(best3.originalPrice, 10.125);
  assert.equal(best3.discountPercent, 10);
  const best2 = resolveBestStorefrontOffer(10.125, [activeOffer({})], 1, TODAY, NOW, 'Africa/Cairo', 2);
  // Two-step rounding at 2 digits: the base rounds to 10.13 first, then 10% off gives 9.12.
  assert.equal(best2.price, 9.12);
  assert.equal(best2.originalPrice, 10.13);
  const noOffer = resolveBestStorefrontOffer(10.125, [], 1, TODAY, NOW, 'Africa/Cairo', 3);
  assert.equal(noOffer.price, 10.125);
  assert.equal(noOffer.hasDiscount, false);

  // Omitted digits must fail closed, not fall back to cents.
  assert.throws(() => resolveOrderLinePrice(10.125, {}, null, NO_DIGITS), /Invalid monetary minor units/);
  assert.throws(
    () => calculateOfferAdjustedPrice(10.125, activeOffer({}), 1, NO_DIGITS),
    /Invalid monetary minor units/,
  );
  assert.throws(
    () => resolveBestStorefrontOffer(10.125, [activeOffer({})], 1, TODAY, NOW, 'Africa/Cairo', NO_DIGITS),
    /Invalid monetary minor units/,
  );

  console.log('Storefront pricing digits tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
