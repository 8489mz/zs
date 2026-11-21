import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { FormSection } from '@/shared/components/form-section';
import { Button } from '@/shared/ui/button';
import { ClipboardIcon, CalendarIcon } from '@/shared/components/icons/AppIcons';
import { EmptyState } from '@/shared/ui/empty-state';
import { accountsApi } from '@/features/accounts/api/accounts.api';
import { supplierBalanceScheduleApi, buildSettleSupplierPaymentSchedulePayload, type SupplierPaymentScheduleItem } from '@/features/accounts/api/supplier-balance-schedule.api';
import { readSupplierInstapayAddress } from '@/features/accounts/contracts';
import { formatCurrency } from '@/lib/format';
import type { Supplier, SupplierLedgerEntry } from '@/types/domain';
import { todayIso, summarize, extractPurchaseId } from './supplier-balance-schedule/supplier-schedule-helpers';
import type { LedgerFilter, ScheduleFilter, SupplierSubTab } from './supplier-balance-schedule/supplier-schedule-types';
import { SupplierLedgerTab } from './supplier-balance-schedule/supplier-ledger-tab';
import { SupplierScheduleTab } from './supplier-balance-schedule/supplier-schedule-tab';
import { SupplierPaymentModal } from './supplier-balance-schedule/supplier-payment-modal';
import { SupplierSuccessReceiptModal } from './supplier-balance-schedule/supplier-success-receipt-modal';
import { SupplierDirectSuccessModal } from './supplier-balance-schedule/supplier-direct-success-modal';




interface SupplierBalanceScheduleCardProps {
  supplier: Supplier | null;
  disabled?: boolean;
}

export function SupplierBalanceScheduleCard({ supplier, disabled = false }: SupplierBalanceScheduleCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
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
  
  // INV-FE3-FRONTEND-BOOK-DIGITS: the unscheduled balance gates
  // scheduling, so it rounds at the tenant's book digits, not 2dp.
  const unscheduledBalance = roundMoneyValue(supplierBalance - summary.remaining, currencyMoneyDigits(getGlobalSystemCurrency()));
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
          <SupplierLedgerTab
            directPaymentAmount={directPaymentAmount}
            directPaymentChannel={directPaymentChannel}
            directPaymentInstapayAddress={directPaymentInstapayAddress}
            directPaymentMutation={directPaymentMutation}
            directPaymentNote={directPaymentNote}
            disabled={disabled}
            expandedPurchaseIds={expandedPurchaseIds}
            filteredLedgerEntries={filteredLedgerEntries}
            handleSelectInvoiceAmount={handleSelectInvoiceAmount}
            ledgerEntries={ledgerEntries}
            ledgerFilter={ledgerFilter}
            ledgerQuery={ledgerQuery}
            setDirectPaymentAmount={setDirectPaymentAmount}
            setDirectPaymentChannel={setDirectPaymentChannel}
            setDirectPaymentInstapayAddress={setDirectPaymentInstapayAddress}
            setDirectPaymentNote={setDirectPaymentNote}
            setLedgerFilter={setLedgerFilter}
            supplierBalance={supplierBalance}
            supplierName={supplierName}
            togglePurchaseDetails={togglePurchaseDetails}
          />
        ) : (
          /* SUB-TAB 2: Schedule View */
          <SupplierScheduleTab
            canSchedule={canSchedule}
            createMutation={createMutation}
            disabled={disabled}
            expandedRows={expandedRows}
            filterCounts={filterCounts}
            filteredRows={filteredRows}
            firstDueDate={firstDueDate}
            installmentAmount={installmentAmount}
            installmentCount={installmentCount}
            intervalDays={intervalDays}
            mode={mode}
            nextDue={nextDue}
            note={note}
            openPaymentDialog={openPaymentDialog}
            roundingStep={roundingStep}
            rows={rows}
            scheduleAmount={scheduleAmount}
            scheduleFilter={scheduleFilter}
            setFirstDueDate={setFirstDueDate}
            setInstallmentAmount={setInstallmentAmount}
            setInstallmentCount={setInstallmentCount}
            setIntervalDays={setIntervalDays}
            setMode={setMode}
            setNote={setNote}
            setRoundingStep={setRoundingStep}
            setScheduleAmount={setScheduleAmount}
            setScheduleFilter={setScheduleFilter}
            setShowAppendForm={setShowAppendForm}
            settleMutation={settleMutation}
            showAppendForm={showAppendForm}
            supplierBalance={supplierBalance}
            supplierName={supplierName}
            toggleRow={toggleRow}
            unscheduledBalance={unscheduledBalance}
          />
        )}

        {/* Schedule Installment Payment Modal */}
        {paymentTarget ? (
          <SupplierPaymentModal
            paymentAmount={paymentAmount}
            paymentNote={paymentNote}
            paymentTarget={paymentTarget}
            schedulePaymentChannel={schedulePaymentChannel}
            schedulePaymentInstapayAddress={schedulePaymentInstapayAddress}
            setPaymentAmount={setPaymentAmount}
            setPaymentNote={setPaymentNote}
            setPaymentTarget={setPaymentTarget}
            setSchedulePaymentChannel={setSchedulePaymentChannel}
            setSchedulePaymentInstapayAddress={setSchedulePaymentInstapayAddress}
            settleMutation={settleMutation}
            supplierName={supplierName}
          />
        ) : null}

        {/* Schedule Installment Success WhatsApp Receipt */}
        {successReceipt ? (
          <SupplierSuccessReceiptModal
            successReceipt={successReceipt}
            setSuccessReceipt={setSuccessReceipt}
            supplier={supplier}
            supplierName={supplierName}
          />
        ) : null}

        {/* Direct Supplier Payment Success WhatsApp Receipt */}
        {directSuccessReceipt ? (
          <SupplierDirectSuccessModal
            directSuccessReceipt={directSuccessReceipt}
            setDirectSuccessReceipt={setDirectSuccessReceipt}
            supplier={supplier}
            supplierName={supplierName}
          />
        ) : null}
      </FormSection>
    </div>
  );
}
