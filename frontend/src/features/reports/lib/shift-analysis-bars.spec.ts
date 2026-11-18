/*
New file: frontend/src/features/reports/lib/shift-analysis-bars.spec.ts
Pins buildShiftAnalysisBars (INV-SHIFT-ANALYSIS-REAL-TOTALS).

THE GAP: the overview shift chart used to render fixed ratios of net
sales (morning 45% / evening 35% / night 20%). This spec pins the
replacement: one bar per CLOSED cashier shift in the report range, each
bar the shift's own net close figure (shiftSalesTotal - saleReturnTotal,
both read off the hydrated GET /api/cashier-shifts row the close card
renders — computeShiftSalesBreakdown + computeShiftSaleReturnTotals).

WHAT THIS PINS, on the fixture test day 2026-11-18 (no sales tax, no
services revenue, every posted sale inside a closed shift):
- Shift SHIFT-1 (opener أحمد, sales 600.10, returns 0) renders 600.10.
- Shift SHIFT-2 (opener محمد, sales 400.20, returns 150.00) renders
  250.20 — the return is netted, not ignored.
- The two bars sum EXACTLY to that day's netSales 850.30 (integer
  minor-unit arithmetic: 600.10 + 250.20 is 850.30, never
  850.2999999999999).
- An OPEN shift and a PENDING_REVIEW shift in the same range render
  nothing (open shifts have no close figure; a pending review is not
  final yet).
- A CLOSED shift from the previous day renders nothing; a shift whose
  window straddles the range edge is counted whole (documented
  boundary residual — its out-of-range sales ride along).
- Bars come out oldest first, and the three-colour palette cycles.
- A 3-decimal tenant (digits 3) keeps the third decimal: 100.125 -
  0.005 = 100.120.
*/
import { describe, expect, it } from 'vitest';
import { buildShiftAnalysisBars } from '@/features/reports/lib/shift-analysis-bars';
import type { CashierShift } from '@/types/domain';

function shift(overrides: Partial<CashierShift> & { id: string }): CashierShift {
  return {
    docNo: `SHIFT-${overrides.id}`,
    status: 'closed',
    openingCash: 0,
    expectedCash: 0,
    countedCash: 0,
    variance: 0,
    createdAt: '2026-11-18T06:00:00.000Z',
    closedAt: '2026-11-18T14:00:00.000Z',
    openedByName: 'أحمد',
    ...overrides,
  } as CashierShift;
}

const RANGE = { from: '2026-11-18T00:00:00.000Z', to: '2026-11-18T23:59:59.999Z' };

const TEST_DAY_SHIFTS = [
  shift({
    id: '1',
    docNo: 'SHIFT-1',
    createdAt: '2026-11-18T06:00:00.000Z',
    closedAt: '2026-11-18T14:00:00.000Z',
    openedByName: 'أحمد',
    shiftSalesTotal: 600.1,
    saleReturnTotal: 0,
  }),
  shift({
    id: '2',
    docNo: 'SHIFT-2',
    createdAt: '2026-11-18T14:00:00.000Z',
    closedAt: '2026-11-18T22:00:00.000Z',
    openedByName: 'محمد',
    shiftSalesTotal: 400.2,
    saleReturnTotal: 150,
  }),
];

describe('buildShiftAnalysisBars', () => {
  it('renders one bar per closed shift at its net close figure, summing exactly to the test day net sales', () => {
    const bars = buildShiftAnalysisBars(TEST_DAY_SHIFTS, RANGE);
    expect(bars).toHaveLength(2);
    expect(bars[0].sales).toBe(600.1);
    expect(bars[1].sales).toBe(250.2);
    // Exact-sum identity: 600.10 + 250.20 === 850.30, no float drift.
    const total = bars.reduce((sum, bar) => sum + bar.sales, 0);
    expect(total).toBe(850.3);
    expect(total).toBe(850.3); // == the fixture day's netSales (tax 0, no services)
  });

  it('labels each bar with the shift doc number and the opener', () => {
    const bars = buildShiftAnalysisBars(TEST_DAY_SHIFTS, RANGE);
    expect(bars[0].shift.startsWith('SHIFT-1|')).toBe(true);
    expect(bars[0].shift).toContain('أحمد');
    expect(bars[1].shift.startsWith('SHIFT-2|')).toBe(true);
    expect(bars[1].shift).toContain('محمد');
    // Second line is the open–close clock range HH:MM–HH:MM.
    expect(bars[0].shift.split('|')[1]).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}$/);
  });

  it('excludes open and pending_review shifts — neither has a final close figure', () => {
    const rows = [
      ...TEST_DAY_SHIFTS,
      shift({ id: '3', status: 'open', shiftSalesTotal: 999, saleReturnTotal: 0 }),
      shift({ id: '4', status: 'pending_review', shiftSalesTotal: 888, saleReturnTotal: 0 }),
    ];
    const bars = buildShiftAnalysisBars(rows, RANGE);
    expect(bars).toHaveLength(2);
    expect(bars.map((bar) => bar.sales)).toEqual([600.1, 250.2]);
  });

  it('excludes a closed shift from another day, but counts a window straddling the range edge whole', () => {
    const rows = [
      ...TEST_DAY_SHIFTS,
      shift({
        id: '5',
        docNo: 'SHIFT-5',
        createdAt: '2026-11-17T06:00:00.000Z',
        closedAt: '2026-11-17T14:00:00.000Z',
        shiftSalesTotal: 777,
        saleReturnTotal: 0,
      }),
      shift({
        id: '6',
        docNo: 'SHIFT-6',
        createdAt: '2026-11-17T20:00:00.000Z',
        closedAt: '2026-11-18T02:00:00.000Z',
        openedByName: 'سارة',
        shiftSalesTotal: 120,
        saleReturnTotal: 20,
      }),
    ];
    const bars = buildShiftAnalysisBars(rows, RANGE);
    expect(bars.map((bar) => bar.shift.split('|')[0])).toEqual(['SHIFT-6', 'SHIFT-1', 'SHIFT-2']);
    expect(bars[0].sales).toBe(100);
  });

  it('orders bars oldest first and cycles the three-colour palette', () => {
    const rows = [...TEST_DAY_SHIFTS].reverse();
    rows.push(
      shift({
        id: '7',
        docNo: 'SHIFT-7',
        createdAt: '2026-11-18T22:00:00.000Z',
        closedAt: '2026-11-18T23:30:00.000Z',
        openedByName: 'ليلى',
        shiftSalesTotal: 50,
        saleReturnTotal: 0,
      }),
      shift({
        id: '8',
        docNo: 'SHIFT-8',
        createdAt: '2026-11-18T23:30:00.000Z',
        closedAt: '2026-11-18T23:59:00.000Z',
        openedByName: 'عمر',
        shiftSalesTotal: 10,
        saleReturnTotal: 0,
      }),
    );
    const bars = buildShiftAnalysisBars(rows, RANGE);
    expect(bars.map((bar) => bar.shift.split('|')[0])).toEqual(['SHIFT-1', 'SHIFT-2', 'SHIFT-7', 'SHIFT-8']);
    expect(bars.map((bar) => bar.color)).toEqual(['#3b82f6', '#8b5cf6', '#1e293b', '#3b82f6']);
  });

  it('keeps the third decimal on a 3-decimal tenant', () => {
    const bars = buildShiftAnalysisBars(
      [shift({ id: '9', shiftSalesTotal: 100.125, saleReturnTotal: 0.005 })],
      RANGE,
      3,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0].sales).toBe(100.12);
  });

  it('returns no bars without shifts or with an invalid range', () => {
    expect(buildShiftAnalysisBars([], RANGE)).toEqual([]);
    expect(buildShiftAnalysisBars(TEST_DAY_SHIFTS, { from: '', to: '' })).toEqual([]);
    expect(
      buildShiftAnalysisBars(TEST_DAY_SHIFTS, {
        from: '2026-11-19T00:00:00.000Z',
        to: '2026-11-18T00:00:00.000Z',
      }),
    ).toEqual([]);
  });
});
