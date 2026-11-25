import { strict as assert } from 'node:assert';
import { ReportsService } from '../../src/modules/reports/reports.service';

type RowMap = Record<string, unknown[]>;

class FakeQuery {
  constructor(private readonly rows: unknown[]) {}
  select(): this {
    return this;
  }
  where(): this {
    return this;
  }
  innerJoin(): this {
    return this;
  }
  leftJoin(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  groupBy(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  execute(): Promise<unknown[]> {
    return Promise.resolve(this.rows);
  }
  executeTakeFirst(): Promise<unknown> {
    return Promise.resolve(this.rows[0]);
  }
}

class FakeDb {
  constructor(private readonly data: RowMap) {}
  selectFrom(table: string): FakeQuery {
    return new FakeQuery(this.data[table] || []);
  }
}

(async () => {
  const service = new ReportsService(
    new FakeDb({
      suppliers: [
        { id: 1, name: 'Supplier A', phone: '1', balance: 0 },
        { id: 2, name: 'Supplier B', phone: '2', balance: 250 },
        { id: 3, name: 'Supplier C', phone: '3', balance: 0 },
      ],
      supplier_ledger: [
        { supplier_id: 1, balance_total: 125 },
        { supplier_id: 3, balance_total: 40 },
      ],
    }) as never,
  );

  const result = await service.supplierBalances({}, { tenantId: 'tenant-a', accountId: 'account-a' } as never);
  const suppliers = (result.suppliers as any[]) || [];
  const summary = result.summary as any;

  assert.equal(suppliers.length, 3);
  assert.equal(suppliers[0].id, '1');
  assert.equal(suppliers[0].balance, 125);
  assert.equal(suppliers[1].id, '2');
  assert.equal(suppliers[1].balance, 250);
  assert.equal(suppliers[2].id, '3');
  assert.equal(suppliers[2].balance, 40);
  assert.equal(summary.totalBalance, 415);

  console.log('reports-supplier-balances.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
