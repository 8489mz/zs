/* INV-SERVICE-ITEM-QUICK-CREATE: a service item created or selected from
 * the purchase invoice must land on a service line, and a service line
 * must never touch stock or be capitalised as inventory. The pure
 * helpers below are what the purchase writer and postPurchase use:
 * the normalized line carries the service flag from the product row,
 * the discount allocation preserves it, and the journal split keeps
 * the service share out of inventory (1140) and in other expenses
 * (6950). These checks fail if the flag or the split is removed.
 */

import { strict as assert } from 'node:assert';
import {
  allocatePurchaseInvoiceDiscount,
  buildNormalizedPurchaseItem,
  partitionPurchaseLineTotals,
} from '../../src/modules/purchases/helpers/purchases-write.helper';

// 1. The normalized line carries the service flag from the product row.
const serviceLine = buildNormalizedPurchaseItem(
  { productId: 11, qty: 2, cost: 150, unitName: 'خدمة', unitMultiplier: 1, name: '' } as never,
  { id: 11, name: 'خدمة توريد ونقل', item_type: 'service' },
);
assert.equal(serviceLine.isService, true, 'a service product normalizes to a service line');
assert.equal(serviceLine.total, 300);

const stockedLine = buildNormalizedPurchaseItem(
  { productId: 12, qty: 3, cost: 20, unitName: 'قطعة', unitMultiplier: 1, name: '' } as never,
  { id: 12, name: 'سكر', item_type: 'product' },
);
assert.equal(stockedLine.isService, false, 'a stocked product normalizes to a stocked line');

const legacyLine = buildNormalizedPurchaseItem(
  { productId: 13, qty: 1, cost: 10, unitName: 'قطعة', unitMultiplier: 1, name: '' } as never,
  { id: 13, name: 'صنف قديم' },
);
assert.equal(legacyLine.isService, false, 'a product row without item_type is treated as stocked, as before');

// 2. Discount allocation preserves the flag and the discount-allocated nets.
const allocated = allocatePurchaseInvoiceDiscount([serviceLine, stockedLine], 60, 2);
assert.equal(allocated[0].isService, true, 'allocation keeps the service flag on the service line');
assert.equal(allocated[1].isService, false, 'allocation keeps the stocked flag on the stocked line');
assert.equal(allocated[0].effectiveLineTotal, 250, 'service line nets 300 - 50 of the 60 discount');
assert.equal(allocated[1].effectiveLineTotal, 50, 'stocked line nets 60 - 10 of the 60 discount');

// 3. The journal split keeps the service share out of inventory.
assert.deepEqual(
  partitionPurchaseLineTotals(
    [{ lineTotal: 250, isService: true }, { lineTotal: 50, isService: false }],
    14,
    false,
    2,
  ),
  { serviceNet: 250, stockedNet: 50 },
  'mixed invoice: the service share is split out of the inventory share',
);
assert.deepEqual(
  partitionPurchaseLineTotals([{ lineTotal: 100 }], 0, false, 2),
  { serviceNet: 0, stockedNet: 100 },
  'stocked-only invoice: no service share, previous behaviour unchanged',
);
assert.deepEqual(
  partitionPurchaseLineTotals([{ lineTotal: 100, isService: true }], 0, false, 2),
  { serviceNet: 100, stockedNet: 0 },
  'service-only invoice: no inventory share',
);
assert.deepEqual(
  partitionPurchaseLineTotals(
    [{ lineTotal: 114, isService: true }, { lineTotal: 228, isService: false }],
    14,
    true,
    2,
  ),
  { serviceNet: 100, stockedNet: 200 },
  'tax-inclusive prices: VAT is stripped from both shares per line',
);
assert.deepEqual(
  partitionPurchaseLineTotals(
    [{ lineTotal: 0.005, isService: true }, { lineTotal: 0.01, isService: false }],
    0,
    false,
    3,
  ),
  { serviceNet: 0.005, stockedNet: 0.01 },
  'three-digit books keep the last fil on both shares',
);

console.log('service item quick-create checks passed');
