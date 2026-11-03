import assert from 'node:assert/strict';
import { assertCashDrawerAmount, assertCashDrawerCountedCash, assertCashDrawerNote, buildCashDrawerShiftDocNo, computeCashDrawerVariance, filterCashDrawerRows, mapCashDrawerShiftRow, normalizeCashDrawerMovementType, normalizeShiftOpenPayload, paginateCashDrawerRows, summarizeCashDrawerRows, toSignedCashDrawerAmount } from '../../src/modules/cash-drawer/helpers/cash-drawer.helper';

(function cashDrawerHelperSpec() {
  const rows = [
    mapCashDrawerShiftRow({ id: 12, doc_no: 'SHIFT-12', status: 'open', variance: '0', opening_cash: '100', branch_name: 'الفرع الرئيسي', location_name: 'الخزنة 1', opened_by_name: 'ali', opening_note: 'بداية يوم', created_at: '2026-04-09T09:00:00.000Z' }),
    mapCashDrawerShiftRow({ id: 11, doc_no: 'SHIFT-11', status: 'closed', variance: '-5.25', opening_cash: '50', branch_name: 'فرع 2', location_name: 'الخزنة 2', opened_by_name: 'mona', close_note: 'فرق بسيط', created_at: '2026-04-08T09:00:00.000Z' }),
  ];
  const openOnly = filterCashDrawerRows(rows, { filter: 'open' });
  assert.equal(openOnly.length, 1);
  const searched = filterCashDrawerRows(rows, { search: 'فرق' });
  assert.equal(searched.length, 1);
  const paged = paginateCashDrawerRows(rows, { page: 2, pageSize: 1 });
  assert.equal(paged.rows.length, 1);
  assert.equal(paged.pagination.totalPages, 2);
  const summary = summarizeCashDrawerRows(rows);
  assert.equal(summary.openShiftCount, 1);
  assert.equal(summary.totalVariance, -5.25);
  // Universal Document Numbering standard: PREFIX-YYMMDD-NNNN (date injected so the assertion stays deterministic).
  assert.equal(buildCashDrawerShiftDocNo(77, new Date('2026-09-20T00:00:00.000Z')), 'SHIFT-260920-0077');
  assert.match(buildCashDrawerShiftDocNo(77), /^SHIFT-\d{6}-\d{4}$/);
  const normalized = normalizeShiftOpenPayload({ openingCash: '25' as unknown as number, note: ' start ', branchId: '3', locationId: '4', password: '  secret123  ' });
  assert.equal(normalized.openingCash, 25);
  assert.equal(normalized.note, 'start');
  assert.equal(normalized.branchId, 3);
  assert.equal(normalized.locationId, 4);
  assert.equal(normalized.password, 'secret123');
  assert.equal(normalizeCashDrawerMovementType('cash_out'), 'cash_out');
  assert.equal(normalizeCashDrawerMovementType('safe_drop'), 'safe_drop');
  assert.equal(normalizeCashDrawerMovementType('safe_replenishment'), 'safe_replenishment');
  assert.equal(normalizeCashDrawerMovementType(''), 'cash_in');
  assert.throws(() => normalizeCashDrawerMovementType('other'), (error: any) => error?.code === 'DRAWER_MOVEMENT_TYPE_UNKNOWN');
  assert.equal(toSignedCashDrawerAmount('cash_out', 10.5), -10.5);
  assert.equal(toSignedCashDrawerAmount('cash_in', 10.5), 10.5);
  assert.equal(toSignedCashDrawerAmount('safe_drop', 10.5), -10.5);
  assert.equal(toSignedCashDrawerAmount('safe_replenishment', 10.5), 10.5);
  assert.equal(computeCashDrawerVariance(88.5, 100, 2), -11.5);
  assert.throws(() => assertCashDrawerAmount(0), (error: any) => error?.code === 'AMOUNT_INVALID');
  assert.throws(() => assertCashDrawerCountedCash(-1), (error: any) => error?.code === 'COUNTED_CASH_INVALID');
  assert.throws(() => assertCashDrawerNote(''), (error: any) => error?.code === 'NOTE_REQUIRED');
  assert.doesNotThrow(() => assertCashDrawerNote('قصير'));
  assert.doesNotThrow(() => assertCashDrawerNote('سبب حركة واضح'));
  console.log('cash drawer helper spec passed');
})();
