export interface HrLeaveType {
  id: string;
  name: string;
  code?: string;
  description?: string;
  isPaid?: boolean;
  isActive?: boolean;
  // INV-LEAVE-BALANCE-DEDUCTION: the settings table shows this flag, and
  // listLeaveTypes already returns it (hr.service.ts), so the type must
  // declare it; the normalizer passes it through via the row spread.
  deductsFromBalance?: boolean;
}

export interface HrLeaveRequest {
  id: string;
  employeeId: string;
  employeeNo?: string;
  employeeName?: string;
  departmentName?: string;
  jobTitleName?: string;
  leaveTypeId?: string;
  leaveTypeName?: string;
  leaveType?: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  status: string;
  reason?: string;
  notes?: string;
  decisionNotes?: string;
  decidedBy?: string;
  decidedAt?: string;
  createdAt?: string;
}
