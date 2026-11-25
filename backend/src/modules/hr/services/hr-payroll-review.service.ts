import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { calculateOvertime, calculateProgressiveDelayDeduction } from '../engines/payroll-calculation.engine';
import {
  calculateHistoricalOvertimePay,
  daysInCalendarMonth,
  type EffectiveSalaryContract,
  type ApprovedOvertimeDay,
} from '../engines/hourly-attendance-pay.engine';
import { tenantBookDigits } from '../hr-helpers';

/**
 * HrPayrollReviewService — slice H9 of the hr split.
 * Pure move of 1 method from HrService (payroll operational review:
 * overtime / delay-deduction / attendance review per employee).
 * No behavior change: the body is byte-identical; the ONLY change is the
 * method becoming PUBLIC in the slice (prep §2.5 public-in-slice rule —
 * it is a bound dep of H7 getPayrollRun + H8 rebuildPayrollRunItems, so
 * the facade keeps NO delegate for it). The facade still constructs this
 * slice eagerly in its ctor and binds the method for H7/H8.
 * Deps: bound getPayrollPolicies ONLY (H0 — the facade passes its bound
 * delegate, which forwards to the H0 slice). The method takes db as its
 * FIRST PARAMETER (callers pass db/trx/this.db as today); the slice takes
 * NO db ctor field (grounding: the moved text's only this.* ref is the
 * single getPayrollPolicies call — prep §6 "db" overcounts, corrected
 * here). Free helper tenantBookDigits is imported from ../hr-helpers —
 * that file is created by the H0 merge and does not exist on this
 * generation tree yet; the import is still correct. Guard pin: the
 * calculateProgressiveDelayDeduction call site travels verbatim
 * (architecture-guard :461 reads it — its repoint to this file is
 * merge-owned). Date handling: none — the method takes date strings
 * (range.from/to) as parameters and constructs no dates.
 */

export interface HrPayrollReviewDeps {
  getPayrollPolicies: (db: any, tenantId: string) => Promise<any>;
}

@Injectable()
export class HrPayrollReviewService {
  private readonly getPayrollPolicies: (db: any, tenantId: string) => Promise<any>;

  constructor(deps: HrPayrollReviewDeps) {
    this.getPayrollPolicies = deps.getPayrollPolicies;
  }

  async calculatePayrollOperationalReview(
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

    const attendanceByEmployee = new Map<number, { absent_days: number; records: any[] }>();
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
      hrWeekendDays = (globalPolicies.hrWeekendDays || 'friday,saturday')
        .split(',')
        .map((d: string) => d.trim().toLowerCase());
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
    const isHoliday = (dateStr: string) =>
      holidaysRes.rows.some((h) => dateStr >= String(h.start_date_text) && dateStr <= String(h.end_date_text));

    // Fetch sales grouped by user_id for the period
    const userIds = empResult.rows.map((r) => Number(r.user_id)).filter((id) => !isNaN(id) && id > 0);
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
      const dailyRate = isHourly
        ? hourlyRate * expectedHours
        : contractedBase > 0
          ? roundMoney(contractedBase / daysInCalendarMonth(range.from), reviewDigits)
          : 0;
      const calculatedHourlyRate = isHourly ? hourlyRate : dailyRate / expectedHours;

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
          policyMode:
            delayPolicyMode === 'progressive' || delayPolicyMode === 'standard' ? delayPolicyMode : 'disabled',
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
          : contractedBase > 0
            ? contractedBase / daysInCalendarMonth(String(rec.work_date_text))
            : 0;
      }
      const suggestedAttendanceDeductionAmount = roundMoney(absentDeduction + delayDeduction, reviewDigits);
      const suggestedLeaveDeductionAmount = roundMoney(dailyRate * unpaidLeaveDays, reviewDigits);
      let suggestedOvertimeAllowanceAmount: number;
      try {
        suggestedOvertimeAllowanceAmount =
          !isHourly && effectiveContracts
            ? calculateHistoricalOvertimePay(
                datedOvertimeByEmployee.get(employeeId) || [],
                effectiveContracts.get(employeeId) || [],
                expectedHours,
                overtimeMultiplier,
                reviewDigits,
              )
            : calculateOvertime({
                minorUnits: reviewDigits,
                calculatedHourlyRate,
                overtimeMinutes,
                overtimeMultiplier,
              });
      } catch (error) {
        throw new AppError(
          `تعذر احتساب إضافي الموظف #${employeeId}: ${error instanceof Error ? error.message : 'راجع العقود'}`,
          'HR_OVERTIME_EFFECTIVE_CONTRACT_INVALID',
          409,
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
      if (totalIncidents > 0)
        notesStr += ` (${totalIncidents}) مرات تأخير/انصراف مبكر باجمالي ${Math.floor((lateMinutes + earlyLeaveMinutes) / 60)}س و${(lateMinutes + earlyLeaveMinutes) % 60}د. سياسة: ${delayPolicyMode}.`;
      if (unpaidLeaveDays > 0) notesStr += ` إجازة بدون مرتب ${unpaidLeaveDays} يوم.`;
      if (overtimeMinutes > 0)
        notesStr += ` إضافي معتمد ${Math.floor(overtimeMinutes / 60)}س و${overtimeMinutes % 60}د.`;
      if (commissionValue > 0) notesStr += ` عمولة مبيعات: ${commissionValue}.`;
      if (suggestedSocialInsuranceDeductionAmount > 0)
        notesStr += ` تأمينات موظف: ${suggestedSocialInsuranceDeductionAmount} (منشأة: ${suggestedEmployerInsuranceAmount}).`;
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
}
