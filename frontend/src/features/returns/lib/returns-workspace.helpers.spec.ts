/* T11-C (INV-REST-RETURN-RELIEF-LOUD-TRUTH): the register summary
 * stat must show the actual refund (goods + tip/courier relief),
 * never the goods-only total. These helpers are the single place
 * that derives the actual refund from a register row, used by the
 * workspace stat and by the print fallback. */
import { describe, expect, it } from 'vitest';
import { actualReturnRefund, sumActualReturnRefunds } from './returns-workspace.helpers';
import type { ReturnRecord } from '@/types/domain';

function record(overrides: Partial<ReturnRecord> = {}): ReturnRecord {
  return {
    id: '1',
    docNo: 'ZR-261110-0001',
    returnType: 'sale',
    productName: 'Widget',
    qty: 1,
    total: 75,
    note: '',
    ...overrides,
  };
}

describe('actualReturnRefund (T11-C)', () => {
  it('uses the stored refundTotal when the document carries relief', () => {
    expect(actualReturnRefund(record({ total: 75, tipRelief: 10, refundTotal: 85 }))).toBe(85);
  });

  it('rebuilds the refund from goods + relief when refundTotal is absent', () => {
    expect(actualReturnRefund(record({ total: 50, tipRelief: 5, courierRelief: 10, refundTotal: undefined }))).toBe(65);
  });

  it('falls back to the goods total for legacy documents without relief', () => {
    expect(actualReturnRefund(record({ total: 75 }))).toBe(75);
  });
});

describe('sumActualReturnRefunds (T11-C)', () => {
  it('sums actual refunds across documents, not goods totals', () => {
    const rows = [
      record({ id: '1', total: 75, tipRelief: 10, refundTotal: 85 }),
      record({ id: '2', total: 50, tipRelief: 5, courierRelief: 10, refundTotal: 65 }),
    ];
    expect(sumActualReturnRefunds(rows)).toBe(150);
  });

  it('returns 0 for an empty register', () => {
    expect(sumActualReturnRefunds([])).toBe(0);
  });
});
