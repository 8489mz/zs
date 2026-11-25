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
      'audit_logs as a': [
        {
          id: 20,
          action: 'sale.created',
          details: 'created invoice',
          created_at: new Date().toISOString(),
          username: 'admin',
          count: 2,
        },
        {
          id: 19,
          action: 'sale.cancelled',
          details: 'cancelled invoice',
          created_at: new Date().toISOString(),
          username: 'cashier',
        },
      ],
    }) as never,
  );

  const result = await service.auditLogs({ page: 1, pageSize: 50, search: 'sale' }, {
    role: 'admin',
    permissions: ['audit'],
    tenantId: 'tenant-a',
    accountId: 'account-a',
  } as never);
  const logs = (result.auditLogs as any[]) || [];
  const pagination = result.pagination as any;
  const summary = result.summary as any;

  assert.equal(logs.length, 2);
  assert.equal(logs[0].id, '20');
  assert.equal(pagination.totalItems, 2);
  assert.equal(summary.distinctUsers, 2);
  assert.deepEqual(result.scope, { tenantId: 'tenant-a', accountId: 'account-a' });

  console.log('reports-audit-logs-pagination.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
