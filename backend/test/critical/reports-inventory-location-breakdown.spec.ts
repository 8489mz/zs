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
  whereRef(): this {
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
      'products as p': [
        {
          id: 2,
          name: 'سكر',
          stock_qty: 0,
          min_stock_qty: 5,
          retail_price: 20,
          cost_price: 10,
          category_name: 'بقالة',
          supplier_name: 'المورد أ',
        },
        {
          id: 1,
          name: 'أرز',
          stock_qty: 8,
          min_stock_qty: 10,
          retail_price: 30,
          cost_price: 20,
          category_name: 'بقالة',
          supplier_name: 'المورد ب',
        },
        { count: 2 },
        { count: 1 },
        { count: 2 },
      ],
      'product_location_stock as pls': [
        {
          product_id: 1,
          location_id: 10,
          branch_id: 1,
          qty: 5,
          location_name: 'المخزن الرئيسي',
          branch_name: 'الفرع الأول',
          min_stock_qty: 10,
        },
        {
          product_id: 1,
          location_id: 11,
          branch_id: 1,
          qty: 3,
          location_name: 'المخزن الخلفي',
          branch_name: 'الفرع الأول',
          min_stock_qty: 10,
        },
        {
          product_id: 2,
          location_id: 10,
          branch_id: 1,
          qty: 0,
          location_name: 'المخزن الرئيسي',
          branch_name: 'الفرع الأول',
          min_stock_qty: 5,
        },
      ],
    }) as never,
  );

  const result = await service.inventoryReport({ filter: 'attention', page: 1, pageSize: 20 }, {
    tenantId: 'tenant-a',
    accountId: 'account-a',
  } as never);
  const items = (result.items as any[]) || [];
  const summary = result.summary as any;
  const highlights = (result.locationHighlights as any[]) || [];

  assert.equal(items.length, 2);
  assert.equal(items[0].id, '2');
  assert.equal(items[1].id, '1');
  assert.equal(items[1].topLocationName, 'المخزن الرئيسي');
  assert.equal(items[1].topLocationQty, 5);
  assert.match(items[1].locationsLabel, /المخزن الرئيسي/);
  assert.equal(summary.lowStock, 1);
  assert.equal(summary.outOfStock, 2);
  assert.equal(summary.healthy, 0);
  assert.equal(highlights[0].locationName, 'المخزن الرئيسي');
  assert.equal(highlights[0].attentionItems, 2);

  console.log('reports-inventory-location-breakdown.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
