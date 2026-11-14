import { useTranslation } from 'react-i18next';
import { FormEvent, useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { hrApi } from '@/features/hr/api/hr.api';
import { PageHeader } from '@/shared/components/page-header';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { Button } from '@/shared/ui/button';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';
import { DataTable } from '@/shared/ui/data-table';
import type { HrEmployee, HrPayrollRun, HrPayrollRunItem } from '@/types/domain';
import { getErrorMessage } from '@/lib/errors';
import { useHrMutations, useHrPayrollRun, useHrWorkspace } from '@/features/hr/hooks/useHr';
import { HrPayrollTopSections } from '@/features/hr/pages/payroll/HrPayrollTopSections';
import { useSettingsQuery } from '@/shared/hooks/use-catalog-queries';
import { serverDayKey } from '@/shared/hooks/use-server-clock';
import { isEgypt } from '@/lib/currencies';
import {
  employeeMatches,
  itemNeedsReview,
  money,
  payrollPrintHtmlText,
  normalize,
  statusLabel,
  text,
  type PayrollReviewStatus,
  type PayFrequency,
} from '@/features/hr/pages/payroll/hr-payroll.helpers';
import { DialogShell } from '@/shared/components/dialog-shell';
import { systemConfirm, toast } from '@/shared/components/system-alert';
import { PrinterIcon, FileTextIcon } from '@/shared/components/icons/AppIcons';
import { PayrollWpsExportModal } from '@/features/hr/components/payroll/PayrollWpsExportModal';
import { CreatePayrollRunModal, type PayrollDraft } from '../components/payroll/CreatePayrollRunModal';
import { PayPayrollRunModal, type PayPayrollTargetItem } from '../components/payroll/PayPayrollRunModal';
import { PayrollReviewItemModal } from '../components/payroll/PayrollReviewItemModal';
import { PayrollRunsTable, type PayrollRunTab } from '../components/payroll/PayrollRunsTable';

const initialDraft: PayrollDraft = {
  periodMonth: '',
  payFrequency: 'monthly',
  startDate: '',
  endDate: '',
  notes: '',
};

function filterRunsByTabAndStatus(runs: HrPayrollRun[], tab: PayrollRunTab, statusFilter: string): HrPayrollRun[] {
  return runs.filter((r) => {
    const isCancelled = normalize(r.status) === 'cancelled' || normalize(r.status) === 'canceled';
    const freq = (r.payFrequency || 'monthly').toLowerCase();

    if (tab === 'cancelled') {
      if (!isCancelled) return false;
    } else if (tab === 'all_active') {
      if (isCancelled) return false;
    } else if (tab === 'monthly') {
      if (isCancelled || freq !== 'monthly') return false;
    } else if (tab === 'biweekly') {
      if (isCancelled || freq !== 'biweekly') return false;
    } else if (tab === 'weekly') {
      if (isCancelled || freq !== 'weekly') return false;
    } else if (tab === 'daily') {
      if (isCancelled || freq !== 'daily') return false;
    }

    if (tab !== 'cancelled' && statusFilter !== 'all' && normalize(r.status) !== statusFilter) {
      return false;
    }

    return true;
  });
}

export function HrPayrollPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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

  const printPayrollSignatureSheet = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html dir="rtl" lang="ar">
        <head>
          <title>كشف تسليم الرواتب - ${payrollPrintHtmlText(text(selectedRun?.periodMonth))}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
            @page { size: A4 portrait; margin: 10mm 12mm; }
            body { font-family: 'Tajawal', Tahoma, Arial, sans-serif; padding: 0; margin: 0; color: #1e293b; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .header { border-bottom: 2px solid #170e5e; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; }
            .header-meta { font-size: 11px; color: #475569; }
            .header-center { text-align: center; }
            .header-center h1 { margin: 0; color: #170e5e; font-size: 20px; font-weight: 800; }
            .header-center p { margin: 2px 0 0; color: #64748b; font-size: 12px; font-weight: 500; }
            .table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 12px; }
            .table thead { display: table-header-group; }
            .table tr { page-break-inside: avoid; }
            .table th, .table td { padding: 5px 8px; text-align: right; border: 1px solid #cbd5e1; }
            .table th { background-color: #f8fafc; font-weight: 700; color: #334155; border-bottom: 2px solid #94a3b8; }
            .table tbody tr:nth-child(even) { background-color: #fbfcfd; }
            .footer { margin-top: 18px; display: flex; justify-content: space-between; padding-top: 10px; clear: both; page-break-inside: avoid; }
            .signature-box { text-align: center; width: 30%; }
            .signature-box .title { font-weight: 700; color: #475569; margin-bottom: 25px; font-size: 11.5px; }
            .signature-box .line { border-bottom: 1px solid #94a3b8; width: 80%; margin: 0 auto; }
            .amount { font-family: monospace; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-meta" style="text-align: right;">
              <strong style="color: #170e5e; font-size: 13.5px; display: block;">Z-Systems ERP</strong>
              <span style="color: #64748b; font-size: 10.5px;">قطاع الموارد البشرية والمالية</span>
            </div>
            <div class="header-center">
              <h1>${isSelectedRunHourlyOrWeekly ? 'كشف تسليم أجور العاملين' : (isEg ? 'كشف تسليم المرتبات' : 'كشف تسليم الرواتب')}</h1>
              <p>خاص بشهر: ${payrollPrintHtmlText(text(selectedRun?.periodMonth))} | الحالة: ${payrollPrintHtmlText(statusLabel(selectedRun?.status))}</p>
            </div>
            <div class="header-meta" style="text-align: left;">
              <span style="color: #475569; font-size: 10.5px;">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</span><br>
              <span style="color: #64748b; font-size: 10.5px;">إجمالي القوى العاملة: ${filteredRunItems.length} موظف</span>
            </div>
          </div>
          <table class="table">
            <thead>
              <tr>
                <th style="width: 35px; text-align: center; white-space: nowrap;">م</th>
                <th style="width: 75px; text-align: center; white-space: nowrap;">كود الموظف</th>
                <th style="width: 1%; white-space: nowrap;">اسم الموظف</th>
                <th style="width: 140px; text-align: center; white-space: nowrap;">${isSelectedRunHourlyOrWeekly ? 'صافي الأجر المستحق' : 'صافي الراتب المستحق'}</th>
                <th style="text-align: center;">التوقيع / ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRunItems.map((row, index) => `
                <tr>
                  <td style="text-align: center; color: #64748b; white-space: nowrap;">${index + 1}</td>
                  <td style="text-align: center; color: #64748b; white-space: nowrap;">${payrollPrintHtmlText(text(row.employeeNo))}</td>
                  <td style="font-weight: 600; white-space: nowrap;">${payrollPrintHtmlText(text(row.employeeName))}</td>
                  <td class="amount" style="text-align: center;">${payrollPrintHtmlText(money(row.netPay))}</td>
                  <td></td>
                </tr>
              `).join('')}
              <tr style="background-color: #f1f5f9; font-weight: bold; font-size: 12.5px;">
                <td colspan="3" style="text-align: left; padding: 8px 10px; border: 1px solid #cbd5e1; color: #0f172a; white-space: nowrap;">${isSelectedRunHourlyOrWeekly ? 'إجمالي الأجور المستحقة:' : 'إجمالي الرواتب المستحقة:'}</td>
                <td class="amount" style="padding: 8px 10px; border: 1px solid #cbd5e1; color: #0f172a; font-size: 13px; text-align: center;">${payrollPrintHtmlText(money(summary.totalNet))}</td>
                <td style="border: 1px solid #cbd5e1; background-color: #f8fafc;"></td>
              </tr>
            </tbody>
          </table>
          <div class="footer">
            <div class="signature-box">
              <div class="title">إعداد الموارد البشرية</div>
              <div class="line"></div>
            </div>
            <div class="signature-box">
              <div class="title">اعتماد الإدارة</div>
              <div class="line"></div>
            </div>
            <div class="signature-box">
              <div class="title">توقيع أمين الخزينة</div>
              <div class="line"></div>
            </div>
          </div>
          <div style="margin-top: 18px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 9.5px; color: #64748b; clear: both; page-break-inside: avoid;">
            <span>تم استخراج وتوثيق هذا الكشف آلياً بواسطة منظومة <strong>Z-Systems Cloud ERP</strong> لإدارة وتخطيط الموارد</span>
            <span dir="ltr" style="font-weight: 700; color: #170e5e;">Powered by Z-Systems ERP • www.z-systems.io</span>
          </div>
          <script>
            setTimeout(() => { window.print(); window.close(); }, 500);
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
  };

  const printDetailedPayrollReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const totalBase = filteredRunItems.reduce((acc, row) => acc + Number(row.baseSalary || 0), 0);
    const totalAllowances = filteredRunItems.reduce((acc, row) => acc + Number(row.allowanceAmount || 0), 0);
    const totalGross = filteredRunItems.reduce((acc, row) => acc + Number(row.grossPay || (Number(row.baseSalary || 0) + Number(row.allowanceAmount || 0))), 0);
    const totalAttendanceDeductions = filteredRunItems.reduce((acc, row) => acc + Number(row.deductionAmount || 0), 0);
    const totalLoans = filteredRunItems.reduce((acc, row) => acc + Number(row.loanDeductionAmount || 0), 0);
    const totalAllDeductions = filteredRunItems.reduce((acc, row) => acc + (Number(row.deductionAmount || 0) + Number(row.loanDeductionAmount || 0) + Number((row as any).employeeSocialInsurance || 0) + Number((row as any).incomeTax || 0)), 0);
    const totalNet = filteredRunItems.reduce((acc, row) => acc + Number(row.netPay || 0), 0);

    printWindow.document.write(`
      <html dir="rtl" lang="ar">
        <head>
          <title>${isSelectedRunHourlyOrWeekly ? 'كشف أجور العاملين المالي والتفصيلي' : (isEg ? 'كشف المرتبات المالي والتفصيلي' : 'مسير الرواتب المالي والتفصيلي')} - ${text(selectedRun?.periodMonth)}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
            @page { size: landscape; margin: 8mm 10mm; }
            body { font-family: 'Tajawal', Tahoma, Arial, sans-serif; padding: 0; margin: 0; color: #1e293b; line-height: 1.25; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .header { border-bottom: 2px solid #170e5e; padding-bottom: 6px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-end; }
            .header-center { text-align: center; }
            .header-center h1 { margin: 0; color: #170e5e; font-size: 18px; font-weight: 800; }
            .header-center p { margin: 2px 0 0; color: #64748b; font-size: 11.5px; font-weight: 500; }
            .header-meta { font-size: 10.5px; color: #475569; }
            .table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10.5px; }
            .table thead { display: table-header-group; }
            .table tr { page-break-inside: avoid; }
            .table th, .table td { padding: 4px 6px; text-align: right; border: 1px solid #cbd5e1; }
            .table th { background-color: #f1f5f9; font-weight: 700; color: #1e293b; text-align: center; }
            .table th.th-earnings { background-color: #f0fdf4; color: #166534; border-bottom: 2px solid #86efac; }
            .table th.th-deductions { background-color: #fef2f2; color: #991b1b; border-bottom: 2px solid #fca5a5; }
            .table th.th-net { background-color: #eef2ff; color: #312e81; border-bottom: 2px solid #a5b4fc; }
            .table tbody tr:nth-child(even) { background-color: #fafbfc; }
            .amount { font-family: monospace; font-size: 10.5px; font-weight: 600; white-space: nowrap; text-align: center; }
            .amount.pos { color: #166534; }
            .amount.neg { color: #dc2626; }
            .amount.net { font-weight: 800; color: #0f172a; background-color: #f8fafc; }
            .footer { margin-top: 10px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; padding-top: 8px; clear: both; page-break-inside: avoid; }
            .sig-box { text-align: center; }
            .sig-box .title { font-weight: 700; color: #475569; margin-bottom: 22px; font-size: 10.5px; }
            .sig-box .line { border-bottom: 1px solid #94a3b8; width: 75%; margin: 0 auto; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="header-meta">
              <strong>Z-Systems ERP</strong><br>
              قطاع الموارد البشرية والمالية
            </div>
            <div class="header-center">
              <h1>${isSelectedRunHourlyOrWeekly ? 'كشف أجور العاملين المالي والتفصيلي' : (isEg ? 'كشف المرتبات المالي والتفصيلي' : 'مسير الرواتب المالي والتفصيلي')}</h1>
              <p>${isSelectedRunHourlyOrWeekly ? 'كشف استحقاقات واستقطاعات أجور فترة:' : 'كشف استحقاقات واستقطاعات شهر:'} ${text(selectedRun?.periodMonth)} | الحالة: ${statusLabel(selectedRun?.status)}</p>
            </div>
            <div class="header-meta" style="text-align: left;">
              تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}<br>
              إجمالي القوى العاملة: ${filteredRunItems.length} موظف
            </div>
          </div>

          <table class="table">
            <thead>
              <tr>
                <th rowspan="2" style="width: 25px;">م</th>
                <th rowspan="2" style="width: 60px;">كود</th>
                <th rowspan="2" style="width: 1%; white-space: nowrap; text-align: right;">اسم الموظف</th>
                <th colspan="3" class="th-earnings">الاستحقاقات المالية (Earnings)</th>
                <th colspan="3" class="th-deductions">الاستقطاعات والجزاءات (Deductions)</th>
                <th rowspan="2" class="th-net" style="width: 110px;">${isSelectedRunHourlyOrWeekly ? 'صافي الأجر المستحق' : 'صافي الراتب المستحق'}</th>
                <th rowspan="2" style="width: 120px;">ملاحظات التدقيق</th>
              </tr>
              <tr>
                <th class="th-earnings" style="width: 90px;">${isSelectedRunHourlyOrWeekly ? 'أجر الساعات' : 'الأساسي'}</th>
                <th class="th-earnings" style="width: 80px;">البدلات/الإضافي</th>
                <th class="th-earnings" style="width: 95px;">إجمالي المستحق</th>
                <th class="th-deductions" style="width: 85px;">تأخير/غياب</th>
                <th class="th-deductions" style="width: 80px;">أقساط سلف</th>
                <th class="th-deductions" style="width: 90px;">إجمالي الخصم</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRunItems.map((row, index) => {
                const bSalary = Number(row.baseSalary || 0);
                const alw = Number(row.allowanceAmount || 0);
                const gross = Number(row.grossPay || (bSalary + alw));
                const attDed = Number(row.deductionAmount || 0);
                const lDed = Number(row.loanDeductionAmount || 0);
                const insDed = Number((row as any).employeeSocialInsurance || 0);
                const taxDed = Number((row as any).incomeTax || 0);
                const totDed = attDed + lDed + insDed + taxDed;
                const net = Number(row.netPay || (gross - totDed));
                const isHourly = normalize(row.compensationType) === 'hourly' || (Number(row.hourlyRate || 0) > 0 && normalize(row.compensationType) !== 'monthly');
                const rate = Number(row.hourlyRate || 0);
                const hours = rate > 0 ? Number((bSalary / rate).toFixed(2)) : 0;
                return `
                  <tr>
                    <td style="text-align: center; color: #64748b;">${index + 1}</td>
                    <td style="text-align: center; color: #64748b; white-space: nowrap;">${text(row.employeeNo)}</td>
                    <td style="font-weight: 600; white-space: nowrap;">${text(row.employeeName)}</td>
                    <td class="amount" style="text-align: center;">
                      <div>${money(bSalary)}</div>
                      ${isHourly && rate > 0 ? `<div style="font-size: 8.5px; color: #166534; font-weight: 700;">${hours > 0 ? `${hours}س × ${money(rate)}/س` : `${money(rate)}/ساعة`}</div>` : ''}
                    </td>
                    <td class="amount pos">${alw > 0 ? money(alw) : '—'}</td>
                    <td class="amount pos" style="font-weight: 700;">${money(gross)}</td>
                    <td class="amount neg">${attDed > 0 ? money(attDed) : '—'}</td>
                    <td class="amount neg">${lDed > 0 ? money(lDed) : '—'}</td>
                    <td class="amount neg" style="font-weight: 700;">${totDed > 0 ? money(totDed) : '—'}</td>
                    <td class="amount net">${money(net)}</td>
                    <td style="font-size: 10.5px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                      ${text(row.notes || (Number(row.attendanceAbsentDays || 0) > 0 ? `غياب ${row.attendanceAbsentDays}ي` : ''))}
                    </td>
                  </tr>
                `;
              }).join('')}
              <tr style="background-color: #f1f5f9; font-weight: bold; font-size: 12px; border-top: 2px solid #94a3b8;">
                <td colspan="3" style="text-align: left; padding: 8px 10px; color: #0f172a;">${isSelectedRunHourlyOrWeekly ? 'الإجماليات العامة لكشف الأجور:' : (isEg ? 'الإجماليات العامة لكشف المرتبات:' : 'الإجماليات العامة للمسير:')}</td>
                <td class="amount">${money(totalBase)}</td>
                <td class="amount pos">${money(totalAllowances)}</td>
                <td class="amount pos" style="font-size: 12.5px;">${money(totalGross)}</td>
                <td class="amount neg">${money(totalAttendanceDeductions)}</td>
                <td class="amount neg">${money(totalLoans)}</td>
                <td class="amount neg" style="font-size: 12.5px;">${money(totalAllDeductions)}</td>
                <td class="amount net" style="font-size: 13px; color: #170e5e; background-color: #e0e7ff;">${money(totalNet)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <div class="footer">
            <div class="sig-box">
              <div class="title">إعداد ومراجعة الموارد البشرية</div>
              <div class="line"></div>
            </div>
            <div class="sig-box">
              <div class="title">تدقيق الحسابات والمراجعة الداخلية</div>
              <div class="line"></div>
            </div>
            <div class="sig-box">
              <div class="title">اعتماد المدير المالي (CFO)</div>
              <div class="line"></div>
            </div>
            <div class="sig-box">
              <div class="title">اعتماد الإدارة العامة والتشغيل</div>
              <div class="line"></div>
            </div>
          </div>
          <div style="margin-top: 14px; border-top: 1px dashed #cbd5e1; padding-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 9.5px; color: #64748b; clear: both; page-break-inside: avoid;">
            <span>تم استخراج وتوثيق هذا الكشف المالي آلياً بواسطة منظومة <strong>Z-Systems Cloud ERP</strong> لإدارة وتخطيط الموارد المؤسسية</span>
            <span dir="ltr" style="font-weight: 700; color: #170e5e;">Powered by Z-Systems ERP • www.z-systems.io</span>
          </div>
          <script>
            setTimeout(() => { window.print(); window.close(); }, 500);
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
  };

  return (
    <div className="page-stack page-shell" dir="rtl">
      <main className="document-prototype-column" style={{ paddingBottom: '20px' }}>
        <PageHeader
          title={t('hr.hr_payroll_page.s0', "المرتبات")}
          description={
            isEg
              ? 'مسار واضح لدورة القبض: جهّز كشف المرتبات، راجع الحضور والإجازات والسلف، ثم اعتمد عند اكتمال المراجعة.'
              : 'مسار واضح لدورة القبض: جهّز المسير، راجع الحضور والإجازات والسلف، ثم اعتمد عند اكتمال المراجعة.'
          }
          actions={
            <div className="actions compact-actions">
              {hasCreatePayrollRun && canManagePayroll ? (
                <Button onClick={openCreateModal}>
                  {isEg ? 'إنشاء كشف المرتبات' : 'تجهيز مسير الرواتب'}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => navigate('/hr/attendance')}>{t('hr.hr_payroll_page.s3', "مراجعة الحضور")}</Button>
              <Button variant="secondary" onClick={() => navigate('/hr/loans')}>{t('hr.hr_payroll_page.s4', "مراجعة السلف")}</Button>
              <Button variant="secondary" onClick={() => navigate('/hr/employees')}>{t('hr.hr_payroll_page.s5', "رجوع للموظفين")}</Button>
            </div>
          }
        />
        <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          {!canViewPayroll ? (
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '10px', textAlign: 'center', color: '#64748b' }}>
              <p style={{ margin: 0 }}>{t('hr.hr_payroll_page.s6', "ليس لديك صلاحية للوصول إلى بيانات المرتبات.")}</p>
            </div>
          ) : (
            <>
              <HrPayrollTopSections
                monthFilter={monthFilter}
                search={search}
                selectedEmployeeId={selectedEmployeeId}
                onSelectedEmployeeChange={setSelectedEmployeeId}
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
                isCreatePending={mutations.createPayrollRun.isPending}
                isEgypt={isEg}
                baseSalaryLabel={topKpiBaseSalaryLabel}
                netPayLabel={topKpiNetPayLabel}
                onMonthFilterChange={(value) => { setMonthFilter(value); setPage(1); }}
                onSearchChange={setSearch}
                onDepartmentFilterChange={setDepartmentFilter}
                onReviewStatusFilterChange={setReviewStatusFilter}
                onRunStatusFilterChange={setRunStatusFilter}
                onDraftChange={setDraft}
                onCreateRun={(event) => { void handleCreateRun(event); }}
              />

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
              <PayrollRunsTable
                payrollChecklist={payrollChecklist}
                runs={filteredRuns}
                isLoading={workspace.payrollRuns.isLoading}
                isError={workspace.payrollRuns.isError}
                error={workspace.payrollRuns.error}
                page={page}
                pageSize={pageSize}
                totalItems={filteredRuns.length}
                onPageChange={setPage}
                onPageSizeChange={(next) => { setPageSize(next); setPage(1); }}
                onSelectRun={(id) => setSelectedRunId(id)}
                selectedRunId={selectedRunId}
                activeTab={activeRunTab}
                onTabChange={handleTabChange}
                tabCounts={tabCounts}
                onCreateRun={hasCreatePayrollRun && canManagePayroll ? openCreateModal : undefined}
                canViewSalaryAmounts={canViewSalaryAmounts}
                canManagePayroll={canManagePayroll}
                canApprovePayroll={canApprovePayroll}
                onRecalculate={(id) => void handleRecalculateRun(id)}
                onReviewClick={(id) => handleRunActionClick(id, 'review')}
                onApproveClick={(id) => handleRunActionClick(id, 'approve')}
                onPayClick={(id) => { setSelectedRunId(id); setPayModalTargetItem(null); setShowPayRun(true); }}
                onCancel={(id) => void handleCancelRun(id)}
                isEgypt={isEg}
              />

              {/* Selected Run Details Table */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                    {isEg ? 'تفاصيل ومراجعة موظفي كشف المرتبات' : 'تفاصيل ومراجعة موظفي مسير الرواتب'} {selectedRun ? `(${text(selectedRun.periodMonth)})` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {selectedRun && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setShowWpsModal(true)}
                        style={{ padding: '2px 10px', fontSize: '0.8rem', background: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0', fontWeight: 600 }}
                      >
                        {t('hr.hr_payroll_page.s8', "تصدير ملف حماية الأجور (WPS / SIF)")}
                      </Button>
                    )}
                    {selectedRun && (
                      <Button
                        variant="secondary"
                        onClick={() => printPayrollSignatureSheet()}
                        style={{ padding: '2px 10px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <PrinterIcon size={14} />
                        <span>{t('hr.hr_payroll_page.s9', "كشف التوقيعات (مختصر)")}</span>
                      </Button>
                    )}
                    {selectedRun && (
                      <Button
                        variant="secondary"
                        onClick={() => printDetailedPayrollReport()}
                        style={{ padding: '2px 10px', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#f8fafc', borderColor: '#cbd5e1' }}
                      >
                        <FileTextIcon size={14} />
                        <span>{isEg ? 'الكشف المالي التفصيلي (A4 أفقي)' : 'المسير المالي التفصيلي (A4 أفقي)'}</span>
                      </Button>
                    )}
                  </div>
                </div>

                {!selectedRunId ? (
                  <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                    {t('hr.hr_payroll_page.s10', "اضغط على أي كشف من الجدول أعلاه لعرض وتفصيل رواتب الموظفين الخاصة به.")}
                  </div>
                ) : (
                  <QueryFeedback
                    isLoading={payrollRunDetails.isLoading}
                    isError={payrollRunDetails.isError}
                    error={payrollRunDetails.error}
                    isEmpty={false}
                    loadingText={isEg ? 'جارٍ تحميل تفاصيل الكشف...' : 'جارٍ تحميل تفاصيل المسير...'}
                    errorTitle={isEg ? 'تعذر تحميل تفاصيل الكشف' : 'تعذر تحميل تفاصيل المسير'}
                  >
                    {!selectedRun ? (
                      <p className="muted">{isEg ? 'تفاصيل الكشف غير متاحة.' : 'تفاصيل المسير غير متاحة.'}</p>
                    ) : filteredRunItems.length ? (
                      <DataTable
                        rows={filteredRunItems}
                        rowKey={(row) => String(row.id)}
                        density="compact"
                        columns={[
                          { key: 'employeeNo', header: t('hr.hr_payroll_page.s14', "كود الموظف"), cell: (row) => <span style={{ whiteSpace: 'nowrap' }}>{text(row.employeeNo)}</span> },
                          { key: 'employeeName', header: t('hr.hr_payroll_page.s15', "اسم الموظف"), cell: (row) => <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{text(row.employeeName)}</span> },
                          {
                            key: 'baseSalary',
                            header: baseCompensationHeader,
                            cell: (row) => {
                              if (!canViewSalaryAmounts) return '—';
                              const isHourly = normalize(row.compensationType) === 'hourly' || (Number(row.hourlyRate || 0) > 0 && normalize(row.compensationType) !== 'monthly');
                              const rate = Number(row.hourlyRate || 0);
                              const base = Number(row.baseSalary || 0);
                              const hours = rate > 0 ? Number((base / rate).toFixed(2)) : 0;
                              return (
                                <div>
                                  <div style={{ fontWeight: 600 }}>{money(base)}</div>
                                  {isHourly && rate > 0 && (
                                    <div style={{ fontSize: '0.725rem', color: '#166534', fontWeight: 600 }}>
                                      {hours > 0 ? `${hours} س × ${money(rate)}/س` : `${money(rate)}/ساعة`}
                                    </div>
                                  )}
                                </div>
                              );
                            },
                          },
                          { key: 'allowanceAmount', header: t('hr.hr_payroll_page.s17', "البدلات والإضافي"), cell: (row) => canViewSalaryAmounts ? money(row.allowanceAmount) : '—' },
                          { key: 'deductionAmount', header: t('hr.hr_payroll_page.s18', "الخصومات"), cell: (row) => canViewSalaryAmounts ? money(row.deductionAmount) : '—' },
                          { key: 'loanDeductionAmount', header: t('hr.hr_payroll_page.s19', "السلف/الأقساط"), cell: (row) => canViewSalaryAmounts ? money(row.loanDeductionAmount) : '—' },
                          {
                            key: 'netPay',
                            header: t('hr.hr_payroll_page.s20', "صافي الراتب"),
                            cell: (row) => canViewSalaryAmounts ? (
                              <span style={{ fontWeight: 700, color: '#15803d' }}>{money(row.netPay)}</span>
                            ) : '—',
                          },
                          {
                            key: 'status',
                            header: t('hr.hr_payroll_page.s21', "الحالة"),
                            cell: (row) => {
                              const st = normalize(row.status);
                              if (st === 'paid') {
                                return (
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      padding: '1px 6px',
                                      borderRadius: '10px',
                                      fontSize: '0.69rem',
                                      fontWeight: 700,
                                      background: '#f0fdf4',
                                      color: '#166534',
                                      border: '1px solid #86efac',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                                    تم الصرف
                                  </span>
                                );
                              }
                              if (st === 'approved') {
                                return (
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      padding: '1px 6px',
                                      borderRadius: '10px',
                                      fontSize: '0.69rem',
                                      fontWeight: 700,
                                      background: '#ecfdf5',
                                      color: '#065f46',
                                      border: '1px solid #a7f3d0',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                                    معتمد
                                  </span>
                                );
                              }
                              return statusLabel(row.status);
                            },
                          },
                          {
                            key: 'actions',
                            header: t('hr.hr_payroll_page.s22', "الإجراءات"),
                            cell: (row) => {
                              const isApproved = normalize(row.status) === 'approved';
                              const isRunPayable = selectedRun && ['approved', 'partially_paid'].includes(normalize(selectedRun.status));
                              const canPayThisItem = canApprovePayroll && isApproved && isRunPayable;

                              return (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <Button
                                    variant="secondary"
                                    onClick={() => setSelectedReviewItem(row)}
                                    style={{ padding: '2px 8px', fontSize: '0.73rem' }}
                                  >
                                    {t('hr.hr_payroll_page.s23', "تفاصيل")}
                                  </Button>
                                  {canPayThisItem && (
                                    <Button
                                      variant="primary"
                                      onClick={() => handleOpenPayItemModal(row)}
                                      style={{
                                        padding: '2px 8px',
                                        fontSize: '0.73rem',
                                        fontWeight: 700,
                                        background: '#170e5e',
                                        color: '#ffffff',
                                      }}
                                      title="صرف مستحقات هذا الموظف فردياً"
                                    >
                                      صرف
                                    </Button>
                                  )}
                                </div>
                              );
                            },
                          },
                        ]}
                      />
                    ) : (
                      <p className="muted" style={{ padding: '16px', textAlign: 'center' }}>{t('hr.hr_payroll_page.s24', "لا توجد نتائج مطابقة للبحث أو الفلاتر الحالية.")}</p>
                    )}
                  </QueryFeedback>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Modals */}
      <CreatePayrollRunModal
        isOpen={showCreateRun}
        onClose={() => setShowCreateRun(false)}
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={handleCreateRun}
        isPending={mutations.createPayrollRun.isPending}
        canManagePayroll={canManagePayroll}
        hasCreatePayrollRun={hasCreatePayrollRun}
        formError={formError}
        employees={employees}
        isEgypt={isEg}
        serverTime={workspace.payrollRuns.data?.serverTime}
        serverTimezone={workspace.payrollRuns.data?.serverTimezone}
      />

      <PayPayrollRunModal
        isOpen={showPayRun}
        onClose={() => {
          setShowPayRun(false);
          setPayModalTargetItem(null);
        }}
        selectedRun={selectedRun}
        targetItem={payModalTargetItem}
        canApprovePayroll={canApprovePayroll}
        onSuccess={() => {
          setPayModalTargetItem(null);
        }}
      />

      {showWpsModal && selectedRun && (
        <PayrollWpsExportModal
          runId={String(selectedRun.id)}
          runMonth={String(selectedRun.periodMonth || '')}
          runName={String((selectedRun as any).name || `${isEg ? 'كشف' : 'مسير'} شهر ${selectedRun.periodMonth || ''}`)}
          onClose={() => setShowWpsModal(false)}
        />
      )}

      <PayrollReviewItemModal
        item={activeReviewItem}
        onClose={() => setSelectedReviewItem(null)}
        canViewSalaryAmounts={canViewSalaryAmounts}
        runIsFinal={Boolean(runIsFinal)}
        isDraft={selectedRun?.status === 'draft'}
        periodMonth={selectedRun?.periodMonth}
        onAddAdjustment={handleAddAdjustment}
        onDeleteAdjustment={handleDeleteAdjustment}
        onNavigateToAttendance={(employeeId) => navigate(`/hr/attendance?employeeId=${employeeId}${selectedRun?.periodMonth ? `&period=${selectedRun.periodMonth}` : ''}`)}
        onNavigateToEmployee={(employeeId) => navigate(`/hr/employees/${employeeId}`)}
        onPrintSummary={(item) => toast.info(t('hr.hr_payroll_page.s25', "طباعة ملخص للموظف ") + item.employeeName)}
        onPrintDetailed={(item) => toast.info(t('hr.hr_payroll_page.s26', "طباعة تفصيلي للموظف ") + item.employeeName)}
        onPayItem={handleOpenPayItemModal}
        canApprovePayroll={canApprovePayroll}
      />

      {pendingApprovalAction && (
        <DialogShell open={true} onClose={() => setPendingApprovalAction(null)} width="600px">
          <div style={{ padding: '24px' }}>
            <h2 style={{ marginTop: 0, color: '#dc2626' }}>{t('hr.hr_payroll_page.s27', "تنبيه: استثناءات معلقة")}</h2>
            <p>{t('hr.hr_payroll_page.s28', "يوجد استثناءات حضور وانصراف معلقة للموظفين بحاجة للمراجعة. هل أنت متأكد من رغبتك بالاستمرار دون معالجتها؟")}</p>
            <div className="actions">
              <Button variant="secondary" onClick={() => setPendingApprovalAction(null)}>{t('hr.hr_payroll_page.s29', "إلغاء ومراجعة الاستثناءات")}</Button>
              <Button variant="danger" onClick={() => executeRunAction(pendingApprovalAction.runId, pendingApprovalAction.type)}>{t('hr.hr_payroll_page.s30', "نعم، تابع الاعتماد")}</Button>
            </div>
          </div>
        </DialogShell>
      )}
    </div>
  );
}
