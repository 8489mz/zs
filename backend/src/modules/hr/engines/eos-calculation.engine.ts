/**
 * End-of-Service (EOS) & Gratuity Calculation Pure Engine
 *
 * Implements statutory labor law calculation algorithms:
 * - Saudi Labor Law: Article 84 (Service Gratuity) & Article 85 (Resignation scale) & Article 80 (Gross Misconduct).
 * - Egyptian Labor Law 14/2025: automatic statutory gratuity disabled until legally validated.
 * - Custom / Policy-driven calculation.
 * - Entitlement absorption invariants: Payout deductions are strictly bounded by total entitlements.
 *
 * Rule 13 (AGENTS.md):
 * Must be pure functions without database or external state side-effects.
 * Imported identically by production services and critical spec tests.
 */

import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export type LawType = 'saudi' | 'egyptian' | 'custom';

export type TerminationReason =
  | 'resignation'
  | 'termination_by_employer'
  | 'contract_expiration'
  | 'retirement'
  | 'force_majeure'
  | 'termination_article_80'
  | 'other';

export interface GratuityCalculationParams {
  serviceYearsDecimal: number;
  totalSalary: number;
  dailyWage: number;
  lawType: LawType;
  reason: TerminationReason | string;
  customGratuityDaysPerYear?: number;
  /** Tenant book precision, required: never default to 2 decimals. */
  minorUnits: MoneyDigits;
}

export interface GratuityCalculationResult {
  baseGratuity: number;
  gratuityPercentage: number;
  gratuityAmount: number;
}

export interface SettlementAbsorptionParams {
  gratuityAmount: number;
  leaveEncashmentAmount: number;
  pendingSalaryAmount: number;
  noticePeriodAmount: number;
  otherEntitlementsAmount: number;
  unpaidLoansDeduction: number;
  assetsDeduction: number;
  otherDeductions: number;
  /** Tenant book precision, required: never default to 2 decimals. */
  minorUnits: MoneyDigits;
}

export interface SettlementAbsorptionResult {
  totalEntitlements: number;
  appliedAssets: number;
  appliedOther: number;
  appliedLoans: number;
  unabsorbedLoans: number;
  unabsorbedAssets: number;
  unabsorbedOther: number;
  totalDeductions: number;
  netPayable: number;
}

const toMoney = (v: number, minorUnits: MoneyDigits): number => roundMoney(Number(v || 0), minorUnits);

/**
 * Calculates end-of-service gratuity according to the applicable labor law.
 */
export function calculateGratuity(params: GratuityCalculationParams): GratuityCalculationResult {
  const serviceYears = Math.max(0, Number(params.serviceYearsDecimal || 0));
  const totalSalary = Math.max(0, Number(params.totalSalary || 0));
  // D4: no /30 fallback. A daily wage is caller-supplied at the
  // calendar-month basis (termination month); the custom law throws
  // without an explicit positive daily wage instead of guessing one.
  const dailyWage = Math.max(0, Number(params.dailyWage || 0));
  const lawType = params.lawType;
  const reason = params.reason || 'resignation';

  let gratuityPercentage = 100;
  let baseGratuity = 0;

  if (lawType === 'saudi') {
    // Saudi Labor Law: Art. 84:
    // Half month wage for each of the first 5 years, and a full month wage for each following year.
    const first5Years = Math.min(serviceYears, 5);
    const subsequentYears = Math.max(0, serviceYears - 5);
    baseGratuity = (first5Years * 0.5 * totalSalary) + (subsequentYears * 1.0 * totalSalary);

    // Saudi Labor Law: Art. 85 (Resignation scale)
    if (reason === 'resignation') {
      if (serviceYears < 2) {
        gratuityPercentage = 0;
      } else if (serviceYears >= 2 && serviceYears < 5) {
        gratuityPercentage = 33.333; // 1/3
      } else if (serviceYears >= 5 && serviceYears < 10) {
        gratuityPercentage = 66.667; // 2/3
      } else {
        gratuityPercentage = 100; // Full
      }
    } else if (reason === 'termination_article_80') {
      // Gross misconduct under Article 80 forfeits gratuity entirely
      gratuityPercentage = 0;
    } else {
      // Employer termination, end of contract, retirement, or female resignation within statutory window
      gratuityPercentage = 100;
    }
  } else if (lawType === 'egyptian') {
    // Egyptian Labor Law: Art. 125:
    // Half month wage for each of the first 5 years, and a full month wage for each following year.
    const first5Years = Math.min(serviceYears, 5);
    const subsequentYears = Math.max(0, serviceYears - 5);
    baseGratuity = (first5Years * 0.5 * totalSalary) + (subsequentYears * 1.0 * totalSalary);
    gratuityPercentage = 100;
  } else if (lawType === 'custom') {
    const daysPerYear = Number(params.customGratuityDaysPerYear);
    if (!Number.isFinite(daysPerYear) || daysPerYear < 0 || daysPerYear > 365) {
      throw new RangeError('Custom EOS days per year must be expressly provided between 0 and 365');
    }
    if (!(dailyWage > 0)) {
      throw new RangeError('Custom EOS gratuity requires an explicit positive daily wage at the calendar-month basis');
    }
    baseGratuity = daysPerYear * dailyWage * serviceYears;
    gratuityPercentage = 100;
  } else {
    throw new RangeError('Unsupported end-of-service jurisdiction');
  }

  const minorUnits = params.minorUnits;
  let gratuityAmount = 0;
  if (lawType === 'saudi' && reason === 'resignation') {
    if (serviceYears >= 2 && serviceYears < 5) {
      gratuityAmount = toMoney(baseGratuity / 3, minorUnits);
    } else if (serviceYears >= 5 && serviceYears < 10) {
      gratuityAmount = toMoney((baseGratuity * 2) / 3, minorUnits);
    } else if (serviceYears >= 10) {
      gratuityAmount = toMoney(baseGratuity, minorUnits);
    } else {
      gratuityAmount = 0;
    }
  } else {
    gratuityAmount = toMoney((baseGratuity * gratuityPercentage) / 100, minorUnits);
  }

  return {
    baseGratuity: toMoney(baseGratuity, minorUnits),
    gratuityPercentage,
    gratuityAmount,
  };
}

/**
 * Calculates leave encashment compensation for remaining unused annual leave days.
 */
export function calculateLeaveEncashment(remainingLeaveDays: number, dailyWage: number, minorUnits: MoneyDigits): number {
  const days = Math.max(0, Number(remainingLeaveDays || 0));
  const rate = Math.max(0, Number(dailyWage || 0));
  return toMoney(days * rate, minorUnits);
}

/**
 * Enforces the absorption invariant:
 * In any settlement payout, total deductions cannot exceed total entitlements (net payable >= 0).
 * Any remaining excess deductions are tracked as unabsorbed employee debts.
 */
export function calculateSettlementAbsorption(params: SettlementAbsorptionParams): SettlementAbsorptionResult {
  const minorUnits = params.minorUnits;
  const nonNegative = (value: number, label: string): number => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) throw new RangeError(`Invalid or negative EOS amount: ${label}`);
    return toMoney(num, minorUnits);
  };
  const gratuity = nonNegative(params.gratuityAmount, 'gratuityAmount');
  const leavePay = nonNegative(params.leaveEncashmentAmount, 'leaveEncashmentAmount');
  const pendingSalary = nonNegative(params.pendingSalaryAmount, 'pendingSalaryAmount');
  const noticePeriod = nonNegative(params.noticePeriodAmount, 'noticePeriodAmount');
  const otherEntitlements = nonNegative(params.otherEntitlementsAmount, 'otherEntitlementsAmount');

  const totalEntitlements = toMoney(gratuity + leavePay + pendingSalary + noticePeriod + otherEntitlements, minorUnits);

  let pool = totalEntitlements;

  // Deduction absorption order:
  // 1. Assets / Custody recovery
  const requestedAssets = nonNegative(params.assetsDeduction, 'assetsDeduction');
  const appliedAssets = Math.min(requestedAssets, pool);
  pool = toMoney(pool - appliedAssets, minorUnits);
  const unabsorbedAssets = toMoney(requestedAssets - appliedAssets, minorUnits);

  // 2. Disciplinary / other deductions
  const requestedOther = nonNegative(params.otherDeductions, 'otherDeductions');
  const appliedOther = Math.min(requestedOther, pool);
  pool = toMoney(pool - appliedOther, minorUnits);
  const unabsorbedOther = toMoney(requestedOther - appliedOther, minorUnits);

  // 3. Outstanding loans / advances
  const requestedLoans = nonNegative(params.unpaidLoansDeduction, 'unpaidLoansDeduction');
  const appliedLoans = Math.min(requestedLoans, pool);
  pool = toMoney(pool - appliedLoans, minorUnits);
  const unabsorbedLoans = toMoney(requestedLoans - appliedLoans, minorUnits);

  const netPayable = pool;
  const totalDeductions = toMoney(appliedAssets + appliedOther + appliedLoans, minorUnits);

  return {
    totalEntitlements,
    appliedAssets,
    appliedOther,
    appliedLoans,
    unabsorbedLoans,
    unabsorbedAssets,
    unabsorbedOther,
    totalDeductions,
    netPayable,
  };
}
