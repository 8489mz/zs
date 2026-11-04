import assert from 'node:assert/strict';
import {
  assertDamagedStockNote,
  assertInventoryLocationBranchMatch,
  buildDamagedStockWriteModels,
  buildDamageRecordFromCount,
  buildStockCountItemValues,
  buildStockCountPostingMovement,
  buildStockCountSessionDocNo,
  shouldCreateDamageRecordFromCount,
} from '../../src/modules/inventory/helpers/inventory-count-write.helper';

(function inventoryCountWriteHelperSpec() {
  assert.ok(buildStockCountSessionDocNo(123456).startsWith('ZSC-'));

  const countItem = buildStockCountItemValues(
    { id: 5, name: 'رز', stock_qty: 10 },
    { productId: 5, countedQty: 7.5, reason: 'damage', note: 'broken bag' },
    22,
  );
  assert.deepEqual(countItem, {
    session_id: 22,
    product_id: 5,
    product_name: 'رز',
    expected_qty: 10,
    counted_qty: 7.5,
    variance_qty: -2.5,
    reason: 'damage',
    note: 'broken bag',
  });

  const posting = buildStockCountPostingMovement(
    { product_id: 5, expected_qty: 10, counted_qty: 7.5, variance_qty: -2.5, reason: 'damage', note: 'broken bag' },
    22,
    9,
  );
  assert.equal(posting.movement_type, 'stock_count_loss');
  assert.equal(posting.qty, -2.5);
  assert.equal(posting.reference_id, 22);
  assert.equal(posting.created_by, 9);

  assert.equal(shouldCreateDamageRecordFromCount({ reason: 'damage', variance_qty: -2.5 }), true);
  assert.equal(shouldCreateDamageRecordFromCount({ reason: 'damage', variance_qty: 0 }), false);
  assert.equal(shouldCreateDamageRecordFromCount({ reason: 'count', variance_qty: -1 }), false);

  const damageFromCount = buildDamageRecordFromCount(
    { product_id: 5, variance_qty: -2.5, note: 'broken bag' },
    { branch_id: 3, location_id: 4 },
    9,
  );
  assert.equal(damageFromCount.qty, 2.5);
  assert.equal(damageFromCount.branch_id, 3);
  assert.equal(damageFromCount.location_id, 4);

  const damagedWrite = buildDamagedStockWriteModels(
    { id: 8, name: 'سكر', stock_qty: 12 },
    { productId: 8, qty: 1.25, reason: 'damage', note: 'torn package' },
    { id: 6, branchId: 2 },
    11,
  );
  assert.equal(damagedWrite.nextStockQty, 10.75);
  assert.equal(damagedWrite.stockMovement.qty, -1.25);
  assert.equal(damagedWrite.damagedRecord.qty, 1.25);
  assert.equal(damagedWrite.damagedRecord.location_id, 6);

  assert.throws(() => assertDamagedStockNote('   '), /DAMAGE_NOTE_REQUIRED/);
  assert.doesNotThrow(() => assertDamagedStockNote('short'));
  assert.doesNotThrow(() => assertDamagedStockNote('سبب تالف واضح'));

  assert.throws(() => assertInventoryLocationBranchMatch(10, 11), /LOCATION_BRANCH_MISMATCH/);
  assert.doesNotThrow(() => assertInventoryLocationBranchMatch(10, 10));
  assert.doesNotThrow(() => assertInventoryLocationBranchMatch(undefined, 10));

  console.log('inventory count write helper spec passed');
})();
