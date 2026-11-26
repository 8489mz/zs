import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { productsApi } from '@/features/products/api/products.api';
import { salesApi } from '@/features/sales/api/sales.api';
import { purchasesApi } from '@/features/purchases/api/purchases.api';
import { customersApi } from '@/features/customers/api/customers.api';
import { suppliersApi } from '@/features/suppliers/api/suppliers.api';
import { settingsApi } from '@/features/settings/api/settings.api';

const referenceStaleTime = 60_000;

export function useProductsQuery() {
  return useQuery({ queryKey: queryKeys.products, queryFn: async () => (await productsApi.listAll()).products });
}

export function useMarketplaceProductsQuery() {
  return useQuery({
    queryKey: ['marketplace-products-selector'],
    queryFn: () => productsApi.listPage({ pageSize: 150 }),
  });
}

export function useSalesQuery() {
  return useQuery({ queryKey: queryKeys.sales, queryFn: salesApi.list });
}

export function usePurchasesQuery() {
  return useQuery({ queryKey: queryKeys.purchases, queryFn: purchasesApi.list });
}

export function useCustomersQuery() {
  return useQuery({ queryKey: queryKeys.customers, queryFn: customersApi.list });
}

export function useSuppliersQuery() {
  return useQuery({ queryKey: queryKeys.suppliers, queryFn: suppliersApi.list, staleTime: referenceStaleTime });
}

export function useCategoriesQuery() {
  return useQuery({ queryKey: queryKeys.productsCategories, queryFn: productsApi.categories, staleTime: referenceStaleTime });
}

export function useSettingsQuery(options?: { enabled?: boolean }) {
  const isExcludedRoute = typeof window !== 'undefined' && (
    window.location.pathname.startsWith('/van-sales') ||
    window.location.pathname.startsWith('/driver') ||
    window.location.pathname.startsWith('/login') ||
    window.location.pathname.startsWith('/track') ||
    window.location.pathname.startsWith('/portal')
  );
  const isExplicitlyEnabled = options?.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: settingsApi.settings,
    staleTime: referenceStaleTime,
    enabled: isExplicitlyEnabled && !isExcludedRoute,
    retry: false,
  });
}

export function useBranchesQuery() {
  return useQuery({ queryKey: queryKeys.branches, queryFn: settingsApi.branches, staleTime: referenceStaleTime });
}

export function useLocationsQuery() {
  return useQuery({ queryKey: queryKeys.settingsLocations, queryFn: settingsApi.locations, staleTime: referenceStaleTime });
}
