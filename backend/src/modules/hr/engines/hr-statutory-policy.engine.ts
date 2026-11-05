/**
 * Verifiable configuration input for payroll, NOT a statement of any country's
 * laws. Authorised payroll staff must review the applicable effective-dated rules.
 */
import { MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export interface HrStatutoryPolicy {
  hrSocialInsuranceEnabled?: boolean;
  hrIncomeTaxEnabled?: boolean;
  statutoryCountry?: 'EG' | 'SA' | 'KW' | 'QA' | 'OM';
  statutoryEffectiveFrom?: string;
  statutoryEffectiveTo?: string;
  statutoryLegalReference?: string;
  statutoryReviewed?: boolean;
  insuranceConfig?: { employeePct: number; employerPct: number; minSalary?: number; maxSalary?: number };
  taxPersonalExemption?: number;
  /** Explicit wage base; never infer taxable components from currency or country. */
  taxableEarningsBasis?: 'gross' | 'gross_after_attendance_leave';
  /** Must be explicitly chosen by a reviewed accountant. */
  taxDeductEmployeeInsurance?: boolean;
  /** Source of insurable earnings for this tenant's reviewed policy. */
  insuranceWageBasis?: 'employee_insurance_salary' | 'earned_base';
  /** Explicit decision for employees working less than a complete month. */
  insuranceProratePartialEmployment?: boolean;
  /** Progressive annual taxable-income bracket upper bounds; rate in percent. */
  taxBrackets?: { max: number | null; rate: number }[];
  /**
   * Direct-advance cash cap (N2, INV-ADVANCE-CAP-PER-CURRENCY-SETTING):
   * a single scalar for the tenant's currency (the settings-UI control),
   * and/or a per-currency map. Resolution: map entry, then scalar, then
   * the 2,000 default. Non-finite/non-positive values are unconfigured.
   */
  directAdvanceCashCap?: number;
  directAdvanceCashCapByCurrency?: Record<string, number>;
}

export const STATUTORY_COUNTRIES = ['EG', 'SA', 'KW', 'QA', 'OM'] as const;
export type StatutoryCountryCode = (typeof STATUTORY_COUNTRIES)[number];

export const STATUTORY_COUNTRY_CURRENCY_MAP: Record<StatutoryCountryCode, string> = {
  EG: 'EGP',
  SA: 'SAR',
  KW: 'KWD',
  QA: 'QAR',
  OM: 'OMR',
};

export const CURRENCY_STATUTORY_COUNTRY_MAP: Record<string, StatutoryCountryCode> = {
  EGP: 'EG',
  SAR: 'SA',
  KWD: 'KW',
  QAR: 'QA',
  OMR: 'OM',
};

export function inferStatutoryCountry(currency?: string, countryCode?: string): StatutoryCountryCode {
  const normCountry = String(countryCode || '').trim().toUpperCase();
  if ((STATUTORY_COUNTRIES as readonly string[]).includes(normCountry)) {
    return normCountry as StatutoryCountryCode;
  }
  const normCurr = String(currency || '').trim().toUpperCase();
  return CURRENCY_STATUTORY_COUNTRY_MAP[normCurr] || 'EG';
}

/** Validate jurisdiction against the tenant's configured payment currency. No legal
 * rates are implied by this mapping, which only protects against mixed-country
 * settings on a single company ledger.
 */
export function requireHrPayrollJurisdictionCurrency(
  country: HrStatutoryPolicy['statutoryCountry'] | string | undefined,
  tenantCurrency: string,
): void {
  const expectedCurrency = STATUTORY_COUNTRY_CURRENCY_MAP[String(country || '').trim().toUpperCase() as StatutoryCountryCode];
  if (!expectedCurrency) throw new RangeError('حدد دولة المرتبات المعتمدة للمنشأة');
  if (String(tenantCurrency || '').trim().toUpperCase() !== expectedCurrency) {
    throw new RangeError('دولة سياسة المرتبات لا تطابق عملة المنشأة؛ أوقف الاعتماد وصحح السياسة');
  }
}

const money = (v: number, minorUnits: MoneyDigits): number => roundMoney(v, minorUnits);
function validDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d)
    && Number.isFinite(Date.parse(d + 'T00:00:00Z'))
    && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
}
function percent(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 100) throw new Error('نسبة ضريبة أو تأمينات غير صحيحة');
  return num;
}
export function validateHrStatutoryPolicy(
  p: HrStatutoryPolicy,
  period?: { from: string; to: string },
  requireJurisdictionReview = false,
): void {
  // Calculating a zero-statutory preview is allowed. Approving a complete
  // payroll without ANY reviewed jurisdiction and exemption decision is not.
  if (!p.hrSocialInsuranceEnabled && !p.hrIncomeTaxEnabled && !requireJurisdictionReview) return;
  if (!p.statutoryReviewed || !['EG', 'SA', 'KW', 'QA', 'OM'].includes(String(p.statutoryCountry || ''))
    || !validDate(String(p.statutoryEffectiveFrom || '')) || !String(p.statutoryLegalReference || '').trim()) {
    throw new Error('حدد الدولة وتاريخ السريان والمرجع القانوني وأكد المراجعة قبل حساب الاستقطاعات');
  }
  if (p.statutoryEffectiveTo && (!validDate(p.statutoryEffectiveTo) || p.statutoryEffectiveTo < p.statutoryEffectiveFrom!)) {
    throw new Error('تاريخ انتهاء سريان قانون الاستقطاعات غير صحيح');
  }
  if (period && (period.from < p.statutoryEffectiveFrom! || (p.statutoryEffectiveTo && period.to > p.statutoryEffectiveTo))) {
    throw new Error('فترة الراتب خارج سريان قواعد الضريبة والتأمينات');
  }
  if (p.hrSocialInsuranceEnabled) {
    if (!['employee_insurance_salary', 'earned_base'].includes(String(p.insuranceWageBasis || ''))
      || typeof p.insuranceProratePartialEmployment !== 'boolean') {
      throw new Error('حدد أساس الأجر التأميني وقاعدة احتساب الخدمة الجزئية صراحةً');
    }
    const c = p.insuranceConfig;
    if (!c || c.employeePct == null || c.employerPct == null) throw new Error('نسب التأمينات غير محددة');
    percent(c.employeePct); percent(c.employerPct);
    const min = Number(c.minSalary ?? 0), max = Number(c.maxSalary ?? 0);
    if (!Number.isFinite(min) || min < 0 || !Number.isFinite(max) || max < 0 || (max > 0 && min > max)) {
      throw new Error('حدود الأجر التأميني غير صحيحة');
    }
  }
  if (p.hrIncomeTaxEnabled) {
    if (!['gross', 'gross_after_attendance_leave'].includes(String(p.taxableEarningsBasis || ''))
      || typeof p.taxDeductEmployeeInsurance !== 'boolean') {
      throw new Error('حدد وعاء الضريبة وكيفية خصم حصة التأمينات منه صراحةً');
    }
    if (!Number.isFinite(Number(p.taxPersonalExemption)) || Number(p.taxPersonalExemption) < 0
      || !Array.isArray(p.taxBrackets) || !p.taxBrackets.length) throw new Error('الإعفاء والشرائح الضريبية غير محددين');
    let lower = 0;
    for (let i = 0; i < p.taxBrackets.length; i += 1) {
      const band = p.taxBrackets[i];
      percent(band.rate);
      if (band.max === null) {
        if (i !== p.taxBrackets.length - 1) throw new Error('الشريحة المفتوحة يجب أن تكون أخيرة');
      } else {
        const upper = Number(band.max);
        if (!Number.isFinite(upper) || upper <= lower) throw new Error('شرائح الضريبة يجب أن تكون مرتبة تصاعدياً');
        lower = upper;
      }
    }
    if (p.taxBrackets[p.taxBrackets.length - 1].max !== null) throw new Error('شريحة الدخل الأعلى يجب أن تكون مفتوحة');
  }
}
export function calculateHrStatutoryAmounts(
  p: HrStatutoryPolicy,
  period: { from: string; to: string },
  employee: { insured: boolean; taxable: boolean; insuranceWage: number; taxableMonthlyWage: number; insurancePeriodFraction?: number },
  minorUnits: MoneyDigits,
) {
  validateHrStatutoryPolicy(p, period);
  let employeeInsurance = 0, employerInsurance = 0, incomeTax = 0;
  // The configured min/max insurable salary is a monthly base. Applying its full
  // floor to weekly payroll causes excess withholding; a verified pay-frequency
  // conversion is required before nonmonthly statutory calculation is enabled.
  if ((p.hrSocialInsuranceEnabled && employee.insured) || (p.hrIncomeTaxEnabled && employee.taxable)) {
    const yyyyMm = period.from.slice(0, 7);
    const [year, month] = yyyyMm.split('-').map(Number);
    const monthEnd = Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12
      ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) : '';
    if (period.from !== yyyyMm + '-01' || period.to !== monthEnd) {
      throw new Error('حساب الضريبة أو التأمينات يتطلب شهرًا ميلاديًا كاملًا؛ راجع قواعد الفترات الجزئية أولاً');
    }
  }
  if (p.hrSocialInsuranceEnabled && employee.insured) {
    const ins = p.insuranceConfig!;
    let wage = Number(employee.insuranceWage);
    if (!Number.isFinite(wage) || wage < 0) throw new Error('أجر التأمينات غير صالح');
    const fraction = Number(employee.insurancePeriodFraction ?? 1);
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      throw new Error('نسبة سريان التأمينات في الفترة غير صحيحة');
    }
    const minimum = Number(ins.minSalary || 0) * fraction;
    const maximum = Number(ins.maxSalary || 0) * fraction;
    wage = Math.max(minimum, wage);
    if (Number(ins.maxSalary || 0) > 0) wage = Math.min(maximum, wage);
    employeeInsurance = money(wage * Number(ins.employeePct) / 100, minorUnits);
    employerInsurance = money(wage * Number(ins.employerPct) / 100, minorUnits);
  }
  if (p.hrIncomeTaxEnabled && employee.taxable) {
    const monthly = Number(employee.taxableMonthlyWage);
    if (!Number.isFinite(monthly) || monthly < 0) throw new Error('الدخل الخاضع للضريبة غير صالح');
    const taxableAnnual = Math.max(0, monthly * 12 - Number(p.taxPersonalExemption));
    let lower = 0, annualTax = 0;
    for (const band of p.taxBrackets!) {
      const upper = band.max === null ? Infinity : Number(band.max);
      annualTax += Math.max(0, Math.min(taxableAnnual, upper) - lower) * Number(band.rate) / 100;
      if (taxableAnnual <= upper) break;
      lower = upper;
    }
    incomeTax = money(annualTax / 12, minorUnits);
  }
  return { employeeInsurance, employerInsurance, incomeTax };
}
