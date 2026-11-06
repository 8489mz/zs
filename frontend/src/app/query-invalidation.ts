import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';

export async function invalidateDashboardOverview(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] });
  await queryClient.invalidateQueries({ queryKey: ['manager-actions'] });
}

export async function invalidateAuditLogs(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs });
}

export async function invalidateCatalogDomain(
  queryClient: QueryClient,
  options?: {
    includeProducts?: boolean;
    includeCustomers?: boolean;
    includeSuppliers?: boolean;
    includeCategories?: boolean;
    includeCustomerBalances?: boolean;
    includeSupplierBalances?: boolean;
  }
) {
  const {
    includeProducts = false,
    includeCustomers = false,
    includeSuppliers = false,
    includeCategories = false,
    includeCustomerBalances = false,
    includeSupplierBalances = false,
  } = options || {};
  const tasks = [];
  if (includeProducts) {
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.products }));
    tasks.push(queryClient.invalidateQueries({ queryKey: ['signage-products'] }));
    tasks.push(queryClient.invalidateQueries({ queryKey: ['storefront-catalog'] }));
    tasks.push(queryClient.invalidateQueries({ queryKey: ['storefront-info'] }));
    void import('@/features/pos/lib/pos-customer-display-bridge')
      .then((m) => m.broadcastSignageOffersUpdate())
      .catch(() => {});
  }
  if (includeCustomers) {
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.customers }));
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.posCustomers }));
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.productsCustomers }));
  }
  if (includeSuppliers) {
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.suppliers }));
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.productsSuppliers }));
  }
  if (includeCategories) {
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.categories }));
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.productsCategories }));
    tasks.push(queryClient.invalidateQueries({ queryKey: ['storefront-catalog'] }));
  }
  if (includeCustomerBalances) tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.customerBalances }));
  if (includeSupplierBalances) tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.supplierBalances }));
  await Promise.all(tasks);
}

export async function invalidateInventoryDomain(
  queryClient: QueryClient,
  options?: { includeProducts?: boolean; includeDashboard?: boolean }
) {
  const { includeProducts = true, includeDashboard = false } = options || {};
  const tasks = [
    queryClient.invalidateQueries({ queryKey: queryKeys.inventoryReport }),
    queryClient.invalidateQueries({ queryKey: queryKeys.stockTransfers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.stockCountSessions }),
    queryClient.invalidateQueries({ queryKey: queryKeys.damagedStock }),
    queryClient.invalidateQueries({ queryKey: queryKeys.stockMovements }),
    queryClient.invalidateQueries({ queryKey: ['location-stocks'] }),
    queryClient.invalidateQueries({ queryKey: ['locationCategories'] }),
    queryClient.invalidateQueries({ queryKey: ['locationCategoryProducts'] }),
    invalidateAuditLogs(queryClient),
  ];
  if (includeProducts) tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.products }));
  if (includeProducts) tasks.push(queryClient.invalidateQueries({ queryKey: ['products', 'pos'] }));
  if (includeProducts) tasks.push(queryClient.invalidateQueries({ queryKey: ['catalogProducts'] }));
  if (includeDashboard) {
    tasks.push(queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] }));
    tasks.push(queryClient.invalidateQueries({ queryKey: ['manager-actions'] }));
  }
  await Promise.all(tasks);
}

export async function invalidateSalesDomain(
  queryClient: QueryClient,
  options?: { saleId?: string; includeDashboard?: boolean }
) {
  const { saleId, includeDashboard = false } = options || {};
  const immediateTasks = [
    queryClient.invalidateQueries({ queryKey: queryKeys.sales, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['products', 'pos'], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.cashierShiftsPage('open:pos'), refetchType: 'active' }),
  ];
  if (saleId) {
    immediateTasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.saleDetail(saleId) }));
  }

  const deferredTasks = [
    queryClient.invalidateQueries({ queryKey: queryKeys.customerBalances, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.posCustomers, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['posCustomerSummaryCheckout'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['customer-loyalty-history'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.customers, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.products, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['catalogProducts'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.inventoryReport, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.stockMovements, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['location-stocks'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.treasury, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.cashierShifts, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['reports-summary'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['delivery-rep-orders'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['delivery-rep-summary'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs, refetchType: 'none' }),
  ];

  if (includeDashboard) {
    deferredTasks.push(queryClient.invalidateQueries({ queryKey: ['dashboard-overview'], refetchType: 'none' }));
    deferredTasks.push(queryClient.invalidateQueries({ queryKey: ['manager-actions'], refetchType: 'none' }));
  }

  await Promise.all([...immediateTasks, ...deferredTasks]);
}

export async function invalidatePurchasesDomain(
  queryClient: QueryClient,
  options?: { purchaseId?: string; includeDashboard?: boolean }
) {
  const { purchaseId, includeDashboard = false } = options || {};
  const immediateTasks = [
    queryClient.invalidateQueries({ queryKey: queryKeys.purchases, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.suppliers, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.supplierBalances, refetchType: 'active' }),
  ];
  if (purchaseId) immediateTasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.purchaseDetail(purchaseId) }));

  const deferredTasks = [
    queryClient.invalidateQueries({ queryKey: queryKeys.products, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['catalogProducts'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.inventoryReport, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.stockMovements, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['location-stocks'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.treasury, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['reports-summary'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['accounting-journals'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['accounting-trial-balance'], refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: ['pricing-preview'], refetchType: 'none' }),
  ];

  if (includeDashboard) {
    deferredTasks.push(queryClient.invalidateQueries({ queryKey: ['dashboard-overview'], refetchType: 'none' }));
    deferredTasks.push(queryClient.invalidateQueries({ queryKey: ['manager-actions'], refetchType: 'none' }));
  }

  await Promise.all([...immediateTasks, ...deferredTasks]);
}

export async function invalidateReturnsDomain(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.returns, refetchType: 'active' }),
    invalidateSalesDomain(queryClient),
    invalidatePurchasesDomain(queryClient),
  ]);
}

export async function invalidateTreasuryDomain(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.treasury, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.expenses, refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.cashierShifts, refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: queryKeys.cashierShiftsPage('open:pos'), refetchType: 'active' }),
  ]);
}

export async function invalidateAccountsDomain(queryClient: QueryClient, activeCustomerId?: string, activeSupplierId?: string) {
  const tasks = [
    queryClient.invalidateQueries({ queryKey: queryKeys.customers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.posCustomers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.productsCustomers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.suppliers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.productsSuppliers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.customerBalances }),
    queryClient.invalidateQueries({ queryKey: queryKeys.supplierBalances }),
  ];
  if (activeCustomerId) tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.customerLedger(activeCustomerId) }));
  if (activeSupplierId) tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.supplierLedger(activeSupplierId) }));
  await Promise.all(tasks);
}

export async function invalidateAdminWorkspaceQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.adminDiagnostics }),
    queryClient.invalidateQueries({ queryKey: queryKeys.adminMaintenance }),
    queryClient.invalidateQueries({ queryKey: queryKeys.adminLaunch }),
    queryClient.invalidateQueries({ queryKey: queryKeys.adminUat }),
    queryClient.invalidateQueries({ queryKey: queryKeys.adminOperational }),
    queryClient.invalidateQueries({ queryKey: queryKeys.adminSupport }),
    queryClient.invalidateQueries({ queryKey: queryKeys.backupSnapshots }),
    invalidateAuditLogs(queryClient),
  ]);
}

export async function invalidateSettingsReferenceDomain(
  queryClient: QueryClient,
  options?: { includeSettings?: boolean; includeBranches?: boolean; includeLocations?: boolean }
) {
  const { includeSettings = true, includeBranches = true, includeLocations = true } = options || {};
  const tasks = [];
  if (includeSettings) {
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.settings }));
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.posSettings }));
  }
  if (includeBranches) {
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.branches, refetchType: 'active' }));
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.posBranches }));
  }
  if (includeLocations) {
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.locations, refetchType: 'active' }));
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.posLocations }));
    tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.settingsLocations }));
  }
  tasks.push(invalidateAuditLogs(queryClient));
  await Promise.all(tasks);
}

export async function invalidateImportedReferenceData(queryClient: QueryClient) {
  await Promise.all([
    invalidateCatalogDomain(queryClient, { includeCustomers: true, includeSuppliers: true, includeProducts: true, includeSupplierBalances: true }),
    invalidateSettingsReferenceDomain(queryClient),
    queryClient.invalidateQueries({ queryKey: queryKeys.inventoryReport }),
    queryClient.invalidateQueries({ queryKey: queryKeys.stockMovements }),
    invalidateAuditLogs(queryClient),
  ]);
}
