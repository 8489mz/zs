import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { salesApi } from '@/features/sales/api/sales.api';
import { isSellableProduct } from '@/lib/domain/inventory';
import { matchTransactionSearch } from '@/lib/domain/transactions';
import { todayLocalDateKey } from '@/lib/format';

export function useSalesOverview(search: string) {
  const salesQuery = useQuery({ queryKey: queryKeys.sales, queryFn: salesApi.list });
  const productsQuery = useQuery({ queryKey: queryKeys.products, queryFn: salesApi.products });

  const availableProducts = useMemo(() => (productsQuery.data || []).filter(isSellableProduct), [productsQuery.data]);
  const filteredRows = useMemo(() => {
    const rows = salesQuery.data || [];
    return rows.filter((sale) => matchTransactionSearch(sale, search));
  }, [salesQuery.data, search]);

  const todayIso = todayLocalDateKey();
  const todaySales = useMemo(() => (salesQuery.data || []).filter((sale) => String(sale.date || '').slice(0, 10) === todayIso), [salesQuery.data, todayIso]);
  const totals = useMemo(() => ({
    totalSales: (salesQuery.data || []).reduce((sum, sale) => sum + Number(sale.total || 0), 0),
    todaySalesTotal: todaySales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  }), [salesQuery.data, todaySales]);

  return { salesQuery, productsQuery, availableProducts, filteredRows, todaySales, totals };
}
