import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { dayRangeLast30 } from '@/lib/format';
import { dashboardApi } from '@/features/dashboard/api/dashboard.api';
import type { DashboardOverviewPayload } from '@/features/dashboard/api/dashboard.types';

const DASHBOARD_OVERVIEW_STORAGE_KEY = 'zs_dashboard_overview_cache_v1';
const CACHE_MAX_AGE_MS = 3 * 60 * 1000;

export function clearDashboardCache(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(DASHBOARD_OVERVIEW_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function getStoredOverview(): DashboardOverviewPayload | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(DASHBOARD_OVERVIEW_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed._timestamp === 'number' && Date.now() - parsed._timestamp < CACHE_MAX_AGE_MS && parsed.data) {
      return parsed.data as DashboardOverviewPayload;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function storeOverview(data: DashboardOverviewPayload): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      DASHBOARD_OVERVIEW_STORAGE_KEY,
      JSON.stringify({ _timestamp: Date.now(), data })
    );
  } catch {
    // ignore
  }
}

export function useDashboardOverview(enabled = true) {
  const range = useMemo(() => {
    const reference = new Date();
    reference.setHours(23, 59, 59, 999);
    return dayRangeLast30(reference);
  }, []);

  return useQuery({
    queryKey: queryKeys.dashboardOverview(range.from, range.to),
    queryFn: async () => {
      const data = await dashboardApi.overview(range.from, range.to);
      storeOverview(data);
      return data;
    },
    enabled,
    // Instant zero-delay initial paint from cache, while automatically validating fresh data in background
    placeholderData: (previousData) => previousData ?? getStoredOverview(),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}
