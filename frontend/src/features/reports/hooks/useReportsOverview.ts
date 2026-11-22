import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { reportsApi } from '@/features/reports/api/reports.api';

export function useReportsOverview(
  from: string,
  to: string,
  options?: {
    enabled?: boolean;
    locationId?: string;
    userId?: string;
    branchId?: string;
    // F13 (trial problem 18): discounted-invoices-only filter.
    discountedOnly?: boolean;
  }
) {
  const locationId = options?.locationId && options.locationId !== 'all' ? options.locationId : undefined;
  const userId = options?.userId && options.userId !== 'all' ? options.userId : undefined;
  const branchId = options?.branchId && options.branchId !== 'all' ? options.branchId : undefined;
  const discountedOnly = options?.discountedOnly === true;
  const paramsKey = [locationId || '', userId || '', branchId || '', discountedOnly ? 'discounted' : ''].join(':');

  const reportQuery = useQuery({
    queryKey: [...queryKeys.reportsSummary(from, to), paramsKey],
    queryFn: () => reportsApi.summary(from, to, { locationId, userId, branchId, discountedOnly }),
    enabled: Boolean(from && to) && (options?.enabled ?? true)
  });
  return { reportQuery };
}
