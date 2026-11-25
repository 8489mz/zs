import assert from 'node:assert/strict';
import { buildDistributorPurchaseItem } from '../../src/modules/pharmacy/engines/distributor-purchase.engine';

const line = {
  productName: 'Medicine',
  quantity: 2,
  bonusQuantity: 1,
  costPrice: 10,
  batchNumber: 'B-24',
  expiryDate: '2030-12',
};
const result = buildDistributorPurchaseItem(line, 5, 8, 2);
assert.equal(result.qty, 3);
assert.equal(result.cost, 6.666667);
assert.equal(Math.round(result.qty * result.cost * 100), 2000, 'supplier AP excludes bonus units');
assert.equal(result.batchNumber, 'B-24');
const kwd = buildDistributorPurchaseItem({ ...line, quantity: 1, bonusQuantity: 0, costPrice: 0.001 }, 5, 8, 3);
assert.equal(kwd.cost, 0.001);
assert.throws(() => buildDistributorPurchaseItem({ ...line, costPrice: 0.001 }, 5, 8, 2), /precision/);
assert.throws(() => buildDistributorPurchaseItem({ ...line, batchNumber: '' }, 5, 8, 2), /batch/);
assert.throws(() => buildDistributorPurchaseItem({ ...line, expiryDate: 'unknown' }, 5, 8, 2), /expiry/);
assert.throws(() => buildDistributorPurchaseItem(line, 0, 8, 2), /tenant-owned/);
console.log('Distributor purchase and free bonus valuation regressions passed');
