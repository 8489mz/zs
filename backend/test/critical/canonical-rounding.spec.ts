/*
New file: backend/test/critical/canonical-rounding.spec.ts
Pins INV-CANONICAL-ROUNDING-EVERYWHERE: every money rounder in the
digits-aware helpers rounds through the canonical engine
(money-minor-units roundMoney) at the tenant's book digits. The old
2-decimal branches added Number.EPSILON before rounding, so a binary
half-cent that sits just below the half (1.005: 1.005 * 100 is
100.4999... in binary) rounded UP to the next minor unit, while the
canonical engine rounds it DOWN. That one-minor-unit difference is the
whole behavior change in this package, and it is the decided policy:
the canonical engine is the single source of truth for money
rounding, in purchases, sales, returns, and GRNI settlement alike.

WHAT THIS PINS (drives the real helpers, no copies of their math):
- Purchases: subtotal, normalized line total, and the default-2
  normalizePositiveAmount path all answer the canonical value on a
  1.005 edge (1.00, not 1.01), while 4.255 still answers 4.26 and the
  3-decimal path is unchanged.
- Sales: collectible total and offer-adjusted price answer 1.00 on
  the same edge; the 3-decimal path is unchanged.
- Returns: document total answers 1.00 on the same edge; the
  previously pinned 15.26 and 10.26 answers are unchanged, and a
  return line whose half total is 1.005 rounds its line and unit
  totals to 1.00.
- GRNI: allocateGrnAccrual answers minor units from the canonical
  rounding step (1 unit at 1.005 is 100 minor units at 2 digits, not
  101; 1005 at 3 digits, unchanged), and the last line still absorbs
  the residue.
- Non-finite money fails closed through the canonical engine instead
  of flowing on as Infinity.

Deliberately NOT pinned here: the legacy roundMoneyToTwoDecimals in
financial-integrity (explicitly legacy-named, dead validation path),
quantity rounders (stock quantities are not money), the reorder
estimate helper (estimate-only, no digits context), and the single
inline contracting attendance total (no digits context in its
method; its own digits-plumbing package follows).
*/

import { strict as assert } from 'node:assert';
import {
  buildNormalizedPurchaseItem,
  calculatePurchaseSubtotal,
  normalizePositiveAmount,
} from '../../src/modules/purchases/helpers/purchases-write.helper';
import {
  calculateCollectibleTotal,
  calculateOfferAdjustedPrice,
} from '../../src/modules/sales/helpers/sales-write.helper';
import {
  buildSaleReturnLine,
  calculateNextLedgerBalance,
  calculateReturnDocumentTotal,
} from '../../src/modules/returns/helpers/returns-write.helper';
import { allocateGrnAccrual } from '../../src/modules/purchases/engines/grni-settlement.engine';

// Purchases: the 1.005 binary half-cent is the discriminator. Old
// EPSILON code answered 1.01 everywhere below; canonical answers 1.00.
assert.equal(calculatePurchaseSubtotal([{ total: 1.005 }], 2), 1);
assert.equal(calculatePurchaseSubtotal([{ total: 4.255 }], 2), 4.26);
assert.equal(calculatePurchaseSubtotal([{ total: 1.005 }], 3), 1.005);
assert.equal(normalizePositiveAmount(1.005), 1);
assert.equal(normalizePositiveAmount('4.255'), 4.26);
const normalizedEdge = buildNormalizedPurchaseItem(
  { productId: 9, qty: 1, cost: 1.005, name: 'Edge' } as never,
  { id: 9, name: 'Edge', stock_qty: '5' },
  2,
);
assert.equal(normalizedEdge.total, 1);
assert.throws(() => calculatePurchaseSubtotal([{ total: Infinity }], 2), /Non-finite monetary amount/);

// Sales: same discriminator through the offer/collectible paths.
assert.equal(calculateCollectibleTotal(1.005, 0, 2), 1);
assert.equal(calculateOfferAdjustedPrice(1.005, {}, 1, 2), 1);
assert.equal(calculateCollectibleTotal(10.125, 0, 3), 10.125);
assert.equal(calculateOfferAdjustedPrice(10, { offer_type: 'percent', value: 10 }, 1, 2), 9);
assert.throws(() => calculateCollectibleTotal(Infinity, 0, 2), /Non-finite monetary amount/);

// Returns: same discriminator through the document total, plus the
// previously pinned answers, which the canonical engine also gives.
assert.equal(calculateReturnDocumentTotal([{ lineTotal: 1.005 }], 2), 1);
assert.equal(calculateReturnDocumentTotal([{ lineTotal: 10.005 }, { lineTotal: 5.255 }], 2), 15.26);
assert.equal(calculateNextLedgerBalance('12.50', -2.245, 2), 10.26);
const returnEdge = buildSaleReturnLine(
  { product_id: 2, product_name: 'Tea', qty: 2, line_total: 2.01, unit_multiplier: 1 },
  { id: 2, stock_qty: 10 },
  { productId: 2, productName: 'Tea', qty: 1 },
  { qty: 0, amount: 0, tax: 0 },
  2,
);
assert.equal(returnEdge.lineTotal, 1);
assert.equal(returnEdge.unitTotal, 1);

// GRNI: minor units from the canonical rounding step, no EPSILON bump.
assert.deepEqual([...allocateGrnAccrual([{ id: 1, acceptedQty: 1, unitCost: 1.005 }], 2).entries()], [[1, 100]]);
assert.deepEqual([...allocateGrnAccrual([{ id: 1, acceptedQty: 1, unitCost: 1.005 }], 3).entries()], [[1, 1005]]);
assert.deepEqual(
  [
    ...allocateGrnAccrual(
      [
        { id: 1, acceptedQty: 1, unitCost: 1.005 },
        { id: 2, acceptedQty: 1, unitCost: 2 },
      ],
      2,
    ).entries(),
  ],
  // The float sum of the two products lands just ABOVE the half, so the
  // total is 301 minor units; line 1 rounds down to 100 on its own edge
  // and the last line absorbs the residue (201), as designed.
  [
    [1, 100],
    [2, 201],
  ],
);

console.log('canonical rounding checks passed');
