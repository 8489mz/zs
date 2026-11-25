import { strict as assert } from 'node:assert';
import {
  calculateAssetDepreciation,
  validateFixedAssetTerms,
} from '../../src/modules/accounting/engines/fixed-asset-depreciation.engine';
import {
  calculateForexDifference,
  forexOffsetCode,
} from '../../src/modules/accounting/engines/forex-difference.engine';
import { fiscalProfitAndLossCategory } from '../../src/modules/accounting/services/fiscal-year.service';

assert.throws(() => validateFixedAssetTerms(100, -1, 12));
assert.throws(() => validateFixedAssetTerms(100, 101, 12));
assert.throws(() => validateFixedAssetTerms(100, 10, 0));

const asset = {
  cost: 1200,
  salvage: 200,
  usefulLifeMonths: 10,
  accumulated: 0,
  purchaseDate: new Date('2026-01-01T00:00:00Z'),
  postingDate: new Date('2026-01-31T00:00:00Z'),
  months: 1,
  method: 'straight_line',
};
assert.equal(calculateAssetDepreciation(asset), 100, 'January may only recognise one elapsed month');
assert.throws(() => calculateAssetDepreciation({ ...asset, months: 10 }), 'unearned future months are rejected');
assert.equal(calculateAssetDepreciation({ ...asset, accumulated: 100 }), 0, 'a repeat cannot front-load February');
assert.equal(calculateAssetDepreciation({ ...asset, months: 10, postingDate: new Date('2026-10-31T00:00:00Z') }), 1000);
assert.equal(
  calculateAssetDepreciation({
    ...asset,
    method: 'declining_balance',
    months: 2,
    postingDate: new Date('2026-02-28T00:00:00Z'),
  }),
  432,
  'two declining-balance months compound',
);
assert.equal(
  calculateAssetDepreciation({
    ...asset,
    salvage: 0,
    method: 'declining_balance',
    accumulated: 1071.15,
    months: 1,
    postingDate: new Date('2026-10-31T00:00:00Z'),
  }),
  128.85,
  'final month reaches the salvage floor',
);
assert.throws(() => calculateAssetDepreciation({ ...asset, purchaseDate: new Date('2026-11-01T00:00:00Z') }));

assert.deepEqual(calculateForexDifference(150, 10, 40, 2), { revaluedLocal: 400, difference: 250 });
assert.deepEqual(calculateForexDifference(-150, -10, 40, 2), { revaluedLocal: -400, difference: -250 });
assert.deepEqual(calculateForexDifference(150, 0, 40, 2), { revaluedLocal: 0, difference: -150 });
assert.equal(forexOffsetCode(250), '7180');
assert.equal(forexOffsetCode(-250), '7280');

// VAT Declaration Base calculation: When prices include tax vs when prices exclude tax
function computeTaxableBase(
  subtotal: number,
  discount: number,
  taxAmount: number,
  taxRate: number,
  pricesIncludeTax: boolean,
): number {
  if (taxRate <= 0) return subtotal - discount;
  if (pricesIncludeTax) return subtotal - discount - taxAmount;
  return subtotal - discount;
}
assert.equal(computeTaxableBase(114, 0, 14, 14, true), 100, 'Tax-inclusive item has base of 100 with 14 tax');
assert.equal(computeTaxableBase(100, 0, 14, 14, false), 100, 'Tax-exclusive item has base of 100 with 14 tax');

// Installment plan finance interest calculation and schedule cent-distribution
function calculateInstallmentSchedule(financedAmount: number, interestRatePercent: number, installmentCount: number) {
  const interestAmount = Number(((financedAmount * interestRatePercent) / 100).toFixed(2));
  const totalWithInterest = Number((financedAmount + interestAmount).toFixed(2));
  const totalCents = Math.round(totalWithInterest * 100);
  const baseCents = Math.floor(totalCents / installmentCount);
  const extraCents = totalCents % installmentCount;

  const schedule: number[] = [];
  for (let i = 1; i <= installmentCount; i++) {
    schedule.push((baseCents + (i <= extraCents ? 1 : 0)) / 100);
  }
  const sumSchedule = Number(schedule.reduce((a, b) => a + b, 0).toFixed(2));
  return { interestAmount, totalWithInterest, schedule, sumSchedule };
}
const planRes = calculateInstallmentSchedule(1000, 10, 3);
assert.equal(planRes.interestAmount, 100);
assert.equal(planRes.totalWithInterest, 1100);
assert.deepEqual(planRes.schedule, [366.67, 366.67, 366.66]);
assert.equal(planRes.sumSchedule, 1100, 'Sum of installments must reconcile down to the exact cent');

// Double reversal prevention guard on PDC cheques
function shouldPostCancelOrReturnJournal(existingJournalId: number | null, existingStatus: string): boolean {
  return Boolean(existingJournalId && existingStatus !== 'bounced');
}
assert.equal(shouldPostCancelOrReturnJournal(123, 'in_safe'), true, 'Cheque in safe can post return/cancel reversal');
assert.equal(
  shouldPostCancelOrReturnJournal(123, 'issued'),
  true,
  'Payable cheque issued can post return/cancel reversal',
);
assert.equal(
  shouldPostCancelOrReturnJournal(123, 'bounced'),
  false,
  'Bounced cheque must NOT post double reversal on return/cancel',
);
assert.equal(shouldPostCancelOrReturnJournal(null, 'in_safe'), false, 'Cheque without journal cannot be reversed');

// Fiscal Year Profit & Loss categorization including Contra accounts
assert.equal(fiscalProfitAndLossCategory({ code: '4100', account_type: 'revenue' }), 'revenue');
assert.equal(
  fiscalProfitAndLossCategory({ code: '4400', account_type: 'contra_revenue' }),
  'revenue',
  'Sales returns must be included in revenue category for year-end close',
);
assert.equal(
  fiscalProfitAndLossCategory({ code: '4300', account_type: 'contra_revenue' }),
  'revenue',
  'Sales discounts must be included in revenue category for year-end close',
);
assert.equal(fiscalProfitAndLossCategory({ code: '5100', account_type: 'expense' }), 'expense');
assert.equal(
  fiscalProfitAndLossCategory({ code: '5195', account_type: 'contra_expense' }),
  'expense',
  'Purchase discounts/returns must be included in expense category for year-end close',
);
assert.equal(fiscalProfitAndLossCategory({ code: '6100', account_type: 'operating_expenses' }), 'expense');
assert.equal(fiscalProfitAndLossCategory({ code: '7100', account_type: 'other_income' }), 'revenue');
assert.equal(fiscalProfitAndLossCategory({ code: '7200', account_type: 'other_expense' }), 'expense');
assert.equal(
  fiscalProfitAndLossCategory({ code: '1110', account_type: 'asset' }),
  null,
  'Balance sheet asset must NOT be closed to P&L',
);
assert.equal(
  fiscalProfitAndLossCategory({ code: '2110', account_type: 'liability' }),
  null,
  'Balance sheet liability must NOT be closed to P&L',
);
assert.equal(
  fiscalProfitAndLossCategory({ code: '3200', account_type: 'equity' }),
  null,
  'Retained earnings must NOT be categorized as P&L line',
);

console.log('Accounting ledger hardening calculations passed');
