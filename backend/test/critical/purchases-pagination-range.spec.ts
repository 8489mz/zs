/* INV-PURCHASES-PAGINATION: the purchases list must return the displayed page
 * range with its pagination. Two purchases on page 1 showed "0-0 of 2" because
 * PurchasesQueryService.listPurchases returned { page, pageSize, totalItems,
 * totalPages, nextCursor } with no rangeStart/rangeEnd, while the workspace
 * reads pagination.rangeStart/rangeEnd (|| 0) and the shared PaginationMeta
 * contract requires both fields. Same count must yield the same range. */
import { strict as assert } from 'node:assert';
import { PurchasesQueryService } from '../../src/modules/purchases/services/purchases-query.service';

type RowMap = Record<string, unknown[]>;

class FakeQuery {
  constructor(private readonly rows: unknown[]) {}
  select(): this { return this; }
  where(): this { return this; }
  leftJoin(): this { return this; }
  orderBy(): this { return this; }
  limit(): this { return this; }
  offset(): this { return this; }
  execute(): Promise<unknown[]> { return Promise.resolve(this.rows); }
  executeTakeFirst(): Promise<unknown> { return Promise.resolve(this.rows[0]); }
}

class FakeDb {
  constructor(private readonly data: RowMap) {}
  selectFrom(table: string): FakeQuery {
    return new FakeQuery(this.data[table] || []);
  }
}

function purchaseRow(id: number, totalCount: number, total = 100): Record<string, unknown> {
  return {
    id,
    doc_no: `ZP-260101-${String(id).padStart(4, '0')}`,
    supplier_id: 3,
    supplier_name: 'مورد اختبار',
    payment_type: 'cash',
    subtotal: total,
    discount: 0,
    tax_rate: 0,
    tax_amount: 0,
    prices_include_tax: false,
    total,
    note: '',
    status: 'posted',
    lifecycle_status: '',
    matched_status: '',
    branch_id: 1,
    location_id: 1,
    created_at: '2026-11-01',
    branch_name: 'فرع',
    location_name: 'مخزن',
    created_by_name: 'مستخدم',
    required_date: null,
    currency: 'EGP',
    company_name: '',
    contact_id: null,
    shipping_address_id: null,
    cost_center_id: null,
    project_id: null,
    import_project_id: null,
    terms_template: '',
    total_count: totalCount,
    agg_total_amount: total * totalCount,
    agg_cash_total: total * totalCount,
    agg_credit_total: 0,
    agg_cancelled_count: 0,
  };
}

const auth = { tenantId: 'tenant-a', accountId: 'account-a' } as never;

(async () => {
  // The live defect: 2 purchases showed "0-0 of 2".
  const two = new PurchasesQueryService(new FakeDb({
    'purchases as p': [purchaseRow(2, 2, 100), purchaseRow(1, 2, 50)],
  }) as never);
  const twoResult = await two.listPurchases({ page: 1, pageSize: 25 }, auth);
  const twoPagination = twoResult.pagination as Record<string, unknown>;
  assert.equal((twoResult.purchases as unknown[]).length, 2);
  assert.equal(twoPagination.totalItems, 2);
  assert.equal(twoPagination.rangeStart, 1);
  assert.equal(twoPagination.rangeEnd, 2);

  // Same count yields the same range on a later page: 30 items, page 2 of 25.
  const pageTwo = new PurchasesQueryService(new FakeDb({
    'purchases as p': [30, 29, 28, 27, 26].map((id) => purchaseRow(id, 30)),
  }) as never);
  const pageTwoResult = await pageTwo.listPurchases({ page: 2, pageSize: 25 }, auth);
  const pageTwoPagination = pageTwoResult.pagination as Record<string, unknown>;
  assert.equal(pageTwoPagination.totalItems, 30);
  assert.equal(pageTwoPagination.rangeStart, 26);
  assert.equal(pageTwoPagination.rangeEnd, 30);

  // Empty list stays 0-0, never 1-0.
  const empty = new PurchasesQueryService(new FakeDb({}) as never);
  const emptyResult = await empty.listPurchases({ page: 1, pageSize: 25 }, auth);
  const emptyPagination = emptyResult.pagination as Record<string, unknown>;
  assert.equal(emptyPagination.totalItems, 0);
  assert.equal(emptyPagination.rangeStart, 0);
  assert.equal(emptyPagination.rangeEnd, 0);

  console.log('purchases-pagination-range.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
