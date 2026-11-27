import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import { money } from '@/features/hr/pages/payroll/hr-payroll.helpers';

type Props = {
  summary: {
    totalEmployees: number;
    totalBaseSalary: number;
    totalDeductions: number;
    totalLoanDeduction: number;
    totalNet: number;
    needsReview: number;
  };
  canViewSalaryAmounts: boolean;
};

export function HrPayrollSummaryCards({ summary, canViewSalaryAmounts }: Props) {
  const { t } = useTranslation();
  return (
    <div className="stats-grid">
      <FormSection title={t('hr.payroll.hr_payroll_summary_cards.s0', "إجمالي الموظفين")}><strong>{summary.totalEmployees || 0}</strong></FormSection>
      <FormSection title={t('hr.payroll.hr_payroll_summary_cards.s1', "إجمالي الرواتب الأساسية")}><strong>{canViewSalaryAmounts ? (summary.totalEmployees ? money(summary.totalBaseSalary) : t('hr.payroll.hr_payroll_summary_cards.s2', "غير متاح")) : t('hr.payroll.hr_payroll_summary_cards.s3', "لا تملك صلاحية عرض هذه البيانات.")}</strong></FormSection>
      <FormSection title={t('hr.payroll.hr_payroll_summary_cards.s4', "إجمالي الخصومات")}><strong>{canViewSalaryAmounts ? (summary.totalEmployees ? money(summary.totalDeductions) : t('hr.payroll.hr_payroll_summary_cards.s5', "غير متاح")) : t('hr.payroll.hr_payroll_summary_cards.s6', "لا تملك صلاحية عرض هذه البيانات.")}</strong></FormSection>
      <FormSection title={t('hr.payroll.hr_payroll_summary_cards.s7', "إجمالي السلف / الأقساط")}><strong>{canViewSalaryAmounts ? (summary.totalEmployees ? money(summary.totalLoanDeduction) : t('hr.payroll.hr_payroll_summary_cards.s8', "غير متاح")) : t('hr.payroll.hr_payroll_summary_cards.s9', "لا تملك صلاحية عرض هذه البيانات.")}</strong></FormSection>
      <FormSection title={t('hr.payroll.hr_payroll_summary_cards.s10', "صافي المرتبات")}><strong>{canViewSalaryAmounts ? (summary.totalEmployees ? money(summary.totalNet) : t('hr.payroll.hr_payroll_summary_cards.s11', "غير متاح")) : t('hr.payroll.hr_payroll_summary_cards.s12', "لا تملك صلاحية عرض هذه البيانات.")}</strong></FormSection>
      <FormSection title={t('hr.payroll.hr_payroll_summary_cards.s13', "يحتاج مراجعة")}><strong>{summary.needsReview}</strong></FormSection>
    </div>
  );
}
