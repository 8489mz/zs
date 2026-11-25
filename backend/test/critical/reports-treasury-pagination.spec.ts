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
  offset(): this {
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
      'treasury_transactions as t': [
        {
          id: 5,
          txn_type: 'sale_payment',
          amount: 300,
          note: 'cash in',
          reference_type: 'sale',
          reference_id: 10,
          branch_id: 1,
          location_id: 1,
          created_at: new Date().toISOString(),
          branch_name: 'Main',
          location_name: 'Store',
          created_by_name: 'admin',
          count: 2,
          cash_in: 300,
          cash_out: -50,
          net_total: 250,
        },
        {
          id: 4,
          txn_type: 'expense',
          amount: -50,
          note: 'cash out',
          reference_type: 'expense',
          reference_id: 11,
          branch_id: 1,
          location_id: 1,
          created_at: new Date().toISOString(),
          branch_name: 'Main',
          location_name: 'Store',
          created_by_name: 'admin',
        },
      ],
    }) as never,
  );

  const result = await service.treasuryTransactions({ page: 1, pageSize: 25, search: 'cash', filter: 'all' }, {
    role: 'super_admin',
    permissions: ['treasury'],
    tenantId: 'tenant-a',
    accountId: 'account-a',
  } as never);
  const treasury = (result.treasury as any[]) || [];
  const summary = result.summary as any;
  const pagination = result.pagination as any;

  assert.equal(treasury.length, 2);
  assert.equal(treasury[0].id, '5');
  assert.equal(summary.cashIn, 300);
  assert.equal(summary.cashOut, 50);
  assert.equal(summary.net, 250);
  assert.equal(pagination.totalItems, 2);
  assert.deepEqual(result.scope, { tenantId: 'tenant-a', accountId: 'account-a' });

  console.log('reports-treasury-pagination.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
