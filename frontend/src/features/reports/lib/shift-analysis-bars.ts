/*
New file: frontend/src/features/reports/lib/shift-analysis-bars.ts
Builds the ShiftAnalysisChart bars from REAL closed-shift figures
(INV-SHIFT-ANALYSIS-REAL-TOTALS).

THE GAP IT CLOSES: OverviewReportSection used to invent the three shift
bars as fixed ratios of the period net sales (morning 45%, evening 35%,
night 20%). Those numbers never came from any shift: a day with all sales
in the morning still showed 35% in the evening and 20% at night.

THE SOURCE: the same hydrated cashier-shift rows the shift close itself
renders — GET /api/cashier-shifts (listCashierShifts -> hydrateShiftRow ->
computeShiftSalesBreakdown over the frozen [created_at, closed_at]
window, INV-SHIFT-SALE-CASH-ATTRIBUTION). Each row carries
shiftSalesTotal (sum of posted-sale totals attributed to the shift) and
saleReturnTotal (sale returns created by the opener inside the same
window). The bar value is the NET per-shift sale figure:

  bar = shiftSalesTotal - saleReturnTotal

Both inputs are the close card's own figures, so each bar matches the
per-shift close figures; the net (not gross) is what reconciles to the
report's netSales, which is itself net of returns.

EXACT-SUM PROPERTY (pinned by shift-analysis-bars.spec.ts): on a test
day with no sales tax, no services revenue, and every posted sale inside
a closed shift, the bars sum exactly to that day's netSales. Arithmetic
runs in integer minor units (10 ** digits) so the sum is exact — no
floating-point drift (100.10 + 200.20 is 300.30, never 300.299999...).

HONEST LIMITS (not bugs in this helper — the row carries no finer data):
- Sales tax has no per-shift split in the hydrated row, so on a taxed
  tenant the bars sum to net sales PLUS that day's sales tax.
- Services revenue is inside netSales but belongs to no shift.
- A sale posted outside every closed shift (open shift, no covering
  shift) is in netSales but in no bar.
- A shift whose window straddles the range edge is counted whole when
  its window overlaps the range; its sales outside the range ride along.
- Only status 'closed' counts: a pending_review close is not final yet.
*/

import type { CashierShift } from '@/types/domain';

export interface ShiftAnalysisRange {
  from: string;
  to: string;
}

export interface ShiftAnalysisBar {
  shift: string;
  sales: number;
  color: string;
}

/** The section's existing three-colour palette, cycled when a range holds more than three closed shifts. */
export const SHIFT_ANALYSIS_COLORS = ['#3b82f6', '#8b5cf6', '#1e293b'] as const;

const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseBound(value: string, isEnd: boolean): number {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  if (BARE_DATE_RE.test(raw)) {
    // A bare calendar date means the whole tenant day: the backend's
    // resolveTenantDayRange rule. Start-of-day for `from`, end-of-day
    // (23:59:59.999 UTC) for `to`, so a shift closing later on the `to`
    // day is not silently dropped.
    return isEnd
      ? Date.parse(`${raw}T23:59:59.999Z`)
      : Date.parse(`${raw}T00:00:00.000Z`);
  }
  return Date.parse(raw);
}

function parseShiftTime(value: unknown): number {
  if (!value) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value));
}

function formatClock(value: number): string {
  const date = new Date(value);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * One bar per closed cashier shift whose [openedAt, closedAt] window
 * overlaps the report range, oldest first. The label is
 * `docNo|opener HH:MM–HH:MM` — the chart's CustomTick splits on '|'
 * into the shift name and the hours line.
 */
export function buildShiftAnalysisBars(
  shifts: CashierShift[],
  range: ShiftAnalysisRange,
  digits = 2,
): ShiftAnalysisBar[] {
  const fromMs = parseBound(range.from, false);
  const toMs = parseBound(range.to, true);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return [];
  const minorUnits = 10 ** Math.max(0, Math.floor(digits) || 0);
  const toMinor = (value: unknown): number => {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? Math.round(numeric * minorUnits) : 0;
  };

  return (shifts ?? [])
    .map((shift) => {
      const openedMs = parseShiftTime(shift.createdAt);
      const closedMs = parseShiftTime(shift.closedAt);
      return { shift, openedMs, closedMs };
    })
    .filter(
      ({ shift, openedMs, closedMs }) =>
        String(shift.status || '') === 'closed' &&
        Number.isFinite(openedMs) &&
        Number.isFinite(closedMs) &&
        openedMs <= toMs &&
        closedMs >= fromMs,
    )
    .sort((a, b) => a.openedMs - b.openedMs)
    .map(({ shift, openedMs, closedMs }, index) => {
      const netMinor = toMinor(shift.shiftSalesTotal) - toMinor(shift.saleReturnTotal);
      const opener = String(shift.openedByName || '').trim();
      const hours = `${formatClock(openedMs)}–${formatClock(closedMs)}`;
      return {
        shift: `${String(shift.docNo || shift.id)}|${opener ? `${opener} ${hours}` : hours}`,
        sales: netMinor / minorUnits,
        color: SHIFT_ANALYSIS_COLORS[index % SHIFT_ANALYSIS_COLORS.length],
      };
    });
}
