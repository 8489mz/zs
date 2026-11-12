/*
 * New file: backend/test/critical/rep-payroll-target-month-m2.spec.ts
 *
 * WHAT THIS PINS (INV-REP-PAYROLL-TARGET-MONTH, M2: A3 + A10):
 * pushRepShortagesToPayroll ignored targetMonth entirely — the
 * payroll adjustment was dated CURRENT_DATE, so the deduction landed
 * in whatever run was built next: the wrong month's wage, deducted
 * early, or never for a rep who left before the target month. And
 * payroll_run_id was never written, so a paid item could not be
 * traced to the run that applied it.
 *
 * DECISION PD2 (taken by the main chat, 2026-11-12): targetMonth is
 * the FIRST payroll run whose period is the target month; if that
 * run's period already passed, the deduction rolls forward to the
 * NEAREST FOLLOWING run, with the roll-forward recorded on the
 * settlement row. M2 also writes payroll_run_id when the deduction
 * is applied, so the settlement row links to the run.
 *
 * WHAT IS DRIVEN (real PGlite, real service methods, no mocks):
 * (a) a push with targetMonth = next month lands the adjustment in
 *     that month's run, not the current month's: the current run
 *     rebuilds to a full net (5000) with the adjustment still
 *     pending, and the target run rebuilds to 5000 - 100 = 4900;
 * (b) a targetMonth whose run period already passed rolls to the
 *     nearest following run (not a later one): the roll-forward is
 *     recorded in the settlement notes, the adjustment is dated in
 *     the following run's period, and only that run deducts it;
 * (c) payroll_run_id is written on the settlement row when the
 *     deduction is applied and reads back — targeted at push time,
 *     confirmed as the applying run by the rebuild;
 * (d) the HR rebuild marks the item applied and the link holds:
 *     re-rebuilding the same run keeps net 4950 (5000 - 50),
 *     exactly one adjustment, and the same payroll_run_id;
 * (e) a push with no run for the target month at all still dates
 *     the adjustment inside the target month (first day), so the
 *     run built later for that month picks it up — and the rebuild
 *     then writes the link the push could not.
 *
 * NOT DRIVEN: a live-Postgres run; true two-connection concurrency
 * (PGlite is single-connection); the frontend payroll screens
 * (untouched).
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import { VanSalesService } from '../../src/modules/delivery-reps/van-sales.service';
import { HrService } from '../../src/modules/hr/hr.service';
import { TransactionHelper } from '../../src/database/helpers/transaction.helper';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';

const TENANT = 't1';
const ACCOUNT = 'a1';

// Local calendar parts, never UTC toISOString(): months are computed
// from the machine-local date, and every expected date string is
// built from local year/month/day parts.
const now = new Date();
const baseYear = now.getFullYear();
const baseMonth = now.getMonth(); // 0-based
const monthOf = (offset: number): string => {
  const d = new Date(baseYear, baseMonth + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthStart = (offset: number): string => `${monthOf(offset)}-01`;
const monthEnd = (offset: number): string => {
  const d = new Date(baseYear, baseMonth + offset + 1, 0);
  return `${monthOf(offset)}-${String(d.getDate()).padStart(2, '0')}`;
};
const CUR = monthOf(0);
const NEXT = monthOf(1);
const PAST = monthOf(-2);

// A date-only column reads back as a Date at midnight UTC; the
// stored calendar date is its UTC parts, never local toString().
const dateKey = (v: unknown): string => {
  const d = v instanceof Date ? v : new Date(String(v));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const adminAuth: any = {
  userId: 1, sessionId: 'spec', username: 'admin', role: 'admin',
  permissions: ['deliveryReps', 'accounting'], tenantId: TENANT, accountId: ACCOUNT,
};

async function makeDb(): Promise<{ pg: PGlite; db: Kysely<Database> }> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await pg.exec(`
    CREATE TABLE settings (tenant_id text, key text, value text);
    CREATE TABLE hr_hr_settings (id bigint PRIMARY KEY, tenant_id text, key text, value text);
    CREATE TABLE delivery_representatives (id bigint PRIMARY KEY, tenant_id text, account_id text, name text, phone text, vehicle_plate text, van_location_id bigint, employee_id bigint, national_id text, is_van_rep boolean DEFAULT false, updated_at timestamptz DEFAULT NOW());
    CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, account_id text, display_name text, national_id text, status text, compensation_type text, hourly_rate numeric, expected_daily_hours numeric, hire_date date, end_of_service_date date, has_social_insurance boolean, insurance_salary numeric, has_income_tax boolean, pay_frequency text, user_id bigint, commission_type text, commission_value numeric, commission_target numeric, delay_policy text, approved_leave_days numeric);
    CREATE TABLE hr_employment_contracts (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, base_salary numeric, currency text, status text, start_date date, end_date date);
    CREATE TABLE hr_compensation_packages (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, allowance_amount numeric, deduction_amount numeric, effective_from date, effective_to date);
    CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, notes text, settled_at timestamptz, settled_by bigint, settlement_method text, receipt_voucher_no text, payroll_run_id bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE hr_employee_adjustments (id bigserial PRIMARY KEY, tenant_id text, employee_id bigint, run_id bigint, item_id bigint, status text, applied_in_run_id bigint, amount numeric, date date, adjustment_type text, amount_type text, accounting_category text, reason text, source_type text, source_id text, created_by bigint, updated_by bigint, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
    CREATE TABLE hr_payroll_item_adjustments (id bigint PRIMARY KEY, tenant_id text, payroll_item_id bigint, adjustment_type text, amount numeric);
    CREATE TABLE hr_end_of_service_settlements (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, status text);
    CREATE TABLE hr_attendance_records (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, work_date date, status text, check_in_at timestamptz, check_out_at timestamptz, prior_sessions_minutes integer NOT NULL DEFAULT 0);
    CREATE TABLE hr_attendance_exceptions (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, status text, work_date date, exception_type text, approved_duration_minutes numeric, duration_minutes numeric);
    CREATE TABLE hr_leave_requests (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, status text, start_date date, end_date date, leave_type_id bigint, total_days numeric, days_count numeric, leave_type text);
    CREATE TABLE hr_leave_types (id bigint PRIMARY KEY, tenant_id text, is_paid boolean, deduct_from_salary boolean, code text);
    CREATE TABLE hr_holidays (id bigint PRIMARY KEY, tenant_id text, holiday_date date, start_date date, end_date date);
    CREATE TABLE sales_invoices (id bigint PRIMARY KEY, tenant_id text);
    CREATE TABLE hr_employee_loans (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, status text, remaining_amount numeric, first_due_date date, salary_due_date date, repayment_mode text, issue_date date, disbursed_at timestamptz);
    CREATE TABLE hr_employee_loan_installments (id bigint PRIMARY KEY, tenant_id text, loan_id bigint, amount numeric, status text, due_date date, paid_amount numeric, installment_no int);
    CREATE TABLE hr_payroll_runs (id bigint PRIMARY KEY, tenant_id text, account_id text, period_month text, start_date date, end_date date, pay_frequency text, status text, updated_at timestamptz);
    CREATE TABLE hr_payroll_run_items (id bigint PRIMARY KEY, tenant_id text, account_id text, run_id bigint, employee_id bigint, contract_id bigint, base_salary numeric, allowance_amount numeric, deduction_amount numeric, loan_deduction_amount numeric, asset_recovery_deduction_amount numeric, employee_social_insurance numeric, employer_social_insurance numeric, income_tax numeric, penalty_deduction numeric, carried_forward_deduction numeric, gross_pay numeric, net_pay numeric, status text, notes text, paid_at timestamptz, paid_by bigint, payment_channel text, journal_entry_id bigint, updated_at timestamptz);
    INSERT INTO settings VALUES ('t1','currency','EGP');
  `);
  return { pg, db };
}

function buildVanService(db: any): any {
  const service = Object.create(VanSalesService.prototype);
  service.db = db;
  return service;
}

function buildHrService(db: Kysely<Database>): any {
  return new HrService(
    db,
    new TransactionHelper(),
    { log: async () => {} } as never,
    {} as never,
    {} as never,
    undefined,
  );
}

async function seedEmployee(db: Kysely<Database>, id: number, displayName: string): Promise<void> {
  await (db as any).insertInto('hr_employees').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, display_name: displayName, national_id: null,
    status: 'active', compensation_type: 'monthly', hourly_rate: 0, expected_daily_hours: 8,
    hire_date: '2026-01-01', end_of_service_date: null, has_social_insurance: false,
    insurance_salary: 0, has_income_tax: false, pay_frequency: 'monthly', user_id: null,
    commission_type: null, commission_value: 0, commission_target: null, delay_policy: null,
    approved_leave_days: 0,
  }).execute();
  await (db as any).insertInto('hr_employment_contracts').values({
    id, tenant_id: TENANT, employee_id: id, base_salary: 5000, currency: 'EGP',
    status: 'active', start_date: '2026-01-01', end_date: null,
  }).execute();
}

async function seedRep(db: Kysely<Database>, repId: number, extra: Record<string, unknown> = {}): Promise<void> {
  await (db as any).insertInto('delivery_representatives').values({
    id: repId, tenant_id: TENANT, account_id: ACCOUNT, name: `Rep ${repId}`,
    phone: null, vehicle_plate: null, van_location_id: 10, employee_id: null, national_id: null,
    ...extra,
  }).execute();
}

async function seedSettlement(db: Kysely<Database>, id: number, repId: number, entryType: string, amount: number, status: string, notes = 'shortage'): Promise<void> {
  await (db as any).insertInto('van_rep_financial_settlements').values({
    id, tenant_id: TENANT, account_id: ACCOUNT, rep_id: repId, trip_id: 11,
    entry_type: entryType, amount, status, notes,
  }).execute();
}

async function seedRun(db: Kysely<Database>, runId: number, monthOffset: number, itemId: number, employeeId: number): Promise<void> {
  await (db as any).insertInto('hr_payroll_runs').values({
    id: runId, tenant_id: TENANT, account_id: ACCOUNT, period_month: monthOf(monthOffset),
    start_date: monthStart(monthOffset), end_date: monthEnd(monthOffset), pay_frequency: 'monthly', status: 'draft',
  }).execute();
  await (db as any).insertInto('hr_payroll_run_items').values({
    id: itemId, tenant_id: TENANT, account_id: ACCOUNT, run_id: runId, employee_id: employeeId, contract_id: employeeId,
    base_salary: 0, allowance_amount: 0, deduction_amount: 0, loan_deduction_amount: 0,
    asset_recovery_deduction_amount: 0, employee_social_insurance: 0, employer_social_insurance: 0,
    income_tax: 0, penalty_deduction: 0, carried_forward_deduction: 0, gross_pay: 0, net_pay: 0,
    status: 'draft', notes: '', paid_at: null, paid_by: null, payment_channel: null,
    journal_entry_id: null,
  }).execute();
}

async function rebuild(db: Kysely<Database>, hrService: any, runId: number): Promise<void> {
  await (hrService as unknown as { rebuildPayrollRunItems: (db: unknown, runId: number, itemStatus: string, tenantId: string) => Promise<void> })
    .rebuildPayrollRunItems(db, runId, 'draft', TENANT);
}

async function adjustments(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('hr_employee_adjustments').selectAll().execute();
}

async function settlementRow(db: Kysely<Database>, id: number): Promise<any> {
  return (db as any).selectFrom('van_rep_financial_settlements').selectAll().where('id', '=', id).executeTakeFirst();
}

async function runItemNet(db: Kysely<Database>, itemId: number): Promise<number> {
  const row = await (db as any).selectFrom('hr_payroll_run_items').select('net_pay').where('id', '=', itemId).executeTakeFirst();
  return Number(row?.net_pay || 0);
}

async function main(): Promise<void> {
  // (a) A push with targetMonth = next month lands the adjustment in
  // that month's run, not the current month's.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 9, 'Rep 4');
      await seedRep(db, 4, { employee_id: 9 });
      await seedSettlement(db, 401, 4, 'cash_shortage', 100, 'pending');
      await seedRun(db, 7, 0, 1, 9);
      await seedRun(db, 8, 1, 2, 9);
      const service = buildVanService(db);
      const pushed = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [401], targetMonth: NEXT }, adminAuth);
      assert.equal(pushed.results[0].success, true, 'the push succeeds');
      assert.equal(pushed.effectiveMonth, NEXT, 'the effective month is the target month');
      assert.equal(pushed.effectiveRunId, 8, 'the effective run is the target month run');
      assert.equal(pushed.rolledForward, false, 'nothing rolled forward');
      const adjs = await adjustments(db);
      assert.equal(adjs.length, 1, 'exactly one payroll adjustment');
      assert.equal(dateKey(adjs[0].date), monthStart(1), 'the adjustment is dated inside the target run period, not today');
      assert.equal(String(adjs[0].status), 'pending', 'the adjustment waits for the run');
      const row = await settlementRow(db, 401);
      assert.equal(String(row.status), 'pushed_to_payroll', 'the item is pushed');
      assert.equal(Number(row.payroll_run_id), 8, 'the settlement row links to the target run');
      assert.ok(!String(row.notes || '').includes('بدلاً من'), 'no roll-forward is recorded when nothing rolled');
      // The current month's rebuild must NOT pick the deduction up.
      const hrService = buildHrService(db);
      await rebuild(db, hrService, 7);
      assert.equal(await runItemNet(db, 1), 5000, 'the current month net is untouched by the target-month deduction');
      assert.equal(String((await adjustments(db))[0].status), 'pending', 'the adjustment is still pending after the current run rebuild');
      // The target month's rebuild applies it.
      await rebuild(db, hrService, 8);
      assert.equal(await runItemNet(db, 2), 4900, 'net pay is base 5000 minus the 100 shortage in the target month');
      const applied = await adjustments(db);
      assert.equal(String(applied[0].status), 'applied', 'the adjustment is applied by the target run');
      assert.equal(Number(applied[0].applied_in_run_id), 8, 'the adjustment links to the target run');
      assert.equal(Number((await settlementRow(db, 401)).payroll_run_id), 8, 'the settlement row still links to the target run after the rebuild');
    } finally {
      await db.destroy();
    }
    console.log('  (a) target-month push lands in the target run, not the current run passed');
  }

  // (b) A targetMonth whose run period already passed rolls to the
  // nearest following run, and the roll-forward is recorded.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 9, 'Rep 4');
      await seedRep(db, 4, { employee_id: 9 });
      await seedSettlement(db, 402, 4, 'cash_shortage', 100, 'pending');
      await seedRun(db, 7, -2, 1, 9);
      await seedRun(db, 8, 0, 2, 9);
      await seedRun(db, 9, 1, 3, 9);
      const service = buildVanService(db);
      const pushed = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [402], targetMonth: PAST }, adminAuth);
      assert.equal(pushed.results[0].success, true, 'the push succeeds');
      assert.equal(pushed.effectiveMonth, CUR, 'the deduction rolls to the nearest following run, the current month');
      assert.equal(pushed.effectiveRunId, 8, 'the effective run is the nearest following run, not a later one');
      assert.equal(pushed.rolledForward, true, 'the roll-forward is flagged');
      const adjs = await adjustments(db);
      assert.equal(adjs.length, 1, 'exactly one payroll adjustment');
      assert.equal(dateKey(adjs[0].date), monthStart(0), 'the adjustment is dated inside the following run period');
      const row = await settlementRow(db, 402);
      assert.equal(Number(row.payroll_run_id), 8, 'the settlement row links to the following run');
      assert.ok(String(row.notes || '').includes('بدلاً من'), 'the roll-forward is recorded in the settlement notes');
      assert.ok(String(row.notes || '').includes(PAST), 'the recorded roll-forward names the passed target month');
      // The passed run must NOT pick the deduction up.
      const hrService = buildHrService(db);
      await rebuild(db, hrService, 7);
      assert.equal(await runItemNet(db, 1), 5000, 'the passed run net is untouched');
      assert.equal(String((await adjustments(db))[0].status), 'pending', 'the adjustment is still pending after the passed run rebuild');
      // The following run applies it, and the later run does not.
      await rebuild(db, hrService, 8);
      assert.equal(await runItemNet(db, 2), 4900, 'net pay is base 5000 minus the 100 shortage in the following run');
      assert.equal(Number((await adjustments(db))[0].applied_in_run_id), 8, 'the adjustment links to the following run');
      await rebuild(db, hrService, 9);
      assert.equal(await runItemNet(db, 3), 5000, 'the later run net is untouched — no double deduction');
      assert.equal(Number((await settlementRow(db, 402)).payroll_run_id), 8, 'the settlement row still links to the following run');
    } finally {
      await db.destroy();
    }
    console.log('  (b) passed target month rolls to the nearest following run, recorded passed');
  }

  // (c) payroll_run_id is written on the settlement row when the
  // deduction is applied and reads back.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 9, 'Rep 4');
      await seedRep(db, 4, { employee_id: 9 });
      await seedSettlement(db, 403, 4, 'cash_shortage', 75, 'pending');
      assert.equal((await settlementRow(db, 403)).payroll_run_id, null, 'no run link before the push');
      await seedRun(db, 8, 1, 2, 9);
      const service = buildVanService(db);
      const pushed = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [403], targetMonth: NEXT }, adminAuth);
      assert.equal(pushed.results[0].success, true, 'the push succeeds');
      const afterPush = await settlementRow(db, 403);
      assert.equal(Number(afterPush.payroll_run_id), 8, 'the settlement row links to the targeted run at push time');
      const hrService = buildHrService(db);
      await rebuild(db, hrService, 8);
      assert.equal(await runItemNet(db, 2), 4925, 'net pay is base 5000 minus the 75 shortage');
      const applied = await adjustments(db);
      assert.equal(String(applied[0].status), 'applied', 'the deduction is applied by the run');
      assert.equal(Number(applied[0].applied_in_run_id), 8, 'the adjustment links to the applying run');
      const afterApply = await settlementRow(db, 403);
      assert.equal(Number(afterApply.payroll_run_id), 8, 'the settlement row reads back the applying run id after the deduction is applied');
    } finally {
      await db.destroy();
    }
    console.log('  (c) payroll_run_id written on application and reads back passed');
  }

  // (d) The HR rebuild marks the item applied and the link holds:
  // re-rebuilding the same run deducts exactly once and keeps the link.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 9, 'Rep 4');
      await seedRep(db, 4, { employee_id: 9 });
      await seedSettlement(db, 404, 4, 'cash_shortage', 50, 'pending');
      await seedRun(db, 8, 1, 2, 9);
      const service = buildVanService(db);
      await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [404], targetMonth: NEXT }, adminAuth);
      const hrService = buildHrService(db);
      await rebuild(db, hrService, 8);
      assert.equal(await runItemNet(db, 2), 4950, 'net pay is base 5000 minus the 50 shortage after the first rebuild');
      assert.equal(Number((await adjustments(db))[0].applied_in_run_id), 8, 'the adjustment links to the run after the first rebuild');
      assert.equal(Number((await settlementRow(db, 404)).payroll_run_id), 8, 'the settlement row links to the run after the first rebuild');
      await rebuild(db, hrService, 8);
      assert.equal(await runItemNet(db, 2), 4950, 'net pay is unchanged after re-rebuilding the same run — no double deduction');
      assert.equal((await adjustments(db)).length, 1, 'still exactly one payroll adjustment');
      assert.equal(String((await adjustments(db))[0].status), 'applied', 'the adjustment stays applied');
      assert.equal(Number((await adjustments(db))[0].applied_in_run_id), 8, 'the adjustment still links to the run');
      assert.equal(Number((await settlementRow(db, 404)).payroll_run_id), 8, 'the settlement row link holds after the re-rebuild');
    } finally {
      await db.destroy();
    }
    console.log('  (d) rebuild marks applied and the link holds across re-rebuild passed');
  }

  // (e) No run exists for the target month: the push still dates the
  // adjustment inside the target month, and the run built later
  // picks it up — with the rebuild writing the link the push could not.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 9, 'Rep 4');
      await seedRep(db, 4, { employee_id: 9 });
      await seedSettlement(db, 405, 4, 'cash_shortage', 100, 'pending');
      const service = buildVanService(db);
      const pushed = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [405], targetMonth: NEXT }, adminAuth);
      assert.equal(pushed.results[0].success, true, 'the push succeeds with no run for the month');
      assert.equal(pushed.effectiveMonth, NEXT, 'the effective month stays the target month');
      assert.equal(pushed.effectiveRunId, null, 'no run to link yet');
      assert.equal(pushed.rolledForward, false, 'nothing rolled forward');
      const adjs = await adjustments(db);
      assert.equal(adjs.length, 1, 'exactly one payroll adjustment');
      assert.equal(dateKey(adjs[0].date), monthStart(1), 'the adjustment is dated on the first day of the target month');
      assert.equal((await settlementRow(db, 405)).payroll_run_id, null, 'no run link yet — there is no run to link to');
      await seedRun(db, 8, 1, 2, 9);
      const hrService = buildHrService(db);
      await rebuild(db, hrService, 8);
      assert.equal(await runItemNet(db, 2), 4900, 'the later-built target run deducts the shortage');
      assert.equal(Number((await adjustments(db))[0].applied_in_run_id), 8, 'the adjustment links to the later-built run');
      assert.equal(Number((await settlementRow(db, 405)).payroll_run_id), 8, 'the rebuild writes the link the push could not');
    } finally {
      await db.destroy();
    }
    console.log('  (e) no-run target month falls back to the first day and the later run picks it up passed');
  }

  // Source pins: the fix names the invariant, dates the adjustment
  // inside the effective run period, and writes the run link in
  // both the push and the rebuild. (The ARCHITECTURE_INVARIANTS.md
  // entry itself is owned by the coordinator and is not pinned here.)
  {
    const vanSource = readFileSync(resolve(__dirname, '../../src/modules/delivery-reps/van-sales.service.ts'), 'utf8');
    assert.ok(vanSource.includes('INV-REP-PAYROLL-TARGET-MONTH'), 'van-sales names the invariant');
    assert.ok(vanSource.includes('date: effectiveDate'), 'the push dates the adjustment inside the effective run period');
    assert.ok(vanSource.includes('payroll_run_id: effectiveRunId'), 'the push writes the run link on the settlement row');
    assert.ok(vanSource.includes('rolledForward'), 'the push records the roll-forward');
    const hrSource = readFileSync(resolve(__dirname, '../../src/modules/hr/hr.service.ts'), 'utf8');
    assert.ok(hrSource.includes('INV-REP-PAYROLL-TARGET-MONTH'), 'hr names the invariant');
    assert.ok(hrSource.includes('vanSettlementIds'), 'the rebuild tracks van-settlement deductions');
    assert.ok(hrSource.includes('SET payroll_run_id = '), 'the rebuild writes the run link on the settlement row');
    console.log('  source pins passed');
  }

  console.log('Rep payroll target month M2 tests passed');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
