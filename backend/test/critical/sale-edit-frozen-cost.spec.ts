/*
New file: backend/test/critical/sale-edit-frozen-cost.spec.ts
Pure spec (no DB): imports the production helper, no duplicated formulas.

WHAT THIS PINS: frozen COGS on sale edit (INV-SALE-EDIT-FROZEN-COST).
Before this package, updateSale deleted every old sale_items row, rebuilt the
sale, and resolveSaleModifierCosts re-costed each rebuilt line at the CURRENT
product WAC — so a price/discount/tax-only edit in a later period moved COGS
for physically unchanged lines between periods and overwrote the original
frozen cost. postSaleEdit posts COGS from the rebuilt sale_items.cost_price,
so the journal followed the rebuilt cost, not the original sale.

The fix restores the original per-unit cost for a rebuilt line whose physical
composition (product, sold unit, modifier composition) matches exactly one
old line. Quantity, selling price, discount and tax are deliberately NOT part
of the match: changing only the quantity re-prices the line total through
qty * frozen unit cost, without re-costing the unit itself. A changed
composition, a changed unit, a new product, an ambiguous duplicate, or an
invalid old cost all keep the freshly resolved cost (fail-safe re-cost).

THE ECONOMICS, WORKED ONCE (case 1): a line sold at WAC 5, then the product
WAC moves to 7 before a price-only edit. The rebuilt line resolves at 7, but
the edit restores 5 — the COGS that was already booked for that physical sale.
Re-costing at 7 would overstate this period's COGS by 2 per unit and understate
the original period's, for goods that never moved.
*/

import { strict as assert } from 'node:assert';
import { restoreFrozenSaleLineCosts } from '../../src/modules/sales/helpers/sales-write.helper';

function main() {
  // 1. Price-only edit: WAC moved 5 -> 7, unchanged line keeps 5.
  {
    const items: any[] = [{ productId: 1, unitMultiplier: 1, qty: 2, costPrice: 7, modifiers: [] }];
    restoreFrozenSaleLineCosts(items, [{ product_id: 1, unit_multiplier: 1, modifiers: '[]', cost_price: 5 }]);
    assert.equal(items[0].costPrice, 5);
  }

  // 2. Quantity-only change: per-unit cost stays frozen, only the line total moves.
  {
    const items: any[] = [{ productId: 1, unitMultiplier: 1, qty: 5, costPrice: 7, modifiers: [] }];
    restoreFrozenSaleLineCosts(items, [{ product_id: 1, unit_multiplier: 1, modifiers: '[]', cost_price: 5 }]);
    assert.equal(items[0].costPrice, 5);
  }

  // 3. New product added in the edit: no old line, keeps its resolved cost.
  {
    const items: any[] = [{ productId: 2, unitMultiplier: 1, qty: 1, costPrice: 9, modifiers: [] }];
    restoreFrozenSaleLineCosts(items, [{ product_id: 1, unit_multiplier: 1, modifiers: '[]', cost_price: 5 }]);
    assert.equal(items[0].costPrice, 9);
  }

  // 4. Sold unit changed (piece -> carton, multiplier 1 -> 12): not the same line, re-cost.
  {
    const items: any[] = [{ productId: 1, unitMultiplier: 12, qty: 1, costPrice: 84, modifiers: [] }];
    restoreFrozenSaleLineCosts(items, [{ product_id: 1, unit_multiplier: 1, modifiers: '[]', cost_price: 5 }]);
    assert.equal(items[0].costPrice, 84);
  }

  // 5. Modifier composition changed: whole line keeps its resolved cost.
  {
    const items: any[] = [
      {
        productId: 1,
        unitMultiplier: 1,
        qty: 1,
        costPrice: 13,
        modifiers: [{ productId: 10, qty: 2, consumptionQty: 2, costPrice: 4 }],
      },
    ];
    restoreFrozenSaleLineCosts(items, [
      {
        product_id: 1,
        unit_multiplier: 1,
        modifiers: JSON.stringify([{ productId: 10, qty: 1, consumptionQty: 2, costPrice: 6 }]),
        cost_price: 11,
      },
    ]);
    assert.equal(items[0].costPrice, 13);
  }

  // 6. Modifier composition unchanged but component WAC moved: line AND modifier costs restore.
  // Old line: parent 5 + modifier cost 6 = 11. Resolved now: parent 7 + modifier cost 8 = 15.
  {
    const items: any[] = [
      {
        productId: 1,
        unitMultiplier: 1,
        qty: 1,
        costPrice: 15,
        modifiers: [{ productId: 10, qty: 1, consumptionQty: 2, costPrice: 8 }],
      },
    ];
    restoreFrozenSaleLineCosts(items, [
      {
        product_id: 1,
        unit_multiplier: 1,
        modifiers: JSON.stringify([{ productId: 10, qty: 1, consumptionQty: 2, costPrice: 6 }]),
        cost_price: 11,
      },
    ]);
    assert.equal(items[0].costPrice, 11);
    assert.equal(items[0].modifiers[0].costPrice, 6);
  }

  // 7. Ambiguous duplicate old lines with the same key: fail-safe, keep resolved cost.
  {
    const items: any[] = [{ productId: 1, unitMultiplier: 1, qty: 1, costPrice: 7, modifiers: [] }];
    restoreFrozenSaleLineCosts(items, [
      { product_id: 1, unit_multiplier: 1, modifiers: '[]', cost_price: 5 },
      { product_id: 1, unit_multiplier: 1, modifiers: '[]', cost_price: 6 },
    ]);
    assert.equal(items[0].costPrice, 7);
  }

  // 8. Invalid old cost (null) and unparseable old modifiers: keep resolved cost.
  {
    const items: any[] = [{ productId: 1, unitMultiplier: 1, qty: 1, costPrice: 7, modifiers: [] }];
    restoreFrozenSaleLineCosts(items, [{ product_id: 1, unit_multiplier: 1, modifiers: '[]', cost_price: null }]);
    assert.equal(items[0].costPrice, 7);
    const items2: any[] = [{ productId: 1, unitMultiplier: 1, qty: 1, costPrice: 7, modifiers: [] }];
    restoreFrozenSaleLineCosts(items2, [{ product_id: 1, unit_multiplier: 1, modifiers: '{not json', cost_price: 5 }]);
    assert.equal(items2[0].costPrice, 7);
  }

  // 9. Same component, qty and consumption but a different modifier option:
  // a different configuration, so the line keeps its resolved cost.
  {
    const items: any[] = [
      {
        productId: 1,
        unitMultiplier: 1,
        qty: 1,
        costPrice: 15,
        modifiers: [{ productId: 10, optionId: 99, qty: 1, consumptionQty: 2, costPrice: 8 }],
      },
    ];
    restoreFrozenSaleLineCosts(items, [
      {
        product_id: 1,
        unit_multiplier: 1,
        modifiers: JSON.stringify([{ productId: 10, optionId: 7, qty: 1, consumptionQty: 2, costPrice: 6 }]),
        cost_price: 11,
      },
    ]);
    assert.equal(items[0].costPrice, 15);
  }

  // 10. Old modifiers stored as a JSON string (the DB shape) match array modifiers.
  {
    const items: any[] = [{ productId: 1, unitMultiplier: 1, qty: 1, costPrice: 7, modifiers: [] }];
    restoreFrozenSaleLineCosts(items, [{ product_id: 1, unit_multiplier: 1, modifiers: '[]', cost_price: 5 }]);
    assert.equal(items[0].costPrice, 5);
  }

  console.log('Sale-edit frozen-cost tests passed');
}

main();
