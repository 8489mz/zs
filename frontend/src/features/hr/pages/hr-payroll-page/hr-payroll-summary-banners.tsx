import { Button } from '@/shared/ui/button';
import type { HrPayrollRun, HrPayrollRunItem } from '@/types/domain';
import type { NavigateFunction } from 'react-router-dom';

export interface HrPayrollSummaryBannersProps {
  selectedRun: HrPayrollRun | undefined;
  canViewSalaryAmounts: boolean;
  summary: { totalNet: number; totalBase: number; totalBaseSalary: number; totalAllowances: number; totalDeductions: number; totalLoanDeduction: number; flaggedCount: number; needsReview: number; itemCount: number; totalEmployees: number; }
  isSelectedRunHourlyOrWeekly: boolean;
  navigate: NavigateFunction;
  runItems: HrPayrollRunItem[];
}

export function HrPayrollSummaryBanners({ selectedRun, canViewSalaryAmounts, summary, isSelectedRunHourlyOrWeekly, navigate, runItems }: HrPayrollSummaryBannersProps) {
  return (
    <>
    {selectedRun && canViewSalaryAmounts && summary.itemCount > 0 && summary.totalBaseSalary <= 0 ? (
      <div className="error-box" style={{ marginBottom: 12 }}>
        <strong>تنبيه: {isSelectedRunHourlyOrWeekly ? 'الأجر الأساسي' : 'الراتب الأساسي'} لكل موظفي الكشف صفر.</strong>
        <p style={{ margin: '6px 0' }}>راجع نوع الأجر وفترة القبض والعقد النشط للموظف الشهري، أو سعر الساعة وسجلات الحضور المكتملة للموظف بالساعة. لا تعتمد الكشف قبل تصحيح البيانات وإعادة الحساب.</p>
        <Button type="button" variant="secondary" onClick={() => navigate('/hr/employees')}>مراجعة بيانات الموظفين</Button>
      </div>
    ) : null}
    {selectedRun && canViewSalaryAmounts && runItems.some(item => Number(item.baseSalary || 0) <= 0) ? (
      <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <strong>موظفون يحتاجون مراجعة {isSelectedRunHourlyOrWeekly ? 'الأجر' : 'الراتب'}:</strong>
        <div className="actions compact-actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          {runItems.filter(item => Number(item.baseSalary || 0) <= 0).slice(0, 8).map(item => (
            <Button key={String(item.id)} type="button" variant="secondary"
              onClick={() => navigate(`/hr/employees/${item.employeeId}`)}>
              {item.employeeName || item.employeeNo || 'ملف موظف'}
            </Button>
          ))}
        </div>
      </div>
    ) : null}
    </>
  );
}
