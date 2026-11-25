import assert from 'node:assert/strict';
import { AppError } from '../../src/common/errors/app-error';
import {
  applyStockDelta,
  previewAssignedLocationStockQty,
  previewConsumableStockQty,
  releaseLocationStock,
  reserveLocationStock,
} from '../../src/common/utils/location-stock-ledger';

const TEST_SCOPE = { tenantId: 'tenant-stock-test', accountId: 'account-stock-test' };

type FakeProduct = {
  id: number;
  name: string;
  stock_qty: number;
  reserved_qty: number;
  tenant_id: string;
  account_id: string;
};

type FakeLocationStock = {
  id: number;
  product_id: number;
  branch_id: number | null;
  location_id: number | null;
  qty: number;
  reserved_qty: number;
  tenant_id: string;
  account_id: string;
};

type FakeState = {
  products: FakeProduct[];
  locationStock: FakeLocationStock[];
  nextLocationStockId: number;
};

class FakeSelectBuilder {
  private filters = new Map<string, unknown>();

  constructor(
    private readonly table: string,
    private readonly state: FakeState,
  ) {}

  select(_columns: unknown): this {
    return this;
  }
  where(column: string | unknown, _operator?: string, value?: unknown): this {
    if (typeof column === 'string') this.filters.set(column, value);
    return this;
  }
  orderBy(_column?: unknown, _direction?: unknown): this {
    return this;
  }
  forUpdate(): this {
    return this;
  }

  async executeTakeFirst(): Promise<unknown> {
    const rows = await this.execute();
    return rows[0];
  }

  async execute(): Promise<unknown[]> {
    if (this.table === 'products') {
      return this.state.products.filter((p) => p.id === Number(this.filters.get('id') || 0));
    }
    if (this.table === 'product_location_stock') {
      return this.state.locationStock.filter((l) => l.product_id === Number(this.filters.get('product_id') || 0));
    }
    throw new Error(`Unexpected select table ${this.table}`);
  }
}

class FakeInsertBuilder {
  private payload: Record<string, unknown> = {};

  constructor(
    private readonly table: string,
    private readonly state: FakeState,
  ) {}

  values(payload: Record<string, unknown>): this {
    this.payload = payload;
    return this;
  }

  returning(_columns: unknown): this {
    return this;
  }

  async executeTakeFirstOrThrow(): Promise<unknown> {
    if (this.table !== 'product_location_stock') throw new Error(`Unexpected insert table ${this.table}`);
    const row: FakeLocationStock = {
      id: this.state.nextLocationStockId++,
      product_id: Number(this.payload.product_id),
      branch_id: this.payload.branch_id == null ? null : Number(this.payload.branch_id),
      location_id: this.payload.location_id == null ? null : Number(this.payload.location_id),
      qty: Number(this.payload.qty || 0),
      reserved_qty: Number(this.payload.reserved_qty || 0),
      tenant_id: String(this.payload.tenant_id || ''),
      account_id: String(this.payload.account_id || ''),
    };
    this.state.locationStock.push(row);
    return row;
  }
}

class FakeUpdateBuilder {
  private payload: Record<string, unknown> = {};
  private filters = new Map<string, unknown>();

  constructor(
    private readonly table: string,
    private readonly state: FakeState,
  ) {}

  set(payload: Record<string, unknown>): this {
    this.payload = payload;
    return this;
  }

  where(column: string | unknown, _operator?: string, value?: unknown): this {
    if (typeof column === 'string') this.filters.set(column, value);
    return this;
  }

  async execute(): Promise<void> {
    if (this.table === 'products') {
      const row = this.state.products.find((p) => p.id === Number(this.filters.get('id') || 0));
      if (row) {
        if (this.payload.stock_qty !== undefined) row.stock_qty = Number(this.payload.stock_qty);
        if (this.payload.reserved_qty !== undefined) row.reserved_qty = Number(this.payload.reserved_qty);
      }
      return;
    }
    if (this.table === 'product_location_stock') {
      const row = this.state.locationStock.find((l) => l.id === Number(this.filters.get('id') || 0));
      if (row) {
        if (this.payload.qty !== undefined) row.qty = Number(this.payload.qty);
        if (this.payload.reserved_qty !== undefined) row.reserved_qty = Number(this.payload.reserved_qty);
        if (this.payload.branch_id !== undefined)
          row.branch_id = this.payload.branch_id == null ? null : Number(this.payload.branch_id);
      }
      return;
    }
    throw new Error(`Unexpected update table ${this.table}`);
  }
}

class FakeStockDb {
  constructor(public readonly state: FakeState) {}
  selectFrom(table: string): FakeSelectBuilder {
    return new FakeSelectBuilder(table, this.state);
  }
  insertInto(table: string): FakeInsertBuilder {
    return new FakeInsertBuilder(table, this.state);
  }
  updateTable(table: string): FakeUpdateBuilder {
    return new FakeUpdateBuilder(table, this.state);
  }
}

function createDb(productStock: number, locationQty: number = 0, reservedQty: number = 0): FakeStockDb {
  const state: FakeState = {
    products: [
      {
        id: 10,
        name: 'Cement Bag',
        stock_qty: productStock,
        reserved_qty: reservedQty,
        tenant_id: TEST_SCOPE.tenantId,
        account_id: TEST_SCOPE.accountId,
      },
    ],
    locationStock: [
      {
        id: 1,
        product_id: 10,
        branch_id: 1,
        location_id: 100,
        qty: locationQty,
        reserved_qty: reservedQty,
        tenant_id: TEST_SCOPE.tenantId,
        account_id: TEST_SCOPE.accountId,
      },
    ],
    nextLocationStockId: 2,
  };
  return new FakeStockDb(state);
}

async function runStockLedgerTests(): Promise<void> {
  console.log('=== بدء اختبارات محرك المخازن والأرصدة المكانية (Location Stock Ledger) ===\n');

  // 1. اختبار المعاينة الاستهلاكية للمخزون (previewConsumableStockQty)
  {
    const db = createDb(100, 40, 10);
    // الإجمالي: 100، المحجوز: 10 -> المتاح عالمياً: 90
    // بالموقع 100: 40 - 10 = 30، غير المعين: 60 -> المجموع المحلي: 90
    const consumable = await previewConsumableStockQty(db as any, {
      productId: 10,
      locationId: 100,
      branchId: 1,
      tenantId: TEST_SCOPE.tenantId,
      accountId: TEST_SCOPE.accountId,
    });
    assert.equal(consumable, 90, 'Consumable stock must include location stock + unassigned pool capped by global');

    // بدون تحديد موقع (null) -> يعيد المتاح عالمياً
    const globalConsumable = await previewConsumableStockQty(db as any, {
      productId: 10,
      locationId: null,
      tenantId: TEST_SCOPE.tenantId,
      accountId: TEST_SCOPE.accountId,
    });
    assert.equal(globalConsumable, 90, 'Global consumable stock without location should equal global available');
    console.log('✓ 1. اختبار معاينة المخزون القابل للاستهلاك (previewConsumableStockQty) اجتاز بنجاح');
  }

  // 2. اختبار معاينة المخزون المخصص لموقع بعينه (previewAssignedLocationStockQty)
  {
    const db = createDb(100, 40, 10);
    const assigned = await previewAssignedLocationStockQty(db as any, {
      productId: 10,
      locationId: 100,
      branchId: 1,
      tenantId: TEST_SCOPE.tenantId,
      accountId: TEST_SCOPE.accountId,
    });
    // 40 - 10 = 30 فقط (دون إضافة غير المعين)
    assert.equal(assigned, 30, 'Assigned stock must only reflect this specific location available balance');
    console.log('✓ 2. اختبار معاينة المخزون المخصص حصراً للموقع (previewAssignedLocationStockQty) اجتاز بنجاح');
  }

  // 3. اختبار زيادة المخزون بإضافة حركة موجبة (applyStockDelta +)
  {
    const db = createDb(50, 50, 0);
    const result = await applyStockDelta(db as any, {
      productId: 10,
      locationId: 100,
      branchId: 1,
      delta: 25,
      tenantId: TEST_SCOPE.tenantId,
      accountId: TEST_SCOPE.accountId,
    });
    assert.equal(result.globalBefore, 50);
    assert.equal(result.globalAfter, 75);
    assert.equal(result.scopeBefore, 50);
    assert.equal(result.scopeAfter, 75);
    assert.equal(db.state.products[0].stock_qty, 75);
    console.log('✓ 3. اختبار إضافة المخزون بزيادة موجبة (applyStockDelta +25) اجتاز بنجاح');
  }

  // 4. اختبار خصم المخزون بحركة سالبة (applyStockDelta -)
  {
    const db = createDb(50, 50, 0);
    const result = await applyStockDelta(db as any, {
      productId: 10,
      locationId: 100,
      branchId: 1,
      delta: -20,
      tenantId: TEST_SCOPE.tenantId,
      accountId: TEST_SCOPE.accountId,
    });
    assert.equal(result.globalBefore, 50);
    assert.equal(result.globalAfter, 30);
    assert.equal(result.scopeBefore, 50);
    assert.equal(result.scopeAfter, 30);
    assert.equal(db.state.products[0].stock_qty, 30);
    console.log('✓ 4. اختبار خصم المخزون بحركة سالبة (applyStockDelta -20) اجتاز بنجاح');
  }

  // 5. اختبار حظر الخصم المتجاوز للرصيد المتاح (INSUFFICIENT_STOCK)
  {
    const db = createDb(50, 50, 0);
    let caught = false;
    try {
      await applyStockDelta(db as any, {
        productId: 10,
        locationId: 100,
        branchId: 1,
        delta: -60, // رصيد 50 وطلب خصم 60
        tenantId: TEST_SCOPE.tenantId,
        accountId: TEST_SCOPE.accountId,
      });
    } catch (err) {
      caught = true;
      assert.ok(err instanceof AppError);
      assert.equal((err as AppError).code, 'INSUFFICIENT_STOCK');
    }
    assert.ok(caught, 'Must throw INSUFFICIENT_STOCK when deducting more than available');
    assert.equal(db.state.products[0].stock_qty, 50, 'Product stock must remain unchanged on rejection');
    console.log('✓ 5. اختبار منع تجاوز المخزون وحماية الرصيد من السالب اجتاز بنجاح');
  }

  // 6. اختبار حجز المخزون وتحريره (reserveLocationStock & releaseLocationStock)
  {
    const db = createDb(100, 100, 0);
    // حجز 30 قطعة
    const res = await reserveLocationStock(db as any, {
      branchId: 1,
      locationId: 100,
      tenantId: TEST_SCOPE.tenantId,
      accountId: TEST_SCOPE.accountId,
      items: [{ productId: 10, qty: 30 }],
    });
    assert.equal(res.items[0].globalReservedAfter, 30);
    assert.equal(res.items[0].locationReservedAfter, 30);
    assert.equal(db.state.products[0].reserved_qty, 30);

    // تحرير 20 قطعة من الحجز
    const rel = await releaseLocationStock(db as any, {
      branchId: 1,
      locationId: 100,
      tenantId: TEST_SCOPE.tenantId,
      accountId: TEST_SCOPE.accountId,
      items: [{ productId: 10, qty: 20 }],
    });
    assert.equal(rel.items[0].globalReservedAfter, 10);
    assert.equal(rel.items[0].locationReservedAfter, 10);
    assert.equal(db.state.products[0].reserved_qty, 10);
    console.log('✓ 6. اختبار دورة حجز المخزون وإلغاء الحجز بدقة اجتازت بنجاح');
  }

  console.log('\n=============================================================================');
  console.log('  كافة اختبارات محرك المخازن والأرصدة المكانية (Location Stock Ledger) اجتازت 100%');
  console.log('=============================================================================\n');
}

runStockLedgerTests()
  .then(() => {
    console.log('location-stock-ledger.spec: ok');
  })
  .catch((err) => {
    console.error('location-stock-ledger.spec: FAILED', err);
    process.exit(1);
  });
