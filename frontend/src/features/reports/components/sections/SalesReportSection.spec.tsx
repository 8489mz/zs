/*
New file: frontend/src/features/reports/components/sections/SalesReportSection.spec.tsx
Pins the sales-report 0.20 (INV-REPORT-MONEY-DECIMALS).

THE GAP: the "مؤشرات البيع" cards render money through ReportMetricCard ->
AnimatedValue, which rounds the animated value to `decimals` (default 0)
BEFORE the currency formatter runs. So a true gross of 925.80 displayed as
"926.00" and a true net of 775.80 as "776.00", while the summary strip and
the item lines (plain formatCurrency, no animation) showed the true values.
The backend totals were never wrong: sumMoney rounds once at the end, and
the report's sales.total / netSales already were 925.80 / 775.80.

THE RULE: money metric cards render at the tenant currency's decimals
(getCurrencyDecimals(), the same scale formatCurrency prints), never rounded
to whole units. Count cards keep the 0-decimal default.

WHAT THIS PINS, driving the REAL SalesReportSection (live test10k numbers,
period 10/06-11/05/2026, 4 invoices, 1 return of 150.00):
- "إجمالي البيع" shows 925.80, the sum of the item lines
  (338.80 + 300.00 + 287.00), not 926.00.
- "صافي البيع" shows 775.80 (= 925.80 - 150.00 return), matching the strip.
- "مردودات وخصومات" shows 150.00.
*/

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SalesReportSection } from '@/features/reports/components/sections/SalesReportSection';
import type { ReportSummary } from '@/types/domain';

function cardValue(label: string): string {
  const card = screen.getByText(label).closest('.report-metric-card');
  if (!card) throw new Error(`${label} card not found`);
  const value = card.querySelector('.report-metric-value');
  if (!value) throw new Error(`${label} value not found`);
  return value.textContent ?? '';
}

describe('SalesReportSection money cards', () => {
  it('shows the true gross 925.80 and net 775.80, not the whole-unit rounding', async () => {
    const report: ReportSummary = {
      sales: { count: 4, total: 925.8, netSales: 775.8 },
      purchases: { count: 0, total: 0, netPurchases: 0 },
      expenses: { count: 0, total: 0 },
      returns: { count: 1, total: 150 },
      treasury: { cashIn: 0, cashOut: 0, net: 0 },
      commercial: { grossProfit: 775.8, grossMarginPercent: 100, netOperatingProfit: 775.8, cogs: 0 },
      delivery: { count: 0, total: 0, mode: 'freelance_courier', storeProfit: 0 },
      topProducts: [
        { name: 'صنف أ', qty: 1, revenue: 338.8 },
        { name: 'صنف ب', qty: 1, revenue: 300 },
        { name: 'صنف ج', qty: 1, revenue: 287 },
      ],
    };
    const topProducts = [
      { name: 'صنف أ', qty: 1, revenue: 338.8 },
      { name: 'صنف ب', qty: 1, revenue: 300 },
      { name: 'صنف ج', qty: 1, revenue: 287 },
    ];

    render(
      <SalesReportSection
        report={report}
        reportQuery={{ isLoading: false, isError: false, error: undefined }}
        accountingFinancialSummary={undefined}
        salesDailyAverage={24.24}
        purchaseDailyAverage={0}
        returnRatePercent={16.2}
        rangeDays={32}
        topProducts={topProducts}
        exportTopProducts={vi.fn()}
        printTopProducts={vi.fn()}
        printSalesRegisterReport={vi.fn()}
        formatPercent={(value: number) => `${value}%`}
      />,
    );

    // The item lines show the true values (plain formatCurrency).
    expect(screen.getByText('338.80')).toBeTruthy();
    expect(screen.getByText('300.00')).toBeTruthy();
    expect(screen.getByText('287.00')).toBeTruthy();

    // The animated money cards must settle on the true values, not the
    // whole-unit rounding (926.00 / 776.00).
    await waitFor(() => expect(cardValue('إجمالي البيع')).toBe('925.80'), { timeout: 5000 });
    await waitFor(() => expect(cardValue('صافي البيع')).toBe('775.80'), { timeout: 5000 });
    await waitFor(() => expect(cardValue('مردودات وخصومات')).toBe('150.00'), { timeout: 5000 });
  });
});
