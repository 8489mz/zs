import { calculateOvertime } from './payroll-calculation.engine';
import { MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

const money = (v: number, minorUnits: MoneyDigits): number => roundMoney(v, minorUnits);

/**
 * HR payment calculations: hourly staff are paid for completed, valid recorded
 * work sessions, not for a theoretical 30-day attendance schedule.
 */
export type WorkPunch = {
  status?: unknown;
  check_in_at?: unknown;
  check_out_at?: unknown;
  checkIn?: unknown;
  checkOut?: unknown;
  workDate?: unknown;
  /** Completed minutes of earlier sessions stored on the day row (D2). */
  prior_sessions_minutes?: unknown;
};
export function summarizeHourlyAttendance(punches: WorkPunch[], hourlyRate: number, minorUnits: MoneyDigits) {
  let workedMinutes = 0;
  let completedDays = 0;
  let incompleteCount = 0;
  let invalidCount = 0;
  for (const punch of punches) {
    const status = String(punch.status || '');
    if (status === 'absent' || status === 'leave') continue;
    // D2: minutes of earlier completed sessions stored on the day row
    // count toward the day's pay even while the current session is open.
    const priorMinutes = Math.max(0, Math.floor(Number(punch.prior_sessions_minutes || 0)));
    workedMinutes += priorMinutes;
    const start = punch.check_in_at;
    const finish = punch.check_out_at;
    if (!start && !finish) continue;
    if (!start || !finish) {
      incompleteCount++;
      continue;
    }
    const startAt = new Date(start as string).getTime();
    const finishAt = new Date(finish as string).getTime();
    const elapsed = Math.floor((finishAt - startAt) / 60000);
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 1440) {
      invalidCount++;
      continue;
    }
    workedMinutes += elapsed;
    completedDays++;
  }
  const rate = Number(hourlyRate);
  return {
    workedMinutes, completedDays, incompleteCount, invalidCount,
    baseWage: money((workedMinutes / 60) * (Number.isFinite(rate) ? Math.max(0, rate) : 0), minorUnits),
  };
}

/** Fraction of every calendar month inside a non-monthly payroll period. */
export function prorateMonthlyWage(monthlySalary: number, from: string, to: string, minorUnits: MoneyDigits): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return 0;
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;
  if ((end.getTime() - start.getTime()) / 86400000 > 366) return 0;
  let portion = 0;
  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const daysInMonth = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
    portion += 1 / daysInMonth;
  }
  return money(Math.max(0, monthlySalary) * portion, minorUnits);
}

/**
 * Multiple non-overlapping effective salary contracts can exist inside one
 * payroll period. The latest-contract-only strategy silently underpays staff
 * promoted mid-month. Resolve each calendar-day segment instead.
 */
export interface EffectiveSalaryContract {
  id: number;
  startDate: string;
  endDate: string | null;
  baseSalary: number;
}

export function payrollCalendarMonthFraction(from: string, to: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return 0;
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  const span = (end.getTime() - start.getTime()) / 86400000;
  if (!Number.isFinite(span) || span > 366) throw new RangeError('Payroll period exceeds supported 366-day range');
  let fraction = 0;
  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    fraction += 1 / new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
  }
  return fraction;
}

export function calculateEffectiveContractPay(
  contracts: EffectiveSalaryContract[],
  from: string,
  to: string,
  minorUnits: MoneyDigits,
): { baseWage: number; referenceMonthlySalary: number; latestContractId: number; serviceFraction: number } {
  if (from > to) return { baseWage: 0, referenceMonthlySalary: 0, latestContractId: 0, serviceFraction: 0 };
  const serviceFraction = payrollCalendarMonthFraction(from, to);
  if (!serviceFraction) throw new RangeError('Invalid payroll service period');
  const sorted = [...contracts].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
  let nextUncoveredDay = from;
  let earned = 0;
  let latestContractId = 0;
  for (const contract of sorted) {
    const begin = [from, contract.startDate].sort().at(-1)!;
    const end = [to, contract.endDate || to].sort()[0];
    if (begin > end) continue;
    if (!Number.isFinite(contract.baseSalary) || contract.baseSalary <= 0) {
      throw new RangeError('Employment contract must have a valid positive monthly salary');
    }
    if (begin !== nextUncoveredDay) {
      throw new RangeError(begin < nextUncoveredDay
        ? 'Overlapping salary contracts in payroll period'
        : 'Uncovered employment days between salary contracts');
    }
    earned += prorateMonthlyWage(contract.baseSalary, begin, end, minorUnits);
    latestContractId = contract.id;
    const next = new Date(end + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    nextUncoveredDay = next.toISOString().slice(0, 10);
  }
  if (nextUncoveredDay <= to) {
    throw new RangeError('Employee has no salary contract covering all worked days');
  }
  const baseWage = money(earned, minorUnits);
  return {
    baseWage,
    referenceMonthlySalary: money(baseWage / serviceFraction, minorUnits),
    latestContractId,
    serviceFraction,
  };
}

/**
 * Effective-dated fixed monthly compensation packages. Unlike a base salary
 * contract, a period with no package simply carries zero allowances.
 * Overlapping packages are ambiguous and rejected instead of double-paying.
 */
export interface EffectiveCompensationPackage {
  id: number;
  startDate: string | null;
  endDate: string | null;
  allowanceAmount: number;
  deductionAmount: number;
}

export function calculateEffectiveCompensationPay(
  packages: EffectiveCompensationPackage[], from: string, to: string, minorUnits: MoneyDigits,
): { allowance: number; deduction: number } {
  if (from > to) return { allowance: 0, deduction: 0 };
  const sorted = [...packages].sort(
    (a, b) => (a.startDate || '').localeCompare(b.startDate || '') || a.id - b.id,
  );
  let lastEnd = '';
  let allowance = 0;
  let deduction = 0;
  for (const item of sorted) {
    const begin = [from, item.startDate || from].sort().at(-1)!;
    const end = [to, item.endDate || to].sort()[0];
    if (begin > end) continue;
    if (lastEnd && begin <= lastEnd) throw new RangeError('Overlapping compensation packages in payroll period');
    if (!Number.isFinite(item.allowanceAmount) || item.allowanceAmount < 0
      || !Number.isFinite(item.deductionAmount) || item.deductionAmount < 0) {
      throw new RangeError('Invalid compensation package amounts');
    }
    allowance += prorateMonthlyWage(item.allowanceAmount, begin, end, minorUnits);
    deduction += prorateMonthlyWage(item.deductionAmount, begin, end, minorUnits);
    lastEnd = end;
  }
  return { allowance: money(allowance, minorUnits), deduction: money(deduction, minorUnits) };
}

/** Converts a dated day/hour adjustment using the salary contract actually
 * effective on that date. Backdated time-unit items outside this payroll
 * period need an explicit reviewed monetary amount, not a guessed blended rate.
 */
export function calculateDatedPayrollAdjustment(params: {
  minorUnits: MoneyDigits;
  amount: number;
  amountType: 'money' | 'days' | 'hours';
  date: string;
  period: { from: string; to: string };
  contracts: EffectiveSalaryContract[];
  isHourly: boolean;
  hourlyRate: number;
  expectedDailyHours: number;
}): number {
  const { amount, amountType, date, period, contracts, isHourly, hourlyRate, expectedDailyHours } = params;
  if (!Number.isFinite(amount) || amount <= 0) throw new RangeError('Invalid employee adjustment amount');
  if (amountType === 'money') return money(amount, params.minorUnits);
  if (amountType !== 'days' && amountType !== 'hours') throw new RangeError('Invalid employee adjustment unit');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < period.from || date > period.to) {
    throw new RangeError('Time-unit adjustment date must be inside this payroll period');
  }
  if (!Number.isFinite(expectedDailyHours) || expectedDailyHours <= 0 || expectedDailyHours > 24) {
    throw new RangeError('Invalid employee daily hours');
  }
  let dailyWage: number;
  if (isHourly) {
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) throw new RangeError('Invalid hourly salary');
    dailyWage = hourlyRate * expectedDailyHours;
  } else {
    const effective = contracts.filter(c => c.startDate <= date && (!c.endDate || c.endDate >= date));
    if (effective.length !== 1 || !Number.isFinite(effective[0].baseSalary) || effective[0].baseSalary <= 0) {
      throw new RangeError('Adjustment date must match exactly one salary contract');
    }
    dailyWage = effective[0].baseSalary / 30;
  }
  return money(amount * (amountType === 'hours' ? dailyWage / expectedDailyHours : dailyWage), params.minorUnits);
}

export interface ApprovedOvertimeDay {
  date: string;
  minutes: number;
}

/** An approved minute is paid at the salary rate effective on its exact date. */
export function calculateHistoricalOvertimePay(
  days: ApprovedOvertimeDay[],
  contracts: EffectiveSalaryContract[],
  expectedDailyHours: number,
  multiplier: number,
  minorUnits: MoneyDigits,
): number {
  if (!Number.isFinite(expectedDailyHours) || expectedDailyHours <= 0 || expectedDailyHours > 24
    || !Number.isFinite(multiplier) || multiplier < 1 || multiplier > 5) {
    throw new RangeError('Invalid overtime rate or daily schedule');
  }
  let total = 0;
  for (const day of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(day.minutes)
      || day.minutes < 0 || day.minutes > 1440) {
      throw new RangeError('Invalid approved overtime attendance record');
    }
    if (day.minutes === 0) continue;
    const matches = contracts.filter(c => c.startDate <= day.date && (!c.endDate || c.endDate >= day.date));
    if (matches.length !== 1 || !Number.isFinite(matches[0].baseSalary) || matches[0].baseSalary <= 0) {
      throw new RangeError('Overtime date must match exactly one valid salary contract');
    }
    total += calculateOvertime({
      minorUnits,
      calculatedHourlyRate: matches[0].baseSalary / 30 / expectedDailyHours,
      overtimeMinutes: day.minutes,
      overtimeMultiplier: multiplier,
    });
  }
  return money(total, minorUnits);
}

export function resolveExpectedDailyMinutes(params: {
  expectedDailyHours?: number | null;
  scheduledCheckInTime?: string | null;
  scheduledCheckOutTime?: string | null;
}): number {
  if (params.expectedDailyHours != null && Number(params.expectedDailyHours) > 0) {
    return Math.round(Number(params.expectedDailyHours) * 60);
  }
  const inTime = String(params.scheduledCheckInTime || '').trim();
  const outTime = String(params.scheduledCheckOutTime || '').trim();
  if (inTime && outTime) {
    const [ih, im] = inTime.slice(0, 5).split(':').map(Number);
    const [oh, om] = outTime.slice(0, 5).split(':').map(Number);
    if ([ih, im, oh, om].every(Number.isFinite)) {
      const shift = (oh * 60 + om) <= (ih * 60 + im)
        ? (oh * 60 + om) + 1440 - (ih * 60 + im)
        : (oh * 60 + om) - (ih * 60 + im);
      if (shift > 0 && shift <= 1440) return shift;
    }
  }
  return 8 * 60; // 8 hours default
}

export function calculatePayableMinutes(params: {
  actualMinutes: number;
  expectedDailyMinutes?: number;
  overtimePolicy?: string;
  approvedOvertimeMinutes?: number;
}): {
  payableMinutes: number;
  baseMinutes: number;
  approvedOvertimeMinutes: number;
  unapprovedOvertimeMinutes: number;
  isCapped: boolean;
} {
  const actual = Math.max(0, Math.floor(Number(params.actualMinutes || 0)));
  if (actual === 0) {
    return { payableMinutes: 0, baseMinutes: 0, approvedOvertimeMinutes: 0, unapprovedOvertimeMinutes: 0, isCapped: false };
  }
  const expected = Math.max(1, Math.floor(Number(params.expectedDailyMinutes || (8 * 60))));
  const policy = String(params.overtimePolicy || 'review_only').toLowerCase();
  const approved = Math.max(0, Math.floor(Number(params.approvedOvertimeMinutes || 0)));

  if (actual <= expected) {
    return {
      payableMinutes: actual,
      baseMinutes: actual,
      approvedOvertimeMinutes: 0,
      unapprovedOvertimeMinutes: 0,
      isCapped: false,
    };
  }

  const baseMinutes = expected;
  const extraMinutes = actual - expected;

  if (policy === 'auto_approved') {
    return {
      payableMinutes: actual,
      baseMinutes,
      approvedOvertimeMinutes: extraMinutes,
      unapprovedOvertimeMinutes: 0,
      isCapped: false,
    };
  }

  if (policy === 'disabled') {
    return {
      payableMinutes: baseMinutes,
      baseMinutes,
      approvedOvertimeMinutes: 0,
      unapprovedOvertimeMinutes: 0,
      isCapped: true,
    };
  }

  const validApproved = Math.min(extraMinutes, approved);
  const unapproved = extraMinutes - validApproved;

  return {
    payableMinutes: baseMinutes + validApproved,
    baseMinutes,
    approvedOvertimeMinutes: validApproved,
    unapprovedOvertimeMinutes: unapproved,
    isCapped: unapproved > 0,
  };
}

