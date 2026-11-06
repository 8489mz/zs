import { queryClient } from '@/app/providers';
import { queryKeys } from '@/app/query-keys';
import { salesApi } from '@/features/sales/api/sales.api';
import { productsApi } from '@/features/products/api/products.api';
import { purchasesApi } from '@/features/purchases/api/purchases.api';
import { reportsApi } from '@/features/reports/api/reports.api';
import { accountsApi } from '@/features/accounts/api/accounts.api';

const prefetchedPaths = new Set<string>();

export function prefetchRouteData(to: string) {
  if (typeof window === 'undefined') return;
  const route = to.split('?')[0].replace(/^\//, '').replace(/\/$/, '');
  const path = route.split('/')[0] || '';
  if (prefetchedPaths.has(route)) return;
  prefetchedPaths.add(route);

  const run = () => {
    try {
      // Exact subroutes must prefetch their own chunk, not a sibling list page.
      if (route === 'products/new') { void import('@/features/products/pages/NewProductPage'); return; }
      if (route === 'products/categories') { void import('@/features/products/pages/ProductCategoriesPage'); return; }
      if (route === 'sales/orders') { void import('@/features/sales/pages/SalesOrdersPage'); return; }
      if (route === 'purchases/orders') { void import('@/features/purchases/pages/PurchaseOrdersPage'); return; }
      switch (path) {
        case 'pos':
          void import('@/features/pos/pages/PosPage');
          break;
        case 'maritime':
        case 'maritime-freight':
          void import('@/features/maritime-freight/pages/MaritimeLayout');
          break;
        case 'contracting':
          void import('@/features/contracting/pages/ContractingLayout');
          break;
        case 'settings':
          void import('@/features/settings/pages/SettingsPage');
          break;
        case 'updates':
          void import('@/features/updates/pages/UpdatesPage');
          break;
        case 'sales': {
          void import('@/features/sales/pages/SalesPage');
          const salesParams = { page: 1, pageSize: 30, search: '', filter: 'all' as const, cashier: 'all' };
          void queryClient.prefetchQuery({
            queryKey: queryKeys.salesPage(JSON.stringify(salesParams)),
            queryFn: () => salesApi.listPage(salesParams),
            staleTime: 60_000,
          });
          break;
        }
        case 'products': {
          void import('@/features/products/pages/ProductsPage');
          const productParams = { page: 1, pageSize: 20 };
          void queryClient.prefetchQuery({
            queryKey: queryKeys.productsPage('page=1&pageSize=20'),
            queryFn: () => productsApi.listPage(productParams),
            staleTime: 60_000,
          });
          break;
        }
        case 'purchases': {
          void import('@/features/purchases/pages/PurchasesPage');
          const purchasesParams = { page: 1, pageSize: 25, search: '', filter: 'all' as const };
          void queryClient.prefetchQuery({
            queryKey: queryKeys.purchasesPage(JSON.stringify(purchasesParams)),
            queryFn: () => purchasesApi.listPage(purchasesParams),
            staleTime: 60_000,
          });
          break;
        }
        case 'inventory':
          void import('@/features/inventory/pages/InventoryPage');
          void queryClient.prefetchQuery({
            queryKey: queryKeys.inventoryReport,
            queryFn: () => reportsApi.inventory(),
            staleTime: 60_000,
          });
          break;
        case 'accounts':
        case 'customers':
        case 'suppliers':
          void queryClient.prefetchQuery({
            queryKey: queryKeys.customerBalances,
            queryFn: () => accountsApi.listCustomersWithDebt(),
            staleTime: 60_000,
          });
          break;
        case 'reports': {
          void import('@/features/reports/pages/ReportsPage');
          const today = new Date().toISOString().slice(0, 10);
          void queryClient.prefetchQuery({
            queryKey: ['reports-summary', today, today],
            queryFn: () => reportsApi.summary(today, today),
            staleTime: 60_000,
          });
          break;
        }
      }
    } catch {}
  };
  const win = typeof window !== 'undefined' ? (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }) : null;
  if (win && typeof win.requestIdleCallback === 'function') {
    win.requestIdleCallback(run, { timeout: 250 });
  } else {
    setTimeout(run, 0);
  }
}
