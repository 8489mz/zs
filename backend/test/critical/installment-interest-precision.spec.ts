/*
New file: backend/test/critical/installment-interest-precision.spec.ts
Pure spec (no DB): pins the installment-interest engine at book precision.

WHAT THIS PINS (INV-INSTALLMENT-INTEREST-PRECISION): the engine that
splits a plan's interest across its installments into
accounting_installment_interest ran entirely in cents. On a 3-decimal
tenant (KWD) it rounded a 7.125 interest to 7.13 for the allocation
rows, while postCustomerInstallmentInterest posts the journal leg
exact at 7.125. Recognition then debited the 2155 deferred account
by 7.13 against a 7.125 credit, leaking 0.005 per plan into a
permanently over-released deferred balance — silent, per-plan, and
cumulative across every KWD plan. The 2-decimal behaviour is
unchanged (arch02 pins [13.07, 6.93] for principal 100, payments
[60, 60], interest 20); this spec pins the 3-decimal case the old
engine got wrong, plus the exact-sum property at both precisions.
*/

import { strict as assert } from 'node:assert';
import { allocateInstallmentInterest } from '../../src/modules/accounting/engines/installment-interest.engine';

// KWD case, worked once: principal 100, interest 7.125, payments
// 53.562 + 53.563 = 107.125. Old engine: interestCents = round(712.5)
// = 713, allocations summed to 7.13. New engine at 3 minor units:
// allocations sum to exactly 7.125, every allocation is a whole
// number of fils, and the earlier installment earns more than the
// later one (effective interest declines with the balance).
const kwd = allocateInstallmentInterest(100, [53.562, 53.563], 7.125, 3);
assert.equal(
  kwd.reduce((sum, amount) => sum + amount, 0),
  7.125,
);
assert.ok(kwd.every((amount) => Math.abs(amount * 1000 - Math.round(amount * 1000)) < 1e-9));
assert.ok(kwd[0] > kwd[1]);

// Exact-sum property at 2 decimals on a schedule that does not
// divide evenly: the last installment absorbs the remainder.
const egp = allocateInstallmentInterest(1000, [366.67, 366.67, 366.66], 100, 2);
assert.equal(Math.round(egp.reduce((sum, amount) => sum + amount, 0) * 100), 10000);

// A schedule that reconciles at book precision but not in cents
// must not throw, and a schedule that reconciles at neither must.
assert.doesNotThrow(() => allocateInstallmentInterest(100, [53.562, 53.563], 7.125, 3));
assert.throws(() => allocateInstallmentInterest(100, [53.565, 53.565], 7.125, 3));

console.log('Installment interest precision tests passed');
