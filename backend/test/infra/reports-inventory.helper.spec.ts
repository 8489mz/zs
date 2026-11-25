import { strict as assert } from 'node:assert';
import {
  buildInventoryLocationHighlights,
  buildInventoryReportItems,
  buildInventorySummary,
  groupInventoryLocationBreakdown,
} from '../../src/modules/reports/helpers/reports-inventory.helper';

(() => {
  const breakdown = groupInventoryLocationBreakdown([
    { product_id: 10, location_id: 7, branch_id: 1, qty: 4, location_name: 'المخزن أ', branch_name: 'الفرع الرئيسي' },
    { product_id: 10, location_id: 8, branch_id: 1, qty: 2, location_name: 'المخزن ب', branch_name: 'الفرع الرئيسي' },
    { product_id: 11, location_id: 9, branch_id: 2, qty: 0, location_name: 'المخزن ج', branch_name: 'فرع الجيزة' },
  ]);

  assert.equal(breakdown.size, 1);
  assert.equal(breakdown.get('10')?.[0]?.locationName, 'المخزن أ');

  const items = buildInventoryReportItems(
    [
      {
        id: 10,
        name: 'أرز',
        stock_qty: 9,
        min_stock_qty: 12,
        retail_price: 15,
        cost_price: 10,
        category_name: 'بقالة',
        supplier_name: 'المورد أ',
      },
      {
        id: 11,
        name: 'سكر',
        stock_qty: 0,
        min_stock_qty: 5,
        retail_price: 20,
        cost_price: 14,
        category_name: 'بقالة',
        supplier_name: 'المورد ب',
      },
    ],
    [
      { product_id: 10, location_id: 7, branch_id: 1, qty: 4, location_name: 'المخزن أ', branch_name: 'الفرع الرئيسي' },
      { product_id: 10, location_id: 8, branch_id: 1, qty: 2, location_name: 'المخزن ب', branch_name: 'الفرع الرئيسي' },
    ],
  );

  assert.equal(items[0].topLocationName, 'المخزن أ');
  assert.equal(items[0].assignedQty, 6);
  assert.equal(items[0].unassignedQty, 3);
  assert.match(items[0].locationsLabel, /مخزون غير مخصص: 3/);
  assert.equal(items[0].stockLocationExcessQty, 0);
  assert.match(items[0].locationsLabel, /المخزن أ/);
  assert.equal(items[1].status, 'out');

  const inconsistent = buildInventoryReportItems(
    [{ id: 12, name: 'مقاس XL', stock_qty: 3 }],
    [
      { product_id: 12, location_id: 1, qty: 2, location_name: 'مخزن صغير' },
      { product_id: 12, location_id: 2, qty: 5, location_name: 'مخزن كبير' },
    ],
  );
  assert.equal(inconsistent[0].topLocationName, 'مخزن كبير');
  assert.equal(inconsistent[0].stockLocationExcessQty, 4);
  assert.match(inconsistent[0].locationsLabel, /فرق مخزون/);
  assert.equal(inconsistent[0].locations[0].qty, 5);

  const { trackedLocations, highlights } = buildInventoryLocationHighlights([
    {
      product_id: 10,
      location_id: 7,
      branch_id: 1,
      qty: 4,
      min_stock_qty: 6,
      location_name: 'المخزن أ',
      branch_name: 'الفرع الرئيسي',
    },
    {
      product_id: 11,
      location_id: 7,
      branch_id: 1,
      qty: 0,
      min_stock_qty: 5,
      location_name: 'المخزن أ',
      branch_name: 'الفرع الرئيسي',
    },
    {
      product_id: 10,
      location_id: 8,
      branch_id: 1,
      qty: 5,
      min_stock_qty: 2,
      location_name: 'المخزن ب',
      branch_name: 'الفرع الرئيسي',
    },
  ]);

  assert.equal(trackedLocations, 2);
  assert.equal(highlights[0].locationName, 'المخزن أ');
  assert.equal(highlights[0].attentionItems, 2);
  assert.equal(highlights[0].outOfStockItems, 1);

  const summary = buildInventorySummary(14, 3, 4, 20, trackedLocations);
  assert.deepEqual(summary, {
    totalItems: 14,
    outOfStock: 3,
    lowStock: 4,
    healthy: 13,
    trackedLocations: 2,
  });

  console.log('reports-inventory.helper.spec: ok');
})();
