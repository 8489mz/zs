/*
 * Split shifts accumulate (D2): starting a new session on a completed day
 * stores the earlier session's minutes on the day row
 * (prior_sessions_minutes, migration 0293) instead of losing them, and
 * hourly pay reads the summed minutes. INV-SPLIT-SHIFT-DAY-SUM.
 *
 * Bar: 08:00-12:00 + 13:00-17:00 at 50/hr -> 480 min / 400 (stored
 * prior_sessions_minutes 240); a third 18:00-19:00 session -> 540 min /
 * 450 (stored prior 480). The earlier session still survives as a note.
 * Run: npx ts-node test/critical/split-shift-day-sum.spec.ts (from backend/).
 */

import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { HrService } from '../../src/modules/hr/hr.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { summarizeHourlyAttendance } from '../../src/modules/hr/engines/hourly-attendance-pay.engine';

const AUTH = { tenantId: 't1', accountId: 'a1', userId: 1, username: 'tester', role: 'admin', permissions: [] } as never;
const AUDIT_STUB = { log: async () => ({}) } as never;
const FOUNDATION_STUB = { ensureForAuth: async () => undefined, ensureForScope: async () => undefined } as never;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms)),
  ]);
}

async function main(): Promise<void> {
  const pg = new PGlite();
  const db: Kysely<any> = new Kysely({ dialect: new PGliteDialect(pg) });
  try {
    const statements = [
      `CREATE TABLE settings (tenant_id text NOT NULL, key text NOT NULL, value text NOT NULL, PRIMARY KEY (tenant_id, key))`,
      `CREATE TABLE hr_hr_settings (tenant_id text NOT NULL, account_id text NOT NULL, key text NOT NULL, value text NOT NULL, updated_by integer, updated_at timestamptz DEFAULT now(), PRIMARY KEY (tenant_id, key))`,
      `CREATE TABLE hr_departments (id bigint PRIMARY KEY, tenant_id text NOT NULL, name text)`,
      `CREATE TABLE hr_job_titles (id bigint PRIMARY KEY, tenant_id text NOT NULL, name text)`,
      `CREATE TABLE hr_positions (id bigint PRIMARY KEY, tenant_id text NOT NULL, name text)`,
      `CREATE TABLE hr_employees (id integer PRIMARY KEY, tenant_id text NOT NULL, account_id text, status text, display_name text, scheduled_check_in_time text, scheduled_check_out_time text, grace_minutes integer, attendance_policy text, expected_daily_hours numeric, compensation_type text, hourly_rate numeric, delay_policy text, department_id integer, job_title_id integer, position_id integer, branch_id integer, location_id integer, user_id integer, hire_date date, employee_no text, overtime_policy text)`,
      `CREATE TABLE hr_attendance_records (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text, employee_id integer NOT NULL, work_date date NOT NULL, status text NOT NULL, check_in_at timestamptz, check_out_at timestamptz, source text, notes text, prior_sessions_minutes integer NOT NULL DEFAULT 0, created_by integer, updated_by integer, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (tenant_id, employee_id, work_date))`,
      `CREATE TABLE hr_attendance_exceptions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text, employee_id integer NOT NULL, work_date date NOT NULL, exception_type text NOT NULL, duration_minutes integer, status text, approved_duration_minutes integer, note text, scheduled_time text, actual_time text, attendance_record_id integer, created_by integer, updated_by integer, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`,
      `CREATE TABLE hr_holidays (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text, name text, start_date date, end_date date, created_by integer, updated_by integer, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`,
      `CREATE TABLE hr_payroll_runs (id integer PRIMARY KEY, tenant_id text NOT NULL, status text NOT NULL, period_month text, period_from date, period_to date, start_date date, end_date date)`,
      `CREATE TABLE hr_payroll_run_items (id integer PRIMARY KEY, tenant_id text NOT NULL, run_id integer NOT NULL, employee_id integer NOT NULL, status text NOT NULL)`,
      `INSERT INTO settings (tenant_id, key, value) VALUES ('t1', 'currency', 'KWD')`,
      `INSERT INTO hr_employees (id, tenant_id, account_id, status, display_name, scheduled_check_in_time, scheduled_check_out_time, grace_minutes, attendance_policy, expected_daily_hours, compensation_type, hourly_rate, delay_policy) VALUES (1, 't1', 'a1', 'active', 'Ahmed', '08:00', '16:00', 15, 'standard', 8, 'hourly', 50, 'standard')`,
    ];
    for (const statement of statements) {
      await sql.raw(statement).execute(db);
    }
    const posting = new AccountingPostingService(FOUNDATION_STUB as never);
    const service = new HrService(db, new TransactionHelper(), AUDIT_STUB, {} as never, posting, undefined);

    const upsert = (payload: Record<string, unknown>, label: string) =>
      withTimeout(service.upsertAttendanceRecord(payload as never, AUTH), 25000, label);

    await upsert({
      employeeId: 1, workDate: '2026-03-02', status: 'present',
      checkInAt: '2026-03-02T08:00:00.000Z', checkOutAt: '2026-03-02T12:00:00.000Z', source: 'manual',
    }, 'session 1');
    await upsert({
      employeeId: 1, workDate: '2026-03-02', status: 'present',
      checkInAt: '2026-03-02T13:00:00.000Z', mode: 'new_session', source: 'manual',
    }, 'session 2 check-in');
    await upsert({
      employeeId: 1, workDate: '2026-03-02', status: 'present',
      checkOutAt: '2026-03-02T17:00:00.000Z', source: 'manual',
    }, 'session 2 check-out');

    const readRow = async () => db.selectFrom('hr_attendance_records').selectAll().executeTakeFirstOrThrow() as unknown as Record<string, unknown>;
    let row = await readRow();
    assert.equal(Number(row.prior_sessions_minutes), 240, 'stored prior minutes after session 2');
    assert.match(String(row.notes || ''), /وردية سابقة/, 'earlier session still recorded as a note');
    let summary = summarizeHourlyAttendance([row as never], 50, 2);
    assert.equal(summary.workedMinutes, 480, 'two sessions sum to 480 min');
    assert.equal(summary.baseWage, 400, 'two sessions pay 400 at 50/hr');

    // A third session accumulates again: 480 prior + 60 current.
    await upsert({
      employeeId: 1, workDate: '2026-03-02', status: 'present',
      checkInAt: '2026-03-02T18:00:00.000Z', mode: 'new_session', source: 'manual',
    }, 'session 3 check-in');
    await upsert({
      employeeId: 1, workDate: '2026-03-02', status: 'present',
      checkOutAt: '2026-03-02T19:00:00.000Z', source: 'manual',
    }, 'session 3 check-out');
    row = await readRow();
    assert.equal(Number(row.prior_sessions_minutes), 480, 'stored prior minutes after session 3');
    summary = summarizeHourlyAttendance([row as never], 50, 2);
    assert.equal(summary.workedMinutes, 540, 'three sessions sum to 540 min');
    assert.equal(summary.baseWage, 450, 'three sessions pay 450 at 50/hr');

    console.log('split-shift-day-sum.spec: ok (480 min / 400, then 540 min / 450; prior minutes stored)');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => process.exit(0),
  (error) => { console.error(error); process.exit(1); },
);
