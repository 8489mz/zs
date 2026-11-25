import { strict as assert } from 'node:assert';
import { AccountingService } from '../../src/modules/accounting/accounting.service';

// Unit-level regression: bank eligibility and atomic header/line execution boundary.
// A PostgreSQL integration test is still required to verify actual transaction rollback.
async function scenario(isBank: boolean, failLines: boolean) {
  let transactionStarted = 0;
  let headerWrites = 0;
  let lineWrites = 0;
  const tx = {
    selectFrom(table: string) {
      assert.equal(table, 'accounting_accounts');
      const query: any = {
        select() {
          return query;
        },
        where() {
          return query;
        },
        async executeTakeFirst() {
          return { id: 5, is_cash_bank: isBank };
        },
      };
      return query;
    },
    insertInto(table: string) {
      const query: any = {
        values() {
          return query;
        },
        returning() {
          return query;
        },
        async executeTakeFirstOrThrow() {
          assert.equal(table, 'bank_statements');
          headerWrites++;
          return { id: 99 };
        },
        async execute() {
          assert.equal(table, 'bank_statement_lines');
          lineWrites++;
          if (failLines) throw new Error('line insert failed');
        },
      };
      return query;
    },
  };
  const db: any = {
    transaction() {
      return {
        execute: async (callback: (transaction: any) => Promise<unknown>) => {
          transactionStarted++;
          return callback(tx);
        },
      };
    },
  };
  const service = new AccountingService(db, {} as any);
  // Split seam: createBankStatement re-reads through the S10 slice's
  // getBankStatement (slice L223), not the facade method — stub the slice.
  (service as any).bankStatementsService.getBankStatement = async (id: number) => ({ statement: { id }, lines: [] });
  const auth: any = { userId: 7, role: 'admin', permissions: [], tenantId: 'tenant-A', accountId: 'account-A' };
  const dto: any = {
    accountId: 5,
    statementNo: 'S1',
    statementDate: '2026-10-21',
    startingBalance: 0,
    endingBalance: 12,
    lines: [{ lineDate: '2026-10-21', description: 'Deposit', amount: 12 }],
  };
  return {
    run: () => service.createBankStatement(dto, auth),
    stats: () => ({ transactionStarted, headerWrites, lineWrites }),
  };
}

(async () => {
  const nonBank = await scenario(false, false);
  await assert.rejects(nonBank.run(), /كشف الحساب البنكي يتطلب حساب خزينة أو بنك/);
  assert.deepEqual(nonBank.stats(), { transactionStarted: 1, headerWrites: 0, lineWrites: 0 });

  const failing = await scenario(true, true);
  await assert.rejects(failing.run(), /line insert failed/);
  assert.deepEqual(failing.stats(), { transactionStarted: 1, headerWrites: 1, lineWrites: 1 });

  const valid = await scenario(true, false);
  const result = await valid.run();
  assert.equal(result.statement.id, 99);
  assert.deepEqual(valid.stats(), { transactionStarted: 1, headerWrites: 1, lineWrites: 1 });
  console.log('Bank statement creation/eligibility unit regressions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
