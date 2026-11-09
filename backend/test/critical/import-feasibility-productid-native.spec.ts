/*
New file: backend/test/critical/import-feasibility-productid-native.spec.ts
Pins the native productId carry-through (I6-A, follow-up to I1-P1).

THE GAP: the feasibility engine rebuilt itemsOutput without
productId, so the link the user picked in the feasibility form
survived only because ImportProjectsManager re-attached it by
index (res.items[i] <- normalizedItems[i]). That substitute
assumes the engine preserves input order. Any reorder — a sort,
a filter, a future engine change — silently links the wrong
product to each line, and the PI pull then generates a PO for
the wrong inventory item.

THE RULE: productId travels with its own line through the
engine (input item -> output item), and the PI/PO pull keys on
that per-item id, never on position. An unlinked line carries
no id (undefined), never an invented one.

WHAT THIS PINS, driving the REAL calculateImportFeasibility
(pure engine) plus the service passthrough calculateFeasibility:
1. Two linked items in order come back with each line's own
   productId, name, qty and price intact.
2. The SAME two items REVERSED come back reversed WITH their
   productIds — and a by-productId lookup (the PI pull's logic)
   resolves the right qty/price for each product. On base the
   output has no productId at all, so the lookup fails.
3. An unlinked line (no productId, or the form's '' for an
   unlinked line) yields productId undefined — no invented link.
4. The service passthrough returns the ids unchanged, so the
   stored feasibility_data the PI pull reads carries them.
*/
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { calculateImportFeasibility } from '../../src/modules/import-sales/engines/import-feasibility.engine';
import { ImportSalesService } from '../../src/modules/import-sales/import-sales.service';

// The link field is the subject of this package: on the base tree
// FeasibilityItemInput has no productId, so the inputs are built
// as plain data (not typed literals) and every result is read as
// `any` — the spec must fail at RUNTIME on base (output drops
// the id), not at compile time, so the failure names the wrong
// link instead of a missing type.
function study(items: any[]): any {
  return { items, exchangeRateCommercial: 50 };
}

// The PI pull keys on the item's own id, never on position.
function pullByProductId(result: any): Map<number, any> {
  const byId = new Map<number, any>();
  for (const it of result.items) {
    if (typeof it.productId === 'number') byId.set(it.productId, it);
  }
  return byId;
}

async function main(): Promise<void> {
  const brakePads = {
    name: 'Brake pads',
    productId: 101,
    qty: 100,
    factoryPriceUsd: 10,
    unitWeightKg: 5,
    unitCbm: 0.01,
  };
  const clutchKit = {
    name: 'Clutch kit',
    productId: 202,
    qty: 50,
    factoryPriceUsd: 40,
    unitWeightKg: 12,
    unitCbm: 0.05,
  };

  // Case 1: linked items in order keep their own ids.
  const inOrder: any = calculateImportFeasibility(study([brakePads, clutchKit]));
  assert.equal(inOrder.items.length, 2);
  assert.equal(inOrder.items[0].name, 'Brake pads');
  assert.equal(inOrder.items[0].productId, 101);
  assert.equal(inOrder.items[0].qty, 100);
  assert.equal(inOrder.items[1].name, 'Clutch kit');
  assert.equal(inOrder.items[1].productId, 202);
  assert.equal(inOrder.items[1].qty, 50);

  // Case 2: the SAME items REVERSED still link the right product
  // to each line — the defect the index re-attach could not
  // survive. On base every productId here is undefined.
  const reversed: any = calculateImportFeasibility(study([clutchKit, brakePads]));
  assert.equal(reversed.items.length, 2);
  assert.equal(reversed.items[0].name, 'Clutch kit');
  assert.equal(reversed.items[0].productId, 202);
  assert.equal(reversed.items[1].name, 'Brake pads');
  assert.equal(reversed.items[1].productId, 101);
  const pulled = pullByProductId(reversed);
  assert.equal(pulled.get(202)?.name, 'Clutch kit');
  assert.equal(pulled.get(202)?.qty, 50);
  assert.equal(pulled.get(202)?.factoryPriceUsd, 40);
  assert.equal(pulled.get(101)?.name, 'Brake pads');
  assert.equal(pulled.get(101)?.qty, 100);
  assert.equal(pulled.get(101)?.factoryPriceUsd, 10);

  // Case 3: unlinked lines carry no id — neither a missing field
  // nor the form's '' placeholder may become an invented link.
  const unlinked: any = calculateImportFeasibility(
    study([
      { name: 'Free text item', qty: 10, factoryPriceUsd: 5 },
      { name: 'Picked then renamed', productId: '', qty: 10, factoryPriceUsd: 5 },
    ]),
  );
  assert.equal(unlinked.items[0].productId, undefined);
  assert.equal(unlinked.items[1].productId, undefined);

  // Case 4: the service passthrough returns the ids unchanged, so
  // the feasibility_data the PI pull reads carries them.
  const service = new (ImportSalesService as any)(null, null);
  const viaService: any = service.calculateFeasibility(study([brakePads, clutchKit]));
  assert.equal(viaService.items[0].productId, 101);
  assert.equal(viaService.items[1].productId, 202);

  console.log('import feasibility productId native checks passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
