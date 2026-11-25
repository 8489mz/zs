/*
 * INV-HR-PAYROLL-BOOK-PRECISION: a KWD payroll line must sum exactly at
 * three decimals, end to end. Before this package the whole chain ran
 * in cents: the payroll engines rounded every component through
 * toFixed(2), requireStoredHrMoney threw on any third decimal, payroll
 * runs rejected KWD/OMR outright, and hr_payroll_run_items stored
 * NUMERIC(14,2) -- so a 100.125 salary was 100.13 before the run ever
 * saw it, and a 7.125-style fils remainder was silently lost per line.
 * This spec pins the worked KWD example through the production engines
 * (never a re-implemented formula) and proves migration 2040000000265
 * widens the stored columns so the computed values survive Postgres.
 */

import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, sql } from 'kysely';
import { PGliteDialect } from 'kysely-pglite-dialect';
import { Database } from '../../src/database/database.types';
import {
  calculateHrPayrollRunLine,
  requirePayrollMonetaryCurrency,
  requireStoredHrMoney,
} from '../../src/modules/hr/engines/hr-payroll-run.engine';
import {
  calculateDailyRate,
  calculateIncomeTax,
  calculateEmployeePayrollLine,
  reconcilePayrollRunJournalTotals,
} from '../../src/modules/hr/engines/payroll-calculation.engine';
import { calculateHrStatutoryAmounts } from '../../src/modules/hr/engines/hr-statutory-policy.engine';
import {
  calculateEffectiveContractPay,
  prorateMonthlyWage,
} from '../../src/modules/hr/engines/hourly-attendance-pay.engine';
import {
  calculateLoanInstallmentSchedule,
  requireLoanMoney,
  allocateLoanDeduction,
} from '../../src/modules/hr/payroll-loan-allocation.engine';
import { up as payrollPrecisionMigrationUp } from '../../src/database/migrations/2040000000265_hr_payroll_minor_unit_precision';

// Deliberately synthetic rates, NOT the legislation of Kuwait or any country.
const KWD_POLICY = {
  statutoryCountry: 'KW' as const,
  statutoryEffectiveFrom: '2026-01-01',
  statutoryReviewed: true,
  statutoryLegalReference: 'synthetic reviewed test',
  hrSocialInsuranceEnabled: true,
  hrIncomeTaxEnabled: false,
  insuranceWageBasis: 'employee_insurance_salary' as const,
  insuranceProratePartialEmployment: true,
  taxableEarningsBasis: 'gross_after_attendance_leave' as const,
  taxDeductEmployeeInsurance: true,
  insuranceConfig: { employeePct: 10, employerPct: 15, maxSalary: 10000 },
  taxPersonalExemption: 0,
  taxBrackets: [{ max: null, rate: 10 }],
};

async function main(): Promise<void> {
  // --- Gates: book precision is exact, finer fractions still throw ---
  assert.equal(requireStoredHrMoney(100.125, 3), 100.125);
  assert.throws(() => requireStoredHrMoney(100.1255, 3), /book precision/);
  assert.throws(() => requireStoredHrMoney(100.125, 2), /book precision/);
  assert.equal(requireLoanMoney(100.125, 3), 100.125);
  assert.throws(() => requireLoanMoney(100.1255, 3), /book precision/);
  assert.doesNotThrow(() => requirePayrollMonetaryCurrency('KWD', 'KWD'));
  assert.throws(() => requirePayrollMonetaryCurrency('KWD', 'EGP'), /لا تطابق/);

  // --- Daily rate: 100.125 / 30 = 3.3375 -> 3.338, hourly 0.417 ---
  const rates = calculateDailyRate({ minorUnits: 3, isHourly: false, baseSalary: 100.125, expectedDailyHours: 8 });
  assert.equal(rates.dailyRate, 3.338);
  assert.equal(rates.hourlyRate, 0.417);

  // --- Statutory amounts at 3dp: 10% of 100.125 is 10.013, 15% is 15.019 ---
  const statutory = calculateHrStatutoryAmounts(
    KWD_POLICY,
    { from: '2026-10-01', to: '2026-10-31' },
    { insured: true, taxable: false, insuranceWage: 100.125, taxableMonthlyWage: 0 },
    3,
  );
  assert.equal(statutory.employeeInsurance, 10.013);
  assert.equal(statutory.employerInsurance, 15.019);
  assert.equal(statutory.incomeTax, 0);

  // --- Income tax at 3dp: 10% of 120.13 is exactly 12.013 ---
  assert.equal(
    calculateIncomeTax({
      minorUnits: 3,
      isEnabled: true,
      hasIncomeTax: true,
      taxableIncome: 120.13,
      brackets: [{ min: 0, max: null, rate: 0.1 }],
    }),
    12.013,
  );

  // --- Full run line: gross 120.13, deductions 13.351, net 106.779 ---
  const line = calculateHrPayrollRunLine({
    minorUnits: 3,
    policy: KWD_POLICY,
    period: { from: '2026-10-01', to: '2026-10-31' },
    eligibility: { insured: true, taxable: false },
    configuredInsuranceSalary: 100.125,
    employmentMonthFraction: 1,
    line: {
      employeeId: 1,
      baseSalary: 100.125,
      allowanceAmount: 20.005,
      overtimeAmount: 0,
      commissionAmount: 0,
      attendanceDeduction: 3.338,
      leaveDeduction: 0,
      otherDeductions: 0,
      assetRecoveryDeduction: 0,
      scheduledLoanDeduction: 0,
      maxDeductionPct: 1,
    },
  });
  assert.equal(line.grossPay, 120.13);
  assert.equal(line.employeeSocialInsurance, 10.013);
  assert.equal(line.employerSocialInsurance, 15.019);
  assert.equal(line.totalDeductions, 13.351);
  assert.equal(line.netPay, 106.779);

  // --- Journal reconciliation at 3dp: a one-fils discrepancy is within tolerance ---
  const reconciled = reconcilePayrollRunJournalTotals([line], 3);
  assert.equal(reconciled.isBalanced, true);
  assert.equal(reconciled.discrepancy, 0);
  const offByOneFils = { ...line, netPay: line.netPay + 0.001 };
  const filsTolerance = reconcilePayrollRunJournalTotals([offByOneFils], 3);
  assert.equal(filsTolerance.discrepancy, 0.001);
  assert.equal(filsTolerance.isBalanced, true);

  // --- Contract proration at 3dp: a full month keeps 100.125 exactly ---
  const effective = calculateEffectiveContractPay(
    [{ id: 1, startDate: '2026-01-01', endDate: null, baseSalary: 100.125 }],
    '2026-10-01',
    '2026-10-31',
    3,
  );
  assert.equal(effective.baseWage, 100.125);
  assert.equal(effective.referenceMonthlySalary, 100.125);
  assert.equal(prorateMonthlyWage(100.125, '2026-10-01', '2026-10-10', 3), 32.298);

  // --- Loan schedule at 3dp: last installment absorbs the remainder ---
  assert.deepEqual(calculateLoanInstallmentSchedule(100.123, 3, 3).installmentValues, [33.374, 33.374, 33.375]);
  assert.deepEqual(calculateLoanInstallmentSchedule(100.125, 3, 3).installmentValues, [33.375, 33.375, 33.375]);
  const allocation = allocateLoanDeduction({
    remainingToDeduct: 33.375,
    installmentAmount: 100.125,
    installmentPaid: 66.75,
    loanRemaining: 33.375,
    loanPaid: 66.75,
    minorUnits: 3,
  })!;
  assert.equal(allocation.deductAmount, 33.375);
  assert.equal(allocation.newInstallmentPaid, 100.125);
  assert.equal(allocation.newInstallmentStatus, 'paid');

  // --- Storage: the old 2dp column rounds 100.125 to 100.13; after the
  // migration the same insert stores 100.125 and the scale is 3. ---
  const pg = new PGlite();
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  try {
    await pg.exec(`
      CREATE TABLE hr_payroll_run_items (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        net_pay NUMERIC(14,2) NOT NULL DEFAULT 0
      );
      CREATE TABLE hr_employment_contracts (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        base_salary NUMERIC(12,2) NOT NULL DEFAULT 0
      );
    `);
    await sql`INSERT INTO hr_payroll_run_items (net_pay) VALUES (100.125)`.execute(db);
    const before = await sql<{ net_pay: string }>`SELECT net_pay FROM hr_payroll_run_items`.execute(db);
    assert.equal(Number(before.rows[0].net_pay), 100.13, 'old 2dp storage rounds the fils away');
    await payrollPrecisionMigrationUp(db as never);
    const scale = await sql<{ numeric_scale: number }>`
      SELECT numeric_scale FROM information_schema.columns
      WHERE table_name = 'hr_payroll_run_items' AND column_name = 'net_pay'
    `.execute(db);
    assert.equal(Number(scale.rows[0].numeric_scale), 3);
    const contractScale = await sql<{ numeric_scale: number }>`
      SELECT numeric_scale FROM information_schema.columns
      WHERE table_name = 'hr_employment_contracts' AND column_name = 'base_salary'
    `.execute(db);
    assert.equal(Number(contractScale.rows[0].numeric_scale), 3);
    await sql`INSERT INTO hr_payroll_run_items (net_pay) VALUES (100.125)`.execute(db);
    const after = await sql<{
      net_pay: string;
    }>`SELECT net_pay FROM hr_payroll_run_items ORDER BY id DESC LIMIT 1`.execute(db);
    assert.equal(Number(after.rows[0].net_pay), 100.125, 'widened storage keeps the fils');
  } finally {
    await db.destroy();
  }
}

main().then(
  () => {
    console.log('hr-payroll-book-precision.spec: ok');
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
