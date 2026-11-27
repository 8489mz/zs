import { useTranslation } from 'react-i18next';
import { FormSection } from '@/shared/components/form-section';
import { countText, money } from '@/features/hr/pages/reports/hr-reports.helpers';

type Props = {
  summary: {
    employeeCount?: number;
    activeEmployeeCount?: number;
    payroll?: { totalNetPay?: number };
  } | undefined;
  attendanceTotal: string;
  leavesTotal: string;
  alertsCount: number;
};

export function HrReportsSummaryCards({ summary, attendanceTotal, leavesTotal, alertsCount }: Props) {
  const { t } = useTranslation();
  return (
    <div className="stats-grid">
      <FormSection title={t('hr.reports.hr_reports_summary_cards.s0', "إجمالي الموظفين")}><strong>{countText(summary?.employeeCount)}</strong></FormSection>
      <FormSection title={t('hr.reports.hr_reports_summary_cards.s1', "الموظفون النشطون")}><strong>{countText(summary?.activeEmployeeCount)}</strong></FormSection>
      <FormSection title={t('hr.reports.hr_reports_summary_cards.s2', "سجلات الحضور")}><strong>{attendanceTotal}</strong></FormSection>
      <FormSection title={t('hr.reports.hr_reports_summary_cards.s3', "طلبات الإجازات")}><strong>{leavesTotal}</strong></FormSection>
      <FormSection title={t('hr.reports.hr_reports_summary_cards.s4', "صافي المرتبات")}><strong>{money(summary?.payroll?.totalNetPay)}</strong></FormSection>
      <FormSection title={t('hr.reports.hr_reports_summary_cards.s5', "عناصر تحتاج مراجعة")}><strong>{countText(alertsCount)}</strong></FormSection>
    </div>
  );
}
