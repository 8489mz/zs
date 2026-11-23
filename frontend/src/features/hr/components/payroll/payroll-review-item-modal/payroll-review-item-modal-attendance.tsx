import { Button } from '@/shared/ui/button';
import { money, text } from '@/features/hr/pages/payroll/hr-payroll.helpers';
import type { HrPayrollRunItem } from '@/types/domain';

export interface PayrollReviewItemModalAttendanceProps {
  onNavigateToAttendance?: (employeeId: string) => void;
  item: HrPayrollRunItem;
  onNavigateToEmployee?: (employeeId: string) => void;
  isHourly: boolean;
  calculatedHours: number;
  deductionAmount: number;
}

export function PayrollReviewItemModalAttendance({ onNavigateToAttendance, item, onNavigateToEmployee, isHourly, calculatedHours, deductionAmount }: PayrollReviewItemModalAttendanceProps) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 16px', marginBottom: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
          <span>تدقيق البصمة والدوام للمسير</span>
        </div>

        {/* Root Edit Links */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {onNavigateToAttendance && (
            <Button
              variant="secondary"
              onClick={() => onNavigateToAttendance(item.employeeId)}
              style={{ padding: '2px 8px', fontSize: '11px', color: '#334155' }}
            >
              فتح سجل بصمات الموظف
            </Button>
          )}
          {onNavigateToEmployee && (
            <Button
              variant="secondary"
              onClick={() => onNavigateToEmployee(item.employeeId)}
              style={{ padding: '2px 8px', fontSize: '11px', color: '#334155' }}
            >
              فتح عقد وملف الموظف
            </Button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isHourly ? 4 : 3}, 1fr)`, gap: '10px', fontSize: '12px', marginBottom: (item.payrollReviewNotes || item.notes) ? '10px' : '0' }}>
        {isHourly && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '6px 10px' }}>
            <span style={{ color: '#166534', fontWeight: 600 }}>ساعات العمل المعتمدة: </span>
            <strong style={{ color: '#166534' }}>
              {calculatedHours > 0 ? `${calculatedHours} ساعة` : '0'}
            </strong>
          </div>
        )}
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 10px' }}>
          <span style={{ color: '#64748b' }}>أيام الغياب: </span>
          <strong style={{ color: Number(item.attendanceAbsentDays || 0) > 0 ? '#dc2626' : '#0f172a' }}>
            {item.attendanceAbsentDays || 0} يوم
          </strong>
        </div>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 10px' }}>
          <span style={{ color: '#64748b' }}>تأخير وانصراف مبكر: </span>
          <strong style={{ color: deductionAmount > 0 ? '#ea580c' : '#0f172a' }}>
            {deductionAmount > 0 ? `${money(deductionAmount)}` : 'لا يوجد'}
          </strong>
        </div>
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 10px' }}>
          <span style={{ color: '#64748b' }}>إجازات غير مدفوعة: </span>
          <strong>{item.unpaidLeaveDays || 0} يوم</strong>
        </div>
      </div>

      {(item.payrollReviewNotes || item.notes) && (
        <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', color: '#92400e' }}>
          <strong>تفاصيل مراجعة الحضور: </strong>
          <span>{text(item.payrollReviewNotes || item.notes)}</span>
        </div>
      )}
    </div>
  );
}
