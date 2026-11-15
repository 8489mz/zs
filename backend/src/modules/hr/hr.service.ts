import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CashDrawerService } from '../cash-drawer/cash-drawer.service';
import { Kysely, sql } from '../../database/kysely';
import { AppError } from '../../common/errors/app-error';
import { paginateRows } from '../../common/utils/pagination';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import {
  BulkSaveAttendanceDto,
  CreateLeaveRequestDto,
  CreatePayrollAdjustmentDto,
  CreatePayrollRunDto,
  DecideAttendanceExceptionDto,
  DecideLeaveRequestDto,
  EmployeeAssetActionDto,
  LoanRepaymentDto,
  UpsertEmployeeAssetDto,
  UpsertLeaveTypeDto,
  UpsertAttendanceRecordDto,
  BulkImportAttendanceDto,
  UpsertPayrollItemDto,
  UpsertCompensationPackageDto,
  UpsertEmployeeContactDto,
  CreateEmployeeAdjustmentDto,
  UpsertEmployeeDocumentDto,
  UpsertEmployeeDto,
  UpsertEmployeeLoanDto,
  UpsertEmploymentContractDto,
  UpsertHrMasterDataDto,
  PayPayrollRunDto,
  PayPayrollItemDto,
  UpsertHolidayDto,
  EndOfServiceDto,
  UpdateEmployeeCredentialsDto,
  UpdateEmployeeStatusDto,
  GenerateWpsDto,
} from './dto/hr.dto';
import { HrTreasuryAdapter } from './hr-treasury.adapter';
import { HrPayrollPoliciesService } from './services/hr-payroll-policies.service';
import { HrEmployeeRecordsService } from './services/hr-employee-records.service';
import { HrLeaveService } from './services/hr-leave.service';
import { HrLoansService } from './services/hr-loans.service';
import { HrReportsService } from './services/hr-reports.service';
import { HrAttendanceExceptionsService } from './services/hr-attendance-exceptions.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { getTenantTimezone, todayTenantDate, formatTimeInTimezone } from '../../common/utils/tenant-timezone.util';
import { firstDayOfTenantMonth } from '../../common/utils/client-date-bounds.util';
import {
  AttendancePunchError,
  resolveAttendancePunch,
  startsNewSession,
  type AttendancePunchResolution,
} from './attendance-punch.engine';
import { allocateLoanDeduction, calculatePayrollLoanDueTotal, requireLoanMoney } from './payroll-loan-allocation.engine';
import { MoneyDigits, currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';
import { calculateOvertime, calculateHourlyOvertimePremium, calculateProgressiveDelayDeduction } from './engines/payroll-calculation.engine';
import { calculateHrPayrollRunLine, requirePayrollMonetaryCurrency, requireStoredHrMoney, requireBankPayrollPaymentReference, canReincludeAutoExcludedPayrollItem, AUTO_PAYROLL_EXCLUSION_NOTE, MANUAL_PAYROLL_EXCLUSION_NOTE } from './engines/hr-payroll-run.engine';
import { validateHrStatutoryPolicy, requireHrPayrollJurisdictionCurrency,   type HrStatutoryPolicy } from './engines/hr-statutory-policy.engine';
import { summarizeHourlyAttendance, calculateEffectiveContractPay, calculateEffectiveCompensationPay, calculateHistoricalOvertimePay, calculateDatedPayrollAdjustment, payrollCalendarMonthFraction, calculatePayableMinutes, resolveExpectedDailyMinutes, daysInCalendarMonth, type EffectiveSalaryContract, type EffectiveCompensationPackage, type ApprovedOvertimeDay } from './engines/hourly-attendance-pay.engine';
import { calculateEmployeeWithdrawalBalance, resolveDirectAdvanceCashCap, type EmployeeWithdrawalBalanceResult } from './engines/employee-withdrawal-balance.engine';
import { createPasswordRecord, verifyPassword } from '../../core/auth/utils/password-hasher';
import { assertSecurePasscode } from '../../core/auth/utils/password-policy';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';

import {
  type MasterKind,
  masterConfig,
  toId,
  clean,
  normalizeEmployeeNo,
  isUniqueViolation,
  normalizeDateOnly,
  nextMonthDate,
  addMonths,
  normalizePayrollMonth,
  monthRange,
  money,
  tenantBookDigits,
  tenantCurrencyCode,
  combineNotes,
  canViewSalary,
  hasHrPermission,
  type AttendanceExceptionStatus,
  type AttendanceExceptionType,
  type CompensationType,
  type OvertimePolicy,
  normalizeAttendanceStatus,
  normalizeAttendanceSource,
  buildAttendanceDayAuditKey,
  normalizeTimeOnly,
  timeToMinutes,
  inclusiveDaysBetween,
} from './hr-helpers';

@Injectable()
export class HrService {
  private readonly payrollPoliciesService: HrPayrollPoliciesService;

  async getPayrollPoliciesConfig(auth: any) {
    return this.payrollPoliciesService.getPayrollPoliciesConfig(auth);
  }

  async getPayrollPolicies(db: any, tenantId: string) {
    return this.payrollPoliciesService.getPayrollPolicies(db, tenantId);
  }

  async updatePayrollPolicies(auth: any, policies: any) {
    return this.payrollPoliciesService.updatePayrollPolicies(auth, policies);
  }

  private readonly employeeRecordsService: HrEmployeeRecordsService;

  private readonly leaveService: HrLeaveService;

  private readonly loansService: HrLoansService;

  private readonly reportsService: HrReportsService;

  private readonly attendanceExceptionsService: HrAttendanceExceptionsService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly treasury: HrTreasuryAdapter,
    private readonly accountingPosting: AccountingPostingService,
    @Optional() private readonly cashDrawer?: CashDrawerService,
  ) {
    this.payrollPoliciesService = new HrPayrollPoliciesService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
    });
    this.employeeRecordsService = new HrEmployeeRecordsService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      assertEmployeeBelongsToTenant: this.assertEmployeeBelongsToTenant.bind(this),
    });
    this.leaveService = new HrLeaveService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      tenantPredicate: this.tenantPredicate.bind(this),
    });
    this.loansService = new HrLoansService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      treasury: this.treasury,
      accountingPosting: this.accountingPosting,
      scope: this.scope.bind(this),
    });
    this.reportsService = new HrReportsService({
      db: this.db,
      assertEmployeeBelongsToTenant: this.assertEmployeeBelongsToTenant.bind(this),
    });
    this.attendanceExceptionsService = new HrAttendanceExceptionsService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      getPayrollPolicies: this.getPayrollPolicies.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
    });
  }

  private scope(auth: AuthContext) {
    return requireTenantScope(auth);
  }

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const { tenantId } = this.scope(auth);
    return alias ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}` : sql<boolean>`tenant_id = ${tenantId}`;
  }

  private tenantFields(auth: AuthContext) {
    const { tenantId, accountId } = this.scope(auth);
    return { tenant_id: tenantId, account_id: accountId };
  }

  private async assertEmployeeBelongsToTenant(employeeId: number, auth: AuthContext): Promise<void> {
    const { tenantId } = this.scope(auth);
    const row = await sql<{ id: number }>`
      SELECT id FROM hr_employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} LIMIT 1
    `.execute(this.db);
    if (!row.rows.length) {
      throw new AppError('الموظف غير موجود أو لا يتبع المنشأة الحالية', 'HR_EMPLOYEE_NOT_FOUND', 404);
    }
  }

  private async nextAvailableEmployeeNo(db: Kysely<Database>, auth: AuthContext): Promise<string> {
    const { tenantId } = this.scope(auth);
    const result = await sql<{ employee_no: string }>`
      SELECT employee_no
      FROM hr_employees
      WHERE employee_no ~ '^[0-9]+$'
        AND tenant_id = ${tenantId}
      ORDER BY LENGTH(employee_no), employee_no
    `.execute(db);
    const used = new Set<number>();
    for (const row of result.rows) {
      const numeric = Number(row.employee_no);
      if (Number.isSafeInteger(numeric) && numeric > 0) used.add(numeric);
    }
    let next = 1;
    while (used.has(next)) next += 1;
    return String(next).padStart(3, '0');
  }

  private async ensureEmployeeNoAvailable(db: Kysely<Database>, employeeNo: string, excludeEmployeeId: number | null, auth: AuthContext): Promise<void> {
    const { tenantId } = this.scope(auth);
    if (!employeeNo) return;
    const duplicate = await sql<{ id: number }>`
      SELECT id
      FROM hr_employees
      WHERE employee_no = ${employeeNo}
        AND tenant_id = ${tenantId}
        AND (${excludeEmployeeId}::BIGINT IS NULL OR id <> ${excludeEmployeeId})
      LIMIT 1
    `.execute(db);
    if (duplicate.rows.length > 0) {
      throw new AppError('رقم الموظف مستخدم بالفعل', 'HR_EMPLOYEE_NO_EXISTS', 409);
    }
  }

  async listMasterData(kind: MasterKind, query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.listMasterData(kind, query, auth);
  }

  async upsertMasterData(kind: MasterKind, id: number | null, payload: UpsertHrMasterDataDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.upsertMasterData(kind, id, payload, auth);
  }

  async deactivateMasterData(kind: MasterKind, id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.deactivateMasterData(kind, id, auth);
  }

  async listHolidays(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.listHolidays(query, auth);
  }

  async upsertHoliday(id: number | null, payload: any, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.upsertHoliday(id, payload, auth);
  }

  async deleteHoliday(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.deleteHoliday(id, auth);
  }

  async listEmployees(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const result = await sql<Record<string, unknown>>`
      SELECT e.*, d.name AS department_name, j.name AS job_title_name, p.name AS position_name, b.name AS branch_name, l.name AS location_name, u.username AS username
      , to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date_text
      , (SELECT c.value FROM hr_employee_contacts c WHERE c.employee_id = e.id AND c.tenant_id = e.tenant_id ORDER BY c.is_primary DESC, c.id ASC LIMIT 1) AS primary_phone
      FROM hr_employees e
      LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
      LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id
      LEFT JOIN hr_positions p ON p.id = e.position_id AND p.tenant_id = e.tenant_id
      LEFT JOIN branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id
      LEFT JOIN stock_locations l ON l.id = e.location_id AND l.tenant_id = e.tenant_id
      LEFT JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
      WHERE ${this.tenantPredicate(auth, 'e')}
      ORDER BY e.id DESC
    `.execute(this.db);
    const search = clean(query.search).toLowerCase();
    // INV-LEAVE-BALANCE-NOT-DEDUCTING: one batch reconcile for the
    // listed employees, so the list shows the same used days as the
    // profile (approvals posted before the forward deduction existed
    // never moved the stored counter).
    const reconciledUsedByEmployee = await this.deductibleApprovedLeaveDaysByEmployee(
      result.rows.map((row) => Number(row.id)),
      String(auth.tenantId || ''),
    );
    let rows = result.rows.map((row) => ({
      id: String(row.id),
      employeeNo: clean(row.employee_no),
      nationalId: clean(row.national_id),
      // الرمز نفسه لا يُعاد أبداً — حالة وجوده فقط (البند O20)
      hasPinCode: Boolean(row.pin_hash),
      firstName: clean(row.first_name),
      lastName: clean(row.last_name),
      displayName: clean(row.display_name) || `${clean(row.first_name)} ${clean(row.last_name)}`.trim(),
      status: clean(row.status) || 'active',
      phone: clean(row.primary_phone),
      mobile: clean(row.primary_phone),
      userId: row.user_id ? String(row.user_id) : '',
      username: clean(row.username),
      departmentId: row.department_id ? String(row.department_id) : '',
      departmentName: clean(row.department_name),
      jobTitleId: row.job_title_id ? String(row.job_title_id) : '',
      jobTitleName: clean(row.job_title_name),
      positionId: row.position_id ? String(row.position_id) : '',
      positionName: clean(row.position_name),
      branchId: row.branch_id ? String(row.branch_id) : '',
      branchName: clean(row.branch_name),
      locationId: row.location_id ? String(row.location_id) : '',
      locationName: clean(row.location_name),
      hireDate: clean(row.hire_date_text),
      compensationType: clean(row.compensation_type) || 'monthly',
      payFrequency: clean(row.pay_frequency) || 'monthly',
      hourlyRate: row.hourly_rate != null ? Number(row.hourly_rate) : null,
      expectedDailyHours: row.expected_daily_hours != null ? Number(row.expected_daily_hours) : null,
      scheduledCheckInTime: clean(row.scheduled_check_in_time),
      scheduledCheckOutTime: clean(row.scheduled_check_out_time),
      graceMinutes: Number(row.grace_minutes || 0),
      overtimePolicy: clean(row.overtime_policy) || 'review_only',
      attendancePolicy: clean(row.attendance_policy) || 'strict',
      commissionType: clean(row.commission_type) || 'inherit',
      commissionValue: row.commission_value == null ? null : Number(row.commission_value),
      commissionTarget: row.commission_target == null ? null : Number(row.commission_target),
      delayPolicy: clean(row.delay_policy) || 'inherit',
      hasSocialInsurance: row.has_social_insurance === true,
      insuranceSalary: row.insurance_salary == null ? null : Number(row.insurance_salary),
      hasIncomeTax: row.has_income_tax === true,
      bankName: clean(row.bank_name),
      bankAccountNumber: clean(row.bank_account_number),
      iban: clean(row.iban),
      bankSwiftCode: clean(row.bank_swift_code),
      annualLeaveBalance: row.annual_leave_balance == null ? 21 : Number(row.annual_leave_balance),
      // INV-LEAVE-BALANCE-NOT-DEDUCTING: reconciled against the
      // approved requests — never the stored counter raw.
      usedAnnualLeaves: Math.max(
        row.used_annual_leaves == null ? 0 : Number(row.used_annual_leaves),
        reconciledUsedByEmployee.get(Number(row.id)) || 0,
      ),
      notes: clean(row.notes),
    }));
    if (search) {
      rows = rows.filter((row) => [row.employeeNo, row.displayName, row.username, row.departmentName, row.jobTitleName, row.phone].some((value) => value && value.toLowerCase().includes(search)));
    }
    const paged = paginateRows(rows, query, { defaultSize: 25, maxSize: 5000 });
    return { employees: paged.rows, pagination: paged.pagination, summary: { totalItems: rows.length, activeCount: rows.filter((row) => row.status === 'active').length } };
  }

  async getEmployeeProfile(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const result = await sql<Record<string, unknown>>`
      SELECT e.*, d.name AS department_name, j.name AS job_title_name, p.name AS position_name, b.name AS branch_name, l.name AS location_name, u.username AS username
      , to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date_text
      , (SELECT c.value FROM hr_employee_contacts c WHERE c.employee_id = e.id AND c.tenant_id = e.tenant_id ORDER BY c.is_primary DESC, c.id ASC LIMIT 1) AS primary_phone
      FROM hr_employees e
      LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
      LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id
      LEFT JOIN hr_positions p ON p.id = e.position_id AND p.tenant_id = e.tenant_id
      LEFT JOIN branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id
      LEFT JOIN stock_locations l ON l.id = e.location_id AND l.tenant_id = e.tenant_id
      LEFT JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
      WHERE e.id = ${id} AND ${this.tenantPredicate(auth, 'e')}
    `.execute(this.db);

    if (result.rows.length === 0) throw new AppError('Employee not found', 'HR_EMPLOYEE_NOT_FOUND', 404);

    const row = result.rows[0];
    // INV-LEAVE-BALANCE-NOT-DEDUCTING: reconciled against the
    // approved requests — never the stored counter raw.
    const usedAnnualLeaves = await this.reconciledUsedAnnualLeaves(
      this.db,
      id,
      String(auth.tenantId || ''),
      Number(row.used_annual_leaves || 0),
    );
    const employee = {
      id: String(row.id),
      employeeNo: clean(row.employee_no),
      nationalId: clean(row.national_id),
      // الرمز نفسه لا يُعاد أبداً — حالة وجوده فقط (البند O20)
      hasPinCode: Boolean(row.pin_hash),
      firstName: clean(row.first_name),
      lastName: clean(row.last_name),
      displayName: clean(row.display_name) || `${clean(row.first_name)} ${clean(row.last_name)}`.trim(),
      status: clean(row.status) || 'active',
      phone: clean(row.primary_phone),
      mobile: clean(row.primary_phone),
      userId: row.user_id ? String(row.user_id) : '',
      username: clean(row.username),
      departmentId: row.department_id ? String(row.department_id) : '',
      departmentName: clean(row.department_name),
      jobTitleId: row.job_title_id ? String(row.job_title_id) : '',
      jobTitleName: clean(row.job_title_name),
      positionId: row.position_id ? String(row.position_id) : '',
      positionName: clean(row.position_name),
      branchId: row.branch_id ? String(row.branch_id) : '',
      branchName: clean(row.branch_name),
      locationId: row.location_id ? String(row.location_id) : '',
      locationName: clean(row.location_name),
      hireDate: clean(row.hire_date_text),
      compensationType: clean(row.compensation_type) || 'monthly',
      payFrequency: clean(row.pay_frequency) || 'monthly',
      hourlyRate: row.hourly_rate != null ? Number(row.hourly_rate) : null,
      expectedDailyHours: row.expected_daily_hours != null ? Number(row.expected_daily_hours) : null,
      scheduledCheckInTime: clean(row.scheduled_check_in_time),
      scheduledCheckOutTime: clean(row.scheduled_check_out_time),
      graceMinutes: Number(row.grace_minutes || 0),
      overtimePolicy: clean(row.overtime_policy) || 'review_only',
      attendancePolicy: clean(row.attendance_policy) || 'strict',
      commissionType: clean(row.commission_type) || 'inherit',
      commissionValue: row.commission_value == null ? null : Number(row.commission_value),
      commissionTarget: row.commission_target == null ? null : Number(row.commission_target),
      delayPolicy: clean(row.delay_policy) || 'inherit',
      hasSocialInsurance: row.has_social_insurance === true,
      insuranceSalary: row.insurance_salary == null ? null : Number(row.insurance_salary),
      hasIncomeTax: row.has_income_tax === true,
      bankName: clean(row.bank_name),
      bankAccountNumber: clean(row.bank_account_number),
      iban: clean(row.iban),
      bankSwiftCode: clean(row.bank_swift_code),
      annualLeaveBalance: row.annual_leave_balance == null ? 21 : Number(row.annual_leave_balance),
      usedAnnualLeaves,
      notes: clean(row.notes),
    };

    const [contacts, documents] = await Promise.all([
      this.listContacts(id, auth),
      this.listDocuments(id, auth),
    ]);

    const response: Record<string, unknown> = {
      employee,
      contacts: contacts.rows,
      documents: documents.rows,
    };

    if (hasHrPermission(auth, 'hrContracts')) {
      const [contracts, compensation] = await Promise.all([
        this.listContracts(id, auth),
        this.listCompensation(id, auth),
      ]);
      response.contracts = contracts.rows;
      response.compensation = compensation.rows;
    }

    if (hasHrPermission(auth, 'hrLoans')) {
      const [loans, ledger] = await Promise.all([
        this.listLoans({ employeeId: id }, auth),
        this.listLedger(id, auth),
      ]);
      response.loans = loans.loans;
      response.ledger = ledger.rows;
    }

    return response;
  }

  
  async getEndOfServicePreview(id: number, dateStr: string | undefined, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    await this.assertEmployeeBelongsToTenant(id, auth);
    // Retired: the previous endpoint fabricated a universal Egyptian
    // termination entitlement and guessed accrued leave. Never display a
    // financially binding settlement amount from this obsolete calculation.
    throw new AppError(
      'تم إيقاف الحسبة القديمة غير القانونية. استخدم شاشة المخالصات لمراجعة نظام العمل والمستحقات والمرتب المتبقي.',
      'HR_LEGACY_EOS_PREVIEW_DISABLED',
      409,
    );
  }

  async endOfService(id: number, payload: EndOfServiceDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const terminationDate = normalizeDateOnly(payload.endOfServiceDate);
    if (!terminationDate) {
      throw new AppError('تاريخ نهاية الخدمة غير صحيح', 'HR_EOS_END_DATE_REQUIRED', 400);
    }
    // This endpoint ends employment IMMEDIATELY, rather than scheduling a
    // future notice period. Future dates would exclude earned future wages.
    const companyToday = todayTenantDate(await getTenantTimezone(this.db, tenantId));
    if (terminationDate > companyToday) {
      throw new AppError('لا يمكن إنهاء خدمة الموظف فعليًا بتاريخ مستقبلي؛ استخدم جدولة منفصلة', 'HR_EOS_FUTURE_TERMINATION_INVALID', 400);
    }
    await this.tx.runInTransaction(this.db, async trx => {
      // Lock in the same order as payroll approval and statutory settlement.
      // A concurrent approval must not use an employee state that termination
      // rewrites while its financial snapshot is being accrued.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const employee = await sql<{ id: number; status: string; hire_date: string | null }>`
        SELECT id, status, to_char(hire_date, 'YYYY-MM-DD') AS hire_date
        FROM hr_employees WHERE id = ${id} AND tenant_id = ${tenantId} FOR UPDATE
      `.execute(trx);
      if (!employee.rows.length) throw new NotFoundException('Employee not found');
      if (employee.rows[0].status === 'terminated') {
        throw new AppError('انتهت خدمة هذا الموظف بالفعل', 'HR_EOS_ALREADY_TERMINATED', 400);
      }
      const hireDate = employee.rows[0].hire_date;
      if (hireDate && terminationDate < hireDate) {
        throw new AppError('تاريخ إنهاء الخدمة يسبق تاريخ التعيين', 'HR_EOS_BEFORE_HIRE', 400);
      }
      // A salary already accrued through a later day must NEVER be silently
      // invalidated by backdating termination or truncating its salary contract.
      const postedSalary = await sql<{ id: number }>`
        SELECT r.id
        FROM hr_payroll_runs r
        JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id
        WHERE r.tenant_id = ${tenantId} AND i.employee_id = ${id}
          AND r.status IN ('approved', 'paid') AND i.status = 'approved'
          AND r.end_date > ${terminationDate}::date
        LIMIT 1
      `.execute(trx);
      if (postedSalary.rows.length) {
        throw new AppError(
          'لا يمكن إنهاء خدمة الموظف بأثر رجعي داخل فترة مرتبات معتمدة؛ يلزم تسوية مالية منفصلة',
          'HR_EOS_APPROVED_PAYROLL_CONFLICT', 409,
        );
      }
      const unpaidLoans = await sql<{ id: number }>`
        SELECT id FROM hr_employee_loans
        WHERE employee_id = ${id} AND tenant_id = ${tenantId}
          AND status IN ('disbursed', 'paid', 'partially_repaid')
          AND remaining_amount > 0 LIMIT 1
      `.execute(trx);
      const openAssets = await sql<{ id: number }>`
        SELECT id FROM hr_employee_assets
        WHERE employee_id = ${id} AND tenant_id = ${tenantId}
          AND status NOT IN ('returned', 'cancelled') LIMIT 1
      `.execute(trx);
      const unsettled = await sql<{ id: number }>`
        SELECT id FROM hr_end_of_service_settlements
        WHERE employee_id = ${id} AND tenant_id = ${tenantId} AND status <> 'posted'
        LIMIT 1
      `.execute(trx);
      if (unpaidLoans.rows.length || openAssets.rows.length || unsettled.rows.length) {
        throw new AppError('يجب تسوية السلف والعهد والمخالصات المفتوحة قبل الإنهاء المباشر', 'HR_EOS_CLEARANCE_REQUIRED', 400);
      }
      await sql`
        UPDATE hr_employees
        SET status = 'terminated', end_of_service_date = ${terminationDate}::date,
            end_of_service_reason = ${payload.endOfServiceReason || null},
            updated_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `.execute(trx);
      // Keep historical contract end dates unchanged. Close live contracts
      // only up to service termination; never make end_date < start_date.
      await sql`
        UPDATE hr_employment_contracts
        SET status = 'ended',
            end_date = CASE
              WHEN start_date <= ${terminationDate}::date
               AND (end_date IS NULL OR end_date > ${terminationDate}::date)
              THEN ${terminationDate}::date ELSE end_date END,
            updated_by = ${auth.userId}, updated_at = NOW()
        WHERE employee_id = ${id} AND status = 'active' AND tenant_id = ${tenantId}
      `.execute(trx);
    });
    await this.audit.log('End of Service', `Ended service for employee #${id} on ${terminationDate}`, auth);
    return { success: true, openAssets: 0, unpaidLoans: 0 };
  }

  /** Shared, atomic HR onboarding path for recruitment transactions. */
  async createEmployeeFromRecruitment(
    trx: Kysely<Database>,
    input: { firstName: string; lastName: string; phone: string; email?: string; branchId?: number; salary: number },
    auth: AuthContext,
  ): Promise<number> {
    const { tenantId, accountId } = requireTenantScope(auth);
    const salary = Number(input.salary);
    if (!Number.isFinite(salary) || salary <= 0) {
      throw new AppError('يجب تحديد راتب أساسي صحيح أكبر من صفر قبل تعيين المرشح', 'HR_RECRUITMENT_SALARY_REQUIRED', 400);
    }
    try { requireStoredHrMoney(salary, 2); } catch {
      throw new AppError('راتب المرشح يجب أن يكون بدقة منزلتين دون تقريب', 'HR_RECRUITMENT_SALARY_PRECISION_INVALID', 400);
    }
    const firstName = clean(input.firstName);
    const lastName = clean(input.lastName);
    if (!firstName) throw new AppError('اسم الموظف مطلوب', 'HR_EMPLOYEE_NAME_REQUIRED', 400);
    const branchId = toId(input.branchId);
    if (branchId) {
      const branches = await sql<{ id: number }>`SELECT id FROM branches WHERE id = ${branchId} AND tenant_id = ${tenantId} LIMIT 1`.execute(trx);
      if (!branches.rows.length) throw new AppError('فرع الموظف غير تابع للمنشأة', 'HR_BRANCH_INVALID', 400);
    }
    // Payroll approval reads the active employee roster under the same lock.
    // Acquire payroll before employee-number allocation (global lock ordering).
    await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
    await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-employee:' + tenantId}))`.execute(trx);
    const employeeNo = await this.nextAvailableEmployeeNo(trx, auth);
    const timezone = await getTenantTimezone(trx, tenantId);
    const hireDate = todayTenantDate(timezone);
    const result = await sql<{ id: number }>`
      INSERT INTO hr_employees (
        tenant_id, account_id, employee_no, first_name, last_name, display_name,
        status, branch_id, hire_date, compensation_type, pay_frequency, created_by, updated_by
      ) VALUES (
        ${tenantId}, ${accountId}, ${employeeNo}, ${firstName}, ${lastName}, ${(firstName+' '+lastName).trim()},
        'active', ${branchId}, ${hireDate}::date, 'monthly', 'monthly', ${auth.userId}, ${auth.userId}
      ) RETURNING id
    `.execute(trx);
    const employeeId = Number(result.rows[0]?.id);
    if (!employeeId) throw new AppError('تعذر إنشاء الموظف', 'HR_RECRUITMENT_CREATE_FAILED', 500);
    const mobile = clean(input.phone);
    if (mobile) {
      await sql`
        INSERT INTO hr_employee_contacts (
          tenant_id, account_id, employee_id, contact_type, value, label, is_primary, notes, created_by, updated_by
        ) VALUES (
          ${tenantId}, ${accountId}, ${employeeId}, 'mobile', ${mobile}, 'الموبايل الأساسي', TRUE, '', ${auth.userId}, ${auth.userId}
        )
      `.execute(trx);
    }
    const email = clean(input.email);
    if (email) {
      await sql`
        INSERT INTO hr_employee_contacts (
          tenant_id, account_id, employee_id, contact_type, value, label, is_primary, notes, created_by, updated_by
        ) VALUES (
          ${tenantId}, ${accountId}, ${employeeId}, 'email', ${email}, 'البريد الإلكتروني', FALSE, '', ${auth.userId}, ${auth.userId}
        )
      `.execute(trx);
    }
    const configuredCurrency = await sql<{ value: string }>`
      SELECT value FROM settings WHERE tenant_id = ${tenantId} AND key = 'currency' LIMIT 1
    `.execute(trx);
    const rawCurrency = clean(configuredCurrency.rows[0]?.value).replace(/^"|"$/g, '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(rawCurrency)) {
      throw new AppError('حدد عملة المنشأة في الإعدادات قبل إنشاء العقد', 'HR_RECRUITMENT_CURRENCY_REQUIRED', 400);
    }
    const currency = rawCurrency;
    const tempNo = `CON-TMP-${employeeId}`;
    const contract = await sql<{ id: number }>`
      INSERT INTO hr_employment_contracts (
        tenant_id, account_id, employee_id, contract_no, contract_type, status,
        start_date, base_salary, currency, notes, created_by, updated_by
      ) VALUES (
        ${tenantId}, ${accountId}, ${employeeId}, ${tempNo}, 'standard', 'active',
        ${hireDate}::date, ${salary}, ${currency}, '', ${auth.userId}, ${auth.userId}
      ) RETURNING id
    `.execute(trx);
    const contractId = Number(contract.rows[0]?.id);
    if (!contractId) throw new AppError('تعذر إنشاء عقد الموظف', 'HR_RECRUITMENT_CONTRACT_FAILED', 500);
    await sql`
      UPDATE hr_employment_contracts
      SET contract_no = ${formatDailyDocumentNumber('CON', contractId, new Date(), 4, timezone)}
      WHERE id = ${contractId} AND employee_id = ${employeeId}
        AND contract_no = ${tempNo} AND tenant_id = ${tenantId}
    `.execute(trx);
    await this.invalidateReviewedPayrollForNewHire(trx, tenantId, hireDate, 'monthly');
    return employeeId;
  }

  async upsertEmployee(id: number | null, payload: UpsertEmployeeDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const firstName = clean(payload.firstName);
    const lastName = clean(payload.lastName);
    const displayName = `${firstName} ${lastName}`.trim();
    const rawEmployeeNo = clean(payload.employeeNo);
    const employeeNo = normalizeEmployeeNo(payload.employeeNo);
    const nationalId = clean(payload.nationalId);
    const hireDate = normalizeDateOnly(payload.hireDate);
    const compensationType: CompensationType = clean(payload.compensationType) === 'hourly' ? 'hourly' : 'monthly';
    const payFrequency = clean(payload.payFrequency) || 'monthly';
    const overtimePolicy: OvertimePolicy = clean(payload.overtimePolicy) === 'disabled'
      ? 'disabled'
      : clean(payload.overtimePolicy) === 'auto_approved'
        ? 'auto_approved'
        : 'review_only';
    const hourlyRate = payload.hourlyRate == null ? null : Number(payload.hourlyRate);
    const expectedDailyHours = payload.expectedDailyHours == null ? null : Number(payload.expectedDailyHours);
    const scheduledCheckInTime = normalizeTimeOnly(payload.scheduledCheckInTime);
    const scheduledCheckOutTime = normalizeTimeOnly(payload.scheduledCheckOutTime);
    const graceMinutes = Math.max(0, Math.floor(Number(payload.graceMinutes || 0)));
    const attendancePolicy = clean(payload.attendancePolicy) === 'flexible' ? 'flexible' : 'strict';
    const commissionValue = payload.commissionValue == null ? null : Number(payload.commissionValue);
    const commissionTarget = payload.commissionTarget == null ? null : Number(payload.commissionTarget);
    const insuranceSalary = payload.insuranceSalary == null ? null : Number(payload.insuranceSalary);

    if (!['daily', 'weekly', 'biweekly', 'monthly'].includes(payFrequency)) {
      throw new AppError('دورية صرف المرتب غير صحيحة', 'HR_EMPLOYEE_PAY_FREQUENCY_INVALID', 400);
    }
    const bookDigits = await tenantBookDigits(this.db, auth.tenantId || '');
    if (compensationType === 'hourly') {
      if (hourlyRate == null || !Number.isFinite(hourlyRate) || hourlyRate <= 0
        || expectedDailyHours == null || !Number.isFinite(expectedDailyHours)
        || expectedDailyHours <= 0 || expectedDailyHours > 24) {
        throw new AppError('موظف الساعة يحتاج أجر ساعة موجبًا وساعات عمل يومية بين صفر و24 (غير شاملة الصفر)', 'HR_HOURLY_WAGE_SCHEDULE_INVALID', 400);
      }
      try { requireStoredHrMoney(hourlyRate, bookDigits); } catch {
        throw new AppError('أجر الساعة يجب أن يكون بدقة دفاتر المنشأة دون تقريب', 'HR_HOURLY_MONEY_PRECISION_INVALID', 400);
      }
    }
    if (![commissionValue, commissionTarget, insuranceSalary].every(x => x == null || (Number.isFinite(x) && x >= 0))) {
      throw new AppError('مبلغ العمولة أو الهدف أو الأجر التأميني غير صحيح', 'HR_EMPLOYEE_PAY_FIELDS_INVALID', 400);
    }
    if (commissionValue !== null && clean(payload.commissionType) === 'percentage' && commissionValue > 100
      || commissionValue !== null && clean(payload.commissionType) === 'target_percentage' && commissionValue > 100) {
      throw new AppError('نسبة العمولة يجب أن تكون من صفر إلى 100', 'HR_COMMISSION_PERCENT_INVALID', 400);
    }
    if (commissionValue !== null && clean(payload.commissionType) === 'fixed') {
      try { requireStoredHrMoney(commissionValue, bookDigits); } catch {
        throw new AppError('العمولة الثابتة يجب أن تكون بدقة دفاتر المنشأة دون تقريب', 'HR_COMMISSION_MONEY_PRECISION_INVALID', 400);
      }
    }
    if (insuranceSalary !== null) {
      try { requireStoredHrMoney(insuranceSalary, bookDigits); } catch {
        throw new AppError('الأجر التأميني يجب أن يكون بدقة دفاتر المنشأة دون تقريب', 'HR_INSURANCE_WAGE_PRECISION_INVALID', 400);
      }
    }
    if (!Number.isFinite(graceMinutes) || graceMinutes > 1440) {
      throw new AppError('دقائق سماح الحضور غير صحيحة', 'HR_ATTENDANCE_GRACE_INVALID', 400);
    }

    if (!firstName) throw new AppError('اسم الموظف مطلوب', 'HR_EMPLOYEE_NAME_REQUIRED', 400);
    if (rawEmployeeNo && !employeeNo) {
      throw new AppError('رقم الموظف يجب أن يكون أرقامًا فقط مثل 001', 'HR_EMPLOYEE_NO_INVALID', 400);
    }
    // The HR employee identifier can be an Egyptian ID, GCC civil/national ID,
    // or residency number. Fixed 14-digit Egyptian validation rejected GCC hires.
    if (nationalId && !/^\d{6,20}$/.test(nationalId)) {
      throw new AppError('رقم الهوية الوطنية أو الإقامة يجب أن يكون من 6 إلى 20 رقمًا.', 'HR_EMPLOYEE_NATIONAL_ID_INVALID', 400);
    }
    if (payload.status === 'terminated') {
      throw new AppError('إنهاء الخدمة لا يتم بتعديل ملف الموظف؛ استخدم مسار نهاية الخدمة والمخالصات', 'HR_TERMINATION_WORKFLOW_REQUIRED', 400);
    }
    if (payload.annualLeaveBalance !== undefined &&
      (!Number.isFinite(Number(payload.annualLeaveBalance)) || Number(payload.annualLeaveBalance) < 0)) {
      throw new AppError('رصيد الإجازة السنوية غير صحيح', 'HR_ANNUAL_LEAVE_BALANCE_INVALID', 400);
    }
    if (id && payload.initialContractBaseSalary !== undefined) {
      throw new AppError('لا يمكن إنشاء عقد أولي عند تعديل موظف قائم', 'HR_INITIAL_CONTRACT_CREATE_ONLY', 400);
    }

    const cleanPhone = String(payload.mobile || payload.phone || '').trim();
    const cleanPin = String(payload.pinCode || '').trim();
    if (cleanPin) {
      assertSecurePasscode(cleanPin, { phone: cleanPhone });
    }
    // الرمز يُجزَّأ قبل أي كتابة — لا يُخزَّن نصاً صريحاً إطلاقاً (البند O20)
    const pinRecord = cleanPin ? await createPasswordRecord(cleanPin) : null;
    let savedEmployeeId = id ? String(id) : '';

    try {
      if (id) {
        await this.tx.runInTransaction(this.db, async trx => {
          // Payroll approval takes this lock before all employee snapshots.
          // Without it salary/attendance/insurance profile fields could change
          // between a reviewed snapshot recalculation and final ledger posting.
          await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
          const existingStatus = await sql<{ status: string }>`
            SELECT status FROM hr_employees
            WHERE id = ${id} AND tenant_id = ${auth.tenantId} FOR UPDATE
          `.execute(trx);
        if (!existingStatus.rows.length) throw new NotFoundException('Employee not found');
        if (existingStatus.rows[0].status === 'terminated' && payload.status && payload.status !== 'terminated') {
          throw new AppError('لا يمكن إعادة تفعيل موظف انتهت خدمته بمجرد تعديل ملفه', 'HR_TERMINATED_EMPLOYEE_REACTIVATE_LOCKED', 400);
        }
        if (employeeNo) {
          await this.ensureEmployeeNoAvailable(trx, employeeNo, id, auth);
        }
        await sql`
          UPDATE hr_employees
          SET employee_no = COALESCE(NULLIF(${employeeNo}, ''), employee_no), user_id = CASE WHEN ${payload.userId === undefined} THEN user_id ELSE ${toId(payload.userId)} END, first_name = ${firstName}, last_name = ${lastName}, display_name = ${displayName},
              national_id = CASE WHEN ${payload.nationalId === undefined} THEN national_id ELSE ${nationalId || null} END,
              pin_hash = COALESCE(${pinRecord?.hash ?? null}, pin_hash),
              pin_salt = COALESCE(${pinRecord?.salt ?? null}, pin_salt),
              status = CASE WHEN status = 'terminated' THEN 'terminated' ELSE COALESCE(NULLIF(${clean(payload.status)}, ''), status) END,
              annual_leave_balance = COALESCE(${payload.annualLeaveBalance ?? null}, annual_leave_balance), department_id = CASE WHEN ${payload.departmentId === undefined} THEN department_id ELSE ${toId(payload.departmentId)} END,
              job_title_id = CASE WHEN ${payload.jobTitleId === undefined} THEN job_title_id ELSE ${toId(payload.jobTitleId)} END,
              position_id = CASE WHEN ${payload.positionId === undefined} THEN position_id ELSE ${toId(payload.positionId)} END,
              branch_id = CASE WHEN ${payload.branchId === undefined} THEN branch_id ELSE ${toId(payload.branchId)} END,
              location_id = CASE WHEN ${payload.locationId === undefined} THEN location_id ELSE ${toId(payload.locationId)} END,
              hire_date = CASE WHEN ${payload.hireDate === undefined} THEN hire_date ELSE ${hireDate} END,
              notes = CASE WHEN ${payload.notes === undefined} THEN notes ELSE ${clean(payload.notes)} END,
              compensation_type = CASE WHEN ${payload.compensationType === undefined} THEN compensation_type ELSE ${compensationType} END,
              pay_frequency = CASE WHEN ${payload.payFrequency === undefined} THEN pay_frequency ELSE ${payFrequency} END,
              hourly_rate = CASE WHEN ${payload.compensationType === undefined && payload.hourlyRate === undefined} THEN hourly_rate ELSE ${compensationType === 'hourly' ? Number(hourlyRate || 0) : null} END,
              expected_daily_hours = CASE WHEN ${payload.compensationType === undefined && payload.expectedDailyHours === undefined} THEN expected_daily_hours ELSE ${compensationType === 'hourly' ? Number(expectedDailyHours || 0) : null} END,
              scheduled_check_in_time = CASE WHEN ${payload.scheduledCheckInTime === undefined} THEN scheduled_check_in_time ELSE ${scheduledCheckInTime || null} END,
              scheduled_check_out_time = CASE WHEN ${payload.scheduledCheckOutTime === undefined} THEN scheduled_check_out_time ELSE ${scheduledCheckOutTime || null} END,
              grace_minutes = CASE WHEN ${payload.graceMinutes === undefined} THEN grace_minutes ELSE ${graceMinutes} END,
              overtime_policy = CASE WHEN ${payload.overtimePolicy === undefined} THEN overtime_policy ELSE ${overtimePolicy} END,
              attendance_policy = CASE WHEN ${payload.attendancePolicy === undefined} THEN attendance_policy ELSE ${attendancePolicy} END,
              commission_type = CASE WHEN ${payload.commissionType === undefined} THEN commission_type ELSE ${clean(payload.commissionType) || 'inherit'} END,
              commission_value = CASE WHEN ${payload.commissionValue === undefined} THEN commission_value ELSE ${payload.commissionValue == null ? null : Number(payload.commissionValue)} END,
              commission_target = CASE WHEN ${payload.commissionTarget === undefined} THEN commission_target ELSE ${payload.commissionTarget == null ? null : Number(payload.commissionTarget)} END,
              delay_policy = CASE WHEN ${payload.delayPolicy === undefined} THEN delay_policy ELSE ${clean(payload.delayPolicy) || 'inherit'} END,
              has_social_insurance = CASE WHEN ${payload.hasSocialInsurance === undefined} THEN has_social_insurance ELSE ${Boolean(payload.hasSocialInsurance)} END,
              insurance_salary = CASE WHEN ${payload.insuranceSalary === undefined} THEN insurance_salary ELSE ${payload.insuranceSalary == null ? null : Number(payload.insuranceSalary)} END,
              has_income_tax = CASE WHEN ${payload.hasIncomeTax === undefined} THEN has_income_tax ELSE ${Boolean(payload.hasIncomeTax)} END,
              bank_name = CASE WHEN ${payload.bankName === undefined} THEN bank_name ELSE ${clean(payload.bankName) || null} END,
              bank_account_number = CASE WHEN ${payload.bankAccountNumber === undefined} THEN bank_account_number ELSE ${clean(payload.bankAccountNumber) || null} END,
              iban = CASE WHEN ${payload.iban === undefined} THEN iban ELSE ${clean(payload.iban) || null} END,
              bank_swift_code = CASE WHEN ${payload.bankSwiftCode === undefined} THEN bank_swift_code ELSE ${clean(payload.bankSwiftCode) || null} END,
              updated_by = ${auth.userId}, updated_at = NOW()
          WHERE id = ${id} AND tenant_id = ${auth.tenantId}
        `.execute(trx);

        if (cleanPhone) {
          const existing = await sql<{ id: number }>`SELECT id FROM hr_employee_contacts WHERE employee_id = ${id} AND tenant_id = ${auth.tenantId} ORDER BY is_primary DESC, id ASC LIMIT 1`.execute(trx);
          if (existing.rows.length > 0) {
            await sql`UPDATE hr_employee_contacts SET value = ${cleanPhone}, contact_type = 'mobile', is_primary = true, updated_by = ${auth.userId}, updated_at = NOW() WHERE id = ${existing.rows[0].id} AND tenant_id = ${auth.tenantId}`.execute(trx);
          } else {
            await sql`INSERT INTO hr_employee_contacts (tenant_id, account_id, employee_id, contact_type, value, label, is_primary, notes, created_by, updated_by) VALUES (${auth.tenantId}, ${auth.accountId}, ${id}, 'mobile', ${cleanPhone}, 'الموبايل الأساسي', true, '', ${auth.userId}, ${auth.userId})`.execute(trx);
          }
        }
        });
      } else {
        await this.tx.runInTransaction(this.db, async (trx) => {
          // New staff invalidate overlapping reviewed payroll. Serialize first
          // with approval, then ATS/other employee number allocations.
          await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
          await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-employee:' + auth.tenantId}))`.execute(trx);
          const businessTz = await getTenantTimezone(trx, auth.tenantId || '');
          const nextEmployeeNo = employeeNo || await this.nextAvailableEmployeeNo(trx, auth);
          await this.ensureEmployeeNoAvailable(trx, nextEmployeeNo, null, auth);
          const insertResult = await sql<{ id: number }>`
            INSERT INTO hr_employees (tenant_id, account_id, employee_no, national_id, pin_hash, pin_salt, user_id, first_name, last_name, display_name, status, department_id, job_title_id, position_id, branch_id, location_id, hire_date, notes, compensation_type, pay_frequency, hourly_rate, expected_daily_hours, scheduled_check_in_time, scheduled_check_out_time, grace_minutes, overtime_policy, attendance_policy, commission_type, commission_value, commission_target, delay_policy, has_social_insurance, insurance_salary, has_income_tax, bank_name, bank_account_number, iban, bank_swift_code, annual_leave_balance, created_by, updated_by)
            VALUES (${auth.tenantId}, ${auth.accountId}, ${nextEmployeeNo}, ${nationalId || null}, ${pinRecord?.hash ?? null}, ${pinRecord?.salt ?? null}, ${toId(payload.userId)}, ${firstName}, ${lastName}, ${displayName}, ${clean(payload.status) || 'active'}, ${toId(payload.departmentId)}, ${toId(payload.jobTitleId)}, ${toId(payload.positionId)}, ${toId(payload.branchId)}, ${toId(payload.locationId)}, ${hireDate}, ${clean(payload.notes)}, ${compensationType}, ${payFrequency}, ${compensationType === 'hourly' ? Number(hourlyRate || 0) : null}, ${compensationType === 'hourly' ? Number(expectedDailyHours || 0) : null}, ${scheduledCheckInTime || null}, ${scheduledCheckOutTime || null}, ${graceMinutes}, ${overtimePolicy}, ${attendancePolicy}, ${clean(payload.commissionType) || 'inherit'}, ${payload.commissionValue == null ? null : Number(payload.commissionValue)}, ${payload.commissionTarget == null ? null : Number(payload.commissionTarget)}, ${clean(payload.delayPolicy) || 'inherit'}, ${Boolean(payload.hasSocialInsurance)}, ${payload.insuranceSalary == null ? null : Number(payload.insuranceSalary)}, ${Boolean(payload.hasIncomeTax)}, ${clean(payload.bankName) || null}, ${clean(payload.bankAccountNumber) || null}, ${clean(payload.iban) || null}, ${clean(payload.bankSwiftCode) || null}, ${payload.annualLeaveBalance ?? 21}, ${auth.userId}, ${auth.userId})
            RETURNING id
          `.execute(trx);
          const newId = insertResult.rows[0]?.id;
          if (newId) {
            savedEmployeeId = String(newId);
            if (cleanPhone) {
              await sql`INSERT INTO hr_employee_contacts (tenant_id, account_id, employee_id, contact_type, value, label, is_primary, notes, created_by, updated_by) VALUES (${auth.tenantId}, ${auth.accountId}, ${newId}, 'mobile', ${cleanPhone}, 'الموبايل الأساسي', true, '', ${auth.userId}, ${auth.userId})`.execute(trx);
            }
            if (payload.initialContractBaseSalary !== undefined) {
              const contractSalary = Number(payload.initialContractBaseSalary);
              const contractCurrency = clean(payload.initialContractCurrency).toUpperCase();
              if (!Number.isFinite(contractSalary) || contractSalary < 0 || !hireDate || !/^[A-Z]{3}$/.test(contractCurrency)) {
                throw new AppError('تاريخ التعيين وقيمة المرتب والعملة مطلوبة للعقد الأولي', 'HR_INITIAL_CONTRACT_INVALID', 400);
              }
              if (compensationType === 'monthly' && contractSalary <= 0) {
                throw new AppError('العقد الشهري يحتاج راتبًا أساسيًا أكبر من صفر', 'HR_INITIAL_CONTRACT_SALARY_REQUIRED', 400);
              }
              const tenantCurrency = await sql<{ value: string }>`
                SELECT value FROM settings WHERE tenant_id = ${auth.tenantId} AND key = 'currency' LIMIT 1
              `.execute(trx);
              const currencySetting = clean(tenantCurrency.rows[0]?.value).replace(/^"|"$/g, '').toUpperCase();
              if (!currencySetting || currencySetting !== contractCurrency) {
                throw new AppError('عملة العقد يجب أن تطابق عملة المنشأة المحددة في الإعدادات', 'HR_INITIAL_CONTRACT_CURRENCY_MISMATCH', 400);
              }
              try { requireStoredHrMoney(contractSalary, currencyMoneyDigits(currencySetting)); } catch {
                throw new AppError('راتب العقد الأولي يجب أن يكون بدقة دفاتر المنشأة دون تقريب', 'HR_INITIAL_CONTRACT_MONEY_PRECISION_INVALID', 400);
              }
              const insertedContract = await sql<{ id: number }>`
                INSERT INTO hr_employment_contracts (
                  tenant_id, account_id, employee_id, contract_no, contract_type,
                  status, start_date, base_salary, currency, notes, created_by, updated_by
                ) VALUES (
                  ${auth.tenantId}, ${auth.accountId}, ${newId},
                  ${'CON-TMP-' + String(newId)}, ${clean(payload.initialContractType) || 'standard'},
                  'active', ${hireDate}::date, ${contractSalary}, ${contractCurrency},
                  'تم إنشاء العقد مع ملف الموظف.', ${auth.userId}, ${auth.userId}
                ) RETURNING id
              `.execute(trx);
              const contractId = Number(insertedContract.rows[0]?.id);
              if (!contractId) throw new AppError('فشل إنشاء عقد الموظف', 'HR_INITIAL_CONTRACT_FAILED', 500);
              await sql`
                UPDATE hr_employment_contracts
                SET contract_no = ${formatDailyDocumentNumber('CON', contractId, new Date(), 4, businessTz)}
                WHERE id = ${contractId} AND employee_id = ${newId} AND tenant_id = ${auth.tenantId}
              `.execute(trx);
            }
            if (hireDate && (clean(payload.status) || 'active') === 'active') {
              await this.invalidateReviewedPayrollForNewHire(trx, auth.tenantId || '', hireDate, payFrequency);
            }
          }
        });
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('رقم الموظف مستخدم بالفعل', 'HR_EMPLOYEE_NO_EXISTS', 409);
      }
      throw error;
    }

    await this.audit.log(`${id ? 'Update' : 'Create'} HR employee`, `Employee ${displayName} saved by ${auth.username}`, auth);
    return { ok: true, id: savedEmployeeId, ...(await this.listEmployees({}, auth)) };
  }

  async updateEmployeeStatus(id: number, status: string, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertEmployeeBelongsToTenant(id, auth);
    if (status === 'terminated') {
      throw new AppError('استخدم إجراء إنهاء الخدمة المعتمد وليس تعديل حالة الموظف', 'HR_TERMINATION_WORKFLOW_REQUIRED', 400);
    }
    const validStatus = ['active', 'inactive', 'deactivated'].includes(status) ? status : 'active';
    await this.tx.runInTransaction(this.db, async trx => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const existing = await sql<{ status: string }>`
        SELECT status FROM hr_employees WHERE id = ${id} AND tenant_id = ${auth.tenantId} FOR UPDATE
      `.execute(trx);
      if (!existing.rows.length) throw new NotFoundException('Employee not found');
      if (existing.rows[0].status === 'terminated') {
        throw new AppError('لا يمكن إعادة تفعيل موظف انتهت خدمته بدون إجراءات إعادة تعيين', 'HR_TERMINATED_EMPLOYEE_REACTIVATE_LOCKED', 409);
      }
      await sql`
        UPDATE hr_employees SET status = ${validStatus}, updated_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${auth.tenantId} AND status <> 'terminated'
      `.execute(trx);
    });
    await this.audit.log('Update HR employee status', `Employee #${id} status changed to ${validStatus} by ${auth.username}`, auth);
    return { ok: true, ...(await this.listEmployees({}, auth)) };
  }

  async updateEmployeeCredentials(employeeId: number, payload: UpdateEmployeeCredentialsDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId, accountId } = requireTenantScope(auth);
    const cleanPin = String(payload.pinCode || '').trim();
    const cleanPhone = String(payload.phone || '').trim();
    // Hash BEFORE entering the DB transaction, so a slow password hash doesn't
    // block other employee punch/profile operations.
    if (cleanPin) assertSecurePasscode(cleanPin, { phone: cleanPhone });
    const pinRecord = cleanPin ? await createPasswordRecord(cleanPin) : null;
    await this.tx.runInTransaction(this.db, async trx => {
      const employee = await sql<{ id: number }>`
        SELECT id FROM hr_employees WHERE id = ${employeeId} AND tenant_id = ${tenantId} FOR UPDATE
      `.execute(trx);
      if (!employee.rows.length) throw new NotFoundException('Employee not found');
      if (pinRecord) {
        await sql`
          UPDATE hr_employees
          SET pin_hash = ${pinRecord.hash}, pin_salt = ${pinRecord.salt},
              mobile_punch_enabled = TRUE, updated_by = ${auth.userId}, updated_at = NOW()
          WHERE id = ${employeeId} AND tenant_id = ${tenantId}
        `.execute(trx);
      }
      if (cleanPhone) {
        const existing = await sql<{ id: number }>`
          SELECT id FROM hr_employee_contacts
          WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
          ORDER BY is_primary DESC, id ASC LIMIT 1
        `.execute(trx);
        if (existing.rows.length) {
          await sql`
            UPDATE hr_employee_contacts
            SET value = ${cleanPhone}, contact_type = 'mobile', is_primary = TRUE,
                updated_by = ${auth.userId}, updated_at = NOW()
            WHERE id = ${existing.rows[0].id} AND employee_id = ${employeeId} AND tenant_id = ${tenantId}
          `.execute(trx);
        } else {
          await sql`
            INSERT INTO hr_employee_contacts
              (tenant_id, account_id, employee_id, contact_type, value,
               label, is_primary, notes, created_by, updated_by)
            VALUES (${tenantId}, ${accountId}, ${employeeId}, 'mobile',
                    ${cleanPhone}, 'الموبايل الأساسي', TRUE, '', ${auth.userId}, ${auth.userId})
          `.execute(trx);
        }
      }
    });
    await this.audit.log('Update HR employee credentials', `Employee #${employeeId} credentials updated by ${auth.username}`, auth);
    return { ok: true, ...(await this.listEmployees({}, auth)) };
  }

  async deactivateEmployee(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async trx => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const status = await sql<{ status: string }>`
        SELECT status FROM hr_employees WHERE id = ${id} AND tenant_id = ${auth.tenantId} FOR UPDATE
      `.execute(trx);
      if (!status.rows.length) throw new NotFoundException('Employee not found');
      if (status.rows[0].status === 'terminated') {
        throw new AppError('لا يمكن إلغاء تفعيل موظف انتهت خدمته', 'HR_TERMINATED_EMPLOYEE_REACTIVATE_LOCKED', 409);
      }
      await sql`
        UPDATE hr_employees SET status = 'deactivated', updated_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${auth.tenantId} AND status <> 'terminated'
      `.execute(trx);
    });
    await this.audit.log('Deactivate HR employee', `Employee #${id} deactivated by ${auth.username}`, auth);
    return { ok: true, ...(await this.listEmployees({}, auth)) };
  }

  async listContacts(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.listContacts(employeeId, auth);
  }

  async upsertContact(employeeId: number, id: number | null, payload: UpsertEmployeeContactDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.upsertContact(employeeId, id, payload, auth);
  }

  async listDocuments(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.listDocuments(employeeId, auth);
  }

  async upsertDocument(employeeId: number, id: number | null, payload: UpsertEmployeeDocumentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.upsertDocument(employeeId, id, payload, auth);
  }

  async listContracts(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.listContracts(employeeId, auth);
  }

  async upsertContract(employeeId: number, id: number | null, payload: UpsertEmploymentContractDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.upsertContract(employeeId, id, payload, auth);
  }

  async listCompensation(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.listCompensation(employeeId, auth);
  }

  async upsertCompensation(employeeId: number, id: number | null, payload: UpsertCompensationPackageDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.upsertCompensation(employeeId, id, payload, auth);
  }

  async listEmployeeAdjustments(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.listEmployeeAdjustments(employeeId, auth);
  }

  async createEmployeeAdjustment(employeeId: number, payload: CreateEmployeeAdjustmentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.createEmployeeAdjustment(employeeId, payload, auth);
  }

  async deleteEmployeeAdjustment(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.deleteEmployeeAdjustment(id, auth);
  }

  async listLoans(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.loansService.listLoans(query, auth);
  }

  async createLoan(payload: UpsertEmployeeLoanDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.loansService.createLoan(payload, auth);
  }

  async updateLoan(id: number, payload: UpsertEmployeeLoanDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.loansService.updateLoan(id, payload, auth);
  }

  async approveLoan(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.loansService.approveLoan(id, auth);
  }

  async disburseLoan(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.loansService.disburseLoan(id, auth);
  }

  async repayLoan(id: number, payload: LoanRepaymentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.loansService.repayLoan(id, payload, auth);
  }

  async listLedger(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    const result = await sql<Record<string, unknown>>`
      SELECT * FROM hr_employee_ledger 
      WHERE employee_id = ${employeeId} AND tenant_id = ${auth.tenantId} 
      ORDER BY id DESC
    `.execute(this.db);
    return { rows: result.rows.map((row) => ({ id: String(row.id), employeeId: String(row.employee_id), entryType: clean(row.entry_type), amount: Number(row.amount || 0), balanceAfter: Number(row.balance_after || 0), note: clean(row.note), repaymentMethod: clean(row.repayment_method), referenceType: clean(row.reference_type), referenceId: row.reference_id ? String(row.reference_id) : '', createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at) })) };
  }

  async getEmployeeFinancialStatement(employeeId: number, query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.getEmployeeFinancialStatement(employeeId, query, auth);
  }

  private mapPayrollRun(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(row.id),
      periodMonth: clean(row.period_month),
      startDate: row.start_date_text ? clean(row.start_date_text) : '',
      endDate: row.end_date_text ? clean(row.end_date_text) : '',
      payFrequency: clean(row.pay_frequency) || 'monthly',
      status: clean(row.status) || 'draft',
      notes: clean(row.notes),
      createdBy: row.created_by ? String(row.created_by) : '',
      reviewedBy: row.reviewed_by ? String(row.reviewed_by) : '',
      approvedBy: row.approved_by ? String(row.approved_by) : '',
      createdAt: clean(row.created_at_text),
      reviewedAt: clean(row.reviewed_at_text),
      approvedAt: clean(row.approved_at_text),
      updatedAt: clean(row.updated_at_text),
      itemCount: Number(row.item_count || 0),
      totalBaseSalary: Number(row.total_base_salary || 0),
      totalAllowanceAmount: Number(row.total_allowance_amount || 0),
      totalDeductionAmount: Number(row.total_deduction_amount || 0),
      totalLoanDeductionAmount: Number(row.total_loan_deduction_amount || 0),
      totalAssetRecoveryDeductionAmount: Number(row.total_asset_recovery_deduction_amount || 0),
      totalEmployeeSocialInsurance: Number(row.total_employee_social_insurance || 0),
      totalEmployerSocialInsurance: Number(row.total_employer_social_insurance || 0),
      totalIncomeTax: Number(row.total_income_tax || 0),
      totalPenaltyDeduction: Number(row.total_penalty_deduction || 0),
      totalCarriedForwardDeduction: Number(row.total_carried_forward_deduction || 0),
      totalGrossPay: Number(row.total_gross_pay || 0),
      totalNetPay: Number(row.total_net_pay || 0),
    };
  }

  private mapPayrollItem(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      employeeId: String(row.employee_id),
      employeeName: clean(row.employee_name),
      employeeNo: clean(row.employee_no),
      compensationType: clean(row.compensation_type) || 'monthly',
      hourlyRate: row.hourly_rate == null ? null : Number(row.hourly_rate),
      expectedDailyHours: row.expected_daily_hours == null ? null : Number(row.expected_daily_hours),
      contractId: row.contract_id ? String(row.contract_id) : '',
      baseSalary: Number(row.base_salary || 0),
      allowanceAmount: Number(row.allowance_amount || 0),
      deductionAmount: Number(row.deduction_amount || 0),
      loanDeductionAmount: Number(row.loan_deduction_amount || 0),
      assetRecoveryDeductionAmount: Number(row.asset_recovery_deduction_amount || 0),
      employeeSocialInsurance: Number(row.employee_social_insurance || 0),
      employerSocialInsurance: Number(row.employer_social_insurance || 0),
      incomeTax: Number(row.income_tax || 0),
      penaltyDeduction: Number(row.penalty_deduction || 0),
      carriedForwardDeduction: Number(row.carried_forward_deduction || 0),
      grossPay: Number(row.gross_pay || 0),
      netPay: Number(row.net_pay || 0),
      status: clean(row.status) || 'draft',
      notes: clean(row.notes),
      createdAt: clean(row.created_at_text),
      updatedAt: clean(row.updated_at_text),
    };
  }

  private mapPayrollAdjustment(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(row.id),
      payrollItemId: String(row.payroll_item_id),
      adjustmentType: clean(row.adjustment_type),
      label: clean(row.label),
      amount: Number(row.amount || 0),
      notes: clean(row.notes),
      createdAt: clean(row.created_at_text),
    };
  }

  private async getPayrollRunStatus(db: Kysely<Database>, runId: number, tenantId: string): Promise<string> {
    const result = await sql<{ status: string }>`SELECT status FROM hr_payroll_runs WHERE id = ${runId} AND tenant_id = ${tenantId} LIMIT 1`.execute(db);
    const status = clean(result.rows[0]?.status);
    if (!status) throw new AppError('Payroll run not found', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
    return status;
  }

  private async getPayrollRunStatusForUpdate(db: Kysely<Database>, runId: number, tenantId: string): Promise<string> {
    const result = await sql<{ status: string }>`SELECT status FROM hr_payroll_runs WHERE id = ${runId} AND tenant_id = ${tenantId} LIMIT 1 FOR UPDATE`.execute(db);
    const status = clean(result.rows[0]?.status);
    if (!status) throw new AppError('Payroll run not found', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
    return status;
  }

  private async getPayrollItemRun(db: Kysely<Database>, itemId: number, tenantId: string): Promise<{ runId: number; runStatus: string; itemStatus: string }> {
    const result = await sql<{ run_id: number; run_status: string; item_status: string }>`
      SELECT i.run_id, r.status AS run_status, i.status AS item_status
      FROM hr_payroll_run_items i
      JOIN hr_payroll_runs r ON r.id = i.run_id
      WHERE i.id = ${itemId} AND i.tenant_id = ${tenantId} AND r.tenant_id = ${tenantId}
      LIMIT 1
    `.execute(db);
    const row = result.rows[0];
    if (!row) throw new AppError('Payroll item not found', 'HR_PAYROLL_ITEM_NOT_FOUND', 404);
    return { runId: Number(row.run_id), runStatus: clean(row.run_status), itemStatus: clean(row.item_status) };
  }

  private async calculateLoanDeduction(db: Kysely<Database>, employeeId: number, periodEndDate: string, tenantId: string, minorUnits: MoneyDigits): Promise<{ amount: number; notes: string[] }> {
    const dueCutoff = normalizeDateOnly(periodEndDate);
    if (!dueCutoff) throw new AppError('تاريخ نهاية فترة المسير غير صحيح', 'HR_PAYROLL_PERIOD_END_INVALID', 400);
    const result = await sql<Record<string, unknown>>`
      SELECT
        i.loan_id,
        i.id AS installment_id,
        i.amount,
        i.paid_amount,
        i.status,
        l.remaining_amount AS loan_remaining,
        to_char(COALESCE(i.due_date, l.first_due_date, l.salary_due_date), 'YYYY-MM-DD') AS due_date_text
      FROM hr_employee_loan_installments i
      JOIN hr_employee_loans l ON l.id = i.loan_id AND l.tenant_id = i.tenant_id
      WHERE l.employee_id = ${employeeId} AND l.tenant_id = ${tenantId}
        AND l.repayment_mode IN ('deduct_next_salary', 'monthly_salary_installment')
        AND l.status IN ('paid', 'partially_repaid', 'disbursed')
        AND GREATEST(l.issue_date, COALESCE(l.disbursed_at::date, l.issue_date)) <= ${dueCutoff}::date
        AND COALESCE(i.status, 'pending') IN ('pending', 'partial')
        AND (
          l.repayment_mode = 'deduct_next_salary'
          OR COALESCE(i.due_date, l.first_due_date, l.salary_due_date) <= ${dueCutoff}::date
        )
      ORDER BY COALESCE(i.due_date, l.first_due_date, l.salary_due_date) ASC, i.installment_no ASC
    `.execute(db);
    const notes: string[] = [];
    const eligible = result.rows.map(installment => ({
      loanId: Number(installment.loan_id),
      installmentAmount: Number(installment.amount),
      installmentPaid: Number(installment.paid_amount || 0),
      loanRemaining: Number(installment.loan_remaining),
    }));
    let total: number;
    try {
      total = calculatePayrollLoanDueTotal(eligible, minorUnits);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'أرصدة السلف والأقساط غير متطابقة',
        'HR_PAYROLL_LOAN_BALANCE_INVALID', 409,
      );
    }
    return { amount: total, notes };
  }

  private async adjustmentTotals(db: Kysely<Database>, itemId: number, tenantId: string, minorUnits: MoneyDigits): Promise<{ allowance: number; deduction: number }> {
    const result = await sql<{ allowance: string; deduction: string }>`
      SELECT
        COALESCE(SUM(CASE WHEN adjustment_type = 'allowance' THEN amount ELSE 0 END), 0) AS allowance,
        COALESCE(SUM(CASE WHEN adjustment_type = 'deduction' THEN amount ELSE 0 END), 0) AS deduction
      FROM hr_payroll_item_adjustments
      WHERE payroll_item_id = ${itemId} AND tenant_id = ${tenantId}
    `.execute(db);
    return {
      allowance: money(result.rows[0]?.allowance, minorUnits),
      deduction: money(result.rows[0]?.deduction, minorUnits),
    };
  }

  /**
   * Payroll manual adjustments must retain calculated overtime, commissions, capped
   * installments and statutory items. Never reconstruct the item from its base salary
   * alone: that discards previously calculated earnings.
   */
  private async recalculatePayrollItemTotals(db: Kysely<Database>, itemId: number, tenantId: string): Promise<void> {
    const item = await sql<{ run_id: number; status: string; run_status: string }>`
      SELECT i.run_id, i.status, r.status AS run_status
      FROM hr_payroll_run_items i
      JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
      WHERE i.id = ${itemId} AND i.tenant_id = ${tenantId}
      LIMIT 1
    `.execute(db);
    if (!item.rows.length) throw new AppError('Payroll item not found', 'HR_PAYROLL_ITEM_NOT_FOUND', 404);
    if (item.rows[0].run_status !== 'draft') {
      throw new AppError('Payroll adjustments are allowed for drafts only', 'HR_PAYROLL_ADJUSTMENT_LOCKED', 400);
    }
    await this.rebuildPayrollRunItems(db, Number(item.rows[0].run_id), 'draft', tenantId);
  }

  /**
   * O28: `runId` comes from the request path, and the whole rebuild derives its tenant from the row
   * it reads. Reading that row by id alone meant a payroll id from another tenant would have set the
   * scope for every write below. The caller's tenant is now required, and a run outside it is not found.
   */
  private async rebuildPayrollRunItems(
    db: Kysely<Database>,
    runId: number,
    itemStatus: 'draft' | 'reviewed' | 'approved',
    scopeTenantId: string,
  ): Promise<void> {
    const callerTenantId = clean(scopeTenantId);
    if (!callerTenantId) throw new AppError('نطاق المنشأة مطلوب', 'HR_PAYROLL_TENANT_REQUIRED', 400);
    const runResult = await sql<any>`SELECT period_month, tenant_id, account_id, to_char(start_date, 'YYYY-MM-DD') as start_date_text, to_char(end_date, 'YYYY-MM-DD') as end_date_text, pay_frequency FROM hr_payroll_runs WHERE id = ${runId} AND tenant_id = ${callerTenantId} LIMIT 1`.execute(db);
    const run = runResult.rows[0];
    if (!run) return;
    const periodMonth = normalizePayrollMonth(run.period_month || run.periodMonth);
    if (!periodMonth) throw new AppError('Payroll month is invalid', 'HR_PAYROLL_MONTH_INVALID', 400);
    const tenantId = run.tenant_id || run.tenantId || '';
    const accountId = run.account_id || run.accountId || '';
    const range = {
      from: run.start_date_text || monthRange(periodMonth).from,
      to: run.end_date_text || monthRange(periodMonth).to
    };
    const payFreq = clean(run.pay_frequency) || 'monthly';
    await sql`UPDATE hr_employee_adjustments SET status = 'pending', applied_in_run_id = NULL WHERE applied_in_run_id = ${runId} AND tenant_id = ${tenantId}`.execute(db);
    const employees = await sql<Record<string, unknown>>`
      SELECT
        e.id AS employee_id,
        e.display_name,
        c.id AS contract_id,
        c.base_salary,
        e.compensation_type,
        e.hourly_rate,
        e.expected_daily_hours,
        to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date,
        to_char(e.end_of_service_date, 'YYYY-MM-DD') AS end_of_service_date,
        e.has_social_insurance,
        e.insurance_salary,
        e.has_income_tax,
        to_char(c.start_date, 'YYYY-MM-DD') AS contract_start_date,
        to_char(c.end_date, 'YYYY-MM-DD') AS contract_end_date
      FROM hr_employees e
      LEFT JOIN LATERAL (
        SELECT *
        FROM hr_employment_contracts c
        WHERE c.employee_id = e.id AND c.tenant_id = e.tenant_id
          AND c.status IN ('active', 'ended')
          AND c.start_date <= ${range.to}::date
          AND (c.end_date IS NULL OR c.end_date >= ${range.from}::date)
        ORDER BY c.start_date DESC NULLS LAST,
                 c.id DESC
        LIMIT 1
      ) c ON TRUE
      WHERE e.tenant_id = ${tenantId}
        AND (
          e.status = 'active'
          OR (
            e.status = 'terminated'
            AND e.end_of_service_date >= ${range.from}::date
            -- A posted EOS settlement reconciles the final wage separately;
            -- do not include it again in payroll.
            AND NOT EXISTS (
              SELECT 1 FROM hr_end_of_service_settlements s
              WHERE s.employee_id = e.id AND s.tenant_id = e.tenant_id
                AND s.status = 'posted'
            )
          )
        )
        AND (e.hire_date IS NULL OR e.hire_date <= ${range.to}::date)
        AND (e.end_of_service_date IS NULL OR e.end_of_service_date >= ${range.from}::date)
        ${payFreq === 'all' ? sql`` : sql`AND COALESCE(e.pay_frequency, 'monthly') = ${payFreq}`}
      ORDER BY e.id ASC
    `.execute(db);

    const empIds = employees.rows.map(e => Number(e.employee_id)).filter(id => id > 0);
    const currencySetting = await sql<{ value: string }>`
      SELECT value FROM settings WHERE tenant_id = ${tenantId} AND key = 'currency' LIMIT 1
    `.execute(db);
    const payrollCurrency = clean(currencySetting.rows[0]?.value).replace(/^"|"$/g, '').toUpperCase();
    try {
      requirePayrollMonetaryCurrency(payrollCurrency, payrollCurrency);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'عملة مسير الرواتب غير مدعومة',
        'HR_PAYROLL_CURRENCY_UNSUPPORTED', 409,
      );
    }
    const bookDigits = currencyMoneyDigits(payrollCurrency);
    const contractRows = empIds.length
      ? await sql<Record<string, unknown>>`
          SELECT employee_id, id, base_salary, currency,
            to_char(start_date, 'YYYY-MM-DD') AS start_date_text,
            to_char(end_date, 'YYYY-MM-DD') AS end_date_text
          FROM hr_employment_contracts
          WHERE tenant_id = ${tenantId}
            AND employee_id IN (${sql.join(empIds)})
            AND status IN ('active', 'ended')
            AND start_date <= ${range.to}::date
            AND (end_date IS NULL OR end_date >= ${range.from}::date)
          ORDER BY employee_id, start_date, id
        `.execute(db) : { rows: [] as Record<string, unknown>[] };
    const contractHistory = new Map<number, EffectiveSalaryContract[]>();
    for (const row of contractRows.rows) {
      const employeeId = Number(row.employee_id);
      try {
        requirePayrollMonetaryCurrency(payrollCurrency, clean(row.currency));
      } catch (error) {
        throw new AppError(
          `عملة عقد الموظف #${employeeId}: ${error instanceof Error ? error.message : 'عملة غير صحيحة'}`,
          'HR_PAYROLL_CONTRACT_CURRENCY_MISMATCH', 409,
        );
      }
      const item: EffectiveSalaryContract = {
        id: Number(row.id),
        startDate: String(row.start_date_text),
        endDate: row.end_date_text ? String(row.end_date_text) : null,
        baseSalary: Number(row.base_salary),
      };
      if (!contractHistory.has(employeeId)) contractHistory.set(employeeId, []);
      contractHistory.get(employeeId)!.push(item);
    }
    const packageRows = empIds.length
      ? await sql<Record<string, unknown>>`
          SELECT employee_id, id, allowance_amount, deduction_amount,
            to_char(effective_from, 'YYYY-MM-DD') AS start_date_text,
            to_char(effective_to, 'YYYY-MM-DD') AS end_date_text
          FROM hr_compensation_packages
          WHERE tenant_id = ${tenantId}
            AND employee_id IN (${sql.join(empIds)})
            AND (effective_from IS NULL OR effective_from <= ${range.to}::date)
            AND (effective_to IS NULL OR effective_to >= ${range.from}::date)
          ORDER BY employee_id, effective_from NULLS FIRST, id
        `.execute(db) : { rows: [] as Record<string, unknown>[] };
    const packageHistory = new Map<number, EffectiveCompensationPackage[]>();
    for (const row of packageRows.rows) {
      const employeeId = Number(row.employee_id);
      const item: EffectiveCompensationPackage = {
        id: Number(row.id),
        startDate: row.start_date_text ? String(row.start_date_text) : null,
        endDate: row.end_date_text ? String(row.end_date_text) : null,
        allowanceAmount: Number(row.allowance_amount),
        deductionAmount: Number(row.deduction_amount),
      };
      if (!packageHistory.has(employeeId)) packageHistory.set(employeeId, []);
      packageHistory.get(employeeId)!.push(item);
    }
    // A rebuilt draft/reviewed run must not retain a payable item for someone
    // who no longer qualifies (terminated and settled, deactivated, or excluded
    // by pay frequency). Preserve history/adjustments by excluding, not deleting.
    await sql`
      UPDATE hr_payroll_run_items i
      SET status = 'excluded',
          notes = CASE
            WHEN i.notes LIKE '%' || ${AUTO_PAYROLL_EXCLUSION_NOTE}::text || '%' THEN i.notes
            ELSE CONCAT_WS(' | ', NULLIF(i.notes, ''), ${AUTO_PAYROLL_EXCLUSION_NOTE}::text)
          END,
          updated_at = NOW()
      WHERE i.run_id = ${runId} AND i.tenant_id = ${tenantId}
        AND i.status IN ('draft', 'reviewed')
        AND ${empIds.length ? sql`i.employee_id NOT IN (${sql.join(empIds)})` : sql`TRUE`}
    `.execute(db);
    // The previous hourly formula credited 30 theoretical days, regardless of actual punches.
    // Read all punches for the run once, then share the exact same totals with payroll review.
    const hourlyWorkByEmployee = new Map<number, ReturnType<typeof summarizeHourlyAttendance>>();
    const punches = empIds.length ? await sql<Record<string, unknown>>`
      SELECT employee_id, status, check_in_at, check_out_at, prior_sessions_minutes,
        to_char(work_date, 'YYYY-MM-DD') AS work_date_text
      FROM hr_attendance_records
      WHERE tenant_id = ${tenantId}
        AND employee_id IN (${sql.join(empIds)})
        AND work_date >= ${range.from}::date
        AND work_date <= ${range.to}::date
    `.execute(db) : { rows: [] as Record<string, unknown>[] };
    const punchesByEmployee = new Map<number, Record<string, unknown>[]>();
    for (const punch of punches.rows) {
      const employeeId = Number(punch.employee_id);
      if (!punchesByEmployee.has(employeeId)) punchesByEmployee.set(employeeId, []);
      punchesByEmployee.get(employeeId)!.push(punch);
    }
    const baseSalMap = new Map<number, number>();
    const contractualMonthlySalary = new Map<number, number>();
    const compensationByEmployee = new Map<number, { allowance: number; deduction: number }>();
    const payRangeByEmployee = new Map<number, { from: string; to: string }>();
    for (const e of employees.rows) {
      const id = Number(e.employee_id);
      const hire = normalizeDateOnly(e.hire_date) || range.from;
      const employmentEnd = normalizeDateOnly(e.end_of_service_date) || range.to;
      const from = [range.from, hire].sort().at(-1)!;
      const to = [range.to, employmentEnd].sort()[0];
      payRangeByEmployee.set(id, { from, to });
      try {
        compensationByEmployee.set(id, calculateEffectiveCompensationPay(packageHistory.get(id) || [], from, to, bookDigits));
      } catch (error) {
        throw new AppError(
          `البدلات والاستقطاعات الثابتة للموظف #${id} متداخلة أو غير صحيحة: ${error instanceof Error ? error.message : 'راجع الباقات'}`,
          'HR_PAYROLL_COMPENSATION_PERIOD_INVALID', 409,
        );
      }
    }
    for (const e of employees.rows) {
      const employeeId = Number(e.employee_id);
      if (e.compensation_type === 'hourly') {
        const earned = payRangeByEmployee.get(employeeId)!;
        const eligiblePunches = (punchesByEmployee.get(employeeId) || []).filter(
          punch => String(punch.work_date_text) >= earned.from && String(punch.work_date_text) <= earned.to,
        );
        const work = summarizeHourlyAttendance(eligiblePunches, Number(e.hourly_rate || 0), bookDigits);
        hourlyWorkByEmployee.set(employeeId, work);
        baseSalMap.set(employeeId, work.baseWage);
      } else {
        const payRange = payRangeByEmployee.get(employeeId)!;
        try {
          const result = calculateEffectiveContractPay(
            contractHistory.get(employeeId) || [], payRange.from, payRange.to, bookDigits,
          );
          contractualMonthlySalary.set(employeeId, result.referenceMonthlySalary);
          baseSalMap.set(employeeId, result.baseWage);
        } catch (error) {
          throw new AppError(
            `عقود راتب الموظف #${employeeId} خلال الفترة غير مكتملة أو متداخلة: ${error instanceof Error ? error.message : 'راجع العقود'}`,
            'HR_PAYROLL_CONTRACT_PERIOD_INVALID', 409,
          );
        }
      }
    }
    const autoReviews = await this.calculatePayrollOperationalReview(db, range, empIds, baseSalMap, tenantId, contractualMonthlySalary, contractHistory, bookDigits);
    const policies = await this.getPayrollPolicies(db, tenantId);
    const maxDeductionPct = policies.maxDeductionPct !== undefined ? Number(policies.maxDeductionPct) : 1.0;

    for (const employee of employees.rows) {
      const employeeId = Number(employee.employee_id || 0);
      if (!(employeeId > 0)) continue;
      const existing = await sql<Record<string, unknown>>`
        SELECT id, status, notes
        FROM hr_payroll_run_items
        WHERE run_id = ${runId} AND employee_id = ${employeeId} AND tenant_id = ${tenantId}
        LIMIT 1
      `.execute(db);
      const existingItem = existing.rows[0];
      // INV-PAID-PAYROLL-ITEMS-NEVER-REBUILT: a paid item is final.
      // Rebuilding must never recompute its amounts or reset its
      // status — the paid state is guarded here, on the item
      // itself, not only by the run-status gates on rebuild's
      // callers. (Approved items were already skipped; paid items
      // were recomputed and reset to the rebuild target status,
      // which would resurrect them as payable.)
      if (clean(existingItem?.status) === 'approved' || clean(existingItem?.status) === 'paid') continue;
      const excluded = clean(existingItem?.status) === 'excluded';
      if (excluded && !canReincludeAutoExcludedPayrollItem(
        clean(existingItem?.status), clean(existingItem?.notes))) continue;
      const itemId = Number(existingItem?.id || 0);
      const adjustments = itemId > 0 ? await this.adjustmentTotals(db, itemId, tenantId, bookDigits) : { allowance: 0, deduction: 0 };
      const isHourly = clean(employee.compensation_type) === 'hourly';
      // The base wage was computed across ALL valid historical contract segments.
      // Never re-prorate using just the latest contract, which drops earned days
      // before a mid-month promotion/salary change.
      const baseSalary = isHourly
        ? (hourlyWorkByEmployee.get(employeeId)?.baseWage || 0)
        : Number(baseSalMap.get(employeeId) || 0);
      const payRange = payRangeByEmployee.get(employeeId)!;
      const fixedCompensation = compensationByEmployee.get(employeeId) || { allowance: 0, deduction: 0 };
      const compensationAllowance = fixedCompensation.allowance;
      const compensationDeduction = fixedCompensation.deduction;
      const loanDeduction = await this.calculateLoanDeduction(db, employeeId, range.to, tenantId, bookDigits);

      const empAdjustmentsResult = await sql<Record<string, unknown>>`
        SELECT id, adjustment_type, amount_type, amount, accounting_category, source_type, source_id,
          to_char(date, 'YYYY-MM-DD') AS adjustment_date
        FROM hr_employee_adjustments
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId} AND status = 'pending' AND date <= ${range.to}
      `.execute(db);

      let empAdjAllowance = 0;
      let empAdjDeduction = 0;
      let empAdjAssetRecoveryDeduction = 0;
      const appliedAdjIds: number[] = [];
      const vanSettlementIds: number[] = [];

      for (const adj of empAdjustmentsResult.rows) {
        let val: number;
        try {
          val = calculateDatedPayrollAdjustment({
            minorUnits: bookDigits,
            amount: Number(adj.amount),
            amountType: clean(adj.amount_type) as 'money' | 'days' | 'hours',
            date: clean(adj.adjustment_date),
            period: payRange,
            contracts: contractHistory.get(employeeId) || [],
            isHourly,
            hourlyRate: Number(employee.hourly_rate || 0),
            expectedDailyHours: Number(employee.expected_daily_hours || 8),
          });
        } catch (error) {
          throw new AppError(
            `تسوية الموظف #${employeeId} بتاريخ ${clean(adj.adjustment_date)}: ${error instanceof Error ? error.message : 'راجع نوع التسوية'}`,
            'HR_PAYROLL_DATED_ADJUSTMENT_INVALID', 409,
          );
        }

        if (clean(adj.adjustment_type) === 'allowance') {
          empAdjAllowance += val;
        } else if (clean(adj.adjustment_type) === 'deduction') {
          if (clean(adj.accounting_category) === 'asset_recovery') {
            empAdjAssetRecoveryDeduction += val;
          } else {
            empAdjDeduction += val;
          }
        }

        appliedAdjIds.push(Number(adj.id));
        if (clean(adj.source_type) === 'van_sales_settlement' && /^\d+$/.test(clean(adj.source_id))) {
          vanSettlementIds.push(Number(adj.source_id));
        }
      }

      if (appliedAdjIds.length > 0) {
        await sql`
          UPDATE hr_employee_adjustments
          SET status = 'applied', applied_in_run_id = ${runId}
          WHERE id IN (${sql.join(appliedAdjIds)})
            AND tenant_id = ${tenantId} AND employee_id = ${employeeId}
        `.execute(db);
        if (vanSettlementIds.length > 0) {
          // INV-REP-PAYROLL-TARGET-MONTH (M2, A10): the run that
          // actually applied a van-settlement deduction is written
          // back onto the settlement row, so a paid item traces to
          // its run. The push writes the targeted run; the rebuild
          // writes the run that applied it (they differ when the
          // targeted run never rebuilt the item and a later run
          // picked it up). Migration 0225 declares the column;
          // harnesses modelling the table without it skip the
          // write instead of failing the rebuild.
          const linkColumn = await sql<{ exists: boolean }>`
            SELECT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'van_rep_financial_settlements'
                AND column_name = 'payroll_run_id'
            ) AS exists
          `.execute(db);
          if (linkColumn.rows[0]?.exists === true) {
            await sql`
              UPDATE van_rep_financial_settlements
              SET payroll_run_id = ${runId}, updated_at = NOW()
              WHERE id IN (${sql.join(vanSettlementIds)}) AND tenant_id = ${tenantId}
            `.execute(db);
          }
        }
      }

      const review = autoReviews.get(employeeId);
      // Hourly base already includes only minutes actually worked. Deducting missing
      // hours again would double-charge employees; 1.5x overtime becomes a 0.5x
      // premium because the normal 1.0x is already included in the hourly base.
      const attendanceDeduction = isHourly ? 0 : Number(review?.suggestedAttendanceDeductionAmount || 0);
      const leaveDeduction = isHourly ? 0 : Number(review?.suggestedLeaveDeductionAmount || 0);
      const overtimeAllowance = isHourly
        ? calculateHourlyOvertimePremium({
            minorUnits: bookDigits,
            calculatedHourlyRate: Number(employee.hourly_rate || 0),
            overtimeMinutes: Number(review?.approvedOvertimeMinutes || 0),
            overtimeMultiplier: Number(policies.overtimeMultiplier ?? 1.5),
          })
        : Number(review?.suggestedOvertimeAllowanceAmount || 0);
      const commissionAllowance = Number(review?.suggestedCommissionAllowanceAmount || 0);
      // The source of truth for statutory amounts is the COMPLETE payroll line:
      // contractual salary + prorated compensation + manual earnings + approved
      // overtime/commission, not the attendance review's incomplete preview.
      let lineOutput: ReturnType<typeof calculateHrPayrollRunLine>;
      try {
        lineOutput = calculateHrPayrollRunLine({
          minorUnits: bookDigits,
          policy: (policies as unknown) as HrStatutoryPolicy,
          period: range,
          eligibility: {
            insured: employee.has_social_insurance === true,
            taxable: employee.has_income_tax === true,
          },
          employmentMonthFraction: Math.min(1, payrollCalendarMonthFraction(payRange.from, payRange.to)),
          configuredInsuranceSalary: Number(employee.insurance_salary || 0)
            * (policies.insuranceProratePartialEmployment === true
              ? Math.min(1, payrollCalendarMonthFraction(payRange.from, payRange.to))
              : 1),
          line: {
            employeeId,
            baseSalary,
            allowanceAmount: roundMoney(compensationAllowance + adjustments.allowance + empAdjAllowance, bookDigits),
            overtimeAmount: overtimeAllowance,
            commissionAmount: commissionAllowance,
            attendanceDeduction,
            leaveDeduction,
            assetRecoveryDeduction: roundMoney(empAdjAssetRecoveryDeduction, bookDigits),
            otherDeductions: roundMoney(compensationDeduction + adjustments.deduction + empAdjDeduction, bookDigits),
            scheduledLoanDeduction: Number(loanDeduction.amount || 0),
            maxDeductionPct,
          },
        });
      } catch (error) {
        throw new AppError(
          `تعذر حساب مرتب الموظف #${employeeId}: ${error instanceof Error ? error.message : 'راجع سياسات المرتبات'}`,
          'HR_PAYROLL_LINE_CALCULATION_INVALID', 409,
        );
      }

      const totalAllowance = roundMoney(lineOutput.allowanceAmount + lineOutput.overtimeAmount + lineOutput.commissionAmount, bookDigits);
      const penaltyDeduction = roundMoney(lineOutput.attendanceDeduction + lineOutput.leaveDeduction, bookDigits);
      const operationalDeduction = roundMoney(lineOutput.totalDeductions - lineOutput.appliedLoanDeduction - lineOutput.assetRecoveryDeduction, bookDigits);

      const generatedNotes = [
        baseSalary > 0 ? '' : (isHourly ? 'لم تُسجل ساعات حضور مكتملة في الفترة أو أجر الساعة غير محدد' : 'Missing salary data'),
        isHourly && (hourlyWorkByEmployee.get(employeeId)?.incompleteCount || 0) > 0
          ? `هناك ${hourlyWorkByEmployee.get(employeeId)!.incompleteCount} يوم حضور بدون انصراف/حضور مكتمل، لم تُحسب أجرته` : '',
        isHourly && (hourlyWorkByEmployee.get(employeeId)?.invalidCount || 0) > 0
          ? `هناك ${hourlyWorkByEmployee.get(employeeId)!.invalidCount} حركة حضور غير صحيحة تحتاج تصحيحًا` : '',
        ...loanDeduction.notes,
        lineOutput.employeeSocialInsurance > 0 ? `حصة تأمين الموظف: ${lineOutput.employeeSocialInsurance}` : '',
        lineOutput.incomeTax > 0 ? `ضريبة الدخل: ${lineOutput.incomeTax}` : '',
        ...lineOutput.notes,
      ].filter(Boolean);
      const existingCleanNotes = clean(existingItem?.notes)
        .split('|')
        .map(s => s.trim())
        .filter(s => {
          if (!s) return false;
          if (lineOutput.deferredLoanDeduction === 0 && s.includes('تم تأجيل') && s.includes('قسط السلفة')) return false;
          if (excluded && s === AUTO_PAYROLL_EXCLUSION_NOTE) return false;
          return true;
        })
        .join(' | ');
      const notes = combineNotes(existingCleanNotes, ...generatedNotes);

      if (itemId > 0) {
        await sql`
          UPDATE hr_payroll_run_items
          SET contract_id = ${toId(employee.contract_id)},
              base_salary = ${lineOutput.baseSalary},
              allowance_amount = ${totalAllowance},
              deduction_amount = ${operationalDeduction},
              loan_deduction_amount = ${lineOutput.appliedLoanDeduction},
              asset_recovery_deduction_amount = ${lineOutput.assetRecoveryDeduction},
              employee_social_insurance = ${lineOutput.employeeSocialInsurance},
              employer_social_insurance = ${lineOutput.employerSocialInsurance},
              income_tax = ${lineOutput.incomeTax},
              penalty_deduction = ${penaltyDeduction},
              carried_forward_deduction = ${lineOutput.carriedForwardDeduction},
              gross_pay = ${lineOutput.grossPay},
              net_pay = ${lineOutput.netPay},
              status = ${itemStatus},
              notes = ${notes},
              updated_at = NOW()
          WHERE id = ${itemId} AND tenant_id = ${tenantId} AND run_id = ${runId}
        `.execute(db);
      } else {
        await sql`
          INSERT INTO hr_payroll_run_items (
            run_id, employee_id, contract_id, base_salary, allowance_amount, deduction_amount,
            loan_deduction_amount, asset_recovery_deduction_amount,
            employee_social_insurance, employer_social_insurance, income_tax,
            penalty_deduction, carried_forward_deduction,
            gross_pay, net_pay, status, notes, tenant_id, account_id
          )
          VALUES (
            ${runId}, ${employeeId}, ${toId(employee.contract_id)}, ${lineOutput.baseSalary},
            ${totalAllowance}, ${operationalDeduction},
            ${lineOutput.appliedLoanDeduction}, ${lineOutput.assetRecoveryDeduction},
            ${lineOutput.employeeSocialInsurance}, ${lineOutput.employerSocialInsurance},
            ${lineOutput.incomeTax}, ${penaltyDeduction}, ${lineOutput.carriedForwardDeduction},
            ${lineOutput.grossPay}, ${lineOutput.netPay}, ${itemStatus}, ${notes}, ${tenantId}, ${accountId}
          )
        `.execute(db);
      }
    }
    await sql`UPDATE hr_payroll_runs SET updated_at = NOW() WHERE id = ${runId} AND tenant_id = ${tenantId}`.execute(db);
  }

  private async calculatePayrollOperationalReview(
    db: Kysely<Database>,
    range: { from: string; to: string },
    employeeIds: number[],
    baseSalaryByEmployeeId: Map<number, number>,
    tenantId: string,
    contractualMonthlySalary?: Map<number, number>,
    effectiveContracts?: Map<number, EffectiveSalaryContract[]>,
    minorUnits?: MoneyDigits,
  ): Promise<Map<number, any>> {
    const reviewDigits: MoneyDigits = minorUnits ?? (await tenantBookDigits(db, tenantId));
    const reviewByEmployeeId = new Map<number, any>();
    if (!employeeIds.length) return reviewByEmployeeId;

    const empResult = await sql<Record<string, unknown>>`
      SELECT e.id, e.tenant_id, e.user_id, e.compensation_type, e.hourly_rate, e.expected_daily_hours, e.commission_type, e.commission_value, e.commission_target, e.delay_policy, e.has_social_insurance, e.insurance_salary, e.has_income_tax
      FROM hr_employees e
      WHERE e.id IN (${sql.join(employeeIds)}) AND e.tenant_id = ${tenantId}
    `.execute(db);
    const empDetails = new Map<number, any>();
    for (const row of empResult.rows) empDetails.set(Number(row.id), row);

    const attendanceResult = await sql<Record<string, unknown>>`
      SELECT
        ar.employee_id,
        to_char(ar.work_date, 'YYYY-MM-DD') AS work_date_text,
        ar.status
      FROM hr_attendance_records ar
      JOIN hr_employees e ON e.id = ar.employee_id AND e.tenant_id = ar.tenant_id
      WHERE ar.employee_id IN (${sql.join(employeeIds)}) AND ar.tenant_id = ${tenantId}
        AND ar.work_date >= GREATEST(${range.from}::date, COALESCE(e.hire_date, ${range.from}::date))
        AND ar.work_date <= LEAST(${range.to}::date, COALESCE(e.end_of_service_date, ${range.to}::date))
        -- One date may appear as both 'absent' and an approved leave.
        -- Do not charge absence on the same day as an approved (paid or unpaid)
        -- leave, because unpaid leave has its own deduction and paid leave is exempt.
        AND NOT (
          ar.status = 'absent' AND EXISTS (
            SELECT 1 FROM hr_leave_requests lr
            WHERE lr.tenant_id = ar.tenant_id AND lr.employee_id = ar.employee_id
              AND lr.status = 'approved'
              AND ar.work_date BETWEEN lr.start_date AND lr.end_date
          )
        )
    `.execute(db);

    const exceptionsResult = await sql<Record<string, unknown>>`
      SELECT
        ex.employee_id,
        COALESCE(SUM(CASE WHEN exception_type IN ('late_check_in', 'short_hours') AND ex.status IN ('pending', 'approved', 'auto_calculated', 'needs_review') THEN duration_minutes ELSE 0 END), 0) AS late_minutes,
        COALESCE(SUM(CASE WHEN exception_type = 'early_check_out' AND ex.status IN ('pending', 'approved', 'auto_calculated', 'needs_review') THEN duration_minutes ELSE 0 END), 0) AS early_leave_minutes,
        COALESCE(SUM(CASE WHEN exception_type IN ('early_check_in', 'late_check_out', 'extra_hours') AND ex.status = 'approved' THEN COALESCE(approved_duration_minutes, duration_minutes) ELSE 0 END), 0) AS overtime_minutes,
        COALESCE(SUM(CASE WHEN exception_type IN ('late_check_in', 'short_hours') AND ex.status IN ('pending', 'approved', 'auto_calculated', 'needs_review') THEN 1 ELSE 0 END), 0) AS late_incidents_count,
        COALESCE(SUM(CASE WHEN exception_type = 'early_check_out' AND ex.status IN ('pending', 'approved', 'auto_calculated', 'needs_review') THEN 1 ELSE 0 END), 0) AS early_leave_incidents_count,
        COALESCE(SUM(CASE WHEN ex.status = 'needs_review' THEN 1 ELSE 0 END), 0) AS unresolved_exceptions_count
      FROM hr_attendance_exceptions ex
      JOIN hr_employees e ON e.id = ex.employee_id AND e.tenant_id = ex.tenant_id
      WHERE ex.employee_id IN (${sql.join(employeeIds)}) AND ex.tenant_id = ${tenantId}
        AND ex.work_date >= GREATEST(${range.from}::date, COALESCE(e.hire_date, ${range.from}::date))
        AND ex.work_date <= LEAST(${range.to}::date, COALESCE(e.end_of_service_date, ${range.to}::date))
        AND NOT EXISTS (
          SELECT 1 FROM hr_leave_requests lr
          WHERE lr.tenant_id = ex.tenant_id AND lr.employee_id = ex.employee_id
            AND lr.status = 'approved'
            AND ex.work_date BETWEEN lr.start_date AND lr.end_date
        )
      GROUP BY ex.employee_id
    `.execute(db);

    // Retrieve approved overtime per DAY, so salary changes within a period
    // are paid at the contract wage effective on each approved attendance day.
    // No dated history is necessary when simply displaying an older payslip.
    const datedOvertimeByEmployee = new Map<number, ApprovedOvertimeDay[]>();
    if (effectiveContracts) {
      const datedOvertime = await sql<Record<string, unknown>>`
        SELECT ex.employee_id, to_char(ex.work_date, 'YYYY-MM-DD') AS work_date_text,
          COALESCE(SUM(COALESCE(ex.approved_duration_minutes, ex.duration_minutes)), 0) AS minutes
        FROM hr_attendance_exceptions ex
        JOIN hr_employees e ON e.id = ex.employee_id AND e.tenant_id = ex.tenant_id
        WHERE ex.tenant_id = ${tenantId} AND ex.employee_id IN (${sql.join(employeeIds)})
          AND ex.status = 'approved'
          AND ex.exception_type IN ('early_check_in', 'late_check_out', 'extra_hours')
          AND ex.work_date >= GREATEST(${range.from}::date, COALESCE(e.hire_date, ${range.from}::date))
          AND ex.work_date <= LEAST(${range.to}::date, COALESCE(e.end_of_service_date, ${range.to}::date))
        GROUP BY ex.employee_id, ex.work_date
      `.execute(db);
      for (const row of datedOvertime.rows) {
        const employeeId = Number(row.employee_id);
        if (!datedOvertimeByEmployee.has(employeeId)) datedOvertimeByEmployee.set(employeeId, []);
        datedOvertimeByEmployee.get(employeeId)!.push({
          date: String(row.work_date_text),
          minutes: Number(row.minutes),
        });
      }
    }

    // Restrict approved leave days to the payroll interval. Previously a
    // leave spanning two months deducted its FULL days_count in both runs.
    const leaveDaysInRange = sql<number>`
      (COALESCE(lr.days_count, 0) * (
        GREATEST(0,
          LEAST(lr.end_date, ${range.to}::date, COALESCE(e.end_of_service_date, ${range.to}::date))
          - GREATEST(lr.start_date, ${range.from}::date, COALESCE(e.hire_date, ${range.from}::date)) + 1
        )::numeric
        / GREATEST(1, lr.end_date - lr.start_date + 1)
      ))
    `;
    const leaveResult = await sql<Record<string, unknown>>`
      SELECT
        lr.employee_id,
        COALESCE(SUM(${leaveDaysInRange}), 0) AS approved_leave_days,
        COALESCE(SUM(CASE WHEN COALESCE(lt.is_paid, TRUE) = FALSE OR LOWER(COALESCE(lt.code, '')) = 'unpaid' OR LOWER(COALESCE(lr.leave_type, '')) = 'unpaid' THEN ${leaveDaysInRange} ELSE 0 END), 0) AS unpaid_leave_days
      FROM hr_leave_requests lr
      JOIN hr_employees e ON e.id = lr.employee_id AND e.tenant_id = lr.tenant_id
      LEFT JOIN hr_leave_types lt ON lt.id = lr.leave_type_id AND lt.tenant_id = lr.tenant_id
      WHERE lr.employee_id IN (${sql.join(employeeIds)}) AND lr.tenant_id = ${tenantId}
        AND lr.status = 'approved'
        AND lr.start_date <= ${range.to}::date
        AND lr.end_date >= ${range.from}::date
      GROUP BY lr.employee_id
    `.execute(db);

    const attendanceByEmployee = new Map<number, { absent_days: number, records: any[] }>();
    for (const employeeId of employeeIds) {
      attendanceByEmployee.set(employeeId, { absent_days: 0, records: [] });
    }
    for (const row of attendanceResult.rows) {
      const empId = Number(row.employee_id || 0);
      if (attendanceByEmployee.has(empId)) {
        attendanceByEmployee.get(empId)!.records.push(row);
      }
    }

    const exceptionsByEmployee = new Map<number, Record<string, unknown>>();
    for (const row of exceptionsResult.rows) exceptionsByEmployee.set(Number(row.employee_id || 0), row);

    const leaveByEmployee = new Map<number, Record<string, unknown>>();
    for (const row of leaveResult.rows) leaveByEmployee.set(Number(row.employee_id || 0), row);

    // Fetch global settings for HR
    let hrDelayPolicyEnabled = false;
    let hrDelayPolicyFirstTime = 0;
    let hrDelayPolicySecondTime = 0;
    let hrDelayPolicyThirdTime = 0;
    let hrDelayPolicyFourthTime = 0;
    let hrCommissionType = 'none';
    let overtimeMultiplier = 1.5;
    let hrCommissionValue = 0;
    let hrCommissionTarget = 0;

    let hrWeekendDays = ['friday', 'saturday'];
    
    if (tenantId) {
      const globalPolicies = await this.getPayrollPolicies(db, tenantId);
      hrDelayPolicyEnabled = globalPolicies.hrDelayPolicyEnabled === true;
      hrDelayPolicyFirstTime = Number(globalPolicies.hrDelayPolicyFirstTimeDeduction || 0);
      hrDelayPolicySecondTime = Number(globalPolicies.hrDelayPolicySecondTimeDeduction || 0);
      hrDelayPolicyThirdTime = Number(globalPolicies.hrDelayPolicyThirdTimeDeduction || 0);
      hrDelayPolicyFourthTime = Number(globalPolicies.hrDelayPolicyFourthTimeDeduction || 0);
      hrCommissionType = globalPolicies.hrCommissionType || 'none';
      overtimeMultiplier = Number(globalPolicies.overtimeMultiplier ?? 1.5);
      if (!Number.isFinite(overtimeMultiplier) || overtimeMultiplier < 1 || overtimeMultiplier > 5) {
        throw new AppError('مضاعف العمل الإضافي يجب أن يكون بين 1 و5', 'HR_OVERTIME_MULTIPLIER_INVALID', 400);
      }
      hrCommissionValue = Number(globalPolicies.hrCommissionValue || 0);
      hrCommissionTarget = Number(globalPolicies.hrCommissionTarget || 0);
      hrWeekendDays = (globalPolicies.hrWeekendDays || 'friday,saturday').split(',').map((d: string) => d.trim().toLowerCase());
    }

    const holidaysRes = await sql<Record<string, unknown>>`
      SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date_text,
             to_char(end_date, 'YYYY-MM-DD') AS end_date_text
      FROM hr_holidays
      WHERE tenant_id = ${tenantId}
        AND start_date <= ${range.to}::date
        AND end_date >= ${range.from}::date
    `.execute(db);
    
    // DATE columns are tenant calendar dates, not instants. Never convert them
    // through the server's timezone when deciding paid holidays.
    const isHoliday = (dateStr: string) => holidaysRes.rows.some(h =>
      dateStr >= String(h.start_date_text) && dateStr <= String(h.end_date_text),
    );

    // Fetch sales grouped by user_id for the period
    const userIds = empResult.rows.map(r => Number(r.user_id)).filter(id => !isNaN(id) && id > 0);
    const salesByUser = new Map<number, number>();
    if (userIds.length > 0) {
      const salesResult = await sql<Record<string, unknown>>`
        SELECT created_by, COALESCE(SUM(total_amount), 0) AS total_sales
        FROM sales_invoices
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${range.from}::date
          -- Exclusive upper bound: exactly midnight belongs to the NEXT
          -- payroll period, not both periods (duplicate commissions).
          AND created_at < (${range.to}::date + INTERVAL '1 day')
          AND status = 'completed'
          AND created_by IN (${sql.join(userIds)})
        GROUP BY created_by
      `.execute(db);
      for (const row of salesResult.rows) {
        salesByUser.set(Number(row.created_by), Number(row.total_sales));
      }
    }

    for (const employeeId of employeeIds) {
      const attendance = attendanceByEmployee.get(employeeId) || { absent_days: 0, records: [] };
      const exceptions = exceptionsByEmployee.get(employeeId) || {};
      const leave = leaveByEmployee.get(employeeId) || {};
      const emp = empDetails.get(employeeId) || {};
      
      let attendanceAbsentDays = 0;
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      for (const rec of attendance.records) {
        if (rec.status === 'absent') {
          const dt = new Date(String(rec.work_date_text));
          const dayName = dayNames[dt.getUTCDay()];
          if (!hrWeekendDays.includes(dayName) && !isHoliday(String(rec.work_date_text))) {
            attendanceAbsentDays++;
          }
        }
      }
      const lateMinutes = Number(exceptions.late_minutes || 0);
      const earlyLeaveMinutes = Number(exceptions.early_leave_minutes || 0);
      const lateIncidents = Number(exceptions.late_incidents_count || 0);
      const earlyLeaveIncidents = Number(exceptions.early_leave_incidents_count || 0);
      const totalIncidents = lateIncidents + earlyLeaveIncidents;
      
      const overtimeMinutes = Number(exceptions.overtime_minutes || 0);
      const unresolvedExceptionsCount = Number(exceptions.unresolved_exceptions_count || 0);

      const approvedLeaveDays = Number(leave.approved_leave_days || 0);
      const unpaidLeaveDays = Number(leave.unpaid_leave_days || 0);
      
      const isHourly = (emp.compensation_type || '') === 'hourly';
      const hourlyRate = Number(emp.hourly_rate || 0);
      const expectedHours = Number(emp.expected_daily_hours || 8) || 8;
      
      const baseSalary = Number(baseSalaryByEmployeeId.get(employeeId) || 0);
      const contractedBase = Number(contractualMonthlySalary?.get(employeeId) ?? baseSalary);
      // D4: the daily rate is the monthly wage over the days of the review
      // period's calendar month — never a fixed 30. Delay/leave deductions
      // use this period rate (their incidents carry no per-day dates);
      // absence itself is priced per absent day below, at ITS month's rate.
      const dailyRate = isHourly ? (hourlyRate * expectedHours) : (contractedBase > 0 ? roundMoney(contractedBase / daysInCalendarMonth(range.from), reviewDigits) : 0);
      const calculatedHourlyRate = isHourly ? hourlyRate : (dailyRate / expectedHours);

      // Delay deduction runs through the canonical engine
      // (payroll-calculation.engine): the same tier loop and minute
      // rate the attendance preview path uses. 'strict' (half a day
      // per incident, no grace) has no engine mode and stays inline.
      let delayDeduction = 0;
      let delayPolicyMode = emp.delay_policy || 'inherit';
      if (delayPolicyMode === 'inherit') {
        delayPolicyMode = hrDelayPolicyEnabled ? 'progressive' : 'standard';
      }

      if (delayPolicyMode === 'strict') {
        // Strict: half-day deduction per incident
        delayDeduction = roundMoney(dailyRate * 0.5 * totalIncidents, reviewDigits);
      } else {
        delayDeduction = calculateProgressiveDelayDeduction({
          minorUnits: reviewDigits,
          dailyRate,
          calculatedHourlyRate,
          totalIncidents,
          totalLateMinutes: lateMinutes + earlyLeaveMinutes,
          policyMode: delayPolicyMode === 'progressive' || delayPolicyMode === 'standard'
            ? delayPolicyMode
            : 'disabled',
          tiers: {
            firstTimeDeductionDays: hrDelayPolicyFirstTime,
            secondTimeDeductionDays: hrDelayPolicySecondTime,
            thirdTimeDeductionDays: hrDelayPolicyThirdTime,
            fourthTimeDeductionDays: hrDelayPolicyFourthTime,
          },
        });
      }

      // D4: each absent day is priced at ITS calendar month's daily rate
      // (identical to the period rate for single-month reviews; correct
      // across a month boundary too). Hourly staff keep the old full-day
      // equivalent (hourly rate x expected hours) per absent day.
      let absentDeduction = 0;
      for (const rec of attendance.records) {
        if (rec.status !== 'absent') continue;
        const dt = new Date(String(rec.work_date_text));
        const dayName = dayNames[dt.getUTCDay()];
        if (hrWeekendDays.includes(dayName) || isHoliday(String(rec.work_date_text))) continue;
        absentDeduction += isHourly
          ? hourlyRate * expectedHours
          : (contractedBase > 0 ? contractedBase / daysInCalendarMonth(String(rec.work_date_text)) : 0);
      }
      const suggestedAttendanceDeductionAmount = roundMoney(absentDeduction + delayDeduction, reviewDigits);
      const suggestedLeaveDeductionAmount = roundMoney(dailyRate * unpaidLeaveDays, reviewDigits);
      let suggestedOvertimeAllowanceAmount: number;
      try {
        suggestedOvertimeAllowanceAmount = !isHourly && effectiveContracts
          ? calculateHistoricalOvertimePay(
              datedOvertimeByEmployee.get(employeeId) || [],
              effectiveContracts.get(employeeId) || [],
              expectedHours,
              overtimeMultiplier,
              reviewDigits,
            )
          : calculateOvertime({
              minorUnits: reviewDigits,
              calculatedHourlyRate, overtimeMinutes, overtimeMultiplier,
            });
      } catch (error) {
        throw new AppError(
          `تعذر احتساب إضافي الموظف #${employeeId}: ${error instanceof Error ? error.message : 'راجع العقود'}`,
          'HR_OVERTIME_EFFECTIVE_CONTRACT_INVALID', 409,
        );
      }

      // Determine Commission Allowance
      let commissionValue = 0;
      let cType = emp.commission_type || 'inherit';
      let cVal = Number(emp.commission_value || 0);
      let cTarget = Number(emp.commission_target || 0);

      if (cType === 'inherit') {
        cType = hrCommissionType;
        cVal = hrCommissionValue;
        cTarget = hrCommissionTarget;
      }

      const totalSales = salesByUser.get(Number(emp.user_id)) || 0;
      if (cType === 'percentage') {
        commissionValue = roundMoney(totalSales * (cVal / 100), reviewDigits);
      } else if (cType === 'target_percentage') {
        if (totalSales >= cTarget) {
          commissionValue = roundMoney(totalSales * (cVal / 100), reviewDigits);
        }
      } else if (cType === 'fixed') {
        commissionValue = cVal;
      }
      
      // Tax/insurance is deliberately NOT computed at attendance review stage:
      // this view does not include compensation packages and manual adjustments.
      // The canonical payroll line recalculates withholding after all earnings.
      const suggestedSocialInsuranceDeductionAmount = 0;
      const suggestedEmployerInsuranceAmount = 0;
      const suggestedIncomeTaxDeductionAmount = 0;

      let notesStr = `مراجعة: غياب ${attendanceAbsentDays} يوم.`;
      if (totalIncidents > 0) notesStr += ` (${totalIncidents}) مرات تأخير/انصراف مبكر باجمالي ${Math.floor((lateMinutes+earlyLeaveMinutes)/60)}س و${(lateMinutes+earlyLeaveMinutes)%60}د. سياسة: ${delayPolicyMode}.`;
      if (unpaidLeaveDays > 0) notesStr += ` إجازة بدون مرتب ${unpaidLeaveDays} يوم.`;
      if (overtimeMinutes > 0) notesStr += ` إضافي معتمد ${Math.floor(overtimeMinutes/60)}س و${overtimeMinutes%60}د.`;
      if (commissionValue > 0) notesStr += ` عمولة مبيعات: ${commissionValue}.`;
      if (suggestedSocialInsuranceDeductionAmount > 0) notesStr += ` تأمينات موظف: ${suggestedSocialInsuranceDeductionAmount} (منشأة: ${suggestedEmployerInsuranceAmount}).`;
      if (suggestedIncomeTaxDeductionAmount > 0) notesStr += ` ضريبة كسب عمل: ${suggestedIncomeTaxDeductionAmount}.`;

      reviewByEmployeeId.set(employeeId, {
        attendanceAbsentDays,
        attendanceLateDays: Math.floor(lateMinutes / expectedHours / 60),
        attendanceHalfDays: 0,
        attendanceEarlyLeaveDays: Math.floor(earlyLeaveMinutes / expectedHours / 60),
        approvedLeaveDays,
        unpaidLeaveDays,
        suggestedAttendanceDeductionAmount,
        suggestedLeaveDeductionAmount,
        suggestedSocialInsuranceDeductionAmount,
        suggestedEmployerInsuranceAmount,
        suggestedIncomeTaxDeductionAmount,
        suggestedOvertimeAllowanceAmount,
        suggestedCommissionAllowanceAmount: commissionValue,
        payrollReviewNotes: notesStr,
        approvedOvertimeMinutes: overtimeMinutes,
        pendingOvertimeMinutes: 0,
        unresolvedExceptionsCount,
      });
    }

    return reviewByEmployeeId;
  }

  async listPayrollRuns(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    // P8 (RC-7): the payroll page's month default comes from the server
    // clock — the list response carries it, the HR attendance list precedent.
    const tenantTimezone = await getTenantTimezone(this.db, auth.tenantId);
    const month = normalizePayrollMonth(query.month);
    const result = await sql<Record<string, unknown>>`
      SELECT
        r.*,
        to_char(r.start_date, 'YYYY-MM-DD') AS start_date_text,
        to_char(r.end_date, 'YYYY-MM-DD') AS end_date_text,
        to_char(r.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text,
        to_char(r.reviewed_at, 'YYYY-MM-DD HH24:MI') AS reviewed_at_text,
        to_char(r.approved_at, 'YYYY-MM-DD HH24:MI') AS approved_at_text,
        to_char(r.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at_text,
        COUNT(i.id) AS item_count,
        COALESCE(SUM(i.base_salary), 0) AS total_base_salary,
        COALESCE(SUM(i.allowance_amount), 0) AS total_allowance_amount,
        COALESCE(SUM(i.deduction_amount), 0) AS total_deduction_amount,
        COALESCE(SUM(i.loan_deduction_amount), 0) AS total_loan_deduction_amount,
        COALESCE(SUM(i.asset_recovery_deduction_amount), 0) AS total_asset_recovery_deduction_amount,
        COALESCE(SUM(i.employee_social_insurance), 0) AS total_employee_social_insurance,
        COALESCE(SUM(i.employer_social_insurance), 0) AS total_employer_social_insurance,
        COALESCE(SUM(i.income_tax), 0) AS total_income_tax,
        COALESCE(SUM(i.penalty_deduction), 0) AS total_penalty_deduction,
        COALESCE(SUM(i.carried_forward_deduction), 0) AS total_carried_forward_deduction,
        COALESCE(SUM(i.gross_pay), 0) AS total_gross_pay,
        COALESCE(SUM(i.net_pay), 0) AS total_net_pay
      FROM hr_payroll_runs r
      LEFT JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id AND i.status <> 'excluded'
      WHERE r.tenant_id = ${auth.tenantId} AND (${month} = '' OR r.period_month = ${month})
      GROUP BY r.id
      ORDER BY r.period_month DESC, r.id DESC
    `.execute(this.db);
    const runs = result.rows.map((row) => this.mapPayrollRun(row));
    const paged = paginateRows(runs, query, { defaultSize: 25 });
    // P8 (RC-7): the payroll page's month default comes from the server clock.
    return { runs: paged.rows, pagination: paged.pagination, summary: { totalItems: runs.length }, serverTime: new Date().toISOString(), serverTimezone: tenantTimezone };
  }

  async getPayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const runResult = await sql<Record<string, unknown>>`
      SELECT
        r.*,
        to_char(r.start_date, 'YYYY-MM-DD') AS start_date_text,
        to_char(r.end_date, 'YYYY-MM-DD') AS end_date_text,
        to_char(r.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text,
        to_char(r.reviewed_at, 'YYYY-MM-DD HH24:MI') AS reviewed_at_text,
        to_char(r.approved_at, 'YYYY-MM-DD HH24:MI') AS approved_at_text,
        to_char(r.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at_text,
        COUNT(i.id) AS item_count,
        COALESCE(SUM(i.base_salary), 0) AS total_base_salary,
        COALESCE(SUM(i.allowance_amount), 0) AS total_allowance_amount,
        COALESCE(SUM(i.deduction_amount), 0) AS total_deduction_amount,
        COALESCE(SUM(i.loan_deduction_amount), 0) AS total_loan_deduction_amount,
        COALESCE(SUM(i.asset_recovery_deduction_amount), 0) AS total_asset_recovery_deduction_amount,
        COALESCE(SUM(i.employee_social_insurance), 0) AS total_employee_social_insurance,
        COALESCE(SUM(i.employer_social_insurance), 0) AS total_employer_social_insurance,
        COALESCE(SUM(i.income_tax), 0) AS total_income_tax,
        COALESCE(SUM(i.penalty_deduction), 0) AS total_penalty_deduction,
        COALESCE(SUM(i.carried_forward_deduction), 0) AS total_carried_forward_deduction,
        COALESCE(SUM(i.gross_pay), 0) AS total_gross_pay,
        COALESCE(SUM(i.net_pay), 0) AS total_net_pay
      FROM hr_payroll_runs r
      LEFT JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id AND i.status <> 'excluded'
      WHERE r.id = ${id} AND r.tenant_id = ${tenantId}
      GROUP BY r.id
      LIMIT 1
    `.execute(this.db);
    const run = runResult.rows[0];
    if (!run) throw new AppError('Payroll run not found', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
    const itemResult = await sql<Record<string, unknown>>`
      SELECT
        i.*,
        e.display_name AS employee_name,
        e.employee_no,
        e.compensation_type,
        e.hourly_rate,
        e.expected_daily_hours,
        to_char(i.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text,
        to_char(i.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at_text
      FROM hr_payroll_run_items i
      JOIN hr_employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
      WHERE i.run_id = ${id} AND i.tenant_id = ${tenantId}
      ORDER BY e.display_name ASC, i.id ASC
    `.execute(this.db);
    const periodMonth = clean(run.period_month);
    const employeeIds = itemResult.rows.map((row) => Number(row.employee_id || 0)).filter((value) => value > 0);
    const baseSalaryByEmployeeId = new Map<number, number>();
    for (const row of itemResult.rows) {
      const employeeId = Number(row.employee_id || 0);
      if (!(employeeId > 0)) continue;
      baseSalaryByEmployeeId.set(employeeId, Number(row.base_salary || 0));
    }
    const fromDate = String(run.start_date_text || `${periodMonth}-01`);
    const toDate = String(run.end_date_text || new Date(Date.UTC(Number(periodMonth.split('-')[0]), Number(periodMonth.split('-')[1]), 0)).toISOString().slice(0, 10));
    const range = { from: fromDate, to: toDate };
    // An approved/paid payslip is an immutable financial snapshot. Its presentation
    // must not be recomputed using current (possibly newer) tax, leave or attendance
    // policies, which can change independently after approval.
    const reviewByEmployeeId = ['approved', 'paid', 'partially_paid'].includes(clean(run.status))
      ? new Map<number, any>()
      : await this.calculatePayrollOperationalReview(this.db, range, employeeIds, baseSalaryByEmployeeId, tenantId);
    const itemIds = itemResult.rows.map((row) => Number(row.id || 0)).filter((itemId) => itemId > 0);
    const adjustmentResult = itemIds.length
      ? await sql<Record<string, unknown>>`
          SELECT a.*, to_char(a.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text
          FROM hr_payroll_item_adjustments a
          WHERE a.payroll_item_id IN (${sql.join(itemIds)}) AND a.tenant_id = ${tenantId}
          ORDER BY a.id ASC
        `.execute(this.db)
      : { rows: [] };
    const adjustmentsByItem = new Map<string, Record<string, unknown>[]>();
    for (const adjustment of adjustmentResult.rows) {
      const key = String(adjustment.payroll_item_id);
      adjustmentsByItem.set(key, [...(adjustmentsByItem.get(key) || []), this.mapPayrollAdjustment(adjustment)]);
    }
    const items = itemResult.rows.map((row) => {
      const employeeId = Number(row.employee_id || 0);
      const review = reviewByEmployeeId.get(employeeId);
      return {
        ...this.mapPayrollItem(row),
        attendanceAbsentDays: review?.attendanceAbsentDays ?? 0,
        attendanceLateDays: review?.attendanceLateDays ?? 0,
        attendanceHalfDays: review?.attendanceHalfDays ?? 0,
        attendanceEarlyLeaveDays: review?.attendanceEarlyLeaveDays ?? 0,
        approvedLeaveDays: review?.approvedLeaveDays ?? 0,
        unpaidLeaveDays: review?.unpaidLeaveDays ?? 0,
        suggestedAttendanceDeductionAmount: review?.suggestedAttendanceDeductionAmount ?? 0,
        suggestedLeaveDeductionAmount: review?.suggestedLeaveDeductionAmount ?? 0,
        payrollReviewNotes: review?.payrollReviewNotes || '',
        unresolvedExceptionsCount: review?.unresolvedExceptionsCount || 0,
        adjustments: adjustmentsByItem.get(String(row.id)) || [],
      };
    });
    return { run: { ...this.mapPayrollRun(run), items } };
  }

  async createPayrollRun(payload: CreatePayrollRunDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const periodMonth = normalizePayrollMonth(payload.periodMonth);
    if (!periodMonth) throw new AppError('Payroll month must use YYYY-MM format', 'HR_PAYROLL_MONTH_INVALID', 400);
    const payFreq = clean(payload.payFrequency) || 'monthly';
    if (!['daily', 'weekly', 'biweekly', 'monthly', 'all'].includes(payFreq)) {
      throw new AppError('دورية صرف المرتب غير صحيحة', 'HR_PAYROLL_FREQUENCY_INVALID', 400);
    }
    const month = monthRange(periodMonth);
    const startDate = payload.startDate ? normalizeDateOnly(payload.startDate) : month.from;
    const endDate = payload.endDate ? normalizeDateOnly(payload.endDate) : month.to;
    const periodLengthDays = startDate && endDate
      ? Math.floor((Date.parse(endDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) / 86400000)
      : NaN;
    if (!startDate || !endDate || !Number.isFinite(periodLengthDays) || periodLengthDays < 0 || periodLengthDays > 366) {
      throw new AppError('اختر تاريخ بداية ونهاية صحيحين لفترة القبض', 'HR_PAYROLL_PERIOD_INVALID', 400);
    }

    let runId = 0;
    await this.tx.runInTransaction(this.db, async (trx) => {
      // The old month-only uniqueness silently reused a WEEKLY run for every
      // subsequent week. Serialize overlapping period checks within tenant/frequency.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const overlapping = await sql<{
        id: number; status: string; period_month: string; pay_frequency: string;
        start_date_text: string; end_date_text: string;
      }>`
        SELECT id, status, period_month, pay_frequency,
          to_char(start_date, 'YYYY-MM-DD') AS start_date_text,
          to_char(end_date, 'YYYY-MM-DD') AS end_date_text
        FROM hr_payroll_runs
        WHERE tenant_id = ${tenantId}
          AND status <> 'cancelled'
          AND start_date <= ${endDate}::date
          AND end_date >= ${startDate}::date
          AND (
            pay_frequency = ${payFreq}
            OR pay_frequency = 'all'
            OR ${payFreq} = 'all'
            OR EXISTS (
              SELECT 1 FROM hr_payroll_run_items prior_item
              JOIN hr_employees eligible
                ON eligible.id = prior_item.employee_id AND eligible.tenant_id = prior_item.tenant_id
              WHERE prior_item.run_id = hr_payroll_runs.id
                AND prior_item.tenant_id = hr_payroll_runs.tenant_id
                AND prior_item.status <> 'excluded'
                AND COALESCE(eligible.pay_frequency, 'monthly') = ${payFreq}
            )
          )
        ORDER BY id DESC
        FOR UPDATE
      `.execute(trx);

      if (overlapping.rows.some(row => row.pay_frequency !== payFreq)) {
        throw new AppError(
          'لا يمكن إنشاء مسير بدورية مختلفة يغطي أيام موظفين موجودين في مسير آخر؛ راجع المسير المتداخل',
          'HR_PAYROLL_CROSS_FREQUENCY_OVERLAP', 409,
        );
      }
      if (overlapping.rows.some(row => row.start_date_text !== startDate || row.end_date_text !== endDate)) {
        throw new AppError('يوجد كشف مرتبات آخر يتداخل مع هذه الفترة. اختر فترة غير متداخلة لمنع تكرار الصرف.', 'HR_PAYROLL_PERIOD_OVERLAP', 409);
      }
      const existing = overlapping.rows[0];
      if (existing) {
        if (existing.period_month !== periodMonth) {
          throw new AppError('هذه الفترة موجودة بالفعل تحت شهر مرتب مختلف', 'HR_PAYROLL_MONTH_CONFLICT', 409);
        }
        if (existing.status === 'paid') {
          throw new AppError('مسير الرواتب لهذه الفترة تم صرفه وإغلاقه بالفعل', 'HR_PAYROLL_ALREADY_PAID', 400);
        }
        if (existing.status === 'approved') {
          throw new AppError('مسير الرواتب لهذه الفترة معتمد وجاهز للصرف', 'HR_PAYROLL_ALREADY_APPROVED', 400);
        }
        runId = Number(existing.id);
      } else {
        const inserted = await sql<{ id: number }>`
          INSERT INTO hr_payroll_runs (tenant_id, account_id, period_month, start_date, end_date, pay_frequency, status, notes, created_by)
          VALUES (${tenantId}, ${auth.accountId}, ${periodMonth}, ${startDate}::date, ${endDate}::date, ${payFreq}, 'draft', ${clean(payload.notes)}, ${auth.userId})
          RETURNING id
        `.execute(trx);
        runId = Number(inserted.rows[0]?.id || 0);
        await this.rebuildPayrollRunItems(trx, runId, 'draft', auth.tenantId || '');
      }
    });
    await this.audit.log('Create HR payroll run', `Payroll ${periodMonth} [${startDate}..${endDate}] prepared by ${auth.username}`, auth);
    return this.getPayrollRun(runId, auth);
  }

  /** A late hire inserted after review changes payroll's eligible employee
   * population. Serialize both HR employee writers and payroll review/approve
   * against the tenant payroll advisory lock BEFORE calling this helper.
   */
  private async invalidateReviewedPayrollForNewHire(
    db: Kysely<Database>, tenantId: string, hireDate: string, payFrequency: string,
  ): Promise<void> {
    const reviewed = await sql<{ id: number }>`
      SELECT id FROM hr_payroll_runs
      WHERE tenant_id = ${tenantId} AND status = 'reviewed'
        AND start_date <= ${hireDate}::date AND end_date >= ${hireDate}::date
        AND (pay_frequency = 'all' OR pay_frequency = ${payFrequency})
      FOR UPDATE
    `.execute(db);
    for (const run of reviewed.rows) {
      await this.invalidatePayrollRunReview(db, Number(run.id), tenantId);
    }
  }

  /** Financial recalculation invalidates the former review approval.
   * Call only inside the run's locked transaction, AFTER rebuilding its items.
   */
  private async invalidatePayrollRunReview(db: Kysely<Database>, runId: number, tenantId: string): Promise<void> {
    await sql`
      UPDATE hr_payroll_run_items SET status = 'draft', updated_at = NOW()
      WHERE run_id = ${runId} AND tenant_id = ${tenantId} AND status = 'reviewed'
    `.execute(db);
    await sql`
      UPDATE hr_payroll_runs
      SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL, updated_at = NOW()
      WHERE id = ${runId} AND tenant_id = ${tenantId} AND status = 'reviewed'
    `.execute(db);
  }

  async recalculatePayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const status = await this.getPayrollRunStatusForUpdate(trx, id, auth.tenantId || '');
      if (status !== 'draft' && status !== 'reviewed') throw new AppError('Only draft or reviewed payroll runs can be recalculated', 'HR_PAYROLL_RECALCULATE_LOCKED', 400);
      await this.rebuildPayrollRunItems(trx, id, 'draft', auth.tenantId || '');
      if (status === 'reviewed') {
        await this.invalidatePayrollRunReview(trx, id, auth.tenantId || '');
      }
    });
    await this.audit.log('Recalculate HR payroll run', `Payroll run #${id} recalculated by ${auth.username}`, auth);
    return this.getPayrollRun(id, auth);
  }

  async applyAttendanceDeductions(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const status = await this.getPayrollRunStatusForUpdate(trx, id, tenantId);
      if (status !== 'draft' && status !== 'reviewed') {
        throw new AppError('Only draft or reviewed payroll runs can be recalculated', 'HR_PAYROLL_APPLY_DEDUCTIONS_LOCKED', 400);
      }
      // Legacy versions inserted the same attendance/insurance/tax deductions twice.
      // Remove ONLY these auto-generated adjustments; keep human-entered adjustments.
      await sql`
        DELETE FROM hr_employee_adjustments
        WHERE tenant_id = ${tenantId} AND applied_in_run_id = ${id}
          AND (reason LIKE 'تسوية تلقائية من مراجعة المرتبات:%'
            OR reason IN ('حصة الموظف في التأمينات الاجتماعية', 'ضريبة كسب العمل'))
      `.execute(trx);
      // The canonical payroll engine already includes all approved operational deductions.
      await this.rebuildPayrollRunItems(trx, id, 'draft', auth.tenantId || tenantId);
      if (status === 'reviewed') {
        await this.invalidatePayrollRunReview(trx, id, tenantId);
      }
    });
    await this.audit.log('Recalculate HR payroll deductions', `Payroll run #${id} recalculated by ${auth.username}`, auth);
    return this.getPayrollRun(id, auth);
  }

  async reviewPayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const status = await this.getPayrollRunStatusForUpdate(trx, id, auth.tenantId || '');
      if (status !== 'draft' && status !== 'reviewed') {
        throw new AppError('Only draft or reviewed payroll runs can be reviewed', 'HR_PAYROLL_REVIEW_LOCKED', 400);
      }
      // A reviewed run can be re-reviewed after a statutory rule or attendance
      // correction; all items are recalculated against current approved inputs.
      await this.rebuildPayrollRunItems(trx, id, status, auth.tenantId || '');

      await sql`UPDATE hr_payroll_run_items SET status = 'reviewed', updated_at = NOW() WHERE run_id = ${id} AND status = 'draft' AND tenant_id = ${auth.tenantId}`.execute(trx);
      await sql`UPDATE hr_payroll_runs SET status = 'reviewed', reviewed_by = ${auth.userId}, reviewed_at = NOW(), updated_at = NOW() WHERE id = ${id} AND tenant_id = ${auth.tenantId}`.execute(trx);
    });
    await this.audit.log('Review HR payroll run', `Payroll run #${id} reviewed by ${auth.username}`, auth);
    return this.getPayrollRun(id, auth);
  }

  private async settlePayrollLoanDeductions(trx: Kysely<Database>, runId: number, auth: AuthContext): Promise<void> {
    const { tenantId } = requireTenantScope(auth);
    const payrollPeriod = await sql<{ end_date: string }>`
      SELECT to_char(end_date, 'YYYY-MM-DD') AS end_date
      FROM hr_payroll_runs WHERE id = ${runId} AND tenant_id = ${tenantId} LIMIT 1
    `.execute(trx);
    const dueCutoff = payrollPeriod.rows[0]?.end_date;
    if (!dueCutoff) throw new AppError('مسير المرتبات غير موجود', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
    const items = await trx
      .selectFrom('hr_payroll_run_items')
      .select(['id', 'employee_id', 'loan_deduction_amount'])
      .where('run_id', '=', runId)
      .where('tenant_id', '=', auth.tenantId || '')
      .where('status', '=', 'reviewed')
      .where('loan_deduction_amount', '>', 0)
      .execute();

    const settleBookDigits = await tenantBookDigits(trx, tenantId);
    for (const item of items) {
      let remainingToDeduct = Number(item.loan_deduction_amount);
      if (remainingToDeduct <= 0) continue;

      const installments = await sql<Record<string, unknown>>`
        SELECT
          i.id AS installment_id,
          i.loan_id,
          i.amount,
          i.paid_amount,
          l.remaining_amount AS loan_remaining
        FROM hr_employee_loan_installments i
        JOIN hr_employee_loans l ON l.id = i.loan_id AND l.tenant_id = i.tenant_id
        WHERE l.employee_id = ${item.employee_id}
          AND l.tenant_id = ${tenantId}
          AND l.repayment_mode IN ('deduct_next_salary', 'monthly_salary_installment')
          AND l.status IN ('paid', 'partially_repaid', 'disbursed')
          AND GREATEST(l.issue_date, COALESCE(l.disbursed_at::date, l.issue_date)) <= ${dueCutoff}::date
          AND COALESCE(i.status, 'pending') IN ('pending', 'partial')
          AND (
            l.repayment_mode = 'deduct_next_salary'
            OR COALESCE(i.due_date, l.first_due_date, l.salary_due_date) <= ${dueCutoff}::date
          )
        ORDER BY COALESCE(i.due_date, l.first_due_date, l.salary_due_date) ASC, i.installment_no ASC, l.id ASC
        FOR UPDATE
      `.execute(trx);

      for (const row of installments.rows) {
        if (remainingToDeduct <= 0) break;

        // رصيد القرض يُقرأ **حديثاً** في كل دورة، لا من لقطة الاستعلام: خصم شهر
        // واحد قد يغطي قسطين من نفس القرض، وكان `remaining_amount` يُحسب في
        // الدورة الثانية من القيمة القديمة (بينما `paid_amount` يُقرأ حديثاً)،
        // فيختل تصالح المسدَّد مع المتبقي ويظل القرض مديناً بعد سداده كاملاً،
        // ويفقد سقف `min(..., loanRemaining)` معناه فيسمح بخصم زائد.
        const loanStateRaw = await sql<Record<string, unknown>>`
          SELECT paid_amount, remaining_amount FROM hr_employee_loans WHERE id = ${row.loan_id} AND tenant_id = ${tenantId}
        `.execute(trx);
        const loanState = loanStateRaw.rows[0];

        const allocation = allocateLoanDeduction({
          remainingToDeduct,
          installmentAmount: Number(row.amount),
          installmentPaid: Number(row.paid_amount),
          loanRemaining: Number(loanState?.remaining_amount ?? 0),
          loanPaid: Number(loanState?.paid_amount ?? 0),
          minorUnits: settleBookDigits,
        });
        if (!allocation) continue;

        const {
          deductAmount,
          newInstallmentPaid,
          newInstallmentStatus,
          newLoanRemaining,
          newLoanPaid,
          newLoanStatus,
        } = allocation;
        remainingToDeduct = allocation.remainingToDeductAfter;

        await sql`
          UPDATE hr_employee_loans
          SET paid_amount = ${newLoanPaid}, remaining_amount = ${newLoanRemaining}, status = ${newLoanStatus}, updated_at = NOW()
          WHERE id = ${row.loan_id} AND tenant_id = ${tenantId}
        `.execute(trx);

        await sql`
          UPDATE hr_employee_loan_installments
          SET paid_amount = ${newInstallmentPaid}, status = ${newInstallmentStatus}, updated_at = NOW()
          WHERE id = ${row.installment_id} AND tenant_id = ${tenantId}
        `.execute(trx);

        const allocRes = await sql<Record<string, unknown>>`
          INSERT INTO hr_payroll_loan_deduction_allocations (
            tenant_id, account_id, payroll_run_id, payroll_run_item_id, employee_id, loan_id, installment_id, amount, created_by, created_at
          ) VALUES (
            ${auth.tenantId}, ${auth.accountId}, ${runId}, ${item.id}, ${item.employee_id}, ${row.loan_id}, ${row.installment_id}, ${deductAmount}, ${auth.userId}, NOW()
          ) RETURNING id
        `.execute(trx);
        const allocId = allocRes.rows[0]?.id;

        const ledgerRes = await sql<Record<string, unknown>>`
          INSERT INTO hr_employee_ledger (
            tenant_id, account_id, employee_id, entry_type, amount, balance_after, note, repayment_method, reference_type, reference_id, created_by, created_at
          ) VALUES (
            ${auth.tenantId}, ${auth.accountId}, ${item.employee_id}, 'loan_repayment', ${-deductAmount}, ${newLoanRemaining}, 'Payroll Salary Deduction', 'salary_deduction', 'hr_payroll_loan_deduction', ${allocId}, ${auth.userId}, NOW()
          ) RETURNING id
        `.execute(trx);
        const ledgerId = ledgerRes.rows[0]?.id;

        await sql`
          UPDATE hr_payroll_loan_deduction_allocations SET ledger_id = ${ledgerId}
          WHERE id = ${allocId} AND tenant_id = ${tenantId}
        `.execute(trx);
      }

      if (remainingToDeduct > 0.01) {
        throw new AppError('Unable to allocate the full loan deduction amount for employee. Balances do not match.', 'HR_PAYROLL_LOAN_ALLOCATION_MISMATCH', 400);
      }
    }
  }

  async approvePayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async (trx) => {
      // Lock order matches run creation: tenant-wide payroll lock BEFORE row lock.
      // Weekly, monthly and all-employees runs cannot approve the same person twice.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const status = await this.getPayrollRunStatusForUpdate(trx, id, auth.tenantId || '');
      if (status !== 'reviewed') throw new AppError('Only reviewed payroll runs can be approved', 'HR_PAYROLL_APPROVE_LOCKED', 400);

      // Serialize statutory policy edits with approval/posting. The same lock
      // is held by updatePayrollPolicies; no update can slip between the policy
      // verification below and the committed ledger journal.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-policy:' + auth.tenantId}))`.execute(trx);
      // HR must maintain legal sources and residency/employee exemptions.
      const policies = await this.getPayrollPolicies(trx, auth.tenantId || '');
      const unconfiguredEmployee = await sql<{ display_name: string }>`
        SELECT e.display_name
        FROM hr_payroll_run_items i
        JOIN hr_employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
        WHERE i.run_id = ${id} AND i.tenant_id = ${auth.tenantId} AND i.status = 'reviewed'
          AND (
            (e.has_income_tax = TRUE AND ${policies.hrIncomeTaxEnabled !== true})
            OR (e.has_social_insurance = TRUE AND ${policies.hrSocialInsuranceEnabled !== true})
          )
        LIMIT 1
      `.execute(trx);
      if (unconfiguredEmployee.rows.length) {
        throw new AppError(
          `الموظف ${unconfiguredEmployee.rows[0].display_name} عليه استقطاعات نظامية ولكن تم تعطيل سياسة احتسابها`,
          'HR_PAYROLL_EMPLOYEE_STATUTORY_DISABLED', 409,
        );
      }
      const payrollPeriod = await sql<{ start_date: string; end_date: string }>`
        SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date,
               to_char(end_date, 'YYYY-MM-DD') AS end_date
        FROM hr_payroll_runs WHERE id = ${id} AND tenant_id = ${auth.tenantId} LIMIT 1
      `.execute(trx);
      const period = payrollPeriod.rows[0];
      if (!period) throw new AppError('مسير الرواتب غير موجود', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
      try {
        const hasStatutoryDeductions = Boolean(policies.hrSocialInsuranceEnabled || policies.hrIncomeTaxEnabled);
        validateHrStatutoryPolicy((policies as unknown) as HrStatutoryPolicy, {
          from: period.start_date,
          to: period.end_date,
        }, hasStatutoryDeductions);
        if (hasStatutoryDeductions) {
          const currencyRows = await sql<{ value: string }>`
            SELECT value FROM settings WHERE tenant_id = ${auth.tenantId} AND key = 'currency' LIMIT 1
          `.execute(trx);
          const tenantCurrency = clean(currencyRows.rows[0]?.value).replace(/^"|"$/g, '');
          requireHrPayrollJurisdictionCurrency(policies.statutoryCountry, tenantCurrency);
        }
      } catch (error) {
        throw new AppError(
          error instanceof Error ? error.message : 'قواعد الضرائب والتأمينات غير معتمدة',
          'HR_PAYROLL_STATUTORY_RULES_UNVERIFIED', 409,
        );
      }
      // A reviewer must re-review changed statutory settings rather than approve
      // totals calculated against an earlier rule version.
      const policyChangedAfterReview = await sql<{ stale: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM hr_hr_settings s
          JOIN hr_payroll_runs r ON r.tenant_id = s.tenant_id
          WHERE r.id = ${id} AND r.tenant_id = ${auth.tenantId}
            AND s.key = 'payroll_policies'
            AND s.updated_at > r.reviewed_at
        ) AS stale
      `.execute(trx);
      if (policyChangedAfterReview.rows[0]?.stale) {
        throw new AppError(
          'تم تغيير سياسات الاستقطاعات بعد مراجعة الكشف؛ أعد مراجعة المرتبات قبل الاعتماد',
          'HR_PAYROLL_POLICY_CHANGED_AFTER_REVIEW', 409,
        );
      }
      const duplicatePay = await sql<{ display_name: string }>`
        SELECT e.display_name
        FROM hr_payroll_run_items current_item
        JOIN hr_payroll_runs current_run ON current_run.id = current_item.run_id
          AND current_run.tenant_id = current_item.tenant_id
        JOIN hr_payroll_run_items prior_item ON prior_item.employee_id = current_item.employee_id
          AND prior_item.tenant_id = current_item.tenant_id
          AND prior_item.run_id <> current_item.run_id AND prior_item.status <> 'excluded'
        JOIN hr_payroll_runs prior_run ON prior_run.id = prior_item.run_id
          AND prior_run.tenant_id = prior_item.tenant_id
        JOIN hr_employees e ON e.id = current_item.employee_id
          AND e.tenant_id = current_item.tenant_id
        WHERE current_item.run_id = ${id} AND current_item.tenant_id = ${auth.tenantId}
          AND current_item.status = 'reviewed'
          AND prior_run.status <> 'cancelled'
          AND prior_run.start_date <= current_run.end_date
          AND prior_run.end_date >= current_run.start_date
        LIMIT 5
      `.execute(trx);
      if (duplicatePay.rows.length) {
        throw new AppError(
          `الموظف/الموظفون ${duplicatePay.rows.map(r => r.display_name).join('، ')} مدرجون في مسير متداخل؛ امنع صرف نفس الأيام مرتين`,
          'HR_PAYROLL_EMPLOYEE_PERIOD_COLLISION', 409,
        );
      }
      // Never post/settle a payroll that silently contains only zero wages.
      // A zero-wage employee with no punches can be legitimate; a completely
      // empty payable run must be corrected or deliberately excluded first.
      const wageSummary = await sql<{ count: string; total: string }>`
        SELECT COUNT(*)::text AS count,
          COALESCE(SUM(gross_pay), 0)::text AS total
        FROM hr_payroll_run_items
        WHERE run_id = ${id} AND tenant_id = ${auth.tenantId} AND status = 'reviewed'
      `.execute(trx);
      if (Number(wageSummary.rows[0]?.count || 0) === 0 || Number(wageSummary.rows[0]?.total || 0) <= 0) {
        throw new AppError('لا يمكن اعتماد كشف مرتبات فارغ أو جميع أجوره صفر. راجع الأجر والعقود والحضور أولًا.', 'HR_PAYROLL_ZERO_WAGES', 400);
      }
      // A single employee must never be silently included with an undefined
      // rate/contract while another employee makes the overall run non-zero.
      const missingRates = await sql<{ display_name: string }>`
        SELECT e.display_name
        FROM hr_payroll_run_items i
        JOIN hr_employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        WHERE i.run_id = ${id} AND i.tenant_id = ${auth.tenantId}
          AND i.status = 'reviewed'
          AND (
            (e.compensation_type = 'hourly' AND COALESCE(e.hourly_rate, 0) <= 0)
            OR (e.compensation_type <> 'hourly' AND NOT EXISTS (
              SELECT 1 FROM hr_employment_contracts c
              WHERE c.employee_id = e.id AND c.tenant_id = e.tenant_id
                AND c.status IN ('active', 'ended') AND c.base_salary > 0
                AND c.start_date <= r.end_date
                AND (c.end_date IS NULL OR c.end_date >= r.start_date)
            ))
          )
        LIMIT 5
      `.execute(trx);
      if (missingRates.rows.length) {
        const names = missingRates.rows.map(row => String(row.display_name)).join('، ');
        throw new AppError(`يوجد موظفون بدون أجر ساعة أو عقد براتب نشط وصحيح: ${names}`, 'HR_PAYROLL_MISSING_EMPLOYEE_RATES', 400);
      }
      // Hourly base salary counts only completed punches. An unclosed or
      // malformed paid work session must never be silently omitted at approval.
      const invalidHourlyPunch = await sql<{ display_name: string }>`
        SELECT DISTINCT e.display_name
        FROM hr_payroll_run_items i
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        JOIN hr_employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
        JOIN hr_attendance_records a ON a.employee_id = e.id AND a.tenant_id = e.tenant_id
        WHERE i.run_id = ${id} AND i.tenant_id = ${auth.tenantId}
          AND i.status = 'reviewed' AND e.compensation_type = 'hourly'
          AND a.work_date BETWEEN GREATEST(r.start_date, COALESCE(e.hire_date, r.start_date))
              AND LEAST(r.end_date, COALESCE(e.end_of_service_date, r.end_date))
          AND a.status NOT IN ('absent', 'leave')
          AND (
            (a.check_in_at IS NULL AND a.check_out_at IS NOT NULL)
            OR (a.check_in_at IS NOT NULL AND a.check_out_at IS NULL)
            OR (a.check_in_at IS NOT NULL AND a.check_out_at IS NOT NULL
              AND (a.check_out_at <= a.check_in_at OR a.check_out_at > a.check_in_at + INTERVAL '24 hours'))
          )
        LIMIT 5
      `.execute(trx);
      if (invalidHourlyPunch.rows.length) {
        throw new AppError(
          `يوجد دوام ساعات غير مكتمل أو غير صالح للموظفين: ${invalidHourlyPunch.rows.map(r => r.display_name).join('، ')}؛ صحح الحضور قبل اعتماد المرتبات`,
          'HR_PAYROLL_HOURLY_PUNCH_UNRESOLVED', 409,
        );
      }
      // A reviewed payroll still cannot be approved with disputed attendance.
      const pendingAttendance = await sql<{ pending: string }>`
        SELECT COUNT(*)::text AS pending
        FROM hr_attendance_exceptions ex
        JOIN hr_payroll_run_items item
          ON item.employee_id = ex.employee_id AND item.tenant_id = ex.tenant_id
          AND item.run_id = ${id} AND item.status = 'reviewed'
        JOIN hr_payroll_runs run ON run.id = item.run_id AND run.tenant_id = item.tenant_id
        WHERE ex.tenant_id = ${auth.tenantId}
          AND ex.status IN ('pending', 'needs_review')
          AND ex.work_date BETWEEN run.start_date AND run.end_date
      `.execute(trx);
      if (Number(pendingAttendance.rows[0]?.pending || 0) > 0) {
        throw new AppError(
          `يوجد ${pendingAttendance.rows[0].pending} استثناء حضور أو تأخير يحتاج مراجعة قبل اعتماد المرتبات`,
          'HR_PAYROLL_ATTENDANCE_PENDING', 400,
        );
      }
      // A reviewer approves a concrete financial snapshot, not an arbitrary
      // historic cached amount. Rebuild the SAME payroll engine under the run
      // row lock, and reject if a salary, contract, attendance, loan or
      // adjustment has changed since the review. A thrown error rolls back
      // all temporary recalculation changes including adjustment status.
      const reviewSnapshot = async () => {
        const snapshot = await sql<Record<string, unknown>>`
          SELECT employee_id, status, contract_id, base_salary, allowance_amount,
                 deduction_amount, loan_deduction_amount,
                 asset_recovery_deduction_amount, employee_social_insurance,
                 employer_social_insurance, income_tax, penalty_deduction,
                 carried_forward_deduction, gross_pay, net_pay
          FROM hr_payroll_run_items
          WHERE run_id = ${id} AND tenant_id = ${auth.tenantId}
          ORDER BY employee_id ASC
        `.execute(trx);
        return JSON.stringify(snapshot.rows);
      };
      const reviewedAmounts = await reviewSnapshot();
      await this.rebuildPayrollRunItems(trx, id, 'reviewed', auth.tenantId || '');
      const recalculatedAmounts = await reviewSnapshot();
      if (reviewedAmounts !== recalculatedAmounts) {
        throw new AppError(
          'تغيرت بيانات المرتبات أو الحضور أو السلف بعد المراجعة؛ يجب إعادة مراجعة الكشف قبل الاعتماد النهائي',
          'HR_PAYROLL_REVIEW_STALE', 409,
        );
      }

      // A loan's unpaid part remains in installments and will be due in a
      // future payroll. By contrast, carried_forward_deduction contains
      // attendance/leave/asset/other reductions with NO durable receivable
      // or next-run replay. Approval must fail instead of silently writing off
      // that remainder under an apparently "carried forward" label.
      const untrackedDeferred = await sql<{ employee_id: number; amount: string }>`
        SELECT employee_id, carried_forward_deduction::text AS amount
        FROM hr_payroll_run_items
        WHERE run_id = ${id} AND tenant_id = ${auth.tenantId}
          AND status = 'reviewed' AND carried_forward_deduction > 0
        LIMIT 1
      `.execute(trx);
      if (untrackedDeferred.rows.length) {
        const row = untrackedDeferred.rows[0];
        throw new AppError(
          `الموظف #${row.employee_id} عليه استقطاعات مؤجلة بقيمة ${row.amount} لا توجد آلية آمنة لترحيلها تلقائيًا؛ يلزم تسوية معتمدة قبل اعتماد المسير`,
          'HR_PAYROLL_UNTRACKED_CARRIED_FORWARD', 409,
        );
      }
      await this.settlePayrollLoanDeductions(trx, id, auth);

      const { posted } = await this.accountingPosting.postPayrollAccrual(trx, id, auth);
      if (!posted) throw new AppError('Payroll accrual journal entry could not be created or already exists', 'HR_PAYROLL_ACCRUAL_FAILED', 400);

      await sql`UPDATE hr_payroll_run_items SET status = 'approved', updated_at = NOW() WHERE run_id = ${id} AND status = 'reviewed' AND tenant_id = ${auth.tenantId}`.execute(trx);
      await sql`UPDATE hr_payroll_runs SET status = 'approved', approved_by = ${auth.userId}, approved_at = NOW(), updated_at = NOW() WHERE id = ${id} AND tenant_id = ${auth.tenantId}`.execute(trx);
    });
    await this.audit.log('Approve HR payroll run', `Payroll run #${id} approved by ${auth.username}`, auth);
    return this.getPayrollRun(id, auth);
  }

  async payPayrollRun(id: number, payload: PayPayrollRunDto, auth: AuthContext): Promise<Record<string, unknown>> {
    let paymentReference: string = '';
    if (payload.paymentChannel === 'bank') {
      try {
        paymentReference = requireBankPayrollPaymentReference(payload.paymentChannel, payload.paymentReference);
      } catch (error) {
        throw new AppError(error instanceof Error ? error.message : 'المرجع البنكي غير صحيح', 'HR_PAYROLL_PAYMENT_REFERENCE_REQUIRED', 400);
      }
    }
    await this.tx.runInTransaction(this.db, async (trx) => {
      const status = await this.getPayrollRunStatusForUpdate(trx, id, auth.tenantId || '');
      if (!['approved', 'partially_paid'].includes(status)) {
        throw new AppError('Only approved or partially paid payroll runs can be paid', 'HR_PAYROLL_PAY_LOCKED', 400);
      }

      const remainingItems = await trx
        .selectFrom('hr_payroll_run_items as i')
        .innerJoin('hr_employees as e', (join) =>
          join.onRef('e.id', '=', 'i.employee_id').onRef('e.tenant_id', '=', 'i.tenant_id')
        )
        .select(['i.id', 'i.employee_id', 'i.net_pay', 'e.display_name'])
        .where('i.run_id', '=', id)
        .where('i.tenant_id', '=', auth.tenantId || '')
        .where('i.status', '=', 'approved')
        .execute();

      const totalNetPay = remainingItems.reduce((acc, row) => acc + Number(row.net_pay || 0), 0);
      if (totalNetPay <= 0) {
        throw new AppError('لا توجد مستحقات معتمدة متبقية للصرف في هذا الكشف', 'HR_PAYROLL_PAYMENT_ZERO', 400);
      }

      let shiftId: number | null = null;
      if (payload.paymentChannel === 'drawer') {
        shiftId = Number(payload.shiftId) || null;
        let eligibleShift: any;
        if (shiftId) {
          eligibleShift = await sql`
            SELECT id, branch_id, location_id, opened_by, COALESCE(expected_cash, 0) AS expected_cash
            FROM cashier_shifts
            WHERE id = ${shiftId} AND tenant_id = ${auth.tenantId} AND status = 'open'
            FOR UPDATE
          `.execute(trx);
        } else {
          eligibleShift = await sql`
            SELECT id, branch_id, location_id, opened_by, COALESCE(expected_cash, 0) AS expected_cash
            FROM cashier_shifts
            WHERE tenant_id = ${auth.tenantId} AND status = 'open'
              AND (opened_by = ${auth.userId} OR ${['admin', 'super_admin', 'owner', 'manager'].includes(auth.role)} OR ${Boolean(auth.permissions?.includes('hr') || auth.permissions?.includes('hrPayrollManage'))})
            ORDER BY (opened_by = ${auth.userId}) DESC, id DESC LIMIT 1
            FOR UPDATE
          `.execute(trx);
        }
        if (!eligibleShift.rows.length) {
          throw new AppError('لا توجد وردية كاشير مفتوحة للصرف منها؛ افتح وردية نقدية أولاً أو اختر الخزينة العامة', 'HR_CASHIER_SHIFT_REQUIRED', 400);
        }
        const shift = eligibleShift.rows[0];
        shiftId = Number(shift.id);
        const drawerCash = this.cashDrawer
          ? await this.cashDrawer.computeShiftExpectedCash(shiftId, auth, trx)
          : Number(shift.expected_cash || 0);
        if (totalNetPay > drawerCash && !payload.allowOverdraft) {
          throw new AppError(
            `نقدية درج الكاشير (${drawerCash.toLocaleString('en-US')} ج.م) غير كافية لصرف إجمالي المسير (${totalNetPay.toLocaleString('en-US')} ج.م)`,
            'HR_DRAWER_INSUFFICIENT_CASH',
            400
          );
        }

        const cashierUser = await sql<{ name: string }>`
          SELECT COALESCE(NULLIF(display_name, ''), username) as name
          FROM users
          WHERE id = ${shift.opened_by} AND tenant_id = ${auth.tenantId}
          LIMIT 1
        `.execute(trx);
        const cashierName = cashierUser.rows[0]?.name || 'الكاشير';

        await sql`
          UPDATE cashier_shifts
          SET expected_cash = ${drawerCash - totalNetPay}
          WHERE id = ${shiftId} AND tenant_id = ${auth.tenantId} AND status = 'open'
        `.execute(trx);

        await sql`
          INSERT INTO treasury_transactions (
            tenant_id, account_id, txn_type, amount, payment_channel, note, reference_type,
            reference_id, branch_id, location_id, created_by
          ) VALUES (
            ${auth.tenantId}, ${auth.accountId}, 'cash_out', ${-totalNetPay}, 'cash',
            ${`صرف رواتب مسير #${id} من درج الكاشير (${cashierName} - وردية #${shiftId})`},
            'cashier_shift', ${shiftId}, ${shift.branch_id}, ${shift.location_id}, ${auth.userId}
          )
        `.execute(trx);
      } else if (payload.paymentChannel === 'cash') {
        await this.treasury.recordPayrollPayment(trx, {
          runId: id,
          amount: totalNetPay,
          branchId: null,
          locationId: null,
        }, auth);
      }

      const { posted, journalEntryId } = await this.accountingPosting.postPayrollPayment(trx, id, payload.paymentChannel, auth);
      if (!posted && !journalEntryId) {
        throw new AppError('Payroll payment journal entry could not be created', 'HR_PAYROLL_PAYMENT_FAILED', 400);
      }

      // Update remaining approved items to paid
      await sql`
        UPDATE hr_payroll_run_items
        SET status = 'paid',
            paid_by = ${auth.userId},
            paid_at = NOW(),
            payment_channel = ${payload.paymentChannel},
            payment_reference = ${paymentReference || null},
            shift_id = ${shiftId},
            journal_entry_id = ${journalEntryId || null},
            notes = CASE WHEN ${Boolean(payload.notes)} THEN COALESCE(NULLIF(notes, ''), '') || ' | ' || ${clean(payload.notes)} ELSE notes END,
            updated_at = NOW()
        WHERE run_id = ${id} AND tenant_id = ${auth.tenantId} AND status = 'approved'
      `.execute(trx);

      // Record in employee ledger for each employee
      for (const item of remainingItems) {
        await sql`
          INSERT INTO hr_employee_ledger (
            employee_id, entry_type, amount, balance_after, note, reference_type, reference_id,
            created_by, tenant_id, account_id
          ) VALUES (
            ${item.employee_id}, 'wage_payout', ${Number(item.net_pay || 0)}, 0,
            ${`صرف وتصفية مستحقات الراتب - مسير #${id} عبر ${payload.paymentChannel === 'drawer' ? 'درج الكاشير' : payload.paymentChannel === 'bank' ? 'البنك' : 'الخزينة'}`},
            'hr_payroll_run', ${id}, ${auth.userId}, ${auth.tenantId}, ${auth.accountId}
          )
        `.execute(trx);
      }

      await sql`
        UPDATE hr_payroll_runs
        SET status = 'paid',
            paid_by = ${auth.userId},
            paid_at = NOW(),
            payment_channel = ${payload.paymentChannel},
            payment_reference = ${paymentReference || null},
            payment_notes = ${payload.notes || ''},
            updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${auth.tenantId}
      `.execute(trx);
    });
    await this.audit.log('Pay HR payroll run', `Payroll run #${id} paid by ${auth.username} via ${payload.paymentChannel}`, auth);
    return this.getPayrollRun(id, auth);
  }

  async payPayrollRunItem(itemId: number, payload: PayPayrollItemDto, auth: AuthContext): Promise<Record<string, unknown>> {
    let paymentReference: string = '';
    if (payload.paymentChannel === 'bank') {
      try {
        paymentReference = requireBankPayrollPaymentReference(payload.paymentChannel, payload.paymentReference);
      } catch (error) {
        throw new AppError(error instanceof Error ? error.message : 'المرجع البنكي غير صحيح', 'HR_PAYROLL_PAYMENT_REFERENCE_REQUIRED', 400);
      }
    }

    let runId = 0;
    await this.tx.runInTransaction(this.db, async (trx) => {
      const item = await trx
        .selectFrom('hr_payroll_run_items as i')
        .innerJoin('hr_employees as e', (join) =>
          join.onRef('e.id', '=', 'i.employee_id').onRef('e.tenant_id', '=', 'i.tenant_id')
        )
        .innerJoin('hr_payroll_runs as r', (join) =>
          join.onRef('r.id', '=', 'i.run_id').onRef('r.tenant_id', '=', 'i.tenant_id')
        )
        .select([
          'i.id',
          'i.run_id',
          'i.employee_id',
          'i.net_pay',
          'i.status',
          'e.display_name',
          'r.status as run_status',
          'r.period_month',
        ])
        .where('i.id', '=', itemId)
        .where('i.tenant_id', '=', auth.tenantId || '')
        .forUpdate()
        .executeTakeFirst();

      if (!item) throw new AppError('بند الراتب غير موجود', 'HR_PAYROLL_ITEM_NOT_FOUND', 404);
      runId = Number(item.run_id);
      if ((item.status as string) === 'paid') {
        throw new AppError('تم صرف مستحقات هذا الموظف بالفعل مسبقاً', 'HR_PAYROLL_ITEM_ALREADY_PAID', 400);
      }
      if (item.status !== 'approved') {
        throw new AppError('يمكن صرف المستحقات للبنود المعتمدة فقط', 'HR_PAYROLL_ITEM_NOT_APPROVED', 400);
      }
      if (!['approved', 'partially_paid'].includes(String(item.run_status))) {
        throw new AppError('مسير الرواتب يجب أن يكون معتمداً للصرف', 'HR_PAYROLL_RUN_NOT_APPROVED', 400);
      }

      const netPay = Number(item.net_pay || 0);
      if (netPay <= 0) throw new AppError('صافي أجر الموظف صفر أو سالب', 'HR_PAYROLL_AMOUNT_ZERO', 400);

      let shiftId: number | null = null;
      let branchId: number | null = null;
      let locationId: number | null = null;

      if (payload.paymentChannel === 'drawer') {
        shiftId = Number(payload.shiftId) || null;
        let eligibleShift: any;
        if (shiftId) {
          eligibleShift = await sql`
            SELECT id, branch_id, location_id, opened_by, COALESCE(expected_cash, 0) AS expected_cash
            FROM cashier_shifts
            WHERE id = ${shiftId} AND tenant_id = ${auth.tenantId} AND status = 'open'
            FOR UPDATE
          `.execute(trx);
        } else {
          eligibleShift = await sql`
            SELECT id, branch_id, location_id, opened_by, COALESCE(expected_cash, 0) AS expected_cash
            FROM cashier_shifts
            WHERE tenant_id = ${auth.tenantId} AND status = 'open'
              AND (opened_by = ${auth.userId} OR ${['admin', 'super_admin', 'owner', 'manager'].includes(auth.role)} OR ${Boolean(auth.permissions?.includes('hr') || auth.permissions?.includes('hrPayrollManage'))})
            ORDER BY (opened_by = ${auth.userId}) DESC, id DESC LIMIT 1
            FOR UPDATE
          `.execute(trx);
        }
        if (!eligibleShift.rows.length) {
          throw new AppError('لا توجد وردية كاشير مفتوحة للصرف منها؛ افتح وردية نقدية أولاً أو اختر الخزينة العامة', 'HR_CASHIER_SHIFT_REQUIRED', 400);
        }
        const shift = eligibleShift.rows[0];
        shiftId = Number(shift.id);
        branchId = shift.branch_id ? Number(shift.branch_id) : null;
        locationId = shift.location_id ? Number(shift.location_id) : null;
        const drawerCash = this.cashDrawer
          ? await this.cashDrawer.computeShiftExpectedCash(shiftId, auth, trx)
          : Number(shift.expected_cash || 0);
        if (netPay > drawerCash && !payload.allowOverdraft) {
          throw new AppError(
            `نقدية درج الكاشير (${drawerCash.toLocaleString('en-US')} ج.م) غير كافية لصرف صافي راتب الموظف (${netPay.toLocaleString('en-US')} ج.م)؛ يلزم إيداع نقدية بالدرج أو اختيار الخزينة العامة`,
            'HR_DRAWER_INSUFFICIENT_CASH',
            400
          );
        }

        const cashierUser = await sql<{ name: string }>`
          SELECT COALESCE(NULLIF(display_name, ''), username) as name
          FROM users
          WHERE id = ${shift.opened_by} AND tenant_id = ${auth.tenantId}
          LIMIT 1
        `.execute(trx);
        const cashierName = cashierUser.rows[0]?.name || 'الكاشير';

        await sql`
          UPDATE cashier_shifts
          SET expected_cash = ${drawerCash - netPay}
          WHERE id = ${shiftId} AND tenant_id = ${auth.tenantId} AND status = 'open'
        `.execute(trx);

        await sql`
          INSERT INTO treasury_transactions (
            tenant_id, account_id, txn_type, amount, payment_channel, note, reference_type,
            reference_id, branch_id, location_id, created_by
          ) VALUES (
            ${auth.tenantId}, ${auth.accountId}, 'cash_out', ${-netPay}, 'cash',
            ${`صرف راتب الموظف ${item.display_name} (#${item.employee_id}) من درج الكاشير (${cashierName} - وردية #${shiftId}) - مسير #${item.run_id}`},
            'cashier_shift', ${shiftId}, ${branchId}, ${locationId}, ${auth.userId}
          )
        `.execute(trx);
      } else if (payload.paymentChannel === 'cash') {
        await this.treasury.recordPayrollPayment(trx, {
          runId: runId,
          amount: netPay,
          branchId: null,
          locationId: null,
        }, auth);
      }

      // Post GL journal for this employee
      const { posted, journalEntryId } = await this.accountingPosting.postPayrollItemPayment(
        trx,
        itemId,
        payload.paymentChannel,
        auth,
        { employeeName: item.display_name, branchId, locationId }
      );

      // Update item to paid
      await sql`
        UPDATE hr_payroll_run_items
        SET status = 'paid',
            paid_at = NOW(),
            paid_by = ${auth.userId},
            payment_channel = ${payload.paymentChannel},
            payment_reference = ${paymentReference || null},
            shift_id = ${shiftId},
            journal_entry_id = ${journalEntryId || null},
            notes = CASE WHEN ${Boolean(payload.notes)} THEN COALESCE(NULLIF(notes, ''), '') || ' | ' || ${clean(payload.notes)} ELSE notes END,
            updated_at = NOW()
        WHERE id = ${itemId} AND tenant_id = ${auth.tenantId}
      `.execute(trx);

      // Record in employee ledger
      await sql`
        INSERT INTO hr_employee_ledger (
          employee_id, entry_type, amount, balance_after, note, reference_type, reference_id,
          created_by, tenant_id, account_id
        ) VALUES (
          ${item.employee_id}, 'wage_payout', ${netPay}, 0,
          ${`صرف وتصفية مستحقات راتب شهر ${item.period_month} عبر ${payload.paymentChannel === 'drawer' ? 'درج الكاشير' : payload.paymentChannel === 'bank' ? 'البنك' : 'الخزينة'}`},
          'hr_payroll_run_item', ${itemId}, ${auth.userId}, ${auth.tenantId}, ${auth.accountId}
        )
      `.execute(trx);

      // Reconcile run status
      const remainingApproved = await sql<{ count: string }>`
        SELECT COUNT(*) as count
        FROM hr_payroll_run_items
        WHERE run_id = ${runId} AND tenant_id = ${auth.tenantId} AND status = 'approved'
      `.execute(trx);
      const remainingCount = Number(remainingApproved.rows[0]?.count || 0);

      if (remainingCount === 0) {
        await sql`
          UPDATE hr_payroll_runs
          SET status = 'paid',
              paid_at = NOW(),
              paid_by = ${auth.userId},
              payment_channel = ${payload.paymentChannel},
              payment_reference = ${paymentReference || null},
              updated_at = NOW()
          WHERE id = ${runId} AND tenant_id = ${auth.tenantId}
        `.execute(trx);
      } else {
        await sql`
          UPDATE hr_payroll_runs
          SET status = 'partially_paid',
              updated_at = NOW()
          WHERE id = ${runId} AND tenant_id = ${auth.tenantId}
        `.execute(trx);
      }
    });

    await this.audit.log('Pay HR payroll item', `Payroll item #${itemId} paid by ${auth.username} via ${payload.paymentChannel}`, auth);
    return this.getPayrollRun(runId, auth);
  }

  async cancelPayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const status = await this.getPayrollRunStatusForUpdate(trx, id, tenantId);
      if (status === 'cancelled') return; // idempotent; do not release any other run
      if (!['draft', 'reviewed'].includes(status)) {
        throw new AppError('Approved or paid payroll runs cannot be cancelled', 'HR_PAYROLL_CANCEL_LOCKED', 400);
      }
      // Draft/review materialization marks pending employee adjustments as
      // applied. Cancelling without releasing those entries loses legitimate
      // bonuses and deductions from every later payroll.
      await sql`
        UPDATE hr_employee_adjustments
        SET status = 'pending', applied_in_run_id = NULL
        WHERE tenant_id = ${tenantId} AND applied_in_run_id = ${id}
          AND status = 'applied'
      `.execute(trx);
      await sql`
        UPDATE hr_payroll_runs SET status = 'cancelled', updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId} AND status IN ('draft', 'reviewed')
      `.execute(trx);
    });
    await this.audit.log('Cancel HR payroll run', `Payroll run #${id} cancelled by ${auth.username}`, auth);
    return this.getPayrollRun(id, auth);
  }

  async generatePayrollWps(id: number, payload: GenerateWpsDto, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    // D5 (INV-WPS-PAID-RUN-EXPORT): exporting bank details (IBANs, national
    // IDs) requires payroll-manage permission, not view-only.
    if (!hasHrPermission(auth, 'hrPayrollManage')) {
      throw new AppError('تصدير البيانات البنكية يتطلب صلاحية إدارة المرتبات', 'HR_PAYROLL_EXPORT_FORBIDDEN', 403);
    }
    const runResult = await sql<Record<string, unknown>>`
      SELECT r.*,
        to_char(r.start_date, 'YYYY-MM-DD') AS start_date_text,
        to_char(r.end_date, 'YYYY-MM-DD') AS end_date_text
      FROM hr_payroll_runs r
      WHERE r.id = ${id} AND r.tenant_id = ${auth.tenantId}
    `.execute(this.db);
    const run = runResult.rows[0];
    if (!run) throw new AppError('مسير الرواتب غير موجود', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
    if (!['approved', 'paid'].includes(clean(run.status))) {
      throw new AppError('لا يمكن تصدير مرتبات بنكية قبل اعتماد الكشف', 'HR_PAYROLL_EXPORT_NOT_APPROVED', 400);
    }

    // INV-PAYROLL-EXPORT-REQUIRES-ACCRUAL: a bank review file may
    // only be exported against a booked accrual. The export must
    // never outrun the ledger — an approved run whose accrual
    // journal is missing (or was reversed) exports nothing.
    // "Active" is the posting service's own definition: status
    // 'posted' with no reversal link.
    const accrualJournals = await sql<{ status: string; reversed_by_entry_id: number | null }>`
      SELECT status, reversed_by_entry_id FROM journal_entries
      WHERE source_type = 'hr_payroll_accrual' AND source_id = ${id} AND tenant_id = ${auth.tenantId}
    `.execute(this.db);
    const hasActiveAccrual = accrualJournals.rows.some(
      (row) => clean(row.status) === 'posted' && !row.reversed_by_entry_id,
    );
    if (!hasActiveAccrual) {
      const wasReversed = accrualJournals.rows.some((row) => !!row.reversed_by_entry_id);
      if (wasReversed) {
        throw new AppError('قيد استحقاق الرواتب لهذا المسير تم عكسه، لا يمكن تصدير ملف بنكي', 'HR_PAYROLL_EXPORT_ACCRUAL_REVERSED', 409);
      }
      throw new AppError('لا يوجد قيد استحقاق مرحل لهذا المسير، لا يمكن تصدير ملف بنكي', 'HR_PAYROLL_EXPORT_ACCRUAL_MISSING', 409);
    }

    // D5: the review CSV may export paid runs too — the run-status gate
    // allows 'paid', so the items query must select paid items as well.
    // Certified SIF generation stays disabled (sifContent is always '').
    const itemsResult = await sql<Record<string, unknown>>`
      SELECT
        i.*,
        e.employee_no,
        e.national_id,
        e.display_name,
        e.bank_name,
        e.bank_account_number,
        e.iban,
        e.bank_swift_code
      FROM hr_payroll_run_items i
      JOIN hr_employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
      WHERE i.run_id = ${id} AND i.status IN ('approved', 'paid') AND i.tenant_id = ${auth.tenantId}
      ORDER BY e.employee_no ASC, e.display_name ASC
    `.execute(this.db);

    if (!itemsResult.rows.length) throw new AppError('لا توجد مرتبات معتمدة أو مدفوعة للتصدير', 'HR_PAYROLL_EXPORT_EMPTY', 400);
    const badRow = itemsResult.rows.find((row) => {
      return !clean(row.employee_no) || !clean(row.display_name) || !clean(row.national_id)
        || !clean(row.bank_name) || (!clean(row.iban) && !clean(row.bank_account_number));
    });
    if (badRow) {
      throw new AppError(
        `استكمل رقم الموظف والهوية والبنك ورقم الحساب/الآيبان للموظف ${clean(badRow.display_name) || String(badRow.employee_id)} قبل تصدير الملف`,
        'HR_PAYROLL_EXPORT_BANK_DETAILS_MISSING', 400,
      );
    }
    const createDate = todayTenantDate(await getTenantTimezone(this.db, auth.tenantId || ''));
    const periodMonth = clean(run.period_month) || createDate.slice(0, 7);
    const startDate = clean(run.start_date_text) || `${periodMonth}-01`;
    const endDate = clean(run.end_date_text) || `${periodMonth}-28`;

    const settingsRows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', auth.tenantId || '')
      .execute();
    const tenantSettings: Record<string, any> = {};
    for (const row of settingsRows) {
      try { tenantSettings[row.key] = JSON.parse(row.value); } catch { tenantSettings[row.key] = row.value; }
    }

    const configuredCurrency = clean(tenantSettings.currency).toUpperCase();
    const currency = clean(payload.currency || configuredCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(configuredCurrency) || configuredCurrency !== currency) {
      throw new AppError('عملة كشف التحويل غير مدعومة أو لا تطابق عملة المنشأة', 'HR_PAYROLL_EXPORT_CURRENCY_MISMATCH', 409);
    }
    // INV-HR-PAYROLL-BOOK-PRECISION: the review CSV formats stored run
    // amounts at book precision; KWD/OMR runs are no longer blocked here.
    // Certified WPS/SIF generation stays deliberately disabled above.
    const exportDigits = currencyMoneyDigits(currency);

    let totalNetPay = 0;
    let totalBaseSalary = 0;
    let totalAllowances = 0;
    let totalDeductions = 0;

    const mappedRecords = itemsResult.rows.map((row) => {
      const netPay = Number(row.net_pay || 0);
      const baseSalary = Number(row.base_salary || 0);
      const allowances = Number(row.allowance_amount || 0);
      const deductions = Number(row.deduction_amount || 0) + Number(row.loan_deduction_amount || 0) + Number(row.asset_recovery_deduction_amount || 0);

      totalNetPay += netPay;
      totalBaseSalary += baseSalary;
      totalAllowances += allowances;
      totalDeductions += deductions;

      return {
        id: Number(row.id),
        employeeId: Number(row.employee_id),
        employeeNo: clean(row.employee_no),
        displayName: clean(row.display_name),
        nationalId: clean(row.national_id),
        bankName: clean(row.bank_name),
        bankAccountNumber: clean(row.bank_account_number),
        iban: clean(row.iban),
        bankSwiftCode: clean(row.bank_swift_code),
        baseSalary,
        allowances,
        deductions,
        netPay,
      };
    });

    const totalEmployees = mappedRecords.length;

    // Deliberately disabled: a universal SCR/EDR template is NOT a certified
    // WPS format for Egypt, Saudi Arabia, Kuwait, Qatar or Oman. Never generate
    // a pseudo-compliant banking file; only the review CSV is available.
    const sifContent = '';

    // Standard CSV export
    const csvHeaders = ['رقم الموظف', 'اسم الموظف', 'الهوية / الإقامة', 'البنك', 'الآيبان / الحساب', 'السويفت', 'الراتب الأساسي', 'البدلات', 'الخصومات', 'صافي الراتب'];
    // Spreadsheet cells can execute formulas even inside quoted CSV fields.
    // Preserve bank identifiers as literal text and escape all quotes and line breaks.
    const csvCell = (value: unknown): string => {
      let s = String(value ?? '').replace(/[\r\n\t]/g, ' ').trim();
      if (/^[=+@-]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const csvLines = mappedRecords.map((r) => [
      csvCell(r.employeeNo),
      csvCell(r.displayName),
      csvCell(r.nationalId),
      csvCell(r.bankName),
      csvCell(r.iban || r.bankAccountNumber),
      csvCell(r.bankSwiftCode),
      r.baseSalary.toFixed(exportDigits),
      r.allowances.toFixed(exportDigits),
      r.deductions.toFixed(exportDigits),
      r.netPay.toFixed(exportDigits),
    ].join(','));
    const csvContent = [csvHeaders.join(','), ...csvLines].join('\r\n');

    await this.audit.log('Export HR payroll bank review CSV', `Payroll run #${id} exported as REVIEW CSV (not certified WPS) by ${auth.username} (${totalEmployees} employees, total: ${totalNetPay})`, auth);

    return {
      ok: true,
      runId: id,
      runName: clean(run.name),
      periodMonth,
      startDate,
      endDate,
      summary: {
        totalEmployees,
        totalNetPay,
        totalBaseSalary,
        totalAllowances,
        totalDeductions,
        currency,
        missingIbanCount: mappedRecords.filter((r) => !r.iban && !r.bankAccountNumber).length,
      },
      sifContent,
      csvContent,
      records: mappedRecords,
    };
  }

  async updatePayrollRunItem(id: number, payload: UpsertPayrollItemDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    let runId = 0;
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      // Run lock serializes item exclusion against review/approval and freezes
      // the financial snapshot before either committed status may change.
      const locked = await sql<{ run_id: number; run_status: string; item_status: string }>`
        SELECT r.id AS run_id, r.status AS run_status, i.status AS item_status
        FROM hr_payroll_run_items i
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        WHERE i.id = ${id} AND i.tenant_id = ${tenantId}
        FOR UPDATE OF r, i
      `.execute(trx);
      const item = locked.rows[0];
      if (!item) throw new AppError('Payroll item not found', 'HR_PAYROLL_ITEM_NOT_FOUND', 404);
      if (item.run_status !== 'draft') throw new AppError('Payroll items can only be edited while the run is draft', 'HR_PAYROLL_ITEM_EDIT_LOCKED', 400);
      const status = clean(payload.status);
      if (status && !['draft', 'excluded'].includes(status)) throw new AppError('Payroll item status is invalid', 'HR_PAYROLL_ITEM_STATUS_INVALID', 400);
      runId = Number(item.run_id);
      await sql`
        UPDATE hr_payroll_run_items
        SET status = ${status || item.item_status || 'draft'},
            notes = ${status === 'excluded'
              ? combineNotes(clean(payload.notes), MANUAL_PAYROLL_EXCLUSION_NOTE)
              : clean(payload.notes)},
            updated_at = NOW()
        WHERE id = ${id} AND run_id = ${runId} AND tenant_id = ${tenantId}
      `.execute(trx);
    });
    await this.audit.log('Update HR payroll item', `Payroll item #${id} updated by ${auth.username}`, auth);
    return this.getPayrollRun(runId, auth);
  }

  async createPayrollAdjustment(id: number, payload: CreatePayrollAdjustmentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const item = await this.getPayrollItemRun(this.db, id, auth.tenantId || '');
    if (item.runStatus !== 'draft') throw new AppError('Payroll adjustments can only be edited while the run is draft', 'HR_PAYROLL_ADJUSTMENT_LOCKED', 400);
    const adjustmentBookDigits = await tenantBookDigits(this.db, auth.tenantId || '');
    try {
      requireLoanMoney(Number(payload.amount), adjustmentBookDigits);
    } catch {
      throw new AppError('مبلغ تعديل المرتب يجب أن يكون موجبًا وبدقة دفاتر المنشأة دون تقريب', 'HR_PAYROLL_ADJUSTMENT_AMOUNT_INVALID', 400);
    }
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      // Recheck while holding the same payroll-run row lock as review/approval.
      const locked = await sql<{ status: string }>`
        SELECT r.status FROM hr_payroll_runs r
        JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id
        WHERE i.id = ${id} AND i.tenant_id = ${auth.tenantId}
        FOR UPDATE OF r
      `.execute(trx);
      if (locked.rows[0]?.status !== 'draft') {
        throw new AppError('Payroll adjustments can only be edited while the run is draft', 'HR_PAYROLL_ADJUSTMENT_LOCKED', 400);
      }
      await sql`
        INSERT INTO hr_payroll_item_adjustments (tenant_id, account_id, payroll_item_id, adjustment_type, label, amount, notes)
        VALUES (${auth.tenantId}, ${auth.accountId}, ${id}, ${clean(payload.adjustmentType)}, ${clean(payload.label)}, ${money(payload.amount, adjustmentBookDigits)}, ${clean(payload.notes)})
      `.execute(trx);
      await this.recalculatePayrollItemTotals(trx, id, requireTenantScope(auth).tenantId);
      await sql`UPDATE hr_payroll_runs SET updated_at = NOW() WHERE id = ${item.runId} AND tenant_id = ${auth.tenantId}`.execute(trx);
    });
    await this.audit.log('Create HR payroll adjustment', `Payroll item #${id} adjustment added by ${auth.username}`, auth);
    return this.getPayrollRun(item.runId, auth);
  }

  async deletePayrollAdjustment(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    let runId = 0;
    let itemId = 0;
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const result = await sql<{ payroll_item_id: number; run_id: number; run_status: string }>`
        SELECT a.payroll_item_id, i.run_id, r.status AS run_status
        FROM hr_payroll_item_adjustments a
        JOIN hr_payroll_run_items i ON i.id = a.payroll_item_id AND i.tenant_id = a.tenant_id
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        WHERE a.id = ${id} AND a.tenant_id = ${auth.tenantId}
        FOR UPDATE OF r, i
      `.execute(trx);
      const row = result.rows[0];
      if (!row) throw new AppError('Payroll adjustment not found', 'HR_PAYROLL_ADJUSTMENT_NOT_FOUND', 404);
      if (clean(row.run_status) !== 'draft') throw new AppError('Payroll adjustments can only be edited while the run is draft', 'HR_PAYROLL_ADJUSTMENT_LOCKED', 400);
      runId = Number(row.run_id || 0);
      itemId = Number(row.payroll_item_id || 0);
      await sql`DELETE FROM hr_payroll_item_adjustments WHERE id = ${id} AND tenant_id = ${auth.tenantId}`.execute(trx);
      await this.recalculatePayrollItemTotals(trx, itemId, requireTenantScope(auth).tenantId);
      await sql`UPDATE hr_payroll_runs SET updated_at = NOW() WHERE id = ${runId} AND tenant_id = ${auth.tenantId}`.execute(trx);
    });
    await this.audit.log('Delete HR payroll adjustment', `Payroll adjustment #${id} deleted by ${auth.username}`, auth);
    return this.getPayrollRun(runId, auth);
  }

  async listAttendance(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const tenantTimezone = await getTenantTimezone(this.db, auth.tenantId);
    const workDate = normalizeDateOnly(query.date) || normalizeDateOnly(query.workDate) || todayTenantDate(tenantTimezone);
    if (!workDate) throw new AppError('Attendance date is required', 'HR_ATTENDANCE_DATE_REQUIRED', 400);
    const search = clean(query.search).toLowerCase();
    const requestedEmployeeId = toId(query.employeeId);
    const requestedDepartmentId = toId(query.departmentId);
    const rangeFrom = normalizeDateOnly(query.from);
    const rangeTo = normalizeDateOnly(query.to);
    if (rangeFrom || rangeTo) {
      if (!rangeFrom || !rangeTo || rangeFrom > rangeTo) throw new AppError('اختر تاريخ بداية ونهاية صحيحين', 'HR_ATTENDANCE_RANGE_INVALID', 400);
      const rangeDays = Math.round((Date.parse(rangeTo + 'T00:00:00Z') - Date.parse(rangeFrom + 'T00:00:00Z')) / 86400000);
      if (rangeDays > 92) throw new AppError('الحد الأقصى لفترة الحضور 93 يومًا', 'HR_ATTENDANCE_RANGE_TOO_LARGE', 400);
      const pageSize = Math.min(200, Math.max(1, Math.floor(Number(query.pageSize || 50)) || 50));
      const page = Math.max(1, Math.floor(Number(query.page || 1)) || 1);
      const match = `%${search}%`;
      const count = await sql<{ total: string; minutes: string; payable_minutes: string; present: string; absent: string; late: string }>`
        SELECT COUNT(*)::text AS total,
          COALESCE(SUM(CASE WHEN a.check_in_at IS NOT NULL AND a.check_out_at IS NOT NULL
              AND a.check_out_at > a.check_in_at AND a.check_out_at <= a.check_in_at + INTERVAL '24 hours'
              AND a.status NOT IN ('absent', 'leave')
              THEN FLOOR(EXTRACT(EPOCH FROM (a.check_out_at - a.check_in_at)) / 60) + COALESCE(a.prior_sessions_minutes, 0) ELSE 0 END), 0)::text AS minutes,
          COALESCE(SUM(CASE WHEN e.compensation_type = 'hourly'
              AND a.check_in_at IS NOT NULL AND a.check_out_at IS NOT NULL
              AND a.check_out_at > a.check_in_at AND a.check_out_at <= a.check_in_at + INTERVAL '24 hours'
              AND a.status NOT IN ('absent', 'leave')
              THEN LEAST(
                FLOOR(EXTRACT(EPOCH FROM (a.check_out_at - a.check_in_at)) / 60),
                COALESCE(e.expected_daily_hours * 60, 480)
              ) + CASE WHEN e.overtime_policy = 'auto_approved' THEN
                GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (a.check_out_at - a.check_in_at)) / 60) - COALESCE(e.expected_daily_hours * 60, 480))
              WHEN e.overtime_policy = 'disabled' THEN 0
              ELSE
                COALESCE((
                  SELECT SUM(COALESCE(ex.approved_duration_minutes, ex.duration_minutes))
                  FROM hr_attendance_exceptions ex
                  WHERE ex.tenant_id = a.tenant_id AND ex.employee_id = a.employee_id
                    AND ex.work_date = a.work_date AND ex.exception_type IN ('late_check_out', 'extra_hours')
                    AND ex.status = 'approved'
                ), 0)
              END
              ELSE 0 END), 0)::text AS payable_minutes,
          COUNT(*) FILTER (WHERE a.status = 'present')::text AS present,
          COUNT(*) FILTER (WHERE a.status = 'absent')::text AS absent,
          COUNT(*) FILTER (WHERE a.status = 'late')::text AS late
        FROM hr_attendance_records a
        JOIN hr_employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
        LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id AND d.tenant_id = e.tenant_id
        WHERE a.tenant_id = ${auth.tenantId}
          AND a.work_date BETWEEN ${rangeFrom}::date AND ${rangeTo}::date
          AND (${requestedEmployeeId}::BIGINT IS NULL OR a.employee_id = ${requestedEmployeeId})
          AND (${requestedDepartmentId}::BIGINT IS NULL OR e.department_id = ${requestedDepartmentId})
          AND (${search} = '' OR LOWER(e.display_name) LIKE ${match} OR LOWER(e.employee_no) LIKE ${match} OR LOWER(COALESCE(d.name, '')) LIKE ${match})
      `.execute(this.db);
      const totalItems = Number(count.rows[0]?.total || 0);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const safePage = Math.min(page, totalPages);
      const result = await sql<Record<string, unknown>>`
        SELECT a.id AS attendance_id, e.id AS employee_id, e.employee_no, e.display_name AS employee_name,
          d.name AS department_name, j.name AS job_title_name,
          e.compensation_type, e.hourly_rate,
          to_char(a.work_date, 'YYYY-MM-DD') AS work_date_text, a.status,
          to_char(a.check_in_at AT TIME ZONE ${tenantTimezone}, 'YYYY-MM-DD"T"HH24:MI:SS') AS check_in_at_text,
          to_char(a.check_out_at AT TIME ZONE ${tenantTimezone}, 'YYYY-MM-DD"T"HH24:MI:SS') AS check_out_at_text,
          a.source, a.notes,
          e.scheduled_check_in_time, e.scheduled_check_out_time, e.grace_minutes, e.department_id,
          e.expected_daily_hours, e.overtime_policy,
          COALESCE((
            SELECT SUM(COALESCE(ex.approved_duration_minutes, ex.duration_minutes))
            FROM hr_attendance_exceptions ex
            WHERE ex.tenant_id = a.tenant_id AND ex.employee_id = a.employee_id
              AND ex.work_date = a.work_date AND ex.exception_type IN ('late_check_out', 'extra_hours')
              AND ex.status = 'approved'
          ), 0) AS approved_overtime_minutes,
          COALESCE((
            SELECT SUM(ex.duration_minutes)
            FROM hr_attendance_exceptions ex
            WHERE ex.tenant_id = a.tenant_id AND ex.employee_id = a.employee_id
              AND ex.work_date = a.work_date AND ex.exception_type IN ('late_check_out', 'extra_hours')
              AND ex.status IN ('pending', 'needs_review')
          ), 0) AS pending_overtime_minutes
        FROM hr_attendance_records a
        JOIN hr_employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
        LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id AND d.tenant_id = e.tenant_id
        LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id AND j.tenant_id = e.tenant_id
        WHERE a.tenant_id = ${auth.tenantId}
          AND a.work_date BETWEEN ${rangeFrom}::date AND ${rangeTo}::date
          AND (${requestedEmployeeId}::BIGINT IS NULL OR a.employee_id = ${requestedEmployeeId})
          AND (${requestedDepartmentId}::BIGINT IS NULL OR e.department_id = ${requestedDepartmentId})
          AND (${search} = '' OR LOWER(e.display_name) LIKE ${match} OR LOWER(e.employee_no) LIKE ${match} OR LOWER(COALESCE(d.name, '')) LIKE ${match})
        ORDER BY a.work_date DESC, e.display_name ASC, a.id DESC
        LIMIT ${pageSize} OFFSET ${(safePage - 1) * pageSize}
      `.execute(this.db);
      return {
        rows: result.rows.map(row => ({
          id: String(row.attendance_id), employeeId: String(row.employee_id),
          employeeNo: clean(row.employee_no), employeeName: clean(row.employee_name),
          departmentName: clean(row.department_name), jobTitleName: clean(row.job_title_name),
          compensationType: clean(row.compensation_type), hourlyRate: Number(row.hourly_rate || 0),
          workDate: clean(row.work_date_text), status: clean(row.status),
          checkInAt: clean(row.check_in_at_text), checkOutAt: clean(row.check_out_at_text),
          source: normalizeAttendanceSource(row.source), notes: clean(row.notes),
          scheduledCheckInTime: clean(row.scheduled_check_in_time),
          scheduledCheckOutTime: clean(row.scheduled_check_out_time),
          graceMinutes: Number(row.grace_minutes || 0),
          departmentId: row.department_id ? String(row.department_id) : "",
          expectedDailyHours: row.expected_daily_hours != null ? Number(row.expected_daily_hours) : null,
          overtimePolicy: clean(row.overtime_policy) || 'review_only',
          approvedOvertimeMinutes: Number(row.approved_overtime_minutes || 0),
          pendingOvertimeMinutes: Number(row.pending_overtime_minutes || 0),
        })),
        pagination: { page: safePage, pageSize, totalItems, totalPages },
        summary: { totalItems, presentCount: Number(count.rows[0]?.present || 0),
          absentCount: Number(count.rows[0]?.absent || 0), lateCount: Number(count.rows[0]?.late || 0),
          workedMinutes: Number(count.rows[0]?.minutes || 0),
          payableMinutes: Number(count.rows[0]?.payable_minutes || 0) },
        serverTime: new Date().toISOString(), serverTimezone: tenantTimezone,
        from: rangeFrom, to: rangeTo,
      };
    }

    const result = await sql<Record<string, unknown>>`
      SELECT
        e.id AS employee_id,
        e.employee_no,
        e.compensation_type, e.hourly_rate,
        e.display_name AS employee_name,
        d.name AS department_name,
        j.name AS job_title_name,
        a.id AS attendance_id,
        to_char(a.work_date, 'YYYY-MM-DD') AS work_date_text,
        a.status,
        to_char(a.check_in_at AT TIME ZONE ${tenantTimezone}, 'YYYY-MM-DD"T"HH24:MI:SS') AS check_in_at_text,
        to_char(a.check_out_at AT TIME ZONE ${tenantTimezone}, 'YYYY-MM-DD"T"HH24:MI:SS') AS check_out_at_text,
        a.source,
        a.notes,
        e.scheduled_check_in_time,
        e.scheduled_check_out_time,
        e.grace_minutes,
        e.department_id,
        e.expected_daily_hours,
        e.overtime_policy,
        COALESCE((
          SELECT SUM(COALESCE(ex.approved_duration_minutes, ex.duration_minutes))
          FROM hr_attendance_exceptions ex
          WHERE ex.tenant_id = e.tenant_id AND ex.employee_id = e.id
            AND ex.work_date = ${workDate}::date AND ex.exception_type IN ('late_check_out', 'extra_hours')
            AND ex.status = 'approved'
        ), 0) AS approved_overtime_minutes,
        COALESCE((
          SELECT SUM(ex.duration_minutes)
          FROM hr_attendance_exceptions ex
          WHERE ex.tenant_id = e.tenant_id AND ex.employee_id = e.id
            AND ex.work_date = ${workDate}::date AND ex.exception_type IN ('late_check_out', 'extra_hours')
            AND ex.status IN ('pending', 'needs_review')
        ), 0) AS pending_overtime_minutes
      FROM hr_employees e
      LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id AND d.tenant_id = e.tenant_id
      LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id AND j.tenant_id = e.tenant_id
      LEFT JOIN hr_attendance_records a ON a.employee_id = e.id AND a.tenant_id = e.tenant_id AND a.work_date = ${workDate}::date
      WHERE ${this.tenantPredicate(auth, 'e')}
        AND e.status IN ('active', 'inactive')
        AND (${requestedEmployeeId}::BIGINT IS NULL OR e.id = ${requestedEmployeeId})
        AND (${requestedDepartmentId}::BIGINT IS NULL OR e.department_id = ${requestedDepartmentId})
      ORDER BY e.display_name ASC, e.id ASC
    `.execute(this.db);

    let rows = result.rows.map((row) => {
      const status = normalizeAttendanceStatus(row.status);
      return {
        id: row.attendance_id ? String(row.attendance_id) : '',
        employeeId: String(row.employee_id),
        employeeNo: clean(row.employee_no),
        employeeName: clean(row.employee_name),
        departmentName: clean(row.department_name),
        jobTitleName: clean(row.job_title_name),
        compensationType: clean(row.compensation_type), hourlyRate: Number(row.hourly_rate || 0),
        workDate,
        status: status === 'unmarked' ? '' : status,
        checkInAt: clean(row.check_in_at_text),
        checkOutAt: clean(row.check_out_at_text),
        source: normalizeAttendanceSource(row.source),
        notes: clean(row.notes),
        scheduledCheckInTime: clean(row.scheduled_check_in_time),
        scheduledCheckOutTime: clean(row.scheduled_check_out_time),
        graceMinutes: Number(row.grace_minutes || 0),
        departmentId: row.department_id ? String(row.department_id) : "",
        expectedDailyHours: row.expected_daily_hours != null ? Number(row.expected_daily_hours) : null,
        overtimePolicy: clean(row.overtime_policy) || 'review_only',
        approvedOvertimeMinutes: Number(row.approved_overtime_minutes || 0),
        pendingOvertimeMinutes: Number(row.pending_overtime_minutes || 0),
      };
    });

    if (search) {
      rows = rows.filter((row) => [row.employeeNo, row.employeeName, row.departmentName, row.jobTitleName].some((value) => value.toLowerCase().includes(search)));
    }

    const summary = rows.reduce(
      (acc, row) => {
        const status = normalizeAttendanceStatus(row.status);
        acc.totalItems += 1;
        if (status === 'present') acc.presentCount += 1;
        else if (status === 'absent') acc.absentCount += 1;
        else if (status === 'late') acc.lateCount += 1;
        else if (status === 'leave') acc.leaveCount += 1;
        else if (status === 'unmarked') acc.unmarkedCount += 1;
        return acc;
      },
      { totalItems: 0, presentCount: 0, absentCount: 0, lateCount: 0, leaveCount: 0, unmarkedCount: 0 },
    );

    const workedMinutes = rows.reduce((total, row) => {
      if (!row.checkInAt || !row.checkOutAt || ['absent', 'leave'].includes(row.status)) return total;
      const elapsed = Math.floor((new Date(row.checkOutAt).getTime() - new Date(row.checkInAt).getTime()) / 60000);
      return total + (Number.isFinite(elapsed) && elapsed > 0 && elapsed <= 1440 ? elapsed : 0);
    }, 0);
    const payableMinutes = rows.reduce((total, row) => {
      if (row.compensationType !== 'hourly' || !row.checkInAt || !row.checkOutAt || ['absent', 'leave'].includes(row.status)) return total;
      const elapsed = Math.floor((new Date(row.checkOutAt).getTime() - new Date(row.checkInAt).getTime()) / 60000);
      if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 1440) return total;
      const expectedDailyMinutes = resolveExpectedDailyMinutes(row);
      const { payableMinutes: rowPayable } = calculatePayableMinutes({
        actualMinutes: elapsed,
        expectedDailyMinutes,
        overtimePolicy: row.overtimePolicy,
        approvedOvertimeMinutes: row.approvedOvertimeMinutes,
      });
      return total + rowPayable;
    }, 0);
    const paged = paginateRows(rows, query, { defaultSize: 50 });
    return {
      rows: paged.rows,
      pagination: paged.pagination,
      summary: { ...summary, workedMinutes, payableMinutes },
      serverTime: new Date().toISOString(),
      serverTimezone: tenantTimezone,
      workDate,
    };
  }

  /** Booked payroll is immutable; changing underlying attendance after GL
   * accrual silently contradicts a financial snapshot and its bank file.
   * Call while holding the tenant-wide payroll lock inside the SAME trx.
   */
  private async assertAttendanceDayNotPosted(
    trx: Kysely<Database>, employeeId: number, workDate: string, tenantId: string,
  ): Promise<void> {
    const booked = await sql<{ id: number }>`
      SELECT r.id FROM hr_payroll_runs r
      JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${tenantId} AND i.employee_id = ${employeeId}
        AND i.status = 'approved' AND r.status IN ('approved', 'paid')
        AND ${workDate}::date BETWEEN r.start_date AND r.end_date
      LIMIT 1
    `.execute(trx);
    if (booked.rows.length) {
      throw new AppError('لا يمكن تعديل حضور يوم دخل مسير مرتبات معتمد؛ سجّل تسوية محاسبية مستقلة',
        'HR_ATTENDANCE_POSTED_PERIOD_LOCKED', 409);
    }
  }

  async bulkSaveAttendance(payload: BulkSaveAttendanceDto, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const workDate = normalizeDateOnly(payload.workDate);
    if (!workDate) throw new AppError('Attendance date is required', 'HR_ATTENDANCE_DATE_REQUIRED', 400);
    // Same outer fence as the single manual edit (resolveAttendancePunch):
    // a bulk day outside the open payroll month is rejected, not stored.
    const tenantTimezone = await getTenantTimezone(this.db, auth.tenantId);
    const todayKey = todayTenantDate(tenantTimezone);
    if (workDate < firstDayOfTenantMonth(todayKey) || workDate > todayKey) {
      throw new AppError('Attendance date is outside the open payroll month', 'HR_ATTENDANCE_DATE_OUT_OF_RANGE', 400);
    }
    if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
      throw new AppError('Attendance rows are required', 'HR_ATTENDANCE_ROWS_REQUIRED', 400);
    }

    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const ids = payload.rows.map(row => toId(row.employeeId));
      if (ids.some(id => !id)) throw new AppError('Employee is required', 'HR_ATTENDANCE_EMPLOYEE_REQUIRED', 400);
      if (new Set(ids).size !== ids.length) {
        throw new AppError('لا يمكن إرسال بصمتين لنفس الموظف في يوم واحد', 'HR_ATTENDANCE_DUPLICATE_EMPLOYEE', 400);
      }
      const allowed = await sql<{ id: number; status: string }>`
        SELECT id, status FROM hr_employees
        WHERE tenant_id = ${auth.tenantId} AND id IN (${sql.join(ids as number[])})
      `.execute(trx);
      const eligible = new Set(allowed.rows.filter(e => e.status === 'active').map(e => Number(e.id)));
      if (eligible.size !== ids.length || ids.some(id => !eligible.has(Number(id)))) {
        throw new AppError('قائمة الحضور تحتوي موظفًا غير نشط أو غير تابع للمنشأة', 'HR_ATTENDANCE_EMPLOYEE_TENANT_MISMATCH', 400);
      }
      for (const row of payload.rows) {
        const employeeId = toId(row.employeeId)!;
        await this.assertAttendanceDayNotPosted(trx, employeeId, workDate, auth.tenantId || '');
        const status = normalizeAttendanceStatus(row.status);
        if (status === 'unmarked') throw new AppError('Attendance status is invalid', 'HR_ATTENDANCE_STATUS_INVALID', 400);
        const checkInAt = row.checkInAt ? new Date(row.checkInAt) : null;
        const checkOutAt = row.checkOutAt ? new Date(row.checkOutAt) : null;
        if ((checkInAt && Number.isNaN(checkInAt.getTime())) || (checkOutAt && Number.isNaN(checkOutAt.getTime()))) {
          throw new AppError('Attendance check-in/out time is invalid', 'HR_ATTENDANCE_TIME_INVALID', 400);
        }
        await sql`
          INSERT INTO hr_attendance_records (tenant_id, account_id, employee_id, work_date, status, check_in_at, check_out_at, source, notes, created_by, updated_by, created_at, updated_at)
          VALUES (
            ${auth.tenantId},
            ${auth.accountId},
            ${employeeId},
            ${workDate}::date,
            ${status},
            ${checkInAt ? checkInAt.toISOString() : null},
            ${checkOutAt ? checkOutAt.toISOString() : null},
            ${normalizeAttendanceSource(row.source)},
            ${clean(row.notes) || null},
            ${auth.userId},
            ${auth.userId},
            NOW(),
            NOW()
          )
          ON CONFLICT (tenant_id, employee_id, work_date) DO UPDATE
          SET
            status = EXCLUDED.status,
            check_in_at = EXCLUDED.check_in_at,
            check_out_at = EXCLUDED.check_out_at,
            source = EXCLUDED.source,
            notes = EXCLUDED.notes,
            updated_by = ${auth.userId},
            updated_at = NOW()
        `.execute(trx);
        await this.refreshAttendanceExceptionForEmployeeDate(trx, employeeId, workDate, auth.tenantId || '');
      }
    });

    await this.audit.log(
      'Save HR attendance day',
      `Attendance saved for ${workDate} by ${auth.username}`,
      auth,
      { idempotencyKey: buildAttendanceDayAuditKey(auth.tenantId || '', workDate, payload.rows) },
    );
    return this.listAttendance({ date: workDate }, auth);
  }

  async upsertAttendanceRecord(payload: UpsertAttendanceRecordDto, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const tenantTimezone = await getTenantTimezone(this.db, auth.tenantId);
    const employeeId = toId(payload.employeeId);
    if (!employeeId) throw new AppError('Employee is required', 'HR_ATTENDANCE_EMPLOYEE_REQUIRED', 400);
    const status = normalizeAttendanceStatus(payload.status);
    if (status === 'unmarked') throw new AppError('Attendance status is invalid', 'HR_ATTENDANCE_STATUS_INVALID', 400);

    let punch: AttendancePunchResolution;
    try {
      punch = resolveAttendancePunch(payload, tenantTimezone, normalizeDateOnly);
    } catch (error) {
      if (error instanceof AttendancePunchError) throw new AppError(error.message, error.code, 400);
      throw error;
    }
    const { checkInAt, checkOutAt, workDate } = punch;
    if (!workDate) throw new AppError('Attendance date is required', 'HR_ATTENDANCE_DATE_REQUIRED', 400);

    const empCheck = await sql<{ status: string }>`SELECT status FROM hr_employees WHERE id = ${employeeId} AND tenant_id = ${auth.tenantId}`.execute(this.db);
    if (empCheck.rows.length === 0 || empCheck.rows[0].status !== 'active') {
      throw new AppError('Employee is not active', 'HR_EMPLOYEE_NOT_ACTIVE', 400);
    }

    // قراءة ثم كتابة: لا بد من معاملة واحدة بقفل على صف اليوم، وإلا بصمتان متزامنتان
    // (نقرة مزدوجة على زر البصمة، أو إعادة محاولة من الموبايل) تتجاوزان حارس
    // "تم تسجيل الحضور بالفعل"، وبدء وردية جديدة مرتين يمحو وردية مكتملة بصمت — F1.
    const auditEntry = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      await this.assertAttendanceDayNotPosted(trx, employeeId, workDate, auth.tenantId || '');
      const existingCheck = await sql<{ check_in_at: Date | null; check_out_at: Date | null; notes: string | null; prior_sessions_minutes: number | null }>`
        SELECT check_in_at, check_out_at, notes, prior_sessions_minutes FROM hr_attendance_records
        WHERE employee_id = ${employeeId} AND work_date = ${workDate}::date AND tenant_id = ${auth.tenantId}
        FOR UPDATE
      `.execute(trx);
      const hasExisting = existingCheck.rows.length > 0;
      const existingRow = hasExisting ? existingCheck.rows[0] : null;

      if (payload.mode === 'cancel_checkout' && hasExisting) {
        await sql`
          UPDATE hr_attendance_records
          SET
            check_out_at = NULL,
            status = 'present',
            updated_by = ${auth.userId},
            updated_at = NOW()
          WHERE employee_id = ${employeeId} AND work_date = ${workDate}::date AND tenant_id = ${auth.tenantId}
        `.execute(trx);
        await this.refreshAttendanceExceptionForEmployeeDate(trx, employeeId, workDate, auth.tenantId || '');
        return {
          action: 'Cancel HR attendance checkout',
          detail: `Checkout cancelled for employee #${employeeId} on ${workDate} by ${auth.username}`,
        };
      }

      // O41: distinguish "no notes in this request" from "clear the notes".
      const notesProvided = payload.notes !== undefined;
      const hasCompletedSession = Boolean(existingRow?.check_in_at && existingRow?.check_out_at);
      if (startsNewSession(payload, hasCompletedSession)) {
        const prevCheckIn = formatTimeInTimezone(existingRow!.check_in_at, tenantTimezone);
        const prevCheckOut = formatTimeInTimezone(existingRow!.check_out_at, tenantTimezone);
        const sessionNote = `وردية سابقة (${prevCheckIn} إلى ${prevCheckOut})`;
        const combinedNotes = combineNotes(existingRow!.notes, sessionNote);
        // D2: accumulate the completed session's minutes on the day row
        // instead of losing them. Only a valid session (positive minutes,
        // at most 24h — the same validity rule hourly pay applies) counts;
        // an invalid prior session contributes 0 and still starts the new
        // session, as before.
        const prevStartMs = existingRow!.check_in_at ? new Date(existingRow!.check_in_at).getTime() : NaN;
        const prevEndMs = existingRow!.check_out_at ? new Date(existingRow!.check_out_at).getTime() : NaN;
        const prevElapsed = Math.floor((prevEndMs - prevStartMs) / 60000);
        const prevMinutes = Number.isFinite(prevElapsed) && prevElapsed > 0 && prevElapsed <= 1440 ? prevElapsed : 0;
        const accumulatedPriorMinutes = Math.max(0, Math.floor(Number(existingRow!.prior_sessions_minutes || 0))) + prevMinutes;

        await sql`
          UPDATE hr_attendance_records
          SET
            check_in_at = ${checkInAt ? checkInAt.toISOString() : new Date().toISOString()},
            check_out_at = NULL,
            status = 'present',
            notes = ${combinedNotes},
            prior_sessions_minutes = ${accumulatedPriorMinutes},
            source = ${normalizeAttendanceSource(payload.source)},
            updated_by = ${auth.userId},
            updated_at = NOW()
          WHERE employee_id = ${employeeId} AND work_date = ${workDate}::date AND tenant_id = ${auth.tenantId}
        `.execute(trx);
        await this.refreshAttendanceExceptionForEmployeeDate(trx, employeeId, workDate, auth.tenantId || '');
        return {
          action: 'New attendance session for HR employee',
          detail: `New session started for employee #${employeeId} on ${workDate} by ${auth.username}`,
        };
      }

      if (checkInAt && !checkOutAt && hasExisting && existingRow?.check_in_at && !existingRow?.check_out_at) {
        throw new AppError('Already checked in', 'HR_ATTENDANCE_ALREADY_CHECKED_IN', 400);
      }

      if (checkOutAt && !checkInAt && (!hasExisting || !existingRow?.check_in_at)) {
        throw new AppError('Cannot check out without check in', 'HR_ATTENDANCE_NO_CHECK_IN', 400);
      }

      await sql`
        INSERT INTO hr_attendance_records (tenant_id, account_id, employee_id, work_date, status, check_in_at, check_out_at, source, notes, created_by, updated_by, created_at, updated_at)
        VALUES (
          ${auth.tenantId},
          ${auth.accountId},
          ${employeeId},
          ${workDate}::date,
          ${status},
          ${checkInAt ? checkInAt.toISOString() : null},
          ${checkOutAt ? checkOutAt.toISOString() : null},
          ${normalizeAttendanceSource(payload.source)},
          ${notesProvided ? clean(payload.notes) || null : null},
          ${auth.userId},
          ${auth.userId},
          NOW(),
          NOW()
        )
        ON CONFLICT (tenant_id, employee_id, work_date) DO UPDATE
        SET
          status = EXCLUDED.status,
          check_in_at = COALESCE(EXCLUDED.check_in_at, hr_attendance_records.check_in_at),
          check_out_at = COALESCE(EXCLUDED.check_out_at, hr_attendance_records.check_out_at),
          source = EXCLUDED.source,
          -- O41: a checkout punch carries no notes, and this used to overwrite the note written at
          -- check-in (or by the previous-session merge) with NULL. Only a notes field that is
          -- actually present in the request changes it, like check_in_at / check_out_at above.
          notes = CASE WHEN ${notesProvided} THEN EXCLUDED.notes ELSE hr_attendance_records.notes END,
          updated_by = ${auth.userId},
          updated_at = NOW()
      `.execute(trx);
      await this.refreshAttendanceExceptionForEmployeeDate(trx, employeeId, workDate, auth.tenantId || '');

      return {
        action: 'Upsert HR attendance record',
        detail: `Attendance record saved for employee #${employeeId} on ${workDate} by ${auth.username}`,
      };
    });

    await this.audit.log(auditEntry.action, auditEntry.detail, auth);
    return this.listAttendance({ date: workDate }, auth);
  }

  async bulkImportAttendanceRecords(payload: BulkImportAttendanceDto, auth: AuthContext): Promise<{ imported: number; skipped: number; errors: string[] }> {
    requireTenantScope(auth);
    if (!payload.records || !payload.records.length) {
      throw new AppError('No records to import', 'HR_ATTENDANCE_IMPORT_EMPTY', 400);
    }

    const employeeNos = [...new Set(payload.records.map((r) => r.employeeNo))];
    if (employeeNos.length === 0) {
      return { imported: 0, skipped: payload.records.length, errors: ['No valid employee codes'] };
    }

    const employeesQuery = await this.db
      .selectFrom('hr_employees')
      .select(['id', 'employee_no', 'status'])
      .where('tenant_id', '=', auth.tenantId!)
      .where('employee_no', 'in', employeeNos)
      .execute();
    const empMap = new Map(employeesQuery.map((e) => [e.employee_no, e]));

    // Tenant today, resolved once for the whole batch (same fence as the
    // single manual edit and bulk save: the open payroll month).
    const tenantTimezone = await getTenantTimezone(this.db, auth.tenantId);
    const todayKey = todayTenantDate(tenantTimezone);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      for (const record of payload.records) {
        const emp = empMap.get(record.employeeNo);
        if (!emp) {
          errors.push(`Employee not found for code: ${record.employeeNo}`);
          skipped++;
          continue;
        }
        if (emp.status !== 'active') {
          errors.push(`Employee ${record.employeeNo} is inactive`);
          skipped++;
          continue;
        }

        const workDate = normalizeDateOnly(record.workDate);
        if (!workDate) {
          errors.push(`Invalid date for employee ${record.employeeNo}`);
          skipped++;
          continue;
        }
        // Same outer fence as the single manual edit: a record outside
        // the open payroll month is skipped with an error, not imported
        // — the batch itself keeps its per-record error pattern.
        if (workDate < firstDayOfTenantMonth(todayKey) || workDate > todayKey) {
          errors.push(`Date outside the open payroll month for employee ${record.employeeNo} on ${workDate}`);
          skipped++;
          continue;
        }
        // Do not partially import a batch that rewrites booked wages: the
        // transaction rolls back and surfaces an explicit payroll-period gate.
        await this.assertAttendanceDayNotPosted(trx, Number(emp.id), workDate, auth.tenantId || '');

        const checkInAt = record.checkInAt ? new Date(record.checkInAt) : null;
        const checkOutAt = record.checkOutAt ? new Date(record.checkOutAt) : null;
        if ((checkInAt && Number.isNaN(checkInAt.getTime())) || (checkOutAt && Number.isNaN(checkOutAt.getTime()))) {
          errors.push(`Invalid time for employee ${record.employeeNo} on ${workDate}`);
          skipped++;
          continue;
        }

        const status = checkInAt ? 'present' : 'absent'; // Basic logic; can be refined

        await sql`
          INSERT INTO hr_attendance_records (tenant_id, account_id, employee_id, work_date, status, check_in_at, check_out_at, source, created_by, updated_by, created_at, updated_at)
          VALUES (
            ${auth.tenantId},
            ${auth.accountId},
            ${emp.id},
            ${workDate}::date,
            ${status},
            ${checkInAt ? checkInAt.toISOString() : null},
            ${checkOutAt ? checkOutAt.toISOString() : null},
            'import',
            ${auth.userId},
            ${auth.userId},
            NOW(),
            NOW()
          )
          ON CONFLICT (tenant_id, employee_id, work_date) DO UPDATE
          SET
            status = EXCLUDED.status,
            check_in_at = COALESCE(EXCLUDED.check_in_at, hr_attendance_records.check_in_at),
            check_out_at = COALESCE(EXCLUDED.check_out_at, hr_attendance_records.check_out_at),
            source = 'import',
            updated_by = ${auth.userId},
            updated_at = NOW()
        `.execute(trx);

        await this.refreshAttendanceExceptionForEmployeeDate(trx, emp.id, workDate, auth.tenantId || '');
        imported++;
      }
    });

    await this.audit.log('Bulk import HR attendance', `Imported ${imported} attendance records by ${auth.username}`, auth);
    return { imported, skipped, errors };
  }

  async listAttendanceExceptions(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.attendanceExceptionsService.listAttendanceExceptions(query, auth);
  }

  async decideAttendanceException(id: number, status: 'approved' | 'skipped', payload: DecideAttendanceExceptionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.attendanceExceptionsService.decideAttendanceException(id, status, payload, auth);
  }

  async listLeaveTypes(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.listLeaveTypes(query, auth);
  }

  async upsertLeaveType(id: number | null, payload: UpsertLeaveTypeDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.upsertLeaveType(id, payload, auth);
  }

  async listLeaveRequests(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.listLeaveRequests(query, auth);
  }

  async createLeaveRequest(payload: CreateLeaveRequestDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.createLeaveRequest(payload, auth);
  }

  async approveLeaveRequest(id: number, payload: DecideLeaveRequestDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.approveLeaveRequest(id, payload, auth);
  }

  async rejectLeaveRequest(id: number, payload: DecideLeaveRequestDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.rejectLeaveRequest(id, payload, auth);
  }

  async cancelLeaveRequest(id: number, payload: DecideLeaveRequestDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.leaveService.cancelLeaveRequest(id, payload, auth);
  }

  async listEmployeeAssets(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.listEmployeeAssets(query, auth);
  }

  async upsertEmployeeAsset(id: number | null, payload: UpsertEmployeeAssetDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.upsertEmployeeAsset(id, payload, auth);
  }

  async returnEmployeeAsset(id: number, payload: EmployeeAssetActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.returnEmployeeAsset(id, payload, auth);
  }

  async markEmployeeAssetLost(id: number, payload: EmployeeAssetActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.markEmployeeAssetLost(id, payload, auth);
  }

  async markEmployeeAssetDamaged(id: number, payload: EmployeeAssetActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.markEmployeeAssetDamaged(id, payload, auth);
  }

  async cancelEmployeeAsset(id: number, payload: EmployeeAssetActionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeeRecordsService.cancelEmployeeAsset(id, payload, auth);
  }

  async withdrawals(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const employeeId = toId(query.employeeId);
    if (!employeeId) throw new AppError('Employee is required', 'HR_WITHDRAWALS_EMPLOYEE_REQUIRED', 400);

    const period = clean(query.period) || 'current_month';
    const requestedMonth = clean(query.month);
    const customFrom = normalizeDateOnly(query.from);
    const customTo = normalizeDateOnly(query.to);

    const employeeResult = await sql<{ hire_date_text: string | null; display_name: string }>`
      SELECT to_char(hire_date, 'YYYY-MM-DD') AS hire_date_text, display_name
      FROM hr_employees
      WHERE id = ${employeeId} AND tenant_id = ${tenantId}
      LIMIT 1
    `.execute(this.db);
    const employee = employeeResult.rows[0];
    if (!employee) throw new AppError('Employee not found', 'HR_EMPLOYEE_NOT_FOUND', 404);

    // Financial date selectors follow the tenant's local calendar, never UTC
    // server midnight (which is a different payroll day in Egypt/GCC).
    const today = todayTenantDate(await getTenantTimezone(this.db, tenantId));
    const currentMonth = today.slice(0, 7);
    if (requestedMonth && !normalizePayrollMonth(requestedMonth)) {
      throw new AppError('الشهر المطلوب غير صحيح', 'HR_WITHDRAWALS_MONTH_INVALID', 400);
    }
    if (period === 'custom' && (
      (query.from && !customFrom) || (query.to && !customTo)
      || (customFrom && customTo && customFrom > customTo)
    )) {
      throw new AppError('نطاق تواريخ المسحوبات غير صحيح', 'HR_WITHDRAWALS_RANGE_INVALID', 400);
    }
    const monthValue = normalizePayrollMonth(requestedMonth) || currentMonth;
    const { from: monthFrom, to: monthTo } = monthRange(monthValue);
    const hireDate = clean(employee.hire_date_text) || '1900-01-01';
    const fromDate = period === 'custom'
      ? customFrom || monthFrom
      : period === 'since_hire'
        ? hireDate
        : period === 'all'
          ? ''
          : monthFrom;
    const toDate = period === 'custom'
      ? customTo || monthTo
      : period === 'since_hire'
        ? today
        : period === 'all'
          ? ''
          : monthTo;

    const loanResult = await sql<Record<string, unknown>>`
      SELECT
        l.*,
        e.display_name AS employee_name,
        COALESCE(NULLIF(actor.display_name, ''), actor.username, 'النظام') AS recorded_by_name,
        latest_paid.latest_paid_at,
        to_char(l.issue_date, 'YYYY-MM-DD') AS issue_date_text,
        to_char(l.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text,
        to_char(l.disbursed_at, 'YYYY-MM-DD HH24:MI') AS disbursed_at_text,
        to_char(latest_paid.latest_paid_at, 'YYYY-MM-DD HH24:MI') AS paid_at_text
      FROM hr_employee_loans l
      JOIN hr_employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
      LEFT JOIN users actor ON actor.id = l.created_by AND actor.tenant_id = l.tenant_id
      LEFT JOIN (
        SELECT loan_id, MAX(paid_at) AS latest_paid_at
        FROM hr_employee_loan_installments
        WHERE paid_at IS NOT NULL AND tenant_id = ${tenantId}
        GROUP BY loan_id
      ) latest_paid ON latest_paid.loan_id = l.id
      WHERE l.employee_id = ${employeeId} AND l.tenant_id = ${tenantId}
      ORDER BY l.id DESC
    `.execute(this.db);

    const ledgerResult = await sql<Record<string, unknown>>`
      SELECT
        le.*,
        e.display_name AS employee_name,
        COALESCE(NULLIF(actor.display_name, ''), actor.username, 'النظام') AS recorded_by_name,
        to_char(le.created_at, 'YYYY-MM-DD HH24:MI') AS movement_at_text
      FROM hr_employee_ledger le
      JOIN hr_employees e ON e.id = le.employee_id AND e.tenant_id = le.tenant_id
      LEFT JOIN users actor ON actor.id = le.created_by AND actor.tenant_id = le.tenant_id
      WHERE le.employee_id = ${employeeId} AND le.tenant_id = ${tenantId}
        AND le.entry_type = 'loan_repayment'
      ORDER BY le.id DESC
    `.execute(this.db);

    const movementDateForLoan = (row: Record<string, unknown>): string => {
      const status = clean(row.status);
      const issueDate = clean(row.issue_date_text) || (row.issue_date ? String(row.issue_date).slice(0, 10) : '');
      const issueDateTime = issueDate ? `${issueDate} 00:00` : '';
      const createdAt = clean(row.created_at_text) || (row.created_at ? String(row.created_at).replace('T', ' ').slice(0, 16) : '');
      const disbursedAt = clean(row.disbursed_at_text) || (row.disbursed_at ? String(row.disbursed_at).replace('T', ' ').slice(0, 16) : '');
      const paidAt = clean(row.paid_at_text) || (row.paid_at ? String(row.paid_at).replace('T', ' ').slice(0, 16) : '') || (row.latest_paid_at ? String(row.latest_paid_at).replace('T', ' ').slice(0, 16) : '');

      if (['paid', 'disbursed', 'partially_repaid', 'repaid'].includes(status)) {
        // Repayment dates must NOT replace the original disbursement date.
        // Otherwise old withdrawals jump between months when installments are paid.
        return disbursedAt || createdAt || issueDateTime;
      }

      return issueDateTime || createdAt;
    };

    const isInsideRequestedPeriod = (movementAt: string): boolean => {
      if (!movementAt) return false;
      if (!fromDate && !toDate) return true;
      const datePart = movementAt.slice(0, 10);
      if (fromDate && datePart < fromDate) return false;
      if (toDate && datePart > toDate) return false;
      return true;
    };

    const allLoanRows = loanResult.rows.map((row) => {
      const movementAt = movementDateForLoan(row);
      return {
        id: `loan-${String(row.id)}`,
        loanId: String(row.id),
        referenceId: String(row.id),
        employeeId: String(row.employee_id),
        employeeName: clean(row.employee_name),
        movementAt,
        date: movementAt,
        type: clean(row.loan_type) === 'loan' ? 'loan' : 'advance',
        amount: Number(row.principal_amount || 0),
        repaymentMode: clean(row.repayment_mode) || 'manual_cash',
        repaymentMethod: '',
        status: clean(row.status) || 'draft',
        remainingAmount: Number(row.remaining_amount || 0),
        note: clean(row.notes),
        recordedByName: clean(row.recorded_by_name),
      };
    });

    const repaymentRows = ledgerResult.rows.map((row) => {
      const movementAt = clean(row.movement_at_text) || (row.created_at ? String(row.created_at).replace('T', ' ').slice(0, 16) : '');
      const repaymentMethod = clean(row.repayment_method) || 'manual_cash';
      return {
        id: `ledger-${String(row.id)}`,
        loanId: row.reference_id ? String(row.reference_id) : '',
        referenceId: row.reference_id ? String(row.reference_id) : '',
        employeeId: String(row.employee_id),
        employeeName: clean(row.employee_name),
        movementAt,
        date: movementAt,
        type: 'repayment',
        amount: Math.abs(Number(row.amount || 0)),
        repaymentMode: repaymentMethod,
        repaymentMethod,
        status: 'recorded',
        remainingAmount: Number(row.balance_after || 0),
        note: clean(row.note),
        recordedByName: clean(row.recorded_by_name),
      };
    });

    const rows = [...allLoanRows.filter(row => ['paid', 'disbursed', 'partially_repaid', 'repaid'].includes(row.status)), ...repaymentRows]
      .filter((row) => isInsideRequestedPeriod(row.movementAt))
      .sort((a, b) => {
        const byDate = String(b.movementAt || '').localeCompare(String(a.movementAt || ''));
        if (byDate !== 0) return byDate;
        return String(b.id).localeCompare(String(a.id));
      });

    const totalWithdrawals = Number(rows
      .filter((row) => row.type !== 'repayment')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
      .toFixed(2));
    const totalRepayments = Number(rows
      .filter((row) => row.type === 'repayment')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
      .toFixed(2));
    const totalManualCashRepayments = Number(rows
      .filter((row) => row.type === 'repayment' && row.repaymentMethod === 'manual_cash')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
      .toFixed(2));
    const totalSalaryDeductionRepayments = Number(rows
      .filter((row) => row.type === 'repayment' && row.repaymentMethod === 'salary_deduction')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0)
      .toFixed(2));
    const totalRemaining = Number(allLoanRows
      .filter(row => ['paid', 'disbursed', 'partially_repaid'].includes(row.status))
      .reduce((sum, row) => sum + Number(row.remainingAmount || 0), 0)
      .toFixed(2));
    const totalSalaryDeductionDue = Number(allLoanRows
      .filter((row) => ['paid', 'disbursed', 'partially_repaid'].includes(row.status) && row.repaymentMode !== 'manual_cash')
      .reduce((sum, row) => sum + Number(row.remainingAmount || 0), 0)
      .toFixed(2));
    const openLoanCount = allLoanRows.filter((row) => ['paid', 'disbursed', 'partially_repaid'].includes(String(row.status || '')) && Number(row.remainingAmount || 0) > 0).length;

    const paged = paginateRows(rows, query, { defaultSize: 50 });

    return {
      rows: paged.rows,
      pagination: paged.pagination,
      summary: {
        employeeId: String(employeeId),
        employeeName: clean(employee.display_name),
        from: fromDate || '',
        to: toDate || '',
        totalWithdrawals,
        withdrawalsAmount: totalWithdrawals,
        withdrawnAmount: totalWithdrawals,
        totalRepayments,
        repaymentsAmount: totalRepayments,
        repaidAmount: totalRepayments,
        totalManualCashRepayments,
        manualCashRepaymentsTotal: totalManualCashRepayments,
        totalSalaryDeductionRepayments,
        salaryDeductionRepaymentsTotal: totalSalaryDeductionRepayments,
        totalSalaryDeductionDue,
        totalRemaining,
        remainingAmount: totalRemaining,
        outstandingAmount: totalRemaining,
        openLoanCount,
        openLoans: openLoanCount,
      },
    };
  }

  async summary(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.summary(auth);
  }

  async reportsSummary(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.reportsSummary(query, auth);
  }

  async getEmployeeWithdrawalBalance(employeeId: number, auth: AuthContext): Promise<EmployeeWithdrawalBalanceResult> {
    const { tenantId } = requireTenantScope(auth);
    if (!employeeId || employeeId <= 0) throw new AppError('Employee ID is required', 'HR_EMPLOYEE_ID_REQUIRED', 400);

    const tenantTimezone = await getTenantTimezone(this.db, tenantId);
    const bookDigits = await tenantBookDigits(this.db, tenantId);
    const tenantCurrency = await tenantCurrencyCode(this.db, tenantId);
    const payrollPolicies = await this.getPayrollPolicies(this.db, tenantId);
    const today = todayTenantDate(tenantTimezone);
    const currentMonthPrefix = today.slice(0, 7);
    const monthStart = `${currentMonthPrefix}-01`;

    // Concurrently fetch employee profile, active contract, active payroll item, punches, loans, and past unpaid runs
    const [empRes, contractRes, activeRunItemRes, punchesRes, loansRes, unpaidItemsRes] = await Promise.all([
      // 1. Employee Basic Info
      sql<any>`
        SELECT id, employee_no, display_name, compensation_type, pay_frequency,
               hourly_rate, expected_daily_hours, to_char(hire_date, 'YYYY-MM-DD') AS hire_date, status
        FROM hr_employees
        WHERE id = ${employeeId} AND tenant_id = ${tenantId}
        LIMIT 1
      `.execute(this.db),

      // 2. Active or Latest Employment Contract
      sql<{ base_salary: string | number; currency: string }>`
        SELECT base_salary, currency
        FROM hr_employment_contracts
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, start_date DESC NULLS LAST, id DESC
        LIMIT 1
      `.execute(this.db),

      // 3. Active Unpaid Payroll Item (draft, reviewed, approved but not yet marked 'paid')
      sql<any>`
        SELECT i.id, i.run_id, r.status AS run_status, r.period_month,
               to_char(r.start_date, 'YYYY-MM-DD') AS period_start_date,
               to_char(r.end_date, 'YYYY-MM-DD') AS period_end_date,
               COALESCE(i.base_salary, 0) AS base_salary,
               COALESCE(i.allowance_amount, 0) AS allowance_amount,
               COALESCE(i.gross_pay, 0) AS gross_pay,
               COALESCE(i.deduction_amount, 0) AS deduction_amount,
               COALESCE(i.loan_deduction_amount, 0) AS loan_deduction_amount,
               COALESCE(i.net_pay, 0) AS net_pay
        FROM hr_payroll_run_items i
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        WHERE i.employee_id = ${employeeId} AND i.tenant_id = ${tenantId}
          AND r.status IN ('draft', 'reviewed', 'approved', 'partially_paid')
          AND i.status <> 'excluded'
        ORDER BY r.id DESC LIMIT 1
      `.execute(this.db),

      // 4. Punches for current month
      sql<any>`
        SELECT status, check_in_at, check_out_at, to_char(work_date, 'YYYY-MM-DD') AS work_date_text
        FROM hr_attendance_records
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
          AND work_date >= ${monthStart}::date AND work_date <= ${today}::date
        ORDER BY work_date ASC, check_in_at ASC
      `.execute(this.db),

      // 5. Outstanding loans & advances
      sql<any>`
        SELECT id, loan_type, principal_amount, remaining_amount,
               to_char(issue_date, 'YYYY-MM-DD') AS issue_date, status
        FROM hr_employee_loans
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
          AND status IN ('paid', 'partially_repaid', 'disbursed')
          AND remaining_amount > 0
      `.execute(this.db),

      // 6. Unpaid past approved items from completed runs
      sql<any>`
        SELECT i.id, i.net_pay, i.gross_pay
        FROM hr_payroll_run_items i
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        WHERE i.employee_id = ${employeeId} AND i.tenant_id = ${tenantId}
          AND r.status IN ('approved', 'partially_paid') AND i.status NOT IN ('excluded', 'paid')
      `.execute(this.db),
    ]);

    const emp = empRes.rows[0];
    if (!emp) throw new AppError('الموظف غير موجود أو لا يتبع المنشأة الحالية', 'HR_EMPLOYEE_NOT_FOUND', 404);

    const contract = contractRes.rows[0];
    const activeItem = activeRunItemRes.rows[0];
    const payFreq = clean(emp.pay_frequency) || 'monthly';

    const [yStr, mStr] = currentMonthPrefix.split('-');
    const lastDayOfMonth = new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate();
    const monthEnd = `${currentMonthPrefix}-${String(lastDayOfMonth).padStart(2, '0')}`;

    const cycleStart = activeItem?.period_start_date || (payFreq === 'daily' ? today : monthStart);
    const cycleEnd = activeItem?.period_end_date || (payFreq === 'daily' ? today : monthEnd);
    const startMs = new Date(cycleStart + 'T00:00:00Z').getTime();
    const todayMs = new Date(today + 'T00:00:00Z').getTime();
    const daysElapsed = Math.max(1, Math.floor((todayMs - startMs) / 86400000) + 1);

    const result = calculateEmployeeWithdrawalBalance({
      employee: {
        id: Number(emp.id),
        employeeNo: emp.employee_no || undefined,
        displayName: emp.display_name,
        compensationType: emp.compensation_type || 'monthly',
        payFrequency: emp.pay_frequency || 'monthly',
        hourlyRate: Number(emp.hourly_rate || 0),
        expectedDailyHours: Number(emp.expected_daily_hours || 8),
        hireDate: emp.hire_date || undefined,
        status: emp.status || 'active',
      },
      contract: contract ? {
        baseSalary: Number(contract.base_salary || 0),
        currency: contract.currency,
      } : undefined,
      activePayrollItem: activeItem ? {
        id: Number(activeItem.id),
        runId: Number(activeItem.run_id),
        periodMonth: activeItem.period_month,
        runStatus: activeItem.run_status,
        itemStatus: activeItem.status,
        baseSalary: Number(activeItem.base_salary || 0),
        allowanceAmount: Number(activeItem.allowance_amount || 0),
        grossPay: Number(activeItem.gross_pay || 0),
        deductionAmount: Number(activeItem.deduction_amount || 0),
        loanDeductionAmount: Number(activeItem.loan_deduction_amount || 0),
        netPay: Number(activeItem.net_pay || 0),
      } : undefined,
      currentCycle: {
        cycleStart,
        cycleEnd,
        daysElapsed,
      },
      punches: punchesRes.rows || [],
      priorLoans: loansRes.rows || [],
      unpaidApprovedPayrollItems: unpaidItemsRes.rows || [],
      todayDate: today,
      minorUnits: bookDigits,
      directAdvanceCashCap: resolveDirectAdvanceCashCap(payrollPolicies, contract?.currency || tenantCurrency),
    });

    return result;
  }

  async createQuickCashAdvance(payload: any, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId, accountId } = requireTenantScope(auth);
    const employeeId = Number(payload.employeeId);
    const amount = Number(payload.amount);
    // INV-WAGE-PAYOUT-PAYROLL-JOURNAL: the amount gate runs at the
    // tenant's book precision, not a hard-coded 2 decimals — a KWD
    // wage payout of 5000.125 is a lawful amount on a 3-decimal
    // tenant and must not be rejected here.
    const bookDigits = await tenantBookDigits(this.db, tenantId);
    if (!employeeId || employeeId <= 0) throw new AppError('Employee ID is required', 'HR_EMPLOYEE_ID_REQUIRED', 400);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || Math.abs(roundMoney(amount, bookDigits) - amount) > 0.000001) {
      throw new AppError('مبلغ السلفة يجب أن يكون موجبًا وبدقة عملة المنشأة', 'HR_AMOUNT_INVALID', 400);
    }

    const reason = clean(payload.notes);
    if (!reason) throw new AppError('تفاصيل المسحوب وسبب الصرف مطلوبة', 'HR_ADVANCE_REASON_REQUIRED', 400);

    const actionType = String(payload.actionType || 'advance').trim();
    const isWagePayout = actionType === 'wage_payout';

    // Verify employee withdrawal eligibility and balance
    const withdrawalBalance = await this.getEmployeeWithdrawalBalance(employeeId, auth);
    const isCallerAdmin = ['admin', 'super_admin'].includes(String(auth.role || '').trim());
    const isPayoutDue = withdrawalBalance.schedule?.isPayoutDue ?? true;
    const isEarlyWagePayout = isWagePayout && !isPayoutDue;
    const isAdvanceOverDirectCap = !isWagePayout && amount > withdrawalBalance.maxDirectAdvance;
    const isOverdraft = amount > withdrawalBalance.netAvailableBalance;

    // Direct disbursement without manager approval:
    // Tab 1 (Advance): allowed only if amount <= maxDirectAdvance (50% max of accrued net, capped at 2,000 EGP)
    // Tab 2 (Wage Payout): allowed only if period payout is due and amount <= netAvailableBalance
    const isDirectAllowed = isWagePayout
      ? (isPayoutDue && withdrawalBalance.netAvailableBalance > 0 && amount <= withdrawalBalance.netAvailableBalance)
      : (withdrawalBalance.maxDirectAdvance > 0 && amount <= withdrawalBalance.maxDirectAdvance);
    const isDirectDisbursement = isDirectAllowed;

    let managerApprovalTag = '';
    if (isDirectAllowed) {
      managerApprovalTag = isWagePayout
        ? `[صرف وتصفية مستحقات أجر الفترة (المصروف: ${amount})]`
        : `[مسحوب من الرصيد المباشر (المتاح: ${withdrawalBalance.netAvailableBalance} - سقف الكاشير: ${withdrawalBalance.maxDirectAdvance})]`;
    } else {
      // Overdraft advance, advance exceeding cashier cap, or early wage payout: requires manager password or admin caller
      if (isCallerAdmin) {
        managerApprovalTag = isEarlyWagePayout
          ? `[تسوية وصرف أجر مبكر معتمد من الإدارة: ${auth.username || 'المدير'}]`
          : isWagePayout
            ? `[صرف أجر استثنائي معتمد من الإدارة: ${auth.username || 'المدير'}]`
            : isAdvanceOverDirectCap && !isOverdraft
              ? `[سلفة استثنائية معتمدة من الإدارة: ${auth.username || 'المدير'}]`
              : `[سلفة على المكشوف معتمدة من الإدارة: ${auth.username || 'المدير'}]`;
      } else {
        const enteredPassword = String(payload.managerPassword || '').trim();
        if (!enteredPassword) {
          if (isEarlyWagePayout) {
            throw new AppError(
              `موعد استحقاق الراتب الدوري لم يحن بعد (القادم: ${withdrawalBalance.schedule?.nextPayoutDate})؛ يلزم إدخال رمز أو كلمة مرور المدير للاعتماد كـ تسوية مبكرة`,
              'HR_EARLY_PAYOUT_REQUIRES_MANAGER_APPROVAL',
              403,
            );
          }
          if (isAdvanceOverDirectCap && !isOverdraft) {
            throw new AppError(
              `قيمة السلفة (${amount} ${withdrawalBalance.currencyLabel}) تتجاوز الحد الأقصى للصرف المباشر للكاشير (${withdrawalBalance.maxDirectAdvance} ${withdrawalBalance.currencyLabel} - 50% من الرصيد)؛ يلزم إدخال رمز أو كلمة مرور المدير للاعتماد الاستثنائي`,
              'HR_ADVANCE_OVER_DIRECT_CAP_REQUIRES_MANAGER_APPROVAL',
              403,
            );
          }
          throw new AppError(
            `المبلغ المطلوب (${amount} ${withdrawalBalance.currencyLabel}) يتجاوز الرصيد المستحق للموظف (${withdrawalBalance.netAvailableBalance} ${withdrawalBalance.currencyLabel})؛ يلزم إدخال رمز أو كلمة مرور المدير لاعتماد سلفة على المكشوف`,
            'HR_ADVANCE_MANAGER_APPROVAL_REQUIRED',
            403,
          );
        }

        // Verify manager password
        let authorizedByName = '';
        const managerPinSetting = await sql<{ value: string }>`
          SELECT value FROM settings WHERE tenant_id = ${tenantId} AND key = 'pos_manager_pin' LIMIT 1
        `.execute(this.db);
        const pin = clean(managerPinSetting.rows[0]?.value).replace(/^"|"$/g, '');

        if (pin && enteredPassword === pin) {
          authorizedByName = 'رمز المدير (PIN)';
        } else {
          const adminUsers = await sql<{ id: number; username: string; display_name: string; password_hash: string; password_salt: string }>`
            SELECT id, username, display_name, password_hash, password_salt
            FROM users
            WHERE tenant_id = ${tenantId} AND is_active = true AND role IN ('admin', 'super_admin')
          `.execute(this.db);

          for (const admin of adminUsers.rows) {
            const check = await verifyPassword(enteredPassword, String(admin.password_hash || ''), String(admin.password_salt || ''));
            if (check.valid) {
              authorizedByName = clean(admin.display_name) || clean(admin.username) || 'المدير';
              break;
            }
          }
        }

        if (!authorizedByName) {
          throw new AppError('كلمة مرور المدير غير صحيحة', 'HR_ADVANCE_MANAGER_PASSWORD_INVALID', 400);
        }

        managerApprovalTag = isEarlyWagePayout
          ? `[تسوية وصرف أجر مبكر معتمد برمز المدير: ${authorizedByName}]`
          : isAdvanceOverDirectCap && !isOverdraft
            ? `[سلفة استثنائية معتمدة برمز المدير: ${authorizedByName}]`
            : `[سلفة على المكشوف معتمدة برمز المدير: ${authorizedByName}]`;
      }
    }

    const localLoanDate = todayTenantDate(await getTenantTimezone(this.db, tenantId));
    const baseNotes = payload.shiftId ? `${reason} [وردية كاشير #${Number(payload.shiftId)}]` : reason;
    const notes = `${baseNotes} ${managerApprovalTag}`.trim();
    let createdLoanId = 0;
    let paidRunItemId = 0;
    let wageJournalEntryId: number | null = null;
    
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      // 1. Validate employee is active in this tenant
      const employee = await trx.selectFrom('hr_employees')
        .select(['id', 'display_name', 'status', 'compensation_type', 'hourly_rate', 'expected_daily_hours'])
        .where('id', '=', employeeId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!employee) throw new AppError('الموظف غير موجود أو لا يتبع المنشأة الحالية', 'HR_EMPLOYEE_NOT_FOUND', 404);
      if (employee.status !== 'active') throw new AppError('لا يمكن صرف سلفة لموظف غير نشط', 'HR_EMPLOYEE_INACTIVE', 400);

      // Wage payout only (INV-WAGE-PAYOUT-PAYROLL-JOURNAL): resolve
      // the latest approved run item BEFORE any cash moves. A wage
      // payout settles that item in full — no loan row, no
      // installments — so the amount must equal the item's net pay
      // at book precision, and an approved item must exist at all.
      // Both failures are fail-closed here, inside the transaction,
      // before the drawer is touched.
      let wageItem: { id: number; run_id: number; net_pay: number } | null = null;
      if (isWagePayout) {
        const approvedItem = await sql<{ id: number; run_id: number; net_pay: number }>`
          SELECT i.id, i.run_id, i.net_pay
          FROM hr_payroll_run_items i
          JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
          WHERE i.employee_id = ${employeeId} AND i.tenant_id = ${tenantId}
            AND r.status IN ('approved', 'partially_paid') AND i.status = 'approved'
          ORDER BY r.id DESC LIMIT 1
        `.execute(trx);
        if (!approvedItem.rows.length) {
          throw new AppError('لا يوجد بند أجر معتمد لصرف مستحقاته', 'HR_WAGE_PAYOUT_NO_APPROVED_ITEM', 400);
        }
        wageItem = approvedItem.rows[0];
        paidRunItemId = wageItem.id;
        const itemNetPay = roundMoney(Number(wageItem.net_pay || 0), bookDigits);
        if (itemNetPay <= 0) {
          throw new AppError('صافي أجر الموظف صفر أو سالب', 'HR_PAYROLL_AMOUNT_ZERO', 400);
        }
        if (Math.abs(roundMoney(amount, bookDigits) - itemNetPay) > 0.000001) {
          throw new AppError('مبلغ صرف الأجر يجب أن يساوي صافي الأجر المعتمد بالكامل', 'HR_WAGE_PAYOUT_AMOUNT_MISMATCH', 400);
        }
      }

      // 2. Check cumulative active debt
      const activeRes = await sql<{ total_debt: string }>`
        SELECT COALESCE(SUM(remaining_amount), 0) AS total_debt
        FROM hr_employee_loans
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
          AND status IN ('approved', 'paid', 'partially_repaid', 'disbursed')
      `.execute(trx);
      const activeDebt = Number(activeRes.rows[0]?.total_debt || 0);

      // Ceiling check: Contract salary, or hourly estimation, or 5,000 min
      let baseSalary = 0;
      if (employee.compensation_type === 'hourly') {
        const estMonthly = Number(employee.hourly_rate || 0) * Number(employee.expected_daily_hours || 8) * 26;
        baseSalary = Math.max(5000, estMonthly);
      } else {
        const contract = await trx.selectFrom('hr_employment_contracts')
          .select('base_salary')
          .where('employee_id', '=', employeeId)
          .where('tenant_id', '=', tenantId)
          .where('status', '=', 'active')
          .where('start_date', '<=', localLoanDate)
          .where(eb => eb.or([eb('end_date', 'is', null), eb('end_date', '>=', localLoanDate)]))
          .orderBy('start_date', 'desc')
          .executeTakeFirst();
        baseSalary = Number(contract?.base_salary || 0);
      }
      const quickCap = baseSalary > 0 ? baseSalary : 5000;

      if (!isWagePayout && activeDebt + amount > quickCap) {
        throw new AppError(
          `قيمة السلفة السريعة تتجاوز سقف الراتب الشهري المسموح (${quickCap} - القائم: ${activeDebt})`,
          'HR_QUICK_ADVANCE_EXCEEDS_CAP',
          400
        );
      }

      let loanId = 0;
      if (!isWagePayout) {
        const tempNo = `LOAN-TMP-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const loanRes = await sql<{ id: number }>`
          INSERT INTO hr_employee_loans (
            tenant_id, account_id, employee_id, loan_no, loan_type, principal_amount, remaining_amount, 
            installment_count, installment_amount, repayment_mode,
            issue_date, disbursed_at, status, notes, created_by, updated_by
          )
          VALUES (
            ${tenantId}, ${accountId}, ${employeeId}, ${tempNo}, 'advance', ${amount}, ${amount}, 
            1, ${amount}, 'deduct_next_salary',
            ${localLoanDate}::date, NOW(), 'paid', ${notes}, ${auth.userId}, ${auth.userId}
          )
          RETURNING id
        `.execute(trx);
        loanId = Number(loanRes.rows[0]?.id || 0);
        createdLoanId = loanId;

        const canonicalNo = formatDailyDocumentNumber('LOAN', loanId, new Date(), 4, await getTenantTimezone(trx, tenantId));
        await sql`UPDATE hr_employee_loans SET loan_no = ${canonicalNo} WHERE id = ${loanId} AND tenant_id = ${tenantId}`.execute(trx);
      
        const dueStr = localLoanDate;
      
        await sql`
          INSERT INTO hr_employee_loan_installments (
            tenant_id, account_id, loan_id, installment_no, due_date, 
            amount, status
          )
          VALUES (
            ${tenantId}, ${accountId}, ${loanId}, 1, ${dueStr}, 
            ${amount}, 'pending'
          )
        `.execute(trx);
      }

      if (!isWagePayout) {
        // 3. Record in employee ledger
        await sql`
          INSERT INTO hr_employee_ledger (
            employee_id, entry_type, amount, balance_after, note, reference_type, reference_id,
            created_by, tenant_id, account_id
          )
          VALUES (
            ${employeeId}, 'loan_disbursement', ${amount}, ${activeDebt + amount},
            ${notes}, 'hr_employee_loan', ${loanId}, ${auth.userId}, ${tenantId}, ${accountId}
          )
        `.execute(trx);
      }

      // 4. Handle shift cash deduction if shift ID is provided
      // (Captured for the wage-payout journal below: the cash source
      // is always a drawer — a missing shift throws in this block.)
      let payoutShiftId: number | null = null;
      let payoutBranchId: number | null = null;
      let payoutLocationId: number | null = null;
      if (payload.shiftId) {
        const shiftId = Number(payload.shiftId);
        const eligibleShift = await sql<{ id: number; branch_id: number | null; location_id: number | null; opened_by: number; expected_cash: string | number }>`
          SELECT id, branch_id, location_id, opened_by, COALESCE(expected_cash, 0) AS expected_cash FROM cashier_shifts
          WHERE id = ${shiftId} AND tenant_id = ${tenantId} AND status = 'open'
            AND (opened_by = ${auth.userId} OR ${['admin', 'super_admin', 'owner', 'manager'].includes(auth.role)} OR ${Boolean(auth.permissions?.includes('hr') || auth.permissions?.includes('hrLoans') || auth.permissions?.includes('hrPayrollManage'))})
          FOR UPDATE
        `.execute(trx);
        if (!eligibleShift.rows.length) throw new AppError('وردية الكاشير غير مفتوحة أو لا تخص المستخدم الحالي', 'HR_CASHIER_SHIFT_INVALID', 400);
        const shift = eligibleShift.rows[0];
        payoutShiftId = shiftId;
        payoutBranchId = shift.branch_id;
        payoutLocationId = shift.location_id;
        const drawerCash = this.cashDrawer
          ? await this.cashDrawer.computeShiftExpectedCash(shiftId, auth, trx)
          : Number(shift.expected_cash || 0);

        if (amount > drawerCash && !isCallerAdmin && !managerApprovalTag.includes('المدير')) {
          throw new AppError(
            `النقدية المتاحة في درج الوردية (${drawerCash.toLocaleString('en-US')} ج.م) غير كافية لصرف هذا المبلغ (${amount.toLocaleString('en-US')} ج.م)؛ يلزم إيداع نقدية أو اعتماد المدير للصرف الاستثنائي`,
            'HR_DRAWER_INSUFFICIENT_CASH',
            400
          );
        }

        const cashierUser = await sql<{ name: string }>`
          SELECT COALESCE(NULLIF(display_name, ''), username) as name
          FROM users
          WHERE id = ${shift.opened_by} AND tenant_id = ${tenantId}
          LIMIT 1
        `.execute(trx);
        const cashierName = cashierUser.rows[0]?.name || 'الكاشير';

        const txnNote = isWagePayout
          ? `صرف راتب/أجر موظف #${employeeId} (${employee.display_name}) من درج (${cashierName} - وردية #${shiftId})، سند #${loanId}: ${notes}`
          : `سلفة موظف #${employeeId} (${employee.display_name}) من درج (${cashierName} - وردية #${shiftId})، حركة #${loanId}: ${notes}`;
        await sql`
          INSERT INTO treasury_transactions (
            tenant_id, account_id, txn_type, amount, payment_channel, note, reference_type,
            reference_id, branch_id, location_id, created_by
          ) VALUES (
            ${tenantId}, ${accountId}, 'cash_out', ${-amount}, 'cash',
            ${txnNote},
            'cashier_shift', ${shiftId}, ${shift.branch_id}, ${shift.location_id}, ${auth.userId}
          )
        `.execute(trx);
        await sql`
          UPDATE cashier_shifts
          SET expected_cash = ${drawerCash - amount}
          WHERE id = ${shiftId} AND tenant_id = ${tenantId} AND status = 'open'
        `.execute(trx);
      } else {
        throw new AppError('حدد وردية كاشير مفتوحة أو خزينة لصرف السلفة', 'HR_ADVANCE_CASH_SOURCE_REQUIRED', 400);
      }

      // Wage payout (INV-WAGE-PAYOUT-PAYROLL-JOURNAL): settle the
      // approved run item through the per-item payroll payment
      // journal (Dr 2140 / Cr 1110) — never a loan, never
      // installments. The item was resolved and the amount checked
      // against its net pay before any cash moved, above.
      if (isWagePayout && wageItem) {
        const { journalEntryId } = await this.accountingPosting.postPayrollItemPayment(
          trx,
          wageItem.id,
          'drawer',
          auth,
          { employeeName: employee.display_name, branchId: payoutBranchId, locationId: payoutLocationId },
        );
        wageJournalEntryId = journalEntryId;
        await sql`
          UPDATE hr_payroll_run_items
          SET status = 'paid', paid_at = NOW(), paid_by = ${auth.userId},
            payment_channel = 'drawer', payment_reference = NULL,
            shift_id = ${payoutShiftId}, journal_entry_id = ${journalEntryId || null},
            updated_at = NOW()
          WHERE id = ${wageItem.id} AND tenant_id = ${tenantId}
        `.execute(trx);
        await sql`
          INSERT INTO hr_employee_ledger (
            employee_id, entry_type, amount, balance_after, note, reference_type, reference_id,
            created_by, tenant_id, account_id
          )
          VALUES (
            ${employeeId}, 'wage_payout', ${amount}, 0,
            ${notes}, 'hr_payroll_run_item', ${wageItem.id}, ${auth.userId}, ${tenantId}, ${accountId}
          )
        `.execute(trx);
      }

      // 5. Record GL journal for an advance: Dr. 1160 (Advances) /
      // Cr. 1110 (Cash). Wage payouts post their own 2140 journal
      // above and never reach this call.
      if (!isWagePayout) {
        await this.accountingPosting.postEmployeeLoanDisbursement(trx, loanId, auth);
      }

      if (!isWagePayout) {
        // 6. Auto-rebuild active draft/reviewed payroll runs so the advance reflects in payroll immediately
        const activeRuns = await sql<{ id: number; status: string }>`
          SELECT id, status
          FROM hr_payroll_runs
          WHERE tenant_id = ${tenantId}
            AND status IN ('draft', 'reviewed')
            AND end_date >= ${localLoanDate}::date
            AND EXISTS (
              SELECT 1 FROM hr_payroll_run_items item
              WHERE item.run_id = hr_payroll_runs.id
                AND item.tenant_id = ${tenantId}
                AND item.employee_id = ${employeeId}
                AND item.status <> 'excluded'
            )
          ORDER BY id DESC
        `.execute(trx);
        for (const run of activeRuns.rows) {
          const runId = Number(run.id);
          await this.rebuildPayrollRunItems(trx, runId, 'draft', auth.tenantId || tenantId);
          if (run.status === 'reviewed') {
            await this.invalidatePayrollRunReview(trx, runId, tenantId);
          }
        }
      }
    });

    await this.audit.log(
      'Create Quick Cash Advance',
      isWagePayout
        ? `Wage payout for run item #${paidRunItemId} of ${amount} for employee #${employeeId} by ${auth.username}`
        : `Cash advance #${createdLoanId} of ${amount} for employee #${employeeId} by ${auth.username}`,
      auth,
    );
    return { success: true, loanId: createdLoanId || null, isDirectDisbursement, payrollRunItemId: paidRunItemId || null, journalEntryId: wageJournalEntryId };
  }
}

