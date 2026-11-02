/* P1-16 sales-write residuals: every derived money amount the sale
 * writer stores or posts rounds ONCE at the tenant's book digits.
 * Before this package the writer re-rounded these residuals with
 * toFixed(2), which truncated a 3-decimal tenant's third decimal on
 * every create/edit/cancel and compounded in the stored store-credit
 * balance. This spec drives the production helpers in
 * sales-write.helper.ts, never a local copy of the arithmetic.
 * Deliberately unchanged (pinned by the invariant, not by this spec):
 * loyalty-points balances (points, not money), the raw treasury
 * reversal loop (exact reversal of stored payment amounts), the
 * held-sale draft snapshot (2dp storage), and computeInvoiceTotals
 * (3dp ceiling, shared with purchases). */
import assert from 'node:assert/strict';
import { calculateRemainingDebt, calculateStoreCreditBalance, roundSaleResidual } from '../../src/modules/sales/helpers/sales-write.helper';

// 3-decimal tenant (KWD): store-credit use keeps the third decimal.
// Balance 12.345, used 0.120 -> 12.225. toFixed(2) would store 12.23.
assert.equal(calculateStoreCreditBalance(12.345, -0.12, 3), 12.225);
// Restore is the same helper with a positive delta: 12.225 + 0.120 -> 12.345.
assert.equal(calculateStoreCreditBalance(12.225, 0.12, 3), 12.345);
// Repeated use/restore at 3dp never drifts: 10.125 - 0.125 + 0.125 -> 10.125.
assert.equal(calculateStoreCreditBalance(calculateStoreCreditBalance(10.125, -0.125, 3), 0.125, 3), 10.125);

// 2-decimal tenant (EGP/SAR): behaviour is identical to the old toFixed(2).
assert.equal(calculateStoreCreditBalance(12.34, -0.12, 2), 12.22);
assert.equal(calculateStoreCreditBalance(12.22, 0.12, 2), 12.34);

// Remaining debt: the acceptance identity. Collectible 245, paid
// 153.125 (10 units at WAC 15.3125) -> 91.875 at 3dp, not 91.88.
assert.equal(calculateRemainingDebt(245, 153.125, 3), 91.875);
// Overpayment floors at zero, never a negative debt.
assert.equal(calculateRemainingDebt(100, 100.5, 3), 0);
assert.equal(calculateRemainingDebt(100, 100.5, 2), 0);
// 2-decimal tenant: unchanged from the old rounding.
assert.equal(calculateRemainingDebt(245, 153.13, 2), 91.87);

// Discount intermediates: loyalty redemption keeps the third decimal.
// 125 points at 0.001 per point -> 0.125, not 0.13.
assert.equal(roundSaleResidual(125 * 0.001, 3), 0.125);
// Percentage cap: subtotal 91.875 at 10% -> 9.1875 -> 9.188, not 9.19.
assert.equal(roundSaleResidual((91.875 * 10) / 100, 3), 9.188);
// Combined discount sums at book digits: 0.125 + 9.188 -> 9.313.
assert.equal(roundSaleResidual(0.125 + 9.188, 3), 9.313);
// Unapproved-discount residual: 10.125 - 10.000 -> 0.125, not 0.13.
assert.equal(roundSaleResidual(10.125 - 10, 3), 0.125);
// 2-decimal tenant: unchanged from the old rounding.
assert.equal(roundSaleResidual(0.125, 2), 0.13);
assert.equal(roundSaleResidual(9.1875, 2), 9.19);

// Cash-refund total: the sum of stored payment amounts rounds once at
// book digits. 10.125 + 5.000 -> 15.125, not 15.13.
assert.equal(roundSaleResidual(10.125 + 5, 3), 15.125);

// Fail-closed where the canonical engine fails, coercion where the
// existing helper semantics coerce: roundCurrency (shared with
// calculateCollectibleTotal/calculatePaidAmount) maps a missing or
// NaN input to 0, while a non-finite Infinity still throws from
// roundMoney instead of storing garbage.
assert.equal(roundSaleResidual(Number.NaN, 3), 0);
assert.equal(calculateRemainingDebt(100, Number.NaN, 2), 100);
assert.throws(() => roundSaleResidual(Number.POSITIVE_INFINITY, 3));
assert.throws(() => calculateStoreCreditBalance(Number.POSITIVE_INFINITY, -1, 3));

console.log('sales-write-residuals: OK');
