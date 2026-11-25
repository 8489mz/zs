import { strict as assert } from 'node:assert';
import { CostCenterAllocationsService } from '../../src/modules/accounting/services/cost-center-allocations.service';

const auth: any = { tenantId: 'tenant-1', accountId: 'account-1', userId: 1, role: 'admin', permissions: [] };
const splits = [
  { costCenterId: 10, percentage: 33.34 },
  { costCenterId: 20, percentage: 33.33 },
  { costCenterId: 30, percentage: 33.33 },
];
function fakeDatabase(foundCount = 3) {
  const writes: string[] = [];
  let transactions = 0;
  const tx: any = {
    selectFrom(table: string) {
      const builder: any = {
        select() {
          return builder;
        },
        selectAll() {
          return builder;
        },
        where() {
          return builder;
        },
        forUpdate() {
          return builder;
        },
        async execute() {
          if (table.startsWith('cost_centers')) return splits.slice(0, foundCount).map((x) => ({ id: x.costCenterId }));
          if (table.startsWith('cost_center_allocation_splits'))
            return splits.map((x) => ({
              cost_center_id: x.costCenterId,
              percentage: x.percentage,
              cost_center_name: String(x.costCenterId),
              cost_center_code: String(x.costCenterId),
            }));
          return [];
        },
        async executeTakeFirst() {
          if (table.startsWith('cost_center_allocations')) return { id: '100', name: 'Test' };
          return undefined;
        },
        async executeTakeFirstOrThrow() {
          return { id: '100' };
        },
      };
      return builder;
    },
    insertInto(table: string) {
      const b: any = {
        values() {
          writes.push(table);
          return b;
        },
        returningAll() {
          return b;
        },
        async executeTakeFirstOrThrow() {
          return { id: '100' };
        },
        async execute() {},
      };
      return b;
    },
    updateTable(table: string) {
      const b: any = {
        set() {
          writes.push(table);
          return b;
        },
        where() {
          return b;
        },
        async execute() {},
      };
      return b;
    },
    deleteFrom(table: string) {
      const b: any = {
        where() {
          return b;
        },
        async execute() {
          writes.push('delete:' + table);
        },
      };
      return b;
    },
    leftJoin() {
      return this;
    },
  };
  const db: any = {
    transaction() {
      return {
        execute: async (fn: (trx: unknown) => Promise<unknown>) => {
          transactions++;
          return fn(tx);
        },
      };
    },
    selectFrom(table: string) {
      const b: any = tx.selectFrom(table);
      b.leftJoin = () => b;
      return b;
    },
  };
  return { db, writes, transactions: () => transactions };
}

(async () => {
  const absent = fakeDatabase(2);
  const missing = new CostCenterAllocationsService(absent.db);
  await assert.rejects(missing.createAllocation({ code: 'TEST', name: 'Test', splits }, auth), /لا يتبع المنشأة/);
  assert.deepEqual(absent.writes, [], 'no header or split is inserted on tenant ownership failure');
  assert.equal(absent.transactions(), 1);

  const good = fakeDatabase();
  const service = new CostCenterAllocationsService(good.db);
  await service.createAllocation({ code: 'TEST', name: 'Test', splits }, auth);
  assert.deepEqual(good.writes, ['cost_center_allocations', 'cost_center_allocation_splits']);
  assert.equal(good.transactions(), 1);

  await assert.rejects(
    service.updateAllocation('100', { code: 'TEST', name: 'Test', splits: [splits[0], splits[0]] }, auth),
    /غير مكررة/,
  );

  const result: any = await service.calculateSplitAmounts('100', 0.01, auth);
  assert.equal(
    result.splits.reduce((sum: number, x: any) => sum + x.allocatedAmount, 0),
    0.01,
  );
  assert.deepEqual(
    result.splits.map((x: any) => x.allocatedAmount),
    [0.01, 0, 0],
  );
  console.log('Cost center tenant atomicity and cent-residual regressions passed');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
