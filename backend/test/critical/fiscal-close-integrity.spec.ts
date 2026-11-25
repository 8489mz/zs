import { strict as assert } from 'node:assert';
import {
  fiscalProfitAndLossCategory,
  resolveClosingJournalAccounts,
} from '../../src/modules/accounting/services/fiscal-year.service';

const classify = (code: string, account_type: string) => fiscalProfitAndLossCategory({ code, account_type });
assert.equal(classify('4100', 'revenue'), 'revenue');
assert.equal(classify('7150', 'asset'), 'revenue');
assert.equal(classify('5000', 'expense'), 'expense');
assert.equal(classify('7200', 'asset'), 'expense');
assert.equal(classify('1110', 'asset'), null);

const proposed = [
  {
    accountId: 10,
    accountCode: '4100',
    accountName: 'Sales',
    debit: 100,
    credit: 0,
    description: 'إقفال حساب الإيراد',
  },
  { accountId: 20, accountCode: '5100', accountName: 'COGS', debit: 0, credit: 40, description: 'إقفال حساب المصروف' },
  {
    accountId: 30,
    accountCode: '3200',
    accountName: 'Retained',
    debit: 0,
    credit: 60,
    description: 'ترحيل صافي أرباح السنة إلى الأرباح المحتجزة',
  },
];
const resolved = resolveClosingJournalAccounts(proposed, 30, 31);
assert.deepEqual(
  resolved.map((x) => x.accountId),
  [10, 20, 31],
);
assert.deepEqual(
  proposed.map((x) => x.accountId),
  [10, 20, 30],
  'original preview must remain unchanged',
);
assert.throws(() => resolveClosingJournalAccounts(proposed, 30, 0));
console.log('Fiscal closing category and retained earnings regressions passed');
