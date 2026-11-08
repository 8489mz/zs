import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { StandardDialog, StandardDialogFooter } from '@/shared/components/StandardDialog';
import { CustomSelect } from '@/shared/ui/custom-select';
import { formatCurrency } from '@/lib/format';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

interface CreateInstallmentPlanModalProps {
  open: boolean;
  onClose: () => void;
  customers: any[];
  onSubmit: (data: {
    customerId: number;
    saleId: number | null;
    totalAmount: number;
    downPayment: number;
    interestRatePercent: number;
    installmentCount: number;
    startDate: string;
    // INV-INSTALLMENT-FIRST-DUE-DATE: the "first installment due
    // date" field the user entered; the schedule starts on it.
    firstDueDate: string;
    notes: string;
  }) => void;
  isPending: boolean;
}

export const CreateInstallmentPlanModal: React.FC<CreateInstallmentPlanModalProps> = ({
  open,
  onClose,
  customers,
  onSubmit,
  isPending,
}) => {
  const { t } = useTranslation();
  const [newPlan, setNewPlan] = useState({
    customerId: '',
    saleId: '',
    totalAmount: '',
    downPayment: '0',
    interestRatePercent: '0',
    installmentCount: '6',
    startDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const planPreview = useMemo(() => {
    const total = Number(newPlan.totalAmount || 0);
    const down = Number(newPlan.downPayment || 0);
    const financed = Math.max(0, total - down);
    const interestRate = Number(newPlan.interestRatePercent || 0);
    // INV-FE1-FRONTEND-BOOK-DIGITS: plan preview rounds at the
    // tenant's book digits (global system currency; no settings here).
    const digits = currencyMoneyDigits(getGlobalSystemCurrency());
    const interest = roundMoneyValue((financed * interestRate) / 100, digits);
    const totalWithInterest = roundMoneyValue(financed + interest, digits);
    const count = Math.max(1, Math.floor(Number(newPlan.installmentCount) || 1));
    const monthly = roundMoneyValue(totalWithInterest / count, digits);

    return {
      total,
      down,
      financed,
      interest,
      totalWithInterest,
      count,
      monthly,
    };
  }, [newPlan]);

  if (!open) return null;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newPlan.customerId || !Number(newPlan.totalAmount)) return;
    onSubmit({
      customerId: Number(newPlan.customerId),
      saleId: newPlan.saleId ? Number(newPlan.saleId) : null,
      totalAmount: Number(newPlan.totalAmount),
      downPayment: Number(newPlan.downPayment || 0),
      interestRatePercent: Number(newPlan.interestRatePercent || 0),
      installmentCount: Number(newPlan.installmentCount || 1),
      startDate: newPlan.startDate,
      // INV-INSTALLMENT-FIRST-DUE-DATE: the date field above is
      // labelled "first installment due date", so send it as the
      // schedule anchor; without this the backend keeps the old
      // one-month-later first due date.
      firstDueDate: newPlan.startDate,
      notes: newPlan.notes,
    });
  };

  const customerOptions = customers.map((c: any) => ({
    value: String(c.id),
    label: c.name,
    hint: c.phone || undefined,
  }));

  return (
    <StandardDialog
      isOpen={open}
      onClose={onClose}
      title={t('sales.create_installment_plan_modal.s0', "إنشاء خطة تقسيط جديدة")}
      subtitle={t('sales.create_installment_plan_modal.s1', "جدولة عقد بيع بالتقسيط واحتساب نسب الفائدة والأقساط الشهرية")}
      maxWidth="680px"
      footer={
        <StandardDialogFooter
          onClose={onClose}
          closeLabel={t('sales.create_installment_plan_modal.s2', "إلغاء")}
          primaryButton={{
            label: isPending ? t('sales.create_installment_plan_modal.s3', "جاري الحفظ والجدولة...") : t('sales.create_installment_plan_modal.s4', "حفظ وتوليد جدول الأقساط"),
            onClick: () => handleSubmit(),
            disabled: !newPlan.customerId || !Number(newPlan.totalAmount) || isPending,
          }}
        />
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Card 1: العميل والتمويل */}
        <div
          style={{
            padding: 16,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#170e5e', borderBottom: '1px solid #e2e8f0', paddingBottom: 6 }}>
            {t('sales.create_installment_plan_modal.s5', "بيانات العميل وقيمة التمويل")}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
              {t('sales.create_installment_plan_modal.s6', "اختر العميل المسجل *")}
            </label>
            <CustomSelect
              value={newPlan.customerId}
              onChange={(val) => setNewPlan({ ...newPlan, customerId: val })}
              options={customerOptions}
              placeholder={t('sales.create_installment_plan_modal.s7', "-- ابحث أو اختر العميل --")}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                {t('sales.create_installment_plan_modal.s8', "إجمالي قيمة البضاعة / الفاتورة *")}
              </label>
              <input
                type="number"
                placeholder={t('sales.create_installment_plan_modal.s9', "مثلاً: 12000")}
                value={newPlan.totalAmount}
                onChange={(e) => setNewPlan({ ...newPlan, totalAmount: e.target.value })}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                {t('sales.create_installment_plan_modal.s10', "المقدم المدفوع نقداً")}
              </label>
              <input
                type="number"
                placeholder="0"
                value={newPlan.downPayment}
                onChange={(e) => setNewPlan({ ...newPlan, downPayment: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                {t('sales.create_installment_plan_modal.s11', "نسبة الفائدة الإجمالية (%)")}
              </label>
              <input
                type="number"
                step="0.5"
                placeholder="0"
                value={newPlan.interestRatePercent}
                onChange={(e) => setNewPlan({ ...newPlan, interestRatePercent: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        </div>

        {/* Card 2: الجدولة والملاحظات */}
        <div
          style={{
            padding: 16,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#170e5e', borderBottom: '1px solid #e2e8f0', paddingBottom: 6 }}>
            {t('sales.create_installment_plan_modal.s12', "جدولة الأقساط والشروط")}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                {t('sales.create_installment_plan_modal.s13', "عدد شهور التقسيط *")}
              </label>
              <input
                type="number"
                min="1"
                max="60"
                value={newPlan.installmentCount}
                onChange={(e) => setNewPlan({ ...newPlan, installmentCount: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                {t('sales.create_installment_plan_modal.s14', "تاريخ استحقاق أول قسط *")}
              </label>
              <input
                type="date"
                value={newPlan.startDate}
                onChange={(e) => setNewPlan({ ...newPlan, startDate: e.target.value })}
                required
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '13px', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
              {t('sales.create_installment_plan_modal.s15', "ملاحظات أو شروط العقد والضمانات")}
            </label>
            <input
              type="text"
              placeholder={t('sales.create_installment_plan_modal.s16', "مثلاً: بضمان شيكات بنكية، إيصال أمانة، كفيل غارم...")}
              value={newPlan.notes}
              onChange={(e) => setNewPlan({ ...newPlan, notes: e.target.value })}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        {/* Calculator Preview Box */}
        <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '10px' }}>
            {t('sales.create_installment_plan_modal.s17', "معاينة حاسبة التقسيط الفورية:")}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', textAlign: 'center' }}>
            <div style={{ padding: 8, background: '#f8fafc', borderRadius: 8 }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>{t('sales.create_installment_plan_modal.s18', "المبلغ الممول")}</div>
              <div style={{ fontSize: '13.5px', fontWeight: 'bold', color: '#0f172a', marginTop: 2 }}>
                {formatCurrency(planPreview.financed)}
              </div>
            </div>
            <div style={{ padding: 8, background: '#f8fafc', borderRadius: 8 }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>{t('sales.create_installment_plan_modal.s19', "قيمة الفوائد")}</div>
              <div style={{ fontSize: '13.5px', fontWeight: 'bold', color: '#d97706', marginTop: 2 }}>
                {formatCurrency(planPreview.interest)}
              </div>
            </div>
            <div style={{ padding: 8, background: '#f8fafc', borderRadius: 8 }}>
              <div style={{ fontSize: '11px', color: '#64748b' }}>{t('sales.create_installment_plan_modal.s20', "إجمالي الدين بالفوائد")}</div>
              <div style={{ fontSize: '13.5px', fontWeight: 'bold', color: '#0f172a', marginTop: 2 }}>
                {formatCurrency(planPreview.totalWithInterest)}
              </div>
            </div>
            <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '8px' }}>
              <div style={{ fontSize: '11px', color: '#047857', fontWeight: 600 }}>{t('sales.create_installment_plan_modal.s21', "القسط الشهري")}</div>
              <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#065f46', marginTop: 2 }}>
                {formatCurrency(planPreview.monthly)}
              </div>
            </div>
          </div>
        </div>
      </form>
    </StandardDialog>
  );
};
