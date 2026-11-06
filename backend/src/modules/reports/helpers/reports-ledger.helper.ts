import { buildPagination, paginate } from './reports-range.helper';
import { toMoney } from './reports-math.helper';
import { type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import {
  buildCustomerBalanceRows,
  buildSupplierBalanceRows,
  filterCustomerBalanceRows,
  filterSupplierBalanceRows,
  summarizeCustomerBalanceRows,
  summarizeSupplierBalanceRows,
} from './reports-balances.helper';

export type CustomerBalanceSourceRow = {
  id: number | string;
  name?: string | null;
  phone?: string | null;
  balance?: number | string | null;
  credit_limit?: number | string | null;
};

export type SupplierBalanceSourceRow = {
  id: number | string;
  name?: string | null;
  phone?: string | null;
  balance?: number | string | null;
};

export type CustomerPartnerRow = {
  id: number | string;
  name?: string | null;
  phone?: string | null;
  balance?: number | string | null;
  credit_limit?: number | string | null;
};

export type SupplierPartnerRow = {
  id: number | string;
  name?: string | null;
  phone?: string | null;
  balance?: number | string | null;
};

export type PartnerLedgerEntryRow = {
  id?: number | string | null;
  entry_type?: string | null;
  amount?: number | string | null;
  balance_after?: number | string | null;
  note?: string | null;
  reference_type?: string | null;
  reference_id?: number | string | null;
  created_at?: string | Date | null;
};

export type LedgerSummaryRow = {
  debits_total?: number | string | null;
  credits_total?: number | string | null;
};

export function buildCustomerBalancesPayload(
  customers: CustomerBalanceSourceRow[],
  ledgerTotals: Map<string, number>,
  query: Record<string, unknown>,
  digits: MoneyDigits = 2,
) {
  const rows = filterCustomerBalanceRows(buildCustomerBalanceRows(customers, ledgerTotals, digits), query);
  const paged = paginate(rows, query as any, 20);

  return {
    customers: paged.rows,
    pagination: paged.pagination,
    summary: summarizeCustomerBalanceRows(rows, digits),
  };
}

export function buildSupplierBalancesPayload(
  suppliers: SupplierBalanceSourceRow[],
  ledgerTotals: Map<string, number>,
  query: Record<string, unknown>,
  digits: MoneyDigits = 2,
) {
  const rows = filterSupplierBalanceRows(buildSupplierBalanceRows(suppliers, ledgerTotals), query);
  const paged = paginate(rows, query as any, 20);

  return {
    suppliers: paged.rows,
    pagination: paged.pagination,
    summary: summarizeSupplierBalanceRows(rows, digits),
  };
}

export type LedgerDirection = 'customer' | 'supplier';

export function mapLedgerEntries(rows: PartnerLedgerEntryRow[], direction: LedgerDirection = 'customer') {
  return rows.map((row) => {
    const amount = Number(row.amount || 0);
    // INV-CUSTOMER-SUPPLIER-STATEMENTS: the two partner ledgers use
    // opposite sign conventions. A positive customer amount is a
    // charge (debit); a positive supplier amount is a purchase owed
    // (credit), and a supplier payment is a negative amount (debit).
    // Deriving debit/credit from the amount with the customer
    // convention for both made an unpaid credit purchase show a
    // phantom 1,000.00 payment in the supplier schedule (and in the
    // statement panel). The explicit debit/credit below is what the
    // frontend renders; the signed amount stays the source of truth.
    const debit = direction === 'supplier'
      ? (amount < 0 ? Math.abs(amount) : 0)
      : (amount > 0 ? amount : 0);
    const credit = direction === 'supplier'
      ? (amount > 0 ? amount : 0)
      : (amount < 0 ? Math.abs(amount) : 0);
    return {
      id: String(row.id ?? ''),
      type: row.entry_type || '',
      amount,
      debit,
      credit,
      balanceAfter: Number(row.balance_after || 0),
      note: row.note || '',
      referenceType: row.reference_type || '',
      referenceId: row.reference_id ? String(row.reference_id) : '',
      createdAt: row.created_at || '',
    };
  });
}

export function buildLedgerSummary(
  totalItems: number,
  totalsRow: LedgerSummaryRow | null | undefined,
  openingBalance?: number,
  digits: MoneyDigits = 2,
) {
  const totalDebits = toMoney(totalsRow?.debits_total ?? 0, digits);
  const totalCredits = Math.abs(toMoney(totalsRow?.credits_total ?? 0, digits));
  const base = {
    totalEntries: totalItems,
    totalDebits,
    totalCredits,
  };
  if (openingBalance !== undefined) {
    const openBal = toMoney(openingBalance, digits);
    return {
      ...base,
      openingBalance: openBal,
      closingBalance: toMoney(openBal + totalDebits - totalCredits, digits),
    };
  }
  return base;
}

export function buildCustomerLedgerPayload(args: {
  customer: CustomerPartnerRow;
  rows: PartnerLedgerEntryRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalsRow?: LedgerSummaryRow | null;
  openingBalance?: number;
  digits?: MoneyDigits;
}) {
  const { customer, rows, page, pageSize, totalItems, totalsRow, openingBalance, digits = 2 } = args;
  return {
    customer: {
      id: String(customer.id),
      name: customer.name || '',
      phone: customer.phone || '',
      balance: Number(customer.balance || 0),
      creditLimit: Number(customer.credit_limit || 0),
    },
    entries: mapLedgerEntries(rows),
    pagination: buildPagination(page, pageSize, totalItems),
    summary: buildLedgerSummary(totalItems, totalsRow, openingBalance, digits),
  };
}

export function buildSupplierLedgerPayload(args: {
  supplier: SupplierPartnerRow;
  rows: PartnerLedgerEntryRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalsRow?: LedgerSummaryRow | null;
  openingBalance?: number;
  digits?: MoneyDigits;
}) {
  const { supplier, rows, page, pageSize, totalItems, totalsRow, openingBalance, digits = 2 } = args;
  const summary = buildLedgerSummary(totalItems, totalsRow, openingBalance, digits);
  // INV-CUSTOMER-SUPPLIER-STATEMENTS: the raw totals are sums by
  // amount sign (positive = purchases, negative = payments). For a
  // supplier those are credits and debits respectively, so the two
  // labels are swapped; closingBalance is left as computed from the
  // raw amounts (opening + purchases - payments = final balance).
  const orientedSummary = { ...summary, totalDebits: summary.totalCredits, totalCredits: summary.totalDebits };
  return {
    supplier: {
      id: String(supplier.id),
      name: supplier.name || '',
      phone: supplier.phone || '',
      balance: Number(supplier.balance || 0),
    },
    entries: mapLedgerEntries(rows, 'supplier'),
    pagination: buildPagination(page, pageSize, totalItems),
    summary: orientedSummary,
  };
}
