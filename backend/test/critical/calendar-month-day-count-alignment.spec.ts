/*
New file: backend/test/critical/calendar-month-day-count-alignment.spec.ts
Pins the single calendar-month day-count basis (INV-CALENDAR-MONTH-DAY-COUNT-ALIGNMENT, D4).

THE GAP: daily wages were divided by a fixed 30 everywhere — a February day
on 28,000 paid 933.33 instead of 1,000, historical overtime paid 350 instead
of 375, the EOS custom gratuity defaulted to 25,200 instead of 27,000, and the
penalty preview rounded at a silent 2dp. Every live path now divides by the
days of the incident's own calendar month, and preview money rounds at the
tenant's book digits.

WHAT THIS PINS (Part A — pure engines):
- Dated payroll adjustment: one February day on 28,000 = 1,000; one
  October day on 31,000 = 1,000 (31-day control).
- Historical overtime: 120 minutes in February on 28,000 at 1.5x = 375;
  October control on 31,000 = 37.50.
- EOS custom gratuity: 21 days/year x 4 years at 9000/28 = 27,000; a
  missing/zero daily wage throws (no silent /30 fallback); saudi law
  ignores the wage and is unaffected by the guard.
- Penalty preview: absent in February on 9,000 = 321.43 (2dp); April at
  3dp on 3,003.75 = 100.125 (digits preserved); February at 3dp =
  107.277; progressive first late incident = 80.36; hourly staff keep
  the hour-based rate; a malformed reference date throws.
- Fraction helper (O1): a full February and a full March both read
  exactly 1; a 10-day March slice reads 0.322580645 (9dp).
- daysInCalendarMonth: Feb 2026 = 28, Feb 2024 (leap) = 29, April = 30.
- Withdrawal daily preview: one present day in February on 28,000 =
  1,000 (not 933.33); April control on 31,000 = 1,033.33.

WHAT THIS PINS (Part B — rebuild review path, PGlite):
- The payroll rebuild's operational review prices one absent day in
  February on 28,000 at 1,000 and one absent day in October on 31,000
  at 1,000, written into the item's penalty_deduction (under /30 the
  values would be 933.33 and 1,033.33).
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
import {
  calculateDatedPayrollAdjustment,
  calculateHistoricalOvertimePay,
  payrollCalendarMonthFraction,
  daysInCalendarMonth,
} from '../../src/modules/hr/engines/hourly-attendance-pay.engine';
import { calculateGratuity } from '../../src/modules/hr/engines/eos-calculation.engine';
import { calculateAttendancePenalty } from '../../src/modules/hr/engines/attendance-penalty.engine';
import { calculateEmployeeWithdrawalBalance } from '../../src/modules/hr/engines/employee-withdrawal-balance.engine';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`HARNESS_TIMEOUT: ${label} did not return within ${ms}ms`)), ms)),
  ]);
}

function partA(): void {
  // Dated adjustment: February day on 28,000 (proof fixture verbatim).
  const febContract = [{ id: 1, startDate: '2026-01-01', endDate: null, baseSalary: 28000 }];
  const octContract = [{ id: 1, startDate: '2026-01-01', endDate: null, baseSalary: 31000 }];
  assert.equal(
    calculateDatedPayrollAdjustment({ minorUnits: 2, amount: 1, amountType: 'days', date: '2026-02-10', period: { from: '2026-02-01', to: '2026-02-28' }, contracts: febContract, isHourly: false, hourlyRate: 0, expectedDailyHours: 8 }),
    1000,
    'one February day on 28000 = 1000 (not 933.33)',
  );
  assert.equal(
    calculateDatedPayrollAdjustment({ minorUnits: 2, amount: 1, amountType: 'days', date: '2026-10-10', period: { from: '2026-10-01', to: '2026-10-31' }, contracts: octContract, isHourly: false, hourlyRate: 0, expectedDailyHours: 8 }),
    1000,
    'one October day on 31000 = 1000 (31-day control)',
  );

  // Historical overtime: February (proof fixture verbatim) + October control.
  assert.equal(
    calculateHistoricalOvertimePay([{ date: '2026-02-10', minutes: 120 }], febContract, 8, 1.5, 2),
    375,
    '120 overtime minutes in February on 28000 at 1.5x = 375 (not 350)',
  );
  const octLowContract = [{ id: 1, startDate: '2026-01-01', endDate: null, baseSalary: 6200 }];
  assert.equal(
    calculateHistoricalOvertimePay([{ date: '2026-10-10', minutes: 120 }], octLowContract, 8, 1.5, 2),
    75,
    '120 overtime minutes in October on 6200 at 1.5x = 75 (not 77.50)',
  );

  // EOS custom gratuity: caller-supplied daily wage at the calendar-month basis.
  assert.equal(
    calculateGratuity({ lawType: 'custom', serviceYearsDecimal: 4, totalSalary: 9000, dailyWage: 9000 / 28, customGratuityDaysPerYear: 21, reason: 'resignation', minorUnits: 2 }).gratuityAmount,
    27000,
    'custom gratuity 21 days/year x 4 years at 9000/28 = 27000 (not 25200)',
  );
  assert.throws(
    () => calculateGratuity({ lawType: 'custom', serviceYearsDecimal: 4, totalSalary: 9000, dailyWage: 0, customGratuityDaysPerYear: 21, reason: 'resignation', minorUnits: 2 }),
    RangeError,
    'custom gratuity without a positive daily wage throws (no silent /30 fallback)',
  );
  assert.equal(
    calculateGratuity({ lawType: 'saudi', serviceYearsDecimal: 3, totalSalary: 100000, dailyWage: 0, reason: 'resignation', minorUnits: 2 }).gratuityAmount,
    50000,
    'saudi law ignores the daily wage: 3 years resignation on 100000 = 50000',
  );

  // Penalty preview: calendar-month rate + book digits.
  const febAbsent = calculateAttendancePenalty({ exceptionType: 'absent', durationMinutes: 0, baseSalary: 9000, expectedDailyHours: 8, compensationType: 'monthly', hourlyRate: 0, delayPolicy: 'inherit', referenceDate: '2026-02-10', minorUnits: 2 });
  assert.equal(febAbsent.estimatedAmount, 321.43, 'February absent on 9000 = 321.43 (not 300)');
  assert.equal(febAbsent.dailyRate, 321.43, 'February daily rate 321.43');
  const aprAbsent3dp = calculateAttendancePenalty({ exceptionType: 'absent', durationMinutes: 0, baseSalary: 3003.75, expectedDailyHours: 8, compensationType: 'monthly', hourlyRate: 0, delayPolicy: 'inherit', referenceDate: '2026-04-10', minorUnits: 3 });
  assert.equal(aprAbsent3dp.estimatedAmount, 100.125, 'April absent at 3dp on 3003.75 = 100.125 (digits preserved)');
  const febAbsent3dp = calculateAttendancePenalty({ exceptionType: 'absent', durationMinutes: 0, baseSalary: 3003.75, expectedDailyHours: 8, compensationType: 'monthly', hourlyRate: 0, delayPolicy: 'inherit', referenceDate: '2026-02-10', minorUnits: 3 });
  assert.equal(febAbsent3dp.estimatedAmount, 107.277, 'February absent at 3dp on 3003.75 = 107.277');
  const progressive = calculateAttendancePenalty({ exceptionType: 'late_check_in', durationMinutes: 30, baseSalary: 9000, expectedDailyHours: 8, compensationType: 'monthly', hourlyRate: 0, delayPolicy: 'inherit', globalDelayPolicyEnabled: true, globalFirstTimeDeduction: 0.25, referenceDate: '2026-02-10', minorUnits: 2 });
  assert.equal(progressive.estimatedAmount, 80.36, 'progressive first late incident in February = 80.36 (9000/28 x 0.25)');
  const hourly = calculateAttendancePenalty({ exceptionType: 'absent', durationMinutes: 0, baseSalary: 0, expectedDailyHours: 8, compensationType: 'hourly', hourlyRate: 50, delayPolicy: 'inherit', referenceDate: '2026-02-10', minorUnits: 2 });
  assert.equal(hourly.dailyRate, 400, 'hourly daily rate stays hour-based (50 x 8)');
  assert.equal(hourly.estimatedAmount, 400, 'hourly absent = 400');
  assert.throws(
    () => calculateAttendancePenalty({ exceptionType: 'absent', durationMinutes: 0, baseSalary: 9000, expectedDailyHours: 8, compensationType: 'monthly', hourlyRate: 0, delayPolicy: 'inherit', referenceDate: 'not-a-date', minorUnits: 2 }),
    RangeError,
    'malformed reference date throws',
  );

  // Fraction helper (O1): full months read exactly 1.
  assert.equal(payrollCalendarMonthFraction('2026-02-01', '2026-02-28'), 1, 'full February fraction is exactly 1');
  assert.equal(payrollCalendarMonthFraction('2026-03-01', '2026-03-31'), 1, 'full March fraction is exactly 1');
  assert.equal(payrollCalendarMonthFraction('2026-03-01', '2026-03-10'), 0.322580645, '10 March days = 0.322580645 (9dp)');
  assert.equal(payrollCalendarMonthFraction('2026-09-01', '2026-10-31'), 2, 'September + October = 2');

  // daysInCalendarMonth.
  assert.equal(daysInCalendarMonth('2026-02-10'), 28, 'Feb 2026 has 28 days');
  assert.equal(daysInCalendarMonth('2024-02-10'), 29, 'Feb 2024 (leap) has 29 days');
  assert.equal(daysInCalendarMonth('2026-04-10'), 30, 'April has 30 days');
  assert.throws(() => daysInCalendarMonth('2026-13-01'), RangeError, 'month 13 throws');

  // Withdrawal daily preview: February day on 28,000 = 1,000.
  const febDaily = calculateEmployeeWithdrawalBalance({
    employee: { id: 1, displayName: 'Feb', compensationType: 'monthly' as const, payFrequency: 'daily' as const, hourlyRate: 0, expectedDailyHours: 8, status: 'active' },
    contract: { baseSalary: 28000, currency: 'EGP' },
    currentCycle: { cycleStart: '2026-02-01', cycleEnd: '2026-02-28', daysElapsed: 10 },
    punches: [{ status: 'present' } as never],
    priorLoans: [], unpaidApprovedPayrollItems: [],
    todayDate: '2026-02-10', minorUnits: 2 as const,
  });
  assert.equal(febDaily.accrual.accruedEarnings, 1000, 'February daily preview on 28000 = 1000 (not 933.33)');
  const aprDaily = calculateEmployeeWithdrawalBalance({
    employee: { id: 2, displayName: 'Apr', compensationType: 'monthly' as const, payFrequency: 'daily' as const, hourlyRate: 0, expectedDailyHours: 8, status: 'active' },
    contract: { baseSalary: 31000, currency: 'EGP' },
    currentCycle: { cycleStart: '2026-04-01', cycleEnd: '2026-04-30', daysElapsed: 10 },
    punches: [{ status: 'present' } as never],
    priorLoans: [], unpaidApprovedPayrollItems: [],
    todayDate: '2026-04-10', minorUnits: 2 as const,
  });
  assert.equal(aprDaily.accrual.accruedEarnings, 1033.33, 'April daily preview on 31000 = 1033.33');
}

async function rebuildCase(periodMonth: string, from: string, to: string, salary: number, absentDate: string): Promise<number> {
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  const service = new HrService(
    db,
    new TransactionHelper(),
    { log: async () => ({}) } as never,
    {} as never,
    {} as never,
    undefined,
  );
  try {
    await pg.exec(`
      CREATE TABLE settings (tenant_id text, key text, value text);
      CREATE TABLE hr_hr_settings (id bigint PRIMARY KEY, tenant_id text, key text, value text);
      CREATE TABLE hr_employees (id bigint PRIMARY KEY, tenant_id text, display_name text, status text, compensation_type text, hourly_rate numeric, expected_daily_hours numeric, hire_date date, end_of_service_date date, has_social_insurance boolean, insurance_salary numeric, has_income_tax boolean, pay_frequency text, user_id bigint, commission_type text, commission_value numeric, commission_target numeric, delay_policy text, approved_leave_days numeric);
      CREATE TABLE hr_employment_contracts (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, base_salary numeric, currency text, status text, start_date date, end_date date);
      CREATE TABLE hr_compensation_packages (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, allowance_amount numeric, deduction_amount numeric, effective_from date, effective_to date);
      CREATE TABLE hr_employee_adjustments (id bigint PRIMARY KEY, tenant_id text, employee_id bigint, run_id bigint, item_id bigint, status text, applied_in_run_id bigint, amount numeric, date date, adjustment_type text, amount_type text, accounting_category text);
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
      INSERT INTO hr_employees VALUES (1,'t1','Case Emp','active','monthly',0,8, '2026-01-01',NULL,false,0,false,'monthly',NULL,NULL,0,NULL,NULL,0);
      INSERT INTO hr_employment_contracts VALUES (1,'t1',1,${salary},'EGP','active','2026-01-01',NULL);
      INSERT INTO hr_payroll_runs VALUES (7,'t1','a1','${periodMonth}','${from}','${to}','monthly','draft',NOW());
      INSERT INTO hr_payroll_run_items (id, tenant_id, account_id, run_id, employee_id, contract_id, base_salary, allowance_amount, deduction_amount, loan_deduction_amount, asset_recovery_deduction_amount, employee_social_insurance, employer_social_insurance, income_tax, penalty_deduction, carried_forward_deduction, gross_pay, net_pay, status, notes, paid_at, paid_by, payment_channel, journal_entry_id, updated_at)
        VALUES (1,'t1','a1',7,1,1,0,0,0,0,0,0,0,0,0,0,0,0,'draft','',NULL,NULL,NULL,NULL,NOW());
      INSERT INTO hr_attendance_records VALUES (1,'t1',1,'${absentDate}','absent',NULL,NULL,0);
    `);

    const rebuild = service as unknown as { rebuildPayrollRunItems: (db: unknown, runId: number, itemStatus: string, tenantId: string) => Promise<void> };
    await withTimeout(rebuild.rebuildPayrollRunItems(db, 7, 'draft', 't1'), 25000, `${periodMonth} rebuild`);

    const item = await pg.query<{ penalty_deduction: string; status: string }>(
      'SELECT penalty_deduction::text, status FROM hr_payroll_run_items WHERE id=1',
    );
    assert.equal(item.rows[0].status, 'draft', `${periodMonth} item stays draft`);
    return Number(item.rows[0].penalty_deduction);
  } finally {
    await db.destroy();
  }
}

async function partB(): Promise<void> {
  assert.equal(
    await rebuildCase('2026-02', '2026-02-01', '2026-02-28', 28000, '2026-02-10'),
    1000,
    'February review prices one absent day at 28000/28 = 1000 (not 933.33)',
  );
  assert.equal(
    await rebuildCase('2026-10', '2026-10-01', '2026-10-31', 31000, '2026-10-12'),
    1000,
    'October review prices one absent day at 31000/31 = 1000 (not 1033.33)',
  );
}

async function main(): Promise<void> {
  partA();
  await partB();
  console.log('Calendar-month day-count alignment tests passed.');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
