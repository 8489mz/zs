import type { Customer, Supplier } from './catalog';

export interface ReportSummary {
  sales: {
    count: number;
    total: number;
    netSales: number;
    invoiceCount?: number;
    servicesCount?: number;
    merchandiseTotal?: number;
    servicesTotal?: number;
  };
  services?: {
    count: number;
    total: number;
  };
  purchases: {
    count: number;
    total: number;
    netPurchases: number;
  };
  expenses: {
    count: number;
    total: number;
  };
  returns: {
    count: number;
    total: number;
    salesTotal?: number;
    purchasesTotal?: number;
  };
  treasury: {
    cashIn: number;
    cashOut: number;
    net: number;
  };
  commercial: {
    grossProfit: number;
    grossMarginPercent: number;
    netOperatingProfit: number;
    cogs?: number;
    informationalOnlyPurchasesInPeriod?: number;
  };
  delivery?: {
    count: number;
    total: number;
    mode: 'freelance_courier' | 'store_fleet' | string;
    storeProfit: number;
    freelanceCount?: number;
    freelanceTotal?: number;
    storeFleetCount?: number;
    storeFleetTotal?: number;
    storeFleetCourierShare?: number;
    commissionRate?: number;
  };
  topProducts?: Array<{
    name: string;
    qty: number;
    revenue: number;
    total?: number;
  }>;
  /* INV-REPORTS-REAL-SALES-PURCHASES-SERIES: one point per
  business-date bucket of the selected range (daily up to 92 days,
  monthly beyond), each point the real net sales / net purchases
  of its bucket from posted invoices. The points sum exactly to
  sales.netSales / purchases.netPurchases. Absent on old payloads
  (e.g. the FakeDb fallback before this package); the overview
  section falls back to the honest two-number boxes then. */
  salesPurchasesSeries?: {
    granularity: 'day' | 'month';
    points: Array<{
      date: string;
      sales: number;
      purchases: number;
    }>;
  };
}

export interface CustomerLedgerEntry {
  created_at?: string;
  date?: string;
  doc_no?: string;
  entry_type?: string;
  note?: string;
  debit?: number;
  credit?: number;
  balance_after?: number;
  reference_type?: string;
  reference_id?: string;
}

export interface SupplierLedgerEntry {
  created_at?: string;
  date?: string;
  doc_no?: string;
  entry_type?: string;
  note?: string;
  debit?: number;
  credit?: number;
  balance_after?: number;
  reference_type?: string;
  reference_id?: string;
}

export interface LedgerSummary {
  totalItems: number;
  debitTotal: number;
  creditTotal: number;
  net: number;
  lastBalance: number;
}

export interface LedgerPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CustomerLedger {
  customer?: Customer;
  entries: CustomerLedgerEntry[];
  summary?: LedgerSummary;
  pagination?: LedgerPagination;
}

export interface SupplierLedger {
  supplier?: Supplier;
  entries: SupplierLedgerEntry[];
  summary?: LedgerSummary;
  pagination?: LedgerPagination;
}
