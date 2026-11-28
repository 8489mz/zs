import assert from 'node:assert/strict';
import {
  computeDailyFlowReconciliation,
  buildShrinkageHeatmap,
  evaluateTransferAging,
} from '../../src/modules/inventory/engines/shrinkage-reconciliation.engine';
import {
  parseAntiTheftSettingsFromMap,
  DEFAULT_ANTI_THEFT_SETTINGS,
} from '../../src/common/utils/anti-theft-settings.util';

// 1. Daily Flow Reconciliation (Hall / Street / Warehouse Shrinkage Math)
const flowRows = computeDailyFlowReconciliation([
  {
    productId: '101',
    productName: 'كاجو محمص وسط',
    locationId: '2',
    locationName: 'صالة الفرع الرئيسي',
    unitCost: 600,
    openingQty: 10,
    transferredInQty: 15,
    purchasedQty: 0,
    transferredOutQty: 2,
    soldQty: 18,
    recordedDamagedQty: 0.5,
    physicalCountedQty: 3.5, // expected = 10 + 15 - 2 - 18 - 0.5 = 4.5 -> missing 1.0 kg (600 EGP)
  },
  {
    productId: '102',
    productName: 'بن تركي محوج',
    locationId: '2',
    locationName: 'صالة الفرع الرئيسي',
    unitCost: 350,
    openingQty: 20,
    transferredInQty: 10,
    purchasedQty: 5,
    transferredOutQty: 0,
    soldQty: 25,
    recordedDamagedQty: 0,
    physicalCountedQty: 10, // expected = 10 -> exact match
  },
  {
    productId: '103',
    productName: 'فستق حلبي',
    locationId: '2',
    locationName: 'صالة الفرع الرئيسي',
    unitCost: 900,
    openingQty: 5,
    transferredInQty: 5,
    purchasedQty: 0,
    transferredOutQty: 0,
    soldQty: 4,
    recordedDamagedQty: 0,
    physicalCountedQty: null, // not yet counted today
  },
]);

assert.equal(flowRows[0].expectedEndingQty, 4.5);
assert.equal(flowRows[0].shrinkageQty, 1);
assert.equal(flowRows[0].shrinkageCost, 600);
assert.equal(flowRows[0].status, 'shortage');
assert.equal(flowRows[0].shrinkageRatePct, 4); // 1 / (10 + 15) = 4%

assert.equal(flowRows[1].expectedEndingQty, 10);
assert.equal(flowRows[1].shrinkageQty, 0);
assert.equal(flowRows[1].status, 'matched');

assert.equal(flowRows[2].expectedEndingQty, 6);
assert.equal(flowRows[2].status, 'uncounted');

// 2. Shrinkage Heatmap — Multi-row, Multi-cause Accumulation (Zero Dropped Rows)
const heatmap = buildShrinkageHeatmap([
  {
    productId: '1',
    productName: 'لوز أمريكي',
    locationId: '1',
    locationName: 'مخزن 1',
    cause: 'damaged',
    qty: 2,
    cost: 800,
  },
  {
    productId: '1',
    productName: 'لوز أمريكي',
    locationId: '1',
    locationName: 'مخزن 1',
    cause: 'damaged',
    qty: 1.5,
    cost: 600,
  },
  {
    productId: '1',
    productName: 'لوز أمريكي',
    locationId: '2',
    locationName: 'صالة الفرع',
    cause: 'count_shortage',
    qty: 1,
    cost: 400,
  },
  {
    productId: '2',
    productName: 'زيت زيتون بكر',
    locationId: '3',
    locationName: 'مخزن 2',
    cause: 'transfer_shortage',
    qty: 5,
    cost: 2500,
  },
  {
    productId: '3',
    productName: 'فلفل أسود حصى',
    locationId: '2',
    locationName: 'صالة الفرع',
    cause: 'negative_adjustment',
    qty: 3,
    cost: 900,
  },
]);

assert.equal(heatmap.totalIncidents, 5);
assert.equal(heatmap.totalLossQty, 12.5);
assert.equal(heatmap.totalLossCost, 5200);
assert.equal(heatmap.byCause.damaged.cost, 1400, 'Multiple rows of same cause must accumulate without dropping');
assert.equal(heatmap.byCause.damaged.count, 2);
assert.equal(heatmap.topProducts[0].productId, '2', 'Highest financial loss product must rank #1');
assert.equal(heatmap.topProducts[0].totalCostLost, 2500);
assert.equal(heatmap.topProducts[1].productId, '1');
assert.equal(heatmap.topProducts[1].totalCostLost, 1800);
assert.equal(heatmap.topProducts[1].topLocationName, 'مخزن 1', 'Top loss location must be identified per product');

// 3. In-Transit Transfer Aging Threshold
const now = new Date('2026-11-28T16:00:00Z');
const fresh = evaluateTransferAging({
  transferId: '10',
  docNo: 'ZTR-261128-0010',
  createdAt: '2026-11-28T14:00:00Z',
  alertHours: 4,
  now,
});
assert.equal(fresh.ageHours, 2);
assert.equal(fresh.isOverdue, false);
assert.equal(fresh.overdueByHours, 0);

const overdue = evaluateTransferAging({
  transferId: '11',
  docNo: 'ZTR-261128-0011',
  createdAt: '2026-11-28T09:30:00Z',
  alertHours: 4,
  now,
});
assert.equal(overdue.ageHours, 6.5);
assert.equal(overdue.isOverdue, true);
assert.equal(overdue.overdueByHours, 2.5);

// 4. Anti-Theft Settings Defaults & Overrides (Zero-Regression + 20h Delivery Gate)
const defaultParsed = parseAntiTheftSettingsFromMap(new Map());
assert.equal(defaultParsed.requirePinForNoSale, false);
assert.equal(defaultParsed.strictTwoStepTransfers, false);
assert.equal(defaultParsed.blockOverdueDeliveryRep, false);
assert.equal(defaultParsed.defaultDeliveryCustodyCap, 0);
assert.equal(defaultParsed.deliveryOverdueHours, 20);
assert.deepEqual(defaultParsed, DEFAULT_ANTI_THEFT_SETTINGS);

const strictParsed = parseAntiTheftSettingsFromMap(
  new Map<string, unknown>([
    ['antiTheftBlockOverdueDeliveryRep', true],
    ['antiTheftDeliveryOverdueHours', 20],
    ['antiTheftStrictTwoStepTransfers', true],
    ['antiTheftEnforceBlindStockCount', true],
  ]),
);
assert.equal(strictParsed.blockOverdueDeliveryRep, true);
assert.equal(strictParsed.deliveryOverdueHours, 20);
assert.equal(strictParsed.strictTwoStepTransfers, true);
assert.equal(strictParsed.enforceBlindStockCount, true);
assert.equal(strictParsed.defaultDeliveryCustodyCap, 0);

console.log('PASS: shrinkage-reconciliation-engine.spec.ts');
