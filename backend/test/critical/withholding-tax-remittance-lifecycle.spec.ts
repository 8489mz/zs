import { strict as assert } from 'node:assert';
import { WithholdingTaxService } from '../../src/modules/accounting/services/withholding-tax.service';

const createMock = (recordStatus: string, postedRemittance: boolean) => {
  let writes = 0;
  const trx: any = {
    selectFrom(table: string) {
      const builder: any = {
        where() {
          return builder;
        },
        selectAll() {
          return builder;
        },
        select() {
          return builder;
        },
        forUpdate() {
          return builder;
        },
        async executeTakeFirst() {
          if (table === 'withholding_tax_transactions')
            return { id: 5, tenant_id: 't1', status: recordStatus, payment_reference: 'JE-200' };
          if (table === 'journal_entries') return postedRemittance ? { id: 200 } : undefined;
          throw new Error(`Unexpected query to ${table}`);
        },
      };
      return builder;
    },
    updateTable() {
      writes++;
      throw new Error('Should not update tax remittance');
    },
    deleteFrom() {
      writes++;
      throw new Error('Should not delete posted remittance');
    },
  };
  const db: any = {
    transaction() {
      return { execute: (cb: (x: unknown) => Promise<unknown>) => cb(trx) };
    },
  };
  const service = new WithholdingTaxService(db, {} as any);
  const auth: any = { tenantId: 't1', accountId: 't1', userId: 3, role: 'admin', permissions: [] };
  return { service, auth, writes: () => writes };
};
(async () => {
  const paid = createMock('paid', true);
  await assert.rejects(
    paid.service.updateStatus(paid.auth, 5, { status: 'draft' }),
    /لا يمكن إعادة معاملة ضريبية مسددة/,
  );
  assert.equal(paid.writes(), 0);
  await assert.rejects(
    paid.service.updateStatus(paid.auth, 5, { status: 'paid', payment_reference: 'edited' }),
    /لا يمكن تعديل مرجع سداد/,
  );
  assert.equal(paid.writes(), 0);
  await assert.rejects(paid.service.deleteTransaction(paid.auth, 5), /لا يمكن حذف معاملة ضريبية لها قيد سداد/);
  assert.equal(paid.writes(), 0);

  // Also reject stale status=declared when the immutable remittance journal exists.
  const stale = createMock('declared', true);
  await assert.rejects(stale.service.deleteTransaction(stale.auth, 5), /لا يمكن حذف معاملة ضريبية لها قيد سداد/);
  assert.equal(stale.writes(), 0);
  console.log('Withholding tax remittance lifecycle regressions passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
