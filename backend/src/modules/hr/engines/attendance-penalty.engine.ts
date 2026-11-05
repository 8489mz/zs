/**
 * Unified Attendance Penalty & Overtime Calculation Engine
 * Single Source of Truth for calculating financial impact of attendance exceptions
 * (late check in, early check out, absent, overtime, missing punch)
 * based on employee contract, compensation type, and delay/attendance policies.
 */

import { roundMoney, type MoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { daysInCalendarMonth } from './hourly-attendance-pay.engine';

export interface AttendancePenaltyEngineInput {
  exceptionType: string;
  durationMinutes: number;
  compensationType: 'monthly' | 'hourly' | string;
  baseSalary: number;
  hourlyRate: number;
  expectedDailyHours: number;
  delayPolicy: string; // 'inherit' | 'standard' | 'progressive' | 'strict' | 'disabled'
  incidentIndexInMonth?: number; // 1-based sequential occurrence in month
  globalDelayPolicyEnabled?: boolean;
  globalFirstTimeDeduction?: number; // default: 0.25 (quarter day)
  globalSecondTimeDeduction?: number; // default: 0.50 (half day)
  globalThirdTimeDeduction?: number; // default: 1.00 (full day)
  globalFourthTimeDeduction?: number; // default: 1.00 (full day)
  graceMinutes?: number;
  overtimeMultiplier?: number; // default: 1.5
  /** Incident date (YYYY-MM-DD, REQUIRED): the daily rate uses ITS calendar month — never a fixed 30. */
  referenceDate: string;
  /** Tenant book digits (REQUIRED): preview money is rounded at book precision, never a silent 2dp. */
  minorUnits: MoneyDigits;
}

export interface AttendancePenaltyEngineResult {
  estimatedAmount: number;
  policyDescription: string;
  hourlyRate: number;
  dailyRate: number;
  effectivePolicy: string;
}

export function calculateAttendancePenalty(input: AttendancePenaltyEngineInput): AttendancePenaltyEngineResult {
  const isHourly = String(input.compensationType || '').toLowerCase() === 'hourly';
  const hourlyRateInput = Number(input.hourlyRate || 0);
  const expectedHours = Number(input.expectedDailyHours || 8) || 8;
  const baseSalary = Number(input.baseSalary || 0);

  const toMoney = (v: number): number => roundMoney(v, input.minorUnits);
  // D4: the daily rate is the monthly wage over the days of the incident's
  // calendar month. daysInCalendarMonth throws on a malformed date.
  const dailyRate = isHourly ? (hourlyRateInput * expectedHours) : (baseSalary > 0 ? (baseSalary / daysInCalendarMonth(input.referenceDate)) : 0);
  const calculatedHourlyRate = isHourly ? hourlyRateInput : (expectedHours > 0 ? dailyRate / expectedHours : 0);
  const minuteRate = calculatedHourlyRate / 60;

  if (dailyRate === 0 && calculatedHourlyRate === 0) {
    return {
      estimatedAmount: 0,
      policyDescription: 'لم يسجل راتب للموظف',
      hourlyRate: 0,
      dailyRate: 0,
      effectivePolicy: 'no_salary',
    };
  }

  const duration = Math.max(0, Number(input.durationMinutes || 0));
  const isOvertime = input.exceptionType === 'early_check_in' || input.exceptionType === 'late_check_out' || input.exceptionType === 'extra_hours';

  if (isOvertime) {
    const rawMult = Number(input.overtimeMultiplier ?? 1.5);
    const mult = Number.isFinite(rawMult) && rawMult >= 1 ? rawMult : 1;
    const amount = toMoney(((duration / 60) * calculatedHourlyRate * mult));
    return {
      estimatedAmount: amount,
      policyDescription: `إضافي (${mult}x)`,
      hourlyRate: toMoney(calculatedHourlyRate),
      dailyRate: toMoney(dailyRate),
      effectivePolicy: 'overtime',
    };
  }

  if (input.exceptionType === 'absent') {
    return {
      estimatedAmount: toMoney(dailyRate),
      policyDescription: 'غياب (يوم كامل)',
      hourlyRate: toMoney(calculatedHourlyRate),
      dailyRate: toMoney(dailyRate),
      effectivePolicy: 'absent',
    };
  }

  if (input.exceptionType === 'late_check_in' || input.exceptionType === 'early_check_out') {
    let mode = String(input.delayPolicy || 'inherit').toLowerCase();
    if (mode === 'inherit') {
      mode = input.globalDelayPolicyEnabled ? 'progressive' : 'standard';
    }

    if (mode === 'disabled') {
      return {
        estimatedAmount: 0,
        policyDescription: 'معفى (سياسة معطلة)',
        hourlyRate: toMoney(calculatedHourlyRate),
        dailyRate: toMoney(dailyRate),
        effectivePolicy: 'disabled',
      };
    }

    if (mode === 'progressive') {
      const idx = Math.max(1, Number(input.incidentIndexInMonth || 1));
      let fraction = 0.25;
      let label = `تأخير ${idx}: ربع يوم`;
      if (idx === 1) {
        fraction = Number(input.globalFirstTimeDeduction ?? 0.25);
        label = `تأخير 1: ${fraction === 0.25 ? 'ربع يوم' : `${fraction} يوم`}`;
      } else if (idx === 2) {
        fraction = Number(input.globalSecondTimeDeduction ?? 0.50);
        label = `تأخير 2: ${fraction === 0.5 ? 'نصف يوم' : `${fraction} يوم`}`;
      } else if (idx === 3) {
        fraction = Number(input.globalThirdTimeDeduction ?? 1.00);
        label = `تأخير 3: ${fraction === 1 ? 'يوم كامل' : `${fraction} يوم`}`;
      } else {
        fraction = Number(input.globalFourthTimeDeduction ?? 1.00);
        label = `تأخير ${idx}: ${fraction === 1 ? 'يوم كامل' : `${fraction} يوم`}`;
      }
      const amount = toMoney((dailyRate * fraction));
      return {
        estimatedAmount: amount,
        policyDescription: label,
        hourlyRate: toMoney(calculatedHourlyRate),
        dailyRate: toMoney(dailyRate),
        effectivePolicy: 'progressive',
      };
    }

    if (mode === 'strict') {
      const grace = Number(input.graceMinutes || 0);
      if (duration > grace) {
        const amount = toMoney((dailyRate * 0.5));
        return {
          estimatedAmount: amount,
          policyDescription: 'صارم (نصف يوم)',
          hourlyRate: toMoney(calculatedHourlyRate),
          dailyRate: toMoney(dailyRate),
          effectivePolicy: 'strict',
        };
      }
      const amount = toMoney((duration * minuteRate));
      return {
        estimatedAmount: amount,
        policyDescription: 'دقائق فعلية (سماح)',
        hourlyRate: toMoney(calculatedHourlyRate),
        dailyRate: toMoney(dailyRate),
        effectivePolicy: 'strict_grace',
      };
    }

    // standard
    const amount = toMoney((duration * minuteRate));
    return {
      estimatedAmount: amount,
      policyDescription: 'دقائق فعلية',
      hourlyRate: toMoney(calculatedHourlyRate),
      dailyRate: toMoney(dailyRate),
      effectivePolicy: 'standard',
    };
  }

  if (input.exceptionType === 'missing_check_in' || input.exceptionType === 'missing_check_out') {
    const amount = toMoney((dailyRate * 0.5));
    return {
      estimatedAmount: amount,
      policyDescription: 'بصمة معلقة (نصف يوم)',
      hourlyRate: toMoney(calculatedHourlyRate),
      dailyRate: toMoney(dailyRate),
      effectivePolicy: 'missing_punch',
    };
  }

  return {
    estimatedAmount: 0,
    policyDescription: '—',
    hourlyRate: toMoney(calculatedHourlyRate),
    dailyRate: toMoney(dailyRate),
    effectivePolicy: 'unknown',
  };
}
