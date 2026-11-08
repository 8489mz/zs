import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/page-header';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { DataTable } from '@/shared/ui/data-table';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';
import type { HrAttendanceException, HrEmployee, HrEmployeeAsset, HrLeaveRequest, HrLoan, HrPayrollRun } from '@/types/domain';
import {
  UsersIcon,
  ClockIcon,
  CalendarIcon,
  WalletIcon,
  BriefcaseIcon,
  BanknotesIcon,
  FileTextIcon,
  ChartBarIcon,
  CogIcon,
} from '@/features/hr/components/HrIcons';
import {
  useHrAttendance,
  useHrAttendanceExceptions,
  useHrEmployeeAssets,
  useHrLeaveRequests,
  useHrReportsSummary,
  useHrWorkspace,
} from '@/features/hr/hooks/useHr';

type ReviewItem = {
  id: string;
  priority: 'عاجل' | 'مراجعة' | 'متابعة' | 'Urgent' | 'Review' | 'Follow-up';
  type: string;
  description: string;
  to: string;
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartDate(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function text(value: unknown) {
  return String(value || '').trim();
}

function money(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0.00';
  // INV-FE3-FRONTEND-BOOK-DIGITS: this formats a money KPI (due loan
  // amount) on the HR overview, so it shows the tenant's book digits.
  return amount.toFixed(currencyMoneyDigits(getGlobalSystemCurrency()));
}

function employeeName(row: HrEmployee) {
  return text(row.displayName || `${row.firstName || ''} ${row.lastName || ''}`.trim()) || 'غير متاح';
}

function needsAssetReview(status: unknown) {
  const value = text(status).toLowerCase();
  return value === 'lost' || value === 'damaged';
}

function payrollNeedsReview(status: unknown) {
  const value = text(status).toLowerCase();
  return value === 'draft' || value === 'reviewed';
}

function attendanceNeedsReview(status: unknown) {
  const value = text(status).toLowerCase();
  return value === 'pending' || value === 'needs_review';
}

export function HrComingSoonPage() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const navigate = useNavigate();
  const today = todayDate();
  const month = today.slice(0, 7);
  const canViewEmployees = useHasAnyPermission(['hrEmployees']);
  const canViewAttendance = useHasAnyPermission(['hrAttendance']);
  const canViewLoans = useHasAnyPermission('hrLoans');
  const canViewPayroll = useHasAnyPermission(['hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove']);

  const workspace = useHrWorkspace({ page: 1, pageSize: 200, month });
  const reports = useHrReportsSummary({ from: monthStartDate(today), to: today, month });
  const attendance = useHrAttendance({ date: today, page: 1, pageSize: 300 }, { enabled: canViewAttendance });
  const attendanceExceptions = useHrAttendanceExceptions({ date: today, page: 1, pageSize: 200 }, { enabled: canViewAttendance });
  const leaves = useHrLeaveRequests({ page: 1, pageSize: 200, status: 'pending', enabled: canViewEmployees });
  const assets = useHrEmployeeAssets({ page: 1, pageSize: 300, enabled: canViewEmployees });

  const employees = useMemo(() => (workspace.employees.data?.employees || []) as HrEmployee[], [workspace.employees.data?.employees]);
  const loans = useMemo(() => (workspace.loans.data?.loans || []) as HrLoan[], [workspace.loans.data?.loans]);
  const payrollRuns = useMemo(() => (workspace.payrollRuns.data?.runs || []) as HrPayrollRun[], [workspace.payrollRuns.data?.runs]);
  const pendingLeaves = useMemo(() => (leaves.data?.requests || []) as HrLeaveRequest[], [leaves.data?.requests]);
  const assetRows = useMemo(() => (assets.data?.assets || []) as HrEmployeeAsset[], [assets.data?.assets]);
  const exceptionRows = useMemo(() => (canViewAttendance ? ((attendanceExceptions.data?.rows || []) as HrAttendanceException[]).filter((row) => attendanceNeedsReview(row.status)) : []), [canViewAttendance, attendanceExceptions.data?.rows]);

  const reportSummary = reports.data?.summary;
  const activeEmployees = Number(workspace.employees.data?.summary?.activeCount ?? reportSummary?.activeEmployeeCount ?? 0);
  const totalEmployees = Number(workspace.employees.data?.summary?.totalItems ?? reportSummary?.employeeCount ?? employees.length);
  const presentToday = canViewAttendance ? Number(attendance.data?.summary?.presentCount ?? 0) : 0;
  const assetsNeedReview = assetRows.filter((row) => needsAssetReview(row.status)).length;
  const dueLoanAmount = canViewLoans ? loans.reduce((sum, row) => sum + Number(row.dueInstallmentsAmount || 0), 0) : 0;
  const payrollReviewCount = canViewPayroll ? payrollRuns.filter((row) => payrollNeedsReview(row.status)).length : 0;

  const incompleteEmployees = employees.filter((employee) => {
    return !text(employee.employeeNo) || !text(employee.nationalId) || !text(employee.departmentName) || !text(employee.jobTitleName);
  });

  const reviewItems = useMemo<ReviewItem[]>(() => {
    const items: ReviewItem[] = [];

    exceptionRows.slice(0, 4).forEach((row) => {
      items.push({
        id: `attendance-${row.id}`,
        priority: isEn ? 'Urgent' : 'عاجل',
        type: isEn ? 'Attendance Exception' : 'استثناء حضور',
        description: isEn
          ? `${text(row.employeeName) || 'Employee'} has an attendance exception pending review.`
          : `${text(row.employeeName) || 'موظف'} لديه استثناء حضور يحتاج اعتماد أو تخطي.`,
        to: '/hr/attendance',
      });
    });

    pendingLeaves.slice(0, 4).forEach((row) => {
      items.push({
        id: `leave-${row.id}`,
        priority: isEn ? 'Review' : 'مراجعة',
        type: isEn ? 'Leave Request' : 'طلب إجازة',
        description: isEn
          ? `${text(row.employeeName) || 'Employee'} has a leave request pending review.`
          : `${text(row.employeeName) || 'موظف'} لديه طلب إجازة قيد المراجعة.`,
        to: '/hr/leaves',
      });
    });

    assetRows.filter((row) => needsAssetReview(row.status)).slice(0, 4).forEach((row) => {
      items.push({
        id: `asset-${row.id}`,
        priority: isEn ? 'Review' : 'مراجعة',
        type: isEn ? 'Asset Custody' : 'عهدة',
        description: isEn
          ? `${text(row.assetName) || 'Asset'} recorded as damaged or missing and needs review.`
          : `${text(row.assetName) || 'عهدة'} مسجلة تالفة أو مفقودة وتحتاج مراجعة.`,
        to: '/hr/assets',
      });
    });

    incompleteEmployees.slice(0, 4).forEach((row) => {
      items.push({
        id: `employee-${row.id}`,
        priority: isEn ? 'Follow-up' : 'متابعة',
        type: isEn ? 'Employee Profile' : 'ملف موظف',
        description: isEn
          ? `${employeeName(row)} needs basic or employment data completed.`
          : `${employeeName(row)} يحتاج استكمال بيانات أساسية أو وظيفية.`,
        to: `/hr/employees/${row.id}`,
      });
    });

    return items.slice(0, 10);
  }, [assetRows, exceptionRows, incompleteEmployees, isEn, pendingLeaves]);

  const loading = (canViewEmployees && workspace.employees.isLoading) || (canViewAttendance && attendance.isLoading);
  const isError = (canViewEmployees && workspace.employees.isError) || (canViewAttendance && attendance.isError);
  const error = (canViewEmployees ? workspace.employees.error : null) || (canViewAttendance ? attendance.error : null);

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '20px' }}>
        <PageHeader
          title={t('hr.hr_coming_soon_page.s0', "الموارد البشرية")}
          description={t('hr.hr_coming_soon_page.s1', "نظرة تشغيلية مختصرة: ابدأ من العناصر التي تحتاج إجراء، أو انتقل مباشرة للقسم المطلوب.")}
          actions={
            <div className="actions compact-actions">
              {canViewEmployees && <Button onClick={() => navigate('/hr/employees/new')}>{t('hr.hr_coming_soon_page.s2', "إضافة موظف")}</Button>}
              {canViewAttendance && <Button variant="secondary" onClick={() => navigate('/hr/attendance')}>{t('hr.hr_coming_soon_page.s3', "فتح الحضور")}</Button>}
            </div>
          }
        />
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <QueryFeedback
            isLoading={loading}
            isError={isError}
            error={error}
            isEmpty={false}
            loadingText={t('hr.hr_coming_soon_page.s4', "جاري تحميل نظرة الموارد البشرية...")}
            errorTitle={t('hr.hr_coming_soon_page.s5', "تعذر تحميل نظرة الموارد البشرية")}
          >
            {/* Compact Single-Row KPI Summary Bar */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.825rem', fontWeight: 800, color: '#0f172a' }}>{t('hr.hr_coming_soon_page.s6', "ملخص تشغيلي سريع")}</span>
                <span style={{ fontSize: '0.725rem', color: '#64748b' }}>{t('hr.hr_coming_soon_page.s7', "مؤشرات اليوم لجميع أقسام الموارد البشرية")}</span>
              </div>
              
              <div className="hr-operational-summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: '8px' }}>
                {[
                  { label: t('hr.hr_coming_soon_page.s8', "إجمالي الموظفين"), value: totalEmployees, to: '/hr/employees', isAlert: false },
                  { label: t('hr.hr_coming_soon_page.s9', "نشط"), value: activeEmployees, to: '/hr/employees', isAlert: false },
                  { label: t('hr.hr_coming_soon_page.s10', "حاضر اليوم"), value: canViewAttendance ? presentToday : '—', to: canViewAttendance ? '/hr/attendance' : '/hr', isAlert: false },
                  { label: t('hr.hr_coming_soon_page.s11', "طلبات إجازة"), value: pendingLeaves.length, to: '/hr/leaves', isAlert: pendingLeaves.length > 0 },
                  { label: t('hr.hr_coming_soon_page.s12', "استثناءات حضور"), value: canViewAttendance ? exceptionRows.length : '—', to: canViewAttendance ? '/hr/attendance' : '/hr', isAlert: canViewAttendance && exceptionRows.length > 0 },
                  { label: t('hr.hr_coming_soon_page.s13', "عُهد للمراجعة"), value: assetsNeedReview, to: '/hr/assets', isAlert: assetsNeedReview > 0 },
                  { label: t('hr.hr_coming_soon_page.s14', "أقساط مستحقة"), value: money(dueLoanAmount), to: '/hr/loans', isAlert: false },
                  { label: t('hr.hr_coming_soon_page.s15', "مرتبات للمراجعة"), value: payrollReviewCount, to: '/hr/payroll', isAlert: payrollReviewCount > 0 },
                ].map((stat, idx) => (
                  <div
                    key={idx}
                    onClick={() => navigate(stat.to)}
                    style={{
                      background: '#ffffff',
                      border: `1px solid ${stat.isAlert ? '#fca5a5' : '#e2e8f0'}`,
                      borderRadius: '6px',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      transition: 'all 0.15s ease',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      minWidth: 0,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#94a3b8')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = stat.isAlert ? '#fca5a5' : '#e2e8f0')}
                  >
                    <span style={{ fontSize: '0.725rem', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={stat.label}>
                      {stat.label}
                    </span>
                    <strong style={{ fontSize: '1.05rem', fontWeight: 800, color: stat.isAlert ? '#dc2626' : '#0f172a', lineHeight: 1.2 }}>
                      {stat.value}
                    </strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions Shortcuts Row (3x3 Grid on Mobile) */}
            <div className="hr-quick-actions-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px', marginBottom: '14px' }}>
              {[
                { label: t('hr.hr_coming_soon_page.s16', "إضافة موظف"), icon: <UsersIcon size={14} />, to: '/hr/employees/new', variant: 'primary' as const },
                { label: t('hr.hr_coming_soon_page.s17', "تسجيل الحضور"), icon: <ClockIcon size={14} />, to: '/hr/attendance', variant: 'secondary' as const },
                { label: t('hr.hr_coming_soon_page.s18', "طلب إجازة"), icon: <CalendarIcon size={14} />, to: '/hr/leaves', variant: 'secondary' as const },
                { label: t('hr.hr_coming_soon_page.s19', "سلفة جديدة"), icon: <WalletIcon size={14} />, to: '/hr/loans', variant: 'secondary' as const },
                { label: t('hr.hr_coming_soon_page.s20', "تسليم عهدة"), icon: <BriefcaseIcon size={14} />, to: '/hr/assets', variant: 'secondary' as const },
                { label: t('hr.hr_coming_soon_page.s21', "المرتبات والأجور"), icon: <BanknotesIcon size={14} />, to: '/hr/payroll', variant: 'secondary' as const },
                { label: t('hr.hr_coming_soon_page.s22', "المستندات"), icon: <FileTextIcon size={14} />, to: '/hr/documents', variant: 'secondary' as const },
                { label: t('hr.hr_coming_soon_page.s23', "التقارير"), icon: <ChartBarIcon size={14} />, to: '/hr/reports', variant: 'secondary' as const },
                { label: t('hr.hr_coming_soon_page.s24', "الإعدادات"), icon: <CogIcon size={14} />, to: '/hr/settings', variant: 'secondary' as const },
              ].map((act, i) => (
                <Button
                  key={i}
                  type="button"
                  variant={act.variant}
                  onClick={() => navigate(act.to)}
                  className="hr-quick-action-btn"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px', padding: '6px 8px', fontSize: '0.76rem', borderRadius: '6px', width: '100%' }}
                >
                  {act.icon}
                  <span>{act.label}</span>
                </Button>
              ))}
            </div>

            {/* Tasks that need immediate action */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 800, color: '#0f172a' }}>{t('hr.hr_coming_soon_page.s25', "مهام تحتاج إجراء ومتابعة")}</span>
                <span style={{ fontSize: '0.725rem', color: '#64748b' }}>{t('hr.hr_coming_soon_page.s26', "أهم العناصر التي تستحق المتابعة الفورية")}</span>
              </div>
              
              <DataTable
                rows={reviewItems}
                rowKey={(row) => row.id}
                density="compact"
                onRowClick={(row) => navigate(row.to)}
                columns={[
                  {
                    key: 'priority',
                    header: t('hr.hr_coming_soon_page.s27', "الأولوية"),
                    className: 'col-fit',
                    cell: (row) => (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: (row.priority === 'عاجل' || row.priority === 'Urgent') ? '#fee2e2' : (row.priority === 'مراجعة' || row.priority === 'Review') ? '#fef3c7' : '#e0f2fe',
                          color: (row.priority === 'عاجل' || row.priority === 'Urgent') ? '#b91c1c' : (row.priority === 'مراجعة' || row.priority === 'Review') ? '#b45309' : '#0369a1',
                        }}
                      >
                        {row.priority}
                      </span>
                    ),
                  },
                  { key: 'type', header: t('hr.hr_coming_soon_page.s28', "النوع"), className: 'col-fit', cell: (row) => <strong>{row.type}</strong> },
                  { key: 'description', header: t('hr.hr_coming_soon_page.s29', "الوصف"), cell: (row) => row.description },
                  {
                    key: 'action',
                    header: t('hr.hr_coming_soon_page.s30', "الإجراء"),
                    className: 'col-fit',
                    cell: (row) => (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={(event) => { event.stopPropagation(); navigate(row.to); }}
                        style={{ padding: '2px 10px', fontSize: '0.775rem' }}
                      >
                        {t('hr.hr_coming_soon_page.s31', "فتح")}
                      </Button>
                    ),
                  },
                ]}
              />
              {!reviewItems.length ? <p className="muted" style={{ margin: '8px 0 0', fontSize: '0.825rem' }}>{t('hr.hr_coming_soon_page.s32', "لا توجد عناصر عاجلة ظاهرة حاليًا، كل الأمور تحت السيطرة.")}</p> : null}
            </div>
          </QueryFeedback>
        </div>
      </main>
    </div>
  );
}
