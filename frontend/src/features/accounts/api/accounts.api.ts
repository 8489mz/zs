import { http } from '@/lib/http';
import { postIdempotentAccountPayment } from '@/lib/api/idempotent-account-payment';
import { unwrapArray } from '@/lib/api/contracts';
import type { Customer, CustomerLedger, Supplier, SupplierLedger } from '@/types/domain';
import { buildQueryString } from '@/lib/query-string';

export interface LedgerQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

type LedgerEntryLike = Record<string, unknown>;
type LedgerPayloadLike = Record<string, unknown>;

function normalizeLedgerSummary(summary: Record<string, unknown> | null | undefined, entries: Array<Record<string, unknown>> = []) {
  const lastEntry = entries[entries.length - 1] || {};
  return {
    totalItems: Number(summary?.totalItems ?? summary?.totalEntries ?? entries.length ?? 0),
    debitTotal: Number(summary?.debitTotal ?? summary?.totalDebits ?? 0),
    creditTotal: Number(summary?.creditTotal ?? summary?.totalCredits ?? 0),
    net: Number(summary?.net ?? 0),
    lastBalance: Number(summary?.lastBalance ?? lastEntry.balanceAfter ?? lastEntry.balance_after ?? 0),
  };
}

function normalizeLedgerEntries(entries: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    const row = (entry || {}) as LedgerEntryLike;
    const amount = Number(row.amount ?? 0);
    return {
      ...row,
      entry_type: String(row.entry_type ?? row.type ?? ''),
      created_at: String(row.created_at ?? row.createdAt ?? row.date ?? ''),
      date: String(row.date ?? row.createdAt ?? row.created_at ?? ''),
      debit: Number(row.debit ?? (amount > 0 ? amount : 0)),
      credit: Number(row.credit ?? (amount < 0 ? Math.abs(amount) : 0)),
      balance_after: Number(row.balance_after ?? row.balanceAfter ?? 0),
      reference_type: String(row.reference_type ?? row.referenceType ?? ''),
      reference_id: String(row.reference_id ?? row.referenceId ?? ''),
      doc_no: String(row.doc_no ?? row.docNo ?? ''),
    };
  });
}

function normalizeCustomerLedger(payload: CustomerLedger | LedgerPayloadLike): CustomerLedger {
  const raw = (payload || {}) as LedgerPayloadLike;
  const entries = normalizeLedgerEntries(raw.entries);
  return {
    customer: (raw.customer ?? null) as CustomerLedger['customer'],
    entries: entries as unknown as CustomerLedger['entries'],
    summary: normalizeLedgerSummary((raw.summary || null) as Record<string, unknown> | null, entries) as CustomerLedger['summary'],
    pagination: (raw.pagination ?? null) as CustomerLedger['pagination'],
  };
}

function normalizeSupplierLedger(payload: SupplierLedger | LedgerPayloadLike): SupplierLedger {
  const raw = (payload || {}) as LedgerPayloadLike;
  const entries = normalizeLedgerEntries(raw.entries);
  return {
    supplier: (raw.supplier ?? null) as SupplierLedger['supplier'],
    entries: entries as unknown as SupplierLedger['entries'],
    summary: normalizeLedgerSummary((raw.summary || null) as Record<string, unknown> | null, entries) as SupplierLedger['summary'],
    pagination: (raw.pagination ?? null) as SupplierLedger['pagination'],
  };
}

export interface SupplierAdvanceRow {
  id: string;
  docNo: string;
  supplierId: string;
  amount: number;
  isAdvance: boolean;
  appliedAmount: number;
  remainingAdvance: number;
  note: string;
  date: string;
  paymentChannel: string;
  instapayAddress: string;
  createdBy: string;
}

export const accountsApi = {
  customers: async () => unwrapArray<Customer>(await http<Customer[] | { customers: Customer[] }>('/api/customers'), 'customers'),
  suppliers: async () => unwrapArray<Supplier>(await http<Supplier[] | { suppliers: Supplier[] }>('/api/suppliers'), 'suppliers'),
  customerBalances: async () => unwrapArray<Customer>(await http<Customer[] | { customers: Customer[] }>('/api/reports/customer-balances'), 'customers'),
  supplierBalances: async () => unwrapArray<Supplier>(await http<Supplier[] | { suppliers: Supplier[] }>('/api/reports/supplier-balances'), 'suppliers'),
  partnerContacts: async (type: string, id: string) => unwrapArray<any>(await http<any>(`/api/partners/${type}/${id}/contacts`), 'contacts'),
  partnerAddresses: async (type: string, id: string) => unwrapArray<any>(await http<any>(`/api/partners/${type}/${id}/addresses`), 'addresses'),
  customerLedger: async (id: string, params?: LedgerQueryParams) => normalizeCustomerLedger(await http<CustomerLedger>(`/api/reports/customers/${id}/ledger${buildQueryString(params || {})}`)),
  supplierLedger: async (id: string, params?: LedgerQueryParams) => normalizeSupplierLedger(await http<SupplierLedger>(`/api/reports/suppliers/${id}/ledger${buildQueryString(params || {})}`)),
  listAllCustomerLedger: async (id: string, search = '') => {
    const pageSize = 200;
    let page = 1;
    const entries: CustomerLedger['entries'] = [];
    let customer: CustomerLedger['customer'];
    let summary: CustomerLedger['summary'];
    while (true) {
      const payload = await accountsApi.customerLedger(id, { page, pageSize, search });
      customer = payload.customer;
      summary = payload.summary;
      entries.push(...(payload.entries || []));
      const totalPages = payload.pagination?.totalPages || 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return { customer, entries, summary } as CustomerLedger;
  },
  listAllSupplierLedger: async (id: string, search = '') => {
    const pageSize = 200;
    let page = 1;
    const entries: SupplierLedger['entries'] = [];
    let supplier: SupplierLedger['supplier'];
    let summary: SupplierLedger['summary'];
    while (true) {
      const payload = await accountsApi.supplierLedger(id, { page, pageSize, search });
      supplier = payload.supplier;
      summary = payload.summary;
      entries.push(...(payload.entries || []));
      const totalPages = payload.pagination?.totalPages || 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return { supplier, entries, summary } as SupplierLedger;
  },
  customerPaymentCreate: (payload: unknown) => postIdempotentAccountPayment('/api/customer-payments', payload),
  supplierPaymentCreate: (payload: unknown) => postIdempotentAccountPayment('/api/supplier-payments', payload),
  /* INV-SUPPLIER-ADVANCE-UI-WIRING: the advances card's read + apply.
   * The list is filtered server-side by supplier (the list is
   * paginated); apply posts to the #7 endpoint, which needs no
   * idempotency key — it is a one-shot application, not a payment. */
  listSupplierPayments: async (params?: { supplierId?: string; page?: number; pageSize?: number }) => {
    const payload = await http<{ supplierPayments?: SupplierAdvanceRow[]; total?: number }>(
      `/api/supplier-payments${buildQueryString({ supplierId: params?.supplierId, page: params?.page, pageSize: params?.pageSize })}`,
    );
    return { supplierPayments: Array.isArray(payload.supplierPayments) ? payload.supplierPayments : [], total: Number(payload.total || 0) };
  },
  applySupplierAdvance: (id: string, payload: { amount: number; purchaseId?: number }) =>
    http<{ ok: boolean; appliedAmount?: number; remainingAdvance?: number }>(
      `/api/supplier-payments/${id}/apply-advance`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  listCustomersWithDebt: async (): Promise<Customer[]> => {
    const pageSize = 200;
    let page = 1;
    const rows: Customer[] = [];
    while (true) {
      const payload = await http<{ customers?: Customer[]; pagination?: { page: number; pageSize: number; totalPages: number } }>(`/api/customers?filter=debt&page=${page}&pageSize=${pageSize}`);
      rows.push(...(payload.customers || []));
      const totalPages = payload.pagination?.totalPages || 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return rows;
  },
};
