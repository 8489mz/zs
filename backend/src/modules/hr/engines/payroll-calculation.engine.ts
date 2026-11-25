/**
 * Pure Payroll Calculation & Double-Entry Ledger Reconciliation Engine
 *
 * Implements:
 * 1. Daily & Hourly Rate derivations.
 * 2. Overtime calculation with standard statutory premiums (e.g., 1.5x).
 * 3. Progressive Lateness & Attendance Penalty evaluations.
 * 4. Dual-sided Social Insurance calculation (Employee Withholding + Employer Expense Contribution).
 * 5. Progressive Income Tax Bracket evaluation.
 * 6. Deduction Priority, Statutory Labor Law Ceiling (50% rule), and Carried-Forward Shortfall tracking.
 * 7. Inviolable Double-Entry Journal Reconciliation: Debit (Expenses) == Credit (Liabilities + Contra-Assets).
 *
 * Rule 13 (AGENTS.md):
 * Must be pure functions without database or external state side-effects.
 * Tested via executable unit tests in backend/test/critical.
 */

import { MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export interface DailyRateParams {
  minorUnits: MoneyDigits;
  baseSalary?: number;
  allowanceAmount?: number;
  isHourly?: boolean;
  hourlyRate?: number;
  expectedDailyHours?: number;
  basisDays?: number; // 30 by default
}

export interface OvertimeParams {
  minorUnits: MoneyDigits;
  calculatedHourlyRate: number;
  overtimeMinutes: number;
  overtimeMultiplier?: number; // default 1.5
}

export interface ProgressiveDelayParams {
  minorUnits: MoneyDigits;
  dailyRate: number;
  calculatedHourlyRate: number;
  totalIncidents: number;
  totalLateMinutes: number;
  policyMode: 'progressive' | 'standard' | 'disabled';
  tiers?: {
    firstTimeDeductionDays: number;
    secondTimeDeductionDays: number;
    thirdTimeDeductionDays: number;
    fourthTimeDeductionDays: number;
  };
}

export interface SocialInsuranceParams {
  minorUnits: MoneyDigits;
  isEnabled: boolean;
  hasEmployeeInsurance: boolean;
  insuranceSalary: number;
  employeePct: number; // e.g. 9.75% or 11%
  employerPct: number; // e.g. 11.75% or 12%
  capAmount?: number;
}

export interface IncomeTaxParams {
  minorUnits: MoneyDigits;
  isEnabled: boolean;
  hasIncomeTax: boolean;
  taxableIncome: number;
  brackets?: Array<{ min: number; max: number | null; rate: number }>;
}

export interface PayrollLineItemInput {
  minorUnits: MoneyDigits;
  employeeId: number;
  baseSalary: number;
  allowanceAmount: number;
  overtimeAmount: number;
  commissionAmount: number;
  scheduledLoanDeduction: number;
  attendanceDeduction: number;
  leaveDeduction: number;
  assetRecoveryDeduction: number;
  otherDeductions: number;
  employeeSocialInsurance: number;
  employerSocialInsurance: number;
  incomeTax: number;
  maxDeductionPct?: number; // Labor law cap: e.g. 0.50 (50% max of gross pay)
}

export interface PayrollLineItemOutput {
  employeeId: number;
  baseSalary: number;
  allowanceAmount: number;
  overtimeAmount: number;
  commissionAmount: number;
  grossPay: number;
  // Deductions
  employeeSocialInsurance: number;
  employerSocialInsurance: number;
  incomeTax: number;
  attendanceDeduction: number;
  leaveDeduction: number;
  assetRecoveryDeduction: number;
  otherDeductions: number;
  appliedLoanDeduction: number;
  deferredLoanDeduction: number;
  carriedForwardDeduction: number;
  totalDeductions: number;
  netPay: number;
  isCapped: boolean;
  notes: string[];
}

export interface PayrollJournalTotals {
  grossSalariesExpense: number; // Dr 6200 NET of attendance/leave/other wage reductions (legacy field name)
  employerInsuranceExpense: number; // Dr 6210
  netPayable: number; // Cr 2140
  socialInsurancePayable: number; // Cr 2145 (employee + employer)
  incomeTaxPayable: number; // Cr 2146
  loanAdvancesCredit: number; // Cr 1160
  otherIncomePenaltiesCredit: number; // Cr 7100
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  discrepancy: number;
}

/**
 * INV-HR-PAYROLL-BOOK-PRECISION: every payroll amount is rounded at the
 * tenant's book precision, passed as a required parameter. There is no
 * silent 2-decimal default: a caller that does not know the tenant's
 * currency cannot compute payroll money.
 */
export const toMoney = (val: number, minorUnits: MoneyDigits): number => roundMoney(Number(val || 0), minorUnits);

/**
 * Calculates daily rate and hourly rate based on salary structure and standard 30-day labor law basis.
 */
export function calculateDailyRate(params: DailyRateParams): { dailyRate: number; hourlyRate: number } {
  const toMoney = (val: number): number => roundMoney(Number(val || 0), params.minorUnits);
  const isHourly = Boolean(params.isHourly);
  const expectedHours = Math.max(1, Number(params.expectedDailyHours || 8));
  const basisDays = Math.max(1, Number(params.basisDays || 30));

  if (isHourly) {
    const hourly = toMoney(params.hourlyRate || 0);
    const daily = toMoney(hourly * expectedHours);
    return { dailyRate: daily, hourlyRate: hourly };
  }

  const base = Math.max(0, Number(params.baseSalary || 0));
  const daily = toMoney(base / basisDays);
  const hourly = toMoney(daily / expectedHours);
  return { dailyRate: daily, hourlyRate: hourly };
}

/**
 * Calculates overtime allowance with statutory multiplier (default 1.5x).
 */
export function calculateOvertime(params: OvertimeParams): number {
  const toMoney = (val: number): number => roundMoney(Number(val || 0), params.minorUnits);
  const hours = Math.max(0, Number(params.overtimeMinutes || 0)) / 60;
  const rate = Math.max(0, Number(params.calculatedHourlyRate || 0));
  const multiplier = Math.max(1, Number(params.overtimeMultiplier ?? 1.5));
  return toMoney(hours * rate * multiplier);
}

/**
 * Hourly attendance base wage already includes the ordinary 1x wage for all
 * punched minutes. The incremental payroll allowance is ONLY (multiplier - 1)x.
 */
export function calculateHourlyOvertimePremium(params: OvertimeParams): number {
  const toMoney = (val: number): number => roundMoney(Number(val || 0), params.minorUnits);
  const hours = Math.max(0, Number(params.overtimeMinutes || 0)) / 60;
  const rate = Math.max(0, Number(params.calculatedHourlyRate || 0));
  const multiplier = Math.max(1, Number(params.overtimeMultiplier ?? 1.5));
  return toMoney(hours * rate * (multiplier - 1));
}

/**
 * Calculates progressive penalty deduction for attendance delays / early leaves.
 */
export function calculateProgressiveDelayDeduction(params: ProgressiveDelayParams): number {
  const toMoney = (val: number): number => roundMoney(Number(val || 0), params.minorUnits);
  if (params.policyMode === 'disabled') return 0;

  if (params.policyMode === 'standard') {
    const hours = Math.max(0, Number(params.totalLateMinutes || 0)) / 60;
    return toMoney(hours * params.calculatedHourlyRate);
  }

  // Progressive tier policy (e.g. 1st: 0.25 days, 2nd: 0.5 days, 3rd: 1 day, 4th+: 1 day)
  const tiers = params.tiers || {
    firstTimeDeductionDays: 0.25,
    secondTimeDeductionDays: 0.5,
    thirdTimeDeductionDays: 1,
    fourthTimeDeductionDays: 1,
  };

  let totalPenaltyDays = 0;
  for (let i = 1; i <= params.totalIncidents; i += 1) {
    if (i === 1) totalPenaltyDays += tiers.firstTimeDeductionDays;
    else if (i === 2) totalPenaltyDays += tiers.secondTimeDeductionDays;
    else if (i === 3) totalPenaltyDays += tiers.thirdTimeDeductionDays;
    else totalPenaltyDays += tiers.fourthTimeDeductionDays;
  }

  return toMoney(params.dailyRate * totalPenaltyDays);
}

/**
 * Calculates statutory Social Insurance (e.g., GOSI) for both employee and employer.
 */
export function calculateSocialInsurance(params: SocialInsuranceParams): {
  employeeShare: number;
  employerShare: number;
  insurableWage: number;
} {
  const toMoney = (val: number): number => roundMoney(Number(val || 0), params.minorUnits);
  if (!params.isEnabled || !params.hasEmployeeInsurance) {
    return { employeeShare: 0, employerShare: 0, insurableWage: 0 };
  }

  let wage = Math.max(0, Number(params.insuranceSalary || 0));
  if (params.capAmount && params.capAmount > 0) {
    wage = Math.min(wage, params.capAmount);
  }

  const employeeShare = toMoney(wage * (params.employeePct / 100));
  const employerShare = toMoney(wage * (params.employerPct / 100));

  return { employeeShare, employerShare, insurableWage: wage };
}

/**
 * Calculates progressive income withholding tax.
 */
export function calculateIncomeTax(params: IncomeTaxParams): number {
  const toMoney = (val: number): number => roundMoney(Number(val || 0), params.minorUnits);
  if (!params.isEnabled || !params.hasIncomeTax || params.taxableIncome <= 0) {
    return 0;
  }

  const taxable = params.taxableIncome;
  // The legacy exported utility must also fail closed: never provide 2024
  // Egyptian approximation as an implicit default for an enabled income tax.
  if (!Array.isArray(params.brackets) || params.brackets.length === 0) {
    throw new RangeError('Explicit tax brackets are required; no statutory rates are supplied by default');
  }
  const brackets = params.brackets;
  let expectedMin = 0;
  for (let i = 0; i < brackets.length; i++) {
    const band = brackets[i];
    if (
      !Number.isFinite(band.min) ||
      band.min !== expectedMin ||
      !Number.isFinite(band.rate) ||
      band.rate < 0 ||
      band.rate > 1 ||
      (band.max !== null && (!Number.isFinite(band.max) || band.max <= band.min)) ||
      (band.max === null && i !== brackets.length - 1)
    ) {
      throw new RangeError('Tax brackets must be contiguous, ordered and use decimal rates between zero and one');
    }
    expectedMin = band.max === null ? expectedMin : band.max;
  }
  if (brackets[brackets.length - 1].max !== null) {
    throw new RangeError('Top tax bracket must have no upper bound');
  }
  let tax = 0;

  for (const b of brackets) {
    if (taxable > b.min) {
      const taxableInBracket = b.max ? Math.min(taxable, b.max) - b.min : taxable - b.min;
      if (taxableInBracket > 0) {
        tax += taxableInBracket * b.rate;
      }
    }
  }

  return toMoney(tax);
}

/**
 * Calculates an individual employee's complete monthly payroll item with priority rules and deduction limits.
 *
 * Invariant Rules:
 * 1. Statutory deductions (GOSI, Income Tax) are deducted first.
 * 2. If maxDeductionPct is specified (e.g. 50% labor law cap), total non-statutory deductions
 *    cannot exceed (grossPay * maxDeductionPct - statutoryDeductions).
 * 3. Outstanding loan installment is capped by pay available after operational deductions.
 * 4. Any unapplied deduction is NOT silently swallowed: it is returned as carriedForwardDeduction.
 * 5. netPay is guaranteed >= 0.
 */
export function calculateEmployeePayrollLine(input: PayrollLineItemInput): PayrollLineItemOutput {
  const toMoney = (val: number): number => roundMoney(Number(val || 0), input.minorUnits);
  const baseSalary = toMoney(input.baseSalary);
  const allowanceAmount = toMoney(input.allowanceAmount);
  const overtimeAmount = toMoney(input.overtimeAmount);
  const commissionAmount = toMoney(input.commissionAmount);

  const grossPay = toMoney(baseSalary + allowanceAmount + overtimeAmount + commissionAmount);

  const employeeSocialInsurance = toMoney(input.employeeSocialInsurance);
  const employerSocialInsurance = toMoney(input.employerSocialInsurance);
  const incomeTax = toMoney(input.incomeTax);

  const notes: string[] = [];

  // 1. Statutory deductions
  const statutoryTotal = toMoney(employeeSocialInsurance + incomeTax);
  if (!Number.isFinite(grossPay) || !Number.isFinite(statutoryTotal) || statutoryTotal > grossPay) {
    throw new RangeError(
      `Payroll employee #${input.employeeId}: statutory deductions exceed gross earnings; fix insurance/tax configuration`,
    );
  }

  // 2. Deduction ceiling rule (Labor Law 50% cap or policy cap)
  const maxDeductionCapPct = input.maxDeductionPct ?? 1.0;
  if (!Number.isFinite(maxDeductionCapPct) || maxDeductionCapPct < 0 || maxDeductionCapPct > 1) {
    throw new RangeError('Deduction ceiling must be between zero and one');
  }
  const maxAllowableTotalDeductions = toMoney(grossPay * maxDeductionCapPct);

  // Pay pool available for non-statutory deductions
  let pool = Math.max(0, toMoney(grossPay - statutoryTotal));
  if (maxDeductionCapPct < 1.0) {
    pool = Math.min(pool, Math.max(0, toMoney(maxAllowableTotalDeductions - statutoryTotal)));
  }

  // 3. Operational deductions (Absence, Delay, Leaves, Asset Recovery)
  const reqAttendance = toMoney(input.attendanceDeduction);
  const appliedAttendance = Math.min(reqAttendance, pool);
  pool = toMoney(pool - appliedAttendance);
  const deferredAttendance = toMoney(reqAttendance - appliedAttendance);

  const reqLeave = toMoney(input.leaveDeduction);
  const appliedLeave = Math.min(reqLeave, pool);
  pool = toMoney(pool - appliedLeave);
  const deferredLeave = toMoney(reqLeave - appliedLeave);

  const reqAsset = toMoney(input.assetRecoveryDeduction);
  const appliedAsset = Math.min(reqAsset, pool);
  pool = toMoney(pool - appliedAsset);
  const deferredAsset = toMoney(reqAsset - appliedAsset);

  const reqOther = toMoney(input.otherDeductions);
  const appliedOther = Math.min(reqOther, pool);
  pool = toMoney(pool - appliedOther);
  const deferredOther = toMoney(reqOther - appliedOther);

  // 4. Loan installment (discretionary - gets what remains in pool)
  const scheduledLoan = toMoney(input.scheduledLoanDeduction);
  const appliedLoan = Math.min(scheduledLoan, pool);
  pool = toMoney(pool - appliedLoan);
  const deferredLoan = toMoney(scheduledLoan - appliedLoan);

  if (deferredLoan > 0) {
    notes.push(`تم تأجيل ${deferredLoan} من قسط السلفة لعدم كفاية الراتب أو بلوغ سقف الاستقطاع`);
  }

  const carriedForwardDeduction = toMoney(deferredAttendance + deferredLeave + deferredAsset + deferredOther);
  if (carriedForwardDeduction > 0) {
    notes.push(`استقطاع مؤجل بقيمة ${carriedForwardDeduction} يحتاج تسوية موثقة قبل اعتماد المسير؛ لم يُرحّل تلقائيًا`);
  }

  const totalDeductions = toMoney(
    statutoryTotal + appliedAttendance + appliedLeave + appliedAsset + appliedOther + appliedLoan,
  );

  const netPay = toMoney(Math.max(0, grossPay - totalDeductions));
  const isCapped = carriedForwardDeduction > 0 || deferredLoan > 0;

  return {
    employeeId: input.employeeId,
    baseSalary,
    allowanceAmount,
    overtimeAmount,
    commissionAmount,
    grossPay,
    employeeSocialInsurance,
    employerSocialInsurance,
    incomeTax,
    attendanceDeduction: appliedAttendance,
    leaveDeduction: appliedLeave,
    assetRecoveryDeduction: appliedAsset,
    otherDeductions: appliedOther,
    appliedLoanDeduction: appliedLoan,
    deferredLoanDeduction: deferredLoan,
    carriedForwardDeduction,
    totalDeductions,
    netPay,
    isCapped,
    notes,
  };
}

/**
 * Reconciles the entire payroll run into balanced double-entry accounting figures.
 *
 * Invariant Formula:
 * Debit side:
 *   - Account 6200 = Σ (Gross Pay - attendance / leave / other wage reductions)
 *   - Account 6210 (Employer Social Insurance Expense) = Σ Employer GOSI
 * Credit side:
 *   - Account 2140 (Payroll Payable) = Σ Net Pay
 *   - Account 2145 (Social Insurance Authority Payable) = Σ (Employee GOSI + Employer GOSI)
 *   - Account 2146 (Income Tax Payable) = Σ Income Tax
 *   - Account 1160 (Employee Advances / Loans) = Σ Applied Loan Deductions
 *   - Account 7100 = Σ Asset Recovery Deductions only (NOT attendance penalties)
 *
 * Assert: Total Debit == Total Credit (down to 0.01 precision).
 */
export function reconcilePayrollRunJournalTotals(
  items: PayrollLineItemOutput[],
  minorUnits: MoneyDigits,
): PayrollJournalTotals {
  const toMoney = (val: number): number => roundMoney(Number(val || 0), minorUnits);
  let grossSalariesExpense = 0;
  let employerInsuranceExpense = 0;
  let netPayable = 0;
  let employeeInsuranceTotal = 0;
  let incomeTaxPayable = 0;
  let loanAdvancesCredit = 0;
  let otherIncomePenaltiesCredit = 0;

  for (const item of items) {
    grossSalariesExpense = toMoney(
      grossSalariesExpense + item.grossPay - item.attendanceDeduction - item.leaveDeduction - item.otherDeductions,
    );
    employerInsuranceExpense = toMoney(employerInsuranceExpense + item.employerSocialInsurance);
    netPayable = toMoney(netPayable + item.netPay);
    employeeInsuranceTotal = toMoney(employeeInsuranceTotal + item.employeeSocialInsurance);
    incomeTaxPayable = toMoney(incomeTaxPayable + item.incomeTax);
    loanAdvancesCredit = toMoney(loanAdvancesCredit + item.appliedLoanDeduction);

    // Recoveries remain separate; attendance/leave wage reductions offset salary expense.
    otherIncomePenaltiesCredit = toMoney(otherIncomePenaltiesCredit + item.assetRecoveryDeduction);
  }

  const socialInsurancePayable = toMoney(employeeInsuranceTotal + employerInsuranceExpense);

  const totalDebit = toMoney(grossSalariesExpense + employerInsuranceExpense);
  const totalCredit = toMoney(
    netPayable + socialInsurancePayable + incomeTaxPayable + loanAdvancesCredit + otherIncomePenaltiesCredit,
  );

  const discrepancy = toMoney(Math.abs(totalDebit - totalCredit));
  const isBalanced = discrepancy <= 1 / 10 ** minorUnits;

  return {
    grossSalariesExpense,
    employerInsuranceExpense,
    netPayable,
    socialInsurancePayable,
    incomeTaxPayable,
    loanAdvancesCredit,
    otherIncomePenaltiesCredit,
    totalDebit,
    totalCredit,
    isBalanced,
    discrepancy,
  };
}
