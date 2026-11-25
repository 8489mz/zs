/*
New file: backend/test/critical/pos-offer-digits.spec.ts
Pins POS offer pricing at the tenant's book digits (money-precision
program, package 4; INV-POS-OFFER-DIGITS).

THE GAP: the sales-write helper's offer chain took NO digits at all.
calculateOfferAdjustedPrice, pickBestApplicableOffer, and
calculateAllowedSaleUnitPrice all rounded through a file-private
rounder that silently defaulted to 2 decimals — while the same
file's buildPreparedSaleItem already received the tenant's
moneyDigits for line totals and costs, and the service already
passed moneyDigits to calculateCollectibleTotal. On a 3-decimal
tenant (KWD/BHD/OMR) every offer price at the counter was cut to
cents, AND the best-offer choice itself was made on cent-rounded
prices, so two offers that tie at cents picked the wrong winner.

THE FIX (behavior change ONLY on 3-decimal tenants, and only toward
the correct book precision): digits are REQUIRED through the whole
chain — the rounder's `= 2` default, the collectible default, and
the optional moneyDigits on buildPreparedSaleItem are all gone —
and the service passes its moneyDigits at all three
calculateAllowedSaleUnitPrice sites. 2-decimal tenants compute
exactly what they computed before (the 2-decimal branch keeps its
exact historical EPSILON formula; only the default was removed).

WHAT THIS PINS:
- Every offer type (percent, fixed, price, bundle, bogo) keeps
  three decimals at digits 3 and rounds to cents at digits 2.
- Best-offer SELECTION changes with digits: a fixed 1.02 offer and
  a 10% offer tie at 9.11 in cents (the tie-break picks the 10%
  offer), but at 3 decimals the fixed offer wins outright at 9.105
  vs 9.113 — the old code always picked the 10% offer.
- The allowed unit price (the ceiling the counter price is checked
  against) and the wholesale path keep three decimals at digits 3.
- buildPreparedSaleItem line totals and costs keep three decimals
  at digits 3.
- Omitting digits fails closed instead of rounding to cents — the
  old code returned silently, which is the fail-first
  discrimination.
*/

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import {
  buildPreparedSaleItem,
  calculateAllowedSaleUnitPrice,
  calculateCollectibleTotal,
  calculateOfferAdjustedPrice,
  calculatePaidAmount,
  pickBestApplicableOffer,
  type SaleProductOfferRow,
} from '../../src/modules/sales/helpers/sales-write.helper';

const NO_DIGITS = undefined as unknown as 2;
const TODAY = '2026-04-14';

function activeOffer(patch: Partial<SaleProductOfferRow>): SaleProductOfferRow {
  return {
    offer_type: 'percent',
    value: 10,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    ...patch,
  };
}

async function main(): Promise<void> {
  // Every offer type at 3 digits, with the 2-digit answers beside them.
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
  // A bogo offer with no explicit discount percent uses the offer value as the percent.
  assert.equal(
    calculateOfferAdjustedPrice(
      10,
      activeOffer({ offer_type: 'bogo', value: 50, bogo_buy_qty: 1, bogo_get_qty: 1 }),
      2,
      2,
    ),
    7.5,
  );
  // The non-positive guard returns the base rounded at the caller's digits.
  assert.equal(calculateOfferAdjustedPrice(10.125, activeOffer({ value: 0 }), 1, 3), 10.125);
  assert.equal(calculateOfferAdjustedPrice(10.125, activeOffer({ value: 0 }), 1, 2), 10.13);

  // Best-offer SELECTION depends on digits: tie at cents, clear winner at 3 decimals.
  const fixedOffer = activeOffer({ offer_type: 'fixed', value: 1.02 });
  const percentOffer = activeOffer({ offer_type: 'percent', value: 10 });
  const pickedAt2 = pickBestApplicableOffer([fixedOffer, percentOffer], TODAY, 1, 10.125, new Date(), 2);
  assert.equal(
    pickedAt2,
    percentOffer,
    'at cents the two offers tie at 9.11 and the tie-break picks the percent offer',
  );
  const pickedAt3 = pickBestApplicableOffer([fixedOffer, percentOffer], TODAY, 1, 10.125, new Date(), 3);
  assert.equal(pickedAt3, fixedOffer, 'at 3 decimals the fixed offer wins outright at 9.105 vs 9.113');
  assert.equal(pickBestApplicableOffer([], TODAY, 1, 10.125, new Date(), 3), null);

  // Allowed unit price: the ceiling the counter price is checked against.
  assert.equal(
    calculateAllowedSaleUnitPrice({
      retailPrice: 10.125,
      priceType: 'retail',
      offers: [activeOffer({})],
      qty: 1,
      todayIso: TODAY,
      moneyDigits: 3,
    }),
    9.113,
  );
  assert.equal(
    calculateAllowedSaleUnitPrice({
      retailPrice: 10.125,
      priceType: 'retail',
      offers: [activeOffer({})],
      qty: 1,
      todayIso: TODAY,
      moneyDigits: 2,
    }),
    9.12,
  );
  assert.equal(
    calculateAllowedSaleUnitPrice({
      retailPrice: 10.125,
      wholesalePrice: 10.125,
      priceType: 'wholesale',
      moneyDigits: 3,
    }),
    10.125,
  );
  assert.equal(calculateAllowedSaleUnitPrice({ retailPrice: 10.125, priceType: 'retail', moneyDigits: 3 }), 10.125);

  // Prepared lines: totals and costs keep three decimals at digits 3.
  const item = {
    productId: 2,
    qty: 1,
    price: 10.125,
    unitName: 'قطعة',
    unitMultiplier: 1,
    priceType: 'retail' as const,
    notes: '',
    modifiers: [],
  };
  const prepared3 = buildPreparedSaleItem({ id: 2, name: 'Tea', stock_qty: '10', cost_price: '3.333' }, item, {
    moneyDigits: 3,
  });
  assert.equal(prepared3.lineTotal, 10.125);
  assert.equal(prepared3.costPrice, 3.333);
  const prepared2 = buildPreparedSaleItem({ id: 2, name: 'Tea', stock_qty: '10', cost_price: '3.333' }, item, {
    moneyDigits: 2,
  });
  assert.equal(prepared2.lineTotal, 10.13);
  assert.equal(prepared2.costPrice, 3.33);

  // Collectible and paid totals at both precisions.
  assert.equal(calculateCollectibleTotal(10.125, 0, 3), 10.125);
  assert.equal(calculateCollectibleTotal(10.125, 0, 2), 10.13);
  assert.equal(calculatePaidAmount([{ amount: 10 }, { amount: 0.125 }], 3), 10.125);
  assert.equal(calculatePaidAmount([{ amount: 10 }, { amount: 0.125 }], 2), 10.13);

  // Omitted digits must fail closed, not fall back to cents.
  assert.throws(
    () => calculateOfferAdjustedPrice(10.125, activeOffer({}), 1, NO_DIGITS),
    /Invalid monetary minor units/,
  );
  assert.throws(
    () => pickBestApplicableOffer([fixedOffer, percentOffer], TODAY, 1, 10.125, new Date(), NO_DIGITS),
    /Invalid monetary minor units/,
  );
  assert.throws(
    () => calculateAllowedSaleUnitPrice({ retailPrice: 10.125, priceType: 'retail', moneyDigits: NO_DIGITS }),
    /Invalid monetary minor units/,
  );
  assert.throws(() => calculateCollectibleTotal(10.125, 0, NO_DIGITS), /Invalid monetary minor units/);
  assert.throws(() => calculatePaidAmount([{ amount: 10 }], NO_DIGITS), /Invalid monetary minor units/);

  console.log('POS offer digits tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
