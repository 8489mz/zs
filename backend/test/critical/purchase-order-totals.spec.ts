import { strict as assert } from 'node:assert';
import { calculatePurchaseOrderTotals } from '../../src/modules/purchases/engines/purchase-order-totals.engine';

const lines = [{ quantity: 10, unitCost: 50000, taxRate: 14 }];
const normal = calculatePurchaseOrderTotals(lines, 0, 2);
assert.deepEqual(normal, {
  subtotal: 500000, discountAmount: 0, taxAmount: 70000,
  totalAmount: 570000, lineTotals: [500000],
});
assert.equal(normal.totalAmount > 100000, true, 'approval threshold must derive from item price, not header');
const discounted = calculatePurchaseOrderTotals([{ quantity: 2, unitCost: 100, taxRate: 14 }], 20, 2);
assert.deepEqual(discounted, {
  subtotal: 200, discountAmount: 20, taxAmount: 25.2,
  totalAmount: 205.2, lineTotals: [200],
});
assert.throws(() => calculatePurchaseOrderTotals([{ quantity: -1, unitCost: 100 }], 0, 2));
assert.throws(() => calculatePurchaseOrderTotals([{ quantity: 1, unitCost: Infinity }], 0, 2));
assert.throws(() => calculatePurchaseOrderTotals([{ quantity: 1, unitCost: 100 }], 200, 2));
assert.throws(() => calculatePurchaseOrderTotals([{ quantity: 1, unitCost: 100 }], -1, 2));
console.log('Server-owned purchase-order total and approval regressions passed');
