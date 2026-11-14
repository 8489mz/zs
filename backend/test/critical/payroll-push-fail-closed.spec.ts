/*
 * New file: backend/test/critical/payroll-push-fail-closed.spec.ts
 *
 * WHAT THIS PINS (INV-PAYROLL-PUSH-FAIL-CLOSED): pushRepShortagesToPayroll
 * wrote amount_type 'fixed' for the payroll adjustment, a unit the HR
 * engine does not know ('money' | 'days' | 'hours' only), so building a
 * payroll run over the pushed shortage threw
 * HR_PAYROLL_DATED_ADJUSTMENT_INVALID and failed the WHOLE run build.
 * Worse, the pushed_to_payroll flip was unconditional while the
 * adjustment insert sat inside `if (resolvedEmployeeId)`, so a push
 * with no linked employee flipped the row, reported success, and wrote
 * no deduction — and the re-read refused non-pending rows, so the money
 * vanished silently with no retry.
 *
 * WHAT IS DRIVEN (real PGlite, real service methods, no mocks):
 * (a) a linked push writes amount_type 'money', and building a payroll
 *     run over it deducts the shortage from the employee's net pay
 *     (5000 - 25 = 4975) and marks the adjustment applied;
 * (b) a push with no linked employee is REFUSED with a specific
 *     message naming the missing employee link — the row stays pending
 *     and no adjustment is written;
 * (c) a pre-fix orphan (flipped to pushed_to_payroll, no adjustment) is
 *     refused while unlinked, then re-pushed successfully once the rep
 *     is linked, and a further push is refused — exactly one deduction;
 * (d) a genuinely pushed item (adjustment exists) refuses a second
 *     push with no second deduction.
 *
 * NOT DRIVEN: a live-Postgres run; true two-connection concurrency
 * (PGlite is single-connection); the frontend payroll screens
 * (untouched); live-DB counts of pre-fix rows (the live-DB tunnel is
 * closed — any data remediation needs a written decision after a live
 * count, it is not part of this fix).
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

// Local calendar parts, never UTC toISOString(): the pushed adjustment
// is dated CURRENT_DATE, so the payroll run must cover this month.
const now = new Date();
const yyyy = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, '0');
const TARGET_MONTH = `${yyyy}-${mm}`;
const LAST_DAY = new Date(yyyy, now.getMonth() + 1, 0).getDate();
const PERIOD_FROM = `${TARGET_MONTH}-01`;
const PERIOD_TO = `${TARGET_MONTH}-${String(LAST_DAY).padStart(2, '0')}`;

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
    CREATE TABLE van_rep_financial_settlements (id bigserial PRIMARY KEY, tenant_id text, account_id text, rep_id bigint, trip_id bigint, entry_type text, amount numeric DEFAULT 0, status text, notes text, settled_at timestamptz, settled_by bigint, settlement_method text, receipt_voucher_no text, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW());
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

async function adjustments(db: Kysely<Database>): Promise<any[]> {
  return (db as any).selectFrom('hr_employee_adjustments').selectAll().execute();
}

async function settlementStatus(db: Kysely<Database>, id: number): Promise<string> {
  const row = await (db as any).selectFrom('van_rep_financial_settlements').select('status').where('id', '=', id).executeTakeFirst();
  return String(row?.status || '');
}

async function seedDraftRun(db: Kysely<Database>, employeeId: number): Promise<void> {
  await (db as any).insertInto('settings').values({ tenant_id: TENANT, key: 'currency', value: 'EGP' }).execute();
  await (db as any).insertInto('hr_payroll_runs').values({
    id: 7, tenant_id: TENANT, account_id: ACCOUNT, period_month: TARGET_MONTH,
    start_date: PERIOD_FROM, end_date: PERIOD_TO, pay_frequency: 'monthly', status: 'draft',
  }).execute();
  await (db as any).insertInto('hr_payroll_run_items').values({
    id: 1, tenant_id: TENANT, account_id: ACCOUNT, run_id: 7, employee_id: employeeId, contract_id: employeeId,
    base_salary: 0, allowance_amount: 0, deduction_amount: 0, loan_deduction_amount: 0,
    asset_recovery_deduction_amount: 0, employee_social_insurance: 0, employer_social_insurance: 0,
    income_tax: 0, penalty_deduction: 0, carried_forward_deduction: 0, gross_pay: 0, net_pay: 0,
    status: 'draft', notes: '', paid_at: null, paid_by: null, payment_channel: null,
    journal_entry_id: null,
  }).execute();
}

async function main(): Promise<void> {
  // (a) Linked push writes amount_type 'money' and the payroll run
  // build deducts the shortage from net pay.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 9, 'Rep 4');
      await seedRep(db, 4, { employee_id: 9 });
      await seedSettlement(db, 401, 4, 'cash_shortage', 25, 'pending');
      await seedDraftRun(db, 9);
      const service = buildVanService(db);
      const pushed = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [401], targetMonth: TARGET_MONTH }, adminAuth);
      assert.equal(pushed.results[0].success, true, 'the linked push succeeds');
      assert.equal(pushed.processedCount, 1, 'one item processed');
      assert.equal(await settlementStatus(db, 401), 'pushed_to_payroll', 'the item is pushed');
      const adjs = await adjustments(db);
      assert.equal(adjs.length, 1, 'exactly one payroll adjustment');
      assert.equal(String(adjs[0].amount_type), 'money', 'the adjustment unit is money, not fixed');
      assert.equal(Number(adjs[0].amount), 25, 'the adjustment is the shortage amount');
      assert.equal(String(adjs[0].adjustment_type), 'deduction', 'a shortage is a deduction');
      assert.equal(String(adjs[0].source_type), 'van_sales_settlement', 'the adjustment traces to the settlement');
      assert.equal(String(adjs[0].source_id), '401', 'the adjustment traces to the settlement id');
      assert.equal(String(adjs[0].status), 'pending', 'the adjustment waits for the run');
      // Build the payroll run over the pushed adjustment: with the old
      // 'fixed' unit this throws HR_PAYROLL_DATED_ADJUSTMENT_INVALID
      // and fails the whole run build.
      const hrService = buildHrService(db);
      await (hrService as unknown as { rebuildPayrollRunItems: (db: unknown, runId: number, itemStatus: string, tenantId: string) => Promise<void> })
        .rebuildPayrollRunItems(db, 7, 'draft', TENANT);
      const item = await (db as any).selectFrom('hr_payroll_run_items').selectAll().where('id', '=', 1).executeTakeFirst();
      assert.equal(Number(item.net_pay), 4975, 'net pay is base 5000 minus the 25 shortage');
      const applied = await adjustments(db);
      assert.equal(String(applied[0].status), 'applied', 'the adjustment is applied by the run');
      assert.equal(Number(applied[0].applied_in_run_id), 7, 'the adjustment links to the run');
    } finally {
      await db.destroy();
    }
    console.log('  (a) linked push writes money and the run deducts it passed');
  }

  // (b) Push with no linked employee is refused — fail closed.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 10, 'Someone Else');
      await seedRep(db, 5, { name: 'Rep NoEmp' });
      await seedSettlement(db, 402, 5, 'cash_shortage', 40, 'pending');
      const service = buildVanService(db);
      const pushed = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [402], targetMonth: TARGET_MONTH }, adminAuth);
      assert.equal(pushed.results[0].success, false, 'the unlinked push is refused');
      assert.match(String(pushed.results[0].message), /غير مرتبط بموظف/, 'the refusal names the missing employee link');
      assert.equal(pushed.processedCount, 0, 'nothing processed');
      assert.equal(await settlementStatus(db, 402), 'pending', 'the row stays pending for a later retry');
      assert.equal((await adjustments(db)).length, 0, 'no deduction is written');
    } finally {
      await db.destroy();
    }
    console.log('  (b) unlinked push refused with the row left pending passed');
  }

  // (c) A pre-fix orphan (flipped, no adjustment) is refused while
  // unlinked, re-pushed once linked, and never double-deducted.
  {
    const { db } = await makeDb();
    try {
      await seedRep(db, 6, { name: 'Rep 6' });
      await seedSettlement(db, 403, 6, 'stock_shortage', 60, 'pushed_to_payroll', 'shortage | تم ترحيل العجز (قيد انتظار ربط الموظف)');
      const service = buildVanService(db);
      const first = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [403], targetMonth: TARGET_MONTH }, adminAuth);
      assert.equal(first.results[0].success, false, 'the orphan re-push is refused while unlinked');
      assert.match(String(first.results[0].message), /غير مرتبط بموظف/, 'the refusal names the missing employee link');
      assert.equal(await settlementStatus(db, 403), 'pushed_to_payroll', 'the orphan row keeps its flipped status');
      assert.equal((await adjustments(db)).length, 0, 'still no deduction');
      await seedEmployee(db, 11, 'Rep 6');
      await (db as any).updateTable('delivery_representatives').set({ employee_id: 11 }).where('id', '=', 6).execute();
      const second = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [403], targetMonth: TARGET_MONTH }, adminAuth);
      assert.equal(second.results[0].success, true, 'the re-push succeeds once the rep is linked');
      assert.match(String(second.results[0].message), /أعيد الترحيل/, 'the re-push says it is a retry');
      const adjs = await adjustments(db);
      assert.equal(adjs.length, 1, 'exactly one payroll adjustment after the re-push');
      assert.equal(String(adjs[0].amount_type), 'money', 'the re-pushed adjustment unit is money');
      assert.equal(Number(adjs[0].amount), 60, 'the re-pushed adjustment is the shortage amount');
      const third = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [403], targetMonth: TARGET_MONTH }, adminAuth);
      assert.equal(third.results[0].success, false, 'a third push is refused');
      assert.equal((await adjustments(db)).length, 1, 'still exactly one payroll adjustment');
    } finally {
      await db.destroy();
    }
    console.log('  (c) orphan re-push after linking, no double deduction passed');
  }

  // (d) A genuinely pushed item refuses a second push.
  {
    const { db } = await makeDb();
    try {
      await seedEmployee(db, 9, 'Rep 4');
      await seedRep(db, 4, { employee_id: 9 });
      await seedSettlement(db, 404, 4, 'cash_shortage', 25, 'pending');
      const service = buildVanService(db);
      const first = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [404], targetMonth: TARGET_MONTH }, adminAuth);
      assert.equal(first.results[0].success, true, 'the first push succeeds');
      const second = await service.pushRepShortagesToPayroll(TENANT, ACCOUNT, { settlementIds: [404], targetMonth: TARGET_MONTH }, adminAuth);
      assert.equal(second.results[0].success, false, 'the second push reports failure');
      assert.equal(second.processedCount, 0, 'nothing processed the second time');
      assert.equal((await adjustments(db)).length, 1, 'still exactly one payroll adjustment');
    } finally {
      await db.destroy();
    }
    console.log('  (d) double push of a genuinely pushed item refused passed');
  }

  // Source pins: the fix names the invariant, writes 'money', and no
  // longer writes the illegal 'fixed' unit in this service. (The
  // ARCHITECTURE_INVARIANTS.md entry itself is owned by the
  // coordinator and is not pinned here.)
  {
    const vanSource = readFileSync(resolve(__dirname, '../../src/modules/delivery-reps/services/van-rep-financial-ledger.service.ts'), 'utf8');
    assert.ok(vanSource.includes('INV-PAYROLL-PUSH-FAIL-CLOSED'), 'van-sales names the invariant');
    assert.ok(vanSource.includes("amount_type: 'money'"), 'the push writes the money unit');
    assert.ok(!vanSource.includes("amount_type: 'fixed'"), 'the push no longer writes the fixed unit');
    assert.ok(vanSource.includes('غير مرتبط بموظف'), 'the refusal names the missing employee link');
    console.log('  source pins passed');
  }

  console.log('Payroll push fail-closed tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
