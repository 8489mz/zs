import { strict as assert } from 'node:assert';
import { allocatePayrollAccrual } from '../../src/modules/hr/engines/payroll-accrual-allocation.engine';

const posting = allocatePayrollAccrual(
  {
    grossPay: 10000,
    netPay: 8700,
    loanDeductions: 500,
    assetRecoveryDeductions: 100,
    operationalDeductions: 700,
    employeeInsurance: 300,
    employerInsurance: 200,
    incomeTax: 100,
  },
  2,
);
assert.deepEqual([posting.salaryExpense, posting.wageReduction, posting.assetRecoveryCredit], [9700, 300, 100]);
assert.deepEqual([posting.totalDebit, posting.totalCredit], [9900, 9900]);
const rounded = allocatePayrollAccrual(
  {
    grossPay: 132.49,
    netPay: 127.47,
    loanDeductions: 1.01,
    assetRecoveryDeductions: 0,
    operationalDeductions: 4.01,
    employeeInsurance: 3.99,
    employerInsurance: 0,
    incomeTax: 0.02,
  },
  2,
);
assert.equal(rounded.wageReduction, 0);
assert.equal(rounded.totalDebit, rounded.totalCredit);
assert.throws(
  () =>
    allocatePayrollAccrual(
      {
        grossPay: 100,
        netPay: 99,
        loanDeductions: 5,
        assetRecoveryDeductions: 0,
        operationalDeductions: 0,
        employeeInsurance: 0,
        employerInsurance: 0,
        incomeTax: 0,
      },
      2,
    ),
  RangeError,
);
assert.throws(
  () =>
    allocatePayrollAccrual(
      {
        grossPay: NaN,
        netPay: 0,
        loanDeductions: 0,
        assetRecoveryDeductions: 0,
        employeeInsurance: 0,
        employerInsurance: 0,
        incomeTax: 0,
        operationalDeductions: 0,
      },
      2,
    ),
  RangeError,
);
assert.throws(
  () =>
    allocatePayrollAccrual(
      {
        grossPay: 1000,
        netPay: 990,
        loanDeductions: 0,
        assetRecoveryDeductions: 0,
        operationalDeductions: 9,
        employeeInsurance: 0,
        employerInsurance: 0,
        incomeTax: 0,
      },
      2,
    ),
  /do not reconcile/,
);
assert.throws(
  () =>
    allocatePayrollAccrual(
      {
        grossPay: 1000,
        netPay: 990,
        loanDeductions: 0,
        assetRecoveryDeductions: 0,
        operationalDeductions: 10,
        employeeInsurance: 12,
        employerInsurance: 0,
        incomeTax: 0,
      },
      2,
    ),
  /statutory withholding/,
);
console.log('HR accrual journal allocation tests passed');
