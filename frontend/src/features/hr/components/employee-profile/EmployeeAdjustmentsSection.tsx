import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { HrEmployeeAdjustment } from '@/types/domain';
import { money, fallbackText } from '@/features/hr/utils/employee-profile.helpers';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { Button } from '@/shared/ui/button';
import { FormSection } from '@/shared/components/form-section';

interface EmployeeAdjustmentsSectionProps {
  adjustments: HrEmployeeAdjustment[];
  canManage: boolean;
  onAddAdjustment: (payload: any) => Promise<void>;
  onDeleteAdjustment: (id: string) => Promise<void>;
  isBusy: boolean;
}

export function EmployeeAdjustmentsSection({ adjustments, canManage, onAddAdjustment, onDeleteAdjustment, isBusy }: EmployeeAdjustmentsSectionProps) {
  const { t } = useTranslation();
  const [showAddForm, setShowAddForm] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState<'allowance' | 'deduction'>('allowance');
  const [amountType, setAmountType] = useState<'money' | 'days' | 'hours'>('money');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setError('الرجاء إدخال مبلغ صحيح أكبر من الصفر.');
      return;
    }
    if (!date) {
      setError('الرجاء إدخال التاريخ.');
      return;
    }
    // INV-FE3-FRONTEND-BOOK-DIGITS: a money adjustment must be exact at
    // the tenant's book digits — the old check rejected every valid
    // 3-decimal amount (0.125) on a 3-decimal tenant.
    if (amountType === 'money') {
      const bookDigits = currencyMoneyDigits(getGlobalSystemCurrency());
      const factor = 10 ** bookDigits;
      if (
        !Number.isSafeInteger(Math.round(Number(amount) * factor))
        || Math.abs(Number(amount) - roundMoneyValue(Number(amount), bookDigits)) > 0.000001
      ) {
        setError(`المبلغ النقدي لازم يكون بدقة ${bookDigits} منازل عشرية، مثال ${(125.5).toFixed(bookDigits)}.`);
        return;
      }
    }

    try {
      await onAddAdjustment({
        adjustmentType,
        amountType,
        amount: Number(amount),
        date,
        reason
      });
      setShowAddForm(false);
      setAmount('');
      setReason('');
      setDate('');
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء الإضافة');
    }
  };

  return (
    <FormSection title={t('hr.employee_profile.employee_adjustments_section.s0', "المكافآت والخصومات")} description={t('hr.employee_profile.employee_adjustments_section.s1', "سجل المكافآت أو الخصومات للموظف هنا. سيتم احتسابها تلقائياً مع أقرب مسير رواتب.")}>
      {canManage && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <Button type="button" onClick={() => setShowAddForm(!showAddForm)} disabled={isBusy}>
          {showAddForm ? t('hr.employee_profile.employee_adjustments_section.s2', "إلغاء") : t('hr.employee_profile.employee_adjustments_section.s3', "إضافة مكافأة / خصم")}
        </Button>
      </div>}

      {canManage && showAddForm && (
        <form onSubmit={handleSubmit} className="form-grid" style={{ marginBottom: '2rem', padding: '1rem', background: 'var(--bg-subtle)', borderRadius: 8 }}>
          <label className="field">
            <span>{t('hr.employee_profile.employee_adjustments_section.s4', "النوع")}</span>
            <select value={adjustmentType} onChange={e => setAdjustmentType(e.target.value as any)} disabled={isBusy}>
              <option value="allowance">{t('hr.employee_profile.employee_adjustments_section.s5', "مكافأة (إضافة)")}</option>
              <option value="deduction">{t('hr.employee_profile.employee_adjustments_section.s6', "خصم (استقطاع)")}</option>
            </select>
          </label>
          
          <label className="field">
            <span>{t('hr.employee_profile.employee_adjustments_section.s7', "نوع القيمة")}</span>
            <select value={amountType} onChange={e => setAmountType(e.target.value as any)} disabled={isBusy}>
              <option value="money">{t('hr.employee_profile.employee_adjustments_section.s8', "مبلغ نقدي")}</option>
              <option value="days">{t('hr.employee_profile.employee_adjustments_section.s9', "أيام")}</option>
              <option value="hours">{t('hr.employee_profile.employee_adjustments_section.s10', "ساعات")}</option>
            </select>
          </label>

          <label className="field">
            <span>{t('hr.employee_profile.employee_adjustments_section.s11', "القيمة")}</span>
            <input 
              type="number" 
              step={amountType === 'money' ? '0.01' : 'any'}
              min="0.01"
              value={amount} 
              onChange={e => setAmount(e.target.value)} 
              placeholder={t('hr.employee_profile.employee_adjustments_section.s12', "مثال: 500")} 
              disabled={isBusy}
            />
          </label>

          <label className="field">
            <span>{t('hr.employee_profile.employee_adjustments_section.s13', "التاريخ")}</span>
            <input 
              type="date" 
              value={date} 
              onChange={e => setDate(e.target.value)} 
              disabled={isBusy}
            />
          </label>

          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span>{t('hr.employee_profile.employee_adjustments_section.s14', "السبب / ملاحظات")}</span>
            <input 
              type="text" 
              value={reason} 
              onChange={e => setReason(e.target.value)} 
              placeholder={t('hr.employee_profile.employee_adjustments_section.s15', "سبب المكافأة أو الخصم")} 
              disabled={isBusy}
            />
          </label>

          {error && <div className="error-box" style={{ gridColumn: '1 / -1' }}>{error}</div>}

          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <Button type="submit" disabled={isBusy}>{t('hr.employee_profile.employee_adjustments_section.s16', "حفظ")}</Button>
          </div>
        </form>
      )}

      {adjustments.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('hr.employee_profile.employee_adjustments_section.s17', "التاريخ")}</th>
                <th>{t('hr.employee_profile.employee_adjustments_section.s18', "النوع")}</th>
                <th>{t('hr.employee_profile.employee_adjustments_section.s19', "القيمة")}</th>
                <th>{t('hr.employee_profile.employee_adjustments_section.s20', "السبب")}</th>
                <th>{t('hr.employee_profile.employee_adjustments_section.s21', "الحالة")}</th>
                {canManage && <th>{t('hr.employee_profile.employee_adjustments_section.s22', "إجراءات")}</th>}
              </tr>
            </thead>
            <tbody>
              {adjustments.map(adj => (
                <tr key={adj.id}>
                  <td>{adj.date}</td>
                  <td>
                    <span className={`badge ${adj.adjustmentType === 'allowance' ? 'success' : 'danger'}`}>
                      {adj.adjustmentType === 'allowance' ? t('hr.employee_profile.employee_adjustments_section.s23', "مكافأة") : t('hr.employee_profile.employee_adjustments_section.s24', "خصم")}
                    </span>
                  </td>
                  <td>
                    {adj.amountType === 'money' ? money(adj.amount) : `${adj.amount} ${adj.amountType === 'days' ? t('hr.employee_profile.employee_adjustments_section.s25', "أيام") : t('hr.employee_profile.employee_adjustments_section.s26', "ساعات")}`}
                  </td>
                  <td>{fallbackText(adj.reason)}</td>
                  <td>
                    <span className={`badge ${adj.status === 'applied' ? 'success' : 'warning'}`}>
                      {adj.status === 'applied' ? t('hr.employee_profile.employee_adjustments_section.s27', "تم الاحتساب") : t('hr.employee_profile.employee_adjustments_section.s28', "قيد الانتظار")}
                    </span>
                  </td>
                  {canManage && <td>
                    {adj.status === 'pending' && (
                      <Button type="button" variant="danger" onClick={() => onDeleteAdjustment(adj.id)} disabled={isBusy}>{t('hr.employee_profile.employee_adjustments_section.s29', "حذف")}</Button>
                    )}
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{t('hr.employee_profile.employee_adjustments_section.s30', "لا توجد مكافآت أو خصومات مسجلة.")}</p>
      )}
    </FormSection>
  );
}
