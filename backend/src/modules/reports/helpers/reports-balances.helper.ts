import { paginate } from './reports-range.helper';
import { toMoney } from './reports-math.helper';
import { type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

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

export type CustomerBalanceRow = {
  id: string;
  name: string;
  phone: string;
  balance: number;
  creditLimit: number;
  availableCredit: number;
};

export type SupplierBalanceRow = {
  id: string;
  name: string;
  phone: string;
  balance: number;
};

function normalizeSearch(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function buildCustomerBalanceRows(
  customers: CustomerBalanceSourceRow[],
  ledgerTotals: Map<string, number>,
  digits: MoneyDigits = 2,
): CustomerBalanceRow[] {
  return customers.map((row) => {
    const derivedBalance = ledgerTotals.has(String(row.id))
      ? Number(ledgerTotals.get(String(row.id)) || 0)
      : Number(row.balance || 0);
    const creditLimit = Number(row.credit_limit || 0);

    return {
      id: String(row.id),
      name: row.name || '',
      phone: row.phone || '',
      balance: derivedBalance,
      creditLimit,
      availableCredit: toMoney(creditLimit - derivedBalance, digits),
    };
  });
}

export function filterCustomerBalanceRows(
  rows: CustomerBalanceRow[],
  options: { search?: unknown; filter?: unknown },
): CustomerBalanceRow[] {
  const search = normalizeSearch(options.search);
  const filter = normalizeSearch(options.filter || 'all');

  let filtered = rows.filter((row) => Number(row.balance || 0) > 0);

  if (search) {
    filtered = filtered.filter((row) =>
      [row.name, row.phone].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(search),
      ),
    );
  }

  if (filter === 'over-limit') {
    filtered = filtered.filter((row) => row.creditLimit > 0 && row.balance > row.creditLimit);
  }
  if (filter === 'high-balance') {
    filtered = filtered.filter((row) => row.balance >= 1000);
  }

  return filtered;
}

export function summarizeCustomerBalanceRows(rows: CustomerBalanceRow[], digits: MoneyDigits = 2) {
  return {
    totalItems: rows.length,
    totalBalance: toMoney(
      rows.reduce((sum, row) => sum + row.balance, 0),
      digits,
    ),
    overLimit: rows.filter((row) => row.creditLimit > 0 && row.balance > row.creditLimit).length,
  };
}

export function buildSupplierBalanceRows(
  suppliers: SupplierBalanceSourceRow[],
  ledgerTotals: Map<string, number>,
): SupplierBalanceRow[] {
  return suppliers.map((row) => ({
    id: String(row.id),
    name: row.name || '',
    phone: row.phone || '',
    balance: ledgerTotals.has(String(row.id))
      ? Number(ledgerTotals.get(String(row.id)) || 0)
      : Number(row.balance || 0),
  }));
}

export function filterSupplierBalanceRows(
  rows: SupplierBalanceRow[],
  options: { search?: unknown; filter?: unknown },
): SupplierBalanceRow[] {
  const search = normalizeSearch(options.search);
  const filter = normalizeSearch(options.filter || 'all');

  let filtered = rows.filter((row) => row.balance > 0);
  if (search) {
    filtered = filtered.filter((row) =>
      [row.name, row.phone].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(search),
      ),
    );
  }
  if (filter === 'high-balance') {
    filtered = filtered.filter((row) => row.balance >= 1000);
  }
  return filtered;
}

export function summarizeSupplierBalanceRows(rows: SupplierBalanceRow[], digits: MoneyDigits = 2) {
  return {
    totalItems: rows.length,
    totalBalance: toMoney(
      rows.reduce((sum, row) => sum + row.balance, 0),
      digits,
    ),
  };
}

export function paginateBalanceRows<T extends object>(rows: T[], query: any, fallbackPageSize = 20) {
  return paginate(rows, query, fallbackPageSize);
}
