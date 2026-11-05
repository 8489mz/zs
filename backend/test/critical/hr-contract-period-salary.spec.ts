import { strict as assert } from 'node:assert';
import { calculateEffectiveContractPay, calculateEffectiveCompensationPay, calculateHistoricalOvertimePay, calculateDatedPayrollAdjustment, payrollCalendarMonthFraction } from '../../src/modules/hr/engines/hourly-attendance-pay.engine';

// D4 (INV-CALENDAR-MONTH-DAY-COUNT-ALIGNMENT): daily wages divide by the
// days of the date's calendar month (October 2026 = 31 days) — never a
// fixed 30. The overtime/adjustment pins below are October values.

// Pure examples: 31-day October 2026. 15 days at 3100 + 16 days at 6200.
const contracts = [
  { id: 1, startDate: '2026-01-01', endDate: '2026-10-15', baseSalary: 3100 },
  { id: 2, startDate: '2026-10-16', endDate: null, baseSalary: 6200 },
];
const switched = calculateEffectiveContractPay(contracts, '2026-10-01', '2026-10-31', 2);
assert.equal(switched.baseWage, 4700);
assert.equal(switched.referenceMonthlySalary, 4700);
assert.equal(switched.latestContractId, 2);
assert.ok(Math.abs(switched.serviceFraction - 1) < 0.000001);

const hiredMidMonth = calculateEffectiveContractPay(
  [{ id: 5, startDate: '2026-10-11', endDate: null, baseSalary: 3100 }],
  '2026-10-11', '2026-10-20', 2);
assert.equal(hiredMidMonth.baseWage, 1000);
assert.equal(hiredMidMonth.referenceMonthlySalary, 3100);
assert.ok(Math.abs(hiredMidMonth.serviceFraction - 10 / 31) < 0.000001);

const gap = [{ ...contracts[0], endDate: '2026-10-14' }, contracts[1]];
assert.throws(() => calculateEffectiveContractPay(gap, '2026-10-01', '2026-10-31', 2), /Uncovered/);
const overlap = [contracts[0], { ...contracts[1], startDate: '2026-10-15' }];
assert.throws(() => calculateEffectiveContractPay(overlap, '2026-10-01', '2026-10-31', 2), /Overlapping/);
assert.throws(() => calculateEffectiveContractPay([], '2026-10-01', '2026-10-31', 2), /no salary contract/);
assert.ok(Math.abs(payrollCalendarMonthFraction('2026-09-01', '2026-10-31') - 2) < 0.000001);

const allowances = calculateEffectiveCompensationPay([
  { id: 10, startDate: '2026-01-01', endDate: '2026-10-15', allowanceAmount: 310, deductionAmount: 0 },
  { id: 11, startDate: '2026-10-16', endDate: null, allowanceAmount: 620, deductionAmount: 31 },
], '2026-10-01', '2026-10-31', 2);
assert.equal(allowances.allowance, 470);
assert.equal(allowances.deduction, 16);
assert.deepEqual(calculateEffectiveCompensationPay([], '2026-10-01', '2026-10-31', 2),
  { allowance: 0, deduction: 0 });
assert.throws(() => calculateEffectiveCompensationPay([
  { id: 1, startDate: null, endDate: null, allowanceAmount: 10, deductionAmount: 0 },
  { id: 2, startDate: '2026-10-10', endDate: null, allowanceAmount: 20, deductionAmount: 0 },
], '2026-10-01', '2026-10-31', 2), /Overlapping/);

const overtime = calculateHistoricalOvertimePay([
  { date: '2026-10-10', minutes: 120 },
  { date: '2026-10-20', minutes: 120 },
], contracts, 8, 1.5, 2);
assert.equal(overtime, 112.5);
assert.throws(() => calculateHistoricalOvertimePay([{ date: '2026-10-20', minutes: 60 }],
  [contracts[0]], 8, 1.5, 2), /exactly one/);
assert.throws(() => calculateHistoricalOvertimePay([{ date: '2026-10-20', minutes: 1800 }],
  contracts, 8, 1.5, 2), /Invalid approved/);

// A manual day/hour adjustment follows the wage effective on its specific date,
// not the prorated average of all salary contracts in a payroll interval.
const commonAdjustment = { minorUnits: 2 as const,
  amount: 2, amountType: 'days' as const, period: { from: '2026-10-01', to: '2026-10-31' },
  contracts, isHourly: false, hourlyRate: 0, expectedDailyHours: 8,
};
assert.equal(calculateDatedPayrollAdjustment({ ...commonAdjustment, date: '2026-10-10' }), 200);
assert.equal(calculateDatedPayrollAdjustment({ ...commonAdjustment, date: '2026-10-20' }), 400);
assert.equal(calculateDatedPayrollAdjustment({ ...commonAdjustment, amountType: 'hours', date: '2026-10-10' }), 25);
assert.equal(calculateDatedPayrollAdjustment({ ...commonAdjustment, amountType: 'money', amount: 125, date: '2026-09-10' }), 125);
assert.throws(() => calculateDatedPayrollAdjustment({ ...commonAdjustment, date: '2026-09-10' }), /inside this payroll/);
assert.throws(() => calculateDatedPayrollAdjustment({ ...commonAdjustment, date: '2026-10-15',
  contracts: [{ ...contracts[1], startDate: '2026-10-15' }, contracts[0]] }), /exactly one/);
