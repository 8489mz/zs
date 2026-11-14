import type {
  HrAttendanceRecord,
  HrAttendanceException,
  HrCompensationPackage,
  HrContact,
  HrContract,
  HrDocument,
  HrEmployee,
  HrEmployeeAsset,
  HrEmployeeAdjustment,
  HrLedgerEntry,
  HrLeaveRequest,
  HrLeaveType,
  HrLoan,
  HrMasterDataRecord,
  HrPayrollRun,
  HrWithdrawalRow,
  HrWithdrawalSummary,
} from '@/types/domain';

export interface MasterResponse {
  rows?: HrMasterDataRecord[];
  summary?: { totalItems?: number };
}

export interface EmployeesResponse {
  employees?: HrEmployee[];
  summary?: { totalItems?: number; activeCount?: number };
}

export interface EmployeeAdjustmentsResponse {
  rows?: HrEmployeeAdjustment[];
}

export interface LoansResponse {
  loans?: HrLoan[];
  summary?: { totalItems?: number; outstandingAmount?: number };
}

export interface WithdrawalsResponse {
  rows?: HrWithdrawalRow[];
  pagination?: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary?: HrWithdrawalSummary;
}

export interface PayrollRunsResponse {
  runs?: HrPayrollRun[];
  summary?: { totalItems?: number };
  serverTime?: string;
  serverTimezone?: string;
}

export interface PayrollRunResponse {
  run?: HrPayrollRun;
}

export interface AttendanceResponse {
  rows?: HrAttendanceRecord[];
  pagination?: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary?: {
    workedMinutes?: number;
    payableMinutes?: number;
    totalItems?: number;
    presentCount?: number;
    absentCount?: number;
    lateCount?: number;
    leaveCount?: number;
    unmarkedCount?: number;
  };
  serverTime?: string;
  serverTimezone?: string;
  workDate?: string;
}

export interface AttendanceExceptionsResponse {
  rows?: HrAttendanceException[];
  summary?: {
    totalItems?: number;
  };
}

export interface LeaveTypesResponse {
  rows?: HrLeaveType[];
  summary?: { totalItems?: number; activeCount?: number };
}

export interface LeaveRequestsResponse {
  requests?: HrLeaveRequest[];
  summary?: {
    totalItems?: number;
    pendingCount?: number;
    approvedCount?: number;
    rejectedCount?: number;
    cancelledCount?: number;
  };
}

export interface EmployeeAssetsResponse {
  assets?: HrEmployeeAsset[];
  summary?: {
    totalItems?: number;
    assignedCount?: number;
    returnedCount?: number;
    lostCount?: number;
    damagedCount?: number;
  };
}

export interface HrReportsSummaryResponse {
  period?: { from?: string; to?: string; month?: string };
  summary?: {
    employeeCount?: number;
    activeEmployeeCount?: number;
    attendance?: {
      presentCount?: number;
      absentCount?: number;
      lateCount?: number;
      halfDayCount?: number;
      leaveCount?: number;
    };
    leaves?: {
      pendingCount?: number;
      approvedCount?: number;
      rejectedCount?: number;
      cancelledCount?: number;
      unpaidLeaveDays?: number;
    };
    loans?: {
      openLoanCount?: number;
      outstandingAmount?: number;
    };
    assets?: {
      assignedCount?: number;
      returnedCount?: number;
      lostCount?: number;
      damagedCount?: number;
    };
    payroll?: {
      runCount?: number;
      approvedRunCount?: number;
      totalNetPay?: number;
    };
  };
}

export interface RowsResponse<T> {
  rows?: T[];
}

export interface ProfileResponse {
  employee?: HrEmployee;
  contacts?: HrContact[];
  documents?: HrDocument[];
  contracts?: HrContract[];
  compensation?: HrCompensationPackage[];
  loans?: HrLoan[];
  ledger?: HrLedgerEntry[];
}

export type HrApiDateRecord = Record<string, unknown>;
