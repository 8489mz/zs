import { strict as assert } from 'node:assert';
import { ReportsService } from '../../src/modules/reports/reports.service';

type RowMap = Record<string, unknown[]>;

class FakeQuery {
  constructor(private readonly rows: unknown[]) {}
  select(): this { return this; }
  where(): this { return this; }
  innerJoin(): this { return this; }
  leftJoin(): this { return this; }
  orderBy(): this { return this; }
  limit(): this { return this; }
  execute(): Promise<unknown[]> { return Promise.resolve(this.rows); }
  executeTakeFirst(): Promise<unknown> { return Promise.resolve(this.rows[0]); }
}

class FakeDb {
  constructor(private readonly data: RowMap) {}
  selectFrom(table: string): FakeQuery {
    return new FakeQuery(this.data[table] || []);
  }
}

(async () => {
  const service = new ReportsService(new FakeDb({
    sales: [
      { id: 1, total: 1000, discount: 0, branch_id: 1, location_id: 1, created_at: '2026-04-01T10:00:00.000Z' },
      { id: 2, total: 500, discount: 20, branch_id: 1, location_id: 1, created_at: '2026-04-02T10:00:00.000Z' },
    ],
    purchases: [
      { id: 1, total: 700, branch_id: 1, location_id: 1, created_at: '2026-04-01T10:00:00.000Z' },
    ],
    expenses: [
      { id: 1, amount: 120, branch_id: 1, location_id: 1, expense_date: '2026-04-03T10:00:00.000Z' },
      { id: 2, amount: 30, branch_id: 1, location_id: 1, expense_date: '2026-04-04T10:00:00.000Z' },
    ],
    return_documents: [
      { id: 1, return_type: 'sale', total: 80, branch_id: 1, location_id: 1, created_at: '2026-04-03T10:00:00.000Z' },
      { id: 2, return_type: 'purchase', total: 50, branch_id: 1, location_id: 1, created_at: '2026-04-04T10:00:00.000Z' },
    ],
    treasury_transactions: [
      { amount: 1000, branch_id: 1, location_id: 1, created_at: '2026-04-01T10:00:00.000Z' },
      { amount: -150, branch_id: 1, location_id: 1, created_at: '2026-04-03T10:00:00.000Z' },
      { amount: -50, branch_id: 1, location_id: 1, created_at: '2026-04-04T10:00:00.000Z' },
    ],
    'sale_items as si': [
      { product_id: 1, product_name: 'A', qty: 2, line_total: 400, cost_price: 100, branch_id: 1, location_id: 1, created_at: '2026-04-01T10:00:00.000Z' },
      { product_id: 2, product_name: 'B', qty: 1, line_total: 300, cost_price: 150, branch_id: 1, location_id: 1, created_at: '2026-04-02T10:00:00.000Z' },
    ],
  }) as never);

  const summary = await service.reportSummary(
    { from: '2026-04-01T00:00:00.000Z', to: '2026-04-30T23:59:59.999Z', branchId: 1, locationId: 1 },
    { tenantId: 'tenant-a', accountId: 'account-a' } as never,
  );

  assert.equal((summary.sales as any).total, 1500);
  assert.equal((summary.sales as any).netSales, 1420);
  assert.equal((summary.purchases as any).total, 700);
  assert.equal((summary.purchases as any).netPurchases, 650);
  assert.equal((summary.expenses as any).total, 150);
  assert.equal((summary.expenses as any).count, 2);
  // INV-SALES-REPORT-RETURNS-CARD: the card is sales returns (80) + sales
  // discounts (20) = 100. The old expectation, 130, folded the 50.00
  // purchase return into a sales card; purchase returns stay visible only
  // as returns.purchasesTotal below.
  assert.equal((summary.returns as any).total, 100);
  assert.equal((summary.returns as any).salesTotal, 80);
  assert.equal((summary.returns as any).purchasesTotal, 50);
  assert.equal((summary.returns as any).salesCount, 1);
  assert.equal((summary.returns as any).purchasesCount, 1);
  assert.equal((summary.commercial as any).cogs, 350);
  assert.equal((summary.commercial as any).grossProfit, 1070);
  assert.equal((summary.commercial as any).netOperatingProfit, 920);
  assert.equal((summary.treasury as any).cashIn, 1000);
  assert.equal((summary.treasury as any).cashOut, 200);
  assert.equal((summary.treasury as any).net, 800);

  console.log('reports-financial-summary.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
