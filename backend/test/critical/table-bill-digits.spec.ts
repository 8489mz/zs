/*
New file: backend/test/critical/table-bill-digits.spec.ts
Pins INV-TABLE-BILL-DIGITS-AND-RATE-VALIDATION: the dine-in table
bill (held-draft branch of getActiveTableBill) and its pay-at-table
total round at the tenant's book digits through the canonical engine,
and the two configured rates fail closed instead of silently
degrading. The old code rounded service charge, tax, grand total,
and the tip total with hard-coded Math.round(*100)/100, so every
3-decimal tenant's bill was cut to cents, and a garbled, negative,
or over-100 rate silently produced a zero or absurd charge.

WHAT THIS PINS (drives the real pure engine, no copies of its math):
- 3-decimal bill: a 10.125 subtotal at 12% service and 15% tax keeps
  1.215 / 1.701 / 13.041 (old code answered 1.21 / 1.70 / 13.04).
- 2-decimal bill: unchanged answers (115.92; the 8.375 edge keeps
  charge 1.00 and total 9.38, as the old formula also gave).
- Subtotal and discount pass through raw, exactly as the service
  returns them; only the derived charges, tax, and total round.
- Rate validation: a non-numeric, negative, non-finite, or over-100
  tax rate throws TABLE_BILL_RATE_INVALID; the same holds for the
  service-charge percent while service charge is enabled, while a
  disabled service charge ignores a stale percent. An absent rate
  means 0 tax; an absent service percent means the 12 default; a
  numeric string rate ("15") is accepted, as settings store strings.
- Payment total: bill + tip rounds at the caller's digits
  (13.041 + 0.125 = 13.166 at 3 digits).
- Non-finite money fails closed through the canonical engine.

Deliberately NOT pinned here: the posted-sale branch of
getActiveTableBill (it echoes already-posted stored totals, which
must never be re-rounded); the frontend bill modal's display total
(display mirror only — the backend payment total is authoritative);
the delivery fee (a configured value, not computed); a negative
held-draft discount (passed through exactly as today).
*/

import { strict as assert } from 'node:assert';
import { AppError } from '../../src/common/errors/app-error';
import {
  computeTableBillPaymentTotal,
  computeTableBillTotals,
} from '../../src/modules/storefront/engines/table-bill.engine';

function isRateError(error: unknown): boolean {
  return error instanceof AppError && error.code === 'TABLE_BILL_RATE_INVALID';
}

// 3-decimal bill keeps its third decimal in every derived amount.
const kwd = computeTableBillTotals({
  subtotal: 10.125,
  discount: 0,
  serviceChargeEnabled: true,
  serviceChargePercent: 12,
  taxRate: 15,
  digits: 3,
});
assert.deepEqual(kwd, {
  subtotal: 10.125,
  discount: 0,
  serviceCharge: 1.215,
  taxableBase: 11.34,
  tax: 1.701,
  total: 13.041,
});

// 2-decimal bill: unchanged answers, including the half-cent edge.
const egp = computeTableBillTotals({
  subtotal: 100,
  discount: 10,
  serviceChargeEnabled: true,
  serviceChargePercent: 12,
  taxRate: 15,
  digits: 2,
});
assert.deepEqual(egp, {
  subtotal: 100,
  discount: 10,
  serviceCharge: 10.8,
  taxableBase: 100.8,
  tax: 15.12,
  total: 115.92,
});
const edge = computeTableBillTotals({
  subtotal: 8.375,
  discount: 0,
  serviceChargeEnabled: true,
  serviceChargePercent: 12,
  taxRate: 0,
  digits: 2,
});
assert.equal(edge.serviceCharge, 1);
assert.equal(edge.total, 9.38);

// Subtotal passes through raw; discount echoes as given.
const raw = computeTableBillTotals({
  subtotal: 10.1255,
  discount: 2.5,
  serviceChargeEnabled: false,
  serviceChargePercent: 12,
  taxRate: 0,
  digits: 3,
});
assert.equal(raw.subtotal, 10.1255);
assert.equal(raw.discount, 2.5);
assert.equal(raw.serviceCharge, 0);
assert.equal(raw.total, 7.626);

// Rate validation: tax rate always, service percent only when enabled.
assert.throws(
  () =>
    computeTableBillTotals({
      subtotal: 10,
      discount: 0,
      serviceChargeEnabled: true,
      serviceChargePercent: 12,
      taxRate: 'abc',
      digits: 2,
    }),
  isRateError,
);
assert.throws(
  () =>
    computeTableBillTotals({
      subtotal: 10,
      discount: 0,
      serviceChargeEnabled: true,
      serviceChargePercent: 12,
      taxRate: -5,
      digits: 2,
    }),
  isRateError,
);
assert.throws(
  () =>
    computeTableBillTotals({
      subtotal: 10,
      discount: 0,
      serviceChargeEnabled: true,
      serviceChargePercent: 12,
      taxRate: 150,
      digits: 2,
    }),
  isRateError,
);
assert.throws(
  () =>
    computeTableBillTotals({
      subtotal: 10,
      discount: 0,
      serviceChargeEnabled: true,
      serviceChargePercent: 12,
      taxRate: Infinity,
      digits: 2,
    }),
  isRateError,
);
assert.throws(
  () =>
    computeTableBillTotals({
      subtotal: 10,
      discount: 0,
      serviceChargeEnabled: true,
      serviceChargePercent: 'abc',
      taxRate: 15,
      digits: 2,
    }),
  isRateError,
);
assert.throws(
  () =>
    computeTableBillTotals({
      subtotal: 10,
      discount: 0,
      serviceChargeEnabled: true,
      serviceChargePercent: 150,
      taxRate: 15,
      digits: 2,
    }),
  isRateError,
);
const disabledStale = computeTableBillTotals({
  subtotal: 10,
  discount: 0,
  serviceChargeEnabled: false,
  serviceChargePercent: 150,
  taxRate: 15,
  digits: 2,
});
assert.equal(disabledStale.serviceCharge, 0);
assert.equal(disabledStale.tax, 1.5);
assert.equal(disabledStale.total, 11.5);

// Absent rates: 0 tax, 12 default service percent; string rates work.
const absent = computeTableBillTotals({
  subtotal: 100,
  discount: 0,
  serviceChargeEnabled: true,
  serviceChargePercent: undefined,
  taxRate: undefined,
  digits: 2,
});
assert.equal(absent.serviceCharge, 12);
assert.equal(absent.tax, 0);
assert.equal(absent.total, 112);
const stringRates = computeTableBillTotals({
  subtotal: 100,
  discount: 0,
  serviceChargeEnabled: true,
  serviceChargePercent: '12',
  taxRate: '15',
  digits: 2,
});
assert.equal(stringRates.serviceCharge, 12);
assert.equal(stringRates.tax, 16.8);
assert.equal(stringRates.total, 128.8);
assert.equal(
  computeTableBillTotals({
    subtotal: 10,
    discount: 0,
    serviceChargeEnabled: true,
    serviceChargePercent: 12,
    taxRate: 100,
    digits: 2,
  }).tax,
  11.2,
);

// Payment total rounds bill + tip at the caller's digits.
assert.equal(computeTableBillPaymentTotal(13.041, 0.125, 3), 13.166);
assert.equal(computeTableBillPaymentTotal(115.92, 0, 2), 115.92);
assert.equal(computeTableBillPaymentTotal(100, 0.005, 2), 100.01);

// Non-finite money fails closed.
assert.throws(
  () =>
    computeTableBillTotals({
      subtotal: Infinity,
      discount: 0,
      serviceChargeEnabled: true,
      serviceChargePercent: 12,
      taxRate: 15,
      digits: 2,
    }),
  /Non-finite monetary amount/,
);

console.log('table bill digits checks passed');
