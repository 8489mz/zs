import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { productsApi, type ProductsListParams } from '@/shared/api/products.api';
import { buildInventorySummary, filterInventoryRows, type InventoryStatusFilter } from '@/features/inventory/utils/inventory-mappers';

export function useInventoryPage(
  search: string,
  statusFilter: InventoryStatusFilter,
  page = 1,
  pageSize = 50,
  locationFilter = '',
  categoryFilter = '',
  supplierFilter = '',
) {
  const viewMap: Record<InventoryStatusFilter, ProductsListParams['view']> = {
    all: 'all',
    low: 'low',
    out: 'out',
    healthy: 'all',
  };

  const productsQuery = useQuery({
    queryKey: [...queryKeys.products, 'inventory', page, pageSize, search, statusFilter, locationFilter, categoryFilter, supplierFilter],
    queryFn: () =>
      productsApi.listPage({
        page,
        pageSize,
        q: search || undefined,
        view: viewMap[statusFilter] || 'all',
        locationId: locationFilter || undefined,
        categoryId: categoryFilter || undefined,
        supplierId: supplierFilter || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const allProducts = useMemo(() => productsQuery.data?.products || [], [productsQuery.data]);
  const rows = useMemo(() => filterInventoryRows(allProducts, '', statusFilter === 'all' ? 'all' : statusFilter), [allProducts, statusFilter]);
  const inventory = useMemo(() => {
    return buildInventorySummary(allProducts);
  }, [allProducts]);

  const pagination = productsQuery.data?.pagination || { page: 1, pageSize, totalItems: 0, totalPages: 1 };

  return { productsQuery, rows, inventory, pagination };
}

