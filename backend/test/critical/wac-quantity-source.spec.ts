/*
New file: backend/test/critical/wac-quantity-source.spec.ts
Pure spec (no DB): imports the production helpers, no duplicated formulas.

WHAT THIS PINS, PART 1 — ONE WAC QUANTITY SOURCE
(INV-WAC-QUANTITY-SOURCE). applyStockDelta returns two different
"before" quantities: globalBefore is the cached products.stock_qty,
while globalAfter is reconciled from the sum of location balances.
valueStockReceipt already recovered the true prior quantity as
globalAfter minus the receipt. The purchase paths (create, edit-apply,
receipt) and goods receipt instead fed weightedReceiptCost the cached
globalBefore — so when the cached counter lagged the location sum,
the same receipt blended the old pool at the wrong quantity and
stored a different WAC than every valueStockReceipt caller would.
This package routes all five sites through recoverWacBeforeQty.

THE DIVERGENCE, WORKED ONCE: location balances sum to 90, but the
cached counter says 100 (a stale counter). A receipt of 10 units at
20, over an old cost of 10, must blend 90 @ 10 with 10 @ 20 = 11.
The old purchase path blended 100 @ 10 with 10 @ 20 = 10.909091 —
a WAC error that then fed every later sale's COGS until another
receipt happened to re-blend it. The helper below recovers 90 from
globalAfter 100 (= 90 + 10), and weightedReceiptCost(90, 10, 10, 200)
is exactly 11.

WHAT THIS PINS, PART 2 — IMPORT-LOT SHORTFALLS ARE RECORDED, NOT
DISCARDED (INV-IMPORT-LOT-SHORTFALL-RECORD). The P0 preorder
conversion already cross-checks lot coverage, but ordinary POS sales
discarded allocateSaleFromImportLots' result entirely. The sales
service now records anomalous shortfalls as pos_audit_events. The
decision rule itself is pinned here; the recording path (which needs
a full sale fixture) is covered by the service change being the
only caller of this helper for POS sales.
*/

import { strict as assert } from 'node:assert';
import { recoverWacBeforeQty, weightedReceiptCost } from '../../src/modules/accounting/engines/inventory-valuation.engine';
import { isAnomalousImportLotShortfall, type ImportLotAllocationCoverage } from '../../src/modules/import-sales/helpers/import-lot-allocation.helper';

function coverage(reason: ImportLotAllocationCoverage['reason'], fullyCovered = false): ImportLotAllocationCoverage {
  return { productId: 1, requestedQty: 10, allocatedQty: fullyCovered ? 10 : 0, shortfallQty: fullyCovered ? 0 : 10, fullyCovered, reason };
}

function main() {
  // Part 1: recovery.
  assert.equal(recoverWacBeforeQty(100, 10), 90);
  // Negative pool (overselling, INV-NEGATIVE-STOCK-WAC): globalAfter -5
  // after an 8-unit return means the true prior quantity was -13.
  assert.equal(recoverWacBeforeQty(-5, 8), -13);
  // Ledger quantity precision is 3dp.
  assert.equal(recoverWacBeforeQty(10.125, 0.125), 10);
  // The worked divergence: recovered 90 blends to exactly 11.
  assert.equal(weightedReceiptCost(recoverWacBeforeQty(100, 10), 10, 10, 200), 11);
  // The old cached path, for contrast, blended to 10.909091 — asserting
  // the contrast documents why the input, not the engine, was the bug.
  assert.equal(weightedReceiptCost(100, 10, 10, 200), 10.909091);
  // Fail-closed inputs.
  assert.throws(() => recoverWacBeforeQty(NaN, 10), /Invalid WAC quantity recovery inputs/);
  assert.throws(() => recoverWacBeforeQty(100, 0), /Invalid WAC quantity recovery inputs/);
  assert.throws(() => recoverWacBeforeQty(100, -5), /Invalid WAC quantity recovery inputs/);

  // Part 2: shortfall decision table.
  // Fully covered is never anomalous, even for an import product.
  assert.equal(isAnomalousImportLotShortfall(coverage('fully_covered', true), true), false);
  // Malformed sales are always anomalous, even with no lots at all.
  assert.equal(isAnomalousImportLotShortfall(coverage('missing_location'), false), true);
  assert.equal(isAnomalousImportLotShortfall(coverage('invalid_quantity'), false), true);
  // An import-tracked product sold without lot coverage is anomalous.
  assert.equal(isAnomalousImportLotShortfall(coverage('no_active_lots'), true), true);
  assert.equal(isAnomalousImportLotShortfall(coverage('lots_exhausted'), true), true);
  // A product that has never had an import lot is ordinary local stock:
  // no_active_lots / lots_exhausted for it is NOT a traceability break.
  assert.equal(isAnomalousImportLotShortfall(coverage('no_active_lots'), false), false);
  assert.equal(isAnomalousImportLotShortfall(coverage('lots_exhausted'), false), false);

  console.log('WAC quantity source tests passed');
}

main();
