import { todayLocalDateKey } from '@/lib/format';
import type { SupplierPaymentScheduleItem } from '@/features/accounts/api/supplier-balance-schedule.api';

export function CheckCircleIcon({ size = 16, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

export function WhatsAppIcon({ size = 16, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function ChevronUpIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

export function EyeIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function todayIso() {
  return todayLocalDateKey();
}

export function statusLabel(status: string) {
  if (status === 'paid') return 'مدفوعة';
  if (status === 'partial') return 'مدفوعة جزئيًا';
  if (status === 'overdue') return 'متأخرة';
  if (status === 'cancelled') return 'ملغاة';
  return 'غير مدفوعة';
}

export function statusClass(status: string) {
  if (status === 'paid') return 'supplier-schedule-status supplier-schedule-status--paid';
  if (status === 'partial') return 'supplier-schedule-status supplier-schedule-status--partial';
  if (status === 'overdue') return 'supplier-schedule-status supplier-schedule-status--overdue';
  if (status === 'cancelled') return 'supplier-schedule-status supplier-schedule-status--cancelled';
  return 'supplier-schedule-status supplier-schedule-status--pending';
}

export function summarize(rows: SupplierPaymentScheduleItem[]) {
  return rows.reduce((acc, row) => ({
    total: acc.total + Number(row.amount || 0),
    paid: acc.paid + Number(row.paidAmount || 0),
    remaining: acc.remaining + Number(row.remainingAmount || 0),
    overdue: acc.overdue + (row.status === 'overdue' ? 1 : 0),
  }), { total: 0, paid: 0, remaining: 0, overdue: 0 });
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function formatLedgerDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

export function extractPurchaseId(entry: any): string | null {
  const refType = String(entry.referenceType || entry.reference_type || '');
  const refId = String(entry.referenceId || entry.reference_id || '');
  if ((refType === 'purchase' || refType === 'purchases' || !refType) && refId && /^\d+$/.test(refId)) {
    return refId;
  }
  const note = String(entry.note || entry.doc_no || '');
  const match = note.match(/P-(\d+)/i) || note.match(/فاتورة(?:\s+شراء|\s+مشتريات)?\s*(?:P-)?(\d+)/i);
  if (match && match[1]) {
    return match[1];
  }
  if (entry.doc_no && /^\d+$/.test(entry.doc_no)) {
    return entry.doc_no;
  }
  return null;
}
