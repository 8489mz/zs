import { Inject, Injectable, Optional } from '@nestjs/common';
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
import { getTenantTimezone, todayTenantDate } from '../../common/utils/tenant-timezone.util';
import { calculatePayrollLoanDueTotal, requireLoanMoney } from './payroll-loan-allocation.engine';
import { MoneyDigits, currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';
import { calculateHourlyOvertimePremium } from './engines/payroll-calculation.engine';
import { calculateHrPayrollRunLine, requirePayrollMonetaryCurrency, requireStoredHrMoney, canReincludeAutoExcludedPayrollItem, AUTO_PAYROLL_EXCLUSION_NOTE } from './engines/hr-payroll-run.engine';
import { validateHrStatutoryPolicy,   type HrStatutoryPolicy } from './engines/hr-statutory-policy.engine';
import { summarizeHourlyAttendance, calculateEffectiveContractPay, calculateEffectiveCompensationPay, calculateDatedPayrollAdjustment, payrollCalendarMonthFraction,   type EffectiveSalaryContract, type EffectiveCompensationPackage } from './engines/hourly-attendance-pay.engine';
import { type EmployeeWithdrawalBalanceResult } from './engines/employee-withdrawal-balance.engine';
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
  normalizeTimeOnly,
  timeToMinutes,
  inclusiveDaysBetween,
} from './hr-helpers';
import { HrAttendanceRecordsService } from './services/hr-attendance-records.service';
import { HrPayrollReviewService } from './services/hr-payroll-review.service';
import { HrPayrollRebuildService } from './services/hr-payroll-rebuild.service';
import { HrPayrollRunsService } from './services/hr-payroll-runs.service';
import { HrEmployeesService } from './services/hr-employees.service';
import { HrAdvancesService } from './services/hr-advances.service';
import { HrPayrollPostingService } from './services/hr-payroll-posting.service';

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

  private readonly attendanceRecordsService: HrAttendanceRecordsService;

  private readonly payrollReviewService: HrPayrollReviewService;

  private readonly payrollRebuildService: HrPayrollRebuildService;

  private readonly payrollRunsService: HrPayrollRunsService;

  private readonly employeesService: HrEmployeesService;

  private readonly advancesService: HrAdvancesService;

  private readonly payrollPostingService: HrPayrollPostingService;

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
    this.attendanceRecordsService = new HrAttendanceRecordsService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      tenantPredicate: this.tenantPredicate.bind(this),
      refreshAttendanceExceptionForEmployeeDate:
        this.attendanceExceptionsService.refreshAttendanceExceptionForEmployeeDate.bind(
          this.attendanceExceptionsService,
        ),
    });
    this.payrollReviewService = new HrPayrollReviewService({
      getPayrollPolicies: this.getPayrollPolicies.bind(this),
    });
    this.payrollRebuildService = new HrPayrollRebuildService({
      getPayrollPolicies: this.getPayrollPolicies.bind(this),
      calculatePayrollOperationalReview: this.payrollReviewService.calculatePayrollOperationalReview.bind(
        this.payrollReviewService,
      ),
    });
    this.payrollRunsService = new HrPayrollRunsService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      rebuildPayrollRunItems: this.payrollRebuildService.rebuildPayrollRunItems.bind(this.payrollRebuildService),
      calculatePayrollOperationalReview: this.payrollReviewService.calculatePayrollOperationalReview.bind(
        this.payrollReviewService,
      ),
    });
    this.employeesService = new HrEmployeesService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      scope: this.scope.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
      assertEmployeeBelongsToTenant: this.assertEmployeeBelongsToTenant.bind(this),
      listCompensation: this.employeeRecordsService.listCompensation.bind(this.employeeRecordsService),
      listContacts: this.employeeRecordsService.listContacts.bind(this.employeeRecordsService),
      listContracts: this.employeeRecordsService.listContracts.bind(this.employeeRecordsService),
      listDocuments: this.employeeRecordsService.listDocuments.bind(this.employeeRecordsService),
      listLoans: this.loansService.listLoans.bind(this.loansService),
      deductibleApprovedLeaveDaysByEmployee: this.leaveService.deductibleApprovedLeaveDaysByEmployee.bind(
        this.leaveService,
      ),
      reconciledUsedAnnualLeaves: this.leaveService.reconciledUsedAnnualLeaves.bind(this.leaveService),
      invalidateReviewedPayrollForNewHire: this.payrollRunsService.invalidateReviewedPayrollForNewHire.bind(
        this.payrollRunsService,
      ),
    });
    this.advancesService = new HrAdvancesService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      accountingPosting: this.accountingPosting,
      cashDrawer: this.cashDrawer,
      getPayrollPolicies: this.getPayrollPolicies.bind(this),
      rebuildPayrollRunItems: this.payrollRebuildService.rebuildPayrollRunItems.bind(this.payrollRebuildService),
      invalidatePayrollRunReview: this.payrollRunsService.invalidatePayrollRunReview.bind(this.payrollRunsService),
    });
    this.payrollPostingService = new HrPayrollPostingService({
      db: this.db,
      tx: this.tx,
      audit: this.audit,
      treasury: this.treasury,
      accountingPosting: this.accountingPosting,
      cashDrawer: this.cashDrawer,
      getPayrollPolicies: this.getPayrollPolicies.bind(this),
      getPayrollRun: this.payrollRunsService.getPayrollRun.bind(this.payrollRunsService),
      getPayrollRunStatusForUpdate: this.payrollRunsService.getPayrollRunStatusForUpdate.bind(this.payrollRunsService),
      invalidatePayrollRunReview: this.payrollRunsService.invalidatePayrollRunReview.bind(this.payrollRunsService),
      rebuildPayrollRunItems: this.payrollRebuildService.rebuildPayrollRunItems.bind(this.payrollRebuildService),
    });
  }

  private scope(auth: AuthContext) {
    return requireTenantScope(auth);
  }

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const { tenantId } = this.scope(auth);
    return alias ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}` : sql<boolean>`tenant_id = ${tenantId}`;
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
    return this.employeesService.listEmployees(query, auth);
  }

  async getEmployeeProfile(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeesService.getEmployeeProfile(id, auth);
  }

  
  async getEndOfServicePreview(id: number, dateStr: string | undefined, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeesService.getEndOfServicePreview(id, dateStr, auth);
  }

  async endOfService(id: number, payload: EndOfServiceDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeesService.endOfService(id, payload, auth);
  }

  async createEmployeeFromRecruitment(
    trx: Kysely<Database>,
    input: { firstName: string; lastName: string; phone: string; email?: string; branchId?: number; salary: number },
    auth: AuthContext,
  ): Promise<number> {
    return this.employeesService.createEmployeeFromRecruitment(trx, input, auth);
  }

  async upsertEmployee(id: number | null, payload: UpsertEmployeeDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeesService.upsertEmployee(id, payload, auth);
  }

  async updateEmployeeStatus(id: number, status: string, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeesService.updateEmployeeStatus(id, status, auth);
  }

  async updateEmployeeCredentials(employeeId: number, payload: UpdateEmployeeCredentialsDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeesService.updateEmployeeCredentials(employeeId, payload, auth);
  }

  async deactivateEmployee(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.employeesService.deactivateEmployee(id, auth);
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
    return this.employeesService.listLedger(employeeId, auth);
  }

  async getEmployeeFinancialStatement(employeeId: number, query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.getEmployeeFinancialStatement(employeeId, query, auth);
  }

  async listPayrollRuns(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollRunsService.listPayrollRuns(query, auth);
  }

  async getPayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollRunsService.getPayrollRun(id, auth);
  }

  async createPayrollRun(payload: CreatePayrollRunDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollRunsService.createPayrollRun(payload, auth);
  }

  async recalculatePayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollRunsService.recalculatePayrollRun(id, auth);
  }

  async applyAttendanceDeductions(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollPostingService.applyAttendanceDeductions(id, auth);
  }

  async reviewPayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollRunsService.reviewPayrollRun(id, auth);
  }

  async approvePayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollPostingService.approvePayrollRun(id, auth);
  }

  async payPayrollRun(id: number, payload: PayPayrollRunDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollPostingService.payPayrollRun(id, payload, auth);
  }

  async payPayrollRunItem(itemId: number, payload: PayPayrollItemDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollPostingService.payPayrollRunItem(itemId, payload, auth);
  }

  async cancelPayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollRunsService.cancelPayrollRun(id, auth);
  }

  async generatePayrollWps(id: number, payload: GenerateWpsDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollRunsService.generatePayrollWps(id, payload, auth);
  }

  async updatePayrollRunItem(id: number, payload: UpsertPayrollItemDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollRunsService.updatePayrollRunItem(id, payload, auth);
  }

  async createPayrollAdjustment(id: number, payload: CreatePayrollAdjustmentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollRunsService.createPayrollAdjustment(id, payload, auth);
  }

  async deletePayrollAdjustment(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.payrollRunsService.deletePayrollAdjustment(id, auth);
  }

  async listAttendance(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.attendanceRecordsService.listAttendance(query, auth);
  }

  async bulkSaveAttendance(payload: BulkSaveAttendanceDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.attendanceRecordsService.bulkSaveAttendance(payload, auth);
  }

  async upsertAttendanceRecord(payload: UpsertAttendanceRecordDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.attendanceRecordsService.upsertAttendanceRecord(payload, auth);
  }

  async bulkImportAttendanceRecords(payload: BulkImportAttendanceDto, auth: AuthContext): Promise<{ imported: number; skipped: number; errors: string[] }> {
    return this.attendanceRecordsService.bulkImportAttendanceRecords(payload, auth);
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
    return this.advancesService.withdrawals(query, auth);
  }

  async summary(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.summary(auth);
  }

  async reportsSummary(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.reportsSummary(query, auth);
  }

  async getEmployeeWithdrawalBalance(employeeId: number, auth: AuthContext): Promise<EmployeeWithdrawalBalanceResult> {
    return this.advancesService.getEmployeeWithdrawalBalance(employeeId, auth);
  }

  async createQuickCashAdvance(payload: any, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.advancesService.createQuickCashAdvance(payload, auth);
  }
}

