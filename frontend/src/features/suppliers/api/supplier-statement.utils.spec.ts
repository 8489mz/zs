/* INV-SUPPLIER-PAGE-BILL-STATEMENT: the supplier statement tab shows
 * every ledger row with date+time, what was brought (credit), what was
 * withdrawn (debit), and the running balance. An advance marker row
 * carries amount 0 — its cash lives in advanceAmount — so the mapper
 * must show the advance amount as the withdrawal (debit), never 0.
 * The mapper reads both the camelCase API shape and the snake_case
 * stored shape, like LedgerPanel does. */
import { describe, it, expect } from 'vitest';
import { mapSupplierStatementRow } from './supplier-statement.utils';

describe('mapSupplierStatementRow', () => {
  it('shows a supplier_advance marker row with its advance amount as the withdrawal', () => {
    const row = mapSupplierStatementRow({
      id: '11',
      type: 'supplier_advance',
      amount: 0,
      debit: 0,
      credit: 0,
      balanceAfter: 0,
      note: 'دفعة مقدمة إلى فري لانس',
      createdAt: '2026-11-15T10:30:00.000Z',
      advanceAmount: 1000,
    } as any);
    expect(row.type).toBe('supplier_advance');
    expect(row.typeLabel).toBe('سحبة / دفعة مقدمة');
    expect(row.debitShown).toBe(1000);
    expect(row.creditShown).toBe(0);
    expect(row.balance).toBe(0);
    expect(row.date).toBe('2026-11-15T10:30:00.000Z');
  });

  it('shows a supplier_bill row as brought (credit) with its balance after', () => {
    const row = mapSupplierStatementRow({
      id: '12',
      type: 'supplier_bill',
      amount: 5000,
      debit: 0,
      credit: 5000,
      balanceAfter: 5000,
      note: 'فاتورة مورد بدون مخزون SPB-261115-0001',
      createdAt: '2026-11-15T11:00:00.000Z',
    } as any);
    expect(row.typeLabel).toBe('فاتورة مورد بدون مخزون');
    expect(row.debitShown).toBe(0);
    expect(row.creditShown).toBe(5000);
    expect(row.balance).toBe(5000);
  });

  it('shows an ordinary settlement as a withdrawal of its amount', () => {
    const row = mapSupplierStatementRow({
      id: '13',
      type: 'supplier_payment',
      amount: -2000,
      debit: 2000,
      credit: 0,
      balanceAfter: 3000,
      note: 'دفع إلى مورد',
      createdAt: '2026-11-15T12:00:00.000Z',
    } as any);
    expect(row.typeLabel).toBe('سداد للمورد');
    expect(row.debitShown).toBe(2000);
    expect(row.creditShown).toBe(0);
    expect(row.balance).toBe(3000);
  });

  it('reads the snake_case stored shape too', () => {
    const row = mapSupplierStatementRow({
      id: '14',
      entry_type: 'supplier_advance_application',
      amount: -1500,
      balance_after: 3500,
      note: 'تطبيق دفعة مقدمة',
      created_at: '2026-11-15T13:00:00.000Z',
    } as any);
    expect(row.type).toBe('supplier_advance_application');
    expect(row.typeLabel).toBe('تطبيق دفعة مقدمة');
    expect(row.debitShown).toBe(1500);
    expect(row.creditShown).toBe(0);
    expect(row.balance).toBe(3500);
  });
});
