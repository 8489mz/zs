import { http } from '@/lib/http';

export interface PortalEmployeeUser {
  employeeId: number;
  employeeNo: string;
  name: string;
  phone: string;
  branchId: number | null;
  branchName: string;
  departmentName: string;
  positionName: string;
  hireDate: string | null;
  status: string;
  tenantId: string;
  accountId: string;
}

export interface EmployeeDashboardData {
  profile: {
    id: number;
    employeeNo: string;
    name: string;
    branchName: string;
    departmentName: string;
    positionName: string;
    hireDate: string | null;
    status: string;
    baseSalary: number;
    housingAllowance: number;
    transportAllowance: number;
  };
  todayAttendance: {
    hasCheckedIn: boolean;
    hasCheckedOut: boolean;
    checkInTime: string | null;
    checkOutTime: string | null;
    workHours: number;
    status: string;
  };
  monthSummary: {
    month: string;
    daysPresent: number;
    totalWorkHours: number;
    totalLateMinutes: number;
  };
  leaveBalances: Array<{
    leaveTypeId: number;
    name: string;
    totalDays: number;
    usedDays: number;
    remainingDays: number;
  }>;
  latestPayslip: {
    period: string;
    baseSalary: number;
    allowanceAmount: number;
    deductionAmount: number;
    loanDeduction: number;
    netPay: number;
    status: string;
  } | null;
  totalLoansRemaining: number;
}

export interface AttendanceRecordItem {
  id: number;
  date: string;
  checkInTime: string;
  checkOutTime: string;
  workHours: number;
  overtimeHours: number;
  lateMinutes: number;
  status: string;
  source: string;
  notes: string;
}

export interface EmployeePayslipItem {
  id: number;
  period: string;
  baseSalary: number;
  allowances: number;
  deductions: number;
  loanDeductions: number;
  grossPay: number;
  netPay: number;
  status: string;
  notes: string;
  createdAt: string;
  adjustments: Array<{
    type: 'allowance' | 'deduction';
    label: string;
    amount: number;
  }>;
}

export interface EmployeeLeavesData {
  leaveTypes: Array<{ id: number; name: string; isPaid: boolean }>;
  balances: Array<{
    leaveTypeId: number;
    name: string;
    totalDays: number;
    usedDays: number;
    remainingDays: number;
  }>;
  requests: Array<{
    id: number;
    leaveTypeId: number;
    leaveTypeName: string;
    startDate: string;
    endDate: string;
    daysCount: number;
    status: string;
    reason: string;
    decisionNotes: string;
    createdAt: string;
  }>;
}

export interface LoansAndCustodyData {
  loans: Array<{
    id: number;
    loanNo: string;
    loanType: string;
    principalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    installmentCount: number;
    installmentAmount: number;
    status: string;
    issueDate: string;
    notes: string;
  }>;
  assets: Array<{
    id: number;
    assetType: string;
    assetName: string;
    assetCode: string;
    serialNo: string;
    assignedAt: string;
    status: string;
    notes: string;
  }>;
}

function getAuthHeader(): Record<string, string> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('zs_emp_portal_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const employeePortalApi = {
  async login(payload: { identifier: string; pinCode: string; companyCode?: string; tenantId?: string }): Promise<{
    token: string;
    employee: PortalEmployeeUser;
    mustChangePin: boolean;
  }> {
    const res = await http<{
      token: string;
      employee: PortalEmployeeUser;
      mustChangePin: boolean;
    }>('/api/hr/portal/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res?.token) {
      localStorage.setItem('zs_emp_portal_token', res.token);
      localStorage.setItem('zs_emp_portal_user', JSON.stringify(res.employee));
    }
    return res;
  },

  // INV-PORTAL-DEFAULT-PIN-FORCED-CHANGE: the only portal call allowed while
  // the employee still uses the default PIN. Returns a fresh token; the
  // caller stores it exactly like a login.
  async changePin(payload: { currentPin: string; newPin: string }): Promise<{
    token: string;
    employee: PortalEmployeeUser;
    mustChangePin: boolean;
  }> {
    const res = await http<{
      token: string;
      employee: PortalEmployeeUser;
      mustChangePin: boolean;
    }>('/api/hr/portal/pin/change', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getAuthHeader(),
    });
    if (res?.token) {
      localStorage.setItem('zs_emp_portal_token', res.token);
      localStorage.setItem('zs_emp_portal_user', JSON.stringify(res.employee));
    }
    return res;
  },

  getStoredToken(): string | null {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('zs_emp_portal_token') : null;
  },

  getStoredSession(): { token: string; user: PortalEmployeeUser } | null {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('zs_emp_portal_token') : null;
      const userRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('zs_emp_portal_user') : null;
      if (token && userRaw) return { token, user: JSON.parse(userRaw) };
      return null;
    } catch {
      return null;
    }
  },

  logout() {
    localStorage.removeItem('zs_emp_portal_token');
    localStorage.removeItem('zs_emp_portal_user');
  },

  getCurrentUser(): PortalEmployeeUser | null {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('zs_emp_portal_user') : null;
    return raw ? JSON.parse(raw) : null;
  },

  async getDashboard(): Promise<EmployeeDashboardData> {
    return http<EmployeeDashboardData>('/api/hr/portal/dashboard', {
      headers: getAuthHeader(),
    });
  },

  async getAttendance(month?: string): Promise<AttendanceRecordItem[]> {
    const query = month ? `?month=${encodeURIComponent(month)}` : '';
    return http<AttendanceRecordItem[]>(`/api/hr/portal/attendance${query}`, {
      headers: getAuthHeader(),
    });
  },

  async getPayslips(): Promise<EmployeePayslipItem[]> {
    return http<EmployeePayslipItem[]>('/api/hr/portal/payslips', {
      headers: getAuthHeader(),
    });
  },

  async getLeaves(): Promise<EmployeeLeavesData> {
    return http<EmployeeLeavesData>('/api/hr/portal/leaves', {
      headers: getAuthHeader(),
    });
  },

  async requestLeave(payload: {
    leaveTypeId: number;
    startDate: string;
    endDate: string;
    reason?: string;
  }): Promise<{ success: boolean; message: string }> {
    return http<{ success: boolean; message: string }>('/api/hr/portal/leaves/request', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getAuthHeader(),
    });
  },

  async getLoansAndCustody(): Promise<LoansAndCustodyData> {
    return http<LoansAndCustodyData>('/api/hr/portal/loans-and-custody', {
      headers: getAuthHeader(),
    });
  },

  async requestAdvance(payload: {
    amount: number;
    reason: string;
    repaymentMonths?: number;
  }): Promise<{ success: boolean; message: string }> {
    return http<{ success: boolean; message: string }>('/api/hr/portal/loans/request', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: getAuthHeader(),
    });
  },
};
