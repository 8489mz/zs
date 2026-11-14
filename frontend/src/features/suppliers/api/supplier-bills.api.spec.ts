/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the supplier page builds a non-stock
 * bill from free-text lines (description + amount + chart account). The
 * payload builder below is the single gate the bill form uses before
 * POST /api/supplier-bills: it rejects an empty line list, a line with
 * no description, no account, or a non-positive amount — the backend
 * re-validates, but the form must refuse first with a field error
 * instead of sending a bill that can never post. The total is summed in
 * integer thousandths so 333.33 + 333.33 + 333.34 is exactly 1000, never
 * a float wobble. */
import { describe, it, expect } from 'vitest';
import { buildSupplierBillPayload, sumSupplierBillLines } from './supplier-bills.api';

const LINES = [
  { description: 'برنامج محاسبة', accountId: 6600, amount: 6000 },
  { description: 'كرتونة ورق', accountId: 6700, amount: 2500 },
  { description: 'كابلات', accountId: 6900, amount: 1500 },
];

describe('sumSupplierBillLines', () => {
  it('sums the three example lines to exactly 10,000', () => {
    expect(sumSupplierBillLines(LINES)).toBe(10000);
  });

  it('sums 2dp amounts without float wobble', () => {
    expect(sumSupplierBillLines([
      { amount: 333.33 },
      { amount: 333.33 },
      { amount: 333.34 },
    ])).toBe(1000);
  });

  it('sums 3dp amounts exactly', () => {
    expect(sumSupplierBillLines([
      { amount: 333.336 },
      { amount: 333.336 },
      { amount: 333.336 },
    ])).toBe(1000.008);
  });

  it('sums an empty list to 0', () => {
    expect(sumSupplierBillLines([])).toBe(0);
  });
});

describe('buildSupplierBillPayload', () => {
  it('builds the bill payload for the three example lines', () => {
    const payload = buildSupplierBillPayload('7', LINES, 'فاتورة توريدات');
    expect(payload).toEqual({
      supplierId: '7',
      lines: [
        { description: 'برنامج محاسبة', accountId: 6600, amount: 6000 },
        { description: 'كرتونة ورق', accountId: 6700, amount: 2500 },
        { description: 'كابلات', accountId: 6900, amount: 1500 },
      ],
      note: 'فاتورة توريدات',
    });
  });

  it('trims descriptions and coerces string account ids', () => {
    const payload = buildSupplierBillPayload('7', [
      { description: '  برنامج  ', accountId: '6600', amount: 100 },
    ]);
    expect(payload.lines).toEqual([{ description: 'برنامج', accountId: 6600, amount: 100 }]);
    expect(payload.note).toBeUndefined();
  });

  it('rejects an empty line list', () => {
    expect(() => buildSupplierBillPayload('7', [])).toThrow('أضف بندًا واحدًا على الأقل');
  });

  it('rejects a line with no description', () => {
    expect(() => buildSupplierBillPayload('7', [
      { description: '   ', accountId: 6600, amount: 100 },
    ])).toThrow('اكتب وصفًا لكل بند');
  });

  it('rejects a line with no account', () => {
    expect(() => buildSupplierBillPayload('7', [
      { description: 'برنامج', accountId: '', amount: 100 },
    ])).toThrow('اختر الحساب لكل بند');
  });

  it('rejects a non-positive line amount', () => {
    expect(() => buildSupplierBillPayload('7', [
      { description: 'برنامج', accountId: 6600, amount: 0 },
    ])).toThrow('المبلغ يجب أن يكون أكبر من صفر لكل بند');
    expect(() => buildSupplierBillPayload('7', [
      { description: 'برنامج', accountId: 6600, amount: -50 },
    ])).toThrow('المبلغ يجب أن يكون أكبر من صفر لكل بند');
  });
});
