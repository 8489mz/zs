import { money } from '@/features/hr/pages/payroll/hr-payroll.helpers';

export interface PayrollReviewItemModalKpiStripProps {
  isHourly: boolean;
  canViewSalaryAmounts: boolean;
  baseSalary: number;
  calculatedHours: number;
  hourlyRate: number;
  allowanceAmount: number;
  totalDeductions: number;
  netPay: number;
}

export function PayrollReviewItemModalKpiStrip({ isHourly, canViewSalaryAmounts, baseSalary, calculatedHours, hourlyRate, allowanceAmount, totalDeductions, netPay }: PayrollReviewItemModalKpiStripProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '18px' }}>
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
          {isHourly ? 'أجر ساعات العمل' : 'الأساسي التعاقدي'}
        </div>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
          {canViewSalaryAmounts ? money(baseSalary) : '—'}
        </div>
        {isHourly && calculatedHours > 0 && hourlyRate > 0 && (
          <div style={{ fontSize: '10.5px', color: '#166534', fontWeight: 700, marginTop: '2px' }}>
            {calculatedHours} س × {money(hourlyRate)}
          </div>
        )}
      </div>
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>البدلات والإضافي</div>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#166534' }}>
          {canViewSalaryAmounts ? money(allowanceAmount) : '—'}
        </div>
      </div>
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>الاستقطاعات والجزاءات</div>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#dc2626' }}>
          {canViewSalaryAmounts ? money(totalDeductions) : '—'}
        </div>
      </div>
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 12px' }}>
        <div style={{ fontSize: '11px', color: '#166534', fontWeight: 600, marginBottom: '2px' }}>
          {isHourly ? 'صافي الأجر المستحق' : 'صافي الراتب المستحق'}
        </div>
        <div style={{ fontSize: '15px', fontWeight: 800, color: '#15803d' }}>
          {canViewSalaryAmounts ? money(netPay) : '—'}
        </div>
      </div>
    </div>
  );
}
