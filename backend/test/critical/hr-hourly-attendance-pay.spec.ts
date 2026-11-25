import { strict as assert } from 'node:assert';
import {
  summarizeHourlyAttendance,
  prorateMonthlyWage,
  calculatePayableMinutes,
  resolveExpectedDailyMinutes,
} from '../../src/modules/hr/engines/hourly-attendance-pay.engine';

const punch = (start: string, end: string) => ({
  status: 'present',
  check_in_at: start,
  check_out_at: end,
});
assert.deepEqual(summarizeHourlyAttendance([], 50, 2), {
  workedMinutes: 0,
  completedDays: 0,
  incompleteCount: 0,
  invalidCount: 0,
  baseWage: 0,
});
assert.equal(summarizeHourlyAttendance([punch('2026-10-01T09:00:00Z', '2026-10-01T17:30:00Z')], 50, 2).baseWage, 425);
assert.equal(summarizeHourlyAttendance([punch('2026-10-01T21:00:00Z', '2026-10-02T05:00:00Z')], 40, 2).baseWage, 320);
const unfinished = summarizeHourlyAttendance([{ status: 'present', check_in_at: '2026-10-01T10:00:00Z' }], 50, 2);
assert.equal(unfinished.incompleteCount, 1);
assert.equal(unfinished.baseWage, 0);
assert.equal(summarizeHourlyAttendance([punch('2026-10-01T17:00:00Z', '2026-10-01T09:00:00Z')], 50, 2).invalidCount, 1);
assert.equal(
  summarizeHourlyAttendance([{ ...punch('2026-10-01T09:00:00Z', '2026-10-01T17:00:00Z'), status: 'absent' }], 50, 2)
    .baseWage,
  0,
);
assert.equal(prorateMonthlyWage(3100, '2026-10-01', '2026-10-07', 2), 700);
assert.equal(prorateMonthlyWage(3100, '2026-10-15', '2026-10-21', 2), 700);
assert.equal(prorateMonthlyWage(3000, '2026-10-01', '2026-10-31', 2), 3000);

// Tests for calculatePayableMinutes and resolveExpectedDailyMinutes
assert.equal(resolveExpectedDailyMinutes({ expectedDailyHours: 8 }), 480);
assert.equal(resolveExpectedDailyMinutes({ scheduledCheckInTime: '09:00', scheduledCheckOutTime: '17:00' }), 480);
assert.equal(resolveExpectedDailyMinutes({}), 480);

// Scenario: 9 hours worked (540 mins), expected 8 hours (480 mins), review_only, 0 approved
const res1 = calculatePayableMinutes({
  actualMinutes: 540,
  expectedDailyMinutes: 480,
  overtimePolicy: 'review_only',
  approvedOvertimeMinutes: 0,
});
assert.equal(res1.payableMinutes, 480); // Only 8 hours!
assert.equal(res1.baseMinutes, 480);
assert.equal(res1.unapprovedOvertimeMinutes, 60); // 1 hour pending
assert.equal(res1.isCapped, true);

// Scenario: 9 hours worked, manager approved 60 mins
const res2 = calculatePayableMinutes({
  actualMinutes: 540,
  expectedDailyMinutes: 480,
  overtimePolicy: 'review_only',
  approvedOvertimeMinutes: 60,
});
assert.equal(res2.payableMinutes, 540); // 9 hours!
assert.equal(res2.approvedOvertimeMinutes, 60);
assert.equal(res2.unapprovedOvertimeMinutes, 0);
assert.equal(res2.isCapped, false);

// Scenario: 9 hours worked, overtime disabled
const res3 = calculatePayableMinutes({ actualMinutes: 540, expectedDailyMinutes: 480, overtimePolicy: 'disabled' });
assert.equal(res3.payableMinutes, 480);
assert.equal(res3.isCapped, true);

// Scenario: 6 hours worked (undertimed)
const res4 = calculatePayableMinutes({ actualMinutes: 360, expectedDailyMinutes: 480 });
assert.equal(res4.payableMinutes, 360);
assert.equal(res4.isCapped, false);

console.log('HR hourly attendance/pay tests passed');
