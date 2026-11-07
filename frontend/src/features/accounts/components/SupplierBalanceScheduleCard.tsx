import { useTranslation } from 'react-i18next';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { FormSection } from '@/shared/components/form-section';
import { Button } from '@/shared/ui/button';
import { ClipboardIcon, CalendarIcon } from '@/shared/components/icons/AppIcons';
import { Field } from '@/shared/ui/field';
import { CustomSelect } from '@/shared/ui/custom-select';
import { EmptyState } from '@/shared/ui/empty-state';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { accountsApi } from '@/features/accounts/api/accounts.api';
import { purchasesApi } from '@/features/purchases/api/purchases.api';
import { supplierBalanceScheduleApi, buildSettleSupplierPaymentSchedulePayload, type SupplierPaymentScheduleItem } from '@/features/accounts/api/supplier-balance-schedule.api';
import { readSupplierInstapayAddress } from '@/features/accounts/contracts';
import { formatCurrency, formatDateOnly, formatDateTimeArabic, formatWhatsAppNumber } from '@/lib/format';
import { openWhatsApp } from '@/lib/whatsapp';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import type { Purchase, Supplier, SupplierLedgerEntry } from '@/types/domain';

function CheckCircleIcon({ size = 16, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function WhatsAppIcon({ size = 16, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function ChevronDownIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronUpIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function EyeIcon({ size = 14, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(status: string) {
  if (status === 'paid') return 'مدفوعة';
  if (status === 'partial') return 'مدفوعة جزئيًا';
  if (status === 'overdue') return 'متأخرة';
  if (status === 'cancelled') return 'ملغاة';
  return 'غير مدفوعة';
}

function statusClass(status: string) {
  if (status === 'paid') return 'supplier-schedule-status supplier-schedule-status--paid';
  if (status === 'partial') return 'supplier-schedule-status supplier-schedule-status--partial';
  if (status === 'overdue') return 'supplier-schedule-status supplier-schedule-status--overdue';
  if (status === 'cancelled') return 'supplier-schedule-status supplier-schedule-status--cancelled';
  return 'supplier-schedule-status supplier-schedule-status--pending';
}

function summarize(rows: SupplierPaymentScheduleItem[]) {
  return rows.reduce((acc, row) => ({
    total: acc.total + Number(row.amount || 0),
    paid: acc.paid + Number(row.paidAmount || 0),
    remaining: acc.remaining + Number(row.remainingAmount || 0),
    overdue: acc.overdue + (row.status === 'overdue' ? 1 : 0),
  }), { total: 0, paid: 0, remaining: 0, overdue: 0 });
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatLedgerDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

function extractPurchaseId(entry: any): string | null {
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

function PurchaseItemsExpandable({ purchaseId, onSelectAmount }: { purchaseId: string; onSelectAmount?: (amount: number, invoiceDocNo: string) => void }) {
  const { t } = useTranslation();
  const { data: purchase, isLoading, error } = useQuery<Purchase>({
    queryKey: queryKeys.purchaseDetail(purchaseId),
    queryFn: () => purchasesApi.getById(purchaseId),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px', fontSize: '0.85rem', color: '#64748b' }}>
        {t('accounts.supplier_balance_schedule_card.s0', "جاري جلب تفاصيل وأصناف فاتورة المشتريات #")}{purchaseId}...
      </div>
    );
  }

  if (error || !purchase) {
    return (
      <div style={{ padding: '12px', background: '#fef2f2', borderRadius: '6px', fontSize: '0.85rem', color: '#b91c1c' }}>
        {t('accounts.supplier_balance_schedule_card.s1', "تعذر تحميل تفاصيل فاتورة المشتريات #")}{purchaseId}
      </div>
    );
  }

  const items = purchase.items || [];
  const total = Number(purchase.total || 0);
  const docNumber = purchase.docNo || `P-${purchase.id}`;

  return (
    <div style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', margin: '6px 0 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <strong style={{ fontSize: '0.88rem', color: '#0f172a' }}>
            {t('accounts.supplier_balance_schedule_card.s2', "أصناف فاتورة المشتريات:")} {docNumber}
          </strong>
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
            ({items.length} {t('accounts.supplier_balance_schedule_card.s3', "أصناف)")}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.82rem' }}>
          <span>{t('accounts.supplier_balance_schedule_card.s4', "إجمالي الفاتورة:")} <b>{formatCurrency(total)}</b></span>
          <span>{t('accounts.supplier_balance_schedule_card.s5', "طريقة الدفع:")} <b>{purchase.paymentType === 'credit' ? t('accounts.supplier_balance_schedule_card.s6', "آجل") : t('accounts.supplier_balance_schedule_card.s7', "نقدي")}</b></span>
          {total > 0 && onSelectAmount ? (
            <button
              type="button"
              onClick={() => onSelectAmount(total, docNumber)}
              style={{
                background: '#eff6ff',
                color: '#2563eb',
                border: '1px solid #bfdbfe',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '0.76rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {t('accounts.supplier_balance_schedule_card.s8', "سداد قيمة هذه الفاتورة (")}{formatCurrency(total)})
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', background: '#ffffff', borderRadius: '6px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#f1f5f9', color: '#475569', textAlign: 'right' }}>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s9', "الصنف")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s10', "الوحدة")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s11', "الكمية")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s12', "سعر الشراء")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s13', "الإجمالي")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, idx: number) => {
              const name = item.productName || item.name || item.product?.name || t('accounts.supplier_balance_schedule_card.s14', "صنف");
              const unit = item.unitName || item.unit || '—';
              const qty = Number(item.qty || item.quantity || 1);
              const price = Number(item.costPrice ?? item.price ?? item.unitCost ?? 0);
              const lineTotal = Number(item.lineTotal ?? item.total ?? (qty * price));
              return (
                <tr key={item.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600, color: '#1e293b' }}>{name}</td>
                  <td style={{ padding: '6px 10px', color: '#64748b' }}>{unit}</td>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{qty}</td>
                  <td style={{ padding: '6px 10px', color: '#475569' }}>{formatCurrency(price)}</td>
                  <td style={{ padding: '6px 10px', fontWeight: 700, color: '#0f172a' }}>{formatCurrency(lineTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type SupplierSubTab = 'invoices' | 'schedule';
type ScheduleFilter = 'all' | 'pending' | 'partial' | 'paid' | 'overdue';
type LedgerFilter = 'all' | 'purchases' | 'payments';

const FILTER_OPTIONS: Array<{ key: ScheduleFilter; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'pending', label: 'غير مدفوعة' },
  { key: 'partial', label: 'جزئية' },
  { key: 'paid', label: 'مدفوعة' },
  { key: 'overdue', label: 'متأخرة' },
];

function normalizeStatusForFilter(status: string): ScheduleFilter | 'cancelled' {
  if (status === 'paid') return 'paid';
  if (status === 'partial') return 'partial';
  if (status === 'overdue') return 'overdue';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}

interface SupplierBalanceScheduleCardProps {
  supplier: Supplier | null;
  disabled?: boolean;
}

export function SupplierBalanceScheduleCard({ supplier, disabled = false }: SupplierBalanceScheduleCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useSettingsQuery();
  const supplierId = String(supplier?.id || '');
  const supplierName = String(supplier?.name || 'المورد');
  const supplierBalance = Number(supplier?.balance || 0);

  const [activeSubTab, setActiveSubTab] = useState<SupplierSubTab>('invoices');

  // Ledger & Invoices state
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>('all');
  const [expandedPurchaseIds, setExpandedPurchaseIds] = useState<Record<string, boolean>>({});
  const [directPaymentAmount, setDirectPaymentAmount] = useState('');
  const [directPaymentNote, setDirectPaymentNote] = useState('');
  const [directPaymentChannel, setDirectPaymentChannel] = useState<'cash'|'bank'|'card'|'wallet'|'instapay'>('cash');
  /* INV-INSTAPAY-FIELD-MISSING: the supplier InstaPay account number
   * (IPA) a direct payment was sent to; sent only when the channel is
   * InstaPay. */
  const [directPaymentInstapayAddress, setDirectPaymentInstapayAddress] = useState('');
  const [schedulePaymentChannel, setSchedulePaymentChannel] = useState<'cash'|'bank'|'card'|'wallet'|'instapay'>('cash');
  /* INV-INSTAPAY-FIELD-MISSING: the supplier InstaPay account number
   * (IPA) an installment settlement was sent to. */
  const [schedulePaymentInstapayAddress, setSchedulePaymentInstapayAddress] = useState('');
  const [directSuccessReceipt, setDirectSuccessReceipt] = useState<{
    amountPaid: number;
    remainingBalance: number;
    note?: string;
  } | null>(null);

  // Schedule state
  const [mode, setMode] = useState<'count' | 'amount'>('count');
  const [scheduleAmount, setScheduleAmount] = useState('');
  const [installmentCount, setInstallmentCount] = useState('3');
  const [installmentAmount, setInstallmentAmount] = useState('');
  const [firstDueDate, setFirstDueDate] = useState(todayIso());
  const [intervalDays, setIntervalDays] = useState('7');
  const [roundingStep, setRoundingStep] = useState('100');
  const [note, setNote] = useState('');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [paymentTarget, setPaymentTarget] = useState<SupplierPaymentScheduleItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>('all');
  const [showAppendForm, setShowAppendForm] = useState(false);
  const [successReceipt, setSuccessReceipt] = useState<{ row: SupplierPaymentScheduleItem; amountPaid: number; remainingBalance: number; note?: string } | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((paymentTarget || successReceipt || directSuccessReceipt) && (event.key === 'Escape' || event.key === 'Esc')) {
        event.preventDefault();
        setPaymentTarget(null);
        setSuccessReceipt(null);
        setDirectSuccessReceipt(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [paymentTarget, successReceipt, directSuccessReceipt]);

  /* INV-INSTAPAY-FIELD-MISSING: when InstaPay is picked for a direct
   * payment, prefill the IPA saved on the supplier record — once per
   * switch to InstaPay and only into an empty field, never over a value
   * the merchant typed or deliberately cleared. */
  const prevDirectChannelRef = useRef<'cash'|'bank'|'card'|'wallet'|'instapay'>('cash');
  useEffect(() => {
    const prev = prevDirectChannelRef.current;
    prevDirectChannelRef.current = directPaymentChannel;
    if (directPaymentChannel === 'instapay' && prev !== 'instapay' && !directPaymentInstapayAddress.trim()) {
      const saved = readSupplierInstapayAddress(supplier);
      if (saved) setDirectPaymentInstapayAddress(saved);
    }
  }, [directPaymentChannel, directPaymentInstapayAddress, supplier]);

  function refreshAccounts() {
    queryClient.invalidateQueries({ queryKey: queryKeys.supplierBalances });
    queryClient.invalidateQueries({ queryKey: queryKeys.suppliers });
    queryClient.invalidateQueries({ queryKey: queryKeys.treasury });
    queryClient.invalidateQueries({ queryKey: queryKeys.cashierShifts });
    if (supplierId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.supplierLedger(supplierId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.supplierPaymentSchedule(supplierId) });
    }
  }

  // Supplier Ledger Query
  const ledgerQuery = useQuery({
    queryKey: queryKeys.supplierLedger(supplierId),
    queryFn: () => accountsApi.supplierLedger(supplierId),
    enabled: Boolean(supplierId),
  });

  const ledgerEntries: SupplierLedgerEntry[] = useMemo(() => {
    return ledgerQuery.data?.entries || [];
  }, [ledgerQuery.data]);

  const filteredLedgerEntries = useMemo(() => {
    return ledgerEntries.filter((entry: any) => {
      const amt = Number(entry.amount ?? (Number(entry.credit || 0) > 0 ? entry.credit : -Number(entry.debit || 0)));
      const credit = amt > 0 ? amt : Number(entry.credit || 0);
      const debit = amt < 0 ? Math.abs(amt) : Number(entry.debit || 0);
      const purchaseId = extractPurchaseId(entry);
      const isPurchase = Boolean(purchaseId) || credit > 0 || String(entry.note || '').includes('فاتورة');
      const isPayment = debit > 0 || String(entry.note || '').includes('سداد') || String(entry.note || '').includes('صرف');
      if (ledgerFilter === 'purchases') return isPurchase;
      if (ledgerFilter === 'payments') return isPayment;
      return true;
    });
  }, [ledgerEntries, ledgerFilter]);

  function togglePurchaseDetails(purchaseId: string) {
    setExpandedPurchaseIds((prev) => ({ ...prev, [purchaseId]: !prev[purchaseId] }));
  }

  function handleSelectInvoiceAmount(amount: number, invoiceDocNo?: string) {
    setDirectPaymentAmount(String(amount));
    if (invoiceDocNo) {
      setDirectPaymentNote(`سداد فاتورة مشتريات رقم ${invoiceDocNo}`);
    }
  }

  // Direct Supplier Payment Mutation
  const directPaymentMutation = useMutation({
    mutationFn: () => {
      if (!supplier) throw new Error('اختر المورد أولًا');
      const amount = Number(directPaymentAmount || 0);
      if (!(amount > 0)) throw new Error('المبلغ المدفوع يجب أن يكون أكبر من الصفر');
      return accountsApi.supplierPaymentCreate({
        supplierId: Number(supplier.id),
        amount,
        paymentChannel: directPaymentChannel,
        instapayAddress: directPaymentChannel === 'instapay' ? directPaymentInstapayAddress.trim() : undefined,
        note: directPaymentNote || `صرف مستحقات للمورد ${supplierName}`,
      });
    },
    onSuccess: () => {
      const amountPaid = Number(directPaymentAmount || 0);
      const newRemaining = Math.max(0, supplierBalance - amountPaid);

      setDirectSuccessReceipt({
        amountPaid,
        remainingBalance: newRemaining,
        note: directPaymentNote || 'صرف نقدي من الرصيد العام',
      });

      refreshAccounts();
      setDirectPaymentAmount('');
      setDirectPaymentNote('');
      setDirectPaymentInstapayAddress('');
    },
  });

  // Schedule Query & Mutations
  const scheduleQuery = useQuery({
    queryKey: queryKeys.supplierPaymentSchedule(supplierId),
    queryFn: () => supplierBalanceScheduleApi.list(supplierId),
    enabled: Boolean(supplierId),
  });

  const createMutation = useMutation({
    mutationFn: () => supplierBalanceScheduleApi.create(supplierId, {
      mode,
      scheduleAmount: Number(scheduleAmount || (supplierBalance - summary.remaining) || 0),
      installmentCount: mode === 'count' ? Number(installmentCount || 0) : undefined,
      installmentAmount: mode === 'amount' ? Number(installmentAmount || 0) : undefined,
      firstDueDate,
      intervalDays: Number(intervalDays || 1),
      roundingStep: Number(roundingStep || 1),
      note,
    }),
    onSuccess: (nextRows) => {
      queryClient.setQueryData(queryKeys.supplierPaymentSchedule(supplierId), nextRows);
      refreshAccounts();
      setShowAppendForm(false);
      setScheduleAmount('');
      setNote('');
    },
  });

  const settleMutation = useMutation({
    mutationFn: ({ row, amount, paymentNote: noteText }: { row: SupplierPaymentScheduleItem; amount?: number; paymentNote?: string }) => supplierBalanceScheduleApi.settle(row.id, buildSettleSupplierPaymentSchedulePayload({
      amount,
      paymentChannel: schedulePaymentChannel,
      instapayAddress: schedulePaymentInstapayAddress,
      note: noteText || `تسجيل دفع دفعة ${row.installmentNo} من مستحقات ${supplierName}`,
    }), String(row.supplierId)),
    onSuccess: (nextRows, variables) => {
      queryClient.setQueryData(queryKeys.supplierPaymentSchedule(supplierId), nextRows);
      refreshAccounts();
      const nextRemaining = summarize(nextRows).remaining;
      setSuccessReceipt({
        row: variables.row,
        amountPaid: variables.amount || variables.row.remainingAmount || 0,
        remainingBalance: nextRemaining,
        note: variables.paymentNote || '',
      });
      setPaymentTarget(null);
      setPaymentAmount('');
      setPaymentNote('');
      setSchedulePaymentInstapayAddress('');
    },
  });

  const rows = useMemo(() => scheduleQuery.data || [], [scheduleQuery.data]);
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (scheduleFilter === 'all') return true;
    return normalizeStatusForFilter(row.status) === scheduleFilter;
  }), [rows, scheduleFilter]);
  const filterCounts = useMemo(() => rows.reduce<Record<ScheduleFilter, number>>((acc, row) => {
    acc.all += 1;
    const status = normalizeStatusForFilter(row.status);
    if (status !== 'cancelled') acc[status] += 1;
    return acc;
  }, { all: 0, pending: 0, partial: 0, paid: 0, overdue: 0 }), [rows]);
  const summary = useMemo(() => summarize(rows), [rows]);
  
  const unscheduledBalance = Math.round((supplierBalance - summary.remaining) * 100) / 100;
  const canSchedule = Boolean(supplierId) && unscheduledBalance > 0 && !disabled;
  const nextDue = rows.find((row) => row.status !== 'paid' && row.status !== 'cancelled');

  function openPaymentDialog(row: SupplierPaymentScheduleItem) {
    setPaymentTarget(row);
    setPaymentAmount(String(row.remainingAmount || row.amount || ''));
    setPaymentNote('');
    /* INV-INSTAPAY-FIELD-MISSING: a fresh settlement dialog starts
     * from the IPA saved on the supplier record. */
    setSchedulePaymentInstapayAddress(readSupplierInstapayAddress(supplier));
  }

  function toggleRow(rowId: string) {
    setExpandedRows((current) => ({ ...current, [rowId]: !current[rowId] }));
  }

  if (!supplier) {
    return (
      <FormSection title={t('accounts.supplier_balance_schedule_card.s15', "مستحقات وحساب المورد")} description={t('accounts.supplier_balance_schedule_card.s16', "اختر موردًا أولًا لعرض فواتيره أو جدول دفعاته.")}>
        <EmptyState title={t('accounts.supplier_balance_schedule_card.s17', "لم يتم اختيار مورد")} hint={t('accounts.supplier_balance_schedule_card.s18', "اختر المورد من القائمة بالأعلى لعرض كشف حسابه وفواتيره.")} />
      </FormSection>
    );
  }

  return (
    <div className="supplier-balance-schedule-card">
      <FormSection
        title={`مستحقات وحساب المورد: ${supplierName}`}
        description={t('accounts.supplier_balance_schedule_card.s19', "استعرض فواتير المشتريات وتفاصيل الأصناف وسداد المستحقات أو قسّم المديونية لدفعات مجدولة.")}
        actions={
          <div className="actions compact-actions">
            <span className="nav-pill" style={{ background: supplierBalance > 0 ? '#fef2f2' : '#f0fdf4', color: supplierBalance > 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>
              {t('accounts.supplier_balance_schedule_card.s20', "المستحق:")} {formatCurrency(supplierBalance)}
            </span>
          </div>
        }
      >
        {/* Top Summary Stats */}
        <div className="stats-grid compact-grid" style={{ marginBottom: '14px' }}>
          <div className="stat-card">
            <span>{t('accounts.supplier_balance_schedule_card.s21', "رصيد المورد المستحق")}</span>
            <strong style={{ color: supplierBalance > 0 ? '#dc2626' : '#16a34a' }}>
              {formatCurrency(supplierBalance)}
            </strong>
          </div>
          <div className="stat-card">
            <span>{t('accounts.supplier_balance_schedule_card.s22', "إجمالي المجدول")}</span>
            <strong>{formatCurrency(summary.total)}</strong>
          </div>
          <div className="stat-card">
            <span>{t('accounts.supplier_balance_schedule_card.s23', "مدفوع من الجدول")}</span>
            <strong>{formatCurrency(summary.paid)}</strong>
          </div>
          <div className="stat-card">
            <span>{t('accounts.supplier_balance_schedule_card.s24', "متبقي مجدول")}</span>
            <strong>{formatCurrency(summary.remaining)}</strong>
          </div>
        </div>

        {/* Sub-Tabs Switcher */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
          <Button
            type="button"
            variant={activeSubTab === 'invoices' ? 'primary' : 'secondary'}
            onClick={() => setActiveSubTab('invoices')}
            style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <ClipboardIcon size={16} /> {t('accounts.supplier_balance_schedule_card.s25', "فواتير المشتريات والمعاملات (")}{ledgerEntries.length})
          </Button>
          <Button
            type="button"
            variant={activeSubTab === 'schedule' ? 'primary' : 'secondary'}
            onClick={() => setActiveSubTab('schedule')}
            style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <CalendarIcon size={16} /> {t('accounts.supplier_balance_schedule_card.s26', "جدول الأقساط والدفعات (")}{rows.length})
          </Button>
        </div>

        {/* SUB-TAB 1: Invoices & Ledger View */}
        {activeSubTab === 'invoices' ? (
          <div>
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <strong style={{ fontSize: '0.92rem', color: '#1e293b' }}>{t('accounts.supplier_balance_schedule_card.s27', "سجل فواتير المشتريات والمعاملات")}</strong>
                  {ledgerQuery.isLoading ? <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{t('accounts.supplier_balance_schedule_card.s28', "(جاري التحميل...)")}</span> : null}
                </div>
                <div className="actions compact-actions">
                  <Button
                    type="button"
                    variant={ledgerFilter === 'all' ? 'primary' : 'secondary'}
                    onClick={() => setLedgerFilter('all')}
                  >
                    {t('accounts.supplier_balance_schedule_card.s29', "الكل (")}{ledgerEntries.length})
                  </Button>
                  <Button
                    type="button"
                    variant={ledgerFilter === 'purchases' ? 'primary' : 'secondary'}
                    onClick={() => setLedgerFilter('purchases')}
                  >
                    {t('accounts.supplier_balance_schedule_card.s30', "فواتير الشراء")}
                  </Button>
                  <Button
                    type="button"
                    variant={ledgerFilter === 'payments' ? 'primary' : 'secondary'}
                    onClick={() => setLedgerFilter('payments')}
                  >
                    {t('accounts.supplier_balance_schedule_card.s31', "سندات الصرف")}
                  </Button>
                </div>
              </div>

              {filteredLedgerEntries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 12px', color: '#64748b', fontSize: '0.85rem' }}>
                  {ledgerQuery.isLoading ? t('accounts.supplier_balance_schedule_card.s32', "جاري تحميل كشف الحساب...") : t('accounts.supplier_balance_schedule_card.s33', "لا توجد حركات مسجلة لهذا المورد في هذه التصفية.")}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '2px solid #e2e8f0', textAlign: 'right' }}>
                        <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s34', "التاريخ")}</th>
                        <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s35', "نوع الحركة / البيان")}</th>
                        <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s36', "دائن (فاتورة شراء)")}</th>
                        <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s37', "مدين (صرف وسداد)")}</th>
                        <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.supplier_balance_schedule_card.s38', "الرصيد بعد الحركة")}</th>
                        <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'center' }}>{t('accounts.supplier_balance_schedule_card.s39', "الأصناف")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLedgerEntries.map((entry: any, index: number) => {
                        const purchaseId = extractPurchaseId(entry);
                        const isExpanded = Boolean(purchaseId && expandedPurchaseIds[purchaseId]);
                        const amt = Number(entry.amount ?? (Number(entry.credit || 0) > 0 ? entry.credit : -Number(entry.debit || 0)));
                        const credit = amt > 0 ? amt : Number(entry.credit || 0);
                        const debit = amt < 0 ? Math.abs(amt) : Number(entry.debit || 0);
                        const balanceAfter = entry.balanceAfter != null ? Number(entry.balanceAfter) : (entry.balance_after != null ? Number(entry.balance_after) : null);
                        const dateValue = entry.createdAt || entry.created_at || entry.date;
                        const isPurchase = Boolean(purchaseId) || credit > 0 || String(entry.note || '').includes(t('accounts.supplier_balance_schedule_card.s40', "فاتورة"));

                        return (
                          <Fragment key={entry.id || entry.doc_no || index}>
                            <tr
                              style={{
                                borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9',
                                background: isExpanded ? '#f8fafc' : (index % 2 === 0 ? '#ffffff' : '#fafafa'),
                                cursor: purchaseId ? 'pointer' : 'default',
                              }}
                              onClick={() => {
                                if (purchaseId) togglePurchaseDetails(purchaseId);
                              }}
                            >
                              <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>
                                {formatLedgerDate(dateValue)}
                              </td>
                              <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1e293b' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span>{entry.note || entry.doc_no || (isPurchase ? t('accounts.supplier_balance_schedule_card.s41', "فاتورة مشتريات") : t('accounts.supplier_balance_schedule_card.s42', "سداد/صرف"))}</span>
                                  {purchaseId ? (
                                    <span style={{ fontSize: '0.72rem', background: '#eff6ff', color: '#2563eb', padding: '1px 5px', borderRadius: '4px' }}>
                                      #{purchaseId}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td style={{ padding: '8px 10px', fontWeight: 700, color: credit > 0 ? '#dc2626' : '#94a3b8' }}>
                                {credit > 0 ? formatCurrency(credit) : '—'}
                              </td>
                              <td style={{ padding: '8px 10px', fontWeight: 700, color: debit > 0 ? '#16a34a' : '#94a3b8' }}>
                                {debit > 0 ? formatCurrency(debit) : '—'}
                              </td>
                              <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                                {balanceAfter != null ? formatCurrency(balanceAfter) : '—'}
                              </td>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                {purchaseId ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      togglePurchaseDetails(purchaseId);
                                    }}
                                    style={{
                                      background: isExpanded ? '#1e293b' : '#ffffff',
                                      color: isExpanded ? '#ffffff' : '#1e293b',
                                      border: '1px solid #cbd5e1',
                                      borderRadius: '4px',
                                      padding: '3px 8px',
                                      fontSize: '0.75rem',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                    }}
                                  >
                                    <EyeIcon size={13} />
                                    {isExpanded ? t('accounts.supplier_balance_schedule_card.s43', "إخفاء") : t('accounts.supplier_balance_schedule_card.s44', "عرض الأصناف")}
                                    {isExpanded ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                                  </button>
                                ) : (
                                  <span style={{ color: '#cbd5e1' }}>—</span>
                                )}
                              </td>
                            </tr>

                            {isExpanded && purchaseId ? (
                              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                <td colSpan={6} style={{ padding: '0 10px 10px' }}>
                                  <PurchaseItemsExpandable
                                    purchaseId={purchaseId}
                                    onSelectAmount={handleSelectInvoiceAmount}
                                  />
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Direct Payment Panel */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
              <strong style={{ display: 'block', marginBottom: '10px', fontSize: '0.94rem', color: '#0f172a' }}>
                {t('accounts.supplier_balance_schedule_card.s45', "تسجيل صرف وسداد مستحقات للمورد")} {supplierName}
              </strong>

              <div className="form-grid">
                <Field label={`المبلغ المدفوع للمورد (${getGlobalCurrencySymbol()})`}>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={directPaymentAmount}
                    onChange={(event) => setDirectPaymentAmount(event.target.value)}
                    placeholder={`مثال: ${supplierBalance > 0 ? supplierBalance : '0.00'}`}
                    disabled={directPaymentMutation.isPending || disabled}
                  />
                  <div className="customer-quick-amount-shortcuts" style={{ marginTop: '6px' }}>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setDirectPaymentAmount(String(supplierBalance > 0 ? supplierBalance : ''))}
                      disabled={directPaymentMutation.isPending || disabled || supplierBalance <= 0}
                    >
                      {t('accounts.supplier_balance_schedule_card.s46', "سداد كامل الرصيد المستحق (")}{formatCurrency(supplierBalance)})
                    </Button>
                  </div>
                </Field>

                <Field label="وسيلة السداد">
                  <select value={directPaymentChannel} onChange={e => setDirectPaymentChannel(e.target.value as typeof directPaymentChannel)} disabled={directPaymentMutation.isPending || disabled}>
                    <option value="cash">نقدي (درج الكاشير)</option>
                    <option value="bank">تحويل بنكي</option>
                    <option value="card">بطاقة</option>
                    <option value="wallet">محفظة إلكترونية</option>
                    <option value="instapay">إنستاباي</option>
                  </select>
                </Field>
                {directPaymentChannel === 'instapay' && (
                  <Field label={t('accounts.supplier_balance_schedule_card.s113', "رقم حساب إنستاباي (IPA)")}>
                    <input
                      type="text"
                      value={directPaymentInstapayAddress}
                      onChange={(event) => setDirectPaymentInstapayAddress(event.target.value)}
                      placeholder={t('accounts.supplier_balance_schedule_card.s114', "مثال: name@instapay")}
                      disabled={directPaymentMutation.isPending || disabled}
                    />
                  </Field>
                )}
                <Field label={t('accounts.supplier_balance_schedule_card.s47', "ملاحظات الصرف (اختياري)")}>
                  <textarea
                    rows={2}
                    value={directPaymentNote}
                    onChange={(event) => setDirectPaymentNote(event.target.value)}
                    placeholder={t('accounts.supplier_balance_schedule_card.s48', "مثال: تم التسليم نقداً لمندوب المورد / سداد فاتورة مشتريات محددة")}
                    disabled={directPaymentMutation.isPending || disabled}
                  />
                </Field>
              </div>

              <div className="actions compact-actions supplier-payment-dialog-actions" style={{ marginTop: '12px' }}>
                <Button
                  type="button"
                  onClick={() => directPaymentMutation.mutate()}
                  disabled={directPaymentMutation.isPending || !(Number(directPaymentAmount) > 0) || disabled}
                >
                  {directPaymentMutation.isPending ? t('accounts.supplier_balance_schedule_card.s49', "جاري تسجيل الدفع...") : t('accounts.supplier_balance_schedule_card.s50', "تأكيد صرف المبلغ للمورد")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setDirectPaymentAmount('');
                    setDirectPaymentNote('');
                    setDirectPaymentInstapayAddress('');
                  }}
                  disabled={directPaymentMutation.isPending}
                >
                  {t('accounts.supplier_balance_schedule_card.s51', "إعادة ضبط")}
                </Button>
              </div>

              <MutationFeedback
                isError={directPaymentMutation.isError}
                isSuccess={false}
                error={directPaymentMutation.error}
                errorFallback={t('accounts.supplier_balance_schedule_card.s52', "تعذر تسجيل صرف المبلغ للمورد")}
                successText=""
              />
            </div>
          </div>
        ) : (
          /* SUB-TAB 2: Schedule View */
          <div>
            {nextDue ? (
              <div className="supplier-schedule-next-payment">
                <div>
                  <span>{t('accounts.supplier_balance_schedule_card.s53', "الدفعة القادمة إلى")} {supplierName}</span>
                  <strong>{formatCurrency(nextDue.remainingAmount || nextDue.amount)}</strong>
                  <small>{t('accounts.supplier_balance_schedule_card.s54', "تستحق في")} {formatDateOnly(nextDue.dueDate)}</small>
                </div>
                <Button type="button" variant="secondary" disabled={disabled || settleMutation.isPending} onClick={() => openPaymentDialog(nextDue)}>{t('accounts.supplier_balance_schedule_card.s55', "تسجيل دفع")}</Button>
              </div>
            ) : null}

            {canSchedule && (!rows.length || showAppendForm) ? (
              <div className="form-grid" style={{ marginTop: 12 }}>
                <Field label={t('accounts.supplier_balance_schedule_card.s56', "المبلغ المراد جدولته")}>
                  <input type="number" min="1" max={unscheduledBalance} step="0.01" value={scheduleAmount} onChange={(event) => setScheduleAmount(event.target.value)} placeholder={String(unscheduledBalance || '')} />
                </Field>
                <Field label={t('accounts.supplier_balance_schedule_card.s57', "طريقة التقسيم")}>
                  <CustomSelect
                    value={mode}
                    onChange={(val) => setMode(val as 'count' | 'amount')}
                    options={[
                      { value: 'count', label: t('accounts.supplier_balance_schedule_card.s58', "حسب عدد الدفعات") },
                      { value: 'amount', label: t('accounts.supplier_balance_schedule_card.s59', "حسب مبلغ الدفعة") },
                    ]}
                  />
                </Field>
                {mode === 'count' ? (
                  <Field label={t('accounts.supplier_balance_schedule_card.s60', "عدد الدفعات")}><input type="number" min="1" value={installmentCount} onChange={(event) => setInstallmentCount(event.target.value)} /></Field>
                ) : (
                  <Field label={t('accounts.supplier_balance_schedule_card.s61', "مبلغ كل دفعة")}><input type="number" min="1" step="0.01" value={installmentAmount} onChange={(event) => setInstallmentAmount(event.target.value)} /></Field>
                )}
                <Field label={t('accounts.supplier_balance_schedule_card.s62', "تاريخ أول دفعة")}><input type="date" value={firstDueDate} onChange={(event) => setFirstDueDate(event.target.value)} /></Field>
                <Field label={t('accounts.supplier_balance_schedule_card.s63', "تكرار الاستحقاق كل كام يوم")}><input type="number" min="1" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} /></Field>
                <Field label={t('accounts.supplier_balance_schedule_card.s64', "تقريب الدفعات لأقرب")}><input type="number" min="1" value={roundingStep} onChange={(event) => setRoundingStep(event.target.value)} /></Field>
                <Field label={t('accounts.supplier_balance_schedule_card.s65', "ملاحظة")}><input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('accounts.supplier_balance_schedule_card.s66', "مثال: اتفاق سداد رصيد المورد")} /></Field>
                <div className="field"><span>{t('accounts.supplier_balance_schedule_card.s67', "إنشاء الجدول")}</span><Button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>{t('accounts.supplier_balance_schedule_card.s68', "جدولة المستحقات")}</Button></div>
              </div>
            ) : null}

            {canSchedule && rows.length && !showAppendForm ? (
              <div className="surface-note" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('accounts.supplier_balance_schedule_card.s69', "يوجد رصيد غير مجدول بقيمة")} {formatCurrency(unscheduledBalance)}{t('accounts.supplier_balance_schedule_card.s70', ". يمكنك إضافته كدفعات إضافية.")}</span>
                <Button type="button" variant="secondary" onClick={() => setShowAppendForm(true)}>{t('accounts.supplier_balance_schedule_card.s71', "إضافة دفعات للرصيد المتبقي")}</Button>
              </div>
            ) : null}

            {!canSchedule && supplierBalance <= 0 ? <div className="surface-note">{t('accounts.supplier_balance_schedule_card.s72', "لا توجد مستحقات موجبة على هذا المورد يمكن جدولتها حاليًا.")}</div> : null}
            {!canSchedule && supplierBalance > 0 && unscheduledBalance <= 0 ? <div className="surface-note">{t('accounts.supplier_balance_schedule_card.s73', "تمت جدولة جميع مستحقات هذا المورد بالكامل.")}</div> : null}

            <MutationFeedback isError={createMutation.isError || settleMutation.isError} isSuccess={createMutation.isSuccess || settleMutation.isSuccess} error={createMutation.error || settleMutation.error} errorFallback={((createMutation.error as any)?.message) || ((settleMutation.error as any)?.message) || t('accounts.supplier_balance_schedule_card.s74', "تعذر تنفيذ عملية جدولة المورد")} successText={t('accounts.supplier_balance_schedule_card.s75', "تم تحديث جدول مستحقات المورد.")} />

            {rows.length ? (
              <div className="supplier-schedule-filter-bar" aria-label={t('accounts.supplier_balance_schedule_card.s76', "فلترة دفعات المورد")} style={{ marginTop: 16 }}>
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`supplier-schedule-filter-chip ${scheduleFilter === option.key ? 'supplier-schedule-filter-chip--active' : ''}`}
                    onClick={() => setScheduleFilter(option.key)}
                  >
                    {option.label}
                    <span>{filterCounts[option.key]}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="table-wrap supplier-schedule-table-wrap" style={{ marginTop: 12 }}>
              {filteredRows.length ? (
                <table className="supplier-schedule-table">
                  <thead><tr><th>#</th><th>{t('accounts.supplier_balance_schedule_card.s77', "الاستحقاق")}</th><th>{t('accounts.supplier_balance_schedule_card.s78', "المبلغ")}</th><th>{t('accounts.supplier_balance_schedule_card.s79', "المدفوع")}</th><th>{t('accounts.supplier_balance_schedule_card.s80', "المتبقي")}</th><th>{t('accounts.supplier_balance_schedule_card.s81', "الحالة")}</th><th>{t('accounts.supplier_balance_schedule_card.s82', "الإجراء")}</th></tr></thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const isSettled = row.status === 'paid' || row.status === 'cancelled';
                      const payments = row.payments || [];
                      const isExpanded = Boolean(expandedRows[row.id]);
                      return (
                        <Fragment key={row.id}>
                          <tr
                            className={`supplier-schedule-row ${isExpanded ? 'supplier-schedule-row--expanded' : ''}`}
                            tabIndex={0}
                            onClick={() => toggleRow(row.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                toggleRow(row.id);
                              }
                            }}
                          >
                            <td>
                              <span className="supplier-schedule-installment-label">{t('accounts.supplier_balance_schedule_card.s83', "دفعة")} {row.installmentNo} {isExpanded ? '▴' : '▾'}</span>
                            </td>
                            <td>{formatDateOnly(row.dueDate)}</td>
                            <td>{formatCurrency(row.amount)}</td>
                            <td className="muted">{formatCurrency(row.paidAmount)}</td>
                            <td><strong>{formatCurrency(row.remainingAmount)}</strong></td>
                            <td><span className={statusClass(row.status)}>{statusLabel(row.status)}</span></td>
                            <td>
                              {isSettled ? (
                                <span className="supplier-schedule-completed-label">{t('accounts.supplier_balance_schedule_card.s84', "مكتملة")}</span>
                              ) : (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  disabled={disabled || settleMutation.isPending}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openPaymentDialog(row);
                                  }}
                                >
                                  {t('accounts.supplier_balance_schedule_card.s85', "تسجيل دفع")}
                                </Button>
                              )}
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="supplier-schedule-details-row">
                              <td colSpan={7}>
                                <div className="supplier-schedule-details-panel">
                                  <div className="supplier-schedule-details-heading">
                                    <strong>{t('accounts.supplier_balance_schedule_card.s86', "سجل دفع الدفعة")} {row.installmentNo}</strong>
                                    <span>{payments.length ? `${payments.length} عملية` : t('accounts.supplier_balance_schedule_card.s87', "لا يوجد دفع مسجل")}</span>
                                  </div>
                                  {payments.length ? (
                                    <div className="supplier-schedule-payment-log">
                                      {payments.map((payment) => (
                                        <div key={payment.id} className="supplier-schedule-payment-log-item">
                                          <strong>{formatCurrency(payment.amount)}</strong>
                                          <span>{formatDateTime(payment.createdAt)}</span>
                                          <span>{t('accounts.supplier_balance_schedule_card.s88', "تم تسجيل الدفع بواسطة المستخدم:")} {payment.createdByName || payment.createdBy || '—'}</span>
                                          {payment.note ? <em>{t('accounts.supplier_balance_schedule_card.s89', "ملاحظة:")} {payment.note}</em> : null}
                                        </div>
                                      ))}
                                    </div>
                                  ) : <div className="muted small">{t('accounts.supplier_balance_schedule_card.s90', "لم يتم تسجيل أي دفع على هذه الدفعة بعد.")}</div>}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              ) : rows.length ? (
                <EmptyState title={t('accounts.supplier_balance_schedule_card.s91', "لا توجد دفعات مطابقة للفلتر")} hint={t('accounts.supplier_balance_schedule_card.s92', "غيّر فلتر الحالة لعرض باقي دفعات المورد.")} />
              ) : (
                <EmptyState title={t('accounts.supplier_balance_schedule_card.s93', "لا يوجد جدول مستحقات لهذا المورد")} hint={t('accounts.supplier_balance_schedule_card.s94', "استخدم نموذج الجدولة لتقسيم رصيد المورد أو جزء منه على دفعات.")} />
              )}
            </div>
          </div>
        )}

        {/* Schedule Installment Payment Modal */}
        {paymentTarget ? (
          <div className="dialog-overlay supplier-payment-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setPaymentTarget(null); }}>
            <div className="dialog-shell supplier-payment-dialog" role="dialog" aria-modal="true" aria-label={`تأكيد تسليم الدفعة إلى ${supplierName}`}>
              <div className="dialog-card supplier-payment-dialog-card">
                <div className="supplier-payment-dialog-header supplier-payment-dialog-header--centered">
                  <div>
                    <h3>{t('accounts.supplier_balance_schedule_card.s95', "تأكيد تسليم الدفعة إلى")} {supplierName}</h3>
                    <p className="muted">{t('accounts.supplier_balance_schedule_card.s96', "دفعة")} {paymentTarget.installmentNo} {t('accounts.supplier_balance_schedule_card.s97', "— المتبقي")} {formatCurrency(paymentTarget.remainingAmount)}</p>
                  </div>
                </div>
                <div className="form-grid supplier-payment-dialog-form">
                  <Field label={t('accounts.supplier_balance_schedule_card.s98', "المبلغ المدفوع")}>
                    <input type="number" min="0.01" step="0.01" max={paymentTarget.remainingAmount} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
                  </Field>
                  <Field label="وسيلة سداد القسط">
                     <select value={schedulePaymentChannel} onChange={e => setSchedulePaymentChannel(e.target.value as typeof schedulePaymentChannel)} disabled={settleMutation.isPending}>
                       <option value="cash">نقدي (درج الكاشير)</option>
                       <option value="bank">تحويل بنكي</option>
                       <option value="card">بطاقة</option>
                       <option value="wallet">محفظة إلكترونية</option>
                       <option value="instapay">إنستاباي</option>
                     </select>
                   </Field>
                   {schedulePaymentChannel === 'instapay' && (
                     <Field label={t('accounts.supplier_balance_schedule_card.s115', "رقم حساب إنستاباي (IPA)")}>
                       <input type="text" value={schedulePaymentInstapayAddress} onChange={(event) => setSchedulePaymentInstapayAddress(event.target.value)} placeholder={t('accounts.supplier_balance_schedule_card.s116', "مثال: name@instapay")} disabled={settleMutation.isPending} />
                     </Field>
                   )}
                   <Field label={t('accounts.supplier_balance_schedule_card.s99', "ملاحظات اختيارية")}>
                    <textarea rows={3} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder={t('accounts.supplier_balance_schedule_card.s100', "مثال: تم التسليم لمندوب المورد / رقم إيصال / ملاحظة داخلية")} />
                  </Field>
                </div>
                <div className="actions compact-actions supplier-payment-dialog-actions">
                  <Button type="button" onClick={() => settleMutation.mutate({ row: paymentTarget, amount: paymentAmount ? Number(paymentAmount) : undefined, paymentNote })} disabled={settleMutation.isPending}>{t('accounts.supplier_balance_schedule_card.s101', "تأكيد تسليم الدفعة للمورد")}</Button>
                  <Button type="button" variant="secondary" onClick={() => setPaymentTarget(null)} disabled={settleMutation.isPending}>{t('accounts.supplier_balance_schedule_card.s102', "إلغاء")}</Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Schedule Installment Success WhatsApp Receipt */}
        {successReceipt ? (
          <div className="dialog-overlay supplier-payment-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setSuccessReceipt(null); }}>
            <div className="dialog-shell supplier-payment-dialog" role="dialog" aria-modal="true" aria-label={t('accounts.supplier_balance_schedule_card.s103', "تم الدفع بنجاح")}>
              <div className="dialog-card supplier-payment-dialog-card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: '#16a34a' }}>
                  <CheckCircleIcon size={52} />
                </div>
                <h3 style={{ marginBottom: '0.5rem' }}>{t('accounts.supplier_balance_schedule_card.s104', "تم تسجيل الدفعة بنجاح")}</h3>
                <p className="muted" style={{ marginBottom: '1.5rem' }}>
                  {t('accounts.supplier_balance_schedule_card.s105', "تم سداد")} {formatCurrency(successReceipt.amountPaid)} {t('accounts.supplier_balance_schedule_card.s106', "لصالح")} {supplierName} {t('accounts.supplier_balance_schedule_card.s107', "(المتبقي:")} {formatCurrency(successReceipt.remainingBalance)}).
                </p>
                
                <div className="actions compact-actions supplier-payment-dialog-actions" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Button 
                    type="button" 
                    onClick={() => {
                      const rawPhone = supplier?.phone || ''; 
                      const phone = formatWhatsAppNumber(rawPhone);
                      const remaining = successReceipt.remainingBalance;
                      const noteSuffix = successReceipt.note ? ` (${successReceipt.note})` : '';
                      const text = `مرحباً ${supplierName}،\nتم سداد دفعة نقدية لكم بقيمة: *${formatCurrency(successReceipt.amountPaid)} ${getGlobalCurrencySymbol()}*\n• البيان: *تسوية القسط رقم (${successReceipt.row.installmentNo}) من جدول المستحقات*${noteSuffix}\n• التاريخ والوقت: ${formatDateTimeArabic()}\n• إجمالي الرصيد المتبقي لكم: *${formatCurrency(remaining)} ${getGlobalCurrencySymbol()}*\nشكراً لتعاملكم معنا.`;
                      const encodedText = encodeURIComponent(text);
                      let url = `https://wa.me/${phone}?text=${encodedText}`;
                      if (settings?.whatsappLinkMode === 'web') {
                        url = `https://web.whatsapp.com/send/?phone=${phone}&text=${encodedText}`;
                      } else if (settings?.whatsappLinkMode === 'app') {
                        url = `whatsapp://send?phone=${phone}&text=${encodedText}`;
                      }
                      openWhatsApp(url);
                      setSuccessReceipt(null);
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <WhatsAppIcon size={16} /> {t('accounts.supplier_balance_schedule_card.s108', "إرسال للمورد عبر واتساب")}
                    </span>
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setSuccessReceipt(null)}>{t('accounts.supplier_balance_schedule_card.s109', "إغلاق النافذة")}</Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Direct Supplier Payment Success WhatsApp Receipt */}
        {directSuccessReceipt ? (
          <div className="dialog-overlay supplier-payment-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setDirectSuccessReceipt(null); }}>
            <div className="dialog-shell supplier-payment-dialog" role="dialog" aria-modal="true" aria-label={t('accounts.supplier_balance_schedule_card.s110', "تم تسجيل السداد بنجاح")}>
              <div className="dialog-card supplier-payment-dialog-card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: '#16a34a' }}>
                  <CheckCircleIcon size={52} />
                </div>
                <h3 style={{ marginBottom: '0.5rem' }}>{t('accounts.supplier_balance_schedule_card.s111', "تم تسجيل صرف المبلغ بنجاح")}</h3>
                <p className="muted" style={{ marginBottom: '1.5rem' }}>
                  {t('accounts.supplier_balance_schedule_card.s112', "تم سداد")} {formatCurrency(directSuccessReceipt.amountPaid)} {t('accounts.supplier_balance_schedule_card.s113', "لصالح المورد")} {supplierName} {t('accounts.supplier_balance_schedule_card.s114', "(الرصيد المتبقي له:")} {formatCurrency(directSuccessReceipt.remainingBalance)}).
                </p>

                <div className="actions compact-actions supplier-payment-dialog-actions" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Button
                    type="button"
                    onClick={() => {
                      const rawPhone = supplier?.phone || '';
                      const phone = formatWhatsAppNumber(rawPhone);
                      const remaining = directSuccessReceipt.remainingBalance;
                      const noteLine = directSuccessReceipt.note ? `\n• البيان: *${directSuccessReceipt.note}*` : '';
                      const text = `مرحباً ${supplierName}،\nتم تسجيل صرف دفعة نقدية لكم بقيمة: *${formatCurrency(directSuccessReceipt.amountPaid)} ${getGlobalCurrencySymbol()}*${noteLine}\n• التاريخ والوقت: ${formatDateTimeArabic()}\n• إجمالي الرصيد المتبقي لكم: *${formatCurrency(remaining)} ${getGlobalCurrencySymbol()}*\nشكراً لتعاملكم معنا.`;
                      const encodedText = encodeURIComponent(text);
                      let url = `https://wa.me/${phone}?text=${encodedText}`;
                      if (settings?.whatsappLinkMode === 'web') {
                        url = `https://web.whatsapp.com/send/?phone=${phone}&text=${encodedText}`;
                      } else if (settings?.whatsappLinkMode === 'app') {
                        url = `whatsapp://send?phone=${phone}&text=${encodedText}`;
                      }
                      openWhatsApp(url);
                      setDirectSuccessReceipt(null);
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <WhatsAppIcon size={16} /> {t('accounts.supplier_balance_schedule_card.s115', "إرسال إيصال للمورد عبر واتساب")}
                    </span>
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setDirectSuccessReceipt(null)}>
                    {t('accounts.supplier_balance_schedule_card.s116', "إغلاق")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </FormSection>
    </div>
  );
}
