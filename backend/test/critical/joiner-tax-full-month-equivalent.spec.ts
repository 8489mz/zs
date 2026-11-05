/*
 * Joiner tax on the full-month-equivalent wage (D3): the statutory engine
 * annualises its input, so a partial-month employee's taxable wage must be
 * grossed up by the employment fraction before tax is computed — never
 * annualised on prorated earnings. INV-JOINER-TAX-FULL-MONTH-EQUIVALENT.
 *
 * Bar (proof fixture, verbatim): fraction 0.5, wage 5,000, exemption 0,
 * flat 10% -> tax 1,000 (not 500). Controls: fraction 1 or omitted -> 500;
 * fraction 0.5 with a 5,000 absence deduction on a 10,000 salary -> 1,000;
 * fraction 0 -> unchanged (500, no division by zero).
 * Run: npx ts-node test/critical/joiner-tax-full-month-equivalent.spec.ts (from backend/).
 */

import { strict as assert } from 'node:assert';
import { calculateHrPayrollRunLine, type HrPayrollRunLineInput } from '../../src/modules/hr/engines/hr-payroll-run.engine';

const base: HrPayrollRunLineInput = {
  minorUnits: 2,
  policy: {
    hrSocialInsuranceEnabled: false, hrIncomeTaxEnabled: true,
    statutoryCountry: 'EG', statutoryEffectiveFrom: '2026-01-01',
    statutoryLegalReference: 'test', statutoryReviewed: true,
    taxPersonalExemption: 0, taxableEarningsBasis: 'gross',
    taxDeductEmployeeInsurance: false,
    taxBrackets: [{ max: null, rate: 10 }],
  },
  period: { from: '2026-03-01', to: '2026-03-31' },
  line: {
    employeeId: 1, baseSalary: 5000, allowanceAmount: 0, overtimeAmount: 0,
    commissionAmount: 0, scheduledLoanDeduction: 0, attendanceDeduction: 0,
    leaveDeduction: 0, assetRecoveryDeduction: 0, otherDeductions: 0,
  },
  eligibility: { insured: false, taxable: true },
  configuredInsuranceSalary: 0, employmentMonthFraction: 0.5,
};

function main(): void {
  const joiner = calculateHrPayrollRunLine(base);
  assert.equal(joiner.incomeTax, 1000, 'D3 bar: fraction 0.5, wage 5000 -> tax 1000');

  const fullMonth = calculateHrPayrollRunLine({ ...base, employmentMonthFraction: 1 });
  assert.equal(fullMonth.incomeTax, 500, 'fraction 1 unchanged: tax 500');

  const omitted = calculateHrPayrollRunLine({ ...base, employmentMonthFraction: undefined });
  assert.equal(omitted.incomeTax, 500, 'fraction omitted unchanged: tax 500');

  const absentJoiner = calculateHrPayrollRunLine({
    ...base,
    policy: { ...base.policy, taxableEarningsBasis: 'gross_after_attendance_leave' },
    line: { ...base.line, baseSalary: 10000, attendanceDeduction: 5000 },
  });
  assert.equal(absentJoiner.incomeTax, 1000, 'fraction 0.5, 10000 salary less 5000 absence -> tax 1000');

  const zeroFraction = calculateHrPayrollRunLine({ ...base, employmentMonthFraction: 0 });
  assert.equal(zeroFraction.incomeTax, 500, 'fraction 0: no gross-up, no crash, tax 500');

  console.log('joiner-tax-full-month-equivalent.spec: ok (1000 / 500 / 500 / 1000 / 500)');
}

main();
