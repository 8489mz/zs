import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/app/query-keys';
import { hrApi, type HrListParams } from '@/features/hr/api/hr.api';
import { useHasAnyPermission } from '@/shared/hooks/use-permission';

function paramsKey(params: HrListParams) {
  return JSON.stringify({
    page: params.page || 1,
    pageSize: params.pageSize || 25,
    search: params.search || '',
    employeeId: params.employeeId || '',
    departmentId: params.departmentId || '',
    period: params.period || '',
    month: params.month || '',
    periodMonth: params.periodMonth || '',
    from: params.from || '',
    to: params.to || '',
    status: params.status || '',
  });
}

export function useHrWorkspace(params: HrListParams) {
  const key = paramsKey(params);
  const canViewEmployees = useHasAnyPermission(['hrEmployees']);
  const canViewAttendance = useHasAnyPermission(['hrAttendance']);
  const canViewLoans = useHasAnyPermission(['hrLoans']);
  const canViewPayroll = useHasAnyPermission(['hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove']);
  const canViewHrSetup = useHasAnyPermission(['hrEmployees', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove', 'hrSalaryManage', 'settings', 'canManageSettings']);
  const canViewSummary = useHasAnyPermission(['hr', 'hrEmployees', 'hrAttendance', 'hrLoans', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove']);

  return {
    summary: useQuery({ queryKey: queryKeys.hrSummary, queryFn: hrApi.summary, enabled: canViewSummary }),
    employees: useQuery({ queryKey: queryKeys.hrEmployees(key), queryFn: () => hrApi.employees(params), placeholderData: (previous) => previous, enabled: canViewEmployees }),
    departments: useQuery({ queryKey: queryKeys.hrMasterData('departments'), queryFn: () => hrApi.masterData('departments'), enabled: canViewEmployees || canViewAttendance || canViewPayroll || canViewHrSetup }),
    jobTitles: useQuery({ queryKey: queryKeys.hrMasterData('job-titles'), queryFn: () => hrApi.masterData('job-titles'), enabled: canViewHrSetup }),
    positions: useQuery({ queryKey: queryKeys.hrMasterData('positions'), queryFn: () => hrApi.masterData('positions'), enabled: canViewHrSetup }),
    loans: useQuery({ queryKey: queryKeys.hrLoans(key), queryFn: () => hrApi.loans(params), placeholderData: (previous) => previous, enabled: canViewLoans }),
    withdrawals: useQuery({ queryKey: queryKeys.hrWithdrawals(key), queryFn: () => hrApi.withdrawals(params), enabled: Boolean(params.employeeId) && canViewLoans, placeholderData: (previous) => previous }),
    payrollRuns: useQuery({ queryKey: queryKeys.hrPayrollRuns(key), queryFn: () => hrApi.payrollRuns(params), placeholderData: (previous) => previous, enabled: canViewPayroll }),
  };
}

export function useHrProfile(employeeId?: string) {
  return useQuery({
    queryKey: queryKeys.hrProfile(employeeId || ''),
    queryFn: () => hrApi.profile(employeeId || ''),
    enabled: Boolean(employeeId),
  });
}

export function useHrPayrollRun(runId?: string) {
  return useQuery({
    queryKey: queryKeys.hrPayrollRun(runId || ''),
    queryFn: () => hrApi.payrollRun(runId || ''),
    enabled: Boolean(runId),
  });
}

export function useHrAttendance(params: HrListParams & { date?: string; workDate?: string }, options?: { enabled?: boolean }) {
  const key = paramsKey(params);
  const dateKey = String(params.date || params.workDate || '');
  const canViewAttendance = useHasAnyPermission(['hrAttendance']);
  return useQuery({
    queryKey: ['hr', 'attendance', dateKey, key],
    queryFn: () => hrApi.attendance(params),
    placeholderData: (previous) => previous,
    enabled: canViewAttendance && (options?.enabled ?? true),
  });
}

export function useHrAttendanceExceptions(params: HrListParams & { date?: string; workDate?: string } = {}, options?: { enabled?: boolean }) {
  const key = paramsKey(params);
  const dateKey = String(params.date || params.workDate || '');
  const canViewAttendance = useHasAnyPermission(['hrAttendance']);
  return useQuery({
    queryKey: ['hr', 'attendance-exceptions', dateKey, key],
    queryFn: () => hrApi.attendanceExceptions(params),
    placeholderData: (previous) => previous,
    enabled: canViewAttendance && (options?.enabled ?? true),
  });
}

export function useHrLeaveTypes(params: HrListParams = {}, options?: { enabled?: boolean }) {
  const key = paramsKey(params);
  const canViewEmployees = useHasAnyPermission(['hrEmployees', 'settings', 'canManageSettings']);
  return useQuery({
    queryKey: ['hr', 'leave-types', key],
    queryFn: () => hrApi.leaveTypes(params),
    placeholderData: (previous) => previous,
    enabled: canViewEmployees && (options?.enabled ?? true),
  });
}

export function useHrHolidays(params: HrListParams = {}, options?: { enabled?: boolean }) {
  const key = paramsKey(params);
  const canViewHolidays = useHasAnyPermission(['hrEmployees', 'hrAttendance', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove', 'settings', 'canManageSettings']);
  return useQuery({
    queryKey: ['hr', 'holidays', key],
    queryFn: () => hrApi.listHolidays(params),
    placeholderData: (previous) => previous,
    enabled: canViewHolidays && (options?.enabled ?? true),
  });
}

export function useHrLeaveRequests(params: HrListParams & { enabled?: boolean } = {}) {
  const key = paramsKey(params);
  const canViewEmployees = useHasAnyPermission(['hrEmployees']);
  return useQuery({
    queryKey: ['hr', 'leave-requests', key],
    queryFn: () => hrApi.leaveRequests(params),
    placeholderData: (previous) => previous,
    enabled: canViewEmployees && (params.enabled ?? true),
  });
}

export function useHrEmployeeAssets(params: HrListParams & { enabled?: boolean } = {}) {
  const key = paramsKey(params);
  const canViewEmployees = useHasAnyPermission(['hrEmployees']);
  return useQuery({
    queryKey: ['hr', 'employee-assets', key],
    queryFn: () => hrApi.employeeAssets(params),
    placeholderData: (previous) => previous,
    enabled: canViewEmployees && (params.enabled ?? true),
  });
}

export function useHrEmployeeAdjustments(employeeId?: string) {
  const canViewAdjustments = useHasAnyPermission(['hrSalaryView', 'hrSalaryManage', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove']);
  const q = useQuery({
    queryKey: ['hr', 'employee-adjustments', employeeId],
    queryFn: () => hrApi.employeeAdjustments(employeeId!),
    enabled: Boolean(employeeId) && canViewAdjustments,
  });
  return { ...q, adjustments: q.data?.rows || [] };
}

export function useHrReportsSummary(params: HrListParams = {}, options?: { enabled?: boolean }) {
  const key = paramsKey(params);
  const canViewHrReports = useHasAnyPermission(['hrEmployees', 'hrLoans', 'hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove', 'hrSalaryView', 'hrSalaryManage']);
  return useQuery({
    queryKey: ['hr', 'reports-summary', key],
    queryFn: () => hrApi.reportsSummary(params),
    placeholderData: (previous) => previous,
    enabled: canViewHrReports && (options?.enabled ?? true),
  });
}

export function useHrPayrollPolicies(options?: { enabled?: boolean }) {
  const canViewPolicies = useHasAnyPermission(['hrPayrollView', 'hrPayrollManage', 'hrSalaryView', 'hrSalaryManage']);
  return useQuery({
    queryKey: ['hr', 'payroll-policies'],
    queryFn: hrApi.getPayrollPolicies,
    enabled: canViewPolicies && (options?.enabled ?? true),
  });
}

export function useHrMutations() {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['hr', 'payroll-policies'] });
    await queryClient.invalidateQueries({ queryKey: ['hr'] });
  };

  return {
    updatePayrollPolicies: useMutation({ mutationFn: hrApi.updatePayrollPolicies, onSuccess: invalidate }),
    saveEmployee: useMutation({ mutationFn: ({ id, payload }: { id?: string; payload: unknown }) => hrApi.saveEmployee(payload, id), onSuccess: invalidate }),
    endOfService: useMutation({ mutationFn: ({ id, payload }: { id: string; payload: unknown }) => hrApi.endOfService(id, payload), onSuccess: invalidate }),
    saveContact: useMutation({ mutationFn: ({ employeeId, id, payload }: { employeeId: string; id?: string; payload: unknown }) => hrApi.saveContact(employeeId, payload, id), onSuccess: invalidate }),
    deactivateEmployee: useMutation({ mutationFn: (id: string) => hrApi.deactivateEmployee(id), onSuccess: invalidate }),
    saveMasterData: useMutation({ mutationFn: ({ kind, id, payload }: { kind: 'departments' | 'job-titles' | 'positions'; id?: string; payload: unknown }) => hrApi.saveMasterData(kind, payload, id), onSuccess: invalidate }),
    saveDocument: useMutation({ mutationFn: ({ employeeId, id, payload }: { employeeId: string; id?: string; payload: unknown }) => hrApi.saveDocument(employeeId, payload, id), onSuccess: invalidate }),
    saveContract: useMutation({ mutationFn: ({ employeeId, id, payload }: { employeeId: string; id?: string; payload: unknown }) => hrApi.saveContract(employeeId, payload, id), onSuccess: invalidate }),
    saveCompensation: useMutation({ mutationFn: ({ employeeId, id, payload }: { employeeId: string; id?: string; payload: unknown }) => hrApi.saveCompensation(employeeId, payload, id), onSuccess: invalidate }),
    saveAttendanceDay: useMutation({ mutationFn: (payload: unknown) => hrApi.saveAttendanceDay(payload), onSuccess: invalidate }),
    saveAttendanceRecord: useMutation({ mutationFn: (payload: unknown) => hrApi.saveAttendanceRecord(payload), onSuccess: invalidate }),
    bulkImportAttendanceRecords: useMutation({ mutationFn: (payload: { records: { employeeNo: string; workDate: string; checkInAt?: string; checkOutAt?: string }[] }) => hrApi.bulkImportAttendanceRecords(payload), onSuccess: invalidate }),
    approveAttendanceException: useMutation({ mutationFn: ({ id, payload }: { id: string; payload?: unknown }) => hrApi.approveAttendanceException(id, payload || {}), onSuccess: invalidate }),
    skipAttendanceException: useMutation({ mutationFn: ({ id, payload }: { id: string; payload?: unknown }) => hrApi.skipAttendanceException(id, payload || {}), onSuccess: invalidate }),
    saveLeaveType: useMutation({ mutationFn: ({ id, payload }: { id?: string; payload: unknown }) => hrApi.saveLeaveType(payload, id), onSuccess: invalidate }),
    createLeaveRequest: useMutation({ mutationFn: (payload: unknown) => hrApi.createLeaveRequest(payload), onSuccess: invalidate }),
    approveLeaveRequest: useMutation({ mutationFn: ({ id, payload }: { id: string; payload?: unknown }) => hrApi.approveLeaveRequest(id, payload || {}), onSuccess: invalidate }),
    rejectLeaveRequest: useMutation({ mutationFn: ({ id, payload }: { id: string; payload?: unknown }) => hrApi.rejectLeaveRequest(id, payload || {}), onSuccess: invalidate }),
    cancelLeaveRequest: useMutation({ mutationFn: ({ id, payload }: { id: string; payload?: unknown }) => hrApi.cancelLeaveRequest(id, payload || {}), onSuccess: invalidate }),
    saveEmployeeAsset: useMutation({ mutationFn: ({ id, payload }: { id?: string; payload: unknown }) => hrApi.saveEmployeeAsset(payload, id), onSuccess: invalidate }),
    returnEmployeeAsset: useMutation({ mutationFn: ({ id, payload }: { id: string; payload?: unknown }) => hrApi.returnEmployeeAsset(id, payload || {}), onSuccess: invalidate }),
    markEmployeeAssetLost: useMutation({ mutationFn: ({ id, payload }: { id: string; payload?: unknown }) => hrApi.markEmployeeAssetLost(id, payload || {}), onSuccess: invalidate }),
    markEmployeeAssetDamaged: useMutation({ mutationFn: ({ id, payload }: { id: string; payload?: unknown }) => hrApi.markEmployeeAssetDamaged(id, payload || {}), onSuccess: invalidate }),
    cancelEmployeeAsset: useMutation({ mutationFn: ({ id, payload }: { id: string; payload?: unknown }) => hrApi.cancelEmployeeAsset(id, payload || {}), onSuccess: invalidate }),
    saveLoan: useMutation({ mutationFn: ({ id, payload }: { id?: string; payload: unknown }) => hrApi.saveLoan(payload, id), onSuccess: invalidate }),
    approveLoan: useMutation({ mutationFn: (id: string) => hrApi.approveLoan(id), onSuccess: invalidate }),
    disburseLoan: useMutation({ mutationFn: (id: string) => hrApi.disburseLoan(id), onSuccess: invalidate }),
    repayLoan: useMutation({ mutationFn: ({ id, payload }: { id: string; payload: unknown }) => hrApi.repayLoan(id, payload), onSuccess: invalidate }),
    createPayrollRun: useMutation({ mutationFn: (payload: unknown) => hrApi.createPayrollRun(payload), onSuccess: invalidate }),
    recalculatePayrollRun: useMutation({ mutationFn: (id: string) => hrApi.recalculatePayrollRun(id), onSuccess: invalidate }),
    reviewPayrollRun: useMutation({ mutationFn: (id: string) => hrApi.reviewPayrollRun(id), onSuccess: invalidate }),
    applyAttendanceDeductions: useMutation({ mutationFn: (id: string) => hrApi.applyAttendanceDeductions(id), onSuccess: invalidate }),
    approvePayrollRun: useMutation({ mutationFn: (id: string) => hrApi.approvePayrollRun(id), onSuccess: invalidate }),
    cancelPayrollRun: useMutation({ mutationFn: (id: string) => hrApi.cancelPayrollRun(id), onSuccess: invalidate }),
    payPayrollRun: useMutation({ mutationFn: ({ id, payload }: { id: string; payload: { paymentChannel: 'cash' | 'bank' | 'drawer'; paymentReference?: string; notes?: string; shiftId?: number; allowOverdraft?: boolean } }) => hrApi.payPayrollRun(id, payload), onSuccess: invalidate }),
    payPayrollRunItem: useMutation({ mutationFn: ({ id, itemId, payload }: { id?: string | number; itemId?: string | number; payload: { paymentChannel: 'cash' | 'bank' | 'drawer'; paymentReference?: string; notes?: string; shiftId?: number; allowOverdraft?: boolean } }) => hrApi.payPayrollRunItem(String(id || itemId), payload), onSuccess: invalidate }),
    updatePayrollRunItem: useMutation({ mutationFn: ({ id, payload }: { id: string; payload: unknown }) => hrApi.updatePayrollRunItem(id, payload), onSuccess: invalidate }),
    createPayrollAdjustment: useMutation({ mutationFn: ({ id, payload }: { id: string; payload: unknown }) => hrApi.createPayrollAdjustment(id, payload), onSuccess: invalidate }),
    deletePayrollAdjustment: useMutation({ mutationFn: (id: string) => hrApi.deletePayrollAdjustment(id), onSuccess: invalidate }),
    createEmployeeAdjustment: useMutation({ mutationFn: ({ employeeId, payload }: { employeeId: string; payload: unknown }) => hrApi.createEmployeeAdjustment(employeeId, payload), onSuccess: invalidate }),
    deleteEmployeeAdjustment: useMutation({ mutationFn: (id: string) => hrApi.deleteEmployeeAdjustment(id), onSuccess: invalidate }),
    saveHoliday: useMutation({ mutationFn: ({ id, payload }: { id?: string; payload: unknown }) => hrApi.saveHoliday(payload, id), onSuccess: invalidate }),
    deleteHoliday: useMutation({ mutationFn: (id: string) => hrApi.deleteHoliday(id), onSuccess: invalidate }),
  };
}


