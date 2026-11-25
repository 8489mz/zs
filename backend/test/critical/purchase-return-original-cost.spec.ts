/*
New file: backend/test/critical/purchase-return-original-cost.spec.ts
Pure spec (no DB): imports the production helper, no duplicated formulas.

WHAT THIS PINS: purchase returns at original purchase cost
(INV-PURCHASE-RETURN-ORIGINAL-COST).
Before this package, createPurchaseReturn costed every returned unit at the
CURRENT product WAC (products.cost_price), for both return_items.cost_price
(which postPurchaseReturn journals from) and the purchase_return stock
movement. A return is lot-identified — it pins the original purchase line
(purchase_item_id, plus serial/batch provenance where applicable) — so it
reverses that purchase, not a slice of the blended pool. When later purchases
moved the WAC, the journal credited inventory at the new WAC while debiting
the supplier at the original net price, and the whole drift landed in the
5190 variance account as if it were a real gain or loss.

The fix derives the original inventory cost from the purchase line itself:
purchase_items.unit_cost is after invoice discount allocation, per sold unit,
and may include VAT; purchases-write capitalises inventory net of recoverable
VAT, so VAT is stripped here exactly as at purchase time. perSoldUnit feeds
return_items.cost_price (qty is in sold units); perBaseUnit feeds the stock
movement (stockDelta is in base units).

THE ECONOMICS, WORKED ONCE: buy 10 units at a net 10 each, then later
purchases move the WAC to 15. Returning 4 units from the original line must
credit inventory 40, not 60, and — because the supplier is debited the
original net 40 — the 5190 variance is 0, not a fictitious 20 loss. The old
code produced 60 and 20; the helper below returns 10 per unit, so the
journal built from it produces 40 and 0.
*/

import { strict as assert } from 'node:assert';
import { originalPurchaseReturnUnitCost } from '../../src/modules/returns/helpers/returns-write.helper';

function main() {
  // 1. Exclusive tax: stored cost is already net.
  {
    const cost = originalPurchaseReturnUnitCost({
      unitCost: 20,
      unitMultiplier: 1,
      taxRate: 15,
      pricesIncludeTax: false,
    });
    assert.equal(cost.perSoldUnit, 20);
    assert.equal(cost.perBaseUnit, 20);
  }

  // 2. Inclusive tax: VAT is stripped exactly as at purchase time.
  {
    const cost = originalPurchaseReturnUnitCost({
      unitCost: 23,
      unitMultiplier: 1,
      taxRate: 15,
      pricesIncludeTax: true,
    });
    assert.equal(cost.perSoldUnit, 20);
    assert.equal(cost.perBaseUnit, 20);
  }

  // 3. Carton: per sold unit is the stripped cost, per base unit divides by the multiplier.
  {
    const cost = originalPurchaseReturnUnitCost({
      unitCost: 230,
      unitMultiplier: 10,
      taxRate: 15,
      pricesIncludeTax: true,
    });
    assert.equal(cost.perSoldUnit, 200);
    assert.equal(cost.perBaseUnit, 20);
  }

  // 4. The worked economics: original net 10, regardless of any later WAC.
  // (The WAC is not an input at all — that is the point: the return can no
  // longer drift with later purchases.)
  {
    const cost = originalPurchaseReturnUnitCost({
      unitCost: 10,
      unitMultiplier: 1,
      taxRate: 0,
      pricesIncludeTax: false,
    });
    assert.equal(cost.perSoldUnit, 10);
    assert.equal(4 * cost.perSoldUnit, 40);
  }

  // 5. GRN-bill shape: tax_rate 0 and prices_include_tax false is the identity.
  {
    const cost = originalPurchaseReturnUnitCost({
      unitCost: 12.5,
      unitMultiplier: 1,
      taxRate: 0,
      pricesIncludeTax: false,
    });
    assert.equal(cost.perSoldUnit, 12.5);
    assert.equal(cost.perBaseUnit, 12.5);
  }

  // 6. Discounted line: unit_cost already carries the invoice discount, so
  // no discount is applied again here — 18 net stays 18.
  {
    const cost = originalPurchaseReturnUnitCost({
      unitCost: 18,
      unitMultiplier: 1,
      taxRate: 0,
      pricesIncludeTax: false,
    });
    assert.equal(cost.perSoldUnit, 18);
  }

  // 7. Zero-cost purchase: 0 stays 0 (a free receipt returns at 0).
  {
    const cost = originalPurchaseReturnUnitCost({
      unitCost: 0,
      unitMultiplier: 1,
      taxRate: 15,
      pricesIncludeTax: true,
    });
    assert.equal(cost.perSoldUnit, 0);
    assert.equal(cost.perBaseUnit, 0);
  }

  // 8. Fail-closed: invalid inputs throw instead of falling back to the WAC.
  assert.throws(
    () => originalPurchaseReturnUnitCost({ unitCost: -1, unitMultiplier: 1, taxRate: 0, pricesIncludeTax: false }),
    /PURCHASE_RETURN_COST_INVALID/,
  );
  assert.throws(
    () => originalPurchaseReturnUnitCost({ unitCost: null, unitMultiplier: 1, taxRate: 0, pricesIncludeTax: false }),
    /PURCHASE_RETURN_COST_INVALID/,
  );
  assert.throws(
    () => originalPurchaseReturnUnitCost({ unitCost: 10, unitMultiplier: 0, taxRate: 0, pricesIncludeTax: false }),
    /PURCHASE_RETURN_COST_INVALID/,
  );
  assert.throws(
    () => originalPurchaseReturnUnitCost({ unitCost: 10, unitMultiplier: 1, taxRate: -5, pricesIncludeTax: false }),
    /PURCHASE_RETURN_COST_INVALID/,
  );
  assert.throws(
    () => originalPurchaseReturnUnitCost({ unitCost: NaN, unitMultiplier: 1, taxRate: 0, pricesIncludeTax: false }),
    /PURCHASE_RETURN_COST_INVALID/,
  );

  // 9. Null multiplier follows the existing convention (defaults to 1),
  // and a null tax rate defaults to 0 — neither invents a cost.
  {
    const cost = originalPurchaseReturnUnitCost({
      unitCost: 20,
      unitMultiplier: null,
      taxRate: null,
      pricesIncludeTax: false,
    });
    assert.equal(cost.perSoldUnit, 20);
    assert.equal(cost.perBaseUnit, 20);
  }

  console.log('Purchase-return original-cost tests passed');
}

main();
