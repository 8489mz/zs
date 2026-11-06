import type { Customer, ReportSummary } from '@/types/domain';
import type { CashMovementResponse, FinancialSummaryResponse, InventoryValueResponse, ReceivablesPayablesResponse } from '@/shared/api/accounting-reports';
import type { EmployeeReportRow, EmployeeReportsSummary, ReportInventoryRow, DeadStockResponse } from '@/features/reports/api/reports.api';
import type { ReportsSectionKey } from '@/features/reports/pages/reports.page-config';

export type PagedQuery<TSummary, TRow> = {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data?: {
    rows: TRow[];
    summary: TSummary;
    pagination: {
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
      rangeStart: number;
      rangeEnd: number;
    };
  };
};

export type ReportsSectionContentProps = {
  section: ReportsSectionKey;
  report: ReportSummary | null | undefined;
  reportQuery: { isLoading: boolean; isError: boolean; error: unknown };
  accountingFinancialSummary?: FinancialSummaryResponse | null;
  accountingCashMovement?: CashMovementResponse | null;
  accountingReceivablesPayables?: ReceivablesPayablesResponse | null;
  accountingInventoryValue?: InventoryValueResponse | null;
  inventoryQuery: PagedQuery<{ totalItems: number; outOfStock: number; lowStock: number; healthy: number; trackedLocations?: number; locationHighlights?: Array<{ locationId: string; locationName: string; branchId?: string; branchName?: string; totalQty: number; trackedProducts: number; attentionItems: number; lowStockItems: number; outOfStockItems: number }> }, ReportInventoryRow>;
  balancesQuery: PagedQuery<{ totalItems: number; totalBalance: number; overLimit: number; highBalance: number }, Customer>;
  executiveRows: Array<[string, number]>;
  operatingSignalRows: Array<{ label: string; value: string }>;
  topProducts: Array<{ name: string; qty: number; revenue: number }>;
  rangeDays: number;
  salesDailyAverage: number;
  purchaseDailyAverage: number;
  returnRatePercent: number;
  exportTopProducts: () => void | Promise<void>;
  printTopProducts: (format?: 'A4' | 'receipt') => void | Promise<void>;
  exportLowStock: () => void | Promise<void>;
  exportCustomerBalances: () => void | Promise<void>;
  printCustomerBalances: (format?: 'A4' | 'receipt') => void | Promise<void>;
  printInventoryValueReport: (format?: 'A4' | 'receipt') => void | Promise<void>;
  printInventoryMovementsReport: (locationId: string, detailed?: boolean, format?: 'A4' | 'receipt') => void | Promise<void>;
  printSalesRegisterReport: (detailed?: boolean, format?: 'A4' | 'receipt') => void | Promise<void>;
  printPurchasesRegisterReport: (detailed?: boolean, format?: 'A4' | 'receipt') => void | Promise<void>;
  locationId: string;
  formatPercent: (value: number) => string;
  inventorySearch: string;
  onInventorySearchChange: (value: string) => void;
  inventoryFilter: 'all' | 'attention' | 'low' | 'out' | 'dead';
  onInventoryFilterChange: (value: 'all' | 'attention' | 'low' | 'out' | 'dead') => void;
  deadStockDays?: number;
  onDeadStockDaysChange?: (days: number) => void;
  /* Full-set dead-stock totals from GET /api/reports/inventory/dead-stock
  (INV-DEAD-STOCK-FULL-TOTALS). Present only when the dead filter is active;
  the section shows '—' while it has no data instead of a page reduce(). */
  deadStockQuery?: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data?: DeadStockResponse;
  };
  onInventoryPageChange: (page: number) => void;
  onInventoryPageSizeChange: (pageSize: number) => void;
  balancesSearch: string;
  onBalancesSearchChange: (value: string) => void;
  balancesFilter: 'all' | 'high-balance' | 'over-limit';
  onBalancesFilterChange: (value: 'all' | 'high-balance' | 'over-limit') => void;
  onBalancesPageChange: (page: number) => void;
  onBalancesPageSizeChange: (pageSize: number) => void;

  employeesQuery: PagedQuery<EmployeeReportsSummary, EmployeeReportRow>;
  employeeSearch: string;
  onEmployeeSearchChange: (value: string) => void;
  selectedEmployeeId: string;
  onSelectedEmployeeIdChange: (value: string) => void;
  employeeRole: 'all' | 'super_admin' | 'admin' | 'cashier';
  onEmployeeRoleChange: (value: 'all' | 'super_admin' | 'admin' | 'cashier') => void;
  employeeActivityType: 'all' | 'sales' | 'returns' | 'purchases' | 'expenses' | 'shifts' | 'audit';
  onEmployeeActivityTypeChange: (value: 'all' | 'sales' | 'returns' | 'purchases' | 'expenses' | 'shifts' | 'audit') => void;
  onEmployeesPageChange: (page: number) => void;
  onEmployeesPageSizeChange: (pageSize: number) => void;
  onEmployeesFiltersReset: () => void;
  onInventoryFiltersReset: () => void;
  onBalancesFiltersReset: () => void;
};
