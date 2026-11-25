import {
  MoneyDigits,
  toMinorUnits,
  fromMinorUnits,
  roundMoney,
} from '../../accounting/engines/money-minor-units.engine';

/** HR accrual posting amounts, calculated in integer minor units at the tenant's book precision. */
export type PayrollAccrualInput = {
  grossPay: number;
  netPay: number;
  loanDeductions: number;
  assetRecoveryDeductions: number;
  operationalDeductions: number;
  employeeInsurance: number;
  employerInsurance: number;
  incomeTax: number;
};
export function allocatePayrollAccrual(input: PayrollAccrualInput, minorUnits: MoneyDigits) {
  const toMinor = (value: number): number => {
    // Validate precision explicitly, as in the payroll-loan-allocation
    // engine: toMinorUnits throws its own generic error, and a total
    // finer than book precision must fail closed, never round silently.
    if (!Number.isFinite(value) || value < 0 || Math.abs(value - roundMoney(value, minorUnits)) > 0.000001)
      throw new RangeError('Payroll amount must be finite, non-negative, and at book precision');
    const minor = toMinorUnits(value, minorUnits);
    if (!Number.isSafeInteger(minor)) throw new RangeError('Payroll amount exceeds safe currency precision');
    return minor;
  };
  const gross = toMinor(input.grossPay);
  const net = toMinor(input.netPay);
  const loan = toMinor(input.loanDeductions);
  const assets = toMinor(input.assetRecoveryDeductions);
  const deductions = toMinor(input.operationalDeductions);
  const insurance = toMinor(input.employeeInsurance);
  const employer = toMinor(input.employerInsurance);
  const tax = toMinor(input.incomeTax);
  // Stored operationalDeductions includes insurance + tax; both must be
  // reconciled with the actual employee payroll lines, not inferred as a plug.
  if (gross !== net + loan + assets + deductions) {
    throw new RangeError('Payroll persisted gross, net and deductions do not reconcile');
  }
  const wageReduction = deductions - insurance - tax;
  if (wageReduction < 0) {
    throw new RangeError('Payroll statutory withholding exceeds stored deductions');
  }
  // Attendance, leave and operational wage deductions reduce wage expense;
  // asset recoveries are separately classified as recoveries, not attendance income.
  const salaryExpense = gross - wageReduction;
  const explicitCredits = net + loan + assets + insurance + tax;
  if (salaryExpense + employer !== explicitCredits + employer) throw new RangeError('Payroll journal unbalanced');
  const money = (n: number) => fromMinorUnits(n, minorUnits);
  return {
    salaryExpense: money(salaryExpense),
    wageReduction: money(wageReduction),
    netPayable: money(net),
    loanCredit: money(loan),
    assetRecoveryCredit: money(assets),
    employeeInsurancePayable: money(insurance),
    employerInsuranceExpense: money(employer),
    incomeTaxPayable: money(tax),
    totalDebit: money(salaryExpense + employer),
    totalCredit: money(explicitCredits + employer),
  };
}
