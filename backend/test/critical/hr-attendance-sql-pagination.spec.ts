/*
 * INV-HR-ATTENDANCE-SQL-PAGINATION: `listAttendanceExceptions` and the
 * single-day path of `listAttendance` must fetch only the requested page
 * from the database — never load the whole tenant set and slice one page
 * out of it in memory.
 *
 * THE BUG: both methods loaded every matching row, mapped the full set in
 * memory (the exceptions method ran the pure `calculateAttendancePenalty`
 * engine per row; the attendance method reduced status counts +
 * workedMinutes + payableMinutes over every row), then sliced one page
 * with paginateRows(rows, query, { defaultSize: 50 }) — maxSize defaults
 * to 100, so a client asking pageSize=150 silently received 100 rows.
 *
 * RULES PINNED HERE, driving the REAL HrService (facade) on PGlite:
 * 1. The page-size cap is 200: pageSize=150 returns 150 rows (the old
 *    code returned 100), pageSize=1000 returns 200 rows. Both methods.
 * 2. Only the requested page is returned, the old ORDER BY preserved
 *    (exceptions: work_date DESC, display_name ASC, id DESC; attendance:
 *    display_name ASC, id ASC).
 * 3. The default page is 50 rows (defaultSize 50 preserved). Both methods.
 * 4. A page past the end clamps to the last page (page 99 -> last).
 * 5. EXCEPTIONS — the incident_index_in_month window is computed over the
 *    FULL pre-filter set: the old code ran ROW_NUMBER() in SQL and applied
 *    the status/search filters in JS afterwards, so a status-filtered
 *    incident keeps its true index (and its progressive penalty tier).
 *    Pinned: with status='pending' the 2026-11-12 incident still reads
 *    estimatedAmount 100 (index 3, full day), NOT 50 (index 2).
 * 6. EXCEPTIONS — the status filter matches the RAW trimmed status
 *    against the LOWERCASED query (clean(row.status) === query.toLowerCase(),
 *    no lowercase on the stored value); the search is a case-insensitive
 *    substring over employeeNo / employeeName / exceptionType.
 * 7. EXCEPTIONS — the catch path returns the identical empty result
 *    (paged [], totalItems 0, totalPages 1, page 1), with the new 200 cap.
 *    Pinned via a tenant whose payroll_policies JSON is corrupt.
 * 8. ATTENDANCE — the summary stays exact over the FULL filtered set,
 *    never page-scoped: status counts + workedMinutes + payableMinutes,
 *    pinned on a page-2 call too. The minutes math is FAITHFUL to the JS
 *    engine, not the range path's approximation: elapsed is the
 *    tenant-timezone WALL-CLOCK difference (what `new Date()` on the
 *    to_char() strings computes), expected minutes follow
 *    resolveExpectedDailyMinutes (expected_daily_hours, else the scheduled
 *    HH:MM pair with overnight wrap, else 480), and payable follows
 *    calculatePayableMinutes (actual <= expected -> actual; auto_approved
 *    -> actual; disabled -> expected; else expected + min(extra, approved)).
 *    Pinned cases: scheduled-times fallback (Basma 09:00-17:00 -> 480),
 *    overnight wrap (Celia 22:00-06:00 -> 480), equal scheduled times
 *    (Karim 08:00-08:00 -> 1440), garbage scheduled times (Jana -> 480),
 *    approved-overtime cap (Basma +30 of 90 extra -> 510), pending
 *    overtime never pays (Dalia pending 60 -> payable 600 via auto_approved,
 *    pendingOvertimeMinutes 60 shown separately).
 * 9. ATTENDANCE — half_day counts toward worked/payable minutes (only
 *    absent/leave are excluded); unmarked rows (no record) count in
 *    totalItems + unmarkedCount and add no minutes.
 * 10. The RANGE path of listAttendance is already bounded DB pagination
 *     and is NOT touched here — a smoke assertion pins it still works
 *     with the same totals.
 *
 * Session timezone is pinned to UTC and the tenant timezone is 'UTC', so
 * the to_char() punch times are deterministic. Prospective only; PGlite only.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const AUTH_T1 = {
  userId: 1, sessionId: 'sess-spec', username: 'actor-1', role: 'admin',
  permissions: [], tenantId: 't1', accountId: 'a1',
} as unknown as AuthContext;
const AUTH_T2 = {
  userId: 1, sessionId: 'sess-spec', username: 'actor-1', role: 'admin',
  permissions: [], tenantId: 't2', accountId: 'a1',
} as unknown as AuthContext;
const AUTH_T3 = {
  userId: 1, sessionId: 'sess-spec', username: 'actor-1', role: 'admin',
  permissions: [], tenantId: 't3', accountId: 'a1',
} as unknown as AuthContext;

type ExceptionRow = {
  id: string; employeeId: string; employeeNo: string; employeeName: string;
  workDate: string; exceptionType: string; durationMinutes: number;
  approvedDurationMinutes: number | null; status: string;
  estimatedAmount: number; hourlyRate: number; dailyRate: number;
  policyDescription: string; delayPolicy: string;
};
type ExceptionsResult = {
  rows: ExceptionRow[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: { totalItems: number };
};

type AttendanceRow = {
  id: string; employeeId: string; employeeNo: string; employeeName: string;
  departmentName: string; jobTitleName: string; compensationType: string;
  hourlyRate: number; workDate: string; status: string;
  checkInAt: string; checkOutAt: string; source: string; notes: string;
  scheduledCheckInTime: string; scheduledCheckOutTime: string;
  graceMinutes: number; departmentId: string;
  expectedDailyHours: number | null; overtimePolicy: string;
  approvedOvertimeMinutes: number; pendingOvertimeMinutes: number;
};
type AttendanceResult = {
  rows: AttendanceRow[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: {
    totalItems: number; presentCount: number; absentCount: number; lateCount: number;
    leaveCount?: number; unmarkedCount?: number; workedMinutes: number; payableMinutes: number;
  };
  serverTime: string; serverTimezone: string; workDate: string;
  from?: string; to?: string;
};

async function listExceptions(hr: HrService, query: Record<string, unknown>, auth: AuthContext): Promise<ExceptionsResult> {
  return (await hr.listAttendanceExceptions(query, auth)) as unknown as ExceptionsResult;
}
async function listAttendance(hr: HrService, query: Record<string, unknown>, auth: AuthContext): Promise<AttendanceResult> {
  return (await hr.listAttendance(query, auth)) as unknown as AttendanceResult;
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const hr = new HrService(db, new TransactionHelper(), { log: async () => {} } as never, {} as never, {} as never, undefined);

  try {
    await pg.exec(`SET TIME ZONE 'UTC'`);
    await pg.exec(`
      CREATE TABLE settings (id bigserial PRIMARY KEY, tenant_id text, key text, value text);
      CREATE TABLE hr_departments (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE hr_job_titles (id bigint PRIMARY KEY, tenant_id text, name text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, employee_no text, display_name text, department_id bigint, job_title_id bigint, compensation_type text, hourly_rate numeric, expected_daily_hours numeric, delay_policy text, attendance_policy text, grace_minutes int, status text, scheduled_check_in_time text, scheduled_check_out_time text, overtime_policy text);
      CREATE TABLE hr_employment_contracts (id bigint PRIMARY KEY, employee_id bigint, tenant_id text, base_salary numeric, status text);
      CREATE TABLE hr_attendance_exceptions (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, attendance_record_id bigint, work_date date, exception_type text, scheduled_time text, actual_time text, duration_minutes int, status text, approved_duration_minutes int, note text);
      CREATE TABLE hr_attendance_records (id bigint PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, work_date date, status text, check_in_at timestamptz, check_out_at timestamptz, source text, notes text, prior_sessions_minutes int);
      CREATE TABLE hr_hr_settings (tenant_id text, account_id text, key text, value text);
      INSERT INTO settings (tenant_id, key, value) VALUES
        ('t1', 'timezone', 'UTC'), ('t1', 'currency', 'EGP'),
        ('t2', 'timezone', 'UTC'), ('t2', 'currency', 'EGP'),
        ('t3', 'timezone', 'UTC'), ('t3', 'currency', 'EGP');
      INSERT INTO hr_hr_settings (tenant_id, account_id, key, value) VALUES
        ('t1', 'a1', 'payroll_policies', '{"hrDelayPolicyEnabled": true}'),
        ('t2', 'a1', 'payroll_policies', 'not-json{');
      INSERT INTO hr_departments (id, tenant_id, name) VALUES
        (1, 't1', 'Sales'), (2, 't1', 'Warehouse'),
        (3, 't3', 'Sales'), (4, 't3', 'Warehouse');
      INSERT INTO hr_job_titles (id, tenant_id, name) VALUES (1, 't3', 'Cashier');
      INSERT INTO hr_employees (id, tenant_id, employee_no, display_name, department_id, job_title_id, compensation_type, hourly_rate, expected_daily_hours, delay_policy, attendance_policy, grace_minutes, status, scheduled_check_in_time, scheduled_check_out_time, overtime_policy) VALUES
        (1, 't1', 'E001', 'Ahmed Ali', 1, NULL, 'monthly', 0, NULL, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only'),
        (2, 't1', 'E002', 'Sara Ahmed', 2, NULL, 'monthly', 0, NULL, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only'),
        (3, 't1', 'E003', 'Filler Employee', 1, NULL, 'monthly', 0, NULL, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only');
      INSERT INTO hr_employment_contracts (id, employee_id, tenant_id, base_salary, status) VALUES
        (1, 1, 't1', 3000, 'active'), (2, 2, 't1', 3000, 'active');
      INSERT INTO hr_attendance_exceptions (id, tenant_id, account_id, employee_id, attendance_record_id, work_date, exception_type, scheduled_time, actual_time, duration_minutes, status, approved_duration_minutes, note) VALUES
        (1, 't1', 'a1', 1, NULL, '2026-11-10', 'late_check_in', NULL, NULL, 60, 'pending', NULL, ''),
        (2, 't1', 'a1', 1, NULL, '2026-11-11', 'late_check_in', NULL, NULL, 30, 'approved', NULL, ''),
        (3, 't1', 'a1', 1, NULL, '2026-11-12', 'late_check_in', NULL, NULL, 45, 'pending', NULL, ''),
        (4, 't1', 'a1', 1, NULL, '2026-11-13', 'late_check_out', NULL, NULL, 60, 'pending', NULL, ''),
        (5, 't1', 'a1', 2, NULL, '2026-11-10', 'late_check_in', NULL, NULL, 60, 'pending', NULL, '');
      INSERT INTO hr_attendance_exceptions (id, tenant_id, account_id, employee_id, attendance_record_id, work_date, exception_type, scheduled_time, actual_time, duration_minutes, status, approved_duration_minutes, note)
        SELECT gs, 't1', 'a1', 3, NULL, '2026-11-01', 'late_check_in', NULL, NULL, 5, 'pending', NULL, '' FROM generate_series(100, 339) AS gs;
    `);

    // ---- listAttendanceExceptions: 245 rows (5 named + 240 fillers) ----
    // Order: work_date DESC, display_name ASC, id DESC.
    // Penalty pins (monthly, base 3000, Nov 2026 = 30 days -> daily 100,
    // hourly 12.5; progressive delay policy enabled for t1):
    //   id1 idx1 -> 25, id2 idx2 -> 50, id3 idx3 -> 100,
    //   id4 late_check_out overtime 1.5x -> 18.75, id5 (Sara) idx1 -> 25.

    // 1. Default page is 50 rows, order + penalty amounts pinned.
    const exDef = await listExceptions(hr, {}, AUTH_T1);
    assert.equal(exDef.rows.length, 50, 'exceptions default page must be 50 rows');
    assert.equal(exDef.pagination.page, 1, 'exceptions default page must be 1');
    assert.equal(exDef.pagination.totalItems, 245, 'exceptions totalItems must be 245');
    assert.equal(exDef.pagination.totalPages, 5, 'exceptions totalPages must be ceil(245 / 50)');
    assert.equal(exDef.rows[0].id, '4', 'exceptions page 1 must start at id 4 (2026-11-13)');
    assert.equal(exDef.rows[0].estimatedAmount, 18.75, 'id 4 overtime must be 18.75 (60min x 12.5 x 1.5)');
    assert.equal(exDef.rows[1].id, '3', 'exceptions page 1 second row must be id 3');
    assert.equal(exDef.rows[1].estimatedAmount, 100, 'id 3 must be 100 (index 3, full day)');
    assert.equal(exDef.rows[2].id, '2', 'exceptions page 1 third row must be id 2');
    assert.equal(exDef.rows[2].estimatedAmount, 50, 'id 2 must be 50 (index 2, half day)');
    assert.equal(exDef.rows[3].id, '1', 'exceptions page 1 fourth row must be id 1');
    assert.equal(exDef.rows[3].estimatedAmount, 25, 'id 1 must be 25 (index 1, quarter day)');
    assert.equal(exDef.rows[4].id, '5', 'exceptions page 1 fifth row must be id 5 (Sara, same date, name after Ahmed)');
    assert.equal(exDef.rows[4].estimatedAmount, 25, 'id 5 must be 25 (Sara index 1)');
    assert.equal(exDef.rows[5].id, '339', 'exceptions filler run must start at id 339');
    assert.equal(exDef.rows[49].id, '295', 'exceptions default page must end at id 295');
    assert.equal(exDef.summary.totalItems, 245, 'exceptions summary totalItems must be 245');

    // 2. The old 100 cap is gone: pageSize=150 must return 150 rows.
    const ex150 = await listExceptions(hr, { pageSize: 150 }, AUTH_T1);
    assert.equal(ex150.rows.length, 150, 'exceptions pageSize=150 must return 150 rows');
    assert.equal(ex150.pagination.pageSize, 150, 'exceptions pageSize must stay 150');
    assert.equal(ex150.pagination.totalItems, 245, 'exceptions capped totalItems must count the full set');
    assert.equal(ex150.pagination.totalPages, 2, 'exceptions totalPages must be ceil(245 / 150)');
    assert.equal(ex150.rows[149].id, '195', 'exceptions page 1 of 150 must end at id 195');

    // 3. The 200 cap: pageSize=1000 returns 200 rows; page 2 holds the rest.
    const exCapped = await listExceptions(hr, { pageSize: 1000 }, AUTH_T1);
    assert.equal(exCapped.rows.length, 200, 'exceptions pageSize=1000 must return at most 200 rows');
    assert.equal(exCapped.pagination.pageSize, 200, 'exceptions pageSize must clamp to 200');
    const exPage2 = await listExceptions(hr, { page: 2, pageSize: 200 }, AUTH_T1);
    assert.equal(exPage2.rows.length, 45, 'exceptions page 2 of 200 must hold the remaining 45 rows');
    assert.equal(exPage2.rows[0].id, '144', 'exceptions page 2 must start at id 144');
    assert.equal(exPage2.rows[44].id, '100', 'exceptions page 2 must end at id 100');

    // 4. A page past the end clamps to the last page.
    const exClamped = await listExceptions(hr, { page: 99, pageSize: 50 }, AUTH_T1);
    assert.equal(exClamped.pagination.page, 5, 'exceptions page 99 must clamp to the last page 5');
    assert.equal(exClamped.rows.length, 45, 'exceptions clamped last page must hold 45 rows');
    assert.equal(exClamped.rows[0].id, '144', 'exceptions clamped last page must start at id 144');

    // 5. THE window pin: with status='pending' the 2026-11-12 incident keeps
    //    its TRUE index 3 (100) — the window is computed before the filter.
    //    A naive recompute-after-filter would report index 2 (50).
    const exPending = await listExceptions(hr, { status: 'pending' }, AUTH_T1);
    assert.equal(exPending.pagination.totalItems, 244, 'pending exceptions must be 244 (all but approved id 2)');
    assert.equal(exPending.rows[0].id, '4', 'pending page must start at id 4');
    assert.equal(exPending.rows[1].id, '3', 'pending page second row must be id 3');
    assert.equal(exPending.rows[1].estimatedAmount, 100, 'id 3 under a status filter must STILL be 100 (true index 3)');
    assert.equal(exPending.rows[2].id, '1', 'pending page third row must be id 1');
    assert.equal(exPending.rows[2].estimatedAmount, 25, 'id 1 must still be 25 (true index 1)');
    assert.equal(exPending.summary.totalItems, 244, 'pending summary totalItems must be 244');
    const exApproved = await listExceptions(hr, { status: 'approved' }, AUTH_T1);
    assert.equal(exApproved.pagination.totalItems, 1, 'approved exceptions must be 1');
    assert.equal(exApproved.rows[0].id, '2', 'approved row must be id 2');
    assert.equal(exApproved.rows[0].estimatedAmount, 50, 'approved id 2 must be 50 (index 2)');

    // 6. The status filter lowercases the QUERY only: 'PENDING' matches too.
    const exUpper = await listExceptions(hr, { status: 'PENDING' }, AUTH_T1);
    assert.equal(exUpper.pagination.totalItems, 244, 'status PENDING (upper) must match the same 244 rows');

    // 7. Search is a case-insensitive substring over employeeNo / employeeName / exceptionType.
    const exSara = await listExceptions(hr, { search: 'sara' }, AUTH_T1);
    assert.equal(exSara.pagination.totalItems, 1, 'search sara must find 1 row');
    assert.equal(exSara.rows[0].id, '5', 'search sara must find id 5');
    const exType = await listExceptions(hr, { search: 'late_check_out' }, AUTH_T1);
    assert.equal(exType.pagination.totalItems, 1, 'search late_check_out must find 1 row');
    assert.equal(exType.rows[0].id, '4', 'search late_check_out must find id 4');
    const exFiller = await listExceptions(hr, { search: 'e003' }, AUTH_T1);
    assert.equal(exFiller.pagination.totalItems, 240, 'search e003 must find the 240 filler rows');
    const exAhmed = await listExceptions(hr, { search: 'ahmed' }, AUTH_T1);
    assert.equal(exAhmed.pagination.totalItems, 5, 'search ahmed must find Ahmed Ali (4) + Sara Ahmed (1)');

    // 8. Date / month / employee / department filters.
    const exDate = await listExceptions(hr, { date: '2026-11-10' }, AUTH_T1);
    assert.equal(exDate.pagination.totalItems, 2, 'date 2026-11-10 must hold 2 rows');
    assert.deepEqual(exDate.rows.map((r) => r.id), ['1', '5'], 'date rows must be id 1 then id 5 (name order)');
    const exMonthEmpty = await listExceptions(hr, { month: '2026-10' }, AUTH_T1);
    assert.equal(exMonthEmpty.pagination.totalItems, 0, 'month 2026-10 must hold 0 rows');
    assert.equal(exMonthEmpty.pagination.totalPages, 1, 'empty month totalPages must be 1');
    assert.equal(exMonthEmpty.rows.length, 0, 'empty month rows must be []');
    const exMonth = await listExceptions(hr, { month: '2026-11' }, AUTH_T1);
    assert.equal(exMonth.pagination.totalItems, 245, 'month 2026-11 must hold all 245 rows');
    const exEmp = await listExceptions(hr, { employeeId: 2 }, AUTH_T1);
    assert.equal(exEmp.pagination.totalItems, 1, 'employeeId 2 must hold 1 row');
    assert.equal(exEmp.rows[0].id, '5', 'employeeId 2 row must be id 5');
    const exDept = await listExceptions(hr, { departmentId: 2 }, AUTH_T1);
    assert.equal(exDept.pagination.totalItems, 1, 'departmentId 2 must hold 1 row (Sara only)');
    const exDept1 = await listExceptions(hr, { departmentId: 1 }, AUTH_T1);
    assert.equal(exDept1.pagination.totalItems, 244, 'departmentId 1 must hold 244 rows');

    // 9. Catch path: corrupt payroll_policies JSON -> identical empty result.
    const exCatch = await listExceptions(hr, {}, AUTH_T2);
    assert.deepEqual(exCatch.rows, [], 'catch path rows must be []');
    assert.deepEqual(
      exCatch.pagination,
      { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 },
      'catch path pagination must be the empty page',
    );
    assert.deepEqual(exCatch.summary, { totalItems: 0 }, 'catch path summary must be { totalItems: 0 }');
    const exCatch150 = await listExceptions(hr, { pageSize: 150 }, AUTH_T2);
    assert.equal(exCatch150.pagination.pageSize, 150, 'catch path must use the new 200 cap too');

    // ---- listAttendance single-day path (tenant t3, 2026-11-24) ----
    // 12 named employees + 240 fillers = 252 rows. Expected summary:
    //   present 9, absent 1, late 0, leave 1, unmarked 240,
    //   workedMinutes 5310, payableMinutes 4470.
    await pg.exec(`
      INSERT INTO hr_employees (id, tenant_id, employee_no, display_name, department_id, job_title_id, compensation_type, hourly_rate, expected_daily_hours, delay_policy, attendance_policy, grace_minutes, status, scheduled_check_in_time, scheduled_check_out_time, overtime_policy) VALUES
        (101, 't3', 'E001', 'Adam Hourly', 3, NULL, 'hourly', 20, 8, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only'),
        (102, 't3', 'E002', 'Basma Hourly', 3, NULL, 'hourly', 20, NULL, 'inherit', 'strict', 0, 'active', '09:00', '17:00', 'review_only'),
        (103, 't3', 'E003', 'Celia Night', 3, NULL, 'hourly', 20, NULL, 'inherit', 'strict', 0, 'active', '22:00', '06:00', 'review_only'),
        (104, 't3', 'E004', 'Dalia Auto', 3, NULL, 'hourly', 20, 8, 'inherit', 'strict', 0, 'active', NULL, NULL, 'auto_approved'),
        (105, 't3', 'E005', 'Eman Disabled', 3, NULL, 'hourly', 20, 8, 'inherit', 'strict', 0, 'active', NULL, NULL, 'disabled'),
        (106, 't3', 'E006', 'Farid Monthly', 3, NULL, 'monthly', 0, 8, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only'),
        (107, 't3', 'E007', 'Ghada Absent', 4, NULL, 'hourly', 20, 8, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only'),
        (108, 't3', 'E008', 'Hatem Leave', 4, NULL, 'hourly', 20, 8, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only'),
        (109, 't3', 'E009', 'Ibrahim Half', 3, NULL, 'hourly', 20, 8, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only'),
        (110, 't3', 'E010', 'Jana Garbage', 3, NULL, 'hourly', 20, NULL, 'inherit', 'strict', 0, 'active', 'xx', 'yy', 'review_only'),
        (111, 't3', 'E011', 'Karim Equal', 3, 1, 'hourly', 20, NULL, 'inherit', 'strict', 0, 'active', '08:00', '08:00', 'review_only'),
        (112, 't3', 'E012', 'Laila NoTimes', 3, NULL, 'hourly', 20, NULL, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only');
      INSERT INTO hr_employees (id, tenant_id, employee_no, display_name, department_id, job_title_id, compensation_type, hourly_rate, expected_daily_hours, delay_policy, attendance_policy, grace_minutes, status, scheduled_check_in_time, scheduled_check_out_time, overtime_policy)
        SELECT gs, 't3', 'E' || lpad((gs - 100)::text, 3, '0'), 'Filler ' || lpad((gs - 100)::text, 3, '0'), 3, NULL, 'monthly', 0, NULL, 'inherit', 'strict', 0, 'active', NULL, NULL, 'review_only' FROM generate_series(113, 352) AS gs;
      INSERT INTO hr_attendance_records (id, tenant_id, account_id, employee_id, work_date, status, check_in_at, check_out_at, source, notes, prior_sessions_minutes) VALUES
        (1, 't3', 'a1', 101, '2026-11-24', 'present', '2026-11-24 08:00:00+00', '2026-11-24 17:00:00+00', 'manual', '', NULL),
        (2, 't3', 'a1', 102, '2026-11-24', 'present', '2026-11-24 09:00:00+00', '2026-11-24 18:30:00+00', 'manual', '', NULL),
        (3, 't3', 'a1', 103, '2026-11-24', 'present', '2026-11-24 22:00:00+00', '2026-11-25 06:00:00+00', 'manual', '', NULL),
        (4, 't3', 'a1', 104, '2026-11-24', 'present', '2026-11-24 08:00:00+00', '2026-11-24 18:00:00+00', 'manual', '', NULL),
        (5, 't3', 'a1', 105, '2026-11-24', 'present', '2026-11-24 08:00:00+00', '2026-11-24 18:00:00+00', 'manual', '', NULL),
        (6, 't3', 'a1', 106, '2026-11-24', 'present', '2026-11-24 08:00:00+00', '2026-11-24 17:00:00+00', 'manual', '', NULL),
        (7, 't3', 'a1', 107, '2026-11-24', 'absent', '2026-11-24 08:00:00+00', '2026-11-24 17:00:00+00', 'manual', '', NULL),
        (8, 't3', 'a1', 108, '2026-11-24', 'leave', '2026-11-24 08:00:00+00', '2026-11-24 12:00:00+00', 'manual', '', NULL),
        (9, 't3', 'a1', 109, '2026-11-24', 'half_day', '2026-11-24 08:00:00+00', '2026-11-24 12:00:00+00', 'manual', '', NULL),
        (10, 't3', 'a1', 110, '2026-11-24', 'present', '2026-11-24 08:00:00+00', '2026-11-24 16:00:00+00', 'manual', '', NULL),
        (11, 't3', 'a1', 111, '2026-11-24', 'present', '2026-11-24 08:00:00+00', '2026-11-24 20:00:00+00', 'manual', '', NULL),
        (12, 't3', 'a1', 112, '2026-11-24', 'present', '2026-11-24 08:00:00+00', '2026-11-24 17:00:00+00', 'manual', '', NULL);
      INSERT INTO hr_attendance_exceptions (id, tenant_id, account_id, employee_id, attendance_record_id, work_date, exception_type, scheduled_time, actual_time, duration_minutes, status, approved_duration_minutes, note) VALUES
        (401, 't3', 'a1', 102, NULL, '2026-11-24', 'late_check_out', NULL, NULL, 30, 'approved', 30, ''),
        (402, 't3', 'a1', 104, NULL, '2026-11-24', 'late_check_out', NULL, NULL, 60, 'pending', NULL, '');
    `);
    const DAY = { date: '2026-11-24' };

    // 10. Default page is 50 rows, name order, summary exact over 252 rows.
    const atDef = await listAttendance(hr, { ...DAY }, AUTH_T3);
    assert.equal(atDef.rows.length, 50, 'attendance default page must be 50 rows');
    assert.equal(atDef.pagination.page, 1, 'attendance default page must be 1');
    assert.equal(atDef.pagination.totalItems, 252, 'attendance totalItems must be 252');
    assert.equal(atDef.pagination.totalPages, 6, 'attendance totalPages must be ceil(252 / 50)');
    assert.equal(atDef.rows[0].employeeName, 'Adam Hourly', 'attendance page 1 must start at Adam Hourly');
    assert.equal(atDef.rows[5].employeeName, 'Farid Monthly', 'attendance row 6 must be Farid Monthly');
    assert.equal(atDef.rows[6].employeeName, 'Filler 013', 'attendance filler run must start at Filler 013');
    assert.equal(atDef.rows[49].employeeName, 'Filler 056', 'attendance default page must end at Filler 056');
    assert.equal(atDef.workDate, '2026-11-24', 'attendance workDate must echo the requested date');
    assert.equal(atDef.serverTimezone, 'UTC', 'attendance serverTimezone must be UTC');
    assert.equal(atDef.summary.totalItems, 252, 'attendance summary totalItems must be 252');
    assert.equal(atDef.summary.presentCount, 9, 'attendance presentCount must be 9');
    assert.equal(atDef.summary.absentCount, 1, 'attendance absentCount must be 1');
    assert.equal(atDef.summary.lateCount, 0, 'attendance lateCount must be 0');
    assert.equal(atDef.summary.leaveCount, 1, 'attendance leaveCount must be 1');
    assert.equal(atDef.summary.unmarkedCount, 240, 'attendance unmarkedCount must be 240');
    assert.equal(atDef.summary.workedMinutes, 5310, 'attendance workedMinutes must be 5310 over the full set');
    assert.equal(atDef.summary.payableMinutes, 4470, 'attendance payableMinutes must be 4470 over the full set');

    // 11. The old 100 cap is gone: pageSize=150 must return 150 rows.
    const at150 = await listAttendance(hr, { ...DAY, pageSize: 150 }, AUTH_T3);
    assert.equal(at150.rows.length, 150, 'attendance pageSize=150 must return 150 rows');
    assert.equal(at150.pagination.pageSize, 150, 'attendance pageSize must stay 150');
    assert.equal(at150.pagination.totalItems, 252, 'attendance capped totalItems must count the full set');
    assert.equal(at150.pagination.totalPages, 2, 'attendance totalPages must be ceil(252 / 150)');
    assert.equal(at150.rows[149].employeeName, 'Filler 156', 'attendance page 1 of 150 must end at Filler 156');

    // 12. The 200 cap + page-2 summary still exact (never page-scoped).
    const atCapped = await listAttendance(hr, { ...DAY, pageSize: 1000 }, AUTH_T3);
    assert.equal(atCapped.rows.length, 200, 'attendance pageSize=1000 must return at most 200 rows');
    assert.equal(atCapped.pagination.pageSize, 200, 'attendance pageSize must clamp to 200');
    const atPage2 = await listAttendance(hr, { ...DAY, page: 2, pageSize: 200 }, AUTH_T3);
    assert.equal(atPage2.rows.length, 52, 'attendance page 2 of 200 must hold the remaining 52 rows');
    assert.equal(atPage2.rows[0].employeeName, 'Filler 207', 'attendance page 2 must start at Filler 207');
    assert.equal(atPage2.rows[51].employeeName, 'Laila NoTimes', 'attendance page 2 must end at Laila NoTimes');
    assert.equal(atPage2.summary.workedMinutes, 5310, 'page-2 workedMinutes must still be the FULL-set 5310');
    assert.equal(atPage2.summary.payableMinutes, 4470, 'page-2 payableMinutes must still be the FULL-set 4470');
    assert.equal(atPage2.summary.totalItems, 252, 'page-2 totalItems must still be 252');

    // 13. A page past the end clamps to the last page.
    const atClamped = await listAttendance(hr, { ...DAY, page: 99, pageSize: 50 }, AUTH_T3);
    assert.equal(atClamped.pagination.page, 6, 'attendance page 99 must clamp to the last page 6');
    assert.equal(atClamped.rows.length, 2, 'attendance clamped last page must hold 2 rows');
    assert.equal(atClamped.rows[0].employeeName, 'Karim Equal', 'attendance clamped page must start at Karim Equal');
    assert.equal(atClamped.rows[1].employeeName, 'Laila NoTimes', 'attendance clamped page must end at Laila NoTimes');

    // 14. Row-level pins: overtime minutes, punch times, unmarked shape.
    const basma = await listAttendance(hr, { ...DAY, employeeId: 102 }, AUTH_T3);
    assert.equal(basma.rows.length, 1, 'Basma filter must return 1 row');
    assert.equal(basma.rows[0].approvedOvertimeMinutes, 30, 'Basma approvedOvertimeMinutes must be 30');
    assert.equal(basma.rows[0].pendingOvertimeMinutes, 0, 'Basma pendingOvertimeMinutes must be 0');
    assert.equal(basma.rows[0].checkInAt, '2026-11-24T09:00:00', 'Basma checkInAt must render in tenant time');
    assert.equal(basma.rows[0].checkOutAt, '2026-11-24T18:30:00', 'Basma checkOutAt must render in tenant time');
    const dalia = await listAttendance(hr, { ...DAY, employeeId: 104 }, AUTH_T3);
    assert.equal(dalia.rows[0].pendingOvertimeMinutes, 60, 'Dalia pendingOvertimeMinutes must be 60');
    assert.equal(dalia.rows[0].approvedOvertimeMinutes, 0, 'Dalia approvedOvertimeMinutes must be 0');
    const celia = await listAttendance(hr, { ...DAY, employeeId: 103 }, AUTH_T3);
    assert.equal(celia.rows[0].checkOutAt, '2026-11-25T06:00:00', 'Celia overnight checkOutAt must be next-day 06:00');
    const ibrahim = await listAttendance(hr, { ...DAY, employeeId: 109 }, AUTH_T3);
    assert.equal(ibrahim.rows[0].status, 'half_day', 'Ibrahim status must stay half_day');
    const filler = await listAttendance(hr, { ...DAY, employeeId: 113 }, AUTH_T3);
    assert.equal(filler.rows[0].status, '', 'unmarked filler status must be empty string');
    assert.equal(filler.rows[0].id, '', 'unmarked filler id must be empty string');
    assert.equal(filler.rows[0].checkInAt, '', 'unmarked filler checkInAt must be empty string');

    // 15. Search over employeeNo / employeeName / departmentName / jobTitleName.
    const atAdam = await listAttendance(hr, { ...DAY, search: 'adam' }, AUTH_T3);
    assert.equal(atAdam.pagination.totalItems, 1, 'search adam must find 1 row');
    const atCashier = await listAttendance(hr, { ...DAY, search: 'cashier' }, AUTH_T3);
    assert.equal(atCashier.pagination.totalItems, 1, 'search cashier must find Karim only');
    assert.equal(atCashier.rows[0].employeeName, 'Karim Equal', 'search cashier must find Karim Equal');
    const atWarehouse = await listAttendance(hr, { ...DAY, search: 'warehouse' }, AUTH_T3);
    assert.equal(atWarehouse.pagination.totalItems, 2, 'search warehouse must find Ghada + Hatem');
    const atFiller0 = await listAttendance(hr, { ...DAY, search: 'filler 0' }, AUTH_T3);
    assert.equal(atFiller0.pagination.totalItems, 87, 'search filler 0 must find fillers 013-099');
    assert.equal(atFiller0.summary.workedMinutes, 0, 'filler-only search workedMinutes must be 0');
    assert.equal(atFiller0.summary.unmarkedCount, 87, 'filler-only search unmarkedCount must be 87');

    // 16. Employee / department filters.
    const atEmp = await listAttendance(hr, { ...DAY, employeeId: 101 }, AUTH_T3);
    assert.equal(atEmp.pagination.totalItems, 1, 'employeeId 101 must hold 1 row');
    const atDept = await listAttendance(hr, { ...DAY, departmentId: 4 }, AUTH_T3);
    assert.equal(atDept.pagination.totalItems, 2, 'departmentId 4 (Warehouse) must hold 2 rows');

    // 17. Range path smoke (already bounded, untouched): same totals.
    const atRange = await listAttendance(hr, { from: '2026-11-24', to: '2026-11-25' }, AUTH_T3);
    assert.equal(atRange.rows.length, 12, 'range path must return the 12 employees with records');
    assert.equal(atRange.pagination.totalItems, 12, 'range totalItems must be 12');
    assert.equal(atRange.rows[0].employeeName, 'Adam Hourly', 'range rows must start at Adam Hourly');
    assert.equal(atRange.rows[11].employeeName, 'Laila NoTimes', 'range rows must end at Laila NoTimes');
    assert.equal(atRange.summary.workedMinutes, 5310, 'range workedMinutes must be 5310');
    // Range payable is 4230, NOT the single-day 4470: the range path's
    // own (pre-existing, untouched) approximation uses
    // COALESCE(expected_daily_hours * 60, 480) with NO scheduled-times
    // fallback, so Karim (scheduled 08:00-08:00 -> 1440 expected in the
    // single-day engine, payable 720) is capped at 480 there — a 240
    // difference that predates this package and is out of its scope.
    assert.equal(atRange.summary.payableMinutes, 4230, 'range payableMinutes must be 4230 (range approximation, Karim capped at 480)');
    assert.equal(atRange.summary.presentCount, 9, 'range presentCount must be 9');
    assert.equal(atRange.summary.absentCount, 1, 'range absentCount must be 1');
    assert.equal(atRange.from, '2026-11-24', 'range from must echo');
    assert.equal(atRange.to, '2026-11-25', 'range to must echo');

    console.log('HR attendance SQL pagination tests passed.');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
