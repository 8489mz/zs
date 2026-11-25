import { strict as assert } from 'node:assert';
import {
  calculateHrPayrollRunLine,
  requirePayrollMonetaryCurrency,
  requireStoredHrMoney,
  requireBankPayrollPaymentReference,
  canReincludeAutoExcludedPayrollItem,
  AUTO_PAYROLL_EXCLUSION_NOTE,
  MANUAL_PAYROLL_EXCLUSION_NOTE,
  type HrPayrollRunLineInput,
} from '../../src/modules/hr/engines/hr-payroll-run.engine';

// No financial record may be silently rounded on salary contract storage.
assert.equal(requireStoredHrMoney(0, 2), 0);
assert.equal(requireStoredHrMoney(1250.45, 2), 1250.45);
assert.throws(() => requireStoredHrMoney(1250.456, 2), /book precision/);
assert.throws(() => requireStoredHrMoney(-1, 2), /book precision/);
assert.throws(() => requireStoredHrMoney(Number.POSITIVE_INFINITY, 2), /book precision/);

assert.equal(canReincludeAutoExcludedPayrollItem('excluded', AUTO_PAYROLL_EXCLUSION_NOTE), true);
assert.equal(
  canReincludeAutoExcludedPayrollItem('excluded', AUTO_PAYROLL_EXCLUSION_NOTE + ' | ' + MANUAL_PAYROLL_EXCLUSION_NOTE),
  false,
);
assert.equal(canReincludeAutoExcludedPayrollItem('excluded', 'manual exclusion'), false);
assert.equal(canReincludeAutoExcludedPayrollItem('reviewed', AUTO_PAYROLL_EXCLUSION_NOTE), false);

assert.throws(() => requireBankPayrollPaymentReference('bank', ''), /مرجع/);
assert.equal(requireBankPayrollPaymentReference('bank', ' TX-42 '), 'TX-42');
assert.equal(requireBankPayrollPaymentReference('cash', ''), '');
assert.throws(() => requireBankPayrollPaymentReference('other', 'x'), /Invalid/);

// Deliberately synthetic rates, NOT the legislation of Egypt or any GCC country.
const base: HrPayrollRunLineInput = {
  minorUnits: 2,
  period: { from: '2026-10-01', to: '2026-10-31' },
  policy: {
    statutoryCountry: 'EG',
    statutoryEffectiveFrom: '2026-01-01',
    statutoryReviewed: true,
    statutoryLegalReference: 'synthetic reviewed test',
    hrSocialInsuranceEnabled: true,
    hrIncomeTaxEnabled: true,
    insuranceWageBasis: 'employee_insurance_salary',
    insuranceProratePartialEmployment: true,
    taxableEarningsBasis: 'gross_after_attendance_leave',
    taxDeductEmployeeInsurance: true,
    insuranceConfig: { employeePct: 10, employerPct: 15, maxSalary: 10000 },
    taxPersonalExemption: 0,
    taxBrackets: [{ max: null, rate: 10 }],
  },
  eligibility: { insured: true, taxable: true },
  configuredInsuranceSalary: 8000,
  employmentMonthFraction: 1,
  line: {
    employeeId: 10,
    baseSalary: 10000,
    allowanceAmount: 1500,
    overtimeAmount: 500,
    commissionAmount: 0,
    attendanceDeduction: 1000,
    leaveDeduction: 0,
    otherDeductions: 0,
    assetRecoveryDeduction: 0,
    scheduledLoanDeduction: 2000,
    maxDeductionPct: 1,
  },
};
assert.doesNotThrow(() => requirePayrollMonetaryCurrency('EGP', 'EGP'));
assert.throws(() => requirePayrollMonetaryCurrency('EGP', 'SAR'), /لا تطابق/);
assert.doesNotThrow(() => requirePayrollMonetaryCurrency('KWD', 'KWD')); // INV-HR-PAYROLL-BOOK-PRECISION: KWD runs are enabled by storage + engines
assert.doesNotThrow(() => requirePayrollMonetaryCurrency('OMR', 'OMR'));
const result = calculateHrPayrollRunLine(base);
assert.equal(result.grossPay, 12000);
assert.equal(result.employeeSocialInsurance, 800);
assert.equal(result.employerSocialInsurance, 1200);
assert.equal(result.incomeTax, 1020); // 12k - 1k absence - 800 insurance
assert.equal(result.appliedLoanDeduction, 2000);
assert.equal(result.netPay, 7180);
assert.equal(result.totalDeductions, 4820);

// Full earned-wage insurance basis includes approved overtime/allowances
// and subtracts unpaid time, rather than silently using base pay only.
const earnedInsurance = calculateHrPayrollRunLine({
  ...base,
  policy: {
    ...base.policy,
    hrIncomeTaxEnabled: false,
    insuranceWageBasis: 'earned_base',
    insuranceConfig: { employeePct: 10, employerPct: 15 },
  },
  line: { ...base.line, attendanceDeduction: 1000, leaveDeduction: 500 },
});
assert.equal(earnedInsurance.employeeSocialInsurance, 1050);
assert.equal(earnedInsurance.employerSocialInsurance, 1575);

const addedAllowance = calculateHrPayrollRunLine({
  ...base,
  line: {
    ...base.line,
    allowanceAmount: 2500,
  },
});
assert.equal(addedAllowance.incomeTax, 1120); // Manual approved earnings increase tax
assert.equal(addedAllowance.netPay, 8080);

const noInsurance = calculateHrPayrollRunLine({
  ...base,
  policy: { ...base.policy, hrSocialInsuranceEnabled: false },
  eligibility: { insured: false, taxable: true },
});
assert.equal(noInsurance.employeeSocialInsurance, 0);
assert.equal(noInsurance.incomeTax, 1100);
assert.throws(() => calculateHrPayrollRunLine({ ...base, line: { ...base.line, otherDeductions: -10 } }), /Invalid/);
assert.throws(() => calculateHrPayrollRunLine({ ...base, configuredInsuranceSalary: 0 }), /أجر التأمينات/);
assert.throws(
  () => calculateHrPayrollRunLine({ ...base, period: { from: '2026-10-15', to: '2026-10-31' } }),
  /شهرًا ميلاديًا كاملًا/,
);

// A partial employee in a full-month payroll uses proportionally scaled
// insurance floor/cap. These values are synthetic, not national rates.
const partial = calculateHrPayrollRunLine({
  ...base,
  employmentMonthFraction: 0.5,
  configuredInsuranceSalary: 4000,
  policy: {
    ...base.policy,
    hrIncomeTaxEnabled: false,
    insuranceConfig: { employeePct: 10, employerPct: 15, minSalary: 5000, maxSalary: 6000 },
  },
});
assert.equal(partial.employeeSocialInsurance, 300);
assert.equal(partial.employerSocialInsurance, 450);
