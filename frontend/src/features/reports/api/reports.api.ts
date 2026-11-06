import { http } from '@/lib/http';
import { unwrapArray, unwrapByKey } from '@/lib/api/contracts';
import type { Customer, InventoryReport, Product, ReportSummary } from '@/types/domain';
import { buildQueryString } from '@/lib/query-string';

export interface ReportInventoryLocationBreakdown {
  locationId: string;
  locationName: string;
  branchId?: string;
  branchName?: string;
  qty: number;
}

export interface ReportInventoryLocationHighlight {
  locationId: string;
  locationName: string;
  branchId?: string;
  branchName?: string;
  totalQty: number;
  trackedProducts: number;
  attentionItems: number;
  lowStockItems: number;
  outOfStockItems: number;
}

export interface ReportInventoryRow {
  id: string;
  name: string;
  category?: string;
  supplier?: string;
  stock: number;
  stockQty?: number;
  minStock: number;
  costPrice?: number;
  retailPrice?: number;
  status?: string;
  topLocationName?: string;
  topLocationQty?: number;
  locationsLabel?: string;
  assignedQty?: number;
  unassignedQty?: number;
  stockLocationExcessQty?: number;
  locations?: ReportInventoryLocationBreakdown[];
}

export interface ReportInventoryQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: 'all' | 'attention' | 'low' | 'out' | 'dead';
  days?: number;
  locationId?: string;
}

export interface CustomerBalancesQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: 'all' | 'high-balance' | 'over-limit';
}

interface ReportInventoryPageResponse {
  items?: Array<ReportInventoryRow & {
    stockQty?: number;
    stock?: number;
    costPrice?: number;
    retailPrice?: number;
    topLocationName?: string;
    topLocationQty?: number;
    locationsLabel?: string;
    assignedQty?: number;
    unassignedQty?: number;
    locations?: ReportInventoryLocationBreakdown[];
  }>;
  inventory?: InventoryReport;
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    rangeStart: number;
    rangeEnd: number;
  };
  summary?: {
    totalItems: number;
    outOfStock: number;
    lowStock: number;
    healthy: number;
    trackedLocations?: number;
  };
  locationHighlights?: ReportInventoryLocationHighlight[];
}

interface CustomerBalancesPageResponse {
  customers?: Customer[];
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    rangeStart: number;
    rangeEnd: number;
  };
  summary?: {
    totalItems: number;
    totalBalance: number;
    overLimit: number;
    highBalance: number;
  };
}

type PagedResult<T> = { rows: T[]; pagination?: { page: number; totalPages: number } };



export interface EmployeeReportRow {
  id: string;
  name: string;
  username: string;
  role: 'super_admin' | 'admin' | 'cashier' | string;
  isActive: boolean;
  salesCount: number;
  salesTotal: number;
  purchasesCount: number;
  purchasesTotal: number;
  returnsCount: number;
  returnsTotal: number;
  expensesCount: number;
  expensesTotal: number;
  auditCount: number;
  shiftsCount: number;
  openShifts: number;
  lastActivityAt?: string | null;
}

export interface EmployeeReportsSummary {
  totalUsers: number;
  activeUsers: number;
  usersWithActivity: number;
  totalSales: number;
  totalPurchases: number;
  totalReturns: number;
  totalExpenses: number;
  totalAuditEvents: number;
  totalShifts: number;
}

export interface EmployeeReportsQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  userId?: string;
  role?: 'all' | 'super_admin' | 'admin' | 'cashier';
  activityType?: 'all' | 'sales' | 'returns' | 'purchases' | 'expenses' | 'shifts' | 'audit';
  from?: string;
  to?: string;
}

export interface EmployeeReportActivity {
  id: string;
  activityType: 'sale' | 'purchase' | 'returns' | 'expenses' | 'shifts' | 'audit' | string;
  title: string;
  details: string;
  amount: number | null;
  createdAt: string;
  referenceLabel?: string;
}

export interface EmployeeReportDetailsResponse {
  employee: EmployeeReportRow;
  summary: EmployeeReportsSummary;
  activities: EmployeeReportActivity[];
}

export interface EmployeeReportsPageResponse {
  rows?: EmployeeReportRow[];
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    rangeStart: number;
    rangeEnd: number;
  };
  summary?: EmployeeReportsSummary;
}


async function listAllPages<T>(fetchPage: (page: number) => Promise<PagedResult<T>>) {
  const first = await fetchPage(1);
  const rows = [...first.rows];
  const totalPages = Math.max(1, Number(first.pagination?.totalPages || 1));
  for (let page = 2; page <= totalPages; page += 1) {
    const current = await fetchPage(page);
    rows.push(...current.rows);
  }
  return rows;
}

export const reportsApi = {
  summary: (from: string, to: string, options?: { branchId?: string; locationId?: string; userId?: string }) => {
    const params: Record<string, string | number | undefined | null> = { from, to };
    if (options?.branchId && options.branchId !== 'all') params.branchId = options.branchId;
    if (options?.locationId && options.locationId !== 'all') params.locationId = options.locationId;
    if (options?.userId && options.userId !== 'all') params.userId = options.userId;
    return http<ReportSummary>(`/api/reports/summary${buildQueryString(params)}`);
  },
  inventory: async () => unwrapByKey<InventoryReport>(await http<InventoryReport | { inventory: InventoryReport }>('/api/reports/inventory'), 'inventory', {} as InventoryReport),
  inventoryPage: async (params: ReportInventoryQueryParams) => {
    const response = await http<ReportInventoryPageResponse>(`/api/reports/inventory${buildQueryString(params as Record<string, string | number | undefined | null>)}`);
    const rows = Array.isArray(response.items)
      ? response.items.map((item) => ({
          ...item,
          stock: Number(item.stock ?? item.stockQty ?? 0),
          stockQty: Number(item.stockQty ?? item.stock ?? 0),
          minStock: Number(item.minStock ?? 0),
          costPrice: Number(item.costPrice ?? 0),
          retailPrice: Number(item.retailPrice ?? 0),
          topLocationQty: Number(item.topLocationQty ?? 0),
          assignedQty: Number(item.assignedQty ?? 0),
          unassignedQty: Number(item.unassignedQty ?? 0),
          stockLocationExcessQty: Number(item.stockLocationExcessQty ?? 0),
          locationsLabel: item.locationsLabel || '',
          locations: Array.isArray(item.locations) ? item.locations : [],
        }))
      : [];
    return {
      rows,
      pagination: response.pagination || {
        page: 1,
        pageSize: rows.length || Number(params.pageSize || 10),
        totalItems: rows.length,
        totalPages: 1,
        rangeStart: rows.length ? 1 : 0,
        rangeEnd: rows.length,
      },
      summary: {
        totalItems: Number(response.summary?.totalItems ?? rows.length),
        outOfStock: Number(response.summary?.outOfStock ?? 0),
        lowStock: Number(response.summary?.lowStock ?? 0),
        healthy: Number(response.summary?.healthy ?? 0),
        trackedLocations: Number(response.summary?.trackedLocations ?? 0),
        locationHighlights: Array.isArray(response.locationHighlights) ? response.locationHighlights : [],
      },
    };
  },
  listAllInventory: async (params: Omit<ReportInventoryQueryParams, 'page' | 'pageSize'>) => listAllPages<ReportInventoryRow>((page) => reportsApi.inventoryPage({ ...params, page, pageSize: 100 })),
  customerBalances: async () => unwrapArray<Customer>(await http<Customer[] | { customers: Customer[] }>('/api/reports/customer-balances'), 'customers'),
  customerBalancesPage: async (params: CustomerBalancesQueryParams) => {
    const response = await http<CustomerBalancesPageResponse>(`/api/reports/customer-balances${buildQueryString(params as Record<string, string | number | undefined | null>)}`);
    return {
      rows: Array.isArray(response.customers) ? response.customers : [],
      pagination: response.pagination || {
        page: 1,
        pageSize: Array.isArray(response.customers) ? response.customers.length || Number(params.pageSize || 10) : Number(params.pageSize || 10),
        totalItems: Array.isArray(response.customers) ? response.customers.length : 0,
        totalPages: 1,
        rangeStart: Array.isArray(response.customers) && response.customers.length ? 1 : 0,
        rangeEnd: Array.isArray(response.customers) ? response.customers.length : 0,
      },
      summary: response.summary || {
        totalItems: Array.isArray(response.customers) ? response.customers.length : 0,
        totalBalance: Array.isArray(response.customers) ? response.customers.reduce((sum, row) => sum + Number(row.balance || 0), 0) : 0,
        overLimit: 0,
        highBalance: 0,
      },
    };
  },
  listAllCustomerBalances: async (params: Omit<CustomerBalancesQueryParams, 'page' | 'pageSize'>) => listAllPages<Customer>((page) => reportsApi.customerBalancesPage({ ...params, page, pageSize: 100 })),
  employeeReportsPage: async (params: EmployeeReportsQueryParams) => {
    const query = {
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
      ...(params.search ? { search: params.search } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.role && params.role !== 'all' ? { role: params.role } : {}),
      ...(params.activityType && params.activityType !== 'all' ? { activityType: params.activityType } : {}),
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
    };
    const response = await http<EmployeeReportsPageResponse>(`/api/reports/employees${buildQueryString(query as Record<string, string | number | undefined | null>)}`);
    const rows = Array.isArray(response.rows) ? response.rows.map((row) => ({
      ...row,
      isActive: row.isActive !== false,
      salesCount: Number(row.salesCount || 0),
      salesTotal: Number(row.salesTotal || 0),
      purchasesCount: Number(row.purchasesCount || 0),
      purchasesTotal: Number(row.purchasesTotal || 0),
      returnsCount: Number(row.returnsCount || 0),
      returnsTotal: Number(row.returnsTotal || 0),
      expensesCount: Number(row.expensesCount || 0),
      expensesTotal: Number(row.expensesTotal || 0),
      auditCount: Number(row.auditCount || 0),
      shiftsCount: Number(row.shiftsCount || 0),
      openShifts: Number(row.openShifts || 0),
    })) : [];
    return {
      rows,
      pagination: response.pagination || {
        page: 1,
        pageSize: rows.length || Number(params.pageSize || 10),
        totalItems: rows.length,
        totalPages: 1,
        rangeStart: rows.length ? 1 : 0,
        rangeEnd: rows.length,
      },
      summary: response.summary || {
        totalUsers: rows.length,
        activeUsers: rows.filter((row) => row.isActive).length,
        usersWithActivity: rows.filter((row) => (row.salesCount + row.purchasesCount + row.returnsCount + row.expensesCount + row.auditCount + row.shiftsCount) > 0).length,
        totalSales: rows.reduce((sum, row) => sum + Number(row.salesTotal || 0), 0),
        totalPurchases: rows.reduce((sum, row) => sum + Number(row.purchasesTotal || 0), 0),
        totalReturns: rows.reduce((sum, row) => sum + Number(row.returnsTotal || 0), 0),
        totalExpenses: rows.reduce((sum, row) => sum + Number(row.expensesTotal || 0), 0),
        totalAuditEvents: rows.reduce((sum, row) => sum + Number(row.auditCount || 0), 0),
        totalShifts: rows.reduce((sum, row) => sum + Number(row.shiftsCount || 0), 0),
      },
    };
  },
  employeeReportDetails: (userId: string, params: Pick<EmployeeReportsQueryParams, 'from' | 'to' | 'activityType'> & { limit?: number } = {}) => {
    const query = {
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
      ...(params.activityType && params.activityType !== 'all' ? { activityType: params.activityType } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    };
    return http<EmployeeReportDetailsResponse>(`/api/reports/employees/${encodeURIComponent(userId)}/details${buildQueryString(query as Record<string, string | number | undefined | null>)}`);
  },
  products: async () => unwrapArray<Product>(await http<Product[] | { products: Product[] }>('/api/products'), 'products'),
  debtAging: () => http<DebtAgingResponse>('/api/reports/debt-aging'),
  demandForecasting: () => http<DemandForecastingResponse>('/api/reports/demand-forecasting'),
  deadStock: async (params: DeadStockQueryParams = {}): Promise<DeadStockResponse> => {
    const query: Record<string, string | number | undefined | null> = {
      ...(params.days ? { days: params.days } : {}),
      ...(params.locationId ? { locationId: params.locationId } : {}),
      ...(params.search ? { search: params.search } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    };
    const response = await http<DeadStockBackendResponse>(`/api/reports/inventory/dead-stock${buildQueryString(query)}`);
    const summary = response.summary ?? {};
    return {
      items: Array.isArray(response.items) ? response.items.map((item) => ({
        id: String(item.id ?? ''),
        name: item.name ?? '',
        barcode: item.barcode ?? '',
        category: item.categoryName ?? '',
        supplier: item.supplierName ?? '',
        stockQty: Number(item.stock ?? 0),
        costPrice: Number(item.costPrice ?? 0),
        retailPrice: Number(item.retailPrice ?? 0),
        tiedCapital: Number(item.tiedCapital ?? 0),
        daysSinceLastSale: item.daysWithoutSale ?? null,
        lastSaleAt: item.lastSaleDate ?? null,
      })) : [],
      pagination: response.pagination || {
        page: Number(params.page || 1),
        pageSize: Number(params.pageSize || 20),
        totalItems: Number(summary.totalDeadItems ?? 0),
        totalPages: 1,
        rangeStart: 0,
        rangeEnd: 0,
      },
      summary: {
        totalDeadProducts: Number(summary.totalDeadItems ?? 0),
        totalTiedCapital: Number(summary.totalTiedCapital ?? 0),
        totalDeadStockUnits: Number(summary.totalDeadStockQty ?? 0),
        cutoffDays: Number(summary.daysThreshold ?? params.days ?? 60),
      },
    };
  },
  customerRfm: (params: { search?: string; segment?: string } = {}) => {
    const query: Record<string, string | number | undefined | null> = {
      ...(params.search ? { search: params.search } : {}),
      ...(params.segment && params.segment !== 'all' ? { segment: params.segment } : {}),
    };
    return http<CustomerRfmResponse>(`/api/reports/customers/rfm${buildQueryString(query)}`);
  },
  foodCostVariance: (params?: { from?: string; to?: string }) => {
    const query: Record<string, string | number | undefined | null> = {
      ...(params?.from ? { from: params.from } : {}),
      ...(params?.to ? { to: params.to } : {}),
    };
    return http<FoodCostVarianceResponse>(`/api/reports/restaurant/food-cost-variance${buildQueryString(query)}`);
  },
  menuEngineering: (params?: { from?: string; to?: string; branchId?: number }) => {
    const query: Record<string, string | number | undefined | null> = {
      ...(params?.from ? { from: params.from } : {}),
      ...(params?.to ? { to: params.to } : {}),
      ...(params?.branchId ? { branchId: params.branchId } : {}),
    };
    return http<MenuEngineeringResponse>(`/api/reports/restaurant/menu-engineering${buildQueryString(query)}`);
  },
};

export interface MenuEngineeringItem {
  productId: number;
  productName: string;
  categoryName: string;
  qtySold: number;
  unitPrice: number;
  unitCost: number;
  unitMargin: number;
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  foodCostPercentage: number;
  popularityShare: number;
  quadrant: 'star' | 'plowhorse' | 'puzzle' | 'dog';
  quadrantLabelAr: string;
  recommendation: string;
}

export interface MenuEngineeringSummary {
  totalItems: number;
  totalUnitsSold: number;
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  overallFoodCostPercentage: number;
  averageUnitMargin: number;
  popularityHurdleRate: number;
  starCount: number;
  plowhorseCount: number;
  puzzleCount: number;
  dogCount: number;
  potentialProfitUplift: number;
}

export interface MenuEngineeringResponse {
  summary: MenuEngineeringSummary;
  items: MenuEngineeringItem[];
}

export type CustomerRfmSegment = 'champions' | 'loyal' | 'promising' | 'at_risk' | 'lost';

export interface CustomerRfmItem {
  id: string;
  name: string;
  phone: string;
  balance: number;
  loyaltyPoints: number;
  frequency: number;
  monetary: number;
  recencyDays: number;
  lastSaleDate: string | null;
  aov: number;
  segment: CustomerRfmSegment;
}

export interface CustomerRfmResponse {
  summary: {
    totalCustomers: number;
    championsCount: number;
    loyalCount: number;
    promisingCount: number;
    atRiskCount: number;
    lostCount: number;
    totalRevenue: number;
    averageAov: number;
    repeatRate: number;
  };
  items: CustomerRfmItem[];
}

export interface DeadStockItem {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  category?: string;
  supplier?: string;
  stockQty: number;
  costPrice: number;
  retailPrice: number;
  tiedCapital: number;
  daysSinceLastSale: number | null;
  lastSaleAt: string | null;
}

/* Raw shape of GET /api/reports/inventory/dead-stock (INV-DEAD-STOCK-FULL-TOTALS).
   The backend names the summary fields totalDeadItems / totalDeadStockQty /
   daysThreshold and the item fields categoryName / supplierName / stock /
   daysWithoutSale / lastSaleDate; deadStock() below maps them onto the
   frontend DeadStockResponse names so callers never read undefined. */
export interface DeadStockBackendItem {
  id?: number | string;
  name?: string;
  barcode?: string;
  categoryName?: string;
  supplierName?: string;
  stock?: number;
  costPrice?: number;
  retailPrice?: number;
  tiedCapital?: number;
  daysWithoutSale?: number | null;
  lastSaleDate?: string | null;
}

export interface DeadStockBackendResponse {
  items?: DeadStockBackendItem[];
  pagination?: DeadStockResponse['pagination'];
  summary?: {
    totalDeadItems?: number;
    totalDeadStockQty?: number;
    totalTiedCapital?: number;
    totalRetailValue?: number;
    daysThreshold?: number;
  };
}

export interface DeadStockResponse {
  items: DeadStockItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    rangeStart: number;
    rangeEnd: number;
  };
  summary: {
    totalDeadProducts: number;
    totalTiedCapital: number;
    totalDeadStockUnits: number;
    cutoffDays: number;
  };
}

export interface DeadStockQueryParams {
  days?: number;
  locationId?: number | string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface DebtAgingBucketSummary {
  total: number;
  current: number;
  days31To60: number;
  days61To90: number;
  over90: number;
}

export interface DebtAgingPartyRow {
  id: string;
  name: string;
  phone: string;
  totalBalance: number;
  current: number;
  days31To60: number;
  days61To90: number;
  over90: number;
}

export interface DebtAgingResponse {
  receivablesSummary: DebtAgingBucketSummary;
  payablesSummary: DebtAgingBucketSummary;
  receivables: DebtAgingPartyRow[];
  payables: DebtAgingPartyRow[];
}

export interface DemandForecastingItem {
  productId: string;
  name: string;
  barcode: string;
  sku: string;
  stock: number;
  minStock: number;
  costPrice: number;
  soldLast30Days: number;
  dailyBurnRate: number;
  runwayDays: number;
  urgency: 'out_of_stock' | 'critical' | 'warning' | 'healthy' | 'overstocked';
  suggestedReorderQty: number;
}

export interface DemandForecastingResponse {
  summary: {
    totalMonitoredProducts: number;
    outOfStockCount: number;
    criticalCount: number;
    warningCount: number;
    healthyCount: number;
    overstockedCount: number;
  };
  items: DemandForecastingItem[];
}

export interface FoodCostVarianceItem {
  productId: number;
  productName: string;
  sku: string;
  unitName: string;
  costPrice: number;
  theoreticalQty: number;
  theoreticalCost: number;
  wasteQty: number;
  wasteCost: number;
  actualQty: number;
  actualCost: number;
  varianceQty: number;
  varianceCost: number;
  variancePct: number;
  status: 'normal' | 'warning' | 'critical';
}

export interface FoodCostVarianceResponse {
  range: { from: string; to: string };
  summary: {
    totalTheoreticalCost: number;
    totalActualCost: number;
    totalWasteCost: number;
    totalVarianceCost: number;
    overallVariancePct: number;
  };
  items: FoodCostVarianceItem[];
}