/*
 * Pins the user-sales 0.20 gap fix (INV-USER-SALES-020-GAP).
 *
 * THE GAP (live on test10k, 2026-11-07): user details showed sales
 * 1,870.00 while the sales register showed 1,869.80 for the same sales.
 * The backend totals were never wrong — both sum the same sales.total.
 * The gap was display rounding in the shared card path:
 * UserManagementSection renders the user-details sales card as
 * <ReportMetricCard value={salesTotal} formatter={formatCurrency} />
 * with NO `decimals` prop, and AnimatedValue rounded the value to
 * `decimals` (default 0) BEFORE calling the formatter — so 1,869.80
 * became 1,870 and only then formatted as 1,870.00, while the sales
 * register calls formatCurrency(totalSales) directly and showed the
 * true 1,869.80. Same family as INV-REPORT-MONEY-DECIMALS (925.80
 * shown as 926.00), whose fix patched call sites one by one and left
 * this straggler — plus the OverviewReportSection direct AnimatedValue
 * and every DashboardMetricCard (default formatter formatCurrency,
 * no decimals).
 *
 * THE RULE: a formatter owns its own decimal policy, so it receives
 * the raw value; `decimals` governs only the no-formatter path, so
 * count cards keep rendering whole units.
 *
 * WHAT THIS PINS, driving the REAL shared AnimatedValue / ReportMetricCard:
 * - The live case: a money card with formatter={formatCurrency} and no
 *   decimals shows 1,869.80, never 1,870.00.
 * - A direct AnimatedValue with a currency formatter and no decimals
 *   shows 1,869.80 (the dashboard / overview path).
 * - A money card that passes decimals={2} explicitly is unchanged.
 * - A count card with no formatter still renders a whole unit.
 * Restoring the pre-rounding (formatter(rounded)) fails the first two
 * cases: 1,869.80 renders as 1,870.00.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnimatedValue } from '@/shared/components/animated-value';
import { ReportMetricCard } from '@/shared/components/report-metric-card';
import { formatCurrency } from '@/lib/format';

function cardValue(label: string): string {
  const card = screen.getByText(label).closest('.report-metric-card');
  if (!card) throw new Error(`${label} card not found`);
  const value = card.querySelector('.report-metric-value');
  if (!value) throw new Error(`${label} value not found`);
  return value.textContent ?? '';
}

describe('INV-USER-SALES-020-GAP: a currency formatter receives the raw value', () => {
  it('the live case: user-details sales 1,869.80 shows 1,869.80, not 1,870.00', () => {
    render(
      <ReportMetricCard
        label="المبيعات"
        value={1869.8}
        helper="فاتورة"
        tone="primary"
        formatter={formatCurrency}
      />,
    );
    expect(cardValue('المبيعات')).toBe('1,869.80');
  });

  it('a direct AnimatedValue with a currency formatter and no decimals keeps the cents', () => {
    const { container } = render(
      <AnimatedValue value={1869.8} formatter={formatCurrency} />,
    );
    expect(container.textContent).toBe('1,869.80');
  });

  it('a money card with explicit decimals={2} is unchanged', () => {
    render(
      <ReportMetricCard
        label="إجمالي البيع"
        value={1869.8}
        helper=""
        tone="primary"
        formatter={formatCurrency}
        decimals={2}
      />,
    );
    expect(cardValue('إجمالي البيع')).toBe('1,869.80');
  });

  it('a count card with no formatter still renders a whole unit', () => {
    render(
      <ReportMetricCard
        label="عدد الفواتير"
        value={5}
        helper=""
        tone="primary"
      />,
    );
    expect(cardValue('عدد الفواتير')).toBe('٥');
  });
});
