import { http } from '@/lib/http';
import { buildQueryString } from '@/lib/query-string';
import type {
  HrCompensationPackage,
  HrContact,
  HrContract,
  HrDocument,
  HrLedgerEntry,
  HrSummary,
} from '@/types/domain';
import {
  normalizeHrAttendanceRow,
  normalizeHrAttendanceExceptionRow,
  normalizeHrEmployeeAssetRow,
  normalizeHrEmployeeRow,
  normalizeHrLeaveRequestRow,
  normalizeHrLeaveTypeRow,
  normalizeHrLoanRow,
  normalizeHrWithdrawalRow,
} from './hr-api.normalizers';
import type {
  AttendanceResponse,
  AttendanceExceptionsResponse,
  EmployeeAssetsResponse,
  EmployeesResponse,
  HrReportsSummaryResponse,
  LeaveRequestsResponse,
  LeaveTypesResponse,
  LoansResponse,
  MasterResponse,
  PayrollRunResponse,
  PayrollRunsResponse,
  ProfileResponse,
  RowsResponse,
  WithdrawalsResponse,
  EmployeeAdjustmentsResponse,
} from './hr-api.types';

const CSV_IMPORT_TIMEOUT_MS = 10 * 60 * 1000;

type MasterKind = 'departments' | 'job-titles' | 'positions';

export interface HrListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  employeeId?: string | number;
  departmentId?: string | number;
  period?: string;
  month?: string;
  periodMonth?: string;
  from?: string;
  to?: string;
  status?: string;
}

export const hrApi = {
  getPayrollPolicies: () => http('/api/hr/settings/payroll-policies'),
  updatePayrollPolicies: (data: any) => http('/api/hr/settings/payroll-policies', { method: 'PUT', body: JSON.stringify(data) }),
  summary: async () => (await http<{ summary?: HrSummary }>('/api/hr/summary')).summary || { employeeCount: 0, activeCount: 0, openLoans: 0, outstandingAmount: 0 },
  withdrawals: async (params: HrListParams = {}) => {
    const response = await http<WithdrawalsResponse>(`/api/hr/withdrawals${buildQueryString(params)}`);
    return { ...response, rows: (response.rows || []).map(normalizeHrWithdrawalRow) };
  },
  masterData: async (kind: MasterKind, params: HrListParams = {}) => http<MasterResponse>(`/api/hr/${kind}${buildQueryString(params)}`),
  saveMasterData: (kind: MasterKind, payload: unknown, id?: string) => http(`/api/hr/${kind}${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }),
  deactivateMasterData: (kind: MasterKind, id: string) => http(`/api/hr/${kind}/${id}`, { method: 'DELETE' }),
  employees: async (params: HrListParams = {}) => {
    const response = await http<EmployeesResponse>(`/api/hr/employees${buildQueryString(params)}`);
    return { ...response, employees: (response.employees || []).map(normalizeHrEmployeeRow) };
  },
  attendance: async (params: HrListParams & { date?: string; workDate?: string } = {}) => {
    const response = await http<AttendanceResponse>(`/api/hr/attendance${buildQueryString(params)}`);
    return { ...response, rows: (response.rows || []).map(normalizeHrAttendanceRow) };
  },
  attendanceExceptions: async (params: HrListParams & { date?: string; workDate?: string } = {}) => {
    const response = await http<AttendanceExceptionsResponse>(`/api/hr/attendance/exceptions${buildQueryString(params)}`);
    return { ...response, rows: (response.rows || []).map(normalizeHrAttendanceExceptionRow) };
  },
  saveAttendanceDay: (payload: unknown) => http<AttendanceResponse>('/api/hr/attendance', { method: 'POST', body: JSON.stringify(payload) }),
  saveAttendanceRecord: (payload: unknown) => http<AttendanceResponse>('/api/hr/attendance/record', { method: 'POST', body: JSON.stringify(payload) }),
  bulkImportAttendanceRecords: (payload: { records: { employeeNo: string; workDate: string; checkInAt?: string; checkOutAt?: string }[] }) => http<{ imported: number; skipped: number; errors: string[] }>('/api/hr/attendance/bulk-import', { method: 'POST', body: JSON.stringify(payload) }),
  approveAttendanceException: (id: string, payload: unknown = {}) => http<AttendanceExceptionsResponse>(`/api/hr/attendance/exceptions/${id}/approve`, { method: 'POST', body: JSON.stringify(payload) }),
  skipAttendanceException: (id: string, payload: unknown = {}) => http<AttendanceExceptionsResponse>(`/api/hr/attendance/exceptions/${id}/skip`, { method: 'POST', body: JSON.stringify(payload) }),
  leaveTypes: async (params: HrListParams = {}) => {
    const response = await http<LeaveTypesResponse>(`/api/hr/leave-types${buildQueryString(params)}`);
    return { ...response, rows: (response.rows || []).map(normalizeHrLeaveTypeRow) };
  },
  saveLeaveType: (payload: unknown, id?: string) => http<LeaveTypesResponse>(`/api/hr/leave-types${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }),
  leaveRequests: async (params: HrListParams = {}) => {
    const response = await http<LeaveRequestsResponse>(`/api/hr/leave-requests${buildQueryString(params)}`);
    return { ...response, requests: (response.requests || []).map(normalizeHrLeaveRequestRow) };
  },
  createLeaveRequest: (payload: unknown) => http<LeaveRequestsResponse>('/api/hr/leave-requests', { method: 'POST', body: JSON.stringify(payload) }),
  approveLeaveRequest: (id: string, payload: unknown = {}) => http<LeaveRequestsResponse>(`/api/hr/leave-requests/${id}/approve`, { method: 'POST', body: JSON.stringify(payload) }),
  rejectLeaveRequest: (id: string, payload: unknown = {}) => http<LeaveRequestsResponse>(`/api/hr/leave-requests/${id}/reject`, { method: 'POST', body: JSON.stringify(payload) }),
  cancelLeaveRequest: (id: string, payload: unknown = {}) => http<LeaveRequestsResponse>(`/api/hr/leave-requests/${id}/cancel`, { method: 'POST', body: JSON.stringify(payload) }),
  employeeAssets: async (params: HrListParams = {}) => {
    const response = await http<EmployeeAssetsResponse>(`/api/hr/assets${buildQueryString(params)}`);
    return { ...response, assets: (response.assets || []).map(normalizeHrEmployeeAssetRow) };
  },
  saveEmployeeAsset: (payload: unknown, id?: string) => http<EmployeeAssetsResponse>(`/api/hr/assets${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }),
  returnEmployeeAsset: (id: string, payload: unknown = {}) => http<EmployeeAssetsResponse>(`/api/hr/assets/${id}/return`, { method: 'POST', body: JSON.stringify(payload) }),
  markEmployeeAssetLost: (id: string, payload: unknown = {}) => http<EmployeeAssetsResponse>(`/api/hr/assets/${id}/lost`, { method: 'POST', body: JSON.stringify(payload) }),
  markEmployeeAssetDamaged: (id: string, payload: unknown = {}) => http<EmployeeAssetsResponse>(`/api/hr/assets/${id}/damaged`, { method: 'POST', body: JSON.stringify(payload) }),
  cancelEmployeeAsset: (id: string, payload: unknown = {}) => http<EmployeeAssetsResponse>(`/api/hr/assets/${id}/cancel`, { method: 'POST', body: JSON.stringify(payload) }),
  saveEmployee: (payload: unknown, id?: string) => http(`/api/hr/employees${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }),
  updateEmployeeStatus: (id: string, status: string) => http(`/api/hr/employees/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updateEmployeeCredentials: (id: string, payload: { phone?: string; pinCode?: string }) => http(`/api/hr/employees/${id}/credentials`, { method: 'PUT', body: JSON.stringify(payload) }),
  endOfService: (id: string, payload: unknown) => http<{ success: boolean; openAssets: number; unpaidLoans: number }>(`/api/hr/employees/${id}/end-of-service`, { method: 'POST', body: JSON.stringify(payload) }),
  getEndOfServicePreview: (id: string, endDate: string) => http<{ preview: any }>(`/api/hr/employees/${id}/end-of-service/preview?endDate=${endDate}`),
  deactivateEmployee: (id: string) => http(`/api/hr/employees/${id}`, { method: 'DELETE' }),
  profile: async (id: string) => {
    const response = await http<ProfileResponse>(`/api/hr/employees/${id}`);
    return { ...response, employee: response.employee ? normalizeHrEmployeeRow(response.employee) : response.employee };
  },
  contacts: (employeeId: string) => http<RowsResponse<HrContact>>(`/api/hr/employees/${employeeId}/contacts`),
  saveContact: (employeeId: string, payload: unknown, id?: string) => http(`/api/hr/employees/${employeeId}/contacts${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }),
  documents: (employeeId: string) => http<RowsResponse<HrDocument>>(`/api/hr/employees/${employeeId}/documents`),
  saveDocument: (employeeId: string, payload: unknown, id?: string) => http(`/api/hr/employees/${employeeId}/documents${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }),
  contracts: (employeeId: string) => http<RowsResponse<HrContract>>(`/api/hr/employees/${employeeId}/contracts`),
  saveContract: (employeeId: string, payload: unknown, id?: string) => http(`/api/hr/employees/${employeeId}/contracts${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }),
  compensation: (employeeId: string) => http<RowsResponse<HrCompensationPackage>>(`/api/hr/employees/${employeeId}/compensation`),
  saveCompensation: (employeeId: string, payload: unknown, id?: string) => http(`/api/hr/employees/${employeeId}/compensation${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }),
  employeeAdjustments: (employeeId: string) => http<EmployeeAdjustmentsResponse>(`/api/hr/employees/${employeeId}/adjustments`),
  createEmployeeAdjustment: (employeeId: string, payload: unknown) => http<Record<string, unknown>>(`/api/hr/employees/${employeeId}/adjustments`, { method: 'POST', body: JSON.stringify(payload) }),
  deleteEmployeeAdjustment: (id: string) => http<Record<string, unknown>>(`/api/hr/employee-adjustments/${id}`, { method: 'DELETE' }),
  loans: async (params: HrListParams = {}) => {
    const response = await http<LoansResponse>(`/api/hr/loans${buildQueryString(params)}`);
    return { ...response, loans: (response.loans || []).map(normalizeHrLoanRow) };
  },
  saveLoan: (payload: unknown, id?: string) => http(`/api/hr/loans${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }),
  approveLoan: (id: string) => http(`/api/hr/loans/${id}/approve`, { method: 'POST' }),
  disburseLoan: (id: string) => http(`/api/hr/loans/${id}/disburse`, { method: 'POST' }),
  repayLoan: (id: string, payload: unknown) => http(`/api/hr/loans/${id}/repayments`, { method: 'POST', body: JSON.stringify(payload) }),
  ledger: (employeeId: string) => http<RowsResponse<HrLedgerEntry>>(`/api/hr/employees/${employeeId}/ledger`),
  payrollRuns: (params: HrListParams = {}) => http<PayrollRunsResponse>(`/api/hr/payroll-runs${buildQueryString({ month: params.month, page: params.page, pageSize: params.pageSize })}`),
  createPayrollRun: (payload: unknown) => http<PayrollRunResponse>('/api/hr/payroll-runs', { method: 'POST', body: JSON.stringify(payload) }),
  payrollRun: (id: string) => http<PayrollRunResponse>(`/api/hr/payroll-runs/${id}`),
  recalculatePayrollRun: (id: string) => http<PayrollRunResponse>(`/api/hr/payroll-runs/${id}/recalculate`, { method: 'POST' }),
  reviewPayrollRun: (id: string) => http<PayrollRunResponse>(`/api/hr/payroll-runs/${id}/review`, { method: 'POST' }),
  applyAttendanceDeductions: (id: string) => http<PayrollRunResponse>(`/api/hr/payroll-runs/${id}/apply-attendance-deductions`, { method: 'POST' }),
  approvePayrollRun: (id: string) => http<PayrollRunResponse>(`/api/hr/payroll-runs/${id}/approve`, { method: 'POST' }),
  cancelPayrollRun: (id: string) => http<PayrollRunResponse>(`/api/hr/payroll-runs/${id}/cancel`, { method: 'POST' }),
  payPayrollRun: (id: string, payload: { paymentChannel: 'cash' | 'bank' | 'drawer'; paymentReference?: string; notes?: string; shiftId?: number; allowOverdraft?: boolean }) => http<PayrollRunResponse>(`/api/hr/payroll-runs/${id}/pay`, { method: 'POST', body: JSON.stringify(payload) }),
  payPayrollRunItem: (id: string, payload: { paymentChannel: 'cash' | 'bank' | 'drawer'; paymentReference?: string; notes?: string; shiftId?: number; allowOverdraft?: boolean }) => http<PayrollRunResponse>(`/api/hr/payroll-run-items/${id}/pay`, { method: 'POST', body: JSON.stringify(payload) }),
  generatePayrollWps: (id: string, payload: { payerCrNo?: string; payerBankRoutingCode?: string; payerName?: string; currency?: string } = {}) =>
    http<{
      ok: boolean;
      runId: number;
      runName: string;
      periodMonth: string;
      startDate: string;
      endDate: string;
      summary: {
        totalEmployees: number;
        totalNetPay: number;
        totalBaseSalary: number;
        totalAllowances: number;
        totalDeductions: number;
        currency: string;
        missingIbanCount: number;
      };
      sifContent: string;
      csvContent: string;
      records: Array<{
        id: number;
        employeeId: number;
        employeeNo: string;
        displayName: string;
        nationalId: string;
        bankName: string;
        bankAccountNumber: string;
        iban: string;
        bankSwiftCode: string;
        baseSalary: number;
        allowances: number;
        deductions: number;
        netPay: number;
      }>;
    }>(`/api/hr/payroll-runs/${id}/wps`, { method: 'POST', body: JSON.stringify(payload) }),
  updatePayrollRunItem: (id: string, payload: unknown) => http<PayrollRunResponse>(`/api/hr/payroll-run-items/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  createPayrollAdjustment: (id: string, payload: unknown) => http<PayrollRunResponse>(`/api/hr/payroll-run-items/${id}/adjustments`, { method: 'POST', body: JSON.stringify(payload) }),
  deletePayrollAdjustment: (id: string) => http<PayrollRunResponse>(`/api/hr/payroll-item-adjustments/${id}`, { method: 'DELETE' }),
  reportsSummary: (params: HrListParams = {}) => http<HrReportsSummaryResponse>(`/api/hr/reports/summary${buildQueryString({ from: params.from, to: params.to, month: params.month })}`),
  importEmployees: (rows: unknown) => http<Record<string, unknown>>('/api/import/employees', { method: 'POST', body: JSON.stringify({ rows }), timeoutMs: CSV_IMPORT_TIMEOUT_MS }),
  listHolidays: async (params: HrListParams = {}) => {
    const response = await http<{ rows: { id: string; name: string; startDate: string; endDate: string }[] }>(`/api/hr/holidays${buildQueryString(params)}`);
    return response;
  },
  saveHoliday: (payload: unknown, id?: string) => http(`/api/hr/holidays${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }),
  deleteHoliday: (id: string) => http(`/api/hr/holidays/${id}`, { method: 'DELETE' }),
  financialStatement: (employeeId: string | number, params: { from?: string; to?: string; month?: string } = {}) =>
    http<any>(`/api/hr/employees/${employeeId}/financial-statement${buildQueryString(params)}`),
  biometricDevices: () =>
    http<{
      devices: Array<{
        id: number;
        deviceName: string;
        serialNumber: string;
        deviceBrand: string;
        deviceModel: string | null;
        ipAddress: string | null;
        port: number;
        commKey: string;
        branchName: string | null;
        status: 'active' | 'inactive';
        lastSyncAt: string | null;
        totalPunchesReceived: number;
        notes: string | null;
      }>;
      employeePins: Array<{
        id: number;
        employeeNo: string;
        biometricPin: string | null;
        displayName: string;
      }>;
      admsPushPath: string;
    }>('/api/hr/biometric/devices'),
  saveBiometricDevice: (payload: Record<string, unknown>, id?: number | null) =>
    http<any>(`/api/hr/biometric/devices${id ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    }),
  deleteBiometricDevice: (id: number) =>
    http<any>(`/api/hr/biometric/devices/${id}`, { method: 'DELETE' }),
  testBiometricDeviceLan: (id: number) =>
    http<{
      reachable: boolean;
      ip: string;
      port: number;
      responseCode?: number;
      requiresCommKey?: boolean;
      latencyMs?: number;
      message: string;
    }>(`/api/hr/biometric/devices/${id}/test-lan`, { method: 'POST' }),
  pullBiometricDeviceLan: (id: number) =>
    http<{
      pulledPunchesCount: number;
      deviceUsersCount: number;
      deviceUsers?: any[];
      imported: number;
      skipped: number;
      message: string;
      errors?: string[];
    }>(`/api/hr/biometric/devices/${id}/pull-lan`, { method: 'POST' }),
  assignEmployeeBiometricPin: (employeeId: number, biometricPin: string | null) =>
    http<any>(`/api/hr/biometric/employee-pin/${employeeId}`, {
      method: 'POST',
      body: JSON.stringify({ biometricPin }),
    }),
  previewBiometricLog: (payload: {
    rawText?: string;
    base64UserDat?: string;
    debounceMinutes?: number;
    columnMapping?: Record<string, unknown>;
  }) =>
    http<any>('/api/hr/biometric/preview-log', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: CSV_IMPORT_TIMEOUT_MS,
    }),
  importBiometricLog: (payload: {
    rawText: string;
    debounceMinutes?: number;
    onlyOpenPayrollMonth?: boolean;
    columnMapping?: Record<string, unknown>;
  }) =>
    http<{
      imported: number;
      skipped: number;
      historicalSkipped: number;
      unmatchedSkipped: number;
      unmatchedPins: string[];
      totalRawPunches: number;
      deduplicatedTaps: number;
      errors: string[];
    }>('/api/hr/biometric/import-log', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeoutMs: CSV_IMPORT_TIMEOUT_MS,
    }),
};



