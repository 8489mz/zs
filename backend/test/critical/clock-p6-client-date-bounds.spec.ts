/*
 * Clock P6 — trusted client dates, boundary validation (RC-5).
 *
 * THE DEFECT: six channels accepted client-supplied business dates with
 * parse-only (or no) validation and stored them verbatim — an expense
 * dated 2020, a manual attendance day in 2030, a receipt dated last
 * year, a sales order with a garbage delivery date, an installment plan
 * starting on an unparseable date, a collection promise of "tomorrow"
 * written as a free string. The journal-core closed-period re-check
 * stops backdating into CLOSED periods only; inside OPEN periods any
 * past/future date posted.
 *
 * THE FIX: one shared pure helper (client-date-bounds.util.ts) validates
 * every client-supplied business date against the TENANT day before it
 * is stored or posted. Past-by-nature dates (expense, receipt, plan
 * start) live in [today-7d, today] — the P2 offline window, in whole
 * tenant days. HR manual attendance stays possible but bounded to the
 * open payroll month [first of month, today]. Future-by-nature dates
 * (delivery, reservation expiry, promise, follow-up) live in [today,
 * today+365d]. An installment's first due date lives in [startDate,
 * startDate+5y]. AR date fields are @IsDateString() at the boundary
 * too. The sales-order DTO stays a plain interface: converting it to a
 * decorated class would need EVERY field decorated (the global pipe is
 * whitelist + forbidNonWhitelisted), which is a separate package.
 *
 * WHAT THIS PINS, driving the REAL code (no duplicated formula):
 * - §0 the pure helper: day-key derivation in the tenant zone, window
 *   edges (exactly today-7 ok / today-8 too old), the month first day,
 *   the anchored first-due window.
 * - §A the real TreasuryService.createExpense on PGlite (Kuwait
 *   tenant): in-window posts, 30-days-old and tomorrow reject with
 *   EXPENSE_DATE_OUT_OF_RANGE, garbage still rejects INVALID_EXPENSE_DATE.
 * - §B the real resolveAttendancePunch (pure engine) + the real
 *   HrService.bulkSaveAttendance / bulkImportAttendanceRecords on
 *   PGlite: manual days inside the open payroll month pass, last
 *   month and tomorrow reject/skip; the server-anchored punch still
 *   ignores any client workDate.
 * - §C the real GoodsReceiptService.createGoodsReceipt on PGlite.
 * - §D the real SalesOrdersService.createOrder on PGlite (draft).
 * - §E the real CustomerInstallmentsService.createPlan on PGlite.
 * - §F the real ArCollectionsService.logInteraction /
 *   recordPromiseToPay on PGlite, plus the DTO @IsDateString() pin.
 *
 * Dates are computed relative to the REAL tenant today (never fixed
 * literals): the window is relative, so the spec stays green on any
 * run date. The pure-helper section uses a frozen `now` instead.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuditService } from '../../src/core/audit/audit.service';
import { AccountingPostingService } from '../../src/modules/accounting/accounting-posting.service';
import { AccountingTenantFoundationService } from '../../src/modules/accounting/accounting-tenant-foundation.service';
import { todayTenantDate } from '../../src/common/utils/tenant-timezone.util';
import {
  checkClientBusinessDay,
  dayKeyOfClientDate,
  addDaysToDayKey,
  firstDayOfTenantMonth,
} from '../../src/common/utils/client-date-bounds.util';
import { AttendancePunchError, resolveAttendancePunch } from '../../src/modules/hr/attendance-punch.engine';
import { TreasuryService } from '../../src/modules/treasury/treasury.service';
import { HrService } from '../../src/modules/hr/hr.service';
import { GoodsReceiptService } from '../../src/modules/purchases/services/goods-receipt.service';
import { PurchasesFinanceService } from '../../src/modules/purchases/services/purchases-finance.service';
import { SalesOrdersService } from '../../src/modules/sales/services/sales-orders.service';
import { CustomerInstallmentsService } from '../../src/modules/sales/services/customer-installments.service';
import { SalesFinanceService } from '../../src/modules/sales/services/sales-finance.service';
import { ArCollectionsService } from '../../src/modules/accounting/services/ar-collections.service';

const KW_TZ = 'Asia/Kuwait';
const AUTH = {
  tenantId: 't1',
  accountId: 'a1',
  role: 'admin',
  userId: 1,
  username: 'admin',
  permissions: [],
} as unknown as AuthContext;

/** The tenant's today, in the tenant zone — the anchor every window hangs off. */
const todayKuwait = (): string => todayTenantDate(KW_TZ, new Date());
/** A tenant day key N days from today (negative = past). */
const dayOffset = (days: number): string => addDaysToDayKey(todayKuwait(), days)!;
/** An ISO instant N days from now (for datetime-valued fields). */
const instantOffset = (days: number): string => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

/** The service's real date normalizer, as the tenant-timezone-attendance spec defines it. */
function normalizeDateOnly(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

const FOUNDATION_STUB = {
  ensureForAuth: async () => undefined,
  ensureForScope: async () => undefined,
} as unknown as AccountingTenantFoundationService;

async function main(): Promise<void> {
  // ── §0. The pure helper, frozen now ──────────────────────────────────────
  // 2026-11-14T21:30:00Z is 23:30 in Cairo (still Nov 14) but 00:30 in
  // Kuwait (already Nov 15): the tenant zone, not the host, decides today.
  const frozenNow = new Date('2026-11-14T21:30:00Z');
  assert.equal(dayKeyOfClientDate('2026-11-15', KW_TZ), '2026-11-15', 'a strict day passes through');
  assert.equal(
    dayKeyOfClientDate('2026-11-14T21:30:00.000Z', KW_TZ),
    '2026-11-15',
    'a datetime renders in the tenant zone (Kuwait is already Nov 15)',
  );
  assert.equal(
    dayKeyOfClientDate('2026-11-14T21:30:00.000Z', 'Africa/Cairo'),
    '2026-11-14',
    'the same instant is still Nov 14 in Cairo',
  );
  for (const bad of ['not-a-date', '2026-02-30', '2026-13-01', '', '   ', null, undefined]) {
    assert.equal(dayKeyOfClientDate(bad as never, KW_TZ), null, `${String(bad)} is not a real day`);
  }
  assert.equal(addDaysToDayKey('2026-01-31', 1), '2026-02-01');
  assert.equal(addDaysToDayKey('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToDayKey('2026-11-15', -7), '2026-11-08');
  assert.equal(firstDayOfTenantMonth('2026-11-15'), '2026-11-01');

  // Past window [today-7, today] on the frozen Kuwait today (2026-11-15).
  const pastWindow = { minDayOffset: -7, maxDayOffset: 0 };
  assert.equal(checkClientBusinessDay('2026-11-15', KW_TZ, pastWindow, frozenNow).ok, true);
  assert.equal(checkClientBusinessDay('2026-11-08', KW_TZ, pastWindow, frozenNow).ok, true, 'exactly today-7 is in');
  assert.deepEqual(
    checkClientBusinessDay('2026-11-07', KW_TZ, pastWindow, frozenNow),
    { ok: false, reason: 'TOO_OLD' },
    'today-8 is too old',
  );
  assert.deepEqual(
    checkClientBusinessDay('2026-11-16', KW_TZ, pastWindow, frozenNow),
    { ok: false, reason: 'TOO_FAR_FUTURE' },
    'tomorrow is too far for a past-by-nature date',
  );
  assert.deepEqual(checkClientBusinessDay('garbage', KW_TZ, pastWindow, frozenNow), { ok: false, reason: 'INVALID' });

  // Future window [today, today+365].
  const futureWindow = { minDayOffset: 0, maxDayOffset: 365 };
  assert.equal(checkClientBusinessDay('2026-11-15', KW_TZ, futureWindow, frozenNow).ok, true);
  assert.equal(
    checkClientBusinessDay('2027-11-15', KW_TZ, futureWindow, frozenNow).ok,
    true,
    'exactly today+365 is in',
  );
  assert.deepEqual(checkClientBusinessDay('2027-11-16', KW_TZ, futureWindow, frozenNow), {
    ok: false,
    reason: 'TOO_FAR_FUTURE',
  });
  assert.deepEqual(
    checkClientBusinessDay('2026-11-14', KW_TZ, futureWindow, frozenNow),
    { ok: false, reason: 'TOO_OLD' },
    'yesterday is too old for a future-by-nature date',
  );

  // Anchored window: first due inside [startDate, startDate + 5y].
  const anchorWindow = { anchorDayKey: '2026-11-08', minDayOffset: 0, maxDayOffset: 5 * 365 };
  assert.equal(checkClientBusinessDay('2026-11-10', KW_TZ, anchorWindow, frozenNow).ok, true);
  assert.deepEqual(
    checkClientBusinessDay('2026-11-07', KW_TZ, anchorWindow, frozenNow),
    { ok: false, reason: 'TOO_OLD' },
    'a due date before the plan starts is too old',
  );
  assert.deepEqual(
    checkClientBusinessDay('2031-11-09', KW_TZ, anchorWindow, frozenNow),
    { ok: false, reason: 'TOO_FAR_FUTURE' },
    'a due date past start + 5y is too far',
  );
  console.log('§0 pure helper: ok');

  // ── §A. Expense — real TreasuryService.createExpense on PGlite ──────────
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE tenants (id text PRIMARY KEY);
        INSERT INTO tenants VALUES ('t1');
        CREATE TABLE settings (tenant_id text, key text, value text);
        CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
        INSERT INTO settings VALUES ('t1','currency','EGP'), ('t1','timezone','Asia/Kuwait');
        INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
        CREATE TABLE accounting_accounts (id bigserial PRIMARY KEY, tenant_id text, account_id text, code text, name_ar text DEFAULT '', name_en text DEFAULT '', account_type text DEFAULT 'asset', account_group text DEFAULT '', normal_balance text, is_active boolean DEFAULT true, is_tax boolean DEFAULT false, is_system boolean DEFAULT false, allow_manual_entries boolean DEFAULT true, is_cash_bank boolean DEFAULT false, created_at timestamptz DEFAULT NOW(), updated_at timestamptz);
        CREATE UNIQUE INDEX idx_accounting_accounts_tenant_code_uidx ON accounting_accounts (tenant_id, code);
        INSERT INTO accounting_accounts (id, tenant_id, account_id, code, account_type, allow_manual_entries) VALUES (1110,'t1','a1','1110','asset',true), (6900,'t1','a1','6900','expense',true);
        CREATE TABLE accounting_settings (id bigint, tenant_id text, account_id text, cash_account_id bigint, bank_account_id bigint, customer_receivable_account_id bigint, supplier_payable_account_id bigint, inventory_account_id bigint, sales_revenue_account_id bigint, sales_discount_account_id bigint, cogs_account_id bigint, sales_tax_account_id bigint, purchase_tax_account_id bigint, purchase_account_id bigint, expenses_account_id bigint, manufacturing_overhead_account_id bigint, lock_date_all date, lock_date_non_adviser date, lock_date_tax date);
        INSERT INTO accounting_settings VALUES (1,'t1','a1',1110,1120,1130,2110,1140,4100,4300,5100,2120,1150,NULL,6900,NULL,NULL,NULL);
        CREATE TABLE accounting_fiscal_periods (tenant_id text, status text, name text, period_number int, start_date date, end_date date);
        CREATE TABLE journal_entries (id bigserial PRIMARY KEY, tenant_id text, account_id text, entry_no text UNIQUE, entry_date timestamptz, description text, source_type text, source_id bigint, status text, branch_id bigint, location_id bigint, created_by bigint, posted_by bigint, posted_at timestamptz, updated_at timestamptz, reversal_of_entry_id bigint, reversed_by_entry_id bigint, cancelled_by bigint, cancelled_at timestamptz, cancel_reason text, dedup_key text, cash_flow_category text);
        CREATE TABLE journal_entry_lines (id bigserial PRIMARY KEY, journal_entry_id bigint, tenant_id text, account_id bigint, cost_center_id bigint, description text, debit numeric, credit numeric, partner_type text, partner_id bigint, branch_id bigint, location_id bigint, is_reconciled boolean DEFAULT false);
        CREATE TABLE cost_centers (id bigint, tenant_id text, code text, name text);
        CREATE TABLE branches (id bigint PRIMARY KEY, tenant_id text, name text, default_stock_location_id bigint);
        INSERT INTO branches VALUES (1, 't1', 'Main', 1);
        CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text, account_id text, branch_id bigint, name text, code text, is_active boolean DEFAULT true, location_type text);
        INSERT INTO stock_locations VALUES (1, 't1', 'a1', 1, 'Main Store', 'MAIN', true, 'branch_stock');
        CREATE TABLE users (id bigint PRIMARY KEY, tenant_id text, username text, default_branch_id bigint, role text, password_hash text, password_salt text, is_active boolean DEFAULT true);
        INSERT INTO users VALUES (1, 't1', 'admin', 1, 'admin', '', '', true);
        CREATE TABLE user_branches (tenant_id text, user_id bigint, branch_id bigint);
        CREATE TABLE expenses (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL DEFAULT 0, expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(), note TEXT NOT NULL DEFAULT '', branch_id BIGINT NULL, location_id BIGINT NULL, cost_center_id BIGINT NULL, created_by BIGINT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), tenant_id TEXT NOT NULL DEFAULT '', account_id TEXT NOT NULL DEFAULT '', request_key TEXT NULL, cancelled_at TIMESTAMPTZ NULL, cancelled_by BIGINT NULL, cancel_reason TEXT NULL);
        CREATE TABLE treasury_transactions (id bigserial PRIMARY KEY, tenant_id text, account_id text, txn_type text, amount numeric, payment_channel text, note text, reference_type text, reference_id bigint, return_document_id bigint, branch_id bigint, location_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW());
        CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      `);
      const posting = new AccountingPostingService(FOUNDATION_STUB);
      const audit = new AuditService(db as never);
      const service = new TreasuryService(db as never, new TransactionHelper(), audit, posting);
      const countExpenses = async (): Promise<number> => {
        const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM expenses`.execute(db);
        return Number(rows.rows[0].n);
      };

      // In-window (3 days ago) posts, and the stored day is the sent day.
      const inWindow = await service.createExpense(
        {
          title: 'In-window expense',
          amount: 100,
          note: '',
          date: instantOffset(-3),
          requestKey: 'p6-expense-in-001',
        } as never,
        AUTH,
      );
      assert.equal(inWindow.ok, true);
      assert.equal(await countExpenses(), 1);
      const stored = await sql<{
        expense_date: Date;
      }>`SELECT expense_date FROM expenses WHERE request_key = 'p6-expense-in-001'`.execute(db);
      assert.equal(todayTenantDate(KW_TZ, stored.rows[0].expense_date), dayOffset(-3));

      // 30 days old rejects with the new code and stores nothing.
      await assert.rejects(
        service.createExpense(
          {
            title: 'Old expense',
            amount: 100,
            note: '',
            date: instantOffset(-30),
            requestKey: 'p6-expense-old-001',
          } as never,
          AUTH,
        ),
        (err: any) => err && err.code === 'EXPENSE_DATE_OUT_OF_RANGE' && err.statusCode === 400,
      );
      assert.equal(await countExpenses(), 1);

      // Tomorrow rejects the same way.
      await assert.rejects(
        service.createExpense(
          {
            title: 'Future expense',
            amount: 100,
            note: '',
            date: instantOffset(1),
            requestKey: 'p6-expense-fut-001',
          } as never,
          AUTH,
        ),
        (err: any) => err && err.code === 'EXPENSE_DATE_OUT_OF_RANGE' && err.statusCode === 400,
      );
      assert.equal(await countExpenses(), 1);

      // Garbage still rejects with the old parse code, unchanged.
      await assert.rejects(
        service.createExpense(
          {
            title: 'Garbage expense',
            amount: 100,
            note: '',
            date: 'not-a-date',
            requestKey: 'p6-expense-bad-001',
          } as never,
          AUTH,
        ),
        (err: any) => err && err.code === 'INVALID_EXPENSE_DATE' && err.statusCode === 400,
      );
      assert.equal(await countExpenses(), 1);
    } finally {
      await db.destroy();
    }
    console.log('§A expense: ok');
  }

  // ── §B. HR manual attendance — pure engine + real bulk paths ─────────────
  {
    // Engine level, frozen Kuwait now (today 2026-11-15).
    const engineNow = new Date('2026-11-14T21:30:00Z');
    const manualOk = resolveAttendancePunch(
      { workDate: '2026-11-01', checkInAt: '2026-11-01T06:00:00.000Z', checkOutAt: '2026-11-01T14:00:00.000Z' },
      KW_TZ,
      normalizeDateOnly,
      engineNow,
    );
    assert.equal(manualOk.workDate, '2026-11-01', 'first of the open month stays editable');
    assert.equal(manualOk.serverAnchored, false);
    const manualToday = resolveAttendancePunch({ workDate: '2026-11-15' }, KW_TZ, normalizeDateOnly, engineNow);
    assert.equal(manualToday.workDate, '2026-11-15', 'today stays editable');
    assert.throws(
      () => resolveAttendancePunch({ workDate: '2026-10-31' }, KW_TZ, normalizeDateOnly, engineNow),
      (error: unknown) => error instanceof AttendancePunchError && error.code === 'HR_ATTENDANCE_DATE_OUT_OF_RANGE',
      'last month is outside the open payroll month',
    );
    assert.throws(
      () => resolveAttendancePunch({ workDate: '2026-11-16' }, KW_TZ, normalizeDateOnly, engineNow),
      (error: unknown) => error instanceof AttendancePunchError && error.code === 'HR_ATTENDANCE_DATE_OUT_OF_RANGE',
      'tomorrow is outside the open payroll month',
    );
    // The server-anchored punch still ignores ANY client workDate, even
    // one far outside the month — the anchored path is untouched.
    const anchored = resolveAttendancePunch(
      { useServerTime: true, punchAction: 'check_in', workDate: '2020-01-01' },
      KW_TZ,
      normalizeDateOnly,
      engineNow,
    );
    assert.equal(anchored.workDate, '2026-11-15');
    assert.equal(anchored.serverAnchored, true);
    console.log('§B engine: ok');
  }

  // ── §B (service). Real HrService bulk paths on PGlite ────────────────────
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    // The audit row is pinned by audit-log-general-attendance-idempotency,
    // not here: stub the audit collaborator (its real insert needs an
    // idempotency_key column this fixture does not carry).
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
        CREATE TABLE hr_holidays (id bigint PRIMARY KEY, tenant_id text, start_date date, end_date date);
        CREATE TABLE hr_hr_settings (id bigint PRIMARY KEY, tenant_id text, key text, value text);
        CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, status text, start_date date, end_date date);
        CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, run_id bigint, employee_id bigint, status text);
        CREATE TABLE hr_departments (id bigint PRIMARY KEY, tenant_id text, name text);
        CREATE TABLE hr_job_titles (id bigint PRIMARY KEY, tenant_id text, name text);
        CREATE TABLE audit_logs (id bigserial PRIMARY KEY, action text, details text, event_code text, target_tenant_id text, created_by bigint, impersonated_by bigint, tenant_id text, account_id text, created_at timestamptz DEFAULT NOW());
      `);
      const today = todayKuwait();
      const lastMonthDay = addDaysToDayKey(firstDayOfTenantMonth(today), -1)!;

      // Bulk save for today passes and stores the day.
      await service.bulkSaveAttendance(
        {
          workDate: today,
          rows: [
            {
              employeeId: 1,
              status: 'present',
              checkInAt: `${today}T09:00:00+03:00`,
              checkOutAt: `${today}T17:00:00+03:00`,
              source: 'manual',
            },
          ],
        } as never,
        AUTH,
      );
      const saved = await sql<{
        work_date: Date;
      }>`SELECT work_date FROM hr_attendance_records WHERE employee_id = 1`.execute(db);
      assert.equal(saved.rows.length, 1);
      assert.equal(todayTenantDate(KW_TZ, saved.rows[0].work_date), today);

      // Bulk save for last month rejects with the new code and stores nothing new.
      await assert.rejects(
        service.bulkSaveAttendance(
          {
            workDate: lastMonthDay,
            rows: [
              {
                employeeId: 1,
                status: 'present',
                checkInAt: `${lastMonthDay}T09:00:00+03:00`,
                checkOutAt: `${lastMonthDay}T17:00:00+03:00`,
                source: 'manual',
              },
            ],
          } as never,
          AUTH,
        ),
        (err: any) => err && err.code === 'HR_ATTENDANCE_DATE_OUT_OF_RANGE' && err.statusCode === 400,
      );
      const stillOne = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM hr_attendance_records`.execute(db);
      assert.equal(Number(stillOne.rows[0].n), 1);

      // Bulk import: the in-month record imports, the last-month record
      // is skipped with an error — the batch keeps its per-record pattern.
      const imported = await service.bulkImportAttendanceRecords(
        {
          records: [
            {
              employeeNo: 'E1',
              workDate: today,
              checkInAt: `${today}T09:00:00+03:00`,
              checkOutAt: `${today}T17:00:00+03:00`,
            },
            {
              employeeNo: 'E1',
              workDate: lastMonthDay,
              checkInAt: `${lastMonthDay}T09:00:00+03:00`,
              checkOutAt: `${lastMonthDay}T17:00:00+03:00`,
            },
          ],
        } as never,
        AUTH,
      );
      assert.equal(imported.imported, 1, 'only the in-month record imports');
      assert.equal(imported.skipped, 1, 'the last-month record is skipped');
      assert.match(imported.errors.join(' '), /open payroll month/);
    } finally {
      await db.destroy();
    }
    console.log('§B service: ok');
  }

  // ── §C. Goods receipt — real GoodsReceiptService.createGoodsReceipt ──────
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
        CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
        INSERT INTO settings VALUES ('t1','currency','EGP'), ('t1','timezone','Asia/Kuwait');
        INSERT INTO currency_exchange_rates VALUES ('t1','EGP',true,1);
        CREATE TABLE suppliers (id bigint, tenant_id text, name text, balance numeric DEFAULT 0, updated_at timestamptz);
        INSERT INTO suppliers VALUES (9, 't1', 'Supplier Nine', 0, NOW());
        CREATE TABLE stock_locations (id bigint PRIMARY KEY, tenant_id text, branch_id bigint, name text);
        INSERT INTO stock_locations VALUES (1, 't1', 1, 'Main Store');
        CREATE TABLE products (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, sku text, stock_qty numeric DEFAULT 0, reserved_qty numeric DEFAULT 0, cost_price numeric DEFAULT 0, track_serials boolean DEFAULT false, updated_at timestamptz);
        INSERT INTO products VALUES (10, 't1', 'a1', 'Widget', 'W10', 0, 0, 0, false, NOW());
        CREATE TABLE purchase_orders (id bigint PRIMARY KEY, tenant_id text, order_number text);
        CREATE TABLE goods_receipt_notes (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, doc_no text,
          purchase_order_id bigint, supplier_id bigint, location_id bigint, received_at timestamptz,
          received_by bigint, supplier_delivery_note_ref text, status text DEFAULT 'draft', notes text,
          freight_amount numeric DEFAULT 0,
          grni_journal_entry_id bigint, pending_review boolean NOT NULL DEFAULT FALSE, pending_review_reason text,
          created_at timestamptz DEFAULT '2026-10-01', updated_at timestamptz DEFAULT '2026-10-01');
        CREATE TABLE goods_receipt_lines (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, tenant_id text, account_id text, grn_id bigint,
          purchase_order_item_id bigint, product_id bigint, ordered_qty numeric, received_qty numeric,
          accepted_qty numeric, rejected_qty numeric, rejection_reason text, batch_number text,
          expiry_date date, manufacturing_date date, unit_cost numeric, allocated_landed_cost numeric DEFAULT 0,
          landed_unit_cost numeric, quarantine_location_id bigint,
          coa_document_id bigint, over_received_qty numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz DEFAULT '2026-10-01');
      `);
      const posting = new AccountingPostingService(FOUNDATION_STUB);
      const finance = new PurchasesFinanceService();
      const service = new GoodsReceiptService(db as any, posting as any, finance as any);
      const basePayload = {
        supplierId: 9,
        locationId: 1,
        lines: [{ productId: 10, receivedQty: 2, acceptedQty: 2, rejectedQty: 0, unitCost: 10 }],
      };

      // In-window (3 days ago) creates, and the stored day is the sent day.
      const inWindow = await service.createGoodsReceipt(
        { ...basePayload, receivedAt: instantOffset(-3) } as never,
        AUTH,
      );
      assert.equal(inWindow.status, 'draft');
      assert.equal(todayTenantDate(KW_TZ, new Date(inWindow.receivedAt)), dayOffset(-3));

      // 30 days old and tomorrow reject at the boundary; nothing is created.
      const countGrns = async (): Promise<number> => {
        const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM goods_receipt_notes`.execute(db);
        return Number(rows.rows[0].n);
      };
      assert.equal(await countGrns(), 1);
      await assert.rejects(
        service.createGoodsReceipt({ ...basePayload, receivedAt: instantOffset(-30) } as never, AUTH),
        (err: any) => err && /تاريخ الاستلام/.test(String(err.message || '')),
      );
      await assert.rejects(
        service.createGoodsReceipt({ ...basePayload, receivedAt: instantOffset(1) } as never, AUTH),
        (err: any) => err && /تاريخ الاستلام/.test(String(err.message || '')),
      );
      assert.equal(await countGrns(), 1);

      // Omitted stays server-now.
      const omitted = await service.createGoodsReceipt({ ...basePayload } as never, AUTH);
      assert.equal(omitted.status, 'draft');
      assert.equal(todayTenantDate(KW_TZ, new Date(omitted.receivedAt)), todayKuwait());
    } finally {
      await db.destroy();
    }
    console.log('§C goods receipt: ok');
  }

  // ── §D. Sales order — real SalesOrdersService.createOrder (draft) ────────
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
        INSERT INTO settings VALUES ('t1','timezone','Asia/Kuwait');
        CREATE TABLE branches (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, default_stock_location_id bigint);
        CREATE TABLE stock_locations (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, code text, branch_id bigint, location_type text NOT NULL DEFAULT 'internal_warehouse', is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE products (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, name text NOT NULL, item_type text NOT NULL DEFAULT 'product', stock_qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT NOW());
        CREATE TABLE product_location_stock (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, product_id bigint NOT NULL, branch_id bigint, location_id bigint, qty numeric NOT NULL DEFAULT 0, reserved_qty numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW());
        CREATE TABLE sales_orders (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, order_number text NOT NULL, customer_id bigint, customer_name text NOT NULL DEFAULT '', customer_phone text, customer_address text, notes text, terms_conditions text, branch_id bigint, warehouse_location_id bigint, subtotal numeric NOT NULL DEFAULT 0, discount_amount numeric NOT NULL DEFAULT 0, tax_amount numeric NOT NULL DEFAULT 0, total_amount numeric NOT NULL DEFAULT 0, status text NOT NULL, sale_id bigint, quotation_id bigint, reservation_expires_at timestamptz, delivery_date timestamptz, created_by bigint, updated_at timestamptz NOT NULL DEFAULT NOW(), created_at timestamptz NOT NULL DEFAULT NOW());
        CREATE TABLE sales_order_items (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, sales_order_id bigint NOT NULL, product_id bigint NOT NULL, product_name text NOT NULL DEFAULT '', unit_name text, quantity numeric NOT NULL DEFAULT 0, reserved_quantity numeric NOT NULL DEFAULT 0, delivered_quantity numeric NOT NULL DEFAULT 0, unit_price numeric NOT NULL DEFAULT 0, discount numeric NOT NULL DEFAULT 0, total numeric NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT NOW());
        CREATE TABLE operation_executions (id bigserial PRIMARY KEY, tenant_id text NOT NULL, account_id text NOT NULL, idempotency_key text NOT NULL, operation_type text NOT NULL, status text NOT NULL, request_hash text NOT NULL, document_id text, response_payload text, error_code text, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), completed_at timestamptz);
      `);
      await db
        .insertInto('branches')
        .values({ id: 1, tenant_id: 't1', account_id: 'a1', default_stock_location_id: 10 } as any)
        .execute();
      await db
        .insertInto('stock_locations')
        .values({
          id: 10,
          tenant_id: 't1',
          account_id: 'a1',
          name: 'Main',
          branch_id: 1,
          location_type: 'branch_stock',
          is_active: true,
        } as any)
        .execute();
      await db
        .insertInto('products')
        .values({ id: 1, tenant_id: 't1', account_id: 'a1', name: 'Widget', stock_qty: 15, reserved_qty: 0 } as any)
        .execute();
      const service = new SalesOrdersService(db as any, {} as any);
      const countOrders = async (): Promise<number> => {
        const rows = await sql<{ n: string }>`SELECT COUNT(*) AS n FROM sales_orders`.execute(db);
        return Number(rows.rows[0].n);
      };
      const draftDto = (extra: Record<string, unknown> = {}) =>
        ({
          customerName: 'عميل اختبار',
          subtotal: 120,
          totalAmount: 120,
          autoReserve: false,
          items: [{ productId: 1, productName: 'Widget', quantity: 1, unitPrice: 120, total: 120 }],
          ...extra,
        }) as any;

      // A delivery date 30 days out creates, and the stored day is the sent day.
      const future = await service.createOrder(draftDto({ deliveryDate: dayOffset(30) }), AUTH);
      assert.ok((future as any).order.id);
      assert.equal(await countOrders(), 1);
      const stored = await sql<{
        delivery_date: Date;
      }>`SELECT delivery_date FROM sales_orders WHERE id = ${Number((future as any).order.id)}`.execute(db);
      assert.equal(todayTenantDate(KW_TZ, stored.rows[0].delivery_date), dayOffset(30));

      // Yesterday's delivery, a garbage delivery date, and an expiry more
      // than a year out all reject — and create nothing.
      await assert.rejects(
        service.createOrder(draftDto({ deliveryDate: dayOffset(-1) }), AUTH),
        (err: any) => err && /تاريخ التسليم/.test(String(err.message || '')),
      );
      await assert.rejects(
        service.createOrder(draftDto({ deliveryDate: 'not-a-date' }), AUTH),
        (err: any) => err && /تاريخ التسليم/.test(String(err.message || '')),
      );
      await assert.rejects(
        service.createOrder(draftDto({ reservationExpiresAt: dayOffset(400) }), AUTH),
        (err: any) => err && /انتهاء الحجز/.test(String(err.message || '')),
      );
      assert.equal(await countOrders(), 1);

      // An expiry of today creates.
      const todayExpiry = await service.createOrder(draftDto({ reservationExpiresAt: dayOffset(0) }), AUTH);
      assert.ok((todayExpiry as any).order.id);
      assert.equal(await countOrders(), 2);
    } finally {
      await db.destroy();
    }
    console.log('§D sales order: ok');
  }

  // ── §E. Installments — real CustomerInstallmentsService.createPlan ───────
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
        CREATE TABLE currency_exchange_rates (tenant_id text, currency_code text, is_base boolean, exchange_rate numeric);
        CREATE TABLE customers (id bigint, tenant_id text, name text, phone text, balance numeric DEFAULT 0);
        CREATE TABLE customer_installment_plans (id bigserial PRIMARY KEY, tenant_id text, account_id text, plan_number text, sale_id bigint, customer_id bigint, total_amount numeric, down_payment numeric, financed_amount numeric, interest_rate_percent numeric, interest_amount numeric, total_with_interest numeric, installment_count int, monthly_amount numeric, start_date date, status text, notes text, branch_id bigint, created_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
        CREATE TABLE customer_installments (id bigserial PRIMARY KEY, tenant_id text, account_id text, plan_id bigint, sale_id bigint, customer_id bigint, installment_number int, due_date date, amount numeric, paid_amount numeric DEFAULT 0, status text, payment_method text, receipt_no text, notes text, paid_at timestamptz, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
        INSERT INTO settings VALUES ('t1', 'currency', 'EGP'), ('t1', 'timezone', 'Asia/Kuwait');
        INSERT INTO currency_exchange_rates VALUES ('t1', 'EGP', true, 1);
        INSERT INTO customers VALUES (1, 't1', 'Customer', '0100', 0);
      `);
      const posting = new AccountingPostingService(FOUNDATION_STUB);
      const service = new CustomerInstallmentsService(
        db,
        new TransactionHelper(),
        new SalesFinanceService(db),
        posting as any,
      );
      const planDto = (extra: Record<string, unknown> = {}) =>
        ({
          customerId: 1,
          totalAmount: 300,
          downPayment: 0,
          interestRatePercent: 0,
          installmentCount: 3,
          ...extra,
        }) as any;

      // A start 3 days ago creates; the stored start day is the sent day.
      const start = dayOffset(-3);
      const inWindow = await service.createPlan(planDto({ startDate: start }), AUTH);
      assert.ok(inWindow.plan.id);
      assert.equal(todayTenantDate(KW_TZ, new Date(inWindow.plan.start_date)), start);

      // A start 30 days ago rejects with the new code.
      await assert.rejects(
        service.createPlan(planDto({ startDate: dayOffset(-30) }), AUTH),
        (err: any) => err && err.code === 'INSTALLMENT_START_DATE_OUT_OF_RANGE' && err.statusCode === 400,
      );

      // A garbage start is now parse-checked, like firstDueDate always was.
      await assert.rejects(
        service.createPlan(planDto({ startDate: 'not-a-date' }), AUTH),
        (err: any) => err && err.code === 'INVALID_START_DATE' && err.statusCode === 400,
      );

      // A first due date before the plan starts rejects.
      await assert.rejects(
        service.createPlan(planDto({ startDate: start, firstDueDate: dayOffset(-4) }), AUTH),
        (err: any) => err && err.code === 'INSTALLMENT_FIRST_DUE_DATE_OUT_OF_RANGE' && err.statusCode === 400,
      );

      // A first due date more than 5 years after the start rejects.
      await assert.rejects(
        service.createPlan(planDto({ startDate: start, firstDueDate: addDaysToDayKey(start, 6 * 365)! }), AUTH),
        (err: any) => err && err.code === 'INSTALLMENT_FIRST_DUE_DATE_OUT_OF_RANGE' && err.statusCode === 400,
      );

      // The form default — first due equal to the start — creates, and
      // the first installment is due on the start day.
      const formDefault = await service.createPlan(planDto({ startDate: start, firstDueDate: start }), AUTH);
      assert.equal(todayTenantDate(KW_TZ, new Date(formDefault.installments[0].due_date)), start);

      // No start at all defaults to today.
      const noStart = await service.createPlan(planDto({}), AUTH);
      assert.ok(noStart.plan.id);
    } finally {
      await db.destroy();
    }
    console.log('§E installments: ok');
  }

  // ── §F. AR collections — real ArCollectionsService on PGlite ─────────────
  {
    const pg = new PGlite();
    const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
    try {
      await pg.exec(`
        CREATE TABLE settings (tenant_id text, key text, value text);
        INSERT INTO settings VALUES ('t1','timezone','Asia/Kuwait');
        CREATE TABLE ar_collection_cases (id text PRIMARY KEY, tenant_id text, customer_id bigint, status text, last_contact_date timestamptz, promised_payment_date date, promised_amount numeric, next_followup_date date, updated_at timestamptz, created_at timestamptz DEFAULT NOW());
        INSERT INTO ar_collection_cases VALUES ('case-1', 't1', 1, 'open', NULL, NULL, NULL, NULL, NOW(), NOW());
        CREATE TABLE ar_collection_logs (id text PRIMARY KEY, tenant_id text, case_id text, interaction_type text, result_status text, details text, promised_date date, promised_amount numeric, created_by bigint, created_at timestamptz DEFAULT NOW());
      `);
      const service = new ArCollectionsService(db);

      // A promise 30 days out logs, and the case carries the promised day.
      const logged = await service.logInteraction(AUTH, 'case-1', {
        interactionType: 'call',
        resultStatus: 'promise_to_pay',
        promisedDate: dayOffset(30),
        promisedAmount: 100,
      } as never);
      assert.equal(logged.success, true);
      const cased = await sql<{
        promised_payment_date: Date;
      }>`SELECT promised_payment_date FROM ar_collection_cases WHERE id = 'case-1'`.execute(db);
      assert.equal(todayTenantDate(KW_TZ, cased.rows[0].promised_payment_date), dayOffset(30));

      // A promise for yesterday rejects.
      await assert.rejects(
        service.logInteraction(AUTH, 'case-1', {
          interactionType: 'call',
          resultStatus: 'promise_to_pay',
          promisedDate: dayOffset(-1),
          promisedAmount: 100,
        } as never),
        (err: any) => err && /Promised payment date/.test(String(err.message || '')),
      );

      // A garbage follow-up date rejects at the service bound too.
      await assert.rejects(
        service.logInteraction(AUTH, 'case-1', {
          interactionType: 'call',
          resultStatus: 'answered',
          nextFollowupDate: 'garbage',
        } as never),
        (err: any) => err && /Next follow-up date/.test(String(err.message || '')),
      );

      // A follow-up more than a year out rejects.
      await assert.rejects(
        service.logInteraction(AUTH, 'case-1', {
          interactionType: 'call',
          resultStatus: 'answered',
          nextFollowupDate: dayOffset(400),
        } as never),
        (err: any) => err && /Next follow-up date/.test(String(err.message || '')),
      );

      // recordPromiseToPay: 30 days out records; yesterday rejects.
      const promised = await service.recordPromiseToPay(AUTH, 'case-1', {
        promisedDate: dayOffset(30),
        promisedAmount: 50,
      } as never);
      assert.equal(promised.success, true);
      await assert.rejects(
        service.recordPromiseToPay(AUTH, 'case-1', { promisedDate: dayOffset(-1), promisedAmount: 50 } as never),
        (err: any) => err && /Promised payment date/.test(String(err.message || '')),
      );
    } finally {
      await db.destroy();
    }
    console.log('§F AR collections: ok');
  }

  // ── Source pins: every channel calls the shared helper ───────────────────
  const helperSource = readFileSync(resolve(__dirname, '../../src/common/utils/client-date-bounds.util.ts'), 'utf8');
  assert.ok(helperSource.includes('export function checkClientBusinessDay('), 'the shared bound must exist');
  assert.ok(helperSource.includes('CLIENT_BUSINESS_DATE_PAST_DAYS = 7'), 'the past bound mirrors the P2 7-day window');
  for (const file of [
    '../../src/modules/treasury/treasury.service.ts',
    '../../src/modules/purchases/services/goods-receipt-create.service.ts',
    // File #119: createOrder (the checkClientBusinessDay call site) moved
    // to sales-orders-creation.ts — the facade holds no such call.
    '../../src/modules/sales/services/sales-orders/sales-orders-creation.ts',
    '../../src/modules/sales/services/customer-installments.service.ts',
    '../../src/modules/accounting/services/ar-collections.service.ts',
  ]) {
    const source = readFileSync(resolve(__dirname, file), 'utf8');
    assert.ok(source.includes('checkClientBusinessDay'), `${file} must validate through the shared helper`);
  }
  const engineSource = readFileSync(resolve(__dirname, '../../src/modules/hr/attendance-punch.engine.ts'), 'utf8');
  assert.ok(engineSource.includes('HR_ATTENDANCE_DATE_OUT_OF_RANGE'), 'the manual punch must bound the work date');
  const hrSource = readFileSync(
    resolve(__dirname, '../../src/modules/hr/services/hr-attendance-records.service.ts'),
    'utf8',
  );
  assert.ok(hrSource.includes('HR_ATTENDANCE_DATE_OUT_OF_RANGE'), 'bulk save/import must bound the work date');
  const dtoSource = readFileSync(resolve(__dirname, '../../src/modules/accounting/dto/ar-collections.dto.ts'), 'utf8');
  assert.ok(
    dtoSource.includes('@IsDateString()\n  promisedDate?: string;'),
    'the log DTO promise date must be a date string',
  );
  assert.ok(
    dtoSource.includes('@IsDateString()\n  nextFollowupDate?: string;'),
    'the log DTO follow-up date must be a date string',
  );
  assert.ok(
    dtoSource.includes('@IsDateString()\n  promisedDate!: string;'),
    'the promise DTO date must be a date string',
  );

  console.log('clock-p6-client-date-bounds.spec: all cases passed');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
