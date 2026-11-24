import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { boundedPage } from '../../../common/utils/bounded-page';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { BulkSaveAttendanceDto, UpsertAttendanceRecordDto, BulkImportAttendanceDto } from '../dto/hr.dto';
import { getTenantTimezone, todayTenantDate, formatTimeInTimezone } from '../../../common/utils/tenant-timezone.util';
import { firstDayOfTenantMonth } from '../../../common/utils/client-date-bounds.util';
import {
  AttendancePunchError,
  resolveAttendancePunch,
  startsNewSession,
  type AttendancePunchResolution,
} from '../attendance-punch.engine';
import { type RawBuilder } from 'kysely';
import { buildAttendanceDayAuditKey, clean, combineNotes, normalizeAttendanceSource, normalizeAttendanceStatus, normalizeDateOnly, toId } from '../hr-helpers';

/**
 * HrAttendanceRecordsService — slice H11 of the hr split.
 * Pure move of 5 methods from HrService (attendance list, bulk save,
 * single-record upsert, bulk import, posted-day guard). No behavior
 * change: the bodies are byte-identical; the facade keeps thin delegates
 * with the same names and signatures for the 4 public methods.
 * assertAttendanceDayNotPosted stays PRIVATE in the slice (no facade
 * delegate) — it is called only by this slice's own methods (prep §2.4).
 * Deps: db + tx + audit + bound tenantPredicate (kernel — stays private
 * in the facade, passed bound via the S3 pattern) + bound
 * refreshAttendanceExceptionForEmployeeDate (H12, public-in-slice —
 * signature (db: Kysely<Database>, employeeId: number, workDate: string,
 * scopeTenantId: string) => Promise<void>; the facade passes
 * this.attendanceExceptionsService.<method>.bind(this); H12 merges BEFORE
 * H11, so the field exists at merge).
 * Free helpers (buildAttendanceDayAuditKey, clean, combineNotes,
 * normalizeAttendanceSource, normalizeAttendanceStatus, normalizeDateOnly,
 * toId) are imported from '../hr-helpers' (created with the H0 merge);
 * they are NOT copied into this slice. requireTenantScope is called
 * DIRECTLY as a free function by the moved methods, so the slice imports
 * it (prep §7.7). Attendance punches resolve through the
 * resolveAttendancePunch engine (./attendance-punch.engine); payable
 * minutes through calculatePayableMinutes / resolveExpectedDailyMinutes
 * (./engines/hourly-attendance-pay.engine) — INV-HR-ATTENDANCE-SQL-
 * PAGINATION moved the single-day summary into SQL, translating those
 * two engines faithfully (wall-clock elapsed minutes, scheduled-times
 * expected minutes with overnight wrap, the payable policy branches);
 * the range path above already aggregates in SQL and is untouched.
 * PGLITE TRAP (prep §7.6): this slice holds the file's ONLY 2
 * this.db.transaction() sites — upsertAttendanceRecord (pristine L5198)
 * and bulkImportAttendanceRecords (pristine L5343). They move
 * byte-identical (NOT converted to tx.runInTransaction — that would be a
 * behavior change). The merge proof uses the direct-helper pattern + a
 * live-Postgres rehearsal item for the posting branch.
 * Date handling travels verbatim: listAttendance / upsertAttendanceRecord
 * resolve the tenant timezone then todayTenantDate(tz); the 3 bare
 * new Date().toISOString() sites are response stamps (serverTime ×2) and
 * the check-in fallback in upsertAttendanceRecord (pristine L5248 —
 * server instant as punch default, per the single-server-clock rule);
 * .slice(0, 10) count is 0 (§10 pinZero stays 0). No toFixed2, no
 * inlineRound, no FX in this slice.
 * No spec repoint travels in this patch — prep §7.3 rules all six
 * source-text repoints MERGE-OWNED (clock-p6:669 reads
 * HR_ATTENDANCE_DATE_OUT_OF_RANGE, which lives in bulkSaveAttendance /
 * bulkImportAttendanceRecords). H11's driving specs (prep §4.2/§6.5):
 * clock-p6 (bulkSaveAttendance, bulkImportAttendanceRecords),
 * audit-log-general-attendance-idempotency (bulkSaveAttendance),
 * split-shift-day-sum (upsertAttendanceRecord), clock-p8
 * (listAttendance).
 */

export interface HrAttendanceRecordsDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  refreshAttendanceExceptionForEmployeeDate: (db: Kysely<Database>, employeeId: number, workDate: string, scopeTenantId: string) => Promise<void>;
}

@Injectable()
export class HrAttendanceRecordsService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
  private readonly refreshAttendanceExceptionForEmployeeDate: (db: Kysely<Database>, employeeId: number, workDate: string, scopeTenantId: string) => Promise<void>;

  constructor(deps: HrAttendanceRecordsDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.tenantPredicate = deps.tenantPredicate;
    this.refreshAttendanceExceptionForEmployeeDate = deps.refreshAttendanceExceptionForEmployeeDate;
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

    // INV-HR-ATTENDANCE-SQL-PAGINATION: the single-day path loaded every
    // employee for the day, mapped the full set in JS and reduced the
    // summary (status counts + workedMinutes + payableMinutes) over it.
    // The page query and the summary aggregates now share one inner row
    // select. The per-row math is translated faithfully from the JS
    // engine, NOT from the range path's approximation:
    // - elapsed_minutes is the tenant-timezone WALL-CLOCK difference
    //   (what `new Date()` on the to_char() strings computes);
    // - expected minutes follow resolveExpectedDailyMinutes
    //   (expected_daily_hours, else the scheduled HH:MM pair with the
    //   overnight wrap, else 480);
    // - payable follows calculatePayableMinutes (actual <= expected ->
    //   actual; auto_approved -> actual; disabled -> expected; else
    //   expected + min(extra, approved)).
    // The range path above is already bounded DB pagination — untouched.
    const dayRows = sql<Record<string, unknown>>`
      SELECT
        e.id AS employee_id,
        e.employee_no,
        e.compensation_type, e.hourly_rate,
        e.display_name AS employee_name,
        d.name AS department_name,
        j.name AS job_title_name,
        a.id AS attendance_id,
        to_char(a.work_date, 'YYYY-MM-DD') AS work_date_text,
        CASE WHEN a.status IS NULL OR a.status NOT IN ('present', 'absent', 'late', 'half_day', 'leave', 'excused', 'early_leave') THEN 'unmarked' ELSE a.status END AS status,
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
        ), 0) AS pending_overtime_minutes,
        CASE WHEN a.check_in_at IS NOT NULL AND a.check_out_at IS NOT NULL
          THEN FLOOR(EXTRACT(EPOCH FROM ((a.check_out_at AT TIME ZONE ${tenantTimezone})::timestamp - (a.check_in_at AT TIME ZONE ${tenantTimezone})::timestamp)) / 60)
          ELSE NULL END AS elapsed_minutes,
        CASE WHEN substring(btrim(e.scheduled_check_in_time) from 1 for 5) ~ '^[0-9]{1,2}:[0-9]{1,2}$'
          THEN split_part(substring(btrim(e.scheduled_check_in_time) from 1 for 5), ':', 1)::int * 60 + split_part(substring(btrim(e.scheduled_check_in_time) from 1 for 5), ':', 2)::int
          ELSE NULL END AS sched_in_min,
        CASE WHEN substring(btrim(e.scheduled_check_out_time) from 1 for 5) ~ '^[0-9]{1,2}:[0-9]{1,2}$'
          THEN split_part(substring(btrim(e.scheduled_check_out_time) from 1 for 5), ':', 1)::int * 60 + split_part(substring(btrim(e.scheduled_check_out_time) from 1 for 5), ':', 2)::int
          ELSE NULL END AS sched_out_min
      FROM hr_employees e
      LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id AND d.tenant_id = e.tenant_id
      LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id AND j.tenant_id = e.tenant_id
      LEFT JOIN hr_attendance_records a ON a.employee_id = e.id AND a.tenant_id = e.tenant_id AND a.work_date = ${workDate}::date
      WHERE ${this.tenantPredicate(auth, 'e')}
        AND e.status IN ('active', 'inactive')
        AND (${requestedEmployeeId}::BIGINT IS NULL OR e.id = ${requestedEmployeeId})
        AND (${requestedDepartmentId}::BIGINT IS NULL OR e.department_id = ${requestedDepartmentId})
        AND (${search} = '' OR strpos(lower(btrim(COALESCE(e.employee_no, ''))), ${search}) > 0 OR strpos(lower(btrim(e.display_name)), ${search}) > 0 OR strpos(lower(btrim(COALESCE(d.name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(j.name, ''))), ${search}) > 0)
    `;
    const totals = await sql<{ total: string; present: string; absent: string; late: string; leave: string; unmarked: string; minutes: string; payable_minutes: string }>`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE status = 'present')::text AS present,
        COUNT(*) FILTER (WHERE status = 'absent')::text AS absent,
        COUNT(*) FILTER (WHERE status = 'late')::text AS late,
        COUNT(*) FILTER (WHERE status = 'leave')::text AS leave,
        COUNT(*) FILTER (WHERE status = 'unmarked')::text AS unmarked,
        COALESCE(SUM(CASE WHEN elapsed_minutes IS NOT NULL AND status NOT IN ('absent', 'leave') AND elapsed_minutes > 0 AND elapsed_minutes <= 1440 THEN elapsed_minutes ELSE 0 END), 0)::text AS minutes,
        COALESCE(SUM(CASE WHEN compensation_type = 'hourly' AND elapsed_minutes IS NOT NULL AND status NOT IN ('absent', 'leave') AND elapsed_minutes > 0 AND elapsed_minutes <= 1440 THEN
          CASE
            WHEN elapsed_minutes <= expected_minutes THEN elapsed_minutes
            WHEN policy_norm = 'auto_approved' THEN elapsed_minutes
            WHEN policy_norm = 'disabled' THEN expected_minutes
            ELSE expected_minutes + LEAST(elapsed_minutes - expected_minutes, GREATEST(0, FLOOR(COALESCE(approved_overtime_minutes, 0))))
          END
          ELSE 0 END), 0)::text AS payable_minutes
      FROM (
        SELECT *,
          CASE
            WHEN expected_daily_hours IS NOT NULL AND expected_daily_hours > 0
              THEN GREATEST(1, ROUND(expected_daily_hours * 60)::int)
            WHEN shift_minutes BETWEEN 1 AND 1440 THEN shift_minutes
            ELSE 480
          END AS expected_minutes,
          lower(COALESCE(NULLIF(btrim(overtime_policy), ''), 'review_only')) AS policy_norm
        FROM (
          SELECT *,
            CASE WHEN sched_in_min IS NOT NULL AND sched_out_min IS NOT NULL
              THEN CASE WHEN sched_out_min <= sched_in_min THEN sched_out_min + 1440 - sched_in_min ELSE sched_out_min - sched_in_min END
              ELSE NULL END AS shift_minutes
          FROM (${dayRows}) s
        ) s2
      ) t
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
      SELECT * FROM (${dayRows}) s
      ORDER BY s.employee_name ASC, s.employee_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);

    const rows = result.rows.map((row) => {
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

    return {
      rows,
      pagination: { page: safePage, pageSize, totalItems, totalPages },
      summary: {
        totalItems,
        presentCount: Number(totals.rows[0]?.present || 0),
        absentCount: Number(totals.rows[0]?.absent || 0),
        lateCount: Number(totals.rows[0]?.late || 0),
        leaveCount: Number(totals.rows[0]?.leave || 0),
        unmarkedCount: Number(totals.rows[0]?.unmarked || 0),
        workedMinutes: Number(totals.rows[0]?.minutes || 0),
        payableMinutes: Number(totals.rows[0]?.payable_minutes || 0),
      },
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
}
