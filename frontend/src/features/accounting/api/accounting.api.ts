import { http } from '@/lib/http';

export type AccountingAccount = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: string;
  accountGroup: string;
  parentId: string;
  depth: number;
  normalBalance: string;
  // Posted-lines balance, oriented by normalBalance (0 when no lines).
  balance: number;
  isActive: boolean;
  isSystem: boolean;
  allowManualEntries: boolean;
  isControlAccount: boolean;
  isMonetary: boolean;
  revaluationCurrency: string | null;
  flags: {
    isCashBank: boolean;
    isReceivable: boolean;
    isPayable: boolean;
    isInventory: boolean;
    isTax: boolean;
  };
  sortOrder: number;
};

// INV-IMPORT-ISCASHBANK-SWEEP (I5): the accounts endpoint nests the
// cash/bank flag under `flags` — AccountingAccount has NO top-level
// `isCashBank`, so a top-level `a.isCashBank` read is always undefined
// and a filter built on it matches nothing (the deposit treasury
// dropdown offered zero accounts live). Every cash/bank dropdown
// filter must go through this helper. Re-exported from the feature's
// public index (`@/features/accounting`) because the frontend
// feature-boundary guard forbids deep cross-feature imports.
export function isCashBankAccount(
  a: { flags?: { isCashBank?: boolean } | null } | null | undefined,
): boolean {
  return a?.flags?.isCashBank === true;
}

export type JournalEntryListItem = {
  id: string;
  entryNo: string;
  entryDate: string;
  description: string;
  sourceType: string;
  sourceId: string;
  status: 'draft' | 'posted' | 'cancelled' | string;
};

export type JournalEntryLine = {
  id: string;
  accountId: string;
  accountCode?: string;
  accountNameAr?: string;
  accountNameEn?: string;
  costCenterId?: number | null;
  costCenterCode?: string | null;
  costCenterName?: string | null;
  description: string;
  debit: number;
  credit: number;
};

export type JournalEntryDetail = {
  canReverse?: boolean;
  reversedByEntryId?: string | null;
  reversalOfEntryId?: string | null;
  id: string;
  entryNo: string;
  entryDate: string;
  description: string;
  sourceType: string;
  sourceId: string;
  status: 'draft' | 'posted' | 'cancelled' | string;
  lines: JournalEntryLine[];
  totals?: {
    debit: number;
    credit: number;
    balanced?: boolean;
  };
};

export type FinancialSummaryBreakdownRow = {
  accountCode: string;
  accountNameAr: string;
  amount: number;
};

export type FinancialSummaryResponse = {
  period: {
    from: string | null;
    to: string | null;
  };
  cards: {
    grossSales: number;
    salesReturns: number;
    salesDiscounts: number;
    netSales: number;
    cogs: number;
    grossProfit: number;
    operatingExpenses: number;
    netProfit: number;
    customerCollections: number;
    supplierPayments: number;
    treasuryExpenses: number;
    netCashMovement: number;
  };
  breakdowns: {
    revenueAccounts: FinancialSummaryBreakdownRow[];
    expenseAccounts: FinancialSummaryBreakdownRow[];
    cashMovements: FinancialSummaryBreakdownRow[];
  };
};

export type ReceivableRow = {
  customerId: string;
  customerName: string;
  phone: string;
  balance: number;
  lastMovementDate: string;
};

export type PayableRow = {
  supplierId: string;
  supplierName: string;
  phone: string;
  balance: number;
  lastMovementDate: string;
};

export type ReceivablesPayablesResponse = {
  totals: {
    customerReceivables: number;
    supplierPayables: number;
    netPosition: number;
  };
  customers: ReceivableRow[];
  suppliers: PayableRow[];
};

export type CashMovementResponse = {
  period: { from: string | null; to: string | null };
  totals: {
    totalIn: number;
    totalOut: number;
    netMovement: number;
  };
  accounts: Array<{
    accountCode: string;
    accountNameAr: string;
    debit: number;
    credit: number;
    net: number;
  }>;
  sources: Array<{
    sourceType: string;
    debit: number;
    credit: number;
    net: number;
  }>;
};

export type InventoryValueItem = {
  productId: string;
  productName: string;
  barcode: string;
  categoryId: string;
  categoryName: string;
  supplierId: string;
  supplierName: string;
  quantityOnHand: number;
  minStockQty: number;
  unitCost: number;
  unitRetailPrice: number;
  inventoryValue: number;
  retailPotentialValue: number;
  potentialGrossMargin: number;
  status: 'available' | 'low_stock' | 'out_of_stock' | 'negative_stock';
};

export type InventoryValueResponse = {
  totals: {
    totalInventoryValue: number;
    totalRetailPotentialValue: number;
    totalPotentialGrossMargin: number;
    itemCount: number;
    lowStockCount: number;
    zeroStockCount: number;
    negativeStockCount: number;
  };
  items: InventoryValueItem[];
};

export type OpeningBalancePreviewLine = {
  accountId: number;
  accountCode: string;
  accountNameAr: string;
  description: string;
  debit: number;
  credit: number;
};

export type OpeningBalancesPreviewResponse = {
  alreadyPosted: boolean;
  existingOpeningEntryId: number | null;
  systemStartDate: string;
  totals: {
    cashOpening: number;
    bankOpening: number;
    customerReceivables: number;
    supplierPayables: number;
    inventoryValue: number;
    balancingCapital: number;
  };
  linesPreview: OpeningBalancePreviewLine[];
  warnings: string[];
};

export type OpeningBalancesPostResponse = {
  posted: boolean;
  alreadyPosted: boolean;
  journalEntryId: string;
  message: string;
  preview: OpeningBalancesPreviewResponse;
};

export type CreateManualJournalLinePayload = {
  accountId: number;
  costCenterId?: number | null;
  description?: string;
  debit: number;
  credit: number;
  partnerType?: 'none' | 'customer' | 'supplier';
  partnerId?: number | null;
};

export type CreateManualJournalEntryPayload = {
  entryDate: string;
  description: string;
  branchId?: number | null;
  reference?: string;
  cashFlowCategory?: 'operating' | 'investing' | 'financing';
  lines: CreateManualJournalLinePayload[];
};

export const accountingApi = {
  accounts: () => http<{ accounts: AccountingAccount[] }>('/api/accounting/accounts'),
  createAccount: (body: Partial<AccountingAccount>) => http<{ ok: boolean; accountId: string }>('/api/accounting/accounts', { method: 'POST', body: JSON.stringify(body) }),
  updateAccount: (id: string, body: Partial<AccountingAccount>) => http<{ ok: boolean }>(`/api/accounting/accounts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAccount: (id: string) => http<{ ok: boolean }>(`/api/accounting/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  generateNextAccountCode: (parentId: number) => http<{ code: string }>(`/api/accounting/accounts/generate-code?parentId=${parentId}`),
  settings: () => http<{ settings: Record<string, unknown> | null }>('/api/accounting/settings'),
  updateSettings: (body: Record<string, unknown>) => http<{ success: boolean }>('/api/accounting/settings', { method: 'PUT', body: JSON.stringify(body) }),
  createJournalEntry: (body: CreateManualJournalEntryPayload) =>
    http<{ ok: boolean; entry: { id: number; entryNo: string; totalDebit: number; totalCredit: number }; message: string }>('/api/accounting/journal-entries', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  journalEntries: (query: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || String(value).trim() === '') continue;
      search.set(key, String(value));
    }
    const suffix = search.toString();
    return http<{ entries: JournalEntryListItem[]; pagination: Record<string, unknown> }>(`/api/accounting/journal-entries${suffix ? `?${suffix}` : ''}`);
  },
  journalEntry: (id: string) => http<{ entry: JournalEntryDetail }>(`/api/accounting/journal-entries/${encodeURIComponent(id)}`),
  reverseJournalEntry: (id: string, reason: string) =>
    http<{ ok: boolean; message: string; reversalEntryId: number; reversalEntryNo: string }>(
      `/api/accounting/journal-entries/${encodeURIComponent(id)}/reverse`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),
  financialSummary: (query: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || String(value).trim() === '') continue;
      search.set(key, String(value));
    }
    const suffix = search.toString();
    return http<FinancialSummaryResponse>(`/api/accounting/reports/financial-summary${suffix ? `?${suffix}` : ''}`);
  },
  receivablesPayables: (query: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || String(value).trim() === '') continue;
      search.set(key, String(value));
    }
    const suffix = search.toString();
    return http<ReceivablesPayablesResponse>(`/api/accounting/reports/receivables-payables${suffix ? `?${suffix}` : ''}`);
  },
  cashMovement: (query: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || String(value).trim() === '') continue;
      search.set(key, String(value));
    }
    const suffix = search.toString();
    return http<CashMovementResponse>(`/api/accounting/reports/cash-movement${suffix ? `?${suffix}` : ''}`);
  },
  inventoryValue: (query: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || String(value).trim() === '') continue;
      search.set(key, String(value));
    }
    const suffix = search.toString();
    return http<InventoryValueResponse>(`/api/accounting/reports/inventory-value${suffix ? `?${suffix}` : ''}`);
  },
  openingBalancesPreview: (query: { system_start_date?: string; cash_opening?: number; bank_opening?: number }) => {
    const search = new URLSearchParams();
    if (query.system_start_date) search.set('system_start_date', String(query.system_start_date));
    if (typeof query.cash_opening === 'number' && Number.isFinite(query.cash_opening)) search.set('cash_opening', String(query.cash_opening));
    if (typeof query.bank_opening === 'number' && Number.isFinite(query.bank_opening)) search.set('bank_opening', String(query.bank_opening));
    const suffix = search.toString();
    return http<OpeningBalancesPreviewResponse>(`/api/accounting/opening-balances/preview${suffix ? `?${suffix}` : ''}`);
  },
  postOpeningBalances: (body: { system_start_date: string; cash_opening?: number; bank_opening?: number; note?: string }) =>
    http<OpeningBalancesPostResponse>('/api/accounting/opening-balances/post', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listFixedAssets: () => http<{ ok: boolean; assets: FixedAsset[] }>('/api/accounting/fixed-assets'),
  createFixedAsset: (body: CreateFixedAssetInput) =>
    http<{ ok: boolean; asset: FixedAsset }>('/api/accounting/fixed-assets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteFixedAsset: (id: number) =>
    http<{ ok: boolean; message?: string }>('/api/accounting/fixed-assets/' + id, {
      method: 'DELETE',
    }),
  depreciateFixedAsset: (id: number, body?: { months?: number; note?: string }) =>
    http<{ ok: boolean; depreciationAmount: number; accumulatedDepreciation: number; bookValue: number; isFullyDepreciated: boolean; entryNo: string; log: AssetDepreciationLog }>(`/api/accounting/fixed-assets/${id}/depreciate`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  depreciateAllFixedAssets: (body?: { months?: number; note?: string }) =>
    http<{ ok: boolean; processedCount: number; totalDepreciation: number; results: any[] }>('/api/accounting/fixed-assets/depreciate-all', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  listAssetDepreciationLogs: (assetId?: number) => {
    const url = assetId ? `/api/accounting/fixed-assets/${assetId}/logs` : '/api/accounting/fixed-assets/logs';
    return http<{ ok: boolean; logs: AssetDepreciationLog[] }>(url);
  },
  getAutoDepreciationStatus: () =>
    http<{ enabled: boolean; lastRunMonth: string | null; nextScheduledDate: string; activeAssetsCount: number }>(
      '/api/accounting/fixed-assets/auto-depreciate/status'
    ),
  toggleAutoDepreciation: (enabled: boolean) =>
    http<{ ok: boolean; enabled: boolean }>('/api/accounting/fixed-assets/auto-depreciate/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  triggerAutoDepreciation: () =>
    http<{ ok: boolean; processedCount: number; totalDepreciation: number; results: any[] }>(
      '/api/accounting/fixed-assets/auto-depreciate/trigger',
      { method: 'POST' }
    ),
};

export interface CreateFixedAssetInput {
  code: string;
  name: string;
  category?: string;
  purchaseCost: number;
  salvageValue?: number;
  usefulLifeMonths?: number;
  depreciationMethod?: 'straight_line' | 'declining_balance';
  purchaseDate?: string;
}

export interface FixedAsset {
  id: number;
  code: string;
  name: string;
  category: string;
  purchase_date: string;
  purchase_cost: number;
  salvage_value: number;
  useful_life_months: number;
  depreciation_method: 'straight_line' | 'declining_balance';
  accumulated_depreciation: number;
  book_value: number;
  status: 'active' | 'fully_depreciated' | 'retired';
  created_at: string;
}

export interface AssetDepreciationLog {
  id: number;
  asset_id: number;
  asset_name?: string;
  asset_code?: string;
  period_date: string;
  depreciation_amount: number;
  accumulated_amount: number;
  book_value: number;
  journal_entry_id: number | null;
  journal_entry_no?: string;
  note: string;
  created_at: string;
}

export interface BankStatementListItem {
  id: number;
  accountId: number;
  accountCode: string;
  accountNameAr: string;
  statementNo: string;
  statementDate: string;
  startingBalance: number;
  endingBalance: number;
  status: 'draft' | 'in_progress' | 'reconciled';
  notes?: string;
  createdAt: string;
}

export interface BankStatementLine {
  id: number;
  statementId: number;
  lineDate: string;
  description: string;
  reference: string;
  amount: number;
  isReconciled: boolean;
  matchedJournalLineId: number | null;
  reconciledAt: string | null;
}

export interface GlReconciliationLine {
  id: number;
  journalEntryId: number;
  entryNo: string;
  entryDate: string;
  description: string;
  debit: number;
  credit: number;
  netAmount: number;
  isReconciled: boolean;
}

export interface ReconcileSuggestion {
  statementLineId: number;
  journalLineId: number;
  confidence: 'high' | 'medium';
  reason: string;
}

export interface BankReconciliationWorkspace {
  statement: BankStatementListItem;
  statementLines: BankStatementLine[];
  glLines: GlReconciliationLine[];
  suggestions: ReconcileSuggestion[];
  summary: {
    startingBalance: number;
    endingBalance: number;
    reconciledAmount: number;
    calculatedEndingBalance: number;
    difference: number;
    isBalanced: boolean;
    totalLines: number;
    reconciledLinesCount: number;
  };
}

export const bankReconciliationApi = {
  listStatements: (accountId?: number) => {
    const url = accountId ? `/api/accounting/bank-statements?accountId=${accountId}` : '/api/accounting/bank-statements';
    return http<BankStatementListItem[]>(url);
  },
  getStatement: (id: number) => http<{ statement: BankStatementListItem; lines: BankStatementLine[] }>(`/api/accounting/bank-statements/${id}`),
  createStatement: (data: {
    accountId: number;
    statementNo: string;
    statementDate: string;
    startingBalance: number;
    endingBalance: number;
    notes?: string;
    lines?: { lineDate: string; description: string; reference?: string; amount: number }[];
  }) => http<any>('/api/accounting/bank-statements', { method: 'POST', body: JSON.stringify(data) }),
  getWorkspace: (id: number) => http<BankReconciliationWorkspace>(`/api/accounting/bank-statements/${id}/workspace`),
  reconcileMatch: (data: { statementLineId: number; journalLineId: number }) =>
    http<{ success: boolean; message: string }>('/api/accounting/bank-statements/reconcile', { method: 'POST', body: JSON.stringify(data) }),
  unreconcileMatch: (statementLineId: number) =>
    http<{ success: boolean; message: string }>('/api/accounting/bank-statements/unreconcile', { method: 'POST', body: JSON.stringify({ statementLineId }) }),
  createFeeAdjustment: (data: { statementLineId: number; expenseAccountId: number; description?: string }) =>
    http<{ success: boolean; message: string; journalEntryId: number }>('/api/accounting/bank-statements/fee-adjustment', { method: 'POST', body: JSON.stringify(data) }),
};

// --- Big Financial Statements & Aged Debts Types (IFRS Standard) ---

export interface BalanceSheetAccountRow {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: string;
  accountGroup: string;
  amount: number;
  compareAmount?: number;
  varianceAmount?: number;
  variancePercent?: number;
}

export interface BalanceSheetSection {
  titleAr: string;
  titleEn: string;
  total: number;
  compareTotal?: number;
  varianceAmount?: number;
  variancePercent?: number;
  accounts: BalanceSheetAccountRow[];
}

export interface BalanceSheetReportData {
  asOfDate: string;
  compareDate?: string;
  isBalanced: boolean;
  difference: number;
  assets: {
    currentAssets: BalanceSheetSection;
    nonCurrentAssets: BalanceSheetSection;
    totalAssets: number;
    compareTotalAssets?: number;
  };
  liabilities: {
    currentLiabilities: BalanceSheetSection;
    nonCurrentLiabilities: BalanceSheetSection;
    totalLiabilities: number;
    compareTotalLiabilities?: number;
  };
  equity: {
    section: BalanceSheetSection;
    currentPeriodNetProfit: number;
    compareCurrentPeriodNetProfit?: number;
    totalEquity: number;
    compareTotalEquity?: number;
  };
  totalLiabilitiesAndEquity: number;
  compareTotalLiabilitiesAndEquity?: number;
}

// --- Trial Balance (INV-TRIAL-BALANCE-PAGE): one debit column and one
// credit column per account; zero-balance accounts are included with
// 0.00 / 0.00 so the whole chart is visible.
export interface TrialBalanceRow {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  accountType: string;
  totalDebit: number;
  totalCredit: number;
  debit: number;
  credit: number;
}

export interface TrialBalanceReportData {
  asOfDate: string;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  difference: number;
  isBalanced: boolean;
}

export interface CashFlowLine {
  labelAr: string;
  labelEn: string;
  amount: number;
  note?: string;
}

export interface CashFlowSection {
  titleAr: string;
  titleEn: string;
  total: number;
  lines: CashFlowLine[];
}

export interface CashFlowReportData {
  dateFrom: string;
  dateTo: string;
  operatingActivities: CashFlowSection;
  investingActivities: CashFlowSection;
  financingActivities: CashFlowSection;
  netCashFlow: number;
  beginningCash: number;
  endingCash: number;
  reconciledCashActual: number;
  isReconciled: boolean;
  isClassified?: boolean;
  unclassifiedActivities?: CashFlowSection;
}

export interface AgedPartnerRow {
  partnerId: number;
  partnerName: string;
  phone?: string;
  creditLimit?: number;
  totalBalance: number;
  currentAmount: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days91Plus: number;
  oldestInvoiceDate?: string;
  oldestInvoiceDays?: number;
  riskLevel: 'current' | 'low' | 'medium' | 'high' | 'critical';
  whatsAppUrl?: string;
}

export interface AgedDebtsSummary {
  asOfDate: string;
  page: number;
  pageSize: number;
  totalPartnersCount: number;
  filteredPartnersCount: number;
  overduePartnersCount: number;
  totalBalance: number;
  totalCurrent: number;
  total1To30: number;
  total31To60: number;
  total61To90: number;
  total91Plus: number;
  partners: AgedPartnerRow[];
}

export const financialReportsApi = {
  balanceSheet: (params?: { asOfDate?: string; compareDate?: string; branchId?: number }) => {
    const sp = new URLSearchParams();
    if (params?.asOfDate) sp.set('asOfDate', params.asOfDate);
    if (params?.compareDate) sp.set('compareDate', params.compareDate);
    if (params?.branchId) sp.set('branchId', String(params.branchId));
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return http<BalanceSheetReportData>(`/api/accounting/reports/balance-sheet${qs}`);
  },

  trialBalance: (params?: { asOfDate?: string; branchId?: number }) => {
    const sp = new URLSearchParams();
    if (params?.asOfDate) sp.set('asOfDate', params.asOfDate);
    if (params?.branchId) sp.set('branchId', String(params.branchId));
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return http<TrialBalanceReportData>(`/api/accounting/reports/trial-balance${qs}`);
  },

  cashFlow: (params?: { dateFrom?: string; dateTo?: string; branchId?: number }) => {
    const sp = new URLSearchParams();
    if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params?.dateTo) sp.set('dateTo', params.dateTo);
    if (params?.branchId) sp.set('branchId', String(params.branchId));
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return http<CashFlowReportData>(`/api/accounting/reports/cash-flow${qs}`);
  },

  agedReceivables: (params?: { asOfDate?: string; branchId?: number; page?: number; pageSize?: number; search?: string; risk?: string }) => {
    const sp = new URLSearchParams();
    if (params?.asOfDate) sp.set('asOfDate', params.asOfDate);
    if (params?.branchId) sp.set('branchId', String(params.branchId));
    if (params?.page) sp.set('page', String(params.page));
    if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
    if (params?.search) sp.set('search', params.search);
    if (params?.risk && params.risk !== 'all') sp.set('risk', params.risk);
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return http<AgedDebtsSummary>(`/api/accounting/reports/aged-receivables${qs}`);
  },

  agedPayables: (params?: { asOfDate?: string; branchId?: number; page?: number; pageSize?: number; search?: string; risk?: string }) => {
    const sp = new URLSearchParams();
    if (params?.asOfDate) sp.set('asOfDate', params.asOfDate);
    if (params?.branchId) sp.set('branchId', String(params.branchId));
    if (params?.page) sp.set('page', String(params.page));
    if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
    if (params?.search) sp.set('search', params.search);
    if (params?.risk && params.risk !== 'all') sp.set('risk', params.risk);
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return http<AgedDebtsSummary>(`/api/accounting/reports/aged-payables${qs}`);
  },
};

// --- PDC Cheques Management Types & API ---
export type ChequeType = 'receivable' | 'payable';
export type ChequeStatus =
  | 'in_safe'
  | 'under_collection'
  | 'collected'
  | 'bounced'
  | 'endorsed'
  | 'returned'
  | 'cancelled'
  | 'issued'
  | 'cleared';

export interface PdcCheque {
  id: number;
  tenant_id: string;
  account_id: number | null;
  type: ChequeType;
  cheque_number: string;
  bank_name: string;
  branch_name: string | null;
  drawer_name: string | null;
  partner_type: string;
  partner_id: number | null;
  partner_name: string;
  amount: number;
  currency: string;
  issue_date: string;
  due_date: string;
  status: ChequeStatus;
  deposit_bank_id: number | null;
  deposit_date: string | null;
  cleared_date: string | null;
  bounced_date: string | null;
  bounced_reason: string | null;
  bounced_fee: number;
  endorsed_to_supplier_id: number | null;
  endorsed_to_supplier_name: string | null;
  journal_entry_id: number | null;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface PdcChequesStats {
  receivables: {
    totalCount: number;
    totalAmount: number;
    inSafeCount: number;
    inSafeAmount: number;
    underCollectionCount: number;
    underCollectionAmount: number;
    collectedCount: number;
    collectedAmount: number;
    bouncedCount: number;
    bouncedAmount: number;
    dueSoonCount: number;
    dueSoonAmount: number;
    overdueCount: number;
    overdueAmount: number;
  };
  payables: {
    totalCount: number;
    totalAmount: number;
    issuedCount: number;
    issuedAmount: number;
    clearedCount: number;
    clearedAmount: number;
    bouncedCount: number;
    bouncedAmount: number;
    dueSoonCount: number;
    dueSoonAmount: number;
    overdueCount: number;
    overdueAmount: number;
  };
}

export interface CreatePdcChequePayload {
  type: ChequeType;
  chequeNumber: string;
  bankName: string;
  branchName?: string;
  drawerName?: string;
  partnerType?: string;
  partnerId?: number;
  partnerName: string;
  amount: number;
  currency?: string;
  exchangeRate?: number;
  issueDate: string;
  dueDate: string;
  depositBankId?: number;
  notes?: string;
}

export interface UpdateChequeStatusPayload {
  action: 'deposit' | 'collect' | 'clear' | 'bounce' | 'endorse' | 'return' | 'cancel' | 'restore_to_safe';
  actionDate?: string;
  settlementExchangeRate?: number;
  depositBankId?: number;
  bouncedReason?: string;
  bouncedFee?: number;
  endorsedToSupplierId?: number;
  endorsedToSupplierName?: string;
  notes?: string;
}

export const pdcChequesApi = {
  list: (params?: {
    type?: ChequeType;
    status?: string;
    search?: string;
    dueFrom?: string;
    dueTo?: string;
    partnerId?: number;
    bankName?: string;
    page?: number;
    limit?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params?.type) sp.set('type', params.type);
    if (params?.status) sp.set('status', params.status);
    if (params?.search) sp.set('search', params.search);
    if (params?.dueFrom) sp.set('dueFrom', params.dueFrom);
    if (params?.dueTo) sp.set('dueTo', params.dueTo);
    if (params?.partnerId) sp.set('partnerId', String(params.partnerId));
    if (params?.bankName) sp.set('bankName', params.bankName);
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return http<{ data: PdcCheque[]; total: number; page: number; limit: number }>(`/api/accounting/cheques${qs}`);
  },

  stats: () => http<PdcChequesStats>('/api/accounting/cheques/stats'),

  create: (body: CreatePdcChequePayload) =>
    http<PdcCheque>('/api/accounting/cheques', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateStatus: (id: number, body: UpdateChequeStatusPayload) =>
    http<PdcCheque>(`/api/accounting/cheques/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (id: number) =>
    http<{ success: boolean }>(`/api/accounting/cheques/${id}`, {
      method: 'DELETE',
    }),
};

// --- Withholding Tax (WHT) & Egyptian Form 41 (ضريبة الخصم والإضافة ونموذج 41 ضرائب) ---
export interface WithholdingTaxRecord {
  id: number;
  tenant_id: string;
  direction: 'payable' | 'receivable';
  source_type: string;
  source_id: number | null;
  invoice_number: string;
  invoice_date: string;
  partner_type: string;
  partner_id: number | null;
  partner_name: string;
  tax_id_number: string | null;
  file_number: string | null;
  tax_office_code: string | null;
  partner_address: string | null;
  wht_type: string;
  wht_rate: number;
  base_amount: number;
  tax_amount: number;
  quarter: string;
  tax_year: number;
  status: string;
  payment_reference: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface Form41SummaryResponse {
  tax_year: number;
  quarter: string;
  direction: 'payable' | 'receivable';
  total_count: number;
  total_base_amount: number;
  total_tax_amount: number;
  breakdown: {
    goods: { count: number; base_amount: number; tax_amount: number; rate: number };
    services: { count: number; base_amount: number; tax_amount: number; rate: number };
    professional: { count: number; base_amount: number; tax_amount: number; rate: number };
    custom: { count: number; base_amount: number; tax_amount: number };
  };
  transactions: WithholdingTaxRecord[];
}

export interface CreateWhtTransactionPayload {
  direction?: 'payable' | 'receivable';
  source_type?: string;
  source_id?: number;
  invoice_number: string;
  invoice_date: string;
  partner_type?: string;
  partner_id?: number;
  partner_name: string;
  tax_id_number?: string;
  file_number?: string;
  tax_office_code?: string;
  partner_address?: string;
  wht_type: 'goods' | 'services' | 'professional' | 'custom';
  wht_rate?: number;
  base_amount: number;
  quarter?: string;
  tax_year?: number;
  notes?: string;
}

export const withholdingTaxApi = {
  getForm41: (params?: { year?: number; quarter?: string; direction?: 'payable' | 'receivable' }) => {
    const sp = new URLSearchParams();
    if (params?.year) sp.set('year', String(params.year));
    if (params?.quarter) sp.set('quarter', params.quarter);
    if (params?.direction) sp.set('direction', params.direction);
    const qs = sp.toString() ? `?${sp.toString()}` : '';
    return http<Form41SummaryResponse>(`/api/accounting/withholding-tax/form-41${qs}`);
  },

  create: (body: CreateWhtTransactionPayload) =>
    http<WithholdingTaxRecord>('/api/accounting/withholding-tax', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  extractFromPurchases: (body: {
    fromDate: string;
    toDate: string;
    defaultWhtRate?: number;
    defaultWhtType?: 'goods' | 'services' | 'professional';
  }) =>
    http<{ extracted_count: number; total_tax_added: number; message: string }>(
      '/api/accounting/withholding-tax/extract-from-purchases',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  updateStatus: (id: number, body: { status: 'draft' | 'declared' | 'paid'; payment_reference?: string }) =>
    http<WithholdingTaxRecord>(`/api/accounting/withholding-tax/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (id: number) =>
    http<{ success: boolean }>(`/api/accounting/withholding-tax/${id}`, {
      method: 'DELETE',
    }),
};

export interface OpenInvoiceItem {
  id: number;
  docNo: string;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  date: string;
  status: string;
}

export interface UnallocatedPaymentItem {
  id: number;
  docNo?: string | null;
  amount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  date: string;
  note: string;
}

export interface AllocateItemInput {
  invoiceId: number;
  amount: number;
}

export interface AllocatePaymentDto {
  partnerType: 'customer' | 'supplier';
  partnerId: number;
  paymentType: 'customer_payment' | 'supplier_payment' | 'direct';
  paymentId?: number | null;
  allocations: AllocateItemInput[];
  notes?: string;
}

export const paymentAllocationApi = {
  getOpenInvoices: (partnerType: 'customer' | 'supplier', partnerId: number) =>
    http<OpenInvoiceItem[]>(`/api/accounting/payment-allocations/open-invoices?partnerType=${partnerType}&partnerId=${partnerId}`),

  getUnallocatedPayments: (partnerType: 'customer' | 'supplier', partnerId: number) =>
    http<UnallocatedPaymentItem[]>(`/api/accounting/payment-allocations/unallocated-payments?partnerType=${partnerType}&partnerId=${partnerId}`),

  allocatePayment: (data: AllocatePaymentDto) =>
    http<{ success: boolean; totalAllocated: number; count: number }>('/api/accounting/payment-allocations/allocate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  autoAllocateFIFO: (partnerType: 'customer' | 'supplier', partnerId: number, paymentId: number) =>
    http<{ success: boolean; totalAllocated: number; count: number }>('/api/accounting/payment-allocations/auto-fifo', {
      method: 'POST',
      body: JSON.stringify({ partnerType, partnerId, paymentId }),
    }),

  getInvoiceAllocations: (invoiceType: 'sale' | 'purchase', invoiceId: number) =>
    http<any[]>(`/api/accounting/payment-allocations/invoice?invoiceType=${invoiceType}&invoiceId=${invoiceId}`),
};

