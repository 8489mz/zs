import { strict as assert } from 'node:assert';
import { AppError } from '../../src/common/errors/app-error';
import { AuthContext } from '../../src/core/auth/interfaces/auth-context.interface';
import { SalesAuthorizationService } from '../../src/modules/sales/services/sales-authorization.service';
import { SalesQueryService } from '../../src/modules/sales/services/sales-query.service';
import { SalesWriteService } from '../../src/modules/sales/services/sales-write.service';

const TEST_TENANT_ID = 'tenant-a';
const TEST_ACCOUNT_ID = 'account-a';

type HeldSaleRow = {
  id: number;
  customer_id: number | null;
  payment_type: 'cash' | 'credit';
  payment_channel: 'cash' | 'card' | 'mixed' | 'credit';
  paid_amount: number;
  cash_amount: number;
  card_amount: number;
  discount: number;
  note: string;
  search: string;
  price_type: 'retail' | 'wholesale';
  branch_id: number | null;
  location_id: number | null;
  created_by: number | null;
  created_at: string;
  customer_name?: string;
  tenant_id: string;
  account_id: string;
};

type HeldSaleItemRow = {
  id: number;
  held_sale_id: number;
  product_id: number;
  product_name: string;
  qty: number;
  unit_price: number;
  unit_name: string;
  unit_multiplier: number;
  price_type: 'retail' | 'wholesale';
  tenant_id: string;
  account_id: string;
};

const cashierA: AuthContext = {
  userId: 10,
  sessionId: 'session-a',
  username: 'cashier-a',
  role: 'cashier',
  permissions: ['sales'],
  tenantId: TEST_TENANT_ID,
  accountId: TEST_ACCOUNT_ID,
};

const cashierB: AuthContext = {
  ...cashierA,
  userId: 20,
  sessionId: 'session-b',
  username: 'cashier-b',
};

const manager: AuthContext = {
  ...cashierA,
  userId: 30,
  sessionId: 'session-manager',
  username: 'manager',
  role: 'admin',
  permissions: ['sales', 'canEditInvoices'],
};

const invalidCashier: AuthContext = {
  ...cashierA,
  userId: 0,
  sessionId: 'session-invalid',
  username: 'invalid-cashier',
};

type FakeFilter = { column: unknown; op: string; value: unknown };

function normalizeColumn(column: unknown): string {
  return typeof column === 'string' ? column.replace(/^hs\./, '') : '';
}

class FakeSelectBuilder {
  private filters: FakeFilter[] = [];
  private sort?: { column: string; direction: string };

  constructor(private readonly table: string, private readonly db: FakeDb) {}

  leftJoin(): this { return this; }
  select(): this { return this; }
  orderBy(column?: string, direction = 'asc'): this {
    const parts = String(column || '').trim().split(/\s+/);
    if (column && !this.sort) this.sort = { column: parts[0] || column, direction: parts[1] || direction };
    return this;
  }

  where(column: unknown, op?: string, value?: unknown): this {
    this.filters.push({ column, op: op || '=', value });
    return this;
  }

  $if(condition: boolean, callback: (qb: this) => this): this {
    return condition ? callback(this) : this;
  }

  async execute(): Promise<Array<Record<string, unknown>>> {
    if (this.table === 'held_sales as hs') return this.filter(this.db.heldSales);
    if (this.table === 'held_sale_items') return this.filter(this.db.heldSaleItems);
    if (this.table === 'held_sales') return this.filter(this.db.heldSales);
    return [];
  }

  async executeTakeFirst(): Promise<Record<string, unknown> | undefined> {
    return (await this.execute())[0];
  }

  private filter<T extends Record<string, unknown>>(rows: T[]): T[] {
    const filtered = rows.filter((row) => this.filters.every((filter) => {
      const column = normalizeColumn(filter.column);
      if (!column) return true;
      const actual = row[column];
      if (filter.op === '=') {
        if (typeof actual === 'string' || typeof filter.value === 'string') return String(actual) === String(filter.value);
        return Number(actual) === Number(filter.value);
      }
      if (filter.op === 'in' && Array.isArray(filter.value)) return filter.value.map(Number).includes(Number(actual));
      return false;
    }));
    if (!this.sort) return filtered;
    const column = normalizeColumn(this.sort.column);
    const direction = this.sort.direction.toLowerCase();
    return [...filtered].sort((a, b) => {
      const left = Number(a[column] || 0);
      const right = Number(b[column] || 0);
      return direction === 'desc' ? right - left : left - right;
    });
  }
}

class FakeDeleteBuilder {
  private filters: Array<{ column: unknown; value: unknown }> = [];

  constructor(private readonly table: string, private readonly db: FakeDb) {}

  where(column: unknown, _op?: string, value?: unknown): this {
    this.filters.push({ column, value });
    return this;
  }

  $if(condition: boolean, callback: (qb: this) => this): this {
    return condition ? callback(this) : this;
  }

  async execute(): Promise<Array<{ numDeletedRows: bigint }>> {
    if (this.table !== 'held_sales') return [{ numDeletedRows: 0n }];
    const idsToDelete = this.db.heldSales
      .filter((row) => this.filters.every((filter) => {
        const column = normalizeColumn(filter.column);
        if (!column) return true;
        const actual = row[column as keyof HeldSaleRow];
        if (typeof actual === 'string' || typeof filter.value === 'string') return String(actual) === String(filter.value);
        return Number(actual || 0) === Number(filter.value);
      }))
      .map((row) => row.id);
    if (!this.filters.length) {
      const deletedCount = this.db.heldSales.length;
      this.db.heldSales = [];
      this.db.heldSaleItems = [];
      return [{ numDeletedRows: BigInt(deletedCount) }];
    }
    this.db.heldSales = this.db.heldSales.filter((row) => !idsToDelete.includes(row.id));
    this.db.heldSaleItems = this.db.heldSaleItems.filter((row) => !idsToDelete.includes(row.held_sale_id));
    return [{ numDeletedRows: BigInt(idsToDelete.length) }];
  }
}

class FakeDb {
  heldSales: HeldSaleRow[] = [
    heldSale(1, cashierA.userId),
    heldSale(2, cashierB.userId),
  ];
  auditLogs: string[] = [];
  heldSaleItems: HeldSaleItemRow[] = [
    heldSaleItem(101, 1, 'Tea'),
    heldSaleItem(102, 2, 'Coffee'),
  ];

  selectFrom(table: string): FakeSelectBuilder {
    return new FakeSelectBuilder(table, this);
  }

  deleteFrom(table: string): FakeDeleteBuilder {
    return new FakeDeleteBuilder(table, this);
  }
}

function heldSale(id: number, createdBy: number): HeldSaleRow {
  return {
    id,
    customer_id: null,
    payment_type: 'cash',
    payment_channel: 'cash',
    paid_amount: 0,
    cash_amount: 0,
    card_amount: 0,
    discount: 0,
    note: '',
    search: '',
    price_type: 'retail',
    branch_id: null,
    location_id: null,
    created_by: createdBy,
    created_at: `2026-04-24T10:00:0${id}.000Z`,
    customer_name: '',
    tenant_id: TEST_TENANT_ID,
    account_id: TEST_ACCOUNT_ID,
  };
}

function heldSaleItem(id: number, heldSaleId: number, name: string): HeldSaleItemRow {
  return {
    id,
    held_sale_id: heldSaleId,
    product_id: id,
    product_name: name,
    qty: 1,
    unit_price: 10,
    unit_name: 'piece',
    unit_multiplier: 1,
    price_type: 'retail',
    tenant_id: TEST_TENANT_ID,
    account_id: TEST_ACCOUNT_ID,
  };
}

function createServices(db = new FakeDb()) {
  const authz = new SalesAuthorizationService(db as any);
  const query = new SalesQueryService(db as any, authz);
  const write = new SalesWriteService(
    db as any,
    {} as any,
    { log: async (_action: string, details: string) => { db.auditLogs.push(details); } } as any,
    authz,
    {} as any,
    query,
    { syncSalePosting: async () => undefined } as any,
    { check: async () => null, commitOperation: async () => {} } as any,
    { hasFeature: async () => true, listFeatures: async () => [] } as any,
    {} as any,
  );
  return { db, query, write };
}

async function run(): Promise<void> {
  {
    const { query } = createServices();
    const result = await query.listHeldSales(cashierA);
    assert.deepEqual((result.heldSales as Array<Record<string, unknown>>).map((sale) => sale.id), ['1']);
  }

  {
    const { write } = createServices();
    await assert.rejects(
      () => write.deleteHeldSale(2, cashierA),
      (error: unknown) => error instanceof AppError && error.code === 'HELD_SALE_NOT_FOUND' && error.statusCode === 404,
    );
  }

  {
    const { db, write } = createServices();
    await write.clearHeldSales(cashierA);
    assert.deepEqual(db.heldSales.map((sale) => sale.id), [2]);
    assert.deepEqual(db.heldSaleItems.map((item) => item.held_sale_id), [2]);
    assert.match(db.auditLogs[0] || '', /scope=own held sales/);
    assert.match(db.auditLogs[0] || '', /deletedCount=1/);
  }

  {
    const { db, query, write } = createServices();
    assert.deepEqual((await query.listHeldSales(invalidCashier)).heldSales as Array<Record<string, unknown>>, []);
    await write.clearHeldSales(invalidCashier);
    assert.deepEqual(db.heldSales.map((sale) => sale.id), [1, 2]);
    assert.match(db.auditLogs[0] || '', /deletedCount=0/);
  }

  {
    const { db, query, write } = createServices();
    assert.deepEqual((await query.listHeldSales(manager)).heldSales as Array<Record<string, unknown>>, [
      {
        id: '2',
        savedAt: '2026-04-24T10:00:02.000Z',
        customerId: '',
        customerName: '',
        paymentType: 'cash',
        paymentChannel: 'cash',
        paidAmount: 0,
        cashAmount: 0,
        cardAmount: 0,
        discount: 0,
        /* INV-REST-HOLD-RECALL-TRUTH (R5-B): mapHeldSalesRows now returns
         * the held header fields; the fake rows carry none of the new
         * columns, so the mapper defaults apply here. */
        deliveryFee: 0,
        deliveryRepId: '',
        collectionStatus: '',
        tipAmount: 0,
        loyaltyPointsRedeemed: 0,
        pagerNumber: '',
        deliveryFeeMode: '',
        onlineOrderId: undefined,
        diningCourse: '',
        guestCount: undefined,
        guestCheckPrintedAt: null,
        note: '',
        search: '',
        tableNumber: '',
        orderType: 'takeaway',
        priceType: 'retail',
        branchId: '',
        locationId: '',
        cart: [
          {
            productId: '102',
            name: 'Coffee',
            qty: 1,
            price: 10,
            unitName: 'piece',
            unitMultiplier: 1,
            priceType: 'retail',
            lineKey: '102::piece::retail',
            modifiers: [],
          },
        ],
      },
      {
        id: '1',
        savedAt: '2026-04-24T10:00:01.000Z',
        customerId: '',
        customerName: '',
        paymentType: 'cash',
        paymentChannel: 'cash',
        paidAmount: 0,
        cashAmount: 0,
        cardAmount: 0,
        discount: 0,
        /* INV-REST-HOLD-RECALL-TRUTH (R5-B): mapHeldSalesRows now returns
         * the held header fields; the fake rows carry none of the new
         * columns, so the mapper defaults apply here. */
        deliveryFee: 0,
        deliveryRepId: '',
        collectionStatus: '',
        tipAmount: 0,
        loyaltyPointsRedeemed: 0,
        pagerNumber: '',
        deliveryFeeMode: '',
        onlineOrderId: undefined,
        diningCourse: '',
        guestCount: undefined,
        guestCheckPrintedAt: null,
        note: '',
        search: '',
        tableNumber: '',
        orderType: 'takeaway',
        priceType: 'retail',
        branchId: '',
        locationId: '',
        cart: [
          {
            productId: '101',
            name: 'Tea',
            qty: 1,
            price: 10,
            unitName: 'piece',
            unitMultiplier: 1,
            priceType: 'retail',
            lineKey: '101::piece::retail',
            modifiers: [],
          },
        ],
      },
    ]);
    await write.deleteHeldSale(2, manager);
    assert.deepEqual(db.heldSales.map((sale) => sale.id), [1]);
  }

  {
    const { db, write } = createServices();
    await write.clearHeldSales(manager);
    assert.deepEqual(db.heldSales, []);
    assert.match(db.auditLogs[0] || '', /scope=privileged broader management/);
    assert.match(db.auditLogs[0] || '', /deletedCount=2/);
  }

  console.log('held-sales-safety.spec: ok');
}

void run();
