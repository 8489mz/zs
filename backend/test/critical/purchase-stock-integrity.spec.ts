import { strict as assert } from 'node:assert';
import {
  allocateReceiptCostByStockFlow,
  stockMovementGlobalDelta,
} from '../../src/modules/purchases/engines/landed-cost-wac.engine';

const split = allocateReceiptCostByStockFlow({
  currentStock: 100,
  movements: [
    { id: 1, globalDelta: 10 }, // receipt joins an existing pool of 100
    { id: 2, globalDelta: stockMovementGlobalDelta('transfer_send', -10) },
    { id: 3, globalDelta: stockMovementGlobalDelta('transfer_receive', 10) },
    { id: 4, globalDelta: -10 }, // ten units sold from the 110-unit WAC pool
  ],
  receipts: [{ key: 7, movementId: 1, receivedQty: 10, allocatedCost: 110 }],
});
assert.deepEqual(
  split.get(7),
  { inventory: 100, cogs: 10 },
  'late costs follow the surviving weighted-average share even if old stock remains',
);

const soldOut = allocateReceiptCostByStockFlow({
  currentStock: 0,
  movements: [
    { id: 1, globalDelta: 10 },
    { id: 2, globalDelta: -10 },
  ],
  receipts: [{ key: 8, movementId: 1, receivedQty: 10, allocatedCost: 25 }],
});
assert.deepEqual(soldOut.get(8), { inventory: 0, cogs: 25 });
assert.throws(() => stockMovementGlobalDelta('unknown_transfer', 5), /Unclassified/);
assert.throws(
  () =>
    allocateReceiptCostByStockFlow({
      currentStock: 0,
      movements: [
        { id: 1, globalDelta: 10 },
        { id: 2, globalDelta: -11 },
        { id: 3, globalDelta: 1 },
      ],
      receipts: [{ key: 9, movementId: 1, receivedQty: 10, allocatedCost: 10 }],
    }),
  /exceeds/,
);
console.log('Purchase landed-cost WAC stock-flow regressions passed');

const kwd = allocateReceiptCostByStockFlow({
  currentStock: 5,
  minorUnits: 3,
  movements: [
    { id: 1, globalDelta: 10 },
    { id: 2, globalDelta: -5 },
  ],
  receipts: [{ key: 12, movementId: 1, receivedQty: 10, allocatedCost: 0.005 }],
});
assert.deepEqual(kwd.get(12), { inventory: 0.003, cogs: 0.002 });
