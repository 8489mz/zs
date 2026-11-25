import { strict as assert } from 'node:assert';
import { SupplierPaymentSchedulesService } from '../../src/modules/purchases/services/supplier-payment-schedules.service';

// A supplier's available amount must account for unpaid installments attached to specific purchases.
const inserted: unknown[] = [];
const queriedFilters: Array<[string, string, unknown]> = [];
const tx: any = {
  selectFrom(table: string) {
    const builder: any = {
      select() {
        return builder;
      },
      where(col: unknown, operator?: unknown, value?: unknown) {
        if (typeof col === 'string') queriedFilters.push([col, String(operator), value]);
        return builder;
      },
      forUpdate() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      async executeTakeFirst() {
        return table === 'suppliers' ? { id: 9, balance: 100 } : { installment_no: 0 };
      },
      async execute() {
        assert.equal(table, 'supplier_payment_schedules');
        // All existing installments are attached to a purchase, not to the supplier globally.
        return [{ amount: 80, paid_amount: 0 }];
      },
    };
    return builder;
  },
  insertInto(table: string) {
    assert.equal(table, 'supplier_payment_schedules');
    const builder: any = {
      values(data: unknown) {
        inserted.push(data);
        return builder;
      },
      async execute() {
        return [];
      },
    };
    return builder;
  },
};
const txHelper: any = { runInTransaction: async (_db: unknown, fn: (trx: unknown) => Promise<unknown>) => fn(tx) };
const service = new SupplierPaymentSchedulesService({} as any, txHelper, {} as any, {} as any, {} as any);
(service as any).listForSupplier = async () => ({ schedules: inserted });
const auth: any = {
  role: 'admin',
  userId: 7,
  username: 'admin',
  tenantId: 'tenant-A',
  accountId: 'account-A',
  permissions: [],
};
// B4-P3: firstDueDate is bounded [today-7, today+5y] — use a relative
// UTC-today date (inside the window for every tenant zone).
const payload = (scheduleAmount: number): any => ({
  mode: 'count',
  installmentCount: 1,
  scheduleAmount,
  firstDueDate: new Date().toISOString().slice(0, 10),
});
(async () => {
  await assert.rejects(
    service.createForSupplier(9, payload(50), auth),
    /Schedule amount must be within unscheduled supplier balance/,
  );
  assert.equal(inserted.length, 0);
  assert.equal(
    queriedFilters.some(([column, operator]) => column === 'purchase_id' && operator === 'is'),
    false,
    'existing commitments must include purchase-linked schedules',
  );
  await service.createForSupplier(9, payload(20), auth);
  assert.equal(inserted.length, 1);
  console.log('Supplier payment schedule cap regressions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
