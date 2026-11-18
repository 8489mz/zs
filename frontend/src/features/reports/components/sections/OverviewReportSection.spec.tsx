/*
New file: frontend/src/features/reports/components/sections/OverviewReportSection.spec.tsx
Pins the wiring of the overview shift chart (INV-SHIFT-ANALYSIS-REAL-TOTALS).

THE GAP: the section used to hand ShiftAnalysisChart three invented bars
(netSales x 45% / 35% / 20% under the fixed morning/evening/night
labels). This spec pins the replacement wiring: with two closed shifts
in the report range, the section passes the chart exactly those shifts'
net close figures — and none of the old fixed labels.

The chart itself is stubbed (recharts ResponsiveContainer renders
nothing in jsdom, so tick text is unobservable here): the stub renders
the data it receives as JSON, which is exactly the section's contract
with the chart — the right bars, in the right order, with the right
numbers. The arithmetic behind the bars is pinned separately by
shift-analysis-bars.spec.ts, which drives the real pure helper.

FIXTURE (test day 2026-11-18, netSales 850.30, no tax, no services):
- SHIFT-1: sales 600.10, returns 0 -> bar 600.10.
- SHIFT-2: sales 400.20, returns 150.00 -> bar 250.20.
- An OPEN shift in the same range (sales 999) renders no bar.
Bars sum exactly to 850.30. With the old ratio code this spec fails:
it would receive 382.64 / 297.61 / 170.06 under the three fixed labels.
*/
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { OverviewReportSection } from '@/features/reports/components/sections/OverviewReportSection';
import type { ReportSummary } from '@/types/domain';

vi.mock('@/shared/components/charts/ShiftAnalysisChart', () => ({
  ShiftAnalysisChart: ({ data }: { data: Array<{ shift: string; sales: number; color: string }> }) => (
    <div data-testid="shift-analysis-chart">{JSON.stringify(data)}</div>
  ),
}));

const mockListAll = vi.fn();
vi.mock('@/lib/api/cash-drawer', () => ({
  cashDrawerApi: {
    listAll: (...args: unknown[]) => mockListAll(...args),
  },
}));

function closedShift(overrides: Record<string, unknown>) {
  return {
    id: '1',
    docNo: 'SHIFT-1',
    status: 'closed',
    openingCash: 0,
    expectedCash: 0,
    countedCash: 0,
    variance: 0,
    createdAt: '2026-11-18T06:00:00.000Z',
    closedAt: '2026-11-18T14:00:00.000Z',
    openedByName: 'أحمد',
    shiftSalesTotal: 600.1,
    saleReturnTotal: 0,
    ...overrides,
  };
}

const report: ReportSummary = {
  sales: { count: 3, total: 1000.3, netSales: 850.3 },
  purchases: { count: 0, total: 0, netPurchases: 0 },
  expenses: { count: 0, total: 0 },
  returns: { count: 1, total: 150, salesTotal: 150 },
  treasury: { cashIn: 0, cashOut: 0, net: 0 },
  commercial: { grossProfit: 850.3, grossMarginPercent: 100, netOperatingProfit: 850.3, cogs: 0 },
  range: { from: '2026-11-18T00:00:00.000Z', to: '2026-11-18T23:59:59.999Z' },
};

describe('OverviewReportSection shift chart', () => {
  it('passes one bar per closed shift at its net close figure, never the old fixed ratios', async () => {
    mockListAll.mockResolvedValue({
      rows: [
        closedShift({}),
        closedShift({
          id: '2',
          docNo: 'SHIFT-2',
          createdAt: '2026-11-18T14:00:00.000Z',
          closedAt: '2026-11-18T22:00:00.000Z',
          openedByName: 'محمد',
          shiftSalesTotal: 400.2,
          saleReturnTotal: 150,
        }),
        closedShift({ id: '3', docNo: 'SHIFT-3', status: 'open', shiftSalesTotal: 999, saleReturnTotal: 0 }),
      ],
      pagination: { page: 1, pageSize: 100, totalItems: 3, totalPages: 1, rangeStart: 1, rangeEnd: 3 },
      summary: { totalItems: 3, openShiftCount: 1, openShiftDocNo: 'SHIFT-3', totalVariance: 0 },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OverviewReportSection
          report={report}
          reportQuery={{ isLoading: false, isError: false, error: undefined }}
          executiveRows={[]}
          formatPercent={(value: number) => `${value}%`}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockListAll).toHaveBeenCalledWith({ filter: 'closed' }));
    const chart = await screen.findByTestId('shift-analysis-chart');
    const bars = JSON.parse(chart.textContent || '[]') as Array<{ shift: string; sales: number }>;
    expect(bars).toHaveLength(2);
    expect(bars[0].shift.startsWith('SHIFT-1|')).toBe(true);
    expect(bars[0].sales).toBe(600.1);
    expect(bars[1].shift.startsWith('SHIFT-2|')).toBe(true);
    expect(bars[1].sales).toBe(250.2);
    expect(bars.reduce((sum, bar) => sum + bar.sales, 0)).toBe(850.3);
    // None of the old fixed ratio labels survives.
    expect(chart.textContent).not.toContain('الوردية الصباحية');
    expect(chart.textContent).not.toContain('الوردية المسائية');
    expect(chart.textContent).not.toContain('الوردية الليلية');
  });

  it('shows the honest empty chart when no shift is closed in the range', async () => {
    mockListAll.mockResolvedValue({
      rows: [],
      pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 1, rangeStart: 0, rangeEnd: 0 },
      summary: { totalItems: 0, openShiftCount: 0, openShiftDocNo: '', totalVariance: 0 },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OverviewReportSection
          report={report}
          reportQuery={{ isLoading: false, isError: false, error: undefined }}
          executiveRows={[]}
          formatPercent={(value: number) => `${value}%`}
        />
      </QueryClientProvider>,
    );

    const chart = await screen.findByTestId('shift-analysis-chart');
    expect(JSON.parse(chart.textContent || '[]')).toEqual([]);
  });
});
