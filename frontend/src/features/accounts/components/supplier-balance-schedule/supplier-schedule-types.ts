export type SupplierSubTab = 'invoices' | 'schedule';
export type ScheduleFilter = 'all' | 'pending' | 'partial' | 'paid' | 'overdue';
export type LedgerFilter = 'all' | 'purchases' | 'payments';

export const FILTER_OPTIONS: Array<{ key: ScheduleFilter; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'pending', label: 'غير مدفوعة' },
  { key: 'partial', label: 'جزئية' },
  { key: 'paid', label: 'مدفوعة' },
  { key: 'overdue', label: 'متأخرة' },
];

export function normalizeStatusForFilter(status: string): ScheduleFilter | 'cancelled' {
  if (status === 'paid') return 'paid';
  if (status === 'partial') return 'partial';
  if (status === 'overdue') return 'overdue';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}
