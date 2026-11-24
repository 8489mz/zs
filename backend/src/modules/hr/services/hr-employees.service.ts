import { Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { boundedPage } from '../../../common/utils/bounded-page';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { UpsertEmployeeDto, EndOfServiceDto, UpdateEmployeeCredentialsDto } from '../dto/hr.dto';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { requireStoredHrMoney } from '../engines/hr-payroll-run.engine';
import { createPasswordRecord } from '../../../core/auth/utils/password-hasher';
import { assertSecurePasscode } from '../../../core/auth/utils/password-policy';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { type RawBuilder } from 'kysely';
import { toId, clean, normalizeEmployeeNo, isUniqueViolation, normalizeDateOnly, tenantBookDigits, hasHrPermission, canViewSalary, normalizeTimeOnly, type CompensationType, type OvertimePolicy } from '../hr-helpers';

/**
 * HrEmployeesService — slice H1 of the hr split.
 * Pure move of 12 methods from HrService (employees core: list, profile,
 * end-of-service preview + computation, recruitment intake, upsert/status/
 * credentials/deactivate, employee-number helpers, ledger). No behavior
 * change: the bodies are byte-identical; the facade keeps thin delegates
 * with the same names and signatures for the 10 public methods.
 * nextAvailableEmployeeNo + ensureEmployeeNoAvailable stay PRIVATE in the
 * slice (no facade delegates) — they are called only by this slice's own
 * methods (prep §2.4). createEmployeeFromRecruitment keeps its unusual
 * (trx, ...) first-arg signature unchanged; recruitment-ats.service.ts
 * keeps calling the facade delegate (prep §7.9).
 * Deps: db + tx + audit + 11 bound deps — kernel scope + tenantPredicate +
 * assertEmployeeBelongsToTenant (stay private in the facade, passed bound
 * via the S3 pattern) + listCompensation/listContacts/listContracts/
 * listDocuments (H2, via this.employeeRecordsService.<method>.bind(this))
 * + listLoans (H4, via this.loansService.listLoans.bind(this)) +
 * deductibleApprovedLeaveDaysByEmployee/reconciledUsedAnnualLeaves (H3,
 * public-in-slice, via this.leaveService.<method>.bind(this)) +
 * invalidateReviewedPayrollForNewHire (H7, public-in-slice, via
 * this.payrollRunsService.<method>.bind(this)). H2/H3/H4/H7 all merge
 * BEFORE H1, so their facade fields exist at merge; on this generation
 * tree the ctor wiring references fields that do not exist yet — EXPECTED
 * transient, merge-owned.
 * MERGE NOTE: this patch RESOLVES H3's 2 transient dangles — listEmployees'
 * this.deductibleApprovedLeaveDaysByEmployee( and getEmployeeProfile's
 * this.reconciledUsedAnnualLeaves( move INTO the slice and resolve through
 * the bound deps; getEmployeeProfile's this.listLoans( resolves through the
 * bound listLoans dep the same way. No facade rewrite of those call sites
 * is needed — they travel with the methods.
 * Free helpers (toId, clean, normalizeEmployeeNo, isUniqueViolation,
 * normalizeDateOnly, tenantBookDigits, hasHrPermission, normalizeTimeOnly
 * + types CompensationType, OvertimePolicy) are imported from
 * '../hr-helpers' (created with the H0 merge); they are NOT copied into
 * this slice. requireTenantScope is called DIRECTLY as a free function by
 * the moved methods, so the slice imports it (prep §7.7). Contract
 * numbers resolve through formatDailyDocumentNumber('CON', ..., new
 * Date(), 4, tenantTz) — the tenant-tz argument travels with the methods.
 * Date handling travels verbatim: getEmployeeProfile resolves the tenant
 * timezone then todayTenantDate(tz); createEmployeeFromRecruitment
 * computes the hire date via getTenantTimezone(trx) + todayTenantDate;
 * listLedger serializes created_at with instanceof Date ?
 * .toISOString() : String(...) (display only, not a date key);
 * .slice(0, 10) count is 0 (§10 pinZero stays 0). No toFixed2, no
 * inlineRound, no FX in this slice. EOS amounts come from the effective
 * compensation package / payroll (standing EOS decision — ALL allowances
 * count, no housing/transport split; net payable is a payable first).
 * No spec repoint travels in this patch — prep §7.3 rules all six
 * source-text repoints MERGE-OWNED. H1's driving specs (prep §4.2/§6.5):
 * leave-balance-deduction (getEmployeeProfile) +
 * leave-balance-reconciliation (listEmployees, getEmployeeProfile).
 */

export interface HrEmployeesDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  scope: (auth: AuthContext) => ReturnType<typeof requireTenantScope>;
  tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  assertEmployeeBelongsToTenant: (employeeId: number, auth: AuthContext) => Promise<void>;
  listCompensation: (employeeId: number, auth: AuthContext) => Promise<Record<string, unknown>>;
  listContacts: (employeeId: number, auth: AuthContext) => Promise<Record<string, unknown>>;
  listContracts: (employeeId: number, auth: AuthContext) => Promise<Record<string, unknown>>;
  listDocuments: (employeeId: number, auth: AuthContext) => Promise<Record<string, unknown>>;
  listLoans: (query: Record<string, unknown>, auth: AuthContext) => Promise<Record<string, unknown>>;
  deductibleApprovedLeaveDaysByEmployee: (employeeIds: number[], tenantId: string) => Promise<Map<number, number>>;
  reconciledUsedAnnualLeaves: (executor: Kysely<Database> | Transaction<Database>, employeeId: number, tenantId: string, storedUsed: number) => Promise<number>;
  invalidateReviewedPayrollForNewHire: (db: Kysely<Database>, tenantId: string, hireDate: string, payFrequency: string) => Promise<void>;
}

@Injectable()
export class HrEmployeesService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly scope: (auth: AuthContext) => ReturnType<typeof requireTenantScope>;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  private readonly assertEmployeeBelongsToTenant: (employeeId: number, auth: AuthContext) => Promise<void>;
  private readonly listCompensation: (employeeId: number, auth: AuthContext) => Promise<Record<string, unknown>>;
  private readonly listContacts: (employeeId: number, auth: AuthContext) => Promise<Record<string, unknown>>;
  private readonly listContracts: (employeeId: number, auth: AuthContext) => Promise<Record<string, unknown>>;
  private readonly listDocuments: (employeeId: number, auth: AuthContext) => Promise<Record<string, unknown>>;
  private readonly listLoans: (query: Record<string, unknown>, auth: AuthContext) => Promise<Record<string, unknown>>;
  private readonly deductibleApprovedLeaveDaysByEmployee: (employeeIds: number[], tenantId: string) => Promise<Map<number, number>>;
  private readonly reconciledUsedAnnualLeaves: (executor: Kysely<Database> | Transaction<Database>, employeeId: number, tenantId: string, storedUsed: number) => Promise<number>;
  private readonly invalidateReviewedPayrollForNewHire: (db: Kysely<Database>, tenantId: string, hireDate: string, payFrequency: string) => Promise<void>;

  constructor(deps: HrEmployeesDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.scope = deps.scope;
    this.tenantPredicate = deps.tenantPredicate;
    this.assertEmployeeBelongsToTenant = deps.assertEmployeeBelongsToTenant;
    this.listCompensation = deps.listCompensation;
    this.listContacts = deps.listContacts;
    this.listContracts = deps.listContracts;
    this.listDocuments = deps.listDocuments;
    this.listLoans = deps.listLoans;
    this.deductibleApprovedLeaveDaysByEmployee = deps.deductibleApprovedLeaveDaysByEmployee;
    this.reconciledUsedAnnualLeaves = deps.reconciledUsedAnnualLeaves;
    this.invalidateReviewedPayrollForNewHire = deps.invalidateReviewedPayrollForNewHire;
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

  async listEmployees(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const search = clean(query.search).toLowerCase();
    const canViewEmployeeFiles = hasHrPermission(auth, 'hrEmployees') || auth.permissions.includes('*');
    const canViewSalaryFields = canViewSalary(auth) || auth.permissions.includes('*');
    const tenant = this.tenantPredicate(auth, 'e');
    // INV-HR-EMPLOYEES-SQL-PAGINATION: the search predicate is pushed
    // to SQL — the same six fields the in-memory filter checked
    // (employeeNo, displayName, username, departmentName, jobTitleName,
    // phone). strpos() is the exact `.includes()` equivalent, so LIKE
    // wildcards in the search term stay literal. The phone branch
    // applies only when the caller may view employee files — otherwise
    // the phone is masked and must never match.
    const searchPredicate = search
      ? sql<boolean>`(
        strpos(lower(btrim(coalesce(e.employee_no, ''))), ${search}) > 0
        OR strpos(lower(coalesce(nullif(btrim(e.display_name), ''), btrim(btrim(coalesce(e.first_name, '')) || ' ' || btrim(coalesce(e.last_name, ''))))), ${search}) > 0
        OR strpos(lower(btrim(coalesce(u.username, ''))), ${search}) > 0
        OR strpos(lower(btrim(coalesce(d.name, ''))), ${search}) > 0
        OR strpos(lower(btrim(coalesce(j.name, ''))), ${search}) > 0
        ${canViewEmployeeFiles
          ? sql`OR strpos(lower(btrim(coalesce((SELECT c.value FROM hr_employee_contacts c WHERE c.employee_id = e.id AND c.tenant_id = e.tenant_id ORDER BY c.is_primary DESC, c.id ASC LIMIT 1), ''))), ${search}) > 0`
          : sql``}
      )`
      : null;
    const where = searchPredicate ? sql<boolean>`${tenant} AND ${searchPredicate}` : tenant;
    // INV-HR-EMPLOYEES-SQL-PAGINATION: the summary counts are exact
    // over the FULL filtered set, never just the page — one COUNT
    // query with the same predicates as the page query.
    const counts = await sql<{ total_items: string; active_count: string }>`
      SELECT COUNT(*) AS total_items,
        COUNT(*) FILTER (WHERE coalesce(nullif(btrim(e.status), ''), 'active') = 'active') AS active_count
      FROM hr_employees e
      LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id
      LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id
      LEFT JOIN users u ON u.id = e.user_id AND u.tenant_id = e.tenant_id
      WHERE ${where}
    `.execute(this.db);
    const totalItems = Number(counts.rows[0]?.total_items || 0);
    const activeCount = Number(counts.rows[0]?.active_count || 0);
    // paginateRows semantics preserved: defaultSize 25, page clamped
    // to [1, totalPages], totalPages = max(1, ceil(total / pageSize)).
    // The cap is now 200 (boundedPage), not 5000.
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 25);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
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
      WHERE ${where}
      ORDER BY e.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);
    // INV-LEAVE-BALANCE-NOT-DEDUCTING: one batch reconcile for the
    // listed employees, so the list shows the same used days as the
    // profile (approvals posted before the forward deduction existed
    // never moved the stored counter). Page-scoped: only the page's
    // ids are reconciled — the values on the page are identical.
    const reconciledUsedByEmployee = await this.deductibleApprovedLeaveDaysByEmployee(
      result.rows.map((row) => Number(row.id)),
      String(auth.tenantId || ''),
    );
    const rows = result.rows.map((row) => ({
      id: String(row.id),
      employeeNo: clean(row.employee_no),
      nationalId: canViewEmployeeFiles ? clean(row.national_id) : '',
      // الرمز نفسه لا يُعاد أبداً — حالة وجوده فقط (البند O20)
      hasPinCode: Boolean(row.pin_hash),
      firstName: clean(row.first_name),
      lastName: clean(row.last_name),
      displayName: clean(row.display_name) || `${clean(row.first_name)} ${clean(row.last_name)}`.trim(),
      status: clean(row.status) || 'active',
      phone: canViewEmployeeFiles ? clean(row.primary_phone) : '',
      mobile: canViewEmployeeFiles ? clean(row.primary_phone) : '',
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
      hourlyRate: canViewSalaryFields && row.hourly_rate != null ? Number(row.hourly_rate) : null,
      expectedDailyHours: row.expected_daily_hours != null ? Number(row.expected_daily_hours) : null,
      scheduledCheckInTime: clean(row.scheduled_check_in_time),
      scheduledCheckOutTime: clean(row.scheduled_check_out_time),
      graceMinutes: Number(row.grace_minutes || 0),
      overtimePolicy: clean(row.overtime_policy) || 'review_only',
      attendancePolicy: clean(row.attendance_policy) || 'strict',
      commissionType: canViewSalaryFields ? (clean(row.commission_type) || 'inherit') : 'inherit',
      commissionValue: canViewSalaryFields && row.commission_value != null ? Number(row.commission_value) : null,
      commissionTarget: canViewSalaryFields && row.commission_target != null ? Number(row.commission_target) : null,
      delayPolicy: clean(row.delay_policy) || 'inherit',
      hasSocialInsurance: canViewSalaryFields ? row.has_social_insurance === true : false,
      insuranceSalary: canViewSalaryFields && row.insurance_salary != null ? Number(row.insurance_salary) : null,
      hasIncomeTax: canViewSalaryFields ? row.has_income_tax === true : false,
      bankName: canViewEmployeeFiles ? clean(row.bank_name) : '',
      bankAccountNumber: canViewEmployeeFiles ? clean(row.bank_account_number) : '',
      iban: canViewEmployeeFiles ? clean(row.iban) : '',
      bankSwiftCode: canViewEmployeeFiles ? clean(row.bank_swift_code) : '',
      annualLeaveBalance: row.annual_leave_balance == null ? 21 : Number(row.annual_leave_balance),
      // INV-LEAVE-BALANCE-NOT-DEDUCTING: reconciled against the
      // approved requests — never the stored counter raw.
      usedAnnualLeaves: Math.max(
        row.used_annual_leaves == null ? 0 : Number(row.used_annual_leaves),
        reconciledUsedByEmployee.get(Number(row.id)) || 0,
      ),
      notes: canViewEmployeeFiles ? clean(row.notes) : '',
    }));
    return { employees: rows, pagination: { page: safePage, pageSize, totalItems, totalPages }, summary: { totalItems, activeCount } };
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

  async listLedger(employeeId: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    const result = await sql<Record<string, unknown>>`
      SELECT * FROM hr_employee_ledger 
      WHERE employee_id = ${employeeId} AND tenant_id = ${auth.tenantId} 
      ORDER BY id DESC
    `.execute(this.db);
    return { rows: result.rows.map((row) => ({ id: String(row.id), employeeId: String(row.employee_id), entryType: clean(row.entry_type), amount: Number(row.amount || 0), balanceAfter: Number(row.balance_after || 0), note: clean(row.note), repaymentMethod: clean(row.repayment_method), referenceType: clean(row.reference_type), referenceId: row.reference_id ? String(row.reference_id) : '', createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at) })) };
  }
}
