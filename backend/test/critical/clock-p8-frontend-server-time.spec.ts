/*
 * Clock P8 — frontend "now" buttons + JE/PDC defaults from server time (RC-7).
 *
 * THE DEFECT: the defaults that become posted business dates were built
 * from the CLIENT clock. ManualJournalEntryDialog and PdcChequeActionModal
 * defaulted entry/action dates from `new Date().toISOString().slice(0, 10)`
 * — a UTC slice, so for the first two hours after midnight in the
 * tenant's zone (UTC+2) the default was yesterday. The HR "now" buttons
 * filled check-in/check-out times from the client clock's HH:mm, and the
 * attendance + payroll pages defaulted their day/month from the client
 * clock. A device clock set hours (or a month) off moved posted dates.
 *
 * THE FIX: the list response each page already fetches carries the server
 * clock — `serverTime` (ISO instant) + `serverTimezone` (the tenant zone)
 * — exactly as the HR attendance list already did (hr.service.ts:4937,
 * :5056, the quick-shortcut reference pattern). The three lists that did
 * not carry it gain it: listJournalEntries, listCheques, listPayrollRuns.
 * The frontend defaults derive from that server instant in the tenant
 * zone (shared useServerClock hook: server anchor + performance.now()
 * elapsed, never the client clock). The date inputs stay user-editable;
 * only the DEFAULT changes. No new endpoint: every page in scope already
 * runs the list query that now carries the clock.
 *
 * WHAT THIS PINS, driving the REAL code (no duplicated formula):
 * - §A the real AccountingService.listJournalEntries on PGlite (Kuwait
 *   tenant): the response carries serverTime (a fresh ISO instant) and
 *   serverTimezone === 'Asia/Kuwait'.
 * - §B the real PdcChequesService.listCheques on PGlite: same two fields.
 * - §C the real HrService.listPayrollRuns on PGlite: same two fields.
 * - §E source pins: the frontend defaults really derive from the server
 *   clock — the components call serverClock.todayKey()/timeHHmm() and the
 *   pages pass the list response's serverTime/serverTimezone into them.
 *   (The behaviour itself is pinned by the frontend render spec
 *   use-server-clock.spec.tsx: a client clock faked hours off must not
 *   move any default.)
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { AccountingService } from '../../src/modules/accounting/accounting.service';
import { PdcChequesService } from '../../src/modules/accounting/services/pdc-cheques.service';
import { HrService } from '../../src/modules/hr/hr.service';

const AUTH = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: ['accounting', 'hrAttendance', 'hrPayrollView'],
} as unknown as AuthContext;

function makeDb(pg: PGlite) {
  return new Kysely<Database>({ dialect: new PGliteDialect(pg) });
}

function assertServerClock(res: Record<string, unknown>, label: string) {
  assert.equal(typeof res.serverTime, 'string', `${label}: serverTime must be present`);
  const instant = new Date(String(res.serverTime));
  assert.ok(!Number.isNaN(instant.getTime()), `${label}: serverTime must parse as an instant`);
  assert.ok(
    Math.abs(Date.now() - instant.getTime()) < 120_000,
    `${label}: serverTime must be fresh (within 120s of now)`,
  );
  assert.equal(res.serverTimezone, 'Asia/Kuwait', `${label}: serverTimezone must be the tenant zone`);
}

async function main() {
  // ── §A. JE list carries the server clock ──────────────────────────────────
  {
    const pg = new PGlite();
    const db = makeDb(pg);
    const foundation = {
      ensureForAuth: async () => {},
      ensureForScope: async () => {},
    } as unknown as AccountingTenantFoundationService;
    const posting = new AccountingPostingService(foundation);
    const service = new AccountingService(db, foundation, posting);
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
        INSERT INTO settings VALUES ('t1', 'currency', 'EGP'), ('t1', 'timezone', 'Asia/Kuwait');
        CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
        INSERT INTO currency_exchange_rates VALUES ('t1', 'EGP', true, 1);
        CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text);
        INSERT INTO users VALUES (1, 't1', 'admin');
        CREATE TABLE journal_entries (id bigint PRIMARY KEY, tenant_id text, entry_no text, entry_date date, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, cancelled_at timestamptz, created_at timestamptz);
        INSERT INTO journal_entries VALUES (1, 't1', 'JE-00000001', '2026-11-15', 'manual', 'manual', NULL, 'posted', NULL, NULL, 1, 1, NOW(), NULL, NOW());
      `);
      const res = await service.listJournalEntries({}, AUTH);
      assertServerClock(res, 'listJournalEntries');
      assert.equal((res.entries as unknown[]).length, 1, 'the seeded entry must list');
      console.log('§A listJournalEntries: ok');
    } finally {
      await db.destroy();
    }
  }

  // ── §B. PDC list carries the server clock ────────────────────────────────
  {
    const pg = new PGlite();
    const db = makeDb(pg);
    const service = new PdcChequesService(db, {} as never);
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
        INSERT INTO settings VALUES ('t1', 'currency', 'EGP'), ('t1', 'timezone', 'Asia/Kuwait');
        CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
        INSERT INTO currency_exchange_rates VALUES ('t1', 'EGP', true, 1);
        CREATE TABLE accounting_cheques (id bigint PRIMARY KEY, tenant_id text, account_id bigint, type text, cheque_number text, bank_name text, branch_name text, drawer_name text, partner_type text, partner_id bigint, partner_name text, amount numeric, currency text, issue_date date, due_date date, status text, deposit_bank_id bigint, deposit_date date, cleared_date date, bounced_date date, bounced_reason text, bounced_fee numeric, flagged_rate_variance boolean, registered_exchange_rate numeric, endorsed_to_supplier_id bigint, endorsed_to_supplier_name text, journal_entry_id bigint, notes text, created_by bigint, created_at timestamptz, updated_at timestamptz);
        INSERT INTO accounting_cheques (id, tenant_id, type, cheque_number, bank_name, partner_name, amount, currency, issue_date, due_date, status, created_at, updated_at) VALUES (1, 't1', 'receivable', 'CHQ-1', 'Bank', 'Customer', 1000, 'EGP', '2026-11-01', '2026-12-01', 'pending', NOW(), NOW());
      `);
      const res = await service.listCheques(AUTH, {});
      assertServerClock(res as unknown as Record<string, unknown>, 'listCheques');
      assert.equal(res.data.length, 1, 'the seeded cheque must list');
      console.log('§B listCheques: ok');
    } finally {
      await db.destroy();
    }
  }

  // ── §C. Payroll runs list carries the server clock ───────────────────────
  {
    const pg = new PGlite();
    const db = makeDb(pg);
    const auditStub = { log: async () => ({}) } as never;
    const service = new HrService(db, new TransactionHelper(), auditStub, {} as never, {} as never, undefined);
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
        INSERT INTO settings VALUES ('t1', 'currency', 'EGP'), ('t1', 'timezone', 'Asia/Kuwait');
        CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, period_month text, start_date date, end_date date, pay_frequency text, status text, notes text, created_by bigint, reviewed_by bigint, approved_by bigint, created_at timestamptz, reviewed_at timestamptz, approved_at timestamptz, updated_at timestamptz);
        CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, run_id bigint, employee_id bigint, status text, base_salary numeric, allowance_amount numeric, deduction_amount numeric, loan_deduction_amount numeric, asset_recovery_deduction_amount numeric, employee_social_insurance numeric, employer_social_insurance numeric, income_tax numeric, penalty_deduction numeric, carried_forward_deduction numeric, gross_pay numeric, net_pay numeric);
        INSERT INTO hr_payroll_runs VALUES (1, 't1', '2026-11', '2026-11-01', '2026-11-30', 'monthly', 'draft', '', NULL, NULL, NULL, NOW(), NULL, NULL, NOW());
        INSERT INTO hr_payroll_run_items (id, tenant_id, run_id, employee_id, status) VALUES (1, 't1', 1, 1, 'draft');
      `);
      const res = await service.listPayrollRuns({}, AUTH);
      assertServerClock(res, 'listPayrollRuns');
      assert.equal((res.runs as unknown[]).length, 1, 'the seeded run must list');
      console.log('§C listPayrollRuns: ok');
    } finally {
      await db.destroy();
    }
  }

  // ── §D. Attendance list (day branch) still carries the server clock ─────
  {
    const pg = new PGlite();
    const db = makeDb(pg);
    const auditStub = { log: async () => ({}) } as never;
    const service = new HrService(db, new TransactionHelper(), auditStub, {} as never, {} as never, undefined);
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
        INSERT INTO settings VALUES ('t1','currency','EGP'), ('t1','timezone','Asia/Kuwait');
        CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, account_id text, display_name text, employee_no text, status text, compensation_type text, hourly_rate numeric, expected_daily_hours numeric, scheduled_check_in_time text, scheduled_check_out_time text, grace_minutes numeric, attendance_policy text, overtime_policy text, department_id bigint, job_title_id bigint);
        INSERT INTO hr_employees VALUES (1,'t1','a1','Emp One','E1','active','monthly',0,8,'09:00','17:00',15,NULL,'review_only',NULL,NULL);
        CREATE TABLE hr_attendance_records (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, work_date date, status text, check_in_at timestamptz, check_out_at timestamptz, source text, notes text, prior_sessions_minutes integer NOT NULL DEFAULT 0, created_by bigint, updated_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW(), UNIQUE (tenant_id, employee_id, work_date));
        CREATE TABLE hr_attendance_exceptions (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, employee_id bigint, attendance_record_id bigint, work_date date, exception_type text, scheduled_time text, actual_time text, duration_minutes numeric, status text, approved_duration_minutes numeric, note text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
        CREATE TABLE hr_departments (id bigint PRIMARY KEY, tenant_id text, name text);
        CREATE TABLE hr_job_titles (id bigint PRIMARY KEY, tenant_id text, name text);
      `);
      const res = await service.listAttendance({ date: '2026-11-15' }, AUTH);
      assertServerClock(res, 'listAttendance');
      assert.equal(res.workDate, '2026-11-15', 'the requested work date must echo back');
      console.log('§D listAttendance: ok');
    } finally {
      await db.destroy();
    }
  }

  // §E — source pins: the frontend defaults really derive from the server
  // clock. (Behaviour is pinned by the frontend render spec
  // use-server-clock.spec.tsx: a client clock faked hours off must not
  // move any default.) These pins only assert the wiring strings exist;
  // the serverTime values themselves are proved in §A–§D above.
  {
    const feRoot = resolve(__dirname, '../../../frontend/src');
    const read = (rel: string) => readFileSync(join(feRoot, rel), 'utf8');

    const table = read('features/hr/components/attendance/DailyAttendanceTable.tsx');
    assert.ok(
      table.includes('serverClock.timeHHmm()'),
      'DailyAttendanceTable: the "now" button must fill the server time',
    );
    assert.ok(table.includes('serverTime?: string'), 'DailyAttendanceTable: the serverTime prop must exist');

    const manual = read('features/hr/components/attendance/ManualAttendanceModal.tsx');
    assert.ok(
      manual.includes('serverClock.timeHHmm()'),
      'ManualAttendanceModal: the "current time" button must fill the server time',
    );

    const je = read('features/accounting/components/ManualJournalEntryDialog.tsx');
    assert.ok(
      je.includes('serverClock.todayKey()'),
      'ManualJournalEntryDialog: the entry date must default from the server day',
    );

    const pdc = read('features/accounting/components/PdcChequeActionModal.tsx');
    assert.ok(
      pdc.includes('serverClock.todayKey()'),
      'PdcChequeActionModal: the action date must default from the server day',
    );

    const payroll = read('features/hr/components/payroll/CreatePayrollRunModal.tsx');
    assert.ok(
      payroll.includes('serverClock.todayKey()'),
      'CreatePayrollRunModal: the daily presets must default from the server day',
    );

    const attPage = read('features/hr/pages/HrAttendancePage.tsx');
    assert.ok(
      attPage.includes('serverTime={attendance.data?.serverTime}'),
      'HrAttendancePage: the table/modal must receive the list serverTime',
    );
    assert.ok(
      attPage.includes('calculatePeriodRange(mode, date, serverToday)'),
      'HrAttendancePage: period ranges must be bounded by the server day',
    );

    const payPage = read('features/hr/pages/HrPayrollPage.tsx');
    const payCreateModal = read('features/hr/pages/hr-payroll-page/hr-payroll-create-run-modal.tsx');
    assert.ok(
      payCreateModal.includes('serverTime={workspace.payrollRuns.data?.serverTime}'),
      'HrPayrollPage: the create modal must receive the list serverTime',
    );
    assert.ok(payPage.includes('serverMonth'), 'HrPayrollPage: the month filter must adopt the server month');

    const jePage = read('features/accounting/pages/AccountingJournalEntriesPage.tsx');
    assert.ok(
      jePage.includes('serverTime={query.data?.serverTime}'),
      'AccountingJournalEntriesPage: the JE dialog must receive the list serverTime',
    );

    const pdcPage = read('features/accounting/pages/PdcChequesPage.tsx');
    assert.ok(
      pdcPage.includes('serverTime={chequesQuery.data?.serverTime}'),
      'PdcChequesPage: the action modal must receive the list serverTime',
    );

    console.log('§E frontend wiring source pins: ok');
  }

  console.log('clock-p8-frontend-server-time.spec: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
