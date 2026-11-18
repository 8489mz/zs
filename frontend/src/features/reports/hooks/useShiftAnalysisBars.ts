/*
New file: frontend/src/features/reports/hooks/useShiftAnalysisBars.ts
Reads the REAL closed-shift totals for the overview shift chart
(INV-SHIFT-ANALYSIS-REAL-TOTALS).

The data comes from GET /api/cashier-shifts (cashDrawerApi.listAll,
filter 'closed') — the same hydrated rows the shift close renders, so
each bar is the shift's own close figure, never a ratio of net sales.
The endpoint has no date filter, so listAll pages through the closed
shifts and buildShiftAnalysisBars keeps only the windows overlapping
the report range. The query is enabled only once the report's range is
known; without a range there are no bars, and the section shows the
chart's honest empty state instead of inventing numbers.
*/
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cashDrawerApi } from '@/lib/api/cash-drawer';
import { getCurrencyDecimals } from '@/lib/currencies';
import {
  buildShiftAnalysisBars,
  type ShiftAnalysisBar,
  type ShiftAnalysisRange,
} from '@/features/reports/lib/shift-analysis-bars';

export function useShiftAnalysisBars(range: ShiftAnalysisRange | null | undefined): {
  bars: ShiftAnalysisBar[];
  isLoading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: ['reports-shift-analysis', range?.from, range?.to],
    queryFn: () => cashDrawerApi.listAll({ filter: 'closed' }),
    enabled: Boolean(range?.from && range?.to),
    staleTime: 60_000,
  });

  const bars = useMemo(() => {
    if (!range?.from || !range?.to) return [];
    return buildShiftAnalysisBars(query.data?.rows ?? [], range, getCurrencyDecimals());
  }, [query.data, range]);

  return { bars, isLoading: query.isLoading, isError: query.isError };
}
