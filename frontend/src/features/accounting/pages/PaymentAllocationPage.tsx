import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { PageHeader } from '@/shared/components/page-header';
import { AppIcons } from '@/shared/components/icons/AppIcons';
import { formatCurrency } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { customersApi } from '@/shared/api/customers.api';
import { suppliersApi } from '@/shared/api/suppliers.api';
import {
  paymentAllocationApi,
  OpenInvoiceItem,
  UnallocatedPaymentItem,
} from '../api/accounting.api';
import { PartnerSelectorBar } from '../components/payment-allocation/PartnerSelectorBar';
import { UnallocatedPaymentsCard } from '../components/payment-allocation/UnallocatedPaymentsCard';
import { OpenInvoicesCard } from '../components/payment-allocation/OpenInvoicesCard';

export const PaymentAllocationPage: React.FC = () => {
  const { t } = useTranslation();
  const [partnerType, setPartnerType] = useState<'customer' | 'supplier'>('customer');
  const [partnerId, setPartnerId] = useState<number | null>(null);

  const [partners, setPartners] = useState<{ id: number; name: string; phone?: string }[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);

  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceItem[]>([]);
  const [unallocatedPayments, setUnallocatedPayments] = useState<UnallocatedPaymentItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null);
  const [allocationInputs, setAllocationInputs] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    setPartnerId(null);
    setOpenInvoices([]);
    setUnallocatedPayments([]);
    setSelectedPaymentId(null);
    setAllocationInputs({});
    setFeedback(null);
    loadPartners();
  }, [partnerType]);

  const loadPartners = async () => {
    setLoadingPartners(true);
    try {
      if (partnerType === 'customer') {
        const res = await customersApi.list();
        const list = Array.isArray(res) ? res : (res as any)?.customers || [];
        setPartners(list.map((c: any) => ({ id: Number(c.id), name: c.name, phone: c.phone })));
      } else {
        const res = await suppliersApi.list();
        const list = Array.isArray(res) ? res : (res as any)?.suppliers || [];
        setPartners(list.map((s: any) => ({ id: Number(s.id), name: s.name, phone: s.phone })));
      }
    } catch {
      setPartners([]);
    } finally {
      setLoadingPartners(false);
    }
  };

  useEffect(() => {
    if (!partnerId) {
      setOpenInvoices([]);
      setUnallocatedPayments([]);
      setSelectedPaymentId(null);
      setAllocationInputs({});
      return;
    }
    loadPartnerData(partnerId);
  }, [partnerId, partnerType]);

  const loadPartnerData = async (pId: number) => {
    setLoadingData(true);
    setFeedback(null);
    setSelectedPaymentId(null);
    setAllocationInputs({});
    try {
      const [invs, pymts] = await Promise.all([
        paymentAllocationApi.getOpenInvoices(partnerType, pId),
        paymentAllocationApi.getUnallocatedPayments(partnerType, pId),
      ]);
      setOpenInvoices(invs || []);
      setUnallocatedPayments(pymts || []);
      if (pymts && pymts.length > 0) {
        setSelectedPaymentId(pymts[0].id);
      }
    } catch (err: any) {
      setFeedback({ text: err?.message || 'تعذر تحميل بيانات الفواتير والسندات', error: true });
    } finally {
      setLoadingData(false);
    }
  };

  const selectedPayment = unallocatedPayments.find((p) => p.id === selectedPaymentId) || null;
  const availableToAllocate = selectedPayment ? selectedPayment.unallocatedAmount : 0;
  const totalAllocating = Object.values(allocationInputs).reduce((sum, val) => sum + (Number(val) || 0), 0);
  // INV-FE3-FRONTEND-BOOK-DIGITS: the remaining balance gates the
  // allocation, so it rounds at the tenant's book digits, not 2dp.
  const remainingPaymentBalance = roundMoneyValue(availableToAllocate - totalAllocating, currencyMoneyDigits(getGlobalSystemCurrency()));

  const handleAmountChange = (invoiceId: number, maxRemaining: number, valStr: string) => {
    const val = parseFloat(valStr) || 0;
    const clampedVal = Math.min(Math.max(0, val), maxRemaining);
    setAllocationInputs((prev) => ({
      ...prev,
      [invoiceId]: clampedVal,
    }));
  };

  const handleAutoFIFO = async () => {
    if (!partnerId || !selectedPaymentId) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await paymentAllocationApi.autoAllocateFIFO(partnerType, partnerId, selectedPaymentId);
      setFeedback({
        text: `تمت التسوية الآلية (FIFO) بنجاح! تم تخصيص ${formatCurrency(res.totalAllocated)} على ${res.count} فاتورة.`,
      });
      loadPartnerData(partnerId);
    } catch (err: any) {
      setFeedback({ text: err?.message || 'تعذر إجراء التسوية الآلية', error: true });
    } finally {
      setSaving(false);
    }
  };

  const handleManualAllocate = async () => {
    if (!partnerId) return;

    const allocations = Object.entries(allocationInputs)
      .map(([invId, amt]) => ({ invoiceId: Number(invId), amount: Number(amt) }))
      .filter((a) => a.amount > 0);

    if (!allocations.length) {
      setFeedback({ text: 'يرجى إدخال مبلغ مخصص لواحد أو أكثر من الفواتير', error: true });
      return;
    }

    if (selectedPayment && totalAllocating > selectedPayment.unallocatedAmount + 0.01) {
      setFeedback({ text: 'إجمالي المبالغ المخصصة يتجاوز الرصيد المتاح من السند المختار', error: true });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const res = await paymentAllocationApi.allocatePayment({
        partnerType,
        partnerId,
        paymentType: partnerType === 'customer' ? 'customer_payment' : 'supplier_payment',
        paymentId: selectedPaymentId,
        allocations,
        notes: notes.trim() || undefined,
      });

      setFeedback({
        text: `تم حفظ التخصيص والمطابقة بنجاح! تم تخصيص ${formatCurrency(res.totalAllocated)} على ${res.count} فاتورة.`,
      });
      loadPartnerData(partnerId);
    } catch (err: any) {
      setFeedback({ text: err?.message || 'تعذر حفظ التخصيص', error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '100px' }}>
        <PageHeader
          title={t('accounting.payment_allocation_page.s0', "تسوية وتخصيص المدفوعات على الفواتير (Payment Allocation & Reconciliation)")}
          description={t('accounting.payment_allocation_page.s1', "مطابقة وتوزيع سندات القبض والدفع النقدية والبنكية على الفواتير المفتوحة وفق المعايير المحاسبية المعتمدة (FIFO و IFRS).")}
          badge={<span className="nav-pill">{t('accounting.payment_allocation_page.s2', "المحاسبة والتسويات")}</span>}
        />

        {feedback && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: feedback.error ? '#fef2f2' : '#f0fdf4',
              color: feedback.error ? '#991b1b' : '#166534',
              border: `1px solid ${feedback.error ? '#fecaca' : '#bbf7d0'}`,
              marginBottom: '16px',
            }}
          >
            {feedback.text}
          </div>
        )}

        {/* Partner Selection */}
        <PartnerSelectorBar
          partnerType={partnerType}
          setPartnerType={setPartnerType}
          partnerId={partnerId}
          setPartnerId={setPartnerId}
          partners={partners}
          loadingPartners={loadingPartners}
        />

        {loadingData ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontSize: '14px' }}>
            {t('accounting.payment_allocation_page.s3', "جاري تحميل الفواتير والسندات...")}
          </div>
        ) : partnerId ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '20px', alignItems: 'start' }}>
            <UnallocatedPaymentsCard
              partnerType={partnerType}
              payments={unallocatedPayments}
              selectedPaymentId={selectedPaymentId}
              setSelectedPaymentId={setSelectedPaymentId}
              selectedPayment={selectedPayment}
              remainingPaymentBalance={remainingPaymentBalance}
              onAutoFIFO={handleAutoFIFO}
              saving={saving}
              hasOpenInvoices={openInvoices.length > 0}
            />

            <OpenInvoicesCard
              partnerType={partnerType}
              invoices={openInvoices}
              allocationInputs={allocationInputs}
              onAmountChange={handleAmountChange}
              notes={notes}
              setNotes={setNotes}
              totalAllocating={totalAllocating}
              onManualAllocate={handleManualAllocate}
              saving={saving}
              selectedPayment={selectedPayment}
            />
          </div>
        ) : (
          <div
            style={{
              padding: '60px 20px',
              textAlign: 'center',
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              color: '#64748b',
            }}
          >
            <AppIcons.FileText size={42} color="#94a3b8" />
            <div style={{ marginTop: '12px', fontSize: '15px', fontWeight: 700, color: '#334155' }}>
              {t('accounting.payment_allocation_page.s4', "اختر عميلاً أو مورداً للبدء في تخصيص ومطابقة المدفوعات")}
            </div>
            <div style={{ marginTop: '4px', fontSize: '13px', color: '#94a3b8' }}>
              {t('accounting.payment_allocation_page.s5', "يمكنك ربط كل سند دفع أو تحصيل بفاتورة معينة أو إجراء تسوية أوتوماتيكية بنظام FIFO")}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
