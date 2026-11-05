/**
 * Canonical HR payroll line orchestration.
 *
 * All earnings and approved payroll adjustments are folded into the wage base
 * BEFORE tax/insurance are calculated. Do not use attendance preview numbers as
 * statutory withholding: those previews exclude manual adjustments.
 *
 * Does not supply legal rates: tenant reviewed effective-dated policies are required.
 */
import { calculateEmployeePayrollLine, type PayrollLineItemInput } from './payroll-calculation.engine';
import { calculateHrStatutoryAmounts, type HrStatutoryPolicy } from './hr-statutory-policy.engine';
import { MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export interface HrPayrollRunLineInput {
  /** Tenant book precision. Required: payroll money must never default to 2 decimals. */
  minorUnits: MoneyDigits;
  policy: HrStatutoryPolicy;
  period: { from: string; to: string };
  line: Omit<PayrollLineItemInput, 'employeeSocialInsurance' | 'employerSocialInsurance' | 'incomeTax' | 'minorUnits'>;
  eligibility: { insured: boolean; taxable: boolean };
  /** Employee's explicit insured salary; 0 is valid when the selected wage basis is 'earned_base'. */
  configuredInsuranceSalary: number;
  /** Fraction of the calendar month actually employed (0..1). */
  employmentMonthFraction?: number;
}

const money = (n: number, minorUnits: MoneyDigits) => roundMoney(n, minorUnits);
const nonnegative = (n: unknown, label: string, minorUnits: MoneyDigits): number => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new RangeError(`Invalid HR payroll amount: ${label}`);
  }
  return money(n, minorUnits);
};

/** All financial elements returned by the canonical line engine, including statutory amounts. */
export function calculateHrPayrollRunLine(input: HrPayrollRunLineInput) {
  const minorUnits = input.minorUnits;
  const line = input.line;
  // Never silently accept refunds or negative deductions as negative payroll
  // amounts. Refunds must be entered as explicit positive allowances.
  nonnegative(line.otherDeductions, 'otherDeductions', minorUnits);
  nonnegative(line.assetRecoveryDeduction, 'assetRecoveryDeduction', minorUnits);
  nonnegative(line.scheduledLoanDeduction, 'scheduledLoanDeduction', minorUnits);
  const ceiling = line.maxDeductionPct ?? 1;
  if (!Number.isFinite(ceiling) || ceiling < 0 || ceiling > 1) {
    throw new RangeError('Payroll deduction ceiling must be between zero and one');
  }
  const gross = money(
    nonnegative(line.baseSalary, 'baseSalary', minorUnits) +
    nonnegative(line.allowanceAmount, 'allowanceAmount', minorUnits) +
    nonnegative(line.overtimeAmount, 'overtimeAmount', minorUnits) +
    nonnegative(line.commissionAmount, 'commissionAmount', minorUnits), minorUnits,
  );
  const attendance = nonnegative(line.attendanceDeduction, 'attendanceDeduction', minorUnits);
  const unpaidLeave = nonnegative(line.leaveDeduction, 'leaveDeduction', minorUnits);
  const wageAfterAbsence = Math.max(0, money(gross - attendance - unpaidLeave, minorUnits));

  let insuranceSalary: number;
  if (input.policy.hrSocialInsuranceEnabled && input.eligibility.insured
      && input.policy.insuranceWageBasis === 'employee_insurance_salary') {
    insuranceSalary = nonnegative(input.configuredInsuranceSalary, 'configuredInsuranceSalary', minorUnits);
    if (insuranceSalary === 0) {
      throw new RangeError('أجر التأمينات الخاص بالموظف غير محدد وفق سياسة المنشأة');
    }
  } else {
    // "earned_base" means the full earnings base, not just baseSalary;
    // excluding allowances/overtime/commission silently underwithholds.
    insuranceSalary = input.policy.insuranceWageBasis === 'earned_base'
      ? wageAfterAbsence
      : nonnegative(line.baseSalary, 'baseSalary', minorUnits);
  }
  // First pass calculates insurance; second pass calculates tax against the
  // explicitly selected tax base (with or without the employee insurance share).
  const insurance = calculateHrStatutoryAmounts(
    { ...input.policy, hrIncomeTaxEnabled: false },
    input.period,
    { insured: input.eligibility.insured, taxable: false,
      insuranceWage: insuranceSalary, taxableMonthlyWage: 0,
      insurancePeriodFraction: input.policy.insuranceProratePartialEmployment
        ? (input.employmentMonthFraction ?? 1) : 1 },
    minorUnits,
  );
  const taxableBeforeInsurance = input.policy.taxableEarningsBasis === 'gross_after_attendance_leave'
    ? wageAfterAbsence : gross;
  const taxableWage = Math.max(0, money(
    taxableBeforeInsurance - (input.policy.taxDeductEmployeeInsurance ? insurance.employeeInsurance : 0), minorUnits,
  ));
  // D3 (INV-JOINER-TAX-FULL-MONTH-EQUIVALENT): tax is annualised on the
  // full-month-equivalent wage, not on prorated earnings. The statutory
  // engine annualises its input, so a partial-month employee's taxable
  // wage is grossed up by the employment fraction first. A fraction of 1,
  // absent, or outside (0, 1) leaves the wage unchanged: the guard can
  // only ever raise the tax base, never lower it, and never divides by 0.
  const employmentFraction = input.employmentMonthFraction ?? 1;
  const fullMonthEquivalentTaxableWage = employmentFraction > 0 && employmentFraction < 1
    ? money(taxableWage / employmentFraction, minorUnits)
    : taxableWage;
  const tax = calculateHrStatutoryAmounts(
    { ...input.policy, hrSocialInsuranceEnabled: false },
    input.period,
    { insured: false, taxable: input.eligibility.taxable,
      insuranceWage: 0, taxableMonthlyWage: fullMonthEquivalentTaxableWage },
    minorUnits,
  );

  return calculateEmployeePayrollLine({
    ...line,
    minorUnits,
    employeeSocialInsurance: insurance.employeeInsurance,
    employerSocialInsurance: insurance.employerInsurance,
    incomeTax: tax.incomeTax,
  });
}

/** Stored HR money must be exact at the tenant's book precision.
 * INV-HR-PAYROLL-BOOK-PRECISION: the widening migration (2040000000265)
 * stores payroll inputs at scale 3, so a 3-decimal value is exact on a
 * KWD/OMR tenant and a value with any finer fraction still throws
 * instead of being silently rounded. Callers pass the tenant's digits;
 * there is no 2-decimal default.
 */
export function requireStoredHrMoney(value: number, minorUnits: MoneyDigits): number {
  // Validate precision explicitly: toMinorUnits throws its own generic
  // error for finer fractions, which would hide this gate's contract.
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('HR monetary amount requires non-negative exact book precision');
  }
  const rounded = roundMoney(value, minorUnits);
  if (Math.abs(value - rounded) > 0.000001) {
    throw new RangeError('HR monetary amount requires non-negative exact book precision');
  }
  return rounded;
}

/** Preserve the distinction between system and user exclusions on rebuild. */
export const AUTO_PAYROLL_EXCLUSION_NOTE = 'استبعاد آلي: الموظف غير مستحق في فترة المسير';
export const MANUAL_PAYROLL_EXCLUSION_NOTE = 'استبعاد يدوي من مسؤول المرتبات';
export function canReincludeAutoExcludedPayrollItem(status: string, notes: string): boolean {
  return status === 'excluded' && notes.includes(AUTO_PAYROLL_EXCLUSION_NOTE)
    && !notes.includes(MANUAL_PAYROLL_EXCLUSION_NOTE);
}

/** A paid bank payroll must retain a bank-supplied traceable reference.
 * This checks audit completeness, not settlement confirmation from the bank.
 */
export function requireBankPayrollPaymentReference(channel: string, reference?: string | null): string {
  if (!['cash', 'bank'].includes(channel)) throw new RangeError('Invalid payroll payment channel');
  const ref = String(reference || '').trim();
  if (channel === 'bank' && (!ref || ref.length > 160)) {
    throw new RangeError('رقم مرجع التحويل البنكي مطلوب قبل تسجيل المرتبات كمدفوعة');
  }
  return ref;
}

// INV-HR-PAYROLL-BOOK-PRECISION: storage (migration 2040000000265),
// the payroll engines and GL posting all run at book precision, and the
// WPS review export formats at book precision, so KWD/OMR payroll runs
// are no longer blocked here. EOS settlements and attendance-penalty
// previews keep their own guards/precision and are separate packages.
export function requirePayrollMonetaryCurrency(tenantCurrency: string, contractCurrency: string): void {
  const tenant = String(tenantCurrency || '').trim().toUpperCase();
  const contract = String(contractCurrency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(tenant) || !/^[A-Z]{3}$/.test(contract)) {
    throw new RangeError('حدد عملة منشأة وعملة عقد صحيحتين قبل حساب المرتب');
  }
  if (tenant !== contract) {
    throw new RangeError(`عملة عقد الموظف ${contract} لا تطابق عملة المنشأة ${tenant}`);
  }
}
