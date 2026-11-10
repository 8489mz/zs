import assert from 'node:assert/strict';
import { filterReturnRows, mapReturnRows, summarizeReturnRows } from '../../src/modules/returns/helpers/returns-listing.helper';

const rows = mapReturnRows([
  { id: 1, return_document_id: 10, doc_no: 'RET-10', return_type: 'sale', invoice_id: 20, product_id: 2, product_name: 'Tea', qty: 1, line_total: 15, note: 'damaged', settlement_mode: 'refund', refund_method: 'cash', created_at: '2026-04-09T10:00:00.000Z' },
  { id: 2, return_document_id: 11, doc_no: 'RET-11', return_type: 'purchase', invoice_id: 21, product_id: 3, product_name: 'Sugar', qty: 2, line_total: 30, note: 'expired', settlement_mode: 'refund', refund_method: 'cash', created_at: '2026-04-08T10:00:00.000Z' },
]);

assert.equal(rows.length, 2);
assert.equal(rows[0].docNo, 'RET-10');
assert.equal(rows[1].returnType, 'purchase');

const salesOnly = filterReturnRows(rows, { filter: 'sales' }, '2026-04-09');
assert.equal(salesOnly.length, 1);
assert.equal(salesOnly[0].returnType, 'sale');

const searched = filterReturnRows(rows, { q: 'sug' }, '2026-04-09');
assert.equal(searched.length, 1);
assert.equal(searched[0].productName, 'Sugar');

assert.deepEqual(summarizeReturnRows(rows, '2026-04-09'), {
  totalItems: 2,
  totalAmount: 45,
  salesReturns: 1,
  purchaseReturns: 1,
  todayCount: 1,
  latestDocNo: 'RET-10',
});

// T12-H3 (INV-REST-RETURN-LIST-REFUND-TRUTH): the server summary must
// total the actual refund (goods + relief), not the goods-only total.
// The tipped document below refunds 85 (75 goods + 10 tip relief);
// on the base summarizeReturnRows sums row.total, so totalAmount is 75.
const reliefRows = mapReturnRows([
  { id: 3, return_document_id: 12, doc_no: 'ZR-261110-0596', return_type: 'sale', invoice_id: 22, product_id: 4, product_name: 'Meal', qty: 1, line_total: 75, tip_relief: 10, courier_relief: 0, note: 'tipped', settlement_mode: 'refund', refund_method: 'cash', created_at: '2026-11-10T10:00:00.000Z' },
]);

assert.equal(reliefRows[0].refundTotal, 85);
assert.equal(summarizeReturnRows(reliefRows, '2026-11-10').totalAmount, 85);

// Fallback: a row without refundTotal still totals its goods figure.
const legacyRow = { ...reliefRows[0] };
delete (legacyRow as Partial<typeof reliefRows[0]>).refundTotal;
assert.equal(summarizeReturnRows([legacyRow], '2026-11-10').totalAmount, 75);

console.log('returns listing helper checks passed');
