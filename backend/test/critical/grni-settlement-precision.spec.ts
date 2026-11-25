/**
 * Test: backend/test/critical/grni-settlement-precision.spec.ts
 * Style follows backend/test/critical/arch02-accounting-engines.spec.ts
 * (node:assert, imports production code — no duplicated formula).
 */

import { strict as assert } from 'node:assert';
import {
  allocateGrnAccrual,
  allocateGrniBillPortion,
} from '../../src/modules/purchases/engines/grni-settlement.engine';

// KWD case the old cents() got wrong: one unit at 0.123 KWD.
// Old code stored 12 minor units (0.12); correct is 123 (0.123).
assert.deepEqual([...allocateGrnAccrual([{ id: 7, acceptedQty: 1, unitCost: 0.123 }], 3).entries()], [[7, 123]]);

// Multi-line KWD case: 3 units @ 0.333 + 1 unit @ 0.333 = 1.332 total.
// The last billable line absorbs the residue: 999 + 333 = 1332 exactly.
// At 2dp the same inputs collapse to 133 minor units (1.33), losing 0.002.
const accrual = allocateGrnAccrual(
  [
    { id: 1, acceptedQty: 3, unitCost: 0.333 },
    { id: 2, acceptedQty: 1, unitCost: 0.333 },
  ],
  3,
);
assert.equal(accrual.get(1), 999);
assert.equal(accrual.get(2), 333);

// Bill portions split the accrual exactly across invoices, no residue left.
const first = allocateGrniBillPortion({
  lineAccrualMinor: 1332,
  acceptedQty: 4,
  previouslyBilledQty: 0,
  previouslyClearedMinor: 0,
  newQty: 3,
});
assert.equal(first, 999);
const second = allocateGrniBillPortion({
  lineAccrualMinor: 1332,
  acceptedQty: 4,
  previouslyBilledQty: 3,
  previouslyClearedMinor: 999,
  newQty: 1,
});
assert.equal(second, 333);
assert.equal(first + second, 1332);

// 2dp tenants are unchanged by parameterisation (EGP regression guard).
const egp = allocateGrnAccrual(
  [
    { id: 1, acceptedQty: 3, unitCost: 0.333 },
    { id: 2, acceptedQty: 1, unitCost: 0.333 },
  ],
  2,
);
assert.equal(egp.get(1), 100);
assert.equal(egp.get(2), 33);

// Existing guards survive the signature change.
assert.throws(() =>
  allocateGrniBillPortion({
    lineAccrualMinor: 100,
    acceptedQty: 4,
    previouslyBilledQty: 0,
    previouslyClearedMinor: 101,
    newQty: 1,
  }),
);
assert.throws(() =>
  allocateGrniBillPortion({
    lineAccrualMinor: 100,
    acceptedQty: 4,
    previouslyBilledQty: 3,
    previouslyClearedMinor: 0,
    newQty: 2,
  }),
);
