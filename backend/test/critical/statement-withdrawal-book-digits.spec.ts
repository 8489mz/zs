/*
 * Statement + withdrawal preview at tenant book digits (F3): both engines
 * round money at the tenant's book precision via a REQUIRED minorUnits —
 * no hardcoded 2dp, no 0.009 settled band. INV-STATEMENT-WITHDRAWAL-BOOK-DIGITS.
 *
 * Bars (proof defects, verbatim): at 3dp a 100.125 gross stays 100.125
 * (not 100.13); a 0.004 balance is a CREDIT (not settled); the withdrawal
 * preview is 100.125 on the contract path and the daily path. Hours stay
 * 2dp (a quantity, not money). At 2dp the old pins are unchanged.
 * Run: npx ts-node test/critical/statement-withdrawal-book-digits.spec.ts (from backend/).
 */

import { strict as assert } from 'node:assert';
import { buildEmployeeFinancialStatement } from '../../src/modules/hr/engines/employee-financial-statement.engine';
import { calculateEmployeeWithdrawalBalance } from '../../src/modules/hr/engines/employee-withdrawal-balance.engine';

function main(): void {
  // --- Statement engine at 3dp ---
  const stmt = buildEmployeeFinancialStatement({
    minorUnits: 3,
    employee: { id: 1, displayName: 'Test' },
    payrollItems: [{
      id: 1, runId: 1, periodMonth: '2026-03', runStatus: 'approved',
      baseSalary: 100.125, allowanceAmount: 0, grossPay: 100.125,
      deductionAmount: 0, penaltyDeduction: 0, loanDeductionAmount: 0,
      netPay: 100.125, itemStatus: 'approved',
    }],
    loans: [], adjustments: [], ledger: [],
  });
  assert.equal(stmt.summary.totalGrossEarnings, 100.125, '3dp gross stays 100.125');
  assert.equal(stmt.transactions[0].credit, 100.125, '3dp entitlement credit stays 100.125');

  // A 0.004 remainder is a credit at 3dp, not settled.
  const credit4 = buildEmployeeFinancialStatement({
    minorUnits: 3,
    employee: { id: 1, displayName: 'Test' },
    payrollItems: [{
      id: 1, runId: 1, periodMonth: '2026-03', runStatus: 'approved',
      baseSalary: 0.004, allowanceAmount: 0, grossPay: 0.004,
      deductionAmount: 0, penaltyDeduction: 0, loanDeductionAmount: 0,
      netPay: 0.004, itemStatus: 'approved',
    }],
    loans: [], adjustments: [], ledger: [],
  });
  assert.equal(credit4.summary.netFinancialBalance, 0.004, '0.004 balance preserved at 3dp');
  assert.equal(credit4.summary.balanceStatus, 'credit', '0.004 is a credit at 3dp');

  // The entitlement guard follows book digits: 0.004 over gross throws at 3dp.
  assert.throws(() => buildEmployeeFinancialStatement({
    minorUnits: 3,
    employee: { id: 1, displayName: 'Test' },
    payrollItems: [{
      id: 1, runId: 1, periodMonth: '2026-03', runStatus: 'approved',
      baseSalary: 100.129, allowanceAmount: 0, grossPay: 100.125,
      deductionAmount: 0, penaltyDeduction: 0, loanDeductionAmount: 0,
      netPay: 100.129, itemStatus: 'approved',
    }],
    loans: [], adjustments: [], ledger: [],
  }), /exceeds gross/, 'entitlement 0.004 over gross throws at 3dp');

  // At 2dp the old behaviour is unchanged: 100.125 rounds to 100.13, 0.004 settles.
  const stmt2 = buildEmployeeFinancialStatement({
    minorUnits: 2,
    employee: { id: 1, displayName: 'Test' },
    payrollItems: [{
      id: 1, runId: 1, periodMonth: '2026-03', runStatus: 'approved',
      baseSalary: 100.125, allowanceAmount: 0, grossPay: 100.125,
      deductionAmount: 0, penaltyDeduction: 0, loanDeductionAmount: 0,
      netPay: 100.125, itemStatus: 'approved',
    }],
    loans: [], adjustments: [], ledger: [],
  });
  assert.equal(stmt2.summary.totalGrossEarnings, 100.13, '2dp gross rounds to 100.13 as before');
  const settled2 = buildEmployeeFinancialStatement({
    minorUnits: 2,
    employee: { id: 1, displayName: 'Test' },
    payrollItems: [{
      id: 1, runId: 1, periodMonth: '2026-03', runStatus: 'approved',
      baseSalary: 0.004, allowanceAmount: 0, grossPay: 0.004,
      deductionAmount: 0, penaltyDeduction: 0, loanDeductionAmount: 0,
      netPay: 0.004, itemStatus: 'approved',
    }],
    loans: [], adjustments: [], ledger: [],
  });
  assert.equal(settled2.summary.balanceStatus, 'settled', '0.004 settles at 2dp as before');

  // --- Withdrawal preview at 3dp: contract path and daily path ---
  const baseCtx = {
    employee: {
      id: 1, displayName: 'Test', compensationType: 'monthly' as const,
      payFrequency: 'monthly' as const, hourlyRate: 0,
      expectedDailyHours: 8, status: 'active',
    },
    contract: { baseSalary: 100.125, currency: 'KWD' },
    currentCycle: { cycleStart: '2026-03-01', cycleEnd: '2026-03-31', daysElapsed: 31 },
    punches: [], priorLoans: [], unpaidApprovedPayrollItems: [],
    todayDate: '2026-03-31',
  };
  const contractPath = calculateEmployeeWithdrawalBalance({ ...baseCtx, minorUnits: 3 });
  assert.equal(contractPath.accrual.accruedEarnings, 100.125, 'contract-path preview 100.125 at 3dp');
  assert.equal(contractPath.balanceStatus, 'credit', 'contract-path 0.125-scale balance is a credit');

  const dailyPath = calculateEmployeeWithdrawalBalance({
    ...baseCtx,
    employee: { ...baseCtx.employee, payFrequency: 'daily' as const },
    contract: { baseSalary: 3103.875, currency: 'KWD' },
    punches: [{ status: 'present' } as never],
    minorUnits: 3,
  });
  // D4: daily wage divides by the preview month's days (March = 31):
  // 1 present day x (3103.875 / 31 = 100.125 exactly at 3dp).
  assert.equal(dailyPath.accrual.accruedEarnings, 100.125, 'daily-path preview at 3dp (100.125, March 31-day month)');

  // A 0.004 net balance is a credit at 3dp on the withdrawal preview too.
  const tiny = calculateEmployeeWithdrawalBalance({
    ...baseCtx,
    contract: { baseSalary: 0.004, currency: 'KWD' },
    minorUnits: 3,
  });
  assert.equal(tiny.netAvailableBalance, 0.004, 'withdrawal net 0.004 preserved at 3dp');
  assert.equal(tiny.balanceStatus, 'credit', 'withdrawal 0.004 is a credit at 3dp');

  // Hours stay 2dp even at 3dp book digits.
  const hourly = calculateEmployeeWithdrawalBalance({
    employee: {
      id: 1, displayName: 'Test', compensationType: 'hourly' as const,
      payFrequency: 'monthly' as const, hourlyRate: 10,
      expectedDailyHours: 8, status: 'active',
    },
    currentCycle: { cycleStart: '2026-03-01', cycleEnd: '2026-03-31', daysElapsed: 1 },
    punches: [{
      status: 'present', check_in_at: '2026-03-01T08:00:00.000Z', check_out_at: '2026-03-01T11:20:00.000Z',
    } as never],
    priorLoans: [], unpaidApprovedPayrollItems: [],
    todayDate: '2026-03-01', minorUnits: 3,
  });
  assert.equal(hourly.accrual.workedHours, 3.33, 'worked hours stay 2dp (3.33h) at 3dp digits');

  console.log('statement-withdrawal-book-digits.spec: ok (100.125 / credit-0.004 / daily-100.125-Mar31 / 3.33h)');
}

main();
