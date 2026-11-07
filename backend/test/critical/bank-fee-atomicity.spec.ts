import { strict as assert } from 'node:assert';
import { AccountingService } from '../../src/modules/accounting/accounting.service';

const trx: any = {
  selectFrom(table: string) {
    const builder: any = {
      innerJoin() { return builder; }, where() { return builder; },
      select() { return builder; }, forUpdate() { return builder; },
      async executeTakeFirst() {
        if (table === 'bank_statement_lines as bsl') {
          return { id: 1, amount: -50, line_date: '2026-10-21', description: 'Fee', account_id: 11, is_reconciled: false };
        }
        if (table === 'journal_entry_lines') return { id: 12 };
        if (table === 'settings') return { value: 'EGP' };
        throw new Error('Unexpected table ' + table);
      },
      async execute() {
        if (table === 'currency_exchange_rates') return [];
        throw new Error('Unexpected table ' + table);
      },
    };
    return builder;
  },
};
let transactions = 0;
const db: any = {
  transaction() { return { execute: async (fn: (trx: unknown) => Promise<unknown>) => {
    transactions++;
    return fn(trx);
  } }; },
};
const service: any = new AccountingService(db, {} as any);
let sameTransactionForBoth = false;
service.createManualJournalEntry = async (_dto: unknown, _auth: unknown, passedTrx: unknown) => {
  assert.equal(passedTrx, trx, 'journal must use reconciliation transaction');
  return { entry: { id: 77 } };
};
service.reconcileMatchInTransaction = async (passedTrx: unknown) => {
  assert.equal(passedTrx, trx, 'reconciliation must use journal transaction');
  sameTransactionForBoth = true;
  throw new Error('forced reconciliation failure');
};
(async () => {
  const auth: any = { role: 'admin', userId: 1, tenantId: 't1', accountId: 'a1', permissions: [] };
  await assert.rejects(service.createBankFeeAdjustment({
    statementLineId: 1, expenseAccountId: 5,
  }, auth), /forced reconciliation failure/);
  assert.equal(transactions, 1);
  assert.equal(sameTransactionForBoth, true);
  console.log('Bank fee and reconciliation shared-transaction regressions passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
