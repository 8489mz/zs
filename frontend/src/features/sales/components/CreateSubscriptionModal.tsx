import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { formatCurrency } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { toast } from '@/shared/components/system-alert';
import { PlusIcon, Trash2Icon } from '@/shared/components/icons/AppIcons';
import { customersApi, type Customer } from '@/features/customers';
import { commercialSubscriptionsApi, type CreateSubscriptionPayload } from '../api/commercial-subscriptions.api';

interface CreateSubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const CreateSubscriptionModal: React.FC<CreateSubscriptionModalProps> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [contractNumber, setContractNumber] = useState('');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'quarterly' | 'semi_annual' | 'annual'>('monthly');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [autoRenew, setAutoRenew] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
  }>>([
    { description: 'خدمة اشتراك شهرية / صيانة دورية', quantity: 1, unitPrice: 1000, taxRate: 15 },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      customersApi.list().then((res) => {
        if (Array.isArray(res)) setCustomers(res);
        else if (res && Array.isArray((res as any).customers)) setCustomers((res as any).customers);
      }).catch((err) => {
        console.error('Failed to load customers', err);
      });
    }
  }, [open]);

  const customerOptions = customers.map((c) => ({
    value: String(c.id),
    label: `${c.name} ${c.phone ? `(${c.phone})` : ''}`,
  }));

  const billingPeriodOptions = [
    { value: 'monthly', label: 'شهري (Monthly)' },
    { value: 'quarterly', label: 'ربع سنوي (كل 3 أشهر)' },
    { value: 'semi_annual', label: 'نصف سنوي (كل 6 أشهر)' },
    { value: 'annual', label: 'سنوي (Annual)' },
  ];

  const paymentMethodOptions = [
    { value: 'bank_transfer', label: 'تحويل بنكي (Bank Transfer)' },
    { value: 'credit_card', label: 'بطاقة ائتمان (Credit Card)' },
    { value: 'direct_debit', label: 'خصم مباشر (Direct Debit)' },
    { value: 'cash', label: 'نقدي (Cash)' },
  ];

  const addLine = () => {
    setLines([...lines, { description: '', quantity: 1, unitPrice: 0, taxRate: 15 }]);
  };

  const removeLine = (idx: number) => {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: string, val: any) => {
    setLines(lines.map((l, i) => i === idx ? { ...l, [field]: val } : l));
  };

  const calculateSubtotal = () => {
    return lines.reduce((acc, l) => acc + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  };

  const calculateTax = () => {
    return lines.reduce((acc, l) => {
      const lineSub = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
      return acc + (lineSub * (Number(l.taxRate) || 0)) / 100;
    }, 0);
  };

  const subtotal = calculateSubtotal();
  const taxTotal = calculateTax();
  // INV-FE1-FRONTEND-BOOK-DIGITS: grand-total preview rounds at the
  // tenant's book digits (global system currency; no settings here).
  const grandTotal = roundMoneyValue(subtotal + taxTotal, currencyMoneyDigits(getGlobalSystemCurrency()));

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedCustomerId) {
      toast.warning('يرجى اختيار العميل');
      return;
    }
    if (lines.some((l) => !l.description.trim() || Number(l.quantity) <= 0 || Number(l.unitPrice) < 0)) {
      toast.warning('يرجى التحقق من صحة بنود الاشتراك');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: CreateSubscriptionPayload = {
        customerId: Number(selectedCustomerId),
        contractNumber: contractNumber.trim() || undefined,
        billingPeriod,
        startDate,
        endDate: endDate ? endDate : undefined,
        autoRenew,
        paymentMethod,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          taxRate: Number(l.taxRate) || 0,
        })),
      };

      await commercialSubscriptionsApi.create(payload);
      toast.success('تم إنشاء عقد الاشتراك وتفعيله بنجاح');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'فشل إنشاء عقد الاشتراك');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StandardDialog
      open={open}
      onClose={onClose}
      title={t('sales.create_subscription_modal.s0', "إنشاء عقد اشتراك تجاري وفوترة دورية (B2B Recurring Contract)")}
      subtitle={t('sales.create_subscription_modal.s1', "إدارة الاشتراكات والفوترة الآلية المتكررة للشركات والجهات المتعاقدة")}
      size="lg"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('sales.create_subscription_modal.s2', "العميل التعاقدي *")}
            </label>
            <CustomSelect
              value={selectedCustomerId}
              onChange={setSelectedCustomerId}
              options={customerOptions}
              placeholder={t('sales.create_subscription_modal.s3', "اختر العميل...")}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('sales.create_subscription_modal.s4', "دورية الفوترة *")}
            </label>
            <CustomSelect
              value={billingPeriod}
              onChange={(val) => setBillingPeriod(val as any)}
              options={billingPeriodOptions}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('sales.create_subscription_modal.s5', "رقم العقد (اختياري - يولد تلقائياً)")}
            </label>
            <input
              type="text"
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
              placeholder={t('sales.create_subscription_modal.s6', "مثال: SUB-260930-0001")}
              className="standard-input"
              style={{ width: '100%', height: '36px', padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('sales.create_subscription_modal.s7', "طريقة الدفع")}
            </label>
            <CustomSelect
              value={paymentMethod}
              onChange={setPaymentMethod}
              options={paymentMethodOptions}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('sales.create_subscription_modal.s8', "تاريخ بدء الفوترة *")}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="standard-input"
              style={{ width: '100%', height: '36px', padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              {t('sales.create_subscription_modal.s9', "تاريخ انتهاء العقد (اختياري)")}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="standard-input"
              style={{ width: '100%', height: '36px', padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="autoRenew"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <label htmlFor="autoRenew" style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
            {t('sales.create_subscription_modal.s10', "تجديد تلقائي بعد انتهاء المدة (Auto-Renew)")}
          </label>
        </div>

        {/* Lines Section */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', background: '#f8fafc' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#1e293b' }}>
              {t('sales.create_subscription_modal.s11', "بنود وقيمة الاشتراك المتكرر")}
            </h4>
            <button
              type="button"
              onClick={addLine}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 10px',
                fontSize: '12.5px',
                fontWeight: 600,
                color: '#170e5e',
                background: '#e0e7ff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              <PlusIcon size={14} />
              {t('sales.create_subscription_modal.s12', "إضافة بند")}
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #cbd5e1', color: '#64748b', textAlign: 'right' }}>
                <th style={{ padding: '8px' }}>{t('sales.create_subscription_modal.s13', "الوصف والخدمة")}</th>
                <th style={{ padding: '8px', width: '90px' }}>{t('sales.create_subscription_modal.s14', "الكمية")}</th>
                <th style={{ padding: '8px', width: '120px' }}>{t('sales.create_subscription_modal.s15', "سعر الوحدة")}</th>
                <th style={{ padding: '8px', width: '90px' }}>{t('sales.create_subscription_modal.s16', "الضريبة %")}</th>
                <th style={{ padding: '8px', width: '110px' }}>{t('sales.create_subscription_modal.s17', "الإجمالي")}</th>
                <th style={{ padding: '8px', width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) * (1 + (Number(line.taxRate) || 0) / 100);
                return (
                  <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px' }}>
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                        placeholder={t('sales.create_subscription_modal.s18', "بيان الخدمة أو الاشتراك...")}
                        style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                        required
                      />
                    </td>
                    <td style={{ padding: '6px' }}>
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                        style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                        required
                      />
                    </td>
                    <td style={{ padding: '6px' }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(idx, 'unitPrice', e.target.value)}
                        style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                        required
                      />
                    </td>
                    <td style={{ padding: '6px' }}>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={line.taxRate}
                        onChange={(e) => updateLine(idx, 'taxRate', e.target.value)}
                        style={{ width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      />
                    </td>
                    <td style={{ padding: '6px', fontWeight: 700, color: '#0f172a' }}>
                      {formatCurrency(lineTotal)}
                    </td>
                    <td style={{ padding: '6px', textAlign: 'center' }}>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                        >
                          <Trash2Icon size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', gap: '20px', fontSize: '13px' }}>
            <div>{t('sales.create_subscription_modal.s19', "المجموع:")} <strong>{formatCurrency(subtotal)}</strong></div>
            <div>{t('sales.create_subscription_modal.s20', "الضريبة:")} <strong>{formatCurrency(taxTotal)}</strong></div>
            <div style={{ color: '#170e5e', fontSize: '14px', fontWeight: 800 }}>
              {t('sales.create_subscription_modal.s21', "الإجمالي لكل دورة:")} {formatCurrency(grandTotal)}
            </div>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {t('sales.create_subscription_modal.s22', "ملاحظات وشروط العقد")}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder={t('sales.create_subscription_modal.s23', "شروط تجديد الاشتراك، أرقام المراجع، أو بنود الاتفاقية...")}
            style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', resize: 'vertical' }}
          />
        </div>

        <StandardDialogFooter
          onClose={onClose}
          primaryButton={{
            label: isSubmitting ? t('sales.create_subscription_modal.s24', "جاري الحفظ والتفعيل...") : t('sales.create_subscription_modal.s25', "اعتماد وإنشاء العقد"),
            disabled: isSubmitting,
            onClick: () => handleSubmit(),
          }}
        />
      </form>
    </StandardDialog>
  );
};
