import type {
  HrAttendanceRecord,
  HrAttendanceException,
  HrEmployee,
  HrEmployeeAsset,
  HrLeaveRequest,
  HrLeaveType,
  HrLoan,
  HrWithdrawalRow,
} from '@/types/domain';
import type { HrApiDateRecord } from './hr-api.types';
import { getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

function apiText(value: unknown): string {
  return String(value || '').trim();
}

function apiPick(row: HrApiDateRecord, keys: string[]): string {
  for (const key of keys) {
    const value = apiText(row[key]);
    if (value) return value;
  }
  return '';
}

function normalizeApiDateOnly(value: unknown): string {
  const text = apiText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function normalizeApiDateTime(value: unknown): string {
  const text = apiText(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})/);
  if (match) return `${match[1]} ${match[2]}:${match[3]}`;
  const dateOnly = normalizeApiDateOnly(text);
  return dateOnly ? `${dateOnly} 00:00` : '';
}

export function normalizeHrLoanRow(row: HrLoan | HrApiDateRecord): HrLoan {
  const source = row as HrApiDateRecord;
  const installmentsRaw = Array.isArray(source.installments) ? source.installments : [];
  const installments = installmentsRaw
    .map((installment) => {
      const item = installment as HrApiDateRecord;
      const amount = Number(item.amount ?? 0);
      const paidAmount = Number(item.paid_amount ?? item.paidAmount ?? 0);
      return {
        id: apiPick(item, ['id']) || '',
        loanId: apiPick(item, ['loanId', 'loan_id']) || apiPick(source, ['id']) || '',
        installmentNumber: Number(item.installment_no ?? item.installmentNumber ?? 0),
        dueDate: normalizeApiDateOnly(apiPick(item, ['dueDate', 'due_date', 'due_date_text'])),
        amount: Number.isFinite(amount) ? amount : 0,
        paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
        // INV-FE3-FRONTEND-BOOK-DIGITS: the unpaid remainder of a loan
        // installment is money; it rounds at the tenant's book digits.
        remainingAmount: roundMoneyValue((Number.isFinite(amount) ? amount : 0) - (Number.isFinite(paidAmount) ? paidAmount : 0), currencyMoneyDigits(getGlobalSystemCurrency())),
        status: apiPick(item, ['status']) || 'pending',
        paidAt: normalizeApiDateTime(apiPick(item, ['paidAt', 'paid_at', 'paid_at_text'])) || '',
        note: apiPick(item, ['note', 'notes']) || '',
      };
    })
    .filter((item) => item.id || item.installmentNumber > 0);
  const dueInstallmentsAmount = Number(source.due_installments_amount ?? source.dueInstallmentsAmount ?? (row as HrLoan).dueInstallmentsAmount ?? 0);
  const dueInstallmentsCount = Number(source.due_installments_count ?? source.dueInstallmentsCount ?? (row as HrLoan).dueInstallmentsCount ?? 0);
  return {
    ...(row as HrLoan),
    issueDate: normalizeApiDateOnly(apiPick(source, ['issueDate', 'issue_date', 'issue_date_text'])) || (row as HrLoan).issueDate || '',
    firstDueDate: normalizeApiDateOnly(apiPick(source, ['firstDueDate', 'first_due_date', 'first_due_date_text'])) || (row as HrLoan).firstDueDate || '',
    salaryDueDate: normalizeApiDateOnly(apiPick(source, ['salaryDueDate', 'salary_due_date', 'salary_due_date_text'])) || (row as HrLoan).salaryDueDate || '',
    createdAt: normalizeApiDateTime(apiPick(source, ['createdAt', 'created_at', 'created_at_text'])) || (row as HrLoan).createdAt || '',
    updatedAt: normalizeApiDateTime(apiPick(source, ['updatedAt', 'updated_at', 'updated_at_text'])) || (row as HrLoan).updatedAt || '',
    approvedAt: normalizeApiDateTime(apiPick(source, ['approvedAt', 'approved_at', 'approved_at_text'])) || (row as HrLoan).approvedAt || '',
    disbursedAt: normalizeApiDateTime(apiPick(source, ['disbursedAt', 'disbursed_at', 'disbursed_at_text'])) || (row as HrLoan).disbursedAt || '',
    paidAt: normalizeApiDateTime(apiPick(source, ['paidAt', 'paid_at', 'paid_at_text'])) || (row as HrLoan).paidAt || '',
    dueInstallmentsAmount: Number.isFinite(dueInstallmentsAmount) ? dueInstallmentsAmount : 0,
    dueInstallmentsCount: Number.isFinite(dueInstallmentsCount) ? dueInstallmentsCount : 0,
    installments: installments.length ? installments : ((row as HrLoan).installments || []),
  };
}

export function normalizeHrWithdrawalRow(row: HrWithdrawalRow | HrApiDateRecord): HrWithdrawalRow {
  const source = row as HrApiDateRecord;
  const movementAt = normalizeApiDateTime(apiPick(source, [
    'movementAt',
    'movement_at',
    'movement_at_text',
    'date',
    'paidAt',
    'paid_at',
    'paid_at_text',
    'disbursedAt',
    'disbursed_at',
    'disbursed_at_text',
    'createdAt',
    'created_at',
    'created_at_text',
    'issueDate',
    'issue_date',
    'issue_date_text',
  ]));
  return {
    ...(row as HrWithdrawalRow),
    movementAt: movementAt || null,
    date: movementAt || null,
    loanId: apiPick(source, ['loanId', 'loan_id', 'referenceId', 'reference_id']) || (row as HrWithdrawalRow).loanId || '',
    referenceId: apiPick(source, ['referenceId', 'reference_id', 'loanId', 'loan_id']) || (row as HrWithdrawalRow).referenceId || '',
    repaymentMethod: apiPick(source, ['repaymentMethod', 'repayment_method']) || (row as HrWithdrawalRow).repaymentMethod || '',
  };
}

export function normalizeHrEmployeeRow(row: HrEmployee | HrApiDateRecord): HrEmployee {
  const source = row as HrApiDateRecord;
  return {
    ...(row as HrEmployee),
    nationalId: apiPick(source, ['nationalId', 'national_id']) || (row as HrEmployee).nationalId || '',
    hasPinCode: Boolean(source.hasPinCode ?? (row as HrEmployee).hasPinCode),
    phone: apiPick(source, ['phone', 'mobile', 'primary_phone']) || (row as HrEmployee).phone || '',
    mobile: apiPick(source, ['mobile', 'phone', 'primary_phone']) || (row as HrEmployee).mobile || '',
    compensationType: apiPick(source, ['compensationType', 'compensation_type']) || (row as HrEmployee).compensationType || 'monthly',
    hourlyRate: source.hourly_rate == null && source.hourlyRate == null
      ? ((row as HrEmployee).hourlyRate ?? null)
      : Number(source.hourly_rate ?? source.hourlyRate ?? 0),
    expectedDailyHours: source.expected_daily_hours == null && source.expectedDailyHours == null
      ? ((row as HrEmployee).expectedDailyHours ?? null)
      : Number(source.expected_daily_hours ?? source.expectedDailyHours ?? 0),
    scheduledCheckInTime: apiPick(source, ['scheduledCheckInTime', 'scheduled_check_in_time']) || (row as HrEmployee).scheduledCheckInTime || '',
    scheduledCheckOutTime: apiPick(source, ['scheduledCheckOutTime', 'scheduled_check_out_time']) || (row as HrEmployee).scheduledCheckOutTime || '',
    graceMinutes: Number(source.grace_minutes ?? source.graceMinutes ?? (row as HrEmployee).graceMinutes ?? 0),
    overtimePolicy: apiPick(source, ['overtimePolicy', 'overtime_policy']) || (row as HrEmployee).overtimePolicy || 'review_only',
    hasSocialInsurance: Boolean(apiPick(source, ['hasSocialInsurance', 'has_social_insurance']) || false),
    hasIncomeTax: Boolean(apiPick(source, ['hasIncomeTax', 'has_income_tax']) || false),
    insuranceSalary: Number(apiPick(source, ['insuranceSalary', 'insurance_salary']) || 0) || undefined,
    endOfServiceDate: normalizeApiDateOnly(apiPick(source, ['endOfServiceDate', 'end_of_service_date'])) || undefined,
    endOfServiceReason: apiPick(source, ['endOfServiceReason', 'end_of_service_reason']) || undefined,
    notes: apiPick(source, ['notes']) || (row as HrEmployee).notes || '',
  };
}

export function normalizeHrAttendanceRow(row: HrAttendanceRecord | HrApiDateRecord): HrAttendanceRecord {
  const source = row as HrApiDateRecord;
  return {
    ...(row as HrAttendanceRecord),
    id: apiPick(source, ['id']) || (row as HrAttendanceRecord).id || '',
    employeeId: apiPick(source, ['employeeId', 'employee_id']) || (row as HrAttendanceRecord).employeeId || '',
    employeeNo: apiPick(source, ['employeeNo', 'employee_no']) || (row as HrAttendanceRecord).employeeNo || '',
    employeeName: apiPick(source, ['employeeName', 'employee_name']) || (row as HrAttendanceRecord).employeeName || '',
    departmentName: apiPick(source, ['departmentName', 'department_name']) || (row as HrAttendanceRecord).departmentName || '',
    jobTitleName: apiPick(source, ['jobTitleName', 'job_title_name']) || (row as HrAttendanceRecord).jobTitleName || '',
    workDate: normalizeApiDateOnly(apiPick(source, ['workDate', 'work_date', 'work_date_text'])) || (row as HrAttendanceRecord).workDate || '',
    status: apiPick(source, ['status']) || (row as HrAttendanceRecord).status || '',
    checkInAt: normalizeApiDateTime(apiPick(source, ['checkInAt', 'check_in_at', 'check_in_at_text'])) || (row as HrAttendanceRecord).checkInAt || '',
    checkOutAt: normalizeApiDateTime(apiPick(source, ['checkOutAt', 'check_out_at', 'check_out_at_text'])) || (row as HrAttendanceRecord).checkOutAt || '',
    source: apiPick(source, ['source']) || (row as HrAttendanceRecord).source || '',
    notes: apiPick(source, ['notes']) || (row as HrAttendanceRecord).notes || '',
    scheduledCheckInTime: apiPick(source, ['scheduledCheckInTime', 'scheduled_check_in_time']) || (row as HrAttendanceRecord).scheduledCheckInTime || '',
    scheduledCheckOutTime: apiPick(source, ['scheduledCheckOutTime', 'scheduled_check_out_time']) || (row as HrAttendanceRecord).scheduledCheckOutTime || '',
    graceMinutes: Number(source.grace_minutes ?? source.graceMinutes ?? (row as HrAttendanceRecord).graceMinutes ?? 0),
    departmentId: apiPick(source, ['departmentId', 'department_id']) || (row as HrAttendanceRecord).departmentId || '',
  };
}

export function normalizeHrAttendanceExceptionRow(row: HrAttendanceException | HrApiDateRecord): HrAttendanceException {
  const source = row as HrApiDateRecord;
  return {
    ...(row as HrAttendanceException),
    id: apiPick(source, ['id']) || (row as HrAttendanceException).id || '',
    employeeId: apiPick(source, ['employeeId', 'employee_id']) || (row as HrAttendanceException).employeeId || '',
    employeeNo: apiPick(source, ['employeeNo', 'employee_no']) || (row as HrAttendanceException).employeeNo || '',
    employeeName: apiPick(source, ['employeeName', 'employee_name']) || (row as HrAttendanceException).employeeName || '',
    workDate: normalizeApiDateOnly(apiPick(source, ['workDate', 'work_date', 'work_date_text'])) || (row as HrAttendanceException).workDate || '',
    exceptionType: apiPick(source, ['exceptionType', 'exception_type']) || (row as HrAttendanceException).exceptionType || '',
    scheduledTime: apiPick(source, ['scheduledTime', 'scheduled_time', 'scheduled_time_text']) || (row as HrAttendanceException).scheduledTime || '',
    actualTime: apiPick(source, ['actualTime', 'actual_time', 'actual_time_text']) || (row as HrAttendanceException).actualTime || '',
    durationMinutes: Number(source.duration_minutes ?? source.durationMinutes ?? (row as HrAttendanceException).durationMinutes ?? 0),
    approvedDurationMinutes: source.approved_duration_minutes == null && source.approvedDurationMinutes == null
      ? ((row as HrAttendanceException).approvedDurationMinutes ?? null)
      : Number(source.approved_duration_minutes ?? source.approvedDurationMinutes ?? 0),
    status: apiPick(source, ['status']) || (row as HrAttendanceException).status || 'pending',
    note: apiPick(source, ['note']) || (row as HrAttendanceException).note || '',
    departmentId: apiPick(source, ['departmentId', 'department_id']) || (row as HrAttendanceException).departmentId || '',
    estimatedAmount: Number(source.estimatedAmount ?? source.estimated_amount ?? (row as HrAttendanceException).estimatedAmount ?? 0),
    hourlyRate: Number(source.hourlyRate ?? source.hourly_rate ?? (row as HrAttendanceException).hourlyRate ?? 0),
    dailyRate: Number(source.dailyRate ?? source.daily_rate ?? (row as HrAttendanceException).dailyRate ?? 0),
    policyDescription: apiPick(source, ['policyDescription', 'policy_description']) || (row as HrAttendanceException).policyDescription || '',
    delayPolicy: apiPick(source, ['delayPolicy', 'delay_policy']) || (row as HrAttendanceException).delayPolicy || '',
  };
}

export function normalizeHrLeaveTypeRow(row: HrLeaveType | HrApiDateRecord): HrLeaveType {
  const source = row as HrApiDateRecord;
  const isPaidValue = source.is_paid ?? source.isPaid ?? (row as HrLeaveType).isPaid;
  const isActiveValue = source.is_active ?? source.isActive ?? (row as HrLeaveType).isActive;
  return {
    ...(row as HrLeaveType),
    id: apiPick(source, ['id']) || (row as HrLeaveType).id || '',
    name: apiPick(source, ['name']) || (row as HrLeaveType).name || '',
    code: apiPick(source, ['code']) || (row as HrLeaveType).code || '',
    description: apiPick(source, ['description']) || (row as HrLeaveType).description || '',
    isPaid: isPaidValue === undefined ? true : Boolean(isPaidValue),
    isActive: isActiveValue === undefined ? true : Boolean(isActiveValue),
  };
}

export function normalizeHrLeaveRequestRow(row: HrLeaveRequest | HrApiDateRecord): HrLeaveRequest {
  const source = row as HrApiDateRecord;
  return {
    ...(row as HrLeaveRequest),
    id: apiPick(source, ['id']) || (row as HrLeaveRequest).id || '',
    employeeId: apiPick(source, ['employeeId', 'employee_id']) || (row as HrLeaveRequest).employeeId || '',
    employeeNo: apiPick(source, ['employeeNo', 'employee_no']) || (row as HrLeaveRequest).employeeNo || '',
    employeeName: apiPick(source, ['employeeName', 'employee_name']) || (row as HrLeaveRequest).employeeName || '',
    departmentName: apiPick(source, ['departmentName', 'department_name']) || (row as HrLeaveRequest).departmentName || '',
    jobTitleName: apiPick(source, ['jobTitleName', 'job_title_name']) || (row as HrLeaveRequest).jobTitleName || '',
    leaveTypeId: apiPick(source, ['leaveTypeId', 'leave_type_id']) || (row as HrLeaveRequest).leaveTypeId || '',
    leaveTypeName: apiPick(source, ['leaveTypeName', 'leave_type_name']) || (row as HrLeaveRequest).leaveTypeName || '',
    leaveType: apiPick(source, ['leaveType', 'leave_type']) || (row as HrLeaveRequest).leaveType || '',
    startDate: normalizeApiDateOnly(apiPick(source, ['startDate', 'start_date', 'start_date_text'])) || (row as HrLeaveRequest).startDate || '',
    endDate: normalizeApiDateOnly(apiPick(source, ['endDate', 'end_date', 'end_date_text'])) || (row as HrLeaveRequest).endDate || '',
    daysCount: Number(source.days_count ?? source.daysCount ?? (row as HrLeaveRequest).daysCount ?? 0),
    status: apiPick(source, ['status']) || (row as HrLeaveRequest).status || '',
    reason: apiPick(source, ['reason']) || (row as HrLeaveRequest).reason || '',
    notes: apiPick(source, ['notes']) || (row as HrLeaveRequest).notes || '',
    decisionNotes: apiPick(source, ['decisionNotes', 'decision_notes']) || (row as HrLeaveRequest).decisionNotes || '',
    decidedBy: apiPick(source, ['decidedBy', 'decided_by']) || (row as HrLeaveRequest).decidedBy || '',
    decidedAt: normalizeApiDateTime(apiPick(source, ['decidedAt', 'decided_at', 'decided_at_text'])) || (row as HrLeaveRequest).decidedAt || '',
    createdAt: normalizeApiDateTime(apiPick(source, ['createdAt', 'created_at', 'created_at_text'])) || (row as HrLeaveRequest).createdAt || '',
  };
}

export function normalizeHrEmployeeAssetRow(row: HrEmployeeAsset | HrApiDateRecord): HrEmployeeAsset {
  const source = row as HrApiDateRecord;
  return {
    ...(row as HrEmployeeAsset),
    id: apiPick(source, ['id']) || (row as HrEmployeeAsset).id || '',
    employeeId: apiPick(source, ['employeeId', 'employee_id']) || (row as HrEmployeeAsset).employeeId || '',
    employeeNo: apiPick(source, ['employeeNo', 'employee_no']) || (row as HrEmployeeAsset).employeeNo || '',
    employeeName: apiPick(source, ['employeeName', 'employee_name']) || (row as HrEmployeeAsset).employeeName || '',
    departmentName: apiPick(source, ['departmentName', 'department_name']) || (row as HrEmployeeAsset).departmentName || '',
    jobTitleName: apiPick(source, ['jobTitleName', 'job_title_name']) || (row as HrEmployeeAsset).jobTitleName || '',
    assetType: apiPick(source, ['assetType', 'asset_type']) || (row as HrEmployeeAsset).assetType || '',
    assetName: apiPick(source, ['assetName', 'asset_name']) || (row as HrEmployeeAsset).assetName || '',
    assetCode: apiPick(source, ['assetCode', 'asset_code']) || (row as HrEmployeeAsset).assetCode || '',
    serialNo: apiPick(source, ['serialNo', 'serial_no']) || (row as HrEmployeeAsset).serialNo || '',
    assignedAt: normalizeApiDateOnly(apiPick(source, ['assignedAt', 'assigned_at', 'assigned_at_text'])) || (row as HrEmployeeAsset).assignedAt || '',
    returnedAt: normalizeApiDateOnly(apiPick(source, ['returnedAt', 'returned_at', 'returned_at_text'])) || (row as HrEmployeeAsset).returnedAt || '',
    status: apiPick(source, ['status']) || (row as HrEmployeeAsset).status || '',
    notes: apiPick(source, ['notes']) || (row as HrEmployeeAsset).notes || '',
    returnNotes: apiPick(source, ['returnNotes', 'return_notes']) || (row as HrEmployeeAsset).returnNotes || '',
    createdAt: normalizeApiDateTime(apiPick(source, ['createdAt', 'created_at', 'created_at_text'])) || (row as HrEmployeeAsset).createdAt || '',
  };
}
