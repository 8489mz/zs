import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { referenceDataApi } from '@/services/reference-data.api';
import { accountingReportsApi } from '@/shared/api/accounting-reports';
import { reportsApi } from '@/features/reports/api/reports.api';
import { useReportsOverview } from '@/features/reports/hooks/useReportsOverview';
import { useReportInventoryPage } from '@/features/reports/hooks/useReportInventoryPage';
import { useCustomerBalancesPage } from '@/features/reports/hooks/useCustomerBalancesPage';
import { useEmployeeReportsPage } from '@/features/reports/hooks/useEmployeeReportsPage';
import { useReportsWorkspaceActions } from '@/features/reports/hooks/useReportsWorkspaceActions';
import { useReportsWorkspaceMetrics } from '@/features/reports/hooks/useReportsWorkspaceMetrics';
import { useReportsWorkspaceState } from '@/features/reports/hooks/useReportsWorkspaceState';
import type { ReportsSectionKey } from '@/features/reports/pages/reports.page-config';
import { formatPercent } from '@/features/reports/lib/reports-format';

export function useReportsWorkspaceController(currentSection: ReportsSectionKey) {
  const state = useReportsWorkspaceState();
  const locationsQuery = useQuery({ queryKey: queryKeys.locations, queryFn: referenceDataApi.locations });
  const { reportQuery } = useReportsOverview(state.submittedRange.from, state.submittedRange.to, {
    enabled: ['overview', 'sales', 'purchases'].includes(currentSection),
    locationId: state.submittedLocationId !== 'all' ? state.submittedLocationId : undefined,
    userId: state.submittedUserId !== 'all' ? state.submittedUserId : undefined,
  });
  const accountingFinancialSummaryQuery = useQuery({
    queryKey: ['reports', 'accounting-financial-summary', state.submittedRange.from, state.submittedRange.to],
    queryFn: () => accountingReportsApi.financialSummary({ date_from: state.submittedRange.from, date_to: state.submittedRange.to }),
    enabled: Boolean(state.submittedRange.from && state.submittedRange.to) && ['overview', 'sales', 'treasury'].includes(currentSection),
    retry: false,
  });
  const accountingCashMovementQuery = useQuery({
    queryKey: ['reports', 'accounting-cash-movement', state.submittedRange.from, state.submittedRange.to],
    queryFn: () => accountingReportsApi.cashMovement({ date_from: state.submittedRange.from, date_to: state.submittedRange.to }),
    enabled: Boolean(state.submittedRange.from && state.submittedRange.to) && ['overview', 'treasury'].includes(currentSection),
    retry: false,
  });
  const accountingReceivablesPayablesQuery = useQuery({
    queryKey: ['reports', 'accounting-receivables-payables', state.submittedRange.to],
    queryFn: () => accountingReportsApi.receivablesPayables({ date_to: state.submittedRange.to }),
    enabled: Boolean(state.submittedRange.to) && currentSection === 'balances',
    retry: false,
  });
  const accountingInventoryValueQuery = useQuery({
    queryKey: ['reports', 'accounting-inventory-value', state.locationId],
    queryFn: () => accountingReportsApi.inventoryValue({
      ...(state.locationId !== 'all' ? { locationId: state.locationId } : {})
    }),
    enabled: currentSection === 'inventory',
    retry: false,
  });
  const inventoryQuery = useReportInventoryPage({
    page: state.inventoryPage,
    pageSize: state.inventoryPageSize,
    search: state.inventorySearch,
    filter: state.inventoryFilter,
    days: state.deadStockDays,
    ...(state.locationId !== 'all' ? { locationId: state.locationId } : {})
  }, { enabled: ['overview', 'inventory'].includes(currentSection) });
  /* INV-DEAD-STOCK-FULL-TOTALS: full-set dead-stock totals come from the
  dedicated dead-stock endpoint (summary aggregated without pagination),
  never from a reduce() over the visible inventory page. Fetched only
  while the dead filter is active, on the same days/location scope. */
  const deadStockQuery = useQuery({
    queryKey: ['reports', 'dead-stock', state.deadStockDays, state.locationId],
    queryFn: () => reportsApi.deadStock({
      days: state.deadStockDays,
      ...(state.locationId !== 'all' ? { locationId: state.locationId } : {}),
    }),
    enabled: currentSection === 'inventory' && state.inventoryFilter === 'dead',
    retry: false,
  });
  const balancesQuery = useCustomerBalancesPage({ page: state.balancesPage, pageSize: state.balancesPageSize, search: state.balancesSearch, filter: state.balancesFilter }, { enabled: ['overview', 'balances'].includes(currentSection) });
  const employeesQuery = useEmployeeReportsPage({
    page: state.employeesPage,
    pageSize: state.employeesPageSize,
    search: state.employeeSearch,
    userId: state.selectedEmployeeId || undefined,
    role: state.employeeRole,
    activityType: state.employeeActivityType,
    from: state.submittedRange.from,
    to: state.submittedRange.to,
  }, { enabled: currentSection === 'employees' });

  const report = reportQuery.data ?? null;
  const metrics = useReportsWorkspaceMetrics({
    currentSection,
    submittedRange: state.submittedRange,
    report,
    accountingFinancialSummary: accountingFinancialSummaryQuery.data ?? null,
    accountingCashMovement: accountingCashMovementQuery.data ?? null,
    accountingReceivablesPayables: accountingReceivablesPayablesQuery.data ?? null,
    accountingInventoryValue: accountingInventoryValueQuery.data ?? null,
    inventoryQuery,
    balancesQuery,
    employeesQuery,
  });
  const actions = useReportsWorkspaceActions({
    report,
    submittedRange: state.submittedRange,
    rangeDays: metrics.rangeDays,
    executiveRows: metrics.executiveRows,
    topProducts: metrics.topProducts,
    inventorySearch: state.inventorySearch,
    inventoryFilter: state.inventoryFilter,
    deadStockDays: state.deadStockDays,
    balancesSearch: state.balancesSearch,
    balancesFilter: state.balancesFilter,
    locationId: state.locationId,
    locations: locationsQuery.data,
  });

  return {
    report,
    reportQuery,
    accountingFinancialSummary: accountingFinancialSummaryQuery.data ?? null,
    accountingCashMovement: accountingCashMovementQuery.data ?? null,
    accountingReceivablesPayables: accountingReceivablesPayablesQuery.data ?? null,
    accountingInventoryValue: accountingInventoryValueQuery.data ?? null,
    inventoryQuery,
    deadStockQuery,
    balancesQuery,
    employeesQuery,
    from: state.from,
    to: state.to,
    rangeDays: metrics.rangeDays,
    executiveRows: metrics.executiveRows,
    reportHealthRows: metrics.reportHealthRows,
    operatingSignalRows: metrics.operatingSignalRows,
    topProducts: metrics.topProducts,
    salesDailyAverage: metrics.salesDailyAverage,
    purchaseDailyAverage: metrics.purchaseDailyAverage,
    returnRatePercent: metrics.returnRatePercent,
    spotlightCards: metrics.spotlightCards,
    movementBars: metrics.movementBars,
    sectionMeta: metrics.sectionMeta,
    sectionGuidanceCards: metrics.sectionGuidanceCards,
    inventorySearch: state.inventorySearch,
    inventoryFilter: state.inventoryFilter,
    deadStockDays: state.deadStockDays,
    balancesSearch: state.balancesSearch,
    balancesFilter: state.balancesFilter,
    setFrom: state.setFrom,
    setTo: state.setTo,
    applyPreset: state.applyPresetDays,
    applyTodayPreset: state.applyTodayPreset,
    resetRange: state.resetRange,
    applyRange: state.applyScope,
    onInventorySearchChange: (value: string) => { state.setInventorySearch(value); state.setInventoryPage(1); },
    onInventoryFilterChange: (value: 'all' | 'attention' | 'low' | 'out' | 'dead') => { state.setInventoryFilter(value); state.setInventoryPage(1); },
    onDeadStockDaysChange: (days: number) => { state.setDeadStockDays(days); state.setInventoryPage(1); },
    onInventoryPageChange: state.setInventoryPage,
    onInventoryPageSizeChange: (value: number) => { state.setInventoryPageSize(value); state.setInventoryPage(1); },

    onInventoryFiltersReset: () => { state.setInventorySearch(''); state.setInventoryFilter('all'); state.setInventoryPage(1); },
    onBalancesFiltersReset: () => { state.setBalancesSearch(''); state.setBalancesFilter('all'); state.setBalancesPage(1); },
    onEmployeesFiltersReset: () => {
      state.setEmployeeSearch('');
      state.setSelectedEmployeeId('');
      state.setEmployeeRole('all');
      state.setEmployeeActivityType('all');
      state.setEmployeesPage(1);
    },
    onBalancesSearchChange: (value: string) => { state.setBalancesSearch(value); state.setBalancesPage(1); },
    onBalancesFilterChange: (value: 'all' | 'high-balance' | 'over-limit') => { state.setBalancesFilter(value); state.setBalancesPage(1); },
    onBalancesPageChange: state.setBalancesPage,
    onBalancesPageSizeChange: (value: number) => { state.setBalancesPageSize(value); state.setBalancesPage(1); },
    employeeSearch: state.employeeSearch,
    selectedEmployeeId: state.selectedEmployeeId,
    employeeRole: state.employeeRole,
    employeeActivityType: state.employeeActivityType,
    onEmployeeSearchChange: (value: string) => { state.setEmployeeSearch(value); state.setEmployeesPage(1); },
    onSelectedEmployeeIdChange: (value: string) => { state.setSelectedEmployeeId(value); state.setEmployeesPage(1); },
    onEmployeeRoleChange: (value: 'all' | 'super_admin' | 'admin' | 'cashier') => { state.setEmployeeRole(value); state.setEmployeesPage(1); },
    onEmployeeActivityTypeChange: (value: 'all' | 'sales' | 'returns' | 'purchases' | 'expenses' | 'shifts' | 'audit') => { state.setEmployeeActivityType(value); state.setEmployeesPage(1); },
    onEmployeesPageChange: state.setEmployeesPage,
    onEmployeesPageSizeChange: (value: number) => { state.setEmployeesPageSize(value); state.setEmployeesPage(1); },
    formatPercent,
    locationId: state.locationId,
    setLocationId: state.setLocationId,
    userId: state.userId,
    setUserId: state.setUserId,
    ...actions,
  };
}
