/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the supplier page builds a non-stock
 * bill from free-text lines (description + amount + chart account). The
 * payload builder below is the single gate the bill form uses before
 * POST /api/supplier-bills: it rejects an empty line list, a line with
 * no description, no account, or a non-positive amount — the backend
 * re-validates, but the form must refuse first with a field error
 * instead of sending a bill that can never post. The total is summed in
 * integer thousandths so 333.33 + 333.33 + 333.34 is exactly 1000, never
 * a float wobble.
 * INV-SUPPLIER-BILL-PLAIN-KIND: each line asks "what is this?" in plain
 * words and the account fills itself from the single kind mapping below
 * — the merchant never picks a raw chart code, and 'other' keeps the
 * manual picker. Every mapped code is an expense/asset account from the
 * tenant chart seed, never a blocked one. */
import { describe, it, expect } from 'vitest';
import {
  buildSupplierBillPayload,
  sumSupplierBillLines,
  SUPPLIER_BILL_KINDS,
  supplierBillKindById,
  resolveSupplierBillKindAccountId,
} from './supplier-bills.api';

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

describe('SUPPLIER_BILL_KINDS', () => {
  /* The trial-proven kinds first: program -> 6700, paper carton -> 6900,
   * cables -> 1210, freelancer month-end fee -> 6200. The rest are the
   * common non-stock kinds from the tenant chart seed. */
  const EXPECTED: Array<[string, string]> = [
    ['software', '6700'],
    ['paper', '6900'],
    ['equipment', '1210'],
    ['furniture', '1220'],
    ['freelancer', '6200'],
    ['maintenance', '6600'],
    ['transport', '6400'],
    ['utilities', '6300'],
    ['rent', '6100'],
    ['marketing', '6500'],
  ];

  it('maps every plain kind to exactly one chart account', () => {
    for (const [id, code] of EXPECTED) {
      expect(supplierBillKindById(id)?.accountCode).toBe(code);
    }
    expect(SUPPLIER_BILL_KINDS).toHaveLength(EXPECTED.length + 1);
  });

  it('maps no kind to a blocked bill account', () => {
    const blocked = new Set([
      '1110', '1120', '1130', '1140', '2110', '1185', '1160', '1165', '1150', '2120', '2126', '2150',
    ]);
    for (const kind of SUPPLIER_BILL_KINDS) {
      if (kind.accountCode !== null) expect(blocked.has(kind.accountCode)).toBe(false);
    }
  });

  it('keeps every kind label in plain Arabic with no chart code in it', () => {
    for (const kind of SUPPLIER_BILL_KINDS) {
      expect(kind.label.length).toBeGreaterThan(0);
      expect(kind.label).not.toMatch(/\d{4}/);
    }
  });

  it('maps other to null so the manual picker stays the fallback', () => {
    expect(supplierBillKindById('other')?.accountCode).toBeNull();
  });

  it('returns undefined for an unknown or empty kind id', () => {
    expect(supplierBillKindById('nope')).toBeUndefined();
    expect(supplierBillKindById('')).toBeUndefined();
    expect(supplierBillKindById(null)).toBeUndefined();
  });
});

describe('resolveSupplierBillKindAccountId', () => {
  const accounts = [
    { id: 11, code: '6700' },
    { id: 12, code: '6900' },
    { id: 13, code: '1210' },
    { id: 14, code: '6200' },
  ];

  it('resolves a mapped kind to the tenant account id by code', () => {
    expect(resolveSupplierBillKindAccountId('software', accounts)).toBe('11');
    expect(resolveSupplierBillKindAccountId('paper', accounts)).toBe('12');
    expect(resolveSupplierBillKindAccountId('equipment', accounts)).toBe('13');
    expect(resolveSupplierBillKindAccountId('freelancer', accounts)).toBe('14');
  });

  it('returns null for other, unknown kinds, and a mapped code missing from the chart', () => {
    expect(resolveSupplierBillKindAccountId('other', accounts)).toBeNull();
    expect(resolveSupplierBillKindAccountId('nope', accounts)).toBeNull();
    expect(resolveSupplierBillKindAccountId('rent', accounts)).toBeNull();
    expect(resolveSupplierBillKindAccountId('software', [])).toBeNull();
  });
});
