/*
New file: frontend/src/features/reports/components/sections/ReportsPartialTotals.spec.tsx
Pins the reports partial-totals fix (INV-REPORTS-PARTIAL-TOTALS).

THE GAP (live on test10k, build 1.1.40): the reports-hub indicator cards
showed partial totals as if final in the first seconds — "إجمالي الداخل"
swept 266.00, 525.00, 474.00, 232.00, 229.00, 240.00, 472.00, 508.00
before settling on 851.00, and the purchases report briefly showed 11.00,
3.00, 10.00, 7.00. The settled values were correct; the first-seconds
numbers were not.

TWO CONTRIBUTORS, both in the shared card path:
1. Each card's value is a `?? 0` fallback chain over independently-loading
   sources (report summary, financial summary, cash movement), and the
   wrapping QueryCard gated only on reportQuery.isLoading — so a card
   rendered a number while its other sources were still loading.
2. AnimatedValue always swept 0 -> value over 850ms on first paint, so
   even a final value displayed numbers that were never real totals.

THE RULE: no report card shows a number until EVERY source its value
reads from has loaded (a loading state instead of the partial total), and
the first paint of a ready card shows its final value immediately.

WHAT THIS PINS, driving the REAL TreasuryReportSection / PurchasesReportSection:
- Treasury with the report loaded but the cash-movement source still
  loading shows a loading state on "إجمالي الداخل", never the report's
  851.00 and never a partial number.
- Treasury with all sources loaded shows 851.00 on the very first paint
  (asserted synchronously, no waitFor) — restoring the 0-start sweep in
  AnimatedValue fails this test (first paint would read 0.00).
- Purchases with the report loaded shows the 11.00 total on the first
  paint, never the 3.00 / 7.00 / 10.00 sweep intermediates.
- Settled values are unchanged once loaded.
*/

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReportMetricCard } from '@/shared/components/report-metric-card';
import { formatCurrency } from '@/lib/format';
import { TreasuryReportSection } from '@/features/reports/components/sections/TreasuryReportSection';
import { PurchasesReportSection } from '@/features/reports/components/sections/PurchasesReportSection';
import type { CashMovementResponse, FinancialSummaryResponse } from '@/shared/api/accounting-reports';
import type { ReportSummary } from '@/types/domain';

function cardValue(label: string): string {
  const card = screen.getByText(label).closest('.report-metric-card');
  if (!card) throw new Error(`${label} card not found`);
  const value = card.querySelector('.report-metric-value');
  if (!value) throw new Error(`${label} value not found`);
  return value.textContent ?? '';
}

function cardShowsLoading(label: string): boolean {
  const card = screen.getByText(label).closest('.report-metric-card');
  if (!card) throw new Error(`${label} card not found`);
  const value = card.querySelector('.report-metric-value');
  if (!value) throw new Error(`${label} value not found`);
  // A loading card shows a skeleton placeholder and no digits at all.
  return value.getAttribute('aria-busy') === 'true' && !/\d/.test(value.textContent ?? '');
}

const report: ReportSummary = {
  sales: { count: 4, total: 925.8, netSales: 775.8 },
  purchases: { count: 1, total: 11, netPurchases: 11 },
  expenses: { count: 0, total: 0 },
  returns: { count: 1, total: 150 },
  treasury: { cashIn: 851, cashOut: 240, net: 611 },
  commercial: { grossProfit: 775.8, grossMarginPercent: 100, netOperatingProfit: 775.8, cogs: 0 },
  delivery: { count: 0, total: 0, mode: 'freelance_courier', storeProfit: 0 },
  topProducts: [],
};

const financialSummary: FinancialSummaryResponse = {
  period: { from: '2026-10-06', to: '2026-11-05' },
  cards: {
    grossSales: 925.8,
    salesReturns: 150,
    salesDiscounts: 0,
    netSales: 775.8,
    cogs: 0,
    grossProfit: 775.8,
    operatingExpenses: 0,
    netProfit: 775.8,
    customerCollections: 851,
    supplierPayments: 240,
    treasuryExpenses: 0,
    netCashMovement: 611,
  },
  breakdowns: { revenueAccounts: [], expenseAccounts: [], cashMovements: [] },
};

const cashMovement: CashMovementResponse = {
  period: { from: '2026-10-06', to: '2026-11-05' },
  totals: { totalIn: 851, totalOut: 240, netMovement: 611 },
  accounts: [],
  sources: [],
};

const loadedReportQuery = { isLoading: false, isError: false, error: undefined };

describe('ReportsPartialTotals', () => {
  it('treasury card with a slow cash-movement source shows loading, never a partial total', () => {
    render(
      <TreasuryReportSection
        report={report}
        reportQuery={loadedReportQuery}
        accountingFinancialSummary={financialSummary}
        accountingFinancialSummaryLoading={false}
        accountingCashMovement={undefined}
        accountingCashMovementLoading
        operatingSignalRows={[]}
        formatPercent={(value: number) => `${value}%`}
      />,
    );

    // The report alone already knows cashIn = 851.00, but the card must
    // not show it (or any number) until the cash-movement source loads.
    expect(cardShowsLoading('إجمالي الداخل')).toBe(true);
    expect(cardValue('إجمالي الداخل')).not.toContain('851');
    expect(cardShowsLoading('إجمالي الخارج')).toBe(true);
    expect(cardShowsLoading('صافي حركة النقدية')).toBe(true);
  });

  it('treasury card with all sources loaded shows the settled 851.00 on the first paint', () => {
    render(
      <TreasuryReportSection
        report={report}
        reportQuery={loadedReportQuery}
        accountingFinancialSummary={financialSummary}
        accountingFinancialSummaryLoading={false}
        accountingCashMovement={cashMovement}
        accountingCashMovementLoading={false}
        operatingSignalRows={[]}
        formatPercent={(value: number) => `${value}%`}
      />,
    );

    // Synchronous assertions: no waitFor, no timers. A 0-start count-up
    // would read 0.00 here and fail; the settled values must be visible
    // immediately and unchanged.
    expect(cardValue('إجمالي الداخل')).toBe('851.00');
    expect(cardValue('إجمالي الخارج')).toBe('240.00');
    expect(cardValue('صافي حركة النقدية')).toBe('611.00');
    expect(cardValue('مجمل الربح')).toBe('775.80');
  });

  it('purchases card with the report loaded shows the 11.00 total on the first paint, never sweep intermediates', () => {
    render(
      <PurchasesReportSection
        report={report}
        reportQuery={loadedReportQuery}
        printPurchasesRegisterReport={() => undefined}
      />,
    );

    // The live bug showed 11.00, 3.00, 10.00, 7.00 in the first seconds:
    // the 0 -> 11.00 count-up sweep. First paint must be the final value.
    expect(cardValue('إجمالي الشراء')).toBe('11.00');
    expect(cardValue('صافي الشراء')).toBe('11.00');
    // Count cards render without a currency formatter (Arabic-Indic digits).
    expect(cardValue('عدد الفواتير')).toBe('١');
  });

  it('a loading metric card shows no number at all, and a loaded one shows its final value at once', () => {
    const { rerender } = render(
      <ReportMetricCard label="بطاقة اختبار" value={851} tone="success" formatter={formatCurrency} decimals={2} isLoading />,
    );
    const value = document.querySelector('.report-metric-value');
    expect(value?.getAttribute('aria-busy')).toBe('true');
    expect(value?.textContent ?? '').not.toMatch(/\d/);

    rerender(<ReportMetricCard label="بطاقة اختبار" value={851} tone="success" formatter={formatCurrency} decimals={2} />);
    expect(document.querySelector('.report-metric-value')?.textContent).toBe('851.00');
  });
});
