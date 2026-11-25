import assert from 'node:assert/strict';
import {
  buildDamagedStockSummary,
  buildStockCountSummary,
  buildStockMovementSummary,
  groupStockCountItemsBySession,
  mapDamagedStockRow,
  mapStockCountSessionRow,
  mapStockMovementRow,
} from '../../src/modules/inventory/helpers/inventory-count-listing.helper';

assert.deepEqual(
  mapStockMovementRow({
    id: 1,
    product_id: 5,
    movement_type: 'sale',
    qty: '-2.5',
    before_qty: '10',
    after_qty: '7.5',
    reason: 'sold',
    note: null,
    reference_type: 'sale',
    reference_id: 3,
    branch_id: 2,
    location_id: 9,
    created_at: '2026-01-01',
    product_name: 'Item',
    branch_name: 'Main',
    location_name: 'Shelf',
    created_by_name: 'admin',
  }),
  {
    id: '1',
    productId: '5',
    productName: 'Item',
    type: 'sale',
    qty: -2.5,
    beforeQty: 10,
    afterQty: 7.5,
    reason: 'sold',
    note: '',
    referenceType: 'sale',
    referenceId: '3',
    branchId: '2',
    branchName: 'Main',
    locationId: '9',
    locationName: 'Shelf',
    createdBy: 'admin',
    date: '2026-01-01',
  },
);

assert.deepEqual(buildStockMovementSummary([{ qty: 5 }, { qty: -2.25 }, { qty: 1 }]), {
  positive: 6,
  negative: 2.25,
  totalItems: 3,
});
assert.deepEqual(
  mapDamagedStockRow({
    id: 7,
    product_id: 4,
    qty: '3.5',
    reason: null,
    note: 'broken',
    branch_id: 2,
    location_id: 8,
    created_at: '2026-02-01',
    product_name: 'Milk',
    branch_name: 'B1',
    location_name: 'L1',
    created_by_name: 'owner',
  }),
  {
    id: '7',
    productId: '4',
    productName: 'Milk',
    branchId: '2',
    branchName: 'B1',
    locationId: '8',
    locationName: 'L1',
    qty: 3.5,
    reason: 'damage',
    note: 'broken',
    createdBy: 'owner',
    date: '2026-02-01',
  },
);
assert.deepEqual(buildDamagedStockSummary([{ qty: 3.5 }, { qty: 1.25 }]), { totalItems: 2, totalQty: 4.75 });

const grouped = groupStockCountItemsBySession([
  {
    id: 1,
    session_id: 10,
    product_id: 5,
    product_name: 'A',
    expected_qty: '4',
    counted_qty: '3',
    variance_qty: '-1',
    reason: 'damage',
    note: '',
  },
  {
    id: 2,
    session_id: 10,
    product_id: 6,
    product_name: 'B',
    expected_qty: '2',
    counted_qty: '2',
    variance_qty: '0',
    reason: '',
    note: '',
  },
]);
const mappedSession = mapStockCountSessionRow(
  {
    id: 10,
    doc_no: null,
    branch_id: 1,
    location_id: 2,
    status: 'draft',
    note: 'count',
    posted_at: null,
    created_at: '2026-03-01',
    branch_name: 'Main',
    location_name: 'Front',
    counted_by_name: 'u1',
    approved_by_name: null,
  },
  grouped,
);
assert.equal(mappedSession.docNo, 'COUNT-10');
assert.equal((mappedSession.items as unknown[]).length, 2);
assert.deepEqual(
  buildStockCountSummary([mappedSession as never, { status: 'posted', items: [{ varianceQty: 2 }] } as never]),
  { totalItems: 2, draft: 1, posted: 1, totalVariance: 1 },
);

console.log('inventory count listing helper checks passed');
