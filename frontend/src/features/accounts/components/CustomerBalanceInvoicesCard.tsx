import { useTranslation } from 'react-i18next';
import { Fragment, useMemo, useState } from 'react';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { FormSection } from '@/shared/components/form-section';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { EmptyState } from '@/shared/ui/empty-state';
import { MutationFeedback } from '@/shared/components/mutation-feedback';
import { accountsApi } from '@/features/accounts/api/accounts.api';
import { customersApi } from '@/shared/api/customers.api';
import { salesApi } from '@/features/sales/api/sales.api';
import { formatCurrency, formatDateTimeArabic, formatWhatsAppNumber } from '@/lib/format';
import { openWhatsApp } from '@/lib/whatsapp';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import type { Customer, CustomerLedgerEntry, Sale } from '@/types/domain';

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

function extractSaleId(entry: any): string | null {
  const refType = String(entry.referenceType || entry.reference_type || '');
  const refId = String(entry.referenceId || entry.reference_id || '');
  if ((refType === 'sale' || refType === 'sales' || !refType) && refId && /^\d+$/.test(refId)) {
    return refId;
  }
  const note = String(entry.note || entry.doc_no || '');
  const match = note.match(/S-(\d+)/i) || note.match(/فاتورة(?:\s+بيع)?\s*(?:S-)?(\d+)/i);
  if (match && match[1]) {
    return match[1];
  }
  if (entry.doc_no && /^\d+$/.test(entry.doc_no)) {
    return entry.doc_no;
  }
  return null;
}

function formatLedgerDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

function InvoiceItemsExpandable({ saleId, onSelectAmount }: { saleId: string; onSelectAmount?: (amount: number, invoiceDocNo: string) => void }) {
  const { t } = useTranslation();
  const { data: sale, isLoading, error } = useQuery<Sale>({
    queryKey: queryKeys.saleDetail(saleId),
    queryFn: () => salesApi.getById(saleId),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px', fontSize: '0.85rem', color: '#64748b' }}>
        {t('accounts.customer_balance_invoices_card.s0', "جاري جلب تفاصيل وأصناف الفاتورة #")}{saleId}...
      </div>
    );
  }

  if (error || !sale) {
    return (
      <div style={{ padding: '12px', background: '#fef2f2', borderRadius: '6px', fontSize: '0.85rem', color: '#b91c1c' }}>
        {t('accounts.customer_balance_invoices_card.s1', "تعذر تحميل تفاصيل الفاتورة #")}{saleId}
      </div>
    );
  }

  const items = sale.items || [];
  const paid = Number(sale.paidAmount || 0);
  const total = Number(sale.total || 0);
  const remaining = Math.max(0, total - paid);
  const docNumber = sale.docNo || `S-${sale.id}`;

  return (
    <div style={{ padding: '12px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', margin: '6px 0 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <strong style={{ fontSize: '0.88rem', color: '#0f172a' }}>
            {t('accounts.customer_balance_invoices_card.s2', "أصناف الفاتورة:")} {docNumber}
          </strong>
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
            ({items.length} {t('accounts.customer_balance_invoices_card.s3', "أصناف)")}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.82rem' }}>
          <span>{t('accounts.customer_balance_invoices_card.s4', "الإجمالي:")} <b>{formatCurrency(total)}</b></span>
          <span>{t('accounts.customer_balance_invoices_card.s5', "المدفوع:")} <b style={{ color: '#16a34a' }}>{formatCurrency(paid)}</b></span>
          <span>{t('accounts.customer_balance_invoices_card.s6', "المتبقي:")} <b style={{ color: '#dc2626' }}>{formatCurrency(remaining)}</b></span>
          {remaining > 0 && onSelectAmount ? (
            <button
              type="button"
              onClick={() => onSelectAmount(remaining, docNumber)}
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
              {t('accounts.customer_balance_invoices_card.s7', "تحصيل متبقي هذه الفاتورة (")}{formatCurrency(remaining)})
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', background: '#ffffff', borderRadius: '6px', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#f1f5f9', color: '#475569', textAlign: 'right' }}>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.customer_balance_invoices_card.s8', "الصنف")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.customer_balance_invoices_card.s9', "الوحدة")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.customer_balance_invoices_card.s10', "الكمية")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.customer_balance_invoices_card.s11', "السعر")}</th>
              <th style={{ padding: '6px 10px', fontWeight: 600 }}>{t('accounts.customer_balance_invoices_card.s12', "الإجمالي")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '6px 10px', fontWeight: 600, color: '#1e293b' }}>{item.name}</td>
                <td style={{ padding: '6px 10px', color: '#64748b' }}>{item.unitName || '—'}</td>
                <td style={{ padding: '6px 10px', fontWeight: 600 }}>{item.qty}</td>
                <td style={{ padding: '6px 10px', color: '#475569' }}>{formatCurrency(Number(item.price || 0))}</td>
                <td style={{ padding: '6px 10px', fontWeight: 700, color: '#0f172a' }}>{formatCurrency(Number(item.total || (item.qty * item.price)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type LedgerFilter = 'all' | 'sales' | 'payments';

interface CustomerBalanceInvoicesCardProps {
  customer: Customer | null;
  disabled?: boolean;
}

export function CustomerBalanceInvoicesCard({ customer, disabled = false }: CustomerBalanceInvoicesCardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useSettingsQuery();
  const customerId = String(customer?.id || '');
  const customerName = String(customer?.name || 'العميل');
  const customerBalance = Number(customer?.balance || 0);

  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [expandedSaleIds, setExpandedSaleIds] = useState<Record<string, boolean>>({});
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentChannel, setPaymentChannel] = useState<'cash'|'bank'|'card'|'wallet'|'instapay'>('cash');
  /* INV-INSTAPAY-FIELD-MISSING: the customer InstaPay account number
   * (IPA) this receipt came from; sent only when the channel is
   * InstaPay. */
  const [paymentInstapayAddress, setPaymentInstapayAddress] = useState('');
  /* INV-REP-NONCASH-EVIDENCE-GATE (PD1) + STUCK-RECEIPT: the real
   * transfer reference of this receipt. Mandatory (at least 3
   * characters) for every non-cash channel — without it the backend
   * gate refuses the receipt and the form deadlocked. */
  const [paymentTransferReference, setPaymentTransferReference] = useState('');
  const [successReceipt, setSuccessReceipt] = useState<{
    customer: Customer;
    amountPaid: number;
    remainingBalance: number;
    note?: string;
  } | null>(null);

  const ledgerQuery = useQuery({
    queryKey: queryKeys.customerLedger(customerId),
    queryFn: () => customersApi.ledger(customerId),
    enabled: Boolean(customerId),
  });

  const entries: CustomerLedgerEntry[] = useMemo(() => {
    return ledgerQuery.data?.entries || [];
  }, [ledgerQuery.data]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry: any) => {
      const amt = Number(entry.amount ?? (Number(entry.debit || 0) > 0 ? entry.debit : -Number(entry.credit || 0)));
      const debit = amt > 0 ? amt : Number(entry.debit || 0);
      const credit = amt < 0 ? Math.abs(amt) : Number(entry.credit || 0);
      const saleId = extractSaleId(entry);
      const isSale = Boolean(saleId) || debit > 0 || String(entry.note || '').includes('فاتورة');
      const isPayment = credit > 0 || String(entry.note || '').includes('تحصيل');
      if (filter === 'sales') return isSale;
      if (filter === 'payments') return isPayment;
      return true;
    });
  }, [entries, filter]);

  function toggleSaleDetails(saleId: string) {
    setExpandedSaleIds((prev) => ({ ...prev, [saleId]: !prev[saleId] }));
  }

  function handleSelectInvoiceAmount(amount: number, invoiceDocNo?: string) {
    setPaymentAmount(String(amount));
    if (invoiceDocNo) {
      setPaymentNote(`سداد فاتورة بيع رقم ${invoiceDocNo}`);
    }
  }

  function refreshAccounts() {
    queryClient.invalidateQueries({ queryKey: queryKeys.customerBalances });
    queryClient.invalidateQueries({ queryKey: queryKeys.customers });
    queryClient.invalidateQueries({ queryKey: queryKeys.treasury });
    queryClient.invalidateQueries({ queryKey: queryKeys.cashierShifts });
    if (customerId) queryClient.invalidateQueries({ queryKey: queryKeys.customerLedger(customerId) });
  }

  const paymentMutation = useMutation({
    mutationFn: () => {
      if (!customer) throw new Error('اختر العميل أولًا');
      const amount = Number(paymentAmount || 0);
      if (!(amount > 0)) throw new Error('المبلغ المحصل يجب أن يكون أكبر من الصفر');
      /* INV-REP-NONCASH-EVIDENCE-GATE (PD1) + STUCK-RECEIPT: a
       * non-cash receipt needs a real transfer reference of at least
       * 3 characters — the same bar as the van card gate. Refusing
       * here keeps the cashier on the form with a clear message
       * instead of a server 400 that used to deadlock the attempt. */
      if (paymentChannel !== 'cash' && paymentTransferReference.trim().length < 3) {
        throw new Error('أدخل رقم مرجع التحويل (3 أحرف/أرقام على الأقل) — التحصيل غير النقدي لا يتم بدون مرجع.');
      }
      return accountsApi.customerPaymentCreate({
        customerId: Number(customer.id),
        amount,
        paymentChannel,
        instapayAddress: paymentChannel === 'instapay' ? paymentInstapayAddress.trim() : undefined,
        transferReference: paymentChannel !== 'cash' ? paymentTransferReference.trim() : undefined,
        note: paymentNote || `تحصيل سريع من العميل ${customerName}`,
      });
    },
    onSuccess: () => {
      const amountPaid = Number(paymentAmount || 0);
      const newRemaining = Math.max(0, customerBalance - amountPaid);

      if (customer) {
        setSuccessReceipt({
          customer,
          amountPaid,
          remainingBalance: newRemaining,
          note: paymentNote || 'تحصيل نقدي من الرصيد العام',
        });
      }

      refreshAccounts();
      setPaymentAmount('');
      setPaymentNote('');
      setPaymentInstapayAddress('');
      setPaymentTransferReference('');
    },
  });

  if (!customer) {
    return (
      <FormSection title={t('accounts.customer_balance_invoices_card.s13', "كشف حساب وفواتير العميل")} description={t('accounts.customer_balance_invoices_card.s14', "اختر عميلاً لعرض فواتيره وتفاصيل الأصناف وسداد المديونية.")}>
        <EmptyState title={t('accounts.customer_balance_invoices_card.s15', "لم يتم اختيار عميل")} hint={t('accounts.customer_balance_invoices_card.s16', "ابحث عن العميل بالاسم أو رقم الهاتف لعرض كشف حسابه وفواتيره.")} />
      </FormSection>
    );
  }

  return (
    <div className="customer-balance-invoices-card">
      <FormSection
        title={`حساب وفواتير العميل: ${customerName}`}
        description={t('accounts.customer_balance_invoices_card.s17', "استعرض فواتير العميل السابقة واضغط على أي فاتورة لعرض الأصناف المشتراة أو تحصيل المديونية.")}
        actions={
          <div className="actions compact-actions">
            <span className="nav-pill" style={{ background: customerBalance > 0 ? '#fef2f2' : '#f0fdf4', color: customerBalance > 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>
              {t('accounts.customer_balance_invoices_card.s18', "المديونية:")} {formatCurrency(customerBalance)}
            </span>
          </div>
        }
      >
        {/* Top Summary Stats */}
        <div className="stats-grid compact-grid" style={{ marginBottom: '14px' }}>
          <div className="stat-card">
            <span>{t('accounts.customer_balance_invoices_card.s19', "رصيد العميل المستحق")}</span>
            <strong style={{ color: customerBalance > 0 ? '#dc2626' : '#16a34a' }}>
              {formatCurrency(customerBalance)}
            </strong>
          </div>
          <div className="stat-card">
            <span>{t('accounts.customer_balance_invoices_card.s20', "عدد الحركات المسجلة")}</span>
            <strong>{entries.length} {t('accounts.customer_balance_invoices_card.s21', "حركات")}</strong>
          </div>
          {customer.phone ? (
            <div className="stat-card">
              <span>{t('accounts.customer_balance_invoices_card.s22', "رقم الهاتف")}</span>
              <strong style={{ fontSize: '0.9rem' }}>{customer.phone}</strong>
            </div>
          ) : null}
          {Number(customer.creditLimit || (customer as any).credit_limit || 0) > 0 ? (
            <div className="stat-card">
              <span>{t('accounts.customer_balance_invoices_card.s23', "الحد الائتماني المسموح")}</span>
              <strong>{formatCurrency(Number(customer.creditLimit || (customer as any).credit_limit))}</strong>
            </div>
          ) : null}
        </div>

        {/* Ledger & Invoices Section */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <strong style={{ fontSize: '0.92rem', color: '#1e293b' }}>{t('accounts.customer_balance_invoices_card.s24', "سجل الفواتير والمعاملات")}</strong>
              {ledgerQuery.isLoading ? <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{t('accounts.customer_balance_invoices_card.s25', "(جاري التحميل...)")}</span> : null}
            </div>
            <div className="actions compact-actions">
              <Button
                type="button"
                variant={filter === 'all' ? 'primary' : 'secondary'}
                onClick={() => setFilter('all')}
              >
                {t('accounts.customer_balance_invoices_card.s26', "الكل (")}{entries.length})
              </Button>
              <Button
                type="button"
                variant={filter === 'sales' ? 'primary' : 'secondary'}
                onClick={() => setFilter('sales')}
              >
                {t('accounts.customer_balance_invoices_card.s27', "فواتير البيع")}
              </Button>
              <Button
                type="button"
                variant={filter === 'payments' ? 'primary' : 'secondary'}
                onClick={() => setFilter('payments')}
              >
                {t('accounts.customer_balance_invoices_card.s28', "سندات التحصيل")}
              </Button>
            </div>
          </div>

          {filteredEntries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 12px', color: '#64748b', fontSize: '0.85rem' }}>
              {ledgerQuery.isLoading ? t('accounts.customer_balance_invoices_card.s29', "جاري تحميل كشف الحساب...") : t('accounts.customer_balance_invoices_card.s30', "لا توجد حركات مسجلة لهذا العميل في هذه التصفية.")}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', color: '#475569', borderBottom: '2px solid #e2e8f0', textAlign: 'right' }}>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.customer_balance_invoices_card.s31', "التاريخ")}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.customer_balance_invoices_card.s32', "نوع الحركة / البيان")}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.customer_balance_invoices_card.s33', "مدين (فاتورة)")}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.customer_balance_invoices_card.s34', "دائن (مسدد)")}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600 }}>{t('accounts.customer_balance_invoices_card.s35', "الرصيد بعد الحركة")}</th>
                    <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'center' }}>{t('accounts.customer_balance_invoices_card.s36', "الأصناف")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry: any, index) => {
                    const saleId = extractSaleId(entry);
                    const isExpanded = Boolean(saleId && expandedSaleIds[saleId]);
                    const amt = Number(entry.amount ?? (Number(entry.debit || 0) > 0 ? entry.debit : -Number(entry.credit || 0)));
                    const debit = amt > 0 ? amt : Number(entry.debit || 0);
                    const credit = amt < 0 ? Math.abs(amt) : Number(entry.credit || 0);
                    const balanceAfter = entry.balanceAfter != null ? Number(entry.balanceAfter) : (entry.balance_after != null ? Number(entry.balance_after) : null);
                    const dateValue = entry.createdAt || entry.created_at || entry.date;
                    const isSale = Boolean(saleId) || debit > 0 || String(entry.note || '').includes(t('accounts.customer_balance_invoices_card.s37', "فاتورة"));

                    return (
                      <Fragment key={entry.id || entry.doc_no || index}>
                        <tr
                          style={{
                            borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9',
                            background: isExpanded ? '#f8fafc' : (index % 2 === 0 ? '#ffffff' : '#fafafa'),
                            cursor: saleId ? 'pointer' : 'default',
                          }}
                          onClick={() => {
                            if (saleId) toggleSaleDetails(saleId);
                          }}
                        >
                          <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>
                            {formatLedgerDate(dateValue)}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1e293b' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{entry.note || entry.doc_no || (isSale ? t('accounts.customer_balance_invoices_card.s38', "فاتورة بيع") : t('accounts.customer_balance_invoices_card.s39', "سداد/تحصيل"))}</span>
                              {saleId ? (
                                <span style={{ fontSize: '0.72rem', background: '#eff6ff', color: '#2563eb', padding: '1px 5px', borderRadius: '4px' }}>
                                  #{saleId}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: debit > 0 ? '#dc2626' : '#94a3b8' }}>
                            {debit > 0 ? formatCurrency(debit) : '—'}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: credit > 0 ? '#16a34a' : '#94a3b8' }}>
                            {credit > 0 ? formatCurrency(credit) : '—'}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                            {balanceAfter != null ? formatCurrency(balanceAfter) : '—'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            {saleId ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSaleDetails(saleId);
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
                                {isExpanded ? t('accounts.customer_balance_invoices_card.s40', "إخفاء") : t('accounts.customer_balance_invoices_card.s41', "عرض الأصناف")}
                                {isExpanded ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
                              </button>
                            ) : (
                              <span style={{ color: '#cbd5e1' }}>—</span>
                            )}
                          </td>
                        </tr>

                        {isExpanded && saleId ? (
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <td colSpan={6} style={{ padding: '0 10px 10px' }}>
                              <InvoiceItemsExpandable
                                saleId={saleId}
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

        {/* Collection & Payment Form Section */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px' }}>
          <strong style={{ display: 'block', marginBottom: '10px', fontSize: '0.94rem', color: '#0f172a' }}>
            {t('accounts.customer_balance_invoices_card.s42', "تسجيل تحصيل واستلام نقدية من")} {customerName}
          </strong>

          <div className="form-grid">
            <Field label={`المبلغ المحصل (${getGlobalCurrencySymbol()})`}>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                placeholder={`مثال: ${customerBalance > 0 ? customerBalance : '0.00'}`}
                disabled={paymentMutation.isPending || disabled}
              />
              <div className="customer-quick-amount-shortcuts" style={{ marginTop: '6px' }}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPaymentAmount(String(customerBalance > 0 ? customerBalance : ''))}
                  disabled={paymentMutation.isPending || disabled || customerBalance <= 0}
                >
                  {t('accounts.customer_balance_invoices_card.s43', "تحصيل كامل الرصيد المستحق (")}{formatCurrency(customerBalance)})
                </Button>
              </div>
            </Field>

            <Field label="وسيلة التحصيل">
              <select value={paymentChannel} onChange={e => setPaymentChannel(e.target.value as typeof paymentChannel)} disabled={paymentMutation.isPending || disabled}>
                <option value="cash">نقدي (درج الكاشير)</option>
                <option value="bank">تحويل بنكي</option>
                <option value="card">بطاقة</option>
                <option value="wallet">محفظة إلكترونية</option>
                <option value="instapay">إنستاباي</option>
              </select>
            </Field>
            {paymentChannel === 'instapay' && (
              <Field label={t('accounts.customer_balance_invoices_card.s49', "رقم حساب إنستاباي (IPA)")}>
                <input
                  type="text"
                  value={paymentInstapayAddress}
                  onChange={(event) => setPaymentInstapayAddress(event.target.value)}
                  placeholder={t('accounts.customer_balance_invoices_card.s50', "مثال: name@instapay")}
                  disabled={paymentMutation.isPending || disabled}
                />
              </Field>
            )}
            {paymentChannel !== 'cash' && (
              <Field label="رقم العملية / المرجع البنكي *">
                <input
                  type="text"
                  value={paymentTransferReference}
                  onChange={(event) => setPaymentTransferReference(event.target.value)}
                  placeholder="رقم مرجع التحويل أو آخر 6 أرقام من الإشعار (3 أحرف على الأقل)"
                  disabled={paymentMutation.isPending || disabled}
                />
              </Field>
            )}
            <Field label={t('accounts.customer_balance_invoices_card.s44', "ملاحظات التحصيل (اختياري)")}>
              <textarea
                rows={2}
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
                placeholder={t('accounts.customer_balance_invoices_card.s45', "مثال: تحصيل نقدي في الخزينة / سداد فاتورة محددة")}
                disabled={paymentMutation.isPending || disabled}
              />
            </Field>
          </div>

          <div className="actions compact-actions supplier-payment-dialog-actions" style={{ marginTop: '12px' }}>
            <Button
              type="button"
              onClick={() => paymentMutation.mutate()}
              disabled={paymentMutation.isPending || !(Number(paymentAmount) > 0) || disabled}
            >
              {paymentMutation.isPending ? t('accounts.customer_balance_invoices_card.s46', "جاري تسجيل التحصيل...") : t('accounts.customer_balance_invoices_card.s47', "تأكيد تحصيل المبلغ من العميل")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPaymentAmount('');
                setPaymentNote('');
                setPaymentInstapayAddress('');
                setPaymentTransferReference('');
              }}
              disabled={paymentMutation.isPending}
            >
              {t('accounts.customer_balance_invoices_card.s48', "إعادة ضبط")}
            </Button>
          </div>

          <MutationFeedback
            isError={paymentMutation.isError}
            isSuccess={false}
            error={paymentMutation.error}
            errorFallback={t('accounts.customer_balance_invoices_card.s49', "تعذر تسجيل تحصيل العميل")}
            successText=""
          />
        </div>
      </FormSection>

      {/* Success Dialog Modal */}
      {successReceipt ? (
        <div
          className="dialog-overlay supplier-payment-dialog-overlay"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) setSuccessReceipt(null); }}
        >
          <div className="dialog-shell supplier-payment-dialog" role="dialog" aria-modal="true" aria-label={t('accounts.customer_balance_invoices_card.s50', "تم تسجيل التحصيل بنجاح")}>
            <div className="dialog-card supplier-payment-dialog-card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', color: '#16a34a' }}>
                <CheckCircleIcon size={52} />
              </div>
              <h3 style={{ marginBottom: '0.5rem' }}>{t('accounts.customer_balance_invoices_card.s51', "تم تسجيل التحصيل بنجاح")}</h3>
              <p className="muted" style={{ marginBottom: '1.5rem' }}>
                {t('accounts.customer_balance_invoices_card.s52', "تم استلام")} {formatCurrency(successReceipt.amountPaid)} {t('accounts.customer_balance_invoices_card.s53', "من العميل")} {successReceipt.customer.name} {t('accounts.customer_balance_invoices_card.s54', "(الرصيد المتبقي:")} {formatCurrency(successReceipt.remainingBalance)}).
              </p>

              <div className="actions compact-actions supplier-payment-dialog-actions" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button
                  type="button"
                  onClick={() => {
                    const rawPhone = successReceipt.customer.phone || '';
                    const phone = formatWhatsAppNumber(rawPhone);
                    const remaining = successReceipt.remainingBalance;
                    const noteLine = successReceipt.note ? `\n• البيان: *${successReceipt.note}*` : '';
                    const text = `مرحباً ${successReceipt.customer.name}،\nتم تسجيل استلام دفعة نقدية بقيمة: *${formatCurrency(successReceipt.amountPaid)} ${getGlobalCurrencySymbol()}*${noteLine}\n• التاريخ والوقت: ${formatDateTimeArabic()}\n• إجمالي الرصيد المتبقي عليكم: *${formatCurrency(remaining)} ${getGlobalCurrencySymbol()}*\nشكراً لتعاملكم معنا.`;
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
                    <WhatsAppIcon size={16} /> {t('accounts.customer_balance_invoices_card.s55', "إرسال إيصال للعميل عبر واتساب")}
                  </span>
                </Button>
                <Button type="button" variant="secondary" onClick={() => setSuccessReceipt(null)}>
                  {t('accounts.customer_balance_invoices_card.s56', "إغلاق")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
