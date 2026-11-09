import { toast } from '@/shared/components/system-alert';
import { useTranslation } from 'react-i18next';
import { CurrencySymbol } from '@/shared/ui/currency-symbol';
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { http } from '@/lib/http';
import { PageHeader } from '@/shared/components/page-header';
import { Button } from '@/shared/ui/button';
import { LoadingState } from '@/shared/ui/loading-state';
import { formatCurrency } from '@/lib/format';
import { useSuppliersQuery } from '@/shared/hooks/use-catalog-queries';
import { useTreasury } from '@/shared/hooks/use-treasury';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import {
  useRecordForeignTransferMutation,
  useForeignTransfersQuery,
  useProformaInvoicesQuery,
  useChinaSuppliersQuery,
  buildForeignTransferPayload,
  paymentMethodEvidenceFields,
  IMPORT_PAYMENT_METHODS,
  IMPORT_PAYMENT_METHOD_LABELS,
  type ForeignTransferEvidence,
} from './api/shipments.api';
import {
  BuildingIcon,
  CreditCardIcon,
  GlobeIcon,
  RefreshCwIcon,
  FileTextIcon,
  CheckCircleIcon,
  SlidersIcon,
} from '@/shared/components/icons/AppIcons';

const EVIDENCE_FIELD_META: Record<string, { label: string; type?: string; optional?: boolean }> = {
  paymentReference: { label: 'مرجع الحوالة / رقم العملية' },
  bankSwiftCode: { label: 'كود SWIFT للبنك', optional: true },
  form4Number: { label: 'رقم نموذج 4 (اختياري عند التسجيل)', optional: true },
  form4Date: { label: 'تاريخ نموذج 4', type: 'date', optional: true },
  carrierName: { label: 'اسم المسافر الحامل للنقد' },
  travelDate: { label: 'تاريخ السفر', type: 'date' },
  handoverReceiptNo: { label: 'رقم إيصال التسليم للمورد' },
  lcNumber: { label: 'رقم الاعتماد المستندي' },
  lcIssuingBank: { label: 'البنك المصدر للاعتماد' },
  lcExpiryDate: { label: 'تاريخ انتهاء الاعتماد', type: 'date' },
  lcDocuments: { label: 'قائمة المستندات المطلوبة' },
  cadHandoverProof: { label: 'إثبات تسليم المستندات' },
  paymentTerms: { label: 'شروط الدفع الآجل' },
  paymentDueDate: { label: 'تاريخ الاستحقاق', type: 'date' },
};

export default function SupplierCredit() {
  const { t } = useTranslation();
  const suppliersQuery = useSuppliersQuery();
  const chinaSuppliersQuery = useChinaSuppliersQuery();
  const treasuryQuery = useTreasury({});
  const transferMutation = useRecordForeignTransferMutation();
  const transfersQuery = useForeignTransfersQuery();
  const proformasQuery = useProformaInvoicesQuery();

  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [selectedPiId, setSelectedPiId] = useState('');
  const [amountEgp, setAmountEgp] = useState('');
  const [amountForeign, setAmountForeign] = useState('');
  const [notes, setNotes] = useState('');
  // Payment method + evidence (INV-IMPORT-PAYMENT-METHODS): the
  // method travels with the money record; evidence is required by
  // the backend for the chosen method. Bank transfer is the
  // historical default when the user picks nothing else.
  const [paymentMethod, setPaymentMethod] = useState<string>('bank_transfer');
  const [evidence, setEvidence] = useState<ForeignTransferEvidence>({});
  const [custodyAccountId, setCustodyAccountId] = useState('');
  // Preserve the key across network retries of the *same* request.
  const transferAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const { data: accountsData } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => http<any>('/api/accounting/accounts').catch(() => ({ accounts: [] })),
  });
  const cashBankAccounts = useMemo(() => {
    const list = accountsData?.accounts || (Array.isArray(accountsData) ? accountsData : []);
    return (list as any[]).filter((a: any) => a.accountGroup === 'current_assets' || a.isCashBank);
  }, [accountsData]);

  // Combine China suppliers and general suppliers without empty metadata filters
  const factories = useMemo(() => {
    const map = new Map<string, { id: string; name: string; balance: number; city?: string; chineseName?: string }>();

    if (Array.isArray(chinaSuppliersQuery.data)) {
      for (const cs of chinaSuppliersQuery.data) {
        map.set(String(cs.id), {
          id: String(cs.id),
          name: cs.name,
          balance: Number(cs.balance || 0),
          city: cs.city,
          chineseName: cs.chinese_name,
        });
      }
    }

    if (Array.isArray(suppliersQuery.data)) {
      for (const s of suppliersQuery.data) {
        const idStr = String(s.id);
        if (!map.has(idStr)) {
          map.set(idStr, {
            id: idStr,
            name: s.name,
            balance: Number(s.balance || 0),
          });
        }
      }
    }

    return Array.from(map.values());
  }, [chinaSuppliersQuery.data, suppliersQuery.data]);

  // Proforma invoices filtered by selected supplier (or all if none selected)
  const supplierProformas = useMemo(() => {
    const list = proformasQuery.data || [];
    if (!selectedSupplier) return list;
    return list.filter((pi: any) => String(pi.supplier_id) === String(selectedSupplier));
  }, [proformasQuery.data, selectedSupplier]);

  const selectedPi = useMemo(() => {
    return (proformasQuery.data || []).find((pi: any) => String(pi.id) === String(selectedPiId));
  }, [proformasQuery.data, selectedPiId]);

  const totalDebtEgp = factories.reduce((sum, s) => sum + Number(s.balance || 0), 0);
  const availableEgp = treasuryQuery.data?.summary?.net || 0;
  // INV-IMPORT-SUPPLIER-CREDIT-READ: the debt total and the factory count
  // are computed from the supplier queries, so while either query is still
  // pending they must render as dashes behind a loading state — never the
  // false 0.00 total / 0 factories the screen showed in the live trial
  // before the data arrived (same false-empty family I2-P7 fixed on the
  // other import screens; the posted receipt is visible once loaded
  // because listChinaSuppliers carries the synced suppliers.balance).
  const isFactoriesLoading = chinaSuppliersQuery.isLoading || suppliersQuery.isLoading;
  const isTreasuryLoading = treasuryQuery.isLoading;

  const egpNum = Number(amountEgp) || 0;
  const foreignNum = Number(amountForeign) || 0;
  const exchangeRate = egpNum > 0 && foreignNum > 0 ? (egpNum / foreignNum).toFixed(2) : '0.00';

  const handleSelectPi = (piId: string) => {
    setSelectedPiId(piId);
    if (!piId) return;
    const pi = (proformasQuery.data || []).find((p: any) => String(p.id) === String(piId));
    if (pi && pi.supplier_id && !selectedSupplier) {
      setSelectedSupplier(String(pi.supplier_id));
    }
  };

  const handleFillPiRemaining = () => {
    if (!selectedPi) return;
    const remaining = Math.max(0, Number(selectedPi.total_amount_foreign || 0) - Number(selectedPi.paid_amount_foreign || 0));
    const rate = Number(selectedPi.exchange_rate_contract) || 50;
    setAmountForeign(String(remaining));
    // INV-FE2-FRONTEND-BOOK-DIGITS: the EGP amount is POSTed as the
    // treasury withdrawal, so it rounds at EGP digits (2) — the
    // denomination of the amount.
    setAmountEgp(String(roundMoneyValue(remaining * rate, currencyMoneyDigits('EGP'))));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) {
      toast.error('يرجى اختيار المصنع أو المورد الأجنبي');
      return;
    }
    if (egpNum <= 0) {
      toast.error('المبلغ المسحوب من الخزينة يجب أن يكون أكبر من صفر');
      return;
    }
    if (foreignNum <= 0) {
      toast.error('المبلغ المحول للمصنع يجب أن يكون أكبر من صفر');
      return;
    }
    const requiredEvidence = paymentMethodEvidenceFields(paymentMethod);
    const missingEvidence = requiredEvidence.filter((f) => !(evidence as any)[f]?.trim());
    if (missingEvidence.length > 0) {
      toast.error('طريقة الدفع المختارة تتطلب استكمال بيانات الإثبات قبل التسجيل');
      return;
    }
    if (paymentMethod === 'cash_carried' && !custodyAccountId) {
      toast.error('الدفع النقدي المحمول يتطلب اختيار حساب العهدة النقدية صراحة');
      return;
    }

    const contractRate = selectedPi?.exchange_rate_contract ? Number(selectedPi.exchange_rate_contract) : undefined;
    const payload = buildForeignTransferPayload(
      {
        supplierId: selectedSupplier,
        amountEgp: egpNum,
        amountForeign: foreignNum,
        notes,
        proformaInvoiceId: selectedPiId || undefined,
        exchangeRateContract: contractRate && contractRate > 0 ? contractRate : undefined,
        bankAccountId: custodyAccountId ? Number(custodyAccountId) : undefined,
      },
      paymentMethod,
      evidence,
    );
    const fingerprint = JSON.stringify(payload);
    if (!transferAttempt.current || transferAttempt.current.fingerprint !== fingerprint) {
      transferAttempt.current = { fingerprint, key: crypto.randomUUID() };
    }

    transferMutation.mutate({
      ...payload,
      idempotencyKey: transferAttempt.current.key,
    }, {
      onSuccess: () => {
        transferAttempt.current = null;
        toast.success('تم تسجيل الحوالة البنكية وتحديث مديونية المصنع والخزينة بنجاح');
        setAmountEgp('');
        setAmountForeign('');
        setSelectedPiId('');
        setNotes('');
        setEvidence({});
        setCustodyAccountId('');
        void suppliersQuery.refetch();
        void chinaSuppliersQuery.refetch();
        void treasuryQuery.refetch();
        void transfersQuery.refetch();
        void proformasQuery.refetch();
      }
    });
  };

  const handleRefresh = () => {
    void suppliersQuery.refetch();
    void chinaSuppliersQuery.refetch();
    void treasuryQuery.refetch();
    void transfersQuery.refetch();
    void proformasQuery.refetch();
  };

  return (
    <div className="page-stack page-shell import-sales-page" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto', width: '100%' }}>
        <PageHeader 
          title={t('import_sales.supplier_credit.s0', "محفظة سداد موردي الخارج (مديونية المصانع)")} 
          description={t('import_sales.supplier_credit.s1', "متابعة مديونيات المصانع الأجنبية وتسجيل حوالات الدفع وتدبير العملة وحساب سعر الصرف الفعلي.")}
          actions={
            <div className="actions compact-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button 
                variant="secondary" 
                onClick={handleRefresh}
                disabled={suppliersQuery.isLoading || chinaSuppliersQuery.isLoading || transfersQuery.isLoading}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
              >
                <RefreshCwIcon size={15} />
                <span>{t('import_sales.supplier_credit.s2', "تحديث البيانات")}</span>
              </Button>
            </div>
          } 
        />

        {/* KPI Metrics Cards */}
        {isFactoriesLoading && <LoadingState title="جاري تحميل مديونية المصانع..." />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '14px', marginBottom: '16px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>إجمالي مديونية المصانع (الدفتري)</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                {isFactoriesLoading ? '—' : (<>{totalDebtEgp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}><CurrencySymbol /></span></>)}
              </div>
            </div>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#eff6ff', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e40af' }}>
              <BuildingIcon size={20} />
            </div>
          </div>

          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>الرصيد المتاح بالخزينة النقدية</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: availableEgp < 0 ? '#dc2626' : '#0f172a', marginTop: '4px' }}>
                {isTreasuryLoading ? '—' : formatCurrency(availableEgp)}
              </div>
            </div>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#f0fdf4', border: '1px solid #dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#15803d' }}>
              <CreditCardIcon size={20} />
            </div>
          </div>

          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>المصانع والشركات المسجلة</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>
                {isFactoriesLoading ? '—' : factories.length} <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>مصنع</span>
              </div>
            </div>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
              <GlobeIcon size={20} />
            </div>
          </div>
        </div>

        {/* Transfer Entry Card */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px 24px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '18px' }}>
            <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#170e5e', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <SlidersIcon size={18} />
              <span>تسجيل حوالة بنكية جديدة لمصنع خارجي</span>
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
              خصم القيمة بالجنيه من الخزينة وتخفيض مديونية المصنع بالعملة الأجنبية مع حساب سعر الصرف الفعلي.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Row 1: Supplier & Proforma */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                  المصنع / المورد الأجنبي <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select 
                  style={{
                    width: '100%',
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.84rem',
                    background: '#ffffff',
                    color: '#0f172a',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                  value={selectedSupplier}
                  onChange={e => { setSelectedSupplier(e.target.value); setSelectedPiId(''); }}
                  required
                  disabled={transferMutation.isPending || isFactoriesLoading}
                >
                  {isFactoriesLoading ? (
                    <option value="">جاري تحميل المصانع...</option>
                  ) : (
                    <option value="">-- اختر المصنع الأجنبي --</option>
                  )}
                  {factories.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name} {f.city ? `(${f.city})` : ''} {f.chineseName ? `- ${f.chineseName}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b' }}>
                    ربط بفاتورة مبدئية (PI)
                  </label>
                  {selectedPi && (
                    <button
                      type="button"
                      onClick={handleFillPiRemaining}
                      style={{
                        background: '#eff6ff',
                        color: '#1d4ed8',
                        border: '1px solid #bfdbfe',
                        borderRadius: '6px',
                        padding: '1px 8px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      سداد كامل المتبقي
                    </button>
                  )}
                </div>
                <select
                  style={{
                    width: '100%',
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.84rem',
                    background: '#ffffff',
                    color: '#0f172a',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                  value={selectedPiId}
                  onChange={e => handleSelectPi(e.target.value)}
                  disabled={transferMutation.isPending}
                >
                  <option value="">-- تحويل حر غير مقيد بفاتورة مبدئية --</option>
                  {supplierProformas.map((pi: any) => {
                    const remaining = Math.max(0, Number(pi.total_amount_foreign || 0) - Number(pi.paid_amount_foreign || 0));
                    return (
                      <option key={pi.id} value={pi.id}>
                        {pi.pi_number} (المتبقي: ${remaining.toLocaleString()} | العقد: {pi.exchange_rate_contract || 50} ج)
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Row 2: Amounts & FX Rate */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                  المسحوب من الخزينة (ج.م) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input 
                  type="number" 
                  min="0" 
                  step="0.01" 
                  placeholder="0.00"
                  style={{
                    width: '100%',
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.84rem',
                    background: '#ffffff',
                    color: '#0f172a',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                  value={amountEgp}
                  onChange={e => setAmountEgp(e.target.value)}
                  required
                  disabled={transferMutation.isPending}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                  المبلغ المحول للمصنع ($) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input 
                  type="number" 
                  min="0" 
                  step="0.01" 
                  placeholder="0.00"
                  style={{
                    width: '100%',
                    height: '38px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    padding: '0 12px',
                    fontSize: '0.84rem',
                    background: '#ffffff',
                    color: '#0f172a',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                  value={amountForeign}
                  onChange={e => setAmountForeign(e.target.value)}
                  required
                  disabled={transferMutation.isPending}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                  سعر الصرف الفعلي للحوالة
                </label>
                <div style={{
                  width: '100%',
                  height: '38px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  padding: '0 12px',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  color: '#170e5e',
                  display: 'flex',
                  alignItems: 'center',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                }}>
                  {exchangeRate} <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b', marginInlineStart: '6px' }}>ج.م / $</span>
                </div>
              </div>
            </div>

            {/* Row 2b: Payment method & evidence */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                  طريقة الدفع <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <select
                  style={{
                    width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1',
                    padding: '0 12px', fontSize: '0.84rem', background: '#ffffff', color: '#0f172a',
                    boxSizing: 'border-box', outline: 'none',
                  }}
                  value={paymentMethod}
                  onChange={e => { setPaymentMethod(e.target.value); setEvidence({}); }}
                  disabled={transferMutation.isPending}
                >
                  {IMPORT_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{IMPORT_PAYMENT_METHOD_LABELS[m]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                  حساب الخزينة / البنك المصدر {paymentMethod === 'cash_carried' ? <span style={{ color: '#ef4444' }}>*</span> : '(اختياري — الافتراضي من الإعدادات)'}
                </label>
                <select
                  style={{
                    width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1',
                    padding: '0 12px', fontSize: '0.84rem', background: '#ffffff', color: '#0f172a',
                    boxSizing: 'border-box', outline: 'none',
                  }}
                  value={custodyAccountId}
                  onChange={e => setCustodyAccountId(e.target.value)}
                  required={paymentMethod === 'cash_carried'}
                  disabled={transferMutation.isPending}
                >
                  <option value="">-- الحساب الافتراضي من الإعدادات --</option>
                  {cashBankAccounts.map((acc: any) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.nameAr || acc.nameEn || acc.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {(() => {
              const evidenceFields = [
                ...paymentMethodEvidenceFields(paymentMethod),
                ...(paymentMethod === 'bank_transfer' ? ['bankSwiftCode', 'form4Number', 'form4Date'] : []),
              ];
              if (evidenceFields.length === 0) return null;
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  {evidenceFields.map((field) => {
                    const meta = EVIDENCE_FIELD_META[field];
                    return (
                      <div key={field}>
                        <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                          {meta.label} {meta.optional ? '' : <span style={{ color: '#ef4444' }}>*</span>}
                        </label>
                        <input
                          type={meta.type || 'text'}
                          style={{
                            width: '100%', height: '38px', borderRadius: '8px', border: '1px solid #cbd5e1',
                            padding: '0 12px', fontSize: '0.84rem', background: '#ffffff', color: '#0f172a',
                            boxSizing: 'border-box', outline: 'none',
                          }}
                          value={(evidence as any)[field] || ''}
                          onChange={e => setEvidence((prev) => ({ ...prev, [field]: e.target.value }))}
                          required={!meta.optional}
                          disabled={transferMutation.isPending}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Row 3: Notes & SWIFT details */}
            <div style={{ marginBottom: '18px' }}>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                بيانات البنك والتحويل
              </label>
              <input 
                type="text" 
                placeholder="رقم الحوالة البنكية، كود السويفت SWIFT، اسم البنك المنفذ، أو أي ملاحظات..."
                style={{
                  width: '100%',
                  height: '38px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  padding: '0 12px',
                  fontSize: '0.84rem',
                  background: '#ffffff',
                  color: '#0f172a',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={transferMutation.isPending}
              />
            </div>

            {/* Form Footer Action */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
              <Button 
                type="submit" 
                variant="primary" 
                disabled={transferMutation.isPending}
                style={{
                  height: '38px',
                  padding: '0 24px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  background: '#170e5e',
                  color: '#ffffff',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                }}
              >
                <CheckCircleIcon size={16} />
                <span>{transferMutation.isPending ? "جاري تسجيل الحوالة..." : "تأكيد تسجيل الحوالة"}</span>
              </Button>
            </div>
          </form>
        </div>

        {/* Transfers History Table */}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 800, color: '#0f172a' }}>
                سجل حوالات المصانع الأجنبية
              </h3>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                الحوالات والتحويلات البنكية الصادرة لموردي ومصانع الخارج
              </p>
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, background: '#ffffff', color: '#475569', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '12px' }}>
              {(transfersQuery.data || []).length} حوالة مسجلة
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem', textAlign: 'right' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '0.78rem', fontWeight: 700 }}>
                  <th style={{ padding: '10px 14px', width: '100px' }}>كود الحوالة</th>
                  <th style={{ padding: '10px 14px', width: '120px' }}>تاريخ الحوالة</th>
                  <th style={{ padding: '10px 14px', minWidth: '160px' }}>المصنع / المورد الأجنبي</th>
                  <th style={{ padding: '10px 14px', width: '130px' }}>المبلغ بالدولار ($)</th>
                  <th style={{ padding: '10px 14px', width: '140px' }}>المقابل بالجنيه (ج.م)</th>
                  <th style={{ padding: '10px 14px', width: '110px' }}>سعر الصرف</th>
                  <th style={{ padding: '10px 14px', minWidth: '200px' }}>البيان والملاحظات البنكية</th>
                  <th style={{ padding: '10px 14px', width: '100px', textAlign: 'center' }}>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {transfersQuery.isLoading ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                      جاري تحميل سجل الحوالات...
                    </td>
                  </tr>
                ) : (transfersQuery.data || []).length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center' }}>
                      <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px auto', color: '#94a3b8' }}>
                        <FileTextIcon size={22} />
                      </div>
                      <div style={{ fontWeight: 700, color: '#334155', fontSize: '0.88rem' }}>لا توجد حوالات أجنبية مسجلة بعد</div>
                      <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: '4px' }}>قم بتسجيل حوالة جديدة من النموذج أعلاه لتدبير العملة للمصانع.</div>
                    </td>
                  </tr>
                ) : (
                  (transfersQuery.data || []).map((row: any, idx: number) => {
                    const rawDate = row.paymentDate || row.payment_date || row.createdAt || row.created_at;
                    const dateDisplay = rawDate ? new Date(rawDate).toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
                    const supplierName = row.supplierName || row.supplier_name || '—';
                    const foreignAmount = Number(row.amountForeign ?? row.amount_foreign ?? (row.currency !== 'EGP' ? row.amount : 0) ?? 0);
                    const egpAmount = Number(row.amountEgp ?? row.amount_egp ?? (row.currency === 'EGP' ? row.amount : 0) ?? 0);
                    const rate = row.exchangeRate || row.exchange_rate || (foreignAmount > 0 && egpAmount > 0 ? (egpAmount / foreignAmount).toFixed(2) : '—');
                    const noteText = row.notes || row.note || '—';
                    const docNumber = row.docNo || row.doc_no || `FT-${row.id}`;

                    return (
                      <tr 
                        key={row.id || idx} 
                        style={{ 
                          borderBottom: '1px solid #f1f5f9',
                          background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                        }}
                      >
                        <td style={{ padding: '11px 14px', fontFamily: 'monospace', fontWeight: 700, color: '#170e5e', fontSize: '0.8rem' }}>
                          {docNumber}
                        </td>
                        <td style={{ padding: '11px 14px', color: '#475569', fontWeight: 600, fontFamily: 'monospace', fontSize: '0.8rem' }}>
                          {dateDisplay}
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 700, color: '#0f172a' }}>
                          {supplierName}
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 800, color: '#047857', fontFamily: 'monospace', fontSize: '0.86rem' }}>
                          {foreignAmount > 0 ? foreignAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b' }}>$</span>
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', fontSize: '0.84rem' }}>
                          {egpAmount > 0 ? egpAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} <span style={{ fontSize: '0.74rem', fontWeight: 500, color: '#64748b' }}>ج.م</span>
                        </td>
                        <td style={{ padding: '11px 14px', color: '#475569', fontFamily: 'monospace', fontSize: '0.82rem' }}>
                          {rate} <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>ج.م/$</span>
                        </td>
                        <td style={{ padding: '11px 14px', color: '#334155', fontSize: '0.82rem', maxWidth: '280px', wordBreak: 'break-word' }}>
                          {noteText}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                          <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#15803d', padding: '3px 9px', borderRadius: '12px', fontWeight: 700, display: 'inline-block' }}>
                            تم التنفيذ
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
