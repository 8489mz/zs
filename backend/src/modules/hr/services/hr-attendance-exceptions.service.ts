import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { boundedPage } from '../../../common/utils/bounded-page';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { DecideAttendanceExceptionDto } from '../dto/hr.dto';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { calculateAttendancePenalty } from '../engines/attendance-penalty.engine';
import { type RawBuilder } from 'kysely';
import { clean, normalizeDateOnly, tenantBookDigits, monthRange, timeToMinutes, normalizeTimeOnly, type AttendanceExceptionType, type AttendanceExceptionStatus } from '../hr-helpers';

/**
 * HrAttendanceExceptionsService — slice H12 of the hr split.
 * Pure move of 4 methods from HrService (attendance exceptions). No
 * behavior change: the bodies are byte-identical except for ONE type
 * token in refreshAttendanceExceptionForEmployeeDate (see below); the
 * facade keeps thin delegates with the same names and signatures for the
 * 2 public methods. refreshAttendanceExceptionForEmployeeDate is PUBLIC
 * in this slice only (H11 bound dep, prep §2.5) with NO facade delegate
 * — the facade keeps no delegate for it and H11 binds the slice method
 * at its merge. buildAttendanceException stays PRIVATE (its only caller
 * is refreshAttendanceExceptionForEmployeeDate, H12-internal). Deps: db
 * + tx + audit, passed through as received (all REQUIRED, no fallback);
 * getPayrollPolicies is a bound H0 delegate (the facade passes
 * this.getPayrollPolicies.bind(this); typed (db: any, tenantId: string)
 * => Promise<any> because the facade signature carries no return-type
 * annotation) and tenantPredicate is a bound kernel dep (stays a real
 * private method in the facade). Free helpers (clean, normalizeDateOnly,
 * monthRange, tenantBookDigits, normalizeTimeOnly, timeToMinutes,
 * AttendanceExceptionType, AttendanceExceptionStatus) are imported from
 * ../hr-helpers — that file is created by the H0 merge and does not exist
 * on this generation tree yet; the import is still correct.
 * ADAPTATION (type-only, no behavior change): the pristine text reads
 * `ReturnType<HrService['buildAttendanceException']>` — the ONLY
 * HrService reference in the moved text. The slice cannot import the
 * facade (circular + bound-deps-only), so the token reads
 * `ReturnType<HrAttendanceExceptionsService['buildAttendanceException']>`
 * here. It resolves to the identical method signature; backend tsc on the
 * merged tree proves it. Date handling travels verbatim: refresh reads
 * the tenant timezone via getTenantTimezone(db, tenantId) and computes
 * the weekday from a bare new Date(workDate); no clock pin travels with
 * H12 (prep §7.3: the six source-text specs repoint at H9/H7/H4/H11/H8,
 * not H12). The hr-payroll: advisory lock in decideAttendanceException
 * travels verbatim (pristine total 34 = facade 33 + slice 1).
 */

export interface HrAttendanceExceptionsDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  getPayrollPolicies: (db: any, tenantId: string) => Promise<any>;
  tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
}

@Injectable()
export class HrAttendanceExceptionsService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly getPayrollPolicies: (db: any, tenantId: string) => Promise<any>;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;

  constructor(deps: HrAttendanceExceptionsDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.getPayrollPolicies = deps.getPayrollPolicies;
    this.tenantPredicate = deps.tenantPredicate;
  }

  private buildAttendanceException(
    type: AttendanceExceptionType,
    employeeId: number,
    attendanceRecordId: number | null,
    workDate: string,
    durationMinutes: number,
    scheduledTime?: string | null,
    actualTime?: string | null,
    note?: string | null,
  ) {
    if (!(durationMinutes > 0) && type !== 'unscheduled_time') return null;
    const isMissing = type === 'missing_check_in' || type === 'missing_check_out';
    const isDelayOrEarlyOut = type === 'late_check_in' || type === 'early_check_out' || type === 'short_hours';
    const needsReview = type === 'unscheduled_time' || isMissing;
    return {
      employeeId,
      attendanceRecordId,
      workDate,
      exceptionType: type,
      scheduledTime: scheduledTime || null,
      actualTime: actualTime || null,
      durationMinutes: Math.floor(durationMinutes),
      status: (needsReview ? 'needs_review' : 'pending') as AttendanceExceptionStatus,
      approvedDurationMinutes: isDelayOrEarlyOut ? Math.floor(durationMinutes) : null,
      note: note || null,
    };
  }

  async refreshAttendanceExceptionForEmployeeDate(
    db: Kysely<Database>,
    employeeId: number,
    workDate: string,
    scopeTenantId: string,
  ): Promise<void> {
    // النطاق يُمرَّر من المستدعي (الذي تحقق من ملكية الموظف) بدل اشتقاقه من صف
    // غير مُتحقَّق منه — البند O42. والاستعلام صار مقيَّداً بالنطاق، فإن لم يكن
    // الموظف داخله لا يُنفَّذ شيء بدل أن يُحتسب على مستأجر آخر.
    const empTenant = await sql<{ tenant_id: string; account_id: string }>`
      SELECT tenant_id, account_id FROM hr_employees
      WHERE id = ${employeeId} AND tenant_id = ${scopeTenantId} LIMIT 1
    `.execute(db);
    if (empTenant.rows.length === 0) return;
    const tenantId = empTenant.rows[0]?.tenant_id || '';
    const accountId = empTenant.rows[0]?.account_id || '';
    const tenantTimezone = await getTenantTimezone(db, tenantId);

    const result = await sql<Record<string, unknown>>`
      SELECT
        a.id AS attendance_id,
        to_char(a.work_date, 'YYYY-MM-DD') AS work_date_text,
        to_char(a.check_in_at AT TIME ZONE ${tenantTimezone}, 'YYYY-MM-DD"T"HH24:MI:SS') AS check_in_at_text,
        to_char(a.check_out_at AT TIME ZONE ${tenantTimezone}, 'YYYY-MM-DD"T"HH24:MI:SS') AS check_out_at_text,
        e.scheduled_check_in_time,
        e.scheduled_check_out_time,
        e.grace_minutes,
        e.attendance_policy,
        e.expected_daily_hours,
        e.tenant_id
      FROM hr_attendance_records a
      JOIN hr_employees e ON e.id = a.employee_id
      WHERE a.employee_id = ${employeeId}
        AND a.work_date = ${workDate}::date
      LIMIT 1
    `.execute(db);
    const row = result.rows[0];
    if (!row) {
      await sql`DELETE FROM hr_attendance_exceptions WHERE employee_id = ${employeeId} AND work_date = ${workDate}::date AND (tenant_id = ${tenantId} OR tenant_id = '')`.execute(db);
      return;
    }

    const attendanceId = Number(row.attendance_id || 0);
    const scheduledCheckIn = normalizeTimeOnly(row.scheduled_check_in_time);
    const scheduledCheckOut = normalizeTimeOnly(row.scheduled_check_out_time);
    const graceMinutes = Math.max(0, Number(row.grace_minutes || 0));
    const checkInAtText = clean(row.check_in_at_text);
    const checkOutAtText = clean(row.check_out_at_text);
    const checkInActualTime = normalizeTimeOnly(checkInAtText.slice(11, 16));
    const checkOutActualTime = normalizeTimeOnly(checkOutAtText.slice(11, 16));
    const attendancePolicy = clean(row.attendance_policy) || 'strict';
    const expectedDailyHours = Number(row.expected_daily_hours || 8);
    const effectiveTenantId = String(row.tenant_id || tenantId || '');

    let isHolidayOrWeekend = false;
    if (effectiveTenantId) {
      const globalPolicies = await this.getPayrollPolicies(db, effectiveTenantId);
      const weekendDaysStr = globalPolicies.hrWeekendDays || 'friday,saturday';
      const weekendDays = weekendDaysStr.split(',').map((d: string) => d.trim().toLowerCase());
      
      const dateObj = new Date(workDate);
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayName = dayNames[dateObj.getDay()];
      isHolidayOrWeekend = weekendDays.includes(dayName);
      
      if (!isHolidayOrWeekend) {
        const holidayRes = await sql<{ id: number }>`
          SELECT id FROM hr_holidays 
          WHERE tenant_id = ${tenantId} 
            AND start_date <= ${workDate}::date 
            AND end_date >= ${workDate}::date
          LIMIT 1
        `.execute(db);
        if (holidayRes.rows.length > 0) {
          isHolidayOrWeekend = true;
        }
      }
    }

    const entries: Array<ReturnType<HrAttendanceExceptionsService['buildAttendanceException']>> = [];

    if (isHolidayOrWeekend) {
      if (!checkInActualTime && !checkOutActualTime) {
        await sql`DELETE FROM hr_attendance_exceptions WHERE employee_id = ${employeeId} AND work_date = ${workDate}::date AND (tenant_id = ${tenantId} OR tenant_id = '')`.execute(db);
        return;
      }
      let actualDuration = 0;
      if (checkInActualTime && checkOutActualTime) {
        actualDuration = timeToMinutes(checkOutActualTime) - timeToMinutes(checkInActualTime);
        if (actualDuration < 0) actualDuration += 1440; // Overnight checkout.
      }
      if (actualDuration > 0) {
        entries.push(this.buildAttendanceException('extra_hours', employeeId, attendanceId || null, workDate, actualDuration, null, null));
      } else {
        entries.push(this.buildAttendanceException(
          checkInActualTime ? 'missing_check_out' : 'missing_check_in',
          employeeId,
          attendanceId || null,
          workDate,
          expectedDailyHours * 60,
          scheduledCheckIn || scheduledCheckOut,
          null,
          checkInActualTime ? `حضر في ${checkInActualTime} ولم يسجل انصراف` : `انصرف في ${checkOutActualTime} ولم يسجل حضور`
        ));
      }
    } else if (attendancePolicy === 'flexible') {
      let actualDuration = 0;
      if (checkInActualTime && checkOutActualTime) {
        actualDuration = timeToMinutes(checkOutActualTime) - timeToMinutes(checkInActualTime);
        if (actualDuration < 0) actualDuration += 1440; // Overnight checkout. // Cross midnight edge case, ignored for now
      } else if (checkInActualTime || checkOutActualTime) {
        // Missing a punch
        entries.push(this.buildAttendanceException(
          checkInActualTime ? 'missing_check_out' : 'missing_check_in',
          employeeId,
          attendanceId || null,
          workDate,
          expectedDailyHours * 60,
          scheduledCheckIn || scheduledCheckOut,
          null,
          checkInActualTime ? `حضر في ${checkInActualTime} ولم يسجل انصراف` : `انصرف في ${checkOutActualTime} ولم يسجل حضور`
        ));
      }

      if (checkInActualTime && checkOutActualTime) {
        const expectedDuration = expectedDailyHours * 60;
        if (actualDuration < expectedDuration) {
          entries.push(this.buildAttendanceException('short_hours', employeeId, attendanceId || null, workDate, expectedDuration - actualDuration, null, null));
        } else if (actualDuration > expectedDuration) {
          entries.push(this.buildAttendanceException('extra_hours', employeeId, attendanceId || null, workDate, actualDuration - expectedDuration, null, null));
        }
        
        // Flag unscheduled time if deviation is massive
        if (scheduledCheckIn && checkInActualTime) {
           const delta = Math.abs(timeToMinutes(checkInActualTime) - timeToMinutes(scheduledCheckIn));
           if (delta > 120) { // 2 hours deviation
             entries.push(this.buildAttendanceException('unscheduled_time', employeeId, attendanceId || null, workDate, delta, scheduledCheckIn, checkInActualTime));
           }
        }
      }
    } else {
      if (scheduledCheckIn && checkInActualTime) {
        const delta = timeToMinutes(checkInActualTime) - timeToMinutes(scheduledCheckIn);
        if (delta < 0) {
          entries.push(this.buildAttendanceException('early_check_in', employeeId, attendanceId || null, workDate, Math.abs(delta), scheduledCheckIn, checkInActualTime));
        } else if (delta > graceMinutes) {
          entries.push(this.buildAttendanceException('late_check_in', employeeId, attendanceId || null, workDate, delta - graceMinutes, scheduledCheckIn, checkInActualTime));
        }
      } else if (!checkInActualTime && checkOutActualTime) {
        entries.push(this.buildAttendanceException('missing_check_in', employeeId, attendanceId || null, workDate, expectedDailyHours * 60, scheduledCheckIn, null, `انصرف في ${checkOutActualTime} ولم يسجل حضور`));
      }

      if (scheduledCheckOut && checkOutActualTime) {
        const delta = timeToMinutes(checkOutActualTime) - timeToMinutes(scheduledCheckOut);
        if (delta < -graceMinutes) {
          entries.push(this.buildAttendanceException('early_check_out', employeeId, attendanceId || null, workDate, Math.abs(delta) - graceMinutes, scheduledCheckOut, checkOutActualTime));
        } else if (delta > 0) {
          let eligibleForOvertime = true;
          if (scheduledCheckIn && checkInActualTime) {
            let expectedDuration = timeToMinutes(scheduledCheckOut) - timeToMinutes(scheduledCheckIn);
            let actualDuration = timeToMinutes(checkOutActualTime) - timeToMinutes(checkInActualTime);
            if (expectedDuration < 0) expectedDuration += 1440;
            if (actualDuration < 0) actualDuration += 1440;
            if (actualDuration < expectedDuration) eligibleForOvertime = false;
          }
          if (eligibleForOvertime) {
            entries.push(this.buildAttendanceException('late_check_out', employeeId, attendanceId || null, workDate, delta, scheduledCheckOut, checkOutActualTime));
          }
        }
      } else if (checkInActualTime && !checkOutActualTime) {
        entries.push(this.buildAttendanceException('missing_check_out', employeeId, attendanceId || null, workDate, expectedDailyHours * 60, scheduledCheckOut, null, `حضر في ${checkInActualTime} ولم يسجل انصراف`));
      }
    }

    const existingExceptions = await sql<{ exception_type: string; status: string; note: string; approved_duration_minutes: number | null }>`
      SELECT exception_type, status, note, approved_duration_minutes FROM hr_attendance_exceptions
      WHERE employee_id = ${employeeId} AND work_date = ${workDate}::date AND (tenant_id = ${tenantId} OR tenant_id = '')
    `.execute(db);
    const existingMap = new Map(existingExceptions.rows.map(r => [r.exception_type, r]));

    await sql`DELETE FROM hr_attendance_exceptions WHERE employee_id = ${employeeId} AND work_date = ${workDate}::date AND (tenant_id = ${tenantId} OR tenant_id = '')`.execute(db);
    for (const entry of entries) {
      if (!entry) continue;
      const existing = existingMap.get(entry.exceptionType);
      let statusToInsert = entry.status;
      let approvedDuration = entry.approvedDurationMinutes;
      let noteToInsert = entry.note;
      if (existing && (existing.status === 'approved' || existing.status === 'skipped')) {
        statusToInsert = existing.status as AttendanceExceptionStatus;
        approvedDuration = existing.approved_duration_minutes;
        noteToInsert = existing.note || entry.note;
      }
      await sql`
        INSERT INTO hr_attendance_exceptions (
          tenant_id, account_id,
          employee_id, attendance_record_id, work_date, exception_type,
          scheduled_time, actual_time, duration_minutes, status, approved_duration_minutes, note, created_at, updated_at
        )
        VALUES (
          ${tenantId}, ${accountId},
          ${entry.employeeId}, ${entry.attendanceRecordId}, ${entry.workDate}::date, ${entry.exceptionType},
          ${entry.scheduledTime || null}, ${entry.actualTime || null},
          ${entry.durationMinutes}, ${statusToInsert}, ${approvedDuration}, ${noteToInsert}, NOW(), NOW()
        )
      `.execute(db);
    }
  }

  async listAttendanceExceptions(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const exceptionDigits = await tenantBookDigits(this.db, tenantId);
    const workDate = normalizeDateOnly(query.date) || normalizeDateOnly(query.workDate);
    const month = clean(query.month);
    const status = clean(query.status).toLowerCase();
    const search = clean(query.search).toLowerCase();
    const employeeId = query.employeeId ? Number(query.employeeId) : null;
    const departmentId = query.departmentId ? Number(query.departmentId) : null;

    let monthCondition = sql`1=1`;
    if (month) {
      const range = monthRange(month);
      monthCondition = sql`ex.work_date >= ${range.from}::date AND ex.work_date <= ${range.to}::date`;
    }
    const employeeCondition = employeeId && !isNaN(employeeId) ? sql`ex.employee_id = ${employeeId}` : sql`1=1`;
    const departmentCondition = departmentId && !isNaN(departmentId) ? sql`e.department_id = ${departmentId}` : sql`1=1`;

    try {
      const globalPolicies = await this.getPayrollPolicies(this.db, tenantId);

      // INV-HR-ATTENDANCE-SQL-PAGINATION: the incident_index_in_month
      // window is computed over the FULL pre-filter set — the old code ran
      // ROW_NUMBER() in SQL and applied the status/search filters in JS
      // afterwards, so a status-filtered incident keeps its true index
      // (and its progressive penalty tier). The window therefore lives in
      // an inner query and the status/search filters apply in an outer
      // query; the COUNT and the page read the same outer predicates.
      // The per-row penalty engine runs only on the page's rows.
      const base = sql<Record<string, unknown>>`
        SELECT
          ex.id,
          ex.employee_id,
          ex.attendance_record_id,
          ex.work_date,
          ex.exception_type,
          ex.scheduled_time,
          ex.actual_time,
          ex.duration_minutes,
          ex.status,
          ex.approved_duration_minutes,
          ex.note,
          e.employee_no,
          e.display_name AS employee_name,
          e.department_id,
          e.compensation_type,
          e.hourly_rate,
          e.expected_daily_hours,
          e.delay_policy,
          e.attendance_policy,
          e.grace_minutes,
          c.base_salary,
          to_char(ex.work_date, 'YYYY-MM-DD') AS work_date_text,
          ex.scheduled_time AS scheduled_time_text,
          ex.actual_time AS actual_time_text,
          ROW_NUMBER() OVER (
            PARTITION BY ex.employee_id, to_char(ex.work_date, 'YYYY-MM'),
              CASE WHEN ex.exception_type IN ('late_check_in', 'early_check_out') THEN 'late_early' ELSE ex.exception_type END
            ORDER BY ex.work_date ASC, ex.id ASC
          ) AS incident_index_in_month
        FROM hr_attendance_exceptions ex
        JOIN hr_employees e ON e.id = ex.employee_id
        LEFT JOIN LATERAL (
          SELECT c.base_salary, c.status
          FROM hr_employment_contracts c
          WHERE c.employee_id = e.id AND c.tenant_id = e.tenant_id
          ORDER BY CASE WHEN c.status = 'active' THEN 1 ELSE 2 END, c.id DESC
          LIMIT 1
        ) c ON TRUE
        WHERE ${this.tenantPredicate(auth, 'e')}
          AND (${workDate || ''} = '' OR ex.work_date = ${workDate || null}::date)
          AND ${monthCondition}
          AND ${employeeCondition}
          AND ${departmentCondition}
      `;
      // The status filter matches the RAW trimmed status against the
      // LOWERCASED query (the old JS compared clean(row.status) with the
      // lowercased query, no lowercase on the stored value).
      const statusFilter = status
        ? sql<boolean>`btrim(s.status) = ${status}`
        : sql<boolean>`1=1`;
      const searchFilter = search
        ? sql<boolean>`strpos(lower(btrim(s.employee_no)), ${search}) > 0 OR strpos(lower(btrim(s.employee_name)), ${search}) > 0 OR strpos(lower(btrim(s.exception_type)), ${search}) > 0`
        : sql<boolean>`1=1`;
      const totals = await sql<{ total: string }>`
        SELECT COUNT(*)::text AS total FROM (${base}) s
        WHERE ${statusFilter} AND ${searchFilter}
      `.execute(this.db);
      const totalItems = Number(totals.rows[0]?.total || 0);
      // Old in-memory pagination semantics preserved: defaultSize 50, page clamped
      // to [1, totalPages], totalPages = max(1, ceil(total / pageSize)).
      // The cap is now 200 (boundedPage), not 100.
      const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 50);
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * pageSize;
      const result = await sql<Record<string, unknown>>`
        SELECT * FROM (${base}) s
        WHERE ${statusFilter} AND ${searchFilter}
        ORDER BY s.work_date DESC, s.employee_name ASC, s.id DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `.execute(this.db);

      const rows = result.rows.map((row) => {
        const penalty = calculateAttendancePenalty({
          exceptionType: clean(row.exception_type),
          durationMinutes: Number(row.duration_minutes || 0),
          compensationType: clean(row.compensation_type),
          baseSalary: Number(row.base_salary || 0),
          hourlyRate: Number(row.hourly_rate || 0),
          expectedDailyHours: Number(row.expected_daily_hours || 8) || 8,
          delayPolicy: clean(row.delay_policy) || 'inherit',
          incidentIndexInMonth: Number(row.incident_index_in_month || 1),
          globalDelayPolicyEnabled: globalPolicies.hrDelayPolicyEnabled === true,
          globalFirstTimeDeduction: Number(globalPolicies.hrDelayPolicyFirstTimeDeduction || 0.25),
          globalSecondTimeDeduction: Number(globalPolicies.hrDelayPolicySecondTimeDeduction || 0.50),
          globalThirdTimeDeduction: Number(globalPolicies.hrDelayPolicyThirdTimeDeduction || 1.00),
          globalFourthTimeDeduction: Number(globalPolicies.hrDelayPolicyFourthTimeDeduction || 1.00),
          graceMinutes: Number(row.grace_minutes || 0),
          overtimeMultiplier: Number.isFinite(Number(globalPolicies.overtimeMultiplier)) && Number(globalPolicies.overtimeMultiplier) >= 1 ? Number(globalPolicies.overtimeMultiplier) : 1,
          referenceDate: clean(row.work_date_text),
          minorUnits: exceptionDigits,
        });

        return {
          id: String(row.id),
          employeeId: String(row.employee_id),
          departmentId: row.department_id ? String(row.department_id) : undefined,
          employeeNo: clean(row.employee_no),
          employeeName: clean(row.employee_name),
          workDate: clean(row.work_date_text),
          exceptionType: clean(row.exception_type),
          scheduledTime: clean(row.scheduled_time_text),
          actualTime: clean(row.actual_time_text),
          durationMinutes: Number(row.duration_minutes || 0),
          approvedDurationMinutes: row.approved_duration_minutes == null ? null : Number(row.approved_duration_minutes),
          status: clean(row.status),
          note: clean(row.note),
          estimatedAmount: penalty.estimatedAmount,
          hourlyRate: penalty.hourlyRate,
          dailyRate: penalty.dailyRate,
          policyDescription: penalty.policyDescription,
          delayPolicy: clean(row.delay_policy) || 'inherit',
        };
      });

      return { rows, pagination: { page: safePage, pageSize, totalItems, totalPages }, summary: { totalItems } };
    } catch {
      const { pageSize } = boundedPage(query.page, query.pageSize, 200, 50);
      return { rows: [], pagination: { page: 1, pageSize, totalItems: 0, totalPages: 1 }, summary: { totalItems: 0 } };
    }
  }

  async decideAttendanceException(id: number, status: 'approved' | 'skipped', payload: DecideAttendanceExceptionDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    let workDate = '';
    await this.tx.runInTransaction(this.db, async trx => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const currentResult = await sql<{ id: number; employee_id: number; status: string; duration_minutes: number; work_date: string }>`
        SELECT id, employee_id, status, duration_minutes,
               to_char(work_date, 'YYYY-MM-DD') AS work_date
        FROM hr_attendance_exceptions
        WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1 FOR UPDATE
      `.execute(trx);
      const current = currentResult.rows[0];
      if (!current) throw new AppError('Attendance exception not found', 'HR_ATTENDANCE_EXCEPTION_NOT_FOUND', 404);
      workDate = String(current.work_date);
      const booked = await sql<{ id: number }>`
        SELECT r.id FROM hr_payroll_runs r
        JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id
        WHERE r.tenant_id = ${tenantId} AND i.employee_id = ${current.employee_id}
          AND r.status IN ('approved', 'paid') AND i.status = 'approved'
          AND ${workDate}::date BETWEEN r.start_date AND r.end_date
        LIMIT 1
      `.execute(trx);
      if (booked.rows.length) {
        throw new AppError('لا يمكن تغيير استثناء حضور دخل بالفعل في مسير مرتبات معتمد؛ يلزم قيد تسوية منفصل',
          'HR_ATTENDANCE_EXCEPTION_PAYROLL_LOCKED', 409);
      }
      const rawApproved = Number(payload.approvedDurationMinutes ?? current.duration_minutes ?? 0);
      const actualMinutes = Number(current.duration_minutes || 0);
      if (status === 'approved' && (!Number.isFinite(rawApproved) || rawApproved < 0
        || !Number.isFinite(actualMinutes) || actualMinutes < 0 || rawApproved > actualMinutes)) {
        throw new AppError('دقائق الحضور المعتمدة يجب أن تكون بين صفر والمدة المثبتة', 'HR_ATTENDANCE_APPROVED_MINUTES_INVALID', 400);
      }
      const approvedDurationMinutes = status === 'approved' ? Math.floor(rawApproved) : null;
      await sql`
        UPDATE hr_attendance_exceptions
        SET status = ${status}, approved_duration_minutes = ${approvedDurationMinutes},
            note = ${clean(payload.note) || null}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `.execute(trx);
    });
    await this.audit.log(
      `${status === 'approved' ? 'Approve' : 'Skip'} attendance exception`,
      `Attendance exception #${id} ${status} by ${auth.username}`, auth,
    );
    return this.listAttendanceExceptions({ date: workDate }, auth);
  }
}
