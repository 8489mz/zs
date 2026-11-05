import assert from 'node:assert/strict';
import {
  buildEmployeeFinancialStatement,
  EmployeeFinancialProfile,
  FinancialPayrollItem,
  FinancialLoanRecord,
  FinancialAdjustmentRecord,
} from '../../src/modules/hr/engines/employee-financial-statement.engine';

console.log('=== بدء اختبار محرك كشف الحساب المالي للموظف (Employee Financial Statement) ===\n');

const sampleEmployee: EmployeeFinancialProfile = {
  id: 101,
  employeeNo: 'EMP-001',
  displayName: 'أحمد محمود',
  hireDate: '2026-01-01',
  status: 'active',
  baseSalary: 6000,
  departmentName: 'المبيعات',
  jobTitleName: 'كاشير ومبيعات',
};

// 1. Employee takes 1,000 advance from cashier shift on 2026-10-05
const loans: FinancialLoanRecord[] = [
  {
    id: 1,
    loanNo: 'LOAN-261005-0001',
    loanType: 'advance',
    principalAmount: 1000,
    paidAmount: 1000,
    remainingAmount: 0,
    status: 'repaid',
    notes: 'سلفة سريعة [وردية كاشير #12]',
    disbursedAt: '2026-10-05 14:30:00',
    createdByName: 'كاشير أحمد',
  },
];

// 2. Monthly payroll is processed on 2026-10-28: Gross 6000, Advance deducted 1000, Net paid 5000
const payrollItems: FinancialPayrollItem[] = [
  {
    id: 50,
    runId: 10,
    periodMonth: '2026-10',
    runStatus: 'paid',
    baseSalary: 6000,
    allowanceAmount: 0,
    grossPay: 6000,
    deductionAmount: 0,
    penaltyDeduction: 0,
    loanDeductionAmount: 1000,
    netPay: 5000,
    paidAt: '2026-10-28 17:00:00',
    paymentChannel: 'cash',
    paidByName: 'المدير المالي',
  },
];

const result = buildEmployeeFinancialStatement({
  minorUnits: 2,
  employee: sampleEmployee,
  payrollItems,
  loans,
  adjustments: [],
  ledger: [],
});

// Summary checks
assert.equal(result.summary.totalWithdrawals, 1000);
assert.equal(result.summary.totalGrossEarnings, 6000);
assert.equal(result.summary.totalPaidSalaries, 5000);
assert.equal(result.summary.totalRepayments, 1000);
assert.equal(result.summary.remainingLoanDebt, 0);
assert.equal(result.summary.netFinancialBalance, 0);
assert.equal(result.summary.balanceStatus, 'settled');

// Transactions check: 3 transactions sorted chronologically (advance, gross entitlement, net payout)
assert.equal(result.transactions.length, 3);
// Newest first for display
assert.equal(result.transactions[0].category, 'salary_payout');
assert.equal(result.transactions[0].debit, 5000);
assert.equal(result.transactions[0].runningBalance, 0);

assert.equal(result.transactions[1].category, 'salary_entitlement');
assert.equal(result.transactions[1].credit, 6000);
assert.equal(result.transactions[1].runningBalance, 5000);

assert.equal(result.transactions[2].category, 'withdrawal');
assert.equal(result.transactions[2].debit, 1000);
assert.equal(result.transactions[2].runningBalance, -1000);

// Test 2: outstanding cashier advances
const outstandingLoans: FinancialLoanRecord[] = [
  {
    id: 2,
    loanNo: 'LOAN-261010-0002',
    loanType: 'advance',
    principalAmount: 200,
    paidAmount: 0,
    remainingAmount: 200,
    status: 'paid',
    notes: 'سلفة سريعة [وردية كاشير #15]',
    disbursedAt: '2026-10-10 11:00:00',
    createdByName: 'كاشير عمر',
  },
  {
    id: 3,
    loanNo: 'LOAN-261012-0003',
    loanType: 'advance',
    principalAmount: 300,
    paidAmount: 0,
    remainingAmount: 300,
    status: 'paid',
    notes: 'سلفة مواصلات [وردية كاشير #17]',
    disbursedAt: '2026-10-12 16:00:00',
    createdByName: 'كاشير عمر',
  },
];

const result2 = buildEmployeeFinancialStatement({
  minorUnits: 2,
  employee: sampleEmployee,
  payrollItems: [],
  loans: outstandingLoans,
  adjustments: [],
  ledger: [],
});

assert.equal(result2.summary.totalWithdrawals, 500);
assert.equal(result2.summary.remainingLoanDebt, 500);
assert.equal(result2.summary.netFinancialBalance, -500);
assert.equal(result2.summary.balanceStatus, 'debit');
assert.equal(result2.transactions.length, 2);

// Test 3: penalties and deductions
const adjustments: FinancialAdjustmentRecord[] = [
  {
    id: 99,
    adjustmentType: 'deduction',
    amount: 150,
    date: '2026-10-15',
    reason: 'جزاء تأخير متكرر',
    status: 'pending',
    createdByName: 'مسؤول الـ HR',
  },
];

const result3 = buildEmployeeFinancialStatement({
  minorUnits: 2,
  employee: sampleEmployee,
  payrollItems: [],
  loans: [],
  adjustments,
  ledger: [],
});

assert.equal(result3.summary.totalPenalties, 0);
assert.equal(result3.summary.netFinancialBalance, 0);
assert.equal(result3.summary.balanceStatus, 'settled');
assert.equal(result3.transactions[0].category, 'penalty');
assert.equal(result3.transactions[0].debit, 0);

console.log('✅ كافة اختبارات محرك كشف الحساب المالي للموظف نجحت 100%!');

// Unpaid approved loans are not withdrawals, and a salaried employee's
// withholding is not money the employer still owes them.
const approvedOnly = buildEmployeeFinancialStatement({
  minorUnits: 2,
  employee: sampleEmployee, payrollItems: [], loans: [{
    id: 88, loanType: 'advance', principalAmount: 500, paidAmount: 0,
    remainingAmount: 500, status: 'approved', createdAt: '2026-10-10',
  }], adjustments: [], ledger: [],
});
assert.equal(approvedOnly.summary.netFinancialBalance, 0);
assert.equal(approvedOnly.summary.totalWithdrawals, 0);
assert.equal(approvedOnly.transactions.length, 0);

const withheld = buildEmployeeFinancialStatement({
  minorUnits: 2,
  employee: sampleEmployee,
  payrollItems: [{
    ...payrollItems[0], grossPay: 6000, netPay: 4000,
    deductionAmount: 1000, loanDeductionAmount: 1000,
  }, { ...payrollItems[0], id: 51, itemStatus: 'excluded', grossPay: 20000, netPay: 20000 }],
  loans, adjustments: [{
    id: 100, adjustmentType: 'allowance', amount: 500, date: '2026-10-15',
    status: 'applied', appliedInRunId: 10,
  }], ledger: [],
});
assert.equal(withheld.summary.totalGrossEarnings, 6000);
assert.equal(withheld.summary.totalAllowances, 0);
assert.equal(withheld.summary.totalPaidSalaries, 4000);
assert.equal(withheld.summary.netFinancialBalance, 0);
assert.equal(withheld.monthlyBreakdown[0].grossSalary, 6000);
assert.equal(withheld.monthlyBreakdown[0].netMonth, 0);
assert.equal(withheld.transactions.find(t => t.category === 'salary_entitlement')?.credit, 5000);

// Manual repayment in a later month must appear as a standalone month, even
// if there is no payroll or new advance disbursement in that later month.
const laterRepayment = buildEmployeeFinancialStatement({
  minorUnits: 2,
  employee: sampleEmployee, payrollItems: [], loans: [{
    id: 701, loanType: 'advance', principalAmount: 200, paidAmount: 200,
    remainingAmount: 0, status: 'repaid', disbursedAt: '2026-09-10 10:00:00',
  }], adjustments: [], ledger: [{
    id: 702, entryType: 'loan_repayment', amount: -200, balanceAfter: 0,
    repaymentMethod: 'manual_cash', createdAt: '2026-10-14 12:00:00',
  }],
});
const octoberRepayments = laterRepayment.monthlyBreakdown.find(x => x.month === '2026-10');
assert.equal(octoberRepayments?.repayments, 200);
assert.equal(octoberRepayments?.netMonth, 200);
assert.equal(laterRepayment.summary.netFinancialBalance, 0);
