import { useTranslation } from 'react-i18next';
import { FormEvent, useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { hrApi } from '@/features/hr/api/hr.api';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { useAuthStore } from '@/stores/auth-store';
import type { HrEmployee, HrPayrollRun, HrPayrollRunItem } from '@/types/domain';
import { getErrorMessage } from '@/lib/errors';
import { useHrMutations, useHrPayrollRun, useHrWorkspace } from '@/features/hr/hooks/useHr';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { serverDayKey } from '@/shared/hooks/use-server-clock';
import { isEgypt } from '@/lib/currencies';
import {
  employeeMatches,
  itemNeedsReview,
  normalize,
  statusLabel,
  type PayrollReviewStatus,
  type PayFrequency,
} from '@/features/hr/pages/payroll/hr-payroll.helpers';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import type { PayrollDraft } from '../components/payroll/CreatePayrollRunModal';
import type { PayPayrollTargetItem } from '../components/payroll/PayPayrollRunModal';
import type { PayrollRunTab } from '../components/payroll/PayrollRunsTable';
import { filterRunsByTabAndStatus, initialDraft } from './hr-payroll-page/hr-payroll-shared';
import { printPayrollSignatureSheet } from './hr-payroll-page/hr-payroll-signature-sheet';
import { printDetailedPayrollReport } from './hr-payroll-page/hr-payroll-detailed-report';
import { HrPayrollPageHeader } from './hr-payroll-page/hr-payroll-page-header';
import { HrPayrollTopSectionsSection } from './hr-payroll-page/hr-payroll-top-sections';
import { HrPayrollSummaryBanners } from './hr-payroll-page/hr-payroll-summary-banners';
import { HrPayrollRunsTableSection } from './hr-payroll-page/hr-payroll-runs-table';
import { HrPayrollRunDetails } from './hr-payroll-page/hr-payroll-run-details';
import { HrPayrollCreateRunModalSection } from './hr-payroll-page/hr-payroll-create-run-modal';
import { HrPayrollPayRunModalSection } from './hr-payroll-page/hr-payroll-pay-run-modal';
import { HrPayrollWpsExportSection } from './hr-payroll-page/hr-payroll-wps-modal';
import { HrPayrollReviewItemModalSection } from './hr-payroll-page/hr-payroll-review-item-modal';
import { HrPayrollApprovalDialog } from './hr-payroll-page/hr-payroll-approval-dialog';

export function HrPayrollPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const mutations = useHrMutations();
  const canViewPayroll = useHasAnyPermission(['hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove']);
  const canManagePayroll = useHasAnyPermission(['hrPayrollManage', 'hrPayrollApprove']);
  const canApprovePayroll = useHasAnyPermission('hrPayrollApprove');
  const canViewSalaryAmounts = useHasAnyPermission(['hrSalaryView', 'hrSalaryManage', 'hrPayrollManage', 'hrPayrollApprove']);

  const { data: settings } = useSettingsQuery();
  const isEg = isEgypt(settings);
  const payrollTerm = isEg ? 'كشف المرتبات' : 'مسير الرواتب';
  const payrollTermShort = isEg ? 'الكشف' : 'المسير';

  const now = new Date();
  const initialMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [monthFilter, setMonthFilter] = useState(initialMonth);
  const [search, setSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [reviewStatusFilter, setReviewStatusFilter] = useState<PayrollReviewStatus>('all');
  const [activeRunTab, setActiveRunTab] = useState<PayrollRunTab>(() => {
    return (sessionStorage.getItem('hr_payroll_active_tab') as PayrollRunTab) || 'monthly';
  });

  const [draft, setDraft] = useState<PayrollDraft>(initialDraft);
  const [formError, setFormError] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedReviewItem, setSelectedReviewItem] = useState<HrPayrollRunItem | null>(null);
  const [pendingApprovalAction, setPendingApprovalAction] = useState<{ runId: string; type: 'review' | 'approve' } | null>(null);
  const [showCreateRun, setShowCreateRun] = useState(false);
  const [showPayRun, setShowPayRun] = useState(false);
  const [showWpsModal, setShowWpsModal] = useState(false);
  const [payModalTargetItem, setPayModalTargetItem] = useState<PayPayrollTargetItem | null>(null);

  const handleOpenPayItemModal = (item: HrPayrollRunItem) => {
    setSelectedReviewItem(null);
    setPayModalTargetItem({
      itemId: Number(item.id),
      runId: Number((item as any).payrollRunId || (item as any).runId || selectedRunId),
      employeeId: Number(item.employeeId),
      employeeName: item.employeeName || 'موظف',
      employeeNo: item.employeeNo ? String(item.employeeNo) : undefined,
      netPay: Number(item.netPay || 0),
      periodMonth: selectedRun?.periodMonth,
    });
    setShowPayRun(true);
  };

  const workspace = useHrWorkspace({ page, pageSize, month: monthFilter });
  const payrollRunDetails = useHrPayrollRun(selectedRunId || undefined);

  // P8 (RC-7): the payroll page opens on the SERVER's tenant month, not
  // the client clock's month. Adopt it once, when the payroll-runs list
  // first resolves, and only while the filter still equals the client
  // month at mount — a user-picked month is never overridden.
  const serverMonth = useMemo(() => {
    const key = serverDayKey(workspace.payrollRuns.data?.serverTime, workspace.payrollRuns.data?.serverTimezone);
    return key ? key.slice(0, 7) : '';
  }, [workspace.payrollRuns.data?.serverTime, workspace.payrollRuns.data?.serverTimezone]);
  const adoptedServerMonthRef = useRef(false);
  useEffect(() => {
    if (!serverMonth || adoptedServerMonthRef.current) return;
    adoptedServerMonthRef.current = true;
    if (monthFilter === initialMonth && serverMonth !== initialMonth) {
      setMonthFilter(serverMonth);
    }
  }, [serverMonth, monthFilter, initialMonth]);

  // Active employees for employee dropdown/combobox (matching attendance page)
  const canViewEmployees = useHasAnyPermission(['hrEmployees', 'hrAttendance', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove']);
  const activeEmployeesQuery = useQuery({
    queryKey: ['hr', 'attendance-active-employees'],
    queryFn: () => hrApi.employees({ status: 'active', pageSize: 500 }),
    enabled: canViewEmployees,
  });
  const activeEmployees = useMemo(() => activeEmployeesQuery.data?.employees || [], [activeEmployeesQuery.data?.employees]);

  const runs = useMemo(() => (workspace.payrollRuns.data?.runs || []) as HrPayrollRun[], [workspace.payrollRuns.data?.runs]);
  const employees = useMemo(() => (workspace.employees.data?.employees || []) as HrEmployee[], [workspace.employees.data?.employees]);
  const employeesMap = useMemo(() => new Map(employees.map((employee) => [String(employee.id), employee])), [employees]);

  const selectedRunFromList = useMemo(() => runs.find((row) => String(row.id) === String(selectedRunId)), [runs, selectedRunId]);
  const selectedRun = (payrollRunDetails.data?.run || selectedRunFromList) as HrPayrollRun | undefined;
  const runItems = useMemo(() => {
    const items = (selectedRun?.items || []) as HrPayrollRunItem[];
    return items.filter((item) => item.status !== 'excluded');
  }, [selectedRun?.items]);

  // Combine employees for dropdown options
  const employeeOptions = useMemo(() => {
    const list: Array<{ value: string; label: string; hint?: string; code?: string }> = [
      { value: '', label: 'جميع الموظفين' },
    ];
    const seen = new Set<string>();

    for (const item of runItems) {
      const empId = String(item.employeeId || '');
      if (!empId || seen.has(empId)) continue;
      seen.add(empId);
      list.push({
        value: empId,
        label: item.employeeName || 'موظف',
        hint: item.employeeNo ? `#${item.employeeNo}` : '',
        code: String(item.employeeNo || empId),
      });
    }

    for (const emp of activeEmployees) {
      const empId = String(emp.id || '');
      if (!empId || seen.has(empId)) continue;
      seen.add(empId);
      list.push({
        value: empId,
        label: emp.displayName || emp.firstName || 'موظف',
        hint: emp.employeeNo ? `#${emp.employeeNo}` : '',
        code: String(emp.employeeNo || empId),
      });
    }

    for (const emp of employees) {
      const empId = String(emp.id || '');
      if (!empId || seen.has(empId)) continue;
      seen.add(empId);
      list.push({
        value: empId,
        label: emp.displayName || emp.firstName || 'موظف',
        hint: emp.employeeNo ? `#${emp.employeeNo}` : '',
        code: String(emp.employeeNo || empId),
      });
    }

    return list;
  }, [runItems, activeEmployees, employees]);

  const activeReviewItem = useMemo(() => {
    if (!selectedReviewItem) return null;
    return runItems.find((i) => String(i.id) === String(selectedReviewItem.id)) || selectedReviewItem;
  }, [runItems, selectedReviewItem]);

  const departmentOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const employee of employees) {
      const key = normalize(employee.departmentName);
      if (!key) continue;
      set.set(key, String(employee.departmentName || '').trim());
    }
    return Array.from(set.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [employees]);

  const filteredRunItems = useMemo(() => {
    const searchTerm = normalize(search);
    return runItems.filter((row) => {
      if (selectedEmployeeId && String(row.employeeId) !== String(selectedEmployeeId) && String(row.employeeNo) !== String(selectedEmployeeId)) {
        return false;
      }
      if (!employeeMatches(row, employeesMap, searchTerm, departmentFilter)) return false;
      const rowStatus = normalize(row.status);
      const needsReview = itemNeedsReview(row);
      if (reviewStatusFilter === 'approved' && rowStatus !== 'approved') return false;
      if (reviewStatusFilter === 'needs_review' && !needsReview) return false;
      if (reviewStatusFilter === 'ready' && (rowStatus === 'approved' || needsReview)) return false;
      if (reviewStatusFilter === 'paid' && rowStatus !== 'paid') return false;
      return true;
    });
  }, [departmentFilter, employeesMap, reviewStatusFilter, runItems, search, selectedEmployeeId]);

  const isSelectedRunHourlyOrWeekly = useMemo(() => {
    const freq = normalize(selectedRun?.payFrequency);
    if (freq === 'weekly' || freq === 'daily') return true;
    if (!filteredRunItems.length) return false;
    return filteredRunItems.every(
      (row) => normalize(row.compensationType) === 'hourly' || (Number(row.hourlyRate || 0) > 0 && normalize(row.compensationType) !== 'monthly')
    );
  }, [selectedRun?.payFrequency, filteredRunItems]);

  const baseCompensationHeader = isSelectedRunHourlyOrWeekly
    ? 'الأجر الأساسي'
    : (isEg ? 'المرتب الأساسي' : 'الراتب الأساسي');

  const topKpiBaseSalaryLabel = isSelectedRunHourlyOrWeekly
    ? 'الأجور الأساسية'
    : (isEg ? 'المرتبات الأساسية' : 'الرواتب الأساسية');

  const topKpiNetPayLabel = isEg ? 'صافي المرتبات' : 'صافي الرواتب';

  const runStatusOptions = [
    { value: 'all', label: 'كافة الحالات' },
    { value: 'draft', label: 'مسودة' },
    { value: 'reviewed', label: 'تمت المراجعة' },
    { value: 'approved', label: 'معتمد' },
    { value: 'paid', label: 'مصروف' },
    { value: 'cancelled', label: 'ملغي' },
  ];

  const [runStatusFilter, setRunStatusFilter] = useState('all');

  const filteredRuns = useMemo(() => {
    return filterRunsByTabAndStatus(runs, activeRunTab, runStatusFilter);
  }, [runs, activeRunTab, runStatusFilter]);

  const handleTabChange = (nextTab: PayrollRunTab) => {
    setActiveRunTab(nextTab);
    sessionStorage.setItem('hr_payroll_active_tab', nextTab);
    const targetRuns = filterRunsByTabAndStatus(runs, nextTab, runStatusFilter);
    if (targetRuns.length > 0) {
      const alreadyHasCurrent = targetRuns.some((r) => String(r.id) === String(selectedRunId));
      if (!alreadyHasCurrent) {
        setSelectedRunId(String(targetRuns[0].id));
      }
    } else {
      setSelectedRunId('');
    }
  };

  const tabCounts = useMemo(() => {
    let monthly = 0;
    let biweekly = 0;
    let weekly = 0;
    let daily = 0;
    let allActive = 0;
    let cancelled = 0;

    for (const r of runs) {
      const isCancelled = normalize(r.status) === 'cancelled' || normalize(r.status) === 'canceled';
      if (isCancelled) {
        cancelled += 1;
      } else {
        allActive += 1;
        const freq = (r.payFrequency || 'monthly').toLowerCase();
        if (freq === 'biweekly') {
          biweekly += 1;
        } else if (freq === 'weekly') {
          weekly += 1;
        } else if (freq === 'daily') {
          daily += 1;
        } else {
          monthly += 1;
        }
      }
    }

    return {
      monthly,
      biweekly,
      weekly,
      daily,
      all_active: allActive,
      allActive,
      cancelled,
    };
  }, [runs]);

  // Guard for when runs query finishes loading asynchronously
  useEffect(() => {
    if (filteredRuns.length > 0) {
      const isSelectedInFiltered = filteredRuns.some((r) => String(r.id) === String(selectedRunId));
      if (!isSelectedInFiltered) {
        setSelectedRunId(String(filteredRuns[0].id));
      }
    } else if (selectedRunId) {
      setSelectedRunId('');
    }
  }, [filteredRuns, selectedRunId]);

  const summary = useMemo(() => {
    const totalNet = runItems.reduce((acc, row) => acc + Number(row.netPay || 0), 0);
    const totalBase = runItems.reduce((acc, row) => acc + Number(row.baseSalary || 0), 0);
    const totalAllowances = runItems.reduce((acc, row) => acc + Number(row.allowanceAmount || 0), 0);
    const totalDeductions = runItems.reduce((acc, row) => acc + Number(row.deductionAmount || 0), 0);
    const totalLoanDeduction = runItems.reduce((acc, row) => acc + Number(row.loanDeductionAmount || 0), 0);
    const flaggedCount = runItems.filter(itemNeedsReview).length;
    return {
      totalNet,
      totalBase,
      totalBaseSalary: totalBase,
      totalAllowances,
      totalDeductions,
      totalLoanDeduction,
      flaggedCount,
      needsReview: flaggedCount,
      itemCount: runItems.length,
      totalEmployees: runItems.length,
    };
  }, [runItems]);

  const dueLoanInstallmentRows = useMemo(() => {
    return runItems.filter((item) => Number(item.loanDeductionAmount || 0) > 0);
  }, [runItems]);

  const hasCreatePayrollRun = Boolean(mutations.createPayrollRun);
  const runIsFinal = selectedRun && (normalize(selectedRun.status) === 'approved' || normalize(selectedRun.status) === 'paid');

  const openCreateModal = () => {
    const targetMonth = monthFilter || initialMonth;
    const parts = targetMonth.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const lastDay = new Date(year, month, 0).getDate();
    let targetFreq: PayFrequency = 'monthly';
    if (activeRunTab === 'biweekly') targetFreq = 'biweekly';
    else if (activeRunTab === 'weekly') targetFreq = 'weekly';
    else if (activeRunTab === 'daily') targetFreq = 'daily';

    let sDate = `${targetMonth}-01`;
    let eDate = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;
    if (targetFreq === 'biweekly') {
      eDate = `${targetMonth}-15`;
    } else if (targetFreq === 'weekly') {
      eDate = `${targetMonth}-07`;
    } else if (targetFreq === 'daily') {
      eDate = `${targetMonth}-01`;
    }
    setDraft({
      periodMonth: targetMonth,
      payFrequency: targetFreq,
      startDate: sDate,
      endDate: eDate,
      notes: '',
    });
    setFormError('');
    setShowCreateRun(true);
  };

  const handleRecalculateRun = async (runId: string) => {
    try {
      const res = await mutations.recalculatePayrollRun?.mutateAsync(runId);
      const count = (res?.run?.items as any[])?.length ?? 0;
      toast.success(`تمت إعادة احتساب ${payrollTermShort} بنجاح (${count} موظف).`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleCancelRun = async (runId: string) => {
    const confirmed = await systemConfirm({
      title: isEg ? 'إلغاء كشف المرتبات' : 'إلغاء مسير الرواتب',
      message: isEg
        ? 'هل أنت متأكد من إلغاء كشف المرتبات هذا؟ لا يمكن التراجع عن هذا الإجراء.'
        : 'هل أنت متأكد من إلغاء مسير الرواتب هذا؟ لا يمكن التراجع عن هذا الإجراء.',
      confirmText: 'نعم، قم بالإلغاء',
      cancelText: 'تراجع',
    });
    if (!confirmed) return;
    try {
      await mutations.cancelPayrollRun.mutateAsync(runId);
      toast.success(isEg ? 'تم إلغاء كشف المرتبات بنجاح.' : 'تم إلغاء مسير الرواتب بنجاح.');
      setSelectedRunId('');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const payrollChecklist = useMemo(() => {
    const list: Array<{ key: string; title: string; status: string; ok: boolean; action?: string; onClick?: () => void }> = [];
    list.push({
      key: 'run',
      title: isEg ? 'تجهيز الكشف' : 'تجهيز المسير',
      status: selectedRun ? `${isEg ? 'كشف' : 'مسير'} شهر ${selectedRun.periodMonth}` : 'لم يتم التجهيز',
      ok: Boolean(selectedRun),
      action: !selectedRun ? (isEg ? 'تجهيز كشف المرتبات' : 'تجهيز مسير الرواتب') : undefined,
      onClick: !selectedRun ? openCreateModal : undefined,
    });
    list.push({
      key: 'attendance',
      title: 'مراجعة الحضور',
      status: summary.flaggedCount ? `${summary.flaggedCount} موظف بحاجة لمراجعة` : 'تم التحقق من البصمة',
      ok: summary.flaggedCount === 0,
      action: 'فتح الحضور',
      onClick: () => navigate('/hr/attendance'),
    });
    list.push({
      key: 'loans',
      title: 'أقساط السلف',
      status: dueLoanInstallmentRows.length ? `${dueLoanInstallmentRows.length} قسط مستقطع` : 'لا توجد سلف معلقة',
      ok: true,
      action: 'مراجعة السلف',
      onClick: () => navigate('/hr/loans'),
    });
    if (selectedRun) {
      list.push({
        key: 'status',
        title: 'حالة الاعتماد',
        status: statusLabel(selectedRun.status),
        ok: Boolean(runIsFinal),
        action: normalize(selectedRun.status) === 'draft' ? (isEg ? 'اعتماد الكشف' : 'اعتماد المسير') : normalize(selectedRun.status) === 'reviewed' ? 'اعتماد نهائي' : undefined,
        onClick: normalize(selectedRun.status) === 'draft' ? () => handleRunActionClick(String(selectedRun.id), 'review') : normalize(selectedRun.status) === 'reviewed' ? () => handleRunActionClick(String(selectedRun.id), 'approve') : undefined,
      });
    }
    return list;
  }, [selectedRun, summary.flaggedCount, dueLoanInstallmentRows.length, runIsFinal, navigate, isEg]);

  const handleRunActionClick = (runId: string, type: 'review' | 'approve') => {
    const exceptions = runItems.filter((i) => Number(i.unresolvedExceptionsCount || 0) > 0);
    if (exceptions.length > 0) {
      setPendingApprovalAction({ runId, type });
      return;
    }
    executeRunAction(runId, type);
  };

  const executeRunAction = async (runId: string, type: 'review' | 'approve') => {
    try {
      if (type === 'review') {
        await mutations.reviewPayrollRun?.mutateAsync(runId);
        toast.success(`تمت مراجعة واعتماد ${payrollTermShort} مبدئياً بنجاح.`);
      } else {
        await mutations.approvePayrollRun?.mutateAsync(runId);
        toast.success(`تم الاعتماد النهائي لـ ${payrollTerm} بنجاح. ${isEg ? 'الكشف' : 'المسير'} جاهز للصرف.`);
      }
      setPendingApprovalAction(null);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleCreateRun = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.periodMonth) return;
    try {
      setFormError('');
      const res = await mutations.createPayrollRun.mutateAsync(draft);
      setShowCreateRun(false);
      if (res?.run?.id) {
        setSelectedRunId(String(res.run.id));
      }
      const count = (res?.run?.items as any[])?.length ?? 0;
      toast.success(`تم تجهيز ${payrollTerm} بنجاح (${count} موظف).`);
    } catch (err) {
      setFormError(getErrorMessage(err));
      toast.error(getErrorMessage(err));
    }
  };

  const handleAddAdjustment = async (payload: { adjustmentType: 'allowance' | 'deduction'; label: string; amount: number; notes?: string }) => {
    if (!activeReviewItem) return;
    try {
      await mutations.createPayrollAdjustment.mutateAsync({
        id: String(activeReviewItem.id),
        payload,
      });
      toast.success('تمت إضافة التسوية وتحديث صافي الراتب بنجاح.');
    } catch (err) {
      toast.error(getErrorMessage(err));
      throw err;
    }
  };

  const handleDeleteAdjustment = async (adjustmentId: string) => {
    try {
      await mutations.deletePayrollAdjustment.mutateAsync(adjustmentId);
      toast.success('تم حذف التسوية وإعادة احتساب الراتب بنجاح.');
    } catch (err) {
      toast.error(getErrorMessage(err));
      throw err;
    }
  };
  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '20px' }}>
        <HrPayrollPageHeader
          t={t}
          user={user}
          navigate={navigate}
          isEg={isEg}
          hasCreatePayrollRun={hasCreatePayrollRun}
          canManagePayroll={canManagePayroll}
          openCreateModal={openCreateModal}
        />
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          {!canViewPayroll ? (
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '10px', textAlign: 'center', color: '#64748b' }}>
              <p style={{ margin: 0 }}>{t('hr.hr_payroll_page.s6', "ليس لديك صلاحية للوصول إلى بيانات المرتبات.")}</p>
            </div>
          ) : (
            <>
              <HrPayrollTopSectionsSection
                monthFilter={monthFilter}
                search={search}
                selectedEmployeeId={selectedEmployeeId}
                setSelectedEmployeeId={setSelectedEmployeeId}
                employeeOptions={employeeOptions}
                departmentFilter={departmentFilter}
                reviewStatusFilter={reviewStatusFilter}
                runStatusFilter={runStatusFilter}
                departmentOptions={departmentOptions}
                runStatusOptions={runStatusOptions}
                summary={summary}
                canViewSalaryAmounts={canViewSalaryAmounts}
                dueLoanInstallmentRows={dueLoanInstallmentRows}
                draft={draft}
                formError={formError}
                canManagePayroll={canManagePayroll}
                hasCreatePayrollRun={hasCreatePayrollRun}
                mutations={mutations}
                isEg={isEg}
                topKpiBaseSalaryLabel={topKpiBaseSalaryLabel}
                topKpiNetPayLabel={topKpiNetPayLabel}
                setMonthFilter={setMonthFilter}
                setPage={setPage}
                setSearch={setSearch}
                setDepartmentFilter={setDepartmentFilter}
                setReviewStatusFilter={setReviewStatusFilter}
                setRunStatusFilter={setRunStatusFilter}
                setDraft={setDraft}
                handleCreateRun={handleCreateRun}
              />
              <HrPayrollSummaryBanners
                selectedRun={selectedRun}
                canViewSalaryAmounts={canViewSalaryAmounts}
                summary={summary}
                isSelectedRunHourlyOrWeekly={isSelectedRunHourlyOrWeekly}
                navigate={navigate}
                runItems={runItems}
              />
              <HrPayrollRunsTableSection
                workspace={workspace}
                filteredRuns={filteredRuns}
                setPage={setPage}
                setSelectedRunId={setSelectedRunId}
                canManagePayroll={canManagePayroll}
                handleRunActionClick={handleRunActionClick}
                payrollChecklist={payrollChecklist}
                page={page}
                pageSize={pageSize}
                setPageSize={setPageSize}
                selectedRunId={selectedRunId}
                activeRunTab={activeRunTab}
                handleTabChange={handleTabChange}
                tabCounts={tabCounts}
                hasCreatePayrollRun={hasCreatePayrollRun}
                openCreateModal={openCreateModal}
                canViewSalaryAmounts={canViewSalaryAmounts}
                canApprovePayroll={canApprovePayroll}
                handleRecalculateRun={handleRecalculateRun}
                setPayModalTargetItem={setPayModalTargetItem}
                setShowPayRun={setShowPayRun}
                handleCancelRun={handleCancelRun}
                isEg={isEg}
              />
              <HrPayrollRunDetails
                t={t}
                selectedRun={selectedRun}
                isEg={isEg}
                canViewSalaryAmounts={canViewSalaryAmounts}
                payrollRunDetails={payrollRunDetails}
                filteredRunItems={filteredRunItems}
                setShowWpsModal={setShowWpsModal}
                printPayrollSignatureSheet={() => printPayrollSignatureSheet({ selectedRun, isSelectedRunHourlyOrWeekly, filteredRunItems, isEg, summary })}
                printDetailedPayrollReport={() => printDetailedPayrollReport({ filteredRunItems, isSelectedRunHourlyOrWeekly, isEg, selectedRun })}
                selectedRunId={selectedRunId}
                baseCompensationHeader={baseCompensationHeader}
                canApprovePayroll={canApprovePayroll}
                setSelectedReviewItem={setSelectedReviewItem}
                handleOpenPayItemModal={handleOpenPayItemModal}
              />
            </>
          )}
        </div>
      </main>

      {/* Modals */}
      <HrPayrollCreateRunModalSection
        workspace={workspace}
        showCreateRun={showCreateRun}
        setShowCreateRun={setShowCreateRun}
        draft={draft}
        setDraft={setDraft}
        handleCreateRun={handleCreateRun}
        mutations={mutations}
        canManagePayroll={canManagePayroll}
        hasCreatePayrollRun={hasCreatePayrollRun}
        formError={formError}
        employees={employees}
        isEg={isEg}
      />
      <HrPayrollPayRunModalSection
        setPayModalTargetItem={setPayModalTargetItem}
        showPayRun={showPayRun}
        setShowPayRun={setShowPayRun}
        selectedRun={selectedRun}
        payModalTargetItem={payModalTargetItem}
        canApprovePayroll={canApprovePayroll}
      />
      <HrPayrollWpsExportSection
        selectedRun={selectedRun}
        showWpsModal={showWpsModal}
        isEg={isEg}
        setShowWpsModal={setShowWpsModal}
      />
      <HrPayrollReviewItemModalSection
        selectedRun={selectedRun}
        navigate={navigate}
        t={t}
        activeReviewItem={activeReviewItem}
        setSelectedReviewItem={setSelectedReviewItem}
        canViewSalaryAmounts={canViewSalaryAmounts}
        runIsFinal={runIsFinal}
        handleAddAdjustment={handleAddAdjustment}
        handleDeleteAdjustment={handleDeleteAdjustment}
        handleOpenPayItemModal={handleOpenPayItemModal}
        canApprovePayroll={canApprovePayroll}
      />
      <HrPayrollApprovalDialog
        t={t}
        pendingApprovalAction={pendingApprovalAction}
        setPendingApprovalAction={setPendingApprovalAction}
        executeRunAction={executeRunAction}
      />
    </div>
  );
}
