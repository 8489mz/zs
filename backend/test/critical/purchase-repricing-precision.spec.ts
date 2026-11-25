import assert from 'node:assert/strict';
import { PurchasesWriteRepricingService } from '../../src/modules/purchases/services/purchases-write-repricing.service';

const engine = new PurchasesWriteRepricingService() as any;
const candidates = [
  {
    productId: 42,
    name: 'KWD part',
    itemKind: 'standard',
    styleCode: '',
    previousCost: 1.001,
    newCost: 1.002,
    retailPrice: 2.001,
    wholesalePrice: 1.501,
  },
];
const kwd = engine.buildPurchaseRepricingInsights(1, { id: 1, name: 'Supplier' }, candidates, 3);
const egp = engine.buildPurchaseRepricingInsights(1, { id: 1, name: 'Supplier' }, candidates, 2);
assert.equal(kwd.rows[0].previousCost, 1.001);
assert.equal(kwd.rows[0].newCost, 1.002);
assert.equal(kwd.rows[0].retailPrice, 2.001);
assert.equal(kwd.rows[0].wholesalePrice, 1.501);
assert.equal(kwd.rows[0].recommendedRetailDelta, 0.002);
assert.equal(egp.rows[0].previousCost, 1);
assert.equal(egp.rows[0].retailPrice, 2);
console.log('purchase repricing minor unit precision passed');
