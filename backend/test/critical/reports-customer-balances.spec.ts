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
      customers: [
        { id: 1, name: 'A', phone: '1', balance: 0, credit_limit: 500 },
        { id: 2, name: 'B', phone: '2', balance: 200, credit_limit: 300 },
      ],
      customer_ledger: [
        { customer_id: 1, balance_total: 150 },
        { customer_id: 2, balance_total: -50 },
      ],
    }) as never,
  );

  const result = await service.customerBalances({}, { tenantId: 'tenant-a', accountId: 'account-a' } as never);
  const customers = (result.customers as any[]) || [];
  const summary = result.summary as any;

  assert.equal(customers.length, 1);
  assert.equal(customers[0].id, '1');
  assert.equal(customers[0].balance, 150);
  assert.equal(customers[0].availableCredit, 350);
  assert.equal(summary.totalBalance, 150);

  console.log('reports-customer-balances.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
