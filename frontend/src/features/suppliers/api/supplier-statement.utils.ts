import type { SupplierLedgerEntry } from '@/types/domain';
import { formatLedgerEntryType } from '@/features/accounts';

export interface SupplierStatementRow {
  id: string;
  type: string;
  typeLabel: string;
  note: string;
  date: string;
  debitShown: number;
  creditShown: number;
  balance: number;
}

function readText(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function readNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') {
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
  }
  return null;
}

/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the statement tab shows what was
 * brought (credit), what was withdrawn (debit) and the running
 * balance. An advance marker row carries amount 0 — its cash lives
 * in advanceAmount — so it renders with the advance amount as the
 * withdrawal, never 0. The supplier sign convention (from the
 * backend mapLedgerEntries): a positive amount is brought (credit),
 * a negative amount is a withdrawal (debit). Reads both the
 * camelCase API shape and the snake_case stored shape. */
export function mapSupplierStatementRow(entry: SupplierLedgerEntry): SupplierStatementRow {
  const row = entry as unknown as Record<string, unknown>;
  const type = readText(row, ['entry_type', 'entryType', 'type']);
  const amount = readNumber(row, ['amount']) ?? 0;
  const debit = readNumber(row, ['debit']);
  const credit = readNumber(row, ['credit']);
  const advanceAmount = readNumber(row, ['advanceAmount', 'advance_amount']);
  const debitShown = type === 'supplier_advance' && advanceAmount != null
    ? advanceAmount
    : (debit ?? (amount < 0 ? Math.abs(amount) : 0));
  const creditShown = credit ?? (amount > 0 ? amount : 0);
  return {
    id: String(row.id ?? ''),
    type,
    typeLabel: formatLedgerEntryType(type, readText(row, ['note', 'description'])),
    note: readText(row, ['note', 'description']),
    date: readText(row, ['created_at', 'createdAt', 'date']),
    debitShown,
    creditShown,
    balance: readNumber(row, ['balance_after', 'balanceAfter']) ?? 0,
  };
}
