import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import type { HrEmployee, HrEmployeeAsset, HrLeaveRequest, HrLoan, HrPayrollRun } from '@/types/domain';
import {
  useHrAttendance,
  useHrEmployeeAssets,
  useHrLeaveRequests,
  useHrReportsSummary,
  useHrWorkspace,
} from '@/features/hr/hooks/useHr';
import { countText, employeeMatches, money, monthStartDate, normalize, text, todayDate, type ReportType } from '@/features/hr/pages/reports/hr-reports.helpers';
import {
  employeeName,
  hasDueLoan,
  isActiveEmployee,
  isMissingEmployeeBasics,
  isOpenAsset,
  isOpenLoan,
  isUnpaidLeave,
  leaveNeedsReview,
  needsAssetReview,
  payrollRunNeedsReview,
} from '@/features/hr/pages/reports/hr-reports.page-helpers';
import { HrReportsKpiBar } from '@/features/hr/pages/reports/HrReportsKpiBar';
import { HrReportsFiltersToolbar } from '@/features/hr/pages/reports/HrReportsFiltersToolbar';
import { HrReportsOverviewGrid } from '@/features/hr/pages/reports/HrReportsOverviewGrid';
import { HrReportsDetailSections } from '@/features/hr/pages/reports/HrReportsDetailSections';

export function HrReportsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [from, setFrom] = useState(monthStartDate());
  const [to, setTo] = useState(todayDate());
  const [month, setMonth] = useState(todayDate().slice(0, 7));
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [reportType, setReportType] = useState<ReportType>('all');

  const canViewEmployees = useHasAnyPermission(['hrEmployees']);
  const canViewAttendance = useHasAnyPermission(['hrAttendance']);
  const canViewPayroll = useHasAnyPermission(['hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove']);
  const summaryQuery = useHrReportsSummary({ from, to, month });
  const workspace = useHrWorkspace({ page: 1, pageSize: 300, search, month });
  const attendanceQuery = useHrAttendance({ from, to, page: 1, pageSize: 300, search }, { enabled: canViewAttendance });
  const leavesQuery = useHrLeaveRequests({ from, to, page: 1, pageSize: 300, search, enabled: canViewEmployees });
  const assetsQuery = useHrEmployeeAssets({ from, to, page: 1, pageSize: 300, search, enabled: canViewEmployees });

  const summary = summaryQuery.data?.summary;
  const employees = useMemo(() => (workspace.employees.data?.employees || []) as HrEmployee[], [workspace.employees.data?.employees]);
  const payrollRuns = useMemo(() => (workspace.payrollRuns.data?.runs || []) as HrPayrollRun[], [workspace.payrollRuns.data?.runs]);
  const loans = useMemo(() => (workspace.loans.data?.loans || []) as HrLoan[], [workspace.loans.data?.loans]);
  const leaves = useMemo(() => (leavesQuery.data?.requests || []) as HrLeaveRequest[], [leavesQuery.data?.requests]);
  const assets = useMemo(() => (assetsQuery.data?.assets || []) as HrEmployeeAsset[], [assetsQuery.data?.assets]);
  const filteredEmployees = useMemo(() => employees.filter((employee) => employeeMatches(employee, search, departmentFilter)), [employees, search, departmentFilter]);
  const departmentOptions = useMemo(() => {
    const items = new Map<string, string>();
    for (const employee of employees) {
      const key = normalize(employee.departmentName);
      if (key) items.set(key, String(employee.departmentName || '').trim());
    }
    return Array.from(items.entries()).map(([value, label]) => ({ value, label }));
  }, [employees]);

  const employeesReport = useMemo(() => ({
    total: filteredEmployees.length,
    active: filteredEmployees.filter(isActiveEmployee).length,
    inactive: filteredEmployees.filter((employee) => !isActiveEmployee(employee)).length,
    missingBasics: filteredEmployees.filter(isMissingEmployeeBasics).length,
    missingNationalId: filteredEmployees.filter((employee) => !normalize(employee.nationalId)).length,
    missingDepartmentOrTitle: filteredEmployees.filter((employee) => !normalize(employee.departmentName) || !normalize(employee.jobTitleName)).length,
    missingWorkSchedule: filteredEmployees.filter((employee) => !normalize(employee.scheduledCheckInTime) || !normalize(employee.scheduledCheckOutTime)).length,
  }), [filteredEmployees]);
  const attendanceReport = useMemo(() => ({ total: countText(attendanceQuery.data?.summary?.totalItems), present: countText(summary?.attendance?.presentCount), absent: countText(summary?.attendance?.absentCount), late: countText(summary?.attendance?.lateCount), needsReview: countText(attendanceQuery.data?.summary?.unmarkedCount) }), [attendanceQuery.data?.summary?.totalItems, attendanceQuery.data?.summary?.unmarkedCount, summary?.attendance]);
  const leavesReport = useMemo(() => ({ total: countText(leavesQuery.data?.summary?.totalItems), pending: countText(summary?.leaves?.pendingCount ?? leaves.filter(leaveNeedsReview).length), approved: countText(summary?.leaves?.approvedCount), rejected: countText(summary?.leaves?.rejectedCount), unpaid: countText(summary?.leaves?.unpaidLeaveDays ?? leaves.filter(isUnpaidLeave).length) }), [leaves, leavesQuery.data?.summary?.totalItems, summary?.leaves]);
  const loansReport = useMemo(() => {
    const openLoans = loans.filter(isOpenLoan);
    const dueLoans = loans.filter(hasDueLoan);
    return { total: loans.length, open: openLoans.length, dueCount: dueLoans.length, dueAmount: dueLoans.reduce((sum, row) => sum + Number(row.dueInstallmentsAmount || 0), 0), remainingAmount: openLoans.reduce((sum, row) => sum + Number(row.remainingAmount || 0), 0) };
  }, [loans]);
  const assetsReport = useMemo(() => {
    const openAssets = assets.filter(isOpenAsset);
    const reviewAssets = assets.filter(needsAssetReview);
    return { total: assets.length, assigned: assets.filter((row) => normalize(row.status) === 'assigned').length, returned: assets.filter((row) => normalize(row.status) === 'returned').length, damaged: assets.filter((row) => normalize(row.status) === 'damaged').length, lost: assets.filter((row) => normalize(row.status) === 'lost').length, open: openAssets.length, needsReview: reviewAssets.length };
  }, [assets]);
  const payrollReport = useMemo(() => {
    const run = payrollRuns.find((item) => normalize(item.periodMonth) === normalize(month)) || payrollRuns[0];
    const runItems = run?.items || [];
    const needsReview = runItems.filter((row) => Number((row as { unpaidLeaveDays?: number }).unpaidLeaveDays || 0) > 0 || Number(row.deductionAmount || 0) > 0 || Number(row.loanDeductionAmount || 0) > 0 || Number(row.baseSalary || 0) <= 0).length;
    return { runs: payrollRuns.length, selectedRunStatus: text(run?.status), employeesInRun: countText(run?.itemCount || runItems.length), totalBase: money(run?.totalBaseSalary), totalDeduction: money(run?.totalDeductionAmount), totalLoan: money(run?.totalLoanDeductionAmount), totalNet: money(run?.totalNetPay || summary?.payroll?.totalNetPay), needsReview: countText(needsReview) };
  }, [month, payrollRuns, summary?.payroll?.totalNetPay]);

  const alerts = useMemo(() => {
    const rows: Array<{ id: string; type: string; target: string; note: string; action: string; to: string }> = [];
    filteredEmployees.filter(isMissingEmployeeBasics).slice(0, 20).forEach((employee) => rows.push({ id: `employee-${employee.id}`, type: 'ملف موظف', target: employeeName(employee), note: 'بيانات أساسية أو وظيفية ناقصة.', action: 'فتح الملف', to: `/hr/employees/${employee.id}` }));
    leaves.filter(leaveNeedsReview).slice(0, 10).forEach((request) => rows.push({ id: `leave-${request.id}`, type: 'إجازات', target: text(request.employeeName), note: 'طلب إجازة قيد المراجعة.', action: 'فتح الإجازات', to: '/hr/leaves' }));
    loans.filter(hasDueLoan).slice(0, 10).forEach((loan) => rows.push({ id: `loan-${loan.id}`, type: 'سلف', target: text(loan.employeeName || loan.loanNo), note: `قسط مستحق هذا الشهر بقيمة ${money(loan.dueInstallmentsAmount || 0)}.`, action: 'فتح السلف', to: '/hr/loans' }));
    assets.filter(needsAssetReview).slice(0, 10).forEach((asset) => rows.push({ id: `asset-${asset.id}`, type: 'عُهد', target: text(asset.employeeName || asset.assetName), note: 'عهدة تالفة أو مفقودة أو ناقصة بيانات.', action: 'فتح العُهد', to: '/hr/assets' }));
    payrollRuns.filter(payrollRunNeedsReview).slice(0, 10).forEach((run) => rows.push({ id: `payroll-${run.id}`, type: 'مرتبات', target: text(run.periodMonth), note: 'كشف مرتبات يحتاج مراجعة قبل الاعتماد النهائي.', action: 'فتح المرتبات', to: '/hr/payroll' }));
    const unmarked = Number(attendanceQuery.data?.summary?.unmarkedCount || 0);
    if (unmarked > 0) rows.push({ id: 'attendance-unmarked', type: 'حضور', target: 'سجلات الحضور', note: `يوجد ${unmarked} سجل حضور غير مكتمل ويحتاج مراجعة.`, action: 'فتح الحضور', to: '/hr/attendance' });
    return rows.slice(0, 80);
  }, [assets, attendanceQuery.data?.summary?.unmarkedCount, filteredEmployees, leaves, loans, payrollRuns]);

  const hasAnyData = filteredEmployees.length > 0 || loans.length > 0 || leaves.length > 0 || assets.length > 0 || payrollRuns.length > 0 || Number(summary?.employeeCount || 0) > 0;
  const loading = summaryQuery.isLoading || (canViewEmployees && (workspace.employees.isLoading || leavesQuery.isLoading || assetsQuery.isLoading)) || (canViewAttendance && attendanceQuery.isLoading);
  const isError = summaryQuery.isError || (canViewEmployees && (workspace.employees.isError || leavesQuery.isError || assetsQuery.isError)) || (canViewAttendance && attendanceQuery.isError);
  const error = summaryQuery.error || (canViewEmployees ? (workspace.employees.error || leavesQuery.error || assetsQuery.error) : null) || (canViewAttendance ? attendanceQuery.error : null);

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '20px' }}>
        <PageHeader
          title={t('hr.hr_reports_page.s0', "تقارير الموارد البشرية")}
          description={t('hr.hr_reports_page.s1', "ملخص تشغيلي سريع لكل دورة HR: الموظفين، الحضور، الإجازات، السلف، المرتبات، والعُهد.")}
          actions={
            <div className="actions compact-actions">
              <Button variant="secondary" onClick={() => navigate('/hr')}>{t('hr.hr_reports_page.s2', "نظرة عامة HR")}</Button>
              {canViewPayroll && <Button variant="secondary" onClick={() => navigate('/hr/payroll')}>{t('hr.hr_reports_page.s3', "فتح المرتبات")}</Button>}
              {canViewEmployees && <Button variant="secondary" onClick={() => navigate('/hr/employees')}>{t('hr.hr_reports_page.s4', "رجوع للموظفين")}</Button>}
            </div>
          }
        />
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <HrReportsKpiBar
            reportType={reportType}
            setReportType={setReportType}
            employeesReport={employeesReport}
            attendanceReport={attendanceReport}
            leavesReport={leavesReport}
            loansReport={loansReport}
            payrollReport={payrollReport}
            assetsReport={assetsReport}
            alertsCount={alerts.length}
          />

          <HrReportsFiltersToolbar
            search={search}
            setSearch={setSearch}
            from={from}
            setFrom={setFrom}
            to={to}
            setTo={setTo}
            month={month}
            setMonth={setMonth}
            departmentFilter={departmentFilter}
            setDepartmentFilter={setDepartmentFilter}
            departmentOptions={departmentOptions}
            reportType={reportType}
            setReportType={setReportType}
          />

          <QueryFeedback isLoading={loading} isError={isError} error={error} isEmpty={!hasAnyData} loadingText={t('hr.hr_reports_page.s5', "جارٍ تحميل التقارير...")} errorTitle={t('hr.hr_reports_page.s6', "تعذر تحميل تقارير الموارد البشرية")} emptyTitle={t('hr.hr_reports_page.s7', "لا توجد بيانات كافية لعرض التقرير.")}>
            {reportType === 'all' ? (
              <HrReportsOverviewGrid
                setReportType={setReportType}
                employeesReport={employeesReport}
                attendanceReport={attendanceReport}
                leavesReport={leavesReport}
                loansReport={loansReport}
                payrollReport={payrollReport}
                assetsReport={assetsReport}
                alerts={alerts}
              />
            ) : (
              <HrReportsDetailSections
                reportType={reportType}
                setReportType={setReportType}
                filteredEmployees={filteredEmployees}
                employeesReport={employeesReport}
                attendanceReport={attendanceReport}
                leavesReport={leavesReport}
                loansReport={loansReport}
                payrollReport={payrollReport}
                assetsReport={assetsReport}
                alerts={alerts}
              />
            )}
          </QueryFeedback>
        </div>
      </main>
    </div>
  );
}
