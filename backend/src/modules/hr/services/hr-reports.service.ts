import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { buildEmployeeFinancialStatement } from '../engines/employee-financial-statement.engine';
import {
  clean,
  hasHrPermission,
  monthRange,
  normalizeDateOnly,
  normalizePayrollMonth,
  tenantBookDigits,
} from '../hr-helpers';

/**
 * HrReportsService — slice H6 of the hr split.
 * Pure move of 3 methods from HrService (employee financial statement,
 * hr summary, reports summary). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names and
 * signatures for all 3 public methods. No private methods move with H6.
 * Deps: db + bound assertEmployeeBelongsToTenant (kernel — stays private
 * in the facade, passed bound via the S3 pattern).
 * Free helpers (clean, hasHrPermission, monthRange, normalizeDateOnly,
 * normalizePayrollMonth, tenantBookDigits) are imported from
 * '../hr-helpers' (created with the H0 merge); they are NOT copied into
 * this slice. requireTenantScope is called DIRECTLY as a free function by
 * all 3 methods, so the slice imports it (prep §7.7). The employee
 * financial statement is built by the buildEmployeeFinancialStatement
 * engine (./engines/employee-financial-statement.engine), imported by the
 * slice. Date handling travels verbatim: reportsSummary resolves the
 * tenant timezone then todayTenantDate(tz); getEmployeeFinancialStatement
 * uses todayTenantDate(await getTenantTimezone(...)); the
 * todayStr.slice(0, 7) truncations are tenant-day string truncations, not
 * generated UTC-slice date keys (§10 pinZero stays 0). No toFixed2, no
 * inlineRound, no FX in this slice.
 * No spec repoint travels in this patch — prep §7.3 rules all six
 * source-text repoints MERGE-OWNED. H6 has no driving spec (prep §6.5:
 * byte-identity + critical chain + a focused spec or gap note at merge).
 */

export interface HrReportsDeps {
  db: Kysely<Database>;
  assertEmployeeBelongsToTenant: (employeeId: number, auth: AuthContext) => Promise<void>;
}

@Injectable()
export class HrReportsService {
  private readonly db: Kysely<Database>;
  private readonly assertEmployeeBelongsToTenant: (employeeId: number, auth: AuthContext) => Promise<void>;

  constructor(deps: HrReportsDeps) {
    this.db = deps.db;
    this.assertEmployeeBelongsToTenant = deps.assertEmployeeBelongsToTenant;
  }

  async getEmployeeFinancialStatement(
    employeeId: number,
    query: Record<string, unknown>,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const allowed = ['hrPayrollView', 'hrPayrollManage', 'hrPayrollApprove', 'hrSalaryView', 'hrSalaryManage'].some(
      (permission) => hasHrPermission(auth, permission),
    );
    if (!allowed) {
      throw new AppError(
        'تقرير الموظف المالي الكامل يتطلب صلاحية عرض المرتبات',
        'HR_FINANCIAL_STATEMENT_FORBIDDEN',
        403,
      );
    }
    await this.assertEmployeeBelongsToTenant(employeeId, auth);
    const { tenantId } = requireTenantScope(auth);
    const bookDigits = await tenantBookDigits(this.db, tenantId);

    const empRes = await sql<Record<string, unknown>>`
      SELECT e.*, d.name AS department_name, j.name AS job_title_name
      FROM hr_employees e
      LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id AND d.tenant_id = e.tenant_id
      LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id AND j.tenant_id = e.tenant_id
      WHERE e.id = ${employeeId} AND e.tenant_id = ${tenantId}
      LIMIT 1
    `.execute(this.db);
    const empRow = empRes.rows[0];
    if (!empRow) throw new AppError('Employee not found', 'HR_EMPLOYEE_NOT_FOUND', 404);

    const employeeLocalDate = todayTenantDate(await getTenantTimezone(this.db, tenantId));
    const contractRes = await sql<{ base_salary: string }>`
      SELECT base_salary FROM hr_employment_contracts
      WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
        AND status = 'active'
        AND start_date <= ${employeeLocalDate}::date
        AND (end_date IS NULL OR end_date >= ${employeeLocalDate}::date)
      ORDER BY start_date DESC, id DESC LIMIT 1
    `.execute(this.db);
    const baseSalary = Number(contractRes.rows[0]?.base_salary || 0);

    const payrollRes = await sql<Record<string, unknown>>`
      SELECT i.*, r.period_month, r.status AS run_status,
             COALESCE(to_char(i.paid_at, 'YYYY-MM-DD HH24:MI:SS'), to_char(r.paid_at, 'YYYY-MM-DD HH24:MI:SS')) AS paid_at_text,
             COALESCE(i.payment_channel, r.payment_channel) AS payment_channel,
             COALESCE(ui.username, ur.username) AS paid_by_name
      FROM hr_payroll_run_items i
      JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
      LEFT JOIN users ur ON ur.id = r.paid_by AND ur.tenant_id = r.tenant_id
      LEFT JOIN users ui ON ui.id = i.paid_by AND ui.tenant_id = i.tenant_id
      WHERE i.employee_id = ${employeeId} AND i.tenant_id = ${tenantId}
      ORDER BY r.period_month ASC, i.id ASC
    `.execute(this.db);

    const loansRes = await sql<Record<string, unknown>>`
      SELECT l.*, to_char(l.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at_text,
             to_char(l.disbursed_at, 'YYYY-MM-DD HH24:MI:SS') AS disbursed_at_text,
             u.username AS created_by_name
      FROM hr_employee_loans l
      LEFT JOIN users u ON u.id = l.created_by AND u.tenant_id = l.tenant_id AND u.tenant_id = l.tenant_id
      WHERE l.employee_id = ${employeeId} AND l.tenant_id = ${tenantId}
      ORDER BY l.id ASC
    `.execute(this.db);

    const adjRes = await sql<Record<string, unknown>>`
      SELECT a.*, to_char(a.date, 'YYYY-MM-DD') AS date_text, u.username AS created_by_name
      FROM hr_employee_adjustments a
      LEFT JOIN users u ON u.id = a.created_by AND u.tenant_id = a.tenant_id
      WHERE a.employee_id = ${employeeId} AND a.tenant_id = ${tenantId}
      ORDER BY a.date ASC, a.id ASC
    `.execute(this.db);

    const ledgerRes = await sql<Record<string, unknown>>`
      SELECT le.*, to_char(le.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at_text,
             u.username AS created_by_name
      FROM hr_employee_ledger le
      LEFT JOIN users u ON u.id = le.created_by AND u.tenant_id = le.tenant_id
      WHERE le.employee_id = ${employeeId} AND le.tenant_id = ${tenantId}
      ORDER BY le.id ASC
    `.execute(this.db);

    const result = buildEmployeeFinancialStatement({
      employee: {
        id: String(empRow.id),
        employeeNo: clean(empRow.employee_no),
        displayName: clean(empRow.display_name) || `${clean(empRow.first_name)} ${clean(empRow.last_name)}`.trim(),
        hireDate: empRow.hire_date ? String(empRow.hire_date).slice(0, 10) : undefined,
        status: clean(empRow.status) || 'active',
        compensationType: clean(empRow.compensation_type) || 'monthly',
        baseSalary,
        hourlyRate: empRow.hourly_rate != null ? Number(empRow.hourly_rate) : undefined,
        departmentName: clean(empRow.department_name),
        jobTitleName: clean(empRow.job_title_name),
      },
      payrollItems: payrollRes.rows.map((row) => ({
        id: String(row.id),
        runId: String(row.run_id),
        periodMonth: clean(row.period_month),
        runStatus: clean(row.run_status),
        baseSalary: Number(row.base_salary || 0),
        allowanceAmount: Number(row.allowance_amount || 0),
        grossPay: Number(row.gross_pay || 0),
        deductionAmount: Number(row.deduction_amount || 0),
        penaltyDeduction: Number(row.penalty_deduction || 0),
        loanDeductionAmount: Number(row.loan_deduction_amount || 0),
        netPay: Number(row.net_pay || 0),
        itemStatus: clean(row.status),
        paidAt: clean(row.paid_at_text),
        paymentChannel: clean(row.payment_channel),
        paidByName: clean(row.paid_by_name),
      })),
      loans: loansRes.rows.map((row) => ({
        id: String(row.id),
        loanNo: clean(row.loan_no),
        loanType: clean(row.loan_type) || 'advance',
        principalAmount: Number(row.principal_amount || 0),
        paidAmount: Number(row.paid_amount || 0),
        remainingAmount: Number(row.remaining_amount || 0),
        status: clean(row.status) || 'draft',
        notes: clean(row.notes),
        repaymentMode: clean(row.repayment_mode),
        issueDate: row.issue_date ? String(row.issue_date).slice(0, 10) : undefined,
        disbursedAt: clean(row.disbursed_at_text),
        createdAt: clean(row.created_at_text),
        createdByName: clean(row.created_by_name),
      })),
      adjustments: adjRes.rows.map((row) => ({
        id: String(row.id),
        adjustmentType: clean(row.adjustment_type),
        amountType: clean(row.amount_type),
        amount: Number(row.amount || 0),
        date: clean(row.date_text),
        reason: clean(row.reason),
        status: clean(row.status) || 'pending',
        appliedInRunId: row.applied_in_run_id ? Number(row.applied_in_run_id) : null,
        createdByName: clean(row.created_by_name),
      })),
      ledger: ledgerRes.rows.map((row) => ({
        id: String(row.id),
        entryType: clean(row.entry_type),
        amount: Number(row.amount || 0),
        balanceAfter: Number(row.balance_after || 0),
        note: clean(row.note),
        repaymentMethod: clean(row.repayment_method),
        referenceType: clean(row.reference_type),
        referenceId: row.reference_id ? String(row.reference_id) : undefined,
        createdAt: clean(row.created_at_text),
        createdByName: clean(row.created_by_name),
      })),
      filter: {
        from: clean(query.from),
        to: clean(query.to),
        month: clean(query.month),
      },
      minorUnits: bookDigits,
    });

    return result as unknown as Record<string, unknown>;
  }

  async summary(auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const result = await sql<{
      employee_count: string;
      active_count: string;
      open_loans: string;
      outstanding_amount: string;
    }>`
      SELECT
        (SELECT COUNT(*) FROM hr_employees WHERE tenant_id = ${auth.tenantId}) AS employee_count,
        (SELECT COUNT(*) FROM hr_employees WHERE tenant_id = ${auth.tenantId} AND status = 'active') AS active_count,
        (SELECT COUNT(*) FROM hr_employee_loans WHERE tenant_id = ${auth.tenantId} AND status IN ('paid','partially_repaid','disbursed') AND remaining_amount > 0) AS open_loans,
        (SELECT COALESCE(SUM(remaining_amount), 0) FROM hr_employee_loans WHERE tenant_id = ${auth.tenantId} AND status IN ('paid','partially_repaid','disbursed')) AS outstanding_amount
    `.execute(this.db);
    const row = result.rows[0];
    const canSeeLoans = hasHrPermission(auth, 'hrLoans');
    return {
      summary: {
        employeeCount: Number(row?.employee_count || 0),
        activeCount: Number(row?.active_count || 0),
        openLoans: canSeeLoans ? Number(row?.open_loans || 0) : 0,
        outstandingAmount: canSeeLoans ? Number(row?.outstanding_amount || 0) : 0,
      },
    };
  }

  async reportsSummary(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const tz = await getTenantTimezone(this.db, auth.tenantId);
    const todayStr = todayTenantDate(tz);
    const month = normalizePayrollMonth(query.month);
    const range = month
      ? monthRange(month)
      : {
          from: normalizeDateOnly(query.from) || `${todayStr.slice(0, 7)}-01`,
          to: normalizeDateOnly(query.to) || todayStr,
        };
    const fromMonth = range.from.slice(0, 7);
    const toMonth = range.to.slice(0, 7);

    const [employees, attendance, leaves, loans, assets, payroll] = await Promise.all([
      sql<{ employee_count: string; active_count: string }>`
        SELECT
          COUNT(*) AS employee_count,
          COUNT(*) FILTER (WHERE status = 'active') AS active_count
        FROM hr_employees
        WHERE tenant_id = ${auth.tenantId}
      `.execute(this.db),
      sql<Record<string, unknown>>`
        SELECT
          COALESCE(SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END), 0) AS present_count,
          COALESCE(SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent_count,
          COALESCE(SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END), 0) AS late_count,
          COALESCE(SUM(CASE WHEN a.status = 'half_day' THEN 1 ELSE 0 END), 0) AS half_day_count,
          COALESCE(SUM(CASE WHEN a.status = 'leave' THEN 1 ELSE 0 END), 0) AS leave_count
        FROM hr_attendance_records a
        WHERE a.tenant_id = ${auth.tenantId}
          AND a.work_date >= ${range.from}::date
          AND a.work_date <= ${range.to}::date
      `.execute(this.db),
      sql<Record<string, unknown>>`
        SELECT
          COALESCE(SUM(CASE WHEN lr.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN lr.status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
          COALESCE(SUM(CASE WHEN lr.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
          COALESCE(SUM(CASE WHEN lr.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
          COALESCE(SUM(CASE WHEN lr.status = 'approved' AND (COALESCE(lt.is_paid, TRUE) = FALSE OR LOWER(COALESCE(lt.code, '')) = 'unpaid' OR LOWER(COALESCE(lr.leave_type, '')) = 'unpaid') THEN lr.days_count ELSE 0 END), 0) AS unpaid_leave_days
        FROM hr_leave_requests lr
        JOIN hr_employees e ON e.id = lr.employee_id
        LEFT JOIN hr_leave_types lt ON lt.id = lr.leave_type_id AND lt.tenant_id = lr.tenant_id
        WHERE e.tenant_id = ${auth.tenantId}
          AND lr.start_date <= ${range.to}::date
          AND lr.end_date >= ${range.from}::date
      `.execute(this.db),
      sql<Record<string, unknown>>`
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('paid', 'partially_repaid', 'disbursed') AND remaining_amount > 0 THEN 1 ELSE 0 END), 0) AS open_loan_count,
          COALESCE(SUM(CASE WHEN status IN ('paid', 'partially_repaid', 'disbursed') THEN remaining_amount ELSE 0 END), 0) AS outstanding_amount
        FROM hr_employee_loans
        WHERE tenant_id = ${auth.tenantId}
      `.execute(this.db),
      sql<Record<string, unknown>>`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'assigned' THEN 1 ELSE 0 END), 0) AS assigned_count,
          COALESCE(SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END), 0) AS returned_count,
          COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END), 0) AS lost_count,
          COALESCE(SUM(CASE WHEN status = 'damaged' THEN 1 ELSE 0 END), 0) AS damaged_count
        FROM hr_employee_assets
        WHERE tenant_id = ${auth.tenantId}
      `.execute(this.db),
      sql<Record<string, unknown>>`
        SELECT
          COUNT(DISTINCT r.id) AS run_count,
          COUNT(DISTINCT r.id) FILTER (WHERE r.status = 'approved') AS approved_run_count,
          COALESCE(SUM(i.net_pay), 0) AS total_net_pay
        FROM hr_payroll_runs r
        LEFT JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.status <> 'excluded'
        WHERE r.tenant_id = ${auth.tenantId}
          AND r.period_month >= ${fromMonth}
          AND r.period_month <= ${toMonth}
      `.execute(this.db),
    ]);

    const employeeRow = employees.rows[0] || { employee_count: '0', active_count: '0' };
    const attendanceRow = attendance.rows[0] || {};
    const leavesRow = leaves.rows[0] || {};
    const loansRow = loans.rows[0] || {};
    const assetsRow = assets.rows[0] || {};
    const payrollRow = payroll.rows[0] || {};

    const canSeeEmployees = hasHrPermission(auth, 'hrEmployees');
    const canSeeAttendance = hasHrPermission(auth, 'hrAttendance');
    const canSeeLoans = hasHrPermission(auth, 'hrLoans');
    const canSeePayroll = [
      'hrPayrollView',
      'hrPayrollManage',
      'hrPayrollApprove',
      'hrSalaryView',
      'hrSalaryManage',
    ].some((permission) => hasHrPermission(auth, permission));

    return {
      period: { from: range.from, to: range.to, month: month || '' },
      summary: {
        employeeCount: canSeeEmployees ? Number(employeeRow.employee_count || 0) : 0,
        activeEmployeeCount: canSeeEmployees ? Number(employeeRow.active_count || 0) : 0,
        attendance: {
          presentCount: canSeeAttendance ? Number(attendanceRow.present_count || 0) : 0,
          absentCount: canSeeAttendance ? Number(attendanceRow.absent_count || 0) : 0,
          lateCount: canSeeAttendance ? Number(attendanceRow.late_count || 0) : 0,
          halfDayCount: canSeeAttendance ? Number(attendanceRow.half_day_count || 0) : 0,
          leaveCount: canSeeAttendance ? Number(attendanceRow.leave_count || 0) : 0,
        },
        leaves: {
          pendingCount: canSeeEmployees ? Number(leavesRow.pending_count || 0) : 0,
          approvedCount: canSeeEmployees ? Number(leavesRow.approved_count || 0) : 0,
          rejectedCount: canSeeEmployees ? Number(leavesRow.rejected_count || 0) : 0,
          cancelledCount: canSeeEmployees ? Number(leavesRow.cancelled_count || 0) : 0,
          unpaidLeaveDays: canSeeEmployees ? Number(leavesRow.unpaid_leave_days || 0) : 0,
        },
        loans: {
          openLoanCount: canSeeLoans ? Number(loansRow.open_loan_count || 0) : 0,
          outstandingAmount: canSeeLoans ? Number(loansRow.outstanding_amount || 0) : 0,
        },
        assets: {
          assignedCount: canSeeEmployees ? Number(assetsRow.assigned_count || 0) : 0,
          returnedCount: canSeeEmployees ? Number(assetsRow.returned_count || 0) : 0,
          lostCount: canSeeEmployees ? Number(assetsRow.lost_count || 0) : 0,
          damagedCount: canSeeEmployees ? Number(assetsRow.damaged_count || 0) : 0,
        },
        payroll: {
          runCount: canSeePayroll ? Number(payrollRow.run_count || 0) : 0,
          approvedRunCount: canSeePayroll ? Number(payrollRow.approved_run_count || 0) : 0,
          totalNetPay: canSeePayroll ? Number(payrollRow.total_net_pay || 0) : 0,
        },
      },
    };
  }
}
