/**
 * Test: backend/test/critical/import-sale-cost.spec.ts
 * Style follows backend/test/critical/arch02-accounting-engines.spec.ts
 * (node:assert, imports production code — no duplicated formula).
 */

import { strict as assert } from 'node:assert';
import { calculateImportSaleCost } from '../../src/modules/import-sales/helpers/import-lot-allocation.helper';

// Full coverage: the fallback must be ignored, not averaged in.
assert.deepEqual(calculateImportSaleCost({ qty: 10, allocatedQty: 10, allocCostEgp: 100, fallbackUnitCostEgp: 999 }), {
  shortfallQty: 0,
  shortfallCostEgp: 0,
  totalCostEgp: 100,
  unitCostEgp: 10,
});

// P0 repro: 4 of 10 units allocated at 10 EGP, 6 uncovered topped up at 12 EGP.
// Old code posted 40 EGP; correct total is 40 + 72 = 112 EGP, unit 11.2.
const partial = calculateImportSaleCost({ qty: 10, allocatedQty: 4, allocCostEgp: 40, fallbackUnitCostEgp: 12 });
assert.equal(partial.shortfallQty, 6);
assert.equal(partial.shortfallCostEgp, 72);
assert.equal(partial.totalCostEgp, 112);
assert.equal(partial.unitCostEgp, 11.2);

// Zero allocation: identical to the old fallback path (whole qty at fallback).
assert.equal(
  calculateImportSaleCost({ qty: 10, allocatedQty: 0, allocCostEgp: 0, fallbackUnitCostEgp: 12 }).totalCostEgp,
  120,
);

// Zero fallback: the pure function returns zero; the service gate (not this
// function) is what refuses to complete the conversion in that case.
assert.equal(
  calculateImportSaleCost({ qty: 10, allocatedQty: 4, allocCostEgp: 40, fallbackUnitCostEgp: 0 }).totalCostEgp,
  40,
);

// Fail-closed inputs: over-allocation and negative fallback are bugs, not costs.
assert.throws(() => calculateImportSaleCost({ qty: 10, allocatedQty: 11, allocCostEgp: 110, fallbackUnitCostEgp: 12 }));
assert.throws(() => calculateImportSaleCost({ qty: 10, allocatedQty: 4, allocCostEgp: 40, fallbackUnitCostEgp: -1 }));
