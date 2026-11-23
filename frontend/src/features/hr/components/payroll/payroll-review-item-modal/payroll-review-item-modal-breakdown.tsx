import { money } from '@/features/hr/pages/payroll/hr-payroll.helpers';

export interface PayrollReviewItemModalBreakdownProps {
  isHourly: boolean;
  canViewSalaryAmounts: boolean;
  baseSalary: number;
  hourlyRate: number;
  calculatedHours: number;
  allowanceAmount: number;
  grossPay: number;
  deductionAmount: number;
  loanDeduction: number;
  insuranceDeduction: number;
  taxDeduction: number;
  totalDeductions: number;
}

export function PayrollReviewItemModalBreakdown({ isHourly, canViewSalaryAmounts, baseSalary, hourlyRate, calculatedHours, allowanceAmount, grossPay, deductionAmount, loanDeduction, insuranceDeduction, taxDeduction, totalDeductions }: PayrollReviewItemModalBreakdownProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '18px' }}>
      {/* Earnings Column */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', background: '#ffffff' }}>
        <div style={{ background: '#f0fdf4', padding: '8px 12px', borderBottom: '1px solid #dcfce7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#166534' }}>
            {isHourly ? 'استحقاقات الأجر (Earnings)' : 'الاستحقاقات المالية (Earnings)'}
          </span>
          <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }}>المبلغ (ج.م)</span>
        </div>
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '4px' }}>
            <span style={{ color: '#475569' }}>
              {isHourly ? 'أجر ساعات العمل (الأجر الأساسي):' : 'الراتب الأساسي:'}
            </span>
            <span style={{ fontWeight: 700, color: '#0f172a' }}>{canViewSalaryAmounts ? money(baseSalary) : '—'}</span>
          </div>
          {isHourly && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '6px 8px', fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#166534', fontWeight: 600 }}>أجر الساعة التعاقدي:</span>
                <strong style={{ color: '#166534' }}>{canViewSalaryAmounts && hourlyRate > 0 ? `${money(hourlyRate)} / ساعة` : '—'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#166534', fontWeight: 600 }}>ساعات العمل المحتسبة:</span>
                <strong style={{ color: '#1e40af' }}>{calculatedHours > 0 ? `${calculatedHours} ساعة` : '—'}</strong>
              </div>
              {hourlyRate > 0 && calculatedHours > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #86efac', paddingTop: '3px', marginTop: '2px', color: '#14532d', fontSize: '11px' }}>
                  <span>معادلة الأجر:</span>
                  <span dir="ltr" style={{ fontWeight: 700 }}>{calculatedHours} hrs × {money(hourlyRate)} = {money(baseSalary)}</span>
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '4px' }}>
            <span style={{ color: '#475569' }}>البدلات والمكافآت:</span>
            <span style={{ fontWeight: 600 }}>{canViewSalaryAmounts ? money(allowanceAmount) : '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '4px' }}>
            <span style={{ color: '#475569' }}>نوع الأجر والتعاقد:</span>
            <span style={{ fontWeight: 600, color: isHourly ? '#166534' : '#64748b' }}>
              {isHourly ? 'بالساعة / اليوم' : 'راتب شهري'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px', marginTop: '2px', borderTop: '1px solid #e2e8f0', fontWeight: 700 }}>
            <span style={{ color: '#0f172a' }}>إجمالي الاستحقاق (Gross):</span>
            <span style={{ color: '#166534' }}>{canViewSalaryAmounts ? money(grossPay) : '—'}</span>
          </div>
        </div>
      </div>

      {/* Deductions Column */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', background: '#ffffff' }}>
        <div style={{ background: '#fef2f2', padding: '8px 12px', borderBottom: '1px solid #fee2e2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#991b1b' }}>الاستقطاعات والجزاءات (Deductions)</span>
          <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 600 }}>المبلغ (ج.م)</span>
        </div>
        <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12.5px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '4px' }}>
            <span style={{ color: '#475569' }}>جزاءات الحضور (تأخير وغياب):</span>
            <span style={{ fontWeight: 600, color: deductionAmount > 0 ? '#dc2626' : 'inherit' }}>
              {canViewSalaryAmounts ? money(deductionAmount) : '—'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '4px' }}>
            <span style={{ color: '#475569' }}>أقساط السلف والمديونيات:</span>
            <span style={{ fontWeight: 600, color: loanDeduction > 0 ? '#dc2626' : 'inherit' }}>
              {canViewSalaryAmounts ? money(loanDeduction) : '—'}
            </span>
          </div>
          {insuranceDeduction > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '4px' }}>
              <span style={{ color: '#475569' }}>تأمينات اجتماعية:</span>
              <span style={{ fontWeight: 600, color: '#dc2626' }}>{canViewSalaryAmounts ? money(insuranceDeduction) : '—'}</span>
            </div>
          )}
          {taxDeduction > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed #f1f5f9', paddingBottom: '4px' }}>
              <span style={{ color: '#475569' }}>ضريبة كسب العمل:</span>
              <span style={{ fontWeight: 600, color: '#dc2626' }}>{canViewSalaryAmounts ? money(taxDeduction) : '—'}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px', marginTop: '2px', borderTop: '1px solid #e2e8f0', fontWeight: 700 }}>
            <span style={{ color: '#0f172a' }}>إجمالي الاستقطاعات:</span>
            <span style={{ color: '#dc2626' }}>{canViewSalaryAmounts ? money(totalDeductions) : '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
