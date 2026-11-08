/*
New file: backend/test/critical/import-dead-code-removal.spec.ts
Pins the dead-code removal (INV-IMPORT-DEAD-CODE-REMOVAL).

WHAT WAS REMOVED: calculateImportLandedCosts had zero call
sites anywhere in backend/, frontend/ or the specs — only its
own import line referenced it — while the live landed-cost
path runs through groupImportReceipts and the service's own
calculation. Two frontend mutations
(useCollectPreorderDepositMutation,
useRefundPreorderDepositMutation) likewise had zero .tsx
callers and targeted routes that do not exist
(/preorders/:id/deposit, /preorders/:id/refund-deposit); the
live preorder refund is POST /preorders/:id/refund.

WHAT THIS PINS: the dead export is gone from the engine
module, and the live neighbours it sat beside still behave
exactly as before (grouping + WAC math), so the removal
changed no behaviour.
*/

import { strict as assert } from 'node:assert';
import * as engine from '../../src/modules/import-sales/import-inventory-cost.engine';

async function main(): Promise<void> {
  assert.equal(
    (engine as any).calculateImportLandedCosts,
    undefined,
    'calculateImportLandedCosts must not exist: zero call sites',
  );

  // Live neighbours unchanged: grouping + WAC math.
  const groups = engine.groupImportReceipts([
    {
      id: 'a', productId: 1, quantity: 10, receivedQuantity: 10,
      factoryUnitPriceUsd: 50, shortageHandlingMethod: 'capitalize', landedCost: 100,
    },
    {
      id: 'b', productId: 1, quantity: 5, receivedQuantity: 5,
      factoryUnitPriceUsd: 50, shortageHandlingMethod: 'capitalize', landedCost: 100,
    },
  ], 2);
  assert.ok(Array.isArray(groups) && groups.length > 0, 'groupImportReceipts still groups receipts');
  assert.equal(groups[0].value, 1500, 'group value rounds at the passed book digits');
  assert.equal(engine.importWeightedAverageCost(-10, 5, 20, 120), 7, 'WAC math unchanged');

  assert.equal(typeof engine.requireImportNumber, 'function');
  assert.equal(typeof engine.validateImportLine, 'function');
}

main()
  .then(() => {
    console.log('Import dead-code removal tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
