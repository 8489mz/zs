import { strict as assert } from 'node:assert';
import {
  calculateEmployeeWithdrawalBalance,
  resolvePayoutSchedule,
  EmployeeWithdrawalContext,
} from './employee-withdrawal-balance.engine';

function testHourlyEmployeeDirectDisbursement(): void {
  const ctx: EmployeeWithdrawalContext = {
  minorUnits: 2,
    employee: {
      id: 101,
      employeeNo: 'EMP-01',
      displayName: 'أحمد محمود',
      compensationType: 'hourly',
      payFrequency: 'monthly',
      hourlyRate: 50,
      expectedDailyHours: 8,
      status: 'active',
    },
    currentCycle: {
      cycleStart: '2026-10-01',
      cycleEnd: '2026-10-25',
      daysElapsed: 25,
    },
    punches: [
      {
        status: 'present',
        check_in_at: '2026-10-02T09:00:00Z',
        check_out_at: '2026-10-02T17:00:00Z', // 8 hrs
      },
      {
        status: 'present',
        check_in_at: '2026-10-03T09:00:00Z',
        check_out_at: '2026-10-03T15:00:00Z', // 6 hrs
      },
    ], // total 14 hrs * 50 = 700 EGP
    priorLoans: [
      {
        id: 1,
        loanType: 'advance',
        principalAmount: 200,
        remainingAmount: 200,
        issueDate: '2026-10-05',
        status: 'paid',
      },
    ],
    unpaidApprovedPayrollItems: [],
    todayDate: '2026-10-25',
  };

  const result = calculateEmployeeWithdrawalBalance(ctx);

  assert.equal(result.accrual.workedHours, 14);
  assert.equal(result.accrual.accruedEarnings, 700);
  assert.equal(result.deductions.currentCycleWithdrawals, 200);
  assert.equal(result.netAvailableBalance, 500); // 700 - 200 = 500 EGP
  assert.equal(result.balanceStatus, 'credit');
  assert.equal(result.canDisburseDirectly, true);
  assert.equal(result.maxDirectAdvance, 250); // 50% of 500 EGP
  assert.equal(result.maxDirectDisbursement, 250);
}

function testDebitExceedingAccruals(): void {
  const ctx: EmployeeWithdrawalContext = {
  minorUnits: 2,
    employee: {
      id: 102,
      displayName: 'محمد علي',
      compensationType: 'hourly',
      payFrequency: 'monthly',
      hourlyRate: 40,
      expectedDailyHours: 8,
      status: 'active',
    },
    currentCycle: {
      cycleStart: '2026-10-01',
      cycleEnd: '2026-10-25',
      daysElapsed: 25,
    },
    punches: [
      {
        status: 'present',
        check_in_at: '2026-10-02T09:00:00Z',
        check_out_at: '2026-10-02T14:00:00Z', // 5 hrs * 40 = 200 EGP
      },
    ],
    priorLoans: [
      {
        id: 2,
        loanType: 'advance',
        principalAmount: 500,
        remainingAmount: 500,
        issueDate: '2026-10-04',
        status: 'paid',
      },
    ],
    unpaidApprovedPayrollItems: [],
    todayDate: '2026-10-25',
  };

  const result = calculateEmployeeWithdrawalBalance(ctx);

  assert.equal(result.accrual.workedHours, 5);
  assert.equal(result.accrual.accruedEarnings, 200);
  assert.equal(result.deductions.totalDebt, 500);
  assert.equal(result.netAvailableBalance, -300); // 200 - 500 = -300
  assert.equal(result.balanceStatus, 'debit');
  assert.equal(result.canDisburseDirectly, false);
  assert.equal(result.maxDirectAdvance, 0);
  assert.equal(result.maxDirectDisbursement, 0);
}

function testMonthlyContractProration(): void {
  const ctx: EmployeeWithdrawalContext = {
  minorUnits: 2,
    employee: {
      id: 103,
      displayName: 'خالد إبراهيم',
      compensationType: 'monthly',
      payFrequency: 'monthly',
      hourlyRate: 0,
      expectedDailyHours: 8,
      status: 'active',
    },
    contract: {
      baseSalary: 6200, // in October (31 days) = 200 EGP / day
    },
    currentCycle: {
      cycleStart: '2026-10-01',
      cycleEnd: '2026-10-10',
      daysElapsed: 10,
    },
    punches: [],
    priorLoans: [],
    unpaidApprovedPayrollItems: [
      {
        id: 99,
        netPay: 1500,
        grossPay: 1800,
      },
    ],
    todayDate: '2026-10-10',
  };

  const result = calculateEmployeeWithdrawalBalance(ctx);

  // 10 days in Oct (31 days) = (10/31) * 6200 = 2000
  assert.equal(result.accrual.accruedEarnings, 2000);
  assert.equal(result.unpaidApprovedPayroll, 1500);
  assert.equal(result.netAvailableBalance, 3500); // 2000 + 1500 = 3500
  assert.equal(result.balanceStatus, 'credit');
  assert.equal(result.canDisburseDirectly, true);
  assert.equal(result.maxDirectAdvance, 1750); // 50% of 3500 = 1750 (under 2,000 cap)
  assert.equal(result.maxDirectDisbursement, 1750);
}

function testActivePayrollItem(): void {
  // 1. In-progress draft payroll item: must prorate to elapsed days (25 / 31)
  const ctxDraft: EmployeeWithdrawalContext = {
  minorUnits: 2,
    employee: {
      id: 104,
      displayName: 'خالد عبد الله الصياد',
      compensationType: 'monthly',
      payFrequency: 'monthly',
      hourlyRate: 0,
      expectedDailyHours: 8,
      status: 'active',
    },
    contract: {
      baseSalary: 6200,
    },
    activePayrollItem: {
      id: 501,
      runId: 26,
      periodMonth: '2026-10',
      runStatus: 'draft',
      baseSalary: 6200,
      allowanceAmount: 0,
      grossPay: 6200,
      deductionAmount: 0,
      loanDeductionAmount: 0,
      netPay: 6200,
    },
    currentCycle: {
      cycleStart: '2026-10-01',
      cycleEnd: '2026-10-31',
      daysElapsed: 25,
    },
    punches: [],
    priorLoans: [],
    unpaidApprovedPayrollItems: [],
    todayDate: '2026-10-25',
  };

  const draftResult = calculateEmployeeWithdrawalBalance(ctxDraft);

  // Prorated: (25 / 31) * 6200 = 5000
  assert.equal(draftResult.accrual.accruedEarnings, 5000);
  assert.equal(draftResult.accrual.isProrated, true);
  assert.equal(draftResult.netAvailableBalance, 5000);
  assert.equal(draftResult.balanceStatus, 'credit');
  // Direct advance is capped at 2,000 EGP (min of 2000 and 50% of 5000 = 2500)
  assert.equal(draftResult.maxDirectAdvance, 2000);
  assert.equal(draftResult.canDisburseDirectly, true);
  assert.equal(draftResult.maxDirectDisbursement, 2000);

  // 2. Completed approved payroll item at month-end: full earnings recognized
  const ctxApproved: EmployeeWithdrawalContext = {
    ...ctxDraft,
    activePayrollItem: {
      ...ctxDraft.activePayrollItem!,
      runStatus: 'approved',
    },
    todayDate: '2026-10-31',
  };

  const approvedResult = calculateEmployeeWithdrawalBalance(ctxApproved);
  assert.equal(approvedResult.accrual.accruedEarnings, 6200);
  assert.equal(approvedResult.accrual.isProrated, false);
  assert.equal(approvedResult.netAvailableBalance, 6200);
  assert.equal(approvedResult.maxDirectAdvance, 2000); // capped at 2,000 EGP
}

function testPayoutScheduleResolution(): void {
  // 1. Daily
  const daily = resolvePayoutSchedule('daily', '2026-10-12');
  assert.equal(daily.isPayoutDue, true);
  assert.equal(daily.daysUntilPayout, 0);
  assert.equal(daily.nextPayoutDate, '2026-10-12');

  // 2. Biweekly: day 5 (not due)
  const biweeklyMid = resolvePayoutSchedule('biweekly', '2026-10-05');
  assert.equal(biweeklyMid.isPayoutDue, false);
  assert.equal(biweeklyMid.daysUntilPayout, 10);
  assert.equal(biweeklyMid.nextPayoutDate, '2026-10-15');

  // Biweekly: day 15 (due)
  const biweeklyDue = resolvePayoutSchedule('biweekly', '2026-10-15');
  assert.equal(biweeklyDue.isPayoutDue, true);
  assert.equal(biweeklyDue.daysUntilPayout, 0);

  // 3. Weekly: Thursday (2026-10-15 is Thursday)
  const weeklyThu = resolvePayoutSchedule('weekly', '2026-10-15');
  assert.equal(weeklyThu.isPayoutDue, true);
  assert.equal(weeklyThu.daysUntilPayout, 0);

  // Weekly: Tuesday (2026-10-13 is Tuesday, 2 days until Thursday)
  const weeklyTue = resolvePayoutSchedule('weekly', '2026-10-13');
  assert.equal(weeklyTue.isPayoutDue, false);
  assert.equal(weeklyTue.daysUntilPayout, 2);

  // 4. Monthly: day 10 (not due)
  const monthlyMid = resolvePayoutSchedule('monthly', '2026-10-10');
  assert.equal(monthlyMid.isPayoutDue, false);
  assert.equal(monthlyMid.daysUntilPayout, 21);
  assert.equal(monthlyMid.nextPayoutDate, '2026-10-31');

  // Monthly: day 31 (due)
  const monthlyDue = resolvePayoutSchedule('monthly', '2026-10-31');
  assert.equal(monthlyDue.isPayoutDue, true);
  assert.equal(monthlyDue.daysUntilPayout, 0);
}

testHourlyEmployeeDirectDisbursement();
testDebitExceedingAccruals();
testMonthlyContractProration();
testActivePayrollItem();
testPayoutScheduleResolution();
console.log('employee-withdrawal-balance.engine.spec: ok');

