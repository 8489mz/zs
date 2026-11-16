import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { salesApi, type SalesListParams } from '@/features/sales/api/sales.api';

function makeParamsKey(params: SalesListParams) {
  return JSON.stringify({
    page: params.page || 1,
    pageSize: params.pageSize || 30,
    search: params.search || '',
    filter: params.filter || 'all',
    cashier: params.cashier || 'all',
    dateFrom: params.dateFrom || '',
    dateTo: params.dateTo || '',
  });
}

export function useSalesPage(params: SalesListParams) {
  const salesQuery = useQuery({
    queryKey: queryKeys.salesPage(makeParamsKey(params)),
    queryFn: () => salesApi.listPage(params),
    placeholderData: (previous) => previous,
  });
  return {
    salesQuery,
    rows: salesQuery.data?.rows || [],
    pagination: salesQuery.data?.pagination,
    summary: salesQuery.data?.summary,
  };
}
